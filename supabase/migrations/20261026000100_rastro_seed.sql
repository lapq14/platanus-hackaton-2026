-- rastro demo seed. Idempotent and additive: enriches existing foundations (only NULL fields),
-- adds an auditor user, invoices (verified / in_review / rejected with agent_checks), donations with
-- tranches in all four states, one refund on a frozen foundation and audit events.
-- Seeded donations are attached to the two real donor accounts already in `users` (if present) so a
-- logged-in donor sees data in "Mis rastros". Fake hashes are deterministic md5 strings.

-- helper: 5 agent checks { id, label, passed, detail }
create or replace function pg_temp.checks(
  p_rif text, p_amount numeric,
  p_rif_ok boolean, p_name_ok boolean, p_amount_ok boolean, p_dup_ok boolean, p_date_ok boolean
) returns jsonb language sql as $f$
  select jsonb_build_array(
    jsonb_build_object('id', 'rif_exists', 'label', 'RIF del proveedor existe', 'passed', p_rif_ok,
      'detail', case when p_rif_ok then p_rif || ' activo en el registro fiscal.'
                     else p_rif || ' no coincide con el registro fiscal.' end),
    jsonb_build_object('id', 'name_match', 'label', 'Razón social coincide', 'passed', p_name_ok,
      'detail', case when p_name_ok then 'El nombre en la factura coincide con el RIF.'
                     else 'El nombre en la factura no coincide con el RIF.' end),
    jsonb_build_object('id', 'amount_range', 'label', 'Monto dentro de lo estimado', 'passed', p_amount_ok,
      'detail', case when p_amount_ok then '$' || to_char(p_amount, 'FM999,990.00') || ' ≤ tramo disponible.'
                     else 'El monto supera el tramo disponible.' end),
    jsonb_build_object('id', 'not_duplicate', 'label', 'Factura no duplicada', 'passed', p_dup_ok,
      'detail', case when p_dup_ok then 'El hash no aparece en ningún sello previo.'
                     else 'El hash ya aparece en otro sello.' end),
    jsonb_build_object('id', 'date_concept', 'label', 'Fecha y concepto', 'passed', p_date_ok,
      'detail', case when p_date_ok then 'Fecha y concepto coherentes con el gasto.'
                     else 'Revisión humana sugerida: fecha fuera del período habitual.' end)
  )
$f$;

-- 1. Foundation metadata (only fills NULL fields) -----------------------------------------------
with numbered as (
  select id, name, category,
         row_number() over (order by created_at, name) as n,
         regexp_replace(translate(lower(name), 'áéíóúñü', 'aeiounu'), '[^a-z0-9]', '', 'g') as slug
  from public.foundations
),
cities as (select array['Caracas', 'Maracaibo', 'Valencia', 'Barquisimeto', 'Mérida', 'Puerto Ordaz'] as c)
update public.foundations f set
  rif = coalesce(f.rif, 'J-' || lpad((30000000 + n.n)::text, 8, '0') || '-' || (n.n % 10)::text),
  country = coalesce(f.country, 'Venezuela'),
  city = coalesce(f.city, (select c[1 + (n.n % 6)::int] from cities)),
  official_email = coalesce(f.official_email, 'contacto@' || n.slug || '.org'),
  instagram_url = coalesce(f.instagram_url, case when n.n % 5 <> 0 then 'https://instagram.com/' || n.slug end),
  tiktok_url = coalesce(f.tiktok_url, case when n.n % 2 = 0 then 'https://tiktok.com/@' || n.slug end),
  x_url = coalesce(f.x_url, case when n.n % 3 <> 1 then 'https://x.com/' || n.slug end),
  contract_address = coalesce(f.contract_address, '0x' || substr(md5(n.slug), 1, 32) || substr(md5(n.slug || 'c'), 1, 8)),
  description = coalesce(nullif(f.description, ''),
    f.name || ' trabaja en ' || lower(coalesce(f.category, 'causas sociales')) ||
    '. Cada gasto se sella con factura y RIF del proveedor antes de liberar el siguiente tramo.')
from numbered n
where n.id = f.id;

-- 2. Auditor user --------------------------------------------------------------------------------
insert into public.users (wallet_address, email, role)
values ('0x' || md5('rastro-auditor') || substr(md5('rastro-auditor-2'), 1, 8), 'auditor@rastro.demo', 'auditor')
on conflict (wallet_address) do nothing;

-- 3. Invoices ------------------------------------------------------------------------------------
with auditor as (select id from public.users where role = 'auditor' order by created_at limit 1),
seed(fname, num, concept, amount, rif, tr, status, rif_ok, name_ok, amount_ok, dup_ok, date_ok, analyzing, days_ago, note) as (
  values
  ('Cruz Roja Venezolana', 'N° 000101', 'Medicinas', 980.00, 'J-31234567-8', 2, 'verified', true, true, true, true, true, false, 40, null),
  ('Cruz Roja Venezolana', 'N° 000102', 'Insumos médicos', 640.00, 'J-30987654-3', 2, 'verified', true, true, true, true, true, false, 33, null),
  ('Cruz Roja Venezolana', 'N° 000103', 'Material quirúrgico', 1250.00, 'J-31234567-8', 3, 'verified', true, true, true, true, true, false, 25, null),
  ('Cruz Roja Venezolana', 'N° 000104', 'Equipos de diagnóstico', 2100.00, 'J-29876543-1', 3, 'verified', true, true, true, true, false, false, 18, 'Aprobada tras revisión humana: fecha confirmada con el proveedor.'),
  ('Cruz Roja Venezolana', 'N° 000105', 'Transporte de insumos', 180.00, 'J-30111222-5', 4, 'verified', true, true, true, true, true, false, 10, null),
  ('Cruz Roja Venezolana', 'N° 000106', 'Medicinas oncológicas', 1050.00, 'J-31234567-8', 3, 'in_review', true, true, true, true, false, false, 1, null),
  ('Sociedad Anticancerosa de Venezuela', 'N° 000201', 'Medicinas', 980.00, 'J-30555666-7', 2, 'verified', true, true, true, true, true, false, 20, null),
  ('Sociedad Anticancerosa de Venezuela', 'N° 000202', 'Transporte de insumos', 180.00, 'J-30111222-5', 2, 'verified', true, true, true, true, true, false, 15, null),
  ('Sociedad Anticancerosa de Venezuela', 'N° 000203', 'Equipos de laboratorio', 2300.00, 'J-29000111-9', 2, 'verified', true, true, true, true, true, false, 8, null),
  ('Sociedad Anticancerosa de Venezuela', 'N° 000204', 'Insumos médicos', 1050.00, 'J-30555666-7', 3, 'in_review', true, true, true, true, false, false, 1, null),
  ('Fe y Alegría Venezuela', 'N° 000301', 'Útiles escolares', 320.00, 'J-30222333-4', 2, 'verified', true, true, true, true, true, false, 12, null),
  ('Fe y Alegría Venezuela', 'N° 000302', 'Mobiliario escolar', 870.00, 'J-30444555-6', 3, 'verified', true, true, true, true, true, false, 6, null),
  ('Fe y Alegría Venezuela', 'N° 000303', 'Material didáctico', 450.00, 'J-30222333-4', 3, 'in_review', true, true, true, true, true, true, 0, null),
  ('Hogar Bambi', 'N° 000401', 'Alimentos', 270.00, 'J-30777888-0', 2, 'in_review', false, false, true, true, true, false, 2, null),
  ('Fundación Vida Plena', 'N° 000001', 'Medicamentos', 410.00, 'J-30666777-2', 2, 'verified', true, true, true, true, true, false, 60, null),
  ('Fundación Vida Plena', 'N° 000002', 'Alimentos', 270.00, 'J-30888999-1', 2, 'rejected', false, false, true, true, true, false, 5, 'El RIF del proveedor no coincide con el registro fiscal.'),
  ('Educa Venezuela', 'N° 000501', 'Útiles escolares', 320.00, 'J-30222333-4', 2, 'verified', true, true, true, true, true, false, 30, null),
  ('Educa Venezuela', 'N° 000502', 'Libros de texto', 540.00, 'J-30333444-8', 3, 'verified', true, true, true, true, true, false, 14, null),
  ('Fundación Alimenta Caracas', 'N° 000601', 'Alimentos secos', 700.00, 'J-30121212-6', 2, 'verified', true, true, true, true, true, false, 25, null),
  ('Fundación Alimenta Caracas', 'N° 000602', 'Verduras y frutas', 350.00, 'J-30343434-2', 3, 'verified', true, true, true, true, true, false, 11, null),
  ('Fundación Alimenta Caracas', 'N° 000603', 'Transporte de alimentos', 150.00, 'J-30111222-5', 4, 'verified', true, true, true, true, true, false, 4, null)
)
insert into public.invoices
  (foundation_id, number, concept, amount, supplier_rif, tranche_index, file_hash, file_hashes, status,
   agent_checks, review_note, reviewer_id, uploaded_at, reviewed_at)
select f.id, s.num, s.concept, s.amount, s.rif, s.tr,
       '0x' || md5(f.id::text || s.num) || md5(s.num || 'hash'),
       array['0x' || md5(f.id::text || s.num) || md5(s.num || 'hash')],
       s.status,
       case when s.analyzing then '[]'::jsonb
            else pg_temp.checks(s.rif, s.amount, s.rif_ok, s.name_ok, s.amount_ok, s.dup_ok, s.date_ok) end,
       s.note,
       case when s.status = 'in_review' then null else (select id from auditor) end,
       now() - make_interval(days => s.days_ago),
       case when s.status = 'in_review' then null else now() - make_interval(days => greatest(s.days_ago - 1, 0)) end
from seed s
join public.foundations f on f.name = s.fname
on conflict (foundation_id, number) do nothing;

-- 4. Donations + tranches ---------------------------------------------------------------------------
create or replace function pg_temp.seed_donation(
  p_donor uuid, p_foundation text, p_total numeric, p_states text[], p_days int
) returns uuid language plpgsql as $f$
declare
  v_f public.foundations;
  v_id uuid;
  v_initial numeric;
  v_each numeric;
  v_amounts numeric[];
  v_released numeric := 0;
  i int;
begin
  select * into v_f from public.foundations where name = p_foundation;
  v_initial := round(p_total * v_f.payout_percentage / 100, 2);
  v_each := round((p_total - v_initial) / 3, 2);
  v_amounts := array[v_initial, v_each, v_each, p_total - v_initial - 2 * v_each];
  insert into public.donations (donor_id, foundation_id, total_amount, currency, status, initial_pct, created_at)
  values (p_donor, v_f.id, p_total, 'USD', 'in_escrow', v_f.payout_percentage, now() - make_interval(days => p_days))
  returning id into v_id;
  for i in 1..4 loop
    insert into public.tranches (donation_id, "index", amount, state, tx_hash, released_at)
    values (v_id, i, v_amounts[i], p_states[i],
            case when p_states[i] = 'released' then '0x' || md5(v_id::text || i::text) || md5(i::text || v_id::text) end,
            case when p_states[i] = 'released' then now() - make_interval(days => greatest(p_days - i, 0)) end);
    if p_states[i] = 'released' then v_released := v_released + v_amounts[i]; end if;
  end loop;
  update public.donations set
    amount_released = v_released,
    release_tx_hash = (select tx_hash from public.tranches where donation_id = v_id and "index" = 1),
    status = case when p_states[1] <> 'released' then 'in_escrow'
                  when v_released = p_total then 'completed' else 'partially_released' end
  where id = v_id;
  return v_id;
end $f$;

create or replace function pg_temp.link_invoice(p_donation uuid, p_idx int, p_foundation text, p_number text)
returns void language sql as $f$
  update public.tranches t set invoice_id = i.id
  from public.invoices i join public.foundations f on f.id = i.foundation_id
  where t.donation_id = p_donation and t."index" = p_idx and f.name = p_foundation and i.number = p_number
$f$;

do $$
declare
  v_a uuid := (select id from public.users where email = 'dibzz456@gmail.com');
  v_b uuid := (select id from public.users where email = 'luispetitqa@gmail.com');
  d uuid;
  inv_bad uuid;
begin
  if v_a is null or v_b is null then return; end if;
  -- idempotency guard: seed donations are the ones created below for these donors on these foundations
  if exists (select 1 from public.donations dd join public.foundations f on f.id = dd.foundation_id
              where dd.donor_id = v_a and f.name = 'Fundación Vida Plena') then return; end if;

  -- A1: in progress, tranche 3 in review
  d := pg_temp.seed_donation(v_a, 'Sociedad Anticancerosa de Venezuela', 50, array['released', 'released', 'in_review', 'in_custody'], 12);
  perform pg_temp.link_invoice(d, 2, 'Sociedad Anticancerosa de Venezuela', 'N° 000201');
  perform pg_temp.link_invoice(d, 3, 'Sociedad Anticancerosa de Venezuela', 'N° 000204');
  -- A2: completed (4 of 4)
  d := pg_temp.seed_donation(v_a, 'Fundación Alimenta Caracas', 25, array['released', 'released', 'released', 'released'], 30);
  perform pg_temp.link_invoice(d, 2, 'Fundación Alimenta Caracas', 'N° 000601');
  perform pg_temp.link_invoice(d, 3, 'Fundación Alimenta Caracas', 'N° 000602');
  perform pg_temp.link_invoice(d, 4, 'Fundación Alimenta Caracas', 'N° 000603');
  -- A3: refunded (broken seal on a now frozen foundation)
  d := pg_temp.seed_donation(v_a, 'Fundación Vida Plena', 30, array['released', 'broken', 'broken', 'broken'], 8);
  perform pg_temp.link_invoice(d, 2, 'Fundación Vida Plena', 'N° 000002');
  select i.id into inv_bad from public.invoices i join public.foundations f on f.id = i.foundation_id
   where f.name = 'Fundación Vida Plena' and i.number = 'N° 000002';
  update public.donations set status = 'refunded',
         amount_refunded = (select sum(amount) from public.tranches where donation_id = d and state = 'broken')
   where id = d;
  insert into public.refunds (donation_id, invoice_id, amount, tx_hash, reason, email_sent_at)
  values (d, inv_bad, (select amount_refunded from public.donations where id = d),
          '0x' || md5('refund' || d::text) || md5(d::text || 'refund'),
          'La factura N° 000002 no coincide con el RIF del proveedor.', now() - interval '5 days');
  -- A4: big donation to Cruz Roja, tranche 3 in review
  d := pg_temp.seed_donation(v_a, 'Cruz Roja Venezolana', 100, array['released', 'released', 'in_review', 'in_custody'], 20);
  perform pg_temp.link_invoice(d, 2, 'Cruz Roja Venezolana', 'N° 000103');
  perform pg_temp.link_invoice(d, 3, 'Cruz Roja Venezolana', 'N° 000106');
  -- B1..B3 for the second donor
  d := pg_temp.seed_donation(v_b, 'Cruz Roja Venezolana', 20, array['released', 'in_custody', 'in_custody', 'in_custody'], 3);
  d := pg_temp.seed_donation(v_b, 'Hogar Bambi', 40, array['released', 'in_review', 'in_custody', 'in_custody'], 6);
  perform pg_temp.link_invoice(d, 2, 'Hogar Bambi', 'N° 000401');
  d := pg_temp.seed_donation(v_b, 'Fe y Alegría Venezuela', 30, array['released', 'released', 'in_review', 'in_custody'], 15);
  perform pg_temp.link_invoice(d, 2, 'Fe y Alegría Venezuela', 'N° 000301');
  perform pg_temp.link_invoice(d, 3, 'Fe y Alegría Venezuela', 'N° 000303');
end $$;

-- 5. Audit events ----------------------------------------------------------------------------------
insert into public.audit_events (actor_id, action, entity, entity_id, tx_hash, payload, created_at)
select (select id from public.users where role = 'auditor' order by created_at limit 1),
       case i.status when 'verified' then 'invoice_verified' else 'invoice_rejected' end,
       'invoice', i.id, '0x' || md5('audit' || i.id::text) || md5(i.id::text || 'audit'),
       jsonb_build_object('number', i.number, 'amount', i.amount), i.reviewed_at
from public.invoices i
where i.status in ('verified', 'rejected')
  and not exists (select 1 from public.audit_events e where e.entity = 'invoice' and e.entity_id = i.id);

insert into public.audit_events (actor_id, action, entity, entity_id, payload)
select (select id from public.users where role = 'auditor' order by created_at limit 1),
       'foundation_frozen', 'foundation', f.id, jsonb_build_object('reason', 'Factura N° 000002 rechazada')
from public.foundations f
where f.name = 'Fundación Vida Plena'
  and not exists (select 1 from public.audit_events e where e.action = 'foundation_frozen' and e.entity_id = f.id);

-- 6. Volume: a demo donor (cannot log in) with larger donations so foundation panels show realistic money ---
insert into public.users (wallet_address, email, role, balance)
values ('0x' || md5('rastro-seed-donor') || substr(md5('rastro-seed-donor-2'), 1, 8), 'donante.demo@rastro.demo', 'donor', 0)
on conflict (wallet_address) do nothing;

do $$
declare
  v_s uuid := (select id from public.users where email = 'donante.demo@rastro.demo');
  d uuid;
begin
  if v_s is null or exists (select 1 from public.donations where donor_id = v_s) then return; end if;
  d := pg_temp.seed_donation(v_s, 'Sociedad Anticancerosa de Venezuela', 4000, array['released', 'released', 'in_review', 'in_custody'], 25);
  perform pg_temp.link_invoice(d, 2, 'Sociedad Anticancerosa de Venezuela', 'N° 000203');
  perform pg_temp.link_invoice(d, 3, 'Sociedad Anticancerosa de Venezuela', 'N° 000204');
  d := pg_temp.seed_donation(v_s, 'Cruz Roja Venezolana', 6000, array['released', 'released', 'in_review', 'in_custody'], 40);
  perform pg_temp.link_invoice(d, 2, 'Cruz Roja Venezolana', 'N° 000104');
  perform pg_temp.link_invoice(d, 3, 'Cruz Roja Venezolana', 'N° 000106');
  d := pg_temp.seed_donation(v_s, 'Fe y Alegría Venezuela', 3000, array['released', 'released', 'in_review', 'in_custody'], 20);
  perform pg_temp.link_invoice(d, 2, 'Fe y Alegría Venezuela', 'N° 000302');
  perform pg_temp.link_invoice(d, 3, 'Fe y Alegría Venezuela', 'N° 000303');
  d := pg_temp.seed_donation(v_s, 'Fundación Alimenta Caracas', 1500, array['released', 'released', 'released', 'in_custody'], 35);
  d := pg_temp.seed_donation(v_s, 'Educa Venezuela', 800, array['released', 'released', 'in_custody', 'in_custody'], 30);
end $$;
