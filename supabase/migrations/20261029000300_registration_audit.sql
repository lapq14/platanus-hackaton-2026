-- AI registration auditor (additive).
--
-- Foundation status stays: active | pending | frozen, plus `rejected`.
--   'active'   = ACCEPTED/validated (kept as the accepted state: RLS policies, SQL functions and tests key on it).
--   'pending'  = awaiting (or retrying) the AI validation of the RIF document.
--   'rejected' = the auditor rejected the registration (reason in foundations.rejection_reason); the organization
--                may resubmit (begin_registration_review moves it back to 'pending').
-- Every policy / function that filters on status = 'active' keeps excluding both 'pending' and 'rejected'.
--
-- The decision (pending -> active | rejected) is taken ONLY by the validate-registration Edge Function with the
-- service role, through resolve_registration_verdict (row-locked, idempotent, transitions only from 'pending').

-- 1. Status + reason ---------------------------------------------------------------------------------------
alter table public.foundations drop constraint if exists foundations_status_check;
alter table public.foundations
  add constraint foundations_status_check check (status in ('active', 'pending', 'frozen', 'rejected'));
alter table public.foundations add column if not exists rejection_reason text;

-- 2. Validated data kept for later verifications (verify-spend reads it) ---------------------------------
create table if not exists public.foundation_verifications (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null unique references public.foundations (id) on delete cascade,
  -- Canonical RIF (J-12345678-9) of the document that passed the validation; null until a verdict exists.
  rif_normalized text check (rif_normalized is null or rif_normalized ~ '^[JGVEPC]-\d{8}-\d$'),
  legal_name text,
  taxpayer_type text,
  fiscal_address text,
  -- Private storage path (bucket `rif-docs`): {foundation_id}/{uuid}.{pdf|jpg|jpeg|png}.
  document_path text,
  -- 'uncertain' = a document is stored but no definitive verdict was reached (model error / timeout): retryable.
  verdict text not null default 'uncertain' check (verdict in ('approved', 'rejected', 'uncertain')),
  -- Array of { id, label, passed, detail }.
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
  reason text,
  model text,
  verified_at timestamptz,
  -- Notification bookkeeping: a failed e-mail never reverts the decision and is retried on the next call.
  email_status text check (email_status is null or email_status in ('sent', 'failed', 'skipped')),
  email_error text,
  email_sent_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Defense in depth for "one RIF, one foundation".
create unique index if not exists foundation_verifications_rif_approved_key
  on public.foundation_verifications (rif_normalized) where verdict = 'approved';

-- Server-side only: RLS on and no policy, no grants for client roles.
alter table public.foundation_verifications enable row level security;
revoke all on public.foundation_verifications from anon, authenticated;

-- 3. begin_registration_review: pending|rejected -> pending (optional corrections) -------------------------
create or replace function public.begin_registration_review(
  p_foundation_id uuid,
  p_rif text default null,
  p_name text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.foundations where id = p_foundation_id for update;
  if not found then
    raise exception 'foundation_not_found';
  end if;
  if v_status = 'frozen' then
    raise exception 'foundation_suspended';
  end if;
  -- Accepted foundations are never reopened or edited here.
  if v_status = 'active' then
    return 'active';
  end if;

  update public.foundations
     set status = 'pending',
         rejection_reason = null,
         rif = coalesce(p_rif, rif),
         name = coalesce(p_name, name)
   where id = p_foundation_id;
  return 'pending';
end;
$$;

-- 4. resolve_registration_verdict: the single pending -> active | rejected transition -----------------------
create or replace function public.resolve_registration_verdict(
  p_foundation_id uuid,
  p_verdict text,            -- 'approved' | 'rejected'
  p_checks jsonb,
  p_reason text,
  p_rif text,                -- RIF the verdict was computed for (canonical when approved; null if the foundation had none)
  p_legal_name text,
  p_taxpayer_type text,
  p_fiscal_address text,
  p_document_path text,
  p_model text,
  p_name text                -- organization name the verdict was computed for
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_cur_rif text;
  v_cur_name text;
  v_verdict text := p_verdict;
  v_reason text := p_reason;
begin
  if p_verdict not in ('approved', 'rejected') or jsonb_typeof(coalesce(p_checks, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_verdict';
  end if;

  -- Row lock: concurrent calls serialize; the loser sees a non-pending status and changes nothing.
  select status, rif, name into v_status, v_cur_rif, v_cur_name from public.foundations where id = p_foundation_id for update;
  if not found then
    raise exception 'foundation_not_found';
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('status', v_status, 'changed', false);
  end if;

  -- The model call runs without a lock, so a concurrent begin_registration_review may have corrected the RIF or
  -- the name meanwhile. The verdict only applies to the data it was computed for: otherwise change nothing and
  -- leave the registration pending so it gets re-validated. Same normalization criterion as the Edge Function
  -- (RIF: case/punctuation-insensitive; name: trimmed, collapsed whitespace, case-insensitive).
  if regexp_replace(upper(coalesce(v_cur_rif, '')), '[^A-Z0-9]', '', 'g')
       is distinct from regexp_replace(upper(coalesce(p_rif, '')), '[^A-Z0-9]', '', 'g')
     or lower(btrim(regexp_replace(coalesce(v_cur_name, ''), '\s+', ' ', 'g')))
       is distinct from lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))) then
    return jsonb_build_object('status', 'pending', 'changed', false, 'reason', 'data_changed');
  end if;

  -- Duplicate guard at decision time (the declared RIF is unique, but the validated one must be too).
  if v_verdict = 'approved' and (
       exists (select 1 from public.foundation_verifications v
                where v.rif_normalized = p_rif and v.verdict = 'approved' and v.foundation_id <> p_foundation_id)
    or exists (select 1 from public.foundations f where f.rif = p_rif and f.id <> p_foundation_id)
  ) then
    v_verdict := 'rejected';
    v_reason := 'Este RIF ya está registrado por otra organización.';
  end if;

  insert into public.foundation_verifications as v (
    foundation_id, rif_normalized, legal_name, taxpayer_type, fiscal_address, document_path,
    verdict, checks, reason, model, verified_at, attempts
  ) values (
    p_foundation_id,
    case when v_verdict = 'approved' then p_rif end,
    p_legal_name, p_taxpayer_type, p_fiscal_address, p_document_path,
    v_verdict, coalesce(p_checks, '[]'::jsonb), v_reason, p_model, now(), 1
  )
  on conflict (foundation_id) do update set
    rif_normalized = excluded.rif_normalized,
    legal_name = excluded.legal_name,
    taxpayer_type = excluded.taxpayer_type,
    fiscal_address = excluded.fiscal_address,
    document_path = coalesce(excluded.document_path, v.document_path),
    verdict = excluded.verdict,
    checks = excluded.checks,
    reason = excluded.reason,
    model = excluded.model,
    verified_at = excluded.verified_at,
    attempts = v.attempts + 1,
    -- A new decision needs a new notification.
    email_status = null, email_error = null, email_sent_at = null,
    updated_at = now();

  update public.foundations
     set status = case when v_verdict = 'approved' then 'active' else 'rejected' end,
         -- Approved: foundations.rif becomes exactly the validated canonical RIF stored in foundation_verifications.
         rif = case when v_verdict = 'approved' then p_rif else rif end,
         rejection_reason = case when v_verdict = 'approved' then null else v_reason end
   where id = p_foundation_id;

  insert into public.audit_events (actor_id, action, entity, entity_id, payload)
  values (null, 'registration_' || v_verdict, 'foundation', p_foundation_id,
          jsonb_build_object('source', 'validate-registration', 'reason', v_reason, 'model', p_model));

  return jsonb_build_object(
    'status', case when v_verdict = 'approved' then 'active' else 'rejected' end,
    'changed', true,
    'reason', v_reason
  );
end;
$$;

revoke all on function public.begin_registration_review(uuid, text, text) from public, anon, authenticated;
revoke all on function public.resolve_registration_verdict(uuid, text, jsonb, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_registration_review(uuid, text, text) to service_role;
grant execute on function public.resolve_registration_verdict(uuid, text, jsonb, text, text, text, text, text, text, text, text) to service_role;

-- 5. Private bucket for the RIF document ---------------------------------------------------------------
-- Intake: the browser (anon key; users authenticate with Privy) can only INSERT at the bucket root as
-- {uuid}.{pdf|jpg|jpeg|png}. validate-registration (service role) verifies the file and MOVES it to
-- {foundation_id}/{uuid}.ext. There is no select/update/delete policy: clients can never read it back.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('rif-docs', 'rif-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "rastro rif intake upload" on storage.objects;
create policy "rastro rif intake upload" on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'rif-docs'
    and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpe?g|png)$'
  );
