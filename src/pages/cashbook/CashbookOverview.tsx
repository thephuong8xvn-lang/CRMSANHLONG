import { Clock, AlertTriangle } from 'lucide-react'

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

interface Props {
  formatCurrency: (val: number | null | undefined) => string
  pendingTx: CashbookTransaction[]
  onApprove: (id: string) => Promise<void>
  onCancel: (id: string) => Promise<void>
  submitting: boolean
  profileId?: string
}

/**
 * Tab "Tổng quan" — chỉ còn danh sách Chứng từ chờ duyệt (duyệt/từ chối nhanh).
 * Chặn tự duyệt phiếu do chính mình tạo (khớp RLS).
 */
export default function CashbookOverview({
  formatCurrency,
  pendingTx,
  onApprove,
  onCancel,
  submitting,
  profileId
}: Props) {
  return (
    <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
      <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
        <Clock size={18} className="text-amber-500 animate-spin" style={{ animationDuration: '6s' }} />
        <span>Chứng từ chờ duyệt ({pendingTx.length})</span>
      </h3>

      {pendingTx.length === 0 ? (
        <div className="h-40 flex flex-col items-center justify-center text-gray-400 gap-2 italic text-tiny">
          Không có phiếu chi nào đang chờ phê duyệt.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {pendingTx.map(tx => {
            const isSelfCreated = tx.created_by === profileId

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

      {pendingTx.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-50 flex items-center gap-1.5 text-[10px] text-amber-800 bg-amber-50/50 p-2 rounded border border-amber-100">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          <span>Giao dịch &gt; 10M yêu cầu được duyệt bởi một người quản lý khác người tạo.</span>
        </div>
      )}
    </div>
  )
}
