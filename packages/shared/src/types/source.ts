export type SourceIngestType = "rss" | "api" | "sitemap";

export interface SourcePolicy {
  id: string;
  sourceId: string;
  robotsCheckedAt: string;
  termsUrl?: string;
  allowsSummary: boolean;
  allowsHeadline: boolean;
  allowsImage: boolean;
  requiresLinkBack: boolean;
  ingestType: SourceIngestType;
  active: boolean;
}

export interface SourceDefinition {
  id: string;
  name: string;
  homepageUrl: string;
  feedUrl: string;
  ingestType: SourceIngestType;
  languageHint?: string;
}

export interface RawArticle {
  sourceId: string;
  externalId: string;
  url: string;
  headline: string;
  body?: string;
  language: string;
  imageUrl?: string;
  publishedAt: string;
}

export interface NormalizedArticle {
  id: string;
  sourceId: string;
  canonicalUrl: string;
  headline: string;
  originalLanguage: string;
  translatedBody?: string;
  imageUrl?: string;
  publishedAt: string;
  dedupHash: string;
  clusterId: string;
}
