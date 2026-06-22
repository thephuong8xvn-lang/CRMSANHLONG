// Tiện ích ánh xạ cột Google Sheet ↔ trường dữ liệu CRM (dùng cho nhập hàng từ Drive).
import { removeVietnameseTones } from '../components/SmartSearchSelect'

// Các trường có thể ánh xạ từ cột Sheet
export interface ColumnMap {
  name?: string | null         // Tên sản phẩm
  import_price?: string | null // Giá nhập
  quantity?: string | null     // Số lượng
  unit?: string | null         // Đơn vị tính
  lot?: string | null          // Số lô
  mfg_date?: string | null     // NSX
  exp_date?: string | null     // HSD
}

export const COLUMN_FIELDS: { key: keyof ColumnMap; label: string; required?: boolean }[] = [
  { key: 'name', label: 'Tên sản phẩm', required: true },
  { key: 'import_price', label: 'Giá nhập', required: true },
  { key: 'quantity', label: 'Số lượng' },
  { key: 'unit', label: 'Đơn vị tính' },
  { key: 'lot', label: 'Số lô' },
  { key: 'mfg_date', label: 'NSX' },
  { key: 'exp_date', label: 'HSD' },
]

// "A" → 0, "B" → 1, "Z" → 25, "AA" → 26 …
export function colLetterToIndex(letter?: string | null): number {
  if (!letter) return -1
  const s = letter.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(s)) return -1
  let n = 0
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64)
  return n - 1
}

// index → "A","B",… "AA" (để dựng range ghi ngược)
export function colIndexToLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// Lấy giá trị ô theo chữ cột từ 1 dòng giá trị
export function cellAt(row: any[], letter?: string | null): any {
  const idx = colLetterToIndex(letter)
  if (idx < 0 || idx >= (row?.length ?? 0)) return ''
  return row[idx] ?? ''
}

// Chuẩn hóa số: bỏ phân cách nghìn "1.113.000,00" / "1,113,000.00" → number
export function parseSheetNumber(v: any): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[^\d.,-]/g, '')
  if (s === '') return 0
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) {
    // dạng VN: "." nghìn, "," thập phân
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // dạng EN: "," nghìn, "." thập phân
    s = s.replace(/,/g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// Thuế doanh nghiệp: giá nhập mới = giá nhập × (1 + markup_rate × tax_share).
// Mặc định 7% × 50% → ×1,035. Làm tròn về đồng (VND nguyên).
export function computeVatCost(price: number, markupRate = 0.07, taxShare = 0.5): number {
  if (!Number.isFinite(price) || price <= 0) return price
  return Math.round(price * (1 + markupRate * taxShare))
}

// Chuẩn hóa tên SP để khớp bí danh: bỏ dấu + lowercase + gộp khoảng trắng
export function normalizeAlias(name: string): string {
  return removeVietnameseTones(String(name || '').toLowerCase()).replace(/\s+/g, ' ').trim()
}

// ── Ngày tháng NHẤT QUÁN (chống nhầm dd/mm vs mm/dd) ──
// Nguồn vào duy nhất: parseSheetDate → ISO 'YYYY-MM-DD' (DB + nội bộ app).
// Hiển thị: formatDateVN → 'dd/mm/yyyy'.

const pad2 = (n: number) => String(n).padStart(2, '0')

// Số serial Google Sheets (epoch 1899-12-30) → ISO 'YYYY-MM-DD'
function serialToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

// Parse giá trị ô Ngày từ Sheet → ISO 'YYYY-MM-DD' ('' nếu rỗng/không hợp lệ).
// Ưu tiên số serial (không nhập nhằng); fallback yyyy-mm-dd; cuối cùng dd/mm/yyyy (CHUẨN VN).
export function parseSheetDate(v: any): string {
  if (v == null || v === '') return ''
  // Số serial (đọc bằng dateTimeRenderOption=SERIAL_NUMBER)
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v > 0 && v < 100000 ? serialToIso(v) : ''
  }
  const s = String(v).trim()
  if (!s) return ''
  // Số dạng chuỗi → cũng coi là serial
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    return n > 0 && n < 100000 ? serialToIso(n) : ''
  }
  // yyyy-mm-dd (hoặc yyyy/mm/dd)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (m) {
    const [, y, mo, d] = m
    return `${y}-${pad2(+mo)}-${pad2(+d)}`
  }
  // dd/mm/yyyy hoặc dd-mm-yyyy (CHUẨN VN: số đầu = ngày, số giữa = tháng)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = '20' + y
    const dd = +d, mm = +mo
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return ''
    return `${y}-${pad2(mm)}-${pad2(dd)}`
  }
  return ''
}

// ISO 'YYYY-MM-DD' → 'dd/mm/yyyy' để hiển thị thống nhất ('' nếu rỗng).
export function formatDateVN(iso: string): string {
  if (!iso) return ''
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}
