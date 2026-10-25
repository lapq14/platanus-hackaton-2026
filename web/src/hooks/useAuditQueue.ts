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

const POLL_MS = 15_000

/** Audit queue: invoices waiting for a decision (public view, no document paths), refreshed by polling. */
export function useAuditQueue() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('invoices_public')
      .select('*')
      .eq('status', 'in_review')
      .order('uploaded_at', { ascending: true })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    const rows = (data ?? []) as Invoice[]
    const ids = [...new Set(rows.map((r) => r.foundation_id))]
    const stats = new Map<string, FoundationStats>()
    const names = new Map<string, string>()
    if (ids.length > 0) {
      const [s, f] = await Promise.all([
        supabase.from('foundation_stats').select('*').in('foundation_id', ids),
        supabase.from('foundations').select('id,name').in('id', ids),
      ])
      for (const r of (s.data ?? []) as FoundationStats[]) stats.set(r.foundation_id, toStats(r))
      for (const r of (f.data ?? []) as { id: string; name: string }[]) names.set(r.id, r.name)
    }
    setItems(
      rows.map((r) => ({
        invoice: toInvoice(r),
        foundationName: names.get(r.foundation_id) ?? 'Fundación',
        affectedDonors: stats.get(r.foundation_id)?.affected_donors ?? 0,
      })),
    )
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  return { items, loading, error, reload: load }
}
