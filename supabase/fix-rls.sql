-- GoRentHive: security + monetization patch (run once in Supabase SQL Editor)
-- NOTE: the fix-rls.sql rename -- this one also applies the new business model.
-- Safe to re-run (drop/revoke/on-conflict are idempotent).

-- ============================================================
-- PART A: SECURITY FIXES (required before deploy)
-- ============================================================

-- A1. Remove self-referencing users policy that caused "infinite recursion"
drop policy if exists "admins read all" on public.users;

-- A2. Restrict SECURITY DEFINER financial RPC functions to service_role only.
-- (Supabase default privileges grant EXECUTE to PUBLIC, so we revoke from
--  PUBLIC + anon + authenticated and allow only service_role.)
revoke all on function public.ledger_entry(bigint, uuid, text, integer, text) from public;
revoke all on function public.ledger_entry(bigint, uuid, text, integer, text) from anon, authenticated;
grant execute on function public.ledger_entry(bigint, uuid, text, integer, text) to service_role;

revoke all on function public.get_user_balance(uuid) from public;
revoke all on function public.get_user_balance(uuid) from anon, authenticated;
grant execute on function public.get_user_balance(uuid) to service_role;

-- ============================================================
-- PART B: MONETIZATION MODEL (8% / min 20 / premium / caps / featured)
-- ============================================================

-- Upsert all monetization settings so live values match the new plan.
insert into public.admin_settings (key, value, updated_at) values
('platform_percent','8',0),
('platform_min_fee','20',0),
('premium_fee','1499',0),
('free_listing_limit','15',0),
('extra_listing_fee','10',0),
('featured_fee','49',0),
('featured_days','30',0)
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

-- ============================================================
-- PART C: COMMISSION RATE for existing bookings
-- ============================================================

-- Compute commission as max(8% of rental_fee, 20).
create or replace function public.compute_platform_fee(p_rental_fee numeric)
returns numeric language sql immutable as $$
  select greatest(round(p_rental_fee * 0.08, 2), 20);
$$;

-- ============================================================
-- PART D: PREMIUM MEMBERSHIP (P1499/yr)
-- ============================================================

-- Track premium expiry on the users row (bigint epoch ms; NULL = not premium).
alter table public.users add column if not exists premium_until bigint;
create index if not exists users_premium_until_idx on public.users(premium_until);
