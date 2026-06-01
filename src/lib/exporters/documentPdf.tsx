import { convertVndToWords } from '../../utils/numberToWords'
import type { PrintDocType, DocExportCompany } from './documentXlsx'

// ─────────────────────────────────────────────────────────────
// Sinh file PDF thật (tải về) cho 6 loại chứng từ bằng @react-pdf/renderer.
// Toàn bộ thư viện react-pdf + font được nạp động (lazy) trong hàm export để
// không phình main bundle. Font Be Vietnam Pro (.ttf) nhúng từ /public/fonts
// để hiển thị đầy đủ dấu tiếng Việt (Helvetica mặc định không có).
// ─────────────────────────────────────────────────────────────

let fontRegistered = false

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(v: any) {
  if (!v) return ''
  const d = new Date(v); if (isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
function fmtDateTime(v: any) {
  if (!v) return ''
  const d = new Date(v); if (isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const money = (n: any) => (Number(n) || 0).toLocaleString('vi-VN')
const qty = (n: any) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', credit: 'Ghi nợ công nợ', credit_note: 'Bù trừ công nợ',
}
const payLabel = (m?: string) => (m ? PAYMENT_LABEL[m] || m : '-')

export async function generateDocumentPdf(
  docType: PrintDocType,
  data: any,
  company: DocExportCompany,
  opts?: { paperSize?: 'A4' | 'A5'; orientation?: 'portrait' | 'landscape' },
): Promise<void> {
  const RPDF = await import('@react-pdf/renderer')
  const { Document, Page, View, Text, StyleSheet, Font, pdf } = RPDF
  const React = (await import('react')).default

  if (!fontRegistered) {
    Font.register({
      family: 'BeVietnamPro',
      fonts: [
        { src: '/fonts/BeVietnamPro-Regular.ttf', fontWeight: 400 },
        { src: '/fonts/BeVietnamPro-SemiBold.ttf', fontWeight: 600 },
        // react-pdf KHÔNG nghiêng giả lập — phải đăng ký riêng fontStyle 'italic',
        // nếu không các style italic ('Bằng chữ', '(Ký, ghi rõ họ tên)') sẽ ném
        // "Could not resolve font". Dùng lại file Regular/SemiBold (chữ đứng) để
        // không phình asset; hình thức đứng vẫn đúng chuẩn chứng từ.
        { src: '/fonts/BeVietnamPro-Regular.ttf', fontWeight: 400, fontStyle: 'italic' },
        { src: '/fonts/BeVietnamPro-SemiBold.ttf', fontWeight: 600, fontStyle: 'italic' },
      ],
    })
    // Tránh ngắt dòng kỳ lạ với từ tiếng Việt dài
    Font.registerHyphenationCallback(word => [word])
    fontRegistered = true
  }

  const styles = StyleSheet.create({
    page: { fontFamily: 'BeVietnamPro', fontSize: 9, color: '#000', paddingVertical: 24, paddingHorizontal: 28, lineHeight: 1.4 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#000', paddingBottom: 8, marginBottom: 10 },
    companyName: { fontSize: 11, fontWeight: 600, marginBottom: 2 },
    small: { fontSize: 8.5 },
    title: { fontSize: 15, fontWeight: 600, textAlign: 'right' },
    docNo: { fontSize: 9, textAlign: 'right', marginTop: 2 },
    metaWrap: { flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, borderColor: '#999', borderStyle: 'dashed', paddingBottom: 6, marginBottom: 8 },
    metaItem: { width: '50%', flexDirection: 'row', marginBottom: 2, paddingRight: 8 },
    metaLabel: { fontWeight: 600 },
    metaFull: { width: '100%', flexDirection: 'row', marginBottom: 2 },
    table: { borderWidth: 1, borderColor: '#000', borderBottomWidth: 0, borderRightWidth: 0 },
    tr: { flexDirection: 'row' },
    th: { backgroundColor: '#e5e7eb', fontWeight: 600, fontSize: 8.5, textAlign: 'center', padding: 3, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#000' },
    td: { fontSize: 8.5, padding: 3, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#000' },
    totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
    totalsBox: { width: '45%' },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
    grandRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#000', paddingTop: 3, marginTop: 2 },
    words: { fontStyle: 'italic', marginTop: 6 },
    cashBox: { borderWidth: 1, borderColor: '#000', padding: 14, marginBottom: 12 },
    cashRow: { flexDirection: 'row', marginBottom: 5 },
    signWrap: { flexDirection: 'row', marginTop: 24 },
    signCol: { flex: 1, alignItems: 'center' },
    signRole: { fontWeight: 600, fontSize: 9, textAlign: 'center' },
    signHint: { fontSize: 7.5, color: '#666', fontStyle: 'italic', textAlign: 'center' },
  })

  const h = React.createElement

  // ── Header công ty + tiêu đề chứng từ ─────────────────────
  const renderHeader = (title: string) =>
    h(View, { style: styles.headerRow }, [
      h(View, { key: 'c', style: { flex: 1, paddingRight: 8 } }, [
        h(Text, { key: 'n', style: styles.companyName }, company.companyName || 'CÔNG TY'),
        company.address ? h(Text, { key: 'a', style: styles.small }, `Địa chỉ: ${company.address}`) : null,
        h(Text, { key: 'p', style: styles.small }, `Điện thoại: ${company.phone || '-'}${company.email ? `  |  Email: ${company.email}` : ''}`),
        company.mst ? h(Text, { key: 'm', style: styles.small }, `Mã số thuế: ${company.mst}`) : null,
      ]),
      h(View, { key: 't', style: { width: '40%' } }, [
        h(Text, { key: 'ti', style: styles.title }, title),
        h(Text, { key: 'd', style: styles.docNo }, `Số: ${data.docNumber || '-'}`),
      ]),
    ])

  // ── Khối thông tin (cặp nhãn:giá trị) ─────────────────────
  const renderMeta = (pairs: { label: string; value: string; full?: boolean }[]) =>
    h(View, { style: styles.metaWrap }, pairs.map((p, i) =>
      h(View, { key: i, style: p.full ? styles.metaFull : styles.metaItem }, [
        h(Text, { key: 'l', style: styles.metaLabel }, `${p.label}: `),
        h(Text, { key: 'v' }, p.value || '-'),
      ])))

  // ── Bảng dòng hàng ────────────────────────────────────────
  const renderTable = (cols: { header: string; w: number; align?: 'left' | 'right' | 'center' }[], rows: (string | number)[][]) =>
    h(View, { style: styles.table }, [
      h(View, { key: 'h', style: styles.tr, fixed: true }, cols.map((c, i) =>
        h(Text, { key: i, style: [styles.th, { width: `${c.w}%` }] }, c.header))),
      ...rows.map((row, ri) =>
        h(View, { key: ri, style: styles.tr, wrap: false }, cols.map((c, ci) =>
          h(Text, { key: ci, style: [styles.td, { width: `${c.w}%`, textAlign: c.align || 'left' }] }, String(row[ci] ?? ''))))),
    ])

  // ── Chữ ký ────────────────────────────────────────────────
  const renderSign = (roles: string[]) =>
    h(View, { style: styles.signWrap }, roles.map((role, i) =>
      h(View, { key: i, style: styles.signCol }, [
        h(Text, { key: 'r', style: styles.signRole }, role),
        h(Text, { key: 'h', style: styles.signHint }, '(Ký, ghi rõ họ tên)'),
        h(View, { key: 's', style: { height: 40 } }),
        i === 0 ? h(Text, { key: 'n', style: { fontWeight: 600, fontSize: 8.5 } }, data.createdBy || '') : null,
      ])))

  // ── Nội dung theo loại chứng từ ───────────────────────────
  let body: any
  let fileTag = 'CT'

  if (docType === 'invoice') {
    fileTag = 'HoaDon'
    body = [
      renderHeader('HÓA ĐƠN BÁN HÀNG'),
      renderMeta([
        { label: 'Khách hàng', value: data.customerName },
        { label: 'Số điện thoại', value: data.customerPhone },
        { label: 'Địa chỉ', value: data.customerAddress, full: true },
        ...(data.deliveryAddress ? [{ label: 'Địa chỉ giao hàng', value: data.deliveryAddress, full: true }] : []),
        { label: 'Ngày lập', value: fmtDateTime(data.createdAt) },
        { label: 'Hình thức thanh toán', value: payLabel(data.paymentMethod) },
        { label: 'Kho xuất', value: data.warehouseName },
        { label: 'Người lập', value: data.createdBy },
      ]),
      renderTable(
        [
          { header: 'STT', w: 6, align: 'center' }, { header: 'Mã hàng', w: 13 },
          { header: 'Tên sản phẩm', w: 31 }, { header: 'ĐVT', w: 7, align: 'center' },
          { header: 'SL', w: 8, align: 'center' }, { header: 'Đơn giá', w: 12, align: 'right' },
          { header: 'CK', w: 9, align: 'right' }, { header: 'Thành tiền', w: 14, align: 'right' },
        ],
        (data.lines || []).map((l: any, i: number) => [
          i + 1, l.productCode, l.productName + (l.lotNumber ? `\nLô: ${l.lotNumber}${l.expiryDate ? ' - HSD: ' + fmtDate(l.expiryDate) : ''}` : ''),
          l.unit, qty(l.quantity), money(l.unitPrice), Number(l.discount) > 0 ? money(l.discount) : '-', money(l.totalAmount),
        ]),
      ),
      h(View, { key: 'tot', style: styles.totalsWrap }, h(View, { style: styles.totalsBox }, [
        h(View, { key: 's', style: styles.totalRow }, [h(Text, { key: 'a' }, 'Cộng tiền hàng:'), h(Text, { key: 'b' }, money(data.subtotal))]),
        Number(data.discountTotal) > 0 ? h(View, { key: 'd', style: styles.totalRow }, [h(Text, { key: 'a' }, 'Chiết khấu đơn:'), h(Text, { key: 'b' }, '-' + money(data.discountTotal))]) : null,
        h(View, { key: 'g', style: styles.grandRow }, [h(Text, { key: 'a', style: { fontWeight: 600 } }, 'TỔNG CỘNG:'), h(Text, { key: 'b', style: { fontWeight: 600 } }, money(data.grandTotal))]),
      ])),
      data.notes ? h(Text, { key: 'note', style: styles.words }, `Ghi chú: ${data.notes}`) : null,
      h(Text, { key: 'w', style: styles.words }, `Bằng chữ: ${data.amountInWords || convertVndToWords(Number(data.grandTotal) || 0)}`),
      renderSign(['Người lập phiếu', 'Khách hàng', 'Người giao hàng', 'Thủ kho', 'Giám đốc']),
    ]
  } else if (docType === 'receipt') {
    fileTag = 'PhieuNhap'
    body = [
      renderHeader('PHIẾU NHẬP KHO HÀNG'),
      renderMeta([
        { label: 'Nhà cung cấp', value: data.supplierName },
        { label: 'Số điện thoại', value: data.supplierPhone },
        { label: 'Địa chỉ', value: data.supplierAddress, full: true },
        { label: 'Lý do nhập', value: data.receiptReason },
        { label: 'Kho nhận', value: data.warehouseName },
        { label: 'Số PO liên kết', value: data.poNumber },
        { label: 'Ngày lập', value: fmtDateTime(data.createdAt) },
        { label: 'Người lập', value: data.createdBy },
      ]),
      renderTable(
        [
          { header: 'STT', w: 6, align: 'center' }, { header: 'Mã hàng', w: 13 },
          { header: 'Tên sản phẩm', w: 33 }, { header: 'ĐVT', w: 8, align: 'center' },
          { header: 'SL nhập', w: 10, align: 'center' }, { header: 'Đơn giá vốn', w: 14, align: 'right' },
          { header: 'Thành tiền', w: 16, align: 'right' },
        ],
        (data.lines || []).map((l: any, i: number) => [
          i + 1, l.productCode, l.productName + (l.lotNumber ? `\nLô: ${l.lotNumber}${l.expiryDate ? ' - HSD: ' + fmtDate(l.expiryDate) : ''}` : ''),
          l.unit, qty(l.quantityReceived), money(l.unitPrice), money(l.totalAmount),
        ]),
      ),
      h(View, { key: 'tot', style: styles.totalsWrap }, h(View, { style: styles.totalsBox },
        h(View, { style: styles.grandRow }, [h(Text, { key: 'a', style: { fontWeight: 600 } }, 'TỔNG GIÁ TRỊ NHẬP:'), h(Text, { key: 'b', style: { fontWeight: 600 } }, money(data.totalAmount))]))),
      data.notes ? h(Text, { key: 'note', style: styles.words }, `Ghi chú: ${data.notes}`) : null,
      h(Text, { key: 'w', style: styles.words }, `Bằng chữ: ${data.amountInWords || convertVndToWords(Number(data.totalAmount) || 0)}`),
      renderSign(['Người lập phiếu', 'Người giao hàng', 'Thủ kho nhận', 'Kế toán trưởng', 'Giám đốc']),
    ]
  } else if (docType === 'return') {
    fileTag = 'PhieuTra'
    const partnerTitle = data.partnerType === 'customer' ? 'Khách hàng' : 'Nhà cung cấp'
    body = [
      renderHeader(data.partnerType === 'customer' ? 'PHIẾU KHÁCH TRẢ HÀNG' : 'PHIẾU TRẢ HÀNG NCC'),
      renderMeta([
        { label: partnerTitle, value: data.partnerName },
        { label: 'Số điện thoại', value: data.partnerPhone },
        { label: 'Địa chỉ', value: data.partnerAddress, full: true },
        { label: 'Lý do trả hàng', value: data.returnReason },
        { label: 'Kho nhận trả', value: data.warehouseName },
        { label: 'Hình thức hoàn tiền', value: payLabel(data.refundMethod) },
        { label: 'Ngày lập', value: fmtDateTime(data.createdAt) },
        { label: 'Người lập', value: data.createdBy },
      ]),
      renderTable(
        [
          { header: 'STT', w: 6, align: 'center' }, { header: 'Mã hàng', w: 13 },
          { header: 'Tên sản phẩm', w: 33 }, { header: 'ĐVT', w: 8, align: 'center' },
          { header: 'SL trả', w: 10, align: 'center' }, { header: 'Đơn giá hoàn', w: 14, align: 'right' },
          { header: 'Thành tiền', w: 16, align: 'right' },
        ],
        (data.lines || []).map((l: any, i: number) => [
          i + 1, l.productCode, l.productName + (l.lotNumber ? `\nLô: ${l.lotNumber}${l.expiryDate ? ' - HSD: ' + fmtDate(l.expiryDate) : ''}` : ''),
          l.unit, qty(l.quantityReturned), money(l.unitPrice), money(l.totalAmount),
        ]),
      ),
      h(View, { key: 'tot', style: styles.totalsWrap }, h(View, { style: styles.totalsBox },
        h(View, { style: styles.grandRow }, [h(Text, { key: 'a', style: { fontWeight: 600 } }, 'TỔNG TIỀN HOÀN TRẢ:'), h(Text, { key: 'b', style: { fontWeight: 600 } }, money(data.totalAmount))]))),
      data.notes ? h(Text, { key: 'note', style: styles.words }, `Ghi chú: ${data.notes}`) : null,
      h(Text, { key: 'w', style: styles.words }, `Bằng chữ: ${data.amountInWords || convertVndToWords(Number(data.totalAmount) || 0)}`),
      renderSign(['Người lập phiếu', partnerTitle, 'Thủ kho nhận', 'Kế toán trưởng', 'Giám đốc']),
    ]
  } else if (docType === 'transfer') {
    fileTag = 'PhieuXuat'
    body = [
      renderHeader('PHIẾU XUẤT KHO HÀNG'),
      renderMeta([
        { label: 'Kho xuất', value: data.fromWarehouse },
        { label: 'Nơi nhận hàng', value: data.toWarehouse },
        { label: 'Lý do xuất', value: data.transferReason, full: true },
        ...(data.receiverName ? [{ label: 'Người nhận hàng', value: data.receiverName }] : []),
        { label: 'Ngày lập', value: fmtDateTime(data.createdAt) },
        { label: 'Người lập phiếu', value: data.createdBy },
      ]),
      renderTable(
        [
          { header: 'STT', w: 6, align: 'center' }, { header: 'Mã hàng', w: 14 },
          { header: 'Tên sản phẩm / Vật tư', w: 30 }, { header: 'ĐVT', w: 8, align: 'center' },
          { header: 'SL yêu cầu', w: 11, align: 'center' }, { header: 'SL thực xuất', w: 11, align: 'center' },
          { header: 'Số lô', w: 12, align: 'center' }, { header: 'HSD', w: 8, align: 'center' },
        ],
        (data.lines || []).map((l: any, i: number) => [
          i + 1, l.productCode, l.productName, l.unit, qty(l.quantityRequested), qty(l.quantityActual),
          l.lotNumber || '-', l.expiryDate ? fmtDate(l.expiryDate) : '-',
        ]),
      ),
      data.notes ? h(Text, { key: 'note', style: styles.words }, `Ghi chú: ${data.notes}`) : null,
      renderSign(['Người lập phiếu', 'Người nhận hàng', 'Người giao hàng', 'Thủ kho xuất', 'Thủ kho nhận / GĐ']),
    ]
  } else {
    // cash_in / cash_out
    const isReceipt = docType === 'cash_in'
    fileTag = isReceipt ? 'PhieuThu' : 'PhieuChi'
    const cashRow = (label: string, value: string, big?: boolean) =>
      h(View, { key: label, style: styles.cashRow }, [
        h(Text, { key: 'l', style: { width: '28%', fontWeight: 600 } }, label),
        h(Text, { key: 'v', style: { width: '72%', fontWeight: big ? 600 : 400, fontSize: big ? 12 : 9 } }, value),
      ])
    body = [
      renderHeader(isReceipt ? 'PHIẾU THU TIỀN' : 'PHIẾU CHI TIỀN'),
      h(View, { key: 'box', style: styles.cashBox }, [
        cashRow(isReceipt ? 'Người nộp tiền:' : 'Người nhận tiền:', data.partnerName || '-', true),
        data.partnerPhone ? cashRow('Số điện thoại:', data.partnerPhone) : null,
        cashRow('Địa chỉ:', data.partnerAddress || '-'),
        cashRow(`Lý do ${isReceipt ? 'thu' : 'chi'}:`, data.reason || '-'),
        cashRow(`Số tiền ${isReceipt ? 'thu' : 'chi'}:`, money(data.amount) + ' đ', true),
        cashRow('Bằng chữ:', data.amountInWords || convertVndToWords(Number(data.amount) || 0)),
        cashRow('Quỹ / Tài khoản:', data.fundAccount || '-'),
        data.originalDocRef ? cashRow('Kèm theo chứng từ:', data.originalDocRef) : null,
        data.notes ? cashRow('Ghi chú thêm:', data.notes) : null,
        cashRow('Ngày lập:', fmtDateTime(data.createdAt)),
      ]),
      renderSign(['Người lập biểu', isReceipt ? 'Người nộp tiền' : 'Người nhận tiền', 'Thủ quỹ', 'Kế toán trưởng', 'Giám đốc']),
    ]
  }

  const doc = h(Document, {},
    h(Page, { size: opts?.paperSize || 'A4', orientation: opts?.orientation || 'portrait', style: styles.page }, body))

  const blob = await pdf(doc).toBlob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const safeCode = String(data.docNumber || 'CT').replace(/[^a-zA-Z0-9-_]/g, '')
  link.download = `${fileTag}_${safeCode}.pdf`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
