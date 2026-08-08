/** Kiểu dùng chung cho module Tương tác khách hàng. */

export interface Post {
  id: string
  title: string
  body: string
  kind: string
  link_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface PostImage {
  id: string
  post_id: string
  url: string
  /** Mã ảnh Telegram trả về sau lần gửi đầu. Có mã này thì không tải lại ảnh nữa. */
  tg_file_id: string | null
  sort_order: number
}

/** Một khách trong bản xem trước danh sách nhận. */
export interface Recipient {
  id: string
  ten: string
  ma: string
  ly_do?: string
}

/** Kết quả RPC `fn_post_broadcast` — dùng chung cho cả ba chế độ. */
export interface PostPreview {
  ok: boolean
  loi?: string
  che_do?: string
  noi_dung?: string
  anh?: string | string[] | null
  so_anh?: number
  so_ky_tu?: number
  gioi_han_ky_tu?: number
  qua_dai?: boolean
  so_nhom_nhan?: number
  so_nhom_bo_qua?: number
  da_xep_hang?: number
  danh_sach?: Recipient[]
  danh_sach_bo_qua?: Recipient[]
  ly_do_bo_qua?: { ly_do: string; so_khach: number }[]
}

export const POST_KINDS: { value: string; label: string; icon: string; hint: string }[] = [
  { value: 'khuyen_mai',   label: 'Khuyến mãi',  icon: '🎁',
    hint: 'Tôn trọng nút từ chối nhận khuyến mãi của khách.' },
  { value: 'dich_te',      label: 'Dịch tễ',     icon: '⚠️',
    hint: 'Cảnh báo dịch bệnh — gửi cho cả khách đã tắt nhận khuyến mãi, vì đây là thông tin họ cần biết.' },
  { value: 'chuyen_nganh', label: 'Chuyên ngành', icon: '📖',
    hint: 'Kiến thức chăn nuôi, hướng dẫn dùng thuốc, kỹ thuật.' },
  { value: 'thong_bao',    label: 'Thông báo',   icon: '📣',
    hint: 'Lịch nghỉ, đổi số điện thoại, thông tin chung của cửa hàng.' },
]

export const kindMeta = (k: string) =>
  POST_KINDS.find(x => x.value === k) ?? POST_KINDS[3]

export const KIND_COLORS: Record<string, string> = {
  khuyen_mai:   'bg-amber-50 text-amber-700 border-amber-100',
  dich_te:      'bg-red-50 text-red-700 border-red-100',
  chuyen_nganh: 'bg-blue-50 text-blue-700 border-blue-100',
  thong_bao:    'bg-gray-50 text-gray-600 border-gray-200',
}
