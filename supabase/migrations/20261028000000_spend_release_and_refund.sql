-- Spend-driven tranche release and fraud refund (additive; keeps apply_spend_verdict(7 args) working).
--
-- Interpretation (foundation level, consistent with foundation_stats.next_tranche_index):
--   an invoice carries (foundation_id, tranche_index = k). A verified invoice releases tranche k of EVERY
--   open donation (status partially_released) of that foundation whose tranche k-1 is released and tranche k
--   is in_custody. Those tranches are linked to the invoice (tranches.invoice_id) and moved to in_review when
--   the invoice is submitted (submit_spend_for_review), which FREEZES the target set: donations made later
--   are not part of an on-chain send that already happened.
--   A rejected invoice freezes the foundation, breaks every unreleased tranche of its open donations and
--   refunds 100% of each affected donor's contribution (simulated balance). What was already released
--   on-chain cannot be clawed back: the platform absorbs it.
--
-- Release lifecycle of a verified invoice: verified + tranches in_review + invoices.release_tx_hash null
--   -> (claim, send, persist hash) -> record_spend_release -> tranches released. Every step is retryable.

-- 1. Balance cap --------------------------------------------------------------------------------------
-- The 10000 USD cap exists to limit simulated top-ups, which wallet_top_up already enforces. A refund credit
-- (up to the full donation) must never fail because the donor topped up in the meantime, so the table
-- constraint keeps only the non-negative rule.
alter table public.users drop constraint if exists users_balance_range;
alter table public.users add constraint users_balance_nonneg check (balance >= 0);

-- 2. Release hash bookkeeping on invoices (same claim/persist pattern as donations) ---------------------
alter table public.invoices
  add column if not exists release_tx_hash text,
  add column if not exists release_claimed_at timestamptz;

-- 3. donate_from_balance: lock the foundation row so a donation cannot slip in while it is being frozen ----
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

  select status, payout_percentage into v_status, v_pct
    from public.foundations where id = p_foundation_id for share;
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

-- 4. record_initial_release: never resurrect a refunded donation ------------------------------------------
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
     and status = 'in_escrow'
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
  if v_donation.status = 'refunded' then
    raise exception 'donation_refunded';
  end if;
  return v_donation;
end;
$$;

-- 5. Submission: freeze the target tranches and mark them in_review -------------------------------------
-- Idempotent: a retry (e.g. after a model failure) returns the same set plus any newly eligible tranche.
-- Returns the number of tranches in_review linked to the invoice.
create or replace function public.submit_spend_for_review(p_invoice_id uuid, p_foundation_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_fstatus text;
  v_count integer;
begin
  select * into v_inv from public.invoices where id = p_invoice_id and foundation_id = p_foundation_id for update;
  if not found then
    raise exception 'invoice_not_found';
  end if;
  if v_inv.status <> 'in_review' then
    raise exception 'invoice_not_pending';
  end if;
  select status into v_fstatus from public.foundations where id = p_foundation_id;
  if v_fstatus is distinct from 'active' then
    raise exception 'foundation_suspended';
  end if;

  -- Tranche 1 is the automatic initial release; a spend without a valid index targets nothing.
  if v_inv.tranche_index is not null and v_inv.tranche_index >= 2 then
    update public.tranches t
       set state = 'in_review', invoice_id = p_invoice_id
      from public.donations d
     where d.id = t.donation_id
       and d.foundation_id = p_foundation_id
       and d.status = 'partially_released'
       and t."index" = v_inv.tranche_index
       and t.state = 'in_custody'
       and exists (
         select 1 from public.tranches p
          where p.donation_id = t.donation_id and p."index" = t."index" - 1 and p.state = 'released'
       );
  end if;

  select count(*) into v_count
    from public.tranches where invoice_id = p_invoice_id and state = 'in_review';
  return v_count;
end;
$$;

-- 6. Freeze + break + refund 100% (idempotent) -----------------------------------------------------------
create or replace function public.freeze_foundation_and_refund(
  p_foundation_id uuid,
  p_invoice_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_f public.foundations;
  v_d public.donations;
  v_refunds integer := 0;
  v_total numeric := 0;
  v_broken integer := 0;
  v_n integer;
begin
  select * into v_f from public.foundations where id = p_foundation_id for update;
  if not found then
    raise exception 'foundation_not_found';
  end if;

  if v_f.status <> 'frozen' then
    update public.foundations set status = 'frozen' where id = p_foundation_id;
    insert into public.audit_events (actor_id, action, entity, entity_id, payload)
    values (p_actor_id, 'foundation_frozen', 'foundation', p_foundation_id,
            jsonb_build_object('invoice_id', p_invoice_id, 'reason', p_reason, 'source', 'verify-spend'));
  end if;

  -- Open donations only: refunded ones were already handled, completed ones were fully released.
  for v_d in
    select * from public.donations
     where foundation_id = p_foundation_id and status in ('in_escrow', 'partially_released')
     order by created_at, id
       for update
  loop
    update public.tranches set state = 'broken' where donation_id = v_d.id and state <> 'released';
    get diagnostics v_n = row_count;
    v_broken := v_broken + v_n;

    insert into public.refunds (donation_id, invoice_id, amount, reason)
    values (v_d.id, p_invoice_id, v_d.total_amount, left(p_reason, 500))
    on conflict (donation_id) do nothing;

    if found then
      -- Full contribution back to the simulated balance (the cap is enforced only on top-ups).
      if v_d.donor_id is not null then
        update public.users set balance = balance + v_d.total_amount where id = v_d.donor_id;
      end if;
      update public.donations set status = 'refunded', amount_refunded = v_d.total_amount where id = v_d.id;
      insert into public.audit_events (actor_id, action, entity, entity_id, payload)
      values (p_actor_id, 'donation_refunded', 'donation', v_d.id,
              jsonb_build_object('invoice_id', p_invoice_id, 'amount', v_d.total_amount,
                                 'already_released', v_d.amount_released, 'absorbed_by_platform', v_d.amount_released,
                                 'broken_tranches', v_n, 'source', 'verify-spend'));
      v_refunds := v_refunds + 1;
      v_total := v_total + v_d.total_amount;
    end if;
  end loop;

  return jsonb_build_object('refunds', v_refunds, 'refunded_usd', v_total, 'broken_tranches', v_broken);
end;
$$;

-- 7. Verdict writer with ownership guard ---------------------------------------------------------------
-- Replaces apply_spend_verdict(7 args) for verify-spend: the invoice must belong to p_foundation_id, and a
-- rejection freezes + refunds atomically in the same transaction. A verified verdict bumps reputation by
-- 4 points (mirrors REP_PER_VERIFIED_INVOICE; the foundations trigger recomputes level and payout).
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
    update public.foundations
       set reputation_score = least(100, reputation_score + 4)
     where id = p_foundation_id;
  else
    perform public.freeze_foundation_and_refund(p_foundation_id, p_invoice_id, p_actor_id, p_note);
  end if;

  return v_invoice;
end;
$$;

-- 8. Release finalizer (idempotent, like record_initial_release) -----------------------------------------
-- Moves the invoice's in_review tranches to released, updates donations / foundation totals and audit.
-- A retry after success (or after the tranches were broken by a later freeze) is a no-op returning zeros.
create or replace function public.record_spend_release(p_invoice_id uuid, p_tx_hash text)
returns jsonb
language plpgsql
security invoker
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
    update public.tranches set state = 'released', tx_hash = p_tx_hash, released_at = now() where id = v_t.id;
    update public.donations d
       set amount_released = d.amount_released + v_t.amount,
           status = case
             when exists (select 1 from public.tranches x where x.donation_id = d.id and x.state <> 'released')
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
            jsonb_build_object('tranche_index', v_inv.tranche_index, 'tranches', v_count,
                               'amount', v_total, 'source', 'verify-spend'));
  end if;

  return jsonb_build_object('released_count', v_count, 'released_usd', v_total, 'donations', to_jsonb(v_donations));
end;
$$;

-- 9. Grants: service_role only ---------------------------------------------------------------------------
revoke all on function public.submit_spend_for_review(uuid, uuid) from public, anon, authenticated;
revoke all on function public.freeze_foundation_and_refund(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_spend_verdict(uuid, uuid, text, jsonb, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_spend_release(uuid, text) from public, anon, authenticated;
revoke all on function public.donate_from_balance(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.record_initial_release(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.submit_spend_for_review(uuid, uuid) to service_role;
grant execute on function public.freeze_foundation_and_refund(uuid, uuid, uuid, text) to service_role;
grant execute on function public.resolve_spend_verdict(uuid, uuid, text, jsonb, text, text, text, uuid) to service_role;
grant execute on function public.record_spend_release(uuid, text) to service_role;
grant execute on function public.donate_from_balance(uuid, uuid, numeric) to service_role;
grant execute on function public.record_initial_release(uuid, text, numeric) to service_role;
