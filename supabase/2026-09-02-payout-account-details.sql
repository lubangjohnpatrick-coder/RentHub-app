-- ============================================================
-- GoRentHive: payout / refund / founder-account collection patch
-- Run ONCE in the Supabase SQL Editor (idempotent, safe to re-run).
-- ============================================================

-- Payouts: collect the full payout destination details so admin can remit.
alter table public.payouts
  add column if not exists account_name text default '',
  add column if not exists bank_name text default '',
  add column if not exists account_holder text default '',
  add column if not exists payout_note text default '';

-- Refunds: record where the renter wants non-wallet refunds sent.
alter table public.refunds
  add column if not exists method text default '',
  add column if not exists account text default '',
  add column if not exists account_name text default '';

-- Users: preferred default refund / payout destination (renter + owner reuse).
alter table public.users
  add column if not exists payout_preference text default '',
  add column if not exists payout_account text default '',
  add column if not exists payout_account_name text default '';

-- Founder payout account is stored as admin_settings rows (key=value):
--   founder_payout_method     -> 'gcash' | 'maya' | 'bank'
--   founder_payout_account    -> account number / GCash mobile
--   founder_payout_account_name -> account holder name
--   founder_payout_bank       -> bank name (when method = bank)
-- No schema change needed for these (admin_settings is generic key/value).
