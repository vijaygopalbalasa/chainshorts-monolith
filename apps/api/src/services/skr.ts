import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SystemProgram
} from "@solana/web3.js";
import bs58 from "bs58";
import { DEFAULT_ECONOMY_POLICY, type SkrTier, type SkrTierPolicy } from "@chainshorts/shared";

export const DEFAULT_SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Verify a USDC payment on Solana.
// billingAmountCents: e.g. 2500 = $25.00 USDC
export async function verifyUsdcPayment(input: {
  rpcUrl: string;
  txSignature: string;
  fromWallet: string;
  toWallet: string;
  billingAmountCents: number;
}): Promise<{ ok: boolean; reason?: string }> {
  return verifySkrPayment({
    rpcUrl: input.rpcUrl,
    txSignature: input.txSignature,
    fromWallet: input.fromWallet,
    toWallet: input.toWallet,
    skrMint: USDC_MINT,
    minAmountUi: input.billingAmountCents / 100, // cents → USDC
  });
}

export function resolveSkrTier(balanceSkr: number, tiers: SkrTierPolicy = DEFAULT_ECONOMY_POLICY.tiers): SkrTier {
  if (balanceSkr >= tiers.pro) return "pro";
  if (balanceSkr >= tiers.alpha) return "alpha";
  if (balanceSkr >= tiers.signal) return "signal";
  return "basic";
}

const SKR_VERIFY_TIMEOUT_MS = 8_000;
const SKR_VERIFY_MAX_ATTEMPTS = 4;
const SKR_VERIFY_RETRY_DELAY_MS = 1_000;
const MAX_U64 = 18_446_744_073_709_551_615n;

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function getAssociatedTokenAddressSync(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from([0x01])
  });
}

function createTransferCheckedInstruction(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number
): TransactionInstruction {
  if (amount <= 0n || amount > MAX_U64) {
    throw new Error("invalid_transfer_amount");
  }

  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0); // TokenInstruction::TransferChecked
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);

  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    data
  });
}

function uiAmountToRaw(amountUi: number, decimals: number): bigint {
  if (!Number.isFinite(amountUi) || amountUi <= 0) {
    throw new Error("invalid_amount_ui");
  }

  const factor = 10 ** decimals;
  const scaled = Math.floor(amountUi * factor + Number.EPSILON);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) {
    throw new Error("invalid_amount_precision");
  }

  return BigInt(scaled);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error("rpc_timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (id) clearTimeout(id);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function verifySkrPayment(input: {
  rpcUrl: string;
  txSignature: string;
  fromWallet: string;
  toWallet: string;
  skrMint: string;
  minAmountUi: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const connection = new Connection(input.rpcUrl, "confirmed");

  let tx: Awaited<ReturnType<typeof connection.getParsedTransaction>> = null;
  let lookupReason: string | undefined;
  for (let attempt = 1; attempt <= SKR_VERIFY_MAX_ATTEMPTS; attempt += 1) {
    try {
      tx = await withTimeout(
        connection.getParsedTransaction(input.txSignature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0
        }),
        SKR_VERIFY_TIMEOUT_MS
      );

      if (tx) {
        break;
      }
      lookupReason = "transaction_not_found";
    } catch (error) {
      lookupReason = error instanceof Error && error.message === "rpc_timeout" ? "rpc_timeout" : "rpc_error";
    }

    if (attempt < SKR_VERIFY_MAX_ATTEMPTS) {
      await sleep(SKR_VERIFY_RETRY_DELAY_MS * attempt);
    }
  }

  if (!tx) return { ok: false, reason: lookupReason ?? "transaction_not_found" };
  if (tx.meta?.err) return { ok: false, reason: "transaction_failed" };

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  const minRawByDecimals = (decimals: number): bigint => {
    try {
      const threshold = uiAmountToRaw(input.minAmountUi, decimals);
      return (threshold * 999n) / 1000n; // allow only 0.1% tolerance for rounding dust
    } catch {
      return 0n;
    }
  };

  // Verify sender: the fromWallet's token account must show a net decrease
  const senderDebitVerified = pre.some((preBal) => {
    if (preBal.mint !== input.skrMint) return false;
    if (preBal.owner !== input.fromWallet) return false;
    const postBal = post.find((b) => b.accountIndex === preBal.accountIndex);
    const decimals = preBal.uiTokenAmount.decimals;
    const preAmt = BigInt(preBal.uiTokenAmount.amount ?? "0");
    const postAmt = BigInt(postBal?.uiTokenAmount.amount ?? "0");
    const debited = preAmt - postAmt;
    return debited >= minRawByDecimals(decimals);
  });
  if (!senderDebitVerified) {
    return { ok: false, reason: "sender_not_verified" };
  }

  // Verify recipient: the toWallet's token account must show a net increase
  for (const postBal of post) {
    if (postBal.mint !== input.skrMint) continue;
    if (postBal.owner !== input.toWallet) continue;

    const preBal = pre.find((b) => b.accountIndex === postBal.accountIndex);
    const decimals = postBal.uiTokenAmount.decimals;
    const preAmount = BigInt(preBal?.uiTokenAmount.amount ?? "0");
    const postAmount = BigInt(postBal.uiTokenAmount.amount ?? "0");
    const received = postAmount - preAmount;

    if (received >= minRawByDecimals(decimals)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "insufficient_skr_payment" };
}

export function resolveTierUnlocks(tier: SkrTier): string[] {
  switch (tier) {
    case "pro":
      return [
        "standard_feed",
        "dev_feed",
        "threat_feed",
        "alpha_feed",
        "priority_alerts"
      ];
    case "alpha":
      return [
        "standard_feed",
        "dev_feed",
        "threat_feed",
        "alpha_feed"
      ];
    case "signal":
      return [
        "standard_feed",
        "dev_feed",
        "trending_early",
        "basic_threat_alerts"
      ];
    default:
      return ["standard_feed"];
  }
}

// ── SKR Payout Transfer ───────────────────────────────────────────────────

const DEFAULT_SKR_DECIMALS = 6;
const SKR_TRANSFER_TIMEOUT_MS = 30_000;

export interface TransferSkrPayoutInput {
  rpcUrl: string;
  platformWalletSecret: string; // Base58 encoded private key
  toWallet: string;
  skrMint: string;
  amountUi: number; // Amount in UI units (e.g., 100 SKR)
}

export interface TransferSkrPayoutResult {
  success: boolean;
  txSignature?: string;
  error?: string;
}

/**
 * Transfer SKR from platform wallet to a winner's wallet.
 * Requires PLATFORM_WALLET_SECRET env var to be set.
 */
export async function transferSkrPayout(input: TransferSkrPayoutInput): Promise<TransferSkrPayoutResult> {
  if (!input.platformWalletSecret) {
    return { success: false, error: "platform_wallet_secret_not_configured" };
  }

  try {
    // Decode platform wallet keypair from base58 secret
    const platformKeypair = Keypair.fromSecretKey(bs58.decode(input.platformWalletSecret));
    const platformPubkey = platformKeypair.publicKey;
    const recipientPubkey = new PublicKey(input.toWallet);
    const mintPubkey = new PublicKey(input.skrMint);

    // Get token accounts
    const platformAta = getAssociatedTokenAddressSync(mintPubkey, platformPubkey);
    const recipientAta = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);

    const connection = new Connection(input.rpcUrl, "confirmed");
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    const mintData = mintInfo.value?.data;
    const tokenDecimals =
      mintData &&
      typeof mintData === "object" &&
      "parsed" in mintData
        ? (mintData.parsed as { info?: { decimals?: number } }).info?.decimals ?? DEFAULT_SKR_DECIMALS
        : DEFAULT_SKR_DECIMALS;

    // Convert UI amount to raw (e.g., 100 SKR → 100_000_000)
    const amountRaw = uiAmountToRaw(input.amountUi, tokenDecimals);

    // Build transaction
    const tx = new Transaction();

    // Add priority fee for faster confirmation
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 })
    );

    // Always include idempotent ATA creation — on-chain no-op if it already exists.
    // This eliminates the TOCTOU race between getAccountInfo and sendTransaction.
    tx.add(
      createAssociatedTokenAccountInstruction(
        platformPubkey,      // payer
        recipientAta,        // associatedToken
        recipientPubkey,     // owner
        mintPubkey           // mint
      )
    );

    // Add transfer instruction
    tx.add(
      createTransferCheckedInstruction(
        platformAta,      // source
        mintPubkey,       // mint
        recipientAta,     // destination
        platformPubkey,   // owner
        amountRaw,        // amount
        tokenDecimals     // decimals
      )
    );

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = platformPubkey;

    // Sign and send
    const signature = await withTimeout(
      sendAndConfirmTransaction(connection, tx, [platformKeypair], {
        commitment: "confirmed",
        maxRetries: 3
      }),
      SKR_TRANSFER_TIMEOUT_MS
    );

    // eslint-disable-next-line no-console -- critical financial transfer audit log
    console.log(`[skr] Payout transfer successful: ${signature} (${input.amountUi} SKR to ${input.toWallet})`);
    return { success: true, txSignature: signature };

  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    // eslint-disable-next-line no-console -- critical financial transfer error
    console.error(`[skr] Payout transfer failed:`, message);
    return { success: false, error: message };
  }
}
