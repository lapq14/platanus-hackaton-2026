-- Demo businesses matching the sample spend documents used to exercise `verify-spend` (idempotent).
--
-- Set A ("MUESTRA - DEMO" invoice): Farmacia Salud Ejemplo, C.A. / J-12345678-9 / Banco Ejemplo.
-- Set B (SENIAT-style dataset): JUDIBANA 2010, C.A. / J-30820587-7 / Banco de Venezuela.
-- Account numbers are stored digits-only, like the rest of the registry.
with b as (
  insert into public.businesses (name, rif) values
    ('Farmacia Salud Ejemplo, C.A.', 'J-12345678-9'),
    ('JUDIBANA 2010, C.A.', 'J-30820587-7')
  on conflict (rif) do nothing
  returning id, rif
)
insert into public.business_accounts (business_id, account_number, bank_name)
select b.id, v.account_number, v.bank_name
from b
join (values
  ('J-12345678-9', '00000000000000000002', 'Banco Ejemplo'),
  ('J-30820587-7', '01020145220000894123', 'Banco de Venezuela')
) as v (rif, account_number, bank_name) on v.rif = b.rif
on conflict (account_number) do nothing;
