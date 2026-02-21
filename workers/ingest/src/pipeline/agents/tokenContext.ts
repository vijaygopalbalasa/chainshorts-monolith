interface TokenMapping {
  symbol: string;
  coingeckoId: string;
  aliases: string[];
}

const TOKEN_MAP: TokenMapping[] = [
  { symbol: "SOL", coingeckoId: "solana", aliases: ["sol", "solana"] },
  { symbol: "BTC", coingeckoId: "bitcoin", aliases: ["btc", "bitcoin"] },
  { symbol: "ETH", coingeckoId: "ethereum", aliases: ["eth", "ethereum"] },
  { symbol: "USDC", coingeckoId: "usd-coin", aliases: ["usdc"] },
  { symbol: "JUP", coingeckoId: "jupiter-exchange-solana", aliases: ["jup", "jupiter"] }
];

interface CachedQuote {
  expiresAt: number;
  payload: {
    symbol: string;
    priceUsd?: number;
    change1hPct?: number;
    marketCapUsd?: number;
  };
}

const quoteCache = new Map<string, CachedQuote>();

function findToken(headline: string, category: string): TokenMapping | undefined {
  const haystack = `${headline} ${category}`.toLowerCase();
  return TOKEN_MAP.find((entry) =>
    entry.aliases.some((alias) => new RegExp(`(^|\\W)${alias}(\\W|$)`, "i").test(haystack))
  );
}

const ALLOWED_COINGECKO_HOSTS = ["api.coingecko.com", "pro-api.coingecko.com"];

function validateCoinGeckoBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("CoinGecko base URL must use HTTPS");
    if (!ALLOWED_COINGECKO_HOSTS.includes(parsed.hostname)) {
      throw new Error(`CoinGecko base URL host not in allowlist: ${parsed.hostname}`);
    }
    return url.replace(/\/+$/, "");
  } catch (err) {
    throw new Error(`Invalid COINGECKO_BASE_URL: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function fetchFromCoinGecko(coingeckoId: string): Promise<{
  priceUsd?: number;
  change1hPct?: number;
  marketCapUsd?: number;
}> {
  const rawBase = process.env.COINGECKO_BASE_URL?.trim() || "https://api.coingecko.com/api/v3";
  const baseUrl = validateCoinGeckoBaseUrl(rawBase);
  const url = `${baseUrl}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(
    coingeckoId
  )}&price_change_percentage=1h`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    return {};
  }
  const rows = (await response.json()) as Array<{
    current_price?: number;
    price_change_percentage_1h_in_currency?: number;
    market_cap?: number;
  }>;
  const row = rows[0];
  if (!row) {
    return {};
  }
  return {
    priceUsd: typeof row.current_price === "number" ? row.current_price : undefined,
    change1hPct:
      typeof row.price_change_percentage_1h_in_currency === "number"
        ? row.price_change_percentage_1h_in_currency
        : undefined,
    marketCapUsd: typeof row.market_cap === "number" ? row.market_cap : undefined
  };
}

export async function deriveTokenContext(input: {
  headline: string;
  category: string;
}): Promise<{
  symbol: string;
  priceUsd?: number;
  change1hPct?: number;
  marketCapUsd?: number;
} | undefined> {
  const token = findToken(input.headline, input.category);
  if (!token) {
    return undefined;
  }

  const cached = quoteCache.get(token.coingeckoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const market = await fetchFromCoinGecko(token.coingeckoId);
  const payload = {
    symbol: token.symbol,
    priceUsd: market.priceUsd,
    change1hPct: market.change1hPct,
    marketCapUsd: market.marketCapUsd
  };

  quoteCache.set(token.coingeckoId, {
    expiresAt: Date.now() + 60 * 1000,
    payload
  });

  return payload;
}
