-- ═══════════════════════════════════════════════════════════════════════════
-- TẮT BIÊN NHẬN THU NỢ GỬI KHÁCH — CHỈ GIỮ TỔNG CÔNG NỢ TRONG HOÁ ĐƠN
-- 2026-08-08
--
-- User chốt: "chỉ cần gởi công nợ đến hiện tại là xong, mọi vấn đề khách thắc
-- mắc hoặc công nợ sai sẽ điều chỉnh."
--
-- ⇒ Khách KHÔNG nhận tin riêng mỗi lần thu tiền. Con số công nợ mà khách cần
--   biết đã nằm sẵn ở dòng "📊 Tổng công nợ hiện tại" trong mỗi phiếu giao
--   hàng, và nó luôn là số tại thời điểm gửi. Sai thì nhân viên chỉnh tay rồi
--   tin "🔁 ĐIỀU CHỈNH HOÁ ĐƠN" (`20260786`) mang số mới tới khách.
--
-- Ở `20260786` tôi đã hiểu rộng hơn ý user một bậc và có nói rõ điều đó. Đây
-- là bước thu lại.
--
-- 🔑 Chỉ TẮT LUẬT, không gỡ code trong `trg_notify_debt_payment`:
--   `fn_notify_emit` thoát ngay khi luật không `enabled` (`20260769:107-109`)
--   nên phần sinh tin thành vô hiệu hoàn toàn — không tốn một dòng ghi nào.
--   Muốn bật lại chỉ cần `enabled = true`, khỏi phải viết lại hàm.
--   Tin thu nợ NỘI BỘ (`debt.payment`) giữ nguyên, không đụng.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.notification_rules
   SET enabled = false, updated_at = now()
 WHERE event_type = 'debt.payment_customer';

-- Dập mọi biên nhận còn đang chờ trong cửa sổ 3 phút, nếu có.
UPDATE public.notification_events
   SET status = 'skipped', processed_at = now()
 WHERE event_type = 'debt.payment_customer' AND status = 'pending';

COMMENT ON FUNCTION public.trg_notify_debt_payment() IS
  'Tin thu nợ. Phần gửi KHÁCH (debt.payment_customer) đang TẮT theo quyết định của '
  'user 2026-08-08: khách chỉ cần thấy tổng công nợ trong hoá đơn, không cần biên '
  'nhận riêng mỗi lần thu tiền. Bật lại bằng notification_rules.enabled = true.';

NOTIFY pgrst, 'reload schema';
