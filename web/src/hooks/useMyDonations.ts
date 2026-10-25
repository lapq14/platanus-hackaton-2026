import { useCallback, useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { listDonations } from '../lib/api'
import { toDonation, toInvoice } from '../lib/normalize'
import type { Donation, Invoice } from '../types'
import { useCurrentUser } from './useCurrentUser'

interface State {
  donations: Donation[]
  /** Invoices referenced by tranches / refunds, by id. */
  invoices: Record<string, Invoice>
  loading: boolean
  error: string | null
}

const POLL_MS = 15_000

/**
 * The signed-in donor's donations with tranches, refunds and linked invoices.
 * Reads through the `my-donations` Edge Function (Privy identity). Tranches have no anon RLS policy,
 * so Supabase Realtime cannot reach them: the hook polls instead.
 * TODO fase agente: switch to Realtime once reads are scoped by a Supabase-verifiable identity.
 */
export function useMyDonations() {
  const { getAccessToken } = usePrivy()
  const { dbUser } = useCurrentUser()
  const userId = dbUser?.id
  const [state, setState] = useState<State>({ donations: [], invoices: {}, loading: true, error: null })

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sesión expirada')
      // The function also answers the invoices the tranches / refunds point to: `invoices` is not readable
      // with the anon key any more.
      const { donations: raw, invoices: rows } = await listDonations(token, 'donor')
      const donations = raw.map(toDonation)
      const invoices: Record<string, Invoice> = {}
      for (const i of rows ?? []) invoices[i.id] = toInvoice(i)
      setState({ donations, invoices, loading: false, error: null })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'No se pudieron cargar tus donaciones' }))
    }
  }, [getAccessToken])

  useEffect(() => {
    if (!userId) return
    void load()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [userId, load])

  return { ...state, reload: load }
}
