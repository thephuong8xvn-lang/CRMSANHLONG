-- ═══════════════════════════════════════════════════════════════════════════
-- KHUYẾN MÃI — GỬI CHO NHÓM KHÁCH HOẶC TỪNG KHÁCH, KHÔNG CÒN "TẤT CẢ HOẶC KHÔNG"
-- 2026-08-07
--
-- User: "về thông tin khuyến mãi tôi muốn nhắn cho nhóm khách hàng hoặc riêng
-- khách hàng […] nhưng không thấy, cần cải tiến tính năng này".
--
-- ── Trả lời phần "không thấy" ───────────────────────────────────────────
-- `fn_promo_broadcast` (`20260773`) chỉ có MỘT chế độ: quét sạch mọi khách có
-- nhóm Telegram rồi gửi hết. Không có đường nào chọn nhóm khách, càng không có
-- đường gửi cho đúng một khách. Đó là thứ migration này thêm.
--
-- ── 🔴 VÀ MỘT LỖI CHẶN ĐỨNG: BROADCAST CHỈ TỚI ĐƯỢC ĐÚNG MỘT KHÁCH ─────
-- Vòng lặp phát tin đang đánh dấu:
--     fingerprint := 'promo:' || promotion_id || ':' || customer_id
-- `fn_notify_emit` (`20260769:118`) suy ra `subject_key` = HAI ĐOẠN ĐẦU của
-- fingerprint, tức `promo:<mã CT>` — **giống hệt nhau cho mọi khách**. Ngay
-- dòng dưới, nó xoá mọi tin chưa gửi cùng subject_key:
--     UPDATE notification_events SET status='skipped'
--      WHERE subject_key = v_subj AND status='pending';
-- Cơ chế này sinh ra để "nhân viên sửa đơn thì bản sai bốc hơi", nhưng ở đây
-- nó biến thành: khách thứ 2 xoá tin của khách thứ 1, khách thứ 3 xoá tin của
-- khách thứ 2… **Phát cho 50 khách thì 49 tin bị huỷ, chỉ khách CUỐI nhận.**
-- Chưa ai phát hiện vì hệ thống hiện chưa có chương trình khuyến mãi nào và
-- nút này chưa từng chạy thật (0 dòng trong `notification_events`).
--
-- ⇒ Sửa: đẩy mã khách lên ĐOẠN THỨ HAI bằng gạch dưới, không phải dấu hai chấm:
--     'promo:' || promotion_id || '_' || customer_id
--   Mỗi cặp (chương trình × khách) thành một chủ thể riêng. Tin của khách này
--   không đụng tới khách kia nữa, mà vẫn giữ được cái hay: gửi lại đúng cặp đó
--   thì Telegram SỬA tin cũ tại chỗ thay vì nhắn thêm lần nữa.
--
-- ── Bối cảnh thật, để đặt kỳ vọng đúng ─────────────────────────────────
-- Đo lúc viết migration: 1.945 khách, **chỉ 3 khách có nhóm Telegram**. Nên
-- dù lọc kiểu gì thì số nhận thật cũng chỉ tối đa 3. Vì vậy hàm này trả về
-- LUÔN danh sách khách khớp bộ lọc mà **chưa có nhóm**, kèm lý do từng người —
-- để người dùng thấy ngay việc cần làm là tạo nhóm cho khách, chứ không ngồi
-- đoán vì sao "gửi rồi mà chẳng ai nhận".
--
-- ⚠️ Không có tích hợp Zalo. Kênh gửi khách duy nhất của hệ thống là nhóm
--    Telegram (`customers.telegram_chat_id`). Cột `customers.zalo_id` có từ
--    schema gốc nhưng chưa nối với bất cứ thứ gì.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fn_promo_recipients — ai nhận, ai không, và VÌ SAO không
-- ═══════════════════════════════════════════════════════════════════════════
-- Trả về MỌI khách khớp phạm vi đã chọn, kèm `ly_do_bo_qua`:
--   NULL  ⇒ đủ điều kiện nhận
--   khác  ⇒ bị loại, và câu chữ nói rõ vì sao
--
-- Phạm vi chọn theo thứ tự ưu tiên:
--   ① `p_customer_ids` KHÁC NULL ⇒ đúng những khách đó, BỎ QUA bộ lọc
--   ② NULL ⇒ áp bộ lọc `p_filter`; bộ lọc rỗng nghĩa là toàn bộ khách
--
-- 🪤 Mảng RỖNG khác NULL và phải trả về 0 người. Nếu coi mảng rỗng như "không
--    chọn gì" rồi rơi xuống nhánh ②, thì màn "Chọn từng khách" lúc chưa tick ai
--    sẽ âm thầm nhắm vào TOÀN BỘ danh sách khách — đúng cái thao tác dễ xảy ra
--    nhất khi người dùng vừa mở tab đó lên.
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
  v_tim   TEXT;
BEGIN
  -- SECURITY DEFINER + đọc toàn bộ bảng khách ⇒ phải tự canh cửa, nếu không
  -- đây thành đường vòng để mọi tài khoản đăng nhập liệt kê 1.945 khách hàng.
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được xem danh sách nhận tin khuyến mãi';
  END IF;

  v_ngay := COALESCE((SELECT (threshold->>'min_days_between')::int
                        FROM public.notification_rules
                       WHERE event_type = 'promo.broadcast'), 7);

  -- Bộ lọc: khoá nào vắng mặt hoặc mảng rỗng thì coi như không lọc chiều đó.
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
               AND (v_nv IS NULL OR c.owner_user_id = v_nv)
               AND (v_tim IS NULL
                    OR c.farm_name ILIKE '%' || v_tim || '%'
                    OR c.code      ILIKE '%' || v_tim || '%'
                    OR COALESCE(c.primary_phone,'') ILIKE '%' || v_tim || '%')
        END
  ORDER BY (c.telegram_chat_id IS NULL), c.farm_name;
END;
$$;

COMMENT ON FUNCTION public.fn_promo_recipients(UUID,UUID[],JSONB,BOOLEAN) IS
  'Ai sẽ nhận tin khuyến mãi và ai bị loại vì lý do gì. Trả về CẢ khách bị loại — '
  'với 1.945 khách mà chỉ 3 khách có nhóm Telegram thì biết "vì sao không nhận" '
  'quan trọng ngang biết "ai nhận".';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. fn_promo_broadcast — thêm chọn người nhận + ghi chú riêng
-- ═══════════════════════════════════════════════════════════════════════════
-- Đổi chữ ký ⇒ DROP theo TÊN bằng DO block quét pg_proc, đừng liệt kê chữ ký
-- cũ: lần apply thứ hai sẽ vỡ vì bản cũ đã biến mất.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_promo_broadcast'
  LOOP EXECUTE 'DROP FUNCTION ' || r.sig; END LOOP;
END $$;

CREATE FUNCTION public.fn_promo_broadcast(
  p_promotion_id    UUID,
  p_mode            TEXT    DEFAULT 'preview',
  p_customer_ids    UUID[]  DEFAULT NULL,
  p_filter          JSONB   DEFAULT '{}'::jsonb,
  p_bypass_cooldown BOOLEAN DEFAULT false,
  p_extra_note      TEXT    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  p        RECORD;
  v_text   TEXT;
  v_photo  TEXT;
  v_chon   BOOLEAN := p_customer_ids IS NOT NULL;   -- xem chú thích ở fn_promo_recipients
  v_bypass BOOLEAN;
  v_n      INTEGER := 0;
  v_bo_qua INTEGER := 0;
  v_ds     JSONB;
  v_ds_bo  JSONB;
  v_ly_do  JSONB;
  r        RECORD;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được phát tin khuyến mãi';
  END IF;

  SELECT * INTO p FROM public.promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'loi', 'Không thấy chương trình');
  END IF;

  -- Trần 1 tin/khách/7 ngày chỉ được bỏ qua khi người dùng CHỌN TAY từng khách.
  -- Bỏ trần cho cả một bộ lọc là công thức để dội quảng cáo cả danh sách.
  IF p_bypass_cooldown AND NOT v_chon THEN
    RETURN jsonb_build_object('ok', false,
      'loi', 'Chỉ được bỏ qua giới hạn 7 ngày khi chọn tay từng khách, không áp cho cả bộ lọc');
  END IF;
  v_bypass := p_bypass_cooldown AND v_chon;

  v_text := public.fn_promo_message(p_promotion_id);
  IF NULLIF(btrim(COALESCE(p_extra_note,'')), '') IS NOT NULL THEN
    v_text := v_text || E'\n\n📌 ' || public.fn_tg_escape(btrim(p_extra_note));
  END IF;

  -- Ảnh: ưu tiên banner, không có thì lấy ảnh SP đầu tiên trong chương trình.
  v_photo := NULLIF(p.telegram_banner_url, '');
  IF v_photo IS NULL THEN
    SELECT pr.image_urls[1] INTO v_photo
      FROM public.products pr
     WHERE pr.id IN (SELECT value::uuid
                       FROM jsonb_array_elements_text(
                              COALESCE(p.applies_to->'product_ids','[]'::jsonb)) AS t(value))
       AND pr.image_urls IS NOT NULL AND array_length(pr.image_urls,1) > 0
     LIMIT 1;
  END IF;
  -- Chú thích ảnh Telegram tối đa 1024 ký tự; dài hơn thì bỏ ảnh, gửi chữ.
  IF v_photo IS NOT NULL AND length(v_text) > 1000 THEN v_photo := NULL; END IF;

  SELECT count(*) FILTER (WHERE ly_do_bo_qua IS NULL),
         count(*) FILTER (WHERE ly_do_bo_qua IS NOT NULL)
    INTO v_n, v_bo_qua
  FROM public.fn_promo_recipients(p_promotion_id, p_customer_ids, p_filter, v_bypass);

  IF p_mode = 'preview' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', customer_id, 'ten', farm_name, 'ma', code) ORDER BY farm_name), '[]'::jsonb)
      INTO v_ds
    FROM (SELECT * FROM public.fn_promo_recipients(p_promotion_id, p_customer_ids, p_filter, v_bypass)
           WHERE ly_do_bo_qua IS NULL LIMIT 500) a;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', customer_id, 'ten', farm_name, 'ma', code, 'ly_do', ly_do_bo_qua)
             ORDER BY farm_name), '[]'::jsonb)
      INTO v_ds_bo
    FROM (SELECT * FROM public.fn_promo_recipients(p_promotion_id, p_customer_ids, p_filter, v_bypass)
           WHERE ly_do_bo_qua IS NOT NULL LIMIT 200) b;

    -- Gộp lý do để hiện một dòng tóm tắt thay vì bắt đọc 1.900 cái tên.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('ly_do', ly_do_bo_qua, 'so_khach', sl)
                              ORDER BY sl DESC), '[]'::jsonb)
      INTO v_ly_do
    FROM (SELECT ly_do_bo_qua, count(*) AS sl
            FROM public.fn_promo_recipients(p_promotion_id, p_customer_ids, p_filter, v_bypass)
           WHERE ly_do_bo_qua IS NOT NULL GROUP BY 1) g;

    RETURN jsonb_build_object('ok', true, 'che_do', 'preview', 'noi_dung', v_text,
      'anh', v_photo, 'so_nhom_nhan', v_n, 'so_nhom_bo_qua', v_bo_qua,
      'danh_sach', v_ds, 'danh_sach_bo_qua', v_ds_bo, 'ly_do_bo_qua', v_ly_do);
  END IF;

  IF p_mode = 'test' THEN
    PERFORM public.fn_tg_send(
      '🧪 <b>XEM THỬ KHUYẾN MÃI</b> — chưa gửi cho khách'
      || E'\n<i>Sẽ gửi tới ' || v_n || ' nhóm khách.</i>'
      || E'\n────────────────\n' || v_text,
      'tong_hop', 'promo.test', NULL, '{}');
    RETURN jsonb_build_object('ok', true, 'che_do', 'test', 'so_nhom_nhan', v_n,
      'ghi_chu', 'Đã gửi bản xem thử vào nhóm nội bộ');
  END IF;

  -- ── Phát thật ────────────────────────────────────────────────────────
  FOR r IN
    SELECT customer_id FROM public.fn_promo_recipients(
             p_promotion_id, p_customer_ids, p_filter, v_bypass)
     WHERE ly_do_bo_qua IS NULL
  LOOP
    -- 🔴 Mã khách nằm ở ĐOẠN THỨ HAI (nối bằng '_'), nên subject_key riêng cho
    --    từng cặp chương trình × khách. Dùng ':' như bản cũ thì mọi khách chung
    --    một subject_key và khách sau xoá sạch tin chưa gửi của khách trước.
    PERFORM public.fn_notify_emit('promo.broadcast', NULL,
      jsonb_build_object('text', v_text, 'photo', v_photo,
                         'line', 'KM: ' || p.name),
      'promo:' || p_promotion_id || '_' || r.customer_id,
      r.customer_id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'che_do', 'send', 'da_xep_hang', v_n,
    'bo_qua', v_bo_qua,
    'ghi_chu', 'Tin đi trong ~15 giây mỗi lượt, tối đa 20 nhóm/lượt');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_promo_broadcast(UUID,TEXT,UUID[],JSONB,BOOLEAN,TEXT)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_promo_broadcast(UUID,TEXT,UUID[],JSONB,BOOLEAN,TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.fn_promo_recipients(UUID,UUID[],JSONB,BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_promo_recipients(UUID,UUID[],JSONB,BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
