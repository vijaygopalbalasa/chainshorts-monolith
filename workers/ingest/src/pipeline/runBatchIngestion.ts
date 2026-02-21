/**
 * Batch Ingestion Pipeline — Cost-Optimized
 *
 * This is a complete rewrite of the ingestion pipeline optimized for cost:
 * - 30+ RSS sources
 * - Deduplication BEFORE any LLM calls (free)
 * - Batch processing: 10 articles per LLM call (90% reduction)
 * - Trusted sources skip fact-check
 *
 * Cost comparison:
 * - Old: 4 LLM calls × 300 articles = 1,200 calls/cycle
 * - New: 1 LLM call per 10 articles = 30 calls/cycle
 */

import { randomUUID } from "node:crypto";
import type { AgentConfig } from "@chainshorts/shared";
import type { IngestStore } from "../store.js";
import type { SourceRegistryItem } from "../sources/registry.js";
import { TRUSTED_SOURCE_IDS } from "../sources/registry.js";
import { classifyCategory } from "./category.js";
import { fetchRssEntries } from "./fetchRss.js";
import { normalizeEntry } from "./normalize.js";
import { isFeedAllowedByRobots } from "./robots.js";
import { processBatch, isValidSummary, type BatchArticle, type BatchResult, type BatchProcessResult } from "./batchPipeline.js";
import { deriveTokenContext } from "./agents/tokenContext.js";
import { detectTrendingEarly, buildAlphaSignalSummary } from "./agents/trendDetector.js";

export interface BatchIngestionConfig {
  batchModel: AgentConfig;
  batchSize: number;
  strictRobots: boolean;
  trendingMinSources: number;
}

export interface BatchIngestionResult {
  sourceErrors: string[];
  articlesCollected: number;
  articlesAfterDedup: number;
  batchesSent: number;
  articlesPublished: number;
  articlesRejected: number;
}

interface PendingEntry {
  raw: ReturnType<typeof normalizeEntry>["raw"];
  normalized: ReturnType<typeof normalizeEntry>["normalized"];
  source: SourceRegistryItem;
}

/**
 * Collect all articles from all sources, applying deduplication BEFORE LLM.
 *
 * Two-phase approach to minimise DB round-trips:
 *   Phase 1 — fetch + normalise all sources concurrently (no DB writes yet)
 *   Phase 2 — 2 bulk queries to check duplicates, then insert the new ones
 *
 * This reduces per-article serial DB queries (up to N×2) down to 2 queries total.
 */
async function collectArticles(
  sources: SourceRegistryItem[],
  store: IngestStore,
  strictRobots: boolean
): Promise<{ articles: BatchArticle[]; errors: string[]; entriesCollected: number }> {
  const errors: string[] = [];
  const seenUrls = new Set<string>();
  let entriesCollected = 0;
  const activeSources = sources.filter((item) => item.policy.active);
  const SOURCE_CONCURRENCY = 5;
  let sourceIndex = 0;

  // Phase 1: Fetch + normalise all sources concurrently — no DB writes yet
  const pendingEntries: PendingEntry[] = [];

  const fetchSource = async (item: SourceRegistryItem): Promise<void> => {
    try {
      await store.upsertSource(item.source, item.policy);

      const robotsAllowed = await isFeedAllowedByRobots(
        item.source.feedUrl,
        "chainshorts-bot",
        strictRobots
      );
      if (!robotsAllowed) {
        // eslint-disable-next-line no-console
        console.log(`[collect] Skipping ${item.source.name} — robots.txt disallowed`);
        return;
      }

      const entries = await fetchRssEntries(item.source.feedUrl);
      // eslint-disable-next-line no-console
      console.log(`[collect] ${item.source.name}: ${entries.length} entries`);

      const limitedEntries = entries.slice(0, 15);
      entriesCollected += limitedEntries.length;

      for (const entry of limitedEntries) {
        try {
          const { raw, normalized } = normalizeEntry(
            item.source.id,
            item.source.languageHint ?? "en",
            entry
          );

          if (seenUrls.has(normalized.canonicalUrl)) {
            continue;
          }
          seenUrls.add(normalized.canonicalUrl);

          pendingEntries.push({ raw, normalized, source: item });
        } catch (err) {
          const reason = err instanceof Error ? err.message : "unknown_error";
          // eslint-disable-next-line no-console
          console.warn(`[collect] Skipping article from ${item.source.name}: ${reason}`);
        }
      }
    } catch (error) {
      errors.push(`${item.source.name}: ${error instanceof Error ? error.message : "unknown"}`);
    }
  };

  const workers = Array.from({ length: Math.min(SOURCE_CONCURRENCY, activeSources.length) }, async () => {
    while (true) {
      const item = activeSources[sourceIndex];
      sourceIndex += 1;
      if (!item) {
        break;
      }
      await fetchSource(item);
    }
  });
  await Promise.allSettled(workers);

  if (pendingEntries.length === 0) {
    return { articles: [], errors, entriesCollected };
  }

  // Phase 2: Bulk dedup — 2 DB queries instead of N×2 serial queries
  const allClusterIds = pendingEntries.map((e) => e.normalized.clusterId);
  const allArticleIds = pendingEntries.map((e) => e.normalized.id);

  const [publishedClusters, summarizedIds] = await Promise.all([
    store.getPublishedClusterIds(allClusterIds, 24),
    store.getExistingSummaryIds(allArticleIds)
  ]);

  // Filter to only new articles, then insert + build articles list
  const articles: BatchArticle[] = [];

  for (const { raw, normalized, source } of pendingEntries) {
    if (publishedClusters.has(normalized.clusterId)) continue;
    if (summarizedIds.has(normalized.id)) continue;
    if (!source.policy.allowsSummary) continue;

    try {
      await store.insertRawArticle(raw);
      await store.upsertNormalizedArticle(normalized);

      const category = classifyCategory({
        sourceName: source.source.name,
        headline: normalized.headline,
        body: normalized.translatedBody,
        sourceLanguage: normalized.originalLanguage
      });

      articles.push({
        id: normalized.id,
        headline: normalized.headline,
        body: normalized.translatedBody,
        category,
        sourceId: source.source.id,
        sourceName: source.source.name,
        canonicalUrl: normalized.canonicalUrl,
        imageUrl: normalized.imageUrl,
        publishedAt: normalized.publishedAt,
        clusterId: normalized.clusterId,
        isTrustedSource: TRUSTED_SOURCE_IDS.has(source.source.id)
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown_error";
      // eslint-disable-next-line no-console
      console.warn(`[collect] Failed to insert article ${normalized.id}: ${reason}`);
    }
  }

  return { articles, errors, entriesCollected };
}

/**
 * Process batch results and publish to feed.
 */
async function publishResults(
  articles: BatchArticle[],
  results: BatchResult[],
  store: IngestStore,
  trendingMinSources: number
): Promise<{ published: number; rejected: number }> {
  let published = 0;
  let rejected = 0;

  // Create lookup map
  const articleMap = new Map(articles.map(a => [a.id, a]));

  for (const result of results) {
    const article = articleMap.get(result.id);
    if (!article) continue;

    // Check if relevant and has valid summary
    if (!result.relevant || !result.summary60 || !isValidSummary(result.summary60)) {
      // Record telemetry for rejection (non-fatal if fails)
      try {
        await store.upsertPipelineTelemetry({
          articleId: article.id,
          relevancePassed: result.relevant,
          relevanceReason: result.relevanceReason ?? (result.summary60 ? `invalid_word_count:${result.wordCount}` : "no_summary"),
          factVerdict: "skipped",
          published: false,
          rejectionReason: result.relevanceReason ?? "not_relevant"
        });
      } catch (telemetryErr) {
        // eslint-disable-next-line no-console
        console.warn(`[publish] Telemetry failed for ${article.id}:`, telemetryErr instanceof Error ? telemetryErr.message : telemetryErr);
      }
      rejected++;
      continue;
    }

    try {
      // Insert summary
      await store.insertSummary({
        normalizedArticleId: article.id,
        summary60: result.summary60,
        model: "batch-processor",
        provider: "deepseek"
      });

      // Get token context
      const tokenContext = await deriveTokenContext({
        headline: article.headline,
        category: article.category
      });

      // Publish to feed
      await store.publishFeedItem({
        normalizedArticleId: article.id,
        headline: article.headline,
        summary60: result.summary60,
        imageUrl: article.imageUrl,
        sourceName: article.sourceName,
        sourceUrl: article.canonicalUrl,
        publishedAt: article.publishedAt,
        clusterId: article.clusterId,
        language: "en",
        category: article.category,
        cardType: "news",
        tokenContext
      });

      // Record successful telemetry (non-fatal if fails)
      try {
        await store.upsertPipelineTelemetry({
          articleId: article.id,
          relevancePassed: true,
          factVerdict: article.isTrustedSource ? "skipped" : "pass",
          postCheckPassed: true,
          published: true
        });
      } catch (telemetryErr) {
        // eslint-disable-next-line no-console
        console.warn(`[publish] Telemetry failed for ${article.id}:`, telemetryErr instanceof Error ? telemetryErr.message : telemetryErr);
      }

      published++;

      // Check for trending (generates alpha cards + opinion polls)
      const trend = await detectTrendingEarly(
        store,
        { clusterId: article.clusterId, headline: article.headline, category: article.category },
        { minimumSources: trendingMinSources }
      );

      if (trend.trending) {
        const alphaId = `alpha_${article.clusterId}`;
        const alreadyPublished = await store.feedItemExists(alphaId);
        if (!alreadyPublished) {
          await store.publishFeedItem({
            feedItemId: alphaId,
            normalizedArticleId: article.id,
            headline: `Trending Early: ${article.headline}`,
            summary60: buildAlphaSignalSummary({
              headline: article.headline,
              sourceCount: trend.sourceCount,
              windowMinutes: 15
            }),
            sourceName: "Chainshorts Alpha",
            sourceUrl: article.canonicalUrl,
            publishedAt: new Date().toISOString(),
            clusterId: article.clusterId,
            language: "en",
            category: article.category,
            cardType: "alpha"
          });
        }

      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[publish] Failed to publish ${article.id}:`, err);
      rejected++;
    }
  }

  return { published, rejected };
}

/**
 * Main batch ingestion function.
 * Processes all sources with deduplication and batched LLM calls.
 */
export async function runBatchIngestion(input: {
  store: IngestStore;
  sources: SourceRegistryItem[];
  config: BatchIngestionConfig;
}): Promise<BatchIngestionResult> {
  const { store, sources, config } = input;
  const jobId = await store.openJob("batch_ingestion");

  // eslint-disable-next-line no-console
  console.log(`[batch] Starting batch ingestion with ${sources.length} sources`);

  try {
    // Step 1: Collect all articles with deduplication (FREE - no LLM)
    const { articles, errors, entriesCollected } = await collectArticles(
      sources,
      store,
      config.strictRobots
    );

    // eslint-disable-next-line no-console
    console.log(`[batch] Collected ${articles.length} unique articles (after dedup)`);

    if (articles.length === 0) {
      await store.closeJob(jobId, "success", "No new articles to process");
      return {
        sourceErrors: errors,
        articlesCollected: 0,
        articlesAfterDedup: 0,
        batchesSent: 0,
        articlesPublished: 0,
        articlesRejected: 0
      };
    }

    // Step 2: Process in batches
    const BATCH_SIZE = config.batchSize;
    let totalPublished = 0;
    let totalRejected = 0;
    let batchesSent = 0;

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      batchesSent++;

      // eslint-disable-next-line no-console
      console.log(`[batch] Processing batch ${batchesSent} (${batch.length} articles)`);

      // Single LLM call for entire batch
      const batchResult = await processBatch(batch, config.batchModel);

      // Log model run for cost tracking (with token usage)
      await store.insertModelRun({
        id: randomUUID(),
        provider: "openrouter",
        model: config.batchModel.model,
        purpose: "batch_summarize",
        inputTokens: batchResult.inputTokens,
        outputTokens: batchResult.outputTokens,
        latencyMs: batchResult.latencyMs,
        success: batchResult.success,
        error: batchResult.success ? undefined : batchResult.error ?? "batch_llm_error",
        createdAt: new Date().toISOString()
      });

      // Publish successful results
      const { published, rejected } = await publishResults(
        batch,
        batchResult.results,
        store,
        config.trendingMinSources
      );

      totalPublished += published;
      totalRejected += rejected;

      // eslint-disable-next-line no-console
      console.log(`[batch] Batch ${batchesSent}: ${published} published, ${rejected} rejected`);
    }

    // Finalize job
    const detail = errors.length > 0
      ? `Published ${totalPublished}, rejected ${totalRejected}. Errors: ${errors.join("; ").slice(0, 1000)}`
      : `Published ${totalPublished}, rejected ${totalRejected}`;

    await store.closeJob(jobId, "success", detail);

    // eslint-disable-next-line no-console
    console.log(`[batch] Ingestion complete: ${totalPublished} published, ${totalRejected} rejected, ${batchesSent} batches`);

    return {
      sourceErrors: errors,
      articlesCollected: entriesCollected,
      articlesAfterDedup: articles.length,
      batchesSent,
      articlesPublished: totalPublished,
      articlesRejected: totalRejected
    };
  } catch (error) {
    await store.closeJob(jobId, "failed", error instanceof Error ? error.message : "unknown_error");
    throw error;
  }
}
