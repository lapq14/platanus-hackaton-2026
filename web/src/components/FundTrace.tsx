import { useState, type CSSProperties } from 'react'
import type { TraceState } from '../hooks/useFoundationTrace'
import { formatDate, formatUSDT } from '../lib/format'
import type { TraceContribution, TraceInvoice } from '../types'
import DocumentViewer from './DocumentViewer'
import StatCard from './StatCard'
import StatusBadge from './StatusBadge'
import TramoIcon from './TramoIcon'
import TxLink from './TxLink'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const CARD: CSSProperties = { background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }
const SUMMARY: CSSProperties = { cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#3B3FB6' }

const TRANCHE_STATE: Record<string, string> = {
  released: 'entregado',
  in_review: 'desbloqueándose',
  in_custody: 'en custodia',
  broken: 'devuelto',
}

function InvoiceCard({ inv, onDocs }: { inv: TraceInvoice; onDocs: (i: TraceInvoice) => void }) {
  const funded = inv.funded_by
  const allocated = inv.allocated_amount ?? 0
  return (
    <article style={CARD}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
        <strong style={{ fontSize: '17px' }}>{inv.concept}</strong>
        <span style={{ ...MONO, fontSize: '17px', fontWeight: 600 }}>{formatUSDT(inv.amount)}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', fontSize: '13px', color: '#5A5468' }}>
        {inv.status === 'verified' && inv.agent_checks.some((c) => !c.passed) ? (
          <StatusBadge status="suspicious" size="sm" label="Verificado con observaciones" />
        ) : (
          <StatusBadge status={inv.status} size="sm" label={inv.status === 'verified' ? 'Verificado' : undefined} />
        )}
        <span style={MONO}>{inv.number}</span>
        <span>
          {inv.supplier_name ? `${inv.supplier_name} · ` : ''}
          <span style={MONO}>{inv.supplier_rif}</span>
        </span>
        <span>{formatDate(inv.reviewed_at ?? inv.uploaded_at)}</span>
      </div>
      {inv.status === 'rejected' && inv.review_note && <span style={{ fontSize: '13px', color: '#8E1B47', fontWeight: 600 }}>{inv.review_note}</span>}
      {inv.agent_checks.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: '12px' }}>
          {inv.agent_checks.map((c) => (
            <li key={c.id} style={{ color: c.passed ? '#135E3C' : '#8E1B47', fontWeight: 600 }}>
              {c.passed ? '✓' : '✗'} {c.label}
            </li>
          ))}
        </ul>
      )}
      {inv.status === 'verified' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', fontSize: '13px' }}>
          {inv.document_count > 0 ? (
            <button type="button" onClick={() => onDocs(inv)} style={{ ...SUMMARY, background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}>
              Ver factura ({inv.document_count})
            </button>
          ) : (
            <span style={{ color: '#5A5468' }}>Sin documentos adjuntos</span>
          )}
          {inv.release_tx_hash && <TxLink hash={inv.release_tx_hash} label="desbloqueo tx" style={{ ...MONO, fontSize: '12px', textDecoration: 'none' }} />}
        </div>
      )}
      {inv.status === 'verified' &&
        (funded.length > 0 ? (
          <details>
            <summary style={SUMMARY}>
              Pagado con {funded.length} {funded.length === 1 ? 'aporte' : 'aportes'} · {formatUSDT(allocated)} atribuidos
            </summary>
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {funded.map((f, i) => (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '13px', background: '#F6F4EF', borderRadius: '10px', padding: '7px 12px' }}>
                  <span>
                    <span style={MONO}>Aporte {f.contribution}</span> · {formatDate(f.donated_at)} · tramo {f.tranche_index}
                  </span>
                  <span style={{ ...MONO, fontWeight: 600 }}>{formatUSDT(f.amount)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span style={{ fontSize: '12px', color: '#5A5468' }}>Gasto verificado antes de que existiera el rastro por aporte.</span>
        ))}
    </article>
  )
}

function ContributionCard({ c }: { c: TraceContribution }) {
  const refunded = c.status === 'refunded'
  return (
    <article style={CARD}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
        <strong style={{ ...MONO, fontSize: '15px' }}>Aporte {c.ref}</strong>
        <span style={{ ...MONO, fontSize: '16px', fontWeight: 600 }}>{formatUSDT(c.total)}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#5A5468' }}>
        <span>{formatDate(c.donated_at)}</span>
        {refunded && <span style={{ color: '#8E1B47', fontWeight: 600 }}>Reembolsado al donante</span>}
        <span style={{ display: 'inline-flex', gap: '4px' }}>
          {c.tranches.map((t) => (
            <TramoIcon key={t.index} state={t.state} size={18} />
          ))}
        </span>
      </div>
      <details>
        <summary style={SUMMARY}>Ver los {c.tranches.length} tramos</summary>
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {c.tranches.map((t) => {
            const used = t.uses.reduce((s, u) => s + u.amount, 0)
            return (
              <li key={t.index} style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span>
                    <strong>Tramo {t.index}</strong> · {TRANCHE_STATE[t.state] ?? t.state}
                    {t.released_at ? ` · ${formatDate(t.released_at)}` : ''}
                  </span>
                  <span style={{ ...MONO, fontWeight: 600 }}>{formatUSDT(t.amount)}</span>
                </div>
                {t.state === 'released' && (
                  <span style={{ color: '#5A5468' }}>
                    Usado {formatUSDT(used)} · disponible {formatUSDT(t.remaining)}
                  </span>
                )}
                {t.uses.map((u) => (
                  <span key={u.invoice_id} style={{ background: '#F6F4EF', borderRadius: '8px', padding: '5px 10px' }}>
                    {formatUSDT(u.amount)} en {u.concept ?? 'un gasto'} {u.number ? `· Factura ${u.number}` : ''}
                  </span>
                ))}
              </li>
            )
          })}
        </ul>
      </details>
    </article>
  )
}

/**
 * Public traceability of a foundation's funds: where every dollar is (received, delivered, in custody, spent) and
 * which contributions paid for each verified expense. Needs no login and never shows donor identities.
 */
export default function FundTrace({ state }: { state: TraceState }) {
  const { trace, loading, error } = state
  const [docs, setDocs] = useState<TraceInvoice | null>(null)

  return (
    <section id="rastro" style={{ display: 'flex', flexDirection: 'column', gap: '16px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <h2 style={{ margin: 0, fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px' }}>Rastro público del dinero</h2>
        <p style={{ margin: 0, fontSize: '15px', color: '#5A5468', maxWidth: '640px' }}>
          Cualquier persona puede ver adónde fue el dinero de esta fundación. Los aportes se muestran con un código, sin datos de quien donó.
        </p>
      </div>
      {loading && <p style={{ margin: 0, color: '#5A5468' }}>Cargando el rastro…</p>}
      {error && (
        <p role="alert" style={{ margin: 0, color: '#8E1B47', fontWeight: 600 }}>
          No pudimos cargar el rastro. Intenta de nuevo en unos segundos.
        </p>
      )}
      {trace && (
        <>
          {trace.stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              <StatCard label="Entregado a la fundación" value={formatUSDT(trace.stats.released_total)} valueSize={22} padding="14px 16px" />
              <StatCard label="Gastado y verificado" value={formatUSDT(trace.stats.spent_total)} valueSize={22} padding="14px 16px" />
              <StatCard label="Disponible para gastar" value={formatUSDT(trace.stats.available_balance)} valueSize={22} padding="14px 16px" />
              <StatCard label="En custodia" value={formatUSDT(trace.stats.custody_total)} variant="dashed" valueSize={22} padding="14px 16px" />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700 }}>Gastos reportados</h3>
            {trace.invoices.length === 0 ? (
              <p style={{ margin: 0, color: '#5A5468' }}>Esta fundación aún no ha reportado gastos.</p>
            ) : (
              trace.invoices.map((inv) => <InvoiceCard key={inv.id} inv={inv} onDocs={setDocs} />)
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700 }}>Aportes recibidos</h3>
            {trace.contributions.length === 0 ? (
              <p style={{ margin: 0, color: '#5A5468' }}>Aún no recibió aportes a través de Rastro.</p>
            ) : (
              [...trace.contributions].reverse().map((c) => <ContributionCard key={c.ref + c.donated_at + c.total} c={c} />)
            )}
          </div>
        </>
      )}
      {docs && <DocumentViewer invoice={docs} onClose={() => setDocs(null)} />}
    </section>
  )
}
