import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "./url.js";

describe("canonicalizeUrl", () => {
  it("removes tracking params and trailing slash", () => {
    const url = canonicalizeUrl("https://example.com/news/story/?utm_source=twitter&x=1&fbclid=abc");
    expect(url).toBe("https://example.com/news/story?x=1");
  });

  it("preserves deterministic query ordering", () => {
    const url = canonicalizeUrl("https://example.com?a=2&b=1");
    expect(url).toBe("https://example.com/?a=2&b=1");
  });
});
