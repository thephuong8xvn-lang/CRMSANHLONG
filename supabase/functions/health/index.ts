// ============================================================
// Edge Function: health
// Endpoint uptime CÔNG KHAI (GET) cho UptimeRobot/cron-job.org ping mỗi 5'.
// Gọi RPC public.fn_health() bằng SERVICE ROLE (chỉ đọc, đếm sống).
// KHÔNG trả dữ liệu nhạy cảm — chỉ status + vài con số tổng.
//
// Trả 200 {status:'ok',...} khi DB phản hồi; 503 khi lỗi → uptime monitor báo down.
// Không cần JWT (đặt verify_jwt=false khi deploy: supabase functions deploy health --no-verify-jwt)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(url, serviceKey)
    const { data, error } = await sb.rpc('fn_health')
    if (error) return json({ status: 'error', error: error.message }, 503)
    return json(data ?? { status: 'ok' }, 200)
  } catch (e) {
    return json({ status: 'error', error: String((e as Error)?.message ?? e) }, 503)
  }
})
