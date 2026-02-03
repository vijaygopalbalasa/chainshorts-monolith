import { describe, expect, it } from "vitest";
import { countWords, ensureExactly60Words } from "./wordCount.js";

describe("wordCount", () => {
  it("counts words accurately", () => {
    expect(countWords("hello world from chainshorts")).toBe(4);
  });

  it("validates strict 60-word summaries", () => {
    const text = Array.from({ length: 60 }, (_, index) => `w${index + 1}`).join(" ");
    expect(ensureExactly60Words(text)).toEqual({ ok: true });

    const shorter = Array.from({ length: 59 }, (_, index) => `w${index + 1}`).join(" ");
    expect(ensureExactly60Words(shorter)).toEqual({ ok: false, wordCount: 59 });
  });
});
