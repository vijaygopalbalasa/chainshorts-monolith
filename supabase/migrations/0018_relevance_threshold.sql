-- Add relevance_min_confidence config (lower to allow more articles through)
INSERT INTO system_config (key, value, value_type, label, description, category)
VALUES ('relevance_min_confidence', '0.3', 'float', 'Relevance Min Confidence', 'Minimum confidence for relevance filter to pass (0.0–1.0)', 'pipeline')
ON CONFLICT (key) DO UPDATE SET value = '0.3', updated_at = now();
