-- Simulated donor balance, migration B: clients can no longer insert users or donations.
-- Apply together with the Edge Function deploy (the old client flow needs these policies).
-- The verifications INSERT policy is intentionally left untouched (known limitation).
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename in ('users', 'donations')
       and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end;
$$;
