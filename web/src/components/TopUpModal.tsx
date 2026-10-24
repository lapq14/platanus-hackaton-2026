import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { CheckCircle2, Loader2, X } from 'lucide-react'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ApiError, BALANCE_CAP, TOPUP_PRESETS, topUp } from '../lib/api'
import { fmtUsd } from '../lib/web3'

type Props = { onClose: () => void }

export default function TopUpModal({ onClose }: Props) {
  const { getAccessToken } = usePrivy()
  const { balance, setBalance } = useCurrentUser()
  const [pending, setPending] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<number | null>(null)

  async function recharge(amount: number) {
    setError(null)
    setAdded(null)
    setPending(amount)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      const res = await topUp(token, amount)
      setBalance(res.balance)
      setAdded(amount)
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'cap_exceeded'
          ? `El saldo no puede superar ${fmtUsd(BALANCE_CAP)}.`
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">Recargar saldo</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        <p className="mt-2 text-sm text-slate-500">
          Saldo simulado para la demo. Saldo actual:{' '}
          <span className="font-mono text-slate-900">{balance === null ? '…' : fmtUsd(balance)}</span>
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {TOPUP_PRESETS.map((amount) => (
            <button
              key={amount}
              disabled={pending !== null || balance === null}
              onClick={() => recharge(amount)}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 py-3 font-medium hover:border-brand-500 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === amount ? <Loader2 size={16} className="animate-spin" /> : `+${fmtUsd(amount).replace('.00', '')}`}
            </button>
          ))}
        </div>

        {added !== null && (
          <p className="mt-4 flex items-center gap-2 text-sm text-brand-700">
            <CheckCircle2 size={18} /> Se agregaron {fmtUsd(added)} a tu saldo.
          </p>
        )}
        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 break-words">{error}</p>}

        <button onClick={onClose} className="mt-5 w-full rounded-lg border border-slate-300 py-2">Cerrar</button>
      </div>
    </div>
  )
}
