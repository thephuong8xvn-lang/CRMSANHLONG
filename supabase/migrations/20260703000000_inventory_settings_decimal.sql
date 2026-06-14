-- Migration: Cho phép ngưỡng tồn kho theo số thập phân (hàng bán theo cân/lít).
-- File: 20260703000000_inventory_settings_decimal.sql
--
-- Bối cảnh: các cột số lượng giao dịch (goods_receipt_lines, stock_lots, order_lines...)
-- đã là NUMERIC(15,3) từ migration 20260529000012. Riêng ngưỡng cấu hình tồn kho
-- trong inventory_settings vẫn là INTEGER → nhập 18,5 bị làm tròn. Nới sang NUMERIC(15,3).
--
-- inventory_settings.min_stock_level được fn_check_stock_alerts đọc động (RECORD),
-- không có view nào phụ thuộc 4 cột này (product_reorder_view tham chiếu products.min_stock_level,
-- là cột khác) nên ALTER TYPE an toàn, không cần drop view.

ALTER TABLE public.inventory_settings
  ALTER COLUMN min_stock_level  TYPE NUMERIC(15, 3),
  ALTER COLUMN max_stock_level  TYPE NUMERIC(15, 3),
  ALTER COLUMN reorder_point    TYPE NUMERIC(15, 3),
  ALTER COLUMN reorder_quantity TYPE NUMERIC(15, 3);
