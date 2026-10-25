import { supabase } from './supabase'
import { uploadUrl, type UploadKind } from './api'
import { fileExtension } from './storage'

/**
 * Uploads a file through a server-issued signed URL. Nobody can write to storage directly: the server decides the
 * path (under the foundation's folder), checks the kind and the limits, and deletes what is never used.
 * Returns the storage path to hand to the function that consumes the file.
 */
export async function uploadViaServer(kind: UploadKind, file: File, token: string): Promise<string> {
  const { bucket, path, token: uploadToken } = await uploadUrl(token, kind, fileExtension(file))
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, uploadToken, file, { contentType: file.type })
  if (error) throw new Error('No se pudo subir el archivo. Revisa su tamaño y formato e intenta de nuevo.')
  return path
}
