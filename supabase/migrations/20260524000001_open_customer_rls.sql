-- ============================================================
-- Migration: Open customer and sub-tables SELECT policies
-- File: 20260524000001_open_customer_rls.sql
-- Mô tả: Chuyển đổi khách hàng và đàn vật nuôi thành tài nguyên chung (hiển thị cho toàn bộ chi nhánh & nhân viên)
-- ============================================================

-- 1. BẢNG: customers
-- Drop các select policy cũ
DROP POLICY IF EXISTS "customers_select_admin" ON public.customers;
DROP POLICY IF EXISTS "customers_select_branch_mgr" ON public.customers;
DROP POLICY IF EXISTS "customers_select_accountant" ON public.customers;
DROP POLICY IF EXISTS "customers_select_team_lead" ON public.customers;
DROP POLICY IF EXISTS "customers_select_sales" ON public.customers;

-- Tạo select policy mới mở rộng
CREATE POLICY "customers_select_all" ON public.customers
  FOR SELECT USING (public.fn_is_active());


-- 2. BẢNG: customer_contacts
-- Drop các select policy cũ
DROP POLICY IF EXISTS "contacts_select_admin" ON public.customer_contacts;
DROP POLICY IF EXISTS "contacts_select_accountant" ON public.customer_contacts;
DROP POLICY IF EXISTS "contacts_select_team_lead" ON public.customer_contacts;
DROP POLICY IF EXISTS "contacts_select_sales" ON public.customer_contacts;

-- Tạo select policy mới mở rộng
CREATE POLICY "contacts_select_all" ON public.customer_contacts
  FOR SELECT USING (public.fn_is_active());


-- 3. BẢNG: farms
-- Drop các select policy cũ
DROP POLICY IF EXISTS "farms_select_admin" ON public.farms;
DROP POLICY IF EXISTS "farms_select_active" ON public.farms;

-- Tạo select policy mới mở rộng
CREATE POLICY "farms_select_all" ON public.farms
  FOR SELECT USING (public.fn_is_active());


-- 4. BẢNG: herds
-- Drop các select policy cũ
DROP POLICY IF EXISTS "herds_select_active" ON public.herds;

-- Tạo select policy mới mở rộng
CREATE POLICY "herds_select_all" ON public.herds
  FOR SELECT USING (public.fn_is_active());


-- 5. BẢNG: disease_history
-- Drop các select policy cũ
DROP POLICY IF EXISTS "disease_hist_select_active" ON public.disease_history;

-- Tạo select policy mới mở rộng
CREATE POLICY "disease_hist_select_all" ON public.disease_history
  FOR SELECT USING (public.fn_is_active());


-- 6. BẢNG: profiles
-- Drop các select policy cũ của profiles
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_branch_manager" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_team_lead" ON public.profiles;

-- Tạo select policy mới mở rộng cho profiles
CREATE POLICY "profiles_select_all" ON public.profiles
  FOR SELECT USING (public.fn_is_active());
