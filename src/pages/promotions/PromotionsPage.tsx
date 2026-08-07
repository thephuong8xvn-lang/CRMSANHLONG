import { useState, useEffect, useCallback, useMemo } from 'react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { Plus, Tag, Pencil, Trash2, ToggleLeft, ToggleRight, Ticket, Building2, Search, X, Send } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import type { Promotion, Voucher } from '../../hooks/usePromotionEngine'
import { promoShortLabel, type ProductPromotion } from '../../hooks/useProductPromotions'
import ProductPromotionModal from '../products/ProductPromotionModal'

interface BranchLite { id: string; name: string }
interface ProductLite { id: string; name: string; sku: string }

/** KM sản phẩm kèm tên SP (join) để liệt kê tập trung tại module KM. */
type ProductPromoRow = ProductPromotion & {
  product?: { name: string; sku: string } | null
  gift_product?: { name: string } | null
}

/** Kết quả RPC fn_promo_broadcast — dùng chung cho cả 3 chế độ. */
interface PromoPreview {
  ok?: boolean
  che_do?: string
  noi_dung?: string
  anh?: string | null
  so_nhom_nhan?: number
  so_nhom_bo_qua?: number
  da_xep_hang?: number
  loi?: string
}

/** Một dòng báo cáo hiệu quả KM (RPC fn_promo_performance). */
interface PromoPerfRow {
  scope: 'order' | 'product'
  promo_id: string
  promo_name: string
  promo_type: string
  order_count: number
  revenue: number
  discount_given: number
}

const DISCOUNT_TYPE_LABELS: Record<string, string> = {
  percent: 'Giảm % đơn hàng',
  fixed_amount: 'Giảm tiền cố định',
  buy_x_get_y: 'Mua X+Y tính tiền X',
  combo_price: 'Combo giá',
  tiered_quantity: 'Bậc thang SL',
  customer_tier_discount: 'Theo hạng KH',
}

/**
 * Loại được phép TẠO MỚI. `buy_x_get_y` cấp đơn đã gỡ: nó có nghĩa "lấy X+Y món,
 * tính tiền X món" — khác hẳn "Mua X tặng Y" của KM theo sản phẩm (sinh dòng quà).
 * Hai nhãn giống nhau gây hiểu nhầm → dồn về KM theo sản phẩm. KM cũ vẫn sửa được.
 */
const CREATABLE_TYPES = ['percent', 'fixed_amount', 'combo_price', 'tiered_quantity', 'customer_tier_discount'] as const

/** Khớp enum customer_value_tier trong DB — KHÔNG phải regular/silver/gold/platinum. */
const CUSTOMER_TIERS: { value: string; label: string }[] = [
  { value: 'normal', label: 'Khách thường' },
  { value: 'vip', label: 'VIP' },
  { value: 'high_potential', label: 'Tiềm năng cao' },
]

/** Các loại KM cần biết áp lên sản phẩm nào (rỗng = toàn bộ giỏ, riêng combo bắt buộc chọn). */
const TYPES_NEEDING_PRODUCTS = ['percent', 'fixed_amount', 'combo_price', 'tiered_quantity']

/** Chọn nhiều sản phẩm cho applies_to.product_ids — tìm theo tên/SKU. */
function ProductPicker({ products, selected, onChange }: {
  products: ProductLite[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return []
    return products
      .filter(p => !selected.includes(p.id))
      .filter(p => p.name.toLowerCase().includes(kw) || (p.sku ?? '').toLowerCase().includes(kw))
      .slice(0, 8)
  }, [q, products, selected])

  const chosen = useMemo(
    () => selected.map(id => products.find(p => p.id === id)).filter(Boolean) as ProductLite[],
    [selected, products],
  )

  return (
    <div className="mt-1 border border-gray-300 rounded-lg p-2">
      <div className="flex items-center gap-1.5 border-b border-gray-100 pb-1.5">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          className="w-full text-sm outline-none font-normal"
          placeholder="Gõ tên hoặc SKU để thêm sản phẩm..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      {matches.length > 0 && (
        <div className="mt-1 max-h-36 overflow-y-auto">
          {matches.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange([...selected, p.id]); setQ('') }}
              className="w-full text-left px-2 py-1.5 text-sm hover:bg-blue-50 rounded font-normal"
            >
              {p.name} <span className="text-xs text-gray-400 font-mono">{p.sku}</span>
            </button>
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chosen.map(p => (
            <span key={p.id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-xs px-2 py-1 rounded-lg font-normal">
              {p.name}
              <button type="button" onClick={() => onChange(selected.filter(id => id !== p.id))}
                className="text-blue-400 hover:text-red-600">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const DISCOUNT_TYPE_COLORS: Record<string, string> = {
  percent: 'bg-blue-50 text-blue-700',
  fixed_amount: 'bg-green-50 text-green-700',
  buy_x_get_y: 'bg-purple-50 text-purple-700',
  combo_price: 'bg-orange-50 text-orange-700',
  tiered_quantity: 'bg-teal-50 text-teal-700',
  customer_tier_discount: 'bg-pink-50 text-pink-700',
}

function formatDiscount(p: Promotion) {
  switch (p.discount_type) {
    case 'percent': return `${p.discount_value}%`
    case 'fixed_amount': return `${p.discount_value.toLocaleString('vi-VN')}₫`
    case 'buy_x_get_y': return `Lấy ${(p.buy_x_qty ?? 0) + (p.get_y_qty ?? 0)} tính tiền ${p.buy_x_qty ?? 'X'}`
    case 'combo_price': return p.combo_price != null
      ? `Combo ${p.combo_price.toLocaleString('vi-VN')}₫ · ${(p.applies_to?.product_ids ?? []).length} SP`
      : 'Combo (chưa đặt giá)'
    case 'tiered_quantity': return `${(p.tiers ?? []).length} bậc`
    case 'customer_tier_discount': return `${p.discount_value}% cho ${(p.customer_tiers ?? []).join(', ')}`
    default: return `${p.discount_value}`
  }
}

/**
 * Gửi chương trình khuyến mãi vào các nhóm Telegram của khách.
 *
 * Ba bước cố ý tách rời, không gộp thành một nút "Gửi":
 *   1. Xem trước  — thấy đúng nội dung và danh sách nhóm sẽ nhận, chưa gửi gì
 *   2. Gửi thử    — một bản vào nhóm nội bộ để đọc bằng mắt
 *   3. Gửi thật   — mới chạm tới khách
 * Tin nhắn ra ngoài không thu hồi được như sửa một dòng dữ liệu, nên bắt buộc
 * phải nhìn thấy trước khi bấm.
 */
function PromoBroadcastModal({ promo, onClose }: { promo: Promotion; onClose: () => void }) {
  const [preview, setPreview] = useState<PromoPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const call = useCallback(async (mode: 'preview' | 'test' | 'send') => {
    const { data, error: err } = await supabase.rpc('fn_promo_broadcast', {
      p_promotion_id: promo.id, p_mode: mode,
    })
    if (err) throw new Error(err.message)
    if (data && data.ok === false) throw new Error(data.loi || 'Không gửi được')
    return data as PromoPreview
  }, [promo.id])

  useEffect(() => {
    let alive = true
    call('preview')
      .then(d => { if (alive) setPreview(d) })
      .catch(e => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [call])

  const run = async (mode: 'test' | 'send') => {
    setBusy(mode); setError(''); setDone('')
    try {
      const d = await call(mode)
      setDone(mode === 'test'
        ? 'Đã gửi bản xem thử vào nhóm nội bộ.'
        : `Đã xếp hàng gửi tới ${d.da_xep_hang ?? 0} nhóm. Tin đi trong khoảng 15 giây mỗi lượt.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-0 w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Gửi khuyến mãi vào nhóm Telegram</h3>
            <p className="text-xs text-gray-400">{promo.name}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && <p className="text-sm text-gray-500">Đang dựng nội dung…</p>}

          {preview && (
            <>
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg bg-blue-50 border border-blue-100 p-3">
                  <p className="text-xs text-gray-500">Nhóm sẽ nhận</p>
                  <p className="text-xl font-semibold text-blue-700">{preview.so_nhom_nhan ?? 0}</p>
                </div>
                <div className="flex-1 rounded-lg bg-gray-50 border border-gray-100 p-3">
                  <p className="text-xs text-gray-500">Bỏ qua</p>
                  <p className="text-xl font-semibold text-gray-600">{preview.so_nhom_bo_qua ?? 0}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">đã nhận trong 7 ngày, hoặc từ chối nhận KM</p>
                </div>
              </div>

              {preview.so_nhom_nhan === 0 && (
                <p className="text-sm text-warning-500 bg-warning-500/10 rounded-lg p-3">
                  Chưa có nhóm nào đủ điều kiện nhận. Khách phải được gán id nhóm Telegram
                  trong hồ sơ trước đã.
                </p>
              )}

              <div>
                <p className="text-xs text-gray-500 mb-1.5">Nội dung tin</p>
                <pre className="text-sm bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap font-sans text-gray-700">
                  {(preview.noi_dung ?? '').replace(/<\/?b>|<\/?i>/g, '')}
                </pre>
              </div>

              {preview.anh && (
                <p className="text-xs text-gray-400">Có kèm ảnh minh hoạ.</p>
              )}
            </>
          )}

          {error && <p className="text-sm text-danger-500 bg-danger-500/10 rounded-lg p-3">{error}</p>}
          {done && <p className="text-sm text-success-500 bg-success-500/10 rounded-lg p-3">{done}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            Đóng
          </button>
          <button onClick={() => run('test')} disabled={!!busy || !preview}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {busy === 'test' ? 'Đang gửi…' : 'Gửi thử vào nhóm nội bộ'}
          </button>
          <button onClick={() => run('send')}
            disabled={!!busy || !preview || (preview?.so_nhom_nhan ?? 0) === 0}
            className="px-4 py-2 text-sm bg-blue-500 text-gray-0 rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {busy === 'send' ? 'Đang gửi…' : `Gửi cho ${preview?.so_nhom_nhan ?? 0} nhóm`}
          </button>
        </div>
      </div>
    </div>
  )
}

function VoucherGenerateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    discount_type: 'percent' as 'percent' | 'fixed_amount',
    discount_value: '',
    min_order_amount: '0',
    max_discount: '',
    valid_to: '',
    max_uses: '1',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!form.discount_value) { setError('Nhập giá trị giảm'); return }
    setSaving(true)
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    const { error: err } = await supabase.from('vouchers').insert({
      code,
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value),
      min_order_amount: Number(form.min_order_amount),
      max_discount: form.max_discount ? Number(form.max_discount) : null,
      valid_to: form.valid_to || null,
      max_uses: Number(form.max_uses),
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">Tạo voucher mới</h2>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Loại giảm giá
            <select className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.discount_type}
              onChange={e => setForm(f => ({ ...f, discount_type: e.target.value as 'percent' | 'fixed_amount' }))}>
              <option value="percent">Giảm %</option>
              <option value="fixed_amount">Giảm tiền</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Giá trị ({form.discount_type === 'percent' ? '%' : '₫'})
            <input type="number" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} />
          </label>
          {form.discount_type === 'percent' && (
            <label className="block text-sm font-medium text-gray-700">
              Giảm tối đa (₫, để trống = không giới hạn)
              <input type="number" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.max_discount} onChange={e => setForm(f => ({ ...f, max_discount: e.target.value }))} />
            </label>
          )}
          <label className="block text-sm font-medium text-gray-700">
            Đơn tối thiểu (₫)
            <input type="number" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.min_order_amount} onChange={e => setForm(f => ({ ...f, min_order_amount: e.target.value }))} />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Hết hạn
            <input type="date" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Số lần dùng tối đa
            <input type="number" min="1" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.max_uses} onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))} />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Hủy</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Đang tạo...' : 'Tạo voucher'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PromotionModal({ promo, onClose, onSaved }: { promo?: Partial<Promotion>; onClose: () => void; onSaved: () => void }) {
  const { profile, userRole } = useAuth()
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'
  const myBranchId = profile?.branch_id ?? null
  const isEdit = Boolean(promo?.id)
  const [branches, setBranches] = useState<BranchLite[]>([])
  const [products, setProducts] = useState<ProductLite[]>([])
  const [form, setForm] = useState({
    code: promo?.code ?? '',
    name: promo?.name ?? '',
    description: promo?.description ?? '',
    discount_type: promo?.discount_type ?? 'percent',
    discount_value: String(promo?.discount_value ?? ''),
    min_order_amount: String(promo?.min_order_amount ?? 0),
    buy_x_qty: String(promo?.buy_x_qty ?? 1),
    get_y_qty: String(promo?.get_y_qty ?? 1),
    combo_price: promo?.combo_price != null ? String(promo.combo_price) : '',
    product_ids: promo?.applies_to?.product_ids ?? [],
    tiers_json: promo?.tiers ? JSON.stringify(promo.tiers, null, 2) : '[{"min_qty":5,"discount_percent":5},{"min_qty":10,"discount_percent":10}]',
    customer_tiers: promo?.customer_tiers ?? [],
    valid_from: promo?.valid_from?.slice(0, 10) ?? '',
    valid_to: promo?.valid_to?.slice(0, 10) ?? '',
    max_uses: String(promo?.max_uses ?? ''),
    priority: String(promo?.priority ?? 0),
    branch_ids: promo?.branch_ids ?? (isAdmin ? [] : (myBranchId ? [myBranchId] : [])),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Loại đang sửa có thể là loại cũ đã gỡ khỏi danh sách tạo mới → vẫn phải hiện trong dropdown.
  const typeOptions = useMemo(() => {
    const list: string[] = [...CREATABLE_TYPES]
    if (form.discount_type && !list.includes(form.discount_type)) list.unshift(form.discount_type)
    return list
  }, [form.discount_type])

  useEffect(() => {
    if (isAdmin) {
      supabase.from('branches').select('id, name').eq('is_active', true).order('name')
        .then(({ data }: { data: BranchLite[] | null }) => { if (data) setBranches(data) })
    }
    fetchAllRows<ProductLite>((from, to) =>
      supabase.from('products').select('id, name, sku').eq('is_active', true)
        .order('name', { ascending: true }).order('id').range(from, to)
    )
      .then(setProducts)
      .catch(err => console.error('Load products for promotion failed:', err))
  }, [isAdmin])

  const toggleBranch = (id: string) => {
    setForm(f => ({
      ...f,
      branch_ids: f.branch_ids.includes(id) ? f.branch_ids.filter(b => b !== id) : [...f.branch_ids, id],
    }))
  }

  const handleSave = async () => {
    if (!form.code.trim()) { setError('Nhập mã KM'); return }
    if (!form.name.trim()) { setError('Nhập tên KM'); return }
    if (!isAdmin && !myBranchId) { setError('Tài khoản chưa gán chi nhánh, không thể tạo KM'); return }

    if (form.discount_type === 'combo_price') {
      if (form.product_ids.length < 2) { setError('Combo cần ít nhất 2 sản phẩm'); return }
      if (!form.combo_price || Number(form.combo_price) <= 0) { setError('Nhập giá combo > 0'); return }
    }
    if (['percent', 'customer_tier_discount'].includes(form.discount_type) && Number(form.discount_value) > 100) {
      setError('Giảm % không thể vượt quá 100'); return
    }
    if (form.discount_type === 'customer_tier_discount' && form.customer_tiers.length === 0) {
      setError('Chọn ít nhất một hạng khách hàng'); return
    }

    let tiers = undefined
    if (form.discount_type === 'tiered_quantity') {
      try { tiers = JSON.parse(form.tiers_json) } catch { setError('Tiers JSON không hợp lệ'); return }
    }

    setSaving(true)
    const payload: Record<string, unknown> = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value) || 0,
      min_order_amount: Number(form.min_order_amount) || 0,
      valid_from: form.valid_from || null,
      valid_to: form.valid_to || null,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      priority: Number(form.priority) || 0,
      buy_x_qty: form.discount_type === 'buy_x_get_y' ? Number(form.buy_x_qty) : null,
      get_y_qty: form.discount_type === 'buy_x_get_y' ? Number(form.get_y_qty) : null,
      combo_price: form.discount_type === 'combo_price' ? Number(form.combo_price) : null,
      // Rỗng = áp lên toàn bộ giỏ hàng. Combo bắt buộc có (đã chặn ở trên).
      applies_to: { product_ids: form.product_ids },
      tiers: tiers ?? null,
      customer_tiers: form.discount_type === 'customer_tier_discount' ? form.customer_tiers : [],
      branch_ids: isAdmin ? form.branch_ids : (myBranchId ? [myBranchId] : []),
      updated_at: new Date().toISOString(),
    }

    const { error: err } = isEdit
      ? await supabase.from('promotions').update(payload).eq('id', promo!.id!)
      : await supabase.from('promotions').insert(payload)

    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold mb-4">{isEdit ? 'Sửa khuyến mãi' : 'Thêm khuyến mãi'}</h2>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">
              Mã KM *
              <input className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase"
                value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Loại KM *
              <select className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.discount_type}
                onChange={e => setForm(f => ({ ...f, discount_type: e.target.value as Promotion['discount_type'] }))}>
                {typeOptions.map(v => (
                  <option key={v} value={v}>{DISCOUNT_TYPE_LABELS[v] ?? v}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium text-gray-700">
            Tên khuyến mãi *
            <input className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>

          {['percent', 'fixed_amount', 'customer_tier_discount'].includes(form.discount_type) && (
            <label className="block text-sm font-medium text-gray-700">
              Giá trị ({form.discount_type === 'percent' || form.discount_type === 'customer_tier_discount' ? '%' : '₫'})
              <input type="number" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} />
            </label>
          )}

          {form.discount_type === 'buy_x_get_y' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700">
                Mua X sản phẩm
                <input type="number" min="1" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.buy_x_qty} onChange={e => setForm(f => ({ ...f, buy_x_qty: e.target.value }))} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Tặng Y sản phẩm
                <input type="number" min="1" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.get_y_qty} onChange={e => setForm(f => ({ ...f, get_y_qty: e.target.value }))} />
              </label>
            </div>
          )}

          {form.discount_type === 'combo_price' && (
            <label className="block text-sm font-medium text-gray-700">
              Giá trọn bộ combo (₫) *
              <input type="number" min="0" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="VD: 450000"
                value={form.combo_price} onChange={e => setForm(f => ({ ...f, combo_price: e.target.value }))} />
              <span className="text-xs text-gray-400 font-normal">
                Giá cho 1 bộ gồm 1 đơn vị mỗi sản phẩm bên dưới. Giỏ có đủ bộ nào thì giảm bộ đó.
              </span>
            </label>
          )}

          {TYPES_NEEDING_PRODUCTS.includes(form.discount_type) && (
            <div className="text-sm font-medium text-gray-700">
              {form.discount_type === 'combo_price' ? 'Sản phẩm trong combo *' : 'Sản phẩm áp dụng'}
              <ProductPicker
                products={products}
                selected={form.product_ids}
                onChange={ids => setForm(f => ({ ...f, product_ids: ids }))}
              />
              {form.discount_type !== 'combo_price' && (
                <span className="text-xs text-gray-400 font-normal">
                  Để trống = áp lên toàn bộ giỏ hàng.
                </span>
              )}
            </div>
          )}

          {form.discount_type === 'tiered_quantity' && (
            <label className="block text-sm font-medium text-gray-700">
              Bậc thang (JSON)
              <textarea rows={4} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono"
                value={form.tiers_json} onChange={e => setForm(f => ({ ...f, tiers_json: e.target.value }))} />
            </label>
          )}

          {form.discount_type === 'customer_tier_discount' && (
            <div className="text-sm font-medium text-gray-700">
              Hạng khách hàng được hưởng *
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 border border-gray-200 rounded-lg p-2">
                {CUSTOMER_TIERS.map(t => (
                  <label key={t.value} className="flex items-center gap-1.5 text-sm font-normal text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.customer_tiers.includes(t.value)}
                      onChange={() => setForm(f => ({
                        ...f,
                        customer_tiers: f.customer_tiers.includes(t.value)
                          ? f.customer_tiers.filter(x => x !== t.value)
                          : [...f.customer_tiers, t.value],
                      }))}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">
              Đơn tối thiểu (₫)
              <input type="number" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.min_order_amount} onChange={e => setForm(f => ({ ...f, min_order_amount: e.target.value }))} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Ưu tiên
              <input type="number" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">
              Từ ngày
              <input type="date" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Đến ngày
              <input type="date" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} />
            </label>
          </div>
          <label className="block text-sm font-medium text-gray-700">
            Số lần dùng tối đa (để trống = không giới hạn)
            <input type="number" min="1" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.max_uses} onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))} />
          </label>

          {/* Chi nhánh áp dụng */}
          <div className="text-sm font-medium text-gray-700">
            Chi nhánh áp dụng
            {isAdmin ? (
              <div className="mt-1 border border-gray-200 rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                <p className="text-xs text-gray-400 mb-1">Không chọn = áp dụng toàn hệ thống</p>
                {branches.map(b => (
                  <label key={b.id} className="flex items-center gap-2 text-sm text-gray-700 py-0.5">
                    <input type="checkbox" checked={form.branch_ids.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                    {b.name}
                  </label>
                ))}
                {branches.length === 0 && <p className="text-xs text-gray-400">Đang tải chi nhánh...</p>}
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg font-medium">🔒 Khóa tại chi nhánh của bạn</span>
                <span className="text-gray-400">(Chỉ admin được chọn nhiều chi nhánh)</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Hủy</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Tạo mới'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [productPromos, setProductPromos] = useState<ProductPromoRow[]>([])
  const [perf, setPerf] = useState<PromoPerfRow[]>([])
  const [perfDays, setPerfDays] = useState(30)
  const [perfError, setPerfError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'promotions' | 'product_promos' | 'vouchers' | 'perf'>('promotions')
  const [showPromoModal, setShowPromoModal] = useState(false)
  const [broadcastPromo, setBroadcastPromo] = useState<Promotion | null>(null)
  const [editingPromo, setEditingPromo] = useState<Partial<Promotion> | undefined>()
  const [showVoucherModal, setShowVoucherModal] = useState(false)
  const [showProductPromoModal, setShowProductPromoModal] = useState(false)
  const [editingProductPromo, setEditingProductPromo] = useState<ProductPromotion | undefined>()

  const loadData = useCallback(async () => {
    setLoading(true)
    const [promosRes, vouchersRes, prodPromosRes] = await Promise.all([
      supabase.from('promotions').select('*').order('priority', { ascending: false }),
      supabase.from('vouchers').select('*').order('created_at', { ascending: false }),
      // KM theo sản phẩm — trước đây chỉ xem được khi mở từng SP một.
      supabase
        .from('product_promotions')
        // Gợi ý join theo TÊN CỘT (product_id / get_product_id) — products bị tham chiếu
        // 2 lần nên PostgREST cần phân biệt; dùng tên cột bền hơn tên ràng buộc FK.
        .select('*, product:products!product_id(name, sku), gift_product:products!get_product_id(name)')
        .order('is_active', { ascending: false })
        .order('priority', { ascending: false }),
    ])
    if (promosRes.data) setPromotions(promosRes.data as Promotion[])
    if (vouchersRes.data) setVouchers(vouchersRes.data as Voucher[])
    if (prodPromosRes.data) setProductPromos(prodPromosRes.data as ProductPromoRow[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Báo cáo hiệu quả — chỉ gọi khi mở tab (RPC quét orders, không nạp sẵn).
  useEffect(() => {
    if (tab !== 'perf') return
    const from = new Date(Date.now() - perfDays * 86400_000).toISOString().slice(0, 10)
    setPerfError('')
    supabase
      .rpc('fn_promo_performance', { p_from: from, p_to: new Date().toISOString().slice(0, 10) })
      .then(({ data, error }: { data: PromoPerfRow[] | null; error: { message: string } | null }) => {
        // Không nuốt lỗi thành "bảng rỗng" — phân biệt rõ chưa có dữ liệu vs lỗi.
        if (error) { setPerfError(error.message); setPerf([]); return }
        setPerf(data ?? [])
      })
  }, [tab, perfDays])

  const togglePromo = async (id: string, current: boolean) => {
    await supabase.from('promotions').update({ is_active: !current }).eq('id', id)
    setPromotions(ps => ps.map(p => p.id === id ? { ...p, is_active: !current } : p))
  }

  const deletePromo = async (id: string) => {
    if (!confirm('Xóa khuyến mãi này?')) return
    await supabase.from('promotions').delete().eq('id', id)
    setPromotions(ps => ps.filter(p => p.id !== id))
  }

  const toggleProductPromo = async (id: string, current: boolean) => {
    await supabase.from('product_promotions').update({ is_active: !current }).eq('id', id)
    setProductPromos(ps => ps.map(p => p.id === id ? { ...p, is_active: !current } : p))
  }

  const deleteProductPromo = async (id: string) => {
    if (!confirm('Xóa khuyến mãi sản phẩm này?')) return
    await supabase.from('product_promotions').delete().eq('id', id)
    setProductPromos(ps => ps.filter(p => p.id !== id))
  }

  const openNewForTab = () => {
    if (tab === 'promotions') { setEditingPromo(undefined); setShowPromoModal(true) }
    else if (tab === 'product_promos') { setEditingProductPromo(undefined); setShowProductPromoModal(true) }
    else setShowVoucherModal(true)
  }

  const newButtonLabel = tab === 'promotions' ? 'Thêm KM đơn hàng'
    : tab === 'product_promos' ? 'Thêm KM sản phẩm'
    : 'Tạo voucher'

  const deactivateVoucher = async (id: string) => {
    await supabase.from('vouchers').update({ is_active: false }).eq('id', id)
    setVouchers(vs => vs.map(v => v.id === id ? { ...v, is_active: false as boolean } : v))
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
              <Tag size={20} className="text-orange-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Khuyến mãi</h1>
              <p className="text-sm text-gray-500">Quản lý chương trình KM và voucher</p>
            </div>
          </div>
          {tab !== 'perf' && (
            <button
              onClick={openNewForTab}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              {newButtonLabel}
            </button>
          )}
          {tab === 'perf' && (
            <select
              value={perfDays}
              onChange={e => setPerfDays(Number(e.target.value))}
              className="border border-gray-300 rounded-xl px-3 py-2 text-sm"
            >
              <option value={7}>7 ngày qua</option>
              <option value={30}>30 ngày qua</option>
              <option value={90}>90 ngày qua</option>
            </select>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-5">
          {([
            ['promotions', 'KM đơn hàng'],
            ['product_promos', 'KM theo sản phẩm'],
            ['vouchers', 'Voucher'],
            ['perf', 'Hiệu quả'],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Đang tải...</div>
        ) : tab === 'promotions' ? (
          <div className="space-y-3">
            {promotions.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <Tag size={40} className="mx-auto mb-3 opacity-30" />
                <p>Chưa có khuyến mãi nào</p>
              </div>
            )}
            {promotions.map(p => (
              <div key={p.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 ${!p.is_active ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded font-medium">{p.code}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DISCOUNT_TYPE_COLORS[p.discount_type]}`}>
                      {DISCOUNT_TYPE_LABELS[p.discount_type]}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600 flex items-center gap-1">
                      <Building2 size={11} />
                      {(p.branch_ids?.length ?? 0) === 0 ? 'Toàn hệ thống' : `${p.branch_ids!.length} chi nhánh`}
                    </span>
                    {!p.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Tắt</span>}
                  </div>
                  <p className="font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-sm text-gray-500">
                    {formatDiscount(p)}
                    {p.min_order_amount > 0 && ` · Đơn tối thiểu ${p.min_order_amount.toLocaleString('vi-VN')}₫`}
                    {p.valid_to && ` · Đến ${new Date(p.valid_to).toLocaleDateString('vi-VN')}`}
                    {p.max_uses && ` · ${p.current_uses}/${p.max_uses} lượt`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setBroadcastPromo(p)}
                    className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                    title="Gửi vào nhóm Telegram của khách">
                    <Send size={16} />
                  </button>
                  <button onClick={() => togglePromo(p.id, p.is_active)}
                    className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                    title={p.is_active ? 'Tắt KM' : 'Bật KM'}>
                    {p.is_active ? <ToggleRight size={20} className="text-blue-600" /> : <ToggleLeft size={20} />}
                  </button>
                  <button onClick={() => { setEditingPromo(p); setShowPromoModal(true) }}
                    className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => deletePromo(p.id)}
                    className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'perf' ? (
          <div>
            {perfError && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                Không tải được báo cáo: {perfError}
              </p>
            )}
            {!perfError && perf.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <Tag size={40} className="mx-auto mb-3 opacity-30" />
                <p>Chưa có đơn nào dùng khuyến mãi trong {perfDays} ngày qua</p>
              </div>
            )}
            {perf.length > 0 && (
              <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Chương trình</th>
                      <th className="text-right px-4 py-3 font-semibold">Số đơn</th>
                      <th className="text-right px-4 py-3 font-semibold">Doanh thu</th>
                      <th className="text-right px-4 py-3 font-semibold">Chi phí KM</th>
                      <th className="text-right px-4 py-3 font-semibold">% trên doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perf.map(r => {
                      const ratio = r.revenue > 0 ? (r.discount_given / r.revenue) * 100 : 0
                      return (
                        <tr key={`${r.scope}-${r.promo_id}`} className="border-t border-gray-100">
                          <td className="px-4 py-3">
                            <span className="font-medium text-gray-900">{r.promo_name}</span>
                            <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full font-medium ${
                              r.scope === 'order' ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-600'
                            }`}>
                              {r.scope === 'order' ? 'KM đơn hàng' : 'KM sản phẩm'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.order_count.toLocaleString('vi-VN')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{Math.round(r.revenue).toLocaleString('vi-VN')} ₫</td>
                          <td className="px-4 py-3 text-right tabular-nums text-rose-600">
                            {Math.round(r.discount_given).toLocaleString('vi-VN')} ₫
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                            ratio > 20 ? 'text-red-600' : 'text-gray-600'
                          }`}>
                            {ratio.toFixed(1)}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-gray-400">
              Chi phí KM của "KM sản phẩm" gồm chiết khấu dòng cộng <b>giá vốn</b> hàng tặng — quà 0₫ vẫn tốn kho.
            </p>
          </div>
        ) : tab === 'product_promos' ? (
          <div className="space-y-3">
            {productPromos.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <Tag size={40} className="mx-auto mb-3 opacity-30" />
                <p>Chưa có khuyến mãi theo sản phẩm nào</p>
                <p className="text-xs mt-1">KM theo sản phẩm sẽ tự áp ngoài màn hình bán hàng POS</p>
              </div>
            )}
            {productPromos.map(p => (
              <div key={p.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 ${!p.is_active ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-rose-50 text-rose-600">
                      {promoShortLabel(p)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600 flex items-center gap-1">
                      <Building2 size={11} />
                      {p.branch_ids.length === 0 ? 'Toàn hệ thống' : `${p.branch_ids.length} chi nhánh`}
                    </span>
                    {!p.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Tắt</span>}
                  </div>
                  <p className="font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-sm text-gray-500 truncate">
                    <span className="text-gray-700">{p.product?.name ?? 'SP đã xóa'}</span>
                    {p.product?.sku && <span className="font-mono text-xs text-gray-400"> · {p.product.sku}</span>}
                  </p>
                  {p.promo_type === 'buy_x_get_y' && (
                    <p className="text-xs text-emerald-700 mt-0.5">
                      🎁 Tặng {p.get_qty} {p.get_product_id && p.get_product_id !== p.product_id
                        ? (p.gift_product?.name ?? 'SP khác')
                        : 'chính sản phẩm này'}
                      {' · '}
                      {p.get_price > 0
                        ? `giá ưu đãi ${p.get_price.toLocaleString('vi-VN')}₫`
                        : 'miễn phí'}
                    </p>
                  )}
                  {p.valid_to && (
                    <p className="text-xs text-gray-400 mt-0.5">Đến {new Date(p.valid_to).toLocaleDateString('vi-VN')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggleProductPromo(p.id, p.is_active)}
                    className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                    title={p.is_active ? 'Tắt KM' : 'Bật KM'}>
                    {p.is_active ? <ToggleRight size={20} className="text-blue-600" /> : <ToggleLeft size={20} />}
                  </button>
                  <button onClick={() => { setEditingProductPromo(p); setShowProductPromoModal(true) }}
                    className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => deleteProductPromo(p.id)}
                    className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {vouchers.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <Ticket size={40} className="mx-auto mb-3 opacity-30" />
                <p>Chưa có voucher nào</p>
              </div>
            )}
            {vouchers.map(v => {
              const vAny = v as unknown as Record<string, unknown>
              const isActive = vAny.is_active as boolean
              return (
                <div key={v.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 ${!isActive ? 'opacity-60' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-1 rounded-lg tracking-widest">
                        {v.code}
                      </span>
                      {!isActive && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Đã hủy</span>}
                    </div>
                    <p className="text-sm text-gray-600">
                      Giảm {v.discount_type === 'percent' ? `${v.discount_value}%` : `${v.discount_value.toLocaleString('vi-VN')}₫`}
                      {v.min_order_amount > 0 && ` · Tối thiểu ${v.min_order_amount.toLocaleString('vi-VN')}₫`}
                      {v.valid_to && ` · Đến ${new Date(v.valid_to).toLocaleDateString('vi-VN')}`}
                      {` · ${v.current_uses}/${v.max_uses} lần dùng`}
                    </p>
                  </div>
                  {isActive && (
                    <button onClick={() => deactivateVoucher(v.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      Hủy
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showPromoModal && (
        <PromotionModal
          promo={editingPromo}
          onClose={() => setShowPromoModal(false)}
          onSaved={loadData}
        />
      )}
      {broadcastPromo && (
        <PromoBroadcastModal
          promo={broadcastPromo}
          onClose={() => setBroadcastPromo(null)}
        />
      )}
      {showVoucherModal && (
        <VoucherGenerateModal
          onClose={() => setShowVoucherModal(false)}
          onSaved={loadData}
        />
      )}
      {showProductPromoModal && (
        <ProductPromotionModal
          pickProduct                       // mở từ module → tự chọn SP trong modal
          promo={editingProductPromo}
          onClose={() => setShowProductPromoModal(false)}
          onSaved={loadData}
        />
      )}
    </Layout>
  )
}
