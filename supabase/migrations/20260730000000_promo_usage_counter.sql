-- ============================================================
-- Migration: Đếm lượt dùng khuyến mãi & voucher
-- File: 20260730000000_promo_usage_counter.sql
--
-- BỐI CẢNH LỖI:
--   `promotions.current_uses` và `vouchers.current_uses` có cột từ đầu nhưng
--   KHÔNG BAO GIỜ được tăng — không ở frontend, không ở RPC bán hàng.
--   Hệ quả: voucher đặt "max_uses = 1" vẫn dùng được vô hạn lần, và ô
--   "Số lần dùng tối đa" của KM hoàn toàn vô nghĩa.
--
-- CÁCH SỬA:
--   RPC `fn_consume_promo_usage` — tăng lượt dùng có khoá hàng (atomic),
--   chặn khi đã hết lượt. POS gọi ngay sau khi chốt đơn thành công.
--
-- HẠN CHẾ CÒN LẠI (Đợt 3 sẽ xử lý):
--   Đơn hàng chưa lưu `promotion_id`/`voucher_id` nên chưa hoàn được lượt
--   dùng khi huỷ đơn / trả hàng. Việc đếm chạy sau khi đơn đã tạo — nếu bước
--   này lỗi, đơn vẫn tồn tại (POS sẽ cảnh báo cho nhân viên biết).
--
-- ⚠️ Chạy thủ công qua Supabase SQL Editor (KHÔNG dùng `supabase db push`).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_consume_promo_usage(
  p_promotion_id UUID DEFAULT NULL,
  p_voucher_id   UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max  INTEGER;
  v_cur  INTEGER;
BEGIN
  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Tài khoản không hoạt động';
  END IF;

  -- ── Khuyến mãi (max_uses NULL = không giới hạn) ──
  IF p_promotion_id IS NOT NULL THEN
    SELECT max_uses, current_uses INTO v_max, v_cur
    FROM public.promotions
    WHERE id = p_promotion_id
    FOR UPDATE;                       -- khoá hàng: 2 quầy chốt đơn cùng lúc không đếm hụt

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khuyến mãi không tồn tại';
    END IF;

    IF v_max IS NOT NULL AND v_cur >= v_max THEN
      RAISE EXCEPTION 'Khuyến mãi đã hết lượt sử dụng (%/%)', v_cur, v_max;
    END IF;

    UPDATE public.promotions
    SET current_uses = current_uses + 1,
        -- Hết lượt thì tự tắt để POS/danh sách không còn gợi ý.
        is_active    = CASE WHEN v_max IS NOT NULL AND v_cur + 1 >= v_max THEN false ELSE is_active END,
        updated_at   = now()
    WHERE id = p_promotion_id;
  END IF;

  -- ── Voucher (max_uses NOT NULL, mặc định 1) ──
  IF p_voucher_id IS NOT NULL THEN
    SELECT max_uses, current_uses INTO v_max, v_cur
    FROM public.vouchers
    WHERE id = p_voucher_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Voucher không tồn tại';
    END IF;

    IF v_cur >= v_max THEN
      RAISE EXCEPTION 'Voucher đã dùng hết lượt (%/%)', v_cur, v_max;
    END IF;

    UPDATE public.vouchers
    SET current_uses = current_uses + 1,
        is_active    = CASE WHEN v_cur + 1 >= v_max THEN false ELSE is_active END,
        updated_at   = now()
    WHERE id = p_voucher_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_consume_promo_usage IS
  'Tăng lượt dùng KM/voucher (atomic, có FOR UPDATE). Chặn khi hết lượt và tự tắt khi chạm max_uses.';

REVOKE ALL ON FUNCTION public.fn_consume_promo_usage(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_consume_promo_usage(UUID, UUID) TO authenticated;

-- PostgREST cache schema: bắt buộc, nếu không frontend vẫn không thấy object mới.
NOTIFY pgrst, 'reload schema';
