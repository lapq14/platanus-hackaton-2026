import { useEffect, useState } from 'react'
import { foundationTrace } from '../lib/api'
import { toFoundation, toInvoice, toStats } from '../lib/normalize'
import type { FoundationTrace } from '../types'

export interface TraceState {
  trace: FoundationTrace | null
  loading: boolean
  error: boolean
}

/** Public traceability of a foundation (no login). The server already sends numbers as numbers. */
export function useFoundationTrace(id: string | undefined): TraceState {
  const [state, setState] = useState<TraceState>({ trace: null, loading: true, error: false })

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setState({ trace: null, loading: true, error: false })
    foundationTrace(id)
      .then((t) => {
        if (cancelled) return
        setState({
          trace: {
            foundation: toFoundation(t.foundation),
            stats: t.stats ? toStats(t.stats) : null,
            invoices: t.invoices.map((i) => ({ ...toInvoice(i), funded_by: i.funded_by ?? [] })),
            contributions: t.contributions,
          },
          loading: false,
          error: false,
        })
      })
      .catch(() => {
        if (!cancelled) setState({ trace: null, loading: false, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return state
}
