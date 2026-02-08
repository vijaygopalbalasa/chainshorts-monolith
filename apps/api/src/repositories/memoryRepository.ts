import { randomUUID } from "node:crypto";
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
  PredictionMarket,
  PredictionPool,
  PredictionStakeReceipt,
  PredictionUserPortfolio,
  ReactionPayload,
  ReactionCounts,
  SourceSummary,
  ThreatAlert,
  PushSubscriptionInput
} from "@chainshorts/shared";
import type { AdminPredictionMarket, AdminStats, AuthChallengeRecord, AuthSessionRecord, ExtendedAdminStats, FeedbackRow, LeaderboardEntry, OpenRouterModel, OrphanedPaymentRow, PredictionDispute, PredictionResolutionDetails, Repository, SourceHealthRow, SystemConfigRow, UserRank } from "../types/repository.js";

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString("base64url");
}

function decodeCursor(cursor?: string): { date: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [date, id] = raw.split("|");
    if (!date || !id) return null;
    return { date, id };
  } catch {
    return null;
  }
}

function emptyReactionCounts(): ReactionCounts {
  return {
    bullish: 0,
    bearish: 0,
    insightful: 0,
    skeptical: 0,
    total: 0
  };
}

const sampleFeed: FeedCard[] = [
  {
    id: "art_01",
    headline: "Solana dApps Expand Mobile Wallet Flows as Ecosystem Pushes Consumer UX",
    summary60:
      "Solana developers are refining mobile wallet experiences to reduce login friction and increase mainstream onboarding. New dApp patterns combine guest browsing, wallet upgrades, and secure signing flows. Teams are prioritizing faster confirmation handling, clearer transaction messaging, and better fallback behavior across devices. The shift aims to make Web3 interactions feel as seamless as traditional consumer apps.",
    imageUrl: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0",
    sourceName: "Web3 Wire",
    sourceUrl: "https://example.com/web3-wire/solana-mobile-ux",
    publishedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    clusterId: "cluster_1",
    language: "en",
    category: "solana"
  },
  {
    id: "art_02",
    headline: "Major Wallet Teams Test Sponsored Fee Limits for Consumer Tip Features",
    summary60:
      "Wallet providers and consumer dApps are experimenting with hybrid fee sponsorship models for low-value user actions. Early pilots sponsor selected transactions while enforcing strict wallet-based quotas and fraud checks. Product teams report improved conversion and retention when users can complete first actions with minimal cost, then transition naturally to user-paid transactions as engagement deepens over time.",
    imageUrl: "https://images.unsplash.com/photo-1640826849706-00f7b905f2f5",
    sourceName: "Chain Daily",
    sourceUrl: "https://example.com/chain-daily/sponsored-fee-tests",
    publishedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    clusterId: "cluster_2",
    language: "en",
    category: "defi"
  }
];

const sampleSources: SourceSummary[] = [
  {
    id: "src_coindesk",
    name: "CoinDesk",
    homepageUrl: "https://www.coindesk.com",
    feedUrl: "https://www.coindesk.com/arc/outboundfeeds/rss",
    languageHint: "en",
    compliant: true
  },
  {
    id: "src_decrypt",
    name: "Decrypt",
    homepageUrl: "https://decrypt.co",
    feedUrl: "https://decrypt.co/feed",
    languageHint: "en",
    compliant: true
  },
  {
    id: "src_cointelegraph",
    name: "Cointelegraph",
    homepageUrl: "https://cointelegraph.com",
    feedUrl: "https://cointelegraph.com/rss",
    languageHint: "en",
    compliant: true
  }
];

const sampleAlerts: ThreatAlert[] = [
  {
    id: "alert_1",
    severity: "ORANGE",
    type: "whale_dump",
    confidence: 0.84,
    headline: "Large token transfer to exchange wallet detected",
    summary60:
      "A whale wallet moved a sizable token allocation to a centralized exchange within minutes of weak market momentum. This pattern can precede heightened sell pressure and short-term volatility. The alert is not proof of malicious behavior, but it signals elevated downside risk. Monitor order books and official communication before increasing exposure.",
    recommendation: "Monitor closely",
    txHash: "5JwPXAnwU7z8YgRVaX...",
    sourceUrl: "https://solscan.io/tx/5JwPXAnwU7z8YgRVaX",
    communitySignal: 4,
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString()
  }
];

export class MemoryRepository implements Repository {
  private readonly feed = [...sampleFeed].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  private readonly sources = [...sampleSources];
  private readonly authChallenges = new Map<string, AuthChallengeRecord>();
  private readonly sessions = new Map<string, AuthSessionRecord>();
  private readonly reactions: ReactionPayload[] = [];
  private readonly reactionKeys = new Set<string>();
  private readonly rateLimitBuckets = new Map<string, { count: number; windowStartMs: number }>();
  private readonly bookmarks = new Map<string, Map<string, string>>();
  private readonly walletSkrSnapshots = new Map<string, { balanceSkr: number; firstSeenAt: string; lastSeenAt: string }>();
  private readonly alerts = new Map<string, ThreatAlert>(sampleAlerts.map((alert) => [alert.id, alert]));
  private readonly alertSubmissions = new Map<string, AlertSubmissionResult>();
  private readonly alertVotes = new Map<string, AlertVoteResult>();
  private readonly boosts = new Map<string, ContentBoostReceipt>();
  private readonly consumedTxSignatures = new Set<string>();
  private readonly pushSubscriptions = new Map<
    string,
    (PushSubscriptionInput & {
      walletAddress?: string;
      updatedAt: string;
      disabledAt?: string;
    })
  >();

  private withReactionCounts(items: FeedCard[]): FeedCard[] {
    if (!items.length) {
      return [];
    }

    const ids = items.map((item) => item.id);
    const counts = this.buildReactionCounts(ids);
    return items.map((item) => ({
      ...item,
      reactionCounts: counts[item.id] ?? emptyReactionCounts()
    }));
  }

  private buildReactionCounts(articleIds: string[]): Record<string, ReactionCounts> {
    const wanted = new Set(articleIds);
    const result: Record<string, ReactionCounts> = {};

    for (const articleId of articleIds) {
      result[articleId] = emptyReactionCounts();
    }

    for (const reaction of this.reactions) {
      if (!wanted.has(reaction.articleId)) {
        continue;
      }

      const counts = result[reaction.articleId] ?? emptyReactionCounts();
      counts[reaction.reactionType] += 1;
      counts.total += 1;
      result[reaction.articleId] = counts;
    }

    return result;
  }

  async createAuthChallenge(challenge: AuthChallengeRecord): Promise<void> {
    this.authChallenges.set(`${challenge.walletAddress}:${challenge.nonce}`, challenge);
  }

  async getAuthChallenge(walletAddress: string, nonce: string): Promise<AuthChallengeRecord | null> {
    return this.authChallenges.get(`${walletAddress}:${nonce}`) ?? null;
  }

  async deleteAuthChallenge(walletAddress: string, nonce: string): Promise<void> {
    this.authChallenges.delete(`${walletAddress}:${nonce}`);
  }

  async createSession(walletAddress: string): Promise<AuthSessionRecord> {
    const session = {
      sessionToken: `sess_${randomUUID()}`,
      walletAddress,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
    this.sessions.set(session.sessionToken, session);
    return session;
  }

  async getSession(sessionToken: string): Promise<AuthSessionRecord | null> {
    return this.sessions.get(sessionToken) ?? null;
  }

  async revokeSession(sessionToken: string): Promise<void> {
    this.sessions.delete(sessionToken);
  }

  async revokeAllSessions(walletAddress: string, exceptSessionToken?: string): Promise<number> {
    let revoked = 0;
    for (const [token, session] of this.sessions.entries()) {
      if (session.walletAddress !== walletAddress) {
        continue;
      }
      if (exceptSessionToken && token === exceptSessionToken) {
        continue;
      }
      this.sessions.delete(token);
      revoked += 1;
    }
    return revoked;
  }

  async cleanupExpiredAuthArtifacts(now: Date): Promise<void> {
    const nowMs = now.getTime();
    for (const [key, challenge] of this.authChallenges.entries()) {
      if (new Date(challenge.expiresAt).getTime() <= nowMs) {
        this.authChallenges.delete(key);
      }
    }

    for (const [token, session] of this.sessions.entries()) {
      if (new Date(session.expiresAt).getTime() <= nowMs) {
        this.sessions.delete(token);
      }
    }
  }

  async createFeedback(_input: {
    wallet: string;
    type: "bug" | "suggestion" | "other";
    subject: string;
    message: string;
    appVersion?: string;
    platform?: "android" | "ios" | "web";
  }): Promise<{ id: string; createdAt: string }> {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString()
    };
  }

  async listFeedback(_opts: {
    status?: "new" | "reviewed" | "resolved";
    limit: number;
    offset: number;
  }): Promise<FeedbackRow[]> {
    return [];
  }

  async updateFeedback(
    _id: string,
    _update: {
      status?: "new" | "reviewed" | "resolved";
      adminNotes?: string | null;
    }
  ): Promise<boolean> {
    return true;
  }

  async recordOrphanedPayment(_input: {
    txSignature: string;
    wallet: string;
    purpose: "prediction_stake" | "dispute_deposit" | "advertiser_campaign";
    expectedAmountSkr: number;
    referenceType: "poll" | "campaign";
    referenceId: string;
    failureReason: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ recorded: boolean; id?: string }> {
    return {
      recorded: true,
      id: randomUUID()
    };
  }

  async listOrphanedPayments(_opts: {
    status?: "open" | "reviewing" | "resolved";
    limit: number;
    offset: number;
  }): Promise<OrphanedPaymentRow[]> {
    return [];
  }

  async updateOrphanedPayment(
    _id: string,
    _update: {
      status?: "open" | "reviewing" | "resolved";
      adminNotes?: string | null;
    }
  ): Promise<boolean> {
    return true;
  }

  async listFeed(query: FeedQuery): Promise<FeedPage> {
    const limit = Math.max(1, Math.min(50, query.limit ?? 20));
    const cursor = decodeCursor(query.cursor);

    let rows = [...this.feed];
    if (query.category) {
      rows = rows.filter((item) => item.category === query.category);
    }
    if (query.lang) {
      rows = rows.filter((item) => item.language === query.lang);
    }

    if (cursor) {
      rows = rows.filter((item) => {
        if (item.publishedAt < cursor.date) return true;
        return item.publishedAt === cursor.date && item.id < cursor.id;
      });
    }

    const items = this.withReactionCounts(rows.slice(0, limit));
    const last = items.at(-1);

    return {
      items,
      nextCursor: last ? encodeCursor(last.publishedAt, last.id) : undefined
    };
  }

  async searchFeed(query: FeedQuery & { q: string }): Promise<FeedPage> {
    const q = query.q.trim().toLowerCase();
    if (!q) {
      return this.listFeed(query);
    }

    const cursor = decodeCursor(query.cursor);
    const limit = Math.max(1, Math.min(50, query.limit ?? 20));

    let rows = [...this.feed].filter((item) => {
      const haystack = `${item.headline} ${item.summary60}`.toLowerCase();
      return haystack.includes(q);
    });

    if (query.category) {
      rows = rows.filter((item) => item.category === query.category);
    }
    if (query.lang) {
      rows = rows.filter((item) => item.language === query.lang);
    }
    if (cursor) {
      rows = rows.filter((item) => {
        if (item.publishedAt < cursor.date) return true;
        return item.publishedAt === cursor.date && item.id < cursor.id;
      });
    }

    const items = this.withReactionCounts(rows.slice(0, limit));
    const last = items.at(-1);
    return {
      items,
      nextCursor: last ? encodeCursor(last.publishedAt, last.id) : undefined
    };
  }

  async getArticleById(id: string): Promise<FeedCard | null> {
    const article = this.feed.find((item) => item.id === id);
    if (!article) {
      return null;
    }

    const counts = this.buildReactionCounts([id])[id] ?? emptyReactionCounts();
    return {
      ...article,
      reactionCounts: counts
    };
  }

  async listSources(): Promise<SourceSummary[]> {
    return this.sources;
  }

  async getFeedFreshness(now: Date): Promise<FeedFreshness> {
    const latestPublishedAt = this.feed[0]?.publishedAt;
    const staleMinutes = latestPublishedAt
      ? Math.max(0, Math.floor((now.getTime() - new Date(latestPublishedAt).getTime()) / (60 * 1000)))
      : Number.POSITIVE_INFINITY;

    return {
      latestFeedItemPublishedAt: latestPublishedAt,
      latestIngestionFinishedAt: undefined,
      stale: !Number.isFinite(staleMinutes) || staleMinutes > 90,
      staleMinutes: Number.isFinite(staleMinutes) ? staleMinutes : 9_999
    };
  }

  async saveReaction(payload: ReactionPayload): Promise<"saved" | "duplicate"> {
    const key = `${payload.articleId}:${payload.wallet}`;
    if (this.reactionKeys.has(key)) {
      return "duplicate";
    }

    this.reactionKeys.add(key);
    this.reactions.push(payload);
    return "saved";
  }

  async getReactionCounts(articleIds: string[]): Promise<Record<string, ReactionCounts>> {
    return this.buildReactionCounts(articleIds);
  }

  async consumeRateLimit(bucket: string, scope: string, maxCount: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const key = `${bucket}:${scope}:${windowStartMs}`;
    const current = this.rateLimitBuckets.get(key);

    if (!current) {
      this.rateLimitBuckets.set(key, { count: 1, windowStartMs });
      return true;
    }

    if (current.count >= maxCount) {
      return false;
    }

    current.count += 1;
    return true;
  }

  async listBookmarks(input: { wallet: string; cursor?: string; limit?: number }): Promise<BookmarkPage> {
    const limit = Math.max(1, Math.min(50, input.limit ?? 20));
    const cursor = decodeCursor(input.cursor);
    const walletBookmarks = this.bookmarks.get(input.wallet);
    if (!walletBookmarks?.size) {
      return { items: [] };
    }

    let rows = [...walletBookmarks.entries()]
      .map(([articleId, createdAt]) => ({ articleId, createdAt }))
      .sort((a, b) => (a.createdAt === b.createdAt ? b.articleId.localeCompare(a.articleId) : b.createdAt.localeCompare(a.createdAt)));

    if (cursor) {
      rows = rows.filter((row) => {
        if (row.createdAt < cursor.date) return true;
        return row.createdAt === cursor.date && row.articleId < cursor.id;
      });
    }

    const selected = rows.slice(0, limit);
    const cards = selected
      .map((row) => this.feed.find((item) => item.id === row.articleId))
      .filter((item): item is FeedCard => Boolean(item));
    const items = this.withReactionCounts(cards);
    const last = selected.at(-1);

    return {
      items,
      nextCursor: last ? encodeCursor(last.createdAt, last.articleId) : undefined
    };
  }

  async addBookmark(wallet: string, articleId: string): Promise<"saved" | "duplicate" | "not_found"> {
    const exists = this.feed.some((item) => item.id === articleId);
    if (!exists) {
      return "not_found";
    }

    const walletBookmarks = this.bookmarks.get(wallet) ?? new Map<string, string>();
    if (walletBookmarks.has(articleId)) {
      return "duplicate";
    }

    walletBookmarks.set(articleId, new Date().toISOString());
    this.bookmarks.set(wallet, walletBookmarks);
    return "saved";
  }

  async removeBookmark(wallet: string, articleId: string): Promise<boolean> {
    const walletBookmarks = this.bookmarks.get(wallet);
    if (!walletBookmarks) {
      return false;
    }
    return walletBookmarks.delete(articleId);
  }

  async upsertPushSubscription(
    input: PushSubscriptionInput & {
      walletAddress?: string;
    }
  ): Promise<void> {
    const key = `${input.deviceId}:${input.expoPushToken}`;
    this.pushSubscriptions.set(key, {
      ...input,
      updatedAt: new Date().toISOString(),
      disabledAt: undefined
    });
  }

  async removePushSubscription(deviceId: string, expoPushToken: string): Promise<void> {
    const key = `${deviceId}:${expoPushToken}`;
    const current = this.pushSubscriptions.get(key);
    if (!current) {
      return;
    }
    this.pushSubscriptions.set(key, {
      ...current,
      updatedAt: new Date().toISOString(),
      disabledAt: new Date().toISOString()
    });
  }

  async upsertWalletSkrSnapshot(input: { wallet: string; balanceSkr: number; observedAt: string }): Promise<void> {
    const existing = this.walletSkrSnapshots.get(input.wallet);
    if (!existing) {
      this.walletSkrSnapshots.set(input.wallet, {
        balanceSkr: input.balanceSkr,
        firstSeenAt: input.observedAt,
        lastSeenAt: input.observedAt
      });
      return;
    }

    this.walletSkrSnapshots.set(input.wallet, {
      ...existing,
      balanceSkr: input.balanceSkr,
      lastSeenAt: input.observedAt
    });
  }

  async listAlerts(input: { cursor?: string; limit?: number; severity?: string }): Promise<{ items: ThreatAlert[]; nextCursor?: string }> {
    const limit = Math.max(1, Math.min(50, input.limit ?? 20));
    const cursor = decodeCursor(input.cursor);
    let rows = [...this.alerts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (input.severity) {
      rows = rows.filter((item) => item.severity === input.severity);
    }

    if (cursor) {
      rows = rows.filter((item) => {
        if (item.createdAt < cursor.date) return true;
        return item.createdAt === cursor.date && item.id < cursor.id;
      });
    }

    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: last ? encodeCursor(last.createdAt, last.id) : undefined
    };
  }

  async submitAlert(input: AlertSubmissionRequest): Promise<AlertSubmissionResult> {
    const submissionId = `submission_${randomUUID()}`;
    const autoPublish = input.confidence >= 0.9;

    if (autoPublish) {
      const alertId = `alert_${randomUUID()}`;
      this.alerts.set(alertId, {
        id: alertId,
        severity: input.confidence >= 0.95 ? "RED" : "ORANGE",
        type: "community",
        confidence: input.confidence,
        headline: "Community-submitted threat signal",
        summary60: input.observation,
        recommendation: "Verify with official channels",
        txHash: input.txHash,
        sourceUrl: `https://solscan.io/tx/${input.txHash}`,
        communitySignal: 1,
        createdAt: new Date().toISOString()
      });
    }

    const result: AlertSubmissionResult = {
      submissionId,
      status: autoPublish ? "auto_published" : "queued",
      queuedForReview: !autoPublish
    };
    this.alertSubmissions.set(submissionId, result);
    return result;
  }

  async voteAlert(input: { alertId: string; wallet: string; vote: "helpful" | "false_alarm" }): Promise<AlertVoteResult> {
    const alert = this.alerts.get(input.alertId);
    if (!alert) {
      throw new Error("alert_not_found");
    }

    const existing = this.alertVotes.get(`${input.alertId}:${input.wallet}`);
    if (existing) {
      return existing;
    }

    const nextSignal = Math.max(-1000, alert.communitySignal + (input.vote === "helpful" ? 1 : -1));
    const nextAlert: ThreatAlert = {
      ...alert,
      communitySignal: nextSignal
    };
    this.alerts.set(alert.id, nextAlert);

    const result: AlertVoteResult = {
      alertId: input.alertId,
      wallet: input.wallet,
      vote: input.vote,
      communitySignal: nextSignal,
      createdAt: new Date().toISOString()
    };
    this.alertVotes.set(`${input.alertId}:${input.wallet}`, result);
    return result;
  }

  async expireContentBoosts(_now: Date): Promise<number> {
    return 0;
  }

  async createContentBoost(input: { wallet: string; contentId: string; durationDays: number; amountSkr: number; now: Date }): Promise<ContentBoostReceipt> {
    const startsAt = input.now.toISOString();
    const endsAt = new Date(input.now.getTime() + input.durationDays * 24 * 60 * 60 * 1000).toISOString();
    const receipt: ContentBoostReceipt = {
      boostId: `boost_${randomUUID()}`,
      wallet: input.wallet,
      contentId: input.contentId,
      durationDays: input.durationDays,
      amountSkr: input.amountSkr,
      startsAt,
      endsAt
    };
    this.boosts.set(receipt.boostId, receipt);
    return receipt;
  }

  async consumeTxSignature(
    txSignature: string,
    _purpose: "content_boost" | "prediction_stake" | "dispute_deposit",
    _wallet: string
  ): Promise<"ok" | "already_used"> {
    if (this.consumedTxSignatures.has(txSignature)) {
      return "already_used";
    }
    this.consumedTxSignatures.add(txSignature);
    return "ok";
  }

  async getSystemConfigAll(): Promise<SystemConfigRow[]> {
    return [];
  }

  async updateSystemConfig(_key: string, _value: string, _updatedBy: string): Promise<void> {}

  async getAdminStats(): Promise<AdminStats> {
    return {
      feed: { total: 0, today: 0, last24h: 0 },
      pipeline: { callsLast24h: 0, successesLast24h: 0, avgLatencyMs: 0, stageBreakdown: [] },
      reviewQueue: { pending: 0 },
      estimatedCostUsd: 0
    };
  }

  async getExtendedAdminStats(): Promise<ExtendedAdminStats> {
    const base = await this.getAdminStats();
    return {
      ...base,
      feed: { ...base.feed, last7d: 0 },
      sources: { total: 0, active: 0, healthyLast24h: 0, articlesPerSource: [] },
      predictions: { activeMarkets: 0, totalVolumeLast24h: 0, totalVolumeAllTime: 0, resolvedLast7d: 0, platformFeesCollected: 0 },
      opinions: { activePolls: 0, votesLast24h: 0, avgParticipation: 0, resolvedLast7d: 0 },
      threats: { alertsPublished: 0, alertsLast24h: 0, communitySubmissions: 0, submissionsQueued: 0 },
      push: { registeredDevices: 0, activeDevices: 0, pendingReceipts: 0 },
      users: { uniqueWallets: 0, activeSessions: 0, walletsWithSkr: 0, avgChainRepScore: 0 },
      boosts: { active: 0, revenueSkrLast24h: 0, revenueSkrAllTime: 0 },
      telemetryFunnel: { processed: 0, relevanceFiltered: 0, summarized: 0, factCheckPassed: 0, factCheckReview: 0, factCheckRejected: 0, published: 0 },
      costBreakdown: []
    };
  }

  async getSourceHealth(): Promise<SourceHealthRow[]> { return []; }
  async listSourcesAdmin(): Promise<Array<{ id: string; name: string; feedUrl: string; active: boolean }>> { return []; }
  async listAdvertisersAdmin(): Promise<Array<{
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
  }>> { return []; }
  async setAdvertiserAccountStatus(
    _advertiserId: string,
    _status: "active" | "suspended",
    _reason?: string
  ): Promise<boolean> { return false; }
  async setAdvertiserCampaignsActive(_advertiserId: string, _active: boolean): Promise<number> { return 0; }
  async toggleSourceActive(_sourceId: string, _active: boolean): Promise<void> {}
  async createSource(_input: {
    name: string;
    homepageUrl: string;
    feedUrl: string;
    languageHint?: string;
  }): Promise<{ id: string }> {
    const id = `src_${_input.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20)}`;
    return { id };
  }
  async deleteSource(_sourceId: string): Promise<void> {}
  async recordSourceHealth(_input: {
    sourceId: string;
    fetchSuccess: boolean;
    fetchLatencyMs?: number;
    articlesFound?: number;
    articlesPublished?: number;
    errorMessage?: string;
    httpStatus?: number;
  }): Promise<void> {}

  // ─── Prediction Markets (stub implementations) ─────────────────────────────────

  async listPredictionMarkets(_input: {
    cursor?: string;
    limit?: number;
    status?: "active" | "resolved" | "cancelled";
    wallet?: string;
  }): Promise<{ items: PredictionMarket[]; nextCursor?: string }> {
    return { items: [] };
  }

  async getPredictionMarketById(_pollId: string, _wallet?: string): Promise<PredictionMarket | null> {
    return null;
  }

  async getPredictionPool(_pollId: string): Promise<PredictionPool | null> {
    return null;
  }

  async createPredictionStakePaymentIntent(_input: {
    pollId: string;
    wallet: string;
    side: "yes" | "no";
    amountSkr: number;
  }) {
    return {
      success: true as const,
      reservation: {
        id: randomUUID(),
        expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString()
      }
    };
  }

  async atomicStakeOnPrediction(input: {
    pollId: string;
    wallet: string;
    side: "yes" | "no";
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
  > {
    const now = new Date().toISOString();
    const receipt: PredictionStakeReceipt = {
      stakeId: `stake_${randomUUID()}`,
      pollId: input.pollId,
      side: input.side,
      amountSkr: input.amountSkr,
      pool: {
        pollId: input.pollId,
        yesPoolSkr: input.side === "yes" ? input.amountSkr : 0,
        noPoolSkr: input.side === "no" ? input.amountSkr : 0,
        totalPoolSkr: input.amountSkr,
        yesStakers: input.side === "yes" ? 1 : 0,
        noStakers: input.side === "no" ? 1 : 0,
        totalStakers: 1,
        yesPct: input.side === "yes" ? 100 : 0,
        noPct: input.side === "no" ? 100 : 0,
        yesOdds: input.side === "yes" ? 1 : 0,
        noOdds: input.side === "no" ? 1 : 0,
        updatedAt: now
      },
      potentialPayout: input.amountSkr,
      createdAt: now
    };
    return { success: true, receipt };
  }

  async countOpenPredictionStakePaymentIntents(_pollId: string): Promise<number> {
    return 0;
  }

  async listUserPredictionStakes(_wallet: string, _limit?: number): Promise<PredictionUserPortfolio> {
    return {
      activeStakes: [],
      resolvedStakes: [],
      totalStakedSkr: 0,
      totalWonSkr: 0,
      totalLostSkr: 0,
      pendingPayoutsSkr: 0
    };
  }

  async claimPredictionPayout(_input: {
    payoutId: string;
    wallet: string;
  }): Promise<{
    success: boolean;
    reason?: "not_found" | "already_claimed" | "frozen" | "not_yet_claimable" | "transfer_in_progress";
    netPayoutSkr: number;
    claimableAt?: string;
  }> {
    return { success: false, reason: "not_found", netPayoutSkr: 0 };
  }

  async cashOutPredictionStake(
    _stakeId: string,
    _wallet: string
  ): Promise<{ stakeAmount: number; pollId: string; side: "yes" | "no" } | null | "below_minimum" | "in_progress"> {
    return null;
  }

  async updateStakeCashoutTransfer(_stakeId: string, _wallet: string, _txSignature: string | null, _status: "complete" | "failed"): Promise<void> {
    // no-op in memory
  }

  async optInSponsoredCardLead(_cardId: string, _walletAddress: string): Promise<boolean> {
    return false;
  }

  async getSponsoredCardLeadsCount(_cardId: string): Promise<number> {
    return 0;
  }

  async recordPayoutTransfer(_input: {
    payoutId: string;
    txSignature?: string | null;
    transferStatus?: "in_progress" | "completed" | "failed" | "manual_required";
  }): Promise<void> {
    // Stub
  }

  async markPayoutTransferFailed(_input: { payoutId: string; error: string }): Promise<void> {
    // Stub
  }

  async getPredictionRevenueSummary(): Promise<{
    totalFeeSkr: number;
    totalMarketsSettled: number;
    totalStakesSkr: number;
    totalPayoutsSkr: number;
    pendingPayoutsSkr: number;
    pendingPayoutsCount: number;
  }> {
    return {
      totalFeeSkr: 0,
      totalMarketsSettled: 0,
      totalStakesSkr: 0,
      totalPayoutsSkr: 0,
      pendingPayoutsSkr: 0,
      pendingPayoutsCount: 0
    };
  }

  // ── OpenRouter Models (stub for memory repo) ──────────────────────────────

  async getOpenRouterModels(): Promise<OpenRouterModel[]> {
    return [];
  }

  async syncOpenRouterModels(_models: Array<{
    id: string;
    name: string;
    context_length?: number;
    pricing?: { prompt?: number; completion?: number };
    capabilities?: { tools?: boolean; vision?: boolean };
    moderation?: string;
  }>): Promise<number> {
    return 0;
  }

  async getAgentModelConfig(): Promise<Record<string, string>> {
    return {};
  }

  // ── Prediction Leaderboard (stub for memory repo) ─────────────────────────

  async getPredictionLeaderboard(_opts: {
    period: "all" | "week" | "month";
    sortBy: "profit" | "winRate" | "volume";
    limit: number;
  }): Promise<LeaderboardEntry[]> {
    return [];
  }

  async getUserPredictionRank(_wallet: string, _period: "all" | "week" | "month", _sortBy: "profit" | "winRate" | "volume"): Promise<UserRank | null> {
    return null;
  }

  // ── Sponsored Cards (stubs for in-memory/test repo) ──────────────────────
  async getActiveSponsoredCards(_input?: { placement?: "feed" | "predict"; limit?: number }) { return []; }
  async trackSponsoredEvent(_cardId: string, _type: "impression" | "click") { return false; }
  async listSponsoredCards() { return []; }
  async createSponsoredCard(_input: {
    advertiserName: string; headline: string; bodyText: string; imageUrl?: string;
    destinationUrl: string; ctaText: string; accentColor: string; cardFormat?: string;
    placement?: "feed" | "predict" | "both";
    targetAudience?: string; campaignGoal?: string; actionUrl?: string;
    startsAt: Date; endsAt: Date; impressionLimit?: number;
  }) { return "stub-id"; }
  async deactivateSponsoredCard(_id: string) { return false; }
  async setSponsoredCardActive(_id: string, _active: boolean) { return false; }
  async reviewSponsoredCard(
    _id: string,
    _decision: "approve" | "reject",
    _reviewer: string,
    _reason?: string
  ) { return false; }

  // ── Advertiser Accounts (stubs for in-memory/test repo) ──────────────────
  async upsertAdvertiserByWallet(_input: { walletAddress: string; email?: string }) {
    return { id: "stub-adv-id", companyName: null, isOnboarded: false };
  }
  async getAdvertiserById(_id: string) { return null; }
  async onboardAdvertiser(id: string, companyName: string, _websiteUrl?: string) {
    return { id, companyName, isOnboarded: true };
  }
  async updateAdvertiserLastLogin(_id: string) {}
  async createAdvertiserSession(_advertiserId: string) {
    return { sessionToken: `adv_sess_${randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
  }
  async getAdvertiserSession(_token: string) { return null; }
  async invalidateAdvertiserSession(_token: string) {}
  async createSponsoredCardForAdvertiser(_advertiserId: string, _input: {
    headline: string; bodyText: string; imageUrl?: string;
    destinationUrl: string; ctaText: string; accentColor: string; cardFormat: string;
    placement: "feed" | "predict" | "both";
    targetAudience: string; campaignGoal: string; actionUrl?: string;
    startsAt: Date; endsAt: Date; impressionLimit?: number; billingAmountUsdc: number;
  }) { return "stub-card-id"; }
  async listSponsoredCardsByAdvertiser(_advertiserId: string) { return []; }
  async updateSponsoredCardForAdvertiser(
    _advertiserId: string,
    _cardId: string,
    _input: {
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
    }
  ) { return false; }
  async getSponsoredCardForAdvertiser(_cardId: string, _advertiserId: string) { return null; }
  async setSponsoredCardActiveForAdvertiser(_cardId: string, _advertiserId: string, _active: boolean) { return false; }
  async createAdvertiserCampaignPaymentIntent(_input: {
    advertiserId: string;
    cardId: string;
  }) {
    return {
      success: true as const,
      reservation: {
        id: randomUUID(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      },
      billingAmountUsdc: 25
    };
  }
  async recordSponsoredCampaignPayment(_input: {
    advertiserId: string;
    cardId: string;
    txSignature: string;
    paymentIntentId?: string;
  }) {
    return { success: false as const, reason: "not_found" as const };
  }
  async listAdvertiserBillingRequests(_advertiserId: string) { return []; }
  async createAdvertiserBillingRequest(_input: {
    advertiserId: string;
    cardId: string;
    requestType: "billing_review" | "refund_request";
    note: string;
  }) {
    return { success: false as const, reason: "campaign_not_found" as const };
  }
  async listAdminAdvertiserBillingRequests() { return []; }
  async updateAdvertiserBillingRequestStatus(_input: {
    requestId: string;
    status: "reviewing" | "resolved" | "rejected";
    adminNote?: string;
    resolvedBy: string;
  }) { return false; }

  // ── Prediction Disputes (stubs for in-memory/test repo) ──────────────────
  async createPredictionDispute(_input: {
    pollId: string; wallet: string; reason: string;
    evidenceUrls?: string[]; depositSkr: number; depositTxSignature?: string;
  }) { return { disputeId: `stub-dispute-${randomUUID()}` }; }
  async createPredictionDisputePaymentIntent(_input: {
    pollId: string;
    wallet: string;
    depositSkr: number;
    challengeWindowHours?: number;
  }) {
    const challengeDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    return {
      success: true as const,
      reservation: {
        id: randomUUID(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      },
      challengeDeadline
    };
  }
  async atomicCreatePredictionDispute(_input: {
    pollId: string;
    wallet: string;
    reason: string;
    evidenceUrls?: string[];
    depositSkr: number;
    depositTxSignature?: string;
    challengeWindowHours?: number;
    paymentIntentId?: string;
  }) {
    return {
      success: true as const,
      disputeId: `stub-dispute-${randomUUID()}`,
      challengeDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    };
  }
  async listPredictionDisputes(_pollId: string) { return []; }
  async getPredictionDisputeForWallet(_pollId: string, _wallet: string) { return null; }
  async listAllDisputes(_input: { status?: string; cursor?: string; limit?: number }) {
    return { items: [], nextCursor: undefined };
  }
  async resolvePredictionDispute(_input: {
    disputeId: string; verdict: "upheld" | "rejected"; note: string; resolvedBy: string;
  }) { return { refundRequired: false, walletAddress: "", depositSkr: 0, pollId: "" }; }
  async resetPollForReResolution(
    _pollId: string,
    _options?: { allowPendingDisputeId?: string }
  ): Promise<void> {}
  async recordDisputeRefundTx(_disputeId: string, _txSignature: string): Promise<void> {}
  async getPredictionDispute(_disputeId: string) { return null; }
  async getDisputeForPollAndWallet(_pollId: string, _wallet: string) { return null; }
  async freezePollPayouts(_pollId: string, _freeze: boolean) {}
  async atomicUpdateDisputeStatusAndFreeze(
    _disputeId: string,
    _status: "investigating",
    _freezePoll: boolean
  ): Promise<{ pollId: string } | null> {
    return null;
  }

  // ── Admin Prediction Management (stubs) ──────────────────────────────────
  async listAllPredictionMarkets(_input: { status?: "active" | "resolved" | "cancelled"; cursor?: string; limit?: number }) {
    return { items: [], nextCursor: undefined };
  }

  async cancelPredictionMarket(_pollId: string, _reason: string) {
    return { stakesRefunded: 0, totalRefundSkr: 0 };
  }

  async updatePredictionMarketLimits(_pollId: string, _minStakeSkr: number, _maxStakeSkr: number) {}

  async getResolutionDetails(_pollId: string) {
    return null;
  }

  async createPredictionMarket(_input: {
    question: string;
    deadlineAt: Date;
    resolutionRule?: { kind: string; symbol?: string; target?: number };
    minStakeSkr?: number;
    maxStakeSkr?: number;
    platformFeePct?: number;
  }) {
    return { pollId: `pm_stub_${Date.now()}` };
  }

  async updateDisputeStatus(_disputeId: string, _status: "investigating") {}

  async addDisputeAdminNote(_disputeId: string, _note: string, _admin: string) {}

  async getPredictionEconomicsSettings() {
    return {
      platformFeePct: 5.0,
      disputeDepositSkr: 50,
      challengeWindowHours: 48,
      totalPlatformFees: 0,
      pendingDisputes: 0,
      totalDisputes: 0
    };
  }
}
