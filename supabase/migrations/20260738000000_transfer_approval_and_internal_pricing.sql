-- ============================================================
-- Migration: transfer_approval_and_internal_pricing
-- File: 20260738000000_transfer_approval_and_internal_pricing.sql
--
-- MỤC ĐÍCH — đại tu chức năng CHUYỂN KHO sau rà soát toàn diện:
--
-- (1) MÔ HÌNH: mỗi chi nhánh kinh doanh ĐỘC LẬP (kiểu nhượng quyền).
--     Chi nhánh nhận "mua" hàng của chi nhánh nguồn, nên ĐƠN GIÁ CHUYỂN
--     chính là giá vốn thật của chi nhánh nhận — lấy giá nhập của kho tổng
--     sẽ sai với sổ sách của chi nhánh đó.
--     → Chuyển kho hành xử NHƯ MỘT PHIẾU NHẬP LÔ MỚI ở kho đích:
--       cost_price lô đích = bình quân gia quyền với unit_price của phiếu.
--       (Giữ nguyên hành vi cũ — đây là quy tắc nghiệp vụ, không phải lỗi.)
--     Bổ sung cột source_cost_price: snapshot giá vốn bên BÁN tại lúc xuất
--     kho, KHÔNG dùng để ghi sổ — chỉ để màn hình duyệt cho Admin thấy biên
--     nội bộ (giá vốn nguồn → đơn giá chuyển → giá vốn mới ở kho đích) mà
--     cân nhắc giá bán cho chi nhánh nhận. Đó là mục đích của bước duyệt.
--
--     ⚠️ HỆ QUẢ CẦN BIẾT: chi nhánh nguồn hiện KHÔNG ghi nhận doanh thu/lãi
--     của thương vụ nội bộ này (chỉ trừ tồn theo giá vốn của nó). Nên khi
--     CỘNG lợi nhuận các chi nhánh lại thành số toàn công ty, phần biên nội
--     bộ bị thiếu (hoặc thừa nếu chuyển dưới giá vốn). Số của TỪNG chi nhánh
--     là đúng; số HỢP NHẤT toàn công ty lệch đúng bằng biên nội bộ.
--     Muốn khớp cả hai thì phải ghi doanh thu nội bộ cho bên bán rồi loại trừ
--     khi hợp nhất — chưa làm trong migration này.
--
-- (2) BẢNG GIÁ NỘI BỘ do admin xây dựng. Tái dùng hạ tầng price_lists sẵn
--     có (đã có trang sửa giá theo lưới sản phẩm) + cột `usage` phân biệt
--     'sales' (bán cho khách) / 'transfer' (chuyển kho nội bộ).
--
-- (3) LUỒNG DUYỆT của Admin/CEO ở BƯỚC CUỐI:
--       draft → in_transit → received → completed  (admin duyệt)
--                                    ↘ rejected    (admin từ chối, hoàn kho nguồn)
--       draft/in_transit → cancelled
--     Tồn kho + giá vốn CHỈ được ghi vào kho đích tại fn_complete_transfer.
--     fn_receive_transfer nay chỉ ghi nhận "kho đích đã nhận đủ", KHÔNG
--     đụng tồn kho (khác hẳn hành vi cũ).
--
-- (4) VÁ LỖ HỔNG: stock_transfer_lines trước đây sửa được ở MỌI trạng thái
--     (policy FOR ALL không kiểm status) → duyệt xong vẫn thay ruột phiếu
--     được. Nay chỉ sửa được khi phiếu còn 'draft'.
--
-- (5) Tạo phiếu NGUYÊN TỬ qua fn_create_transfer (trước đây FE insert header
--     rồi insert lines ở 2 lượt gọi → lỗi giữa chừng để lại phiếu rỗng có
--     total_amount). Server tự tính total_amount, tự validate lô/kho/SL.
--
-- (6) Guard trigger chặn đổi status trực tiếp qua PostgREST (anon key là
--     public) — mọi chuyển trạng thái phải đi qua RPC.
--
-- TƯƠNG THÍCH NGƯỢC: giữ nguyên signature (p_transfer_id, p_user_id) của
-- fn_start/receive/cancel_transfer để frontend cũ không gãy khi deploy lệch
-- nhịp. Phiếu 'received' CŨ được backfill sang 'completed' (tồn kho đã ghi
-- theo mô hình cũ) để KHÔNG bị cộng kho lần hai.
--
-- ⚠️ Apply remote qua Management API (project gdotgcrtivjdpkcchrro) + reload
--    schema + chèn tracking row vào supabase_migrations.schema_migrations.
--    KHÔNG dùng `supabase db push` (25 migration cũ thiếu history).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. BẢNG GIÁ: phân loại mục đích sử dụng
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.price_lists
  ADD COLUMN IF NOT EXISTS usage TEXT NOT NULL DEFAULT 'sales';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_lists_usage_check') THEN
    ALTER TABLE public.price_lists
      ADD CONSTRAINT price_lists_usage_check CHECK (usage IN ('sales', 'transfer'));
  END IF;
END $$;

COMMENT ON COLUMN public.price_lists.usage IS
  'sales = bảng giá bán cho khách (mặc định, hành vi cũ) | transfer = bảng giá chuyển kho nội bộ';

CREATE INDEX IF NOT EXISTS idx_price_lists_usage ON public.price_lists(usage) WHERE is_active;

-- ─────────────────────────────────────────────────────────────
-- 2. PHIẾU CHUYỂN KHO: cột vòng đời duyệt + bảng giá + lý do
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES public.price_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason        TEXT,
  ADD COLUMN IF NOT EXISTS shipped_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  -- Tổng giá vốn thật của hàng trên phiếu (snapshot lúc xuất kho) — dùng cho
  -- báo cáo "giá trị hàng đang đi đường", KHÔNG phải total_amount chứng từ.
  ADD COLUMN IF NOT EXISTS total_cost    NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.stock_transfers.total_amount IS
  'Tổng giá trị chuyển nội bộ = Σ(SL × unit_price). Đây là con số trở thành giá vốn ở kho đích.';
COMMENT ON COLUMN public.stock_transfers.total_cost IS
  'Tổng giá vốn của bên BÁN (snapshot lúc xuất kho). Chỉ để đối chiếu biên nội bộ, không ghi sổ kho đích.';

-- Nới CHECK trạng thái: thêm 'completed' (admin đã duyệt) và 'rejected'.
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE public.stock_transfers
  ADD CONSTRAINT stock_transfers_status_check
  CHECK (status IN ('draft', 'in_transit', 'received', 'completed', 'rejected', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON public.stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_created ON public.stock_transfers(created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. DÒNG PHIẾU: snapshot giá vốn nguồn + giá gốc từ bảng giá
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.stock_transfer_lines
  -- Giá vốn THẬT của lô nguồn, chốt tại thời điểm xuất kho. Đây là con số
  -- duy nhất được ghi vào cost_price của lô ở kho đích.
  ADD COLUMN IF NOT EXISTS source_cost_price NUMERIC(15,2),
  -- Giá bảng giá nội bộ gợi ý ban đầu — để màn hình duyệt chỉ rõ dòng nào
  -- đã bị sửa lệch khỏi bảng giá.
  ADD COLUMN IF NOT EXISTS list_unit_price   NUMERIC(15,2);

COMMENT ON COLUMN public.stock_transfer_lines.unit_price IS
  'Đơn giá bán nội bộ. TRỞ THÀNH giá vốn của lô ở kho đích (bình quân gia quyền) — chi nhánh độc lập.';
COMMENT ON COLUMN public.stock_transfer_lines.source_cost_price IS
  'Giá vốn của bên BÁN, chốt lúc xuất kho. Chỉ để đối chiếu biên nội bộ ở màn hình duyệt, không ghi sổ.';
COMMENT ON COLUMN public.stock_transfer_lines.list_unit_price IS
  'Giá gợi ý từ bảng giá tại lúc lập phiếu; lệch với unit_price = có người sửa tay.';

-- ─────────────────────────────────────────────────────────────
-- 4. BACKFILL: phiếu 'received' theo mô hình CŨ đã cộng tồn vào kho đích rồi
--    → đánh dấu 'completed' để fn_complete_transfer KHÔNG cộng lần hai.
--    Đồng thời vá source_cost_price cho các dòng cũ (dùng giá vốn lô nguồn
--    hiện tại — chỉ để hiển thị, không có tác dụng ghi sổ vì đã completed).
-- ─────────────────────────────────────────────────────────────
UPDATE public.stock_transfers
   SET status      = 'completed',
       approved_by = COALESCE(approved_by, received_by),
       approved_at = COALESCE(approved_at, updated_at),
       received_at = COALESCE(received_at, updated_at)
 WHERE status = 'received';

UPDATE public.stock_transfer_lines l
   SET source_cost_price = sl.cost_price
  FROM public.stock_lots sl
 WHERE sl.id = l.lot_id
   AND l.source_cost_price IS NULL;

UPDATE public.stock_transfer_lines
   SET list_unit_price = unit_price
 WHERE list_unit_price IS NULL;

UPDATE public.stock_transfers t
   SET total_cost = COALESCE((
         SELECT SUM(l.quantity * COALESCE(l.source_cost_price, 0))
           FROM public.stock_transfer_lines l WHERE l.transfer_id = t.id
       ), 0)
 WHERE t.total_cost = 0;

-- ─────────────────────────────────────────────────────────────
-- 5. GUARD: status chỉ đổi được qua RPC (cờ phiên app.transfer_rpc)
--    Frontend cũ insert thẳng status='draft' vẫn chạy bình thường.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_transfer_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.transfer_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Phiếu mới LUÔN là nháp; xoá mọi cờ duyệt nếu client cố set
    NEW.status        := 'draft';
    NEW.received_by   := NULL;
    NEW.received_at   := NULL;
    NEW.shipped_at    := NULL;
    NEW.approved_by   := NULL;
    NEW.approved_at   := NULL;
    NEW.rejected_by   := NULL;
    NEW.rejected_at   := NULL;
    NEW.total_cost    := 0;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Không được đổi trạng thái phiếu chuyển kho trực tiếp. Hãy dùng chức năng Bắt đầu chuyển / Nhận hàng / Duyệt / Huỷ.';
    END IF;
    NEW.received_by := OLD.received_by;
    NEW.received_at := OLD.received_at;
    NEW.shipped_at  := OLD.shipped_at;
    NEW.approved_by := OLD.approved_by;
    NEW.approved_at := OLD.approved_at;
    NEW.rejected_by := OLD.rejected_by;
    NEW.rejected_at := OLD.rejected_at;
    NEW.total_cost  := OLD.total_cost;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_transfer_status ON public.stock_transfers;
CREATE TRIGGER trg_guard_transfer_status
  BEFORE INSERT OR UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_transfer_status();

-- ─────────────────────────────────────────────────────────────
-- 6. RPC: TẠO PHIẾU nguyên tử (header + dòng + tổng tiền trong 1 transaction)
--    p_lines: [{lot_id, quantity, unit_price, list_unit_price}]
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_create_transfer(
  p_from_warehouse UUID,
  p_to_warehouse   UUID,
  p_lines          JSONB,
  p_notes          TEXT DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL,
  p_price_list_id  UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_id        UUID;
  v_line      JSONB;
  v_lot       RECORD;
  v_qty       NUMERIC(15,3);
  v_price     NUMERIC(15,2);
  v_list      NUMERIC(15,2);
  v_total     NUMERIC(15,2) := 0;
  v_my_branch UUID;
  v_seen      UUID[] := ARRAY[]::UUID[];
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')) THEN
    RAISE EXCEPTION 'Không có quyền tạo phiếu chuyển kho (cần warehouse_keeper hoặc admin).';
  END IF;
  IF p_from_warehouse IS NULL OR p_to_warehouse IS NULL THEN
    RAISE EXCEPTION 'Thiếu kho nguồn hoặc kho đích.';
  END IF;
  IF p_from_warehouse = p_to_warehouse THEN
    RAISE EXCEPTION 'Kho nguồn và kho đích phải khác nhau.';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Phiếu chuyển kho phải có ít nhất một dòng sản phẩm.';
  END IF;

  -- Kho nguồn phải thuộc chi nhánh của người lập (admin miễn trừ)
  IF NOT public.fn_is_admin() THEN
    SELECT branch_id INTO v_my_branch FROM public.profiles WHERE id = v_uid;
    IF NOT EXISTS (
      SELECT 1 FROM public.warehouses w
       WHERE w.id = p_from_warehouse AND w.branch_id IS NOT DISTINCT FROM v_my_branch
    ) THEN
      RAISE EXCEPTION 'Bạn chỉ được lập phiếu chuyển từ kho thuộc chi nhánh của mình.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_to_warehouse AND is_active) THEN
    RAISE EXCEPTION 'Kho đích không tồn tại hoặc đã ngừng hoạt động.';
  END IF;

  INSERT INTO public.stock_transfers (
    from_warehouse, to_warehouse, status, notes, reason, price_list_id, created_by, total_amount
  ) VALUES (
    p_from_warehouse, p_to_warehouse, 'draft', p_notes, p_reason, p_price_list_id, v_uid, 0
  ) RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT id, product_id, warehouse_id, quantity_on_hand, quantity_reserved, cost_price, status
      INTO v_lot
      FROM public.stock_lots
     WHERE id = (v_line->>'lot_id')::UUID
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng (id: %).', v_line->>'lot_id';
    END IF;
    IF v_lot.warehouse_id <> p_from_warehouse THEN
      RAISE EXCEPTION 'Lô hàng không thuộc kho nguồn đã chọn.';
    END IF;
    IF v_lot.id = ANY(v_seen) THEN
      RAISE EXCEPTION 'Một lô hàng chỉ được đưa vào phiếu một lần (lô %).', v_lot.id;
    END IF;
    v_seen := v_seen || v_lot.id;

    v_qty   := COALESCE((v_line->>'quantity')::NUMERIC, 0);
    v_price := GREATEST(COALESCE((v_line->>'unit_price')::NUMERIC, 0), 0);
    v_list  := GREATEST(COALESCE((v_line->>'list_unit_price')::NUMERIC, v_price), 0);

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Số lượng chuyển phải lớn hơn 0.';
    END IF;
    IF v_qty > (v_lot.quantity_on_hand - v_lot.quantity_reserved) THEN
      RAISE EXCEPTION 'Lô % không đủ tồn khả dụng. Yêu cầu: %, khả dụng: %.',
        v_lot.id, v_qty, (v_lot.quantity_on_hand - v_lot.quantity_reserved);
    END IF;

    INSERT INTO public.stock_transfer_lines (
      transfer_id, lot_id, product_id, quantity, unit_price, list_unit_price
    ) VALUES (
      v_id, v_lot.id, v_lot.product_id, v_qty, v_price, v_list
    );

    v_total := v_total + (v_qty * v_price);
  END LOOP;

  UPDATE public.stock_transfers SET total_amount = v_total, updated_at = now() WHERE id = v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_create_transfer(UUID, UUID, JSONB, TEXT, TEXT, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7. RPC: BẮT ĐẦU CHUYỂN (draft → in_transit) — trừ tồn kho nguồn
--    + SNAPSHOT giá vốn thật của từng lô nguồn.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_start_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer  RECORD;
  v_line      RECORD;
  v_lot       RECORD;
  v_uid       UUID := auth.uid();  -- actor thật, KHÔNG tin p_user_id
  v_total_cost NUMERIC(15,2) := 0;
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần warehouse_keeper hoặc admin).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'Phiếu chuyển kho phải ở trạng thái Nháp để bắt đầu chuyển (hiện tại: %).', v_transfer.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id) THEN
    RAISE EXCEPTION 'Phiếu chưa có dòng sản phẩm nào.';
  END IF;

  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
    SELECT quantity_on_hand, quantity_reserved, cost_price
      INTO v_lot
      FROM public.stock_lots WHERE id = v_line.lot_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng (id: %).', v_line.lot_id;
    END IF;
    IF (v_lot.quantity_on_hand - v_lot.quantity_reserved) < v_line.quantity THEN
      RAISE EXCEPTION 'Lô hàng không đủ tồn khả dụng. Yêu cầu: %, Khả dụng: %.',
        v_line.quantity, (v_lot.quantity_on_hand - v_lot.quantity_reserved);
    END IF;

    -- CHỐT giá vốn thật tại thời điểm hàng rời kho. Con số này (không phải
    -- unit_price) sẽ trở thành giá vốn của lô ở kho đích khi admin duyệt.
    UPDATE public.stock_transfer_lines
       SET source_cost_price = v_lot.cost_price
     WHERE id = v_line.id;

    v_total_cost := v_total_cost + (v_line.quantity * COALESCE(v_lot.cost_price, 0));

    UPDATE public.stock_lots
    SET quantity_on_hand = quantity_on_hand - v_line.quantity, updated_at = now()
    WHERE id = v_line.lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
      'transfer_out', -v_line.quantity, p_transfer_id, 'transfer', v_lot.cost_price, v_uid
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'in_transit', shipped_at = now(), total_cost = v_total_cost, updated_at = now()
   WHERE id = p_transfer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_start_transfer(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8. RPC: KHO ĐÍCH XÁC NHẬN ĐÃ NHẬN (in_transit → received)
--    ⚠️ ĐỔI HÀNH VI: KHÔNG còn cộng tồn kho ở bước này. Hàng vào kho đích
--    chỉ khi Admin/CEO duyệt (fn_complete_transfer).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_receive_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer RECORD;
  v_uid      UUID := auth.uid();
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần warehouse_keeper hoặc admin).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Phiếu phải ở trạng thái Đang chuyển để xác nhận nhận hàng (hiện tại: %).', v_transfer.status;
  END IF;

  UPDATE public.stock_transfers
     SET status = 'received', received_by = v_uid, received_at = now(), updated_at = now()
   WHERE id = p_transfer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_receive_transfer(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 9. RPC: ADMIN DUYỆT — HOÀN THÀNH (received → completed)
--    Đây là bước DUY NHẤT ghi tồn kho + giá vốn vào kho đích.
--    Chuyển kho = nhập lô mới cho chi nhánh nhận (mô hình nhượng quyền):
--    cost_price lô đích = unit_price của phiếu, BÌNH QUÂN GIA QUYỀN với tồn
--    sẵn có ở kho đích. is_vat/vat_rate giữ nguyên
--    theo lô nguồn (VAT là thuộc tính của hàng, không phụ thuộc vị trí kho).
--    Idempotent: đã có stock_movements transfer_in cho phiếu → không ghi lại.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_complete_transfer(p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer      RECORD;
  v_line          RECORD;
  v_source_lot    RECORD;
  v_target_lot_id UUID;
  v_cost          NUMERIC(15,2);
  v_uid           UUID := auth.uid();
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Tài khoản không hoạt động.';
  END IF;
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ Admin/CEO được duyệt hoàn thành phiếu chuyển kho.';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status <> 'received' THEN
    RAISE EXCEPTION 'Chỉ duyệt được phiếu đã có xác nhận NHẬN HÀNG của kho đích (hiện tại: %).', v_transfer.status;
  END IF;

  -- Chốt chặn cộng kho lần hai (phiếu cũ backfill, hoặc gọi lặp).
  -- Lọc theo kho ĐÍCH để không nhầm với bút toán hoàn kho NGUỒN của
  -- fn_cancel_transfer / fn_reject_transfer (cũng dùng 'transfer_in').
  IF EXISTS (
    SELECT 1 FROM public.stock_movements
     WHERE reference_type = 'transfer' AND reference_id = p_transfer_id
       AND movement_type  = 'transfer_in'
       AND warehouse_id   = v_transfer.to_warehouse
  ) THEN
    UPDATE public.stock_transfers
       SET status = 'completed', approved_by = v_uid, approved_at = now(), updated_at = now()
     WHERE id = p_transfer_id;
    RETURN;
  END IF;

  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
    SELECT lot_number, manufacture_date, expiry_date, cost_price, status, is_vat, vat_rate
      INTO v_source_lot FROM public.stock_lots WHERE id = v_line.lot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy lô hàng nguồn (id: %).', v_line.lot_id;
    END IF;

    -- Giá vốn của chi nhánh NHẬN = giá nó phải trả cho chi nhánh nguồn.
    -- Fallback về giá vốn bên bán nếu phiếu chưa có đơn giá (hàng điều
    -- chuyển nội bộ không tính tiền).
    v_cost := COALESCE(NULLIF(v_line.unit_price, 0), v_line.source_cost_price, v_source_lot.cost_price, 0);

    -- Khớp lô đích theo CẢ is_vat → không trộn VAT vào non-VAT.
    SELECT id INTO v_target_lot_id
      FROM public.stock_lots
     WHERE product_id   = v_line.product_id
       AND lot_number   = v_source_lot.lot_number
       AND warehouse_id = v_transfer.to_warehouse
       AND is_vat       = v_source_lot.is_vat
     FOR UPDATE;

    IF v_target_lot_id IS NOT NULL THEN
      UPDATE public.stock_lots
         SET cost_price = CASE
               WHEN (quantity_on_hand + v_line.quantity) > 0 THEN
                 ROUND(((quantity_on_hand * cost_price) + (v_line.quantity * v_cost))
                       / (quantity_on_hand + v_line.quantity), 2)
               ELSE v_cost
             END,
             quantity_on_hand = quantity_on_hand + v_line.quantity,
             updated_at = now()
       WHERE id = v_target_lot_id;
    ELSE
      INSERT INTO public.stock_lots (
        product_id, warehouse_id, lot_number,
        manufacture_date, expiry_date, cost_price, quantity_on_hand, status,
        is_vat, vat_rate
      ) VALUES (
        v_line.product_id, v_transfer.to_warehouse, v_source_lot.lot_number,
        v_source_lot.manufacture_date, v_source_lot.expiry_date, v_cost,
        v_line.quantity, v_source_lot.status,
        v_source_lot.is_vat, v_source_lot.vat_rate
      ) RETURNING id INTO v_target_lot_id;
    END IF;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, unit_cost, performed_by
    ) VALUES (
      v_target_lot_id, v_line.product_id, v_transfer.to_warehouse,
      'transfer_in', v_line.quantity, p_transfer_id, 'transfer', v_cost, v_uid
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'completed', approved_by = v_uid, approved_at = now(), updated_at = now()
   WHERE id = p_transfer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_complete_transfer(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 10. RPC: ADMIN TỪ CHỐI (received → rejected) — hoàn hàng về kho nguồn.
--     Dùng khi số thực nhận không khớp / hàng hỏng / phiếu sai.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reject_transfer(p_transfer_id uuid, p_reason TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer RECORD;
  v_line     RECORD;
  v_uid      UUID := auth.uid();
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Tài khoản không hoạt động.';
  END IF;
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Chỉ Admin/CEO được từ chối phiếu chuyển kho.';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Phải nhập lý do từ chối.';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status <> 'received' THEN
    RAISE EXCEPTION 'Chỉ từ chối được phiếu đang chờ duyệt (hiện tại: %).', v_transfer.status;
  END IF;

  -- Hoàn số lượng đã trừ về đúng lô ở kho nguồn
  FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
    UPDATE public.stock_lots
       SET quantity_on_hand = quantity_on_hand + v_line.quantity, updated_at = now()
     WHERE id = v_line.lot_id;

    INSERT INTO public.stock_movements (
      lot_id, product_id, warehouse_id, movement_type,
      quantity, reference_id, reference_type, unit_cost, performed_by, notes
    ) VALUES (
      v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
      'transfer_in', v_line.quantity, p_transfer_id, 'transfer',
      v_line.source_cost_price, v_uid, 'Hoàn kho do Admin từ chối phiếu chuyển'
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'rejected', rejected_by = v_uid, rejected_at = now(),
         reject_reason = p_reason, updated_at = now()
   WHERE id = p_transfer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_reject_transfer(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 11. RPC: HUỶ (draft | in_transit → cancelled). Hoàn kho nếu đã xuất.
--     Phiếu đã 'received' KHÔNG huỷ được — phải qua Duyệt/Từ chối của admin.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancel_transfer(p_transfer_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_transfer RECORD;
  v_line     RECORD;
  v_uid      UUID := auth.uid();
BEGIN
  PERFORM set_config('app.transfer_rpc', 'on', true);

  IF NOT public.fn_is_active() OR NOT (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper')) THEN
    RAISE EXCEPTION 'Không có quyền thao tác chuyển kho (cần warehouse_keeper hoặc admin).';
  END IF;

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho.';
  END IF;
  IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
    RAISE EXCEPTION 'Chỉ huỷ được phiếu Nháp hoặc Đang chuyển. Phiếu đã nhận phải do Admin duyệt hoặc từ chối (hiện tại: %).', v_transfer.status;
  END IF;

  IF v_transfer.status = 'in_transit' THEN
    FOR v_line IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id = p_transfer_id LOOP
      UPDATE public.stock_lots
         SET quantity_on_hand = quantity_on_hand + v_line.quantity, updated_at = now()
       WHERE id = v_line.lot_id;

      INSERT INTO public.stock_movements (
        lot_id, product_id, warehouse_id, movement_type,
        quantity, reference_id, reference_type, unit_cost, performed_by, notes
      ) VALUES (
        v_line.lot_id, v_line.product_id, v_transfer.from_warehouse,
        'transfer_in', v_line.quantity, p_transfer_id, 'transfer',
        v_line.source_cost_price, v_uid, 'Hoàn kho do hủy chuyển'
      );
    END LOOP;
  END IF;

  UPDATE public.stock_transfers SET status = 'cancelled', updated_at = now() WHERE id = p_transfer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_cancel_transfer(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 12. RLS: DÒNG PHIẾU chỉ sửa được khi phiếu còn NHÁP.
--     (Trước đây policy FOR ALL không kiểm status → phiếu đã nhận/đã duyệt
--      vẫn thêm/sửa/xoá dòng được, làm lệch total_amount và tồn kho.)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "transfer_lines_manage" ON public.stock_transfer_lines;

CREATE POLICY "transfer_lines_manage_draft" ON public.stock_transfer_lines
  FOR ALL
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND EXISTS (
      SELECT 1 FROM public.stock_transfers t
       WHERE t.id = stock_transfer_lines.transfer_id AND t.status = 'draft'
    )
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND EXISTS (
      SELECT 1 FROM public.stock_transfers t
       WHERE t.id = stock_transfer_lines.transfer_id AND t.status = 'draft'
    )
  );

-- Header: chỉ sửa được (ghi chú/lý do/bảng giá) khi còn nháp; status đã có
-- guard trigger chặn riêng.
DROP POLICY IF EXISTS "stock_transfers_update" ON public.stock_transfers;
CREATE POLICY "stock_transfers_update" ON public.stock_transfers
  FOR UPDATE
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND status = 'draft'
  )
  WITH CHECK (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
  );

DROP POLICY IF EXISTS "stock_transfers_delete" ON public.stock_transfers;
CREATE POLICY "stock_transfers_delete" ON public.stock_transfers
  FOR DELETE
  USING (
    public.fn_is_active()
    AND (public.fn_is_admin() OR public.fn_has_role('warehouse_keeper'))
    AND status IN ('draft', 'cancelled')
  );

-- ─────────────────────────────────────────────────────────────
-- 13. RPC: XEM TRƯỚC giá vốn mới ở kho đích cho từng dòng phiếu.
--     Đây là thông tin Admin cần lúc duyệt: sau khi nhập, giá vốn bình quân
--     của mã hàng tại kho đích thành bao nhiêu → để chốt giá bán hợp lý cho
--     chi nhánh nhận. Tính đúng công thức mà fn_complete_transfer sẽ chạy.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_transfer_cost_preview(p_transfer_id UUID)
RETURNS TABLE (
  line_id          UUID,
  product_id       UUID,
  sku              TEXT,
  product_name     TEXT,
  quantity         NUMERIC,
  source_cost      NUMERIC,   -- giá vốn bên bán
  transfer_price   NUMERIC,   -- đơn giá chuyển = giá vốn bên mua cho lô này
  dest_qty_before  NUMERIC,   -- tồn cùng số lô đang có ở kho đích
  dest_cost_before NUMERIC,   -- giá vốn hiện tại của lô đó ở kho đích
  dest_cost_after  NUMERIC    -- giá vốn SAU khi bình quân gia quyền
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (
    SELECT
      stl.id, stl.product_id, stl.quantity,
      COALESCE(stl.source_cost_price, src.cost_price, 0) AS source_cost,
      COALESCE(NULLIF(stl.unit_price, 0), stl.source_cost_price, src.cost_price, 0) AS transfer_price,
      src.lot_number, src.is_vat, t.to_warehouse
    FROM public.stock_transfer_lines stl
    JOIN public.stock_transfers t ON t.id = stl.transfer_id
    JOIN public.stock_lots     src ON src.id = stl.lot_id
    WHERE stl.transfer_id = p_transfer_id
  ),
  d AS (
    SELECT l.*,
           COALESCE(dst.quantity_on_hand, 0) AS dq,
           COALESCE(dst.cost_price, 0)       AS dc
    FROM l
    LEFT JOIN public.stock_lots dst
           ON dst.product_id   = l.product_id
          AND dst.lot_number   = l.lot_number
          AND dst.warehouse_id = l.to_warehouse
          AND dst.is_vat       = l.is_vat
  )
  SELECT
    d.id, d.product_id, p.sku, p.name,
    d.quantity::NUMERIC,
    d.source_cost::NUMERIC,
    d.transfer_price::NUMERIC,
    d.dq::NUMERIC,
    d.dc::NUMERIC,
    CASE WHEN (d.dq + d.quantity) > 0
         THEN ROUND(((d.dq * d.dc) + (d.quantity * d.transfer_price)) / (d.dq + d.quantity), 2)
         ELSE d.transfer_price END::NUMERIC
  FROM d
  JOIN public.products p ON p.id = d.product_id;
$$;
GRANT EXECUTE ON FUNCTION public.fn_transfer_cost_preview(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 14. RPC: tóm tắt hàng chưa vào sổ kho đích (đang đi đường + chờ duyệt).
--     Vá điểm mù: từ lúc xuất kho tới lúc admin duyệt, hàng không nằm ở
--     kho nào cả nên báo cáo định giá tồn kho không thấy.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_transfer_pending_summary()
RETURNS TABLE (
  in_transit_count  BIGINT,
  in_transit_cost   NUMERIC,
  awaiting_count    BIGINT,
  awaiting_cost     NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COUNT(*) FILTER (WHERE t.status = 'in_transit'),
    COALESCE(SUM(t.total_cost) FILTER (WHERE t.status = 'in_transit'), 0),
    COUNT(*) FILTER (WHERE t.status = 'received'),
    COALESCE(SUM(t.total_cost) FILTER (WHERE t.status = 'received'), 0)
  FROM public.stock_transfers t
  WHERE t.status IN ('in_transit', 'received')
    -- Nhân viên chi nhánh chỉ thấy số của kho thuộc chi nhánh mình (khớp với
    -- phạm vi danh sách phiếu); admin/ceo thấy toàn công ty.
    AND (
      public.fn_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.warehouses w
         WHERE w.id IN (t.from_warehouse, t.to_warehouse)
           AND w.branch_id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
      )
    );
$$;
GRANT EXECUTE ON FUNCTION public.fn_transfer_pending_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
