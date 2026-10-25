import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Dropzone from '../components/Dropzone'
import FoundationHeader from '../components/FoundationHeader'
import PageShell, { Notice } from '../components/PageShell'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import { LEVEL_MIN_REPUTATION, LEVEL_RELEASE, LEVEL_ROMAN, REP_PER_VERIFIED_INVOICE, toLevel } from '../config/levels'
import { useFoundationInvoices } from '../hooks/useFoundationInvoices'
import { useMyFoundation } from '../hooks/useMyFoundation'
import { recordInvoiceHash } from '../lib/contract'
import { formatUSDT, formatUSDTCompact, RIF_RE, sha256Hex } from '../lib/format'
import { supabase } from '../lib/supabase'
import { BUCKETS, fileExtension, uploadFile } from '../lib/storage'
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
  nextTotal: number
  nextIndex: number | null
  nextInvoiceNumber: string
  disabled: boolean
  onSent: () => void
}

function SealForm({ foundation, nextTotal, nextIndex, nextInvoiceNumber, disabled, onSent }: SealFormProps) {
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [step, setStep] = useState<'idle' | 'uploading' | 'chain'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

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
          .max(nextTotal, `Este tramo libera hasta ${formatUSDTCompact(nextTotal)}. Divide la factura o envía el resto en el siguiente tramo.`),
        concept: z.string().trim().min(3, 'Entre 3 y 80 caracteres.').max(80, 'Entre 3 y 80 caracteres.'),
      }),
    [nextTotal],
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

  const onSubmit = async (values: FormValues) => {
    if (files.length === 0) {
      setFileError('Sube al menos un archivo de la factura.')
      return
    }
    setSubmitError(null)
    setStep('uploading')
    try {
      const hashes = await Promise.all(files.map(sha256Hex))
      const paths: string[] = []
      for (const file of files) {
        paths.push(await uploadFile(BUCKETS.invoices, `${foundation.id}/${crypto.randomUUID()}.${fileExtension(file)}`, file))
      }
      const fileHash = await combineHashes(hashes)
      const { error } = await supabase.from('invoices').insert({
        foundation_id: foundation.id,
        number: nextInvoiceNumber,
        concept: values.concept.trim(),
        amount: values.amount,
        supplier_rif: values.rif.trim().toUpperCase(),
        tranche_index: nextIndex,
        file_path: paths[0],
        file_paths: paths,
        file_hash: fileHash,
        file_hashes: hashes,
        status: 'in_review',
      })
      if (error) throw new Error(error.message)

      setStep('chain')
      await recordInvoiceHash(foundation.id, fileHash as `0x${string}`) // TODO fase contrato: real on-chain call.
      // TODO fase agente: mark the matching tranche(s) as in_review for the affected donations
      // (needs the service role; the audit agent / an Edge Function will do it when it picks the invoice up).
      reset({ rif: '', concept: '' })
      setFiles([])
      onSent()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'No pudimos enviar la factura. Intenta de nuevo.')
    } finally {
      setStep('idle')
    }
  }

  const busy = step !== 'idle'
  const label = step === 'uploading' ? 'Subiendo…' : step === 'chain' ? 'Registrando hash en cadena…' : 'Enviar a auditoría'

  return (
    <section
      id="sellar"
      style={{ flex: '1 1 380px', background: '#FFFFFF', border: '1.5px solid #1B1530', borderRadius: '20px', padding: '26px', display: 'flex', flexDirection: 'column', gap: '16px', opacity: disabled ? 0.55 : 1 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h1 style={{ margin: 0, fontSize: '30px', fontWeight: 800, letterSpacing: '-1px' }}>Sella tu siguiente gasto</h1>
        <p style={{ margin: 0, fontSize: '15px', color: '#5A5468' }}>
          Al aprobarse se liberan <strong style={{ color: '#1B1530' }}>{formatUSDTCompact(nextTotal)}</strong> del tramo {nextIndex ?? '—'} y sube tu reputación.
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
  const { invoices, reload: reloadInvoices } = useFoundationInvoices(foundation?.id)

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
  const nextLevel = level < 4 ? toLevel(level + 1) : null
  const pending = foundation.status === 'pending'
  const frozen = foundation.status === 'frozen'
  const nextTotal = stats?.next_tranche_total ?? 0
  const invoicesToNext = nextLevel
    ? Math.max(1, Math.ceil((LEVEL_MIN_REPUTATION[nextLevel] - foundation.reputation_score) / REP_PER_VERIFIED_INVOICE))
    : 0

  const maxNumber = invoices.reduce((m, i) => Math.max(m, Number(i.number.replace(/\D/g, '')) || 0), 0)
  const nextInvoiceNumber = `N° ${String(maxNumber + 1).padStart(6, '0')}`
  const recent = invoices.slice(0, 4)

  return (
    <PageShell minHeight={1000}>
      <FoundationHeader active="resumen" level={foundation.level} reputation={foundation.reputation_score} />
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {pending && (
          <div role="status" style={{ border: '1.5px solid #E8A317', background: '#FBEFD3', color: '#6B4A00', borderRadius: '14px', padding: '16px 18px', fontWeight: 600 }}>
            Tu registro está en revisión. Te escribiremos al correo oficial cuando el auditor lo apruebe.
          </div>
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
          <StatCard label="Disponible" value={formatUSDTCompact(stats?.released_total ?? 0)} valueSize={30} />
          <StatCard label="En custodia" value={formatUSDTCompact(stats?.custody_total ?? 0)} variant="dashed" valueSize={30} />
          <StatCard label="Próximo tramo" value={formatUSDTCompact(nextTotal)} valueSize={30} />
          <StatCard label={nextLevel ? `Hacia Nivel ${LEVEL_ROMAN[nextLevel]} (${LEVEL_RELEASE[nextLevel]}% inicial)` : 'Nivel máximo alcanzado'} gap="8px">
            <div style={{ height: '8px', borderRadius: '4px', background: '#ECE7F0' }}>
              <div style={{ height: '8px', width: `${foundation.reputation_score}%`, borderRadius: '4px', background: '#B4235A' }} />
            </div>
            <span style={{ fontSize: '13px', color: '#5A5468' }}>
              {nextLevel ? `${invoicesToNext} facturas enviadas más` : `Reputación ${foundation.reputation_score}%`}
            </span>
          </StatCard>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
          <SealForm
            key={nextTotal}
            foundation={foundation}
            nextTotal={nextTotal}
            nextIndex={stats?.next_tranche_index ?? null}
            nextInvoiceNumber={nextInvoiceNumber}
            disabled={pending || frozen || nextTotal <= 0}
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
