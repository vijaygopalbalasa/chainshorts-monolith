import { callAgentLLM, type AgentConfig } from "@chainshorts/shared";

export interface OutcomeResolverInput {
  question: string;
  resolutionRule: {
    kind: string;
    symbol?: string;
    target?: number;
  };
  deadline: string;
}

export interface OutcomeResolverOutput {
  outcome: "yes" | "no" | "indeterminate";
  confidence: number;
  sources: string[];
  reasoning: string;
}

export interface AgentResult {
  model: string;
  outcome: "yes" | "no" | "indeterminate";
  confidence: number;
  sources: string[];
  reasoning: string;
}

export interface ConsensusResult {
  outcome: "yes" | "no" | "indeterminate" | "no_consensus";
  confidence: number;
  type: "unanimous" | "majority" | "no_consensus" | "early_exit";
}

export interface MultiAgentResolution {
  agent1: AgentResult;
  agent2: AgentResult;
  agent3: AgentResult;
  consensus: ConsensusResult;
}

const SYSTEM_PROMPT = `You are a prediction market outcome resolver. Users have staked real tokens on YES/NO — your resolution determines who gets paid.

RESOLUTION RESPONSIBILITY:
- Your decision directly affects real token payouts. Be accurate and evidence-based.
- For "event_occurs" questions: search for concrete evidence (official announcements, on-chain data, news reports).
- For price questions: check the actual price at/near the deadline from reliable sources.
- Use "indeterminate" ONLY when evidence genuinely doesn't exist yet or is contradictory. Don't default to it out of caution — users are waiting for resolution.

EVIDENCE STANDARDS:
- "yes" or "no": You have clear evidence from at least one reliable source (official blog, major news outlet, on-chain explorer, price feed).
- "indeterminate": The event hasn't happened yet, evidence is contradictory, or no reliable source confirms either way.

Output valid JSON only — no markdown, no explanation.`;

/**
 * Run a single agent to resolve a prediction outcome.
 * useWebSearch should only be true for the primary resolver to avoid per-query billing.
 */
async function runSingleAgent(
  input: OutcomeResolverInput,
  config: AgentConfig,
  useWebSearch = false
): Promise<OutcomeResolverOutput> {
  const prompt = [
    "Resolve the outcome of this prediction market question.",
    "Return JSON ONLY:",
    "{",
    '  "outcome": "yes" | "no" | "indeterminate",',
    '  "confidence": 0.0-1.0,',
    '  "sources": ["url1", "url2"],',
    '  "reasoning": "explanation of how outcome was determined"',
    "}",
    "",
    "Guidelines:",
    "- For event_occurs: search for evidence the event happened",
    `- The deadline was: ${input.deadline}`,
    "- Only mark 'yes'/'no' if you have strong evidence (confidence > 0.7)",
    "- Use 'indeterminate' if evidence is unclear or deadline hasn't properly passed",
    "",
    "<prediction>",
    `<question>${input.question.slice(0, 500)}</question>`,
    `<resolution_rule>${JSON.stringify(input.resolutionRule)}</resolution_rule>`,
    `<deadline>${input.deadline}</deadline>`,
    "</prediction>",
  ].join("\n");

  try {
    const result = await callAgentLLM(
      { ...config, responseFormat: "json", useWebSearch },
      prompt,
      SYSTEM_PROMPT,
      600
    );

    let jsonContent = result.content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonContent) as Partial<OutcomeResolverOutput>;
    const validOutcomes = ["yes", "no", "indeterminate"] as const;
    const outcome = validOutcomes.includes(parsed.outcome as typeof validOutcomes[number])
      ? (parsed.outcome as typeof validOutcomes[number])
      : "indeterminate";

    return {
      outcome,
      confidence: typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.3,
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter((s): s is string => typeof s === "string").slice(0, 10)
        : [],
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 1000) : "",
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[multiAgentResolver] Agent ${config.model} failed:`, error);
    return {
      outcome: "indeterminate",
      confidence: 0,
      sources: [],
      reasoning: `resolver_error: LLM call failed - ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

/**
 * Calculate consensus from 3 agent results
 */
function calculateConsensus(results: [AgentResult, AgentResult, AgentResult]): ConsensusResult {
  const outcomes = results.map((r) => r.outcome);
  const yesCount = outcomes.filter((o) => o === "yes").length;
  const noCount = outcomes.filter((o) => o === "no").length;
  const indeterminateCount = outcomes.filter((o) => o === "indeterminate").length;

  // All 3 agents returned indeterminate
  if (indeterminateCount === 3) {
    return {
      outcome: "indeterminate",
      confidence: 0,
      type: "unanimous",
    };
  }

  // Check for unanimous yes/no
  if (yesCount === 3) {
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / 3;
    return {
      outcome: "yes",
      confidence: avgConfidence,
      type: "unanimous",
    };
  }

  if (noCount === 3) {
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / 3;
    return {
      outcome: "no",
      confidence: avgConfidence,
      type: "unanimous",
    };
  }

  // Check for majority (2/3)
  if (yesCount >= 2) {
    const agreeing = results.filter((r) => r.outcome === "yes");
    const avgConfidence = agreeing.reduce((sum, r) => sum + r.confidence, 0) / agreeing.length;
    return {
      outcome: "yes",
      confidence: Math.max(0, avgConfidence - 0.1), // 0.1 penalty for non-unanimous
      type: "majority",
    };
  }

  if (noCount >= 2) {
    const agreeing = results.filter((r) => r.outcome === "no");
    const avgConfidence = agreeing.reduce((sum, r) => sum + r.confidence, 0) / agreeing.length;
    return {
      outcome: "no",
      confidence: Math.max(0, avgConfidence - 0.1), // 0.1 penalty for non-unanimous
      type: "majority",
    };
  }

  // No consensus (e.g., 1 yes, 1 no, 1 indeterminate)
  return {
    outcome: "no_consensus",
    confidence: 0,
    type: "no_consensus",
  };
}

/**
 * Multi-Agent Outcome Resolver
 * Runs 3 LLMs in parallel and calculates consensus.
 *
 * Consensus rules:
 * - 3/3 agree → unanimous, average confidence
 * - 2/3 agree → majority, average confidence minus 0.1 penalty
 * - <2/3 agree → no_consensus, routes to admin review
 */
export async function runMultiAgentResolver(
  input: OutcomeResolverInput,
  models: [string, string, string],
  apiKey: string,
  appUrl: string
): Promise<MultiAgentResolution> {
  const callWithTimeout = (model: string, index: number, useWebSearch: boolean) =>
    Promise.race([
      runSingleAgent(input, { apiKey, model, appUrl }, useWebSearch),
      new Promise<OutcomeResolverOutput>((_, reject) =>
        setTimeout(() => reject(new Error(`Agent ${index + 1} timeout`)), 60000)
      ),
    ]).catch((error): OutcomeResolverOutput => {
      // eslint-disable-next-line no-console
      console.error(`[multiAgentResolver] Agent ${index + 1} (${model}) error:`, error);
      return {
        outcome: "indeterminate",
        confidence: 0,
        sources: [],
        reasoning: `timeout_error: ${error instanceof Error ? error.message : "unknown"}`,
      };
    });

  // Agent 1 runs first with web search (the only web-search call — keep costs low)
  const res1 = await callWithTimeout(models[0], 0, true);

  // Early-exit: if agent 1 is highly confident skip agents 2+3 entirely (saves 2 LLM calls)
  const agent1: AgentResult = { model: models[0], outcome: res1.outcome, confidence: res1.confidence, sources: res1.sources, reasoning: res1.reasoning };
  if (res1.outcome !== "indeterminate" && res1.confidence >= 0.9) {
    // eslint-disable-next-line no-console
    console.log(`[multiAgentResolver] Early exit — agent 1 high confidence (${res1.confidence.toFixed(2)})`);
    const skipResult: AgentResult = { model: "skipped", outcome: res1.outcome, confidence: res1.confidence, sources: [], reasoning: "skipped — agent 1 early exit" };
    const consensus: ConsensusResult = {
      outcome: res1.outcome,
      confidence: res1.confidence,
      type: "early_exit",
    };
    // eslint-disable-next-line no-console
    console.log(`[multiAgentResolver] Early-exit consensus: ${consensus.type} ${consensus.outcome} (${consensus.confidence.toFixed(2)})`);
    return { agent1, agent2: skipResult, agent3: skipResult, consensus };
  }

  // Agents 2+3 run in parallel — no web search (cheap models, no per-query billing)
  const [res2, res3] = await Promise.all([
    callWithTimeout(models[1], 1, false),
    callWithTimeout(models[2], 2, false),
  ]);

  const agent2: AgentResult = { model: models[1], outcome: res2.outcome, confidence: res2.confidence, sources: res2.sources, reasoning: res2.reasoning };
  const agent3: AgentResult = { model: models[2], outcome: res3.outcome, confidence: res3.confidence, sources: res3.sources, reasoning: res3.reasoning };

  const consensus = calculateConsensus([agent1, agent2, agent3]);

  // eslint-disable-next-line no-console
  console.log(
    `[multiAgentResolver] Results: ${agent1.outcome}/${agent2.outcome}/${agent3.outcome} → ${consensus.type} ${consensus.outcome} (${consensus.confidence.toFixed(2)})`
  );

  return { agent1, agent2, agent3, consensus };
}
