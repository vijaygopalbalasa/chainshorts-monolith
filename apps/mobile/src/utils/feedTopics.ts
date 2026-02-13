import type { FeedCard } from "@chainshorts/shared";

export const FEED_TOPIC_ORDER = [
  "all",
  "markets",
  "defi",
  "infrastructure",
  "security",
  "policy",
  "layer2",
  "gaming",
  "ai",
  "solana",
  "ethereum",
  "bitcoin",
  "nft"
] as const;

export type FeedTopic = (typeof FEED_TOPIC_ORDER)[number];

export const FEED_TOPIC_LABELS: Record<FeedTopic, string> = {
  all: "All",
  markets: "Markets",
  defi: "DeFi",
  infrastructure: "Infra",
  security: "Security",
  policy: "Policy",
  layer2: "Layer 2",
  gaming: "Gaming",
  ai: "AI",
  solana: "Solana",
  ethereum: "Ethereum",
  bitcoin: "Bitcoin",
  nft: "NFT"
};

const TOPIC_KEYWORDS: Array<{ topic: Exclude<FeedTopic, "all">; keywords: string[] }> = [
  { topic: "security", keywords: ["security", "hack", "exploit", "breach", "drain", "attack", "scam"] },
  { topic: "policy", keywords: ["regulation", "policy", "sec", "cftc", "compliance", "ban", "law"] },
  // Specific chains checked BEFORE generic topics to avoid "model"/"agent" false-matching AI
  { topic: "bitcoin", keywords: ["bitcoin", "btc"] },
  { topic: "ethereum", keywords: ["ethereum", "eth"] },
  { topic: "solana", keywords: ["solana", "sol"] },
  { topic: "defi", keywords: ["defi", "dex", "amm", "yield", "staking", "lending", "liquidity"] },
  { topic: "nft", keywords: ["nft", "collectible", "opensea"] },
  { topic: "layer2", keywords: ["layer 2", "layer2", "l2", "rollup", "arbitrum", "optimism", "base", "zksync"] },
  { topic: "infrastructure", keywords: ["infrastructure", "bridge", "node", "indexer", "rpc", "validator"] },
  { topic: "gaming", keywords: ["gaming", "gamefi", "metaverse", "esports"] },
  // AI keywords: avoid bare "ai" (matches "chain"/"blockchain" as substring), use specific phrases
  { topic: "ai", keywords: ["artificial intelligence", "machine learning", "llm", "inference", "generative ai", "openai", "chatgpt"] },
  { topic: "markets", keywords: ["market", "price", "rally", "dump", "etf", "macro", "trading", "token"] }
];

function includesAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((keyword) => haystack.includes(keyword));
}

export function resolveFeedTopic(card: Pick<FeedCard, "category" | "headline" | "summary60" | "tokenContext">): Exclude<FeedTopic, "all"> {
  const category = (card.category ?? "").toLowerCase().trim();
  const symbol = card.tokenContext?.symbol?.toLowerCase().trim() ?? "";
  const haystack = `${category} ${card.headline} ${card.summary60} ${symbol}`.toLowerCase();

  if (category.includes("regulation") || category.includes("policy")) return "policy";
  if (category.includes("security") || category.includes("threat")) return "security";
  if (category.includes("defi")) return "defi";
  if (category.includes("nft")) return "nft";
  if (category.includes("solana")) return "solana";
  if (category.includes("ethereum")) return "ethereum";
  if (category.includes("bitcoin")) return "bitcoin";
  if (category.includes("layer2") || category.includes("layer 2")) return "layer2";
  if (category.includes("infrastructure")) return "infrastructure";
  if (category.includes("gaming")) return "gaming";
  if (category.includes("ai")) return "ai";
  if (category.includes("market")) return "markets";

  for (const { topic, keywords } of TOPIC_KEYWORDS) {
    if (includesAny(haystack, keywords)) {
      return topic;
    }
  }

  return "markets";
}
