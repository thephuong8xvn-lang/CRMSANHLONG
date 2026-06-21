import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Package,
  CheckCircle2,
  ShieldCheck,
  Pencil,
  Ban,
  RotateCcw,
  Warehouse as WarehouseIcon,
  Store,
  Calendar,
  FileText,
  AlertCircle,
  Clock,
  RefreshCw
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { logger } from '../../lib/logger'
import { useAuth } from '../../contexts/AuthContext'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { colLetterToIndex, parseSheetNumber } from '../../lib/gdriveMapping'

interface ReceiptLine {
  id: string
  product_id: string
  quantity: number
  unit_price: number
  lot_number: string | null
  manufacture_date: string | null
  expiry_date: string | null
  product?: { name: string; sku: string; unit: string } | null
}

interface ReceiptDetail {
  id: string
  receipt_code: string
  status: string
  po_id: string | null
  supplier_id: string
  warehouse_id: string
  receipt_date: string
  total_amount: number
  notes: string | null
  received_by: string | null
  verified_by: string | null
  verified_at: string | null
  completed_by: string | null
  completed_at: string | null
  created_at: string
  gsheet_source_id: string | null
  gsheet_file_id: string | null
  gsheet_tab: string | null
  gsheet_synced_at: string | null
  gsheet_row_map: { product_id: string; row: number }[] | null
  supplier?: { name: string } | null
  warehouse?: { name: string } | null
  creator?: { full_name: string } | null
  verifier?: { full_name: string } | null
  completer?: { full_name: string } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Nháp (chờ duyệt)', cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  verified:  { label: 'Đã duyệt (chờ nhập kho)', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  completed: { label: 'Hoàn thành (đã vào kho)', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  cancelled: { label: 'Đã hủy', cls: 'bg-gray-100 text-gray-500 border-gray-200' }
}

export default function GoodsReceiptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile, userRole } = useAuth()
  const { formatCurrency } = useDisplaySettings()

  const isAdmin = userRole?.code === 'admin' || userRole?.code === 'ceo'

  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null)
  const [lines, setLines] = useState<ReceiptLine[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const isCreator = !!receipt && !!profile?.id && receipt.received_by === profile.id

  const loadReceipt = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('goods_receipts')
        .select(`
          id, receipt_code, status, po_id, supplier_id, warehouse_id,
          receipt_date, total_amount, notes, received_by,
          verified_by, verified_at, completed_by, completed_at, created_at,
          gsheet_source_id, gsheet_file_id, gsheet_tab, gsheet_synced_at, gsheet_row_map,
          supplier:suppliers(name),
          warehouse:warehouses(name),
          creator:profiles!goods_receipts_received_by_fkey(full_name),
          verifier:profiles!goods_receipts_verified_by_fkey(full_name),
          completer:profiles!goods_receipts_completed_by_fkey(full_name)
        `)
        .eq('id', id)
        .single()
      if (error) throw error
      setReceipt(data as unknown as ReceiptDetail)

      const { data: lns, error: lnErr } = await supabase
        .from('goods_receipt_lines')
        .select(`id, product_id, quantity, unit_price, lot_number, manufacture_date, expiry_date, product:products(name, sku, unit)`)
        .eq('receipt_id', id)
      if (lnErr) throw lnErr
      setLines((lns || []) as unknown as ReceiptLine[])
    } catch (err: any) {
      logger.error('Error loading goods receipt detail:', err?.message ?? err)
      setReceipt(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadReceipt() }, [loadReceipt])

  const callRpc = async (fn: string, args: Record<string, any>, successText: string) => {
    if (!id) return
    setSubmitting(true)
    setAlertMsg(null)
    try {
      const { error } = await supabase.rpc(fn, args)
      if (error) throw error
      setAlertMsg({ type: 'success', text: successText })
      await loadReceipt()
    } catch (err: any) {
      logger.error(`[GoodsReceiptDetail] ${fn} error:`, err?.message ?? err)
      setAlertMsg({ type: 'error', text: err.message || 'Thao tác thất bại.' })
    } finally {
      setSubmitting(false)
      setShowCancel(false)
    }
  }

  const handleVerify = () => callRpc('fn_verify_goods_receipt', { p_receipt_id: id }, 'Đã duyệt phiếu. Giờ có thể bấm Hoàn thành để nhập kho.')
  const handleComplete = () => callRpc('fn_complete_goods_receipt', { p_receipt_id: id }, 'Hoàn thành! Hàng đã được nhập vào kho và ghi thẻ kho.')
  const handleReopen = () => callRpc('fn_reopen_goods_receipt', { p_receipt_id: id }, 'Đã trả phiếu về trạng thái Nháp để chỉnh sửa.')
  const handleCancel = () => callRpc('fn_cancel_goods_receipt', { p_receipt_id: id, p_reason: cancelReason || null }, 'Đã hủy phiếu nhập.')

  // Đồng bộ lại giá nhập từ Google Sheet (CHỈ khi còn nháp). Sau khi duyệt, RPC sẽ raise lỗi.
  const handleResyncPrices = async () => {
    if (!id || !receipt?.gsheet_file_id || !receipt.gsheet_source_id || !receipt.gsheet_tab) return
    setSubmitting(true)
    setAlertMsg(null)
    try {
      const { data: src, error: srcErr } = await supabase
        .from('gdrive_sources').select('column_map').eq('id', receipt.gsheet_source_id).single()
      if (srcErr) throw srcErr
      const priceCol = (src?.column_map as any)?.import_price
      if (!priceCol) throw new Error('Nguồn chưa cấu hình cột Giá nhập.')

      const { data: sheetRes, error: fErr } = await supabase.functions.invoke('gdrive-proxy', {
        body: { action: 'read-sheet', source_id: receipt.gsheet_source_id, file_id: receipt.gsheet_file_id, tab: receipt.gsheet_tab },
      })
      if (fErr) throw new Error(fErr.message)
      if ((sheetRes as any)?.error) throw new Error((sheetRes as any).error)
      const values: any[][] = (sheetRes as any)?.values ?? []

      const colIdx = colLetterToIndex(priceCol)
      const rowMap = receipt.gsheet_row_map ?? []
      const prices = rowMap
        .map((rm) => ({ product_id: rm.product_id, unit_price: parseSheetNumber((values[rm.row - 1] || [])[colIdx]) }))
        .filter((p) => p.product_id && p.unit_price > 0)
      if (prices.length === 0) throw new Error('Không đọc được giá hợp lệ từ Sheet.')

      const { error } = await supabase.rpc('fn_sync_gsheet_draft_prices', { p_receipt_id: id, p_prices: prices })
      if (error) throw error
      setAlertMsg({ type: 'success', text: `Đã đồng bộ giá ${prices.length} dòng từ Google Sheet.` })
      await loadReceipt()
    } catch (err: any) {
      logger.error('[GoodsReceiptDetail] resync error:', err?.message ?? err)
      setAlertMsg({ type: 'error', text: 'Đồng bộ giá thất bại: ' + (err.message || err) })
    } finally {
      setSubmitting(false)
    }
  }
  const canResync = receipt?.status === 'draft' && !!receipt?.gsheet_file_id && (isCreator || isAdmin)

  if (loading) {
    return (
      <Layout activeMenu="Kho hàng">
        <div className="py-32 flex flex-col items-center justify-center text-gray-400">
          <div className="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4" />
          <span className="text-body-md">Đang tải chi tiết phiếu nhập...</span>
        </div>
      </Layout>
    )
  }

  if (!receipt) {
    return (
      <Layout activeMenu="Kho hàng">
        <div className="py-24 text-center text-gray-400">
          <AlertCircle className="mx-auto text-gray-300 mb-4" size={64} />
          <h2 className="text-display-xs font-bold text-gray-600">Không tìm thấy phiếu nhập</h2>
          <p className="mt-2 text-body-md">Phiếu có thể đã bị xóa hoặc bạn không có quyền xem.</p>
          <button onClick={() => navigate('/inventory')} className="mt-6 px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors">
            Về Kho hàng
          </button>
        </div>
      </Layout>
    )
  }

  const meta = STATUS_META[receipt.status] || STATUS_META.draft
  const canEditDraft = receipt.status === 'draft' && (isCreator || isAdmin)
  const canVerify = receipt.status === 'draft' && isAdmin
  const canComplete = receipt.status === 'verified' && (isCreator || isAdmin)
  const canReopen = receipt.status === 'verified' && isAdmin
  const canCancel = (receipt.status === 'draft' || receipt.status === 'verified') && (isCreator || isAdmin)

  // Stepper
  const steps = [
    { key: 'draft', label: 'Nháp', icon: FileText },
    { key: 'verified', label: 'Đã duyệt', icon: ShieldCheck },
    { key: 'completed', label: 'Hoàn thành', icon: CheckCircle2 }
  ]
  const stepIndex = receipt.status === 'completed' ? 2 : receipt.status === 'verified' ? 1 : 0
  const isCancelled = receipt.status === 'cancelled'

  const lineTotal = (l: ReceiptLine) => Number(l.unit_price) * Number(l.quantity)
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0)

  return (
    <Layout activeMenu="Kho hàng">
      <div className="p-4 md:p-8 max-w-[1100px] w-full mx-auto space-y-6">

        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border ${
            alertMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <AlertCircle size={18} className={alertMsg.type === 'success' ? 'text-emerald-600' : 'text-red-600'} />
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <button onClick={() => navigate('/inventory')} className="flex items-center gap-1.5 text-body-md text-gray-400 hover:text-blue-500 transition-colors font-semibold">
              <ArrowLeft size={16} /> Về Kho hàng
            </button>
            <div className="flex items-center flex-wrap gap-3 mt-1">
              <h2 className="text-display-xs font-bold text-gray-800">Phiếu nhập {receipt.receipt_code}</h2>
              <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>
            </div>
          </div>
        </div>

        {/* Stepper */}
        {!isCancelled ? (
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
            <div className="flex items-center">
              {steps.map((s, i) => {
                const Icon = s.icon
                const done = i <= stepIndex
                return (
                  <div key={s.key} className="flex-1 flex items-center last:flex-none">
                    <div className="flex flex-col items-center gap-1.5">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                        done ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-200 text-gray-300'
                      }`}>
                        <Icon size={18} />
                      </div>
                      <span className={`text-tiny font-semibold ${done ? 'text-blue-600' : 'text-gray-400'}`}>{s.label}</span>
                    </div>
                    {i < steps.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-2 ${i < stepIndex ? 'bg-blue-500' : 'bg-gray-150'}`} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-2 text-gray-500">
            <Ban size={18} /> <span className="font-semibold">Phiếu này đã bị hủy.</span>
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
          <Meta icon={<Store size={16} />} label="Nhà cung cấp" value={receipt.supplier?.name || '—'} />
          <Meta icon={<WarehouseIcon size={16} />} label="Kho nhận" value={receipt.warehouse?.name || '—'} />
          <Meta icon={<Calendar size={16} />} label="Ngày nhập" value={new Date(receipt.receipt_date).toLocaleDateString('vi-VN')} />
          <Meta icon={<FileText size={16} />} label="Hình thức" value={receipt.po_id ? 'Nhập từ PO' : 'Nhập trực tiếp'} />
          <Meta icon={<Package size={16} />} label="Người lập" value={receipt.creator?.full_name || '—'} />
          <Meta icon={<Clock size={16} />} label="Ngày tạo" value={new Date(receipt.created_at).toLocaleString('vi-VN')} />
          {receipt.verified_by && (
            <Meta icon={<ShieldCheck size={16} />} label="Người duyệt" value={`${receipt.verifier?.full_name || '—'}${receipt.verified_at ? ' · ' + new Date(receipt.verified_at).toLocaleString('vi-VN') : ''}`} />
          )}
          {receipt.completed_by && (
            <Meta icon={<CheckCircle2 size={16} />} label="Người hoàn thành" value={`${receipt.completer?.full_name || '—'}${receipt.completed_at ? ' · ' + new Date(receipt.completed_at).toLocaleString('vi-VN') : ''}`} />
          )}
          <div className="md:col-span-2 border-t border-gray-100 pt-3">
            <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ghi chú</span>
            <span className="text-body-md text-gray-700 italic">{receipt.notes || 'Không có ghi chú'}</span>
          </div>
        </div>

        {/* Lines */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-body-lg font-bold text-gray-800">Danh sách sản phẩm ({lines.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase">
                  <th className="px-4 py-3 min-w-[200px]">Sản phẩm / SKU</th>
                  <th className="px-4 py-3 whitespace-nowrap">Số lô</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">Hạn sử dụng</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">Số lượng</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Đơn giá nhập</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Thành tiền</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                {lines.map(l => (
                  <tr key={l.id} className="hover:bg-gray-25/30">
                    <td className="px-4 py-3 min-w-[200px]">
                      <p className="font-bold text-gray-700 break-words">{l.product?.name || 'Sản phẩm không rõ'}</p>
                      <span className="text-tiny text-gray-400 font-mono">SKU: {l.product?.sku}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-blue-500 font-semibold whitespace-nowrap">{l.lot_number || 'N/A'}</td>
                    <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">
                      {l.expiry_date ? new Date(l.expiry_date).toLocaleDateString('vi-VN') : '---'}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-gray-800 whitespace-nowrap">{l.quantity} {l.product?.unit}</td>
                    <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">{formatCurrency(Number(l.unit_price))}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-850 whitespace-nowrap">{formatCurrency(lineTotal(l))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-6 text-body-md">
            <span className="text-gray-500">Tổng tiền hàng (chưa VAT): <strong className="text-gray-800">{formatCurrency(subtotal)}</strong></span>
            <span className="text-gray-500">Tổng giá trị phiếu: <strong className="text-blue-600 text-body-lg">{formatCurrency(Number(receipt.total_amount))}</strong></span>
          </div>
        </div>

        {/* Actions */}
        {(canEditDraft || canVerify || canComplete || canReopen || canCancel || canResync) && (
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-wrap items-center gap-3">
            {canResync && (
              <button onClick={handleResyncPrices} disabled={submitting}
                className="h-11 px-5 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-50">
                <RefreshCw size={16} /> Đồng bộ lại giá từ Google Sheet
              </button>
            )}
            {canComplete && (
              <button onClick={handleComplete} disabled={submitting}
                className="h-11 px-6 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg shadow-md flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-all">
                <CheckCircle2 size={18} /> Xác nhận hoàn thành (nhập kho)
              </button>
            )}
            {canVerify && (
              <button onClick={handleVerify} disabled={submitting}
                className="h-11 px-6 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg shadow-md flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-all">
                <ShieldCheck size={18} /> Xác nhận thông tin đúng (duyệt)
              </button>
            )}
            {canEditDraft && (
              <button onClick={() => navigate(`/goods-receipts/new?id=${receipt.id}`)} disabled={submitting}
                className="h-11 px-5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold rounded-lg flex items-center gap-2 transition-all">
                <Pencil size={16} /> Sửa phiếu
              </button>
            )}
            {canReopen && (
              <button onClick={handleReopen} disabled={submitting}
                className="h-11 px-5 border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold rounded-lg flex items-center gap-2 transition-all">
                <RotateCcw size={16} /> Trả về nháp
              </button>
            )}
            {canCancel && (
              <button onClick={() => setShowCancel(true)} disabled={submitting}
                className="h-11 px-5 border border-red-100 bg-red-50 hover:bg-red-100 text-red-600 font-semibold rounded-lg flex items-center gap-2 transition-all ml-auto">
                <Ban size={16} /> Hủy phiếu
              </button>
            )}
          </div>
        )}

        {receipt.status === 'verified' && (
          <p className="text-tiny text-gray-400 text-center">
            Phiếu đã được Admin duyệt. Người lập hoặc Admin bấm <strong>Hoàn thành</strong> để hàng chính thức vào kho.
          </p>
        )}
      </div>

      {/* Cancel modal */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Ban className="text-red-600" size={18} />
              </div>
              <div>
                <h3 className="text-headline-md font-bold text-gray-800">Hủy phiếu nhập?</h3>
                <p className="text-body-sm text-gray-500 mt-1">Phiếu sẽ chuyển sang trạng thái "Đã hủy". Hàng chưa vào kho nên tồn kho không bị ảnh hưởng.</p>
              </div>
            </div>
            <label className="block text-tiny font-semibold text-gray-500 mb-1">Lý do hủy (không bắt buộc)</label>
            <textarea rows={2} value={cancelReason} onChange={e => setCancelReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500"
              placeholder="VD: Nhập sai NCC, sai số lượng..." />
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => { setShowCancel(false); setCancelReason('') }} className="h-10 px-4 border border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-50">Đóng</button>
              <button disabled={submitting} onClick={handleCancel} className="h-10 px-5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-60">
                {submitting ? 'Đang hủy...' : 'Xác nhận hủy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="text-gray-400 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">{label}</span>
        <span className="font-semibold text-gray-700 break-words">{value}</span>
      </div>
    </div>
  )
}
