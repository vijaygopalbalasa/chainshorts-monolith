import * as SecureStore from "expo-secure-store";

export interface StoredMwaAuthorization {
  authToken: string;
  base64Address: string;
  walletId?: string;
  // walletUriBase intentionally omitted — ephemeral ports are always stale after restart
}

// SecureStore key must match [A-Za-z0-9._-]+ — colons are NOT allowed on Android.
// Using underscores instead. The old colon-key silently failed all SecureStore reads
// (caught exception → null) and threw on writes ("invalid key provided").
const KEY = "chainshorts_mwa_auth_v2";

const SECURE_STORE_OPTIONS = {
  keychainService: "chainshorts.mwa",
};

async function getSecureItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
  } catch {
    return null;
  }
}

async function setSecureItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
}

async function deleteSecureItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
  } catch {
    // fall through
  }
}

export async function loadStoredMwaAuthorization(): Promise<StoredMwaAuthorization | null> {
  try {
    const raw = await getSecureItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredMwaAuthorization>;
    if (!parsed.authToken || !parsed.base64Address) {
      return null;
    }

    return {
      authToken: parsed.authToken,
      base64Address: parsed.base64Address,
      walletId: typeof parsed.walletId === "string" ? parsed.walletId : undefined
    };
  } catch {
    return null;
  }
}

export async function saveStoredMwaAuthorization(input: StoredMwaAuthorization): Promise<void> {
  const serialized = JSON.stringify(input);
  await setSecureItem(KEY, serialized);
}

export async function clearStoredMwaAuthorization(): Promise<void> {
  await deleteSecureItem(KEY);
}
