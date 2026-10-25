-- One organization per account: the panel and the Edge Functions look up "the foundation of this user"
-- (maybeSingle), and two rows break them. Foundations without an owner (seeded / claimable) stay allowed.
create unique index if not exists foundations_one_per_user
  on public.foundations (user_id) where user_id is not null;
