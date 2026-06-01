import { useMemo, useState } from 'react'
import { TrendingUp, Package, AlertCircle, ShoppingCart } from 'lucide-react'
import Layout from '../../components/Layout'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { removeVietnameseTones } from '../../components/SmartSearchSelect'
import { useReorderSuggestions } from '../../hooks/queries/useInventoryInsights'

export default function ReorderPage() {
  const [coverDays, setCoverDays] = useState(30)
  const [minOrders, setMinOrders] = useState(3)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)

  const query = useReorderSuggestions({ coverDays, minOrders })
  const all = query.data ?? []

  const rows = useMemo(() => {
    const q = removeVietnameseTones(debounced.trim().toLowerCase())
    if (!q) return all
    return all.filter(r => removeVietnameseTones(`${r.name} ${r.sku}`.toLowerCase()).includes(q))
  }, [all, debounced])

  const coverColor = (d: number | null) => {
    if (d == null) return 'text-gray-500'
    if (d <= 7) return 'text-danger-600'
    if (d <= 14) return 'text-amber-600'
    return 'text-gray-700'
  }

  return (
    <Layout activeMenu="Gợi ý đặt hàng">
      <div className="p-4 md:p-8 max-w-[1400px] w-full mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2">
            <TrendingUp size={22} className="text-blue-500" /> Gợi ý đặt hàng
          </h1>
          <p className="text-body-md text-gray-400 mt-1">Hàng bán thường xuyên sắp hết — gợi ý số lượng đặt theo tần suất bán thực tế.</p>
        </div>

        {/* Controls */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-end gap-3">
          <div className="relative flex-1">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm sản phẩm / mã SKU..."
              className="w-full h-9 px-3 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Đủ bán trong (ngày)</label>
            <input type="number" min={7} value={coverDays} onChange={e => setCoverDays(Math.max(1, Number(e.target.value)))}
              className="h-9 w-32 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Bán thường xuyên (≥ đơn/90n)</label>
            <input type="number" min={1} value={minOrders} onChange={e => setMinOrders(Math.max(1, Number(e.target.value)))}
              className="h-9 w-32 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
          </div>
          <span className="text-tiny text-gray-400 md:ml-auto">{rows.length} mặt hàng</span>
        </div>

        {/* Table */}
        {query.isLoading ? (
          <div className="py-24 text-center text-gray-400">Đang tải...</div>
        ) : rows.length === 0 ? (
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-16 text-center text-gray-400 shadow-sm">
            <AlertCircle className="mx-auto text-gray-300 mb-4" size={48} />
            <h3 className="font-semibold text-gray-600 text-body-lg">Không có mặt hàng nào cần đặt thêm</h3>
            <p className="text-body-md mt-1">Tất cả hàng bán thường xuyên còn đủ tồn cho {coverDays} ngày tới.</p>
          </div>
        ) : (
          <div className="bg-gray-0 border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase text-[10px] font-bold tracking-wider whitespace-nowrap">
                    <th className="py-2.5 px-4">Sản phẩm</th>
                    <th className="py-2.5 px-3 text-right">Tồn</th>
                    <th className="py-2.5 px-3 text-right">Bán 30n</th>
                    <th className="py-2.5 px-3 text-right">Bán 90n</th>
                    <th className="py-2.5 px-3 text-right">TB/tuần</th>
                    <th className="py-2.5 px-3 text-right">Đủ bán còn</th>
                    <th className="py-2.5 px-3 text-right">Gợi ý đặt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(r => (
                    <tr key={r.product_id} className="hover:bg-gray-25 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-gray-700 flex items-center gap-1.5"><Package size={13} className="text-gray-300" />{r.name}</div>
                        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{r.sku}</div>
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums font-semibold text-gray-700">{r.stock_on_hand.toLocaleString('vi-VN')} {r.unit}</td>
                      <td className="py-3 px-3 text-right tabular-nums text-gray-600">{r.sold_30d.toLocaleString('vi-VN')}</td>
                      <td className="py-3 px-3 text-right tabular-nums text-gray-600">{r.sold_90d.toLocaleString('vi-VN')}</td>
                      <td className="py-3 px-3 text-right tabular-nums text-gray-600">{r.avg_weekly.toLocaleString('vi-VN')}</td>
                      <td className={`py-3 px-3 text-right tabular-nums font-bold ${coverColor(r.days_cover)}`}>{r.days_cover != null ? `${r.days_cover} ngày` : '—'}</td>
                      <td className="py-3 px-3 text-right">
                        <span className="inline-flex items-center gap-1 text-tiny font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 tabular-nums">
                          <ShoppingCart size={11} />{r.suggestedQty.toLocaleString('vi-VN')} {r.unit}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
