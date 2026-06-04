import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2, Save, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import SmartSearchSelect, { type SmartSearchOption } from '../../components/SmartSearchSelect'

// Dòng đơn đang sửa
interface EditLine {
  product_id: string
  name: string
  sku: string
  unit: string
  quantity: number
  unit_price: number
  discount: number // chiết khấu / đơn vị
}

interface OrderForEdit {
  id: string
  sale_channel: string
  status: string
  customer_id: string
  price_list_id: string | null
  warehouse_id: string | null
  payment_method: string
  notes: string | null
  delivery_address: string | null
  grand_total: number
  paid_amount: number
}

interface ExistingLine {
  product_id: string
  quantity: number
  unit_price: number
  discount: number
  product_snapshot?: { name: string; sku: string; unit: string }
}

interface ProductRow {
  id: string
  sku: string
  name: string
  unit: string
  price_list_items?: Array<{ price_list_id: string; selling_price: number }>
}

interface CustomerRow {
  id: string
  code: string
  farm_name: string
}

interface Props {
  order: OrderForEdit
  lines: ExistingLine[]
  canEditQty: boolean
  onClose: () => void
  onSaved: (msg: string) => void
}

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'bank_transfer', label: 'Chuyển khoản' },
  { value: 'card_pos', label: 'Quẹt thẻ' },
  { value: 'credit', label: 'Ghi nợ' }
]

export default function OrderEditModal({ order, lines, canEditQty, onClose, onSaved }: Props) {
  const isDelivery = order.sale_channel === 'delivery'
  const isDraft = order.status === 'draft'

  const [products, setProducts] = useState<ProductRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const [editLines, setEditLines] = useState<EditLine[]>(
    lines.map(l => ({
      product_id: l.product_id,
      name: l.product_snapshot?.name || 'Sản phẩm',
      sku: l.product_snapshot?.sku || '',
      unit: l.product_snapshot?.unit || '',
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      discount: Number(l.discount)
    }))
  )
  const [customerId, setCustomerId] = useState(order.customer_id)
  const [paymentMethod, setPaymentMethod] = useState(order.payment_method || 'cash')
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [notes, setNotes] = useState(order.notes || '')
  const [deliveryAddress, setDeliveryAddress] = useState(order.delivery_address || '')
  const [addProductId, setAddProductId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Nạp products + customers (fetchAllRows → không rớt SP/KH 1001+)
  useEffect(() => {
    const load = async () => {
      try {
        const [prods, custs] = await Promise.all([
          fetchAllRows<ProductRow>((from, to) =>
            supabase
              .from('products')
              .select('id, sku, name, unit, price_list_items(price_list_id, selling_price)')
              .eq('is_active', true)
              .order('name')
              .order('id')
              .range(from, to)
          ),
          fetchAllRows<CustomerRow>((from, to) =>
            supabase
              .from('customers')
              .select('id, code, farm_name')
              .eq('is_active', true)
              .order('farm_name')
              .order('id')
              .range(from, to)
          )
        ])
        setProducts(prods)
        setCustomers(custs)
      } catch (err: any) {
        setError('Không tải được danh mục sản phẩm/khách hàng: ' + (err?.message || ''))
      } finally {
        setLoadingData(false)
      }
    }
    load()
  }, [])

  const newGrandTotal = useMemo(() => {
    const sum = editLines.reduce((acc, l) => acc + (l.unit_price - l.discount) * l.quantity, 0)
    return Math.max(0, sum - invoiceDiscount)
  }, [editLines, invoiceDiscount])

  const [paidAmount, setPaidAmount] = useState(Number(order.paid_amount) || 0)
  // Đơn bán nhanh đã hoàn tất: mặc định trả đủ theo tổng mới khi mở (lần đầu)
  useEffect(() => {
    if (!isDraft && paymentMethod !== 'credit') setPaidAmount(newGrandTotal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newGrandTotal, paymentMethod])

  const customerOptions: SmartSearchOption[] = useMemo(
    () => customers.map(c => ({ value: c.id, label: c.farm_name, desc: c.code })),
    [customers]
  )
  const productOptions: SmartSearchOption[] = useMemo(
    () =>
      products
        .filter(p => !editLines.some(l => l.product_id === p.id))
        .map(p => ({ value: p.id, label: p.name, desc: p.sku })),
    [products, editLines]
  )

  const handleAddProduct = (productId: string) => {
    if (!productId) return
    const p = products.find(x => x.id === productId)
    if (!p) return
    const priceItem =
      (order.price_list_id && p.price_list_items?.find(pi => pi.price_list_id === order.price_list_id)) ||
      p.price_list_items?.[0]
    setEditLines(prev => [
      ...prev,
      {
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        quantity: 1,
        unit_price: Number(priceItem?.selling_price || 0),
        discount: 0
      }
    ])
    setAddProductId('')
  }

  const updateLine = (idx: number, patch: Partial<EditLine>) => {
    setEditLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  const removeLine = (idx: number) => setEditLines(prev => prev.filter((_, i) => i !== idx))

  const handleSubmit = async () => {
    setError(null)
    if (editLines.length === 0) {
      setError('Đơn hàng phải có ít nhất 1 dòng sản phẩm.')
      return
    }
    if (!customerId) {
      setError('Vui lòng chọn khách hàng.')
      return
    }
    if (editLines.some(l => l.quantity <= 0)) {
      setError('Số lượng mỗi dòng phải lớn hơn 0.')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        customer_id: customerId,
        warehouse_id: order.warehouse_id || null,
        price_list_id: order.price_list_id || null,
        invoice_discount: invoiceDiscount || 0,
        notes: notes || null,
        payment_method: paymentMethod,
        paid_amount: paymentMethod === 'credit' ? 0 : paidAmount,
        delivery_address: isDelivery ? (deliveryAddress || null) : 'Giao trực tiếp tại quầy POS',
        lines: editLines.map(l => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount: l.discount
        }))
      }
      const { data, error: rpcErr } = await supabase.rpc('fn_pos_edit_order', {
        p_order_id: order.id,
        p_payload: payload
      })
      if (rpcErr) throw rpcErr
      const res = data as { order_code: string }
      onSaved(`Đã cập nhật đơn hàng ${res?.order_code || ''}.`)
    } catch (err: any) {
      setError(err?.message || 'Lưu thay đổi thất bại.')
    } finally {
      setSubmitting(false)
    }
  }

  const fmt = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-headline-md font-bold text-gray-800">Sửa đơn hàng</h3>
            <p className="text-tiny text-gray-400 mt-0.5">
              {isDelivery ? 'Bán giao hàng' : 'Bán nhanh tại quầy'}
              {!isDraft && ' · Lưu sẽ hoàn kho cũ & trừ kho lại theo số lượng mới'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-lg text-gray-500">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-body-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loadingData ? (
            <div className="flex items-center justify-center py-10 gap-2 text-gray-400">
              <Loader2 className="animate-spin" size={18} /> Đang tải danh mục...
            </div>
          ) : (
            <>
              {/* Khách hàng */}
              <div>
                <label className="block text-tiny font-semibold text-gray-500 mb-1">Khách hàng</label>
                <SmartSearchSelect
                  options={customerOptions}
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder="-- Chọn khách hàng --"
                  searchPlaceholder="Tìm theo tên/mã khách..."
                />
              </div>

              {/* Dòng sản phẩm */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-tiny font-semibold text-gray-500">Sản phẩm</label>
                  {!canEditQty && (
                    <span className="text-tiny text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      Không được sửa số lượng
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {editLines.map((l, idx) => (
                    <div key={l.product_id} className="grid grid-cols-12 gap-2 items-center bg-gray-25 border border-gray-100 rounded-lg px-3 py-2">
                      <div className="col-span-12 sm:col-span-4 min-w-0">
                        <p className="text-body-sm font-bold text-gray-800 truncate">{l.name}</p>
                        <p className="text-tiny text-gray-400 truncate">{l.sku} · {l.unit}</p>
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <label className="text-[10px] text-gray-400">SL</label>
                        <input
                          type="number" min={0} step="any" value={l.quantity}
                          disabled={!canEditQty}
                          onChange={e => updateLine(idx, { quantity: Number(e.target.value) })}
                          className="w-full h-8 px-2 border border-gray-200 rounded text-right font-semibold focus:outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-3">
                        <label className="text-[10px] text-gray-400">Đơn giá</label>
                        <input
                          type="number" min={0} value={l.unit_price}
                          onChange={e => updateLine(idx, { unit_price: Number(e.target.value) })}
                          className="w-full h-8 px-2 border border-gray-200 rounded text-right font-semibold focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="col-span-3 sm:col-span-2">
                        <label className="text-[10px] text-gray-400">CK/đv</label>
                        <input
                          type="number" min={0} value={l.discount}
                          onChange={e => updateLine(idx, { discount: Number(e.target.value) })}
                          className="w-full h-8 px-2 border border-gray-200 rounded text-right focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button onClick={() => removeLine(idx)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Thêm sản phẩm */}
                <div className="mt-2 flex items-center gap-2">
                  <Plus size={15} className="text-blue-500 shrink-0" />
                  <div className="flex-1">
                    <SmartSearchSelect
                      options={productOptions}
                      value={addProductId}
                      onChange={handleAddProduct}
                      placeholder="-- Thêm sản phẩm --"
                      searchPlaceholder="Tìm sản phẩm theo tên/SKU..."
                    />
                  </div>
                </div>
              </div>

              {/* Giao hàng (chỉ delivery) */}
              {isDelivery && (
                <div>
                  <label className="block text-tiny font-semibold text-gray-500 mb-1">Địa chỉ giao hàng</label>
                  <input
                    type="text" value={deliveryAddress}
                    onChange={e => setDeliveryAddress(e.target.value)}
                    className="w-full h-9 px-3 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Thanh toán */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-tiny font-semibold text-gray-500 mb-1">Thanh toán</label>
                  <select
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value)}
                    className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500"
                  >
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-tiny font-semibold text-gray-500 mb-1">CK hóa đơn</label>
                  <input
                    type="number" min={0} value={invoiceDiscount}
                    onChange={e => setInvoiceDiscount(Number(e.target.value))}
                    className="w-full h-9 px-2 border border-gray-200 rounded-lg text-right text-body-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-tiny font-semibold text-gray-500 mb-1">Tiền trả</label>
                  <input
                    type="number" min={0} value={paidAmount}
                    disabled={paymentMethod === 'credit'}
                    onChange={e => setPaidAmount(Number(e.target.value))}
                    className="w-full h-9 px-2 border border-gray-200 rounded-lg text-right text-body-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
              </div>

              {/* Ghi chú */}
              <div>
                <label className="block text-tiny font-semibold text-gray-500 mb-1">Ghi chú</label>
                <textarea
                  rows={2} value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <div className="text-body-sm">
            <span className="text-gray-400">Tổng mới:</span>{' '}
            <span className="font-bold text-gray-800 tabular-nums">{fmt(newGrandTotal)} ₫</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-10 px-4 border border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-50">
              Hủy
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || loadingData}
              className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg flex items-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Lưu thay đổi
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
