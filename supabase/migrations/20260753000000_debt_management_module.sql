-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE QUẢN LÝ CÔNG NỢ — lớp dữ liệu
-- 2026-08-05
--
-- Mục tiêu (user chốt): một nơi duy nhất để QUAN SÁT dư nợ, THU HỒI VỐN và
-- NHẮC NHÂN VIÊN KINH DOANH. Chủ yếu công nợ khách hàng; nợ NCC chỉ để xem.
--
-- Nguyên tắc:
--   • Sổ cái công nợ DUY NHẤT = `customer_debts` (is_settled = false).
--     KHÔNG dùng `orders.debt_amount` — cột đó không được cập nhật khi thu nợ
--     qua fn_collect_customer_debt nên đang lệch (đo 05/08: 780tr vs 419tr).
--   • Công nợ là công nợ TỔNG toàn công ty (model-multi-branch-business):
--     không thêm ranh giới chi nhánh vào bất kỳ hàm nào ở đây.
--   • Chốt quyền bằng MÃ QUYỀN `reports.debt`, KHÔNG bằng tên vai trò.
--     User chốt 05/08: MỌI nhân viên đều xem được → cấp mã này cho cả 9 vai
--     trò. Muốn thu hồi sau này: bỏ tick ô "Báo cáo → Công nợ" ở màn Cấu hình.
--   • Ngày biên luôn quy về giờ VN (Asia/Ho_Chi_Minh) — xem bài học ở
--     fix-returns-excluded-from-reports (cộng INTERVAL theo UTC làm rụng ngày).
--
-- Ghi chú nghiệp vụ quan trọng:
--   50% dư nợ (72 dòng / ~287tr) là ĐIỀU CHỈNH TAY với due_date = NULL nên
--   không bao giờ bị coi là quá hạn. Module này KHÔNG bịa hạn cho chúng; thay
--   vào đó tách hẳn một nhóm "Không có hạn" kèm số ngày kể từ lúc ghi nhận, và
--   đưa vào digest Telegram thành mục riêng để chúng thôi vô hình.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Cấp quyền xem công nợ cho mọi vai trò ─────────────────────────────
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.code = 'reports.debt'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── Helper: cổng đọc của module ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_can_view_debts()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.fn_is_active()
     AND (public.fn_is_admin() OR public.fn_has_permission('reports.debt'));
$$;

-- Gỡ theo TÊN (không liệt kê chữ ký cũ) để apply lần 2 không vỡ.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('fn_debt_overview', 'fn_debt_ledger',
                        'fn_customer_debt_detail', 'fn_supplier_debt_overview')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fn_debt_overview() — toàn bộ tab Tổng quan trong MỘT lượt gọi
-- ═══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.fn_debt_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_month_beg date := date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::date;
  v_rev90     numeric;
  v_out       jsonb;
BEGIN
  IF NOT public.fn_can_view_debts() THEN
    RAISE EXCEPTION 'Không có quyền xem công nợ.' USING ERRCODE = '42501';
  END IF;

  -- Doanh thu 90 ngày → mẫu số của DSO (số ngày thu tiền bình quân)
  SELECT COALESCE(SUM(o.grand_total), 0) INTO v_rev90
  FROM public.orders o
  WHERE o.status NOT IN ('cancelled', 'draft')
    AND o.created_at >= now() - INTERVAL '90 day';

  WITH ln AS (
    SELECT d.customer_id, d.amount, d.due_date, d.order_id,
           (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS ghi_ngay
    FROM public.customer_debts d
    WHERE d.is_settled = false
  ),
  pos AS (SELECT * FROM ln WHERE amount > 0),
  -- Gộp về từng khách để đếm "số khách" cho đúng (không đếm theo dòng)
  per_kh AS (
    SELECT customer_id,
           SUM(amount)                                                   AS du_no,
           SUM(amount) FILTER (WHERE amount > 0)                         AS no_goc,
           SUM(amount) FILTER (WHERE amount > 0 AND due_date < v_today)  AS qua_han,
           SUM(amount) FILTER (WHERE amount > 0 AND due_date IS NULL)    AS khong_han,
           MIN(due_date) FILTER (WHERE amount > 0 AND due_date < v_today) AS han_cu_nhat
    FROM ln GROUP BY customer_id
  ),
  kpi AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)                       AS no_goc,
      COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0)                       AS tra_truoc,
      COALESCE(SUM(amount), 0)                                                 AS du_no_rong,
      COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND due_date < v_today), 0) AS qua_han,
      COUNT(*) FILTER (WHERE amount > 0 AND due_date < v_today)                AS qua_han_dong,
      COALESCE(SUM(amount) FILTER (WHERE amount > 0
        AND due_date >= v_today AND due_date <= v_today + 7), 0)               AS den_han_7n,
      COUNT(*) FILTER (WHERE amount > 0
        AND due_date >= v_today AND due_date <= v_today + 7)                   AS den_han_7n_dong,
      COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND due_date IS NULL), 0)  AS khong_han,
      COUNT(*) FILTER (WHERE amount > 0 AND due_date IS NULL)                  AS khong_han_dong
    FROM ln
  )
  SELECT jsonb_build_object(
    'as_of', v_today,

    -- ── Dải KPI ──
    'kpi', (SELECT jsonb_build_object(
        'du_no_rong',       k.du_no_rong,
        'no_goc',           k.no_goc,
        'tra_truoc',        k.tra_truoc,
        'so_kh_no',         (SELECT COUNT(*) FROM per_kh WHERE du_no > 0),
        'qua_han',          k.qua_han,
        'qua_han_dong',     k.qua_han_dong,
        'so_kh_qua_han',    (SELECT COUNT(*) FROM per_kh WHERE COALESCE(qua_han,0) > 0),
        'den_han_7n',       k.den_han_7n,
        'den_han_7n_dong',  k.den_han_7n_dong,
        'khong_han',        k.khong_han,
        'khong_han_dong',   k.khong_han_dong,
        'so_kh_khong_han',  (SELECT COUNT(*) FROM per_kh WHERE COALESCE(khong_han,0) > 0),
        'thu_thang_nay',    (SELECT COALESCE(SUM(amount), 0) FROM public.debt_payments
                              WHERE payment_date >= v_month_beg),
        'thu_30n',          (SELECT COALESCE(SUM(amount), 0) FROM public.debt_payments
                              WHERE payment_date >= v_today - 30),
        'no_moi_30n',       (SELECT COALESCE(SUM(amount), 0) FROM public.customer_debts
                              WHERE amount > 0 AND created_at >= now() - INTERVAL '30 day'),
        'doanh_thu_90n',    v_rev90,
        -- DSO: dư nợ ròng tương đương bao nhiêu ngày doanh thu
        'dso',              CASE WHEN v_rev90 > 0
                                 THEN ROUND(k.du_no_rong / (v_rev90 / 90.0), 1)
                                 ELSE NULL END,
        'ty_le_qua_han',    CASE WHEN k.no_goc > 0
                                 THEN ROUND(100.0 * k.qua_han / k.no_goc, 1)
                                 ELSE 0 END
      ) FROM kpi k),

    -- ── Tuổi nợ ──
    'aging', (SELECT COALESCE(jsonb_agg(x ORDER BY x.thu_tu), '[]'::jsonb) FROM (
        SELECT b.thu_tu, b.nhan,
               COUNT(p.amount)                AS so_dong,
               COALESCE(SUM(p.amount), 0)     AS so_tien,
               COUNT(DISTINCT p.customer_id)  AS so_kh
        FROM (VALUES
              (1, 'Chưa đến hạn'), (2, 'Quá 1–30 ngày'), (3, 'Quá 31–60 ngày'),
              (4, 'Quá 61–90 ngày'), (5, 'Quá trên 90 ngày'), (6, 'Không có hạn')
             ) AS b(thu_tu, nhan)
        LEFT JOIN pos p ON b.thu_tu = CASE
              WHEN p.due_date IS NULL              THEN 6
              WHEN p.due_date >= v_today           THEN 1
              WHEN v_today - p.due_date <= 30      THEN 2
              WHEN v_today - p.due_date <= 60      THEN 3
              WHEN v_today - p.due_date <= 90      THEN 4
              ELSE 5 END
        GROUP BY b.thu_tu, b.nhan
      ) x),

    -- ── Xu hướng 6 tháng: nợ mới phát sinh vs tiền thu về ──
    'trend', (SELECT COALESCE(jsonb_agg(x ORDER BY x.thang), '[]'::jsonb) FROM (
        SELECT to_char(m.thang, 'MM/YYYY') AS thang,
               (SELECT COALESCE(SUM(cd.amount), 0) FROM public.customer_debts cd
                 WHERE cd.amount > 0
                   AND (cd.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                       >= m.thang
                   AND (cd.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                       < (m.thang + INTERVAL '1 month')::date) AS no_moi,
               (SELECT COALESCE(SUM(dp.amount), 0) FROM public.debt_payments dp
                 WHERE dp.payment_date >= m.thang
                   AND dp.payment_date < (m.thang + INTERVAL '1 month')::date) AS thu_ve
        FROM (SELECT (date_trunc('month', v_month_beg) - (n || ' month')::interval)::date AS thang
              FROM generate_series(5, 0, -1) n) m
      ) x),

    -- ── Theo nhân viên kinh doanh phụ trách ──
    'by_staff', (SELECT COALESCE(jsonb_agg(x ORDER BY x.qua_han DESC, x.du_no DESC), '[]'::jsonb) FROM (
        SELECT COALESCE(pr.full_name, 'Chưa phân công')       AS nhan_vien,
               c.owner_user_id                                AS owner_id,
               COALESCE(b.name, '—')                          AS chi_nhanh,
               COUNT(*)                                       AS so_kh_no,
               COUNT(*) FILTER (WHERE COALESCE(k.qua_han,0) > 0) AS so_kh_qua_han,
               COALESCE(SUM(k.du_no), 0)                      AS du_no,
               COALESCE(SUM(k.qua_han), 0)                    AS qua_han,
               COALESCE(SUM(k.khong_han), 0)                  AS khong_han,
               CASE WHEN SUM(k.no_goc) > 0
                    THEN ROUND(100.0 * COALESCE(SUM(k.qua_han),0) / SUM(k.no_goc), 1)
                    ELSE 0 END                                AS ty_le_qua_han,
               (SELECT COALESCE(SUM(dp.amount), 0)
                  FROM public.debt_payments dp
                  JOIN public.customers c2 ON c2.id = dp.customer_id
                 WHERE dp.payment_date >= v_today - 30
                   AND c2.owner_user_id IS NOT DISTINCT FROM c.owner_user_id) AS thu_30n
        FROM per_kh k
        JOIN public.customers c ON c.id = k.customer_id
        LEFT JOIN public.profiles pr ON pr.id = c.owner_user_id
        LEFT JOIN public.branches b  ON b.id = pr.branch_id
        WHERE k.du_no > 0
        GROUP BY c.owner_user_id, pr.full_name, b.name
      ) x),

    -- ── Cần gọi hôm nay: quá hạn nặng nhất trước, rồi tới hạn trong 7 ngày ──
    'call_list', (SELECT COALESCE(jsonb_agg(x ORDER BY x.uu_tien, x.qua_han DESC, x.du_no DESC), '[]'::jsonb) FROM (
        SELECT k.customer_id,
               c.code,
               COALESCE(NULLIF(c.farm_name, ''), 'Khách chưa đặt tên') AS ten,
               c.primary_phone                                        AS dien_thoai,
               COALESCE(pr.full_name, 'Chưa phân công')               AS nhan_vien,
               k.du_no, COALESCE(k.qua_han, 0) AS qua_han,
               k.han_cu_nhat,
               CASE WHEN k.han_cu_nhat IS NOT NULL
                    THEN v_today - k.han_cu_nhat ELSE NULL END        AS so_ngay_qua_han,
               CASE WHEN COALESCE(k.qua_han,0) > 0 THEN 1 ELSE 2 END  AS uu_tien,
               (SELECT MAX(dp.payment_date) FROM public.debt_payments dp
                 WHERE dp.customer_id = k.customer_id)                AS lan_thu_gan_nhat
        FROM per_kh k
        JOIN public.customers c ON c.id = k.customer_id
        LEFT JOIN public.profiles pr ON pr.id = c.owner_user_id
        WHERE k.du_no > 0
          AND (COALESCE(k.qua_han, 0) > 0
               OR EXISTS (SELECT 1 FROM pos p WHERE p.customer_id = k.customer_id
                            AND p.due_date >= v_today AND p.due_date <= v_today + 7))
        LIMIT 30
      ) x)
  ) INTO v_out;

  RETURN v_out;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. fn_debt_ledger() — bảng chi tiết công nợ theo khách (có dòng TỔNG)
--    p_bucket: all | overdue | due_soon | no_duedate | current | advance
-- ═══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.fn_debt_ledger(
  p_search   text    DEFAULT NULL,
  p_bucket   text    DEFAULT 'all',
  p_owner_id uuid    DEFAULT NULL,
  p_sort     text    DEFAULT 'du_no',
  p_limit    integer DEFAULT 50,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  customer_id       uuid,
  code              text,
  ten               text,
  dien_thoai        text,
  nhan_vien         text,
  chi_nhanh         text,
  du_no             numeric,
  qua_han           numeric,
  den_han_7n        numeric,
  chua_den_han      numeric,
  khong_han         numeric,
  tra_truoc         numeric,
  han_cu_nhat       date,
  so_ngay_qua_han   integer,
  so_dong           integer,
  credit_limit      numeric,
  ty_le_dung_han_muc numeric,
  lan_thu_gan_nhat  date,
  mua_gan_nhat      timestamptz,
  -- Tổng của TOÀN BỘ kết quả lọc (không chỉ trang hiện tại) + tổng số dòng
  tong_du_no        numeric,
  tong_qua_han      numeric,
  tong_so_kh        bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_q     text := NULLIF(TRIM(COALESCE(p_search, '')), '');
BEGIN
  IF NOT public.fn_can_view_debts() THEN
    RAISE EXCEPTION 'Không có quyền xem công nợ.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH per_kh AS (
    SELECT d.customer_id AS cid,
           SUM(d.amount)                                                    AS s_du_no,
           SUM(d.amount) FILTER (WHERE d.amount > 0)                        AS s_no_goc,
           COALESCE(SUM(d.amount) FILTER (WHERE d.amount > 0 AND d.due_date < v_today), 0) AS s_qua_han,
           COALESCE(SUM(d.amount) FILTER (WHERE d.amount > 0
             AND d.due_date >= v_today AND d.due_date <= v_today + 7), 0)   AS s_den_han_7n,
           COALESCE(SUM(d.amount) FILTER (WHERE d.amount > 0 AND d.due_date > v_today + 7), 0) AS s_chua_den_han,
           COALESCE(SUM(d.amount) FILTER (WHERE d.amount > 0 AND d.due_date IS NULL), 0)  AS s_khong_han,
           COALESCE(SUM(d.amount) FILTER (WHERE d.amount < 0), 0)           AS s_tra_truoc,
           MIN(d.due_date) FILTER (WHERE d.amount > 0 AND d.due_date < v_today) AS s_han_cu_nhat,
           COUNT(*)::integer                                                AS s_so_dong
    FROM public.customer_debts d
    WHERE d.is_settled = false
    GROUP BY d.customer_id
  ),
  joined AS (
    SELECT k.*,
           c.id AS c_id, c.code AS c_code,
           COALESCE(NULLIF(c.farm_name, ''), 'Khách chưa đặt tên') AS c_ten,
           c.primary_phone AS c_phone,
           c.credit_limit  AS c_limit,
           COALESCE(pr.full_name, 'Chưa phân công') AS c_nv,
           COALESCE(b.name, '—')                    AS c_cn,
           c.owner_user_id AS c_owner
    FROM per_kh k
    JOIN public.customers c ON c.id = k.cid
    LEFT JOIN public.profiles pr ON pr.id = c.owner_user_id
    LEFT JOIN public.branches b  ON b.id = pr.branch_id
  ),
  filtered AS (
    SELECT * FROM joined j
    WHERE (p_bucket = 'advance' AND j.s_du_no < 0
           OR p_bucket <> 'advance' AND j.s_du_no > 0)
      AND CASE p_bucket
            WHEN 'overdue'    THEN j.s_qua_han > 0
            WHEN 'due_soon'   THEN j.s_den_han_7n > 0
            WHEN 'no_duedate' THEN j.s_khong_han > 0
            WHEN 'current'    THEN j.s_chua_den_han > 0
            ELSE true
          END
      AND (p_owner_id IS NULL OR j.c_owner = p_owner_id)
      AND (v_q IS NULL
           OR j.c_ten ILIKE '%' || v_q || '%'
           OR j.c_code ILIKE '%' || v_q || '%'
           OR COALESCE(j.c_phone, '') ILIKE '%' || v_q || '%')
  )
  SELECT
    f.c_id, f.c_code, f.c_ten, f.c_phone, f.c_nv, f.c_cn,
    f.s_du_no, f.s_qua_han, f.s_den_han_7n, f.s_chua_den_han,
    f.s_khong_han, f.s_tra_truoc,
    f.s_han_cu_nhat,
    CASE WHEN f.s_han_cu_nhat IS NOT NULL
         THEN (v_today - f.s_han_cu_nhat)::integer ELSE NULL END,
    f.s_so_dong,
    COALESCE(f.c_limit, 0),
    CASE WHEN COALESCE(f.c_limit, 0) > 0
         THEN ROUND(100.0 * f.s_du_no / f.c_limit, 1) ELSE NULL END,
    (SELECT MAX(dp.payment_date) FROM public.debt_payments dp WHERE dp.customer_id = f.c_id),
    (SELECT MAX(o.created_at)    FROM public.orders o        WHERE o.customer_id = f.c_id),
    SUM(f.s_du_no)   OVER (),
    SUM(f.s_qua_han) OVER (),
    COUNT(*)         OVER ()
  FROM filtered f
  ORDER BY
    CASE WHEN p_sort = 'qua_han'    THEN f.s_qua_han END DESC NULLS LAST,
    CASE WHEN p_sort = 'cu_nhat'    THEN f.s_han_cu_nhat END ASC NULLS LAST,
    CASE WHEN p_sort = 'ten'        THEN f.c_ten END ASC,
    CASE WHEN p_sort NOT IN ('qua_han','cu_nhat','ten') THEN ABS(f.s_du_no) END DESC NULLS LAST
  LIMIT  GREATEST(COALESCE(p_limit, 50), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. fn_customer_debt_detail() — bung dòng: từng khoản nợ + lịch sử thu
-- ═══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.fn_customer_debt_detail(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  IF NOT public.fn_can_view_debts() THEN
    RAISE EXCEPTION 'Không có quyền xem công nợ.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'lines', (SELECT COALESCE(jsonb_agg(x ORDER BY x.uu_tien, x.han_tra NULLS LAST, x.ghi_ngay), '[]'::jsonb) FROM (
        SELECT d.id,
               d.amount                                                     AS so_tien,
               d.due_date                                                   AS han_tra,
               (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date         AS ghi_ngay,
               CASE WHEN d.due_date IS NOT NULL AND d.due_date < v_today
                    THEN v_today - d.due_date ELSE NULL END                 AS so_ngay_qua_han,
               v_today - (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS tuoi_ngay,
               CASE
                 WHEN d.amount < 0                THEN 'Khách trả trước'
                 WHEN d.order_id IS NULL          THEN 'Điều chỉnh tay'
                 ELSE 'Nợ đơn hàng' END                                     AS loai,
               o.order_code                                                 AS ma_don,
               d.order_id,
               COALESCE(d.notes, '')                                        AS ghi_chu,
               COALESCE(pr.full_name, '—')                                  AS nguoi_lap,
               CASE WHEN d.amount < 0 THEN 3
                    WHEN d.due_date IS NULL THEN 2 ELSE 1 END               AS uu_tien
        FROM public.customer_debts d
        LEFT JOIN public.orders   o  ON o.id  = d.order_id
        LEFT JOIN public.profiles pr ON pr.id = d.created_by
        WHERE d.customer_id = p_customer_id AND d.is_settled = false
      ) x),

    'payments', (SELECT COALESCE(jsonb_agg(x ORDER BY x.ngay_thu DESC), '[]'::jsonb) FROM (
        SELECT dp.id,
               dp.amount                        AS so_tien,
               dp.payment_date                  AS ngay_thu,
               dp.payment_method::text          AS hinh_thuc,
               COALESCE(dp.reference_no, '')    AS tham_chieu,
               COALESCE(dp.notes, '')           AS ghi_chu,
               COALESCE(pr.full_name, '—')      AS nguoi_thu,
               COALESCE(b.name, '—')            AS chi_nhanh
        FROM public.debt_payments dp
        LEFT JOIN public.profiles pr ON pr.id = dp.recorded_by
        LEFT JOIN public.branches b  ON b.id  = pr.branch_id
        WHERE dp.customer_id = p_customer_id
        ORDER BY dp.payment_date DESC
        LIMIT 20
      ) x),

    'settled_recent', (SELECT COALESCE(jsonb_agg(x ORDER BY x.tat_toan DESC), '[]'::jsonb) FROM (
        SELECT d.amount AS so_tien, d.settled_at AS tat_toan, o.order_code AS ma_don
        FROM public.customer_debts d
        LEFT JOIN public.orders o ON o.id = d.order_id
        WHERE d.customer_id = p_customer_id AND d.is_settled = true
        ORDER BY d.settled_at DESC NULLS LAST
        LIMIT 10
      ) x)
  );
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. fn_supplier_debt_overview() — tab Nợ nhà cung cấp (CHỈ XEM)
--
-- ⚠️ Cảnh báo dữ liệu: `suppliers.current_debt_payable` chỉ CỘNG khi phiếu
--    nhập completed và TRỪ khi trả hàng / có phiếu supplier_payments. Đo
--    05/08/2026: 0 phiếu thanh toán NCC nào từng được ghi → số dư 2,92 tỷ là
--    tích luỹ thuần, chưa phản ánh tiền đã trả thực tế. Hàm trả kèm
--    `da_thanh_toan` để nhìn thấy ngay điều đó.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.fn_supplier_debt_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.fn_can_view_debts() THEN
    RAISE EXCEPTION 'Không có quyền xem công nợ.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'kpi', (SELECT jsonb_build_object(
        'tong_phai_tra',   COALESCE(SUM(s.current_debt_payable), 0),
        'so_ncc_con_no',   COUNT(*) FILTER (WHERE COALESCE(s.current_debt_payable, 0) > 0),
        'so_ncc',          COUNT(*),
        'tong_da_nhap',    (SELECT COALESCE(SUM(gr.total_amount), 0) FROM public.goods_receipts gr
                             WHERE gr.status = 'completed'),
        'tong_tra_hang',   (SELECT COALESCE(SUM(pr2.total_amount), 0) FROM public.purchase_returns pr2
                             WHERE pr2.status IN ('confirmed', 'completed')),
        'tong_da_thanh_toan', (SELECT COALESCE(SUM(sp.amount), 0) FROM public.supplier_payments sp),
        'so_phieu_thanh_toan', (SELECT COUNT(*) FROM public.supplier_payments)
      ) FROM public.suppliers s),

    'rows', (SELECT COALESCE(jsonb_agg(x ORDER BY x.phai_tra DESC), '[]'::jsonb) FROM (
        SELECT s.id,
               s.code,
               s.name                                    AS ten,
               COALESCE(s.current_debt_payable, 0)       AS phai_tra,
               COALESCE(s.payment_terms, '—')            AS dieu_khoan,
               s.is_active                               AS dang_hop_tac,
               (SELECT COALESCE(SUM(gr.total_amount), 0) FROM public.goods_receipts gr
                 WHERE gr.supplier_id = s.id AND gr.status = 'completed')      AS da_nhap,
               (SELECT COUNT(*) FROM public.goods_receipts gr
                 WHERE gr.supplier_id = s.id AND gr.status = 'completed')      AS so_phieu_nhap,
               (SELECT MAX(gr.receipt_date) FROM public.goods_receipts gr
                 WHERE gr.supplier_id = s.id AND gr.status = 'completed')      AS nhap_gan_nhat,
               (SELECT COALESCE(SUM(pr2.total_amount), 0) FROM public.purchase_returns pr2
                 WHERE pr2.supplier_id = s.id AND pr2.status IN ('confirmed','completed')) AS tra_hang,
               (SELECT COALESCE(SUM(sp.amount), 0) FROM public.supplier_payments sp
                 WHERE sp.supplier_id = s.id)                                  AS da_thanh_toan,
               (SELECT MAX(sp.payment_date) FROM public.supplier_payments sp
                 WHERE sp.supplier_id = s.id)                                  AS tra_gan_nhat
        FROM public.suppliers s
        WHERE COALESCE(s.current_debt_payable, 0) <> 0 OR s.is_active
      ) x)
  );
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. fn_debt_reminder_tick() — NÂNG CẤP: digest tách theo NHÂN VIÊN
--
-- Trước: 1 khối tổng + top 10 khách toàn công ty → không ai biết mình phải
-- gọi ai. Nay: mỗi NV một mục riêng, liệt kê khách của chính họ.
-- Bổ sung mục "Không có hạn" để ~287tr nợ điều chỉnh tay thôi vô hình.
-- Giữ nguyên chữ ký (p_dry_run) → cron `debt-reminder-daily` 08:30 VN chạy tiếp.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_debt_reminder_tick(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_enabled   boolean;
  v_days      integer;
  v_min       numeric;
  v_today     date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_msg       text;
  v_over_cnt  integer := 0;
  v_over_sum  numeric := 0;
  v_soon_cnt  integer := 0;
  v_soon_sum  numeric := 0;
  v_nodue_cnt integer := 0;
  v_nodue_sum numeric := 0;
  v_sent      bigint;
  v_staff     RECORD;
  v_kh        RECORD;
  v_n         integer;
BEGIN
  IF NOT (public.fn_is_admin() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Chỉ quản trị viên được chạy nhắc nợ' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE((value->>'enabled')::boolean, true),
         COALESCE((value->>'due_within_days')::int, 7),
         COALESCE((value->>'min_amount')::numeric, 0)
  INTO v_enabled, v_days, v_min
  FROM public.system_settings WHERE key = 'debt_reminder_config';

  v_enabled := COALESCE(v_enabled, true);
  v_days    := COALESCE(v_days, 7);
  v_min     := COALESCE(v_min, 0);

  SELECT COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < v_today),
         COALESCE(SUM(amount) FILTER (WHERE due_date IS NOT NULL AND due_date < v_today), 0),
         COUNT(*) FILTER (WHERE due_date >= v_today AND due_date <= v_today + v_days),
         COALESCE(SUM(amount) FILTER (WHERE due_date >= v_today AND due_date <= v_today + v_days), 0),
         COUNT(*) FILTER (WHERE due_date IS NULL),
         COALESCE(SUM(amount) FILTER (WHERE due_date IS NULL), 0)
  INTO v_over_cnt, v_over_sum, v_soon_cnt, v_soon_sum, v_nodue_cnt, v_nodue_sum
  FROM public.customer_debts
  WHERE is_settled = false AND amount > 0 AND amount >= v_min;

  IF COALESCE(v_over_cnt,0) = 0 AND COALESCE(v_soon_cnt,0) = 0 THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_debts', 'as_of', v_today);
  END IF;

  v_msg := '💰 <b>CRM Sanh Long — NHẮC CÔNG NỢ</b>' || E'\n'
        || to_char(v_today, 'DD/MM/YYYY') || ' (VN)' || E'\n'
        || '• Quá hạn: <b>' || v_over_cnt || '</b> khoản · '
        || replace(to_char(round(v_over_sum), 'FM999,999,999,999'), ',', '.') || '₫' || E'\n'
        || '• Đến hạn ≤' || v_days || ' ngày: <b>' || v_soon_cnt || '</b> khoản · '
        || replace(to_char(round(v_soon_sum), 'FM999,999,999,999'), ',', '.') || '₫';

  IF v_nodue_cnt > 0 THEN
    v_msg := v_msg || E'\n' || '• Không có hạn (cần gán hạn): <b>' || v_nodue_cnt || '</b> khoản · '
          || replace(to_char(round(v_nodue_sum), 'FM999,999,999,999'), ',', '.') || '₫';
  END IF;

  -- ── Tách theo nhân viên phụ trách ──
  FOR v_staff IN
    WITH d AS (
      SELECT cd.customer_id, cd.amount, cd.due_date
      FROM public.customer_debts cd
      WHERE cd.is_settled = false AND cd.amount > 0 AND cd.amount >= v_min
        AND cd.due_date IS NOT NULL AND cd.due_date <= v_today + v_days
    )
    SELECT c.owner_user_id,
           COALESCE(pr.full_name, 'Chưa phân công NV')        AS nhan_vien,
           SUM(d.amount)                                      AS tong,
           COUNT(DISTINCT d.customer_id)                      AS so_kh,
           COALESCE(SUM(d.amount) FILTER (WHERE d.due_date < v_today), 0) AS qua_han
    FROM d
    JOIN public.customers c ON c.id = d.customer_id
    LEFT JOIN public.profiles pr ON pr.id = c.owner_user_id
    GROUP BY c.owner_user_id, pr.full_name
    ORDER BY COALESCE(SUM(d.amount) FILTER (WHERE d.due_date < v_today), 0) DESC,
             SUM(d.amount) DESC
    LIMIT 8
  LOOP
    v_msg := v_msg || E'\n\n<b>👤 ' || left(v_staff.nhan_vien, 30) || '</b> — '
          || v_staff.so_kh || ' khách · '
          || replace(to_char(round(v_staff.tong), 'FM999,999,999,999'), ',', '.') || '₫'
          || CASE WHEN v_staff.qua_han > 0
                  THEN ' (quá hạn ' || replace(to_char(round(v_staff.qua_han), 'FM999,999,999,999'), ',', '.') || '₫)'
                  ELSE '' END;

    v_n := 0;
    FOR v_kh IN
      WITH d AS (
        SELECT cd.customer_id, cd.amount, cd.due_date
        FROM public.customer_debts cd
        WHERE cd.is_settled = false AND cd.amount > 0 AND cd.amount >= v_min
          AND cd.due_date IS NOT NULL AND cd.due_date <= v_today + v_days
      )
      SELECT COALESCE(NULLIF(c.farm_name, ''), 'Khách chưa đặt tên') AS ten,
             COALESCE(c.primary_phone, '')                          AS dt,
             SUM(d.amount)                                          AS tong,
             MIN(d.due_date)                                        AS han,
             (MIN(d.due_date) < v_today)                            AS tre
      FROM d
      JOIN public.customers c ON c.id = d.customer_id
      WHERE c.owner_user_id IS NOT DISTINCT FROM v_staff.owner_user_id
      GROUP BY c.id, c.farm_name, c.primary_phone
      ORDER BY (MIN(d.due_date) < v_today) DESC, SUM(d.amount) DESC
      LIMIT 5
    LOOP
      v_n := v_n + 1;
      v_msg := v_msg || E'\n  • ' || left(v_kh.ten, 32) || ': '
            || replace(to_char(round(v_kh.tong), 'FM999,999,999,999'), ',', '.') || '₫'
            || CASE WHEN v_kh.tre THEN ' ⚠️ trễ ' || (v_today - v_kh.han) || 'n'
                    ELSE ' (hạn ' || to_char(v_kh.han, 'DD/MM') || ')' END
            || CASE WHEN v_kh.dt <> '' THEN ' · ' || v_kh.dt ELSE '' END;
    END LOOP;
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true, 'as_of', v_today,
      'overdue_count', v_over_cnt, 'overdue_sum', v_over_sum,
      'due_soon_count', v_soon_cnt, 'due_soon_sum', v_soon_sum,
      'no_duedate_count', v_nodue_cnt, 'no_duedate_sum', v_nodue_sum,
      'message', v_msg);
  END IF;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'disabled', 'as_of', v_today);
  END IF;

  v_sent := public.fn_send_telegram(v_msg);
  RETURN jsonb_build_object('sent', true, 'req_id', v_sent, 'as_of', v_today,
    'overdue_count', v_over_cnt, 'due_soon_count', v_soon_cnt,
    'no_duedate_count', v_nodue_cnt);
END $$;


-- ── Quyền gọi ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_can_view_debts()            FROM public;
REVOKE ALL ON FUNCTION public.fn_debt_overview()             FROM public;
REVOKE ALL ON FUNCTION public.fn_debt_ledger(text, text, uuid, text, integer, integer) FROM public;
REVOKE ALL ON FUNCTION public.fn_customer_debt_detail(uuid)  FROM public;
REVOKE ALL ON FUNCTION public.fn_supplier_debt_overview()    FROM public;

GRANT EXECUTE ON FUNCTION public.fn_can_view_debts()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_debt_overview()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_debt_ledger(text, text, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_customer_debt_detail(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_supplier_debt_overview()    TO authenticated;

-- ── Index đỡ cho các truy vấn gộp theo khách ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customer_debts_open
  ON public.customer_debts (customer_id, due_date)
  WHERE is_settled = false;

CREATE INDEX IF NOT EXISTS idx_debt_payments_customer_date
  ON public.debt_payments (customer_id, payment_date DESC);

-- ── Tracking ─────────────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260753000000', 'debt_management_module')
ON CONFLICT (version) DO NOTHING;
