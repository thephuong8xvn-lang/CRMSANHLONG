# 04 – LUỒNG XÁC THỰC (AUTH FLOW)
## CRM SANHLONGVETCO – Supabase Auth Technical Design

**Phiên bản:** 1.0  
**Cập nhật:** 2026-05-22  
**Công nghệ:** Supabase Auth (GoTrue) + PostgreSQL Triggers

---

## 1. TỔNG QUAN KIẾN TRÚC

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Vite + React)                        │
│   Login Form │ Google OAuth Button │ Forgot Password │ Reset Form    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Supabase JS Client v2
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SUPABASE AUTH (GoTrue Server)                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Email+Password  │  │  Google OAuth2   │  │  Password Reset  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                           │ AFTER INSERT                             │
│                           ▼                                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              auth.users (GoTrue internal table)                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│           │ Trigger: trg_on_auth_user_created                       │
└───────────┼─────────────────────────────────────────────────────────┘
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       PUBLIC SCHEMA (PostgreSQL)                      │
│  public.profiles  →  public.user_roles  →  public.roles             │
└─────────────────────────────────────────────────────────────────────┘
```

### Luồng Token
- Sau khi xác thực thành công, GoTrue trả về **JWT Access Token** (1 giờ) và **Refresh Token** (7 ngày).
- Client lưu token trong `localStorage` (Supabase JS Client tự xử lý).
- Mọi API request đính kèm header `Authorization: Bearer <access_token>`.
- PostgreSQL RLS dùng `auth.uid()` để lấy ID user từ JWT payload.

---

## 2. LUỒNG ĐĂNG KÝ BẰNG EMAIL + MẬT KHẨU

### Bước 1 – Client gọi signUp
```javascript
const { data, error } = await supabase.auth.signUp({
  email: 'nhân viên@sanhlongvetco.vn',
  password: 'mậtKhẩuBảoMật123',
  options: {
    data: {
      full_name: 'Nguyễn Văn An',      // lưu vào raw_user_meta_data
    },
    emailRedirectTo: `${window.location.origin}/auth/callback`,
  }
});
```

### Bước 2 – GoTrue xử lý
1. Kiểm tra email chưa tồn tại trong `auth.users`.
2. Hash mật khẩu bằng bcrypt.
3. Ghi bản ghi vào `auth.users` với `email_confirmed_at = NULL`.
4. Gửi email xác nhận chứa magic link đến hộp thư.
5. **Kích hoạt trigger** `trg_on_auth_user_created` → gọi `fn_handle_new_user()`.

### Bước 3 – Trigger fn_handle_new_user() thực thi
```sql
-- Pseudo-code của trigger
INSERT INTO public.profiles (id, email, full_name, avatar_url, is_active)
VALUES (NEW.id, NEW.email, 'Nguyễn Văn An', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Gán role mặc định 'sales' vào bảng user_roles
INSERT INTO public.user_roles (user_id, role_id)
SELECT NEW.id, r.id FROM public.roles r WHERE r.code = 'sales'
ON CONFLICT DO NOTHING;
```

### Bước 4 – Trạng thái sau đăng ký
- Profile được tạo với `is_active = true`.
- User CHƯA thể đăng nhập cho đến khi xác nhận email (nếu bật `confirm_email` trong Supabase Dashboard).
- Admin có thể bật/tắt yêu cầu xác nhận email tại: `Auth → Settings → Email confirmations`.

---

## 3. LUỒNG XÁC NHẬN EMAIL

### Bước 1 – User click link trong email
```
https://<supabase-url>/auth/v1/verify?token=<otp>&type=email&redirect_to=<redirect_url>
```

### Bước 2 – GoTrue xác thực OTP token
1. Kiểm tra token còn hạn (mặc định 24 giờ, cấu hình `OTP_EXP`).
2. Cập nhật `auth.users.email_confirmed_at = now()`.
3. Tự động đăng nhập và trả về JWT.
4. Chuyển hướng đến `redirect_to` (ví dụ: `/dashboard`).

### Bước 3 – Client xử lý callback
```javascript
// Trong trang /auth/callback
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN') {
    // Chuyển hướng về dashboard
    navigate('/dashboard');
  }
});
```

---

## 4. LUỒNG ĐĂNG NHẬP BẰNG EMAIL + MẬT KHẨU

### Client gọi signInWithPassword
```javascript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'nhân viên@sanhlongvetco.vn',
  password: 'mậtKhẩuBảoMật123',
});
```

### GoTrue xử lý
1. Tìm user trong `auth.users` theo email.
2. So khớp mật khẩu đã hash.
3. Kiểm tra `email_confirmed_at IS NOT NULL` (nếu bật xác nhận email).
4. Trả về JWT access token + refresh token.

### Middleware kiểm tra is_active
```javascript
// Sau khi nhận session, client kiểm tra profile
const { data: profile } = await supabase
  .from('profiles')
  .select('is_active, full_name')
  .eq('id', session.user.id)
  .single();

if (!profile.is_active) {
  await supabase.auth.signOut();
  // Hiển thị thông báo: "Tài khoản đã bị vô hiệu hóa. Liên hệ Admin."
}
```

### Các mã lỗi phổ biến
| Lỗi | Nguyên nhân | Xử lý UI |
|-----|-------------|-----------|
| `Invalid login credentials` | Sai email hoặc mật khẩu | "Email hoặc mật khẩu không đúng" |
| `Email not confirmed` | Chưa xác nhận email | "Vui lòng kiểm tra hộp thư để xác nhận" + nút "Gửi lại email" |
| `Too many requests` | Đăng nhập sai quá nhiều lần | "Vui lòng thử lại sau X giây" |

---

## 5. LUỒNG ĐĂNG NHẬP BẰNG GOOGLE OAUTH

### Bước 1 – Client khởi tạo OAuth flow
```javascript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: `${window.location.origin}/auth/callback`,
    queryParams: {
      access_type: 'offline',
      prompt: 'consent',  // Luôn hiển thị màn hình chọn tài khoản Google
    },
  }
});
```

### Bước 2 – Người dùng chọn tài khoản Google
1. Supabase chuyển hướng đến `accounts.google.com`.
2. Google xác thực và trả về Authorization Code.
3. Supabase trao đổi Auth Code lấy `id_token` + `access_token` từ Google.

### Bước 3 – GoTrue xử lý (2 trường hợp)

**Trường hợp A – Email CHƯA tồn tại trong hệ thống:**
1. Tạo bản ghi mới trong `auth.users` với `raw_app_meta_data.provider = 'google'`.
2. Ghi `email_confirmed_at = now()` (Gmail đã xác nhận email).
3. Ghi bản ghi vào `auth.identities` với `provider = 'google'`.
4. **Kích hoạt trigger** `trg_on_auth_user_created` → tạo `public.profiles`.
5. Gán role mặc định `sales`.

**Trường hợp B – Email ĐÃ tồn tại (từ đăng ký email/password):**
1. GoTrue kiểm tra cấu hình `Link identities with the same email` (phải bật trong Dashboard).
2. Tự động liên kết Google identity vào `auth.users` hiện có.
3. Ghi thêm bản ghi vào `auth.identities` với `provider = 'google'`.
4. **Kích hoạt trigger** `trg_on_identity_linked` → cập nhật `profiles.auth_providers`.
5. KHÔNG tạo user trùng lặp.

### Bước 4 – Callback xử lý
```javascript
// /auth/callback
const { data, error } = await supabase.auth.exchangeCodeForSession(
  new URLSearchParams(window.location.search).get('code')
);
if (data.session) navigate('/dashboard');
```

---

## 6. LUỒNG QUÊN MẬT KHẨU / ĐẶT LẠI MẬT KHẨU

### Bước 1 – Client gửi yêu cầu đặt lại
```javascript
const { error } = await supabase.auth.resetPasswordForEmail(
  'nhân viên@sanhlongvetco.vn',
  {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  }
);
```

### Bước 2 – GoTrue gửi email đặt lại mật khẩu
- Email chứa link dạng:
  ```
  https://<supabase-url>/auth/v1/verify?token=<otp>&type=recovery&redirect_to=<redirect_url>
  ```
- Token có hạn **1 giờ** (cấu hình `OTP_EXP`).

### Bước 3 – User click link, GoTrue xác thực token
- Chuyển hướng về `/auth/reset-password` với session tạm thời.
- Client nhận được `event = 'PASSWORD_RECOVERY'` trong `onAuthStateChange`.

### Bước 4 – User nhập mật khẩu mới
```javascript
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    const newPassword = prompt('Nhập mật khẩu mới:');
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });
    if (!error) navigate('/dashboard');
  }
});
```

### Bước 5 – GoTrue cập nhật mật khẩu
1. Hash mật khẩu mới bằng bcrypt.
2. Cập nhật `auth.users.encrypted_password`.
3. Ghi `updated_at = now()`.
4. Vô hiệu hóa tất cả refresh token cũ.

---

## 7. LOGIC CHỐNG TẠO TRÙNG TÀI KHOẢN

### Vấn đề
Cùng một địa chỉ email có thể được đăng ký qua nhiều con đường:
- Nhân viên đăng ký bằng email + mật khẩu.
- Sau đó đăng nhập bằng Google (cùng email Gmail).

### Giải pháp – Tầng 1: Supabase Auth Config
```
Supabase Dashboard → Auth → Settings
✅ Bật: "Link identities with the same email"
```
Khi bật tùy chọn này, GoTrue sẽ **tự động liên kết** thay vì tạo user mới nếu cùng email.

### Giải pháp – Tầng 2: Database Constraint
```sql
-- Trong bảng profiles, email có ràng buộc UNIQUE
email TEXT NOT NULL UNIQUE
```
Ngay cả khi có bug ở tầng ứng dụng, database sẽ chặn việc tạo 2 profile cùng email.

### Giải pháp – Tầng 3: Trigger ON CONFLICT DO NOTHING
```sql
-- Trong fn_handle_new_user()
INSERT INTO public.profiles (id, email, ...)
VALUES (NEW.id, NEW.email, ...)
ON CONFLICT (id) DO NOTHING;
-- Nếu profile đã tồn tại → bỏ qua, chỉ cập nhật auth_providers
```

### Xử lý trường hợp email giống nhau nhưng chưa được liên kết
Nếu admin TẮT "Link identities", Google OAuth với email đã có sẽ trả về lỗi:
```
User already registered
```
Client hiển thị: *"Email này đã được đăng ký bằng mật khẩu. Vui lòng đăng nhập bằng email/mật khẩu và liên kết Google trong phần Cài đặt tài khoản."*

---

## 8. LOGIC IDENTITY LINKING KHI CÙNG EMAIL

### Kịch bản
1. Nhân viên **A** đăng ký `a.nguyen@sanhlongvetco.vn` → email + password.
2. `profiles` có: `auth_providers = ['email']`.
3. Nhân viên **A** sau đó nhấn "Đăng nhập bằng Google" với cùng Gmail.
4. GoTrue phát hiện email trùng và liên kết identity (vì đã bật "Link identities with the same email").
5. Bản ghi mới được ghi vào `auth.identities` với `provider = 'google'`.

### Trigger xử lý
```sql
-- trg_on_identity_linked → fn_handle_linked_identity()
CREATE OR REPLACE FUNCTION public.fn_handle_linked_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Chỉ xử lý provider trong enum auth_provider
  -- Cập nhật mảng auth_providers nếu provider chưa có
  UPDATE public.profiles
  SET
    auth_providers = array_append(auth_providers, NEW.provider::auth_provider),
    updated_at     = now()
  WHERE id = NEW.user_id
    AND NOT (NEW.provider::auth_provider = ANY(auth_providers));
  RETURN NEW;
END;
$$;
```

### Kết quả sau linking
```
profiles.auth_providers = ['email', 'google']
```
UI có thể hiển thị: "Tài khoản liên kết: Email ✅ | Google ✅"

---

## 9. CẤU HÌNH SUPABASE DASHBOARD CẦN THIẾT

### Auth → Settings
| Cài đặt | Giá trị khuyến nghị |
|---------|---------------------|
| Enable Email confirmations | ON (môi trường Production) |
| Secure email change | ON |
| Enable Phone confirmations | OFF |
| JWT expiry | 3600 (1 giờ) |
| Link identities with the same email | **ON** (bắt buộc) |

### Auth → Providers → Google
| Cài đặt | Giá trị |
|---------|---------|
| Enable Google provider | ON |
| Client ID | `<GOOGLE_CLIENT_ID>` |
| Client Secret | `<GOOGLE_CLIENT_SECRET>` |
| Authorized redirect URIs (Google Console) | `https://<project-ref>.supabase.co/auth/v1/callback` |

### Auth → URL Configuration
| Cài đặt | Giá trị |
|---------|---------|
| Site URL | `https://crm.sanhlongvetco.vn` |
| Redirect URLs | `https://crm.sanhlongvetco.vn/auth/callback`, `http://localhost:5173/auth/callback` |

---

## 10. SƠ ĐỒ LUỒNG TỔNG HỢP

```
                         [USER]
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     [Email+Password]  [Google OAuth]  [Quên MK]
            │              │              │
            ▼              ▼              ▼
        signUp()    signInWithOAuth()  resetPassword()
            │              │              │
            └──────────────┼──────────────┘
                           │
                    [GoTrue Server]
                           │
                  Email mới? ─── Có ──→ Tạo auth.users
                           │                    │
                          Không                 │
                           │              [Trigger: trg_on_auth_user_created]
                   Link identity?               │
                           │              fn_handle_new_user()
                          Có              INSERT profiles (ON CONFLICT DO NOTHING)
                           │              INSERT user_roles (role = 'sales')
                    [auth.identities]           │
                           │                    │
               [Trigger: trg_on_identity_linked] │
                           │                    │
               UPDATE profiles.auth_providers   │
                           │                    │
                           └────────────────────┘
                                       │
                               [JWT Token trả về]
                                       │
                               [Client → Dashboard]
```
