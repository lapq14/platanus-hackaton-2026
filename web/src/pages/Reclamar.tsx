import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { PrimaryButton } from '../components/Buttons'
import Logo from '../components/Logo'
import PageShell, { Notice } from '../components/PageShell'
import SignInPrompt from '../components/SignInPrompt'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ApiError, claimFoundation } from '../lib/api'

/** Formats what the user types as XXXX-XXXX-XXXX-XXXX. */
const format = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16)
    .replace(/(.{4})(?=.)/g, '$1-')

/** Redeems the one-time code that links an existing foundation to the signed-in account. */
export default function Reclamar() {
  const { getAccessToken } = usePrivy()
  const { ready, authenticated, dbUser, error: syncError, refresh } = useCurrentUser()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claimed, setClaimed] = useState<string | null>(null)

  if (!ready) return <PageShell><Notice /></PageShell>
  if (!authenticated) {
    return (
      <PageShell>
        <SignInPrompt message="Inicia sesión con la cuenta que administrará la fundación para canjear tu código." />
      </PageShell>
    )
  }
  if (!dbUser) return <PageShell><Notice>{syncError ?? 'Preparando tu cuenta…'}</Notice></PageShell>

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión de nuevo.')
      const res = await claimFoundation(token, code)
      setClaimed(res.name)
      await refresh()
      setTimeout(() => navigate('/panel', { replace: true }), 1500)
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'No pudimos canjear el código.')
    } finally {
      setBusy(false)
    }
  }

  const complete = code.replace(/-/g, '').length === 16

  return (
    <PageShell>
      <div style={{ maxWidth: '460px', margin: '0 auto', padding: '72px 24px', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', textAlign: 'center' }}>
        <Logo height={40} />
        <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 800, letterSpacing: '-1px' }}>Reclama tu fundación</h1>
        <p style={{ margin: 0, fontSize: '16px', color: '#5A5468', lineHeight: 1.5 }}>
          Si Rastro ya tiene tu fundación en el catálogo, te dimos un código de un solo uso para administrarla. Funciona una vez y vence.
        </p>
        {claimed ? (
          <p role="status" style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#135E3C', background: '#E6F4EC', borderRadius: '12px', padding: '14px 18px' }}>
            Listo: ahora administras {claimed}. Entrando a tu panel…
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (complete && !busy) void submit()
            }}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <label htmlFor="codigo" style={{ fontSize: '14px', fontWeight: 600, textAlign: 'left' }}>
              Código de reclamo
            </label>
            <input
              id="codigo"
              value={code}
              onChange={(e) => setCode(format(e.target.value))}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              style={{ minHeight: '54px', borderRadius: '12px', border: '1.5px solid #1B1530', padding: '0 16px', fontSize: '20px', letterSpacing: '1px', textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}
            />
            {error && (
              <span role="alert" style={{ fontSize: '14px', fontWeight: 600, color: '#8E1B47' }}>
                {error}
              </span>
            )}
            <PrimaryButton type="submit" disabled={!complete || busy} minHeight={54}>
              {busy ? 'Verificando…' : 'Canjear código'}
            </PrimaryButton>
          </form>
        )}
      </div>
    </PageShell>
  )
}
