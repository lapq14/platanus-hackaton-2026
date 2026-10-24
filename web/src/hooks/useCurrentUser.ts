import { use } from 'react'
import { CurrentUserContext } from '../context/CurrentUserContext'

/** Current Privy user, its DB row (with simulated balance) and the embedded wallet. */
export function useCurrentUser() {
  const ctx = use(CurrentUserContext)
  if (!ctx) throw new Error('useCurrentUser must be used inside CurrentUserProvider')
  return ctx
}
