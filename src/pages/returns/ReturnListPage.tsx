import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  Search,
  RotateCcw,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Banknote,
  Landmark,
  FileMinus,
  Pencil,
  Trash2,
  X
} from 'lucide-react'
import Layout from '../../components/Layout'
import { useRealtimeTable } from '../../hooks/useRealtimeTable'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface ReturnLine {
  id: string
  product_id: string
  quantity: number
  unit_price: number
  line_total: number
  lot_id: string | null
  return_to_warehouse_id: string | null
  products?: { name: string; sku: string }
  warehouse?: { name: string }
}

interface SalesReturn {
  id: string
  return_code: string
  created_at: string
  status: string
  reason: string
  refund_method: string
  total_amount: number
  debt_offset_total: number
  order_id: string
  orders?: {
    order_code: string
    customers?: { farm_name: string }
  }
  creator?: { full_name: string }
  sales_return_lines?: ReturnLine[]
}

export default function ReturnListPage() {
  const navigate = useNavigate()
  const { userRole } = useAuth()
  const isAdmin = userRole?.code === 'admin'

  const [returns, setReturns] = useState<SalesReturn[]>([])
  const [lotNumbers, setLotNumbers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Bộ lọc
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebouncedValue(searchTerm, 300)
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedRefund, setSelectedRefund] = useState('')
  const [selectedDateRange, setSelectedDateRange] = useState('all')

  // Sửa lý do (admin)
  const [editingReasonId, setEditingReasonId] = useState<string | null>(null)
  const [reasonDraft, setReasonDraft] = useState('')

  // Hủy phiếu (admin)
  const [cancellingReturn, setCancellingReturn] = useState<SalesReturn | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const loadReturns = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('sales_returns')
        .select(`
          id, return_code, created_at, status, reason, refund_method,
          total_amount, debt_offset_total, order_id,
          orders:orders(order_code, customers:customers(farm_name)),
          creator:profiles!sales_returns_created_by_fkey(full_name),
          sales_return_lines(
            id, product_id, quantity, unit_price, line_total, lot_id, return_to_warehouse_id,
            products:products(name, sku),
            warehouse:warehouses!sales_return_lines_return_to_warehouse_id_fkey(name)
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      const rows = (data || []) as unknown as SalesReturn[]
      setReturns(rows)

      // lot_id không có FK → nạp số lô bằng query phụ
      const lotIds = Array.from(new Set(
        rows.flatMap(r => (r.sales_return_lines || []).map(l => l.lot_id).filter(Boolean))
      )) as string[]
      if (lotIds.length > 0) {
        const { data: lots } = await supabase
          .from('stock_lots').select('id, lot_number').in('id', lotIds)
        const map: Record<string, string> = {}
        ;(lots || []).forEach((l: any) => { map[l.id] = l.lot_number })
        setLotNumbers(map)
      }
    } catch (err) {
      console.error('Error loading returns:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadReturns() }, [loadReturns])
  useRealtimeTable({ table: 'sales_returns', event: '*', onData: loadReturns })

  // Lọc client-side
  const filteredReturns = returns.filter(r => {
    const term = debouncedSearch.toLowerCase().trim()
    const matchesSearch =
      !term ||
      r.return_code.toLowerCase().includes(term) ||
      (r.orders?.order_code || '').toLowerCase().includes(term) ||
      (r.orders?.customers?.farm_name || '').toLowerCase().includes(term)

    const matchesStatus = !selectedStatus || r.status === selectedStatus
    const matchesRefund = !selectedRefund || r.refund_method === selectedRefund

    let matchesDate = true
    if (selectedDateRange !== 'all') {
      const createdDate = new Date(r.created_at)
      const now = new Date()
      const diffDays = Math.ceil(Math.abs(now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24))
      if (selectedDateRange === 'today') matchesDate = createdDate.toDateString() === now.toDateString()
      else if (selectedDateRange === '7days') matchesDate = diffDays <= 7
      else if (selectedDateRange === '30days') matchesDate = diffDays <= 30
    }

    return matchesSearch && matchesStatus && matchesRefund && matchesDate
  })

  const filterSignal = `${debouncedSearch}|${selectedStatus}|${selectedRefund}|${selectedDateRange}`

  const completedFiltered = filteredReturns.filter(r => r.status === 'completed')
  const totalValue = completedFiltered.reduce((s, r) => s + Number(r.total_amount || 0), 0)
  const totalDebtOffset = completedFiltered.reduce((s, r) => s + Number(r.debt_offset_total || 0), 0)

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  const renderStatusBadge = (status: string) => {
    let text = 'Chờ xử lý', textColor = 'text-amber-700', Icon = Clock
    switch (status) {
      case 'completed': text = 'Hoàn tất'; textColor = 'text-emerald-800'; Icon = CheckCircle; break
      case 'approved': text = 'Đã duyệt'; textColor = 'text-blue-700'; Icon = CheckCircle; break
      case 'rejected': text = 'Từ chối'; textColor = 'text-red-700'; Icon = XCircle; break
      case 'cancelled': text = 'Đã hủy'; textColor = 'text-red-700'; Icon = XCircle; break
    }
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-50 border border-gray-150 whitespace-nowrap ${textColor}`}>
        <Icon size={11} className="shrink-0 text-current" />
        {text}
      </span>
    )
  }

  const renderRefundBadge = (method: string) => {
    let text = 'Trừ công nợ', textColor = 'text-purple-700', Icon = FileMinus
    if (method === 'cash') { text = 'Hoàn tiền mặt'; textColor = 'text-emerald-700'; Icon = Banknote }
    else if (method === 'bank_transfer') { text = 'Chuyển khoản'; textColor = 'text-blue-700'; Icon = Landmark }
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-50 border border-gray-150 whitespace-nowrap ${textColor}`}>
        <Icon size={11} className="shrink-0 text-current" />
        {text}
      </span>
    )
  }

  // ── Admin: sửa lý do ──
  const handleSaveReason = async (returnId: string) => {
    if (!reasonDraft.trim()) return
    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('sales_returns')
        .update({ reason: reasonDraft.trim() })
        .eq('id', returnId)
      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Đã cập nhật lý do trả hàng.' })
      setEditingReasonId(null)
      loadReturns()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi cập nhật lý do: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Admin: hủy phiếu (đảo kho + tái lập công nợ — RPC kiểm quyền server) ──
  const handleCancelReturn = async () => {
    if (!cancellingReturn) return
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('fn_cancel_sales_return', {
        p_return_id: cancellingReturn.id,
        p_reason: cancelReason
      })
      if (error) throw error
      setAlertMsg({ type: 'success', text: `Đã hủy phiếu ${cancellingReturn.return_code}: hàng đã trừ lại khỏi kho, công nợ được tái lập.` })
      setCancellingReturn(null)
      setCancelReason('')
      loadReturns()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi hủy phiếu: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const columns: DataTableColumn<SalesReturn>[] = [
    {
      key: 'code', header: 'Mã phiếu', width: 140,
      render: (r, expanded) => (
        <span className="font-mono font-bold text-blue-600 inline-flex items-center gap-1">
          {r.return_code}
          <span className={`text-gray-300 transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
        </span>
      )
    },
    {
      key: 'customer', header: 'Khách hàng', flex: true, minWidth: 220,
      render: r => (
        <span className="font-semibold text-gray-800" title={r.orders?.customers?.farm_name || ''}>
          {r.orders?.customers?.farm_name || 'Khách lẻ / Không xác định'}
        </span>
      )
    },
    {
      key: 'order', header: 'Đơn gốc', width: 140,
      render: r => (
        <button
          onClick={e => { e.stopPropagation(); navigate(`/orders/${r.order_id}`) }}
          className="font-mono text-[11px] text-blue-500 hover:underline"
        >
          {r.orders?.order_code || '—'}
        </button>
      )
    },
    {
      key: 'time', header: 'Thời gian', width: 120, align: 'center', hideOnMobile: true,
      render: r => <span className="text-gray-400 text-[11px]">{formatDate(r.created_at)}</span>
    },
    {
      key: 'refund', header: 'Hình thức hoàn', width: 140, align: 'center', noTruncate: true,
      render: r => renderRefundBadge(r.refund_method)
    },
    {
      key: 'total', header: 'Tổng tiền', width: 124, align: 'right',
      render: r => <span className="font-bold text-gray-800 text-[11px] tabular-nums">{formatCurrency(Number(r.total_amount))}</span>
    },
    {
      key: 'creator', header: 'Người tạo', width: 120, hideOnMobile: true,
      render: r => <span className="text-gray-500 text-[11px]">{r.creator?.full_name || 'Hệ thống'}</span>
    },
    {
      key: 'status', header: 'Trạng thái', width: 120, align: 'center', noTruncate: true, mobileHeaderRight: true,
      render: r => renderStatusBadge(r.status)
    }
  ]

  const renderExpandedRow = (r: SalesReturn) => (
    <div className="p-4 bg-gray-25 space-y-4">
      {/* Lý do + chỉnh sửa */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Lý do trả hàng</p>
          {editingReasonId === r.id ? (
            <div className="flex items-center gap-2">
              <input
                className="flex-1 h-9 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                value={reasonDraft}
                onChange={e => setReasonDraft(e.target.value)}
                disabled={submitting}
              />
              <button
                onClick={() => handleSaveReason(r.id)}
                disabled={submitting}
                className="h-9 px-3 bg-blue-500 text-white rounded-lg text-body-md font-semibold hover:bg-blue-600 disabled:opacity-50"
              >Lưu</button>
              <button
                onClick={() => setEditingReasonId(null)}
                className="h-9 px-3 border border-gray-200 rounded-lg text-body-md text-gray-500 hover:bg-gray-50"
              >Hủy</button>
            </div>
          ) : (
            <p className="text-body-md text-gray-700 break-words">{r.reason || '—'}</p>
          )}
          {Number(r.debt_offset_total) > 0 && (
            <p className="text-[11px] text-purple-700 font-semibold mt-1.5">
              Đã cấn trừ {formatCurrency(Number(r.debt_offset_total))} vào công nợ khách
            </p>
          )}
        </div>
        {isAdmin && r.status !== 'cancelled' && (
          <div className="flex items-center gap-2 shrink-0">
            {editingReasonId !== r.id && (
              <button
                onClick={() => { setEditingReasonId(r.id); setReasonDraft(r.reason || '') }}
                className="h-9 px-3 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
              >
                <Pencil size={13} /> Sửa lý do
              </button>
            )}
            {r.status === 'completed' && (
              <button
                onClick={() => { setCancellingReturn(r); setCancelReason('') }}
                disabled={r.refund_method !== 'credit_note'}
                title={r.refund_method !== 'credit_note'
                  ? 'Phiếu hoàn tiền mặt/CK đã sinh phiếu chi sổ quỹ — xử lý qua Sổ quỹ'
                  : 'Hủy phiếu: trừ lại kho + tái lập công nợ'}
                className="h-9 px-3 border border-red-200 text-red-600 rounded-lg text-body-md font-semibold hover:bg-red-50 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={13} /> Hủy phiếu
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bảng dòng hàng trả */}
      <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <table className="w-full text-body-md">
          <thead className="bg-gray-25 text-tiny uppercase text-gray-400 font-bold">
            <tr>
              <th className="px-4 py-2 text-left">Sản phẩm</th>
              <th className="px-4 py-2 text-left">SKU</th>
              <th className="px-4 py-2 text-left">Số lô</th>
              <th className="px-4 py-2 text-left">Kho nhận</th>
              <th className="px-4 py-2 text-right">SL trả</th>
              <th className="px-4 py-2 text-right">Đơn giá hoàn</th>
              <th className="px-4 py-2 text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(r.sales_return_lines || []).map(line => (
              <tr key={line.id}>
                <td className="px-4 py-2 font-semibold text-gray-800">{line.products?.name || '—'}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-gray-500">{line.products?.sku || '—'}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-gray-500">
                  {line.lot_id ? (lotNumbers[line.lot_id] || '…') : '—'}
                </td>
                <td className="px-4 py-2 text-gray-600">{line.warehouse?.name || '—'}</td>
                <td className="px-4 py-2 text-right font-bold tabular-nums">{Number(line.quantity).toLocaleString('vi-VN')}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(Number(line.unit_price))}</td>
                <td className="px-4 py-2 text-right font-bold tabular-nums">{formatCurrency(Number(line.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <Layout activeMenu="Trả hàng">
      <div className="p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
          <div>
            <h2 className="text-display-sm font-bold text-gray-800">Trả hàng</h2>
            <p className="text-body-md text-gray-500">
              Danh sách phiếu khách trả hàng — hồi kho, hoàn tiền và cấn trừ công nợ
            </p>
          </div>
        </div>

        {/* Alert */}
        {alertMsg && (
          <div className={`mb-6 px-4 py-3 rounded-xl border flex items-start gap-2 text-body-md ${
            alertMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {alertMsg.type === 'success' ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{alertMsg.text}</span>
            <button onClick={() => setAlertMsg(null)} className="text-current opacity-60 hover:opacity-100"><X size={16} /></button>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center shrink-0">
              <RotateCcw size={20} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Phiếu hoàn tất (kỳ lọc)</p>
              <p className="text-display-sm font-bold text-gray-800">{completedFiltered.length}</p>
            </div>
          </div>
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center shrink-0">
              <Banknote size={20} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Tổng giá trị hàng trả</p>
              <p className="text-display-sm font-bold text-gray-800">{formatCurrency(totalValue)}</p>
            </div>
          </div>
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center shrink-0">
              <FileMinus size={20} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Đã cấn trừ công nợ</p>
              <p className="text-display-sm font-bold text-gray-800">{formatCurrency(totalDebtOffset)}</p>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 mb-8 flex flex-wrap items-end gap-4 shadow-sm">
          <div className="flex-grow min-w-[200px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Tìm kiếm</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                className="w-full h-10 pl-9 pr-4 bg-gray-0 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
                placeholder="Tìm mã phiếu, mã đơn, tên khách hàng..."
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="w-full sm:w-auto min-w-[150px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Trạng thái</label>
            <select
              className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Chờ xử lý</option>
              <option value="completed">Hoàn tất</option>
              <option value="cancelled">Đã hủy</option>
              <option value="rejected">Từ chối</option>
            </select>
          </div>

          <div className="w-full sm:w-auto min-w-[160px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Hình thức hoàn</label>
            <select
              className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
              value={selectedRefund}
              onChange={e => setSelectedRefund(e.target.value)}
            >
              <option value="">Tất cả hình thức</option>
              <option value="cash">Hoàn tiền mặt</option>
              <option value="bank_transfer">Chuyển khoản</option>
              <option value="credit_note">Trừ công nợ</option>
            </select>
          </div>

          <div className="w-full sm:w-auto min-w-[150px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Thời gian</label>
            <select
              className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
              value={selectedDateRange}
              onChange={e => setSelectedDateRange(e.target.value)}
            >
              <option value="all">Mọi thời gian</option>
              <option value="today">Hôm nay</option>
              <option value="7days">7 ngày qua</option>
              <option value="30days">30 ngày qua</option>
            </select>
          </div>
        </div>

        {/* Empty State */}
        {!loading && filteredReturns.length === 0 && (
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-12 text-center flex flex-col items-center justify-center shadow-sm">
            <div className="w-16 h-16 bg-gray-50 flex items-center justify-center rounded-full text-gray-400 mb-4">
              <RotateCcw size={32} strokeWidth={1.5} />
            </div>
            <h3 className="text-body-lg font-semibold text-gray-700 mb-1">Chưa có phiếu trả hàng nào</h3>
            <p className="text-body-md text-gray-400 max-w-sm">
              Phiếu trả hàng được tạo từ trang chi tiết đơn hàng (nút "Trả hàng").
            </p>
          </div>
        )}

        {/* Data Table */}
        {(loading || filteredReturns.length > 0) && (
          <DataTable
            rows={filteredReturns}
            columns={columns}
            getRowKey={r => r.id}
            loading={loading}
            pageSize={20}
            itemLabel="phiếu trả"
            resetSignal={filterSignal}
            expandedRowRender={renderExpandedRow}
          />
        )}

        {/* Modal xác nhận hủy phiếu */}
        {cancellingReturn && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-0 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-semibold text-gray-800">Hủy phiếu trả {cancellingReturn.return_code}</h3>
                <button
                  onClick={() => setCancellingReturn(null)}
                  className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-all"
                ><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-body-md text-amber-800 flex gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>
                    Hệ thống sẽ <b>trừ lại toàn bộ hàng đã nhận khỏi kho</b> (giá trị {formatCurrency(Number(cancellingReturn.total_amount))})
                    {Number(cancellingReturn.debt_offset_total) > 0 && (
                      <> và <b>tái lập {formatCurrency(Number(cancellingReturn.debt_offset_total))} công nợ</b> cho khách</>
                    )}. Thao tác không thể hoàn tác.
                  </span>
                </div>
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Lý do hủy</label>
                  <input
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    placeholder="VD: phiếu tạo nhầm, khách đổi ý..."
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setCancellingReturn(null)}
                    className="flex-1 h-10 border border-gray-200 text-gray-600 rounded-lg text-body-md font-semibold hover:bg-gray-50"
                  >Đóng</button>
                  <button
                    onClick={handleCancelReturn}
                    disabled={submitting}
                    className="flex-1 h-10 bg-red-500 text-white rounded-lg text-body-md font-semibold hover:bg-red-600 disabled:opacity-50"
                  >{submitting ? 'Đang hủy...' : 'Xác nhận hủy phiếu'}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
