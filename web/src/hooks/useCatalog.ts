import { useEffect, useState } from 'react'
import type { CatalogFoundation } from '../components/OrgCard'
import { supabase } from '../lib/supabase'
import type { ReputationState } from '../types'

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
  reputation_state: ReputationState
}

interface CatalogState {
  items: CatalogFoundation[]
  loading: boolean
  error: string | null
}

export interface CatalogOptions {
  /** Only foundations of this level or higher (the home page starts at level 3). */
  minLevel?: number
  /**
   * Only foundations that are neither "sin historial" nor "inconfiable". The reputation state comes from the
   * `foundation_stats` view, so this filter runs in the database query, not in the browser.
   */
  trustedOnly?: boolean
}

/** States that are shown to donors on the home page: they have history and no incidents. */
const TRUSTED_STATES: ReputationState[] = ['en_construccion', 'confiable']

/** Active foundations ordered by reputation, with the sealed-invoice counter and reputation state. */
export function useCatalog({ minLevel, trustedOnly = false }: CatalogOptions = {}): CatalogState {
  const [state, setState] = useState<CatalogState>({ items: [], loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let foundations = supabase
        .from('foundations')
        .select('id,name,category,level,reputation_score')
        .eq('status', 'active')
        .order('reputation_score', { ascending: false })
      if (minLevel !== undefined) foundations = foundations.gte('level', minLevel)

      let stats = supabase.from('foundation_stats').select('foundation_id,sealed_invoices_count,reputation_state')
      if (trustedOnly) stats = stats.in('reputation_state', TRUSTED_STATES)

      const [f, s] = await Promise.all([foundations, stats])
      if (cancelled) return
      if (f.error || s.error) {
        setState({ items: [], loading: false, error: (f.error ?? s.error)?.message ?? 'Error' })
        return
      }
      const statById = new Map((s.data as StatRow[]).map((r) => [r.foundation_id, r]))
      const items = (f.data as FoundationRow[])
        // With trustedOnly the stats query already dropped the other states: a missing row means "not trusted".
        .filter((r) => !trustedOnly || statById.has(r.id))
        .map<CatalogFoundation>((r) => ({
          id: r.id,
          name: r.name,
          category: r.category ?? 'Otra',
          level: r.level,
          reputation: r.reputation_score,
          sealedInvoices: statById.get(r.id)?.sealed_invoices_count ?? 0,
          reputationState: statById.get(r.id)?.reputation_state ?? 'sin_historial',
        }))
      setState({ items, loading: false, error: null })
    })()
    return () => {
      cancelled = true
    }
  }, [minLevel, trustedOnly])

  return state
}
