import { useMemo, useState } from 'react'
import { CalendarClock, Package, AlertCircle, Palette, Check, X } from 'lucide-react'
import Layout from '../../components/Layout'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import {
  useExpiringLots, useExpiryBuckets, useSaveExpiryBuckets,
  EXPIRY_BUCKETS, bucketForDays, DEFAULT_EXPIRY_COLORS, type ExpiryColors,
} from '../../hooks/queries/useInventoryInsights'

export default function ExpiryPage() {
  const { formatCurrency } = useDisplaySettings()
  const { userRole } = useAuth()
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'

  const [bucketKey, setBucketKey] = useState('m3')
  const bucket = EXPIRY_BUCKETS.find(b => b.key === bucketKey) ?? EXPIRY_BUCKETS[2]
  const lotsQuery = useExpiringLots(bucket.days)
  const colorsQuery = useExpiryBuckets()
  const colors = colorsQuery.data ?? DEFAULT_EXPIRY_COLORS
  const lots = lotsQuery.data ?? []

  const [colorModal, setColorModal] = useState(false)
  const [draftColors, setDraftColors] = useState<ExpiryColors>(DEFAULT_EXPIRY_COLORS)
  const saveColors = useSaveExpiryBuckets()

  const totalValue = useMemo(() => lots.reduce((s, l) => s + l.value, 0), [lots])
  const fmtDate = (s: string) => s.split('-').reverse().join('/')
  const colorOf = (daysLeft: number) => colors[bucketForDays(daysLeft).key] || '#64748b'

  const openColorModal = () => { setDraftColors({ ...DEFAULT_EXPIRY_COLORS, ...colors }); setColorModal(true) }
  const submitColors = async () => {
    try { await saveColors.mutateAsync(draftColors); setColorModal(false) }
    catch { alert('Không lưu được cấu hình màu (cần quyền quản trị).') }
  }

  return (
    <Layout activeMenu="Hạn sử dụng">
      <div className="p-4 md:p-8 max-w-[1400px] w-full mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2">
              <CalendarClock size={22} className="text-blue-500" /> Hàng sắp hết hạn dùng
            </h1>
            <p className="text-body-md text-gray-400 mt-1">Theo dõi lô hàng cận date theo mốc thời gian để xử lý kịp thời.</p>
          </div>
          {isAdmin && (
            <button onClick={openColorModal}
              className="bg-white border border-gray-200 text-gray-600 px-3.5 h-10 rounded-lg font-semibold text-tiny hover:bg-gray-50 flex items-center gap-1.5 self-start">
              <Palette size={16} className="text-blue-500" /> Cấu hình màu
            </button>
          )}
        </div>

        {/* Bucket tabs + legend */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {EXPIRY_BUCKETS.map(b => (
              <button key={b.key} onClick={() => setBucketKey(b.key)}
                className={`px-3 py-1.5 rounded-lg text-tiny font-bold border transition-all flex items-center gap-1.5 ${bucketKey === b.key ? 'text-white border-transparent shadow-sm' : 'bg-gray-25 text-gray-500 border-gray-150 hover:bg-gray-50'}`}
                style={bucketKey === b.key ? { backgroundColor: colors[b.key] } : undefined}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[b.key] }} />
                {b.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 text-tiny">
            <span className="text-gray-400">Số lô: <strong className="text-gray-700">{lots.length}</strong></span>
            <span className="text-gray-400">Giá trị tồn: <strong className="text-rose-600 tabular-nums">{formatCurrency(totalValue)}</strong></span>
          </div>
        </div>

        {/* Table */}
        {lotsQuery.isLoading ? (
          <div className="py-24 text-center text-gray-400">Đang tải...</div>
        ) : lots.length === 0 ? (
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-16 text-center text-gray-400 shadow-sm">
            <AlertCircle className="mx-auto text-gray-300 mb-4" size={48} />
            <h3 className="font-semibold text-gray-600 text-body-lg">Không có lô nào trong mốc {bucket.label}</h3>
          </div>
        ) : (
          <div className="bg-gray-0 border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase text-[10px] font-bold tracking-wider whitespace-nowrap">
                    <th className="py-2.5 px-4">Sản phẩm</th>
                    <th className="py-2.5 px-3">Kho</th>
                    <th className="py-2.5 px-3">Lô</th>
                    <th className="py-2.5 px-3 text-right">SL tồn</th>
                    <th className="py-2.5 px-3">HSD</th>
                    <th className="py-2.5 px-3 text-center">Còn lại</th>
                    <th className="py-2.5 px-3 text-right">Giá trị tồn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lots.map(l => {
                    const c = colorOf(l.daysLeft)
                    return (
                      <tr key={l.lot_id} className="hover:bg-gray-25 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-700 flex items-center gap-1.5"><Package size={13} className="text-gray-300" />{l.product_name}</div>
                          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{l.sku}</div>
                        </td>
                        <td className="py-3 px-3 text-gray-600 max-w-[140px] truncate">{l.warehouse_name}</td>
                        <td className="py-3 px-3 text-gray-600">{l.lot_number}</td>
                        <td className="py-3 px-3 text-right tabular-nums font-semibold text-gray-700">{l.qty.toLocaleString('vi-VN')} {l.unit}</td>
                        <td className="py-3 px-3 text-gray-600 tabular-nums">{fmtDate(l.expiry_date)}</td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border" style={{ color: c, borderColor: c + '55', backgroundColor: c + '14' }}>
                            {l.daysLeft < 0 ? `Hết hạn ${Math.abs(l.daysLeft)}n` : l.daysLeft === 0 ? 'Hết hạn hôm nay' : `Còn ${l.daysLeft} ngày`}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-semibold text-rose-600">{formatCurrency(l.value)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Color config modal */}
      {colorModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-body-lg text-gray-800">Cấu hình màu mốc hạn dùng</h3>
              <button onClick={() => setColorModal(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              {EXPIRY_BUCKETS.map(b => (
                <div key={b.key} className="flex items-center justify-between gap-3">
                  <span className="text-body-md font-semibold text-gray-700 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: draftColors[b.key] }} /> {b.label}
                  </span>
                  <input type="color" value={draftColors[b.key] || '#000000'}
                    onChange={e => setDraftColors(prev => ({ ...prev, [b.key]: e.target.value }))}
                    className="w-12 h-9 rounded border border-gray-200 cursor-pointer" />
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setColorModal(false)} className="h-10 px-4 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={submitColors} disabled={saveColors.isPending}
                className="h-10 px-5 bg-blue-500 text-white rounded-lg text-tiny font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                <Check size={15} /> {saveColors.isPending ? 'Đang lưu...' : 'Lưu cấu hình'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
