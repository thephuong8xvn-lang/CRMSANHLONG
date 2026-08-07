-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — VÁ SỐ LƯỢNG THẬP PHÂN BỊ LÀM TRÒN
-- 2026-08-07
--
-- ── Lỗi phát hiện khi chạy thử tin gửi khách ────────────────────────────
-- Tin phiếu giao hàng của khách "Trại a Bảo-Ân Hậu" hiện:
--     · AGV-Milk Plus (10x1) Kg   0 × 140.000đ = 14.000đ
-- Số lượng 0 mà thành tiền 14.000đ — vô lý. Số thật trong DB là **0.100**.
--
-- Gốc: mọi trigger đang dùng `to_char(qty, 'FM999999990.###')`. **`#` KHÔNG
-- phải mã định dạng số của Postgres** — nó bị coi như ký tự thường và phần
-- thập phân biến mất, kết quả là LÀM TRÒN:
--     to_char(0.1, 'FM999999990.###') → '0'
--     to_char(2.5, 'FM999999990.###') → '3'
--
-- Nguy hiểm vì kho có bật nhập số lượng thập phân (kg, lít, chai lẻ). Khách
-- nhận phiếu ghi "0 × 140.000đ = 14.000đ" sẽ nghĩ mình bị tính tiền hàng
-- không giao.
--
-- ⇒ Thêm `fn_notify_qty()` và thay ở CẢ BỐN trigger có in số lượng.
--   Dùng dấu phẩy thập phân theo lối Việt: 0,1 — 2,5 — 10.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_notify_qty(p NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL      THEN '0'
    WHEN p = trunc(p)   THEN trim(to_char(p, 'FM999999999990'))
    ELSE replace(rtrim(rtrim(trim(to_char(p, 'FM999999999990.999')), '0'), '.'), '.', ',')
  END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_notify_qty(NUMERIC) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. BÁN HÀNG (tin nội bộ + tin gửi khách)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  o RECORD; v_evt TEXT; v_fp TEXT; v_sua BOOLEAN := false;
  v_kh TEXT; v_who TEXT; v_cn TEXT; v_kho TEXT; v_sp TEXT; v_n INTEGER;
  v_thr JSONB; v_big NUMERIC; v_dpct NUMERIC; v_damt NUMERIC; v_pct NUMERIC;
  v_co TEXT := ''; v_text TEXT; v_luc TEXT;
  v_tg TEXT; v_no_ht NUMERIC; v_ktext TEXT; v_kfp TEXT; v_ksua BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;

  SELECT * INTO o FROM public.orders WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_evt := CASE WHEN o.status::text IN ('confirmed','completed') THEN 'sales.order'
                WHEN o.status::text = 'cancelled' THEN 'sales.cancelled' ELSE NULL END;
  IF v_evt IS NULL THEN RETURN NULL; END IF;
  v_fp := v_evt || ':' || o.id;

  SELECT c.farm_name INTO v_kh FROM public.customers c WHERE c.id = o.customer_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(o.confirmed_by, o.owner_user_id);
  SELECT b.name INTO v_cn  FROM public.branches b   WHERE b.id = o.branch_id;
  SELECT w.name INTO v_kho FROM public.warehouses w WHERE w.id = o.warehouse_id;
  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(o.confirmed_at, o.created_at, now())), 'HH24:MI DD/MM/YYYY');

  IF v_evt = 'sales.cancelled' THEN
    PERFORM public.fn_notify_emit(v_evt, o.branch_id,
      jsonb_build_object('line',
        o.order_code || ' · ' || COALESCE(v_kh,'khách lẻ')
        || ' · ' || public.fn_notify_vnd(o.grand_total)
        || COALESCE(' · ' || v_who, '') || COALESCE(' · lý do: ' || o.cancel_reason, '')),
      v_fp || ':' || to_char(now(),'YYYYMMDDHH24MISS'));
    RETURN NULL;
  END IF;

  v_sua := EXISTS (SELECT 1 FROM public.notification_events
                    WHERE fingerprint = v_fp AND status = 'sent');
  SELECT count(*) INTO v_n FROM public.order_lines WHERE order_id = o.id;

  SELECT string_agg('· ' || public.fn_tg_escape(pr.name)
           || '  ' || public.fn_notify_qty(l.quantity)
           || ' × ' || public.fn_notify_vnd(l.unit_price)
           || ' = <b>' || public.fn_notify_vnd(l.line_total) || '</b>',
           E'\n' ORDER BY l.created_at)
    INTO v_sp
  FROM (SELECT * FROM public.order_lines WHERE order_id = o.id
         ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id;

  SELECT threshold INTO v_thr FROM public.notification_rules WHERE event_type='sales.order';
  v_big  := COALESCE((v_thr->>'big_amount')::numeric, 5000000);
  v_dpct := COALESCE((v_thr->>'discount_pct')::numeric, 5);
  v_damt := COALESCE((v_thr->>'discount_amount')::numeric, 500000);
  v_pct  := CASE WHEN COALESCE(o.subtotal,0) > 0
                 THEN COALESCE(o.discount_total,0) / o.subtotal * 100 ELSE 0 END;
  IF o.grand_total >= v_big THEN v_co := v_co || E'\n⚠️ <b>ĐƠN GIÁ TRỊ LỚN</b>'; END IF;
  IF COALESCE(o.discount_total,0) > 0 AND (v_pct >= v_dpct OR o.discount_total >= v_damt)
  THEN v_co := v_co || E'\n⚠️ <b>Chiết khấu ' || round(v_pct) || '%</b>'; END IF;

  v_text := CASE WHEN v_sua THEN '🔁 <b>ĐƠN ĐÃ SỬA</b> — bản cập nhật' || E'\n' ELSE '' END
   || '🧾 <b>' || public.fn_tg_escape(o.order_code) || '</b>'
   || E'\n🏢 ' || public.fn_tg_escape(COALESCE(v_cn,'chưa gán chi nhánh'))
   || COALESCE(' — kho ' || public.fn_tg_escape(v_kho), '')
   || E'\n🕐 ' || v_luc
   || E'\n👤 Khách: <b>' || public.fn_tg_escape(COALESCE(v_kh,'Khách lẻ')) || '</b>'
   || E'\n🧑‍💼 Người bán: ' || public.fn_tg_escape(COALESCE(v_who,'—'))
   || E'\n\n📦 <b>Hàng (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
   || COALESCE(v_sp, '(không có dòng hàng)')
   || CASE WHEN COALESCE(v_n,0) > 25 THEN E'\n… và ' || (v_n-25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || CASE WHEN COALESCE(o.discount_total,0) > 0
           THEN E'\nTạm tính: ' || public.fn_notify_vnd(o.subtotal)
                || E'\nChiết khấu: -' || public.fn_notify_vnd(o.discount_total) ELSE '' END
   || CASE WHEN COALESCE(o.shipping_fee,0) > 0
           THEN E'\nPhí giao: ' || public.fn_notify_vnd(o.shipping_fee) ELSE '' END
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(o.grand_total) || '</b>'
   || E'\n💳 ' || public.fn_notify_paymethod(o.payment_method::text)
   || ' · đã trả ' || public.fn_notify_vnd(o.paid_amount)
   || CASE WHEN COALESCE(o.debt_amount,0) > 0
           THEN ' · <b>còn nợ ' || public.fn_notify_vnd(o.debt_amount) || '</b>'
           ELSE ' · <b>đã thanh toán đủ</b>' END
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(o.notes), '') || v_co;

  PERFORM public.fn_notify_emit(v_evt, o.branch_id,
    jsonb_build_object('text', v_text,
                       'line', o.order_code || ' · ' || public.fn_notify_vnd(o.grand_total),
                       'tong_tien', o.grand_total, 'ghi_no', COALESCE(o.debt_amount,0),
                       'la_ban_sua', v_sua),
    CASE WHEN v_sua THEN v_fp || ':' || to_char(now(),'YYYYMMDDHH24MISS') ELSE v_fp END);

  -- ── Tin gửi khách ───────────────────────────────────────────────────
  IF o.customer_id IS NOT NULL THEN
    SELECT c.telegram_chat_id INTO v_tg FROM public.customers c
     WHERE c.id = o.customer_id AND c.telegram_enabled = true
       AND COALESCE(c.telegram_chat_id,'') <> '';

    IF v_tg IS NOT NULL THEN
      SELECT COALESCE(sum(d.amount),0) INTO v_no_ht FROM public.customer_debts d
       WHERE d.customer_id = o.customer_id AND d.is_settled = false;

      v_kfp  := 'sales.order_customer:' || o.id;
      v_ksua := EXISTS (SELECT 1 FROM public.notification_events
                         WHERE fingerprint = v_kfp AND status = 'sent');

      v_ktext := CASE WHEN v_ksua
                      THEN '🔁 <b>ĐÃ CẬP NHẬT</b> — phiếu này vừa được điều chỉnh' || E'\n\n'
                      ELSE '' END
       || '🧾 <b>PHIẾU GIAO HÀNG</b>' || E'\n<b>SANH LONG VETCO</b>'
       || COALESCE(' — ' || public.fn_tg_escape(v_cn), '')
       || E'\nMã đơn: <b>' || public.fn_tg_escape(o.order_code) || '</b>'
       || E'\nThời gian: ' || v_luc
       || E'\n\nKính gửi: <b>' || public.fn_tg_escape(COALESCE(v_kh,'Quý khách')) || '</b>'
       || E'\nĐơn hàng của quý khách đã được giao thành công.'
       || E'\n\n📦 <b>Hàng đã giao (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
       || COALESCE(v_sp, '(không có dòng hàng)')
       || CASE WHEN COALESCE(v_n,0) > 25 THEN E'\n… và ' || (v_n-25) || ' dòng nữa' ELSE '' END
       || E'\n\n────────────────'
       || CASE WHEN COALESCE(o.discount_total,0) > 0
               THEN E'\nTạm tính: ' || public.fn_notify_vnd(o.subtotal)
                    || E'\nChiết khấu: -' || public.fn_notify_vnd(o.discount_total) ELSE '' END
       || CASE WHEN COALESCE(o.shipping_fee,0) > 0
               THEN E'\nPhí giao: ' || public.fn_notify_vnd(o.shipping_fee) ELSE '' END
       || E'\n💰 <b>TỔNG TIỀN HÀNG: ' || public.fn_notify_vnd(o.grand_total) || '</b>'
       || E'\n💳 Đã thanh toán: ' || public.fn_notify_vnd(o.paid_amount)
       || ' (' || public.fn_notify_paymethod(o.payment_method::text) || ')'
       || CASE WHEN COALESCE(o.debt_amount,0) > 0
               THEN E'\n🧾 Còn nợ đơn này: <b>' || public.fn_notify_vnd(o.debt_amount) || '</b>'
               ELSE E'\n✅ <b>Đã thanh toán đủ đơn này</b>' END
       || E'\n📊 Tổng công nợ hiện tại: <b>' || public.fn_notify_vnd(v_no_ht) || '</b>'
       || E'\n\n<i>Cảm ơn quý khách đã tin dùng Sanh Long Vetco.</i>'
       || E'\n<i>Nếu có sai sót, xin nhắn lại ngay trong nhóm này.</i>';

      PERFORM public.fn_notify_emit('sales.order_customer', o.branch_id,
        jsonb_build_object('text', v_ktext,
                           'line', o.order_code || ' · ' || public.fn_notify_vnd(o.grand_total),
                           'tong_tien', o.grand_total, 'cong_no', v_no_ht),
        CASE WHEN v_ksua THEN v_kfp || ':' || to_char(now(),'YYYYMMDDHH24MISS') ELSE v_kfp END,
        o.customer_id);
    END IF;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. NHẬP KHO
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_goods_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt TEXT; v_tieude TEXT; v_branch UUID; v_cn TEXT; v_wh TEXT; v_sup TEXT;
  v_who TEXT; v_n INTEGER; v_sp TEXT; v_canh BOOLEAN := false; v_luc TEXT; v_text TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RETURN NEW; END IF;
    v_evt := 'receipt.draft';
  ELSE
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_evt := CASE NEW.status WHEN 'verified' THEN 'receipt.verified'
                             WHEN 'completed' THEN 'receipt.completed'
                             WHEN 'cancelled' THEN 'receipt.cancelled' ELSE NULL END;
    IF v_evt IS NULL THEN RETURN NEW; END IF;
  END IF;

  v_tieude := CASE v_evt WHEN 'receipt.draft' THEN '📝 PHIẾU NHẬP NHÁP'
                         WHEN 'receipt.verified' THEN '📥 PHIẾU NHẬP ĐÃ KIỂM'
                         WHEN 'receipt.completed' THEN '📥 NHẬP KHO HOÀN TẤT'
                         ELSE '🚫 HUỶ PHIẾU NHẬP' END;

  SELECT w.branch_id, w.name INTO v_branch, v_wh FROM public.warehouses w
   WHERE w.id = NEW.warehouse_id;
  SELECT b.name INTO v_cn FROM public.branches b WHERE b.id = v_branch;
  SELECT s.name INTO v_sup FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.completed_by, NEW.verified_by, NEW.received_by);
  SELECT count(*) INTO v_n FROM public.goods_receipt_lines WHERE receipt_id = NEW.id;
  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(NEW.completed_at, NEW.verified_at, NEW.created_at, now())),
             'HH24:MI DD/MM/YYYY');

  SELECT string_agg('· ' || public.fn_tg_escape(pr.name)
           || '  ' || public.fn_notify_qty(l.quantity)
           || ' × ' || public.fn_notify_vnd(l.unit_price)
           || ' = <b>' || public.fn_notify_vnd(l.line_total) || '</b>'
           || COALESCE('  <i>lô ' || public.fn_tg_escape(l.lot_number) || '</i>', '')
           || COALESCE('  <i>HSD ' || to_char(l.expiry_date,'MM/YYYY') || '</i>', '')
           || CASE WHEN prev.last_price > 0
                    AND abs(l.unit_price - prev.last_price) > prev.last_price * 0.30
                   THEN E'\n   ⚠️ <b>lệch giá</b> — lần trước '
                        || public.fn_notify_vnd(prev.last_price)
                        || ' (' || CASE WHEN l.unit_price > prev.last_price THEN '+' ELSE '' END
                        || round((l.unit_price - prev.last_price)/prev.last_price*100) || '%)'
                   ELSE '' END,
           E'\n' ORDER BY l.created_at)
    INTO v_sp
  FROM (SELECT * FROM public.goods_receipt_lines WHERE receipt_id = NEW.id
         ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(l2.unit_price,0) AS last_price
    FROM public.goods_receipt_lines l2
    JOIN public.goods_receipts g2 ON g2.id = l2.receipt_id
    WHERE l2.product_id = l.product_id AND g2.id <> NEW.id
      AND g2.status IN ('verified','completed')
      AND g2.receipt_date <= COALESCE(NEW.receipt_date, current_date)
    ORDER BY g2.receipt_date DESC, g2.created_at DESC LIMIT 1
  ) prev ON true;

  v_canh := COALESCE(v_sp,'') LIKE '%lệch giá%';

  v_text := CASE WHEN v_canh THEN '🔴 ' ELSE '' END
   || v_tieude || ' <b>' || public.fn_tg_escape(NEW.receipt_code) || '</b>'
   || E'\n🏢 ' || public.fn_tg_escape(COALESCE(v_cn,'—'))
   || COALESCE(' — kho ' || public.fn_tg_escape(v_wh), '')
   || E'\n🕐 ' || v_luc
   || E'\n🏭 NCC: <b>' || public.fn_tg_escape(COALESCE(v_sup,'—')) || '</b>'
   || E'\n🧑‍💼 Người thực hiện: ' || public.fn_tg_escape(COALESCE(v_who,'—'))
   || CASE WHEN NEW.gsheet_source_id IS NOT NULL
           THEN E'\n☁️ <i>Sinh tự động từ Google Drive</i>' ELSE '' END
   || E'\n\n📦 <b>Hàng (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
   || COALESCE(v_sp, '(chưa có dòng hàng)')
   || CASE WHEN COALESCE(v_n,0) > 25 THEN E'\n… và ' || (v_n-25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(NEW.total_amount) || '</b>'
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(NEW.notes), '')
   || CASE WHEN v_canh THEN E'\n\n🔴 <b>KIỂM LẠI GIÁ NHẬP</b> — có dòng lệch trên 30% so '
        || 'lần nhập gần nhất. Hay gặp nhất là gõ nhầm cột số lượng sang cột đơn giá.'
        ELSE '' END;

  PERFORM public.fn_notify_emit(v_evt, v_branch,
    jsonb_build_object('text', v_text,
                       'line', NEW.receipt_code || ' · ' || public.fn_notify_vnd(NEW.total_amount),
                       'tong', NEW.total_amount, 'lech_gia', v_canh),
    v_evt || ':' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CHUYỂN KHO
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_stock_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt TEXT; v_tieude TEXT; v_branch UUID; v_from TEXT; v_to TEXT;
  v_cnf TEXT; v_cnt TEXT; v_who TEXT; v_n INTEGER; v_sp TEXT;
  v_tien NUMERIC; v_luc TEXT; v_text TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  v_evt := CASE NEW.status WHEN 'in_transit' THEN 'transfer.shipped'
                           WHEN 'received'   THEN 'transfer.pending'
                           WHEN 'completed'  THEN 'transfer.approved'
                           WHEN 'rejected'   THEN 'transfer.rejected'
                           WHEN 'cancelled'  THEN 'transfer.rejected' ELSE NULL END;
  IF v_evt IS NULL THEN RETURN NEW; END IF;

  v_tieude := CASE NEW.status
                WHEN 'in_transit' THEN '🚚 CHUYỂN KHO — ĐÃ XUẤT, ĐANG ĐI'
                WHEN 'received'   THEN '⏳ CHUYỂN KHO — <b>CHỜ ADMIN DUYỆT</b>'
                WHEN 'completed'  THEN '✅ CHUYỂN KHO — ĐÃ DUYỆT'
                WHEN 'rejected'   THEN '🚫 CHUYỂN KHO — TỪ CHỐI'
                ELSE '🚫 CHUYỂN KHO — HUỶ' END;

  v_branch := public.fn_notify_wh_branch(
                CASE WHEN NEW.status='in_transit' THEN NEW.from_warehouse
                     ELSE NEW.to_warehouse END);

  SELECT w.name, b.name INTO v_from, v_cnf FROM public.warehouses w
    LEFT JOIN public.branches b ON b.id = w.branch_id WHERE w.id = NEW.from_warehouse;
  SELECT w.name, b.name INTO v_to, v_cnt FROM public.warehouses w
    LEFT JOIN public.branches b ON b.id = w.branch_id WHERE w.id = NEW.to_warehouse;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.approved_by, NEW.rejected_by, NEW.received_by, NEW.created_by);
  SELECT count(*) INTO v_n FROM public.stock_transfer_lines WHERE transfer_id = NEW.id;
  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(NEW.approved_at, NEW.rejected_at, NEW.received_at,
                      NEW.shipped_at, NEW.updated_at, now())), 'HH24:MI DD/MM/YYYY');

  SELECT string_agg('· ' || public.fn_tg_escape(pr.name)
           || '  ' || public.fn_notify_qty(l.quantity)
           || ' × ' || public.fn_notify_vnd(l.unit_price)
           || ' = <b>' || public.fn_notify_vnd(l.quantity * COALESCE(l.unit_price,0)) || '</b>',
           E'\n' ORDER BY l.created_at)
    INTO v_sp
  FROM (SELECT * FROM public.stock_transfer_lines WHERE transfer_id = NEW.id
         ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id;

  v_tien := COALESCE(NULLIF(NEW.total_cost,0), NEW.total_amount);

  v_text := v_tieude || E'\n<b>' || public.fn_tg_escape(NEW.transfer_code) || '</b>'
   || E'\n📤 Từ: ' || public.fn_tg_escape(COALESCE(v_from,'?'))
   || COALESCE(' (' || public.fn_tg_escape(v_cnf) || ')', '')
   || E'\n📥 Đến: ' || public.fn_tg_escape(COALESCE(v_to,'?'))
   || COALESCE(' (' || public.fn_tg_escape(v_cnt) || ')', '')
   || E'\n🕐 ' || v_luc
   || E'\n🧑‍💼 Người thực hiện: ' || public.fn_tg_escape(COALESCE(v_who,'—'))
   || E'\n\n📦 <b>Hàng (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
   || COALESCE(v_sp, '(chưa có dòng hàng)')
   || CASE WHEN COALESCE(v_n,0) > 25 THEN E'\n… và ' || (v_n-25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(v_tien) || '</b>'
   || E'\n<i>Đơn giá chuyển = giá vốn kho nhận</i>'
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(NEW.reason), '')
   || COALESCE(E'\n🚫 Lý do từ chối: ' || public.fn_tg_escape(NEW.reject_reason), '')
   || CASE WHEN NEW.status='received'
           THEN E'\n\n⏳ <b>Phiếu này đang chờ bạn duyệt trên web.</b>' ELSE '' END;

  PERFORM public.fn_notify_emit(v_evt, v_branch,
    jsonb_build_object('text', v_text,
                       'line', NEW.transfer_code || ' · ' || public.fn_notify_vnd(v_tien),
                       'tong', v_tien),
    v_evt || ':' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. XUẤT HỦY / ĐIỀU CHỈNH / TRẢ NCC
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_stock_writeoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt TEXT; v_nhan TEXT; v_branch UUID; v_wh TEXT; v_prod TEXT; v_who TEXT;
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

  SELECT w.branch_id, w.name INTO v_branch, v_wh FROM public.warehouses w
   WHERE w.id = NEW.warehouse_id;
  SELECT p.name INTO v_prod FROM public.products p WHERE p.id = NEW.product_id;
  SELECT p.full_name INTO v_who FROM public.profiles p WHERE p.id = NEW.performed_by;

  PERFORM public.fn_notify_emit(v_evt, v_branch,
    jsonb_build_object('line',
      v_nhan || ' · ' || COALESCE(v_prod,'?')
      || ' · SL ' || public.fn_notify_qty(NEW.quantity)
      || ' · vốn ' || public.fn_notify_money(NEW.quantity * COALESCE(NEW.unit_cost,0))
      || COALESCE(' · kho ' || v_wh, '') || COALESCE(' · ' || v_who, '')
      || COALESCE(' · ' || NEW.notes, ''),
      'gia_tri', NEW.quantity * COALESCE(NEW.unit_cost,0)),
    'mv:' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
