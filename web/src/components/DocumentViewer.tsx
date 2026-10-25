import { useEffect, useState } from 'react'
import { signedInvoiceUrl } from '../lib/storage'
import type { Invoice } from '../types'
import Modal from './Modal'

const isImage = (path: string) => /\.(jpe?g|png)$/i.test(path)

/** Viewer with thumbnails for invoices made of several photos / files. */
export default function DocumentViewer({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const paths = invoice.file_paths.length ? invoice.file_paths : invoice.file_path ? [invoice.file_path] : []
  const [urls, setUrls] = useState<(string | null)[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all(paths.map((p) => signedInvoiceUrl(p).catch(() => null))).then((res) => {
      if (cancelled) return
      setUrls(res)
      setError(res.some((u) => u === null))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id])

  return (
    <Modal title={`Documentos · ${invoice.number}`} onClose={onClose} maxWidth={620}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
        {paths.map((p, i) => {
          const url = urls[i]
          return (
            <a
              key={p}
              href={url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              style={{ border: '1.5px solid #DAD4CF', borderRadius: '12px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', textDecoration: 'none', color: '#1B1530', fontSize: '13px', fontWeight: 600 }}
            >
              {url && isImage(p) ? (
                <img src={url} alt={`Documento ${i + 1}`} style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px' }} />
              ) : (
                <span style={{ width: '100%', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F6F4EF', borderRadius: '8px', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {isImage(p) ? '…' : 'PDF'}
                </span>
              )}
              Documento {i + 1}
            </a>
          )
        })}
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '14px', color: '#8E1B47', fontWeight: 600 }}>
          Algunos documentos no se pudieron abrir. Intenta de nuevo.
        </p>
      )}
      <p style={{ margin: 0, fontSize: '12px', color: '#5A5468' }}>Los enlaces caducan a los 60 segundos.</p>
    </Modal>
  )
}
