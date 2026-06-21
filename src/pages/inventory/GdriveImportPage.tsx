import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileSpreadsheet, FolderOpen, RefreshCw, Settings, AlertCircle, AlertTriangle,
  CheckCircle, Save, Cloud, ArrowLeft, Search,
} from 'lucide-react'
import Layout from '../../components/Layout'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import DecimalInput from '../../components/DecimalInput'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAuth } from '../../contexts/AuthContext'
import {
  useGdriveSources, useDriveFiles, useSheetInfo, useSheetValues,
  useWriteCells, useProductAliases, useUpsertAlias, type GdriveSource,
} from '../../hooks/useGdriveImport'
import { cellAt, parseSheetNumber, normalizeAlias } from '../../lib/gdriveMapping'

interface ProdOpt { value: string; label: string; sku: string; unit: string; is_lot_managed: boolean; norm: string }

interface ParsedRow {
  sheetRow: number
  name: string
  price: number
  qty: number
  lot: string
  mfg: string
  exp: string
}

export default function GdriveImportPage() {
  const navigate = useNavigate()
  const { profile, user, userRole } = useAuth()

  const { data: sources = [], isLoading: loadingSources } = useGdriveSources(true)
  const [sourceId, setSourceId] = useState<string>('')
  const [fileId, setFileId] = useState<string>('')
  const [tab, setTab] = useState<string>('')
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  const source: GdriveSource | undefined = useMemo(() => sources.find((s) => s.id === sourceId), [sources, sourceId])

  const { data: files = [], isLoading: loadingFiles, refetch: refetchFiles } = useDriveFiles(sourceId || null)
  const { data: sheetInfo } = useSheetInfo(sourceId || null, fileId || null)
  const { data: values = [], isLoading: loadingSheet, refetch: refetchSheet } = useSheetValues(sourceId || null, fileId || null, tab || null)

  const { data: aliases = [] } = useProductAliases(source?.supplier_id || null)
  const writeCells = useWriteCells()
  const upsertAlias = useUpsertAlias()

  // Products để auto-khớp + map thủ công
  const [products, setProducts] = useState<ProdOpt[]>([])
  // Kho khả dụng (để chọn kho nhận khi tạo phiếu)
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [warehouseId, setWarehouseId] = useState<string>('')

  // Override giá đã sửa cục bộ (ghi ngược Sheet). `written` = giá đã ghi lên Sheet.
  const [edits, setEdits] = useState<Record<number, { price: number; written?: number }>>({})
  // Map SP thủ công cho dòng chưa khớp: sheetRow → product_id
  const [manualResolve, setManualResolve] = useState<Record<number, string>>({})
  // Dòng được chọn đưa vào phiếu
  const [included, setIncluded] = useState<Record<number, boolean>>({})
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (alert) { const t = setTimeout(() => setAlert(null), 5000); return () => clearTimeout(t) }
  }, [alert])

  // Nạp products + warehouses 1 lần
  useEffect(() => {
    const load = async () => {
      const prods = await fetchAllRows<any>((from, to) =>
        supabase.from('products').select('id, sku, name, unit, is_lot_managed').eq('is_active', true).order('name').order('id').range(from, to))
      setProducts(prods.map((p) => ({
        value: p.id, label: p.name, sku: p.sku || '', unit: p.unit || '', is_lot_managed: !!p.is_lot_managed, norm: normalizeAlias(p.name),
      })))
      let whQ = supabase.from('warehouses').select('id, name, branch_id')
      if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) whQ = whQ.eq('branch_id', profile.branch_id)
      const { data: wh } = await whQ
      setWarehouses((wh ?? []).map((w: any) => ({ id: w.id, name: w.name })))
    }
    load()
  }, [profile?.branch_id, userRole?.code])

  // Chọn tab mặc định khi có sheetInfo
  useEffect(() => {
    if (sheetInfo?.tabs?.length && !tab) setTab(sheetInfo.tabs[0].title)
  }, [sheetInfo, tab])

  // Đặt kho mặc định theo source
  useEffect(() => {
    if (source?.default_warehouse_id) setWarehouseId(source.default_warehouse_id)
    else if (warehouses.length && !warehouseId) setWarehouseId(warehouses[0].id)
  }, [source, warehouses])

  // Reset khi đổi file/tab
  useEffect(() => { setEdits({}); setManualResolve({}); setIncluded({}) }, [fileId, tab])

  // ── Index khớp SP: alias (theo NCC) → tên chuẩn hóa products ──
  const aliasMap = useMemo(() => new Map(aliases.map((a) => [a.external_name_norm, a.product_id])), [aliases])
  const prodNormMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products) if (!m.has(p.norm)) m.set(p.norm, p.value)
    return m
  }, [products])
  const prodById = useMemo(() => new Map(products.map((p) => [p.value, p])), [products])

  const autoResolve = useCallback((name: string): string | null => {
    const n = normalizeAlias(name)
    return aliasMap.get(n) || prodNormMap.get(n) || null
  }, [aliasMap, prodNormMap])

  // ── Parse dòng dữ liệu từ Sheet theo column_map ──
  const parsedRows: ParsedRow[] = useMemo(() => {
    if (!source || !values.length) return []
    const cm = source.column_map
    const rows: ParsedRow[] = []
    for (let i = source.data_start_row - 1; i < values.length; i++) {
      const r = values[i] || []
      const name = String(cellAt(r, cm.name) ?? '').trim()
      if (!name) continue
      rows.push({
        sheetRow: i + 1,
        name,
        price: parseSheetNumber(cellAt(r, cm.import_price)),
        qty: cm.quantity ? (parseSheetNumber(cellAt(r, cm.quantity)) || 1) : 1,
        lot: cm.lot ? String(cellAt(r, cm.lot) ?? '').trim() : '',
        mfg: cm.mfg_date ? String(cellAt(r, cm.mfg_date) ?? '').trim() : '',
        exp: cm.exp_date ? String(cellAt(r, cm.exp_date) ?? '').trim() : '',
      })
    }
    return rows
  }, [source, values])

  // Khởi tạo "included" mặc định: chọn dòng khớp được
  useEffect(() => {
    if (!parsedRows.length) return
    setIncluded((prev) => {
      const next = { ...prev }
      for (const row of parsedRows) {
        if (next[row.sheetRow] === undefined) {
          const pid = manualResolve[row.sheetRow] || autoResolve(row.name)
          next[row.sheetRow] = !!pid
        }
      }
      return next
    })
  }, [parsedRows, autoResolve]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolvedFor = useCallback((row: ParsedRow): string | null => {
    return manualResolve[row.sheetRow] || autoResolve(row.name)
  }, [manualResolve, autoResolve])

  const priceFor = (row: ParsedRow) => edits[row.sheetRow]?.price ?? row.price

  const matchedCount = parsedRows.filter((r) => resolvedFor(r)).length
  const includedRows = parsedRows.filter((r) => included[r.sheetRow] && resolvedFor(r))

  // ── Ghi ngược 1 ô giá lên Sheet (gọi khi blur ô giá, nếu đổi & chưa ghi) ──
  const commitPrice = async (row: ParsedRow) => {
    const cur = edits[row.sheetRow]?.price
    if (cur === undefined || cur === row.price) return
    if (edits[row.sheetRow]?.written === cur) return
    if (!source?.column_map.import_price || !fileId || !tab) return
    try {
      await writeCells.mutateAsync({
        sourceId, fileId, tab,
        updates: [{ range: `${tab}!${source.column_map.import_price}${row.sheetRow}`, values: [[cur]] }],
      })
      setEdits((e) => ({ ...e, [row.sheetRow]: { price: cur, written: cur } }))
      setAlert({ type: 'success', text: `Đã ghi giá ${cur.toLocaleString('vi-VN')}₫ lên Sheet (dòng ${row.sheetRow}).` })
    } catch (e: any) {
      setAlert({ type: 'error', text: 'Ghi ngược thất bại: ' + (e.message || e) })
    }
  }

  // ── Map SP thủ công cho 1 dòng + lưu bí danh để học ──
  const handleMapProduct = async (row: ParsedRow, productId: string) => {
    setManualResolve((m) => ({ ...m, [row.sheetRow]: productId }))
    setIncluded((inc) => ({ ...inc, [row.sheetRow]: true }))
    if (source) {
      try {
        await upsertAlias.mutateAsync({ supplierId: source.supplier_id, externalName: row.name, productId, userId: profile?.id })
      } catch { /* alias là tiện ích, lỗi không chặn */ }
    }
  }

  // ── Tạo phiếu nhập NHÁP ──
  const handleCreateDraft = async () => {
    if (!source) return
    if (!warehouseId) { setAlert({ type: 'error', text: 'Chọn kho nhận hàng.' }); return }
    if (includedRows.length === 0) { setAlert({ type: 'error', text: 'Chưa có dòng nào khớp sản phẩm để tạo phiếu.' }); return }
    const receivedBy = profile?.id ?? user?.id
    if (!receivedBy) { setAlert({ type: 'error', text: 'Không xác định người dùng. Đăng nhập lại.' }); return }

    setCreating(true)
    try {
      // Lưu alias cho mọi dòng auto-khớp qua tên (để lần sau nhanh hơn)
      for (const row of includedRows) {
        const pid = resolvedFor(row)!
        if (!manualResolve[row.sheetRow] && !aliasMap.has(normalizeAlias(row.name))) {
          try { await upsertAlias.mutateAsync({ supplierId: source.supplier_id, externalName: row.name, productId: pid, userId: profile?.id }) } catch { /* ignore */ }
        }
      }

      const vat = source.vat_default
      const vatRate = vat === 'none' ? 0 : vat === '5' ? 0.05 : 0.10
      const subtotal = includedRows.reduce((s, r) => s + priceFor(r) * r.qty, 0)
      const totalWithVat = subtotal * (1 + vatRate)
      const vatLabel = vat === 'none' ? 'Không VAT' : `VAT ${vat}%`
      const code = `GR-${Math.floor(100000 + Math.random() * 900000)}`
      const rowMap = includedRows.map((r) => ({ product_id: resolvedFor(r), row: r.sheetRow }))

      const { data: gr, error: grErr } = await supabase.from('goods_receipts').insert([{
        receipt_code: code,
        supplier_id: source.supplier_id,
        warehouse_id: warehouseId,
        receipt_date: new Date().toISOString().split('T')[0],
        total_amount: totalWithVat,
        received_by: receivedBy,
        notes: `Nhập từ Google Drive (${source.label}). [Lựa chọn thuế: ${vatLabel}].`,
        gsheet_source_id: source.id,
        gsheet_file_id: fileId,
        gsheet_tab: tab,
        gsheet_synced_at: new Date().toISOString(),
        gsheet_row_map: rowMap,
      }]).select().single()
      if (grErr) {
        if (grErr.code === '42501' || grErr.message?.includes('row-level security')) {
          throw new Error('Bạn không có quyền nhập kho (cần inventory.receive).')
        }
        throw grErr
      }

      const lines = includedRows.map((r) => ({
        receipt_id: gr.id,
        po_line_id: null,
        product_id: resolvedFor(r),
        quantity: r.qty,
        unit_price: priceFor(r),
        lot_number: r.lot || null,
        manufacture_date: r.mfg || null,
        expiry_date: r.exp || null,
      }))
      const { error: lnErr } = await supabase.from('goods_receipt_lines').insert(lines)
      if (lnErr) throw lnErr

      setAlert({ type: 'success', text: `Đã tạo phiếu nháp ${code}. Đang chuyển tới trang duyệt…` })
      setTimeout(() => navigate(`/goods-receipts/${gr.id}`), 1000)
    } catch (e: any) {
      setAlert({ type: 'error', text: 'Lỗi tạo phiếu: ' + (e.message || e) })
    } finally { setCreating(false) }
  }

  const canConfig = userRole?.code === 'admin' || userRole?.code === 'ceo'

  return (
    <Layout activeMenu="Nhập từ Drive">
      <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5">
        {alert && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-body-md ${
            alert.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : alert.type === 'error' ? 'bg-red-50 text-red-800 border-red-200'
            : 'bg-blue-50 text-blue-800 border-blue-200'}`}>
            <AlertCircle size={18} /><span>{alert.text}</span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-headline-md font-bold text-gray-800 flex items-center gap-2">
              <FileSpreadsheet className="text-blue-500" size={24} /> Nhập hàng từ Google Drive
            </h1>
            <p className="text-body-md text-gray-400">Đọc bảng giá trên Google Sheets → tạo phiếu nhập nháp đồng bộ giá.</p>
          </div>
          {canConfig && (
            <button onClick={() => navigate('/inventory/gdrive-sources')} className="h-10 px-4 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
              <Settings size={16} /> Cấu hình nguồn
            </button>
          )}
        </div>

        {/* Chọn nguồn / file / tab */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-body-md font-semibold text-gray-700">Công ty / Nguồn</label>
            <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setFileId(''); setTab('') }} className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md bg-white">
              <option value="">{loadingSources ? 'Đang tải…' : '-- Chọn nguồn --'}</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {!loadingSources && sources.length === 0 && (
              <p className="text-tiny text-amber-600">Chưa có nguồn nào.{canConfig ? ' Bấm "Cấu hình nguồn" để thêm.' : ' Liên hệ Admin cấu hình.'}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-body-md font-semibold text-gray-700 flex items-center justify-between">
              File Sheet
              {sourceId && <button onClick={() => refetchFiles()} className="text-tiny text-blue-500 hover:underline flex items-center gap-0.5"><RefreshCw size={11} /> Tải lại</button>}
            </label>
            <select value={fileId} onChange={(e) => { setFileId(e.target.value); setTab('') }} disabled={!sourceId} className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md bg-white disabled:bg-gray-50">
              <option value="">{loadingFiles ? 'Đang tải…' : '-- Chọn file --'}</option>
              {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-body-md font-semibold text-gray-700">Trang tính (tab)</label>
            <select value={tab} onChange={(e) => setTab(e.target.value)} disabled={!fileId} className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md bg-white disabled:bg-gray-50">
              <option value="">-- Chọn tab --</option>
              {sheetInfo?.tabs?.map((t) => <option key={t.title} value={t.title}>{t.title}</option>)}
            </select>
          </div>
        </div>

        {/* Lưới dữ liệu */}
        {sourceId && fileId && tab && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="text-body-lg font-bold text-gray-800">Bảng giá nhập</h3>
                <span className="text-body-md text-gray-400">Khớp {matchedCount}/{parsedRows.length} SP · chọn {includedRows.length}</span>
                <button onClick={() => refetchSheet()} className="text-tiny text-blue-500 hover:underline flex items-center gap-0.5"><RefreshCw size={11} /> Đồng bộ Sheet</button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label className="text-tiny text-gray-500">Kho nhận</label>
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="h-9 px-2 border border-gray-100 rounded-lg text-body-md bg-white">
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <button onClick={handleCreateDraft} disabled={creating || includedRows.length === 0} className="h-9 px-4 bg-blue-500 text-white rounded-lg text-body-md font-semibold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                  <Save size={15} /> {creating ? 'Đang tạo…' : `Tạo phiếu nháp (${includedRows.length})`}
                </button>
              </div>
            </div>

            {loadingSheet ? (
              <div className="p-12 text-center text-gray-400 flex flex-col items-center gap-2">
                <Cloud className="w-8 h-8 text-gray-200 animate-pulse" /> Đang đọc dữ liệu Sheet…
              </div>
            ) : parsedRows.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <FolderOpen className="w-10 h-10 mx-auto text-gray-200 mb-2" />
                Không đọc được dòng dữ liệu nào. Kiểm tra lại ánh xạ cột / dòng dữ liệu bắt đầu trong Cấu hình nguồn.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body-md">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase">
                      <th className="px-2 py-2.5 w-10 text-center">Chọn</th>
                      <th className="px-2 py-2.5 w-10 text-center">Dòng</th>
                      <th className="px-2 py-2.5 min-w-[200px]">Tên trên file</th>
                      <th className="px-2 py-2.5 min-w-[220px]">Sản phẩm khớp (DB)</th>
                      <th className="px-2 py-2.5 w-20 text-center">SL</th>
                      <th className="px-2 py-2.5 w-36 text-right">Giá nhập (₫) ✎</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-gray-750">
                    {parsedRows.map((row) => {
                      const pid = resolvedFor(row)
                      const prod = pid ? prodById.get(pid) : undefined
                      return (
                        <tr key={row.sheetRow} className={pid ? '' : 'bg-amber-25/30'}>
                          <td className="px-2 py-2 text-center">
                            <input type="checkbox" disabled={!pid} checked={!!included[row.sheetRow] && !!pid}
                              onChange={(e) => setIncluded((inc) => ({ ...inc, [row.sheetRow]: e.target.checked }))} className="w-4 h-4 disabled:opacity-30" />
                          </td>
                          <td className="px-2 py-2 text-center text-tiny text-gray-400">{row.sheetRow}</td>
                          <td className="px-2 py-2">
                            <span className="font-medium text-gray-800 block leading-tight">{row.name}</span>
                          </td>
                          <td className="px-2 py-2">
                            {pid && !manualResolve[row.sheetRow] ? (
                              <div className="flex items-center gap-1.5">
                                <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                                <span className="text-gray-700 truncate" title={prod?.label}>{prod?.label}</span>
                                <button onClick={() => setManualResolve((m) => ({ ...m, [row.sheetRow]: '' }))} className="text-tiny text-gray-400 hover:text-blue-500">đổi</button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {!pid && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <SmartSearchSelect
                                    options={products}
                                    value={manualResolve[row.sheetRow] || ''}
                                    onChange={(v) => v && handleMapProduct(row, v)}
                                    placeholder="-- Chọn SP khớp --"
                                    searchPlaceholder="Tìm sản phẩm…"
                                    icon={<Search size={15} />}
                                  />
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">{row.qty}</td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-end" onBlur={() => commitPrice(row)}>
                              <DecimalInput
                                value={priceFor(row)}
                                onChange={(v) => setEdits((e) => ({ ...e, [row.sheetRow]: { ...e[row.sheetRow], price: v } }))}
                                className="w-32 text-right border border-gray-100 rounded-lg h-9 px-2 text-body-md focus:border-blue-500"
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="p-3 border-t border-gray-50 text-tiny text-gray-400 flex items-center gap-1.5">
              <AlertCircle size={12} /> Sửa ô "Giá nhập" sẽ <b className="mx-1">ghi ngược lên Google Sheet</b>. Phiếu tạo ra là <b className="mx-1">nháp</b> — đồng bộ lại giá được cho tới khi duyệt.
            </div>
          </div>
        )}

        {!sourceId && (
          <div className="text-center py-10 text-gray-400">
            <ArrowLeft size={16} className="inline mr-1" /> Chọn một nguồn ở trên để bắt đầu.
          </div>
        )}
      </div>
    </Layout>
  )
}
