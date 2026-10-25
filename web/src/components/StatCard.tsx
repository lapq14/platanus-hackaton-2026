import type { CSSProperties, ReactNode } from 'react'

interface StatCardProps {
  label: string
  value?: ReactNode
  /** `dashed` = custody. */
  variant?: 'solid' | 'dashed'
  valueColor?: string
  /** Value font size in px (design uses 22-30 depending on the page). */
  valueSize?: number
  padding?: string
  labelSize?: number
  gap?: string
  /** Replaces the value (e.g. progress bar card). */
  children?: ReactNode
  style?: CSSProperties
}

export default function StatCard({
  label,
  value,
  variant = 'solid',
  valueColor,
  valueSize = 28,
  padding = '18px',
  labelSize = 13,
  gap = '4px',
  children,
  style,
}: StatCardProps) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: variant === 'dashed' ? '1.5px dashed #8A8296' : '1.5px solid #DAD4CF',
        borderRadius: '14px',
        padding,
        display: 'flex',
        flexDirection: 'column',
        gap,
        ...style,
      }}
    >
      <span style={{ fontSize: `${labelSize}px`, color: '#5A5468' }}>{label}</span>
      {children ?? (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: `${valueSize}px`, fontWeight: 600, color: valueColor }}>{value}</span>
      )}
    </div>
  )
}
