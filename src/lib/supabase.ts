import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '❌ Thiếu biến môi trường Supabase. Kiểm tra file .env.local:\n' +
    '  VITE_SUPABASE_URL\n' +
    '  VITE_SUPABASE_ANON_KEY'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Tự động refresh token trước khi hết hạn
    autoRefreshToken: true,
    // Giữ session sau khi reload trang
    persistSession: true,
    // Detect session từ URL (dùng cho OAuth callback và magic link)
    detectSessionInUrl: true,
    // Storage để lưu session (localStorage mặc định)
    storage: window.localStorage,
  },
  global: {
    headers: {
      'x-application-name': 'crm-sanhlongvetco',
    },
  },
  db: {
    // Schema mặc định
    schema: 'public',
  },
  realtime: {
    // Kết nối realtime cho notifications
    params: {
      eventsPerSecond: 10,
    },
  },
})

// ─────────────────────────────────────────────────────────────
// Helper: Lấy user hiện tại (safe – không throw)
// ─────────────────────────────────────────────────────────────
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) return null
  return user
}

// ─────────────────────────────────────────────────────────────
// Helper: Lấy session hiện tại
// ─────────────────────────────────────────────────────────────
export async function getCurrentSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) return null
  return session
}

export default supabase
