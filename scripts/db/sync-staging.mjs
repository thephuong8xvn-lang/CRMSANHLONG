// Áp dụng toàn bộ supabase/migrations/*.sql lên project STAGING (theo thứ tự tên).
// Mục đích: staging có schema giống prod để chạy test pgTAP cô lập.
//
// Chạy:
//   STAGING_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<sbp_...> node scripts/db/sync-staging.mjs
//
// Lưu ý: chạy trên project RỖNG (mới tạo) để migrations chạy sạch theo thứ tự.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env, runSql } from './_api.mjs'

const ref = env('STAGING_PROJECT_REF')
const token = env('SUPABASE_ACCESS_TOKEN')
const dir = 'supabase/migrations'

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
console.log(`Áp dụng ${files.length} migration lên staging ${ref} ...\n`)

for (const f of files) {
  const sql = await readFile(join(dir, f), 'utf8')
  process.stdout.write(`  ${f} ... `)
  try {
    await runSql(ref, token, sql)
    console.log('OK')
  } catch (e) {
    console.log('LỖI')
    console.error('\n' + e.message)
    process.exit(1)
  }
}
console.log('\n✅ Đồng bộ schema staging xong.')
