import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface UseRealtimeTableOptions<T extends Record<string, unknown>> {
  table: string
  event?: ChangeEvent
  filter?: string
  onData: (payload: RealtimePostgresChangesPayload<T>) => void
  enabled?: boolean
}

export function useRealtimeTable<T extends Record<string, unknown>>({
  table,
  event = '*',
  filter,
  onData,
  enabled = true,
}: UseRealtimeTableOptions<T>) {
  useEffect(() => {
    if (!enabled) return

    const channelName = `${table}-${event}-${filter ?? 'all'}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          ...(filter ? { filter } : {}),
        },
        onData,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, event, filter, onData, enabled])
}
