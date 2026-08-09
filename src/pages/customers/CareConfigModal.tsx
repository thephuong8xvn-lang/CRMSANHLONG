import { useEffect, useState } from 'react'
import { X, Check, Send, Eye, AlertCircle, Settings2, Loader2 } from 'lucide-react'
import {
  useCareConfig, useSaveCareConfig, useCareDigestPreview, useSendCareDigestNow,
  type CareConfig,
} from '../../hooks/queries/useCustomerCare'

/**
 * Cấu hình nhắc việc "Chăm sóc KH" — nhóm Telegram + giờ gửi + ngưỡng phân loại.
 *
 * Vì sao có màn này: ID nhóm Telegram trước đây chỉ nằm trong DB, đổi nhóm là
 * phải chạy SQL. Giờ dán ID mới + bấm "Gửi thử" là biết ngay bot đã vào nhóm
 * chưa. Đổi giờ gửi cũng đổi luôn lịch cron ở máy chủ, không cần deploy lại.
 *
 * Toàn bộ đi qua RPC `fn_care_config_get/set` (guard `fn_is_sysadmin`) chứ
 * KHÔNG ghi thẳng bảng `telegram_channels` — bảng đó chứa chat_id của mọi kênh.
 */
export default function CareConfigModal({ onClose }: { onClose: () => void }) {
  const cfgQuery = useCareConfig(true)
  const save = useSaveCareConfig()
  const sendNow = useSendCareDigestNow()

  const [form, setForm] = useState<CareConfig | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const preview = useCareDigestPreview('sang', showPreview)

  useEffect(() => { if (cfgQuery.data && !form) setForm(cfgQuery.data) }, [cfgQuery.data, form])

  const set = <K extends keyof CareConfig>(k: K, v: CareConfig[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f))

  const handleSave = async () => {
    if (!form) return
    setErr(''); setOk('')
    try {
      const res = await save.mutateAsync(form)
      setForm(res)
      setOk(res.cron_result && res.cron_result !== 'ok'
        ? `Đã lưu, nhưng ${res.cron_result}`
        : 'Đã lưu cấu hình và cập nhật lịch gửi.')
    } catch (e) {
      setErr((e as Error).message || 'Không lưu được cấu hình.')
    }
  }

  const handleSend = async () => {
    setErr(''); setOk('')
    try {
      const res = await sendNow.mutateAsync('sang')
      setOk(res.message)
    } catch (e) {
      setErr((e as Error).message || 'Không gửi thử được.')
    }
  }

  const inputCls = 'h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none'
  const labelCls = 'text-[11px] font-bold text-gray-400 uppercase block mb-1'

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-body-lg text-gray-800 flex items-center gap-2">
            <Settings2 size={18} className="text-blue-500" /> Cấu hình nhắc việc
          </h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {cfgQuery.isLoading && (
            <p className="text-tiny text-gray-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Đang tải cấu hình...
            </p>
          )}
          {cfgQuery.isError && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-tiny text-rose-700 flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{(cfgQuery.error as Error).message}</span>
            </div>
          )}

          {form && (
            <>
              <div>
                <label className={labelCls}>ID nhóm Telegram</label>
                <input value={form.chat_id} onChange={e => set('chat_id', e.target.value)}
                  placeholder="-5560046303" className={`${inputCls} w-full font-mono`} />
                <p className="text-[11px] text-gray-400 mt-1">
                  Nhóm nhận danh sách khách cần gọi. Bot phải là thành viên nhóm thì mới gửi được.
                </p>
              </div>

              <label className="flex items-center gap-2 text-tiny font-semibold text-gray-600">
                <input type="checkbox" checked={form.enabled}
                  onChange={e => set('enabled', e.target.checked)} className="w-4 h-4" />
                Bật nhắc việc qua Telegram
              </label>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Giờ gửi sáng</label>
                  <input type="time" value={form.am_time} onChange={e => set('am_time', e.target.value)}
                    className={`${inputCls} w-full`} />
                </div>
                <div>
                  <label className={labelCls}>Giờ gửi chiều</label>
                  <input type="time" value={form.pm_time} onChange={e => set('pm_time', e.target.value)}
                    className={`${inputCls} w-full`} />
                </div>
                <div>
                  <label className={labelCls}>Số khách/tin</label>
                  <input type="number" min={3} max={30} value={form.limit}
                    onChange={e => set('limit', Number(e.target.value))} className={`${inputCls} w-full`} />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-tiny font-bold text-gray-600 mb-2">Ngưỡng phân loại</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Nguy cơ từ</label>
                    <input type="number" min={3} max={180} value={form.at_risk_min_days}
                      onChange={e => set('at_risk_min_days', Number(e.target.value))} className={`${inputCls} w-full`} />
                  </div>
                  <div>
                    <label className={labelCls}>Rời bỏ từ</label>
                    <input type="number" min={7} max={365} value={form.churned_min_days}
                      onChange={e => set('churned_min_days', Number(e.target.value))} className={`${inputCls} w-full`} />
                  </div>
                  <div>
                    <label className={labelCls}>Sàn nhịp mua</label>
                    <input type="number" min={1} max={90} value={form.min_interval_days}
                      onChange={e => set('min_interval_days', Number(e.target.value))} className={`${inputCls} w-full`} />
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Số ngày im lặng tối thiểu để bị xếp loại. "Sàn nhịp mua" chặn trường hợp khách
                  có 2 đơn cách nhau 1 ngày bị coi là "nhịp mua 1 ngày" rồi thành rời bỏ oan.
                </p>
              </div>

              {err && <p className="text-rose-600 text-tiny">{err}</p>}
              {ok && <p className="text-emerald-600 text-tiny">{ok}</p>}

              <div className="border-t border-gray-100 pt-3">
                <button onClick={() => setShowPreview(v => !v)}
                  className="text-tiny font-semibold text-blue-600 hover:underline flex items-center gap-1.5">
                  <Eye size={14} /> {showPreview ? 'Ẩn' : 'Xem thử'} nội dung tin
                </button>
                {showPreview && (
                  <pre className="mt-2 bg-gray-25 border border-gray-150 rounded-lg p-3 text-[11px] text-gray-600 whitespace-pre-wrap max-h-56 overflow-y-auto">
                    {preview.isLoading ? 'Đang dựng tin...'
                      : preview.isError ? (preview.error as Error).message
                      : (preview.data || '').replace(/<[^>]+>/g, '')}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex flex-wrap justify-end gap-2">
          <button onClick={handleSend} disabled={sendNow.isPending || !form}
            className="h-10 px-4 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5">
            <Send size={15} /> {sendNow.isPending ? 'Đang gửi...' : 'Gửi thử vào nhóm'}
          </button>
          <button onClick={onClose} className="h-10 px-4 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50">Đóng</button>
          <button onClick={handleSave} disabled={save.isPending || !form}
            className="h-10 px-5 bg-blue-500 text-white rounded-lg text-tiny font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
            <Check size={15} /> {save.isPending ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
        </div>
      </div>
    </div>
  )
}
