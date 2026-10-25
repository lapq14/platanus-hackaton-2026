import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import FoundationHeader from '../components/FoundationHeader'
import PageShell, { Notice } from '../components/PageShell'
import StatCard from '../components/StatCard'
import TxLink from '../components/TxLink'
import { UNLOCK_THRESHOLD_PCT } from '../config/levels'
import { useOwnFunds, useOwnProfile } from '../hooks/useOwnerData'
import { formatDate, formatUSDT, formatUSDTCompact } from '../lib/format'
import type { FundsContribution, FundsMilestone, TrancheState } from '../types'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }

const STATE: Record<TrancheState, { label: string; bg: string; fg: string }> = {
  released: { label: 'Entregado', bg: '#E2F1E9', fg: '#135E3C' },
  in_review: { label: 'Transferencia en curso', bg: '#FBEFD3', fg: '#6B4A00' },
  in_custody: { label: 'En custodia', bg: '#ECE7F0', fg: '#3B2F63' },
  broken: { label: 'Devuelto al donante', bg: '#F8E4EA', fg: '#8E1B47' },
}

function Bar({ pct, color = '#B4235A', marker }: { pct: number; color?: string; marker?: number }) {
  return (
    <div style={{ position: 'relative', height: '8px', borderRadius: '4px', background: '#ECE7F0' }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ height: '8px', width: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: '4px', background: color }} />
      {marker !== undefined && <div title={`Umbral de desbloqueo: ${marker}%`} style={{ position: 'absolute', top: '-3px', left: `${marker}%`, width: '2px', height: '14px', background: '#1B1530' }} />}
    </div>
  )
}

function Milestone({ m }: { m: FundsMilestone }) {
  return (
    <div style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '14px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '15px' }}>
          Aporte {m.contribution}: desbloquea el tramo {m.unlock_tranche}
        </strong>
        <span style={{ ...MONO, fontWeight: 600 }}>{formatUSDT(m.unlock_amount)}</span>
      </div>
      <Bar pct={(m.used_pct / UNLOCK_THRESHOLD_PCT) * 100} />
      <span style={{ fontSize: '13px', color: '#5A5468' }}>
        {m.spend_needed > 0 ? (
          <>
            Faltan al menos <strong style={{ color: '#1B1530' }}>{formatUSDT(m.spend_needed)}</strong> de gasto verificado para este desbloqueo, contando lo que va primero en la cola. El tramo actual lleva {m.used_pct}% usado y se desbloquea al llegar al {UNLOCK_THRESHOLD_PCT}%.
          </>
        ) : (
          'Ya cumple el umbral: se desbloquea con tu próximo gasto verificado.'
        )}
      </span>
    </div>
  )
}

function Contribution({ c }: { c: FundsContribution }) {
  const refunded = c.status === 'refunded'
  return (
    <article style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '16px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px', opacity: refunded ? 0.75 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <strong style={{ fontSize: '17px' }}>
            Aporte {c.ref} · {c.donor_label}
          </strong>
          <span style={{ fontSize: '13px', color: '#5A5468' }}>
            {formatDate(c.donated_at)}
            {c.initial_pct !== null ? ` · ${c.initial_pct}% entregado al inicio` : ''}
            {refunded ? ' · reembolsado' : ''}
          </span>
        </div>
        <span style={{ ...MONO, fontSize: '20px', fontWeight: 600 }}>{formatUSDT(c.total)}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {c.tranches.map((t) => {
          const used = t.amount - t.remaining
          const pct = t.state === 'released' && t.amount > 0 ? (used / t.amount) * 100 : 0
          const tone = STATE[t.state]
          return (
            <li key={t.index} style={{ borderTop: '1px solid #ECE7F0', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '14px', fontWeight: 600 }}>
                  Tramo {t.index} · <span style={MONO}>{formatUSDT(t.amount)}</span>
                </span>
                <span style={{ fontSize: '12px', fontWeight: 600, background: tone.bg, color: tone.fg, padding: '4px 10px', borderRadius: '999px' }}>{tone.label}</span>
              </div>
              {t.state === 'released' && (
                <>
                  <Bar pct={pct} marker={UNLOCK_THRESHOLD_PCT} />
                  <span style={{ fontSize: '12px', color: '#5A5468' }}>
                    Usado {formatUSDT(used)} ({Math.round(pct)}%) · disponible {formatUSDT(t.remaining)}
                    {t.tx_hash ? ' · ' : ''}
                    {t.tx_hash && <TxLink hash={t.tx_hash} label="tx" style={{ ...MONO, textDecoration: 'none' }} />}
                  </span>
                </>
              )}
              {t.uses.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#5A5468', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {t.uses.map((u, i) => (
                    <li key={`${u.invoice_id}-${i}`}>
                      {formatUSDT(u.amount)} en {u.concept ?? 'un gasto'}
                      {u.number ? ` (factura ${u.number})` : ''} · {formatDate(u.date)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </article>
  )
}

export default function FondosFundacion() {
  const profile = useOwnProfile()
  const funds = useOwnFunds()

  if (profile.loading || funds.loading) {
    return (
      <PageShell minHeight={1000}>
        <Notice>Cargando tus fondos…</Notice>
      </PageShell>
    )
  }
  if (!profile.data || !funds.data) {
    return (
      <PageShell minHeight={1000}>
        <Notice title="No pudimos cargar tus fondos">
          {funds.error ?? profile.error ?? 'Intenta de nuevo en unos segundos.'} <Link to="/panel">Volver al panel</Link>
        </Notice>
      </PageShell>
    )
  }

  const { foundation, stats } = profile.data
  const { summary, milestones, contributions } = funds.data

  return (
    <PageShell minHeight={1000}>
      <FoundationHeader active="fondos" level={foundation.level} reputation={foundation.reputation_score} reputationState={stats?.reputation_state} />
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <h1 style={{ margin: 0, fontSize: '40px', fontWeight: 800, letterSpacing: '-1.5px' }}>Fondos</h1>
          <p style={{ margin: 0, fontSize: '16px', color: '#5A5468' }}>
            Cada aporte se entrega por tramos. Lo que gastas se descuenta del aporte más antiguo, y cuando un tramo llega al {UNLOCK_THRESHOLD_PCT}% usado se desbloquea el siguiente del mismo aporte.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
          <StatCard label={`Recibido en ${summary.contributions_count} ${summary.contributions_count === 1 ? 'aporte' : 'aportes'}`} value={formatUSDTCompact(summary.received_total)} valueSize={30} />
          <StatCard label="Disponible para gastar" value={formatUSDTCompact(summary.available_balance ?? 0)} valueSize={30} />
          <StatCard label="Gastado y verificado" value={formatUSDTCompact(summary.spent_total ?? 0)} valueSize={30} />
          <StatCard label="En custodia" value={formatUSDTCompact(summary.custody_total ?? 0)} variant="dashed" valueSize={30} />
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Próximos desbloqueos</h2>
          {milestones.length === 0 ? (
            <p style={{ margin: 0, color: '#5A5468', fontSize: '15px' }}>
              No hay desbloqueos pendientes. Cuando recibas un aporte con tramos en custodia, aquí verás cuánto falta para liberar cada uno.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {milestones.map((m) => (
                <Milestone key={`${m.contribution}-${m.unlock_tranche}`} m={m} />
              ))}
              <span style={{ fontSize: '12px', color: '#5A5468' }}>
                El monto es una cota mínima: los tramos que se desbloqueen por el camino entran a la cola y pueden alejar los siguientes.
              </span>
            </div>
          )}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Aportes recibidos</h2>
          {contributions.length === 0 ? (
            <p style={{ margin: 0, color: '#5A5468', fontSize: '15px' }}>Todavía no has recibido aportes.</p>
          ) : (
            contributions.map((c) => <Contribution key={c.ref + c.donated_at} c={c} />)
          )}
          <p style={{ margin: 0, fontSize: '13px', color: '#5A5468' }}>Los donantes se muestran con un alias: nunca ves su identidad.</p>
        </section>
      </div>
    </PageShell>
  )
}
