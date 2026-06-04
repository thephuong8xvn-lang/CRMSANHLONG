import { useState } from 'react'
import { X, Save, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export interface EditableLot {
  id: string
  lot_number: string
  manufacture_date: string | null
  expiry_date: string | null
  cost_price: number
  status: string
  quantity_on_hand: number
  quantity_reserved?: number
  product?: { name: string; sku: string }
  warehouse?: { name: string }
}

interface Props {
  lot: EditableLot
  onClose: () => void
  onSaved: (msg: string) => void
}

const LOT_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'Sẵn dùng' },
  { value: 'quarantine', label: 'Kiểm dịch' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'damaged', label: 'Hỏng' },
  { value: 'disposed', label: 'Đã hủy' }
]

// Chuẩn hóa date về yyyy-MM-dd cho input[type=date]
const toDateInput = (d: string | null) => (d ? d.slice(0, 10) : '')

export default function LotEditModal({ lot, onClose, onSaved }: Props) {
  const reserved = Number(lot.quantity_reserved || 0)
  const [lotNumber, setLotNumber] = useState(lot.lot_number || '')
  const [mfgDate, setMfgDate] = useState(toDateInput(lot.manufacture_date))
  const [expDate, setExpDate] = useState(toDateInput(lot.expiry_date))
  const [costPrice, setCostPrice] = useState(Number(lot.cost_price) || 0)
  const [status, setStatus] = useState(lot.status || 'active')
  const [qty, setQty] = useState(Number(lot.quantity_on_hand) || 0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const delta = qty - Number(lot.quantity_on_hand)

  const handleSubmit = async () => {
    setError(null)
    if (!lotNumber.trim()) { setError('Số lô không được để trống.'); return }
    if (qty < 0) { setError('Số lượng tồn không được âm.'); return }
    if (qty < reserved) { setError(`Số lượng tồn mới nhỏ hơn phần đang giữ chỗ (${reserved}).`); return }
    setSubmitting(true)
    try {
      const { error: rpcErr } = await supabase.rpc('fn_admin_edit_lot', {
        p_lot_id: lot.id,
        p_payload: {
          lot_number: lotNumber.trim(),
          manufacture_date: mfgDate || null,
          expiry_date: expDate || null,
          cost_price: costPrice,
          status,
          quantity_on_hand: qty
        }
      })
      if (rpcErr) throw rpcErr
      onSaved('Đã cập nhật lô hàng.')
    } catch (err: any) {
      setError(err?.message || 'Lưu lô hàng thất bại.')
    } finally {
      setSubmitting(false)
    }
  }

  const fmt = (v: number) => new Intl.NumberFormat('vi-VN').format(v)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-headline-md font-bold text-gray-800">Sửa lô hàng</h3>
            <p className="text-tiny text-gray-400 mt-0.5">
              {lot.product?.name} · {lot.warehouse?.name}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-lg text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-body-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-tiny font-semibold text-gray-500 mb-1">Số lô</label>
            <input
              type="text" value={lotNumber}
              onChange={e => setLotNumber(e.target.value)}
              className="w-full h-9 px-3 border border-gray-200 rounded-lg text-body-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-tiny font-semibold text-gray-500 mb-1">Ngày sản xuất</label>
              <input
                type="date" value={mfgDate}
                onChange={e => setMfgDate(e.target.value)}
                className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-tiny font-semibold text-gray-500 mb-1">Hạn sử dụng</label>
              <input
                type="date" value={expDate}
                onChange={e => setExpDate(e.target.value)}
                className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-tiny font-semibold text-gray-500 mb-1">Giá vốn (₫)</label>
              <input
                type="number" min={0} value={costPrice}
                onChange={e => setCostPrice(Number(e.target.value))}
                className="w-full h-9 px-2 border border-gray-200 rounded-lg text-right text-body-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-tiny font-semibold text-gray-500 mb-1">Trạng thái</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500"
              >
                {LOT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-tiny font-semibold text-gray-500 mb-1">Số lượng tồn</label>
            <input
              type="number" min={0} step="any" value={qty}
              onChange={e => setQty(Number(e.target.value))}
              className="w-full h-9 px-2 border border-gray-200 rounded-lg text-right font-semibold text-body-sm focus:outline-none focus:border-blue-500"
            />
            <p className="text-tiny text-gray-400 mt-1">
              Đang giữ chỗ: <span className="font-semibold text-gray-600">{fmt(reserved)}</span>
              {delta !== 0 && (
                <span className={`ml-2 font-semibold ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  → sẽ ghi bút toán điều chỉnh {delta > 0 ? '+' : ''}{fmt(delta)}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="h-10 px-4 border border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-50">
            Hủy
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg flex items-center gap-2 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            Lưu thay đổi
          </button>
        </div>
      </div>
    </div>
  )
}
