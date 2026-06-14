-- ============================================================
-- 20260705000000_purchase_return_finance.sql
-- #3 — Mặt TÀI CHÍNH của phiếu trả hàng NCC (hạch toán chuẩn kế toán, user duyệt).
--   Ghi cùng thời điểm xuất kho (khi rời 'draft' sang confirmed/completed):
--     • refund_method = credit_note | next_po_offset → GIẢM công nợ phải trả
--       NCC (suppliers.current_debt_payable -= total_amount).
--     • refund_method = cash_refund → ghi THU sổ quỹ (cashbook inflow) vào quỹ
--       tiền mặt mặc định của chi nhánh người tạo, KHÔNG gắn session ca; KHÔNG
--       đụng công nợ.
--   Hủy phiếu đã ghi (confirmed/completed → cancelled) → ĐẢO NGƯỢC tương ứng
--   (cộng lại công nợ / ghi CHI hoàn lại tiền).
-- Mặt tồn kho do trigger fn_auto_stock_on_purchase_return_confirm (20260704) lo.
-- ⚠️ Apply remote qua Management API + reload schema.
-- ============================================================

-- 1. Danh mục thu/chi cho hoàn NCC (expense_categories dùng chung, phân theo flow_type)
INSERT INTO public.expense_categories (id, code, name, flow_type, is_active) VALUES
  ('e0e00001-0000-0000-0000-000000000015', 'THU-HOAN-NCC', 'Hoàn tiền trả hàng NCC', 'inflow',  true),
  ('e0e00001-0000-0000-0000-000000000016', 'CHI-HOAN-NCC', 'Đảo thu hoàn NCC (hủy phiếu trả)', 'outflow', true)
ON CONFLICT (code) DO NOTHING;

-- 2. Trigger tài chính trả NCC
CREATE OR REPLACE FUNCTION public.fn_finance_on_purchase_return()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch    UUID;
  v_cash_fund UUID;
  v_cat       UUID;
  v_total     NUMERIC := COALESCE(NEW.total_amount, 0);
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- ── GHI khi rời 'draft' sang confirmed/completed (cùng điểm xuất kho) ──
  IF OLD.status = 'draft' AND NEW.status IN ('confirmed','completed') THEN
    IF NEW.refund_method IN ('credit_note','next_po_offset') THEN
      UPDATE public.suppliers
        SET current_debt_payable = current_debt_payable - v_total, updated_at = now()
        WHERE id = NEW.supplier_id;

    ELSIF NEW.refund_method = 'cash_refund' AND v_total > 0 THEN
      SELECT branch_id INTO v_branch FROM public.profiles WHERE id = NEW.created_by;
      v_cash_fund := public.fn_default_cash_fund(v_branch);
      IF v_cash_fund IS NOT NULL THEN
        SELECT id INTO v_cat FROM public.expense_categories WHERE code = 'THU-HOAN-NCC' LIMIT 1;
        INSERT INTO public.cashbook_transactions (
          flow_type, status, cash_fund_id, session_id, amount, transaction_date,
          supplier_id, expense_category_id, description, reference_no,
          created_by, approved_by, approved_at, source_table, source_id
        ) VALUES (
          'inflow', 'approved', v_cash_fund, NULL, v_total, CURRENT_DATE,
          NEW.supplier_id, v_cat,
          'Thu hoàn tiền trả hàng NCC (phiếu ' || COALESCE(NEW.return_code, '') || ')',
          NEW.return_code, NEW.created_by, NEW.created_by, now(),
          'purchase_returns', NEW.id
        )
        ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;
      END IF;
    END IF;

  -- ── ĐẢO NGƯỢC khi hủy phiếu đã ghi (confirmed/completed → cancelled) ──
  ELSIF OLD.status IN ('confirmed','completed') AND NEW.status = 'cancelled' THEN
    IF NEW.refund_method IN ('credit_note','next_po_offset') THEN
      UPDATE public.suppliers
        SET current_debt_payable = current_debt_payable + v_total, updated_at = now()
        WHERE id = NEW.supplier_id;

    ELSIF NEW.refund_method = 'cash_refund' AND v_total > 0 THEN
      SELECT branch_id INTO v_branch FROM public.profiles WHERE id = NEW.created_by;
      v_cash_fund := public.fn_default_cash_fund(v_branch);
      IF v_cash_fund IS NOT NULL THEN
        SELECT id INTO v_cat FROM public.expense_categories WHERE code = 'CHI-HOAN-NCC' LIMIT 1;
        -- source_table NULL để không đụng unique (source_table, source_id) của bản THU gốc
        INSERT INTO public.cashbook_transactions (
          flow_type, status, cash_fund_id, session_id, amount, transaction_date,
          supplier_id, expense_category_id, description, reference_no,
          created_by, approved_by, approved_at
        ) VALUES (
          'outflow', 'approved', v_cash_fund, NULL, v_total, CURRENT_DATE,
          NEW.supplier_id, v_cat,
          'Đảo thu hoàn NCC do hủy phiếu trả ' || COALESCE(NEW.return_code, ''),
          NEW.return_code, NEW.created_by, NEW.created_by, now()
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_returns_finance ON public.purchase_returns;
CREATE TRIGGER trg_purchase_returns_finance
  AFTER UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_finance_on_purchase_return();

NOTIFY pgrst, 'reload schema';
