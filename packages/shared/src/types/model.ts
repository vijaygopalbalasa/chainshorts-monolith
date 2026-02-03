export interface ModelRun {
  id: string;
  provider: string;
  model: string;
  purpose:
    | "translate"
    | "summarize"
    | "batch_summarize"
    | "relevance_filter"
    | "fact_check"
    | "post_check"
    | "trend_detect"
    | "threat_classify"
    | "opinion_resolve";
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  createdAt: string;
}
