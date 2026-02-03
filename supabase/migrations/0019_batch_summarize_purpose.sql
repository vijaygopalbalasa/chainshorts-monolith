-- Add batch_summarize to model_runs purpose check constraint
ALTER TABLE model_runs DROP CONSTRAINT IF EXISTS model_runs_purpose_check;

ALTER TABLE model_runs ADD CONSTRAINT model_runs_purpose_check CHECK (
  purpose IN (
    'translate',
    'summarize',
    'batch_summarize',
    'relevance_filter',
    'fact_check',
    'post_check',
    'trend_detect',
    'threat_classify',
    'opinion_resolve'
  )
);
