import postgres from "postgres";
import { config } from "../config.js";
import type { Repository } from "../types/repository.js";
import { MemoryRepository } from "./memoryRepository.js";
import { PostgresRepository } from "./postgresRepository.js";

export function createRepository(): Repository {
  if (process.env.USE_MEMORY_REPOSITORY === "1") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Memory repository must not be used in production. Unset USE_MEMORY_REPOSITORY.");
    }
    console.warn("[repo] Using in-memory repository — data will NOT persist");
    return new MemoryRepository();
  }

  const sql = postgres(config.databaseUrl, {
    max: 5,
    idle_timeout: 20
  });

  return new PostgresRepository(sql);
}
