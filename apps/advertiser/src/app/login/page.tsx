"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import bs58 from "bs58";
import { requestChallenge, verifyWallet } from "@/lib/api";
import { setToken, setStoredUser, getToken } from "@/lib/auth";

// -- Wallet provider interface ------------------------------------------------
interface SolanaProvider {
  publicKey?: { toBase58?: () => string; toString(): string; toBytes?: () => Uint8Array } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58?: () => string; toString(): string; toBytes?: () => Uint8Array } }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider & { isSolflare?: boolean };
    backpack?: { solana?: SolanaProvider };
  }
}

// -- Wallet definitions -------------------------------------------------------
interface WalletDef {
  name: string;
  icon: string;
  installUrl: string;
  getProvider(): SolanaProvider | undefined;
}

const WALLETS: WalletDef[] = [
  {
    name: "Phantom",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiB2aWV3Qm94PSIwIDAgMTA4IDEwOCIgZmlsbD0ibm9uZSI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPg==",
    installUrl: "https://phantom.app",
    getProvider() {
      return typeof window !== "undefined" ? window.phantom?.solana : undefined;
    },
  },
  {
    name: "Solflare",
    icon: "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c3ZnIGlkPSJTIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MCA1MCI+PGRlZnM+PHN0eWxlPi5jbHMtMXtmaWxsOiMwMjA1MGE7c3Ryb2tlOiNmZmVmNDY7c3Ryb2tlLW1pdGVybGltaXQ6MTA7c3Ryb2tlLXdpZHRoOi41cHg7fS5jbHMtMntmaWxsOiNmZmVmNDY7fTwvc3R5bGU+PC9kZWZzPjxyZWN0IGNsYXNzPSJjbHMtMiIgeD0iMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiByeD0iMTIiIHJ5PSIxMiIvPjxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTI0LjIzLDI2LjQybDIuNDYtMi4zOCw0LjU5LDEuNWMzLjAxLDEsNC41MSwyLjg0LDQuNTEsNS40MywwLDEuOTYtLjc1LDMuMjYtMi4yNSw0LjkzbC0uNDYuNS4xNy0xLjE3Yy42Ny00LjI2LS41OC02LjA5LTQuNzItNy40M2wtNC4zLTEuMzhoMFpNMTguMDUsMTEuODVsMTIuNTIsNC4xNy0yLjcxLDIuNTktNi41MS0yLjE3Yy0yLjI1LS43NS0zLjAxLTEuOTYtMy4zLTQuNTF2LS4wOGgwWk0xNy4zLDMzLjA2bDIuODQtMi43MSw1LjM0LDEuNzVjMi44LjkyLDMuNzYsMi4xMywzLjQ2LDUuMThsLTExLjY1LTQuMjJoMFpNMTMuNzEsMjAuOTVjMC0uNzkuNDItMS41NCwxLjEzLTIuMTcuNzUsMS4wOSwyLjA1LDIuMDUsNC4wOSwyLjcxbDQuNDIsMS40Ni0yLjQ2LDIuMzgtNC4zNC0xLjQyYy0yLS42Ny0yLjg0LTEuNjctMi44NC0yLjk2TTI2LjgyLDQyLjg3YzkuMTgtNi4wOSwxNC4xMS0xMC4yMywxNC4xMS0xNS4zMiwwLTMuMzgtMi01LjI2LTYuNDMtNi43MmwtMy4zNC0xLjEzLDkuMTQtOC43Ny0xLjg0LTEuOTYtMi43MSwyLjM4LTEyLjgxLTQuMjJjLTMuOTcsMS4yOS04Ljk3LDUuMDktOC45Nyw4Ljg5LDAsLjQyLjA0LjgzLjE3LDEuMjktMy4zLDEuODgtNC42MywzLjYzLTQuNjMsNS44LDAsMi4wNSwxLjA5LDQuMDksNC41NSw1LjIybDIuNzUuOTItOS41Miw5LjE0LDEuODQsMS45NiwyLjk2LTIuNzEsMTQuNzMsNS4yMmgwWiIvPjwvc3ZnPg==",
    installUrl: "https://solflare.com",
    getProvider() {
      return typeof window !== "undefined" ? window.solflare : undefined;
    },
  },
  {
    name: "Backpack",
    icon: "data:image/png;base64,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",
    installUrl: "https://backpack.app",
    getProvider() {
      return typeof window !== "undefined" ? window.backpack?.solana : undefined;
    },
  },
];

type Status = "idle" | "connecting" | "signing" | "verifying" | "done";

export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [installedWallets, setInstalledWallets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (getToken()) router.replace("/dashboard");

    // Robust polling for asynchronously injected wallets (2026 standard)
    const checkWallets = () => {
      setInstalledWallets({
        Phantom: !!window.phantom?.solana,
        Solflare: !!window.solflare,
        Backpack: !!window.backpack?.solana,
      });
    };

    checkWallets(); // Check immediately
    const interval = setInterval(checkWallets, 500); // Poll every 500ms
    window.addEventListener("load", checkWallets);

    return () => {
      clearInterval(interval);
      window.removeEventListener("load", checkWallets);
    };
  }, [router]);

  const extractPublicKey = (resp: any, provider: SolanaProvider): string => {
    const pk = resp?.publicKey || provider.publicKey;
    if (!pk) return "";

    // Most reliable standard format first
    if (typeof pk.toBase58 === "function") return pk.toBase58();
    if (typeof pk.toString === "function") return pk.toString();
    if (typeof pk === "string") return pk;

    // In rare cases (like old Solflare), we encode the bytes directly
    if (typeof pk.toBytes === "function") return bs58.encode(pk.toBytes());

    return "";
  };

  const handleConnect = useCallback(async (wallet: WalletDef) => {
    if (status !== "idle") return;

    const provider = wallet.getProvider();
    if (!provider) {
      window.open(wallet.installUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setError(null);
    setStatus("connecting");

    try {
      let pubkey: string = "";

      // Attempt silent auto-connect first (trusted), fallback to explicit connect
      try {
        const resp = await provider.connect({ onlyIfTrusted: true });
        pubkey = extractPublicKey(resp, provider);
        if (!pubkey) throw new Error("Auto-connect yielded no valid public key.");
      } catch {
        const resp = await provider.connect();
        pubkey = extractPublicKey(resp, provider);
        if (!pubkey) throw new Error(`Could not extract public key from ${wallet.name} provider.`);
      }

      // Explicitly check base58 string validity
      if (pubkey.length < 32 || pubkey.length > 44) {
         throw new Error(`The provided wallet address (${pubkey.slice(0, 4)}...${pubkey.slice(-4)}) does not match a valid Solana address length.`);
      }

      setStatus("signing");
      const { message } = await requestChallenge(pubkey);

      const encoded = new TextEncoder().encode(message);
      const { signature } = await provider.signMessage(encoded);
      const sig58 = bs58.encode(signature);

      setStatus("verifying");
      const { token, advertiser, needsOnboarding } = await verifyWallet(pubkey, message, sig58);

      setToken(token);
      setStoredUser(advertiser);
      setStatus("done");
      router.replace(needsOnboarding ? "/dashboard/setup" : "/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (process.env.NODE_ENV !== "production") {
        console.error(`[Wallet Connect Error] ${wallet.name}:`, err);
      }
      const rejected = /reject|cancel|denied|user rejected/i.test(msg);
      setError(rejected ? "Connection rejected by user. Please try again." : `Connection failed: ${msg}`);
      setStatus("idle");
      try { await wallet.getProvider()?.disconnect(); } catch { /* ignore disconnect failures */ }
    }
  }, [status, router]);

  const statusLabel: Record<Status, string | null> = {
    idle:       null,
    connecting: "Opening wallet extension...",
    signing:    "Please sign the message in your wallet...",
    verifying:  "Verifying cryptographic signature...",
    done:       "Authentication complete. Redirecting...",
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-8 bg-gray-50 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
      <div className="text-center mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex items-center justify-center gap-2.5 mb-4">
          <img src="/logo.png" alt="Chainshorts" className="w-10 h-10 rounded-xl" />
          <span className="font-semibold text-gray-900 text-lg">
            Chainshorts
          </span>
        </div>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-2 tracking-tight">
          Advertiser Portal
        </h1>
        <p className="text-gray-500 font-medium max-w-sm mx-auto">
          Reach crypto-native readers with precision targeting. Secure login with your Solana wallet.
        </p>
      </div>

      <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-8 w-full max-w-md relative animate-in fade-in zoom-in-95 duration-500 delay-150">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Connect Wallet</h2>
        <p className="text-sm text-gray-500 mb-8">
          Sign a cryptographic message to verify your identity. No password required.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-4 rounded-xl mb-6 flex items-start shadow-sm animate-in fade-in">
            <svg className="w-5 h-5 mr-3 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="flex-1 leading-relaxed">{error}</span>
          </div>
        )}

        {statusLabel[status] && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm p-4 rounded-xl mb-6 font-mono flex items-center shadow-sm animate-in fade-in">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {statusLabel[status]}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {WALLETS.map((w) => {
            const isInstalled = installedWallets[w.name];
            const busy = status !== "idle";
            return (
              <button
                key={w.name}
                onClick={() => void handleConnect(w)}
                disabled={busy}
                className={`group flex items-center gap-4 w-full p-4 rounded-xl border transition-all duration-300 ${
                  busy
                    ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed opacity-60"
                    : "bg-white border-gray-200 text-gray-900 cursor-pointer hover:-translate-y-0.5 hover:border-green-500 hover:shadow-lg hover:shadow-green-100 active:translate-y-0"
                }`}
              >
                <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-sm border border-gray-100 bg-white flex items-center justify-center p-1">
                  <img src={w.icon} alt={w.name} className="w-full h-full object-contain rounded-lg" />
                </div>
                <span className="flex-1 text-left font-bold text-[15px]">{w.name}</span>
                <span
                  className={`text-[10px] font-mono px-2.5 py-1 rounded-md tracking-widest font-semibold uppercase transition-colors ${
                    isInstalled
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500 group-hover:bg-gray-200"
                  }`}
                >
                  {isInstalled ? "Detected" : "Install →"}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-gray-400 text-[10px] mt-8 text-center uppercase tracking-widest font-bold font-mono">
          Self-Custody • Sign In With Solana
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-12 max-w-2xl w-full animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300">
        {[
          { label: "High-Impact Cards", desc: "Immersive story format" },
          { label: "Live Analytics", desc: "Track ROI instantly" },
          { label: "Web3 Native", desc: "Solana wallet authentication" },
        ].map(({ label, desc }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-5 text-center shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1">
            <div className="w-2 h-2 rounded-full bg-green-500 mx-auto mb-3 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
            <div className="text-gray-900 text-sm font-bold mb-1">{label}</div>
            <div className="text-gray-500 text-xs font-medium">{desc}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
