import { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "@craftzdog/react-native-buffer";

// Jupiter calls are proxied through the Chainshorts API so the Jupiter API key
// never appears in the APK. The API adds the x-api-key header server-side.
const JUPITER_API = `${process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.chainshorts.live"}/v1/jupiter`;

// Jupiter Referral Token Accounts — PDAs of referral account 77qxNxf5CyK7tDosMujDercmkv4FxvzQWdqw9CQo8roZ
// via REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3 (Jupiter Referral Program)
// Keys are output token mints; values from EXPO_PUBLIC_JUPITER_FEE_ACCOUNT_* env vars
const FEE_ACCOUNTS: Record<string, string | undefined> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: process.env.EXPO_PUBLIC_JUPITER_FEE_ACCOUNT_USDC,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: process.env.EXPO_PUBLIC_JUPITER_FEE_ACCOUNT_USDT,
  SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3: process.env.EXPO_PUBLIC_JUPITER_FEE_ACCOUNT_SKR,
  So11111111111111111111111111111111111111112:    process.env.EXPO_PUBLIC_JUPITER_FEE_ACCOUNT_SOL,
};

export const SWAP_TOKENS = {
  SOL:  { mint: "So11111111111111111111111111111111111111112",  symbol: "SOL",  decimals: 9,  label: "Solana" },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6,  label: "USD Coin" },
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6,  label: "Tether USD" },
  SKR:  { mint: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",  symbol: "SKR",  decimals: 6,  label: "Seeker" },
} as const;

export type SwapTokenKey = keyof typeof SWAP_TOKENS;

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;     // raw units
  outAmount: string;    // raw units
  priceImpactPct: string;
  _raw: unknown;        // full quote response, passed back to buildSwapTransaction
}

/**
 * Get a swap quote from Jupiter V6.
 * amount should be in raw token units (lamports for SOL, etc.)
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps = 50
): Promise<SwapQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(Math.floor(amount)),
    slippageBps: String(slippageBps),
    platformFeeBps: "100", // 1% platform fee
  });

  const res = await fetch(`${JUPITER_API}/quote?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `Jupiter quote failed: ${res.status}`);
  }
  const data = await res.json();

  return {
    inputMint: data.inputMint,
    outputMint: data.outputMint,
    inAmount: data.inAmount,
    outAmount: data.outAmount,
    priceImpactPct: data.priceImpactPct,
    _raw: data,
  };
}

/**
 * Build the swap VersionedTransaction from Jupiter V6.
 * Returns a VersionedTransaction ready to be signed and sent via MWA.
 */
export async function buildSwapTransaction(
  quote: SwapQuote,
  userPublicKey: string
): Promise<VersionedTransaction> {
  const feeAccount = FEE_ACCOUNTS[quote.outputMint];
  const res = await fetch(`${JUPITER_API}/swap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      quoteResponse: quote._raw,
      userPublicKey,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      ...(feeAccount ? { feeAccount } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `Jupiter swap build failed: ${res.status}`);
  }
  const { swapTransaction } = await res.json() as { swapTransaction: string };
  const txBytes = Buffer.from(swapTransaction, "base64");
  return VersionedTransaction.deserialize(txBytes);
}

/**
 * Format a raw token amount to a human-readable string.
 */
export function formatTokenAmount(rawAmount: string, decimals: number): string {
  const num = Number(rawAmount) / Math.pow(10, decimals);
  if (num >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (num >= 1) return num.toFixed(4);
  return num.toFixed(6);
}

/**
 * Convert a human-readable amount to raw token units.
 */
export function toRawAmount(humanAmount: number, decimals: number): number {
  if (!Number.isFinite(humanAmount) || humanAmount <= 0) {
    throw new Error("Amount must be greater than 0");
  }
  const factor = 10 ** decimals;
  const scaled = Math.floor(humanAmount * factor + Number.EPSILON);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) {
    throw new Error("Invalid amount precision");
  }
  return scaled;
}
