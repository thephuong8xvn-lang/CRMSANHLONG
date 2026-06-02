-- ============================================================
-- 20260614000000_collect_customer_debt_rpc.sql
-- Thu công nợ khách hàng NGUYÊN TỬ (atomic): ghi tiền vào sổ quỹ
-- ĐỒNG THỜI giảm công nợ trong cùng 1 transaction.
--
-- Bối cảnh / lý do:
--   Trước đây luồng "Thu công nợ KH" chỉ INSERT debt_payments → trigger
--   fn_cashbook_from_debt_payment (20260531000001) tự sinh phiếu thu sổ quỹ
--   + cộng số dư + gắn session_id, NHƯNG KHÔNG settle customer_debts.
--   Vì customer_summary_view.total_debt = SUM(customer_debts.amount
--   WHERE is_settled=false) → tiền vào quỹ đúng nhưng công nợ KH không giảm
--   → lệch số liệu nghiêm trọng.
--
--   RPC này khắc phục: (1) ghi debt_payments (trigger lo sổ quỹ),
--   (2) phân bổ FIFO settle customer_debts, (3) thu vượt → ghi khoản
--   "Khách trả trước" (advance_from_customer, amount âm) để tự khấu trừ
--   (netting) ở các giao dịch sau.
--
--   Quyền: chỉ admin/ceo/accountant/branch_manager (khớp RLS hiện tại của
--   debt_payments + customer_debts). Kiểm tra server-side vì SECURITY DEFINER
--   bypass RLS.
-- ⚠️ Chạy thủ công qua Supabase SQL Editor / `supabase db push` (cần token).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_collect_customer_debt(
  p_customer_id UUID,
  p_amount      NUMERIC,
  p_method      order_payment_method,
  p_date        DATE,
  p_reference   TEXT,
  p_notes       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_payment_id UUID;
  v_remaining  NUMERIC(15,2);
  v_new_total  NUMERIC(15,2);
  v_exists     BOOLEAN;
  r            RECORD;
BEGIN
  -- 1. Phân quyền (server-side — SECURITY DEFINER bỏ qua RLS)
  IF NOT (public.fn_is_active()
          AND (public.fn_is_admin()
               OR public.fn_has_role('accountant')
               OR public.fn_has_role('branch_manager'))) THEN
    RAISE EXCEPTION 'Không có quyền thu công nợ khách hàng.';
  END IF;

  -- 2. Validate
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Số tiền thu phải lớn hơn 0.';
  END IF;
  IF p_method NOT IN ('cash', 'bank_transfer', 'card_pos') THEN
    RAISE EXCEPTION 'Hình thức thu không hợp lệ (chỉ tiền mặt / chuyển khoản / quẹt thẻ).';
  END IF;
  IF COALESCE(p_date, CURRENT_DATE) > CURRENT_DATE THEN
    RAISE EXCEPTION 'Ngày thu không được ở tương lai.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Khách hàng không tồn tại.';
  END IF;

  -- 3. Ghi tiền vào sổ quỹ qua debt_payments
  --    → trigger trg_debt_payment_cashbook tự sinh phiếu thu THU-NO,
  --      cộng số dư quỹ/TK, gắn session_id ca (nếu tiền mặt).
  INSERT INTO public.debt_payments (
    customer_id, amount, payment_method, payment_date, reference_no, notes, recorded_by
  ) VALUES (
    p_customer_id, p_amount, p_method, COALESCE(p_date, CURRENT_DATE),
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Thu công nợ khách hàng'),
    v_uid
  )
  RETURNING id INTO v_payment_id;

  -- 4. Phân bổ FIFO: settle các dòng nợ dương (cũ nhất / đến hạn trước → trước)
  v_remaining := p_amount;
  FOR r IN
    SELECT id, amount
    FROM public.customer_debts
    WHERE customer_id = p_customer_id
      AND is_settled = false
      AND amount > 0
    ORDER BY due_date NULLS LAST, created_at
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    IF v_remaining >= r.amount THEN
      UPDATE public.customer_debts
      SET is_settled = true, settled_at = now()
      WHERE id = r.id;
      v_remaining := v_remaining - r.amount;
    ELSE
      -- Settle dở dòng biên: giảm số dư dòng nợ, giữ chưa tất toán
      UPDATE public.customer_debts
      SET amount = amount - v_remaining
      WHERE id = r.id;
      v_remaining := 0;
    END IF;
  END LOOP;

  -- 5. Thu vượt công nợ → ghi nhận "Khách trả trước" (amount âm)
  IF v_remaining > 0 THEN
    INSERT INTO public.customer_debts (
      customer_id, order_id, debt_type, amount, due_date, is_settled, notes, created_by
    ) VALUES (
      p_customer_id, NULL, 'advance_from_customer', -v_remaining, NULL, false,
      'Khách trả trước (thu vượt công nợ'
        || COALESCE(' — ' || NULLIF(TRIM(COALESCE(p_reference, '')), ''), '') || ')',
      v_uid
    );
  END IF;

  -- 6. Tổng nợ còn lại sau khi thu
  SELECT COALESCE(SUM(amount), 0)::NUMERIC(15,2) INTO v_new_total
  FROM public.customer_debts
  WHERE customer_id = p_customer_id AND is_settled = false;

  RETURN jsonb_build_object(
    'payment_id',    v_payment_id,
    'collected',     p_amount,
    'advance',       v_remaining,
    'new_total_debt', v_new_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_collect_customer_debt(UUID, NUMERIC, order_payment_method, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_collect_customer_debt(UUID, NUMERIC, order_payment_method, DATE, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.fn_collect_customer_debt(UUID, NUMERIC, order_payment_method, DATE, TEXT, TEXT) IS
'Thu công nợ KH nguyên tử: ghi debt_payments (trigger sinh phiếu thu sổ quỹ) + settle FIFO customer_debts + thu vượt→advance_from_customer. Quyền: admin/ceo/accountant/branch_manager.';
