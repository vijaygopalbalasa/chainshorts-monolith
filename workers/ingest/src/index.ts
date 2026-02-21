import postgres from "postgres";
import { config, getDbBoolean, getDbNumber, getDbString, loadDbConfig, refreshDbConfigIfStale } from "./config.js";
import { runBatchIngestion } from "./pipeline/runBatchIngestion.js";
import { sourceRegistry } from "./sources/registry.js";
import { IngestStore } from "./store.js";

/** Guard against SSRF — only allow HTTPS to public hosts */
function isSafeWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const h = parsed.hostname.toLowerCase();
    if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h === "169.254.169.254" ||
      h.startsWith("192.168.") ||
      h.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h.endsWith(".internal") ||
      h.endsWith(".local")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function postAlert(
  webhookUrl: string | undefined,
  payload: {
    level: "warning" | "error";
    message: string;
    detail?: string;
  }
): Promise<void> {
  if (!webhookUrl) {
    return;
  }

  if (!isSafeWebhookUrl(webhookUrl)) {
    // eslint-disable-next-line no-console
    console.error("SSRF guard: INGEST_ALERT_WEBHOOK_URL is not a safe public HTTPS URL — skipping alert");
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...payload,
        app: "chainshorts-ingest-worker",
        timestamp: new Date().toISOString()
      })
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to deliver ingest alert", error);
  }
}

function shortenForNotification(text: string, words: number): string {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length <= words) {
    return text;
  }
  return `${parts.slice(0, words).join(" ")}...`;
}

function isDeviceNotRegistered(details: unknown): boolean {
  if (!details || typeof details !== "object") {
    return false;
  }

  const error = (details as { error?: unknown }).error;
  return error === "DeviceNotRegistered";
}

async function processQueuedPushReceipts(store: IngestStore, requeueDelaySeconds: number): Promise<void> {
  const dueReceipts = await store.listDuePushReceipts(600);
  if (!dueReceipts.length) {
    return;
  }

  const receiptToToken = new Map<string, string>();
  for (const receipt of dueReceipts) {
    receiptToToken.set(receipt.receiptId, receipt.expoPushToken);
  }

  const processed = new Set<string>();
  const retry = new Set<string>();
  const deadTokens = new Set<string>();

  const receiptIds = dueReceipts.map((item) => item.receiptId);
  const receiptChunkSize = 300;
  for (let index = 0; index < receiptIds.length; index += receiptChunkSize) {
    const ids = receiptIds.slice(index, index + receiptChunkSize);
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ids })
    });

    if (!response.ok) {
      for (const id of ids) {
        retry.add(id);
      }
      continue;
    }

    const body = (await response.json()) as {
      data?: Record<string, { status?: "ok" | "error"; details?: unknown }>;
    };

    for (const id of ids) {
      const receipt = body.data?.[id];
      if (!receipt) {
        retry.add(id);
        continue;
      }

      if (receipt.status === "error" && isDeviceNotRegistered(receipt.details)) {
        const token = receiptToToken.get(id);
        if (token) {
          deadTokens.add(token);
        }
      }

      if (receipt.status === "ok" || receipt.status === "error") {
        processed.add(id);
        continue;
      }

      retry.add(id);
    }
  }

  if (processed.size) {
    await store.markPushReceiptsProcessed([...processed]);
  }

  const retryIds = [...retry].filter((id) => !processed.has(id));
  if (retryIds.length) {
    await store.requeuePushReceipts(retryIds, requeueDelaySeconds);
  }

  for (const token of deadTokens) {
    await store.disablePushToken(token);
  }
}

async function broadcastBreakingNotification(
  store: IngestStore,
  insertedAfterIso: string,
  pushBroadcastLimit: number,
  receiptPollDelaySeconds: number
): Promise<void> {
  const [latestItem] = await store.listRecentlyInsertedFeedItems(insertedAfterIso, 1);
  if (!latestItem) {
    return;
  }

  const tokens = await store.listActivePushTokens(pushBroadcastLimit);
  if (!tokens.length) {
    return;
  }

  const payload = tokens.map((token) => ({
    to: token,
    sound: "default",
    title: "Chainshorts Breaking",
    body: shortenForNotification(latestItem.headline, 14),
    data: {
      articleId: latestItem.id,
      category: latestItem.category ?? "web3",
      source: latestItem.sourceName
    }
  }));

  const deadTokens = new Set<string>();
  const queuedReceipts: Array<{ receiptId: string; expoPushToken: string }> = [];

  const chunkSize = 100;
  for (let index = 0; index < payload.length; index += chunkSize) {
    const chunk = payload.slice(index, index + chunkSize);
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(chunk)
    });

    if (!response.ok) {
      const body = await response.text();
      // eslint-disable-next-line no-console
      console.error(`push_send_chunk_failed:${response.status}:${body.slice(0, 200)} — skipping chunk, continuing`);
      continue;
    }

    const body = (await response.json()) as {
      data?: Array<{ id?: string; status?: "ok" | "error"; details?: unknown }>;
    };

    for (let ticketIndex = 0; ticketIndex < (body.data?.length ?? 0); ticketIndex += 1) {
      const ticket = body.data?.[ticketIndex];
      const token = chunk[ticketIndex]?.to;
      if (!ticket || !token) {
        continue;
      }

      if (ticket.status === "error" && isDeviceNotRegistered(ticket.details)) {
        deadTokens.add(token);
      }

      if (ticket.id && ticket.status !== "error") {
        queuedReceipts.push({
          receiptId: ticket.id,
          expoPushToken: token
        });
      }
    }
  }

  if (queuedReceipts.length) {
    const availableAfter = new Date(Date.now() + Math.max(60, receiptPollDelaySeconds) * 1000).toISOString();
    await store.enqueuePushReceipts(queuedReceipts, availableAfter);
  }

  for (const token of deadTokens) {
    await store.disablePushToken(token);
  }
}

async function main() {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required for ingestion worker");
  }

  const sql = postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 10
  });

  const store = new IngestStore(sql);

  // Load DB config on startup (system_config table)
  await loadDbConfig(sql);

  const agentBase = {
    apiKey: config.openRouterApiKey,
    appName: "Chainshorts",
    appUrl: config.appWebUrl
  } as const;

  // Batch ingestion config (cost-optimized: 10 articles per LLM call)
  const batchIngestionInput = {
    store,
    sources: sourceRegistry,
    config: {
      batchModel: { ...agentBase, model: config.agentModels.batchSummarizer },
      batchSize: config.batchSize,
      strictRobots: config.strictRobots,
      trendingMinSources: config.trendingMinSources
    }
  };

  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const executeRun = async () => {
    if (running) {
      // eslint-disable-next-line no-console
      console.warn("Skipping ingest tick because the previous run is still active.");
      return;
    }

    // Refresh DB config (60s TTL) — picks up admin panel changes without redeploy
    await refreshDbConfigIfStale(sql);

    // Master kill-switch: skip entire run when ingest is disabled
    if (!getDbBoolean("ingest_enabled", true)) {
      // eslint-disable-next-line no-console
      console.log("[config] ingest_enabled=false — skipping run");
      return;
    }

    // When ai_enabled=false, skip all LLM stages — nothing gets published (zero cost)
    if (!getDbBoolean("ai_enabled", true)) {
      // eslint-disable-next-line no-console
      console.log("[config] ai_enabled=false — skipping all LLM stages, nothing published");
      return;
    }

    // Build batch config with DB-overridden model (swappable from admin panel)
    const liveBatchModel = getDbString("agent_model_batch_summarizer", config.agentModels.batchSummarizer);
    const liveBatchSize = getDbNumber("batch_size", config.batchSize);
    const liveTrendingMinSources = getDbNumber("trending_min_sources", config.trendingMinSources);

    // Log pipeline state for observability
    // eslint-disable-next-line no-console
    console.log(`[pipeline] BATCH MODE: model=${liveBatchModel}, batchSize=${liveBatchSize}, sources=${sourceRegistry.length}`);

    const liveInput = {
      ...batchIngestionInput,
      config: {
        batchModel: { ...agentBase, model: liveBatchModel },
        batchSize: liveBatchSize,
        strictRobots: config.strictRobots,
        trendingMinSources: liveTrendingMinSources
      }
    };

    running = true;
    const runStartedAt = new Date().toISOString();

    // Watchdog: if a run exceeds 15 minutes, reset the lock so future ticks aren't blocked.
    // The stuck run continues in the background until its own timeouts fire.
    const RUN_TIMEOUT_MS = 15 * 60 * 1000;
    const runWatchdog = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error("[ingest] Run exceeded 15 min watchdog — force-resetting running flag to unblock future ticks");
      running = false;
    }, RUN_TIMEOUT_MS);

    try {
      const result = await runBatchIngestion(liveInput);
      // eslint-disable-next-line no-console
      console.log(`[pipeline] Result: ${result.articlesPublished} published, ${result.articlesRejected} rejected, ${result.batchesSent} batches`);
      if (result.sourceErrors.length > 0) {
        const detail = result.sourceErrors.join("; ").slice(0, 1000);
        // eslint-disable-next-line no-console
        console.warn(`Ingestion completed with ${result.sourceErrors.length} source errors:`);
        // Log individual errors for debugging
        for (const err of result.sourceErrors.slice(0, 10)) {
          // eslint-disable-next-line no-console
          console.warn(`  - ${err}`);
        }
        await postAlert(config.alertWebhookUrl, {
          level: "warning",
          message: `Ingestion completed with ${result.sourceErrors.length} source errors`,
          detail
        });
      }

      if (Math.random() < 0.01) {
        const configuredRetention = Number.parseInt(getDbString("source_health_retention_days", "30"), 10);
        const retentionDays = Number.isFinite(configuredRetention)
          ? Math.min(365, Math.max(1, configuredRetention))
          : 30;
        await sql`
          DELETE FROM source_health_metrics
          WHERE checked_at < now() - (${retentionDays} || ' days')::interval
        `;
      }

      if (config.enablePushNotifications) {
        try {
          await processQueuedPushReceipts(store, Math.max(config.intervalSeconds, 300));
          await broadcastBreakingNotification(
            store,
            runStartedAt,
            config.pushBroadcastLimit,
            config.pushReceiptPollDelaySeconds
          );
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("Push broadcast failed", error);
          await postAlert(config.alertWebhookUrl, {
            level: "warning",
            message: "Push broadcast failed",
            detail: error instanceof Error ? error.message : "unknown_push_error"
          });
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Ingestion run failed", error);
      await postAlert(config.alertWebhookUrl, {
        level: "error",
        message: "Ingestion run failed",
        detail: error instanceof Error ? error.message : "unknown_error"
      });
    } finally {
      clearTimeout(runWatchdog);
      running = false;
    }
  };

  const shutdown = async (signal: string) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down ingest worker...`);
    await sql.end();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await executeRun();

  if (config.runMode === "once") {
    await sql.end();
    return;
  }

  timer = setInterval(() => {
    void executeRun();
  }, config.intervalSeconds * 1000);
  // Note: Do NOT call timer.unref() - it would cause the process to exit after first run

  // eslint-disable-next-line no-console
  console.log(`Ingest scheduler active (interval: ${config.intervalSeconds}s).`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
