export interface SponsorshipPolicy {
  dailyLimitPerWallet: number;
}

export interface SponsorshipUsage {
  wallet: string;
  date: string;
  usedCount: number;
}

export type SponsorshipDecision =
  | { mode: "sponsored"; sponsorAvailable: true; remainingSponsoredCount: number }
  | { mode: "user_pays"; sponsorAvailable: false; remainingSponsoredCount: 0 };

export function evaluateSponsorship(policy: SponsorshipPolicy, usage: SponsorshipUsage): SponsorshipDecision {
  const remaining = Math.max(0, policy.dailyLimitPerWallet - usage.usedCount);
  if (remaining > 0) {
    return {
      mode: "sponsored",
      sponsorAvailable: true,
      remainingSponsoredCount: remaining
    };
  }

  return {
    mode: "user_pays",
    sponsorAvailable: false,
    remainingSponsoredCount: 0
  };
}
