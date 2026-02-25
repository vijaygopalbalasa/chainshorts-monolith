"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken, getStoredUser, setStoredUser } from "@/lib/auth";
import { onboardMe } from "@/lib/api";

export default function SetupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    const user = getStoredUser();
    if (user?.isOnboarded) { router.replace("/dashboard"); }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) { setError("Company name is required"); return; }

    const token = getToken()!;
    setLoading(true);
    setError(null);
    try {
      const { advertiser } = await onboardMe(token, companyName.trim(), websiteUrl.trim() || undefined);
      setStoredUser(advertiser);
      router.replace("/dashboard");
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-8 bg-gray-50 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
      {/* Brand */}
      <div className="text-center mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="font-mono text-sm text-emerald-600 mb-3 tracking-widest uppercase font-semibold">
          ▶ Chainshorts
        </div>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-2 tracking-tight">
          Welcome to Advertiser Portal
        </h1>
        <p className="text-gray-500 font-medium max-w-sm mx-auto">
          Set up your brand identity to start running natively-integrated campaigns.
        </p>
      </div>

      {/* Setup card */}
      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        className="bg-white/70 backdrop-blur-md border border-gray-200 shadow-xl shadow-gray-200/50 rounded-2xl p-8 w-full max-w-md relative animate-in fade-in zoom-in-95 duration-500 delay-150"
      >
        <div className="mb-6">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Company Name <span className="text-emerald-500">*</span>
          </label>
          <input
            type="text"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="e.g. Solana Foundation"
            maxLength={100}
            required
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-shadow shadow-sm"
          />
        </div>

        <div className="mb-8">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Website URL <span className="text-gray-400 font-normal text-xs">(optional)</span>
          </label>
          <input
            type="url"
            value={websiteUrl}
            onChange={e => setWebsiteUrl(e.target.value)}
            placeholder="https://yourcompany.com"
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-shadow shadow-sm"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-4 rounded-xl mb-6 flex items-start shadow-sm animate-in fade-in">
            <svg className="w-5 h-5 mr-3 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="flex-1 leading-relaxed">{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-xl text-base font-bold shadow-sm transition-colors"
        >
          {loading ? "Saving..." : "Complete Setup →"}
        </button>
      </form>
    </main>
  );
}
