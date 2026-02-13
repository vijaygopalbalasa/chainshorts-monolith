import { Connection, PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction, TransactionMessage } from "@solana/web3.js";

export const DEFAULT_SKR_MINT = process.env.EXPO_PUBLIC_SKR_MINT || "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
export const PLATFORM_WALLET = process.env.EXPO_PUBLIC_PLATFORM_WALLET || "E91HyJ9X4qLZnsHMATjcvTbDH8KWBirws8vHtGLiqwYa";
const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MAX_U64 = 18_446_744_073_709_551_615n;
const DEFAULT_CONFIRM_TIMEOUT_MS = 25_000;
const CONFIRM_POLL_INTERVAL_MS = 700;

function findAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  );
  return ata;
}

function encodeU64Le(value: bigint): Uint8Array {
  const arr = new Uint8Array(8);
  const view = new DataView(arr.buffer);
  view.setUint32(0, Number(value & 0xffffffffn), true);
  view.setUint32(4, Number(value >> 32n), true);
  return arr;
}

function toRawAmount(amountUi: number, decimals: number): bigint {
  if (!Number.isFinite(amountUi) || amountUi <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  const factor = 10 ** decimals;
  const scaled = Math.floor(amountUi * factor + Number.EPSILON);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) {
    throw new Error("Invalid amount precision");
  }

  const raw = BigInt(scaled);
  if (raw > MAX_U64) {
    throw new Error("Transfer amount is too large");
  }

  return raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Builds an idempotent "create ATA" instruction (instruction index 0x01).
 * This is a no-op if the ATA already exists, and creates it if it doesn't.
 * The payer (owner/sender) funds the ATA creation rent.
 */
function buildCreateAtaIdempotentInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    // 0x01 = CreateIdempotent (succeeds even if account exists)
    data: Buffer.from([0x01])
  });
}

/**
 * Pre-builds the transfer instructions and validates balances.
 * Returns the instructions + payer, but does NOT fetch a blockhash yet.
 * This avoids the blockhash going stale while the user reviews in Seed Vault.
 */
export async function prepareSkrTransferInstructions(input: {
  fromWallet: string;
  toWallet: string;
  skrMint: string;
  amountUi: number;
}): Promise<{ instructions: TransactionInstruction[]; payer: PublicKey }> {
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const owner = new PublicKey(input.fromWallet);
  const recipient = new PublicKey(input.toWallet);
  const mint = new PublicKey(input.skrMint);

  const destinationAta = findAta(recipient, mint);

  // Find the user's actual token account for this mint
  const tokenAccountsResult = await connection.getTokenAccountsByOwner(owner, { mint });

  if (tokenAccountsResult.value.length === 0) {
    throw new Error("You do not have an SKR token account yet. Receive SKR first.");
  }

  const sourceTokenAccount = tokenAccountsResult.value[0];
  const sourceAta = sourceTokenAccount.pubkey;

  const mintInfo = await connection.getParsedAccountInfo(mint);
  const mintData = mintInfo.value?.data;
  if (!mintData || typeof mintData !== "object" || !("parsed" in mintData)) {
    throw new Error("Unable to read SKR mint info");
  }

  const decimals: number = (mintData.parsed as { info?: { decimals?: number } }).info?.decimals ?? 6;
  const amountRaw = toRawAmount(input.amountUi, decimals);

  // Parse the balance from the token account we found
  const sourceAccountInfo = await connection.getParsedAccountInfo(sourceAta);
  const sourceData = sourceAccountInfo.value?.data;
  if (!sourceData || typeof sourceData !== "object" || !("parsed" in sourceData)) {
    throw new Error("Unable to read your SKR token account.");
  }

  const sourceAmountRaw = BigInt(
    (sourceData.parsed as { info?: { tokenAmount?: { amount?: string } } }).info?.tokenAmount?.amount ?? "0"
  );
  if (sourceAmountRaw < amountRaw) {
    throw new Error("Insufficient SKR balance for this transfer.");
  }

  // Use TransferChecked (index 12) instead of Transfer (index 3).
  // TransferChecked includes the mint + decimals, which wallets (especially
  // Seed Vault) can decode into a human-readable label like "Transfer 100 SKR"
  // instead of showing "Unknown".
  const instructionData = new Uint8Array(10);
  instructionData[0] = 12; // SPL Token TransferChecked instruction index
  instructionData.set(encodeU64Le(amountRaw), 1);
  instructionData[9] = decimals; // decimals byte for checked transfer

  const transferInstruction = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    data: Buffer.from(instructionData)
  });

  // Only include ATA create + transfer. ComputeBudget instructions cause
  // Seed Vault to show extra "Unknown" program labels (its internal registry
  // doesn't include ComputeBudget). A simple SPL transfer doesn't need them.
  const instructions: TransactionInstruction[] = [
    buildCreateAtaIdempotentInstruction(owner, destinationAta, recipient, mint),
    transferInstruction
  ];

  return { instructions, payer: owner };
}

/**
 * Builds a VersionedTransaction from pre-built instructions with a FRESH blockhash.
 * Call this as late as possible — right before sending to the wallet — to avoid
 * blockhash expiry during Seed Vault's user review period (30-60s).
 */
export async function buildTransactionWithFreshBlockhash(
  instructions: TransactionInstruction[],
  payer: PublicKey
): Promise<VersionedTransaction> {
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}

/**
 * Convenience wrapper: prepares instructions + builds tx in one call.
 * Use prepareSkrTransferInstructions + buildTransactionWithFreshBlockhash
 * separately when you need the blockhash to be as fresh as possible (e.g. MWA).
 */
export async function buildSkrTransferTransaction(input: {
  fromWallet: string;
  toWallet: string;
  skrMint: string;
  amountUi: number;
}): Promise<VersionedTransaction> {
  const { instructions, payer } = await prepareSkrTransferInstructions(input);
  return buildTransactionWithFreshBlockhash(instructions, payer);
}

export async function waitForSignatureConfirmation(input: {
  signature: string;
  rpcUrl?: string;
  timeoutMs?: number;
}): Promise<void> {
  const connection = new Connection(input.rpcUrl ?? SOLANA_RPC_URL, "confirmed");
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const statusResp = await connection.getSignatureStatuses([input.signature], {
      searchTransactionHistory: false
    });
    const status = statusResp.value[0];

    if (status?.err) {
      throw new Error("transaction_failed");
    }

    const confirmation = status?.confirmationStatus;
    if (confirmation === "confirmed" || confirmation === "finalized") {
      return;
    }

    await sleep(CONFIRM_POLL_INTERVAL_MS);
  }

  throw new Error("transaction_confirmation_timeout");
}
