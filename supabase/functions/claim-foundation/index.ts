// Takes ownership of a seeded foundation with a one-time code.
// POST { code } -> { foundation_id }
// The code (16 letters and digits, dashes optional) is handed over out of band. Only its SHA-256 is stored.
// It works once, expires, and the foundation must still be unowned or owned by a placeholder account that never
// signed in. After 5 wrong codes in an hour the caller must wait.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody, requireUser } from '../_shared/core.ts'
import { sha256Hex } from '../_shared/owner.ts'

const INVALID = new HttpError(400, 'invalid_code', 'El código no es válido o ya venció.')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const user = await requireUser(req)
    if (user.role === 'auditor') throw new HttpError(403, 'forbidden', 'Un auditor no puede administrar una fundación')

    const since = new Date(Date.now() - 3_600_000).toISOString()
    const { count: failures, error: fErr } = await admin
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'claim_failed')
      .eq('actor_id', user.id)
      .gte('created_at', since)
    if (fErr) throw dbError(fErr)
    if ((failures ?? 0) >= 5) throw new HttpError(429, 'too_many_attempts', 'Demasiados intentos. Espera una hora e inténtalo de nuevo.')

    const body = await readBody(req)
    const code = typeof body.code === 'string' ? body.code.toUpperCase().replace(/[^A-Z0-9]/g, '') : ''

    const fail_ = async (): Promise<never> => {
      await admin.from('audit_events').insert({ actor_id: user.id, action: 'claim_failed', entity: 'user', entity_id: user.id, payload: { source: 'claim-foundation' } })
      throw INVALID
    }
    if (code.length !== 16) return await fail_()

    const { data: owned } = await admin.from('foundations').select('id').eq('user_id', user.id).maybeSingle()
    if (owned) throw new HttpError(409, 'already_owner', 'Tu cuenta ya administra una fundación.')

    const { data: claim, error: cErr } = await admin
      .from('foundation_claims')
      .select('id, foundation_id, expires_at, used_at')
      .eq('code_hash', await sha256Hex(code))
      .maybeSingle()
    if (cErr) throw dbError(cErr)
    if (!claim || claim.used_at || new Date(claim.expires_at).getTime() < Date.now()) return await fail_()

    const { data: foundation, error: gErr } = await admin
      .from('foundations')
      .select('id, name, user_id, owner:users!foundations_user_id_fkey(privy_id)')
      .eq('id', claim.foundation_id)
      .maybeSingle()
    if (gErr) throw dbError(gErr)
    if (!foundation) return await fail_()
    const owner = foundation.owner as unknown as { privy_id: string | null } | null
    if (foundation.user_id && owner?.privy_id) throw new HttpError(409, 'foundation_taken', 'Esta fundación ya tiene un administrador.')

    // The single winner: the code is consumed atomically.
    const { data: used, error: uErr } = await admin
      .from('foundation_claims')
      .update({ used_at: new Date().toISOString(), used_by: user.id })
      .eq('id', claim.id)
      .is('used_at', null)
      .select('id')
    if (uErr) throw dbError(uErr)
    if (!used?.length) return await fail_()

    const { error: oErr } = await admin.from('foundations').update({ user_id: user.id }).eq('id', foundation.id)
    if (oErr) throw dbError(oErr)
    const { error: rErr } = await admin.from('users').update({ role: 'ong' }).eq('id', user.id)
    if (rErr) throw dbError(rErr)
    await admin.from('audit_events').insert({
      actor_id: user.id,
      action: 'foundation_claimed',
      entity: 'foundation',
      entity_id: foundation.id,
      payload: { source: 'claim-foundation' },
    })

    return json({ foundation_id: foundation.id, name: foundation.name })
  } catch (e) {
    return fail(e)
  }
})
