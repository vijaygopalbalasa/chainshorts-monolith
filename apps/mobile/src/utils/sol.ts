const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Convert lamports to a human-readable SOL string.
 * Examples: 50_000 → "0.00005 SOL", 1_000_000_000 → "1 SOL"
 */
export function lamportsToSolString(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol >= 1) {
    return `${sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`;
  }
  if (sol >= 0.001) {
    return `${sol.toFixed(4)} SOL`;
  }
  return `${sol.toFixed(8).replace(/\.?0+$/, "")} SOL`;
}

/**
 * Format lamports with the ◎ symbol (Solana symbol).
 * Examples: 50_000 → "◎0.00005"
 */
export function lamportsToSolSymbol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol >= 1) {
    return `◎${sol.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }
  if (sol >= 0.001) {
    return `◎${sol.toFixed(4)}`;
  }
  return `◎${sol.toFixed(8).replace(/\.?0+$/, "")}`;
}
