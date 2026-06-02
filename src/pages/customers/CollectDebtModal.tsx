import { useState } from 'react'
import { X, Wallet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

interface CollectDebtModalProps {
  customer: { id: string; name: string; code?: string }
  currentDebt: number
  onClose: () => void
  /** Gọi sau khi thu thành công — nơi gọi tự refetch/invalidate dữ liệu. */
  onSuccess: (msg: string) => void
}

type PayMethod = 'cash' | 'bank_transfer'

const today = () => new Date().toLocaleDateString('en-CA')

const inputCls =
  'w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none'
const labelCls = 'block text-tiny font-bold text-gray-400 uppercase tracking-wider'

/**
 * Modal "Thanh toán" — thu công nợ khách hàng nhanh.
 * Gọi RPC fn_collect_customer_debt (atomic): ghi debt_payments → trigger sinh
 * phiếu thu sổ quỹ + settle FIFO customer_debts. Thu vượt → "Khách trả trước".
 */
export default function CollectDebtModal({ customer, currentDebt, onClose, onSuccess }: CollectDebtModalProps) {
  const { formatCurrency } = useDisplaySettings()
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<PayMethod>('cash')
  const [date, setDate] = useState(today())
  const [refNo, setRefNo] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const overpay = amount > currentDebt && currentDebt > 0
  const excess = Math.max(0, amount - Math.max(currentDebt, 0))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (amount <= 0) { setError('Số tiền thu phải lớn hơn 0 ₫.'); return }
    setSubmitting(true)
    try {
      const { error: rpcErr } = await supabase.rpc('fn_collect_customer_debt', {
        p_customer_id: customer.id,
        p_amount: amount,
        p_method: method,
        p_date: date,
        p_reference: refNo.trim() || null,
        p_notes: notes.trim() || null,
      })
      if (rpcErr) throw rpcErr
      onSuccess(
        excess > 0
          ? `Đã thu ${formatCurrency(amount)}. Phần vượt ${formatCurrency(excess)} ghi nhận là Khách trả trước. Sổ quỹ đã cập nhật.`
          : `Đã thu ${formatCurrency(amount)} công nợ. Sổ quỹ và công nợ đã cập nhật.`
      )
    } catch (err: any) {
      setError('Thu công nợ thất bại: ' + (err.message || 'Lỗi không xác định.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Wallet size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-body-lg font-bold text-gray-700 leading-tight">Thanh toán công nợ</h3>
              <p className="text-tiny text-gray-400 truncate">{customer.name}{customer.code ? ` · ${customer.code}` : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Công nợ hiện tại */}
          <div className="bg-gray-25 border border-gray-100 rounded-lg p-3 flex items-center justify-between">
            <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Công nợ hiện tại</span>
            <span className={`font-bold tabular-nums ${currentDebt > 0 ? 'text-orange-600' : currentDebt < 0 ? 'text-emerald-600' : 'text-gray-600'}`}>
              {formatCurrency(currentDebt)}
            </span>
          </div>

          {/* Số tiền */}
          <div className="space-y-1">
            <label className={labelCls}>Số tiền thu (₫) *</label>
            <input
              type="number" min="0" value={amount === 0 ? '' : amount} placeholder="0 ₫"
              onChange={e => setAmount(Math.max(0, parseFloat(e.target.value) || 0))}
              className={inputCls + ' text-right tabular-nums font-semibold'}
              autoFocus
            />
            {currentDebt > 0 && (
              <button type="button" onClick={() => setAmount(currentDebt)}
                className="text-tiny text-blue-600 underline font-semibold mt-0.5">
                Thu toàn bộ ({formatCurrency(currentDebt)})
              </button>
            )}
          </div>

          {/* Cảnh báo thu vượt */}
          {overpay && (
            <div className="flex items-start gap-2 text-tiny text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Phần vượt <b>{formatCurrency(excess)}</b> sẽ ghi nhận là <b>Khách trả trước</b> và tự khấu trừ ở các giao dịch sau.</span>
            </div>
          )}

          {/* Hình thức */}
          <div className="space-y-1">
            <label className={labelCls}>Hình thức nhận tiền</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setMethod('cash')}
                className={`h-10 rounded-lg border font-semibold text-tiny transition-all ${
                  method === 'cash' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-25'}`}>
                Tiền mặt
              </button>
              <button type="button" onClick={() => setMethod('bank_transfer')}
                className={`h-10 rounded-lg border font-semibold text-tiny transition-all ${
                  method === 'bank_transfer' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-25'}`}>
                Chuyển khoản
              </button>
            </div>
          </div>

          {/* Ngày + Tham chiếu */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={labelCls}>Ngày thu</label>
              <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Mã CT / Tham chiếu</label>
              <input type="text" value={refNo} onChange={e => setRefNo(e.target.value)}
                placeholder="VD: VCB-109..." className={inputCls} />
            </div>
          </div>

          {/* Ghi chú */}
          <div className="space-y-1">
            <label className={labelCls}>Ghi chú</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Thu công nợ khách hàng"
              className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none" />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-tiny text-red-600 bg-red-50 border border-red-100 rounded-lg p-2.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <p className="flex items-center gap-1.5 text-[10px] text-gray-400 italic">
            <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
            Giao dịch được ghi tự động vào sổ quỹ và giảm công nợ ngay khi xác nhận.
          </p>

          {/* Footer actions */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={submitting}
              className="flex-1 h-10 border border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-25 transition-all disabled:opacity-60">
              Hủy
            </button>
            <button type="submit" disabled={submitting || amount <= 0}
              className="flex-1 h-10 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60">
              {submitting ? <><Loader2 size={16} className="animate-spin" /> Đang xử lý…</> : 'Xác nhận thu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
