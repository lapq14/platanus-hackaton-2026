// The owner's view of the money: summary, the contributions received with every tranche and where it was used, and the
// next unlock milestones.
// POST {} -> { summary, milestones, contributions }
//
// Milestones: spends consume the released tranches in a FIFO queue (oldest donation first, then lowest tranche). A
// tranche that reaches 50% used unlocks the next tranche of its donation. For each tranche whose next tranche is still
// locked, `spend_needed` is how much has to be spent from now on for that unlock to happen: everything that is
// ahead of it in the queue plus what it still needs to reach 50%. It is a lower bound: tranches unlocked on the way
// join the queue and can push later milestones further.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, json } from '../_shared/core.ts'
import { requireOwner } from '../_shared/owner.ts'

const ref = (id: string) => `#${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`
const cents = (v: number | string) => Math.round(Number(v) * 100)

interface UseRow {
  amount: number | string
  invoice_id: string
  created_at: string
}
interface TrancheRow {
  id: string
  index: number
  amount: number | string
  state: string
  remaining: number | string
  released_at: string | null
  tx_hash: string | null
  uses: UseRow[]
}
interface DonationRow {
  id: string
  donor_id: string | null
  created_at: string
  total_amount: number | string
  status: string
  initial_pct: number | null
  tranche_count: number
  tranches: TrancheRow[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { foundation } = await requireOwner(req, 'id')

    const [{ data: stats, error: sErr }, { data: donations, error: dErr }, { data: invoices, error: iErr }] = await Promise.all([
      admin.from('foundation_stats').select('*').eq('foundation_id', foundation.id).maybeSingle(),
      admin
        .from('donations')
        .select('id, donor_id, created_at, total_amount, status, initial_pct, tranche_count, tranches(id, index, amount, state, remaining, released_at, tx_hash, uses:tranche_uses(amount, invoice_id, created_at))')
        .eq('foundation_id', foundation.id)
        .order('created_at', { ascending: true })
        .limit(300),
      admin.from('invoices').select('id, number, concept').eq('foundation_id', foundation.id),
    ])
    const err = sErr ?? dErr ?? iErr
    if (err) throw dbError(err)

    const rows = (donations ?? []) as unknown as DonationRow[]
    const invoiceById = new Map((invoices ?? []).map((i) => [i.id as string, i as { number: string; concept: string }]))

    // FIFO queue of spendable tranches, already ordered by donation date because the query is.
    let ahead = 0
    const milestones: { contribution: string; unlock_tranche: number; unlock_amount: number; spend_needed: number; used_pct: number }[] = []
    for (const d of rows) {
      if (d.status === 'refunded') continue
      const sorted = [...d.tranches].sort((a, b) => a.index - b.index)
      for (const t of sorted) {
        if (t.state !== 'released' || cents(t.remaining) <= 0) continue
        const next = sorted.find((x) => x.index === t.index + 1)
        if (next && next.state === 'in_custody') {
          const used = cents(t.amount) - cents(t.remaining)
          const threshold = Math.ceil(cents(t.amount) / 2)
          milestones.push({
            contribution: ref(d.id),
            unlock_tranche: next.index,
            unlock_amount: Number(next.amount),
            spend_needed: (ahead + Math.max(0, threshold - used)) / 100,
            used_pct: cents(t.amount) > 0 ? Math.round((used / cents(t.amount)) * 100) : 0,
          })
        }
        ahead += cents(t.remaining)
      }
    }
    milestones.sort((a, b) => a.spend_needed - b.spend_needed)

    const live = rows.filter((d) => d.status !== 'refunded')
    const contributions = rows.map((d) => ({
      ref: ref(d.id),
      donor_label: d.donor_id ? `Donante #${String(d.donor_id).slice(0, 4).toUpperCase()}` : 'Anónimo',
      donated_at: d.created_at,
      total: Number(d.total_amount),
      status: d.status,
      initial_pct: d.initial_pct,
      tranche_count: d.tranche_count,
      tranches: [...d.tranches]
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          index: t.index,
          amount: Number(t.amount),
          state: t.state,
          remaining: Number(t.remaining),
          released_at: t.released_at,
          tx_hash: t.tx_hash,
          uses: (t.uses ?? []).map((u) => {
            const inv = invoiceById.get(u.invoice_id)
            return { invoice_id: u.invoice_id, number: inv?.number ?? null, concept: inv?.concept ?? null, amount: Number(u.amount), date: u.created_at }
          }),
        })),
    }))

    return json({
      summary: { ...(stats ?? {}), received_total: live.reduce((s, d) => s + Number(d.total_amount), 0), contributions_count: live.length },
      milestones: milestones.slice(0, 5),
      contributions: contributions.reverse(),
    })
  } catch (e) {
    return fail(e)
  }
})
