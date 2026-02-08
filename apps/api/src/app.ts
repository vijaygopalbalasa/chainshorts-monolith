import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  createReactionSigningMessage,
  createSiwsChallenge,
  DEFAULT_ECONOMY_POLICY,
  extractNonceFromMessage,
  settlePredictionMarket,
  type SettlementSql,
  type EconomyPolicy,
  type FeatureFlags,
  type FeedCard,
  type FeedPage,
  type FeedQuery,
  type ReactionType
} from "@chainshorts/shared";
import { fetchWalletBalances } from "./services/walletBalances.js";
import { DEFAULT_SKR_MINT, resolveSkrTier, resolveTierUnlocks, verifySkrPayment, verifyUsdcPayment, transferSkrPayout } from "./services/skr.js";
import { verifySolanaSignature } from "./services/solanaSignature.js";
import type { Repository } from "./types/repository.js";
import { getAllConfig, getConfigValue, invalidateCache, updateConfig } from "./services/systemConfig.js";
import { PostgresRepository } from "./repositories/postgresRepository.js";

export interface AppOptions {
  repository: Repository;
  platformWallet: string;
  platformWalletSecret?: string; // Base58 encoded private key for payouts
  solanaRpcUrl?: string;
  skrMint?: string;
  economyPolicy?: EconomyPolicy;
  appWebUrl?: string;
  privacyPolicyUrl?: string;
  openRouterApiKey?: string;
  featureFlags?: FeatureFlags;
  trustProxy?: boolean;
  logger?: boolean | Record<string, unknown>;
  adminToken?: string;
  jupiterApiKey?: string;
}

function isValidSolanaAddress(value: string): boolean {
  try {
    void new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  const value = hostname.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1);
  }
  return value;
}

function isPrivateHostname(hostname: string): boolean {
  const value = normalizeHostname(hostname);
  if (
    value === "localhost" ||
    value === "::1" ||
    value === "0:0:0:0:0:0:0:1" ||
    value.endsWith(".local") ||
    value.endsWith(".internal")
  ) {
    return true;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const octets = value.split(".").map((part) => Number.parseInt(part, 10));
    if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
      return true;
    }
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    if (first === 10) return true;
    if (first === 127) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
  }

  return value.includes(":") && (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd"));
}

function parsePublicHttpsUrl(raw: string): URL | null {
  const value = raw.trim();
  if (!value || value.length > 2048) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname || parsed.hostname.length > 253) {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (isPrivateHostname(parsed.hostname)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseActionUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 2048) {
    return null;
  }

  if (value.startsWith("solana-action:")) {
    const inner = value.slice("solana-action:".length);
    const parsedInner = parsePublicHttpsUrl(inner);
    if (!parsedInner) {
      return null;
    }
    return `solana-action:${parsedInner.toString()}`;
  }

  const parsed = parsePublicHttpsUrl(value);
  return parsed ? parsed.toString() : null;
}

function safeTokenEquals(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

const walletAddressSchema = z
  .string()
  .min(32)
  .max(64)
  .refine((value) => isValidSolanaAddress(value), { message: "invalid_wallet_address" });

const challengeSchema = z.object({
  walletAddress: walletAddressSchema
});

const verifySchema = z.object({
  walletAddress: walletAddressSchema,
  message: z.string().min(1).max(4096),
  signature: z.string().min(32).max(256)
});

const logoutSchema = z.object({
  walletAddress: walletAddressSchema
});

const feedQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  category: z.string().optional(),
  lang: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

const feedSearchQuerySchema = feedQuerySchema.extend({
  q: z.string().min(3).max(120)
});

const reactionSchema = z.object({
  articleId: z.string().min(1),
  wallet: walletAddressSchema,
  reactionType: z.enum(["bullish", "bearish", "insightful", "skeptical"] satisfies ReactionType[]),
  nonce: z.string().min(8),
  signature: z.string().min(32)
});

const reactionCountsQuerySchema = z.object({
  articleIds: z.string().min(1)
});

const bookmarkQuerySchema = z.object({
  wallet: walletAddressSchema,
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

const bookmarkWriteSchema = z.object({
  wallet: walletAddressSchema,
  articleId: z.string().min(1)
});

const pushRegisterSchema = z.object({
  deviceId: z.string().min(6).max(160),
  expoPushToken: z.string().min(8).max(256),
  platform: z.enum(["ios", "android"]),
  walletAddress: walletAddressSchema.optional(),
  locale: z.string().max(32).optional(),
  appVersion: z.string().max(32).optional()
});

const pushUnregisterSchema = z.object({
  deviceId: z.string().min(6).max(160),
  expoPushToken: z.string().min(8).max(256),
  walletAddress: walletAddressSchema.optional()
});

const walletBalancesQuerySchema = z.object({
  wallet: walletAddressSchema
});

const alertsQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  severity: z.enum(["RED", "ORANGE", "YELLOW"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  wallet: walletAddressSchema
});

const alertSubmitSchema = z.object({
  wallet: walletAddressSchema,
  txHash: z.string().min(20).max(180),
  observation: z.string().min(8).max(500)
});

const alertVoteParamsSchema = z.object({
  id: z.string().min(1)
});

const alertVoteSchema = z.object({
  wallet: walletAddressSchema,
  vote: z.enum(["helpful", "false_alarm"])
});

// ─── Prediction Market Schemas ─────────────────────────────────────────────────
const predictionsQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(["active", "resolved", "cancelled"]).optional(),
  wallet: walletAddressSchema.optional()
});

const predictionSponsoredQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const predictionParamsSchema = z.object({
  id: z.string().min(1).max(120)
});

const predictionStakeSchema = z.object({
  wallet: walletAddressSchema,
  side: z.enum(["yes", "no"]),
  amountSkr: z.coerce.number().int().min(1).max(999999999),
  txSignature: z.string().min(64).max(128),
  paymentIntentId: z.string().uuid().optional()
});

const predictionStakeIntentSchema = z.object({
  wallet: walletAddressSchema,
  side: z.enum(["yes", "no"]),
  amountSkr: z.coerce.number().int().min(1).max(999999999),
});

const predictionStakesQuerySchema = z.object({
  wallet: walletAddressSchema,
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const predictionClaimSchema = z.object({
  wallet: walletAddressSchema,
  payoutId: z.string().uuid()
});

const contentBoostSchema = z.object({
  wallet: walletAddressSchema,
  contentId: z.string().min(1).max(160),
  durationDays: z.coerce.number().int().min(1).max(30),
  txSignature: z.string().min(64).max(128)
});

const feedbackCreateSchema = z.object({
  type: z.enum(["bug", "suggestion", "other"]),
  subject: z.string().trim().min(1).max(100),
  message: z.string().trim().min(5).max(1000),
  appVersion: z.string().trim().max(32).optional(),
  platform: z.enum(["android", "ios", "web"]).optional()
});

const feedbackListQuerySchema = z.object({
  status: z.enum(["new", "reviewed", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional()
});

const feedbackUpdateParamsSchema = z.object({
  id: z.string().uuid()
});

const feedbackUpdateSchema = z
  .object({
    status: z.enum(["new", "reviewed", "resolved"]).optional(),
    adminNotes: z.string().max(500).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.status === undefined && value.adminNotes === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at_least_one_field_required"
      });
    }
  });

const orphanedPaymentsQuerySchema = z.object({
  status: z.enum(["open", "reviewing", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional()
});

const orphanedPaymentParamsSchema = z.object({
  id: z.string().uuid()
});

const orphanedPaymentUpdateSchema = z
  .object({
    status: z.enum(["open", "reviewing", "resolved"]).optional(),
    adminNotes: z.string().max(500).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.status === undefined && value.adminNotes === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at_least_one_field_required"
      });
    }
  });

const createCampaignSchema = z.object({
  headline:        z.string().min(5).max(120),
  bodyText:        z.string().min(20).max(400),
  imageUrl:        z.string().url().optional(),
  destinationUrl:  z.string().url(),
  ctaText:         z.string().max(30).default("Learn More"),
  accentColor:     z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#14F195"),
  cardFormat:      z.enum(["classic", "banner", "spotlight", "portrait"]).default("classic"),
  placement:       z.enum(["feed", "predict", "both"]).default("feed"),
  targetAudience:  z.enum(["all", "defi_degens", "whales", "nft_collectors"]).default("all"),
  campaignGoal:    z.enum(["traffic", "action", "lead_gen"]).default("traffic"),
  actionUrl:       z.string().max(2048).optional(),
  startsAt:        z.string().datetime().optional(),
  endsAt:          z.string().datetime(),
  impressionLimit: z.number().int().positive().optional(),
}).refine(
  data => data.campaignGoal !== "action" || !!data.actionUrl,
  { message: "actionUrl is required for Blinks (action) campaigns", path: ["actionUrl"] }
);

const updateCampaignSchema = z.object({
  headline:        z.string().min(5).max(120).optional(),
  bodyText:        z.string().min(20).max(400).optional(),
  imageUrl:        z.string().url().nullable().optional(),
  destinationUrl:  z.string().url().optional(),
  ctaText:         z.string().max(30).optional(),
  accentColor:     z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  cardFormat:      z.enum(["classic", "banner", "spotlight", "portrait"]).optional(),
  placement:       z.enum(["feed", "predict", "both"]).optional(),
  targetAudience:  z.enum(["all", "defi_degens", "whales", "nft_collectors"]).optional(),
  campaignGoal:    z.enum(["traffic", "action", "lead_gen"]).optional(),
  actionUrl:       z.string().max(2048).nullable().optional(),
  startsAt:        z.string().datetime().optional(),
  endsAt:          z.string().datetime().optional(),
  impressionLimit: z.number().int().positive().nullable().optional(),
}).superRefine((data, ctx) => {
  if (!Object.keys(data).length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "at_least_one_field_required" });
  }
});

const advertiserOnboardSchema = z.object({
  companyName: z.string().min(2).max(100),
  websiteUrl:  z.string().url().optional(),
});

const rateLimits = {
  challenge: { max: 20, windowMs: 10 * 60 * 1000 },
  verify: { max: 40, windowMs: 10 * 60 * 1000 },
  feedRead: { max: 360, windowMs: 10 * 60 * 1000 },
  adClick: { max: 60, windowMs: 10 * 60 * 1000 },
  feedbackWrite: { max: 5, windowMs: 10 * 60 * 1000 },
  signedAction: { max: 120, windowMs: 10 * 60 * 1000 },
  pushWrite: { max: 60, windowMs: 10 * 60 * 1000 },
  rpcProxy: { max: 300, windowMs: 10 * 60 * 1000 },
  jupiterProxy: { max: 60, windowMs: 10 * 60 * 1000 }
} as const;

function encodeFeedCursor(item: Pick<FeedCard, "publishedAt" | "id">): string {
  return Buffer.from(`${item.publishedAt}|${item.id}`).toString("base64url");
}

function applyFeedQualityControls(items: FeedCard[], seenClusters: Set<string>): FeedCard[] {
  const filtered: FeedCard[] = [];

  for (const item of items) {
    if (seenClusters.has(item.clusterId)) {
      continue;
    }
    seenClusters.add(item.clusterId);
    filtered.push(item);
  }

  return filtered;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface FeedInjectionConfig {
  predictionMinGap: number;      // Min organic articles before prediction card
  predictionMaxGap: number;      // Max organic articles before prediction card
  sponsoredMinGap: number;       // Min organic articles before sponsored card
  sponsoredMaxGap: number;       // Max organic articles before sponsored card
  maxPredictionsPerPage: number; // Max prediction cards per feed page
}

const DEFAULT_FEED_INJECTION_CONFIG: FeedInjectionConfig = {
  predictionMinGap: 5,
  predictionMaxGap: 8,
  sponsoredMinGap: 2,
  sponsoredMaxGap: 4,
  maxPredictionsPerPage: 3,
};

interface PredictSponsoredConfig {
  enabled: boolean;
  sponsoredMinGap: number;
  sponsoredMaxGap: number;
  maxSponsoredPerPage: number;
}

interface SponsoredPricingConfig {
  defaultImpressionLimit: number;
  cpmClassicUsdc: number;   // in cents
  cpmBannerUsdc: number;
  cpmSpotlightUsdc: number;
  cpmPortraitUsdc: number;
  predictMultiplierPct: number;
  bothMultiplierPct: number;
}

const DEFAULT_PREDICT_SPONSORED_CONFIG: PredictSponsoredConfig = {
  enabled: true,
  sponsoredMinGap: 3,
  sponsoredMaxGap: 6,
  maxSponsoredPerPage: 2,
};

const DEFAULT_SPONSORED_PRICING_CONFIG: SponsoredPricingConfig = {
  defaultImpressionLimit: 5000,
  cpmClassicUsdc: 500,
  cpmBannerUsdc: 800,
  cpmSpotlightUsdc: 1500,
  cpmPortraitUsdc: 2500,
  predictMultiplierPct: 150,
  bothMultiplierPct: 225,
};

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

async function readFeedInjectionConfig(
  repository: Repository
): Promise<Partial<FeedInjectionConfig>> {
  const [
    predictionMinRaw,
    predictionMaxRaw,
    sponsoredMinRaw,
    sponsoredMaxRaw,
    maxPredictionsRaw
  ] = await Promise.all([
    getConfigValue(repository, "feed_prediction_min_gap"),
    getConfigValue(repository, "feed_prediction_max_gap"),
    getConfigValue(repository, "feed_sponsored_min_gap"),
    getConfigValue(repository, "feed_sponsored_max_gap"),
    getConfigValue(repository, "feed_max_predictions_per_page")
  ]);

  const predictionMinGap = parseBoundedInt(
    predictionMinRaw,
    DEFAULT_FEED_INJECTION_CONFIG.predictionMinGap,
    1,
    20
  );
  const predictionMaxGap = Math.max(
    predictionMinGap,
    parseBoundedInt(
      predictionMaxRaw,
      DEFAULT_FEED_INJECTION_CONFIG.predictionMaxGap,
      1,
      20
    )
  );
  const sponsoredMinGap = parseBoundedInt(
    sponsoredMinRaw,
    DEFAULT_FEED_INJECTION_CONFIG.sponsoredMinGap,
    1,
    12
  );
  const sponsoredMaxGap = Math.max(
    sponsoredMinGap,
    parseBoundedInt(
      sponsoredMaxRaw,
      DEFAULT_FEED_INJECTION_CONFIG.sponsoredMaxGap,
      1,
      12
    )
  );
  const maxPredictionsPerPage = parseBoundedInt(
    maxPredictionsRaw,
    DEFAULT_FEED_INJECTION_CONFIG.maxPredictionsPerPage,
    0,
    10
  );

  return {
    predictionMinGap,
    predictionMaxGap,
    sponsoredMinGap,
    sponsoredMaxGap,
    maxPredictionsPerPage
  };
}

async function readPredictSponsoredConfig(
  repository: Repository
): Promise<PredictSponsoredConfig> {
  const [enabledRaw, minGapRaw, maxGapRaw, maxPerPageRaw] = await Promise.all([
    getConfigValue(repository, "predict_sponsored_enabled"),
    getConfigValue(repository, "predict_sponsored_min_gap"),
    getConfigValue(repository, "predict_sponsored_max_gap"),
    getConfigValue(repository, "predict_max_sponsored_per_page"),
  ]);

  const sponsoredMinGap = parseBoundedInt(
    minGapRaw,
    DEFAULT_PREDICT_SPONSORED_CONFIG.sponsoredMinGap,
    1,
    20
  );
  const sponsoredMaxGap = Math.max(
    sponsoredMinGap,
    parseBoundedInt(
      maxGapRaw,
      DEFAULT_PREDICT_SPONSORED_CONFIG.sponsoredMaxGap,
      1,
      20
    )
  );
  const maxSponsoredPerPage = parseBoundedInt(
    maxPerPageRaw,
    DEFAULT_PREDICT_SPONSORED_CONFIG.maxSponsoredPerPage,
    0,
    10
  );

  return {
    enabled: parseBoolean(enabledRaw, DEFAULT_PREDICT_SPONSORED_CONFIG.enabled),
    sponsoredMinGap,
    sponsoredMaxGap,
    maxSponsoredPerPage,
  };
}

async function readSponsoredPricingConfig(
  repository: Repository
): Promise<SponsoredPricingConfig> {
  const [
    defaultImpressionLimitRaw,
    cpmClassicRaw,
    cpmBannerRaw,
    cpmSpotlightRaw,
    cpmPortraitRaw,
    predictMultiplierRaw,
    bothMultiplierRaw,
  ] = await Promise.all([
    getConfigValue(repository, "sponsored_default_impression_limit"),
    getConfigValue(repository, "sponsored_cpm_classic_usdc_cents"),
    getConfigValue(repository, "sponsored_cpm_banner_usdc_cents"),
    getConfigValue(repository, "sponsored_cpm_spotlight_usdc_cents"),
    getConfigValue(repository, "sponsored_cpm_portrait_usdc_cents"),
    getConfigValue(repository, "sponsored_predict_multiplier_pct"),
    getConfigValue(repository, "sponsored_both_multiplier_pct"),
  ]);

  return {
    defaultImpressionLimit: parseBoundedInt(
      defaultImpressionLimitRaw,
      DEFAULT_SPONSORED_PRICING_CONFIG.defaultImpressionLimit,
      1000,
      100000
    ),
    cpmClassicUsdc: parseBoundedInt(
      cpmClassicRaw,
      DEFAULT_SPONSORED_PRICING_CONFIG.cpmClassicUsdc,
      1,
      100000
    ),
    cpmBannerUsdc: parseBoundedInt(
      cpmBannerRaw,
      DEFAULT_SPONSORED_PRICING_CONFIG.cpmBannerUsdc,
      1,
      100000
    ),
    cpmSpotlightUsdc: parseBoundedInt(
      cpmSpotlightRaw,
      DEFAULT_SPONSORED_PRICING_CONFIG.cpmSpotlightUsdc,
      1,
      100000
    ),
    cpmPortraitUsdc: parseBoundedInt(
      cpmPortraitRaw,
      DEFAULT_SPONSORED_PRICING_CONFIG.cpmPortraitUsdc,
      1,
      100000
    ),
    predictMultiplierPct: parseBoundedInt(
      predictMultiplierRaw,
      DEFAULT_SPONSORED_PRICING_CONFIG.predictMultiplierPct,
      100,
      1000
    ),
    bothMultiplierPct: parseBoundedInt(
      bothMultiplierRaw,
      DEFAULT_SPONSORED_PRICING_CONFIG.bothMultiplierPct,
      100,
      1500
    ),
  };
}

function computeSponsoredInvoice(input: {
  pricing: SponsoredPricingConfig;
  cardFormat: "classic" | "banner" | "spotlight" | "portrait";
  placement: "feed" | "predict" | "both";
  impressionLimit?: number | null;
}): {
  impressionLimit: number;
  cpmUsdc: number;
  billingAmountUsdc: number;
} {
  const impressionLimit = input.impressionLimit ?? input.pricing.defaultImpressionLimit;
  const baseCpmUsdc =
    input.cardFormat === "banner"
      ? input.pricing.cpmBannerUsdc
      : input.cardFormat === "spotlight"
      ? input.pricing.cpmSpotlightUsdc
      : input.cardFormat === "portrait"
      ? input.pricing.cpmPortraitUsdc
      : input.pricing.cpmClassicUsdc;
  const placementMultiplierPct =
    input.placement === "predict"
      ? input.pricing.predictMultiplierPct
      : input.placement === "both"
      ? input.pricing.bothMultiplierPct
      : 100;
  const pricedCpmUsdc = Math.max(1, Math.ceil((baseCpmUsdc * placementMultiplierPct) / 100));
  const thousandImpressionBlocks = Math.max(1, Math.ceil(impressionLimit / 1000));
  return {
    impressionLimit,
    cpmUsdc: pricedCpmUsdc,
    billingAmountUsdc: Math.max(1, thousandImpressionBlocks * pricedCpmUsdc),
  };
}

function buildSponsoredPaymentRequestUrl(input: {
  platformWallet: string;
  amountUsdc: number;
  headline: string;
}): string {
  const query = new URLSearchParams({
    amount: String(input.amountUsdc / 100), // cents → USDC
    "spl-token": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    label: "Chainshorts Ads",
    message: `Fund approved sponsored campaign: ${input.headline.slice(0, 60)}`,
  });
  return `solana:${input.platformWallet}?${query.toString()}`;
}

async function buildFeedPage(
  query: FeedQuery,
  requestedLimit: number,
  fetcher: (query: FeedQuery) => Promise<FeedPage>,
  repository?: AppOptions["repository"],
  walletAddress?: string,
  injectionConfig?: Partial<FeedInjectionConfig>
): Promise<FeedPage> {
  const seenClusters = new Set<string>();
  const organicItems: FeedCard[] = [];
  const chunkLimit = Math.min(50, Math.max(20, requestedLimit));

  let cursor = query.cursor;
  let iteration = 0;
  const maxIterations = 6;

  while (organicItems.length < requestedLimit && iteration < maxIterations) {
    const page = await fetcher({
      ...query,
      cursor,
      limit: chunkLimit
    });

    if (!page.items.length) {
      break;
    }

    const qualityItems = applyFeedQualityControls(page.items, seenClusters);
    for (const item of qualityItems) {
      organicItems.push(item);
      if (organicItems.length >= requestedLimit) {
        break;
      }
    }

    if (organicItems.length >= requestedLimit) {
      break;
    }

    if (!page.nextCursor || page.nextCursor === cursor) {
      break;
    }

    cursor = page.nextCursor;
    iteration += 1;
  }

  // Inject sponsored cards + prediction market cards into feed
  const config = { ...DEFAULT_FEED_INJECTION_CONFIG, ...injectionConfig };
  let items: FeedCard[] = organicItems;

  if (repository) {
    const sponsored = await repository.getActiveSponsoredCards({ placement: "feed" }).catch(() => []);
    const predictionsResult = await repository.listPredictionMarkets({ status: "active", limit: 20 }).catch(() => ({ items: [] }));
    const allPredictions = predictionsResult.items;

    // Filter feed predictions: hide markets the user has FULLY hedged (both YES+NO active stakes)
    // or any resolved/cancelled market they've already acted on.
    // Markets where user staked only one side are still shown — they can add the opposite side.
    let fullyStakedPollIds = new Set<string>();
    if (walletAddress && allPredictions.length > 0) {
      try {
        const portfolio = await repository.listUserPredictionStakes(walletAddress, 500);
        // Count both-sided active stakes per poll
        const activeSidesByPoll = new Map<string, Set<string>>();
        for (const s of portfolio.activeStakes) {
          const sides = activeSidesByPoll.get(s.pollId) ?? new Set<string>();
          sides.add(s.side);
          activeSidesByPoll.set(s.pollId, sides);
        }
        // Resolved/cancelled polls are always suppressed (market is over)
        for (const s of portfolio.resolvedStakes) {
          fullyStakedPollIds.add(s.pollId);
        }
        // Active polls only suppressed when user has staked BOTH sides
        for (const [pollId, sides] of activeSidesByPoll) {
          if (sides.has("yes") && sides.has("no")) {
            fullyStakedPollIds.add(pollId);
          }
        }
      } catch {
        // Continue with empty set if stake fetch fails
      }
    }

    // Show active markets the user hasn't fully hedged yet
    const predictions = allPredictions.filter((p) => !fullyStakedPollIds.has(p.id));

    if (sponsored.length > 0 || predictions.length > 0) {
      items = [];
      let organicCount = 0;
      let adIdx = 0;
      let predIdx = 0;
      let predictionsInjected = 0;
      // Per-request nonce ensures unique IDs across pagination
      const reqNonce = Date.now().toString(36);
      let nextOrgGap = randomInt(config.sponsoredMinGap, config.sponsoredMaxGap);
      let nextPredGap = randomInt(config.predictionMinGap, config.predictionMaxGap);
      let organicSincePred = 0;

      for (const item of organicItems) {
        items.push(item);
        organicCount++;
        organicSincePred++;

        // Inject prediction card (configurable gap, max per page limit)
        if (
          predictions.length > 0 &&
          organicSincePred >= nextPredGap &&
          organicCount > 0 &&
          predictionsInjected < config.maxPredictionsPerPage &&
          predIdx < predictions.length
        ) {
          const pred = predictions[predIdx]!;
          const pool = pred.pool;
          const totalPool = (pool?.yesPoolSkr ?? 0) + (pool?.noPoolSkr ?? 0);
          const yesOdds = totalPool > 0 ? Math.round(((pool?.noPoolSkr ?? 0) / totalPool) * 100) : 50;
          const noOdds = 100 - yesOdds;

          items.push({
            id: `pred-${reqNonce}-${predIdx}`,
            headline: pred.question,
            summary60: `YES ${yesOdds}% · NO ${noOdds}% — ${totalPool.toLocaleString()} SKR pool`,
            sourceName: "Prediction Market",
            sourceUrl: "",
            publishedAt: pred.createdAt,
            clusterId: `prediction-${pred.id}`,
            language: "en",
            cardType: "prediction",
            prediction: {
              pollId: pred.id,
              question: pred.question,
              yesOdds,
              noOdds,
              totalPoolSkr: totalPool,
              deadlineAt: pred.deadlineAt,
              status: pred.status,
            },
          });
          predIdx++;
          predictionsInjected++;
          organicSincePred = 0;
          nextPredGap = randomInt(config.predictionMinGap, config.predictionMaxGap);
        }

        // Inject sponsored card (configurable gap)
        if (sponsored.length > 0 && organicCount >= nextOrgGap) {
          const ad = sponsored[adIdx % sponsored.length]!;
          items.push({
            id: `sp-${reqNonce}-${adIdx}`,
            headline: ad.headline,
            summary60: ad.bodyText,
            imageUrl: ad.imageUrl ?? undefined,
            sourceName: ad.advertiserName,
            sourceUrl: ad.destinationUrl,
            publishedAt: new Date().toISOString(),
            clusterId: `sponsored-${ad.id}`,
            language: "en",
            cardType: "sponsored",
            sponsored: {
              id: ad.id,
              advertiserName: ad.advertiserName,
              destinationUrl: ad.destinationUrl,
              ctaText: ad.ctaText,
              accentColor: ad.accentColor,
              cardFormat: ad.cardFormat,
              placement: ad.placement,
              targetAudience: ad.targetAudience,
              campaignGoal: ad.campaignGoal,
              actionUrl: ad.actionUrl ?? undefined,
            },
          });
          setImmediate(() => void repository.trackSponsoredEvent(ad.id, "impression").catch((err) => {
            // eslint-disable-next-line no-console -- non-critical fire-and-forget, no request context available
            console.warn(`[ads] impression tracking failed for ${ad.id}:`, err instanceof Error ? err.message : err);
          }));
          adIdx++;
          organicCount = 0;
          nextOrgGap = randomInt(config.sponsoredMinGap, config.sponsoredMaxGap);
        }
      }
    }
  }

  const organicForCursor = organicItems;
  const nextCursor =
    organicForCursor.length >= requestedLimit
      ? encodeFeedCursor(organicForCursor[Math.min(requestedLimit - 1, organicForCursor.length - 1)] as FeedCard)
      : undefined;

  return { items, nextCursor };
}

export function createApp(options: AppOptions) {
  const trustProxyEnabled = options.trustProxy ?? false;
  const solanaRpcUrl = options.solanaRpcUrl ?? "https://mainnet.helius-rpc.com/";
  const skrMint = options.skrMint ?? DEFAULT_SKR_MINT;
  const economyPolicy = options.economyPolicy ?? DEFAULT_ECONOMY_POLICY;
  const appWebUrl = options.appWebUrl ?? "https://chainshorts.live";
  const telegramFeedbackBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const telegramFeedbackChatId = process.env.TELEGRAM_FEEDBACK_CHAT_ID?.trim() || "";
  const featureFlags: FeatureFlags = options.featureFlags ?? {
    alphaFeed: true,
    threatFeed: true,
    opinionPolls: true,
    contentBoosts: true
  };

  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: trustProxyEnabled,
    bodyLimit: 1024 * 1024
  });
  const parsedAppWebOrigin = (() => {
    try {
      return new URL(appWebUrl).origin;
    } catch {
      return null;
    }
  })();

  const sendTelegramFeedback = async (feedback: {
    wallet: string;
    type: "bug" | "suggestion" | "other";
    subject: string;
    message: string;
    appVersion?: string;
    platform?: "android" | "ios" | "web";
  }): Promise<void> => {
    if (!telegramFeedbackBotToken || !telegramFeedbackChatId) {
      return;
    }

    const typeLabel =
      feedback.type === "bug"
        ? "Bug Report"
        : feedback.type === "suggestion"
        ? "Suggestion"
        : "Feedback";
    const walletPreview =
      feedback.wallet.length > 12
        ? `${feedback.wallet.slice(0, 6)}...${feedback.wallet.slice(-4)}`
        : feedback.wallet;
    const appInfo = [feedback.appVersion, feedback.platform].filter(Boolean).join(" · ");
    const lines = [
      `New feedback (${typeLabel})`,
      `From: ${walletPreview}`,
      appInfo ? `App: ${appInfo}` : null,
      "",
      `Subject: ${feedback.subject}`,
      "",
      feedback.message
    ].filter((line): line is string => Boolean(line));

    const response = await fetch(`https://api.telegram.org/bot${telegramFeedbackBotToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: telegramFeedbackChatId,
        text: lines.join("\n")
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`telegram_send_failed_${response.status}`);
    }
  };

  const recordPaymentException = async (input: {
    txSignature: string;
    wallet: string;
    purpose: "prediction_stake" | "dispute_deposit" | "advertiser_campaign";
    expectedAmountSkr: number;
    referenceType: "poll" | "campaign";
    referenceId: string;
    failureReason: string;
    metadata?: Record<string, unknown>;
  }): Promise<string | undefined> => {
    const result = await options.repository.recordOrphanedPayment(input);
    return result.id;
  };

  const resolveAllowedCorsOrigin = (originHeader: string | null): string | null => {
    if (!originHeader) {
      return null;
    }

    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(originHeader);
    } catch {
      return null;
    }

    if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
      return null;
    }

    if (parsedAppWebOrigin && parsedOrigin.origin === parsedAppWebOrigin) {
      return parsedOrigin.origin;
    }

    const hostname = parsedOrigin.hostname.toLowerCase();
    if (parsedOrigin.protocol === "https:" && (hostname === "chainshorts.live" || hostname.endsWith(".chainshorts.live"))) {
      return parsedOrigin.origin;
    }

    return null;
  };

  const enforceRateLimit = (
    bucket: keyof typeof rateLimits,
    requestScope: string,
    reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }
  ): Promise<boolean> => {
    const rule = rateLimits[bucket];
    return options.repository
      .consumeRateLimit(bucket, requestScope, rule.max, rule.windowMs)
      .then((allowed) => {
        if (allowed) {
          return false;
        }

        reply.code(429).send({ error: "rate_limited" });
        return true;
      });
  };

  const readHeaderValue = (value: string | string[] | undefined): string | null => {
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }
    return value ?? null;
  };

  const readSessionToken = (headers: Record<string, string | string[] | undefined>): string | null => {
    const normalizeToken = (raw: string | null): string | null => {
      if (!raw) {
        return null;
      }
      const token = raw.trim();
      if (!token) {
        return null;
      }
      if (token.length < 20 || token.length > 256) {
        return null;
      }
      // Restrict token charset to avoid control chars and parser abuse.
      if (!/^[A-Za-z0-9._:-]+$/.test(token)) {
        return null;
      }
      return token;
    };

    const authHeader = readHeaderValue(headers.authorization);
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      return normalizeToken(authHeader.slice("bearer ".length));
    }

    const sessionHeader = readHeaderValue(headers["x-session-token"]);
    return normalizeToken(sessionHeader);
  };

  const requireSession = async (
    headers: Record<string, string | string[] | undefined>,
    reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }
  ): Promise<{ sessionToken: string; walletAddress: string; expiresAt: string } | null> => {
    const sessionToken = readSessionToken(headers);
    if (!sessionToken) {
      reply.code(401).send({ error: "session_required" });
      return null;
    }

    const session = await options.repository.getSession(sessionToken);
    if (!session) {
      reply.code(401).send({ error: "session_invalid" });
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      reply.code(401).send({ error: "session_expired" });
      return null;
    }

    return session;
  };

  const resolveRequestScope = (request: {
    ip: string;
    raw: { socket?: { remoteAddress?: string | null } };
  }): string => {
    // Use Fastify's resolved IP. With trustProxy enabled, Fastify applies its proxy logic.
    const ip = request.ip?.trim();
    if (ip) {
      return ip;
    }

    // Last-resort fallback to socket address.
    return request.raw.socket?.remoteAddress?.trim() || "unknown";
  };

  const sseConnectionsByScope = new Map<string, number>();
  const MAX_SSE_CONNECTIONS_PER_SCOPE = 3;
  const MAX_TOTAL_SSE = 200;
  const SSE_MAX_CONNECTION_MS = 5 * 60 * 1000;
  let totalSseConnections = 0;

  const requireWalletSession = async (
    headers: Record<string, string | string[] | undefined>,
    walletAddress: string,
    reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }
  ): Promise<boolean> => {
    const session = await requireSession(headers, reply);
    if (!session) {
      return false;
    }

    if (session.walletAddress !== walletAddress) {
      reply.code(403).send({ error: "session_wallet_mismatch" });
      return false;
    }

    return true;
  };

  /**
   * Optionally extract authenticated wallet from request headers.
   * Returns wallet address if x-wallet-address header is present AND
   * the session token in Authorization header matches that wallet.
   * Returns undefined if no auth or invalid session - does NOT fail the request.
   */
  const tryExtractAuthenticatedWallet = async (
    headers: Record<string, string | string[] | undefined>
  ): Promise<string | undefined> => {
    const walletHeader = headers["x-wallet-address"];
    const claimedWallet = (Array.isArray(walletHeader) ? walletHeader[0] : walletHeader)?.trim();
    if (!claimedWallet) {
      return undefined;
    }

    const parsedWallet = walletAddressSchema.safeParse(claimedWallet);
    if (!parsedWallet.success) {
      return undefined;
    }

    const sessionToken = readSessionToken(headers);
    if (!sessionToken) {
      return undefined;
    }

    try {
      const session = await options.repository.getSession(sessionToken);
      if (!session) {
        return undefined;
      }
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        return undefined;
      }
      if (session.walletAddress !== claimedWallet) {
        return undefined;
      }
      return claimedWallet;
    } catch {
      return undefined;
    }
  };

  app.addHook("onSend", async (request, reply, payload) => {
    const requestPath = (request.raw.url ?? "").split("?")[0];
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Permitted-Cross-Domain-Policies", "none");
    reply.header("X-DNS-Prefetch-Control", "off");
    reply.header("Origin-Agent-Cluster", "?1");
    reply.header("Cache-Control", "no-store");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (requestPath === "/admin") {
      // Admin UI uses inline script/style by design, so keep CSP strict but compatible.
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
      );
    } else {
      reply.header("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    }
    // Enforce HTTPS on browsers when served behind TLS.
    if (request.protocol === "https") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    // CORS — restrict to production domain; mobile clients don't use CORS but web wallet integrations will
    const allowedOrigin = resolveAllowedCorsOrigin(readHeaderValue(request.headers.origin));
    if (allowedOrigin) {
      reply.header("Access-Control-Allow-Origin", allowedOrigin);
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Session-Token,X-Wallet-Address,X-Advertiser-Token");
      reply.header("Access-Control-Max-Age", "600");
      reply.header("Vary", "Origin");
    }
    return payload;
  });

  app.options("/*", async (request, reply) => {
    const origin = readHeaderValue(request.headers.origin);
    if (origin) {
      const allowedOrigin = resolveAllowedCorsOrigin(origin);
      if (!allowedOrigin) {
        return reply.code(403).send({ error: "origin_not_allowed" });
      }
    }
    reply.code(204).send();
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/v1/config", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }
    const [disputeChallengeHoursConfig, disputeDepositSkrConfig] = await Promise.all([
      getConfigValue(options.repository, "dispute_challenge_hours"),
      getConfigValue(options.repository, "dispute_deposit_skr")
    ]);
    const disputeChallengeHours = Math.min(
      168,
      Math.max(1, Number.parseInt(disputeChallengeHoursConfig ?? "", 10) || 48)
    );
    const disputeDepositSkr = Math.min(
      1000,
      Math.max(0, Number.parseInt(disputeDepositSkrConfig ?? "", 10) || 50)
    );
    return {
      featureFlags,
      economy: economyPolicy,
      appLinks: {
        appWebUrl,
        privacyPolicyUrl: options.privacyPolicyUrl
      },
      predictions: {
        disputeChallengeHours,
        disputeDepositSkr
      },
      platformWallet: options.platformWallet,
      generatedAt: new Date().toISOString()
    };
  });

  app.post("/v1/auth/challenge", async (request, reply) => {
    if (await enforceRateLimit("challenge", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = challengeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const challenge = createSiwsChallenge(parsed.data.walletAddress);
    await options.repository.createAuthChallenge({
      walletAddress: parsed.data.walletAddress,
      nonce: challenge.nonce,
      message: challenge.message,
      expiresAt: challenge.expiresAt
    });

    return challenge;
  });

  app.post("/v1/auth/verify", async (request, reply) => {
    if (await enforceRateLimit("verify", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const nonce = extractNonceFromMessage(parsed.data.message);
    if (!nonce) {
      return reply.code(400).send({ error: "missing_nonce" });
    }

    const challenge = await options.repository.getAuthChallenge(parsed.data.walletAddress, nonce);
    if (!challenge) {
      return reply.code(401).send({ error: "challenge_not_found" });
    }

    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      await options.repository.deleteAuthChallenge(parsed.data.walletAddress, nonce);
      return reply.code(401).send({ error: "challenge_expired" });
    }

    if (challenge.message !== parsed.data.message) {
      return reply.code(401).send({ error: "message_mismatch" });
    }

    const verified = verifySolanaSignature(parsed.data.message, parsed.data.signature, parsed.data.walletAddress);
    if (!verified) {
      return reply.code(401).send({ error: "signature_invalid" });
    }

    await options.repository.deleteAuthChallenge(parsed.data.walletAddress, nonce);
    const session = await options.repository.createSession(parsed.data.walletAddress);

    return session;
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = logoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const headers = request.headers as Record<string, string | string[] | undefined>;
    const sessionValid = await requireWalletSession(headers, parsed.data.walletAddress, reply);
    if (!sessionValid) {
      return;
    }

    const sessionToken = readSessionToken(headers);
    if (!sessionToken) {
      return reply.code(401).send({ error: "session_required" });
    }

    await options.repository.revokeSession(sessionToken);
    return { ok: true };
  });

  app.post("/v1/auth/logout-all", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = logoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const headers = request.headers as Record<string, string | string[] | undefined>;
    const sessionValid = await requireWalletSession(headers, parsed.data.walletAddress, reply);
    if (!sessionValid) {
      return;
    }

    const revokedCount = await options.repository.revokeAllSessions(parsed.data.walletAddress);
    return { ok: true, revokedCount };
  });

  app.get("/v1/feed", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = feedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const requestedLimit = parsed.data.limit ?? 20;
    // Try to extract wallet for personalized filtering (optional auth - doesn't fail if missing)
    const authenticatedWallet = await tryExtractAuthenticatedWallet(
      request.headers as Record<string, string | string[] | undefined>
    );
    const injectionConfig = await readFeedInjectionConfig(options.repository);
    return buildFeedPage(
      parsed.data,
      requestedLimit,
      async (query) => options.repository.listFeed(query),
      options.repository,
      authenticatedWallet,
      injectionConfig
    );
  });

  app.get("/v1/feed/search", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = feedSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const requestedLimit = parsed.data.limit ?? 20;
    // Try to extract wallet for personalized filtering (optional auth - doesn't fail if missing)
    const authenticatedWallet = await tryExtractAuthenticatedWallet(
      request.headers as Record<string, string | string[] | undefined>
    );
    const injectionConfig = await readFeedInjectionConfig(options.repository);
    return buildFeedPage(
      parsed.data,
      requestedLimit,
      async (query) => options.repository.searchFeed({ ...query, q: parsed.data.q }),
      options.repository,
      authenticatedWallet,
      injectionConfig
    );
  });

  app.get("/v1/feed/freshness", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    return options.repository.getFeedFreshness(new Date());
  });

  app.get<{ Params: { id: string } }>("/v1/articles/:id", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }
    const article = await options.repository.getArticleById(request.params.id);
    if (!article) {
      return reply.code(404).send({ error: "not_found" });
    }

    return article;
  });

  app.get("/v1/sources", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }
    const items = await options.repository.listSources();
    return { items };
  });

  app.get("/v1/wallet/balances", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = walletBalancesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    try {
      const balances = await fetchWalletBalances({
        rpcUrl: solanaRpcUrl,
        walletAddress: parsed.data.wallet,
        skrMint
      });
      const tier = resolveSkrTier(balances.skrUi, economyPolicy.tiers);

      // Only persist the snapshot when the requester owns the wallet (session matches).
      const sessionToken = readSessionToken(request.headers as Record<string, string | string[] | undefined>);
      if (sessionToken) {
        const sess = await options.repository.getSession(sessionToken);
        if (sess?.walletAddress === parsed.data.wallet) {
          await options.repository.upsertWalletSkrSnapshot({
            wallet: parsed.data.wallet,
            balanceSkr: balances.skrUi,
            observedAt: new Date().toISOString()
          });
        }
      }
      return {
        wallet: parsed.data.wallet,
        solLamports: balances.solLamports,
        skrRaw: balances.skrRaw,
        skrUi: balances.skrUi,
        usdcRaw: balances.usdcRaw,
        usdcUi: balances.usdcUi,
        usdtRaw: balances.usdtRaw,
        usdtUi: balances.usdtUi,
        tier,
        unlocks: resolveTierUnlocks(tier),
        asOf: new Date().toISOString()
      };
    } catch (error) {
      return reply.code(502).send({
        error: "wallet_balance_unavailable",
        details: "rpc_error"
      });
    }
  });

  app.get("/v1/reactions/counts", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = reactionCountsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const articleIds = [...new Set(parsed.data.articleIds.split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 50);
    if (!articleIds.length) {
      return reply.code(400).send({ error: "invalid_query", details: "articleIds must not be empty" });
    }

    const items = await options.repository.getReactionCounts(articleIds);
    return { items };
  });

  app.post("/v1/reactions/sign", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = reactionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    const message = createReactionSigningMessage({
      articleId: parsed.data.articleId,
      reactionType: parsed.data.reactionType,
      nonce: parsed.data.nonce
    });

    const verified = verifySolanaSignature(message, parsed.data.signature, parsed.data.wallet);
    if (!verified) {
      return reply.code(401).send({ error: "signature_invalid" });
    }

    const status = await options.repository.saveReaction(parsed.data);
    if (status === "duplicate") {
      return reply.code(409).send({ error: "duplicate_reaction" });
    }

    return { ok: true };
  });

  app.get("/v1/bookmarks", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = bookmarkQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    return options.repository.listBookmarks(parsed.data);
  });

  app.post("/v1/bookmarks", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = bookmarkWriteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    const status = await options.repository.addBookmark(parsed.data.wallet, parsed.data.articleId);
    if (status === "not_found") {
      return reply.code(404).send({ error: "article_not_found" });
    }
    if (status === "duplicate") {
      return reply.code(409).send({ error: "bookmark_exists" });
    }

    return { ok: true };
  });

  app.delete("/v1/bookmarks", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = bookmarkWriteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    const removed = await options.repository.removeBookmark(parsed.data.wallet, parsed.data.articleId);
    if (!removed) {
      return reply.code(404).send({ error: "bookmark_not_found" });
    }

    return { ok: true };
  });

  app.post("/v1/push/register", async (request, reply) => {
    if (await enforceRateLimit("pushWrite", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = pushRegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    if (parsed.data.walletAddress) {
      const sessionValid = await requireWalletSession(
        request.headers as Record<string, string | string[] | undefined>,
        parsed.data.walletAddress,
        reply
      );
      if (!sessionValid) {
        return;
      }
    }

    await options.repository.upsertPushSubscription({
      deviceId: parsed.data.deviceId,
      expoPushToken: parsed.data.expoPushToken,
      platform: parsed.data.platform,
      walletAddress: parsed.data.walletAddress,
      locale: parsed.data.locale,
      appVersion: parsed.data.appVersion
    });

    return { ok: true };
  });

  app.post("/v1/push/unregister", async (request, reply) => {
    if (await enforceRateLimit("pushWrite", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = pushUnregisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    if (parsed.data.walletAddress) {
      const sessionValid = await requireWalletSession(
        request.headers as Record<string, string | string[] | undefined>,
        parsed.data.walletAddress,
        reply
      );
      if (!sessionValid) {
        return;
      }
    }

    await options.repository.removePushSubscription(parsed.data.deviceId, parsed.data.expoPushToken);
    return { ok: true };
  });

  app.get("/v1/alerts", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = alertsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    if (!featureFlags.threatFeed) {
      return { items: [] };
    }

    // Server-side auth: session must be valid for the provided wallet
    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    const page = await options.repository.listAlerts({
      cursor: parsed.data.cursor,
      severity: parsed.data.severity,
      limit: parsed.data.limit
    });
    return page;
  });

  app.post("/v1/alerts/submit", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = alertSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    if (!featureFlags.threatFeed) {
      return reply.code(403).send({ error: "feature_disabled" });
    }

    const confidence = 0.3;

    const result = await options.repository.submitAlert({ ...parsed.data, confidence });
    return result;
  });

  app.post<{ Params: { id: string } }>("/v1/alerts/:id/vote", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsedParams = alertVoteParamsSchema.safeParse(request.params);
    const parsedBody = alertVoteSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsedBody.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    try {
      const result = await options.repository.voteAlert({
        alertId: parsedParams.data.id,
        wallet: parsedBody.data.wallet,
        vote: parsedBody.data.vote
      });
      return result;
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      // Only expose known safe error codes to the client; never forward raw DB/system errors
      const safe = raw === "alert_not_found" ? "alert_not_found" : "alert_vote_failed";
      return reply.code(safe === "alert_not_found" ? 404 : 500).send({ error: safe });
    }
  });

  // ─── Prediction Markets (Polymarket-style staking) ─────────────────────────────

  app.get("/v1/predictions", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = predictionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    // Check if predictions are enabled
    const predictionsEnabled = await getConfigValue(options.repository, "predictions_enabled");
    if (predictionsEnabled !== "true") {
      return { items: [], nextCursor: undefined };
    }

    if (parsed.data.wallet) {
      const sessionValid = await requireWalletSession(
        request.headers as Record<string, string | string[] | undefined>,
        parsed.data.wallet,
        reply
      );
      if (!sessionValid) {
        return;
      }
    }

    const page = await options.repository.listPredictionMarkets({
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
      status: parsed.data.status,
      wallet: parsed.data.wallet
    });
    return page;
  });

  app.get("/v1/predictions/sponsored", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = predictionSponsoredQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const strategy = await readPredictSponsoredConfig(options.repository);
    const predictionsEnabled = await getConfigValue(options.repository, "predictions_enabled");
    if (!strategy.enabled || predictionsEnabled !== "true") {
      return { cards: [], strategy };
    }

    const cards = await options.repository.getActiveSponsoredCards({
      placement: "predict",
      limit: parsed.data.limit ?? 10,
    }).catch(() => []);
    const selected = cards.slice(0, parsed.data.limit ?? 10).map((ad) => ({
      id: `predict-sponsored-${ad.id}`,
      headline: ad.headline,
      summary60: ad.bodyText,
      imageUrl: ad.imageUrl ?? undefined,
      sourceName: ad.advertiserName,
      sourceUrl: ad.destinationUrl,
      publishedAt: new Date().toISOString(),
      clusterId: `sponsored-${ad.id}`,
      language: "en",
      cardType: "sponsored" as const,
      sponsored: {
        id: ad.id,
        advertiserName: ad.advertiserName,
        destinationUrl: ad.destinationUrl,
        ctaText: ad.ctaText,
        accentColor: ad.accentColor,
        cardFormat: ad.cardFormat,
        placement: ad.placement,
        targetAudience: ad.targetAudience,
        campaignGoal: ad.campaignGoal,
        actionUrl: ad.actionUrl ?? undefined,
      },
    }));

    return { cards: selected, strategy };
  });

  app.get<{ Params: { id: string } }>("/v1/predictions/:id", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsedParams = predictionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "invalid_params", details: parsedParams.error.flatten() });
    }

    // Check wallet for user stakes
    let authenticatedWallet: string | undefined;
    const walletHeader = (request.headers as Record<string, string | string[] | undefined>)["x-wallet-address"];
    let claimedWallet = (Array.isArray(walletHeader) ? walletHeader[0] : walletHeader)?.trim();
    if (claimedWallet) {
      const parsedWallet = walletAddressSchema.safeParse(claimedWallet);
      if (!parsedWallet.success) {
        claimedWallet = undefined;
      }
    }
    if (claimedWallet) {
      const sessionToken = readSessionToken(request.headers as Record<string, string | string[] | undefined>);
      if (sessionToken) {
        const sess = await options.repository.getSession(sessionToken);
        if (sess?.walletAddress === claimedWallet) {
          authenticatedWallet = claimedWallet;
        }
      }
    }

    const market = await options.repository.getPredictionMarketById(parsedParams.data.id, authenticatedWallet);
    if (!market) {
      return reply.code(404).send({ error: "prediction_not_found" });
    }
    return market;
  });

  app.get<{ Params: { id: string } }>("/v1/predictions/:id/pool", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsedParams = predictionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "invalid_params", details: parsedParams.error.flatten() });
    }

    const pool = await options.repository.getPredictionPool(parsedParams.data.id);
    if (!pool) {
      return reply.code(404).send({ error: "pool_not_found" });
    }
    return pool;
  });

  app.post<{ Params: { id: string } }>("/v1/predictions/:id/stake-intent", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsedParams = predictionParamsSchema.safeParse(request.params);
    const parsedBody = predictionStakeIntentSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    const predictionsEnabled = await getConfigValue(options.repository, "predictions_enabled");
    if (predictionsEnabled !== "true") {
      return reply.code(403).send({ error: "predictions_disabled" });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsedBody.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    const result = await options.repository.createPredictionStakePaymentIntent({
      pollId: parsedParams.data.id,
      wallet: parsedBody.data.wallet,
      side: parsedBody.data.side,
      amountSkr: parsedBody.data.amountSkr,
    });

    if (!result.success) {
      if (result.reason === "prediction_not_found") {
        return reply.code(404).send({ error: "prediction_not_found" });
      }
      if (result.reason === "market_not_active") {
        return reply.code(409).send({ error: "market_not_active" });
      }
      if (result.reason === "stake_below_minimum") {
        return reply.code(400).send({ error: "stake_below_minimum", minStakeSkr: result.minStakeSkr });
      }
      if (result.reason === "stake_above_maximum") {
        return reply.code(400).send({ error: "stake_above_maximum", maxStakeSkr: result.maxStakeSkr });
      }
      return reply.code(409).send({ error: "stake_intent_create_failed" });
    }

    return {
      ok: true,
      paymentIntentId: result.reservation.id,
      expiresAt: result.reservation.expiresAt,
      amountSkr: parsedBody.data.amountSkr,
    };
  });

  app.post<{ Params: { id: string } }>("/v1/predictions/:id/stake", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsedParams = predictionParamsSchema.safeParse(request.params);
    const parsedBody = predictionStakeSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    // Check if predictions are enabled
    const predictionsEnabled = await getConfigValue(options.repository, "predictions_enabled");
    if (predictionsEnabled !== "true") {
      return reply.code(403).send({ error: "predictions_disabled" });
    }

    // Require authenticated session
    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsedBody.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    // Get prediction market for quick pre-validation.
    // The repository re-checks all constraints atomically at write time.
    const market = await options.repository.getPredictionMarketById(parsedParams.data.id);
    if (!market) {
      return reply.code(404).send({ error: "prediction_not_found" });
    }

    if (market.status !== "active" || (market.deadlineAt && new Date(market.deadlineAt) <= new Date())) {
      return reply.code(409).send({ error: "market_not_active" });
    }

    if (parsedBody.data.amountSkr < market.minStakeSkr) {
      return reply.code(400).send({ error: "stake_below_minimum", minStakeSkr: market.minStakeSkr });
    }
    if (parsedBody.data.amountSkr > market.maxStakeSkr) {
      return reply.code(400).send({ error: "stake_above_maximum", maxStakeSkr: market.maxStakeSkr });
    }

    // Verify SKR payment on-chain
    const rpcUrl = options.solanaRpcUrl ?? "https://mainnet.helius-rpc.com/";
    const txVerify = await verifySkrPayment({
      txSignature: parsedBody.data.txSignature,
      fromWallet: parsedBody.data.wallet,
      toWallet: options.platformWallet,
      minAmountUi: parsedBody.data.amountSkr,
      rpcUrl,
      skrMint: options.skrMint ?? DEFAULT_SKR_MINT
    });

    if (!txVerify.ok) {
      request.log.warn(
        { pollId: parsedParams.data.id, wallet: parsedBody.data.wallet, txSignature: parsedBody.data.txSignature, reason: txVerify.reason },
        "[stake] payment verification failed"
      );
      return reply.code(400).send({ error: "invalid_payment", reason: txVerify.reason });
    }

    const result = await options.repository.atomicStakeOnPrediction({
      pollId: parsedParams.data.id,
      wallet: parsedBody.data.wallet,
      side: parsedBody.data.side,
      amountSkr: parsedBody.data.amountSkr,
      txSignature: parsedBody.data.txSignature,
      paymentIntentId: parsedBody.data.paymentIntentId,
    });

    if (!result.success) {
      if (result.reason === "tx_already_used") {
        return reply.code(409).send({ error: "tx_already_used" });
      }
      const paymentExceptionId = await recordPaymentException({
        txSignature: parsedBody.data.txSignature,
        wallet: parsedBody.data.wallet,
        purpose: "prediction_stake",
        expectedAmountSkr: parsedBody.data.amountSkr,
        referenceType: "poll",
        referenceId: parsedParams.data.id,
        failureReason: result.reason,
        metadata: {
          side: parsedBody.data.side,
          minStakeSkr: result.minStakeSkr,
          maxStakeSkr: result.maxStakeSkr
        }
      });
      const statusCode =
        result.reason === "stake_below_minimum" || result.reason === "stake_above_maximum"
          ? 400
          : 409;
      return reply.code(statusCode).send({
        error: "stake_rejected_after_payment",
        reason: result.reason,
        minStakeSkr: result.minStakeSkr,
        maxStakeSkr: result.maxStakeSkr,
        paymentExceptionId
      });
    }

    return result.receipt;
  });

  app.get("/v1/predictions/stakes", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = predictionStakesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    const portfolio = await options.repository.listUserPredictionStakes(parsed.data.wallet, parsed.data.limit);
    return portfolio;
  });

  app.post("/v1/predictions/claim", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = predictionClaimSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    // Step 1: Reserve payout claim atomically before transfer
    const result = await options.repository.claimPredictionPayout({
      payoutId: parsed.data.payoutId,
      wallet: parsed.data.wallet
    });

    if (!result.success) {
      if (result.reason === "already_claimed") {
        return reply.code(409).send({ error: "payout_already_claimed" });
      }
      if (result.reason === "frozen") {
        return reply.code(409).send({ error: "payout_frozen_dispute_pending" });
      }
      if (result.reason === "transfer_in_progress") {
        return reply.code(409).send({ error: "payout_transfer_in_progress" });
      }
      if (result.reason === "not_yet_claimable") {
        return reply.code(409).send({
          error: "claim_not_yet_available",
          claimableAt: result.claimableAt
        });
      }
      return reply.code(404).send({ error: "payout_not_found" });
    }

    // Step 2: Execute SKR transfer to winner
    if (options.platformWalletSecret && solanaRpcUrl && result.netPayoutSkr > 0) {
      const transferResult = await transferSkrPayout({
        rpcUrl: solanaRpcUrl,
        platformWalletSecret: options.platformWalletSecret,
        toWallet: parsed.data.wallet,
        skrMint: skrMint,
        amountUi: result.netPayoutSkr
      });

      if (transferResult.success) {
        // Finalize payout claim only after transfer succeeds
        await options.repository.recordPayoutTransfer({
          payoutId: parsed.data.payoutId,
          txSignature: transferResult.txSignature,
          transferStatus: "completed"
        });
        return {
          ...result,
          txSignature: transferResult.txSignature,
          transferStatus: "completed"
        };
      } else {
        // Keep payout pending; allow safe retry without double-paying.
        request.log.error({ payoutId: parsed.data.payoutId, error: transferResult.error }, "[claim] SKR transfer failed");
        await options.repository.markPayoutTransferFailed({
          payoutId: parsed.data.payoutId,
          error: transferResult.error!
        });
        return reply.code(202).send({
          ...result,
          transferStatus: "failed",
          transferError: transferResult.error,
          message: "Transfer pending. Retry to complete."
        });
      }
    }

    // No automatic transfer path: keep the payout pending and surface a retryable state.
    // Require BOTH secret AND rpcUrl to mark completed — secret without rpcUrl means no transfer occurred.
    const transferStatus = (options.platformWalletSecret && solanaRpcUrl) ? "completed" : "manual_required";
    await options.repository.recordPayoutTransfer({
      payoutId: parsed.data.payoutId,
      transferStatus
    });
    if (transferStatus === "manual_required") {
      return reply.code(202).send({
        ...result,
        transferStatus,
        message: "Transfer temporarily unavailable. Retry to complete."
      });
    }
    return {
      ...result,
      transferStatus
    };
  });

  // POST /v1/predictions/stakes/:stakeId/cashout — Early exit with 5% penalty
  const cashoutParamsSchema = z.object({ stakeId: z.string().uuid() });
  const cashoutBodySchema = z.object({ wallet: walletAddressSchema });

  app.post<{ Params: { stakeId: string } }>("/v1/predictions/stakes/:stakeId/cashout", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) {
      return;
    }

    const parsedParams = cashoutParamsSchema.safeParse(request.params);
    const parsedBody = cashoutBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    const { stakeId } = parsedParams.data;
    const { wallet } = parsedBody.data;

    // Require authenticated session
    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    // Attempt cash-out (atomically cancels stake and reduces pool aggregates).
    // Minimum check happens inside the transaction BEFORE the stake is cancelled.
    const result = await options.repository.cashOutPredictionStake(stakeId, wallet);
    if (result === null) {
      return reply.code(404).send({ error: "stake_not_found_or_inactive" });
    }
    if (result === "in_progress") {
      return reply.code(409).send({ error: "cashout_transfer_in_progress" });
    }
    if (result === "below_minimum") {
      return reply.code(400).send({ error: "minimum_cashout_not_met", minimum: 10, message: "Stake must be at least 10 SKR to cash out early" });
    }

    const { stakeAmount } = result;
    // Round to 6 decimal places (SKR token precision) — never floor and steal user's 0.5 SKR
    const cashoutAmount = Math.round(stakeAmount * 0.95 * 1_000_000) / 1_000_000;
    const penaltyAmount = stakeAmount - cashoutAmount;

    if (!options.platformWalletSecret || !solanaRpcUrl || cashoutAmount <= 0) {
      await options.repository.updateStakeCashoutTransfer(stakeId, wallet, null, "failed");
      return reply.code(503).send({
        error: "cashout_temporarily_unavailable",
        message: "Cashout is temporarily unavailable. Your stake remains active."
      });
    }

    // Transfer SKR back to user from platform wallet
    let txSignature: string | null = null;
    try {
      const transferResult = await transferSkrPayout({
        rpcUrl: solanaRpcUrl,
        platformWalletSecret: options.platformWalletSecret,
        toWallet: wallet,
        skrMint: skrMint,
        amountUi: cashoutAmount
      });
      if (transferResult.success) {
        txSignature = transferResult.txSignature ?? null;
        await options.repository.updateStakeCashoutTransfer(stakeId, wallet, txSignature, "complete");
      } else {
        request.log.error({ stakeId, error: transferResult.error }, "[cashout] SKR transfer failed");
        await options.repository.updateStakeCashoutTransfer(stakeId, wallet, null, "failed");
        return reply.code(202).send({
          ok: false,
          cashoutAmount,
          originalStake: stakeAmount,
          penaltyAmount,
          txSignature: null,
          transferStatus: "failed",
          message: "Cashout could not be completed. Your stake remains active."
        });
      }
    } catch (err) {
      request.log.error({ stakeId, err }, "[cashout] SKR transfer threw");
      await options.repository.updateStakeCashoutTransfer(stakeId, wallet, null, "failed");
      return reply.code(202).send({
        ok: false,
        cashoutAmount,
        originalStake: stakeAmount,
        penaltyAmount,
        txSignature: null,
        transferStatus: "failed",
        message: "Cashout could not be completed. Your stake remains active."
      });
    }

    return reply.send({
      ok: true,
      cashoutAmount,
      originalStake: stakeAmount,
      penaltyAmount,
      txSignature,
      transferStatus: "complete",
    });
  });

  // ── Prediction Leaderboard ─────────────────────────────────────────────────

  const leaderboardQuerySchema = z.object({
    period: z.enum(["all", "week", "month"]).default("all"),
    sortBy: z.enum(["profit", "winRate", "volume"]).default("profit"),
    limit: z.coerce.number().int().min(1).max(100).default(100)
  });

  app.get("/v1/predictions/leaderboard", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) {
      return;
    }

    const parsed = leaderboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const leaderboard = await options.repository.getPredictionLeaderboard({
      period: parsed.data.period,
      sortBy: parsed.data.sortBy,
      limit: parsed.data.limit
    });

    // Get user rank if authenticated
    let userRank = null;
    const wallet = readHeaderValue(request.headers["x-wallet-address"]);
    if (wallet && isValidSolanaAddress(wallet)) {
      userRank = await options.repository.getUserPredictionRank(wallet, parsed.data.period, parsed.data.sortBy);
    }

    return { leaderboard, userRank };
  });

  // ── Prediction Disputes ────────────────────────────────────────────────────

  const disputeBodySchema = z.object({
    wallet: walletAddressSchema,
    reason: z.string().min(10).max(2000),
    evidenceUrls: z.array(z.string().url()).max(10).optional(),
    depositTxSignature: z.string().min(64).max(128).optional(),
    paymentIntentId: z.string().uuid().optional(),
  });

  const disputeIntentSchema = z.object({
    wallet: walletAddressSchema,
  });

  app.post("/v1/predictions/:id/dispute-intent", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) return;

    const parsedParams = predictionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "invalid_params", details: parsedParams.error.flatten() });
    }
    const parsed = disputeIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const pollId = parsedParams.data.id;
    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) return;

    const [depositSkrConfig, challengeWindowHoursConfig] = await Promise.all([
      getConfigValue(options.repository, "dispute_deposit_skr"),
      getConfigValue(options.repository, "dispute_challenge_hours")
    ]);
    const depositSkr = depositSkrConfig ? parseInt(depositSkrConfig, 10) : 50;
    const challengeWindowHours = Math.min(
      168,
      Math.max(1, Number.parseInt(challengeWindowHoursConfig ?? "", 10) || 48)
    );

    const result = await options.repository.createPredictionDisputePaymentIntent({
      pollId,
      wallet: parsed.data.wallet,
      depositSkr,
      challengeWindowHours
    });

    if (!result.success) {
      if (result.reason === "poll_not_found") {
        return reply.code(404).send({ error: "poll_not_found" });
      }
      if (result.reason === "poll_not_resolved") {
        return reply.code(400).send({ error: "poll_not_resolved" });
      }
      if (result.reason === "challenge_window_closed") {
        return reply.code(400).send({
          error: "challenge_window_closed",
          challengeDeadline: result.challengeDeadline
        });
      }
      if (result.reason === "dispute_already_filed") {
        return reply.code(409).send({ error: "dispute_already_filed" });
      }
      return reply.code(409).send({ error: "dispute_intent_create_failed" });
    }

    return {
      ok: true,
      paymentIntentId: result.reservation.id,
      expiresAt: result.reservation.expiresAt,
      challengeDeadline: result.challengeDeadline,
      depositSkr,
    };
  });

  app.post("/v1/predictions/:id/dispute", async (request, reply) => {
    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) return;

    const parsedParams = predictionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "invalid_params", details: parsedParams.error.flatten() });
    }
    const pollId = parsedParams.data.id;
    const parsed = disputeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsed.data.wallet,
      reply
    );
    if (!sessionValid) return;

    // Check poll exists and is resolved before on-chain verification.
    // Atomic repository operation re-checks this under row lock.
    const poll = await options.repository.getPredictionMarketById(pollId, parsed.data.wallet);
    if (!poll) {
      return reply.code(404).send({ error: "poll_not_found" });
    }
    if (poll.status !== "resolved") {
      return reply.code(400).send({ error: "poll_not_resolved" });
    }

    // Get dispute settings from config
    const [depositSkrConfig, challengeWindowHoursConfig] = await Promise.all([
      getConfigValue(options.repository, "dispute_deposit_skr"),
      getConfigValue(options.repository, "dispute_challenge_hours")
    ]);
    const depositSkr = depositSkrConfig ? parseInt(depositSkrConfig, 10) : 50;
    const challengeWindowHours = Math.min(
      168,
      Math.max(1, Number.parseInt(challengeWindowHoursConfig ?? "", 10) || 48)
    );

    if (depositSkr > 0 && !parsed.data.depositTxSignature) {
      return reply.code(400).send({ error: "deposit_tx_required" });
    }

    // Pre-check: reject duplicate disputes before on-chain payment verification.
    // Without this, a deposit tx rejected by atomicCreatePredictionDispute (due to
    // dispute_already_filed) would never be consumed, making it reusable on other polls.
    const priorDispute = await options.repository.getDisputeForPollAndWallet(pollId, parsed.data.wallet);
    if (priorDispute) {
      return reply.code(409).send({ error: "dispute_already_filed" });
    }

    if (depositSkr > 0 && parsed.data.depositTxSignature) {
      const rpcUrl = options.solanaRpcUrl ?? "https://mainnet.helius-rpc.com/";
      const txVerify = await verifySkrPayment({
        txSignature: parsed.data.depositTxSignature,
        fromWallet: parsed.data.wallet,
        toWallet: options.platformWallet,
        minAmountUi: depositSkr,
        rpcUrl,
        skrMint: options.skrMint ?? DEFAULT_SKR_MINT
      });

      if (!txVerify.ok) {
        return reply.code(400).send({ error: "invalid_deposit_payment", reason: txVerify.reason });
      }
    }

    const result = await options.repository.atomicCreatePredictionDispute({
      pollId,
      wallet: parsed.data.wallet,
      reason: parsed.data.reason,
      evidenceUrls: parsed.data.evidenceUrls,
      depositSkr,
      depositTxSignature: parsed.data.depositTxSignature,
      challengeWindowHours,
      paymentIntentId: parsed.data.paymentIntentId
    });

    if (!result.success) {
      if (result.reason === "tx_already_used") {
        return reply.code(409).send({ error: "tx_already_used" });
      }

      if (depositSkr > 0 && parsed.data.depositTxSignature) {
        const paymentExceptionId = await recordPaymentException({
          txSignature: parsed.data.depositTxSignature,
          wallet: parsed.data.wallet,
          purpose: "dispute_deposit",
          expectedAmountSkr: depositSkr,
          referenceType: "poll",
          referenceId: pollId,
          failureReason: result.reason,
          metadata: {
            challengeDeadline: result.challengeDeadline ?? null
          }
        });

        return reply.code(409).send({
          error: "dispute_rejected_after_payment",
          reason: result.reason,
          challengeDeadline: result.challengeDeadline,
          paymentExceptionId
        });
      }

      if (result.reason === "poll_not_found") {
        return reply.code(404).send({ error: "poll_not_found" });
      }
      if (result.reason === "poll_not_resolved") {
        return reply.code(400).send({ error: "poll_not_resolved" });
      }
      if (result.reason === "challenge_window_closed") {
        return reply.code(400).send({
          error: "challenge_window_closed",
          challengeDeadline: result.challengeDeadline
        });
      }
      if (result.reason === "dispute_already_filed") {
        return reply.code(409).send({ error: "dispute_already_filed" });
      }
      return reply.code(500).send({ error: "dispute_create_failed" });
    }

    return reply.send({
      ok: true,
      disputeId: result.disputeId,
      challengeDeadline: result.challengeDeadline
    });
  });

  app.get("/v1/predictions/:id/disputes", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) return;

    const parsedParams = predictionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "invalid_params", details: parsedParams.error.flatten() });
    }
    const pollId = parsedParams.data.id;
    const disputes = await options.repository.listPredictionDisputes(pollId);
    const redactWallet = (wallet: string): string =>
      wallet.length > 8 ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}` : wallet;
    const publicDisputes = disputes.map((dispute) => ({
      ...dispute,
      wallet: redactWallet(dispute.wallet),
      reason: "redacted",
      evidenceUrls: [],
      depositTxSignature: undefined,
      refundTxSignature: undefined
    }));
    return { disputes: publicDisputes };
  });

  app.get("/v1/predictions/:id/disputes/me", async (request, reply) => {
    if (await enforceRateLimit("feedRead", resolveRequestScope(request), reply)) return;

    const parsedParams = predictionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "invalid_params", details: parsedParams.error.flatten() });
    }

    const querySchema = z.object({ wallet: walletAddressSchema });
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsedQuery.error.flatten() });
    }

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      parsedQuery.data.wallet,
      reply
    );
    if (!sessionValid) {
      return;
    }

    const dispute = await options.repository.getPredictionDisputeForWallet(
      parsedParams.data.id,
      parsedQuery.data.wallet
    );
    return { dispute };
  });

  // ── SSE: Real-Time Pool Updates ─────────────────────────────────────────────

  app.get("/v1/predictions/:id/stream", async (request, reply) => {
    const parsedParams = predictionParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "invalid_params", details: parsedParams.error.flatten() });
    }

    const requestScope = resolveRequestScope(request);
    if (await enforceRateLimit("feedRead", `sse:${requestScope}`, reply)) {
      return;
    }

    const activeCount = sseConnectionsByScope.get(requestScope) ?? 0;
    if (activeCount >= MAX_SSE_CONNECTIONS_PER_SCOPE) {
      return reply.code(429).send({ error: "too_many_sse_connections" });
    }
    if (totalSseConnections >= MAX_TOTAL_SSE) {
      return reply.code(503).send({ error: "sse_capacity_exceeded" });
    }

    sseConnectionsByScope.set(requestScope, activeCount + 1);
    totalSseConnections += 1;

    const pollId = parsedParams.data.id;

    // Verify poll exists
    const pool = await options.repository.getPredictionPool(pollId);
    if (!pool) {
      sseConnectionsByScope.set(requestScope, Math.max((sseConnectionsByScope.get(requestScope) ?? 1) - 1, 0));
      totalSseConnections = Math.max(totalSseConnections - 1, 0);
      return reply.code(404).send({ error: "poll_not_found" });
    }

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // Send initial pool state
    reply.raw.write(`data: ${JSON.stringify(pool)}\n\n`);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        return;
      }
      reply.raw.write(": heartbeat\n\n");
    }, 30000);

    // NOTE: PostgreSQL LISTEN/NOTIFY integration would require a dedicated
    // connection that persists per subscription. For now, we use a simple
    // polling approach with 2s refresh.
    let pollRequestInFlight = false;
    const pollInterval = setInterval(async () => {
      if (pollRequestInFlight || reply.raw.writableEnded || reply.raw.destroyed) {
        return;
      }
      pollRequestInFlight = true;
      try {
        const updatedPool = await options.repository.getPredictionPool(pollId);
        if (updatedPool && !reply.raw.writableEnded && !reply.raw.destroyed) {
          reply.raw.write(`data: ${JSON.stringify(updatedPool)}\n\n`);
        }
      } catch {
        // Ignore errors during polling
      } finally {
        pollRequestInFlight = false;
      }
    }, 5000);

    const maxDurationTimer = setTimeout(() => {
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        return;
      }
      reply.raw.write(`event: timeout\ndata: ${JSON.stringify({ error: "sse_connection_expired" })}\n\n`);
      reply.raw.end();
    }, SSE_MAX_CONNECTION_MS);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      clearInterval(heartbeat);
      clearInterval(pollInterval);
      clearTimeout(maxDurationTimer);
      const nextCount = Math.max((sseConnectionsByScope.get(requestScope) ?? 1) - 1, 0);
      if (nextCount === 0) {
        sseConnectionsByScope.delete(requestScope);
      } else {
        sseConnectionsByScope.set(requestScope, nextCount);
      }
      totalSseConnections = Math.max(totalSseConnections - 1, 0);
    };

    request.raw.on("close", cleanup);
    reply.raw.on("close", cleanup);

    // Keep the connection open (don't call reply.send)
  });

  app.post("/v1/feedback", async (request, reply) => {
    if (await enforceRateLimit("feedbackWrite", resolveRequestScope(request), reply)) return;

    const body = feedbackCreateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }

    const session = await requireSession(
      request.headers as Record<string, string | string[] | undefined>,
      reply
    );
    if (!session) {
      return;
    }

    const payload = {
      wallet: session.walletAddress,
      type: body.data.type,
      subject: body.data.subject.trim(),
      message: body.data.message.trim(),
      appVersion: body.data.appVersion?.trim() || undefined,
      platform: body.data.platform
    };

    const created = await options.repository.createFeedback(payload);

    void sendTelegramFeedback(payload).catch((err) => {
      request.log.warn(
        {
          feedbackId: created.id,
          err: err instanceof Error ? err.message : err
        },
        "[feedback] telegram delivery failed"
      );
    });

    return reply.code(201).send(created);
  });

  // ── Admin API Endpoints (only mounted when ADMIN_TOKEN is set) ──────────────
  if (options.adminToken) {
    const adminToken = options.adminToken;

    const checkAdminToken = (
      headers: Record<string, string | string[] | undefined>,
      reply: { code: (n: number) => { send: (p: unknown) => unknown } }
    ): boolean => {
      const provided = readHeaderValue(headers["x-admin-token"]);
      if (!provided || provided.length > 512 || !safeTokenEquals(provided, adminToken)) {
        reply.code(401).send({ error: "unauthorized" });
        return false;
      }
      return true;
    };

    const enforceAdminAccess = async (
      request: { headers: Record<string, string | string[] | undefined>; ip: string; raw: { socket?: { remoteAddress?: string | null } } },
      reply: { code: (n: number) => { send: (p: unknown) => unknown } }
    ): Promise<boolean> => {
      if (await enforceRateLimit("signedAction", `admin:${resolveRequestScope(request)}`, reply)) {
        return false;
      }
      return checkAdminToken(request.headers, reply);
    };

    app.get("/v1/admin/config", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const rows = await getAllConfig(options.repository);
      const grouped: Record<string, typeof rows> = {};
      for (const row of rows) {
        if (!grouped[row.category]) grouped[row.category] = [];
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        grouped[row.category]!.push(row);
      }
      return { settings: grouped };
    });

    const adminConfigKeySchema = z.object({ key: z.string().min(1).max(80) });
    const adminConfigValueSchema = z.object({ value: z.string().max(500) });

    app.patch("/v1/admin/config/:key", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = adminConfigKeySchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_key" });
      const body = adminConfigValueSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_value" });

      // Verify key exists
      const existing = await getConfigValue(options.repository, params.data.key);
      if (existing === undefined) return reply.code(404).send({ error: "key_not_found" });

      await updateConfig(options.repository, params.data.key, body.data.value, "admin");
      return { ok: true, key: params.data.key, value: body.data.value };
    });

    app.get("/v1/admin/stats", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const stats = await options.repository.getAdminStats();
      return stats;
    });

    app.get("/v1/admin/stats/extended", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const stats = await options.repository.getExtendedAdminStats();
      return stats;
    });

    app.get("/v1/admin/feedback", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const query = feedbackListQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "invalid_query", details: query.error.flatten() });
      }

      const feedback = await options.repository.listFeedback({
        status: query.data.status,
        limit: query.data.limit ?? 50,
        offset: query.data.offset ?? 0
      });

      return { feedback };
    });

    app.patch("/v1/admin/feedback/:id", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = feedbackUpdateParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "invalid_id", details: params.error.flatten() });
      }

      const body = feedbackUpdateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      const updated = await options.repository.updateFeedback(params.data.id, {
        status: body.data.status,
        adminNotes:
          body.data.adminNotes === undefined
            ? undefined
            : body.data.adminNotes?.trim()
            ? body.data.adminNotes.trim()
            : null
      });

      if (!updated) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(204).send();
    });

    app.get("/v1/admin/orphan-payments", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const query = orphanedPaymentsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "invalid_query", details: query.error.flatten() });
      }

      const payments = await options.repository.listOrphanedPayments({
        status: query.data.status,
        limit: query.data.limit ?? 100,
        offset: query.data.offset ?? 0
      });

      return { payments };
    });

    app.patch("/v1/admin/orphan-payments/:id", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = orphanedPaymentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "invalid_id", details: params.error.flatten() });
      }

      const body = orphanedPaymentUpdateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      const updated = await options.repository.updateOrphanedPayment(params.data.id, {
        status: body.data.status,
        adminNotes:
          body.data.adminNotes === undefined
            ? undefined
            : body.data.adminNotes?.trim()
            ? body.data.adminNotes.trim()
            : null
      });

      if (!updated) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(204).send();
    });

    // ── Source Management ─────────────────────────────────────────────────────

    app.get("/v1/admin/sources", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const sources = await options.repository.listSourcesAdmin();
      return { sources };
    });

    app.get("/v1/admin/sources/health", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const health = await options.repository.getSourceHealth();
      return { sources: health };
    });

    app.get("/v1/admin/advertisers", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const advertisers = await options.repository.listAdvertisersAdmin();
      return { advertisers };
    });

    app.post("/v1/admin/advertisers/:id/campaigns/status", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_id" });
      const body = z.object({ active: z.boolean() }).safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }
      const advertiser = await options.repository.getAdvertiserById(params.data.id);
      if (!advertiser) return reply.code(404).send({ error: "not_found" });
      const affected = await options.repository.setAdvertiserCampaignsActive(params.data.id, body.data.active);
      return { ok: true, advertiserId: params.data.id, active: body.data.active, affected };
    });

    app.post("/v1/admin/advertisers/:id/account-status", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_id" });
      const body = z.object({
        status: z.enum(["active", "suspended"]),
        reason: z.string().min(5).max(500).optional()
      }).safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }
      if (body.data.status === "suspended" && !body.data.reason?.trim()) {
        return reply.code(400).send({ error: "suspension_reason_required" });
      }
      const updated = await options.repository.setAdvertiserAccountStatus(
        params.data.id,
        body.data.status,
        body.data.reason?.trim()
      );
      if (!updated) return reply.code(404).send({ error: "not_found" });
      if (body.data.status === "suspended") {
        await options.repository.setAdvertiserCampaignsActive(params.data.id, false);
      }
      return { ok: true, advertiserId: params.data.id, status: body.data.status };
    });

    app.get("/v1/admin/advertiser-billing/requests", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const requests = await options.repository.listAdminAdvertiserBillingRequests();
      return { requests };
    });

    app.post("/v1/admin/advertiser-billing/requests/:id/status", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_id" });
      const body = z.object({
        status: z.enum(["reviewing", "resolved", "rejected"]),
        adminNote: z.string().min(3).max(1000).optional(),
      }).safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      const updated = await options.repository.updateAdvertiserBillingRequestStatus({
        requestId: params.data.id,
        status: body.data.status,
        adminNote: body.data.adminNote?.trim(),
        resolvedBy: "admin",
      });
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return { ok: true, id: params.data.id, status: body.data.status };
    });

    app.post("/v1/admin/sources/:id/toggle", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const { id } = request.params as { id: string };
      const { active } = request.body as { active: boolean };
      if (typeof active !== "boolean") {
        return reply.code(400).send({ error: "active_required" });
      }
      await options.repository.toggleSourceActive(id, active);
      return { success: true, sourceId: id, active };
    });

    const createSourceSchema = z.object({
      name: z.string().min(2).max(100),
      homepageUrl: z.string().url(),
      feedUrl: z.string().url(),
      languageHint: z.string().length(2).optional()
    });

    app.post("/v1/admin/sources", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const body = createSourceSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }
      const result = await options.repository.createSource(body.data);
      return { ok: true, id: result.id, name: body.data.name };
    });

    app.delete("/v1/admin/sources/:id", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const { id } = request.params as { id: string };
      if (!id || !id.startsWith("src_")) {
        return reply.code(400).send({ error: "invalid_source_id" });
      }
      await options.repository.deleteSource(id);
      return { ok: true, deletedId: id };
    });

    // ── OpenRouter Model Management ─────────────────────────────────────────

    app.get("/v1/admin/models", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const models = await options.repository.getOpenRouterModels();
      const agentConfig = await options.repository.getAgentModelConfig();
      const lastSync = await getConfigValue(options.repository, "openrouter_last_sync");
      return { models, agentConfig, lastSync };
    });

    app.post("/v1/admin/models/sync", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const apiKey = options.openRouterApiKey;
      if (!apiKey) {
        return reply.code(500).send({ error: "openrouter_api_key_not_configured" });
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const text = await response.text();
          app.log.error({ status: response.status, body: text }, "OpenRouter API error");
          return reply.code(502).send({ error: "openrouter_api_error", status: response.status });
        }

        const json = await response.json() as { data?: Array<{
          id: string;
          name: string;
          context_length?: number;
          pricing?: { prompt?: number; completion?: number };
          capabilities?: { tools?: boolean; vision?: boolean };
          moderation?: string;
        }> };

        if (!Array.isArray(json.data)) {
          return reply.code(502).send({ error: "openrouter_invalid_response" });
        }

        const synced = await options.repository.syncOpenRouterModels(json.data);
        return { ok: true, synced, total: json.data.length };
      } catch (err) {
        app.log.error({ err }, "Failed to sync OpenRouter models");
        return reply.code(500).send({ error: "sync_failed" });
      }
    });

    const updateAgentModelSchema = z.object({
      role: z.enum([
        "relevance_filter", "fact_checker", "summarizer",
        "summarizer_fallback", "post_check"
      ]),
      modelId: z.string().min(1).max(200)
    });

    app.put("/v1/admin/models/agent", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const body = updateAgentModelSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      const configKey = `agent_model_${body.data.role}`;
      await updateConfig(options.repository, configKey, body.data.modelId, "admin");
      return { ok: true, role: body.data.role, modelId: body.data.modelId };
    });

    // ── Admin: Manual Prediction Settlement ────────────────────────────────────
    const settleSchema = z.object({
      outcome: z.enum(["yes", "no"]),
      reason: z.string().min(5).max(500).optional()
    });

    app.post("/v1/admin/predictions/:id/settle", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const { id: pollId } = request.params as { id: string };
      const body = settleSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      // Get the poll
      const poll = await options.repository.getPredictionMarketById(pollId);
      if (!poll) {
        return reply.code(404).send({ error: "prediction_not_found" });
      }

      if (poll.status !== "active") {
        return reply.code(400).send({ error: "prediction_already_settled", currentStatus: poll.status });
      }

      if (!(options.repository instanceof PostgresRepository)) {
        return reply.code(501).send({ error: "repository_unsupported" });
      }

      const result = await settlePredictionMarket({
        sql: options.repository.getSqlClient() as unknown as SettlementSql,
        pollId,
        winnerSide: body.data.outcome,
        source: "admin_manual"
      });

      if ("frozen" in result) {
        return reply.code(409).send({ error: "prediction_frozen_dispute_pending" });
      }

      if ("reserved" in result) {
        return reply.code(409).send({ error: "prediction_payment_intents_pending" });
      }

      if ("alreadySettled" in result) {
        return reply.code(400).send({ error: "prediction_already_settled" });
      }

      app.log.info({
        action: "admin_settle_prediction",
        pollId,
        outcome: body.data.outcome,
        reason: body.data.reason,
        ...result
      });

      return {
        ok: true,
        pollId,
        outcome: body.data.outcome,
        winnersCount: result.winnersCount,
        losersCount: result.losersCount,
        totalPayoutSkr: result.totalPayoutSkr,
        platformFeeSkr: result.platformFeeSkr,
        dustSkr: result.dustSkr
      };
    });

    // ── Admin: Get Prediction Revenue Summary ──────────────────────────────────
    app.get("/v1/admin/predictions/revenue", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const revenue = await options.repository.getPredictionRevenueSummary();
      return revenue;
    });

    // ── Admin: List All Prediction Markets ────────────────────────────────────
    app.get("/v1/admin/predictions/markets", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const query = request.query as { status?: string; cursor?: string; limit?: string };
      const status = query.status as "active" | "resolved" | "cancelled" | undefined;
      const limit = Math.min(Math.max(query.limit ? parseInt(query.limit, 10) || 50 : 50, 1), 500);

      const result = await options.repository.listAllPredictionMarkets({
        status,
        cursor: query.cursor,
        limit
      });

      return result;
    });

    // ── Admin: Get Resolution Details ─────────────────────────────────────────
    app.get("/v1/admin/predictions/:id/resolution", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const { id: pollId } = request.params as { id: string };
      const resolution = await options.repository.getResolutionDetails(pollId);

      if (!resolution) {
        return { resolution: null, message: "No AI resolution data found for this market" };
      }

      return { resolution };
    });

    // ── Admin: Cancel Prediction Market ───────────────────────────────────────
    const cancelMarketSchema = z.object({
      reason: z.string().min(5).max(500)
    });

    app.post("/v1/admin/predictions/:id/cancel", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const { id: pollId } = request.params as { id: string };
      const body = cancelMarketSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      // Check market exists and is active
      const poll = await options.repository.getPredictionMarketById(pollId);
      if (!poll) {
        return reply.code(404).send({ error: "prediction_not_found" });
      }
      if (poll.status !== "active") {
        return reply.code(400).send({ error: "market_not_active", currentStatus: poll.status });
      }

      let result;
      try {
        result = await options.repository.cancelPredictionMarket(pollId, body.data.reason);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "pending_payment_intents") {
          return reply.code(409).send({ error: "prediction_payment_intents_pending" });
        }
        if (error instanceof Error && error.message === "pending_cashouts") {
          return reply.code(409).send({ error: "prediction_cashouts_pending" });
        }
        if (error instanceof Error && error.message === "market_not_active") {
          return reply.code(409).send({ error: "market_not_active" });
        }
        throw error;
      }

      app.log.info({
        action: "admin_cancel_prediction",
        pollId,
        reason: body.data.reason,
        ...result
      });

      return {
        ok: true,
        pollId,
        stakesRefunded: result.stakesRefunded,
        totalRefundSkr: result.totalRefundSkr
      };
    });

    // ── Admin: Update Market Limits ───────────────────────────────────────────
    const updateLimitsSchema = z.object({
      minStakeSkr: z.number().int().min(1).max(100000),
      maxStakeSkr: z.number().int().min(1).max(1000000)
    });

    app.patch("/v1/admin/predictions/:id/limits", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const { id: pollId } = request.params as { id: string };
      const body = updateLimitsSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      if (body.data.minStakeSkr >= body.data.maxStakeSkr) {
        return reply.code(400).send({ error: "min_must_be_less_than_max" });
      }

      await options.repository.updatePredictionMarketLimits(
        pollId,
        body.data.minStakeSkr,
        body.data.maxStakeSkr
      );

      return { ok: true, pollId, ...body.data };
    });

    // ── Admin: Create Prediction Market ───────────────────────────────────────
    const createMarketSchema = z.object({
      question: z.string().min(10).max(500),
      deadlineAt: z.string().datetime(),
      resolutionRuleKind: z.enum(["price_above", "price_below", "event_occurs", "community_majority"]).optional(),
      resolutionRuleSymbol: z.string().max(20).optional(),
      resolutionRuleTarget: z.number().optional(),
      minStakeSkr: z.number().int().min(1).max(100000).optional(),
      maxStakeSkr: z.number().int().min(1).max(1000000).optional(),
      platformFeePct: z.number().min(0).max(20).optional()
    });

    app.post("/v1/admin/predictions/create", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const body = createMarketSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      const deadlineAt = new Date(body.data.deadlineAt);
      if (deadlineAt <= new Date()) {
        return reply.code(400).send({ error: "deadline_must_be_in_future" });
      }

      const resolutionRule = body.data.resolutionRuleKind
        ? {
            kind: body.data.resolutionRuleKind,
            symbol: body.data.resolutionRuleSymbol,
            target: body.data.resolutionRuleTarget
          }
        : undefined;

      const result = await options.repository.createPredictionMarket({
        question: body.data.question,
        deadlineAt,
        resolutionRule,
        minStakeSkr: body.data.minStakeSkr,
        maxStakeSkr: body.data.maxStakeSkr,
        platformFeePct: body.data.platformFeePct
      });

      app.log.info({
        action: "admin_create_prediction",
        ...result,
        question: body.data.question
      });

      return { ok: true, ...result };
    });

    // ── Admin: List All Disputes ──────────────────────────────────────────────
    app.get("/v1/admin/predictions/disputes", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const query = request.query as { status?: string; cursor?: string; limit?: string };
      const limit = Math.min(Math.max(query.limit ? parseInt(query.limit, 10) || 50 : 50, 1), 500);

      const result = await options.repository.listAllDisputes({
        status: query.status,
        cursor: query.cursor,
        limit
      });

      return result;
    });

    // ── Admin: Get Dispute Details ────────────────────────────────────────────
    app.get("/v1/admin/predictions/disputes/:id", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const { id: disputeId } = request.params as { id: string };
      const dispute = await options.repository.getPredictionDispute(disputeId);

      if (!dispute) {
        return reply.code(404).send({ error: "dispute_not_found" });
      }

      return { dispute };
    });

    // ── Admin: Update Dispute Status ──────────────────────────────────────────
    app.post("/v1/admin/predictions/disputes/:id/investigate", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const { id: disputeId } = request.params as { id: string };
      const result = await options.repository.atomicUpdateDisputeStatusAndFreeze(
        disputeId,
        "investigating",
        true
      );
      if (!result) {
        return reply.code(404).send({ error: "dispute_not_found" });
      }

      return { ok: true, status: "investigating" };
    });

    // ── Admin: Resolve Dispute ────────────────────────────────────────────────
    const resolveDisputeSchema = z.object({
      verdict: z.enum(["upheld", "rejected"]),
      note: z.string().min(5).max(1000),
      correctedOutcome: z.enum(["yes", "no"]).optional()
    });

    app.post("/v1/admin/predictions/disputes/:id/resolve", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const { id: disputeId } = request.params as { id: string };
      const body = resolveDisputeSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }
      if (body.data.verdict === "upheld" && !body.data.correctedOutcome) {
        return reply.code(400).send({ error: "corrected_outcome_required" });
      }

      let reResolutionStatus:
        | "not_applicable"
        | "settled"
        | "deferred_frozen"
        | "already_settled" = "not_applicable";
      let correctedOutcome: "yes" | "no" | undefined;
      let result:
        | { refundRequired: boolean; walletAddress: string; depositSkr: number; pollId: string }
        | undefined;

      if (body.data.verdict === "upheld" && body.data.correctedOutcome) {
        if (!(options.repository instanceof PostgresRepository)) {
          return reply.code(501).send({ error: "repository_unsupported" });
        }

        correctedOutcome = body.data.correctedOutcome;

        const dispute = await options.repository.getPredictionDispute(disputeId);
        if (!dispute) {
          return reply.code(404).send({ error: "dispute_not_found" });
        }
        if (!(dispute.status === "pending" || dispute.status === "investigating")) {
          return reply.code(409).send({ error: "dispute_already_resolved" });
        }

        try {
          await options.repository.resetPollForReResolution(dispute.pollId, {
            allowPendingDisputeId: disputeId
          });
        } catch (error: unknown) {
          if (error instanceof Error && error.message === "cannot_re_resolve_with_claimed_payouts") {
            return reply.code(409).send({
              error: "cannot_re_resolve_with_claimed_payouts",
              detail: "Some payouts were already claimed. Manual resolution required."
            });
          }
          if (error instanceof Error && error.message === "other_disputes_pending") {
            return reply.code(409).send({
              error: "other_disputes_pending",
              detail: "Resolve all other pending disputes for this market before re-resolution."
            });
          }
          throw error;
        }
        const settled = await settlePredictionMarket({
          sql: options.repository.getSqlClient() as unknown as SettlementSql,
          pollId: dispute.pollId,
          winnerSide: correctedOutcome,
          source: "dispute_upheld"
        });
        if ("frozen" in settled) {
          reResolutionStatus = "deferred_frozen";
        } else if ("alreadySettled" in settled) {
          reResolutionStatus = "already_settled";
        } else {
          reResolutionStatus = "settled";
        }

        result = await options.repository.resolvePredictionDispute({
          disputeId,
          verdict: body.data.verdict,
          note: body.data.note,
          resolvedBy: "admin"
        });
      } else {
        result = await options.repository.resolvePredictionDispute({
          disputeId,
          verdict: body.data.verdict,
          note: body.data.note,
          resolvedBy: "admin"
        });
      }

      let refundTxSignature: string | undefined;
      let refundStatus: "not_required" | "sent" | "failed" | "manual_required" = "not_required";

      if (result.refundRequired && result.depositSkr > 0) {
        if (options.platformWalletSecret && solanaRpcUrl) {
          const transferResult = await transferSkrPayout({
            rpcUrl: solanaRpcUrl,
            platformWalletSecret: options.platformWalletSecret,
            toWallet: result.walletAddress,
            skrMint,
            amountUi: result.depositSkr
          });

          if (transferResult.success && transferResult.txSignature) {
            refundTxSignature = transferResult.txSignature;
            refundStatus = "sent";
            await options.repository.recordDisputeRefundTx(disputeId, transferResult.txSignature);
          } else {
            refundStatus = "failed";
            request.log.error(
              { disputeId, wallet: result.walletAddress, amount: result.depositSkr, error: transferResult.error },
              "[disputes] refund transfer failed; manual refund required"
            );
          }
        } else {
          refundStatus = "manual_required";
          request.log.error(
            { disputeId, wallet: result.walletAddress, amount: result.depositSkr },
            "[disputes] refund required but payout wallet configuration is missing"
          );
        }
      }

      app.log.info({
        action: "admin_resolve_dispute",
        disputeId,
        ...body.data,
        ...result,
        correctedOutcome,
        reResolutionStatus,
        refundStatus,
        refundTxSignature
      });

      return {
        ok: true,
        disputeId,
        verdict: body.data.verdict,
        refundRequired: result.refundRequired,
        walletAddress: result.walletAddress,
        depositSkr: result.depositSkr,
        pollId: result.pollId,
        correctedOutcome,
        reResolutionStatus,
        refundStatus,
        refundTxSignature
      };
    });

    // ── Admin: Add Note to Dispute ────────────────────────────────────────────
    const addNoteSchema = z.object({
      note: z.string().min(1).max(500)
    });

    app.post("/v1/admin/predictions/disputes/:id/note", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const { id: disputeId } = request.params as { id: string };
      const body = addNoteSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      await options.repository.addDisputeAdminNote(disputeId, body.data.note, "admin");

      return { ok: true };
    });

    // ── Admin: Get Prediction Economics Settings ──────────────────────────────
    app.get("/v1/admin/predictions/economics", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const settings = await options.repository.getPredictionEconomicsSettings();
      return settings;
    });

    // ── Admin: Update Prediction Economics Settings ───────────────────────────
    const updateEconomicsSchema = z.object({
      platformFeePct: z.number().min(0).max(20).optional(),
      disputeDepositSkr: z.number().int().min(10).max(1000).optional(),
      challengeWindowHours: z.number().int().min(1).max(168).optional(),
      autoSettleThreshold: z.number().min(0.5).max(1.0).optional(),
      consensusThreshold: z.number().int().min(2).max(3).optional()
    });

    app.patch("/v1/admin/predictions/economics", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;

      const body = updateEconomicsSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }

      const updates: Array<{ key: string; value: string }> = [];

      if (body.data.platformFeePct !== undefined) {
        updates.push({ key: "prediction_fee_pct", value: body.data.platformFeePct.toFixed(2) });
      }
      if (body.data.disputeDepositSkr !== undefined) {
        updates.push({ key: "dispute_deposit_skr", value: String(body.data.disputeDepositSkr) });
      }
      if (body.data.challengeWindowHours !== undefined) {
        updates.push({ key: "dispute_challenge_hours", value: String(body.data.challengeWindowHours) });
      }
      if (body.data.autoSettleThreshold !== undefined) {
        updates.push({ key: "resolution_auto_settle_threshold", value: body.data.autoSettleThreshold.toFixed(2) });
      }
      if (body.data.consensusThreshold !== undefined) {
        updates.push({ key: "resolution_consensus_threshold", value: String(body.data.consensusThreshold) });
      }

      for (const { key, value } of updates) {
        await updateConfig(options.repository, key, value, "admin");
      }

      return { ok: true, updated: updates.map(u => u.key) };
    });

    // ── Sponsored cards admin ──────────────────────────────────────────────────

    const createSponsoredSchema = z.object({
      advertiserName:  z.string().min(2).max(100),
      headline:        z.string().min(5).max(120),
      bodyText:        z.string().min(20).max(400),
      imageUrl:        z.string().url().optional(),
      destinationUrl:  z.string().url(),
      ctaText:         z.string().max(30).default("Learn More"),
      accentColor:     z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#14F195"),
      cardFormat:      z.enum(["classic", "banner", "spotlight", "portrait"]).default("classic"),
      placement:       z.enum(["feed", "predict", "both"]).default("feed"),
      targetAudience:  z.enum(["all", "defi_degens", "whales", "nft_collectors"]).default("all"),
      campaignGoal:    z.enum(["traffic", "action", "lead_gen"]).default("traffic"),
      actionUrl:       z.string().max(2048).optional(),
      startsAt:        z.string().datetime().optional(),
      endsAt:          z.string().datetime(),
      impressionLimit: z.number().int().positive().optional(),
    }).refine(
      data => data.campaignGoal !== "action" || !!data.actionUrl,
      { message: "actionUrl is required for Blinks (action) campaigns", path: ["actionUrl"] }
    );

    app.get("/v1/admin/sponsored", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const cards = await options.repository.listSponsoredCards();
      return { cards };
    });

    app.post("/v1/admin/sponsored", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const parsed = createSponsoredSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const d = parsed.data;
      const destinationUrl = parsePublicHttpsUrl(d.destinationUrl);
      if (!destinationUrl) {
        return reply.code(400).send({ error: "invalid_destination_url" });
      }
      const imageUrl = d.imageUrl ? parsePublicHttpsUrl(d.imageUrl) : null;
      if (d.imageUrl && !imageUrl) {
        return reply.code(400).send({ error: "invalid_image_url" });
      }
      const actionUrl = d.actionUrl ? parseActionUrl(d.actionUrl) : null;
      if (d.actionUrl && !actionUrl) {
        return reply.code(400).send({ error: "invalid_action_url" });
      }
      const startsAt = d.startsAt ? new Date(d.startsAt) : new Date();
      const endsAt = new Date(d.endsAt);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        return reply.code(400).send({ error: "invalid_schedule" });
      }
      const id = await options.repository.createSponsoredCard({
        advertiserName:  d.advertiserName,
        headline:        d.headline,
        bodyText:        d.bodyText,
        imageUrl:        imageUrl?.toString(),
        destinationUrl:  destinationUrl.toString(),
        ctaText:         d.ctaText,
        accentColor:     d.accentColor,
        cardFormat:      d.cardFormat,
        placement:       d.placement,
        targetAudience:  d.targetAudience,
        campaignGoal:    d.campaignGoal,
        actionUrl:       actionUrl ?? undefined,
        startsAt,
        endsAt,
        impressionLimit: d.impressionLimit,
      });
      return reply.code(201).send({ ok: true, id });
    });

    app.delete("/v1/admin/sponsored/:id", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_id" });
      const { id } = params.data;
      const found = await options.repository.deactivateSponsoredCard(id);
      if (!found) return reply.code(404).send({ error: "not_found" });
      return { ok: true };
    });

    const sponsoredStatusSchema = z.object({
      active: z.boolean()
    });

    app.post("/v1/admin/sponsored/:id/status", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_id" });
      const { id } = params.data;
      const body = sponsoredStatusSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }
      if (body.data.active) {
        const cards = await options.repository.listSponsoredCards();
        const current = cards.find((card) => card.id === id);
        if (!current) return reply.code(404).send({ error: "not_found" });
        if (current.approvalStatus !== "approved") {
          return reply.code(409).send({ error: "campaign_review_pending" });
        }
        if (current.billingStatus === "payment_required" || current.billingStatus === "approval_pending") {
          return reply.code(409).send({
            error: "campaign_payment_required",
            billingAmountUsdc: current.billingAmountUsdc,
          });
        }
      }
      const updated = await options.repository.setSponsoredCardActive(id, body.data.active);
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return { ok: true, id, active: body.data.active };
    });

    app.post("/v1/admin/sponsored/:id/review", async (request, reply) => {
      if (!(await enforceAdminAccess(request, reply))) return;
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_id" });
      const body = z.object({
        decision: z.enum(["approve", "reject"]),
        reason: z.string().min(5).max(500).optional()
      }).safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }
      if (body.data.decision === "reject" && !body.data.reason?.trim()) {
        return reply.code(400).send({ error: "rejection_reason_required" });
      }
      const reviewed = await options.repository.reviewSponsoredCard(
        params.data.id,
        body.data.decision,
        "admin",
        body.data.reason?.trim()
      );
      if (!reviewed) return reply.code(404).send({ error: "not_found" });
      return { ok: true, id: params.data.id, decision: body.data.decision };
    });

    // Immediately invalidate systemConfig cache to force reload on next request
    invalidateCache();
  }

  // ── Advertiser self-serve portal (SIWS wallet auth — no Privy) ───────────

  const enforceAdvertiserAccess = async (
    headers: Record<string, string | string[] | undefined>,
    reply: { code: (n: number) => { send: (p: unknown) => unknown } }
  ): Promise<string | false> => {
    const token = readHeaderValue(headers["x-advertiser-token"]);
    if (!token) { reply.code(401).send({ error: "unauthorized" }); return false; }
    const session = await options.repository.getAdvertiserSession(token);
    if (!session) { reply.code(401).send({ error: "unauthorized" }); return false; }
    const advertiser = await options.repository.getAdvertiserById(session.advertiserId);
    if (!advertiser) { reply.code(401).send({ error: "unauthorized" }); return false; }
    if (advertiser.accountStatus === "suspended") {
      reply.code(403).send({ error: "advertiser_suspended" });
      return false;
    }
    return session.advertiserId;
  };

  // Step 1: Get SIWS challenge message to sign
  app.post("/v1/advertiser/auth/challenge", async (request, reply) => {
    if (await enforceRateLimit("challenge", resolveRequestScope(request), reply)) return;
    const parsed = challengeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const challenge = createSiwsChallenge(parsed.data.walletAddress);
    await options.repository.createAuthChallenge({
      walletAddress: parsed.data.walletAddress,
      nonce: challenge.nonce,
      message: challenge.message,
      expiresAt: challenge.expiresAt,
    });
    return challenge;
  });

  // Step 2: Verify signed message → upsert advertiser → return adv_sess_ token
  app.post("/v1/advertiser/auth/verify", async (request, reply) => {
    if (await enforceRateLimit("verify", resolveRequestScope(request), reply)) return;
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const nonce = extractNonceFromMessage(parsed.data.message);
    if (!nonce) return reply.code(400).send({ error: "missing_nonce" });

    const challenge = await options.repository.getAuthChallenge(parsed.data.walletAddress, nonce);
    if (!challenge) return reply.code(401).send({ error: "challenge_not_found" });

    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      await options.repository.deleteAuthChallenge(parsed.data.walletAddress, nonce);
      return reply.code(401).send({ error: "challenge_expired" });
    }

    if (challenge.message !== parsed.data.message) {
      return reply.code(401).send({ error: "message_mismatch" });
    }

    const verified = verifySolanaSignature(parsed.data.message, parsed.data.signature, parsed.data.walletAddress);
    if (!verified) return reply.code(401).send({ error: "signature_invalid" });

    await options.repository.deleteAuthChallenge(parsed.data.walletAddress, nonce);
    const advertiser = await options.repository.upsertAdvertiserByWallet({
      walletAddress: parsed.data.walletAddress,
    });
    const session = await options.repository.createAdvertiserSession(advertiser.id);
    await options.repository.updateAdvertiserLastLogin(advertiser.id);
    return reply.code(200).send({
      token: session.sessionToken,
      advertiser,
      needsOnboarding: !advertiser.isOnboarded,
    });
  });

  // Complete onboarding (set company name after first login)
  app.patch("/v1/advertiser/me", async (request, reply) => {
    if (await enforceRateLimit("signedAction", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    const body = advertiserOnboardSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_input" });
    const advertiser = await options.repository.onboardAdvertiser(advertiserId, body.data.companyName, body.data.websiteUrl);
    return { advertiser };
  });

  app.get("/v1/advertiser/me", async (request, reply) => {
    if (await enforceRateLimit("feedRead", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    const advertiser = await options.repository.getAdvertiserById(advertiserId);
    if (!advertiser) return reply.code(404).send({ error: "not_found" });
    return { advertiser };
  });

  app.post("/v1/advertiser/logout", async (request, reply) => {
    if (await enforceRateLimit("signedAction", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    const token = readHeaderValue(request.headers["x-advertiser-token"]);
    if (token) await options.repository.invalidateAdvertiserSession(token);
    return { ok: true };
  });

  app.get("/v1/advertiser/campaigns", async (request, reply) => {
    if (await enforceRateLimit("feedRead", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    const campaigns = await options.repository.listSponsoredCardsByAdvertiser(advertiserId);
    return { campaigns };
  });

  app.get("/v1/advertiser/billing", async (request, reply) => {
    if (await enforceRateLimit("feedRead", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;

    const [campaignsResult, pricingResult, requestsResult] = await Promise.allSettled([
      options.repository.listSponsoredCardsByAdvertiser(advertiserId),
      readSponsoredPricingConfig(options.repository),
      options.repository.listAdvertiserBillingRequests(advertiserId),
    ]);
    if (campaignsResult.status !== "fulfilled") {
      throw campaignsResult.reason;
    }
    if (pricingResult.status !== "fulfilled") {
      throw pricingResult.reason;
    }

    const campaigns = campaignsResult.value;
    const pricing = pricingResult.value;
    const requests = requestsResult.status === "fulfilled" ? requestsResult.value : [];

    const invoiceCandidates = campaigns.filter(
      (campaign) => campaign.approvalStatus === "approved" && campaign.billingStatus === "payment_required"
    );
    const openInvoices = (
      await Promise.allSettled(
        invoiceCandidates.map(async (campaign) => {
          const reservation = await options.repository.createAdvertiserCampaignPaymentIntent({
            advertiserId,
            cardId: campaign.id,
          });
          if (!reservation.success) {
            return null;
          }
          return {
            id: campaign.id,
            headline: campaign.headline,
            billingAmountUsdc: reservation.billingAmountUsdc,
            impressionLimit: campaign.impressionLimit,
            cardFormat: campaign.cardFormat,
            placement: campaign.placement,
            endsAt: campaign.endsAt,
            paymentIntentId: reservation.reservation.id,
            paymentIntentExpiresAt: reservation.reservation.expiresAt,
            paymentRequestUrl: buildSponsoredPaymentRequestUrl({
              platformWallet: options.platformWallet,
              amountUsdc: reservation.billingAmountUsdc,
              headline: campaign.headline,
            }),
          };
        })
      )
    ).flatMap((result) => {
      if (result.status !== "fulfilled") {
        request.log.warn(
          { advertiserId, err: result.reason instanceof Error ? result.reason.message : result.reason },
          "[advertiser] failed to build one billing invoice"
        );
        return [];
      }
      return result.value ? [result.value] : [];
    });

    const paidUsdc = campaigns
      .filter((campaign) => campaign.billingStatus === "paid")
      .reduce((sum, campaign) => sum + campaign.billingAmountUsdc, 0);
    const outstandingUsdc = openInvoices.reduce((sum, campaign) => sum + campaign.billingAmountUsdc, 0);

    return {
      platformWallet: options.platformWallet,
      pricing,
      openInvoices,
      requests,
      summary: {
        approvedAwaitingPayment: openInvoices.length,
        outstandingUsdc,
        paidUsdc,
      },
    };
  });

  app.post("/v1/advertiser/campaigns", async (request, reply) => {
    if (await enforceRateLimit("signedAction", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    if (await enforceRateLimit("signedAction", `adv:${advertiserId}`, reply)) return;
    const parsed = createCampaignSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    const d = parsed.data;
    const advertiser = await options.repository.getAdvertiserById(advertiserId);
    if (!advertiser) return reply.code(401).send({ error: "unauthorized" });
    if (!advertiser.companyName) return reply.code(409).send({ error: "onboarding_required" });

    const destinationUrl = parsePublicHttpsUrl(d.destinationUrl);
    if (!destinationUrl) return reply.code(400).send({ error: "invalid_destination_url" });
    const imageUrl = d.imageUrl ? parsePublicHttpsUrl(d.imageUrl) : null;
    if (d.imageUrl && !imageUrl) return reply.code(400).send({ error: "invalid_image_url" });
    const actionUrl = d.actionUrl ? parseActionUrl(d.actionUrl) : null;
    if (d.actionUrl && !actionUrl) return reply.code(400).send({ error: "invalid_action_url" });

    const startsAt = d.startsAt ? new Date(d.startsAt) : new Date();
    const endsAt = new Date(d.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      return reply.code(400).send({ error: "invalid_schedule" });
    }

    const pricing = await readSponsoredPricingConfig(options.repository);
    const invoice = computeSponsoredInvoice({
      pricing,
      cardFormat: d.cardFormat,
      placement: d.placement,
      impressionLimit: d.impressionLimit,
    });

    const id = await options.repository.createSponsoredCardForAdvertiser(advertiserId, {
      headline:        d.headline,
      bodyText:        d.bodyText,
      imageUrl:        imageUrl?.toString(),
      destinationUrl:  destinationUrl.toString(),
      ctaText:         d.ctaText,
      accentColor:     d.accentColor,
      cardFormat:      d.cardFormat,
      placement:       d.placement,
      targetAudience:  d.targetAudience,
      campaignGoal:    d.campaignGoal,
      actionUrl:       actionUrl ?? undefined,
      startsAt,
      endsAt,
      impressionLimit: invoice.impressionLimit,
      billingAmountUsdc: invoice.billingAmountUsdc,
    });
    return reply.code(201).send({
      ok: true,
      id,
      reviewStatus: "pending",
      billingStatus: "approval_pending",
      billingAmountUsdc: invoice.billingAmountUsdc,
      impressionLimit: invoice.impressionLimit,
    });
  });

  app.patch("/v1/advertiser/campaigns/:id", async (request, reply) => {
    if (await enforceRateLimit("signedAction", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });

    const body = updateCampaignSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_input", details: body.error.flatten() });
    const d = body.data;

    const campaign = await options.repository.getSponsoredCardForAdvertiser(params.data.id, advertiserId);
    if (!campaign) return reply.code(404).send({ error: "not_found" });

    const destinationUrl = d.destinationUrl !== undefined ? parsePublicHttpsUrl(d.destinationUrl) : undefined;
    if (d.destinationUrl !== undefined && !destinationUrl) {
      return reply.code(400).send({ error: "invalid_destination_url" });
    }

    let imageUrl: string | null | undefined;
    if (d.imageUrl !== undefined) {
      if (d.imageUrl === null) {
        imageUrl = null;
      } else {
        const parsedImageUrl = parsePublicHttpsUrl(d.imageUrl);
        if (!parsedImageUrl) return reply.code(400).send({ error: "invalid_image_url" });
        imageUrl = parsedImageUrl.toString();
      }
    }

    let actionUrl: string | null | undefined;
    if (d.actionUrl !== undefined) {
      if (d.actionUrl === null) {
        actionUrl = null;
      } else {
        actionUrl = parseActionUrl(d.actionUrl);
        if (!actionUrl) return reply.code(400).send({ error: "invalid_action_url" });
      }
    }

    const nextCampaignGoal = d.campaignGoal ?? campaign.campaignGoal;
    const nextActionUrl = actionUrl !== undefined ? actionUrl : campaign.actionUrl;
    if (nextCampaignGoal === "action" && !nextActionUrl) {
      return reply.code(400).send({ error: "action_url_required_for_action_campaign" });
    }

    const startsAt = d.startsAt ? new Date(d.startsAt) : new Date(campaign.startsAt);
    const endsAt = d.endsAt ? new Date(d.endsAt) : new Date(campaign.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      return reply.code(400).send({ error: "invalid_schedule" });
    }

    const nextCardFormat = (d.cardFormat ?? campaign.cardFormat) as "classic" | "banner" | "spotlight" | "portrait";
    const nextPlacement = (d.placement ?? campaign.placement) as "feed" | "predict" | "both";
    const pricing = await readSponsoredPricingConfig(options.repository);
    const invoice = computeSponsoredInvoice({
      pricing,
      cardFormat: nextCardFormat,
      placement: nextPlacement,
      impressionLimit: d.impressionLimit !== undefined ? d.impressionLimit : campaign.impressionLimit,
    });

    const updated = await options.repository.updateSponsoredCardForAdvertiser(advertiserId, params.data.id, {
      headline: d.headline,
      bodyText: d.bodyText,
      imageUrl,
      destinationUrl: destinationUrl?.toString(),
      ctaText: d.ctaText,
      accentColor: d.accentColor,
      cardFormat: d.cardFormat,
      placement: d.placement,
      targetAudience: d.targetAudience,
      campaignGoal: d.campaignGoal,
      actionUrl,
      startsAt: d.startsAt ? startsAt : undefined,
      endsAt: d.endsAt ? endsAt : undefined,
      impressionLimit: invoice.impressionLimit,
      billingAmountUsdc: invoice.billingAmountUsdc,
    });
    if (!updated) return reply.code(404).send({ error: "not_found" });

    return {
      ok: true,
      id: params.data.id,
      reviewStatus: "pending",
      billingStatus: "approval_pending",
      billingAmountUsdc: invoice.billingAmountUsdc,
      impressionLimit: invoice.impressionLimit,
    };
  });

  app.get("/v1/advertiser/campaigns/:id", async (request, reply) => {
    if (await enforceRateLimit("feedRead", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    const paramsSchema = z.object({ id: z.string().uuid() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });
    const campaign = await options.repository.getSponsoredCardForAdvertiser(params.data.id, advertiserId);
    if (!campaign) return reply.code(404).send({ error: "not_found" });
    return { campaign };
  });

  app.delete("/v1/advertiser/campaigns/:id", async (request, reply) => {
    if (await enforceRateLimit("signedAction", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    const paramsSchema = z.object({ id: z.string().uuid() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });
    const campaign = await options.repository.getSponsoredCardForAdvertiser(params.data.id, advertiserId);
    if (!campaign) return reply.code(404).send({ error: "not_found" });
    await options.repository.setSponsoredCardActiveForAdvertiser(params.data.id, advertiserId, false);
    return { ok: true };
  });

  app.post("/v1/advertiser/campaigns/:id/status", async (request, reply) => {
    if (await enforceRateLimit("signedAction", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });

    const body = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }

    const campaign = await options.repository.getSponsoredCardForAdvertiser(params.data.id, advertiserId);
    if (!campaign) return reply.code(404).send({ error: "not_found" });

    if (body.data.active && new Date(campaign.endsAt).getTime() <= Date.now()) {
      return reply.code(409).send({ error: "campaign_already_ended" });
    }
    if (body.data.active && campaign.approvalStatus !== "approved") {
      return reply.code(409).send({ error: "campaign_review_pending" });
    }
    if (body.data.active && campaign.billingStatus === "payment_required") {
      return reply.code(409).send({
        error: "campaign_payment_required",
        billingAmountUsdc: campaign.billingAmountUsdc,
      });
    }

    const updated = await options.repository.setSponsoredCardActiveForAdvertiser(
      params.data.id,
      advertiserId,
      body.data.active
    );
    if (!updated) return reply.code(404).send({ error: "not_found" });

    return { ok: true, id: params.data.id, active: body.data.active };
  });

  app.post("/v1/advertiser/campaigns/:id/pay", async (request, reply) => {
    if (await enforceRateLimit("signedAction", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });

    const body = z.object({
      txSignature: z.string().min(64).max(128),
      paymentIntentId: z.string().uuid().optional()
    }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }

    const [campaign, advertiser] = await Promise.all([
      options.repository.getSponsoredCardForAdvertiser(params.data.id, advertiserId),
      options.repository.getAdvertiserById(advertiserId),
    ]);
    if (!campaign) return reply.code(404).send({ error: "not_found" });
    if (!advertiser?.walletAddress) {
      return reply.code(409).send({ error: "advertiser_wallet_missing" });
    }
    if (!solanaRpcUrl) {
      return reply.code(503).send({ error: "billing_verification_unavailable" });
    }

    if (campaign.approvalStatus !== "approved") {
      return reply.code(409).send({ error: "campaign_not_approved" });
    }
    if (campaign.billingStatus === "not_required") {
      return reply.code(409).send({ error: "campaign_payment_not_required" });
    }
    if (campaign.billingStatus === "paid") {
      return {
        ok: true,
        id: campaign.id,
        billingStatus: "paid",
        paymentReceivedAt: campaign.paymentReceivedAt,
        alreadyPaid: true,
      };
    }

    const verification = await verifyUsdcPayment({
      rpcUrl: solanaRpcUrl,
      txSignature: body.data.txSignature,
      fromWallet: advertiser.walletAddress,
      toWallet: options.platformWallet,
      billingAmountCents: campaign.billingAmountUsdc,
    });

    if (!verification.ok) {
      return reply.code(400).send({
        error: "invalid_payment",
        reason: verification.reason ?? "verification_failed",
        expectedAmountUsdc: campaign.billingAmountUsdc,
        platformWallet: options.platformWallet,
      });
    }

    const recorded = await options.repository.recordSponsoredCampaignPayment({
      advertiserId,
      cardId: campaign.id,
      txSignature: body.data.txSignature,
      paymentIntentId: body.data.paymentIntentId,
    });

    if (!recorded.success) {
      if (
        recorded.reason === "not_found" ||
        recorded.reason === "approval_pending" ||
        recorded.reason === "campaign_rejected" ||
        recorded.reason === "payment_not_required" ||
        recorded.reason === "payment_intent_invalid" ||
        recorded.reason === "payment_intent_expired" ||
        recorded.reason === "tx_already_used"
      ) {
        const paymentExceptionId = await recordPaymentException({
          txSignature: body.data.txSignature,
          wallet: advertiser.walletAddress,
          purpose: "advertiser_campaign",
          expectedAmountSkr: campaign.billingAmountUsdc,
          referenceType: "campaign",
          referenceId: campaign.id,
          failureReason: recorded.reason,
          metadata: {
            advertiserId
          }
        });

        return reply.code(409).send({
          error: "campaign_payment_record_failed_after_transfer",
          reason: recorded.reason,
          expectedAmountUsdc: campaign.billingAmountUsdc,
          paymentExceptionId
        });
      }

      return reply.code(409).send({
        error: recorded.reason,
        expectedAmountUsdc: campaign.billingAmountUsdc,
      });
    }

    return {
      ok: true,
      id: campaign.id,
      billingStatus: "paid",
      paymentReceivedAt: recorded.paymentReceivedAt,
      amountUsdc: campaign.billingAmountUsdc,
    };
  });

  app.get("/v1/advertiser/campaigns/:id/payment-request", async (request, reply) => {
    if (await enforceRateLimit("feedRead", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });

    const campaign = await options.repository.getSponsoredCardForAdvertiser(params.data.id, advertiserId);
    if (!campaign) return reply.code(404).send({ error: "not_found" });

    const reservation = await options.repository.createAdvertiserCampaignPaymentIntent({
      advertiserId,
      cardId: campaign.id,
    });
    if (!reservation.success) {
      if (reservation.reason === "not_found") {
        return reply.code(404).send({ error: "not_found" });
      }
      if (reservation.reason === "approval_pending") {
        return reply.code(409).send({ error: "campaign_not_approved" });
      }
      if (reservation.reason === "campaign_rejected") {
        return reply.code(409).send({ error: "campaign_rejected" });
      }
      if (reservation.reason === "payment_not_required") {
        return reply.code(409).send({ error: "campaign_payment_not_required" });
      }
      if (reservation.reason === "already_paid") {
        return reply.code(409).send({ error: "already_paid" });
      }
      return reply.code(409).send({ error: "payment_intent_unavailable" });
    }

    const paymentRequestUrl = buildSponsoredPaymentRequestUrl({
      platformWallet: options.platformWallet,
      amountUsdc: reservation.billingAmountUsdc,
      headline: campaign.headline,
    });

    return {
      id: campaign.id,
      billingAmountUsdc: reservation.billingAmountUsdc,
      platformWallet: options.platformWallet,
      paymentIntentId: reservation.reservation.id,
      paymentIntentExpiresAt: reservation.reservation.expiresAt,
      paymentRequestUrl,
    };
  });

  app.get("/v1/advertiser/billing/requests", async (request, reply) => {
    if (await enforceRateLimit("feedRead", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;
    const requests = await options.repository.listAdvertiserBillingRequests(advertiserId);
    return { requests };
  });

  app.post("/v1/advertiser/billing/requests", async (request, reply) => {
    if (await enforceRateLimit("signedAction", `adv:${resolveRequestScope(request)}`, reply)) return;
    const advertiserId = await enforceAdvertiserAccess(request.headers as Record<string, string | string[] | undefined>, reply);
    if (!advertiserId) return;

    const body = z.object({
      cardId: z.string().uuid(),
      requestType: z.enum(["billing_review", "refund_request"]),
      note: z.string().min(10).max(1000),
    }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
    }

    const created = await options.repository.createAdvertiserBillingRequest({
      advertiserId,
      cardId: body.data.cardId,
      requestType: body.data.requestType,
      note: body.data.note.trim(),
    });

    if (!created.success) {
      const status =
        created.reason === "campaign_not_found" ? 404 :
        created.reason === "refund_requires_paid_campaign" ? 409 :
        409;
      return reply.code(status).send({ error: created.reason });
    }

    return reply.code(201).send({ ok: true, requestId: created.requestId });
  });

  // ── Sponsored card impression tracking (public) ───────────────────────────
  app.post("/v1/sponsored/:id/impression", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });
    if (await enforceRateLimit("adClick", `sponsored-impression:${params.data.id}:${resolveRequestScope(request)}`, reply)) return;
    try {
      const tracked = await options.repository.trackSponsoredEvent(params.data.id, "impression");
      if (!tracked) {
        return reply.code(404).send({ error: "campaign_not_found_or_inactive" });
      }
    } catch (err) {
      request.log.warn({ cardId: params.data.id, err: err instanceof Error ? err.message : err }, "[ads] impression tracking failed");
    }
    return { ok: true };
  });

  // ── Sponsored card click tracking (public) ────────────────────────────────
  app.post("/v1/sponsored/:id/click", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });
    if (await enforceRateLimit("adClick", `sponsored:${params.data.id}:${resolveRequestScope(request)}`, reply)) return;
    try {
      const tracked = await options.repository.trackSponsoredEvent(params.data.id, "click");
      if (!tracked) {
        return reply.code(404).send({ error: "campaign_not_found_or_inactive" });
      }
    } catch (err) {
      request.log.warn({ cardId: params.data.id, err: err instanceof Error ? err.message : err }, "[ads] click tracking failed");
    }
    return { ok: true };
  });

  // ── Sponsored card lead opt-in (authenticated) ────────────────────────────
  app.post("/v1/sponsored/:id/opt-in", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });

    const optInSchema = z.object({ wallet: walletAddressSchema });
    const body = optInSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    if (await enforceRateLimit("signedAction", resolveRequestScope(request), reply)) return;

    const sessionValid = await requireWalletSession(
      request.headers as Record<string, string | string[] | undefined>,
      body.data.wallet,
      reply
    );
    if (!sessionValid) return;

    // Verify campaign exists and is active
    const cards = await options.repository.getActiveSponsoredCards({ limit: 500 }).catch(() => []);
    const activeCard = cards.find(c => c.id === params.data.id);
    if (!activeCard) {
      return reply.code(404).send({ error: "campaign_not_found_or_inactive" });
    }

    const success = await options.repository.optInSponsoredCardLead(params.data.id, body.data.wallet);
    if (success) {
      // Also track it as a click
      await options.repository.trackSponsoredEvent(params.data.id, "click").catch((err) => {
        request.log.warn({ cardId: params.data.id, err: err instanceof Error ? err.message : err }, "[ads] opt-in click tracking failed");
      });
    }

    return { ok: true, success };
  });

  // ── Solana RPC Proxy ──────────────────────────────────────────────────────
  // Forwards JSON-RPC requests to the configured Helius endpoint.
  // The API key stays server-side; the APK only knows api.chainshorts.live/v1/rpc.
  app.post("/v1/rpc", async (request, reply) => {
    if (!solanaRpcUrl) {
      return reply.code(503).send({ error: "rpc_unavailable" });
    }
    const scope = resolveRequestScope(request);
    if (await enforceRateLimit("rpcProxy", scope, reply)) return;

    const upstream = await fetch(solanaRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
    const data = await upstream.json();
    return reply.status(upstream.status).send(data);
  });

  // ── Jupiter Proxy: Quote ──────────────────────────────────────────────────
  // Forwards quote requests to api.jup.ag with the Jupiter API key added server-side.
  app.get("/v1/jupiter/quote", async (request, reply) => {
    const scope = resolveRequestScope(request);
    if (await enforceRateLimit("jupiterProxy", scope, reply)) return;

    const queryString = new URLSearchParams(request.query as Record<string, string>).toString();
    const upstream = await fetch(`https://api.jup.ag/swap/v1/quote?${queryString}`, {
      headers: {
        ...(options.jupiterApiKey ? { "x-api-key": options.jupiterApiKey } : {}),
      },
    });
    const data = await upstream.json();
    return reply.status(upstream.status).send(data);
  });

  // ── Jupiter Proxy: Swap ───────────────────────────────────────────────────
  // Forwards swap transaction build requests to api.jup.ag with the API key server-side.
  app.post("/v1/jupiter/swap", async (request, reply) => {
    const scope = resolveRequestScope(request);
    if (await enforceRateLimit("jupiterProxy", scope, reply)) return;

    const upstream = await fetch("https://api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.jupiterApiKey ? { "x-api-key": options.jupiterApiKey } : {}),
      },
      body: JSON.stringify(request.body),
    });
    const data = await upstream.json();
    return reply.status(upstream.status).send(data);
  });

  return app;
}
