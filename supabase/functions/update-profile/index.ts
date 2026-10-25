// Edits the public profile of the caller's foundation.
// POST { description?, category?, country?, city?, instagram_url?, tiktok_url?, x_url?, logo_path?, wallet_address? }
//   -> { foundation }
// Only the fields present in the body change. Name and RIF are identity data fixed at registration, and the official
// e-mail is not edited here.
//   logo_path       a path issued by upload-url (kind 'logo').
//   wallet_address  the wallet that receives the money. Changing it is allowed only for an active foundation with no
//                   transfer in progress, and every change is written to audit_events.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, PUBLIC_FOUNDATION_COLUMNS, readBody } from '../_shared/core.ts'
import { requireOwner, socialUrl } from '../_shared/owner.ts'
import { claimUploads, discardFiles, ownPath } from '../_shared/uploads.ts'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

const text = (v: unknown, min: number, max: number, label: string): string => {
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_body', `${label} inválido`)
  const t = v.trim()
  if (t.length < min || t.length > max) throw new HttpError(400, 'invalid_body', `${label}: entre ${min} y ${max} caracteres`)
  return t
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { user, foundation } = await requireOwner<{ wallet_address: string; logo_url: string | null }>(req, 'id, status, wallet_address, logo_url')
    const body = await readBody(req)
    const update: Record<string, unknown> = {}

    if ('description' in body) update.description = text(body.description, 30, 500, 'La descripción')
    if ('category' in body) update.category = text(body.category, 2, 40, 'La categoría')
    if ('country' in body) update.country = text(body.country, 1, 60, 'El país')
    if ('city' in body) update.city = text(body.city, 1, 60, 'La ciudad')
    if ('instagram_url' in body) update.instagram_url = socialUrl(body.instagram_url, ['instagram.com'], 'El enlace de Instagram')
    if ('tiktok_url' in body) update.tiktok_url = socialUrl(body.tiktok_url, ['tiktok.com'], 'El enlace de TikTok')
    if ('x_url' in body) update.x_url = socialUrl(body.x_url, ['x.com', 'twitter.com'], 'El enlace de X')

    let walletChange: { from: string; to: string } | null = null
    if ('wallet_address' in body) {
      const wallet = typeof body.wallet_address === 'string' ? body.wallet_address.trim() : ''
      if (!ADDRESS_RE.test(wallet)) throw new HttpError(400, 'invalid_body', 'La wallet debe empezar con 0x y tener 42 caracteres')
      if (wallet.toLowerCase() !== foundation.wallet_address.toLowerCase()) {
        if (foundation.status !== 'active') {
          throw new HttpError(403, 'foundation_suspended', 'Solo una fundación activa puede cambiar su wallet de cobro')
        }
        // Never redirect money while a transfer to the current wallet is still in progress.
        const { count, error: tErr } = await admin
          .from('tranches')
          .select('id, donations!inner(foundation_id)', { count: 'exact', head: true })
          .eq('state', 'in_review')
          .eq('donations.foundation_id', foundation.id)
        if (tErr) throw dbError(tErr)
        if ((count ?? 0) > 0) throw new HttpError(409, 'release_in_progress', 'Hay una transferencia en curso. Intenta de nuevo cuando termine.')
        update.wallet_address = wallet
        walletChange = { from: foundation.wallet_address, to: wallet }
      }
    }

    let oldLogo: string | null = null
    if (typeof body.logo_path === 'string' && body.logo_path !== '') {
      const path = ownPath(foundation.id, body.logo_path, ['logo'])
      await claimUploads(foundation.id, [path], ['logo'])
      update.logo_url = admin.storage.from('foundation-logos').getPublicUrl(path).data.publicUrl
      // Only a logo this feature uploaded (under the foundation's folder) is deleted; registration logos stay.
      const marker = '/foundation-logos/'
      const prev = foundation.logo_url?.includes(marker) ? decodeURIComponent(foundation.logo_url.split(marker)[1] ?? '') : ''
      oldLogo = prev.startsWith(`${foundation.id}/`) ? prev : null
    }

    if (Object.keys(update).length === 0) throw new HttpError(400, 'invalid_body', 'No hay cambios para guardar')

    const { data, error } = await admin.from('foundations').update(update).eq('id', foundation.id).select(PUBLIC_FOUNDATION_COLUMNS).single()
    if (error) throw dbError(error)

    if (oldLogo) await discardFiles(foundation.id, 'foundation-logos', [oldLogo])
    if (walletChange) {
      await admin.from('audit_events').insert({
        actor_id: user.id,
        action: 'wallet_changed',
        entity: 'foundation',
        entity_id: foundation.id,
        payload: { ...walletChange, source: 'update-profile' },
      })
    }

    return json({ foundation: data })
  } catch (e) {
    return fail(e)
  }
})
