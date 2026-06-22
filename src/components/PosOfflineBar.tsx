import { CloudOff, RefreshCw, AlertTriangle, Clock } from 'lucide-react'
import type { PosQueueItem } from '../lib/offlineDb'

// Thanh trạng thái offline cho POS: hiện khi mất mạng, có đơn chờ đồng bộ,
// đơn lỗi cần xử lý, hoặc dữ liệu snapshot đã cũ. Ẩn hoàn toàn khi mọi thứ ổn.
interface Props {
  online: boolean
  pending: PosQueueItem[]
  failed: PosQueueItem[]
  syncing: boolean
  snapshotStale?: boolean
  snapshotAt?: number | null
  onSyncNow: () => void
  onDiscardFailed: (id: string) => void
}

export default function PosOfflineBar({
  online, pending, failed, syncing, snapshotStale, snapshotAt, onSyncNow, onDiscardFailed,
}: Props) {
  const nothingToShow = online && pending.length === 0 && failed.length === 0 && !snapshotStale
  if (nothingToShow) return null

  const fmtTime = (t?: number | null) =>
    t ? new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''

  return (
    <div className="flex flex-col gap-1 px-3 py-2 text-[13px]">
      {!online && (
        <div className="flex items-center gap-2 rounded-md bg-amber-100 text-amber-900 px-3 py-1.5">
          <CloudOff size={16} className="shrink-0" />
          <span className="font-semibold">Đang offline</span>
          <span className="text-amber-800">— đơn bán nhanh sẽ được lưu lại và tự đồng bộ khi có mạng.</span>
          {snapshotAt ? <span className="ml-auto inline-flex items-center gap-1 text-amber-700"><Clock size={13} />Dữ liệu lúc {fmtTime(snapshotAt)}</span> : null}
        </div>
      )}

      {online && snapshotStale && (
        <div className="flex items-center gap-2 rounded-md bg-orange-100 text-orange-900 px-3 py-1.5">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Dữ liệu offline đã quá 72 giờ ({fmtTime(snapshotAt)}) — giá/tồn có thể cũ, nên kết nối mạng để làm mới.</span>
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-blue-100 text-blue-900 px-3 py-1.5">
          <RefreshCw size={16} className={`shrink-0 ${syncing ? 'animate-spin' : ''}`} />
          <span><b>{pending.length}</b> đơn chờ đồng bộ.</span>
          {online && (
            <button
              onClick={onSyncNow}
              disabled={syncing}
              className="ml-auto rounded bg-blue-600 px-2.5 py-1 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
            </button>
          )}
        </div>
      )}

      {failed.length > 0 && (
        <div className="rounded-md bg-red-100 text-red-900 px-3 py-1.5">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{failed.length} đơn KHÔNG đồng bộ được — cần xử lý:</span>
          </div>
          <ul className="mt-1 space-y-1">
            {failed.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <span className="truncate">{f.label} — <i>{f.error}</i></span>
                <button
                  onClick={() => onDiscardFailed(f.id)}
                  className="ml-auto rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-200"
                  title="Bỏ đơn lỗi khỏi hàng đợi (đã xử lý thủ công)"
                >
                  Bỏ
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
