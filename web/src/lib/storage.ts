import { supabase } from './supabase'

export const BUCKETS = {
  logos: 'foundation-logos',
  legal: 'legal-docs',
  invoices: 'invoices',
} as const

/** Uploads a file and returns its storage path. Throws a readable error on failure. */
export async function uploadFile(bucket: string, path: string, file: File): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

/** Public URL of a file in the public `foundation-logos` bucket. */
export function publicLogoUrl(path: string): string {
  return supabase.storage.from(BUCKETS.logos).getPublicUrl(path).data.publicUrl
}

/** Signed URL for a private invoice file; expires in 60 seconds. */
export async function signedInvoiceUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKETS.invoices).createSignedUrl(path, 60)
  if (error || !data) throw new Error(error?.message ?? 'No se pudo generar el enlace')
  return data.signedUrl
}

export const fileExtension = (file: File): string => {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]{2,4}$/.test(fromName)) return fromName
  return file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'
}

/** Opens an invoice document through a 60 s signed URL (new tab). */
export async function openInvoiceDocument(path: string): Promise<void> {
  const url = await signedInvoiceUrl(path)
  window.open(url, '_blank', 'noopener,noreferrer')
}
