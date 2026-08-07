-- ═══════════════════════════════════════════════════════════════════════════
-- THÔNG BÁO TELEGRAM — NHÓM THỬ NGHIỆM PHẢI LÀ NHÓM NỘI BỘ
-- 2026-08-07
--
-- ── Chuyện đã xảy ra ────────────────────────────────────────────────────
-- Đợt B lấy nhóm `-5347145958` ("Nhóm Gia cầm Ân Mỹ") làm nơi đổ tin ở chế độ
-- khô, vì lúc đó user nói đây là nhóm THỬ NGHIỆM.
-- Sau đó user đổi tên nhóm thành "Em Bảo Ân Hậu" và **gán chính nhóm đó cho
-- khách "Trại a Bảo-Ân Hậu" (KH-2026-00657)**.
--
-- ⇒ Nhóm thử nghiệm và nhóm của một khách THẬT trở thành cùng một nhóm.
-- ⇒ Chế độ khô dồn tin của MỌI khách về đó ⇒ khách Bảo sẽ đọc được đơn hàng,
--   số tiền và công nợ của những khách khác.
--
-- Chưa rò rỉ gì vì tới lúc này chưa có luật nào `audience='customer'` (đợt C
-- chưa làm), nhưng chỉ cần đợt C lên là hỏng ngay.
--
-- ── Quy tắc rút ra, ghi lại để không tái phạm ──────────────────────────
-- 🔴 **Nhóm ở `dry_run_chat_id` BẮT BUỘC là nhóm NỘI BỘ** (chỉ chủ + kế toán).
--    Bản chất của chế độ khô là "in ra cho người trong nhà xem trước". Đổ vào
--    một nhóm có người ngoài là tự phá mục đích của nó.
--
-- ⇒ Trỏ về nhóm nội bộ SANHLONGVETCO (-5426496767).
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.system_settings
   SET value = value || jsonb_build_object('dry_run_chat_id', '-5426496767'),
       updated_at = now()
 WHERE key = 'notification_config';

UPDATE public.telegram_channels
   SET chat_id = '-5426496767',
       label   = '🧪 Thử nghiệm (nhóm nội bộ)',
       note    = 'Nơi đổ tin ở chế độ khô. PHẢI là nhóm nội bộ — không bao giờ '
                 || 'trỏ vào nhóm của khách, vì chế độ khô gom tin của MỌI khách.',
       updated_at = now()
 WHERE code = 'thu_nghiem';

COMMENT ON TABLE public.telegram_channels IS
  'Kênh gửi cố định của nội bộ. Nhóm riêng của khách KHÔNG nằm ở đây mà ở '
  'customers.telegram_chat_id — tách bảng để không bao giờ lẫn nội bộ với khách.';

-- Chốt an toàn ở tầng dữ liệu: cảnh báo nếu ai đó lại trỏ nhóm thử vào nhóm
-- của một khách. Không chặn cứng (user có thể có lý do), nhưng phải la lên.
CREATE OR REPLACE FUNCTION public.fn_notify_config_audit()
RETURNS TABLE (van_de TEXT, chi_tiet TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT 'Nhóm thử nghiệm đang trỏ vào nhóm của khách'::TEXT,
         -- Ép ::text cho chuỗi đầu: nếu để literal "unknown" đứng cạnh một
         -- toán hạng jsonb thì `||` bị hiểu là NỐI JSON, không phải nối chuỗi.
         'chat_id '::text || (s.value->>'dry_run_chat_id') || ' là nhóm của khách "'
         || c.farm_name || '" (' || c.code || '). Chế độ khô gom tin của MỌI '
         || 'khách về đây ⇒ khách này sẽ đọc được đơn của người khác.'
    FROM public.system_settings s
    JOIN public.customers c ON c.telegram_chat_id = s.value->>'dry_run_chat_id'
   WHERE s.key = 'notification_config'

  UNION ALL

  SELECT 'Hai khách dùng chung một nhóm Telegram'::TEXT,
         'chat_id ' || a.telegram_chat_id || ' gắn cho cả "' || a.farm_name
         || '" và "' || b.farm_name || '"'
    FROM public.customers a
    JOIN public.customers b
      ON b.telegram_chat_id = a.telegram_chat_id AND b.id > a.id
   WHERE a.telegram_chat_id IS NOT NULL

  UNION ALL

  SELECT 'Nhóm của khách trùng với kênh nội bộ'::TEXT,
         'chat_id ' || c.telegram_chat_id || ' vừa là nhóm của khách "'
         || c.farm_name || '" vừa là kênh nội bộ "' || t.code || '"'
    FROM public.customers c
    JOIN public.telegram_channels t
      ON t.chat_id = c.telegram_chat_id AND t.enabled = true
   WHERE c.telegram_chat_id IS NOT NULL AND t.code <> 'thu_nghiem';
$$;

GRANT EXECUTE ON FUNCTION public.fn_notify_config_audit() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
