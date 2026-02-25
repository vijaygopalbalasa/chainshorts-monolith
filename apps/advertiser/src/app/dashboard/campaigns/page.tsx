"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";
import { getCampaigns, setCampaignStatus, type Campaign } from "@/lib/api";
import { Plus, LayoutTemplate } from "lucide-react";

const FORMAT_LABELS: Record<string, string> = {
  classic: "Classic",
  banner: "Banner",
  spotlight: "Spotlight",
  portrait: "Portrait",
};

const PLACEMENT_LABELS: Record<string, string> = {
  feed: "Feed",
  predict: "Predict",
  both: "Feed + Predict",
};

const GOAL_LABELS: Record<string, string> = {
  traffic: "Traffic",
  lead_gen: "Lead Gen",
  action: "Action",
};

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    getCampaigns(token)
      .then(({ campaigns: c }) => setCampaigns(c))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load campaigns");
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handlePause = async (id: string) => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    setActionId(id);
    setError(null);
    setNotice(null);
    try {
      await setCampaignStatus(token, id, false);
      setCampaigns(c => c.map(x => x.id === id ? { ...x, isActive: false } : x));
      setNotice("Campaign paused.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to deactivate campaign.");
    } finally {
      setActionId(null);
    }
  };

  const handleResume = async (id: string) => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    setActionId(id);
    setError(null);
    setNotice(null);
    try {
      await setCampaignStatus(token, id, true);
      setCampaigns(c => c.map(x => x.id === id ? { ...x, isActive: true } : x));
      setNotice("Campaign resumed.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reactivate campaign.");
    } finally {
      setActionId(null);
    }
  };

  const getCampaignStatus = (c: Campaign): { label: string; statusClass: string } => {
    if (c.approvalStatus === "pending" || c.billingStatus === "approval_pending") {
      return { label: "UNDER REVIEW", statusClass: "bg-amber-100 text-amber-800" };
    }
    if (c.approvalStatus === "rejected") {
      return { label: "REJECTED", statusClass: "bg-red-100 text-red-800" };
    }
    if (c.billingStatus === "payment_required") {
      return { label: "PAYMENT REQUIRED", statusClass: "bg-violet-100 text-violet-800" };
    }
    if (!c.isActive) return { label: "PAUSED", statusClass: "bg-gray-100 text-gray-600" };
    const now = Date.now();
    if (new Date(c.startsAt).getTime() > now) return { label: "SCHEDULED", statusClass: "bg-blue-100 text-blue-700" };
    if (new Date(c.endsAt).getTime() < now) return { label: "ENDED", statusClass: "bg-gray-100 text-gray-500" };
    return { label: "ACTIVE", statusClass: "bg-green-100 text-green-800" };
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Campaigns</h1>
        <button
          onClick={() => router.push("/dashboard/new")}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all shadow-sm"
        >
          <Plus size={16} /> New Campaign
        </button>
      </div>

      {notice ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-700">
          Failed to load campaigns: {error}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-2xl p-20 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
            <LayoutTemplate className="w-8 h-8 text-green-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">No Campaigns Yet</h2>
          <p className="text-gray-500 max-w-sm mb-6 text-sm">Create your first sponsored card to start reaching users.</p>
          <button onClick={() => router.push("/dashboard/new")} className="bg-green-600 text-white px-5 py-2 rounded-lg font-bold text-sm">Create Campaign</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map(c => {
            const status = getCampaignStatus(c);
            const impressionCount = c.impressionCount;
            const impressionLimit = c.impressionLimit;
            const clickCount = c.clickCount;
            const leadCount = c.leadCount;
            const ctr = clickCount > 0 && impressionCount > 0
              ? ((clickCount / impressionCount) * 100).toFixed(1)
              : "0.0";
            const isEnded = new Date(c.endsAt).getTime() < Date.now();
            const billingAmount = (c.billingAmountUsdc ?? c.billingAmountSkr ?? 0);

            return (
              <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                {/* Header row */}
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.statusClass}`}>
                    {status.label}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/${c.id}`)}
                      className="text-sm text-gray-700 hover:text-gray-900 font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                    >
                      View
                    </button>
                    {c.billingStatus === "payment_required" && (
                      <button
                        type="button"
                        onClick={() => router.push("/dashboard/billing")}
                        className="text-sm text-violet-700 hover:text-violet-800 font-medium px-2 py-1 rounded hover:bg-violet-50 transition-colors"
                      >
                        Pay
                      </button>
                    )}
                    {c.isActive ? (
                      <button
                        onClick={() => void handlePause(c.id)}
                        disabled={actionId === c.id}
                        className="text-sm text-red-600 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {actionId === c.id ? "..." : "Pause"}
                      </button>
                    ) : (
                      <button
                        onClick={() => void handleResume(c.id)}
                        className="text-sm text-green-700 hover:text-green-800 font-medium px-2 py-1 rounded hover:bg-green-50 transition-colors disabled:opacity-50"
                        disabled={
                          actionId === c.id ||
                          isEnded ||
                          c.approvalStatus !== "approved" ||
                          c.billingStatus === "payment_required" ||
                          c.billingStatus === "approval_pending"
                        }
                        title={
                          isEnded
                            ? "Cannot reactivate an ended campaign"
                            : c.approvalStatus === "rejected"
                            ? "This campaign was rejected by admin review"
                            : c.approvalStatus !== "approved" || c.billingStatus === "approval_pending"
                            ? "Wait for admin approval before activating"
                            : c.billingStatus === "payment_required"
                            ? "Complete billing before activating"
                            : "Reactivate"
                        }
                      >
                        {actionId === c.id ? "..." : "Resume"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Campaign headline */}
                <h3 className="text-gray-900 font-semibold text-base mb-1 line-clamp-1">{c.headline}</h3>

                {/* Tags */}
                <div className="flex gap-2 mb-4 flex-wrap">
                  <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">{FORMAT_LABELS[c.cardFormat] ?? c.cardFormat}</span>
                  <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">{PLACEMENT_LABELS[c.placement] ?? c.placement}</span>
                  <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">{GOAL_LABELS[c.campaignGoal] ?? c.campaignGoal}</span>
                </div>

                {/* Impression progress bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{impressionCount.toLocaleString()} impressions</span>
                    <span>{impressionLimit ? impressionLimit.toLocaleString() : "\u221E"} limit</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-1.5">
                    <div className="bg-green-500 rounded-full h-1.5 transition-all"
                         style={{ width: `${Math.min(100, impressionLimit ? (impressionCount / impressionLimit) * 100 : 0)}%` }} />
                  </div>
                </div>

                {/* Stats row */}
                <div className="flex gap-4 text-sm border-t border-gray-100 pt-3">
                  <div><span className="text-gray-500">CTR</span> <span className="font-semibold text-gray-900">{ctr}%</span></div>
                  <div><span className="text-gray-500">Clicks</span> <span className="font-semibold text-gray-900">{clickCount}</span></div>
                  {c.campaignGoal === "lead_gen" && <div><span className="text-gray-500">Leads</span> <span className="font-semibold text-gray-900">{leadCount}</span></div>}
                  <div className="ml-auto"><span className="text-gray-500">Budget</span> <span className="font-semibold text-gray-900">${(billingAmount / 100).toFixed(2)} USDC</span></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
