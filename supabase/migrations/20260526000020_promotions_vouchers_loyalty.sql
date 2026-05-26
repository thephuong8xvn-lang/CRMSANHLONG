-- P4-4: Hoàn thiện Khuyến mãi 6 loại + Tích điểm + Voucher

-- ─────────────────────────────────────────────────────────────
-- 1. Mở rộng bảng promotions: 6 discount_type + thêm cột
-- ─────────────────────────────────────────────────────────────

-- Xóa constraint cũ và thêm mới hỗ trợ 6 loại
ALTER TABLE public.promotions
  DROP CONSTRAINT IF EXISTS promotions_discount_type_check;

ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_discount_type_check
  CHECK (discount_type IN (
    'percent',              -- (1) Giảm % toàn đơn
    'fixed_amount',         -- (2) Giảm số tiền cố định
    'buy_x_get_y',          -- (3) Mua X tặng Y
    'combo_price',          -- (4) Combo giá cố định
    'tiered_quantity',      -- (5) Bậc thang số lượng
    'customer_tier_discount'-- (6) Hạn mức KM theo tier khách
  ));

-- Thêm cột hỗ trợ các loại mới
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS buy_x_qty       INTEGER,            -- Mua X (cho buy_x_get_y)
  ADD COLUMN IF NOT EXISTS get_y_qty       INTEGER,            -- Tặng Y (cho buy_x_get_y)
  ADD COLUMN IF NOT EXISTS get_y_product_id UUID REFERENCES public.products(id),  -- SP tặng
  ADD COLUMN IF NOT EXISTS combo_price     NUMERIC(15,2),      -- Giá combo cố định
  ADD COLUMN IF NOT EXISTS tiers           JSONB DEFAULT '[]', -- [{min_qty, discount_percent}]
  ADD COLUMN IF NOT EXISTS customer_tiers  TEXT[] DEFAULT '{}',-- ['vip','gold'] — tier được hưởng
  ADD COLUMN IF NOT EXISTS priority        INTEGER NOT NULL DEFAULT 0, -- cao hơn = áp dụng trước
  ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES public.users(id);

COMMENT ON COLUMN public.promotions.tiers IS
  'JSON array: [{min_qty:int, discount_percent:numeric}] sắp xếp tăng dần theo min_qty';
COMMENT ON COLUMN public.promotions.customer_tiers IS
  'Danh sách tier được hưởng KM: regular/silver/gold/vip/platinum. Rỗng = áp dụng tất cả';

-- ─────────────────────────────────────────────────────────────
-- 2. Bảng vouchers — mã giảm giá dùng 1 lần
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vouchers (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  code             TEXT          NOT NULL UNIQUE,
  promotion_id     UUID          REFERENCES public.promotions(id) ON DELETE SET NULL,
  discount_type    TEXT          NOT NULL CHECK (discount_type IN ('percent', 'fixed_amount')),
  discount_value   NUMERIC(15,2) NOT NULL,
  min_order_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_discount     NUMERIC(15,2),                 -- giới hạn tối đa khi discount_type = percent
  valid_from       TIMESTAMPTZ,
  valid_to         TIMESTAMPTZ,
  max_uses         INTEGER       NOT NULL DEFAULT 1,
  current_uses     INTEGER       NOT NULL DEFAULT 0,
  used_by          UUID[]        NOT NULL DEFAULT '{}',  -- customer_ids đã dùng
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT vouchers_uses_check CHECK (current_uses <= max_uses OR max_uses IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_code       ON public.vouchers (code);
CREATE INDEX IF NOT EXISTS idx_vouchers_valid      ON public.vouchers (valid_from, valid_to) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_vouchers_active     ON public.vouchers (is_active);

-- ─────────────────────────────────────────────────────────────
-- 3. Bảng loyalty_points — tích điểm khách hàng
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.loyalty_points (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id  UUID          NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  order_id     UUID          REFERENCES public.orders(id) ON DELETE SET NULL,
  points       INTEGER       NOT NULL,  -- dương = cộng, âm = trừ (đổi điểm)
  reason       TEXT          NOT NULL,  -- 'order_paid', 'manual_adjust', 'redemption'
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by   UUID          REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON public.loyalty_points (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_order    ON public.loyalty_points (order_id);

-- View tổng điểm theo khách hàng
CREATE OR REPLACE VIEW public.customer_loyalty_summary AS
SELECT
  customer_id,
  SUM(points) AS total_points,
  SUM(CASE WHEN points > 0 THEN points ELSE 0 END) AS earned_points,
  SUM(CASE WHEN points < 0 THEN ABS(points) ELSE 0 END) AS redeemed_points
FROM public.loyalty_points
GROUP BY customer_id;

-- ─────────────────────────────────────────────────────────────
-- 4. Trigger tích điểm tự động khi order được thanh toán
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_award_loyalty_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_points_rate   NUMERIC;
  v_points        INTEGER;
BEGIN
  -- Chỉ tích điểm khi status chuyển sang paid hoặc completed
  IF (TG_OP = 'UPDATE')
    AND (NEW.status IN ('paid', 'completed'))
    AND (OLD.status NOT IN ('paid', 'completed'))
    AND (NEW.customer_id IS NOT NULL)
  THEN
    -- Đọc tỷ lệ điểm từ system_settings (VND per point, default 10000 VND = 1 điểm)
    SELECT COALESCE(
      (SELECT (value->>'vnd_per_point')::numeric FROM public.system_settings WHERE key = 'loyalty_rate' LIMIT 1),
      10000
    ) INTO v_points_rate;

    v_points := FLOOR(NEW.grand_total / v_points_rate);

    IF v_points > 0 THEN
      INSERT INTO public.loyalty_points (customer_id, order_id, points, reason)
      VALUES (NEW.customer_id, NEW.id, v_points, 'order_paid');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_loyalty_points ON public.orders;
CREATE TRIGGER trg_award_loyalty_points
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_award_loyalty_points();

-- ─────────────────────────────────────────────────────────────
-- 5. RLS cho promotions (đã có, cập nhật)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_points ENABLE ROW LEVEL SECURITY;

-- Vouchers: tất cả auth user đọc active vouchers; admin/super_admin ghi
CREATE POLICY "vouchers_select" ON public.vouchers
  FOR SELECT TO authenticated USING (is_active = true);

CREATE POLICY "vouchers_manage" ON public.vouchers
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
        AND r.code IN ('admin', 'super_admin')
        AND ur.is_active = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
        AND r.code IN ('admin', 'super_admin')
        AND ur.is_active = true)
  );

-- Loyalty points: customer thấy điểm của mình; admin thấy tất cả
CREATE POLICY "loyalty_select_own" ON public.loyalty_points
  FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid()
          AND r.code IN ('admin', 'super_admin', 'branch_director', 'accountant')
          AND ur.is_active = true
    )
  );

CREATE POLICY "loyalty_insert_system" ON public.loyalty_points
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
        AND r.code IN ('admin', 'super_admin', 'accountant')
        AND ur.is_active = true)
  );
