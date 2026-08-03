import { useState, useEffect, useMemo } from 'react'
import { X, Target, Layers, Search, CheckSquare, Square, Loader2 } from 'lucide-react'
import SmartSearchSelect, { removeVietnameseTones } from '../../components/SmartSearchSelect'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useProductBrands, useProductCategories } from '../../hooks/queries/useProducts'
import { useAssignStrategyBulk, StrategyClass } from '../../hooks/queries/useStrategicProducts'

// ─────────────────────────────────────────────────────────────
// Modal gán SP vào nhóm chiến lược / hàng nền (admin-only — RLS enforce).
// Gán HÀNG LOẠT: lọc theo thương hiệu/nhóm hàng + tìm kiếm, tick nhiều SP.
// Trước đây mỗi lần chỉ gán được 1 SP → sau 2 tháng mới phân loại được
// 25/1.082 SP, khiến cả báo cáo không dùng được.
// ─────────────────────────────────────────────────────────────

interface AssignStrategyModalProps {
  open: boolean
  onClose: () => void
  defaultClass?: StrategyClass
}

interface NamedRow {
  id: string
  name: string
  is_active: boolean
}

interface ProductRow {
  id: string
  sku: string
  name: string
  brand_id: string | null
  category_id: string | null
  search: string
}

export default function AssignStrategyModal({ open, onClose, defaultClass = 'strategic' }: AssignStrategyModalProps) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(true)
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [cls, setCls] = useState<StrategyClass>(defaultClass)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const bulkMutation = useAssignStrategyBulk()
  const brandsQ = useProductBrands()
  const categoriesQ = useProductCategories()

  useEffect(() => {
    if (!open) return
    setCls(defaultClass)
    setSelected(new Set())
    setSearch('')
    setBrandFilter('')
    setCategoryFilter('')
    setOnlyUnassigned(true)
    setNote('')
    setError('')
    setLoadingProducts(true)

    Promise.all([
      fetchAllRows<{ id: string; sku: string; name: string; brand_id: string | null; category_id: string | null }>((f, t) =>
        supabase.from('products').select('id, sku, name, brand_id, category_id')
          .eq('is_active', true)
          .order('name', { ascending: true }).order('id')
          .range(f, t)
      ),
      supabase.from('product_strategy').select('product_id'),
    ]).then(([list, assigned]) => {
      setProducts(list.map(p => ({
        id: p.id,
        sku: p.sku ?? '',
        name: p.name ?? '',
        brand_id: p.brand_id,
        category_id: p.category_id,
        search: removeVietnameseTones(`${p.name ?? ''} ${p.sku ?? ''}`).toLowerCase(),
      })))
      setAssignedIds(new Set(((assigned.data ?? []) as { product_id: string }[]).map(r => r.product_id)))
    }).catch(() => {
      setError('Không tải được danh sách sản phẩm — thử đóng và mở lại.')
    }).finally(() => setLoadingProducts(false))
  }, [open, defaultClass])

  const brandOptions = useMemo(() => [
    { value: '', label: 'Tất cả thương hiệu' },
    ...((brandsQ.data ?? []) as NamedRow[])
      .filter(b => b.is_active).map(b => ({ value: b.id, label: b.name })),
  ], [brandsQ.data])

  const categoryOptions = useMemo(() => [
    { value: '', label: 'Tất cả nhóm hàng' },
    ...((categoriesQ.data ?? []) as NamedRow[])
      .filter(c => c.is_active).map(c => ({ value: c.id, label: c.name })),
  ], [categoriesQ.data])

  // Lọc client-side: danh sách SP đã nạp sẵn toàn bộ nên không cần round-trip.
  const filtered = useMemo(() => {
    const q = removeVietnameseTones(search.trim()).toLowerCase()
    return products.filter(p => {
      if (onlyUnassigned && assignedIds.has(p.id)) return false
      if (brandFilter && p.brand_id !== brandFilter) return false
      if (categoryFilter && p.category_id !== categoryFilter) return false
      if (q && !p.search.includes(q)) return false
      return true
    })
  }, [products, search, brandFilter, categoryFilter, onlyUnassigned, assignedIds])

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id))

  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const toggleAllFiltered = () => setSelected(s => {
    const next = new Set(s)
    if (allFilteredSelected) filtered.forEach(p => next.delete(p.id))
    else filtered.forEach(p => next.add(p.id))
    return next
  })

  if (!open) return null

  const handleSave = async () => {
    if (selected.size === 0) { setError('Chọn ít nhất một sản phẩm'); return }
    setError('')
    try {
      await bulkMutation.mutateAsync({ productIds: [...selected], cls, note })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được — thử lại')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="font-bold text-gray-800">Gán sản phẩm vào nhóm</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Nhóm đích */}
          <div>
            <label className="block text-tiny font-semibold text-gray-600 mb-1.5">Gán vào nhóm *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCls('strategic')}
                className={`p-3 rounded-lg border text-left transition-all ${cls === 'strategic' ? 'border-[#1E5A9C] bg-blue-50 ring-1 ring-[#1E5A9C]' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex items-center gap-1.5 font-bold text-tiny text-[#1E5A9C]"><Target size={14} />Nhóm 1 — Chiến lược</div>
                <div className="text-tiny text-gray-500 mt-1">Markup ≥ 50% giá vốn, nguồn lợi nhuận chính</div>
              </button>
              <button
                type="button"
                onClick={() => setCls('baseline')}
                className={`p-3 rounded-lg border text-left transition-all ${cls === 'baseline' ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex items-center gap-1.5 font-bold text-tiny text-emerald-700"><Layers size={14} />Nhóm 2 — Hàng nền</div>
                <div className="text-tiny text-gray-500 mt-1">Bắt buộc có mặt, quay nhanh, chấp nhận hòa/lỗ</div>
              </button>
            </div>
          </div>

          {/* Bộ lọc */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm tên / SKU (không dấu)…"
                className="h-10 pl-9 pr-3 w-full border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
              />
            </div>
            <SmartSearchSelect
              options={brandOptions} value={brandFilter} onChange={setBrandFilter}
              placeholder="Tất cả thương hiệu" searchPlaceholder="Tìm thương hiệu…"
            />
            <SmartSearchSelect
              options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter}
              placeholder="Tất cả nhóm hàng" searchPlaceholder="Tìm nhóm hàng…"
            />
          </div>

          {/* Thanh chọn */}
          <div className="flex flex-wrap items-center gap-3 text-tiny">
            <button
              type="button"
              onClick={toggleAllFiltered}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 font-semibold text-[#1E5A9C] hover:underline disabled:opacity-40 disabled:no-underline"
            >
              {allFilteredSelected ? <CheckSquare size={15} /> : <Square size={15} />}
              {allFilteredSelected ? 'Bỏ chọn' : 'Chọn'} tất cả {filtered.length} SP đang lọc
            </button>
            <label className="flex items-center gap-1.5 text-gray-500 cursor-pointer">
              <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} />
              Chỉ hiện SP chưa phân loại
            </label>
            {selected.size > 0 && (
              <span className="ml-auto font-bold text-gray-700">Đã chọn {selected.size} SP</span>
            )}
          </div>

          {/* Danh sách */}
          <div className="border border-gray-200 rounded-lg h-72 overflow-y-auto divide-y divide-gray-50">
            {loadingProducts ? (
              <div className="h-full flex items-center justify-center gap-2 text-gray-300 text-tiny">
                <Loader2 size={16} className="animate-spin" />Đang tải sản phẩm…
              </div>
            ) : filtered.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-300 text-tiny">
                Không có sản phẩm khớp bộ lọc
              </div>
            ) : (
              filtered.map(p => {
                const on = selected.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${on ? 'bg-blue-50/60' : 'hover:bg-gray-25'}`}
                  >
                    {on
                      ? <CheckSquare size={15} className="text-[#1E5A9C] shrink-0" />
                      : <Square size={15} className="text-gray-300 shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-body-md font-medium text-gray-800 truncate">{p.name}</span>
                      <span className="block text-tiny text-gray-400">{p.sku}</span>
                    </span>
                    {assignedIds.has(p.id) && (
                      <span className="text-tiny text-amber-600 shrink-0">đã có nhóm</span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          <div>
            <label className="block text-tiny font-semibold text-gray-600 mb-1.5">Ghi chú (áp cho tất cả SP đã chọn)</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="VD: hàng kéo khách mùa dịch tả…"
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
          </div>
          {error && <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-tiny text-red-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="h-10 px-4 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50">Hủy</button>
          <button
            onClick={handleSave}
            disabled={bulkMutation.isPending || selected.size === 0}
            className="h-10 px-5 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny hover:bg-[#143C69] active:scale-95 transition-all disabled:opacity-50"
          >
            {bulkMutation.isPending ? 'Đang lưu…' : `Gán ${selected.size || ''} SP vào nhóm ${cls === 'strategic' ? '1' : '2'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
