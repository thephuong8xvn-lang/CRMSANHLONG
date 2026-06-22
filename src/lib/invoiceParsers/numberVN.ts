// Parser số theo định dạng hóa đơn VN (bản thể hiện HTML/PDF):
// dấu '.' = phân cách nghìn, ',' = thập phân. VD "2.250.000" → 2250000; "45.000,5" → 45000.5
export function parseVnNumber(v: any): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[^\d.,-]/g, '')
  if (!s) return 0
  s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// Sửa mojibake UTF-8 bị giải mã nhầm Latin-1 (vd "TÃªn" → "Tên").
// Chỉ chạy khi phát hiện dấu hiệu mojibake (mọi ký tự đều ở dải <256).
export function fixMojibake(s: string): string {
  if (!s || !/Ã.|á»|áº|Æ°|Ä‘|á»‹/.test(s)) return s
  try {
    const bytes = Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0) & 0xff))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return s
  }
}
