// Chạy 1 file SQL bất kỳ lên project chỉ định, in kết quả câu lệnh cuối.
// Khác apply-file.mjs: KHÔNG chốt cứng phần verify của migration giám sát
// (20260722) nên dùng được cho mọi migration.
//
//   PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<sbp_...> node scripts/db/run-sql.mjs <path.sql>
import { readFile } from 'node:fs/promises'
import { env, runSql } from './_api.mjs'

const ref = env('PROJECT_REF')
const token = env('SUPABASE_ACCESS_TOKEN')
const file = process.argv[2]
if (!file) { console.error('❌ Thiếu đường dẫn file SQL'); process.exit(1) }

const sql = await readFile(file, 'utf8')
console.log(`Chạy ${file} → project ${ref} ...`)
const rows = await runSql(ref, token, sql)
console.log('✅ Xong.')
if (Array.isArray(rows) && rows.length > 0) {
  console.log(JSON.stringify(rows, null, 2))
}
