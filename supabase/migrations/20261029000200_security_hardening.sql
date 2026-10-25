-- Security hardening (additive).
-- 1. users: no client INSERT. The web never writes `users` directly (sync-user does it with the service
--    role); the column grant on `role` let anyone insert a row with role = 'auditor' and then claim it.
-- 2. storage `invoices`: uploads only to {active foundation id}/{uuid}.{pdf|jpg|jpeg|png}.
-- 3. invoices insert: file paths must live under the foundation's own storage prefix.
-- Known limit: clients use the anon key (Privy, not Supabase Auth), so RLS cannot tell WHO the caller is.
-- Bucket read (signed URLs from the browser) and invoice insert stay open to anon; closing them needs
-- the upload / signed-URL / insert to move behind an Edge Function that verifies the Privy token.

-- 1 ---------------------------------------------------------------------------------------------
revoke insert on public.users from anon, authenticated;

-- 2 ---------------------------------------------------------------------------------------------
drop policy if exists "rastro invoices upload" on storage.objects;
create policy "rastro invoices upload" on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'invoices'
    and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(pdf|jpe?g|png)$'
    and exists (
      select 1 from public.foundations f
      where f.id::text = split_part(name, '/', 1) and f.status = 'active'
    )
  );

-- 3 ---------------------------------------------------------------------------------------------
drop policy if exists "invoices insert in_review" on public.invoices;
create policy "invoices insert in_review" on public.invoices for insert to anon, authenticated
  with check (
    status = 'in_review'
    and reviewer_id is null and reviewed_at is null
    and release_tx_hash is null and release_claimed_at is null
    and exists (select 1 from public.foundations f where f.id = foundation_id and f.status = 'active')
    and (file_path is null or file_path like foundation_id::text || '/%')
  );
