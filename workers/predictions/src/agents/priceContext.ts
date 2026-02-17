/**
 * Live Price Context Fetcher
 *
 * Fetches current crypto prices from CoinGecko free API (no key needed)
 * and formats them for injection into prediction market prompts.
 *
 * Cache: 5 minutes (prices don't need to be real-time for question generation).
 * Rate limit: CoinGecko free tier allows 10-30 calls/min — we call once per 5min tick.
 */

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/** Top tokens tracked for prediction market context */
const TRACKED_COINS = [
  "bitcoin", "ethereum", "solana", "ripple", "binancecoin",
  "cardano", "dogecoin", "avalanche-2", "chainlink", "polkadot",
  "toncoin", "sui", "near", "pepe", "render-token",
];

/** Display symbols for prompt readability */
const DISPLAY_SYMBOLS: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  ripple: "XRP",
  binancecoin: "BNB",
  cardano: "ADA",
  dogecoin: "DOGE",
  "avalanche-2": "AVAX",
  chainlink: "LINK",
  polkadot: "DOT",
  toncoin: "TON",
  sui: "SUI",
  near: "NEAR",
  pepe: "PEPE",
  "render-token": "RENDER",
};

export interface TokenPrice {
  id: string;
  symbol: string;
  price: number;
  change24h: number;
  marketCap: number;
  ath: number;
}

interface CoinGeckoMarketItem {
  id: string;
  symbol: string;
  current_price: number;
  price_change_percentage_24h: number | null;
  market_cap: number;
  ath: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedPrices: TokenPrice[] = [];
let cacheTimestamp = 0;

/**
 * Fetch top crypto prices from CoinGecko (free, no API key).
 * Results are cached for 5 minutes.
 */
export async function fetchLivePrices(): Promise<TokenPrice[]> {
  if (Date.now() - cacheTimestamp < CACHE_TTL_MS && cachedPrices.length > 0) {
    return cachedPrices;
  }

  const ids = TRACKED_COINS.join(",");
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[priceContext] CoinGecko returned ${response.status} — using cached prices`);
      return cachedPrices;
    }

    const data = (await response.json()) as CoinGeckoMarketItem[];

    cachedPrices = data.map((coin) => ({
      id: coin.id,
      symbol: DISPLAY_SYMBOLS[coin.id] ?? coin.symbol.toUpperCase(),
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h ?? 0,
      marketCap: coin.market_cap,
      ath: coin.ath,
    }));

    cacheTimestamp = Date.now();

    // eslint-disable-next-line no-console
    console.log(`[priceContext] Fetched ${cachedPrices.length} token prices from CoinGecko`);

    return cachedPrices;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[priceContext] CoinGecko fetch failed:", error instanceof Error ? error.message : "unknown");
    return cachedPrices; // Return stale cache rather than nothing
  }
}

/**
 * Format live prices into a string block for injection into LLM prompts.
 * Includes current price, 24h change, and all-time high for realistic target setting.
 */
export function formatPriceContext(prices: TokenPrice[]): string {
  if (prices.length === 0) {
    return "LIVE PRICES: Unavailable. For price questions, use event_occurs rule instead.";
  }

  const lines = prices.map((t) => {
    const dir = t.change24h >= 0 ? "+" : "";
    const priceStr = t.price >= 1
      ? `$${t.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
      : `$${t.price.toFixed(6)}`;
    const athStr = t.ath >= 1
      ? `$${t.ath.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      : `$${t.ath.toFixed(6)}`;
    return `  ${t.symbol.padEnd(7)} ${priceStr.padStart(12)}  (${dir}${t.change24h.toFixed(1)}% 24h)  ATH: ${athStr}`;
  });

  return [
    "## LIVE PRICES (from CoinGecko, updated within last 5 minutes)",
    "Use these EXACT prices for setting realistic targets. NEVER guess prices.",
    ...lines,
    "",
    "RULES: For 24h targets, stay within ±15% of current price.",
    "       For 7d targets, stay within ±25%. For 30d, stay within ±40%.",
    "       NEVER set a target above the all-time high (ATH) for timeframes under 30d.",
  ].join("\n");
}
