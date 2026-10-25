import { useCallback, useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { listDonations } from '../lib/api'
import { toDonation, toInvoice } from '../lib/normalize'
import type { Donation, Invoice } from '../types'
import { useCurrentUser } from './useCurrentUser'

interface State {
  donations: Donation[]
  /** Invoices referenced by tranche uses, unlocks and refunds, by id (with the agent's check details). */
  invoices: Record<string, Invoice>
  loading: boolean
  error: string | null
}

const POLL_MS = 15_000

/**
 * The signed-in donor's donations with tranches, the uses of each tranche, refunds and linked invoices.
 * Everything comes from the `my-donations` Edge Function (Privy identity): private tables are closed to the
 * anon key, so there is no Realtime and the hook polls instead.
 */
export function useMyDonations() {
  const { getAccessToken } = usePrivy()
  const { dbUser, error: syncError } = useCurrentUser()
  const userId = dbUser?.id
  const [state, setState] = useState<State>({ donations: [], invoices: {}, loading: true, error: null })

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sesión expirada')
      const { donations: raw, invoices: rawInvoices } = await listDonations(token, 'donor')
      const donations = raw.map(toDonation)
      const invoices: Record<string, Invoice> = {}
      for (const i of rawInvoices ?? []) invoices[i.id] = toInvoice(i)
      setState({ donations, invoices, loading: false, error: null })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'No se pudieron cargar tus donaciones' }))
    }
  }, [getAccessToken])

  useEffect(() => {
    if (!userId) {
      // The account could not be synced: stop the skeleton and surface the reason instead of loading forever.
      // oxlint-disable-next-line react-hooks/set-state-in-effect
      if (syncError) setState((s) => ({ ...s, loading: false, error: syncError }))
      return
    }
    void load()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [userId, syncError, load])

  return { ...state, reload: load }
}
