// Bóc tách hóa đơn dạng HTML (bản thể hiện HĐĐT). Hỗ trợ:
//  1) Định dạng eHoaDon (ehoadondientu.com) — dò cột theo CLASS th (tb-thh/tb-dvt/
//     tb-sl/tb-dg/tb-ts) → ổn định, không phụ thuộc mã hóa.
//  2) Fallback heuristic theo từ khóa tiêu đề cho nhà cung cấp khác.
// Số kiểu VN ("2.250.000"); tự sửa mojibake UTF-8.
import type { ParsedInvoice, ParsedInvoiceLine } from './types'
import { parseVnNumber, fixMojibake } from './numberVN'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

interface ColIdx { name: number; unit: number; qty: number; price: number; rate: number }
const EMPTY: ColIdx = { name: -1, unit: -1, qty: -1, price: -1, rate: -1 }

// Dò cột theo class (eHoaDon). th có thể trùng class (tb-dg cho Đơn giá + Chiết khấu) → lấy cái đầu.
function detectByClass(cells: Element[]): ColIdx {
  const idx: ColIdx = { ...EMPTY }
  cells.forEach((c, i) => {
    const cls = c.className || ''
    if (idx.name < 0 && /tb-thh/.test(cls)) idx.name = i
    else if (idx.unit < 0 && /tb-dvt/.test(cls)) idx.unit = i
    else if (idx.qty < 0 && /tb-sl/.test(cls)) idx.qty = i
    else if (idx.price < 0 && /tb-dg/.test(cls)) idx.price = i
    if (idx.rate < 0 && /tb-ts/.test(cls)) idx.rate = i
  })
  return idx
}

// Dò cột theo chữ tiêu đề (fallback). Tránh bắt nhầm cột "Loại hàng hóa" (yêu cầu có "ten").
function detectByText(cells: string[]): ColIdx {
  const idx: ColIdx = { ...EMPTY }
  cells.forEach((h, i) => {
    const n = norm(h)
    if (idx.name < 0 && (n.includes('ten hang') || n.includes('ten san pham') || n.includes('ten hh') || n.includes('ten vat tu') || n.includes('dien giai'))) idx.name = i
    else if (idx.unit < 0 && (n.includes('dvt') || n.includes('don vi tinh'))) idx.unit = i
    else if (idx.qty < 0 && (n.includes('so luong') || n === 'sl')) idx.qty = i
    else if (idx.price < 0 && n.includes('don gia')) idx.price = i
    if (idx.rate < 0 && n.includes('thue suat')) idx.rate = i
  })
  return idx
}

export function parseHtmlInvoice(rawText: string): ParsedInvoice {
  const warnings: string[] = []
  const text = fixMojibake(rawText)
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const tables = Array.from(doc.querySelectorAll('table'))

  let best: { idx: ColIdx; rows: HTMLTableRowElement[] } | null = null
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr')) as HTMLTableRowElement[]
    for (let r = 0; r < Math.min(rows.length, 6); r++) {
      const cellEls = Array.from(rows[r].querySelectorAll('th,td'))
      if (cellEls.length === 0) continue
      let idx = detectByClass(cellEls)
      if (idx.name < 0 || idx.price < 0) {
        idx = detectByText(cellEls.map((c) => c.textContent || ''))
      }
      if (idx.name >= 0 && idx.price >= 0) {
        best = { idx, rows: rows.slice(r + 1) }
        break
      }
    }
    if (best) break
  }

  if (!best) {
    return { lines: [], warnings: ['Không tìm thấy bảng dòng hàng trong HTML — vui lòng nhập tay.'], format: 'html' }
  }

  const { idx, rows } = best
  const lines: ParsedInvoiceLine[] = []
  let invVatRate: number | undefined
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim())
    if (cells.length === 0) continue
    const name = (cells[idx.name] || '').trim()
    const nname = norm(name)
    // Dừng khi gặp dòng tổng / cộng tiền hàng
    if (nname.includes('cong tien hang') || nname.includes('tong cong') || nname.includes('tong tien') || nname.includes('tien thue')) break
    if (!name) continue
    // Bỏ dòng "giảm trừ / chiết khấu trên hóa đơn"
    if (nname.includes('giam tru') || nname.startsWith('chiet khau')) continue
    const qty = idx.qty >= 0 ? parseVnNumber(cells[idx.qty]) : 0
    const price = idx.price >= 0 ? parseVnNumber(cells[idx.price]) : 0
    if (price <= 0 && qty <= 0) continue
    const rate = idx.rate >= 0 ? parseVnNumber(cells[idx.rate]) : undefined
    if (rate != null && rate > 0 && invVatRate == null) invVatRate = rate
    lines.push({
      name,
      qty: qty || 1,
      price,
      unit: idx.unit >= 0 ? (cells[idx.unit] || undefined) : undefined,
      vatRate: rate != null && rate > 0 ? rate : undefined,
    })
  }

  const invoiceNo = (() => {
    const m = text.match(/(?:số|so)\s*[:\-]?\s*(\d{3,})/i)
    return m ? m[1] : undefined
  })()

  if (lines.length === 0) warnings.push('Không bóc được dòng hàng từ HTML — kiểm tra lại file.')
  warnings.push('Hóa đơn không có Số lô / NSX / HSD — vui lòng nhập tay đủ 3 trường.')

  return { lines, invoiceNo, vatRate: invVatRate, warnings, format: 'html' }
}
