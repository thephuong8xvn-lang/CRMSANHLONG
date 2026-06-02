import { useState, useEffect, useCallback, useMemo } from 'react'
import { Download, ArrowUpRight, ArrowDownRight, ArrowLeftRight, TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import { startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns'
import { supabase } from '../../lib/supabase'

interface FundLite { id: string; name: string; balance: number }
interface BankLite { id: string; bank_name: string; account_no: string; balance: number }

interface Props {
  cashFunds: FundLite[]
  bankAccounts: BankLite[]
  formatCurrency: (val: number | null | undefined) => string
}

type Preset = 'today' | 'week' | 'month' | 'quarter' | 'year'
type FlowClass = 'thu' | 'chi' | 'transfer' | 'internal'

interface RawTx {
  transaction_code: string | null
  transaction_date: string
  flow_type: 'inflow' | 'outflow' | 'internal_transfer'
  amount: number
  description: string
  reference_no: string | null
  source_table: string | null
  cash_fund_id: string | null
  bank_account_id: string | null
  created_at: string
  expense_category: { name: string; is_internal: boolean | null } | null
}

interface Row extends RawTx {
  cls: FlowClass
  delta: number          // +inflow / −outflow
  runningBalance: number // số dư thật của scope sau giao dịch này
}

const TRANSFER_SOURCES = ['internal_transfer_in', 'internal_transfer_out']

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'week', label: 'Tuần này' },
  { key: 'month', label: 'Tháng này' },
  { key: 'quarter', label: 'Quý này' },
  { key: 'year', label: 'Năm nay' },
]

function presetFrom(preset: Preset): string {
  const now = new Date()
  const d =
    preset === 'today' ? startOfDay(now) :
    preset === 'week' ? startOfWeek(now, { weekStartsOn: 1 }) :
    preset === 'month' ? startOfMonth(now) :
    preset === 'quarter' ? startOfQuarter(now) :
    startOfYear(now)
  return d.toLocaleDateString('en-CA')
}

function classify(t: RawTx): FlowClass {
  if (t.source_table && TRANSFER_SOURCES.includes(t.source_table)) return 'transfer'
  if (t.expense_category?.is_internal) return 'internal'   // nộp quỹ / lệch quỹ — luân chuyển nội bộ
  return t.flow_type === 'inflow' ? 'thu' : 'chi'
}

const CLS_META: Record<FlowClass, { label: string; cls: string; icon: any }> = {
  thu:      { label: 'Thu',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: ArrowUpRight },
  chi:      { label: 'Chi',        cls: 'bg-orange-50 text-orange-700 border-orange-100',     icon: ArrowDownRight },
  transfer: { label: 'Chuyển quỹ', cls: 'bg-blue-50 text-blue-700 border-blue-100',           icon: ArrowLeftRight },
  internal: { label: 'Nội bộ',     cls: 'bg-purple-50 text-purple-700 border-purple-100',     icon: ArrowLeftRight },
}

/**
 * "Lịch sử dòng tiền" — danh sách biến động tiền + số dư lũy kế (phục vụ đóng ca).
 * 2 nhóm tick kết hợp AND: (A) loại tiền {Tiền mặt, Chuyển khoản}, (B) loại biến
 * động {Thu, Chi, Chuyển quỹ}. Số dư lũy kế tính trên TẤT CẢ giao dịch trong
 * scope tài khoản (A) → luôn khớp số dư quỹ thật, kể cả khi ẩn bớt dòng theo (B).
 */
export default function CashbookReports({ cashFunds, bankAccounts, formatCurrency }: Props) {
  const [preset, setPreset] = useState<Preset>('today')
  // (A) loại tiền — mặc định Tiền mặt
  const [showCash, setShowCash] = useState(true)
  const [showBank, setShowBank] = useState(false)
  // (B) loại biến động — mặc định cả 4
  const [showThu, setShowThu] = useState(true)
  const [showChi, setShowChi] = useState(true)
  const [showTransfer, setShowTransfer] = useState(true)
  const [showInternal, setShowInternal] = useState(true)

  const [raw, setRaw] = useState<RawTx[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const fromDate = useMemo(() => presetFrom(preset), [preset])

  // Scope tài khoản theo nhóm (A)
  const scope = useMemo(() => {
    const fundIds = showCash ? cashFunds.map(f => f.id) : []
    const bankIds = showBank ? bankAccounts.map(b => b.id) : []
    const balanceNow =
      (showCash ? cashFunds.reduce((s, f) => s + Number(f.balance), 0) : 0) +
      (showBank ? bankAccounts.reduce((s, b) => s + Number(b.balance), 0) : 0)
    return { fundIds, bankIds, balanceNow, empty: fundIds.length === 0 && bankIds.length === 0 }
  }, [showCash, showBank, cashFunds, bankAccounts])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (scope.empty) { setRaw([]); return }
      const parts: string[] = []
      if (scope.fundIds.length > 0) parts.push(`cash_fund_id.in.(${scope.fundIds.join(',')})`)
      if (scope.bankIds.length > 0) parts.push(`bank_account_id.in.(${scope.bankIds.join(',')})`)

      const { data, error } = await supabase
        .from('cashbook_transactions')
        .select('transaction_code, transaction_date, flow_type, amount, description, reference_no, source_table, cash_fund_id, bank_account_id, created_at, expense_category:expense_categories(name, is_internal)')
        .eq('status', 'approved')
        .gte('transaction_date', fromDate)
        .or(parts.join(','))
        .order('transaction_date', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      setRaw((data || []) as unknown as RawTx[])
    } catch {
      setRaw([])
    } finally {
      setLoading(false)
    }
  }, [scope, fromDate])

  useEffect(() => { load() }, [load])

  // Tính số dư lũy kế trên TẤT CẢ dòng scope (ascending), rồi mới lọc theo nhóm (B).
  const rows = useMemo<Row[]>(() => {
    if (raw.length === 0) return []
    const withDelta = raw.map(t => ({
      ...t,
      cls: classify(t),
      delta: t.flow_type === 'inflow' ? Number(t.amount) : -Number(t.amount),
    }))
    const totalDelta = withDelta.reduce((s, t) => s + t.delta, 0)
    // Số dư đầu kỳ = số dư hiện tại − tổng biến động trong kỳ
    let running = scope.balanceNow - totalDelta
    const all: Row[] = withDelta.map(t => {
      running += t.delta
      return { ...t, runningBalance: running }
    })
    return all.reverse() // hiển thị mới nhất trước
  }, [raw, scope.balanceNow])

  // Lọc hiển thị theo nhóm (B)
  const visible = useMemo(() => rows.filter(r =>
    (r.cls === 'thu' && showThu) || (r.cls === 'chi' && showChi) ||
    (r.cls === 'transfer' && showTransfer) || (r.cls === 'internal' && showInternal)
  ), [rows, showThu, showChi, showTransfer, showInternal])

  // Tổng thu/chi VẬN HÀNH (loại transfer + nội bộ để không thổi phồng)
  const totalThu = visible.filter(r => r.cls === 'thu').reduce((s, r) => s + Number(r.amount), 0)
  const totalChi = visible.filter(r => r.cls === 'chi').reduce((s, r) => s + Number(r.amount), 0)

  // Tổng theo hạng mục (chỉ thu/chi vận hành) cho kỳ đang chọn
  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; cls: FlowClass; amount: number }>()
    visible.filter(r => r.cls === 'thu' || r.cls === 'chi').forEach(r => {
      const name = r.expense_category?.name || (r.cls === 'thu' ? 'Thu khác' : 'Chi khác')
      const key = `${r.cls}::${name}`
      const cur = map.get(key) || { name, cls: r.cls, amount: 0 }
      cur.amount += Number(r.amount)
      map.set(key, cur)
    })
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [visible])

  const handleExport = () => {
    setExporting(true)
    try {
      const header = ['STT', 'Ngày', 'Số phiếu', 'Diễn giải', 'Loại', 'Thu', 'Chi', 'Số dư']
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
      // Xuất theo thứ tự thời gian (đảo lại ascending) để khớp số dư lũy kế
      const ordered = [...visible].reverse()
      const lines = ordered.map((r, i) => [
        i + 1,
        new Date(r.transaction_date).toLocaleDateString('vi-VN'),
        r.transaction_code || '',
        esc(r.description),
        CLS_META[r.cls].label,
        r.cls === 'thu' ? Number(r.amount) : 0,
        r.cls === 'chi' ? Number(r.amount) : 0,
        Math.round(r.runningBalance),
      ].join(','))
      const csv = '﻿' + [header.join(','), ...lines].join('\r\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lich-su-dong-tien_${fromDate}_den_${new Date().toLocaleDateString('en-CA')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Thanh điều khiển: khoảng thời gian + xuất */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg shadow-inner">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              className={`px-3.5 py-1.5 rounded-md text-tiny font-semibold transition-all ${
                preset === p.key ? 'bg-red-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={handleExport} disabled={exporting || visible.length === 0}
          className="h-9 px-3 border border-gray-200 text-gray-600 rounded-lg font-semibold text-tiny flex items-center gap-1.5 hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-50">
          <Download size={14} />
          {exporting ? 'Đang xuất...' : 'Xuất CSV'}
        </button>
      </div>

      {/* Bộ lọc 2 nhóm tick */}
      <div className="bg-white border border-gray-150 rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <FilterGroup title="Loại tiền">
          <Tick label="Tiền mặt" checked={showCash} onChange={setShowCash} color="emerald" />
          <Tick label="Chuyển khoản" checked={showBank} onChange={setShowBank} color="blue" />
        </FilterGroup>
        <div className="w-px h-6 bg-gray-150 hidden sm:block" />
        <FilterGroup title="Loại biến động">
          <Tick label="Thu" checked={showThu} onChange={setShowThu} color="emerald" />
          <Tick label="Chi" checked={showChi} onChange={setShowChi} color="orange" />
          <Tick label="Chuyển quỹ" checked={showTransfer} onChange={setShowTransfer} color="blue" />
          <Tick label="Nội bộ / Nộp quỹ" checked={showInternal} onChange={setShowInternal} color="purple" />
        </FilterGroup>
      </div>

      {/* Tổng theo hạng mục (thu/chi vận hành) cho kỳ đang chọn */}
      {byCategory.length > 0 && (
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm p-4">
          <h3 className="text-tiny font-bold text-gray-500 uppercase tracking-wider mb-2">Tổng theo hạng mục ({PRESETS.find(p => p.key === preset)?.label})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {byCategory.map((g, i) => (
              <div key={i} className="flex justify-between items-center bg-gray-25 border border-gray-100 rounded-lg px-3 py-2">
                <span className="text-tiny text-gray-600 truncate pr-2">{g.name}</span>
                <span className={`text-tiny font-bold tabular-nums shrink-0 ${g.cls === 'thu' ? 'text-emerald-600' : 'text-orange-600'}`}>
                  {g.cls === 'thu' ? '+' : '−'}{formatCurrency(g.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tổng hợp */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Tổng thu (đang xem)" value={formatCurrency(totalThu)} icon={TrendingUp} tone="emerald" />
        <KpiCard label="Tổng chi (đang xem)" value={formatCurrency(totalChi)} icon={TrendingDown} tone="orange" />
        <KpiCard label="Số dư hiện tại" value={formatCurrency(scope.balanceNow)} icon={Wallet} tone="blue" />
      </div>

      {/* Danh sách biến động + số dư lũy kế */}
      <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                <th className="px-4 py-3">Ngày</th>
                <th className="px-4 py-3">Loại</th>
                <th className="px-4 py-3">Diễn giải / Lý do</th>
                <th className="px-4 py-3 text-right">Số tiền</th>
                <th className="px-4 py-3 text-right">Số dư lũy kế</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-tiny text-gray-400 italic">Đang tải dữ liệu...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-tiny text-gray-400 italic">Không có biến động nào khớp bộ lọc.</td></tr>
              ) : visible.map((r, i) => {
                const meta = CLS_META[r.cls]
                const Icon = meta.icon
                const isUp = r.delta >= 0
                return (
                  <tr key={`${r.transaction_code}-${i}`} className="hover:bg-gray-25">
                    <td className="px-4 py-3 whitespace-nowrap text-tiny tabular-nums text-gray-500">
                      {new Date(r.transaction_date).toLocaleDateString('vi-VN')}
                      <span className="block text-[10px] text-gray-300 font-mono">{r.transaction_code || ''}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.cls}`}>
                        <Icon size={11} />{meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-tiny text-gray-600 max-w-[360px]">
                      {r.expense_category?.name && <span className="text-[10px] font-bold text-gray-500 block">{r.expense_category.name}</span>}
                      <p className="truncate" title={r.description}>{r.description}</p>
                      {r.reference_no && <span className="text-[10px] text-gray-400">Tham chiếu: {r.reference_no}</span>}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-bold ${isUp ? 'text-emerald-600' : 'text-orange-600'}`}>
                      {isUp ? '+' : '−'}{formatCurrency(Number(r.amount))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-700">
                      {formatCurrency(r.runningBalance)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {visible.length > 0 && (
          <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 italic">
            Số dư lũy kế phản ánh đúng số dư thật của {showCash && showBank ? 'quỹ + tài khoản' : showCash ? 'quỹ tiền mặt' : 'tài khoản ngân hàng'} đang chọn sau mỗi giao dịch — dùng để đối chiếu đóng ca.
          </div>
        )}
      </div>
    </div>
  )
}

// ───────────── Sub-components ─────────────
function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{title}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function Tick({ label, checked, onChange, color }: { label: string; checked: boolean; onChange: (v: boolean) => void; color: 'emerald' | 'orange' | 'blue' | 'purple' }) {
  const onCls: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  }
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`h-8 px-3 rounded-lg border text-tiny font-semibold transition-all flex items-center gap-1.5 ${
        checked ? onCls[color] : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-25'
      }`}>
      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${
        checked ? 'bg-current border-current text-white' : 'border-gray-300'
      }`}>
        {checked && '✓'}
      </span>
      {label}
    </button>
  )
}

function KpiCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone: 'emerald' | 'orange' | 'blue' }) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
  }
  return (
    <div className="bg-white border border-gray-150 rounded-xl p-4 shadow-sm flex justify-between items-start">
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
        <h2 className="text-[20px] font-bold text-gray-700 tabular-nums">{value}</h2>
      </div>
      <div className={`px-2 py-1 rounded-md border ${tones[tone]}`}><Icon size={15} /></div>
    </div>
  )
}
