import type { Transaction } from "@solana/web3.js";
import type { WalletAdapter, WalletCapabilities } from "./WalletAdapter";

export class IosPlaceholderAdapter implements WalletAdapter {
  async connect(): Promise<string> {
    throw new Error("iOS wallet integration is planned for a later release");
  }

  async disconnect(): Promise<void> {
    return;
  }

  async signMessage(): Promise<Uint8Array> {
    throw new Error("iOS wallet integration is planned for a later release");
  }

  async sendTransaction(_transaction: Transaction): Promise<string> {
    throw new Error("iOS wallet integration is planned for a later release");
  }

  getAddress(): string | null {
    return null;
  }

  getCapabilities(): WalletCapabilities {
    return {
      canSignMessage: false,
      canSendTransaction: false,
      walletType: "ios_placeholder"
    };
  }
}
