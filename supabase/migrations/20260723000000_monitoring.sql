-- ============================================================
-- Workstream B2 — Monitoring + cảnh báo Telegram
-- CHỈ THÊM MỚI (extensions, bảng, hàm, lịch cron). Không sửa/xóa dữ liệu.
--
-- Token Telegram KHÔNG hardcode — đọc từ Vault. Sau khi apply, nhập secret:
--   select vault.create_secret('<bot_token>', 'telegram_bot_token');
--   select vault.create_secret('<chat_id>',   'telegram_chat_id');
-- Thiếu secret → fn_send_telegram no-op (ghi log), KHÔNG gây lỗi cron.
-- ============================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── Bảng: nhật ký mỗi lần monitor chạy ──
create table if not exists public.monitor_runs (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  kind        text not null default 'integrity',
  ok          boolean not null,            -- true = không có vi phạm critical
  violations  jsonb not null default '[]'::jsonb,
  alerted     boolean not null default false,
  note        text
);
create index if not exists idx_monitor_runs_ran_at on public.monitor_runs (ran_at desc);

-- ── Bảng: lỗi nghiêm trọng FE/RPC đẩy về (RLS chặt) ──
create table if not exists public.app_error_logs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  level       text not null default 'error',     -- error | warn | fatal
  source      text not null default 'fe',         -- fe | rpc | db | monitor
  message     text not null,
  context     jsonb,
  fingerprint text,                               -- gom nhóm lỗi trùng
  user_id     uuid default auth.uid()
);
create index if not exists idx_app_error_logs_created on public.app_error_logs (created_at desc);
create index if not exists idx_app_error_logs_fingerprint on public.app_error_logs (fingerprint, created_at desc);

alter table public.monitor_runs   enable row level security;
alter table public.app_error_logs enable row level security;

-- monitor_runs: chỉ admin/ceo đọc; không ai ghi trực tiếp (chỉ qua SECURITY DEFINER).
drop policy if exists monitor_runs_read on public.monitor_runs;
create policy monitor_runs_read on public.monitor_runs for select
  using (public.fn_is_active() and (public.fn_is_admin() or public.fn_has_role('ceo')));

-- app_error_logs: user đăng nhập ghi log CHÍNH MÌNH; admin/ceo đọc tất cả.
drop policy if exists app_error_logs_insert_self on public.app_error_logs;
create policy app_error_logs_insert_self on public.app_error_logs for insert
  with check (public.fn_is_active() and user_id = auth.uid());
drop policy if exists app_error_logs_read on public.app_error_logs;
create policy app_error_logs_read on public.app_error_logs for select
  using (public.fn_is_active() and (public.fn_is_admin() or public.fn_has_role('ceo')));

-- ── fn_health(): liveness nhẹ cho uptime ──
create or replace function public.fn_health()
  returns jsonb
  language sql
  security definer
  set search_path to 'public'
as $$
  select jsonb_build_object(
    'status', 'ok',
    'now', now(),
    'orders', (select count(*) from public.orders),
    'stock_lots', (select count(*) from public.stock_lots),
    'last_monitor_run', (select max(ran_at) from public.monitor_runs)
  );
$$;

-- ── fn_integrity_check(): gom các bất biến → danh sách vi phạm ──
-- severity: 'critical' (không bao giờ được xảy ra) | 'warning' (cần để mắt).
create or replace function public.fn_integrity_check()
  returns table(check_name text, severity text, violations bigint, sample jsonb)
  language plpgsql
  security definer
  set search_path to 'public'
as $$
begin
  return query select 'neg_stock'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('lot_id', id, 'qoh', quantity_on_hand)
      order by quantity_on_hand) filter (where true), '[]'::jsonb)
    from (select id, quantity_on_hand from public.stock_lots
          where quantity_on_hand < 0 limit 20) t;

  return query select 'reserved_gt_onhand'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('lot_id', id, 'qoh', quantity_on_hand, 'reserved', quantity_reserved)) , '[]'::jsonb)
    from (select id, quantity_on_hand, quantity_reserved from public.stock_lots
          where quantity_reserved > quantity_on_hand limit 20) t;

  return query select 'orphan_wh_lot'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('lot_id', id, 'warehouse_id', warehouse_id)), '[]'::jsonb)
    from (select sl.id, sl.warehouse_id from public.stock_lots sl
          where sl.quantity_on_hand > 0
            and not exists (select 1 from public.warehouses w where w.id = sl.warehouse_id) limit 20) t;

  return query select 'vat_pending_issued_no_issuance'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'order_id', order_id)), '[]'::jsonb)
    from (select id, order_id from public.vat_pending_sales
          where status = 'issued' and issuance_id is null limit 20) t;

  return query select 'vat_pending_pending_with_issuance'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'issuance_id', issuance_id)), '[]'::jsonb)
    from (select id, issuance_id from public.vat_pending_sales
          where status = 'pending' and issuance_id is not null limit 20) t;

  return query select 'return_completed_no_movement'::text, 'critical'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('return_id', id, 'return_code', return_code)), '[]'::jsonb)
    from (select sr.id, sr.return_code from public.sales_returns sr
          where sr.status = 'completed'
            and not exists (select 1 from public.stock_movements m
                            where m.reference_type = 'sales_return' and m.reference_id = sr.id) limit 20) t;

  return query select 'receipt_verified_stuck_7d'::text, 'warning'::text, count(*),
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'receipt_code', receipt_code, 'created_at', created_at)), '[]'::jsonb)
    from (select id, receipt_code, created_at from public.goods_receipts
          where status = 'verified' and created_at < now() - interval '7 days' limit 20) t;
end;
$$;

-- ── fn_send_telegram(): đọc Vault, POST qua pg_net. Thiếu secret → no-op + log ──
create or replace function public.fn_send_telegram(p_text text)
  returns bigint
  language plpgsql
  security definer
  set search_path to 'public', 'vault', 'net'
as $$
declare
  v_token   text;
  v_chat    text;
  v_req_id  bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_chat_id';

  if v_token is null or v_chat is null then
    insert into public.app_error_logs(level, source, message, fingerprint)
      values ('warn', 'monitor', 'Thiếu vault secret telegram_bot_token/telegram_chat_id — bỏ qua gửi.', 'telegram_no_secret');
    return null;
  end if;

  select net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('chat_id', v_chat, 'text', p_text, 'parse_mode', 'HTML')
  ) into v_req_id;

  return v_req_id;
end;
$$;

-- ── fn_monitor_tick(): chạy integrity, ghi nhật ký, bắn cảnh báo nếu có critical ──
create or replace function public.fn_monitor_tick()
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_rows       jsonb;
  v_critical   bigint;
  v_warning    bigint;
  v_msg        text;
  v_alerted    boolean := false;
  v_run_id     uuid;
  r            record;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'check', check_name, 'severity', severity, 'violations', violations, 'sample', sample)
           order by severity, check_name), '[]'::jsonb),
         coalesce(sum(violations) filter (where severity = 'critical'), 0),
         coalesce(sum(violations) filter (where severity = 'warning'), 0)
    into v_rows, v_critical, v_warning
  from public.fn_integrity_check()
  where violations > 0;

  if v_critical > 0 then
    v_msg := '🚨 <b>CRM Sanh Long — CẢNH BÁO TOÀN VẸN DỮ LIỆU</b>' || E'\n'
          || 'Thời điểm: ' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI') || ' (VN)' || E'\n'
          || 'Vi phạm critical: <b>' || v_critical || '</b>, warning: ' || v_warning || E'\n';
    for r in select check_name, severity, violations from public.fn_integrity_check() where violations > 0 order by severity, check_name
    loop
      v_msg := v_msg || E'\n• ' || r.check_name || ' (' || r.severity || '): ' || r.violations;
    end loop;
    perform public.fn_send_telegram(v_msg);
    v_alerted := true;
  end if;

  insert into public.monitor_runs(kind, ok, violations, alerted, note)
    values ('integrity', v_critical = 0, v_rows, v_alerted,
            'critical=' || v_critical || ' warning=' || v_warning)
    returning id into v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'critical', v_critical,
                            'warning', v_warning, 'alerted', v_alerted, 'violations', v_rows);
end;
$$;

-- ── fn_log_client_error(): FE đẩy lỗi nghiêm trọng (qua RPC, RLS không chặn DEFINER) ──
create or replace function public.fn_log_client_error(
  p_level text, p_source text, p_message text, p_context jsonb default null, p_fingerprint text default null)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $$
begin
  if not public.fn_is_active() then return; end if;   -- chỉ user hợp lệ
  insert into public.app_error_logs(level, source, message, context, fingerprint, user_id)
    values (coalesce(nullif(p_level,''),'error'),
            coalesce(nullif(p_source,''),'fe'),
            left(coalesce(p_message,''), 2000),
            p_context,
            left(p_fingerprint, 200),
            auth.uid());
end;
$$;

revoke all on function public.fn_health()            from public, anon;
revoke all on function public.fn_integrity_check()   from public, anon;
revoke all on function public.fn_send_telegram(text) from public, anon;
revoke all on function public.fn_monitor_tick()      from public, anon;
grant execute on function public.fn_health()                         to authenticated, service_role;
grant execute on function public.fn_integrity_check()                to authenticated, service_role;
grant execute on function public.fn_monitor_tick()                   to service_role;
grant execute on function public.fn_send_telegram(text)              to service_role;
grant execute on function public.fn_log_client_error(text,text,text,jsonb,text) to authenticated, service_role;

-- ── pg_cron: 01:00 UTC = 08:00 VN, chạy monitor tick hằng ngày (idempotent) ──
do $$
begin
  if exists (select 1 from cron.job where jobname = 'monitor-integrity-daily') then
    perform cron.unschedule('monitor-integrity-daily');
  end if;
  perform cron.schedule('monitor-integrity-daily', '0 1 * * *', 'select public.fn_monitor_tick();');
end $$;
