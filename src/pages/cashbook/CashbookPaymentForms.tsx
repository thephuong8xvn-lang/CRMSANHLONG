import { useState, useEffect } from 'react'
import { HandCoins, Truck, UserCog } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface OptionCustomer { id: string; name: string; farm_name: string | null }
interface OptionSupplier { id: string; name: string }
interface OptionEmployee { id: string; full_name: string }

interface Props {
  profileId: string
  branchId: string | null
  customers: OptionCustomer[]
  suppliers: OptionSupplier[]
  employees: OptionEmployee[]
  formatCurrency: (val: number | null | undefined) => string
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}

type SubTab = 'debt' | 'supplier' | 'advance'
type PayMethod = 'cash' | 'bank_transfer'

const today = () => new Date().toLocaleDateString('en-CA')

const inputCls =
  'w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none'
const labelCls = 'block text-tiny font-bold text-gray-400 uppercase tracking-wider'

/**
 * AUDIT-2026-05-30 — Sprint S2.3/2.4/2.5
 * 3 luồng nghiệp vụ ghi sổ quỹ: Thu công nợ KH / Thanh toán NCC / Tạm ứng NV.
 * Mỗi luồng chỉ INSERT vào bảng nghiệp vụ tương ứng — trigger DB tự sinh
 * cashbook_transactions + cập nhật số dư/công nợ.
 */
export default function CashbookPaymentForms({
  profileId, branchId, customers, suppliers, employees, formatCurrency, onSuccess, onError,
}: Props) {
  const [sub, setSub] = useState<SubTab>('debt')
  const [submitting, setSubmitting] = useState(false)

  // Common
  const [method, setMethod] = useState<PayMethod>('cash')
  const [amount, setAmount] = useState(0)
  const [refNo, setRefNo] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today())

  // Debt
  const [customerId, setCustomerId] = useState('')
  const [customerDebt, setCustomerDebt] = useState<number | null>(null)

  // Supplier
  const [supplierId, setSupplierId] = useState('')
  const [supplierDebt, setSupplierDebt] = useState<number | null>(null)

  // Advance
  const [employeeId, setEmployeeId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [dueDate, setDueDate] = useState('')

  // Load công nợ KH khi chọn
  useEffect(() => {
    if (!customerId) { setCustomerDebt(null); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('customer_summary_view')
        .select('total_debt')
        .eq('id', customerId)
        .maybeSingle()
      if (!cancelled) setCustomerDebt(data ? Number(data.total_debt || 0) : 0)
    })()
    return () => { cancelled = true }
  }, [customerId])

  // Load công nợ NCC khi chọn
  useEffect(() => {
    if (!supplierId) { setSupplierDebt(null); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('suppliers')
        .select('current_debt_payable')
        .eq('id', supplierId)
        .maybeSingle()
      if (!cancelled) setSupplierDebt(data ? Number(data.current_debt_payable || 0) : 0)
    })()
    return () => { cancelled = true }
  }, [supplierId])

  const resetCommon = () => {
    setAmount(0); setRefNo(''); setNotes(''); setDate(today())
  }

  const handleDebtSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId) return onError('Vui lòng chọn khách hàng.')
    if (amount <= 0) return onError('Số tiền thu phải lớn hơn 0 ₫.')
    setSubmitting(true)
    try {
      const { error } = await supabase.from('debt_payments').insert([{
        customer_id: customerId,
        amount,
        payment_method: method,
        payment_date: date,
        reference_no: refNo.trim() || null,
        notes: notes.trim() || 'Thu công nợ khách hàng',
        recorded_by: profileId,
      }])
      if (error) throw error
      onSuccess('Đã ghi nhận thu công nợ. Sổ quỹ và số dư đã tự cập nhật.')
      resetCommon(); setCustomerId(''); setCustomerDebt(null)
    } catch (err: any) {
      onError('Thu công nợ thất bại: ' + err.message)
    } finally { setSubmitting(false) }
  }

  const handleSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId) return onError('Vui lòng chọn nhà cung cấp.')
    if (amount <= 0) return onError('Số tiền thanh toán phải lớn hơn 0 ₫.')
    setSubmitting(true)
    try {
      const { error } = await supabase.from('supplier_payments').insert([{
        supplier_id: supplierId,
        amount,
        payment_method: method,
        payment_date: date,
        reference_no: refNo.trim() || null,
        notes: notes.trim() || 'Thanh toán nhà cung cấp',
        created_by: profileId,
      }])
      if (error) throw error
      onSuccess('Đã ghi nhận thanh toán NCC. Sổ quỹ và công nợ NCC đã tự cập nhật.')
      resetCommon(); setSupplierId(''); setSupplierDebt(null)
    } catch (err: any) {
      onError('Thanh toán NCC thất bại: ' + err.message)
    } finally { setSubmitting(false) }
  }

  const handleAdvanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employeeId) return onError('Vui lòng chọn nhân viên.')
    if (amount <= 0) return onError('Số tiền tạm ứng phải lớn hơn 0 ₫.')
    if (!purpose.trim()) return onError('Vui lòng nhập lý do tạm ứng.')
    setSubmitting(true)
    try {
      const { error } = await supabase.from('employee_advances').insert([{
        employee_id: employeeId,
        amount,
        purpose: purpose.trim(),
        advance_date: date,
        due_date: dueDate || null,
        created_by: profileId,
      }])
      if (error) throw error
      onSuccess('Đã ghi nhận tạm ứng. Phiếu chi tiền mặt đã tự tạo trong sổ quỹ.')
      resetCommon(); setEmployeeId(''); setPurpose(''); setDueDate('')
    } catch (err: any) {
      onError('Tạm ứng thất bại: ' + err.message)
    } finally { setSubmitting(false) }
  }

  const tabs: { id: SubTab; label: string; icon: any }[] = [
    { id: 'debt', label: 'Thu công nợ KH', icon: HandCoins },
    { id: 'supplier', label: 'Thanh toán NCC', icon: Truck },
    { id: 'advance', label: 'Tạm ứng NV', icon: UserCog },
  ]

  return (
    <div className="bg-white border border-gray-150 rounded-xl shadow-sm max-w-xl mx-auto overflow-hidden">
      {/* Sub-tab switcher */}
      <div className="flex border-b border-gray-100">
        {tabs.map(t => {
          const Icon = t.icon
          const active = sub === t.id
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-tiny font-bold transition-all ${
                active ? 'text-blue-700 border-b-2 border-blue-500 bg-blue-50/40' : 'text-gray-500 hover:bg-gray-25'
              }`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="p-6">
        {/* ───── THU CÔNG NỢ KH ───── */}
        {sub === 'debt' && (
          <form onSubmit={handleDebtSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className={labelCls}>Khách hàng *</label>
              <select className={inputCls} value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="">-- Chọn khách hàng --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.farm_name || c.name}</option>
                ))}
              </select>
              {customerDebt !== null && (
                <p className={`text-tiny font-semibold mt-1 ${customerDebt > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                  Công nợ hiện tại: {formatCurrency(customerDebt)}
                  {customerDebt > 0 && (
                    <button type="button" onClick={() => setAmount(customerDebt)}
                      className="ml-2 text-blue-600 underline">Thu toàn bộ</button>
                  )}
                </p>
              )}
            </div>
            <CommonFields {...{ method, setMethod, amount, setAmount, date, setDate, refNo, setRefNo, notes, setNotes }} />
            <SubmitBtn submitting={submitting} label="Xác nhận thu công nợ" />
          </form>
        )}

        {/* ───── THANH TOÁN NCC ───── */}
        {sub === 'supplier' && (
          <form onSubmit={handleSupplierSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className={labelCls}>Nhà cung cấp *</label>
              <select className={inputCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">-- Chọn nhà cung cấp --</option>
                {suppliers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
              {supplierDebt !== null && (
                <p className={`text-tiny font-semibold mt-1 ${supplierDebt > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                  Công nợ phải trả: {formatCurrency(supplierDebt)}
                  {supplierDebt > 0 && (
                    <button type="button" onClick={() => setAmount(supplierDebt)}
                      className="ml-2 text-blue-600 underline">Trả toàn bộ</button>
                  )}
                </p>
              )}
            </div>
            <CommonFields {...{ method, setMethod, amount, setAmount, date, setDate, refNo, setRefNo, notes, setNotes }} />
            <SubmitBtn submitting={submitting} label="Xác nhận thanh toán NCC" />
          </form>
        )}

        {/* ───── TẠM ỨNG NV ───── */}
        {sub === 'advance' && (
          <form onSubmit={handleAdvanceSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className={labelCls}>Nhân viên *</label>
              <select className={inputCls} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                <option value="">-- Chọn nhân viên --</option>
                {employees.map(emp => (<option key={emp.id} value={emp.id}>{emp.full_name}</option>))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Số tiền tạm ứng (₫) *</label>
              <input type="number" min="0" value={amount === 0 ? '' : amount} placeholder="0 ₫"
                onChange={e => setAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                className={inputCls + ' text-right tabular-nums font-semibold'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={labelCls}>Ngày tạm ứng</label>
                <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Hạn hoàn ứng</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Lý do tạm ứng *</label>
              <textarea rows={2} value={purpose} onChange={e => setPurpose(e.target.value)}
                placeholder="VD: Đi công tác miền Tây 3 ngày..."
                className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none" />
            </div>
            <p className="text-[10px] text-gray-400 italic">Tạm ứng luôn chi bằng tiền mặt từ quỹ mặc định của chi nhánh.</p>
            <SubmitBtn submitting={submitting} label="Xác nhận tạm ứng" />
          </form>
        )}
      </div>
      {!branchId && (
        <div className="px-6 pb-4 -mt-2">
          <p className="text-tiny text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2">
            ⚠️ Tài khoản của bạn chưa gắn chi nhánh — giao dịch có thể không ghi vào quỹ mặc định.
          </p>
        </div>
      )}
    </div>
  )
}

// ───────────── Sub-components ─────────────
function CommonFields({ method, setMethod, amount, setAmount, date, setDate, refNo, setRefNo, notes, setNotes }: any) {
  return (
    <>
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={labelCls}>Số tiền (₫) *</label>
          <input type="number" min="0" value={amount === 0 ? '' : amount} placeholder="0 ₫"
            onChange={e => setAmount(Math.max(0, parseFloat(e.target.value) || 0))}
            className={inputCls + ' text-right tabular-nums font-semibold'} />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Ngày</label>
          <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div className="space-y-1">
        <label className={labelCls}>Mã chứng từ / Tham chiếu</label>
        <input type="text" value={refNo} onChange={e => setRefNo(e.target.value)}
          placeholder="VD: VCB-1092837..." className={inputCls} />
      </div>
      <div className="space-y-1">
        <label className={labelCls}>Ghi chú</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none" />
      </div>
    </>
  )
}

function SubmitBtn({ submitting, label }: { submitting: boolean; label: string }) {
  return (
    <div className="pt-2">
      <button type="submit" disabled={submitting}
        className="w-full h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all text-body-md disabled:opacity-60">
        {label}
      </button>
    </div>
  )
}
