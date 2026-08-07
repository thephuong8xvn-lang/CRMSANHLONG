-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — ĐỢT 3: BÁO TỪNG HÀNH ĐỘNG, NGAY SAU KHI XONG
-- 2026-08-07
--
-- User đổi yêu cầu: mọi hành động của nhân viên (tạo đơn, sổ quỹ, nhập hàng,
-- chuyển hàng, bán hàng) đều nhắn tin NGAY sau khi hành động vừa kết thúc,
-- không gom theo nhịp giờ nữa.
--
-- ── Đo thật trên prod (30 ngày) rồi mới chốt phương án ───────────────────
--     Đơn hàng               1.490  (~50/ngày)
--     Sổ quỹ                 1.280  (~43/ngày)
--     Nhập / chuyển / thu nợ / xuất khác  ~17/ngày
--
-- 🔴 **100% giao dịch sổ quỹ 30 ngày qua là HỆ QUẢ TỰ ĐỘNG**, không phải hành
--    động riêng của ai: 1.176 từ `order_payments`, 103 từ `debt_payments`,
--    1 từ `sales_returns`. Phiếu do người tự tạo: **8 phiếu / 90 ngày**.
--    ⇒ Báo mọi dòng sổ quỹ = mỗi lần bán hàng nhận HAI tin cho cùng một việc.
--    ⇒ User đã chốt: chỉ báo phiếu `source_table IS NULL` (người tự tạo).
--       Thông tin tiền vào quỹ nào đã nằm sẵn trong tin bán hàng.
--    ⇒ Còn ~77 tin/ngày, không tin nào trùng tin nào.
--
-- ── Vì sao KHÔNG cần cửa sổ gom nữa mà vẫn không bị dội ─────────────────
-- `batch_window_sec = 0` nghĩa là "đừng chờ", KHÔNG có nghĩa "mỗi sự kiện một
-- tin". `fn_notify_drain` vẫn gom mọi sự kiện cùng loại + cùng chi nhánh đang
-- chờ vào MỘT tin. Nên khi nhập từ Google Drive sinh 12 phiếu nháp cùng lúc,
-- lượt drain kế tiếp vẫn gộp thành 1 tin 12 dòng — vừa tức thì vừa không dội.
--
-- ⚠️ BẪY `daily_cap`: luật seed ở đợt 1 để trần 20–30 tin/ngày/loại. Với chế
--    độ báo từng hành động, `sales.order` một mình đã 50/ngày ⇒ **quá 20 là
--    drain lặng lẽ bỏ tin**, không báo lỗi. Phải nới trần cho mọi luật.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Cấu hình: báo ngay, trần rộng hơn ─────────────────────────────────
UPDATE public.system_settings
   SET value = value
       || '{"global_daily_cap": 400, "per_run_cap": 20}'::jsonb,
       updated_at = now()
 WHERE key = 'notification_config';

-- Bỏ chờ ở MỌI luật + nới trần ngày để không âm thầm nuốt tin.
UPDATE public.notification_rules
   SET batch_window_sec = 0,
       daily_cap = GREATEST(daily_cap, 150),
       updated_at = now();

-- Nhịp gom theo giờ không còn ý nghĩa khi đã báo từng đơn.
-- Đơn lớn / chiết khấu bất thường gộp thành DẤU trong chính tin bán hàng,
-- thay vì tin riêng — nếu để riêng thì một đơn lớn sinh 2 tin.
DELETE FROM public.notification_rules
 WHERE event_type IN ('sales.pulse', 'sales.big_order', 'sales.discount');

INSERT INTO public.notification_rules
  (event_type, label, severity, channel_code, batch_window_sec, min_interval_sec, daily_cap, threshold) VALUES
  ('sales.order',     'Bán hàng',            'info', '@branch', 0, 0, 300,
   '{"big_amount": 20000000, "discount_pct": 5, "discount_amount": 500000}'),
  ('sales.cancelled', 'Huỷ đơn',             'warn', '@branch', 0, 0, 150, '{}'),
  ('cashbook.manual', 'Sổ quỹ (tự lập phiếu)','info','@branch', 0, 0, 150, '{}')
ON CONFLICT (event_type) DO UPDATE
  SET label = EXCLUDED.label, severity = EXCLUDED.severity,
      channel_code = EXCLUDED.channel_code, batch_window_sec = 0,
      daily_cap = EXCLUDED.daily_cap, threshold = EXCLUDED.threshold,
      updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. BÁN HÀNG — orders
-- ═══════════════════════════════════════════════════════════════════════════
-- Đây là ĐƯỜNG GHI NÓNG duy nhất trong cả module. Giữ đúng 4 truy vấn nhỏ có
-- index (khách, người bán, đếm dòng, đọc ngưỡng) + 1 INSERT outbox. Không dò
-- giá vốn từng dòng ở đây — việc đó thuộc drain, chạy ngoài transaction bán.
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
  v_big  := COALESCE((v_thr->>'big_amount')::numeric, 20000000);
  v_dpct := COALESCE((v_thr->>'discount_pct')::numeric, 5);
  v_damt := COALESCE((v_thr->>'discount_amount')::numeric, 500000);
  v_pct  := CASE WHEN COALESCE(NEW.subtotal,0) > 0
                 THEN COALESCE(NEW.discount_total,0) / NEW.subtotal * 100 ELSE 0 END;

  -- Dấu cảnh báo gắn ngay trong tin bán hàng, không tách tin riêng.
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
      || COALESCE(' · ' || NEW.payment_method::text, '')
      || COALESCE(' · ' || v_who, '')
      || COALESCE(' · lý do: ' || NEW.cancel_reason, '')
      || v_co,
      'tong_tien', NEW.grand_total, 'ghi_no', COALESCE(NEW.debt_amount,0)),
    v_evt || ':' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;   -- không bao giờ được cản việc bán hàng
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_order ON public.orders;
CREATE TRIGGER trg_notify_order
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_order();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SỔ QUỸ — chỉ phiếu do người tự lập
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_cashbook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_who   TEXT;
  v_noi   TEXT;
  v_muc   TEXT;
  v_dau   TEXT;
  v_branch UUID;
BEGIN
  SELECT p.full_name INTO v_who FROM public.profiles p WHERE p.id = NEW.created_by;

  SELECT f.name, f.branch_id INTO v_noi, v_branch
    FROM public.cash_funds f WHERE f.id = NEW.cash_fund_id;
  IF v_noi IS NULL THEN
    SELECT b.bank_name || ' ' || b.account_no, b.branch_id INTO v_noi, v_branch
      FROM public.bank_accounts b WHERE b.id = NEW.bank_account_id;
  END IF;

  SELECT e.name INTO v_muc FROM public.expense_categories e
   WHERE e.id = NEW.expense_category_id;

  v_dau := CASE WHEN NEW.flow_type::text = 'inflow' THEN '↑ Thu' ELSE '↓ Chi' END;

  PERFORM public.fn_notify_emit('cashbook.manual', v_branch,
    jsonb_build_object('line',
      v_dau || ' ' || public.fn_notify_money(NEW.amount)
      || COALESCE(' · ' || NEW.transaction_code, '')
      || COALESCE(' · ' || v_muc, '')
      || COALESCE(' · ' || v_noi, '')
      || COALESCE(' · ' || v_who, '')
      || COALESCE(' · ' || NEW.description, ''),
      'so_tien', NEW.amount, 'chieu', NEW.flow_type::text),
    'cb:' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- Lọc ở WHEN: 92% dòng sổ quỹ sinh tự động từ đơn hàng, không được vào plpgsql.
DROP TRIGGER IF EXISTS trg_notify_cashbook ON public.cashbook_transactions;
CREATE TRIGGER trg_notify_cashbook
  AFTER INSERT ON public.cashbook_transactions
  FOR EACH ROW
  WHEN (NEW.source_table IS NULL)
  EXECUTE FUNCTION public.trg_notify_cashbook();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. KHÁCH TRẢ HÀNG — sales_returns
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_sales_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_branch UUID;
  v_don    TEXT;
  v_kh     TEXT;
  v_who    TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text NOT IN ('completed','cancelled') THEN RETURN NEW; END IF;

  SELECT o.branch_id, o.order_code, c.farm_name INTO v_branch, v_don, v_kh
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
   WHERE o.id = NEW.order_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.cancelled_by, NEW.processed_by, NEW.created_by);

  PERFORM public.fn_notify_emit('sales.return', v_branch,
    jsonb_build_object('line',
      NEW.return_code || ' · ' || COALESCE(v_kh,'?')
      || COALESCE(' · đơn ' || v_don, '')
      || ' · ' || public.fn_notify_money(NEW.total_amount)
      || CASE WHEN NEW.status::text = 'cancelled' THEN ' · ĐÃ HUỶ PHIẾU' ELSE '' END
      || COALESCE(' · ' || NEW.reason, '')
      || COALESCE(' · ' || v_who, ''),
      'so_tien', NEW.total_amount),
    'sr:' || NEW.id || ':' || NEW.status::text);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_sales_return ON public.sales_returns;
CREATE TRIGGER trg_notify_sales_return
  AFTER INSERT OR UPDATE OF status ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_sales_return();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. CRON 15 GIÂY — "ngay sau hành động"
-- ═══════════════════════════════════════════════════════════════════════════
-- pg_cron 1.6.4 nhận cú pháp giây. Drain có advisory lock nên rút chu kỳ
-- không sinh lượt chồng nhau. Chi phí: 5.760 lượt/ngày × ~20ms ≈ 0,13% CPU;
-- lượt rỗng chỉ là 2 truy vấn có index rồi thoát.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-drain') THEN
    PERFORM cron.unschedule('notify-drain');
  END IF;
  PERFORM cron.schedule('notify-drain', '15 seconds', 'SELECT public.fn_notify_drain();');
END $$;

NOTIFY pgrst, 'reload schema';
