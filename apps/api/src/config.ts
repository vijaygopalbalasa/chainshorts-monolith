import dotenv from "dotenv";
import { DEFAULT_ECONOMY_POLICY } from "@chainshorts/shared";

dotenv.config();

function readEnv(name: string, options?: { fallback?: string; allowEmpty?: boolean }): string {
  const value = process.env[name] ?? options?.fallback;
  if (value == null) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  if (!options?.allowEmpty && value.trim().length === 0) {
    throw new Error(`Invalid ${name}: empty value`);
  }
  return value;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function isPrivateHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase();
  if (value === "localhost" || value === "127.0.0.1" || value === "::1") {
    return true;
  }
  if (value.endsWith(".local")) {
    return true;
  }
  if (value.endsWith(".internal") && !value.endsWith(".railway.internal")) {
    return true;
  }
  if (value.startsWith("10.") || value.startsWith("192.168.") || value.startsWith("169.254.")) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) {
    return true;
  }
  return false;
}

function validateHttpUrl(
  name: string,
  raw: string,
  options?: { requireHttpsInProduction?: boolean; allowPrivateInProduction?: boolean }
): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid ${name}: expected a valid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${name}: expected http(s) URL`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid ${name}: embedded credentials are not allowed`);
  }
  if (isProduction && options?.requireHttpsInProduction && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${name}: https is required in production`);
  }
  if (isProduction && options?.allowPrivateInProduction !== true && isPrivateHost(parsed.hostname)) {
    throw new Error(`Invalid ${name}: private hostnames are not allowed in production`);
  }
  return parsed.toString();
}

function readHttpUrl(
  name: string,
  options?: { fallback?: string; requireHttpsInProduction?: boolean; allowPrivateInProduction?: boolean }
): string {
  const raw = readEnv(name, { fallback: options?.fallback });
  return validateHttpUrl(name, raw, options);
}

function readOptionalHttpUrl(
  name: string,
  options?: { requireHttpsInProduction?: boolean; allowPrivateInProduction?: boolean }
): string | undefined {
  const raw = readOptionalEnv(name);
  if (!raw) {
    return undefined;
  }
  return validateHttpUrl(name, raw, options);
}

function readOptionalSecret(name: string, minLength: number): string | undefined {
  const value = readOptionalEnv(name);
  if (!value) {
    return undefined;
  }
  if (value.length < minLength) {
    throw new Error(`Invalid ${name}: expected at least ${minLength} characters`);
  }
  return value;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer`);
  }
  return parsed;
}

function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative integer`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid ${name}: expected boolean-like value`);
}

const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
const isProduction = appEnv === "production";

const localDatabaseFallback = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const localRpcFallback = "https://api.mainnet-beta.solana.com";
const localAppWebFallback = "https://chainshorts.live";

export const config = {
  appEnv,
  isProduction,
  port: readPositiveInt("PORT", readPositiveInt("API_PORT", 8787)),
  databaseUrl: readEnv("DATABASE_URL", { fallback: isProduction ? undefined : localDatabaseFallback }),
  platformWallet: readEnv("PLATFORM_WALLET", { fallback: isProduction ? undefined : "11111111111111111111111111111111" }),
  platformWalletSecret: readOptionalEnv("PLATFORM_WALLET_SECRET"), // Base58 encoded private key for outbound transfers
  solanaRpcUrl: readHttpUrl("SOLANA_RPC_URL", {
    fallback: isProduction ? undefined : localRpcFallback,
    requireHttpsInProduction: true
  }),
  skrMint: readEnv("SKR_MINT", { fallback: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3" }),
  appWebUrl: readHttpUrl("APP_WEB_URL", {
    fallback: isProduction ? undefined : localAppWebFallback,
    requireHttpsInProduction: true
  }),
  privacyPolicyUrl: readOptionalHttpUrl("PRIVACY_POLICY_URL", { requireHttpsInProduction: true }),
  openRouterApiKey: readOptionalEnv("OPENROUTER_API_KEY"),
  economyPolicy: {
    tiers: {
      signal: readNonNegativeInt("SKR_TIER_SIGNAL", DEFAULT_ECONOMY_POLICY.tiers.signal),
      alpha: readNonNegativeInt("SKR_TIER_ALPHA", DEFAULT_ECONOMY_POLICY.tiers.alpha),
      pro: readNonNegativeInt("SKR_TIER_PRO", DEFAULT_ECONOMY_POLICY.tiers.pro),
      threatFeed: readNonNegativeInt("SKR_TIER_THREAT", DEFAULT_ECONOMY_POLICY.tiers.threatFeed),
      devFeed: readNonNegativeInt("SKR_TIER_DEV", DEFAULT_ECONOMY_POLICY.tiers.devFeed)
    },
    pricing: {
      contentBoost: readNonNegativeInt("PRICE_CONTENT_BOOST_SKR", DEFAULT_ECONOMY_POLICY.pricing.contentBoost),
      contributorStake: readNonNegativeInt("PRICE_CONTRIBUTOR_STAKE_SKR", DEFAULT_ECONOMY_POLICY.pricing.contributorStake),
      customAlertSubscription: readNonNegativeInt(
        "PRICE_CUSTOM_ALERT_SUBSCRIPTION_SKR",
        DEFAULT_ECONOMY_POLICY.pricing.customAlertSubscription
      )
    }
  },
  featureFlags: {
    alphaFeed: readBoolean("FEATURE_ALPHA_FEED", true),
    threatFeed: readBoolean("FEATURE_THREAT_FEED", true),
    opinionPolls: readBoolean("FEATURE_OPINION_POLLS", true),
    contentBoosts: readBoolean("FEATURE_CONTENT_BOOSTS", true)
  },
  trustProxy: readBoolean("TRUST_PROXY", false),
  logLevel: process.env.LOG_LEVEL ?? "info",
  authCleanupIntervalSeconds: readPositiveInt("AUTH_CLEANUP_INTERVAL_SECONDS", 1800),
  adminToken: readOptionalSecret("ADMIN_TOKEN", 24),
  jupiterApiKey: readOptionalEnv("JUPITER_API_KEY"),
};
