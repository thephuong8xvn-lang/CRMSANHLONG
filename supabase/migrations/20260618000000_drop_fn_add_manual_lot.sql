-- ============================================================
-- Migration: drop_fn_add_manual_lot
-- File: 20260618000000_drop_fn_add_manual_lot.sql
-- Mục đích: GỠ BỎ HOÀN TOÀN tính năng "Nhập kho / Thêm lô hàng" thủ công
--   tại trang chi tiết sản phẩm (ProductDetailPage).
--
-- Lý do (toàn vẹn dữ liệu): hàm này cho phép tạo tồn kho (stock_lots)
--   KHÔNG qua Phiếu nhập kho chuẩn (GoodsReceipt) → không gắn nhà cung cấp,
--   không gắn PO, không có chứng từ nhập. Sau khi gỡ, đường tăng tồn kho
--   duy nhất là Phiếu nhập NCC (có truy vết đầy đủ).
--
-- An toàn: chỉ DROP định nghĩa hàm. Dữ liệu lô (stock_lots) và Thẻ kho
--   (stock_movements) đã tạo trước đây qua tính năng này GIỮ NGUYÊN — chúng
--   là dữ liệu tồn kho hợp lệ, không bị ảnh hưởng.
--
-- Hàm này được gọi DUY NHẤT từ ProductDetailPage (đã grep toàn repo), nay
--   frontend đã gỡ → không còn caller nào.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_add_manual_lot(UUID, UUID, TEXT, DATE, DATE, NUMERIC, NUMERIC);
