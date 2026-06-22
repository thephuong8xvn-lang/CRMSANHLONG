-- ============================================================
-- Migration: gdrive_lot_dedup
-- File: 20260711000000_gdrive_lot_dedup.sql
-- Mục đích: Chống nhập trùng lô khi nhập hàng từ Google Drive.
--   2 nhân viên có thể cùng nhập 1 lô khi chưa liên hệ → cần phát hiện
--   lô ĐÃ tồn tại để cảnh báo trước khi tạo phiếu.
--
--   Tiêu chí trùng = cùng SP + cùng Số lô + cùng HSD (khó trùng nhầm),
--   đối chiếu TOÀN HỆ THỐNG (mọi chi nhánh):
--     (a) tồn kho thật (stock_lots — phiếu đã hoàn thành), và
--     (b) phiếu nhập đang chờ (goods_receipts status draft|verified).
--
--   RPC SECURITY DEFINER để thấy xuyên chi nhánh (RLS không che mất cảnh
--   báo); chỉ trả existence + mã phiếu + tên NV lập (phục vụ phối hợp kho).
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload
--    schema + chèn tracking row vào supabase_migrations.schema_migrations.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_check_existing_lots(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result   JSONB := '[]'::jsonb;
  v_elem     JSONB;
  v_pid      UUID;
  v_lot      TEXT;
  v_exp      DATE;
  v_stock    RECORD;
  v_draft    RECORD;
  v_in_stock BOOLEAN;
  v_in_draft BOOLEAN;
BEGIN
  IF NOT public.fn_is_active() THEN RAISE EXCEPTION 'Tài khoản không hoạt động.'; END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'p_items phải là JSON array.'; END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := NULLIF(v_elem->>'product_id','')::UUID;
    v_lot := NULLIF(btrim(v_elem->>'lot_number'),'');
    v_exp := NULLIF(v_elem->>'expiry_date','')::DATE;
    -- Cần đủ SP + lô + HSD mới đối chiếu (đúng tiêu chí trùng đã chốt)
    IF v_pid IS NULL OR v_lot IS NULL OR v_exp IS NULL THEN CONTINUE; END IF;

    -- (a) Đã ở trong kho (lô thật)
    SELECT w.name AS warehouse_name INTO v_stock
    FROM public.stock_lots sl
    JOIN public.warehouses w ON w.id = sl.warehouse_id
    WHERE sl.product_id = v_pid
      AND btrim(sl.lot_number) = v_lot
      AND sl.expiry_date = v_exp
    ORDER BY sl.quantity_on_hand DESC
    LIMIT 1;
    v_in_stock := FOUND;

    -- (b) Đang ở phiếu nhập chờ (draft/verified)
    SELECT gr.receipt_code, gr.status, p.full_name AS by_name INTO v_draft
    FROM public.goods_receipt_lines gl
    JOIN public.goods_receipts gr ON gr.id = gl.receipt_id
    LEFT JOIN public.profiles p ON p.id = gr.received_by
    WHERE gl.product_id = v_pid
      AND btrim(gl.lot_number) = v_lot
      AND gl.expiry_date = v_exp
      AND gr.status IN ('draft','verified')
    ORDER BY gr.created_at DESC
    LIMIT 1;
    v_in_draft := FOUND;

    IF v_in_stock OR v_in_draft THEN
      v_result := v_result || jsonb_build_object(
        'product_id',         v_pid,
        'lot_number',         v_lot,
        'expiry_date',        v_exp,
        'in_stock',           v_in_stock,
        'stock_warehouse',    CASE WHEN v_in_stock THEN v_stock.warehouse_name ELSE NULL END,
        'in_draft',           v_in_draft,
        'draft_receipt_code', CASE WHEN v_in_draft THEN v_draft.receipt_code ELSE NULL END,
        'draft_status',       CASE WHEN v_in_draft THEN v_draft.status ELSE NULL END,
        'draft_by',           CASE WHEN v_in_draft THEN v_draft.by_name ELSE NULL END
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_check_existing_lots(JSONB) TO authenticated;
