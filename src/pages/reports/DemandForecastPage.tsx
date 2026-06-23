import { useMemo, useState } from 'react'
import { Activity, Package, AlertCircle, Download, Info, ShoppingCart } from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { removeVietnameseTones } from '../../components/SmartSearchSelect'
import { useDemandForecast, useForecastConfig } from '../../hooks/queries/useDemandForecast'
import {
  forecast, DEFAULT_FORECAST_CONFIG,
  type ForecastResult, type Confidence, type DemandPattern, type ForecastMethod,
} from '../../lib/forecast'

const HORIZON_OPTIONS = [4, 8, 12]
const HISTORY_WEEKS = 26 // cửa sổ lấy lịch sử (RPC)

const numFmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })

const PATTERN_LABEL: Record<DemandPattern, string> = {
  smooth: 'Đều', erratic: 'Biến động', intermittent: 'Cách quãng', lumpy: 'Dồn cục', none: '—',
}
const METHOD_LABEL: Record<ForecastMethod, string> = {
  ses: 'Làm mượt', croston: 'Croston', none: '—',
}
const CONF_LABEL: Record<Confidence, string> = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' }
const CONF_CLS: Record<Confidence, string> = {
  low: 'bg-amber-50 text-amber-700 border-amber-200',
  medium: 'bg-blue-50 text-blue-700 border-blue-100',
  high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

interface ForecastVM {
  product_id: string
  sku: string
  name: string
  unit: string | null
  stock_on_hand: number
  fc: ForecastResult
  suggestQty: number // cần đặt theo dự báo kỳ tới = max(0, horizonTotal − tồn)
}

export default function DemandForecastPage() {
  const cfgQuery = useForecastConfig()
  const [horizon, setHorizon] = useState(DEFAULT_FORECAST_CONFIG.horizonWeeks)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)

  const query = useDemandForecast(HISTORY_WEEKS, true)
  const baseCfg = cfgQuery.data ?? DEFAULT_FORECAST_CONFIG

  const rows: ForecastVM[] = useMemo(() => {
    const cfg = { ...baseCfg, horizonWeeks: horizon }
    const q = removeVietnameseTones(debounced.trim().toLowerCase())
    const out = (query.data ?? []).map((s) => {
      const fc = forecast(s.values, cfg)
      return {
        product_id: s.product_id, sku: s.sku, name: s.name, unit: s.unit,
        stock_on_hand: s.stock_on_hand, fc,
        suggestQty: Math.max(0, Math.ceil(fc.horizonTotal - s.stock_on_hand)),
      }
    })
    const filtered = q
      ? out.filter((r) => removeVietnameseTones(`${r.name} ${r.sku}`.toLowerCase()).includes(q))
      : out
    // Cần đặt nhiều nhất (so dự báo) lên đầu.
    return filtered.sort((a, b) => b.suggestQty - a.suggestQty || b.fc.horizonTotal - a.fc.horizonTotal)
  }, [query.data, baseCfg, horizon, debounced])

  const lowConfShare = useMemo(() => {
    if (rows.length === 0) return 0
    return Math.round((rows.filter((r) => r.fc.confidence === 'low').length / rows.length) * 100)
  }, [rows])

  const exportCsv = () => {
    const head = ['SKU', 'Sản phẩm', 'Tồn', 'Cầu TB/tuần', 'Dự báo/tuần', `Dự báo ${horizon} tuần`, 'Dải dưới', 'Dải trên', 'Độ tin cậy', 'Phương pháp', 'Dạng cầu', 'Số tuần LS', 'Tuần có cầu', 'MAPE %', 'Gợi ý đặt']
    const lines = rows.map((r) => [
      r.sku, `"${r.name.replace(/"/g, '""')}"`, r.stock_on_hand,
      r.fc.avgWeekly.toFixed(2), r.fc.weeklyForecast.toFixed(2), r.fc.horizonTotal.toFixed(1),
      r.fc.lower.toFixed(1), r.fc.upper.toFixed(1),
      CONF_LABEL[r.fc.confidence], METHOD_LABEL[r.fc.method], PATTERN_LABEL[r.fc.pattern],
      r.fc.historyWeeks, r.fc.demandWeeks, r.fc.mape != null ? r.fc.mape.toFixed(0) : '',
      r.suggestQty,
    ].join(','))
    const csv = '﻿' + [head.join(','), ...lines].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `du-bao-nhu-cau-${horizon}tuan.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const columns: DataTableColumn<ForecastVM>[] = [
    {
      key: 'product', header: 'Sản phẩm', flex: true, minWidth: 200,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-bold text-gray-700 flex items-center gap-1.5 truncate">
            <Package size={13} className="text-gray-300 shrink-0" />{r.name}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider truncate">{r.sku}</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 whitespace-nowrap shrink-0"
              title="Dạng cầu (phân loại Syntetos–Boylan)">{PATTERN_LABEL[r.fc.pattern]}</span>
          </div>
        </div>
      ),
    },
    { key: 'soh', header: 'Tồn', width: 92, align: 'right', render: (r) => <span className="tabular-nums font-semibold text-gray-700">{numFmt(r.stock_on_hand)}</span> },
    { key: 'avg', header: 'TB/tuần', width: 82, align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{numFmt(r.fc.avgWeekly)}</span> },
    { key: 'wk', header: 'Dự báo/tuần', width: 96, align: 'right', render: (r) => <span className="tabular-nums font-semibold text-gray-700">{numFmt(r.fc.weeklyForecast)}</span> },
    {
      key: 'horizon', header: `Dự báo ${horizon} tuần`, width: 150, align: 'right', noTruncate: true,
      render: (r) => (
        <div className="leading-tight">
          <div className="tabular-nums font-bold text-blue-700">{numFmt(r.fc.horizonTotal)} {r.unit}</div>
          <div className="tabular-nums text-[10px] text-gray-400" title="Dải bất định (± σ×√kỳ)">{numFmt(r.fc.lower)}–{numFmt(r.fc.upper)}</div>
        </div>
      ),
    },
    {
      key: 'conf', header: 'Độ tin cậy', width: 130, align: 'center', noTruncate: true,
      render: (r) => (
        <div className="flex flex-col items-center gap-0.5">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CONF_CLS[r.fc.confidence]}`}>{CONF_LABEL[r.fc.confidence]}</span>
          <span className="text-[10px] text-gray-400" title="Số tuần lịch sử · phương pháp">
            {r.fc.historyWeeks}t · {METHOD_LABEL[r.fc.method]}{r.fc.mape != null ? ` · MAPE ${r.fc.mape.toFixed(0)}%` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'suggest', header: 'Gợi ý đặt', width: 110, align: 'right', noTruncate: true,
      render: (r) => r.suggestQty > 0 ? (
        <span className="inline-flex items-center gap-1 text-tiny font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 tabular-nums">
          <ShoppingCart size={11} />{numFmt(r.suggestQty)} {r.unit}
        </span>
      ) : <span className="text-tiny text-gray-300">đủ tồn</span>,
    },
  ]

  const inputCls = 'h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none'

  return (
    <Layout activeMenu="Báo cáo">
      <div className="p-4 md:p-8 max-w-[1500px] w-full mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2">
              <Activity size={22} className="text-blue-500" /> Dự báo nhu cầu
            </h1>
            <p className="text-body-md text-gray-400 mt-1">Dự báo cầu theo SKU (làm mượt / Croston) — gate độ tin cậy theo lịch sử, tự chính xác dần.</p>
          </div>
          <button onClick={exportCsv} disabled={rows.length === 0}
            className="h-10 px-4 border border-gray-200 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 self-start disabled:opacity-40">
            <Download size={15} className="text-blue-500" /> Xuất CSV
          </button>
        </div>

        {/* Cảnh báo độ tin cậy — trung thực với thực tế dữ liệu mỏng */}
        {lowConfShare >= 50 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-tiny text-amber-800 flex items-start gap-2.5">
            <Info size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Đang tích lũy dữ liệu — {lowConfShare}% mặt hàng còn độ tin cậy thấp.</p>
              <p className="mt-0.5">Hệ thống mới có ít tuần lịch sử nên dự báo hiện gần với nhịp bán gần đây (run-rate). Độ chính xác (và chỉ số MAPE) sẽ tăng dần khi dữ liệu nhiều thêm — cần ~8+ tuần để lên mức trung bình, ~16+ tuần để cao.</p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <label className="text-[11px] font-bold text-gray-400 uppercase block mb-1">Tìm kiếm</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên sản phẩm / mã SKU..."
              className={`${inputCls} w-full`} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Kỳ dự báo</label>
            <div className="flex bg-gray-100 p-1 rounded-lg">
              {HORIZON_OPTIONS.map(h => (
                <button key={h} onClick={() => setHorizon(h)}
                  className={`px-3 h-7 rounded-md text-tiny font-semibold transition-all ${horizon === h ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {h} tuần
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error banner */}
        {query.isError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-tiny text-rose-700 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Không tải được dữ liệu dự báo.</p>
              <p className="mt-0.5">{(query.error as Error)?.message || 'Lỗi không xác định.'} — thử tải lại trang.</p>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="flex items-center gap-4 text-tiny px-1">
          <span className="text-gray-400">Số mặt hàng: <strong className="text-gray-700">{rows.length}</strong></span>
          <span className="text-gray-400">Lịch sử: <strong className="text-gray-700">{HISTORY_WEEKS} tuần</strong></span>
        </div>

        {/* Bảng DataTable chuẩn */}
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.product_id}
          loading={query.isLoading}
          resetSignal={`${debounced}|${horizon}`}
          itemLabel="mặt hàng"
          emptyIcon={<AlertCircle className="mx-auto text-gray-300 mb-2" size={44} />}
          emptyText="Chưa có mặt hàng nào có lịch sử bán để dự báo"
        />

        {/* Ghi chú phương pháp */}
        <p className="text-[11px] text-gray-400 px-1">
          Phương pháp: cầu đều dùng làm mượt mũ (SES), cầu cách quãng/dồn cục dùng Croston (hiệu chỉnh SBA). Gợi ý đặt = dự báo kỳ tới − tồn hiện tại. Chỉ số chỉ tham khảo; quyết định cuối thuộc người mua hàng.
        </p>
      </div>
    </Layout>
  )
}
