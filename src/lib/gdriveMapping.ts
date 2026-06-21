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

// Chuẩn hóa tên SP để khớp bí danh: bỏ dấu + lowercase + gộp khoảng trắng
export function normalizeAlias(name: string): string {
  return removeVietnameseTones(String(name || '').toLowerCase()).replace(/\s+/g, ' ').trim()
}
