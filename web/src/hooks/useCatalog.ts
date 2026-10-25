import { useEffect, useState } from 'react'
import type { CatalogFoundation } from '../components/OrgCard'
import { supabase } from '../lib/supabase'

interface FoundationRow {
  id: string
  name: string
  category: string | null
  level: number
  reputation_score: number
}

interface StatRow {
  foundation_id: string
  sealed_invoices_count: number
}

interface CatalogState {
  items: CatalogFoundation[]
  loading: boolean
  error: string | null
}

/** Active foundations ordered by reputation, with the sealed-invoice counter. Shared by Home and Explorar. */
export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ items: [], loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [f, s] = await Promise.all([
        supabase
          .from('foundations')
          .select('id,name,category,level,reputation_score')
          .eq('status', 'active')
          .order('reputation_score', { ascending: false }),
        supabase.from('foundation_stats').select('foundation_id,sealed_invoices_count'),
      ])
      if (cancelled) return
      if (f.error || s.error) {
        setState({ items: [], loading: false, error: (f.error ?? s.error)?.message ?? 'Error' })
        return
      }
      const counts = new Map((s.data as StatRow[]).map((r) => [r.foundation_id, r.sealed_invoices_count]))
      const items = (f.data as FoundationRow[]).map<CatalogFoundation>((r) => ({
        id: r.id,
        name: r.name,
        category: r.category ?? 'Otra',
        level: r.level,
        reputation: r.reputation_score,
        sealedInvoices: counts.get(r.id) ?? 0,
      }))
      setState({ items, loading: false, error: null })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
