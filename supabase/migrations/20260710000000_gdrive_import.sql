-- ============================================================
-- Migration: gdrive_import
-- File: 20260710000000_gdrive_import.sql
-- Mục đích: Nền tảng "Nhập hàng từ Google Drive (Google Sheets)".
--   Kế toán tính giá nhập trên Google Sheets (mỗi công ty/NCC 1 thư mục,
--   layout cột khác nhau). CRM kết nối Drive (qua Edge Function service
--   account), đọc/ghi Sheet, ánh xạ về sản phẩm + giá nhập, tạo phiếu nhập
--   NHÁP đồng bộ giá với Sheet; sau khi DUYỆT (verified) thì khóa đồng bộ.
--
--   Tận dụng vòng đời phiếu nhập sẵn có (draft → verified → completed):
--   chỉ thêm liên kết phiếu↔Sheet + RPC re-sync giá CHỈ khi status='draft'.
--
-- Đối tượng tạo:
--   1. gdrive_sources          — cấu hình mỗi công ty (folder + NCC + ánh xạ cột)
--   2. gdrive_product_aliases  — bí danh tên-trên-file → product_id (học dần theo NCC)
--   3. goods_receipts.gsheet_* — liên kết phiếu nhập với file nguồn
--   4. fn_sync_gsheet_draft_prices(receipt, prices) — đồng bộ giá khi còn nháp
--
-- Helper sẵn có dùng lại: fn_is_active(), fn_is_admin(),
--   fn_has_permission('inventory.receive').
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload schema
--    + chèn tracking row vào supabase_migrations.schema_migrations.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. gdrive_sources — cấu hình nguồn nhập theo công ty/NCC (admin quản lý)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gdrive_sources (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id          UUID        NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  label                TEXT        NOT NULL,                     -- Tên hiển thị (vd "MKV-Cai Lậy")
  drive_folder_id      TEXT        NOT NULL,                     -- ID thư mục Google Drive
  default_warehouse_id UUID        REFERENCES public.warehouses(id) ON DELETE SET NULL,
  header_row           INT         NOT NULL DEFAULT 3,           -- Dòng tiêu đề trên Sheet
  data_start_row       INT         NOT NULL DEFAULT 4,           -- Dòng dữ liệu bắt đầu
  -- Ánh xạ cột: { "name":"B", "import_price":"J", "quantity":"C",
  --   "unit":"D", "lot":null, "mfg_date":null, "exp_date":null }
  column_map           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  vat_default          TEXT        NOT NULL DEFAULT '5',         -- 'none' | '5' | '10'
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  created_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gdrive_sources IS 'Cấu hình nguồn nhập hàng từ Google Drive theo công ty/NCC';

CREATE INDEX IF NOT EXISTS idx_gdrive_sources_supplier ON public.gdrive_sources(supplier_id);
CREATE INDEX IF NOT EXISTS idx_gdrive_sources_active   ON public.gdrive_sources(is_active);

ALTER TABLE public.gdrive_sources ENABLE ROW LEVEL SECURITY;

-- Đọc: mọi user active (frontend cần liệt kê nguồn để chọn). Ghi: chỉ admin/ceo.
DROP POLICY IF EXISTS "gdrive_sources_select_active" ON public.gdrive_sources;
CREATE POLICY "gdrive_sources_select_active" ON public.gdrive_sources
  FOR SELECT USING (public.fn_is_active());

DROP POLICY IF EXISTS "gdrive_sources_write_admin" ON public.gdrive_sources;
CREATE POLICY "gdrive_sources_write_admin" ON public.gdrive_sources
  FOR ALL
  USING (public.fn_is_active() AND public.fn_is_admin())
  WITH CHECK (public.fn_is_active() AND public.fn_is_admin());

-- ─────────────────────────────────────────────────────────────
-- 2. gdrive_product_aliases — bí danh tên SP trên file → product_id (học dần)
--    external_name_norm: không dấu + lowercase, do FRONTEND chuẩn hóa
--    (removeVietnameseTones) rồi ghi xuống. UNIQUE theo (NCC, tên chuẩn hóa).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gdrive_product_aliases (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id        UUID        NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  external_name      TEXT        NOT NULL,                       -- Tên gốc trên file (giữ nguyên)
  external_name_norm TEXT        NOT NULL,                       -- Tên chuẩn hóa để khớp
  product_id         UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, external_name_norm)
);
COMMENT ON TABLE public.gdrive_product_aliases IS 'Bí danh tên SP trên file Drive → product_id, học dần theo NCC';

CREATE INDEX IF NOT EXISTS idx_gdrive_aliases_lookup ON public.gdrive_product_aliases(supplier_id, external_name_norm);

ALTER TABLE public.gdrive_product_aliases ENABLE ROW LEVEL SECURITY;

-- Đọc: user active. Ghi (tạo/sửa/xóa bí danh): user có quyền nhập kho hoặc admin.
DROP POLICY IF EXISTS "gdrive_aliases_select_active" ON public.gdrive_product_aliases;
CREATE POLICY "gdrive_aliases_select_active" ON public.gdrive_product_aliases
  FOR SELECT USING (public.fn_is_active());

DROP POLICY IF EXISTS "gdrive_aliases_write_receiver" ON public.gdrive_product_aliases;
CREATE POLICY "gdrive_aliases_write_receiver" ON public.gdrive_product_aliases
  FOR ALL
  USING (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('inventory.receive')))
  WITH CHECK (public.fn_is_active() AND (public.fn_is_admin() OR public.fn_has_permission('inventory.receive')));

-- ─────────────────────────────────────────────────────────────
-- 3. Liên kết phiếu nhập ↔ file nguồn Google Sheet
--    NULL = phiếu thủ công như cũ (không phá luồng hiện tại).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS gsheet_source_id UUID REFERENCES public.gdrive_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gsheet_file_id   TEXT,
  ADD COLUMN IF NOT EXISTS gsheet_tab       TEXT,
  ADD COLUMN IF NOT EXISTS gsheet_synced_at TIMESTAMPTZ,
  -- Snapshot dòng→product để re-sync: [{ "product_id": "...", "row": 12 }, ...]
  ADD COLUMN IF NOT EXISTS gsheet_row_map   JSONB;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: đồng bộ lại GIÁ NHẬP của phiếu NHÁP từ Google Sheet.
--    CHỈ khi status='draft' → sau 'verified' raise lỗi (khóa đồng bộ).
--    Quyền: người lập (received_by) hoặc admin/ceo.
--    p_prices: JSONB array [{ "product_id": "...", "unit_price": 12345 }, ...]
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_gsheet_draft_prices(p_receipt_id UUID, p_prices JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_receipt RECORD;
  v_elem    JSONB;
  v_pid     UUID;
  v_price   NUMERIC(15,2);
BEGIN
  IF NOT public.fn_is_active() THEN RAISE EXCEPTION 'Tài khoản không hoạt động.'; END IF;

  SELECT * INTO v_receipt FROM public.goods_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu nhập.'; END IF;

  IF NOT (public.fn_is_admin() OR v_receipt.received_by = v_uid) THEN
    RAISE EXCEPTION 'Bạn không có quyền đồng bộ giá phiếu nhập này.';
  END IF;

  -- Khóa đồng bộ sau khi duyệt: chỉ cho phép ở trạng thái Nháp.
  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'Chỉ đồng bộ giá được phiếu ở trạng thái Nháp (hiện tại: %). Sau khi duyệt, đồng bộ đã hết hiệu lực.', v_receipt.status;
  END IF;

  IF jsonb_typeof(p_prices) <> 'array' THEN
    RAISE EXCEPTION 'p_prices phải là JSON array.';
  END IF;

  -- Cập nhật giá từng dòng theo product_id
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_prices) LOOP
    v_pid   := (v_elem->>'product_id')::UUID;
    v_price := (v_elem->>'unit_price')::NUMERIC;
    IF v_pid IS NULL OR v_price IS NULL OR v_price < 0 THEN CONTINUE; END IF;

    UPDATE public.goods_receipt_lines
      SET unit_price = v_price
      WHERE receipt_id = p_receipt_id AND product_id = v_pid;
  END LOOP;

  -- Cập nhật lại tổng tiền (subtotal theo dòng) + mốc đồng bộ
  UPDATE public.goods_receipts
    SET total_amount = COALESCE(
          (SELECT SUM(line_total) FROM public.goods_receipt_lines WHERE receipt_id = p_receipt_id), 0),
        gsheet_synced_at = now(),
        updated_at = now()
    WHERE id = p_receipt_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_sync_gsheet_draft_prices(UUID, JSONB) TO authenticated;
