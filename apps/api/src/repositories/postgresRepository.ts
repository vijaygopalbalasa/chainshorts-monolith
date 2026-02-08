import { randomUUID } from "node:crypto";
import postgres from "postgres";
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
  OpinionPoll,
  PredictionMarket,
  PredictionPool,
  PredictionStake,
  PredictionStakeReceipt,
  PredictionPayout,
  PredictionUserPortfolio,
  ResolutionSummary,
  PushSubscriptionInput,
  ReactionPayload,
  ReactionCounts,
  SourceSummary,
  ThreatAlert
} from "@chainshorts/shared";
import type { AdminStats, AdminPredictionMarket, AuthChallengeRecord, AuthSessionRecord, ExtendedAdminStats, FeedbackRow, LeaderboardEntry, OpenRouterModel, OrphanedPaymentRow, PredictionDispute, PredictionResolutionDetails, Repository, SourceHealthRow, SystemConfigRow, UserRank } from "../types/repository.js";

interface FeedItemRow {
  id: string;
  headline: string;
  summary60: string;
  imageUrl: string | null;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  clusterId: string;
  language: string;
  category: string | null;
  cardType: FeedCard["cardType"] | null;
  tokenContext: unknown;
}

interface AlertRow {
  id: string;
  severity: "RED" | "ORANGE" | "YELLOW";
  type: ThreatAlert["type"];
  confidence: number;
  headline: string;
  summary60: string;
  recommendation: string;
  txHash: string | null;
  sourceUrl: string | null;
  communitySignal: number;
  createdAt: string;
}

/** Raw DB row shape shared by listPredictionMarkets and getPredictionMarketById queries */
interface PollRow {
  id: string;
  question: string;
  articleContext: string | null;
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
  deadlineAt: string;
  status: "active" | "resolved" | "cancelled";
  resolvedOutcome: "yes" | "no" | null;
  resolvedAt: string | null;
  resolutionSource: string | null;
  disputeFreeze: boolean;
  userVote: "yes" | "no" | null;
  userVotedAt: string | null;
  createdAt: string;
}

const STAKE_PAYMENT_INTENT_MS = 5 * 60 * 1000;
const DISPUTE_PAYMENT_INTENT_MS = 10 * 60 * 1000;
const ADVERTISER_PAYMENT_INTENT_MS = 15 * 60 * 1000;

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

function toFeedCard(row: FeedItemRow, reactionCounts: ReactionCounts): FeedCard {
  const tokenContext =
    row.tokenContext && typeof row.tokenContext === "object"
      ? (row.tokenContext as FeedCard["tokenContext"])
      : undefined;

  return {
    ...row,
    imageUrl: row.imageUrl ?? undefined,
    category: row.category ?? undefined,
    cardType: row.cardType ?? "news",
    tokenContext,
    reactionCounts
  };
}

function normalizePositiveInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class PostgresRepository implements Repository {
  constructor(private readonly sql: postgres.Sql) {}

  getSqlClient(): postgres.Sql {
    return this.sql;
  }

  private async listFeedRows(query: FeedQuery & { q?: string }): Promise<FeedPage> {
    const limit = normalizePositiveInt(query.limit ?? 20, 1, 50);
    const cursor = decodeCursor(query.cursor);
    const qLike = query.q?.trim() ? `%${query.q.trim()}%` : null;

    const rows = await this.sql<FeedItemRow[]>`
      select
        fi.id,
        fi.headline,
        fi.summary_60 as "summary60",
        fi.image_url as "imageUrl",
        fi.source_name as "sourceName",
        fi.source_url as "sourceUrl",
        fi.published_at as "publishedAt",
        fi.cluster_id as "clusterId",
        fi.language,
        fi.category,
        fi.card_type as "cardType",
        fi.token_context as "tokenContext"
      from feed_items fi
      left join content_boosts cb
        on cb.content_id = fi.id
        and cb.status = 'active'
        and cb.ends_at > now()
      where (${query.category ?? null}::text is null or fi.category = ${query.category ?? null})
        and (${query.lang ?? null}::text is null or fi.language = ${query.lang ?? null})
        and (${qLike}::text is null or fi.headline ilike ${qLike} or fi.summary_60 ilike ${qLike})
        and (
          ${cursor?.date ?? null}::timestamptz is null
          or fi.published_at < ${cursor?.date ?? null}::timestamptz
          or (fi.published_at = ${cursor?.date ?? null}::timestamptz and fi.id < ${cursor?.id ?? null})
        )
      order by case when cb.id is not null then 0 else 1 end, fi.published_at desc, fi.id desc
      limit ${limit}
    `;

    const counts = await this.getReactionCounts(rows.map((row) => row.id));
    const items = rows.map((row) => toFeedCard(row, counts[row.id] ?? emptyReactionCounts()));
    const last = items.at(-1);

    return {
      items,
      nextCursor: last ? encodeCursor(last.publishedAt, last.id) : undefined
    };
  }

  async createAuthChallenge(challenge: AuthChallengeRecord): Promise<void> {
    await this.sql`
      insert into auth_challenges (wallet_address, nonce, message, expires_at)
      values (${challenge.walletAddress}, ${challenge.nonce}, ${challenge.message}, ${challenge.expiresAt})
    `;
  }

  async getAuthChallenge(walletAddress: string, nonce: string): Promise<AuthChallengeRecord | null> {
    const rows = await this.sql<AuthChallengeRecord[]>`
      select wallet_address as "walletAddress", nonce, message, expires_at as "expiresAt"
      from auth_challenges
      where wallet_address = ${walletAddress} and nonce = ${nonce}
      limit 1
    `;

    return rows[0] ?? null;
  }

  async deleteAuthChallenge(walletAddress: string, nonce: string): Promise<void> {
    await this.sql`
      delete from auth_challenges where wallet_address = ${walletAddress} and nonce = ${nonce}
    `;
  }

  async createSession(walletAddress: string): Promise<AuthSessionRecord> {
    const session: AuthSessionRecord = {
      sessionToken: `sess_${randomUUID()}`,
      walletAddress,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    await this.sql`
      insert into auth_sessions (session_token, wallet_address, expires_at)
      values (${session.sessionToken}, ${session.walletAddress}, ${session.expiresAt})
    `;

    return session;
  }

  async getSession(sessionToken: string): Promise<AuthSessionRecord | null> {
    const rows = await this.sql<AuthSessionRecord[]>`
      select
        session_token as "sessionToken",
        wallet_address as "walletAddress",
        expires_at as "expiresAt"
      from auth_sessions
      where session_token = ${sessionToken}
        and invalidated_at is null
        and expires_at > now()
      limit 1
    `;

    return rows[0] ?? null;
  }

  async revokeSession(sessionToken: string): Promise<void> {
    await this.sql`
      update auth_sessions
      set invalidated_at = now()
      where session_token = ${sessionToken}
    `;
  }

  async revokeAllSessions(walletAddress: string, exceptSessionToken?: string): Promise<number> {
    const rows = await this.sql<{ count: number }[]>`
      with updated as (
        update auth_sessions
        set invalidated_at = now()
        where wallet_address = ${walletAddress}
          and invalidated_at is null
          and (${exceptSessionToken ?? null}::text is null or session_token <> ${exceptSessionToken ?? null})
        returning 1
      )
      select count(*)::int as count from updated
    `;

    return rows[0]?.count ?? 0;
  }

  async cleanupExpiredAuthArtifacts(now: Date): Promise<void> {
    const nowIso = now.toISOString();
    await this.sql`
      delete from auth_challenges
      where expires_at <= ${nowIso}::timestamptz
    `;

    await this.sql`
      delete from auth_sessions
      where expires_at <= ${nowIso}::timestamptz
         or (invalidated_at is not null and invalidated_at <= ${nowIso}::timestamptz - interval '30 days')
    `;
  }

  async createFeedback(input: {
    wallet: string;
    type: "bug" | "suggestion" | "other";
    subject: string;
    message: string;
    appVersion?: string;
    platform?: "android" | "ios" | "web";
  }): Promise<{ id: string; createdAt: string }> {
    const rows = await this.sql<{ id: string; createdAt: string }[]>`
      insert into user_feedback (
        wallet,
        type,
        subject,
        message,
        app_version,
        platform
      )
      values (
        ${input.wallet},
        ${input.type},
        ${input.subject},
        ${input.message},
        ${input.appVersion ?? null},
        ${input.platform ?? null}
      )
      returning
        id::text as id,
        created_at::text as "createdAt"
    `;

    return rows[0] as { id: string; createdAt: string };
  }

  async listFeedback(opts: {
    status?: "new" | "reviewed" | "resolved";
    limit: number;
    offset: number;
  }): Promise<FeedbackRow[]> {
    const limit = normalizePositiveInt(opts.limit, 1, 200);
    const offset = Math.max(0, Math.floor(opts.offset));

    return this.sql<FeedbackRow[]>`
      select
        id::text as id,
        wallet,
        type,
        subject,
        message,
        app_version as "appVersion",
        platform,
        status,
        admin_notes as "adminNotes",
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from user_feedback
      where (${opts.status ?? null}::text is null or status = ${opts.status ?? null})
      order by created_at desc, id desc
      limit ${limit}
      offset ${offset}
    `;
  }

  async updateFeedback(
    id: string,
    update: {
      status?: "new" | "reviewed" | "resolved";
      adminNotes?: string | null;
    }
  ): Promise<boolean> {
    let rows: Array<{ id: string }> = [];

    if (update.status !== undefined && update.adminNotes !== undefined) {
      rows = await this.sql<{ id: string }[]>`
        update user_feedback
        set
          status = ${update.status},
          admin_notes = ${update.adminNotes},
          updated_at = now()
        where id = ${id}::uuid
        returning id::text as id
      `;
    } else if (update.status !== undefined) {
      rows = await this.sql<{ id: string }[]>`
        update user_feedback
        set
          status = ${update.status},
          updated_at = now()
        where id = ${id}::uuid
        returning id::text as id
      `;
    } else if (update.adminNotes !== undefined) {
      rows = await this.sql<{ id: string }[]>`
        update user_feedback
        set
          admin_notes = ${update.adminNotes},
          updated_at = now()
        where id = ${id}::uuid
        returning id::text as id
      `;
    }

    return rows.length > 0;
  }

  async recordOrphanedPayment(input: {
    txSignature: string;
    wallet: string;
    purpose: "prediction_stake" | "dispute_deposit" | "advertiser_campaign";
    expectedAmountSkr: number;
    referenceType: "poll" | "campaign";
    referenceId: string;
    failureReason: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ recorded: boolean; id?: string }> {
    try {
      const rows = await this.sql<Array<{ id: string }>>`
        INSERT INTO orphaned_payments (
          tx_signature,
          wallet,
          purpose,
          expected_amount_skr,
          reference_type,
          reference_id,
          failure_reason,
          metadata
        )
        VALUES (
          ${input.txSignature},
          ${input.wallet},
          ${input.purpose},
          ${input.expectedAmountSkr},
          ${input.referenceType},
          ${input.referenceId},
          ${input.failureReason},
          ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb
        )
        ON CONFLICT (tx_signature) DO NOTHING
        RETURNING id::text as id
      `;

      return {
        recorded: rows.length > 0,
        id: rows[0]?.id
      };
    } catch {
      return { recorded: false };
    }
  }

  async listOrphanedPayments(opts: {
    status?: "open" | "reviewing" | "resolved";
    limit: number;
    offset: number;
  }): Promise<OrphanedPaymentRow[]> {
    const limit = normalizePositiveInt(opts.limit, 1, 200);
    const offset = Math.max(0, Math.floor(opts.offset));

    return this.sql<OrphanedPaymentRow[]>`
      SELECT
        id::text as id,
        tx_signature as "txSignature",
        wallet,
        purpose,
        expected_amount_skr::int as "expectedAmountSkr",
        reference_type as "referenceType",
        reference_id as "referenceId",
        failure_reason as "failureReason",
        status,
        admin_notes as "adminNotes",
        metadata,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      FROM orphaned_payments
      WHERE (${opts.status ?? null}::text IS NULL OR status = ${opts.status ?? null})
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }

  async updateOrphanedPayment(
    id: string,
    update: {
      status?: "open" | "reviewing" | "resolved";
      adminNotes?: string | null;
    }
  ): Promise<boolean> {
    let rows: Array<{ id: string }> = [];

    if (update.status !== undefined && update.adminNotes !== undefined) {
      rows = await this.sql<Array<{ id: string }>>`
        UPDATE orphaned_payments
        SET
          status = ${update.status},
          admin_notes = ${update.adminNotes},
          updated_at = now()
        WHERE id = ${id}::uuid
        RETURNING id::text as id
      `;
    } else if (update.status !== undefined) {
      rows = await this.sql<Array<{ id: string }>>`
        UPDATE orphaned_payments
        SET
          status = ${update.status},
          updated_at = now()
        WHERE id = ${id}::uuid
        RETURNING id::text as id
      `;
    } else if (update.adminNotes !== undefined) {
      rows = await this.sql<Array<{ id: string }>>`
        UPDATE orphaned_payments
        SET
          admin_notes = ${update.adminNotes},
          updated_at = now()
        WHERE id = ${id}::uuid
        RETURNING id::text as id
      `;
    }

    return rows.length > 0;
  }

  async listFeed(query: FeedQuery): Promise<FeedPage> {
    return this.listFeedRows(query);
  }

  async searchFeed(query: FeedQuery & { q: string }): Promise<FeedPage> {
    return this.listFeedRows(query);
  }

  async getArticleById(id: string): Promise<FeedCard | null> {
    const rows = await this.sql<FeedItemRow[]>`
      select
        fi.id,
        fi.headline,
        fi.summary_60 as "summary60",
        fi.image_url as "imageUrl",
        fi.source_name as "sourceName",
        fi.source_url as "sourceUrl",
        fi.published_at as "publishedAt",
        fi.cluster_id as "clusterId",
        fi.language,
        fi.category,
        fi.card_type as "cardType",
        fi.token_context as "tokenContext"
      from feed_items fi
      where fi.id = ${id}
      limit 1
    `;

    const article = rows[0];
    if (!article) return null;

    const counts = await this.getReactionCounts([id]);
    return toFeedCard(article, counts[id] ?? emptyReactionCounts());
  }

  async listSources(): Promise<SourceSummary[]> {
    const rows = await this.sql<SourceSummary[]>`
      select
        s.id,
        s.name,
        s.homepage_url as "homepageUrl",
        s.feed_url as "feedUrl",
        s.language_hint as "languageHint",
        sp.active as compliant
      from sources s
      join source_policies sp on sp.source_id = s.id
      where sp.active = true
      order by s.name asc
    `;

    return rows;
  }

  async getFeedFreshness(now: Date): Promise<FeedFreshness> {
    const [feedRow] = await this.sql<{ latestFeedItemPublishedAt: string }[]>`
      select fi.published_at as "latestFeedItemPublishedAt"
      from feed_items fi
      order by fi.published_at desc
      limit 1
    `;

    const [ingestRow] = await this.sql<{ latestIngestionFinishedAt: string }[]>`
      select ij.finished_at as "latestIngestionFinishedAt"
      from ingestion_jobs ij
      where ij.finished_at is not null
      order by ij.finished_at desc
      limit 1
    `;

    const latestFeedItemPublishedAt = feedRow?.latestFeedItemPublishedAt;
    const latestIngestionFinishedAt = ingestRow?.latestIngestionFinishedAt;

    const freshnessAnchor = latestFeedItemPublishedAt ?? latestIngestionFinishedAt;
    if (!freshnessAnchor) {
      return {
        latestFeedItemPublishedAt: undefined,
        latestIngestionFinishedAt: undefined,
        stale: true,
        staleMinutes: 9_999
      };
    }

    const staleMinutes = Math.max(0, Math.floor((now.getTime() - new Date(freshnessAnchor).getTime()) / (60 * 1000)));

    return {
      latestFeedItemPublishedAt,
      latestIngestionFinishedAt,
      stale: staleMinutes > 90,
      staleMinutes
    };
  }

  async saveReaction(payload: ReactionPayload): Promise<"saved" | "duplicate"> {
    try {
      await this.sql`
        insert into reactions_signed (article_id, wallet, reaction_type, nonce, signature)
        values (${payload.articleId}, ${payload.wallet}, ${payload.reactionType}, ${payload.nonce}, ${payload.signature})
      `;
      return "saved";
    } catch (error) {
      const dbError = error as { code?: string };
      if (dbError.code === "23505") {
        return "duplicate";
      }
      throw error;
    }
  }

  async getReactionCounts(articleIds: string[]): Promise<Record<string, ReactionCounts>> {
    const uniqueArticleIds = [...new Set(articleIds.filter(Boolean))];
    const result: Record<string, ReactionCounts> = {};

    for (const articleId of uniqueArticleIds) {
      result[articleId] = emptyReactionCounts();
    }

    if (!uniqueArticleIds.length) {
      return result;
    }

    const rows = await this.sql<
      {
        articleId: string;
        reactionType: "bullish" | "bearish" | "insightful" | "skeptical";
        count: number;
      }[]
    >`
      select
        rs.article_id as "articleId",
        rs.reaction_type as "reactionType",
        count(*)::int as count
      from reactions_signed rs
      where rs.article_id = any(${this.sql.array(uniqueArticleIds)})
      group by rs.article_id, rs.reaction_type
    `;

    for (const row of rows) {
      const counts = result[row.articleId] ?? emptyReactionCounts();
      counts[row.reactionType] = row.count;
      result[row.articleId] = counts;
    }

    for (const articleId of uniqueArticleIds) {
      const counts = result[articleId] ?? emptyReactionCounts();
      counts.total = counts.bullish + counts.bearish + counts.insightful + counts.skeptical;
      result[articleId] = counts;
    }

    return result;
  }

  async consumeRateLimit(bucket: string, scope: string, maxCount: number, windowMs: number): Promise<boolean> {
    if (maxCount <= 0 || windowMs <= 0) {
      return false;
    }

    const now = Date.now();
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const windowStart = new Date(windowStartMs).toISOString();
    const windowEnd = new Date(windowStartMs + windowMs).toISOString();

    const rows = await this.sql<{ count: number }[]>`
      insert into api_rate_limit_buckets (bucket, scope, window_start, window_end, count)
      values (${bucket}, ${scope}, ${windowStart}, ${windowEnd}, 1)
      on conflict (bucket, scope, window_start)
      do update set count = api_rate_limit_buckets.count + 1
      where api_rate_limit_buckets.count < ${maxCount}
      returning count
    `;

    if (Math.random() < 0.01) {
      await this.sql`
        delete from api_rate_limit_buckets
        where window_end < now() - interval '1 day'
      `;
    }

    return rows.length > 0;
  }

  async listBookmarks(input: { wallet: string; cursor?: string; limit?: number }): Promise<BookmarkPage> {
    const limit = normalizePositiveInt(input.limit ?? 20, 1, 50);
    const cursor = decodeCursor(input.cursor);

    const rows = await this.sql<
      (FeedItemRow & {
        bookmarkedAt: string;
      })[]
    >`
      select
        b.bookmarked_at as "bookmarkedAt",
        fi.id,
        fi.headline,
        fi.summary_60 as "summary60",
        fi.image_url as "imageUrl",
        fi.source_name as "sourceName",
        fi.source_url as "sourceUrl",
        fi.published_at as "publishedAt",
        fi.cluster_id as "clusterId",
        fi.language,
        fi.category,
        fi.card_type as "cardType",
        fi.token_context as "tokenContext"
      from bookmarks b
      join feed_items fi on fi.id = b.article_id
      where b.wallet = ${input.wallet}
        and (
          ${cursor?.date ?? null}::timestamptz is null
          or b.bookmarked_at < ${cursor?.date ?? null}::timestamptz
          or (b.bookmarked_at = ${cursor?.date ?? null}::timestamptz and b.article_id < ${cursor?.id ?? null})
        )
      order by b.bookmarked_at desc, b.article_id desc
      limit ${limit}
    `;

    const counts = await this.getReactionCounts(rows.map((row) => row.id));
    const items = rows.map((row) => toFeedCard(row, counts[row.id] ?? emptyReactionCounts()));

    const last = rows.at(-1);

    return {
      items,
      nextCursor: last ? encodeCursor(last.bookmarkedAt, last.id) : undefined
    };
  }

  async addBookmark(wallet: string, articleId: string): Promise<"saved" | "duplicate" | "not_found"> {
    const exists = await this.sql<{ id: string }[]>`
      select id from feed_items where id = ${articleId} limit 1
    `;

    if (!exists.length) {
      return "not_found";
    }

    const inserted = await this.sql<{ articleId: string }[]>`
      insert into bookmarks (wallet, article_id)
      values (${wallet}, ${articleId})
      on conflict (wallet, article_id)
      do nothing
      returning article_id as "articleId"
    `;

    return inserted.length ? "saved" : "duplicate";
  }

  async removeBookmark(wallet: string, articleId: string): Promise<boolean> {
    const removed = await this.sql<{ articleId: string }[]>`
      delete from bookmarks
      where wallet = ${wallet} and article_id = ${articleId}
      returning article_id as "articleId"
    `;

    return removed.length > 0;
  }

  async upsertPushSubscription(
    input: PushSubscriptionInput & {
      walletAddress?: string;
    }
  ): Promise<void> {
    await this.sql`
      insert into push_subscriptions (
        device_id,
        expo_push_token,
        platform,
        wallet_address,
        locale,
        app_version,
        updated_at,
        disabled_at
      )
      values (
        ${input.deviceId},
        ${input.expoPushToken},
        ${input.platform},
        ${input.walletAddress ?? null},
        ${input.locale ?? null},
        ${input.appVersion ?? null},
        now(),
        null
      )
      on conflict (device_id, expo_push_token)
      do update set
        platform = excluded.platform,
        wallet_address = excluded.wallet_address,
        locale = excluded.locale,
        app_version = excluded.app_version,
        updated_at = now(),
        disabled_at = null
    `;
  }

  async removePushSubscription(deviceId: string, expoPushToken: string): Promise<void> {
    await this.sql`
      update push_subscriptions
      set disabled_at = now(),
          updated_at = now()
      where device_id = ${deviceId}
        and expo_push_token = ${expoPushToken}
    `;
  }

  async upsertWalletSkrSnapshot(input: { wallet: string; balanceSkr: number; observedAt: string }): Promise<void> {
    await this.sql`
      insert into wallet_skr_snapshots (wallet, balance_skr, first_seen_at, last_seen_at)
      values (${input.wallet}, ${input.balanceSkr}, ${input.observedAt}, ${input.observedAt})
      on conflict (wallet)
      do update set
        balance_skr = excluded.balance_skr,
        last_seen_at = excluded.last_seen_at
    `;
  }

  async listAlerts(input: { cursor?: string; limit?: number; severity?: string }): Promise<{ items: ThreatAlert[]; nextCursor?: string }> {
    const limit = normalizePositiveInt(input.limit ?? 20, 1, 50);
    const cursor = decodeCursor(input.cursor);

    const rows = await this.sql<AlertRow[]>`
      select
        ta.id::text as id,
        ta.severity,
        ta.alert_type as type,
        ta.confidence,
        ta.headline,
        ta.summary_60 as "summary60",
        ta.recommendation,
        ta.tx_hash as "txHash",
        ta.source_url as "sourceUrl",
        ta.community_signal as "communitySignal",
        ta.published_at as "createdAt"
      from threat_alerts ta
      where ta.status = 'published'
        and (${input.severity ?? null}::text is null or ta.severity = ${input.severity ?? null}::text)
        and (
          ${cursor?.date ?? null}::timestamptz is null
          or ta.published_at < ${cursor?.date ?? null}::timestamptz
          or (ta.published_at = ${cursor?.date ?? null}::timestamptz and ta.id::text < ${cursor?.id ?? null})
        )
      order by ta.published_at desc, ta.id desc
      limit ${limit}
    `;

    const items: ThreatAlert[] = rows.map((row) => ({
      id: row.id,
      severity: row.severity,
      type: row.type,
      confidence: row.confidence,
      headline: row.headline,
      summary60: row.summary60,
      recommendation: row.recommendation,
      txHash: row.txHash ?? undefined,
      sourceUrl: row.sourceUrl ?? undefined,
      communitySignal: row.communitySignal,
      createdAt: row.createdAt
    }));
    const last = items.at(-1);
    return {
      items,
      nextCursor: last ? encodeCursor(last.createdAt, last.id) : undefined
    };
  }

  async submitAlert(input: AlertSubmissionRequest): Promise<AlertSubmissionResult> {
    return this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;
      const now = new Date();

      const submissionRows = await tx<{ submissionId: string }[]>`
        insert into alert_submissions (wallet, tx_hash, observation, confidence, status)
        values (${input.wallet}, ${input.txHash}, ${input.observation}, ${input.confidence}, 'queued')
        returning id::text as "submissionId"
      `;

      const submissionId = submissionRows[0]?.submissionId;
      if (!submissionId) {
        throw new Error("alert_submission_failed");
      }

      if (input.confidence >= 0.9) {
        const alertRows = await tx<{ alertId: string }[]>`
          insert into threat_alerts (
            severity,
            alert_type,
            confidence,
            headline,
            summary_60,
            recommendation,
            tx_hash,
            source_url,
            community_signal,
            status
          )
          values (
            ${input.confidence >= 0.95 ? "RED" : "ORANGE"},
            'community',
            ${input.confidence},
            'Community-submitted threat signal',
            ${input.observation},
            'Verify with official channels',
            ${input.txHash},
            ${`https://solscan.io/tx/${input.txHash}`},
            1,
            'published'
          )
          returning id::text as "alertId"
        `;

        const alertId = alertRows[0]?.alertId;
        await tx`
          update alert_submissions
          set status = 'auto_published',
              linked_alert_id = ${alertId ?? null}::uuid,
              reviewed_at = now(),
              reviewer_note = 'auto-published by confidence threshold'
          where id = ${submissionId}::uuid
        `;
        if (alertId) {
          await tx`
            insert into alert_review_log (alert_id, submission_id, action, actor, note)
            values (${alertId}::uuid, ${submissionId}::uuid, 'auto_publish', 'system', 'confidence >= 0.90')
          `;
        }
        return {
          submissionId,
          status: "auto_published",
          queuedForReview: false
        };
      }

      return {
        submissionId,
        status: "queued",
        queuedForReview: true
      };
    });
  }

  async voteAlert(input: { alertId: string; wallet: string; vote: "helpful" | "false_alarm" }): Promise<AlertVoteResult> {
    return await this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;

      const [alert] = await tx<Array<{ id: string }>>`
        select ta.id::text as id
        from threat_alerts ta
        where ta.id = ${input.alertId}::uuid
          and ta.status = 'published'
        limit 1
      `;
      if (!alert) {
        throw new Error("alert_not_found");
      }

      const voteRows = await tx<Array<{ createdAt: string; vote: "helpful" | "false_alarm" }>>`
        insert into alert_votes (alert_id, wallet, vote)
        values (${input.alertId}::uuid, ${input.wallet}, ${input.vote})
        on conflict (alert_id, wallet)
        do update set
          vote = excluded.vote
        returning created_at as "createdAt", vote
      `;
      const vote = voteRows[0];

      const [signal] = await tx<Array<{ communitySignal: number }>>`
        with tally as (
          select coalesce(sum(case when av.vote = 'helpful' then 1 else -1 end), 0)::int as score
          from alert_votes av
          where av.alert_id = ${input.alertId}::uuid
        )
        update threat_alerts ta
        set community_signal = tally.score,
            updated_at = now()
        from tally
        where ta.id = ${input.alertId}::uuid
        returning ta.community_signal as "communitySignal"
      `;

      return {
        alertId: input.alertId,
        wallet: input.wallet,
        vote: vote?.vote ?? input.vote,
        communitySignal: signal?.communitySignal ?? 0,
        createdAt: vote?.createdAt ?? new Date().toISOString()
      };
    });
  }

  async expireContentBoosts(now: Date): Promise<number> {
    const rows = await this.sql<{ n: number }[]>`
      update content_boosts
      set status = 'expired',
          updated_at = ${now.toISOString()}
      where status = 'active'
        and ends_at <= ${now.toISOString()}
      returning 1 as n
    `;
    return rows.length;
  }

  async createContentBoost(input: { wallet: string; contentId: string; durationDays: number; amountSkr: number; now: Date }): Promise<ContentBoostReceipt> {
    const startsAt = input.now.toISOString();
    const endsAt = new Date(input.now.getTime() + input.durationDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.sql<{ boostId: string }[]>`
      insert into content_boosts (
        wallet,
        content_id,
        duration_days,
        amount_skr,
        starts_at,
        ends_at,
        status,
        created_at
      )
      values (
        ${input.wallet},
        ${input.contentId},
        ${input.durationDays},
        ${input.amountSkr},
        ${startsAt},
        ${endsAt},
        'active',
        ${input.now.toISOString()}
      )
      returning id::text as "boostId"
    `;
    const boostId = rows[0]?.boostId;
    if (!boostId) {
      throw new Error("boost_insert_failed");
    }

    await this.sql`
      insert into service_payments (wallet, service_type, amount_skr, status, metadata, created_at)
      values (
        ${input.wallet},
        'content_boost',
        ${input.amountSkr},
        'completed',
        ${JSON.stringify({ contentId: input.contentId, durationDays: input.durationDays, boostId })}::jsonb,
        ${input.now.toISOString()}
      )
    `;

    await this.sql`
      insert into custody_ledger (wallet, direction, amount_skr, reference_type, reference_id, created_at)
      values (${input.wallet}, 'fee', ${input.amountSkr}, 'service_payment', ${boostId}, ${input.now.toISOString()})
    `;

    return {
      boostId,
      wallet: input.wallet,
      contentId: input.contentId,
      durationDays: input.durationDays,
      amountSkr: input.amountSkr,
      startsAt,
      endsAt
    };
  }

  async getSystemConfigAll(): Promise<SystemConfigRow[]> {
    const rows = await this.sql<SystemConfigRow[]>`
      select
        key,
        value,
        value_type  as "valueType",
        label,
        description,
        category,
        updated_at::text as "updatedAt",
        updated_by  as "updatedBy"
      from system_config
      order by category, key
    `;
    return rows;
  }

  async updateSystemConfig(key: string, value: string, updatedBy: string): Promise<void> {
    await this.sql`
      update system_config
      set value      = ${value},
          updated_by = ${updatedBy},
          updated_at = now()
      where key = ${key}
    `;
  }

  async getAdminStats(): Promise<AdminStats> {
    const [feedRows, pipelineRows, stageRows, queueRows] = await Promise.all([
      this.sql<Array<{ total: number; today: number; last24h: number }>>`
        select
          count(*)::int                                                               as total,
          count(*) filter (where created_at >= current_date)::int                    as today,
          count(*) filter (where created_at >= now() - interval '24 hours')::int     as last24h
        from feed_items
      `,
      this.sql<Array<{ calls: number; successes: number; avgLatencyMs: number }>>`
        select
          count(*)::int                                                              as calls,
          count(*) filter (where success = true)::int                               as successes,
          coalesce(avg(latency_ms) filter (where success = true), 0)::int           as "avgLatencyMs"
        from model_runs
        where created_at >= now() - interval '24 hours'
      `,
      this.sql<Array<{ purpose: string; calls: number; successes: number; avgLatencyMs: number }>>`
        select
          purpose,
          count(*)::int                                                              as calls,
          count(*) filter (where success = true)::int                               as successes,
          coalesce(avg(latency_ms) filter (where success = true), 0)::int           as "avgLatencyMs"
        from model_runs
        where created_at >= now() - interval '24 hours'
        group by purpose
        order by calls desc
      `,
      this.sql<Array<{ pending: number }>>`
        select count(*)::int as pending
        from review_queue
        where status = 'pending'
      `
    ]);

    const feed = feedRows[0] ?? { total: 0, today: 0, last24h: 0 };
    const pipeline = pipelineRows[0] ?? { calls: 0, successes: 0, avgLatencyMs: 0 };
    const pending = queueRows[0]?.pending ?? 0;

    const stageBreakdown = stageRows.map((row) => ({
      purpose: row.purpose,
      calls: row.calls,
      successRate: row.calls > 0 ? Math.round((row.successes / row.calls) * 100) : 0,
      avgLatencyMs: row.avgLatencyMs
    }));

    // Calculate actual cost from token usage (DeepSeek V3: $0.19/M input, $0.87/M output)
    const tokenCostResult = await this.sql<Array<{ inputTokens: number; outputTokens: number }>>`
      select
        coalesce(sum(input_tokens), 0)::int as "inputTokens",
        coalesce(sum(output_tokens), 0)::int as "outputTokens"
      from model_runs
      where created_at >= now() - interval '24 hours'
    `;
    const tokens = tokenCostResult[0] ?? { inputTokens: 0, outputTokens: 0 };
    // DeepSeek V3 pricing: $0.19/M input, $0.87/M output
    const inputCost = (tokens.inputTokens / 1_000_000) * 0.19;
    const outputCost = (tokens.outputTokens / 1_000_000) * 0.87;
    const estimatedCostUsd = Math.round((inputCost + outputCost) * 1000) / 1000;

    return {
      feed: { total: feed.total, today: feed.today, last24h: feed.last24h },
      pipeline: {
        callsLast24h: pipeline.calls,
        successesLast24h: pipeline.successes,
        avgLatencyMs: pipeline.avgLatencyMs,
        stageBreakdown
      },
      reviewQueue: { pending },
      estimatedCostUsd
    };
  }

  async getExtendedAdminStats(): Promise<ExtendedAdminStats> {
    const baseStats = await this.getAdminStats();

    const [
      feedExtRows,
      sourcesRows,
      articlesPerSourceRows,
      predictionsRows,
      opinionsRows,
      threatsRows,
      pushRows,
      usersRows,
      boostsRows,
      telemetryRows,
      costRows
    ] = await Promise.all([
      // Extended feed stats (7d)
      this.sql<Array<{ last7d: number }>>`
        select count(*)::int as last7d
        from feed_items
        where created_at >= now() - interval '7 days'
      `,
      // Sources stats
      this.sql<Array<{ total: number; active: number; healthy: number }>>`
        select
          count(*)::int as total,
          count(*) filter (where sp.active = true)::int as active,
          count(*) filter (
            where sp.active = true
            and sp.consecutive_failures < 3
          )::int as healthy
        from sources s
        join source_policies sp on sp.source_id = s.id
        where s.deleted_at is null
      `,
      // Articles per source
      this.sql<Array<{ sourceId: string; sourceName: string; count: number }>>`
        select
          s.id as "sourceId",
          s.name as "sourceName",
          count(fi.id)::int as count
        from sources s
        left join feed_items fi on fi.source_name = s.name
          and fi.created_at >= now() - interval '24 hours'
        where s.deleted_at is null
        group by s.id, s.name
        order by count desc
        limit 20
      `,
      // Predictions stats
      this.sql<Array<{ active: number; volume24h: number; volumeAll: number; resolved7d: number; fees: number }>>`
        select
          coalesce((select count(*) from opinion_polls where is_prediction = true and status = 'active'), 0)::int as active,
          coalesce((select sum(amount_skr) from prediction_stakes where created_at >= now() - interval '24 hours'), 0)::bigint as volume24h,
          coalesce((select sum(amount_skr) from prediction_stakes), 0)::bigint as "volumeAll",
          coalesce((select count(*) from opinion_polls where is_prediction = true and resolved_outcome is not null and resolved_at >= now() - interval '7 days'), 0)::int as resolved7d,
          coalesce((select sum(total_fee_skr) from prediction_platform_fees), 0)::bigint as fees
      `,
      // Opinions stats (opinion_votes table removed — feature deprecated)
      this.sql<Array<{ active: number; votes24h: number; avgParticipation: number; resolved7d: number }>>`
        select
          0::int as active,
          0::int as votes24h,
          0::int as "avgParticipation",
          0::int as resolved7d
      `,
      // Threats stats
      this.sql<Array<{ published: number; last24h: number; submissions: number; queued: number }>>`
        select
          (select count(*) from threat_alerts where status = 'published')::int as published,
          (select count(*) from threat_alerts where status = 'published' and created_at >= now() - interval '24 hours')::int as last24h,
          (select count(*) from alert_submissions)::int as submissions,
          (select count(*) from alert_submissions where status = 'queued')::int as queued
      `,
      // Push stats
      this.sql<Array<{ registered: number; active: number; pending: number }>>`
        select
          (select count(*) from push_subscriptions)::int as registered,
          (select count(*) from push_subscriptions where disabled_at is null)::int as active,
          (select count(*) from push_receipts_pending)::int as pending
      `,
      // Users stats
      this.sql<Array<{ wallets: number; sessions: number; withSkr: number; avgRep: number }>>`
        select
          (select count(distinct wallet_address) from auth_sessions)::int as wallets,
          (select count(*) from auth_sessions where expires_at > now() and invalidated_at is null)::int as sessions,
          (select count(*) from wallet_skr_snapshots where balance_skr > 0)::int as "withSkr",
          0::int as "avgRep"
      `,
      // Boosts stats
      this.sql<Array<{ active: number; revenue24h: number; revenueAll: number }>>`
        select
          (select count(*) from content_boosts where ends_at > now() and status = 'active')::int as active,
          coalesce((select sum(amount_skr) from content_boosts where created_at >= now() - interval '24 hours'), 0)::bigint as revenue24h,
          coalesce((select sum(amount_skr) from content_boosts), 0)::bigint as "revenueAll"
      `,
      // Pipeline telemetry funnel (24h)
      this.sql<Array<{
        processed: number;
        relevanceFiltered: number;
        summarized: number;
        factPassed: number;
        factReview: number;
        factRejected: number;
        published: number;
      }>>`
        select
          count(*)::int as processed,
          count(*) filter (where relevance_passed = false)::int as "relevanceFiltered",
          count(*) filter (where relevance_passed = true)::int as summarized,
          count(*) filter (where fact_verdict = 'pass')::int as "factPassed",
          count(*) filter (where fact_verdict = 'review')::int as "factReview",
          count(*) filter (where fact_verdict = 'reject')::int as "factRejected",
          count(*) filter (where published = true)::int as published
        from pipeline_telemetry
        where created_at >= now() - interval '24 hours'
      `,
      // Cost breakdown by model
      this.sql<Array<{ purpose: string; model: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>>`
        select
          mr.purpose,
          mr.model,
          count(*)::int as calls,
          coalesce(sum(mr.input_tokens), 0)::bigint as "inputTokens",
          coalesce(sum(mr.output_tokens), 0)::bigint as "outputTokens",
          coalesce(
            sum(
              coalesce(mr.input_tokens, 0) * coalesce(om.pricing_prompt, 0) +
              coalesce(mr.output_tokens, 0) * coalesce(om.pricing_completion, 0)
            ),
            0
          )::float as "costUsd"
        from model_runs mr
        left join openrouter_models om on om.id = mr.model
        where mr.created_at >= now() - interval '24 hours'
        group by mr.purpose, mr.model
        order by "costUsd" desc
        limit 20
      `
    ]);

    const feed7d = feedExtRows[0]?.last7d ?? 0;
    const sources = sourcesRows[0] ?? { total: 0, active: 0, healthy: 0 };
    const preds = predictionsRows[0] ?? { active: 0, volume24h: 0, volumeAll: 0, resolved7d: 0, fees: 0 };
    const ops = opinionsRows[0] ?? { active: 0, votes24h: 0, avgParticipation: 0, resolved7d: 0 };
    const threats = threatsRows[0] ?? { published: 0, last24h: 0, submissions: 0, queued: 0 };
    const push = pushRows[0] ?? { registered: 0, active: 0, pending: 0 };
    const users = usersRows[0] ?? { wallets: 0, sessions: 0, withSkr: 0, avgRep: 0 };
    const boosts = boostsRows[0] ?? { active: 0, revenue24h: 0, revenueAll: 0 };
    const telem = telemetryRows[0] ?? { processed: 0, relevanceFiltered: 0, summarized: 0, factPassed: 0, factReview: 0, factRejected: 0, published: 0 };

    return {
      ...baseStats,
      feed: { ...baseStats.feed, last7d: feed7d },
      sources: {
        total: sources.total,
        active: sources.active,
        healthyLast24h: sources.healthy,
        articlesPerSource: articlesPerSourceRows.map(r => ({
          sourceId: r.sourceId,
          sourceName: r.sourceName,
          count: r.count
        }))
      },
      predictions: {
        activeMarkets: preds.active,
        totalVolumeLast24h: Number(preds.volume24h),
        totalVolumeAllTime: Number(preds.volumeAll),
        resolvedLast7d: preds.resolved7d,
        platformFeesCollected: Number(preds.fees)
      },
      opinions: {
        activePolls: ops.active,
        votesLast24h: ops.votes24h,
        avgParticipation: ops.avgParticipation,
        resolvedLast7d: ops.resolved7d
      },
      threats: {
        alertsPublished: threats.published,
        alertsLast24h: threats.last24h,
        communitySubmissions: threats.submissions,
        submissionsQueued: threats.queued
      },
      push: {
        registeredDevices: push.registered,
        activeDevices: push.active,
        pendingReceipts: push.pending
      },
      users: {
        uniqueWallets: users.wallets,
        activeSessions: users.sessions,
        walletsWithSkr: users.withSkr,
        avgChainRepScore: users.avgRep
      },
      boosts: {
        active: boosts.active,
        revenueSkrLast24h: Number(boosts.revenue24h),
        revenueSkrAllTime: Number(boosts.revenueAll)
      },
      telemetryFunnel: {
        processed: telem.processed,
        relevanceFiltered: telem.relevanceFiltered,
        summarized: telem.summarized,
        factCheckPassed: telem.factPassed,
        factCheckReview: telem.factReview,
        factCheckRejected: telem.factRejected,
        published: telem.published
      },
      costBreakdown: costRows.map(r => ({
        purpose: r.purpose,
        model: r.model,
        calls: r.calls,
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        estimatedCostUsd: Math.round(r.costUsd * 10000) / 10000
      }))
    };
  }

  async getSourceHealth(): Promise<SourceHealthRow[]> {
    const rows = await this.sql<Array<{
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
    }>>`
      select
        s.id as "sourceId",
        s.name as "sourceName",
        sp.active as "isActive",
        sp.last_success_at as "lastSuccessAt",
        sp.consecutive_failures as "consecutiveFailures",
        (select max(checked_at) from source_health_metrics where source_id = s.id) as "lastCheckAt",
        coalesce(
          (select avg(case when fetch_success then 1 else 0 end)::float * 100
           from source_health_metrics
           where source_id = s.id and checked_at >= now() - interval '24 hours'),
          100
        )::int as "successRateLast24h",
        coalesce(
          (select avg(fetch_latency_ms)::int
           from source_health_metrics
           where source_id = s.id and checked_at >= now() - interval '24 hours' and fetch_success = true),
          0
        ) as "avgLatencyMs",
        (select count(*)::int from feed_items where source_name = s.name and created_at >= now() - interval '24 hours') as "articlesPublishedLast24h",
        (select count(*)::int from feed_items where source_name = s.name) as "articlesPublishedTotal",
        (select error_message from source_health_metrics where source_id = s.id order by checked_at desc limit 1) as "lastError"
      from sources s
      join source_policies sp on sp.source_id = s.id
      where s.deleted_at is null
      order by s.name
    `;
    return rows;
  }

  async listSourcesAdmin(): Promise<Array<{ id: string; name: string; feedUrl: string; active: boolean }>> {
    const rows = await this.sql<Array<{ id: string; name: string; feedUrl: string; active: boolean }>>`
      select s.id, s.name, s.feed_url as "feedUrl", sp.active
      from sources s
      join source_policies sp on sp.source_id = s.id
      where s.deleted_at is null
      order by s.name
    `;
    return rows;
  }

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
  }>> {
    const rows = await this.sql<Array<{
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
    }>>`
      SELECT
        a.id::text AS id,
        a.wallet_address AS "walletAddress",
        a.company_name AS "companyName",
        a.website_url AS "websiteUrl",
        a.is_onboarded AS "isOnboarded",
        a.account_status AS "accountStatus",
        a.suspended_at::text AS "suspendedAt",
        a.suspension_reason AS "suspensionReason",
        a.created_at::text AS "createdAt",
        a.last_login_at::text AS "lastLoginAt",
        COUNT(sc.id)::int AS "campaignCount",
        COUNT(sc.id) FILTER (WHERE sc.is_active = true)::int AS "activeCampaignCount",
        COALESCE(SUM(sc.impression_count), 0)::int AS "impressionCount",
        COALESCE(SUM(sc.click_count), 0)::int AS "clickCount",
        COALESCE((
          SELECT COUNT(*)::int
          FROM sponsored_card_leads scl
          JOIN sponsored_cards sc2 ON sc2.id = scl.card_id
          WHERE sc2.advertiser_id = a.id
        ), 0)::int AS "leadCount",
        COALESCE(
          SUM(sc.billing_amount_usdc) FILTER (
            WHERE sc.billing_status = 'payment_required'
              AND sc.approval_status = 'approved'
          ),
          0
        )::int AS "pendingInvoiceUsdc",
        COALESCE((
          SELECT SUM(acp.amount_usdc)::int
          FROM advertiser_campaign_payments acp
          WHERE acp.advertiser_id = a.id
        ), 0)::int AS "collectedRevenueUsdc"
      FROM advertiser_accounts a
      LEFT JOIN sponsored_cards sc ON sc.advertiser_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
      LIMIT 500
    `;
    return rows;
  }

  async setAdvertiserAccountStatus(
    advertiserId: string,
    status: "active" | "suspended",
    reason?: string
  ): Promise<boolean> {
    return this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;
      const rows = await tx`
        UPDATE advertiser_accounts
        SET
          account_status = ${status},
          suspended_at = CASE WHEN ${status} = 'suspended' THEN now() ELSE NULL END,
          suspension_reason = CASE WHEN ${status} = 'suspended' THEN ${reason ?? null} ELSE NULL END
        WHERE id = ${advertiserId}
        RETURNING id
      `;
      if (rows.length === 0) {
        return false;
      }
      if (status === "suspended") {
        await tx`
          UPDATE advertiser_sessions
          SET invalidated_at = now()
          WHERE advertiser_id = ${advertiserId}
            AND invalidated_at IS NULL
        `;
      }
      return true;
    });
  }

  async setAdvertiserCampaignsActive(advertiserId: string, active: boolean): Promise<number> {
    const rows = await this.sql<Array<{ count: string }>>`
      WITH updated AS (
        UPDATE sponsored_cards
        SET is_active = ${active}
        WHERE advertiser_id = ${advertiserId}
          AND (
            ${active} = false
            OR (
              ends_at > now()
              AND approval_status = 'approved'
              AND billing_status IN ('not_required', 'paid')
            )
          )
        RETURNING id
      )
      SELECT COUNT(*)::text AS count FROM updated
    `;
    return Number.parseInt(rows[0]?.count ?? "0", 10);
  }

  async toggleSourceActive(sourceId: string, active: boolean): Promise<void> {
    await this.sql`
      update source_policies
      set active = ${active}
      where source_id = ${sourceId}
    `;
  }

  async createSource(input: {
    name: string;
    homepageUrl: string;
    feedUrl: string;
    languageHint?: string;
  }): Promise<{ id: string }> {
    const baseId = `src_${input.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 16)}`;
    const existing = await this.sql<Array<{ id: string }>>`
      SELECT id
      FROM sources
      WHERE id LIKE ${`${baseId}%`}
      LIMIT 5
    `;
    const id = existing.length === 0 ? baseId : `${baseId}_${Date.now().toString(36).slice(-4)}`;

    await this.sql`
      insert into sources (id, name, homepage_url, feed_url, language_hint)
      values (${id}, ${input.name}, ${input.homepageUrl}, ${input.feedUrl}, ${input.languageHint ?? "en"})
      on conflict (id) do update set
        name = excluded.name,
        homepage_url = excluded.homepage_url,
        feed_url = excluded.feed_url,
        language_hint = excluded.language_hint,
        updated_at = now(),
        deleted_at = null
    `;

    await this.sql`
      insert into source_policies (source_id, terms_url, allows_summary, allows_headline, allows_image, requires_link_back, ingest_type, active)
      values (${id}, ${input.homepageUrl + "/terms"}, true, true, true, true, 'rss', true)
      on conflict (source_id) do update set active = true
    `;

    return { id };
  }

  async deleteSource(sourceId: string): Promise<void> {
    // Soft delete - set deleted_at and deactivate (atomic: both must succeed or neither)
    await this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;
      await tx`UPDATE sources SET deleted_at = now() WHERE id = ${sourceId}`;
      await tx`UPDATE source_policies SET active = false WHERE source_id = ${sourceId}`;
    });
  }

  async recordSourceHealth(input: {
    sourceId: string;
    fetchSuccess: boolean;
    fetchLatencyMs?: number;
    articlesFound?: number;
    articlesPublished?: number;
    errorMessage?: string;
    httpStatus?: number;
  }): Promise<void> {
    await this.sql`
      insert into source_health_metrics (
        source_id, fetch_success, fetch_latency_ms,
        articles_found, articles_published, error_message, http_status
      ) values (
        ${input.sourceId},
        ${input.fetchSuccess},
        ${input.fetchLatencyMs ?? null},
        ${input.articlesFound ?? 0},
        ${input.articlesPublished ?? 0},
        ${input.errorMessage ?? null},
        ${input.httpStatus ?? null}
      )
    `;

    // Update consecutive failures counter
    if (input.fetchSuccess) {
      await this.sql`
        update source_policies
        set consecutive_failures = 0, last_success_at = now()
        where source_id = ${input.sourceId}
      `;
    } else {
      await this.sql`
        update source_policies
        set consecutive_failures = consecutive_failures + 1
        where source_id = ${input.sourceId}
      `;
    }
  }

  async consumeTxSignature(
    txSignature: string,
    purpose: "content_boost" | "prediction_stake" | "dispute_deposit",
    wallet: string
  ): Promise<"ok" | "already_used"> {
    try {
      await this.sql`
        insert into consumed_tx_signatures (tx_signature, wallet, purpose)
        values (${txSignature}, ${wallet}, ${purpose})
      `;
      return "ok";
    } catch (error: unknown) {
      // PostgreSQL unique_violation error code
      if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "23505") {
        return "already_used";
      }
      throw error;
    }
  }

  // ─── Prediction Markets ──────────────────────────────────────────────────────

  async listPredictionMarkets(input: {
    cursor?: string;
    limit?: number;
    status?: "active" | "resolved" | "cancelled";
    wallet?: string;
  }): Promise<{ items: PredictionMarket[]; nextCursor?: string }> {
    const limit = normalizePositiveInt(input.limit ?? 50, 1, 100);
    const decoded = decodeCursor(input.cursor);
    const walletForJoin = input.wallet ?? "";

    const rows = await this.sql<Array<PollRow & {
      isPrediction: boolean;
      minStakeSkr: number;
      maxStakeSkr: number;
      platformFeePct: number;
      yesPoolSkr: number | null;
      noPoolSkr: number | null;
      totalPoolSkr: number | null;
      yesStakers: number | null;
      noStakers: number | null;
    }>>`
      select
        op.id,
        op.question,
        op.article_context as "articleContext",
        op.yes_votes as "yesVotes",
        op.no_votes as "noVotes",
        op.total_votes as "totalVotes",
        to_char(op.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "deadlineAt",
        op.status,
        op.resolved_outcome as "resolvedOutcome",
        to_char(op.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "resolvedAt",
        op.resolution_source as "resolutionSource",
        COALESCE(op.dispute_freeze, false) as "disputeFreeze",
        op.is_prediction as "isPrediction",
        op.min_stake_skr as "minStakeSkr",
        op.max_stake_skr as "maxStakeSkr",
        op.platform_fee_pct as "platformFeePct",
        op.created_at::text as "createdAt",
        null::text as "userVote",
        null::text as "userVotedAt",
        pp.yes_pool_skr as "yesPoolSkr",
        pp.no_pool_skr as "noPoolSkr",
        pp.total_pool_skr as "totalPoolSkr",
        pp.yes_stakers as "yesStakers",
        pp.no_stakers as "noStakers"
      from opinion_polls op
      left join prediction_pools pp on pp.poll_id = op.id
      where op.is_prediction = true
        and (${input.status ?? null}::text is null or op.status = ${input.status ?? null}::text)
        and (
          ${decoded?.date ?? null}::timestamptz is null
          or (op.created_at, op.id) < (${decoded?.date ?? null}::timestamptz, ${decoded?.id ?? null}::text)
        )
      order by op.created_at desc, op.id desc
      limit ${limit + 1}
    `;

    const items: PredictionMarket[] = rows.slice(0, limit).map((row) => {
      const total = row.totalVotes || 1;
      const yesPool = Number(row.yesPoolSkr ?? 0);
      const noPool = Number(row.noPoolSkr ?? 0);
      const totalPool = yesPool + noPool || 1;

      return {
        id: row.id,
        question: row.question,
        articleContext: row.articleContext ?? undefined,
        yesVotes: row.yesVotes,
        noVotes: row.noVotes,
        totalVotes: row.totalVotes,
        yesPct: Math.round((row.yesVotes / total) * 100),
        noPct: Math.round((row.noVotes / total) * 100),
        deadlineAt: row.deadlineAt,
        status: row.status,
        resolvedOutcome: row.resolvedOutcome ?? undefined,
        resolvedAt: row.resolvedAt ?? undefined,
        resolutionSource: row.resolutionSource ?? undefined,
        disputeFreeze: row.disputeFreeze,
        createdAt: row.createdAt,
        userVote: row.userVote ?? undefined,
        userVotedAt: row.userVotedAt ?? undefined,
        isPrediction: true,
        minStakeSkr: row.minStakeSkr,
        maxStakeSkr: row.maxStakeSkr,
        platformFeePct: Number(row.platformFeePct),
        pool: {
          pollId: row.id,
          yesPoolSkr: yesPool,
          noPoolSkr: noPool,
          totalPoolSkr: yesPool + noPool,
          yesStakers: row.yesStakers ?? 0,
          noStakers: row.noStakers ?? 0,
          totalStakers: (row.yesStakers ?? 0) + (row.noStakers ?? 0),
          yesPct: Math.round((yesPool / totalPool) * 100),
          noPct: Math.round((noPool / totalPool) * 100),
          yesOdds: yesPool > 0 ? totalPool / yesPool : 0,
          noOdds: noPool > 0 ? totalPool / noPool : 0,
          updatedAt: new Date().toISOString()
        }
      };
    });

    const lastRow = rows.length > limit ? rows[limit - 1] : undefined;
    const nextCursor = lastRow
      ? encodeCursor(lastRow.createdAt, lastRow.id)
      : undefined;

    return { items, nextCursor };
  }

  async getPredictionMarketById(pollId: string, wallet?: string): Promise<PredictionMarket | null> {
    const walletForJoin = wallet ?? "";

    const rows = await this.sql<Array<PollRow & {
      isPrediction: boolean;
      minStakeSkr: number;
      maxStakeSkr: number;
      platformFeePct: number;
      yesPoolSkr: number | null;
      noPoolSkr: number | null;
      totalPoolSkr: number | null;
      yesStakers: number | null;
      noStakers: number | null;
    }>>`
      select
        op.id,
        op.question,
        op.article_context as "articleContext",
        op.yes_votes as "yesVotes",
        op.no_votes as "noVotes",
        op.total_votes as "totalVotes",
        to_char(op.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "deadlineAt",
        op.status,
        op.resolved_outcome as "resolvedOutcome",
        to_char(op.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "resolvedAt",
        op.resolution_source as "resolutionSource",
        COALESCE(op.dispute_freeze, false) as "disputeFreeze",
        op.is_prediction as "isPrediction",
        op.min_stake_skr as "minStakeSkr",
        op.max_stake_skr as "maxStakeSkr",
        op.platform_fee_pct as "platformFeePct",
        op.created_at::text as "createdAt",
        null::text as "userVote",
        null::text as "userVotedAt",
        pp.yes_pool_skr as "yesPoolSkr",
        pp.no_pool_skr as "noPoolSkr",
        pp.total_pool_skr as "totalPoolSkr",
        pp.yes_stakers as "yesStakers",
        pp.no_stakers as "noStakers"
      from opinion_polls op
      left join prediction_pools pp on pp.poll_id = op.id
      where op.id = ${pollId} and op.is_prediction = true
      limit 1
    `;

    const row = rows[0];
    if (!row) return null;

    const total = row.totalVotes || 1;
    const yesPool = Number(row.yesPoolSkr ?? 0);
    const noPool = Number(row.noPoolSkr ?? 0);
    const totalPool = yesPool + noPool || 1;

    // Get user's stakes if wallet provided
    let userStakes: PredictionStake[] = [];
    if (wallet) {
      const stakes = await this.sql<Array<{
        id: string;
        pollId: string;
        wallet: string;
        side: "yes" | "no";
        amountSkr: number;
        txSignature: string;
        status: string;
        payoutSkr: number | null;
        createdAt: string;
      }>>`
        select
          id::text,
          poll_id as "pollId",
          wallet,
          side,
          amount_skr::int as "amountSkr",
          tx_signature as "txSignature",
          status,
          payout_skr::int as "payoutSkr",
          created_at::text as "createdAt"
        from prediction_stakes
        where poll_id = ${pollId} and wallet = ${wallet}
        order by created_at desc
      `;
      userStakes = stakes.map((s) => ({
        id: s.id,
        pollId: s.pollId,
        wallet: s.wallet,
        side: s.side,
        amountSkr: s.amountSkr,
        txSignature: s.txSignature,
        status: s.status as PredictionStake["status"],
        payoutSkr: s.payoutSkr ?? undefined,
        createdAt: s.createdAt
      }));
    }

    return {
      id: row.id,
      question: row.question,
      articleContext: row.articleContext ?? undefined,
      yesVotes: row.yesVotes,
      noVotes: row.noVotes,
      totalVotes: row.totalVotes,
      yesPct: Math.round((row.yesVotes / total) * 100),
      noPct: Math.round((row.noVotes / total) * 100),
      deadlineAt: row.deadlineAt,
      status: row.status,
      resolvedOutcome: row.resolvedOutcome ?? undefined,
      resolvedAt: row.resolvedAt ?? undefined,
      resolutionSource: row.resolutionSource ?? undefined,
      disputeFreeze: row.disputeFreeze,
      createdAt: row.createdAt,
      userVote: row.userVote ?? undefined,
      userVotedAt: row.userVotedAt ?? undefined,
      isPrediction: true,
      minStakeSkr: row.minStakeSkr,
      maxStakeSkr: row.maxStakeSkr,
      platformFeePct: Number(row.platformFeePct),
      pool: {
        pollId: row.id,
        yesPoolSkr: yesPool,
        noPoolSkr: noPool,
        totalPoolSkr: yesPool + noPool,
        yesStakers: row.yesStakers ?? 0,
        noStakers: row.noStakers ?? 0,
        totalStakers: (row.yesStakers ?? 0) + (row.noStakers ?? 0),
        yesPct: Math.round((yesPool / totalPool) * 100),
        noPct: Math.round((noPool / totalPool) * 100),
        yesOdds: yesPool > 0 ? totalPool / yesPool : 0,
        noOdds: noPool > 0 ? totalPool / noPool : 0,
        updatedAt: new Date().toISOString()
      },
      userStakes: userStakes.length > 0 ? userStakes : undefined
    };
  }

  async getPredictionPool(pollId: string): Promise<PredictionPool | null> {
    const rows = await this.sql<Array<{
      pollId: string;
      yesPoolSkr: number;
      noPoolSkr: number;
      totalPoolSkr: number;
      yesStakers: number;
      noStakers: number;
      totalStakers: number;
      updatedAt: string;
    }>>`
      select
        poll_id as "pollId",
        yes_pool_skr::int as "yesPoolSkr",
        no_pool_skr::int as "noPoolSkr",
        total_pool_skr::int as "totalPoolSkr",
        yes_stakers as "yesStakers",
        no_stakers as "noStakers",
        total_stakers as "totalStakers",
        updated_at::text as "updatedAt"
      from prediction_pools
      where poll_id = ${pollId}
      limit 1
    `;

    const row = rows[0];
    if (!row) return null;
    const totalPool = row.totalPoolSkr || 1;

    return {
      pollId: row.pollId,
      yesPoolSkr: row.yesPoolSkr,
      noPoolSkr: row.noPoolSkr,
      totalPoolSkr: row.totalPoolSkr,
      yesStakers: row.yesStakers,
      noStakers: row.noStakers,
      totalStakers: row.totalStakers,
      yesPct: Math.round((row.yesPoolSkr / totalPool) * 100),
      noPct: Math.round((row.noPoolSkr / totalPool) * 100),
      yesOdds: row.yesPoolSkr > 0 ? totalPool / row.yesPoolSkr : 0,
      noOdds: row.noPoolSkr > 0 ? totalPool / row.noPoolSkr : 0,
      updatedAt: row.updatedAt
    };
  }

  async createPredictionStakePaymentIntent(input: {
    pollId: string;
    wallet: string;
    side: "yes" | "no";
    amountSkr: number;
  }): Promise<
    | { success: true; reservation: { id: string; expiresAt: string } }
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
  > {
    return this.sql.begin(async (txSql) => {
      const tx = txSql as unknown as postgres.Sql;
      const polls = await tx<Array<{
        status: string;
        minStakeSkr: number;
        maxStakeSkr: number;
        isExpired: boolean;
        reservationExpiresAt: string;
      }>>`
        SELECT
          status,
          COALESCE(min_stake_skr, 10)::int AS "minStakeSkr",
          COALESCE(max_stake_skr, 999999999)::int AS "maxStakeSkr",
          (deadline_at IS NOT NULL AND deadline_at <= now() + interval '90 seconds') AS "isExpired",
          (now() + (${STAKE_PAYMENT_INTENT_MS} * interval '1 millisecond'))::text AS "reservationExpiresAt"
        FROM opinion_polls
        WHERE id = ${input.pollId}
          AND is_prediction = true
        FOR UPDATE
      `;

      const poll = polls[0];
      if (!poll) {
        return { success: false, reason: "prediction_not_found" } as const;
      }
      if (poll.status !== "active" || poll.isExpired) {
        return { success: false, reason: "market_not_active" } as const;
      }
      if (input.amountSkr < poll.minStakeSkr) {
        return {
          success: false,
          reason: "stake_below_minimum",
          minStakeSkr: poll.minStakeSkr,
        } as const;
      }
      if (input.amountSkr > poll.maxStakeSkr) {
        return {
          success: false,
          reason: "stake_above_maximum",
          maxStakeSkr: poll.maxStakeSkr,
        } as const;
      }

      await tx`
        UPDATE payment_intents
        SET status = 'expired', updated_at = now()
        WHERE kind = 'prediction_stake'
          AND reference_type = 'poll'
          AND reference_id = ${input.pollId}
          AND wallet = ${input.wallet}
          AND status = 'pending'
          AND expires_at <= now()
      `;

      const existing = await tx<Array<{ id: string; expiresAt: string }>>`
        SELECT
          id::text as id,
          expires_at::text as "expiresAt"
        FROM payment_intents
        WHERE kind = 'prediction_stake'
          AND reference_type = 'poll'
          AND reference_id = ${input.pollId}
          AND wallet = ${input.wallet}
          AND status = 'pending'
          AND expires_at > now()
          AND expected_amount_skr = ${input.amountSkr}
          AND COALESCE(metadata->>'side', '') = ${input.side}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (existing[0]) {
        return {
          success: true,
          reservation: existing[0],
        } as const;
      }

      await tx`
        UPDATE payment_intents
        SET status = 'cancelled', updated_at = now()
        WHERE kind = 'prediction_stake'
          AND reference_type = 'poll'
          AND reference_id = ${input.pollId}
          AND wallet = ${input.wallet}
          AND status = 'pending'
          AND expires_at > now()
      `;

      const inserted = await tx<Array<{ id: string; expiresAt: string }>>`
        INSERT INTO payment_intents (
          wallet,
          kind,
          reference_type,
          reference_id,
          expected_amount_skr,
          metadata,
          expires_at
        )
        VALUES (
          ${input.wallet},
          'prediction_stake',
          'poll',
          ${input.pollId},
          ${input.amountSkr},
          ${JSON.stringify({ side: input.side })}::jsonb,
          ${poll.reservationExpiresAt}::timestamptz
        )
        RETURNING id::text as id, expires_at::text as "expiresAt"
      `;

      return {
        success: true,
        reservation: inserted[0]!,
      } as const;
    });
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
    const stakeId = randomUUID();

    return this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;
      const now = new Date();

      const polls = await tx<Array<{
        status: string;
        minStakeSkr: number;
        maxStakeSkr: number;
        isExpired: boolean;
      }>>`
        SELECT
          status,
          COALESCE(min_stake_skr, 10)::int AS "minStakeSkr",
          COALESCE(max_stake_skr, 999999999)::int AS "maxStakeSkr",
          (deadline_at IS NOT NULL AND deadline_at <= now()) AS "isExpired"
        FROM opinion_polls
        WHERE id = ${input.pollId}
          AND is_prediction = true
        FOR UPDATE
      `;

      const poll = polls[0];
      if (!poll) {
        return { success: false, reason: "prediction_not_found" } as const;
      }

      if (poll.status !== "active" || poll.isExpired) {
        return { success: false, reason: "market_not_active" } as const;
      }

      if (input.amountSkr < poll.minStakeSkr) {
        return {
          success: false,
          reason: "stake_below_minimum",
          minStakeSkr: poll.minStakeSkr,
        } as const;
      }

      if (input.amountSkr > poll.maxStakeSkr) {
        return {
          success: false,
          reason: "stake_above_maximum",
          maxStakeSkr: poll.maxStakeSkr,
        } as const;
      }

      if (input.paymentIntentId) {
        const intents = await tx<Array<{
          wallet: string;
          status: string;
          isExpired: boolean;
          expectedAmountSkr: number;
          referenceId: string;
        }>>`
          SELECT
            wallet,
            status,
            (expires_at <= now()) AS "isExpired",
            expected_amount_skr::int AS "expectedAmountSkr",
            reference_id AS "referenceId"
          FROM payment_intents
          WHERE id = ${input.paymentIntentId}::uuid
            AND kind = 'prediction_stake'
            AND reference_type = 'poll'
          FOR UPDATE
        `;
        const intent = intents[0];
        if (
          !intent ||
          intent.wallet !== input.wallet ||
          intent.referenceId !== input.pollId ||
          intent.expectedAmountSkr !== input.amountSkr ||
          intent.status !== "pending"
        ) {
          return { success: false, reason: "payment_intent_invalid" } as const;
        }
        if (intent.isExpired) {
          await tx`
            UPDATE payment_intents
            SET status = 'expired', updated_at = now()
            WHERE id = ${input.paymentIntentId}::uuid
              AND status = 'pending'
          `;
          return { success: false, reason: "payment_intent_expired" } as const;
        }
      }

      const consumeRows = await tx<Array<{ inserted: boolean }>>`
        INSERT INTO consumed_tx_signatures (tx_signature, purpose, wallet)
        VALUES (${input.txSignature}, 'prediction_stake', ${input.wallet})
        ON CONFLICT DO NOTHING
        RETURNING true AS inserted
      `;
      if (!consumeRows[0]?.inserted) {
        return { success: false, reason: "tx_already_used" } as const;
      }

      await tx`
        INSERT INTO prediction_stakes (
          id,
          poll_id,
          wallet,
          side,
          amount_skr,
          tx_signature,
          status
        )
        VALUES (
          ${stakeId},
          ${input.pollId},
          ${input.wallet},
          ${input.side},
          ${input.amountSkr},
          ${input.txSignature},
          'active'
        )
      `;

      // Count wallet's active stakes on this side (includes just-inserted row).
      // Only increment the unique-wallet staker counter if this is their FIRST stake on this side.
      const [sideCountRow] = await tx<Array<{ cnt: string }>>`
        SELECT COUNT(*)::text AS cnt
        FROM prediction_stakes
        WHERE poll_id = ${input.pollId}
          AND wallet = ${input.wallet}
          AND side = ${input.side}
          AND status = 'active'
      `;
      const isFirstStakeOnSide = Number(sideCountRow?.cnt ?? "1") <= 1;
      const stakerIncrement = isFirstStakeOnSide ? 1 : 0;

      await tx`
        INSERT INTO prediction_pools (poll_id, yes_pool_skr, no_pool_skr, yes_stakers, no_stakers, updated_at)
        VALUES (
          ${input.pollId},
          ${input.side === "yes" ? input.amountSkr : 0},
          ${input.side === "no" ? input.amountSkr : 0},
          ${input.side === "yes" ? stakerIncrement : 0},
          ${input.side === "no" ? stakerIncrement : 0},
          now()
        )
        ON CONFLICT (poll_id) DO UPDATE SET
          yes_pool_skr = prediction_pools.yes_pool_skr + ${input.side === "yes" ? input.amountSkr : 0},
          no_pool_skr = prediction_pools.no_pool_skr + ${input.side === "no" ? input.amountSkr : 0},
          yes_stakers = prediction_pools.yes_stakers + ${input.side === "yes" ? stakerIncrement : 0},
          no_stakers = prediction_pools.no_stakers + ${input.side === "no" ? stakerIncrement : 0},
          updated_at = now()
      `;

      if (input.paymentIntentId) {
        await tx`
          UPDATE payment_intents
          SET
            status = 'completed',
            tx_signature = ${input.txSignature},
            completed_at = now(),
            updated_at = now()
          WHERE id = ${input.paymentIntentId}::uuid
            AND status = 'pending'
        `;
      }

      const poolRows = await tx<Array<{
        yesPoolSkr: number;
        noPoolSkr: number;
        totalPoolSkr: number;
        yesStakers: number;
        noStakers: number;
        totalStakers: number;
        updatedAt: string;
      }>>`
        SELECT
          COALESCE(yes_pool_skr, 0)::int AS "yesPoolSkr",
          COALESCE(no_pool_skr, 0)::int AS "noPoolSkr",
          COALESCE(total_pool_skr, 0)::int AS "totalPoolSkr",
          COALESCE(yes_stakers, 0)::int AS "yesStakers",
          COALESCE(no_stakers, 0)::int AS "noStakers",
          COALESCE(total_stakers, 0)::int AS "totalStakers",
          updated_at::text AS "updatedAt"
        FROM prediction_pools
        WHERE poll_id = ${input.pollId}
        LIMIT 1
      `;

      const row = poolRows[0] ?? {
        yesPoolSkr: input.side === "yes" ? input.amountSkr : 0,
        noPoolSkr: input.side === "no" ? input.amountSkr : 0,
        totalPoolSkr: input.amountSkr,
        yesStakers: input.side === "yes" ? 1 : 0,
        noStakers: input.side === "no" ? 1 : 0,
        totalStakers: 1,
        updatedAt: now.toISOString(),
      };

      const totalPool = row.totalPoolSkr || row.yesPoolSkr + row.noPoolSkr || 1;
      const yourPool = input.side === "yes" ? row.yesPoolSkr : row.noPoolSkr;
      const potentialPayout = yourPool > 0 ? Math.round((input.amountSkr / yourPool) * totalPool * 1_000_000) / 1_000_000 : input.amountSkr;

      const receipt: PredictionStakeReceipt = {
        stakeId,
        pollId: input.pollId,
        side: input.side,
        amountSkr: input.amountSkr,
        pool: {
          pollId: input.pollId,
          yesPoolSkr: row.yesPoolSkr,
          noPoolSkr: row.noPoolSkr,
          totalPoolSkr: totalPool,
          yesStakers: row.yesStakers,
          noStakers: row.noStakers,
          totalStakers: row.totalStakers,
          yesPct: Math.round((row.yesPoolSkr / totalPool) * 100),
          noPct: Math.round((row.noPoolSkr / totalPool) * 100),
          yesOdds: row.yesPoolSkr > 0 ? totalPool / row.yesPoolSkr : 0,
          noOdds: row.noPoolSkr > 0 ? totalPool / row.noPoolSkr : 0,
          updatedAt: row.updatedAt,
        },
        potentialPayout,
        createdAt: now.toISOString(),
      };

      return { success: true, receipt } as const;
    });
  }

  async countOpenPredictionStakePaymentIntents(pollId: string): Promise<number> {
    const rows = await this.sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text as count
      FROM payment_intents
      WHERE kind = 'prediction_stake'
        AND reference_type = 'poll'
        AND reference_id = ${pollId}
        AND status = 'pending'
        AND expires_at > now()
    `;
    return Number.parseInt(rows[0]?.count ?? "0", 10);
  }

  async cashOutPredictionStake(stakeId: string, wallet: string): Promise<{
    stakeAmount: number;
    pollId: string;
    side: "yes" | "no";
  } | null | "below_minimum" | "in_progress"> {
    return await this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;

      // Lock the stake row and validate it
      const [stake] = await tx<Array<{
        id: string;
        poll_id: string;
        side: "yes" | "no";
        amount_skr: number;
        status: string;
      }>>`
        SELECT id, poll_id, side, amount_skr, status
        FROM prediction_stakes
        WHERE id = ${stakeId} AND wallet = ${wallet} AND status IN ('active', 'cashing_out')
        FOR UPDATE
      `;
      if (!stake) return null;
      if (stake.status === "cashing_out") {
        return "in_progress" as const;
      }

      // Verify poll is still active (not resolved) and lock it so settlement/cancel
      // cannot race this reservation.
      const [poll] = await tx<Array<{ id: string; status: string; resolvedOutcome: string | null }>>`
        SELECT
          id,
          status,
          resolved_outcome as "resolvedOutcome"
        FROM opinion_polls
        WHERE id = ${stake.poll_id}
        FOR UPDATE
      `;
      if (!poll) return null;
      if (poll.status !== "active" || poll.resolvedOutcome !== null) return null;

      // Check minimum stake amount — any valid stake (≥ min_stake_skr) is eligible for cashout.
      // We check the STAKE amount, not the post-fee amount, so 10 SKR → 9.5 SKR cashout is allowed.
      if (Number(stake.amount_skr) < 10) return "below_minimum" as const;

      // Reserve the cashout before moving money so the stake cannot settle/cancel underneath us.
      await tx`
        UPDATE prediction_stakes
        SET status = 'cashing_out',
            cashout_transfer_status = 'in_progress'
        WHERE id = ${stakeId}
      `;

      // Reduce pool aggregates — only decrement the unique-wallet staker counter if
      // this wallet has NO remaining active stakes on this side after this reservation.
      const [remainingRow] = await tx<Array<{ cnt: string }>>`
        SELECT COUNT(*)::text AS cnt
        FROM prediction_stakes
        WHERE poll_id = ${stake.poll_id}
          AND wallet = ${wallet}
          AND side = ${stake.side}
          AND status = 'active'
          AND id != ${stakeId}
      `;
      const isLastStakeOnSide = Number(remainingRow?.cnt ?? "0") === 0;
      const stakerDecrement = isLastStakeOnSide ? 1 : 0;

      if (stake.side === 'yes') {
        await tx`
          UPDATE prediction_pools
          SET yes_pool_skr = GREATEST(0, yes_pool_skr - ${stake.amount_skr}),
              yes_stakers = GREATEST(0, yes_stakers - ${stakerDecrement}),
              updated_at = now()
          WHERE poll_id = ${stake.poll_id}
        `;
      } else {
        await tx`
          UPDATE prediction_pools
          SET no_pool_skr = GREATEST(0, no_pool_skr - ${stake.amount_skr}),
              no_stakers = GREATEST(0, no_stakers - ${stakerDecrement}),
              updated_at = now()
          WHERE poll_id = ${stake.poll_id}
        `;
      }

      return {
        stakeAmount: Number(stake.amount_skr),
        pollId: stake.poll_id as string,
        side: stake.side as "yes" | "no",
      };
    });
  }

  async updateStakeCashoutTransfer(stakeId: string, wallet: string, txSignature: string | null, status: "complete" | "failed"): Promise<void> {
    await this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;

      const stakes = await tx<Array<{
        id: string;
        pollId: string;
        side: "yes" | "no";
        amountSkr: number;
      }>>`
        SELECT
          id::text as id,
          poll_id as "pollId",
          side,
          amount_skr::int as "amountSkr"
        FROM prediction_stakes
        WHERE id = ${stakeId}
          AND wallet = ${wallet}
          AND status = 'cashing_out'
        FOR UPDATE
      `;

      const stake = stakes[0];
      if (!stake) {
        return;
      }

      if (status === "complete") {
        await tx`
          UPDATE prediction_stakes
          SET status = 'cancelled',
              cashout_tx_signature = ${txSignature},
              cashout_transfer_status = 'complete'
          WHERE id = ${stakeId}
        `;
        return;
      }

      const polls = await tx<Array<{ status: string; resolvedOutcome: string | null }>>`
        SELECT
          status,
          resolved_outcome as "resolvedOutcome"
        FROM opinion_polls
        WHERE id = ${stake.pollId}
        FOR UPDATE
      `;
      const poll = polls[0];
      if (!poll || poll.status !== "active" || poll.resolvedOutcome !== null) {
        // Market was resolved during the cashout window. The on-chain transfer
        // failed, so no SKR left the platform wallet. Transition the stake to
        // its correct terminal status so it is never stuck at 'cashing_out'.
        const terminalStatus = (poll?.resolvedOutcome === stake.side) ? "won" : "lost";
        await tx`
          UPDATE prediction_stakes
          SET status = ${terminalStatus},
              cashout_tx_signature = null,
              cashout_transfer_status = 'failed'
          WHERE id = ${stakeId}
        `;
        // Restore pool amount (staker counters are not critical for a resolved market)
        if (stake.side === "yes") {
          await tx`
            UPDATE prediction_pools
            SET yes_pool_skr = yes_pool_skr + ${stake.amountSkr},
                updated_at = now()
            WHERE poll_id = ${stake.pollId}
          `;
        } else {
          await tx`
            UPDATE prediction_pools
            SET no_pool_skr = no_pool_skr + ${stake.amountSkr},
                updated_at = now()
            WHERE poll_id = ${stake.pollId}
          `;
        }
        return;
      }

      await tx`
        UPDATE prediction_stakes
        SET status = 'active',
            cashout_tx_signature = null,
            cashout_transfer_status = 'failed'
        WHERE id = ${stakeId}
      `;

      const [remainingRow] = await tx<Array<{ cnt: string }>>`
        SELECT COUNT(*)::text AS cnt
        FROM prediction_stakes
        WHERE poll_id = ${stake.pollId}
          AND wallet = ${wallet}
          AND side = ${stake.side}
          AND status = 'active'
          AND id != ${stakeId}
      `;
      const shouldIncrementStakers = Number(remainingRow?.cnt ?? "0") === 0 ? 1 : 0;

      if (stake.side === "yes") {
        await tx`
          UPDATE prediction_pools
          SET yes_pool_skr = yes_pool_skr + ${stake.amountSkr},
              yes_stakers = yes_stakers + ${shouldIncrementStakers},
              updated_at = now()
          WHERE poll_id = ${stake.pollId}
        `;
      } else {
        await tx`
          UPDATE prediction_pools
          SET no_pool_skr = no_pool_skr + ${stake.amountSkr},
              no_stakers = no_stakers + ${shouldIncrementStakers},
              updated_at = now()
          WHERE poll_id = ${stake.pollId}
        `;
      }
    });
  }

  async listUserPredictionStakes(wallet: string, limit?: number): Promise<PredictionUserPortfolio> {
    const maxLimit = normalizePositiveInt(limit ?? 100, 1, 500);

    // Single query with LEFT JOIN to prediction_payouts (fixes N+1)
    const stakes = await this.sql<Array<{
      id: string;
      pollId: string;
      wallet: string;
      side: "yes" | "no";
      amountSkr: number;
      txSignature: string;
      status: string;
      payoutSkr: number | null;
      createdAt: string;
      pollQuestion: string;
      pollStatus: string;
      pollDeadlineAt: string;
      pollResolvedOutcome: string | null;
      pollResolvedAt: string | null;
      yesPoolSkr: number | null;
      noPoolSkr: number | null;
      // Payout columns (joined)
      payoutId: string | null;
      payoutStakeSkr: number | null;
      payoutWinningsSkr: number | null;
      payoutPlatformFeeSkr: number | null;
      payoutNetPayoutSkr: number | null;
      payoutPayoutRatio: number | null;
      payoutStatus: string | null;
      payoutClaimableAt: string | null;
      payoutClaimDeadline: string | null;
      payoutClaimedAt: string | null;
      payoutTxSignature: string | null;
      payoutCreatedAt: string | null;
      cashoutTxSignature: string | null;
      cashoutTransferStatus: string | null;
      // Resolution columns (LATERAL JOIN)
      prReasoningText: string | null;
      prSources: unknown;
      prConsensusType: string | null;
      prConsensusConfidence: number | null;
      prResolverConfidence: number | null;
      prResolvedBy: string | null;
    }>>`
      select
        ps.id::text,
        ps.poll_id as "pollId",
        ps.wallet,
        ps.side,
        ps.amount_skr::int as "amountSkr",
        ps.tx_signature as "txSignature",
        ps.status,
        ps.payout_skr::int as "payoutSkr",
        ps.cashout_tx_signature as "cashoutTxSignature",
        ps.cashout_transfer_status as "cashoutTransferStatus",
        ps.created_at::text as "createdAt",
        op.question as "pollQuestion",
        op.status as "pollStatus",
        to_char(op.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "pollDeadlineAt",
        op.resolved_outcome as "pollResolvedOutcome",
        to_char(op.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "pollResolvedAt",
        pp.yes_pool_skr::int as "yesPoolSkr",
        pp.no_pool_skr::int as "noPoolSkr",
        -- Payout columns (LEFT JOIN)
        payout.id::text as "payoutId",
        payout.stake_skr::int as "payoutStakeSkr",
        payout.winnings_skr::int as "payoutWinningsSkr",
        payout.platform_fee_skr::int as "payoutPlatformFeeSkr",
        payout.net_payout_skr::int as "payoutNetPayoutSkr",
        payout.payout_ratio::float as "payoutPayoutRatio",
        payout.status as "payoutStatus",
        payout.claimable_at::text as "payoutClaimableAt",
        payout.claim_deadline::text as "payoutClaimDeadline",
        payout.claimed_at::text as "payoutClaimedAt",
        payout.tx_signature as "payoutTxSignature",
        payout.created_at::text as "payoutCreatedAt",
        -- Resolution columns (LATERAL JOIN — latest resolution for poll)
        pr.resolver_reasoning as "prReasoningText",
        pr.resolver_sources as "prSources",
        pr.consensus_type as "prConsensusType",
        pr.consensus_confidence::float as "prConsensusConfidence",
        pr.resolver_confidence::float as "prResolverConfidence",
        pr.resolved_by as "prResolvedBy"
      from prediction_stakes ps
      join opinion_polls op on op.id = ps.poll_id
      left join prediction_pools pp on pp.poll_id = ps.poll_id
      left join prediction_payouts payout on payout.stake_id = ps.id
      left join lateral (
        select resolver_reasoning, resolver_sources, consensus_type,
               consensus_confidence, resolver_confidence, resolved_by
        from prediction_resolutions
        where poll_id = ps.poll_id
        order by created_at desc
        limit 1
      ) pr on true
      where ps.wallet = ${wallet}
      order by ps.created_at desc
      limit ${maxLimit}
    `;

    const activeStakes: PredictionUserPortfolio["activeStakes"] = [];
    const resolvedStakes: PredictionUserPortfolio["resolvedStakes"] = [];
    let totalStakedSkr = 0;
    let totalWonSkr = 0;
    let totalLostSkr = 0;
    let pendingPayoutsSkr = 0;

    for (const s of stakes) {
      const poll: OpinionPoll = {
        id: s.pollId,
        question: s.pollQuestion,
        yesVotes: 0,
        noVotes: 0,
        totalVotes: 0,
        yesPct: 0,
        noPct: 0,
        deadlineAt: s.pollDeadlineAt,
        status: s.pollStatus as OpinionPoll["status"],
        resolvedOutcome: (s.pollResolvedOutcome as OpinionPoll["resolvedOutcome"]) ?? undefined,
        resolvedAt: s.pollResolvedAt ?? undefined,
        createdAt: s.createdAt
      };

      const yesPool = Number(s.yesPoolSkr ?? 0);
      const noPool = Number(s.noPoolSkr ?? 0);
      const totalPool = yesPool + noPool || 1;
      const yourPool = s.side === "yes" ? yesPool : noPool;
      const potentialPayout = yourPool > 0 ? Math.round((s.amountSkr / yourPool) * totalPool * 1_000_000) / 1_000_000 : s.amountSkr;

      const stake: PredictionStake = {
        id: s.id,
        pollId: s.pollId,
        wallet: s.wallet,
        side: s.side,
        amountSkr: s.amountSkr,
        txSignature: s.txSignature,
        status: s.status as PredictionStake["status"],
        payoutSkr: s.payoutSkr ?? undefined,
        cashoutTxSignature: s.cashoutTxSignature ?? undefined,
        cashoutTransferStatus: s.cashoutTransferStatus as PredictionStake["cashoutTransferStatus"] ?? undefined,
        createdAt: s.createdAt
      };

      // Track lifetime amount risked across all statuses. Wallet and portfolio
      // use this as an all-time "wagered/staked" metric, not just active exposure.
      totalStakedSkr += s.amountSkr;

      if (s.status === "active" || s.status === "cashing_out") {
        activeStakes.push({ ...stake, poll, potentialPayout });
      } else {
        // Use joined payout data (no N+1 query)
        let payout: PredictionPayout | undefined;
        if (s.payoutId) {
          payout = {
            id: s.payoutId,
            pollId: s.pollId,
            wallet: s.wallet,
            stakeId: s.id,
            stakeSkr: s.payoutStakeSkr ?? s.amountSkr,
            winningsSkr: s.payoutWinningsSkr ?? 0,
            platformFeeSkr: s.payoutPlatformFeeSkr ?? 0,
            netPayoutSkr: s.payoutNetPayoutSkr ?? 0,
            payoutRatio: s.payoutPayoutRatio ?? 0,
            status: (s.payoutStatus as PredictionPayout["status"]) ?? "pending",
            claimableAt: s.payoutClaimableAt ?? undefined,
            claimDeadline: s.payoutClaimDeadline ?? undefined,
            claimedAt: s.payoutClaimedAt ?? undefined,
            txSignature: s.payoutTxSignature ?? undefined,
            createdAt: s.payoutCreatedAt ?? s.createdAt
          };
        }

        if (payout?.status === "pending") {
          pendingPayoutsSkr += payout.netPayoutSkr;
        }

        if ((s.status === "won" || s.status === "claimed") && payout) {
          // Track winnings (profit) only; don't include principal stake in P&L.
          totalWonSkr += Math.max(0, payout.netPayoutSkr - payout.stakeSkr);
        } else if (s.status === "lost") {
          totalLostSkr += s.amountSkr;
        }

        // Build resolution summary from joined prediction_resolutions data
        let resolution: ResolutionSummary | undefined;
        if (s.pollResolvedOutcome && (s.prConsensusType || s.prResolverConfidence !== null)) {
          const consensus: "3/3" | "2/3" | "manual" =
            s.prConsensusType === "majority" ? "2/3" :
            (s.prResolvedBy?.startsWith("admin:") ? "manual" : "3/3");
          const confidence = s.prConsensusConfidence ?? s.prResolverConfidence ?? 0;
          const evidenceSources: Array<{ title: string; url: string }> = [];
          if (Array.isArray(s.prSources)) {
            for (const src of (s.prSources as unknown[]).slice(0, 3)) {
              if (typeof src === "string" && src.startsWith("http")) {
                try {
                  const u = new URL(src);
                  evidenceSources.push({ title: u.hostname.replace("www.", ""), url: src });
                } catch {
                  evidenceSources.push({ title: "Source", url: src });
                }
              }
            }
          }
          resolution = {
            outcome: s.pollResolvedOutcome as "yes" | "no",
            resolvedAt: s.pollResolvedAt ?? s.createdAt,
            consensus,
            agentAgreement: Math.round(confidence * 100),
            evidenceSources,
            reason: s.prReasoningText ?? undefined,
          };
        }

        resolvedStakes.push({ ...stake, poll, payout, resolution });
      }
    }

    return {
      activeStakes,
      resolvedStakes,
      totalStakedSkr,
      totalWonSkr,
      totalLostSkr,
      pendingPayoutsSkr
    };
  }

  async claimPredictionPayout(input: {
    payoutId: string;
    wallet: string;
  }): Promise<{
    success: boolean;
    reason?: "not_found" | "already_claimed" | "frozen" | "not_yet_claimable" | "transfer_in_progress";
    netPayoutSkr: number;
    claimableAt?: string;
  }> {
    // Check if poll is frozen due to pending dispute
    const frozenCheck = await this.sql<Array<{ frozen: boolean }>>`
      select op.dispute_freeze as "frozen"
      from prediction_payouts pp
      join opinion_polls op on op.id = pp.poll_id
      where pp.id = ${input.payoutId}::uuid
        and pp.wallet = ${input.wallet}
      limit 1
    `;
    if (frozenCheck[0]?.frozen) {
      return { success: false, reason: "frozen", netPayoutSkr: 0 };
    }

    const rows = await this.sql<Array<{ netPayoutSkr: number }>>`
      update prediction_payouts
      set transfer_status = 'in_progress',
          transferred_at = now(),
          transfer_error = null
      where id = ${input.payoutId}::uuid
        and wallet = ${input.wallet}
        and status = 'pending'
        and coalesce(claimable_at, now()) <= now()
        and (claim_deadline is null or claim_deadline > now())
        and transfer_status in ('pending', 'failed', 'manual_required')
        and not exists (
          select 1 from opinion_polls op
          where op.id = prediction_payouts.poll_id
            and op.dispute_freeze = true
        )
      returning net_payout_skr::int as "netPayoutSkr"
    `;

    const result = rows[0];
    if (!result) {
      const existing = await this.sql<Array<{
        status: string;
        transferStatus: string;
        claimableAt: string | null;
        transferredAt: string | null;
      }>>`
        select
          status,
          transfer_status as "transferStatus",
          claimable_at::text as "claimableAt",
          transferred_at::text as "transferredAt"
        from prediction_payouts
        where id = ${input.payoutId}::uuid
          and wallet = ${input.wallet}
        limit 1
      `;
      const existingRow = existing[0];
      if (existingRow?.status === "claimed") {
        return { success: false, reason: "already_claimed", netPayoutSkr: 0 };
      }
      const ts = existingRow?.transferStatus;
      if (ts === "completed") {
        return { success: false, reason: "already_claimed", netPayoutSkr: 0 };
      }
      if (ts === "in_progress") {
        return { success: false, reason: "transfer_in_progress", netPayoutSkr: 0 };
      }
      if (existingRow?.claimableAt && new Date(existingRow.claimableAt).getTime() > Date.now()) {
        return {
          success: false,
          reason: "not_yet_claimable",
          netPayoutSkr: 0,
          claimableAt: existingRow.claimableAt,
        };
      }
      return { success: false, reason: "not_found", netPayoutSkr: 0 };
    }

    return { success: true, netPayoutSkr: result.netPayoutSkr };
  }

  async recordPayoutTransfer(input: {
    payoutId: string;
    txSignature?: string | null;
    transferStatus?: "in_progress" | "completed" | "failed" | "manual_required";
  }): Promise<void> {
    const transferStatus = input.transferStatus ?? "completed";
    await this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;

      if (transferStatus === "manual_required") {
        const rows = await tx<Array<{ id: string }>>`
          UPDATE prediction_payouts
          SET transfer_status = 'manual_required',
              transfer_error = null,
              transfer_attempts = coalesce(transfer_attempts, 0) + 1
          WHERE id = ${input.payoutId}::uuid
            AND status = 'pending'
            AND transfer_status = 'in_progress'
          RETURNING id::text as id
        `;
        if (rows[0]) {
          return;
        }

        const existing = await tx<Array<{ status: string; transferStatus: string }>>`
          SELECT status, transfer_status as "transferStatus"
          FROM prediction_payouts
          WHERE id = ${input.payoutId}::uuid
          LIMIT 1
        `;
        if (existing[0]?.status === "pending" && existing[0].transferStatus === "manual_required") {
          return;
        }
        throw new Error("payout_not_in_progress");
      }

      const rows = await tx<Array<{ stakeId: string }>>`
        update prediction_payouts
        set status = 'claimed',
            claimed_at = coalesce(claimed_at, now()),
            tx_signature = coalesce(${input.txSignature ?? null}, tx_signature),
            transfer_status = ${transferStatus},
            transferred_at = case
              when ${transferStatus} = 'completed' then now()
              else transferred_at
            end,
            transfer_error = null
        where id = ${input.payoutId}::uuid
          and status = 'pending'
          and transfer_status = 'in_progress'
        returning stake_id::text as "stakeId"
      `;

      const row = rows[0];
      if (!row) {
        // Treat already-finalized claims as idempotent success.
        const existing = await tx<Array<{ status: string; transferStatus: string }>>`
          select status, transfer_status as "transferStatus"
          from prediction_payouts
          where id = ${input.payoutId}::uuid
          limit 1
        `;
        if (existing[0]?.status === "claimed" && ["completed", "manual_required"].includes(existing[0].transferStatus)) {
          return;
        }
        throw new Error("payout_not_in_progress");
      }

      await tx`
        update prediction_stakes
        set status = 'claimed'
        where id = ${row.stakeId}::uuid
          and status = 'won'
      `;
    });
  }

  async markPayoutTransferFailed(input: {
    payoutId: string;
    error: string;
  }): Promise<void> {
    await this.sql`
      UPDATE prediction_payouts
      SET transfer_status = 'failed',
          transfer_error = ${input.error},
          transfer_attempts = coalesce(transfer_attempts, 0) + 1
      WHERE id = ${input.payoutId}::uuid
        and transfer_status = 'in_progress'
    `;
  }

  async getPredictionRevenueSummary(): Promise<{
    totalFeeSkr: number;
    totalMarketsSettled: number;
    totalStakesSkr: number;
    totalPayoutsSkr: number;
    pendingPayoutsSkr: number;
    pendingPayoutsCount: number;
  }> {
    const [fees, stakes, payouts, pending] = await Promise.all([
      this.sql<Array<{ total: number; count: number }>>`
        SELECT coalesce(sum(total_fee_skr), 0)::int as total,
               count(*)::int as count
        FROM prediction_platform_fees
      `,
      this.sql<Array<{ total: number }>>`
        SELECT coalesce(sum(amount_skr), 0)::int as total
        FROM prediction_stakes
        WHERE status IN ('active', 'cashing_out', 'won', 'lost', 'claimed')
      `,
      this.sql<Array<{ total: number }>>`
        SELECT coalesce(sum(net_payout_skr), 0)::int as total
        FROM prediction_payouts
        WHERE status = 'claimed'
      `,
      this.sql<Array<{ total: number; count: number }>>`
        SELECT coalesce(sum(net_payout_skr), 0)::int as total,
               count(*)::int as count
        FROM prediction_payouts
        WHERE status = 'pending'
      `
    ]);

    return {
      totalFeeSkr: fees[0]?.total ?? 0,
      totalMarketsSettled: fees[0]?.count ?? 0,
      totalStakesSkr: stakes[0]?.total ?? 0,
      totalPayoutsSkr: payouts[0]?.total ?? 0,
      pendingPayoutsSkr: pending[0]?.total ?? 0,
      pendingPayoutsCount: pending[0]?.count ?? 0
    };
  }

  // ── OpenRouter Models ─────────────────────────────────────────────────────

  async getOpenRouterModels(): Promise<OpenRouterModel[]> {
    const rows = await this.sql<Array<{
      id: string;
      name: string;
      provider: string;
      contextLength: number | null;
      pricingPrompt: string;
      pricingCompletion: string;
      isFree: boolean;
      supportsTools: boolean;
      supportsVision: boolean;
      moderation: string | null;
      lastSyncedAt: string;
      createdAt: string;
    }>>`
      SELECT
        id,
        name,
        provider,
        context_length as "contextLength",
        pricing_prompt::text as "pricingPrompt",
        pricing_completion::text as "pricingCompletion",
        is_free as "isFree",
        supports_tools as "supportsTools",
        supports_vision as "supportsVision",
        moderation,
        last_synced_at::text as "lastSyncedAt",
        created_at::text as "createdAt"
      FROM openrouter_models
      ORDER BY is_free DESC, name ASC
    `;

    return rows.map(r => ({
      ...r,
      pricingPrompt: parseFloat(r.pricingPrompt) || 0,
      pricingCompletion: parseFloat(r.pricingCompletion) || 0
    }));
  }

  async syncOpenRouterModels(models: Array<{
    id: string;
    name: string;
    context_length?: number;
    pricing?: { prompt?: number; completion?: number };
    capabilities?: { tools?: boolean; vision?: boolean };
    moderation?: string;
  }>): Promise<number> {
    let synced = 0;

    for (const m of models) {
      const provider = m.id.split("/")[0] || "unknown";
      const isFree = (m.pricing?.prompt ?? 0) === 0 && (m.pricing?.completion ?? 0) === 0;

      await this.sql`
        INSERT INTO openrouter_models (
          id, name, provider, context_length,
          pricing_prompt, pricing_completion, is_free,
          supports_tools, supports_vision, moderation, last_synced_at
        ) VALUES (
          ${m.id}, ${m.name}, ${provider}, ${m.context_length ?? null},
          ${m.pricing?.prompt ?? 0}, ${m.pricing?.completion ?? 0}, ${isFree},
          ${m.capabilities?.tools ?? false}, ${m.capabilities?.vision ?? false},
          ${m.moderation ?? null}, now()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          context_length = EXCLUDED.context_length,
          pricing_prompt = EXCLUDED.pricing_prompt,
          pricing_completion = EXCLUDED.pricing_completion,
          is_free = EXCLUDED.is_free,
          supports_tools = EXCLUDED.supports_tools,
          supports_vision = EXCLUDED.supports_vision,
          moderation = EXCLUDED.moderation,
          last_synced_at = EXCLUDED.last_synced_at
      `;
      synced++;
    }

    // Update last sync timestamp
    await this.sql`
      UPDATE system_config
      SET value = ${new Date().toISOString()}, updated_at = now()
      WHERE key = 'openrouter_last_sync'
    `;

    return synced;
  }

  async getAgentModelConfig(): Promise<Record<string, string>> {
    const rows = await this.sql<Array<{ key: string; value: string }>>`
      SELECT key, value FROM system_config
      WHERE key LIKE 'agent_model_%'
    `;

    const config: Record<string, string> = {};
    for (const r of rows) {
      // Convert 'agent_model_relevance_filter' -> 'relevance_filter'
      const shortKey = r.key.replace("agent_model_", "");
      config[shortKey] = r.value;
    }
    return config;
  }

  // ── Prediction Leaderboard ─────────────────────────────────────────────────

  async getPredictionLeaderboard(opts: {
    period: "all" | "week" | "month";
    sortBy: "profit" | "winRate" | "volume";
    limit: number;
  }): Promise<LeaderboardEntry[]> {
    const rows = await this.sql<Array<{
      wallet: string;
      predictionCount: number;
      winRate: number;
      totalProfitSkr: number;
      rank: number;
    }>>`
      WITH stats AS (
        SELECT
          wallet,
          COUNT(*)::int as prediction_count,
          SUM(CASE WHEN status IN ('won', 'claimed') THEN 1 ELSE 0 END)::int as wins,
          SUM(CASE WHEN status IN ('won', 'claimed') THEN COALESCE(payout_skr, 0) - amount_skr ELSE -amount_skr END)::bigint as total_profit_skr
        FROM prediction_stakes ps
        WHERE status IN ('won', 'lost', 'claimed')
          AND (
            ${opts.period}::text = 'all'
            OR (${opts.period}::text = 'week' AND ps.created_at > now() - interval '7 days')
            OR (${opts.period}::text = 'month' AND ps.created_at > now() - interval '30 days')
          )
        GROUP BY wallet
        HAVING COUNT(*) >= 1
      ),
      ranked AS (
        SELECT
          wallet,
          prediction_count,
          wins,
          total_profit_skr,
          ROUND(100.0 * wins / prediction_count, 1)::float as win_rate
        FROM stats
      )
      SELECT
        wallet,
        prediction_count as "predictionCount",
        win_rate as "winRate",
        total_profit_skr::bigint as "totalProfitSkr",
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN ${opts.sortBy}::text = 'winRate' THEN win_rate END DESC NULLS LAST,
            CASE WHEN ${opts.sortBy}::text = 'volume' THEN prediction_count END DESC NULLS LAST,
            CASE WHEN ${opts.sortBy}::text = 'profit' THEN total_profit_skr END DESC NULLS LAST,
            total_profit_skr DESC
        )::int as rank
      FROM ranked
      ORDER BY
        CASE WHEN ${opts.sortBy}::text = 'winRate' THEN win_rate END DESC NULLS LAST,
        CASE WHEN ${opts.sortBy}::text = 'volume' THEN prediction_count END DESC NULLS LAST,
        CASE WHEN ${opts.sortBy}::text = 'profit' THEN total_profit_skr END DESC NULLS LAST,
        total_profit_skr DESC
      LIMIT ${opts.limit}
    `;

    return rows;
  }

  async getUserPredictionRank(wallet: string, period: "all" | "week" | "month", sortBy: "profit" | "winRate" | "volume"): Promise<UserRank | null> {
    const rows = await this.sql<Array<{
      rank: number;
      percentile: number;
      winRate: number;
      totalProfitSkr: number;
    }>>`
      WITH stats AS (
        SELECT
          wallet,
          COUNT(*)::int as prediction_count,
          SUM(CASE WHEN status IN ('won', 'claimed') THEN 1 ELSE 0 END)::int as wins,
          SUM(CASE WHEN status IN ('won', 'claimed') THEN COALESCE(payout_skr, 0) - amount_skr ELSE -amount_skr END)::bigint as total_profit_skr
        FROM prediction_stakes ps
        WHERE status IN ('won', 'lost', 'claimed')
          AND (
            ${period}::text = 'all'
            OR (${period}::text = 'week' AND ps.created_at > now() - interval '7 days')
            OR (${period}::text = 'month' AND ps.created_at > now() - interval '30 days')
          )
        GROUP BY wallet
        HAVING COUNT(*) >= 1
      ),
      with_winrate AS (
        SELECT *, ROUND(100.0 * wins / prediction_count, 1)::float as win_rate FROM stats
      ),
      ranked AS (
        SELECT
          wallet,
          prediction_count,
          wins,
          win_rate,
          total_profit_skr,
          ROW_NUMBER() OVER (
            ORDER BY
              CASE WHEN ${sortBy}::text = 'winRate' THEN win_rate END DESC NULLS LAST,
              CASE WHEN ${sortBy}::text = 'volume' THEN prediction_count END DESC NULLS LAST,
              CASE WHEN ${sortBy}::text = 'profit' THEN total_profit_skr END DESC NULLS LAST,
              total_profit_skr DESC
          )::int as rank,
          COUNT(*) OVER ()::int as total_users
        FROM with_winrate
      )
      SELECT
        rank,
        ROUND(100.0 * rank / total_users, 1)::float as percentile,
        win_rate::float as "winRate",
        total_profit_skr::bigint as "totalProfitSkr"
      FROM ranked
      WHERE wallet = ${wallet}
    `;

    return rows[0] ?? null;
  }

  async getActiveSponsoredCards(input?: { placement?: "feed" | "predict"; limit?: number }): Promise<Array<{
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
  }>> {
    const placementFilter = input?.placement ?? null;
    const maxRows = Math.max(1, Math.min(500, input?.limit ?? 10));
    const rows = await this.sql<Array<{
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
    }>>`
      SELECT
        id::text,
        advertiser_name AS "advertiserName",
        headline,
        body_text       AS "bodyText",
        image_url       AS "imageUrl",
        destination_url AS "destinationUrl",
        cta_text        AS "ctaText",
        accent_color    AS "accentColor",
        card_format     AS "cardFormat",
        placement       AS "placement",
        target_audience AS "targetAudience",
        campaign_goal   AS "campaignGoal",
        action_url      AS "actionUrl"
      FROM sponsored_cards
      WHERE is_active = true
        AND approval_status = 'approved'
        AND billing_status IN ('not_required', 'paid')
        AND starts_at <= now()
        AND ends_at > now()
        AND (
          ${placementFilter}::text IS NULL
          OR placement = 'both'
          OR placement = ${placementFilter}::text
        )
        AND (impression_limit IS NULL OR impression_count < impression_limit)
      ORDER BY impression_count ASC
      LIMIT ${maxRows}
    `;
    return rows;
  }

  async trackSponsoredEvent(cardId: string, type: "impression" | "click"): Promise<boolean> {
    const column = type === "impression" ? "impression_count" : "click_count";
    const impressionLimitClause =
      type === "impression"
        ? this.sql`AND (impression_limit IS NULL OR impression_count < impression_limit)`
        : this.sql``;
    const updated = await this.sql<Array<{ id: string }>>`
      UPDATE sponsored_cards
      SET ${this.sql(column)} = ${this.sql(column)} + 1
      WHERE id = ${cardId}
        AND is_active = true
        AND billing_status IN ('not_required', 'paid')
        AND starts_at <= now()
        AND ends_at > now()
        ${impressionLimitClause}
      RETURNING id::text
    `;
    if (!updated[0]) {
      return false;
    }
    await this.sql`
      INSERT INTO sponsored_card_events (card_id, event_type)
      VALUES (${cardId}, ${type})
    `;
    return true;
  }

  async optInSponsoredCardLead(cardId: string, walletAddress: string): Promise<boolean> {
    const inserted = await this.sql<Array<{ walletAddress: string }>>`
      INSERT INTO sponsored_card_leads (card_id, wallet_address)
      VALUES (${cardId}, ${walletAddress})
      ON CONFLICT (card_id, wallet_address) DO NOTHING
      RETURNING wallet_address as "walletAddress"
    `;
    return inserted.length > 0;
  }

  async getSponsoredCardLeadsCount(cardId: string): Promise<number> {
    const rows = await this.sql<Array<{ count: string }>>`
      SELECT count(*)::text as count
      FROM sponsored_card_leads
      WHERE card_id = ${cardId}
    `;
    return parseInt(rows[0]?.count ?? "0", 10);
  }

  async listSponsoredCards(): Promise<Array<{
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
  }>> {
    const rows = await this.sql<Array<{
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
    }>>`
      SELECT
        id::text,
        advertiser_name  AS "advertiserName",
        headline,
        body_text        AS "bodyText",
        image_url        AS "imageUrl",
        destination_url  AS "destinationUrl",
        cta_text         AS "ctaText",
        accent_color     AS "accentColor",
        card_format      AS "cardFormat",
        placement        AS "placement",
        target_audience  AS "targetAudience",
        campaign_goal    AS "campaignGoal",
        action_url       AS "actionUrl",
        starts_at        AS "startsAt",
        ends_at          AS "endsAt",
        impression_limit AS "impressionLimit",
        impression_count AS "impressionCount",
        click_count      AS "clickCount",
        (
          SELECT count(*)::int
          FROM sponsored_card_leads scl
          WHERE scl.card_id = sponsored_cards.id
        )               AS "leadCount",
        is_active        AS "isActive",
        approval_status  AS "approvalStatus",
        approved_at::text AS "approvedAt",
        approved_by      AS "approvedBy",
        rejection_reason AS "rejectionReason",
        billing_amount_usdc AS "billingAmountUsdc",
        billing_status   AS "billingStatus",
        payment_tx_signature AS "paymentTxSignature",
        payment_received_at::text AS "paymentReceivedAt",
        created_at       AS "createdAt"
      FROM sponsored_cards
      ORDER BY created_at DESC
      LIMIT 500
    `;
    return rows;
  }

  async createSponsoredCard(input: {
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
  }): Promise<string> {
    const rows = await this.sql<Array<{ id: string }>>`
      INSERT INTO sponsored_cards
        (advertiser_name, headline, body_text, image_url, destination_url,
         cta_text, accent_color, card_format, placement, target_audience, campaign_goal, action_url,
         starts_at, ends_at, impression_limit, approval_status, approved_at, approved_by, rejection_reason,
         billing_amount_usdc, billing_status)
      VALUES
        (${input.advertiserName}, ${input.headline}, ${input.bodyText},
         ${input.imageUrl ?? null}, ${input.destinationUrl}, ${input.ctaText},
         ${input.accentColor}, ${input.cardFormat ?? "classic"}, ${input.placement ?? "feed"}, ${input.targetAudience ?? "all"},
         ${input.campaignGoal ?? "traffic"}, ${input.actionUrl ?? null}, ${input.startsAt}, ${input.endsAt},
         ${input.impressionLimit ?? null}, 'approved', now(), 'admin', null, 0, 'not_required')
      RETURNING id::text
    `;
    return rows[0]!.id;
  }

  async deactivateSponsoredCard(id: string): Promise<boolean> {
    const rows = await this.sql`
      UPDATE sponsored_cards
      SET is_active = false, updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async setSponsoredCardActive(id: string, active: boolean): Promise<boolean> {
    const rows = await this.sql`
      UPDATE sponsored_cards
      SET is_active = ${active}, updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async reviewSponsoredCard(
    id: string,
    decision: "approve" | "reject",
    reviewer: string,
    reason?: string
  ): Promise<boolean> {
    const approvalStatus = decision === "approve" ? "approved" : "rejected";
    const rows = await this.sql`
      UPDATE sponsored_cards
      SET
        approval_status = ${approvalStatus},
        approved_at = CASE WHEN ${approvalStatus} = 'approved' THEN now() ELSE NULL END,
        approved_by = CASE WHEN ${approvalStatus} = 'approved' THEN ${reviewer} ELSE NULL END,
        rejection_reason = CASE WHEN ${approvalStatus} = 'rejected' THEN ${reason ?? null} ELSE NULL END,
        billing_status = CASE
          WHEN advertiser_id IS NULL THEN 'not_required'
          WHEN ${approvalStatus} = 'approved' THEN 'payment_required'
          ELSE 'approval_pending'
        END,
        is_active = CASE
          WHEN advertiser_id IS NULL AND ${approvalStatus} = 'approved' THEN is_active
          ELSE false
        END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `;
    return rows.length > 0;
  }

  // ── Advertiser Accounts ───────────────────────────────────────────────────

  async upsertAdvertiserByWallet(input: {
    walletAddress: string;
    email?: string;
  }): Promise<{ id: string; companyName: string | null; isOnboarded: boolean }> {
    const rows = await this.sql<{ id: string; company_name: string | null; is_onboarded: boolean }[]>`
      INSERT INTO advertiser_accounts (wallet_address, email)
      VALUES (${input.walletAddress}, ${input.email ?? null})
      ON CONFLICT (wallet_address) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, advertiser_accounts.email)
      RETURNING id::text, company_name, is_onboarded
    `;
    const row = rows[0]!;
    return { id: row.id, companyName: row.company_name, isOnboarded: row.is_onboarded };
  }

  async getAdvertiserById(id: string): Promise<{
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
  } | null> {
    const rows = await this.sql<Array<{
      id: string;
      email: string | null;
      wallet_address: string | null;
      company_name: string | null;
      website_url: string | null;
      is_onboarded: boolean;
      account_status: "active" | "suspended";
      suspended_at: Date | string | null;
      suspension_reason: string | null;
      created_at: Date | string;
      last_login_at: Date | string | null;
    }>>`
      SELECT
        id::text,
        email,
        wallet_address,
        company_name,
        website_url,
        is_onboarded,
        account_status,
        suspended_at,
        suspension_reason,
        created_at,
        last_login_at
      FROM advertiser_accounts
      WHERE id = ${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email ?? null,
      walletAddress: row.wallet_address ?? null,
      companyName: row.company_name ?? null,
      websiteUrl: row.website_url ?? null,
      isOnboarded: row.is_onboarded,
      accountStatus: row.account_status,
      suspendedAt: row.suspended_at ? (row.suspended_at instanceof Date ? row.suspended_at.toISOString() : String(row.suspended_at)) : null,
      suspensionReason: row.suspension_reason ?? null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      lastLoginAt: row.last_login_at ? (row.last_login_at instanceof Date ? row.last_login_at.toISOString() : String(row.last_login_at)) : null,
    };
  }

  async onboardAdvertiser(id: string, companyName: string, websiteUrl?: string): Promise<{
    id: string;
    companyName: string;
    isOnboarded: boolean;
  }> {
    const rows = await this.sql<Array<{ id: string; company_name: string; is_onboarded: boolean }>>`
      UPDATE advertiser_accounts
      SET
        company_name = ${companyName},
        website_url = ${websiteUrl ?? null},
        is_onboarded = true
      WHERE id = ${id}
      RETURNING id::text, company_name, is_onboarded
    `;
    const row = rows[0]!;
    return { id: row.id, companyName: row.company_name, isOnboarded: row.is_onboarded };
  }

  async updateAdvertiserLastLogin(id: string): Promise<void> {
    await this.sql`
      UPDATE advertiser_accounts SET last_login_at = now() WHERE id = ${id}
    `;
  }

  async createAdvertiserSession(advertiserId: string): Promise<{ sessionToken: string; expiresAt: string }> {
    const sessionToken = `adv_sess_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await this.sql`
      INSERT INTO advertiser_sessions (session_token, advertiser_id, expires_at)
      VALUES (${sessionToken}, ${advertiserId}, ${expiresAt})
    `;
    return { sessionToken, expiresAt };
  }

  async getAdvertiserSession(token: string): Promise<{ advertiserId: string } | null> {
    const rows = await this.sql<Array<{ advertiser_id: string }>>`
      SELECT advertiser_id::text
      FROM advertiser_sessions
      WHERE session_token = ${token}
        AND invalidated_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return { advertiserId: row.advertiser_id };
  }

  async invalidateAdvertiserSession(token: string): Promise<void> {
    await this.sql`
      UPDATE advertiser_sessions SET invalidated_at = now() WHERE session_token = ${token}
    `;
  }

  async createSponsoredCardForAdvertiser(advertiserId: string, input: {
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
  }): Promise<string> {
    const advertiserRows = await this.sql<Array<{
      companyName: string | null;
      walletAddress: string | null;
    }>>`
      SELECT
        company_name as "companyName",
        wallet_address as "walletAddress"
      FROM advertiser_accounts
      WHERE id = ${advertiserId}
      LIMIT 1
    `;
    const advertiser = advertiserRows[0];
    if (!advertiser) {
      throw new Error("advertiser_not_found");
    }

    const advertiserName =
      advertiser.companyName?.trim() ||
      (advertiser.walletAddress ? `Advertiser ${advertiser.walletAddress.slice(0, 6)}` : "Verified Advertiser");

    const rows = await this.sql<Array<{ id: string }>>`
      INSERT INTO sponsored_cards
        (advertiser_id, advertiser_name, headline, body_text, image_url, destination_url,
         cta_text, accent_color, card_format, placement, target_audience, campaign_goal, action_url,
         starts_at, ends_at, impression_limit, approval_status, approved_at, approved_by, rejection_reason,
         is_active, billing_amount_usdc, billing_status, payment_tx_signature, payment_received_at)
      VALUES
        (${advertiserId}, ${advertiserName}, ${input.headline}, ${input.bodyText},
         ${input.imageUrl ?? null}, ${input.destinationUrl}, ${input.ctaText},
         ${input.accentColor}, ${input.cardFormat}, ${input.placement}, ${input.targetAudience}, ${input.campaignGoal}, ${input.actionUrl ?? null},
         ${input.startsAt}, ${input.endsAt}, ${input.impressionLimit ?? null}, 'pending', null, null, null,
         false, ${input.billingAmountUsdc}, 'approval_pending', null, null)
      RETURNING id::text
    `;
    return rows[0]!.id;
  }

  async listSponsoredCardsByAdvertiser(advertiserId: string): Promise<Array<{
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
  }>> {
    interface SponsoredCardRow {
      id: string;
      advertiser_name: string;
      headline: string;
      body_text: string;
      image_url: string | null;
      destination_url: string;
      cta_text: string;
      accent_color: string;
      card_format: string;
      placement: "feed" | "predict" | "both";
      target_audience: string;
      campaign_goal: string;
      action_url: string | null;
      starts_at: Date | string;
      ends_at: Date | string;
      impression_limit: number | null;
      impression_count: number;
      click_count: number;
      lead_count: number;
      is_active: boolean;
      approval_status: "pending" | "approved" | "rejected";
      approved_at: Date | string | null;
      approved_by: string | null;
      rejection_reason: string | null;
      billing_amount_usdc: number;
      billing_status: "not_required" | "approval_pending" | "payment_required" | "paid";
      payment_tx_signature: string | null;
      payment_received_at: Date | string | null;
      created_at: Date | string;
    }
    const rows = await this.sql<SponsoredCardRow[]>`
      SELECT
        id::text,
        advertiser_name,
        headline,
        body_text,
        image_url,
        destination_url,
        cta_text,
        accent_color,
        card_format,
        placement,
        target_audience,
        campaign_goal,
        action_url,
        starts_at,
        ends_at,
        impression_limit,
        impression_count,
        click_count,
        (
          SELECT count(*)::int
          FROM sponsored_card_leads scl
          WHERE scl.card_id = sponsored_cards.id
        ) as lead_count,
        is_active,
        approval_status,
        approved_at,
        approved_by,
        rejection_reason,
        billing_amount_usdc,
        billing_status,
        payment_tx_signature,
        payment_received_at,
        created_at
      FROM sponsored_cards
      WHERE advertiser_id = ${advertiserId}
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return rows.map(row => ({
      id: row.id,
      advertiserName: row.advertiser_name,
      headline: row.headline,
      bodyText: row.body_text,
      imageUrl: row.image_url ?? null,
      destinationUrl: row.destination_url,
      ctaText: row.cta_text,
      accentColor: row.accent_color,
      cardFormat: row.card_format,
      placement: row.placement,
      targetAudience: row.target_audience,
      campaignGoal: row.campaign_goal,
      actionUrl: row.action_url ?? null,
      startsAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : String(row.starts_at),
      endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : String(row.ends_at),
      impressionLimit: row.impression_limit ?? null,
      impressionCount: row.impression_count,
      clickCount: row.click_count,
      leadCount: row.lead_count,
      isActive: row.is_active,
      approvalStatus: row.approval_status,
      approvedAt: row.approved_at ? (row.approved_at instanceof Date ? row.approved_at.toISOString() : String(row.approved_at)) : null,
      approvedBy: row.approved_by ?? null,
      rejectionReason: row.rejection_reason ?? null,
      billingAmountUsdc: row.billing_amount_usdc,
      billingStatus: row.billing_status,
      paymentTxSignature: row.payment_tx_signature ?? null,
      paymentReceivedAt: row.payment_received_at ? (row.payment_received_at instanceof Date ? row.payment_received_at.toISOString() : String(row.payment_received_at)) : null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  }

  async updateSponsoredCardForAdvertiser(advertiserId: string, cardId: string, input: {
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
  }): Promise<boolean> {
    const existingRows = await this.sql<Array<{
      headline: string;
      body_text: string;
      image_url: string | null;
      destination_url: string;
      cta_text: string;
      accent_color: string;
      card_format: string;
      placement: "feed" | "predict" | "both";
      target_audience: string;
      campaign_goal: string;
      action_url: string | null;
      starts_at: Date | string;
      ends_at: Date | string;
      impression_limit: number | null;
      billing_amount_usdc: number;
      billing_status: "not_required" | "approval_pending" | "payment_required" | "paid";
    }>>`
      SELECT
        headline,
        body_text,
        image_url,
        destination_url,
        cta_text,
        accent_color,
        card_format,
        placement,
        target_audience,
        campaign_goal,
        action_url,
        starts_at,
        ends_at,
        impression_limit,
        billing_amount_usdc,
        billing_status
      FROM sponsored_cards
      WHERE id = ${cardId}
        AND advertiser_id = ${advertiserId}
      LIMIT 1
    `;
    const current = existingRows[0];
    if (!current) {
      return false;
    }

    const rows = await this.sql`
      UPDATE sponsored_cards
      SET
        headline = ${input.headline ?? current.headline},
        body_text = ${input.bodyText ?? current.body_text},
        image_url = ${input.imageUrl !== undefined ? input.imageUrl : current.image_url},
        destination_url = ${input.destinationUrl ?? current.destination_url},
        cta_text = ${input.ctaText ?? current.cta_text},
        accent_color = ${input.accentColor ?? current.accent_color},
        card_format = ${input.cardFormat ?? current.card_format},
        placement = ${input.placement ?? current.placement},
        target_audience = ${input.targetAudience ?? current.target_audience},
        campaign_goal = ${input.campaignGoal ?? current.campaign_goal},
        action_url = ${input.actionUrl !== undefined ? input.actionUrl : current.action_url},
        starts_at = ${input.startsAt ?? current.starts_at},
        ends_at = ${input.endsAt ?? current.ends_at},
        impression_limit = ${input.impressionLimit !== undefined ? input.impressionLimit : current.impression_limit},
        billing_amount_usdc = ${input.billingAmountUsdc ?? current.billing_amount_usdc},
        approval_status = CASE WHEN billing_status = 'paid' THEN approval_status ELSE 'pending' END,
        approved_at = CASE WHEN billing_status = 'paid' THEN approved_at ELSE NULL END,
        approved_by = CASE WHEN billing_status = 'paid' THEN approved_by ELSE NULL END,
        rejection_reason = CASE WHEN billing_status = 'paid' THEN rejection_reason ELSE NULL END,
        billing_status = CASE WHEN billing_status = 'paid' THEN billing_status ELSE 'approval_pending' END,
        payment_tx_signature = CASE WHEN billing_status = 'paid' THEN payment_tx_signature ELSE NULL END,
        payment_received_at = CASE WHEN billing_status = 'paid' THEN payment_received_at ELSE NULL END,
        is_active = CASE WHEN billing_status = 'paid' THEN is_active ELSE false END,
        updated_at = now()
      WHERE id = ${cardId}
        AND advertiser_id = ${advertiserId}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async getSponsoredCardForAdvertiser(cardId: string, advertiserId: string): Promise<{
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
  } | null> {
    interface SponsoredCardDetailRow {
      id: string;
      advertiser_name: string;
      headline: string;
      body_text: string;
      image_url: string | null;
      destination_url: string;
      cta_text: string;
      accent_color: string;
      card_format: string;
      placement: "feed" | "predict" | "both";
      target_audience: string;
      campaign_goal: string;
      action_url: string | null;
      starts_at: Date | string;
      ends_at: Date | string;
      impression_limit: number | null;
      impression_count: number;
      click_count: number;
      lead_count: number;
      is_active: boolean;
      approval_status: "pending" | "approved" | "rejected";
      approved_at: Date | string | null;
      approved_by: string | null;
      rejection_reason: string | null;
      billing_amount_usdc: number;
      billing_status: "not_required" | "approval_pending" | "payment_required" | "paid";
      payment_tx_signature: string | null;
      payment_received_at: Date | string | null;
    }
    const rows = await this.sql<SponsoredCardDetailRow[]>`
      SELECT
        id::text,
        advertiser_name,
        headline,
        body_text,
        image_url,
        destination_url,
        cta_text,
        accent_color,
        card_format,
        placement,
        target_audience,
        campaign_goal,
        action_url,
        starts_at,
        ends_at,
        impression_limit,
        impression_count,
        click_count,
        (
          SELECT count(*)::int
          FROM sponsored_card_leads scl
          WHERE scl.card_id = sponsored_cards.id
        ) as lead_count,
        is_active,
        approval_status,
        approved_at,
        approved_by,
        rejection_reason,
        billing_amount_usdc,
        billing_status,
        payment_tx_signature,
        payment_received_at
      FROM sponsored_cards
      WHERE id = ${cardId}
        AND advertiser_id = ${advertiserId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      advertiserName: row.advertiser_name,
      headline: row.headline,
      bodyText: row.body_text,
      imageUrl: row.image_url ?? null,
      destinationUrl: row.destination_url,
      ctaText: row.cta_text,
      accentColor: row.accent_color,
      cardFormat: row.card_format,
      placement: row.placement,
      targetAudience: row.target_audience,
      campaignGoal: row.campaign_goal,
      actionUrl: row.action_url ?? null,
      startsAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : String(row.starts_at),
      endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : String(row.ends_at),
      impressionLimit: row.impression_limit ?? null,
      impressionCount: row.impression_count,
      clickCount: row.click_count,
      leadCount: row.lead_count,
      isActive: row.is_active,
      approvalStatus: row.approval_status,
      approvedAt: row.approved_at ? (row.approved_at instanceof Date ? row.approved_at.toISOString() : String(row.approved_at)) : null,
      approvedBy: row.approved_by ?? null,
      rejectionReason: row.rejection_reason ?? null,
      billingAmountUsdc: row.billing_amount_usdc,
      billingStatus: row.billing_status,
      paymentTxSignature: row.payment_tx_signature ?? null,
      paymentReceivedAt: row.payment_received_at ? (row.payment_received_at instanceof Date ? row.payment_received_at.toISOString() : String(row.payment_received_at)) : null,
    };
  }

  async setSponsoredCardActiveForAdvertiser(
    cardId: string,
    advertiserId: string,
    active: boolean
  ): Promise<boolean> {
    const rows = await this.sql`
      UPDATE sponsored_cards
      SET
        is_active = ${active},
        updated_at = now()
      WHERE id = ${cardId}
        AND advertiser_id = ${advertiserId}
        AND approval_status = 'approved'
        AND billing_status IN ('not_required', 'paid')
      RETURNING id
    `;
    return rows.length > 0;
  }

  async createAdvertiserCampaignPaymentIntent(input: {
    advertiserId: string;
    cardId: string;
  }): Promise<
    | {
        success: true;
        reservation: { id: string; expiresAt: string };
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
  > {
    return this.sql.begin(async (txSql) => {
      const tx = txSql as unknown as postgres.Sql;
      const currentRows = await tx<Array<{
        approvalStatus: "pending" | "approved" | "rejected";
        billingStatus: "not_required" | "approval_pending" | "payment_required" | "paid";
        billingAmountUsdc: number;
        reservationExpiresAt: string;
      }>>`
        SELECT
          approval_status AS "approvalStatus",
          billing_status AS "billingStatus",
          billing_amount_usdc AS "billingAmountUsdc",
          LEAST(
            ends_at,
            now() + (${ADVERTISER_PAYMENT_INTENT_MS} * interval '1 millisecond')
          )::text AS "reservationExpiresAt"
        FROM sponsored_cards
        WHERE id = ${input.cardId}
          AND advertiser_id = ${input.advertiserId}
        FOR UPDATE
      `;

      const current = currentRows[0];
      if (!current) {
        return { success: false as const, reason: "not_found" as const };
      }
      if (current.approvalStatus === "pending" || current.billingStatus === "approval_pending") {
        return { success: false as const, reason: "approval_pending" as const };
      }
      if (current.approvalStatus === "rejected") {
        return { success: false as const, reason: "campaign_rejected" as const };
      }
      if (current.billingStatus === "not_required") {
        return { success: false as const, reason: "payment_not_required" as const };
      }
      if (current.billingStatus === "paid") {
        return { success: false as const, reason: "already_paid" as const };
      }

      await tx`
        UPDATE payment_intents
        SET status = 'expired', updated_at = now()
        WHERE kind = 'advertiser_campaign'
          AND reference_type = 'campaign'
          AND reference_id = ${input.cardId}
          AND wallet = ${input.advertiserId}
          AND status = 'pending'
          AND expires_at <= now()
      `;

      const existing = await tx<Array<{ id: string; expiresAt: string }>>`
        SELECT id::text as id, expires_at::text as "expiresAt"
        FROM payment_intents
        WHERE kind = 'advertiser_campaign'
          AND reference_type = 'campaign'
          AND reference_id = ${input.cardId}
          AND wallet = ${input.advertiserId}
          AND status = 'pending'
          AND expires_at > now()
          AND expected_amount_skr = ${current.billingAmountUsdc}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (existing[0]) {
        return {
          success: true as const,
          reservation: existing[0],
          billingAmountUsdc: current.billingAmountUsdc,
        };
      }

      await tx`
        UPDATE payment_intents
        SET status = 'cancelled', updated_at = now()
        WHERE kind = 'advertiser_campaign'
          AND reference_type = 'campaign'
          AND reference_id = ${input.cardId}
          AND wallet = ${input.advertiserId}
          AND status = 'pending'
          AND expires_at > now()
      `;

      const inserted = await tx<Array<{ id: string; expiresAt: string }>>`
        INSERT INTO payment_intents (
          wallet,
          kind,
          reference_type,
          reference_id,
          expected_amount_skr,
          expires_at
        )
        VALUES (
          ${input.advertiserId},
          'advertiser_campaign',
          'campaign',
          ${input.cardId},
          ${current.billingAmountUsdc},
          ${current.reservationExpiresAt}::timestamptz
        )
        RETURNING id::text as id, expires_at::text as "expiresAt"
      `;

      return {
        success: true as const,
        reservation: inserted[0]!,
        billingAmountUsdc: current.billingAmountUsdc,
      };
    });
  }

  async recordSponsoredCampaignPayment(input: {
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
  > {
    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      const currentRows = await sql<Array<{
        approvalStatus: "pending" | "approved" | "rejected";
        billingStatus: "not_required" | "approval_pending" | "payment_required" | "paid";
        billingAmountUsdc: number;
      }>>`
        SELECT
          approval_status AS "approvalStatus",
          billing_status AS "billingStatus",
          billing_amount_usdc AS "billingAmountUsdc"
        FROM sponsored_cards
        WHERE id = ${input.cardId}
          AND advertiser_id = ${input.advertiserId}
        FOR UPDATE
      `;

      const current = currentRows[0];
      if (!current) {
        return { success: false as const, reason: "not_found" as const };
      }
      if (current.approvalStatus === "pending" || current.billingStatus === "approval_pending") {
        return { success: false as const, reason: "approval_pending" as const };
      }
      if (current.approvalStatus === "rejected") {
        return { success: false as const, reason: "campaign_rejected" as const };
      }
      if (current.billingStatus === "not_required") {
        return { success: false as const, reason: "payment_not_required" as const };
      }
      if (current.billingStatus === "paid") {
        return { success: false as const, reason: "already_paid" as const };
      }

      if (input.paymentIntentId) {
        const intents = await sql<Array<{
          wallet: string;
          status: string;
          isExpired: boolean;
          expectedAmountSkr: number;
          referenceId: string;
        }>>`
          SELECT
            wallet,
            status,
            (expires_at <= now()) AS "isExpired",
            expected_amount_skr::int AS "expectedAmountSkr",
            reference_id AS "referenceId"
          FROM payment_intents
          WHERE id = ${input.paymentIntentId}::uuid
            AND kind = 'advertiser_campaign'
            AND reference_type = 'campaign'
          FOR UPDATE
        `;
        const intent = intents[0];
        if (
          !intent ||
          intent.wallet !== input.advertiserId ||
          intent.referenceId !== input.cardId ||
          intent.expectedAmountSkr !== current.billingAmountUsdc ||
          intent.status !== "pending"
        ) {
          return { success: false as const, reason: "payment_intent_invalid" as const };
        }
        if (intent.isExpired) {
          await sql`
            UPDATE payment_intents
            SET status = 'expired', updated_at = now()
            WHERE id = ${input.paymentIntentId}::uuid
              AND status = 'pending'
          `;
          return { success: false as const, reason: "payment_intent_expired" as const };
        }
      }

      try {
        await sql`
          INSERT INTO advertiser_campaign_payments (advertiser_id, card_id, tx_signature, amount_usdc)
          VALUES (${input.advertiserId}, ${input.cardId}, ${input.txSignature}, ${current.billingAmountUsdc})
        `;
      } catch (error: unknown) {
        if ((error as { code?: string })?.code === "23505") {
          return { success: false as const, reason: "tx_already_used" as const };
        }
        throw error;
      }

      const updatedRows = await sql<Array<{ paymentReceivedAt: string }>>`
        UPDATE sponsored_cards
        SET
          billing_status = 'paid',
          payment_tx_signature = ${input.txSignature},
          payment_received_at = now(),
          is_active = CASE WHEN (ends_at IS NULL OR ends_at > now()) THEN true ELSE false END,
          updated_at = now()
        WHERE id = ${input.cardId}
          AND advertiser_id = ${input.advertiserId}
        RETURNING payment_received_at::text AS "paymentReceivedAt"
      `;

      if (input.paymentIntentId) {
        await sql`
          UPDATE payment_intents
          SET
            status = 'completed',
            tx_signature = ${input.txSignature},
            completed_at = now(),
            updated_at = now()
          WHERE id = ${input.paymentIntentId}::uuid
            AND status = 'pending'
        `;
      }

      return {
        success: true as const,
        paymentReceivedAt: updatedRows[0]?.paymentReceivedAt ?? new Date().toISOString(),
      };
    });
  }

  async listAdvertiserBillingRequests(advertiserId: string): Promise<Array<{
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
  }>> {
    const rows = await this.sql<Array<{
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
    }>>`
      SELECT
        abr.id::text AS id,
        abr.card_id::text AS "cardId",
        sc.headline AS headline,
        abr.request_type AS "requestType",
        abr.status AS status,
        abr.note AS note,
        abr.admin_note AS "adminNote",
        abr.resolved_by AS "resolvedBy",
        abr.created_at::text AS "createdAt",
        abr.updated_at::text AS "updatedAt",
        abr.resolved_at::text AS "resolvedAt"
      FROM advertiser_billing_requests abr
      JOIN sponsored_cards sc ON sc.id = abr.card_id
      WHERE abr.advertiser_id = ${advertiserId}
      ORDER BY abr.created_at DESC
    `;
    return rows;
  }

  async createAdvertiserBillingRequest(input: {
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
  > {
    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      const campaignRows = await sql<Array<{
        billingStatus: "not_required" | "approval_pending" | "payment_required" | "paid";
      }>>`
        SELECT billing_status AS "billingStatus"
        FROM sponsored_cards
        WHERE id = ${input.cardId}
          AND advertiser_id = ${input.advertiserId}
        FOR UPDATE
      `;
      const campaign = campaignRows[0];
      if (!campaign) {
        return { success: false as const, reason: "campaign_not_found" as const };
      }
      if (input.requestType === "refund_request" && campaign.billingStatus !== "paid") {
        return { success: false as const, reason: "refund_requires_paid_campaign" as const };
      }

      try {
        const rows = await sql<Array<{ id: string }>>`
          INSERT INTO advertiser_billing_requests (
            advertiser_id,
            card_id,
            request_type,
            status,
            note
          ) VALUES (
            ${input.advertiserId},
            ${input.cardId},
            ${input.requestType},
            'open',
            ${input.note}
          )
          RETURNING id::text
        `;
        return { success: true as const, requestId: rows[0]!.id };
      } catch (error: unknown) {
        if ((error as { code?: string })?.code === "23505") {
          return { success: false as const, reason: "request_already_open" as const };
        }
        throw error;
      }
    });
  }

  async listAdminAdvertiserBillingRequests(): Promise<Array<{
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
  }>> {
    const rows = await this.sql<Array<{
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
    }>>`
      SELECT
        abr.id::text AS id,
        abr.advertiser_id::text AS "advertiserId",
        COALESCE(a.company_name, sc.advertiser_name) AS "advertiserName",
        a.wallet_address AS "walletAddress",
        abr.card_id::text AS "cardId",
        sc.headline AS headline,
        abr.request_type AS "requestType",
        abr.status AS status,
        abr.note AS note,
        abr.admin_note AS "adminNote",
        abr.resolved_by AS "resolvedBy",
        abr.created_at::text AS "createdAt",
        abr.updated_at::text AS "updatedAt",
        abr.resolved_at::text AS "resolvedAt"
      FROM advertiser_billing_requests abr
      JOIN sponsored_cards sc ON sc.id = abr.card_id
      LEFT JOIN advertiser_accounts a ON a.id = abr.advertiser_id
      ORDER BY
        CASE abr.status
          WHEN 'open' THEN 0
          WHEN 'reviewing' THEN 1
          WHEN 'resolved' THEN 2
          ELSE 3
        END,
        abr.created_at DESC
    `;
    return rows;
  }

  async updateAdvertiserBillingRequestStatus(input: {
    requestId: string;
    status: "reviewing" | "resolved" | "rejected";
    adminNote?: string;
    resolvedBy: string;
  }): Promise<boolean> {
    const rows = await this.sql`
      UPDATE advertiser_billing_requests
      SET
        status = ${input.status},
        admin_note = ${input.adminNote ?? null},
        resolved_by = CASE
          WHEN ${input.status} IN ('resolved', 'rejected') THEN ${input.resolvedBy}
          ELSE NULL
        END,
        resolved_at = CASE
          WHEN ${input.status} IN ('resolved', 'rejected') THEN now()
          ELSE NULL
        END,
        updated_at = now()
      WHERE id = ${input.requestId}::uuid
        AND status IN ('open', 'reviewing')
      RETURNING id
    `;
    return rows.length > 0;
  }

  // ── Prediction Disputes ───────────────────────────────────────────────────

  async createPredictionDispute(input: {
    pollId: string;
    wallet: string;
    reason: string;
    evidenceUrls?: string[];
    depositSkr: number;
    depositTxSignature?: string;
  }): Promise<{ disputeId: string }> {
    const rows = await this.sql<Array<{ id: string }>>`
      INSERT INTO prediction_disputes (
        poll_id, wallet, reason, evidence_urls,
        deposit_skr, deposit_tx_signature
      ) VALUES (
        ${input.pollId},
        ${input.wallet},
        ${input.reason},
        ${JSON.stringify(input.evidenceUrls ?? [])}::jsonb,
        ${input.depositSkr},
        ${input.depositTxSignature ?? null}
      )
      RETURNING id::text
    `;
    const row = rows[0];
    if (!row) throw new Error("Failed to create dispute");
    return { disputeId: row.id };
  }

  async createPredictionDisputePaymentIntent(input: {
    pollId: string;
    wallet: string;
    depositSkr: number;
    challengeWindowHours?: number;
  }): Promise<
    | {
        success: true;
        reservation: { id: string; expiresAt: string };
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
  > {
    return this.sql.begin(async (txSql) => {
      const tx = txSql as unknown as postgres.Sql;
      const configuredWindow = Number.isFinite(input.challengeWindowHours)
        ? Math.trunc(input.challengeWindowHours as number)
        : 48;
      const challengeWindowHours = Math.max(1, Math.min(168, configuredWindow));

      const polls = await tx<Array<{
        status: string;
        resolvedAt: string | null;
        challengeDeadline: string | null;
        challengeWindowClosed: boolean;
        reservationExpiresAt: string | null;
      }>>`
        SELECT
          op.status,
          to_char(op.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "resolvedAt",
          COALESCE(
            (
              SELECT MIN(pp.claimable_at)
              FROM prediction_payouts pp
              WHERE pp.poll_id = op.id
            ),
            op.resolved_at + (${challengeWindowHours} * interval '1 hour')
          )::text AS "challengeDeadline",
          COALESCE(
            (
              SELECT MIN(pp.claimable_at)
              FROM prediction_payouts pp
              WHERE pp.poll_id = op.id
            ),
            op.resolved_at + (${challengeWindowHours} * interval '1 hour')
          ) <= now() AS "challengeWindowClosed",
          LEAST(
            COALESCE(
              (
                SELECT MIN(pp.claimable_at)
                FROM prediction_payouts pp
                WHERE pp.poll_id = op.id
              ),
              op.resolved_at + (${challengeWindowHours} * interval '1 hour')
            ),
            now() + (${DISPUTE_PAYMENT_INTENT_MS} * interval '1 millisecond')
          )::text AS "reservationExpiresAt"
        FROM opinion_polls op
        WHERE op.id = ${input.pollId}
          AND op.is_prediction = true
        FOR UPDATE
      `;

      const poll = polls[0];
      if (!poll) {
        return { success: false, reason: "poll_not_found" } as const;
      }
      if (poll.status !== "resolved" || !poll.resolvedAt || !poll.challengeDeadline || !poll.reservationExpiresAt) {
        return { success: false, reason: "poll_not_resolved" } as const;
      }
      if (poll.challengeWindowClosed) {
        return {
          success: false,
          reason: "challenge_window_closed",
          challengeDeadline: poll.challengeDeadline,
        } as const;
      }

      const existingDispute = await tx<Array<{ id: string }>>`
        SELECT id::text
        FROM prediction_disputes
        WHERE poll_id = ${input.pollId}
          AND wallet = ${input.wallet}
        LIMIT 1
      `;
      if (existingDispute[0]) {
        return { success: false, reason: "dispute_already_filed" } as const;
      }

      await tx`
        UPDATE payment_intents
        SET status = 'expired', updated_at = now()
        WHERE kind = 'dispute_deposit'
          AND reference_type = 'poll'
          AND reference_id = ${input.pollId}
          AND wallet = ${input.wallet}
          AND status = 'pending'
          AND expires_at <= now()
      `;

      const existingIntent = await tx<Array<{ id: string; expiresAt: string }>>`
        SELECT id::text as id, expires_at::text as "expiresAt"
        FROM payment_intents
        WHERE kind = 'dispute_deposit'
          AND reference_type = 'poll'
          AND reference_id = ${input.pollId}
          AND wallet = ${input.wallet}
          AND status = 'pending'
          AND expires_at > now()
          AND expected_amount_skr = ${input.depositSkr}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (existingIntent[0]) {
        return {
          success: true,
          reservation: existingIntent[0],
          challengeDeadline: poll.challengeDeadline,
        } as const;
      }

      await tx`
        UPDATE payment_intents
        SET status = 'cancelled', updated_at = now()
        WHERE kind = 'dispute_deposit'
          AND reference_type = 'poll'
          AND reference_id = ${input.pollId}
          AND wallet = ${input.wallet}
          AND status = 'pending'
          AND expires_at > now()
      `;

      const inserted = await tx<Array<{ id: string; expiresAt: string }>>`
        INSERT INTO payment_intents (
          wallet,
          kind,
          reference_type,
          reference_id,
          expected_amount_skr,
          metadata,
          expires_at
        )
        VALUES (
          ${input.wallet},
          'dispute_deposit',
          'poll',
          ${input.pollId},
          ${input.depositSkr},
          ${JSON.stringify({ challengeDeadline: poll.challengeDeadline })}::jsonb,
          ${poll.reservationExpiresAt}::timestamptz
        )
        RETURNING id::text as id, expires_at::text as "expiresAt"
      `;

      return {
        success: true,
        reservation: inserted[0]!,
        challengeDeadline: poll.challengeDeadline,
      } as const;
    });
  }

  async atomicCreatePredictionDispute(input: {
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
  > {
    return this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;
      const configuredWindow = Number.isFinite(input.challengeWindowHours)
        ? Math.trunc(input.challengeWindowHours as number)
        : 48;
      const challengeWindowHours = Math.max(1, Math.min(168, configuredWindow));

      const polls = await tx<Array<{
        status: string;
        resolvedAt: string | null;
        challengeDeadline: string | null;
        challengeWindowClosed: boolean;
      }>>`
        SELECT
          op.status,
          to_char(op.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "resolvedAt",
          COALESCE(
            (
              SELECT MIN(pp.claimable_at)
              FROM prediction_payouts pp
              WHERE pp.poll_id = op.id
            ),
            op.resolved_at + (${challengeWindowHours} * interval '1 hour')
          )::text AS "challengeDeadline",
          COALESCE(
            (
              SELECT MIN(pp.claimable_at)
              FROM prediction_payouts pp
              WHERE pp.poll_id = op.id
            ),
            op.resolved_at + (${challengeWindowHours} * interval '1 hour')
          ) <= now() AS "challengeWindowClosed"
        FROM opinion_polls op
        WHERE op.id = ${input.pollId}
          AND op.is_prediction = true
        FOR UPDATE
      `;

      const poll = polls[0];
      if (!poll) {
        return { success: false, reason: "poll_not_found" } as const;
      }

      if (poll.status !== "resolved" || !poll.resolvedAt || !poll.challengeDeadline) {
        return { success: false, reason: "poll_not_resolved" } as const;
      }

      if (poll.challengeWindowClosed) {
        return {
          success: false,
          reason: "challenge_window_closed",
          challengeDeadline: poll.challengeDeadline,
        } as const;
      }

      const existingDispute = await tx<Array<{ id: string }>>`
        SELECT id::text
        FROM prediction_disputes
        WHERE poll_id = ${input.pollId}
          AND wallet = ${input.wallet}
        LIMIT 1
      `;
      if (existingDispute[0]) {
        return { success: false, reason: "dispute_already_filed" } as const;
      }

      if (input.paymentIntentId) {
        const intents = await tx<Array<{
          wallet: string;
          status: string;
          isExpired: boolean;
          expectedAmountSkr: number;
          referenceId: string;
        }>>`
          SELECT
            wallet,
            status,
            (expires_at <= now()) AS "isExpired",
            expected_amount_skr::int AS "expectedAmountSkr",
            reference_id AS "referenceId"
          FROM payment_intents
          WHERE id = ${input.paymentIntentId}::uuid
            AND kind = 'dispute_deposit'
            AND reference_type = 'poll'
          FOR UPDATE
        `;
        const intent = intents[0];
        if (
          !intent ||
          intent.wallet !== input.wallet ||
          intent.referenceId !== input.pollId ||
          intent.expectedAmountSkr !== input.depositSkr ||
          intent.status !== "pending"
        ) {
          return { success: false, reason: "payment_intent_invalid" } as const;
        }
        if (intent.isExpired) {
          await tx`
            UPDATE payment_intents
            SET status = 'expired', updated_at = now()
            WHERE id = ${input.paymentIntentId}::uuid
              AND status = 'pending'
          `;
          return { success: false, reason: "payment_intent_expired" } as const;
        }
      }

      if (input.depositTxSignature) {
        const consumed = await tx<Array<{ inserted: boolean }>>`
          INSERT INTO consumed_tx_signatures (tx_signature, purpose, wallet)
          VALUES (${input.depositTxSignature}, 'dispute_deposit', ${input.wallet})
          ON CONFLICT DO NOTHING
          RETURNING true AS inserted
        `;
        if (!consumed[0]?.inserted) {
          return { success: false, reason: "tx_already_used" } as const;
        }
      }

      let inserted: Array<{ id: string; challengeDeadline: string }> = [];
      try {
        inserted = await tx<Array<{ id: string; challengeDeadline: string }>>`
          INSERT INTO prediction_disputes (
            poll_id,
            wallet,
            reason,
            evidence_urls,
            deposit_skr,
            deposit_tx_signature,
            challenge_deadline
          ) VALUES (
            ${input.pollId},
            ${input.wallet},
            ${input.reason},
            ${JSON.stringify(input.evidenceUrls ?? [])}::jsonb,
            ${input.depositSkr},
            ${input.depositTxSignature ?? null},
            ${poll.challengeDeadline}::timestamptz
          )
          RETURNING id::text, challenge_deadline::text AS "challengeDeadline"
        `;
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === "23505") {
          return { success: false, reason: "dispute_already_filed" } as const;
        }
        throw err;
      }

      const dispute = inserted[0];
      if (!dispute) {
        throw new Error("Failed to create dispute");
      }

      await tx`
        UPDATE opinion_polls
        SET dispute_freeze = true
        WHERE id = ${input.pollId}
      `;

      if (input.paymentIntentId) {
        await tx`
          UPDATE payment_intents
          SET
            status = 'completed',
            tx_signature = ${input.depositTxSignature ?? null},
            completed_at = now(),
            updated_at = now()
          WHERE id = ${input.paymentIntentId}::uuid
            AND status = 'pending'
        `;
      }

      return {
        success: true,
        disputeId: dispute.id,
        challengeDeadline: dispute.challengeDeadline,
      } as const;
    });
  }

  async listPredictionDisputes(pollId: string): Promise<PredictionDispute[]> {
    const rows = await this.sql<Array<{
      id: string;
      pollId: string;
      wallet: string;
      reason: string;
      evidenceUrls: string[];
      depositSkr: number;
      depositTxSignature: string | null;
      status: string;
      resolutionNote: string | null;
      resolvedBy: string | null;
      refundTxSignature: string | null;
      createdAt: string;
      resolvedAt: string | null;
      challengeDeadline: string;
    }>>`
      SELECT
        id::text,
        poll_id as "pollId",
        wallet,
        reason,
        evidence_urls as "evidenceUrls",
        deposit_skr::int as "depositSkr",
        deposit_tx_signature as "depositTxSignature",
        status,
        resolution_note as "resolutionNote",
        resolved_by as "resolvedBy",
        refund_tx_signature as "refundTxSignature",
        created_at::text as "createdAt",
        resolved_at::text as "resolvedAt",
        challenge_deadline::text as "challengeDeadline"
      FROM prediction_disputes
      WHERE poll_id = ${pollId}
      ORDER BY created_at DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      pollId: r.pollId,
      wallet: r.wallet,
      reason: r.reason,
      evidenceUrls: r.evidenceUrls ?? [],
      depositSkr: r.depositSkr,
      depositTxSignature: r.depositTxSignature ?? undefined,
      status: r.status as PredictionDispute["status"],
      resolutionNote: r.resolutionNote ?? undefined,
      resolvedBy: r.resolvedBy ?? undefined,
      refundTxSignature: r.refundTxSignature ?? undefined,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt ?? undefined,
      challengeDeadline: r.challengeDeadline,
    }));
  }

  async getPredictionDisputeForWallet(pollId: string, wallet: string): Promise<PredictionDispute | null> {
    const rows = await this.sql<Array<{
      id: string;
      pollId: string;
      wallet: string;
      reason: string;
      evidenceUrls: string[];
      depositSkr: number;
      depositTxSignature: string | null;
      status: string;
      resolutionNote: string | null;
      resolvedBy: string | null;
      refundTxSignature: string | null;
      createdAt: string;
      resolvedAt: string | null;
      challengeDeadline: string;
    }>>`
      SELECT
        id::text,
        poll_id as "pollId",
        wallet,
        reason,
        evidence_urls as "evidenceUrls",
        deposit_skr::int as "depositSkr",
        deposit_tx_signature as "depositTxSignature",
        status,
        resolution_note as "resolutionNote",
        resolved_by as "resolvedBy",
        refund_tx_signature as "refundTxSignature",
        created_at::text as "createdAt",
        resolved_at::text as "resolvedAt",
        challenge_deadline::text as "challengeDeadline"
      FROM prediction_disputes
      WHERE poll_id = ${pollId}
        AND wallet = ${wallet}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      pollId: row.pollId,
      wallet: row.wallet,
      reason: row.reason,
      evidenceUrls: row.evidenceUrls ?? [],
      depositSkr: row.depositSkr,
      depositTxSignature: row.depositTxSignature ?? undefined,
      status: row.status as PredictionDispute["status"],
      resolutionNote: row.resolutionNote ?? undefined,
      resolvedBy: row.resolvedBy ?? undefined,
      refundTxSignature: row.refundTxSignature ?? undefined,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt ?? undefined,
      challengeDeadline: row.challengeDeadline,
    };
  }

  async listAllDisputes(input: {
    status?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: PredictionDispute[]; nextCursor?: string }> {
    const limit = normalizePositiveInt(input.limit ?? 50, 1, 100);

    const rows = await this.sql<Array<{
      id: string;
      pollId: string;
      wallet: string;
      reason: string;
      evidenceUrls: string[];
      depositSkr: number;
      depositTxSignature: string | null;
      status: string;
      resolutionNote: string | null;
      resolvedBy: string | null;
      refundTxSignature: string | null;
      createdAt: string;
      resolvedAt: string | null;
      challengeDeadline: string;
    }>>`
      SELECT
        id::text,
        poll_id as "pollId",
        wallet,
        reason,
        evidence_urls as "evidenceUrls",
        deposit_skr::int as "depositSkr",
        deposit_tx_signature as "depositTxSignature",
        status,
        resolution_note as "resolutionNote",
        resolved_by as "resolvedBy",
        refund_tx_signature as "refundTxSignature",
        created_at::text as "createdAt",
        resolved_at::text as "resolvedAt",
        challenge_deadline::text as "challengeDeadline"
      FROM prediction_disputes
      WHERE (${input.status ?? null}::text IS NULL OR status = ${input.status ?? null})
        AND (${input.cursor ?? null}::timestamptz IS NULL OR created_at < ${input.cursor ?? null}::timestamptz)
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      id: r.id,
      pollId: r.pollId,
      wallet: r.wallet,
      reason: r.reason,
      evidenceUrls: r.evidenceUrls ?? [],
      depositSkr: r.depositSkr,
      depositTxSignature: r.depositTxSignature ?? undefined,
      status: r.status as PredictionDispute["status"],
      resolutionNote: r.resolutionNote ?? undefined,
      resolvedBy: r.resolvedBy ?? undefined,
      refundTxSignature: r.refundTxSignature ?? undefined,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt ?? undefined,
      challengeDeadline: r.challengeDeadline,
    }));

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]?.createdAt : undefined,
    };
  }

  async resolvePredictionDispute(input: {
    disputeId: string;
    verdict: "upheld" | "rejected";
    note: string;
    resolvedBy: string;
  }): Promise<{ refundRequired: boolean; walletAddress: string; depositSkr: number; pollId: string }> {
    return this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;

      const rows = await tx<Array<{ wallet: string; depositSkr: number; pollId: string }>>`
        UPDATE prediction_disputes
        SET status = ${input.verdict},
            resolution_note = ${input.note},
            resolved_by = ${input.resolvedBy},
            resolved_at = now()
        WHERE id = ${input.disputeId}::uuid
          AND status IN ('pending', 'investigating')
        RETURNING wallet, deposit_skr::int as "depositSkr", poll_id as "pollId"
      `;

      const row = rows[0];
      if (!row) {
        throw new Error("Dispute not found or already resolved");
      }

      await tx`
        UPDATE opinion_polls
        SET dispute_freeze = false
        WHERE id = ${row.pollId}
          AND NOT EXISTS (
            SELECT 1
            FROM prediction_disputes
            WHERE poll_id = ${row.pollId}
              AND status IN ('pending', 'investigating')
              AND id != ${input.disputeId}::uuid
          )
      `;

      return {
        refundRequired: input.verdict === "upheld",
        walletAddress: row.wallet,
        depositSkr: row.depositSkr,
        pollId: row.pollId,
      };
    });
  }

  async resetPollForReResolution(
    pollId: string,
    options?: { allowPendingDisputeId?: string }
  ): Promise<void> {
    await this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;

      await tx`
        SELECT id
        FROM opinion_polls
        WHERE id = ${pollId}
        FOR UPDATE
      `;

      if (options?.allowPendingDisputeId) {
        const otherDisputes = await tx<Array<{ count: string }>>`
          SELECT COUNT(*)::text as count
          FROM prediction_disputes
          WHERE poll_id = ${pollId}
            AND status IN ('pending', 'investigating')
            AND id != ${options.allowPendingDisputeId}::uuid
        `;
        if (Number(otherDisputes[0]?.count ?? 0) > 0) {
          throw new Error("other_disputes_pending");
        }
      }

      const claimedCountRows = await tx<Array<{ count: string }>>`
        SELECT COUNT(*)::text as count
        FROM prediction_payouts
        WHERE poll_id = ${pollId}
          AND status = 'claimed'
      `;
      if (Number(claimedCountRows[0]?.count ?? 0) > 0) {
        throw new Error("cannot_re_resolve_with_claimed_payouts");
      }

      await tx`
        UPDATE opinion_polls
        SET status = 'active',
            resolved_outcome = null,
            resolution_source = null,
            resolved_at = null,
            dispute_freeze = false
        WHERE id = ${pollId}
          AND is_prediction = true
      `;

      await tx`
        DELETE FROM prediction_payouts
        WHERE poll_id = ${pollId}
          AND status NOT IN ('claimed')
      `;

      await tx`
        UPDATE prediction_stakes
        SET status = 'active',
            payout_skr = null
        WHERE poll_id = ${pollId}
          AND status IN ('won', 'lost')
      `;
    });
  }

  async recordDisputeRefundTx(disputeId: string, txSignature: string): Promise<void> {
    await this.sql`
      UPDATE prediction_disputes
      SET refund_tx_signature = ${txSignature}
      WHERE id = ${disputeId}::uuid
    `;
  }

  async getPredictionDispute(disputeId: string): Promise<PredictionDispute | null> {
    const rows = await this.sql<Array<{
      id: string;
      pollId: string;
      wallet: string;
      reason: string;
      evidenceUrls: string[];
      depositSkr: number;
      depositTxSignature: string | null;
      status: string;
      resolutionNote: string | null;
      resolvedBy: string | null;
      refundTxSignature: string | null;
      createdAt: string;
      resolvedAt: string | null;
      challengeDeadline: string;
    }>>`
      SELECT
        id::text,
        poll_id as "pollId",
        wallet,
        reason,
        evidence_urls as "evidenceUrls",
        deposit_skr::int as "depositSkr",
        deposit_tx_signature as "depositTxSignature",
        status,
        resolution_note as "resolutionNote",
        resolved_by as "resolvedBy",
        refund_tx_signature as "refundTxSignature",
        created_at::text as "createdAt",
        resolved_at::text as "resolvedAt",
        challenge_deadline::text as "challengeDeadline"
      FROM prediction_disputes
      WHERE id = ${disputeId}::uuid
      LIMIT 1
    `;

    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      pollId: r.pollId,
      wallet: r.wallet,
      reason: r.reason,
      evidenceUrls: r.evidenceUrls ?? [],
      depositSkr: r.depositSkr,
      depositTxSignature: r.depositTxSignature ?? undefined,
      status: r.status as PredictionDispute["status"],
      resolutionNote: r.resolutionNote ?? undefined,
      resolvedBy: r.resolvedBy ?? undefined,
      refundTxSignature: r.refundTxSignature ?? undefined,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt ?? undefined,
      challengeDeadline: r.challengeDeadline,
    };
  }

  async getDisputeForPollAndWallet(pollId: string, wallet: string): Promise<{ id: string; status: string } | null> {
    const rows = await this.sql<Array<{ id: string; status: string }>>`
      SELECT id::text, status
      FROM prediction_disputes
      WHERE poll_id = ${pollId}
        AND wallet = ${wallet}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async freezePollPayouts(pollId: string, freeze: boolean): Promise<void> {
    await this.sql`
      UPDATE opinion_polls
      SET dispute_freeze = ${freeze}
      WHERE id = ${pollId}
    `;
  }

  async atomicUpdateDisputeStatusAndFreeze(
    disputeId: string,
    status: "investigating",
    freezePoll: boolean
  ): Promise<{ pollId: string } | null> {
    return this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;
      const rows = await tx<Array<{ pollId: string }>>`
        UPDATE prediction_disputes
        SET status = ${status}
        WHERE id = ${disputeId}::uuid
          AND status IN ('pending', 'investigating')
        RETURNING poll_id::text as "pollId"
      `;
      if (!rows[0]) {
        return null;
      }
      if (freezePoll) {
        await tx`
          UPDATE opinion_polls
          SET dispute_freeze = true
          WHERE id = ${rows[0].pollId}::uuid
        `;
      }
      return rows[0];
    });
  }

  // ── Admin Prediction Management ──────────────────────────────────────────

  async listAllPredictionMarkets(input: {
    status?: "active" | "resolved" | "cancelled";
    cursor?: string;
    limit?: number;
  }): Promise<{ items: AdminPredictionMarket[]; nextCursor?: string }> {
    const limit = normalizePositiveInt(input.limit ?? 50, 1, 100);
    const decoded = decodeCursor(input.cursor);

    const rows = await this.sql<Array<{
      id: string;
      question: string;
      status: "active" | "resolved" | "cancelled";
      resolvedOutcome: "yes" | "no" | null;
      yesPoolSkr: number;
      noPoolSkr: number;
      totalPoolSkr: number;
      stakersCount: number;
      deadlineAt: string;
      createdAt: string;
      resolvedAt: string | null;
      aiGenerated: boolean;
      disputeFreeze: boolean;
      minStakeSkr: number;
      maxStakeSkr: number;
      platformFeePct: string;
    }>>`
      SELECT
        op.id,
        op.question,
        op.status,
        op.resolved_outcome as "resolvedOutcome",
        COALESCE(pp.yes_pool_skr, 0)::int as "yesPoolSkr",
        COALESCE(pp.no_pool_skr, 0)::int as "noPoolSkr",
        COALESCE(pp.total_pool_skr, 0)::int as "totalPoolSkr",
        COALESCE(pp.total_stakers, 0)::int as "stakersCount",
        to_char(op.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "deadlineAt",
        op.created_at::text as "createdAt",
        to_char(op.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "resolvedAt",
        COALESCE(op.ai_generated, false) as "aiGenerated",
        COALESCE(op.dispute_freeze, false) as "disputeFreeze",
        op.min_stake_skr as "minStakeSkr",
        op.max_stake_skr as "maxStakeSkr",
        op.platform_fee_pct::text as "platformFeePct"
      FROM opinion_polls op
      LEFT JOIN prediction_pools pp ON pp.poll_id = op.id
      WHERE op.is_prediction = true
        AND (${input.status ?? null}::text IS NULL OR op.status = ${input.status ?? null}::text)
        AND (
          ${decoded?.date ?? null}::timestamptz IS NULL
          OR (op.created_at, op.id) < (${decoded?.date ?? null}::timestamptz, ${decoded?.id ?? null}::text)
        )
      ORDER BY op.created_at DESC, op.id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row): AdminPredictionMarket => ({
      id: row.id,
      question: row.question,
      status: row.status,
      resolvedOutcome: row.resolvedOutcome ?? undefined,
      yesPoolSkr: row.yesPoolSkr,
      noPoolSkr: row.noPoolSkr,
      totalPoolSkr: row.totalPoolSkr,
      stakersCount: row.stakersCount,
      deadlineAt: row.deadlineAt,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt ?? undefined,
      aiGenerated: row.aiGenerated,
      disputeFreeze: row.disputeFreeze,
      minStakeSkr: row.minStakeSkr,
      maxStakeSkr: row.maxStakeSkr,
      platformFeePct: parseFloat(row.platformFeePct)
    }));

    return {
      items,
      nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id) : undefined
    };
  }

  async cancelPredictionMarket(pollId: string, reason: string): Promise<{
    stakesRefunded: number;
    totalRefundSkr: number;
  }> {
    let stakesRefunded = 0;
    let totalRefundSkr = 0;

    await this.sql.begin(async (txSql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = txSql as unknown as postgres.Sql;

      const pendingIntentRows = await tx<Array<{ count: string }>>`
        SELECT COUNT(*)::text as count
        FROM payment_intents
        WHERE kind = 'prediction_stake'
          AND reference_type = 'poll'
          AND reference_id = ${pollId}
          AND status = 'pending'
          AND expires_at > now()
      `;
      if (Number.parseInt(pendingIntentRows[0]?.count ?? "0", 10) > 0) {
        throw new Error("pending_payment_intents");
      }

      const pendingCashoutRows = await tx<Array<{ count: string }>>`
        SELECT COUNT(*)::text as count
        FROM prediction_stakes
        WHERE poll_id = ${pollId}
          AND status = 'cashing_out'
      `;
      if (Number.parseInt(pendingCashoutRows[0]?.count ?? "0", 10) > 0) {
        throw new Error("pending_cashouts");
      }

      const pollRows = await tx<Array<{ id: string }>>`
        UPDATE opinion_polls
        SET status = 'cancelled',
            resolution_source = ${`admin_cancel: ${reason}`},
            resolved_at = now()
        WHERE id = ${pollId}
          AND status = 'active'
        RETURNING id::text AS id
      `;
      if (!pollRows[0]) {
        throw new Error("market_not_active");
      }

      // Get all active stakes to refund
      const stakes = await tx<Array<{ id: string; wallet: string; amountSkr: number }>>`
        UPDATE prediction_stakes
        SET status = 'cancelled',
            payout_skr = amount_skr
        WHERE poll_id = ${pollId}
          AND status = 'active'
        RETURNING id::text, wallet, amount_skr::int as "amountSkr"
      `;

      stakesRefunded = stakes.length;
      totalRefundSkr = stakes.reduce((sum, s) => sum + s.amountSkr, 0);

      // Create refund payout records for each stake
      for (const stake of stakes) {
        await tx`
          INSERT INTO prediction_payouts (
            poll_id, wallet, stake_id, stake_skr, winnings_skr,
            platform_fee_skr, net_payout_skr, payout_ratio, status, claim_deadline
          ) VALUES (
            ${pollId}, ${stake.wallet}, ${stake.id}::uuid, ${stake.amountSkr}, 0,
            0, ${stake.amountSkr}, 1.0, 'pending', (now() + interval '365 days')
          )
          ON CONFLICT (stake_id) DO NOTHING
        `;
      }
    });

    return { stakesRefunded, totalRefundSkr };
  }

  async updatePredictionMarketLimits(pollId: string, minStakeSkr: number, maxStakeSkr: number): Promise<void> {
    await this.sql`
      UPDATE opinion_polls
      SET min_stake_skr = ${minStakeSkr},
          max_stake_skr = ${maxStakeSkr}
      WHERE id = ${pollId}
        AND is_prediction = true
    `;
  }

  async getResolutionDetails(pollId: string): Promise<PredictionResolutionDetails | null> {
    const rows = await this.sql<Array<{
      pollId: string;
      agent1Model: string | null;
      agent1Outcome: string | null;
      agent1Confidence: string | null;
      agent1Reasoning: string | null;
      agent2Model: string | null;
      agent2Outcome: string | null;
      agent2Confidence: string | null;
      agent2Reasoning: string | null;
      agent3Model: string | null;
      agent3Outcome: string | null;
      agent3Confidence: string | null;
      agent3Reasoning: string | null;
      consensusOutcome: string | null;
      consensusConfidence: string | null;
      consensusType: string | null;
      resolutionMethod: string | null;
      finalOutcome: string | null;
      resolvedBy: string | null;
      resolvedAt: string | null;
    }>>`
      SELECT
        poll_id as "pollId",
        agent1_model as "agent1Model",
        agent1_outcome as "agent1Outcome",
        agent1_confidence::text as "agent1Confidence",
        agent1_reasoning as "agent1Reasoning",
        agent2_model as "agent2Model",
        agent2_outcome as "agent2Outcome",
        agent2_confidence::text as "agent2Confidence",
        agent2_reasoning as "agent2Reasoning",
        agent3_model as "agent3Model",
        agent3_outcome as "agent3Outcome",
        agent3_confidence::text as "agent3Confidence",
        agent3_reasoning as "agent3Reasoning",
        consensus_outcome as "consensusOutcome",
        consensus_confidence::text as "consensusConfidence",
        consensus_type as "consensusType",
        resolution_method as "resolutionMethod",
        final_outcome as "finalOutcome",
        resolved_by as "resolvedBy",
        resolved_at::text as "resolvedAt"
      FROM prediction_resolutions
      WHERE poll_id = ${pollId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      pollId: row.pollId,
      agent1Model: row.agent1Model ?? undefined,
      agent1Outcome: row.agent1Outcome as PredictionResolutionDetails["agent1Outcome"],
      agent1Confidence: row.agent1Confidence ? parseFloat(row.agent1Confidence) : undefined,
      agent1Reasoning: row.agent1Reasoning ?? undefined,
      agent2Model: row.agent2Model ?? undefined,
      agent2Outcome: row.agent2Outcome as PredictionResolutionDetails["agent2Outcome"],
      agent2Confidence: row.agent2Confidence ? parseFloat(row.agent2Confidence) : undefined,
      agent2Reasoning: row.agent2Reasoning ?? undefined,
      agent3Model: row.agent3Model ?? undefined,
      agent3Outcome: row.agent3Outcome as PredictionResolutionDetails["agent3Outcome"],
      agent3Confidence: row.agent3Confidence ? parseFloat(row.agent3Confidence) : undefined,
      agent3Reasoning: row.agent3Reasoning ?? undefined,
      consensusOutcome: row.consensusOutcome as PredictionResolutionDetails["consensusOutcome"],
      consensusConfidence: row.consensusConfidence ? parseFloat(row.consensusConfidence) : undefined,
      consensusType: row.consensusType as PredictionResolutionDetails["consensusType"],
      resolutionMethod: row.resolutionMethod as PredictionResolutionDetails["resolutionMethod"],
      finalOutcome: row.finalOutcome as "yes" | "no" | undefined,
      resolvedBy: row.resolvedBy ?? undefined,
      resolvedAt: row.resolvedAt ?? undefined
    };
  }

  async createPredictionMarket(input: {
    question: string;
    deadlineAt: Date;
    resolutionRule?: { kind: string; symbol?: string; target?: number };
    minStakeSkr?: number;
    maxStakeSkr?: number;
    platformFeePct?: number;
  }): Promise<{ pollId: string }> {
    const pollId = `pm_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let platformFeePct = input.platformFeePct;
    if (platformFeePct === undefined) {
      const feeRows = await this.sql<Array<{ value: string }>>`
        SELECT value
        FROM system_config
        WHERE key = 'prediction_fee_pct'
        LIMIT 1
      `;
      const configured = Number.parseFloat(feeRows[0]?.value ?? "");
      if (Number.isFinite(configured) && configured >= 0 && configured <= 20) {
        platformFeePct = configured;
      }
    }
    const effectivePlatformFeePct = platformFeePct ?? 5.0;

    await this.sql`
      INSERT INTO opinion_polls (
        id, question, deadline_at, status,
        is_prediction, min_stake_skr, max_stake_skr, platform_fee_pct,
        resolution_rule, ai_generated
      ) VALUES (
        ${pollId},
        ${input.question},
        ${input.deadlineAt.toISOString()},
        'active',
        true,
        ${input.minStakeSkr ?? 10},
        ${input.maxStakeSkr ?? 999999999},
        ${effectivePlatformFeePct},
        ${input.resolutionRule ? JSON.stringify(input.resolutionRule) : null}::jsonb,
        false
      )
    `;

    // Initialize empty pool
    await this.sql`
      INSERT INTO prediction_pools (poll_id, yes_pool_skr, no_pool_skr, yes_stakers, no_stakers)
      VALUES (${pollId}, 0, 0, 0, 0)
    `;

    return { pollId };
  }

  async updateDisputeStatus(disputeId: string, status: "investigating"): Promise<void> {
    await this.sql`
      UPDATE prediction_disputes
      SET status = ${status}
      WHERE id = ${disputeId}::uuid
        AND status = 'pending'
    `;
  }

  async addDisputeAdminNote(disputeId: string, note: string, admin: string): Promise<void> {
    await this.sql`
      UPDATE prediction_disputes
      SET resolution_note = COALESCE(resolution_note, '') || ${`\n[${new Date().toISOString()}] ${admin}: ${note}`}
      WHERE id = ${disputeId}::uuid
    `;
  }

  async getPredictionEconomicsSettings(): Promise<{
    platformFeePct: number;
    disputeDepositSkr: number;
    challengeWindowHours: number;
    totalPlatformFees: number;
    pendingDisputes: number;
    totalDisputes: number;
  }> {
    const [configRows, feesRows, disputeRows] = await Promise.all([
      this.sql<Array<{ key: string; value: string }>>`
        SELECT key, value FROM system_config
        WHERE key IN ('prediction_fee_pct', 'dispute_deposit_skr', 'dispute_challenge_hours')
      `,
      this.sql<Array<{ total: number }>>`
        SELECT COALESCE(SUM(total_fee_skr), 0)::int as total
        FROM prediction_platform_fees
      `,
      this.sql<Array<{ pending: number; total: number }>>`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending', 'investigating'))::int as pending,
          COUNT(*)::int as total
        FROM prediction_disputes
      `
    ]);

    const config: Record<string, string> = {};
    for (const r of configRows) {
      config[r.key] = r.value;
    }

    return {
      platformFeePct: parseFloat(config["prediction_fee_pct"] ?? "5.00"),
      disputeDepositSkr: parseInt(config["dispute_deposit_skr"] ?? "50", 10),
      challengeWindowHours: parseInt(config["dispute_challenge_hours"] ?? "48", 10),
      totalPlatformFees: feesRows[0]?.total ?? 0,
      pendingDisputes: disputeRows[0]?.pending ?? 0,
      totalDisputes: disputeRows[0]?.total ?? 0
    };
  }
}
