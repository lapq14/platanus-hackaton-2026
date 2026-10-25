import { useState, type CSSProperties } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { ApiError, verifySpend, type VerifySpendResult } from '../lib/api'
import { formatUSDT, sha256Hex } from '../lib/format'
import { uploadViaServer } from '../lib/upload'
import type { OwnInvoice } from '../types'
import AgentChecks from './AgentChecks'
import Dropzone from './Dropzone'
import EvidenceDeadline from './EvidenceDeadline'
import Modal from './Modal'
import TxLink from './TxLink'

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5
const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }

interface SlotProps {
  title: string
  hint: string
  stored: boolean
  file: File | null
  onFile: (f: File | null) => void
  onError: (m: string | null) => void
}

function Slot({ title, hint, stored, file, onFile, onError }: SlotProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontSize: '14px', fontWeight: 600 }}>{title}</span>
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1.5px solid #1A7F52', borderRadius: '10px', padding: '8px 12px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          <button type="button" onClick={() => onFile(null)} style={{ border: 'none', background: 'transparent', color: '#8E1B47', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            Quitar
          </button>
        </div>
      ) : (
        <>
          {stored && <span style={{ fontSize: '12px', color: '#5A5468' }}>Se usará el documento ya guardado, a menos que subas uno nuevo.</span>}
          <Dropzone
            variant="box"
            accept="application/pdf,image/jpeg,image/png"
            icon="file"
            title={stored ? 'Reemplazar documento' : title}
            hint={hint}
            onFiles={(incoming) => {
              const f = incoming[0]
              if (!ALLOWED.includes(f.type) || f.size > MAX_BYTES) {
                onError(`"${f.name}" no es válido: usa PDF, JPG o PNG de hasta 10 MB.`)
                return
              }
              onError(null)
              onFile(f)
            }}
          />
        </>
      )}
    </div>
  )
}

interface Props {
  invoice: OwnInvoice
  maxAttempts: number
  onClose: () => void
  /** Called after any server answer so the lists refresh. */
  onDone: () => void
}

/**
 * Retry of an open spend: replace any of the documents (the ones not replaced are kept) and verify again.
 * The spend stays open for 7 days and for up to `maxAttempts` verifications; the last failed attempt is a rejection.
 */
export default function RetryEvidenceModal({ invoice, maxAttempts, onClose, onDone }: Props) {
  const { getAccessToken } = usePrivy()
  const [origin, setOrigin] = useState<File | null>(null)
  const [dest, setDest] = useState<File | null>(null)
  const [docs, setDocs] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'verifying'>('idle')
  const [result, setResult] = useState<VerifySpendResult | null>(null)

  const attempts = result?.attempts ?? invoice.attempts ?? 0
  const lastAttempt = attempts + 1 >= maxAttempts
  const needsOrigin = !invoice.has_origin_doc
  const needsDest = !invoice.has_destination_doc
  // Missing documents must be uploaded; anything else is optional, but a retry with nothing stored and nothing new makes no sense.
  const canSend = (!needsOrigin || !!origin) && (!needsDest || !!dest)

  const submit = async () => {
    setError(null)
    setBusy('uploading')
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión de nuevo.')
      const origin_path = origin ? await uploadViaServer('spend_origin', origin, token) : undefined
      const destination_path = dest ? await uploadViaServer('spend_destination', dest, token) : undefined
      const invoice_paths: string[] = []
      for (const f of docs) invoice_paths.push(await uploadViaServer('invoice', f, token))
      const hashes = await Promise.all(docs.map(sha256Hex))
      setBusy('verifying')
      const verdict = await verifySpend(token, {
        invoice_id: invoice.id,
        origin_path,
        destination_path,
        ...(invoice_paths.length ? { invoice_paths, file_hash: hashes[0] ?? null, file_hashes: hashes } : {}),
      })
      setResult(verdict)
      setOrigin(null)
      setDest(null)
      setDocs([])
      onDone()
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'No pudimos verificar el gasto. Intenta de nuevo.')
    } finally {
      setBusy('idle')
    }
  }

  const finished = result !== null && result.status !== 'needs_changes'
  const tone = !result ? null : result.status === 'verified' ? { b: '#1A7F52', bg: '#E6F4EC' } : result.status === 'rejected' ? { b: '#B4235A', bg: '#F8E9EF' } : { b: '#E8A317', bg: '#FBEFD3' }

  return (
    <Modal title="Respaldar este gasto" onClose={onClose} maxWidth={600}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <strong style={{ fontSize: '17px' }}>
          Factura {invoice.number} · {invoice.concept}
        </strong>
        <span style={{ ...MONO, fontSize: '13px', color: '#5A5468' }}>
          {formatUSDT(invoice.amount)} · {invoice.supplier_rif}
        </span>
        <EvidenceDeadline dueAt={result?.evidence_due_at ?? invoice.evidence_due_at} suspicious={invoice.suspicious_at} />
      </div>

      {!finished && (
        <p style={{ margin: 0, fontSize: '14px', color: '#5A5468', lineHeight: 1.5, background: '#F4F1F7', borderRadius: '12px', padding: '12px 14px' }}>
          Puedes corregir los documentos que quieras y volver a verificar. Llevas{' '}
          <strong style={{ color: '#1B1530' }}>
            {attempts} de {maxAttempts}
          </strong>{' '}
          intentos.{' '}
          {lastAttempt
            ? 'Este es tu último intento: si falla, el gasto se rechaza y la fundación se congela.'
            : 'Un gasto abierto más de 7 días sin respaldo se vuelve sospechoso y baja el nivel de la fundación a 1.'}
        </p>
      )}

      {invoice.agent_checks.length > 0 && !result && (
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#5A5468' }}>LO QUE DIJO EL AGENTE EN EL ÚLTIMO INTENTO</span>
          {invoice.review_note && <p style={{ margin: '6px 0 0', fontSize: '14px', color: '#8E1B47', fontWeight: 600 }}>{invoice.review_note}</p>}
          <AgentChecks checks={invoice.agent_checks} />
        </div>
      )}

      {result && tone && (
        <div role="status" style={{ border: `1.5px solid ${tone.b}`, background: tone.bg, borderRadius: '14px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <strong>{result.status === 'verified' ? 'Gasto verificado' : result.status === 'rejected' ? 'Gasto rechazado' : 'Aún falta respaldo'}</strong>
          <span style={{ fontSize: '13px', color: '#5A5468' }}>{result.review_note}</span>
          {result.status === 'verified' && result.release?.status === 'released' && result.release.released_count > 0 && (
            <span style={{ fontSize: '13px', fontWeight: 600 }}>
              Se desbloquearon {formatUSDT(result.release.released_usd)}.{' '}
              {result.release.tx_hash && <TxLink hash={result.release.tx_hash} label="tx" style={{ ...MONO, textDecoration: 'none' }} />}
            </span>
          )}
          {result.status === 'rejected' && result.refund && (
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#8E1B47' }}>
              La fundación quedó congelada y se reembolsó {formatUSDT(result.refund.refunded_usd)} a {result.refund.refunds} {result.refund.refunds === 1 ? 'donación' : 'donaciones'}. Puedes enviar una apelación desde Perfil.
            </span>
          )}
          <AgentChecks checks={result.checks} />
        </div>
      )}

      {!finished && (
        <fieldset disabled={busy !== 'idle'} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
          <Slot title="Comprobante de cuenta de origen" hint="Prueba de que la cuenta es de la fundación" stored={!needsOrigin} file={origin} onFile={setOrigin} onError={setError} />
          <Slot title="Documento con RIF y cuenta del negocio" hint="RIF y cuenta de destino del negocio" stored={!needsDest} file={dest} onFile={setDest} onError={setError} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Factura (opcional: reemplaza los archivos actuales)</span>
            <Dropzone
              variant="box"
              accept="application/pdf,image/jpeg,image/png"
              multiple
              title="Subir factura corregida"
              hint="PDF o fotos, hasta 5 archivos"
              onFiles={(incoming) => {
                const bad = incoming.find((f) => !ALLOWED.includes(f.type) || f.size > MAX_BYTES)
                if (bad) return setError(`"${bad.name}" no es válido: usa PDF, JPG o PNG de hasta 10 MB.`)
                if (docs.length + incoming.length > MAX_FILES) return setError(`Máximo ${MAX_FILES} archivos por factura.`)
                setError(null)
                setDocs((prev) => [...prev, ...incoming])
              }}
            />
            {docs.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{ display: 'flex', gap: '10px', fontSize: '13px' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <button type="button" onClick={() => setDocs((prev) => prev.filter((_, j) => j !== i))} style={{ border: 'none', background: 'transparent', color: '#8E1B47', fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer' }}>
                  Quitar
                </button>
              </div>
            ))}
          </div>
          {error && (
            <span role="alert" style={{ fontSize: '13px', color: '#8E1B47', fontWeight: 600 }}>
              {error}
            </span>
          )}
          <button
            type="button"
            disabled={!canSend || busy !== 'idle'}
            onClick={() => void submit()}
            style={{ minHeight: '50px', borderRadius: '12px', border: 'none', background: canSend && busy === 'idle' ? '#B4235A' : '#ECE7F0', color: canSend && busy === 'idle' ? '#FFFFFF' : '#5A5468', fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: busy !== 'idle' ? 'wait' : canSend ? 'pointer' : 'not-allowed' }}
          >
            {busy === 'uploading' ? 'Subiendo…' : busy === 'verifying' ? 'Verificando el gasto…' : 'Verificar de nuevo'}
          </button>
        </fieldset>
      )}
    </Modal>
  )
}
