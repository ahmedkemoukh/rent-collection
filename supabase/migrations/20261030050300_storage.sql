-- Bank transfer slips: private bucket, files under <org_id>/...
-- Only staff and managers of that organization can upload and read (via short-lived signed URLs).
-- No update or delete policy: orphaned files are removed by the server with the secret key,
-- and only when the path is in the caller's organization and no payment references it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- private.current_org_id() is null for tenants and anonymous users, so the comparison fails for them.
create policy payment_slips_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] = private.current_org_id()::text
  );

create policy payment_slips_select on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] = private.current_org_id()::text
  );
