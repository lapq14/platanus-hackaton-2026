// Issues a signed upload URL for a file the caller's foundation is about to attach to something.
// POST { kind: 'invoice' | 'spend_origin' | 'spend_destination' | 'appeal' | 'logo', ext } -> { bucket, path, token }
// The browser then uploads with supabase.storage.from(bucket).uploadToSignedUrl(path, token, file). Nobody can write
// to these buckets any other way. Bucket limits (size and type) apply to the upload itself.
// Each foundation can hold at most 30 files that nothing has claimed yet; unclaimed files older than 24 hours are
// deleted every time this function runs for that foundation.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody } from '../_shared/core.ts'
import { requireOwner } from '../_shared/owner.ts'
import { KIND_BUCKET, KIND_EXT, MAX_UNCLAIMED_UPLOADS, purgeStaleUploads, type UploadKind } from '../_shared/uploads.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { foundation } = await requireOwner(req)
    const body = await readBody(req)

    const kind = body.kind as UploadKind
    if (typeof kind !== 'string' || !(kind in KIND_BUCKET)) throw new HttpError(400, 'invalid_body', 'Tipo de archivo inválido')
    const ext = typeof body.ext === 'string' ? body.ext.toLowerCase().replace(/^\./, '') : ''
    if (!KIND_EXT[kind].includes(ext)) {
      throw new HttpError(400, 'invalid_body', `Formato no permitido. Usa ${KIND_EXT[kind].join(', ').toUpperCase()}.`)
    }
    // Spend evidence only makes sense for a foundation that can spend.
    if ((kind === 'invoice' || kind === 'spend_origin' || kind === 'spend_destination') && foundation.status !== 'active') {
      throw new HttpError(403, 'foundation_suspended', 'Tu fundación no puede reportar gastos ahora')
    }

    await purgeStaleUploads(foundation.id)
    const { count, error: cErr } = await admin
      .from('foundation_uploads')
      .select('path', { count: 'exact', head: true })
      .eq('foundation_id', foundation.id)
      .is('claimed_at', null)
    if (cErr) throw dbError(cErr)
    if ((count ?? 0) >= MAX_UNCLAIMED_UPLOADS) {
      throw new HttpError(429, 'too_many_uploads', 'Tienes demasiados archivos sin usar. Envía el formulario o espera 24 horas.')
    }

    const bucket = KIND_BUCKET[kind]
    const path = `${foundation.id}/${crypto.randomUUID()}.${ext}`
    const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path)
    if (error || !data) {
      console.error('createSignedUploadUrl', error)
      throw new HttpError(500, 'internal_error', 'No se pudo preparar la subida')
    }
    const { error: iErr } = await admin.from('foundation_uploads').insert({ path, bucket, foundation_id: foundation.id, kind })
    if (iErr) throw dbError(iErr)

    return json({ bucket, path, token: data.token })
  } catch (e) {
    return fail(e)
  }
})
