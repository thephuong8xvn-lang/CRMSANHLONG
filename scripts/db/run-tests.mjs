// Chạy bộ test pgTAP trên project STAGING.
// 1) Nạp bootstrap + fixtures + test functions (supabase/tests/*.sql, theo tên).
// 2) Gọi runtests('tap') → in TAP, exit 1 nếu có test đỏ.
//
// Chạy:
//   STAGING_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<sbp_...> node scripts/db/run-tests.mjs
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env, runSql } from './_api.mjs'

const ref = env('STAGING_PROJECT_REF')
const token = env('SUPABASE_ACCESS_TOKEN')
const dir = 'supabase/tests'

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
let ddl = ''
for (const f of files) ddl += `\n-- ===== ${f} =====\n` + (await readFile(join(dir, f), 'utf8')) + '\n'

console.log('Nạp bootstrap + fixtures + test functions ...')
await runSql(ref, token, ddl)

console.log('Chạy runtests() ...\n')
const rows = await runSql(
  ref,
  token,
  "set search_path = tap, public, extensions; select * from runtests('tap'::name);",
)

let fail = 0
for (const r of rows) {
  const line = Object.values(r)[0]
  console.log(line)
  if (/^not ok/.test(String(line))) fail++
}

if (fail > 0) {
  console.error(`\n❌ ${fail} test THẤT BẠI`)
  process.exit(1)
}
console.log('\n✅ Tất cả test PASS')
