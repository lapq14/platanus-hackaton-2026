import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useLogout } from '../hooks/useLogout'
import Logo from './Logo'

const LINK: CSSProperties = { padding: '10px 16px', borderRadius: '999px', color: '#F6F4EF', textDecoration: 'none', fontSize: '15px' }
const LINK_ACTIVE: CSSProperties = { ...LINK, background: '#F6F4EF', color: '#1B1530', fontWeight: 600 }
const LOGOUT: CSSProperties = { fontSize: '13px', border: '1.5px solid #F6F4EF', borderRadius: '999px', padding: '8px 14px', background: 'transparent', color: '#F6F4EF', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }

/**
 * Dark header for the auditor console.
 * The agent chip is static for now. TODO fase agente: derive it from the audit function health check
 * ("Agente detenido" in amber when it does not respond).
 */
export default function AuditorHeader({ agentActive = true }: { agentActive?: boolean }) {
  const logout = useLogout()
  return (
    <header style={{ background: '#1B1530', color: '#F6F4EF' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '14px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 28px' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <Logo variant="negative" height={40} />
          <span style={{ fontSize: '20px', color: '#C9C2D6' }}>· auditoría</span>
        </Link>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', flex: 1 }}>
          <a href="#" style={LINK_ACTIVE}>
            Cola
          </a>
          <a href="#" style={LINK}>
            Fundaciones
          </a>
          <a href="#" style={LINK}>
            Facturas
          </a>
        </nav>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '13px',
            border: `1.5px solid ${agentActive ? '#F6F4EF' : '#E8A317'}`,
            color: agentActive ? '#F6F4EF' : '#E8A317',
            borderRadius: '999px',
            padding: '8px 14px',
          }}
        >
          {agentActive ? 'Agente activo' : 'Agente detenido'}
        </span>
        <button type="button" onClick={() => void logout()} style={LOGOUT}>
          Salir
        </button>
      </div>
    </header>
  )
}
