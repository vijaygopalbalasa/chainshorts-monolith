import { callAgentLLM, type AgentConfig } from "@chainshorts/shared";

export interface DuplicateCheckerInput {
  candidateQuestion: string;
  existingQuestions: string[];
}

export interface DuplicateCheckerOutput {
  isDuplicate: boolean;
  duplicateOf: string | null;
  similarity: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a duplicate detection system for a prediction market.
Your job is to determine if a new prediction question is semantically duplicate of existing ones.

Two questions are duplicates if they:
1. Ask about the same underlying event/outcome
2. Have the same or overlapping timeframes
3. Would resolve the same way given the same facts

Questions are NOT duplicates if:
1. Different tokens/projects (Bitcoin vs Ethereum)
2. Different price targets ($100K vs $90K)
3. Different events (listing vs delisting)
4. Different timeframes with no overlap

Be strict: prefer allowing unique questions over false positives.
Output valid JSON only.`;

export async function runDuplicateChecker(
  input: DuplicateCheckerInput,
  config: AgentConfig
): Promise<DuplicateCheckerOutput> {
  if (input.existingQuestions.length === 0) {
    return {
      isDuplicate: false,
      duplicateOf: null,
      similarity: 0,
      reasoning: "No existing questions to compare against",
    };
  }

  const existingList = input.existingQuestions
    .slice(0, 15)
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");

  const prompt = `Check if this candidate prediction question duplicates any existing active questions.

Return JSON:
{
  "isDuplicate": boolean,
  "duplicateOf": "exact matching question text" | null,
  "similarity": 0.0-1.0,
  "reasoning": "why this is or isn't a duplicate"
}

Candidate Question:
"${input.candidateQuestion}"

Existing Active Questions:
${existingList}

Rules:
- isDuplicate=true only if questions would resolve identically
- duplicateOf should be the EXACT text of the matching question (copy from list above)
- similarity: 0=completely different, 0.5=related topic, 0.8=very similar, 1.0=exact duplicate
- Be conservative: when in doubt, mark isDuplicate=false

Examples of duplicates:
- "Will BTC reach $100K?" and "Will Bitcoin hit $100,000?" → DUPLICATE (same event)
- "Will ETH drop below $2000 by Friday?" and "Will Ethereum fall under $2K this week?" → DUPLICATE (same event)

Examples of NON-duplicates:
- "Will BTC reach $100K?" and "Will BTC drop below $90K?" → NOT DUPLICATE (opposite directions)
- "Will ETH 2.0 launch in Q1?" and "Will Solana launch Firedancer in Q1?" → NOT DUPLICATE (different projects)
- "Will SEC approve Bitcoin ETF?" and "Will SEC approve Ethereum ETF?" → NOT DUPLICATE (different assets)`;

  const result = await callAgentLLM(
    { ...config, responseFormat: "json", timeoutMs: 25000 },
    prompt,
    SYSTEM_PROMPT,
    400
  );

  let jsonContent = result.content.trim();
  if (jsonContent.startsWith("```")) {
    jsonContent = jsonContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(jsonContent) as Partial<DuplicateCheckerOutput>;

  return {
    isDuplicate: parsed.isDuplicate === true,
    duplicateOf: typeof parsed.duplicateOf === "string" ? parsed.duplicateOf : null,
    similarity: typeof parsed.similarity === "number"
      ? Math.max(0, Math.min(1, parsed.similarity))
      : 0,
    reasoning: typeof parsed.reasoning === "string"
      ? parsed.reasoning.slice(0, 500)
      : "",
  };
}
