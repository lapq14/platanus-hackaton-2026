import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import DocumentViewer from '../components/DocumentViewer'
import FoundationHeader from '../components/FoundationHeader'
import InvoiceReportModal from '../components/InvoiceReportModal'
import PageShell, { Notice } from '../components/PageShell'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import { useFoundationInvoices } from '../hooks/useFoundationInvoices'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useMyFoundation } from '../hooks/useMyFoundation'
import { formatDate, formatTokens, formatUSDT, shortHash } from '../lib/format'
import { hasFailedCheck } from '../lib/normalize'
import { openInvoiceDocument } from '../lib/storage'
import type { Invoice, InvoiceStatus } from '../types'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const PAGE_SIZE = 20

const FILTERS: { label: string; param: string | null; status: InvoiceStatus | null }[] = [
  { label: 'Todas', param: null, status: null },
  { label: 'Verificadas', param: 'verificadas', status: 'verified' },
  { label: 'En revisión', param: 'en-revision', status: 'in_review' },
  { label: 'Rechazadas', param: 'rechazadas', status: 'rejected' },
]

type SortKey = 'date' | 'amount'

/** Note under the concept: tranche + short hash when verified, reason when rejected, agent progress otherwise. */
function noteFor(i: Invoice): string {
  const tramo = i.tranche_index ? `Tramo ${i.tranche_index}` : 'Tramo'
  if (i.status === 'verified') return `${tramo}${i.file_hash ? ` · hash ${shortHash(i.file_hash)}` : ''}`
  if (i.status === 'rejected') return i.review_note ?? 'Factura rechazada'
  return hasFailedCheck(i) ? `${tramo} · revisión humana sugerida` : `${tramo} · agente revisando RIF`
}

/** Pending invoice flagged by the agent but without a human decision yet. */
const badgeStatus = (i: Invoice) => (i.status === 'in_review' && hasFailedCheck(i) ? ('suspicious' as const) : i.status)

function DocButton({ invoice, onMany, fullWidth }: { invoice: Invoice; onMany: () => void; fullWidth?: boolean }) {
  const [error, setError] = useState(false)
  const count = invoice.file_paths.length || (invoice.file_path ? 1 : 0)
  const disabled = count === 0
  const click = async () => {
    if (count > 1) return onMany()
    try {
      setError(false)
      await openInvoiceDocument(invoice.file_paths[0] ?? invoice.file_path ?? '')
    } catch {
      setError(true)
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          void click()
        }}
        title={disabled ? 'Esta factura no tiene documento adjunto' : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          minHeight: '36px',
          padding: '0 12px',
          width: fullWidth ? '100%' : undefined,
          borderRadius: '10px',
          border: '1.5px solid #1B1530',
          background: 'transparent',
          color: '#1B1530',
          fontFamily: 'inherit',
          fontSize: '13px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
        Ver PDF
      </button>
      {error && (
        <span role="alert" style={{ display: 'block', fontSize: '12px', color: '#8E1B47', fontWeight: 600 }}>
          No se pudo abrir.
        </span>
      )}
    </>
  )
}

export default function Facturas() {
  const { foundation, loading: loadingF } = useMyFoundation()
  const { invoices, loading, error } = useFoundationInvoices(foundation?.id)
  const [params, setParams] = useSearchParams()
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [report, setReport] = useState<Invoice | null>(null)
  const [viewer, setViewer] = useState<Invoice | null>(null)
  const compact = useMediaQuery('(max-width: 639px)')

  const active = FILTERS.find((f) => f.param === params.get('estado')) ?? FILTERS[0]
  const counts = useMemo(
    () => ({
      all: invoices.length,
      verified: invoices.filter((i) => i.status === 'verified').length,
      in_review: invoices.filter((i) => i.status === 'in_review').length,
      rejected: invoices.filter((i) => i.status === 'rejected').length,
    }),
    [invoices],
  )
  const totalVerified = invoices.filter((i) => i.status === 'verified').reduce((s, i) => s + i.amount, 0)

  const rows = useMemo(() => {
    const filtered = active.status ? invoices.filter((i) => i.status === active.status) : invoices
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) =>
      sort.key === 'amount' ? (a.amount - b.amount) * dir : (new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime()) * dir,
    )
  }, [invoices, active, sort])
  const visible = rows.slice(0, limit)

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none')

  if (loadingF) {
    return (
      <PageShell minHeight={1000}>
        <Notice>Cargando tus facturas…</Notice>
      </PageShell>
    )
  }
  if (!foundation) {
    return (
      <PageShell minHeight={1000}>
        <Notice title="Aún no tienes una fundación registrada">
          <Link to="/registro">Registrar mi fundación →</Link>
        </Notice>
      </PageShell>
    )
  }

  const rejectedProps = (i: Invoice) =>
    i.status === 'rejected'
      ? {
          tabIndex: 0,
          'aria-label': `Ver informe de la factura ${i.number}`,
          onClick: () => setReport(i),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setReport(i)
            }
          },
        }
      : {}

  const sortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', fontWeight: 600, letterSpacing: 'inherit', color: 'inherit', cursor: 'pointer' }}
    >
      {label} {sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  )

  return (
    <PageShell minHeight={1000}>
      <FoundationHeader active="facturas" level={foundation.level} reputation={foundation.reputation_score} />
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <h1 style={{ margin: 0, fontSize: '40px', fontWeight: 800, letterSpacing: '-1.5px' }}>Facturas enviadas</h1>
            <p style={{ margin: 0, fontSize: '16px', color: '#5A5468' }}>Sin factura, no hay siguiente paso. Aquí ves el resultado de cada auditoría.</p>
          </div>
          <Link
            to="/panel#sellar"
            style={{ minHeight: '48px', padding: '0 20px', borderRadius: '12px', background: '#B4235A', color: '#FFFFFF', fontWeight: 700, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V4" />
              <path d="m6 10 6-6 6 6" />
              <path d="M4 20h16" />
            </svg>
            Subir nueva factura
          </Link>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <StatCard label="Total verificado" value={formatUSDT(totalVerified)} />
          <StatCard label="Verificadas" value={counts.verified} valueColor="#135E3C" />
          <StatCard label="En revisión" value={counts.in_review} valueColor="#6B4A00" />
          <StatCard label="Rechazadas" value={counts.rejected} valueColor="#8E1B47" />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }} role="group" aria-label="Filtrar por estado">
          {FILTERS.map((f) => {
            const on = f === active
            const n = f.status ? counts[f.status] : counts.all
            return (
              <button
                key={f.label}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = new URLSearchParams(params)
                  if (f.param) next.set('estado', f.param)
                  else next.delete('estado')
                  setParams(next, { replace: true })
                  setLimit(PAGE_SIZE)
                }}
                style={{ minHeight: '40px', padding: '0 16px', borderRadius: '999px', border: `1.5px solid ${on ? '#1B1530' : '#DAD4CF'}`, background: on ? '#1B1530' : '#FFFFFF', color: on ? '#F8F8F8' : '#1B1530', fontFamily: 'inherit', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              >
                {f.label} · {n}
              </button>
            )
          })}
        </div>

        {error && (
          <p role="alert" style={{ margin: 0, color: '#8E1B47', fontWeight: 600 }}>
            No pudimos cargar tus facturas. Intenta de nuevo en unos segundos.
          </p>
        )}

        {compact ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {visible.map((i) => (
              <div
                key={i.id}
                {...rejectedProps(i)}
                style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', cursor: i.status === 'rejected' ? 'pointer' : 'default' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span style={{ ...MONO, fontSize: '13px', whiteSpace: 'nowrap' }}>{i.number}</span>
                  <StatusBadge status={badgeStatus(i)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 600 }}>{i.concept}</span>
                  <span style={{ fontSize: '12px', color: '#5A5468' }}>{noteFor(i)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ ...MONO, fontWeight: 600 }}>{formatUSDT(i.amount)}</span>
                    <span style={{ ...MONO, fontSize: '12px', color: '#3B3FB6' }}>{formatTokens(i.amount)}</span>
                  </div>
                  <span style={{ fontSize: '13px', color: '#5A5468' }}>{formatDate(i.uploaded_at)}</span>
                </div>
                <DocButton invoice={i} onMany={() => setViewer(i)} fullWidth />
              </div>
            ))}
            {!loading && visible.length === 0 && <p style={{ margin: 0, padding: '28px 0', textAlign: 'center', color: '#5A5468' }}>No hay facturas con este estado.</p>}
          </div>
        ) : (
          <div style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '16px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', minWidth: '860px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#5A5468', fontSize: '12px', letterSpacing: '0.6px' }}>
                  <th style={{ padding: '14px 18px', fontWeight: 600 }}>N° FACTURA</th>
                  <th style={{ padding: '14px 18px', fontWeight: 600 }}>CONCEPTO</th>
                  <th aria-sort={ariaSort('amount')} style={{ padding: '14px 18px', fontWeight: 600 }}>
                    {sortButton('amount', 'MONTO')}
                  </th>
                  <th aria-sort={ariaSort('date')} style={{ padding: '14px 18px', fontWeight: 600 }}>
                    {sortButton('date', 'SUBIDA')}
                  </th>
                  <th style={{ padding: '14px 18px', fontWeight: 600 }}>ESTADO</th>
                  <th style={{ padding: '14px 18px', fontWeight: 600 }}>DOCUMENTO</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.id} {...rejectedProps(i)} style={{ borderTop: '1px solid #ECE7F0', cursor: i.status === 'rejected' ? 'pointer' : 'default' }}>
                    <td style={{ padding: '16px 18px', ...MONO, fontSize: '13px', whiteSpace: 'nowrap' }}>{i.number}</td>
                    <td style={{ padding: '16px 18px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontWeight: 600 }}>{i.concept}</span>
                        <span style={{ fontSize: '12px', color: '#5A5468' }}>{noteFor(i)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 18px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ ...MONO, fontWeight: 600 }}>{formatUSDT(i.amount)}</span>
                        <span style={{ ...MONO, fontSize: '12px', color: '#3B3FB6' }}>{formatTokens(i.amount)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 18px', whiteSpace: 'nowrap', color: '#5A5468' }}>{formatDate(i.uploaded_at)}</td>
                    <td style={{ padding: '16px 18px' }}>
                      <StatusBadge status={badgeStatus(i)} />
                    </td>
                    <td style={{ padding: '16px 18px' }}>
                      <DocButton invoice={i} onMany={() => setViewer(i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && visible.length === 0 && <p style={{ margin: 0, padding: '28px 18px', textAlign: 'center', color: '#5A5468' }}>No hay facturas con este estado.</p>}
          </div>
        )}

        {rows.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
            style={{ alignSelf: 'center', minHeight: '44px', padding: '0 22px', borderRadius: '12px', border: '1.5px solid #1B1530', background: '#FFFFFF', color: '#1B1530', fontFamily: 'inherit', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
          >
            Cargar más
          </button>
        )}

        <p style={{ margin: 0, fontSize: '13px', color: '#5A5468' }}>Una factura rechazada congela la fundación y devuelve la custodia a los donantes.</p>
      </div>
      {report && <InvoiceReportModal invoice={report} onClose={() => setReport(null)} />}
      {viewer && <DocumentViewer invoice={viewer} onClose={() => setViewer(null)} />}
    </PageShell>
  )
}
