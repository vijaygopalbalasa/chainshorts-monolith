import { describe, expect, it } from "vitest";
import { normalizeEntry } from "./normalize.js";

describe("normalizeEntry", () => {
  it("normalizes rss entries into raw + normalized records", () => {
    const result = normalizeEntry("src_test", "en", {
      id: "entry_1",
      link: "https://example.com/article?utm_source=twitter",
      title: "Solana Wallet Update",
      pubDate: "2026-01-01T00:00:00.000Z",
      description: "Body"
    });

    expect(result.raw.url).toBe("https://example.com/article");
    expect(result.normalized.id.startsWith("norm_")).toBe(true);
    expect(result.normalized.clusterId.startsWith("cluster_")).toBe(true);
  });
});
