-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE TƯƠNG TÁC KHÁCH HÀNG — BÀI VIẾT GỬI NHÓM TELEGRAM
-- 2026-08-08
--
-- User: "xây dựng module tương tác khách hàng — gửi bài viết (1 đến 2 hình ảnh)
-- về khuyến mãi, thông tin dịch tễ, bài viết chuyên ngành; gửi cho cá nhân hoặc
-- nhóm khách hàng". Sau đó chốt thêm: "1 ngày có thể gởi nhiều tin vào nhóm,
-- điều này là không thể tránh khỏi" → BỎ HẲN MỌI TRẦN TẦN SUẤT.
--
-- ── VÌ SAO KHÔNG DỰNG LẠI TỪ ĐẦU ───────────────────────────────────────────
-- Tạo nhóm / gán nhóm / lọc người nhận ĐÃ CÓ SẴN và đang đúng:
-- `customer_groups`, `customer_group_members`, `fn_customer_group_add_by_filter`,
-- `fn_promo_recipients` (nhận `p_filter.group_ids`, nhiều nhóm = phép HỢP).
-- Hàng đợi `notification_events` → `fn_notify_drain` cũng đã chạy thật.
-- ⇒ Migration này CHỈ thêm một LOẠI NỘI DUNG mới cắm vào đường ống có sẵn.
--
-- ── ① BỎ TRẦN — CẢ HAI CHỖ ─────────────────────────────────────────────────
-- 🪤 Xoá khoá `min_days_between` KHÔNG đủ: `fn_promo_recipients` viết
--    `COALESCE((threshold->>'min_days_between')::int, 7)` ⇒ thiếu khoá thì
--    rơi về **7 ngày** chứ không phải 0. Phải đặt HẲN bằng 0 **và** sửa hàm
--    để coi `<= 0` là không chặn.
-- Đồng thời gỡ chốt "chỉ được bỏ trần khi chọn tay" trong `fn_promo_broadcast`.
--
-- ── ② HAI ẢNH MÀ KHÔNG ĐỘNG VÀO `fn_notify_drain` ──────────────────────────
-- Drain lấy ảnh bằng `v_photo := NULLIF(r.payload->>'photo','')` rồi truyền
-- một chuỗi vào `fn_tg_send_photo`. Sửa drain (15KB, đang chạy thật) chỉ để
-- thêm ảnh thứ hai là đánh đổi tồi.
-- 🔑 Mẹo: nhét MẢNG JSON vào `payload->'photo'`. `->>'photo'` trả về đúng
--    chuỗi `["url1","url2"]`, drain vẫn chạy y nguyên, và chỉ
--    `fn_tg_send_photo` cần biết: thấy chuỗi mở đầu bằng '[' thì chuyển sang
--    `sendMediaGroup`. Một ảnh vẫn đi `sendPhoto` như cũ ⇒ tương thích ngược
--    hoàn toàn với khuyến mãi.
--
-- ── ③ CACHE `file_id` — MẤU CHỐT TIẾT KIỆM DỮ LIỆU ─────────────────────────
-- Telegram TẢI ảnh về máy chủ của họ đúng MỘT lần rồi trả `file_id`. Tái dùng
-- mã đó thì gửi 500 nhóm vẫn chỉ tốn một lần tải. Hiện `fn_tg_send_photo`
-- **không lưu `file_id`** ⇒ blast 50 nhóm = 50 lần tải ảnh.
-- 🔑 Bắt `file_id` bằng TRIGGER trên `notification_log` (queued → sent), đọc
--    lại `net._http_response` theo `req_id`. Cách này KHÔNG phải sửa drain.
--
-- ── ④ CHỐNG TRÙNG ≠ TRẦN TẦN SUẤT ──────────────────────────────────────────
-- User bỏ trần tần suất, nhưng vẫn cần chặn bấm gửi nhầm hai lần CÙNG MỘT BÀI
-- cho CÙNG MỘT KHÁCH. Đây là chống trùng nội dung, có nút "gửi lại" cố ý.
--
-- 🪤 `subject_key` của bài viết PHẢI khác nhau mỗi lượt gửi (kèm dấu thời
--    gian), nếu không drain chọn nhánh `editMessageText` và **sửa đè lén** tin
--    cũ trong nhóm khách — đúng cái đã phải vá ở `20260785`/`20260786`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── ① BÀI VIẾT ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'thong_bao',
  link_url    TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT posts_kind_chk
    CHECK (kind IN ('khuyen_mai','dich_te','chuyen_nganh','thong_bao')),
  CONSTRAINT posts_title_chk CHECK (btrim(title) <> '')
);

CREATE TABLE IF NOT EXISTS public.post_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  -- Mã ảnh Telegram trả về sau lần gửi ĐẦU TIÊN. Có mã này thì mọi lần gửi sau
  -- không tải lại ảnh từ kho của mình nữa.
  tg_file_id  TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_images_post ON public.post_images(post_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_posts_active ON public.posts(is_active, created_at DESC);

-- Tối đa 2 ảnh mỗi bài — đúng phạm vi user nêu, và giữ chú thích không bị cắt.
CREATE OR REPLACE FUNCTION public.trg_post_images_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM public.post_images WHERE post_id = NEW.post_id) > 2 THEN
    RAISE EXCEPTION 'Mỗi bài viết tối đa 2 ảnh';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_post_images_cap ON public.post_images;
CREATE CONSTRAINT TRIGGER trg_post_images_cap
  AFTER INSERT ON public.post_images
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images_cap();

CREATE OR REPLACE FUNCTION public.trg_posts_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_posts_touch ON public.posts;
CREATE TRIGGER trg_posts_touch BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_posts_touch();

ALTER TABLE public.posts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posts_select        ON public.posts;
DROP POLICY IF EXISTS posts_manage_admin  ON public.posts;
DROP POLICY IF EXISTS post_images_select  ON public.post_images;
DROP POLICY IF EXISTS post_images_manage  ON public.post_images;

-- Đọc: mọi nhân viên đang hoạt động (để sau này gắn bài vào màn khác).
-- Sửa/xoá/gửi: chỉ quản trị — cùng mức với phát tin khuyến mãi.
CREATE POLICY posts_select       ON public.posts       FOR SELECT USING (public.fn_is_active());
CREATE POLICY posts_manage_admin ON public.posts       FOR ALL
  USING (public.fn_is_active() AND public.fn_is_admin())
  WITH CHECK (public.fn_is_active() AND public.fn_is_admin());
CREATE POLICY post_images_select ON public.post_images FOR SELECT USING (public.fn_is_active());
CREATE POLICY post_images_manage ON public.post_images FOR ALL
  USING (public.fn_is_active() AND public.fn_is_admin())
  WITH CHECK (public.fn_is_active() AND public.fn_is_admin());

-- ─── ② KHO ẢNH ─────────────────────────────────────────────────────────────
-- Bucket PUBLIC vì Telegram phải tải được ảnh bằng đường dẫn ẩn danh ở lần gửi
-- đầu. Sau lần đó dùng `file_id`, nên đường dẫn công khai gần như không ai gọi.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('post-images', 'post-images', true, 5242880,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS post_images_read   ON storage.objects;
DROP POLICY IF EXISTS post_images_write  ON storage.objects;
DROP POLICY IF EXISTS post_images_delete ON storage.objects;

CREATE POLICY post_images_read ON storage.objects FOR SELECT
  USING (bucket_id = 'post-images');
CREATE POLICY post_images_write ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'post-images' AND public.fn_is_active() AND public.fn_is_admin());
CREATE POLICY post_images_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'post-images' AND public.fn_is_active() AND public.fn_is_admin());

-- ─── ③ GỬI NHIỀU ẢNH + BẮT `file_id` ───────────────────────────────────────
-- Giữ NGUYÊN chữ ký cũ (9 tham số của fn_tg_send, 8 của fn_tg_send_photo).
-- 🪤 `CREATE OR REPLACE` mà đổi số tham số là NẠP CHỒNG chứ không thay thế —
--    bản cũ vẫn còn và drain có thể gọi nhầm.

CREATE OR REPLACE FUNCTION public.fn_tg_send_photo(
  p_chat_id     TEXT,
  p_photo_url   TEXT,
  p_caption     TEXT,
  p_event_type  TEXT DEFAULT NULL,
  p_branch_id   UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_event_ids   BIGINT[] DEFAULT '{}'::bigint[],
  p_subject_key TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault','net'
AS $function$
DECLARE
  v_token TEXT; v_req BIGINT; v_log BIGINT;
  v_arr   JSONB;
  v_media JSONB;
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token';

  INSERT INTO public.notification_log
    (event_type, branch_id, customer_id, channel_code, chat_id, message,
     event_ids, status, mode, subject_key)
  VALUES (p_event_type, p_branch_id, p_customer_id, 'photo', p_chat_id, p_caption,
          p_event_ids, 'queued', 'send', p_subject_key)
  RETURNING id INTO v_log;

  IF v_token IS NULL OR COALESCE(p_chat_id,'') = '' THEN
    UPDATE public.notification_log SET status='skipped',
           error='thiếu token hoặc chat_id' WHERE id=v_log;
    RETURN v_log;
  END IF;

  -- Nhiều ảnh: payload gửi vào là chuỗi JSON dạng mảng. Một ảnh thì đi đường cũ.
  v_arr := NULL;
  IF left(btrim(COALESCE(p_photo_url,'')), 1) = '[' THEN
    BEGIN
      v_arr := btrim(p_photo_url)::jsonb;
      IF jsonb_typeof(v_arr) <> 'array' OR jsonb_array_length(v_arr) = 0 THEN
        v_arr := NULL;
      ELSIF jsonb_array_length(v_arr) = 1 THEN
        p_photo_url := v_arr->>0;   -- mảng một phần tử ⇒ sendPhoto cho gọn
        v_arr := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN v_arr := NULL;
    END;
  END IF;

  IF v_arr IS NOT NULL THEN
    -- Chú thích đặt ở phần tử ĐẦU TIÊN — Telegram hiển thị nó cho cả chùm ảnh.
    SELECT jsonb_agg(
             CASE WHEN ord = 1
                  THEN jsonb_build_object('type','photo','media', u,
                                          'caption', p_caption, 'parse_mode','HTML')
                  ELSE jsonb_build_object('type','photo','media', u) END
             ORDER BY ord)
      INTO v_media
    FROM (SELECT value AS u, row_number() OVER () AS ord
            FROM jsonb_array_elements_text(v_arr) AS t(value)) s;

    SELECT net.http_post(
      url     := 'https://api.telegram.org/bot' || v_token || '/sendMediaGroup',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('chat_id', p_chat_id, 'media', v_media)
    ) INTO v_req;
  ELSE
    SELECT net.http_post(
      url     := 'https://api.telegram.org/bot' || v_token || '/sendPhoto',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('chat_id', p_chat_id, 'photo', p_photo_url,
                                    'caption', p_caption, 'parse_mode', 'HTML')
    ) INTO v_req;
  END IF;

  UPDATE public.notification_log
     SET req_id=v_req, attempts=attempts+1, last_try_at=now() WHERE id=v_log;
  RETURN v_log;
END;
$function$;

-- Bắt `file_id` ngay khi drain đánh dấu tin đã gửi. Đọc lại phản hồi HTTP theo
-- `req_id` — pg_net giữ bảng phản hồi vài giờ, thừa sức vì trigger nổ sau vài giây.
CREATE OR REPLACE FUNCTION public.trg_capture_tg_file_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','net' AS $function$
DECLARE
  v_post UUID;
  v_res  JSONB;
  v_ids  TEXT[];
BEGIN
  -- Chỉ quan tâm tin BÀI VIẾT có ảnh, vừa chuyển sang 'sent', và ảnh chưa có mã.
  IF NEW.event_type <> 'post.broadcast' OR NEW.req_id IS NULL THEN RETURN NULL; END IF;

  v_post := NULLIF(split_part(split_part(COALESCE(NEW.subject_key,''), ':', 2), '_', 1), '')::uuid;
  IF v_post IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.post_images
                  WHERE post_id = v_post AND tg_file_id IS NULL) THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT content::jsonb INTO v_res FROM net._http_response WHERE id = NEW.req_id;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
  IF v_res IS NULL OR COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  -- sendPhoto → result là OBJECT; sendMediaGroup → result là MẢNG message.
  -- Mỗi message có mảng `photo` nhiều kích cỡ; lấy cỡ LỚN NHẤT (phần tử cuối).
  IF jsonb_typeof(v_res->'result') = 'array' THEN
    SELECT array_agg(fid ORDER BY ord) INTO v_ids
    FROM (
      SELECT (m->'photo'->(jsonb_array_length(m->'photo') - 1)->>'file_id') AS fid,
             row_number() OVER () AS ord
        FROM jsonb_array_elements(v_res->'result') AS m
       WHERE jsonb_typeof(m->'photo') = 'array' AND jsonb_array_length(m->'photo') > 0
    ) s;
  ELSE
    SELECT ARRAY[(v_res->'result'->'photo'
                  ->(jsonb_array_length(v_res->'result'->'photo') - 1)->>'file_id')]
      INTO v_ids
    WHERE jsonb_typeof(v_res->'result'->'photo') = 'array';
  END IF;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN RETURN NULL; END IF;

  -- Khớp theo VỊ TRÍ: ảnh được gửi đúng thứ tự `sort_order`.
  UPDATE public.post_images pi
     SET tg_file_id = v_ids[x.ord]
    FROM (SELECT id, row_number() OVER (ORDER BY sort_order, created_at) AS ord
            FROM public.post_images WHERE post_id = v_post) x
   WHERE pi.id = x.id
     AND pi.tg_file_id IS NULL
     AND x.ord <= cardinality(v_ids)
     AND v_ids[x.ord] IS NOT NULL;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- không bao giờ để việc cache ảnh làm hỏng luồng gửi tin
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_tg_file_id ON public.notification_log;
CREATE TRIGGER trg_capture_tg_file_id
  AFTER UPDATE OF status ON public.notification_log
  FOR EACH ROW
  WHEN (NEW.status = 'sent' AND OLD.status = 'queued')
  EXECUTE FUNCTION public.trg_capture_tg_file_id();

-- ─── ④ BỎ TRẦN TẦN SUẤT ────────────────────────────────────────────────────
-- User chốt cuối 08/08: "1 ngày có thể gởi nhiều tin vào nhóm, điều này là
-- không thể tránh khỏi" → chọn "Bỏ hẳn mọi trần".
-- Đo trên prod: 5/6 luật tin khách vốn đã `daily_cap = 1.000.000`, chỉ
-- `promo.broadcast` còn `min_days_between: 7`.

UPDATE public.notification_rules
   SET threshold  = jsonb_set(COALESCE(threshold,'{}'::jsonb),
                              '{min_days_between}', '0'::jsonb),
       quiet_hours = false,
       updated_at = now()
 WHERE event_type = 'promo.broadcast';

INSERT INTO public.notification_rules
  (event_type, label, enabled, severity, channel_code, threshold,
   batch_window_sec, min_interval_sec, quiet_hours, daily_cap, compose, audience, delay_sec)
VALUES
  ('post.broadcast', 'Bài viết gửi khách', true, 'info', '@customer', '{}'::jsonb,
   0, 0, false, 1000000, 'full', 'customer', 0)
ON CONFLICT (event_type) DO UPDATE
  SET label = EXCLUDED.label, enabled = true, channel_code = '@customer',
      audience = 'customer', compose = 'full', daily_cap = 1000000,
      threshold = '{}'::jsonb, quiet_hours = false, delay_sec = 0,
      updated_at = now();

-- `v_ngay <= 0` ⇒ KHÔNG chặn. Chỉ đổi đúng một nhánh CASE, phần lọc giữ nguyên.
CREATE OR REPLACE FUNCTION public.fn_promo_recipients(
  p_promotion_id     UUID,
  p_customer_ids     UUID[] DEFAULT NULL,
  p_filter           JSONB  DEFAULT '{}'::jsonb,
  p_bypass_cooldown  BOOLEAN DEFAULT false
) RETURNS TABLE(customer_id UUID, code TEXT, farm_name TEXT, chat_id TEXT, ly_do_bo_qua TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ngay  INTEGER;
  v_chon  BOOLEAN := p_customer_ids IS NOT NULL;
  v_tags  TEXT[]; v_loai TEXT[]; v_hang TEXT[]; v_gd TEXT[];
  v_cn    UUID[]; v_nv UUID; v_tinh TEXT[]; v_nhom UUID[]; v_tim TEXT;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được xem danh sách nhận tin khuyến mãi';
  END IF;

  -- Mặc định 0 = không chặn (trước đây mặc định 7).
  v_ngay := COALESCE((SELECT (threshold->>'min_days_between')::int
                        FROM public.notification_rules
                       WHERE event_type = 'promo.broadcast'), 0);

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
           WHEN v_ngay > 0 AND NOT p_bypass_cooldown AND EXISTS (
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

COMMENT ON FUNCTION public.fn_promo_recipients(UUID,UUID[],JSONB,BOOLEAN) IS
  'Danh sách nhận tin khuyến mãi. min_days_between <= 0 ⇒ không chặn theo tần suất (user chốt 08/08/2026).';
