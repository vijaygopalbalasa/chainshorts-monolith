export type ReactionType = "bullish" | "bearish" | "insightful" | "skeptical";

export interface ReactionPayload {
  articleId: string;
  wallet: string;
  reactionType: ReactionType;
  nonce: string;
  signature: string;
}

export interface ReactionCounts {
  bullish: number;
  bearish: number;
  insightful: number;
  skeptical: number;
  total: number;
}
