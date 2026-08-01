// ============================================================
// Edge Function: admin-users
// Mọi thao tác quản trị tài khoản nhân viên, gộp một chỗ để chỉ phải deploy
// MỘT LẦN: create | reset_password | update_email | set_active
//
// Vì sao phải là Edge Function (không làm ở frontend):
//   - Các API `auth.admin.*` BẮT BUỘC service_role — khóa toàn quyền, tuyệt
//     đối không được lộ ra client.
//   - Cách cũ (frontend gọi `auth.signUp` bằng anon key) buộc project phải bật
//     tự đăng ký công khai → ai cũng tạo được tài khoản. Và vì project để
//     "bắt buộc xác nhận email" + không có SMTP riêng (giới hạn 2 thư/giờ),
//     nhân viên mới KHÔNG đăng nhập được. Dùng `createUser({ email_confirm:
//     true })` bỏ hẳn khâu thư xác nhận.
//
// Bảo mật nhiều lớp (giữ nguyên khuôn mẫu admin-reset-password):
//   1. verify_jwt → người gọi phải đăng nhập.
//   2. Kiểm admin SERVER-SIDE qua RPC `fn_is_admin()` — không tin cờ client gửi.
//   3. Validate đầu vào.
//   4. Ghi audit_logs bất biến (service client, vì audit_logs không có policy INSERT).
//
// Body: { action, ... } — xem từng nhánh bên dưới.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MIN_PASSWORD_LENGTH = 6
// Khoá "vĩnh viễn": GoTrue nhận chuỗi thời lượng. 100 năm ~ khoá cho tới khi mở lại.
const BAN_FOREVER = '876000h'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const isEmail = (s: unknown): s is string =>
  typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Thiếu Authorization.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    // Edge runtime stateless → phải truyền token tường minh.
    const accessToken = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userErr } = await userClient.auth.getUser(accessToken)
    if (userErr || !userData?.user) return json({ error: 'Phiên đăng nhập không hợp lệ.' }, 401)
    const callerId = userData.user.id

    const { data: isAdmin, error: adminErr } = await userClient.rpc('fn_is_admin')
    if (adminErr) return json({ error: 'Không kiểm tra được quyền: ' + adminErr.message }, 500)
    if (!isAdmin) return json({ error: 'Chỉ Quản trị viên (admin) mới được thao tác tài khoản nhân viên.' }, 403)

    const body = await req.json().catch(() => ({}))
    const action: string = body.action
    const admin = createClient(supabaseUrl, serviceKey)

    const audit = (targetId: string | null, event: string, extra: Record<string, unknown> = {}) =>
      admin.from('audit_logs').insert({
        user_id: callerId,
        action: 'UPDATE',
        table_name: 'auth.users',
        record_id: targetId,
        new_data: { event, ...extra },   // KHÔNG bao giờ ghi mật khẩu
      })

    // ── TẠO NHÂN VIÊN ──────────────────────────────────────────
    // email_confirm: true → bỏ hẳn khâu bấm link trong thư. Đây chính là thứ
    // làm luồng cũ chết: project bắt buộc xác nhận mà thư lại không tới nơi.
    if (action === 'create') {
      const { email, password, full_name, employee_code, phone, job_title,
              branch_id, team_id, role_ids } = body

      if (!isEmail(email)) return json({ error: 'Email không hợp lệ.' }, 400)
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return json({ error: `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.` }, 400)
      }
      if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
        return json({ error: 'Thiếu họ tên nhân viên.' }, 400)
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name.trim() },
      })
      if (createErr) {
        const dup = /already|exists|registered/i.test(createErr.message)
        return json({ error: dup ? 'Email này đã có tài khoản.' : 'Tạo tài khoản thất bại: ' + createErr.message }, 400)
      }
      const newId = created.user!.id

      // Trigger fn_handle_new_user đã tạo dòng profiles. Bổ sung phần còn lại.
      // Hỏng ở bước này → xoá luôn auth user để không để lại tài khoản mồ côi
      // (lỗi hay gặp nhất: employee_code trùng, cột này UNIQUE).
      const { error: profErr } = await admin.from('profiles').update({
        full_name: full_name.trim(),
        employee_code: employee_code || null,
        phone: phone || null,
        job_title: job_title || null,
        branch_id: branch_id || null,
        team_id: team_id || null,
      }).eq('id', newId)

      if (profErr) {
        await admin.auth.admin.deleteUser(newId)
        const dup = profErr.code === '23505'
        return json({ error: dup ? 'Mã nhân viên đã được dùng cho người khác.' : 'Lưu hồ sơ thất bại: ' + profErr.message }, 400)
      }

      if (Array.isArray(role_ids)) {
        // Gọi bằng userClient chứ KHÔNG phải service client: fn_set_user_roles
        // kiểm quyền qua fn_is_admin() → auth.uid(), mà service role có
        // auth.uid() = NULL nên sẽ bị chính nó từ chối.
        const { error: roleErr } = await userClient.rpc('fn_set_user_roles', {
          p_user_id: newId, p_role_ids: role_ids,
        })
        if (roleErr) {
          await admin.auth.admin.deleteUser(newId)
          return json({ error: 'Gán vai trò thất bại: ' + roleErr.message }, 400)
        }
      }

      await audit(newId, 'admin_create_user', { email })
      return json({ success: true, user_id: newId })
    }

    // ── ĐẶT LẠI MẬT KHẨU ───────────────────────────────────────
    if (action === 'reset_password') {
      const { target_user_id, new_password } = body
      if (!target_user_id) return json({ error: 'Thiếu target_user_id.' }, 400)
      if (typeof new_password !== 'string' || new_password.length < MIN_PASSWORD_LENGTH) {
        return json({ error: `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.` }, 400)
      }

      const { error } = await admin.auth.admin.updateUserById(target_user_id, { password: new_password })
      if (error) return json({ error: 'Đặt lại mật khẩu thất bại: ' + error.message }, 400)

      // Thu hồi phiên cũ — đổi mật khẩu mà phiên đã đánh cắp vẫn sống thì vô nghĩa.
      await admin.auth.admin.signOut(target_user_id, 'global').catch(() => {})

      await audit(target_user_id, 'admin_reset_password')
      return json({ success: true })
    }

    // ── ĐỔI EMAIL ──────────────────────────────────────────────
    if (action === 'update_email') {
      const { target_user_id, new_email } = body
      if (!target_user_id) return json({ error: 'Thiếu target_user_id.' }, 400)
      if (!isEmail(new_email)) return json({ error: 'Email mới không hợp lệ.' }, 400)

      // email_confirm: true → đổi xong dùng được ngay, không chờ thư xác nhận.
      const { error } = await admin.auth.admin.updateUserById(target_user_id, {
        email: new_email, email_confirm: true,
      })
      if (error) {
        const dup = /already|exists|registered/i.test(error.message)
        return json({ error: dup ? 'Email này đã thuộc về tài khoản khác.' : 'Đổi email thất bại: ' + error.message }, 400)
      }

      // Đồng bộ profiles.email — nếu lệch, các chỗ tra cứu theo email sẽ sai.
      const { error: pErr } = await admin.from('profiles').update({ email: new_email }).eq('id', target_user_id)
      if (pErr) return json({ error: 'Đã đổi email đăng nhập nhưng chưa đồng bộ hồ sơ: ' + pErr.message }, 500)

      await audit(target_user_id, 'admin_update_email', { new_email })
      return json({ success: true })
    }

    // ── KHOÁ / MỞ KHOÁ ─────────────────────────────────────────
    // Khoá ở CẢ hai tầng: auth (không đăng nhập được) và profiles.is_active (RLS
    // chặn dữ liệu). Trước đây chỉ có tầng sau nên người bị khoá vẫn đăng nhập.
    if (action === 'set_active') {
      const { target_user_id, is_active } = body
      if (!target_user_id) return json({ error: 'Thiếu target_user_id.' }, 400)
      if (typeof is_active !== 'boolean') return json({ error: 'Thiếu is_active.' }, 400)

      if (target_user_id === callerId && !is_active) {
        return json({ error: 'Không thể tự khoá tài khoản của chính mình.' }, 400)
      }

      const { error } = await admin.auth.admin.updateUserById(target_user_id, {
        ban_duration: is_active ? 'none' : BAN_FOREVER,
      })
      if (error) return json({ error: 'Cập nhật trạng thái đăng nhập thất bại: ' + error.message }, 400)

      if (!is_active) {
        // Đẩy người đang mở app ra ngay, không đợi token hết hạn.
        await admin.auth.admin.signOut(target_user_id, 'global').catch(() => {})
      }

      const { error: pErr } = await admin.from('profiles').update({ is_active }).eq('id', target_user_id)
      if (pErr) return json({ error: 'Đã đổi trạng thái đăng nhập nhưng chưa đồng bộ hồ sơ: ' + pErr.message }, 500)

      await audit(target_user_id, is_active ? 'admin_activate_user' : 'admin_deactivate_user')
      return json({ success: true })
    }

    return json({ error: 'action không hợp lệ.' }, 400)
  } catch (err) {
    return json({ error: 'Lỗi máy chủ: ' + (err instanceof Error ? err.message : String(err)) }, 500)
  }
})
