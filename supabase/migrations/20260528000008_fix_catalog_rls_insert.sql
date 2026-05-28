-- ============================================================
-- Migration: Fix RLS FOR ALL USING → tách INSERT WITH CHECK
-- File: 20260528000008_fix_catalog_rls_insert.sql
-- Vấn đề gốc:
--   PostgreSQL: FOR ALL USING(condition) KHÔNG áp dụng cho INSERT.
--   INSERT cần WITH CHECK(condition) riêng biệt.
--   Các bảng catalog dùng FOR ALL USING → mọi INSERT đều bị DENY.
-- Ảnh hưởng:
--   brands, product_categories, products, product_variants,
--   price_lists, price_list_items, promotions, suppliers,
--   purchase_orders, purchase_order_lines
-- Giải pháp:
--   DROP policy FOR ALL → tạo lại:
--     FOR INSERT WITH CHECK (...)
--     FOR UPDATE USING (...)
--     FOR DELETE USING (...)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. product_categories
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "product_cat_manage_admin" ON public.product_categories;

CREATE POLICY "product_cat_insert" ON public.product_categories
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

CREATE POLICY "product_cat_update" ON public.product_categories
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

CREATE POLICY "product_cat_delete" ON public.product_categories
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

-- ─────────────────────────────────────────────────────────────
-- 2. brands
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "brands_manage_admin" ON public.brands;

CREATE POLICY "brands_insert" ON public.brands
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

CREATE POLICY "brands_update" ON public.brands
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

CREATE POLICY "brands_delete" ON public.brands
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

-- ─────────────────────────────────────────────────────────────
-- 3. products
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "products_manage_admin" ON public.products;

CREATE POLICY "products_insert" ON public.products
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

CREATE POLICY "products_update" ON public.products
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

CREATE POLICY "products_delete" ON public.products
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

-- ─────────────────────────────────────────────────────────────
-- 4. product_variants
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "variants_manage_admin" ON public.product_variants;

CREATE POLICY "variants_insert" ON public.product_variants
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

CREATE POLICY "variants_update" ON public.product_variants
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

CREATE POLICY "variants_delete" ON public.product_variants
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('products.manage'))
  );

-- ─────────────────────────────────────────────────────────────
-- 5. price_lists
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "price_lists_manage_admin" ON public.price_lists;

CREATE POLICY "price_lists_insert" ON public.price_lists
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('pricing.manage'))
  );

CREATE POLICY "price_lists_update" ON public.price_lists
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('pricing.manage'))
  );

CREATE POLICY "price_lists_delete" ON public.price_lists
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('pricing.manage'))
  );

-- ─────────────────────────────────────────────────────────────
-- 6. price_list_items
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "price_items_manage_admin" ON public.price_list_items;

CREATE POLICY "price_items_insert" ON public.price_list_items
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('pricing.manage'))
  );

CREATE POLICY "price_items_update" ON public.price_list_items
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('pricing.manage'))
  );

CREATE POLICY "price_items_delete" ON public.price_list_items
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('pricing.manage'))
  );

-- ─────────────────────────────────────────────────────────────
-- 7. promotions
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "promotions_manage_admin" ON public.promotions;

CREATE POLICY "promotions_insert" ON public.promotions
  FOR INSERT WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('promotions.manage'))
  );

CREATE POLICY "promotions_update" ON public.promotions
  FOR UPDATE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('promotions.manage'))
  );

CREATE POLICY "promotions_delete" ON public.promotions
  FOR DELETE USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_permission('promotions.manage'))
  );

-- ─────────────────────────────────────────────────────────────
-- 8. suppliers — kiểm tra và fix tương tự
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Xóa policy FOR ALL nếu tồn tại
  DROP POLICY IF EXISTS "suppliers_manage_admin" ON public.suppliers;
  DROP POLICY IF EXISTS "suppliers_manage_warehouse" ON public.suppliers;
END $$;

-- SELECT đã có sẵn
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'suppliers' AND policyname = 'suppliers_insert'
  ) THEN
    EXECUTE '
      CREATE POLICY "suppliers_insert" ON public.suppliers
        FOR INSERT WITH CHECK (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR public.fn_has_permission(''purchase_orders.create'')
            OR public.fn_has_role(''warehouse_keeper'')
            OR public.fn_has_role(''branch_manager'')
          )
        )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'suppliers' AND policyname = 'suppliers_update'
  ) THEN
    EXECUTE '
      CREATE POLICY "suppliers_update" ON public.suppliers
        FOR UPDATE USING (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR public.fn_has_role(''warehouse_keeper'')
            OR public.fn_has_role(''branch_manager'')
          )
        )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'suppliers' AND policyname = 'suppliers_delete'
  ) THEN
    EXECUTE '
      CREATE POLICY "suppliers_delete" ON public.suppliers
        FOR DELETE USING (
          public.fn_is_active()
          AND public.fn_is_admin()
        )';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 9. purchase_orders — fix FOR ALL → tách INSERT WITH CHECK
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "po_manage_warehouse" ON public.purchase_orders;
  DROP POLICY IF EXISTS "po_manage_admin" ON public.purchase_orders;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_orders' AND policyname = 'po_insert'
  ) THEN
    EXECUTE '
      CREATE POLICY "po_insert" ON public.purchase_orders
        FOR INSERT WITH CHECK (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR public.fn_has_permission(''purchase_orders.create'')
            OR public.fn_has_role(''warehouse_keeper'')
            OR public.fn_has_role(''branch_manager'')
          )
        )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_orders' AND policyname = 'po_update'
  ) THEN
    EXECUTE '
      CREATE POLICY "po_update" ON public.purchase_orders
        FOR UPDATE USING (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR public.fn_has_permission(''purchase_orders.approve'')
            OR public.fn_has_role(''warehouse_keeper'')
            OR public.fn_has_role(''branch_manager'')
            OR created_by = auth.uid()
          )
        )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_orders' AND policyname = 'po_delete'
  ) THEN
    EXECUTE '
      CREATE POLICY "po_delete" ON public.purchase_orders
        FOR DELETE USING (
          public.fn_is_active()
          AND (public.fn_is_admin() OR created_by = auth.uid())
        )';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 10. purchase_order_lines
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "po_lines_manage" ON public.purchase_order_lines;
  DROP POLICY IF EXISTS "po_lines_manage_admin" ON public.purchase_order_lines;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_order_lines' AND policyname = 'po_lines_insert'
  ) THEN
    EXECUTE '
      CREATE POLICY "po_lines_insert" ON public.purchase_order_lines
        FOR INSERT WITH CHECK (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR public.fn_has_permission(''purchase_orders.create'')
            OR public.fn_has_role(''warehouse_keeper'')
            OR public.fn_has_role(''branch_manager'')
          )
        )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_order_lines' AND policyname = 'po_lines_update'
  ) THEN
    EXECUTE '
      CREATE POLICY "po_lines_update" ON public.purchase_order_lines
        FOR UPDATE USING (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR public.fn_has_role(''warehouse_keeper'')
            OR public.fn_has_role(''branch_manager'')
            OR EXISTS (
              SELECT 1 FROM public.purchase_orders po
              WHERE po.id = purchase_order_lines.po_id
                AND po.created_by = auth.uid()
            )
          )
        )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_order_lines' AND policyname = 'po_lines_delete'
  ) THEN
    EXECUTE '
      CREATE POLICY "po_lines_delete" ON public.purchase_order_lines
        FOR DELETE USING (
          public.fn_is_active()
          AND (
            public.fn_is_admin()
            OR EXISTS (
              SELECT 1 FROM public.purchase_orders po
              WHERE po.id = purchase_order_lines.po_id
                AND po.created_by = auth.uid()
            )
          )
        )';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- KIỂM TRA KẾT QUẢ
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename IN (
    'brands', 'product_categories', 'products', 'product_variants',
    'price_lists', 'price_list_items', 'promotions',
    'suppliers', 'purchase_orders', 'purchase_order_lines'
  )
  AND cmd = 'INSERT';

  RAISE NOTICE '✅ Fix RLS FOR ALL → INSERT WITH CHECK hoàn tất!';
  RAISE NOTICE '   Số policy INSERT mới: %', v_count;
  RAISE NOTICE '   Bảng đã fix: brands, product_categories, products,';
  RAISE NOTICE '                product_variants, price_lists, price_list_items,';
  RAISE NOTICE '                promotions, suppliers, purchase_orders, purchase_order_lines';
END $$;
