import type { CSSProperties } from 'react'
import type { ReputationState } from '../types'

const TONES: Record<ReputationState, { label: string; bg: string; fg: string; dot: string; hint: string }> = {
  sin_historial: {
    label: 'Sin historial',
    bg: '#ECE7F0',
    fg: '#5A5468',
    dot: '#8A8296',
    hint: 'Todavía no participa en ninguna recaudación. No hay información, no es una señal negativa.',
  },
  en_construccion: {
    label: 'En construcción',
    bg: '#FBEFD3',
    fg: '#6B4A00',
    dot: '#E8A317',
    hint: 'Tiene recaudaciones y su reputación sigue creciendo.',
  },
  confiable: {
    label: 'Confiable',
    bg: '#E2F1E9',
    fg: '#135E3C',
    dot: '#1A7F52',
    hint: 'Reputación alta y sin incidentes en sus auditorías.',
  },
  inconfiable: {
    label: 'Inconfiable',
    bg: '#F8E4EA',
    fg: '#8E1B47',
    dot: '#B4235A',
    hint: 'Una auditoría detectó que sus gastos no cuadraban.',
  },
}

interface ReputationChipProps {
  state: ReputationState
  size?: 'sm' | 'md'
  style?: CSSProperties
}

/**
 * Reputation state pill (dot + text, never color alone). "Sin historial" is neutral on purpose: a foundation
 * that never took part in a fundraising has no information, which is different from being untrustworthy.
 */
export default function ReputationChip({ state, size = 'sm', style }: ReputationChipProps) {
  const tone = TONES[state]
  return (
    <span
      title={tone.hint}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: size === 'sm' ? '12px' : '13px',
        fontWeight: 600,
        background: tone.bg,
        color: tone.fg,
        padding: size === 'sm' ? '3px 9px' : '5px 11px',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span style={{ width: '7px', height: '7px', borderRadius: '999px', background: tone.dot }} />
      {tone.label}
    </span>
  )
}
