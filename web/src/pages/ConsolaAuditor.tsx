import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import AgentChecks from '../components/AgentChecks'
import AuditorHeader from '../components/AuditorHeader'
import Modal from '../components/Modal'
import PageShell, { Notice } from '../components/PageShell'
import { approveInvoice, reportInvoice } from '../lib/auditor-actions'
import { formatUSDT, formatUSDTCompact, shortHash } from '../lib/format'
import { signedInvoiceUrl } from '../lib/storage'
import { useAuditQueue, type QueueItem } from '../hooks/useAuditQueue'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }

type QueueState = 'awaiting' | 'problem' | 'analyzing'

/** Display state of a queued invoice, derived from the agent_checks written by the audit agent. */
function stateOf(item: QueueItem): QueueState {
  const checks = item.invoice.agent_checks
  if (checks.length === 0) return 'analyzing'
  const ripFailed = checks.some((c) => !c.passed && (c.id === 'rif_exists' || c.id === 'name_match'))
  return ripFailed ? 'problem' : 'awaiting'
}

const STATE_ORDER: Record<QueueState, number> = { awaiting: 0, problem: 1, analyzing: 2 }

function stateLine(item: QueueItem): { text: string; color: string } {
  const tramo = item.invoice.tranche_index ? `Tramo ${item.invoice.tranche_index}` : 'Tramo'
  switch (stateOf(item)) {
    case 'awaiting':
      return { text: `${tramo} · esperando decisión`, color: '#8A5A00' }
    case 'problem':
      return { text: 'RIF no coincide · problema de datos', color: '#B4235A' }
    case 'analyzing':
      return { text: `${tramo} · analizando`, color: '#5A5468' }
  }
}

function Preview({ invoice }: { invoice: QueueItem['invoice'] }) {
  const path = invoice.file_paths[0] ?? invoice.file_path
  const [url, setUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setZoom(false)
    if (path) {
      void signedInvoiceUrl(path)
        .then((u) => !cancelled && setUrl(u))
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [path])

  const box: CSSProperties = { flex: '1 1 200px', minHeight: '260px', border: '1.5px dashed #8A8296', borderRadius: '12px', background: '#F6F4EF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: '#5A5468', overflow: 'auto' }
  if (!path || !url) return <div style={box}>{path ? 'Cargando vista previa…' : 'Vista previa no disponible'}</div>
  if (/\.pdf$/i.test(path)) {
    return (
      <div style={{ ...box, border: '1.5px solid #DAD4CF', padding: 0 }}>
        <iframe title="Vista previa de la factura" src={url} style={{ width: '100%', height: '100%', minHeight: '260px', border: 'none' }} />
      </div>
    )
  }
  return (
    <div style={{ ...box, border: '1.5px solid #DAD4CF', alignItems: zoom ? 'flex-start' : 'center' }}>
      <img
        src={url}
        alt="Factura"
        onClick={() => setZoom((z) => !z)}
        style={{ width: zoom ? '200%' : '100%', maxWidth: zoom ? 'none' : '100%', cursor: zoom ? 'zoom-out' : 'zoom-in' }}
      />
    </div>
  )
}

export default function ConsolaAuditor() {
  const { items, loading, error } = useAuditQueue()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modal, setModal] = useState<'approve' | 'report' | null>(null)
  const [reason, setReason] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const queue = useMemo(() => [...items].sort((a, b) => STATE_ORDER[stateOf(a)] - STATE_ORDER[stateOf(b)]), [items])
  const selected = queue.find((q) => q.invoice.id === selectedId) ?? queue[0] ?? null

  const closeModal = () => {
    setModal(null)
    setReason('')
    setConfirmName('')
  }

  // Keyboard shortcuts: up/down move in the queue, A approve, R report (always with confirmation).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (modal || el.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      const idx = queue.findIndex((q) => q.invoice.id === selected?.invoice.id)
      if (e.key === 'ArrowDown' && idx < queue.length - 1) {
        e.preventDefault()
        setSelectedId(queue[idx + 1].invoice.id)
      } else if (e.key === 'ArrowUp' && idx > 0) {
        e.preventDefault()
        setSelectedId(queue[idx - 1].invoice.id)
      } else if (selected && stateOf(selected) !== 'analyzing' && e.key.toLowerCase() === 'a') {
        setModal('approve')
      } else if (selected && stateOf(selected) !== 'analyzing' && e.key.toLowerCase() === 'r') {
        setModal('report')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [queue, selected, modal])

  const confirmApprove = async () => {
    if (!selected) return
    await approveInvoice(selected.invoice)
    closeModal()
    setNotice('Acción pendiente de integrar: la liberación real llega con la fase del agente. No se modificó nada.')
  }

  const reasonOk = reason.trim().length >= 20
  const nameOk = !!selected && confirmName.trim().toLowerCase() === selected.foundationName.trim().toLowerCase()
  const confirmReport = async () => {
    if (!selected || !reasonOk || !nameOk) return
    await reportInvoice(selected.invoice, reason.trim())
    closeModal()
    setNotice('Acción pendiente de integrar: el reembolso real llega con la fase del agente. No se modificó nada.')
  }

  const passed = selected?.invoice.agent_checks.filter((c) => c.passed).length ?? 0
  const total = selected?.invoice.agent_checks.length ?? 0
  const analyzing = !!selected && stateOf(selected) === 'analyzing'

  return (
    <PageShell minHeight={1000}>
      <AuditorHeader />
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <h1 style={{ margin: 0, fontSize: '40px', fontWeight: 800, letterSpacing: '-1.5px' }}>Cola de auditoría</h1>
          <p style={{ margin: 0, fontSize: '16px', color: '#5A5468' }}>El agente verifica cada factura y RIF. Tú confirmas el sello o lo rompes.</p>
        </div>
        {notice && (
          <div role="status" style={{ border: '1.5px solid #E8A317', background: '#FBEFD3', color: '#6B4A00', borderRadius: '12px', padding: '12px 14px', fontWeight: 600, fontSize: '14px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            {notice}
            <button type="button" onClick={() => setNotice(null)} style={{ border: 'none', background: 'transparent', fontFamily: 'inherit', fontWeight: 700, color: '#6B4A00', cursor: 'pointer' }}>
              Cerrar
            </button>
          </div>
        )}
        {loading ? (
          <Notice>Cargando la cola…</Notice>
        ) : error ? (
          <Notice title="No pudimos cargar la cola">Intenta de nuevo en unos segundos.</Notice>
        ) : !selected ? (
          <Notice title="La cola está vacía">No hay facturas esperando decisión.</Notice>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '10px' }} role="listbox" aria-label="Cola de auditoría">
              {queue.map((q) => {
                const on = q.invoice.id === selected.invoice.id
                const st = stateLine(q)
                return (
                  <button
                    key={q.invoice.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => setSelectedId(q.invoice.id)}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      fontFamily: 'inherit',
                      color: '#1B1530',
                      background: '#FFFFFF',
                      // Same 2px footprint for every card so the layout never jumps on selection.
                      border: `2px solid ${on ? '#1B1530' : '#DAD4CF'}`,
                      borderRadius: '14px',
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <strong style={{ fontSize: '15px' }}>{q.foundationName}</strong>
                      <span style={{ ...MONO, fontSize: '14px', fontWeight: 600 }}>{formatUSDTCompact(q.invoice.amount)}</span>
                    </div>
                    <span style={{ fontSize: '13px', color: '#5A5468' }}>
                      Factura {q.invoice.number} · {q.invoice.concept}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: st.color }}>{st.text}</span>
                  </button>
                )
              })}
              <span style={{ fontSize: '12px', color: '#5A5468' }}>Atajos: ↑/↓ mover · A aprobar · R reportar</span>
            </div>
            <section style={{ flex: '999 1 560px', minWidth: 0, background: '#FFFFFF', border: '1.5px solid #1B1530', borderRadius: '20px', padding: '26px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ ...MONO, fontSize: '12px', letterSpacing: '1.2px', color: '#5A5468' }}>
                    {selected.foundationName.toUpperCase()}
                    {selected.invoice.tranche_index ? ` · TRAMO ${selected.invoice.tranche_index}` : ''}
                  </span>
                  <span style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px' }}>
                    Factura {selected.invoice.number} · {selected.invoice.concept}
                  </span>
                  {selected.invoice.file_hash && <span style={{ ...MONO, fontSize: '13px', color: '#3B3FB6' }}>hash {shortHash(selected.invoice.file_hash)}</span>}
                </div>
                <span style={{ ...MONO, fontSize: '28px', fontWeight: 600 }}>{formatUSDT(selected.invoice.amount)}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
                <Preview invoice={selected.invoice} />
                <div style={{ flex: '2 1 300px', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#5A5468', paddingBottom: '6px' }}>
                    VERIFICACIONES DEL AGENTE{total > 0 ? ` · ${passed} DE ${total}` : ''}
                  </span>
                  {total > 0 ? <AgentChecks checks={selected.invoice.agent_checks} /> : <p style={{ margin: 0, fontSize: '14px', color: '#5A5468' }}>El agente está analizando esta factura…</p>}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', paddingTop: '20px', borderTop: '1.5px dashed #DAD4CF' }}>
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={() => setModal('approve')}
                  style={{ flex: '1 1 240px', minHeight: '54px', borderRadius: '12px', border: 'none', background: analyzing ? '#ECE7F0' : '#1A7F52', color: analyzing ? '#5A5468' : '#FFFFFF', fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: analyzing ? 'not-allowed' : 'pointer' }}
                >
                  Completar y liberar {formatUSDTCompact(selected.invoice.amount)}
                </button>
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={() => setModal('report')}
                  style={{ flex: '1 1 240px', minHeight: '54px', borderRadius: '12px', border: '2px solid #B4235A', background: 'transparent', color: '#B4235A', fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.5 : 1 }}
                >
                  Reportar y reembolsar
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: '#5A5468' }}>
                Romper el sello congela la fundación, devuelve la custodia a {selected.affectedDonors} {selected.affectedDonors === 1 ? 'donante' : 'donantes'} desde el fondo de reserva y les envía un correo.
              </p>
            </section>
          </div>
        )}
      </div>

      {modal === 'approve' && selected && (
        <Modal title="Completar y liberar" onClose={closeModal} maxWidth={460}>
          <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.5 }}>
            Se liberarán <strong>{formatUSDT(selected.invoice.amount)}</strong> a <strong>{selected.foundationName}</strong>.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void confirmApprove()} style={{ flex: 1, minHeight: '48px', borderRadius: '12px', border: 'none', background: '#1A7F52', color: '#FFFFFF', fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: 'pointer' }}>
              Confirmar
            </button>
            <button type="button" onClick={closeModal} style={{ flex: 1, minHeight: '48px', borderRadius: '12px', border: '1.5px solid #1B1530', background: 'transparent', color: '#1B1530', fontFamily: 'inherit', fontSize: '16px', fontWeight: 600, cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </Modal>
      )}
      {modal === 'report' && selected && (
        <Modal title="Reportar y reembolsar" onClose={closeModal} maxWidth={520}>
          <p style={{ margin: 0, fontSize: '14px', color: '#5A5468', lineHeight: 1.5 }}>
            Esto congela a {selected.foundationName} y devuelve la custodia a {selected.affectedDonors} {selected.affectedDonors === 1 ? 'donante' : 'donantes'}.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600 }}>
            Motivo (mínimo 20 caracteres)
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ borderRadius: '10px', border: '1.5px solid #1B1530', padding: '10px 14px', fontFamily: 'inherit', fontSize: '15px', resize: 'vertical' }}
            />
            <span style={{ ...MONO, fontSize: '12px', color: reasonOk ? '#135E3C' : '#5A5468' }}>{reason.trim().length}/20</span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600 }}>
            Escribe el nombre de la fundación para confirmar: <span style={{ fontWeight: 400, color: '#5A5468' }}>{selected.foundationName}</span>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              style={{ minHeight: '46px', borderRadius: '10px', border: '1.5px solid #1B1530', padding: '0 14px', fontFamily: 'inherit', fontSize: '15px' }}
            />
          </label>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={!reasonOk || !nameOk}
              onClick={() => void confirmReport()}
              style={{ flex: 1, minHeight: '48px', borderRadius: '12px', border: 'none', background: reasonOk && nameOk ? '#B4235A' : '#ECE7F0', color: reasonOk && nameOk ? '#FFFFFF' : '#5A5468', fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: reasonOk && nameOk ? 'pointer' : 'not-allowed' }}
            >
              Confirmar reporte
            </button>
            <button type="button" onClick={closeModal} style={{ flex: 1, minHeight: '48px', borderRadius: '12px', border: '1.5px solid #1B1530', background: 'transparent', color: '#1B1530', fontFamily: 'inherit', fontSize: '16px', fontWeight: 600, cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
