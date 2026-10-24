-- Simulated donor balance, migration A (additive; safe to apply before the new functions are deployed).
-- Amounts in the database are USD. Only the custody -> foundation release touches the chain.

-- 1. Columns ---------------------------------------------------------------------------------
alter table public.users
  add column balance numeric not null default 0
  constraint users_balance_range check (balance >= 0 and balance <= 10000);

alter table public.donations
  add column release_tx_hash varchar null,
  add column release_claimed_at timestamptz null;

-- 2. Client write hardening (A3) -------------------------------------------------------------
-- A column-level REVOKE is a no-op while a table-level grant exists, so drop the table-level
-- INSERT/UPDATE privileges and re-grant INSERT on every column except `balance`.
-- No UPDATE policy exists on users, so clients lose nothing by losing UPDATE.
revoke insert, update on public.users from anon, authenticated;
grant insert (id, privy_id, wallet_address, email, role, created_at)
  on public.users to anon, authenticated;

-- 3. wallet_top_up -----------------------------------------------------------------------------
create or replace function public.wallet_top_up(p_user_id uuid, p_amount numeric)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  update public.users
     set balance = balance + p_amount
   where id = p_user_id
     and balance + p_amount <= 10000
  returning balance into v_balance;

  if not found then
    if exists (select 1 from public.users where id = p_user_id) then
      raise exception 'cap_exceeded';
    end if;
    raise exception 'user_not_found';
  end if;

  return v_balance;
end;
$$;

-- 4. donate_from_balance -----------------------------------------------------------------------
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
  v_donation public.donations;
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'invalid_amount';
  end if;

  select status into v_status from public.foundations where id = p_foundation_id;
  if not found then
    raise exception 'foundation_not_found';
  end if;
  if v_status = 'suspended' then
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

  insert into public.donations (donor_id, foundation_id, total_amount, currency, status, amount_released)
  values (p_user_id, p_foundation_id, p_amount, 'USD', 'in_escrow', 0)
  returning * into v_donation;

  return v_donation;
end;
$$;

-- 5. record_initial_release (idempotent finalize, A1) -----------------------------------------
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

  -- Already finalized with this hash: return the row unchanged so retries are safe.
  select * into v_donation
    from public.donations
   where id = p_donation_id and release_tx_hash = p_tx_hash;
  if not found then
    raise exception 'release_hash_mismatch';
  end if;
  return v_donation;
end;
$$;

-- 6. Function privileges -----------------------------------------------------------------------
revoke all on function public.wallet_top_up(uuid, numeric) from public, anon, authenticated;
revoke all on function public.donate_from_balance(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.record_initial_release(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.wallet_top_up(uuid, numeric) to service_role;
grant execute on function public.donate_from_balance(uuid, uuid, numeric) to service_role;
grant execute on function public.record_initial_release(uuid, text, numeric) to service_role;
