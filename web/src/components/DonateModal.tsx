import { useEffect, useState } from 'react'
import { useSendTransaction } from '@privy-io/react-auth'
import { parseEther, toHex } from 'viem'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react'
import type { Foundation } from '../types'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { supabase } from '../lib/supabase'
import { CHAIN, ESCROW_ADDRESS, explorerTx } from '../lib/chain'
import { FAUCET_URL, SYMBOL, fmt, getBalanceEth, publicClient } from '../lib/web3'

type Props = { foundation: Foundation; onClose: () => void; onDone: () => void }
type Step = 'form' | 'signing' | 'confirming' | 'releasing' | 'done' | 'error'

const GAS_RESERVE = 0.0002 // margen para gas al validar fondos

export default function DonateModal({ foundation, onClose, onDone }: Props) {
  const { dbUser, wallet, address } = useCurrentUser()
  const { sendTransaction } = useSendTransaction()
  const [amount, setAmount] = useState('0.001')
  const [balance, setBalance] = useState<number | null>(null)
  const [step, setStep] = useState<Step>('form')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ depositHash: string; releaseHash?: string; released?: number } | null>(null)

  useEffect(() => {
    if (!address) return
    getBalanceEth(address).then(setBalance).catch(() => setBalance(0))
  }, [address])

  const amountNum = Number(amount) || 0
  const initial = (amountNum * foundation.payout_percentage) / 100
  const insufficient = balance !== null && amountNum + GAS_RESERVE > balance

  async function donate() {
    if (!address || !wallet || !dbUser) return
    setError(null)
    try {
      // 1. Firmar y enviar la donación a la wallet de custodia
      setStep('signing')
      await wallet.switchChain(CHAIN.id)
      const { hash } = await sendTransaction(
        { to: ESCROW_ADDRESS, value: toHex(parseEther(amount)), chainId: CHAIN.id },
        {
          address,
          uiOptions: {
            description: `${foundation.payout_percentage}% se libera de inmediato; el resto queda en custodia hasta que la fundación verifique sus gastos.`,
            buttonText: 'Confirmar donación',
            successHeader: 'Donación en custodia',
          },
        },
      )

      // 2. Registrar en Supabase
      setStep('confirming')
      const { data: donation, error: dbErr } = await supabase
        .from('donations')
        .insert({
          donor_id: dbUser.id,
          foundation_id: foundation.id,
          total_amount: amountNum,
          currency: SYMBOL,
          deposit_tx_hash: hash,
        })
        .select()
        .single()
      if (dbErr) throw new Error(dbErr.message)

      await publicClient.waitForTransactionReceipt({ hash })

      // 3. Liberar el tramo inicial desde custodia (Edge Function)
      setStep('releasing')
      const { data, error: fnErr } = await supabase.functions.invoke('release-initial', {
        body: { donation_id: donation.id },
      })
      if (fnErr) {
        // La donación quedó registrada en custodia; la liberación se puede reintentar.
        setResult({ depositHash: hash })
        setError(`Donación en custodia, pero la liberación inicial falló: ${fnErr.message}`)
        setStep('done')
        return
      }
      setResult({ depositHash: hash, releaseHash: data.release_tx_hash, released: data.released })
      setStep('done')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">Donar a {foundation.name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        {step === 'form' && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>Tu balance</span>
              <span className="font-mono">{balance === null ? '…' : `${fmt(balance, 5)} ${SYMBOL}`}</span>
            </div>
            <label className="block">
              <span className="text-sm font-medium">Monto ({SYMBOL})</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono focus:border-brand-500 focus:outline-none"
              />
            </label>

            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span>Liberación inmediata ({foundation.payout_percentage}%)</span>
                <span className="font-mono">{fmt(initial, 6)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Queda en custodia</span>
                <span className="font-mono">{fmt(amountNum - initial, 6)}</span>
              </div>
            </div>

            {insufficient && (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle size={18} className="shrink-0" />
                <div>
                  <p className="font-medium">Fondos insuficientes</p>
                  <p>
                    Necesitas al menos {fmt(amountNum + GAS_RESERVE, 5)} {SYMBOL} (monto + gas).{' '}
                    <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="underline">
                      Obtener fondos de prueba
                    </a>
                  </p>
                </div>
              </div>
            )}

            <button
              disabled={!address || amountNum <= 0 || insufficient || balance === null}
              onClick={donate}
              className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Donar {fmt(amountNum, 6)} {SYMBOL}
            </button>
          </div>
        )}

        {(step === 'signing' || step === 'confirming' || step === 'releasing') && (
          <div className="mt-6 flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="animate-spin text-brand-600" size={36} />
            <p className="font-medium">
              {step === 'signing' && 'Firma la transacción en tu wallet…'}
              {step === 'confirming' && 'Confirmando depósito en custodia…'}
              {step === 'releasing' && `Liberando ${foundation.payout_percentage}% a la fundación…`}
            </p>
          </div>
        )}

        {step === 'done' && result && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-2 text-brand-700">
              <CheckCircle2 size={22} /> <span className="font-medium">Donación registrada</span>
            </div>
            {error && <p className="text-sm text-amber-700">{error}</p>}
            <TxLink label="Depósito en custodia" hash={result.depositHash} />
            {result.releaseHash && (
              <TxLink label={`Liberación inicial (${fmt(result.released ?? 0, 6)} ${SYMBOL})`} hash={result.releaseHash} />
            )}
            <button onClick={onClose} className="mt-2 w-full rounded-lg bg-slate-900 py-2 text-white">Cerrar</button>
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
