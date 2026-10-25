import type { TrancheState } from '../types'

interface TramoIconProps {
  state: TrancheState
  size?: number
  /** Renders a pending tranche that will no longer be released (light dashed circle). */
  dim?: boolean
}

/** Tranche status icon: released (green check), in review (amber), in custody (dashed), broken seal (bugainvilia). */
export default function TramoIcon({ state, size = 40, dim = false }: TramoIconProps) {
  if (dim) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="#DAD4CF" strokeWidth="2.5" strokeDasharray="4 4" />
      </svg>
    )
  }
  switch (state) {
    case 'released':
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="#1A7F52" />
          <path d="m12.5 20.5 5 5 10-11" stroke="#FFFFFF" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'in_review':
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="#E8A317" />
          <circle cx="20" cy="20" r="11" fill="none" stroke="#1B1530" strokeWidth="2" strokeDasharray="2 3" />
        </svg>
      )
    case 'broken':
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="#B4235A" />
          <path d="M22 3 L16.5 17 L23.5 22 L18 37" stroke="#F6F4EF" strokeWidth="3.4" fill="none" strokeLinejoin="round" />
        </svg>
      )
    case 'in_custody':
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="17" fill="none" stroke="#8A8296" strokeWidth="2.5" strokeDasharray="4 4" />
        </svg>
      )
  }
}
