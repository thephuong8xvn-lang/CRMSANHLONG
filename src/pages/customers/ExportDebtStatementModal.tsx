import { useState } from 'react'
import { X, FileSpreadsheet, Loader2, AlertTriangle } from 'lucide-react'
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, subDays,
  startOfMonth, endOfMonth, subMonths, startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
} from 'date-fns'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { logger } from '../../lib/logger'
import { fetchCustomerStatement } from '../../lib/customerStatement'
import { generateCustomerStatementXlsx, type StatementExportOptions } from '../../lib/exporters/customerStatementXlsx'

interface ExportDebtStatementModalProps {
  customer: { id: string; name?: string; code?: string }
  onClose: () => void
}

type PresetKey =
  | 'today' | 'thisWeek' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth'
  | 'thisQuarter' | 'thisYear' | 'allTime' | 'custom'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'thisWeek', label: 'Tuần này' },
  { key: 'last7', label: '7 ngày qua' },
  { key: 'last30', label: '30 ngày qua' },
  { key: 'thisMonth', label: 'Tháng này' },
  { key: 'lastMonth', label: 'Tháng trước' },
  { key: 'thisQuarter', label: 'Quý này' },
  { key: 'thisYear', label: 'Năm nay' },
  { key: 'allTime', label: 'Toàn thời gian' },
  { key: 'custom', label: 'Lựa chọn khác' },
]

function resolveRange(preset: PresetKey, customFrom: string, customTo: string): { from: Date; to: Date } {
  const now = new Date()
  switch (preset) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) }
    case 'thisWeek': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
    case 'last7': return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) }
    case 'last30': return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) }
    case 'thisMonth': return { from: startOfMonth(now), to: endOfMonth(now) }
    case 'lastMonth': return { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) }
    case 'thisQuarter': return { from: startOfQuarter(now), to: endOfQuarter(now) }
    case 'thisYear': return { from: startOfYear(now), to: endOfYear(now) }
    case 'allTime': return { from: new Date(2000, 0, 1), to: endOfDay(now) }
    case 'custom': return {
      from: customFrom ? startOfDay(new Date(customFrom)) : startOfMonth(now),
      to: customTo ? endOfDay(new Date(customTo)) : endOfDay(now),
    }
  }
}

const DETAIL_COLS: { key: keyof StatementExportOptions['cols']; label: string }[] = [
  { key: 'unit', label: 'ĐVT' },
  { key: 'qty', label: 'Số lượng' },
  { key: 'unitPrice', label: 'Đơn giá' },
  { key: 'discount', label: 'Giảm giá' },
  { key: 'vat', label: 'VAT' },
  { key: 'sellPrice', label: 'Giá bán/trả' },
  { key: 'lineTotal', label: 'Thành tiền' },
]

export default function ExportDebtStatementModal({ customer, onClose }: ExportDebtStatementModalProps) {
  const { settings } = useDisplaySettings()
  const [preset, setPreset] = useState<PresetKey>('thisMonth')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [showLineDetail, setShowLineDetail] = useState(true)
  const [cols, setCols] = useState<StatementExportOptions['cols']>({
    unit: true, qty: true, unitPrice: true, discount: true, vat: true, sellPrice: true, lineTotal: true,
  })
  const [showNotes, setShowNotes] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggleCol = (k: keyof StatementExportOptions['cols']) =>
    setCols(prev => ({ ...prev, [k]: !prev[k] }))

  const handleExport = async () => {
    setError('')
    setLoading(true)
    try {
      const { from, to } = resolveRange(preset, customFrom, customTo)
      if (from.getTime() > to.getTime()) {
        setError('Khoảng thời gian không hợp lệ (từ ngày phải trước đến ngày).')
        setLoading(false)
        return
      }
      const statement = await fetchCustomerStatement(customer.id, from.toISOString(), to.toISOString())
      await generateCustomerStatementXlsx(statement, { showLineDetail, cols, showNotes }, {
        name: settings.print_company_name || 'CÔNG TY',
        address: settings.print_company_address || '',
        phone: settings.print_company_phone || '',
        mst: settings.print_company_mst || '',
      })
      onClose()
    } catch (err: any) {
      logger.error('[ExportDebtStatement] error:', err?.message ?? err)
      setError('Xuất file thất bại. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-body-lg text-gray-800 flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-emerald-600" />
              Xuất file công nợ
            </h3>
            {customer.name && <p className="text-tiny text-gray-400 mt-0.5">{customer.name} {customer.code ? `· ${customer.code}` : ''}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition-all">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Thời gian */}
          <div className="border border-gray-100 rounded-xl p-4">
            <span className="text-tiny font-bold text-gray-500 uppercase tracking-wider">Thời gian</span>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={`h-8 px-2 rounded-full text-tiny font-semibold border transition-all ${
                    preset === p.key
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-[11px] font-bold text-gray-400 block mb-1">Từ ngày</label>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="w-full h-9 border border-gray-200 rounded-lg px-2 text-tiny focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-400 block mb-1">Đến ngày</label>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="w-full h-9 border border-gray-200 rounded-lg px-2 text-tiny focus:outline-none focus:border-blue-500" />
                </div>
              </div>
            )}
          </div>

          {/* Thông tin xuất file */}
          <div className="border border-gray-100 rounded-xl p-4">
            <span className="text-tiny font-bold text-gray-500 uppercase tracking-wider">Thông tin xuất file</span>
            <p className="text-[11px] text-gray-400 mt-1">Dữ liệu tổng quan (luôn có): Thời gian, Mã, Diễn giải, Ghi nợ, Ghi có.</p>

            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
              <input type="checkbox" checked={showLineDetail} onChange={e => setShowLineDetail(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500" />
              <span className="text-body-md font-semibold text-gray-700">Chi tiết từng hàng giao dịch</span>
            </label>
            <p className="text-[11px] text-gray-400 ml-6 mb-2">Diễn giải chi tiết từng dòng sản phẩm/dịch vụ</p>

            {showLineDetail && (
              <div className="ml-6 grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-3">
                {DETAIL_COLS.map(c => (
                  <label key={c.key} className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={cols[c.key]} onChange={() => toggleCol(c.key)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500" />
                    <span className="text-tiny text-gray-600">{c.label}</span>
                  </label>
                ))}
              </div>
            )}

            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none pt-2 border-t border-gray-50">
              <input type="checkbox" checked={showNotes} onChange={e => setShowNotes(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500" />
              <span className="text-body-md font-semibold text-gray-700">Ghi chú</span>
            </label>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-tiny flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={loading}
            className="h-10 px-5 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50">
            Bỏ qua
          </button>
          <button onClick={handleExport} disabled={loading}
            className="h-10 px-6 bg-blue-500 text-white rounded-lg text-body-md font-bold hover:bg-blue-600 transition-all flex items-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {loading ? 'Đang xuất...' : 'Đồng ý'}
          </button>
        </div>
      </div>
    </div>
  )
}
