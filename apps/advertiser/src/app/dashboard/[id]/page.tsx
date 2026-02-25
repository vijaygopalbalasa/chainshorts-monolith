"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { getToken } from "@/lib/auth";
import { getCampaign, setCampaignStatus, updateCampaign, type CampaignDetail, type UpdateCampaignInput } from "@/lib/api";
import { AdPreview } from "@/components/AdPreview";
import { ArrowLeft, ExternalLink, ShieldAlert, BarChart3, MousePointerClick, Activity, UserCheck } from "lucide-react";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [editForm, setEditForm] = useState({
    headline: "",
    bodyText: "",
    imageUrl: "",
    destinationUrl: "",
    ctaText: "Learn More",
    accentColor: "#10b981",
    cardFormat: "classic" as "classic" | "banner" | "spotlight" | "portrait",
    placement: "feed" as "feed" | "predict" | "both",
    targetAudience: "all" as "all" | "defi_degens" | "whales" | "nft_collectors",
    campaignGoal: "traffic" as "traffic" | "action" | "lead_gen",
    actionUrl: "",
    endsAt: "",
    impressionLimit: "",
  });

  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }

    getCampaign(token, id)
      .then(({ campaign: c }) => {
        setCampaign(c);
        setEditForm({
          headline: c.headline,
          bodyText: c.bodyText,
          imageUrl: c.imageUrl ?? "",
          destinationUrl: c.destinationUrl,
          ctaText: c.ctaText,
          accentColor: c.accentColor,
          cardFormat: c.cardFormat as "classic" | "banner" | "spotlight" | "portrait",
          placement: c.placement as "feed" | "predict" | "both",
          targetAudience: c.targetAudience as "all" | "defi_degens" | "whales" | "nft_collectors",
          campaignGoal: c.campaignGoal as "traffic" | "action" | "lead_gen",
          actionUrl: c.actionUrl ?? "",
          endsAt: toLocalInput(c.endsAt),
          impressionLimit: c.impressionLimit ? String(c.impressionLimit) : "",
        });
      })
      .catch(() => router.replace("/dashboard"))
      .finally(() => setLoading(false));
  }, [id, router]);

  const handleSetStatus = async (active: boolean) => {
    const token = getToken();
    if (!token) { router.replace("/login"); return; }
    setStatusLoading(true);
    setEditError(null);
    setNotice(null);
    try {
      await setCampaignStatus(token, id, active);
      setCampaign((prev) => (prev ? { ...prev, isActive: active } : prev));
      setNotice(active ? "Campaign reactivated." : "Campaign deactivated.");
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : (active ? "Unable to reactivate this campaign." : "Unable to deactivate this campaign."));
    } finally {
      setStatusLoading(false);
    }
  };

  const handleSaveEdits = async () => {
    const token = getToken();
    if (!token || !campaign) return;
    setSavingEdit(true);
    setEditError(null);
    setNotice(null);

    try {
      if (!editForm.headline.trim() || (campaign?.cardFormat !== "portrait" && !editForm.bodyText.trim()) || !editForm.destinationUrl.trim() || !editForm.endsAt) {
        throw new Error("Please complete all required fields.");
      }
      const endsAtIso = new Date(editForm.endsAt).toISOString();
      if (Number.isNaN(new Date(endsAtIso).getTime())) {
        throw new Error("Invalid end date.");
      }
      let impressionLimit: number | null = null;
      if (editForm.impressionLimit.trim()) {
        const parsed = Number.parseInt(editForm.impressionLimit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("Impression limit must be a positive integer.");
        }
        impressionLimit = parsed;
      }

      const payload: UpdateCampaignInput = {
        headline: editForm.headline.trim(),
        bodyText: editForm.bodyText.trim(),
        imageUrl: editForm.imageUrl.trim() ? editForm.imageUrl.trim() : null,
        destinationUrl: editForm.destinationUrl.trim(),
        ctaText: editForm.ctaText.trim(),
        accentColor: editForm.accentColor.trim(),
        cardFormat: editForm.cardFormat,
        placement: editForm.placement,
        targetAudience: editForm.targetAudience,
        campaignGoal: editForm.campaignGoal,
        actionUrl: editForm.campaignGoal === "action"
          ? (editForm.actionUrl.trim() ? editForm.actionUrl.trim() : null)
          : null,
        endsAt: endsAtIso,
        impressionLimit,
      };

      await updateCampaign(token, id, payload);
      const refreshed = await getCampaign(token, id);
      const next = refreshed.campaign;
      setCampaign(next);
      setEditForm({
        headline: next.headline,
        bodyText: next.bodyText,
        imageUrl: next.imageUrl ?? "",
        destinationUrl: next.destinationUrl,
        ctaText: next.ctaText,
        accentColor: next.accentColor,
        cardFormat: next.cardFormat as "classic" | "banner" | "spotlight" | "portrait",
        placement: next.placement as "feed" | "predict" | "both",
        targetAudience: next.targetAudience as "all" | "defi_degens" | "whales" | "nft_collectors",
        campaignGoal: next.campaignGoal as "traffic" | "action" | "lead_gen",
        actionUrl: next.actionUrl ?? "",
        endsAt: toLocalInput(next.endsAt),
        impressionLimit: next.impressionLimit ? String(next.impressionLimit) : "",
      });
      setEditMode(false);
      setNotice("Campaign updated. It is now pending admin review.");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update campaign.");
    } finally {
      setSavingEdit(false);
    }
  };

  const getStatusBadge = (c: CampaignDetail): { label: string; statusClass: string } => {
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

  const getBillingStatusBadge = (c: CampaignDetail): { label: string; statusClass: string } => {
    if (c.billingStatus === "paid") return { label: "PAID", statusClass: "bg-green-100 text-green-800" };
    if (c.billingStatus === "payment_required") return { label: "PAYMENT REQUIRED", statusClass: "bg-violet-100 text-violet-800" };
    if (c.billingStatus === "approval_pending") return { label: "PENDING APPROVAL", statusClass: "bg-amber-100 text-amber-800" };
    return { label: "NOT REQUIRED", statusClass: "bg-gray-100 text-gray-600" };
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <nav className="sticky top-0 z-20 bg-white border-b border-gray-200 h-16 flex items-center px-6 shadow-sm">
        <div className="h-8 w-24 bg-gray-100 animate-pulse rounded" />
      </nav>
      <div className="max-w-6xl mx-auto px-6 mt-8">
        <div className="h-10 w-1/3 bg-gray-200 animate-pulse rounded-xl mb-8" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 h-24 animate-pulse" />
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6 h-96 animate-pulse" />
      </div>
    </div>
  );

  if (!campaign) return null;

  const ctr = campaign.impressionCount > 0 && campaign.clickCount > 0
    ? ((campaign.clickCount / campaign.impressionCount) * 100).toFixed(1)
    : "0.0";
  const status = getStatusBadge(campaign);
  const billingBadge = getBillingStatusBadge(campaign);
  const billingAmount = (campaign.billingAmountUsdc ?? campaign.billingAmountSkr ?? 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Nav bar */}
      <nav className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-200 h-16 flex items-center justify-between px-6 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="text-gray-500 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg text-sm font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="hidden sm:flex items-center gap-2.5">
            <img src="/logo.png" alt="Chainshorts" className="w-6 h-6 rounded-md" />
            <span className="font-semibold text-sm text-gray-900">Chainshorts</span>
            <span className="text-gray-300 mx-1">/</span>
            <span className="text-gray-600 tracking-wider uppercase text-sm font-medium">Campaign</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditMode((prev) => !prev);
              setEditError(null);
              setNotice(null);
            }}
            className="flex items-center gap-1.5 bg-white border border-gray-200 px-4 py-1.5 rounded-lg text-sm font-bold text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            {editMode ? "Cancel Edit" : "Edit Campaign"}
          </button>
          <button
            onClick={() => void handleSetStatus(!campaign.isActive)}
            disabled={statusLoading || (!campaign.isActive && (campaign.approvalStatus !== "approved" || campaign.billingStatus === "payment_required" || campaign.billingStatus === "approval_pending"))}
            className={`flex items-center gap-1.5 bg-white border px-4 py-1.5 rounded-lg text-sm font-bold transition-all shadow-sm active:scale-95 ${
              campaign.isActive
                ? "text-red-600 hover:text-red-700 hover:bg-red-50 border-gray-200 hover:border-red-200"
                : "text-green-700 hover:text-green-800 hover:bg-green-50 border-gray-200 hover:border-green-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            }`}
            title={
              !campaign.isActive && campaign.approvalStatus !== "approved"
                ? "Admin approval is still pending"
                : !campaign.isActive && campaign.billingStatus === "payment_required"
                ? "Complete payment before activating"
                : !campaign.isActive && campaign.billingStatus === "approval_pending"
                ? "Billing resets while the campaign is under review"
                : undefined
            }
          >
            <ShieldAlert className="w-4 h-4" />
            {statusLoading ? "Working..." : campaign.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 mt-8">
        {/* Campaign title + status */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between mb-6">
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">
            {campaign.headline}
          </h1>
          <span className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 self-start sm:self-auto ${status.statusClass}`}>
            {status.label}
          </span>
        </div>

        {notice ? (
          <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {notice}
          </div>
        ) : null}
        {editError ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {editError}
          </div>
        ) : null}

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Impressions" value={`${campaign.impressionCount.toLocaleString()} / ${(campaign.impressionLimit || 0).toLocaleString()}`} icon={<BarChart3 className="w-5 h-5 text-green-600" />} />
          <StatCard label="CTR" value={`${ctr}%`} icon={<MousePointerClick className="w-5 h-5 text-green-600" />} />
          <StatCard label="Leads" value={campaign.leadCount?.toString() || "0"} icon={<UserCheck className="w-5 h-5 text-green-600" />} />
          <StatCard label="Budget" value={`$${(billingAmount / 100).toFixed(2)} USDC`} icon={<Activity className="w-5 h-5 text-green-600" />} />
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Left: Details */}
          <div className="flex-1 w-full space-y-6">
            {/* Billing section */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Billing</h2>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${billingBadge.statusClass}`}>
                  {billingBadge.label}
                </span>
                <span className="text-gray-900 font-semibold">${(billingAmount / 100).toFixed(2)} USDC</span>
                {campaign.billingStatus === "payment_required" && (
                  <Link href="/dashboard/billing" className="ml-auto bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-green-700">
                    Pay Now
                  </Link>
                )}
                {campaign.paymentTxSignature && (
                  <a href={`https://solscan.io/tx/${campaign.paymentTxSignature}`} target="_blank" rel="noopener noreferrer"
                     className="ml-auto text-green-600 text-sm hover:text-green-700">
                    View Transaction ↗
                  </a>
                )}
              </div>
              {campaign.paymentReceivedAt && (
                <p className="mt-2 text-xs text-gray-500">Paid {new Date(campaign.paymentReceivedAt).toLocaleString()}</p>
              )}
            </div>

            {/* Campaign Info section */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Campaign Info</h2>

              {campaign.approvalStatus === "rejected" && campaign.rejectionReason && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Rejection reason: {campaign.rejectionReason}
                </div>
              )}

              {editMode ? (
                <div className="space-y-3 border border-gray-200 rounded-xl p-4 bg-gray-50">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                      value={editForm.headline}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, headline: e.target.value }))}
                      placeholder="Headline"
                    />
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                      value={editForm.destinationUrl}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, destinationUrl: e.target.value }))}
                      placeholder="Destination URL"
                    />
                  </div>
                  <textarea
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                    rows={4}
                    value={editForm.bodyText}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, bodyText: e.target.value }))}
                    placeholder="Body text"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.ctaText}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, ctaText: e.target.value }))}
                      placeholder="CTA text"
                    />
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.accentColor}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, accentColor: e.target.value }))}
                      placeholder="#10b981"
                    />
                    <input
                      type="datetime-local"
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.endsAt}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, endsAt: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <select
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.cardFormat}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, cardFormat: e.target.value as "classic" | "banner" | "spotlight" | "portrait" }))}
                    >
                      <option value="classic">classic</option>
                      <option value="banner">banner</option>
                      <option value="spotlight">spotlight</option>
                      <option value="portrait">portrait</option>
                    </select>
                    <select
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.targetAudience}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, targetAudience: e.target.value as "all" | "defi_degens" | "whales" | "nft_collectors" }))}
                    >
                      <option value="all">all</option>
                      <option value="defi_degens">defi_degens</option>
                      <option value="whales">whales</option>
                      <option value="nft_collectors">nft_collectors</option>
                    </select>
                    <select
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.placement}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, placement: e.target.value as "feed" | "predict" | "both" }))}
                    >
                      <option value="feed">feed</option>
                      <option value="predict">predict</option>
                      <option value="both">both</option>
                    </select>
                    <select
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.campaignGoal}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, campaignGoal: e.target.value as "traffic" | "action" | "lead_gen" }))}
                    >
                      <option value="traffic">traffic</option>
                      <option value="action">action</option>
                      <option value="lead_gen">lead_gen</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.imageUrl}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, imageUrl: e.target.value }))}
                      placeholder="Image URL (optional)"
                    />
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.actionUrl}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, actionUrl: e.target.value }))}
                      placeholder="Action URL (optional)"
                    />
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={editForm.impressionLimit}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, impressionLimit: e.target.value }))}
                      placeholder="Impression limit"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveEdits()}
                      disabled={savingEdit}
                      className="rounded-lg bg-green-600 text-white text-sm font-semibold px-4 py-2 disabled:opacity-60 hover:bg-green-700"
                    >
                      {savingEdit ? "Saving..." : "Save Changes"}
                    </button>
                    <span className="text-xs text-gray-500">Saving sends campaign back to admin review.</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {[
                    { label: "Advertiser", value: campaign.advertiserName },
                    { label: "Goal", value: campaign.campaignGoal.toUpperCase() },
                    { label: "Targeting", value: campaign.targetAudience.replace('_', ' ').toUpperCase() },
                    { label: "Format", value: campaign.cardFormat },
                    { label: "Placement", value: campaign.placement.toUpperCase() },
                    { label: "Starts", value: new Date(campaign.startsAt).toLocaleString() },
                    { label: "Ends", value: new Date(campaign.endsAt).toLocaleString() },
                    { label: "Impression Cap", value: campaign.impressionLimit?.toLocaleString() ?? "Unlimited" },
                    { label: "Created", value: new Date(campaign.createdAt).toLocaleDateString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-baseline gap-4 py-2 border-b border-gray-50 last:border-0">
                      <span className="text-gray-500 text-xs font-bold w-32 shrink-0 uppercase tracking-wider">
                        {label}
                      </span>
                      <span className="text-gray-900 text-sm font-medium">{value}</span>
                    </div>
                  ))}
                  {/* Links */}
                  <div className="flex items-baseline gap-4 py-2 border-b border-gray-50">
                    <span className="text-gray-500 text-xs font-bold w-32 shrink-0 uppercase tracking-wider">Destination</span>
                    <a href={campaign.destinationUrl} target="_blank" rel="noopener noreferrer"
                       className="text-green-600 hover:text-green-700 text-sm font-medium hover:underline break-all flex items-center gap-1">
                      {campaign.destinationUrl}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  {campaign.campaignGoal === "action" && campaign.actionUrl && (
                    <div className="flex items-baseline gap-4 py-2 border-b border-gray-50">
                      <span className="text-gray-500 text-xs font-bold w-32 shrink-0 uppercase tracking-wider">Action URL</span>
                      <a href={campaign.actionUrl} target="_blank" rel="noopener noreferrer"
                         className="text-green-600 hover:text-green-700 text-sm font-medium hover:underline break-all flex items-center gap-1">
                        {campaign.actionUrl}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  {campaign.paymentTxSignature && (
                    <div className="flex items-baseline gap-4 py-2">
                      <span className="text-gray-500 text-xs font-bold w-32 shrink-0 uppercase tracking-wider">Payment Tx</span>
                      <a href={`https://solscan.io/tx/${campaign.paymentTxSignature}`} target="_blank" rel="noopener noreferrer"
                         className="text-green-600 hover:text-green-700 text-sm font-mono hover:underline break-all flex items-center gap-1">
                        {campaign.paymentTxSignature.slice(0, 12)}...{campaign.paymentTxSignature.slice(-6)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Preview sticky */}
          <div className="w-full lg:w-[320px] shrink-0 lg:sticky lg:top-24">
            <div className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mb-3 ml-2 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live Feed Preview
            </div>
            <div className="bg-white p-2 rounded-[2rem] border border-gray-200 shadow-xl inline-block mx-auto lg:mx-0">
              <AdPreview
                key={campaign.cardFormat}
                cardFormat={campaign.cardFormat as "classic" | "banner" | "spotlight" | "portrait"}
                advertiserName={campaign.advertiserName}
                headline={campaign.headline}
                bodyText={campaign.bodyText}
                imageUrl={campaign.imageUrl ?? undefined}
                ctaText={campaign.ctaText}
                accentColor={campaign.accentColor}
                destinationUrl={campaign.destinationUrl}
                campaignGoal={campaign.campaignGoal as "traffic" | "action" | "lead_gen"}
                placement={campaign.placement as "feed" | "predict" | "both"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">{label}</span>
        <div className="p-1.5 bg-green-50 rounded-md">{icon}</div>
      </div>
      <div className="text-gray-900 text-2xl font-bold">{value}</div>
    </div>
  );
}
