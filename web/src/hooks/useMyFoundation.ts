import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { OWN_FOUNDATION_COLUMNS } from '../lib/columns'
import { toFoundation, toStats } from '../lib/normalize'
import type { Foundation, FoundationStats } from '../types'
import { useCurrentUser } from './useCurrentUser'

interface State {
  foundation: Foundation | null
  stats: FoundationStats | null
  loading: boolean
  error: string | null
}

/** The foundation owned by the signed-in user (`foundations.user_id`), with its money summary. */
export function useMyFoundation() {
  const { dbUser } = useCurrentUser()
  const userId = dbUser?.id
  const [state, setState] = useState<State>({ foundation: null, stats: null, loading: true, error: null })

  const load = useCallback(async () => {
    if (!userId) return
    const f = await supabase.from('foundations').select(OWN_FOUNDATION_COLUMNS).eq('user_id', userId).maybeSingle()
    if (f.error) {
      setState({ foundation: null, stats: null, loading: false, error: f.error.message })
      return
    }
    if (!f.data) {
      setState({ foundation: null, stats: null, loading: false, error: null })
      return
    }
    const foundation = toFoundation(f.data as unknown as Foundation)
    const s = await supabase.from('foundation_stats').select('*').eq('foundation_id', foundation.id).maybeSingle()
    setState({ foundation, stats: s.data ? toStats(s.data as FoundationStats) : null, loading: false, error: s.error?.message ?? null })
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  return { ...state, reload: load }
}
