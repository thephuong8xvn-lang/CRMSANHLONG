// Bóc tách hóa đơn điện tử XML chuẩn TT78/HĐĐT (Nghị định 123 / Thông tư 78).
// Tên thẻ theo định dạng chuẩn (không phụ thuộc namespace — so theo localName):
//   DSHHDVu > HHDVu : THHDVu (tên), DVTinh, SLuong, DGia, ThTien, TSuat
//   TTChung: SHDon (số HĐ);  NBan: Ten (tên NCC), MST (mã số thuế)
import type { ParsedInvoice, ParsedInvoiceLine } from './types'
import { fixMojibake } from './numberVN'

// Tìm mọi phần tử con (đệ quy) khớp localName (bỏ qua namespace prefix)
function findAll(root: Element | Document, local: string): Element[] {
  const out: Element[] = []
  const all = root.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    const el = all[i]
    if (el.localName === local) out.push(el)
  }
  return out
}

function firstText(root: Element | Document, local: string): string {
  const els = findAll(root, local)
  return els.length ? (els[0].textContent || '').trim() : ''
}

function childText(parent: Element, local: string): string {
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i]
    if (c.localName === local) return (c.textContent || '').trim()
  }
  // không phải con trực tiếp → tìm sâu (một số nhà cung cấp lồng thêm)
  return firstText(parent, local)
}

function num(s: string): number {
  if (!s) return 0
  // XML thường dùng dấu chấm thập phân chuẩn, nhưng phòng trường hợp có phân cách
  const cleaned = s.replace(/\s/g, '').replace(/,/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

export function parseXmlInvoice(text: string): ParsedInvoice {
  const warnings: string[] = []
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    return { lines: [], warnings: ['File XML không hợp lệ / không đọc được.'], format: 'xml' }
  }

  const items = findAll(doc, 'HHDVu')
  const lines: ParsedInvoiceLine[] = []
  for (const it of items) {
    const name = fixMojibake(childText(it, 'THHDVu'))
    if (!name) continue
    const qty = num(childText(it, 'SLuong'))
    const price = num(childText(it, 'DGia'))
    const unit = childText(it, 'DVTinh') || undefined
    const tsuat = childText(it, 'TSuat')
    // TSuat có thể là "10%", "KCT", "KKKNT"… → lấy số nếu có
    const rateMatch = tsuat.match(/(\d+(?:[.,]\d+)?)/)
    const vatRate = rateMatch ? num(rateMatch[1]) : undefined
    lines.push({ name, qty: qty || 1, price, unit, vatRate })
  }

  const invoiceNo = firstText(doc, 'SHDon') || undefined
  const supplierName = (() => {
    const nban = findAll(doc, 'NBan')[0]
    return nban ? childText(nban, 'Ten') || undefined : undefined
  })()
  const supplierTaxCode = (() => {
    const nban = findAll(doc, 'NBan')[0]
    return nban ? childText(nban, 'MST') || undefined : undefined
  })()
  const vatRate = lines.find((l) => l.vatRate != null)?.vatRate

  if (lines.length === 0) warnings.push('Không bóc được dòng hàng nào từ XML (kiểm tra định dạng HĐĐT).')
  warnings.push('Hóa đơn không có Số lô / NSX / HSD — vui lòng nhập tay đủ 3 trường.')

  return { lines, invoiceNo, supplierName, supplierTaxCode, vatRate, warnings, format: 'xml' }
}
