-- Make notification dedupe nullable so ordinary notifications may repeat while
-- saved-search alerts can use a real unique conflict target.
drop index if exists public.notifications_user_dedupe_idx;
alter table public.notifications alter column dedupe_key drop not null;
alter table public.notifications alter column dedupe_key drop default;
update public.notifications set dedupe_key = null where dedupe_key = '';
create unique index if not exists notifications_user_dedupe_idx on public.notifications(user_id,dedupe_key);
