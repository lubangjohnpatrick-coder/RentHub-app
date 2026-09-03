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