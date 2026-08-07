-- ═══════════════════════════════════════════════════════════════════════
-- ĐỢT 4 — CHỐT NGÀY QUA TELEGRAM
--
-- Hai luật `daily.branch_close` và `daily.company_close` đã được seed từ
-- đợt 1 (`20260758`) và đang BẬT, nhưng chưa bao giờ có gì sinh ra sự
-- kiện cho chúng. Migration này lắp phần còn thiếu:
--
--   17:30 VN — mỗi chi nhánh 1 tin vào kênh của mình
--   17:45 VN — 1 tin tổng công ty vào kênh 📊 Tổng hợp
--
-- Cả hai hàm đều có chế độ 'preview': trả về nguyên văn tin mà KHÔNG gửi,
-- KHÔNG ghi sự kiện. Dùng để soi trước khi bật cron.
--
-- 🪤 Bẫy đã tránh:
--  · Ranh giới ngày phải quy về giờ VN rồi mới đổi sang timestamptz — cron
--    chạy UTC, lệch 7 tiếng thì mất nguyên buổi chiều (cùng loại lỗi với
--    `fix-returns-excluded-from-reports`).
--  · Đơn `returned_partial` / `returned_full` VẪN LÀ DOANH THU — chỉ loại
--    `draft` và `cancelled`. Đã có tiền lệ 13,84tr bốc hơi vì loại nhầm.
--  · Số lượng đi qua `fn_notify_qty()` vì kho có bật số thập phân;
--    `to_char(...,'FM…###')` sẽ làm tròn sai.
--  · Tên chi nhánh / sản phẩm phải qua `fn_tg_escape()` ngay tại nơi dựng
--    tin — lớp drain không phân biệt được thẻ `<b>` cố ý với dấu `<` trong
--    tên hàng.
--  · Luật đang để `compose='list'`; tin chốt ngày là một khối văn bản hoàn
--    chỉnh nên phải chuyển sang `'full'`, nếu không drain sẽ gom và cắt.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Tin chốt ngày của MỘT chi nhánh ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_branch_close_text(
  p_branch_id uuid,
  p_date      date
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from   timestamptz;  v_to    timestamptz;
  v_pfrom  timestamptz;  v_pto   timestamptz;   -- hôm trước, để so
  v_ten    text;
  v_dt     numeric := 0; v_don   integer := 0;
  v_cash   numeric := 0; v_ck    numeric := 0;  v_no numeric := 0;
  v_dt_tr  numeric := 0;
  v_thu    numeric := 0; v_thu_n integer := 0;
  v_nhap   numeric := 0; v_nhap_n integer := 0;
  v_tra    numeric := 0; v_tra_n integer := 0;
  v_top    text;
  v_delta  text := '';
BEGIN
  v_from  := timezone('Asia/Ho_Chi_Minh',  p_date::timestamp);
  v_to    := timezone('Asia/Ho_Chi_Minh', (p_date + 1)::timestamp);
  v_pfrom := timezone('Asia/Ho_Chi_Minh', (p_date - 1)::timestamp);
  v_pto   := v_from;

  SELECT b.name INTO v_ten FROM public.branches b WHERE b.id = p_branch_id;

  -- Bán hàng trong ngày. Đơn trả hàng VẪN tính doanh thu (xem ghi chú đầu file).
  SELECT COALESCE(SUM(o.grand_total),0), COUNT(*),
         COALESCE(SUM(o.grand_total) FILTER (WHERE o.payment_method = 'cash'),0),
         COALESCE(SUM(o.grand_total) FILTER (WHERE o.payment_method = 'bank_transfer'),0),
         COALESCE(SUM(o.grand_total) FILTER (WHERE o.payment_method = 'credit'),0)
    INTO v_dt, v_don, v_cash, v_ck, v_no
    FROM public.orders o
   WHERE o.branch_id = p_branch_id
     AND o.created_at >= v_from AND o.created_at < v_to
     AND o.status NOT IN ('draft','cancelled');

  SELECT COALESCE(SUM(o.grand_total),0) INTO v_dt_tr
    FROM public.orders o
   WHERE o.branch_id = p_branch_id
     AND o.created_at >= v_pfrom AND o.created_at < v_pto
     AND o.status NOT IN ('draft','cancelled');

  -- Thu nợ: bám `branch_id` = NƠI THU (`20260754`), không phải nhãn khách.
  SELECT COALESCE(SUM(dp.amount),0), COUNT(*) INTO v_thu, v_thu_n
    FROM public.debt_payments dp
   WHERE dp.branch_id = p_branch_id AND dp.payment_date = p_date;

  SELECT COALESCE(SUM(gr.total_amount),0), COUNT(*) INTO v_nhap, v_nhap_n
    FROM public.goods_receipts gr
    JOIN public.warehouses w ON w.id = gr.warehouse_id
   WHERE w.branch_id = p_branch_id
     AND gr.receipt_date = p_date
     AND gr.status IN ('verified','completed');

  SELECT COALESCE(SUM(sr.total_amount),0), COUNT(*) INTO v_tra, v_tra_n
    FROM public.sales_returns sr
    JOIN public.orders o ON o.id = sr.order_id
   WHERE o.branch_id = p_branch_id
     AND sr.created_at >= v_from AND sr.created_at < v_to
     AND sr.status = 'completed';

  SELECT string_agg(x.dong, E'\n' ORDER BY x.hang)
    INTO v_top
    FROM (SELECT row_number() OVER (ORDER BY SUM(ol.line_total) DESC) AS hang,
                 row_number() OVER (ORDER BY SUM(ol.line_total) DESC) || '. '
                   || public.fn_tg_escape(pr.name)
                   || ' — ' || public.fn_notify_qty(SUM(ol.quantity))
                   || ' · <b>' || public.fn_notify_vnd(SUM(ol.line_total)) || '</b>' AS dong
            FROM public.order_lines ol
            JOIN public.orders   o  ON o.id  = ol.order_id
            JOIN public.products pr ON pr.id = ol.product_id
           WHERE o.branch_id = p_branch_id
             AND o.created_at >= v_from AND o.created_at < v_to
             AND o.status NOT IN ('draft','cancelled')
           GROUP BY pr.name
           ORDER BY SUM(ol.line_total) DESC
           LIMIT 5) x;

  IF v_dt_tr > 0 THEN
    v_delta := '  <i>(' || CASE WHEN v_dt >= v_dt_tr THEN '+' ELSE '' END
               || round((v_dt - v_dt_tr) / v_dt_tr * 100) || '% so hôm qua)</i>';
  END IF;

  RETURN '📊 <b>CHỐT NGÀY ' || to_char(p_date,'DD/MM/YYYY') || '</b>'
      || E'\n🏢 ' || public.fn_tg_escape(COALESCE(v_ten,'—'))
      || E'\n\n💵 Doanh thu: <b>' || public.fn_notify_vnd(v_dt) || '</b>' || v_delta
      || E'\n   ' || v_don || ' đơn'
      || CASE WHEN v_don > 0
              THEN ' · TB ' || public.fn_notify_vnd(round(v_dt / v_don)) || '/đơn'
              ELSE '' END
      || E'\n💳 Tiền mặt ' || public.fn_notify_vnd(v_cash)
      || ' · CK '   || public.fn_notify_vnd(v_ck)
      || ' · Ghi nợ ' || public.fn_notify_vnd(v_no)
      -- `payment_method` còn có card_pos / voucher / loyalty_points. Chưa đơn
      -- nào dùng, nhưng nếu có thì tiền phải hiện ra chứ không được bốc hơi.
      || CASE WHEN v_dt - v_cash - v_ck - v_no <> 0
              THEN ' · Khác ' || public.fn_notify_vnd(v_dt - v_cash - v_ck - v_no)
              ELSE '' END
      || E'\n🤝 Thu nợ: <b>' || public.fn_notify_vnd(v_thu) || '</b> (' || v_thu_n || ' phiếu)'
      || E'\n📥 Nhập hàng: ' || public.fn_notify_vnd(v_nhap) || ' (' || v_nhap_n || ' phiếu)'
      || CASE WHEN v_tra_n > 0
              THEN E'\n↩️ Trả hàng: ' || public.fn_notify_vnd(v_tra) || ' (' || v_tra_n || ' phiếu)'
              ELSE '' END
      || CASE WHEN v_top IS NOT NULL
              THEN E'\n\n🏆 <b>Bán chạy</b>' || E'\n' || v_top
              ELSE E'\n\n<i>Không có đơn nào trong ngày.</i>' END;
END $$;

-- ── 2. Phát tin chốt ngày cho MỌI chi nhánh đang hoạt động ────────────
CREATE OR REPLACE FUNCTION public.fn_notify_branch_close(
  p_date date DEFAULT NULL,
  p_mode text DEFAULT 'send'          -- 'send' | 'preview'
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date date;
  v_b    record;
  v_txt  text;
  v_out  text := '';
BEGIN
  IF p_mode NOT IN ('send','preview') THEN
    RAISE EXCEPTION 'p_mode phải là send hoặc preview, nhận: %', p_mode;
  END IF;
  v_date := COALESCE(p_date, (timezone('Asia/Ho_Chi_Minh', now()))::date);

  FOR v_b IN SELECT id, name FROM public.branches WHERE is_active ORDER BY code LOOP
    v_txt := public.fn_notify_branch_close_text(v_b.id, v_date);

    IF p_mode = 'send' THEN
      PERFORM public.fn_notify_emit(
        'daily.branch_close', v_b.id,
        jsonb_build_object('text', v_txt,
                           'line', v_b.name || ' · chốt ngày ' || to_char(v_date,'DD/MM')),
        'daily.branch_close:' || v_b.id || ':' || v_date,
        NULL);
    END IF;

    v_out := v_out || v_txt || E'\n\n────────────────────\n\n';
  END LOOP;

  RETURN v_out;
END $$;

-- ── 3. Tin tổng công ty ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_company_close(
  p_date date DEFAULT NULL,
  p_mode text DEFAULT 'send'
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date   date;
  v_from   timestamptz; v_to  timestamptz;
  v_wfrom  timestamptz; v_wto timestamptz;      -- cùng thứ tuần trước
  v_bang   text;
  v_tong   numeric := 0; v_don integer := 0;
  v_tuan   numeric := 0;
  v_thu    numeric := 0;
  v_ck_duyet integer := 0; v_hd_cho integer := 0;
  v_delta  text := '';
  v_txt    text;
BEGIN
  IF p_mode NOT IN ('send','preview') THEN
    RAISE EXCEPTION 'p_mode phải là send hoặc preview, nhận: %', p_mode;
  END IF;
  v_date  := COALESCE(p_date, (timezone('Asia/Ho_Chi_Minh', now()))::date);
  v_from  := timezone('Asia/Ho_Chi_Minh',  v_date::timestamp);
  v_to    := timezone('Asia/Ho_Chi_Minh', (v_date + 1)::timestamp);
  v_wfrom := timezone('Asia/Ho_Chi_Minh', (v_date - 7)::timestamp);
  v_wto   := timezone('Asia/Ho_Chi_Minh', (v_date - 6)::timestamp);

  SELECT string_agg(x.dong, E'\n' ORDER BY x.dt DESC), COALESCE(SUM(x.dt),0), COALESCE(SUM(x.sl),0)
    INTO v_bang, v_tong, v_don
    FROM (SELECT b.id,
                 COALESCE(SUM(o.grand_total),0) AS dt,
                 COUNT(o.id)                    AS sl,
                 '· ' || public.fn_tg_escape(b.name) || ': <b>'
                   || public.fn_notify_vnd(COALESCE(SUM(o.grand_total),0)) || '</b> · '
                   || COUNT(o.id) || ' đơn' AS dong
            FROM public.branches b
            LEFT JOIN public.orders o
                   ON o.branch_id = b.id
                  AND o.created_at >= v_from AND o.created_at < v_to
                  AND o.status NOT IN ('draft','cancelled')
           WHERE b.is_active
           GROUP BY b.id, b.name) x;

  SELECT COALESCE(SUM(o.grand_total),0) INTO v_tuan
    FROM public.orders o
   WHERE o.created_at >= v_wfrom AND o.created_at < v_wto
     AND o.status NOT IN ('draft','cancelled');

  SELECT COALESCE(SUM(dp.amount),0) INTO v_thu
    FROM public.debt_payments dp WHERE dp.payment_date = v_date;

  -- Tồn đọng cần xử. `received` MỚI là "chờ admin duyệt" — chuyển kho
  -- KHÔNG có trạng thái `pending_approval`.
  SELECT COUNT(*) INTO v_ck_duyet
    FROM public.stock_transfers WHERE status = 'received';

  SELECT COUNT(*) INTO v_hd_cho
    FROM public.vat_pending_sales WHERE status = 'pending';

  IF v_tuan > 0 THEN
    v_delta := E'\n📈 So cùng thứ tuần trước: <b>'
               || CASE WHEN v_tong >= v_tuan THEN '+' ELSE '' END
               || round((v_tong - v_tuan) / v_tuan * 100) || '%</b>'
               || ' <i>(' || public.fn_notify_vnd(v_tuan) || ')</i>';
  END IF;

  v_txt := '🏛 <b>CHỐT NGÀY TOÀN CÔNG TY ' || to_char(v_date,'DD/MM/YYYY') || '</b>'
        || E'\n\n' || COALESCE(v_bang,'<i>(không có chi nhánh nào)</i>')
        || E'\n────────────────'
        || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(v_tong) || '</b> · ' || v_don || ' đơn'
        || v_delta
        || E'\n🤝 Thu nợ toàn công ty: <b>' || public.fn_notify_vnd(v_thu) || '</b>'
        || E'\n\n⏳ <b>Tồn đọng</b>'
        || E'\n· Phiếu chuyển chờ duyệt: <b>' || v_ck_duyet || '</b>'
        || E'\n· Dòng hàng chờ xuất hoá đơn: <b>' || v_hd_cho || '</b>';

  IF p_mode = 'send' THEN
    PERFORM public.fn_notify_emit(
      'daily.company_close', NULL,
      jsonb_build_object('text', v_txt,
                         'line', 'Toàn công ty · chốt ngày ' || to_char(v_date,'DD/MM')),
      'daily.company_close:' || v_date,
      NULL);
  END IF;

  RETURN v_txt;
END $$;

-- ── 4. Luật phải là 'full' — tin chốt ngày là một khối hoàn chỉnh ─────
UPDATE public.notification_rules
   SET compose = 'full', delay_sec = 0, quiet_hours = false
 WHERE event_type IN ('daily.branch_close','daily.company_close');

-- ── 5. Lịch chạy. Cron chạy giờ UTC: 17:30 VN = 10:30 UTC ────────────
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('notify-branch-close','notify-company-close');

SELECT cron.schedule('notify-branch-close',  '30 10 * * *',
                     $cron$SELECT public.fn_notify_branch_close();$cron$);
SELECT cron.schedule('notify-company-close', '45 10 * * *',
                     $cron$SELECT public.fn_notify_company_close();$cron$);

GRANT EXECUTE ON FUNCTION public.fn_notify_branch_close_text(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_branch_close(date, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_company_close(date, text)     TO authenticated;

COMMENT ON FUNCTION public.fn_notify_branch_close(date, text) IS
  'Chốt ngày theo chi nhánh, 17:30 VN. p_mode=preview để xem trước, không gửi.';
COMMENT ON FUNCTION public.fn_notify_company_close(date, text) IS
  'Chốt ngày toàn công ty, 17:45 VN. p_mode=preview để xem trước, không gửi.';
