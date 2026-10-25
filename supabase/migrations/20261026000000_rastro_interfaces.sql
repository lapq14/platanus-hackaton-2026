-- rastro interfaces: schema extension (additive; existing tables and data are preserved).
--
-- Identity note: users authenticate with Privy, not Supabase Auth, so `auth.uid()` does not exist
-- for end users. Donor-private data (donations, tranches, refunds) is therefore NOT readable with
-- the anon key; it is served by the `my-donations` Edge Function (service role). Foundation-owned
-- public data (invoices, catalog stats) is readable with the anon key.
--
-- KNOWN HACKATHON LIMITATIONS (to be hardened in the agent phase, mediating through Edge Functions):
--   * `invoices` is readable/insertable with the anon key (insert is restricted to status = 'in_review'
--     on active foundations). Updates are impossible from the client.
--   * Storage buckets `invoices` / `legal-docs` accept anonymous uploads; `invoices` also allows reads
--     so the UI can create 60 s signed URLs.
--   * `foundations` stays directly readable (the previous frontend relies on it). After deploying the
--     new web build, run:  revoke select on public.foundations from anon, authenticated;
--     drop policy "foundations read" on public.foundations;  and read through a view instead.

-- 1. foundations --------------------------------------------------------------------------------
alter table public.foundations
  add column if not exists rif text,
  add column if not exists country text default 'Venezuela',
  add column if not exists city text,
  add column if not exists official_email text,
  add column if not exists level integer not null default 1,
  add column if not exists instagram_url text,
  add column if not exists tiktok_url text,
  add column if not exists x_url text,
  add column if not exists contract_address text,
  add column if not exists legal_doc_path text,
  add column if not exists legal_doc_hash text;

alter table public.foundations
  add constraint foundations_level_range check (level between 1 and 4),
  add constraint foundations_rif_format check (rif is null or rif ~ '^[JGVEPC]-\d{8}-\d$');
create unique index if not exists foundations_rif_key on public.foundations (rif) where rif is not null;

-- Status: active | pending | frozen. Previous values are mapped (under_review -> pending, suspended -> frozen).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.foundations'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.foundations drop constraint %I', c.conname);
  end loop;
end $$;
update public.foundations set status = 'pending' where status = 'under_review';
update public.foundations set status = 'frozen' where status = 'suspended';
alter table public.foundations
  add constraint foundations_status_check check (status in ('active', 'pending', 'frozen'));
alter table public.foundations alter column status set default 'pending';
-- New foundations start at reputation 0 (Level I).
alter table public.foundations alter column reputation_score set default 0;

-- Release % at donation time per level (Level I = 10%): {1:10, 2:10, 3:15, 4:25}. Mirrors web/src/config/levels.ts.
create or replace function public.level_for_reputation(score integer)
returns integer language sql immutable set search_path = '' as $$
  select case when score >= 90 then 4 when score >= 70 then 3 when score >= 40 then 2 else 1 end
$$;

create or replace function public.payout_for_reputation(score integer)
returns integer language sql immutable as $$
  select case public.level_for_reputation(score) when 4 then 25 when 3 then 15 else 10 end
$$;

create or replace function public.sync_payout_percentage()
returns trigger language plpgsql as $$
begin
  new.level := public.level_for_reputation(new.reputation_score);
  new.payout_percentage := public.payout_for_reputation(new.reputation_score);
  return new;
end $$;

-- Re-fire the trigger so level / payout_percentage are consistent for existing rows.
update public.foundations set reputation_score = reputation_score;

-- 2. donations ----------------------------------------------------------------------------------
alter table public.donations add column if not exists initial_pct integer;

-- 3. invoices -----------------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references public.foundations (id) on delete cascade,
  number text not null,
  concept text not null check (char_length(concept) between 3 and 80),
  amount numeric(18, 2) not null check (amount > 0),
  supplier_rif text not null check (supplier_rif ~ '^[JGVEPC]-\d{8}-\d$'),
  tranche_index integer check (tranche_index between 1 and 4),
  file_path text,
  file_paths text[] not null default '{}',
  file_hash text,
  file_hashes text[] not null default '{}',
  status text not null default 'in_review' check (status in ('in_review', 'verified', 'rejected')),
  -- Array of { id, label, passed, detail } written by the audit agent (5 checks).
  agent_checks jsonb not null default '[]'::jsonb check (jsonb_typeof(agent_checks) = 'array'),
  review_note text,
  reviewer_id uuid references public.users (id),
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (foundation_id, number)
);
create index invoices_foundation_idx on public.invoices (foundation_id, uploaded_at desc);
create index invoices_status_idx on public.invoices (status);

-- 4. tranches -----------------------------------------------------------------------------------
create table public.tranches (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donations (id) on delete cascade,
  "index" integer not null check ("index" between 1 and 4),
  amount numeric(18, 2) not null check (amount >= 0),
  state text not null default 'in_custody' check (state in ('released', 'in_review', 'in_custody', 'broken')),
  invoice_id uuid references public.invoices (id) on delete set null,
  tx_hash text,
  released_at timestamptz,
  unique (donation_id, "index")
);
create index tranches_donation_idx on public.tranches (donation_id);

-- 5. refunds / audit_events ---------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null unique references public.donations (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete set null,
  amount numeric(18, 2) not null check (amount >= 0),
  tx_hash text,
  reason text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  tx_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events (entity, entity_id);

-- 6. RLS ----------------------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.tranches enable row level security;
alter table public.refunds enable row level security;
alter table public.audit_events enable row level security;

-- tranches / refunds / audit_events: no policies => closed to anon/authenticated (service role only).
revoke all on public.tranches, public.refunds, public.audit_events from anon, authenticated;

create policy "invoices read" on public.invoices for select to anon, authenticated using (true);
create policy "invoices insert in_review" on public.invoices for insert to anon, authenticated
  with check (
    status = 'in_review'
    and reviewer_id is null and reviewed_at is null
    and exists (select 1 from public.foundations f where f.id = foundation_id and f.status = 'active')
  );
revoke update, delete on public.invoices from anon, authenticated;

-- 7. Stats view (no donor identity): catalog counters + panel money summary -----------------------
create or replace view public.foundation_stats
with (security_invoker = false) as
select
  f.id as foundation_id,
  (select count(*) from public.invoices i where i.foundation_id = f.id and i.status = 'verified')::int
    as sealed_invoices_count,
  -- "Facturas con detalles": verified invoices whose agent_checks contain a check with passed = false
  -- (human review suggested).
  (select count(*) from public.invoices i
    where i.foundation_id = f.id and i.status = 'verified'
      and exists (select 1 from jsonb_array_elements(i.agent_checks) c where (c ->> 'passed')::boolean is false))::int
    as flagged_invoices_count,
  -- TODO: subtract withdrawals once they exist.
  coalesce((select sum(t.amount) from public.tranches t join public.donations d on d.id = t.donation_id
             where d.foundation_id = f.id and t.state = 'released'), 0) as released_total,
  coalesce((select sum(t.amount) from public.tranches t join public.donations d on d.id = t.donation_id
             where d.foundation_id = f.id and t.state in ('in_custody', 'in_review')), 0) as custody_total,
  coalesce((select sum(t.amount) from public.tranches t join public.donations d on d.id = t.donation_id
             where d.foundation_id = f.id and t.state in ('in_custody', 'in_review')
               and t."index" = (select min(t2."index") from public.tranches t2
                                 where t2.donation_id = t.donation_id and t2.state in ('in_custody', 'in_review'))), 0)
    as next_tranche_total,
  (select min(t."index") from public.tranches t join public.donations d on d.id = t.donation_id
    where d.foundation_id = f.id and t.state in ('in_custody', 'in_review')) as next_tranche_index,
  (select count(distinct d.donor_id) from public.donations d join public.tranches t on t.donation_id = d.id
    where d.foundation_id = f.id and t.state in ('in_custody', 'in_review'))::int as affected_donors
from public.foundations f;
grant select on public.foundation_stats to anon, authenticated;

-- 8. Donation function: now also creates the 4 tranches -------------------------------------------
-- Tranche 1 = initial release (level %), tranches 2-4 split the rest. All start in_custody;
-- record_initial_release flips tranche 1 to released once the chain tx is confirmed.
create or replace function public.donate_from_balance(
  p_user_id uuid,
  p_foundation_id uuid,
  p_amount numeric
)
returns public.donations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_pct integer;
  v_donation public.donations;
  v_initial numeric;
  v_each numeric;
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'invalid_amount';
  end if;

  select status, payout_percentage into v_status, v_pct from public.foundations where id = p_foundation_id;
  if not found then
    raise exception 'foundation_not_found';
  end if;
  if v_status <> 'active' then
    raise exception 'foundation_suspended';
  end if;

  update public.users
     set balance = balance - p_amount
   where id = p_user_id
     and balance >= p_amount;

  if not found then
    if not exists (select 1 from public.users where id = p_user_id) then
      raise exception 'user_not_found';
    end if;
    raise exception 'insufficient_funds';
  end if;

  insert into public.donations (donor_id, foundation_id, total_amount, currency, status, amount_released, initial_pct)
  values (p_user_id, p_foundation_id, p_amount, 'USD', 'in_escrow', 0, v_pct)
  returning * into v_donation;

  v_initial := round(p_amount * v_pct / 100, 2);
  v_each := round((p_amount - v_initial) / 3, 2);
  insert into public.tranches (donation_id, "index", amount, state) values
    (v_donation.id, 1, v_initial, 'in_custody'),
    (v_donation.id, 2, v_each, 'in_custody'),
    (v_donation.id, 3, v_each, 'in_custody'),
    (v_donation.id, 4, p_amount - v_initial - 2 * v_each, 'in_custody');

  return v_donation;
end;
$$;

create or replace function public.record_initial_release(
  p_donation_id uuid,
  p_tx_hash text,
  p_released_usd numeric
)
returns public.donations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_donation public.donations;
  v_foundation public.foundations;
begin
  update public.donations
     set amount_released = p_released_usd,
         status = 'partially_released'
   where id = p_donation_id
     and release_tx_hash = p_tx_hash
     and amount_released = 0
  returning * into v_donation;

  if found then
    update public.foundations
       set total_received = total_received + p_released_usd
     where id = v_donation.foundation_id
    returning * into v_foundation;

    update public.tranches
       set state = 'released', tx_hash = p_tx_hash, released_at = now()
     where donation_id = p_donation_id and "index" = 1;

    insert into public.verifications (
      donation_id, foundation_id, invoice_url, provider_rif, status,
      auditor_notes, release_tx_hash, reviewed_at
    ) values (
      p_donation_id,
      v_donation.foundation_id,
      '',
      'N/A',
      'approved',
      'Tramo inicial automatico (' || v_foundation.payout_percentage || '% por reputacion '
        || v_foundation.reputation_score || ').',
      p_tx_hash,
      now()
    );
    return v_donation;
  end if;

  select * into v_donation
    from public.donations
   where id = p_donation_id and release_tx_hash = p_tx_hash;
  if not found then
    raise exception 'release_hash_mismatch';
  end if;
  return v_donation;
end;
$$;

revoke all on function public.donate_from_balance(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.record_initial_release(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.donate_from_balance(uuid, uuid, numeric) to service_role;
grant execute on function public.record_initial_release(uuid, text, numeric) to service_role;

-- Backfill tranches for donations created before this migration.
insert into public.tranches (donation_id, "index", amount, state, tx_hash, released_at)
select d.id, g.i,
       case g.i
         when 1 then round(d.total_amount * f.payout_percentage / 100, 2)
         when 4 then d.total_amount - round(d.total_amount * f.payout_percentage / 100, 2)
                     - 2 * round((d.total_amount - round(d.total_amount * f.payout_percentage / 100, 2)) / 3, 2)
         else round((d.total_amount - round(d.total_amount * f.payout_percentage / 100, 2)) / 3, 2)
       end,
       case when g.i = 1 and d.amount_released > 0 then 'released' else 'in_custody' end,
       case when g.i = 1 and d.amount_released > 0 then d.release_tx_hash end,
       case when g.i = 1 and d.amount_released > 0 then d.created_at end
from public.donations d
join public.foundations f on f.id = d.foundation_id
cross join generate_series(1, 4) as g(i)
where not exists (select 1 from public.tranches t where t.donation_id = d.id);
update public.donations d set initial_pct = f.payout_percentage
  from public.foundations f where f.id = d.foundation_id and d.initial_pct is null;

-- 9. Storage buckets + policies ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('foundation-logos', 'foundation-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/svg+xml']),
  ('legal-docs', 'legal-docs', false, 10485760, array['application/pdf']),
  ('invoices', 'invoices', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "rastro logos upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'foundation-logos');
create policy "rastro legal docs upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'legal-docs');
create policy "rastro invoices upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'invoices');
-- Needed so the UI can create short-lived signed URLs (hackathon limitation, see header).
create policy "rastro invoices read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'invoices');

-- 10. Realtime: invoices (tranches are served by my-donations polling; no anon policy exists) ------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices') then
    alter publication supabase_realtime add table public.invoices;
  end if;
end $$;
