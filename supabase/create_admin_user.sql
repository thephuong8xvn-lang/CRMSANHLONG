-- ============================================================
-- TẠO ADMIN USER + GÁN QUYỀN ADMIN
-- Chạy script này SAU KHI đã chạy fix_trigger_cast.sql
-- VÀ SAU KHI tài khoản admin đã được đăng ký qua UI Login
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- BƯỚC A: Kiểm tra user đã tạo chưa
-- ─────────────────────────────────────────────────────────────
SELECT
  u.id,
  u.email,
  u.email_confirmed_at IS NOT NULL AS confirmed,
  p.full_name,
  p.is_active,
  p.auth_providers
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at DESC
LIMIT 10;

-- ─────────────────────────────────────────────────────────────
-- BƯỚC B: Gán role ADMIN cho user (thay email bên dưới)
-- Chạy lệnh này sau khi user đã đăng ký thành công
-- ─────────────────────────────────────────────────────────────
-- ⚠️ THAY 'admin@sanhlongvetco.vn' bằng email thực của bạn

DO $$
DECLARE
  v_user_id   UUID;
  v_admin_role_id UUID;
  v_sales_role_id UUID;
  v_target_email TEXT := 'admin@sanhlongvetco.vn';  -- ← SỬA EMAIL NÀY
BEGIN
  -- Lấy user_id
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE email = v_target_email;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User % chưa tồn tại. Hãy đăng ký trước!', v_target_email;
  END IF;

  -- Lấy role IDs
  SELECT id INTO v_admin_role_id FROM public.roles WHERE code = 'admin';
  SELECT id INTO v_sales_role_id FROM public.roles WHERE code = 'sales';

  -- Xóa role sales mặc định (nếu có)
  DELETE FROM public.user_roles
  WHERE user_id = v_user_id AND role_id = v_sales_role_id;

  -- Gán role admin
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_user_id, v_admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  -- Gán thêm vào chi nhánh HCM (tùy chọn)
  UPDATE public.profiles
  SET
    branch_id = '11111111-0000-0000-0000-000000000001',
    full_name = COALESCE(full_name, 'Quản trị viên')
  WHERE id = v_user_id;

  RAISE NOTICE '✅ Đã gán role ADMIN cho user: %', v_target_email;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- BƯỚC C: Xác nhận kết quả
-- ─────────────────────────────────────────────────────────────
SELECT
  p.email,
  p.full_name,
  p.is_active,
  p.auth_providers,
  p.branch_id,
  array_agg(r.code) AS roles
FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id = p.id
JOIN public.roles r ON r.id = ur.role_id
GROUP BY p.id, p.email, p.full_name, p.is_active, p.auth_providers, p.branch_id;
