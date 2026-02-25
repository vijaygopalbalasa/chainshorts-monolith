"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2, Globe, Save, CheckCircle } from "lucide-react";
import { getToken, getStoredUser, setStoredUser } from "@/lib/auth";
import { getMe, onboardMe } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    // Pre-fill from stored user first for instant render, then confirm with API
    const stored = getStoredUser();
    if (stored?.companyName) setCompanyName(stored.companyName);

    getMe(token)
      .then(({ advertiser }) => {
        setCompanyName(advertiser.companyName ?? "");
        setWebsiteUrl(advertiser.websiteUrl ?? "");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handleSave = async () => {
    const token = getToken();
    if (!token) return;

    const trimmedName = companyName.trim();
    const trimmedUrl = websiteUrl.trim();

    if (trimmedName.length < 2) {
      setError("Company name must be at least 2 characters.");
      return;
    }
    if (trimmedUrl && !/^https?:\/\/.+\..+/.test(trimmedUrl)) {
      setError("Website URL must be a valid URL (e.g. https://example.com).");
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const { advertiser } = await onboardMe(token, trimmedName, trimmedUrl || undefined);

      // Update local stored user so sidebar and other pages reflect the change
      const stored = getStoredUser();
      if (stored) {
        setStoredUser({ ...stored, companyName: advertiser.companyName });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your advertiser profile.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Advertiser Profile</h2>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {saved && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg flex items-center gap-2">
              <CheckCircle size={16} />
              Profile updated successfully.
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Company Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={loading ? "" : companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={loading ? "Loading..." : "Your company name"}
                disabled={loading || saving}
                maxLength={100}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">This name appears on your ads as the advertiser label.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Website URL <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <div className="relative">
              <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="url"
                value={loading ? "" : websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder={loading ? "Loading..." : "https://yourcompany.com"}
                disabled={loading || saving}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={loading || saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={15} />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Account</h2>
        </div>
        <div className="p-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500 font-medium">Wallet Address</span>
            <span className="font-mono text-gray-700 text-xs bg-gray-50 border border-gray-200 px-3 py-1 rounded-lg">
              {getStoredUser()?.walletAddress ?? "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
