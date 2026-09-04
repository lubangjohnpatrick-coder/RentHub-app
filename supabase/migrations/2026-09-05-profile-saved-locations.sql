-- GoRentHive profile and saved-location support
-- Saved locations are server-managed. A typed address never makes coordinates verified.

create table if not exists public.saved_locations (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  label text not null default 'Saved location',
  address text not null default '',
  barangay text not null default '',
  city text not null default '',
  province text not null default '',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m > 0 and accuracy_m <= 100),
  verified_by text not null default 'gps' check (verified_by = 'gps'),
  verified_at bigint not null,
  captured_at bigint not null,
  is_default boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists saved_locations_user_idx on public.saved_locations(user_id, updated_at desc);

alter table public.saved_locations enable row level security;

-- Browser clients do not write saved locations directly. The authenticated server
-- validates fresh device GPS and writes with the service role.

do $$ begin
  insert into storage.buckets (id, name, public)
  values ('profile-photos', 'profile-photos', true)
  on conflict (id) do update set public = true;
exception when undefined_table then null;
end $$;
