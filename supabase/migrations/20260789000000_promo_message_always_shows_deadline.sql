-- ═══════════════════════════════════════════════════════════════════════════
-- TIN KHUYẾN MÃI LUÔN CÓ DÒNG HẠN ÁP DỤNG
-- 2026-08-08
--
-- User: "chỉ cần nhắn tin và ngày hết hạn khuyến mãi là được, thông thường
-- chương trình khuyến mãi kéo dài."
--
-- ── Cái đã đúng sẵn ────────────────────────────────────────────────────
-- `fn_promo_message` đã in "📅 Áp dụng đến hết DD/MM/YYYY" — không phải làm gì.
--
-- ── Cái còn hở ─────────────────────────────────────────────────────────
-- Dòng đó nằm trong `CASE WHEN p.valid_to IS NOT NULL … ELSE '' END`. Chương
-- trình **để trống ngày kết thúc** — đúng kiểu "chương trình kéo dài" mà user
-- vừa mô tả — sẽ ra tin **không có một chữ nào về hạn**. Khách đọc xong không
-- biết ưu đãi còn hiệu lực tới bao giờ, mà đây lại chính là thông tin user
-- nói là cần.
--
-- ⇒ Không còn nhánh rỗng: có ngày thì in ngày, không có ngày thì nói thẳng
--   "đến khi có thông báo mới". Dù thế nào tin cũng trả lời được câu hỏi
--   "còn áp dụng không".
--
-- Giữ nguyên mọi phần khác của tin.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_promo_message(p_promotion_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  p RECORD; v_uu TEXT; v_sp TEXT; v_qua TEXT; v_so INTEGER;
BEGIN
  SELECT * INTO p FROM public.promotions WHERE id = p_promotion_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_uu := CASE p.discount_type
    WHEN 'percent'      THEN 'Giảm <b>' || public.fn_notify_qty(p.discount_value) || '%</b>'
    WHEN 'fixed_amount' THEN 'Giảm <b>' || public.fn_notify_vnd(p.discount_value) || '</b>'
    WHEN 'buy_x_get_y'  THEN 'Mua <b>' || p.buy_x_qty || '</b> tặng <b>' || p.get_y_qty || '</b>'
    WHEN 'combo_price'  THEN 'Giá combo <b>' || public.fn_notify_vnd(p.combo_price) || '</b>'
    WHEN 'tiered_quantity'        THEN 'Mua càng nhiều giảm càng sâu'
    WHEN 'customer_tier_discount' THEN 'Ưu đãi riêng theo hạng khách hàng'
    ELSE 'Ưu đãi đặc biệt' END;

  SELECT name INTO v_qua FROM public.products WHERE id = p.get_y_product_id;

  SELECT jsonb_array_length(COALESCE(p.applies_to->'product_ids','[]'::jsonb)) INTO v_so;

  IF COALESCE(v_so,0) > 0 THEN
    SELECT string_agg('· ' || public.fn_tg_escape(pr.name), E'\n') INTO v_sp
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
      -- Không còn nhánh rỗng: chương trình dài ngày để trống `valid_to` vẫn
      -- phải nói được là còn hiệu lực.
      || CASE WHEN p.valid_to IS NOT NULL
              THEN E'\n\n📅 Áp dụng đến hết <b>' || to_char(p.valid_to,'DD/MM/YYYY') || '</b>'
              ELSE E'\n\n📅 Áp dụng <b>đến khi có thông báo mới</b>'
              END
      || E'\n\n<i>Liên hệ Sanh Long Vetco để được tư vấn.</i>';
END;
$$;

NOTIFY pgrst, 'reload schema';
