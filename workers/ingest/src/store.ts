import postgres from "postgres";
import type { ModelRun, NormalizedArticle, RawArticle, SourceDefinition, SourcePolicy } from "@chainshorts/shared";

export class IngestStore {
  constructor(private readonly sql: postgres.Sql) {}

  async upsertSource(source: SourceDefinition, policy: Omit<SourcePolicy, "id" | "sourceId" | "robotsCheckedAt">): Promise<void> {
    await this.sql`
      insert into sources (id, name, homepage_url, feed_url, language_hint)
      values (${source.id}, ${source.name}, ${source.homepageUrl}, ${source.feedUrl}, ${source.languageHint ?? null})
      on conflict (id)
      do update set
        name = excluded.name,
        homepage_url = excluded.homepage_url,
        feed_url = excluded.feed_url,
        language_hint = excluded.language_hint,
        updated_at = now()
    `;

    await this.sql`
      insert into source_policies (source_id, terms_url, allows_summary, allows_headline, allows_image, requires_link_back, ingest_type, active, robots_checked_at)
      values (
        ${source.id},
        ${policy.termsUrl ?? null},
        ${policy.allowsSummary},
        ${policy.allowsHeadline},
        ${policy.allowsImage},
        ${policy.requiresLinkBack},
        ${policy.ingestType},
        ${policy.active},
        now()
      )
      on conflict (source_id)
      do update set
        terms_url = excluded.terms_url,
        allows_summary = excluded.allows_summary,
        allows_headline = excluded.allows_headline,
        allows_image = excluded.allows_image,
        requires_link_back = excluded.requires_link_back,
        ingest_type = excluded.ingest_type,
        active = excluded.active,
        robots_checked_at = now(),
        updated_at = now()
    `;
  }

  async insertRawArticle(raw: RawArticle): Promise<void> {
    await this.sql`
      insert into raw_articles (source_id, external_id, url, headline, body, language, image_url, published_at)
      values (${raw.sourceId}, ${raw.externalId}, ${raw.url}, ${raw.headline}, ${raw.body ?? null}, ${raw.language}, ${raw.imageUrl ?? null}, ${raw.publishedAt})
      on conflict (source_id, external_id)
      do nothing
    `;
  }

  async upsertNormalizedArticle(article: NormalizedArticle): Promise<void> {
    await this.sql`
      insert into story_clusters (id, representative_headline)
      values (${article.clusterId}, ${article.headline})
      on conflict (id)
      do update set
        representative_headline = excluded.representative_headline,
        updated_at = now()
    `;

    await this.sql`
      insert into normalized_articles (
        id,
        source_id,
        canonical_url,
        headline,
        original_language,
        translated_body,
        image_url,
        published_at,
        dedup_hash,
        cluster_id
      ) values (
        ${article.id},
        ${article.sourceId},
        ${article.canonicalUrl},
        ${article.headline},
        ${article.originalLanguage},
        ${article.translatedBody ?? null},
        ${article.imageUrl ?? null},
        ${article.publishedAt},
        ${article.dedupHash},
        ${article.clusterId}
      )
      on conflict (id)
      do update set
        translated_body = excluded.translated_body,
        image_url = coalesce(excluded.image_url, normalized_articles.image_url),
        published_at = excluded.published_at,
        updated_at = now()
    `;
  }

  async summaryExists(normalizedArticleId: string): Promise<boolean> {
    const rows = await this.sql<{ count: string }[]>`
      select count(*)::text as count
      from article_summaries
      where normalized_article_id = ${normalizedArticleId}
    `;

    return Number(rows[0]?.count ?? "0") > 0;
  }

  async insertSummary(input: {
    normalizedArticleId: string;
    summary60: string;
    model: string;
    provider: string;
  }): Promise<void> {
    await this.sql`
      insert into article_summaries (normalized_article_id, summary_60, model, provider)
      values (${input.normalizedArticleId}, ${input.summary60}, ${input.model}, ${input.provider})
      on conflict (normalized_article_id)
      do update set
        summary_60 = excluded.summary_60,
        model = excluded.model,
        provider = excluded.provider,
        updated_at = now()
    `;
  }

  async publishFeedItem(input: {
    normalizedArticleId: string;
    feedItemId?: string;
    headline: string;
    summary60: string;
    imageUrl?: string;
    sourceName: string;
    sourceUrl: string;
    publishedAt: string;
    clusterId: string;
    language: string;
    category: string;
    cardType?: "news" | "alpha" | "threat" | "opinion" | "report";
    tokenContext?: {
      symbol: string;
      priceUsd?: number;
      change1hPct?: number;
      marketCapUsd?: number;
    };
  }): Promise<void> {
    await this.sql`
      insert into feed_items (
        id,
        normalized_article_id,
        headline,
        summary_60,
        image_url,
        source_name,
        source_url,
        published_at,
        cluster_id,
        language,
        category,
        card_type,
        token_context
      ) values (
        ${input.feedItemId ?? input.normalizedArticleId},
        ${input.normalizedArticleId},
        ${input.headline},
        ${input.summary60},
        ${input.imageUrl ?? null},
        ${input.sourceName},
        ${input.sourceUrl},
        ${input.publishedAt},
        ${input.clusterId},
        ${input.language},
        ${input.category},
        ${input.cardType ?? "news"},
        ${input.tokenContext ? JSON.stringify(input.tokenContext) : null}::jsonb
      )
      on conflict (id)
      do update set
        summary_60 = excluded.summary_60,
        source_url = excluded.source_url,
        image_url = coalesce(excluded.image_url, feed_items.image_url),
        card_type = excluded.card_type,
        token_context = coalesce(excluded.token_context, feed_items.token_context),
        updated_at = now()
    `;
  }

  async feedItemExists(id: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      select fi.id
      from feed_items fi
      where fi.id = ${id}
      limit 1
    `;
    return rows.length > 0;
  }

  async getClusterSourceSpread(clusterId: string, windowMinutes: number): Promise<{ sourceCount: number; articleCount: number }> {
    const rows = await this.sql<Array<{ sourceCount: number; articleCount: number }>>`
      select
        count(distinct na.source_id)::int as "sourceCount",
        count(*)::int as "articleCount"
      from normalized_articles na
      where na.cluster_id = ${clusterId}
        and na.published_at >= now() - (${Math.max(1, Math.min(120, windowMinutes))}::text || ' minutes')::interval
    `;

    return rows[0] ?? { sourceCount: 0, articleCount: 0 };
  }

  async upsertOpinionPoll(input: {
    id: string;
    question: string;
    articleContext: string;
    deadlineAt: string;
    resolutionRule?: unknown;
  }): Promise<void> {
    await this.sql`
      insert into opinion_polls (
        id,
        question,
        article_context,
        deadline_at,
        status,
        resolution_rule
      )
      values (
        ${input.id},
        ${input.question},
        ${input.articleContext},
        ${input.deadlineAt}::timestamptz,
        'active',
        ${input.resolutionRule ? JSON.stringify(input.resolutionRule) : null}::jsonb
      )
      on conflict (id)
      do nothing
    `;
  }

  async insertModelRun(run: ModelRun): Promise<void> {
    await this.sql`
      insert into model_runs (id, provider, model, purpose, input_tokens, output_tokens, latency_ms, success, error, created_at)
      values (
        ${run.id},
        ${run.provider},
        ${run.model},
        ${run.purpose},
        ${run.inputTokens ?? null},
        ${run.outputTokens ?? null},
        ${run.latencyMs},
        ${run.success},
        ${run.error ?? null},
        ${run.createdAt}
      )
    `;
  }

  async openJob(jobName: string): Promise<string> {
    const id = `${jobName}_${Date.now()}`;
    await this.sql`
      insert into ingestion_jobs (id, job_name, status, started_at)
      values (${id}, ${jobName}, 'running', now())
    `;

    return id;
  }

  async closeJob(jobId: string, status: "success" | "failed", detail?: string): Promise<void> {
    await this.sql`
      update ingestion_jobs
      set status = ${status},
          detail = ${detail ?? null},
          finished_at = now()
      where id = ${jobId}
    `;
  }

  async listActivePushTokens(limit = 200): Promise<string[]> {
    const rows = await this.sql<{ expoPushToken: string }[]>`
      select ps.expo_push_token as "expoPushToken"
      from push_subscriptions ps
      where ps.disabled_at is null
      order by ps.updated_at desc
      limit ${Math.max(1, Math.min(500, limit))}
    `;
    return rows.map((row) => row.expoPushToken);
  }

  async disablePushToken(expoPushToken: string): Promise<void> {
    await this.sql`
      update push_subscriptions
      set disabled_at = now(),
          updated_at = now()
      where expo_push_token = ${expoPushToken}
    `;
  }

  async enqueuePushReceipts(
    receipts: Array<{ receiptId: string; expoPushToken: string }>,
    availableAfterIso: string
  ): Promise<void> {
    if (!receipts.length) {
      return;
    }

    // Bulk INSERT in one round-trip instead of N serial round-trips.
    const values = receipts.map((r) => ({
      receipt_id: r.receiptId,
      expo_push_token: r.expoPushToken,
      available_after: availableAfterIso,
      attempts: 0,
      updated_at: new Date().toISOString()
    }));

    await this.sql`
      insert into push_receipts_pending (receipt_id, expo_push_token, available_after, attempts, updated_at)
      ${this.sql(values, "receipt_id", "expo_push_token", "available_after", "attempts", "updated_at")}
      on conflict (receipt_id)
      do update set
        expo_push_token = excluded.expo_push_token,
        available_after = excluded.available_after,
        updated_at = excluded.updated_at
    `;
  }

  async listDuePushReceipts(limit = 300): Promise<Array<{ receiptId: string; expoPushToken: string; attempts: number }>> {
    const rows = await this.sql<Array<{ receiptId: string; expoPushToken: string; attempts: number }>>`
      select
        pr.receipt_id as "receiptId",
        pr.expo_push_token as "expoPushToken",
        pr.attempts
      from push_receipts_pending pr
      where pr.available_after <= now()
      order by pr.available_after asc
      limit ${Math.max(1, Math.min(1000, limit))}
    `;
    return rows;
  }

  async markPushReceiptsProcessed(receiptIds: string[]): Promise<void> {
    if (!receiptIds.length) {
      return;
    }
    await this.sql`
      delete from push_receipts_pending
      where receipt_id = any(${this.sql.array(receiptIds)})
    `;
  }

  async requeuePushReceipts(receiptIds: string[], delaySeconds: number): Promise<void> {
    if (!receiptIds.length) {
      return;
    }

    await this.sql`
      update push_receipts_pending
      set attempts = attempts + 1,
          available_after = now() + (${Math.max(30, delaySeconds)}::text || ' seconds')::interval,
          updated_at = now()
      where receipt_id = any(${this.sql.array(receiptIds)})
    `;
  }

  // ── Pipeline telemetry ──────────────────────────────────────────────────

  async upsertPipelineTelemetry(input: {
    articleId: string;
    relevanceScore?: number;
    relevancePassed: boolean;
    relevanceReason?: string;
    factScore?: number;
    factVerdict?: "pass" | "review" | "reject" | "skipped";
    factReason?: string;
    postCheckPassed?: boolean;
    postCheckScore?: number;
    postCheckIssues?: string[];
    published: boolean;
    rejectionReason?: string;
  }): Promise<void> {
    await this.sql`
      insert into pipeline_telemetry (
        article_id, relevance_score, relevance_passed, relevance_reason,
        fact_score, fact_verdict, fact_reason,
        post_check_passed, post_check_score, post_check_issues,
        published, rejection_reason
      ) values (
        ${input.articleId},
        ${input.relevanceScore ?? null},
        ${input.relevancePassed},
        ${input.relevanceReason ?? null},
        ${input.factScore ?? null},
        ${input.factVerdict ?? null},
        ${input.factReason ?? null},
        ${input.postCheckPassed ?? null},
        ${input.postCheckScore ?? null},
        ${input.postCheckIssues ? this.sql.array(input.postCheckIssues) : null},
        ${input.published},
        ${input.rejectionReason ?? null}
      )
      on conflict (article_id)
      do update set
        relevance_score   = coalesce(excluded.relevance_score,   pipeline_telemetry.relevance_score),
        relevance_passed  = excluded.relevance_passed,
        relevance_reason  = coalesce(excluded.relevance_reason,  pipeline_telemetry.relevance_reason),
        fact_score        = coalesce(excluded.fact_score,        pipeline_telemetry.fact_score),
        fact_verdict      = coalesce(excluded.fact_verdict,      pipeline_telemetry.fact_verdict),
        fact_reason       = coalesce(excluded.fact_reason,       pipeline_telemetry.fact_reason),
        post_check_passed = coalesce(excluded.post_check_passed, pipeline_telemetry.post_check_passed),
        post_check_score  = coalesce(excluded.post_check_score,  pipeline_telemetry.post_check_score),
        post_check_issues = coalesce(excluded.post_check_issues, pipeline_telemetry.post_check_issues),
        published         = excluded.published,
        rejection_reason  = coalesce(excluded.rejection_reason,  pipeline_telemetry.rejection_reason),
        updated_at        = now()
    `;
  }

  async insertReviewQueueItem(input: {
    articleId: string;
    reason: string;
    factScore?: number;
    headline: string;
    summary60?: string;
  }): Promise<void> {
    await this.sql`
      insert into review_queue (article_id, reason, fact_score, headline, summary60)
      values (
        ${input.articleId},
        ${input.reason},
        ${input.factScore ?? null},
        ${input.headline},
        ${input.summary60 ?? null}
      )
      on conflict (article_id)
      do update set
        reason     = excluded.reason,
        fact_score = coalesce(excluded.fact_score, review_queue.fact_score),
        summary60  = coalesce(excluded.summary60, review_queue.summary60)
    `;
  }

  // ── Deduplication ────────────────────────────────────────────────────────

  /**
   * Check if a cluster has been published recently (within N hours).
   * Used to prevent duplicate articles from different sources about the same story.
   * This is FREE (no LLM cost) - should be called BEFORE any LLM processing.
   */
  async isClusterRecentlyPublished(clusterId: string, hours: number): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM feed_items
        WHERE cluster_id = ${clusterId}
        AND created_at > now() - interval '1 hour' * ${Math.max(1, Math.min(168, hours))}
      ) as exists
    `;
    return rows[0]?.exists ?? false;
  }

  /**
   * Bulk version of isClusterRecentlyPublished — 1 DB query for all cluster IDs.
   * Returns a Set of cluster IDs that have already been published within the window.
   */
  async getPublishedClusterIds(clusterIds: string[], hours: number): Promise<Set<string>> {
    if (!clusterIds.length) return new Set();
    const rows = await this.sql<{ cluster_id: string }[]>`
      SELECT DISTINCT cluster_id
      FROM feed_items
      WHERE cluster_id = ANY(${this.sql.array(clusterIds)})
        AND created_at > now() - interval '1 hour' * ${Math.max(1, Math.min(168, hours))}
    `;
    return new Set(rows.map((r) => r.cluster_id));
  }

  /**
   * Bulk version of summaryExists — 1 DB query for all article IDs.
   * Returns a Set of normalized_article_ids that already have summaries.
   */
  async getExistingSummaryIds(articleIds: string[]): Promise<Set<string>> {
    if (!articleIds.length) return new Set();
    const rows = await this.sql<{ normalized_article_id: string }[]>`
      SELECT normalized_article_id
      FROM article_summaries
      WHERE normalized_article_id = ANY(${this.sql.array(articleIds)})
    `;
    return new Set(rows.map((r) => r.normalized_article_id));
  }

  /**
   * Check if an article URL has already been processed.
   * Used for deduplication at the raw article level.
   */
  async isUrlAlreadyProcessed(canonicalUrl: string): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM normalized_articles
        WHERE canonical_url = ${canonicalUrl}
      ) as exists
    `;
    return rows[0]?.exists ?? false;
  }

  // ── Feed queries ─────────────────────────────────────────────────────────

  async listRecentlyInsertedFeedItems(
    insertedAfterIso: string,
    limit = 5
  ): Promise<Array<{ id: string; headline: string; summary60: string; sourceName: string; category: string | null }>> {
    const rows = await this.sql<
      Array<{ id: string; headline: string; summary60: string; sourceName: string; category: string | null }>
    >`
      select
        fi.id,
        fi.headline,
        fi.summary_60 as "summary60",
        fi.source_name as "sourceName",
        fi.category
      from feed_items fi
      where fi.created_at >= ${insertedAfterIso}::timestamptz
      order by fi.created_at desc
      limit ${Math.max(1, Math.min(20, limit))}
    `;
    return rows;
  }
}
