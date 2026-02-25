"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken, getStoredUser } from "@/lib/auth";
import { createCampaign, type CreateCampaignInput } from "@/lib/api";
import { AdPreview } from "@/components/AdPreview";

// Helper to correctly display local time in the datetime-local input
const toLocalInputFormat = (isoString?: string) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const isValidActionUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("solana-action:")) {
    const inner = trimmed.slice("solana-action:".length);
    try {
      const parsed = new URL(inner);
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
};

function estimateInvoice(input: Partial<CreateCampaignInput>): { impressionLimit: number; amountCents: number } {
  const impressionLimit = input.impressionLimit && input.impressionLimit > 0 ? input.impressionLimit : 5000;
  const baseCpmCents =
    input.cardFormat === "banner" ? 800
    : input.cardFormat === "spotlight" ? 1500
    : input.cardFormat === "portrait" ? 2500
    : 500; // classic
  const placementMultiplier =
    input.placement === "predict"
      ? 150
      : input.placement === "both"
      ? 225
      : 100;
  const pricedCpmCents = Math.max(1, Math.ceil((baseCpmCents * placementMultiplier) / 100));
  const amountCents = Math.max(1, Math.ceil(impressionLimit / 1000) * pricedCpmCents);
  return { impressionLimit, amountCents };
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = getStoredUser();
  const advertiserName = user?.companyName ?? "Verified Advertiser";
  const [form, setForm] = useState<Partial<CreateCampaignInput>>({
    ctaText: "Learn More",
    accentColor: "#10b981",
    cardFormat: "classic",
    placement: "feed",
    targetAudience: "all",
    campaignGoal: "traffic",
  });
  const invoiceEstimate = estimateInvoice(form);

  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
  }, [router]);

  const update = (field: keyof CreateCampaignInput) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm(f => ({ ...f, [field]: e.target.value }));

  // Auto-update CTA based on goal
  useEffect(() => {
    if (form.campaignGoal === "lead_gen" && form.ctaText === "Learn More") {
      setForm(f => ({ ...f, ctaText: "Claim Airdrop" }));
    }
  }, [form.campaignGoal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    if (!form.headline || !form.destinationUrl || !form.endsAt) {
      setError("Please fill in all required fields.");
      return;
    }
    if (form.cardFormat !== "portrait" && !form.bodyText) {
      setError("Please fill in the body text.");
      return;
    }
    if (form.cardFormat === "portrait" && !form.imageUrl?.trim()) {
      setError("Portrait format requires an image URL.");
      return;
    }
    if (form.campaignGoal === "action" && !isValidActionUrl(form.actionUrl ?? "")) {
      setError("Action URL must be https://... or solana-action:https://...");
      return;
    }
    if (new Date(form.endsAt).getTime() <= Date.now()) {
      setError("Campaign end date must be in the future.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload: any = { ...form };
      // Strip empty strings from optional fields so backend Zod validation doesn't fail
      if (!payload.imageUrl?.trim()) delete payload.imageUrl;
      if (!payload.startsAt) delete payload.startsAt;
      if (!payload.impressionLimit) delete payload.impressionLimit;

      await createCampaign(token, payload as CreateCampaignInput);
      router.replace("/dashboard");
    } catch (err: unknown) {
      setError((err as Error).message ?? "Failed to create campaign.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Nav bar */}
      <nav className="sticky top-0 z-20 bg-white border-b border-gray-200 h-16 flex items-center px-6 shadow-sm gap-4">
        <button
          onClick={() => router.back()}
          className="text-gray-500 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          Back
        </button>
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Chainshorts" className="w-6 h-6 rounded-md" />
          <span className="font-semibold text-sm text-gray-900">Chainshorts</span>
          <span className="text-gray-300 mx-1">/</span>
          <span className="text-gray-600 tracking-wider uppercase text-sm font-medium">New Campaign</span>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 mt-8">
        <div className="flex flex-col lg:flex-row gap-10 items-start">
          {/* Form */}
          <form onSubmit={(e) => { void handleSubmit(e); }} className="flex-1 w-full space-y-6">
            <FormSection number={1} title="Identity">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">
                  Advertiser Profile
                </div>
                <div className="text-gray-900 font-semibold">
                  {advertiserName}
                </div>
              </div>
            </FormSection>

            <FormSection number={2} title="Content">
              <FormField label="Headline" required hint="Main message" maxLen={120} current={(form.headline ?? "").length}>
                <input
                  type="text"
                  value={form.headline ?? ""}
                  onChange={update("headline")}
                  required
                  maxLength={120}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow"
                  placeholder="E.g., The Next Generation of DeFi"
                />
              </FormField>
              {form.cardFormat !== "portrait" && (
                <FormField label="Body Text" required hint="Ad copy" maxLen={400} current={(form.bodyText ?? "").length}>
                  <textarea
                    value={form.bodyText ?? ""}
                    onChange={update("bodyText")}
                    required
                    maxLength={400}
                    rows={4}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow resize-y"
                    placeholder="Describe your offer in detail..."
                  />
                </FormField>
              )}
              <FormField label={`Ad Image ${form.cardFormat === "portrait" ? "" : ""}`} hint={form.cardFormat === "portrait" ? undefined : "Optional HTTPS image"}>
                <div className="flex items-baseline justify-between mb-0">
                  {form.cardFormat === "portrait" && (
                    <span className="text-red-500 text-xs font-semibold mb-1">Required for portrait format</span>
                  )}
                </div>
                <input
                  type="url"
                  value={form.imageUrl ?? ""}
                  onChange={update("imageUrl")}
                  required={form.cardFormat === "portrait"}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow"
                  placeholder="https://..."
                />
              </FormField>
            </FormSection>

            <FormSection number={3} title="Targeting & Objective">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField label="Campaign Goal" hint="How you drive conversions">
                  <select
                    value={form.campaignGoal ?? "traffic"}
                    onChange={update("campaignGoal")}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow appearance-none cursor-pointer font-semibold"
                  >
                    <option value="traffic">Traffic (CPM) - Link to website</option>
                    <option value="lead_gen">Lead Generation (CPL) - Collect Wallets</option>
                    <option value="action">In-Feed Action (CPA) - Solana Blinks</option>
                  </select>
                </FormField>
                <FormField label="Target Audience" hint="Premium tagging">
                  <select
                    value={form.targetAudience ?? "all"}
                    onChange={update("targetAudience")}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow appearance-none cursor-pointer font-semibold"
                  >
                    <option value="all">All Web3 Users</option>
                    <option value="defi_degens">DeFi Degens</option>
                    <option value="nft_collectors">NFT Collectors</option>
                    <option value="whales">Whales</option>
                  </select>
                </FormField>
                <FormField label="Placement" hint="Where this card appears">
                  <select
                    value={form.placement ?? "feed"}
                    onChange={update("placement")}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow appearance-none cursor-pointer font-semibold"
                  >
                    <option value="feed">Feed tab only</option>
                    <option value="predict">Predict tab only</option>
                    <option value="both">Feed + Predict</option>
                  </select>
                </FormField>
              </div>

              {form.campaignGoal === "action" && (
                <FormField label="Action URL" required hint="Solana Actions API Endpoint">
                  <input
                    type="text"
                    value={form.actionUrl ?? ""}
                    onChange={update("actionUrl")}
                    required
                    className="w-full px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow font-mono"
                    placeholder="solana-action:https://..."
                  />
                </FormField>
              )}
            </FormSection>

            <FormSection number={4} title="CTA & Style">
              <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-xs text-green-900">
                Recommended patterns: `classic + traffic` for partner deep-dives, `classic/banner + lead_gen` for alpha drops,
                `banner + action` for in-feed actions, `spotlight + predict` for high-impact predict-tab sponsorship, and `portrait` for immersive full-screen ads.
              </div>
              <FormField label="CTA Button Text" maxLen={30} current={(form.ctaText ?? "").length}>
                <input
                  type="text"
                  value={form.ctaText ?? "Learn More"}
                  onChange={update("ctaText")}
                  maxLength={30}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow"
                />
              </FormField>
              <FormField label="Destination URL" required hint="Where clicking takes the user">
                <input
                  type="url"
                  value={form.destinationUrl ?? ""}
                  onChange={update("destinationUrl")}
                  required
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow"
                  placeholder="https://..."
                />
              </FormField>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Accent Color">
                  <div className="flex gap-3 items-center">
                    <input
                      type="color"
                      value={form.accentColor ?? "#10b981"}
                      onChange={update("accentColor")}
                      className="w-12 h-12 rounded-xl cursor-pointer border-0 p-0"
                    />
                    <input
                      type="text"
                      value={form.accentColor ?? "#10b981"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v || /^#[0-9A-Fa-f]{0,6}$/.test(v)) {
                          setForm((f) => ({ ...f, accentColor: v }));
                        }
                      }}
                      maxLength={7}
                      className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow font-mono uppercase"
                    />
                  </div>
                </FormField>
                <FormField label="Ad Format">
                  <select
                    value={form.cardFormat ?? "classic"}
                    onChange={update("cardFormat")}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow appearance-none cursor-pointer"
                  >
                    <option value="classic">Classic (Image + Text)</option>
                    <option value="banner">Banner (Wide Header)</option>
                    <option value="spotlight">Spotlight (Hero Image)</option>
                    <option value="portrait">Portrait (Full-Screen)</option>
                  </select>
                </FormField>
              </div>
            </FormSection>

            <FormSection number={5} title="Schedule">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Start Date" hint="Blank = immediate">
                  <input
                    type="datetime-local"
                    value={toLocalInputFormat(form.startsAt)}
                    onChange={e => setForm(f => ({ ...f, startsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow"
                  />
                </FormField>
                <FormField label="End Date" required>
                  <input
                    type="datetime-local"
                    value={toLocalInputFormat(form.endsAt)}
                    onChange={e => setForm(f => ({ ...f, endsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                    required
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow"
                  />
                </FormField>
              </div>
              <FormField label="Impression Cap" hint="Max impressions — blank uses the default paid package">
                <input
                  type="number"
                  value={form.impressionLimit ?? ""}
                  onChange={e => setForm(f => ({ ...f, impressionLimit: e.target.value ? Number(e.target.value) : undefined }))}
                  min={100}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-shadow"
                  placeholder="Default package"
                />
              </FormField>
            </FormSection>

            <section className="rounded-2xl border border-green-200 bg-green-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-green-700">Billing Preview</p>
                  <p className="mt-1 text-sm text-green-900">
                    Admin reviews the creative first. After approval, this invoice must be paid in USDC before the campaign can go live.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold uppercase tracking-wider text-green-700">Estimated Invoice</p>
                  <p className="mt-1 text-2xl font-extrabold text-green-900">
                    ${(invoiceEstimate.amountCents / 100).toFixed(2)} USDC
                  </p>
                  <p className="text-xs text-green-700">
                    for {invoiceEstimate.impressionLimit.toLocaleString()} impressions
                  </p>
                </div>
              </div>
            </section>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-xl text-base font-bold shadow-sm transition-colors"
            >
              {loading ? "Launching..." : "Launch Campaign"}
            </button>
          </form>

          {/* Live Preview */}
          <div className="w-full lg:w-[320px] shrink-0 lg:sticky lg:top-24">
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-3 ml-1">
              Live Preview
            </div>
            <div className="bg-white p-2 rounded-[2rem] border border-gray-200 shadow-xl inline-block mx-auto lg:mx-0">
              <AdPreview
                key={form.cardFormat}
                advertiserName={advertiserName}
                headline={form.headline}
                bodyText={form.bodyText}
                imageUrl={form.imageUrl}
                ctaText={form.ctaText}
                accentColor={form.accentColor}
                destinationUrl={form.destinationUrl}
                cardFormat={form.cardFormat as "classic" | "banner" | "spotlight" | "portrait"}
                campaignGoal={form.campaignGoal as "traffic" | "action" | "lead_gen"}
                placement={form.placement as "feed" | "predict" | "both"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormSection({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6 border-b border-gray-100 pb-4">
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold font-mono text-sm">
          {number}
        </div>
        <h2 className="text-gray-900 font-bold text-lg tracking-tight">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function FormField({
  label,
  hint,
  required,
  maxLen,
  current,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  maxLen?: number;
  current?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-gray-700 text-sm font-bold">
          {label}
          {required && <span className="text-green-500 ml-1">*</span>}
          {hint && (
            <span className="text-gray-400 font-normal ml-2 text-xs">
              {hint}
            </span>
          )}
        </label>
        {maxLen !== undefined && current !== undefined && (
          <span className={`text-xs font-mono ${current > maxLen ? "text-red-500" : "text-gray-400"}`}>
            {current}/{maxLen}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
