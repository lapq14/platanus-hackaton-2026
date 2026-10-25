/** `1,050.00 USDT` */
export function formatUSDT(n: number | string): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT'
}

/** `1,050 USDT` without decimals when the amount is whole (panel cards). */
export function formatUSDTCompact(n: number | string): string {
  const v = Number(n)
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(v) ? 0 : 2 }) + ' USDT'
}

/** `1,050 USDT` */
export function formatTokens(n: number | string): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' USDT'
}

/** `0x2d08…11af` (first 6 chars + … + last 4). */
export function shortHash(hash: string): string {
  if (hash.length <= 12) return hash
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** `24 oct 2026` (Spanish, local time zone). */
export function formatDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** `d•••@gmail.com` */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!user || !domain) return email
  return `${user[0]}•••@${domain}`
}

/** Lowercase, accent-free slug used for `?categoria=` filters. */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export const RIF_RE = /^[JGVEPC]-\d{8}-\d$/

/** SHA-256 of a file as `0x…` hex, computed in the browser. */
export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return '0x' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
