import { Link, NavLink, Outlet } from 'react-router-dom'
import { PlusCircle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import AuthButton from './AuthButton'
import TopUpModal from './TopUpModal'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { fmtUsd } from '../lib/web3'

export default function Layout() {
  const { authenticated, balance, error, refresh, dbUser } = useCurrentUser()
  const isOrg = dbUser?.role === 'ong'
  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'text-brand-700 font-medium' : 'text-slate-500 hover:text-slate-900'
  const [topUpOpen, setTopUpOpen] = useState(false)

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 font-semibold text-lg">
              <ShieldCheck className="text-brand-600" size={24} />
              Trazo
            </Link>
            <nav className="hidden gap-4 text-sm sm:flex">
              <NavLink to="/fundaciones" className={navClass}>
                Fundaciones
              </NavLink>
              {authenticated && isOrg && (
                <NavLink to="/organizacion" className={navClass}>
                  Mi organización
                </NavLink>
              )}
              {authenticated && !isOrg && (
                <NavLink to="/mis-donaciones" className={navClass}>
                  Mis donaciones
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {authenticated && !isOrg && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-sm">
                <span className="text-slate-500">Saldo</span>
                {error ? (
                  <>
                    <span className="text-red-700">{error}</span>
                    <button onClick={() => void refresh()} className="font-medium text-brand-700 hover:text-brand-600">
                      Reintentar
                    </button>
                  </>
                ) : (
                  <span className="font-mono font-medium">{balance === null ? '…' : fmtUsd(balance)}</span>
                )}
                <button
                  onClick={() => setTopUpOpen(true)}
                  className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-600"
                >
                  <PlusCircle size={14} /> Recargar
                </button>
              </div>
            )}
            <AuthButton />
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-slate-400 py-6">
        Donaciones con custodia progresiva y auditoría verificable · Platanus Hack 26
      </footer>
      {topUpOpen && <TopUpModal onClose={() => setTopUpOpen(false)} />}
    </div>
  )
}
