import type { ReactionCounts } from "./reaction.js";

export type FeedCardType = "news" | "alpha" | "threat" | "opinion" | "report" | "sponsored" | "prediction";

export interface TokenContext {
  symbol: string;
  priceUsd?: number;
  change1hPct?: number;
  marketCapUsd?: number;
}

export interface FeedCard {
  id: string;
  headline: string;
  summary60: string;
  imageUrl?: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  clusterId: string;
  language: string;
  category?: string;
  cardType?: FeedCardType;
  tokenContext?: TokenContext;
  reactionCounts?: ReactionCounts;
  sponsored?: {
    id: string;
    advertiserName: string;
    destinationUrl: string;
    ctaText: string;
    accentColor: string;
    cardFormat?: string;
    placement?: "feed" | "predict" | "both";
    targetAudience?: string;
    campaignGoal?: string;
    actionUrl?: string;
  };
  prediction?: {
    pollId: string;
    question: string;
    yesOdds: number;
    noOdds: number;
    totalPoolSkr: number;
    deadlineAt: string;
    status: string;
  };
}

export interface FeedQuery {
  cursor?: string;
  category?: string;
  lang?: string;
  limit?: number;
}

export interface FeedPage {
  items: FeedCard[];
  nextCursor?: string;
}

export interface FeedFreshness {
  latestFeedItemPublishedAt?: string;
  latestIngestionFinishedAt?: string;
  stale: boolean;
  staleMinutes: number;
}

export interface SourceSummary {
  id: string;
  name: string;
  homepageUrl: string;
  feedUrl: string;
  languageHint?: string;
  compliant: boolean;
}
