import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useCurrentUser } from '../hooks/useCurrentUser'
import type { UserRole } from '../types'
import { PrimaryButton } from './Buttons'
import Logo from './Logo'
import PageShell, { Notice } from './PageShell'

interface RoleGuardProps {
  /** `ong` = foundation owner (/panel). `auditor` = audit console (/auditor). */
  role: Exclude<UserRole, 'donor'>
  children: ReactNode
}

/** Gates a route by the role stored in `users.role` (synced from Privy through sync-user). */
export default function RoleGuard({ role, children }: RoleGuardProps) {
  const { login } = usePrivy()
  const { ready, authenticated, dbUser, error } = useCurrentUser()

  if (!ready) return <PageShell><Notice /></PageShell>

  if (!authenticated) {
    return (
      <PageShell>
        <div style={{ maxWidth: '420px', margin: '0 auto', padding: '96px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center' }}>
          <Logo height={40} />
          <p style={{ margin: 0, fontSize: '17px', color: '#5A5468' }}>
            {role === 'auditor' ? 'Inicia sesión para entrar a la consola de auditoría.' : 'Inicia sesión para entrar al panel de tu fundación.'}
          </p>
          <PrimaryButton onClick={login}>Entrar con Google</PrimaryButton>
        </div>
      </PageShell>
    )
  }

  if (!dbUser) {
    return <PageShell><Notice>{error ?? 'Preparando tu cuenta…'}</Notice></PageShell>
  }

  if (dbUser.role !== role) return <Navigate to={role === 'ong' ? '/registro' : '/'} replace />

  return <>{children}</>
}
