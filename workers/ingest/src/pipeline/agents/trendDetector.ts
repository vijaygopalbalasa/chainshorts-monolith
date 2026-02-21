import type { IngestStore } from "../../store.js";

export interface TrendDetectionInput {
  clusterId: string;
  headline: string;
  category: string;
}

export interface TrendDetectionConfig {
  minimumSources: number;
  windowMinutes: number;
}

export interface TrendDetectionResult {
  trending: boolean;
  sourceCount: number;
  articleCount: number;
}

export interface OpinionDraft {
  id: string;
  question: string;
  articleContext: string;
  deadlineAt: string;
  resolutionRule?: unknown;
}

const DEFAULT_CONFIG: TrendDetectionConfig = {
  minimumSources: 3,
  windowMinutes: 15
};

const PRICE_RULE_TOKEN_MAP: Record<string, string> = {
  bitcoin: "bitcoin",
  btc: "bitcoin",
  ethereum: "ethereum",
  eth: "ethereum",
  solana: "solana",
  sol: "solana"
};

function clampWordLimit(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text;
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export async function detectTrendingEarly(
  store: IngestStore,
  input: TrendDetectionInput,
  config: Partial<TrendDetectionConfig> = {}
): Promise<TrendDetectionResult> {
  const merged = {
    ...DEFAULT_CONFIG,
    ...config
  };
  const spread = await store.getClusterSourceSpread(input.clusterId, merged.windowMinutes);
  return {
    trending: spread.sourceCount >= merged.minimumSources,
    sourceCount: spread.sourceCount,
    articleCount: spread.articleCount
  };
}

export function buildAlphaSignalSummary(input: {
  headline: string;
  sourceCount: number;
  windowMinutes: number;
}): string {
  return clampWordLimit(
    `This topic is propagating unusually quickly across independent publishers. Chainshorts detected ${input.sourceCount} distinct sources covering related updates within ${input.windowMinutes} minutes, which typically signals an early momentum inflection. Validate primary project channels, liquidity behavior, and governance timelines before taking risk. This card highlights velocity, not certainty, and should be used as an early research prompt.`,
    60
  );
}

function derivePriceRule(headline: string): { kind: "price_above"; symbol: string; target: number } | undefined {
  const normalized = headline.toLowerCase();
  const matchedEntry = Object.entries(PRICE_RULE_TOKEN_MAP).find(([needle]) => normalized.includes(needle));
  if (!matchedEntry) {
    return undefined;
  }
  const symbol = matchedEntry[1];
  return {
    kind: "price_above",
    symbol,
    target: symbol === "bitcoin" ? 150000 : symbol === "ethereum" ? 6000 : 350
  };
}

export function buildOpinionDraft(input: {
  clusterId: string;
  headline: string;
  category: string;
  publishedAt: string;
}): OpinionDraft {
  const headline = input.headline.trim();
  const lowerHeadline = headline.toLowerCase();
  const deadlineDays = lowerHeadline.includes("governance") ? 10 : 7;
  const deadlineAt = new Date(Date.parse(input.publishedAt) + deadlineDays * 24 * 60 * 60 * 1000).toISOString();

  let question = `Will this story remain a high-impact narrative across Solana in the next ${deadlineDays} days?`;
  if (lowerHeadline.includes("governance")) {
    question = "Should this governance direction be approved by the community?";
  } else if (lowerHeadline.includes("exploit") || lowerHeadline.includes("hack")) {
    question = "Is the protocol response strong enough to restore confidence?";
  } else if (lowerHeadline.includes("fund") || lowerHeadline.includes("raise")) {
    question = "Will this project ship a major milestone before year-end?";
  }

  const rule = derivePriceRule(headline);

  return {
    id: `poll_${input.clusterId}`,
    question,
    articleContext: clampWordLimit(headline, 18),
    deadlineAt,
    resolutionRule: rule
  };
}
