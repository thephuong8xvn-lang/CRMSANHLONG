import { useState, useEffect, useCallback } from 'react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { Plus, Tag, Pencil, Trash2, ToggleLeft, ToggleRight, Ticket, Building2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import type { Promotion, Voucher } from '../../hooks/usePromotionEngine'

interface BranchLite { id: string; name: string }

const DISCOUNT_TYPE_LABELS: Record<string, string> = {
  percent: 'Giảm % đơn hàng',
  fixed_amount: 'Giảm tiền cố định',
  buy_x_get_y: 'Mua X tặng Y',
  combo_price: 'Combo giá',
  tiered_quantity: 'Bậc thang SL',
  customer_tier_discount: 'Theo hạng KH',
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
    case 'buy_x_get_y': return `Mua ${p.buy_x_qty ?? 'X'} tặng ${p.get_y_qty ?? 'Y'}`
    case 'tiered_quantity': return `${(p.tiers ?? []).length} bậc`
    case 'customer_tier_discount': return `${p.discount_value}% cho ${(p.customer_tiers ?? []).join(', ')}`
    default: return `${p.discount_value}`
  }
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
  const [form, setForm] = useState({
    code: promo?.code ?? '',
    name: promo?.name ?? '',
    description: promo?.description ?? '',
    discount_type: promo?.discount_type ?? 'percent',
    discount_value: String(promo?.discount_value ?? ''),
    min_order_amount: String(promo?.min_order_amount ?? 0),
    buy_x_qty: String(promo?.buy_x_qty ?? 1),
    get_y_qty: String(promo?.get_y_qty ?? 1),
    tiers_json: promo?.tiers ? JSON.stringify(promo.tiers, null, 2) : '[{"min_qty":5,"discount_percent":5},{"min_qty":10,"discount_percent":10}]',
    customer_tiers: (promo?.customer_tiers ?? []).join(', '),
    valid_from: promo?.valid_from?.slice(0, 10) ?? '',
    valid_to: promo?.valid_to?.slice(0, 10) ?? '',
    max_uses: String(promo?.max_uses ?? ''),
    priority: String(promo?.priority ?? 0),
    branch_ids: promo?.branch_ids ?? (isAdmin ? [] : (myBranchId ? [myBranchId] : [])),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      .then(({ data }: { data: BranchLite[] | null }) => { if (data) setBranches(data) })
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
    setSaving(true)

    let tiers = undefined
    if (form.discount_type === 'tiered_quantity') {
      try { tiers = JSON.parse(form.tiers_json) } catch { setError('Tiers JSON không hợp lệ'); setSaving(false); return }
    }

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
      tiers: tiers ?? null,
      customer_tiers: form.customer_tiers ? form.customer_tiers.split(',').map(s => s.trim()).filter(Boolean) : [],
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
                {Object.entries(DISCOUNT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
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

          {form.discount_type === 'tiered_quantity' && (
            <label className="block text-sm font-medium text-gray-700">
              Bậc thang (JSON)
              <textarea rows={4} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono"
                value={form.tiers_json} onChange={e => setForm(f => ({ ...f, tiers_json: e.target.value }))} />
            </label>
          )}

          {form.discount_type === 'customer_tier_discount' && (
            <label className="block text-sm font-medium text-gray-700">
              Hạng KH (phân cách dấu phẩy: regular, silver, gold, vip, platinum)
              <input className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.customer_tiers} onChange={e => setForm(f => ({ ...f, customer_tiers: e.target.value }))} />
            </label>
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
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'promotions' | 'vouchers'>('promotions')
  const [showPromoModal, setShowPromoModal] = useState(false)
  const [editingPromo, setEditingPromo] = useState<Partial<Promotion> | undefined>()
  const [showVoucherModal, setShowVoucherModal] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [promosRes, vouchersRes] = await Promise.all([
      supabase.from('promotions').select('*').order('priority', { ascending: false }),
      supabase.from('vouchers').select('*').order('created_at', { ascending: false }),
    ])
    if (promosRes.data) setPromotions(promosRes.data as Promotion[])
    if (vouchersRes.data) setVouchers(vouchersRes.data as Voucher[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const togglePromo = async (id: string, current: boolean) => {
    await supabase.from('promotions').update({ is_active: !current }).eq('id', id)
    setPromotions(ps => ps.map(p => p.id === id ? { ...p, is_active: !current } : p))
  }

  const deletePromo = async (id: string) => {
    if (!confirm('Xóa khuyến mãi này?')) return
    await supabase.from('promotions').delete().eq('id', id)
    setPromotions(ps => ps.filter(p => p.id !== id))
  }

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
          <button
            onClick={() => tab === 'promotions' ? (setEditingPromo(undefined), setShowPromoModal(true)) : setShowVoucherModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            {tab === 'promotions' ? 'Thêm KM' : 'Tạo voucher'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-5">
          {([['promotions', 'Chương trình KM'], ['vouchers', 'Voucher']] as const).map(([key, label]) => (
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
      {showVoucherModal && (
        <VoucherGenerateModal
          onClose={() => setShowVoucherModal(false)}
          onSaved={loadData}
        />
      )}
    </Layout>
  )
}
