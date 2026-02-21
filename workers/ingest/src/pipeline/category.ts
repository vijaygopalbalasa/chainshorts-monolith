export type FeedCategory =
  | "web3"
  | "solana"
  | "defi"
  | "nft"
  | "security"
  | "regulation"
  | "bitcoin"
  | "ethereum"
  | "layer2"
  | "markets"
  | "gaming"
  | "ai";

const CATEGORY_PATTERNS: Record<Exclude<FeedCategory, "web3">, RegExp[]> = {
  // Evaluated in priority order (security first, then chain-specific, then generic)
  security: [
    /\bhack(?:ed|ing)?\b/i,
    /\bexploit(?:ed|s)?\b/i,
    /\bvulnerabilit(?:y|ies)\b/i,
    /\bphishing\b/i,
    /\bscam(?:s)?\b/i,
    /\bbreach(?:es)?\b/i,
    /\bdrain(?:ed|ing)?\b/i,
    /\battack(?:ed|s)?\b/i,
    /\bincident(?:s)?\b/i,
    /\bsecurity\b/i
  ],
  regulation: [
    /\bregulat(?:ion|ory|or)\b/i,
    /\bsec\b/i,
    /\bcftc\b/i,
    /\bdoj\b/i,
    /\bcompliance\b/i,
    /\bpolicy\b/i,
    /\blawsuit(?:s)?\b/i,
    /\bcourt\b/i,
    /\blegislation\b/i,
    /\betf(?:s)?\b/i,
    /\bmi(?:ca|fid)\b/i
  ],
  bitcoin: [
    /\bbitcoin\b/i,
    /\b(?:^|\s)btc(?:\s|$)/i,
    /\bsatoshi\b/i,
    /\blightning network\b/i,
    /\btaproot\b/i
  ],
  ethereum: [
    /\bethereum\b/i,
    /\b(?:^|\s)eth(?:\s|$)/i,
    /\bvitalik\b/i,
    /\bpectra\b/i,
    /\bcancun\b/i
  ],
  layer2: [
    /\blayer.?2\b/i,
    /\bl2\b/i,
    /\brollup(?:s)?\b/i,
    /\barbitrum\b/i,
    /\boptimism\b/i,
    /\bbase\b.*\bchain\b/i,
    /\bzksync\b/i,
    /\bpolygon\b/i,
    /\bstarknet\b/i,
    /\blinea\b/i,
    /\bscroll\b.*\bchain\b/i
  ],
  solana: [
    /\bsolana\b/i,
    /\bseeker\b/i,
    /\bsaga\b/i,
    /\bjupiter\b.*\bdex\b/i,
    /\braydium\b/i,
    /\borca\b/i,
    /\bpyth\b/i,
    /\bmetaplex\b/i,
    /\bmarinade\b/i,
    /\bhelium\b/i
  ],
  defi: [
    /\bdefi\b/i,
    /\bdex\b/i,
    /\bamm\b/i,
    /\bliquidity\b/i,
    /\byield\b/i,
    /\bstaking\b/i,
    /\blending\b/i,
    /\bborrow(?:ing)?\b/i,
    /\bperp(?:s)?\b/i,
    /\bderivative(?:s)?\b/i,
    /\bstablecoin(?:s)?\b/i,
    /\bswap(?:s|ping)?\b/i
  ],
  nft: [
    /\bnft(?:s)?\b/i,
    /\bcollectible(?:s)?\b/i,
    /\bdigital art\b/i,
    /\btokenized art\b/i
  ],
  gaming: [
    /\bgaming\b/i,
    /\bgamefi\b/i,
    /\bmetaverse\b/i,
    /\besports\b/i,
    /\bplay.?to.?earn\b/i
  ],
  // AI patterns: use specific phrases to avoid "chain"/"blockchain" false matches
  ai: [
    /\bartificial intelligence\b/i,
    /\bmachine learning\b/i,
    /\b(?:llm|large language model)\b/i,
    /\bgenerative ai\b/i,
    /\bopenai\b/i,
    /\bchatgpt\b/i,
    /\bai.?agent(?:s)?\b/i,
    /\bai.?model(?:s)?\b/i
  ],
  markets: [
    /\b(?:price|prices)\b/i,
    /\brally\b/i,
    /\bbull\b.*\bmarket\b/i,
    /\bbear\b.*\bmarket\b/i,
    /\btrading\b/i,
    /\bmarket\b.*\b(?:cap|move|surge|drop|crash|pump|dump)\b/i
  ]
};

// Priority order: check most-specific/critical categories first
const PRIORITY_ORDER: Array<Exclude<FeedCategory, "web3">> = [
  "security",
  "regulation",
  "bitcoin",
  "ethereum",
  "layer2",
  "solana",
  "defi",
  "nft",
  "gaming",
  "ai",
  "markets"
];

export function classifyCategory(input: {
  sourceName: string;
  headline: string;
  body?: string;
  sourceLanguage?: string;
}): FeedCategory {
  const source = input.sourceName.toLowerCase();
  const text = `${input.headline}\n${input.body ?? ""}`;

  for (const category of PRIORITY_ORDER) {
    const patterns = CATEGORY_PATTERNS[category];
    if (patterns.some((pattern) => pattern.test(text))) {
      return category;
    }
  }

  if (source.includes("solana")) {
    return "solana";
  }
  if (source.includes("bitcoin")) {
    return "bitcoin";
  }

  return "web3";
}
