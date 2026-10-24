import { useCallback, useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { releaseInitial } from '../lib/api'
import { supabase } from '../lib/supabase'
import { explorerTx } from '../lib/chain'
import { fmtUsd } from '../lib/web3'
import { StatusPill } from './FoundationDetail'
import type { Donation } from '../types'

export default function MyDonations() {
  const { ready, authenticated, dbUser } = useCurrentUser()
  const { getAccessToken } = usePrivy()
  const [rows, setRows] = useState<Donation[]>([])
  const [retrying, setRetrying] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null)

  const load = useCallback(async () => {
    if (!dbUser) return
    const { data } = await supabase
      .from('donations')
      .select('*, foundation:foundations(*)')
      .eq('donor_id', dbUser.id)
      .order('created_at', { ascending: false })
    setRows((data as Donation[]) ?? [])
  }, [dbUser])

  useEffect(() => {
    // oxlint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function retryRelease(id: string) {
    setRetrying(id)
    setRetryError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      await releaseInitial(token, id)
      await load()
    } catch (e) {
      setRetryError({ id, message: e instanceof Error ? e.message : 'No se pudo reintentar la liberación' })
    } finally {
      setRetrying(null)
    }
  }

  if (!ready) return <p className="text-slate-500">Cargando…</p>
  if (!authenticated) return <p className="text-slate-500">Inicia sesión para ver tus donaciones.</p>

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Mis donaciones</h1>
      {rows.length === 0 && <p className="text-slate-500">Aún no has donado.</p>}
      {rows.map((d) => {
        const pct = d.total_amount > 0 ? Math.round((Number(d.amount_released) / Number(d.total_amount)) * 100) : 0
        return (
          <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <Link to={`/fundacion/${d.foundation_id}`} className="font-semibold hover:text-brand-700">
                {d.foundation?.name ?? 'Fundación'}
              </Link>
              <StatusPill status={d.status} />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
              <span className="font-mono">{fmtUsd(d.total_amount)}</span>
              <span>{new Date(d.created_at).toLocaleString('es-VE')}</span>
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Liberado a la fundación</span>
                <span>{pct}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
            {d.status === 'in_escrow' && Number(d.amount_released) === 0 && !d.release_tx_hash && (
              <div className="mt-3">
                <button
                  disabled={retrying === d.id}
                  onClick={() => void retryRelease(d.id)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {retrying === d.id ? 'Liberando…' : 'Reintentar liberación'}
                </button>
                {retryError?.id === d.id && <p className="mt-2 text-xs text-red-700 break-words">{retryError.message}</p>}
              </div>
            )}
            {d.release_tx_hash && (
              <a
                href={explorerTx(d.release_tx_hash)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700"
              >
                Ver liberación inicial en el explorer <ExternalLink size={12} />
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
