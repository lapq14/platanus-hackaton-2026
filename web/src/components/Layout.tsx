import { Link, NavLink, Outlet } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import AuthButton from './AuthButton'

const HAS_PRIVY = Boolean(import.meta.env.VITE_PRIVY_APP_ID)

export default function Layout() {
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
              <NavLink to="/" end className={({ isActive }) => (isActive ? 'text-brand-700 font-medium' : 'text-slate-500 hover:text-slate-900')}>
                Fundaciones
              </NavLink>
              {HAS_PRIVY && (
                <NavLink to="/mis-donaciones" className={({ isActive }) => (isActive ? 'text-brand-700 font-medium' : 'text-slate-500 hover:text-slate-900')}>
                  Mis donaciones
                </NavLink>
              )}
            </nav>
          </div>
          <AuthButton />
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-slate-400 py-6">
        Donaciones con custodia progresiva y auditoría verificable · Platanus Hack 26
      </footer>
    </div>
  )
}
