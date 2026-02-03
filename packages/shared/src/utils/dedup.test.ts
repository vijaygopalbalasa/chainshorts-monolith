import { describe, expect, it } from "vitest";
import { computeClusterId, computeDedupHash } from "./dedup.js";

describe("dedup helpers", () => {
  it("keeps dedup hash stable for canonicalized url + title", () => {
    const hashA = computeDedupHash("Solana ETF update", "https://example.com/story?utm_source=x");
    const hashB = computeDedupHash("Solana ETF update", "https://example.com/story");
    expect(hashA).toBe(hashB);
  });

  it("clusters semantically similar central bank headlines together", () => {
    const clusterA = computeClusterId("Fed hikes rates after inflation report");
    const clusterB = computeClusterId("Federal Reserve raises interest rates amid inflation data");
    expect(clusterA).toBe(clusterB);
  });
});

