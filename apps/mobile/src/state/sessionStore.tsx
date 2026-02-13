import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { SessionState } from "../types";
import { loadStoredSession, saveStoredSession } from "./sessionStorage";

interface SessionContextValue {
  session: SessionState;
  hydrated: boolean;
  setGuest: () => void;
  setWalletSession: (walletAddress: string, sessionToken: string) => void;
  clearSession: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<SessionState>({ mode: "guest" });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      const stored = await loadStoredSession();
      if (active && stored) {
        setSession(stored);
      }
      if (active) {
        setHydrated(true);
      }
    };

    void hydrate();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    void saveStoredSession(session);
  }, [hydrated, session]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      hydrated,
      setGuest: () => setSession({ mode: "guest" }),
      setWalletSession: (walletAddress, sessionToken) => setSession({ mode: "wallet", walletAddress, sessionToken }),
      clearSession: () => setSession({ mode: "guest" })
    }),
    [hydrated, session]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return context;
}
