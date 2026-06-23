import { useMemo, useState } from 'react'
import { CalendarClock, Package, AlertCircle, SlidersHorizontal, Check, X, Tag } from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import ProductPromotionModal from '../products/ProductPromotionModal'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import {
  useExpiringLots, useExpiryBuckets, useSaveExpiryBuckets,
  useExpiryDiscountTiers, useSaveExpiryDiscountTiers, suggestedDiscountForDays,
  EXPIRY_BUCKETS, bucketForDays, DEFAULT_EXPIRY_COLORS, DEFAULT_EXPIRY_DISCOUNT_TIERS,
  type ExpiryColors, type ExpiryDiscountTiers, type ExpiringLotItem,
} from '../../hooks/queries/useInventoryInsights'

export default function ExpiryPage() {
  const { formatCurrency } = useDisplaySettings()
  const { userRole, hasPermission } = useAuth()
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'
  const canManagePromos = isAdmin || hasPermission('promotions.manage')

  const [bucketKey, setBucketKey] = useState('m3')
  const bucket = EXPIRY_BUCKETS.find(b => b.key === bucketKey) ?? EXPIRY_BUCKETS[2]
  const lotsQuery = useExpiringLots(bucket.days)
  const colorsQuery = useExpiryBuckets()
  const tiersQuery = useExpiryDiscountTiers()
  const colors = colorsQuery.data ?? DEFAULT_EXPIRY_COLORS
  const tiers = tiersQuery.data ?? DEFAULT_EXPIRY_DISCOUNT_TIERS
  const lots = lotsQuery.data ?? []

  // Modal cấu hình (màu mốc + % giảm gợi ý)
  const [cfgModal, setCfgModal] = useState(false)
  const [draftColors, setDraftColors] = useState<ExpiryColors>(DEFAULT_EXPIRY_COLORS)
  const [draftTiers, setDraftTiers] = useState<ExpiryDiscountTiers>(DEFAULT_EXPIRY_DISCOUNT_TIERS)
  const saveColors = useSaveExpiryBuckets()
  const saveTiers = useSaveExpiryDiscountTiers()

  // Modal tạo KM từ 1 lô cận date
  const [promoLot, setPromoLot] = useState<ExpiringLotItem | null>(null)

  const totalValue = useMemo(() => lots.reduce((s, l) => s + l.value, 0), [lots])
  const fmtDate = (s: string) => s.split('-').reverse().join('/')
  const colorOf = (daysLeft: number) => colors[bucketForDays(daysLeft).key] || '#64748b'

  const openCfg = () => {
    setDraftColors({ ...DEFAULT_EXPIRY_COLORS, ...colors })
    setDraftTiers({ ...DEFAULT_EXPIRY_DISCOUNT_TIERS, ...tiers })
    setCfgModal(true)
  }
  const submitCfg = async () => {
    try {
      await Promise.all([saveColors.mutateAsync(draftColors), saveTiers.mutateAsync(draftTiers)])
      setCfgModal(false)
    } catch { alert('Không lưu được cấu hình (cần quyền quản trị).') }
  }
  const savingCfg = saveColors.isPending || saveTiers.isPending

  const columns: DataTableColumn<ExpiringLotItem>[] = [
    {
      key: 'product', header: 'Sản phẩm', flex: true, minWidth: 200,
      render: (l) => (
        <div className="min-w-0">
          <div className="font-bold text-gray-700 flex items-center gap-1.5 truncate">
            <Package size={13} className="text-gray-300 shrink-0" />{l.product_name}
          </div>
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider truncate">{l.sku}</div>
        </div>
      ),
    },
    { key: 'warehouse', header: 'Kho', width: 130, render: (l) => l.warehouse_name },
    { key: 'lot', header: 'Lô', width: 110, render: (l) => l.lot_number },
    {
      key: 'qty', header: 'SL tồn', width: 100, align: 'right',
      render: (l) => <span className="tabular-nums font-semibold text-gray-700">{l.qty.toLocaleString('vi-VN')} {l.unit}</span>,
    },
    { key: 'expiry', header: 'HSD', width: 100, align: 'left', render: (l) => <span className="tabular-nums text-gray-600">{fmtDate(l.expiry_date)}</span> },
    {
      key: 'daysLeft', header: 'Còn lại', width: 130, align: 'center', noTruncate: true,
      render: (l) => {
        const c = colorOf(l.daysLeft)
        return (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
            style={{ color: c, borderColor: c + '55', backgroundColor: c + '14' }}>
            {l.daysLeft < 0 ? `Hết hạn ${Math.abs(l.daysLeft)}n` : l.daysLeft === 0 ? 'Hết hạn hôm nay' : `Còn ${l.daysLeft} ngày`}
          </span>
        )
      },
    },
    {
      key: 'sell', header: 'Bán hết kịp?', width: 130, align: 'center', noTruncate: true,
      render: (l) => {
        if (l.daysToSell == null) return <span className="text-tiny text-gray-300">—</span>
        return l.sellRisk
          ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 whitespace-nowrap">Không kịp (~{l.daysToSell}n)</span>
          : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 whitespace-nowrap">Kịp (~{l.daysToSell}n)</span>
      },
    },
    { key: 'value', header: 'Giá trị tồn', width: 120, align: 'right', render: (l) => <span className="tabular-nums font-semibold text-rose-600">{formatCurrency(l.value)}</span> },
  ]

  if (canManagePromos) {
    columns.push({
      key: 'action', header: 'Xử lý', width: 120, align: 'center', noTruncate: true, hideOnMobile: false,
      render: (l) => {
        const pct = suggestedDiscountForDays(l.daysLeft, tiers)
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setPromoLot(l) }}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 transition-colors whitespace-nowrap"
            title="Tạo khuyến mãi đẩy hàng cận date cho sản phẩm này">
            <Tag size={11} />Tạo KM{pct > 0 ? ` −${pct}%` : ''}
          </button>
        )
      },
    })
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
            <p className="text-body-md text-gray-400 mt-1">Theo dõi lô cận date, ước khả năng bán hết và tạo khuyến mãi đẩy hàng kịp thời.</p>
          </div>
          {isAdmin && (
            <button onClick={openCfg}
              className="bg-white border border-gray-200 text-gray-600 px-3.5 h-10 rounded-lg font-semibold text-tiny hover:bg-gray-50 flex items-center gap-1.5 self-start">
              <SlidersHorizontal size={16} className="text-blue-500" /> Cấu hình
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

        {/* Bảng DataTable chuẩn */}
        <DataTable
          columns={columns}
          rows={lots}
          getRowKey={(l) => l.lot_id}
          loading={lotsQuery.isLoading}
          resetSignal={bucketKey}
          itemLabel="lô"
          emptyIcon={<AlertCircle className="mx-auto text-gray-300 mb-2" size={44} />}
          emptyText={`Không có lô nào trong mốc ${bucket.label}`}
        />
      </div>

      {/* Modal cấu hình màu + % giảm gợi ý */}
      {cfgModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-body-lg text-gray-800">Cấu hình mốc hạn dùng</h3>
              <button onClick={() => setCfgModal(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1">
                <span>Mốc</span><span>Màu</span><span>% giảm gợi ý</span>
              </div>
              {EXPIRY_BUCKETS.map(b => (
                <div key={b.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                  <span className="text-body-md font-semibold text-gray-700 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: draftColors[b.key] }} /> {b.label}
                  </span>
                  <input type="color" value={draftColors[b.key] || '#000000'}
                    onChange={e => setDraftColors(prev => ({ ...prev, [b.key]: e.target.value }))}
                    className="w-12 h-9 rounded border border-gray-200 cursor-pointer" />
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={100} value={draftTiers[b.key] ?? 0}
                      onChange={e => setDraftTiers(prev => ({ ...prev, [b.key]: Math.min(100, Math.max(0, Number(e.target.value))) }))}
                      className="w-16 h-9 px-2 text-right border border-gray-200 rounded text-tiny tabular-nums" />
                    <span className="text-gray-400 text-tiny">%</span>
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-gray-400 pt-1">% giảm gợi ý dùng khi tạo khuyến mãi đẩy hàng cận date. Nhân viên vẫn chỉnh được trước khi lưu KM.</p>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
              <button onClick={() => setCfgModal(false)} className="h-10 px-4 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={submitCfg} disabled={savingCfg}
                className="h-10 px-5 bg-blue-500 text-white rounded-lg text-tiny font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                <Check size={15} /> {savingCfg ? 'Đang lưu...' : 'Lưu cấu hình'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal tạo KM sản phẩm (tái dùng) — prefill % + hạn theo lô */}
      {promoLot && (
        <ProductPromotionModal
          productId={promoLot.product_id}
          productName={promoLot.product_name}
          defaults={{
            name: `Xả cận date — ${promoLot.product_name}`,
            promo_type: 'percent',
            discount_value: suggestedDiscountForDays(promoLot.daysLeft, tiers),
            valid_to: promoLot.expiry_date,
          }}
          onClose={() => setPromoLot(null)}
          onSaved={() => setPromoLot(null)}
        />
      )}
    </Layout>
  )
}
