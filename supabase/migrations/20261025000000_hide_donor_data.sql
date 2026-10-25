-- Donor privacy: `users` and `donations` were readable by anyone holding the public anon key
-- (emails, wallets, who donated how much to whom). Identity comes from Privy, not Supabase Auth,
-- so RLS cannot scope rows per caller. Reads now go through the `my-donations` Edge Function
-- (service role, verified Privy token). Apply AFTER deploying that function and the new web build.

drop policy if exists "users read" on public.users;
drop policy if exists "donations read" on public.donations;

revoke select on public.users, public.donations from anon, authenticated;

-- Public, donor-free feed for the foundation profile page. Owned by the migration role, so it
-- intentionally bypasses the (now closed) table access and exposes only these columns.
create or replace view public.donation_feed
with (security_invoker = false) as
select id, foundation_id, total_amount, amount_released, status, release_tx_hash, created_at
from public.donations;

grant select on public.donation_feed to anon, authenticated;
