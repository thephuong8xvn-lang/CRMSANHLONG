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
