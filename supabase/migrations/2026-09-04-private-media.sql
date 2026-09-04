-- GoRentHive private media hardening
-- Listing photos remain public; identity documents and rental evidence are private.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('identity-docs', 'identity-docs', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif']),
  ('rental-evidence', 'rental-evidence', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- All writes/reads for these buckets are intentionally performed by the
-- server-side service-role client after application authorization. Do not add
-- broad anon/authenticated storage.objects SELECT policies for these buckets.
