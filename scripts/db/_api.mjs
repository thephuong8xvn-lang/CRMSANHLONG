// Helper gọi Supabase Management API (chạy SQL trên project staging).
// Dùng chung cho sync-staging.mjs và run-tests.mjs.
const API = 'https://api.supabase.com/v1'

export function env(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`❌ Thiếu biến môi trường ${name}`)
    process.exit(1)
  }
  return v
}

/** Chạy 1 chuỗi SQL (có thể nhiều câu lệnh) trên project. Trả mảng rows của câu cuối. */
export async function runSql(ref, token, query) {
  const res = await fetch(`${API}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  if (!res.ok) {
    const msg = typeof json === 'object' ? JSON.stringify(json) : json
    throw new Error(`SQL lỗi ${res.status}: ${msg}`)
  }
  return json
}
