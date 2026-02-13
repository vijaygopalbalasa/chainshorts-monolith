import type { Transaction, TransactionInstruction, VersionedTransaction, PublicKey } from "@solana/web3.js";

export interface WalletCapabilities {
  canSignMessage: boolean;
  canSendTransaction: boolean;
  walletType: "mwa" | "fallback" | "ios_placeholder";
}

/**
 * Result of connectAndSignChallenge operation.
 * Contains the wallet address, signed message, and signature for SIWS verification.
 */
export interface ConnectAndSignResult {
  address: string;
  message: string;
  signature: Uint8Array;
}

export interface WalletAdapter {
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  sendTransaction(transaction: Transaction): Promise<string>;
  sendVersionedTransaction?(transaction: VersionedTransaction): Promise<string>;

  /**
   * Build a transaction with a fresh blockhash inside the wallet session and send it.
   * This minimizes blockhash staleness by fetching the blockhash right before signing,
   * inside the MWA transact() callback. Critical for Seed Vault where user review takes 30-60s.
   */
  buildAndSendTransaction?(
    instructions: TransactionInstruction[],
    payer: PublicKey
  ): Promise<string>;

  getAddress(): string | null;
  getCapabilities(): WalletCapabilities;

  /**
   * Connect to wallet AND fetch challenge AND sign — all in a single MWA session.
   * This is the correct SIWS flow: authorize → fetchChallenge(address) → signMessages
   * happen inside one transact() call so the session never drops between steps.
   *
   * @param fetchChallenge - Callback that fetches the SIWS challenge for the given address.
   *                         Called inside the live wallet session so no second popup is needed.
   * @returns The wallet address, challenge message, and signature
   */
  connectAndSignChallenge?(
    fetchChallenge: (address: string) => Promise<string>
  ): Promise<ConnectAndSignResult>;
}
