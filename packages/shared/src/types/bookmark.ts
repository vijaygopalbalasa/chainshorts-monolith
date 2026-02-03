import type { FeedCard } from "./feed.js";

export interface BookmarkPage {
  items: FeedCard[];
  nextCursor?: string;
}
