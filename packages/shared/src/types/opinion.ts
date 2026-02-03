export type OpinionSide = "yes" | "no";
export type OpinionStatus = "active" | "resolved" | "cancelled";

export interface OpinionPoll {
  id: string;
  question: string;
  articleContext?: string;
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
  yesPct: number;
  noPct: number;
  deadlineAt: string;
  status: OpinionStatus;
  resolvedOutcome?: OpinionSide;
  resolvedAt?: string;
  resolutionSource?: string;
  createdAt: string;
  userVote?: OpinionSide;
  userVotedAt?: string;
}

// ─── Prediction Markets (Polymarket-style staking) ─────────────────────────

export type PredictionStakeStatus = "active" | "cashing_out" | "won" | "lost" | "cancelled" | "claimed";
export type PredictionPayoutStatus = "pending" | "claimed" | "expired" | "frozen";

/** Resolution evidence returned with portfolio — internal agent details are never exposed to users */
export interface ResolutionSummary {
  outcome: "yes" | "no";
  resolvedAt: string;
  /** "3/3" = unanimous, "2/3" = majority, "manual" = admin-reviewed */
  consensus: "3/3" | "2/3" | "manual";
  /** 0–100 confidence score */
  agentAgreement: number;
  evidenceSources: Array<{ title: string; url: string }>;
  reason?: string;
}

export interface PredictionStake {
  id: string;
  pollId: string;
  wallet: string;
  side: OpinionSide;
  amountSkr: number;
  txSignature: string;
  status: PredictionStakeStatus;
  payoutSkr?: number;
  cashoutTxSignature?: string;
  cashoutTransferStatus?: "in_progress" | "complete" | "failed";
  createdAt: string;
}

export interface PredictionPool {
  pollId: string;
  yesPoolSkr: number;
  noPoolSkr: number;
  totalPoolSkr: number;
  yesStakers: number;
  noStakers: number;
  totalStakers: number;
  yesPct: number;
  noPct: number;
  yesOdds: number;  // Potential payout multiplier if yes wins
  noOdds: number;   // Potential payout multiplier if no wins
  updatedAt: string;
}

export interface PredictionPayout {
  id: string;
  pollId: string;
  wallet: string;
  stakeId: string;
  stakeSkr: number;
  winningsSkr: number;
  platformFeeSkr: number;
  netPayoutSkr: number;
  payoutRatio: number;
  status: PredictionPayoutStatus;
  claimableAt?: string;
  claimDeadline?: string;
  claimedAt?: string;
  txSignature?: string;
  createdAt: string;
}

export interface PredictionMarket extends OpinionPoll {
  isPrediction: true;
  minStakeSkr: number;
  maxStakeSkr: number;
  platformFeePct: number;
  disputeFreeze?: boolean;
  pool?: PredictionPool;
  userStakes?: PredictionStake[];
}

export interface PredictionStakeRequest {
  pollId: string;
  side: OpinionSide;
  amountSkr: number;
  txSignature: string;
}

export interface PredictionStakeReceipt {
  stakeId: string;
  pollId: string;
  side: OpinionSide;
  amountSkr: number;
  pool: PredictionPool;
  potentialPayout: number;
  createdAt: string;
}

export interface PredictionUserPortfolio {
  activeStakes: Array<PredictionStake & { poll: OpinionPoll; potentialPayout: number }>;
  resolvedStakes: Array<PredictionStake & { poll: OpinionPoll; payout?: PredictionPayout; resolution?: ResolutionSummary }>;
  totalStakedSkr: number;
  totalWonSkr: number;
  totalLostSkr: number;
  pendingPayoutsSkr: number;
}
