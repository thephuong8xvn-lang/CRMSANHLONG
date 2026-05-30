import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import SmartSearchSelect, { type SmartSearchOption } from '../../components/SmartSearchSelect'
import type { ProductPromotion } from '../../hooks/useProductPromotions'

interface Branch { id: string; name: string }

interface Props {
  productId: string
  productName: string
  promo?: ProductPromotion        // có = chế độ sửa
  onClose: () => void
  onSaved: () => void
}

const PROMO_TYPE_LABELS: Record<ProductPromotion['promo_type'], string> = {
  buy_x_get_y: 'Mua X tặng Y',
  percent: 'Giảm % theo số lượng',
  fixed_amount: 'Giảm tiền theo số lượng',
}

export default function ProductPromotionModal({ productId, productName, promo, onClose, onSaved }: Props) {
  const { profile, userRole } = useAuth()
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'
  const myBranchId = profile?.branch_id ?? null
  const isEdit = Boolean(promo?.id)

  const [branches, setBranches] = useState<Branch[]>([])
  const [productOptions, setProductOptions] = useState<SmartSearchOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: promo?.name ?? '',
    promo_type: promo?.promo_type ?? ('buy_x_get_y' as ProductPromotion['promo_type']),
    buy_qty: String(promo?.buy_qty ?? 10),
    get_qty: String(promo?.get_qty ?? 2),
    giftOther: Boolean(promo?.get_product_id && promo.get_product_id !== productId),
    get_product_id: promo?.get_product_id ?? '',
    discount_value: String(promo?.discount_value ?? ''),
    min_qty: String(promo?.min_qty ?? 1),
    priority: String(promo?.priority ?? 0),
    valid_from: promo?.valid_from?.slice(0, 10) ?? '',
    valid_to: promo?.valid_to?.slice(0, 10) ?? '',
    is_active: promo?.is_active ?? true,
    branch_ids: promo?.branch_ids ?? (isAdmin ? [] : (myBranchId ? [myBranchId] : [])),
  })

  useEffect(() => {
    if (isAdmin) {
      supabase.from('branches').select('id, name').eq('is_active', true).order('name')
        .then(({ data }: { data: Branch[] | null }) => { if (data) setBranches(data) })
    }
    supabase.from('products').select('id, name, sku').eq('is_active', true).order('name').limit(500)
      .then(({ data }: { data: { id: string; name: string; sku: string }[] | null }) => {
        if (data) setProductOptions(data.map(p => ({ value: p.id, label: p.name, desc: p.sku })))
      })
  }, [isAdmin])

  const toggleBranch = (id: string) => {
    setForm(f => ({
      ...f,
      branch_ids: f.branch_ids.includes(id) ? f.branch_ids.filter(b => b !== id) : [...f.branch_ids, id],
    }))
  }

  const handleSave = async () => {
    setError('')
    if (!form.name.trim()) { setError('Nhập tên chương trình KM'); return }

    if (form.promo_type === 'buy_x_get_y') {
      if (Number(form.buy_qty) <= 0 || Number(form.get_qty) <= 0) { setError('Số lượng mua/tặng phải > 0'); return }
    } else if (Number(form.discount_value) <= 0) {
      setError('Nhập giá trị giảm > 0'); return
    }

    // Nhân viên: khóa cứng chi nhánh của họ
    const branch_ids = isAdmin ? form.branch_ids : (myBranchId ? [myBranchId] : [])
    if (!isAdmin && !myBranchId) { setError('Tài khoản chưa gán chi nhánh, không thể tạo KM'); return }

    setSaving(true)
    const payload: Record<string, unknown> = {
      product_id: productId,
      name: form.name.trim(),
      promo_type: form.promo_type,
      buy_qty: form.promo_type === 'buy_x_get_y' ? Number(form.buy_qty) : null,
      get_qty: form.promo_type === 'buy_x_get_y' ? Number(form.get_qty) : null,
      get_product_id: form.promo_type === 'buy_x_get_y' && form.giftOther && form.get_product_id
        ? form.get_product_id : null,
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
        <p className="text-sm text-gray-500 mb-4">{productName}</p>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <div className="space-y-3">
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
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-gray-700">
                  Mua (số lượng)
                  <input type="number" min="1" className={inputCls}
                    value={form.buy_qty} onChange={e => setForm(f => ({ ...f, buy_qty: e.target.value }))} />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Tặng (số lượng)
                  <input type="number" min="1" className={inputCls}
                    value={form.get_qty} onChange={e => setForm(f => ({ ...f, get_qty: e.target.value }))} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.giftOther}
                  onChange={e => setForm(f => ({ ...f, giftOther: e.target.checked }))} />
                Tặng sản phẩm khác (mặc định tặng chính sản phẩm này)
              </label>
              {form.giftOther && (
                <div className="text-sm font-medium text-gray-700">
                  Sản phẩm tặng
                  <SmartSearchSelect options={productOptions} value={form.get_product_id}
                    onChange={v => setForm(f => ({ ...f, get_product_id: v }))}
                    placeholder="-- Chọn sản phẩm tặng --" />
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700">
                Giá trị giảm ({form.promo_type === 'percent' ? '%' : '₫/đơn vị'})
                <input type="number" min="0" className={inputCls}
                  value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Số lượng tối thiểu
                <input type="number" min="1" className={inputCls}
                  value={form.min_qty} onChange={e => setForm(f => ({ ...f, min_qty: e.target.value }))} />
              </label>
            </div>
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
