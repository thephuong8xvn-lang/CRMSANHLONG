-- ═══════════════════════════════════════════════════════════════════════════
-- BẬT REALTIME CHO 2 BẢNG CÔNG NỢ
-- 2026-08-05
--
-- Module /debts đăng ký `postgres_changes` trên `debt_payments` và
-- `customer_debts`, nhưng publication `supabase_realtime` trước đó CHỈ có
-- bảng `orders` → đăng ký là no-op câm, không sự kiện nào tới.
--
-- Ghi chú vận hành:
--   • Realtime TÔN TRỌNG RLS: client chỉ nhận được dòng mà chính họ SELECT
--     được. `customer_debts`/`debt_payments` chốt theo `customers.collect_debt`
--     → nhân viên chỉ có `reports.debt` (xem qua RPC SECURITY DEFINER) sẽ KHÔNG
--     nhận sự kiện. Với họ trang vẫn tươi nhờ staleTime 60s + nút Làm mới.
--   • Phía FE gom sự kiện (throttle 5s) để một loạt đơn POS không tạo bão
--     refetch — xem `DebtManagementPage.tsx`.
--   • REPLICA IDENTITY để nguyên mặc định (chỉ khóa chính): payload chỉ cần
--     báo "có thay đổi", trang tự gọi lại RPC. Đặt FULL sẽ đẩy cả dòng dữ liệu
--     công nợ qua realtime — vừa tốn băng thông vừa lộ dữ liệu không cần thiết.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'debt_payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.debt_payments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'customer_debts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_debts;
  END IF;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260756000000', 'realtime_debt_tables')
ON CONFLICT (version) DO NOTHING;
