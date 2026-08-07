-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — VÁ NHÃN CỤT VÀ SỐ PHẦN TRĂM THỪA DẤU CHẤM
-- 2026-08-07
--
-- ── Lỗi 1: NHÃN CỤT — xuyên suốt MỌI loại tin ──────────────────────────
-- Tin khuyến mãi thử ra: `💰 Giảm <b>10.%</b> — tặng ` — vế "tặng" trống trơ.
--
-- Gốc: `fn_tg_escape()` đang trả **chuỗi rỗng** khi nhận NULL
-- (`COALESCE(p_text,'')`). Trong khi mọi trigger đều dùng mẫu:
--     COALESCE(' — kho ' || fn_tg_escape(v_kho), '')
-- Mẫu này trông cậy vào việc `text || NULL = NULL` để cả cụm biến mất khi
-- không có dữ liệu. Nhưng escape đã biến NULL thành '' ⇒ phép nối ra
-- `' — kho '` ⇒ **nhãn hiện ra mà không có giá trị đi kèm**.
--
-- Đếm sơ trong 4 trigger có ít nhất 12 chỗ dùng mẫu này: kho, nhà cung cấp,
-- người thực hiện, ghi chú, lý do, lô, chi nhánh nguồn/đích… Đơn nào thiếu
-- một trường là tin có một nhãn cụt.
--
-- ⇒ Sửa tại gốc: `fn_tg_escape(NULL)` trả về **NULL**. Mọi chỗ cố ý muốn
--   chuỗi rỗng đều đã tự bọc `COALESCE(giá_trị,'…')` TRƯỚC khi escape nên
--   không bị ảnh hưởng.
--
-- ── Lỗi 2: `10.%` ──────────────────────────────────────────────────────
-- `to_char(10,'FM999990.99')` → `'10.'` — FM bỏ số 0 thừa nhưng GIỮ dấu chấm.
-- Dùng luôn `fn_notify_qty()` đã có: 10 → "10", 7.5 → "7,5".
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_tg_escape(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  -- NULL vào thì NULL ra, để mẫu COALESCE('nhãn ' || escape(x), '') hoạt động.
  SELECT CASE WHEN p_text IS NULL THEN NULL
              ELSE replace(replace(replace(p_text,'&','&amp;'),'<','&lt;'),'>','&gt;') END;
$$;

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
      || CASE WHEN p.valid_to IS NOT NULL
              THEN E'\n\n📅 Áp dụng đến hết ' || to_char(p.valid_to,'DD/MM/YYYY')
              ELSE '' END
      || E'\n\n<i>Liên hệ Sanh Long Vetco để được tư vấn.</i>';
END;
$$;

NOTIFY pgrst, 'reload schema';
