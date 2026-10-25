// Donations visible to the caller, read with the service role after verifying the Privy token.
// POST { scope: 'donor' | 'foundation' } -> { donations, invoices? }
//  - donor:      the caller's own donations, with the foundation (public columns), its tranches (each with the
//                `uses` that consumed it), refunds and the invoices those uses / refunds point to.
//  - foundation: donations received by the caller's foundation; donor identity is reduced to an alias.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  admin,
  CORS,
  dbError,
  fail,
  HttpError,
  json,
  PUBLIC_FOUNDATION_COLUMNS,
  readBody,
  requireUser,
} from '../_shared/core.ts'

interface UseRow {
  invoice_id: string
}
interface TrancheRow {
  invoice_id: string | null
  uses?: UseRow[]
}
interface DonationRow {
  tranches?: TrancheRow[]
  refunds?: { invoice_id: string | null }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const user = await requireUser(req)
    const body = await readBody(req)

    if (body.scope === 'foundation') {
      const { data: foundation, error: fErr } = await admin
        .from('foundations')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (fErr) throw dbError(fErr)
      if (!foundation) throw new HttpError(404, 'foundation_not_found', 'No tienes una fundación registrada')

      const { data, error } = await admin
        .from('donations')
        .select('*')
        .eq('foundation_id', foundation.id)
        .order('created_at', { ascending: false })
      if (error) throw dbError(error)

      const donations = (data ?? []).map(({ donor_id, release_claimed_at: _claimed, ...d }) => ({
        ...d,
        donor_label: donor_id ? `Donante #${String(donor_id).slice(0, 4).toUpperCase()}` : 'Anónimo',
      }))
      return json({ donations })
    }

    if (body.scope !== 'donor') throw new HttpError(400, 'invalid_body', 'scope inválido')

    const { data, error } = await admin
      .from('donations')
      .select(`*, foundation:foundations(${PUBLIC_FOUNDATION_COLUMNS}), tranches(*, uses:tranche_uses(*)), refunds(*)`)
      .eq('donor_id', user.id)
      .order('created_at', { ascending: false })
    if (error) throw dbError(error)
    const donations = (data ?? []) as DonationRow[]

    // Invoices referenced by the uses, by the tranche that an invoice unlocked, or by a refund.
    const ids = new Set<string>()
    for (const d of donations) {
      for (const t of d.tranches ?? []) {
        if (t.invoice_id) ids.add(t.invoice_id)
        for (const u of t.uses ?? []) ids.add(u.invoice_id)
      }
      for (const r of d.refunds ?? []) if (r.invoice_id) ids.add(r.invoice_id)
    }

    let invoices: unknown[] = []
    if (ids.size > 0) {
      const { data: inv, error: iErr } = await admin
        .from('invoices')
        .select('id, foundation_id, number, concept, amount, supplier_rif, status, agent_checks, review_note, file_hash, file_hashes, file_paths, release_tx_hash, allocated_amount, uploaded_at, reviewed_at')
        .in('id', [...ids])
      if (iErr) throw dbError(iErr)
      const rifs = [...new Set((inv ?? []).map((i) => i.supplier_rif as string))]
      const { data: biz } = rifs.length
        ? await admin.from('businesses').select('rif, name').in('rif', rifs)
        : { data: [] as { rif: string; name: string }[] }
      const names = new Map((biz ?? []).map((b) => [b.rif, b.name]))
      // Document paths stay on the server: the client only learns how many documents exist.
      invoices = (inv ?? []).map(({ file_paths, ...i }) => ({
        ...i,
        supplier_name: names.get(i.supplier_rif as string) ?? null,
        document_count: Array.isArray(file_paths) ? file_paths.length : 0,
      }))
    }

    return json({ donations, invoices })
  } catch (e) {
    return fail(e)
  }
})
