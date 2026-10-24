// Retry endpoint: releases the initial tranche of a donation (according to reputation) from custody.
// Only the donation's donor may call it. POST { donation_id }
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody, releaseInitial, requireUser } from '../_shared/core.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const user = await requireUser(req)
    const { donation_id } = await readBody(req)
    if (typeof donation_id !== 'string' || !donation_id) {
      throw new HttpError(400, 'invalid_body', 'donation_id requerido')
    }

    const { data: donation, error } = await admin
      .from('donations')
      .select('donor_id')
      .eq('id', donation_id)
      .maybeSingle()
    if (error) throw dbError(error)
    if (!donation) throw new HttpError(404, 'donation_not_found', 'Donación no encontrada')
    if (donation.donor_id !== user.id) throw new HttpError(403, 'not_owner', 'La donación no te pertenece')

    const r = await releaseInitial(donation_id)
    return json({ ok: true, released: r.released, release_tx_hash: r.tx_hash, payout_percentage: r.payout_percentage })
  } catch (e) {
    return fail(e)
  }
})
