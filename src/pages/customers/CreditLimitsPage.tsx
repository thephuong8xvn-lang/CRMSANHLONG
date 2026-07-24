import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, AlertCircle, X, ExternalLink, Check, Wand2, Save } from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { removeVietnameseTones } from '../../components/SmartSearchSelect'
import {
  useCreditSuggestions, useCreditConfig, useSaveCreditConfig, useBulkSetCreditLimits,
  type CreditSuggestionRow,
} from '../../hooks/queries/useCreditLimits'

export default function CreditLimitsPage() {
  const navigate = useNavigate()
  const { formatCurrency } = useDisplaySettings()

  const query = useCreditSuggestions()
  const cfg = useCreditConfig()
  const saveCfg = useSaveCreditConfig()
  const applyMut = useBulkSetCreditLimits()

  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const [onlyZero, setOnlyZero] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [factorInput, setFactorInput] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const all = query.data ?? []
  const rows = useMemo(() => {
    const q = removeVietnameseTones(debounced.trim().toLowerCase())
    return all.filter(r => {
      if (onlyZero && !r.is_zero_limit) return false
      if (q && !removeVietnameseTones(`${r.farm_name} ${r.code ?? ''}`.toLowerCase()).includes(q)) return false
      return true
    })
  }, [all, debounced, onlyZero])

  const effective = (r: CreditSuggestionRow): number => {
    const o = overrides[r.customer_id]
    return o !== undefined && o !== '' ? Number(o) : r.suggested_limit
  }

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const selectAllVisible = () => setSelected(new Set(rows.map(r => r.customer_id)))
  const clearSel = () => setSelected(new Set())

  const handleApply = async () => {
    const pairs = rows
      .filter(r => selected.has(r.customer_id))
      .map(r => ({ customer_id: r.customer_id, credit_limit: effective(r) }))
      .filter(p => Number.isFinite(p.credit_limit) && p.credit_limit >= 0)
    if (pairs.length === 0) { setNotice('Chưa chọn khách nào (hoặc hạn mức không hợp lệ).'); return }
    try {
      const n = await applyMut.mutateAsync(pairs)
      setNotice(`Đã áp hạn mức cho ${n}/${pairs.length} khách.`)
      setSelected(new Set()); setOverrides({})
    } catch (e) {
      setNotice(`Lỗi áp hạn mức: ${(e as Error).message}`)
    }
  }

  const handleSaveFactor = async () => {
    if (!cfg.data) return
    const f = Number(factorInput)
    if (!Number.isFinite(f) || f <= 0) { setNotice('Hệ số phải là số dương.'); return }
    try {
      await saveCfg.mutateAsync({ ...cfg.data, months_factor: f })
      setFactorInput('')
      setNotice(`Đã lưu hệ số ${f}. Đề xuất được tính lại.`)
    } catch (e) {
      setNotice(`Lỗi lưu hệ số: ${(e as Error).message}`)
    }
  }

  const inputCls = 'h-9 px-2.5 bg-gray-25 border border-gray-150 rounded-lg text-tiny focus:border-blue-500 focus:outline-none'
  const selectedCount = rows.filter(r => selected.has(r.customer_id)).length

  const columns: DataTableColumn<CreditSuggestionRow>[] = [
    {
      key: 'sel', header: '', width: 44, align: 'center', noTruncate: true,
      render: (r) => (
        <input type="checkbox" checked={selected.has(r.customer_id)}
          onChange={(e) => { e.stopPropagation(); toggle(r.customer_id) }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 accent-blue-600 cursor-pointer" />
      ),
    },
    {
      key: 'customer', header: 'Khách hàng', flex: true, minWidth: 190,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-bold text-gray-700 truncate">{r.farm_name}</div>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            {r.code && <span className="uppercase tracking-wider">{r.code}</span>}
            <span>{r.n_orders_90d} đơn/90n</span>
          </div>
        </div>
      ),
    },
    { key: 'owner', header: 'NV', width: 120, render: (r) => <span className="text-gray-600 text-tiny">{r.owner_name || '—'}</span> },
    { key: 'avg', header: 'DS/tháng', width: 110, align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{formatCurrency(r.avg_monthly)}</span> },
    {
      key: 'debt', header: 'Nợ treo', width: 110, align: 'right',
      render: (r) => r.outstanding > 0
        ? <span className="tabular-nums text-rose-600 font-semibold">{formatCurrency(r.outstanding)}</span>
        : <span className="tabular-nums text-gray-400">{r.outstanding < 0 ? formatCurrency(r.outstanding) : '—'}</span>,
    },
    {
      key: 'current', header: 'HM hiện tại', width: 110, align: 'right', noTruncate: true,
      render: (r) => r.current_limit > 0
        ? <span className="tabular-nums text-gray-700">{formatCurrency(r.current_limit)}</span>
        : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Chưa có</span>,
    },
    {
      key: 'newlimit', header: 'Hạn mức mới', width: 150, align: 'right', noTruncate: true,
      render: (r) => (
        <div className="flex flex-col items-end gap-0.5">
          <input
            type="number" min={0} step={500000}
            value={overrides[r.customer_id] ?? String(r.suggested_limit)}
            onChange={(e) => setOverrides(prev => ({ ...prev, [r.customer_id]: e.target.value }))}
            onClick={(e) => e.stopPropagation()}
            className="w-32 h-8 px-2 text-right tabular-nums bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none" />
          <span className="text-[10px] text-gray-400">gợi ý {formatCurrency(r.suggested_limit)}</span>
        </div>
      ),
    },
    {
      key: 'go', header: '', width: 44, align: 'center', noTruncate: true,
      render: (r) => (
        <button onClick={(e) => { e.stopPropagation(); navigate(`/customers/${r.customer_id}`) }}
          className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="Xem khách hàng">
          <ExternalLink size={14} />
        </button>
      ),
    },
  ]

  return (
    <Layout activeMenu="Hạn mức tín dụng">
      <div className="p-4 md:p-8 max-w-[1500px] w-full mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-h1 font-bold text-gray-700 flex items-center gap-2">
            <ShieldCheck size={22} className="text-blue-500" /> Hạn mức tín dụng
          </h1>
          <p className="text-body-md text-gray-400 mt-1">
            Đặt hạn mức nợ hợp lý để cho phép bán chịu có kiểm soát. <b className="text-gray-500">Hạn mức = 0 nghĩa là khách KHÔNG được mua nợ</b> —
            đặt hạn mức dương là <b className="text-gray-500">nới ra</b>, không phải siết. POS sẽ chặn khi nợ vượt hạn mức.
          </p>
        </div>

        {notice && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-tiny text-blue-700 flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="p-1 hover:bg-blue-100 rounded-full"><X size={14} /></button>
          </div>
        )}
        {query.isError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-tiny text-rose-700 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{(query.error as Error)?.message || 'Không tải được đề xuất.'} — thử tải lại trang.</span>
          </div>
        )}

        {/* Controls */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-end gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <label className="text-[11px] font-bold text-gray-400 uppercase block mb-1">Tìm kiếm</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên / mã khách hàng..." className={`${inputCls} w-full`} />
          </div>
          <label className="flex items-center gap-2 text-tiny text-gray-600 h-9">
            <input type="checkbox" checked={onlyZero} onChange={e => setOnlyZero(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            Chỉ khách chưa có hạn mức
          </label>
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase block">Hệ số (× DS tháng)</label>
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} step={0.5} value={factorInput}
                onChange={e => setFactorInput(e.target.value)}
                placeholder={cfg.data ? String(cfg.data.months_factor) : '1.5'} className={`${inputCls} w-20`} />
              <button onClick={handleSaveFactor} disabled={saveCfg.isPending || !factorInput}
                className="h-9 px-2.5 rounded-lg border border-gray-200 text-gray-600 text-tiny font-semibold hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1">
                <Save size={13} /> Lưu
              </button>
            </div>
          </div>
        </div>

        {/* Bulk action bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={selectAllVisible} className="text-tiny font-semibold px-3 h-9 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
            <Wand2 size={14} className="text-blue-500" /> Chọn tất cả ({rows.length})
          </button>
          {selectedCount > 0 && (
            <button onClick={clearSel} className="text-tiny font-semibold px-3 h-9 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
              Bỏ chọn
            </button>
          )}
          <span className="text-tiny text-gray-400">Đã chọn <b className="text-gray-600">{selectedCount}</b> khách</span>
          <button onClick={handleApply} disabled={applyMut.isPending || selectedCount === 0}
            className="ml-auto bg-blue-500 text-white px-4 h-9 rounded-lg font-bold text-tiny hover:bg-blue-600 disabled:opacity-40 flex items-center gap-1.5">
            <Check size={15} /> {applyMut.isPending ? 'Đang áp...' : `Áp hạn mức cho ${selectedCount} khách`}
          </button>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.customer_id}
          loading={query.isLoading}
          resetSignal={`${debounced}|${onlyZero}`}
          itemLabel="khách"
          emptyIcon={<ShieldCheck className="mx-auto text-gray-300 mb-2" size={44} />}
          emptyText="Không có khách nào trong bộ lọc này"
        />

        <p className="text-[11px] text-gray-400 px-1">
          Đề xuất = doanh số bán trung bình/tháng (90 ngày) × hệ số, làm tròn lên. Chỉ là gợi ý — bạn sửa được từng ô trước khi áp.
          Lưu ý: khách bán lẻ gộp (VD "Khách lẻ") nên bỏ chọn — không đặt hạn mức nợ cho tài khoản gom.
        </p>
      </div>
    </Layout>
  )
}
