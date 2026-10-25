import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import Dropzone from '../components/Dropzone'
import FoundationHeader from '../components/FoundationHeader'
import Modal from '../components/Modal'
import PageShell, { Notice } from '../components/PageShell'
import { CATEGORIES } from '../config/levels'
import { useOwnProfile } from '../hooks/useOwnerData'
import { ApiError, submitAppeal, updateProfile, type UpdateProfileInput } from '../lib/api'
import { formatDate } from '../lib/format'
import { uploadViaServer } from '../lib/upload'
import type { Appeal, OwnFoundation } from '../types'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const INPUT: CSSProperties = { minHeight: '46px', borderRadius: '10px', border: '1.5px solid #1B1530', background: '#FFFFFF', padding: '0 14px', fontSize: '15px', color: '#1B1530', minWidth: 0, fontFamily: 'inherit' }
const READONLY: CSSProperties = { ...INPUT, border: '1.5px solid #DAD4CF', background: '#F4F1F7', color: '#5A5468', display: 'flex', alignItems: 'center' }
const LABEL: CSSProperties = { fontSize: '14px', fontWeight: 600 }
const HINT: CSSProperties = { fontSize: '12px', color: '#5A5468' }
const ALLOWED_IMAGES = ['image/png', 'image/jpeg', 'image/svg+xml']
const LOGO_MAX = 2 * 1024 * 1024
const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
const DOC_MAX = 10 * 1024 * 1024

const APPEAL_LABEL: Record<Appeal['status'], string> = {
  received: 'Recibida · requiere soporte técnico',
  in_review: 'En revisión por soporte técnico',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
      <label htmlFor={htmlFor} style={LABEL}>
        {label}
      </label>
      {children}
      {hint && <span style={HINT}>{hint}</span>}
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '16px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>{title}</h2>
      {children}
    </section>
  )
}

interface FormState {
  description: string
  category: string
  country: string
  city: string
  instagram_url: string
  tiktok_url: string
  x_url: string
  wallet_address: string
}

const toForm = (f: OwnFoundation): FormState => ({
  description: f.description ?? '',
  category: f.category ?? '',
  country: f.country ?? '',
  city: f.city ?? '',
  instagram_url: f.instagram_url ?? '',
  tiktok_url: f.tiktok_url ?? '',
  x_url: f.x_url ?? '',
  wallet_address: f.wallet_address,
})

function ProfileForm({ foundation, onSaved }: { foundation: OwnFoundation; onSaved: () => void }) {
  const { getAccessToken } = usePrivy()
  const [form, setForm] = useState<FormState>(() => toForm(foundation))
  const [logo, setLogo] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!logo) {
      // oxlint-disable-next-line react-hooks/set-state-in-effect
      setLogoPreview(null)
      return
    }
    const url = URL.createObjectURL(logo)
    setLogoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logo])

  const base = toForm(foundation)
  const dirty = logo !== null || (Object.keys(base) as (keyof FormState)[]).some((k) => form[k].trim() !== base[k])
  const set = (k: keyof FormState) => (v: string) => {
    setSaved(false)
    setForm((f) => ({ ...f, [k]: v }))
  }
  const walletChanged = form.wallet_address.trim().toLowerCase() !== foundation.wallet_address.toLowerCase()
  const canEditWallet = foundation.status === 'active'

  const save = async () => {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión de nuevo.')
      const input: UpdateProfileInput = {}
      for (const k of Object.keys(base) as (keyof FormState)[]) {
        const v = form[k].trim()
        if (v !== base[k] && k !== 'wallet_address') input[k as Exclude<keyof FormState, 'wallet_address'>] = v
      }
      if (walletChanged) input.wallet_address = form.wallet_address.trim()
      if (logo) input.logo_path = await uploadViaServer('logo', logo, token)
      await updateProfile(token, input)
      setLogo(null)
      setSaved(true)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'No pudimos guardar los cambios.')
    } finally {
      setBusy(false)
    }
  }

  const currentLogo = logoPreview ?? foundation.logo_url

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
    >
      <fieldset disabled={busy} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
        <Card title="Identidad">
          <p style={{ margin: 0, ...HINT }}>El nombre, el RIF y el correo oficial se fijaron al registrar la fundación y no se editan aquí.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
            <Field label="Nombre">
              <div style={READONLY}>{foundation.name}</div>
            </Field>
            <Field label="RIF">
              <div style={{ ...READONLY, ...MONO }}>{foundation.rif ?? '—'}</div>
            </Field>
            <Field label="Correo oficial">
              <div style={READONLY}>{foundation.official_email ?? '—'}</div>
            </Field>
          </div>
        </Card>

        <Card title="Perfil público">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{ width: '96px', height: '96px', borderRadius: '16px', border: '1.5px solid #DAD4CF', background: '#F4F1F7', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {currentLogo ? <img src={currentLogo} alt={`Logo de ${foundation.name}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '12px', color: '#5A5468' }}>Sin logo</span>}
            </div>
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Dropzone
                variant="box"
                accept="image/png,image/jpeg,image/svg+xml"
                icon="upload"
                title={logo ? logo.name : 'Cambiar logo'}
                hint="PNG, JPG o SVG de hasta 2 MB"
                onFiles={(incoming) => {
                  const f = incoming[0]
                  if (!ALLOWED_IMAGES.includes(f.type) || f.size > LOGO_MAX) {
                    setError(`"${f.name}" no es válido: usa PNG, JPG o SVG de hasta 2 MB.`)
                    return
                  }
                  setError(null)
                  setSaved(false)
                  setLogo(f)
                }}
              />
              {logo && (
                <button type="button" onClick={() => setLogo(null)} style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', color: '#8E1B47', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                  Descartar el nuevo logo
                </button>
              )}
            </div>
          </div>
          <Field label="Descripción" htmlFor="descripcion" hint={`${form.description.trim().length}/500 · entre 30 y 500 caracteres. La ven los donantes.`}>
            <textarea
              id="descripcion"
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
              rows={4}
              maxLength={500}
              style={{ ...INPUT, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <Field label="Categoría" htmlFor="categoria">
              <select id="categoria" value={form.category} onChange={(e) => set('category')(e.target.value)} style={INPUT}>
                {!CATEGORIES.some((c) => c === form.category) && <option value={form.category}>{form.category || 'Elige una categoría'}</option>}
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="País" htmlFor="pais">
              <input id="pais" value={form.country} onChange={(e) => set('country')(e.target.value)} maxLength={60} style={INPUT} />
            </Field>
            <Field label="Ciudad" htmlFor="ciudad">
              <input id="ciudad" value={form.city} onChange={(e) => set('city')(e.target.value)} maxLength={60} style={INPUT} />
            </Field>
          </div>
        </Card>

        <Card title="Redes sociales">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
            <Field label="Instagram" htmlFor="instagram">
              <input id="instagram" value={form.instagram_url} onChange={(e) => set('instagram_url')(e.target.value)} placeholder="https://instagram.com/tu_fundacion" style={INPUT} />
            </Field>
            <Field label="TikTok" htmlFor="tiktok">
              <input id="tiktok" value={form.tiktok_url} onChange={(e) => set('tiktok_url')(e.target.value)} placeholder="https://tiktok.com/@tu_fundacion" style={INPUT} />
            </Field>
            <Field label="X" htmlFor="x">
              <input id="x" value={form.x_url} onChange={(e) => set('x_url')(e.target.value)} placeholder="https://x.com/tu_fundacion" style={INPUT} />
            </Field>
          </div>
          <span style={HINT}>Deja un campo vacío para quitar ese enlace.</span>
        </Card>

        <Card title="Wallet de cobro">
          <Field
            label="Dirección que recibe los desbloqueos"
            htmlFor="wallet"
            hint={canEditWallet ? 'Cada cambio queda registrado. No se puede cambiar mientras haya una transferencia en curso.' : 'Solo una fundación activa puede cambiar su wallet.'}
          >
            <input id="wallet" value={form.wallet_address} onChange={(e) => set('wallet_address')(e.target.value)} disabled={!canEditWallet} spellCheck={false} style={{ ...INPUT, ...MONO, fontSize: '13px' }} />
          </Field>
          {walletChanged && canEditWallet && (
            <p role="status" style={{ margin: 0, fontSize: '13px', background: '#FBEFD3', color: '#6B4A00', borderRadius: '10px', padding: '10px 12px', fontWeight: 600 }}>
              Vas a redirigir los próximos desbloqueos a otra wallet. Verifica bien la dirección: enviar dinero a una wallet equivocada no se puede deshacer.
            </p>
          )}
        </Card>

        {error && (
          <span role="alert" style={{ fontSize: '14px', color: '#8E1B47', fontWeight: 600 }}>
            {error}
          </span>
        )}
        {saved && (
          <span role="status" style={{ fontSize: '14px', color: '#135E3C', fontWeight: 600 }}>
            Cambios guardados.
          </span>
        )}
        <button
          type="submit"
          disabled={!dirty || busy}
          style={{ alignSelf: 'flex-start', minHeight: '52px', padding: '0 28px', borderRadius: '12px', border: 'none', background: dirty && !busy ? '#B4235A' : '#ECE7F0', color: dirty && !busy ? '#FFFFFF' : '#5A5468', fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: busy ? 'wait' : dirty ? 'pointer' : 'not-allowed' }}
        >
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </fieldset>
    </form>
  )
}

function AppealModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { getAccessToken } = usePrivy()
  const [reason, setReason] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const length = reason.trim().length
  const valid = length >= 30 && length <= 2000

  const send = async () => {
    setError(null)
    setBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión de nuevo.')
      const paths: string[] = []
      for (const f of files) paths.push(await uploadViaServer('appeal', f, token))
      const res = await submitAppeal(token, reason.trim(), paths)
      setDone(res.message)
      onSent()
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'No pudimos enviar la apelación.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Enviar una apelación" onClose={onClose} maxWidth={560}>
      {done ? (
        <>
          <p role="status" style={{ margin: 0, fontSize: '15px', lineHeight: 1.5, background: '#E6F4EC', color: '#135E3C', borderRadius: '12px', padding: '14px 16px', fontWeight: 600 }}>
            {done}
          </p>
          <button type="button" onClick={onClose} style={{ minHeight: '48px', borderRadius: '12px', border: '1.5px solid #1B1530', background: 'transparent', fontFamily: 'inherit', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>
            Cerrar
          </button>
        </>
      ) : (
        <fieldset disabled={busy} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '14px', color: '#5A5468', lineHeight: 1.5 }}>
            Cuéntanos qué pasó y adjunta lo que respalde tu caso. Soporte técnico la revisará de forma manual: por ahora no hay un resultado automático y tu fundación no cambia al enviarla.
          </p>
          <Field label="¿Qué pasó?" htmlFor="apelacion" hint={`${length}/2000 · mínimo 30 caracteres`}>
            <textarea id="apelacion" value={reason} onChange={(e) => setReason(e.target.value)} rows={6} maxLength={2000} style={{ ...INPUT, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }} />
          </Field>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={LABEL}>Evidencia (opcional, hasta 3 archivos)</span>
            <Dropzone
              variant="box"
              accept="application/pdf,image/jpeg,image/png"
              multiple
              title="Adjuntar archivos"
              hint="PDF, JPG o PNG de hasta 10 MB"
              onFiles={(incoming) => {
                const bad = incoming.find((f) => !DOC_TYPES.includes(f.type) || f.size > DOC_MAX)
                if (bad) return setError(`"${bad.name}" no es válido: usa PDF, JPG o PNG de hasta 10 MB.`)
                if (files.length + incoming.length > 3) return setError('Puedes adjuntar hasta 3 archivos.')
                setError(null)
                setFiles((prev) => [...prev, ...incoming])
              }}
            />
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{ display: 'flex', gap: '10px', fontSize: '13px' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ border: 'none', background: 'transparent', color: '#8E1B47', fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer' }}>
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
            disabled={!valid || busy}
            onClick={() => void send()}
            style={{ minHeight: '50px', borderRadius: '12px', border: 'none', background: valid && !busy ? '#B4235A' : '#ECE7F0', color: valid && !busy ? '#FFFFFF' : '#5A5468', fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: busy ? 'wait' : valid ? 'pointer' : 'not-allowed' }}
          >
            {busy ? 'Enviando…' : 'Enviar apelación'}
          </button>
        </fieldset>
      )}
    </Modal>
  )
}

export default function PerfilFundacion() {
  const { data, loading, error, reload } = useOwnProfile()
  const [appealing, setAppealing] = useState(false)

  if (loading) {
    return (
      <PageShell minHeight={1000}>
        <Notice>Cargando tu perfil…</Notice>
      </PageShell>
    )
  }
  if (!data) {
    return (
      <PageShell minHeight={1000}>
        <Notice title="No pudimos cargar tu perfil">
          {error ?? 'Intenta de nuevo en unos segundos.'} <Link to="/panel">Volver al panel</Link>
        </Notice>
      </PageShell>
    )
  }

  const { foundation, stats, appeals, can_appeal } = data
  const flagged = stats?.reputation_state === 'inconfiable' || foundation.status === 'frozen'
  const open = appeals.find((a) => a.status === 'received' || a.status === 'in_review')

  return (
    <PageShell minHeight={1000}>
      <FoundationHeader active="perfil" level={foundation.level} reputation={foundation.reputation_score} reputationState={stats?.reputation_state} />
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <h1 style={{ margin: 0, fontSize: '40px', fontWeight: 800, letterSpacing: '-1.5px' }}>Perfil de la fundación</h1>
            <p style={{ margin: 0, fontSize: '16px', color: '#5A5468' }}>Lo que cambies aquí es lo que ven los donantes en tu página pública.</p>
          </div>
          <Link to={`/fundacion/${foundation.id}`} style={{ fontSize: '14px', fontWeight: 600 }}>
            Ver mi página pública →
          </Link>
        </div>

        {(flagged || appeals.length > 0) && (
          <section id="apelacion-estado" style={{ border: `1.5px solid ${flagged ? '#B4235A' : '#DAD4CF'}`, background: flagged ? '#F8E9EF' : '#FFFFFF', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <strong style={{ fontSize: '18px', color: flagged ? '#8E1B47' : '#1B1530' }}>
              {flagged ? 'Tu fundación tiene alertas de confianza' : 'Tus apelaciones'}
            </strong>
            {flagged && (
              <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
                {foundation.status === 'frozen'
                  ? 'Un gasto rechazado congeló la fundación y se devolvió el dinero en custodia a los donantes.'
                  : 'Hay gastos rechazados u observados, o un gasto abierto sin respaldo después del plazo de 7 días.'}{' '}
                Si crees que hubo un error, puedes enviar una apelación.
              </p>
            )}
            {appeals.map((a) => (
              <div key={a.id} style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '12px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '14px' }}>{APPEAL_LABEL[a.status]}</strong>
                  <span style={{ fontSize: '12px', color: '#5A5468' }}>
                    {formatDate(a.created_at)}
                    {a.evidence_count > 0 ? ` · ${a.evidence_count} ${a.evidence_count === 1 ? 'archivo' : 'archivos'}` : ''}
                  </span>
                </div>
                <span style={{ fontSize: '13px', color: '#5A5468', whiteSpace: 'pre-wrap' }}>{a.reason}</span>
              </div>
            ))}
            {open && <span style={{ fontSize: '13px', color: '#5A5468' }}>Soporte técnico revisará tu apelación de forma manual y te contactará.</span>}
            {can_appeal && (
              <button type="button" onClick={() => setAppealing(true)} style={{ alignSelf: 'flex-start', minHeight: '46px', padding: '0 22px', borderRadius: '12px', border: 'none', background: '#B4235A', color: '#FFFFFF', fontFamily: 'inherit', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
                Enviar una apelación
              </button>
            )}
          </section>
        )}

        <ProfileForm key={`${foundation.id}:${foundation.wallet_address}:${foundation.logo_url ?? ''}`} foundation={foundation} onSaved={() => void reload()} />
      </div>
      {appealing && <AppealModal onClose={() => setAppealing(false)} onSent={() => void reload()} />}
    </PageShell>
  )
}
