/**
 * CoinGecko Deterministic Price Resolver
 * Resolves price-based prediction questions using historical price data.
 * Returns confidence=1.0 since price data is deterministic.
 */

export interface PriceResolutionInput {
  symbol: string; // CoinGecko ID: "bitcoin", "ethereum", "solana"
  target: number; // Target price in USD
  kind: "price_above" | "price_below";
  deadline: string; // ISO timestamp
}

export interface PriceResolutionResult {
  outcome: "yes" | "no" | "indeterminate";
  confidence: number;
  priceAtDeadline: number | null;
  source: string;
  reasoning: string;
}

// Map common symbols/names to CoinGecko IDs
const SYMBOL_MAP: Record<string, string> = {
  bitcoin: "bitcoin",
  btc: "bitcoin",
  ethereum: "ethereum",
  eth: "ethereum",
  solana: "solana",
  sol: "solana",
  ripple: "ripple",
  xrp: "ripple",
  binancecoin: "binancecoin",
  bnb: "binancecoin",
  cardano: "cardano",
  ada: "cardano",
  dogecoin: "dogecoin",
  doge: "dogecoin",
  avalanche: "avalanche-2",
  "avalanche-2": "avalanche-2",
  avax: "avalanche-2",
  chainlink: "chainlink",
  link: "chainlink",
  polkadot: "polkadot",
  dot: "polkadot",
  toncoin: "toncoin",
  ton: "toncoin",
  sui: "sui",
  near: "near",
  pepe: "pepe",
  render: "render-token",
  "render-token": "render-token",
};

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";

/**
 * Fetch historical price from CoinGecko at a specific timestamp
 * Uses the /coins/{id}/market_chart/range endpoint
 */
async function fetchHistoricalPrice(coinId: string, timestamp: Date): Promise<number | null> {
  // CoinGecko uses Unix timestamps in seconds
  const targetUnix = Math.floor(timestamp.getTime() / 1000);

  // Fetch a 2-hour window around the deadline to find the closest price
  const from = targetUnix - 3600; // 1 hour before
  const to = targetUnix + 3600; // 1 hour after

  const url = `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error(`[coinGeckoResolver] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as { prices?: [number, number][] };

    if (!data.prices || data.prices.length === 0) {
      // eslint-disable-next-line no-console
      console.error("[coinGeckoResolver] No price data returned");
      return null;
    }

    // Find the price point closest to the target timestamp
    const firstPrice = data.prices[0];
    if (!firstPrice) {
      // eslint-disable-next-line no-console
      console.error("[coinGeckoResolver] No price data in array");
      return null;
    }
    let closestPrice = firstPrice[1];
    let closestDiff = Math.abs(firstPrice[0] - targetUnix * 1000);

    for (const [ts, price] of data.prices) {
      const diff = Math.abs(ts - targetUnix * 1000);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestPrice = price;
      }
    }

    return closestPrice;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[coinGeckoResolver] Fetch error:", error);
    return null;
  }
}

/**
 * Resolve a price-based prediction question using CoinGecko data.
 *
 * This is deterministic resolution - if we can fetch the price,
 * we return confidence=1.0 since there's no ambiguity.
 */
export async function resolvePriceQuestion(
  input: PriceResolutionInput
): Promise<PriceResolutionResult> {
  const { symbol, target, kind, deadline } = input;

  // Normalize symbol to CoinGecko ID
  const coinId = SYMBOL_MAP[symbol.toLowerCase()];
  if (!coinId) {
    return {
      outcome: "indeterminate",
      confidence: 0,
      priceAtDeadline: null,
      source: "",
      reasoning: `Unknown symbol: ${symbol}. Supported: bitcoin, ethereum, solana`,
    };
  }

  // Parse deadline
  const deadlineDate = new Date(deadline);
  if (Number.isNaN(deadlineDate.getTime())) {
    return {
      outcome: "indeterminate",
      confidence: 0,
      priceAtDeadline: null,
      source: "",
      reasoning: `Invalid deadline format: ${deadline}`,
    };
  }

  // Check if deadline is in the future (can't resolve yet)
  const now = new Date();
  if (deadlineDate > now) {
    return {
      outcome: "indeterminate",
      confidence: 0,
      priceAtDeadline: null,
      source: "",
      reasoning: `Deadline (${deadline}) is in the future. Cannot resolve yet.`,
    };
  }

  // Fetch historical price
  const priceAtDeadline = await fetchHistoricalPrice(coinId, deadlineDate);

  if (priceAtDeadline === null) {
    return {
      outcome: "indeterminate",
      confidence: 0,
      priceAtDeadline: null,
      source: COINGECKO_BASE_URL,
      reasoning: "Could not fetch historical price from CoinGecko API",
    };
  }

  // Determine outcome based on rule kind
  let outcome: "yes" | "no";
  let reasoning: string;

  if (kind === "price_above") {
    outcome = priceAtDeadline >= target ? "yes" : "no";
    reasoning = `${coinId.toUpperCase()} price at ${deadline} was $${priceAtDeadline.toFixed(2)}, ` +
      `which is ${outcome === "yes" ? "above or equal to" : "below"} the target of $${target.toFixed(2)}`;
  } else {
    // price_below
    outcome = priceAtDeadline <= target ? "yes" : "no";
    reasoning = `${coinId.toUpperCase()} price at ${deadline} was $${priceAtDeadline.toFixed(2)}, ` +
      `which is ${outcome === "yes" ? "below or equal to" : "above"} the target of $${target.toFixed(2)}`;
  }

  // eslint-disable-next-line no-console
  console.log(`[coinGeckoResolver] ${coinId} @ ${deadline}: $${priceAtDeadline.toFixed(2)} vs target $${target} (${kind}) → ${outcome}`);

  return {
    outcome,
    confidence: 1.0, // Deterministic resolution
    priceAtDeadline,
    source: `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart/range`,
    reasoning,
  };
}
