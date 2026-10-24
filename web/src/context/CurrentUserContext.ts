import { createContext } from 'react'
import type { ConnectedWallet, User as PrivyUser } from '@privy-io/react-auth'
import type { User } from '../types'

export interface CurrentUserValue {
  ready: boolean
  authenticated: boolean
  user: PrivyUser | null
  dbUser: User | null
  wallet: ConnectedWallet | undefined
  address: `0x${string}` | undefined
  email: string | null
  /** Simulated USD balance; null until the first sync completes. */
  balance: number | null
  /** User-facing message when the last `sync-user` call failed; null otherwise. */
  error: string | null
  setBalance: (balance: number) => void
  /** Forces a new `sync-user` call. */
  refresh: () => Promise<void>
}

export const CurrentUserContext = createContext<CurrentUserValue | null>(null)
