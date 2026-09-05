-- GoRentHive production financial integrity hardening
-- Apply after the earlier 2026-09-04/05 migrations.

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

-- Serialize wallet mutations for a user. The previous implementation read the
-- balance without a row lock, so concurrent entries could record an incorrect
-- balance_after even though the arithmetic update itself was atomic.
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

    if not found then
      raise exception 'wallet user not found';
    end if;
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

-- Claim a pending PayMongo payment and credit its wallet exactly once in the
-- SAME database transaction. Webhook and browser confirmation can race safely:
-- one caller transitions pending -> succeeded and credits; all others return
-- "already" without creating another ledger entry.
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
