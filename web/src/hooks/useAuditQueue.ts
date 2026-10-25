import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toInvoice, toStats } from '../lib/normalize'
import type { FoundationStats, Invoice } from '../types'

export interface QueueItem {
  invoice: Invoice
  foundationName: string
  /** Donors with money still in custody at this foundation (affected by a broken seal). */
  affectedDonors: number
}

interface Row extends Invoice {
  foundation: { name: string } | null
}

/** Audit queue: invoices waiting for a decision, with Realtime refresh. */
export function useAuditQueue() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('invoices')
      .select('*, foundation:foundations(name)')
      .eq('status', 'in_review')
      .order('uploaded_at', { ascending: true })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    const rows = (data ?? []) as Row[]
    const ids = [...new Set(rows.map((r) => r.foundation_id))]
    const stats = new Map<string, FoundationStats>()
    if (ids.length > 0) {
      const s = await supabase.from('foundation_stats').select('*').in('foundation_id', ids)
      for (const r of (s.data ?? []) as FoundationStats[]) stats.set(r.foundation_id, toStats(r))
    }
    setItems(
      rows.map((r) => ({
        invoice: toInvoice(r),
        foundationName: r.foundation?.name ?? 'Fundación',
        affectedDonors: stats.get(r.foundation_id)?.affected_donors ?? 0,
      })),
    )
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('audit-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  return { items, loading, error, reload: load }
}
