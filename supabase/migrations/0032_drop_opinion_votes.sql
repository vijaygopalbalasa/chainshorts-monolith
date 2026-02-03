-- Migration 0032: Drop opinion_votes table (opinion polls removed — prediction markets replaced them)
-- NOTE: opinion_polls table is KEPT — it stores prediction market questions (is_prediction=true)
-- opinion_votes (free votes with no SKR stakes) are the only table being removed here

DROP TABLE IF EXISTS opinion_votes CASCADE;
