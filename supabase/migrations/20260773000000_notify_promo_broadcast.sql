-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — ĐỢT E: PHÁT TIN KHUYẾN MÃI
-- 2026-08-07
--
-- User: "thêm 1 nút gửi vào nhóm telegram trong chương trình khuyến mãi".
--
-- ⚠️ Module khuyến mãi ĐÃ CÓ SẴN và rất đầy đủ (`promotions`: discount_type,
--    valid_from/to, branch_ids, buy_x/get_y, combo_price, tiers,
--    customer_tiers, priority). KHÔNG xây lại — chỉ thêm lớp phát tin.
--
-- ── Ba việc migration này làm ──────────────────────────────────────────
-- ① TÁCH TRẦN TỐC ĐỘ: trần cũ `per_run_cap = 5` là "5 tin mỗi lượt drain",
--    đặt ra cho trường hợp gửi vào MỘT nhóm (Telegram chặn ~20 tin/phút/nhóm).
--    Nhưng broadcast gửi tới N nhóm KHÁC NHAU thì trần đó không áp dụng —
--    giới hạn thật khi ấy là ~30 tin/giây trên toàn bot.
--    Giữ nguyên trần 5 tin/lượt cho MỖI CHAT, thêm trần tổng `per_run_total`
--    = 20 tin/lượt. Với cron 15 giây ⇒ 80 tin/phút trên các nhóm khác nhau,
--    vẫn thấp hơn trần Telegram rất xa. Broadcast 50 nhóm xong trong ~40 giây
--    thay vì 2,5 phút.
--
-- ② ẢNH: `sendPhoto` với chú thích. Telegram giới hạn chú thích 1024 ký tự
--    (tin chữ là 4096) ⇒ nội dung dài quá thì tự bỏ ảnh, gửi dạng chữ.
--    Ảnh lấy từ `promotions.telegram_banner_url`, không có thì lấy ảnh đầu
--    tiên của sản phẩm được khuyến mãi (`products.image_urls`).
--
-- ③ CHỐNG PHIỀN: đây là rủi ro lớn nhất của tính năng này. Khách bị dội quảng
--    cáo sẽ tắt tiếng hoặc rời nhóm — và mất luôn tin hoá đơn lẫn nhắc vaccine,
--    tức là mất cái giá trị nhất để đổi lấy cái ít giá trị nhất.
--    ⇒ Trần cứng **1 tin khuyến mãi / khách / 7 ngày**, cài trong hàm chứ
--      không dựa vào tự giác.
--    ⇒ Tôn trọng `customers.telegram_promo_optout`.
--    ⇒ `quiet_hours = true` cho riêng loại này (khuyến mãi không gửi ban đêm),
--      khác với tin nghiệp vụ vốn đã tắt giờ im lặng.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS telegram_banner_url TEXT;

COMMENT ON COLUMN public.promotions.telegram_banner_url IS
  'Ảnh kèm khi phát tin Telegram. Bỏ trống thì tự lấy ảnh sản phẩm đầu tiên trong CT.';

UPDATE public.system_settings
   SET value = value || jsonb_build_object('per_run_total', 20), updated_at = now()
 WHERE key = 'notification_config';

INSERT INTO public.notification_rules
  (event_type, label, severity, channel_code, audience, compose,
   batch_window_sec, delay_sec, min_interval_sec, daily_cap, quiet_hours, threshold)
VALUES
  ('promo.broadcast', 'Khuyến mãi gửi khách', 'info', '@customer',
   'customer', 'full', 0, 0, 0, 1000000, true, '{"min_days_between": 7}')
ON CONFLICT (event_type) DO UPDATE
  SET audience='customer', compose='full', channel_code='@customer',
      quiet_hours=true, enabled=true, updated_at=now();

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_tg_send_photo — gửi ảnh kèm chú thích
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_tg_send_photo(
  p_chat_id     TEXT,
  p_photo_url   TEXT,
  p_caption     TEXT,
  p_event_type  TEXT DEFAULT NULL,
  p_branch_id   UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_event_ids   BIGINT[] DEFAULT '{}',
  p_subject_key TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault','net'
AS $$
DECLARE
  v_token TEXT; v_req BIGINT; v_log BIGINT;
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

  SELECT net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendPhoto',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('chat_id', p_chat_id, 'photo', p_photo_url,
                                  'caption', p_caption, 'parse_mode', 'HTML')
  ) INTO v_req;

  UPDATE public.notification_log
     SET req_id=v_req, attempts=attempts+1, last_try_at=now() WHERE id=v_log;
  RETURN v_log;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_promo_message — soạn nội dung tin khuyến mãi
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_promo_message(p_promotion_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  p      RECORD;
  v_uu   TEXT;
  v_sp   TEXT;
  v_qua  TEXT;
BEGIN
  SELECT * INTO p FROM public.promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_uu := CASE p.discount_type
    WHEN 'percent'      THEN 'Giảm <b>' || trim(to_char(p.discount_value,'FM999990.99')) || '%</b>'
    WHEN 'fixed_amount' THEN 'Giảm <b>' || public.fn_notify_vnd(p.discount_value) || '</b>'
    WHEN 'buy_x_get_y'  THEN 'Mua <b>' || p.buy_x_qty || '</b> tặng <b>' || p.get_y_qty || '</b>'
    WHEN 'combo_price'  THEN 'Giá combo <b>' || public.fn_notify_vnd(p.combo_price) || '</b>'
    WHEN 'tiered_quantity'        THEN 'Mua càng nhiều giảm càng sâu'
    WHEN 'customer_tier_discount' THEN 'Ưu đãi riêng theo hạng khách hàng'
    ELSE 'Ưu đãi đặc biệt' END;

  SELECT name INTO v_qua FROM public.products WHERE id = p.get_y_product_id;

  SELECT string_agg('· ' || public.fn_tg_escape(pr.name), E'\n')
    INTO v_sp
  FROM (SELECT product_id FROM public.product_promotions
         WHERE promotion_id = p_promotion_id LIMIT 12) x
  JOIN public.products pr ON pr.id = x.product_id;

  RETURN '🎁 <b>KHUYẾN MÃI</b>'
      || E'\n<b>' || public.fn_tg_escape(p.name) || '</b>'
      || COALESCE(E'\n\n' || public.fn_tg_escape(p.description), '')
      || E'\n\n💰 ' || v_uu
      || COALESCE(' — tặng ' || public.fn_tg_escape(v_qua), '')
      || CASE WHEN COALESCE(p.min_order_amount,0) > 0
              THEN E'\n🛒 Đơn tối thiểu: ' || public.fn_notify_vnd(p.min_order_amount)
              ELSE '' END
      || COALESCE(E'\n\n📦 <b>Sản phẩm áp dụng</b>\n' || v_sp, '')
      || CASE WHEN p.valid_to IS NOT NULL
              THEN E'\n\n📅 Áp dụng đến hết ' || to_char(p.valid_to,'DD/MM/YYYY')
              ELSE '' END
      || E'\n\n<i>Liên hệ Sanh Long Vetco để được tư vấn.</i>';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- fn_promo_broadcast — nút "Gửi vào nhóm Telegram"
-- ═══════════════════════════════════════════════════════════════════════════
-- p_mode:
--   'preview' — chỉ trả về nội dung + danh sách nhóm sẽ nhận, KHÔNG gửi gì
--   'test'    — gửi đúng 1 bản vào nhóm nội bộ để xem bằng mắt
--   'send'    — phát thật tới các nhóm khách đủ điều kiện
CREATE OR REPLACE FUNCTION public.fn_promo_broadcast(
  p_promotion_id UUID,
  p_mode         TEXT DEFAULT 'preview'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  p        RECORD;
  v_text   TEXT;
  v_photo  TEXT;
  v_ngay   INTEGER;
  v_n      INTEGER := 0;
  v_bo_qua INTEGER := 0;
  v_ds     JSONB;
  r        RECORD;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được phát tin khuyến mãi';
  END IF;

  SELECT * INTO p FROM public.promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'loi', 'Không thấy chương trình'); END IF;

  v_text := public.fn_promo_message(p_promotion_id);

  -- Ảnh: ưu tiên banner, không có thì lấy ảnh SP đầu tiên trong chương trình.
  v_photo := NULLIF(p.telegram_banner_url, '');
  IF v_photo IS NULL THEN
    SELECT pr.image_urls[1] INTO v_photo
      FROM public.product_promotions pp
      JOIN public.products pr ON pr.id = pp.product_id
     WHERE pp.promotion_id = p_promotion_id
       AND pr.image_urls IS NOT NULL AND array_length(pr.image_urls,1) > 0
     LIMIT 1;
  END IF;
  -- Chú thích ảnh Telegram tối đa 1024 ký tự; dài hơn thì bỏ ảnh, gửi chữ.
  IF v_photo IS NOT NULL AND length(v_text) > 1000 THEN v_photo := NULL; END IF;

  v_ngay := COALESCE((SELECT (threshold->>'min_days_between')::int
                        FROM public.notification_rules
                       WHERE event_type='promo.broadcast'), 7);

  -- Nhóm khách đủ điều kiện nhận
  SELECT coalesce(jsonb_agg(jsonb_build_object('ten', farm_name, 'ma', code)), '[]'::jsonb),
         count(*)
    INTO v_ds, v_n
  FROM public.customers c
  WHERE c.telegram_chat_id IS NOT NULL
    AND c.telegram_enabled = true
    AND c.telegram_promo_optout = false
    AND c.merged_into_id IS NULL
    -- Trần cứng: mỗi khách tối đa 1 tin khuyến mãi trong v_ngay ngày.
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_log l
       WHERE l.customer_id = c.id AND l.event_type = 'promo.broadcast'
         AND l.status <> 'skipped'
         AND l.created_at > now() - (interval '1 day' * v_ngay));

  SELECT count(*) INTO v_bo_qua FROM public.customers c
   WHERE c.telegram_chat_id IS NOT NULL AND c.merged_into_id IS NULL
     AND (c.telegram_enabled = false OR c.telegram_promo_optout = true
          OR EXISTS (SELECT 1 FROM public.notification_log l
                      WHERE l.customer_id = c.id AND l.event_type='promo.broadcast'
                        AND l.status <> 'skipped'
                        AND l.created_at > now() - (interval '1 day' * v_ngay)));

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('ok', true, 'che_do','preview', 'noi_dung', v_text,
      'anh', v_photo, 'so_nhom_nhan', v_n, 'so_nhom_bo_qua', v_bo_qua, 'danh_sach', v_ds);
  END IF;

  IF p_mode = 'test' THEN
    PERFORM public.fn_tg_send(
      '🧪 <b>XEM THỬ KHUYẾN MÃI</b> — chưa gửi cho khách' || E'\n────────────────\n' || v_text,
      'tong_hop', 'promo.test', NULL, '{}');
    RETURN jsonb_build_object('ok', true, 'che_do','test', 'so_nhom_nhan', v_n,
      'ghi_chu', 'Đã gửi bản xem thử vào nhóm nội bộ');
  END IF;

  -- ── Phát thật ────────────────────────────────────────────────────────
  FOR r IN
    SELECT c.id FROM public.customers c
    WHERE c.telegram_chat_id IS NOT NULL AND c.telegram_enabled = true
      AND c.telegram_promo_optout = false AND c.merged_into_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log l
         WHERE l.customer_id = c.id AND l.event_type='promo.broadcast'
           AND l.status <> 'skipped'
           AND l.created_at > now() - (interval '1 day' * v_ngay))
  LOOP
    PERFORM public.fn_notify_emit('promo.broadcast', NULL,
      jsonb_build_object('text', v_text, 'photo', v_photo,
                         'line', 'KM: ' || p.name),
      'promo:' || p_promotion_id || ':' || r.id,
      r.id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'che_do','send', 'da_xep_hang', v_n,
    'bo_qua', v_bo_qua,
    'ghi_chu', 'Tin sẽ đi trong vòng ~15 giây mỗi lượt, tối đa 20 nhóm/lượt');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_promo_broadcast(UUID,TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_promo_broadcast(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_promo_message(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_send_photo(TEXT,TEXT,TEXT,TEXT,UUID,UUID,BIGINT[],TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
