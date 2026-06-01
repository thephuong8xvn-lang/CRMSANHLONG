import { convertVndToWords } from '../../utils/numberToWords'

// ─────────────────────────────────────────────────────────────
// Sinh file .xlsx cho 6 loại chứng từ của trang xem trước /print-preview
// (hóa đơn, phiếu nhập, phiếu trả, phiếu xuất/chuyển, phiếu thu, phiếu chi).
// exceljs nạp động để không phình main bundle. Dữ liệu đầu vào là object
// `printData` đã được PrintPreviewPage chuẩn hóa từ Supabase (dữ liệu thật).
// ─────────────────────────────────────────────────────────────

export type PrintDocType = 'invoice' | 'receipt' | 'return' | 'transfer' | 'cash_in' | 'cash_out'

export interface DocExportCompany {
  companyName: string
  address?: string
  phone?: string
  email?: string
  mst?: string
  website?: string
}

const NUM_FMT = '#,##0'
const QTY_FMT = '#,##0.##'

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(v: string | Date | null | undefined) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
function fmtDateTime(v: string | Date | null | undefined) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', credit: 'Ghi nợ công nợ',
  credit_note: 'Bù trừ công nợ',
}
const payLabel = (m?: string) => (m ? PAYMENT_LABEL[m] || m : '-')

interface ColDef {
  key: string
  header: string
  width: number
  numeric?: boolean
  qty?: boolean
}

interface DocLayout {
  title: string
  sheetName: string
  fileTag: string
  meta: { label: string; value: string }[]
  columns: ColDef[]
  rows: Record<string, any>[]
  /** Các dòng tổng kết cuối bảng: nhãn + giá trị (cột số cuối cùng). */
  totals?: { label: string; value: number; bold?: boolean; negative?: boolean }[]
  amountInWords?: string
  notes?: string
}

// Xây cấu trúc bảng theo từng loại chứng từ ──────────────────────
function buildLayout(docType: PrintDocType, d: any): DocLayout {
  switch (docType) {
    case 'invoice': {
      return {
        title: 'HÓA ĐƠN BÁN HÀNG',
        sheetName: 'HoaDon',
        fileTag: 'HoaDon',
        meta: [
          { label: 'Khách hàng', value: d.customerName || '-' },
          { label: 'Điện thoại', value: d.customerPhone || '-' },
          { label: 'Địa chỉ', value: d.customerAddress || '-' },
          { label: 'Địa chỉ giao hàng', value: d.deliveryAddress || '-' },
          { label: 'Hình thức thanh toán', value: payLabel(d.paymentMethod) },
          { label: 'Kho xuất', value: d.warehouseName || '-' },
          { label: 'Ngày lập', value: fmtDateTime(d.createdAt) },
          { label: 'Người lập', value: d.createdBy || '-' },
        ],
        columns: [
          { key: 'stt', header: 'STT', width: 6 },
          { key: 'code', header: 'Mã hàng', width: 16 },
          { key: 'name', header: 'Tên sản phẩm / hoạt chất', width: 34 },
          { key: 'lot', header: 'Số lô', width: 14 },
          { key: 'exp', header: 'HSD', width: 12 },
          { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'qty', header: 'SL', width: 8, numeric: true, qty: true },
          { key: 'price', header: 'Đơn giá', width: 14, numeric: true },
          { key: 'discount', header: 'CK', width: 12, numeric: true },
          { key: 'total', header: 'Thành tiền', width: 16, numeric: true },
        ],
        rows: (d.lines || []).map((l: any, i: number) => ({
          stt: i + 1, code: l.productCode, name: l.productName,
          lot: l.lotNumber || '', exp: fmtDate(l.expiryDate), unit: l.unit,
          qty: Number(l.quantity) || 0, price: Number(l.unitPrice) || 0,
          discount: Number(l.discount) || 0, total: Number(l.totalAmount) || 0,
        })),
        totals: [
          { label: 'Cộng tiền hàng', value: Number(d.subtotal) || 0 },
          ...(Number(d.discountTotal) > 0 ? [{ label: 'Chiết khấu đơn', value: Number(d.discountTotal), negative: true }] : []),
          ...(Number(d.taxAmount) > 0 ? [{ label: `VAT (${d.taxRate || 0}%)`, value: Number(d.taxAmount) }] : []),
          { label: 'TỔNG CỘNG', value: Number(d.grandTotal) || 0, bold: true },
        ],
        amountInWords: d.amountInWords || convertVndToWords(Number(d.grandTotal) || 0),
        notes: d.notes,
      }
    }
    case 'receipt': {
      return {
        title: 'PHIẾU NHẬP KHO HÀNG',
        sheetName: 'PhieuNhap',
        fileTag: 'PhieuNhap',
        meta: [
          { label: 'Nhà cung cấp', value: d.supplierName || '-' },
          { label: 'Điện thoại', value: d.supplierPhone || '-' },
          { label: 'Địa chỉ', value: d.supplierAddress || '-' },
          { label: 'Lý do nhập', value: d.receiptReason || '-' },
          { label: 'Kho nhận', value: d.warehouseName || '-' },
          { label: 'Số PO liên kết', value: d.poNumber || '-' },
          { label: 'Ngày lập', value: fmtDateTime(d.createdAt) },
          { label: 'Người lập', value: d.createdBy || '-' },
        ],
        columns: [
          { key: 'stt', header: 'STT', width: 6 },
          { key: 'code', header: 'Mã hàng', width: 16 },
          { key: 'name', header: 'Tên sản phẩm / Hoạt chất', width: 34 },
          { key: 'lot', header: 'Số lô', width: 14 },
          { key: 'exp', header: 'HSD', width: 12 },
          { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'qty', header: 'SL thực nhập', width: 12, numeric: true, qty: true },
          { key: 'price', header: 'Đơn giá vốn', width: 14, numeric: true },
          { key: 'total', header: 'Thành tiền', width: 16, numeric: true },
        ],
        rows: (d.lines || []).map((l: any, i: number) => ({
          stt: i + 1, code: l.productCode, name: l.productName,
          lot: l.lotNumber || '', exp: fmtDate(l.expiryDate), unit: l.unit,
          qty: Number(l.quantityReceived) || 0, price: Number(l.unitPrice) || 0,
          total: Number(l.totalAmount) || 0,
        })),
        totals: [{ label: 'TỔNG GIÁ TRỊ NHẬP', value: Number(d.totalAmount) || 0, bold: true }],
        amountInWords: d.amountInWords || convertVndToWords(Number(d.totalAmount) || 0),
        notes: d.notes,
      }
    }
    case 'return': {
      const partnerTitle = d.partnerType === 'customer' ? 'Khách hàng' : 'Nhà cung cấp'
      return {
        title: d.partnerType === 'customer' ? 'PHIẾU KHÁCH TRẢ HÀNG' : 'PHIẾU TRẢ HÀNG NCC',
        sheetName: 'PhieuTra',
        fileTag: 'PhieuTra',
        meta: [
          { label: partnerTitle, value: d.partnerName || '-' },
          { label: 'Điện thoại', value: d.partnerPhone || '-' },
          { label: 'Địa chỉ', value: d.partnerAddress || '-' },
          { label: 'Lý do trả hàng', value: d.returnReason || '-' },
          { label: 'Kho nhận trả', value: d.warehouseName || '-' },
          { label: 'Hình thức hoàn tiền', value: payLabel(d.refundMethod) },
          { label: 'Ngày lập', value: fmtDateTime(d.createdAt) },
          { label: 'Người lập', value: d.createdBy || '-' },
        ],
        columns: [
          { key: 'stt', header: 'STT', width: 6 },
          { key: 'code', header: 'Mã hàng', width: 16 },
          { key: 'name', header: 'Tên sản phẩm / Hoạt chất', width: 34 },
          { key: 'lot', header: 'Số lô', width: 14 },
          { key: 'exp', header: 'HSD', width: 12 },
          { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'qty', header: 'SL trả', width: 10, numeric: true, qty: true },
          { key: 'price', header: 'Đơn giá hoàn', width: 14, numeric: true },
          { key: 'total', header: 'Thành tiền', width: 16, numeric: true },
        ],
        rows: (d.lines || []).map((l: any, i: number) => ({
          stt: i + 1, code: l.productCode, name: l.productName,
          lot: l.lotNumber || '', exp: fmtDate(l.expiryDate), unit: l.unit,
          qty: Number(l.quantityReturned) || 0, price: Number(l.unitPrice) || 0,
          total: Number(l.totalAmount) || 0,
        })),
        totals: [{ label: 'TỔNG TIỀN HOÀN TRẢ', value: Number(d.totalAmount) || 0, bold: true }],
        amountInWords: d.amountInWords || convertVndToWords(Number(d.totalAmount) || 0),
        notes: d.notes,
      }
    }
    case 'transfer': {
      return {
        title: 'PHIẾU XUẤT KHO HÀNG',
        sheetName: 'PhieuXuat',
        fileTag: 'PhieuXuat',
        meta: [
          { label: 'Kho xuất', value: d.fromWarehouse || '-' },
          { label: 'Nơi nhận hàng', value: d.toWarehouse || '-' },
          { label: 'Lý do xuất', value: d.transferReason || '-' },
          ...(d.receiverName ? [{ label: 'Người nhận hàng', value: d.receiverName }] : []),
          { label: 'Ngày lập', value: fmtDateTime(d.createdAt) },
          { label: 'Người lập phiếu', value: d.createdBy || '-' },
        ],
        columns: [
          { key: 'stt', header: 'STT', width: 6 },
          { key: 'code', header: 'Mã hàng', width: 16 },
          { key: 'name', header: 'Tên sản phẩm / Vật tư', width: 34 },
          { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'qtyReq', header: 'SL yêu cầu', width: 12, numeric: true, qty: true },
          { key: 'qtyAct', header: 'SL thực xuất', width: 12, numeric: true, qty: true },
          { key: 'lot', header: 'Số lô SX', width: 16 },
          { key: 'exp', header: 'Hạn sử dụng', width: 14 },
        ],
        rows: (d.lines || []).map((l: any, i: number) => ({
          stt: i + 1, code: l.productCode, name: l.productName, unit: l.unit,
          qtyReq: Number(l.quantityRequested) || 0, qtyAct: Number(l.quantityActual) || 0,
          lot: l.lotNumber || '-', exp: l.expiryDate ? fmtDate(l.expiryDate) : '-',
        })),
        notes: d.notes,
      }
    }
    case 'cash_in':
    case 'cash_out': {
      const isReceipt = docType === 'cash_in'
      return {
        title: isReceipt ? 'PHIẾU THU TIỀN' : 'PHIẾU CHI TIỀN',
        sheetName: isReceipt ? 'PhieuThu' : 'PhieuChi',
        fileTag: isReceipt ? 'PhieuThu' : 'PhieuChi',
        meta: [
          { label: isReceipt ? 'Người nộp tiền' : 'Người nhận tiền', value: d.partnerName || '-' },
          { label: 'Điện thoại', value: d.partnerPhone || '-' },
          { label: 'Địa chỉ', value: d.partnerAddress || '-' },
          { label: `Lý do ${isReceipt ? 'thu' : 'chi'}`, value: d.reason || '-' },
          { label: `Số tiền ${isReceipt ? 'thu' : 'chi'}`, value: (Number(d.amount) || 0).toLocaleString('vi-VN') + ' đ' },
          { label: 'Quỹ / Tài khoản', value: d.fundAccount || '-' },
          ...(d.originalDocRef ? [{ label: 'Kèm theo chứng từ', value: d.originalDocRef }] : []),
          { label: 'Ngày lập', value: fmtDateTime(d.createdAt) },
          { label: 'Người lập', value: d.createdBy || '-' },
        ],
        columns: [],
        rows: [],
        amountInWords: d.amountInWords || convertVndToWords(Number(d.amount) || 0),
        notes: d.notes,
      }
    }
  }
}

export async function generateDocumentXlsx(
  docType: PrintDocType,
  data: any,
  company: DocExportCompany,
): Promise<void> {
  const layout = buildLayout(docType, data)
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = company.companyName || 'CRM Sanh Long Vetco'
  wb.created = new Date()

  const hasTable = layout.columns.length > 0
  const lastCol = hasTable ? layout.columns.length : 4
  const ws = wb.addWorksheet(layout.sheetName, {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  })
  if (hasTable) ws.columns = layout.columns.map(c => ({ width: c.width }))

  const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }
  const allBorders = { top: thin, left: thin, bottom: thin, right: thin }

  let r = 1
  const mergeAcross = (text: string, opts?: { bold?: boolean; size?: number; align?: 'left' | 'center'; color?: string }) => {
    ws.mergeCells(r, 1, r, lastCol)
    const cell = ws.getCell(r, 1)
    cell.value = text
    cell.font = { name: 'Calibri', size: opts?.size ?? 11, bold: opts?.bold, color: opts?.color ? { argb: opts.color } : undefined }
    cell.alignment = { horizontal: opts?.align ?? 'left', vertical: 'middle' }
    r++
  }

  // ── Header công ty + tiêu đề ──────────────────────────────
  mergeAcross(company.companyName || 'CÔNG TY', { bold: true, size: 13 })
  if (company.address) mergeAcross(`Địa chỉ: ${company.address}`, { size: 10 })
  const line2 = [company.phone ? `Điện thoại: ${company.phone}` : '', company.email ? `Email: ${company.email}` : ''].filter(Boolean).join('   |   ')
  if (line2) mergeAcross(line2, { size: 10 })
  if (company.mst) mergeAcross(`Mã số thuế: ${company.mst}`, { size: 10 })
  r++ // blank
  mergeAcross(layout.title, { bold: true, size: 16, align: 'center', color: 'FF1E5A9C' })
  mergeAcross(`Số chứng từ: ${data.docNumber || '-'}`, { size: 11, align: 'center' })
  r++ // blank

  // ── Khối thông tin (2 cột nhãn:giá trị) ───────────────────
  const halfCol = Math.max(1, Math.floor(lastCol / 2))
  for (let i = 0; i < layout.meta.length; i += 2) {
    const writePair = (m: { label: string; value: string }, startCol: number, endCol: number) => {
      const lc = ws.getCell(r, startCol)
      lc.value = `${m.label}:`
      lc.font = { name: 'Calibri', size: 10, bold: true }
      lc.alignment = { vertical: 'top' }
      if (startCol + 1 <= endCol) ws.mergeCells(r, startCol + 1, r, endCol)
      const vc = ws.getCell(r, startCol + 1)
      vc.value = m.value
      vc.font = { name: 'Calibri', size: 10 }
      vc.alignment = { vertical: 'top', wrapText: true }
    }
    writePair(layout.meta[i], 1, halfCol)
    if (layout.meta[i + 1]) writePair(layout.meta[i + 1], halfCol + 1, lastCol)
    r++
  }
  r++ // blank

  // ── Bảng dòng hàng (nếu có) ───────────────────────────────
  if (hasTable) {
    const headerRowIdx = r
    layout.columns.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = c.header
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5A9C' } }
      cell.alignment = { horizontal: c.numeric ? 'right' : (c.key === 'name' ? 'left' : 'center'), vertical: 'middle', wrapText: true }
      cell.border = allBorders
    })
    ws.getRow(r).height = 24
    r++

    if (layout.rows.length === 0) {
      ws.mergeCells(r, 1, r, lastCol)
      const cell = ws.getCell(r, 1)
      cell.value = '(Không có dòng hàng)'
      cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF888888' } }
      cell.alignment = { horizontal: 'center' }
      for (let cc = 1; cc <= lastCol; cc++) ws.getCell(r, cc).border = allBorders
      r++
    } else {
      layout.rows.forEach(row => {
        layout.columns.forEach((c, i) => {
          const cell = ws.getCell(r, i + 1)
          const v = row[c.key]
          if (v !== undefined && v !== null && v !== '') {
            cell.value = v
            if (c.numeric && typeof v === 'number') {
              cell.numFmt = c.qty ? QTY_FMT : NUM_FMT
              cell.alignment = { horizontal: 'right' }
            } else {
              cell.alignment = { horizontal: c.key === 'name' ? 'left' : (c.key === 'stt' ? 'center' : 'left'), wrapText: c.key === 'name' }
            }
          }
          cell.font = { name: 'Calibri', size: 10 }
          cell.border = allBorders
        })
        r++
      })
    }

    // ── Dòng tổng kết (gộp nhãn bên trái, số ở cột cuối) ────
    if (layout.totals && layout.totals.length) {
      for (const t of layout.totals) {
        ws.mergeCells(r, 1, r, lastCol - 1)
        const lc = ws.getCell(r, 1)
        lc.value = t.label
        lc.font = { name: 'Calibri', size: t.bold ? 11 : 10, bold: t.bold }
        lc.alignment = { horizontal: 'right' }
        const vc = ws.getCell(r, lastCol)
        vc.value = (t.negative ? -1 : 1) * t.value
        vc.numFmt = NUM_FMT
        vc.font = { name: 'Calibri', size: t.bold ? 11 : 10, bold: t.bold, color: t.negative ? { argb: 'FFC0392B' } : undefined }
        vc.alignment = { horizontal: 'right' }
        for (let cc = 1; cc <= lastCol; cc++) ws.getCell(r, cc).border = allBorders
        r++
      }
    }

    ws.views = [{ state: 'frozen', ySplit: headerRowIdx, showGridLines: false }]
  }

  // ── Bằng chữ + ghi chú ────────────────────────────────────
  r++
  if (layout.amountInWords) mergeAcross(`Bằng chữ: ${layout.amountInWords}`, { size: 10 })
  if (layout.notes) mergeAcross(`Ghi chú: ${layout.notes}`, { size: 10 })

  // ── Tải về ────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const safeCode = String(data.docNumber || 'CT').replace(/[^a-zA-Z0-9-_]/g, '')
  link.download = `${layout.fileTag}_${safeCode}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
