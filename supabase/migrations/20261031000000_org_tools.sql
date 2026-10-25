-- Organization tools: evidence window, document retries, appeals, controlled uploads and foundation claim.
--
-- 1. A reported spend stays open for 7 days (evidence_due_at). Past that without backing (still in_review) it becomes
--    "suspicious": the foundation counts as untrustworthy, so its reputation drops to 1 (level 1) through the same
--    triggers as any other incident. The deadline is evaluated live in is_untrustworthy and persisted by
--    flag_overdue_spends (every 15 minutes with pg_cron, and on demand by the owner endpoints).
-- 2. A failed verification no longer ends the spend right away: record_spend_attempt keeps it open so the foundation
--    can upload corrected documents. The Edge Function decides how many attempts are allowed.
-- 3. Appeals: a frozen or untrustworthy foundation can send an appeal. It is only stored (status 'received');
--    resolving it needs a future manual intervention by technical support.
-- 4. Uploads: nobody can write to the invoices bucket anymore. Files go through signed upload URLs issued by the
--    upload-url Edge Function and are tracked in foundation_uploads, so abandoned ones can be removed. Buckets get
--    size and type limits.
-- 5. Claim codes: a one-time code lets a signed-in user take ownership of a seeded foundation. It replaces linking by
--    e-mail, which would be unsafe because sync-user stores the e-mail the browser sends without verifying it.

-- 1. Evidence window ------------------------------------------------------------------------------------------
alter table public.invoices
  add column if not exists attempts smallint not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists evidence_due_at timestamptz default (now() + interval '7 days'),
  add column if not exists suspicious_at timestamptz;

-- Only spends reported from now on have a deadline. The open spends that already existed are demo fixtures that cannot
-- be verified (some exceed the available balance), so they are grandfathered without a deadline instead of demoting
-- real foundations a week from now.
update public.invoices set evidence_due_at = null where id is not null;

create or replace function public.is_untrustworthy(p_foundation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.foundations f where f.id = p_foundation_id and f.status = 'frozen')
      or exists (select 1 from public.invoices i where i.foundation_id = p_foundation_id and i.status = 'rejected')
      or exists (select 1 from public.invoices i
                  where i.foundation_id = p_foundation_id and i.status = 'verified'
                    and exists (select 1 from jsonb_array_elements(i.agent_checks) c where (c ->> 'passed')::boolean is false))
      or exists (select 1 from public.invoices i
                  where i.foundation_id = p_foundation_id and i.status = 'in_review'
                    and i.evidence_due_at is not null and i.evidence_due_at < now())
$$;

-- Marks every open spend past its deadline as suspicious and re-writes the reputation of the affected foundations,
-- which fires the cap in sync_payout_percentage. Idempotent. Returns how many spends were newly flagged.
create or replace function public.flag_overdue_spends()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  with due as (
    update public.invoices
       set suspicious_at = now()
     where status = 'in_review' and evidence_due_at < now() and suspicious_at is null
    returning id, number
  )
  insert into public.audit_events (actor_id, action, entity, entity_id, payload)
  select null, 'spend_overdue', 'invoice', id, jsonb_build_object('number', number, 'source', 'flag_overdue_spends')
    from due;
  get diagnostics v_n = row_count;

  update public.foundations f
     set reputation_score = reputation_score
   where f.id in (select foundation_id from public.invoices where status = 'in_review' and evidence_due_at < now());

  return v_n;
end $$;

revoke all on function public.flag_overdue_spends() from public, anon, authenticated;
grant execute on function public.flag_overdue_spends() to service_role;

-- Stats view: an overdue spend is an incident too (adds overdue_invoices_count at the end).
create or replace view public.foundation_stats
with (security_invoker = false) as
select
  f.id as foundation_id,
  x.sealed as sealed_invoices_count,
  x.flagged as flagged_invoices_count,
  x.rejected as rejected_invoices_count,
  x.donations as donations_count,
  coalesce((select sum(t.amount) from public.tranches t join public.donations d on d.id = t.donation_id
             where d.foundation_id = f.id and t.state = 'released'), 0) as released_total,
  coalesce((select sum(t.amount) from public.tranches t join public.donations d on d.id = t.donation_id
             where d.foundation_id = f.id and t.state in ('in_custody', 'in_review')), 0) as custody_total,
  coalesce((select sum(u.amount) from public.tranche_uses u
              join public.invoices i on i.id = u.invoice_id
              join public.tranches t on t.id = u.tranche_id
              join public.donations d on d.id = t.donation_id
             where d.foundation_id = f.id and i.status = 'verified'), 0) as spent_total,
  public.foundation_available_balance(f.id) as available_balance,
  (select count(distinct d.donor_id) from public.donations d join public.tranches t on t.donation_id = d.id
    where d.foundation_id = f.id and t.state in ('in_custody', 'in_review'))::int as affected_donors,
  case
    when f.status = 'frozen' then 'inconfiable'
    when not (f.total_received > 0 or x.donations > 0 or x.sealed + x.rejected + x.overdue > 0) then 'sin_historial'
    when x.rejected > 0 or x.flagged > 0 or x.overdue > 0 then 'inconfiable'
    when f.reputation_score >= 70 then 'confiable'
    else 'en_construccion'
  end as reputation_state,
  x.overdue as overdue_invoices_count
from public.foundations f
cross join lateral (
  select
    (select count(*) from public.invoices i where i.foundation_id = f.id and i.status = 'verified')::int as sealed,
    (select count(*) from public.invoices i
      where i.foundation_id = f.id and i.status = 'verified'
        and exists (select 1 from jsonb_array_elements(i.agent_checks) c where (c ->> 'passed')::boolean is false))::int as flagged,
    (select count(*) from public.invoices i where i.foundation_id = f.id and i.status = 'rejected')::int as rejected,
    (select count(*) from public.invoices i
      where i.foundation_id = f.id and i.status = 'in_review' and i.evidence_due_at is not null and i.evidence_due_at < now())::int as overdue,
    (select count(*) from public.donations d where d.foundation_id = f.id)::int as donations
) x;

-- Public invoice view: shows the deadline state (adds the columns at the end).
create or replace view public.invoices_public
with (security_invoker = false) as
select
  i.id,
  i.foundation_id,
  i.number,
  i.concept,
  i.amount,
  i.supplier_rif,
  (select b.name from public.businesses b where b.rif = i.supplier_rif) as supplier_name,
  i.status,
  (select coalesce(jsonb_agg(jsonb_build_object('id', e.c ->> 'id', 'label', e.c ->> 'label',
                                                'passed', (e.c ->> 'passed')::boolean) order by e.ord), '[]'::jsonb)
     from jsonb_array_elements(i.agent_checks) with ordinality as e (c, ord)) as agent_checks,
  i.review_note,
  i.file_hash,
  i.file_hashes,
  cardinality(i.file_paths) as document_count,
  i.release_tx_hash,
  i.allocated_amount,
  i.uploaded_at,
  i.reviewed_at,
  i.suspicious_at,
  i.evidence_due_at
from public.invoices i;

-- 2. Failed attempts keep the spend open -------------------------------------------------------------------------
create or replace function public.record_spend_attempt(
  p_invoice_id uuid,
  p_foundation_id uuid,
  p_checks jsonb,
  p_note text,
  p_origin_path text,
  p_destination_path text,
  p_actor_id uuid
)
returns smallint
language plpgsql
set search_path = ''
as $$
declare
  v_attempts smallint;
begin
  if jsonb_typeof(p_checks) <> 'array' then
    raise exception 'invalid_verdict';
  end if;
  update public.invoices
     set attempts = attempts + 1,
         last_attempt_at = now(),
         agent_checks = p_checks,
         review_note = p_note,
         spend_origin_path = p_origin_path,
         spend_destination_path = p_destination_path
   where id = p_invoice_id and foundation_id = p_foundation_id and status = 'in_review'
  returning attempts into v_attempts;
  if not found then
    raise exception 'invoice_not_pending';
  end if;
  insert into public.audit_events (actor_id, action, entity, entity_id, payload)
  values (p_actor_id, 'spend_attempt_failed', 'invoice', p_invoice_id,
          jsonb_build_object('attempt', v_attempts, 'checks', p_checks, 'source', 'verify-spend'));
  return v_attempts;
end;
$$;

revoke all on function public.record_spend_attempt(uuid, uuid, jsonb, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_spend_attempt(uuid, uuid, jsonb, text, text, text, uuid) to service_role;

-- 3. Appeals -----------------------------------------------------------------------------------------------------
create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references public.foundations (id) on delete cascade,
  user_id uuid not null references public.users (id),
  reason text not null check (char_length(reason) between 30 and 2000),
  evidence_paths text[] not null default '{}',
  -- Only 'received' is written today. Support will move appeals through the other states in the future.
  status text not null default 'received' check (status in ('received', 'in_review', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists appeals_foundation_idx on public.appeals (foundation_id, created_at desc);
alter table public.appeals enable row level security;
revoke all on public.appeals from anon, authenticated;

-- 4. Controlled uploads ------------------------------------------------------------------------------------------
create table if not exists public.foundation_uploads (
  path text primary key,
  bucket text not null,
  foundation_id uuid not null references public.foundations (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'spend_origin', 'spend_destination', 'appeal', 'logo')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists foundation_uploads_foundation_idx on public.foundation_uploads (foundation_id, claimed_at);
alter table public.foundation_uploads enable row level security;
revoke all on public.foundation_uploads from anon, authenticated;

-- Nobody writes to the invoices bucket directly anymore (the two policies below were permissive or never matched).
drop policy if exists "invoices upload" on storage.objects;
drop policy if exists "rastro invoices upload" on storage.objects;
drop policy if exists "invoices insert in_review" on public.invoices;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('appeals', 'appeals', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'] where id = 'invoices';
update storage.buckets set file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/svg+xml'] where id = 'foundation-logos';
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['application/pdf'] where id = 'legal-docs';

-- 5. Claim codes -------------------------------------------------------------------------------------------------
create table if not exists public.foundation_claims (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references public.foundations (id) on delete cascade,
  -- SHA-256 (hex) of the code without dashes, upper case. The code itself is never stored.
  code_hash text not null unique,
  label text,
  expires_at timestamptz not null default now() + interval '30 days',
  used_at timestamptz,
  used_by uuid references public.users (id),
  created_at timestamptz not null default now()
);
alter table public.foundation_claims enable row level security;
revoke all on public.foundation_claims from anon, authenticated;

-- 6. Scheduling ---------------------------------------------------------------------------------------------------
create extension if not exists pg_cron;
select cron.unschedule('flag-overdue-spends') where exists (select 1 from cron.job where jobname = 'flag-overdue-spends');
select cron.schedule('flag-overdue-spends', '*/15 * * * *', 'select public.flag_overdue_spends()');

-- 7. Owners ---------------------------------------------------------------------------------------------------------
-- Fe y Alegría Venezuela (level 5): the account of dibzz456@gmail.com, which already exists.
update public.foundations f
   set user_id = u.id
  from public.users u
 where lower(u.email) = 'dibzz456@gmail.com' and u.privy_id is not null
   and f.name = 'Fe y Alegría Venezuela';
update public.users set role = 'ong' where lower(email) = 'dibzz456@gmail.com' and privy_id is not null;

-- Refugio Patitas (level 2): claimed with a one-time code, because stephaniesalazarsaad@gmail.com has not signed in yet.
insert into public.foundation_claims (foundation_id, code_hash, label)
select f.id, 'd3f3c236fc46597ad98b22c9c319cdc1c52f14d5affda7bfad817ce803c6fb26', 'stephaniesalazarsaad@gmail.com'
  from public.foundations f where f.name = 'Refugio Patitas'
on conflict (code_hash) do nothing;
