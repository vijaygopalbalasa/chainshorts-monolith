-- Migration 0029: RLS for sponsored card leads

ALTER TABLE sponsored_card_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sponsored_card_leads_deny_all" ON sponsored_card_leads
  AS RESTRICTIVE FOR ALL USING (false);
