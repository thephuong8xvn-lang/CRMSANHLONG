/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'blue': {
          50: '#EEF4FB',
          100: '#D6E4F4',
          200: '#AEC9E9',
          500: '#1E5A9C',
          600: '#194B82',
          700: '#143C69',
        },
        'gray': {
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
        },
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
      }
    },
  },
  plugins: [],
}
