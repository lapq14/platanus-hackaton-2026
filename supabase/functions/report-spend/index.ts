// A foundation reports a spend (invoice). The amount is validated against the foundation's available balance
// (released and unspent tranches, minus what other submitted invoices reserve).
// POST { concept?, amount, supplier_rif, file_paths[], file_hash?, file_hashes? } -> { invoice }
//   concept     optional, 3 to 80 characters when given; when empty the placeholder CONCEPT_PENDING is stored and
//               verify-spend fills it with the concept it extracts from the invoice.
//   file_paths  1 to 5 files uploaded through upload-url with kind 'invoice'. Any other path is rejected.
// The invoice is created `in_review` with a 7-day evidence window (evidence_due_at); verify-spend then submits and
// verifies it. If it stays open without backing past that window it becomes suspicious and the foundation's
// reputation drops to level 1.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody, round2 } from '../_shared/core.ts'
import { CONCEPT_PENDING, requireOwner } from '../_shared/owner.ts'
import { claimUploads, ownPath } from '../_shared/uploads.ts'

const RIF_RE = /^[JGVEPC]-\d{8}-\d$/
const MAX_FILES = 5

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { foundation } = await requireOwner(req)
    if (foundation.status !== 'active') throw new HttpError(403, 'foundation_suspended', 'Fundación suspendida')

    const body = await readBody(req)
    const givenConcept = typeof body.concept === 'string' ? body.concept.trim() : ''
    if (givenConcept !== '' && (givenConcept.length < 3 || givenConcept.length > 80)) {
      throw new HttpError(400, 'invalid_body', 'El concepto debe tener entre 3 y 80 caracteres')
    }
    const concept = givenConcept === '' ? CONCEPT_PENDING : givenConcept
    const rif = typeof body.supplier_rif === 'string' ? body.supplier_rif.trim().toUpperCase() : ''
    if (!RIF_RE.test(rif)) throw new HttpError(400, 'invalid_body', 'RIF del proveedor inválido')
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) throw new HttpError(400, 'invalid_amount', 'Monto inválido')
    const amount = round2(body.amount)
    if (amount <= 0 || amount > 10_000_000) throw new HttpError(400, 'invalid_amount', 'Monto inválido')

    const rawPaths = Array.isArray(body.file_paths) ? body.file_paths : []
    if (rawPaths.length < 1 || rawPaths.length > MAX_FILES) throw new HttpError(400, 'invalid_body', 'Sube entre 1 y 5 archivos de la factura')
    const paths = rawPaths.map((p) => ownPath(foundation.id, p, ['invoice']))
    const hashes = Array.isArray(body.file_hashes) ? body.file_hashes.filter((h): h is string => typeof h === 'string').slice(0, MAX_FILES) : []
    const fileHash = typeof body.file_hash === 'string' ? body.file_hash.slice(0, 80) : null

    // Balance check (the same rule submit_spend_for_review enforces again before the model runs).
    const { data: avail, error: aErr } = await admin.rpc('foundation_available_balance', { p_foundation_id: foundation.id })
    if (aErr) throw dbError(aErr)
    const { data: pending, error: pErr } = await admin
      .from('invoices')
      .select('amount')
      .eq('foundation_id', foundation.id)
      .eq('status', 'in_review')
      .not('submitted_at', 'is', null)
    if (pErr) throw dbError(pErr)
    const reservedCents = (pending ?? []).reduce((s, i) => s + Math.round(Number(i.amount) * 100), 0)
    const freeCents = Math.round(Number(avail) * 100) - reservedCents
    if (Math.round(amount * 100) > freeCents) {
      throw new HttpError(409, 'insufficient_balance', `El gasto supera tu saldo disponible de $${(Math.max(0, freeCents) / 100).toFixed(2)}.`)
    }

    // The files are claimed only after every validation passed, so a rejected request keeps them reusable.
    await claimUploads(foundation.id, paths, ['invoice'])

    // Server-generated number: N° 000001, 000002, ... (retry on the rare unique-number race).
    const { count, error: cErr } = await admin.from('invoices').select('id', { count: 'exact', head: true }).eq('foundation_id', foundation.id)
    if (cErr) throw dbError(cErr)
    let seq = (count ?? 0) + 1
    for (let attempt = 0; attempt < 5; attempt++, seq++) {
      const number = `N° ${String(seq).padStart(6, '0')}`
      const { data, error } = await admin
        .from('invoices')
        .insert({
          foundation_id: foundation.id,
          number,
          concept,
          amount,
          supplier_rif: rif,
          file_path: paths[0],
          file_paths: paths,
          file_hash: fileHash,
          file_hashes: hashes,
          status: 'in_review',
        })
        .select('id, number, concept, amount, supplier_rif, status, uploaded_at, evidence_due_at')
        .single()
      if (!error && data) return json({ invoice: data })
      if (error?.code !== '23505') throw dbError(error ?? { message: 'insert failed' })
    }
    throw new HttpError(409, 'conflict', 'No se pudo asignar un número de factura. Intenta de nuevo.')
  } catch (e) {
    return fail(e)
  }
})
