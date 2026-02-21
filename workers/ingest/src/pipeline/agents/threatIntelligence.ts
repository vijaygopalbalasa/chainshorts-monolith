export type ThreatSeverity = "RED" | "ORANGE" | "YELLOW";

export interface ThreatSignalInput {
  txHash?: string;
  usdValue?: number;
  tokenSymbol?: string;
  context?: string;
}

export interface ThreatAssessment {
  triggered: boolean;
  severity: ThreatSeverity;
  confidence: number;
  headline: string;
  summary60: string;
  recommendation: string;
  txHash?: string;
}

export interface ThreatThresholds {
  whaleDumpUsd: number;
  criticalMultiplier: number;
}

const DEFAULT_THRESHOLDS: ThreatThresholds = {
  whaleDumpUsd: 500_000,
  criticalMultiplier: 4
};

function clampWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export function assessWhaleDump(
  input: ThreatSignalInput,
  thresholds: Partial<ThreatThresholds> = {}
): ThreatAssessment {
  const merged = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds
  };

  const usdValue = Math.max(0, input.usdValue ?? 0);
  if (usdValue < merged.whaleDumpUsd) {
    return {
      triggered: false,
      severity: "YELLOW",
      confidence: 0,
      headline: "No material whale risk detected",
      summary60: "Observed transfer is below configured whale-dump threshold.",
      recommendation: "Monitor"
    };
  }

  const severity: ThreatSeverity =
    usdValue >= merged.whaleDumpUsd * merged.criticalMultiplier ? "RED" : "ORANGE";
  const confidence = Math.min(0.98, 0.72 + Math.min(0.24, usdValue / (merged.whaleDumpUsd * 20)));
  const token = input.tokenSymbol?.trim().toUpperCase() || "token";
  const summary = clampWords(
    `Large ${token} transfer activity exceeded the configured whale threshold and may increase short-term sell pressure. High-value movements can also be treasury rebalancing, so verify destination wallets, exchange inflows, and official disclosures before reacting. Use this as an early risk signal, not definitive exploit confirmation, and size positions with volatility controls until follow-up data arrives.`,
    60
  );

  return {
    triggered: true,
    severity,
    confidence,
    headline: "Whale-scale transfer risk detected",
    summary60: summary,
    recommendation: severity === "RED" ? "Consider reducing exposure" : "Monitor closely",
    txHash: input.txHash
  };
}
