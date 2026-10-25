import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { useLogout } from '../hooks/useLogout'
import { formatUSDT } from '../lib/format'
import Logo from './Logo'
import TopUpModal from './TopUpModal'

type Active = 'explorar' | 'mis-rastros' | 'home'

const LINK: CSSProperties = { padding: '10px 16px', borderRadius: '999px', color: '#1B1530', textDecoration: 'none', fontSize: '15px' }
const LINK_ACTIVE: CSSProperties = { ...LINK, background: '#1B1530', color: '#F6F4EF', fontWeight: 600 }

interface ViewProps {
  active: Active
  /** Formatted balance (`$120.00`), `$—` while loading, or null when logged out. */
  balance: string | null
  initial: string
  foundationHref: string
  onLogin: () => void
  onTopUp: () => void
  onLogout: () => void
}

/** Presentational donor header (also used by the home page with `active="home"`). */
export function DonorHeaderView({ active, balance, initial, foundationHref, onLogin, onTopUp, onLogout }: ViewProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const home = active === 'home'
  return (
    <header style={{ borderBottom: '1.5px solid #DAD4CF', position: 'relative', zIndex: 2 }}>
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: home ? '16px 24px' : '14px 24px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px 28px',
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: '#1B1530' }}>
          <Logo variant="positive" height={40} />
        </Link>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', flex: 1 }}>
          {home ? (
            <a href="/#fundaciones" style={LINK}>
              Fundaciones
            </a>
          ) : (
            <Link to="/explorar" style={active === 'explorar' ? LINK_ACTIVE : LINK}>
              Explorar
            </Link>
          )}
          <Link to="/mis-rastros" style={active === 'mis-rastros' ? LINK_ACTIVE : LINK}>
            Mis rastros
          </Link>
          <a href="#" style={LINK}>
            Cómo funciona
          </a>
          <Link to={foundationHref} style={LINK}>
            Soy fundación
          </Link>
        </nav>
        {balance === null ? (
          <button
            type="button"
            onClick={onLogin}
            style={{ minHeight: '44px', padding: '0 18px', borderRadius: '999px', border: '1.5px solid #1B1530', background: '#FFFFFF', color: '#1B1530', fontFamily: 'inherit', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}
          >
            Entrar con Google
          </button>
        ) : (
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                minHeight: '44px',
                padding: '4px 6px 4px 16px',
                border: '1.5px solid #1B1530',
                borderRadius: '999px',
                background: '#FFFFFF',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '14px',
                color: '#1B1530',
                cursor: 'pointer',
              }}
            >
              {balance}
              <span
                style={{ width: '32px', height: '32px', borderRadius: '999px', background: '#1B1530', color: '#F6F4EF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700 }}
              >
                {initial}
              </span>
            </button>
            {open && (
              <div
                role="menu"
                style={{ position: 'absolute', right: 0, top: '52px', minWidth: '200px', background: '#FFFFFF', border: '1.5px solid #1B1530', borderRadius: '14px', padding: '6px', display: 'flex', flexDirection: 'column', zIndex: 10 }}
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onTopUp()
                  }}
                  style={{ textAlign: 'left', padding: '10px 12px', border: 'none', background: 'transparent', borderRadius: '8px', fontFamily: 'inherit', fontSize: '15px', color: '#1B1530', cursor: 'pointer' }}
                >
                  Recargar billetera
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={onLogout}
                  style={{ textAlign: 'left', padding: '10px 12px', border: 'none', background: 'transparent', borderRadius: '8px', fontFamily: 'inherit', fontSize: '15px', color: '#8E1B47', cursor: 'pointer' }}
                >
                  Salir
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}

/** Donor header wired to Privy + the simulated balance. */
export default function DonorHeader({ active }: { active: Active }) {
  const { login, authenticated } = usePrivy()
  const { balance, dbUser, user, email } = useCurrentUser()
  const logout = useLogout()
  const [topUp, setTopUp] = useState(false)

  const name = user?.google?.name ?? email ?? 'D'
  const foundationHref = dbUser?.role === 'ong' ? '/panel' : dbUser?.role === 'auditor' ? '/auditor' : '/registro'

  return (
    <>
      <DonorHeaderView
        active={active}
        balance={authenticated ? (balance === null ? '$—' : formatUSDT(balance)) : null}
        initial={name.trim().charAt(0).toUpperCase() || 'D'}
        foundationHref={foundationHref}
        onLogin={login}
        onTopUp={() => setTopUp(true)}
        onLogout={() => void logout()}
      />
      {topUp && <TopUpModal onClose={() => setTopUp(false)} />}
    </>
  )
}
