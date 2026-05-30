import { useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts'
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle
} from 'lucide-react'

interface CashFund {
  id: string
  code: string
  name: string
  balance: number
  currency: string
  is_active: boolean
}

interface BankAccount {
  id: string
  bank_name: string
  account_name: string
  account_no: string
  branch_name: string | null
  balance: number
  currency: string
  is_active: boolean
}

interface CashbookTransaction {
  id: string
  transaction_code: string
  flow_type: 'inflow' | 'outflow' | 'internal_transfer'
  status: 'draft' | 'pending_approval' | 'approved' | 'cancelled'
  amount: number
  transaction_date: string
  description: string
  reference_no: string | null
  created_by: string
  created_at: string
  customer?: {
    name: string
    farm_name: string | null
  }
  supplier?: {
    name: string
  }
  employee?: {
    full_name: string
  }
  creator?: {
    full_name: string
  }
}

interface DayPoint {
  label: string
  inflow: number
  outflow: number
  net: number
}

interface Props {
  cashFunds: CashFund[]
  bankAccounts: BankAccount[]
  formatCurrency: (val: number | null | undefined) => string
  sparklines: Record<string, { date: string; balance: number }[]>
  last7DaysData: DayPoint[]
  pendingTx: CashbookTransaction[]
  onApprove: (id: string) => Promise<void>
  onCancel: (id: string) => Promise<void>
  submitting: boolean
  profileId?: string
}

export default function CashbookOverview({
  cashFunds,
  bankAccounts,
  formatCurrency,
  sparklines,
  last7DaysData,
  pendingTx,
  onApprove,
  onCancel,
  submitting,
  profileId
}: Props) {

  return (
    <div className="space-y-8">
      {/* 1. Cards per Fund / Bank with 30-day Sparklines */}
      <div className="space-y-3">
        <h3 className="text-body-lg font-bold text-gray-750 flex items-center gap-2">
          <Wallet size={18} className="text-blue-500" />
          <span>Biến động số dư 30 ngày gần đây</span>
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Cash Funds */}
          {cashFunds.map(fund => {
            const data = sparklines[fund.id] || []
            const isBalanceUp = data.length > 1 ? data[data.length - 1].balance >= data[0].balance : true;
            
            return (
              <div key={fund.id} className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between h-40">
                <div className="flex justify-between items-start">
                  <div className="truncate flex-1 pr-2">
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-wide">Tiền mặt</span>
                    <h4 className="text-body-md font-bold text-gray-700 mt-1.5 truncate">{fund.name}</h4>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-gray-400 font-medium">Số dư hiện tại</span>
                    <p className="text-body-lg font-bold text-gray-700 tabular-nums">{formatCurrency(fund.balance)}</p>
                  </div>
                </div>

                {/* Sparkline chart */}
                <div className="h-12 w-full mt-2">
                  {data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data}>
                        <Line
                          type="monotone"
                          dataKey="balance"
                          stroke={isBalanceUp ? '#10b981' : '#f97316'}
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-[10px] text-gray-400 italic">Không có dữ liệu biến động</div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Bank Accounts */}
          {bankAccounts.map(bank => {
            const data = sparklines[bank.id] || []
            const isBalanceUp = data.length > 1 ? data[data.length - 1].balance >= data[0].balance : true;

            return (
              <div key={bank.id} className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between h-40">
                <div className="flex justify-between items-start">
                  <div className="truncate flex-1 pr-2">
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase tracking-wide">Ngân hàng</span>
                    <h4 className="text-body-md font-bold text-gray-700 mt-1.5 truncate">{bank.bank_name}</h4>
                    <span className="text-[10px] text-gray-400 font-mono font-medium block mt-0.5">Số TK: ...{bank.account_no.slice(-4)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-gray-400 font-medium">Số dư hiện tại</span>
                    <p className="text-body-lg font-bold text-gray-700 tabular-nums">{formatCurrency(bank.balance)}</p>
                  </div>
                </div>

                {/* Sparkline chart */}
                <div className="h-12 w-full mt-2">
                  {data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data}>
                        <Line
                          type="monotone"
                          dataKey="balance"
                          stroke={isBalanceUp ? '#3b82f6' : '#f97316'}
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-[10px] text-gray-400 italic">Không có dữ liệu biến động</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 2. Grid for 7-day Bar Chart and Pending Approvals */}
      <div className="grid grid-cols-12 gap-6 items-start">
        
        {/* 7-day Flow Chart (7 cols) */}
        <div className="col-span-12 lg:col-span-7 bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
          <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-500" />
            <span>Dòng tiền thu / chi 7 ngày qua</span>
          </h3>

          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={last7DaysData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9aa4b2' }} />
              <YAxis
                tick={{ fontSize: 11, fill: '#9aa4b2' }}
                width={56}
                tickFormatter={(v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${(v / 1e3).toFixed(0)}k`)}
              />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v))} labelFormatter={(l) => `Ngày ${l}`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="inflow" name="Thu" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="outflow" name="Chi" fill="#f97316" radius={[3, 3, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pending Approval List (5 cols) */}
        <div className="col-span-12 lg:col-span-5 bg-white border border-gray-150 rounded-xl p-5 shadow-sm min-h-[330px] flex flex-col justify-between">
          <div>
            <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
              <Clock size={18} className="text-amber-500 animate-spin" style={{ animationDuration: '6s' }} />
              <span>Chứng từ chờ duyệt ({pendingTx.length})</span>
            </h3>

            {pendingTx.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-gray-400 gap-2 italic text-tiny">
                Không có phiếu chi nào đang chờ phê duyệt.
              </div>
            ) : (
              <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
                {pendingTx.map(tx => {
                  const isSelfCreated = tx.created_by === profileId
                  
                  // Target description
                  let counterparty = 'Khách lẻ / Khác'
                  if (tx.customer) counterparty = tx.customer.farm_name || tx.customer.name
                  else if (tx.supplier) counterparty = tx.supplier.name
                  else if (tx.employee) counterparty = tx.employee.full_name

                  return (
                    <div key={tx.id} className="p-3 bg-gray-50 border border-gray-100 rounded-lg space-y-2 hover:bg-gray-100 transition-colors">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-tiny font-bold font-mono text-blue-600">{tx.transaction_code || 'SQ-PENDING'}</span>
                          <span className="text-[10px] text-gray-400 block mt-0.5">Người lập: {tx.creator?.full_name || 'Hệ thống'}</span>
                        </div>
                        <span className="text-tiny font-bold text-orange-650 tabular-nums">-{formatCurrency(tx.amount)}</span>
                      </div>

                      <div className="text-[11px] text-gray-600 bg-white p-2 rounded border border-gray-50 leading-relaxed">
                        <p className="font-semibold text-gray-700 truncate">{counterparty}</p>
                        <p className="text-gray-400 text-[10px] mt-0.5 truncate">{tx.description}</p>
                      </div>

                      {/* Action buttons */}
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          onClick={() => onCancel(tx.id)}
                          disabled={submitting}
                          className="h-7 px-2.5 border border-red-200 text-red-650 hover:bg-red-50 rounded text-[11px] font-bold transition-all"
                        >
                          Từ chối
                        </button>
                        
                        <div className="relative group">
                          <button
                            onClick={() => onApprove(tx.id)}
                            disabled={submitting || isSelfCreated}
                            className={`h-7 px-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-[11px] font-bold transition-all active:scale-95 shadow-sm ${
                              isSelfCreated ? 'opacity-40 cursor-not-allowed' : ''
                            }`}
                          >
                            Phê duyệt
                          </button>
                          {isSelfCreated && (
                            <span className="absolute bottom-full right-0 mb-1 hidden group-hover:block bg-gray-800 text-white text-[9px] px-2 py-1 rounded shadow-md whitespace-nowrap z-10">
                              Bạn không thể tự duyệt phiếu do mình tạo
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {pendingTx.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-50 flex items-center gap-1.5 text-[10px] text-amber-800 bg-amber-50/50 p-2 rounded border border-amber-100">
              <AlertTriangle size={14} className="text-amber-500 shrink-0" />
              <span>Giao dịch &gt; 10M yêu cầu được duyệt bởi một người quản lý khác người tạo.</span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
