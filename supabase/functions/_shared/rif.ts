// Venezuelan RIF (SENIAT) format + check-digit validation. Pure module: no Deno / network APIs, so it is
// unit-testable anywhere (see rif.test.ts).
//
// Shape: <type letter><8 digits><1 check digit>, canonical form `J-12345678-9`.
// Check digit (modulo 11):
//   letter value: V=1, E=2, J=3 (and C=3), P=4, G=5
//   sum   = letter*4 + d1*3 + d2*2 + d3*7 + d4*6 + d5*5 + d6*4 + d7*3 + d8*2
//   check = 11 - (sum mod 11); a result above 9 becomes 0.

export const RIF_TYPES = ['J', 'G', 'V', 'E', 'P', 'C'] as const
export type RifType = (typeof RIF_TYPES)[number]

const LETTER_VALUE: Record<RifType, number> = { V: 1, E: 2, J: 3, C: 3, P: 4, G: 5 }
const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2]

/** Canonical RIF shape, also enforced by the `foundations_rif_format` DB constraint. */
export const RIF_CANONICAL_RE = /^[JGVEPC]-\d{8}-\d$/

export type RifErrorCode = 'empty' | 'invalid_format' | 'missing_check_digit' | 'invalid_check_digit'

export type RifValidation =
  | { ok: true; rif: string; type: RifType; number: string; checkDigit: number }
  | { ok: false; code: RifErrorCode; message: string }

const isRifType = (v: string): v is RifType => (RIF_TYPES as readonly string[]).includes(v)

/** Check digit for a type letter and its 8-digit body. Throws on malformed input (use validateRif for user input). */
export function computeRifCheckDigit(type: RifType, eightDigits: string): number {
  if (!/^\d{8}$/.test(eightDigits)) throw new Error('RIF body must have exactly 8 digits')
  let sum = LETTER_VALUE[type] * 4
  for (let i = 0; i < 8; i++) sum += Number(eightDigits[i]) * WEIGHTS[i]
  const check = 11 - (sum % 11)
  return check > 9 ? 0 : check
}

/**
 * Normalizes `j123456789`, `J-12345678-9`, ` J 12345678 9 ` or `J.12345678.9` to `J-12345678-9`.
 * Returns null when the shape is wrong (no check on the check digit).
 */
export function normalizeRif(raw: string): string | null {
  const clean = raw.toUpperCase().replace(/[\s.\-_]/g, '')
  const m = /^([A-Z])(\d{9})$/.exec(clean)
  if (!m || !isRifType(m[1])) return null
  return `${m[1]}-${m[2].slice(0, 8)}-${m[2][8]}`
}

/**
 * Full deterministic validation: type letter, 8 digits + check digit, and the modulo-11 check digit.
 * `enforceCheckDigit: false` keeps the format check but accepts any check digit (the modulo-11 formula is
 * taken from community libraries, not from an official SENIAT spec, so callers may opt out until confirmed).
 */
export function validateRif(raw: unknown, { enforceCheckDigit = true }: { enforceCheckDigit?: boolean } = {}): RifValidation {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, code: 'empty', message: 'El RIF está vacío.' }
  const clean = raw.toUpperCase().replace(/[\s.\-_]/g, '')
  // Eight digits only: the body is there but the check digit is missing.
  if (/^[JGVEPC]\d{8}$/.test(clean)) {
    return { ok: false, code: 'missing_check_digit', message: 'Al RIF le falta el dígito verificador (formato J-12345678-9).' }
  }
  const rif = normalizeRif(raw)
  if (!rif) return { ok: false, code: 'invalid_format', message: 'El RIF no tiene un formato válido (tipo J, G, V, E, P o C, 8 dígitos y dígito verificador).' }
  const type = rif[0] as RifType
  const number = rif.slice(2, 10)
  const checkDigit = Number(rif[11])
  if (enforceCheckDigit && computeRifCheckDigit(type, number) !== checkDigit) {
    return { ok: false, code: 'invalid_check_digit', message: 'El dígito verificador del RIF no es correcto.' }
  }
  return { ok: true, rif, type, number, checkDigit }
}
