-- Align older/newer GoRentHive databases with the hardened payment server.

alter table public.payments
  add column if not exists provider_ref text;

alter table public.security_deposits
  add column if not exists created_at bigint not null default ((extract(epoch from now())*1000)::bigint);

-- Ensure booking-funded PayMongo credits are a valid payment type even on a
-- database created from the older base schema.
alter table public.payments drop constraint if exists payments_type_check;
alter table public.payments add constraint payments_type_check check (
  type in ('rental','deposit','refund','payout','platform_fee','featured','referral','withdrawal','topup','booking_pay')
);

create index if not exists payments_provider_ref_idx on public.payments(provider_ref);
