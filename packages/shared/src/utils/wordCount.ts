export function tokenizeWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{Nd}]+|[^\p{L}\p{Nd}]+$/gu, ""))
    .filter(Boolean);
}

export function countWords(text: string): number {
  return tokenizeWords(text).length;
}

export function isExactlyNWords(text: string, n: number): boolean {
  return countWords(text) === n;
}

export function ensureExactly60Words(text: string): { ok: true } | { ok: false; wordCount: number } {
  const wordCount = countWords(text);
  if (wordCount !== 60) {
    return { ok: false, wordCount };
  }

  return { ok: true };
}
