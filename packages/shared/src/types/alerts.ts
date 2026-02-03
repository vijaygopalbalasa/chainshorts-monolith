export type ThreatSeverity = "RED" | "ORANGE" | "YELLOW";
export type ThreatAlertType = "rug_pull" | "whale_dump" | "governance_attack" | "contract_vulnerability" | "bridge_exploit" | "community";

export interface ThreatAlert {
  id: string;
  severity: ThreatSeverity;
  type: ThreatAlertType;
  confidence: number;
  headline: string;
  summary60: string;
  recommendation: string;
  txHash?: string;
  sourceUrl?: string;
  communitySignal: number;
  createdAt: string;
}

export interface ThreatAlertPage {
  items: ThreatAlert[];
  nextCursor?: string;
}

export interface AlertSubmissionRequest {
  wallet: string;
  txHash: string;
  observation: string;
  confidence: number;
}

export interface AlertSubmissionResult {
  submissionId: string;
  status: "queued" | "auto_published";
  queuedForReview: boolean;
}

export interface AlertVoteResult {
  alertId: string;
  wallet: string;
  vote: "helpful" | "false_alarm";
  communitySignal: number;
  createdAt: string;
}
