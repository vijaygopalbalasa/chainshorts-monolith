export const TOKEN_KEY = "adv_token";
export const USER_KEY = "adv_user";

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getToken(): string | null {
  const session = getSessionStorage();
  if (session) {
    const token = session.getItem(TOKEN_KEY);
    if (token) return token;
  }

  // Migrate legacy localStorage token to sessionStorage.
  const legacy = getLocalStorage()?.getItem(TOKEN_KEY) ?? null;
  if (legacy && session) {
    session.setItem(TOKEN_KEY, legacy);
    getLocalStorage()?.removeItem(TOKEN_KEY);
  }
  return legacy;
}

export function setToken(token: string): void {
  const session = getSessionStorage();
  if (session) {
    session.setItem(TOKEN_KEY, token);
  }
  getLocalStorage()?.removeItem(TOKEN_KEY);
}

export function clearToken(): void {
  getSessionStorage()?.removeItem(TOKEN_KEY);
  getSessionStorage()?.removeItem(USER_KEY);
  getLocalStorage()?.removeItem(TOKEN_KEY);
  getLocalStorage()?.removeItem(USER_KEY);
}

export function getStoredUser(): AdvertiserUser | null {
  const session = getSessionStorage();
  let raw = session?.getItem(USER_KEY) ?? null;
  if (!raw) {
    raw = getLocalStorage()?.getItem(USER_KEY) ?? null;
    if (raw && session) {
      session.setItem(USER_KEY, raw);
      getLocalStorage()?.removeItem(USER_KEY);
    }
  }
  if (!raw) return null;
  try { return JSON.parse(raw) as AdvertiserUser; }
  catch { return null; }
}

export function setStoredUser(user: AdvertiserUser): void {
  const serialized = JSON.stringify(user);
  getSessionStorage()?.setItem(USER_KEY, serialized);
  getLocalStorage()?.removeItem(USER_KEY);
}

export interface AdvertiserUser {
  id: string;
  email: string | null;
  walletAddress: string | null;
  companyName: string | null;
  isOnboarded: boolean;
}
