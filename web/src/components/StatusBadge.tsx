import type { InvoiceStatus } from '../types'

type BadgeStatus = InvoiceStatus | 'suspicious'

const TONES: Record<BadgeStatus, { label: string; bg: string; fg: string; dot: string }> = {
  verified: { label: 'Verificada', bg: '#E2F1E9', fg: '#135E3C', dot: '#1A7F52' },
  in_review: { label: 'En revisión', bg: '#FBEFD3', fg: '#6B4A00', dot: '#E8A317' },
  rejected: { label: 'Rechazada', bg: '#F8E4EA', fg: '#8E1B47', dot: '#B4235A' },
  suspicious: { label: 'Sospechosa', bg: '#F8E4EA', fg: '#8E1B47', dot: '#B4235A' },
}

interface StatusBadgeProps {
  status: BadgeStatus
  /** Overrides the default text (the panel summary says "Sellada" for verified). */
  label?: string
  size?: 'sm' | 'md'
}

/** Status pill: colored dot + text (never color alone). */
export default function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const tone = TONES[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '13px',
        fontWeight: 600,
        background: tone.bg,
        color: tone.fg,
        padding: size === 'sm' ? '4px 10px' : '5px 11px',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
      }}
    >
      {status === 'suspicious' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={tone.dot} strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M12 4v10" />
          <path d="M12 19h.01" />
        </svg>
      ) : (
        <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: tone.dot }} />
      )}
      {label ?? tone.label}
    </span>
  )
}
