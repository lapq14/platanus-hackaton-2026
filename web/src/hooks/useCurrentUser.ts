import { useEffect, useState } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { supabase } from '../lib/supabase'
import type { User } from '../types'

/**
 * Sincroniza el usuario de Privy con la tabla `users` de Supabase.
 * Devuelve la fila de la DB y la wallet embebida lista para firmar.
 */
export function useCurrentUser() {
  const { ready, authenticated, user } = usePrivy()
  const { wallets } = useWallets()
  const [dbUser, setDbUser] = useState<User | null>(null)

  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0]
  const address = wallet?.address as `0x${string}` | undefined
  const email = user?.google?.email ?? user?.email?.address ?? null

  useEffect(() => {
    if (!ready || !authenticated || !address || !user) {
      setDbUser(null)
      return
    }
    supabase
      .from('users')
      .upsert(
        { wallet_address: address, privy_id: user.id, email },
        { onConflict: 'wallet_address' },
      )
      .select()
      .single()
      .then(({ data }) => setDbUser((data as User) ?? null))
  }, [ready, authenticated, address, user, email])

  return { ready, authenticated, user, dbUser, wallet, address, email }
}
