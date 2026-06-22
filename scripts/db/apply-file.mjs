// Apply 1 file SQL lên project chỉ định + verify persistence.
//   PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<sbp_...> node scripts/db/apply-file.mjs <path.sql>
import { readFile } from 'node:fs/promises'
import { env, runSql } from './_api.mjs'

const ref = env('PROJECT_REF')
const token = env('SUPABASE_ACCESS_TOKEN')
const file = process.argv[2]
if (!file) { console.error('❌ Thiếu đường dẫn file SQL'); process.exit(1) }

const sql = await readFile(file, 'utf8')
console.log(`Apply ${file} → project ${ref} ...`)
await runSql(ref, token, sql)
console.log('Đã gửi. Verify objects ...')

const checks = await runSql(ref, token, `
  select
    (select count(*) from pg_extension where extname in ('pg_cron','pg_net')) as ext,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('fn_health','fn_integrity_check','fn_send_telegram','fn_monitor_tick','fn_log_client_error')) as fns,
    (select count(*) from pg_tables where schemaname='public' and tablename in ('monitor_runs','app_error_logs')) as tbls,
    (select count(*) from cron.job where jobname='monitor-integrity-daily') as cron;`)
console.log('Verify:', JSON.stringify(checks[0]))
const c = checks[0]
if (Number(c.ext) < 2 || Number(c.fns) < 5 || Number(c.tbls) < 2 || Number(c.cron) < 1) {
  console.error('❌ Persistence KHÔNG đủ — có thể bị rollback thầm lặng.'); process.exit(1)
}
console.log('✅ Persistence OK')
