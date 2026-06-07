-- ============================================================
-- Migration: supplier_debt_on_completion
-- File: 20260623000000_supplier_debt_on_completion.sql
-- Mục đích: Ghi nhận CÔNG NỢ NCC theo bước HOÀN THÀNH phiếu nhập, thay vì
--   theo INSERT như trước. Lý do: với luồng duyệt mới (draft→verified→
--   completed), trigger cũ fn_supplier_debt_on_receipt cộng nợ ngay khi tạo
--   phiếu nháp (hàng chưa vào kho) và KHÔNG hoàn nợ khi huỷ (fn_cancel chỉ
--   đổi status, total_amount giữ nguyên) → công nợ sai thời điểm + nợ ảo.
--
--   Mô hình mới: "đóng góp công nợ" của 1 phiếu = total_amount KHI status =
--   'completed', ngược lại = 0. Mọi thay đổi (insert/update status/đổi NCC/
--   sửa total/xoá) điều chỉnh suppliers.current_debt_payable theo chênh lệch.
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_supplier_debt_on_receipt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_amt NUMERIC := 0;   -- đóng góp công nợ TRƯỚC (chỉ tính khi completed)
  new_amt NUMERIC := 0;   -- đóng góp công nợ SAU
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.status = 'completed' THEN
    old_amt := COALESCE(OLD.total_amount, 0);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status = 'completed' THEN
    new_amt := COALESCE(NEW.total_amount, 0);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF old_amt <> 0 THEN
      UPDATE public.suppliers
        SET current_debt_payable = current_debt_payable - old_amt, updated_at = now()
        WHERE id = OLD.supplier_id;
    END IF;
    RETURN OLD;
  END IF;

  -- INSERT hoặc UPDATE
  IF TG_OP = 'UPDATE' AND OLD.supplier_id <> NEW.supplier_id THEN
    -- Đổi NCC: gỡ đóng góp cũ ở NCC cũ, thêm đóng góp mới ở NCC mới
    IF old_amt <> 0 THEN
      UPDATE public.suppliers
        SET current_debt_payable = current_debt_payable - old_amt, updated_at = now()
        WHERE id = OLD.supplier_id;
    END IF;
    IF new_amt <> 0 THEN
      UPDATE public.suppliers
        SET current_debt_payable = current_debt_payable + new_amt, updated_at = now()
        WHERE id = NEW.supplier_id;
    END IF;
  ELSE
    IF (new_amt - old_amt) <> 0 THEN
      UPDATE public.suppliers
        SET current_debt_payable = current_debt_payable + (new_amt - old_amt), updated_at = now()
        WHERE id = NEW.supplier_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger đã tồn tại (AFTER INSERT OR UPDATE OR DELETE) → CREATE OR REPLACE function là đủ.

-- ─────────────────────────────────────────────────────────────
-- ĐỐI SOÁT MỘT LẦN: trigger cũ đã lỡ cộng total_amount của MỌI phiếu khi
-- INSERT (kể cả phiếu nay chưa/không completed). Trừ lại đúng phần đóng góp
-- của các phiếu HIỆN không ở trạng thái 'completed' → đưa current_debt_payable
-- về đúng mô hình "chỉ tính phiếu completed". (Giữ nguyên phần thanh toán &
-- số dư đầu kỳ — chỉ chỉnh đúng sai sót của trigger cũ.)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_rows INT;
BEGIN
  WITH adj AS (
    SELECT supplier_id, SUM(COALESCE(total_amount,0)) AS amt
    FROM public.goods_receipts
    WHERE status <> 'completed'
    GROUP BY supplier_id
  )
  UPDATE public.suppliers s
    SET current_debt_payable = s.current_debt_payable - adj.amt,
        updated_at = now()
  FROM adj
  WHERE s.id = adj.supplier_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'Đối soát công nợ NCC: cập nhật % nhà cung cấp.', v_rows;
END $$;
