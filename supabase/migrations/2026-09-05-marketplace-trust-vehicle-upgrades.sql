-- GoRentHive marketplace trust + regulated vehicle rental foundation
-- Apply in Supabase before deploying the associated server/frontend code.
-- public.users.id is UUID; listing / booking identifiers are bigint.

create table if not exists public.vehicle_compliance (
  listing_id bigint primary key references public.listings(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  make text not null default '',
  model text not null default '',
  model_year integer,
  plate_number text not null default '',
  vin_last6 text not null default '',
  or_cr_reference text not null default '',
  or_cr_expiry bigint not null default 0,
  ltfrb_authority_reference text not null default '',
  ltfrb_expiry bigint not null default 0,
  insurance_reference text not null default '',
  insurance_expiry bigint not null default 0,
  ctpl_reference text not null default '',
  ctpl_expiry bigint not null default 0,
  rental_use_covered boolean not null default false,
  or_cr_verified boolean not null default false,
  ltfrb_verified boolean not null default false,
  insurance_verified boolean not null default false,
  ctpl_verified boolean not null default false,
  status text not null default 'pending' check (status in ('pending','verified','rejected','expired')),
  reviewer_id uuid references public.users(id) on delete set null,
  reviewed_at bigint,
  review_notes text not null default '',
  created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint)
);

create index if not exists idx_vehicle_compliance_owner on public.vehicle_compliance(owner_id);
create index if not exists idx_vehicle_compliance_status on public.vehicle_compliance(status);

create table if not exists public.driver_verifications (
  user_id uuid primary key references public.users(id) on delete cascade,
  license_last4 text not null default '',
  license_class text not null default '',
  license_expiry bigint not null default 0,
  status text not null default 'pending' check (status in ('pending','verified','rejected','expired')),
  reviewer_id uuid references public.users(id) on delete set null,
  reviewed_at bigint,
  review_notes text not null default '',
  created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint)
);

create index if not exists idx_driver_verifications_status on public.driver_verifications(status);

create table if not exists public.booking_handover_codes (
  booking_id bigint primary key references public.bookings(id) on delete cascade,
  code_hash text not null,
  generated_by uuid not null references public.users(id) on delete cascade,
  expires_at bigint not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  used_at bigint,
  created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint)
);

-- These records are intentionally server-controlled because they contain
-- private regulatory and security material. The service-role API is the only
-- direct data path; clients use scoped REST endpoints instead.
alter table public.vehicle_compliance enable row level security;
alter table public.driver_verifications enable row level security;
alter table public.booking_handover_codes enable row level security;

revoke all on public.vehicle_compliance from anon, authenticated;
revoke all on public.driver_verifications from anon, authenticated;
revoke all on public.booking_handover_codes from anon, authenticated;
