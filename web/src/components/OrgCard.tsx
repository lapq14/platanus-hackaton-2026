import { Link } from 'react-router-dom'
import { LEVEL_RELEASE, toLevel } from '../config/levels'
import type { ReputationState } from '../types'
import ReputationChip from './ReputationChip'

/** Catalog view model of a foundation. */
export interface CatalogFoundation {
  id: string
  name: string
  category: string
  level: number
  reputation: number
  sealedInvoices: number
  reputationState: ReputationState
}

export default function OrgCard({ foundation }: { foundation: CatalogFoundation }) {
  const level = toLevel(foundation.level)
  const rep = `${foundation.reputation}%`
  // A foundation without history has no reputation to show yet: no percentage and no bar, just the neutral chip.
  const noHistory = foundation.reputationState === 'sin_historial'
  return (
    <Link
      to={`/fundacion/${foundation.id}`}
      style={{
        textDecoration: 'none',
        color: '#1B1530',
        background: '#FFFFFF',
        border: '1.5px solid #DAD4CF',
        borderRadius: '18px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '1.2px', color: '#5A5468' }}>
          {foundation.category.toUpperCase()}
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '11px',
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: '6px',
            background: '#F1E3EA',
            color: '#8E1B47',
          }}
        >
          NIVEL {level}
        </span>
      </div>
      <span style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1.15, minHeight: '46px' }}>{foundation.name}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
          <span style={{ color: '#5A5468' }}>Reputación</span>
          {noHistory ? (
            <ReputationChip state="sin_historial" />
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {foundation.reputationState === 'inconfiable' && <ReputationChip state="inconfiable" />}
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{rep}</span>
            </span>
          )}
        </div>
        <div style={{ height: '6px', borderRadius: '3px', background: '#ECE7F0' }}>
          {!noHistory && <div style={{ height: '6px', borderRadius: '3px', background: foundation.reputationState === 'inconfiable' ? '#B4235A' : '#1B1530', width: rep }} />}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '13px',
          color: '#5A5468',
          paddingTop: '12px',
          borderTop: '1.5px dashed #DAD4CF',
        }}
      >
        <span>
          Libera <strong style={{ color: '#1B1530' }}>{LEVEL_RELEASE[level]}%</strong> al donar
        </span>
        <span>{foundation.sealedInvoices} facturas selladas</span>
      </div>
    </Link>
  )
}

/** Same footprint as OrgCard, no shimmer. */
export function OrgCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '18px', padding: '20px', minHeight: '190px', display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      <div style={{ height: '14px', width: '45%', borderRadius: '4px', background: '#ECE7F0' }} />
      <div style={{ height: '46px', width: '80%', borderRadius: '6px', background: '#ECE7F0' }} />
      <div style={{ height: '6px', borderRadius: '3px', background: '#ECE7F0' }} />
      <div style={{ height: '14px', width: '70%', borderRadius: '4px', background: '#ECE7F0', marginTop: 'auto' }} />
    </div>
  )
}
