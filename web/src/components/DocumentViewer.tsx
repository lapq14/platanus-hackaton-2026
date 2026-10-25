import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { openInvoiceDocument } from '../lib/storage'
import type { Invoice } from '../types'
import Modal from './Modal'

/**
 * Lists the documents of an invoice. Each one opens in a new tab through a 60 s signed URL minted by the server:
 * documents of verified invoices are public, the rest require the owner's (or an auditor's) session.
 */
export default function DocumentViewer({ invoice, onClose }: { invoice: Pick<Invoice, 'id' | 'number' | 'document_count'>; onClose: () => void }) {
  const { authenticated, getAccessToken } = usePrivy()
  const [error, setError] = useState<string | null>(null)
  const count = invoice.document_count

  const open = async (index: number) => {
    setError(null)
    try {
      await openInvoiceDocument(invoice.id, index, authenticated ? getAccessToken : undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos abrir el documento. Intenta de nuevo.')
    }
  }

  return (
    <Modal title={`Documentos · ${invoice.number}`} onClose={onClose} maxWidth={520}>
      {count === 0 ? (
        <p style={{ margin: 0, color: '#5A5468' }}>Esta factura no tiene documentos adjuntos todavía.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => void open(i)}
              style={{ border: '1.5px solid #DAD4CF', borderRadius: '12px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', background: '#FFFFFF', color: '#1B1530', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
            >
              <span style={{ width: '100%', height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F6F4EF', borderRadius: '8px', fontFamily: "'IBM Plex Mono', monospace" }}>
                DOC
              </span>
              Documento {i + 1}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '14px', color: '#8E1B47', fontWeight: 600 }}>
          {error}
        </p>
      )}
      <p style={{ margin: 0, fontSize: '12px', color: '#5A5468' }}>Los enlaces caducan a los 60 segundos.</p>
    </Modal>
  )
}
