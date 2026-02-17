export interface HeliusLikeTransferEvent {
  signature?: string;
  tokenTransfers?: Array<{
    mint?: string;
    tokenAmount?: number;
    usdValue?: number;
    fromUserAccount?: string;
    toUserAccount?: string;
  }>;
}

export interface WhaleAssessment {
  triggered: boolean;
  confidence: number;
  severity: "RED" | "ORANGE";
  headline?: string;
  summary60?: string;
  txHash?: string;
}

function clampWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text;
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export function detectWhaleDump(
  event: HeliusLikeTransferEvent,
  thresholdUsd: number
): WhaleAssessment {
  const transfers = Array.isArray(event.tokenTransfers) ? event.tokenTransfers : [];
  const maxUsd = transfers.reduce((max, transfer) => {
    const usd = transfer.usdValue ?? 0;
    return usd > max ? usd : max;
  }, 0);
  if (maxUsd < thresholdUsd) {
    return { triggered: false, confidence: 0, severity: "ORANGE" };
  }

  const confidence = Math.min(0.97, 0.75 + Math.min(0.2, maxUsd / (thresholdUsd * 10)));
  const severity: "RED" | "ORANGE" = confidence >= 0.9 ? "RED" : "ORANGE";

  return {
    triggered: true,
    confidence,
    severity,
    headline: "Whale-scale token movement flagged",
    summary60: clampWords(
      "A large token transfer with elevated USD value was detected and may indicate potential distribution pressure. While transfers can be operational, this size often precedes volatility when market depth is thin. Monitor exchange inflows, official team updates, and follow-up wallet behavior before taking directional risk. This alert is contextual and should be independently verified before action.",
      60
    ),
    txHash: event.signature
  };
}
