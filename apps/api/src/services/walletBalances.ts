import { Connection, PublicKey } from "@solana/web3.js";

export interface WalletBalanceResult {
  solLamports: number;
  skrRaw: string;
  skrUi: number;
  usdcRaw: string;
  usdcUi: number;
  usdtRaw: string;
  usdtUi: number;
}

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export async function fetchWalletBalances(input: {
  rpcUrl: string;
  walletAddress: string;
  skrMint: string;
}): Promise<WalletBalanceResult> {
  const connection = new Connection(input.rpcUrl, "confirmed");
  const owner = new PublicKey(input.walletAddress);

  const [solResult, tokenAccountsResult] = await Promise.allSettled([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
  ]);
  if (solResult.status !== "fulfilled") {
    throw solResult.reason;
  }

  const solLamports = solResult.value;
  const tokenAccounts =
    tokenAccountsResult.status === "fulfilled"
      ? tokenAccountsResult.value
      : ({
          context: { slot: 0 },
          value: [],
        } as Awaited<ReturnType<Connection["getParsedTokenAccountsByOwner"]>>);

  const trackedMints = new Set([input.skrMint, USDC_MINT, USDT_MINT]);
  const mintTotals = new Map<string, { raw: bigint; decimals: number }>();

  for (const account of tokenAccounts.value) {
    const parsed = account.account.data.parsed as
      | {
          info?: {
            mint?: string;
            tokenAmount?: {
              amount?: string;
              decimals?: number;
            };
          };
        }
      | undefined;
    const mintAddress = parsed?.info?.mint;
    if (!mintAddress || !trackedMints.has(mintAddress)) {
      continue;
    }

    const amountRaw = parsed?.info?.tokenAmount?.amount;
    if (!amountRaw) {
      continue;
    }

    const current = mintTotals.get(mintAddress) ?? { raw: 0n, decimals: parsed?.info?.tokenAmount?.decimals ?? 0 };
    current.raw += BigInt(amountRaw);
    current.decimals = parsed?.info?.tokenAmount?.decimals ?? current.decimals;
    mintTotals.set(mintAddress, current);
  }

  const readMintBalance = (mintAddress: string): { raw: string; ui: number } => {
    const total = mintTotals.get(mintAddress);
    if (!total) {
      return { raw: "0", ui: 0 };
    }
    const divisor = 10 ** total.decimals;
    const ui = divisor > 0 ? Number(total.raw) / divisor : Number(total.raw);
    return {
      raw: total.raw.toString(),
      ui: Number.isFinite(ui) ? ui : 0
    };
  };

  const skrBalance = readMintBalance(input.skrMint);
  const usdcBalance = readMintBalance(USDC_MINT);
  const usdtBalance = readMintBalance(USDT_MINT);

  return {
    solLamports,
    skrRaw: skrBalance.raw,
    skrUi: skrBalance.ui,
    usdcRaw: usdcBalance.raw,
    usdcUi: usdcBalance.ui,
    usdtRaw: usdtBalance.raw,
    usdtUi: usdtBalance.ui
  };
}
