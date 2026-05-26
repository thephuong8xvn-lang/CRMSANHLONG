import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/hooks/**', 'src/lib/**'],
      exclude: ['src/lib/supabase.ts'],
      thresholds: { lines: 60, functions: 60 },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'pwa-192.svg', 'pwa-512.svg'],
      manifest: {
        name: 'Sanh Long Vetco CRM',
        short_name: 'SanhLong',
        description: 'Phần mềm quản lý thú y Sanh Long Vetco',
        theme_color: '#1E5A9C',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'pwa-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('supabase.co') && url.pathname.includes('/rest/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('supabase.co') && url.pathname.includes('/storage/v1/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage',
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
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
