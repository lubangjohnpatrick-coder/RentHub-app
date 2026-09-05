-- GoRentHive homepage / plan alignment
-- Public promise: first five active listings are free. New Pro and Business
-- subscriptions remain Coming Soon and are intentionally not activated here.

insert into public.admin_settings (key, value, updated_at)
values ('free_listing_limit', '5', (extract(epoch from clock_timestamp()) * 1000)::bigint)
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;

insert into public.admin_settings (key, value, updated_at)
values ('extra_listing_fee', '10', (extract(epoch from clock_timestamp()) * 1000)::bigint)
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
