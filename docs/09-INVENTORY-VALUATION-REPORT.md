# 09 — BÁO CÁO KHO HÀNG THEO GIÁ VỐN (Inventory Valuation Report)

> Phiên bản: 2026-06-10 · Migration: `20260626000000_inventory_valuation_report.sql` · Route: `/reports/inventory-valuation` (admin-only)

## 1. Mục đích

Định giá hàng tồn kho theo **giá vốn thực tế cấp lô**: tổng giá trị vốn đang nằm trong kho, phân bổ theo sản phẩm / thương hiệu / nhóm hàng / kho, tốc độ quay vòng và hàng tồn đọng. Đồng thời phơi bày lỗi dữ liệu (thiếu giá vốn, lô quá hạn còn bán) để admin xử lý.

## 2. Công thức

### 2.1 Giá vốn trung bình (bình quân gia quyền theo lô)

Một sản phẩm có nhiều lô (`stock_lots`), mỗi lô một `cost_price`:

```
avg_cost = Σ(quantity_on_hand × cost_price) / Σ(quantity_on_hand)
```

- Chỉ tính lô `status = 'active'` AND `quantity_on_hand > 0`.
- `total_value` (giá trị vốn) = Σ(quantity_on_hand × cost_price) — KHÔNG phải avg_cost × tổng tồn làm tròn.
- Lô có `cost_price = 0` vẫn được cộng tồn nhưng đóng góp 0 vào giá trị → cờ `missing_cost` cảnh báo "giá trị đang tính thiếu".

### 2.2 Vòng quay tồn kho (xấp xỉ)

Hệ thống không có snapshot tồn lịch sử nên dùng **tồn hiện tại** thay tồn bình quân kỳ:

```
sold_90d      = Σ(-quantity)  từ stock_movements WHERE movement_type='sale' AND created_at ≥ now()-90d
turnover_90d  = sold_90d / tồn hiện tại        (× — số lần quay trong 90 ngày)
days_of_stock = tồn hiện tại / (sold_90d / 90)  (NULL nếu chưa bán trong 90 ngày)
last_sale_at  = MAX(created_at) movement 'sale' mọi thời điểm → xếp hạng tồn lâu
Dead stock    = sold_90d = 0 (đặc biệt: last_sale_at NULL = chưa từng bán)
```

Giới hạn đã biết: SP vừa nhập lượng lớn sẽ có turnover thấp giả tạo (mẫu số phình). Nếu cần chính xác, tương lai thêm snapshot tồn định kỳ.

## 3. Tầng DB (migration `20260626000000`)

| Object | Vai trò |
|---|---|
| View `v_stock_lot_valuation` | Định giá cấp lô (lô còn hàng, MỌI status) + join products/warehouses/brands/categories. **KHÔNG grant** anon/authenticated — chỉ RPC dùng. |
| RPC `fn_inventory_valuation_summary(p_warehouse_id UUID DEFAULT NULL)` | 1 hàng KPI: `total_qty, total_value, product_count, lot_count, warehouse_count` (lô active) + `missing_cost_products, expiring_90d_value, expired_active_lots, non_active_value`. |
| RPC `fn_inventory_valuation_by_product(p_search, p_warehouse_id, p_brand_id, p_category_id, p_sort, p_limit, p_offset)` | Per-SP: tồn, avg_cost gia quyền, giá trị, số lô/kho, HSD gần nhất, missing_cost, sold_30d/90d, turnover_90d, days_of_stock, last_sale_at, `total_count` (COUNT OVER — phân trang server). Sort whitelist: `value`/`qty`/`avg_cost`/`turnover`/`days_of_stock`/`idle` (idle = lâu chưa bán lên đầu, NULLS FIRST). |
| RPC `fn_inventory_valuation_by_group(p_group_by, p_warehouse_id, p_sort, p_limit, p_offset)` | `p_group_by ∈ {brand, category, warehouse}` (validate RAISE — chống injection, không dynamic SQL). Trả group_name (COALESCE "(Không thương hiệu)"/"(Chưa phân nhóm)"), product_count, lot_count, qty, value, `value_share` % (SUM OVER), missing_cost_products. |
| Index `idx_stockmov_product_type_created` | `(product_id, movement_type, created_at DESC)` phục vụ scan sale 90 ngày theo SP. |

**Tính nhất quán bắt buộc:** Σ `total_value` của by_product = by_group(brand) = by_group(category) = by_group(warehouse) = summary.total_value (đã smoke-test trên DB thật).

## 4. Phân quyền & bảo mật (3 tầng)

1. **DB (nguồn chân lý):** cả 3 RPC `SECURITY DEFINER SET search_path=public`, đầu hàm `IF NOT fn_has_role('admin') THEN RAISE EXCEPTION 'Không có quyền truy cập báo cáo kho hàng'`. REVOKE PUBLIC + GRANT EXECUTE authenticated (giống `fn_profit_*`).
2. **Route:** `/reports/inventory-valuation` bọc `<ProtectedRoute adminOnly>` (CEO cũng bị chặn — nhất quán toàn khu `/reports`).
3. **Menu:** mục "Báo cáo" sidebar đã `adminOnly: true`.

**Lỗ hổng đã vá kèm (quan trọng):** Supabase `ALTER DEFAULT PRIVILEGES` tự GRANT anon/authenticated lên mọi object mới trong schema public → view của báo cáo bị lộ qua PostgREST nếu không REVOKE tường minh. Migration này REVOKE cả `v_stock_lot_valuation` **và** `v_order_line_profit` (báo cáo lợi nhuận cũ — trước đó mọi user đăng nhập và cả anon SELECT được toàn bộ doanh thu/giá vốn). **Quy ước từ nay: mọi view "chỉ dùng nội bộ RPC" PHẢI có dòng REVOKE đi kèm trong cùng migration.**

**Phương án B (chưa làm):** nếu cần mở cho CEO/kế toán → seed permission `report.view_inventory` + `report.view_margin` (spec §13.13), đổi check trong RPC sang permission-based và route sang `perms={['report.view_inventory']}`.

## 5. Frontend

| File | Vai trò |
|---|---|
| `src/pages/reports/InventoryValuationReportPage.tsx` | Trang báo cáo: 4 KPI + 2 banner cảnh báo toàn vẹn + 2 chart (Bar top10 giá trị, Pie cơ cấu nhóm hàng) + 7 tab + lọc + CSV. |
| `src/hooks/queries/useInventoryValuation.ts` | 3 hooks TanStack Query (staleTime 5'), coerce NUMERIC string→number, `keepPreviousData`. |
| `src/lib/queryClient.ts` | Namespace `qk.reports.invSummary/invByProduct/invByGroup`. |
| `src/pages/reports/ReportsHubPage.tsx` | Card thứ 3 "Báo cáo Kho hàng theo Giá vốn" (tag Kho hàng, amber). |
| `src/App.tsx` | Route adminOnly + lazy import. |

**7 tab:** Theo sản phẩm (DataTable `manualPagination` 50/trang + lọc SP/thương hiệu/nhóm hàng) · Theo thương hiệu · Theo nhóm hàng · Theo kho · Top 50 tồn nhiều (toggle SL ↔ giá trị) · Vòng quay nhanh · Tồn lâu/chậm bán (badge **Dead stock**). Tất cả bảng dùng `DataTable.tsx` chuẩn (desktop table + mobile card tự sinh). Lọc kho áp toàn trang (KPI + chart + mọi tab).

**Cảnh báo toàn vẹn dữ liệu hiển thị trên trang:**
- `missing_cost_products > 0` → banner amber "N sản phẩm có lô thiếu giá vốn → tổng giá trị vốn đang bị tính thiếu".
- `expired_active_lots > 0` → banner đỏ "N lô đã quá hạn nhưng còn trạng thái Đang bán" (cần đổi trạng thái ở trang Kho).
- Cột HSD gần nhất tô màu theo mốc `EXPIRY_BUCKETS` dùng chung module kho; quá hạn ghi rõ "(quá hạn)".

## 6. Kiểm chứng đã chạy (2026-06-10, DB prod)

- Summary = SQL trực tiếp: tồn 12.995,5 · vốn 378.668.954,20₫ · 109 SP · 136 lô · 2 kho.
- avg_cost gia quyền SP 2 lô (SP-4427010-230): tính tay 122.161,26 = RPC 122.161,26.
- Σ by_product = Σ by_group cả 3 chiều = summary.
- Không JWT / JWT non-admin → RAISE đúng thông báo; `has_table_privilege` 2 view = false sau REVOKE.
- `tsc -b --noEmit` + `vite build` PASS.
