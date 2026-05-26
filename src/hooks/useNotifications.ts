import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useRealtimeTable } from './useRealtimeTable'

export function useNotifications() {
  const { user } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchUnread = useCallback(async () => {
    if (!user?.id) return
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
    setUnreadCount(count ?? 0)
  }, [user?.id])

  useEffect(() => {
    fetchUnread()
  }, [fetchUnread])

  useRealtimeTable({
    table: 'notifications',
    event: 'INSERT',
    filter: user?.id ? `user_id=eq.${user.id}` : undefined,
    enabled: !!user?.id,
    onData: () => setUnreadCount(prev => prev + 1),
  })

  useRealtimeTable({
    table: 'notifications',
    event: 'UPDATE',
    filter: user?.id ? `user_id=eq.${user.id}` : undefined,
    enabled: !!user?.id,
    onData: () => fetchUnread(),
  })

  const markAllRead = useCallback(async () => {
    if (!user?.id) return
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
    setUnreadCount(0)
  }, [user?.id])

  return { unreadCount, markAllRead }
}
