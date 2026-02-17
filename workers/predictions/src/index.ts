import postgres from "postgres";
import {
  config,
  getDbBoolean,
  getDbString,
  getDbNumber,
  loadDbConfig,
  refreshDbConfigIfStale,
} from "./config.js";
import {
  createPredictionMarketsBatch,
  resolvePredictionMarket,
  type ArticleCandidate,
  type PollToResolve,
} from "./orchestrator.js";
import {
  broadcastNewPrediction,
  sendClaimablePayoutNotifications,
  sendStakeResolvedNotifications,
} from "./pushNotifications.js";

const WORKER_ADVISORY_LOCK_KEY = 42;

async function findArticleCandidates(
  sql: postgres.Sql,
  relevanceMin: number,
  limit: number
): Promise<ArticleCandidate[]> {
  // Find recent articles with sufficient relevance that don't already have a prediction market
  return sql<ArticleCandidate[]>`
    select
      fi.id::text as id,
      fi.headline,
      fi.summary_60 as "summary60",
      coalesce(fi.category, 'web3') as category
    from feed_items fi
    left join article_predictions ap on ap.article_id = fi.id
    left join pipeline_telemetry pt on pt.article_id = fi.id
    where fi.created_at >= now() - interval '6 hours'
      and ap.article_id is null
      and fi.summary_60 is not null
      and fi.headline is not null
      and (
        pt.relevance_score >= ${relevanceMin}
        or pt.relevance_score is null
      )
    order by fi.created_at desc
    limit ${limit}
  `;
}

async function findPollsToResolve(
  sql: postgres.Sql,
  limit: number
): Promise<PollToResolve[]> {
  // Find AI-generated prediction polls past their deadline that haven't been resolved.
  // Skip polls that had a resolution attempt in the last hour — prevents infinite retry
  // loops for polls stuck in indeterminate/no_consensus state (which are expensive).
  return sql<PollToResolve[]>`
    select
      op.id,
      op.question,
      op.resolution_rule as "resolutionRule",
      op.deadline_at::text as "deadlineAt",
      coalesce(op.is_prediction, false) as "isPrediction",
      op.yes_votes as "yesVotes",
      op.no_votes as "noVotes",
      coalesce(op.platform_fee_pct, 5.00)::float as "platformFeePct"
    from opinion_polls op
    where op.status = 'active'
      and op.ai_generated = true
      and op.deadline_at <= now()
      and not exists (
        select 1 from prediction_resolutions pr
        where pr.poll_id = op.id
          and pr.created_at > now() - interval '1 hour'
      )
    order by op.deadline_at asc
    limit ${limit}
  `;
}

async function main() {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required for predictions worker");
  }

  const sql = postgres(config.databaseUrl, {
    max: 3,
    idle_timeout: 10,
  });

  // Load DB config on startup
  await loadDbConfig(sql);

  const agentBase = {
    apiKey: config.openRouterApiKey,
    appName: "Chainshorts",
    appUrl: config.appWebUrl,
  } as const;

  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const executeRun = async () => {
    if (running) {
      // eslint-disable-next-line no-console
      console.warn("[predictions] Skipping tick — previous run still active");
      return;
    }

    // Refresh DB config (60s TTL)
    await refreshDbConfigIfStale(sql);

    // Master kill-switch
    if (!getDbBoolean("ai_enabled", true)) {
      // eslint-disable-next-line no-console
      console.log("[predictions] ai_enabled=false — skipping");
      return;
    }

    // Build agent config with DB-overridden models
    const agents = {
      // Pipeline Stage 1: Topic Classification
      topicClassifier: {
        ...agentBase,
        model: getDbString("agent_model_topic_classifier", config.agentModels.topicClassifier),
      },
      // Pipeline Stage 2: Question Generation
      questionGenerator: {
        ...agentBase,
        model: getDbString("agent_model_question_generator", config.agentModels.questionGenerator),
      },
      // Pipeline Stage 3: Question Verification
      questionVerifier: {
        ...agentBase,
        model: getDbString("agent_model_question_verifier", config.agentModels.questionVerifier),
      },
      // Pipeline Stage 4: Duplicate Detection
      duplicateChecker: {
        ...agentBase,
        model: getDbString("agent_model_duplicate_checker", config.agentModels.duplicateChecker),
      },
      // Multi-agent resolvers (3 LLMs for consensus)
      resolverModels: [
        getDbString("agent_model_resolver_1", config.agentModels.resolver1),
        getDbString("agent_model_resolver_2", config.agentModels.resolver2),
        getDbString("agent_model_resolver_3", config.agentModels.resolver3),
      ] as [string, string, string],
      openRouterApiKey: config.openRouterApiKey,
      appWebUrl: config.appWebUrl,
    };

    const relevanceMin = getDbNumber("prediction_relevance_min", config.relevanceMinConfidence);
    const autoSettleConfidence = getDbNumber("prediction_auto_settle_confidence", config.autoSettleConfidence);
    const defaultDeadlineHours = getDbNumber("prediction_default_deadline_hours", config.defaultDeadlineHours);
    const generationEnabled = getDbBoolean("prediction_ai_generation", false);

    running = true;
    let lockConn: Awaited<ReturnType<typeof sql.reserve>> | null = null;
    let lockAcquired = false;
    try {
      lockConn = await sql.reserve();
      const lockRows = await lockConn<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_lock(${WORKER_ADVISORY_LOCK_KEY}) AS "acquired"
      `;
      lockAcquired = !!lockRows[0]?.acquired;
      if (!lockAcquired) {
        // eslint-disable-next-line no-console
        console.log("[predictions] Skipping tick — advisory lock not acquired");
        return;
      }

      // Phase 1: Generate predictions from new articles (BATCH MODE)
      if (generationEnabled) {
        const candidates = await findArticleCandidates(sql, relevanceMin, config.maxArticlesPerTick);
        if (candidates.length === 0) {
          // eslint-disable-next-line no-console
          console.log("[predictions] No candidate articles found in window");
        } else {
          // eslint-disable-next-line no-console
          console.log(`[predictions] Processing ${candidates.length} articles in batch mode`);

          const results = await createPredictionMarketsBatch(sql, candidates, agents, defaultDeadlineHours);

          const successful = results.filter((r) => r.success);
          const skipped = results.filter((r) => !r.success && r.session.status === "skipped");
          const failed = results.filter((r) => !r.success && r.session.status === "failed");

          // eslint-disable-next-line no-console
          console.log(`[predictions] Batch complete: ${successful.length} created, ${skipped.length} skipped, ${failed.length} failed`);

          const firstNewMarket = successful.find(
            (result) => result.session.pollId && result.session.generatedQuestion
          );
          if (firstNewMarket?.session.pollId && firstNewMarket.session.generatedQuestion) {
            await broadcastNewPrediction(
              sql,
              firstNewMarket.session.generatedQuestion,
              firstNewMarket.session.pollId
            ).catch((error) => {
              // eslint-disable-next-line no-console
              console.warn("[predictions] Failed to broadcast new prediction push:", error);
            });
          }

          for (const result of skipped) {
            // eslint-disable-next-line no-console
            console.log(`[predictions] Skipped: ${result.session.failureReason} | article=${result.session.articleId}`);
          }
          for (const result of failed) {
            // eslint-disable-next-line no-console
            console.error(`[predictions] Failed ${result.session.articleId}: ${result.session.failureReason}`);
          }
        }
      } else {
        // eslint-disable-next-line no-console
        console.log("[predictions] prediction_ai_generation=false — skipping new market creation");
      }

      // Phase 2: Resolve expired predictions
      const expiredPolls = await findPollsToResolve(sql, config.maxResolvalsPerTick);
      if (expiredPolls.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[predictions] Found ${expiredPolls.length} polls to resolve`);
      }

      for (const poll of expiredPolls) {
        try {
          const resolution = await resolvePredictionMarket(sql, poll, agents, autoSettleConfidence);
          if (resolution.settled && (resolution.outcome === "yes" || resolution.outcome === "no")) {
            const [winnerRows, loserRows] = await Promise.all([
              sql<Array<{ wallet: string }>>`
                SELECT DISTINCT wallet
                FROM prediction_stakes
                WHERE poll_id = ${resolution.pollId}
                  AND side = ${resolution.outcome}
                  AND status = 'won'
              `,
              sql<Array<{ wallet: string }>>`
                SELECT DISTINCT wallet
                FROM prediction_stakes
                WHERE poll_id = ${resolution.pollId}
                  AND side <> ${resolution.outcome}
                  AND status = 'lost'
              `,
            ]);

            await sendStakeResolvedNotifications(
              sql,
              resolution.pollId,
              poll.question,
              winnerRows.map((row) => row.wallet),
              loserRows.map((row) => row.wallet)
            ).catch((error) => {
              // eslint-disable-next-line no-console
              console.warn(`[predictions] Failed to send stake resolution push for poll=${resolution.pollId}:`, error);
            });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[predictions] Failed to resolve ${poll.id}:`, err instanceof Error ? err.message : err);
        }
      }

      // Phase 3: Notify newly claimable payouts
      await sendClaimablePayoutNotifications(sql).catch((error) => {
        // eslint-disable-next-line no-console
        console.warn("[predictions] Failed to send claimable payout push notifications:", error);
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[predictions] Run failed:", error);
    } finally {
      if (lockConn) {
        if (lockAcquired) {
          try {
            await lockConn`
              SELECT pg_advisory_unlock(${WORKER_ADVISORY_LOCK_KEY})
            `;
          } catch (unlockError) {
            // eslint-disable-next-line no-console
            console.error("[predictions] Failed to release advisory lock:", unlockError);
          }
        }
        lockConn.release();
      }
      running = false;
    }
  };

  const shutdown = async (signal: string) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // eslint-disable-next-line no-console
    console.log(`[predictions] Received ${signal}, shutting down...`);
    await sql.end();
    process.exit(0);
  };

  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

  // Run once immediately
  await executeRun();

  // Then on interval
  timer = setInterval(() => {
    void executeRun();
  }, config.intervalSeconds * 1000);

  // eslint-disable-next-line no-console
  console.log(`[predictions] Scheduler active (interval: ${config.intervalSeconds}s)`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
