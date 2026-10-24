import { usePrivy } from '@privy-io/react-auth'
import { LogIn, LogOut, Wallet } from 'lucide-react'

const HAS_PRIVY = Boolean(import.meta.env.VITE_PRIVY_APP_ID)

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function PrivyAuthButton() {
  const { ready, authenticated, login, logout, user } = usePrivy()
  if (!ready) return <div className="h-9 w-28 rounded-lg bg-slate-100 animate-pulse" />
  if (!authenticated) {
    return (
      <button
        onClick={login}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        <LogIn size={16} /> Entrar con Google
      </button>
    )
  }
  const addr = user?.wallet?.address
  return (
    <div className="flex items-center gap-3">
      {addr && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-mono">
          <Wallet size={14} /> {short(addr)}
        </span>
      )}
      <button onClick={logout} className="text-slate-500 hover:text-slate-900" title="Salir">
        <LogOut size={18} />
      </button>
    </div>
  )
}

export default function AuthButton() {
  if (!HAS_PRIVY) {
    return <span className="text-xs text-amber-600">Falta VITE_PRIVY_APP_ID</span>
  }
  return <PrivyAuthButton />
}
