-- GoRentHive location hardening — 2026-09-04

alter table public.users add column if not exists location_accuracy_m double precision;
alter table public.users add column if not exists location_captured_at bigint;

-- Active listings inherit coordinates from the owner's verified GPS location.
-- This prevents a client from publishing arbitrary fake coordinates.
create or replace function public.enforce_listing_verified_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.users%rowtype;
begin
  if new.status = 'active' then
    select * into u from public.users where id = new.owner_id;
    if u.id is null
       or u.location_status <> 'verified'
       or coalesce(u.location_verified_by, '') <> 'gps'
       or u.latitude is null
       or u.longitude is null
       or u.location_verified_at is null
       or u.location_accuracy_m is null
       or u.location_accuracy_m > 100
       or (extract(epoch from now()) * 1000)::bigint - u.location_verified_at > 86400000 then
      raise exception 'A recent verified GPS location (<=100m accuracy, within 24 hours) is required before publishing an active listing';
    end if;

    new.latitude := u.latitude;
    new.longitude := u.longitude;
    if coalesce(new.location_city, '') = '' then new.location_city := coalesce(u.city, ''); end if;
    if new.location_province is null or new.location_province = '' then new.location_province := u.province; end if;
    if new.location_barangay is null or new.location_barangay = '' then new.location_barangay := u.barangay; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_verified_location_trigger on public.listings;
create trigger listings_verified_location_trigger
before insert or update of status, latitude, longitude, owner_id
on public.listings
for each row execute function public.enforce_listing_verified_location();

-- Exact coordinates should be treated as private operational data. The app's
-- radius endpoint returns only coarse address labels + computed distance.
create index if not exists listings_lat_lng_idx on public.listings(latitude, longitude);
