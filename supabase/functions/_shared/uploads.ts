// Controlled uploads. Nobody writes to storage directly: the upload-url function issues a signed upload URL for a
// path under the caller's foundation and records it in foundation_uploads. A path must be claimed by the thing that
// uses it (an invoice, an appeal, the profile logo); files nobody claims within 24 hours are deleted.
import { admin, dbError, HttpError } from './core.ts'

export type UploadKind = 'invoice' | 'spend_origin' | 'spend_destination' | 'appeal' | 'logo'

export const KIND_BUCKET: Record<UploadKind, string> = {
  invoice: 'invoices',
  spend_origin: 'invoices',
  spend_destination: 'invoices',
  appeal: 'appeals',
  logo: 'foundation-logos',
}

const DOC_EXT = ['pdf', 'jpg', 'jpeg', 'png']
export const KIND_EXT: Record<UploadKind, string[]> = {
  invoice: DOC_EXT,
  spend_origin: DOC_EXT,
  spend_destination: DOC_EXT,
  appeal: DOC_EXT,
  logo: ['png', 'jpg', 'jpeg', 'svg'],
}

export const MAX_UNCLAIMED_UPLOADS = 30
export const STALE_UPLOAD_HOURS = 24

/** Removes files from storage (best effort) and forgets them. */
export async function discardFiles(foundationId: string, bucket: string, paths: string[]): Promise<void> {
  const own = paths.filter((p) => p.startsWith(`${foundationId}/`))
  if (own.length === 0) return
  await admin.storage.from(bucket).remove(own).catch((e) => console.warn('discardFiles', e))
  await admin.from('foundation_uploads').delete().eq('foundation_id', foundationId).in('path', own)
}

/** Deletes this foundation's uploads that were never attached to anything within 24 hours. */
export async function purgeStaleUploads(foundationId: string): Promise<number> {
  const before = new Date(Date.now() - STALE_UPLOAD_HOURS * 3_600_000).toISOString()
  const { data, error } = await admin
    .from('foundation_uploads')
    .select('path, bucket')
    .eq('foundation_id', foundationId)
    .is('claimed_at', null)
    .lt('created_at', before)
  if (error) throw dbError(error)
  const byBucket = new Map<string, string[]>()
  for (const r of data ?? []) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r.path])
  for (const [bucket, paths] of byBucket) await discardFiles(foundationId, bucket, paths)
  return data?.length ?? 0
}

/**
 * Marks uploads as used. Every path must have been issued to this foundation for one of the allowed kinds and must
 * not have been used yet. The update is guarded so two concurrent requests cannot claim the same file.
 */
export async function claimUploads(foundationId: string, paths: string[], kinds: UploadKind[]): Promise<void> {
  if (paths.length === 0) return
  const unique = [...new Set(paths)]
  if (unique.length !== paths.length) throw new HttpError(400, 'invalid_body', 'Hay archivos repetidos en el envío')
  const { data, error } = await admin.from('foundation_uploads').select('path, kind, claimed_at').eq('foundation_id', foundationId).in('path', unique)
  if (error) throw dbError(error)
  const byPath = new Map((data ?? []).map((r) => [r.path, r]))
  for (const p of unique) {
    const r = byPath.get(p)
    if (!r || !kinds.includes(r.kind as UploadKind)) throw new HttpError(400, 'invalid_body', 'Uno de los archivos no se subió correctamente. Súbelo de nuevo.')
    if (r.claimed_at) throw new HttpError(400, 'invalid_body', 'Uno de los archivos ya se usó en otro envío. Súbelo de nuevo.')
  }
  const { data: claimed, error: uErr } = await admin
    .from('foundation_uploads')
    .update({ claimed_at: new Date().toISOString() })
    .eq('foundation_id', foundationId)
    .in('path', unique)
    .is('claimed_at', null)
    .select('path')
  if (uErr) throw dbError(uErr)
  if ((claimed?.length ?? 0) !== unique.length) throw new HttpError(409, 'conflict', 'Uno de los archivos ya se estaba usando. Súbelo de nuevo.')
}

/** Checks that a client-sent path belongs to the foundation and looks like one of our generated paths. */
export function ownPath(foundationId: string, value: unknown, kinds: UploadKind[]): string {
  const exts = [...new Set(kinds.flatMap((k) => KIND_EXT[k]))].join('|')
  const re = new RegExp(`^${foundationId}/[0-9a-f-]{36}\\.(${exts})$`, 'i')
  if (typeof value !== 'string' || !re.test(value)) throw new HttpError(400, 'invalid_body', 'Ruta de documento inválida')
  return value
}
