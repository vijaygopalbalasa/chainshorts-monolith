import type { Repository, SystemConfigRow } from "../types/repository.js";

export type { SystemConfigRow };

const CACHE_TTL_MS = 30_000;

// Module-level cache (reset on import for tests)
let cache = new Map<string, string>();
let cacheRows: SystemConfigRow[] = [];
let lastFetch = 0;

async function maybeRefresh(repo: Repository): Promise<void> {
  if (Date.now() - lastFetch < CACHE_TTL_MS) return;
  try {
    const rows = await repo.getSystemConfigAll();
    cache = new Map(rows.map((r) => [r.key, r.value]));
    cacheRows = rows;
    lastFetch = Date.now();
  } catch (err) {
    // Back off for 10s on error to avoid thundering herd on DB failure.
    lastFetch = Date.now() - CACHE_TTL_MS + 10_000;
    throw err;
  }
}

export async function getAllConfig(repo: Repository): Promise<SystemConfigRow[]> {
  await maybeRefresh(repo);
  return cacheRows;
}

export async function getConfigValue(repo: Repository, key: string): Promise<string | undefined> {
  await maybeRefresh(repo);
  return cache.get(key);
}

export async function updateConfig(
  repo: Repository,
  key: string,
  value: string,
  updatedBy: string
): Promise<void> {
  await repo.updateSystemConfig(key, value, updatedBy);
  invalidateCache();
}

export function invalidateCache(): void {
  lastFetch = 0;
  cache.clear();
  cacheRows = [];
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
