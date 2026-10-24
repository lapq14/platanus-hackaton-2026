import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { registerFoundation } from '../lib/api'

const CATEGORIES = ['Alimentación', 'Salud', 'Educación', 'Animales', 'Vivienda', 'Otra']

export default function OrgRegister() {
  const { ready, authenticated, dbUser, refresh } = useCurrentUser()
  const { getAccessToken } = usePrivy()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!ready) return <p className="text-slate-500">Cargando…</p>
  if (!authenticated) return <Navigate to="/" replace />
  if (!dbUser) return <p className="text-slate-500">Preparando tu cuenta…</p>
  if (dbUser.role === 'ong') return <Navigate to="/organizacion" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      await registerFoundation(token, { name, description, category })
      await refresh()
      void navigate('/organizacion', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la organización')
    } finally {
      setBusy(false)
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none'
  const wallet = dbUser.wallet_address

  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <h1 className="text-2xl font-bold">Registra tu organización</h1>
      <p className="text-sm text-slate-600">
        Las donaciones llegarán a la wallet de tu cuenta ({wallet.slice(0, 6)}…{wallet.slice(-4)}).
      </p>
      <label className="block text-sm font-medium">
        Nombre
        <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Categoría
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Descripción
        <textarea rows={4} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button
        disabled={busy}
        className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? 'Registrando…' : 'Registrar organización'}
      </button>
    </form>
  )
}
