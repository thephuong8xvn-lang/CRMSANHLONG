// Chuẩn hóa số điện thoại để TÌM KIẾM / đối chiếu TRÙNG.
// PHẢI khớp với hàm SQL public.fn_normalize_phone (migration 20260726000000)
// và helper hiển thị primaryPhone() (src/contexts/DisplaySettingsContext.tsx),
// để client lọc trùng kết quả mà DB index trgm tìm được.
//   • Cắt phần định danh bị ghép (cccd/cmnd/c/c/căn cước).
//   • Lấy token đầu theo dấu phân tách phổ biến.
//   • Chỉ giữ chữ số, chuẩn hóa tiền tố +84/84 → 0.
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ''
  // Cắt phần định danh bị ghép (giữ phần TRƯỚC cccd/cmnd/c/c/căn cước)
  let v = raw.split(/cccd|cmnd|c\/c|căn cước/i)[0]
  // Lấy token đầu theo dấu phẩy, chấm phẩy, gạch chéo, gạch đứng, xuống dòng, ≥2 khoảng trắng
  v = v.split(/[,;/|\n]|\s{2,}/)[0]
  // Chỉ giữ chữ số
  v = v.replace(/\D/g, '')
  // Chuẩn hóa +84 / 84 → 0 (dạng quốc tế SĐT VN: 84 + 9 chữ số = 11 chữ số)
  if (v.length === 11 && v.startsWith('84')) v = '0' + v.slice(2)
  return v
}
