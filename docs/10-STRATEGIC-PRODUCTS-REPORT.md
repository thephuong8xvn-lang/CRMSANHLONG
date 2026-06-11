# 10. Sản phẩm chiến lược & Tối ưu lợi nhuận

> **Phiên bản:** 2026-06-11 · **Migration:** `20260628000000_strategic_products.sql` (đã apply remote + smoke test) · **Route:** `/reports/strategic-products` · **Quyền:** adminOnly (3 tầng)

## 1. Mục đích

Doanh nghiệp vận hành 2 luồng sản phẩm:

| Nhóm | Định nghĩa | Vai trò kinh doanh |
|---|---|---|
| **Nhóm 1 — Chiến lược** (`strategic`) | Markup trên giá vốn ≥ 50% | Nguồn lợi nhuận chính. **Bắt buộc đạt ≥30% tỉ trọng doanh số tại từng chi nhánh** |
| **Nhóm 2 — Hàng nền** (`baseline`) | Bán chạy, nhu cầu cao, quay vòng nhanh | Bắt buộc có mặt để kéo khách, chấp nhận hòa/lỗ — **nhóm 1 bù nhóm 2** |

SP không gán nhóm = hàng thường (`other`). Phân loại **gán thủ công** (admin) + hệ thống **gợi ý** theo dữ liệu bán 90 ngày. Module theo dõi chặt 2 nhóm, cảnh báo 7 loại, mục tiêu doanh số tháng theo chi nhánh, và theo dõi LIVE trong ngày (realtime).

## 2. Công thức (mọi tỉ lệ là PHÂN SỐ, FE nhân 100)

- `markup_actual = (Σrevenue − Σcogs) ÷ Σcogs` — NULL nếu cogs=0 (cờ `missing_cost`, KHÔNG tính vi phạm)
- `margin = (Σrevenue − Σcogs) ÷ Σrevenue`
- `strategic_share = revenue_strategic ÷ revenue_total` (mục tiêu mặc định ≥ 0.30)
- `cross_subsidy = profit_strategic + profit_baseline` — dương = nhóm 1 gánh được hàng nền
- `days_to_oos = tồn hiện tại ÷ (sold_30d ÷ 30)` — NULL nếu 30 ngày không bán
- `gmroi = profit_90d × (365/90) ÷ giá trị vốn tồn hiện tại` — quy năm, **xấp xỉ** (dùng tồn hiện tại thay tồn bình quân)
- `pace = revenue_total ÷ (revenue_target × month_elapsed_ratio)` — FE tính từ `month_elapsed_ratio` RPC trả về
- Nguồn revenue/cogs: view `v_order_line_profit` (đơn confirmed→completed, COGS theo lô FEFO + fallback retail_cost). Tồn/vốn: `v_stock_lot_valuation` (lô active).
- **Phân loại áp HỒI TỐ**: class hiện tại áp cho toàn bộ lịch sử (point-in-time, không snapshot).
- Múi giờ nghiệp vụ: ranh giới ngày/tháng theo `Asia/Ho_Chi_Minh`.

## 3. Tầng DB

### Bảng

| Object | Vai trò | RLS |
|---|---|---|
| `product_strategy` (product_id PK, class CHECK strategic/baseline, note, assigned_by/at) | Phân loại SP; không có dòng = hàng thường | SELECT `fn_is_active()` · write `fn_has_role('admin')` |
| `branch_month_targets` (branch_id+year+month UNIQUE, revenue_target, strategic_share_target DEFAULT 0.30) | Mục tiêu tháng theo CN | **Cả SELECT lẫn write `fn_has_role('admin')`** (số nhạy cảm) |
| `system_settings.strategic_config` (JSONB) | Ngưỡng: markup_min 0.5 · baseline_loss_floor −0.05 · suggest_min_revenue_90d 5tr · suggest_min_qty_90d 30 · oos_warn_days 7 | RLS sẵn có (read active / write admin). RPC đọc COALESCE → đổi ngưỡng không cần deploy |

### RPC (7 hàm — đều SECURITY DEFINER, gate `fn_has_role('admin')`, REVOKE PUBLIC + GRANT authenticated)

| RPC | Trả về |
|---|---|
| `fn_strategic_summary(year, month, branch?)` | 1 dòng/CN: revenue 3 nhóm, share, profit 3 nhóm, cross_subsidy, violation counts, target (LEFT JOIN), month_elapsed_ratio, gmroi N1/N2. Branch NULL gom "(Chưa gán CN)" |
| `fn_strategic_products(year, month, branch?, class, search?, sort, limit, offset)` | SP theo nhóm (strategic = TẤT CẢ SP đã gán kể cả chưa bán; other = SP chưa gán có bán trong tháng): qty/revenue/cogs/profit/markup/margin/sold_30d/stock/days_to_oos/gmroi/is_violation/missing_cost + `total_count` COUNT OVER. Whitelist class (3) + sort (7, days_to_oos sort ASC) |
| `fn_strategic_suggestions(branch?, limit, offset)` | SP CHƯA gán + is_active, cửa sổ 90 ngày: markup≥min & rev≥ngưỡng → `strategic`; qty≥ngưỡng & markup<min → `baseline` (thỏa cả 2 ưu tiên strategic) |
| `fn_strategic_alerts(year, month, branch?)` | 7 loại cấp CN: `share_below_target` · `strategic_below_markup` (critical nếu ≥30% SP nhóm 1 vi phạm) · `baseline_deep_loss` · `cross_subsidy_negative` (critical) · `pace_behind` (rev < target×elapsed×0.9) · `strategic_oos_risk` · `baseline_oos_risk` (**critical** — hàng bắt buộc có mặt) |
| `fn_strategic_trend(branch?, months≤24)` | Theo tháng (giờ VN): revenue 3 nhóm, share, profit N1/N2, cross_subsidy |
| `fn_strategic_today(branch?)` | KPI live từ 0h hôm nay (giờ VN), 1 dòng/CN + order_count + last_order_at |
| `fn_strategic_today_orders(branch?, limit≤100)` | Đơn hôm nay mới nhất kèm cơ cấu DT nhóm 1/nhóm 2 mỗi đơn |

Khác: index `idx_orders_branch_created(branch_id, created_at DESC)`; DO block guard đảm bảo `orders` trong publication `supabase_realtime`. **Không tạo view mới** → không phát sinh lỗ hổng auto-GRANT.

## 4. Phân quyền & bảo mật (3 tầng)

1. **DB:** 7 RPC RAISE nếu không phải `admin` (KHÔNG dùng `fn_is_admin()` vì gồm ceo); 2 view nguồn đã REVOKE anon/authenticated; bảng targets admin-only cả đọc; whitelist `p_sort`/`p_class` chống SQL injection.
2. **Route:** `/reports/strategic-products` bọc `<ProtectedRoute adminOnly>`.
3. **Menu:** nav "Báo cáo" adminOnly (sẵn có) → card thứ 4 trong Trung tâm Báo cáo.

## 5. Frontend

| File | Vai trò |
|---|---|
| `src/pages/reports/StrategicProductsReportPage.tsx` | Trang chính 6 tab |
| `src/pages/reports/AssignStrategyModal.tsx` | Modal gán SP vào nhóm (search không dấu) |
| `src/hooks/queries/useStrategicProducts.ts` | 9 query hooks + 3 mutations |
| `src/lib/queryClient.ts` | Keys `qk.reports.strat*`, prefix chung `['reports','strategic']` |

**6 tab:** ⓪ Hôm nay (LIVE — 4 KPI + bảng đơn mới nhất, chấm ● Live) · ① Tổng quan & Cảnh báo (4 KPI + banner 7 loại cảnh báo + stacked bar theo CN + trend 12 tháng share/bù chéo + bảng CN) · ② SP nhóm 1 (markup badge đỏ khi vi phạm + gợi ý "cần bán ≥ X" + Tồn/Hết sau N ngày + GMROI + Gỡ/Chuyển nhóm) · ③ SP nhóm 2 (margin vs sàn lỗ, nhấn vòng quay) · ④ Gợi ý phân loại (Chấp nhận 1 click) · ⑤ Mục tiêu & Cấu hình (inline edit target từng CN + 5 ngưỡng).

**Realtime:** `useRealtimeTable('orders')` → callback `useCallback` + debounce 2s → `invalidateQueries(['reports','strategic'])` → mọi tab tự refetch. Tab Hôm nay `staleTime: 0`, các tab tháng 5 phút. Xuất CSV (BOM UTF-8) theo tab. Bảng dùng `DataTable` chuẩn (manualPagination 50 cho SP/gợi ý).

## 6. Kiểm chứng (2026-06-11, remote, tx-rollback)

- Admin gọi đủ 7 RPC OK; tổng revenue trend tháng 6 = 179.121.512₫ khớp Σ summary 2 CN (178.091.512 + 1.030.000).
- Gán thử 2 SP nhóm 1 + 2 SP nhóm 2 + target 600tr → share 23,03%, 7/7 loại cảnh báo đều phát đúng (share_below, below_markup critical, deep_loss, cross_subsidy −3,87tr critical, pace_behind 178tr<206tr, baseline_oos_risk).
- Non-admin (Hoài Ân — 6 role không admin): cả 7 RPC RAISE "Không có quyền"; SELECT `branch_month_targets` = 0 dòng; INSERT `product_strategy` bị RLS chặn; SELECT trực tiếp `v_order_line_profit` → permission denied.
- `p_class='bogus'` / `p_sort='bogus'` → exception. `orders` có trong publication realtime.
- `npx tsc -b --noEmit` PASS · `vite build` PASS.

**Lưu ý vận hành:** GMROI là xấp xỉ theo tồn hiện tại; SP "Thiếu giá vốn" cần cập nhật giá vốn lô để số liệu chuẩn; đổi nhóm áp hồi tố toàn lịch sử.
