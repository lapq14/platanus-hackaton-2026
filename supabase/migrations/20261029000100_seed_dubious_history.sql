-- Demo history for the fictional foundations with doubtful metrics (they already received donations).
-- "Inconfiable" comes from incidents (flagged or rejected invoices), never from a low score alone.
with f as (
  select id, name from public.foundations
   where name in ('Fundación Pan y Techo Ya', 'Asociación Sueños de Papel', 'Corporación Alas de Esperanza')
)
insert into public.invoices (foundation_id, number, concept, amount, supplier_rif, status, agent_checks, review_note, uploaded_at, reviewed_at)
select f.id, v.number, v.concept, v.amount, v.rif, v.status, v.checks::jsonb, v.note,
       now() - (v.days || ' days')::interval, now() - (v.days || ' days')::interval + interval '2 hours'
from f
join (values
  ('Fundación Pan y Techo Ya', 'N° 000001', 'Materiales de construcción', 1200.00, 'J-29876543-2', 'verified',
   '[{"id":"origin_account_owned","label":"La cuenta de origen pertenece a la fundación","passed":true,"detail":"El titular coincide."},{"id":"destination_account_business","label":"La cuenta de destino pertenece a un negocio existente","passed":true,"detail":"Cuenta registrada."},{"id":"rif_exists","label":"El RIF existe y está registrado","passed":true,"detail":"RIF registrado."},{"id":"rif_matches_destination","label":"El RIF coincide con el dueño de la cuenta de destino","passed":false,"detail":"El RIF no coincide con el dueño de la cuenta."}]',
   'Gasto verificado con observaciones.', 95),
  ('Asociación Sueños de Papel', 'N° 000001', 'Útiles escolares', 800.00, 'J-31234567-0', 'verified',
   '[{"id":"origin_account_owned","label":"La cuenta de origen pertenece a la fundación","passed":true,"detail":"El titular coincide."},{"id":"destination_account_business","label":"La cuenta de destino pertenece a un negocio existente","passed":true,"detail":"Cuenta registrada."},{"id":"rif_exists","label":"El RIF existe y está registrado","passed":true,"detail":"RIF registrado."},{"id":"rif_matches_destination","label":"El RIF coincide con el dueño de la cuenta de destino","passed":false,"detail":"El monto y el RIF presentan inconsistencias."}]',
   'Gasto verificado con observaciones.', 60),
  ('Corporación Alas de Esperanza', 'N° 000001', 'Alimentos para casa hogar', 450.00, 'J-29876543-2', 'verified',
   '[{"id":"origin_account_owned","label":"La cuenta de origen pertenece a la fundación","passed":true,"detail":"El titular coincide."},{"id":"destination_account_business","label":"La cuenta de destino pertenece a un negocio existente","passed":true,"detail":"Cuenta registrada."},{"id":"rif_exists","label":"El RIF existe y está registrado","passed":true,"detail":"RIF registrado."},{"id":"rif_matches_destination","label":"El RIF coincide con el dueño de la cuenta de destino","passed":true,"detail":"El RIF coincide."}]',
   'Gasto verificado: cuenta de origen y negocio de destino confirmados.', 70),
  ('Corporación Alas de Esperanza', 'N° 000002', 'Mobiliario', 900.00, 'J-40567890-1', 'rejected',
   '[{"id":"origin_account_owned","label":"La cuenta de origen pertenece a la fundación","passed":false,"detail":"El titular no coincide con la fundación."},{"id":"destination_account_business","label":"La cuenta de destino pertenece a un negocio existente","passed":true,"detail":"Cuenta registrada."},{"id":"rif_exists","label":"El RIF existe y está registrado","passed":true,"detail":"RIF registrado."},{"id":"rif_matches_destination","label":"El RIF coincide con el dueño de la cuenta de destino","passed":true,"detail":"El RIF coincide."}]',
   'Gasto rechazado: La cuenta de origen pertenece a la fundación.', 30)
) as v (fname, number, concept, amount, rif, status, checks, note, days) on v.fname = f.name
on conflict (foundation_id, number) do nothing;
