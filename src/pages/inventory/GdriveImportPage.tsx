import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileSpreadsheet, FolderOpen, RefreshCw, Settings, AlertCircle, AlertTriangle,
  CheckCircle, Save, Cloud, ArrowLeft, Search, ShieldAlert, Upload, FileUp,
} from 'lucide-react'
import Layout from '../../components/Layout'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import DecimalInput from '../../components/DecimalInput'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAuth } from '../../contexts/AuthContext'
import {
  useGdriveSources, useDriveFiles, useSheetInfo, useSheetValues,
  useWriteCells, useProductAliases, useUpsertAlias, checkExistingLots, useGdriveSaEmail,
  type GdriveSource, type ExistingLotHit,
} from '../../hooks/useGdriveImport'
import { cellAt, parseSheetNumber, parseSheetDate, formatDateVN, normalizeAlias, computeVatCost } from '../../lib/gdriveMapping'
import { useVatConfig } from '../../hooks/useVat'
import { parseInvoiceFile } from '../../lib/invoiceParsers'

interface ProdOpt { value: string; label: string; sku: string; unit: string; is_lot_managed: boolean; norm: string }

interface ParsedRow {
  sheetRow: number
  name: string
  price: number
  qty: number
  lot: string   // số lô (text)
  mfg: string   // NSX dạng ISO yyyy-mm-dd
  exp: string   // HSD dạng ISO yyyy-mm-dd
}

type FieldKey = 'lot' | 'mfg' | 'exp'

export default function GdriveImportPage() {
  const navigate = useNavigate()
  const { profile, user, userRole } = useAuth()

  const { data: sources = [], isLoading: loadingSources } = useGdriveSources(true)
  const [mode, setMode] = useState<'sheet' | 'upload'>('sheet')
  const [sourceId, setSourceId] = useState<string>('')
  const [fileId, setFileId] = useState<string>('')
  const [tab, setTab] = useState<string>('')
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  // Upload hóa đơn (PDF/HTML/XML)
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [uploadSupplierId, setUploadSupplierId] = useState<string>('')
  const [uploadRows, setUploadRows] = useState<ParsedRow[] | null>(null)
  const [uploadFileName, setUploadFileName] = useState<string>('')
  const [parsing, setParsing] = useState(false)

  const source: GdriveSource | undefined = useMemo(() => sources.find((s) => s.id === sourceId), [sources, sourceId])
  const effectiveSupplierId = mode === 'upload' ? uploadSupplierId : (source?.supplier_id || '')

  const { data: files = [], isLoading: loadingFiles, error: filesError, refetch: refetchFiles } = useDriveFiles(sourceId || null)
  const { data: sheetInfo, error: sheetInfoError } = useSheetInfo(sourceId || null, fileId || null)
  const { data: values = [], isLoading: loadingSheet, refetch: refetchSheet } = useSheetValues(sourceId || null, fileId || null, tab || null)

  const { data: saEmail = '' } = useGdriveSaEmail()
  const { data: aliases = [] } = useProductAliases(effectiveSupplierId || null)
  const writeCells = useWriteCells()
  const upsertAlias = useUpsertAlias()

  const [products, setProducts] = useState<ProdOpt[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [warehouseId, setWarehouseId] = useState<string>('')

  // Giá đã sửa cục bộ (ghi ngược Sheet). `written` = giá đã ghi.
  const [edits, setEdits] = useState<Record<number, { price: number; written?: number }>>({})
  // Số lô / NSX / HSD sửa cục bộ + theo dõi đã ghi Sheet
  const [fieldEdits, setFieldEdits] = useState<Record<number, Partial<Record<FieldKey, string>>>>({})
  const [fieldWritten, setFieldWritten] = useState<Record<number, Partial<Record<FieldKey, string>>>>({})
  const [manualResolve, setManualResolve] = useState<Record<number, string>>({})
  const [included, setIncluded] = useState<Record<number, boolean>>({})
  // Cảnh báo trùng lô (SP + lô + HSD) theo dòng
  const [dupInfo, setDupInfo] = useState<Record<number, ExistingLotHit>>({})
  const dupHandledRef = useRef<Set<number>>(new Set())
  const [missingRows, setMissingRows] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)

  // ── Nhóm VAT + thuế doanh nghiệp (đặt khi nhập) ──
  const { data: vatConfig } = useVatConfig()
  const [vatGroup, setVatGroup] = useState<'vat' | 'none'>('none') // 'vat' = hàng có VAT, 'none' = trốn thuế
  const [vatRate, setVatRate] = useState<5 | 10>(5)
  // Tự cộng thuế DN vào giá nhập. Sheet mặc định TẮT (Excel đã gồm sẵn → tránh cộng kép).
  const [addCorpTax, setAddCorpTax] = useState(false)
  const isVatGroup = vatGroup === 'vat'

  useEffect(() => {
    if (alert) { const t = setTimeout(() => setAlert(null), 5000); return () => clearTimeout(t) }
  }, [alert])

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

      const sup = await fetchAllRows<any>((from, to) =>
        supabase.from('suppliers').select('id, name').order('name').order('id').range(from, to))
      setSuppliers(sup.map((s) => ({ id: s.id, name: s.name })))
    }
    load()
  }, [profile?.branch_id, userRole?.code])

  useEffect(() => {
    if (sheetInfo?.tabs?.length && !tab) setTab(sheetInfo.tabs[0].title)
  }, [sheetInfo, tab])

  useEffect(() => {
    if (source?.default_warehouse_id) setWarehouseId(source.default_warehouse_id)
    else if (warehouses.length && !warehouseId) setWarehouseId(warehouses[0].id)
  }, [source, warehouses])

  // Khởi tạo nhóm VAT theo cấu hình nguồn (vat_default: none|5|10). Sheet đã gồm thuế DN → toggle TẮT.
  useEffect(() => {
    if (!source) return
    if (source.vat_default === 'none') { setVatGroup('none') }
    else { setVatGroup('vat'); setVatRate(source.vat_default === '10' ? 10 : 5) }
    setAddCorpTax(false)
  }, [source])

  // Reset khi đổi file/tab
  useEffect(() => {
    setEdits({}); setFieldEdits({}); setFieldWritten({}); setManualResolve({})
    setIncluded({}); setDupInfo({}); setMissingRows(new Set()); dupHandledRef.current = new Set()
  }, [fileId, tab])

  const resetGrid = useCallback(() => {
    setEdits({}); setFieldEdits({}); setFieldWritten({}); setManualResolve({})
    setIncluded({}); setDupInfo({}); setMissingRows(new Set()); dupHandledRef.current = new Set()
  }, [])

  // Đổi nguồn nhập (Sheet ↔ Upload) → dọn lưới
  useEffect(() => {
    resetGrid()
    if (mode === 'sheet') { setUploadRows(null); setUploadFileName('') }
  }, [mode, resetGrid])

  // ── Đọc file hóa đơn upload (PDF/HTML/XML) ──
  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setParsing(true)
    try {
      const inv = await parseInvoiceFile(file)
      const rows: ParsedRow[] = inv.lines.map((l, i) => ({
        sheetRow: i + 1, name: l.name, price: l.price, qty: l.qty || 1,
        lot: l.lot || '', mfg: l.mfg || '', exp: l.exp || '',
      }))
      resetGrid()
      setUploadRows(rows)
      setUploadFileName(file.name)
      // Hóa đơn = hàng VAT; giá chưa gồm thuế DN → bật toggle mặc định
      if (inv.vatRate != null) { setVatGroup('vat'); setVatRate(inv.vatRate >= 10 ? 10 : 5) }
      else setVatGroup('vat')
      setAddCorpTax(true)
      setAlert({
        type: inv.lines.length ? 'info' : 'error',
        text: `Đã đọc ${inv.lines.length} dòng từ ${file.name}. ${inv.warnings.join(' ')}`,
      })
    } catch (e: any) {
      setAlert({ type: 'error', text: 'Lỗi đọc file: ' + (e.message || e) })
    } finally { setParsing(false) }
  }

  // ── Index khớp SP ──
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

  // ── Parse dòng từ Sheet / từ file upload ──
  const parsedRows: ParsedRow[] = useMemo(() => {
    if (mode === 'upload') return uploadRows ?? []
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
        mfg: cm.mfg_date ? parseSheetDate(cellAt(r, cm.mfg_date)) : '',
        exp: cm.exp_date ? parseSheetDate(cellAt(r, cm.exp_date)) : '',
      })
    }
    return rows
  }, [source, values])

  const resolvedFor = useCallback((row: ParsedRow): string | null => {
    return manualResolve[row.sheetRow] || autoResolve(row.name)
  }, [manualResolve, autoResolve])

  const priceFor = (row: ParsedRow) => edits[row.sheetRow]?.price ?? row.price
  // Giá nhập cuối (lưu vào kho): cộng thuế DN nếu bật & là hàng VAT. KHÔNG ghi ngược Sheet.
  const finalPriceFor = (row: ParsedRow) =>
    addCorpTax && isVatGroup
      ? computeVatCost(priceFor(row), vatConfig?.markup_rate, vatConfig?.tax_share)
      : priceFor(row)
  const lotFor = useCallback((row: ParsedRow) => fieldEdits[row.sheetRow]?.lot ?? row.lot, [fieldEdits])
  const mfgFor = useCallback((row: ParsedRow) => fieldEdits[row.sheetRow]?.mfg ?? row.mfg, [fieldEdits])
  const expFor = useCallback((row: ParsedRow) => fieldEdits[row.sheetRow]?.exp ?? row.exp, [fieldEdits])

  // Khởi tạo "included" mặc định: tự chọn dòng khớp được (trùng sẽ bị bỏ chọn ở effect dưới)
  useEffect(() => {
    if (!parsedRows.length) return
    setIncluded((prev) => {
      const next = { ...prev }
      for (const row of parsedRows) {
        if (next[row.sheetRow] === undefined) next[row.sheetRow] = !!resolvedFor(row)
      }
      return next
    })
  }, [parsedRows, resolvedFor])

  // ── Dedup: gọi RPC kiểm tra lô đã tồn tại (debounce) ──
  const dupItems = useMemo(() => {
    return parsedRows
      .map((r) => {
        const pid = resolvedFor(r); const lot = lotFor(r).trim(); const exp = expFor(r)
        return pid && lot && exp ? { sheetRow: r.sheetRow, product_id: pid, lot_number: lot, expiry_date: exp } : null
      })
      .filter(Boolean) as { sheetRow: number; product_id: string; lot_number: string; expiry_date: string }[]
  }, [parsedRows, resolvedFor, lotFor, expFor])
  const dupKey = JSON.stringify(dupItems.map((d) => [d.product_id, d.lot_number, d.expiry_date]))

  useEffect(() => {
    if (dupItems.length === 0) { setDupInfo({}); return }
    const t = setTimeout(async () => {
      try {
        const hits = await checkExistingLots(dupItems.map(({ sheetRow, ...rest }) => rest))
        const map: Record<number, ExistingLotHit> = {}
        for (const it of dupItems) {
          const hit = hits.find((h) =>
            h.product_id === it.product_id && (h.lot_number || '').trim() === it.lot_number && h.expiry_date === it.expiry_date)
          if (hit) map[it.sheetRow] = hit
        }
        setDupInfo(map)
      } catch { /* dedup là tiện ích, lỗi không chặn */ }
    }, 600)
    return () => clearTimeout(t)
  }, [dupKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Khi phát hiện trùng MỚI → bỏ chọn 1 lần (user phải tích lại để xác nhận nhập trùng)
  useEffect(() => {
    const handled = dupHandledRef.current
    const newDups = Object.keys(dupInfo).map(Number).filter((sr) => !handled.has(sr))
    if (newDups.length === 0) return
    setIncluded((prev) => {
      const cp = { ...prev }
      for (const sr of newDups) { cp[sr] = false; handled.add(sr) }
      return cp
    })
  }, [dupInfo])

  const matchedCount = parsedRows.filter((r) => resolvedFor(r)).length
  const includedRows = parsedRows.filter((r) => included[r.sheetRow] && resolvedFor(r))

  // ── Ghi ngược ô giá ──
  const commitPrice = async (row: ParsedRow) => {
    const cur = edits[row.sheetRow]?.price
    if (cur === undefined || cur === row.price) return
    if (edits[row.sheetRow]?.written === cur) return
    if (!source?.column_map.import_price || !fileId || !tab) return
    try {
      await writeCells.mutateAsync({ sourceId, fileId, tab, updates: [{ range: `${tab}!${source.column_map.import_price}${row.sheetRow}`, values: [[cur]] }] })
      setEdits((e) => ({ ...e, [row.sheetRow]: { price: cur, written: cur } }))
      setAlert({ type: 'success', text: `Đã ghi giá ${cur.toLocaleString('vi-VN')}₫ lên Sheet (dòng ${row.sheetRow}).` })
    } catch (e: any) { setAlert({ type: 'error', text: 'Ghi ngược thất bại: ' + (e.message || e) }) }
  }

  // ── Ghi ngược ô Số lô / NSX / HSD ──
  const commitField = async (row: ParsedRow, field: FieldKey) => {
    const col = field === 'lot' ? source?.column_map.lot : field === 'mfg' ? source?.column_map.mfg_date : source?.column_map.exp_date
    if (!col || !fileId || !tab) return
    const parsedVal = field === 'lot' ? row.lot : field === 'mfg' ? row.mfg : row.exp
    const cur = fieldEdits[row.sheetRow]?.[field]
    if (cur === undefined || cur === parsedVal) return
    if (fieldWritten[row.sheetRow]?.[field] === cur) return
    try {
      // Ngày ghi ISO (USER_ENTERED → Sheets lưu thành ô Ngày thật); số lô ghi text
      await writeCells.mutateAsync({ sourceId, fileId, tab, updates: [{ range: `${tab}!${col}${row.sheetRow}`, values: [[cur]] }] })
      setFieldWritten((w) => ({ ...w, [row.sheetRow]: { ...w[row.sheetRow], [field]: cur } }))
      setAlert({ type: 'success', text: `Đã ghi ${field === 'lot' ? 'số lô' : field === 'mfg' ? 'NSX' : 'HSD'} lên Sheet (dòng ${row.sheetRow}).` })
    } catch (e: any) { setAlert({ type: 'error', text: 'Ghi ngược thất bại: ' + (e.message || e) }) }
  }
  const setField = (row: ParsedRow, field: FieldKey, value: string) =>
    setFieldEdits((f) => ({ ...f, [row.sheetRow]: { ...f[row.sheetRow], [field]: value } }))

  const handleMapProduct = async (row: ParsedRow, productId: string) => {
    setManualResolve((m) => ({ ...m, [row.sheetRow]: productId }))
    setIncluded((inc) => ({ ...inc, [row.sheetRow]: true }))
    if (effectiveSupplierId) {
      try { await upsertAlias.mutateAsync({ supplierId: effectiveSupplierId, externalName: row.name, productId, userId: profile?.id }) } catch { /* ignore */ }
    }
  }

  // ── Tạo phiếu nhập NHÁP ──
  const handleCreateDraft = async () => {
    if (!effectiveSupplierId) { setAlert({ type: 'error', text: mode === 'upload' ? 'Chọn nhà cung cấp cho hóa đơn.' : 'Chọn nguồn nhập.' }); return }
    if (!warehouseId) { setAlert({ type: 'error', text: 'Chọn kho nhận hàng.' }); return }
    if (includedRows.length === 0) { setAlert({ type: 'error', text: 'Chưa có dòng nào khớp sản phẩm để tạo phiếu.' }); return }

    // Bắt buộc đủ Số lô + NSX + HSD cho mọi dòng được chọn
    const missing = includedRows.filter((r) => !(lotFor(r).trim() && mfgFor(r) && expFor(r)))
    if (missing.length > 0) {
      setMissingRows(new Set(missing.map((m) => m.sheetRow)))
      setAlert({ type: 'error', text: `Còn ${missing.length} dòng thiếu Số lô / NSX / HSD (dòng ${missing.map((m) => m.sheetRow).join(', ')}). Bắt buộc nhập đủ 3 trường.` })
      return
    }
    setMissingRows(new Set())

    const receivedBy = profile?.id ?? user?.id
    if (!receivedBy) { setAlert({ type: 'error', text: 'Không xác định người dùng. Đăng nhập lại.' }); return }

    setCreating(true)
    try {
      for (const row of includedRows) {
        const pid = resolvedFor(row)!
        if (!manualResolve[row.sheetRow] && !aliasMap.has(normalizeAlias(row.name))) {
          try { await upsertAlias.mutateAsync({ supplierId: effectiveSupplierId, externalName: row.name, productId: pid, userId: profile?.id }) } catch { /* ignore */ }
        }
      }

      // Giá nhập cuối (đã cộng thuế DN nếu bật) là tiền thật phải trả/giá vốn
      const lineVatRate = isVatGroup ? vatRate : 0
      const totalAmount = includedRows.reduce((s, r) => s + finalPriceFor(r) * r.qty, 0)
      const vatLabel = isVatGroup
        ? `Xuất hóa đơn đỏ (VAT ${vatRate}%${addCorpTax ? ' + thuế DN' : ''})`
        : 'Không xuất hóa đơn đỏ'
      const code = `GR-${Math.floor(100000 + Math.random() * 900000)}`
      const rowMap = includedRows.map((r) => ({ product_id: resolvedFor(r), row: r.sheetRow }))

      const baseInsert: Record<string, any> = {
        receipt_code: code,
        supplier_id: effectiveSupplierId,
        warehouse_id: warehouseId,
        receipt_date: new Date().toISOString().split('T')[0],
        total_amount: totalAmount,
        received_by: receivedBy,
        notes: mode === 'upload'
          ? `Nhập từ hóa đơn upload (${uploadFileName}). [Nhóm: ${vatLabel}].`
          : `Nhập từ Google Drive (${source!.label}). [Nhóm: ${vatLabel}].`,
      }
      if (mode === 'sheet' && source) {
        baseInsert.gsheet_source_id = source.id
        baseInsert.gsheet_file_id = fileId
        baseInsert.gsheet_tab = tab
        baseInsert.gsheet_synced_at = new Date().toISOString()
        baseInsert.gsheet_row_map = rowMap
      }
      const { data: gr, error: grErr } = await supabase.from('goods_receipts').insert([baseInsert]).select().single()
      if (grErr) {
        if (grErr.code === '42501' || grErr.message?.includes('row-level security')) throw new Error('Bạn không có quyền nhập kho (cần inventory.receive).')
        throw grErr
      }

      const lines = includedRows.map((r) => ({
        receipt_id: gr.id,
        po_line_id: null,
        product_id: resolvedFor(r),
        quantity: r.qty,
        unit_price: finalPriceFor(r),
        lot_number: lotFor(r).trim() || null,
        manufacture_date: mfgFor(r) || null,
        expiry_date: expFor(r) || null,
        is_vat: isVatGroup,
        vat_rate: lineVatRate,
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
  const dupCount = parsedRows.filter((r) => dupInfo[r.sheetRow]).length

  return (
    <Layout activeMenu="Nhập từ Drive">
      <div className="p-4 md:p-8 max-w-[1500px] mx-auto space-y-5">
        {alert && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-body-md max-w-md ${
            alert.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : alert.type === 'error' ? 'bg-red-50 text-red-800 border-red-200'
            : 'bg-blue-50 text-blue-800 border-blue-200'}`}>
            <AlertCircle size={18} className="shrink-0" /><span>{alert.text}</span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-headline-md font-bold text-gray-800 flex items-center gap-2">
              <FileSpreadsheet className="text-blue-500" size={24} /> Nhập hàng từ Google Drive
            </h1>
            <p className="text-body-md text-gray-400">Đọc bảng giá Google Sheets hoặc hóa đơn PDF/HTML/XML → khớp SP, lô/NSX/HSD → tạo phiếu nhập nháp.</p>
          </div>
          {canConfig && (
            <button onClick={() => navigate('/inventory/gdrive-sources')} className="h-10 px-4 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
              <Settings size={16} /> Cấu hình nguồn
            </button>
          )}
        </div>

        {/* Chuyển nguồn nhập */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => setMode('sheet')}
            className={`px-3 h-8 rounded-md text-body-md font-semibold flex items-center gap-1.5 ${mode === 'sheet' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>
            <FileSpreadsheet size={15} /> Google Sheet
          </button>
          <button onClick={() => setMode('upload')}
            className={`px-3 h-8 rounded-md text-body-md font-semibold flex items-center gap-1.5 ${mode === 'upload' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>
            <FileUp size={15} /> Tải file (PDF/HTML/XML)
          </button>
        </div>

        {/* Chọn nguồn / file / tab (Sheet) */}
        {mode === 'sheet' && (
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
            {filesError && (
              <p className="text-tiny text-red-600 flex items-start gap-1 mt-1">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                Lỗi tải danh sách file: {(filesError as Error).message}
              </p>
            )}
            {sourceId && !loadingFiles && !filesError && files.length === 0 && (
              <p className="text-tiny text-amber-600 flex items-start gap-1 mt-1">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>
                  Thư mục trống hoặc chưa được chia sẻ cho service account
                  {saEmail && <> <b>{saEmail}</b></>}. Hãy mở thư mục trên Google Drive → Chia sẻ với tài khoản này (quyền Editor) rồi bấm “Tải lại”.
                </span>
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-body-md font-semibold text-gray-700">Trang tính (tab)</label>
            <select value={tab} onChange={(e) => setTab(e.target.value)} disabled={!fileId} className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md bg-white disabled:bg-gray-50">
              <option value="">-- Chọn tab --</option>
              {sheetInfo?.tabs?.map((t) => <option key={t.title} value={t.title}>{t.title}</option>)}
            </select>
            {sheetInfoError && (
              <p className="text-tiny text-red-600 flex items-start gap-1 mt-1">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                Lỗi đọc trang tính: {(sheetInfoError as Error).message}
              </p>
            )}
          </div>
        </div>
        )}

        {/* Chọn NCC + tải file (Upload) */}
        {mode === 'upload' && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-body-md font-semibold text-gray-700">Nhà cung cấp</label>
            <select value={uploadSupplierId} onChange={(e) => setUploadSupplierId(e.target.value)} className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md bg-white">
              <option value="">-- Chọn nhà cung cấp --</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-body-md font-semibold text-gray-700">File hóa đơn (.pdf / .html / .xml)</label>
            <label className="w-full h-10 px-3 border border-dashed border-blue-300 rounded-lg text-body-md bg-blue-25 flex items-center gap-2 cursor-pointer text-blue-600 hover:bg-blue-50">
              <Upload size={16} /> {parsing ? 'Đang đọc…' : uploadFileName || 'Chọn file để bóc tách'}
              <input type="file" accept=".pdf,.html,.htm,.xml,application/pdf,text/html,application/xml,text/xml" className="hidden"
                disabled={parsing} onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <p className="text-tiny text-gray-400">Ưu tiên file XML hóa đơn điện tử (chính xác cao). Số lô/NSX/HSD nhập tay.</p>
          </div>
        </div>
        )}

        {/* Lưới dữ liệu */}
        {((mode === 'sheet' && sourceId && fileId && tab) || (mode === 'upload' && uploadRows !== null)) && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-body-lg font-bold text-gray-800">Bảng giá nhập</h3>
                <span className="text-body-md text-gray-400">Khớp {matchedCount}/{parsedRows.length} · chọn {includedRows.length}</span>
                {dupCount > 0 && <span className="text-tiny font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full flex items-center gap-1"><ShieldAlert size={12} /> {dupCount} dòng trùng lô</span>}
                {mode === 'sheet' && <button onClick={() => refetchSheet()} className="text-tiny text-blue-500 hover:underline flex items-center gap-0.5"><RefreshCw size={11} /> Đồng bộ Sheet</button>}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Nhóm VAT */}
                <div className="flex items-center gap-1.5">
                  <label className="text-tiny text-gray-500">Loại hàng</label>
                  <select value={vatGroup} onChange={(e) => setVatGroup(e.target.value as 'vat' | 'none')}
                    className={`h-9 px-2 border rounded-lg text-body-md bg-white font-semibold ${isVatGroup ? 'border-emerald-300 text-emerald-700' : 'border-gray-200 text-gray-600'}`}>
                    <option value="vat">Xuất hóa đơn đỏ</option>
                    <option value="none">Không xuất hóa đơn đỏ</option>
                  </select>
                  {isVatGroup && (
                    <select value={vatRate} onChange={(e) => setVatRate(Number(e.target.value) as 5 | 10)}
                      className="h-9 px-2 border border-emerald-300 rounded-lg text-body-md bg-white">
                      <option value={5}>5%</option>
                      <option value={10}>10%</option>
                    </select>
                  )}
                </div>
                {/* Toggle thuế DN (chỉ khi hàng VAT) */}
                {isVatGroup && (
                  <label className="flex items-center gap-1.5 text-tiny text-gray-600 cursor-pointer select-none" title="Sheet đã gồm sẵn thuế DN → để TẮT, tránh cộng kép. Bật khi giá chưa gồm thuế DN.">
                    <input type="checkbox" checked={addCorpTax} onChange={(e) => setAddCorpTax(e.target.checked)} className="w-4 h-4" />
                    Tự cộng thuế DN (+{(((vatConfig?.markup_rate ?? 0.07) * (vatConfig?.tax_share ?? 0.5)) * 100).toFixed(1)}%)
                  </label>
                )}
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
                {mode === 'upload'
                  ? 'Không bóc được dòng hàng nào từ file. Với hóa đơn scan, hãy nhập tay (chọn lại file XML nếu có).'
                  : 'Không đọc được dòng dữ liệu nào. Kiểm tra lại ánh xạ cột / dòng dữ liệu bắt đầu trong Cấu hình nguồn.'}
              </div>
            ) : (
              <div className="overflow-x-auto tbl-x">
                <table className="w-full text-left text-body-md">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase">
                      <th className="px-2 py-2.5 w-10 text-center">Chọn</th>
                      <th className="px-2 py-2.5 w-10 text-center">Dòng</th>
                      <th className="px-2 py-2.5 min-w-[190px]">Tên trên file</th>
                      <th className="px-2 py-2.5 min-w-[200px]">Sản phẩm khớp (DB)</th>
                      <th className="px-2 py-2.5 w-16 text-center">SL</th>
                      <th className="px-2 py-2.5 w-32 text-right">Giá nhập (₫) ✎</th>
                      <th className="px-2 py-2.5 w-32">Số lô *</th>
                      <th className="px-2 py-2.5 w-36">NSX *</th>
                      <th className="px-2 py-2.5 w-36">HSD *</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-gray-750">
                    {parsedRows.map((row) => {
                      const pid = resolvedFor(row)
                      const prod = pid ? prodById.get(pid) : undefined
                      const dup = dupInfo[row.sheetRow]
                      const isInc = included[row.sheetRow] && pid
                      const missLot = missingRows.has(row.sheetRow) && !lotFor(row).trim()
                      const missMfg = missingRows.has(row.sheetRow) && !mfgFor(row)
                      const missExp = missingRows.has(row.sheetRow) && !expFor(row)
                      const dateCls = (miss: boolean) => `w-full h-9 px-2 border rounded-lg text-body-md focus:border-blue-500 focus:outline-none ${miss ? 'border-red-400 bg-red-25' : 'border-gray-100'}`
                      return (
                        <tr key={row.sheetRow} className={dup ? 'bg-red-25/40' : pid ? '' : 'bg-amber-25/30'}>
                          <td className="px-2 py-2 text-center align-top">
                            <input type="checkbox" disabled={!pid} checked={!!isInc}
                              onChange={(e) => setIncluded((inc) => ({ ...inc, [row.sheetRow]: e.target.checked }))} className="w-4 h-4 mt-2 disabled:opacity-30" />
                          </td>
                          <td className="px-2 py-2 text-center text-tiny text-gray-400 align-top pt-3">{row.sheetRow}</td>
                          <td className="px-2 py-2 align-top">
                            <span className="font-medium text-gray-800 block leading-tight">{row.name}</span>
                            {dup && (
                              <div className="mt-1 text-[11px] text-red-600 font-semibold flex items-start gap-1 leading-snug">
                                <ShieldAlert size={12} className="shrink-0 mt-0.5" />
                                <span>
                                  {dup.in_stock && <>Đã nhập kho: {dup.stock_warehouse}. </>}
                                  {dup.in_draft && <>Đang ở phiếu {dup.draft_receipt_code} ({dup.draft_status === 'verified' ? 'đã duyệt' : 'nháp'}{dup.draft_by ? ` · ${dup.draft_by}` : ''}). </>}
                                  Tích "Chọn" nếu vẫn muốn nhập trùng.
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {pid && !manualResolve[row.sheetRow] ? (
                              <div className="flex items-center gap-1.5 pt-1.5">
                                <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                                <span className="text-gray-700 truncate" title={prod?.label}>{prod?.label}</span>
                                <button onClick={() => setManualResolve((m) => ({ ...m, [row.sheetRow]: '' }))} className="text-tiny text-gray-400 hover:text-blue-500">đổi</button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {!pid && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <SmartSearchSelect options={products} value={manualResolve[row.sheetRow] || ''}
                                    onChange={(v) => v && handleMapProduct(row, v)} placeholder="-- Chọn SP khớp --" searchPlaceholder="Tìm sản phẩm…" icon={<Search size={15} />} />
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center align-top pt-3">{row.qty}</td>
                          <td className="px-2 py-2 align-top">
                            <div className="flex items-center justify-end" onBlur={() => commitPrice(row)}>
                              <DecimalInput value={priceFor(row)}
                                onChange={(v) => setEdits((e) => ({ ...e, [row.sheetRow]: { ...e[row.sheetRow], price: v } }))}
                                className="w-28 text-right border border-gray-100 rounded-lg h-9 px-2 text-body-md focus:border-blue-500" />
                            </div>
                            {addCorpTax && isVatGroup && finalPriceFor(row) !== priceFor(row) && (
                              <span className="text-[10px] text-emerald-600 block text-right mt-0.5">
                                +thuế DN → {finalPriceFor(row).toLocaleString('vi-VN')}₫
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top" onBlur={() => commitField(row, 'lot')}>
                            <input type="text" value={lotFor(row)} onChange={(e) => setField(row, 'lot', e.target.value)}
                              placeholder="Số lô" className={`w-full h-9 px-2 border rounded-lg text-body-md focus:border-blue-500 focus:outline-none ${missLot ? 'border-red-400 bg-red-25' : 'border-gray-100'}`} />
                          </td>
                          <td className="px-2 py-2 align-top" onBlur={() => commitField(row, 'mfg')}>
                            <input type="date" value={mfgFor(row)} onChange={(e) => setField(row, 'mfg', e.target.value)} className={dateCls(missMfg)} />
                            {mfgFor(row) && <span className="text-[10px] text-gray-400 block">{formatDateVN(mfgFor(row))}</span>}
                          </td>
                          <td className="px-2 py-2 align-top" onBlur={() => commitField(row, 'exp')}>
                            <input type="date" value={expFor(row)} onChange={(e) => setField(row, 'exp', e.target.value)} className={dateCls(missExp)} />
                            {expFor(row) && <span className="text-[10px] text-gray-400 block">{formatDateVN(expFor(row))}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="p-3 border-t border-gray-50 text-tiny text-gray-400 flex items-start gap-1.5">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>
                <b>Số lô, NSX, HSD bắt buộc</b> cho mọi dòng nhập.{mode === 'sheet' && <> Sửa ô (giá/lô/NSX/HSD) sẽ <b>ghi ngược lên Google Sheet</b>.</>}
                {' '}Dòng <span className="text-red-600 font-semibold">trùng lô</span> (đã nhập kho hoặc đang ở phiếu khác) bị bỏ chọn — tích lại để xác nhận nhập trùng.
                Phiếu tạo ra là <b>nháp</b>{mode === 'sheet' && <>, đồng bộ giá được tới khi duyệt</>}.
              </span>
            </div>
          </div>
        )}

        {mode === 'sheet' && !sourceId && (
          <div className="text-center py-10 text-gray-400">
            <ArrowLeft size={16} className="inline mr-1" /> Chọn một nguồn ở trên để bắt đầu.
          </div>
        )}
      </div>
    </Layout>
  )
}
