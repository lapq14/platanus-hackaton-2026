// Five reputation levels. Mirrors the database functions public.level_for_reputation,
// public.payout_for_reputation and public.tranche_count_for_level (the database is the source of truth).
export type Level = 1 | 2 | 3 | 4 | 5

export const MAX_LEVEL: Level = 5

/** % of a donation sent to the foundation right away (tranche 1), by level. */
export const LEVEL_RELEASE: Record<Level, number> = { 1: 25, 2: 30, 3: 40, 4: 45, 5: 50 }
/** Total tranches per donation, by level (the initial one included). */
export const LEVEL_TRANCHES: Record<Level, number> = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 3 }
/** Minimum reputation to reach each level. */
export const LEVEL_MIN_REPUTATION: Record<Level, number> = { 1: 0, 2: 30, 3: 50, 4: 70, 5: 90 }
/** A tranche that is this % consumed unlocks the next tranche of the same donation. */
export const UNLOCK_THRESHOLD_PCT = 50
/** Rough reputation gain per verified invoice (mirrors the +4 in resolve_spend_verdict). */
export const REP_PER_VERIFIED_INVOICE = 4

export const toLevel = (n: number): Level => (n >= 5 ? 5 : n === 4 ? 4 : n === 3 ? 3 : n === 2 ? 2 : 1)

export const CATEGORIES = [
  'Salud',
  'Educación',
  'Alimentación',
  'Medio Ambiente',
  'Protección Animal',
  'Vivienda',
  'Otra',
] as const

/**
 * Splits a donation like the database does: tranche 1 = level %, the remaining tranches split the rest evenly
 * and the last one absorbs the rounding.
 */
export function splitDonation(amount: number, level: Level): number[] {
  const n = LEVEL_TRANCHES[level]
  const initial = Math.round(amount * LEVEL_RELEASE[level]) / 100
  const each = Math.round(((amount - initial) / (n - 1)) * 100) / 100
  const out = [initial]
  for (let i = 2; i < n; i++) out.push(each)
  out.push(Math.round((amount - initial - (n - 2) * each) * 100) / 100)
  return out
}
