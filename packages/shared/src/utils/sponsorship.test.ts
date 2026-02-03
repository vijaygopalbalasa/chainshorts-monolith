import { describe, expect, it } from "vitest";
import { evaluateSponsorship } from "./sponsorship.js";

describe("evaluateSponsorship", () => {
  it("returns sponsored while quota remains", () => {
    const result = evaluateSponsorship(
      { dailyLimitPerWallet: 3 },
      { wallet: "wallet", date: "2026-01-01", usedCount: 1 }
    );

    expect(result.mode).toBe("sponsored");
    expect(result.remainingSponsoredCount).toBe(2);
  });

  it("falls back to user-pays once quota is exhausted", () => {
    const result = evaluateSponsorship(
      { dailyLimitPerWallet: 1 },
      { wallet: "wallet", date: "2026-01-01", usedCount: 1 }
    );

    expect(result).toEqual({
      mode: "user_pays",
      sponsorAvailable: false,
      remainingSponsoredCount: 0
    });
  });
});
