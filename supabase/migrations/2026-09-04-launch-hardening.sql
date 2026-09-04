-- GoRentHive launch hardening — 2026-09-04
-- Safe migration for an existing Supabase database. Do not rerun schema.sql.

-- Payment code uses booking_pay for a PayMongo-funded booking wallet credit.
alter table public.payments drop constraint if exists payments_type_check;
alter table public.payments add constraint payments_type_check check (
  type in ('rental','deposit','refund','payout','platform_fee','featured','referral','withdrawal','topup','booking_pay')
);

-- Preserve the exact contract/policy that applied when the booking was made.
alter table public.bookings add column if not exists agreement_version text not null default '2.0';
alter table public.bookings add column if not exists agreement_snapshot text not null default '{}';
alter table public.bookings add column if not exists late_fee_rule text not null default '{}';
alter table public.bookings add column if not exists late_days integer not null default 0;
alter table public.bookings add column if not exists handover_confirmed boolean not null default false;
alter table public.bookings add column if not exists payment_confirmed boolean not null default false;

-- A condition upload is evidence; confirmation by the counterparty is separate.
alter table public.condition_records add column if not exists status text not null default 'submitted';
alter table public.condition_records drop constraint if exists condition_records_status_check;
alter table public.condition_records add constraint condition_records_status_check check (status in ('submitted','confirmed','disputed'));

-- One agreement per booking; upsert(onConflict=booking_id) relies on this.
create unique index if not exists rental_agreements_booking_unique_idx on public.rental_agreements(booking_id);

-- New installs should use exactly 8% unless an administrator deliberately changes it.
insert into public.admin_settings(key, value, updated_at)
values ('platform_percent', '8', (extract(epoch from now()) * 1000)::bigint)
on conflict (key) do update set value = '8', updated_at = excluded.updated_at;

-- Retire the old minimum-fee behavior. Kept as a setting for compatibility,
-- but server/settings.js no longer applies a minimum commission.
insert into public.admin_settings(key, value, updated_at)
values ('platform_min_fee', '0', (extract(epoch from now()) * 1000)::bigint)
on conflict (key) do update set value = '0', updated_at = excluded.updated_at;
