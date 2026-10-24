import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { supabase } from '../lib/supabase'
import { explorerTx } from '../lib/chain'
import { fmtUsd } from '../lib/web3'
import { StatusPill } from './FoundationDetail'
import ReputationBadge from '../components/ReputationBadge'
import type { Donation, Foundation } from '../types'

const POLL_MS = 8000

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function OrgDashboard() {
  const { ready, authenticated, dbUser } = useCurrentUser()
  const [foundation, setFoundation] = useState<Foundation | null | undefined>(undefined)
  const [donations, setDonations] = useState<Donation[]>([])

  const userId = dbUser?.id
  const foundationId = foundation?.id

  useEffect(() => {
    if (!userId) return
    supabase
      .from('foundations')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => setFoundation((data as Foundation | null) ?? null))
  }, [userId])

  const loadDonations = useCallback(async () => {
    if (!foundationId) return
    const { data } = await supabase
      .from('donations')
      .select('*, donor:users!donations_donor_id_fkey(email, wallet_address)')
      .eq('foundation_id', foundationId)
      .order('created_at', { ascending: false })
    setDonations((data as Donation[]) ?? [])
  }, [foundationId])

  useEffect(() => {
    // oxlint-disable-next-line react-hooks/set-state-in-effect
    void loadDonations()
    const timer = setInterval(() => void loadDonations(), POLL_MS)
    return () => clearInterval(timer)
  }, [loadDonations])

  if (!ready) return <p className="text-slate-500">Cargando…</p>
  if (!authenticated) return <Navigate to="/" replace />
  if (!dbUser || foundation === undefined) return <p className="text-slate-500">Cargando…</p>
  if (!foundation) return <Navigate to="/organizacion/registro" replace />

  const total = donations.reduce((s, d) => s + Number(d.total_amount), 0)
  const released = donations.reduce((s, d) => s + Number(d.amount_released), 0)
  const donors = new Set(donations.map((d) => d.donor_id)).size

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{foundation.name}</h1>
          <p className="text-sm text-slate-500">{foundation.category}</p>
        </div>
        <ReputationBadge foundation={foundation} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total donado" value={fmtUsd(total)} />
        <Stat label="Liberado a tu wallet" value={fmtUsd(released)} />
        <Stat label="Donantes" value={String(donors)} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Donaciones recibidas</h2>
        {donations.length === 0 && <p className="text-slate-500">Aún no has recibido donaciones. Esta lista se actualiza sola.</p>}
        {donations.map((d) => {
          const pct = Number(d.total_amount) > 0 ? Math.round((Number(d.amount_released) / Number(d.total_amount)) * 100) : 0
          return (
            <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{fmtUsd(d.total_amount)}</span>
                <StatusPill status={d.status} />
              </div>
              <div className="mt-1 flex items-center justify-between text-sm text-slate-600">
                <span>{d.donor?.email ?? (d.donor ? short(d.donor.wallet_address) : 'Anónimo')}</span>
                <span>{new Date(d.created_at).toLocaleString('es-VE')}</span>
              </div>
              <div className="mt-3 flex justify-between text-xs text-slate-500">
                <span>Liberado: {fmtUsd(d.amount_released)}</span>
                <span>{pct}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
              </div>
              {d.release_tx_hash && (
                <a
                  href={explorerTx(d.release_tx_hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700"
                >
                  Ver liberación en el explorer <ExternalLink size={12} />
                </a>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold font-mono">{value}</p>
    </div>
  )
}
