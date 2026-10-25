-- Spend verification: businesses registry + AI/deterministic verdict storage (additive).
--
-- A foundation proves what it spent money on with two documents (origin account proof and a document
-- with the destination business RIF + account). The `verify-spend` Edge Function (service role) checks
-- them against `businesses` / `business_accounts` and records the verdict through `apply_spend_verdict`.

-- 1. businesses ---------------------------------------------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  rif text not null unique check (rif ~ '^[JGVEPC]-\d{8}-\d$'),
  created_at timestamptz not null default now()
);

-- One business can own several bank accounts. Account numbers are stored digits-only (20 digits for VE).
create table if not exists public.business_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  account_number text not null unique check (account_number ~ '^\d{10,34}$'),
  bank_name text,
  created_at timestamptz not null default now()
);
create index if not exists business_accounts_business_idx on public.business_accounts (business_id);

-- Closed to anon/authenticated: only the service role (Edge Functions) reads them.
alter table public.businesses enable row level security;
alter table public.business_accounts enable row level security;
revoke all on public.businesses, public.business_accounts from anon, authenticated;

-- 2. invoices: storage paths of the two spend documents --------------------------------------------
alter table public.invoices
  add column if not exists spend_origin_path text,
  add column if not exists spend_destination_path text;

-- 3. Verdict writer: service_role only ----------------------------------------------------------
-- Atomic guard: only an invoice that is still `in_review` can be decided, so concurrent or repeated
-- calls cannot overwrite a verdict. Also appends the audit event.
create or replace function public.apply_spend_verdict(
  p_invoice_id uuid,
  p_status text,
  p_checks jsonb,
  p_note text,
  p_origin_path text,
  p_destination_path text,
  p_actor_id uuid
)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  if p_status not in ('verified', 'rejected') or jsonb_typeof(p_checks) <> 'array' then
    raise exception 'invalid_verdict';
  end if;

  update public.invoices
     set status = p_status,
         agent_checks = p_checks,
         review_note = p_note,
         spend_origin_path = p_origin_path,
         spend_destination_path = p_destination_path,
         reviewed_at = now()
   where id = p_invoice_id
     and status = 'in_review'
  returning * into v_invoice;

  if not found then
    if not exists (select 1 from public.invoices where id = p_invoice_id) then
      raise exception 'invoice_not_found';
    end if;
    raise exception 'invoice_not_pending';
  end if;

  insert into public.audit_events (actor_id, action, entity, entity_id, payload)
  values (
    p_actor_id,
    case p_status when 'verified' then 'invoice_verified' else 'invoice_rejected' end,
    'invoice',
    p_invoice_id,
    jsonb_build_object('number', v_invoice.number, 'amount', v_invoice.amount, 'source', 'verify-spend', 'checks', p_checks)
  );

  return v_invoice;
end;
$$;

revoke all on function public.apply_spend_verdict(uuid, text, jsonb, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_spend_verdict(uuid, text, jsonb, text, text, text, uuid) to service_role;

-- 4. Demo seed (fictional businesses; accounts are 20 digits) -------------------------------------
with b as (
  insert into public.businesses (name, rif) values
    ('Farmacia San Rafael, C.A.', 'J-30123456-7'),
    ('Distribuidora Alimentos del Centro, C.A.', 'J-29876543-2'),
    ('Suministros Médicos Orinoco, C.A.', 'J-40567890-1'),
    ('Papelería y Útiles La Estrella, C.A.', 'J-31234567-0')
  on conflict (rif) do nothing
  returning id, rif
)
insert into public.business_accounts (business_id, account_number, bank_name)
select b.id, v.account_number, v.bank_name
from b
join (values
  ('J-30123456-7', '01020123456789012345', 'Banco de Venezuela'),
  ('J-30123456-7', '01340123456789012346', 'Banesco'),
  ('J-29876543-2', '01050987654321098765', 'Mercantil'),
  ('J-40567890-1', '01160567890123456789', 'BBVA Provincial'),
  ('J-31234567-0', '01080312345678901234', 'Banco Provincial')
) as v (rif, account_number, bank_name) on v.rif = b.rif
on conflict (account_number) do nothing;
