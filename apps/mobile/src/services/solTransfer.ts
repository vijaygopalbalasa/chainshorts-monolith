import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export interface BuildSolTransferInput {
  fromWallet: string;
  toWallet: string;
  amountSol: number;
}

/**
 * Build a SOL transfer transaction.
 * Returns an unsigned transaction ready to be signed by the wallet adapter.
 */
export async function buildSolTransferTransaction(
  input: BuildSolTransferInput
): Promise<Transaction> {
  if (!Number.isFinite(input.amountSol) || input.amountSol <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  const connection = new Connection(RPC_URL, "confirmed");

  const fromPubkey = new PublicKey(input.fromWallet);
  const toPubkey = new PublicKey(input.toWallet);

  // Convert SOL to lamports
  const lamports = Math.floor(input.amountSol * LAMPORTS_PER_SOL);

  if (lamports <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  // Create transfer instruction
  const transferInstruction = SystemProgram.transfer({
    fromPubkey,
    toPubkey,
    lamports,
  });

  // Build transaction
  const transaction = new Transaction().add(transferInstruction);

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = fromPubkey;

  const [balanceLamports, feeForMessage] = await Promise.all([
    connection.getBalance(fromPubkey, "confirmed"),
    connection.getFeeForMessage(transaction.compileMessage(), "confirmed")
  ]);
  const feeLamports = feeForMessage.value ?? 5000;
  const totalRequired = lamports + feeLamports;
  if (balanceLamports < totalRequired) {
    throw new Error(
      `Insufficient SOL balance. You have ${(balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL but need ${(totalRequired / LAMPORTS_PER_SOL).toFixed(4)} SOL.`
    );
  }

  return transaction;
}
