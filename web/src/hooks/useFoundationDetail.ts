import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toFoundation, toInvoice, toStats } from '../lib/normalize'
import type { Foundation, FoundationStats, Invoice } from '../types'

interface DetailState {
  foundation: Foundation | null
  stats: FoundationStats | null
  /** Latest verified invoices (max 5). */
  invoices: Invoice[]
  loading: boolean
  error: string | null
}

const INITIAL: DetailState = { foundation: null, stats: null, invoices: [], loading: true, error: null }

export function useFoundationDetail(id: string | undefined): DetailState {
  const [state, setState] = useState<DetailState>(INITIAL)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setState(INITIAL)
    void (async () => {
      const [f, s, inv] = await Promise.all([
        supabase.from('foundations').select('*').eq('id', id).maybeSingle(),
        supabase.from('foundation_stats').select('*').eq('foundation_id', id).maybeSingle(),
        supabase
          .from('invoices')
          .select('*')
          .eq('foundation_id', id)
          .eq('status', 'verified')
          .order('reviewed_at', { ascending: false })
          .limit(5),
      ])
      if (cancelled) return
      const err = f.error ?? s.error ?? inv.error
      if (err) {
        setState({ ...INITIAL, loading: false, error: err.message })
        return
      }
      setState({
        foundation: f.data ? toFoundation(f.data as Foundation) : null,
        stats: s.data ? toStats(s.data as FoundationStats) : null,
        invoices: ((inv.data ?? []) as Invoice[]).map(toInvoice),
        loading: false,
        error: null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  return state
}
