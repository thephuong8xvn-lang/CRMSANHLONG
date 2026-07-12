-- =====================================================================
-- audit_logs: chỉ ghi phần THAY ĐỔI + dọn theo tuổi
-- =====================================================================
-- Bối cảnh (đo trên prod 2026-07-12): audit_logs = 49 MB / 59 MB dữ liệu
-- thật của DB (~60%), tăng ~30 MB/tháng. Gói Free trần 500 MB → chạm trần
-- trong ~8-10 tháng, và chạm trần = DB read-only = NGỪNG BÁN.
--
-- Gốc rễ: fn_audit_log cũ ghi to_jsonb(OLD) + to_jsonb(NEW) = TOÀN BỘ dòng,
-- hai lần, cho MỌI update. Đo được:
--   orders   12.062 UPDATE / 22 MB — trong đó 3.236 dòng KHÔNG đổi cột nào
--   customers 8.626 UPDATE / 15 MB — đổi 1 trường vẫn lưu cả bản ghi 2 lần
--   stock_lots 5.173 UPDATE / 7 MB — mỗi lần bán trừ tồn lưu lại cả lô
--
-- Thay đổi:
--   1. UPDATE chỉ lưu các cột THỰC SỰ đổi (old_data/new_data = delta).
--   2. UPDATE không đổi gì (ngoài updated_at) → KHÔNG ghi log.
--   3. INSERT/DELETE giữ nguyên toàn bộ dòng (cần cho tái dựng bản ghi).
--   4. fn_prune_audit_logs() + cron dọn hằng ngày theo tuổi, giữ lâu hơn cho
--      bảng tài chính/bảo mật.
--
-- KHÔNG đụng dữ liệu audit CŨ (rewrite nhật ký = phá dấu vết). Việc nén lịch
-- sử cũ tách riêng, chỉ chạy khi chủ dự án đồng ý.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Trigger ghi delta
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_action   TEXT;
  v_old_data JSONB := NULL;
  v_new_data JSONB := NULL;
  v_old_full JSONB;
  v_new_full JSONB;
  v_rec_id   UUID;
  v_key      TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action   := 'INSERT';
    v_new_data := to_jsonb(NEW);

  ELSIF TG_OP = 'DELETE' THEN
    v_action   := 'DELETE';
    v_old_data := to_jsonb(OLD);

  ELSIF TG_OP = 'UPDATE' THEN
    v_action   := 'UPDATE';
    v_old_full := to_jsonb(OLD);
    v_new_full := to_jsonb(NEW);
    v_old_data := '{}'::jsonb;
    v_new_data := '{}'::jsonb;

    -- Chỉ giữ những khóa có giá trị khác nhau. 'updated_at' bị bỏ qua vì nó
    -- đổi ở MỌI update (trigger touch) → nếu tính, sẽ không dòng nào là no-op.
    FOR v_key IN SELECT jsonb_object_keys(v_new_full) LOOP
      IF v_key <> 'updated_at'
         AND (v_old_full -> v_key) IS DISTINCT FROM (v_new_full -> v_key) THEN
        v_old_data := v_old_data || jsonb_build_object(v_key, v_old_full -> v_key);
        v_new_data := v_new_data || jsonb_build_object(v_key, v_new_full -> v_key);
      END IF;
    END LOOP;

    -- Không có cột nghiệp vụ nào đổi → không có gì để kể lại. Bỏ qua.
    IF v_new_data = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  END IF;

  -- record_id: lấy từ dòng ĐẦY ĐỦ, không lấy từ delta (id không nằm trong
  -- delta vì id không bao giờ đổi).
  v_rec_id := COALESCE(
    NULLIF(to_jsonb(COALESCE(NEW, OLD)) ->> 'id', ''),
    NULLIF(to_jsonb(COALESCE(NEW, OLD)) ->> 'user_id', '')
  )::uuid;

  INSERT INTO public.audit_logs
    (user_id, action, table_name, record_id, old_data, new_data)
  VALUES
    (auth.uid(), v_action, TG_TABLE_NAME, v_rec_id, v_old_data, v_new_data);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

COMMENT ON FUNCTION public.fn_audit_log() IS
  'Trigger audit. UPDATE chỉ lưu cột thực sự đổi (delta); update không đổi gì thì không ghi. INSERT/DELETE lưu nguyên dòng.';

-- ---------------------------------------------------------------------
-- 2. Dọn nhật ký theo tuổi
-- ---------------------------------------------------------------------
-- Tài chính/bảo mật giữ 365 ngày (đủ 1 kỳ quyết toán + tra soát tranh chấp).
-- Vận hành (tồn kho, khách hàng, cơ hội) giữ 120 ngày.
CREATE OR REPLACE FUNCTION public.fn_prune_audit_logs()
RETURNS TABLE (deleted_rows BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  WITH gone AS (
    DELETE FROM public.audit_logs
    WHERE created_at < now() - CASE
      WHEN table_name IN ('cashbook_transactions', 'orders', 'user_roles', 'profiles')
        THEN INTERVAL '365 days'
      ELSE INTERVAL '120 days'
    END
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM gone;

  RETURN QUERY SELECT v_deleted;
END;
$$;

-- Hàm mutate dữ liệu + SECURITY DEFINER → không để lộ ra PostgREST.
REVOKE ALL ON FUNCTION public.fn_prune_audit_logs() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_prune_audit_logs() IS
  'Xóa audit_logs quá hạn: 365 ngày cho bảng tài chính/bảo mật, 120 ngày cho bảng vận hành. Chỉ cron gọi.';

-- Index phục vụ prune (quét theo table_name + created_at).
CREATE INDEX IF NOT EXISTS idx_audit_table_created
  ON public.audit_logs (table_name, created_at);

-- ---------------------------------------------------------------------
-- 3. Cron dọn hằng ngày — 02:30 VN (19:30 UTC), sau backup 01:00 VN
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('prune-audit-logs')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-audit-logs');

    PERFORM cron.schedule(
      'prune-audit-logs',
      '30 19 * * *',
      $cron$ SELECT public.fn_prune_audit_logs(); $cron$
    );
  END IF;
END $$;
