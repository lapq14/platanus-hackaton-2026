-- 02_timeline_progression.sql
-- Scenario 3: timeline progression with MULTIPLE verified spends.
-- Flow under test (mirrors verify-spend): submit_spend_for_review (tranche -> in_review)
--   -> resolve_spend_verdict('verified') -> [claim + on-chain send + persist hash = simulated by setting
--   invoices.release_tx_hash] -> record_spend_release (tranche -> released, totals, donation status).
-- Interpretation: spend k pays tranche k (tranche 1 is the automatic initial release) of EVERY open donation of
-- the foundation whose previous tranche is released (see migration 20261028000000).
-- Whole script = one DO block ending in RAISE EXCEPTION, so everything rolls back.
-- Out of scope: the Anthropic model call, storage documents, Privy auth, on-chain transfers.
do $test$
declare
  v_donor uuid; v_donor2 uuid; v_owner uuid; v_owner2 uuid; v_f uuid; v_g uuid;
  v_d public.donations; v_d2 public.donations; v_d3 public.donations; v_inv public.invoices; v_inv2 public.invoices;
  v_checks jsonb := '[{"id":"origin_account_owned","label":"x","passed":true,"detail":"ok"},{"id":"rif_exists","label":"y","passed":true,"detail":"ok"}]'::jsonb;
  v_k int; v_states text[]; v_tinv uuid; v_don public.donations; v_recv numeric; v_rep int; v_bal numeric;
  v_stats record; v_line text; v_n int; v_e text; v_hash text; v_res jsonb; v_json jsonb; v_tx text;
  v_report text; v_fail int; v_info int;
begin
  create temp table t_res (n serial, kind text, name text, observed text);
  execute $f$create function pg_temp.chk(p_name text, p_ok boolean, p_obs text) returns void language sql as
    $b$ insert into pg_temp.t_res(kind, name, observed) values (case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, p_name, p_obs) $b$$f$;
  execute $f$create function pg_temp.info(p_name text, p_obs text) returns void language sql as
    $b$ insert into pg_temp.t_res(kind, name, observed) values ('INFO', p_name, p_obs) $b$$f$;
  execute $f$create function pg_temp.err(q text) returns text language plpgsql as
    $b$ begin execute q; return 'NO_ERROR'; exception when others then return sqlerrm; end $b$$f$;
  -- Mirrors statusLine() in web/src/pages/MisRastros.tsx for one donation row.
  execute $f$create function pg_temp.status_line(p_donation uuid) returns text language plpgsql as
    $b$ declare v_st text; v_tot int; v_p record; v_ref numeric;
    begin
      select status into v_st from public.donations where id = p_donation;
      if v_st = 'refunded' or exists (select 1 from public.tranches where donation_id = p_donation and state = 'broken') then
        select coalesce((select amount from public.refunds where donation_id = p_donation), 0) into v_ref;
        return format('Sello roto · %s devueltos', v_ref);
      end if;
      select "index", state into v_p from public.tranches where donation_id = p_donation and state <> 'released' order by "index" limit 1;
      select count(*) into v_tot from public.tranches where donation_id = p_donation;
      if v_p is null then return format('Rastro completo · %s de %s', v_tot, v_tot); end if;
      return format('Tramo %s %s', v_p."index", case when v_p.state = 'in_review' then 'en revisión' else 'en custodia' end);
    end $b$$f$;
  -- Simulates the edge flow after a verified verdict: persist the send hash on the invoice, then finalize.
  execute $f$create function pg_temp.fake_send(p_invoice uuid, p_hash text) returns jsonb language plpgsql as
    $b$ begin
      update public.invoices set release_tx_hash = p_hash where id = p_invoice and release_tx_hash is null;
      return public.record_spend_release(p_invoice, p_hash);
    end $b$$f$;

  -- Fixtures -------------------------------------------------------------------------------------
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DONOR-S3', 'donor', 'TEST-privy-s3d') returning id into v_donor;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-DONOR-S3B', 'donor', 'TEST-privy-s3e') returning id into v_donor2;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-OWNER-F', 'ong', 'TEST-privy-s3f') returning id into v_owner;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-OWNER-G', 'ong', 'TEST-privy-s3g') returning id into v_owner2;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif, user_id) values ('TEST-Foundation F', 'TEST-WALLET-FF', 0, 'active', 'J-99999101-0', v_owner) returning id into v_f;
  insert into public.foundations (name, wallet_address, reputation_score, status, rif, user_id) values ('TEST-Foundation G', 'TEST-WALLET-FG', 0, 'active', 'J-99999102-0', v_owner2) returning id into v_g;
  perform public.wallet_top_up(v_donor, 1000);
  perform public.wallet_top_up(v_donor2, 1000);

  -- Donation 1 on F: 100 USD, initial 10% released (tranches 10/30/30/30).
  select * into v_d from public.donate_from_balance(v_donor, v_f, 100);
  update public.donations set release_tx_hash = 'TEST-0xHASH-S3A' where id = v_d.id;
  perform public.record_initial_release(v_d.id, 'TEST-0xHASH-S3A', 10);
  select array_agg(state order by "index") into v_states from public.tranches where donation_id = v_d.id;
  perform pg_temp.chk('S3 baseline: tranche 1 released, 2-4 in_custody', v_states = array['released','in_custody','in_custody','in_custody'], v_states::text);
  perform pg_temp.info('S3 baseline donor timeline status line', pg_temp.status_line(v_d.id));

  -- Three consecutive verified spends ---------------------------------------------------------------
  for v_k in 1..3 loop
    insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, tranche_index)
    values (v_f, 'TEST-INV-' || v_k, 'TEST concept ' || v_k, 30, 'J-99999900-0', v_k + 1) returning * into v_inv;

    -- 1) Submission: the targeted tranche becomes in_review and is linked to the invoice
    v_n := public.submit_spend_for_review(v_inv.id, v_f);
    select state, invoice_id into v_e, v_tinv from public.tranches where donation_id = v_d.id and "index" = v_k + 1;
    perform pg_temp.chk(format('S3 spend %s submitted: tranche %s in_review and linked to the invoice (returned %s)', v_k, v_k + 1, v_n),
      v_n = 1 and v_e = 'in_review' and v_tinv = v_inv.id, format('state=%s invoice_id=%s', v_e, v_tinv));
    perform pg_temp.chk(format('S3 spend %s submitted: donor status line "Tramo %s en revisión"', v_k, v_k + 1),
      pg_temp.status_line(v_d.id) = format('Tramo %s en revisión', v_k + 1), pg_temp.status_line(v_d.id));
    perform pg_temp.chk(format('S3 spend %s submitted: submit is idempotent (second call still returns 1)', v_k),
      public.submit_spend_for_review(v_inv.id, v_f) = 1, 'ok');
    select * into v_stats from public.foundation_stats where foundation_id = v_f;
    perform pg_temp.chk(format('S3 spend %s submitted: foundation_stats.next_tranche_index = %s', v_k, v_k + 1),
      v_stats.next_tranche_index = v_k + 1, 'next_tranche_index=' || v_stats.next_tranche_index);

    -- 2) Verdict
    select * into v_inv2 from public.resolve_spend_verdict(v_inv.id, v_f, 'verified', v_checks, 'TEST ok', 'TEST/origin.pdf', 'TEST/dest.pdf', v_owner);
    perform pg_temp.chk(format('S3 spend %s: invoice verified with reviewed_at, checks and doc paths', v_k),
      v_inv2.status = 'verified' and v_inv2.reviewed_at is not null and jsonb_array_length(v_inv2.agent_checks) = 2
        and v_inv2.spend_origin_path = 'TEST/origin.pdf' and v_inv2.spend_destination_path = 'TEST/dest.pdf',
      format('status=%s reviewed_at=%s', v_inv2.status, v_inv2.reviewed_at));
    perform pg_temp.chk(format('S3 spend %s: audit_events row invoice_verified written', v_k),
      (select count(*) from public.audit_events where entity_id = v_inv.id and action = 'invoice_verified' and actor_id = v_owner) = 1, 'ok');
    select state into v_e from public.tranches where donation_id = v_d.id and "index" = v_k + 1;
    perform pg_temp.chk(format('S3 spend %s: verified-but-unsent keeps tranche %s in_review (safe retry state)', v_k, v_k + 1), v_e = 'in_review', 'state=' || v_e);
    v_e := pg_temp.err(format('select public.record_spend_release(%L, %L)', v_inv.id, 'TEST-0xNOT-PERSISTED'));
    perform pg_temp.chk(format('S3 spend %s: finalize before the hash is persisted rejected release_hash_mismatch', v_k), v_e = 'release_hash_mismatch', v_e);

    -- 3) Send + finalize
    select total_received into v_recv from public.foundations where id = v_f;
    v_res := pg_temp.fake_send(v_inv.id, 'TEST-0xSPEND-' || v_k);
    perform pg_temp.chk(format('S3 spend %s: finalizer reports 1 tranche / 30 USD', v_k),
      (v_res ->> 'released_count')::int = 1 and (v_res ->> 'released_usd')::numeric = 30, v_res::text);

    select array_agg(state order by "index") into v_states from public.tranches where donation_id = v_d.id;
    select * into v_don from public.donations where id = v_d.id;
    select invoice_id, tx_hash into v_tinv, v_tx from public.tranches where donation_id = v_d.id and "index" = v_k + 1;
    select total_received, reputation_score into v_recv, v_rep from public.foundations where id = v_f;
    select * into v_stats from public.foundation_stats where foundation_id = v_f;
    v_line := pg_temp.status_line(v_d.id);

    perform pg_temp.chk(format('S3 spend %s: tranche %s released', v_k, v_k + 1),
      (select state from public.tranches where donation_id = v_d.id and "index" = v_k + 1) = 'released', 'tranche states=' || v_states::text);
    perform pg_temp.chk(format('S3 spend %s: tranche %s linked to invoice, tx_hash and released_at set', v_k, v_k + 1),
      v_tinv = v_inv.id and v_tx = 'TEST-0xSPEND-' || v_k
        and (select released_at from public.tranches where donation_id = v_d.id and "index" = v_k + 1) is not null,
      format('invoice_id=%s tx=%s', v_tinv, v_tx));
    perform pg_temp.chk(format('S3 spend %s: donations.amount_released = %s', v_k, 10 + 30 * v_k), v_don.amount_released = 10 + 30 * v_k, 'amount_released=' || v_don.amount_released);
    perform pg_temp.chk(format('S3 spend %s: donation status %s', v_k, case when v_k = 3 then 'completed' else 'partially_released' end),
      v_don.status = case when v_k = 3 then 'completed' else 'partially_released' end, 'status=' || v_don.status);
    perform pg_temp.chk(format('S3 spend %s: foundation.total_received = %s', v_k, 10 + 30 * v_k), v_recv = 10 + 30 * v_k, 'total_received=' || v_recv);
    perform pg_temp.chk(format('S3 spend %s: reputation bumped by 4 per verified invoice = %s', v_k, 4 * v_k), v_rep = 4 * v_k, 'reputation=' || v_rep);
    perform pg_temp.chk(format('S3 spend %s: foundation_stats.sealed_invoices_count = %s', v_k, v_k), v_stats.sealed_invoices_count = v_k, 'sealed_invoices_count=' || v_stats.sealed_invoices_count);
    perform pg_temp.chk(format('S3 spend %s: foundation_stats.released_total = %s', v_k, 10 + 30 * v_k), v_stats.released_total = 10 + 30 * v_k, 'released_total=' || v_stats.released_total);
    perform pg_temp.chk(format('S3 spend %s: foundation_stats.custody_total = %s', v_k, 90 - 30 * v_k), v_stats.custody_total = 90 - 30 * v_k, 'custody_total=' || v_stats.custody_total);
    perform pg_temp.chk(format('S3 spend %s: foundation_stats.next_tranche_index = %s', v_k, case when v_k = 3 then 'NULL' else (v_k + 2)::text end),
      v_stats.next_tranche_index is not distinct from case when v_k = 3 then null else v_k + 2 end, 'next_tranche_index=' || coalesce(v_stats.next_tranche_index::text, 'NULL'));
    perform pg_temp.chk(format('S3 spend %s: donor timeline status line = "%s"', v_k, case when v_k = 3 then 'Rastro completo · 4 de 4' else 'Tramo ' || (v_k + 2) || ' en custodia' end),
      v_line = case when v_k = 3 then 'Rastro completo · 4 de 4' else 'Tramo ' || (v_k + 2) || ' en custodia' end, 'status_line=' || v_line);
    perform pg_temp.chk(format('S3 spend %s: audit_events tranches_released carries the tx hash', v_k),
      (select count(*) from public.audit_events where entity_id = v_inv.id and action = 'tranches_released' and tx_hash = 'TEST-0xSPEND-' || v_k) = 1, 'ok');

    -- Idempotent finalize: nothing counted twice
    v_res := public.record_spend_release(v_inv.id, 'TEST-0xSPEND-' || v_k);
    perform pg_temp.chk(format('S3 spend %s: second finalize is a no-op (0 tranches) and does not double count', v_k),
      (v_res ->> 'released_count')::int = 0
        and (select total_received from public.foundations where id = v_f) = 10 + 30 * v_k
        and (select amount_released from public.donations where id = v_d.id) = 10 + 30 * v_k, v_res::text);
  end loop;

  -- Data served by my-donations (donor scope: donations + tranches + refunds) after the 3 spends
  select to_jsonb(d) || jsonb_build_object('tranches', (select jsonb_agg(to_jsonb(t) order by t."index") from public.tranches t where t.donation_id = d.id),
                                           'refunds', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.refunds r where r.donation_id = d.id))
    into v_json from public.donations d where d.id = v_d.id;
  perform pg_temp.chk('S3 my-donations payload: status completed, 4 released tranches each with tx_hash, no refunds',
    v_json ->> 'status' = 'completed'
      and (select count(*) from jsonb_array_elements(v_json -> 'tranches') t where t ->> 'state' = 'released' and t ->> 'tx_hash' is not null) = 4
      and jsonb_array_length(v_json -> 'refunds') = 0, left(v_json::text, 200));

  -- Guards ------------------------------------------------------------------------------------------
  select * into v_inv from public.invoices where foundation_id = v_f and number = 'TEST-INV-1';
  v_e := pg_temp.err(format('select * from public.resolve_spend_verdict(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)', v_inv.id, v_f, 'verified', '[]', 'again', 'a', 'b', v_owner));
  perform pg_temp.chk('S3 verdict cannot be applied twice (verified -> verified)', v_e = 'invoice_not_pending', v_e);
  v_e := pg_temp.err(format('select * from public.resolve_spend_verdict(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)', v_inv.id, v_f, 'rejected', '[]', 'flip', 'a', 'b', v_owner));
  perform pg_temp.chk('S3 verified invoice cannot be flipped to rejected', v_e = 'invoice_not_pending', v_e);
  perform pg_temp.chk('S3 invoice unchanged and foundation still active after the rejected re-verdict',
    (select status from public.invoices where id = v_inv.id) = 'verified' and (select status from public.foundations where id = v_f) = 'active', 'ok');
  v_e := pg_temp.err(format('select * from public.resolve_spend_verdict(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)', gen_random_uuid(), v_f, 'verified', '[]', 'x', 'a', 'b', v_owner));
  perform pg_temp.chk('S3 unknown invoice rejected invoice_not_found', v_e = 'invoice_not_found', v_e);
  v_e := pg_temp.err(format('select public.submit_spend_for_review(%L, %L)', v_inv.id, v_f));
  perform pg_temp.chk('S3 submit on an already resolved invoice rejected invoice_not_pending', v_e = 'invoice_not_pending', v_e);

  insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, tranche_index)
  values (v_g, 'TEST-INV-G2', 'TEST invalid', 30, 'J-99999900-0', 2) returning * into v_inv;
  v_e := pg_temp.err(format('select * from public.resolve_spend_verdict(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)', v_inv.id, v_g, 'pending', '[]', 'x', 'a', 'b', v_owner2));
  perform pg_temp.chk('S3 status outside verified/rejected rejected invalid_verdict', v_e = 'invalid_verdict', v_e);
  v_e := pg_temp.err(format('select * from public.resolve_spend_verdict(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)', v_inv.id, v_g, 'verified', '{}', 'x', 'a', 'b', v_owner2));
  perform pg_temp.chk('S3 non-array checks rejected invalid_verdict', v_e = 'invalid_verdict', v_e);

  -- Ownership guard (replaces the SQL gap found earlier): invoice of G handled with F's foundation id
  v_e := pg_temp.err(format('select * from public.resolve_spend_verdict(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)', v_inv.id, v_f, 'verified', '[]', 'x', 'a', 'b', v_owner));
  perform pg_temp.chk('S3 resolve_spend_verdict rejects an invoice of ANOTHER foundation (invoice_not_found)', v_e = 'invoice_not_found', v_e);
  v_e := pg_temp.err(format('select public.submit_spend_for_review(%L, %L)', v_inv.id, v_f));
  perform pg_temp.chk('S3 submit_spend_for_review rejects an invoice of ANOTHER foundation (invoice_not_found)', v_e = 'invoice_not_found', v_e);
  perform pg_temp.chk('S3 invoice of G untouched by the cross-foundation attempts', (select status from public.invoices where id = v_inv.id) = 'in_review', 'ok');

  -- Backward compatibility: the legacy 7-arg apply_spend_verdict (deployed verify-spend v1) still resolves invoices
  select * into v_inv2 from public.apply_spend_verdict(v_inv.id, 'verified', v_checks, 'TEST legacy', 'a', 'b', v_owner2);
  perform pg_temp.chk('S3 legacy apply_spend_verdict(7 args) still works (compat until the new verify-spend is deployed)', v_inv2.status = 'verified', 'status=' || v_inv2.status);

  -- Target set is frozen at submission; ineligible donations are untouched ------------------------------
  -- G: donation a (initial released) -> submit spend (tranche 2) -> donation b made + released AFTER submit
  select * into v_d from public.donate_from_balance(v_donor, v_g, 100);
  update public.donations set release_tx_hash = 'TEST-0xHASH-GA' where id = v_d.id;
  perform public.record_initial_release(v_d.id, 'TEST-0xHASH-GA', 10);
  select * into v_d3 from public.donate_from_balance(v_donor2, v_g, 40);       -- never got the initial release (in_escrow)
  insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, tranche_index)
  values (v_g, 'TEST-INV-G3', 'TEST frozen set', 30, 'J-99999900-0', 2) returning * into v_inv;
  v_n := public.submit_spend_for_review(v_inv.id, v_g);
  perform pg_temp.chk('S3 submit targets only donations whose tranche 1 is released (in_escrow donation skipped)',
    v_n = 1 and (select state from public.tranches where donation_id = v_d3.id and "index" = 2) = 'in_custody', format('targets=%s', v_n));
  select * into v_d2 from public.donate_from_balance(v_donor2, v_g, 100);
  update public.donations set release_tx_hash = 'TEST-0xHASH-GB' where id = v_d2.id;
  perform public.record_initial_release(v_d2.id, 'TEST-0xHASH-GB', 10);
  perform public.resolve_spend_verdict(v_inv.id, v_g, 'verified', v_checks, 'TEST ok', 'a', 'b', v_owner2);
  v_res := pg_temp.fake_send(v_inv.id, 'TEST-0xSPEND-G');
  perform pg_temp.chk('S3 donation made after the submission is NOT part of that send (frozen target set)',
    (v_res ->> 'released_count')::int = 1
      and (select state from public.tranches where donation_id = v_d.id and "index" = 2) = 'released'
      and (select state from public.tranches where donation_id = v_d2.id and "index" = 2) = 'in_custody'
      and (select amount_released from public.donations where id = v_d2.id) = 10, v_res::text);

  -- Rejected spend: no longer vacuous (full coverage in 03_fraud_refund.sql)
  insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, tranche_index)
  values (v_g, 'TEST-INV-G4', 'TEST rejected', 30, 'J-99999900-0', 3) returning * into v_inv;
  perform public.resolve_spend_verdict(v_inv.id, v_g, 'rejected', '[{"id":"rif_exists","label":"y","passed":false,"detail":"no"}]'::jsonb, 'TEST rejected', 'a', 'b', v_owner2);
  select array_agg(state order by "index") into v_states from public.tranches where donation_id = v_d.id;
  perform pg_temp.chk('S3 rejected spend: invoice rejected + foundation frozen + unreleased tranches broken',
    (select status from public.invoices where id = v_inv.id) = 'rejected'
      and (select status from public.foundations where id = v_g) = 'frozen'
      and v_states = array['released','released','broken','broken'], format('states=%s', v_states));
  perform pg_temp.chk('S3 rejected spend: donor of D(G) refunded 100 and the status line says so',
    (select status from public.donations where id = v_d.id) = 'refunded' and pg_temp.status_line(v_d.id) = 'Sello roto · 100.00 devueltos', pg_temp.status_line(v_d.id));
  select balance into v_bal from public.users where id = v_donor;
  perform pg_temp.info('S3 donor balance after rejected spend (1000 - 100 - 100 + 100)', 'balance=' || v_bal);

  -- Report ----------------------------------------------------------------------------------------------
  select count(*) filter (where kind = 'FAIL'), count(*) filter (where kind = 'INFO') into v_fail, v_info from t_res;
  select format(E'TEST_REPORT 02_timeline_progression: %s checks, %s FAILED, %s INFO\n', count(*) filter (where kind <> 'INFO'), v_fail, v_info)
         || string_agg(format('[%s] %s | %s', kind, name, observed), E'\n' order by n)
    into v_report from t_res;
  raise exception E'%', v_report;
end
$test$;
