import type { PredictionTopic } from "./agents/topicClassifier.js";

export type PredictionSessionStatus =
  | "pending"
  | "classifying"
  | "generating"
  | "verifying"
  | "deduplicating"
  | "publishing"
  | "completed"
  | "failed"
  | "skipped";

export interface PredictionSession {
  id: string;
  articleId: string;
  status: PredictionSessionStatus;
  topic: PredictionTopic | null;
  topicConfidence: number;
  generatedQuestion: string | null;
  generatorConfidence: number;
  verifierConfidence: number;
  isDuplicate: boolean;
  duplicateOf: string | null;
  pollId: string | null;
  failureReason: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface ArticleCandidate {
  id: string;
  headline: string;
  summary60: string;
  category: string;
}

export interface PollToResolve {
  id: string;
  question: string;
  resolutionRule: ResolutionRule;
  deadlineAt: string;
  isPrediction: boolean;
  yesVotes: number;
  noVotes: number;
  platformFeePct: number;
}

export interface ResolutionRule {
  kind: "price_above" | "price_below" | "event_occurs" | "community_majority";
  symbol?: string;
  target?: number;
}

/** Agent configuration for each pipeline stage */
interface AgentConfig {
  apiKey: string;
  model: string;
  appName: string;
  appUrl: string;
}

export interface AgentModelsConfig {
  /** Stage 1: Determines if article is prediction-worthy */
  topicClassifier: AgentConfig;
  /** Stage 2: Generates binary prediction question */
  questionGenerator: AgentConfig;
  /** Stage 3: Validates question quality */
  questionVerifier: AgentConfig;
  /** Stage 4: AI-powered semantic duplicate detection */
  duplicateChecker: AgentConfig;
  /** Resolution: 3 LLMs for multi-agent consensus */
  resolverModels: [string, string, string];
  openRouterApiKey: string;
  appWebUrl: string;
}

export interface PipelineResult {
  session: PredictionSession;
  success: boolean;
}

export interface ResolutionResult {
  pollId: string;
  outcome: "yes" | "no" | "indeterminate";
  confidence: number;
  source: string;
  settled: boolean;
  failureReason?: string;
}
