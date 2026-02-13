import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { SessionState } from "../types";

const KEY = "chainshorts_session_v2";
const LEGACY_KEYS = ["chainshorts:session:v1"];

const SECURE_STORE_OPTIONS = {
  keychainService: "chainshorts.session",
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

async function removeSecureItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
  } catch {
    // Best effort cleanup
  }
}

async function removeLegacyItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Best effort cleanup
  }
}

export async function loadStoredSession(): Promise<SessionState | null> {
  try {
    let raw = await getSecureItem(KEY);
    if (!raw) {
      raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        await setSecureItem(KEY, raw);
        await removeLegacyItem(KEY);
      }
    }
    if (!raw) {
      for (const legacyKey of LEGACY_KEYS) {
        // Legacy keys contain colons which Android SecureStore rejects,
        // so only check AsyncStorage for these keys.
        raw = await AsyncStorage.getItem(legacyKey);
        if (raw) {
          await setSecureItem(KEY, raw);
          await removeLegacyItem(legacyKey);
          break;
        }
      }
    }
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SessionState>;
    if (parsed.mode === "guest") {
      return { mode: "guest" };
    }

    if (parsed.mode === "wallet" && parsed.walletAddress && parsed.sessionToken) {
      return {
        mode: "wallet",
        walletAddress: parsed.walletAddress,
        sessionToken: parsed.sessionToken
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: SessionState): Promise<void> {
  const serialized = JSON.stringify(session);
  await setSecureItem(KEY, serialized);
  await removeLegacyItem(KEY);
  for (const legacyKey of LEGACY_KEYS) {
    await removeSecureItem(legacyKey);
    await removeLegacyItem(legacyKey);
  }
}
