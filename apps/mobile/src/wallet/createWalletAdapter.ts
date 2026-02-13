import { Platform } from "react-native";
import { AndroidMwaAdapter, type AndroidMwaAdapterOptions } from "./AndroidMwaAdapter";
import { FallbackAdapter } from "./FallbackAdapter";
import { IosPlaceholderAdapter } from "./IosPlaceholderAdapter";
import type { WalletAdapter } from "./WalletAdapter";

/**
 * Cache adapters by wallet ID to avoid creating new instances.
 * This allows efficient wallet switching without full restart.
 */
const adapterCache = new Map<string, WalletAdapter>();

export interface CreateAdapterOptions extends AndroidMwaAdapterOptions {}

/**
 * Get a wallet adapter for the current platform.
 *
 * @param options - Optional configuration (walletId, timeoutMs)
 * @returns A WalletAdapter instance
 *
 * @example
 * // Get default adapter
 * const adapter = getWalletAdapter();
 *
 * @example
 * // Get adapter for specific wallet
 * const adapter = getWalletAdapter({ walletId: "phantom" });
 *
 * @example
 * // Get adapter with custom timeout
 * const adapter = getWalletAdapter({ walletId: "solflare", timeoutMs: 60000 });
 */
export function getWalletAdapter(options?: CreateAdapterOptions): WalletAdapter {
  const cacheKey = options?.walletId ?? "default";

  // Return cached adapter if exists
  const cached = adapterCache.get(cacheKey);
  if (cached) return cached;

  let adapter: WalletAdapter;

  if (Platform.OS === "android") {
    adapter = new AndroidMwaAdapter(options);
  } else if (Platform.OS === "ios") {
    adapter = new IosPlaceholderAdapter();
  } else {
    adapter = new FallbackAdapter();
  }

  adapterCache.set(cacheKey, adapter);
  return adapter;
}

/**
 * Clear the adapter cache.
 * Use this when switching wallets or resetting state.
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}

/**
 * Get a fresh adapter (not cached).
 * Useful for one-time operations that shouldn't affect cached state.
 */
export function createFreshAdapter(options?: CreateAdapterOptions): WalletAdapter {
  if (Platform.OS === "android") {
    return new AndroidMwaAdapter(options);
  } else if (Platform.OS === "ios") {
    return new IosPlaceholderAdapter();
  }
  return new FallbackAdapter();
}
