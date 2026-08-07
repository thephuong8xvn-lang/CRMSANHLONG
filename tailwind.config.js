// Đuôi `.js` là BẮT BUỘC: tailwindcss 3.4 không có trường `exports` trong
// package.json, nên Node ở chế độ ESM không tự suy ra được `…/colors`.
import defaultColors from 'tailwindcss/colors.js'

// ──────────────────────────────────────────────────────────────────────
// NỬA BẬC MÀU (150 / 250 / 650 / 750 …)
//
// Cùng một căn bệnh với thang chữ và thang z-index bên dưới: khắp app
// dùng `border-gray-150`, `text-gray-650`, `bg-gray-750/50`… nhưng thang
// màu của Tailwind chỉ có bậc tròn trăm (50/100/200/…/900/950). Class
// không tồn tại thì Tailwind BỎ QUA IM LẶNG — không sinh CSS, không báo
// lỗi, không cảnh báo. Đếm được 473 lượt dùng như vậy.
//
// Hậu quả nặng nhất: `bg-gray-750/50` là lớp phủ tối của hộp thoại ở
// HerdProjectDetailPage (5 chỗ) → hộp thoại hiện ra KHÔNG có nền mờ,
// nội dung trang phía sau đâm xuyên qua.
//
// Cách vá: sinh nửa bậc bằng cách TRỘN hai bậc liền kề đã có. Giá trị
// các bậc gốc giữ nguyên tuyệt đối — `gray-800/900/950` đang dùng 328
// lượt ở 58 file nên không được phép đổi.
//
// Tailwind 3 chạy JIT nên nửa bậc nào không ai dùng thì không sinh CSS,
// định nghĩa thừa không tốn gì.
// ──────────────────────────────────────────────────────────────────────
const toRgb = (h) => {
  const s = h.replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}
const toHex = (arr) =>
  '#' + arr.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
const mix = (a, b) => toHex(toRgb(a).map((v, i) => (v + toRgb(b)[i]) / 2))

/**
 * Trả về bảng màu có đủ nửa bậc.
 * @param base    bảng màu mặc định của Tailwind
 * @param override các bậc do hệ thống thiết kế định nghĩa lại (thắng base)
 */
function withHalfSteps(base, override = {}) {
  const out = { ...base, ...override }
  // Chỉ giữ khoá là số; `DEFAULT` hay tên khác bỏ qua.
  const steps = Object.keys(out)
    .filter((k) => /^\d+$/.test(k))
    .map(Number)
    .sort((a, b) => a - b)

  for (let i = 0; i < steps.length - 1; i++) {
    const lo = steps[i]
    const hi = steps[i + 1]
    if (hi - lo !== 100) continue // chỉ chèn vào giữa hai bậc liền kề chuẩn
    const mid = lo + 50
    if (out[mid] === undefined) out[mid] = mix(out[lo], out[hi])
  }
  // Bậc 25: nhạt hơn 50, trộn với trắng. (`gray-25` vốn đã có sẵn.)
  if (out[50] !== undefined && out[25] === undefined) out[25] = mix('#FFFFFF', out[50])

  return out
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'blue': withHalfSteps(defaultColors.blue, {
          50: '#EEF4FB',
          100: '#D6E4F4',
          200: '#AEC9E9',
          500: '#1E5A9C',
          600: '#194B82',
          700: '#143C69',
        }),
        'gray': withHalfSteps(defaultColors.gray, {
          0: '#FFFFFF',
          25: '#FAFBFC',
          50: '#F4F6F8',
          100: '#E5E9EE',
          200: '#CCD3DB',
          300: '#A8B2BD',
          400: '#6B7785',
          500: '#4A5663',
          600: '#2F3947',
          700: '#1F2731',
        }),
        // Các bảng màu tiêu chuẩn — chỉ thêm nửa bậc, không đổi giá trị gốc.
        'red': withHalfSteps(defaultColors.red),
        'amber': withHalfSteps(defaultColors.amber),
        'emerald': withHalfSteps(defaultColors.emerald),
        'green': withHalfSteps(defaultColors.green),
        'orange': withHalfSteps(defaultColors.orange),
        'rose': withHalfSteps(defaultColors.rose),
        'purple': withHalfSteps(defaultColors.purple),
        'indigo': withHalfSteps(defaultColors.indigo),
        'teal': withHalfSteps(defaultColors.teal),
        'sky': withHalfSteps(defaultColors.sky),
        'slate': withHalfSteps(defaultColors.slate),
        'yellow': withHalfSteps(defaultColors.yellow),
        'success': {
          500: '#2E7D5B',
        },
        'warning': {
          500: '#B8722C',
        },
        'danger': {
          500: '#B23A3A',
        }
      },
      fontFamily: {
        sans: ['Be Vietnam Pro', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // ──────────────────────────────────────────────────────────────
      // Thang chữ (type scale) CHUẨN của hệ thống.
      // Trước đây các class text-tiny/body-*/headline-*/display-* được
      // DÙNG KHẮP app (~2.5k lần) nhưng KHÔNG hề được định nghĩa ở đâu →
      // Tailwind v3 bỏ qua → mọi chữ rơi về cỡ kế thừa mặc định ~16px
      // (chật, to, đè chữ). Định nghĩa tại đây để hiện thực đúng thiết kế.
      // `extend.fontSize` MERGE với mặc định Tailwind → text-sm/base/lg…
      // tiêu chuẩn vẫn hoạt động bình thường.
      // Cú pháp: ['<size>', { lineHeight, letterSpacing? }].
      fontSize: {
        'tiny': ['11px', { lineHeight: '15px' }],          // nhãn phụ, caption, SKU, badge
        'body-sm': ['12px', { lineHeight: '16px' }],        // chú thích, meta phụ
        'label-md': ['13px', { lineHeight: '18px', letterSpacing: '0.005em' }], // nhãn form/bảng
        'body-md': ['14px', { lineHeight: '20px' }],        // CHỮ THÂN cơ bản (workhorse)
        'body-lg': ['16px', { lineHeight: '24px' }],        // nhấn mạnh / tiêu đề nhỏ
        'headline-sm': ['18px', { lineHeight: '26px' }],
        'headline-md': ['20px', { lineHeight: '28px' }],
        'headline-lg': ['24px', { lineHeight: '30px' }],
        'display-xs': ['28px', { lineHeight: '34px' }],
        'display-sm': ['32px', { lineHeight: '38px' }],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        DEFAULT: '8px',
        lg: '10px',
        xl: '14px',
        '2xl': '20px',
      },
      // Thang z-index. Thang MẶC ĐỊNH của Tailwind chỉ có 0/10/20/30/40/50 —
      // `z-45`, `z-46`, `z-55` KHÔNG tồn tại nên trước đây là class RỖNG.
      // Hậu quả: 17 hộp thoại đang dùng `z-55` thực chất nhận `z-index: auto`
      // và bị thanh điều hướng `z-40` (sticky) ĐÈ LÊN — hộp thoại sửa hồ sơ
      // khách hàng hiện ra nhưng bị thanh menu phủ mất phần trên.
      // Cùng loại lỗi với thang chữ ở trên: class được dùng khắp nơi mà chưa
      // bao giờ được định nghĩa.
      zIndex: {
        '45': '45',   // thanh điều hướng đáy trên mobile
        '46': '46',   // nút tròn nổi giữa thanh đáy
        '55': '55',   // HỘP THOẠI — phải cao hơn z-50 của lớp phủ menu bên
      },
    },
  },
  plugins: [],
}
