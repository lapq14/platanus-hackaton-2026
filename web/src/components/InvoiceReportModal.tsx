import { formatDate, formatUSDT } from '../lib/format'
import type { Invoice } from '../types'
import AgentChecks from './AgentChecks'
import Modal from './Modal'

/** Audit report of an invoice: reviewer note plus the agent verifications. */
export default function InvoiceReportModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const passed = invoice.agent_checks.filter((c) => c.passed).length
  return (
    <Modal title="Informe de auditoría" onClose={onClose} maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <strong style={{ fontSize: '17px' }}>
          Factura {invoice.number} · {invoice.concept}
        </strong>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: '#5A5468' }}>
          {formatUSDT(invoice.amount)} · {invoice.supplier_rif} · subida el {formatDate(invoice.uploaded_at)}
        </span>
      </div>
      {invoice.review_note && (
        <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.5, background: '#F8E4EA', color: '#8E1B47', borderRadius: '12px', padding: '12px 14px', fontWeight: 600 }}>
          {invoice.review_note}
        </p>
      )}
      {invoice.agent_checks.length > 0 ? (
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#5A5468' }}>
            VERIFICACIONES DEL AGENTE · {passed} DE {invoice.agent_checks.length}
          </span>
          <AgentChecks checks={invoice.agent_checks} />
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: '14px', color: '#5A5468' }}>El agente aún no registró verificaciones para esta factura.</p>
      )}
    </Modal>
  )
}
