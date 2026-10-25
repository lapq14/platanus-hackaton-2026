-- 03_fraud_refund.sql
-- Scenario 4: a REJECTED spend (the foundation submitted false/unverifiable data).
-- Expected behavior (migration 20261028000000): resolve_spend_verdict('rejected') atomically
--   * freezes the foundation, * marks every unreleased tranche of its OPEN donations `broken`,
--   * refunds 100% of each affected donation's total_amount to users.balance (including the part already
--     released on-chain, which the platform absorbs), * sets donations.status = refunded,
--   * writes refunds + audit_events rows. Completed donations and other foundations are untouched.
-- Whole script = one DO block ending in RAISE EXCEPTION, so everything rolls back (zero persistent data).
-- Out of scope: the Anthropic model call, on-chain sends, Privy auth.
do $test$
declare
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_w uuid;
  v_own uuid; v_owy uuid; v_oww uuid; v_x uuid; v_y uuid; v_wf uuid;
  v_z uuid; v_a1 uuid; v_a2 uuid; v_b1 uuid; v_by uuid; v_c1 uuid; v_e1 uuid; v_f1 uuid; v_w1 uuid;
  v_inv public.invoices; v_res jsonb; v_ids uuid[]; v_id uuid; v_s text; v_st text[]; v_x_recv numeric; v_recv numeric;
  v_n int; v_e2 text; v_json jsonb; v_stats record; v_sum numeric;
  v_checks jsonb := '[{"id":"origin_account_owned","label":"x","passed":true,"detail":"ok"}]'::jsonb;
  v_bad jsonb := '[{"id":"rif_exists","label":"El RIF existe y está registrado","passed":false,"detail":"no"}]'::jsonb;
  v_report text; v_fail int; v_info int; v_expect numeric;
begin
  create temp table t_res (n serial, kind text, name text, observed text);
  execute $f$create function pg_temp.chk(p_name text, p_ok boolean, p_obs text) returns void language sql as
    $b$ insert into pg_temp.t_res(kind, name, observed) values (case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, p_name, p_obs) $b$$f$;
  execute $f$create function pg_temp.info(p_name text, p_obs text) returns void language sql as
    $b$ insert into pg_temp.t_res(kind, name, observed) values ('INFO', p_name, p_obs) $b$$f$;
  execute $f$create function pg_temp.err(q text) returns text language plpgsql as
    $b$ begin execute q; return 'NO_ERROR'; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.bal(p_user uuid) returns numeric language sql as
    $b$ select balance from public.users where id = p_user $b$$f$;
  -- Donates and releases the initial tranche exactly like the edge flow (hash persisted, then finalized).
  execute $f$create function pg_temp.donate_rel(p_user uuid, p_f uuid, p_amount numeric, p_hash text) returns uuid language plpgsql as
    $b$ declare v_d public.donations; v_t1 numeric;
    begin
      select * into v_d from public.donate_from_balance(p_user, p_f, p_amount);
      select amount into v_t1 from public.tranches where donation_id = v_d.id and "index" = 1;
      update public.donations set release_tx_hash = p_hash where id = v_d.id;
      perform public.record_initial_release(v_d.id, p_hash, v_t1);
      return v_d.id;
    end $b$$f$;
  -- One spend: submit (tranches in_review) -> model verdict -> verified: simulated send + finalize.
  execute $f$create function pg_temp.spend(p_f uuid, p_actor uuid, p_k int, p_no text, p_status text) returns jsonb language plpgsql as
    $b$ declare v_inv public.invoices; v_n int;
    begin
      insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, tranche_index)
      values (p_f, p_no, 'TEST spend ' || p_no, 1, 'J-99999900-0', p_k) returning * into v_inv;
      v_n := public.submit_spend_for_review(v_inv.id, p_f);
      perform public.resolve_spend_verdict(v_inv.id, p_f, p_status,
        case when p_status = 'verified' then '[{"id":"x","label":"x","passed":true,"detail":"ok"}]'::jsonb
             else '[{"id":"rif_exists","label":"El RIF existe y está registrado","passed":false,"detail":"no"}]'::jsonb end,
        'TEST ' || p_status, 'TEST/o.pdf', 'TEST/d.pdf', p_actor);
      if p_status = 'verified' and v_n > 0 then
        update public.invoices set release_tx_hash = 'TEST-0xTX-' || p_no where id = v_inv.id;
        return public.record_spend_release(v_inv.id, 'TEST-0xTX-' || p_no) || jsonb_build_object('invoice_id', v_inv.id);
      end if;
      return jsonb_build_object('invoice_id', v_inv.id, 'submitted', v_n);
    end $b$$f$;

  -- Fixtures -----------------------------------------------------------------------------------------
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DA', 'donor', 'TEST-privy-4a') returning id into v_a;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DB', 'donor', 'TEST-privy-4b') returning id into v_b;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DC', 'donor', 'TEST-privy-4c') returning id into v_c;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DD', 'donor', 'TEST-privy-4d') returning id into v_d;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DE', 'donor', 'TEST-privy-4e') returning id into v_e;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DF', 'donor', 'TEST-privy-4f') returning id into v_f;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DW', 'donor', 'TEST-privy-4w') returning id into v_w;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-OX', 'ong', 'TEST-privy-4ox') returning id into v_own;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-OY', 'ong', 'TEST-privy-4oy') returning id into v_owy;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-OW', 'ong', 'TEST-privy-4ow') returning id into v_oww;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif, user_id) values ('TEST-Fraud X', 'TEST-WALLET-FX', 0, 'active', 'J-99999201-0', v_own) returning id into v_x;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif, user_id) values ('TEST-Honest Y', 'TEST-WALLET-FY', 0, 'active', 'J-99999202-0', v_owy) returning id into v_y;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif, user_id) values ('TEST-Inflight W', 'TEST-WALLET-FW', 0, 'active', 'J-99999203-0', v_oww) returning id into v_wf;
  perform public.wallet_top_up(v_a, 500);
  perform public.wallet_top_up(v_b, 1000);
  perform public.wallet_top_up(v_c, 100);
  perform public.wallet_top_up(v_d, 200);
  perform public.wallet_top_up(v_e, 10000);
  perform public.wallet_top_up(v_f, 100);
  perform public.wallet_top_up(v_w, 100);

  -- Z: a donation on X that COMPLETES (3 verified spends) before the fraud ----------------------------
  v_z := pg_temp.donate_rel(v_d, v_x, 100, 'TEST-0xH-Z');
  perform pg_temp.spend(v_x, v_own, 2, 'TEST-N-01', 'verified');
  perform pg_temp.spend(v_x, v_own, 3, 'TEST-N-02', 'verified');
  perform pg_temp.spend(v_x, v_own, 4, 'TEST-N-03', 'verified');
  perform pg_temp.chk('S4 setup: donation Z completed (4 released tranches, 100 released)',
    (select status from public.donations where id = v_z) = 'completed' and (select amount_released from public.donations where id = v_z) = 100, 'ok');

  -- Several donors on X: A donates TWICE, B also donates to the honest foundation Y, E sits at the cap --
  v_a1 := pg_temp.donate_rel(v_a, v_x, 100, 'TEST-0xH-A1');
  v_a2 := pg_temp.donate_rel(v_a, v_x, 60, 'TEST-0xH-A2');
  v_b1 := pg_temp.donate_rel(v_b, v_x, 250, 'TEST-0xH-B1');
  v_by := pg_temp.donate_rel(v_b, v_y, 80, 'TEST-0xH-BY');
  v_c1 := pg_temp.donate_rel(v_c, v_x, 40.50, 'TEST-0xH-C1');
  v_e1 := pg_temp.donate_rel(v_e, v_x, 500, 'TEST-0xH-E1');
  -- F donated but its initial release never happened (status in_escrow)
  select id into v_f1 from public.donate_from_balance(v_f, v_x, 30);
  -- E tops up again to the cap while its 500 sits in custody: a refund will push the balance above 10000
  perform public.wallet_top_up(v_e, 500);
  perform pg_temp.chk('S4 setup: E is exactly at the cap (10000) with 500 in custody', pg_temp.bal(v_e) = 10000, 'balance=' || pg_temp.bal(v_e));
  perform pg_temp.chk('S4 setup: balances after donating (A 340, B 670, C 59.5, D 100, E 10000, F 70)',
    pg_temp.bal(v_a) = 340 and pg_temp.bal(v_b) = 670 and pg_temp.bal(v_c) = 59.5 and pg_temp.bal(v_d) = 100 and pg_temp.bal(v_e) = 10000 and pg_temp.bal(v_f) = 70,
    format('A=%s B=%s C=%s D=%s E=%s F=%s', pg_temp.bal(v_a), pg_temp.bal(v_b), pg_temp.bal(v_c), pg_temp.bal(v_d), pg_temp.bal(v_e), pg_temp.bal(v_f)));

  -- Honest spend (tranche 2) releases tranche 2 of every OPEN donation of X; Z (completed) and F (no initial) are skipped
  v_res := pg_temp.spend(v_x, v_own, 2, 'TEST-N-04', 'verified');
  perform pg_temp.chk('S4 setup: verified spend releases tranche 2 of the 5 eligible donations (A1, A2, B1, C1, E1)',
    (v_res ->> 'released_count')::int = 5 and (v_res ->> 'released_usd')::numeric = 30 + 18 + 75 + 12.15 + 150,
    v_res::text);
  perform pg_temp.chk('S4 setup: F (in_escrow) tranches all still in_custody after the honest spend',
    (select count(*) from public.tranches where donation_id = v_f1 and state = 'in_custody') = 4, 'ok');
  select total_received into v_x_recv from public.foundations where id = v_x;
  perform pg_temp.info('S4 foundation X total_received before the fraud', 'total_received=' || v_x_recv);

  -- Snapshot of the unrelated foundation Y and of Z before the fraud
  select jsonb_build_object('don', to_jsonb(d), 'tr', (select jsonb_agg(to_jsonb(t) order by t."index") from public.tranches t where t.donation_id = d.id))
    into v_json from public.donations d where d.id = v_by;

  -- THE FRAUD: tranche 3 spend is submitted, then the verdict is REJECTED --------------------------------
  insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, tranche_index)
  values (v_x, 'TEST-N-05', 'TEST fraudulent spend', 1, 'J-99999900-0', 3) returning * into v_inv;
  v_n := public.submit_spend_for_review(v_inv.id, v_x);
  perform pg_temp.chk('S4 fraud submitted: 5 tranches (index 3) in_review', v_n = 5, 'targets=' || v_n);
  perform public.resolve_spend_verdict(v_inv.id, v_x, 'rejected', v_bad, 'Gasto rechazado: RIF inexistente.', 'TEST/o.pdf', 'TEST/d.pdf', v_own);

  perform pg_temp.chk('S4 invoice rejected with review_note and audit_events invoice_rejected',
    (select status from public.invoices where id = v_inv.id) = 'rejected'
      and (select review_note from public.invoices where id = v_inv.id) like 'Gasto rechazado%'
      and (select count(*) from public.audit_events where entity_id = v_inv.id and action = 'invoice_rejected') = 1, 'ok');
  perform pg_temp.chk('S4 foundation X is frozen', (select status from public.foundations where id = v_x) = 'frozen', (select status from public.foundations where id = v_x));
  perform pg_temp.chk('S4 audit_events foundation_frozen written once',
    (select count(*) from public.audit_events where entity = 'foundation' and entity_id = v_x and action = 'foundation_frozen') = 1, 'ok');

  -- Tranches: released stay released, everything else broken
  foreach v_id in array array[v_a1, v_a2, v_b1, v_c1, v_e1] loop
    select array_agg(state order by "index") into v_st from public.tranches where donation_id = v_id;
    perform pg_temp.chk('S4 donation ' || left(v_id::text, 4) || ': tranches 1-2 released, 3-4 broken', v_st = array['released','released','broken','broken'], v_st::text);
  end loop;
  select array_agg(state order by "index") into v_st from public.tranches where donation_id = v_f1;
  perform pg_temp.chk('S4 F (initial never released): all 4 tranches broken', v_st = array['broken','broken','broken','broken'], v_st::text);
  select array_agg(state order by "index") into v_st from public.tranches where donation_id = v_z;
  perform pg_temp.chk('S4 completed donation Z: 4 tranches still released', v_st = array['released','released','released','released'], v_st::text);
  perform pg_temp.chk('S4 no tranche left in_review/in_custody on foundation X',
    (select count(*) from public.tranches t join public.donations d on d.id = t.donation_id where d.foundation_id = v_x and t.state in ('in_review','in_custody')) = 0, 'ok');

  -- Donations
  select count(*), coalesce(sum(total_amount), 0) into v_n, v_sum from public.donations where foundation_id = v_x and status = 'refunded';
  perform pg_temp.chk('S4 6 donations refunded on X (A1, A2, B1, C1, E1, F1), total 980.50', v_n = 6 and v_sum = 980.50, format('refunded=%s sum=%s', v_n, v_sum));
  perform pg_temp.chk('S4 amount_refunded = total_amount for each refunded donation',
    (select count(*) from public.donations where foundation_id = v_x and status = 'refunded' and amount_refunded = total_amount) = 6, 'ok');
  perform pg_temp.chk('S4 completed donation Z untouched (completed, amount_released 100, amount_refunded 0, no refund row)',
    (select status from public.donations where id = v_z) = 'completed' and (select amount_refunded from public.donations where id = v_z) = 0
      and not exists (select 1 from public.refunds where donation_id = v_z), 'ok');

  -- Balances: EVERY donor gets exactly 100% of what they contributed
  perform pg_temp.chk('S4 donor A (2 donations 100 + 60): balance back to 500 (starting balance)', pg_temp.bal(v_a) = 500, 'balance=' || pg_temp.bal(v_a));
  perform pg_temp.chk('S4 donor B (250 on X, 80 on Y): 1000 - 80 = 920 (Y keeps its 80, X donation refunded)', pg_temp.bal(v_b) = 920, 'balance=' || pg_temp.bal(v_b));
  perform pg_temp.chk('S4 donor C (40.50, part already released): balance back to 100', pg_temp.bal(v_c) = 100, 'balance=' || pg_temp.bal(v_c));
  perform pg_temp.chk('S4 donor F (initial never released, 30): balance back to 100', pg_temp.bal(v_f) = 100, 'balance=' || pg_temp.bal(v_f));
  perform pg_temp.chk('S4 donor D (completed donation Z): balance unchanged 100 (nothing refunded)', pg_temp.bal(v_d) = 100, 'balance=' || pg_temp.bal(v_d));
  perform pg_temp.chk('S4 CAP: donor E was at 10000 and the refund of 500 is NOT blocked: balance = 10500',
    pg_temp.bal(v_e) = 10500, 'balance=' || pg_temp.bal(v_e));
  v_e2 := pg_temp.err(format('select public.wallet_top_up(%L, 1)', v_e));
  perform pg_temp.chk('S4 CAP: E above 10000 can still not top up (cap_exceeded), but keeps the refund', v_e2 = 'cap_exceeded' and pg_temp.bal(v_e) = 10500, v_e2);

  -- refunds / audit
  perform pg_temp.chk('S4 6 refunds rows, one per refunded donation, amount = donation total, linked to the rejected invoice',
    (select count(*) from public.refunds r join public.donations d on d.id = r.donation_id where d.foundation_id = v_x) = 6
      and (select count(*) from public.refunds r join public.donations d on d.id = r.donation_id
            where d.foundation_id = v_x and r.amount = d.total_amount and r.invoice_id = v_inv.id and r.reason like 'Gasto rechazado%') = 6, 'ok');
  perform pg_temp.chk('S4 6 audit_events donation_refunded (payload keeps what the platform absorbed)',
    (select count(*) from public.audit_events a join public.donations d on d.id = a.entity_id
      where a.action = 'donation_refunded' and d.foundation_id = v_x) = 6
    and (select (payload ->> 'absorbed_by_platform')::numeric from public.audit_events where action = 'donation_refunded' and entity_id = v_c1) = 4.05 + 12.15,
    coalesce((select payload::text from public.audit_events where action = 'donation_refunded' and entity_id = v_c1), 'none'));
  perform pg_temp.info('S4 platform absorbs what X already received for refunded donations',
    format('released to X on refunded donations = %s', (select sum(amount_released) from public.donations where foundation_id = v_x and status = 'refunded')));
  select total_received into v_recv from public.foundations where id = v_x;
  perform pg_temp.chk('S4 foundation.total_received unchanged by the refund (on-chain money cannot be clawed back)', v_recv = v_x_recv, format('before=%s after=%s', v_x_recv, v_recv));

  -- Statistics / what the donor sees
  select * into v_stats from public.foundation_stats where foundation_id = v_x;
  perform pg_temp.chk('S4 foundation_stats X: custody_total 0, next_tranche_index NULL, affected_donors 0',
    v_stats.custody_total = 0 and v_stats.next_tranche_index is null and v_stats.affected_donors = 0,
    format('custody=%s next=%s affected=%s', v_stats.custody_total, v_stats.next_tranche_index, v_stats.affected_donors));
  select to_jsonb(d) || jsonb_build_object('tranches', (select jsonb_agg(to_jsonb(t) order by t."index") from public.tranches t where t.donation_id = d.id),
                                           'refunds', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.refunds r where r.donation_id = d.id))
    into v_json from public.donations d where d.id = v_a1;
  perform pg_temp.chk('S4 my-donations payload for A1: status refunded, refund 100, 2 broken tranches (MisRastros shows "Sello roto · $100.00 devueltos")',
    v_json ->> 'status' = 'refunded' and (v_json -> 'refunds' -> 0 ->> 'amount')::numeric = 100
      and (select count(*) from jsonb_array_elements(v_json -> 'tranches') t where t ->> 'state' = 'broken') = 2, left(v_json::text, 160));

  -- Unrelated foundation Y untouched
  perform pg_temp.chk('S4 foundation Y still active; donation BY partially_released with tranche states unchanged; 80 still debited',
    (select status from public.foundations where id = v_y) = 'active'
      and (select status from public.donations where id = v_by) = 'partially_released'
      and (select array_agg(state order by "index") from public.tranches where donation_id = v_by) = array['released','in_custody','in_custody','in_custody']
      and not exists (select 1 from public.refunds where donation_id = v_by), 'ok');

  -- Retries / double refund ---------------------------------------------------------------------------
  select sum(balance) into v_sum from public.users where id in (v_a, v_b, v_c, v_d, v_e, v_f);
  v_res := public.freeze_foundation_and_refund(v_x, v_inv.id, v_own, 'TEST retry');
  perform pg_temp.chk('S4 retry of freeze_foundation_and_refund refunds nothing (0 refunds, 0 USD)', (v_res ->> 'refunds')::int = 0 and (v_res ->> 'refunded_usd')::numeric = 0, v_res::text);
  perform pg_temp.chk('S4 retry: no balance moved, still 6 refunds rows, still 1 foundation_frozen event',
    (select sum(balance) from public.users where id in (v_a, v_b, v_c, v_d, v_e, v_f)) = v_sum
      and (select count(*) from public.refunds r join public.donations d on d.id = r.donation_id where d.foundation_id = v_x) = 6
      and (select count(*) from public.audit_events where action = 'foundation_frozen' and entity_id = v_x) = 1, 'sum=' || v_sum);
  v_e2 := pg_temp.err(format('select * from public.resolve_spend_verdict(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)', v_inv.id, v_x, 'rejected', '[]', 'again', 'a', 'b', v_own));
  perform pg_temp.chk('S4 retry of the same verdict rejected invoice_not_pending (no second refund path)', v_e2 = 'invoice_not_pending', v_e2);
  v_e2 := pg_temp.err(format('insert into public.refunds (donation_id, amount) values (%L, 1)', v_a1));
  perform pg_temp.chk('S4 DB guarantees one refund per donation (refunds.donation_id unique)', v_e2 like '%duplicate key%', v_e2);
  v_e2 := pg_temp.err(format('select * from public.donate_from_balance(%L, %L, 10)', v_a, v_x));
  perform pg_temp.chk('S4 frozen foundation rejects new donations', v_e2 = 'foundation_suspended', v_e2);
  insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, tranche_index)
  values (v_x, 'TEST-N-06', 'TEST after freeze', 1, 'J-99999900-0', 2) returning * into v_inv;
  v_e2 := pg_temp.err(format('select public.submit_spend_for_review(%L, %L)', v_inv.id, v_x));
  perform pg_temp.chk('S4 frozen foundation cannot submit more spends (foundation_suspended)', v_e2 = 'foundation_suspended', v_e2);
  update public.donations set release_tx_hash = 'TEST-0xH-LATE' where id = v_f1;
  v_e2 := pg_temp.err(format('select * from public.record_initial_release(%L, %L, 3)', v_f1, 'TEST-0xH-LATE'));
  perform pg_temp.chk('S4 a late initial-release finalize cannot resurrect a refunded donation (donation_refunded)',
    v_e2 = 'donation_refunded' and (select status from public.donations where id = v_f1) = 'refunded', v_e2);

  -- In-flight release: verified, hash persisted, NOT yet finalized, then the foundation is frozen ---------------
  v_w1 := pg_temp.donate_rel(v_w, v_wf, 100, 'TEST-0xH-W1');
  insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, tranche_index)
  values (v_wf, 'TEST-W-01', 'TEST inflight', 1, 'J-99999900-0', 2) returning * into v_inv;
  v_n := public.submit_spend_for_review(v_inv.id, v_wf);
  perform public.resolve_spend_verdict(v_inv.id, v_wf, 'verified', v_checks, 'ok', 'a', 'b', v_oww);
  update public.invoices set release_tx_hash = 'TEST-0xTX-INFLIGHT' where id = v_inv.id;
  perform pg_temp.spend(v_wf, v_oww, 3, 'TEST-W-02', 'rejected');   -- freezes W + refunds W1 while the send above is unfinalized
  v_res := public.record_spend_release(v_inv.id, 'TEST-0xTX-INFLIGHT');
  perform pg_temp.chk('S4 in-flight send finalized after the freeze is a no-op: donation stays refunded, total_received untouched',
    (v_res ->> 'released_count')::int = 0 and (select status from public.donations where id = v_w1) = 'refunded'
      and (select total_received from public.foundations where id = v_wf) = 10 and pg_temp.bal(v_w) = 100,
    format('%s total_received=%s balance=%s', v_res, (select total_received from public.foundations where id = v_wf), pg_temp.bal(v_w)));

  -- Report ----------------------------------------------------------------------------------------------
  select count(*) filter (where kind = 'FAIL'), count(*) filter (where kind = 'INFO') into v_fail, v_info from t_res;
  select format(E'TEST_REPORT 03_fraud_refund: %s checks, %s FAILED, %s INFO\n', count(*) filter (where kind <> 'INFO'), v_fail, v_info)
         || string_agg(format('[%s] %s | %s', kind, name, observed), E'\n' order by n)
    into v_report from t_res;
  raise exception E'%', v_report;
end
$test$;
