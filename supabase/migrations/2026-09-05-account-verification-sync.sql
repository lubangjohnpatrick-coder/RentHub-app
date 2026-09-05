-- GoRentHive account verification/profile synchronization
-- Fixes older signups where phone/city metadata was not copied into public.users
-- and mirrors only explicit Supabase email-confirmation challenges.

-- Backfill signup metadata for existing accounts without overwriting user edits.
with auth_profile as (
  select
    a.id,
    nullif(trim(coalesce(a.phone, a.raw_user_meta_data ->> 'phone', '')), '') as phone,
    nullif(trim(coalesce(a.raw_user_meta_data ->> 'city', '')), '') as city
  from auth.users a
)
update public.users p
set
  phone = case
    when (p.phone is null or trim(p.phone) = '')
      and ap.phone is not null
      and not exists (
        select 1 from public.users other
        where other.id <> p.id and other.phone = ap.phone
      )
    then ap.phone
    else p.phone
  end,
  city = case
    when (p.city is null or trim(p.city) = '') and ap.city is not null then ap.city
    else p.city
  end,
  updated_at = (extract(epoch from now()) * 1000)::bigint
from auth_profile ap
where p.id = ap.id
  and (
    ((p.phone is null or trim(p.phone) = '') and ap.phone is not null)
    or ((p.city is null or trim(p.city) = '') and ap.city is not null)
  );

-- Backfill email verification only where Supabase shows that a confirmation
-- challenge was actually sent and later confirmed. This avoids treating projects
-- with "Confirm email" disabled as verified by default.
update public.users p
set email_verified = true,
    updated_at = (extract(epoch from now()) * 1000)::bigint
from auth.users a
where p.id = a.id
  and p.email_verified = false
  and a.confirmation_sent_at is not null
  and a.email_confirmed_at is not null;

-- Future signups must preserve phone/city metadata in the marketplace profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    email,
    phone,
    full_name,
    city,
    role,
    is_owner,
    email_verified,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.phone, new.raw_user_meta_data ->> 'phone', '')), ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'city', '')), ''),
    'user',
    coalesce((new.raw_user_meta_data ->> 'is_owner')::boolean, false),
    (new.confirmation_sent_at is not null and new.email_confirmed_at is not null),
    (extract(epoch from now()) * 1000)::bigint,
    (extract(epoch from now()) * 1000)::bigint
  );
  return new;
end;
$$;

-- Keep public.users.email_verified synchronized after a real Supabase email
-- confirmation completes. Never turn the flag back off here; GoRentHive's own
-- verified-email flow may also legitimately set it true.
create or replace function public.sync_auth_email_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.confirmation_sent_at is not null and new.email_confirmed_at is not null then
    update public.users
    set email_verified = true,
        updated_at = (extract(epoch from now()) * 1000)::bigint
    where id = new.id and email_verified = false;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_email_verification_sync on auth.users;
create trigger on_auth_email_verification_sync
  after update of email_confirmed_at, confirmation_sent_at on auth.users
  for each row execute procedure public.sync_auth_email_verification();
