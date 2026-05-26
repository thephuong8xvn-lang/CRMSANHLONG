-- ============================================================
-- CRM SANHLONGVETCO – FUNCTIONS & TRIGGERS
-- File: 20260522000001_triggers.sql
-- Mô tả: Toàn bộ functions và triggers nghiệp vụ
-- Thứ tự chạy: sau 20260522000000_init_schema.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A. AUTO-UPDATE updated_at
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Gắn trigger updated_at cho tất cả các bảng có cột này
CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_warehouses_updated_at
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_price_lists_updated_at
  BEFORE UPDATE ON public.price_lists
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_cust_contacts_updated_at
  BEFORE UPDATE ON public.customer_contacts
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_farms_updated_at
  BEFORE UPDATE ON public.farms
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_herds_updated_at
  BEFORE UPDATE ON public.herds
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_returns_updated_at
  BEFORE UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_goods_receipts_updated_at
  BEFORE UPDATE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_stock_lots_updated_at
  BEFORE UPDATE ON public.stock_lots
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_inv_settings_updated_at
  BEFORE UPDATE ON public.inventory_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_stock_transfers_updated_at
  BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_cash_funds_updated_at
  BEFORE UPDATE ON public.cash_funds
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_cashbook_updated_at
  BEFORE UPDATE ON public.cashbook_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_opportunities_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON public.sales_schedules
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_herd_projects_updated_at
  BEFORE UPDATE ON public.herd_projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_herd_steps_updated_at
  BEFORE UPDATE ON public.herd_project_steps
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- B. TỰ TẠO PROFILE KHI USER ĐĂNG KÝ / ĐĂNG NHẬP LẦN ĐẦU
-- Xử lý: Email/Password và Google OAuth
-- Chống trùng: INSERT ... ON CONFLICT DO NOTHING
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider  TEXT;
  v_full_name TEXT;
  v_avatar    TEXT;
  v_default_role_id UUID;
BEGIN
  -- Xác định provider từ metadata
  v_provider := COALESCE(
    NEW.raw_app_meta_data->>'provider',
    'email'
  );

  -- Lấy tên hiển thị (Google trả về qua raw_user_meta_data)
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  v_avatar := NEW.raw_user_meta_data->>'avatar_url';

  -- Tạo profile nếu chưa tồn tại (ON CONFLICT DO NOTHING chống trùng)
  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, auth_providers, is_active
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_avatar,
    ARRAY[v_provider],
    true
  )
  ON CONFLICT (id) DO NOTHING;

  -- Nếu profile đã tồn tại → cập nhật auth_providers nếu provider mới
  UPDATE public.profiles
  SET
    auth_providers = array_append(auth_providers, v_provider),
    updated_at     = now()
  WHERE id = NEW.id
    AND NOT (v_provider = ANY(auth_providers));

  -- Gán role mặc định cho user mới (nếu là email hệ thống tối cao -> admin + ceo, ngược lại -> sales)
  IF NEW.email = 'admin@sanhlongvetco.vn' THEN
    -- Admin
    SELECT id INTO v_default_role_id FROM public.roles WHERE code = 'admin' LIMIT 1;
    IF v_default_role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (NEW.id, v_default_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;
    
    -- CEO
    SELECT id INTO v_default_role_id FROM public.roles WHERE code = 'ceo' LIMIT 1;
    IF v_default_role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (NEW.id, v_default_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;
  ELSE
    -- Sales
    SELECT id INTO v_default_role_id FROM public.roles WHERE code = 'sales' LIMIT 1;
    IF v_default_role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (NEW.id, v_default_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Gắn trigger vào auth.users (chạy khi có user mới)
CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- C. CẬP NHẬT auth_providers KHI LINK THÊM GOOGLE
-- Kích hoạt khi Supabase ghi vào auth.identities
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_linked_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Chỉ xử lý các provider đã biết (email, google)
  IF NEW.provider NOT IN ('email', 'google') THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles
  SET
    auth_providers = array_append(auth_providers, NEW.provider),
    updated_at     = now()
  WHERE id = NEW.user_id
    AND NOT (NEW.provider = ANY(auth_providers));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_identity_linked
  AFTER INSERT ON auth.identities
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_linked_identity();

-- ─────────────────────────────────────────────────────────────
-- D. TỰ ĐIỀN branch_id VÀ team_id TỪ OWNER
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_fill_org_from_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team_id   UUID;
  v_branch_id UUID;
BEGIN
  SELECT team_id, branch_id INTO v_team_id, v_branch_id
  FROM public.profiles
  WHERE id = NEW.owner_user_id;

  -- Chỉ điền nếu chưa có giá trị
  IF NEW.team_id IS NULL THEN
    NEW.team_id := v_team_id;
  END IF;

  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := v_branch_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customers_fill_org
  BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_fill_org_from_owner();

CREATE TRIGGER trg_opportunities_fill_org
  BEFORE INSERT ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.fn_fill_org_from_owner();

CREATE TRIGGER trg_orders_fill_org
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_fill_org_from_owner();

CREATE TRIGGER trg_activities_fill_org
  BEFORE INSERT ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.fn_fill_org_from_owner();

CREATE TRIGGER trg_herd_projects_fill_org
  BEFORE INSERT ON public.herd_projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_fill_org_from_owner();

-- ─────────────────────────────────────────────────────────────
-- E. SINH MÃ SỐ TỰ ĐỘNG
-- Định dạng: PREFIX-YYYY-NNNNN (VD: KH-2026-00001)
-- Sử dụng bảng code_sequences để quản lý số thứ tự
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_generate_code(
  p_code_type TEXT,
  p_pad_length INTEGER DEFAULT 5
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix     TEXT;
  v_year       INTEGER;
  v_current_no INTEGER;
  v_new_no     INTEGER;
  v_code       TEXT;
BEGIN
  v_year := EXTRACT(YEAR FROM now())::INTEGER;

  -- Reset số thứ tự nếu sang năm mới
  UPDATE public.code_sequences
  SET
    year_part  = v_year,
    current_no = CASE WHEN year_part <> v_year THEN 0 ELSE current_no END,
    updated_at = now()
  WHERE code_type = p_code_type
  RETURNING prefix, current_no + 1 INTO v_prefix, v_new_no;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code_type % không tồn tại trong code_sequences', p_code_type;
  END IF;

  -- Tăng số thứ tự
  UPDATE public.code_sequences
  SET current_no = v_new_no
  WHERE code_type = p_code_type;

  v_code := v_prefix || '-' || v_year::TEXT || '-' || lpad(v_new_no::TEXT, p_pad_length, '0');

  RETURN v_code;
END;
$$;

-- Trigger sinh mã cho customers
CREATE OR REPLACE FUNCTION public.fn_auto_customer_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := public.fn_generate_code('customer', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customers_code
  BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_customer_code();

-- Trigger sinh mã cho orders
CREATE OR REPLACE FUNCTION public.fn_auto_order_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_code IS NULL OR NEW.order_code = '' THEN
    NEW.order_code := public.fn_generate_code('order', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_code
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_order_code();

-- Trigger sinh mã cho quotes
CREATE OR REPLACE FUNCTION public.fn_auto_quote_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quote_code IS NULL OR NEW.quote_code = '' THEN
    NEW.quote_code := public.fn_generate_code('quote', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quotes_code
  BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_quote_code();

-- Trigger sinh mã cho opportunities
CREATE OR REPLACE FUNCTION public.fn_auto_opportunity_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opp_code IS NULL OR NEW.opp_code = '' THEN
    NEW.opp_code := public.fn_generate_code('opportunity', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_opportunities_code
  BEFORE INSERT ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_opportunity_code();

-- Trigger sinh mã cho herd_projects
CREATE OR REPLACE FUNCTION public.fn_auto_herd_project_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_code IS NULL OR NEW.project_code = '' THEN
    NEW.project_code := public.fn_generate_code('herd_project', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_herd_projects_code
  BEFORE INSERT ON public.herd_projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_herd_project_code();

-- Trigger sinh mã cho goods_receipts
CREATE OR REPLACE FUNCTION public.fn_auto_receipt_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receipt_code IS NULL OR NEW.receipt_code = '' THEN
    NEW.receipt_code := public.fn_generate_code('goods_receipt', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_receipts_code
  BEFORE INSERT ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_receipt_code();

-- Trigger sinh mã cho purchase_orders
CREATE OR REPLACE FUNCTION public.fn_auto_po_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.po_code IS NULL OR NEW.po_code = '' THEN
    NEW.po_code := public.fn_generate_code('purchase_order', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_po_code
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_po_code();

-- Trigger sinh mã cho sales_returns
CREATE OR REPLACE FUNCTION public.fn_auto_return_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.return_code IS NULL OR NEW.return_code = '' THEN
    NEW.return_code := public.fn_generate_code('sales_return', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_returns_code
  BEFORE INSERT ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_return_code();

-- Trigger sinh mã cho stock_transfers
CREATE OR REPLACE FUNCTION public.fn_auto_transfer_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transfer_code IS NULL OR NEW.transfer_code = '' THEN
    NEW.transfer_code := public.fn_generate_code('stock_transfer', 5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_transfer_code
  BEFORE INSERT ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_transfer_code();

-- Trigger sinh mã phiếu thu/chi (dựa trên flow_type)
CREATE OR REPLACE FUNCTION public.fn_auto_cashbook_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code_type TEXT;
BEGIN
  IF NEW.transaction_code IS NOT NULL AND NEW.transaction_code <> '' THEN
    RETURN NEW;
  END IF;

  CASE NEW.flow_type
    WHEN 'inflow'           THEN v_code_type := 'cash_receipt';
    WHEN 'outflow'          THEN v_code_type := 'cash_payment';
    WHEN 'internal_transfer' THEN v_code_type := 'supplier_payment';
  END CASE;

  NEW.transaction_code := public.fn_generate_code(v_code_type, 5);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cashbook_code
  BEFORE INSERT ON public.cashbook_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_cashbook_code();

-- ─────────────────────────────────────────────────────────────
-- F. TÍNH TỔNG ĐƠN HÀNG TỰ ĐỘNG
-- Cập nhật subtotal, discount_total, grand_total khi dòng thay đổi
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recalculate_order_total()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id   UUID;
  v_subtotal   NUMERIC(15,2);
  v_discount   NUMERIC(15,2);
BEGIN
  -- Xác định order_id từ dòng bị thay đổi
  IF TG_OP = 'DELETE' THEN
    v_order_id := OLD.order_id;
  ELSE
    v_order_id := NEW.order_id;
  END IF;

  -- Tính lại tổng
  SELECT
    COALESCE(SUM(unit_price * quantity), 0),
    COALESCE(SUM(discount * quantity), 0)
  INTO v_subtotal, v_discount
  FROM public.order_lines
  WHERE order_id = v_order_id;

  -- Cập nhật bảng orders
  UPDATE public.orders
  SET
    subtotal       = v_subtotal,
    discount_total = v_discount,
    grand_total    = v_subtotal - v_discount + shipping_fee,
    updated_at     = now()
  WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_order_lines_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.order_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_recalculate_order_total();

-- ─────────────────────────────────────────────────────────────
-- G. PHÂN BỔ LÔ HÀNG FEFO KHI XÁC NHẬN ĐƠN HÀNG
-- First Expired First Out: ưu tiên lô gần hết hạn nhất
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_allocate_lots_fefo(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_quantity     INTEGER
)
RETURNS TABLE (lot_id UUID, allocated_qty INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lot         RECORD;
  v_remaining   INTEGER := p_quantity;
  v_available   INTEGER;
  v_alloc       INTEGER;
BEGIN
  -- Duyệt qua các lô còn hàng, sắp xếp theo FEFO
  FOR v_lot IN
    SELECT id, quantity_on_hand, quantity_reserved
    FROM public.stock_lots
    WHERE product_id   = p_product_id
      AND warehouse_id = p_warehouse_id
      AND status       = 'active'
      AND quantity_on_hand > quantity_reserved
    ORDER BY
      expiry_date   ASC NULLS LAST,   -- Lô hết hạn trước → xuất trước
      received_at   ASC               -- Tiebreak: nhập trước → xuất trước
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_available := v_lot.quantity_on_hand - v_lot.quantity_reserved;
    v_alloc     := LEAST(v_remaining, v_available);

    -- Cập nhật số lượng đã đặt trước
    UPDATE public.stock_lots
    SET quantity_reserved = quantity_reserved + v_alloc,
        updated_at        = now()
    WHERE id = v_lot.id;

    v_remaining := v_remaining - v_alloc;

    lot_id       := v_lot.id;
    allocated_qty := v_alloc;
    RETURN NEXT;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'Không đủ hàng trong kho. Còn thiếu % đơn vị cho sản phẩm %',
      v_remaining, p_product_id;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- H. TỰ ĐỘNG XUẤT KHO KHI ĐƠN HÀNG ĐƯỢC XÁC NHẬN
-- Áp dụng FEFO cho tất cả sản phẩm (is_lot_managed hoặc không)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_stock_on_order_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line        RECORD;
  v_alloc       RECORD;
  v_warehouse   UUID;
BEGIN
  -- Chỉ kích hoạt khi chuyển sang trạng thái 'confirmed'
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;

  v_warehouse := NEW.warehouse_id;

  FOR v_line IN
    SELECT ol.id AS line_id, ol.product_id, ol.quantity,
           p.is_lot_managed
    FROM   public.order_lines ol
    JOIN   public.products p ON p.id = ol.product_id
    WHERE  ol.order_id = NEW.id
  LOOP
    IF v_line.is_lot_managed AND v_warehouse IS NOT NULL THEN
      -- Phân bổ lô FEFO và ghi allocation
      FOR v_alloc IN
        SELECT * FROM public.fn_allocate_lots_fefo(
          v_line.product_id,
          v_warehouse,
          v_line.quantity
        )
      LOOP
        -- Ghi phân bổ chi tiết
        INSERT INTO public.order_line_allocations
          (order_line_id, lot_id, quantity)
        VALUES
          (v_line.line_id, v_alloc.lot_id, v_alloc.allocated_qty);

        -- Ghi phiếu xuất kho
        INSERT INTO public.stock_movements
          (lot_id, product_id, warehouse_id,
           movement_type, quantity,
           reference_id, reference_type, performed_by)
        VALUES
          (v_alloc.lot_id, v_line.product_id, v_warehouse,
           'sale', -v_alloc.allocated_qty,
           NEW.id, 'order', NEW.confirmed_by);

        -- Giảm số lượng tồn kho thực tế và giải phóng reserved
        UPDATE public.stock_lots
        SET
          quantity_on_hand = quantity_on_hand - v_alloc.allocated_qty,
          quantity_reserved = quantity_reserved - v_alloc.allocated_qty,
          updated_at        = now()
        WHERE id = v_alloc.lot_id;
      END LOOP;
    END IF;
  END LOOP;

  -- Ghi nhận thời điểm xác nhận đơn hàng
  NEW.confirmed_at := now();

  -- Ghi lịch sử thay đổi trạng thái
  INSERT INTO public.order_status_history
    (order_id, from_status, to_status, changed_by)
  VALUES
    (NEW.id, OLD.status, NEW.status, COALESCE(NEW.confirmed_by, auth.uid()));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_auto_stock
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stock_on_order_confirm();

-- Ghi lịch sử thay đổi trạng thái cho mọi trường hợp đổi status
CREATE OR REPLACE FUNCTION public.fn_track_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status <> 'confirmed'  -- confirmed đã được xử lý ở trigger trên
  THEN
    INSERT INTO public.order_status_history
      (order_id, from_status, to_status, changed_by)
    VALUES
      (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_track_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_track_order_status();

-- ─────────────────────────────────────────────────────────────
-- I. CẬP NHẬT SỐ DƯ QUỸ KHI CÓ GIAO DỊCH SỔ QUỸ
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_update_fund_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta NUMERIC(15,2);
BEGIN
  -- Chỉ cập nhật khi phiếu được duyệt (approved)
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;
    IF NEW.status <> 'approved' THEN RETURN NEW; END IF;
  END IF;

  IF NEW.flow_type = 'inflow' THEN
    v_delta := NEW.amount;
  ELSIF NEW.flow_type = 'outflow' THEN
    v_delta := -NEW.amount;
  ELSE
    RETURN NEW; -- internal_transfer xử lý riêng
  END IF;

  -- Cập nhật số dư quỹ tiền mặt
  IF NEW.cash_fund_id IS NOT NULL THEN
    UPDATE public.cash_funds
    SET balance = balance + v_delta, updated_at = now()
    WHERE id = NEW.cash_fund_id;
  END IF;

  -- Cập nhật số dư tài khoản ngân hàng
  IF NEW.bank_account_id IS NOT NULL THEN
    UPDATE public.bank_accounts
    SET balance = balance + v_delta, updated_at = now()
    WHERE id = NEW.bank_account_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cashbook_update_balance
  AFTER UPDATE ON public.cashbook_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_fund_balance();

-- ─────────────────────────────────────────────────────────────
-- J. NHẬP KHO: TẠO STOCK_LOT VÀ STOCK_MOVEMENT
-- Khi phiếu nhập kho được tạo
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_create_stock_lot_on_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt RECORD;
BEGIN
  -- Lấy thông tin phiếu nhập
  SELECT supplier_id, warehouse_id, received_by
  INTO v_receipt
  FROM public.goods_receipts
  WHERE id = NEW.receipt_id;

  -- Tạo hoặc cập nhật lô hàng
  INSERT INTO public.stock_lots (
    product_id, warehouse_id, supplier_id, receipt_id,
    lot_number, manufacture_date, expiry_date,
    cost_price, quantity_on_hand
  )
  VALUES (
    NEW.product_id,
    v_receipt.warehouse_id,
    v_receipt.supplier_id,
    NEW.receipt_id,
    COALESCE(NEW.lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MISS')),
    NEW.manufacture_date,
    NEW.expiry_date,
    NEW.unit_price,
    NEW.quantity
  )
  ON CONFLICT (product_id, lot_number, warehouse_id) DO UPDATE
    SET quantity_on_hand = stock_lots.quantity_on_hand + EXCLUDED.quantity_on_hand,
        updated_at       = now();

  -- Ghi phiếu nhập kho
  INSERT INTO public.stock_movements (
    lot_id, product_id, warehouse_id,
    movement_type, quantity,
    reference_id, reference_type,
    unit_cost, performed_by
  )
  SELECT
    sl.id, NEW.product_id, v_receipt.warehouse_id,
    'receipt', NEW.quantity,
    NEW.receipt_id, 'goods_receipt',
    NEW.unit_price, v_receipt.received_by
  FROM public.stock_lots sl
  WHERE sl.product_id   = NEW.product_id
    AND sl.lot_number   = COALESCE(NEW.lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MISS'))
    AND sl.warehouse_id = v_receipt.warehouse_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_receipt_lines_create_lot
  AFTER INSERT ON public.goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_create_stock_lot_on_receipt();

-- ─────────────────────────────────────────────────────────────
-- K. CẢO BÁO TỒN KHO TỰ ĐỘNG
-- Kiểm tra sau mỗi lần xuất kho
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_check_stock_alerts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_setting    RECORD;
  v_total_qty  INTEGER;
BEGIN
  -- Tính tổng tồn kho theo product_id + warehouse_id
  SELECT
    COALESCE(SUM(quantity_on_hand - quantity_reserved), 0) AS available
  INTO v_total_qty
  FROM public.stock_lots
  WHERE product_id   = NEW.product_id
    AND warehouse_id = NEW.warehouse_id
    AND status       = 'active';

  -- Lấy cài đặt tồn kho
  SELECT * INTO v_setting
  FROM public.inventory_settings
  WHERE product_id   = NEW.product_id
    AND warehouse_id = NEW.warehouse_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Cảnh báo tồn kho dưới mức tối thiểu
  IF v_total_qty <= v_setting.min_stock_level THEN
    INSERT INTO public.inventory_alerts (
      product_id, warehouse_id, alert_type, severity, status, message,
      threshold_value, actual_value
    )
    VALUES (
      NEW.product_id, NEW.warehouse_id,
      'low_stock',
      CASE WHEN v_total_qty = 0 THEN 'critical' ELSE 'warning' END,
      'active',
      'Tồn kho thấp dưới mức tối thiểu. Hiện có: ' || v_total_qty || ' | Tối thiểu: ' || v_setting.min_stock_level,
      v_setting.min_stock_level,
      v_total_qty
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_lots_check_alert
  AFTER UPDATE ON public.stock_lots
  FOR EACH ROW
  WHEN (OLD.quantity_on_hand IS DISTINCT FROM NEW.quantity_on_hand)
  EXECUTE FUNCTION public.fn_check_stock_alerts();

-- ─────────────────────────────────────────────────────────────
-- L. AUDIT LOG TỰ ĐỘNG
-- Ghi lại mọi thay đổi trên các bảng nghiệp vụ chính
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action   TEXT;
  v_old_data JSONB := NULL;
  v_new_data JSONB := NULL;
  v_rec_id   UUID;
BEGIN
  IF    TG_OP = 'INSERT' THEN
    v_action   := 'INSERT';
    v_new_data := to_jsonb(NEW);
    v_rec_id   := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action   := 'UPDATE';
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    v_rec_id   := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_action   := 'DELETE';
    v_old_data := to_jsonb(OLD);
    v_rec_id   := OLD.id;
  END IF;

  INSERT INTO public.audit_logs
    (user_id, action, table_name, record_id, old_data, new_data)
  VALUES
    (auth.uid(), v_action, TG_TABLE_NAME, v_rec_id, v_old_data, v_new_data);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Gắn audit trigger cho các bảng nghiệp vụ quan trọng
CREATE TRIGGER trg_audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_audit_customers
  AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_audit_cashbook
  AFTER INSERT OR UPDATE OR DELETE ON public.cashbook_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_audit_opportunities
  AFTER INSERT OR UPDATE OR DELETE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_audit_stock_lots
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_lots
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- ─────────────────────────────────────────────────────────────
-- M. HELPER FUNCTIONS – Dùng trong RLS policies
-- ─────────────────────────────────────────────────────────────

-- Kiểm tra user có quyền không (RBAC)
CREATE OR REPLACE FUNCTION public.fn_has_permission(p_perm_code TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions pm ON pm.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND pm.code    = p_perm_code
  );
$$;

-- Lấy role codes của user hiện tại (dưới dạng mảng)
CREATE OR REPLACE FUNCTION public.fn_my_roles()
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(
    SELECT r.code
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
  );
$$;

-- Kiểm tra user có role cụ thể không
CREATE OR REPLACE FUNCTION public.fn_has_role(p_role_code TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_role_code = ANY(public.fn_my_roles());
$$;

-- Lấy team_id của user hiện tại
CREATE OR REPLACE FUNCTION public.fn_my_team_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT team_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Lấy branch_id của user hiện tại
CREATE OR REPLACE FUNCTION public.fn_my_branch_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Kiểm tra user có đang hoạt động không
CREATE OR REPLACE FUNCTION public.fn_is_active()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT is_active FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Kiểm tra user là admin hoặc CEO
CREATE OR REPLACE FUNCTION public.fn_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_has_role('admin') OR public.fn_has_role('ceo');
$$;

-- Lấy danh sách user_id trong cùng nhóm (dùng cho team lead policy)
CREATE OR REPLACE FUNCTION public.fn_my_team_member_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(
    SELECT id FROM public.profiles
    WHERE team_id   = public.fn_my_team_id()
      AND is_active = true
  );
$$;
