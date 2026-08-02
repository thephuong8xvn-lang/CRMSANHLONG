import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Receipt,
  Wallet,
  X,
  ExternalLink,
  AlertTriangle,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { qk } from '../../lib/queryClient'
import {
  useCustomerDebts,
  type CustomerSummaryRow,
} from '../../hooks/queries/useCustomers'
import { fetchCustomerStatement, type StatementRow } from '../../lib/customerStatement'
import ExportDebtStatementModal from './ExportDebtStatementModal'
import CollectDebtModal from './CollectDebtModal'

type QuickTab = 'ledger' | 'debts'

interface CustomerQuickViewProps {
  customer: CustomerSummaryRow
  onClose: () => void
  onOpenDetail: () => void
}

const DEBT_TYPE_LABEL: Record<string, string> = {
  order_debt: 'Nợ đơn hàng',
  advance_from_customer: 'Khách trả trước',
  refund_due: 'Phải hoàn trả',
}

const KIND_BADGE: Record<StatementRow['kind'], string> = {
  invoice: 'bg-blue-50 text-blue-700 border-blue-100',
  payment: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  return: 'bg-purple-50 text-purple-700 border-purple-100',
  adjustment: 'bg-amber-50 text-amber-700 border-amber-100',
  advance: 'bg-gray-50 text-gray-500 border-gray-150',
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
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<QuickTab>('ledger')
  const [showExport, setShowExport] = useState(false)
  const [showCollect, setShowCollect] = useState(false)
  const [collectMsg, setCollectMsg] = useState('')

  // Sổ chi tiết giao dịch đầy đủ (tái dùng builder dùng chung với trang chi tiết)
  const [rows, setRows] = useState<StatementRow[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [closing, setClosing] = useState(0)

  const debtsQuery = useCustomerDebts(customer.id, tab === 'debts')

  const todayStr = new Date().toISOString().split('T')[0]
  const debts = debtsQuery.data ?? []
  const unsettled = debts.filter(d => !d.is_settled)
  const overdueCount = unsettled.filter(d => d.due_date && d.due_date < todayStr).length
  // Nguồn sự thật công nợ = customer_summary_view.total_debt (đồng bộ mọi nơi)
  const currentDebt = Number(customer.total_debt || 0)
  // Gate theo PERMISSION (pilot) — khớp guard server fn_collect_customer_debt.
  const canCollect = hasPermission('customers.collect_debt')

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true)
    try {
      const fromISO = '1970-01-01T00:00:00.000Z'
      const to = new Date(); to.setHours(23, 59, 59, 999)
      const st = await fetchCustomerStatement(customer.id, fromISO, to.toISOString())
      // Mới nhất lên đầu, giới hạn 30 dòng cho gọn
      setRows([...st.rows].reverse().slice(0, 30))
      setClosing(st.closing)
    } catch {
      setRows([])
    } finally {
      setLedgerLoading(false)
    }
  }, [customer.id])

  useEffect(() => {
    if (tab === 'ledger') loadLedger()
  }, [tab, loadLedger])

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: qk.customers.debts(customer.id) })
    queryClient.invalidateQueries({ queryKey: qk.customers.all })
    queryClient.invalidateQueries({ queryKey: ['customers', 'kpis'] })
    loadLedger()
  }

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
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-100 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-bold text-gray-800 truncate">{customer.farm_name}</span>
          <span className="px-2 py-0.5 bg-gray-50 border border-gray-100 text-blue-600 text-[10px] font-bold rounded uppercase shrink-0">
            {customer.code || '—'}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 tabular-nums ${
            customer.is_overdue ? 'bg-red-50 text-red-600 border border-red-100' : currentDebt > 0 ? 'bg-orange-50 text-orange-700 border border-orange-100' : currentDebt < 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-gray-50 text-gray-600 border border-gray-100'
          }`}>
            {currentDebt < 0 ? `Trả trước: ${formatCurrency(-currentDebt)}` : `Nợ: ${formatCurrency(currentDebt)}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canCollect && (
            <button
              onClick={() => { setCollectMsg(''); setShowCollect(true) }}
              className="h-8 px-3 bg-emerald-500 text-white rounded text-tiny font-bold hover:bg-emerald-600 active:scale-95 shadow-sm transition-all flex items-center gap-1.5"
              title={currentDebt > 0 ? 'Thu công nợ — ghi vào sổ quỹ' : 'Ghi nhận khách trả tiền (thu trước) — ghi vào sổ quỹ'}
            >
              <Wallet size={13} />
              {currentDebt > 0 ? 'Thu nợ' : 'Thu / Trả trước'}
            </button>
          )}
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
      <div className="flex border-b border-gray-100 bg-white px-2 overflow-x-auto tbl-x">
        <TabButton id="ledger" icon={<Receipt size={14} />} label="Sổ chi tiết giao dịch" />
        <TabButton id="debts" icon={<Wallet size={14} />} label="Công nợ" badge={overdueCount} />
      </div>

      {/* Content */}
      <div className="p-4">
        {collectMsg && (
          <div className="mb-3 flex items-start gap-2 text-tiny text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>{collectMsg}</span>
          </div>
        )}

        {/* ── Sổ chi tiết giao dịch ── */}
        {tab === 'ledger' && (
          ledgerLoading ? <Spinner /> : (
            rows.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-tiny flex flex-col items-center gap-2">
                <Receipt size={28} className="text-gray-300" />
                Khách hàng chưa phát sinh giao dịch nào.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="overflow-x-auto tbl-x border border-gray-100 rounded-lg bg-white">
                  <table className="w-full text-left text-[12px] border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold text-[10px] uppercase tracking-wider">
                        <th className="p-2.5">Thời gian</th>
                        <th className="p-2.5">Mã chứng từ</th>
                        <th className="p-2.5">Loại</th>
                        <th className="p-2.5">Người lập</th>
                        <th className="p-2.5">Chi nhánh</th>
                        <th className="p-2.5 text-right">Ghi nợ</th>
                        <th className="p-2.5 text-right">Ghi có</th>
                        <th className="p-2.5 text-right">Dư nợ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-600">
                      {rows.map((r, i) => {
                        const canOpen = !!r.refId && (r.kind === 'invoice' || r.kind === 'return' || r.kind === 'payment')
                        return (
                          <tr key={`${r.code}-${i}`} className={r.info ? 'bg-amber-25/40' : 'hover:bg-gray-50/50'}>
                            <td className="p-2.5 whitespace-nowrap tabular-nums text-[11px] text-gray-500">
                              {new Date(r.date).toLocaleDateString('vi-VN')}
                            </td>
                            <td className="p-2.5 font-mono font-semibold">
                              {canOpen ? (
                                <button onClick={() => navigate(`/orders/${r.refId}`)} className="text-blue-600 hover:underline" title="Xem chi tiết">{r.code}</button>
                              ) : <span className="text-gray-500">{r.code}</span>}
                            </td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${KIND_BADGE[r.kind]}`}>{r.typeLabel}</span>
                            </td>
                            <td className="p-2.5 whitespace-nowrap text-[11px] text-gray-600" title={r.createdBy}>{r.createdBy}</td>
                            <td className="p-2.5 whitespace-nowrap text-[11px] text-gray-500" title={r.branchName}>{r.branchName}</td>
                            <td className="p-2.5 text-right tabular-nums font-semibold text-red-600">{r.debit ? formatCurrency(r.debit) : '—'}</td>
                            <td className="p-2.5 text-right tabular-nums font-semibold text-emerald-600">{r.credit ? formatCurrency(r.credit) : '—'}</td>
                            <td className="p-2.5 text-right tabular-nums font-bold text-gray-700">{r.info ? '—' : formatCurrency(r.balance)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-gray-400 italic">30 giao dịch gần nhất — xem đầy đủ ở trang chi tiết.</p>
                  <span className={`text-tiny font-bold tabular-nums ${closing > 0 ? 'text-orange-600' : closing < 0 ? 'text-emerald-600' : 'text-gray-600'}`}>
                    Dư nợ cuối: {closing < 0 ? `${formatCurrency(-closing)} (trả trước)` : formatCurrency(closing)}
                  </span>
                </div>
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
                  <span className={`font-bold tabular-nums ${currentDebt > 0 ? 'text-gray-800' : 'text-emerald-600'}`}>{currentDebt < 0 ? `${formatCurrency(-currentDebt)} (trả trước)` : formatCurrency(currentDebt)}</span>
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
                <div className="overflow-x-auto tbl-x border border-gray-100 rounded-lg bg-white">
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
                <p className="text-[10px] text-gray-400 italic">
                  {canCollect ? 'Thu tiền sẽ tự ghi vào sổ quỹ & giảm công nợ.' : 'Cần quyền kế toán/quản lý để thu nợ.'}
                </p>
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

      {showCollect && (
        <CollectDebtModal
          customer={{ id: customer.id, name: customer.farm_name, code: customer.code || undefined }}
          currentDebt={currentDebt}
          onClose={() => setShowCollect(false)}
          onSuccess={(msg) => {
            setShowCollect(false)
            setCollectMsg(msg)
            refetchAll()
          }}
        />
      )}
    </div>
  )
}
