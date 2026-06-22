// Logger helper – chỉ output ở DEV để tránh rò rỉ thông tin runtime ở production.
// Dùng thay cho console.log/info/debug trong source. console.error/warn vẫn giữ
// vì cần thiết khi user gặp lỗi thực tế.

import { supabase, isSupabaseConfigured } from './supabase'

const isDev = (import.meta as any).env?.DEV === true

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console.debug(...args)
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info(...args)
  },
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args)
  },
  warn: (...args: unknown[]) => {
    console.warn(...args)
  },
  error: (...args: unknown[]) => {
    console.error(...args)
  },
  report: (message: string, context?: Record<string, unknown>, level?: ErrorLevel) =>
    reportError(message, context, level),
}

// ─────────────────────────────────────────────────────────────
// Báo lỗi nghiêm trọng về DB (app_error_logs) qua RPC fn_log_client_error.
// • Chỉ chạy khi đã cấu hình Supabase (user đăng nhập → RLS/DEFINER cho ghi).
// • Dedup + throttle: không gửi lại cùng 1 fingerprint trong 60s (tránh spam).
// • Nuốt mọi lỗi — KHÔNG bao giờ throw từ logger.
// ─────────────────────────────────────────────────────────────
type ErrorLevel = 'error' | 'warn' | 'fatal'
const seen = new Map<string, number>()
const DEDUP_MS = 60_000

function fingerprintOf(message: string, context?: Record<string, unknown>): string {
  const src = (context?.source as string) || (context?.code as string) || ''
  return `${src}|${(message || '').slice(0, 120)}`
}

export async function reportError(
  message: string,
  context?: Record<string, unknown>,
  level: ErrorLevel = 'error',
): Promise<void> {
  try {
    if (!isSupabaseConfigured || !message) return
    const fp = fingerprintOf(message, context)
    const now = Date.now()
    const last = seen.get(fp)
    if (last && now - last < DEDUP_MS) return // đã gửi gần đây → bỏ qua
    seen.set(fp, now)
    if (seen.size > 200) seen.clear() // chặn rò rỉ bộ nhớ

    await supabase.rpc('fn_log_client_error', {
      p_level: level,
      p_source: (context?.source as string) || 'fe',
      p_message: message.slice(0, 2000),
      p_context: context ? (context as any) : null,
      p_fingerprint: fp.slice(0, 200),
    })
  } catch {
    // Không làm gì — logger không được phép làm sập app.
  }
}

// Gắn handler toàn cục cho lỗi chưa bắt + promise bị reject. Gọi 1 lần ở main.tsx.
let installed = false
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    void reportError(e.message || 'window.onerror', { source: 'fe', kind: 'onerror' }, 'error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason: any = (e as PromiseRejectionEvent).reason
    const msg = reason?.message || String(reason ?? 'unhandledrejection')
    void reportError(msg, { source: 'fe', kind: 'unhandledrejection' }, 'error')
  })
}

export default logger
