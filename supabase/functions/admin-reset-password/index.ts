// ============================================================
// Edge Function: admin-reset-password
// Cho phép ADMIN đặt lại mật khẩu cho user khác (phòng khi quên MK).
//
// Vì sao phải là Edge Function (không làm ở frontend):
//   - Đổi mật khẩu user khác cần `auth.admin.updateUserById` → BẮT BUỘC service_role.
//   - service_role là khóa toàn quyền, TUYỆT ĐỐI không được lộ ra client.
//
// Bảo mật nhiều lớp:
//   1. verify_jwt (mặc định) → người gọi phải đăng nhập.
//   2. Xác minh người gọi là admin SERVER-SIDE qua RPC `fn_is_admin()` (chạy dưới
//      danh tính user). KHÔNG tin tưởng bất kỳ cờ nào do client gửi lên.
//   3. Validate mật khẩu mới (>= 6 ký tự, khớp cấu hình minimum_password_length).
//   4. Ghi audit_logs bất biến (ai đổi MK của ai, lúc nào).
//
// Body: { target_user_id: string, new_password: string }
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY có sẵn trong runtime.)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MIN_PASSWORD_LENGTH = 6

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Thiếu Authorization.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Client chạy DƯỚI DANH TÍNH user (để xác thực + kiểm quyền admin theo auth.uid()).
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    // Truyền token TƯỜNG MINH: edge runtime stateless, getUser() không tham số sẽ null.
    const accessToken = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userErr } = await userClient.auth.getUser(accessToken)
    if (userErr || !userData?.user) return json({ error: 'Phiên đăng nhập không hợp lệ.' }, 401)
    const callerId = userData.user.id

    // Chỉ ADMIN mới được đặt lại MK người khác (RPC dùng auth.uid() của user).
    const { data: isAdmin, error: adminErr } = await userClient.rpc('fn_is_admin')
    if (adminErr) return json({ error: 'Không kiểm tra được quyền: ' + adminErr.message }, 500)
    if (!isAdmin) return json({ error: 'Chỉ Quản trị viên (admin) mới được đặt lại mật khẩu.' }, 403)

    const body = await req.json().catch(() => ({}))
    const targetUserId: string = body.target_user_id
    const newPassword: string = body.new_password
    if (!targetUserId) return json({ error: 'Thiếu target_user_id.' }, 400)
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.` }, 400)
    }

    // Service client: quyền admin Auth + ghi audit bỏ qua RLS.
    const admin = createClient(supabaseUrl, serviceKey)

    const { error: updErr } = await admin.auth.admin.updateUserById(targetUserId, {
      password: newPassword,
    })
    if (updErr) return json({ error: 'Đặt lại mật khẩu thất bại: ' + updErr.message }, 400)

    // Audit bất biến — KHÔNG ghi mật khẩu, chỉ ghi sự kiện.
    await admin.from('audit_logs').insert({
      user_id: callerId,
      action: 'UPDATE',
      table_name: 'auth.users',
      record_id: targetUserId,
      new_data: { event: 'admin_reset_password' },
    })

    return json({ success: true })
  } catch (err) {
    return json({ error: 'Lỗi máy chủ: ' + (err instanceof Error ? err.message : String(err)) }, 500)
  }
})
