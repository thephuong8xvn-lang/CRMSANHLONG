import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

export function PwaUpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)

  useEffect(() => {
    import('virtual:pwa-register').then(({ registerSW }) => {
      registerSW({
        onNeedRefresh() { setNeedRefresh(true) },
        onOfflineReady() { setOfflineReady(true) },
        onRegistered(r) {
          r && setInterval(() => r.update(), 60 * 60 * 1000)
        },
      })
    }).catch(() => {})
  }, [])

  if (!needRefresh && !offlineReady) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-3 text-white shadow-xl text-sm">
      {needRefresh ? (
        <>
          <RefreshCw size={16} className="shrink-0" />
          <span>Có phiên bản mới, tải lại để cập nhật.</span>
          <button
            onClick={() => window.location.reload()}
            className="rounded bg-blue-500 px-3 py-1 text-xs font-medium hover:bg-blue-400 transition-colors"
          >
            Tải lại
          </button>
        </>
      ) : (
        <>
          <span>Ứng dụng sẵn sàng hoạt động offline.</span>
        </>
      )}
      <button
        onClick={() => { setNeedRefresh(false); setOfflineReady(false) }}
        className="ml-1 rounded p-0.5 hover:bg-white/10 transition-colors"
        aria-label="Đóng"
      >
        <X size={14} />
      </button>
    </div>
  )
}
