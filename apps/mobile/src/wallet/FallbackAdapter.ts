import { Linking } from "react-native";
import type { Transaction } from "@solana/web3.js";
import type { WalletAdapter, WalletCapabilities } from "./WalletAdapter";

export class FallbackAdapter implements WalletAdapter {
  private address: string | null = null;

  async connect(): Promise<string> {
    await Linking.openURL("https://phantom.app/download");
    throw new Error("Fallback adapter cannot establish programmatic wallet sessions yet");
  }

  async disconnect(): Promise<void> {
    this.address = null;
  }

  async signMessage(): Promise<Uint8Array> {
    throw new Error("Fallback adapter does not support signMessage");
  }

  async sendTransaction(_transaction: Transaction): Promise<string> {
    throw new Error("Fallback adapter does not support sendTransaction");
  }

  getAddress(): string | null {
    return this.address;
  }

  getCapabilities(): WalletCapabilities {
    return {
      canSignMessage: false,
      canSendTransaction: false,
      walletType: "fallback"
    };
  }
}
