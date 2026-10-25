// Mints a 60 second signed URL for a stored document, with access control.
// POST { invoice_id, kind: 'invoice' | 'origin' | 'destination', index? } -> { url }
//  - invoice documents of a VERIFIED invoice are public (transparency): no token needed.
//  - invoice documents of an invoice still in review or rejected: the owning foundation or an auditor.
//  - origin / destination documents contain bank data: only the owning foundation or an auditor.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, optionalUser, readBody } from '../_shared/core.ts'

const BUCKET = 'invoices'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await readBody(req)
    const invoiceId = body.invoice_id
    const kind = body.kind ?? 'invoice'
    if (typeof invoiceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(invoiceId)) {
      throw new HttpError(400, 'invalid_body', 'invoice_id inválido')
    }
    if (kind !== 'invoice' && kind !== 'origin' && kind !== 'destination') {
      throw new HttpError(400, 'invalid_body', 'kind inválido')
    }

    const { data: inv, error } = await admin
      .from('invoices')
      .select('foundation_id, status, file_path, file_paths, spend_origin_path, spend_destination_path')
      .eq('id', invoiceId)
      .maybeSingle()
    if (error) throw dbError(error)
    if (!inv) throw new HttpError(404, 'invoice_not_found', 'Factura no encontrada')

    const isPublic = kind === 'invoice' && inv.status === 'verified'
    if (!isPublic) {
      const user = await optionalUser(req)
      if (!user) throw new HttpError(401, 'unauthorized', 'Inicia sesión para ver este documento')
      let allowed = user.role === 'auditor'
      if (!allowed) {
        const { data: f } = await admin.from('foundations').select('user_id').eq('id', inv.foundation_id).maybeSingle()
        allowed = f?.user_id === user.id
      }
      if (!allowed) throw new HttpError(403, 'forbidden', 'No tienes acceso a este documento')
    }

    let path: string | null = null
    if (kind === 'origin') path = inv.spend_origin_path
    else if (kind === 'destination') path = inv.spend_destination_path
    else {
      const paths = (inv.file_paths as string[] | null) ?? []
      const index = typeof body.index === 'number' && Number.isInteger(body.index) ? body.index : 0
      path = paths[index] ?? (index === 0 ? inv.file_path : null)
    }
    if (!path) throw new HttpError(404, 'document_not_found', 'Esta factura no tiene un documento adjunto')

    const { data, error: sErr } = await admin.storage.from(BUCKET).createSignedUrl(path, 60)
    if (sErr || !data) throw new HttpError(404, 'document_not_found', 'No se encontró el documento')
    return json({ url: data.signedUrl })
  } catch (e) {
    return fail(e)
  }
})
