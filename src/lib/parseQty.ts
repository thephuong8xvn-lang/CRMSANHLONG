// Helper xử lý số lượng hàng hóa hỗ trợ thập phân (NUMERIC(15,3) ở DB).
// Người dùng VN có thể gõ cả dấu phẩy "18,5" lẫn dấu chấm "18.5".

// Số chữ số thập phân tối đa, khớp scale của cột quantity trên DB (numeric(15,3)).
export const QTY_DECIMALS = 3

/**
 * Làm tròn về tối đa QTY_DECIMALS chữ số thập phân (tránh sai số float
 * và rounding ngầm khi DB cắt còn 3 chữ số).
 */
export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** QTY_DECIMALS
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/**
 * Parse chuỗi người dùng nhập thành số lượng hợp lệ.
 * - Chấp nhận dấu phẩy hoặc dấu chấm làm dấu thập phân.
 * - Bỏ khoảng trắng và ký tự không phải số/dấu.
 * - Clamp về [min, max] (mặc định min = 0, không âm).
 * - Làm tròn 3 chữ số thập phân.
 * Chuỗi rỗng / không hợp lệ trả về `fallback` (mặc định 0).
 */
export function parseQtyInput(
  raw: string,
  opts: { min?: number; max?: number; fallback?: number } = {}
): number {
  const { min = 0, max, fallback = 0 } = opts

  if (raw == null) return fallback
  // Chuẩn hóa: dấu phẩy -> chấm, giữ lại chữ số, dấu chấm và dấu trừ đầu.
  const normalized = String(raw)
    .replace(/,/g, '.')
    .replace(/[^0-9.\-]/g, '')

  if (normalized === '' || normalized === '.' || normalized === '-') return fallback

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed)) return fallback

  let result = roundQty(parsed)
  if (result < min) result = min
  if (max != null && result > max) result = max
  return result
}

/**
 * Định dạng số lượng để hiển thị: dùng locale vi-VN (dấu phẩy thập phân),
 * bỏ số 0 thừa ở phần thập phân (18,5 thay vì 18,500).
 */
export function formatQty(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('vi-VN', { maximumFractionDigits: QTY_DECIMALS })
}
