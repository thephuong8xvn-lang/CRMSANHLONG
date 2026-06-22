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

// Đảm bảo search_path mặc định của staging gồm extensions (pgtap) + tap (áp dụng
// cho các request/session sau). Idempotent.
await runSql(ref, token, 'alter database postgres set search_path = public, extensions, tap;')
// pgtap phải có sẵn (cài 1 lần). Idempotent.
await runSql(ref, token, 'create extension if not exists pgtap with schema extensions;')

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

// Nạp TỪNG file một (mỗi request là 1 transaction riêng + commit). Gộp tất cả
// vào 1 request lớn từng bị Management API rollback toàn bộ (trả 201 nhưng không
// persist) → tách ra để chắc chắn.
for (const f of files) {
  process.stdout.write(`Nạp ${f} ... `)
  await runSql(ref, token, await readFile(join(dir, f), 'utf8'))
  console.log('OK')
}

console.log('\nChạy runtests() ...\n')
const rows = await runSql(
  ref,
  token,
  "set search_path = tap, public, extensions; select * from extensions.runtests('tap'::name);",
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
