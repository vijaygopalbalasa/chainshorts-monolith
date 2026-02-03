-- Add missing config keys for batch processing
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('agent_model_batch_summarizer', 'deepseek/deepseek-chat-v3-0324', 'string', 'Batch Summarizer Model', 'LLM model for batch processing (10 articles per call)', 'models'),
  ('batch_size', '10', 'integer', 'Batch Size', 'Number of articles to process per LLM call', 'ingest')
ON CONFLICT (key) DO NOTHING;
