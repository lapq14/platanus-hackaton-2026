import { supabase } from './supabase'
import { documentUrl } from './api'

export const BUCKETS = {
  logos: 'foundation-logos',
  legal: 'legal-docs',
  invoices: 'invoices',
  /** Private; the browser can only insert `{uuid}.{pdf|jpg|png}` at the root (intake), never read. */
  rif: 'rif-docs',
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

/** Extension allowed by the `rif-docs` intake policy, derived from the MIME type (never from the file name). */
export const rifExtension = (file: File): string => (file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg')

export const fileExtension = (file: File): string => {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]{2,4}$/.test(fromName)) return fromName
  return file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'
}

/** Returns an access token when the user is signed in, or null (public documents need none). */
export type TokenGetter = () => Promise<string | null>

/**
 * Opens an invoice document in a new tab. The tab is opened synchronously (inside the click) and pointed at the
 * signed URL afterwards, so Safari and mobile browsers do not block it as a popup.
 */
export async function openInvoiceDocument(invoiceId: string, index = 0, getToken?: TokenGetter): Promise<void> {
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  try {
    const token = getToken ? await getToken() : null
    const { url } = await documentUrl(invoiceId, 'invoice', index, token)
    if (tab) tab.location.href = url
    else window.location.href = url
  } catch (e) {
    tab?.close()
    throw e
  }
}
