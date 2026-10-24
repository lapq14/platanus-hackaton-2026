import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { ArrowLeft, ExternalLink, HeartHandshake } from 'lucide-react'
import { useFoundation } from '../hooks/useFoundations'
import ReputationBadge from '../components/ReputationBadge'
import DonateModal from '../components/DonateModal'
import { explorerAddress, explorerTx } from '../lib/chain'
import { supabase } from '../lib/supabase'
import { fmtUsd } from '../lib/web3'
import type { Donation } from '../types'

export default function FoundationDetail() {
  const { id } = useParams()
  const { data: f, loading, reload } = useFoundation(id)
  const [open, setOpen] = useState(false)
  const [donations, setDonations] = useState<Donation[]>([])

  const loadDonations = useCallback(() => {
    if (!id) return
    supabase
      .from('donations')
      .select('*')
      .eq('foundation_id', id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setDonations((data as Donation[]) ?? []))
  }, [id])

  useEffect(loadDonations, [loadDonations])

  if (loading) return <p className="text-slate-500">Cargando…</p>
  if (!f) return <p>No encontrada.</p>

  const canDonate = f.status !== 'suspended'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft size={16} /> Volver
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-4">
          {f.logo_url && <img src={f.logo_url} alt="" className="h-16 w-16 rounded-xl bg-slate-100" />}
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{f.name}</h1>
            <p className="text-sm text-slate-500">{f.category}</p>
            <div className="mt-2">
              <ReputationBadge foundation={f} />
            </div>
          </div>
        </div>
        <p className="mt-4 text-slate-700">{f.description}</p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-slate-500">Liberación inicial</dt>
            <dd className="text-lg font-semibold">{f.payout_percentage}%</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-slate-500">Reputación</dt>
            <dd className="text-lg font-semibold">{f.reputation_score}/100</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-slate-500">Total recibido</dt>
            <dd className="text-lg font-semibold">{fmtUsd(f.total_received)}</dd>
          </div>
        </dl>

        <a
          href={explorerAddress(f.wallet_address)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-xs font-mono text-slate-500 hover:text-brand-700"
        >
          {f.wallet_address} <ExternalLink size={12} />
        </a>

        <div className="mt-6">
          {canDonate ? (
            <DonateButton onClick={() => setOpen(true)} />
          ) : (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              Esta fundación está suspendida por una auditoría fallida. No acepta donaciones.
            </p>
          )}
        </div>
      </div>

      {donations.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="mb-3 font-semibold">Donaciones recientes</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {donations.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-mono">{fmtUsd(d.total_amount)}</span>
                  <span className="ml-2 text-slate-500">
                    liberado {fmtUsd(d.amount_released)} · {new Date(d.created_at).toLocaleString('es-VE')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={d.status} />
                  {d.release_tx_hash && (
                    <a href={explorerTx(d.release_tx_hash)} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand-700">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <DonateModal
          foundation={f}
          onClose={() => setOpen(false)}
          onDone={() => {
            loadDonations()
            reload()
          }}
        />
      )}
    </div>
  )
}

function DonateButton({ onClick }: { onClick: () => void }) {
  return <PrivyDonateButton onClick={onClick} />
}

function PrivyDonateButton({ onClick }: { onClick: () => void }) {
  const { ready, authenticated, login } = usePrivy()
  return (
    <button
      onClick={authenticated ? onClick : login}
      disabled={!ready}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-base font-semibold text-white hover:bg-brand-700 disabled:bg-slate-300 sm:w-auto sm:px-8"
    >
      <HeartHandshake size={20} />
      {authenticated ? 'Donar' : 'Inicia sesión para donar'}
    </button>
  )
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    in_escrow: { label: 'En custodia', cls: 'bg-slate-100 text-slate-700' },
    partially_released: { label: 'Parcialmente liberada', cls: 'bg-blue-100 text-blue-800' },
    completed: { label: 'Completada', cls: 'bg-emerald-100 text-emerald-800' },
    refunded: { label: 'Reembolsada', cls: 'bg-red-100 text-red-800' },
    pending: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
    approved: { label: 'Aprobada', cls: 'bg-emerald-100 text-emerald-800' },
    rejected: { label: 'Rechazada', cls: 'bg-red-100 text-red-800' },
  }
  const s = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-700' }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
}
