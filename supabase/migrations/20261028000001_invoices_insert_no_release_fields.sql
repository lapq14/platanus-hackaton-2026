-- Clients must not preset server-owned release fields when inserting an invoice:
-- a preset release_tx_hash would make releaseSpend skip the on-chain send and record a fake proof.
drop policy if exists "invoices insert in_review" on public.invoices;
create policy "invoices insert in_review" on public.invoices for insert to anon, authenticated
  with check (
    status = 'in_review'
    and reviewer_id is null and reviewed_at is null
    and release_tx_hash is null and release_claimed_at is null
    and exists (select 1 from public.foundations f where f.id = foundation_id and f.status = 'active')
  );
