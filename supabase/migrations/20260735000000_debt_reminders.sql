-- ============================================================
-- Migration: Công nợ B2 — Nhắc nợ tự động qua Telegram (digest hằng ngày)
-- File: 20260735000000_debt_reminders.sql
--
-- Bối cảnh: 445tr công nợ/129 KH, 76tr quá hạn theo due_date. Nhắc thủ công
--   dễ sót. Tái dùng hạ tầng Telegram (fn_send_telegram — 20260723000000) +
--   pg_cron. Gửi về 1 kênh chung (đội 5 người), gộp theo NV phụ trách để
--   chủ phân việc "hôm nay gọi ai".
--
-- fn_debt_reminder_tick(p_dry_run): soạn digest quá hạn + sắp đến hạn.
--   dry_run=true → trả text KHÔNG gửi (để smoke-test). Cron gọi dry_run=false.
--
-- B3 (rà đường tạo nợ) — KẾT LUẬN xác minh, KHÔNG thêm code:
--   Mọi đường BÁN tạo nợ đều qua fn_pos_settle_payment (20260613000000:162-171)
--   đã CHẶN outstanding+debt > credit_limit — cả quick-sale lẫn delivery/complete
--   đều funnel vào đây. Đường chèn nợ thủ công (CustomerDetailPage — điều chỉnh
--   công nợ của admin) là CÓ CHỦ ĐÍCH, không chặn. Đơn offline được kiểm khi
--   sync (settle chạy lúc đó). → hạn mức đặt ở B1 thực sự có hiệu lực.
--
-- ⚠️ Apply remote qua Management API. REVOKE tường minh.
-- ============================================================

-- ── Cấu hình ────────────────────────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES (
  'debt_reminder_config',
  '{"enabled":true,"due_within_days":7,"min_amount":0}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ── Digest nhắc nợ ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_debt_reminder_tick(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled     boolean;
  v_days        integer;
  v_min         numeric;
  v_today       date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_msg         text;
  v_over_cnt    integer := 0;
  v_over_sum    numeric := 0;
  v_soon_cnt    integer := 0;
  v_soon_sum    numeric := 0;
  v_line        text;
  r             record;
  v_sent        bigint;
BEGIN
  -- cron (auth.uid() null) hoặc admin qua app
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

  -- Tổng hợp: nợ chưa settle, khách nợ (amount>0), có due_date
  WITH d AS (
    SELECT d.customer_id, d.amount, d.due_date
    FROM public.customer_debts d
    WHERE d.is_settled = false
      AND d.amount > 0
      AND d.due_date IS NOT NULL
      AND d.amount >= v_min
  ),
  agg AS (
    SELECT
      count(*) FILTER (WHERE due_date <  v_today)                                   AS over_cnt,
      COALESCE(sum(amount) FILTER (WHERE due_date <  v_today), 0)                    AS over_sum,
      count(*) FILTER (WHERE due_date >= v_today AND due_date <= v_today + v_days)   AS soon_cnt,
      COALESCE(sum(amount) FILTER (WHERE due_date >= v_today AND due_date <= v_today + v_days), 0) AS soon_sum
    FROM d
  )
  SELECT over_cnt, over_sum, soon_cnt, soon_sum
  INTO v_over_cnt, v_over_sum, v_soon_cnt, v_soon_sum
  FROM agg;

  -- Không có gì để nhắc → thoát yên lặng (không gửi tin rỗng)
  IF COALESCE(v_over_cnt,0) = 0 AND COALESCE(v_soon_cnt,0) = 0 THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_debts', 'as_of', v_today);
  END IF;

  v_msg := '💰 <b>CRM Sanh Long — NHẮC CÔNG NỢ</b>' || E'\n'
        || to_char(v_today, 'DD/MM/YYYY') || ' (VN)' || E'\n'
        || '• Quá hạn: <b>' || v_over_cnt || '</b> khoản · '
        || replace(to_char(round(v_over_sum), 'FM999,999,999,999'), ',', '.') || '₫' || E'\n'
        || '• Đến hạn ≤' || v_days || ' ngày: <b>' || v_soon_cnt || '</b> khoản · '
        || replace(to_char(round(v_soon_sum), 'FM999,999,999,999'), ',', '.') || '₫';

  -- Top 10 khoản (quá hạn nặng nhất trước), gộp theo KH + NV phụ trách
  v_msg := v_msg || E'\n\n<b>Cần gọi trước:</b>';
  FOR r IN
    WITH d AS (
      SELECT cd.customer_id, cd.amount, cd.due_date, cd.order_id
      FROM public.customer_debts cd
      WHERE cd.is_settled = false AND cd.amount > 0 AND cd.due_date IS NOT NULL
        AND cd.amount >= v_min
        AND cd.due_date <= v_today + v_days
    )
    SELECT
      c.farm_name,
      COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = c.owner_user_id), '—') AS owner_name,
      sum(d.amount)                          AS total,
      min(d.due_date)                        AS earliest_due,
      (min(d.due_date) < v_today)            AS is_overdue
    FROM d
    JOIN public.customers c ON c.id = d.customer_id
    GROUP BY c.farm_name, c.owner_user_id
    ORDER BY (min(d.due_date) < v_today) DESC, sum(d.amount) DESC
    LIMIT 10
  LOOP
    v_line := E'\n• ' || left(r.farm_name, 40)
           || ': ' || replace(to_char(round(r.total), 'FM999,999,999,999'), ',', '.') || '₫'
           || CASE WHEN r.is_overdue
                   THEN ' ⚠️ quá hạn ' || to_char(r.earliest_due, 'DD/MM')
                   ELSE ' (hạn ' || to_char(r.earliest_due, 'DD/MM') || ')' END
           || ' — ' || r.owner_name;
    v_msg := v_msg || v_line;
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true, 'as_of', v_today,
      'overdue_count', v_over_cnt, 'overdue_sum', v_over_sum,
      'due_soon_count', v_soon_cnt, 'due_soon_sum', v_soon_sum,
      'message', v_msg);
  END IF;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'disabled', 'as_of', v_today);
  END IF;

  v_sent := public.fn_send_telegram(v_msg);
  RETURN jsonb_build_object('sent', true, 'req_id', v_sent, 'as_of', v_today,
    'overdue_count', v_over_cnt, 'due_soon_count', v_soon_cnt);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_debt_reminder_tick(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_debt_reminder_tick(boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_debt_reminder_tick(boolean) IS
  'Digest nhắc nợ (quá hạn + đến hạn) gửi Telegram. p_dry_run=true → trả text không gửi. Admin/cron.';

-- ── pg_cron: 01:30 UTC = 08:30 VN (lệch monitor 08:00) ──────
DO $cron$
BEGIN
  PERFORM cron.unschedule('debt-reminder-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;

SELECT cron.schedule('debt-reminder-daily', '30 1 * * *', 'SELECT public.fn_debt_reminder_tick(false);');

NOTIFY pgrst, 'reload schema';
