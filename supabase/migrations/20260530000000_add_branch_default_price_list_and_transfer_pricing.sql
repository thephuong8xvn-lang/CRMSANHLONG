-- 20260530000000_add_branch_default_price_list_and_transfer_pricing.sql

-- 1. Bảng giá mặc định cho chi nhánh
ALTER TABLE public.branches 
ADD COLUMN default_price_list_id UUID REFERENCES public.price_lists(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.branches.default_price_list_id IS 'Bảng giá mặc định của chi nhánh';

-- 2. Giá chuyển kho nội bộ
ALTER TABLE public.stock_transfer_lines
ADD COLUMN unit_price NUMERIC(15,2) DEFAULT 0;

COMMENT ON COLUMN public.stock_transfer_lines.unit_price IS 'Đơn giá chuyển kho / bán nội bộ';

-- 3. Tổng giá trị phiếu chuyển kho
ALTER TABLE public.stock_transfers
ADD COLUMN total_amount NUMERIC(15,2) DEFAULT 0;

COMMENT ON COLUMN public.stock_transfers.total_amount IS 'Tổng giá trị của phiếu chuyển kho';
