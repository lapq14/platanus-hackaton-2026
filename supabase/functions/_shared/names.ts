// Organization-name normalization and comparison shared by verify-spend and validate-registration.

export const digits = (v: string) => v.replace(/\D/g, '')

export const normalizeName = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(c a|ca|s a|sa|a c|ac|fundacion|asociacion civil)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Strict match: one normalized name contains the other. */
export const namesMatch = (a: string, b: string) => {
  const x = normalizeName(a)
  const y = normalizeName(b)
  return x.length >= 3 && y.length >= 3 && (x === y || x.includes(y) || y.includes(x))
}

/**
 * Looser match for registration: strict containment OR at least 60% of the words of the shorter name appear
 * in the other (legal names often add words: "Fundacion Esperanza" vs "Esperanza para la Ninez").
 */
export const namesReasonablyMatch = (a: string, b: string) => {
  if (namesMatch(a, b)) return true
  const words = (v: string) => normalizeName(v).split(' ').filter((w) => w.length >= 3)
  const wa = words(a)
  const wb = words(b)
  if (wa.length === 0 || wb.length === 0) return false
  const [small, big] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)]
  return small.filter((w) => big.has(w)).length / small.length >= 0.6
}
