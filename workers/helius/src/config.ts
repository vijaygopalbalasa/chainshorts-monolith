import dotenv from "dotenv";

dotenv.config();

const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
const isProduction = appEnv === "production";

function read(name: string, fallback?: string): string {
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
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}

function readPositiveFloat(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}

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
  if (value.endsWith(".local")) {
    return true;
  }
  // Allow Railway private networking (*.railway.internal) but block other .internal hosts
  if (value.endsWith(".internal") && !value.endsWith(".railway.internal")) {
    return true;
  }
  return false;
}

function validatePostgresUrl(name: string, raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid ${name}: expected a valid URL`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`Invalid ${name}: expected postgres URL`);
  }
  if (isProduction && isPrivateHost(parsed.hostname)) {
    throw new Error(`Invalid ${name}: private hostnames are not allowed in production`);
  }
  return parsed.toString();
}

export const config = {
  appEnv,
  isProduction,
  databaseUrl: validatePostgresUrl(
    "DATABASE_URL",
    read("DATABASE_URL", isProduction ? undefined : "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
  ),
  port: readPositiveInteger("PORT", readPositiveInteger("HELIUS_WORKER_PORT", 8790)),
  webhookSecret: (() => {
    const secret = process.env.HELIUS_WEBHOOK_SECRET?.trim() || undefined;
    if (secret && secret.length < 16) {
      throw new Error("Invalid HELIUS_WEBHOOK_SECRET: expected at least 16 characters");
    }
    return secret;
  })(),
  whaleDumpThresholdUsd: readPositiveFloat("WHALE_DUMP_THRESHOLD_USD", 500000)
};
