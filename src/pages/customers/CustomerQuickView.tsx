import { useState } from 'react'
import {
  Receipt,
  Wallet,
  X,
  ExternalLink,
  AlertTriangle,
  FileSpreadsheet,
} from 'lucide-react'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import {
  useCustomerOrders,
  useCustomerDebts,
  type CustomerSummaryRow,
} from '../../hooks/queries/useCustomers'
import ExportDebtStatementModal from './ExportDebtStatementModal'

type QuickTab = 'orders' | 'debts'

interface CustomerQuickViewProps {
  customer: CustomerSummaryRow
  onClose: () => void
  onOpenDetail: () => void
}

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  draft:            { label: 'Nháp',          cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  confirmed:        { label: 'Đã xác nhận',   cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  shipping:         { label: 'Đang giao',     cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  delivered:        { label: 'Đã giao',       cls: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  paid:             { label: 'Đã thanh toán', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  completed:        { label: 'Hoàn tất',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  cancelled:        { label: 'Đã hủy',        cls: 'bg-red-50 text-red-600 border-red-100' },
  returned_partial: { label: 'Trả 1 phần',   cls: 'bg-orange-50 text-orange-700 border-orange-100' },
}

const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  unpaid:         { label: 'Chưa TT',  cls: 'bg-red-50 text-red-600' },
  partially_paid: { label: 'TT 1 phần', cls: 'bg-amber-50 text-amber-700' },
  paid:           { label: 'Đã TT đủ', cls: 'bg-emerald-50 text-emerald-700' },
}

const DEBT_TYPE_LABEL: Record<string, string> = {
  order_debt: 'Nợ đơn hàng',
  advance_from_customer: 'Khách trả trước',
  refund_due: 'Phải hoàn trả',
}

function Spinner() {
  return (
    <div className="py-10 flex justify-center">
      <div className="w-7 h-7 border-2 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
}

export default function CustomerQuickView({ customer, onClose, onOpenDetail }: CustomerQuickViewProps) {
  const { formatCurrency } = useDisplaySettings()
  const [tab, setTab] = useState<QuickTab>('orders')
  const [showExport, setShowExport] = useState(false)

  const ordersQuery = useCustomerOrders(customer.id, tab === 'orders')
  const debtsQuery = useCustomerDebts(customer.id, tab === 'debts')

  const todayStr = new Date().toISOString().split('T')[0]
  const debts = debtsQuery.data ?? []
  const unsettled = debts.filter(d => !d.is_settled)
  const outstanding = unsettled.reduce((s, d) => s + Number(d.amount || 0), 0)
  const overdueCount = unsettled.filter(d => d.due_date && d.due_date < todayStr).length

  const TabButton = ({ id, icon, label, badge }: { id: QuickTab; icon: React.ReactNode; label: string; badge?: number }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3.5 py-2.5 text-tiny font-semibold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
        tab === id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
      }`}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-0.5 px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full">{badge}</span>
      )}
    </button>
  )

  return (
    <div className="bg-gray-25 border border-gray-150 rounded-lg overflow-hidden animate-in fade-in duration-150 my-1">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-bold text-gray-800 truncate">{customer.farm_name}</span>
          <span className="px-2 py-0.5 bg-gray-50 border border-gray-100 text-blue-600 text-[10px] font-bold rounded uppercase shrink-0">
            {customer.code || '—'}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 tabular-nums ${
            customer.is_overdue ? 'bg-red-50 text-red-600 border border-red-100' : Number(customer.total_debt) > 0 ? 'bg-gray-50 text-gray-600 border border-gray-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
          }`}>
            Nợ: {formatCurrency(Number(customer.total_debt || 0))}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onOpenDetail}
            className="h-8 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-gray-700 flex items-center gap-1.5 transition-all"
          >
            <ExternalLink size={13} className="text-blue-500" />
            Mở trang chi tiết
          </button>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-all" title="Đóng">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 bg-white px-2 overflow-x-auto">
        <TabButton id="orders" icon={<Receipt size={14} />} label="Lịch sử giao dịch" />
        <TabButton id="debts" icon={<Wallet size={14} />} label="Công nợ" badge={overdueCount} />
      </div>

      {/* Content */}
      <div className="p-4">
        {/* ── Lịch sử giao dịch ── */}
        {tab === 'orders' && (
          ordersQuery.isLoading ? <Spinner /> : (
            (ordersQuery.data ?? []).length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-tiny flex flex-col items-center gap-2">
                <Receipt size={28} className="text-gray-300" />
                Khách hàng chưa có đơn hàng nào.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="overflow-x-auto border border-gray-100 rounded-lg bg-white">
                  <table className="w-full text-left text-[12px] border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold text-[10px] uppercase tracking-wider">
                        <th className="p-2.5">Mã đơn</th>
                        <th className="p-2.5">Thời gian</th>
                        <th className="p-2.5 text-right">Giá trị</th>
                        <th className="p-2.5">Trạng thái</th>
                        <th className="p-2.5">Thanh toán</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-600">
                      {(ordersQuery.data ?? []).map(o => {
                        const st = ORDER_STATUS[o.status] || { label: o.status, cls: 'bg-gray-50 text-gray-600 border-gray-200' }
                        const pm = PAYMENT_STATUS[o.payment_status]
                        return (
                          <tr key={o.id} className="hover:bg-gray-50/50">
                            <td className="p-2.5 font-mono font-semibold text-blue-600">{o.order_code}</td>
                            <td className="p-2.5 whitespace-nowrap tabular-nums text-[11px] text-gray-500">
                              {new Date(o.created_at).toLocaleDateString('vi-VN')}
                            </td>
                            <td className="p-2.5 text-right font-bold tabular-nums text-gray-700">{formatCurrency(Number(o.grand_total || 0))}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                            </td>
                            <td className="p-2.5">
                              {pm ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${pm.cls}`}>{pm.label}</span> : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-400 italic">Chỉ hiển thị 20 đơn gần nhất — xem đầy đủ ở trang chi tiết.</p>
              </div>
            )
          )
        )}

        {/* ── Công nợ ── */}
        {tab === 'debts' && (
          debtsQuery.isLoading ? <Spinner /> : (
            <div className="space-y-3">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white border border-gray-100 rounded-lg p-3">
                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Dư nợ hiện tại</span>
                  <span className={`font-bold tabular-nums ${outstanding > 0 ? 'text-gray-800' : 'text-emerald-600'}`}>{formatCurrency(outstanding)}</span>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-3">
                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Hạn mức công nợ</span>
                  <span className="font-bold tabular-nums text-gray-700">{formatCurrency(Number(customer.credit_limit || 0))}</span>
                </div>
                <div className={`border rounded-lg p-3 ${overdueCount > 0 ? 'bg-red-50/40 border-red-100' : 'bg-white border-gray-100'}`}>
                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Khoản quá hạn</span>
                  <span className={`font-bold tabular-nums flex items-center gap-1 ${overdueCount > 0 ? 'text-red-600' : 'text-gray-700'}`}>
                    {overdueCount > 0 && <AlertTriangle size={13} />}{overdueCount}
                  </span>
                </div>
              </div>

              {/* Debt list */}
              {unsettled.length === 0 ? (
                <div className="py-6 text-center text-gray-400 text-tiny">Khách hàng không có công nợ chưa tất toán.</div>
              ) : (
                <div className="overflow-x-auto border border-gray-100 rounded-lg bg-white">
                  <table className="w-full text-left text-[12px] border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold text-[10px] uppercase tracking-wider">
                        <th className="p-2.5">Loại</th>
                        <th className="p-2.5">Ngày ghi nhận</th>
                        <th className="p-2.5">Hạn thanh toán</th>
                        <th className="p-2.5 text-right">Số tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-600">
                      {unsettled.map(d => {
                        const isOverdue = d.due_date && d.due_date < todayStr
                        return (
                          <tr key={d.id} className="hover:bg-gray-50/50">
                            <td className="p-2.5 font-semibold text-gray-700">{DEBT_TYPE_LABEL[d.debt_type || ''] || 'Công nợ'}</td>
                            <td className="p-2.5 tabular-nums text-[11px] text-gray-500">{new Date(d.created_at).toLocaleDateString('vi-VN')}</td>
                            <td className={`p-2.5 tabular-nums text-[11px] font-semibold ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                              {d.due_date ? new Date(d.due_date).toLocaleDateString('vi-VN') : '—'}
                              {isOverdue && <span className="ml-1 text-[9px]">(quá hạn)</span>}
                            </td>
                            <td className="p-2.5 text-right font-bold tabular-nums text-gray-700">{formatCurrency(Number(d.amount || 0))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={() => setShowExport(true)}
                  className="h-8 px-3 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-tiny font-bold hover:bg-emerald-100 transition-all flex items-center gap-1.5"
                >
                  <FileSpreadsheet size={14} />
                  Xuất file công nợ
                </button>
                <p className="text-[10px] text-gray-400 italic">Điều chỉnh / thu công nợ tại trang chi tiết khách hàng.</p>
              </div>
            </div>
          )
        )}
      </div>

      {showExport && (
        <ExportDebtStatementModal
          customer={{ id: customer.id, name: customer.farm_name, code: customer.code || undefined }}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}
