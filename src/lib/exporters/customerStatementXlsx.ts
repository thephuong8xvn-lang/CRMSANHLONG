import type { CustomerStatement } from '../customerStatement'

// ─────────────────────────────────────────────────────────────
// Sinh file .xlsx sao kê công nợ (bám bố cục KiotViet — ảnh 3).
// exceljs được nạp động để không phình main bundle.
// ─────────────────────────────────────────────────────────────

export interface StatementExportOptions {
  showLineDetail: boolean
  cols: {
    unit: boolean
    qty: boolean
    unitPrice: boolean
    discount: boolean
    vat: boolean
    sellPrice: boolean
    lineTotal: boolean
  }
  showNotes: boolean
}

export interface StatementCompany {
  name: string
  address: string
  phone: string
  mst: string
}

const NUM_FMT = '#,##0'

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface ColDef {
  key: 'time' | 'code' | 'desc' | 'unit' | 'qty' | 'unitPrice' | 'discount' | 'vat' | 'sellPrice' | 'lineTotal' | 'debit' | 'credit' | 'notes'
  header: string
  width: number
  numeric?: boolean
}

function buildColumns(o: StatementExportOptions): ColDef[] {
  const cols: ColDef[] = [
    { key: 'time', header: 'Thời gian', width: 20 },
    { key: 'code', header: 'Mã', width: 16 },
    { key: 'desc', header: 'Diễn giải', width: 34 },
  ]
  if (o.showLineDetail) {
    if (o.cols.unit)      cols.push({ key: 'unit', header: 'ĐVT', width: 8 })
    if (o.cols.qty)       cols.push({ key: 'qty', header: 'SL', width: 8, numeric: true })
    if (o.cols.unitPrice) cols.push({ key: 'unitPrice', header: 'Đơn giá', width: 13, numeric: true })
    if (o.cols.discount)  cols.push({ key: 'discount', header: 'Giảm giá', width: 12, numeric: true })
    if (o.cols.vat)       cols.push({ key: 'vat', header: 'VAT', width: 10, numeric: true })
    if (o.cols.sellPrice) cols.push({ key: 'sellPrice', header: 'Giá bán/trả', width: 13, numeric: true })
    if (o.cols.lineTotal) cols.push({ key: 'lineTotal', header: 'Thành tiền', width: 14, numeric: true })
  }
  cols.push({ key: 'debit', header: 'Ghi nợ', width: 14, numeric: true })
  cols.push({ key: 'credit', header: 'Ghi có', width: 14, numeric: true })
  if (o.showNotes) cols.push({ key: 'notes', header: 'Ghi chú', width: 24 })
  return cols
}

export async function generateCustomerStatementXlsx(
  st: CustomerStatement,
  options: StatementExportOptions,
  company: StatementCompany,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = company.name || 'CRM Sanh Long Vetco'
  wb.created = new Date()
  const ws = wb.addWorksheet('CNCT', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const cols = buildColumns(options)
  const lastCol = cols.length
  const lastColLetter = ws.getColumn(lastCol).letter
  ws.columns = cols.map(c => ({ width: c.width }))

  const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }
  const allBorders = { top: thin, left: thin, bottom: thin, right: thin }

  let r = 1
  const mergeAcross = (row: number, text: string, opts?: { bold?: boolean; size?: number; align?: 'left' | 'center'; color?: string }) => {
    ws.mergeCells(row, 1, row, lastCol)
    const cell = ws.getCell(row, 1)
    cell.value = text
    cell.font = { name: 'Calibri', size: opts?.size ?? 11, bold: opts?.bold, color: opts?.color ? { argb: opts.color } : undefined }
    cell.alignment = { horizontal: opts?.align ?? 'left', vertical: 'middle' }
  }

  // ── Header công ty
  mergeAcross(r++, company.name || 'CÔNG TY', { bold: true, size: 13 })
  if (st.branch?.name) mergeAcross(r++, `Chi nhánh: ${st.branch.name}`, { size: 10 })
  const addr = st.branch?.address || company.address
  if (addr) mergeAcross(r++, `Địa chỉ: ${addr}`, { size: 10 })
  const phone = st.branch?.phone || company.phone
  if (phone) mergeAcross(r++, `Điện thoại: ${phone}`, { size: 10 })
  if (company.mst) mergeAcross(r++, `MST: ${company.mst}`, { size: 10 })

  r++ // blank

  // ── Tiêu đề
  mergeAcross(r++, 'CÔNG NỢ CHI TIẾT KHÁCH HÀNG', { bold: true, size: 14, align: 'center', color: 'FF1E5A9C' })
  mergeAcross(r++, `Từ ngày ${fmtDate(st.from)} đến ngày ${fmtDate(st.to)}`, { size: 11, align: 'center' })

  r++ // blank

  // ── Khối khách hàng
  const kvRow = (label: string, value: string) => {
    ws.getCell(r, 1).value = label
    ws.getCell(r, 1).font = { name: 'Calibri', size: 11, bold: true }
    ws.mergeCells(r, 2, r, Math.min(4, lastCol))
    ws.getCell(r, 2).value = value
    ws.getCell(r, 2).font = { name: 'Calibri', size: 11 }
    r++
  }
  kvRow('Khách hàng:', st.customer.name)
  kvRow('Mã KH:', st.customer.code)
  kvRow('Điện thoại:', st.customer.phone)

  r++ // blank

  // ── Khối tổng hợp công nợ (có viền)
  const sumStart = r
  const sumRow = (label: string, debit: number | null, credit: number | null, opts?: { bold?: boolean }) => {
    ws.getCell(r, 1).value = label
    ws.getCell(r, 1).font = { name: 'Calibri', size: 11, bold: opts?.bold }
    ws.mergeCells(r, 1, r, 2)
    const dCell = ws.getCell(r, 3)
    if (debit != null) { dCell.value = debit; dCell.numFmt = NUM_FMT }
    dCell.font = { name: 'Calibri', size: 11, bold: opts?.bold }
    dCell.alignment = { horizontal: 'right' }
    const cCell = ws.getCell(r, 4)
    if (credit != null) { cCell.value = credit; cCell.numFmt = NUM_FMT }
    cCell.font = { name: 'Calibri', size: 11, bold: opts?.bold }
    cCell.alignment = { horizontal: 'right' }
    r++
  }
  sumRow('Nợ đầu kỳ', st.opening, null, { bold: true })
  sumRow('Phát sinh trong kỳ', st.totalDebit, st.totalCredit)
  sumRow('Nợ cuối kỳ', st.closing, null, { bold: true })
  // Viền khối tổng hợp (cột 1..4)
  for (let rr = sumStart; rr < r; rr++) {
    for (let cc = 1; cc <= 4; cc++) ws.getCell(rr, cc).border = allBorders
  }

  r++ // blank

  // ── Tiêu đề bảng
  const headerRowIdx = r
  cols.forEach((c, i) => {
    const cell = ws.getCell(r, i + 1)
    cell.value = c.header
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5A9C' } }
    cell.alignment = { horizontal: c.numeric ? 'right' : (c.key === 'desc' ? 'left' : 'center'), vertical: 'middle', wrapText: true }
    cell.border = allBorders
  })
  ws.getRow(r).height = 24
  r++

  const writeRow = (values: Record<string, any>, opts?: { bold?: boolean; fill?: string }) => {
    cols.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1)
      const v = values[c.key]
      if (v !== undefined && v !== null && v !== '') {
        cell.value = v
        if (c.numeric && typeof v === 'number') {
          cell.numFmt = NUM_FMT
          cell.alignment = { horizontal: 'right' }
        } else {
          cell.alignment = { horizontal: c.key === 'time' ? 'left' : (c.numeric ? 'right' : 'left'), wrapText: c.key === 'desc' }
        }
      }
      cell.font = { name: 'Calibri', size: 10, bold: opts?.bold }
      cell.border = allBorders
      if (opts?.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
    })
    r++
  }

  // ── Dòng dữ liệu (nhóm theo chứng từ)
  for (const doc of st.rows) {
    writeRow({
      time: fmtDateTime(doc.date),
      code: doc.code,
      desc: doc.typeLabel,
      debit: doc.debit || undefined,
      credit: doc.credit || undefined,
      notes: options.showNotes ? doc.notes : undefined,
    }, { bold: true, fill: 'FFF2F6FB' })

    if (options.showLineDetail && doc.lines.length) {
      for (const ln of doc.lines) {
        writeRow({
          code: ln.sku,
          desc: ln.name,
          unit: ln.unit,
          qty: ln.quantity,
          unitPrice: ln.unitPrice,
          discount: ln.discount,
          vat: ln.vat,
          sellPrice: ln.sellPrice,
          lineTotal: ln.lineTotal,
          notes: options.showNotes ? ln.notes : undefined,
        })
      }
    }
  }

  // ── Dòng tổng cuối bảng
  const debitColIdx = cols.findIndex(c => c.key === 'debit') + 1
  const creditColIdx = cols.findIndex(c => c.key === 'credit') + 1
  ws.mergeCells(r, 1, r, debitColIdx - 1)
  ws.getCell(r, 1).value = 'TỔNG PHÁT SINH'
  ws.getCell(r, 1).font = { name: 'Calibri', size: 10, bold: true }
  ws.getCell(r, 1).alignment = { horizontal: 'right' }
  ws.getCell(r, debitColIdx).value = st.totalDebit
  ws.getCell(r, creditColIdx).value = st.totalCredit
  ;[debitColIdx, creditColIdx].forEach(ci => {
    const cell = ws.getCell(r, ci)
    cell.numFmt = NUM_FMT
    cell.font = { name: 'Calibri', size: 10, bold: true }
    cell.alignment = { horizontal: 'right' }
  })
  for (let cc = 1; cc <= lastCol; cc++) ws.getCell(r, cc).border = allBorders

  // Đóng băng từ sau hàng tiêu đề bảng
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx, showGridLines: false }]
  ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: lastCol } }
  void lastColLetter

  // ── Tải về
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `CongNoChiTiet_${st.customer.code || 'KH'}_${fmtDate(st.from).replace(/\//g, '')}_${fmtDate(st.to).replace(/\//g, '')}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
