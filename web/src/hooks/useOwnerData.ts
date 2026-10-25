import { useCallback, useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { ApiError, foundationFunds, foundationInvoices, foundationMe } from '../lib/api'
import { toInvoice } from '../lib/normalize'
import type { FundsView, OwnInvoice, OwnProfile } from '../types'

interface State<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/** Loads private data of the signed-in foundation owner through an authenticated Edge Function, refreshing on demand. */
function useOwnerFn<T>(fetcher: (token: string) => Promise<T>, enabled: boolean, pollMs?: number) {
  const { getAccessToken } = usePrivy()
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null })

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión de nuevo.')
      const data = await fetcher(token)
      setState({ data, loading: false, error: null })
    } catch (e) {
      const message = e instanceof ApiError || e instanceof Error ? e.message : 'No pudimos cargar tus datos.'
      setState((s) => ({ data: s.data, loading: false, error: message }))
    }
    // fetcher is a stable module-level function
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken])

  useEffect(() => {
    if (!enabled) return
    // oxlint-disable-next-line react-hooks/set-state-in-effect
    void load()
    if (!pollMs) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, pollMs)
    return () => clearInterval(t)
  }, [enabled, load, pollMs])

  return { ...state, reload: load }
}

/** Private profile, stats and appeals of the owner's foundation. */
export const useOwnProfile = (enabled = true) => useOwnerFn<OwnProfile>(foundationMe, enabled)

/** Contributions received, tranche usage and next unlock milestones. */
export const useOwnFunds = (enabled = true) => useOwnerFn<FundsView>(foundationFunds, enabled, 30_000)

/** The owner's invoices with the agent's explanation of each check, attempts and the evidence deadline. */
export function useOwnInvoices(enabled = true) {
  const r = useOwnerFn<{ invoices: OwnInvoice[]; max_attempts: number }>(foundationInvoices, enabled, 20_000)
  const invoices = (r.data?.invoices ?? []).map((i) => ({ ...toInvoice(i), has_origin_doc: i.has_origin_doc, has_destination_doc: i.has_destination_doc })) as OwnInvoice[]
  return { invoices, maxAttempts: r.data?.max_attempts ?? 3, loading: r.loading, error: r.error, reload: r.reload }
}
