import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Sprint P0-1 (2026-05-26):
//   • manualChunks tách vendor nặng để giảm main chunk ban đầu
//   • esbuild minify + es2020 target
//   • bỏ source map ở production, bỏ reportCompressedSize cho build nhanh
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Note: thứ tự if quan trọng. Để các "leaf" chunk (PDF/charts/dnd/icons)
        // match trước thì các lib core (react/router) match sau gộp vào react-vendor
        // → tránh circular giữa vendor và react-vendor khi 1 lib chung được hai
        // chunk cùng import.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@react-pdf')) return 'pdf'
          if (id.includes('recharts') || id.includes('/d3-')) return 'charts'
          if (id.includes('@dnd-kit')) return 'dnd'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('papaparse')) return 'forms'
          if (id.includes('react-hook-form')) return 'forms'
          // Gom react/react-dom/react-router-dom/scheduler và mọi util chung
          // (clsx, tailwind-merge, date-fns, zustand, zod, ...) vào react-vendor
          // để không bị circular dep với chunk "vendor" sót lại.
          return 'react-vendor'
        },
      },
    },
  },
  esbuild: {
    // Loại console.* và debugger ở production để giảm noise + size
    drop: ['debugger'],
    pure: ['console.log', 'console.debug', 'console.info'],
  },
})
