import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config();

const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
const isProduction = appEnv === "production";

function get(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer`);
  }

  return parsed;
}

function readFloat(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${name}: expected a float`);
  return parsed;
}

function readRunMode(): "once" | "interval" {
  const value = (process.env.INGEST_RUN_MODE ?? "interval").trim().toLowerCase();
  if (value === "once" || value === "interval") {
    return value;
  }

  throw new Error("Invalid INGEST_RUN_MODE: expected 'once' or 'interval'");
}

// ── DB-backed runtime config (system_config table) ───────────────────────────
// Fetched from DB on startup + every 60s. Allows changing flags from the
// admin panel without a Railway redeploy. Falls back to env vars on error.

const DB_CONFIG_TTL_MS = 60_000;

let dbConfigCache = new Map<string, string>();
let dbConfigLastFetch = 0;

export async function loadDbConfig(sql: postgres.Sql): Promise<void> {
  try {
    const rows = await sql<Array<{ key: string; value: string }>>`
      select key, value from system_config
    `;
    dbConfigCache = new Map(rows.map((r) => [r.key, r.value]));
    dbConfigLastFetch = Date.now();
    // eslint-disable-next-line no-console
    console.log(`[config] Loaded ${rows.length} DB config keys (ai_enabled=${dbConfigCache.get("ai_enabled") ?? "missing"})`);
  } catch (error) {
    // system_config table may not exist in dev/test — fall back to env var defaults silently
    // eslint-disable-next-line no-console
    console.warn("[config] Could not load system_config from DB:", error instanceof Error ? error.message : "unknown");
  }
}

export async function refreshDbConfigIfStale(sql: postgres.Sql): Promise<void> {
  if (Date.now() - dbConfigLastFetch >= DB_CONFIG_TTL_MS) {
    await loadDbConfig(sql);
  }
}

export function getDbBoolean(key: string, fallback: boolean): boolean {
  const raw = dbConfigCache.get(key);
  if (raw === undefined) return fallback;
  return ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function getDbString(key: string, fallback: string): string {
  return dbConfigCache.get(key) ?? fallback;
}

export function getDbNumber(key: string, fallback: number): number {
  const raw = dbConfigCache.get(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  databaseUrl: get("DATABASE_URL", isProduction ? undefined : "postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
  appWebUrl: get("APP_WEB_URL", "https://chainshorts.live"),

  // ── Translation models (non-English articles before summarization)
  openRouterApiKey: get("OPENROUTER_API_KEY", ""),
  openRouterPrimaryModel: get("OPENROUTER_MODEL_PRIMARY", "google/gemini-2.0-flash-001"),
  openRouterFallbackModel: get("OPENROUTER_MODEL_FALLBACK", "deepseek/deepseek-chat-v3-0324"),

  // ── Per-agent model configuration — COST-OPTIMIZED models
  // DeepSeek V3.2: $0.14/M input, $0.28/M output (99% cheaper than GPT-4)
  // For batched processing: 10 articles = 1 API call instead of 40+
  agentModels: {
    /** Batch Summarizer — combines relevance + summarization (10 articles per call) */
    batchSummarizer: get("AGENT_MODEL_BATCH_SUMMARIZER", "deepseek/deepseek-chat-v3-0324"),
    /** Stage 1: Relevance Filter — fallback for individual processing */
    relevanceFilter: get("AGENT_MODEL_RELEVANCE_FILTER", "deepseek/deepseek-chat-v3-0324"),
    /** Stage 2: Fact Checker — only for untrusted sources */
    factChecker: get("AGENT_MODEL_FACT_CHECKER", "deepseek/deepseek-chat-v3-0324"),
    /** Stage 3: Summarizer primary — fallback for individual processing */
    summarizer: get("AGENT_MODEL_SUMMARIZER", "deepseek/deepseek-chat-v3-0324"),
    /** Stage 3: Summarizer fallback — not used in batched mode */
    summarizerFallback: get("AGENT_MODEL_SUMMARIZER_FALLBACK", "deepseek/deepseek-chat-v3-0324"),
    /** Stage 4: Post-Check Verifier — skip for trusted sources */
    postCheck: get("AGENT_MODEL_POST_CHECK", "deepseek/deepseek-chat-v3-0324")
  },

  // Trusted sources — skip fact-check + post-check (they have editorial standards)
  trustedSourceIds: (process.env.TRUSTED_SOURCE_IDS ?? "src_coindesk,src_decrypt,src_theblock,src_thedefiant,src_bitcoinmag,src_solana_blog").split(",").map(s => s.trim()),

  // Batch processing config
  batchSize: readPositiveInteger("BATCH_SIZE", 10),

  // ── Pipeline decision thresholds
  pipelineThresholds: {
    /** Minimum confidence to pass relevance filter (0.0–1.0) */
    relevanceMinConfidence: readFloat("RELEVANCE_MIN_CONFIDENCE", 0.6),
    /** Fact score >= this → auto-publish */
    factCheckAutoPublish: readFloat("FACT_CHECK_AUTO_PUBLISH", 0.85),
    /** Fact score >= this and < autoPublish → route to review queue */
    factCheckReview: readFloat("FACT_CHECK_REVIEW", 0.70),
    /** Minimum post-check confidence to publish (0.0–1.0) */
    postCheckMinConfidence: readFloat("POST_CHECK_MIN_CONFIDENCE", 0.75)
  },

  trendingMinSources: readPositiveInteger("TRENDING_MIN_SOURCES", 3),
  strictRobots: process.env.STRICT_ROBOTS !== "0",
  runMode: readRunMode(),
  intervalSeconds: readPositiveInteger("INGEST_INTERVAL_SECONDS", 600),
  alertWebhookUrl: process.env.INGEST_ALERT_WEBHOOK_URL?.trim() || undefined,
  enablePushNotifications: process.env.ENABLE_PUSH_NOTIFICATIONS === "1",
  pushBroadcastLimit: readPositiveInteger("PUSH_BROADCAST_LIMIT", 200),
  pushReceiptPollDelaySeconds: readPositiveInteger("PUSH_RECEIPT_POLL_DELAY_SECONDS", 900)
};
