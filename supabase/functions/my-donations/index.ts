// Donations visible to the caller, read with the service role after verifying the Privy token.
// POST { scope: 'donor' | 'foundation' } -> { donations }
//  - donor:      the caller's own donations, with the foundation, its tranches and refund (if any).
//  - foundation: donations received by the caller's foundation; donor identity is reduced to an alias.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody, requireUser } from '../_shared/core.ts'

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
      .select('*, foundation:foundations(*), tranches(*), refunds(*)')
      .eq('donor_id', user.id)
      .order('created_at', { ascending: false })
    if (error) throw dbError(error)
    return json({ donations: data ?? [] })
  } catch (e) {
    return fail(e)
  }
})
