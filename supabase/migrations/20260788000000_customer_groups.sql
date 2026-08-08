-- ═══════════════════════════════════════════════════════════════════════════
-- NHÓM KHÁCH HÀNG NHIỀU-NHIỀU — ĐỂ GỬI KHUYẾN MÃI THEO NHÓM
-- 2026-08-08
--
-- User: "gởi khuyến mãi theo nhóm khách hàng (nhóm theo khu vực, nhóm theo
-- hạng khách hàng, nhóm theo chăn nuôi…). 1 khách hàng thuộc NHIỀU nhóm nên
-- có thể hưởng khuyến mãi từ nhiều chương trình."
--
-- ── Vì sao phải làm bảng mới, không tận dụng cái sẵn có ─────────────────
-- `customers.customer_type`, `value_tier`, `lifecycle_stage` đều là cột ĐƠN
-- TRỊ — mỗi khách đúng một giá trị. `customer_classifications` và
-- `customer_tiers` chỉ là bảng tra cứu cho hai cột đó, không phải quan hệ
-- nhiều-nhiều. Chúng KHÔNG diễn tả được "khách này vừa thuộc khu vực Ân Hảo,
-- vừa hạng VIP, vừa nuôi gà thịt".
-- ⇒ Cần đúng một bảng nối `customer_group_members`.
--
-- ── 🔴 Sự thật dữ liệu phải biết trước khi kỳ vọng ─────────────────────
-- Đo lúc viết, trên 1.945 khách: `province`, `district`, `address` **NULL
-- 100%**, `tags` rỗng 100%. Nghĩa là **không thể tự sinh nhóm khu vực** từ dữ
-- liệu hiện có — không có gì để mà suy ra. Nhóm phải do người dùng đặt tên và
-- gán khách vào, hoặc gán hàng loạt bằng bộ lọc (`fn_customer_group_add_by_filter`).
-- Đây là lý do màn quản lý nhóm có sẵn ô tìm kiếm + thêm hàng loạt.
--
-- ── `kind` chỉ để XẾP NGĂN, không ràng buộc gì ─────────────────────────
-- Một khách thuộc bao nhiêu nhóm cũng được, kể cả nhiều nhóm cùng `kind`
-- (vừa "Ân Hảo" vừa "Hoài Ân" nếu có hai trại). Cố tình KHÔNG thêm ràng buộc
-- "mỗi kind một nhóm" — đó chính là thứ user muốn tránh.
--
-- ⚠️ Chọn NHIỀU nhóm khi gửi = phép HỢP (union), khách nằm trong bất kỳ nhóm
--    nào đã chọn thì nhận, và chỉ nhận MỘT tin dù thuộc cả ba nhóm.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'khac',
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_groups_kind_check
    CHECK (kind IN ('khu_vuc','hang_khach','chan_nuoi','khac'))
);

COMMENT ON TABLE public.customer_groups IS
  'Nhóm khách hàng do người dùng tự đặt, dùng để nhắm tin khuyến mãi. Một khách '
  'thuộc BAO NHIÊU nhóm cũng được — đó là mục đích của bảng nối bên dưới.';
COMMENT ON COLUMN public.customer_groups.kind IS
  'Chỉ để xếp ngăn cho dễ nhìn: khu_vuc | hang_khach | chan_nuoi | khac. '
  'KHÔNG ràng buộc mỗi khách một nhóm trong mỗi ngăn.';

CREATE TABLE IF NOT EXISTS public.customer_group_members (
  group_id    UUID NOT NULL REFERENCES public.customer_groups(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id)       ON DELETE CASCADE,
  added_by    UUID REFERENCES public.profiles(id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, customer_id)
);

-- Khoá chính đã phục vụ chiều group → customer; cần thêm chiều ngược lại để
-- hồ sơ khách liệt kê nhanh "khách này thuộc nhóm nào".
CREATE INDEX IF NOT EXISTS idx_cgm_customer ON public.customer_group_members(customer_id);

CREATE OR REPLACE FUNCTION public.trg_customer_groups_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_customer_groups_touch ON public.customer_groups;
CREATE TRIGGER trg_customer_groups_touch
  BEFORE UPDATE ON public.customer_groups
  FOR EACH ROW EXECUTE FUNCTION public.trg_customer_groups_touch();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — đọc như đọc khách hàng, sửa thì phải có quyền sửa khách
-- ═══════════════════════════════════════════════════════════════════════════
-- Bám đúng `customers_select_all` đang chạy (`fn_is_active()`): danh sách nhóm
-- không nhạy cảm hơn danh sách khách, mà nhân viên bán hàng cần thấy để biết
-- khách của mình thuộc nhóm nào.
-- Sửa thì chốt bằng MÃ QUYỀN `customers.edit`, không bằng tên vai trò
-- (bài học 20260748 — chốt theo tên vai trò vỡ âm thầm mỗi lần cơ cấu lại).
ALTER TABLE public.customer_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cg_select     ON public.customer_groups;
DROP POLICY IF EXISTS cg_insert     ON public.customer_groups;
DROP POLICY IF EXISTS cg_update     ON public.customer_groups;
DROP POLICY IF EXISTS cg_delete     ON public.customer_groups;
DROP POLICY IF EXISTS cgm_select    ON public.customer_group_members;
DROP POLICY IF EXISTS cgm_insert    ON public.customer_group_members;
DROP POLICY IF EXISTS cgm_delete    ON public.customer_group_members;

CREATE POLICY cg_select ON public.customer_groups
  FOR SELECT USING (public.fn_is_active());
CREATE POLICY cg_insert ON public.customer_groups
  FOR INSERT WITH CHECK (public.fn_is_active() AND public.fn_has_permission('customers.edit'));
CREATE POLICY cg_update ON public.customer_groups
  FOR UPDATE USING (public.fn_is_active() AND public.fn_has_permission('customers.edit'));
-- Xoá hẳn một nhóm kéo theo toàn bộ thành viên ⇒ chỉ quản trị.
CREATE POLICY cg_delete ON public.customer_groups
  FOR DELETE USING (public.fn_is_active() AND public.fn_is_admin());

CREATE POLICY cgm_select ON public.customer_group_members
  FOR SELECT USING (public.fn_is_active());
CREATE POLICY cgm_insert ON public.customer_group_members
  FOR INSERT WITH CHECK (public.fn_is_active() AND public.fn_has_permission('customers.edit'));
CREATE POLICY cgm_delete ON public.customer_group_members
  FOR DELETE USING (public.fn_is_active() AND public.fn_has_permission('customers.edit'));

GRANT SELECT ON public.customer_groups, public.customer_group_members TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.customer_groups TO authenticated;
GRANT INSERT, DELETE ON public.customer_group_members TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_customer_groups_overview — danh sách nhóm kèm số liệu dùng được
-- ═══════════════════════════════════════════════════════════════════════════
-- Trả kèm `so_co_nhom_tg`: trong nhóm này bao nhiêu khách thật sự nhắn được.
-- Với thực tế 4/1.945 khách có nhóm Telegram, con số này quan trọng ngang số
-- thành viên — nếu không, người dùng gom 300 khách rồi ngạc nhiên vì gửi 0.
CREATE OR REPLACE FUNCTION public.fn_customer_groups_overview()
RETURNS TABLE (
  id UUID, code TEXT, name TEXT, kind TEXT, description TEXT,
  is_active BOOLEAN, so_thanh_vien BIGINT, so_co_nhom_tg BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT g.id, g.code, g.name, g.kind, g.description, g.is_active,
         count(m.customer_id),
         count(*) FILTER (WHERE c.telegram_chat_id IS NOT NULL
                            AND c.telegram_enabled IS TRUE)
  FROM public.customer_groups g
  LEFT JOIN public.customer_group_members m ON m.group_id = g.id
  LEFT JOIN public.customers c ON c.id = m.customer_id AND c.merged_into_id IS NULL
  WHERE public.fn_is_active()
  GROUP BY g.id, g.code, g.name, g.kind, g.description, g.is_active
  ORDER BY g.kind, g.name;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_customer_group_add_by_filter — gom nhóm hàng loạt
-- ═══════════════════════════════════════════════════════════════════════════
-- Cùng hình dạng bộ lọc với `fn_promo_recipients` để người dùng chỉ phải học
-- một bộ khái niệm. Không có dữ liệu khu vực nên `search` (tên/mã/SĐT) thường
-- là đường nhanh nhất: gõ "Ân Hảo" rồi thêm cả loạt.
CREATE OR REPLACE FUNCTION public.fn_customer_group_add_by_filter(
  p_group_id UUID,
  p_filter   JSONB DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_loai TEXT[]; v_hang TEXT[]; v_gd TEXT[]; v_cn UUID[]; v_tim TEXT;
  v_them INTEGER;
BEGIN
  IF NOT public.fn_has_permission('customers.edit') THEN
    RAISE EXCEPTION 'Bạn không có quyền sửa khách hàng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_groups WHERE id = p_group_id) THEN
    RETURN jsonb_build_object('ok', false, 'loi', 'Không thấy nhóm');
  END IF;

  v_loai := CASE WHEN jsonb_typeof(p_filter->'customer_type') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'customer_type')) END;
  v_hang := CASE WHEN jsonb_typeof(p_filter->'value_tier') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'value_tier')) END;
  v_gd   := CASE WHEN jsonb_typeof(p_filter->'lifecycle_stage') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'lifecycle_stage')) END;
  v_cn   := CASE WHEN jsonb_typeof(p_filter->'branch_ids') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'branch_ids'))::uuid[] END;
  v_tim  := NULLIF(btrim(COALESCE(p_filter->>'search','')), '');

  -- Bộ lọc RỖNG nghĩa là TOÀN BỘ khách — chặn lại, vì "bấm nhầm nút" ở đây
  -- nghĩa là nhét 1.945 khách vào một nhóm rồi phải dọn tay.
  IF v_loai IS NULL AND v_hang IS NULL AND v_gd IS NULL AND v_cn IS NULL AND v_tim IS NULL THEN
    RETURN jsonb_build_object('ok', false,
      'loi', 'Phải chọn ít nhất một điều kiện lọc — để trống sẽ thêm toàn bộ khách hàng');
  END IF;

  WITH da_them AS (
    INSERT INTO public.customer_group_members (group_id, customer_id, added_by)
    SELECT p_group_id, c.id, auth.uid()
      FROM public.customers c
     WHERE c.merged_into_id IS NULL
       AND COALESCE(c.is_active, true)
       AND (v_loai IS NULL OR c.customer_type = ANY(v_loai))
       AND (v_hang IS NULL OR c.value_tier = ANY(v_hang))
       AND (v_gd   IS NULL OR c.lifecycle_stage::text = ANY(v_gd))
       AND (v_cn   IS NULL OR c.branch_id = ANY(v_cn))
       AND (v_tim  IS NULL
            OR c.farm_name ILIKE '%' || v_tim || '%'
            OR c.code      ILIKE '%' || v_tim || '%'
            OR COALESCE(c.primary_phone,'') ILIKE '%' || v_tim || '%')
    ON CONFLICT (group_id, customer_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_them FROM da_them;

  RETURN jsonb_build_object('ok', true, 'da_them', v_them,
    'tong_thanh_vien', (SELECT count(*) FROM public.customer_group_members
                         WHERE group_id = p_group_id));
END $$;

REVOKE ALL ON FUNCTION public.fn_customer_group_add_by_filter(UUID,JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_customer_group_add_by_filter(UUID,JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_customer_groups_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_customer_groups_overview() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_promo_recipients — nhận thêm chiều lọc `group_ids`
-- ═══════════════════════════════════════════════════════════════════════════
-- Chọn nhiều nhóm = phép HỢP. Dùng EXISTS nên khách thuộc cả ba nhóm vẫn chỉ
-- ra MỘT dòng ⇒ chỉ nhận một tin, đúng như user mong đợi.
CREATE OR REPLACE FUNCTION public.fn_promo_recipients(
  p_promotion_id    UUID,
  p_customer_ids    UUID[]  DEFAULT NULL,
  p_filter          JSONB   DEFAULT '{}'::jsonb,
  p_bypass_cooldown BOOLEAN DEFAULT false
)
RETURNS TABLE (
  customer_id  UUID,
  code         TEXT,
  farm_name    TEXT,
  chat_id      TEXT,
  ly_do_bo_qua TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ngay  INTEGER;
  v_chon  BOOLEAN := p_customer_ids IS NOT NULL;   -- mảng rỗng = chọn 0 người
  v_tags  TEXT[];
  v_loai  TEXT[];
  v_hang  TEXT[];
  v_gd    TEXT[];
  v_cn    UUID[];
  v_nv    UUID;
  v_tinh  TEXT[];
  v_nhom  UUID[];
  v_tim   TEXT;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được xem danh sách nhận tin khuyến mãi';
  END IF;

  v_ngay := COALESCE((SELECT (threshold->>'min_days_between')::int
                        FROM public.notification_rules
                       WHERE event_type = 'promo.broadcast'), 7);

  v_tags := CASE WHEN jsonb_typeof(p_filter->'tags') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'tags')) END;
  v_loai := CASE WHEN jsonb_typeof(p_filter->'customer_type') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'customer_type')) END;
  v_hang := CASE WHEN jsonb_typeof(p_filter->'value_tier') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'value_tier')) END;
  v_gd   := CASE WHEN jsonb_typeof(p_filter->'lifecycle_stage') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'lifecycle_stage')) END;
  v_cn   := CASE WHEN jsonb_typeof(p_filter->'branch_ids') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'branch_ids'))::uuid[] END;
  v_tinh := CASE WHEN jsonb_typeof(p_filter->'province') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'province')) END;
  v_nhom := CASE WHEN jsonb_typeof(p_filter->'group_ids') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_filter->'group_ids'))::uuid[] END;
  v_nv   := NULLIF(p_filter->>'owner_user_id','')::uuid;
  v_tim  := NULLIF(btrim(COALESCE(p_filter->>'search','')), '');

  RETURN QUERY
  SELECT c.id, c.code, c.farm_name, c.telegram_chat_id,
         CASE
           WHEN c.telegram_chat_id IS NULL OR btrim(c.telegram_chat_id) = ''
             THEN 'chưa có nhóm Telegram'
           WHEN c.telegram_enabled IS NOT TRUE
             THEN 'đã tắt nhận tin Telegram'
           WHEN c.telegram_promo_optout IS TRUE
             THEN 'khách từ chối nhận khuyến mãi'
           WHEN NOT p_bypass_cooldown AND EXISTS (
                  SELECT 1 FROM public.notification_log l
                   WHERE l.customer_id = c.id
                     AND l.event_type = 'promo.broadcast'
                     AND l.status <> 'skipped'
                     AND l.created_at > now() - (interval '1 day' * v_ngay))
             THEN 'vừa nhận tin khuyến mãi trong ' || v_ngay || ' ngày qua'
           ELSE NULL
         END
  FROM public.customers c
  WHERE c.merged_into_id IS NULL
    AND CASE
          WHEN v_chon THEN c.id = ANY(p_customer_ids)
          ELSE COALESCE(c.is_active, true)
               AND (v_tags IS NULL OR cardinality(v_tags) = 0 OR c.tags && v_tags)
               AND (v_loai IS NULL OR cardinality(v_loai) = 0 OR c.customer_type = ANY(v_loai))
               AND (v_hang IS NULL OR cardinality(v_hang) = 0 OR c.value_tier = ANY(v_hang))
               AND (v_gd   IS NULL OR cardinality(v_gd)   = 0 OR c.lifecycle_stage::text = ANY(v_gd))
               AND (v_cn   IS NULL OR cardinality(v_cn)   = 0 OR c.branch_id = ANY(v_cn))
               AND (v_tinh IS NULL OR cardinality(v_tinh) = 0 OR c.province = ANY(v_tinh))
               -- Nhiều nhóm = phép HỢP; EXISTS nên không nhân bản dòng.
               AND (v_nhom IS NULL OR cardinality(v_nhom) = 0
                    OR EXISTS (SELECT 1 FROM public.customer_group_members m
                                WHERE m.customer_id = c.id AND m.group_id = ANY(v_nhom)))
               AND (v_nv IS NULL OR c.owner_user_id = v_nv)
               AND (v_tim IS NULL
                    OR c.farm_name ILIKE '%' || v_tim || '%'
                    OR c.code      ILIKE '%' || v_tim || '%'
                    OR COALESCE(c.primary_phone,'') ILIKE '%' || v_tim || '%')
        END
  ORDER BY (c.telegram_chat_id IS NULL), c.farm_name;
END;
$$;

NOTIFY pgrst, 'reload schema';
