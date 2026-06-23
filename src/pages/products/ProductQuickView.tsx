import { useState } from 'react'
import {
  Info,
  Layers,
  Warehouse,
  Tag,
  X,
  ExternalLink,
  Package,
  Pencil,
} from 'lucide-react'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import {
  useProductLots,
  useProductMovements,
  useProductPromotionsList,
  type ProductStockRow,
} from '../../hooks/queries/useProducts'
import { promoShortLabel, type ProductPromotion } from '../../hooks/useProductPromotions'

type QuickTab = 'info' | 'lots' | 'ledger' | 'promotions'

interface ProductQuickViewProps {
  row: ProductStockRow
  branchId?: string | null
  onClose: () => void
  onOpenDetail: () => void
  /** Mở modal sửa nhanh — chỉ truyền khi user có quyền products.manage (khớp RLS). */
  onEdit?: () => void
}

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: 'Nhập hàng NCC',
  sale: 'Xuất bán POS',
  return_from_customer: 'Nhập trả hàng',
  return_to_supplier: 'Xuất trả NCC',
  transfer_out: 'Xuất chuyển kho',
  transfer_in: 'Nhập chuyển kho',
  adjustment_increase: 'Điều chỉnh (+)',
  adjustment_decrease: 'Điều chỉnh (-)',
  expiry_writeoff: 'Hủy hết hạn',
  damage_writeoff: 'Hủy hỏng hóc',
}

function Spinner() {
  return (
    <div className="py-10 flex justify-center">
      <div className="w-7 h-7 border-2 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
}

export default function ProductQuickView({ row, branchId, onClose, onOpenDetail, onEdit }: ProductQuickViewProps) {
  const { formatCurrency } = useDisplaySettings()
  const [tab, setTab] = useState<QuickTab>('info')

  const lotsQuery = useProductLots(row.id, branchId, tab === 'lots')
  const movementsQuery = useProductMovements(row.id, branchId, tab === 'ledger')
  const promosQuery = useProductPromotionsList(row.id, tab === 'promotions')

  const promos = (promosQuery.data ?? []) as ProductPromotion[]
  const activePromoCount = promos.filter(p => p.is_active).length

  const TabButton = ({ id, icon, label, badge }: { id: QuickTab; icon: React.ReactNode; label: string; badge?: number }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3.5 py-2.5 text-tiny font-semibold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
        tab === id
          ? 'border-blue-500 text-blue-600'
          : 'border-transparent text-gray-400 hover:text-gray-600'
      }`}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-0.5 px-1.5 py-0.5 bg-rose-100 text-rose-600 text-[10px] font-bold rounded-full">{badge}</span>
      )}
    </button>
  )

  return (
    <div className="bg-gray-25 border border-gray-150 rounded-lg overflow-hidden animate-in fade-in duration-150 my-1">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-bold text-gray-800 truncate">{row.name}</span>
          <span className="px-2 py-0.5 bg-gray-50 border border-gray-100 text-gray-500 text-[10px] font-bold rounded uppercase shrink-0">
            {row.sku || '—'}
          </span>
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold shrink-0 ${
            row.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'
          }`}>
            {row.is_active ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onEdit && (
            <button
              onClick={onEdit}
              className="h-8 px-3 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded text-tiny font-semibold text-blue-700 flex items-center gap-1.5 transition-all"
            >
              <Pencil size={13} />
              Sửa chi tiết
            </button>
          )}
          <button
            onClick={onOpenDetail}
            className="h-8 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-gray-700 flex items-center gap-1.5 transition-all"
          >
            <ExternalLink size={13} className="text-blue-500" />
            Mở trang chi tiết
          </button>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-all" title="Đóng">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 bg-white px-2 overflow-x-auto tbl-x">
        <TabButton id="info" icon={<Info size={14} />} label="Thông tin" />
        <TabButton id="lots" icon={<Layers size={14} />} label="Phiên bản & Lô hàng" />
        <TabButton id="ledger" icon={<Warehouse size={14} />} label="Thẻ kho" />
        <TabButton id="promotions" icon={<Tag size={14} />} label="Khuyến mãi" badge={activePromoCount} />
      </div>

      {/* Content */}
      <div className="p-4">
        {/* ── Thông tin ── */}
        {tab === 'info' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Giá bán lẻ', value: formatCurrency(row.retail_price), accent: 'text-blue-600' },
              { label: 'Giá vốn', value: formatCurrency(row.retail_cost), accent: 'text-gray-700' },
              { label: 'Tồn kho', value: `${row.stock_on_hand.toLocaleString('vi-VN')} ${row.unit || ''}`, accent: 'text-gray-700' },
              { label: 'Khách đặt', value: row.on_order_qty.toLocaleString('vi-VN'), accent: 'text-gray-700' },
            ].map(item => (
              <div key={item.label} className="bg-white border border-gray-100 rounded-lg p-3">
                <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{item.label}</span>
                <span className={`font-bold tabular-nums ${item.accent}`}>{item.value}</span>
              </div>
            ))}
            <div className="col-span-2 md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Nhóm sản phẩm', value: row.category_name || '—' },
                { label: 'Thương hiệu', value: row.brand_name || '—' },
                { label: 'Đơn vị tính', value: row.unit || '—' },
                { label: 'Quy cách', value: row.package_specs || '—' },
              ].map(item => (
                <div key={item.label}>
                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{item.label}</span>
                  <span className="text-tiny font-semibold text-gray-700">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Phiên bản & Lô hàng ── */}
        {tab === 'lots' && (
          lotsQuery.isLoading ? <Spinner /> : (
            (lotsQuery.data ?? []).length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-tiny flex flex-col items-center gap-2">
                <Warehouse size={28} className="text-gray-300" />
                Chưa có lô hàng nào lưu kho cho sản phẩm này.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {(lotsQuery.data ?? []).map(lot => {
                  const isExpired = lot.expiry_date && new Date(lot.expiry_date) < new Date()
                  const available = lot.quantity_on_hand - lot.quantity_reserved
                  return (
                    <div key={lot.id} className={`bg-white border rounded-lg p-3 ${isExpired ? 'border-red-100' : 'border-gray-100'}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-gray-700 text-tiny">{lot.lot_number}</span>
                        <div className="flex items-center gap-1">
                          {isExpired && <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[9px] font-bold">Hết hạn</span>}
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            lot.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}>
                            {lot.status === 'active' ? 'Đang bán' : 'Khóa'}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                        <div>
                          <span className="text-gray-400 block">Kho</span>
                          <span className="font-semibold text-gray-600 truncate block">{lot.warehouses?.name || '—'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block">Hạn dùng</span>
                          <span className={`font-semibold ${isExpired ? 'text-red-500' : 'text-gray-600'}`}>
                            {lot.expiry_date ? new Date(lot.expiry_date).toLocaleDateString('vi-VN') : 'Không hạn'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400 block">Giá vốn</span>
                          <span className="font-semibold text-gray-600 tabular-nums">{formatCurrency(lot.cost_price)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-gray-400 block">Khả dụng / Tồn</span>
                          <span className="font-bold text-gray-700 tabular-nums">{available} / {lot.quantity_on_hand}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )
        )}

        {/* ── Thẻ kho ── */}
        {tab === 'ledger' && (
          movementsQuery.isLoading ? <Spinner /> : (
            (movementsQuery.data ?? []).length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-tiny">Chưa có biến động xuất nhập kho nào.</div>
            ) : (
              <div className="space-y-2">
                <div className="overflow-x-auto tbl-x border border-gray-100 rounded-lg bg-white">
                  <table className="w-full text-left text-[12px] border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold text-[10px] uppercase tracking-wider">
                        <th className="p-2.5">Thời gian</th>
                        <th className="p-2.5">Loại GD</th>
                        <th className="p-2.5">Đối tượng</th>
                        <th className="p-2.5">Kho</th>
                        <th className="p-2.5">Số lô</th>
                        <th className="p-2.5 text-right">Biến động</th>
                        <th className="p-2.5 text-right">Giá GD</th>
                        <th className="p-2.5">Thực hiện</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-600">
                      {(movementsQuery.data ?? []).map(m => {
                        const isPositive = m.quantity > 0
                        // Đơn bán & phiếu nhập NCC có trang chi tiết riêng → link mở tab mới
                        const refHref = m.ref_id
                          ? (m.ref_type === 'order' || m.ref_type === 'order_reverse' ? `/orders/${m.ref_id}`
                            : m.ref_type === 'goods_receipt' ? `/goods-receipts/${m.ref_id}`
                            : null)
                          : null
                        return (
                          <tr key={m.id} className="hover:bg-gray-50/50">
                            <td className="p-2.5 whitespace-nowrap tabular-nums text-[11px] text-gray-500">
                              {new Date(m.created_at).toLocaleString('vi-VN')}
                            </td>
                            <td className="p-2.5 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${
                                isPositive ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'
                              }`}>
                                {MOVEMENT_LABELS[m.movement_type] || 'Biến động khác'}
                              </span>
                            </td>
                            <td className="p-2.5 max-w-[200px]">
                              {m.partner_name || m.ref_code ? (
                                <div className="min-w-0">
                                  <span className="font-semibold text-gray-700 truncate block" title={m.partner_name || ''}>
                                    {m.partner_name || '—'}
                                  </span>
                                  {m.ref_code && (
                                    refHref ? (
                                      <a
                                        href={refHref}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="font-mono text-[10px] text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-0.5"
                                        title="Mở chứng từ trong tab mới"
                                      >
                                        {m.ref_code} <ExternalLink size={9} />
                                      </a>
                                    ) : (
                                      <span className="font-mono text-[10px] text-gray-400">{m.ref_code}</span>
                                    )
                                  )}
                                </div>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="p-2.5 font-semibold text-gray-700">{m.warehouse_name || '—'}</td>
                            <td className="p-2.5 font-mono text-[11px] text-gray-500">{m.lot_number || '—'}</td>
                            <td className={`p-2.5 text-right font-bold tabular-nums ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                              {isPositive ? '+' : ''}{m.quantity} {row.unit}
                            </td>
                            <td className="p-2.5 text-right whitespace-nowrap">
                              <span className="tabular-nums text-gray-700 font-semibold">{m.txn_price !== null ? formatCurrency(m.txn_price) : '—'}</span>
                              {m.price_list_name && (
                                <span className="block text-[9px] font-bold text-blue-500">{m.price_list_name}</span>
                              )}
                            </td>
                            <td className="p-2.5 text-[11px] text-gray-500">{m.performer_name || 'Hệ thống'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-400 italic">Chỉ hiển thị 50 giao dịch gần nhất — xem đầy đủ ở trang chi tiết.</p>
              </div>
            )
          )
        )}

        {/* ── Khuyến mãi ── */}
        {tab === 'promotions' && (
          promosQuery.isLoading ? <Spinner /> : (
            promos.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-tiny flex flex-col items-center gap-2">
                <Tag size={28} className="text-gray-300" />
                Chưa có khuyến mãi nào cho sản phẩm này.
              </div>
            ) : (
              <div className="space-y-2">
                {promos.map(p => (
                  <div key={p.id} className={`bg-white border border-gray-100 rounded-lg p-2.5 flex items-center gap-3 ${!p.is_active ? 'opacity-60' : ''}`}>
                    <Package size={16} className="text-rose-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 text-tiny truncate">{p.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-rose-50 text-rose-600">{promoShortLabel(p)}</span>
                        {!p.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Tắt</span>}
                      </div>
                      {p.promo_type === 'buy_x_get_y' && (
                        <p className="text-[10px] text-emerald-700 mt-0.5">
                          🎁 Tặng {p.get_qty} {p.get_product_id && p.get_product_id !== p.product_id ? 'SP khác' : 'chính SP này'}
                          {' · '}{p.get_price > 0 ? `giá ưu đãi ${p.get_price.toLocaleString('vi-VN')}₫` : 'miễn phí'}
                        </p>
                      )}
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {p.branch_ids.length === 0 ? 'Toàn hệ thống' : `${p.branch_ids.length} chi nhánh`}
                        {p.valid_to && ` · Đến ${new Date(p.valid_to).toLocaleDateString('vi-VN')}`}
                      </p>
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-gray-400 italic">Thêm/sửa khuyến mãi tại trang chi tiết sản phẩm.</p>
              </div>
            )
          )
        )}
      </div>
    </div>
  )
}
