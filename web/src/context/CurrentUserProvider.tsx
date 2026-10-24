import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { ApiError, syncUser } from '../lib/api'
import type { User } from '../types'
import { CurrentUserContext } from './CurrentUserContext'

interface SyncedUser {
  key: string
  user: User
}

interface SyncFailure {
  key: string
  message: string
}

function syncErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return 'Esta wallet ya está asociada a otra cuenta'
  return 'No se pudo sincronizar tu cuenta'
}

/**
 * Single source of truth for the current user. Syncs the Privy identity with the `sync-user`
 * Edge Function once per (user, wallet) pair and shares the balance with the whole app.
 */
export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken } = usePrivy()
  const { wallets } = useWallets()
  const [synced, setSynced] = useState<SyncedUser | null>(null)
  const [syncError, setSyncError] = useState<SyncFailure | null>(null)
  // Key of the latest requested sync: dedupes in-flight calls and discards stale responses.
  const requested = useRef<string | null>(null)

  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0]
  const address = wallet?.address as `0x${string}` | undefined
  const email = user?.google?.email ?? user?.email?.address ?? null
  const syncKey = ready && authenticated && user && address ? `${user.id}:${address}` : null

  // A row synced for another (user, wallet) pair is never exposed.
  const dbUser = synced && synced.key === syncKey ? synced.user : null

  const error = syncError && syncError.key === syncKey ? syncError.message : null

  async function runSync(key: string, walletAddress: string) {
    requested.current = key
    setSyncError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('No access token')
      const { user: row } = await syncUser(token, walletAddress, email)
      if (requested.current === key) setSynced({ key, user: row })
    } catch (e) {
      console.error('sync-user failed', e)
      if (requested.current === key) {
        requested.current = null
        setSyncError({ key, message: syncErrorMessage(e) })
      }
    }
  }

  useEffect(() => {
    if (!syncKey || !address) {
      requested.current = null
      return
    }
    if (requested.current === syncKey) return
    void runSync(syncKey, address)
  // runSync changes every render; the key-based dedupe makes re-running on its identity unnecessary.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey, address])

  const setBalance = (balance: number) =>
    setSynced((s) => (s ? { ...s, user: { ...s.user, balance } } : s))
  const refresh = async () => {
    if (syncKey && address) await runSync(syncKey, address)
  }

  return (
    <CurrentUserContext
      value={{
        ready,
        authenticated,
        user,
        dbUser,
        wallet,
        address,
        email,
        balance: dbUser ? Number(dbUser.balance) : null,
        error,
        setBalance,
        refresh,
      }}
    >
      {children}
    </CurrentUserContext>
  )
}
