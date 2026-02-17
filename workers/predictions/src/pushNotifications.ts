import type postgres from "postgres";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_CHUNK_SIZE = 100;
const DEFAULT_BROADCAST_LIMIT = 500;
const RECEIPT_AVAILABLE_AFTER_MS = 60_000;

interface ExpoPushMessage {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface ClaimablePayout {
  id: string;
  wallet: string;
  pollQuestion: string;
}

function shortenWords(value: string, words: number): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= words) {
    return value.trim();
  }
  return `${parts.slice(0, words).join(" ")}…`;
}

function isDeviceNotRegistered(details: unknown): boolean {
  if (!details || typeof details !== "object") {
    return false;
  }

  const error = (details as { error?: unknown }).error;
  return error === "DeviceNotRegistered";
}

async function enqueuePushReceipts(
  sql: postgres.Sql,
  receipts: Array<{ receiptId: string; expoPushToken: string }>
): Promise<void> {
  if (!receipts.length) {
    return;
  }

  const availableAfter = new Date(Date.now() + RECEIPT_AVAILABLE_AFTER_MS).toISOString();
  for (const receipt of receipts) {
    await sql`
      INSERT INTO push_receipts_pending (
        receipt_id,
        expo_push_token,
        available_after,
        attempts,
        updated_at
      )
      VALUES (${receipt.receiptId}, ${receipt.expoPushToken}, ${availableAfter}, 0, now())
      ON CONFLICT (receipt_id)
      DO UPDATE SET
        expo_push_token = EXCLUDED.expo_push_token,
        available_after = EXCLUDED.available_after,
        updated_at = now()
    `;
  }
}

async function sendBatch(
  sql: postgres.Sql,
  messages: ExpoPushMessage[]
): Promise<void> {
  if (!messages.length) {
    return;
  }

  const deadTokens = new Set<string>();
  const queuedReceipts: Array<{ receiptId: string; expoPushToken: string }> = [];

  for (let index = 0; index < messages.length; index += PUSH_CHUNK_SIZE) {
    const chunk = messages.slice(index, index + PUSH_CHUNK_SIZE);
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`push_send_failed:${response.status}:${body.slice(0, 200)}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; status?: "ok" | "error"; details?: unknown }>;
    };

    for (let ticketIndex = 0; ticketIndex < (payload.data?.length ?? 0); ticketIndex += 1) {
      const ticket = payload.data?.[ticketIndex];
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
          expoPushToken: token,
        });
      }
    }
  }

  if (queuedReceipts.length) {
    await enqueuePushReceipts(sql, queuedReceipts);
  }

  if (deadTokens.size > 0) {
    await disableDeadTokens(sql, [...deadTokens]);
  }
}

export async function listActivePushTokens(
  sql: postgres.Sql,
  limit = DEFAULT_BROADCAST_LIMIT
): Promise<string[]> {
  const rows = await sql<Array<{ expoPushToken: string }>>`
    SELECT dedup.expo_push_token AS "expoPushToken"
    FROM (
      SELECT DISTINCT ON (ps.expo_push_token)
        ps.expo_push_token,
        ps.updated_at
      FROM push_subscriptions ps
      WHERE ps.disabled_at IS NULL
      ORDER BY ps.expo_push_token, ps.updated_at DESC
    ) dedup
    ORDER BY dedup.updated_at DESC
    LIMIT ${Math.max(1, Math.min(DEFAULT_BROADCAST_LIMIT, limit))}
  `;
  return rows.map((row) => row.expoPushToken);
}

export async function listWalletPushTokens(
  sql: postgres.Sql,
  wallets: string[]
): Promise<string[]> {
  const uniqueWallets = [...new Set(wallets.filter(Boolean))];
  if (!uniqueWallets.length) {
    return [];
  }

  const rows = await sql<Array<{ expoPushToken: string }>>`
    SELECT dedup.expo_push_token AS "expoPushToken"
    FROM (
      SELECT DISTINCT ON (ps.expo_push_token)
        ps.expo_push_token,
        ps.updated_at
      FROM push_subscriptions ps
      WHERE ps.disabled_at IS NULL
        AND ps.wallet_address = ANY(${sql.array(uniqueWallets)})
      ORDER BY ps.expo_push_token, ps.updated_at DESC
    ) dedup
    ORDER BY dedup.updated_at DESC
  `;
  return rows.map((row) => row.expoPushToken);
}

export async function listNewlyClaimablePayouts(
  sql: postgres.Sql,
  limit = 200
): Promise<ClaimablePayout[]> {
  return sql<ClaimablePayout[]>`
    SELECT
      pp.id::text AS id,
      pp.wallet,
      op.question AS "pollQuestion"
    FROM prediction_payouts pp
    JOIN opinion_polls op ON op.id = pp.poll_id
    WHERE pp.status = 'pending'
      AND pp.claimable_at IS NOT NULL
      AND pp.claimable_at <= now()
      AND pp.claimable_notified_at IS NULL
    ORDER BY pp.claimable_at ASC
    LIMIT ${Math.max(1, Math.min(500, limit))}
  `;
}

export async function markClaimableNotified(
  sql: postgres.Sql,
  ids: string[]
): Promise<void> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) {
    return;
  }

  await sql`
    UPDATE prediction_payouts
    SET claimable_notified_at = now()
    WHERE id::text = ANY(${sql.array(uniqueIds)})
  `;
}

export async function disableDeadTokens(
  sql: postgres.Sql,
  tokens: string[]
): Promise<void> {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  if (!uniqueTokens.length) {
    return;
  }

  await sql`
    UPDATE push_subscriptions
    SET disabled_at = now(),
        updated_at = now()
    WHERE expo_push_token = ANY(${sql.array(uniqueTokens)})
  `;
}

export async function broadcastNewPrediction(
  sql: postgres.Sql,
  question: string,
  pollId: string
): Promise<void> {
  const tokens = await listActivePushTokens(sql);
  if (!tokens.length) {
    return;
  }

  const body = shortenWords(question, 12) || "A new market is now live.";
  await sendBatch(
    sql,
    tokens.map((token) => ({
      to: token,
      sound: "default",
      title: "New Prediction Market",
      body,
      data: {
        type: "prediction_created",
        pollId,
      },
    }))
  );
}

export async function sendStakeResolvedNotifications(
  sql: postgres.Sql,
  pollId: string,
  _question: string,
  winnerWallets: string[],
  loserWallets: string[]
): Promise<void> {
  const winnerSet = new Set(winnerWallets.filter(Boolean));
  const loserSet = new Set(loserWallets.filter(Boolean));
  const mixedWallets = [...winnerSet].filter((wallet) => loserSet.has(wallet));
  const winnersOnly = [...winnerSet].filter((wallet) => !loserSet.has(wallet));
  const losersOnly = [...loserSet].filter((wallet) => !winnerSet.has(wallet));

  const winnerTokens = await listWalletPushTokens(sql, winnersOnly);
  if (winnerTokens.length) {
    await sendBatch(
      sql,
      winnerTokens.map((token) => ({
        to: token,
        sound: "default",
        title: "You predicted correctly!",
        body: "Payout available in 48 hours.",
        data: {
          type: "stake_resolved",
          pollId,
          outcome: "won",
        },
      }))
    );
  }

  const loserTokens = await listWalletPushTokens(sql, losersOnly);
  if (loserTokens.length) {
    await sendBatch(
      sql,
      loserTokens.map((token) => ({
        to: token,
        sound: "default",
        title: "Prediction settled",
        body: "Your prediction did not resolve in your favour.",
        data: {
          type: "stake_resolved",
          pollId,
          outcome: "lost",
        },
      }))
    );
  }

  const mixedTokens = await listWalletPushTokens(sql, mixedWallets);
  if (mixedTokens.length) {
    await sendBatch(
      sql,
      mixedTokens.map((token) => ({
        to: token,
        sound: "default",
        title: "Prediction settled",
        body: "One or more positions resolved. Review your portfolio.",
        data: {
          type: "stake_resolved",
          pollId,
          outcome: "mixed",
        },
      }))
    );
  }
}

export async function sendClaimablePayoutNotifications(
  sql: postgres.Sql
): Promise<void> {
  const payouts = await listNewlyClaimablePayouts(sql);
  if (!payouts.length) {
    return;
  }

  const tokens = await listWalletPushTokens(
    sql,
    payouts.map((payout) => payout.wallet)
  );

  if (tokens.length) {
    await sendBatch(
      sql,
      tokens.map((token) => ({
        to: token,
        sound: "default",
        title: "Payout ready to claim",
        body: "Your prediction winnings are now available. Tap to claim.",
        data: {
          type: "payout_claimable",
        },
      }))
    );
  }

  await markClaimableNotified(
    sql,
    payouts.map((payout) => payout.id)
  );
}
