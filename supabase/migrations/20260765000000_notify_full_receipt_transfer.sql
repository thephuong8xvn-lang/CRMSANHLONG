-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — PHIẾU NHẬP KHO & CHUYỂN KHO CŨNG THÀNH TIN ĐẦY ĐỦ
-- 2026-08-07
--
-- User: "thông báo kể cả phiếu nhập kho, chuyển kho".
-- ⇒ Chuyển các luật `receipt.*` và `transfer.*` sang `compose='full'`: mỗi phiếu
--   MỘT tin riêng, có chi tiết từng dòng hàng, giống tin hoá đơn bán hàng.
--
-- ── Cảnh báo giá nhập bất thường: GỘP VÀO DÒNG HÀNG, không tách tin ─────
-- Trước đây `receipt.price_anomaly` là một tin critical riêng. Nhưng user đã
-- chốt nguyên tắc "một việc một tin", mà tin riêng đó lại nói về đúng cái phiếu
-- vừa báo ⇒ thành 2 tin cho 1 việc.
-- Nay dấu ⚠️ dán thẳng vào DÒNG HÀNG lệch giá, ngay trong tin phiếu nhập:
--     · Vắc-xin X  20 × 434.603đ = 8.692.060đ  ⚠️ lần trước 13đ (+3343000%)
-- Vừa gọn hơn vừa đủ ngữ cảnh hơn tin rời. Luật cũ tắt đi, giữ lại làm dấu vết.
--
-- ⚠️ Phép dò giá vẫn chỉ chạy khi phiếu ở 'verified'/'completed' (~5,6 phiếu/
--    ngày), không nằm trên đường ghi nóng nào.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.notification_rules SET compose = 'full', updated_at = now()
 WHERE event_type IN ('receipt.draft','receipt.verified','receipt.completed',
                      'receipt.cancelled','transfer.shipped','transfer.pending',
                      'transfer.approved','transfer.rejected');

UPDATE public.notification_rules
   SET enabled = false, updated_at = now(),
       label = 'Giá nhập bất thường (đã gộp vào tin phiếu nhập)'
 WHERE event_type = 'receipt.price_anomaly';

-- ═══════════════════════════════════════════════════════════════════════════
-- NHẬP KHO — tin đầy đủ
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_goods_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt    TEXT;
  v_tieude TEXT;
  v_branch UUID;
  v_cn     TEXT;
  v_wh     TEXT;
  v_sup    TEXT;
  v_who    TEXT;
  v_n      INTEGER;
  v_sp     TEXT;
  v_canh   BOOLEAN := false;
  v_luc    TEXT;
  v_text   TEXT;
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

  v_tieude := CASE v_evt
                WHEN 'receipt.draft'     THEN '📝 PHIẾU NHẬP NHÁP'
                WHEN 'receipt.verified'  THEN '📥 PHIẾU NHẬP ĐÃ KIỂM'
                WHEN 'receipt.completed' THEN '📥 NHẬP KHO HOÀN TẤT'
                ELSE '🚫 HUỶ PHIẾU NHẬP' END;

  SELECT w.branch_id, w.name INTO v_branch, v_wh
    FROM public.warehouses w WHERE w.id = NEW.warehouse_id;
  SELECT b.name INTO v_cn FROM public.branches b WHERE b.id = v_branch;
  SELECT s.name INTO v_sup FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.completed_by, NEW.verified_by, NEW.received_by);
  SELECT count(*) INTO v_n FROM public.goods_receipt_lines WHERE receipt_id = NEW.id;

  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(NEW.completed_at, NEW.verified_at, NEW.created_at, now())),
             'HH24:MI DD/MM/YYYY');

  -- Dòng hàng, kèm dấu ⚠️ ngay trên dòng lệch giá > 30% so lần nhập trước.
  SELECT string_agg(
           '· ' || public.fn_tg_escape(pr.name)
           || '  ' || trim(to_char(l.quantity,'FM999999990.###'))
           || ' × ' || public.fn_notify_vnd(l.unit_price)
           || ' = <b>' || public.fn_notify_vnd(l.line_total) || '</b>'
           || COALESCE('  <i>lô ' || public.fn_tg_escape(l.lot_number) || '</i>', '')
           || COALESCE('  <i>HSD ' || to_char(l.expiry_date,'MM/YYYY') || '</i>', '')
           || CASE WHEN prev.last_price > 0
                    AND abs(l.unit_price - prev.last_price) > prev.last_price * 0.30
                   THEN E'\n   ⚠️ <b>lệch giá</b> — lần trước '
                        || public.fn_notify_vnd(prev.last_price)
                        || ' (' || CASE WHEN l.unit_price > prev.last_price THEN '+' ELSE '' END
                        || round((l.unit_price - prev.last_price) / prev.last_price * 100) || '%)'
                   ELSE '' END,
           E'\n' ORDER BY l.created_at)
    INTO v_sp
  FROM (SELECT * FROM public.goods_receipt_lines
         WHERE receipt_id = NEW.id ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(l2.unit_price, 0) AS last_price
    FROM public.goods_receipt_lines l2
    JOIN public.goods_receipts g2 ON g2.id = l2.receipt_id
    WHERE l2.product_id = l.product_id
      AND g2.id <> NEW.id
      AND g2.status IN ('verified','completed')
      AND g2.receipt_date <= COALESCE(NEW.receipt_date, current_date)
    ORDER BY g2.receipt_date DESC, g2.created_at DESC
    LIMIT 1
  ) prev ON true;

  v_canh := COALESCE(v_sp, '') LIKE '%lệch giá%';

  v_text :=
      CASE WHEN v_canh THEN '🔴 ' ELSE '' END
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
   || CASE WHEN COALESCE(v_n,0) > 25
           THEN E'\n… và ' || (v_n - 25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(NEW.total_amount) || '</b>'
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(NEW.notes), '')
   || CASE WHEN v_canh
           THEN E'\n\n🔴 <b>KIỂM LẠI GIÁ NHẬP</b> — có dòng lệch trên 30% so lần nhập'
                || ' gần nhất. Hay gặp nhất là gõ nhầm cột số lượng sang cột đơn giá.'
           ELSE '' END;

  PERFORM public.fn_notify_emit(v_evt, v_branch,
    jsonb_build_object('text', v_text,
                       'line', NEW.receipt_code || ' · ' || public.fn_notify_vnd(NEW.total_amount),
                       'tong', NEW.total_amount, 'lech_gia', v_canh),
    v_evt || ':' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- CHUYỂN KHO — tin đầy đủ
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_stock_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_evt    TEXT;
  v_tieude TEXT;
  v_branch UUID;
  v_from   TEXT;
  v_to     TEXT;
  v_cnf    TEXT;
  v_cnt    TEXT;
  v_who    TEXT;
  v_n      INTEGER;
  v_sp     TEXT;
  v_tien   NUMERIC;
  v_luc    TEXT;
  v_text   TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  v_evt := CASE NEW.status
             WHEN 'in_transit' THEN 'transfer.shipped'
             WHEN 'received'   THEN 'transfer.pending'
             WHEN 'completed'  THEN 'transfer.approved'
             WHEN 'rejected'   THEN 'transfer.rejected'
             WHEN 'cancelled'  THEN 'transfer.rejected'
             ELSE NULL END;
  IF v_evt IS NULL THEN RETURN NEW; END IF;

  v_tieude := CASE NEW.status
                WHEN 'in_transit' THEN '🚚 CHUYỂN KHO — ĐÃ XUẤT, ĐANG ĐI'
                WHEN 'received'   THEN '⏳ CHUYỂN KHO — <b>CHỜ ADMIN DUYỆT</b>'
                WHEN 'completed'  THEN '✅ CHUYỂN KHO — ĐÃ DUYỆT'
                WHEN 'rejected'   THEN '🚫 CHUYỂN KHO — TỪ CHỐI'
                ELSE '🚫 CHUYỂN KHO — HUỶ' END;

  v_branch := public.fn_notify_wh_branch(
                CASE WHEN NEW.status = 'in_transit' THEN NEW.from_warehouse
                     ELSE NEW.to_warehouse END);

  SELECT w.name, b.name INTO v_from, v_cnf
    FROM public.warehouses w LEFT JOIN public.branches b ON b.id = w.branch_id
   WHERE w.id = NEW.from_warehouse;
  SELECT w.name, b.name INTO v_to, v_cnt
    FROM public.warehouses w LEFT JOIN public.branches b ON b.id = w.branch_id
   WHERE w.id = NEW.to_warehouse;

  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(NEW.approved_by, NEW.rejected_by, NEW.received_by, NEW.created_by);
  SELECT count(*) INTO v_n FROM public.stock_transfer_lines WHERE transfer_id = NEW.id;

  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(NEW.approved_at, NEW.rejected_at, NEW.received_at,
                      NEW.shipped_at, NEW.updated_at, now())), 'HH24:MI DD/MM/YYYY');

  SELECT string_agg(
           '· ' || public.fn_tg_escape(pr.name)
           || '  ' || trim(to_char(l.quantity,'FM999999990.###'))
           || ' × ' || public.fn_notify_vnd(l.unit_price)
           || ' = <b>' || public.fn_notify_vnd(l.quantity * COALESCE(l.unit_price,0)) || '</b>',
           E'\n' ORDER BY l.created_at)
    INTO v_sp
  FROM (SELECT * FROM public.stock_transfer_lines
         WHERE transfer_id = NEW.id ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id;

  v_tien := COALESCE(NULLIF(NEW.total_cost,0), NEW.total_amount);

  v_text :=
      v_tieude || E'\n<b>' || public.fn_tg_escape(NEW.transfer_code) || '</b>'
   || E'\n📤 Từ: ' || public.fn_tg_escape(COALESCE(v_from,'?'))
   || COALESCE(' (' || public.fn_tg_escape(v_cnf) || ')', '')
   || E'\n📥 Đến: ' || public.fn_tg_escape(COALESCE(v_to,'?'))
   || COALESCE(' (' || public.fn_tg_escape(v_cnt) || ')', '')
   || E'\n🕐 ' || v_luc
   || E'\n🧑‍💼 Người thực hiện: ' || public.fn_tg_escape(COALESCE(v_who,'—'))
   || E'\n\n📦 <b>Hàng (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
   || COALESCE(v_sp, '(chưa có dòng hàng)')
   || CASE WHEN COALESCE(v_n,0) > 25
           THEN E'\n… và ' || (v_n - 25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(v_tien) || '</b>'
   -- Đơn giá chuyển LÀ giá vốn kho đích (bình quân gia quyền) — quy tắc đã chốt
   -- ở feature-transfer-approval, ghi rõ để không ai hiểu nhầm là giá bán.
   || E'\n<i>Đơn giá chuyển = giá vốn kho nhận</i>'
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(NEW.reason), '')
   || COALESCE(E'\n🚫 Lý do từ chối: ' || public.fn_tg_escape(NEW.reject_reason), '')
   || CASE WHEN NEW.status = 'received'
           THEN E'\n\n⏳ <b>Phiếu này đang chờ bạn duyệt trên web.</b>' ELSE '' END;

  PERFORM public.fn_notify_emit(v_evt, v_branch,
    jsonb_build_object('text', v_text,
                       'line', NEW.transfer_code || ' · ' || public.fn_notify_vnd(v_tien),
                       'tong', v_tien),
    v_evt || ':' || NEW.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
