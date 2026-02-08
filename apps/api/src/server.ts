import { config } from "./config.js";
import { createApp } from "./app.js";
import { createRepository } from "./repositories/index.js";
import { PostgresRepository } from "./repositories/postgresRepository.js";

async function main() {
  const repository = createRepository();
  const app = createApp({
    repository,
    platformWallet: config.platformWallet,
    platformWalletSecret: config.platformWalletSecret,
    solanaRpcUrl: config.solanaRpcUrl,
    skrMint: config.skrMint,
    economyPolicy: config.economyPolicy,
    appWebUrl: config.appWebUrl,
    privacyPolicyUrl: config.privacyPolicyUrl,
    openRouterApiKey: config.openRouterApiKey,
    featureFlags: config.featureFlags,
    trustProxy: config.trustProxy,
    adminToken: config.adminToken,
    jupiterApiKey: config.jupiterApiKey,
    logger: {
      level: config.logLevel
    }
  });

  const runCleanup = async () => {
    try {
      await repository.cleanupExpiredAuthArtifacts(new Date());
      app.log.debug("Auth cleanup completed");
    } catch (error) {
      app.log.error({ err: error }, "Auth cleanup failed");
    }
  };

  const runBoostExpiry = async () => {
    try {
      const expired = await repository.expireContentBoosts(new Date());
      if (expired > 0) {
        app.log.info({ expired }, "Content boosts expired");
      }
    } catch (error) {
      app.log.error({ err: error }, "Content boost expiry failed");
    }
  };

  const runDisputeExpiry = async () => {
    if (!(repository instanceof PostgresRepository)) {
      return;
    }

    try {
      const sql = repository.getSqlClient();
      // Wrap in transaction to prevent race: new dispute filed between expire + unfreeze
      const { expired, unfrozen } = await sql.begin(async (tx: any) => {
        const exp = await tx<Array<{ id: string }>>`
          UPDATE prediction_disputes
          SET status = 'expired',
              resolved_at = COALESCE(resolved_at, now())
          WHERE status IN ('pending', 'investigating')
            AND challenge_deadline < now()
          RETURNING id::text
        `;

        const unf = await tx<Array<{ id: string }>>`
          UPDATE opinion_polls
          SET dispute_freeze = false
          WHERE dispute_freeze = true
            AND NOT EXISTS (
              SELECT 1
              FROM prediction_disputes pd
              WHERE pd.poll_id = opinion_polls.id
                AND pd.status IN ('pending', 'investigating')
            )
          RETURNING id::text
        `;

        return { expired: exp, unfrozen: unf };
      });

      if (expired.length > 0 || unfrozen.length > 0) {
        app.log.info({ expired: expired.length, unfrozen: unfrozen.length }, "Prediction dispute expiry sweep completed");
      }
    } catch (error) {
      app.log.error({ err: error }, "Prediction dispute expiry failed");
    }
  };

  const runPaymentIntentExpiry = async () => {
    if (!(repository instanceof PostgresRepository)) {
      return;
    }

    try {
      const sql = repository.getSqlClient();
      const expired = await sql<Array<{ id: string }>>`
        UPDATE payment_intents
        SET status = 'expired', updated_at = now()
        WHERE status = 'pending'
          AND expires_at <= now()
        RETURNING id::text
      `;

      if (expired.length > 0) {
        app.log.info({ expired: expired.length }, "Payment intent expiry sweep completed");
      }
    } catch (error) {
      app.log.error({ err: error }, "Payment intent expiry failed");
    }
  };

  void runCleanup();
  void runBoostExpiry();
  void runDisputeExpiry();
  void runPaymentIntentExpiry();

  const cleanupTimer = setInterval(() => {
    void runCleanup();
  }, config.authCleanupIntervalSeconds * 1000);
  cleanupTimer.unref();

  // Run content boost expiry every 15 minutes
  const boostExpiryTimer = setInterval(() => {
    void runBoostExpiry();
  }, 15 * 60 * 1000);
  boostExpiryTimer.unref();

  const disputeExpiryTimer = setInterval(() => {
    void runDisputeExpiry();
  }, 15 * 60 * 1000);
  disputeExpiryTimer.unref();

  const paymentIntentExpiryTimer = setInterval(() => {
    void runPaymentIntentExpiry();
  }, 15 * 60 * 1000);
  paymentIntentExpiryTimer.unref();

  await app.listen({
    host: "0.0.0.0",
    port: config.port
  });

  app.log.info(`API listening on :${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(cleanupTimer);
    clearInterval(boostExpiryTimer);
    clearInterval(disputeExpiryTimer);
    clearInterval(paymentIntentExpiryTimer);
    app.log.info(`Received ${signal}, closing API server...`);
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
