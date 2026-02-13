import Constants from "expo-constants";
import { Platform } from "react-native";
import type { FeedCard, ReactionType } from "@chainshorts/shared";
import type {
  AlertVoteResponse,
  AlertsResponse,
  ConfigResponse,
  FeedFreshnessResponse,
  FeedResponse,
  ReactionCountsResponse,
  SourcesResponse,
  WalletBalancesResponse
} from "../types";

const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
const isProduction = appEnv === "production";

function isPrivateHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase();
  if (value === "localhost" || value === "127.0.0.1" || value === "::1") {
    return true;
  }
  if (value.startsWith("10.") || value.startsWith("192.168.") || value.startsWith("169.254.")) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) {
    return true;
  }
  if (value.endsWith(".local") || value.endsWith(".internal")) {
    return true;
  }
  return false;
}

function normalizeBaseUrl(raw: string | undefined): string {
  if (!raw) {
    return "";
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("${")) {
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }
  if (parsed.username || parsed.password) {
    return "";
  }
  if (parsed.search || parsed.hash) {
    return "";
  }
  if (isProduction && parsed.protocol !== "https:") {
    return "";
  }
  if (isProduction && isPrivateHost(parsed.hostname)) {
    return "";
  }

  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

const configuredApiBaseUrl = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL ?? (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined)
);

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const ERROR_MESSAGES: Record<string, string> = {
  // Auth errors
  invalid_wallet_address: "Invalid wallet address",
  invalid_request: "Invalid request format",
  invalid_query: "Couldn't load data — please try again",
  missing_nonce: "Challenge expired. Please try again.",
  challenge_not_found: "Session expired. Please try again.",
  challenge_expired: "Challenge expired. Please reconnect.",
  message_mismatch: "Signature verification failed. Please try again.",
  signature_invalid: "Invalid signature. Please try again.",
  session_not_found: "Session expired. Please reconnect.",
  session_required: "Please connect your wallet first.",
  session_invalid: "Session expired. Please reconnect.",
  session_expired: "Session expired. Please reconnect.",
  session_wallet_mismatch: "Session does not match this wallet.",
  unauthorized: "Please connect your wallet first.",
  // Rate limiting
  rate_limit_exceeded: "Too many requests. Please wait a moment.",
  // General
  internal_error: "Server error. Please try again later.",
  not_found: "Resource not found.",
  claim_not_yet_available: "Payout is not claimable yet.",
  payout_transfer_in_progress: "Payout transfer is in progress. Please retry in a few moments.",
  cashout_transfer_in_progress: "Cashout is already in progress for this stake.",
  cashout_temporarily_unavailable: "Cashout is temporarily unavailable. Your stake is still active.",
  invalid_payment_transaction_not_found: "Payment is still being indexed. Please try again in a few seconds.",
  invalid_payment_rpc_timeout: "Payment verification timed out. Please try again.",
  invalid_payment_rpc_error: "Payment verification service is temporarily unavailable. Please try again.",
  invalid_payment_sender_not_verified: "Could not verify your SKR transfer. Please check your wallet balance and try again.",
  invalid_payment_insufficient_skr_payment: "SKR transfer amount is less than required. Please try again.",
  invalid_payment_transaction_failed: "Your SKR transaction failed on-chain. Please try again.",
  invalid_deposit_payment_transaction_not_found: "Deposit payment is still being indexed. Please try again in a few seconds.",
  invalid_deposit_payment_rpc_timeout: "Deposit verification timed out. Please try again.",
  invalid_deposit_payment_rpc_error: "Deposit verification service is temporarily unavailable. Please try again."
  ,
  stake_rejected_after_payment_market_not_active:
    "Your SKR was received but the market closed before the stake was recorded. Email support@chainshorts.live with your wallet address for a refund.",
  stake_rejected_after_payment_prediction_not_found:
    "Your SKR was received but the market could not be found. Email support@chainshorts.live with your wallet address for a refund.",
  stake_rejected_after_payment_stake_below_minimum:
    "Your SKR was received but the stake amount was below the minimum. Email support@chainshorts.live with your wallet address for a refund.",
  stake_rejected_after_payment_stake_above_maximum:
    "Your SKR was received but the stake amount exceeded the maximum. Email support@chainshorts.live with your wallet address for a refund.",
  stake_rejected_after_payment_payment_intent_invalid:
    "Your SKR was received but the stake could not be verified. Email support@chainshorts.live with your wallet address for a refund.",
  stake_rejected_after_payment_payment_intent_expired:
    "Your SKR was received but the stake could not be completed. Email support@chainshorts.live with your wallet address for a refund.",
  dispute_rejected_after_payment_poll_not_found:
    "Your dispute deposit was received but the market could not be verified. Email support@chainshorts.live with your wallet address for a refund.",
  dispute_rejected_after_payment_poll_not_resolved:
    "Your dispute deposit was received but the market was no longer disputable. Email support@chainshorts.live with your wallet address for a refund.",
  dispute_rejected_after_payment_challenge_window_closed:
    "Your dispute deposit was received after the dispute window closed. Email support@chainshorts.live with your wallet address for a refund.",
  dispute_rejected_after_payment_dispute_already_filed:
    "Your dispute deposit was received but a dispute was already open for this market. Email support@chainshorts.live with your wallet address for a refund.",
  dispute_rejected_after_payment_payment_intent_invalid:
    "Your dispute deposit was received but could not be matched. Email support@chainshorts.live with your wallet address for a refund.",
  dispute_rejected_after_payment_payment_intent_expired:
    "Your dispute deposit was received but the reservation expired. Email support@chainshorts.live with your wallet address for a refund."
};

function parseApiError(errorBody: string, status: number): string {
  try {
    const parsed = JSON.parse(errorBody) as { error?: string; message?: string; reason?: string };
    const errorCode = parsed.error ?? parsed.message;
    const reason = typeof parsed.reason === "string" ? parsed.reason : undefined;
    if (errorCode && reason) {
      const composite = `${errorCode}_${reason}`;
      if (ERROR_MESSAGES[composite]) {
        return ERROR_MESSAGES[composite];
      }
    }
    if (errorCode && ERROR_MESSAGES[errorCode]) {
      return ERROR_MESSAGES[errorCode];
    }
    if (errorCode) {
      // Convert snake_case to readable format
      return errorCode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch {
    // Not JSON, use as-is
  }

  // Fallback for non-JSON errors
  if (status === 401) return "Authentication failed. Please reconnect.";
  if (status === 403) return "Access denied.";
  if (status === 404) return "Resource not found.";
  if (status === 429) return "Too many requests. Please wait.";
  if (status >= 500) return "Server error. Please try again later.";

  return `Request failed (${status})`;
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "api",
    readonly status?: number
  ) {
    super(message);
  }
}

/**
 * Returns a user-friendly toast message from any caught error.
 * - API errors (already translated) are shown as-is.
 * - Network/timeout errors show a generic connectivity message.
 * - Everything else shows the provided fallback.
 */
export function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    if (error.kind === "api") return error.message;
    return "No connection — please try again";
  }
  if (error instanceof Error && /network|timeout|connect|reach|fetch/i.test(error.message)) {
    return "No connection — please try again";
  }
  return fallback;
}

let authFailureHandler: (() => void) | null = null;

export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveApiBaseUrls(): string[] {
  if (configuredApiBaseUrl.trim()) {
    return [configuredApiBaseUrl.trim()];
  }

  if (appEnv === "production") {
    return [];
  }

  if (Platform.OS === "android") {
    return unique(["http://127.0.0.1:8787", "http://10.0.2.2:8787", "http://localhost:8787"]);
  }

  return unique(["http://localhost:8787", "http://127.0.0.1:8787"]);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

interface RequestOptions extends RequestInit {
  sessionToken?: string;
  timeoutMs?: number;
}

async function requestFromBase<T>(baseUrl: string, path: string, init?: RequestOptions): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined)
  };

  if (init?.sessionToken) {
    headers.Authorization = `Bearer ${init.sessionToken}`;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`, {
        ...init,
        headers
      }, timeoutMs);

      if (!response.ok) {
        const errorBody = await response.text();
        if (init?.sessionToken && (
          response.status === 401 ||
          (response.status === 403 && errorBody.includes("session_wallet_mismatch"))
        )) {
          authFailureHandler?.();
        }
        const retryable = RETRYABLE_STATUS.has(response.status);
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(attempt * 350);
          continue;
        }
        throw new ApiRequestError(parseApiError(errorBody, response.status), "api", response.status);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(attempt * 350);
        continue;
      }

      const reason = error instanceof Error ? error.message : "unknown_error";
      throw new ApiRequestError(`Network request failed: ${reason}`, "network");
    }
  }

  throw new ApiRequestError("Network request failed: unknown_error", "network");
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const errors: string[] = [];
  const baseUrls = resolveApiBaseUrls();
  if (!baseUrls.length) {
    throw new Error("Unable to reach Chainshorts API. EXPO_PUBLIC_API_BASE_URL is required in production.");
  }
  for (const baseUrl of baseUrls) {
    try {
      return await requestFromBase<T>(baseUrl, path, init);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.kind === "api") {
          throw error;
        }
        errors.push(`${baseUrl}: ${error.message}`);
        continue;
      }

      errors.push(`${baseUrl}: ${error instanceof Error ? error.message : "unknown_error"}`);
    }
  }

  throw new Error(`Unable to reach Chainshorts API. ${errors.join(" | ")}`);
}

export async function fetchFeed(
  input: { cursor?: string; category?: string; lang?: string; limit?: number; wallet?: string },
  sessionToken?: string
): Promise<FeedResponse> {
  const params = new URLSearchParams();
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.category) params.set("category", input.category);
  if (input.lang) params.set("lang", input.lang);
  if (input.limit) params.set("limit", String(input.limit));

  const qs = params.toString();
  // Pass wallet header for personalized feed filtering (hide predictions user already staked on)
  const headers: Record<string, string> | undefined = input.wallet
    ? { "x-wallet-address": input.wallet }
    : undefined;
  return request<FeedResponse>(`/v1/feed${qs ? `?${qs}` : ""}`, { sessionToken, headers });
}

export async function fetchArticleById(id: string, sessionToken?: string): Promise<FeedCard> {
  return request<FeedCard>(`/v1/articles/${encodeURIComponent(id)}`, { sessionToken });
}

export async function searchFeed(
  input: { q: string; cursor?: string; category?: string; lang?: string; limit?: number; wallet?: string },
  sessionToken?: string
): Promise<FeedResponse> {
  const params = new URLSearchParams();
  params.set("q", input.q);
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.category) params.set("category", input.category);
  if (input.lang) params.set("lang", input.lang);
  if (input.limit) params.set("limit", String(input.limit));
  const qs = params.toString();
  // Pass wallet header for personalized feed filtering (hide predictions user already staked on)
  const headers: Record<string, string> | undefined = input.wallet
    ? { "x-wallet-address": input.wallet }
    : undefined;
  return request<FeedResponse>(`/v1/feed/search?${qs}`, { sessionToken, headers });
}

export async function fetchFeedFreshness(sessionToken?: string): Promise<FeedFreshnessResponse> {
  return request<FeedFreshnessResponse>("/v1/feed/freshness", { sessionToken });
}

export async function fetchReactionCounts(articleIds: string[], sessionToken?: string): Promise<ReactionCountsResponse> {
  const ids = [...new Set(articleIds.filter(Boolean))];
  if (!ids.length) {
    return { items: {} };
  }
  const params = new URLSearchParams();
  params.set("articleIds", ids.join(","));
  return request<ReactionCountsResponse>(`/v1/reactions/counts?${params.toString()}`, { sessionToken });
}

export async function fetchSources(sessionToken?: string): Promise<SourcesResponse> {
  return request<SourcesResponse>("/v1/sources", { sessionToken });
}

export async function requestChallenge(walletAddress: string): Promise<{ nonce: string; message: string; expiresAt: string }> {
  return request("/v1/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ walletAddress })
  });
}

export async function verifyChallenge(input: {
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<{ sessionToken: string; walletAddress: string; expiresAt: string }> {
  return request("/v1/auth/verify", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function logoutSession(input: { walletAddress: string; sessionToken: string }): Promise<{ ok: true }> {
  return request("/v1/auth/logout", {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      walletAddress: input.walletAddress
    })
  });
}

export async function logoutAllSessions(input: {
  walletAddress: string;
  sessionToken: string;
}): Promise<{ ok: true; revokedCount: number }> {
  return request("/v1/auth/logout-all", {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      walletAddress: input.walletAddress
    })
  });
}

export async function submitFeedback(input: {
  sessionToken: string;
  type: "bug" | "suggestion" | "other";
  subject: string;
  message: string;
  appVersion?: string;
  platform?: "android" | "ios" | "web";
}): Promise<{ id: string; createdAt: string }> {
  return request("/v1/feedback", {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      type: input.type,
      subject: input.subject,
      message: input.message,
      appVersion: input.appVersion ?? Constants.expoConfig?.version,
      platform:
        input.platform ??
        (Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web")
    })
  });
}

export async function fetchBookmarks(input: {
  wallet: string;
  cursor?: string;
  sessionToken: string;
}): Promise<FeedResponse> {
  const params = new URLSearchParams();
  params.set("wallet", input.wallet);
  if (input.cursor) params.set("cursor", input.cursor);

  return request<FeedResponse>(`/v1/bookmarks?${params.toString()}`, {
    sessionToken: input.sessionToken
  });
}

export async function saveBookmark(input: {
  wallet: string;
  articleId: string;
  sessionToken: string;
}): Promise<{ ok: true }> {
  return request("/v1/bookmarks", {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      wallet: input.wallet,
      articleId: input.articleId
    })
  });
}

export async function removeBookmark(input: {
  wallet: string;
  articleId: string;
  sessionToken: string;
}): Promise<{ ok: true }> {
  return request("/v1/bookmarks", {
    method: "DELETE",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      wallet: input.wallet,
      articleId: input.articleId
    })
  });
}

export async function submitReaction(input: {
  articleId: string;
  wallet: string;
  reactionType: ReactionType;
  nonce: string;
  signature: string;
  sessionToken: string;
}): Promise<{ ok: true }> {
  return request("/v1/reactions/sign", {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      articleId: input.articleId,
      wallet: input.wallet,
      reactionType: input.reactionType,
      nonce: input.nonce,
      signature: input.signature
    })
  });
}


export async function registerPushToken(input: {
  deviceId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  walletAddress?: string;
  locale?: string;
  appVersion?: string;
  sessionToken?: string;
}): Promise<{ ok: true }> {
  return request("/v1/push/register", {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      deviceId: input.deviceId,
      expoPushToken: input.expoPushToken,
      platform: input.platform,
      walletAddress: input.walletAddress,
      locale: input.locale,
      appVersion: input.appVersion
    })
  });
}

export async function unregisterPushToken(input: {
  deviceId: string;
  expoPushToken: string;
  walletAddress?: string;
  sessionToken?: string;
}): Promise<{ ok: true }> {
  return request("/v1/push/unregister", {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      deviceId: input.deviceId,
      expoPushToken: input.expoPushToken,
      walletAddress: input.walletAddress
    })
  });
}

export async function fetchClientConfig(sessionToken?: string): Promise<ConfigResponse> {
  return request<ConfigResponse>("/v1/config", { sessionToken });
}

export async function fetchWalletBalances(wallet: string, sessionToken?: string): Promise<WalletBalancesResponse> {
  const params = new URLSearchParams();
  params.set("wallet", wallet);
  return request<WalletBalancesResponse>(`/v1/wallet/balances?${params.toString()}`, { sessionToken });
}

export async function fetchAlerts(input?: {
  cursor?: string;
  severity?: "RED" | "ORANGE" | "YELLOW";
  limit?: number;
  wallet?: string;
  sessionToken?: string;
}): Promise<AlertsResponse> {
  const params = new URLSearchParams();
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.severity) params.set("severity", input.severity);
  if (input?.limit) params.set("limit", String(input.limit));
  if (input?.wallet) params.set("wallet", input.wallet);
  const qs = params.toString();
  return request<AlertsResponse>(`/v1/alerts${qs ? `?${qs}` : ""}`, { sessionToken: input?.sessionToken });
}

export async function submitAlert(input: {
  wallet: string;
  txHash: string;
  observation: string;
  sessionToken: string;
}): Promise<{ submissionId: string; status: string; queuedForReview: boolean }> {
  return request("/v1/alerts/submit", {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      wallet: input.wallet,
      txHash: input.txHash,
      observation: input.observation
    })
  });
}

export async function voteAlert(input: {
  alertId: string;
  wallet: string;
  vote: "helpful" | "false_alarm";
  sessionToken: string;
}): Promise<AlertVoteResponse> {
  return request<AlertVoteResponse>(`/v1/alerts/${encodeURIComponent(input.alertId)}/vote`, {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      wallet: input.wallet,
      vote: input.vote
    })
  });
}

// ─── Prediction Markets ────────────────────────────────────────────────────────

export interface PredictionPool {
  pollId: string;
  yesPoolSkr: number;
  noPoolSkr: number;
  totalPoolSkr: number;
  yesStakers: number;
  noStakers: number;
  totalStakers: number;
  yesPct: number;
  noPct: number;
  yesOdds: number;
  noOdds: number;
  updatedAt: string;
}

export interface PredictionStake {
  id: string;
  pollId: string;
  wallet: string;
  side: "yes" | "no";
  amountSkr: number;
  txSignature: string;
  status: "active" | "cashing_out" | "won" | "lost" | "cancelled" | "claimed";
  payoutSkr?: number;
  cashoutTxSignature?: string;
  cashoutTransferStatus?: "in_progress" | "complete" | "failed";
  createdAt: string;
}

export interface PredictionMarket {
  id: string;
  question: string;
  articleContext?: string;
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
  yesPct: number;
  noPct: number;
  deadlineAt: string;
  status: "active" | "resolved" | "cancelled";
  resolvedOutcome?: "yes" | "no";
  resolutionSource?: string;
  resolvedAt?: string;
  createdAt: string;
  isPrediction: true;
  minStakeSkr: number;
  maxStakeSkr: number;
  platformFeePct: number;
  disputeFreeze?: boolean;
  pool?: PredictionPool;
  userStakes?: PredictionStake[];
}

export interface PredictionStakeReceipt {
  stakeId: string;
  pollId: string;
  side: "yes" | "no";
  amountSkr: number;
  pool: PredictionPool;
  potentialPayout: number;
  createdAt: string;
}

export interface PredictionPayout {
  id: string;
  pollId: string;
  wallet: string;
  stakeId: string;
  stakeSkr: number;
  winningsSkr: number;
  platformFeeSkr: number;
  netPayoutSkr: number;
  payoutRatio: number;
  status: "pending" | "claimed" | "expired" | "frozen";
  claimableAt?: string;
  claimDeadline?: string;
  claimedAt?: string;
  txSignature?: string;
  createdAt: string;
}

export interface PredictionUserPortfolio {
  activeStakes: Array<PredictionStake & { poll: { id: string; question: string; status: string }; potentialPayout: number }>;
  resolvedStakes: Array<PredictionStake & {
    poll: { id: string; question: string; status: string; resolvedOutcome?: "yes" | "no"; resolvedAt?: string };
    payout?: PredictionPayout;
    resolution?: { outcome: "yes" | "no"; resolvedAt: string; consensus: "3/3" | "2/3" | "manual"; agentAgreement: number; evidenceSources: Array<{ title: string; url: string }>; reason?: string };
  }>;
  totalStakedSkr: number;
  totalWonSkr: number;
  totalLostSkr: number;
  pendingPayoutsSkr: number;
}

export interface PredictionsResponse {
  items: PredictionMarket[];
  nextCursor?: string;
}

export interface PredictionSponsoredStrategy {
  enabled: boolean;
  sponsoredMinGap: number;
  sponsoredMaxGap: number;
  maxSponsoredPerPage: number;
}

export interface PredictionSponsoredResponse {
  cards: FeedCard[];
  strategy: PredictionSponsoredStrategy;
}

export async function fetchPredictions(input?: {
  status?: "active" | "resolved" | "cancelled";
  limit?: number;
  cursor?: string;
  wallet?: string;
  sessionToken?: string;
}): Promise<PredictionsResponse> {
  const params = new URLSearchParams();
  if (input?.status) params.set("status", input.status);
  if (input?.limit) params.set("limit", String(input.limit));
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.wallet) params.set("wallet", input.wallet);

  const query = params.toString();
  return request<PredictionsResponse>(`/v1/predictions${query ? `?${query}` : ""}`, {
    sessionToken: input?.sessionToken
  });
}

export async function fetchPredictionSponsoredCards(input?: {
  limit?: number;
  sessionToken?: string;
}): Promise<PredictionSponsoredResponse> {
  const params = new URLSearchParams();
  if (input?.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return request<PredictionSponsoredResponse>(`/v1/predictions/sponsored${query ? `?${query}` : ""}`, {
    sessionToken: input?.sessionToken
  });
}

export async function fetchPredictionById(
  id: string,
  wallet?: string,
  sessionToken?: string
): Promise<PredictionMarket> {
  return request<PredictionMarket>(`/v1/predictions/${id}`, {
    sessionToken,
    headers: wallet ? { "x-wallet-address": wallet } : undefined
  });
}

export async function fetchPredictionPool(id: string, sessionToken?: string): Promise<PredictionPool> {
  return request<PredictionPool>(`/v1/predictions/${id}/pool`, { sessionToken });
}

export async function createPredictionStakeIntent(input: {
  pollId: string;
  wallet: string;
  side: "yes" | "no";
  amountSkr: number;
  sessionToken: string;
}): Promise<{ paymentIntentId: string; expiresAt: string; amountSkr: number }> {
  return request<{ paymentIntentId: string; expiresAt: string; amountSkr: number }>(
    `/v1/predictions/${input.pollId}/stake-intent`,
    {
      method: "POST",
      sessionToken: input.sessionToken,
      body: JSON.stringify({
        wallet: input.wallet,
        side: input.side,
        amountSkr: input.amountSkr,
      })
    }
  );
}

export async function stakeOnPrediction(input: {
  pollId: string;
  wallet: string;
  side: "yes" | "no";
  amountSkr: number;
  txSignature: string;
  sessionToken: string;
  paymentIntentId?: string;
}): Promise<PredictionStakeReceipt> {
  return request<PredictionStakeReceipt>(`/v1/predictions/${input.pollId}/stake`, {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      wallet: input.wallet,
      side: input.side,
      amountSkr: input.amountSkr,
      txSignature: input.txSignature,
      paymentIntentId: input.paymentIntentId,
    })
  });
}

export async function fetchUserPredictionStakes(input: {
  wallet: string;
  sessionToken: string;
  limit?: number;
}): Promise<PredictionUserPortfolio> {
  const params = new URLSearchParams();
  params.set("wallet", input.wallet);
  if (input.limit) params.set("limit", String(input.limit));

  return request<PredictionUserPortfolio>(`/v1/predictions/stakes?${params.toString()}`, {
    sessionToken: input.sessionToken
  });
}

export async function claimPredictionPayout(input: {
  payoutId: string;
  wallet: string;
  sessionToken: string;
}): Promise<{
  success: boolean;
  netPayoutSkr: number;
  txSignature?: string;
  transferStatus?: "completed" | "failed" | "manual_required" | "pending";
  reason?:
    | "not_found"
    | "already_claimed"
    | "frozen"
    | "not_yet_claimable"
    | "transfer_failed"
    | "manual_required"
    | "transfer_in_progress";
}> {
  const baseUrls = resolveApiBaseUrls();
  if (!baseUrls.length) {
    throw new Error("Unable to reach Chainshorts API. EXPO_PUBLIC_API_BASE_URL is required in production.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${input.sessionToken}`,
  };
  const body = JSON.stringify({
    payoutId: input.payoutId,
    wallet: input.wallet
  });

  const knownReasonByError: Record<string, "not_found" | "already_claimed" | "frozen" | "not_yet_claimable" | "manual_required" | "transfer_in_progress"> = {
    payout_not_found: "not_found",
    payout_already_claimed: "already_claimed",
    payout_frozen_dispute_pending: "frozen",
    claim_not_yet_available: "not_yet_claimable",
    payout_transfer_in_progress: "transfer_in_progress",
  };

  const errors: string[] = [];
  for (const baseUrl of baseUrls) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetchWithTimeout(`${baseUrl}/v1/predictions/claim`, {
          method: "POST",
          headers,
          body
        });

        const raw = await response.text();
        let parsed: { error?: string; success?: boolean; netPayoutSkr?: number; reason?: string; txSignature?: string; transferStatus?: string } = {};
        try {
          parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
        } catch {
          // ignore malformed JSON and use generic parser below
        }

        if (response.ok) {
          const transferStatus = parsed.transferStatus as "completed" | "failed" | "manual_required" | "pending" | undefined;
          if (transferStatus === "manual_required") {
            return { success: false, netPayoutSkr: 0, reason: "manual_required" };
          }
          // 202 with transferStatus=failed means the claim was reserved but the on-chain transfer failed
          if (transferStatus === "failed") {
            return { success: false, netPayoutSkr: 0, reason: "transfer_failed" };
          }
          return {
            success: parsed.success ?? true,
            netPayoutSkr: Number(parsed.netPayoutSkr ?? 0),
            txSignature: parsed.txSignature,
            transferStatus,
            reason: parsed.reason as
              | "not_found"
              | "already_claimed"
              | "frozen"
              | "not_yet_claimable"
              | "transfer_failed"
              | "manual_required"
              | "transfer_in_progress"
              | undefined,
          };
        }

        if (response.status === 401) {
          authFailureHandler?.();
        }

        const reason = parsed.error ? knownReasonByError[parsed.error] : undefined;
        if (reason) {
          return { success: false, netPayoutSkr: 0, reason };
        }

        const retryable = RETRYABLE_STATUS.has(response.status);
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(attempt * 350);
          continue;
        }

        throw new ApiRequestError(parseApiError(raw, response.status), "api", response.status);
      } catch (error) {
        if (error instanceof ApiRequestError) {
          throw error;
        }
        if (attempt < MAX_RETRIES) {
          await sleep(attempt * 350);
          continue;
        }
        errors.push(`${baseUrl}: ${error instanceof Error ? error.message : "unknown_error"}`);
      }
    }
  }

  throw new Error(`Unable to reach Chainshorts API. ${errors.join(" | ")}`);
}

export async function cashOutPredictionStake(input: {
  stakeId: string;
  wallet: string;
  sessionToken: string;
}): Promise<{
  ok: boolean;
  cashoutAmount: number;
  originalStake: number;
  penaltyAmount: number;
  txSignature: string | null;
  transferStatus: "complete" | "failed";
}> {
  return request<{
    ok: boolean;
    cashoutAmount: number;
    originalStake: number;
    penaltyAmount: number;
    txSignature: string | null;
    transferStatus: "complete" | "failed";
  }>(`/v1/predictions/stakes/${encodeURIComponent(input.stakeId)}/cashout`, {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({ wallet: input.wallet })
  });
}

// ─── Prediction Leaderboard ────────────────────────────────────────────────────

export interface LeaderboardEntry {
  wallet: string;
  predictionCount: number;
  winRate: number;
  totalProfitSkr: number;
  rank: number;
}

export interface UserRank {
  rank: number;
  percentile: number;
  winRate: number;
  totalProfitSkr: number;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  userRank: UserRank | null;
}

export async function fetchLeaderboard(input: {
  period?: "all" | "week" | "month";
  sortBy?: "profit" | "winRate" | "volume";
  limit?: number;
  wallet?: string;
  sessionToken?: string;
}): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  if (input.period) params.set("period", input.period);
  if (input.sortBy) params.set("sortBy", input.sortBy);
  if (input.limit) params.set("limit", String(input.limit));

  const headers: Record<string, string> = {};
  if (input.wallet) {
    headers["x-wallet-address"] = input.wallet;
  }

  return request<LeaderboardResponse>(`/v1/predictions/leaderboard?${params.toString()}`, {
    sessionToken: input.sessionToken,
    headers
  });
}


// ─── Sponsored Cards ──────────────────────────────────────────────────────────

function normalizeSponsoredCardId(cardId: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cardId)) {
    return cardId;
  }
  if (cardId.startsWith("sponsored-")) return cardId.slice(10);
  if (cardId.startsWith("predict-sponsored-")) return cardId.slice("predict-sponsored-".length);
  return cardId;
}

export async function trackSponsoredImpression(cardId: string): Promise<void> {
  const id = normalizeSponsoredCardId(cardId);
  await request<{ ok: boolean }>(`/v1/sponsored/${id}/impression`, { method: "POST" }).catch((err) => {
    if (__DEV__) {
      console.debug("[ads] impression tracking failed:", err instanceof Error ? err.message : err);
    }
  });
}

export async function trackSponsoredClick(cardId: string): Promise<void> {
  const id = normalizeSponsoredCardId(cardId);
  await request<{ ok: boolean }>(`/v1/sponsored/${id}/click`, { method: "POST" }).catch((err) => {
    // Log but don't interrupt user experience
    if (__DEV__) {
      console.debug("[ads] click tracking failed:", err instanceof Error ? err.message : err);
    }
  });
}

export async function optInSponsoredCard(input: {
  cardId: string;
  wallet: string;
  sessionToken: string;
}): Promise<{ ok: boolean; success: boolean }> {
  const id = normalizeSponsoredCardId(input.cardId);
  return request<{ ok: boolean; success: boolean }>(`/v1/sponsored/${id}/opt-in`, {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({ wallet: input.wallet })
  });
}

// ─── Prediction Disputes ──────────────────────────────────────────────────────

export interface DisputeSubmission {
  pollId: string;
  wallet: string;
  reason: string;
  evidenceUrls?: string[];
  depositTxSignature: string;
  sessionToken: string;
  paymentIntentId?: string;
}

export async function createPredictionDisputeIntent(input: {
  pollId: string;
  wallet: string;
  sessionToken: string;
}): Promise<{ paymentIntentId: string; expiresAt: string; challengeDeadline: string; depositSkr: number }> {
  return request<{ paymentIntentId: string; expiresAt: string; challengeDeadline: string; depositSkr: number }>(
    `/v1/predictions/${encodeURIComponent(input.pollId)}/dispute-intent`,
    {
      method: "POST",
      sessionToken: input.sessionToken,
      body: JSON.stringify({
        wallet: input.wallet,
      })
    }
  );
}

export async function submitDispute(input: DisputeSubmission): Promise<{ ok: boolean; disputeId: string; challengeDeadline: string }> {
  return request<{ ok: boolean; disputeId: string; challengeDeadline: string }>(`/v1/predictions/${encodeURIComponent(input.pollId)}/dispute`, {
    method: "POST",
    sessionToken: input.sessionToken,
    body: JSON.stringify({
      wallet: input.wallet,
      reason: input.reason,
      evidenceUrls: input.evidenceUrls ?? [],
      depositTxSignature: input.depositTxSignature,
      paymentIntentId: input.paymentIntentId,
    })
  });
}

export interface DisputeStatus {
  id: string;
  pollId: string;
  wallet: string;
  status: "pending" | "investigating" | "upheld" | "rejected" | "expired";
  challengeDeadline: string;
  resolutionNote?: string;
  refundTxSignature?: string;
  createdAt: string;
  resolvedAt?: string;
}

export async function fetchDisputeStatus(input: {
  pollId: string;
  wallet?: string;
  disputeId?: string;
  sessionToken?: string;
}): Promise<DisputeStatus | null> {
  if (input.wallet && input.sessionToken) {
    const params = new URLSearchParams();
    params.set("wallet", input.wallet);
    const meResponse = await request<{ dispute: DisputeStatus | null }>(
      `/v1/predictions/${encodeURIComponent(input.pollId)}/disputes/me?${params.toString()}`,
      { sessionToken: input.sessionToken }
    );
    if (input.disputeId) {
      if (meResponse.dispute?.id === input.disputeId) {
        return meResponse.dispute;
      }
      return null;
    }
    // Authenticated wallet path is authoritative — return here regardless of whether
    // dispute is null, so we never fall through to the unauthenticated public endpoint.
    return meResponse.dispute ?? null;
  }

  const response = await request<{ disputes: DisputeStatus[] }>(`/v1/predictions/${encodeURIComponent(input.pollId)}/disputes`, {
    sessionToken: input.sessionToken
  });
  if (input.disputeId) {
    return response.disputes.find((dispute) => dispute.id === input.disputeId) ?? null;
  }
  return null;
}
