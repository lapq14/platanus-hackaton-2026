# Database behavior tests

SQL-only tests for the donation -> release -> spend-verification route, run against the real remote project.

| File | Covers |
| --- | --- |
| `01_donation_release.sql` | `wallet_top_up`, `donate_from_balance`, `record_initial_release` (levels 10/10/15/25, idempotency, caps) |
| `02_timeline_progression.sql` | 3 consecutive verified spends: `submit_spend_for_review` -> `resolve_spend_verdict` -> `record_spend_release`; tranches 2/3/4 released, donation `completed`, `foundation_stats`, reputation, donor timeline, ownership guards, frozen target set, legacy `apply_spend_verdict` compat |
| `03_fraud_refund.sql` | Rejected spend: foundation frozen, unreleased tranches `broken`, 100% refund of every affected donation to `users.balance` (cap not blocking), `refunds`/`audit_events`, idempotency, completed donation and other foundations untouched, in-flight release after a freeze |
| `04_registration_audit.sql` | Registration auditor: `begin_registration_review` / `resolve_registration_verdict` (pending -> active / rejected, idempotency, resubmission, duplicate RIF, `data_changed` when RIF/name change during the model call, frozen/unknown guards, `rejected` excluded from `active` rules, client roles without access). The RIF check digit is tested in `supabase/functions/_shared/rif.test.ts` (`deno test`) |

## Rollback design

Each file is a single `DO $test$ ... $test$;` block. It creates fake fixtures (`TEST-...` wallets, names,
Privy ids, fake RIFs `J-9999xxxx-x`, fake tx hashes `TEST-0x...`), runs the assertions, and finishes with
`RAISE EXCEPTION` carrying the full report. The exception aborts the transaction, so nothing persists.
**The expected result of a run is an error `P0001: TEST_REPORT ...`**: read the report in the error message.
Report lines are `[PASS]`, `[FAIL]` or `[INFO]`. Everything implemented is asserted; a `[FAIL]` is a real regression.
The on-chain send is simulated by writing `invoices.release_tx_hash` (the value the edge function persists after sending).

Helpers (`pg_temp.chk`, `pg_temp.err`, ...) are temp objects created inside the block and rolled back too.
Expected-error assertions use a nested `BEGIN ... EXCEPTION` block, so rejected calls leave no side effects.

## How to run

- Supabase MCP: pass the file content as the `query` of `execute_sql`.
- psql: `psql "$DATABASE_URL" -f supabase/tests/01_donation_release.sql` (ends with the TEST_REPORT error; that is normal).
  Run with a role that can execute the functions (they are granted to `service_role` only; `postgres` works).

## Verify nothing leaked

```sql
select (select count(*) from public.users where wallet_address like 'TEST-%') users,
       (select count(*) from public.foundations where name like 'TEST-%') foundations,
       (select count(*) from public.donations d join public.foundations f on f.id = d.foundation_id where f.name like 'TEST-%') donations,
       (select count(*) from public.tranches where tx_hash like 'TEST-%') tranches,
       (select count(*) from public.invoices where number like 'TEST-%') invoices,
       (select count(*) from public.refunds r join public.invoices i on i.id = r.invoice_id where i.number like 'TEST-%') refunds,
       (select count(*) from public.verifications where release_tx_hash like 'TEST-%') verifications,
       (select count(*) from public.audit_events where payload ->> 'source' = 'verify-spend' and (tx_hash like 'TEST-%' or payload::text like '%TEST%')) audit_events,
       (select count(*) from public.businesses where name like 'TEST-%') businesses;
```
All counts must be 0.

## Not covered

On-chain transfers (`releaseInitial` / `releaseSpend` send, receipt, claim TTL, escrow without ETH), the real Anthropic
call and document download in `verify-spend`, the edge orchestration itself (resume of a verified-but-unsent invoice), Privy JWT auth, HTTP status mapping, edge-function amount parsing (`parseAmount`, MAX_USD),
RLS/grants as seen by `anon`/`authenticated`, and the browser UI (the donor timeline status is mirrored in SQL
from `MisRastros.tsx`'s `statusLine`).
