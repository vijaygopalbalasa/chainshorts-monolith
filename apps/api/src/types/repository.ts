import type {
  AlertSubmissionRequest,
  AlertSubmissionResult,
  AlertVoteResult,
  BookmarkPage,
  ContentBoostReceipt,
  FeedCard,
  FeedFreshness,
  FeedPage,
  FeedQuery,
  OpinionSide,
  PredictionMarket,
  PredictionPool,
  PredictionStake,
  PredictionStakeReceipt,
  PredictionPayout,
  PredictionUserPortfolio,
  ReactionPayload,
  ReactionCounts,
  SkrTier,
  SourceSummary,
  ThreatAlert,
  PushSubscriptionInput
} from "@chainshorts/shared";

export interface AuthChallengeRecord {
  walletAddress: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface AuthSessionRecord {
  sessionToken: string;
  walletAddress: string;
  expiresAt: string;
}

export interface FeedbackRow {
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
}

export interface OrphanedPaymentRow {
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
}

export interface PaymentIntentReservation {
  id: string;
  expiresAt: string;
}

export interface Repository {
  createAuthChallenge(challenge: AuthChallengeRecord): Promise<void>;
  getAuthChallenge(walletAddress: string, nonce: string): Promise<AuthChallengeRecord | null>;
  deleteAuthChallenge(walletAddress: string, nonce: string): Promise<void>;
  createSession(walletAddress: string): Promise<AuthSessionRecord>;
  getSession(sessionToken: string): Promise<AuthSessionRecord | null>;
  revokeSession(sessionToken: string): Promise<void>;
  revokeAllSessions(walletAddress: string, exceptSessionToken?: string): Promise<number>;
  cleanupExpiredAuthArtifacts(now: Date): Promise<void>;
  createFeedback(input: {
    wallet: string;
    type: "bug" | "suggestion" | "other";
    subject: string;
    message: string;
    appVersion?: string;
    platform?: "android" | "ios" | "web";
  }): Promise<{ id: string; createdAt: string }>;
  listFeedback(opts: {
    status?: "new" | "reviewed" | "resolved";
    limit: number;
    offset: number;
  }): Promise<FeedbackRow[]>;
  updateFeedback(
    id: string,
    update: {
      status?: "new" | "reviewed" | "resolved";
      adminNotes?: string | null;
    }
  ): Promise<boolean>;
  recordOrphanedPayment(input: {
    txSignature: string;
    wallet: string;
    purpose: "prediction_stake" | "dispute_deposit" | "advertiser_campaign";
    expectedAmountSkr: number;
    referenceType: "poll" | "campaign";
    referenceId: string;
    failureReason: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ recorded: boolean; id?: string }>;
  listOrphanedPayments(opts: {
    status?: "open" | "reviewing" | "resolved";
    limit: number;
    offset: number;
  }): Promise<OrphanedPaymentRow[]>;
  updateOrphanedPayment(
    id: string,
    update: {
      status?: "open" | "reviewing" | "resolved";
      adminNotes?: string | null;
    }
  ): Promise<boolean>;

  listFeed(query: FeedQuery): Promise<FeedPage>;
  searchFeed(query: FeedQuery & { q: string }): Promise<FeedPage>;
  getArticleById(id: string): Promise<FeedCard | null>;
  listSources(): Promise<SourceSummary[]>;
  getFeedFreshness(now: Date): Promise<FeedFreshness>;

  saveReaction(payload: ReactionPayload): Promise<"saved" | "duplicate">;
  getReactionCounts(articleIds: string[]): Promise<Record<string, ReactionCounts>>;
  consumeRateLimit(bucket: string, scope: string, maxCount: number, windowMs: number): Promise<boolean>;

  listBookmarks(input: { wallet: string; cursor?: string; limit?: number }): Promise<BookmarkPage>;
  addBookmark(wallet: string, articleId: string): Promise<"saved" | "duplicate" | "not_found">;
  removeBookmark(wallet: string, articleId: string): Promise<boolean>;

  upsertPushSubscription(
    input: PushSubscriptionInput & {
      walletAddress?: string;
    }
  ): Promise<void>;
  removePushSubscription(deviceId: string, expoPushToken: string): Promise<void>;

  upsertWalletSkrSnapshot(input: { wallet: string; balanceSkr: number; observedAt: string }): Promise<void>;

  listAlerts(input: { cursor?: string; limit?: number; severity?: string }): Promise<{ items: ThreatAlert[]; nextCursor?: string }>;
  submitAlert(input: AlertSubmissionRequest): Promise<AlertSubmissionResult>;
  voteAlert(input: { alertId: string; wallet: string; vote: "helpful" | "false_alarm" }): Promise<AlertVoteResult>;

  expireContentBoosts(now: Date): Promise<number>;
  createContentBoost(input: { wallet: string; contentId: string; durationDays: number; amountSkr: number; now: Date }): Promise<ContentBoostReceipt>;

  /**
   * Atomically records a Solana transaction signature as consumed.
   * Returns "already_used" if the signature was already recorded (replay attack prevention).
   * Throws on unexpected DB errors.
   */
  consumeTxSignature(
    txSignature: string,
    purpose: "content_boost" | "prediction_stake" | "dispute_deposit",
    wallet: string
  ): Promise<"ok" | "already_used">;

  // ── Prediction Markets ──────────────────────────────────────────────────────
  listPredictionMarkets(input: {
    cursor?: string;
    limit?: number;
    status?: "active" | "resolved" | "cancelled";
    wallet?: string;
  }): Promise<{ items: PredictionMarket[]; nextCursor?: string }>;

  getPredictionMarketById(pollId: string, wallet?: string): Promise<PredictionMarket | null>;

  getPredictionPool(pollId: string): Promise<PredictionPool | null>;

  createPredictionStakePaymentIntent(input: {
    pollId: string;
    wallet: string;
    side: OpinionSide;
    amountSkr: number;
  }): Promise<
    | { success: true; reservation: PaymentIntentReservation }
    | {
        success: false;
        reason:
          | "prediction_not_found"
          | "market_not_active"
          | "stake_below_minimum"
          | "stake_above_maximum";
        minStakeSkr?: number;
        maxStakeSkr?: number;
      }
  >;

  atomicStakeOnPrediction(input: {
    pollId: string;
    wallet: string;
    side: OpinionSide;
    amountSkr: number;
    txSignature: string;
    paymentIntentId?: string;
  }): Promise<
    | { success: true; receipt: PredictionStakeReceipt }
    | {
        success: false;
        reason:
          | "prediction_not_found"
          | "market_not_active"
          | "stake_below_minimum"
          | "stake_above_maximum"
          | "tx_already_used"
          | "payment_intent_invalid"
          | "payment_intent_expired";
        minStakeSkr?: number;
        maxStakeSkr?: number;
      }
  >;

  listUserPredictionStakes(wallet: string, limit?: number): Promise<PredictionUserPortfolio>;

  cashOutPredictionStake(
    stakeId: string,
    wallet: string
  ): Promise<{ stakeAmount: number; pollId: string; side: "yes" | "no" } | null | "below_minimum" | "in_progress">;

  updateStakeCashoutTransfer(stakeId: string, wallet: string, txSignature: string | null, status: "complete" | "failed"): Promise<void>;

  claimPredictionPayout(input: {
    payoutId: string;
    wallet: string;
  }): Promise<{
    success: boolean;
    reason?: "not_found" | "already_claimed" | "frozen" | "not_yet_claimable" | "transfer_in_progress";
    netPayoutSkr: number;
    claimableAt?: string;
  }>;

  recordPayoutTransfer(input: {
    payoutId: string;
    txSignature?: string | null;
    transferStatus?: "in_progress" | "completed" | "failed" | "manual_required";
  }): Promise<void>;

  markPayoutTransferFailed(input: {
    payoutId: string;
    error: string;
  }): Promise<void>;

  getPredictionRevenueSummary(): Promise<{
    totalFeeSkr: number;
    totalMarketsSettled: number;
    totalStakesSkr: number;
    totalPayoutsSkr: number;
    pendingPayoutsSkr: number;
    pendingPayoutsCount: number;
  }>;

  countOpenPredictionStakePaymentIntents(pollId: string): Promise<number>;

  // ── Admin: system_config ──────────────────────────────────────────────────
  getSystemConfigAll(): Promise<SystemConfigRow[]>;
  updateSystemConfig(key: string, value: string, updatedBy: string): Promise<void>;
  getAdminStats(): Promise<AdminStats>;
  getExtendedAdminStats(): Promise<ExtendedAdminStats>;
  getSourceHealth(): Promise<SourceHealthRow[]>;
  listSourcesAdmin(): Promise<Array<{ id: string; name: string; feedUrl: string; active: boolean }>>;
  listAdvertisersAdmin(): Promise<Array<{
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
    pendingInvoiceUsdc: number;
    collectedRevenueUsdc: number;
  }>>;
  setAdvertiserAccountStatus(
    advertiserId: string,
    status: "active" | "suspended",
    reason?: string
  ): Promise<boolean>;
  setAdvertiserCampaignsActive(advertiserId: string, active: boolean): Promise<number>;
  toggleSourceActive(sourceId: string, active: boolean): Promise<void>;
  createSource(input: {
    name: string;
    homepageUrl: string;
    feedUrl: string;
    languageHint?: string;
  }): Promise<{ id: string }>;
  deleteSource(sourceId: string): Promise<void>;
  recordSourceHealth(input: {
    sourceId: string;
    fetchSuccess: boolean;
    fetchLatencyMs?: number;
    articlesFound?: number;
    articlesPublished?: number;
    errorMessage?: string;
    httpStatus?: number;
  }): Promise<void>;

  // ── OpenRouter Models ─────────────────────────────────────────────────────
  getOpenRouterModels(): Promise<OpenRouterModel[]>;
  syncOpenRouterModels(models: Array<{
    id: string;
    name: string;
    context_length?: number;
    pricing?: { prompt?: number; completion?: number };
    capabilities?: { tools?: boolean; vision?: boolean };
    moderation?: string;
  }>): Promise<number>;
  getAgentModelConfig(): Promise<Record<string, string>>;

  // ── Prediction Leaderboard ─────────────────────────────────────────────────
  getPredictionLeaderboard(opts: {
    period: "all" | "week" | "month";
    sortBy: "profit" | "winRate" | "volume";
    limit: number;
  }): Promise<LeaderboardEntry[]>;
  getUserPredictionRank(wallet: string, period: "all" | "week" | "month", sortBy: "profit" | "winRate" | "volume"): Promise<UserRank | null>;

  // ── Sponsored Cards ───────────────────────────────────────────────────────
  getActiveSponsoredCards(input?: { placement?: "feed" | "predict"; limit?: number }): Promise<Array<{
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
  }>>;
  trackSponsoredEvent(cardId: string, type: "impression" | "click"): Promise<boolean>;
  listSponsoredCards(): Promise<Array<{
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
    billingAmountUsdc: number;
    billingStatus: "not_required" | "approval_pending" | "payment_required" | "paid";
    paymentTxSignature: string | null;
    paymentReceivedAt: string | null;
    createdAt: string;
  }>>;
  createSponsoredCard(input: {
    advertiserName: string;
    headline: string;
    bodyText: string;
    imageUrl?: string;
    destinationUrl: string;
    ctaText: string;
    accentColor: string;
    cardFormat?: string;
    placement?: "feed" | "predict" | "both";
    targetAudience?: string;
    campaignGoal?: string;
    actionUrl?: string;
    startsAt: Date;
    endsAt: Date;
    impressionLimit?: number;
  }): Promise<string>;
  deactivateSponsoredCard(id: string): Promise<boolean>;
  setSponsoredCardActive(id: string, active: boolean): Promise<boolean>;
  reviewSponsoredCard(
    id: string,
    decision: "approve" | "reject",
    reviewer: string,
    reason?: string
  ): Promise<boolean>;
  optInSponsoredCardLead(cardId: string, walletAddress: string): Promise<boolean>;
  getSponsoredCardLeadsCount(cardId: string): Promise<number>;

  // ── Advertiser Accounts ───────────────────────────────────────────────────
  upsertAdvertiserByWallet(input: {
    walletAddress: string;
    email?: string;
  }): Promise<{ id: string; companyName: string | null; isOnboarded: boolean }>;

  getAdvertiserById(id: string): Promise<{
    id: string;
    email: string | null;
    walletAddress: string | null;
    companyName: string | null;
    websiteUrl: string | null;
    isOnboarded: boolean;
    accountStatus: "active" | "suspended";
    suspendedAt: string | null;
    suspensionReason: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  } | null>;

  onboardAdvertiser(id: string, companyName: string, websiteUrl?: string): Promise<{
    id: string;
    companyName: string;
    isOnboarded: boolean;
  }>;

  updateAdvertiserLastLogin(id: string): Promise<void>;

  createAdvertiserSession(advertiserId: string): Promise<{ sessionToken: string; expiresAt: string }>;
  getAdvertiserSession(token: string): Promise<{ advertiserId: string } | null>;
  invalidateAdvertiserSession(token: string): Promise<void>;

  createSponsoredCardForAdvertiser(advertiserId: string, input: {
    headline: string;
    bodyText: string;
    imageUrl?: string;
    destinationUrl: string;
    ctaText: string;
    accentColor: string;
    cardFormat: string;
    placement: "feed" | "predict" | "both";
    targetAudience: string;
    campaignGoal: string;
    actionUrl?: string;
    startsAt: Date;
    endsAt: Date;
    impressionLimit?: number;
    billingAmountUsdc: number;
  }): Promise<string>;

  listSponsoredCardsByAdvertiser(advertiserId: string): Promise<Array<{
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
    billingAmountUsdc: number;
    billingStatus: "not_required" | "approval_pending" | "payment_required" | "paid";
    paymentTxSignature: string | null;
    paymentReceivedAt: string | null;
    createdAt: string;
  }>>;

  updateSponsoredCardForAdvertiser(advertiserId: string, cardId: string, input: {
    headline?: string;
    bodyText?: string;
    imageUrl?: string | null;
    destinationUrl?: string;
    ctaText?: string;
    accentColor?: string;
    cardFormat?: string;
    placement?: "feed" | "predict" | "both";
    targetAudience?: string;
    campaignGoal?: string;
    actionUrl?: string | null;
    startsAt?: Date;
    endsAt?: Date;
    impressionLimit?: number | null;
    billingAmountUsdc?: number;
  }): Promise<boolean>;

  getSponsoredCardForAdvertiser(cardId: string, advertiserId: string): Promise<{
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
    billingAmountUsdc: number;
    billingStatus: "not_required" | "approval_pending" | "payment_required" | "paid";
    paymentTxSignature: string | null;
    paymentReceivedAt: string | null;
  } | null>;
  setSponsoredCardActiveForAdvertiser(cardId: string, advertiserId: string, active: boolean): Promise<boolean>;
  createAdvertiserCampaignPaymentIntent(input: {
    advertiserId: string;
    cardId: string;
  }): Promise<
    | {
        success: true;
        reservation: PaymentIntentReservation;
        billingAmountUsdc: number;
      }
    | {
        success: false;
        reason:
          | "not_found"
          | "approval_pending"
          | "campaign_rejected"
          | "already_paid"
          | "payment_not_required";
      }
  >;
  recordSponsoredCampaignPayment(input: {
    advertiserId: string;
    cardId: string;
    txSignature: string;
    paymentIntentId?: string;
  }): Promise<
    | { success: true; paymentReceivedAt: string }
    | {
        success: false;
        reason:
          | "not_found"
          | "approval_pending"
          | "campaign_rejected"
          | "already_paid"
          | "payment_not_required"
          | "tx_already_used"
          | "payment_intent_invalid"
          | "payment_intent_expired";
      }
  >;
  listAdvertiserBillingRequests(advertiserId: string): Promise<Array<{
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
  }>>;
  createAdvertiserBillingRequest(input: {
    advertiserId: string;
    cardId: string;
    requestType: "billing_review" | "refund_request";
    note: string;
  }): Promise<
    | { success: true; requestId: string }
    | {
        success: false;
        reason:
          | "campaign_not_found"
          | "refund_requires_paid_campaign"
          | "request_already_open";
      }
  >;
  listAdminAdvertiserBillingRequests(): Promise<Array<{
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
  }>>;
  updateAdvertiserBillingRequestStatus(input: {
    requestId: string;
    status: "reviewing" | "resolved" | "rejected";
    adminNote?: string;
    resolvedBy: string;
  }): Promise<boolean>;

  // ── Prediction Disputes ───────────────────────────────────────────────────
  createPredictionDispute(input: {
    pollId: string;
    wallet: string;
    reason: string;
    evidenceUrls?: string[];
    depositSkr: number;
    depositTxSignature?: string;
  }): Promise<{ disputeId: string }>;

  createPredictionDisputePaymentIntent(input: {
    pollId: string;
    wallet: string;
    depositSkr: number;
    challengeWindowHours?: number;
  }): Promise<
    | {
        success: true;
        reservation: PaymentIntentReservation;
        challengeDeadline: string;
      }
    | {
        success: false;
        reason:
          | "poll_not_found"
          | "poll_not_resolved"
          | "challenge_window_closed"
          | "dispute_already_filed";
        challengeDeadline?: string;
      }
  >;

  atomicCreatePredictionDispute(input: {
    pollId: string;
    wallet: string;
    reason: string;
    evidenceUrls?: string[];
    depositSkr: number;
    depositTxSignature?: string;
    challengeWindowHours?: number;
    paymentIntentId?: string;
  }): Promise<
    | {
        success: true;
        disputeId: string;
        challengeDeadline: string;
      }
    | {
        success: false;
        reason:
          | "poll_not_found"
          | "poll_not_resolved"
          | "challenge_window_closed"
          | "tx_already_used"
          | "dispute_already_filed"
          | "payment_intent_invalid"
          | "payment_intent_expired";
        challengeDeadline?: string;
      }
  >;

  listPredictionDisputes(pollId: string): Promise<PredictionDispute[]>;
  getPredictionDisputeForWallet(pollId: string, wallet: string): Promise<PredictionDispute | null>;

  listAllDisputes(input: {
    status?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: PredictionDispute[]; nextCursor?: string }>;

  resolvePredictionDispute(input: {
    disputeId: string;
    verdict: "upheld" | "rejected";
    note: string;
    resolvedBy: string;
  }): Promise<{ refundRequired: boolean; walletAddress: string; depositSkr: number; pollId: string }>;

  resetPollForReResolution(pollId: string, options?: {
    allowPendingDisputeId?: string;
  }): Promise<void>;

  recordDisputeRefundTx(disputeId: string, txSignature: string): Promise<void>;

  getPredictionDispute(disputeId: string): Promise<PredictionDispute | null>;

  getDisputeForPollAndWallet(pollId: string, wallet: string): Promise<{ id: string; status: string } | null>;

  freezePollPayouts(pollId: string, freeze: boolean): Promise<void>;
  atomicUpdateDisputeStatusAndFreeze(
    disputeId: string,
    status: "investigating",
    freezePoll: boolean
  ): Promise<{ pollId: string } | null>;

  // ── Admin Prediction Management ──────────────────────────────────────────
  listAllPredictionMarkets(input: {
    status?: "active" | "resolved" | "cancelled";
    cursor?: string;
    limit?: number;
  }): Promise<{ items: AdminPredictionMarket[]; nextCursor?: string }>;

  cancelPredictionMarket(pollId: string, reason: string): Promise<{
    stakesRefunded: number;
    totalRefundSkr: number;
  }>;

  updatePredictionMarketLimits(pollId: string, minStakeSkr: number, maxStakeSkr: number): Promise<void>;

  getResolutionDetails(pollId: string): Promise<PredictionResolutionDetails | null>;

  createPredictionMarket(input: {
    question: string;
    deadlineAt: Date;
    resolutionRule?: { kind: string; symbol?: string; target?: number };
    minStakeSkr?: number;
    maxStakeSkr?: number;
    platformFeePct?: number;
  }): Promise<{ pollId: string }>;

  updateDisputeStatus(disputeId: string, status: "investigating"): Promise<void>;

  addDisputeAdminNote(disputeId: string, note: string, admin: string): Promise<void>;

  getPredictionEconomicsSettings(): Promise<{
    platformFeePct: number;
    disputeDepositSkr: number;
    challengeWindowHours: number;
    totalPlatformFees: number;
    pendingDisputes: number;
    totalDisputes: number;
  }>;
}

export interface AdminPredictionMarket {
  id: string;
  question: string;
  status: "active" | "resolved" | "cancelled";
  resolvedOutcome?: "yes" | "no";
  yesPoolSkr: number;
  noPoolSkr: number;
  totalPoolSkr: number;
  stakersCount: number;
  deadlineAt: string;
  createdAt: string;
  resolvedAt?: string;
  aiGenerated: boolean;
  disputeFreeze: boolean;
  minStakeSkr: number;
  maxStakeSkr: number;
  platformFeePct: number;
}

export interface PredictionResolutionDetails {
  pollId: string;
  agent1Model?: string;
  agent1Outcome?: "yes" | "no" | "indeterminate";
  agent1Confidence?: number;
  agent1Reasoning?: string;
  agent2Model?: string;
  agent2Outcome?: "yes" | "no" | "indeterminate";
  agent2Confidence?: number;
  agent2Reasoning?: string;
  agent3Model?: string;
  agent3Outcome?: "yes" | "no" | "indeterminate";
  agent3Confidence?: number;
  agent3Reasoning?: string;
  consensusOutcome?: "yes" | "no" | "indeterminate" | "no_consensus";
  consensusConfidence?: number;
  consensusType?: "unanimous" | "majority" | "no_consensus";
  resolutionMethod?: "multi_agent" | "coingecko_price" | "community_majority" | "admin_manual";
  finalOutcome?: "yes" | "no";
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface PredictionDispute {
  id: string;
  pollId: string;
  wallet: string;
  reason: string;
  evidenceUrls: string[];
  depositSkr: number;
  depositTxSignature?: string;
  status: "pending" | "investigating" | "upheld" | "rejected" | "expired";
  resolutionNote?: string;
  resolvedBy?: string;
  refundTxSignature?: string;
  createdAt: string;
  resolvedAt?: string;
  challengeDeadline: string;
}

export interface SystemConfigRow {
  key: string;
  value: string;
  valueType: string;
  label: string;
  description: string | null;
  category: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AdminStats {
  feed: { total: number; today: number; last24h: number };
  pipeline: {
    callsLast24h: number;
    successesLast24h: number;
    avgLatencyMs: number;
    stageBreakdown: Array<{ purpose: string; calls: number; successRate: number; avgLatencyMs: number }>;
  };
  reviewQueue: { pending: number };
  estimatedCostUsd: number;
}

export interface ExtendedAdminStats extends AdminStats {
  feed: AdminStats["feed"] & { last7d: number };
  sources: {
    total: number;
    active: number;
    healthyLast24h: number;
    articlesPerSource: Array<{ sourceId: string; sourceName: string; count: number }>;
  };
  predictions: {
    activeMarkets: number;
    totalVolumeLast24h: number;
    totalVolumeAllTime: number;
    resolvedLast7d: number;
    platformFeesCollected: number;
  };
  opinions: {
    activePolls: number;
    votesLast24h: number;
    avgParticipation: number;
    resolvedLast7d: number;
  };
  threats: {
    alertsPublished: number;
    alertsLast24h: number;
    communitySubmissions: number;
    submissionsQueued: number;
  };
  push: {
    registeredDevices: number;
    activeDevices: number;
    pendingReceipts: number;
  };
  users: {
    uniqueWallets: number;
    activeSessions: number;
    walletsWithSkr: number;
    avgChainRepScore: number;
  };
  boosts: {
    active: number;
    revenueSkrLast24h: number;
    revenueSkrAllTime: number;
  };
  telemetryFunnel: {
    processed: number;
    relevanceFiltered: number;
    summarized: number;
    factCheckPassed: number;
    factCheckReview: number;
    factCheckRejected: number;
    published: number;
  };
  costBreakdown: Array<{
    purpose: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }>;
}

export interface SourceHealthRow {
  sourceId: string;
  sourceName: string;
  isActive: boolean;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  successRateLast24h: number;
  avgLatencyMs: number;
  articlesPublishedLast24h: number;
  articlesPublishedTotal: number;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface OpenRouterModel {
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
}

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
