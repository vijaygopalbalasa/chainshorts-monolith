import { callAgentLLM, type AgentConfig } from "@chainshorts/shared";
import type { PredictionTopic } from "./topicClassifier.js";
import { fetchLivePrices, formatPriceContext } from "./priceContext.js";

export interface BatchArticleInput {
  index: number;
  headline: string;
  summary60: string;
  category: string;
}

export interface BatchPredictionResult {
  index: number;
  isPredictionWorthy: boolean;
  topic: PredictionTopic;
  topicConfidence: number;
  question: string | null;
  questionConfidence: number;
  /** Number of days until deadline (1-30). Replaces rigid 24h/48h/7d/30d buckets. */
  deadlineDays: number | null;
  resolutionRule: {
    kind: "price_above" | "price_below" | "event_occurs";
    symbol?: string;
    target?: number;
  } | null;
  skipReason: string | null;
}

function getCurrentDateContext(): string {
  const now = new Date();
  const year = now.getFullYear();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };
  const formatted = now.toLocaleDateString('en-US', options);
  const isoDate = now.toISOString().split('T')[0];
  return `
╔══════════════════════════════════════════════════════════════╗
║  CURRENT DATE: ${formatted}                    ║
║  ISO: ${isoDate}                                             ║
║  YEAR: ${year} (NOT 2024, NOT 2023, NOT 2025 - IT IS ${year})  ║
╚══════════════════════════════════════════════════════════════╝`;
}

function getSystemPrompt(livePriceBlock: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return `You are a prediction market maker for Chainshorts, a crypto news app where users stake SKR tokens on YES/NO outcomes.

${getCurrentDateContext()}

## WHAT MAKES A GOOD PREDICTION MARKET

A prediction market is NOT a trivia question. It is a TRADEABLE bet where real users stake tokens.
A great market has these qualities:
1. **Genuine uncertainty** — roughly 30-70% chance of YES. If the answer is >90% obvious, nobody bets the other side.
2. **Both sides attractive** — a bull AND a bear can each feel confident staking. "Will BTC hit $1M tomorrow?" is terrible (99.9% NO).
3. **Clear resolution** — anyone can verify the outcome from public data (price feeds, on-chain data, official announcements).
4. **User engagement** — the topic should matter to crypto traders/enthusiasts. People stake on things they care about.
5. **Timely** — tied to current news, not hypothetical future scenarios disconnected from today.

## CRITICAL: PRICE TARGET RULES

For price predictions, targets MUST be realistic and achievable within the timeframe:
- **24h/48h**: Target within ±5-15% of current price.
- **7d**: Target within ±10-25% of current price.
- **30d**: Target within ±15-40% of current price.
- NEVER set a target above the all-time high (ATH) for timeframes under 30d.
- NEVER set a target that requires 2x+ move for any timeframe.
- Use ROUND numbers traders think about: $100K, $50K, $3K, $200, $1, $0.50 — not arbitrary numbers.

${livePriceBlock}

⚠️ CRITICAL DATE RULES ⚠️
- The current year is ${year}. USE ${year} IN ALL DATES. NEVER use 2024 or 2025.
- Example correct dates: "${formatDate(tomorrow)}", "${formatDate(nextWeek)}", "${formatDate(nextMonth)}"

## CLASSIFICATION TOPICS
- price_movement: Token price predictions with REALISTIC targets based on live prices above
- regulatory: Government/legal actions, SEC decisions, legislation
- product_launch: Protocol releases, mainnet launches, upgrades
- partnership: Business deals, integrations, collaborations
- security_incident: Hacks, exploits, fund recovery
- market_event: Exchange listings, token burns, airdrops, ETF flows
- not_predictable: No clear prediction angle (use sparingly — most crypto news HAS a prediction angle)

## QUESTION REQUIREMENTS
1. Binary YES/NO answer only
2. Time-bound with FUTURE deadline in year ${year}
3. Verifiable from public sources
4. Genuine uncertainty (30-70% implied probability ideal)
5. Would attract stakers on BOTH sides

## BE GENEROUS — CREATE MORE MARKETS
- Most crypto news has at least one prediction angle. Try hard to find it.
- Regulatory news → "Will [bill/ruling] pass/be approved by [date]?"
- Product news → "Will [protocol] launch [feature] by [date]?"
- Market news → "Will [token] stay above/reach [realistic target] by [date]?"
- Security news → "Will [protocol] recover [X]% of stolen funds by [date]?"
- Partnership news → "Will [integration] go live by [date]?"
- Mark "not_predictable" ONLY if the article is purely historical/educational with zero forward-looking angle.

## DEADLINE — PICK THE RIGHT NUMBER OF DAYS (1-60)

Set "deadlineDays" to the number of days that naturally fits the question. DO NOT always pick 7 or 30.

Guidelines:
- Price volatility questions (short-term moves): 1-3 days
- Exchange listings, delistings: 3-7 days
- Product launches with announced dates: match the actual date (1-21 days)
- Regulatory votes/hearings with known schedule: match the actual date
- Broader market trends: 7-14 days
- Legislation, protocol upgrades, long-term events: 14-60 days
- Each question should have a DIFFERENT deadline based on its own natural timeline
- MAXIMUM is 60 days — for events beyond 60 days, use event_occurs with a 30-day checkpoint

Example: Today is ${formatDate(now)}.
- deadlineDays: 2 → deadline ${formatDate(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000))}
- deadlineDays: 5 → deadline ${formatDate(new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000))}
- deadlineDays: 12 → deadline ${formatDate(new Date(now.getTime() + 12 * 24 * 60 * 60 * 1000))}
- deadlineDays: 21 → deadline ${formatDate(new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000))}

The date in the question text should match deadlineDays. For example, if deadlineDays=5, the question should say "by ${formatDate(new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000))}".

Output ONLY valid JSON array. No markdown, no explanation.`;
}

function buildBatchPrompt(articles: BatchArticleInput[], existingQuestions: string[]): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Calculate example future dates for guidance
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const existingList = existingQuestions.length > 0
    ? `\nAVOID DUPLICATES - Active predictions:\n${existingQuestions.slice(0, 10).map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`
    : "";

  const items = articles.map((a) =>
    `<article index="${a.index}">
<category>${a.category}</category>
<headline>${a.headline.slice(0, 200)}</headline>
<summary>${a.summary60.slice(0, 400)}</summary>
</article>`
  ).join("\n\n");

  const day3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const day10 = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
  const day18 = new Date(now.getTime() + 18 * 24 * 60 * 60 * 1000);

  return `Today is ${formatDate(now)} (${dateStr}). All deadlines must be FUTURE dates in ${now.getFullYear()}.

Analyze these ${articles.length} crypto news articles. For EACH article, generate a prediction market if possible.
Aim to create markets for at least 60-70% of articles — most crypto news has a prediction angle.

Return JSON array with one object per article:
{
  "index": 0,
  "isPredictionWorthy": true|false,
  "topic": "price_movement"|"regulatory"|"product_launch"|"partnership"|"security_incident"|"market_event"|"not_predictable",
  "topicConfidence": 0.0-1.0,
  "question": "Will X happen by [DATE in ${now.getFullYear()}]?" | null,
  "questionConfidence": 0.0-1.0,
  "deadlineDays": 1-60,
  "resolutionRule": {"kind":"price_above"|"price_below"|"event_occurs","symbol":"bitcoin"|null,"target":number|null} | null,
  "skipReason": "reason" | null
}

DEADLINE EXAMPLES (vary these — do NOT always use 7 or 30):
- deadlineDays: 2 → "by ${formatDate(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000))}"
- deadlineDays: 3 → "by ${formatDate(day3)}"
- deadlineDays: 10 → "by ${formatDate(day10)}"
- deadlineDays: 18 → "by ${formatDate(day18)}"

GOOD market examples:
- "Will Bitcoin stay above $85,000 by ${formatDate(day3)}?" → deadlineDays: 3, price_above, symbol: "bitcoin", target: 85000
- "Will the STABLE Act pass committee vote by ${formatDate(day18)}?" → deadlineDays: 18, event_occurs
- "Will Ethereum's Pectra upgrade launch by ${formatDate(day10)}?" → deadlineDays: 10, event_occurs
- "Will SOL reclaim $150 by ${formatDate(new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000))}?" → deadlineDays: 5, price_above

BAD market examples (DO NOT create these):
- "Will XRP reach $8?" → ABSURD, XRP hasn't even reached $4 in years
- "Will BTC hit $1,000,000 by tomorrow?" → unrealistic timeframe
- "Will crypto exist in 2030?" → not time-bound, not tradeable
- "Did Satoshi create Bitcoin?" → historical fact, not a prediction

PRICE TARGET REMINDER: Use targets near current price. ±15% for 1-3 days, ±25% for 4-14 days, ±40% for 15-30 days. When unsure of current price, use event_occurs instead.
${existingList}
${items}`;
}

/**
 * Batch Classification + Question Generation
 *
 * Processes 5-10 articles in a SINGLE LLM call, combining:
 * - Stage 1: Topic Classification (is it prediction-worthy?)
 * - Stage 2: Question Generation (create binary question)
 *
 * This reduces API calls by 80% compared to per-article processing.
 *
 * Cost analysis:
 * - Old: 2 LLM calls per article (classify + generate)
 * - New: 1 LLM call per 5-10 articles
 */
export async function runBatchClassifyGenerate(
  articles: BatchArticleInput[],
  existingQuestions: string[],
  config: AgentConfig
): Promise<BatchPredictionResult[]> {
  if (articles.length === 0) return [];

  const batch = articles.slice(0, 10);

  // Fetch live prices from CoinGecko (cached 5min, free API)
  const livePrices = await fetchLivePrices();
  const priceBlock = formatPriceContext(livePrices);

  // eslint-disable-next-line no-console
  console.log(`[batchClassify] Sending ${batch.length} articles to LLM (model: ${config.model})`);

  const result = await callAgentLLM(
    { ...config, responseFormat: "json", timeoutMs: 45_000, temperature: 0.4 },
    buildBatchPrompt(batch, existingQuestions),
    getSystemPrompt(priceBlock),
    2500
  );

  // eslint-disable-next-line no-console
  console.log(`[batchClassify] LLM response length: ${result.content.length} chars`);

  const parsed = parseJsonResponse(result.content);

  // eslint-disable-next-line no-console
  console.log(`[batchClassify] Parsed ${parsed.length} results from LLM response`);

  const validTopics: PredictionTopic[] = [
    "price_movement", "regulatory", "product_launch", "partnership",
    "security_incident", "market_event", "not_predictable"
  ];

  const validKinds = ["price_above", "price_below", "event_occurs"] as const;

  const resultByIndex = new Map<number, BatchPredictionResult>();

  for (const item of parsed) {
    const obj = item as Record<string, unknown>;
    const index = typeof obj.index === "number" ? obj.index : -1;

    if (index < 0 || index >= batch.length) continue;

    const topic = validTopics.includes(obj.topic as PredictionTopic)
      ? (obj.topic as PredictionTopic)
      : "not_predictable";

    // Parse deadlineDays (1-60), with fallback from legacy timeframe field
    let deadlineDays: number | null = null;
    if (typeof obj.deadlineDays === "number" && obj.deadlineDays >= 1 && obj.deadlineDays <= 60) {
      deadlineDays = Math.round(obj.deadlineDays);
    } else if (typeof obj.timeframe === "string") {
      // Backward compat: convert legacy "24h"/"48h"/"7d"/"30d" to days
      const legacy: Record<string, number> = { "24h": 1, "48h": 2, "7d": 7, "30d": 30 };
      deadlineDays = legacy[obj.timeframe] ?? null;
    }

    let resolutionRule: BatchPredictionResult["resolutionRule"] = null;
    if (obj.resolutionRule && typeof obj.resolutionRule === "object") {
      const rule = obj.resolutionRule as Record<string, unknown>;
      const kind = validKinds.includes(rule.kind as typeof validKinds[number])
        ? (rule.kind as typeof validKinds[number])
        : "event_occurs";
      resolutionRule = {
        kind,
        symbol: typeof rule.symbol === "string" ? rule.symbol : undefined,
        target: typeof rule.target === "number" ? rule.target : undefined,
      };
    }

    // Extract and validate question
    let question: string | null = typeof obj.question === "string" && obj.question.length > 0
      ? obj.question.slice(0, 500)
      : null;

    // POST-PROCESSING: Reject questions with wrong years
    const currentYear = new Date().getFullYear();
    const wrongYears = ["2020", "2021", "2022", "2023", "2024", "2025"].filter(y => parseInt(y) !== currentYear);

    if (question) {
      const hasWrongYear = wrongYears.some(y => question!.includes(y));
      if (hasWrongYear) {
        // Try to fix by replacing wrong year with current year
        let fixedQuestion = question;
        for (const wrongYear of wrongYears) {
          fixedQuestion = fixedQuestion.replace(new RegExp(wrongYear, 'g'), String(currentYear));
        }
        question = fixedQuestion;
      }
    }

    resultByIndex.set(index, {
      index,
      isPredictionWorthy: obj.isPredictionWorthy === true,
      topic,
      topicConfidence: typeof obj.topicConfidence === "number"
        ? Math.max(0, Math.min(1, obj.topicConfidence))
        : 0.5,
      question,
      questionConfidence: typeof obj.questionConfidence === "number"
        ? Math.max(0, Math.min(1, obj.questionConfidence))
        : 0.5,
      deadlineDays,
      resolutionRule,
      skipReason: typeof obj.skipReason === "string" ? obj.skipReason : null,
    });
  }

  const finalResults = batch.map((article, i) => {
    const cached = resultByIndex.get(i);
    if (cached) return cached;

    return {
      index: i,
      isPredictionWorthy: false,
      topic: "not_predictable" as const,
      topicConfidence: 0,
      question: null,
      questionConfidence: 0,
      deadlineDays: null,
      resolutionRule: null,
      skipReason: "missing_from_llm_response",
    };
  });

  // Log each result for debugging
  for (const r of finalResults) {
    const article = batch[r.index];
    // eslint-disable-next-line no-console
    console.log(
      `[batchClassify] [${r.index}] worthy=${r.isPredictionWorthy} topic=${r.topic} ` +
      `q="${r.question?.slice(0, 60) ?? "null"}" skip="${r.skipReason ?? "none"}" ` +
      `headline="${article?.headline.slice(0, 50) ?? "?"}"`
    );
  }

  return finalResults;
}

function parseJsonResponse(content: string): unknown[] {
  let cleaned = content.trim();

  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.results && Array.isArray(parsed.results)) return parsed.results;
    if (parsed.articles && Array.isArray(parsed.articles)) return parsed.articles;
  } catch {
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // Fall through
      }
    }
  }

  return [];
}
