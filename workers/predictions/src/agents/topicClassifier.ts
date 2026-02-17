import { callAgentLLM, type AgentConfig } from "@chainshorts/shared";

export interface TopicClassifierInput {
  headline: string;
  summary60: string;
  category: string;
  articleId: string;
}

export type PredictionTopic =
  | "price_movement"      // Token price predictions
  | "regulatory"          // Government/legal actions
  | "product_launch"      // Protocol/feature releases
  | "partnership"         // Business deals, integrations
  | "security_incident"   // Hacks, exploits, vulnerabilities
  | "market_event"        // Listings, delistings, liquidations
  | "not_predictable";    // News without clear prediction angle

export interface TopicClassifierOutput {
  isPredictionWorthy: boolean;
  topic: PredictionTopic;
  confidence: number;
  reasoning: string;
  suggestedTimeframe: "24h" | "48h" | "7d" | "30d" | null;
}

const SYSTEM_PROMPT = `You are a prediction market classifier for a crypto news platform.
Your job is to determine if a news article has a clear, verifiable prediction angle.

A prediction-worthy article must have:
1. A specific event or outcome that can be verified
2. A reasonable timeframe for resolution (24h to 30 days)
3. Genuine uncertainty (not already resolved or trivially obvious)
4. Relevance to crypto/Web3 ecosystem

NOT prediction-worthy:
- General market commentary without specific claims
- Historical news (already happened)
- Opinion pieces without verifiable outcomes
- Trivial or obvious statements
- Non-crypto topics disguised as crypto news

Output valid JSON only.`;

export async function runTopicClassifier(
  input: TopicClassifierInput,
  config: AgentConfig
): Promise<TopicClassifierOutput> {
  const prompt = `Classify this crypto news article for prediction market potential.

Return JSON:
{
  "isPredictionWorthy": boolean,
  "topic": "price_movement" | "regulatory" | "product_launch" | "partnership" | "security_incident" | "market_event" | "not_predictable",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "suggestedTimeframe": "24h" | "48h" | "7d" | "30d" | null
}

Guidelines:
- price_movement: Specific price targets, support/resistance levels, ATH/ATL predictions
- regulatory: SEC actions, country bans, compliance deadlines, legal rulings
- product_launch: Mainnet launches, upgrades, feature releases with dates
- partnership: Confirmed or rumored integrations, business deals
- security_incident: Active exploits, vulnerability disclosures, recovery efforts
- market_event: Exchange listings, token burns, unlocks, airdrops with dates
- not_predictable: Everything else

Set isPredictionWorthy=false if:
- The event already happened
- No clear binary outcome possible
- Timeframe is unclear or >30 days
- Topic is not genuinely crypto-related

<article>
<category>${input.category}</category>
<headline>${input.headline.slice(0, 300)}</headline>
<summary>${input.summary60.slice(0, 400)}</summary>
</article>`;

  const result = await callAgentLLM(
    { ...config, responseFormat: "json", timeoutMs: 20000 },
    prompt,
    SYSTEM_PROMPT,
    400
  );

  let jsonContent = result.content.trim();
  if (jsonContent.startsWith("```")) {
    jsonContent = jsonContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(jsonContent) as Partial<TopicClassifierOutput>;

  const validTopics: PredictionTopic[] = [
    "price_movement", "regulatory", "product_launch", "partnership",
    "security_incident", "market_event", "not_predictable"
  ];

  const topic = validTopics.includes(parsed.topic as PredictionTopic)
    ? (parsed.topic as PredictionTopic)
    : "not_predictable";

  const validTimeframes = ["24h", "48h", "7d", "30d"] as const;
  const timeframe = validTimeframes.includes(parsed.suggestedTimeframe as typeof validTimeframes[number])
    ? (parsed.suggestedTimeframe as typeof validTimeframes[number])
    : null;

  return {
    isPredictionWorthy: parsed.isPredictionWorthy === true,
    topic,
    confidence: typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5,
    reasoning: typeof parsed.reasoning === "string"
      ? parsed.reasoning.slice(0, 500)
      : "",
    suggestedTimeframe: timeframe,
  };
}
