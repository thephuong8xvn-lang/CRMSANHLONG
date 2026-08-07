-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — TIN PHIẾU NHẬP LUÔN BÁO "0 DÒNG"
-- 2026-08-07
--
-- ── Triệu chứng user báo ─────────────────────────────────────────────────
--   📝 PHIẾU NHẬP NHÁP GR-517882
--   📦 Hàng (0 dòng)
--   (chưa có dòng hàng)
-- Trong khi phiếu có thật 2 dòng hàng.
--
-- ── Nguyên nhân: TIN CHẠY TRƯỚC HÀNG ────────────────────────────────────
-- Màn nhập kho ghi dữ liệu bằng HAI lượt gọi mạng RIÊNG BIỆT, tức là HAI
-- giao dịch khác nhau (`GoodsReceiptFormPage.tsx:799` rồi `:822`):
--     ① INSERT INTO goods_receipts        ← trigger nổ NGAY ĐÂY, chưa có dòng nào
--     ② INSERT INTO goods_receipt_lines   ← hàng mới vào, muộn hơn ~0,3–0,5 giây
--
-- Đo trên 8 phiếu gần nhất ở prod: dòng hàng luôn tới sau đầu phiếu
-- 0,15–0,50 giây. Nên tin "phiếu nháp" của MỌI phiếu nhập từ trước tới nay
-- đều rỗng — không phải riêng GR-517882. (Tin "đã kiểm" và "hoàn tất" thì
-- đúng, vì lúc đổi trạng thái hàng đã nằm sẵn trong bảng.)
--
-- Đây là họ hàng của lỗi đã vá ở `20260766` (trigger đọc số quá sớm), nhưng
-- KHÔNG chữa được bằng cách hoãn tới commit: giao dịch ① đã commit xong xuôi
-- rồi thì dòng hàng vẫn chưa tồn tại. Phải nghe ngóng ở chính bảng dòng hàng.
--
-- ── Cách sửa: hai lớp ───────────────────────────────────────────────────
--   ① `trg_notify_goods_receipt` chuyển sang CONSTRAINT TRIGGER DEFERRABLE
--      + ĐỌC LẠI phiếu. Lo trường hợp đầu phiếu và dòng hàng nằm CÙNG một
--      giao dịch (nhập từ Google Drive, các RPC) — khi ấy hoãn tới commit là
--      đủ và không sinh thêm tin.
--   ② Trigger MỚI trên `goods_receipt_lines` — dựng lại tin và phát lại mỗi
--      khi dòng hàng thêm/sửa/xoá. Đây là lớp chữa cho luồng hai giao dịch
--      của màn nhập kho.
--
-- Phát lại KHÔNG sinh tin trùng, nhờ hai cơ chế đã có sẵn từ `20260769`:
--   • Bản mới ĐÈ bản chưa gửi cùng `subject_key` ⇒ thường thì chỉ MỘT tin
--     duy nhất đi ra, và nó đã đủ hàng (drain chạy mỗi ~15 giây, dòng hàng
--     tới sau 0,5 giây nên gần như luôn kịp).
--   • Nếu chẳng may drain chen vào đúng khe 0,5 giây đó và đã gửi bản rỗng,
--     bản phát lại rơi vào nhánh `editMessageText` ⇒ **sửa lại đúng tin cũ**
--     tại chỗ. Tin tự lành, không cần ai can thiệp.
--
-- 🪤 Fingerprint của bản phát lại PHẢI khác bản đầu, vì `fn_notify_emit`
--    thoát sớm khi thấy đúng fingerprint đó đang `pending`. Thêm dấu thời
--    gian vào đoạn thứ BA — hai đoạn đầu là `subject_key`, phải giữ nguyên
--    thì cơ chế đè/sửa mới nhận ra đây vẫn là tin của cùng một phiếu.
--
-- 🪤 Transition table (`REFERENCING NEW TABLE`) chỉ gắn được cho trigger có
--    MỘT sự kiện ⇒ phải tách làm ba trigger INSERT / UPDATE / DELETE.
--    Dùng trigger mức CÂU LỆNH, không phải mức dòng: màn nhập kho ghi cả 25
--    dòng bằng một câu INSERT, nên một lần dựng tin là đủ thay vì 25 lần.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fn_notify_receipt_payload — MỘT nơi duy nhất dựng tin phiếu nhập
-- ═══════════════════════════════════════════════════════════════════════════
-- Tách khỏi trigger để cả trigger đầu phiếu lẫn trigger dòng hàng dùng chung.
-- Trả NULL khi trạng thái không phải loại cần báo.
CREATE OR REPLACE FUNCTION public.fn_notify_receipt_payload(p_receipt_id UUID)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  gr     RECORD;
  v_evt  TEXT;
  v_tieude TEXT;
  v_branch UUID; v_cn TEXT; v_wh TEXT; v_sup TEXT; v_who TEXT;
  v_n INTEGER; v_sp TEXT; v_canh BOOLEAN := false; v_luc TEXT; v_text TEXT;
BEGIN
  SELECT * INTO gr FROM public.goods_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_evt := CASE gr.status
             WHEN 'draft'     THEN 'receipt.draft'
             WHEN 'verified'  THEN 'receipt.verified'
             WHEN 'completed' THEN 'receipt.completed'
             WHEN 'cancelled' THEN 'receipt.cancelled'
             ELSE NULL END;
  IF v_evt IS NULL THEN RETURN NULL; END IF;

  v_tieude := CASE v_evt WHEN 'receipt.draft'     THEN '📝 PHIẾU NHẬP NHÁP'
                         WHEN 'receipt.verified'  THEN '📥 PHIẾU NHẬP ĐÃ KIỂM'
                         WHEN 'receipt.completed' THEN '📥 NHẬP KHO HOÀN TẤT'
                         ELSE '🚫 HUỶ PHIẾU NHẬP' END;

  SELECT w.branch_id, w.name INTO v_branch, v_wh
    FROM public.warehouses w WHERE w.id = gr.warehouse_id;
  SELECT b.name INTO v_cn  FROM public.branches  b WHERE b.id = v_branch;
  SELECT s.name INTO v_sup FROM public.suppliers s WHERE s.id = gr.supplier_id;
  SELECT p.full_name INTO v_who FROM public.profiles p
   WHERE p.id = COALESCE(gr.completed_by, gr.verified_by, gr.received_by);

  SELECT count(*) INTO v_n FROM public.goods_receipt_lines WHERE receipt_id = gr.id;

  v_luc := to_char(timezone('Asia/Ho_Chi_Minh',
             COALESCE(gr.completed_at, gr.verified_at, gr.created_at, now())),
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
  FROM (SELECT * FROM public.goods_receipt_lines WHERE receipt_id = gr.id
         ORDER BY created_at LIMIT 25) l
  JOIN public.products pr ON pr.id = l.product_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(l2.unit_price,0) AS last_price
    FROM public.goods_receipt_lines l2
    JOIN public.goods_receipts g2 ON g2.id = l2.receipt_id
    WHERE l2.product_id = l.product_id AND g2.id <> gr.id
      AND g2.status IN ('verified','completed')
      AND g2.receipt_date <= COALESCE(gr.receipt_date, current_date)
    ORDER BY g2.receipt_date DESC, g2.created_at DESC LIMIT 1
  ) prev ON true;

  v_canh := COALESCE(v_sp,'') LIKE '%lệch giá%';

  v_text := CASE WHEN v_canh THEN '🔴 ' ELSE '' END
   || v_tieude || ' <b>' || public.fn_tg_escape(gr.receipt_code) || '</b>'
   || E'\n🏢 ' || public.fn_tg_escape(COALESCE(v_cn,'—'))
   || COALESCE(' — kho ' || public.fn_tg_escape(v_wh), '')
   || E'\n🕐 ' || v_luc
   || E'\n🏭 NCC: <b>' || public.fn_tg_escape(COALESCE(v_sup,'—')) || '</b>'
   || E'\n🧑‍💼 Người thực hiện: ' || public.fn_tg_escape(COALESCE(v_who,'—'))
   || CASE WHEN gr.gsheet_source_id IS NOT NULL
           THEN E'\n☁️ <i>Sinh tự động từ Google Drive</i>' ELSE '' END
   || E'\n\n📦 <b>Hàng (' || COALESCE(v_n,0) || ' dòng)</b>' || E'\n'
   || COALESCE(v_sp, '(chưa có dòng hàng)')
   || CASE WHEN COALESCE(v_n,0) > 25 THEN E'\n… và ' || (v_n-25) || ' dòng nữa' ELSE '' END
   || E'\n\n────────────────'
   || E'\n💰 <b>TỔNG: ' || public.fn_notify_vnd(gr.total_amount) || '</b>'
   || COALESCE(E'\n📝 ' || public.fn_tg_escape(gr.notes), '')
   || CASE WHEN v_canh THEN E'\n\n🔴 <b>KIỂM LẠI GIÁ NHẬP</b> — có dòng lệch trên 30% so '
        || 'lần nhập gần nhất. Hay gặp nhất là gõ nhầm cột số lượng sang cột đơn giá.'
        ELSE '' END;

  RETURN jsonb_build_object(
    'evt',       v_evt,
    'branch_id', v_branch,
    'text',      v_text,
    'line',      gr.receipt_code || ' · ' || public.fn_notify_vnd(gr.total_amount),
    'tong',      gr.total_amount,
    'so_dong',   COALESCE(v_n,0),
    'lech_gia',  v_canh);
END;
$$;

COMMENT ON FUNCTION public.fn_notify_receipt_payload(UUID) IS
  'Dựng nội dung tin Telegram cho một phiếu nhập theo TRẠNG THÁI HIỆN TẠI của nó. '
  'Luôn đọc lại từ bảng nên số dòng hàng và tổng tiền là số cuối cùng, không phải '
  'ảnh chụp lúc trigger nổ. Dùng chung cho trigger đầu phiếu và trigger dòng hàng.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Trigger đầu phiếu — hoãn tới commit + đọc lại
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_notify_goods_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_pl JSONB;
BEGIN
  -- Constraint trigger không nhận `UPDATE OF status`, phải tự lọc.
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  v_pl := public.fn_notify_receipt_payload(NEW.id);
  IF v_pl IS NULL THEN RETURN NULL; END IF;

  PERFORM public.fn_notify_emit(
    v_pl->>'evt',
    NULLIF(v_pl->>'branch_id','')::uuid,
    v_pl - 'evt' - 'branch_id',
    (v_pl->>'evt') || ':' || NEW.id);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;   -- tin hỏng không được cản việc nhập hàng
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_goods_receipt ON public.goods_receipts;
CREATE CONSTRAINT TRIGGER trg_notify_goods_receipt
  AFTER INSERT OR UPDATE ON public.goods_receipts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_goods_receipt();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Trigger dòng hàng — dựng lại tin khi hàng vào/đổi/ra
-- ═══════════════════════════════════════════════════════════════════════════
-- Hai hàm gần giống nhau, khác đúng tên bảng chuyển tiếp: plpgsql đọc tên bảng
-- lúc CHẠY chứ không truyền được vào như tham số, nên không gộp làm một được.
DROP TRIGGER IF EXISTS trg_notify_receipt_lines_ins ON public.goods_receipt_lines;
DROP TRIGGER IF EXISTS trg_notify_receipt_lines_upd ON public.goods_receipt_lines;
DROP TRIGGER IF EXISTS trg_notify_receipt_lines_del ON public.goods_receipt_lines;

-- INSERT / UPDATE: lấy phiếu từ ảnh mới.
-- Đoạn thứ BA của fingerprint (dấu thời gian) làm nó khác bản đầu để không bị
-- `fn_notify_emit` chặn, nhưng hai đoạn đầu — tức `subject_key` — vẫn là của
-- cùng phiếu này, nên bản mới ĐÈ bản chưa gửi, hoặc SỬA tin đã gửi.
CREATE OR REPLACE FUNCTION public.trg_notify_receipt_lines_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r RECORD; v_pl JSONB;
BEGIN
  FOR r IN SELECT DISTINCT receipt_id FROM anh_moi WHERE receipt_id IS NOT NULL LOOP
    v_pl := public.fn_notify_receipt_payload(r.receipt_id);
    CONTINUE WHEN v_pl IS NULL;
    PERFORM public.fn_notify_emit(v_pl->>'evt', NULLIF(v_pl->>'branch_id','')::uuid,
      v_pl - 'evt' - 'branch_id',
      (v_pl->>'evt') || ':' || r.receipt_id || ':'
        || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS'));
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

-- UPDATE / DELETE: lấy phiếu từ ảnh cũ (dòng có thể đã đổi phiếu, hiếm nhưng rẻ).
CREATE OR REPLACE FUNCTION public.trg_notify_receipt_lines_old()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r RECORD; v_pl JSONB;
BEGIN
  FOR r IN SELECT DISTINCT receipt_id FROM anh_cu WHERE receipt_id IS NOT NULL LOOP
    v_pl := public.fn_notify_receipt_payload(r.receipt_id);
    CONTINUE WHEN v_pl IS NULL;
    PERFORM public.fn_notify_emit(v_pl->>'evt', NULLIF(v_pl->>'branch_id','')::uuid,
      v_pl - 'evt' - 'branch_id',
      (v_pl->>'evt') || ':' || r.receipt_id || ':'
        || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS'));
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

CREATE TRIGGER trg_notify_receipt_lines_ins
  AFTER INSERT ON public.goods_receipt_lines
  REFERENCING NEW TABLE AS anh_moi
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_notify_receipt_lines_ins();

CREATE TRIGGER trg_notify_receipt_lines_upd
  AFTER UPDATE ON public.goods_receipt_lines
  REFERENCING NEW TABLE AS anh_moi
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_notify_receipt_lines_ins();

CREATE TRIGGER trg_notify_receipt_lines_del
  AFTER DELETE ON public.goods_receipt_lines
  REFERENCING OLD TABLE AS anh_cu
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_notify_receipt_lines_old();

REVOKE ALL ON FUNCTION public.fn_notify_receipt_payload(UUID) FROM public, anon;

NOTIFY pgrst, 'reload schema';
