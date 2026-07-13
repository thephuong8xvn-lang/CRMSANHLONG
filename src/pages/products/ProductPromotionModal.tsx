import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAuth } from '../../contexts/AuthContext'
import SmartSearchSelect, { type SmartSearchOption } from '../../components/SmartSearchSelect'
import type { ProductPromotion } from '../../hooks/useProductPromotions'

interface Branch { id: string; name: string }

/** Giá trị prefill khi TẠO MỚI (không dùng khi sửa). Vd: cầu nối từ trang Hạn sử dụng. */
export interface ProductPromoDefaults {
  name?: string
  promo_type?: ProductPromotion['promo_type']
  discount_value?: number
  valid_to?: string   // 'YYYY-MM-DD'
}

interface Props {
  /** SP gắn KM. Bỏ trống khi mở từ module KM → người dùng tự chọn (cần pickProduct). */
  productId?: string
  productName?: string
  /** true = hiện ô chọn sản phẩm (A) ngay trong modal (dùng ở trang /promotions). */
  pickProduct?: boolean
  promo?: ProductPromotion        // có = chế độ sửa
  defaults?: ProductPromoDefaults // có = prefill khi tạo mới (bỏ qua nếu đang sửa)
  onClose: () => void
  onSaved: () => void
}

const PROMO_TYPE_LABELS: Record<ProductPromotion['promo_type'], string> = {
  buy_x_get_y: 'Mua X tặng Y',
  unit_price: 'Giá ưu đãi khi mua đủ số lượng',
  percent: 'Giảm % theo số lượng',
  fixed_amount: 'Giảm tiền theo số lượng',
}

export default function ProductPromotionModal({ productId, productName, pickProduct, promo, defaults, onClose, onSaved }: Props) {
  const { profile, userRole } = useAuth()
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'
  const myBranchId = profile?.branch_id ?? null
  const isEdit = Boolean(promo?.id)
  // Prefill chỉ áp dụng khi TẠO MỚI (đang sửa thì lấy từ promo).
  const d = isEdit ? undefined : defaults

  const [branches, setBranches] = useState<Branch[]>([])
  const [productOptions, setProductOptions] = useState<SmartSearchOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // SP gắn KM. Mở từ chi tiết SP → cố định; mở từ module KM → người dùng chọn.
  const [pickedProductId, setPickedProductId] = useState<string>(promo?.product_id ?? productId ?? '')
  const pickedProductName =
    productName
    ?? (productOptions.find(o => o.value === pickedProductId)?.label ?? '')

  const [form, setForm] = useState({
    name: promo?.name ?? d?.name ?? '',
    promo_type: promo?.promo_type ?? d?.promo_type ?? ('buy_x_get_y' as ProductPromotion['promo_type']),
    buy_qty: String(promo?.buy_qty ?? 10),
    get_qty: String(promo?.get_qty ?? 2),
    giftOther: Boolean(promo?.get_product_id && promo.get_product_id !== promo.product_id),
    get_product_id: promo?.get_product_id ?? '',
    giftPaid: Boolean(promo?.get_price && promo.get_price > 0), // true = quà có giá ưu đãi, false = miễn phí
    get_price: String(promo?.get_price ?? ''),
    discount_value: String(promo?.discount_value ?? d?.discount_value ?? ''),
    min_qty: String(promo?.min_qty ?? 1),
    priority: String(promo?.priority ?? 0),
    valid_from: promo?.valid_from?.slice(0, 10) ?? '',
    valid_to: promo?.valid_to?.slice(0, 10) ?? d?.valid_to ?? '',
    is_active: promo?.is_active ?? true,
    branch_ids: promo?.branch_ids ?? (isAdmin ? [] : (myBranchId ? [myBranchId] : [])),
  })

  useEffect(() => {
    if (isAdmin) {
      supabase.from('branches').select('id, name').eq('is_active', true).order('name')
        .then(({ data }: { data: Branch[] | null }) => { if (data) setBranches(data) })
    }
    // Nạp ĐỦ sản phẩm (tránh cap 1000) để search được mọi SP làm quà tặng.
    fetchAllRows<{ id: string; name: string; sku: string }>((from, to) =>
      supabase.from('products').select('id, name, sku').eq('is_active', true)
        .order('name', { ascending: true }).order('id').range(from, to)
    )
      .then(data => setProductOptions(data.map(p => ({ value: p.id, label: p.name, desc: p.sku }))))
      .catch(err => console.error('Error loading products for promotion:', err))
  }, [isAdmin])

  const toggleBranch = (id: string) => {
    setForm(f => ({
      ...f,
      branch_ids: f.branch_ids.includes(id) ? f.branch_ids.filter(b => b !== id) : [...f.branch_ids, id],
    }))
  }

  const handleSave = async () => {
    setError('')
    if (!pickedProductId) { setError('Hãy chọn sản phẩm áp dụng KM'); return }
    if (!form.name.trim()) { setError('Nhập tên chương trình KM'); return }

    if (form.promo_type === 'buy_x_get_y') {
      if (Number(form.buy_qty) <= 0 || Number(form.get_qty) <= 0) { setError('Số lượng mua/tặng phải > 0'); return }
      if (form.giftOther && !form.get_product_id) { setError('Hãy chọn sản phẩm tặng (B)'); return }
      if (form.giftPaid && Number(form.get_price) <= 0) { setError('Nhập giá ưu đãi cho quà tặng > 0'); return }
    } else {
      if (Number(form.discount_value) <= 0) { setError('Nhập giá trị giảm > 0'); return }
      if (form.promo_type === 'percent' && Number(form.discount_value) > 100) { setError('Giảm % không thể vượt quá 100'); return }
    }

    // Nhân viên: khóa cứng chi nhánh của họ
    const branch_ids = isAdmin ? form.branch_ids : (myBranchId ? [myBranchId] : [])
    if (!isAdmin && !myBranchId) { setError('Tài khoản chưa gán chi nhánh, không thể tạo KM'); return }

    setSaving(true)
    const payload: Record<string, unknown> = {
      product_id: pickedProductId,
      name: form.name.trim(),
      promo_type: form.promo_type,
      buy_qty: form.promo_type === 'buy_x_get_y' ? Number(form.buy_qty) : null,
      get_qty: form.promo_type === 'buy_x_get_y' ? Number(form.get_qty) : null,
      get_product_id: form.promo_type === 'buy_x_get_y' && form.giftOther && form.get_product_id
        ? form.get_product_id : null,
      get_price: form.promo_type === 'buy_x_get_y' && form.giftPaid ? Number(form.get_price) || 0 : 0,
      discount_value: form.promo_type === 'buy_x_get_y' ? 0 : Number(form.discount_value),
      min_qty: form.promo_type === 'buy_x_get_y' ? 1 : Math.max(1, Number(form.min_qty)),
      branch_ids,
      priority: Number(form.priority) || 0,
      valid_from: form.valid_from || null,
      valid_to: form.valid_to || null,
      is_active: form.is_active,
    }
    if (!isEdit) payload.created_by = profile?.id ?? null

    const { error: err } = isEdit
      ? await supabase.from('product_promotions').update(payload).eq('id', promo!.id)
      : await supabase.from('product_promotions').insert(payload)

    setSaving(false)
    if (err) {
      setError(err.message.includes('row-level security')
        ? 'Bạn không có quyền tạo KM cho chi nhánh này.'
        : err.message)
      return
    }
    onSaved()
    onClose()
  }

  const inputCls = 'mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold mb-1">{isEdit ? 'Sửa khuyến mãi sản phẩm' : 'Thêm khuyến mãi sản phẩm'}</h2>
        <p className="text-sm text-gray-500 mb-4">{pickedProductName || 'Chưa chọn sản phẩm'}</p>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <div className="space-y-3">
          {pickProduct && (
            <div className="text-sm font-medium text-gray-700">
              Sản phẩm áp dụng (A) *
              <SmartSearchSelect
                options={productOptions}
                value={pickedProductId}
                onChange={setPickedProductId}
                placeholder="-- Chọn sản phẩm gắn KM --"
              />
            </div>
          )}

          <label className="block text-sm font-medium text-gray-700">
            Tên chương trình *
            <input className={inputCls} placeholder="VD: Mua 10 tặng 2"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Loại khuyến mãi *
            <select className={inputCls} value={form.promo_type}
              onChange={e => setForm(f => ({ ...f, promo_type: e.target.value as ProductPromotion['promo_type'] }))}>
              {Object.entries(PROMO_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          {form.promo_type === 'buy_x_get_y' ? (
            <>
              {/* Sản phẩm A — sản phẩm đang gán KM (điều kiện mua) */}
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm">
                <span className="text-gray-600">Mua sản phẩm </span>
                <span className="font-semibold text-blue-800">(A) {pickedProductName || '(chưa chọn)'}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-gray-700">
                  Số lượng mua (X)
                  <input type="number" min="1" className={inputCls}
                    value={form.buy_qty} onChange={e => setForm(f => ({ ...f, buy_qty: e.target.value }))} />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Số lượng tặng (Y)
                  <input type="number" min="1" className={inputCls}
                    value={form.get_qty} onChange={e => setForm(f => ({ ...f, get_qty: e.target.value }))} />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.giftOther}
                  onChange={e => setForm(f => ({ ...f, giftOther: e.target.checked }))} />
                Tặng sản phẩm khác (B) — bỏ chọn = tặng chính sản phẩm A
              </label>
              {form.giftOther && (
                <div className="text-sm font-medium text-gray-700">
                  Sản phẩm tặng (B)
                  <SmartSearchSelect options={productOptions} value={form.get_product_id}
                    onChange={v => setForm(f => ({ ...f, get_product_id: v }))}
                    placeholder="-- Chọn sản phẩm tặng --" />
                </div>
              )}

              {/* Giá quà tặng: miễn phí hoặc giá ưu đãi */}
              <div className="text-sm font-medium text-gray-700">
                Giá quà tặng
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <label className="flex items-center gap-1.5 font-normal">
                    <input type="radio" name="giftPaid" checked={!form.giftPaid}
                      onChange={() => setForm(f => ({ ...f, giftPaid: false }))} />
                    Miễn phí (0₫)
                  </label>
                  <label className="flex items-center gap-1.5 font-normal">
                    <input type="radio" name="giftPaid" checked={form.giftPaid}
                      onChange={() => setForm(f => ({ ...f, giftPaid: true }))} />
                    Giá ưu đãi
                  </label>
                  {form.giftPaid && (
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="VD: 6000"
                        value={form.get_price} onChange={e => setForm(f => ({ ...f, get_price: e.target.value }))} />
                      <span className="text-gray-500">₫/đơn vị</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Tóm tắt sống — đọc trực tiếp từ cấu hình để phát hiện tên KM lệch */}
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[13px] text-amber-900">
                🎁 Mua <b>{form.buy_qty || '?'}</b> {pickedProductName || '(chưa chọn SP)'} → tặng <b>{form.get_qty || '?'}</b>{' '}
                {form.giftOther
                  ? (productOptions.find(o => o.value === form.get_product_id)?.label ?? '(chọn SP tặng B)')
                  : (pickedProductName || '(chưa chọn SP)')}
                {' · '}
                {form.giftPaid && Number(form.get_price) > 0
                  ? `giá ưu đãi ${Number(form.get_price).toLocaleString('vi-VN')}₫`
                  : 'miễn phí'}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-gray-700">
                  {form.promo_type === 'unit_price'
                    ? 'Giá ưu đãi (₫/đơn vị)'
                    : `Giá trị giảm (${form.promo_type === 'percent' ? '%' : '₫/đơn vị'})`}
                  <input type="number" min="0" className={inputCls}
                    placeholder={form.promo_type === 'unit_price' ? 'VD: 90000' : ''}
                    value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Số lượng tối thiểu
                  <input type="number" min="1" className={inputCls}
                    placeholder={form.promo_type === 'unit_price' ? 'VD: 25' : ''}
                    value={form.min_qty} onChange={e => setForm(f => ({ ...f, min_qty: e.target.value }))} />
                </label>
              </div>

              {form.promo_type === 'unit_price' && (
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[13px] text-amber-900">
                  🏷️ Mua từ <b>{form.min_qty || '?'}</b> {pickedProductName || '(chưa chọn SP)'} → giá{' '}
                  <b>{form.discount_value ? Number(form.discount_value).toLocaleString('vi-VN') : '?'}₫</b>/đơn vị.
                  <span className="block text-amber-700/80 mt-0.5">
                    Mua ít hơn vẫn tính giá niêm yết. Nếu giá ưu đãi không rẻ hơn giá đang bán, KM tự bỏ qua.
                  </span>
                </div>
              )}
            </>
          )}

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
                <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg font-medium">
                  🔒 Khóa tại chi nhánh của bạn
                </span>
                <span className="text-gray-400">(Chỉ admin mới được chọn nhiều chi nhánh)</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">
              Từ ngày
              <input type="date" className={inputCls}
                value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Đến ngày
              <input type="date" className={inputCls}
                value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 items-center">
            <label className="block text-sm font-medium text-gray-700">
              Ưu tiên
              <input type="number" className={inputCls}
                value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
              Đang hoạt động
            </label>
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
