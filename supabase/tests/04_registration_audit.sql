-- 04_registration_audit.sql
-- Registration auditor (migration 20261030000000): begin_registration_review / resolve_registration_verdict.
-- Expected behavior:
--   * pending -> active on 'approved' (validated data persisted in foundation_verifications), idempotent: a second
--     call changes nothing and reports changed = false
--   * pending -> rejected on 'rejected' with the reason stored; a later 'approved' call does NOT resurrect it
--   * rejected -> pending through begin_registration_review (reason cleared, corrections applied), then a new verdict
--   * an active foundation is never reopened; a frozen one raises foundation_suspended
--   * resolve_registration_verdict receives the RIF and name the verdict was computed for and, under the row lock,
--     compares them with the current ones: if a concurrent correction changed them it returns
--     {status:'pending', changed:false, reason:'data_changed'} and writes nothing; matching data -> active, and
--     foundations.rif ends equal to foundation_verifications.rif_normalized
--   * an approved verdict for a RIF already validated for another foundation is turned into a rejection
--   * 'rejected' is excluded from every status = 'active' rule (donate_from_balance -> foundation_suspended)
--   * the status CHECK accepts 'rejected' and still refuses unknown values
-- Whole script = one DO block ending in RAISE EXCEPTION, so everything rolls back (zero persistent data).
-- Out of scope: the Anthropic call, the RIF check digit (rif.test.ts), e-mail delivery, storage, Privy auth.
do $test$
declare
  v_u1 uuid; v_u2 uuid; v_u3 uuid; v_u4 uuid; v_donor uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_res jsonb; v_s text; v_r text; v_n int; v_e text;
  v_checks jsonb := '[{"id":"document_is_rif","label":"x","passed":true,"detail":"ok"}]'::jsonb;
  v_report text; v_fail int; v_info int;
begin
  create temp table t_res (n serial, kind text, name text, observed text);
  execute $f$create function pg_temp.chk(p_name text, p_ok boolean, p_obs text) returns void language sql as
    $b$ insert into pg_temp.t_res(kind, name, observed) values (case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, p_name, p_obs) $b$$f$;
  execute $f$create function pg_temp.err(q text) returns text language plpgsql as
    $b$ begin execute q; return 'NO_ERROR'; exception when others then return sqlerrm; end $b$$f$;
  execute $f$create function pg_temp.st(p uuid) returns text language sql as
    $b$ select status from public.foundations where id = p $b$$f$;

  -- Fixtures -----------------------------------------------------------------------------------------
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-R1', 'ong', 'TEST-privy-r1') returning id into v_u1;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-R2', 'ong', 'TEST-privy-r2') returning id into v_u2;
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-R3', 'ong', 'TEST-privy-r3') returning id into v_u3;
  insert into public.users (wallet_address, role, privy_id, balance) values ('TEST-WALLET-RD', 'donor', 'TEST-privy-rd', 100) returning id into v_donor;
  insert into public.foundations (name, wallet_address, status, rif, user_id) values ('TEST-Reg A', 'TEST-WALLET-FA', 'pending', 'J-99999301-0', v_u1) returning id into v_a;
  insert into public.foundations (name, wallet_address, status, rif, user_id) values ('TEST-Reg B', 'TEST-WALLET-FB', 'pending', 'J-99999302-0', v_u2) returning id into v_b;
  insert into public.foundations (name, wallet_address, status, rif, user_id) values ('TEST-Reg C', 'TEST-WALLET-FC', 'pending', 'J-99999303-0', v_u3) returning id into v_c;

  -- 1. pending -> active, data persisted ------------------------------------------------------------
  perform pg_temp.chk('new foundation starts pending', pg_temp.st(v_a) = 'pending', pg_temp.st(v_a));
  v_res := public.resolve_registration_verdict(v_a, 'approved', v_checks, null, 'J-99999301-0', 'TEST REG A C.A.', 'Persona jurídica', 'Av. Test', 'TEST/a.pdf', 'test-model', 'TEST-Reg A');
  perform pg_temp.chk('approved: status active + changed', pg_temp.st(v_a) = 'active' and (v_res ->> 'changed')::boolean and v_res ->> 'status' = 'active', v_res::text);
  perform pg_temp.chk('approved: validated data persisted',
    (select rif_normalized = 'J-99999301-0' and legal_name = 'TEST REG A C.A.' and taxpayer_type = 'Persona jurídica'
            and fiscal_address = 'Av. Test' and document_path = 'TEST/a.pdf' and verdict = 'approved'
            and model = 'test-model' and verified_at is not null and attempts = 1
       from public.foundation_verifications where foundation_id = v_a), 'row');
  perform pg_temp.chk('approved: audit event written',
    exists (select 1 from public.audit_events where entity = 'foundation' and entity_id = v_a and action = 'registration_approved'), 'audit');

  -- 2. idempotency ----------------------------------------------------------------------------------
  v_res := public.resolve_registration_verdict(v_a, 'approved', v_checks, null, 'J-99999301-0', 'OTHER NAME', null, null, 'TEST/other.pdf', 'm2', 'TEST-Reg A');
  perform pg_temp.chk('second call is a no-op (changed = false, still active)', pg_temp.st(v_a) = 'active' and not (v_res ->> 'changed')::boolean, v_res::text);
  perform pg_temp.chk('second call did not overwrite the stored data',
    (select legal_name = 'TEST REG A C.A.' and attempts = 1 from public.foundation_verifications where foundation_id = v_a), 'row');
  v_res := public.resolve_registration_verdict(v_a, 'rejected', v_checks, 'late rejection', null, null, null, null, null, null, 'TEST-Reg A');
  perform pg_temp.chk('an active foundation cannot be rejected afterwards', pg_temp.st(v_a) = 'active' and not (v_res ->> 'changed')::boolean, v_res::text);
  perform pg_temp.chk('begin_registration_review never reopens an active foundation', public.begin_registration_review(v_a, 'J-99999399-0', 'TEST-New') = 'active'
    and (select rif = 'J-99999301-0' and name = 'TEST-Reg A' from public.foundations where id = v_a), pg_temp.st(v_a));

  -- 3. pending -> rejected, reason stored; not resurrected -------------------------------------------
  v_res := public.resolve_registration_verdict(v_b, 'rejected', v_checks, 'El RIF no coincide.', 'J-99999302-0', null, null, null, 'TEST/b.pdf', null, 'TEST-Reg B');
  perform pg_temp.chk('rejected: status rejected + reason stored',
    pg_temp.st(v_b) = 'rejected' and (select rejection_reason from public.foundations where id = v_b) = 'El RIF no coincide.' and (v_res ->> 'changed')::boolean, v_res::text);
  perform pg_temp.chk('rejected: no validated RIF recorded',
    (select rif_normalized is null and verdict = 'rejected' from public.foundation_verifications where foundation_id = v_b), 'row');
  v_res := public.resolve_registration_verdict(v_b, 'approved', v_checks, null, 'J-99999302-0', 'x', null, null, null, 'm', 'TEST-Reg B');
  perform pg_temp.chk('rejected foundation is NOT approved by a stray call (needs a new review)', pg_temp.st(v_b) = 'rejected' and not (v_res ->> 'changed')::boolean, v_res::text);

  -- 4. resubmission: rejected -> pending (corrections) -> verdict ---------------------------------------
  -- The call must run in its own statement: a subquery in the same statement would still see the pre-update snapshot.
  v_s := public.begin_registration_review(v_b, 'J-99999304-0', 'TEST-Reg B2');
  perform pg_temp.chk('begin_registration_review reopens a rejected registration', v_s = 'pending'
    and (select rejection_reason is null and rif = 'J-99999304-0' and name = 'TEST-Reg B2' from public.foundations where id = v_b), pg_temp.st(v_b));
  v_res := public.resolve_registration_verdict(v_b, 'approved', v_checks, null, 'J-99999304-0', 'TEST REG B2', null, null, 'TEST/b2.pdf', 'm', 'TEST-Reg B2');
  perform pg_temp.chk('resubmission can end active', pg_temp.st(v_b) = 'active', v_res::text);
  perform pg_temp.chk('verification row updated in place (attempts = 2)',
    (select attempts = 2 and rif_normalized = 'J-99999304-0' and verdict = 'approved' from public.foundation_verifications where foundation_id = v_b), 'row');

  -- 4b. data changed during the (unlocked) model call -> no transition, stays pending ----------------------------
  insert into public.users (wallet_address, role, privy_id) values ('TEST-WALLET-R4', 'ong', 'TEST-privy-r4') returning id into v_u4;
  insert into public.foundations (name, wallet_address, status, rif, user_id) values ('TEST-Reg D', 'TEST-WALLET-FD', 'pending', 'J-99999305-0', v_u4) returning id into v_d;
  -- The verdict was computed for (J-99999305-0, 'TEST-Reg D'); a concurrent call corrected the RIF meanwhile.
  v_s := public.begin_registration_review(v_d, 'J-99999306-0', null);
  v_res := public.resolve_registration_verdict(v_d, 'approved', v_checks, null, 'J-99999305-0', 'TEST REG D', null, null, 'TEST/d.pdf', 'm', 'TEST-Reg D');
  perform pg_temp.chk('RIF changed meanwhile: approved verdict does not transition (data_changed)',
    pg_temp.st(v_d) = 'pending' and not (v_res ->> 'changed')::boolean and v_res ->> 'reason' = 'data_changed' and v_res ->> 'status' = 'pending', v_res::text);
  perform pg_temp.chk('RIF changed meanwhile: nothing written (no verification row, no audit event, RIF untouched)',
    not exists (select 1 from public.foundation_verifications where foundation_id = v_d)
    and not exists (select 1 from public.audit_events where entity = 'foundation' and entity_id = v_d)
    and (select rif from public.foundations where id = v_d) = 'J-99999306-0', 'state');
  -- Name corrected meanwhile (RIF matches this time).
  v_s := public.begin_registration_review(v_d, null, 'TEST-Reg D2');
  v_res := public.resolve_registration_verdict(v_d, 'approved', v_checks, null, 'J-99999306-0', 'TEST REG D', null, null, 'TEST/d.pdf', 'm', 'TEST-Reg D');
  perform pg_temp.chk('name changed meanwhile: approved verdict does not transition (data_changed)',
    pg_temp.st(v_d) = 'pending' and not (v_res ->> 'changed')::boolean and v_res ->> 'reason' = 'data_changed', v_res::text);
  v_res := public.resolve_registration_verdict(v_d, 'rejected', v_checks, 'x', 'J-99999306-0', null, null, null, null, null, 'TEST-Reg D');
  perform pg_temp.chk('name changed meanwhile: rejected verdict does not transition either',
    pg_temp.st(v_d) = 'pending' and not (v_res ->> 'changed')::boolean and v_res ->> 'reason' = 'data_changed'
    and not exists (select 1 from public.foundation_verifications where foundation_id = v_d), v_res::text);
  -- Matching data (name differs only in case / whitespace) -> active; foundations.rif = validated rif_normalized.
  v_res := public.resolve_registration_verdict(v_d, 'approved', v_checks, null, 'J-99999306-0', 'TEST REG D2', null, null, 'TEST/d.pdf', 'm', '  test-reg   d2 ');
  perform pg_temp.chk('matching data: transitions to active', pg_temp.st(v_d) = 'active' and (v_res ->> 'changed')::boolean and v_res ->> 'status' = 'active', v_res::text);
  perform pg_temp.chk('approved: foundations.rif equals the validated rif_normalized',
    (select f.rif = v.rif_normalized and f.rif = 'J-99999306-0' from public.foundations f join public.foundation_verifications v on v.foundation_id = f.id where f.id = v_d), 'rif');

  -- 5. duplicate validated RIF -> rejection ------------------------------------------------------------
  -- Foundation A holds the approved RIF J-99999301-0; C claims the same RIF (the unique index on foundations.rif
  -- normally prevents this, so simulate the validated-RIF collision by pointing C's verdict at A's RIF).
  -- Free A's declared RIF (A keeps its approved verification for J-99999301-0) so C can declare it.
  update public.foundations set rif = 'J-99999398-0' where id = v_a;
  update public.foundations set rif = 'J-99999301-0' where id = v_c;
  v_res := public.resolve_registration_verdict(v_c, 'approved', v_checks, null, 'J-99999301-0', 'TEST REG C', null, null, 'TEST/c.pdf', 'm', 'TEST-Reg C');
  perform pg_temp.chk('duplicate RIF: approved verdict becomes rejected', pg_temp.st(v_c) = 'rejected' and v_res ->> 'status' = 'rejected', v_res::text);
  perform pg_temp.chk('duplicate RIF: reason is the duplicate message',
    (select rejection_reason from public.foundations where id = v_c) ilike '%ya está registrado%', 'reason');
  perform pg_temp.chk('duplicate RIF: no validated RIF stored for C',
    (select rif_normalized is null from public.foundation_verifications where foundation_id = v_c), 'row');
  v_s := pg_temp.err($q$insert into public.foundation_verifications (foundation_id, rif_normalized, verdict)
       select id, 'J-99999301-0', 'approved' from public.foundations where name = 'TEST-Reg C'
       on conflict (foundation_id) do update set rif_normalized = excluded.rif_normalized, verdict = excluded.verdict$q$);
  perform pg_temp.chk('unique index: one approved verification per RIF', v_s ilike '%foundation_verifications_rif_approved_key%', v_s);

  -- 6. frozen / unknown / invalid ---------------------------------------------------------------------
  update public.foundations set status = 'frozen' where id = v_c;
  v_e := pg_temp.err(format($q$select public.begin_registration_review(%L)$q$, v_c));
  perform pg_temp.chk('frozen foundation cannot be reopened', v_e = 'foundation_suspended', v_e);
  v_e := pg_temp.err(format($q$select public.resolve_registration_verdict(%L, 'maybe', '[]'::jsonb, null, null, null, null, null, null, null, null)$q$, v_c));
  perform pg_temp.chk('invalid verdict value raises', v_e = 'invalid_verdict', v_e);
  v_e := pg_temp.err($q$select public.resolve_registration_verdict(gen_random_uuid(), 'approved', '[]'::jsonb, null, null, null, null, null, null, null, null)$q$);
  perform pg_temp.chk('unknown foundation raises', v_e = 'foundation_not_found', v_e);

  -- 7. 'rejected' stays excluded from every status = 'active' rule ----------------------------------------
  update public.foundations set status = 'rejected' where id = v_c;
  v_e := pg_temp.err(format($q$select public.donate_from_balance(%L, %L, 10)$q$, v_donor, v_c));
  perform pg_temp.chk('donating to a rejected foundation is refused', v_e = 'foundation_suspended', v_e);
  v_e := pg_temp.err($q$update public.foundations set status = 'bogus' where name = 'TEST-Reg C'$q$);
  perform pg_temp.chk('status CHECK still refuses unknown values', v_e ilike '%foundations_status_check%', v_e);

  -- 8. client roles cannot touch the new table or functions ----------------------------------------------
  perform pg_temp.chk('anon has no privileges on foundation_verifications', not has_table_privilege('anon', 'public.foundation_verifications', 'select')
    and not has_table_privilege('anon', 'public.foundation_verifications', 'insert'), 'privileges');
  perform pg_temp.chk('anon cannot execute resolve_registration_verdict', not has_function_privilege('anon',
    'public.resolve_registration_verdict(uuid, text, jsonb, text, text, text, text, text, text, text, text)', 'execute'), 'privileges');
  perform pg_temp.chk('authenticated cannot execute begin_registration_review', not has_function_privilege('authenticated',
    'public.begin_registration_review(uuid, text, text)', 'execute'), 'privileges');

  -- Report -------------------------------------------------------------------------------------------
  select count(*) filter (where kind = 'FAIL'), count(*) filter (where kind = 'INFO'),
         string_agg('[' || kind || '] ' || name || ' => ' || observed, E'\n' order by n)
    into v_fail, v_info, v_report from t_res;
  raise exception E'TEST_REPORT fails=% info=%\n%', v_fail, v_info, v_report;
end
$test$;
