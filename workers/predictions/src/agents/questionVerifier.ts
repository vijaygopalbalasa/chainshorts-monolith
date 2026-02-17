import { callAgentLLM, type AgentConfig } from "@chainshorts/shared";

export interface QuestionVerifierInput {
  question: string;
  resolutionRule: {
    kind: string;
    symbol?: string;
    target?: number;
  };
  timeframe: string;
}

export interface QuestionVerifierOutput {
  valid: boolean;
  confidence: number;
  issues: string[];
  suggestedFix?: string;
}

const SYSTEM_PROMPT = `You are a prediction market quality verifier for a crypto app where users stake real tokens on YES/NO outcomes.

Your job is to ensure markets are TRADEABLE — meaning real users would want to bet on both sides.

Validate these criteria (reject if ANY fails):
1) **Unambiguous** — only one interpretation possible
2) **Verifiable** — outcome can be objectively determined from public data
3) **Time-bound** — has a specific future deadline date
4) **Genuine uncertainty** — outcome is NOT obvious (reject if >90% likely one way)
5) **Resolution rule matches** — price_above/below for price questions, event_occurs for events
6) **Realistic targets** — price targets must be achievable within the timeframe:
   - 24h/48h: within ±15% of typical current price
   - 7d: within ±25% of current price
   - 30d: within ±40% of current price
   - REJECT questions like "Will XRP reach $8?" when XRP trades at $2-3 (that's a 3x move)
   - REJECT questions requiring all-time-high breaks in 24h unless the asset is already near ATH
7) **Both sides attractive** — a reasonable person could argue YES or NO

Be a QUALITY GATE, not a blocker. Approve questions that are reasonable even if imperfect.
Only reject questions with clear structural problems (ambiguity, impossible targets, already-known outcomes).

Output valid JSON only — no markdown, no explanation.`;

/**
 * Agent 2 — Question Verifier
 * Validates that a prediction question is unambiguous, verifiable, and well-formed.
 */
export async function runQuestionVerifier(
  input: QuestionVerifierInput,
  config: AgentConfig
): Promise<QuestionVerifierOutput> {
  const prompt = [
    "Verify this prediction market question. Users stake real tokens on YES/NO — quality matters.",
    "",
    "Return JSON ONLY:",
    '{',
    '  "valid": true | false,',
    '  "confidence": 0.0-1.0,',
    '  "issues": ["issue1", "issue2"],',
    '  "suggestedFix": "improved question text" | null',
    '}',
    "",
    "REJECT if any of these are true:",
    "- Ambiguous (multiple interpretations possible)",
    "- Unverifiable (no public data source to check outcome)",
    "- Resolution rule mismatch (price question without price_above/below, or vice versa)",
    "- Unrealistic price target (e.g., 2x-3x move in 24h-7d, or target never reached historically)",
    "- Already known outcome (event already happened or is >95% certain)",
    "- Missing or past deadline date",
    "",
    "APPROVE if the question is:",
    "- Clear, binary, time-bound, verifiable, and the outcome has genuine uncertainty",
    "- Price targets are within realistic range for the timeframe",
    "- A reasonable trader could see themselves betting either YES or NO",
    "",
    "<prediction>",
    `<question>${input.question.slice(0, 500)}</question>`,
    `<timeframe>${input.timeframe}</timeframe>`,
    `<resolution_rule>${JSON.stringify(input.resolutionRule)}</resolution_rule>`,
    "</prediction>",
  ].join("\n");

  try {
    const result = await callAgentLLM(
      { ...config, responseFormat: "json" },
      prompt,
      SYSTEM_PROMPT,
      400
    );

    // Strip markdown code blocks if present (```json ... ```)
    let jsonContent = result.content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonContent) as Partial<QuestionVerifierOutput>;

    return {
      valid: typeof parsed.valid === "boolean" ? parsed.valid : false,
      confidence: typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.filter((i): i is string => typeof i === "string").slice(0, 10)
        : [],
      suggestedFix: typeof parsed.suggestedFix === "string" ? parsed.suggestedFix.slice(0, 500) : undefined,
    };
  } catch {
    // Fail closed — if verifier errors, reject the question
    return {
      valid: false,
      confidence: 0,
      issues: ["verifier_error: LLM call failed"],
    };
  }
}
