import { canonicalizeUrl } from "./url.js";

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeHeadline(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "after",
  "amid",
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "data",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "report",
  "that",
  "the",
  "to",
  "with"
]);

const TOKEN_MAP: Record<string, string> = {
  fed: "federalreserve",
  federal: "federalreserve",
  reserve: "federalreserve",
  rates: "rate",
  hikes: "raise",
  hiked: "raise",
  raises: "raise",
  raised: "raise",
  rising: "raise",
  increase: "raise",
  increased: "raise",
  increases: "raise",
  interest: "rate"
};

function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }
  if (token.length > 4 && token.endsWith("es")) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function normalizeClusterTokens(headline: string): string[] {
  const normalized = normalizeHeadline(headline);
  const rawTokens = normalized.split(" ").filter(Boolean);
  const canonicalTokens: string[] = [];

  for (const token of rawTokens) {
    if (STOP_WORDS.has(token)) {
      continue;
    }

    const mapped = TOKEN_MAP[token] ?? token;
    const stemmed = TOKEN_MAP[mapped] ?? stemToken(mapped);
    if (stemmed.length < 3) {
      continue;
    }
    canonicalTokens.push(stemmed);
  }

  return [...new Set(canonicalTokens)].sort();
}

export function computeDedupHash(headline: string, url: string): string {
  const normalizedHeadline = normalizeHeadline(headline);
  const canonicalUrl = canonicalizeUrl(url);
  return stableHash(`${normalizedHeadline}|${canonicalUrl}`);
}

export function computeClusterId(headline: string): string {
  const tokens = normalizeClusterTokens(headline);
  const fingerprint = tokens.length ? tokens.join("|") : normalizeHeadline(headline);
  return `cluster_${stableHash(fingerprint)}`;
}
