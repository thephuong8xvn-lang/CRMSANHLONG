-- ============================================================
-- Migration: role_permissions_scope_guard
-- File: 20260740000000_role_permissions_scope_guard.sql
--
-- MỤC ĐÍCH: bịt lỗ "lưu ma trận phân quyền làm mất quyền không hiển thị".
--
-- Bản 20260725 làm: DELETE hết role_permissions của role → INSERT lại đúng
-- những mã UI gửi lên. Mà UI chỉ gửi mã có trong `permissionCatalog.ts`.
-- Rà ngày 2026-08-01: DB có 73 mã, catalog chỉ liệt kê 53 → **20 mã mồ côi**.
-- Bấm "Lưu phân quyền" cho một vai trò bất kỳ là xoá vĩnh viễn 20 mã đó.
-- Đã đo trên prod: vai trò `sales` mất 7/25 quyền, trong đó có
-- customers.view_own, orders.view_own, opportunities.create — tức nhân viên
-- bán hàng mất sạch Khách hàng, Đơn hàng, Pipeline (App.tsx dùng đúng các mã
-- này làm điều kiện vào trang).
--
-- CÁCH SỬA — hai lớp:
--   1. (FE) catalog đã bổ sung đủ 73 mã, khớp 1-1 với DB.
--   2. (DB, file này) thêm tham số p_scope: hàm CHỈ ĐƯỢC XOÁ những quyền nằm
--      trong scope client khai báo. Mã ngoài scope không bao giờ bị đụng.
--      → Sau này catalog có sót mã nữa thì hậu quả chỉ là "không quản được
--      từ UI", KHÔNG còn là "bị xoá mất".
--
-- Giữ overload cũ (p_role_id, p_codes) để frontend chưa deploy không gãy —
-- nhưng bản cũ nay mặc định scope = p_codes ∪ quyền hiện có... KHÔNG.
-- Bản cũ được định nghĩa lại thành: scope = p_codes (chỉ xoá thứ được nhắc
-- tới) → hành vi an toàn kể cả khi gọi từ FE cũ.
--
-- ⚠️ Apply remote qua Management API + reload schema + tracking row.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Bản CHÍNH: có scope tường minh
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_role_permissions(
  p_role_id UUID,
  p_codes   TEXT[],
  p_scope   TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role_code TEXT;
  v_granted   INTEGER;
  v_revoked   INTEGER;
  v_codes     TEXT[] := COALESCE(p_codes, ARRAY[]::TEXT[]);
  v_scope     TEXT[] := COALESCE(p_scope, ARRAY[]::TEXT[]);
BEGIN
  IF NOT (public.fn_is_active() AND public.fn_is_admin()) THEN
    RAISE EXCEPTION 'Chỉ quản trị viên được phép chỉnh sửa phân quyền.';
  END IF;

  SELECT code INTO v_role_code FROM public.roles WHERE id = p_role_id;
  IF v_role_code IS NULL THEN
    RAISE EXCEPTION 'Vai trò không tồn tại.';
  END IF;
  IF v_role_code IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Không thể chỉnh phân quyền vai trò % (luôn toàn quyền).', v_role_code;
  END IF;

  -- Mã được tick nhưng nằm ngoài scope là mâu thuẫn → chặn sớm cho rõ lỗi
  IF EXISTS (SELECT 1 FROM unnest(v_codes) c WHERE NOT (c = ANY(v_scope))) THEN
    RAISE EXCEPTION 'Có mã quyền nằm ngoài phạm vi khai báo — từ chối để tránh ghi sai.';
  END IF;

  -- CHỈ thu hồi trong phạm vi. Quyền ngoài scope giữ nguyên tuyệt đối.
  DELETE FROM public.role_permissions rp
   USING public.permissions pm
   WHERE rp.permission_id = pm.id
     AND rp.role_id = p_role_id
     AND pm.code = ANY(v_scope)
     AND NOT (pm.code = ANY(v_codes));
  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT p_role_id, pm.id
    FROM public.permissions pm
   WHERE pm.code = ANY(v_codes)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_granted = ROW_COUNT;

  RETURN jsonb_build_object(
    'role_id',      p_role_id,
    'granted',      v_granted,
    'revoked',      v_revoked,
    'out_of_scope', (SELECT count(*) FROM public.role_permissions rp
                       JOIN public.permissions pm ON pm.id = rp.permission_id
                      WHERE rp.role_id = p_role_id AND NOT (pm.code = ANY(v_scope)))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[], TEXT[]) TO authenticated;
COMMENT ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[], TEXT[]) IS
'Admin gán lại permission cho 1 role TRONG PHẠM VI p_scope. Quyền ngoài scope không bị đụng. Chặn admin/ceo.';

-- ─────────────────────────────────────────────────────────────
-- 2. Overload CŨ (2 tham số) — frontend chưa deploy vẫn gọi được.
--    Định nghĩa lại cho AN TOÀN: scope = chính p_codes, nghĩa là chỉ thêm
--    quyền được tick, không thu hồi gì cả. Thà thiếu còn hơn xoá nhầm.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_role_permissions(
  p_role_id UUID,
  p_codes   TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.fn_set_role_permissions(p_role_id, p_codes, COALESCE(p_codes, ARRAY[]::TEXT[]));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[]) TO authenticated;
COMMENT ON FUNCTION public.fn_set_role_permissions(UUID, TEXT[]) IS
'BẢN CŨ (tương thích ngược): chỉ CẤP thêm quyền được tick, không thu hồi. Dùng bản 3 tham số để quản lý đầy đủ.';

NOTIFY pgrst, 'reload schema';
