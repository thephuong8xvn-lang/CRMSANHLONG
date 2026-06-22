// ─────────────────────────────────────────────────────────────
// usePosOfflineQueue — quản lý hàng đợi đơn bán nhanh offline.
//   • Liệt kê đơn pending/failed (theo nhân viên).
//   • flush(): đẩy lần lượt lên fn_pos_quick_sale (kèm client_request_id).
//       - Thành công → xóa khỏi hàng đợi.
//       - Lỗi NGHIỆP VỤ server (thiếu tồn, vượt hạn mức...) → đánh dấu 'failed'
//         + lưu lý do, GIỮ LẠI cho NV xử lý (quyết định nghiệp vụ).
//       - Lỗi MẠNG → giữ 'pending', thử lại lần sau.
//   • Tự flush khi có sự kiện 'online' và khi mount (nếu đang online).
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { listQueue, removeQueued, updateQueued, type PosQueueItem } from '../lib/offlineDb'
import { logger } from '../lib/logger'

// Phân biệt lỗi mạng (nên thử lại) với lỗi nghiệp vụ (đánh dấu failed).
function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('fetch')
  )
}

export function usePosOfflineQueue(userId?: string) {
  const [items, setItems] = useState<PosQueueItem[]>([])
  const [syncing, setSyncing] = useState(false)
  const flushingRef = useRef(false)

  const refresh = useCallback(async () => {
    setItems(await listQueue(userId))
  }, [userId])

  const flush = useCallback(async (): Promise<{ ok: number; failed: number }> => {
    if (flushingRef.current) return { ok: 0, failed: 0 }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: 0, failed: 0 }
    flushingRef.current = true
    setSyncing(true)
    let ok = 0
    let failed = 0
    try {
      const queue = await listQueue(userId)
      for (const item of queue.filter((q) => q.status === 'pending')) {
        try {
          const { error } = await supabase.rpc('fn_pos_quick_sale', {
            p_payload: { ...item.payload, client_request_id: item.id },
          })
          if (error) throw error
          await removeQueued(item.id) // server đã nhận (idempotent) → xóa khỏi đợi
          ok++
        } catch (err: any) {
          if (isNetworkError(err)) {
            // mất mạng giữa chừng → dừng, để pending thử lại sau
            await updateQueued(item.id, { attempts: item.attempts + 1 })
            break
          }
          // lỗi nghiệp vụ → giữ lại, đánh dấu để NV xử lý
          await updateQueued(item.id, {
            status: 'failed',
            error: err?.message || 'Lỗi không xác định',
            attempts: item.attempts + 1,
          })
          failed++
          logger.report('POS offline flush thất bại', { source: 'pos_offline', error: err?.message }, 'warn')
        }
      }
    } finally {
      flushingRef.current = false
      setSyncing(false)
      await refresh()
    }
    return { ok, failed }
  }, [userId, refresh])

  // Tự flush khi online lại + khi mount (nếu đang online).
  useEffect(() => {
    void refresh()
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    if (typeof navigator !== 'undefined' && navigator.onLine) void flush()
    return () => window.removeEventListener('online', onOnline)
  }, [flush, refresh])

  const pending = items.filter((i) => i.status === 'pending')
  const failed = items.filter((i) => i.status === 'failed')

  return { items, pending, failed, syncing, flush, refresh, discard: removeQueued }
}

export default usePosOfflineQueue
