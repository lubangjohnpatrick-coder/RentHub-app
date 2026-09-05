-- GoRentHive production financial integrity hardening
-- Apply after the earlier 2026-09-04/05 migrations.
-- This migration is intentionally self-contained so its RPC definitions do not
-- depend on a later migration being applied first.

-- Schema compatibility required by the hardened payment server.
alter table public.payments
  add column if not exists provider_ref text;

alter table public.security_deposits
  add column if not exists created_at bigint not null default ((extract(epoch from now())*1000)::bigint);

alter table public.payments drop constraint if exists payments_type_check;
alter table public.payments add constraint payments_type_check check (
  type in ('rental','deposit','refund','payout','platform_fee','featured','referral','withdrawal','topup','booking_pay')
);

create index if not exists payments_provider_ref_idx on public.payments(provider_ref);

-- Current commercial policy: exactly 8% owner commission, no minimum fee,
-- and no GoRentHive-operated delivery service.
insert into public.admin_settings (key, value, updated_at)
values
  ('platform_percent', '8', (extract(epoch from now())*1000)::bigint),
  ('platform_min_fee', '0', (extract(epoch from now())*1000)::bigint),
  ('lalamove_enabled', '0', (extract(epoch from now())*1000)::bigint)
on conflict (key) do update
set value = excluded.value, updated_at = excluded.updated_at;

update public.listings
set delivery_available = false,
    delivery_fee = 0,
    updated_at = (extract(epoch from now())*1000)::bigint
where delivery_available is true or coalesce(delivery_fee, 0) <> 0;

-- Serialize wallet mutations for a user so ledger balance_after values remain
-- correct under concurrent requests.
create or replace function public.ledger_entry(
  p_booking_id bigint,
  p_user_id uuid,
  p_type text,
  p_amount integer,
  p_meta text default '{}'
)
returns table (entry_id bigint, new_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  before_balance integer := 0;
  v_entry_id bigint;
  v_new_balance integer;
begin
  if p_user_id is not null then
    select coalesce(wallet_balance, 0)
      into before_balance
      from public.users
      where id = p_user_id
      for update;

    if not found then raise exception 'wallet user not found'; end if;
  end if;

  v_new_balance := before_balance + p_amount;
  insert into public.ledger_entries
    (booking_id, user_id, type, amount, balance_after, meta, created_at)
  values
    (p_booking_id, p_user_id, p_type, p_amount, v_new_balance, p_meta,
     (extract(epoch from now())*1000)::bigint)
  returning id into v_entry_id;

  if p_user_id is not null then
    update public.users
      set wallet_balance = v_new_balance,
          updated_at = (extract(epoch from now())*1000)::bigint
      where id = p_user_id;
  end if;

  return query select v_entry_id, v_new_balance;
end;
$$;

revoke all on function public.ledger_entry(bigint, uuid, text, integer, text) from public;
revoke all on function public.ledger_entry(bigint, uuid, text, integer, text) from anon, authenticated;
grant execute on function public.ledger_entry(bigint, uuid, text, integer, text) to service_role;

-- Reserve both rental and deposit funds atomically after a booking row has been
-- created. The wallet is locked and rechecked inside Postgres, preventing two
-- concurrent booking requests from both spending the same available balance.
create or replace function public.reserve_booking_funds(
  p_booking_id bigint,
  p_renter_id uuid,
  p_owner_id uuid,
  p_rental_amount integer,
  p_deposit_amount integer,
  p_booking_ref text
)
returns table (reservation_status text, new_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  before_balance integer;
  working_balance integer;
  total_required integer;
  ts bigint := (extract(epoch from now())*1000)::bigint;
begin
  if p_rental_amount < 0 or p_deposit_amount < 0 then
    raise exception 'invalid booking reservation amount';
  end if;

  select coalesce(wallet_balance, 0)
    into before_balance
    from public.users
    where id = p_renter_id
    for update;
  if not found then
    return query select 'user_not_found'::text, 0::integer;
    return;
  end if;

  total_required := p_rental_amount + p_deposit_amount;
  if before_balance < total_required then
    return query select 'insufficient_funds'::text, before_balance;
    return;
  end if;

  working_balance := before_balance;
  if p_rental_amount > 0 then
    working_balance := working_balance - p_rental_amount;
    insert into public.ledger_entries
      (booking_id, user_id, type, amount, balance_after, meta, created_at)
    values
      (p_booking_id, p_renter_id, 'rental_escrow', -p_rental_amount, working_balance,
       jsonb_build_object('booking_ref', p_booking_ref)::text, ts);
  end if;

  if p_deposit_amount > 0 then
    working_balance := working_balance - p_deposit_amount;
    insert into public.ledger_entries
      (booking_id, user_id, type, amount, balance_after, meta, created_at)
    values
      (p_booking_id, p_renter_id, 'deposit_escrow', -p_deposit_amount, working_balance,
       jsonb_build_object('booking_ref', p_booking_ref)::text, ts);

    insert into public.security_deposits
      (booking_id, renter_id, owner_id, amount, status, created_at)
    values
      (p_booking_id, p_renter_id, p_owner_id, p_deposit_amount, 'held', ts);
  end if;

  update public.users
    set wallet_balance = working_balance, updated_at = ts
    where id = p_renter_id;

  return query select 'reserved'::text, working_balance;
end;
$$;

revoke all on function public.reserve_booking_funds(bigint, uuid, uuid, integer, integer, text) from public;
revoke all on function public.reserve_booking_funds(bigint, uuid, uuid, integer, integer, text) from anon, authenticated;
grant execute on function public.reserve_booking_funds(bigint, uuid, uuid, integer, integer, text) to service_role;

-- Claim a pending PayMongo payment and credit its wallet exactly once in the
-- SAME database transaction. Webhook and browser confirmation can race safely.
create or replace function public.settle_payment_credit(
  p_payment_id bigint,
  p_provider_ref text default null
)
returns table (settlement_status text, new_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments%rowtype;
  before_balance integer;
  after_balance integer;
  meta_json jsonb;
begin
  select * into p
    from public.payments
    where id = p_payment_id
    for update;

  if not found then
    return query select 'not_found'::text, 0::integer;
    return;
  end if;

  select coalesce(wallet_balance, 0)
    into before_balance
    from public.users
    where id = p.user_id
    for update;

  if p.status = 'succeeded' then
    return query select 'already'::text, before_balance;
    return;
  end if;

  if p.status <> 'pending' then
    return query select 'ignored'::text, before_balance;
    return;
  end if;

  begin
    meta_json := coalesce(nullif(p.meta, ''), '{}')::jsonb;
  exception when others then
    meta_json := '{}'::jsonb;
  end;
  meta_json := meta_json || jsonb_build_object('provider_ref', coalesce(p_provider_ref, ''));
  after_balance := before_balance + p.gross_amount;

  update public.payments
    set status = 'succeeded',
        provider_ref = coalesce(p_provider_ref, provider_ref),
        meta = meta_json::text,
        updated_at = (extract(epoch from now())*1000)::bigint
    where id = p.id;

  insert into public.ledger_entries
    (booking_id, user_id, type, amount, balance_after, meta, created_at)
  values
    (p.booking_id, p.user_id, 'topup', p.gross_amount, after_balance,
     jsonb_build_object('payment_ref', p.payment_ref, 'paymongo', true)::text,
     (extract(epoch from now())*1000)::bigint);

  update public.users
    set wallet_balance = after_balance,
        updated_at = (extract(epoch from now())*1000)::bigint
    where id = p.user_id;

  return query select 'succeeded'::text, after_balance;
end;
$$;

revoke all on function public.settle_payment_credit(bigint, text) from public;
revoke all on function public.settle_payment_credit(bigint, text) from anon, authenticated;
grant execute on function public.settle_payment_credit(bigint, text) to service_role;
