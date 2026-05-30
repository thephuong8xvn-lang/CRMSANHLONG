import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Line, ComposedChart,
} from 'recharts'
import { Download, TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface FundLite { id: string; name: string; balance: number }
interface BankLite { id: string; bank_name: string; account_no: string; balance: number }

interface Props {
  cashFunds: FundLite[]
  bankAccounts: BankLite[]
  fundIds: string[]
  bankIds: string[]
  formatCurrency: (val: number | null | undefined) => string
}

interface DayPoint { date: string; label: string; inflow: number; outflow: number; net: number }

/**
 * AUDIT-2026-05-30 — Sprint S2.6
 * Báo cáo dòng tiền: (1) biểu đồ thu/chi/ròng theo ngày, (2) bảng số dư
 * quỹ/TK, (5) xuất sổ quỹ CSV (UTF-8 BOM, mở được Excel).
 */
export default function CashbookReports({ cashFunds, bankAccounts, fundIds, bankIds, formatCurrency }: Props) {
  const [days, setDays] = useState<DayPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [rangeDays, setRangeDays] = useState(30)
  const [exporting, setExporting] = useState(false)

  const accountFilter = useMemo(() => {
    const parts: string[] = []
    if (fundIds.length > 0) parts.push(`cash_fund_id.in.(${fundIds.join(',')})`)
    if (bankIds.length > 0) parts.push(`bank_account_id.in.(${bankIds.join(',')})`)
    return parts.join(',')
  }, [fundIds, bankIds])

  const fromDate = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - (rangeDays - 1))
    return d.toLocaleDateString('en-CA')
  }, [rangeDays])

  const loadSeries = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('cashbook_transactions')
        .select('transaction_date, flow_type, amount')
        .eq('status', 'approved')
        .neq('flow_type', 'internal_transfer')
        .gte('transaction_date', fromDate)
      if (accountFilter) q = q.or(accountFilter)
      const { data, error } = await q
      if (error) throw error

      // Khởi tạo khung ngày liên tục
      const map = new Map<string, DayPoint>()
      for (let i = 0; i < rangeDays; i++) {
        const d = new Date(); d.setDate(d.getDate() - (rangeDays - 1 - i))
        const key = d.toLocaleDateString('en-CA')
        map.set(key, { date: key, label: `${d.getDate()}/${d.getMonth() + 1}`, inflow: 0, outflow: 0, net: 0 })
      }
      ;(data || []).forEach((t: any) => {
        const p = map.get(t.transaction_date)
        if (!p) return
        const amt = Number(t.amount || 0)
        if (t.flow_type === 'inflow') p.inflow += amt
        else if (t.flow_type === 'outflow') p.outflow += amt
        p.net = p.inflow - p.outflow
      })
      setDays(Array.from(map.values()))
    } catch {
      setDays([])
    } finally {
      setLoading(false)
    }
  }, [accountFilter, fromDate, rangeDays])

  useEffect(() => { loadSeries() }, [loadSeries])

  const totalIn = days.reduce((s, d) => s + d.inflow, 0)
  const totalOut = days.reduce((s, d) => s + d.outflow, 0)
  const totalBalance =
    cashFunds.reduce((s, f) => s + Number(f.balance), 0) +
    bankAccounts.reduce((s, b) => s + Number(b.balance), 0)

  // Xuất sổ quỹ CSV (UTF-8 BOM)
  const handleExport = async () => {
    setExporting(true)
    try {
      let q = supabase
        .from('cashbook_transactions')
        .select('transaction_code, transaction_date, flow_type, amount, description, reference_no, status')
        .eq('status', 'approved')
        .gte('transaction_date', fromDate)
        .order('transaction_date', { ascending: true })
        .order('created_at', { ascending: true })
      if (accountFilter) q = q.or(accountFilter)
      const { data, error } = await q
      if (error) throw error

      const header = ['STT', 'Ngày', 'Số phiếu', 'Diễn giải', 'Tham chiếu', 'Thu', 'Chi']
      const rows = (data || []).map((t: any, i: number) => {
        const isIn = t.flow_type === 'inflow'
        const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
        return [
          i + 1,
          new Date(t.transaction_date).toLocaleDateString('vi-VN'),
          t.transaction_code || '',
          esc(t.description),
          esc(t.reference_no || ''),
          isIn ? Number(t.amount) : 0,
          !isIn ? Number(t.amount) : 0,
        ].join(',')
      })
      const csv = '﻿' + [header.join(','), ...rows].join('\r\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `so-quy_${fromDate}_den_${new Date().toLocaleDateString('en-CA')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KpiCard label={`Tổng thu (${rangeDays} ngày)`} value={formatCurrency(totalIn)} icon={TrendingUp} tone="emerald" />
        <KpiCard label={`Tổng chi (${rangeDays} ngày)`} value={formatCurrency(totalOut)} icon={TrendingDown} tone="orange" />
        <KpiCard label="Tổng số dư quỹ + TK" value={formatCurrency(totalBalance)} icon={Wallet} tone="blue" />
      </div>

      {/* Chart card */}
      <div className="bg-white border border-gray-150 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-body-lg font-bold text-gray-700">Dòng tiền thu / chi / ròng theo ngày</h3>
          <div className="flex items-center gap-2">
            <select value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))}
              className="h-9 px-3 bg-gray-25 border border-gray-150 rounded-lg text-tiny text-gray-600 focus:border-blue-500 focus:outline-none">
              <option value={7}>7 ngày</option>
              <option value={30}>30 ngày</option>
              <option value={90}>90 ngày</option>
            </select>
            <button onClick={handleExport} disabled={exporting}
              className="h-9 px-3 border border-gray-200 text-gray-600 rounded-lg font-semibold text-tiny flex items-center gap-1.5 hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-60">
              <Download size={14} />
              {exporting ? 'Đang xuất...' : 'Xuất sổ quỹ (CSV)'}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="h-72 flex items-center justify-center text-tiny text-gray-400 italic">Đang tải biểu đồ...</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={days} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9aa4b2' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} width={64}
                tickFormatter={(v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${(v / 1e3).toFixed(0)}k`)} />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v))} labelFormatter={(l) => `Ngày ${l}`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="inflow" name="Thu" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="outflow" name="Chi" fill="#f97316" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Line dataKey="net" name="Ròng" stroke="#1E5A9C" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Balance table */}
      <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
        <h3 className="text-body-lg font-bold text-gray-700 p-5 border-b border-gray-100">Số dư quỹ & tài khoản hiện tại</h3>
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Quỹ / Tài khoản</th>
              <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Loại</th>
              <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider text-right">Số dư</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cashFunds.map(f => (
              <tr key={f.id} className="hover:bg-gray-25">
                <td className="px-5 py-3 text-tiny font-semibold text-gray-700">{f.name}</td>
                <td className="px-5 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">Tiền mặt</span></td>
                <td className="px-5 py-3 text-right tabular-nums font-bold text-gray-700">{formatCurrency(f.balance)}</td>
              </tr>
            ))}
            {bankAccounts.map(b => (
              <tr key={b.id} className="hover:bg-gray-25">
                <td className="px-5 py-3 text-tiny font-semibold text-gray-700">{b.bank_name} …{b.account_no.slice(-4)}</td>
                <td className="px-5 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">Ngân hàng</span></td>
                <td className="px-5 py-3 text-right tabular-nums font-bold text-gray-700">{formatCurrency(b.balance)}</td>
              </tr>
            ))}
            {cashFunds.length === 0 && bankAccounts.length === 0 && (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-tiny text-gray-400 italic">Chưa có quỹ/tài khoản nào.</td></tr>
            )}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-100">
            <tr>
              <td className="px-5 py-3 text-tiny font-bold text-gray-700" colSpan={2}>Tổng cộng</td>
              <td className="px-5 py-3 text-right tabular-nums font-bold text-blue-700">{formatCurrency(totalBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function KpiCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone: 'emerald' | 'orange' | 'blue' }) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
  }
  return (
    <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm flex justify-between items-start">
      <div>
        <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
        <h2 className="text-[24px] font-bold text-gray-700 tabular-nums">{value}</h2>
      </div>
      <div className={`px-2 py-1 rounded-md border ${tones[tone]}`}><Icon size={16} /></div>
    </div>
  )
}
