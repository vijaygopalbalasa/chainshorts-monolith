import { canonicalizeUrl, computeClusterId, computeDedupHash, type NormalizedArticle, type RawArticle } from "@chainshorts/shared";
import type { RssEntry } from "./fetchRss.js";

function toIsoDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

export function normalizeEntry(sourceId: string, language: string, entry: RssEntry): { raw: RawArticle; normalized: NormalizedArticle } {
  const canonicalUrl = canonicalizeUrl(entry.link);
  const dedupHash = computeDedupHash(entry.title, canonicalUrl);
  const clusterId = computeClusterId(entry.title);
  const publishedAt = toIsoDate(entry.pubDate);

  return {
    raw: {
      sourceId,
      externalId: entry.id,
      url: canonicalUrl,
      headline: entry.title,
      body: entry.description ?? entry.content,
      language,
      imageUrl: entry.imageUrl,
      publishedAt
    },
    normalized: {
      id: `norm_${dedupHash}`,
      sourceId,
      canonicalUrl,
      headline: entry.title,
      originalLanguage: language,
      translatedBody: entry.description ?? entry.content,
      imageUrl: entry.imageUrl,
      publishedAt,
      dedupHash,
      clusterId
    }
  };
}
