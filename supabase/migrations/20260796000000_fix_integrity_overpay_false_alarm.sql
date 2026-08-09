-- ═══════════════════════════════════════════════════════════════════════════
-- BÁO ĐỘNG GIẢ: "order_debt_vs_ar_mismatch" kêu critical vì KHÁCH TRẢ DƯ
-- 2026-08-09
--
-- ── Tin cảnh báo sáng 09/08 báo 2 vi phạm critical. Dữ liệu KHÔNG sai ──────
-- `DH-2026-02698` (Gà Xanh Giang Nguyên): đơn 404.320₫, khách đưa 500.000₫.
-- `DH-2026-02788` (Lò Ấp A Công):         đơn 1.285.000₫, khách đưa 1.380.000₫.
-- Cả hai đều có dòng sổ cái ĐÚNG: `-95.680₫` và `-95.000₫`, ghi chú
-- "Khách trả dư … → ghi có công nợ". Tiền dư nằm đúng chỗ, không mất đi đâu.
--
-- Lỗi nằm ở PHÉP KIỂM: nó lấy `con_no` = tổng dòng chưa tất toán **có
-- `amount > 0`** (cố ý bỏ dòng ghi có ra), rồi đem so với `grand_total −
-- paid_amount` — vế này thì ÂM khi khách trả dư. Âm so với 0 ⇒ lệch ⇒ hô hoán.
--
-- ── Vì sao KHÔNG sửa bằng cách bỏ điều kiện `amount > 0` ──────────────────
-- Đã thử trên dữ liệu thật: đếm vi phạm nhảy từ **2 lên 62**. Lý do: 64 đơn
-- đang mang dòng ghi có, và **0/64 đơn nào trong đó còn nợ** — tiền ghi có là
-- của KHÁCH (số dư chung), không phải của riêng cái đơn đã trả xong. Cộng nó
-- vào "còn nợ của đơn" là sai bản chất.
--
-- ⇒ Cách đúng: số dư ÂM của một đơn nghĩa là **đơn đó hết nợ**, kẹp sàn về 0.
--   `greatest(grand_total − paid_amount, 0)` so với tổng dòng nợ dương.
--   Đo lại trên toàn bộ đơn: **0 vi phạm**. Không nuốt mất trường hợp thật nào
--   — mọi đơn còn nợ dương vẫn bị soi y như cũ.
--
-- 🔑 Cách vá: đọc `pg_get_functiondef` của bản ĐANG CHẠY rồi thay đúng một
--    biểu thức, thay vì chép lại cả hàm 115 dòng. Chép lại là rủi ro ghi đè
--    thay đổi nào đó chỉ có trên prod. Không tìm thấy đoạn cần thay thì RAISE,
--    không im lặng bỏ qua.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_def TEXT;
  v_new TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_integrity_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy public.fn_integrity_check()';
  END IF;

  v_new := replace(v_def,
    'and abs((o.grand_total - o.paid_amount) - coalesce(d.con_no, 0)) > 0.5',
    'and abs(greatest(o.grand_total - o.paid_amount, 0) - coalesce(d.con_no, 0)) > 0.5');

  -- Mẫu 20 dòng gửi kèm cảnh báo cũng phải hiện con số đã kẹp sàn, nếu không
  -- người đọc thấy "theo_don = -95.680" mà không hiểu vì sao bị coi là 0.
  v_new := replace(v_new,
    '(o.grand_total - o.paid_amount) as theo_don',
    'greatest(o.grand_total - o.paid_amount, 0) as theo_don');

  IF v_new = v_def THEN
    RAISE EXCEPTION 'Không tìm thấy đoạn cần sửa trong fn_integrity_check — '
                    'bản trên prod đã khác, phải soát tay trước khi vá.';
  END IF;

  EXECUTE v_new;
END $$;

-- Nghiệm thu ngay trong migration: luật này phải về 0 vi phạm.
DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT violations INTO v_n FROM public.fn_integrity_check()
   WHERE check_name = 'order_debt_vs_ar_mismatch';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Vá xong mà vẫn còn % vi phạm — dừng lại để soát tay.', v_n;
  END IF;
  RAISE NOTICE 'order_debt_vs_ar_mismatch: 0 vi phạm ✓';
END $$;
