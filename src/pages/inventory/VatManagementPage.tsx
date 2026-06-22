import { useMemo, useState } from 'react'
import { ReceiptText, FileCheck2, Boxes, AlertCircle, X } from 'lucide-react'
import Layout from '../../components/Layout'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { useAuth } from '../../contexts/AuthContext'
import {
  useVatStock, useVatPendingSales, useVatIssuances, useVatIssue,
  type VatStockRow, type VatPendingSale, type VatIssuance,
} from '../../hooks/useVat'

const fmtCurrency = (n: number) => (n || 0).toLocaleString('vi-VN') + '₫'
const fmtNum = (n: number) => (n || 0).toLocaleString('vi-VN')
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : '—')
const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const todayISO = () => new Date().toISOString().split('T')[0]

type Tab = 'stock' | 'pending' | 'issued'

export default function VatManagementPage() {
  const { profile, userRole } = useAuth()
  const isAdmin = userRole?.code === 'admin' || userRole?.code === 'ceo'
  const branchId = isAdmin ? null : (profile?.branch_id ?? null)

  const [tab, setTab] = useState<Tab>('pending')
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showIssue, setShowIssue] = useState(false)
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const stockQ = useVatStock(branchId)
  const pendingQ = useVatPendingSales(from, to)
  const issuedQ = useVatIssuances()
  const issueMut = useVatIssue()

  const pendingRows = pendingQ.data ?? []
  const selectedRows = useMemo(() => pendingRows.filter((r) => selected.has(r.id)), [pendingRows, selected])
  const selTotals = useMemo(() => {
    const subtotal = selectedRows.reduce((s, r) => s + Number(r.line_amount || 0), 0)
    const vat = selectedRows.reduce((s, r) => s + Math.round(Number(r.line_amount || 0) * Number(r.vat_rate || 0) / 100), 0)
    return { subtotal, vat, total: subtotal + vat }
  }, [selectedRows])

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = pendingRows.length > 0 && pendingRows.every((r) => selected.has(r.id))
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(pendingRows.map((r) => r.id)))

  // ── Cột: Tồn VAT ──
  const stockCols: DataTableColumn<VatStockRow>[] = [
    { key: 'sku', header: 'Mã hàng', width: 120, render: (p) => <span className="font-mono text-[12px] text-gray-500">{p.sku || '—'}</span> },
    { key: 'name', header: 'Tên hàng', flex: true, minWidth: 220, noTruncate: true, render: (p) => <span className="font-semibold text-gray-800">{p.name}</span> },
    { key: 'unit', header: 'ĐVT', width: 70, render: (p) => <span className="text-gray-600">{p.unit || '—'}</span> },
    { key: 'vat', header: 'Tồn HĐ đỏ', width: 110, align: 'right', render: (p) => <span className="font-bold text-emerald-700 tabular-nums">{fmtNum(p.vat_stock)}</span> },
    { key: 'nonvat', header: 'Tồn không HĐ', width: 130, align: 'right', render: (p) => <span className="text-gray-500 tabular-nums">{fmtNum(p.nonvat_stock)}</span> },
  ]

  // ── Cột: Chờ xuất VAT ──
  const pendingCols: DataTableColumn<VatPendingSale>[] = [
    {
      key: 'sel', header: (<input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4" aria-label="Chọn tất cả" />),
      width: 44, align: 'center', noTruncate: true,
      render: (r) => <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} className="w-4 h-4" />,
    },
    { key: 'sold_at', header: 'Ngày bán', width: 140, render: (r) => <span className="text-gray-600 text-tiny">{fmtDateTime(r.sold_at)}</span> },
    { key: 'order', header: 'Đơn', width: 130, render: (r) => <span className="font-mono text-[12px] text-blue-600">{r.order_code || '—'}</span> },
    { key: 'product', header: 'Sản phẩm', flex: true, minWidth: 200, noTruncate: true, render: (r) => <span className="font-semibold text-gray-800">{r.product_name || '—'}</span> },
    { key: 'customer', header: 'Khách hàng', width: 160, render: (r) => <span className="text-gray-600 truncate">{r.customer_name || '—'}</span> },
    { key: 'qty', header: 'SL', width: 64, align: 'right', render: (r) => <span className="tabular-nums">{fmtNum(r.quantity)}</span> },
    { key: 'amount', header: 'Thành tiền', width: 120, align: 'right', render: (r) => <span className="font-semibold tabular-nums">{fmtCurrency(r.line_amount)}</span> },
    { key: 'rate', header: 'TS', width: 60, align: 'right', render: (r) => <span className="text-emerald-700 font-bold">{Number(r.vat_rate)}%</span> },
  ]

  // ── Cột: Đã xuất ──
  const issuedCols: DataTableColumn<VatIssuance>[] = [
    { key: 'issue_date', header: 'Ngày xuất', width: 120, render: (r) => <span className="text-gray-700">{fmtDate(r.issue_date)}</span> },
    { key: 'invoice_no', header: 'Số HĐ', width: 130, render: (r) => <span className="font-mono text-[12px] text-gray-700">{r.invoice_no || '—'}</span> },
    { key: 'buyer', header: 'Người mua', flex: true, minWidth: 180, noTruncate: true, render: (r) => <span className="text-gray-700">{r.buyer_name || '—'}</span> },
    { key: 'subtotal', header: 'Tiền hàng', width: 120, align: 'right', render: (r) => <span className="tabular-nums">{fmtCurrency(r.subtotal)}</span> },
    { key: 'vat', header: 'Tiền VAT', width: 110, align: 'right', render: (r) => <span className="text-emerald-700 tabular-nums">{fmtCurrency(r.vat_amount)}</span> },
    { key: 'total', header: 'Tổng', width: 130, align: 'right', render: (r) => <span className="font-bold text-blue-700 tabular-nums">{fmtCurrency(r.total)}</span> },
    { key: 'created', header: 'Lập lúc', width: 140, render: (r) => <span className="text-gray-400 text-tiny">{fmtDateTime(r.created_at)}</span> },
  ]

  const tabs: { key: Tab; label: string; icon: React.ComponentType<any> }[] = [
    { key: 'pending', label: 'Chờ xuất VAT', icon: ReceiptText },
    { key: 'issued', label: 'Đã xuất', icon: FileCheck2 },
    { key: 'stock', label: 'Tồn hàng VAT', icon: Boxes },
  ]

  return (
    <Layout activeMenu="Quản lý VAT">
      <div className="p-4 md:p-8 max-w-[1500px] mx-auto space-y-5">
        {alert && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-body-md max-w-md ${
            alert.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
            <AlertCircle size={18} className="shrink-0" /><span>{alert.text}</span>
            <button onClick={() => setAlert(null)} className="ml-1"><X size={16} /></button>
          </div>
        )}

        <div>
          <h1 className="text-headline-md font-bold text-gray-800 flex items-center gap-2">
            <ReceiptText className="text-emerald-600" size={24} /> Quản lý VAT
          </h1>
          <p className="text-body-md text-gray-400">Theo dõi hàng nhóm VAT đã bán → gộp xuất hóa đơn cuối ngày.</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-100">
          {tabs.map((t) => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-body-md font-semibold flex items-center gap-1.5 border-b-2 -mb-px ${
                  active ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <Icon size={16} /> {t.label}
              </button>
            )
          })}
        </div>

        {/* Tab: Chờ xuất */}
        {tab === 'pending' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-tiny text-gray-500">Từ ngày</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 px-2 border border-gray-200 rounded-lg text-body-md" />
                <label className="text-tiny text-gray-500">đến</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 px-2 border border-gray-200 rounded-lg text-body-md" />
                <span className="text-tiny text-gray-400">Đã chọn {selected.size} dòng</span>
              </div>
              <button onClick={() => setShowIssue(true)} disabled={selected.size === 0}
                className="h-9 px-4 bg-emerald-600 text-white rounded-lg text-body-md font-semibold hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1.5">
                <FileCheck2 size={15} /> Tạo phiếu xuất VAT ({selected.size})
              </button>
            </div>
            <DataTable
              columns={pendingCols} rows={pendingRows} getRowKey={(r) => r.id}
              loading={pendingQ.isLoading} onRowClick={(r) => toggle(r.id)}
              itemLabel="dòng" resetSignal={`${from}|${to}`}
              emptyText="Không có hàng VAT nào chờ xuất trong khoảng ngày này."
            />
          </div>
        )}

        {/* Tab: Đã xuất */}
        {tab === 'issued' && (
          <DataTable
            columns={issuedCols} rows={issuedQ.data ?? []} getRowKey={(r) => r.id}
            loading={issuedQ.isLoading} itemLabel="phiếu"
            emptyText="Chưa có phiếu xuất VAT nào."
          />
        )}

        {/* Tab: Tồn VAT */}
        {tab === 'stock' && (
          <DataTable
            columns={stockCols} rows={stockQ.data ?? []} getRowKey={(r) => r.id}
            loading={stockQ.isLoading} itemLabel="sản phẩm"
            emptyText="Không có sản phẩm nào còn tồn VAT."
          />
        )}
      </div>

      {/* Modal xuất VAT */}
      {showIssue && (
        <IssueModal
          count={selectedRows.length} totals={selTotals}
          submitting={issueMut.isPending}
          onClose={() => setShowIssue(false)}
          onSubmit={async (form) => {
            try {
              await issueMut.mutateAsync({ saleIds: selectedRows.map((r) => r.id), ...form })
              setShowIssue(false); setSelected(new Set())
              setAlert({ type: 'success', text: `Đã xuất hóa đơn VAT cho ${selectedRows.length} dòng.` })
            } catch (e: any) {
              setAlert({ type: 'error', text: 'Lỗi xuất VAT: ' + (e.message || e) })
            }
          }}
        />
      )}
    </Layout>
  )
}

// ── Modal nhập thông tin hóa đơn xuất ──
function IssueModal({ count, totals, submitting, onClose, onSubmit }: {
  count: number
  totals: { subtotal: number; vat: number; total: number }
  submitting: boolean
  onClose: () => void
  onSubmit: (form: { invoiceNo: string; issueDate: string; buyerName?: string; buyerTaxCode?: string; buyerAddress?: string; note?: string }) => void
}) {
  const [invoiceNo, setInvoiceNo] = useState('')
  const [issueDate, setIssueDate] = useState(todayISO())
  const [buyerName, setBuyerName] = useState('')
  const [buyerTaxCode, setBuyerTaxCode] = useState('')
  const [buyerAddress, setBuyerAddress] = useState('')
  const [note, setNote] = useState('')

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h3 className="text-body-lg font-bold text-gray-800">Tạo phiếu xuất VAT</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-body-md text-emerald-800">
            Gộp <b>{count}</b> dòng bán · Tiền hàng <b>{fmtCurrency(totals.subtotal)}</b> · VAT <b>{fmtCurrency(totals.vat)}</b> · Tổng <b>{fmtCurrency(totals.total)}</b>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-tiny font-semibold text-gray-600">Số hóa đơn</label>
              <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="VD: 0001234" className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-md" />
            </div>
            <div className="space-y-1">
              <label className="text-tiny font-semibold text-gray-600">Ngày xuất *</label>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-md" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-tiny font-semibold text-gray-600">Tên người mua</label>
            <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-md" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-tiny font-semibold text-gray-600">Mã số thuế</label>
              <input value={buyerTaxCode} onChange={(e) => setBuyerTaxCode(e.target.value)} className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-md" />
            </div>
            <div className="space-y-1">
              <label className="text-tiny font-semibold text-gray-600">Địa chỉ</label>
              <input value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-md" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-tiny font-semibold text-gray-600">Ghi chú</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full h-9 px-2 border border-gray-200 rounded-lg text-body-md" />
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="h-9 px-4 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50">Hủy</button>
          <button onClick={() => onSubmit({ invoiceNo, issueDate, buyerName, buyerTaxCode, buyerAddress, note })}
            disabled={submitting || !issueDate}
            className="h-9 px-4 bg-emerald-600 text-white rounded-lg text-body-md font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {submitting ? 'Đang xuất…' : 'Xác nhận xuất'}
          </button>
        </div>
      </div>
    </div>
  )
}
