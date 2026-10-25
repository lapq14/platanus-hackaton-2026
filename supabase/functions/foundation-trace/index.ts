// Public traceability of a foundation's funds. No login needed; no donor identity, email or bank data is exposed.
// POST { foundation_id } -> {
//   foundation, stats,
//   invoices:      every reported spend with the contributions that funded it (pseudonymous refs),
//   contributions: every donation with its tranches and where each tranche was used.
// }
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, PUBLIC_FOUNDATION_COLUMNS, readBody } from '../_shared/core.ts'

const ref = (id: string) => `#${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`
const day = (iso: string) => iso.slice(0, 10)

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
    const body = await readBody(req)
    const id = body.foundation_id
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'invalid_body', 'foundation_id inválido')

    const [{ data: foundation, error: fErr }, { data: stats, error: sErr }, { data: donations, error: dErr }, { data: invoices, error: iErr }] =
      await Promise.all([
        admin.from('foundations').select(PUBLIC_FOUNDATION_COLUMNS).eq('id', id).maybeSingle(),
        admin.from('foundation_stats').select('*').eq('foundation_id', id).maybeSingle(),
        admin
          .from('donations')
          .select('id, created_at, total_amount, status, initial_pct, tranche_count, tranches(id, index, amount, state, remaining, released_at, tx_hash, uses:tranche_uses(amount, invoice_id, created_at))')
          .eq('foundation_id', id)
          .order('created_at', { ascending: true })
          .limit(200),
        admin.from('invoices_public').select('*').eq('foundation_id', id).order('uploaded_at', { ascending: false }).limit(100),
      ])
    const err = fErr ?? sErr ?? dErr ?? iErr
    if (err) throw dbError(err)
    if (!foundation) throw new HttpError(404, 'foundation_not_found', 'Fundación no encontrada')

    const rows = (donations ?? []) as unknown as DonationRow[]

    // Which contributions funded each invoice.
    const fundedBy = new Map<string, { contribution: string; donated_at: string; tranche_index: number; amount: number }[]>()
    for (const d of rows) {
      for (const t of d.tranches ?? []) {
        for (const u of t.uses ?? []) {
          const list = fundedBy.get(u.invoice_id) ?? []
          list.push({ contribution: ref(d.id), donated_at: day(d.created_at), tranche_index: t.index, amount: Number(u.amount) })
          fundedBy.set(u.invoice_id, list)
        }
      }
    }
    const invoiceById = new Map((invoices ?? []).map((i) => [i.id as string, i]))

    const contributions = rows.map((d) => ({
      ref: ref(d.id),
      donated_at: day(d.created_at),
      total: Number(d.total_amount),
      status: d.status,
      initial_pct: d.initial_pct,
      tranche_count: d.tranche_count,
      tranches: [...(d.tranches ?? [])]
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          index: t.index,
          amount: Number(t.amount),
          state: t.state,
          remaining: Number(t.remaining),
          released_at: t.released_at,
          tx_hash: t.tx_hash,
          uses: (t.uses ?? []).map((u) => {
            const inv = invoiceById.get(u.invoice_id) as { number?: string; concept?: string } | undefined
            return { invoice_id: u.invoice_id, number: inv?.number ?? null, concept: inv?.concept ?? null, amount: Number(u.amount) }
          }),
        })),
    }))

    return json({
      foundation,
      stats,
      invoices: (invoices ?? []).map((i) => ({ ...i, funded_by: fundedBy.get(i.id as string) ?? [] })),
      contributions,
    })
  } catch (e) {
    return fail(e)
  }
})
