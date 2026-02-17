import { settlePredictionMarket, type SettlementSql } from "@chainshorts/shared";
import type postgres from "postgres";
import { runDuplicateChecker } from "./agents/duplicateChecker.js";
import { runQuestionVerifier } from "./agents/questionVerifier.js";
import { runMultiAgentResolver, type MultiAgentResolution } from "./agents/multiAgentResolver.js";
import { resolvePriceQuestion } from "./agents/coinGeckoResolver.js";
import { runBatchClassifyGenerate } from "./agents/batchClassifyGenerate.js";
import type {
  ArticleCandidate,
  PollToResolve,
  ResolutionRule,
  PredictionSession,
  PipelineResult,
  AgentModelsConfig,
  ResolutionResult,
} from "./types.js";

const MINIMUM_TOPIC_CONFIDENCE = 0.4;
const MINIMUM_GENERATOR_CONFIDENCE = 0.4;
const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess_${ts}_${rand}`;
}

function generatePollId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `pred_${ts}_${rand}`;
}

/** Add ±0-6 hours of random jitter so deadlines from the same batch don't cluster */
function jitterHours(): number {
  return Math.round(Math.random() * 12) - 6; // -6 to +6 hours
}

async function fetchExistingQuestions(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<Array<{ question: string }>>`
    select question
    from opinion_polls
    where status = 'active'
      and is_prediction = true
      and created_at >= now() - interval '7 days'
    order by created_at desc
    limit 15
  `;
  return rows.map((r) => r.question);
}

async function fetchPredictionPlatformFeePct(sql: postgres.Sql): Promise<number> {
  const rows = await sql<Array<{ value: string }>>`
    SELECT value
    FROM system_config
    WHERE key = 'prediction_fee_pct'
    LIMIT 1
  `;
  const configured = Number.parseFloat(rows[0]?.value ?? "");
  if (Number.isFinite(configured) && configured >= 0 && configured <= 20) {
    return configured;
  }
  return 5;
}

async function linkArticleToPoll(
  sql: postgres.Sql,
  articleId: string,
  pollId: string
): Promise<void> {
  await sql`
    insert into article_predictions (article_id, poll_id)
    values (${articleId}, ${pollId})
    on conflict (article_id, poll_id) do nothing
  `;
}

/**
 * Batch Prediction Market Pipeline
 *
 * Processes 5-10 articles in 1 LLM call for classification + generation.
 * Then verifies + deduplicates per question.
 *
 * Cost reduction: ~80% fewer API calls vs per-article processing.
 *
 * Pipeline:
 * 1. Batch: TopicClassifier + QuestionGenerator (1 LLM call for N articles)
 * 2. Per-question: QuestionVerifier
 * 3. Per-question: DuplicateChecker
 * 4. Per-question: Publish
 */
export async function createPredictionMarketsBatch(
  sql: postgres.Sql,
  articles: ArticleCandidate[],
  agents: AgentModelsConfig,
  defaultDeadlineHours: number
): Promise<PipelineResult[]> {
  if (articles.length === 0) return [];

  const results: PipelineResult[] = [];
  const existingQuestions = await fetchExistingQuestions(sql);
  const platformFeePct = await fetchPredictionPlatformFeePct(sql);

  // Stage 1+2: Batch classification + generation
  const batchInput = articles.map((a, i) => ({
    index: i,
    headline: a.headline,
    summary60: a.summary60,
    category: a.category,
  }));

  const batchResults = await runBatchClassifyGenerate(
    batchInput,
    existingQuestions,
    agents.topicClassifier
  );

  // Process each result through verification + deduplication
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    if (!article) continue;

    const batchResult = batchResults[i];
    if (!batchResult) {
      results.push({
        session: createSkippedSession(article.id, "missing_batch_result"),
        success: false,
      });
      continue;
    }

    const session: PredictionSession = {
      id: generateSessionId(),
      articleId: article.id,
      status: "pending",
      topic: batchResult.topic,
      topicConfidence: batchResult.topicConfidence,
      generatedQuestion: batchResult.question,
      generatorConfidence: batchResult.questionConfidence,
      verifierConfidence: 0,
      isDuplicate: false,
      duplicateOf: null,
      pollId: null,
      failureReason: null,
      startedAt: new Date(),
      completedAt: null,
    };

    // Skip if not prediction-worthy
    if (!batchResult.isPredictionWorthy || !batchResult.question) {
      session.status = "skipped";
      session.failureReason = batchResult.skipReason || "Not prediction-worthy";
      session.completedAt = new Date();
      results.push({ session, success: false });
      continue;
    }

    // Skip if low confidence
    if (batchResult.topicConfidence < MINIMUM_TOPIC_CONFIDENCE) {
      session.status = "skipped";
      session.failureReason = `Low topic confidence: ${batchResult.topicConfidence}`;
      session.completedAt = new Date();
      results.push({ session, success: false });
      continue;
    }

    if (batchResult.questionConfidence < MINIMUM_GENERATOR_CONFIDENCE) {
      session.status = "skipped";
      session.failureReason = `Low generator confidence: ${batchResult.questionConfidence}`;
      session.completedAt = new Date();
      results.push({ session, success: false });
      continue;
    }

    // Skip if generator couldn't produce a valid deadline
    if (batchResult.deadlineDays === null) {
      session.status = "skipped";
      session.failureReason = "Generator returned null deadlineDays (question may reference far-future date outside supported range)";
      session.completedAt = new Date();
      results.push({ session, success: false });
      continue;
    }

    try {
      // Stage 3: Question Verification
      session.status = "verifying";

      const verified = await runQuestionVerifier(
        {
          question: batchResult.question,
          resolutionRule: batchResult.resolutionRule || { kind: "event_occurs" },
          // Use actual deadlineDays so verifier timeframe matches the real deadline
          timeframe: `${batchResult.deadlineDays} days`,
        },
        agents.questionVerifier
      );

      session.verifierConfidence = verified.confidence;

      if (!verified.valid) {
        session.status = "skipped";
        session.failureReason = `Verifier rejected: ${verified.issues.join(", ")}`;
        session.completedAt = new Date();
        results.push({ session, success: false });
        continue;
      }

      // Stage 4: AI Duplicate Detection
      session.status = "deduplicating";

      const dupCheck = await runDuplicateChecker(
        {
          candidateQuestion: batchResult.question,
          existingQuestions,
        },
        agents.duplicateChecker
      );

      session.isDuplicate = dupCheck.isDuplicate;
      session.duplicateOf = dupCheck.duplicateOf;

      if (dupCheck.isDuplicate && dupCheck.similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
        const existingPoll = await findPollByQuestion(sql, dupCheck.duplicateOf);
        if (existingPoll) {
          await linkArticleToPoll(sql, article.id, existingPoll);
        }

        session.status = "skipped";
        session.failureReason = `Duplicate detected: ${dupCheck.reasoning}`;
        session.completedAt = new Date();
        results.push({ session, success: false });
        continue;
      }

      // Stage 5: Publish
      session.status = "publishing";

      const pollId = generatePollId();
      const deadlineDays = batchResult.deadlineDays ?? Math.round(defaultDeadlineHours / 24);
      const deadlineHours = deadlineDays * 24 + jitterHours();
      const deadlineAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString();

      await sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as postgres.Sql;

        await tx`
          insert into opinion_polls (
            id, question, article_context, deadline_at, status,
            ai_generated, generator_confidence, verifier_confidence,
            resolution_rule, is_prediction, platform_fee_pct
          ) values (
            ${pollId},
            ${batchResult.question},
            ${article.headline},
            ${deadlineAt}::timestamptz,
            'active',
            true,
            ${batchResult.questionConfidence},
            ${verified.confidence},
            ${JSON.stringify(batchResult.resolutionRule || { kind: "community_majority" })}::jsonb,
            true,
            ${platformFeePct}
          )
        `;

        await tx`
          insert into article_predictions (article_id, poll_id)
          values (${article.id}, ${pollId})
          on conflict (article_id, poll_id) do nothing
        `;

        await tx`
          insert into prediction_pools (poll_id)
          values (${pollId})
          on conflict (poll_id) do nothing
        `;
      });

      session.pollId = pollId;
      session.status = "completed";
      session.completedAt = new Date();

      // Add to existing questions to prevent duplicates within batch
      existingQuestions.push(batchResult.question);

      results.push({ session, success: true });
    } catch (error) {
      session.status = "failed";
      session.failureReason = error instanceof Error ? error.message : "Unknown error";
      session.completedAt = new Date();
      results.push({ session, success: false });
    }
  }

  return results;
}

function createSkippedSession(articleId: string, reason: string): PredictionSession {
  return {
    id: generateSessionId(),
    articleId,
    status: "skipped",
    topic: null,
    topicConfidence: 0,
    generatedQuestion: null,
    generatorConfidence: 0,
    verifierConfidence: 0,
    isDuplicate: false,
    duplicateOf: null,
    pollId: null,
    failureReason: reason,
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

async function findPollByQuestion(
  sql: postgres.Sql,
  question: string | null
): Promise<string | null> {
  if (!question) return null;

  const rows = await sql<Array<{ id: string }>>`
    select id from opinion_polls
    where lower(question) = lower(${question})
      and status = 'active'
      and is_prediction = true
    limit 1
  `;

  return rows[0]?.id ?? null;
}

/**
 * Resolution Pipeline
 *
 * Methods by resolution rule:
 * - community_majority: Legacy path, market is cancelled
 * - price_above/price_below: CoinGecko deterministic
 * - event_occurs: Multi-agent consensus (3 LLMs)
 */
export async function resolvePredictionMarket(
  sql: postgres.Sql,
  poll: PollToResolve,
  agents: AgentModelsConfig,
  autoSettleConfidence: number
): Promise<ResolutionResult> {
  const rule = normalizeResolutionRule(poll.resolutionRule);

  if (rule.kind === "community_majority") {
    return resolveByCommunityVote(sql, poll);
  }

  if (rule.kind === "price_above" || rule.kind === "price_below") {
    return resolveByPrice(sql, poll, rule);
  }

  if (rule.kind === "event_occurs") {
    return resolveByMultiAgentConsensus(sql, poll, agents, autoSettleConfidence);
  }

  // Fallback: community majority
  return resolveByCommunityVote(sql, poll);
}

function normalizeResolutionRule(raw: unknown): ResolutionRule {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const validKinds = ["price_above", "price_below", "event_occurs", "community_majority"];
    if (typeof obj.kind === "string" && validKinds.includes(obj.kind)) {
      return {
        kind: obj.kind as ResolutionRule["kind"],
        symbol: typeof obj.symbol === "string" ? obj.symbol : undefined,
        target: typeof obj.target === "number" ? obj.target : undefined,
      };
    }
  }
  return { kind: "community_majority" };
}

async function resolveByCommunityVote(
  sql: postgres.Sql,
  poll: PollToResolve
): Promise<ResolutionResult> {
  // Community votes are no longer a valid resolver here because vote counts stay near-zero.
  // Cancel markets that use this legacy path to avoid deterministic bad resolutions.
  const cancelled = await cancelPoll(sql, poll.id);
  return {
    pollId: poll.id,
    outcome: "indeterminate",
    confidence: 0,
    source: "legacy_community_vote",
    settled: false,
    failureReason: cancelled ? "cancelled" : "deferred",
  };
}

async function resolveByPrice(
  sql: postgres.Sql,
  poll: PollToResolve,
  rule: ResolutionRule
): Promise<ResolutionResult> {
  const result = await resolvePriceQuestion({
    symbol: rule.symbol || "bitcoin",
    target: rule.target || 0,
    kind: rule.kind as "price_above" | "price_below",
    deadline: poll.deadlineAt,
  });

  await recordResolution(sql, {
    pollId: poll.id,
    outcome: result.outcome,
    confidence: result.confidence,
    sources: [result.source],
    reasoning: result.reasoning,
    method: "coingecko_price",
    consensusType: "unanimous",
  });

  if (result.outcome === "indeterminate") {
    return {
      pollId: poll.id,
      outcome: "indeterminate",
      confidence: result.confidence,
      source: result.source,
      settled: false,
      failureReason: "indeterminate",
    };
  }

  const settled = await settlePredictionMarket({
    sql: sql as unknown as SettlementSql,
    pollId: poll.id,
    winnerSide: result.outcome as "yes" | "no",
    source: "ai_auto",
  });

  if ("frozen" in settled) {
    return {
      pollId: poll.id,
      outcome: result.outcome as "yes" | "no",
      confidence: result.confidence,
      source: result.source,
      settled: false,
      failureReason: "frozen",
    };
  }
  if ("reserved" in settled) {
    return {
      pollId: poll.id,
      outcome: result.outcome as "yes" | "no",
      confidence: result.confidence,
      source: result.source,
      settled: false,
      failureReason: "reserved",
    };
  }
  if ("alreadySettled" in settled) {
    return {
      pollId: poll.id,
      outcome: result.outcome as "yes" | "no",
      confidence: result.confidence,
      source: result.source,
      settled: false,
      failureReason: "already_settled",
    };
  }

  await tryFinalizeResolutionRecord(sql, poll.id, result.outcome as "yes" | "no");
  return {
    pollId: poll.id,
    outcome: result.outcome as "yes" | "no",
    confidence: result.confidence,
    source: result.source,
    settled: true,
  };
}

async function resolveByMultiAgentConsensus(
  sql: postgres.Sql,
  poll: PollToResolve,
  agents: AgentModelsConfig,
  autoSettleConfidence: number
): Promise<ResolutionResult> {
  const rule = normalizeResolutionRule(poll.resolutionRule);

  const result = await runMultiAgentResolver(
    {
      question: poll.question,
      resolutionRule: rule,
      deadline: poll.deadlineAt,
    },
    agents.resolverModels,
    agents.openRouterApiKey,
    agents.appWebUrl
  );

  await recordMultiAgentResolution(sql, poll.id, result);

  const { consensus } = result;

  if (consensus.outcome === "indeterminate" || consensus.outcome === "no_consensus") {
    return {
      pollId: poll.id,
      outcome: "indeterminate",
      confidence: consensus.confidence,
      source: "multi_agent",
      settled: false,
      failureReason: consensus.outcome,
    };
  }

  if (consensus.confidence >= autoSettleConfidence) {
    const settled = await settlePredictionMarket({
      sql: sql as unknown as SettlementSql,
      pollId: poll.id,
      winnerSide: consensus.outcome as "yes" | "no",
      source: "ai_auto",
    });

    if ("frozen" in settled) {
      return {
        pollId: poll.id,
        outcome: consensus.outcome as "yes" | "no",
        confidence: consensus.confidence,
        source: "multi_agent",
        settled: false,
        failureReason: "frozen",
      };
    }
    if ("reserved" in settled) {
      return {
        pollId: poll.id,
        outcome: consensus.outcome as "yes" | "no",
        confidence: consensus.confidence,
        source: "multi_agent",
        settled: false,
        failureReason: "reserved",
      };
    }
    if ("alreadySettled" in settled) {
      return {
        pollId: poll.id,
        outcome: consensus.outcome as "yes" | "no",
        confidence: consensus.confidence,
        source: "multi_agent",
        settled: false,
        failureReason: "already_settled",
      };
    }

    await tryFinalizeResolutionRecord(sql, poll.id, consensus.outcome as "yes" | "no");
    return {
      pollId: poll.id,
      outcome: consensus.outcome as "yes" | "no",
      confidence: consensus.confidence,
      source: "multi_agent",
      settled: true,
    };
  }
  // Low confidence: routes to admin review (no settlement)
  return {
    pollId: poll.id,
    outcome: consensus.outcome as "yes" | "no",
    confidence: consensus.confidence,
    source: "multi_agent",
    settled: false,
    failureReason: "low_confidence",
  };
}

async function tryFinalizeResolutionRecord(
  sql: postgres.Sql,
  pollId: string,
  outcome: "yes" | "no"
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await sql`
        update prediction_resolutions
        set final_outcome = ${outcome},
            resolved_by = 'ai_auto',
            resolved_at = now()
        where poll_id = ${pollId}
          and resolved_by is null
      `;
      return;
    } catch (error) {
      if (attempt < 3) {
        // eslint-disable-next-line no-console
        console.warn(
          `[predictions] finalize resolution retry ${attempt} failed for poll=${pollId}`,
          error
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(
        `[predictions] settled poll=${pollId} but failed to persist final_outcome after retries`,
        error
      );
    }
  }
}

function formatConsensusReasoning(result: MultiAgentResolution): string {
  return `${result.consensus.type.toUpperCase()} consensus (${result.consensus.confidence.toFixed(2)}): ` +
    `Agent1=${result.agent1.outcome}, Agent2=${result.agent2.outcome}, Agent3=${result.agent3.outcome}`;
}

interface ResolutionRecord {
  pollId: string;
  outcome: string;
  confidence: number;
  sources: string[];
  reasoning: string;
  method: string;
  consensusType: string;
}

async function recordResolution(
  sql: postgres.Sql,
  record: ResolutionRecord
): Promise<void> {
  const updated = await sql<Array<{ id: string }>>`
    update prediction_resolutions
    set resolver_outcome = ${record.outcome},
        resolver_confidence = ${record.confidence},
        resolver_sources = ${JSON.stringify(record.sources)}::jsonb,
        resolver_reasoning = ${record.reasoning},
        resolution_method = ${record.method},
        consensus_outcome = ${record.outcome},
        consensus_confidence = ${record.confidence},
        consensus_type = ${record.consensusType}
    where poll_id = ${record.pollId}
      and resolved_by is null
    returning id::text as id
  `;
  if (updated[0]) {
    return;
  }

  await sql`
    insert into prediction_resolutions (
      poll_id, resolver_outcome, resolver_confidence,
      resolver_sources, resolver_reasoning, resolution_method,
      consensus_outcome, consensus_confidence, consensus_type
    ) values (
      ${record.pollId},
      ${record.outcome},
      ${record.confidence},
      ${JSON.stringify(record.sources)}::jsonb,
      ${record.reasoning},
      ${record.method},
      ${record.outcome},
      ${record.confidence},
      ${record.consensusType}
    )
  `;
}

async function recordMultiAgentResolution(
  sql: postgres.Sql,
  pollId: string,
  result: MultiAgentResolution
): Promise<void> {
  const updated = await sql<Array<{ id: string }>>`
    update prediction_resolutions
    set resolver_outcome = ${result.consensus.outcome},
        resolver_confidence = ${result.consensus.confidence},
        resolver_sources = ${JSON.stringify([...result.agent1.sources, ...result.agent2.sources, ...result.agent3.sources])}::jsonb,
        resolver_reasoning = ${formatConsensusReasoning(result)},
        resolution_method = 'multi_agent',
        agent1_model = ${result.agent1.model},
        agent1_outcome = ${result.agent1.outcome},
        agent1_confidence = ${result.agent1.confidence},
        agent1_reasoning = ${result.agent1.reasoning},
        agent1_sources = ${JSON.stringify(result.agent1.sources)}::jsonb,
        agent2_model = ${result.agent2.model},
        agent2_outcome = ${result.agent2.outcome},
        agent2_confidence = ${result.agent2.confidence},
        agent2_reasoning = ${result.agent2.reasoning},
        agent2_sources = ${JSON.stringify(result.agent2.sources)}::jsonb,
        agent3_model = ${result.agent3.model},
        agent3_outcome = ${result.agent3.outcome},
        agent3_confidence = ${result.agent3.confidence},
        agent3_reasoning = ${result.agent3.reasoning},
        agent3_sources = ${JSON.stringify(result.agent3.sources)}::jsonb,
        consensus_outcome = ${result.consensus.outcome},
        consensus_confidence = ${result.consensus.confidence},
        consensus_type = ${result.consensus.type}
    where poll_id = ${pollId}
      and resolved_by is null
    returning id::text as id
  `;
  if (updated[0]) {
    return;
  }

  await sql`
    insert into prediction_resolutions (
      poll_id,
      resolver_outcome, resolver_confidence,
      resolver_sources, resolver_reasoning,
      resolution_method,
      agent1_model, agent1_outcome, agent1_confidence, agent1_reasoning, agent1_sources,
      agent2_model, agent2_outcome, agent2_confidence, agent2_reasoning, agent2_sources,
      agent3_model, agent3_outcome, agent3_confidence, agent3_reasoning, agent3_sources,
      consensus_outcome, consensus_confidence, consensus_type
    ) values (
      ${pollId},
      ${result.consensus.outcome},
      ${result.consensus.confidence},
      ${JSON.stringify([...result.agent1.sources, ...result.agent2.sources, ...result.agent3.sources])}::jsonb,
      ${formatConsensusReasoning(result)},
      'multi_agent',
      ${result.agent1.model}, ${result.agent1.outcome}, ${result.agent1.confidence}, ${result.agent1.reasoning}, ${JSON.stringify(result.agent1.sources)}::jsonb,
      ${result.agent2.model}, ${result.agent2.outcome}, ${result.agent2.confidence}, ${result.agent2.reasoning}, ${JSON.stringify(result.agent2.sources)}::jsonb,
      ${result.agent3.model}, ${result.agent3.outcome}, ${result.agent3.confidence}, ${result.agent3.reasoning}, ${JSON.stringify(result.agent3.sources)}::jsonb,
      ${result.consensus.outcome}, ${result.consensus.confidence}, ${result.consensus.type}
    )
  `;
}

async function cancelPoll(sql: postgres.Sql, pollId: string): Promise<boolean> {
  return await sql.begin(async (txSql) => {
    const tx = txSql as unknown as postgres.Sql;
    const pendingIntentRows = await tx<Array<{ count: string }>>`
      SELECT COUNT(*)::text as count
      FROM payment_intents
      WHERE kind = 'prediction_stake'
        AND reference_type = 'poll'
        AND reference_id = ${pollId}
        AND status = 'pending'
        AND expires_at > now()
    `;
    if (Number.parseInt(pendingIntentRows[0]?.count ?? "", 10) > 0) {
      return false;
    }

    const pendingCashoutRows = await tx<Array<{ count: string }>>`
      SELECT COUNT(*)::text as count
      FROM prediction_stakes
      WHERE poll_id = ${pollId}
        AND status = 'cashing_out'
    `;
    if (Number.parseInt(pendingCashoutRows[0]?.count ?? "", 10) > 0) {
      return false;
    }

    const pollRows = await tx<Array<{ id: string }>>`
      update opinion_polls
      set status = 'cancelled', resolved_at = now()
      where id = ${pollId} and status = 'active'
      returning id::text as id
    `;
    if (!pollRows[0]) {
      return false;
    }

    await tx`
      update prediction_stakes
      set status = 'cancelled'
      where poll_id = ${pollId} and status = 'active'
    `;

    await tx`
      insert into prediction_payouts (
        poll_id,
        wallet,
        stake_id,
        stake_skr,
        winnings_skr,
        platform_fee_skr,
        net_payout_skr,
        payout_ratio,
        status,
        claimable_at,
        claim_deadline
      )
      select
        poll_id,
        wallet,
        id,
        amount_skr,
        0,
        0,
        amount_skr,
        1.0,
        'pending',
        now(),
        now() + interval '365 days'
      from prediction_stakes
      where poll_id = ${pollId}
        and status = 'cancelled'
      on conflict (stake_id) do nothing
    `;
    return true;
  });
}

export type { AgentModelsConfig, ArticleCandidate, PollToResolve, PredictionSession, PipelineResult, ResolutionResult };
