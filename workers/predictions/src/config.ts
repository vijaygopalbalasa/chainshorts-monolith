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
  if (!value) return fallback;
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

// ── DB-backed runtime config (system_config table) ───────────────────────────

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
    console.log(`[config] Loaded ${rows.length} DB config keys`);
  } catch (error) {
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
  openRouterApiKey: get("OPENROUTER_API_KEY", ""),

  agentModels: {
    // All stages use Gemini Flash - reliable, fast, and cost-effective ($0.10/1M tokens)
    // Free models (qwen:free, llama:free) are unreliable on OpenRouter
    topicClassifier: get("AGENT_MODEL_TOPIC_CLASSIFIER", "google/gemini-2.0-flash-001"),
    questionGenerator: get("AGENT_MODEL_QUESTION_GENERATOR", "google/gemini-2.0-flash-001"),
    questionVerifier: get("AGENT_MODEL_QUESTION_VERIFIER", "google/gemini-2.0-flash-001"),
    duplicateChecker: get("AGENT_MODEL_DUPLICATE_CHECKER", "google/gemini-2.0-flash-001"),
    outcomeResolver: get("AGENT_MODEL_OUTCOME_RESOLVER", "google/gemini-2.0-flash-001"),
    // Resolution: Multi-agent consensus — all Gemini Flash to keep costs low
    // Override via AGENT_MODEL_RESOLVER_1/2/3 env vars or DB agent_model_resolver_* keys
    resolver1: get("AGENT_MODEL_RESOLVER_1", "google/gemini-2.0-flash-001"),
    resolver2: get("AGENT_MODEL_RESOLVER_2", "google/gemini-2.0-flash-001"),
    resolver3: get("AGENT_MODEL_RESOLVER_3", "google/gemini-2.0-flash-001"),
  },

  intervalSeconds: readPositiveInteger("PREDICTION_INTERVAL_SECONDS", 900),
  /** Minimum relevance score for an article to get a prediction market */
  relevanceMinConfidence: readFloat("PREDICTION_RELEVANCE_MIN", 0.60),
  /** Auto-settle outcome if resolver confidence > this */
  autoSettleConfidence: readFloat("PREDICTION_AUTO_SETTLE_CONFIDENCE", 0.9),
  /** Minimum consensus threshold (2 = majority, 3 = unanimous required) */
  consensusThreshold: readPositiveInteger("RESOLUTION_CONSENSUS_THRESHOLD", 2),
  /** Default prediction deadline in hours from creation */
  defaultDeadlineHours: readPositiveInteger("PREDICTION_DEFAULT_DEADLINE_HOURS", 24),
  /** Max articles to process per tick */
  maxArticlesPerTick: readPositiveInteger("PREDICTION_MAX_ARTICLES_PER_TICK", 10),
  /** Max polls to resolve per tick — keep low to cap hourly spend */
  maxResolvalsPerTick: readPositiveInteger("PREDICTION_MAX_RESOLVALS_PER_TICK", 3),
};
