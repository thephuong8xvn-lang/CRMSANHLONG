import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

export function PwaUpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  // Hàm do registerSW trả về. PHẢI gọi nó (updateSW(true)) để service worker mới
  // skipWaiting rồi nạp lại trang. window.location.reload() suông KHÔNG đủ: SW mới
  // vẫn nằm chờ, SW cũ tiếp tục điều khiển trang → nhân viên bấm "Tải lại" nhưng
  // vẫn chạy bản cũ cho tới khi đóng hết tab.
  const [updateSW, setUpdateSW] = useState<((reload?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    import('virtual:pwa-register').then(({ registerSW }) => {
      const update = registerSW({
        onNeedRefresh() { setNeedRefresh(true) },
        onOfflineReady() { setOfflineReady(true) },
        onRegistered(r) {
          if (!r) return
          timer = setInterval(() => {
            // Bỏ qua khi đang offline: r.update() sẽ reject và (trước đây, không có
            // .catch) nổi lên thành unhandledrejection → ghi vào app_error_logs.
            // Nhân viên bán hàng dùng 4G chập chờn nên chuyện này xảy ra thường xuyên.
            if (!navigator.onLine) return
            r.update().catch(() => { /* mạng chập chờn — lần kiểm tra sau lo tiếp */ })
          }, 60 * 60 * 1000)
        },
      })
      // useState nhận hàm sẽ hiểu nhầm là lazy initializer → phải bọc thêm 1 lớp.
      setUpdateSW(() => update)
    }).catch(() => {})

    return () => { if (timer) clearInterval(timer) }
  }, [])

  if (!needRefresh && !offlineReady) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-3 text-white shadow-xl text-sm">
      {needRefresh ? (
        <>
          <RefreshCw size={16} className="shrink-0" />
          <span>Có phiên bản mới, tải lại để cập nhật.</span>
          <button
            onClick={() => {
              // updateSW(true): kích hoạt SW mới rồi tự nạp lại trang.
              // Nếu vì lý do nào đó chưa có hàm, quay về reload thường.
              if (updateSW) updateSW(true).catch(() => window.location.reload())
              else window.location.reload()
            }}
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
