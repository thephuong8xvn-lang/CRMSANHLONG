-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — CHỈNH THEO SỐ THẬT SAU KHI CHẠY THỬ ĐỢT 3
-- 2026-08-07
--
-- ── 1. Ngưỡng "đơn lớn" 20tr là ngưỡng chết ──────────────────────────────
-- Đo 30 ngày: đơn lớn nhất **12,89tr**, p95 = 2,02tr, p99 = 5,10tr.
-- Không một đơn nào chạm 20tr ⇒ dấu ⚠️ ĐƠN LỚN sẽ KHÔNG BAO GIỜ hiện.
-- Hạ về 5tr: 18 đơn/30 ngày ≈ 0,6 tin/ngày có dấu — vừa đủ để đáng chú ý.
--
-- ── 2. Phương thức thanh toán đang hiện tiếng Anh ────────────────────────
-- Enum `order_payment_method` đang dùng: cash | bank_transfer | credit.
-- Tin nhắn cho chủ đọc thì phải là Tiền mặt / Chuyển khoản / Ghi nợ.
--
-- ── Ghi chú không sửa được bằng code ─────────────────────────────────────
-- Cột "ai làm" lấy từ `profiles.full_name`, nhưng 30 ngày qua chỉ có 4 tài
-- khoản đứng tên: Hoài Ân (1.057 đơn) · Phù Mỹ (284) · Quản trị viên (114) ·
-- CN Mỹ Thành (2). Đây là **tài khoản dùng chung của chi nhánh, không phải
-- tên người**. Tin nhắn vì thế chỉ nói được "chi nhánh nào làm", không nói
-- được "ai làm". Muốn biết đích danh nhân viên thì phải tách tài khoản riêng
-- cho từng người — việc tổ chức, không phải việc của module này.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.notification_rules
   SET threshold = threshold || '{"big_amount": 5000000}'::jsonb,
       updated_at = now()
 WHERE event_type = 'sales.order';

-- ── Nhãn phương thức thanh toán ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_paymethod(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
           WHEN 'cash'          THEN 'Tiền mặt'
           WHEN 'bank_transfer' THEN 'Chuyển khoản'
           WHEN 'credit'        THEN 'Ghi nợ'
           WHEN 'card'          THEN 'Thẻ'
           ELSE p
         END;
$$;

-- ── Bán hàng: dùng nhãn tiếng Việt ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_notify_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt   TEXT;
  v_kh    TEXT;
  v_who   TEXT;
  v_lines INTEGER;
  v_thr   JSONB;
  v_big   NUMERIC;
  v_dpct  NUMERIC;
  v_damt  NUMERIC;
  v_pct   NUMERIC;
  v_co    TEXT := '';
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_evt := CASE WHEN NEW.status::text IN ('confirmed','completed') THEN 'sales.order'
                  WHEN NEW.status::text = 'cancelled' THEN 'sales.cancelled'
                  ELSE NULL END;
  ELSE
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_evt := CASE WHEN NEW.status::text = 'completed' THEN 'sales.order'
                  WHEN NEW.status::text = 'cancelled' THEN 'sales.cancelled'
                  ELSE NULL END;
  END IF;
  IF v_evt IS NULL THEN RETURN NEW; END IF;

  SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id = NEW.customer_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.confirmed_by, NEW.owner_user_id);
  SELECT count(*) INTO v_lines FROM public.order_lines WHERE order_id = NEW.id;

  SELECT threshold INTO v_thr FROM public.notification_rules WHERE event_type = 'sales.order';
  v_big  := COALESCE((v_thr->>'big_amount')::numeric, 5000000);
  v_dpct := COALESCE((v_thr->>'discount_pct')::numeric, 5);
  v_damt := COALESCE((v_thr->>'discount_amount')::numeric, 500000);
  v_pct  := CASE WHEN COALESCE(NEW.subtotal,0) > 0
                 THEN COALESCE(NEW.discount_total,0) / NEW.subtotal * 100 ELSE 0 END;

  IF v_evt = 'sales.order' THEN
    IF NEW.grand_total >= v_big THEN v_co := v_co || ' ⚠️ ĐƠN LỚN'; END IF;
    IF COALESCE(NEW.discount_total,0) > 0
       AND (v_pct >= v_dpct OR NEW.discount_total >= v_damt)
    THEN v_co := v_co || ' ⚠️ CK ' || round(v_pct) || '%'; END IF;
    IF COALESCE(NEW.debt_amount,0) > 0 THEN
      v_co := v_co || ' · ghi nợ ' || public.fn_notify_money(NEW.debt_amount);
    END IF;
  END IF;

  PERFORM public.fn_notify_emit(v_evt, NEW.branch_id,
    jsonb_build_object('line',
      NEW.order_code || ' · ' || COALESCE(v_kh, 'khách lẻ')
      || ' · ' || COALESCE(v_lines,0) || ' dòng · '
      || public.fn_notify_money(NEW.grand_total)
      || COALESCE(' · ' || public.fn_notify_paymethod(NEW.payment_method::text), '')
      || COALESCE(' · ' || v_who, '')
      || COALESCE(' · lý do: ' || NEW.cancel_reason, '')
      || v_co,
      'tong_tien', NEW.grand_total, 'ghi_no', COALESCE(NEW.debt_amount,0)),
    v_evt || ':' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ── Thu nợ: dùng nhãn tiếng Việt ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_notify_debt_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_kh   TEXT;
  v_who  TEXT;
  v_cn   TEXT;
  v_con  NUMERIC;
BEGIN
  SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id = NEW.customer_id;
  SELECT p.full_name INTO v_who FROM public.profiles p WHERE p.id = NEW.recorded_by;
  SELECT b.name INTO v_cn FROM public.branches b WHERE b.id = NEW.branch_id;

  SELECT COALESCE(sum(d.amount), 0) INTO v_con
    FROM public.customer_debts d
   WHERE d.customer_id = NEW.customer_id AND d.is_settled = false;

  PERFORM public.fn_notify_emit('debt.payment', NEW.branch_id,
    jsonb_build_object('line',
      COALESCE(v_kh,'?') || ' · ' || public.fn_notify_money(NEW.amount)
      || ' · ' || public.fn_notify_paymethod(NEW.payment_method::text)
      || COALESCE(' · thu tại ' || v_cn, '')
      || COALESCE(' · ' || v_who, '')
      || ' · còn nợ ' || public.fn_notify_money(v_con),
      'so_tien', NEW.amount, 'con_no', v_con),
    'dp:' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_notify_paymethod(TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
