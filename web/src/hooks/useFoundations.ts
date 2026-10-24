import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Foundation } from '../types'

export function useFoundations() {
  const [data, setData] = useState<Foundation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('foundations')
      .select('*')
      .order('reputation_score', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setData(data as Foundation[])
        setLoading(false)
      })
  }, [])

  return { data, loading, error }
}

export function useFoundation(id: string | undefined) {
  const [data, setData] = useState<Foundation | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!id) return
    supabase
      .from('foundations')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        setData(data as Foundation | null)
        setLoading(false)
      })
  }, [id])

  useEffect(reload, [reload])

  return { data, loading, reload }
}
