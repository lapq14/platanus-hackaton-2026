// A frozen or untrustworthy foundation sends an appeal.
// POST { reason, evidence_paths? } -> { appeal, message }
//   reason          30 to 2000 characters.
//   evidence_paths  up to 3 files uploaded through upload-url with kind 'appeal'.
// The appeal is only RECORDED (status 'received'). Resolving it needs a future manual intervention by technical
// support: there is no automatic outcome, and nothing about the foundation changes when it is sent.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody } from '../_shared/core.ts'
import { requireOwner } from '../_shared/owner.ts'
import { claimUploads, ownPath } from '../_shared/uploads.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { user, foundation } = await requireOwner(req)
    const body = await readBody(req)

    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 30 || reason.length > 2000) {
      throw new HttpError(400, 'invalid_body', 'Explica tu caso con entre 30 y 2000 caracteres')
    }
    const rawPaths = Array.isArray(body.evidence_paths) ? body.evidence_paths : []
    if (rawPaths.length > 3) throw new HttpError(400, 'invalid_body', 'Puedes adjuntar hasta 3 archivos')
    const paths = rawPaths.map((p) => ownPath(foundation.id, p, ['appeal']))

    await admin.rpc('flag_overdue_spends')
    const { data: untrustworthy, error: uErr } = await admin.rpc('is_untrustworthy', { p_foundation_id: foundation.id })
    if (uErr) throw dbError(uErr)
    if (foundation.status !== 'frozen' && untrustworthy !== true) {
      throw new HttpError(409, 'appeal_not_needed', 'Tu fundación no tiene alertas que apelar.')
    }

    const { count, error: cErr } = await admin
      .from('appeals')
      .select('id', { count: 'exact', head: true })
      .eq('foundation_id', foundation.id)
      .in('status', ['received', 'in_review'])
    if (cErr) throw dbError(cErr)
    if ((count ?? 0) > 0) throw new HttpError(409, 'appeal_pending', 'Ya tienes una apelación en espera de revisión.')

    await claimUploads(foundation.id, paths, ['appeal'])
    const { data, error } = await admin
      .from('appeals')
      .insert({ foundation_id: foundation.id, user_id: user.id, reason, evidence_paths: paths })
      .select('id, status, created_at')
      .single()
    if (error) throw dbError(error)

    await admin.from('audit_events').insert({
      actor_id: user.id,
      action: 'appeal_received',
      entity: 'foundation',
      entity_id: foundation.id,
      payload: { appeal_id: data.id, evidence: paths.length, source: 'submit-appeal' },
    })

    return json({
      appeal: data,
      message: 'Recibimos tu apelación. Soporte técnico la revisará manualmente y te contactará. Mientras tanto, nada cambia en tu fundación.',
    })
  } catch (e) {
    return fail(e)
  }
})
