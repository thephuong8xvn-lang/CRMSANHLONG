// ─────────────────────────────────────────────────────────────
// Xuất .xlsx danh sách công nợ khách hàng (module /debts).
//
// Mục đích thực tế: cầm đi đòi nợ. Vì vậy bảng có SĐT, số ngày trễ và cột
// trống "Đã thu / Ghi chú" để điền tay tại hiện trường.
//
// exceljs nạp động (dynamic import) để không phình main bundle — cùng quy ước
// với `documentXlsx.ts`. Số liệu do trang truyền vào, hàm này KHÔNG tự query
// (tránh lệch với những gì người dùng đang nhìn thấy trên màn hình).
// ─────────────────────────────────────────────────────────────

const NUM_FMT = '#,##0'

export interface DebtLedgerExportRow {
  code: string | null
  ten: string
  dien_thoai: string | null
  nhan_vien: string
  chi_nhanh: string
  du_no: number
  qua_han: number
  den_han_7n: number
  khong_han: number
  so_ngay_qua_han: number | null
  han_cu_nhat: string | null
  credit_limit: number
  lan_thu_gan_nhat: string | null
}

export interface DebtLedgerExportInput {
  rows: DebtLedgerExportRow[]
  /** Nhãn bộ lọc đang áp dụng — in vào đầu file để biết đang cầm danh sách nào. */
  filterLabel: string
  searchLabel?: string
  ownerLabel?: string
  /** Tổng của TOÀN BỘ tập lọc (không chỉ trang đang xem). */
  tongDuNo: number
  tongQuaHan: number
  tongSoKh: number
  companyName?: string
}

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(v: string | null | undefined) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

const COLS: { key: keyof DebtLedgerExportRow | 'stt' | 'da_thu' | 'ghi_chu'; header: string; width: number; numeric?: boolean }[] = [
  { key: 'stt',              header: 'STT',            width: 6 },
  { key: 'code',             header: 'Mã KH',          width: 16 },
  { key: 'ten',              header: 'Khách hàng',     width: 38 },
  { key: 'dien_thoai',       header: 'Điện thoại',     width: 18 },
  { key: 'du_no',            header: 'Dư nợ',          width: 16, numeric: true },
  { key: 'qua_han',          header: 'Quá hạn',        width: 16, numeric: true },
  { key: 'so_ngay_qua_han',  header: 'Số ngày trễ',    width: 12, numeric: true },
  { key: 'den_han_7n',       header: 'Đến hạn ≤7n',    width: 15, numeric: true },
  { key: 'khong_han',        header: 'Không có hạn',   width: 15, numeric: true },
  { key: 'han_cu_nhat',      header: 'Hạn cũ nhất',    width: 13 },
  { key: 'credit_limit',     header: 'Hạn mức',        width: 15, numeric: true },
  { key: 'lan_thu_gan_nhat', header: 'Thu gần nhất',   width: 13 },
  { key: 'nhan_vien',        header: 'NV phụ trách',   width: 20 },
  { key: 'chi_nhanh',        header: 'Chi nhánh',      width: 20 },
  { key: 'da_thu',           header: 'Đã thu',         width: 16, numeric: true },
  { key: 'ghi_chu',          header: 'Ghi chú',        width: 26 },
]

export async function generateDebtLedgerXlsx(input: DebtLedgerExportInput): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = input.companyName || 'CRM Sanh Long Vetco'
  wb.created = new Date()

  const lastCol = COLS.length
  const ws = wb.addWorksheet('Cong no khach hang', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 0 }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })
  ws.columns = COLS.map(c => ({ width: c.width }))

  const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }
  const allBorders = { top: thin, left: thin, bottom: thin, right: thin }

  let r = 1
  const mergeAcross = (text: string, opts?: { bold?: boolean; size?: number; align?: 'left' | 'center'; color?: string; italic?: boolean }) => {
    ws.mergeCells(r, 1, r, lastCol)
    const cell = ws.getCell(r, 1)
    cell.value = text
    cell.font = {
      name: 'Calibri', size: opts?.size ?? 11, bold: opts?.bold, italic: opts?.italic,
      color: opts?.color ? { argb: opts.color } : undefined,
    }
    cell.alignment = { horizontal: opts?.align ?? 'left', vertical: 'middle' }
    r++
  }

  // ── Tiêu đề ──
  mergeAcross(input.companyName || 'CÔNG TY TNHH SANH LONG VETCO', { bold: true, size: 13 })
  mergeAcross('DANH SÁCH CÔNG NỢ KHÁCH HÀNG', { bold: true, size: 16, align: 'center', color: 'FF1E5A9C' })

  const now = new Date()
  mergeAcross(
    `Kết xuất lúc ${pad(now.getHours())}:${pad(now.getMinutes())} ngày ${fmtDate(now.toISOString())}`,
    { size: 10, align: 'center', italic: true },
  )
  r++

  const filters = [
    `Nhóm: ${input.filterLabel}`,
    input.searchLabel ? `Tìm: "${input.searchLabel}"` : '',
    input.ownerLabel ? `NV phụ trách: ${input.ownerLabel}` : '',
  ].filter(Boolean).join('   |   ')
  mergeAcross(filters, { size: 10, bold: true })
  mergeAcross(
    `Tổng: ${input.tongSoKh} khách  ·  dư nợ ${input.tongDuNo.toLocaleString('vi-VN')} ₫  ·  quá hạn ${input.tongQuaHan.toLocaleString('vi-VN')} ₫`,
    { size: 10, bold: true, color: 'FFB00020' },
  )
  if (input.rows.length < input.tongSoKh) {
    mergeAcross(
      `⚠ File này chỉ chứa ${input.rows.length} dòng của trang đang xem. Tổng phía trên là của TOÀN BỘ bộ lọc.`,
      { size: 9, italic: true, color: 'FF888888' },
    )
  }
  r++

  // ── Header bảng ──
  const headerRow = r
  COLS.forEach((c, i) => {
    const cell = ws.getCell(r, i + 1)
    cell.value = c.header
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E5A9C' } }
    cell.alignment = { horizontal: c.numeric ? 'right' : 'center', vertical: 'middle', wrapText: true }
    cell.border = allBorders
  })
  ws.getRow(r).height = 26
  r++

  // ── Dòng dữ liệu ──
  if (input.rows.length === 0) {
    ws.mergeCells(r, 1, r, lastCol)
    const cell = ws.getCell(r, 1)
    cell.value = '(Không có khách hàng nào khớp bộ lọc)'
    cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF888888' } }
    cell.alignment = { horizontal: 'center' }
    for (let cc = 1; cc <= lastCol; cc++) ws.getCell(r, cc).border = allBorders
    r++
  } else {
    input.rows.forEach((row, idx) => {
      const late = (row.so_ngay_qua_han ?? 0) > 0
      COLS.forEach((c, i) => {
        const cell = ws.getCell(r, i + 1)
        let v: any = ''
        switch (c.key) {
          case 'stt':              v = idx + 1; break
          case 'da_thu':
          case 'ghi_chu':          v = ''; break   // để trống, điền tay tại hiện trường
          case 'han_cu_nhat':      v = fmtDate(row.han_cu_nhat); break
          case 'lan_thu_gan_nhat': v = fmtDate(row.lan_thu_gan_nhat); break
          case 'credit_limit':     v = Number(row.credit_limit) > 0 ? Number(row.credit_limit) : ''; break
          case 'qua_han':          v = Number(row.qua_han) > 0 ? Number(row.qua_han) : ''; break
          case 'den_han_7n':       v = Number(row.den_han_7n) > 0 ? Number(row.den_han_7n) : ''; break
          case 'khong_han':        v = Number(row.khong_han) > 0 ? Number(row.khong_han) : ''; break
          case 'so_ngay_qua_han':  v = row.so_ngay_qua_han ?? ''; break
          case 'du_no':            v = Number(row.du_no); break
          default:                 v = (row as any)[c.key] ?? ''
        }
        if (v !== '') cell.value = v
        cell.font = {
          name: 'Calibri', size: 10,
          bold: c.key === 'du_no',
          color: late && (c.key === 'qua_han' || c.key === 'so_ngay_qua_han')
            ? { argb: 'FFB00020' } : undefined,
        }
        if (c.numeric && typeof v === 'number') {
          cell.numFmt = NUM_FMT
          cell.alignment = { horizontal: 'right' }
        } else {
          cell.alignment = {
            horizontal: c.key === 'ten' ? 'left' : (c.key === 'stt' ? 'center' : 'left'),
            wrapText: c.key === 'ten',
          }
        }
        cell.border = allBorders
      })
      // Tô nền nhạt cho dòng quá hạn — nhìn phát biết phải gọi ai trước.
      if (late) {
        for (let cc = 1; cc <= lastCol; cc++) {
          ws.getCell(r, cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEC' } }
        }
      }
      r++
    })

    // ── Dòng tổng của TRANG đang xuất ──
    const sum = (f: (x: DebtLedgerExportRow) => number) => input.rows.reduce((s, x) => s + (Number(f(x)) || 0), 0)
    COLS.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1)
      if (i === 0) cell.value = 'Cộng'
      if (c.key === 'du_no')      cell.value = sum(x => x.du_no)
      if (c.key === 'qua_han')    cell.value = sum(x => x.qua_han)
      if (c.key === 'den_han_7n') cell.value = sum(x => x.den_han_7n)
      if (c.key === 'khong_han')  cell.value = sum(x => x.khong_han)
      cell.font = { name: 'Calibri', size: 10, bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }
      if (c.numeric) { cell.numFmt = NUM_FMT; cell.alignment = { horizontal: 'right' } }
      cell.border = allBorders
    })
    r++
  }

  // Khóa hàng tiêu đề để cuộn vẫn thấy tên cột + bật lọc tự động
  ws.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }]
  if (input.rows.length > 0) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: lastCol } }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `CongNoKhachHang_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
