// Registers the authenticated user as an organization: creates its foundation and sets role = 'ong'.
// Idempotent: a user that already owns a foundation gets it back unchanged.
// POST { name, description?, category? } -> { foundation }
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody, requireUser } from '../_shared/core.ts'

const text = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_body', 'Campo inválido')
  const t = v.trim()
  if (t.length > max) throw new HttpError(400, 'invalid_body', 'Campo demasiado largo')
  return t === '' ? null : t
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const user = await requireUser(req)
    if (user.role === 'auditor') throw new HttpError(403, 'forbidden', 'Un auditor no puede registrar una organización')

    const { data: existing, error: findErr } = await admin
      .from('foundations')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (findErr) throw dbError(findErr)
    if (existing) {
      if (user.role !== 'ong') await admin.from('users').update({ role: 'ong' }).eq('id', user.id)
      return json({ foundation: existing })
    }

    const body = await readBody(req)
    const name = text(body.name, 80)
    if (!name || name.length < 2) throw new HttpError(400, 'invalid_body', 'El nombre es obligatorio')

    const { data, error } = await admin
      .from('foundations')
      .insert({
        user_id: user.id,
        name,
        description: text(body.description, 500),
        category: text(body.category, 40),
        wallet_address: user.wallet_address,
      })
      .select('*')
      .single()
    if (error) throw dbError(error)

    const { error: roleErr } = await admin.from('users').update({ role: 'ong' }).eq('id', user.id)
    if (roleErr) throw dbError(roleErr)

    return json({ foundation: data })
  } catch (e) {
    return fail(e)
  }
})
