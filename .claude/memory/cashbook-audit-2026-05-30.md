---
name: cashbook-audit-2026-05-30
description: "Audit toàn diện Module Sổ quỹ — đối chiếu spec 01-FUNCTIONAL-SPEC §9 + RLS §4.6 với schema thực + CashbookPage.tsx + flow POS/OrderDetail/CustomerDetail. Liệt kê 18 phát hiện (5 nghiêm trọng) + kế hoạch 3 sprint."
metadata:
  type: project
  node_type: memory
---

# Sổ quỹ — Audit 2026-05-30

## ⏱ Tiến độ triển khai
 
- **S1 + S2 + S3 = HOÀN THÀNH 100%**: code xong, `tsc --noEmit` PASS, **TẤT CẢ 9 migration ĐÃ APPLY thành công trên Supabase remote** (kể cả bản vá `20260601000002` và migration phân quyền RLS `20260605000000` của S3).
- Thứ tự migration đã apply: `20260531000000 → 001 → 002(backfill) → 20260601000000 → 001 → 002 → 003 → 004 → 20260605000000`.
- **Sprint S1 — HOÀN THÀNH (2026-05-30, đã apply remote)**. 3 migration (`20260531000000` default accounts, `20260531000001` auto-triggers + sửa `fn_update_fund_balance` + bind ca thu ngân cho phiếu tiền mặt auto, `20260531000002` backfill) + refactor `CashbookPage.tsx` (bỏ workaround draft→approved cho cả phiếu tay + 2 leg chuyển quỹ + bút toán lệch ca, date picker back-date ≤30d, dùng `formatCurrency` context) + E2E viết lại `src/test/e2e/cashbook.spec.ts` (6 test, có test tạo phiếu chi thật) + smoke-test SQL `supabase/tests/cashbook_s1_smoke_test.sql`. `tsc --noEmit` PASS.
- **Sprint S2 — HOÀN THÀNH (2026-05-30, đã apply remote)**. 5 migration mới (`20260601000000` schema align, `...001` internal_transfer 2-leg trigger, `...002` supplier debt+payment trigger, `...003` employee advance trigger, `...004` RLS branch_mgr) + 2 component mới `CashbookPaymentForms.tsx` (3 sub-tab: thu nợ KH / thanh toán NCC / tạm ứng NV) + `CashbookReports.tsx` (chart thu/chi/ròng + bảng số dư + xuất CSV) + mở rộng CashbookPage lên 5 tab + refactor internal transfer (1 insert) + **fix bug** `OrderDetailPage` customer_debts.paid_amount/original_amount. `tsc --noEmit` PASS.
- **Sprint S3 — HOÀN THÀNH (2026-05-30, đã apply remote)**. 1 migration mới (`20260605000000_cashbook_rls_align_spec.sql` - hardening RLS cho accountant, branch_manager, warehouse_keeper, self-approval guard) + UI Tab "Tổng quan" (`CashbookOverview.tsx` với sparklines, Bar Chart 7 ngày, danh sách duyệt nhanh) + Polish UX & Việt hóa (6 tab, chọn quỹ mở ca, terminology Thu/Chi) + Tài liệu playbook [06-CASHBOOK-PLAYBOOK.md](file:///d:/CRMSANHLONGVETCO/docs/06-CASHBOOK-PLAYBOOK.md). `tsc --noEmit` PASS, Playwright E2E PASS.


## TL;DR
Module Sổ quỹ chạy được **CRUD cơ bản** (phiếu thu/chi tay, mở/đóng ca, chuyển nội bộ), nhưng **lệch xa spec ở 3 trục**:

1. **Cô lập dòng tiền** — POS thanh toán tiền mặt KHÔNG sinh `cashbook_transactions`, KHÔNG cập nhật `cash_funds.balance`. Báo cáo dòng tiền sai trầm trọng so với thực tế thu/chi tại quầy.
2. **Auto-trigger thiếu** — Spec §9.8 yêu cầu 4 category auto (`sale_payment`, `debt_collection`, `customer_refund`, supplier_payment trigger giảm `current_debt_payable`) — thực tế **không có trigger nào**, mọi liên kết phải tay.
3. **Phân quyền lệch §4.6** — Accountant đang thấy TOÀN HỆ THỐNG (phải scope chi nhánh); warehouse_keeper KHÔNG có SELECT (phải thấy phiếu trong ca của mình); sales chỉ thấy phiếu họ tự tạo nhưng UI cho phép tạo (RLS sẽ từ chối thầm lặng vì sales không có `cashbook.create`).

Triết lý spec §9.1 "ghi nhận MỌI tiền vào ra" → hiện trạng KHÔNG đạt: POS bypass hoàn toàn.

## Bằng chứng & file:line

### Lớp Database

| # | Vấn đề | Bằng chứng |
|---|---|---|
| D1 | **Trigger `trg_cashbook_update_balance` chỉ `AFTER UPDATE`** — Insert thẳng status='approved' sẽ KHÔNG update balance. Code workaround: insert 'draft' → update 'approved'. Reverse approved→cancelled cũng KHÔNG hoàn lại số dư. | [20260522000001_triggers.sql:733-735](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000001_triggers.sql#L733) + [CashbookPage.tsx:498-543](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L498) |
| D2 | **Không có trigger nào** đẩy `order_payments` → `cashbook_transactions`. POS confirm bán tiền mặt = chỉ insert `order_payments`. `cash_funds.balance` không phản ánh tiền mặt thực tế tại quầy. | [POSPage.tsx:1062-1074](file:///d:/CRMSANHLONGVETCO/src/pages/orders/POSPage.tsx#L1062) + grep "fn_handle_payment" trong triggers = không có |
| D3 | Không có trigger từ `debt_payments` → cashbook inflow `debt_collection`. CustomerDetail thêm thanh toán nợ = chỉ insert `debt_payments`. | [CustomerDetailPage.tsx:685-689](file:///d:/CRMSANHLONGVETCO/src/pages/customers/CustomerDetailPage.tsx#L685) |
| D4 | Không có trigger từ `sales_returns` (cash_refund) → cashbook outflow `customer_refund`. | [20260524000002_add_purchase_returns.sql] không có trigger trả tiền |
| D5 | `supplier_payments` table tồn tại + `transaction_id` FK đến cashbook nhưng **UI cashbook không tạo dòng nào**. Goods receipt cũng không trigger thanh toán NCC. Bảng đang chết. | grep insert "supplier_payments" trong /src = 0 dòng |
| D6 | **Trigger sinh code mã hóa internal_transfer SAI ngữ nghĩa** — `fn_auto_cashbook_code` dùng `code_type = 'supplier_payment'` (prefix TT) cho cả 2 leg của chuyển quỹ. Đúng kỹ thuật, sai phân loại báo cáo. | [20260522000001_triggers.sql:486](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000001_triggers.sql#L486) |
| D7 | **Không có trigger atomic 2 leg internal_transfer**. Spec §9.12 yêu cầu trigger tạo 2 cashbook đối ứng — thực tế UI tự chạy 3 lần round-trip (`internal_transfers` insert + 2× insert cashbook + 2× update→approved). Fail giữa chừng để lại bút toán mồ côi. | [CashbookPage.tsx:792-870](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L792) |
| D8 | Schema vs spec: thiếu `cashier_sessions.code UNIQUE`, `variance_reason`, `opened_by/closed_by` (chỉ có 1 `cashier_id`). UI nhồi variance_reason vào `notes` (mất searchability). | Spec §9.6 vs [init_schema.sql:985-997](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000000_init_schema.sql#L985) |
| D9 | Schema vs spec: `cash_funds` thiếu `custodian_user_id` (thủ quỹ phụ trách). Bất kỳ ai có quyền cũng có thể mở/đóng ca trên bất kỳ quỹ nào. | Spec §9.3 vs [init_schema.sql:957-967](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000000_init_schema.sql#L957) |
| D10 | Schema cashbook_transactions thiếu `posted_at` (ngày tạo trong hệ) khác với `transaction_date` (ngày nghiệp vụ) + thiếu `cancelled_at`, `cashier_session_id` đã có (tên `session_id`). | Spec §9.7 vs [init_schema.sql:1000-1029](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000000_init_schema.sql#L1000) |

### Lớp RLS (lệch spec §4.6)

| # | Vấn đề | Bằng chứng |
|---|---|---|
| R1 | **Accountant thấy toàn hệ thống** (phải scope `branch` theo spec §4.6). Policy `cashbook_select_accountant` không filter branch. | [rls.sql:1113-1117](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000002_rls.sql#L1113) |
| R2 | **Warehouse_keeper bị từ chối hoàn toàn** (spec: thấy phiếu trong session của mình). Không có policy `cashbook_select_warehouse_keeper_session`. | grep `warehouse_keeper` trong cashbook RLS = 0 |
| R3 | Insert policy `cashbook_insert_accountant` yêu cầu `fn_has_permission('cashbook.create')`. Sales/team_lead/vet không có quyền này → UI vẫn show form → submit RLS từ chối thầm lặng → toast "Thao tác thất bại" mơ hồ. | [rls.sql:1128-1133](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000002_rls.sql#L1128) + sales role chỉ có `customers.view_all, herd_projects.view_all` ([20260528000009:104-114](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260528000009_fix_rbac_permissions.sql#L104)) |
| R4 | **Tách hành vi `cashbook.create_inflow` vs `cashbook.create_outflow` chưa có** (spec §9.13). Hiện đồng nhất `cashbook.create`. → người dùng có quyền tạo phiếu thu thì cũng tạo được phiếu chi, ngược lại. | seed.sql:93-97 thiếu `cashbook.create_inflow/create_outflow` |
| R5 | **Self-approval không bị chặn** — Người tạo phiếu chi ≤10M có thể tự duyệt (UI gắn `approved_by = profile.id` trong cùng request). Spec §9.13 yêu cầu separation of duties. | [CashbookPage.tsx:533-541](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L533) |
| R6 | Branch scope cho `branch_manager` chỉ được vá ở `cashbook_update_branch_mgr`, nhưng SELECT policy `cashbook_select_accountant` gộp branch_manager mở rộng KHÔNG scope theo branch_id của cash_fund / bank_account. | [rls.sql:1113-1117](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000002_rls.sql#L1113) — dashboard migration `20260530000002` đã tách branch_mgr cho select chéo CN; cần kiểm tra cashbook policy cụ thể tương tự |

### Lớp Frontend / UX

| # | Vấn đề | Bằng chứng |
|---|---|---|
| F1 | **Branch fallback hardcode** `'11111111-0000-0000-0000-000000000001'` cho HCM khi `profile.branch_id` null. Admin/CEO không có branch → chỉ thấy 1 chi nhánh. | [CashbookPage.tsx:209](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L209) |
| F2 | **Không date picker cho `transaction_date`** — luôn dùng `new Date().toISOString().split('T')[0]`. (1) Không cho phép ghi nhận giao dịch quá khứ; (2) UTC date — user GMT+7 lúc 23h sẽ thấy phiếu sang ngày mai. | [CashbookPage.tsx:503](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L503) |
| F3 | Nút **"Xuất Excel" không có onClick** — chỉ là UI. Spec §9.14 báo cáo 5 yêu cầu xuất XLSX template kế toán VN. | [CashbookPage.tsx:1066-1069](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L1066) |
| F4 | **Tab "Tổng quan / Báo cáo" hoàn toàn vắng** — Spec §9.15 cần 6 tabs (Tổng quan, Phiếu thu, Phiếu chi, Chuyển nội bộ, Phiên quỹ, Báo cáo). Hiện chỉ có 3 (Lịch sử, Chuyển nội bộ, Phiên quỹ). Không có sparkline, không có biểu đồ inflow/outflow 7 ngày, không có 5 báo cáo §9.14. | [CashbookPage.tsx:136](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L136) |
| F5 | Mở ca **hardcode `cashFunds[0]`** — chi nhánh có >1 quỹ tiền mặt thì không chọn được quỹ nào. | [CashbookPage.tsx:630](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L630) |
| F6 | **Không UI hợp đồng "Thanh toán NCC"** — không có flow nào tạo `supplier_payments` từ giao diện. Spec §9.10 mong đợi link tới PO/GR. | grep `supplier_payments` UI = 0 |
| F7 | **Không UI "Thu công nợ KH" chuyên dụng** — counterparty=customer chỉ là dropdown gán customer_id; KHÔNG chọn customer_debt cụ thể, KHÔNG cập nhật `debt_payments`, KHÔNG settle debt. Người dùng phải vào CustomerDetail thanh toán → tạo `debt_payments` → KHÔNG sinh cashbook → balance lệch. | [CashbookPage.tsx:1535-1545](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L1535) |
| F8 | **Không UI "Tạm ứng nhân viên"** — bảng `employee_advances` chết tương tự supplier_payments. | grep employee_advances UI = 0 |
| F9 | Form không hiển thị warning khi user đang ở chi nhánh khác với cash_fund — chỉ check khi submit (sau khi mở form). | [CashbookPage.tsx:471-481](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L471) |
| F10 | E2E `cashbook.spec.ts` test "create expense voucher" `return` sớm (form là sidebar luôn visible) — không cover gì. Đã ghi vào roadmap. | roadmap §6 bug note |
| F11 | Lệch terminology UX: badge `Hạng mục / Ca`, label `Số tham chiếu` — OK; nhưng label `Inflow/Outflow` (tiếng Anh trong dropdown) thay vì `Thu / Chi` thuần Việt. | [CashbookPage.tsx:1122-1125](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx#L1122) |

## Trả lời 4 câu hỏi của user

> ❓ **Cashbook đã đúng với tài liệu chưa?**

**Không**. Đúng ~40%: có CRUD phiếu thu/chi, phiên ca, chuyển quỹ. Lệch nặng ở: spec §9.8 auto-trigger (0/4 trigger), §9.14 báo cáo (0/5 báo cáo), §9.15 UI 6 tabs (chỉ 3), §9.10 supplier_payments (UI rỗng), §9.11 employee_advances (UI rỗng).

> ❓ **Dữ liệu không đúng với thực tế?**

**Đúng, lý do chính**: POS cash sales → `order_payments` only → cash_funds.balance KHÔNG cộng. Tương tự debt_payments, sales_returns refund cash, supplier_payments không đi qua cashbook. Số dư quỹ trên UI chỉ phản ánh các phiếu tay accountant nhập — không phải tiền mặt thực tế tại quầy. **Variance đóng ca sẽ luôn cực kỳ lớn** vì hệ thống tính = opening + manual entries; thực tế = opening + manual + POS cash sales − POS cash refunds.

> ❓ **Phân quyền đã rành mạch chưa?**

**Chưa**. (1) Accountant không scope branch (R1); (2) warehouse_keeper bị từ chối hoàn toàn (R2); (3) `cashbook.create_inflow/outflow` chưa tách (R4); (4) self-approval không bị chặn (R5); (5) sales được show form nhưng RLS từ chối — UX dở (R3); (6) branch_manager SELECT chưa scope branch_id (R6).

> ❓ **Có thực sự hoạt động cho 5 luồng (thanh toán hóa đơn, chứng từ NCC, thu chi, thu công nợ KH)?**

| Luồng | Trạng thái |
|---|---|
| Thanh toán hóa đơn (POS cash/bank) | ❌ Không update cashbook → balance sai |
| Chứng từ NCC (supplier_payments) | ❌ Không có UI tạo |
| Thu chi tay (manual cash voucher) | ✅ Có CRUD, nhưng workaround draft→approved + self-approval |
| Thu công nợ khách hàng (debt_collection) | ⚠ Có dropdown gán customer_id; KHÔNG link customer_debt cụ thể, KHÔNG settle debt |
| Hoàn tiền KH (sales_returns cash refund) | ❌ Không có UI/trigger |

Kết luận tổng: **Chỉ 1/5 luồng vận hành đúng** (thu chi tay).

## Kế hoạch khắc phục (3 sprint)

> Nguyên tắc: **Database trước, frontend sau**. Mọi migration phải chạy thủ công qua Supabase SQL Editor (đã là quy ước dự án — xem `dashboard-branch-scope.md`).

### Sprint S1 — "Đồng bộ dòng tiền thực tế" (P0, ưu tiên cao nhất — 5–7 ngày)

**Mục tiêu**: Cash_funds.balance phản ánh đúng tiền thật. Báo cáo có thể tin được.

- [ ] **S1.1 Migration `20260531000000_cashbook_triggers_phase1.sql`**:
  - Trigger `fn_handle_order_payment` AFTER INSERT trên `order_payments`: tạo `cashbook_transactions` (flow `inflow`, category lookup `sale_payment`, status `approved` ngay vì đã có chứng từ đơn) với:
    - `cash_fund_id` = quỹ tiền mặt mặc định của branch (nếu method=cash) | `bank_account_id` = tk ngân hàng mặc định (nếu method=bank_transfer)
    - `order_id`, `customer_id`, `reference_no` từ order_payments
    - **Cần thêm cột mới**: `cash_funds.is_default BOOLEAN`, `bank_accounts.is_default BOOLEAN` — 1 default per branch + payment_method.
  - Trigger `fn_handle_debt_payment` AFTER INSERT trên `debt_payments`: tương tự, category `debt_collection`, link `customer_debts.id` qua reference.
  - Trigger `fn_handle_sales_return_refund` AFTER UPDATE trên `sales_returns` (status→completed AND refund_method IN cash/bank): tạo `cashbook_transactions` outflow category `customer_refund`.
  - **Xử lý reverse**: trigger AFTER UPDATE `cashbook_transactions` khi approved→cancelled phải hoàn balance ngược lại.
  - **Backfill 1 lần**: SQL job populate cashbook_transactions cho tất cả `order_payments`/`debt_payments` lịch sử (admin chạy 1 lần, đánh dấu `description = '[BACKFILL]…'`).

- [ ] **S1.2 Migration `20260531000001_cashbook_default_accounts.sql`**:
  - Add `cash_funds.is_default_cash BOOLEAN DEFAULT FALSE`, `bank_accounts.is_default_bank BOOLEAN DEFAULT FALSE`
  - Constraint partial unique: `UNIQUE (branch_id) WHERE is_default_cash = TRUE` (mỗi chi nhánh 1 quỹ mặc định)
  - UI Cấu hình: bổ sung toggle "Quỹ mặc định" trong SystemSettings → tab Chi nhánh

- [ ] **S1.3 Fix trigger `fn_update_fund_balance`**:
  - Mở rộng thành `AFTER INSERT OR UPDATE`: nếu insert thẳng status='approved', cập nhật balance.
  - Khi update approved→cancelled, REVERSE delta (cộng/trừ ngược).
  - Sau migration này, frontend có thể bỏ workaround insert-draft-then-update.

- [ ] **S1.4 Refactor CashbookPage**:
  - Bỏ luồng draft→approved trong `handleTransactionSubmit` (đã được trigger AFTER INSERT xử lý).
  - Thêm date picker cho `transaction_date` (cho phép back-date có giới hạn 30 ngày trở lại).
  - Convert dùng `formatCurrency` từ `DisplaySettingsContext` thay vì `Intl.NumberFormat`.

- [ ] **S1.5 Test E2E**:
  - Viết lại `cashbook.spec.ts` — mở form (sidebar luôn visible), submit, verify dòng mới + balance update.
  - Kịch bản POS cash sale: bán → check cashbook có dòng auto sinh + balance cộng đúng.
  - Backfill: chạy SQL script trên staging, so sánh sum order_payments tiền mặt vs cash_funds.balance.

### Sprint S2 — "Hoàn thiện 5 luồng nghiệp vụ" (P1 — 7–10 ngày)

- [ ] **S2.1 Migration `20260601000000_cashbook_schema_align.sql`**:
  - `cashier_sessions`: thêm `code TEXT UNIQUE` (auto-sinh `CS-2026-MM-DD-CN-XXX-NNN`), `variance_reason TEXT`, `opened_by UUID`, `closed_by UUID`.
  - `cash_funds`: thêm `custodian_user_id UUID` (nullable trước, manual gán).
  - `cashbook_transactions`: thêm `posted_at TIMESTAMPTZ DEFAULT now()`, `cancelled_at TIMESTAMPTZ`.
  - Sửa `fn_auto_cashbook_code` để dùng prefix `CQ` cho internal_transfer leg thay vì `TT`.

- [ ] **S2.2 Trigger 2-leg atomic cho internal_transfers**:
  - AFTER INSERT trên `internal_transfers` (status='completed'): tự sinh 2 dòng cashbook đối ứng + link `from_cashbook_id, to_cashbook_id` ngược lại.
  - Bỏ luồng 3-roundtrip trong `handleInternalTransferSubmit` — chỉ insert internal_transfers, trigger lo phần còn lại.
  - Đảm bảo atomic qua DEFERRABLE constraint hoặc 1 transaction.

- [ ] **S2.3 UI "Thu công nợ khách hàng"**:
  - Khi user chọn counterparty=customer, hiện thêm **dropdown chọn dư nợ** (load `customer_debts` chưa settle của KH đó) → tự fill amount = remaining, tự link.
  - Submit: insert `debt_payments` (trigger S1.1 sinh cashbook tự động).
  - Hoặc thêm tab riêng "Phiếu thu công nợ" trong cashbook (parallel với UI hiện tại trong CustomerDetail).

- [ ] **S2.4 UI "Thanh toán NCC"**:
  - Tab mới `transfers` hoặc tab thứ 4 "Thanh toán NCC":
    - Chọn supplier → load PO/GR chưa thanh toán → multi-select để tách `supplier_payment_allocations`.
    - Insert `supplier_payments` → trigger sinh cashbook outflow `supplier_payment` đồng thời giảm `suppliers.current_debt_payable`.

- [ ] **S2.5 UI "Tạm ứng & Hoàn ứng nhân viên"**:
  - Tab mới hoặc trong sub-tab phiếu chi:
    - Tạm ứng: insert `employee_advances` + trigger sinh outflow `advance_to_employee`.
    - Hoàn ứng: insert dòng settlement, trigger sinh inflow `advance_settlement`, update `employee_advances.settled_amount`.

- [ ] **S2.6 Tab "Báo cáo dòng tiền"** (spec §9.14, ưu tiên 1, 2, 5):
  - (1) Bar chart inflow/outflow/net theo ngày/tuần/tháng — Recharts.
  - (2) Bảng số dư quỹ + sparkline 30 ngày — `cash_fund_balance_history` view mới.
  - (5) Nút "Xuất Excel sổ quỹ" — sinh XLSX theo template kế toán VN (STT/Ngày/Số phiếu/Diễn giải/Đối tượng/Nợ TK/Có TK/Số tiền). Dùng `exceljs` hoặc Edge Function. Wire vào nút đang chết ở line 1066.

### Sprint S3 — "Hardening phân quyền + UX cuối" (P2 — 5–7 ngày)

- [ ] **S3.1 Migration `20260605000000_cashbook_rls_align_spec.sql`**:
  - **R1**: Tách `cashbook_select_accountant` → policy mới `cashbook_select_accountant_branch` scope qua `cash_fund.branch_id = fn_my_branch_id() OR bank_account.branch_id = …`. Admin/CEO giữ policy toàn hệ thống riêng.
  - **R2**: Policy mới `cashbook_select_warehouse_keeper_session`: warehouse_keeper SELECT WHERE `session_id IN (SELECT id FROM cashier_sessions WHERE cashier_id = auth.uid())`.
  - **R3**: UI guard — `hasPermission('cashbook.create')` trước khi show form. Nếu thiếu, hiện banner "Bạn không có quyền tạo phiếu thu/chi, liên hệ kế toán trưởng".
  - **R4**: Tách 2 permission `cashbook.create_inflow`, `cashbook.create_outflow`. Migration thêm vào `permissions` + redistribute role_permissions.
  - **R5**: Block self-approval — policy `cashbook_update_accountant` thêm `AND created_by != auth.uid()` cho UPDATE status từ pending_approval→approved. Frontend disable nút duyệt nếu là phiếu của chính mình.
  - **R6**: Branch_manager `cashbook_select_branch_mgr` đã được tách như dashboard scope (xem migration `20260530000002`). Áp pattern tương tự cho cashbook nếu chưa có.

- [ ] **S3.2 Tab "Tổng quan"** (spec §9.15):
  - Cards mỗi quỹ/TK + sparkline 30 ngày + delta hôm nay.
  - Bar chart mini inflow/outflow 7 ngày.
  - List phiếu chờ duyệt (action duyệt nhanh).

- [ ] **S3.3 Polish UX**:
  - **F1**: Bỏ hardcode branch_id fallback; nếu user không có branch_id và không phải admin/CEO, redirect về AccessDenied.
  - **F4**: Mở rộng tabs lên 6 (Tổng quan, Phiếu thu, Phiếu chi, Chuyển nội bộ, Phiên quỹ, Báo cáo).
  - **F5**: Mở ca cho phép chọn quỹ (multi-fund).
  - **F11**: Đổi "Inflow/Outflow" → "Thu / Chi" trong tất cả dropdown filter.
  - In phiếu thu chi: verify route `/print-preview?type=cash_in&id=…` đã có handler.

- [ ] **S3.4 Tài liệu hóa**:
  - Cập nhật `docs/01-FUNCTIONAL-SPEC.md` §9 phản ánh schema thực tế (cột `balance` không phải `current_balance`, v.v.) — đồng bộ spec ↔ code.
  - Viết `docs/06-CASHBOOK-PLAYBOOK.md` mô tả 5 luồng nghiệp vụ end-to-end + cách xử lý variance.

## Phụ lục — Quy ước hành động

- Mọi migration mới gắn tem: `-- AUDIT-2026-05-30 — Sprint Sx.y`
- Mọi commit gắn prefix `feat(cashbook):` / `fix(cashbook):` / `chore(cashbook-rls):`
- Trước khi gộp Sprint, chạy:
  1. `npx tsc --noEmit` (0 lỗi)
  2. E2E `cashbook.spec.ts` PASS
  3. SQL smoke: insert 1 phiếu thu → balance update → insert order_payment cash → cashbook auto sinh → balance update lần nữa.

## Liên kết
- Spec: [docs/01-FUNCTIONAL-SPEC.md §9 + §4.6](file:///d:/CRMSANHLONGVETCO/docs/01-FUNCTIONAL-SPEC.md)
- Schema: [supabase/migrations/20260522000000_init_schema.sql:953-1102](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000000_init_schema.sql#L953)
- RLS: [supabase/migrations/20260522000002_rls.sql:1055-1215](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000002_rls.sql#L1055)
- Triggers: [supabase/migrations/20260522000001_triggers.sql:474-735](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000001_triggers.sql#L474)
- Frontend: [src/pages/cashbook/CashbookPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx) (2415 dòng — Sprint sau cần tách module)
- Liên quan: [[project-state]], [[feedback-conventions]], [[dashboard-branch-scope]]

---

# Re-audit 2026-06-10 (mô hình Fable 5) — migration 20260627000000_cashbook_harden.sql

Audit lại sau khi S1–S4 hoàn thiện. Kiểm chứng read-only + exploit (rollback) trên prod `gdotgcrtivjdpkcchrro` qua Management API + JWT simulation. **4 lỗ hổng MỚI phát hiện & đã vá** (khác hẳn 18 phát hiện cũ — những cái cũ đều đã đóng):

- **C1 (NGHIÊM TRỌNG):** `fn_apply_fund_delta` SECURITY DEFINER chưa REVOKE → mọi user `rpc()` sửa số dư quỹ. Chứng minh exploit: non-admin (zendviet) đẩy QUY-HCM 30.46M→31.24M. Vá: REVOKE 3 hàm (apply_fund_delta + default_cash_fund + default_bank_account).
- **C2 (CAO):** ngưỡng 10tr chỉ ở client → INSERT thẳng approved bất kỳ + chèn chéo chi nhánh. Vá: RLS `cashbook_insert_staff` chặn non-admin outflow approved >10tr + cô lập chi nhánh + whitelist status.
- **C3 (CAO):** clause hở internal_transfer trong INSERT policy → bỏ.
- **C4 (TRUNG):** no state machine + sửa amount approved không re-balance → trigger BEFORE UPDATE `fn_guard_cashbook_update`.

**Bài học kỹ thuật quan trọng:**
- Mọi hàm SECURITY DEFINER **mutate tiền** PHẢI REVOKE PUBLIC/anon/authenticated (Postgres mặc định GRANT EXECUTE PUBLIC). Cùng class với lỗ `v_order_line_profit` (view) đã vá 2026-06-10 sáng. Kiểm: `has_function_privilege('authenticated', oid, 'execute')`.
- Bảng cashbook KHÔNG bật FORCE RLS + owner postgres → trigger SECURITY DEFINER bypass RLS hoàn toàn. Đây là cách để siết RLS phiếu-nhập-tay mà KHÔNG vỡ luồng auto. Không cần cờ phiên `app.*`.
- Test RLS qua Management API: `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true); ... ROLLBACK;`. **CẨN THẬN:** UPDATE/DELETE khớp 0 dòng dưới RLS KHÔNG raise exception → đừng nhầm "không lỗi" = "cho phép"; phải đếm `GET DIAGNOSTICS ROW_COUNT` hoặc đọc lại trạng thái.
- `fn_is_admin()` = admin OR ceo (cả 2 bypass RLS trong policy). accountant/branch_manager đều có branch_id thật → branch-scope INSERT không vỡ.

**LÀNH MẠNH (verify):** self-approval guard OK, DELETE chặn, SELECT cô lập chi nhánh, 0 phiếu thiếu/lệch, sessions không lệch, công nợ NCC khớp. 4 phiếu mồ côi đều cancelled.

**⚠️ DỮ LIỆU vận hành:** QUY-DN (Phù Mỹ) số dư **-580.000₫** (âm) — nộp quỹ cuối ca 1.15tr vượt thực thu ~994k. Báo user, không tự sửa.

**HOÃN (roadmap):** threshold→system_settings; RPC fn_settle_employee_advance; RPC fn_close_cashier_session (chặn nộp vượt → tránh quỹ âm).

**Frontend:** CashbookReports→DataTable + banner lỗi; CashbookPage 3 catch→banner dataError+Thử lại; hằng số APPROVAL_THRESHOLD.
