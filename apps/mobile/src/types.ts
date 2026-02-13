import type {
  AlertVoteResult,
  ClientConfigResponse,
  FeedCard,
  FeedFreshness,
  ReactionCounts,
  ThreatAlert,
  WalletBalanceSnapshot
} from "@chainshorts/shared";

export type SessionMode = "guest" | "wallet";

export interface SessionState {
  mode: SessionMode;
  walletAddress?: string;
  sessionToken?: string;
}

export interface FeedResponse {
  items: FeedCard[];
  nextCursor?: string;
}

export interface FeedFreshnessResponse extends FeedFreshness {}

export interface ReactionCountsResponse {
  items: Record<string, ReactionCounts>;
}

export interface SourcesResponse {
  items: Array<{
    id: string;
    name: string;
    homepageUrl: string;
    feedUrl: string;
    compliant: boolean;
  }>;
}

export interface WalletBalancesResponse extends WalletBalanceSnapshot {}

export interface AlertsResponse {
  items: ThreatAlert[];
  nextCursor?: string;
}

export interface AlertVoteResponse extends AlertVoteResult {}

export interface ConfigResponse extends ClientConfigResponse {
  predictions?: {
    disputeChallengeHours: number;
    disputeDepositSkr: number;
  };
}
