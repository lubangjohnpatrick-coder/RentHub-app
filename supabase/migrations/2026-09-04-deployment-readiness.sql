-- GoRentHive deployment-readiness migration — 2026-09-04
-- Adds server-side idempotency support required by server/booking-v2.js.

alter table public.bookings
  add column if not exists client_request_id text;

create unique index if not exists bookings_renter_client_request_unique_idx
  on public.bookings(renter_id, client_request_id)
  where client_request_id is not null;

comment on column public.bookings.client_request_id is
  'Server-side idempotency key for preventing duplicate booking creation/repeated wallet debits.';
