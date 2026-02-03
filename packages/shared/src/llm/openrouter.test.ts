import { describe, expect, it } from "vitest";
import { buildSummaryPrompt, buildTranslationPrompt, parseSummaryResponse } from "./openrouter.js";

describe("openrouter helpers", () => {
  it("builds a deterministic summarization prompt", () => {
    const prompt = buildSummaryPrompt({
      headline: "Solana wallet UX improves",
      body: "Long article body",
      sourceLanguage: "en"
    });

    expect(prompt).toContain("exactly 60 words");
    expect(prompt).toContain("Solana wallet UX improves");
  });

  it("parses fenced model responses", () => {
    const parsed = parseSummaryResponse("```\nsummary: hello world\n```");
    expect(parsed).toBe("hello world");
  });

  it("builds a deterministic translation prompt", () => {
    const prompt = buildTranslationPrompt({
      text: "Hola mundo cripto",
      sourceLanguage: "es"
    });

    expect(prompt).toContain("Translate input text into natural English");
    expect(prompt).toContain("SOURCE_LANGUAGE:");
    expect(prompt).toContain("Hola mundo cripto");
  });
});
