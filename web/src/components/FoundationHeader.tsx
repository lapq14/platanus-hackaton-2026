import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { toLevel } from '../config/levels'
import { useLogout } from '../hooks/useLogout'
import type { ReputationState } from '../types'
import { reputationLabel } from '../lib/reputation'
import Logo from './Logo'

const LINK: CSSProperties = { padding: '10px 16px', borderRadius: '999px', color: '#F6F4EF', textDecoration: 'none', fontSize: '15px' }
const LINK_ACTIVE: CSSProperties = { ...LINK, background: '#F6F4EF', color: '#1B1530', fontWeight: 600 }
const CHIP: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', border: '1.5px solid #F6F4EF', borderRadius: '999px', padding: '8px 14px' }
const LOGOUT: CSSProperties = { ...CHIP, background: 'transparent', color: '#F6F4EF', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }

interface FoundationHeaderProps {
  active: 'resumen' | 'fondos' | 'facturas' | 'perfil'
  level: number
  reputation: number
  reputationState?: ReputationState
}

/** Dark header for foundation pages (Panel, Facturas). */
export default function FoundationHeader({ active, level, reputation, reputationState }: FoundationHeaderProps) {
  const logout = useLogout()
  return (
    <header style={{ background: '#1B1530', color: '#F6F4EF' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '14px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 28px' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <Logo variant="negative" height={40} />
          <span style={{ fontSize: '20px', color: '#C9C2D6' }}>· fundación</span>
        </Link>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', flex: 1 }}>
          <Link to="/panel" style={active === 'resumen' ? LINK_ACTIVE : LINK}>
            Resumen
          </Link>
          <Link to="/panel/fondos" style={active === 'fondos' ? LINK_ACTIVE : LINK}>
            Fondos
          </Link>
          <Link to="/panel/facturas" style={active === 'facturas' ? LINK_ACTIVE : LINK}>
            Facturas
          </Link>
          <Link to="/panel/perfil" style={active === 'perfil' ? LINK_ACTIVE : LINK}>
            Perfil
          </Link>
        </nav>
        <span style={CHIP}>
          Nivel {toLevel(level)} · {reputationState === 'sin_historial' ? reputationLabel('sin_historial') : `${reputation}%`}
        </span>
        <button type="button" onClick={() => void logout()} style={LOGOUT}>
          Salir
        </button>
      </div>
    </header>
  )
}
