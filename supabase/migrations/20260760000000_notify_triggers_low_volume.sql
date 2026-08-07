-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — ĐỢT 2: TRIGGER 5 LUỒNG THƯA
-- 2026-08-05
--
-- Nhập hàng (kể cả nháp) · Xuất hàng · Chuyển kho · Hóa đơn · Thu nợ.
-- Trigger CHỈ ghi outbox qua fn_notify_emit, không sửa dữ liệu nghiệp vụ nào.
--
-- ── Khối lượng thật đo trên prod (30 ngày) ────────────────────────────────
--     Nhập hàng      168  (~5,6/ngày)
--     Xuất khác      127  (~4,2/ngày)
--     Chuyển kho     105  (~3,5/ngày)
--     Thu nợ         104  (~3,5/ngày)
--     ─────────────────────────────
--     Tổng          ~17 việc/ngày  → báo TỪNG VIỆC là đọc được.
--
-- ⚠️ Nhưng `stock_movements` có **4.684 dòng/30 ngày**, trong đó chỉ 127 là
--    xuất khác — 97% là dòng bán hàng. Trigger vì thế đặt điều kiện ở mệnh đề
--    `WHEN` của CREATE TRIGGER, không phải trong thân hàm: Postgres kiểm WHEN
--    ở tầng C và bỏ qua luôn, không hề khởi động plpgsql. Nếu lọc bên trong
--    thân hàm thì mỗi lần bán hàng đều phải dựng một khung plpgsql vô ích.
--
-- ── Hai phát hiện khi soi dữ liệu thật ───────────────────────────────────
-- 1. Bảng `invoices` **RỖNG (0 dòng)** — chưa bao giờ dùng. Hóa đơn thật đi
--    qua `vat_issuances`, cũng đang 0 dòng, trong khi `vat_pending_sales` có
--    **1.104 đơn chờ xuất hóa đơn, tất cả còn 'pending'**. Nên trigger gắn
--    vào `vat_issuances` (sẵn sàng cho ngày user bắt đầu xuất), KHÔNG gắn vào
--    `invoices`. Tồn đọng 1.104 phiếu là việc của bản tin chốt ngày (đợt 4).
-- 2. Chuyển kho chạy `draft → in_transit → received → completed`, trong đó
--    **`received` mới là trạng thái CHỜ ADMIN DUYỆT** (fn_complete_transfer
--    mới set approved_by/approved_at). Luật seed ở đợt 1 đặt tên theo suy
--    đoán nên chỉnh lại cho khớp máy thật.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper: định dạng tiền cho người đọc ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_money(p NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL THEN '0đ'
    WHEN abs(p) >= 1000000000 THEN replace(to_char(p/1000000000,'FM999990.99'),'.',',') || ' tỷ'
    WHEN abs(p) >= 1000000    THEN replace(to_char(p/1000000,'FM999990.9'),'.',',') || 'tr'
    ELSE replace(to_char(p,'FM999,999,999'),',','.') || 'đ'
  END;
$$;

-- ── Helper: kho → chi nhánh ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_wh_branch(p_wh UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT branch_id FROM public.warehouses WHERE id = p_wh;
$$;

-- ── Chỉnh luật chuyển kho cho khớp máy trạng thái thật ───────────────────
DELETE FROM public.notification_rules WHERE event_type = 'transfer.received';

UPDATE public.notification_rules
   SET label = 'Chuyển kho CHỜ DUYỆT', severity = 'critical',
       channel_code = 'canh_bao', updated_at = now()
 WHERE event_type = 'transfer.pending';

INSERT INTO public.notification_rules
  (event_type, label, severity, channel_code, batch_window_sec, min_interval_sec, daily_cap, threshold) VALUES
  ('transfer.shipped',  'Chuyển kho đã xuất',    'info', '@branch', 0, 0, 20, '{}'),
  ('transfer.rejected', 'Chuyển kho bị từ chối', 'warn', '@branch', 0, 0, 20, '{}')
ON CONFLICT (event_type) DO NOTHING;

-- Index phục vụ dò giá nhập lần trước (dùng trong trigger nhập hàng).
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_product
  ON public.goods_receipt_lines (product_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. NHẬP HÀNG — goods_receipts (draft → verified → completed / cancelled)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_goods_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt    TEXT;
  v_branch UUID;
  v_wh     TEXT;
  v_sup    TEXT;
  v_who    TEXT;
  v_lines  INTEGER;
  v_line   TEXT;
  r        RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RETURN NEW; END IF;
    v_evt := 'receipt.draft';
  ELSE
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_evt := CASE NEW.status
               WHEN 'verified'  THEN 'receipt.verified'
               WHEN 'completed' THEN 'receipt.completed'
               WHEN 'cancelled' THEN 'receipt.cancelled'
               ELSE NULL END;
    IF v_evt IS NULL THEN RETURN NEW; END IF;
  END IF;

  SELECT w.branch_id, w.name INTO v_branch, v_wh
    FROM public.warehouses w WHERE w.id = NEW.warehouse_id;
  SELECT s.name INTO v_sup FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  SELECT count(*) INTO v_lines FROM public.goods_receipt_lines WHERE receipt_id = NEW.id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.completed_by, NEW.verified_by, NEW.received_by);

  v_line := NEW.receipt_code
            || COALESCE(' · ' || v_sup, '')
            || ' · ' || COALESCE(v_lines, 0) || ' dòng · '
            || public.fn_notify_money(NEW.total_amount)
            || COALESCE(' · kho ' || v_wh, '')
            || COALESCE(' · ' || v_who, '')
            -- Nháp sinh từ Google Drive đến hàng loạt: đánh dấu để đọc tin
            -- gom 30 phút còn hiểu vì sao một lúc có 12 phiếu.
            || CASE WHEN NEW.gsheet_source_id IS NOT NULL THEN ' (Google Drive)' ELSE '' END;

  PERFORM public.fn_notify_emit(v_evt, v_branch,
    jsonb_build_object('line', v_line, 'receipt_id', NEW.id,
                       'total', NEW.total_amount, 'so_dong', COALESCE(v_lines,0)),
    v_evt || ':' || NEW.id);

  -- ── Giá nhập bất thường ───────────────────────────────────────────────
  -- Đây là phép kiểm đáng giá nhất cả module: chính là bẫy GR-181294 đảo cột
  -- SL/đơn giá từng tạo 31,95tr lợi nhuận ảo. Chỉ chạy khi phiếu đã kiểm/hoàn
  -- tất (~5,6 phiếu/ngày) nên không nằm trên đường ghi nóng nào.
  IF NEW.status IN ('verified','completed') THEN
    FOR r IN
      SELECT p.name AS pname, l.unit_price, prev.last_price
      FROM public.goods_receipt_lines l
      JOIN public.products p ON p.id = l.product_id
      CROSS JOIN LATERAL (
        SELECT l2.unit_price AS last_price
        FROM public.goods_receipt_lines l2
        JOIN public.goods_receipts g2 ON g2.id = l2.receipt_id
        WHERE l2.product_id = l.product_id
          AND g2.id <> NEW.id
          AND g2.status IN ('verified','completed')
          AND g2.receipt_date <= COALESCE(NEW.receipt_date, current_date)
        ORDER BY g2.receipt_date DESC, g2.created_at DESC
        LIMIT 1
      ) prev
      WHERE l.receipt_id = NEW.id
        AND COALESCE(prev.last_price, 0) > 0
        -- Nhân thay vì chia: Postgres không bảo đảm thứ tự đánh giá điều kiện
        -- nên `.../prev.last_price` có thể chạy TRƯỚC phép kiểm `> 0` ⇒ chia 0.
        AND abs(l.unit_price - prev.last_price) > prev.last_price * 0.30
      LIMIT 10
    LOOP
      PERFORM public.fn_notify_emit('receipt.price_anomaly', v_branch,
        jsonb_build_object('line',
          NEW.receipt_code || ' · ' || r.pname
          || ' · giá nhập ' || public.fn_notify_money(r.unit_price)
          || ' ↔ lần trước ' || public.fn_notify_money(r.last_price)
          || ' ('
          || CASE WHEN r.unit_price > r.last_price THEN '+' ELSE '' END
          || round((r.unit_price - r.last_price) / r.last_price * 100) || '%)'),
        'gr_anom:' || NEW.id || ':' || r.pname);
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;   -- thông báo hỏng không được cản việc nhập hàng
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_goods_receipt ON public.goods_receipts;
CREATE TRIGGER trg_notify_goods_receipt
  AFTER INSERT OR UPDATE OF status ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_goods_receipt();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. XUẤT HÀNG KHÔNG PHẢI BÁN — stock_movements
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_stock_writeoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt    TEXT;
  v_nhan   TEXT;
  v_branch UUID;
  v_wh     TEXT;
  v_prod   TEXT;
  v_who    TEXT;
BEGIN
  v_evt := CASE WHEN NEW.movement_type::text = 'return_to_supplier'
                THEN 'stock.return_supplier' ELSE 'stock.writeoff' END;

  v_nhan := CASE NEW.movement_type::text
              WHEN 'expiry_writeoff'     THEN 'Hủy hết hạn'
              WHEN 'damage_writeoff'     THEN 'Hủy hỏng hóc'
              WHEN 'return_to_supplier'  THEN 'Trả nhà cung cấp'
              WHEN 'adjustment_increase' THEN 'Kiểm kê tăng'
              WHEN 'adjustment_decrease' THEN 'Kiểm kê giảm'
              ELSE NEW.movement_type::text END;

  SELECT w.branch_id, w.name INTO v_branch, v_wh
    FROM public.warehouses w WHERE w.id = NEW.warehouse_id;
  SELECT p.name INTO v_prod FROM public.products p WHERE p.id = NEW.product_id;
  SELECT p.full_name INTO v_who FROM public.profiles p WHERE p.id = NEW.performed_by;

  PERFORM public.fn_notify_emit(v_evt, v_branch,
    jsonb_build_object('line',
      v_nhan || ' · ' || COALESCE(v_prod,'?')
      || ' · SL ' || trim(to_char(NEW.quantity, 'FM999999990.###'))
      || ' · vốn ' || public.fn_notify_money(NEW.quantity * COALESCE(NEW.unit_cost,0))
      || COALESCE(' · kho ' || v_wh, '')
      || COALESCE(' · ' || v_who, '')
      || COALESCE(' · ' || NEW.notes, ''),
      'gia_tri', NEW.quantity * COALESCE(NEW.unit_cost,0)),
    'mv:' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ⚠️ Lọc ở WHEN, KHÔNG lọc trong thân hàm. 97% dòng stock_movements là bán
--    hàng; WHEN được kiểm ở tầng C nên dòng bán không hề đụng tới plpgsql.
DROP TRIGGER IF EXISTS trg_notify_stock_writeoff ON public.stock_movements;
CREATE TRIGGER trg_notify_stock_writeoff
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW
  WHEN (NEW.movement_type IN ('expiry_writeoff','damage_writeoff','return_to_supplier',
                              'adjustment_increase','adjustment_decrease'))
  EXECUTE FUNCTION public.trg_notify_stock_writeoff();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CHUYỂN KHO — stock_transfers
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_stock_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt    TEXT;
  v_branch UUID;
  v_from   TEXT;
  v_to     TEXT;
  v_lines  INTEGER;
  v_who    TEXT;
  v_tien   NUMERIC;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  v_evt := CASE NEW.status
             WHEN 'in_transit' THEN 'transfer.shipped'
             WHEN 'received'   THEN 'transfer.pending'   -- CHỜ ADMIN DUYỆT
             WHEN 'completed'  THEN 'transfer.approved'
             WHEN 'rejected'   THEN 'transfer.rejected'
             WHEN 'cancelled'  THEN 'transfer.rejected'
             ELSE NULL END;
  IF v_evt IS NULL THEN RETURN NEW; END IF;

  -- Hàng rời kho nguồn thì đó là việc của chi nhánh nguồn; các bước sau
  -- thuộc về chi nhánh đích.
  v_branch := public.fn_notify_wh_branch(
                CASE WHEN NEW.status = 'in_transit' THEN NEW.from_warehouse
                     ELSE NEW.to_warehouse END);

  SELECT name INTO v_from FROM public.warehouses WHERE id = NEW.from_warehouse;
  SELECT name INTO v_to   FROM public.warehouses WHERE id = NEW.to_warehouse;
  SELECT count(*) INTO v_lines FROM public.stock_transfer_lines WHERE transfer_id = NEW.id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.approved_by, NEW.rejected_by, NEW.received_by, NEW.created_by);

  v_tien := COALESCE(NULLIF(NEW.total_cost,0), NEW.total_amount);

  PERFORM public.fn_notify_emit(v_evt, v_branch,
    jsonb_build_object('line',
      NEW.transfer_code || ' · ' || COALESCE(v_from,'?') || ' → ' || COALESCE(v_to,'?')
      || ' · ' || COALESCE(v_lines,0) || ' dòng · ' || public.fn_notify_money(v_tien)
      || COALESCE(' · ' || v_who, '')
      || CASE WHEN NEW.status = 'received' THEN ' · ⏳ CHỜ DUYỆT' ELSE '' END
      || COALESCE(' · lý do: ' || NEW.reject_reason, ''),
      'gia_tri', v_tien),
    v_evt || ':' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_stock_transfer ON public.stock_transfers;
CREATE TRIGGER trg_notify_stock_transfer
  AFTER UPDATE OF status ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_stock_transfer();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. HÓA ĐƠN — vat_issuances  (KHÔNG phải `invoices`, bảng đó rỗng/chết)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_vat_issuance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_who   TEXT;
  v_gop   INTEGER;
BEGIN
  SELECT p.full_name INTO v_who FROM public.profiles p WHERE p.id = NEW.created_by;
  SELECT count(*) INTO v_gop FROM public.vat_pending_sales WHERE issuance_id = NEW.id;

  PERFORM public.fn_notify_emit('invoice.issued', NULL,
    jsonb_build_object('line',
      'HĐ ' || COALESCE(NEW.invoice_no,'(chưa số)')
      || ' · ' || COALESCE(NEW.buyer_name,'?')
      || ' · ' || public.fn_notify_money(NEW.total)
      || ' (VAT ' || public.fn_notify_money(NEW.vat_amount) || ')'
      || CASE WHEN COALESCE(v_gop,0) > 1 THEN ' · gộp ' || v_gop || ' đơn' ELSE '' END
      || COALESCE(' · ' || v_who, ''),
      'tong', NEW.total),
    'vat:' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_vat_issuance ON public.vat_issuances;
CREATE TRIGGER trg_notify_vat_issuance
  AFTER INSERT ON public.vat_issuances
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_vat_issuance();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. THU NỢ — debt_payments   (sự kiện THU TIỀN, không phải nhắc nợ)
-- ═══════════════════════════════════════════════════════════════════════════
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

  -- "Vào quỹ nào" là thông tin BẮT BUỘC hiện ra: hệ thống từng định tuyến sai
  -- 91% / 471tr vào nhầm quỹ chi nhánh. Đưa thẳng vào tin thì lệch lộ ngay.
  PERFORM public.fn_notify_emit('debt.payment', NEW.branch_id,
    jsonb_build_object('line',
      COALESCE(v_kh,'?') || ' · ' || public.fn_notify_money(NEW.amount)
      || ' · ' || COALESCE(NEW.payment_method::text,'?')
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

DROP TRIGGER IF EXISTS trg_notify_debt_payment ON public.debt_payments;
CREATE TRIGGER trg_notify_debt_payment
  AFTER INSERT ON public.debt_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_debt_payment();

NOTIFY pgrst, 'reload schema';
