-- ============================================================
-- Migration: user_roles_rpc_and_profile_guard
-- File: 20260741000000_user_roles_rpc_and_profile_guard.sql
--
-- Rà soát Quản lý Nhân viên ngày 2026-08-01 phát hiện 4 lỗ:
--
-- (1) GÁN VAI TRÒ KHÔNG NGUYÊN TỬ. SystemSettingsPage làm
--     `delete user_roles where user_id=X` (NUỐT LỖI, không kiểm) rồi mới
--     `insert`. Hỏng giữa chừng → nhân viên còn 0 vai trò → rơi về 'guest'
--     → mất quyền vào MỌI trang. Thay bằng RPC nguyên tử có chốt chặn.
--
-- (2) TỰ MỞ KHOÁ. Policy `profiles_update_self` là
--     USING (id = auth.uid()) WITH CHECK (id = auth.uid()) — KHÔNG giới hạn
--     cột. Bất kỳ ai cũng PATCH được hồ sơ của mình để bật lại
--     is_active = true sau khi bị khoá, hoặc đổi branch_id/employee_code.
--     PostgreSQL không có RLS theo cột → dùng trigger chốt cột (đúng khuôn
--     mẫu fn_guard_transfer_status / fn_guard_receipt_status đã dùng).
--
-- (3) NGƯỜI BỊ KHOÁ QUAY VÒNG VÔ TẬN. `profiles_select_all` đòi
--     fn_is_active(), nên người đã khoá không đọc nổi hồ sơ CỦA CHÍNH MÌNH
--     → AuthContext để profile = null → rbacReady mãi false → spinner vĩnh
--     viễn, không một dòng thông báo. Thêm policy đọc-hồ-sơ-của-mình.
--
-- (4) HARD-CODE EMAIL TRONG RLS. Policy user_roles_* và fn_handle_new_user
--     cấp quyền dựa trên chuỗi 'admin@sanhlongvetco.vn' / 'zendviet@gmail.com'.
--     Sắp mở tính năng đổi email → đổi xong là âm thầm MẤT quyền. Chuyển hết
--     sang kiểm theo vai trò.
--
-- ⚠️ Apply remote qua Management API + reload schema + tracking row.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. RPC gán vai trò — nguyên tử, admin-only, có chốt chặn tự khoá
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
  IF NOT (public.fn_is_active() AND public.fn_is_admin()) THEN
    RAISE EXCEPTION 'Chỉ quản trị viên được phép gán vai trò.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Không tìm thấy nhân viên.';
  END IF;

  -- Bỏ trống hết = đẩy người ta về 'guest', mất quyền vào mọi trang.
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

  -- Tự gỡ quyền admin của chính mình = khoá cứng bản thân ra ngoài.
  IF p_user_id = v_uid AND v_had_admin AND NOT v_has_admin THEN
    RAISE EXCEPTION 'Không thể tự gỡ vai trò Quản trị viên của chính mình.';
  END IF;

  -- Gỡ admin cuối cùng = không còn ai quản trị được hệ thống.
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

  -- Nguyên tử: cả hai câu nằm trong cùng transaction của hàm.
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

REVOKE ALL ON FUNCTION public.fn_set_user_roles(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_set_user_roles(UUID, UUID[]) TO authenticated;
COMMENT ON FUNCTION public.fn_set_user_roles(UUID, UUID[]) IS
'Admin gán lại toàn bộ vai trò cho 1 nhân viên (nguyên tử). Chặn bỏ trống, tự gỡ admin, gỡ admin cuối.';

-- ─────────────────────────────────────────────────────────────
-- 2. Người bị khoá phải đọc được hồ sơ CỦA CHÍNH MÌNH
--    → app biết mà hiện "tài khoản đã bị khoá" thay vì quay vòng vô tận.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT USING (id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 3. Chốt cột khi nhân viên tự sửa hồ sơ
--    RLS không giới hạn được theo cột → dùng trigger.
--    auth.uid() IS NULL = service_role hoặc tiến trình nội bộ (Edge Function
--    admin-users, cron) → cho qua. Anon không tới được đây vì policy UPDATE
--    đòi id = auth.uid(), mà auth.uid() NULL thì không khớp dòng nào.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_profile_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.fn_is_admin() THEN
    RETURN NEW;
  END IF;

  -- Người dùng thường sửa hồ sơ CHÍNH MÌNH: chỉ được đổi tên, SĐT, ảnh.
  IF auth.uid() = OLD.id THEN
    NEW.is_active     := OLD.is_active;      -- chặn tự mở khoá
    NEW.branch_id     := OLD.branch_id;
    NEW.team_id       := OLD.team_id;
    NEW.employee_code := OLD.employee_code;
    NEW.job_title     := OLD.job_title;
    NEW.email         := OLD.email;          -- email đổi qua Edge Function
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_self_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_self_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_profile_self_update();

-- ─────────────────────────────────────────────────────────────
-- 4. Đồng bộ email khi đổi từ Supabase Dashboard
--    (đổi qua Edge Function đã tự đồng bộ; đây là lưới an toàn)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_profile_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_email ON auth.users;
CREATE TRIGGER trg_sync_profile_email
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_profile_email();

-- ─────────────────────────────────────────────────────────────
-- 5. Bỏ hard-code email khỏi RLS user_roles → kiểm theo VAI TRÒ
--    Nếu không, đổi email 2 tài khoản đó là âm thầm mất quyền.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "user_roles_select_manager" ON public.user_roles;
CREATE POLICY "user_roles_select_manager" ON public.user_roles
  FOR SELECT USING (
    public.fn_is_admin()
    OR user_id = auth.uid()
    OR (public.fn_has_role('branch_manager') AND EXISTS (
          SELECT 1 FROM public.profiles p
           WHERE p.id = user_roles.user_id AND p.branch_id = public.fn_my_branch_id()))
  );

DROP POLICY IF EXISTS "user_roles_manage_manager" ON public.user_roles;
CREATE POLICY "user_roles_manage_manager" ON public.user_roles
  FOR ALL USING (
    (public.fn_is_admin()
     OR (public.fn_has_role('branch_manager') AND user_id <> auth.uid() AND EXISTS (
          SELECT 1 FROM public.profiles p
           WHERE p.id = user_roles.user_id AND p.branch_id = public.fn_my_branch_id())))
    AND public.fn_is_active()
  );

-- ─────────────────────────────────────────────────────────────
-- 6. fn_handle_new_user: bỏ hard-code email + KHÔNG tự cấp vai trò nữa.
--    Tài khoản nay chỉ do admin tạo qua Edge Function admin-users, vai trò
--    do admin chọn tường minh. Tự cấp 'sales' cho mọi đăng ký là lỗ hổng.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, auth_providers, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    ARRAY[COALESCE(NEW.raw_app_meta_data->>'provider', 'email')],
    true
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
