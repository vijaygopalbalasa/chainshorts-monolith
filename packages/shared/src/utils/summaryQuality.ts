import { ensureExactly60Words } from "./wordCount.js";

const BANNED_PATTERNS = [/as an ai/i, /i cannot/i, /lorem ipsum/i];

export function validateSummaryQuality(summary: string): { ok: true } | { ok: false; reason: string } {
  const words = ensureExactly60Words(summary);
  if (!words.ok) {
    return { ok: false, reason: `Summary must have exactly 60 words, got ${words.wordCount}` };
  }

  for (const banned of BANNED_PATTERNS) {
    if (banned.test(summary)) {
      return { ok: false, reason: `Summary contains banned pattern: ${banned}` };
    }
  }

  if (summary.includes("http://") || summary.includes("https://")) {
    return { ok: false, reason: "Summary must not include URLs" };
  }

  return { ok: true };
}
