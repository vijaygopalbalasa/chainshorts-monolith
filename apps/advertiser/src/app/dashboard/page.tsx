"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";
import { getCampaigns, type Campaign } from "@/lib/api";
import { BarChart3, MousePointerClick, Activity, UserCheck } from "lucide-react";

export default function AdvertiserDashboard() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const totalImpressions = campaigns.reduce((s, c) => s + c.impressionCount, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.clickCount, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.leadCount, 0);
  const pendingReview = campaigns.filter((c) => c.approvalStatus === "pending").length;
  const rejected = campaigns.filter((c) => c.approvalStatus === "rejected").length;
  const awaitingPayment = campaigns.filter((c) => c.approvalStatus === "approved" && c.billingStatus === "payment_required").length;
  const outstandingUsdc = campaigns
    .filter((c) => c.approvalStatus === "approved" && c.billingStatus === "payment_required")
    .reduce((sum, c) => sum + (c.billingAmountUsdc ?? c.billingAmountSkr ?? 0), 0);
  const avgCtr = totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(2)}%` : "—";
  const leadRate = totalClicks > 0 ? `${((totalLeads / totalClicks) * 100).toFixed(2)}%` : "—";

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight mb-8">
        Overview
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="Total Impressions" value={loading ? "-" : totalImpressions.toLocaleString()} icon={<BarChart3 className="text-green-600" size={20} />} />
        <StatCard title="Total Clicks" value={loading ? "-" : totalClicks.toLocaleString()} icon={<MousePointerClick className="text-green-600" size={20} />} />
        <StatCard title="Avg. CTR" value={loading ? "-" : avgCtr} icon={<Activity className="text-green-600" size={20} />} accent />
        <StatCard title="Lead Conversion" value={loading ? "-" : leadRate} icon={<UserCheck className="text-green-600" size={20} />} />
      </div>

      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Operational Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Pending Review</p>
            <p className="mt-2 text-2xl font-extrabold text-amber-700">{loading ? "-" : pendingReview}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Rejected</p>
            <p className="mt-2 text-2xl font-extrabold text-red-700">{loading ? "-" : rejected}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Awaiting Payment</p>
            <p className="mt-2 text-2xl font-extrabold text-violet-700">
              {loading ? "-" : `${awaitingPayment} / $${(outstandingUsdc / 100).toFixed(2)} USDC`}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Data Health</p>
            <p className="mt-2 text-sm font-semibold text-gray-700">
              {error ? `Load error: ${error}` : "Metrics are live from campaign counters."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, accent }: { title: string; value: string | number; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl p-5 shadow-sm relative overflow-hidden ${accent ? "border-green-500 ring-1 ring-green-50" : "border-gray-200"}`}>
      {accent && <div className="absolute top-0 right-0 w-24 h-24 bg-green-50 rounded-bl-full -z-10 opacity-50" />}
      <div className="flex justify-between items-start mb-2">
        <div className="text-gray-500 text-xs font-bold uppercase tracking-wider">
          {title}
        </div>
        <div className="p-2 bg-green-50 rounded-lg">
          {icon}
        </div>
      </div>
      <div className="text-gray-900 text-3xl font-extrabold font-mono tracking-tight">
        {value}
      </div>
    </div>
  );
}
