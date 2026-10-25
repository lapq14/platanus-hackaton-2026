import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ApiError, BALANCE_CAP, TOPUP_PRESETS, topUp } from '../lib/api'
import { formatUSDT } from '../lib/format'
import Modal from './Modal'

/** Simulated wallet top-up (wallet-topup Edge Function). */
export default function TopUpModal({ onClose }: { onClose: () => void }) {
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
          ? `El saldo no puede superar ${formatUSDT(BALANCE_CAP)}.`
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <Modal title="Recargar billetera" onClose={onClose} maxWidth={420}>
      <p style={{ margin: 0, fontSize: '14px', color: '#5A5468' }}>
        Saldo simulado para la demo. Saldo actual:{' '}
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#1B1530' }}>{balance === null ? '— USDT' : formatUSDT(balance)}</span>
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
        {TOPUP_PRESETS.map((amount) => (
          <button
            key={amount}
            type="button"
            disabled={pending !== null || balance === null}
            onClick={() => void recharge(amount)}
            style={{
              minHeight: '48px',
              borderRadius: '10px',
              border: '1.5px solid #1B1530',
              background: '#FFFFFF',
              color: '#1B1530',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '15px',
              fontWeight: 600,
              cursor: pending !== null ? 'wait' : 'pointer',
            }}
          >
            {pending === amount ? '…' : `+${amount} USDT`}
          </button>
        ))}
      </div>
      {added !== null && (
        <p role="status" style={{ margin: 0, fontSize: '14px', color: '#135E3C', fontWeight: 600 }}>
          Se agregaron {formatUSDT(added)} a tu saldo.
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '14px', color: '#8E1B47', fontWeight: 600 }}>
          {error}
        </p>
      )}
    </Modal>
  )
}
