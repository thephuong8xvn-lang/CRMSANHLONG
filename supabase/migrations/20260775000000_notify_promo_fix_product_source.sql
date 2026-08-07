-- ═══════════════════════════════════════════════════════════════════════════
-- KHUYẾN MÃI — LẤY SẢN PHẨM TỪ ĐÚNG NGUỒN
-- 2026-08-07
--
-- ── Sai ở đâu ───────────────────────────────────────────────────────────
-- `20260773` cho rằng `product_promotions` là bảng nối của `promotions`.
-- KHÔNG PHẢI. Đây là **hai hệ khuyến mãi song song, không biết đến nhau**:
--   • `promotions`         — KM cấp ĐƠN, danh sách SP nằm trong
--                            `applies_to` jsonb dạng `{"product_ids":[…]}`
--   • `product_promotions` — KM cấp SẢN PHẨM, bảng độc lập, mỗi dòng một
--                            `product_id` riêng, KHÔNG có cột `promotion_id`
--
-- Hậu quả: `fn_promo_message` ném lỗi `column "promotion_id" does not exist`
-- ngay lần gọi đầu tiên.
--
-- ⇒ Đọc từ `applies_to->'product_ids'`. Danh sách rỗng nghĩa là áp dụng cho
--   toàn bộ sản phẩm — nói rõ điều đó trong tin thay vì để trống.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_promo_message(p_promotion_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  p     RECORD;
  v_uu  TEXT;
  v_sp  TEXT;
  v_qua TEXT;
  v_so  INTEGER;
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

  SELECT jsonb_array_length(COALESCE(p.applies_to->'product_ids','[]'::jsonb)) INTO v_so;

  IF COALESCE(v_so,0) > 0 THEN
    SELECT string_agg('· ' || public.fn_tg_escape(pr.name), E'\n')
      INTO v_sp
    FROM (SELECT value::uuid AS pid
            FROM jsonb_array_elements_text(p.applies_to->'product_ids') AS t(value)
           LIMIT 12) x
    JOIN public.products pr ON pr.id = x.pid;
  END IF;

  RETURN '🎁 <b>KHUYẾN MÃI</b>'
      || E'\n<b>' || public.fn_tg_escape(p.name) || '</b>'
      || COALESCE(E'\n\n' || public.fn_tg_escape(p.description), '')
      || E'\n\n💰 ' || v_uu
      || COALESCE(' — tặng ' || public.fn_tg_escape(v_qua), '')
      || CASE WHEN COALESCE(p.min_order_amount,0) > 0
              THEN E'\n🛒 Đơn tối thiểu: ' || public.fn_notify_vnd(p.min_order_amount)
              ELSE '' END
      || CASE WHEN COALESCE(v_so,0) = 0
              THEN E'\n📦 Áp dụng cho <b>toàn bộ sản phẩm</b>'
              ELSE COALESCE(E'\n\n📦 <b>Sản phẩm áp dụng</b>\n' || v_sp, '')
                   || CASE WHEN v_so > 12 THEN E'\n… và ' || (v_so-12) || ' sản phẩm khác'
                           ELSE '' END
              END
      || CASE WHEN p.valid_to IS NOT NULL
              THEN E'\n\n📅 Áp dụng đến hết ' || to_char(p.valid_to,'DD/MM/YYYY')
              ELSE '' END
      || E'\n\n<i>Liên hệ Sanh Long Vetco để được tư vấn.</i>';
END;
$$;

-- Ảnh minh hoạ cũng phải lấy từ đúng nguồn.
CREATE OR REPLACE FUNCTION public.fn_promo_photo(p_promotion_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE p RECORD; v_photo TEXT;
BEGIN
  SELECT * INTO p FROM public.promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_photo := NULLIF(p.telegram_banner_url, '');
  IF v_photo IS NOT NULL THEN RETURN v_photo; END IF;

  SELECT pr.image_urls[1] INTO v_photo
  FROM jsonb_array_elements_text(COALESCE(p.applies_to->'product_ids','[]'::jsonb)) AS t(value)
  JOIN public.products pr ON pr.id = t.value::uuid
  WHERE pr.image_urls IS NOT NULL AND array_length(pr.image_urls,1) > 0
  LIMIT 1;

  RETURN v_photo;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_promo_broadcast(
  p_promotion_id UUID,
  p_mode         TEXT DEFAULT 'preview'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  p RECORD; v_text TEXT; v_photo TEXT; v_ngay INTEGER;
  v_n INTEGER := 0; v_bo_qua INTEGER := 0; v_ds JSONB; r RECORD;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ quản trị được phát tin khuyến mãi';
  END IF;

  SELECT * INTO p FROM public.promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'loi', 'Không thấy chương trình');
  END IF;

  v_text  := public.fn_promo_message(p_promotion_id);
  v_photo := public.fn_promo_photo(p_promotion_id);
  -- Telegram giới hạn chú thích ảnh 1024 ký tự (tin chữ 4096).
  IF v_photo IS NOT NULL AND length(v_text) > 1000 THEN v_photo := NULL; END IF;

  v_ngay := COALESCE((SELECT (threshold->>'min_days_between')::int
                        FROM public.notification_rules
                       WHERE event_type='promo.broadcast'), 7);

  SELECT coalesce(jsonb_agg(jsonb_build_object('ten', farm_name, 'ma', code)), '[]'::jsonb),
         count(*)
    INTO v_ds, v_n
  FROM public.customers c
  WHERE c.telegram_chat_id IS NOT NULL AND c.telegram_enabled = true
    AND c.telegram_promo_optout = false AND c.merged_into_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_log l
       WHERE l.customer_id = c.id AND l.event_type='promo.broadcast'
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
      jsonb_build_object('text', v_text, 'photo', v_photo, 'line', 'KM: ' || p.name),
      'promo:' || p_promotion_id || ':' || r.id, r.id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'che_do','send', 'da_xep_hang', v_n,
    'bo_qua', v_bo_qua,
    'ghi_chu', 'Tin đi trong ~15 giây mỗi lượt, tối đa 20 nhóm mỗi lượt');
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_promo_message(UUID)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_promo_photo(UUID)    TO authenticated;
REVOKE ALL ON FUNCTION public.fn_promo_broadcast(UUID,TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_promo_broadcast(UUID,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
