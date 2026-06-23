import { useMemo, useState } from 'react'
import { BarChart3, Layers, Users, ChevronRight, X, Filter, Download, AlertCircle } from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import {
  useBiPivot, useBiAbcXyz, useBiCohort,
  ENTITY_DIM_TO_FILTER,
  type BiDimension, type BiCompare, type BiPivotRow, type BiAbcRow,
} from '../../hooks/queries/useBiAnalytics'

type TabKey = 'pivot' | 'abc' | 'cohort'

const DIMENSIONS: { value: BiDimension; label: string; entity: boolean }[] = [
  { value: 'month', label: 'Tháng', entity: false },
  { value: 'quarter', label: 'Quý', entity: false },
  { value: 'year', label: 'Năm', entity: false },
  { value: 'product', label: 'Sản phẩm', entity: true },
  { value: 'brand', label: 'Thương hiệu', entity: true },
  { value: 'category', label: 'Nhóm hàng', entity: true },
  { value: 'customer', label: 'Khách hàng', entity: true },
  { value: 'branch', label: 'Chi nhánh', entity: true },
  { value: 'salesperson', label: 'Nhân viên', entity: true },
]
const dimLabel = (d: BiDimension) => DIMENSIONS.find(x => x.value === d)?.label ?? d

interface Chip { dim: BiDimension; filterKey: string; id: string; label: string }

// ── Khoảng thời gian ──
type Preset = 'month' | 'quarter' | 'year' | '12m' | 'custom'
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date()
  const to = ymd(now) + 'T23:59:59'
  let from: Date
  if (preset === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1)
  else if (preset === 'quarter') from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  else if (preset === 'year') from = new Date(now.getFullYear(), 0, 1)
  else { from = new Date(now); from.setMonth(from.getMonth() - 12) }
  return { from: ymd(from) + 'T00:00:00', to }
}

export default function BiAnalyticsPage() {
  const { formatCurrency } = useDisplaySettings()
  const [tab, setTab] = useState<TabKey>('pivot')

  // Period (dùng chung Pivot + ABC)
  const [preset, setPreset] = useState<Preset>('12m')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const range = useMemo(() => {
    if (preset === 'custom') {
      return {
        from: (customFrom || ymd(new Date())) + 'T00:00:00',
        to: (customTo || ymd(new Date())) + 'T23:59:59',
      }
    }
    return presetRange(preset)
  }, [preset, customFrom, customTo])

  return (
    <Layout activeMenu="Báo cáo">
      <div className="p-4 md:p-8 max-w-[1600px] w-full mx-auto space-y-5">
        {/* Header */}
        <div>
          <nav className="flex items-center gap-2 text-label-md text-gray-400 mb-2">
            <span>Báo cáo</span><ChevronRight size={12} /><span className="text-blue-600 font-semibold">Phân tích BI</span>
          </nav>
          <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2">
            <BarChart3 size={22} className="text-blue-500" /> Phân tích BI tương tác
          </h1>
          <p className="text-body-md text-gray-400 mt-1">Pivot đa chiều &amp; so sánh kỳ · phân loại ABC/XYZ · cohort giữ chân khách.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {([['pivot', 'Pivot đa chiều', Layers], ['abc', 'ABC / XYZ', BarChart3], ['cohort', 'Cohort KH', Users]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-tiny font-semibold border-b-2 -mb-px flex items-center gap-1.5 transition-colors ${tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {/* Period selector (Pivot + ABC) */}
        {tab !== 'cohort' && (
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-2">
            <span className="text-tiny font-bold text-gray-400 uppercase mr-1">Kỳ</span>
            {([['month', 'Tháng này'], ['quarter', 'Quý này'], ['year', 'Năm nay'], ['12m', '12 tháng'], ['custom', 'Tùy chọn']] as const).map(([p, l]) => (
              <button key={p} onClick={() => setPreset(p)}
                className={`px-3 py-1.5 rounded-lg text-tiny font-semibold transition-all ${preset === p ? 'bg-blue-500 text-white' : 'bg-gray-25 text-gray-500 hover:bg-gray-100'}`}>{l}</button>
            ))}
            {preset === 'custom' && (
              <div className="flex items-center gap-1.5 ml-1">
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 px-2 border border-gray-200 rounded-lg text-tiny" />
                <span className="text-gray-400">→</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 px-2 border border-gray-200 rounded-lg text-tiny" />
              </div>
            )}
          </div>
        )}

        {tab === 'pivot' && <PivotTab range={range} formatCurrency={formatCurrency} />}
        {tab === 'abc' && <AbcTab range={range} formatCurrency={formatCurrency} />}
        {tab === 'cohort' && <CohortTab />}
      </div>
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// TAB 1 — PIVOT
// ─────────────────────────────────────────────────────────────
function PivotTab({ range, formatCurrency }: { range: { from: string; to: string }; formatCurrency: (n: number) => string }) {
  const [dim, setDim] = useState<BiDimension>('branch')
  const [compare, setCompare] = useState<BiCompare>('none')
  const [chips, setChips] = useState<Chip[]>([])

  const filters = useMemo(() => {
    const f: Record<string, string> = {}
    for (const c of chips) f[c.filterKey] = c.id
    return f
  }, [chips])

  const query = useBiPivot({ from: range.from, to: range.to, dim, compare, filters }, true)
  const rows = query.data ?? []

  const addChip = (row: BiPivotRow) => {
    const fk = ENTITY_DIM_TO_FILTER[dim]
    if (!fk || !row.dim_key) return
    setChips(prev => [...prev.filter(c => c.filterKey !== fk), { dim, filterKey: fk, id: row.dim_key, label: row.dim_label }])
  }
  const removeChip = (fk: string) => setChips(prev => prev.filter(c => c.filterKey !== fk))

  const isEntity = DIMENSIONS.find(d => d.value === dim)?.entity
  const deltaPct = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev) * 100 : null

  const totals = useMemo(() => rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, profit: a.profit + r.profit }), { revenue: 0, profit: 0 }), [rows])

  const columns: DataTableColumn<BiPivotRow>[] = [
    { key: 'label', header: dimLabel(dim), flex: true, minWidth: 180, render: (r) => <span className="font-semibold text-gray-700">{r.dim_label}</span> },
    { key: 'revenue', header: 'Doanh thu', width: 130, align: 'right', render: (r) => <span className="tabular-nums font-semibold text-gray-700">{formatCurrency(r.revenue)}</span> },
    { key: 'profit', header: 'Lợi nhuận', width: 130, align: 'right', render: (r) => <span className={`tabular-nums font-semibold ${r.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatCurrency(r.profit)}</span> },
    { key: 'margin', header: 'Biên', width: 80, align: 'right', render: (r) => <span className={`tabular-nums ${r.margin < 0 ? 'text-rose-600' : 'text-gray-600'}`}>{r.margin}%</span> },
    { key: 'qty', header: 'SL', width: 90, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{r.qty.toLocaleString('vi-VN')}</span> },
    { key: 'orders', header: 'Số đơn', width: 80, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{r.order_count}</span> },
  ]
  if (compare !== 'none') {
    columns.push(
      { key: 'prev', header: 'DT kỳ trước', width: 130, align: 'right', render: (r) => <span className="tabular-nums text-gray-400">{formatCurrency(r.prev_revenue)}</span> },
      {
        key: 'delta', header: 'Δ DT', width: 90, align: 'right', noTruncate: true,
        render: (r) => {
          const d = deltaPct(r.revenue, r.prev_revenue)
          if (d == null) return <span className="text-gray-300 text-tiny">—</span>
          return <span className={`tabular-nums font-bold text-tiny ${d < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{d > 0 ? '+' : ''}{d.toFixed(1)}%</span>
        },
      },
    )
  }

  const exportCsv = () => {
    const head = ['Chiều', 'Doanh thu', 'Giá vốn', 'Lợi nhuận', 'Biên %', 'SL', 'Số đơn', 'Số KH', 'DT kỳ trước']
    const lines = rows.map(r => [r.dim_label, r.revenue, r.cogs, r.profit, r.margin, r.qty, r.order_count, r.customer_count, r.prev_revenue]
      .map(v => { const s = String(v ?? ''); return /[",;\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(','))
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bi-pivot-${dim}.csv`; a.click()
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-gray-0 border border-gray-100 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-tiny font-bold text-gray-400 uppercase">Chiều</span>
          <select value={dim} onChange={e => setDim(e.target.value as BiDimension)} className="h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny">
            {DIMENSIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-tiny font-bold text-gray-400 uppercase">So sánh</span>
          <select value={compare} onChange={e => setCompare(e.target.value as BiCompare)} className="h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny">
            <option value="none">Không</option>
            <option value="mom">Kỳ trước</option>
            <option value="yoy">Cùng kỳ năm trước</option>
          </select>
        </div>
        <button onClick={exportCsv} className="h-9 px-3 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 ml-auto">
          <Download size={14} /> CSV
        </button>
      </div>

      {/* Filter chips (drill-down) */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={14} className="text-gray-400" />
          {chips.map(c => (
            <span key={c.filterKey} className="inline-flex items-center gap-1 text-tiny font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
              {dimLabel(c.dim)}: {c.label}
              <button onClick={() => removeChip(c.filterKey)} className="hover:bg-blue-100 rounded-full p-0.5"><X size={11} /></button>
            </span>
          ))}
          <button onClick={() => setChips([])} className="text-tiny text-gray-400 hover:text-gray-600 underline">Xóa lọc</button>
        </div>
      )}

      {/* Totals */}
      <div className="flex flex-wrap gap-4 text-tiny px-1">
        <span className="text-gray-400">Số dòng: <strong className="text-gray-700">{rows.length}</strong></span>
        <span className="text-gray-400">Tổng DT: <strong className="text-gray-700 tabular-nums">{formatCurrency(totals.revenue)}</strong></span>
        <span className="text-gray-400">Tổng LN: <strong className={`tabular-nums ${totals.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatCurrency(totals.profit)}</strong></span>
      </div>

      {query.isError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-tiny text-rose-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{(query.error as Error)?.message || 'Lỗi tải dữ liệu.'}</span>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.dim_key}
        loading={query.isLoading}
        onRowClick={isEntity ? addChip : undefined}
        resetSignal={`${dim}|${compare}|${JSON.stringify(filters)}|${range.from}`}
        itemLabel="dòng"
        emptyText="Không có dữ liệu trong kỳ"
      />
      {isEntity && <p className="text-[11px] text-gray-400 px-1">Mẹo: bấm 1 dòng để lọc theo {dimLabel(dim).toLowerCase()} đó, rồi đổi "Chiều" để xem sâu hơn (drill-down).</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// TAB 2 — ABC / XYZ
// ─────────────────────────────────────────────────────────────
function AbcTab({ range, formatCurrency }: { range: { from: string; to: string }; formatCurrency: (n: number) => string }) {
  const query = useBiAbcXyz(range.from, range.to, true)
  const rows = query.data ?? []

  const matrix = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) m[`${r.abc_class}${r.xyz_class}`] = (m[`${r.abc_class}${r.xyz_class}`] ?? 0) + 1
    return m
  }, [rows])

  const abcCls = (c: string) => c === 'A' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : c === 'B' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-100 text-gray-500 border-gray-200'
  const xyzCls = (c: string) => c === 'X' ? 'bg-blue-50 text-blue-700 border-blue-200' : c === 'Y' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-rose-50 text-rose-600 border-rose-200'

  const columns: DataTableColumn<BiAbcRow>[] = [
    {
      key: 'product', header: 'Sản phẩm', flex: true, minWidth: 200,
      render: (r) => (<div className="min-w-0"><div className="font-bold text-gray-700 truncate">{r.name}</div><div className="text-[11px] text-gray-400 uppercase">{r.sku}</div></div>),
    },
    { key: 'revenue', header: 'Doanh thu', width: 130, align: 'right', render: (r) => <span className="tabular-nums font-semibold text-gray-700">{formatCurrency(r.revenue)}</span> },
    { key: 'cum', header: 'DT tích lũy', width: 100, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{r.cum_share}%</span> },
    { key: 'abc', header: 'ABC', width: 60, align: 'center', noTruncate: true, render: (r) => <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${abcCls(r.abc_class)}`}>{r.abc_class}</span> },
    { key: 'cv', header: 'CV', width: 70, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{r.cv != null ? r.cv : '—'}</span> },
    { key: 'xyz', header: 'XYZ', width: 60, align: 'center', noTruncate: true, render: (r) => <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${xyzCls(r.xyz_class)}`}>{r.xyz_class}</span> },
  ]

  return (
    <div className="space-y-4">
      {/* Ma trận 3×3 */}
      <div className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm overflow-x-auto">
        <div className="text-tiny font-bold text-gray-500 mb-2">Ma trận ABC × XYZ (số SKU) — A=doanh thu cao · X=cầu ổn định</div>
        <table className="text-tiny border-collapse">
          <thead>
            <tr><th className="p-2"></th>{['X', 'Y', 'Z'].map(x => <th key={x} className="p-2 text-gray-500 font-bold w-20 text-center">{x}<div className="font-normal text-[10px] text-gray-400">{x === 'X' ? 'ổn định' : x === 'Y' ? 'dao động' : 'thất thường'}</div></th>)}</tr>
          </thead>
          <tbody>
            {['A', 'B', 'C'].map(a => (
              <tr key={a}>
                <td className="p-2 text-gray-500 font-bold text-center">{a}<div className="font-normal text-[10px] text-gray-400">{a === 'A' ? '≤80%' : a === 'B' ? '≤95%' : 'còn lại'}</div></td>
                {['X', 'Y', 'Z'].map(x => {
                  const n = matrix[`${a}${x}`] ?? 0
                  return <td key={x} className="p-1"><div className={`h-12 rounded-lg flex items-center justify-center font-bold tabular-nums ${n > 0 ? 'bg-blue-500/10 text-blue-700' : 'bg-gray-25 text-gray-300'}`}>{n}</div></td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {query.isError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-tiny text-rose-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{(query.error as Error)?.message || 'Lỗi tải dữ liệu.'}</span>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.product_id}
        loading={query.isLoading}
        resetSignal={range.from}
        itemLabel="sản phẩm"
        emptyText="Không có dữ liệu trong kỳ"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// TAB 3 — COHORT
// ─────────────────────────────────────────────────────────────
function CohortTab() {
  const [months, setMonths] = useState(12)
  const query = useBiCohort(months, true)
  const rows = query.data ?? []

  const { cohorts, maxOffset, cellMap, sizeMap } = useMemo(() => {
    const cohortSet = new Set<string>()
    const cell: Record<string, Record<number, number>> = {}
    const size: Record<string, number> = {}
    let maxOff = 0
    for (const r of rows) {
      cohortSet.add(r.cohort_month)
      size[r.cohort_month] = r.cohort_size
      cell[r.cohort_month] = cell[r.cohort_month] ?? {}
      cell[r.cohort_month][r.month_offset] = r.retention_pct
      if (r.month_offset > maxOff) maxOff = r.month_offset
    }
    const sorted = [...cohortSet].sort((a, b) => b.localeCompare(a))
    return { cohorts: sorted, maxOffset: maxOff, cellMap: cell, sizeMap: size }
  }, [rows])

  const cohortLabel = (s: string) => { const d = new Date(s); return `${pad(d.getMonth() + 1)}/${d.getFullYear()}` }
  const cellColor = (pct: number | undefined) => {
    if (pct == null) return { background: 'transparent', color: '#cbd5e1' }
    const a = Math.min(1, pct / 100)
    return { background: `rgba(37, 99, 235, ${0.08 + a * 0.55})`, color: a > 0.55 ? '#fff' : '#1e3a8a' }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-0 border border-gray-100 rounded-xl p-3 shadow-sm flex items-center gap-2">
        <span className="text-tiny font-bold text-gray-400 uppercase">Số tháng</span>
        {[6, 12, 24].map(m => (
          <button key={m} onClick={() => setMonths(m)} className={`px-3 py-1.5 rounded-lg text-tiny font-semibold ${months === m ? 'bg-blue-500 text-white' : 'bg-gray-25 text-gray-500 hover:bg-gray-100'}`}>{m} tháng</button>
        ))}
        <span className="text-tiny text-gray-400 ml-2">% khách của mỗi cohort còn mua lại theo số tháng kể từ lần mua đầu.</span>
      </div>

      {query.isError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-tiny text-rose-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{(query.error as Error)?.message || 'Lỗi tải dữ liệu.'}</span>
        </div>
      )}

      <div className="bg-gray-0 border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
        {query.isLoading ? (
          <div className="p-12 text-center text-gray-400">Đang tải...</div>
        ) : cohorts.length === 0 ? (
          <div className="p-12 text-center text-gray-400">Không có dữ liệu cohort</div>
        ) : (
          <table className="text-tiny border-collapse w-full">
            <thead>
              <tr className="bg-gray-25 text-gray-400 uppercase text-[10px]">
                <th className="p-2 text-left sticky left-0 bg-gray-25">Cohort</th>
                <th className="p-2 text-right">Quy mô</th>
                {Array.from({ length: maxOffset + 1 }, (_, i) => <th key={i} className="p-2 text-center w-14">M{i}</th>)}
              </tr>
            </thead>
            <tbody>
              {cohorts.map(co => (
                <tr key={co} className="border-t border-gray-50">
                  <td className="p-2 font-semibold text-gray-700 sticky left-0 bg-gray-0">{cohortLabel(co)}</td>
                  <td className="p-2 text-right tabular-nums text-gray-600">{sizeMap[co]}</td>
                  {Array.from({ length: maxOffset + 1 }, (_, i) => {
                    const pct = cellMap[co]?.[i]
                    return <td key={i} className="p-1 text-center tabular-nums" style={cellColor(pct)}>{pct != null ? `${pct}%` : ''}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
