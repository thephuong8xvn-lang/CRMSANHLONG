// ─────────────────────────────────────────────────────────────
// posDraftStorage — bền hóa nháp đơn POS qua localStorage
// Dùng chung cho POSPage (đa hóa đơn) & MobileOrderPage (1 nháp).
//
// Vì sao: toàn bộ dữ liệu đang soạn trên /pos sống trong React state →
// F5 / đóng tab / mất điện làm mất sạch. Lưu xuống localStorage theo từng
// nhân viên (key kèm profile.id) để khôi phục, đồng thời tránh ca sau thấy
// nháp (kèm khách + giá) của ca trước trên máy quầy dùng chung.
// ─────────────────────────────────────────────────────────────

// Nháp tự hết hạn sau 7 ngày — tránh khôi phục hóa đơn quá cũ với giá lỗi thời.
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SCHEMA_VERSION = 1

interface DraftEnvelope<T> {
  v: number
  savedAt: number
  data: T
}

/** Khóa lưu nháp đa hóa đơn của POS desktop, theo nhân viên. */
export const posTabsKey = (userId: string) => `pos-draft-tabs:${userId}`

/** Khóa lưu nháp đơn của màn hình bán hàng mobile, theo nhân viên. */
export const posMobileKey = (userId: string) => `pos-draft-mobile:${userId}`

/** Khóa lưu nháp form Phiếu nhập kho (tạo mới), theo nhân viên. */
export const goodsReceiptDraftKey = (userId: string) => `inv-draft-receipt:${userId}`

/** Khóa lưu nháp modal Chuyển kho, theo nhân viên. */
export const stockTransferDraftKey = (userId: string) => `inv-draft-transfer:${userId}`

/** Khóa lưu nháp modal Trả hàng NCC, theo nhân viên. */
export const purchaseReturnDraftKey = (userId: string) => `inv-draft-return:${userId}`

/**
 * Đọc nháp đã lưu. Trả null nếu không có / hỏng / quá hạn TTL.
 * `validate` (tùy chọn) để loại dữ liệu sai cấu trúc (vd: tabs rỗng).
 */
export function loadDraft<T>(key: string, validate?: (data: T) => boolean): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftEnvelope<T>
    if (!parsed || parsed.v !== SCHEMA_VERSION || typeof parsed.savedAt !== 'number') {
      localStorage.removeItem(key)
      return null
    }
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(key)
      return null
    }
    if (validate && !validate(parsed.data)) {
      return null
    }
    return parsed.data
  } catch {
    // JSON hỏng / localStorage không khả dụng → coi như không có nháp.
    return null
  }
}

/** Ghi nháp. Bọc try/catch chống lỗi quota (giỏ nhiều, dữ liệu lớn). */
export function saveDraft<T>(key: string, data: T): void {
  try {
    const envelope: DraftEnvelope<T> = { v: SCHEMA_VERSION, savedAt: Date.now(), data }
    localStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    // Quota vượt hoặc localStorage bị chặn → bỏ qua, không làm gãy thao tác bán.
  }
}

/** Xóa nháp (sau khi bán xong / mọi hóa đơn đã trống). */
export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* noop */
  }
}
