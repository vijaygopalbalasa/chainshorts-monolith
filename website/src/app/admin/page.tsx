"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cpu,
  Database,
  Gavel,
  Loader2,
  Megaphone,
  MessageSquare,
  Settings2,
  Shield,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Wrench,
} from "lucide-react";

type AdminTab =
  | "overview"
  | "markets"
  | "disputes"
  | "economics"
  | "advertisers"
  | "sources"
  | "models"
  | "sponsored"
  | "feedback";

type PredictionMarket = {
  id: string;
  question: string;
  status: "active" | "resolved" | "cancelled";
  resolvedOutcome?: "yes" | "no";
  totalPoolSkr: number;
  stakersCount: number;
  deadlineAt: string;
  resolvedAt?: string;
  disputeFreeze: boolean;
  minStakeSkr: number;
  maxStakeSkr: number;
  platformFeePct: number;
};

type PredictionDispute = {
  id: string;
  pollId: string;
  wallet: string;
  status: "pending" | "investigating" | "upheld" | "rejected" | "expired";
  reason: string;
  createdAt: string;
  challengeDeadline: string;
};

type SourceRow = {
  id: string;
  name: string;
  feedUrl: string;
  active: boolean;
};

const ADMIN_FETCH_TIMEOUT_MS = 10_000;

type SourceHealthRow = {
  sourceId: string;
  sourceName: string;
  isActive: boolean;
  successRateLast24h: number;
  avgLatencyMs: number;
  articlesPublishedLast24h: number;
  lastError: string | null;
};

type AdvertiserRow = {
  id: string;
  walletAddress: string | null;
  companyName: string | null;
  websiteUrl: string | null;
  isOnboarded: boolean;
  accountStatus: "active" | "suspended";
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  campaignCount: number;
  activeCampaignCount: number;
  impressionCount: number;
  clickCount: number;
  leadCount: number;
  pendingInvoiceSkr: number;
  pendingInvoiceUsdc?: number;
  collectedRevenueSkr: number;
  collectedRevenueUsdc?: number;
};

type EconomicsSettings = {
  platformFeePct: number;
  disputeDepositSkr: number;
  challengeWindowHours: number;
  totalPlatformFees: number;
  pendingDisputes: number;
  totalDisputes: number;
};

type RevenueSummary = {
  totalFeeSkr: number;
  totalMarketsSettled: number;
  totalStakesSkr: number;
  totalPayoutsSkr: number;
  pendingPayoutsSkr: number;
  pendingPayoutsCount: number;
};

type AdminStatsExtended = {
  feed: { total: number; today: number; last24h: number; last7d: number };
  predictions: {
    activeMarkets: number;
    totalVolumeLast24h: number;
    totalVolumeAllTime: number;
    resolvedLast7d: number;
    platformFeesCollected: number;
  };
  pipeline: {
    callsLast24h: number;
    successesLast24h: number;
    avgLatencyMs: number;
  };
  users: {
    uniqueWallets: number;
    activeSessions: number;
    walletsWithSkr: number;
    avgChainRepScore: number;
  };
};

type ConfigRow = {
  key: string;
  value: string;
  category: string;
  label: string;
  description: string | null;
};

type OpenRouterModel = {
  id: string;
  name: string;
  provider: string;
  contextLength: number | null;
  pricingPrompt: number;
  pricingCompletion: number;
  isFree: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  moderation: string | null;
  lastSyncedAt: string;
  createdAt: string;
};

type ModelsPayload = {
  models: OpenRouterModel[];
  agentConfig: Record<string, string>;
  lastSync?: string;
};

type SponsoredCard = {
  id: string;
  advertiserName: string;
  headline: string;
  bodyText: string;
  imageUrl: string | null;
  destinationUrl: string;
  ctaText: string;
  accentColor: string;
  cardFormat: string;
  placement: "feed" | "predict" | "both";
  targetAudience: string;
  campaignGoal: string;
  actionUrl: string | null;
  startsAt: string;
  endsAt: string;
  impressionLimit: number | null;
  impressionCount: number;
  clickCount: number;
  leadCount: number;
  isActive: boolean;
  approvalStatus: "pending" | "approved" | "rejected";
  approvedAt: string | null;
  approvedBy: string | null;
  rejectionReason: string | null;
  billingAmountSkr: number;
  billingAmountUsdc?: number;
  billingStatus: "not_required" | "approval_pending" | "payment_required" | "paid";
  paymentTxSignature: string | null;
  paymentReceivedAt: string | null;
  createdAt: string;
};

type AdvertiserBillingRequest = {
  id: string;
  advertiserId: string;
  advertiserName: string;
  walletAddress: string | null;
  cardId: string;
  headline: string;
  requestType: "billing_review" | "refund_request";
  status: "open" | "reviewing" | "resolved" | "rejected";
  note: string;
  adminNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

type FeedbackRow = {
  id: string;
  wallet: string;
  type: "bug" | "suggestion" | "other";
  subject: string;
  message: string;
  appVersion: string | null;
  platform: "android" | "ios" | "web" | null;
  status: "new" | "reviewed" | "resolved";
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

type OrphanedPaymentRow = {
  id: string;
  txSignature: string;
  wallet: string;
  purpose: "prediction_stake" | "dispute_deposit" | "advertiser_campaign";
  expectedAmountSkr: number;
  referenceType: "poll" | "campaign";
  referenceId: string;
  failureReason: string;
  status: "open" | "reviewing" | "resolved";
  adminNotes: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type AdminActionDraft = {
  key: string;
  title: string;
  message: string;
  confirmLabel: string;
  doneMessage: string;
  variant?: "primary" | "ghost" | "danger";
  noteLabel?: string;
  notePlaceholder?: string;
  noteRequired?: boolean;
  noteValue: string;
  run: (note: string) => Promise<void>;
};

type AgentRole =
  | "relevance_filter"
  | "fact_checker"
  | "summarizer"
  | "summarizer_fallback"
  | "post_check";

const AGENT_ROLES: AgentRole[] = [
  "relevance_filter",
  "fact_checker",
  "summarizer",
  "summarizer_fallback",
  "post_check",
];

const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.chainshorts.live";
const ADMIN_TOKEN_STORAGE_KEY = "chainshorts_admin_token_v1";
const ADMIN_BASE_STORAGE_KEY = "chainshorts_admin_api_base_v1";

function normalizeApiBase(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function toLocalDateTimeInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toWalletPreview(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function fmt(n: number | undefined | null): string {
  return Number(n ?? 0).toLocaleString();
}

function fmtPct(n: number | undefined | null): string {
  return `${Number(n ?? 0).toFixed(2)}%`;
}

function fmtDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

async function adminFetch<T>(
  apiBase: string,
  token: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ADMIN_FETCH_TIMEOUT_MS);
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(`${normalizeApiBase(apiBase)}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-admin-token": token,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", abortFromUpstream);
    }
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      className="w-full rounded-lg border px-3 py-2 text-sm"
      style={{
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
        color: "var(--color-text)",
      }}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      type={type}
    />
  );
}

function Button({
  label,
  onClick,
  disabled,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
}) {
  const palette =
    variant === "danger"
      ? { background: "#fef2f2", border: "#fecaca", color: "#b91c1c" }
      : variant === "ghost"
      ? { background: "transparent", border: "var(--color-border)", color: "var(--color-text)" }
      : { background: "var(--color-violet)", border: "var(--color-violet)", color: "#fff" };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg border px-3 py-2 text-sm font-semibold transition"
      style={{
        background: palette.background,
        borderColor: palette.border,
        color: palette.color,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

export default function AdminPage() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [stats, setStats] = useState<AdminStatsExtended | null>(null);
  const [economics, setEconomics] = useState<EconomicsSettings | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [disputes, setDisputes] = useState<PredictionDispute[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealthRow[]>([]);
  const [advertisers, setAdvertisers] = useState<AdvertiserRow[]>([]);
  const [configRows, setConfigRows] = useState<ConfigRow[]>([]);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelLastSync, setModelLastSync] = useState<string | undefined>();
  const [sponsoredCards, setSponsoredCards] = useState<SponsoredCard[]>([]);
  const [billingRequests, setBillingRequests] = useState<AdvertiserBillingRequest[]>([]);
  const [feedbackList, setFeedbackList] = useState<FeedbackRow[]>([]);
  const [feedbackNotes, setFeedbackNotes] = useState<Record<string, string>>({});
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);
  const [orphanedPayments, setOrphanedPayments] = useState<OrphanedPaymentRow[]>([]);
  const [orphanedPaymentNotes, setOrphanedPaymentNotes] = useState<Record<string, string>>({});

  const [marketStatusFilter, setMarketStatusFilter] = useState<"all" | "active" | "resolved" | "cancelled">("all");
  const [disputeStatusFilter, setDisputeStatusFilter] = useState<"all" | "pending" | "investigating" | "upheld" | "rejected" | "expired">("all");
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<"all" | "new" | "reviewed" | "resolved">("all");
  const [orphanedPaymentStatusFilter, setOrphanedPaymentStatusFilter] = useState<"all" | "open" | "reviewing" | "resolved">("open");

  const [newMarketQuestion, setNewMarketQuestion] = useState("");
  const [newMarketDeadline, setNewMarketDeadline] = useState("");
  const [newMarketMin, setNewMarketMin] = useState("10");
  const [newMarketMax, setNewMarketMax] = useState("1000");
  const [newMarketFee, setNewMarketFee] = useState("5");

  const [resolveNote, setResolveNote] = useState("");
  const [disputeNotes, setDisputeNotes] = useState<Record<string, string>>({});

  const [econFee, setEconFee] = useState("5");
  const [econDeposit, setEconDeposit] = useState("50");
  const [econWindow, setEconWindow] = useState("48");

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceHome, setNewSourceHome] = useState("");
  const [newSourceFeed, setNewSourceFeed] = useState("");

  const [editingConfig, setEditingConfig] = useState<Record<string, string>>({});
  const [marketLimits, setMarketLimits] = useState<Record<string, { min: string; max: string }>>({});
  const [editingAgentConfig, setEditingAgentConfig] = useState<Record<string, string>>({});

  const [sponsoredAdvertiserName, setSponsoredAdvertiserName] = useState("");
  const [sponsoredHeadline, setSponsoredHeadline] = useState("");
  const [sponsoredBodyText, setSponsoredBodyText] = useState("");
  const [sponsoredDestinationUrl, setSponsoredDestinationUrl] = useState("");
  const [sponsoredImageUrl, setSponsoredImageUrl] = useState("");
  const [sponsoredCtaText, setSponsoredCtaText] = useState("Learn More");
  const [sponsoredAccentColor, setSponsoredAccentColor] = useState("#14F195");
  const [sponsoredCardFormat, setSponsoredCardFormat] = useState<"classic" | "banner" | "spotlight">("classic");
  const [sponsoredPlacement, setSponsoredPlacement] = useState<"feed" | "predict" | "both">("feed");
  const [sponsoredAudience, setSponsoredAudience] = useState<"all" | "defi_degens" | "whales" | "nft_collectors">("all");
  const [sponsoredGoal, setSponsoredGoal] = useState<"traffic" | "action" | "lead_gen">("traffic");
  const [sponsoredActionUrl, setSponsoredActionUrl] = useState("");
  const [sponsoredImpressionLimit, setSponsoredImpressionLimit] = useState("");
  const [sponsoredEndsAt, setSponsoredEndsAt] = useState(() =>
    toLocalDateTimeInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
  );
  const [billingRequestFilter, setBillingRequestFilter] = useState<"all" | "open" | "reviewing" | "resolved" | "rejected">("all");
  const [pendingAdminAction, setPendingAdminAction] = useState<AdminActionDraft | null>(null);

  const clearNotices = () => {
    setError(null);
    setSuccess(null);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    clearNotices();
    try {
      const requests = [
        ["stats", adminFetch<AdminStatsExtended>(apiBase, token, "/v1/admin/stats/extended")],
        ["economics", adminFetch<EconomicsSettings>(apiBase, token, "/v1/admin/predictions/economics")],
        ["revenue", adminFetch<RevenueSummary>(apiBase, token, "/v1/admin/predictions/revenue")],
        ["markets", adminFetch<{ items: PredictionMarket[] }>(apiBase, token, "/v1/admin/predictions/markets?limit=500")],
        ["disputes", adminFetch<{ items: PredictionDispute[] }>(apiBase, token, "/v1/admin/predictions/disputes?limit=500")],
        ["sources", adminFetch<{ sources: SourceRow[] }>(apiBase, token, "/v1/admin/sources")],
        ["source health", adminFetch<{ sources: SourceHealthRow[] }>(apiBase, token, "/v1/admin/sources/health")],
        ["advertisers", adminFetch<{ advertisers: AdvertiserRow[] }>(apiBase, token, "/v1/admin/advertisers")],
        ["config", adminFetch<{ settings: Record<string, ConfigRow[]> }>(apiBase, token, "/v1/admin/config")],
        ["models", adminFetch<ModelsPayload>(apiBase, token, "/v1/admin/models")],
        ["sponsored", adminFetch<{ cards: SponsoredCard[] }>(apiBase, token, "/v1/admin/sponsored")],
        ["billing requests", adminFetch<{ requests: AdvertiserBillingRequest[] }>(apiBase, token, "/v1/admin/advertiser-billing/requests")],
        ["feedback", adminFetch<{ feedback: FeedbackRow[] }>(apiBase, token, "/v1/admin/feedback?limit=200")],
        ["manual payment review", adminFetch<{ payments: OrphanedPaymentRow[] }>(apiBase, token, "/v1/admin/orphan-payments?limit=200")],
      ] as const;
      const results = await Promise.allSettled(requests.map(([, request]) => request));
      const failedSections: string[] = [];

      const getResult = <T,>(index: number): T | undefined => {
        const result = results[index];
        if (result?.status === "fulfilled") {
          return result.value as T;
        }
        failedSections.push(requests[index]?.[0] ?? `section ${index + 1}`);
        return undefined;
      };

      const statsResp = getResult<AdminStatsExtended>(0);
      const economicsResp = getResult<EconomicsSettings>(1);
      const revenueResp = getResult<RevenueSummary>(2);
      const marketsResp = getResult<{ items: PredictionMarket[] }>(3);
      const disputesResp = getResult<{ items: PredictionDispute[] }>(4);
      const sourcesResp = getResult<{ sources: SourceRow[] }>(5);
      const sourceHealthResp = getResult<{ sources: SourceHealthRow[] }>(6);
      const advertisersResp = getResult<{ advertisers: AdvertiserRow[] }>(7);
      const configResp = getResult<{ settings: Record<string, ConfigRow[]> }>(8);
      const modelsResp = getResult<ModelsPayload>(9);
      const sponsoredResp = getResult<{ cards: SponsoredCard[] }>(10);
      const billingRequestsResp = getResult<{ requests: AdvertiserBillingRequest[] }>(11);
      const feedbackResp = getResult<{ feedback: FeedbackRow[] }>(12);
      const orphanedPaymentsResp = getResult<{ payments: OrphanedPaymentRow[] }>(13);

      if (failedSections.length === requests.length) {
        throw new Error("Failed to load admin data. Check the admin token and API base URL.");
      }

      if (statsResp) setStats(statsResp);
      if (economicsResp) {
        setEconomics(economicsResp);
        setEconFee(String(economicsResp.platformFeePct));
        setEconDeposit(String(economicsResp.disputeDepositSkr));
        setEconWindow(String(economicsResp.challengeWindowHours));
      }
      if (revenueResp) setRevenue(revenueResp);
      if (disputesResp) setDisputes(disputesResp.items ?? []);
      if (sourcesResp) setSources(sourcesResp.sources ?? []);
      if (sourceHealthResp) setSourceHealth(sourceHealthResp.sources ?? []);
      if (advertisersResp) setAdvertisers(advertisersResp.advertisers ?? []);
      if (sponsoredResp) setSponsoredCards(sponsoredResp.cards ?? []);
      if (billingRequestsResp) setBillingRequests(billingRequestsResp.requests ?? []);
      if (feedbackResp) {
        setFeedbackList(feedbackResp.feedback ?? []);
        setNewFeedbackCount((feedbackResp.feedback ?? []).filter((row) => row.status === "new").length);
        setFeedbackNotes(
          Object.fromEntries((feedbackResp.feedback ?? []).map((row) => [row.id, row.adminNotes ?? ""]))
        );
      }
      if (orphanedPaymentsResp) {
        setOrphanedPayments(orphanedPaymentsResp.payments ?? []);
        setOrphanedPaymentNotes(
          Object.fromEntries((orphanedPaymentsResp.payments ?? []).map((row) => [row.id, row.adminNotes ?? ""]))
        );
      }

      if (configResp) {
        const flattenedConfig = Object.values(configResp.settings).flat();
        setConfigRows(flattenedConfig);
        setEditingConfig(Object.fromEntries(flattenedConfig.map((row) => [row.key, row.value])));
      }

      if (modelsResp) {
        setModels(modelsResp.models ?? []);
        setModelLastSync(modelsResp.lastSync);
        setEditingAgentConfig(modelsResp.agentConfig ?? {});
      }

      if (marketsResp) {
        const nextMarkets = marketsResp.items ?? [];
        setMarkets(nextMarkets);
        setMarketLimits(
          Object.fromEntries(
            nextMarkets.map((market) => [
              market.id,
              { min: String(market.minStakeSkr), max: String(market.maxStakeSkr) },
            ])
          )
        );
      }

      if (failedSections.length) {
        setError(`Some admin data could not be loaded: ${failedSections.join(", ")}`);
      }
      setConnected(true);
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, [apiBase, token]);

  useEffect(() => {
    const storedToken = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    const storedBase = sessionStorage.getItem(ADMIN_BASE_STORAGE_KEY);
    if (storedToken) {
      setToken(storedToken);
      setConnected(true);
    }
    if (storedBase) {
      setApiBase(storedBase);
    }
  }, []);

  useEffect(() => {
    if (connected && token) {
      void loadAll();
    }
  }, [connected, token, loadAll]);

  const doAction = useCallback(
    async (key: string, action: () => Promise<void>, doneMessage: string) => {
      setActionLoading(key);
      clearNotices();
      try {
        await action();
        setSuccess(doneMessage);
        await loadAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setActionLoading(null);
      }
    },
    [loadAll]
  );

  const submitPendingAdminAction = useCallback(async () => {
    if (!pendingAdminAction) {
      return;
    }
    const current = pendingAdminAction;
    const note = current.noteValue.trim();
    if (current.noteRequired && !note) {
      setError("A note is required for this action.");
      return;
    }
    setPendingAdminAction(null);
    await doAction(
      current.key,
      async () => {
        await current.run(note);
      },
      current.doneMessage
    );
  }, [doAction, pendingAdminAction]);

  const filteredMarkets = useMemo(() => {
    if (marketStatusFilter === "all") return markets;
    return markets.filter((m) => m.status === marketStatusFilter);
  }, [markets, marketStatusFilter]);

  const filteredDisputes = useMemo(() => {
    if (disputeStatusFilter === "all") return disputes;
    return disputes.filter((d) => d.status === disputeStatusFilter);
  }, [disputes, disputeStatusFilter]);

  const filteredBillingRequests = useMemo(() => {
    if (billingRequestFilter === "all") return billingRequests;
    return billingRequests.filter((request) => request.status === billingRequestFilter);
  }, [billingRequests, billingRequestFilter]);

  const filteredFeedback = useMemo(() => {
    if (feedbackStatusFilter === "all") return feedbackList;
    return feedbackList.filter((item) => item.status === feedbackStatusFilter);
  }, [feedbackList, feedbackStatusFilter]);

  const filteredOrphanedPayments = useMemo(() => {
    if (orphanedPaymentStatusFilter === "all") return orphanedPayments;
    return orphanedPayments.filter((item) => item.status === orphanedPaymentStatusFilter);
  }, [orphanedPayments, orphanedPaymentStatusFilter]);

  const sponsoredPricingRows = useMemo(
    () =>
      configRows.filter((row) =>
        [
          "sponsored_default_impression_limit",
          "sponsored_cpm_classic_skr",
          "sponsored_cpm_banner_skr",
          "sponsored_cpm_spotlight_skr",
          "sponsored_predict_multiplier_pct",
          "sponsored_both_multiplier_pct",
        ].includes(row.key)
      ),
    [configRows]
  );

  const submitConnect = async () => {
    clearNotices();
    if (!token.trim()) {
      setError("Admin token is required.");
      return;
    }
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token.trim());
    sessionStorage.setItem(ADMIN_BASE_STORAGE_KEY, normalizeApiBase(apiBase));
    setConnected(true);
  };

  const logout = () => {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(ADMIN_BASE_STORAGE_KEY);
    setConnected(false);
    setToken("");
    setError(null);
    setSuccess(null);
    setPendingAdminAction(null);
  };

  const tabItems: Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "markets", label: "Markets", icon: Target },
    { id: "disputes", label: "Disputes", icon: Gavel },
    { id: "economics", label: "Economics & Config", icon: SlidersHorizontal },
    { id: "advertisers", label: "Advertisers", icon: Megaphone },
    { id: "feedback", label: "Feedback", icon: MessageSquare },
    { id: "sources", label: "Sources", icon: Database },
    { id: "models", label: "Models", icon: Cpu },
    { id: "sponsored", label: "Sponsored", icon: Megaphone },
  ];

  return (
    <main id="main-content" className="min-h-screen" style={{ background: "var(--color-bg)" }}>
      <div
        className="sticky top-0 z-20 border-b px-4 py-3 sm:px-8"
        style={{ borderColor: "var(--color-border)", background: "rgba(246, 248, 251, 0.95)", backdropFilter: "blur(10px)" }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield size={18} color="var(--color-violet)" />
            <h1 className="text-base font-bold" style={{ color: "var(--color-text)", fontFamily: "var(--font-display)" }}>
              Chainshorts Control Room
            </h1>
          </div>
          {connected ? (
            <div className="flex items-center gap-2">
              <Button label="Refresh" variant="ghost" onClick={() => void loadAll()} disabled={loading} />
              <Button label="Logout" variant="danger" onClick={logout} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8">
        {!connected ? (
          <section
            className="mx-auto max-w-xl rounded-2xl border p-6"
            style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
          >
            <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--color-text)", fontFamily: "var(--font-display)" }}>
              Connect Admin Session
            </h2>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>
                  API Base URL
                </p>
                <Input value={apiBase} onChange={setApiBase} placeholder="https://api.chainshorts.live" />
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>
                  Admin Token
                </p>
                <Input value={token} onChange={setToken} type="password" placeholder="x-admin-token" />
              </div>
              <div className="pt-2">
                <Button label={loading ? "Connecting..." : "Connect"} onClick={() => void submitConnect()} disabled={loading} />
              </div>
            </div>
            {error ? (
              <p className="mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ color: "#b42318", borderColor: "#fecaca", background: "#fef2f2" }}>
                <AlertTriangle size={14} /> {error}
              </p>
            ) : null}
          </section>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {tabItems.map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition"
                    style={{
                      borderColor: active ? "var(--color-violet)" : "var(--color-border)",
                      background: active ? "rgba(37, 99, 235, 0.10)" : "var(--color-surface)",
                      color: active ? "var(--color-violet)" : "var(--color-text)",
                    }}
                  >
                    <Icon size={14} />
                    {item.label}
                    {item.id === "feedback" && newFeedbackCount > 0 ? (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {newFeedbackCount > 9 ? "9+" : newFeedbackCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {error ? (
              <p className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ color: "#b42318", borderColor: "#fecaca", background: "#fef2f2" }}>
                <AlertTriangle size={14} /> {error}
              </p>
            ) : null}
            {success ? (
              <p className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ color: "#065f46", borderColor: "#86efac", background: "#ecfdf3" }}>
                <CheckCircle2 size={14} /> {success}
              </p>
            ) : null}

            {pendingAdminAction ? (
              <section
                className="mb-4 rounded-xl border p-4"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-violet)", fontFamily: "var(--font-mono)" }}>
                      Pending Action
                    </p>
                    <h3 className="mt-1 text-sm font-bold" style={{ color: "var(--color-text)" }}>
                      {pendingAdminAction.title}
                    </h3>
                    <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
                      {pendingAdminAction.message}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      label="Dismiss"
                      variant="ghost"
                      disabled={!!actionLoading}
                      onClick={() => setPendingAdminAction(null)}
                    />
                    <Button
                      label={pendingAdminAction.confirmLabel}
                      variant={pendingAdminAction.variant ?? "primary"}
                      disabled={!!actionLoading}
                      onClick={() => void submitPendingAdminAction()}
                    />
                  </div>
                </div>
                {pendingAdminAction.noteLabel ? (
                  <div className="mt-4">
                    <p className="mb-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>
                      {pendingAdminAction.noteLabel}
                    </p>
                    <textarea
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      style={{
                        background: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text)",
                      }}
                      rows={3}
                      value={pendingAdminAction.noteValue}
                      onChange={(event) =>
                        setPendingAdminAction((prev) =>
                          prev ? { ...prev, noteValue: event.target.value } : prev
                        )
                      }
                      placeholder={pendingAdminAction.notePlaceholder}
                    />
                  </div>
                ) : null}
              </section>
            ) : null}

            {loading ? (
              <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--color-muted)" }}>
                <Loader2 size={16} className="animate-spin" />
                Loading admin data...
              </div>
            ) : null}

            {!loading && tab === "overview" ? (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Active Markets</p>
                  <p className="mt-2 text-2xl font-bold" style={{ color: "var(--color-text)" }}>{fmt(stats?.predictions.activeMarkets)}</p>
                </div>
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Prediction Volume (24h)</p>
                  <p className="mt-2 text-2xl font-bold" style={{ color: "var(--color-text)" }}>{fmt(stats?.predictions.totalVolumeLast24h)} SKR</p>
                </div>
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Platform Fees</p>
                  <p className="mt-2 text-2xl font-bold" style={{ color: "var(--color-text)" }}>{fmt(revenue?.totalFeeSkr)} SKR</p>
                </div>
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Pending Disputes</p>
                  <p className="mt-2 text-2xl font-bold" style={{ color: "var(--color-text)" }}>{fmt(economics?.pendingDisputes)}</p>
                </div>

                <div className="rounded-xl border p-4 sm:col-span-2 lg:col-span-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <div className="mb-2 flex items-center gap-2">
                    <TrendingUp size={16} color="var(--color-violet)" />
                    <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Operations Snapshot</h3>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <p style={{ color: "var(--color-muted)" }}>Feed items: <strong style={{ color: "var(--color-text)" }}>{fmt(stats?.feed.total)}</strong></p>
                    <p style={{ color: "var(--color-muted)" }}>Unique wallets: <strong style={{ color: "var(--color-text)" }}>{fmt(stats?.users.uniqueWallets)}</strong></p>
                    <p style={{ color: "var(--color-muted)" }}>Pipeline avg latency: <strong style={{ color: "var(--color-text)" }}>{fmt(stats?.pipeline.avgLatencyMs)} ms</strong></p>
                    <p style={{ color: "var(--color-muted)" }}>Pending payouts: <strong style={{ color: "var(--color-text)" }}>{fmt(revenue?.pendingPayoutsCount)}</strong></p>
                  </div>
                </div>
              </section>
            ) : null}

            {!loading && tab === "markets" ? (
              <section className="space-y-4">
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>Create Market</h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <Input value={newMarketQuestion} onChange={setNewMarketQuestion} placeholder="Question" />
                    <Input value={newMarketDeadline} onChange={setNewMarketDeadline} type="datetime-local" />
                    <Input value={newMarketMin} onChange={setNewMarketMin} placeholder="Min stake" />
                    <Input value={newMarketMax} onChange={setNewMarketMax} placeholder="Max stake" />
                    <Input value={newMarketFee} onChange={setNewMarketFee} placeholder="Fee %" />
                  </div>
                  <div className="mt-3">
                    <Button
                      label={actionLoading === "create-market" ? "Creating..." : "Create Market"}
                      disabled={actionLoading === "create-market"}
                      onClick={() =>
                        void doAction(
                          "create-market",
                          async () => {
                            if (newMarketQuestion.trim().length < 10) {
                              throw new Error("question_too_short");
                            }
                            if (!newMarketDeadline) {
                              throw new Error("deadline_required");
                            }
                            await adminFetch(apiBase, token, "/v1/admin/predictions/create", {
                              method: "POST",
                              body: JSON.stringify({
                                question: newMarketQuestion.trim(),
                                deadlineAt: new Date(newMarketDeadline).toISOString(),
                                minStakeSkr: Number(newMarketMin),
                                maxStakeSkr: Number(newMarketMax),
                                platformFeePct: Number(newMarketFee),
                                resolutionRuleKind: "event_occurs",
                              }),
                            });
                            setNewMarketQuestion("");
                            setNewMarketDeadline("");
                          },
                          "Market created."
                        )
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Prediction Markets</h3>
                    <select
                      className="rounded-lg border px-2 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                      value={marketStatusFilter}
                      onChange={(event) => setMarketStatusFilter(event.target.value as typeof marketStatusFilter)}
                    >
                      <option value="all">All</option>
                      <option value="active">Active</option>
                      <option value="resolved">Resolved</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr style={{ color: "var(--color-dim)" }}>
                          <th className="px-2 py-2 text-left">Market</th>
                          <th className="px-2 py-2 text-left">Status</th>
                          <th className="px-2 py-2 text-left">Pool</th>
                          <th className="px-2 py-2 text-left">Limits</th>
                          <th className="px-2 py-2 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMarkets.map((market) => {
                          const limits = marketLimits[market.id] ?? {
                            min: String(market.minStakeSkr),
                            max: String(market.maxStakeSkr),
                          };
                          return (
                            <tr key={market.id} className="border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
                              <td className="px-2 py-3">
                                <p className="font-semibold" style={{ color: "var(--color-text)" }}>{market.question}</p>
                                <p style={{ color: "var(--color-dim)" }}>{market.id}</p>
                                <p className="text-xs" style={{ color: "var(--color-dim)" }}>Deadline: {fmtDate(market.deadlineAt)}</p>
                              </td>
                              <td className="px-2 py-3">
                                <p style={{ color: "var(--color-text)" }}>{market.status.toUpperCase()}</p>
                                {market.resolvedOutcome ? <p style={{ color: "var(--color-dim)" }}>Outcome: {market.resolvedOutcome.toUpperCase()}</p> : null}
                                {market.disputeFreeze ? <p style={{ color: "#b54708" }}>Frozen</p> : null}
                              </td>
                              <td className="px-2 py-3">
                                <p>{fmt(market.totalPoolSkr)} SKR</p>
                                <p style={{ color: "var(--color-dim)" }}>{fmt(market.stakersCount)} stakers</p>
                              </td>
                              <td className="px-2 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    value={limits.min}
                                    onChange={(event) =>
                                      setMarketLimits((prev) => ({
                                        ...prev,
                                        [market.id]: { ...limits, min: event.target.value },
                                      }))
                                    }
                                    className="w-20 rounded-lg border px-2 py-1.5 text-xs"
                                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                                  />
                                  <span style={{ color: "var(--color-dim)" }}>to</span>
                                  <input
                                    value={limits.max}
                                    onChange={(event) =>
                                      setMarketLimits((prev) => ({
                                        ...prev,
                                        [market.id]: { ...limits, max: event.target.value },
                                      }))
                                    }
                                    className="w-24 rounded-lg border px-2 py-1.5 text-xs"
                                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                                  />
                                  <Button
                                    label="Save"
                                    variant="ghost"
                                    disabled={!!actionLoading}
                                    onClick={() =>
                                      void doAction(
                                        `limits-${market.id}`,
                                        async () => {
                                          const minStakeSkr = Number.parseInt(limits.min, 10);
                                          const maxStakeSkr = Number.parseInt(limits.max, 10);
                                          if (!Number.isFinite(minStakeSkr) || !Number.isFinite(maxStakeSkr)) {
                                            throw new Error("invalid_limits");
                                          }
                                          await adminFetch(apiBase, token, `/v1/admin/predictions/${market.id}/limits`, {
                                            method: "PATCH",
                                            body: JSON.stringify({ minStakeSkr, maxStakeSkr }),
                                          });
                                        },
                                        "Market limits updated."
                                      )
                                    }
                                  />
                                </div>
                                <p className="mt-1 text-xs" style={{ color: "var(--color-dim)" }}>Fee {fmtPct(market.platformFeePct)}</p>
                              </td>
                              <td className="px-2 py-3">
                                <div className="flex flex-wrap gap-2">
                                  {market.status === "active" ? (
                                    <>
                                      <Button
                                        label={actionLoading === `settle-yes-${market.id}` ? "..." : "Settle YES"}
                                        disabled={!!actionLoading}
                                        onClick={() =>
                                          void doAction(
                                            `settle-yes-${market.id}`,
                                            async () => {
                                              await adminFetch(apiBase, token, `/v1/admin/predictions/${market.id}/settle`, {
                                                method: "POST",
                                                body: JSON.stringify({ outcome: "yes", reason: "admin control panel" }),
                                              });
                                            },
                                            "Market settled YES."
                                          )
                                        }
                                      />
                                      <Button
                                        label={actionLoading === `settle-no-${market.id}` ? "..." : "Settle NO"}
                                        disabled={!!actionLoading}
                                        onClick={() =>
                                          void doAction(
                                            `settle-no-${market.id}`,
                                            async () => {
                                              await adminFetch(apiBase, token, `/v1/admin/predictions/${market.id}/settle`, {
                                                method: "POST",
                                                body: JSON.stringify({ outcome: "no", reason: "admin control panel" }),
                                              });
                                            },
                                            "Market settled NO."
                                          )
                                        }
                                      />
                                      <Button
                                        label={actionLoading === `cancel-${market.id}` ? "..." : "Cancel"}
                                        variant="danger"
                                        disabled={!!actionLoading}
                                        onClick={() =>
                                          setPendingAdminAction({
                                            key: `cancel-${market.id}`,
                                            title: "Cancel Market",
                                            message: "This will cancel the market and create refund payouts for all active stakes.",
                                            confirmLabel: "Confirm Cancel",
                                            doneMessage: "Market cancelled.",
                                            variant: "danger",
                                            noteValue: "",
                                            run: async () => {
                                              await adminFetch(apiBase, token, `/v1/admin/predictions/${market.id}/cancel`, {
                                                method: "POST",
                                                body: JSON.stringify({ reason: "admin cancellation" }),
                                              });
                                            },
                                          })
                                        }
                                      />
                                    </>
                                  ) : (
                                    <span style={{ color: "var(--color-dim)" }}>No actions</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {!loading && tab === "disputes" ? (
              <section className="space-y-4">
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Disputes</h3>
                    <select
                      className="rounded-lg border px-2 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                      value={disputeStatusFilter}
                      onChange={(event) => setDisputeStatusFilter(event.target.value as typeof disputeStatusFilter)}
                    >
                      <option value="all">All</option>
                      <option value="pending">Pending</option>
                      <option value="investigating">Investigating</option>
                      <option value="upheld">Upheld</option>
                      <option value="rejected">Rejected</option>
                      <option value="expired">Expired</option>
                    </select>
                  </div>
                  <div className="space-y-3">
                    {filteredDisputes.map((dispute) => (
                      <div key={dispute.id} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border-subtle)" }}>
                        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                          {dispute.id} • {dispute.status.toUpperCase()}
                        </p>
                        <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                          Poll: {dispute.pollId} • Wallet: {toWalletPreview(dispute.wallet)} • Filed: {fmtDate(dispute.createdAt)}
                        </p>
                        <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                          Challenge deadline: {fmtDate(dispute.challengeDeadline)}
                        </p>
                        <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>{dispute.reason}</p>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Input
                            value={disputeNotes[dispute.id] ?? ""}
                            onChange={(next) => setDisputeNotes((prev) => ({ ...prev, [dispute.id]: next }))}
                            placeholder="Add admin note"
                          />
                          <Button
                            label="Add Note"
                            variant="ghost"
                            disabled={!!actionLoading || !(disputeNotes[dispute.id] ?? "").trim()}
                            onClick={() =>
                              void doAction(
                                `note-${dispute.id}`,
                                async () => {
                                  await adminFetch(apiBase, token, `/v1/admin/predictions/disputes/${dispute.id}/note`, {
                                    method: "POST",
                                    body: JSON.stringify({ note: (disputeNotes[dispute.id] ?? "").trim() }),
                                  });
                                  setDisputeNotes((prev) => ({ ...prev, [dispute.id]: "" }));
                                },
                                "Dispute note saved."
                              )
                            }
                          />
                        </div>

                        {dispute.status === "pending" || dispute.status === "investigating" ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              label="Investigate"
                              variant="ghost"
                              disabled={!!actionLoading}
                              onClick={() =>
                                void doAction(
                                  `investigate-${dispute.id}`,
                                  async () => {
                                    await adminFetch(apiBase, token, `/v1/admin/predictions/disputes/${dispute.id}/investigate`, {
                                      method: "POST",
                                    });
                                  },
                                  "Dispute moved to investigating."
                                )
                              }
                            />
                            <Button
                              label="Reject"
                              variant="danger"
                              disabled={!!actionLoading}
                              onClick={() =>
                                void doAction(
                                  `reject-${dispute.id}`,
                                  async () => {
                                    await adminFetch(apiBase, token, `/v1/admin/predictions/disputes/${dispute.id}/resolve`, {
                                      method: "POST",
                                      body: JSON.stringify({ verdict: "rejected", note: disputeNotes[dispute.id] || resolveNote || "Reviewed and rejected." }),
                                    });
                                  },
                                  "Dispute rejected."
                                )
                              }
                            />
                            <Button
                              label="Uphold + YES"
                              disabled={!!actionLoading}
                              onClick={() =>
                                void doAction(
                                  `uphold-yes-${dispute.id}`,
                                  async () => {
                                    await adminFetch(apiBase, token, `/v1/admin/predictions/disputes/${dispute.id}/resolve`, {
                                      method: "POST",
                                      body: JSON.stringify({
                                        verdict: "upheld",
                                        note: disputeNotes[dispute.id] || resolveNote || "Outcome corrected.",
                                        correctedOutcome: "yes",
                                      }),
                                    });
                                  },
                                  "Dispute upheld and re-resolved to YES."
                                )
                              }
                            />
                            <Button
                              label="Uphold + NO"
                              disabled={!!actionLoading}
                              onClick={() =>
                                void doAction(
                                  `uphold-no-${dispute.id}`,
                                  async () => {
                                    await adminFetch(apiBase, token, `/v1/admin/predictions/disputes/${dispute.id}/resolve`, {
                                      method: "POST",
                                      body: JSON.stringify({
                                        verdict: "upheld",
                                        note: disputeNotes[dispute.id] || resolveNote || "Outcome corrected.",
                                        correctedOutcome: "no",
                                      }),
                                    });
                                  },
                                  "Dispute upheld and re-resolved to NO."
                                )
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-2 text-sm font-bold" style={{ color: "var(--color-text)" }}>Default Dispute Resolution Note</h3>
                  <Input value={resolveNote} onChange={setResolveNote} placeholder="This note is used in quick resolve actions." />
                </div>
              </section>
            ) : null}

            {!loading && tab === "economics" ? (
              <section className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                    <div className="mb-3 flex items-center gap-2">
                      <Wrench size={16} color="var(--color-violet)" />
                      <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Prediction Economics</h3>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="mb-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Platform Fee %</p>
                        <Input value={econFee} onChange={setEconFee} />
                      </div>
                      <div>
                        <p className="mb-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Dispute Deposit (SKR)</p>
                        <Input value={econDeposit} onChange={setEconDeposit} />
                      </div>
                      <div>
                        <p className="mb-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Challenge Window (Hours)</p>
                        <Input value={econWindow} onChange={setEconWindow} />
                      </div>
                      <Button
                        label={actionLoading === "save-economics" ? "Saving..." : "Save Economics"}
                        disabled={actionLoading === "save-economics"}
                        onClick={() =>
                          void doAction(
                            "save-economics",
                            async () => {
                              await adminFetch(apiBase, token, "/v1/admin/predictions/economics", {
                                method: "PATCH",
                                body: JSON.stringify({
                                  platformFeePct: Number(econFee),
                                  disputeDepositSkr: Number(econDeposit),
                                  challengeWindowHours: Number(econWindow),
                                }),
                              });
                            },
                            "Economics settings updated."
                          )
                        }
                      />

                      <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--color-border-subtle)" }}>
                        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>
                          Feed Injection Controls
                        </h4>
                        <div className="space-y-2">
                          {[
                            "feed_prediction_min_gap",
                            "feed_prediction_max_gap",
                            "feed_sponsored_min_gap",
                            "feed_sponsored_max_gap",
                            "feed_max_predictions_per_page",
                          ].map((key) => (
                            <div key={key} className="grid gap-2 sm:grid-cols-[1fr,120px,72px] sm:items-center">
                              <p className="text-xs font-semibold" style={{ color: "var(--color-muted)" }}>
                                {key}
                              </p>
                              <Input
                                value={editingConfig[key] ?? ""}
                                onChange={(next) => setEditingConfig((prev) => ({ ...prev, [key]: next }))}
                              />
                              <Button
                                label="Save"
                                variant="ghost"
                                disabled={!!actionLoading}
                                onClick={() =>
                                  void doAction(
                                    `config-${key}`,
                                    async () => {
                                      await adminFetch(apiBase, token, `/v1/admin/config/${key}`, {
                                        method: "PATCH",
                                        body: JSON.stringify({ value: editingConfig[key] ?? "" }),
                                      });
                                    },
                                    `${key} updated.`
                                  )
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                    <div className="mb-3 flex items-center gap-2">
                      <Settings2 size={16} color="var(--color-violet)" />
                      <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>System Config Keys</h3>
                    </div>
                    <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
                      {configRows.map((row) => (
                        <div key={row.key} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border-subtle)" }}>
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>{row.key}</p>
                          <p className="mb-2 text-xs" style={{ color: "var(--color-muted)" }}>{row.description ?? row.label}</p>
                          <div className="flex gap-2">
                            <Input
                              value={editingConfig[row.key] ?? ""}
                              onChange={(next) => setEditingConfig((prev) => ({ ...prev, [row.key]: next }))}
                            />
                            <Button
                              label="Save"
                              variant="ghost"
                              disabled={!!actionLoading}
                              onClick={() =>
                                void doAction(
                                  `config-${row.key}`,
                                  async () => {
                                    await adminFetch(apiBase, token, `/v1/admin/config/${row.key}`, {
                                      method: "PATCH",
                                      body: JSON.stringify({ value: editingConfig[row.key] ?? "" }),
                                    });
                                  },
                                  `${row.key} updated.`
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Manual Payment Review</h3>
                      <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                        These are on-chain payments that were verified but could not be attached to a business action. They require operator review.
                      </p>
                    </div>
                    <select
                      className="rounded-lg border px-2 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      value={orphanedPaymentStatusFilter}
                      onChange={(event) => setOrphanedPaymentStatusFilter(event.target.value as typeof orphanedPaymentStatusFilter)}
                    >
                      <option value="all">All exceptions</option>
                      <option value="open">Open</option>
                      <option value="reviewing">Reviewing</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>

                  <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Open</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(orphanedPayments.filter((item) => item.status === "open").length)}
                      </p>
                    </div>
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Reviewing</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(orphanedPayments.filter((item) => item.status === "reviewing").length)}
                      </p>
                    </div>
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Resolved</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(orphanedPayments.filter((item) => item.status === "resolved").length)}
                      </p>
                    </div>
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Open Exposure</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(
                          orphanedPayments
                            .filter((item) => item.status !== "resolved")
                            .reduce((sum, item) => sum + item.expectedAmountSkr, 0)
                        )} SKR
                      </p>
                    </div>
                  </div>

                  {filteredOrphanedPayments.length === 0 ? (
                    <div
                      className="rounded-xl border border-dashed px-4 py-6 text-sm"
                      style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-dim)", background: "rgba(255,255,255,0.4)" }}
                    >
                      No payment exceptions in this state.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredOrphanedPayments.map((payment) => (
                        <div
                          key={payment.id}
                          className="rounded-xl border p-4"
                          style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide"
                                style={{
                                  background:
                                    payment.status === "open"
                                      ? "rgba(239, 68, 68, 0.12)"
                                      : payment.status === "reviewing"
                                      ? "rgba(245, 158, 11, 0.12)"
                                      : "rgba(16, 185, 129, 0.12)",
                                  color:
                                    payment.status === "open"
                                      ? "#dc2626"
                                      : payment.status === "reviewing"
                                      ? "#b45309"
                                      : "#047857",
                                }}
                              >
                                {payment.status}
                              </span>
                              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>
                                {payment.purpose.replace(/_/g, " ")}
                              </span>
                              <span className="text-xs" style={{ color: "var(--color-dim)" }}>
                                {fmtDate(payment.createdAt)}
                              </span>
                            </div>
                            <span className="text-xs" style={{ color: "var(--color-dim)" }}>
                              Updated {fmtDate(payment.updatedAt)}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-3 lg:grid-cols-4">
                            <div>
                              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Expected Amount</p>
                              <p className="mt-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                                {fmt(payment.expectedAmountSkr)} SKR
                              </p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Wallet</p>
                              <p className="mt-1 text-sm" style={{ color: "var(--color-text)" }}>
                                {toWalletPreview(payment.wallet)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Reference</p>
                              <p className="mt-1 text-sm" style={{ color: "var(--color-text)" }}>
                                {payment.referenceType}: {payment.referenceId}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Tx Signature</p>
                              <p className="mt-1 text-sm" style={{ color: "var(--color-text)" }}>
                                {truncateText(payment.txSignature, 28)}
                              </p>
                            </div>
                          </div>

                          <p className="mt-3 text-sm" style={{ color: "var(--color-muted)" }}>
                            Failure reason: {payment.failureReason.replace(/_/g, " ")}
                          </p>
                          {payment.metadata ? (
                            <p className="mt-2 text-xs" style={{ color: "var(--color-dim)" }}>
                              Context: {truncateText(JSON.stringify(payment.metadata), 220)}
                            </p>
                          ) : null}

                          <div className="mt-4 grid gap-3 lg:grid-cols-[180px,1fr,120px]">
                            <select
                              className="rounded-lg border px-2 py-2 text-sm"
                              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                              value={payment.status}
                              onChange={(event) => {
                                const newStatus = event.target.value;
                                setPendingAdminAction({
                                  key: `orphaned-payment-status-${payment.id}`,
                                  title: "Update Payment Status",
                                  message: `Change status to "${newStatus}"?`,
                                  confirmLabel: "Confirm",
                                  doneMessage: "Payment exception status updated.",
                                  noteValue: "",
                                  run: async () => {
                                    await adminFetch(apiBase, token, `/v1/admin/orphan-payments/${payment.id}`, {
                                      method: "PATCH",
                                      body: JSON.stringify({ status: newStatus }),
                                    });
                                  },
                                });
                              }}
                            >
                              <option value="open">Open</option>
                              <option value="reviewing">Reviewing</option>
                              <option value="resolved">Resolved</option>
                            </select>

                            <textarea
                              className="w-full rounded-lg border px-3 py-2 text-sm"
                              style={{
                                background: "var(--color-surface)",
                                borderColor: "var(--color-border)",
                                color: "var(--color-text)",
                              }}
                              rows={3}
                              value={orphanedPaymentNotes[payment.id] ?? ""}
                              onChange={(event) =>
                                setOrphanedPaymentNotes((prev) => ({
                                  ...prev,
                                  [payment.id]: event.target.value,
                                }))
                              }
                              placeholder="Manual review notes"
                            />

                            <Button
                              label="Save Notes"
                              variant="ghost"
                              disabled={!!actionLoading}
                              onClick={() =>
                                void doAction(
                                  `orphaned-payment-note-${payment.id}`,
                                  async () => {
                                    await adminFetch(apiBase, token, `/v1/admin/orphan-payments/${payment.id}`, {
                                      method: "PATCH",
                                      body: JSON.stringify({
                                        adminNotes: (orphanedPaymentNotes[payment.id] ?? "").trim() || null,
                                      }),
                                    });
                                  },
                                  "Payment exception notes updated."
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {!loading && tab === "advertisers" ? (
              <section className="space-y-4">
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>Advertiser Accounts</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr style={{ color: "var(--color-dim)" }}>
                          <th className="px-2 py-2 text-left">Advertiser</th>
                          <th className="px-2 py-2 text-left">Campaigns</th>
                          <th className="px-2 py-2 text-left">Performance</th>
                          <th className="px-2 py-2 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {advertisers.map((adv) => (
                          <tr key={adv.id} className="border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
                            <td className="px-2 py-3">
                              <p className="font-semibold" style={{ color: "var(--color-text)" }}>
                                {adv.companyName ?? "Unconfigured Advertiser"}
                              </p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>{toWalletPreview(adv.walletAddress ?? "unknown")}</p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                Last login: {adv.lastLoginAt ? fmtDate(adv.lastLoginAt) : "never"}
                              </p>
                            </td>
                            <td className="px-2 py-3">
                              <p>{fmt(adv.activeCampaignCount)} active / {fmt(adv.campaignCount)} total</p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                {adv.isOnboarded ? "Onboarded" : "Needs onboarding"}
                              </p>
                              <p className="text-xs" style={{ color: adv.accountStatus === "suspended" ? "#b42318" : "var(--color-dim)" }}>
                                Account: {adv.accountStatus}
                              </p>
                            </td>
                            <td className="px-2 py-3">
                              <p>{fmt(adv.impressionCount)} impressions</p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                {fmt(adv.clickCount)} clicks • {fmt(adv.leadCount)} leads
                              </p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                Pending invoices: ${((adv.pendingInvoiceUsdc ?? adv.pendingInvoiceSkr ?? 0) / 100).toFixed(2)} USDC
                              </p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                Collected: ${((adv.collectedRevenueUsdc ?? adv.collectedRevenueSkr ?? 0) / 100).toFixed(2)} USDC
                              </p>
                            </td>
                            <td className="px-2 py-3">
                              <div className="flex gap-2">
                                <Button
                                  label="Pause All Ads"
                                  variant="danger"
                                  disabled={!!actionLoading || adv.activeCampaignCount === 0}
                                  onClick={() =>
                                    void doAction(
                                      `pause-adv-${adv.id}`,
                                      async () => {
                                        await adminFetch(apiBase, token, `/v1/admin/advertisers/${adv.id}/campaigns/status`, {
                                          method: "POST",
                                          body: JSON.stringify({ active: false }),
                                        });
                                      },
                                      "All advertiser campaigns paused."
                                    )
                                  }
                                />
                                <Button
                                  label="Resume Active Window"
                                  variant="ghost"
                                  disabled={!!actionLoading}
                                  onClick={() =>
                                    void doAction(
                                      `resume-adv-${adv.id}`,
                                      async () => {
                                        await adminFetch(apiBase, token, `/v1/admin/advertisers/${adv.id}/campaigns/status`, {
                                          method: "POST",
                                          body: JSON.stringify({ active: true }),
                                        });
                                      },
                                      "Advertiser campaigns resumed where eligible."
                                    )
                                  }
                                />
                                <Button
                                  label={adv.accountStatus === "suspended" ? "Unsuspend" : "Suspend"}
                                  variant={adv.accountStatus === "suspended" ? "ghost" : "danger"}
                                  disabled={!!actionLoading}
                                  onClick={() => {
                                    if (adv.accountStatus === "suspended") {
                                      void doAction(
                                        `unsuspend-adv-${adv.id}`,
                                        async () => {
                                          await adminFetch(apiBase, token, `/v1/admin/advertisers/${adv.id}/account-status`, {
                                            method: "POST",
                                            body: JSON.stringify({ status: "active" }),
                                          });
                                        },
                                        "Advertiser account reactivated."
                                      );
                                      return;
                                    }

                                    setPendingAdminAction({
                                      key: `suspend-adv-${adv.id}`,
                                      title: "Suspend Advertiser",
                                      message: "Suspending an advertiser immediately blocks access and pauses their campaigns.",
                                      confirmLabel: "Suspend Account",
                                      doneMessage: "Advertiser account suspended and campaigns paused.",
                                      variant: "danger",
                                      noteLabel: "Suspension Reason",
                                      notePlaceholder: "Policy violation",
                                      noteRequired: true,
                                      noteValue: "Policy violation",
                                      run: async (note) => {
                                        await adminFetch(apiBase, token, `/v1/admin/advertisers/${adv.id}/account-status`, {
                                          method: "POST",
                                          body: JSON.stringify({ status: "suspended", reason: note }),
                                        });
                                      },
                                    });
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {!loading && tab === "sources" ? (
              <section className="space-y-4">
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>Create Source</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input value={newSourceName} onChange={setNewSourceName} placeholder="Source name" />
                    <Input value={newSourceHome} onChange={setNewSourceHome} placeholder="Homepage URL" />
                    <Input value={newSourceFeed} onChange={setNewSourceFeed} placeholder="Feed URL" />
                  </div>
                  <div className="mt-3">
                    <Button
                      label={actionLoading === "create-source" ? "Creating..." : "Create Source"}
                      disabled={actionLoading === "create-source"}
                      onClick={() =>
                        void doAction(
                          "create-source",
                          async () => {
                            await adminFetch(apiBase, token, "/v1/admin/sources", {
                              method: "POST",
                              body: JSON.stringify({
                                name: newSourceName,
                                homepageUrl: newSourceHome,
                                feedUrl: newSourceFeed,
                              }),
                            });
                            setNewSourceName("");
                            setNewSourceHome("");
                            setNewSourceFeed("");
                          },
                          "Source created."
                        )
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>Sources</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr style={{ color: "var(--color-dim)" }}>
                          <th className="px-2 py-2 text-left">Source</th>
                          <th className="px-2 py-2 text-left">Feed</th>
                          <th className="px-2 py-2 text-left">24h Health</th>
                          <th className="px-2 py-2 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sources.map((source) => {
                          const health = sourceHealth.find((item) => item.sourceId === source.id);
                          return (
                            <tr key={source.id} className="border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
                              <td className="px-2 py-3">
                                <p className="font-semibold" style={{ color: "var(--color-text)" }}>{source.name}</p>
                                <p style={{ color: "var(--color-dim)" }}>{source.id}</p>
                              </td>
                              <td className="px-2 py-3">
                                <a href={source.feedUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-violet)" }}>
                                  Open feed
                                </a>
                              </td>
                              <td className="px-2 py-3">
                                <p>{fmt(health?.successRateLast24h)}%</p>
                                <p style={{ color: "var(--color-dim)" }}>{fmt(health?.articlesPublishedLast24h)} published</p>
                                <p style={{ color: "var(--color-dim)" }}>{fmt(health?.avgLatencyMs)} ms avg</p>
                              </td>
                              <td className="px-2 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    label={source.active ? "Disable" : "Enable"}
                                    variant="ghost"
                                    disabled={!!actionLoading}
                                    onClick={() =>
                                      void doAction(
                                        `toggle-source-${source.id}`,
                                        async () => {
                                          await adminFetch(apiBase, token, `/v1/admin/sources/${source.id}/toggle`, {
                                            method: "POST",
                                            body: JSON.stringify({ active: !source.active }),
                                          });
                                        },
                                        `${source.name} updated.`
                                      )
                                    }
                                  />
                                  <Button
                                    label="Delete"
                                    variant="danger"
                                    disabled={!!actionLoading}
                                    onClick={() =>
                                      setPendingAdminAction({
                                        key: `delete-source-${source.id}`,
                                        title: "Delete Source",
                                        message: `Delete ${source.name} from the source registry. This should only be used for permanent removals.`,
                                        confirmLabel: "Delete Source",
                                        doneMessage: `${source.name} removed.`,
                                        variant: "danger",
                                        noteValue: "",
                                        run: async () => {
                                          await adminFetch(apiBase, token, `/v1/admin/sources/${source.id}`, {
                                            method: "DELETE",
                                          });
                                        },
                                      })
                                    }
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {!loading && tab === "models" ? (
              <section className="space-y-4">
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Model Registry</h3>
                      <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                        Last sync: {modelLastSync ? fmtDate(modelLastSync) : "never"} • {fmt(models.length)} models
                      </p>
                    </div>
                    <Button
                      label={actionLoading === "sync-models" ? "Syncing..." : "Sync Models"}
                      disabled={actionLoading === "sync-models"}
                      onClick={() =>
                        void doAction(
                          "sync-models",
                          async () => {
                            await adminFetch(apiBase, token, "/v1/admin/models/sync", {
                              method: "POST",
                            });
                          },
                          "Model registry synced."
                        )
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>Agent Role Routing</h3>
                  <div className="space-y-3">
                    {AGENT_ROLES.map((role) => (
                      <div key={role} className="grid gap-2 sm:grid-cols-[180px,1fr,120px] sm:items-center">
                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>{role}</p>
                        <select
                          className="rounded-lg border px-2 py-2 text-sm"
                          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                          value={editingAgentConfig[role] ?? ""}
                          onChange={(event) =>
                            setEditingAgentConfig((prev) => ({ ...prev, [role]: event.target.value }))
                          }
                        >
                          <option value="">Select model</option>
                          {models.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.id}
                            </option>
                          ))}
                        </select>
                        <Button
                          label="Save"
                          variant="ghost"
                          disabled={!!actionLoading || !(editingAgentConfig[role] ?? "").trim()}
                          onClick={() =>
                            void doAction(
                              `agent-${role}`,
                              async () => {
                                await adminFetch(apiBase, token, "/v1/admin/models/agent", {
                                  method: "PUT",
                                  body: JSON.stringify({ role, modelId: editingAgentConfig[role] }),
                                });
                              },
                              `${role} model updated.`
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>Available Models</h3>
                  <div className="max-h-[520px] overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr style={{ color: "var(--color-dim)" }}>
                          <th className="px-2 py-2 text-left">Model</th>
                          <th className="px-2 py-2 text-left">Provider</th>
                          <th className="px-2 py-2 text-left">Context</th>
                          <th className="px-2 py-2 text-left">Capabilities</th>
                        </tr>
                      </thead>
                      <tbody>
                        {models.map((model) => (
                          <tr key={model.id} className="border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
                            <td className="px-2 py-3">
                              <p className="font-semibold" style={{ color: "var(--color-text)" }}>{model.name}</p>
                              <p style={{ color: "var(--color-dim)" }}>{model.id}</p>
                            </td>
                            <td className="px-2 py-3">{model.provider}</td>
                            <td className="px-2 py-3">{fmt(model.contextLength)}</td>
                            <td className="px-2 py-3" style={{ color: "var(--color-dim)" }}>
                              {model.isFree ? "Free" : "Paid"} • {model.supportsTools ? "Tools" : "No Tools"} • {model.supportsVision ? "Vision" : "Text"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {!loading && tab === "sponsored" ? (
              <section className="space-y-4">
                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>Create Sponsored Card</h3>
                  <p className="mb-3 text-xs" style={{ color: "var(--color-dim)" }}>
                    Use `feed` for native feed sponsorships, `predict` for predict-tab placements, and `spotlight + predict`
                    for market-partner style campaigns.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Input value={sponsoredAdvertiserName} onChange={setSponsoredAdvertiserName} placeholder="Advertiser name" />
                    <Input value={sponsoredHeadline} onChange={setSponsoredHeadline} placeholder="Headline" />
                    <Input value={sponsoredDestinationUrl} onChange={setSponsoredDestinationUrl} placeholder="Destination URL" />
                    <Input value={sponsoredImageUrl} onChange={setSponsoredImageUrl} placeholder="Image URL (optional)" />
                    <Input value={sponsoredCtaText} onChange={setSponsoredCtaText} placeholder="CTA text" />
                    <Input value={sponsoredAccentColor} onChange={setSponsoredAccentColor} placeholder="#14F195" />
                    <select
                      className="rounded-lg border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      value={sponsoredCardFormat}
                      onChange={(event) => setSponsoredCardFormat(event.target.value as typeof sponsoredCardFormat)}
                    >
                      <option value="classic">classic</option>
                      <option value="banner">banner</option>
                      <option value="spotlight">spotlight</option>
                    </select>
                    <select
                      className="rounded-lg border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      value={sponsoredPlacement}
                      onChange={(event) => setSponsoredPlacement(event.target.value as typeof sponsoredPlacement)}
                    >
                      <option value="feed">feed</option>
                      <option value="predict">predict</option>
                      <option value="both">both</option>
                    </select>
                    <select
                      className="rounded-lg border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      value={sponsoredAudience}
                      onChange={(event) => setSponsoredAudience(event.target.value as typeof sponsoredAudience)}
                    >
                      <option value="all">all</option>
                      <option value="defi_degens">defi_degens</option>
                      <option value="whales">whales</option>
                      <option value="nft_collectors">nft_collectors</option>
                    </select>
                    <select
                      className="rounded-lg border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      value={sponsoredGoal}
                      onChange={(event) => setSponsoredGoal(event.target.value as typeof sponsoredGoal)}
                    >
                      <option value="traffic">traffic</option>
                      <option value="action">action</option>
                      <option value="lead_gen">lead_gen</option>
                    </select>
                    <Input value={sponsoredActionUrl} onChange={setSponsoredActionUrl} placeholder="Action URL (optional)" />
                    <Input value={sponsoredImpressionLimit} onChange={setSponsoredImpressionLimit} placeholder="Impression limit" />
                    <Input value={sponsoredEndsAt} onChange={setSponsoredEndsAt} type="datetime-local" />
                  </div>
                  <div className="mt-2">
                    <textarea
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      rows={3}
                      value={sponsoredBodyText}
                      onChange={(event) => setSponsoredBodyText(event.target.value)}
                      placeholder="Body text"
                    />
                  </div>
                  <div className="mt-3">
                    <Button
                      label={actionLoading === "create-sponsored" ? "Creating..." : "Create Sponsored Card"}
                      disabled={actionLoading === "create-sponsored"}
                      onClick={() =>
                        void doAction(
                          "create-sponsored",
                          async () => {
                            if (!sponsoredEndsAt) throw new Error("ends_at_required");
                            const endsAt = new Date(sponsoredEndsAt);
                            if (Number.isNaN(endsAt.getTime()) || endsAt <= new Date()) {
                              throw new Error("ends_at_must_be_future");
                            }
                            await adminFetch(apiBase, token, "/v1/admin/sponsored", {
                              method: "POST",
                              body: JSON.stringify({
                                advertiserName: sponsoredAdvertiserName,
                                headline: sponsoredHeadline,
                                bodyText: sponsoredBodyText,
                                imageUrl: sponsoredImageUrl || undefined,
                                destinationUrl: sponsoredDestinationUrl,
                                ctaText: sponsoredCtaText,
                                accentColor: sponsoredAccentColor,
                                cardFormat: sponsoredCardFormat,
                                placement: sponsoredPlacement,
                                targetAudience: sponsoredAudience,
                                campaignGoal: sponsoredGoal,
                                actionUrl: sponsoredActionUrl || undefined,
                                endsAt: endsAt.toISOString(),
                                impressionLimit: sponsoredImpressionLimit ? Number(sponsoredImpressionLimit) : undefined,
                              }),
                            });
                            setSponsoredAdvertiserName("");
                            setSponsoredHeadline("");
                            setSponsoredBodyText("");
                            setSponsoredDestinationUrl("");
                            setSponsoredImageUrl("");
                            setSponsoredCtaText("Learn More");
                            setSponsoredAccentColor("#14F195");
                            setSponsoredCardFormat("classic");
                            setSponsoredPlacement("feed");
                            setSponsoredAudience("all");
                            setSponsoredGoal("traffic");
                            setSponsoredActionUrl("");
                            setSponsoredImpressionLimit("");
                            setSponsoredEndsAt(() => {
                              const d = new Date();
                              d.setMonth(d.getMonth() + 1);
                              return d.toISOString().slice(0, 16);
                            });
                          },
                          "Sponsored card created."
                        )
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Sponsored Pricing Controls</h3>
                      <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                        These values drive invoice pricing in the advertiser portal and delivery gating in the API.
                      </p>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>
                      {fmt(sponsoredPricingRows.length)} tracked settings
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {sponsoredPricingRows.map((row) => (
                      <div
                        key={row.key}
                        className="rounded-xl border p-3"
                        style={{ background: "rgba(255,255,255,0.55)", borderColor: "var(--color-border-subtle)" }}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>
                          {row.label}
                        </p>
                        <p className="mt-1 text-xs" style={{ color: "var(--color-dim)" }}>
                          {row.description ?? row.key}
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr,96px]">
                          <Input
                            value={editingConfig[row.key] ?? ""}
                            onChange={(value) => setEditingConfig((prev) => ({ ...prev, [row.key]: value }))}
                          />
                          <Button
                            label="Save"
                            variant="ghost"
                            disabled={!!actionLoading}
                            onClick={() =>
                              void doAction(
                                `sponsored-config-${row.key}`,
                                async () => {
                                  await adminFetch(apiBase, token, `/v1/admin/config/${row.key}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ value: editingConfig[row.key] ?? "" }),
                                  });
                                },
                                `${row.label} updated.`
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Billing Operations Queue</h3>
                      <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                        Manual billing review and refund requests stay here until an operator resolves them.
                      </p>
                    </div>
                    <select
                      className="rounded-lg border px-2 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      value={billingRequestFilter}
                      onChange={(event) => setBillingRequestFilter(event.target.value as typeof billingRequestFilter)}
                    >
                      <option value="all">All requests</option>
                      <option value="open">Open</option>
                      <option value="reviewing">Reviewing</option>
                      <option value="resolved">Resolved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>

                  <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Open</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(billingRequests.filter((request) => request.status === "open").length)}
                      </p>
                    </div>
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Reviewing</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(billingRequests.filter((request) => request.status === "reviewing").length)}
                      </p>
                    </div>
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Refund Requests</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(billingRequests.filter((request) => request.requestType === "refund_request").length)}
                      </p>
                    </div>
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Outstanding</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        ${(
                          sponsoredCards
                            .filter((card) => card.billingStatus === "payment_required")
                            .reduce((sum, card) => sum + (card.billingAmountUsdc ?? card.billingAmountSkr ?? 0), 0) / 100
                        ).toFixed(2)} USDC
                      </p>
                    </div>
                  </div>

                  {filteredBillingRequests.length === 0 ? (
                    <div
                      className="rounded-xl border border-dashed px-4 py-6 text-sm"
                      style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-dim)", background: "rgba(255,255,255,0.4)" }}
                    >
                      No billing requests in this state.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr style={{ color: "var(--color-dim)" }}>
                            <th className="px-2 py-2 text-left">Request</th>
                            <th className="px-2 py-2 text-left">Advertiser</th>
                            <th className="px-2 py-2 text-left">Status</th>
                            <th className="px-2 py-2 text-left">Submitted</th>
                            <th className="px-2 py-2 text-left">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredBillingRequests.map((request) => (
                            <tr key={request.id} className="border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
                              <td className="px-2 py-3">
                                <p className="font-semibold" style={{ color: "var(--color-text)" }}>{request.headline}</p>
                                <p className="text-xs uppercase" style={{ color: "var(--color-dim)" }}>
                                  {request.requestType.replace(/_/g, " ")}
                                </p>
                                <p className="mt-1 text-xs" style={{ color: "var(--color-dim)" }}>
                                  {request.note}
                                </p>
                                {request.adminNote ? (
                                  <p className="mt-1 text-xs" style={{ color: "var(--color-dim)" }}>
                                    Ops note: {request.adminNote}
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-2 py-3">
                                <p style={{ color: "var(--color-text)" }}>{request.advertiserName}</p>
                                <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                  {request.walletAddress ? toWalletPreview(request.walletAddress) : "Wallet unavailable"}
                                </p>
                              </td>
                              <td className="px-2 py-3">
                                <p style={{ color: "var(--color-text)" }}>{request.status}</p>
                                {request.resolvedAt ? (
                                  <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                    Resolved {fmtDate(request.resolvedAt)}
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-2 py-3">
                                <p style={{ color: "var(--color-text)" }}>{fmtDate(request.createdAt)}</p>
                                <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                  Updated {fmtDate(request.updatedAt)}
                                </p>
                              </td>
                              <td className="px-2 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    label="Review"
                                    variant="ghost"
                                    disabled={!!actionLoading || request.status === "reviewing"}
                                    onClick={() =>
                                      setPendingAdminAction({
                                        key: `billing-review-${request.id}`,
                                        title: "Mark Billing Request As Reviewing",
                                        message: "Use this state when the operations team has picked up the request and is actively evaluating it.",
                                        confirmLabel: "Start Review",
                                        doneMessage: "Billing request marked as reviewing.",
                                        variant: "ghost",
                                        noteLabel: "Internal Review Note",
                                        notePlaceholder: "Optional note visible to the ops team",
                                        noteValue: request.adminNote ?? "",
                                        run: async (note) => {
                                          await adminFetch(apiBase, token, `/v1/admin/advertiser-billing/requests/${request.id}/status`, {
                                            method: "POST",
                                            body: JSON.stringify({
                                              status: "reviewing",
                                              adminNote: note || undefined,
                                            }),
                                          });
                                        },
                                      })
                                    }
                                  />
                                  <Button
                                    label="Resolve"
                                    variant="ghost"
                                    disabled={!!actionLoading || request.status === "resolved"}
                                    onClick={() =>
                                      setPendingAdminAction({
                                        key: `billing-resolve-${request.id}`,
                                        title: "Resolve Billing Request",
                                        message: "Use a resolution note when you want the advertiser and ops team to have a clear audit trail.",
                                        confirmLabel: "Resolve Request",
                                        doneMessage: "Billing request resolved.",
                                        variant: "ghost",
                                        noteLabel: "Resolution Note",
                                        notePlaceholder: "Recommended: explain the outcome",
                                        noteValue: request.adminNote ?? "",
                                        run: async (note) => {
                                          await adminFetch(apiBase, token, `/v1/admin/advertiser-billing/requests/${request.id}/status`, {
                                            method: "POST",
                                            body: JSON.stringify({
                                              status: "resolved",
                                              adminNote: note || undefined,
                                            }),
                                          });
                                        },
                                      })
                                    }
                                  />
                                  <Button
                                    label="Reject"
                                    variant="danger"
                                    disabled={!!actionLoading || request.status === "rejected"}
                                    onClick={() =>
                                      setPendingAdminAction({
                                        key: `billing-reject-${request.id}`,
                                        title: "Reject Billing Request",
                                        message: "Rejections should include a clear operator note so the advertiser understands why no adjustment will be made.",
                                        confirmLabel: "Reject Request",
                                        doneMessage: "Billing request rejected.",
                                        variant: "danger",
                                        noteLabel: "Rejection Reason",
                                        notePlaceholder: "Issue not eligible for adjustment",
                                        noteRequired: true,
                                        noteValue: request.adminNote ?? "Issue not eligible for adjustment",
                                        run: async (note) => {
                                          await adminFetch(apiBase, token, `/v1/admin/advertiser-billing/requests/${request.id}/status`, {
                                            method: "POST",
                                            body: JSON.stringify({
                                              status: "rejected",
                                              adminNote: note,
                                            }),
                                          });
                                        },
                                      })
                                    }
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border p-4" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>Sponsored Campaigns</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr style={{ color: "var(--color-dim)" }}>
                          <th className="px-2 py-2 text-left">Campaign</th>
                          <th className="px-2 py-2 text-left">Type</th>
                          <th className="px-2 py-2 text-left">Schedule</th>
                          <th className="px-2 py-2 text-left">Performance</th>
                          <th className="px-2 py-2 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sponsoredCards.map((card) => (
                          <tr key={card.id} className="border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
                            <td className="px-2 py-3">
                              <p className="font-semibold" style={{ color: "var(--color-text)" }}>{card.headline}</p>
                              <p style={{ color: "var(--color-dim)" }}>{card.advertiserName}</p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>{card.id}</p>
                            </td>
                            <td className="px-2 py-3">
                              <p className="text-xs uppercase" style={{ color: "var(--color-text)" }}>
                                {card.campaignGoal} • {card.cardFormat} • {card.placement}
                              </p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                {card.targetAudience.replace(/_/g, " ")}
                              </p>
                            </td>
                            <td className="px-2 py-3">
                              <p style={{ color: "var(--color-muted)" }}>{fmtDate(card.startsAt)} to {fmtDate(card.endsAt)}</p>
                              <p className="text-xs" style={{ color: "var(--color-dim)" }}>{card.isActive ? "Active" : "Inactive"}</p>
                              <p className="text-xs" style={{ color: card.approvalStatus === "rejected" ? "#b42318" : "var(--color-dim)" }}>
                                Review: {card.approvalStatus}
                              </p>
                              <p className="text-xs" style={{ color: card.billingStatus === "payment_required" ? "#6941c6" : "var(--color-dim)" }}>
                                Billing: {card.billingStatus} • ${((card.billingAmountUsdc ?? card.billingAmountSkr ?? 0) / 100).toFixed(2)} USDC
                              </p>
                              {card.rejectionReason ? (
                                <p className="text-xs" style={{ color: "#b42318" }}>
                                  Reason: {card.rejectionReason}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-2 py-3">
                              <p>{fmt(card.impressionCount)} impressions</p>
                              <p style={{ color: "var(--color-dim)" }}>{fmt(card.clickCount)} clicks</p>
                              <p style={{ color: "var(--color-dim)" }}>{fmt(card.leadCount)} leads</p>
                              {card.paymentReceivedAt ? (
                                <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                                  Paid: {fmtDate(card.paymentReceivedAt)}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-2 py-3">
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  label={card.isActive ? "Deactivate" : "Activate"}
                                  variant={card.isActive ? "danger" : "ghost"}
                                  disabled={!!actionLoading}
                                  onClick={() => {
                                    const nextActive = !card.isActive;
                                    setPendingAdminAction({
                                      key: `${nextActive ? "activate" : "deactivate"}-sponsored-${card.id}`,
                                      title: `${nextActive ? "Activate" : "Deactivate"} Sponsored Campaign`,
                                      message: `${nextActive ? "Activate" : "Deactivate"} this sponsored campaign for delivery. Billing and approval rules will still be enforced by the API.`,
                                      confirmLabel: nextActive ? "Activate Campaign" : "Deactivate Campaign",
                                      doneMessage: `Sponsored card ${nextActive ? "activated" : "deactivated"}.`,
                                      variant: nextActive ? "ghost" : "danger",
                                      noteValue: "",
                                      run: async () => {
                                        await adminFetch(apiBase, token, `/v1/admin/sponsored/${card.id}/status`, {
                                          method: "POST",
                                          body: JSON.stringify({ active: nextActive }),
                                        });
                                      },
                                    });
                                  }}
                                />
                                <Button
                                  label="Approve"
                                  variant="ghost"
                                  disabled={!!actionLoading || card.approvalStatus === "approved"}
                                  onClick={() =>
                                    void doAction(
                                      `approve-sponsored-${card.id}`,
                                      async () => {
                                        await adminFetch(apiBase, token, `/v1/admin/sponsored/${card.id}/review`, {
                                          method: "POST",
                                          body: JSON.stringify({ decision: "approve" }),
                                        });
                                      },
                                      "Sponsored card approved."
                                    )
                                  }
                                />
                                <Button
                                  label="Reject"
                                  variant="danger"
                                  disabled={!!actionLoading || card.approvalStatus === "rejected"}
                                  onClick={() =>
                                    setPendingAdminAction({
                                      key: `reject-sponsored-${card.id}`,
                                      title: "Reject Sponsored Campaign",
                                      message: "Rejected campaigns should include a clear reason so advertisers can revise and resubmit correctly.",
                                      confirmLabel: "Reject Campaign",
                                      doneMessage: "Sponsored card rejected.",
                                      variant: "danger",
                                      noteLabel: "Rejection Reason",
                                      notePlaceholder: "Content policy mismatch",
                                      noteRequired: true,
                                      noteValue: "Content policy mismatch",
                                      run: async (note) => {
                                        await adminFetch(apiBase, token, `/v1/admin/sponsored/${card.id}/review`, {
                                          method: "POST",
                                          body: JSON.stringify({ decision: "reject", reason: note }),
                                        });
                                      },
                                    })
                                  }
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {!loading && tab === "feedback" ? (
              <section className="space-y-4">
                <div
                  className="rounded-xl border p-4"
                  style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: "var(--color-text)" }}>
                        User Feedback
                      </h3>
                      <p className="text-xs" style={{ color: "var(--color-dim)" }}>
                        Wallet-authenticated reports and suggestions from the mobile app.
                      </p>
                    </div>
                    <select
                      className="rounded-lg border px-2 py-2 text-sm"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      value={feedbackStatusFilter}
                      onChange={(event) => setFeedbackStatusFilter(event.target.value as typeof feedbackStatusFilter)}
                    >
                      <option value="all">All feedback</option>
                      <option value="new">New</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>

                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>New</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(feedbackList.filter((item) => item.status === "new").length)}
                      </p>
                    </div>
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Reviewed</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(feedbackList.filter((item) => item.status === "reviewed").length)}
                      </p>
                    </div>
                    <div className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}>
                      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-dim)" }}>Resolved</p>
                      <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-text)" }}>
                        {fmt(feedbackList.filter((item) => item.status === "resolved").length)}
                      </p>
                    </div>
                  </div>

                  {filteredFeedback.length === 0 ? (
                    <div
                      className="rounded-xl border border-dashed px-4 py-6 text-sm"
                      style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-dim)", background: "rgba(255,255,255,0.4)" }}
                    >
                      No feedback in this state.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredFeedback.map((feedback) => {
                        const typeColor =
                          feedback.type === "bug"
                            ? "#ef4444"
                            : feedback.type === "suggestion"
                            ? "#8b5cf6"
                            : "#6b7280";
                        return (
                          <div
                            key={feedback.id}
                            className="rounded-xl border p-4"
                            style={{ borderColor: "var(--color-border-subtle)", background: "rgba(255,255,255,0.55)" }}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide"
                                  style={{ background: `${typeColor}18`, color: typeColor }}
                                >
                                  {feedback.type}
                                </span>
                                <span className="text-xs" style={{ color: "var(--color-dim)" }}>
                                  {toWalletPreview(feedback.wallet)}
                                </span>
                                <span className="text-xs" style={{ color: "var(--color-dim)" }}>
                                  {fmtDate(feedback.createdAt)}
                                </span>
                              </div>
                              <span className="text-xs" style={{ color: "var(--color-dim)" }}>
                                Updated {fmtDate(feedback.updatedAt)}
                              </span>
                            </div>

                            <h4 className="mt-3 text-sm font-bold" style={{ color: "var(--color-text)" }}>
                              {feedback.subject}
                            </h4>
                            <p className="mt-2 text-sm leading-6" style={{ color: "var(--color-muted)" }}>
                              {truncateText(feedback.message, 320)}
                            </p>

                            {(feedback.appVersion || feedback.platform) ? (
                              <p className="mt-2 text-xs" style={{ color: "var(--color-dim)" }}>
                                {[feedback.appVersion, feedback.platform].filter(Boolean).join(" • ")}
                              </p>
                            ) : null}

                            <div className="mt-4 grid gap-3 lg:grid-cols-[180px,1fr,120px]">
                              <select
                                className="rounded-lg border px-2 py-2 text-sm"
                                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                                value={feedback.status}
                                onChange={(event) => {
                                  const newStatus = event.target.value;
                                  setPendingAdminAction({
                                    key: `feedback-status-${feedback.id}`,
                                    title: "Update Feedback Status",
                                    message: `Change status to "${newStatus}"?`,
                                    confirmLabel: "Confirm",
                                    doneMessage: "Feedback status updated.",
                                    noteValue: "",
                                    run: async () => {
                                      await adminFetch(apiBase, token, `/v1/admin/feedback/${feedback.id}`, {
                                        method: "PATCH",
                                        body: JSON.stringify({ status: newStatus }),
                                      });
                                    },
                                  });
                                }}
                              >
                                <option value="new">New</option>
                                <option value="reviewed">Reviewed</option>
                                <option value="resolved">Resolved</option>
                              </select>

                              <textarea
                                className="w-full rounded-lg border px-3 py-2 text-sm"
                                style={{
                                  background: "var(--color-surface)",
                                  borderColor: "var(--color-border)",
                                  color: "var(--color-text)",
                                }}
                                rows={3}
                                value={feedbackNotes[feedback.id] ?? ""}
                                onChange={(event) =>
                                  setFeedbackNotes((prev) => ({
                                    ...prev,
                                    [feedback.id]: event.target.value,
                                  }))
                                }
                                placeholder="Internal notes for ops follow-up"
                              />

                              <Button
                                label="Save Notes"
                                variant="ghost"
                                disabled={!!actionLoading}
                                onClick={() =>
                                  void doAction(
                                    `feedback-note-${feedback.id}`,
                                    async () => {
                                      await adminFetch(apiBase, token, `/v1/admin/feedback/${feedback.id}`, {
                                        method: "PATCH",
                                        body: JSON.stringify({
                                          adminNotes: (feedbackNotes[feedback.id] ?? "").trim() || null,
                                        }),
                                      });
                                    },
                                    "Feedback notes updated."
                                  )
                                }
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
