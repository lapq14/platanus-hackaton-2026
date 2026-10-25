import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { isAddress } from 'viem'
import { z } from 'zod'
import Dropzone from '../components/Dropzone'
import Logo from '../components/Logo'
import PageShell from '../components/PageShell'
import { CATEGORIES, LEVEL_RELEASE } from '../config/levels'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ApiError, registerFoundation, validateRegistration } from '../lib/api'
import { recordInvoiceHash } from '../lib/contract'
import { RIF_RE, sha256Hex } from '../lib/format'
import { supabase } from '../lib/supabase'
import { BUCKETS, fileExtension, publicLogoUrl, rifExtension, uploadFile } from '../lib/storage'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const DRAFT_KEY = 'rastro:registro-draft'
const GO_PANEL_KEY = 'rastro:go-panel'
const TOTAL_FIELDS = 10

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']
const LOGO_MAX = 2 * 1024 * 1024
const PDF_MAX = 10 * 1024 * 1024
const RIF_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

// One schema per field; sections and the full form are composed from them, so the sidebar counters
// and the validation always agree.
const fields = {
  name: z.string().trim().min(3, 'Entre 3 y 80 caracteres.').max(80, 'Entre 3 y 80 caracteres.'),
  rif: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(RIF_RE, 'Formato esperado: J-12345678-9')),
  desc: z.string().trim().min(30, 'Mínimo 30 caracteres.').max(500, 'Máximo 500 caracteres.'),
  cat: z.string().refine((v) => (CATEGORIES as readonly string[]).includes(v), 'Elige una categoría.'),
  country: z.string().trim().min(1, 'Obligatorio.'),
  city: z.string().trim().min(1, 'Obligatorio.'),
  wallet: z.string().trim().refine((v) => isAddress(v, { strict: false }), 'Debe empezar con 0x y tener 42 caracteres.'),
  email: z.email('Revisa el correo.'),
  logo: z.custom<File | null>((v) => v instanceof File, 'Sube el logotipo.'),
  rifDoc: z.custom<File | null>((v) => v instanceof File, 'Sube el documento de RIF.'),
}
const sectionA = ['name', 'rif', 'desc', 'cat', 'country', 'city'] as const
const sectionB = ['wallet', 'email'] as const
const sectionC = ['logo', 'rifDoc'] as const

const schema = z.object({ ...fields, accept: z.boolean().refine((v) => v === true, 'Acepta las condiciones.') })
type Values = z.input<typeof schema>

/** `j12345678 9` -> `J-12345678-9` while typing. */
function formatRif(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const letter = clean.slice(0, 1)
  const digits = clean.slice(1).replace(/\D/g, '').slice(0, 9)
  return letter + (digits ? `-${digits.slice(0, 8)}` : '') + (digits.length > 8 ? `-${digits[8]}` : '')
}

const INPUT: CSSProperties = { minHeight: '48px', boxSizing: 'border-box', width: '100%', borderRadius: '10px', border: '1.5px solid #1B1530', background: '#FFFFFF', padding: '0 14px', fontFamily: 'inherit', fontSize: '15px', color: '#1B1530' }
const LABEL: CSSProperties = { fontSize: '14px', fontWeight: 600 }
const ERR: CSSProperties = { fontSize: '13px', color: '#8E1B47', fontWeight: 600 }
const HELP: CSSProperties = { fontSize: '13px', color: '#5A5468' }
const CARD: CSSProperties = { background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '20px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px' }
const COL: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }

function SectionHead({ letter, title, subtitle, done }: { letter: string; title: string; subtitle: string; done: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0, width: '36px', height: '36px', borderRadius: '999px', background: done ? '#1A7F52' : '#ECE7F0', color: done ? '#FFFFFF' : '#1B1530', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '15px' }}>
        {letter}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px' }}>{title}</h2>
        <span style={HELP}>{subtitle}</span>
      </div>
    </div>
  )
}

/** Reads width/height of a raster image to enforce "square, min 400 px". */
function imageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen.'))
    }
    img.src = url
  })
}

export default function Registro() {
  const navigate = useNavigate()
  const { login, authenticated, getAccessToken } = usePrivy()
  const { dbUser, address, email: sessionEmail, refresh } = useCurrentUser()

  const draft = useMemo<Partial<Values>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Values>
    } catch {
      return {}
    }
  }, [])

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      name: draft.name ?? '',
      rif: draft.rif ?? '',
      desc: draft.desc ?? '',
      cat: draft.cat ?? '',
      country: draft.country ?? 'Venezuela',
      city: draft.city ?? '',
      wallet: draft.wallet ?? '',
      email: draft.email ?? '',
      logo: null,
      rifDoc: null,
      accept: false,
    },
  })
  const values = useWatch({ control })

  const [rifTaken, setRifTaken] = useState(false)
  const [fileErrors, setFileErrors] = useState<{ logo?: string; rifDoc?: string }>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  // Result of the AI auditor right after registering: 'pending' = it could not decide yet (retry from the panel).
  const [outcome, setOutcome] = useState<{ status: 'active' | 'rejected' | 'pending'; reason?: string | null } | null>(null)
  // Uploads already done are kept so a retry only repeats the part that failed.
  const uploaded = useRef<{ logoUrl?: string; rifPath?: string; rifHash?: string }>({})

  // Prefill wallet and e-mail from the Privy session (only while the user has not typed anything).
  useEffect(() => {
    if (address && !values.wallet) setValue('wallet', address)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])
  useEffect(() => {
    if (sessionEmail && !values.email) setValue('email', sessionEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEmail])

  // "¿Ya registraste tu fundación? Entrar": after the login redirect, go to the panel.
  useEffect(() => {
    if (authenticated && dbUser && sessionStorage.getItem(GO_PANEL_KEY)) {
      sessionStorage.removeItem(GO_PANEL_KEY)
      void navigate('/panel')
    }
  }, [authenticated, dbUser, navigate])

  // RIF uniqueness check against the catalog.
  const rifValue = (values.rif ?? '').trim().toUpperCase()
  useEffect(() => {
    if (!RIF_RE.test(rifValue)) {
      setRifTaken(false)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      void supabase
        .from('foundations')
        .select('id')
        .eq('rif', rifValue)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setRifTaken(!!data)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [rifValue])

  const okField = (k: keyof typeof fields): boolean => {
    const v = k === 'logo' || k === 'rifDoc' ? (values[k] ?? null) : (values[k] ?? '')
    const ok = fields[k].safeParse(v).success
    return k === 'rif' ? ok && !rifTaken : ok
  }
  const count = (keys: readonly (keyof typeof fields)[]) => keys.filter(okField).length
  const cA = count(sectionA)
  const cB = count(sectionB)
  const cC = count(sectionC)
  const done = cA + cB + cC
  const missing = TOTAL_FIELDS - done
  const accept = !!values.accept
  const ready = missing === 0 && accept && !!dbUser === authenticated
  const status = sent
    ? outcome?.status === 'active'
      ? 'Registro validado. Tu organización ya está aceptada y puede subir facturas.'
      : outcome?.status === 'rejected'
        ? `Registro rechazado: ${outcome.reason ?? 'no pudimos validar el documento.'} Puedes corregirlo y reenviarlo desde tu panel.`
        : 'Recibido. No pudimos completar la validación ahora; tu registro sigue en revisión y puedes reintentar desde tu panel.'
    : missing > 0
      ? `Faltan ${missing} campos.`
      : accept
        ? 'Todo listo.'
        : 'Acepta las condiciones para enviar.'

  const walletValue = (values.wallet ?? '').trim()
  const isSessionWallet = !!address && walletValue.toLowerCase() === address.toLowerCase()
  const descLen = (values.desc ?? '').length

  const pickLogo = async (files: File[]) => {
    const file = files[0]
    let msg: string | undefined
    if (!LOGO_TYPES.includes(file.type)) msg = 'Formato no válido: usa PNG, JPG o SVG.'
    else if (file.size > LOGO_MAX) msg = 'El logotipo pesa más de 2 MB.'
    else if (file.type !== 'image/svg+xml') {
      try {
        const { w, h } = await imageSize(file)
        if (w < 400 || h < 400) msg = 'La imagen debe medir al menos 400 px por lado.'
        else if (Math.abs(w / h - 1) > 0.05) msg = 'La imagen debe ser cuadrada.'
      } catch {
        msg = 'No se pudo leer la imagen.'
      }
    }
    setFileErrors((e) => ({ ...e, logo: msg }))
    if (msg) return
    uploaded.current.logoUrl = undefined
    setValue('logo', file, { shouldValidate: true })
  }
  const pickRifDoc = (files: File[]) => {
    const file = files[0]
    const msg = !RIF_DOC_TYPES.includes(file.type) ? 'Usa PDF, JPG o PNG.' : file.size > PDF_MAX ? 'El archivo pesa más de 10 MB.' : undefined
    setFileErrors((e) => ({ ...e, rifDoc: msg }))
    if (msg) return
    uploaded.current.rifPath = undefined
    setValue('rifDoc', file, { shouldValidate: true })
  }
  const logoPreview = useMemo(() => (values.logo instanceof File ? URL.createObjectURL(values.logo) : null), [values.logo])
  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview)
    }
  }, [logoPreview])

  const onSubmit = async (v: Values) => {
    setSubmitError(null)
    if (!authenticated) {
      // Keep what was typed (files cannot be stored) and come back after the Privy login.
      const { logo: _l, rifDoc: _r, accept: _a, ...text } = v
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(text))
      login()
      return
    }
    if (!dbUser || !(v.logo instanceof File) || !(v.rifDoc instanceof File)) return
    try {
      setBusy('Subiendo logotipo…')
      if (!uploaded.current.logoUrl) {
        const path = await uploadFile(BUCKETS.logos, `${crypto.randomUUID()}.${fileExtension(v.logo)}`, v.logo).catch(() => {
          throw new Error('No pudimos subir el logotipo. Tus datos siguen aquí: reintenta.')
        })
        uploaded.current.logoUrl = publicLogoUrl(path)
      }
      setBusy('Subiendo RIF…')
      if (!uploaded.current.rifPath) {
        uploaded.current.rifHash = await sha256Hex(v.rifDoc)
        uploaded.current.rifPath = await uploadFile(BUCKETS.rif, `${crypto.randomUUID()}.${rifExtension(v.rifDoc)}`, v.rifDoc).catch(() => {
          throw new Error('No pudimos subir el documento de RIF. Tus datos siguen aquí: reintenta.')
        })
      }
      setBusy('Enviando registro…')
      const token = await getAccessToken()
      if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      const { foundation } = await registerFoundation(token, {
        name: v.name.trim(),
        description: v.desc.trim(),
        category: v.cat,
        rif: v.rif.trim().toUpperCase(),
        country: v.country.trim(),
        city: v.city.trim(),
        official_email: v.email.trim(),
        wallet_address: v.wallet.trim(),
        logo_url: uploaded.current.logoUrl,
      })
      // TODO fase contrato: record the RIF document hash on-chain.
      await recordInvoiceHash(foundation.id, uploaded.current.rifHash as `0x${string}`)
      sessionStorage.removeItem(DRAFT_KEY)
      await refresh() // role is now 'ong': refresh the cached user so /panel opens.
      // The AI auditor decides pending -> active | rejected. A model failure leaves it pending (retry from the panel).
      setBusy('Validando tu RIF…')
      try {
        const res = await validateRegistration(token, { rif_doc_path: uploaded.current.rifPath })
        setOutcome({ status: res.status, reason: res.reason })
      } catch {
        setOutcome({ status: 'pending' })
      }
      setSent(true)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'rif_taken') {
        setRifTaken(true)
        setError('rif', { message: 'Este RIF ya tiene una cuenta.' })
      } else {
        setSubmitError(e instanceof Error ? e.message : 'No pudimos enviar el registro. Intenta de nuevo.')
      }
    } finally {
      setBusy(null)
    }
  }

  const goLogin = () => {
    if (authenticated) {
      void navigate('/panel')
      return
    }
    sessionStorage.setItem(GO_PANEL_KEY, '1')
    login()
  }

  const sideLink = (id: string, letter: string, title: string, n: number, total: number) => {
    const full = n === total
    return (
      <a href={`#${id}`} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 14px', borderRadius: '12px', textDecoration: 'none', color: '#1B1530', background: '#FFFFFF', border: '1.5px solid #DAD4CF' }}>
        <span style={{ width: '26px', height: '26px', borderRadius: '999px', background: full ? '#1A7F52' : '#ECE7F0', color: full ? '#FFFFFF' : '#1B1530', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px' }}>{letter}</span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: '15px' }}>{title}</span>
        <span style={{ ...MONO, fontSize: '12px', color: '#5A5468' }}>
          {n}/{total}
        </span>
      </a>
    )
  }

  const rifError = rifTaken ? 'Este RIF ya tiene una cuenta.' : errors.rif?.message

  // One organization per account: whoever already owns one never sees the application form again (fixes and
  // re-submissions happen in the panel). Not while a submission is running or its result is on screen.
  if (authenticated && dbUser?.role === 'ong' && !sent && busy === null) return <Navigate to="/panel" replace />

  return (
    <PageShell minHeight={1640}>
      <header style={{ borderBottom: '1.5px solid #DAD4CF', background: '#F8F8F8' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '14px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 28px' }}>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <Logo height={40} />
          </Link>
          <span style={{ fontSize: '14px', color: '#5A5468' }}>
            ¿Ya registraste tu fundación?{' '}
            <button type="button" onClick={goLogin} style={{ border: 'none', background: 'transparent', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600, color: '#3B3FB6', cursor: 'pointer', textDecoration: 'underline' }}>
              Entrar
            </button>
          </span>
        </div>
      </header>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '36px 24px 72px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '720px' }}>
          <span style={{ ...MONO, fontSize: '12px', letterSpacing: '1.5px', color: '#5A5468' }}>REGISTRO DE FUNDACIÓN</span>
          <h1 style={{ margin: 0, fontSize: 'clamp(34px, 4vw, 52px)', lineHeight: 0.95, fontWeight: 800, letterSpacing: '-2px' }}>Haz que cada aporte deje rastro.</h1>
          <p style={{ margin: 0, fontSize: '17px', lineHeight: 1.5, color: '#5A5468' }}>
            Empiezas en Nivel I: recibes el {LEVEL_RELEASE[1]}% de cada donación al instante y el resto se libera con cada factura sellada.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '28px', alignItems: 'flex-start' }}>
          <aside style={{ flex: '1 1 240px', position: 'sticky', top: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {sideLink('sec-a', 'A', 'Datos principales', cA, sectionA.length)}
            {sideLink('sec-b', 'B', 'Cobro y contacto', cB, sectionB.length)}
            {sideLink('sec-c', 'C', 'Documentación', cC, sectionC.length)}
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ height: '8px', borderRadius: '4px', background: '#ECE7F0' }}>
                <div style={{ height: '8px', borderRadius: '4px', background: '#1A7F52', width: `${(done / TOTAL_FIELDS) * 100}%` }} />
              </div>
              <span style={HELP}>{done} de {TOTAL_FIELDS} campos completos</span>
            </div>
          </aside>

          <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <section id="sec-a" style={CARD}>
              <SectionHead letter="A" title="Datos principales" subtitle="Así aparecerás en el catálogo de rastro." done={cA === sectionA.length} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ ...COL, flex: '2 1 280px' }}>
                  <label htmlFor="f-name" style={LABEL}>Nombre legal o comercial</label>
                  <input id="f-name" placeholder="Fundación Ejemplo" {...register('name')} style={INPUT} />
                  {errors.name && <span style={ERR}>{errors.name.message}</span>}
                </div>
                <div style={{ ...COL, flex: '1 1 200px' }}>
                  <label htmlFor="f-rif" style={LABEL}>RIF</label>
                  <input
                    id="f-rif"
                    placeholder="J-00000000-0"
                    autoComplete="off"
                    {...register('rif', { onChange: (e) => (e.target.value = formatRif(e.target.value)) })}
                    style={{ ...INPUT, ...MONO }}
                  />
                  {rifError && <span style={ERR}>{rifError}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label htmlFor="f-desc" style={LABEL}>Misión o proyecto</label>
                  <span style={{ ...MONO, fontSize: '12px', color: descLen >= 480 ? '#8E1B47' : '#5A5468' }}>{descLen}/500</span>
                </div>
                <textarea id="f-desc" maxLength={500} rows={4} placeholder="Qué hacen, a quién ayudan y en qué se gasta el dinero." {...register('desc')} style={{ ...INPUT, minHeight: '48px', padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }} />
                {errors.desc && <span style={ERR}>{errors.desc.message}</span>}
                <span style={HELP}>Mínimo 30 caracteres. Sé concreto: los donantes deciden con esto.</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ ...COL, flex: '1 1 200px' }}>
                  <label htmlFor="f-cat" style={LABEL}>Categoría</label>
                  <select id="f-cat" {...register('cat')} style={{ ...INPUT, cursor: 'pointer' }}>
                    <option value="">Elige una categoría</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {errors.cat && <span style={ERR}>{errors.cat.message}</span>}
                </div>
                <div style={{ ...COL, flex: '1 1 160px' }}>
                  <label htmlFor="f-country" style={LABEL}>País</label>
                  <input id="f-country" placeholder="Venezuela" {...register('country')} style={INPUT} />
                  {errors.country && <span style={ERR}>{errors.country.message}</span>}
                </div>
                <div style={{ ...COL, flex: '1 1 160px' }}>
                  <label htmlFor="f-city" style={LABEL}>Ciudad</label>
                  <input id="f-city" placeholder="Caracas" {...register('city')} style={INPUT} />
                  {errors.city && <span style={ERR}>{errors.city.message}</span>}
                </div>
              </div>
            </section>

            <section id="sec-b" style={CARD}>
              <SectionHead letter="B" title="Cobro y contacto" subtitle="Aquí llegan los tramos liberados y las alertas de auditoría." done={cB === sectionB.length} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="f-wallet" style={LABEL}>Wallet de cobro</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <input id="f-wallet" placeholder="0x…" autoComplete="off" {...register('wallet')} style={{ ...INPUT, ...MONO, fontSize: '14px', color: '#3B3FB6', flex: '1 1 320px', width: 'auto' }} />
                  <button
                    type="button"
                    disabled={!address}
                    onClick={() => address && setValue('wallet', address, { shouldValidate: true })}
                    style={{ minHeight: '48px', padding: '0 16px', borderRadius: '10px', border: '1.5px solid #1B1530', background: '#FFFFFF', color: '#1B1530', fontFamily: 'inherit', fontSize: '14px', fontWeight: 600, cursor: address ? 'pointer' : 'not-allowed' }}
                  >
                    Usar wallet de mi sesión
                  </button>
                </div>
                {isSessionWallet && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#135E3C', fontWeight: 600 }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: '#1A7F52' }} />
                    Wallet creada con tu login de Google · Privy
                  </span>
                )}
                {!isSessionWallet && walletValue && isAddress(walletValue, { strict: false }) && (
                  // TODO: when the wallet differs from the Privy one, ask for a signed message to prove ownership.
                  <span style={{ fontSize: '13px', color: '#6B4A00', fontWeight: 600 }}>
                    Es una wallet distinta a la de tu sesión. Más adelante te pediremos firmar un mensaje para comprobar que es tuya.
                  </span>
                )}
                {errors.wallet && <span style={ERR}>{errors.wallet.message}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="f-email" style={LABEL}>Correo oficial</label>
                <input id="f-email" type="email" placeholder="contacto@fundacion.org" {...register('email')} style={INPUT} />
                {errors.email && <span style={ERR}>{errors.email.message}</span>}
                <span style={HELP}>Recibirás aquí los resultados de auditoría y cualquier alerta de sello roto.</span>
              </div>
            </section>

            <section id="sec-c" style={CARD}>
              <SectionHead letter="C" title="Documentación" subtitle="Se guardan en Supabase Storage; el hash del documento de RIF queda en cadena y nuestro auditor lo revisa." done={cC === sectionC.length} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ ...COL, flex: '1 1 260px' }}>
                  <span style={LABEL}>Logotipo o imagen de perfil</span>
                  <Dropzone
                    accept="image/png,image/jpeg,image/svg+xml"
                    icon="upload"
                    title="Arrastra el archivo o haz clic"
                    hint="PNG, JPG o SVG · cuadrado, mín. 400 px"
                    fileName={values.logo instanceof File ? values.logo.name : null}
                    onFiles={(f) => void pickLogo(f)}
                  />
                  {logoPreview && <img src={logoPreview} alt="Vista previa del logotipo" style={{ width: '72px', height: '72px', borderRadius: '999px', objectFit: 'cover', border: '1.5px solid #DAD4CF' }} />}
                  {fileErrors.logo && <span role="alert" style={ERR}>{fileErrors.logo}</span>}
                </div>
                <div style={{ ...COL, flex: '1 1 260px' }}>
                  <span style={LABEL}>Documento de RIF (SENIAT)</span>
                  <Dropzone
                    accept="application/pdf,image/jpeg,image/png"
                    icon="file"
                    title="Arrastra el archivo o haz clic"
                    hint="PDF, JPG o PNG · máx. 10 MB · lo valida nuestro auditor"
                    fileName={values.rifDoc instanceof File ? values.rifDoc.name : null}
                    onFiles={pickRifDoc}
                  />
                  {fileErrors.rifDoc && <span role="alert" style={ERR}>{fileErrors.rifDoc}</span>}
                </div>
              </div>
            </section>

            <div style={{ ...CARD, borderColor: '#1B1530' }}>
              <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" {...register('accept', { onChange: () => clearErrors('accept') })} style={{ width: '22px', height: '22px', margin: '1px 0 0', accentColor: '#B4235A', flexShrink: 0 }} />
                <span style={{ fontSize: '15px', lineHeight: 1.45 }}>
                  Entiendo que cada tramo se libera solo con factura y RIF del proveedor, y que una factura que no coincida congela la fundación y devuelve la custodia a los donantes.
                </span>
              </label>
              {submitError && <span role="alert" style={ERR}>{submitError}</span>}
              {sent ? (
                <div role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontSize: '15px', fontWeight: 600, color: outcome?.status === 'active' ? '#135E3C' : outcome?.status === 'rejected' ? '#8E1B47' : '#6B4A00' }}>{status}</span>
                  <Link to="/panel" style={{ minHeight: '54px', padding: '0 26px', borderRadius: '12px', background: '#B4235A', color: '#FFFFFF', fontSize: '17px', fontWeight: 700, display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
                    Ir a mi panel
                  </Link>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                  <button
                    type="submit"
                    disabled={!ready || busy !== null}
                    style={{ minHeight: '54px', padding: '0 26px', borderRadius: '12px', border: 'none', background: ready && !busy ? '#B4235A' : '#ECE7F0', color: ready && !busy ? '#FFFFFF' : '#5A5468', fontFamily: 'inherit', fontSize: '17px', fontWeight: 700, cursor: ready && !busy ? 'pointer' : 'not-allowed' }}
                  >
                    {busy ?? 'Enviar registro a revisión'}
                  </button>
                  <span style={HELP}>{status}</span>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </PageShell>
  )
}
