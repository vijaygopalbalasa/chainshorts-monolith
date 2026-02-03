-- Migration 0028: Sponsored feed cards V2 (Targeting, Blinks, and Lead Gen)

-- 1. Add targeting, goal, and action_url columns
ALTER TABLE sponsored_cards
  ADD COLUMN IF NOT EXISTS target_audience text NOT NULL DEFAULT 'all' CHECK (target_audience IN ('all', 'defi_degens', 'whales', 'nft_collectors')),
  ADD COLUMN IF NOT EXISTS campaign_goal text NOT NULL DEFAULT 'traffic' CHECK (campaign_goal IN ('traffic', 'action', 'lead_gen')),
  ADD COLUMN IF NOT EXISTS action_url text;

-- 2. Create lead generation table
CREATE TABLE IF NOT EXISTS sponsored_card_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES sponsored_cards(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_sponsored_card_leads_card ON sponsored_card_leads (card_id);
CREATE INDEX IF NOT EXISTS idx_sponsored_card_leads_wallet ON sponsored_card_leads (wallet_address);

-- 3. Update chainrep events to reward ad interactions
ALTER TABLE chainrep_events DROP CONSTRAINT IF EXISTS chainrep_events_event_type_check;
ALTER TABLE chainrep_events ADD CONSTRAINT chainrep_events_event_type_check CHECK (
  event_type in (
    'daily_checkin',
    'streak_bonus',
    'opinion_correct',
    'alert_confirmed',
    'manual_adjustment',
    'ad_interaction'
  )
);
