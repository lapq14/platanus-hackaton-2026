import type { CSSProperties } from 'react'
import { LEVEL_RELEASE, toLevel } from '../config/levels'
import { explorerTx } from '../lib/chain'
import { formatUSDT, maskEmail, shortHash } from '../lib/format'
import type { Donation, Refund } from '../types'
import TramoIcon from './TramoIcon'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const ROW: CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid #ECE7F0', fontSize: '15px' }

interface RefundCardProps {
  donation: Donation
  refund: Refund
  email: string | null
}

/** "El rastro de tus $30.00": what was delivered, what came back and the on-chain proof. */
export default function RefundCard({ donation, refund, email }: RefundCardProps) {
  const tranches = donation.tranches ?? []
  const delivered = tranches.filter((t) => t.state === 'released')
  const deliveredTotal = delivered.reduce((s, t) => s + t.amount, 0)
  const firstBroken = tranches.find((t) => t.state === 'broken')
  const pct = donation.initial_pct ?? LEVEL_RELEASE[toLevel(donation.foundation?.level ?? 1)]

  // The first broken tranche shows the broken seal; later ones are dimmed (they will never be released).
  const firstBrokenPos = tranches.findIndex((t) => t.state === 'broken')
  const icons = tranches.map((t, i) => ({ state: t.state, dim: t.state === 'broken' && i > firstBrokenPos }))

  return (
    <section style={{ flex: '1 1 420px', background: '#FFFFFF', border: '1.5px solid #1B1530', borderRadius: '20px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <span style={{ fontSize: '17px', fontWeight: 700 }}>El rastro de tus {formatUSDT(donation.total_amount)}</span>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {icons.map((ic, i) => (
          <div key={i} style={{ display: 'contents' }}>
            {i > 0 &&
              (i === 1 && icons[0].state === 'released' ? (
                <div style={{ flex: 1, height: '3px', background: '#1B1530', margin: '0 6px' }} />
              ) : (
                <div style={{ flex: 1, height: 0, borderTop: '3px dashed #DAD4CF', margin: '0 6px' }} />
              ))}
            <TramoIcon state={ic.state} dim={ic.dim} size={36} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={ROW}>
          <span style={{ color: '#5A5468' }}>
            {delivered.length <= 1 ? `Tramo 1 · entregado al donar (${pct}%)` : `Tramos 1–${delivered.length} · entregados`}
          </span>
          <span style={{ ...MONO, fontWeight: 600 }}>{formatUSDT(deliveredTotal)}</span>
        </div>
        <div style={ROW}>
          <span style={{ color: '#5A5468' }}>Custodia devuelta (tramos {firstBroken?.index ?? 2}–4)</span>
          <span style={{ ...MONO, fontWeight: 600 }}>{formatUSDT(refund.amount)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0 0', borderTop: '1.5px solid #1B1530' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <strong style={{ fontSize: '16px' }}>Depositado en tu billetera</strong>
            {refund.tx_hash && (
              <a href={explorerTx(refund.tx_hash)} target="_blank" rel="noopener noreferrer" style={{ ...MONO, fontSize: '13px', textDecoration: 'none' }}>
                tx {shortHash(refund.tx_hash)} ↗
              </a>
            )}
          </div>
          <span style={{ ...MONO, fontSize: '26px', fontWeight: 600, color: '#1A7F52' }}>+{formatUSDT(refund.amount)}</span>
        </div>
      </div>
      {email && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#F6F4EF', borderRadius: '12px', padding: '12px 14px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B3FB6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          <span style={{ fontSize: '14px', color: '#5A5468' }}>Te enviamos el detalle a {maskEmail(email)}</span>
        </div>
      )}
    </section>
  )
}
