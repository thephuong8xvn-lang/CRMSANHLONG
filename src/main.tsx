import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import '@fontsource/be-vietnam-pro/latin-400.css'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/latin-500.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/latin-600.css'
import '@fontsource/be-vietnam-pro/600.css'
import './index.css'
import App from './App.tsx'
import { reportWebVitals } from './lib/reportWebVitals'
import { installGlobalErrorReporting } from './lib/logger'

// Báo lỗi runtime nghiêm trọng (uncaught/unhandledrejection) về app_error_logs.
installGlobalErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)

reportWebVitals()
