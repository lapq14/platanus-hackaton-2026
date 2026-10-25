-- Untrustworthy foundations drop to level 1.
--
-- A foundation is "inconfiable" (untrustworthy) when it is frozen, has a rejected invoice, or has a verified invoice
-- with observations (an agent check that failed). That rule lives in public.is_untrustworthy and mirrors the
-- reputation_state of the foundation_stats view.
--
-- The invariant: while a foundation is untrustworthy its reputation can never be above 1, so its level is always 1.
--   * sync_payout_percentage (BEFORE INSERT OR UPDATE OF reputation_score, status on foundations) caps the score at 1
--     whenever the foundation is untrustworthy. It also covers later "+4 per verified invoice" writes.
--   * demote_untrustworthy_foundation (AFTER INSERT OR UPDATE OF status, agent_checks on invoices) re-writes the
--     foundation's score the moment an invoice is rejected or flagged, which fires the cap above.
--   * Freezing a foundation (status = 'frozen') is capped by the same trigger.

-- Demo data: Cruz Roja Venezolana had a single flagged invoice. Three more observations make the alert consistent
-- with how the state is calculated (flagged invoices).
insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, status, agent_checks, review_note, file_hash, uploaded_at, reviewed_at)
select f.id, v.number, v.concept, v.amount, v.rif, 'verified', v.checks::jsonb, 'Gasto verificado con observaciones.',
       '0x' || md5(v.number || f.id::text) || md5(f.id::text || v.number),
       now() - (v.days || ' days')::interval, now() - (v.days || ' days')::interval + interval '3 hours'
from public.foundations f
join (values
  ('N° 000107', 'Medicamentos de emergencia', 1380.00, 'J-31234567-8', 40,
   '[{"id":"rif_exists","label":"RIF del proveedor existe","passed":true,"detail":"J-31234567-8 activo en el registro fiscal."},{"id":"name_match","label":"Razón social coincide","passed":false,"detail":"El nombre en la factura no coincide con la razón social del RIF."},{"id":"amount_range","label":"Monto dentro de lo estimado","passed":true,"detail":"Monto dentro del rango."},{"id":"not_duplicate","label":"Factura no duplicada","passed":true,"detail":"Sin duplicados."},{"id":"date_concept","label":"Fecha y concepto","passed":true,"detail":"Coherentes."}]'),
  ('N° 000108', 'Alquiler de ambulancias', 2750.00, 'J-30111222-5', 26,
   '[{"id":"rif_exists","label":"RIF del proveedor existe","passed":true,"detail":"J-30111222-5 activo en el registro fiscal."},{"id":"name_match","label":"Razón social coincide","passed":true,"detail":"Coincide."},{"id":"amount_range","label":"Monto dentro de lo estimado","passed":false,"detail":"El monto supera en más del 60% el promedio de gastos similares."},{"id":"not_duplicate","label":"Factura no duplicada","passed":true,"detail":"Sin duplicados."},{"id":"date_concept","label":"Fecha y concepto","passed":true,"detail":"Coherentes."}]'),
  ('N° 000109', 'Insumos de primeros auxilios', 960.00, 'J-30987654-3', 12,
   '[{"id":"rif_exists","label":"RIF del proveedor existe","passed":true,"detail":"J-30987654-3 activo en el registro fiscal."},{"id":"name_match","label":"Razón social coincide","passed":true,"detail":"Coincide."},{"id":"amount_range","label":"Monto dentro de lo estimado","passed":true,"detail":"Monto dentro del rango."},{"id":"not_duplicate","label":"Factura no duplicada","passed":false,"detail":"El documento es muy similar a una factura enviada antes."},{"id":"date_concept","label":"Fecha y concepto","passed":false,"detail":"La fecha queda fuera del período habitual."}]')
) as v (number, concept, amount, rif, days, checks) on true
where f.name = 'Cruz Roja Venezolana'
on conflict (foundation_id, number) do nothing;

create or replace function public.is_untrustworthy(p_foundation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.foundations f where f.id = p_foundation_id and f.status = 'frozen')
      or exists (select 1 from public.invoices i where i.foundation_id = p_foundation_id and i.status = 'rejected')
      or exists (select 1 from public.invoices i
                  where i.foundation_id = p_foundation_id and i.status = 'verified'
                    and exists (select 1 from jsonb_array_elements(i.agent_checks) c where (c ->> 'passed')::boolean is false))
$$;

create or replace function public.sync_payout_percentage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'frozen' or (tg_op = 'UPDATE' and public.is_untrustworthy(new.id)) then
    new.reputation_score := least(new.reputation_score, 1);
  end if;
  new.level := public.level_for_reputation(new.reputation_score);
  new.payout_percentage := public.payout_for_reputation(new.reputation_score);
  return new;
end $$;

drop trigger if exists foundations_sync_payout on public.foundations;
create trigger foundations_sync_payout
  before insert or update of reputation_score, status on public.foundations
  for each row execute function public.sync_payout_percentage();

create or replace function public.demote_untrustworthy_foundation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'rejected'
     or (new.status = 'verified'
         and exists (select 1 from jsonb_array_elements(new.agent_checks) c where (c ->> 'passed')::boolean is false)) then
    update public.foundations set reputation_score = reputation_score where id = new.foundation_id;
  end if;
  return null;
end $$;

drop trigger if exists invoices_demote_untrustworthy on public.invoices;
create trigger invoices_demote_untrustworthy
  after insert or update of status, agent_checks on public.invoices
  for each row execute function public.demote_untrustworthy_foundation();

revoke all on function public.is_untrustworthy(uuid) from public, anon, authenticated;
revoke all on function public.demote_untrustworthy_foundation() from public, anon, authenticated;
grant execute on function public.is_untrustworthy(uuid) to service_role;

-- Apply the rule to everything that already exists.
update public.foundations set reputation_score = reputation_score where id is not null;

update public.foundations
   set description = 'Apoya a niños en casas hogar. Tiene un historial mixto: algunas verificaciones aprobadas y otras rechazadas, por eso su reputación cayó al nivel 1. Organización ficticia creada para pruebas de la demo.'
 where name = 'Corporación Alas de Esperanza';
