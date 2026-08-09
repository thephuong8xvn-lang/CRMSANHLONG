-- ═══════════════════════════════════════════════════════════════════════════
-- CHĂM SÓC KH — ĐỢT 1: SỬA THƯỚC ĐO "RỜI BỎ" + GHI NHẬN GỌI CÓ ĐẾM SỐ LẦN
-- 2026-08-09
--
-- ── Vì sao phải sửa ───────────────────────────────────────────────────────
-- `fn_customer_churn_metrics` (20260719) chỉ xét TỈ LỆ `số ngày im lặng /
-- nhịp mua`, KHÔNG có sàn ngày tuyệt đối. Lịch sử đơn mới có 72 ngày
-- (29/05→09/08) nên nhiều khách có "nhịp mua" 1–7 ngày ⇒ đo trên prod 09/08:
--   • 28/88 khách bị gắn "Đã rời bỏ" dù mới im lặng < 21 ngày.
--   • 45/105 khách "Có nguy cơ" dù mới im lặng < 14 ngày.
--   • 85/193 khách có nhịp mua < 7 ngày (nhiễu do 2 đơn cách nhau 1 ngày).
-- Ví dụ thật: "Bác 9 Lai-Thị Trấn" (17 đơn) bị gắn RỜI BỎ khi mới mua cách
-- đây 6 ngày. Nhân viên gọi 2–3 người như vậy là bỏ luôn cả danh sách.
--
-- Sửa: điều kiện phải thoả CẢ HAI — tỉ lệ VÀ số ngày tuyệt đối; đồng thời
-- kẹp SÀN nhịp mua (mặc định 7 ngày) để 2 đơn liền ngày không thành "nhịp 1
-- ngày". Sau vá: 92 nguy cơ + 8 rời bỏ (đều im lặng 46–57 ngày).
--
-- ── Vì sao thêm `priority` ────────────────────────────────────────────────
-- `churn_score = clamp(ratio×50)` bão hoà ở 100 với 88/88 khách rời bỏ ⇒ cột
-- "Rủi ro" không phân biệt được ai với ai và `ORDER BY churn_score` không sắp
-- xếp gì. Nó cũng KHÔNG biết khách đáng bao nhiêu tiền: 69,9% danh sách là
-- khách mua dưới 2tr, nằm cùng rổ với khách 103,7tr. `priority` = giá trị
-- (log doanh thu 90 ngày) + độ trễ − đã gọi bao nhiêu lần.
--
-- ── Ghi nhận gọi ──────────────────────────────────────────────────────────
-- Toàn DB có ĐÚNG 1 dòng `activities` ⇒ nút "Ghi nhận gọi" ghi xong không
-- đổi gì trên màn hình nên không ai dùng. Đợt này: đếm số lần gọi, lưu kết
-- quả gọi, tự đặt "tạm lặng" theo kết quả, và trả cả cụm đó về worklist.
--
-- 🔑 Dùng lại bảng `activities` (thêm cột `care_kind`) chứ KHÔNG đẻ bảng mới:
--    lịch sử gọi hiện luôn trên hồ sơ khách và không có 2 nguồn số lệch nhau.
--
-- ⚠️ Apply remote qua Management API + NOTIFY pgrst. KHÔNG dùng db push.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Ngưỡng mới (giữ nguyên khoá cũ, chỉ bồi thêm) ──────────────────────
UPDATE public.system_settings
   SET value = value || jsonb_build_object(
         'min_interval_days', 7,    -- sàn nhịp mua: 2 đơn liền ngày ≠ nhịp 1 ngày
         'at_risk_min_days',  21,   -- chưa im 21 ngày thì KHÔNG gọi là nguy cơ
         'churned_min_days',  45)   -- chưa im 45 ngày thì KHÔNG gọi là rời bỏ
 WHERE key = 'churn_config';

-- ── 2. Cột mới ────────────────────────────────────────────────────────────
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS care_kind TEXT;

DO $$
BEGIN
  ALTER TABLE public.activities
    ADD CONSTRAINT activities_care_kind_chk
    CHECK (care_kind IS NULL OR care_kind IN ('churn','reorder'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.activities.care_kind IS
  'Đánh dấu cuộc gọi phát sinh từ module Chăm sóc KH. NULL = hoạt động CRM thường. '
  'Đếm số lần gọi chăm sóc = count(*) trên cột này, KHÔNG dò theo tiêu đề.';

-- Chỉ to bằng số cuộc gọi chăm sóc thật, không phải cả bảng activities.
CREATE INDEX IF NOT EXISTS idx_activities_care
  ON public.activities (customer_id, created_at DESC)
  WHERE care_kind IS NOT NULL;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS care_snooze_until   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS care_next_followup  DATE;

COMMENT ON COLUMN public.customers.care_snooze_until IS
  'Gọi rồi thì tạm lặng tới mốc này — tin nhắn 07:30/13:30 bỏ qua khách đang '
  'trong thời gian này. Không có nó thì sáng nào nhóm cũng nhận đúng 15 cái tên.';

-- ── 3. Chỉ số vòng đời — bản có SÀN + giá trị + lịch sử gọi ───────────────
-- Đổi kiểu trả về nên phải DROP. Postgres không ghi phụ thuộc hàm-gọi-hàm nên
-- fn_churn_worklist bên dưới (được tạo lại ngay sau) không bị vỡ.
DROP FUNCTION IF EXISTS public.fn_customer_churn_metrics();

CREATE FUNCTION public.fn_customer_churn_metrics()
RETURNS TABLE (
  customer_id        uuid,
  n_orders           integer,
  last_order_at      timestamptz,
  avg_interval_days  numeric,   -- nhịp mua THẬT (để hiển thị)
  eff_interval_days  numeric,   -- nhịp mua sau khi kẹp sàn (để tính)
  days_since         numeric,
  ratio              numeric,
  lifecycle          customer_lifecycle_stage,
  churn_score        smallint,
  revenue_90d        numeric,
  call_count         integer,
  last_call_at       timestamptz,
  last_outcome       text,
  next_followup      date,
  snooze_until       timestamptz,
  priority           smallint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT
      COALESCE(MAX((value->>'at_risk_ratio')::numeric), 1.0)         AS at_risk_ratio,
      COALESCE(MAX((value->>'churned_ratio')::numeric), 2.0)         AS churned_ratio,
      COALESCE(MAX((value->>'fallback_interval_days')::numeric), 45) AS fallback_days,
      COALESCE(MAX((value->>'min_interval_days')::numeric), 7)       AS min_interval,
      COALESCE(MAX((value->>'at_risk_min_days')::numeric), 21)       AS at_risk_min_days,
      COALESCE(MAX((value->>'churned_min_days')::numeric), 45)       AS churned_min_days
    FROM public.system_settings WHERE key = 'churn_config'
  ),
  ord AS (
    SELECT
      o.customer_id,
      count(*)::int      AS n_orders,
      max(o.created_at)  AS last_order_at,
      min(o.created_at)  AS first_order_at,
      COALESCE(SUM(o.grand_total) FILTER (
        WHERE o.created_at >= now() - interval '90 days'), 0) AS revenue_90d
    FROM public.orders o
    WHERE o.status IN ('confirmed','shipping','delivered','paid','completed')
      AND o.customer_id IS NOT NULL
    GROUP BY o.customer_id
  ),
  calls AS (
    SELECT a.customer_id,
           count(*)::int     AS call_count,
           max(a.created_at) AS last_call_at
    FROM public.activities a
    WHERE a.care_kind IS NOT NULL AND a.customer_id IS NOT NULL
    GROUP BY a.customer_id
  ),
  base AS (
    SELECT
      c.id AS customer_id,
      COALESCE(o.n_orders, 0) AS n_orders,
      o.last_order_at,
      COALESCE(o.revenue_90d, 0) AS revenue_90d,
      CASE WHEN o.n_orders >= 2
        THEN GREATEST(1, EXTRACT(epoch FROM (o.last_order_at - o.first_order_at)) / 86400.0 / (o.n_orders - 1))
        ELSE NULL END AS avg_interval_days,
      CASE WHEN o.last_order_at IS NOT NULL
        THEN EXTRACT(epoch FROM (now() - o.last_order_at)) / 86400.0
        ELSE NULL END AS days_since,
      COALESCE(k.call_count, 0) AS call_count,
      k.last_call_at,
      c.care_next_followup,
      c.care_snooze_until
    FROM public.customers c
    LEFT JOIN ord   o ON o.customer_id = c.id
    LEFT JOIN calls k ON k.customer_id = c.id
    WHERE c.is_active = true
  ),
  rated AS (
    SELECT b.*, cfg.*,
      -- Sàn nhịp mua: khách mua 2 đơn cách nhau 1 ngày KHÔNG có nhịp 1 ngày.
      CASE WHEN b.n_orders >= 2
        THEN GREATEST(b.avg_interval_days, cfg.min_interval)
        ELSE cfg.fallback_days END AS eff_interval
    FROM base b CROSS JOIN cfg
  ),
  scored AS (
    SELECT r.*,
      CASE WHEN r.n_orders = 0 THEN NULL
           ELSE r.days_since / r.eff_interval END AS ratio
    FROM rated r
  ),
  final AS (
    SELECT s.*,
      (CASE
        WHEN s.n_orders = 0 THEN 'new'
        -- Phải thoả CẢ tỉ lệ LẪN số ngày tuyệt đối.
        WHEN s.ratio > s.churned_ratio AND s.days_since >= s.churned_min_days THEN 'churned'
        WHEN s.ratio > s.at_risk_ratio AND s.days_since >= s.at_risk_min_days THEN 'at_risk'
        ELSE 'active'
      END)::customer_lifecycle_stage AS lifecycle
    FROM scored s
  )
  SELECT
    f.customer_id,
    f.n_orders,
    f.last_order_at,
    ROUND(f.avg_interval_days, 1),
    ROUND(f.eff_interval, 1),
    ROUND(f.days_since, 0),
    ROUND(f.ratio, 2),
    f.lifecycle,
    (CASE WHEN f.ratio IS NULL THEN 0
          ELSE LEAST(100, GREATEST(0, round(f.ratio * 50)))::int END)::smallint,
    ROUND(f.revenue_90d),
    f.call_count,
    f.last_call_at,
    (SELECT a.outcome FROM public.activities a
      WHERE a.customer_id = f.customer_id AND a.care_kind IS NOT NULL
      ORDER BY a.created_at DESC LIMIT 1),
    f.care_next_followup,
    f.care_snooze_until,
    -- Điểm ưu tiên gọi 0–100: TIỀN (log, tránh 1 khách khổng lồ nuốt bảng)
    -- + ĐỘ TRỄ − ĐÃ GỌI RỒI. Thay cho churn_score đã bão hoà ở 100.
    (CASE WHEN f.lifecycle NOT IN ('at_risk','churned') THEN 0 ELSE
      GREATEST(0, LEAST(100,
          LEAST(45, round(9 * ln(1 + f.revenue_90d / 1000000.0)))
        + CASE WHEN f.lifecycle = 'churned' THEN 35 ELSE 20 END
        + LEAST(20, GREATEST(0, round((f.ratio - 1) * 8)))
        - LEAST(25, f.call_count * 12)
      )) END)::smallint
  FROM final f;
$$;

REVOKE ALL ON FUNCTION public.fn_customer_churn_metrics() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_customer_churn_metrics() IS
  'Chỉ số vòng đời KH: tỉ lệ trễ so nhịp mua ĐÃ KẸP SÀN + sàn ngày tuyệt đối '
  '(at_risk_min_days / churned_min_days trong system_settings.churn_config). '
  'Kèm doanh thu 90 ngày, lịch sử gọi chăm sóc và điểm ưu tiên gọi.';

-- ── 4. Ghi nhận cuộc gọi ──────────────────────────────────────────────────
-- Một RPC thay cho 2 vòng mạng của FE (tra activity_types rồi mới insert) và
-- thay cho việc ghi thẳng bảng dưới RLS. Trả về SỐ LẦN ĐÃ GỌI để FE hiện ngay.
--
-- Kết quả gọi tự quyết định "tạm lặng" bao lâu — đây mới là thứ làm tin nhắn
-- 07:30/13:30 mỗi hôm một khác thay vì lặp lại đúng 15 cái tên.
CREATE OR REPLACE FUNCTION public.fn_log_care_call(
  p_customer_id   uuid,
  p_content       text DEFAULT NULL,
  p_outcome       text DEFAULT 'khac',
  p_next_followup date DEFAULT NULL,
  p_kind          text DEFAULT 'churn'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_type    uuid;
  v_name    text;
  v_days    integer;
  v_snooze  timestamptz;
  v_count   integer;
BEGIN
  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Không có quyền ghi nhận cuộc gọi' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('churn','reorder') THEN
    RAISE EXCEPTION 'p_kind phải là churn hoặc reorder, nhận: %', p_kind;
  END IF;

  SELECT c.farm_name INTO v_name FROM public.customers c WHERE c.id = p_customer_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy khách hàng' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_type FROM public.activity_types WHERE code = 'call';
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Thiếu loại hoạt động "call" trong cấu hình';
  END IF;

  v_days := CASE p_outcome
              WHEN 'hen_mua'      THEN 7     -- khách hẹn sẽ mua lại
              WHEN 'khong_nghe'   THEN 1     -- mai gọi lại
              WHEN 'can_nhac'     THEN 3     -- đang cân nhắc / hỏi giá
              WHEN 'mua_noi_khac' THEN 30    -- đã mua nơi khác, hạ ưu tiên
              WHEN 'ngung_nuoi'   THEN 365   -- ngừng chăn nuôi, ra khỏi danh sách
              ELSE 3
            END;

  -- Ngày hẹn do người gọi nhập LUÔN thắng mốc suy ra từ kết quả.
  v_snooze := CASE
                WHEN p_next_followup IS NOT NULL
                  THEN timezone('Asia/Ho_Chi_Minh', p_next_followup::timestamp)
                ELSE now() + (interval '1 day' * v_days)
              END;

  INSERT INTO public.activities (
    activity_type_id, customer_id, owner_user_id, title, content, outcome,
    status, completed_at, scheduled_at, care_kind)
  VALUES (
    v_type, p_customer_id, v_uid,
    'Gọi chăm sóc — ' || v_name,
    NULLIF(btrim(COALESCE(p_content,'')), ''),
    p_outcome,
    'done', now(),
    CASE WHEN p_next_followup IS NOT NULL
         THEN timezone('Asia/Ho_Chi_Minh', p_next_followup::timestamp) END,
    p_kind);

  UPDATE public.customers
     SET care_snooze_until  = v_snooze,
         care_next_followup = p_next_followup
   WHERE id = p_customer_id;

  SELECT count(*)::int INTO v_count FROM public.activities
   WHERE customer_id = p_customer_id AND care_kind IS NOT NULL;

  RETURN jsonb_build_object(
    'call_count',   v_count,
    'snooze_until', v_snooze,
    'outcome',      p_outcome);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_log_care_call(uuid,text,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_log_care_call(uuid,text,text,date,text) TO authenticated;

-- ── 5. Lịch sử gọi của 1 khách (hiện trong hộp thoại ghi nhận) ────────────
CREATE OR REPLACE FUNCTION public.fn_care_call_history(p_customer_id uuid)
RETURNS TABLE (
  id          uuid,
  called_at   timestamptz,
  by_name     text,
  outcome     text,
  content     text,
  next_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.created_at, pr.full_name, a.outcome, a.content, a.scheduled_at
  FROM public.activities a
  LEFT JOIN public.profiles pr ON pr.id = a.owner_user_id
  WHERE a.customer_id = p_customer_id AND a.care_kind IS NOT NULL
    AND public.fn_is_active()
  ORDER BY a.created_at DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.fn_care_call_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_care_call_history(uuid) TO authenticated;

-- ── 6. Worklist — thêm giá trị khách + lịch sử gọi + điểm ưu tiên ─────────
DROP FUNCTION IF EXISTS public.fn_churn_worklist(uuid);

CREATE FUNCTION public.fn_churn_worklist(p_owner_id uuid DEFAULT NULL)
RETURNS TABLE (
  customer_id       uuid,
  code              text,
  farm_name         text,
  owner_user_id     uuid,
  owner_name        text,
  branch_id         uuid,
  branch_name       text,
  lifecycle         customer_lifecycle_stage,
  churn_score       smallint,
  priority          smallint,
  last_order_at     timestamptz,
  days_since        numeric,
  avg_interval_days numeric,
  n_orders          integer,
  revenue_90d       numeric,
  total_debt        numeric,
  phone             text,
  call_count        integer,
  last_call_at      timestamptz,
  last_outcome      text,
  next_followup     date,
  snooze_until      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid      uuid    := auth.uid();
  v_is_admin boolean := public.fn_is_admin() OR public.fn_has_role('ceo');
  v_is_bm    boolean := public.fn_has_role('branch_manager');
  v_is_tl    boolean := public.fn_has_role('team_lead');
BEGIN
  IF NOT public.fn_is_active() THEN
    RAISE EXCEPTION 'Không có quyền xem danh sách chăm sóc' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.code, c.farm_name,
    c.owner_user_id, pr.full_name, c.branch_id, br.name,
    m.lifecycle, m.churn_score, m.priority,
    m.last_order_at, m.days_since, m.avg_interval_days, m.n_orders,
    m.revenue_90d,
    COALESCE((SELECT SUM(d.amount) FROM public.customer_debts d
              WHERE d.customer_id = c.id AND d.is_settled = false), 0)::numeric,
    COALESCE(c.primary_phone,
             (SELECT cc.phone FROM public.customer_contacts cc
               WHERE cc.customer_id = c.id AND cc.is_primary = true LIMIT 1)),
    m.call_count, m.last_call_at, m.last_outcome, m.next_followup, m.snooze_until
  FROM public.fn_customer_churn_metrics() m
  JOIN public.customers c      ON c.id = m.customer_id
  LEFT JOIN public.profiles pr ON pr.id = c.owner_user_id
  LEFT JOIN public.branches br ON br.id = c.branch_id
  WHERE c.is_active = true
    AND m.lifecycle IN ('at_risk','churned')
    AND (
      v_is_admin
      OR (v_is_bm AND c.branch_id = public.fn_my_branch_id())
      OR (v_is_tl AND c.team_id   = public.fn_my_team_id())
      OR (NOT v_is_admin AND NOT v_is_bm AND NOT v_is_tl AND c.owner_user_id = v_uid)
    )
    AND (p_owner_id IS NULL OR c.owner_user_id = p_owner_id)
  ORDER BY m.priority DESC, m.days_since DESC NULLS LAST
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_churn_worklist(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_churn_worklist(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_churn_worklist(uuid) IS
  'Danh sách KH at_risk/churned, xếp theo ĐIỂM ƯU TIÊN (tiền × độ trễ − đã gọi), '
  'scope theo vai trò. Live, không phụ thuộc job nightly.';

NOTIFY pgrst, 'reload schema';
