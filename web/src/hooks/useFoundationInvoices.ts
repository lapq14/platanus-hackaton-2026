import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toInvoice } from '../lib/normalize'
import type { Invoice } from '../types'

const POLL_MS = 15_000

/**
 * All invoices of a foundation, newest first, read from the public `invoices_public` view
 * (no document paths) and refreshed by polling. The foundation volume is small; filtering, sorting and
 * "Cargar más" run on the client.
 */
export function useFoundationInvoices(foundationId: string | undefined) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!foundationId) return
    const { data, error: err } = await supabase
      .from('invoices_public')
      .select('*')
      .eq('foundation_id', foundationId)
      .order('uploaded_at', { ascending: false })
    if (err) setError(err.message)
    else {
      setError(null)
      setInvoices(((data ?? []) as Invoice[]).map(toInvoice))
    }
    setLoading(false)
  }, [foundationId])

  useEffect(() => {
    if (!foundationId) return
    void load()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [foundationId, load])

  return { invoices, loading, error, reload: load }
}
