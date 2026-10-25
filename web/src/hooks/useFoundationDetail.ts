import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FOUNDATION_COLUMNS } from '../lib/columns'
import { toFoundation, toStats } from '../lib/normalize'
import type { Foundation, FoundationStats } from '../types'

interface DetailState {
  foundation: Foundation | null
  stats: FoundationStats | null
  loading: boolean
  error: string | null
}

const INITIAL: DetailState = { foundation: null, stats: null, loading: true, error: null }

export function useFoundationDetail(id: string | undefined): DetailState {
  const [state, setState] = useState<DetailState>(INITIAL)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setState(INITIAL)
    void (async () => {
      const [f, s] = await Promise.all([
        supabase.from('foundations').select(FOUNDATION_COLUMNS).eq('id', id).maybeSingle(),
        supabase.from('foundation_stats').select('*').eq('foundation_id', id).maybeSingle(),
      ])
      if (cancelled) return
      const err = f.error ?? s.error
      if (err) {
        setState({ ...INITIAL, loading: false, error: err.message })
        return
      }
      setState({
        foundation: f.data ? toFoundation(f.data as unknown as Foundation) : null,
        stats: s.data ? toStats(s.data as FoundationStats) : null,
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
