import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toInvoice } from '../lib/normalize'
import type { Invoice } from '../types'

/**
 * All invoices of a foundation, newest first, kept fresh with Supabase Realtime
 * (the `invoices` table is in the realtime publication and readable with the anon key).
 * The foundation volume is small; filtering, sorting and "Cargar más" run on the client.
 */
export function useFoundationInvoices(foundationId: string | undefined) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!foundationId) return
    const { data, error: err } = await supabase
      .from('invoices')
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
    const channel = supabase
      .channel(`invoices:${foundationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `foundation_id=eq.${foundationId}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [foundationId, load])

  return { invoices, loading, error, reload: load }
}
