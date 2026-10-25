// Registers the authenticated user as an organization: creates its foundation and sets role = 'ong'.
// Idempotent: a user that already owns a foundation gets it back unchanged.
// POST { name, description?, category?, rif?, country?, city?, official_email?, wallet_address?, logo_url?,
//        instagram_url?, tiktok_url?, x_url?, legal_doc_path?, legal_doc_hash? } -> { foundation }
// New foundations are created as status = 'pending' (level 1, reputation 0) until an auditor approves them.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody, requireUser } from '../_shared/core.ts'

const RIF_RE = /^[JGVEPC]-\d{8}-\d$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

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

    const rifRaw = text(body.rif, 20)
    const rif = rifRaw ? rifRaw.toUpperCase() : null
    if (rif && !RIF_RE.test(rif)) throw new HttpError(400, 'invalid_body', 'RIF inválido')
    const payout = text(body.wallet_address, 42)
    if (payout && !ADDRESS_RE.test(payout)) throw new HttpError(400, 'invalid_body', 'wallet_address inválida')
    if (rif) {
      const { data: taken } = await admin.from('foundations').select('id').eq('rif', rif).maybeSingle()
      if (taken) throw new HttpError(409, 'rif_taken', 'Este RIF ya tiene una cuenta.')
    }

    const { data, error } = await admin
      .from('foundations')
      .insert({
        user_id: user.id,
        name,
        description: text(body.description, 500),
        category: text(body.category, 40),
        wallet_address: payout ?? user.wallet_address,
        status: 'pending',
        rif,
        country: text(body.country, 60),
        city: text(body.city, 60),
        official_email: text(body.official_email, 120),
        logo_url: text(body.logo_url, 500),
        instagram_url: text(body.instagram_url, 300),
        tiktok_url: text(body.tiktok_url, 300),
        x_url: text(body.x_url, 300),
        legal_doc_path: text(body.legal_doc_path, 300),
        legal_doc_hash: text(body.legal_doc_hash, 80),
      })
      .select('*')
      .single()
    if (error?.code === '23505') throw new HttpError(409, 'rif_taken', 'Este RIF ya tiene una cuenta.')
    if (error) throw dbError(error)

    const { error: roleErr } = await admin.from('users').update({ role: 'ong' }).eq('id', user.id)
    if (roleErr) throw dbError(roleErr)

    return json({ foundation: data })
  } catch (e) {
    return fail(e)
  }
})
