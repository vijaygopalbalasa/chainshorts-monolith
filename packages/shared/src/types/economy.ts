export type SkrTier = "basic" | "signal" | "alpha" | "pro";

export interface SkrTierPolicy {
  signal: number;
  alpha: number;
  pro: number;
  threatFeed: number;
  devFeed: number;
}

export interface SkrServicePricingPolicy {
  contentBoost: number;
  contributorStake: number;
  customAlertSubscription: number;
}

export interface EconomyPolicy {
  tiers: SkrTierPolicy;
  pricing: SkrServicePricingPolicy;
}

export const DEFAULT_ECONOMY_POLICY: EconomyPolicy = {
  tiers: {
    signal: 100,
    alpha: 500,
    pro: 2000,
    threatFeed: 200,
    devFeed: 100
  },
  pricing: {
    contentBoost: 50,
    contributorStake: 500,
    customAlertSubscription: 25
  }
};

export interface WalletBalanceSnapshot {
  wallet: string;
  solLamports: number;
  skrRaw: string;
  skrUi: number;
  usdcRaw?: string;
  usdcUi?: number;
  usdtRaw?: string;
  usdtUi?: number;
  tier: SkrTier;
  unlocks: string[];
  asOf: string;
}

export interface FeatureFlags {
  alphaFeed: boolean;
  threatFeed: boolean;
  opinionPolls: boolean;
  contentBoosts: boolean;
}

export interface ClientConfigResponse {
  featureFlags: FeatureFlags;
  economy: EconomyPolicy;
  appLinks: {
    appWebUrl: string;
    privacyPolicyUrl?: string;
  };
  predictions?: {
    disputeChallengeHours: number;
    disputeDepositSkr: number;
  };
  platformWallet?: string;
  generatedAt: string;
}
