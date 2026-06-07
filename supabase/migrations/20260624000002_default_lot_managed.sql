-- ============================================================
-- Migration: default_lot_managed
-- File: 20260624000002_default_lot_managed.sql
-- Mục đích: MẶC ĐỊNH mọi sản phẩm "Quản lý theo lô" (bắt buộc số lô & HSD).
--   - Đổi default cột products.is_lot_managed: false → true (SP mới tự bật).
--   - Backfill toàn bộ SP hiện có sang true.
-- (Việc trừ kho khi bán đã áp cho MỌI SP từ 20260624000000 — không phụ thuộc
--  cờ này nữa; cờ nay chỉ còn ý nghĩa "bắt buộc nhập số lô & hạn dùng".)
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema.
-- ============================================================

ALTER TABLE public.products
  ALTER COLUMN is_lot_managed SET DEFAULT true;

UPDATE public.products
  SET is_lot_managed = true, updated_at = now()
  WHERE is_lot_managed = false;

NOTIFY pgrst, 'reload schema';
