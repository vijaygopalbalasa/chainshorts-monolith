export interface SettlementSql {
  <T extends readonly unknown[] = readonly unknown[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  begin<T>(callback: (sql: SettlementSql) => Promise<T>): Promise<T>;
}

export interface SettlePredictionMarketInput {
  sql: SettlementSql;
  pollId: string;
  winnerSide: "yes" | "no";
  source: string;
}

export interface SettlePredictionMarketSummary {
  winnersCount: number;
  losersCount: number;
  totalPayoutSkr: number;
  platformFeeSkr: number;
  dustSkr: number;
}

export type SettlePredictionMarketResult =
  | SettlePredictionMarketSummary
  | { frozen: true }
  | { reserved: true }
  | { alreadySettled: true };

const WINNER_BATCH_SIZE = 100;

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export async function settlePredictionMarket(
  input: SettlePredictionMarketInput
): Promise<SettlePredictionMarketResult> {
  return input.sql.begin(async (tx) => {
    const polls = await tx<Array<{
      status: string;
      disputeFreeze: boolean;
      platformFeePct: string;
    }>>`
      SELECT
        status,
        COALESCE(dispute_freeze, false) AS "disputeFreeze",
        COALESCE(platform_fee_pct, 5.00)::text AS "platformFeePct"
      FROM opinion_polls
      WHERE id = ${input.pollId}
        AND is_prediction = true
      FOR UPDATE
    `;

    const poll = polls[0];
    if (!poll) {
      throw new Error("prediction_not_found");
    }

    const pendingIntentRows = await tx<Array<{ count: string }>>`
      SELECT COUNT(*)::text as count
      FROM payment_intents
      WHERE kind = 'prediction_stake'
        AND reference_type = 'poll'
        AND reference_id = ${input.pollId}
        AND status = 'pending'
        AND expires_at > now()
    `;
    if (Number.parseInt(pendingIntentRows[0]?.count ?? "", 10) > 0) {
      return { reserved: true } as const;
    }

    const cashoutRows = await tx<Array<{ count: string }>>`
      SELECT COUNT(*)::text as count
      FROM prediction_stakes
      WHERE poll_id = ${input.pollId}
        AND status = 'cashing_out'
    `;
    if (Number.parseInt(cashoutRows[0]?.count ?? "", 10) > 0) {
      return { reserved: true } as const;
    }

    if (poll.disputeFreeze) {
      return { frozen: true } as const;
    }

    if (poll.status !== "active") {
      return { alreadySettled: true } as const;
    }

    await tx`
      UPDATE opinion_polls
      SET
        status = 'resolved',
        resolved_outcome = ${input.winnerSide},
        resolution_source = ${input.source},
        resolved_at = now()
      WHERE id = ${input.pollId}
        AND status = 'active'
    `;

    const pools = await tx<Array<{ yesPoolSkr: string; noPoolSkr: string }>>`
      SELECT
        COALESCE(yes_pool_skr, 0)::text AS "yesPoolSkr",
        COALESCE(no_pool_skr, 0)::text AS "noPoolSkr"
      FROM prediction_pools
      WHERE poll_id = ${input.pollId}
      LIMIT 1
    `;

    const pool = pools[0] ?? { yesPoolSkr: "0", noPoolSkr: "0" };

    const yesPool = toNumber(pool.yesPoolSkr);
    const noPool = toNumber(pool.noPoolSkr);
    const winningPool = input.winnerSide === "yes" ? yesPool : noPool;
    const losingPool = input.winnerSide === "yes" ? noPool : yesPool;

    const platformFeePct = toNumber(poll.platformFeePct);
    // Round platform fee — Math.floor would give 0 fee on small pools (e.g. floor(0.75)=0)
    const platformFeeSkr = Math.round(losingPool * (platformFeePct / 100));
    const distributablePool = Math.max(0, losingPool - platformFeeSkr);
    const payoutRatio = winningPool > 0 ? distributablePool / winningPool : 0;
    const challengeWindowRows = await tx<Array<{ value: string }>>`
      SELECT value
      FROM system_config
      WHERE key = 'dispute_challenge_hours'
      LIMIT 1
    `;
    const configuredChallengeHours = Number.parseInt(challengeWindowRows[0]?.value ?? "", 10);
    const claimDelayHours =
      Number.isFinite(configuredChallengeHours) && configuredChallengeHours >= 1
        ? Math.min(168, configuredChallengeHours)
        : 48;
    const claimDaysRows = await tx<Array<{ value: string }>>`
      SELECT value
      FROM system_config
      WHERE key = 'prediction_claim_days'
      LIMIT 1
    `;
    const configuredClaimDays = Number.parseInt(claimDaysRows[0]?.value ?? "", 10);
    const claimDeadlineDays =
      Number.isFinite(configuredClaimDays) && configuredClaimDays >= 1
        ? Math.min(365, configuredClaimDays)
        : 30;

    const loserSide = input.winnerSide === "yes" ? "no" : "yes";

    let winnersCount = 0;
    let totalPayoutSkr = 0;
    let totalDistributedFromLosers = 0;

    while (true) {
      const winners = await tx<Array<{ id: string; wallet: string; amountSkr: string }>>`
        UPDATE prediction_stakes
        SET
          status = 'won',
          payout_skr = amount_skr + floor(amount_skr * ${payoutRatio})
        WHERE id IN (
          SELECT id
          FROM prediction_stakes
          WHERE poll_id = ${input.pollId}
            AND side = ${input.winnerSide}
            AND status = 'active'
          ORDER BY created_at
          LIMIT ${WINNER_BATCH_SIZE}
        )
        RETURNING
          id::text,
          wallet,
          amount_skr::text AS "amountSkr"
      `;

      if (winners.length === 0) {
        break;
      }

      const stakeIds: string[] = [];
      const wallets: string[] = [];
      const stakeSkrs: number[] = [];
      const winningsSkrs: number[] = [];
      const netPayoutSkrs: number[] = [];

      for (const winner of winners) {
        const stakeAmount = toNumber(winner.amountSkr);
        const winningsSkr = Math.floor(stakeAmount * payoutRatio);
        const netPayoutSkr = stakeAmount + winningsSkr;

        stakeIds.push(winner.id);
        wallets.push(winner.wallet);
        stakeSkrs.push(stakeAmount);
        winningsSkrs.push(winningsSkr);
        netPayoutSkrs.push(netPayoutSkr);

        winnersCount += 1;
        totalPayoutSkr += netPayoutSkr;
        totalDistributedFromLosers += winningsSkr;
      }

      await tx`
        INSERT INTO prediction_payouts (
          poll_id,
          wallet,
          stake_id,
          stake_skr,
          winnings_skr,
          platform_fee_skr,
          net_payout_skr,
          payout_ratio,
          claimable_at,
          claim_deadline,
          status
        )
        SELECT
          ${input.pollId},
          unnest(${wallets}::text[]),
          unnest(${stakeIds}::uuid[]),
          unnest(${stakeSkrs}::bigint[]),
          unnest(${winningsSkrs}::bigint[]),
          0,
          unnest(${netPayoutSkrs}::bigint[]),
          ${payoutRatio},
          now() + (${claimDelayHours} * interval '1 hour'),
          now() + (${claimDeadlineDays} * interval '1 day'),
          'pending'
        ON CONFLICT (stake_id) DO NOTHING
      `;
    }

    const losers = await tx<Array<{ id: string }>>`
      UPDATE prediction_stakes
      SET status = 'lost'
      WHERE poll_id = ${input.pollId}
        AND side = ${loserSide}
        AND status = 'active'
      RETURNING id::text
    `;

    const losersCount = losers.length;
    const dustSkr = Math.max(0, distributablePool - totalDistributedFromLosers);

    await tx`
      INSERT INTO prediction_platform_fees (poll_id, total_fee_skr, dust_skr)
      VALUES (${input.pollId}, ${platformFeeSkr}, ${dustSkr})
      ON CONFLICT (poll_id) DO UPDATE SET
        total_fee_skr = EXCLUDED.total_fee_skr,
        dust_skr = EXCLUDED.dust_skr,
        collected_at = now()
    `;

    return {
      winnersCount,
      losersCount,
      totalPayoutSkr,
      platformFeeSkr,
      dustSkr,
    };
  });
}
