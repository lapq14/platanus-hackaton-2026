import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react'
import type { Foundation } from '../types'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ApiError, donate, type DonateResult } from '../lib/api'
import { explorerTx } from '../lib/chain'
import { fmtUsd } from '../lib/web3'
import TopUpModal from './TopUpModal'

type Props = { foundation: Foundation; onClose: () => void; onDone: () => void }
type Step = 'form' | 'processing' | 'done' | 'error' | 'insufficient'

export default function DonateModal({ foundation, onClose, onDone }: Props) {
  const { getAccessToken } = usePrivy()
  const { dbUser, balance, setBalance } = useCurrentUser()
  const [amount, setAmount] = useState('10')
  const [step, setStep] = useState<Step>('form')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DonateResult | null>(null)
  const [topUpOpen, setTopUpOpen] = useState(false)

  const amountNum = Number(amount) || 0
  const initial = (amountNum * foundation.payout_percentage) / 100
  const insufficient = balance !== null && amountNum > balance

  async function submit() {
    if (!dbUser) return
    setError(null)
    setStep('processing')
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      const res = await donate(token, foundation.id, amountNum)
      setBalance(res.balance)
      setResult(res)
      setStep('done')
      onDone()
    } catch (e) {
      if (e instanceof ApiError && e.status === 402 && e.code === 'insufficient_funds') {
        setStep('insufficient')
        return
      }
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-semibold">Donar a {foundation.name}</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
          </div>

          {step === 'form' && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>Tu saldo</span>
                <span className="font-mono">{balance === null ? '…' : fmtUsd(balance)}</span>
              </div>
              <label className="block">
                <span className="text-sm font-medium">Monto (USD)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono focus:border-brand-500 focus:outline-none"
                />
              </label>

              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex justify-between">
                  <span>Liberación inmediata ({foundation.payout_percentage}%)</span>
                  <span className="font-mono">{fmtUsd(initial)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Queda en custodia</span>
                  <span className="font-mono">{fmtUsd(amountNum - initial)}</span>
                </div>
              </div>

              {insufficient && (
                <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle size={18} className="shrink-0" />
                  <div>
                    <p className="font-medium">Fondos insuficientes</p>
                    <p>
                      Necesitas {fmtUsd(amountNum)} y tu saldo es {fmtUsd(balance ?? 0)}.{' '}
                      <button onClick={() => setTopUpOpen(true)} className="underline">
                        Recargar saldo
                      </button>
                    </p>
                  </div>
                </div>
              )}

              <button
                disabled={!dbUser || amountNum < 1 || insufficient || balance === null}
                onClick={submit}
                className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Donar {fmtUsd(amountNum)}
              </button>
            </div>
          )}

          {step === 'processing' && (
            <div className="mt-6 flex flex-col items-center gap-3 py-6 text-center">
              <Loader2 className="animate-spin text-brand-600" size={36} />
              <p className="font-medium">Procesando donación y liberando {foundation.payout_percentage}% a la fundación…</p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-2 text-brand-700">
                <CheckCircle2 size={22} /> <span className="font-medium">Donación registrada</span>
              </div>
              {result.release.status === 'released' && result.release.tx_hash ? (
                <TxLink label={`Liberación inicial (${fmtUsd(result.release.released ?? 0)})`} hash={result.release.tx_hash} />
              ) : (
                <p className="text-sm text-amber-700">
                  Tu donación quedó en custodia, pero la liberación inicial está pendiente.
                </p>
              )}
              <button onClick={onClose} className="mt-2 w-full rounded-lg bg-slate-900 py-2 text-white">Cerrar</button>
            </div>
          )}

          {step === 'insufficient' && (
            <div className="mt-6 space-y-3">
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle size={18} className="shrink-0" />
                <div>
                  <p className="font-medium">Fondos insuficientes</p>
                  <p>
                    Tu saldo no alcanza para donar {fmtUsd(amountNum)}.{' '}
                    <button onClick={() => setTopUpOpen(true)} className="underline">
                      Recargar saldo
                    </button>
                  </p>
                </div>
              </div>
              <button onClick={() => setStep('form')} className="w-full rounded-lg border border-slate-300 py-2">Volver</button>
            </div>
          )}

          {step === 'error' && (
            <div className="mt-6 space-y-3">
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 break-words">{error}</p>
              <button onClick={() => setStep('form')} className="w-full rounded-lg border border-slate-300 py-2">Reintentar</button>
            </div>
          )}
        </div>
      </div>
      {topUpOpen && <TopUpModal onClose={() => setTopUpOpen(false)} />}
    </>
  )
}

function TxLink({ label, hash }: { label: string; hash: string }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm hover:border-brand-500"
    >
      <span>{label}</span>
      <span className="inline-flex items-center gap-1 font-mono text-slate-500">
        {hash.slice(0, 10)}… <ExternalLink size={12} />
      </span>
    </a>
  )
}
