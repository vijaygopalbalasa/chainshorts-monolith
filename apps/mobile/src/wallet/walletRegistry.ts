/**
 * Wallet Registry — Supported wallets and installation detection.
 *
 * Supports:
 * - Seed Vault (Seeker built-in, auto-discovered via MWA)
 * - Phantom
 * - Solflare
 * - Backpack
 */

import { Linking, Platform } from "react-native";

export interface SupportedWallet {
  id: string;
  name: string;
  description: string;
  deepLink: string | null; // null for Seed Vault (auto-discovered via MWA on Seeker)
  installed: boolean;
}

/**
 * List of supported wallets.
 * Order determines display order in the wallet selector.
 */
export const SUPPORTED_WALLETS: Omit<SupportedWallet, "installed">[] = [
  {
    id: "seedvault",
    name: "Seed Vault",
    description: "Seeker built-in wallet",
    deepLink: null, // Discovered via MWA intents on Seeker devices
  },
  {
    id: "phantom",
    name: "Phantom",
    description: "Most popular Solana wallet",
    deepLink: "phantom://",
  },
  {
    id: "solflare",
    name: "Solflare",
    description: "Secure Solana wallet",
    deepLink: "solflare://",
  },
  {
    id: "backpack",
    name: "Backpack",
    description: "Next-gen crypto wallet",
    deepLink: "backpack://",
  },
];

/**
 * Play Store URLs for wallet installation.
 */
export const WALLET_STORE_URLS: Record<string, string> = {
  phantom: "https://play.google.com/store/apps/details?id=app.phantom",
  solflare: "https://play.google.com/store/apps/details?id=com.solflare.mobile",
  backpack: "https://play.google.com/store/apps/details?id=app.backpack",
};

/**
 * Check if a wallet is installed on the device.
 *
 * @param walletId - The wallet ID to check
 * @returns true if installed, false otherwise
 */
export async function checkWalletInstalled(walletId: string): Promise<boolean> {
  const wallet = SUPPORTED_WALLETS.find((w) => w.id === walletId);

  if (!wallet) {
    return false;
  }

  // Seed Vault is auto-discovered via MWA on Android (Seeker devices)
  if (!wallet.deepLink) {
    return Platform.OS === "android";
  }

  try {
    return await Linking.canOpenURL(wallet.deepLink);
  } catch {
    return false;
  }
}

/**
 * Get all supported wallets with their installation status.
 *
 * @returns Array of wallets with `installed` boolean
 */
export async function getInstalledWallets(): Promise<SupportedWallet[]> {
  const results = await Promise.all(
    SUPPORTED_WALLETS.map(async (wallet) => ({
      ...wallet,
      installed: await checkWalletInstalled(wallet.id),
    }))
  );
  return results;
}

/**
 * Get wallet name by ID.
 *
 * @param walletId - The wallet ID
 * @returns The wallet name, or the ID if not found
 */
export function getWalletName(walletId: string): string {
  return SUPPORTED_WALLETS.find((w) => w.id === walletId)?.name ?? walletId;
}

/**
 * Open the Play Store to install a wallet.
 *
 * @param walletId - The wallet ID
 * @throws Error if wallet ID not found or URL cannot be opened
 */
export async function openWalletStore(walletId: string): Promise<void> {
  const url = WALLET_STORE_URLS[walletId];
  if (!url) {
    throw new Error(`No store URL for wallet: ${walletId}`);
  }
  await Linking.openURL(url);
}
