-- ============================================================
-- 0027_prediction_payout_in_progress.sql
-- Add in_progress transfer status for atomic payout claim flow.
-- ============================================================

begin;

alter table if exists prediction_payouts
  drop constraint if exists prediction_payouts_transfer_status_check;

alter table if exists prediction_payouts
  add constraint prediction_payouts_transfer_status_check
  check (transfer_status in ('pending', 'in_progress', 'completed', 'failed', 'manual_required'));

commit;
