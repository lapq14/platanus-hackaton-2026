-- Tranche queue: five reputation levels, FIFO spend attribution, 50% unlock rule, public transparency.
--
-- Money model
--   * A donation is split into tranches (4, or 3 at level 5). Tranche 1 = the level's initial % and is sent to
--     the foundation right away; the rest stays in custody (held by the platform).
--   * A tranche that was sent is "released" and has a spendable `remaining` balance. When a spend (invoice) is
--     verified, it consumes `remaining` from released tranches in a FIFO queue: oldest donation first, then the
--     lowest tranche index. The leftover stays in the same row, so a partially used tranche is simply consumed
--     again by the next spend. Every consumed piece is recorded in `tranche_uses` (the donor's trace).
--   * When a tranche reaches 50% consumed, the NEXT tranche of the same donation is unlocked (one at a time,
--     never chained inside the same spend). Unlocked tranches go `in_custody -> in_review` (transfer pending)
--     and `-> released` once the on-chain transfer is confirmed (record_spend_release).
--   * A foundation can only report spends up to its available (released and unspent) balance, minus what
--     other submitted invoices already reserve.
--
-- Privacy
--   * users, donations, verifications and invoices are no longer readable with the anon key. Public data is
--     served by column-limited grants (foundations), the `invoices_public` view and Edge Functions.

-- 1. Five levels ----------------------------------------------------------------------------------------
alter table public.foundations drop constraint if exists foundations_level_range;
alter table public.foundations add constraint foundations_level_range check (level between 1 and 5);

-- Level by reputation: 1 (0-29), 2 (30-49), 3 (50-69), 4 (70-89), 5 (90-100).
create or replace function public.level_for_reputation(score integer)
returns integer language sql immutable set search_path = '' as $$
  select case when score >= 90 then 5 when score >= 70 then 4 when score >= 50 then 3 when score >= 30 then 2 else 1 end
$$;

-- Initial release %: level 1 = 25, 2 = 30, 3 = 40, 4 = 45, 5 = 50.
create or replace function public.payout_for_reputation(score integer)
returns integer language sql immutable set search_path = '' as $$
  select case public.level_for_reputation(score) when 5 then 50 when 4 then 45 when 3 then 40 when 2 then 30 else 25 end
$$;

-- Total tranches per donation: 4 for levels 1-4, 3 for level 5.
create or replace function public.tranche_count_for_level(lvl integer)
returns integer language sql immutable set search_path = '' as $$
  select case when lvl >= 5 then 3 else 4 end
$$;

-- The trigger sync_payout_percentage recomputes level + payout whenever reputation_score is written.
update public.foundations set reputation_score = reputation_score where id is not null;

-- 2. Schema ------------------------------------------------------------------------------------------------
alter table public.donations
  add column if not exists tranche_count smallint not null default 4
  check (tranche_count between 3 and 4);

alter table public.tranches
  add column if not exists remaining numeric(18, 2) not null default 0;
alter table public.tranches
  add constraint tranches_remaining_range check (remaining >= 0 and remaining <= amount),
  add constraint tranches_remaining_only_released check (state = 'released' or remaining = 0);

alter table public.invoices
  add column if not exists submitted_at timestamptz,
  add column if not exists allocated_amount numeric(18, 2) not null default 0;

create table public.tranche_uses (
  id uuid primary key default gen_random_uuid(),
  tranche_id uuid not null references public.tranches (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount numeric(18, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (tranche_id, invoice_id)
);
create index tranche_uses_invoice_idx on public.tranche_uses (invoice_id);
alter table public.tranche_uses enable row level security;
revoke all on public.tranche_uses from anon, authenticated;

-- 3. Spendable balance ---------------------------------------------------------------------------------------
create or replace function public.foundation_available_balance(p_foundation_id uuid)
returns numeric language sql stable security definer set search_path = '' as $
  select coalesce(sum(t.remaining), 0)
    from public.tranches t
    join public.donations d on d.id = t.donation_id
   where d.foundation_id = p_foundation_id
     and d.status <> 'refunded'
     and t.state = 'released'
$$;

-- 4. Donation: tranche count and sizes depend on the level ---------------------------------------------------
create or replace function public.donate_from_balance(
  p_user_id uuid,
  p_foundation_id uuid,
  p_amount numeric
)
returns public.donations
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_pct integer;
  v_level integer;
  v_n integer;
  v_donation public.donations;
  v_initial numeric;
  v_each numeric;
  i integer;
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'invalid_amount';
  end if;

  select status, payout_percentage, level into v_status, v_pct, v_level
    from public.foundations where id = p_foundation_id for share;
  if not found then
    raise exception 'foundation_not_found';
  end if;
  if v_status <> 'active' then
    raise exception 'foundation_suspended';
  end if;
  v_n := public.tranche_count_for_level(v_level);

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

  insert into public.donations (donor_id, foundation_id, total_amount, currency, status, amount_released, initial_pct, tranche_count)
  values (p_user_id, p_foundation_id, p_amount, 'USD', 'in_escrow', 0, v_pct, v_n)
  returning * into v_donation;

  -- Tranche 1 = initial %. The other (n - 1) tranches split the rest evenly; the last absorbs the rounding.
  v_initial := round(p_amount * v_pct / 100, 2);
  v_each := round((p_amount - v_initial) / (v_n - 1), 2);
  for i in 1..v_n loop
    insert into public.tranches (donation_id, "index", amount, state)
    values (
      v_donation.id, i,
      case when i = 1 then v_initial
           when i = v_n then p_amount - v_initial - (v_n - 2) * v_each
           else v_each end,
      'in_custody'
    );
  end loop;

  return v_donation;
end;
$$;

-- Initial release: tranche 1 becomes spendable (remaining = amount) once the transfer is confirmed.
create or replace function public.record_initial_release(
  p_donation_id uuid,
  p_tx_hash text,
  p_released_usd numeric
)
returns public.donations
language plpgsql
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
     and status = 'in_escrow'
  returning * into v_donation;

  if found then
    update public.foundations
       set total_received = total_received + p_released_usd
     where id = v_donation.foundation_id
    returning * into v_foundation;

    update public.tranches
       set state = 'released', tx_hash = p_tx_hash, released_at = now(), remaining = amount
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
      'Tramo inicial automatico (' || coalesce(v_donation.initial_pct, v_foundation.payout_percentage)
        || '% por nivel ' || v_foundation.level || ').',
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
  if v_donation.status = 'refunded' then
    raise exception 'donation_refunded';
  end if;
  return v_donation;
end;
$$;

-- 5. Spend submission: validates the balance, no longer targets tranches ---------------------------------------
-- The return type changes (integer -> jsonb), so the old function must be dropped first.
drop function if exists public.submit_spend_for_review(uuid, uuid);
create function public.submit_spend_for_review(p_invoice_id uuid, p_foundation_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_fstatus text;
  v_available numeric;
  v_reserved numeric;
begin
  select * into v_inv from public.invoices where id = p_invoice_id and foundation_id = p_foundation_id for update;
  if not found then
    raise exception 'invoice_not_found';
  end if;
  if v_inv.status <> 'in_review' then
    raise exception 'invoice_not_pending';
  end if;

  -- Locking the foundation serializes balance checks and queue consumption.
  select status into v_fstatus from public.foundations where id = p_foundation_id for update;
  if v_fstatus is distinct from 'active' then
    raise exception 'foundation_suspended';
  end if;

  v_available := public.foundation_available_balance(p_foundation_id);
  select coalesce(sum(amount), 0) into v_reserved
    from public.invoices
   where foundation_id = p_foundation_id and status = 'in_review'
     and submitted_at is not null and id <> p_invoice_id;
  if v_inv.amount > v_available - v_reserved then
    raise exception 'insufficient_balance';
  end if;

  update public.invoices set submitted_at = coalesce(submitted_at, now()) where id = p_invoice_id;
  return jsonb_build_object('available', v_available, 'reserved', v_reserved);
end;
$$;

-- 6. FIFO attribution + 50% unlock ----------------------------------------------------------------------------
create or replace function public.allocate_spend(p_invoice_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_need numeric;
  v_take numeric;
  v_t record;
  v_touched uuid[] := '{}';
  v_uses integer := 0;
  v_unlocked integer := 0;
  v_unlock_total numeric := 0;
  v_amount numeric;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice_not_found';
  end if;
  perform 1 from public.foundations where id = v_inv.foundation_id for update;

  if exists (select 1 from public.tranche_uses where invoice_id = p_invoice_id) then
    raise exception 'already_allocated';
  end if;

  v_need := v_inv.amount;
  if public.foundation_available_balance(v_inv.foundation_id) < v_need then
    raise exception 'insufficient_balance';
  end if;

  -- Queue: oldest donation first, lowest tranche first. Only released (spendable) tranches take part.
  for v_t in
    select t.id, t.remaining
      from public.tranches t
      join public.donations d on d.id = t.donation_id
     where d.foundation_id = v_inv.foundation_id
       and d.status <> 'refunded'
       and t.state = 'released'
       and t.remaining > 0
     order by d.created_at, d.id, t."index"
       for update of t
  loop
    exit when v_need <= 0;
    v_take := least(v_t.remaining, v_need);
    update public.tranches set remaining = remaining - v_take where id = v_t.id;
    insert into public.tranche_uses (tranche_id, invoice_id, amount) values (v_t.id, p_invoice_id, v_take);
    v_need := v_need - v_take;
    v_touched := v_touched || v_t.id;
    v_uses := v_uses + 1;
  end loop;

  -- Unlock: a touched tranche that is now at least 50% consumed unlocks the next locked tranche of ITS donation.
  -- Only tranches that were already released take part, so unlocking never chains inside one spend.
  for v_t in
    select t.donation_id, t."index"
      from public.tranches t
     where t.id = any (v_touched)
       and t.amount > 0
       and (t.amount - t.remaining) * 2 >= t.amount
  loop
    update public.tranches n
       set state = 'in_review', invoice_id = p_invoice_id
     where n.donation_id = v_t.donation_id
       and n."index" = v_t."index" + 1
       and n.state = 'in_custody'
    returning n.amount into v_amount;
    if found then
      v_unlocked := v_unlocked + 1;
      v_unlock_total := v_unlock_total + v_amount;
    end if;
  end loop;

  update public.invoices set allocated_amount = v_inv.amount where id = p_invoice_id;

  insert into public.audit_events (actor_id, action, entity, entity_id, payload)
  values (null, 'spend_allocated', 'invoice', p_invoice_id,
          jsonb_build_object('amount', v_inv.amount, 'uses', v_uses, 'unlocked_tranches', v_unlocked,
                             'unlocked_usd', v_unlock_total, 'source', 'verify-spend'));

  return jsonb_build_object('allocated', v_inv.amount, 'uses', v_uses,
                            'unlocked_tranches', v_unlocked, 'unlocked_usd', v_unlock_total);
end;
$$;

-- Verdict: a verified spend is attributed to donors in the same transaction; a rejected one freezes and refunds.
create or replace function public.resolve_spend_verdict(
  p_invoice_id uuid,
  p_foundation_id uuid,
  p_status text,
  p_checks jsonb,
  p_note text,
  p_origin_path text,
  p_destination_path text,
  p_actor_id uuid
)
returns public.invoices
language plpgsql
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
     and foundation_id = p_foundation_id
     and status = 'in_review'
  returning * into v_invoice;

  if not found then
    if not exists (select 1 from public.invoices where id = p_invoice_id and foundation_id = p_foundation_id) then
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

  if p_status = 'verified' then
    perform public.allocate_spend(p_invoice_id);
    update public.foundations
       set reputation_score = least(100, reputation_score + 4)
     where id = p_foundation_id;
  else
    perform public.freeze_foundation_and_refund(p_foundation_id, p_invoice_id, p_actor_id, p_note);
  end if;

  return v_invoice;
end;
$$;

-- Unlock transfer confirmed: tranches pending for this invoice become spendable.
create or replace function public.record_spend_release(p_invoice_id uuid, p_tx_hash text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_t public.tranches;
  v_count integer := 0;
  v_total numeric := 0;
  v_donations uuid[] := '{}';
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice_not_found';
  end if;
  if v_inv.status <> 'verified' or v_inv.release_tx_hash is distinct from p_tx_hash then
    raise exception 'release_hash_mismatch';
  end if;

  for v_t in
    select * from public.tranches
     where invoice_id = p_invoice_id and state = 'in_review'
     order by donation_id, "index"
       for update
  loop
    update public.tranches
       set state = 'released', tx_hash = p_tx_hash, released_at = now(), remaining = amount
     where id = v_t.id;
    update public.donations d
       set amount_released = d.amount_released + v_t.amount,
           status = case
             when exists (select 1 from public.tranches x where x.donation_id = d.id and x.state <> 'released' and x.id <> v_t.id)
               then 'partially_released' else 'completed' end
     where d.id = v_t.donation_id;
    v_count := v_count + 1;
    v_total := v_total + v_t.amount;
    v_donations := v_donations || v_t.donation_id;
  end loop;

  if v_count > 0 then
    update public.foundations set total_received = total_received + v_total where id = v_inv.foundation_id;
    insert into public.audit_events (actor_id, action, entity, entity_id, tx_hash, payload)
    values (null, 'tranches_released', 'invoice', p_invoice_id, p_tx_hash,
            jsonb_build_object('tranches', v_count, 'amount', v_total, 'source', 'verify-spend'));
  end if;

  return jsonb_build_object('released_count', v_count, 'released_usd', v_total, 'donations', to_jsonb(v_donations));
end;
$$;

revoke all on function public.foundation_available_balance(uuid) from public;
revoke all on function public.allocate_spend(uuid) from public, anon, authenticated;
revoke all on function public.submit_spend_for_review(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_spend_verdict(uuid, uuid, text, jsonb, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_spend_release(uuid, text) from public, anon, authenticated;
revoke all on function public.donate_from_balance(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.record_initial_release(uuid, text, numeric) from public, anon, authenticated;
-- Security definer + public execute: foundation_stats (readable by anon) calls it, and Postgres checks function
-- permissions against the caller even inside a security_invoker=false view. It only returns one public aggregate.
grant execute on function public.foundation_available_balance(uuid) to anon, authenticated, service_role;
grant execute on function public.allocate_spend(uuid) to service_role;
grant execute on function public.submit_spend_for_review(uuid, uuid) to service_role;
grant execute on function public.resolve_spend_verdict(uuid, uuid, text, jsonb, text, text, text, uuid) to service_role;
grant execute on function public.record_spend_release(uuid, text) to service_role;
grant execute on function public.donate_from_balance(uuid, uuid, numeric) to service_role;
grant execute on function public.record_initial_release(uuid, text, numeric) to service_role;

-- 7. Adapt existing data -------------------------------------------------------------------------------------
-- 7a. Pending unlocks whose invoice is not verified go back to custody (the foundation no longer picks a tranche).
update public.tranches t
   set state = 'in_custody', invoice_id = null
 where t.state = 'in_review'
   and not exists (select 1 from public.invoices i where i.id = t.invoice_id and i.status = 'verified');

-- 7b. Released tranches are spendable.
update public.tranches set remaining = amount where state = 'released';

-- 7c. Verified invoices consume the queue retroactively (capped at what was available at that point).
do $$
declare
  v_inv record;
  v_t record;
  v_need numeric;
  v_take numeric;
  v_total numeric;
begin
  for v_inv in
    select * from public.invoices where status = 'verified' order by coalesce(reviewed_at, uploaded_at), id
  loop
    v_need := v_inv.amount;
    v_total := 0;
    for v_t in
      select t.id, t.remaining
        from public.tranches t
        join public.donations d on d.id = t.donation_id
       where d.foundation_id = v_inv.foundation_id and d.status <> 'refunded'
         and t.state = 'released' and t.remaining > 0
       order by d.created_at, d.id, t."index"
    loop
      exit when v_need <= 0;
      v_take := least(v_t.remaining, v_need);
      update public.tranches set remaining = remaining - v_take where id = v_t.id;
      insert into public.tranche_uses (tranche_id, invoice_id, amount) values (v_t.id, v_inv.id, v_take);
      v_need := v_need - v_take;
      v_total := v_total + v_take;
    end loop;
    update public.invoices set allocated_amount = v_total where id = v_inv.id;
  end loop;
end $$;

-- 8. Stats view: money summary + reputation state -------------------------------------------------------------
-- reputation_state separates "no information" from "untrustworthy":
--   sin_historial   never took part in a fundraising (no money received, no donations, no resolved invoices)
--   inconfiable     frozen, or at least one rejected / flagged invoice after taking part in a fundraising
--   confiable       reputation >= 70 and no incidents
--   en_construccion everything else
drop view if exists public.foundation_stats;
create view public.foundation_stats
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
    when not (f.total_received > 0 or x.donations > 0 or x.sealed + x.rejected > 0) then 'sin_historial'
    when x.rejected > 0 or x.flagged > 0 then 'inconfiable'
    when f.reputation_score >= 70 then 'confiable'
    else 'en_construccion'
  end as reputation_state
from public.foundations f
cross join lateral (
  select
    (select count(*) from public.invoices i where i.foundation_id = f.id and i.status = 'verified')::int as sealed,
    (select count(*) from public.invoices i
      where i.foundation_id = f.id and i.status = 'verified'
        and exists (select 1 from jsonb_array_elements(i.agent_checks) c where (c ->> 'passed')::boolean is false))::int as flagged,
    (select count(*) from public.invoices i where i.foundation_id = f.id and i.status = 'rejected')::int as rejected,
    (select count(*) from public.donations d where d.foundation_id = f.id)::int as donations
) x;

-- 9. Public invoice view: no document paths, no spend documents, no reviewer, check details removed ----------------
create view public.invoices_public
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
  i.reviewed_at
from public.invoices i;

-- 10. Close private data ---------------------------------------------------------------------------------------
drop policy if exists "users read" on public.users;
drop policy if exists "donations read" on public.donations;
drop policy if exists "verifications read" on public.verifications;
drop policy if exists "verifications insert" on public.verifications;
drop policy if exists "invoices read" on public.invoices;
drop policy if exists "invoices insert in_review" on public.invoices;

revoke all on public.users, public.donations, public.verifications, public.invoices from anon, authenticated;
revoke all on public.foundations from anon, authenticated;
-- Public columns only: official_email, legal_doc_path and legal_doc_hash stay private.
grant select (id, user_id, name, description, category, logo_url, wallet_address, reputation_score, payout_percentage,
              status, total_received, created_at, rif, country, city, level, instagram_url, tiktok_url, x_url, contract_address)
  on public.foundations to anon, authenticated;
revoke all on public.foundation_stats, public.invoices_public from anon, authenticated;
grant select on public.foundation_stats to anon, authenticated;
grant select on public.invoices_public to anon, authenticated;

-- Invoice documents are served through signed URLs minted by the `document-url` Edge Function.
update storage.buckets set public = false where id = 'invoices';
drop policy if exists "invoices public read" on storage.objects;
drop policy if exists "rastro invoices read" on storage.objects;
