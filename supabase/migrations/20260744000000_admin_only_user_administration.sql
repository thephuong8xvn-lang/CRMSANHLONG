-- ============================================================
-- Migration: admin_only_user_administration
-- File: 20260744000000_admin_only_user_administration.sql
--
-- YÊU CẦU (user chốt 2026-08-02): CHỈ DUY NHẤT tài khoản quản trị được cấp và
-- gỡ quyền; mọi tài khoản khác không đụng được phần Cấu hình.
--
-- Giao diện đã đúng từ trước: route `/system-settings` và mục menu "Cấu hình"
-- đều `adminOnly` (App.tsx / Layout.tsx), loại cả CEO. NHƯNG RLS dưới DB thì
-- KHÔNG — và RLS mới là thứ thật, vì client cầm anon key gọi thẳng PostgREST
-- được, chẳng cần đi qua màn hình nào:
--
-- (1) `user_roles_manage_manager` cho BẤT KỲ `branch_manager` nào ghi
--     `user_roles` của người CÙNG CHI NHÁNH. Mỗi chi nhánh hiện chỉ 1 tài
--     khoản nên chưa nổ, nhưng thêm 1 nhân sự nữa vào cùng chi nhánh là hai
--     người tự cấp `admin` chéo cho nhau được — điều kiện `user_id <> auth.uid()`
--     chỉ chặn tự cấp cho CHÍNH MÌNH, không chặn cấp chéo.
--     (Lỗ này từng được chứng minh 2026-08-01: đóng vai chi nhánh xoá sạch
--      vai trò của admin 8 → 0. Khi đó chỉ vá bằng cách gỡ admin khỏi chi
--      nhánh — vá triệu chứng, không vá gốc.)
--
-- (2) `profiles_insert/update/delete_manager` cho `branch_manager` tạo, sửa,
--     XOÁ hồ sơ người cùng chi nhánh. Trigger `fn_guard_profile_self_update`
--     chỉ chốt cột khi người ta sửa hồ sơ CỦA CHÍNH MÌNH → sửa hồ sơ người
--     khác vẫn đổi được `is_active`, `branch_id`, `employee_code` tuỳ ý.
--
-- (3) `roles` / `role_permissions` / `permissions` dùng `fn_is_admin()`
--     = `admin OR ceo`. Giao diện đã cố ý chặn CEO khỏi Cấu hình
--     ("kể cả CEO cũng bị chặn" — App.tsx:142), DB phải nói cùng một điều.
--
-- CÁCH VÁ: mọi thao tác quản trị người dùng → `fn_has_role('admin')`, KHÔNG
-- dùng `fn_is_admin()` nữa. Đọc vai trò thì chỉ còn admin + chính mình (đã
-- rà: 3 chỗ đọc `user_roles` phía client đều lọc `user_id = auth.uid()`).
--
-- KHÔNG đụng: `profiles_select_all` (danh bạ nội bộ — nhiều trang cần đọc
-- tên nhân viên), `profiles_update_self` (tự sửa tên/SĐT/ảnh, đã có trigger
-- chốt cột), Edge Function `admin-users` (service key, bỏ qua RLS, tự kiểm
-- `fn_is_admin` bên trong).
--
-- ⚠️ Apply remote qua Management API + tracking row.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. Hàm tiện ích: "đúng vai trò admin", không tính ceo
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_sysadmin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_has_role('admin') AND public.fn_is_active();
$$;

REVOKE ALL ON FUNCTION public.fn_is_sysadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_is_sysadmin() TO authenticated;
COMMENT ON FUNCTION public.fn_is_sysadmin() IS
'Đúng vai trò admin và đang hoạt động. KHÁC fn_is_admin() ở chỗ KHÔNG tính ceo — dùng cho quản trị người dùng & cấu hình.';

-- ─────────────────────────────────────────────────────────────
-- 1. user_roles — cấp/gỡ quyền: CHỈ admin
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "user_roles_manage_manager" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_manage_admin"   ON public.user_roles;
CREATE POLICY "user_roles_manage_admin" ON public.user_roles
  FOR ALL
  USING      (public.fn_is_sysadmin())
  WITH CHECK (public.fn_is_sysadmin());

-- Đọc: admin thấy hết, người thường chỉ thấy vai trò CỦA CHÍNH MÌNH
-- (AuthContext / DisplaySettings / CustomerDetail đều chỉ hỏi auth.uid()).
DROP POLICY IF EXISTS "user_roles_select_manager" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_self"    ON public.user_roles;
CREATE POLICY "user_roles_select_self" ON public.user_roles
  FOR SELECT USING (public.fn_is_sysadmin() OR user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 2. profiles — tạo / sửa / xoá hồ sơ nhân sự: CHỈ admin
--    (giữ nguyên profiles_select_all và profiles_update_self)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_insert_manager" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin"   ON public.profiles;
CREATE POLICY "profiles_insert_admin" ON public.profiles
  FOR INSERT WITH CHECK (public.fn_is_sysadmin());

DROP POLICY IF EXISTS "profiles_update_manager" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin"   ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE
  USING      (public.fn_is_sysadmin())
  WITH CHECK (public.fn_is_sysadmin());

DROP POLICY IF EXISTS "profiles_delete_manager" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin"   ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE USING (public.fn_is_sysadmin());

-- ─────────────────────────────────────────────────────────────
-- 3. Danh mục vai trò & ma trận phân quyền: CHỈ admin được ghi
--    (SELECT giữ nguyên cho fn_is_active — app cần đọc tên vai trò)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "roles_manage_admin" ON public.roles;
CREATE POLICY "roles_manage_admin" ON public.roles
  FOR ALL USING (public.fn_is_sysadmin()) WITH CHECK (public.fn_is_sysadmin());

DROP POLICY IF EXISTS "role_permissions_manage_admin" ON public.role_permissions;
CREATE POLICY "role_permissions_manage_admin" ON public.role_permissions
  FOR ALL USING (public.fn_is_sysadmin()) WITH CHECK (public.fn_is_sysadmin());

DROP POLICY IF EXISTS "permissions_manage_admin" ON public.permissions;
CREATE POLICY "permissions_manage_admin" ON public.permissions
  FOR ALL USING (public.fn_is_sysadmin()) WITH CHECK (public.fn_is_sysadmin());

-- ─────────────────────────────────────────────────────────────
-- 4. RPC gán vai trò: siết từ fn_is_admin() (admin OR ceo) → chỉ admin
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_user_roles(
  p_user_id  UUID,
  p_role_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_ids       UUID[] := COALESCE(p_role_ids, ARRAY[]::UUID[]);
  v_bad       INTEGER;
  v_had_admin BOOLEAN;
  v_has_admin BOOLEAN;
  v_n_admin   INTEGER;
  v_granted   INTEGER;
BEGIN
  IF NOT public.fn_is_sysadmin() THEN
    RAISE EXCEPTION 'Chỉ tài khoản Quản trị hệ thống được phép gán vai trò.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Không tìm thấy nhân viên.';
  END IF;

  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Phải chọn ít nhất một vai trò. Muốn ngưng truy cập thì hãy KHOÁ tài khoản.';
  END IF;

  SELECT count(*) INTO v_bad
    FROM unnest(v_ids) rid
   WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = rid);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Danh sách vai trò có % mục không tồn tại.', v_bad;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = p_user_id AND r.code = 'admin'
  ) INTO v_had_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.roles r WHERE r.id = ANY(v_ids) AND r.code = 'admin'
  ) INTO v_has_admin;

  IF p_user_id = v_uid AND v_had_admin AND NOT v_has_admin THEN
    RAISE EXCEPTION 'Không thể tự gỡ vai trò Quản trị viên của chính mình.';
  END IF;

  IF v_had_admin AND NOT v_has_admin THEN
    SELECT count(DISTINCT ur.user_id) INTO v_n_admin
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE r.code = 'admin' AND p.is_active;
    IF v_n_admin <= 1 THEN
      RAISE EXCEPTION 'Đây là Quản trị viên duy nhất đang hoạt động — không thể gỡ.';
    END IF;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = p_user_id AND NOT (role_id = ANY(v_ids));

  INSERT INTO public.user_roles (user_id, role_id)
  SELECT p_user_id, rid FROM unnest(v_ids) rid
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_granted = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_data)
  VALUES (v_uid, 'UPDATE', 'user_roles', p_user_id,
          jsonb_build_object('event', 'set_user_roles', 'role_ids', to_jsonb(v_ids)));

  RETURN jsonb_build_object('user_id', p_user_id, 'roles', array_length(v_ids, 1), 'added', v_granted);
END;
$$;

-- Ma trận phân quyền vai trò cũng chỉ admin
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_set_role_permissions'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. Gỡ 2 mã quyền quản trị người dùng khỏi branch_manager.
--    Để lại thì màn hình Cấu hình vẫn khoá (route adminOnly), nhưng ma trận
--    phân quyền hiển thị sai sự thật — vai trò khoe quyền mà RLS không cho.
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.role_permissions rp
 USING public.roles r, public.permissions pm
 WHERE rp.role_id = r.id
   AND rp.permission_id = pm.id
   AND r.code = 'branch_manager'
   AND pm.code IN ('users.manage', 'users.assign_role');

-- ─────────────────────────────────────────────────────────────
-- 6. Kiểm chứng ngay trong migration — sai thì dừng, không để nửa vời
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n INTEGER;
BEGIN
  -- Không policy nào của 5 bảng quản trị còn nhắc tới branch_manager
  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('user_roles','roles','role_permissions','permissions','profiles')
     AND (coalesce(qual,'') LIKE '%branch_manager%' OR coalesce(with_check,'') LIKE '%branch_manager%');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Còn % policy quản trị cho branch_manager.', v_n;
  END IF;

  -- branch_manager không còn mã quyền quản trị người dùng
  SELECT count(*) INTO v_n
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    JOIN public.permissions pm ON pm.id = rp.permission_id
   WHERE r.code = 'branch_manager' AND pm.code IN ('users.manage','users.assign_role');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'branch_manager vẫn còn % mã quyền quản trị người dùng.', v_n;
  END IF;

  -- Phải còn ít nhất 1 admin đang hoạt động, nếu không là khoá cứng cả nhà
  SELECT count(DISTINCT ur.user_id) INTO v_n
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE r.code = 'admin' AND p.is_active;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'Không còn Quản trị viên nào đang hoạt động.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
