import { formatDate } from '../lib/format'

const DAY = 86_400_000

/** Days left (rounded up) before the evidence deadline; zero or negative once it has passed. */
function daysLeft(dueAt: string, now = Date.now()): number {
  return Math.ceil((new Date(dueAt).getTime() - now) / DAY)
}

/**
 * The 7-day rule in one line: an open spend must be backed with valid documents before its deadline, otherwise it
 * becomes suspicious and the foundation's level drops to 1.
 */
export default function EvidenceDeadline({ dueAt, suspicious }: { dueAt: string | null | undefined; suspicious?: string | null }) {
  if (suspicious) {
    return (
      <span style={{ fontSize: '12px', fontWeight: 600, color: '#8E1B47' }}>
        Venció el plazo sin respaldo: gasto sospechoso desde el {formatDate(suspicious)}.
      </span>
    )
  }
  if (!dueAt) return null
  const left = daysLeft(dueAt)
  const tone = left <= 1 ? '#8E1B47' : left <= 3 ? '#6B4A00' : '#5A5468'
  return (
    <span style={{ fontSize: '12px', fontWeight: 600, color: tone }}>
      {left <= 0 ? 'El plazo vence hoy' : left === 1 ? 'Te queda 1 día' : `Te quedan ${left} días`} para respaldar este gasto ({formatDate(dueAt)}).
    </span>
  )
}
