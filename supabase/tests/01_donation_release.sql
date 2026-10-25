-- 01_donation_release.sql
-- Scenarios 1 and 2: simulated top-up + donation (escrow, 4 tranches) and release of the initial tranche.
-- Everything runs inside ONE DO block that ends with RAISE EXCEPTION carrying the report, so the whole
-- transaction (fixtures included) is rolled back. Expected outcome: ERROR P0001 "TEST_REPORT ...".
-- Out of scope: on-chain send (escrowWallet().sendTransaction), HTTP/Privy auth, edge-function amount parsing.
do $test$
declare
  v_donor uuid; v_donor2 uuid; v_donor3 uuid;
  v_f1 uuid; v_f2 uuid; v_f3 uuid; v_f4 uuid; v_fz uuid; v_fp uuid;
  v_d public.donations; v_d2 public.donations; v_r public.donations;
  v_bal numeric; v_cnt int; v_t numeric[]; v_states text[];
  v_recv0 numeric; v_recv1 numeric; v_pct int; v_exp numeric; v_tr public.tranches;
  v_rep int; v_lvl int; v_exp_pct int[] := array[10, 10, 15, 25];
  v_fids uuid[]; i int; v_report text; v_fail int; v_e text;
begin
  create temp table t_res (n serial, ok boolean, name text, observed text);
  execute $f$create function pg_temp.chk(p_name text, p_ok boolean, p_obs text) returns void language sql as
    $b$ insert into pg_temp.t_res(ok, name, observed) values (coalesce(p_ok, false), p_name, p_obs) $b$$f$;
  -- err(q): runs q and returns the error message (or NO_ERROR). The sub-block rolls back its own effects.
  execute $f$create function pg_temp.err(q text) returns text language plpgsql as
    $b$ begin execute q; return 'NO_ERROR'; exception when others then return sqlerrm; end $b$$f$;

  -- Fixtures (obviously fake) -----------------------------------------------------------------
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DONOR-1', 'donor', 'TEST-privy-1') returning id into v_donor;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DONOR-2', 'donor', 'TEST-privy-2') returning id into v_donor2;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DONOR-3', 'donor', 'TEST-privy-3') returning id into v_donor3;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif) values ('TEST-Foundation L1', 'TEST-WALLET-F1', 0,  'active', 'J-99999001-0') returning id into v_f1;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif) values ('TEST-Foundation L2', 'TEST-WALLET-F2', 40, 'active', 'J-99999002-0') returning id into v_f2;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif) values ('TEST-Foundation L3', 'TEST-WALLET-F3', 70, 'active', 'J-99999003-0') returning id into v_f3;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif) values ('TEST-Foundation L4', 'TEST-WALLET-F4', 90, 'active', 'J-99999004-0') returning id into v_f4;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif) values ('TEST-Foundation frozen', 'TEST-WALLET-FZ', 0, 'frozen',  'J-99999005-0') returning id into v_fz;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif) values ('TEST-Foundation pending', 'TEST-WALLET-FP', 0, 'pending', 'J-99999006-0') returning id into v_fp;
  v_fids := array[v_f1, v_f2, v_f3, v_f4];

  ---------------------------------------------------------------------------------------------
  -- SCENARIO 1a: wallet_top_up
  ---------------------------------------------------------------------------------------------
  select public.wallet_top_up(v_donor, 500) into v_bal;
  perform pg_temp.chk('S1 topup 500 returns new balance 500', v_bal = 500, 'returned=' || v_bal);
  select balance into v_bal from public.users where id = v_donor;
  perform pg_temp.chk('S1 users.balance = 500 after topup', v_bal = 500, 'balance=' || v_bal);
  v_e := pg_temp.err(format('select public.wallet_top_up(%L, 0)', v_donor));
  perform pg_temp.chk('S1 topup 0 rejected invalid_amount', v_e = 'invalid_amount', v_e);
  v_e := pg_temp.err(format('select public.wallet_top_up(%L, -5)', v_donor));
  perform pg_temp.chk('S1 topup negative rejected invalid_amount', v_e = 'invalid_amount', v_e);
  v_e := pg_temp.err(format('select public.wallet_top_up(%L, 9500.01)', v_donor));
  perform pg_temp.chk('S1 topup over 10000 cap rejected cap_exceeded (500 + 9500.01)', v_e = 'cap_exceeded', v_e);
  select balance into v_bal from public.users where id = v_donor;
  perform pg_temp.chk('S1 balance unchanged after rejected topup', v_bal = 500, 'balance=' || v_bal);
  v_e := pg_temp.err(format('select public.wallet_top_up(%L, 10)', gen_random_uuid()));
  perform pg_temp.chk('S1 topup unknown user rejected user_not_found', v_e = 'user_not_found', v_e);
  select public.wallet_top_up(v_donor, 9500) into v_bal;
  perform pg_temp.chk('S1 topup reaching exactly 10000 allowed', v_bal = 10000, 'balance=' || v_bal);
  v_e := pg_temp.err(format('select public.wallet_top_up(%L, 0.01)', v_donor));
  perform pg_temp.chk('S1 topup 0.01 beyond 10000 rejected cap_exceeded', v_e = 'cap_exceeded', v_e);
  v_e := pg_temp.err(format('update public.users set balance = 10001 where id = %L', v_donor));
  -- Since 20261028000000 the table keeps only balance >= 0: the 10000 cap is enforced by wallet_top_up, so a
  -- fraud refund credit can exceed it. Clients cannot UPDATE users.balance anyway (privileges revoked).
  perform pg_temp.chk('S1 direct UPDATE balance 10001 allowed by the table (cap lives in wallet_top_up)', v_e = 'NO_ERROR', v_e);
  v_e := pg_temp.err(format('update public.users set balance = -1 where id = %L', v_donor));
  perform pg_temp.chk('S1 direct UPDATE balance -1 blocked by users_balance_nonneg', v_e like '%users_balance_nonneg%', v_e);
  v_e := pg_temp.err(format('select public.wallet_top_up(%L, 1)', v_donor));
  perform pg_temp.chk('S1 topup still rejected cap_exceeded when balance is above 10000', v_e = 'cap_exceeded', v_e);
  update public.users set balance = 10000 where id = v_donor;

  ---------------------------------------------------------------------------------------------
  -- SCENARIO 1b: donate_from_balance
  ---------------------------------------------------------------------------------------------
  select * into v_d from public.donate_from_balance(v_donor, v_f1, 100);
  select balance into v_bal from public.users where id = v_donor;
  perform pg_temp.chk('S1 donate 100: donor balance debited 10000 -> 9900', v_bal = 9900, 'balance=' || v_bal);
  perform pg_temp.chk('S1 donation row: in_escrow, amount_released 0, total 100, USD, initial_pct 10',
    v_d.status = 'in_escrow' and v_d.amount_released = 0 and v_d.total_amount = 100 and v_d.currency = 'USD'
      and v_d.initial_pct = 10 and v_d.donor_id = v_donor and v_d.foundation_id = v_f1,
    format('status=%s released=%s total=%s cur=%s pct=%s', v_d.status, v_d.amount_released, v_d.total_amount, v_d.currency, v_d.initial_pct));
  select count(*), array_agg(amount order by "index"), array_agg(state order by "index")
    into v_cnt, v_t, v_states from public.tranches where donation_id = v_d.id;
  perform pg_temp.chk('S1 donation creates 4 tranches', v_cnt = 4, 'count=' || v_cnt);
  perform pg_temp.chk('S1 tranche amounts 10/30/30/30 (level I = 10%)', v_t = array[10, 30, 30, 30]::numeric[], v_t::text);
  perform pg_temp.chk('S1 all 4 tranches start in_custody', v_states = array['in_custody','in_custody','in_custody','in_custody'], v_states::text);
  select total_received into v_recv0 from public.foundations where id = v_f1;
  perform pg_temp.chk('S1 foundation.total_received untouched by donate (still 0)', v_recv0 = 0, 'total_received=' || v_recv0);

  -- Rounding: odd amount, tranche sum must equal total.
  select * into v_d2 from public.donate_from_balance(v_donor, v_f1, 100.01);
  select array_agg(amount order by "index") into v_t from public.tranches where donation_id = v_d2.id;
  perform pg_temp.chk('S1 rounding 100.01: tranches 10/30/30/30.01 and sum = total',
    v_t = array[10, 30, 30, 30.01]::numeric[] and (select sum(x) from unnest(v_t) x) = 100.01, v_t::text);
  select balance into v_bal from public.users where id = v_donor;
  perform pg_temp.chk('S1 balance 9900 - 100.01 = 9799.99', v_bal = 9799.99, 'balance=' || v_bal);

  -- Rejections
  select count(*) into v_cnt from public.donations where donor_id = v_donor;
  v_e := pg_temp.err(format('select * from public.donate_from_balance(%L, %L, 9800)', v_donor, v_f1));
  perform pg_temp.chk('S1 insufficient funds (9800 > 9799.99) rejected', v_e = 'insufficient_funds', v_e);
  select balance into v_bal from public.users where id = v_donor;
  perform pg_temp.chk('S1 balance + donation count unchanged after rejection',
    v_bal = 9799.99 and (select count(*) from public.donations where donor_id = v_donor) = v_cnt, format('balance=%s donations=%s', v_bal, v_cnt));
  v_e := pg_temp.err(format('select * from public.donate_from_balance(%L, %L, 0.99)', v_donor, v_f1));
  perform pg_temp.chk('S1 amount < 1 rejected invalid_amount', v_e = 'invalid_amount', v_e);
  v_e := pg_temp.err(format('select * from public.donate_from_balance(%L, %L, 10)', v_donor, gen_random_uuid()));
  perform pg_temp.chk('S1 unknown foundation rejected foundation_not_found', v_e = 'foundation_not_found', v_e);
  v_e := pg_temp.err(format('select * from public.donate_from_balance(%L, %L, 10)', v_donor, v_fz));
  perform pg_temp.chk('S1 frozen foundation rejected foundation_suspended', v_e = 'foundation_suspended', v_e);
  v_e := pg_temp.err(format('select * from public.donate_from_balance(%L, %L, 10)', v_donor, v_fp));
  perform pg_temp.chk('S1 pending foundation rejected foundation_suspended', v_e = 'foundation_suspended', v_e);
  v_e := pg_temp.err(format('select * from public.donate_from_balance(%L, %L, 10)', gen_random_uuid(), v_f1));
  perform pg_temp.chk('S1 unknown user rejected user_not_found', v_e = 'user_not_found', v_e);
  select balance into v_bal from public.users where id = v_donor;
  perform pg_temp.chk('S1 balance still 9799.99 after all rejected donations', v_bal = 9799.99, 'balance=' || v_bal);

  -- 10000 cap at both ends
  perform public.wallet_top_up(v_donor2, 10000);
  v_e := pg_temp.err(format('select public.wallet_top_up(%L, 0.01)', v_donor2));
  perform pg_temp.chk('S1 topup beyond 10000 rejected cap_exceeded (user at 10000)', v_e = 'cap_exceeded', v_e);
  select * into v_d2 from public.donate_from_balance(v_donor2, v_f1, 10000);
  select balance into v_bal from public.users where id = v_donor2;
  select array_agg(amount order by "index") into v_t from public.tranches where donation_id = v_d2.id;
  perform pg_temp.chk('S1 donate full 10000: balance 0, tranches 1000/3000/3000/3000',
    v_bal = 0 and v_t = array[1000, 3000, 3000, 3000]::numeric[], format('balance=%s tranches=%s', v_bal, v_t));
  perform public.wallet_top_up(v_donor3, 10000);
  v_e := pg_temp.err(format('select * from public.donate_from_balance(%L, %L, 10000.01)', v_donor3, v_f1));
  perform pg_temp.chk('S1 donate 10000.01 with balance 10000 rejected (cap enforced through balance)', v_e = 'insufficient_funds', v_e);

  ---------------------------------------------------------------------------------------------
  -- SCENARIO 2: record_initial_release (finalization used by releaseInitial) across levels
  ---------------------------------------------------------------------------------------------
  for i in 1..4 loop
    select payout_percentage, reputation_score, level into v_pct, v_rep, v_lvl from public.foundations where id = v_fids[i];
    perform pg_temp.chk(format('S2 foundation rep %s -> payout_percentage %s (trigger)', v_rep, v_exp_pct[i]),
      v_pct = v_exp_pct[i], format('payout=%s level=%s', v_pct, v_lvl));
  end loop;

  for i in 1..4 loop
    update public.users set balance = 1000 where id = v_donor3;
    select * into v_d from public.donate_from_balance(v_donor3, v_fids[i], 200);
    select payout_percentage, total_received into v_pct, v_recv0 from public.foundations where id = v_fids[i];
    v_exp := round(200 * v_pct / 100.0, 2);   -- same formula as releaseInitial in core.ts
    -- releaseInitial persists the hash first (update donations.release_tx_hash), then finalizes.
    update public.donations set release_tx_hash = 'TEST-0xHASH-' || i where id = v_d.id;
    select * into v_r from public.record_initial_release(v_d.id, 'TEST-0xHASH-' || i, v_exp);
    select total_received into v_recv1 from public.foundations where id = v_fids[i];
    select * into v_tr from public.tranches where donation_id = v_d.id and "index" = 1;
    perform pg_temp.chk(format('S2 level %s (%s%%): amount_released = %s, status partially_released', i, v_pct, v_exp),
      v_r.amount_released = v_exp and v_r.status = 'partially_released', format('released=%s status=%s', v_r.amount_released, v_r.status));
    perform pg_temp.chk(format('S2 level %s: tranche 1 released with tx hash + released_at, amount = amount_released', i),
      v_tr.state = 'released' and v_tr.tx_hash = 'TEST-0xHASH-' || i and v_tr.released_at is not null and v_tr.amount = v_r.amount_released,
      format('state=%s tx=%s amount=%s', v_tr.state, v_tr.tx_hash, v_tr.amount));
    select array_agg(state order by "index") into v_states from public.tranches where donation_id = v_d.id and "index" > 1;
    perform pg_temp.chk(format('S2 level %s: tranches 2-4 remain in_custody', i), v_states = array['in_custody','in_custody','in_custody'], v_states::text);
    perform pg_temp.chk(format('S2 level %s: foundation.total_received += %s', i, v_exp), v_recv1 - v_recv0 = v_exp, format('before=%s after=%s', v_recv0, v_recv1));
    perform pg_temp.chk(format('S2 level %s: 1 approved verifications row carrying the hash', i),
      (select count(*) from public.verifications where donation_id = v_d.id and status = 'approved' and release_tx_hash = 'TEST-0xHASH-' || i) = 1, 'ok');

    -- Idempotency: same hash again => same row, nothing counted twice
    select * into v_r from public.record_initial_release(v_d.id, 'TEST-0xHASH-' || i, v_exp);
    perform pg_temp.chk(format('S2 level %s: second call with same hash is idempotent (no double count)', i),
      (select total_received from public.foundations where id = v_fids[i]) = v_recv1
      and (select count(*) from public.verifications where donation_id = v_d.id) = 1
      and v_r.amount_released = v_exp,
      format('total_received=%s verifications=%s', (select total_received from public.foundations where id = v_fids[i]),
             (select count(*) from public.verifications where donation_id = v_d.id)));
  end loop;

  -- Mismatching hash on an already released donation
  select * into v_d from public.donations where donor_id = v_donor3 order by created_at limit 1;
  v_e := pg_temp.err(format('select * from public.record_initial_release(%L, %L, 20)', v_d.id, 'TEST-0xOTHER'));
  perform pg_temp.chk('S2 different hash on released donation rejected release_hash_mismatch', v_e = 'release_hash_mismatch', v_e);
  -- Finalize without a persisted hash
  update public.users set balance = 1000 where id = v_donor3;
  select * into v_d from public.donate_from_balance(v_donor3, v_f1, 50);
  v_e := pg_temp.err(format('select * from public.record_initial_release(%L, %L, 5)', v_d.id, 'TEST-0xNOHASH'));
  perform pg_temp.chk('S2 finalize before hash persisted rejected release_hash_mismatch', v_e = 'release_hash_mismatch', v_e);
  perform pg_temp.chk('S2 nothing released by the rejected finalize',
    (select amount_released from public.donations where id = v_d.id) = 0
    and (select state from public.tranches where donation_id = v_d.id and "index" = 1) = 'in_custody', 'ok');

  -- Edge: reputation changes between donating and releasing. donate_from_balance fixes tranche 1 with the
  -- percentage at donation time (initial_pct); releaseInitial (core.ts) now uses the stored initial_pct
  -- (not the foundation's CURRENT payout_percentage). Invariant: donations.amount_released == tranche 1 amount.
  update public.users set balance = 1000 where id = v_donor3;
  select * into v_d from public.donate_from_balance(v_donor3, v_f1, 200);   -- tranche 1 = 20 (10%)
  update public.foundations set reputation_score = 90 where id = v_f1;       -- payout is now 25%
  select payout_percentage into v_pct from public.foundations where id = v_f1;
  perform pg_temp.chk('S2 EDGE: foundation payout moved to 25% while the donation keeps initial_pct 10', v_pct = 25 and v_d.initial_pct = 10, format('payout=%s initial_pct=%s', v_pct, v_d.initial_pct));
  v_exp := round(200 * v_d.initial_pct / 100.0, 2);                          -- what core.ts now sends/records
  update public.donations set release_tx_hash = 'TEST-0xHASH-REP' where id = v_d.id;
  select * into v_r from public.record_initial_release(v_d.id, 'TEST-0xHASH-REP', v_exp);
  select * into v_tr from public.tranches where donation_id = v_d.id and "index" = 1;
  perform pg_temp.chk('S2 EDGE: amount_released equals tranche 1 amount when reputation changed after donating',
    v_r.amount_released = v_tr.amount,
    format('initial_pct=%s amount_released=%s tranche1.amount=%s', v_d.initial_pct, v_r.amount_released, v_tr.amount));

  -- A refunded donation can never be resurrected by a late initial-release finalize.
  update public.users set balance = 1000 where id = v_donor3;
  select * into v_d from public.donate_from_balance(v_donor3, v_f2, 100);
  update public.donations set release_tx_hash = 'TEST-0xHASH-LATE' where id = v_d.id;
  update public.donations set status = 'refunded' where id = v_d.id;
  v_e := pg_temp.err(format('select * from public.record_initial_release(%L, %L, 10)', v_d.id, 'TEST-0xHASH-LATE'));
  perform pg_temp.chk('S2 finalize on a refunded donation rejected donation_refunded', v_e = 'donation_refunded', v_e);
  perform pg_temp.chk('S2 refunded donation stays refunded with amount_released 0',
    (select status from public.donations where id = v_d.id) = 'refunded' and (select amount_released from public.donations where id = v_d.id) = 0, 'ok');

  -- Report -------------------------------------------------------------------------------------
  select count(*) filter (where not ok) into v_fail from t_res;
  select format(E'TEST_REPORT 01_donation_release: %s checks, %s FAILED\n', count(*), v_fail)
         || string_agg(format('[%s] %s | %s', case when ok then 'PASS' else 'FAIL' end, name, observed), E'\n' order by n)
    into v_report from t_res;
  raise exception E'%', v_report;
end
$test$;
