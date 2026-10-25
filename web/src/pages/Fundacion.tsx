import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import DonorHeader from '../components/DonorHeader'
import PageShell, { Notice } from '../components/PageShell'
import StatCard from '../components/StatCard'
import TopUpModal from '../components/TopUpModal'
import { InstagramIcon, TikTokIcon, XIcon } from '../components/icons/Social'
import { LEVEL_RELEASE, LEVEL_ROMAN, toLevel } from '../config/levels'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { useFoundationDetail } from '../hooks/useFoundationDetail'
import { ApiError, donate as requestDonation } from '../lib/api'
import { explorerAddress, explorerTx } from '../lib/chain'
import { formatUSDT, shortHash } from '../lib/format'
import type { Foundation } from '../types'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const PRESETS = [10, 25, 50, 150]
const PENDING_KEY = 'rastro:pending-donation'

const SOCIAL_LINK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  minHeight: '44px',
  padding: '0 16px 0 12px',
  borderRadius: '999px',
  border: '1.5px solid #DAD4CF',
  background: '#FFFFFF',
  color: '#1B1530',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 600,
}

function SocialRow({ f }: { f: Foundation }) {
  const items = [
    { url: f.instagram_url, name: 'Instagram', icon: <InstagramIcon /> },
    { url: f.tiktok_url, name: 'TikTok', icon: <TikTokIcon /> },
    { url: f.x_url, name: 'X', icon: <XIcon /> },
  ].filter((s) => !!s.url)
  if (items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }} aria-label="Redes sociales de la fundación">
      {items.map((s) => (
        <a key={s.name} href={s.url ?? '#'} target="_blank" rel="noopener noreferrer" aria-label={`${s.name} de ${f.name}`} style={SOCIAL_LINK}>
          {s.icon}
          {s.name}
        </a>
      ))}
    </div>
  )
}

export default function Fundacion() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { login, authenticated, getAccessToken } = usePrivy()
  const { dbUser, balance, setBalance } = useCurrentUser()
  const { foundation, stats, invoices, loading, error } = useFoundationDetail(id)

  const [amount, setAmount] = useState(50)
  const [custom, setCustom] = useState(false)
  const [customText, setCustomText] = useState('')
  const [topUp, setTopUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Restore the amount chosen before the login redirect.
  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw || !id) return
    try {
      const saved = JSON.parse(raw) as { foundationId: string; amount: number }
      if (saved.foundationId === id && Number.isFinite(saved.amount) && saved.amount >= 1) {
        setAmount(saved.amount)
        if (!PRESETS.includes(saved.amount)) {
          setCustom(true)
          setCustomText(String(saved.amount))
        }
      }
    } catch {
      // ignore corrupt storage
    }
    sessionStorage.removeItem(PENDING_KEY)
  }, [id])

  const back = () => {
    if (location.key !== 'default') void navigate(-1)
    else void navigate('/explorar')
  }

  if (loading) {
    return (
      <PageShell minHeight={1000}>
        <DonorHeader active="explorar" />
        <Notice>Cargando fundación…</Notice>
      </PageShell>
    )
  }

  if (error || !foundation) {
    return (
      <PageShell minHeight={1000}>
        <DonorHeader active="explorar" />
        <Notice title={error ? 'No pudimos cargar la fundación' : 'No encontramos esta fundación'}>
          <Link to="/explorar">← Todas las fundaciones</Link>
        </Notice>
      </PageShell>
    )
  }

  const level = toLevel(foundation.level)
  const pct = LEVEL_RELEASE[level]
  const receiving = foundation.status === 'active'
  const today = Math.round(amount * pct) / 100
  const rest = Math.round((amount - today) * 100) / 100
  const insufficient = balance !== null && amount > balance
  const amountValid = Number.isFinite(amount) && amount >= 1

  const submit = async () => {
    setNotice(null)
    if (!authenticated) {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ foundationId: foundation.id, amount }))
      login()
      return
    }
    if (!dbUser || busy || !amountValid) return
    setBusy(true)
    try {
      // TODO fase contrato: approve USDT + contract.donate(foundationId, amount) from the Privy wallet.
      // Today the `donate` Edge Function debits the simulated balance and creates the donation + 4 tranches.
      const token = await getAccessToken()
      if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      const res = await requestDonation(token, foundation.id, amount)
      setBalance(res.balance)
      void navigate(`/mis-rastros?donacion=${res.donation.id}`)
    } catch (e) {
      setBusy(false)
      if (e instanceof ApiError && e.code === 'insufficient_funds') {
        setNotice('Fondos insuficientes. Recarga tu billetera o elige un monto menor.')
      } else {
        setNotice('No pudimos registrar la donación. Tu dinero sigue en tu billetera.')
      }
    }
  }

  const amountButton = (v: number) => {
    const on = !custom && amount === v
    return (
      <button
        key={v}
        type="button"
        onClick={() => {
          setCustom(false)
          setAmount(v)
        }}
        aria-pressed={on}
        style={{ minHeight: '48px', borderRadius: '10px', border: `1.5px solid ${on ? '#1B1530' : '#DAD4CF'}`, background: on ? '#1B1530' : '#FFFFFF', color: on ? '#F6F4EF' : '#1B1530', ...MONO, fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
      >
        {v}USDT
      </button>
    )
  }

  return (
    <PageShell minHeight={1000}>
      <DonorHeader active="explorar" />
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '28px 24px 64px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <button
          type="button"
          onClick={back}
          style={{ alignSelf: 'flex-start', fontSize: '15px', padding: '8px 0', border: 'none', background: 'transparent', color: '#3B3FB6', fontFamily: 'inherit', cursor: 'pointer' }}
        >
          ← Todas las fundaciones
        </button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', alignItems: 'flex-start' }}>
          <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '26px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center' }}>
                <span style={{ ...MONO, fontSize: '12px', letterSpacing: '1.2px', color: '#5A5468' }}>
                  {(foundation.category ?? 'Otra').toUpperCase()}
                  {foundation.rif ? ` · RIF ${foundation.rif}` : ''}
                </span>
                {foundation.contract_address && (
                  <a href={explorerAddress(foundation.contract_address)} target="_blank" rel="noopener noreferrer" style={{ ...MONO, fontSize: '12px', textDecoration: 'none' }}>
                    contrato {shortHash(foundation.contract_address)} ↗
                  </a>
                )}
              </div>
              <h1 style={{ margin: 0, fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 0.95, fontWeight: 800, letterSpacing: '-2px' }}>{foundation.name}</h1>
              {foundation.description && (
                <p style={{ margin: 0, fontSize: '18px', lineHeight: 1.5, color: '#5A5468', maxWidth: '620px' }}>{foundation.description}</p>
              )}
              <SocialRow f={foundation} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              <StatCard label="Reputación" value={`${foundation.reputation_score}%`} valueSize={26} padding="16px" />
              <StatCard label="Nivel" value={LEVEL_ROMAN[level]} valueSize={26} padding="16px" />
              <StatCard label="Facturas completadas" value={stats?.sealed_invoices_count ?? 0} valueSize={26} padding="16px" />
              {/* "Facturas con detalles" = verified invoices whose agent_checks include a failed check (human review suggested). */}
              <StatCard label="Facturas con detalles" value={stats?.flagged_invoices_count ?? 0} valueSize={26} padding="16px" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Últimas facturas selladas</h2>
              <div style={{ background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '14px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', minWidth: '560px' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#5A5468', fontSize: '12px' }}>
                      {['CONCEPTO', 'PROVEEDOR (RIF)', 'MONTO', 'HASH'].map((h) => (
                        <th key={h} style={{ padding: '12px 16px', fontWeight: 600 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} style={{ borderTop: '1px solid #ECE7F0' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{inv.concept}</td>
                        <td style={{ padding: '12px 16px', ...MONO, fontSize: '13px' }}>{inv.supplier_rif}</td>
                        <td style={{ padding: '12px 16px', ...MONO }}>{formatUSDT(inv.amount)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          {inv.file_hash && (
                            <a href={explorerTx(inv.file_hash)} target="_blank" rel="noopener noreferrer" style={{ ...MONO, fontSize: '13px', textDecoration: 'none' }}>
                              {shortHash(inv.file_hash)} ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {invoices.length === 0 && (
                  <p style={{ margin: 0, padding: '24px 16px', textAlign: 'center', color: '#5A5468' }}>Aún no hay facturas selladas.</p>
                )}
              </div>
            </div>
          </div>

          <aside style={{ flex: '1 1 360px', background: '#FFFFFF', border: '1.5px solid #1B1530', borderRadius: '20px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {!receiving ? (
              <p role="alert" style={{ margin: 0, fontSize: '16px', fontWeight: 600, lineHeight: 1.4 }}>
                Esta fundación no está recibiendo donaciones ahora.
              </p>
            ) : (
              <>
                <span style={{ ...MONO, fontSize: '12px', letterSpacing: '1.2px', color: '#5A5468' }}>
                  MONTO · TU SALDO {balance === null ? '$—' : formatUSDT(balance)}
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
                  {PRESETS.map(amountButton)}
                  <button
                    type="button"
                    aria-pressed={custom}
                    onClick={() => {
                      setCustom(true)
                      setCustomText(String(amount))
                    }}
                    style={{ gridColumn: '1 / -1', minHeight: '44px', borderRadius: '10px', border: `1.5px solid ${custom ? '#1B1530' : '#DAD4CF'}`, background: custom ? '#1B1530' : '#FFFFFF', color: custom ? '#F6F4EF' : '#1B1530', fontFamily: 'inherit', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Otro
                  </button>
                </div>
                {custom && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600 }}>
                    Monto en USDT (mínimo 1)
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      inputMode="decimal"
                      value={customText}
                      onChange={(e) => {
                        setCustomText(e.target.value)
                        const v = Math.round(Number(e.target.value) * 100) / 100
                        setAmount(Number.isFinite(v) ? v : 0)
                      }}
                      style={{ minHeight: '46px', borderRadius: '10px', border: '1.5px solid #1B1530', background: '#FFFFFF', padding: '0 14px', ...MONO, fontSize: '15px', color: '#1B1530' }}
                    />
                  </label>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <span style={{ ...MONO, fontSize: '12px', letterSpacing: '1.2px', color: '#5A5468' }}>ASÍ SE MOVERÁN TUS ${amountValid ? amount : 0}</span>
                  <div style={{ display: 'flex', height: '44px', border: '1.5px solid #1B1530', borderRadius: '10px', overflow: 'hidden', ...MONO, fontSize: '12px' }}>
                    <div style={{ flex: pct, background: '#1A7F52', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>{pct}%</div>
                    {[2, 3, 4].map((n) => (
                      <div key={n} style={{ flex: (100 - pct) / 3, display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1.5px dashed #8A8296' }}>
                        Cuota {n}
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: '#5A5468' }}>
                    <strong style={{ color: '#1B1530' }}>{today.toFixed(2)} USDT llega hoy.</strong> El resto ({rest.toFixed(2)} USDT) queda en custodia y se libera solo cuando la fundación confirme cada gasto con factura y RIF del proveedor.
                  </p>
                </div>
                {insufficient && (
                  <div role="alert" style={{ border: '1.5px solid #B4235A', background: '#F8E9EF', borderRadius: '12px', padding: '12px 14px', display: 'flex', gap: '10px', color: '#1B1530' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B4235A" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }}>
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v6" />
                      <path d="M12 17h.01" />
                    </svg>
                    <span style={{ fontSize: '14px', lineHeight: 1.4 }}>
                      <strong>Fondos insuficientes.</strong> Tu saldo es {formatUSDT(balance ?? 0)}. Recarga tu billetera o elige un monto menor.
                    </span>
                  </div>
                )}
                {notice && !insufficient && (
                  <p role="status" style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#8E1B47' }}>
                    {notice}
                  </p>
                )}
                {insufficient ? (
                  <button
                    type="button"
                    onClick={() => setTopUp(true)}
                    style={{ minHeight: '56px', borderRadius: '12px', border: '1.5px solid #1B1530', background: '#FFFFFF', color: '#1B1530', fontFamily: 'inherit', fontSize: '17px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Recargar billetera
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy || !amountValid || (authenticated && !dbUser)}
                    style={{ minHeight: '56px', borderRadius: '12px', border: 'none', background: busy || !amountValid ? '#ECE7F0' : '#B4235A', color: busy || !amountValid ? '#5A5468' : '#FFFFFF', fontFamily: 'inherit', fontSize: '18px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}
                  >
                    {busy ? 'Registrando en cadena…' : `Donar ${amountValid ? amount : 0} USDT con rastro`}
                  </button>
                )}
                <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', lineHeight: 1.4, color: '#5A5468' }}>
                  Si la fundación no comprueba el gasto, tu saldo en custodia vuelve a ti.
                </p>
              </>
            )}
          </aside>
        </div>
      </div>
      {topUp && <TopUpModal onClose={() => setTopUp(false)} />}
    </PageShell>
  )
}
