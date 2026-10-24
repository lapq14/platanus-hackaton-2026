import type { Foundation } from '../types'

export function reputationTone(score: number) {
  if (score >= 90) return { label: 'Excelente', cls: 'bg-emerald-100 text-emerald-800' }
  if (score >= 70) return { label: 'Confiable', cls: 'bg-green-100 text-green-800' }
  if (score >= 40) return { label: 'En construcción', cls: 'bg-amber-100 text-amber-800' }
  return { label: 'Baja', cls: 'bg-red-100 text-red-800' }
}

type Props = {
  foundation: Pick<Foundation, 'reputation_score' | 'payout_percentage' | 'status'>
}

export default function ReputationBadge({ foundation }: Props) {
  if (foundation.status === 'suspended') {
    return (
      <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-medium text-white">
        Suspendida
      </span>
    )
  }
  const t = reputationTone(foundation.reputation_score)
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${t.cls}`}>
      {t.label} · {foundation.reputation_score}/100
    </span>
  )
}
