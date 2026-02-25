import { clearToken } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.chainshorts.live";
const REQUEST_TIMEOUT_MS = 10_000;

async function apiFetch(path: string, opts: RequestInit & { token?: string } = {}) {
  const { token, ...fetchOpts } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOpts.headers as Record<string, string> ?? {}),
  };
  if (token) headers["x-advertiser-token"] = token;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const upstreamSignal = fetchOpts.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...fetchOpts, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", abortFromUpstream);
    }
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      clearToken();
      window.location.href = "/login";
    }
    const err = await res.json().catch(() => ({ error: "unknown" }));
    const errorCode = (err as any).error ?? "request_failed";
    const reason = typeof (err as any).reason === "string" ? `_${(err as any).reason}` : "";
    const humanized = `${errorCode}${reason}`
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
    throw Object.assign(new Error(humanized), { status: res.status, data: err });
  }
  return res.json();
}

export async function requestChallenge(walletAddress: string) {
  return apiFetch("/v1/advertiser/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ walletAddress }),
  }) as Promise<{ nonce: string; message: string; expiresAt: string }>;
}

export async function verifyWallet(walletAddress: string, message: string, signature: string) {
  return apiFetch("/v1/advertiser/auth/verify", {
    method: "POST",
    body: JSON.stringify({ walletAddress, message, signature }),
  }) as Promise<{ token: string; advertiser: any; needsOnboarding: boolean }>;
}

export async function getMe(token: string) {
  return apiFetch("/v1/advertiser/me", { token }) as Promise<{ advertiser: any }>;
}

export async function onboardMe(token: string, companyName: string, websiteUrl?: string) {
  return apiFetch("/v1/advertiser/me", {
    method: "PATCH",
    token,
    body: JSON.stringify({ companyName, websiteUrl }),
  }) as Promise<{ advertiser: any }>;
}

export async function logout(token: string) {
  return apiFetch("/v1/advertiser/logout", { method: "POST", token });
}

export async function getCampaigns(token: string) {
  return apiFetch("/v1/advertiser/campaigns", { token }) as Promise<{ campaigns: Campaign[] }>;
}

export async function getCampaign(token: string, id: string) {
  return apiFetch(`/v1/advertiser/campaigns/${id}`, { token }) as Promise<{ campaign: CampaignDetail }>;
}

export async function getBilling(token: string) {
  return apiFetch("/v1/advertiser/billing", { token }) as Promise<BillingOverview>;
}

export async function getCampaignPaymentRequest(token: string, id: string) {
  return apiFetch(`/v1/advertiser/campaigns/${id}/payment-request`, { token }) as Promise<{
    id: string;
    billingAmountUsdc: number;
    platformWallet: string;
    paymentIntentId: string;
    paymentIntentExpiresAt: string;
    paymentRequestUrl: string;
  }>;
}

export async function createCampaign(token: string, data: CreateCampaignInput) {
  return apiFetch("/v1/advertiser/campaigns", {
    method: "POST",
    token,
    body: JSON.stringify(data),
  }) as Promise<{ ok: boolean; id: string }>;
}

export async function deleteCampaign(token: string, id: string) {
  return apiFetch(`/v1/advertiser/campaigns/${id}`, { method: "DELETE", token });
}

export async function setCampaignStatus(token: string, id: string, active: boolean) {
  return apiFetch(`/v1/advertiser/campaigns/${id}/status`, {
    method: "POST",
    token,
    body: JSON.stringify({ active }),
  }) as Promise<{ ok: boolean; id: string; active: boolean }>;
}

export async function updateCampaign(token: string, id: string, data: UpdateCampaignInput) {
  return apiFetch(`/v1/advertiser/campaigns/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(data),
  }) as Promise<{ ok: boolean; id: string; reviewStatus: "pending" }>;
}

export async function payCampaign(token: string, id: string, txSignature: string, paymentIntentId?: string) {
  return apiFetch(`/v1/advertiser/campaigns/${id}/pay`, {
    method: "POST",
    token,
    body: JSON.stringify({ txSignature, paymentIntentId }),
  }) as Promise<{
    ok: boolean;
    id: string;
    billingStatus: "paid";
    paymentReceivedAt: string | null;
    amountUsdc: number;
    alreadyPaid?: boolean;
  }>;
}

export async function getBillingRequests(token: string) {
  return apiFetch("/v1/advertiser/billing/requests", { token }) as Promise<{ requests: BillingRequest[] }>;
}

export async function createBillingRequest(
  token: string,
  input: {
    cardId: string;
    requestType: "billing_review" | "refund_request";
    note: string;
  }
) {
  return apiFetch("/v1/advertiser/billing/requests", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  }) as Promise<{ ok: boolean; requestId: string }>;
}

export interface Campaign {
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
  billingAmountSkr?: number;
  billingAmountUsdc: number;
  billingStatus: "not_required" | "approval_pending" | "payment_required" | "paid";
  paymentTxSignature: string | null;
  paymentReceivedAt: string | null;
  createdAt: string;
}

export interface CampaignDetail extends Campaign {
  // Campaign detail currently matches Campaign fields.
}

export interface CreateCampaignInput {
  headline: string;
  bodyText: string;
  imageUrl?: string;
  destinationUrl: string;
  ctaText: string;
  accentColor: string;
  cardFormat: "classic" | "banner" | "spotlight" | "portrait";
  placement: "feed" | "predict" | "both";
  targetAudience: "all" | "defi_degens" | "whales" | "nft_collectors";
  campaignGoal: "traffic" | "action" | "lead_gen";
  actionUrl?: string;
  startsAt?: string;
  endsAt: string;
  impressionLimit?: number;
}

export interface UpdateCampaignInput {
  headline?: string;
  bodyText?: string;
  imageUrl?: string | null;
  destinationUrl?: string;
  ctaText?: string;
  accentColor?: string;
  cardFormat?: "classic" | "banner" | "spotlight" | "portrait";
  placement?: "feed" | "predict" | "both";
  targetAudience?: "all" | "defi_degens" | "whales" | "nft_collectors";
  campaignGoal?: "traffic" | "action" | "lead_gen";
  actionUrl?: string | null;
  startsAt?: string;
  endsAt?: string;
  impressionLimit?: number | null;
}

export interface BillingOverview {
  platformWallet: string;
  skrMint?: string;
  pricing: {
    defaultImpressionLimit: number;
    cpmClassicSkr?: number;
    cpmClassicUsdc: number;
    cpmBannerSkr?: number;
    cpmBannerUsdc: number;
    cpmSpotlightSkr?: number;
    cpmSpotlightUsdc: number;
    cpmPortraitUsdc: number;
    predictMultiplierPct: number;
    bothMultiplierPct: number;
  };
  openInvoices: Array<{
    id: string;
    headline: string;
    billingAmountSkr?: number;
    billingAmountUsdc: number;
    impressionLimit: number | null;
    cardFormat: string;
    placement: "feed" | "predict" | "both";
    endsAt: string;
    paymentIntentId: string;
    paymentIntentExpiresAt: string;
    paymentRequestUrl: string;
  }>;
  requests: BillingRequest[];
  summary: {
    approvedAwaitingPayment: number;
    outstandingSkr?: number;
    outstandingUsdc: number;
    paidSkr?: number;
    paidUsdc: number;
  };
}

export interface BillingRequest {
  id: string;
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
}
