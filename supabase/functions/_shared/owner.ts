// Helpers shared by the endpoints that only the owner of a foundation can call.
import { admin, dbError, HttpError, requireUser, type UserRow } from './core.ts'

/**
 * A failed verification keeps the spend open so the foundation can upload corrected documents. The last allowed
 * attempt that still fails is a rejection (freeze + refund). Set it to 1 to restore the strict behavior.
 */
export const MAX_SPEND_ATTEMPTS = 3

/** The caller must be a signed-in `ong` that owns a foundation. `columns` is the PostgREST select list. */
export async function requireOwner<T = Record<string, unknown>>(
  req: Request,
  columns = 'id, name, status',
): Promise<{ user: UserRow; foundation: T & { id: string; status: string } }> {
  const user = await requireUser(req)
  if (user.role !== 'ong') throw new HttpError(403, 'forbidden', 'Solo una organización puede hacer esto')
  const { data, error } = await admin.from('foundations').select(columns).eq('user_id', user.id).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw new HttpError(404, 'foundation_not_found', 'Fundación no encontrada')
  return { user, foundation: data as unknown as T & { id: string; status: string } }
}

/** SHA-256 as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Validates an optional http(s) profile link: empty -> null, otherwise the host must belong to `hosts`. */
export function socialUrl(value: unknown, hosts: string[], label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_body', `${label} inválido`)
  const v = value.trim()
  if (v === '') return null
  if (v.length > 300) throw new HttpError(400, 'invalid_body', `${label} es demasiado largo`)
  let url: URL
  try {
    url = new URL(v)
  } catch {
    throw new HttpError(400, 'invalid_body', `${label} debe ser un enlace completo, por ejemplo https://...`)
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (url.protocol !== 'https:' || !hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new HttpError(400, 'invalid_body', `${label} debe ser un enlace https de ${hosts[0]}`)
  }
  return url.toString()
}
