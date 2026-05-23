-- ============================================================
-- CRM SANHLONGVETCO – ROW LEVEL SECURITY (RLS) POLICIES
-- File: 20260522000002_rls.sql
-- Mô tả: Bật RLS trên 100% các bảng, cấu hình chính sách đầy đủ
-- Thứ tự chạy: sau 20260522000001_triggers.sql
--
-- Nguyên tắc phân quyền (Table-based RBAC):
--   admin / ceo        → xem & quản lý TOÀN BỘ hệ thống
--   branch_manager     → xem & quản lý dữ liệu trong chi nhánh mình
--   team_lead          → xem dữ liệu trong nhóm mình
--   sales              → chỉ thấy dữ liệu mình phụ trách
--   accountant         → xem toàn bộ tài chính, không xem dữ liệu sales riêng tư
--   warehouse_keeper   → quản lý kho, không xem dữ liệu khách hàng nhạy cảm
--   Mọi user phải fn_is_active() = true mới truy cập được
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- I. NHÓM BẢNG TỔ CHỨC
-- ─────────────────────────────────────────────────────────────

-- BẢNG: branches
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches_select_all_active" ON public.branches
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "branches_manage_admin" ON public.branches
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: warehouses
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouses_select_all_active" ON public.warehouses
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "warehouses_manage_admin" ON public.warehouses
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

-- BẢNG: teams
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_select_all_active" ON public.teams
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "teams_manage_admin" ON public.teams
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

-- ─────────────────────────────────────────────────────────────
-- II. NHÓM BẢNG PROFILES & RBAC
-- ─────────────────────────────────────────────────────────────

-- BẢNG: profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "profiles_select_branch_manager" ON public.profiles
  FOR SELECT USING (
    public.fn_has_role('branch_manager')
    AND public.fn_is_active()
    AND branch_id = public.fn_my_branch_id()
  );

CREATE POLICY "profiles_select_team_lead" ON public.profiles
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

-- Chỉ admin/HR tạo profile mới (thông thường qua trigger auth)
CREATE POLICY "profiles_insert_admin" ON public.profiles
  FOR INSERT WITH CHECK (public.fn_is_admin() AND public.fn_is_active());

-- Admin sửa bất kỳ profile
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (public.fn_is_admin() AND public.fn_is_active());

-- User tự cập nhật thông tin cá nhân của mình
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Chỉ admin xóa (thực ra là is_active = false)
CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE USING (public.fn_is_admin());

-- BẢNG: roles
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_select_all" ON public.roles
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "roles_manage_admin" ON public.roles
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: permissions
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permissions_select_all" ON public.permissions
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "permissions_manage_admin" ON public.permissions
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: role_permissions
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_permissions_select_all" ON public.role_permissions
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "role_permissions_manage_admin" ON public.role_permissions
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_select_admin" ON public.user_roles
  FOR SELECT USING (
    public.fn_is_admin()
    OR user_id = auth.uid()
  );

CREATE POLICY "user_roles_manage_admin" ON public.user_roles
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- ─────────────────────────────────────────────────────────────
-- III. NHÓM BẢNG SẢN PHẨM & GIÁ
-- (Catalog – mọi nhân viên xem được, chỉ admin/quản lý sửa)
-- ─────────────────────────────────────────────────────────────

-- BẢNG: product_categories
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_cat_select_all" ON public.product_categories
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "product_cat_manage_admin" ON public.product_categories
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- BẢNG: brands
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brands_select_all" ON public.brands
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "brands_manage_admin" ON public.brands
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- BẢNG: products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_select_all" ON public.products
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "products_manage_admin" ON public.products
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- BẢNG: product_variants
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "variants_select_all" ON public.product_variants
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "variants_manage_admin" ON public.product_variants
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
    AND public.fn_is_active()
  );

-- BẢNG: price_lists
ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_lists_select_all" ON public.price_lists
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "price_lists_manage_admin" ON public.price_lists
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('pricing.manage'))
    AND public.fn_is_active()
  );

-- BẢNG: price_list_items
ALTER TABLE public.price_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_items_select_all" ON public.price_list_items
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "price_items_manage_admin" ON public.price_list_items
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('pricing.manage'))
    AND public.fn_is_active()
  );

-- BẢNG: promotions
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "promotions_select_all" ON public.promotions
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "promotions_manage_admin" ON public.promotions
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_permission('promotions.manage'))
    AND public.fn_is_active()
  );

-- ─────────────────────────────────────────────────────────────
-- IV. NHÓM BẢNG KHÁCH HÀNG
-- ─────────────────────────────────────────────────────────────

-- BẢNG: customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- SELECT: admin/CEO thấy tất cả
CREATE POLICY "customers_select_admin" ON public.customers
  FOR SELECT USING (
    public.fn_is_admin()
    AND public.fn_is_active()
  );

-- SELECT: branch_manager thấy KH trong chi nhánh mình
CREATE POLICY "customers_select_branch_mgr" ON public.customers
  FOR SELECT USING (
    public.fn_has_role('branch_manager')
    AND public.fn_is_active()
    AND branch_id = public.fn_my_branch_id()
  );

-- SELECT: kế toán thấy tất cả KH (cần cho báo cáo công nợ)
CREATE POLICY "customers_select_accountant" ON public.customers
  FOR SELECT USING (
    public.fn_has_role('accountant')
    AND public.fn_is_active()
  );

-- SELECT: team_lead thấy KH trong nhóm mình
CREATE POLICY "customers_select_team_lead" ON public.customers
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

-- SELECT: sales chỉ thấy KH do mình phụ trách
CREATE POLICY "customers_select_sales" ON public.customers
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

-- INSERT: sales tạo KH, tự gán owner_user_id = mình
CREATE POLICY "customers_insert_active" ON public.customers
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('customers.create')
    AND owner_user_id = auth.uid()
  );

-- INSERT: admin/lead có thể tạo KH cho người khác
CREATE POLICY "customers_insert_admin_lead" ON public.customers
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('team_lead') OR public.fn_has_role('branch_manager'))
  );

-- UPDATE: admin/branch_manager sửa tất cả
CREATE POLICY "customers_update_admin" ON public.customers
  FOR UPDATE USING (
    (public.fn_is_admin() OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

-- UPDATE: team_lead sửa KH trong nhóm mình
CREATE POLICY "customers_update_team_lead" ON public.customers
  FOR UPDATE USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

-- UPDATE: sales sửa KH do mình phụ trách
CREATE POLICY "customers_update_sales" ON public.customers
  FOR UPDATE USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

-- DELETE: chỉ admin (thường là is_active = false)
CREATE POLICY "customers_delete_admin" ON public.customers
  FOR DELETE USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: customer_business_info
ALTER TABLE public.customer_business_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cust_biz_select_all_active" ON public.customer_business_info
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c WHERE c.id = customer_business_info.customer_id
    )
  );

CREATE POLICY "cust_biz_manage_active" ON public.customer_business_info
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_business_info.customer_id
        AND (c.owner_user_id = auth.uid()
             OR c.team_id = public.fn_my_team_id()
             OR public.fn_is_admin())
    )
  );

-- BẢNG: customer_personal_info
ALTER TABLE public.customer_personal_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cust_personal_select" ON public.customer_personal_info
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c WHERE c.id = customer_personal_info.customer_id
    )
  );

CREATE POLICY "cust_personal_manage" ON public.customer_personal_info
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_personal_info.customer_id
        AND (c.owner_user_id = auth.uid()
             OR c.team_id = public.fn_my_team_id()
             OR public.fn_is_admin())
    )
  );

-- BẢNG: customer_contacts
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select_admin" ON public.customer_contacts
  FOR SELECT USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "contacts_select_accountant" ON public.customer_contacts
  FOR SELECT USING (public.fn_has_role('accountant') AND public.fn_is_active());

CREATE POLICY "contacts_select_team_lead" ON public.customer_contacts
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_contacts.customer_id
        AND c.team_id = public.fn_my_team_id()
    )
  );

CREATE POLICY "contacts_select_sales" ON public.customer_contacts
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_contacts.customer_id
        AND c.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "contacts_manage_active" ON public.customer_contacts
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_contacts.customer_id
        AND (c.owner_user_id = auth.uid()
             OR (public.fn_has_role('team_lead') AND c.team_id = public.fn_my_team_id())
             OR public.fn_is_admin())
    )
  );

CREATE POLICY "contacts_update_active" ON public.customer_contacts
  FOR UPDATE USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_contacts.customer_id
        AND (c.owner_user_id = auth.uid()
             OR (public.fn_has_role('team_lead') AND c.team_id = public.fn_my_team_id())
             OR public.fn_is_admin())
    )
  );

CREATE POLICY "contacts_delete_admin_lead" ON public.customer_contacts
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('team_lead'))
  );

-- BẢNG: farms, herds, species, disease_dictionary, disease_history
ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.herds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disease_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disease_history ENABLE ROW LEVEL SECURITY;

-- Species và disease_dictionary: từ điển, mọi người xem được
CREATE POLICY "species_select_all" ON public.species
  FOR SELECT USING (public.fn_is_active());
CREATE POLICY "species_manage_admin" ON public.species
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "disease_dict_select_all" ON public.disease_dictionary
  FOR SELECT USING (public.fn_is_active());
CREATE POLICY "disease_dict_manage_admin" ON public.disease_dictionary
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- Farms: kế thừa quyền từ customer cha
CREATE POLICY "farms_select_admin" ON public.farms
  FOR SELECT USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "farms_select_active" ON public.farms
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = farms.customer_id
        AND (c.owner_user_id = auth.uid()
             OR c.team_id = public.fn_my_team_id()
             OR public.fn_has_role('accountant'))
    )
  );

CREATE POLICY "farms_manage_active" ON public.farms
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = farms.customer_id
        AND (c.owner_user_id = auth.uid()
             OR (public.fn_has_role('team_lead') AND c.team_id = public.fn_my_team_id())
             OR public.fn_is_admin())
    )
  );

-- Herds: kế thừa quyền từ farm → customer
CREATE POLICY "herds_select_active" ON public.herds
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      JOIN public.customers c ON c.id = f.customer_id
      WHERE f.id = herds.farm_id
        AND (c.owner_user_id = auth.uid()
             OR c.team_id = public.fn_my_team_id()
             OR public.fn_is_admin()
             OR public.fn_has_role('accountant'))
    )
  );

CREATE POLICY "herds_manage_active" ON public.herds
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      JOIN public.customers c ON c.id = f.customer_id
      WHERE f.id = herds.farm_id
        AND (c.owner_user_id = auth.uid()
             OR (public.fn_has_role('team_lead') AND c.team_id = public.fn_my_team_id())
             OR public.fn_is_admin())
    )
  );

-- Disease history: kế thừa quyền từ herd
CREATE POLICY "disease_hist_select_active" ON public.disease_history
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.herds h
      JOIN public.farms f ON f.id = h.farm_id
      JOIN public.customers c ON c.id = f.customer_id
      WHERE h.id = disease_history.herd_id
        AND (c.owner_user_id = auth.uid()
             OR c.team_id = public.fn_my_team_id()
             OR public.fn_is_admin())
    )
  );

CREATE POLICY "disease_hist_manage_active" ON public.disease_history
  FOR ALL USING (
    public.fn_is_active()
    AND (recorded_by = auth.uid() OR public.fn_is_admin() OR public.fn_has_role('team_lead'))
  );

-- ─────────────────────────────────────────────────────────────
-- V. NHÓM BẢNG BÁN HÀNG & ĐƠN HÀNG
-- ─────────────────────────────────────────────────────────────

-- BẢNG: quotes
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quotes_select_admin" ON public.quotes
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "quotes_select_team_lead" ON public.quotes
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

CREATE POLICY "quotes_select_sales" ON public.quotes
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "quotes_insert_active" ON public.quotes
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('quotes.create')
    AND (owner_user_id = auth.uid() OR public.fn_is_admin() OR public.fn_has_role('team_lead'))
  );

CREATE POLICY "quotes_update_admin" ON public.quotes
  FOR UPDATE USING (
    (public.fn_is_admin() OR public.fn_has_role('team_lead'))
    AND public.fn_is_active()
  );

CREATE POLICY "quotes_update_sales" ON public.quotes
  FOR UPDATE USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
    AND status = 'draft'
  );

CREATE POLICY "quotes_delete_admin" ON public.quotes
  FOR DELETE USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: quote_lines
ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_lines_select" ON public.quote_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = quote_lines.quote_id
        AND (q.owner_user_id = auth.uid()
             OR q.team_id = public.fn_my_team_id()
             OR public.fn_is_admin()
             OR public.fn_has_role('accountant'))
    )
  );

CREATE POLICY "quote_lines_manage" ON public.quote_lines
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = quote_lines.quote_id
        AND q.status = 'draft'
        AND (q.owner_user_id = auth.uid()
             OR public.fn_is_admin()
             OR public.fn_has_role('team_lead'))
    )
  );

-- BẢNG: orders
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select_admin" ON public.orders
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('warehouse_keeper'))
    AND public.fn_is_active()
  );

CREATE POLICY "orders_select_branch_mgr" ON public.orders
  FOR SELECT USING (
    public.fn_has_role('branch_manager')
    AND public.fn_is_active()
    AND branch_id = public.fn_my_branch_id()
  );

CREATE POLICY "orders_select_team_lead" ON public.orders
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

CREATE POLICY "orders_select_sales" ON public.orders
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "orders_insert_active" ON public.orders
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('orders.create')
    AND (owner_user_id = auth.uid() OR public.fn_is_admin() OR public.fn_has_role('team_lead'))
  );

CREATE POLICY "orders_update_admin" ON public.orders
  FOR UPDATE USING (
    (public.fn_is_admin() OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "orders_update_team_lead" ON public.orders
  FOR UPDATE USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

-- Sales chỉ sửa đơn nháp (draft) hoặc xác nhận (confirmed) – không sửa khi đang giao
CREATE POLICY "orders_update_sales" ON public.orders
  FOR UPDATE USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
    AND status IN ('draft', 'confirmed')
  );

CREATE POLICY "orders_delete_admin" ON public.orders
  FOR DELETE USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: order_lines
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_lines_select_admin" ON public.order_lines
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('warehouse_keeper'))
    AND public.fn_is_active()
  );

CREATE POLICY "order_lines_select_team_lead" ON public.order_lines
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_lines.order_id
        AND o.team_id = public.fn_my_team_id()
    )
  );

CREATE POLICY "order_lines_select_sales" ON public.order_lines
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_lines.order_id
        AND o.owner_user_id = auth.uid()
    )
  );

-- Chỉ thêm/sửa dòng khi đơn đang ở trạng thái draft
CREATE POLICY "order_lines_manage_draft" ON public.order_lines
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_lines.order_id
        AND o.status = 'draft'
        AND (o.owner_user_id = auth.uid()
             OR public.fn_is_admin()
             OR public.fn_has_role('team_lead'))
    )
  );

-- BẢNG: order_payments
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_payments_select_admin" ON public.order_payments
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "order_payments_select_others" ON public.order_payments
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_payments.order_id
        AND (o.owner_user_id = auth.uid()
             OR o.team_id = public.fn_my_team_id()
             OR public.fn_is_admin())
    )
  );

CREATE POLICY "order_payments_insert_cashier" ON public.order_payments
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_has_permission('orders.record_payment')
         OR public.fn_is_admin()
         OR public.fn_has_role('accountant'))
    AND created_by = auth.uid()
  );

CREATE POLICY "order_payments_delete_admin" ON public.order_payments
  FOR DELETE USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_select_all" ON public.invoices
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('team_lead') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "invoices_manage_accountant" ON public.invoices
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

-- BẢNG: sales_returns, sales_return_lines
ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "returns_select_active" ON public.sales_returns
  FOR SELECT USING (
    public.fn_is_active()
    AND (public.fn_is_admin()
         OR public.fn_has_role('accountant')
         OR created_by = auth.uid()
         OR EXISTS (
           SELECT 1 FROM public.orders o
           WHERE o.id = sales_returns.order_id
             AND o.team_id = public.fn_my_team_id()
         ))
  );

CREATE POLICY "returns_manage_active" ON public.sales_returns
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('team_lead'))
  );

CREATE POLICY "return_lines_select_active" ON public.sales_return_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.sales_returns sr
      WHERE sr.id = sales_return_lines.return_id
        AND (public.fn_is_admin()
             OR public.fn_has_role('accountant')
             OR sr.created_by = auth.uid())
    )
  );

CREATE POLICY "return_lines_manage_admin" ON public.sales_return_lines
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('accountant'))
  );

-- BẢNG: customer_debts, period_statements, debt_payments
ALTER TABLE public.customer_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;

-- Công nợ: kế toán và admin xem tất cả; sales chỉ xem của KH mình
CREATE POLICY "debts_select_accountant" ON public.customer_debts
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "debts_select_sales" ON public.customer_debts
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_debts.customer_id
        AND (c.owner_user_id = auth.uid()
             OR c.team_id = public.fn_my_team_id()
             OR public.fn_is_admin())
    )
  );

CREATE POLICY "debts_manage_accountant" ON public.customer_debts
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "period_stmt_select_accountant" ON public.period_statements
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "period_stmt_manage_accountant" ON public.period_statements
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "debt_payments_select_accountant" ON public.debt_payments
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "debt_payments_manage_accountant" ON public.debt_payments
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

-- ─────────────────────────────────────────────────────────────
-- VI. NHÓM BẢNG KHO & NHẬP HÀNG
-- ─────────────────────────────────────────────────────────────

-- BẢNG: suppliers, supplier_contacts
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_select_all" ON public.suppliers
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "suppliers_manage_admin" ON public.suppliers
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper') OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "supplier_contacts_select_all" ON public.supplier_contacts
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "supplier_contacts_manage_admin" ON public.supplier_contacts
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND public.fn_is_active()
  );

-- BẢNG: purchase_orders, purchase_order_lines
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_select_warehouse" ON public.purchase_orders
  FOR SELECT USING (
    public.fn_is_active()
    AND (public.fn_is_admin()
         OR public.fn_has_role('accountant')
         OR public.fn_has_role('warehouse_keeper')
         OR public.fn_has_role('branch_manager'))
  );

CREATE POLICY "po_create_warehouse" ON public.purchase_orders
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('purchase_orders.create')
    AND created_by = auth.uid()
  );

CREATE POLICY "po_update_warehouse" ON public.purchase_orders
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "po_delete_admin" ON public.purchase_orders
  FOR DELETE USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "po_lines_select" ON public.purchase_order_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.id = purchase_order_lines.po_id
        AND (public.fn_is_admin()
             OR public.fn_has_role('accountant')
             OR public.fn_has_role('warehouse_keeper'))
    )
  );

CREATE POLICY "po_lines_manage" ON public.purchase_order_lines
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.id = purchase_order_lines.po_id
        AND po.status = 'draft'
        AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    )
  );

-- BẢNG: goods_receipts, goods_receipt_lines
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipts_select_warehouse" ON public.goods_receipts
  FOR SELECT USING (
    public.fn_is_active()
    AND (public.fn_is_admin()
         OR public.fn_has_role('accountant')
         OR public.fn_has_role('warehouse_keeper')
         OR public.fn_has_role('branch_manager'))
  );

CREATE POLICY "receipts_manage_warehouse" ON public.goods_receipts
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "receipt_lines_select" ON public.goods_receipt_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND (public.fn_is_admin()
         OR public.fn_has_role('accountant')
         OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "receipt_lines_manage" ON public.goods_receipt_lines
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

-- BẢNG: stock_lots
ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;

-- Mọi user active xem được tồn kho (để chọn sản phẩm khi tạo đơn)
CREATE POLICY "stock_lots_select_all" ON public.stock_lots
  FOR SELECT USING (public.fn_is_active());

-- Chỉ warehouse_keeper/admin nhập kho thủ công; trigger xử lý tự động
CREATE POLICY "stock_lots_manage_warehouse" ON public.stock_lots
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

-- BẢNG: stock_movements
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_mov_select_admin" ON public.stock_movements
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "stock_mov_select_warehouse" ON public.stock_movements
  FOR SELECT USING (
    (public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

-- Sales chỉ thấy phiếu kho liên quan đến đơn hàng của mình
CREATE POLICY "stock_mov_select_sales" ON public.stock_movements
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND reference_type = 'order'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = stock_movements.reference_id
        AND o.owner_user_id = auth.uid()
    )
  );

-- Chỉ warehouse_keeper/admin ghi thủ công (xuất nhập tự động qua trigger)
CREATE POLICY "stock_mov_insert_warehouse" ON public.stock_movements
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND performed_by = auth.uid()
  );

-- BẢNG: inventory_settings, stock_transfers, stock_transfer_lines, inventory_alerts
ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_settings_select_all" ON public.inventory_settings
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "inv_settings_manage_admin" ON public.inventory_settings
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND public.fn_is_active()
  );

CREATE POLICY "stock_transfers_select" ON public.stock_transfers
  FOR SELECT USING (
    public.fn_is_active()
    AND (public.fn_is_admin()
         OR public.fn_has_role('warehouse_keeper')
         OR public.fn_has_role('branch_manager'))
  );

CREATE POLICY "stock_transfers_manage" ON public.stock_transfers
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "transfer_lines_select" ON public.stock_transfer_lines
  FOR SELECT USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper') OR public.fn_has_role('branch_manager'))
  );

CREATE POLICY "transfer_lines_manage" ON public.stock_transfer_lines
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

CREATE POLICY "inv_alerts_select_all" ON public.inventory_alerts
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "inv_alerts_manage_warehouse" ON public.inventory_alerts
  FOR ALL USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

-- ─────────────────────────────────────────────────────────────
-- VII. NHÓM BẢNG SỔ QUỸ DÒNG TIỀN (BẢO MẬT NGHIÊM NGẶT)
-- ─────────────────────────────────────────────────────────────

-- BẢNG: cash_funds, bank_accounts
ALTER TABLE public.cash_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_funds_select_accountant" ON public.cash_funds
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "cash_funds_manage_admin" ON public.cash_funds
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "bank_accounts_select_accountant" ON public.bank_accounts
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "bank_accounts_manage_admin" ON public.bank_accounts
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

-- BẢNG: cashier_sessions
ALTER TABLE public.cashier_sessions ENABLE ROW LEVEL SECURITY;

-- Thu ngân thấy phiên của mình; kế toán/admin thấy tất cả
CREATE POLICY "sessions_select_cashier" ON public.cashier_sessions
  FOR SELECT USING (
    public.fn_is_active()
    AND (cashier_id = auth.uid()
         OR public.fn_is_admin()
         OR public.fn_has_role('accountant')
         OR public.fn_has_role('branch_manager'))
  );

CREATE POLICY "sessions_manage_cashier" ON public.cashier_sessions
  FOR ALL USING (
    public.fn_is_active()
    AND (cashier_id = auth.uid()
         OR public.fn_is_admin()
         OR public.fn_has_role('accountant'))
  );

-- BẢNG: cashbook_transactions (BẢO MẬT CAO NHẤT)
ALTER TABLE public.cashbook_transactions ENABLE ROW LEVEL SECURITY;

-- Kế toán và admin xem tất cả giao dịch
CREATE POLICY "cashbook_select_accountant" ON public.cashbook_transactions
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

-- Sales chỉ thấy phiếu thu do mình tạo liên quan đến đơn hàng của mình
CREATE POLICY "cashbook_select_sales_own" ON public.cashbook_transactions
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND created_by = auth.uid()
  );

-- Kế toán tạo phiếu thu/chi
CREATE POLICY "cashbook_insert_accountant" ON public.cashbook_transactions
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('cashbook.create')
    AND created_by = auth.uid()
  );

-- Chỉ admin hoặc kế toán trưởng được duyệt (UPDATE status)
CREATE POLICY "cashbook_update_accountant" ON public.cashbook_transactions
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('accountant'))
  );

-- KHÔNG AI được xóa phiếu thu chi (chỉ hủy bằng status = 'cancelled')
-- Không có DELETE policy → mặc định từ chối

-- BẢNG: expense_categories
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_cat_select_all" ON public.expense_categories
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "expense_cat_manage_admin" ON public.expense_categories
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

-- BẢNG: supplier_payments, supplier_payment_allocations
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_pmts_select_accountant" ON public.supplier_payments
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "supplier_pmts_manage_accountant" ON public.supplier_payments
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "supplier_alloc_select" ON public.supplier_payment_allocations
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "supplier_alloc_manage" ON public.supplier_payment_allocations
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

-- BẢNG: employee_advances, internal_transfers
ALTER TABLE public.employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_transfers ENABLE ROW LEVEL SECURITY;

-- Nhân viên xem tạm ứng của mình; kế toán/admin xem tất cả
CREATE POLICY "advances_select_self" ON public.employee_advances
  FOR SELECT USING (
    public.fn_is_active()
    AND (employee_id = auth.uid()
         OR public.fn_is_admin()
         OR public.fn_has_role('accountant')
         OR public.fn_has_role('branch_manager'))
  );

CREATE POLICY "advances_manage_accountant" ON public.employee_advances
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "internal_transfers_select" ON public.internal_transfers
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "internal_transfers_manage" ON public.internal_transfers
  FOR ALL USING (
    (public.fn_is_admin() OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

-- ─────────────────────────────────────────────────────────────
-- VIII. NHÓM BẢNG CƠ HỘI & HOẠT ĐỘNG
-- ─────────────────────────────────────────────────────────────

-- BẢNG: pipeline_definitions, pipeline_stages
ALTER TABLE public.pipeline_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipelines_select_all" ON public.pipeline_definitions
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "pipelines_manage_admin" ON public.pipeline_definitions
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "pipeline_stages_select_all" ON public.pipeline_stages
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "pipeline_stages_manage_admin" ON public.pipeline_stages
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: lost_reasons, activity_types
ALTER TABLE public.lost_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lost_reasons_select_all" ON public.lost_reasons
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "lost_reasons_manage_admin" ON public.lost_reasons
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "activity_types_select_all" ON public.activity_types
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "activity_types_manage_admin" ON public.activity_types
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: opportunities
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opp_select_admin" ON public.opportunities
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "opp_select_team_lead" ON public.opportunities
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

CREATE POLICY "opp_select_sales" ON public.opportunities
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "opp_insert_active" ON public.opportunities
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('opportunities.create')
    AND (owner_user_id = auth.uid() OR public.fn_is_admin() OR public.fn_has_role('team_lead'))
  );

CREATE POLICY "opp_update_admin" ON public.opportunities
  FOR UPDATE USING (
    (public.fn_is_admin() OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "opp_update_team_lead" ON public.opportunities
  FOR UPDATE USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

CREATE POLICY "opp_update_sales" ON public.opportunities
  FOR UPDATE USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
    AND status = 'open'
  );

CREATE POLICY "opp_delete_admin" ON public.opportunities
  FOR DELETE USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: activities
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities_select_admin" ON public.activities
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "activities_select_team_lead" ON public.activities
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

CREATE POLICY "activities_select_sales" ON public.activities
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "activities_insert_active" ON public.activities
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (owner_user_id = auth.uid() OR public.fn_is_admin() OR public.fn_has_role('team_lead'))
  );

CREATE POLICY "activities_update_owner" ON public.activities
  FOR UPDATE USING (
    public.fn_is_active()
    AND (owner_user_id = auth.uid()
         OR public.fn_is_admin()
         OR (public.fn_has_role('team_lead') AND team_id = public.fn_my_team_id()))
  );

CREATE POLICY "activities_delete_admin" ON public.activities
  FOR DELETE USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: sales_schedules, sales_schedule_slots
ALTER TABLE public.sales_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_schedule_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedules_select_admin" ON public.sales_schedules
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('team_lead') OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "schedules_select_sales" ON public.sales_schedules
  FOR SELECT USING (
    public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "schedules_manage_own" ON public.sales_schedules
  FOR ALL USING (
    public.fn_is_active()
    AND (owner_user_id = auth.uid() OR public.fn_is_admin())
  );

CREATE POLICY "schedule_slots_select" ON public.sales_schedule_slots
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.sales_schedules ss
      WHERE ss.id = sales_schedule_slots.schedule_id
        AND (ss.owner_user_id = auth.uid()
             OR public.fn_is_admin()
             OR public.fn_has_role('team_lead'))
    )
  );

CREATE POLICY "schedule_slots_manage" ON public.sales_schedule_slots
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.sales_schedules ss
      WHERE ss.id = sales_schedule_slots.schedule_id
        AND (ss.owner_user_id = auth.uid() OR public.fn_is_admin())
    )
  );

-- ─────────────────────────────────────────────────────────────
-- IX. NHÓM BẢNG DỰ ÁN ĐÀN
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.herd_project_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.herd_project_type_default_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.herd_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.herd_project_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.herd_project_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "herd_types_select_all" ON public.herd_project_types
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "herd_types_manage_admin" ON public.herd_project_types
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

CREATE POLICY "herd_default_steps_select_all" ON public.herd_project_type_default_steps
  FOR SELECT USING (public.fn_is_active());

CREATE POLICY "herd_default_steps_manage_admin" ON public.herd_project_type_default_steps
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- Dự án đàn: theo dõi quyền của KH liên quan
CREATE POLICY "herd_proj_select_admin" ON public.herd_projects
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('branch_manager'))
    AND public.fn_is_active()
  );

CREATE POLICY "herd_proj_select_team_lead" ON public.herd_projects
  FOR SELECT USING (
    public.fn_has_role('team_lead')
    AND public.fn_is_active()
    AND team_id = public.fn_my_team_id()
  );

CREATE POLICY "herd_proj_select_sales" ON public.herd_projects
  FOR SELECT USING (
    public.fn_has_role('sales')
    AND public.fn_is_active()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY "herd_proj_insert_active" ON public.herd_projects
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND public.fn_has_permission('herd_projects.create')
    AND (owner_user_id = auth.uid() OR public.fn_is_admin() OR public.fn_has_role('team_lead'))
  );

CREATE POLICY "herd_proj_update_owner" ON public.herd_projects
  FOR UPDATE USING (
    public.fn_is_active()
    AND (owner_user_id = auth.uid()
         OR (public.fn_has_role('team_lead') AND team_id = public.fn_my_team_id())
         OR public.fn_is_admin())
  );

CREATE POLICY "herd_proj_delete_admin" ON public.herd_projects
  FOR DELETE USING (public.fn_is_admin() AND public.fn_is_active());

-- Bước và kết quả dự án: kế thừa từ project
CREATE POLICY "herd_steps_select" ON public.herd_project_steps
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.herd_projects hp
      WHERE hp.id = herd_project_steps.project_id
        AND (hp.owner_user_id = auth.uid()
             OR hp.team_id = public.fn_my_team_id()
             OR public.fn_is_admin())
    )
  );

CREATE POLICY "herd_steps_manage" ON public.herd_project_steps
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.herd_projects hp
      WHERE hp.id = herd_project_steps.project_id
        AND (hp.owner_user_id = auth.uid()
             OR (public.fn_has_role('team_lead') AND hp.team_id = public.fn_my_team_id())
             OR public.fn_is_admin())
    )
  );

CREATE POLICY "herd_outcomes_select" ON public.herd_project_outcomes
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.herd_projects hp
      WHERE hp.id = herd_project_outcomes.project_id
        AND (hp.owner_user_id = auth.uid()
             OR hp.team_id = public.fn_my_team_id()
             OR public.fn_is_admin()
             OR public.fn_has_role('accountant'))
    )
  );

CREATE POLICY "herd_outcomes_manage" ON public.herd_project_outcomes
  FOR ALL USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.herd_projects hp
      WHERE hp.id = herd_project_outcomes.project_id
        AND (hp.owner_user_id = auth.uid()
             OR (public.fn_has_role('team_lead') AND hp.team_id = public.fn_my_team_id())
             OR public.fn_is_admin())
    )
  );

-- ─────────────────────────────────────────────────────────────
-- X. NHÓM BẢNG HỆ THỐNG
-- ─────────────────────────────────────────────────────────────

-- BẢNG: audit_logs (KHÔNG AI xóa/sửa; chỉ admin xem)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select_admin" ON public.audit_logs
  FOR SELECT USING (public.fn_is_admin() AND public.fn_is_active());
-- Không có INSERT/UPDATE/DELETE policy cho user thường
-- → Chỉ fn_audit_log() (SECURITY DEFINER) được ghi

-- BẢNG: notifications (mỗi user chỉ thấy của mình)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select_self" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notif_update_self" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Chỉ admin/Edge Function tạo thông báo
CREATE POLICY "notif_insert_admin" ON public.notifications
  FOR INSERT WITH CHECK (
    public.fn_is_admin() AND public.fn_is_active()
  );

CREATE POLICY "notif_delete_self" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

-- BẢNG: code_sequences (chỉ dùng qua function, không expose trực tiếp)
ALTER TABLE public.code_sequences ENABLE ROW LEVEL SECURITY;

-- Không có policy SELECT cho user thường → fn_generate_code() dùng SECURITY DEFINER
CREATE POLICY "code_seq_admin_only" ON public.code_sequences
  FOR ALL USING (public.fn_is_admin() AND public.fn_is_active());

-- BẢNG: order_line_allocations (kế thừa từ order)
ALTER TABLE public.order_line_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allocations_select_admin" ON public.order_line_allocations
  FOR SELECT USING (
    (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper') OR public.fn_has_role('accountant'))
    AND public.fn_is_active()
  );

CREATE POLICY "allocations_select_sales" ON public.order_line_allocations
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.order_lines ol
      JOIN public.orders o ON o.id = ol.order_id
      WHERE ol.id = order_line_allocations.order_line_id
        AND (o.owner_user_id = auth.uid()
             OR o.team_id = public.fn_my_team_id())
    )
  );

-- Ghi bởi trigger fn_auto_stock_on_order_confirm (SECURITY DEFINER)
-- BẢNG: order_status_history
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_hist_select_active" ON public.order_status_history
  FOR SELECT USING (
    public.fn_is_active()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
        AND (o.owner_user_id = auth.uid()
             OR o.team_id = public.fn_my_team_id()
             OR public.fn_is_admin()
             OR public.fn_has_role('accountant'))
    )
  );
-- INSERT được thực hiện bởi trigger (SECURITY DEFINER)
