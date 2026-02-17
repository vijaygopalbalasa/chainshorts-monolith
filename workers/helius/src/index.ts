import { createHash, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import postgres from "postgres";
import { config } from "./config.js";
import { detectWhaleDump } from "./threatIntelligence.js";

interface HeliusLikeEvent {
  signature?: string;
  type?: string;
  source?: string;
  timestamp?: number;
  tokenTransfers?: Array<{
    mint?: string;
    tokenAmount?: number;
    usdValue?: number;
    fromUserAccount?: string;
    toUserAccount?: string;
  }>;
  nativeTransfers?: Array<{
    amount?: number;
    fromUserAccount?: string;
    toUserAccount?: string;
  }>;
}

function safeSecretEquals(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function makeDedupKey(event: HeliusLikeEvent): string {
  if (event.signature) {
    return `sig:${event.signature}`;
  }
  const raw = JSON.stringify({
    type: event.type,
    source: event.source,
    ts: event.timestamp,
    tokenTransfers: event.tokenTransfers?.slice(0, 2),
    nativeTransfers: event.nativeTransfers?.slice(0, 2)
  });
  return `hash:${createHash("sha256").update(raw).digest("hex")}`;
}

async function main() {
  if (!config.webhookSecret) {
    if (config.isProduction) {
      throw new Error("HELIUS_WEBHOOK_SECRET is required in production");
    }
    // eslint-disable-next-line no-console
    console.warn("WARN: HELIUS_WEBHOOK_SECRET is not set — webhook endpoint is unauthenticated");
  }

  const sql = postgres(config.databaseUrl, { max: 3, idle_timeout: 10 });
  const app = Fastify({
    logger: true,
    bodyLimit: 2 * 1024 * 1024
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/webhook/helius", async (request, reply) => {
    if (config.webhookSecret) {
      // Helius sends auth in Authorization header as "Bearer {secret}" (current) or
      // legacy x-helius-secret header. Support both.
      const authHeader = request.headers["authorization"];
      const legacyHeader = request.headers["x-helius-secret"];
      const fromAuth = (Array.isArray(authHeader) ? authHeader[0] : authHeader)?.replace(/^Bearer\s+/i, "").trim();
      const fromLegacy = (Array.isArray(legacyHeader) ? legacyHeader[0] : legacyHeader)?.trim();
      const provided = fromAuth || fromLegacy;
      if (!provided || provided.length > 256 || !safeSecretEquals(provided, config.webhookSecret)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }

    const events = Array.isArray(request.body) ? (request.body as HeliusLikeEvent[]) : [request.body as HeliusLikeEvent];
    if (events.length > 500) {
      return reply.code(413).send({ error: "payload_too_large" });
    }
    if (events.some((event) => !event || typeof event !== "object")) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    let inserted = 0;
    let alertsCreated = 0;

    for (const event of events) {
      const dedupKey = makeDedupKey(event);
      const payload = JSON.stringify(event);
      const observedAt = event.timestamp ? new Date(event.timestamp * 1000).toISOString() : new Date().toISOString();
      await sql.begin(async (txSql) => {
        const tx = txSql as unknown as postgres.Sql;
        const signalRows = await tx<{ signalId: string }[]>`
          insert into helius_webhook_events (source, event_type, tx_hash, payload, dedup_key, observed_at)
          values (
            ${event.source ?? "helius"},
            ${event.type ?? "unknown"},
            ${event.signature ?? null},
            ${payload}::jsonb,
            ${dedupKey},
            ${observedAt}
          )
          on conflict (dedup_key)
          do nothing
          returning id::text as "signalId"
        `;
        if (!signalRows.length) {
          return;
        }
        inserted += 1;

        const whaleDump = detectWhaleDump(
          {
            ...event,
            tokenTransfers: Array.isArray(event.tokenTransfers) ? event.tokenTransfers : []
          },
          config.whaleDumpThresholdUsd
        );
        if (!whaleDump.triggered || !whaleDump.headline || !whaleDump.summary60) {
          return;
        }

        await tx`
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
            status,
            published_at
          )
          values (
            ${whaleDump.severity},
            'whale_dump',
            ${whaleDump.confidence},
            ${whaleDump.headline},
            ${whaleDump.summary60},
            'Monitor closely',
            ${whaleDump.txHash ?? null},
            ${whaleDump.txHash ? `https://solscan.io/tx/${whaleDump.txHash}` : null},
            0,
            'published',
            now()
          )
        `;
        alertsCreated += 1;
      });
    }

    return {
      ok: true,
      processed: events.length,
      insertedSignals: inserted,
      alertsCreated
    };
  });

  await app.listen({
    host: "0.0.0.0",
    port: config.port
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down helius worker...`);
    await app.close();
    await sql.end({ timeout: 5000 });
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
