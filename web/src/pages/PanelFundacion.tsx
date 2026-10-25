import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { usePrivy } from '@privy-io/react-auth'
import AgentChecks from '../components/AgentChecks'
import Dropzone from '../components/Dropzone'
import FoundationHeader from '../components/FoundationHeader'
import PageShell, { Notice } from '../components/PageShell'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import TxLink from '../components/TxLink'
import { LEVEL_MIN_REPUTATION, LEVEL_RELEASE, MAX_LEVEL, REP_PER_VERIFIED_INVOICE, UNLOCK_THRESHOLD_PCT, toLevel } from '../config/levels'
import EvidenceDeadline from '../components/EvidenceDeadline'
import { useMyFoundation } from '../hooks/useMyFoundation'
import { useOwnInvoices } from '../hooks/useOwnerData'
import { recordInvoiceHash } from '../lib/contract'
import { reportSpend, verifySpend, type VerifySpendResult } from '../lib/api'
import { formatUSDT, formatUSDTCompact, RIF_RE, sha256Hex } from '../lib/format'
import { uploadViaServer } from '../lib/upload'
import type { Foundation } from '../types'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png']

const INPUT: CSSProperties = { minHeight: '46px', borderRadius: '10px', border: '1.5px solid #1B1530', background: '#FFFFFF', padding: '0 14px', fontSize: '15px', color: '#1B1530', minWidth: 0 }
const LABEL: CSSProperties = { fontSize: '14px', fontWeight: 600 }
const FIELD_ERROR: CSSProperties = { fontSize: '13px', color: '#8E1B47', fontWeight: 600 }

interface FormValues {
  rif: string
  amount: number
  concept: string
}

/** Sha-256 of several file hashes (an invoice can have more than one photo). */
async function combineHashes(hashes: string[]): Promise<string> {
  if (hashes.length === 1) return hashes[0]
  return sha256Hex(new Blob([hashes.join('')]))
}

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1.5px solid #DAD4CF', borderRadius: '10px', padding: '6px 10px' }}>
      {url ? (
        <img src={url} alt="" style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '6px' }} />
      ) : (
        <span style={{ ...MONO, fontSize: '11px', fontWeight: 600, background: '#F1E3EA', color: '#8E1B47', borderRadius: '6px', padding: '8px 6px' }}>PDF</span>
      )}
      <span style={{ flex: 1, minWidth: 0, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        style={{ border: 'none', background: 'transparent', color: '#8E1B47', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
      >
        Quitar
      </button>
    </li>
  )
}

interface SealFormProps {
  foundation: Foundation
  /** Delivered and unspent money: the most a spend can be. */
  available: number
  disabled: boolean
  onSent: () => void
}

/** Single-file picker for one of the two spend documents (origin proof / destination business doc). */
function SpendDocField({ title, hint, file, onFile, onError }: { title: string; hint: string; file: File | null; onFile: (f: File | null) => void; onError: (m: string | null) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span style={LABEL}>{title}</span>
      {file ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          <FileChip file={file} onRemove={() => onFile(null)} />
        </ul>
      ) : (
        <Dropzone
          variant="box"
          accept="application/pdf,image/jpeg,image/png"
          icon="file"
          title={title}
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
      )}
    </div>
  )
}

function SealForm({ foundation, available, disabled, onSent }: SealFormProps) {
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [step, setStep] = useState<'idle' | 'uploading' | 'chain' | 'verifying'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { getAccessToken } = usePrivy()
  const [originFile, setOriginFile] = useState<File | null>(null)
  const [destFile, setDestFile] = useState<File | null>(null)
  // A verified spend whose on-chain release failed: the button retries only the release.
  const [pendingRelease, setPendingRelease] = useState<string | null>(null)
  const [result, setResult] = useState<VerifySpendResult | null>(null)

  const schema = useMemo(
    () =>
      z.object({
        rif: z
          .string()
          .transform((v) => v.trim().toUpperCase())
          .pipe(z.string().regex(RIF_RE, 'Formato esperado: J-12345678-9')),
        amount: z
          .number({ error: 'Ingresa un monto válido.' })
          .positive('El monto debe ser mayor a 0.')
          .max(available, `Tu saldo disponible es ${formatUSDT(available)}. Un gasto no puede superarlo.`),
        concept: z.string().trim().min(3, 'Entre 3 y 80 caracteres.').max(80, 'Entre 3 y 80 caracteres.'),
      }),
    [available],
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { rif: '', concept: '' },
  })

  const addFiles = (incoming: File[]) => {
    const bad = incoming.find((f) => !ALLOWED.includes(f.type) || f.size > MAX_BYTES)
    if (bad) {
      setFileError(`"${bad.name}" no es válido: usa PDF, JPG o PNG de hasta 10 MB.`)
      return
    }
    if (files.length + incoming.length > MAX_FILES) {
      setFileError(`Máximo ${MAX_FILES} archivos por factura.`)
      return
    }
    setFileError(null)
    setFiles((prev) => [...prev, ...incoming])
  }

  const freshToken = async () => {
    const token = await getAccessToken()
    if (!token) throw new Error('Tu sesión expiró. Inicia sesión de nuevo.')
    return token
  }

  const clearForm = () => {
    setOriginFile(null)
    setDestFile(null)
    reset({ rif: '', concept: '' })
    setFiles([])
  }

  const finish = (verdict: VerifySpendResult, invoiceId: string) => {
    setResult(verdict)
    if (verdict.release?.status === 'pending') {
      // Verified, but the on-chain release failed (e.g. custody without gas): the server does not repeat the model call.
      setPendingRelease(invoiceId)
      setSubmitError('El gasto fue verificado, pero la liberación on-chain quedó pendiente. Reintenta en unos minutos.')
    } else {
      setPendingRelease(null)
      clearForm()
    }
    onSent()
  }

  const onSubmit = async (values: FormValues) => {
    if (pendingRelease) {
      setSubmitError(null)
      setStep('verifying')
      try {
        finish(await verifySpend(await freshToken(), { invoice_id: pendingRelease }), pendingRelease)
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'No pudimos reintentar la liberación.')
      } finally {
        setStep('idle')
      }
      return
    }
    if (files.length === 0) {
      setFileError('Sube al menos un archivo de la factura.')
      return
    }
    if (!originFile || !destFile) {
      setFileError('Sube el comprobante de cuenta de origen y el documento del negocio.')
      return
    }
    setSubmitError(null)
    setResult(null)
    setStep('uploading')
    let invoiceId: string | null = null
    try {
      // Files go through server-issued upload URLs: nothing can be written to storage directly.
      const token = await freshToken()
      const hashes = await Promise.all(files.map(sha256Hex))
      const paths: string[] = []
      for (const file of files) paths.push(await uploadViaServer('invoice', file, token))
      const fileHash = await combineHashes(hashes)
      const originPath = await uploadViaServer('spend_origin', originFile, token)
      const destPath = await uploadViaServer('spend_destination', destFile, token)
      // The server creates the invoice (the 7-day window starts) and rejects a spend above the available balance.
      const { invoice: created } = await reportSpend(await freshToken(), {
        concept: values.concept.trim(),
        amount: values.amount,
        supplier_rif: values.rif.trim().toUpperCase(),
        file_paths: paths,
        file_hash: fileHash,
        file_hashes: hashes,
      })
      invoiceId = created.id

      setStep('chain')
      await recordInvoiceHash(foundation.id, fileHash as `0x${string}`) // TODO fase contrato: real on-chain call.

      setStep('verifying')
      finish(await verifySpend(await freshToken(), { invoice_id: created.id, origin_path: originPath, destination_path: destPath }), created.id)
    } catch (e) {
      const base = e instanceof Error ? e.message : 'No pudimos enviar la factura. Intenta de nuevo.'
      setSubmitError(invoiceId ? `${base} Tu gasto quedó abierto: ve a Facturas para reintentar la verificación antes de que venza el plazo de 7 días.` : base)
      if (invoiceId) onSent()
    } finally {
      setStep('idle')
    }
  }

  const busy = step !== 'idle'
  const label =
    step === 'uploading' ? 'Subiendo…' : step === 'chain' ? 'Registrando hash en cadena…' : step === 'verifying' ? 'Verificando el gasto…' : pendingRelease ? 'Reintentar liberación' : 'Enviar a auditoría'

  return (
    <section
      id="sellar"
      style={{ flex: '1 1 380px', background: '#FFFFFF', border: '1.5px solid #1B1530', borderRadius: '20px', padding: '26px', display: 'flex', flexDirection: 'column', gap: '16px', opacity: disabled ? 0.55 : 1 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '30px', fontWeight: 800, letterSpacing: '-1px' }}>Reporta un gasto</h1>
        <p style={{ margin: 0, fontSize: '15px', color: '#5A5468' }}>
          Puedes reportar hasta <strong style={{ color: '#1B1530' }}>{formatUSDT(available)}</strong>, el dinero que ya recibiste y no has gastado. Al aprobarse, el gasto se asigna a los aportes más antiguos y se desbloquea el siguiente tramo de cada aporte que llegue al {UNLOCK_THRESHOLD_PCT}% usado.
        </p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <fieldset disabled={disabled || busy} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          <Dropzone
            variant="box"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            icon="upload"
            title="Sube las facturas"
            hint="PDF o fotos · se guarda su hash en cadena"
            onFiles={addFiles}
          />
          {files.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {files.map((f, i) => (
                <FileChip key={`${f.name}-${i}`} file={f} onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))} />
              ))}
            </ul>
          )}
          {fileError && (
            <span role="alert" style={FIELD_ERROR}>
              {fileError}
            </span>
          )}
          {!pendingRelease && (
            <>
              <SpendDocField title="Comprobante de cuenta de origen" hint="Prueba de que la cuenta es de la fundación · PDF o foto" file={originFile} onFile={setOriginFile} onError={setFileError} />
              <SpendDocField title="Documento con RIF y cuenta del negocio" hint="RIF y cuenta de destino del negocio · PDF o foto" file={destFile} onFile={setDestFile} onError={setFileError} />
            </>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="rif" style={LABEL}>
              RIF del proveedor
            </label>
            <input id="rif" placeholder="J-00000000-0" autoComplete="off" {...register('rif', { onChange: (e) => (e.target.value = e.target.value.toUpperCase()) })} style={{ ...INPUT, ...MONO }} />
            {errors.rif && <span style={FIELD_ERROR}>{errors.rif.message}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
              <label htmlFor="monto" style={LABEL}>
                Monto
              </label>
              <input id="monto" type="number" step="0.01" inputMode="decimal" placeholder="$0.00" {...register('amount', { valueAsNumber: true })} style={{ ...INPUT, ...MONO }} />
              {errors.amount && <span style={FIELD_ERROR}>{errors.amount.message}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
              <label htmlFor="concepto" style={LABEL}>
                Concepto
              </label>
              <input id="concepto" placeholder="Medicinas" {...register('concept')} style={{ ...INPUT, fontFamily: 'inherit' }} />
              {errors.concept && <span style={FIELD_ERROR}>{errors.concept.message}</span>}
            </div>
          </div>
          {submitError && (
            <span role="alert" style={FIELD_ERROR}>
              {submitError}
            </span>
          )}
          {result && (
            <div
              role="status"
              style={{ border: `1.5px solid ${result.status === 'verified' ? '#1A7F52' : result.status === 'rejected' ? '#B4235A' : '#E8A317'}`, background: result.status === 'verified' ? '#E6F4EC' : result.status === 'rejected' ? '#F8E9EF' : '#FBEFD3', borderRadius: '14px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              <strong style={{ color: result.status === 'verified' ? '#135E3C' : result.status === 'rejected' ? '#8E1B47' : '#6B4A00' }}>{result.status === 'verified' ? 'Gasto verificado' : result.status === 'rejected' ? 'Gasto rechazado' : 'Falta respaldo: el gasto sigue abierto'}</strong>
              <span style={{ fontSize: '13px', color: '#5A5468' }}>{result.review_note}</span>
              {result.status === 'verified' && typeof result.allocated_usd === 'number' && (
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Se asignaron {formatUSDT(result.allocated_usd)} a los aportes más antiguos.</span>
              )}
              {result.release?.status === 'released' && result.release.released_count > 0 && (
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  Se desbloquearon {formatUSDT(result.release.released_usd)} ({result.release.released_count} {result.release.released_count === 1 ? 'tramo' : 'tramos'}).{' '}
                  {result.release.tx_hash && (
                    <TxLink hash={result.release.tx_hash} label="tx" style={{ ...MONO, textDecoration: 'none' }} />
                  )}
                </span>
              )}
              {result.release?.status === 'none' && (
                <span style={{ fontSize: '13px', color: '#5A5468' }}>
                  Ningún tramo llegó todavía al {UNLOCK_THRESHOLD_PCT}% usado, así que no se desbloqueó dinero nuevo. Seguirá creciendo con tus próximos gastos.
                </span>
              )}
              {result.status === 'needs_changes' && (
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  Intento {result.attempts} de {result.max_attempts}. Corrige los documentos desde{' '}
                  <Link to="/panel/facturas?estado=en-revision" style={{ color: '#1B1530' }}>
                    Facturas
                  </Link>{' '}
                  antes de que venza el plazo de 7 días.
                </span>
              )}
              {result.refund && (
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#8E1B47' }}>
                  Tu fundación quedó congelada. Se reembolsó el 100% a {result.refund.refunds} {result.refund.refunds === 1 ? 'donación' : 'donaciones'} ({formatUSDT(result.refund.refunded_usd)}).
                </span>
              )}
              <AgentChecks checks={result.checks} />
            </div>
          )}
          <button
            type="submit"
            style={{ minHeight: '54px', borderRadius: '12px', border: 'none', background: busy || disabled ? '#ECE7F0' : '#B4235A', color: busy || disabled ? '#5A5468' : '#FFFFFF', fontFamily: 'inherit', fontSize: '17px', fontWeight: 700, cursor: busy ? 'wait' : disabled ? 'not-allowed' : 'pointer' }}
          >
            {label}
          </button>
        </fieldset>
      </form>
      <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', color: '#5A5468' }}>
        Una factura que no coincida congela la fundación y devuelve la custodia a los donantes.
      </p>
    </section>
  )
}

export default function PanelFundacion() {
  const { foundation, stats, loading, error, reload } = useMyFoundation()
  const { invoices, reload: reloadInvoices } = useOwnInvoices(!!foundation)

  // Realtime: when the auditor approves/rejects an invoice, refresh the money summary and level.
  const signature = invoices.map((i) => `${i.id}:${i.status}`).join('|')
  useEffect(() => {
    if (signature) void reload()
  }, [signature, reload])

  if (loading) {
    return (
      <PageShell minHeight={1000}>
        <Notice>Cargando tu panel…</Notice>
      </PageShell>
    )
  }
  if (error || !foundation) {
    return (
      <PageShell minHeight={1000}>
        <Notice title={error ? 'No pudimos cargar tu panel' : 'Aún no tienes una fundación registrada'}>
          <Link to="/registro">Registrar mi fundación →</Link>
        </Notice>
      </PageShell>
    )
  }

  const level = toLevel(foundation.level)
  const nextLevel = level < MAX_LEVEL ? toLevel(level + 1) : null
  const pending = foundation.status === 'pending'
  const frozen = foundation.status === 'frozen'
  const available = stats?.available_balance ?? 0
  const invoicesToNext = nextLevel
    ? Math.max(1, Math.ceil((LEVEL_MIN_REPUTATION[nextLevel] - foundation.reputation_score) / REP_PER_VERIFIED_INVOICE))
    : 0
  const noHistory = stats?.reputation_state === 'sin_historial'

  const recent = invoices.slice(0, 4)

  return (
    <PageShell minHeight={1000}>
      <FoundationHeader active="resumen" level={foundation.level} reputation={foundation.reputation_score} reputationState={stats?.reputation_state} />
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {pending && (
          <div role="status" style={{ border: '1.5px solid #E8A317', background: '#FBEFD3', color: '#6B4A00', borderRadius: '14px', padding: '16px 18px', fontWeight: 600 }}>
            Tu registro está en revisión. Te escribiremos al correo oficial cuando el auditor lo apruebe.
          </div>
        )}
        {invoices.some((i) => i.status === 'in_review' && (i.evidence_due_at || i.suspicious_at)) && (
          <section role="status" style={{ border: '1.5px solid #E8A317', background: '#FBEFD3', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <strong style={{ color: '#6B4A00' }}>Tienes gastos abiertos sin respaldo</strong>
            <span style={{ fontSize: '14px', color: '#6B4A00' }}>
              Un gasto no puede quedar abierto más de 7 días. Pasado el plazo se vuelve sospechoso y el nivel de la fundación baja a 1.
            </span>
            {invoices
              .filter((i) => i.status === 'in_review' && (i.evidence_due_at || i.suspicious_at))
              .map((i) => (
                <div key={i.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '14px' }}>
                    {i.number} · {i.concept}
                  </strong>
                  <EvidenceDeadline dueAt={i.evidence_due_at} suspicious={i.suspicious_at} />
                </div>
              ))}
            <Link to="/panel/facturas?estado=en-revision" style={{ fontSize: '14px', fontWeight: 700, color: '#6B4A00' }}>
              Respaldar mis gastos →
            </Link>
          </section>
        )}
        {frozen && (
          <div role="alert" style={{ border: '1.5px solid #B4235A', background: '#F8E9EF', color: '#8E1B47', borderRadius: '14px', padding: '16px 18px', fontWeight: 600 }}>
            Tu fundación está congelada por una auditoría.{' '}
            <Link to="/panel/facturas?estado=rechazadas" style={{ color: '#8E1B47' }}>
              Ver el informe
            </Link>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
          <StatCard label="Disponible para gastar" value={formatUSDTCompact(available)} valueSize={30} />
          <StatCard label="Gastado y verificado" value={formatUSDTCompact(stats?.spent_total ?? 0)} valueSize={30} />
          <StatCard label="En custodia" value={formatUSDTCompact(stats?.custody_total ?? 0)} variant="dashed" valueSize={30} />
          <StatCard label={nextLevel ? `Hacia Nivel ${nextLevel} (${LEVEL_RELEASE[nextLevel]}% inicial)` : 'Nivel máximo alcanzado'} gap="8px">
            <div style={{ height: '8px', borderRadius: '4px', background: '#ECE7F0' }}>
              <div style={{ height: '8px', width: `${foundation.reputation_score}%`, borderRadius: '4px', background: '#B4235A' }} />
            </div>
            <span style={{ fontSize: '13px', color: '#5A5468' }}>
              {noHistory ? 'Sin historial: crece con tu primera recaudación' : nextLevel ? `${invoicesToNext} facturas verificadas más` : `Reputación ${foundation.reputation_score}%`}
            </span>
          </StatCard>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
          <SealForm
            foundation={foundation}
            available={available}
            disabled={pending || frozen || available <= 0}
            onSent={() => {
              void reloadInvoices()
              void reload()
            }}
          />
          <section style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Facturas enviadas</h2>
              <Link to="/panel/facturas" style={{ fontSize: '14px', fontWeight: 600 }}>
                Ver todas
              </Link>
            </div>
            <div style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '14px', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', minWidth: '560px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#5A5468', fontSize: '12px' }}>
                    {['FACTURA', 'CONCEPTO', 'MONTO', 'ESTADO'].map((h) => (
                      <th key={h} style={{ padding: '12px 16px', fontWeight: 600 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.map((inv) => (
                    <tr key={inv.id} style={{ borderTop: '1px solid #ECE7F0' }}>
                      <td style={{ padding: '14px 16px', ...MONO, fontSize: '13px' }}>{inv.number}</td>
                      <td style={{ padding: '14px 16px' }}>{inv.concept}</td>
                      <td style={{ padding: '14px 16px', ...MONO }}>{formatUSDT(inv.amount)}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge status={inv.status} size="sm" label={inv.status === 'verified' ? 'Sellada' : undefined} />
                        {inv.release_tx_hash && (
                          <TxLink hash={inv.release_tx_hash} label="tx" style={{ ...MONO, display: 'block', marginTop: '4px', fontSize: '12px', textDecoration: 'none' }} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recent.length === 0 && <p style={{ margin: 0, padding: '24px 16px', textAlign: 'center', color: '#5A5468' }}>Aún no has enviado facturas.</p>}
            </div>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Sin factura, no hay siguiente paso.</p>
          </section>
        </div>
      </div>
    </PageShell>
  )
}
