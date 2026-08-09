-- ═══════════════════════════════════════════════════════════════════════════
-- SỬA CÂU CHỮ "chat not found" CHO ĐÚNG NGUYÊN NHÂN THẬT
-- 2026-08-09
--
-- Bản `20260794` viết: "id nhóm sai, hoặc bot CHƯA từng được thêm vào nhóm".
-- Kiểm ca thật đầu tiên (Trại Hồng Lãm Gò Thị, chat -5506646654): user xác
-- nhận **id hoàn toàn đúng**, và `notification_log` cho thấy hệ thống **chưa
-- từng gửi một tin nào** vào nhóm đó. Tức là nguyên nhân áp đảo không phải
-- "id sai" mà là **bot chưa có mặt trong nhóm** — Telegram không cho bot nhìn
-- thấy nhóm mà nó không phải thành viên, nên trả `chat not found` chứ không
-- trả `left`/`kicked` như khi bot từng ở trong nhóm rồi bị đuổi.
--
-- Xếp sai thứ tự nguyên nhân thì nhân viên đi dò lại id — việc vô ích — thay
-- vì làm đúng một việc: thêm bot vào nhóm.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_tg_reason(p_desc TEXT, p_code INTEGER)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_desc,'') ILIKE '%bot was kicked%'
      THEN 'Bot đã bị xoá khỏi nhóm. Thêm lại @crmsanhlongbot vào nhóm rồi bấm "Kiểm tra lại".'
    WHEN COALESCE(p_desc,'') ILIKE '%bot is not a member%'
      THEN 'Bot không còn trong nhóm. Thêm lại @crmsanhlongbot vào nhóm rồi bấm "Kiểm tra lại".'
    WHEN COALESCE(p_desc,'') ILIKE '%group chat was deleted%'
      THEN 'Nhóm Telegram đã bị xoá. Cần tạo nhóm mới và dán id mới vào hồ sơ.'
    WHEN COALESCE(p_desc,'') ILIKE '%chat not found%'
      THEN 'Bot @crmsanhlongbot CHƯA có trong nhóm này — hãy mở nhóm trên Telegram và '
           || 'thêm bot vào, rồi bấm "Kiểm tra lại". (Telegram không cho bot thấy nhóm mà '
           || 'nó không phải thành viên. Nếu đã thêm bot mà vẫn báo lỗi thì mới soát lại id nhóm.)'
    WHEN COALESCE(p_desc,'') ILIKE '%not enough rights%'
      OR COALESCE(p_desc,'') ILIKE '%have no rights to send%'
      THEN 'Bot đang bị cấm gửi tin trong nhóm. Vào nhóm mở lại quyền gửi tin cho bot.'
    WHEN COALESCE(p_desc,'') ILIKE '%user is deactivated%'
      THEN 'Tài khoản Telegram này đã bị vô hiệu hoá.'
    WHEN COALESCE(p_desc,'') <> '' THEN 'Telegram báo: ' || p_desc
    ELSE 'Telegram trả lỗi HTTP ' || COALESCE(p_code::text, '?')
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_tg_reason(TEXT, INTEGER) FROM public, anon;

-- Cập nhật luôn câu chữ đang hiện trên hồ sơ khách, khỏi phải chờ lần gửi sau.
UPDATE public.customers
   SET telegram_last_error = public.fn_tg_reason('chat not found', 400)
 WHERE telegram_last_error ILIKE '%Không tìm thấy nhóm%';

NOTIFY pgrst, 'reload schema';
