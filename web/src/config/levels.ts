// % released at donation time per foundation level. Level I = 10%.
// Mirrors the database function public.payout_for_reputation (single source of truth in the DB).
export type Level = 1 | 2 | 3 | 4

export const LEVEL_RELEASE: Record<Level, number> = { 1: 10, 2: 10, 3: 15, 4: 25 }
export const LEVEL_ROMAN: Record<Level, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }
/** 1 tranche released on donation + 3 tranches sealed by invoices. */
export const TRANCHES = 4
/** Minimum reputation to reach each level (mirrors public.level_for_reputation). */
export const LEVEL_MIN_REPUTATION: Record<Level, number> = { 1: 0, 2: 40, 3: 70, 4: 90 }
/** Rough reputation gain per verified invoice. TODO fase agente: align with the real scoring rule. */
export const REP_PER_VERIFIED_INVOICE = 4

export const toLevel = (n: number): Level => (n >= 4 ? 4 : n === 3 ? 3 : n === 2 ? 2 : 1)

export const CATEGORIES = [
  'Salud',
  'Educación',
  'Alimentación',
  'Medio Ambiente',
  'Protección Animal',
  'Vivienda',
  'Otra',
] as const

/** Splits a donation like the database does: tranche 1 = level %, tranches 2-4 split the rest. */
export function splitDonation(amount: number, releasePct: number): number[] {
  const initial = Math.round(amount * releasePct) / 100
  const each = Math.round(((amount - initial) / 3) * 100) / 100
  return [initial, each, each, Math.round((amount - initial - 2 * each) * 100) / 100]
}
