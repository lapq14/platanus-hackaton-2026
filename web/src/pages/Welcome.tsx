import { useEffect, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { Building2, HeartHandshake, LogIn } from 'lucide-react'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { clearIntent, readIntent, saveIntent, type LoginIntent } from '../lib/intent'

export default function Welcome() {
  const { login } = usePrivy()
  const { ready, authenticated, dbUser, error } = useCurrentUser()

  const destination = dbUser
    ? dbUser.role === 'ong'
      ? '/organizacion'
      : readIntent() === 'ong'
        ? '/organizacion/registro'
        : '/fundaciones'
    : null

  useEffect(() => {
    if (destination) clearIntent()
  }, [destination])

  if (destination) return <Navigate to={destination} replace />

  if (authenticated) {
    return <p className="text-center text-slate-500">{error ?? 'Preparando tu cuenta…'}</p>
  }

  const enter = (intent: LoginIntent) => {
    saveIntent(intent)
    login()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Bienvenido a Trazo</h1>
        <p className="mt-2 text-slate-600">Donaciones con custodia progresiva y gastos verificables. ¿Cómo quieres entrar?</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Door
          icon={<HeartHandshake size={28} />}
          title="Soy donante"
          text="Dona a fundaciones verificadas y sigue en qué se gasta cada dólar."
          cta="Entrar como donante"
          disabled={!ready}
          onClick={() => enter('donor')}
        />
        <Door
          icon={<Building2 size={28} />}
          title="Soy una organización"
          text="Regístrate, recibe donaciones y mira en tiempo real lo que te donan."
          cta="Entrar como organización"
          disabled={!ready}
          onClick={() => enter('ong')}
        />
      </div>
    </div>
  )
}

function Door(props: { icon: ReactNode; title: string; text: string; cta: string; disabled: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
      <div className="text-brand-600">{props.icon}</div>
      <h2 className="mt-3 text-lg font-semibold">{props.title}</h2>
      <p className="mt-1 flex-1 text-sm text-slate-600">{props.text}</p>
      <button
        disabled={props.disabled}
        onClick={props.onClick}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        <LogIn size={16} /> {props.cta}
      </button>
    </div>
  )
}
