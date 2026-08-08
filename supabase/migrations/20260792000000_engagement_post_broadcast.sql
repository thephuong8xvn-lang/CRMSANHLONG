-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE TƯƠNG TÁC KHÁCH HÀNG — SOẠN TIN & PHÁT BÀI VIẾT
-- 2026-08-08 · đi kèm `20260791`
--
-- Ba chế độ giống hệt luồng khuyến mãi đã chạy thật, để người dùng không phải
-- học lại: `preview` (xem trước + danh sách người nhận) → `test` (bắn vào nhóm
-- nội bộ) → `send` (xếp hàng gửi khách).
--
-- 🪤 CHÚ THÍCH ẢNH TELEGRAM TỐI ĐA 1024 KÝ TỰ. Bài có ảnh mà viết dài thì
--    Telegram TỪ CHỐI cả tin. Khuyến mãi xử lý bằng cách âm thầm bỏ ảnh
--    (`20260773`), nhưng với bài viết thì ẢNH LÀ NỘI DUNG CHÍNH ⇒ ở đây báo lỗi
--    rõ ràng kèm số ký tự đang thừa, để người soạn tự quyết rút gọn hay bỏ ảnh.
--
-- 🪤 `fingerprint` phải có DẤU THỜI GIAN của lượt gửi. `fn_notify_emit` lấy hai
--    đoạn đầu (tách bằng ':') làm `subject_key`; ở đây chỉ có MỘT dấu ':' nên
--    `subject_key` = trọn chuỗi, khác nhau mỗi lượt ⇒ drain luôn gửi TIN MỚI,
--    không bao giờ rơi vào nhánh `editMessageText` sửa đè lén tin cũ.
--    (Đúng cái đã phải vá ở `20260785` và `20260786`.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── ① ẢNH: ưu tiên mã đã cache, chưa có thì dùng đường dẫn ─────────────────
-- Trả về đúng thứ `payload->'photo'` cần chứa:
--   NULL          — bài không ảnh
--   "url"         — một ảnh, drain đi `sendPhoto` như cũ
--   ["a","b"]     — hai ảnh, `fn_tg_send_photo` chuyển sang `sendMediaGroup`
CREATE OR REPLACE FUNCTION public.fn_post_photo(p_post_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN count(*) = 0 THEN NULL
           WHEN count(*) = 1 THEN to_jsonb(min(ref))
           ELSE jsonb_agg(ref ORDER BY sort_order, created_at)
         END
  FROM (
    SELECT COALESCE(NULLIF(btrim(COALESCE(tg_file_id,'')), ''), url) AS ref,
           sort_order, created_at
    FROM public.post_images
    WHERE post_id = p_post_id AND COALESCE(btrim(url),'') <> ''
    ORDER BY sort_order, created_at
    LIMIT 2
  ) s;
$function$;

-- ─── ② SOẠN NỘI DUNG ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_post_message(p_post_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  p      RECORD;
  v_dau  TEXT;
  v_nhan TEXT;
  v_text TEXT;
BEGIN
  SELECT * INTO p FROM public.posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT x.dau, x.nhan INTO v_dau, v_nhan
  FROM (VALUES
        ('khuyen_mai',  '🎁', 'KHUYẾN MÃI'),
        ('dich_te',     '⚠️', 'THÔNG TIN DỊCH TỄ'),
        ('chuyen_nganh','📖', 'KIẾN THỨC CHĂN NUÔI'),
        ('thong_bao',   '📣', 'THÔNG BÁO')
       ) AS x(k, dau, nhan)
  WHERE x.k = p.kind;

  v_text := COALESCE(v_dau,'📣') || ' <b>' || COALESCE(v_nhan,'THÔNG BÁO') || '</b>'
         || E'\n<b>SANH LONG VETCO</b>'
         || E'\n\n<b>' || public.fn_tg_escape(btrim(p.title)) || '</b>';

  IF NULLIF(btrim(COALESCE(p.body,'')), '') IS NOT NULL THEN
    v_text := v_text || E'\n\n' || public.fn_tg_escape(btrim(p.body));
  END IF;

  IF NULLIF(btrim(COALESCE(p.link_url,'')), '') IS NOT NULL THEN
    v_text := v_text || E'\n\n🔗 ' || public.fn_tg_escape(btrim(p.link_url));
  END IF;

  RETURN v_text;
END;
$function$;

-- ─── ③ NGƯỜI NHẬN ──────────────────────────────────────────────────────────
-- Dùng chung ngữ nghĩa bộ lọc với `fn_promo_recipients` (nhiều nhóm = phép HỢP,
-- các chiều khác nhau thì GIAO), nhưng KHÔNG có trần tần suất — user đã chốt bỏ.
-- Thứ duy nhất còn chặn là CHỐNG TRÙNG: cùng một bài không tự gửi lại cho cùng
-- một khách. Đây không phải trần, và có `p_resend` để cố ý gửi lại.
CREATE OR REPLACE FUNCTION public.fn_post_recipients(
  p_post_id      UUID,
  p_customer_ids UUID[] DEFAULT NULL,
  p_filter       JSONB  DEFAULT '{}'::jsonb,
  p_resend       BOOLEAN DEFAULT false
) RETURNS TABLE(customer_id UUID, code TEXT, farm_name TEXT, chat_id TEXT, ly_do_bo_qua TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_chon BOOLEAN := p_customer_ids IS NOT NULL;   -- mảng rỗng = chọn 0 người
  v_tags TEXT[]; v_loai TEXT[]; v_hang TEXT[]; v_gd TEXT[];
  v_cn   UUID[]; v_nv UUID; v_tinh TEXT[]; v_nhom UUID[]; v_tim TEXT;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được xem danh sách nhận bài viết';
  END IF;

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
           -- Bài khuyến mãi tôn trọng nút từ chối; tin dịch tễ / thông báo thì
           -- vẫn gửi vì đó là thông tin khách cần biết, không phải quảng cáo.
           WHEN c.telegram_promo_optout IS TRUE
                AND (SELECT kind FROM public.posts WHERE id = p_post_id) = 'khuyen_mai'
             THEN 'khách từ chối nhận khuyến mãi'
           WHEN NOT p_resend AND EXISTS (
                  SELECT 1 FROM public.notification_log l
                   WHERE l.customer_id = c.id
                     AND l.event_type = 'post.broadcast'
                     AND l.status <> 'skipped'
                     AND l.subject_key LIKE 'post:' || p_post_id || '_' || c.id || '_%')
             THEN 'đã nhận bài này rồi'
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
$function$;

-- ─── ④ PHÁT BÀI ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_post_broadcast(
  p_post_id      UUID,
  p_mode         TEXT DEFAULT 'preview',
  p_customer_ids UUID[] DEFAULT NULL,
  p_filter       JSONB  DEFAULT '{}'::jsonb,
  p_resend       BOOLEAN DEFAULT false,
  p_extra_note   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  p        RECORD;
  v_text   TEXT;
  v_photo  JSONB;
  v_so_anh INTEGER;
  v_len    INTEGER;
  v_n      INTEGER := 0;
  v_bo_qua INTEGER := 0;
  v_ds     JSONB; v_ds_bo JSONB; v_ly_do JSONB;
  v_fp     TEXT;
  v_chat   TEXT;
  v_test   TEXT;
  r        RECORD;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được phát bài viết cho khách';
  END IF;

  SELECT * INTO p FROM public.posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'loi', 'Không thấy bài viết');
  END IF;
  IF NOT COALESCE(p.is_active, true) AND p_mode = 'send' THEN
    RETURN jsonb_build_object('ok', false, 'loi', 'Bài viết đang tắt, không gửi được');
  END IF;

  v_text := public.fn_post_message(p_post_id);
  IF NULLIF(btrim(COALESCE(p_extra_note,'')), '') IS NOT NULL THEN
    v_text := v_text || E'\n\n📌 ' || public.fn_tg_escape(btrim(p_extra_note));
  END IF;
  v_text := v_text
         || E'\n\n<i>Nếu không muốn nhận tin như thế này, xin nhắn lại trong nhóm.</i>';

  v_photo  := public.fn_post_photo(p_post_id);
  v_so_anh := CASE WHEN v_photo IS NULL THEN 0
                   WHEN jsonb_typeof(v_photo) = 'array' THEN jsonb_array_length(v_photo)
                   ELSE 1 END;
  v_len := length(v_text);

  -- Chú thích ảnh tối đa 1024 ký tự. Bài không ảnh thì trần là 4096 (drain tự cắt).
  IF v_so_anh > 0 AND v_len > 1000 THEN
    IF p_mode = 'send' THEN
      RETURN jsonb_build_object('ok', false,
        'loi', 'Bài có ảnh nên nội dung tối đa 1.000 ký tự (hiện ' || v_len
               || '). Rút gọn ' || (v_len - 1000) || ' ký tự, hoặc bỏ ảnh đi.');
    END IF;
  END IF;

  SELECT count(*) FILTER (WHERE ly_do_bo_qua IS NULL),
         count(*) FILTER (WHERE ly_do_bo_qua IS NOT NULL)
    INTO v_n, v_bo_qua
  FROM public.fn_post_recipients(p_post_id, p_customer_ids, p_filter, p_resend);

  -- ── Xem trước ────────────────────────────────────────────────────────────
  IF p_mode = 'preview' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', customer_id, 'ten', farm_name, 'ma', code) ORDER BY farm_name), '[]'::jsonb)
      INTO v_ds
    FROM (SELECT * FROM public.fn_post_recipients(p_post_id, p_customer_ids, p_filter, p_resend)
           WHERE ly_do_bo_qua IS NULL LIMIT 500) a;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', customer_id, 'ten', farm_name, 'ma', code, 'ly_do', ly_do_bo_qua)
             ORDER BY farm_name), '[]'::jsonb)
      INTO v_ds_bo
    FROM (SELECT * FROM public.fn_post_recipients(p_post_id, p_customer_ids, p_filter, p_resend)
           WHERE ly_do_bo_qua IS NOT NULL LIMIT 200) b;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('ly_do', ly_do_bo_qua, 'so_khach', sl)
                              ORDER BY sl DESC), '[]'::jsonb)
      INTO v_ly_do
    FROM (SELECT ly_do_bo_qua, count(*) AS sl
            FROM public.fn_post_recipients(p_post_id, p_customer_ids, p_filter, p_resend)
           WHERE ly_do_bo_qua IS NOT NULL GROUP BY 1) g;

    RETURN jsonb_build_object('ok', true, 'che_do', 'preview',
      'noi_dung', v_text, 'anh', v_photo, 'so_anh', v_so_anh,
      'so_ky_tu', v_len, 'gioi_han_ky_tu', CASE WHEN v_so_anh > 0 THEN 1000 ELSE 4000 END,
      'qua_dai', (v_so_anh > 0 AND v_len > 1000),
      'so_nhom_nhan', v_n, 'so_nhom_bo_qua', v_bo_qua,
      'danh_sach', v_ds, 'danh_sach_bo_qua', v_ds_bo, 'ly_do_bo_qua', v_ly_do);
  END IF;

  -- ── Gửi thử vào nhóm nội bộ ──────────────────────────────────────────────
  -- 🪤 KHÔNG đi qua `fn_notify_emit`: luật `post.broadcast` có
  --    `audience='customer'`, mà bản thử không gắn khách nào ⇒ `fn_notify_target`
  --    trả rỗng và drain đánh dấu `skipped`, tin không bao giờ ra. Phải bắn
  --    thẳng vào nhóm nội bộ.
  IF p_mode = 'test' THEN
    SELECT tg.chat_id INTO v_chat
      FROM public.fn_notify_target('internal', 'tong_hop', NULL, NULL) tg;
    IF v_chat IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'loi', 'Chưa cấu hình nhóm nội bộ Tổng hợp');
    END IF;

    v_test := '🧪 <b>XEM THỬ BÀI VIẾT</b> — chưa gửi cho khách'
           || E'\n<i>Sẽ gửi tới ' || v_n || ' nhóm khách.</i>'
           || E'\n────────────────\n' || v_text;

    -- Lời dẫn làm tin dài thêm ~90 ký tự; quá trần chú thích thì bỏ ảnh ở BẢN THỬ
    -- (bản gửi thật vẫn còn ảnh, vì nó không có lời dẫn này).
    IF v_so_anh > 0 AND length(v_test) <= 1000 THEN
      PERFORM public.fn_tg_send_photo(
        v_chat,
        CASE WHEN jsonb_typeof(v_photo) = 'string' THEN v_photo #>> '{}'
             ELSE v_photo::text END,
        v_test, 'post.test', NULL, NULL, '{}'::bigint[], NULL);
    ELSE
      IF v_so_anh > 0 THEN
        v_test := v_test || E'\n\n<i>(Bản thử bỏ ảnh cho vừa giới hạn chú thích — '
               || 'bản gửi khách vẫn có ' || v_so_anh || ' ảnh.)</i>';
      END IF;
      PERFORM public.fn_tg_send(v_test, 'tong_hop', 'post.test', NULL, '{}'::bigint[]);
    END IF;

    RETURN jsonb_build_object('ok', true, 'che_do', 'test', 'so_nhom_nhan', v_n,
      'ghi_chu', 'Đã gửi bản xem thử vào nhóm nội bộ');
  END IF;

  -- ── Phát thật ────────────────────────────────────────────────────────────
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'loi', 'Không có nhóm khách nào đủ điều kiện nhận');
  END IF;

  FOR r IN
    SELECT customer_id FROM public.fn_post_recipients(
             p_post_id, p_customer_ids, p_filter, p_resend)
     WHERE ly_do_bo_qua IS NULL
  LOOP
    -- Dấu thời gian ở cuối ⇒ mỗi lượt gửi là một tin MỚI, không sửa đè tin cũ.
    v_fp := 'post:' || p_post_id || '_' || r.customer_id || '_'
            || extract(epoch from clock_timestamp())::bigint;

    PERFORM public.fn_notify_emit('post.broadcast', NULL,
      jsonb_build_object('text', v_text, 'photo', v_photo,
                         'line', 'Bài: ' || p.title),
      v_fp, r.customer_id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'che_do', 'send', 'da_xep_hang', v_n,
    'bo_qua', v_bo_qua,
    'ghi_chu', 'Tin đi trong ~15 giây mỗi lượt, tối đa 20 nhóm/lượt');
END;
$function$;

-- ─── ⑤ KHUYẾN MÃI: GỠ CHỐT "CHỈ BỎ TRẦN KHI CHỌN TAY" ─────────────────────
-- Chốt này vô nghĩa sau khi trần đã bằng 0, mà lại làm màn gửi báo lỗi khó hiểu.
CREATE OR REPLACE FUNCTION public.fn_promo_broadcast(
  p_promotion_id    UUID,
  p_mode            TEXT DEFAULT 'preview',
  p_customer_ids    UUID[] DEFAULT NULL,
  p_filter          JSONB DEFAULT '{}'::jsonb,
  p_bypass_cooldown BOOLEAN DEFAULT false,
  p_extra_note      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  p        RECORD;
  v_text   TEXT;
  v_photo  TEXT;
  v_n      INTEGER := 0;
  v_bo_qua INTEGER := 0;
  v_ds     JSONB; v_ds_bo JSONB; v_ly_do JSONB;
  r        RECORD;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được phát tin khuyến mãi';
  END IF;

  SELECT * INTO p FROM public.promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'loi', 'Không thấy chương trình');
  END IF;

  v_text := public.fn_promo_message(p_promotion_id);
  IF NULLIF(btrim(COALESCE(p_extra_note,'')), '') IS NOT NULL THEN
    v_text := v_text || E'\n\n📌 ' || public.fn_tg_escape(btrim(p_extra_note));
  END IF;

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
  IF v_photo IS NOT NULL AND length(v_text) > 1000 THEN v_photo := NULL; END IF;

  SELECT count(*) FILTER (WHERE ly_do_bo_qua IS NULL),
         count(*) FILTER (WHERE ly_do_bo_qua IS NOT NULL)
    INTO v_n, v_bo_qua
  FROM public.fn_promo_recipients(p_promotion_id, p_customer_ids, p_filter, p_bypass_cooldown);

  IF p_mode = 'preview' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', customer_id, 'ten', farm_name, 'ma', code) ORDER BY farm_name), '[]'::jsonb)
      INTO v_ds
    FROM (SELECT * FROM public.fn_promo_recipients(p_promotion_id, p_customer_ids, p_filter, p_bypass_cooldown)
           WHERE ly_do_bo_qua IS NULL LIMIT 500) a;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', customer_id, 'ten', farm_name, 'ma', code, 'ly_do', ly_do_bo_qua)
             ORDER BY farm_name), '[]'::jsonb)
      INTO v_ds_bo
    FROM (SELECT * FROM public.fn_promo_recipients(p_promotion_id, p_customer_ids, p_filter, p_bypass_cooldown)
           WHERE ly_do_bo_qua IS NOT NULL LIMIT 200) b;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('ly_do', ly_do_bo_qua, 'so_khach', sl)
                              ORDER BY sl DESC), '[]'::jsonb)
      INTO v_ly_do
    FROM (SELECT ly_do_bo_qua, count(*) AS sl
            FROM public.fn_promo_recipients(p_promotion_id, p_customer_ids, p_filter, p_bypass_cooldown)
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

  FOR r IN
    SELECT customer_id FROM public.fn_promo_recipients(
             p_promotion_id, p_customer_ids, p_filter, p_bypass_cooldown)
     WHERE ly_do_bo_qua IS NULL
  LOOP
    -- Dấu thời gian ở đoạn cuối: cùng một chương trình gửi lại lần nữa cũng ra
    -- TIN MỚI, không sửa đè tin cũ trong nhóm khách.
    PERFORM public.fn_notify_emit('promo.broadcast', NULL,
      jsonb_build_object('text', v_text, 'photo', v_photo,
                         'line', 'KM: ' || p.name),
      'promo:' || p_promotion_id || '_' || r.customer_id || '_'
        || extract(epoch from clock_timestamp())::bigint,
      r.customer_id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'che_do', 'send', 'da_xep_hang', v_n,
    'bo_qua', v_bo_qua,
    'ghi_chu', 'Tin đi trong ~15 giây mỗi lượt, tối đa 20 nhóm/lượt');
END;
$function$;

-- ─── ⑥ QUYỀN GỌI HÀM ───────────────────────────────────────────────────────
-- Mặc định Postgres cấp EXECUTE cho PUBLIC (gồm cả `anon` = chưa đăng nhập).
-- Với hàm SECURITY DEFINER phát tin cho khách thì đó là lỗ hổng. Thu về trước,
-- rồi chỉ mở cho người đã đăng nhập; bên trong thân hàm vẫn có `fn_is_admin()`.
REVOKE ALL ON FUNCTION public.fn_post_photo(UUID)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_post_message(UUID)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_post_recipients(UUID,UUID[],JSONB,BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_post_broadcast(UUID,TEXT,UUID[],JSONB,BOOLEAN,TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_post_photo(UUID)                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_post_message(UUID)                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_post_recipients(UUID,UUID[],JSONB,BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_post_broadcast(UUID,TEXT,UUID[],JSONB,BOOLEAN,TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
