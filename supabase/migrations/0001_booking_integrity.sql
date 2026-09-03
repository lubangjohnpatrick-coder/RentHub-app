-- 0001_booking_integrity.sql
-- Production integrity guards for the bookings table. Apply via the Supabase
-- SQL editor. Idempotent (safe to run multiple times).

-- 1. Idempotency: a given (renter, client_request_id) can only ever produce
--    one booking. This makes double-click / API retry duplicates impossible
--    at the data layer even if the server-level check is bypassed.
alter table public.bookings drop constraint if exists bookings_idem_uniq;
alter table public.bookings add constraint bookings_idem_uniq unique (renter_id, client_request_id);

-- 2. Double-booking protection: no two confirmed/pending/active bookings may
--    share the same listing with overlapping date ranges. This closes the
--    check-then-insert race that the REST availability check cannot.
--    Requires the btree_gist extension (provides "=` on bigint plus int8range).
create extension if not exists btree_gist;

alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap exclude using gist (
  listing_id with =,
  int8range(start_date, end_date, '[]') with &&
) where (status in ('pending', 'approved', 'active'));

-- 3. client_request_id column (added by server code / financial.js). Add only
--    if it does not yet exist on the live database.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'bookings'
                   and column_name = 'client_request_id') then
    alter table public.bookings add column client_request_id text;
  end if;
end $$;

-- 4. Financial-history snapshot at booking time (reviewer #21). A booking must
--    preserve the rate and commission that applied when it was created, so
--    later price/commission changes never rewrite past transactions.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'bookings'
                   and column_name = 'daily_rate_at_booking') then
    alter table public.bookings add column daily_rate_at_booking integer not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'bookings'
                   and column_name = 'commission_rate_at_booking') then
    alter table public.bookings add column commission_rate_at_booking double precision not null default 0;
  end if;
end $$;

-- 5. Cancellation refund audit trail (reviewer #20). Track how much was refunded
--    and when, and allow the refunded/refund_pending lifecycle states.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'bookings'
                   and column_name = 'refund_amount') then
    alter table public.bookings add column refund_amount integer not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'bookings'
                   and column_name = 'refunded_at') then
    alter table public.bookings add column refunded_at bigint;
  end if;
end $$;

-- Allow the new lifecycle states in the bookings status constraint.
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check check (
  status in ('pending','approved','rejected','active','returned','completed','disputed','cancelled','refund_pending','refunded')
);

-- 6. Rental-agreement version snapshot (reviewer #19). Record which agreement
--    version each booking accepted.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'rental_agreements'
                   and column_name = 'agreement_version') then
    alter table public.rental_agreements add column agreement_version text not null default '1.0';
  end if;
end $$;