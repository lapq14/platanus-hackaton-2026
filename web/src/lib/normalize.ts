import type { Donation, Foundation, FoundationStats, Invoice, Refund, Tranche, TrancheUse } from '../types'

// PostgREST returns numeric columns as numbers, but the database types them as `numeric`:
// coerce defensively so the UI never concatenates strings.
const n = (v: unknown): number => Number(v ?? 0)

export const toUse = (u: TrancheUse): TrancheUse => ({ ...u, amount: n(u.amount) })

export const toTranche = (t: Tranche): Tranche => ({
  ...t,
  amount: n(t.amount),
  remaining: n(t.remaining),
  uses: (t.uses ?? []).map(toUse),
})

export const toRefund = (r: Refund): Refund => ({ ...r, amount: n(r.amount) })

export const toInvoice = (i: Invoice): Invoice => ({
  ...i,
  amount: n(i.amount),
  allocated_amount: n(i.allocated_amount),
  agent_checks: Array.isArray(i.agent_checks) ? i.agent_checks : [],
  document_count: n(i.document_count),
  file_hashes: i.file_hashes ?? [],
})

export const toFoundation = (f: Foundation): Foundation => ({ ...f, total_received: n(f.total_received) })

export const toStats = (s: FoundationStats): FoundationStats => ({
  ...s,
  released_total: n(s.released_total),
  custody_total: n(s.custody_total),
  spent_total: n(s.spent_total),
  available_balance: n(s.available_balance),
})

// `refunds.donation_id` is UNIQUE, so PostgREST embeds the refund as a single object (or null), not a list.
const asList = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : [])

export const toDonation = (d: Donation): Donation => ({
  ...d,
  total_amount: n(d.total_amount),
  amount_released: n(d.amount_released),
  amount_refunded: n(d.amount_refunded),
  foundation: d.foundation ? toFoundation(d.foundation) : undefined,
  tranches: (d.tranches ?? []).map(toTranche).sort((a, b) => a.index - b.index),
  refunds: asList(d.refunds).map(toRefund),
})

/** An invoice has "details" when the agent flagged at least one check (human review suggested). */
export const hasFailedCheck = (i: Invoice): boolean => i.agent_checks.some((c) => !c.passed)
