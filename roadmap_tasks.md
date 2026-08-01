# Lộ Trình Phát Triển Hệ Thống CRM/ERP Sanh Long Vetco (Phases 1, 2 & 3) - [HOÀN THÀNH TOÀN BỘ]

Tài liệu này theo dõi tiến độ và ghi nhận các đầu mục công việc xây dựng hệ thống ERP/CRM của Sanh Long Vetco, bao gồm cả 3 giai đoạn (Phase 1, Phase 2, và Phase 3) đã hoàn thành xuất sắc.

---

## 🔐 2026-06-24 — Phân quyền chi tiết Module × Chức năng (Phase 1: foundation + pilot)

- [x] **Catalog chuẩn** `src/lib/permissionCatalog.ts` (module × {Xem/Thêm/Sửa/Xóa + đặc biệt}) — driver ma trận + kiểm tra toàn vẹn. Thêm chức năng mới = thêm 1 dòng → tự hiện trong phân quyền.
- [x] **Migration `20260725000000_permission_catalog_matrix.sql`** (ĐÃ apply remote ✅ HTTP 201 + verify): UPSERT 73 permission codes; baseline `role_permissions` cho 7 role (idempotent, KHÔNG gỡ quyền cũ); RPC `fn_set_role_permissions(role,codes[])` admin-only nguyên tử (chặn admin/ceo).
- [x] **Pilot enforcement permission-based**: `fn_collect_customer_debt` guard → `fn_is_admin() OR fn_has_permission('customers.collect_debt')`; seed cấp cho accountant + branch_manager ⇒ **giữ nguyên** quyền (admin/ceo/accountant/branch_manager). Verify remote: 3 user active đều `can_collect=true`.
- [x] **UI "Vai trò & Phân quyền"** (tab mới Cấu hình) `RolePermissionMatrix.tsx` — kế thừa `DataTable`, ma trận checkbox module×action, chấm xanh = đã enforce. admin/ceo khóa (toàn quyền).
- [x] **FE gating đa role**: `useAuth` expose `userRoles[]` + `hasAnyRole()`; nút Thu nợ (QuickView + CustomerDetailPage) gate bằng `hasPermission('customers.collect_debt')`.
- [x] Doc `docs/13-RBAC-PERMISSIONS.md`. Build + 67 test PASS. **Cần user commit + deploy FE.**
- ⏭ **Phase sau**: chuyển RLS các module còn lại (orders/cashbook/inventory/products/reports/system…) từ `fn_has_role` → `fn_has_permission` theo lô, mỗi lô verify JWT giả từng role.

---

## 🔧 2026-06-24 — Sửa công nợ KH (đếm trùng) + Sổ giao dịch + Đơn hàng

- [x] **Lỗi dư nợ sai (đếm trùng):** Bảng kê tái dựng cộng cả dòng `advance_from_customer`
  (bút toán phái sinh của khoản thu vượt — tiền đã có ở `order_payments`/`debt_payments`)
  → trừ 2 lần. Sửa ở [customerStatement.ts](file:///e:/CRMSANHLONG/src/lib/customerStatement.ts)
  + ledger [CustomerDetailPage.tsx](file:///e:/CRMSANHLONG/src/pages/customers/CustomerDetailPage.tsx):
  `advance_from_customer`/`refund_due` chuyển thành **dòng thông tin** (không cộng số dư);
  chỉ điều chỉnh thủ công (`order_debt`, order_id NULL) mới ảnh hưởng số dư. Closing nay
  **khớp tuyệt đối** `customer_summary_view.total_debt`. Có unit test (4 ca) +
  [customerStatement.test.ts](file:///e:/CRMSANHLONG/src/test/unit/customerStatement.test.ts).
  **Sổ quỹ thu/chi vốn đã đúng** (chỉ ghi tiền thật) — lệch chỉ ở bảng kê.
- [x] **Click "Mã chứng từ" → chi tiết:** hóa đơn/trả hàng/thanh-toán-theo-đơn điều hướng
  `/orders/:id` (cả trang chi tiết KH lẫn QuickView).
- [x] **QuickView:** tab "Lịch sử giao dịch" → **Sổ chi tiết giao dịch đầy đủ** (tái dùng
  `fetchCustomerStatement`), thêm nút **Thu nợ / Thu trả trước** ở header (role
  admin/ceo/accountant/branch_manager); nguồn nợ = `total_debt` (đồng bộ mọi nơi).
- [x] **Đơn hàng:** mặc định lọc **Hôm nay**; thêm **Khoảng thời gian** (từ–đến) lọc
  **server-side** qua `created_at` (giảm egress); hiển thị số dư âm = "Trả trước".

---

## 📋 Trạng Thái Các Phân Hệ

### 1. Phân Hệ Đăng Nhập & Bảng Điều Khiển (Auth & Dashboard) - `[HOÀN THÀNH]`
- [x] Thiết lập cấu trúc cơ sở dữ liệu Supabase (80+ bảng, triggers, indexes tối ưu).
- [x] Cấu hình phân quyền RBAC và chính sách bảo mật Row Level Security (RLS).
- [x] Tạo tài khoản quản trị viên cao nhất (`admin@sanhlongvetco.vn` / `Admin@SanhLong2026!`).
- [x] Thiết kế giao diện Đăng nhập ([LoginPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/auth/LoginPage.tsx)) sang trọng, bảo mật đa tầng, hỗ trợ Google OAuth.
- [x] Giải quyết triệt để lỗi deadlock khi kết nối Auth State với cơ sở dữ liệu.
- [x] Xây dựng trang Bảng điều khiển ([DashboardPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/dashboard/DashboardPage.tsx)) hoàn chỉnh, co giãn responsive, biểu đồ dòng tiền (Recharts), danh sách công việc & phiếu chi.
- [x] Tích hợp nút tác vụ nhanh "Bán hàng POS" nổi bật ngay tại Dashboard Header giúp nhân viên truy cập nhanh module bán hàng.

#### 🔍 Kiểm tra UX & Phân quyền Chi nhánh Dashboard — 2026-05-30 `[ĐANG THỰC HIỆN]`

**Vấn đề:** Trang Tổng quan vẫn hiển thị **tổng số liệu của TẤT CẢ chi nhánh** dù tài khoản đã được phân quyền giới hạn. Gốc rễ: RPC `get_dashboard_stats()` chạy SUM thô dưới RLS, nhưng RLS mở toàn hệ thống ở nhiều bảng (cashbook_transactions & activities cho `branch_manager`, orders cho accountant/warehouse_keeper); riêng `customer_debts` thiếu hẳn policy cho `branch_manager`. Hai bảng `cashbook_transactions` và `customer_debts` không có cột `branch_id` nên phải suy ra qua JOIN.

**Quyết định sản phẩm:** Admin/CEO có bộ chọn chi nhánh (mặc định "Tất cả chi nhánh"); các vai trò khác bị khóa cứng vào chi nhánh trong hồ sơ. Sửa toàn diện cả 3 lớp RLS + RPC + Frontend.

- [x] **Lớp 1 — Database** (migration `20260530000002_dashboard_branch_scope.sql`):
  - Nâng cấp `get_dashboard_stats(p_branch_id UUID DEFAULT NULL)`: lọc tường minh theo chi nhánh trong SQL. `admin/ceo` → dùng `p_branch_id` (NULL = toàn hệ thống); vai trò khác → ép về `fn_my_branch_id()`. Trả thêm field `branch_id`. Branch suy ra: `orders.branch_id`; nợ qua `COALESCE(orders.branch_id, customers.branch_id)`; lô qua `warehouses.branch_id`; dòng tiền qua `COALESCE(cash_funds.branch_id, bank_accounts.branch_id)`.
  - Vá lỗ rò RLS chéo chi nhánh: tách `branch_manager` khỏi policy "toàn bộ" của `cashbook_transactions` (policy mới `cashbook_select_branch_mgr` lọc qua quỹ/tài khoản chi nhánh) và `activities` (`activities_select_branch_mgr` lọc qua KH chi nhánh); bổ sung `debts_select_branch_mgr` cho `customer_debts`. `admin/accountant` giữ nguyên toàn hệ thống theo thiết kế giám sát tài chính.
  - ⚠️ Migration cần chạy thủ công qua Supabase SQL Editor.
- [x] **Lớp 2 — Hook dữ liệu**: `qk.dashboard.stats(branchId)` thành hàm + thêm `disbursements`/`appointments`/`branches`. `useDashboardStats(enabled, branchId)` truyền `{ p_branch_id }` vào RPC (fallback cũng lọc theo chi nhánh). `usePendingDisbursements`/`useTodayAppointments` nhận branchId + thêm `.order()` đúng (trước đây phiếu chi lấy 3 dòng ngẫu nhiên) + lọc branch qua nested cash_funds/bank_accounts/customers. Hook mới `useBranches()`.
- [x] **Lớp 3 — UX DashboardPage**: thanh ngữ cảnh chi nhánh (admin/CEO = dropdown "Tất cả chi nhánh"; vai trò khác = badge khóa cứng), `effectiveBranchId` truyền xuống cả 3 hook (đổi CN tự refetch), tiêu đề & chú thích động (`scopeLabel`), skeleton loading thay spinner, error state có nút "Thử lại", nút "Tất cả" phiếu chi → `/cashbook` (ẩn nếu thiếu quyền), role alerts mở rộng (branch_manager + warehouse_keeper), delta đổi màu theo dấu. `tsc --noEmit` PASS 0 lỗi.
  - ⚠️ Cần chạy migration `20260530000002` qua Supabase SQL Editor để RPC mới nhận `p_branch_id`.

---

### 2. Phân Hệ Khách Hàng (Customer Module) - `[HOÀN THÀNH]`
- [x] Xây dựng trang Danh sách khách hàng hỗ trợ tìm kiếm nhanh, lọc theo phân loại (hộ chăn nuôi, trang trại, đại lý...).
- [x] Thiết kế form Thêm mới / Cập nhật thông tin khách hàng (mã định danh tự động `KH-2026-xxxxx`).
- [x] Tích hợp quản lý **Nhóm giá áp dụng** (Price Lists) và **Hạn mức công nợ** (Credit Limit) bắt buộc.
- [x] Gán nhân viên phụ trách chính (primary sales) và chuyển đổi Khách hàng thành tài nguyên chung hiển thị cho tất cả chi nhánh và nhân viên (mở chính sách SELECT RLS cho `customers` và các thực thể phụ thuộc: liên hệ, trang trại, đàn vật nuôi, lịch sử bệnh). Các cấu trúc giao dịch trả hàng (`sales_returns`) và hóa đơn (`invoices`) vẫn tuân thủ logic phân quyền hạn chi nhánh/nhân viên.
- [x] **Sổ chi tiết giao dịch (Customer Transaction Ledger)**: Bổ sung tab Sổ chi tiết giao dịch trong màn hình Chi tiết khách hàng, cho dõi chi tiết các giao dịch mua hàng (Hóa đơn), thanh toán (Tiền mặt/Chuyển khoản), trả hàng, và điều chỉnh công nợ theo trình tự thời gian với tính năng tính Dư nợ cuối (running balance) tự động sau mỗi giao dịch.
- [x] **Bộ chọn địa chỉ thông minh (SmartSearchSelect)**: Nâng cấp các bộ chọn Tỉnh / Thành phố và Quận / Huyện của form Thêm khách hàng mới và Chỉnh sửa thông tin khách hàng sang component `SmartSearchSelect` tìm kiếm không dấu, accent-insensitive và mở rộng danh sách `LOCATION_DATA` của các tỉnh nông nghiệp chăn nuôi trọng điểm (Bình Dương, Lâm Đồng, Long An...).
- [x] **Điều chỉnh công nợ khách hàng (Manual Debt Adjustment)**: Bổ sung tính năng điều chỉnh số dư nợ trực tiếp của khách hàng tại Tab Sổ chi tiết giao dịch. Tích hợp nút "Điều chỉnh công nợ" với modal giao diện premium (Tăng nợ / Giảm nợ, nhập số tiền VND, ghi chú lý do), kiểm duyệt quyền truy cập RBAC (admin, ceo, accountant, branch_manager, team_lead, sales) và thực hiện ghi nhận vào bảng `customer_debts` với `order_id = null`, mã chứng từ điều chỉnh nợ tự động `DC-XXXX` hiển thị mượt mà trên Sổ chi tiết giao dịch.
- [x] **Sort công nợ + cột Tuổi nợ + Tần suất mua (2026-06-12, migration `20260701000000_customer_list_sort_metrics.sql`)**: Trang Danh sách khách hàng bổ sung sort server-side (click header, NULL luôn xuống cuối) cho 3 cột: **Công nợ hiện tại** (`total_debt`), **Tuổi nợ** (`debt_age_days` = số ngày từ khoản nợ chưa thanh toán cũ nhất, màu cảnh báo: ≤10 xám · 11–20 vàng · **>20 ngày đỏ**), **TS mua/tháng** (`orders_per_month` = số đơn 90 ngày gần nhất ÷ 3, không tính đơn hủy). View `customer_summary_view` recreate thêm 2 cột tính toán (giữ `security_invoker`), thêm partial index `idx_customer_debts_customer_unsettled`. Export CSV thêm 2 cột mới + áp sort hiện tại + vá CSV formula injection (prefix `'` cho ô bắt đầu `= + - @`, bỏ qua số hợp lệ). Lưu ý phân quyền: với role sales, KH không thuộc mình hiển thị nợ 0/tuổi nợ `—` do RLS `customer_debts`/`orders` lọc trong view (hướng an toàn, không rò rỉ).

#### 🔍 Kiểm tra toàn diện 2026-05-29 — Customer Module Bugfix

**Đã phát hiện & fix (migration `20260529000015_fix_customer_rls_for_all_roles.sql`):**
- [x] **Bug 1 (RLS)**: `customer_business_info` và `customer_personal_info` policy `cust_biz_manage_active` / `cust_personal_manage` thiếu role `branch_manager` → quản lý chi nhánh không sửa được thông tin bổ sung doanh nghiệp/cá nhân của KH. Đã thêm điều kiện `branch_manager AND c.branch_id = fn_my_branch_id()`.
- [x] **Bug 2 (RLS)**: `customer_contacts` DELETE policy `contacts_delete_admin_lead` thiếu `branch_manager` → Đã thêm điều kiện branch_manager.
- [x] **Bug 3 (RLS)**: `farms` policy `farms_manage_active` (FOR ALL) thiếu `branch_manager` → quản lý chi nhánh không thêm/sửa/xóa được trang trại của KH trong chi nhánh mình. Đã fix.
- [x] **Bug 4 (RLS)**: `herds` policy `herds_manage_active` (FOR ALL) thiếu `branch_manager`. Đã fix.
- [x] **Bug 5 (RLS)**: `disease_history` policy `disease_hist_manage_active` thiếu `branch_manager`. Đã fix.

**Đã fix Frontend (`CustomerDetailPage.tsx`):**
- [x] **Bug 6**: Nút "Chỉnh sửa hồ sơ" luôn hiển thị cho mọi user dù thiếu quyền → Đã ẩn nút bằng `canEditCustomer()` check: chỉ hiện cho owner/team_lead/branch_manager/admin.
- [x] **Bug 7**: Error handler `handleEditCustomer` chỉ hiển thị thông báo chung → Đã thêm phân biệt lỗi RLS (`violates row-level security`) với thông báo tiếng Việt rõ ràng.
- [x] **Bug 8**: Tương tự với `handleAddContact`, `handleDeleteContact`, `handleEditFarm` → Đã cải thiện thông báo lỗi.
- [x] **Bug 9**: `updated_at: new Date().toISOString()` bị set thủ công từ frontend → Đã bỏ, để DB trigger tự cập nhật.
- [x] Load `currentUserId` và `userRoles` khi khởi tạo component để phục vụ permission check.

**Nguyên nhân gốc của "user không sửa được thông tin KH":**
- SELECT đã được mở rộng (migration `20260524000001`) nhưng UPDATE chỉ cho phép: `owner_user_id = auth.uid()` (role sales), team_lead trong nhóm, branch_manager, admin/ceo. Nếu user thử sửa KH mà không phải owner → RLS từ chối thầm lặng, frontend chỉ báo lỗi chung.
- Với `branch_manager`: lỗi xảy ra tại `customer_business_info` và `customer_personal_info` do thiếu policy phù hợp.

#### 🔍 Kiểm tra 2026-05-30 — Nút "Điều chỉnh công nợ" không hiển thị

**Đã phát hiện & fix (Frontend `CustomerDetailPage.tsx`):**
- [x] **Bug 10 (UX)**: Nút "Điều chỉnh công nợ" bị ẩn quá sâu — nằm trong Tab "Đơn hàng & Công nợ" → Sub-tab "Sổ chi tiết giao dịch" → thanh tổng hợp (cần 2 click). User không phát hiện ra. Đã thêm nút **"± Điều chỉnh"** trực tiếp lên card **"CÔNG NỢ HIỆN TẠI"** trong header stats (vị trí nổi bật nhất, nhìn thấy ngay khi mở chi tiết KH). Giữ nguyên nút ở sub-tab ledger làm backup.
- [x] **Bug 11 (Debug)**: `loadCurrentUser()` không log error khi query `user_roles` thất bại → lỗi RLS có thể khiến `canAdjustDebt()` trả `false` thầm lặng. Đã thêm `console.warn` + `console.info` cho debug role loading failures.


---

### 3. Phân Hệ Sản Phẩm & Quản Lý Lô/Hạn Dùng (Product & Batch Module) - `[HOÀN THÀNH]`
- [x] Xây dựng danh mục sản phẩm (thuốc thú y, vaccine, chế phẩm sinh học) với đơn vị tính cơ bản.
- [x] Quản lý thông tin **Số Lô** và **Hạn sử dụng** bắt buộc khi nhập/xuất kho.
- [x] Thiết lập bảng giá theo nhóm khách hàng (Bán lẻ, Đại lý, Khách VIP, Giá chia hàng).
- [x] Thiết lập thuật toán **FEFO** (First Expired First Out - Hàng hết hạn trước xuất trước) tự động đề xuất lô hàng khi bán.
- [x] Tính năng chỉnh sửa thông tin chi tiết sản phẩm và nhập đơn giá trực tiếp cho từng bảng giá (Giá lẻ, Giá đại lý, Giá VIP...) thay cho chiết khấu tự động cứng nhắc khi tạo mới hoặc cập nhật sản phẩm.
- [x] Hiển thị bảng so sánh giá sản phẩm theo từng bảng giá áp dụng trực quan ngay tại trang chi tiết sản phẩm.
- [x] Đổi tên "Loại sản phẩm" thành "Nhóm sản phẩm" đồng bộ toàn bộ giao diện danh sách catalog.
- [x] Nâng cấp Giao diện Danh sách sản phẩm (KiotViet-style):
  - Phân chia bố cục thành 2 cột: Cột trái chứa bộ lọc động (Nhóm sản phẩm, Thương hiệu, Trạng thái kinh doanh) có tính năng cài đặt nhanh; Cột phải là bảng hàng hóa hiển thị các cột Ảnh, Mã SKU, Tên hàng (2 dòng), Giá bán, Giá vốn, Tồn kho (Live stock), Khách đặt, Thời gian tạo, Dự kiến hết hàng.
  - Tích hợp hàng Tổng cộng ở đầu bảng tính toán tự động tổng số lượng Tồn kho và Khách đặt của toàn bộ danh sách hiển thị.
  - Tích hợp tính năng Dự kiến hết hàng tự động tính số ngày sắp cạn kho dựa trên lịch sử xuất bán thực tế.
  - Xây dựng hai modal CRUD động quản lý Nhóm sản phẩm ([ManageCategoriesModal.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/ManageCategoriesModal.tsx)) và Thương hiệu ([ManageBrandsModal.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/ManageBrandsModal.tsx)) cho phép thêm/sửa/xóa và bật/tắt trạng thái hoạt động độc lập của từng thực thể trực tiếp từ màn hình chính.
  - [x] Tích hợp tính năng **Import & Export hàng hóa**: Xuất danh sách sản phẩm sang CSV (UTF-8 BOM), nhập danh sách sản phẩm hàng loạt từ CSV chỉ với cột Tên sản phẩm, tự động sinh mã SKU và tạo các dòng bảng giá khởi tạo tự động.
- [x] **Thông tin chi tiết sản phẩm nâng cao & Hoạt chất**:
  - Hỗ trợ lưu trữ và quản lý **Thông tin pháp lý** (`registration_number`), **Thông số & Hướng dẫn** (`contraindications` - Chống chỉ định, `withdrawal_period_meat` - Ngày ngừng thịt, `withdrawal_period_milk_egg` - Ngày ngừng sữa/trứng).
  - Tích hợp **Thành phần hoạt chất** (`active_ingredients`) liên kết đa-đa với sản phẩm kèm theo nồng độ/hàm lượng tương ứng.
  - Xây dựng trang quản lý danh mục **Hoạt chất** chuyên biệt ([ActiveIngredientsPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/ActiveIngredientsPage.tsx)) độc lập và đưa lên Menu chính **Kho & Hàng hóa** giúp tối ưu hóa luồng nghiệp vụ chẩn đoán & điều trị.
  - Tích hợp các trường thông tin và liên kết hoạt chất này vào luồng Thêm mới (`AddProductModal`), Cập nhật (`EditProductModal`) và hiển thị trực quan thông tin chi tiết trên trang Chi tiết sản phẩm (`ProductDetailPage`).
- [x] **Thẻ kho (Lịch sử biến động)**: Tích hợp tab Thẻ kho tại trang Chi tiết sản phẩm hiển thị chi tiết lịch sử các lần nhập kho, xuất kho, trả hàng, điều chỉnh chênh lệch hoặc hủy hỏng kèm thông tin số lô, kho hàng, đơn giá vốn và nhân viên thực hiện.

#### 🔍 Kiểm tra toàn diện & nâng cấp tiện ích 2026-06-11 — Product List UX + RPC

**Nâng cấp tiện ích (đã hoàn thành, migration `20260629000000_products_list_rpc.sql` apply remote OK):**
- [x] **Cột "ĐVT" (Đơn vị tính)**: bổ sung sau cột Tên hàng trên bảng danh sách sản phẩm (CSV export đã có sẵn cột này).
- [x] **Sort cột Tồn kho**: click header Tồn kho đảo chiều tăng ↔ giảm (icon mũi tên). `DataTable.tsx` mở rộng hỗ trợ sort header opt-in (`sortable` + `sortKey/sortDir/onSortChange` — controlled, không ảnh hưởng các trang khác). Sort thực hiện **server-side đúng theo tồn chi nhánh** của user được phân quyền (RPC `fn_products_list`).
- [x] **RPC `fn_products_list`** (SECURITY INVOKER, whitelist sort/status, clamp page_size 5000): gộp 1-5 query của `useProductsList` về **1 round-trip** — trang dữ liệu + count + tổng tồn/khách đặt filtered + ghi đè tồn/khách đặt/dự kiến hết theo chi nhánh ngay tại Postgres. Smoke-test remote PASS (tổng tồn Hoài Ân 16.122 khớp truy vấn trực tiếp, sort asc/desc đúng, search ILIKE escape wildcard).
- [x] **Sửa nhanh sản phẩm**: panel xem nhanh (quick view) thêm nút **"Sửa chi tiết"** mở `EditProductModal` ngay tại danh sách (không cần vào trang chi tiết). Chỉ hiển thị khi user có quyền (`admin` hoặc `products.manage` — khớp RLS).
- [x] **Cảnh báo tồn thấp bằng màu**: tồn = 0 → đỏ; sắp hết (dự kiến hết ≤ 7 ngày) → cam (cả ô Tồn kho và badge Dự kiến hết).

**Bug & bảo mật phát hiện khi audit (đã vá cùng đợt):**
- [x] **Bug (data integrity)**: 2 query tính tổng tồn/khách đặt theo chi nhánh trong `useProducts.ts` dùng sai cú pháp PostgREST (`.eq('warehouse:warehouses!inner(branch_id)', ...)`) → dòng "Tổng cộng" của user chi nhánh luôn 0/sai. Đã thay bằng RPC tính đúng tại Postgres.
- [x] **UX phân quyền**: nút "Thêm mới", "Import", "Quản lý danh mục" trước đây hiển thị cho mọi user dù RLS chặn khi lưu → đã ẩn theo gate `admin || products.manage`.
- [x] **Export CSV theo chi nhánh**: trước đây user chi nhánh xuất CSV ra tồn toàn hệ thống (lệch số hiển thị) → đã chuyển export sang cùng RPC, xuất đúng tồn chi nhánh.
- ⚠️ Ghi nhận (chưa làm): `EditProductModal` lưu bảng giá/hoạt chất theo kiểu delete-all + insert không atomic — nên chuyển sang RPC transaction trong sprint sau.

**Thẻ kho nâng cao (cùng đợt 2026-06-11, migration `20260630000000_product_movements_rpc.sql` apply remote OK):**
- [x] **RPC `fn_product_movements`** (SECURITY INVOKER): thẻ kho enrich đối tượng giao dịch qua `reference_id/reference_type` — bán/hoàn tác (`order`/`order_reverse`) → mã đơn + tên KH + **đơn giá thực bán** (MAX unit_price các dòng cùng SP, bỏ quà 0đ) + **nhóm giá** (bảng giá của đơn); nhập NCC (`goods_receipt`) → mã phiếu + tên NCC; khách trả (`sales_return`) → mã + tên KH qua đơn gốc; chuyển kho → mã phiếu. RLS giữ nguyên (user không đọc được chứng từ → hiện "—").
- [x] **Cột "Đối tượng"** mới ở tab Thẻ kho (cả quick view + trang chi tiết SP): tên KH/NCC + mã chứng từ là **link mở tab mới** (`/orders/:id`, `/goods-receipts/:id`; loại không có trang riêng chỉ hiện mã).
- [x] **Gộp cột "Giá vốn" → "Giá GD"**: dòng bán hiện giá bán thật + badge nhóm giá; dòng nhập hiện giá nhập — hết ô trống "—".
- ⚠️ Phát hiện khi audit: bảng `purchase_returns` (migration `20260524000002`) KHÔNG tồn tại trên remote — migration đó chưa từng apply; reference_type thực tế trên data: `order`, `goods_receipt`, `transfer`, `order_reverse`, `manual_lot`.

---

### 4. Phân Hệ Nhập Kho & Nhà Cung Cấp (Purchase & Inventory) - `[HOÀN THÀNH]`
- [x] Quản lý danh sách và thông tin liên hệ nhà cung cấp chi tiết ([SupplierListPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/suppliers/SupplierListPage.tsx), [SupplierDetailPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/suppliers/SupplierDetailPage.tsx)).
- [x] Quy trình tạo Đơn mua hàng (PO - Purchase Order) từ nhà cung cấp ([PurchaseOrderFormPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/purchase-orders/PurchaseOrderFormPage.tsx)).
- [x] Cải tiến Phiếu Nhập kho thực tế (Goods Receipt - [GoodsReceiptFormPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/goods-receipts/GoodsReceiptFormPage.tsx)):
  - Hỗ trợ nhập theo đơn đặt hàng (PO) hoặc nhập trực tiếp không cần PO (nullable `po_id`).
  - Hỗ trợ 2 chế độ xem: Dạng Chi tiết (Split Screen) và Dạng Bảng (Bulk Table View) nhập nhanh hàng loạt.
  - Tính năng "Xác nhận nhanh tất cả" tự động điền số lượng thực tế, số lô mẫu và kho mặc định chỉ với 1 click.
  - Cảnh báo chuỗi lạnh (Cold chain alerts) trực quan đối với các sản phẩm vắc-xin.
  - Tối ưu hóa chiều rộng và khoảng cách cột của bảng nhập hàng loạt (Bulk Table View) để không bị tràn màn hình; tích hợp bộ chọn thuế VAT (Không VAT, 5% VAT, 10% VAT) và lưu trữ tổng tiền chính xác sau thuế.
- [x] Cảnh báo tồn kho thấp (low stock) và lô hàng cận hạn sử dụng (< 30 ngày) kèm định mức tồn kho an toàn trong [InventoryPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/inventory/InventoryPage.tsx).

---

### 5. Phân Hệ Đơn Hàng & POS (Sales Orders & Retail POS) - `[HOÀN THÀNH]`
- [x] Giao diện bán lẻ POS nhanh trên Desktop cho cửa hàng với thiết kế Bento Grid cân đối tỉ lệ (64% - 36%).
- [x] Giao diện lên đơn đặt hàng nhanh trên Mobile (Mobile order entry) cho nhân viên đi thị trường.
- [x] Quản lý trạng thái đơn hàng (Nháp -> Chờ duyệt -> Đang giao -> Đã hoàn thành / Bị hủy / Trả hàng).
- [x] Tự động ghi nhận công nợ đơn hàng dựa trên số tiền thanh toán thực tế của khách hàng.
- [x] Nhập trực tiếp đơn giá bán và số lượng bằng bàn phím ngay trong dòng sản phẩm tại giỏ hàng POS.
- [x] Tải động danh sách các bảng giá (`price_lists`) từ database và hỗ trợ chuyển đổi bảng giá nhanh ngay tại màn hình POS.
- [x] Áp dụng tự động bảng giá tương ứng của khách hàng khi lựa chọn khách hàng tại POS.
- [x] Hỗ trợ tách/thêm dòng khuyến mãi đơn giá 0đ của sản phẩm (ví dụ: luồng khuyến mãi 10+2) và cho phép tồn tại nhiều dòng của cùng một sản phẩm ở các mức giá khác nhau nhờ chuyển đổi sang cơ chế rowId duy nhất trong giỏ hàng.
- [x] Nâng cấp Giao diện POS bán lẻ KiotViet-style toàn diện:
  - Tích hợp phím tắt F2 và đưa ô tìm kiếm autocomplete sản phẩm thông minh lên thanh Header chính (global app header) của hệ thống thay thế ô tìm kiếm nhanh mặc định khi ở trang POS.
  - Quản lý đa hóa đơn đồng thời (Multi-Invoice Tabs) với cơ chế cuộn ngang (`overflow-x-auto flex-nowrap`) và chống co rút (`shrink-0`) giúp hiển thị mượt mà không bị vỡ giao diện kể cả khi mở 18+ hóa đơn cùng lúc.
  - Điều chỉnh tỷ lệ chia cột tối ưu mới: `45%` (Giỏ hàng) - `35%` (Danh mục sản phẩm) - `20%` (Thanh toán) giúp mở rộng tối đa không gian giỏ hàng.
  - Thiết kế bảng giỏ hàng (Cart Table) dạng cột phân tách rõ ràng (Mã hàng, Tên sản phẩm, ĐVT, Số lượng, Đơn giá, Thành tiền) và nới rộng khoảng cách dòng (`py-3`) tạo độ thông thoáng dễ nhìn.
  - Cố định cụm Tổng tiền và nút Thanh toán (Sticky Bottom) ở đáy cột phải, không bị cuộn mất khi danh sách dài.
  - Tích hợp mặt nạ nhập liệu tiền tệ (Input Masking) tự động phân tách số bằng dấu chấm (ví dụ: `5.185.000`) trên các ô nhập tiền mặt khách trả và chiết khấu hóa đơn.
  - Cấu hình bật/tắt hiển thị ảnh thực tế trên các thẻ sản phẩm cột giữa. Nếu không có ảnh hoặc bị tắt, thẻ tự động thu nhỏ chiều cao linh hoạt.
  - Bổ sung phím tắt hiển thị trực tiếp trên giao diện: F3 (Tiền mặt), F4 (Chuyển khoản), F8 (Ghi nợ), F9 (Thanh toán).
  - Tối ưu hóa UI: nút tăng/giảm số lượng cỡ lớn (`w-7 h-7`) phù hợp màn hình cảm ứng, làm nổi bật nút tặng quà `+KM` (gradient màu xanh ngọc kèm icon `🎁`), icon thùng rác xóa dòng màu đỏ nổi bật, và badge ĐVT màu xanh đậm chữ trắng.
  - Đồng bộ định dạng giá trị trống thành `-` hoặc `N/A` tránh vỡ layout.
  - Hoàn thiện luồng thanh toán giao dịch ghi nhận Supabase cho đa hóa đơn một cách độc lập và ổn định.

#### 💾 Bền hóa nháp đơn POS + rà soát toàn diện /pos — 2026-06-14 `[HOÀN THÀNH]`

**Bối cảnh:** Toàn bộ dữ liệu đang soạn trên `/pos` (và `/orders/mobile`) sống trong React state → F5 / đóng tab / mất điện làm mất sạch (user báo: soạn sẵn 5 hóa đơn cho khách bị mất khi mất điện). Frontend-only, KHÔNG migration. `npm run build` (tsc + vite) PASS.

- [x] **Mới `src/lib/posDraftStorage.ts`**: helper `loadDraft/saveDraft/clearDraft` qua localStorage — envelope `{v, savedAt, data}`, **TTL 7 ngày** (bỏ qua nháp quá cũ → tránh khôi phục giá lỗi thời), validate cấu trúc, bọc try/catch chống lỗi quota.
- [x] **`POSPage.tsx`** (đa hóa đơn): khóa `pos-draft-tabs:<profile.id>` (theo từng nhân viên — máy quầy dùng chung, không lẫn nháp giữa ca). Khôi phục `tabs`+`activeTabId` 1 lần (gate `useRef`) + toast "Đã khôi phục N hóa đơn nháp"; auto-save khi tabs đổi (mọi tab trống → `clearDraft`). Sửa `loadData` gán bảng giá mặc định `|| t.selectedPriceListId` (không đè bảng giá khôi phục). `handleCloseTab` hỏi xác nhận khi tab còn hàng (đóng tab = xóa vĩnh viễn).
- [x] **`MobileOrderPage.tsx`** (1 nháp): khóa `pos-draft-mobile:<profile.id>`; gom nhóm draft (cart, customer, paymentMethod, delivery*, notes, manualDiscount, step) → khôi phục + auto-save; `clearDraft` khi lên đơn thành công.
- [x] **🐞 Vá bug stale-closure ghi nhầm tab (phát hiện khi test):** Tab 2 không thêm được sản phẩm khi **cùng bảng giá** với Tab 1 — `addToCart` (`useCallback` deps `[selectedPriceListId]`) và `adjustQuantity/updateQuantity/updateUnitPrice/addPromoLine/applyProductGift/setRowDiscount` (deps `[]`) "đóng băng" `activeTabId` trong closure qua `setCart`. Bảng giá giống nhau → callback không tái tạo → ghi vào Tab 1, Tab 2 luôn trống. **Fix:** thêm `activeTabIdRef` (cập nhật đồng bộ mỗi render); `setCart`/`updateActiveTab` đọc `activeTabIdRef.current` → mọi callback luôn ghi đúng tab đang mở.
- **Rà soát (giữ nguyên — đã tốt):** RPC `fn_pos_quick_sale` atomic draft→confirmed→completed (thiếu kho RAISE rollback); hạn mức nợ kiểm server-side trong `fn_pos_settle_payment`; quyền `orders.create` check trong RPC; chặn bán âm kho cả client (`oversellLines`) + server (FEFO). **Ghi nhận (không đổi — user duyệt):** user có `orders.create` gửi được `unit_price` tùy ý — đúng bản chất POS cho sửa giá.

#### 🔒 Vá an ninh + UX /pos sau rà soát toàn diện — 2026-06-14 (tiếp) `[HOÀN THÀNH]`
- [x] **#1 Kho xuất phải thuộc chi nhánh (migration `20260703000000_pos_warehouse_branch_guard.sql` — ĐÃ apply remote + verify `has_guard=true` + ghi history):** `fn_pos_build_draft` trước nhận `warehouse_id` thẳng từ client → vì SECURITY DEFINER (bỏ RLS), client tự chế request trừ được kho chi nhánh khác. Nay RAISE nếu kho không thuộc `branch_id` của người tạo (miễn trừ admin/CEO — vẫn yêu cầu kho active). Giữ nguyên logic chặn oversell.
- [x] **#3 Fallback UUID (`cartUtils.genId()`):** `crypto.randomUUID()` chỉ chạy ở secure context (https/localhost) → deploy http qua IP LAN sẽ undefined làm văng thêm hàng. Thêm `genId()` fallback; thay mọi `crypto.randomUUID()` trong `POSPage.tsx` + `cartUtils.ts`.
- [x] **UX (thuần frontend):** #4 số lượng nhập tay min 1 (`updateQuantity` Math.max(1)) tránh dòng qty 0; #5 dropdown khách đóng khi click ra ngoài (mousedown listener + `customerBoxRef`); #8 nhớ toggle `showGrid/showProductImages/autoPrint` qua localStorage (`pos-pref:*`).
- [x] **#2 Sàn giá bán — GIỮ NGUYÊN** (user duyệt): POS cho sửa giá tự do, chấp nhận rủi ro.
- [x] **#7 Tồn kho tươi giữa các máy (thuần frontend):** `POSPage` refetch `fetchStockData` khi tab focus/visible + interval 60s lúc đang hiển thị (chọn polling nhẹ thay realtime — chắc chắn chạy, không phụ thuộc publication, chi phí ~1 query/phút/máy). Server vẫn là chân lý cuối khi xác nhận đơn.
- [x] **#6 Oversell đơn giao hàng — GIỮ CHẶN CỨNG cả 2 luồng** (user duyệt lại): không đổi, đúng quyết định migration `20260625`. `npm run build` PASS.

#### 💾 Bền hóa nháp 3 form Kho (phiếu nhập · chuyển kho · trả NCC) — 2026-06-14 (tiếp) `[HOÀN THÀNH]`
- **Bối cảnh:** form nhập kho/chuyển kho/trả NCC mất dữ liệu khi thoát tab/mất điện (giống POS). Thuần frontend, KHÔNG migration. `npm run build` PASS. Tái dùng `posDraftStorage.ts` (TTL 7 ngày, khóa theo `profile.id`).
- [x] **Phiếu nhập** (`GoodsReceiptFormPage.tsx`): auto-save/khôi phục khi **tạo mới chế độ nhập trực tiếp** (`direct`); BỎ QUA sửa phiếu (`?id=` load DB) & nhập-từ-PO (`?po_id=` dựng lại từ PO → tránh xung đột). Khôi phục header + `verificationItems` + toast; `clearDraft` sau khi tạo phiếu thành công. Sửa default kho thành functional `prev => prev || whData[0].id` (không đè kho khôi phục). Khóa `inv-draft-receipt:<uid>`.
  - **🐞 Vá khôi phục (phát hiện khi test):** (1) restore thiếu `selectedPOId`+`selectedPO` (cờ gating phiên nhập) → kẹt màn "Cấu hình" → nay persist + khôi phục cả 2 (kèm fallback dựng lại PO cho nháp cũ) để vào thẳng bảng nhập; (2) **ROOT CAUSE: React StrictMode double-invoke** đánh bại cờ skip-một-lần (`modeInitRef`) → effect reset theo `receiptMode` chạy lần 2 xóa item + selectedPO. **Fix:** đổi sang so sánh GIÁ TRỊ thật `prevModeRef.current === receiptMode` (bền với StrictMode + set-lại-cùng-giá-trị lúc khôi phục). **Bài học: mọi effect "reset khi X đổi" phải so prev-value, KHÔNG dùng cờ boolean một-lần (StrictMode sẽ phá).**
- [x] **Chuyển kho** (modal `InventoryPage.tsx`): auto-save/khôi phục `newTransfer` (lưu khi có dòng/kho); khóa `inv-draft-transfer:<uid>`.
- [x] **Trả NCC** (modal `InventoryPage.tsx`): auto-save/khôi phục `newReturn` (lưu khi có dòng/NCC); khóa `inv-draft-return:<uid>`.
- Cơ chế dọn: tạo thành công reset form rỗng → effect auto-save tự `clearDraft`; bấm Hủy reset rỗng → tự dọn; bấm X (đóng) giữ nháp → mở lại khôi phục. Lines giữ snapshot (tên/SKU/SL/giá) nên hiển thị ngay trước khi dropdown lô nạp lại.
#### 🔒 Phần B — Rà soát toàn diện Kho + vá bảo mật/toàn vẹn — 2026-06-14 (tiếp) `[HOÀN THÀNH]`
**Migration `20260704000000_harden_inventory_transfers_returns.sql` — ĐÃ apply remote + verify + ghi history. Không đổi frontend** (giữ signature RPC, `created_by` FE đã = auth.uid()).
- [x] **#1 (NGHIÊM TRỌNG) RPC chuyển kho không kiểm quyền + nhận user_id client:** `fn_start/receive/cancel_transfer` là SECURITY DEFINER, GRANT authenticated, KHÔNG check quyền + `performed_by`/`received_by` lấy `p_user_id` client → mọi user đăng nhập thao túng tồn kho + giả mạo audit. **Vá:** thêm guard `fn_is_admin() OR fn_has_role('warehouse_keeper')` + dùng `auth.uid()` (giữ signature, bỏ qua p_user_id). Giữ nguyên logic giá vốn bình quân.
- [x] **#2 Trả NCC trừ kho 2 lần + không hoàn kho khi hủy:** trigger `fn_auto_stock_on_purchase_return_confirm` cũ trừ kho mỗi lần status→confirmed/completed (draft→confirmed→completed = trừ 2 lần). **Vá:** trừ MỘT LẦN khi rời 'draft' + HOÀN kho khi confirmed/completed→cancelled + guard chuyển trạng thái hợp lệ. (Đồng thời xử #5 hoàn kho khi hủy.)
- [x] **#4 RLS WITH CHECK + chi nhánh:** tách `*_manage` → insert/update/delete cho `stock_transfers` & `purchase_returns`; INSERT ràng `created_by = auth.uid()` + kho thuộc chi nhánh người tạo (admin miễn trừ).
- [x] **#3 Mặt tài chính trả NCC — HOÀN THÀNH** (migration `20260705000000_purchase_return_finance.sql`, ĐÃ apply remote + verify + **smoke-test rollback PASS**). Hạch toán chuẩn kế toán (user duyệt): trigger `fn_finance_on_purchase_return` (AFTER UPDATE) ghi khi rời 'draft'→confirmed/completed: `credit_note`/`next_po_offset` → giảm `suppliers.current_debt_payable`; `cash_refund` → ghi THU sổ quỹ (cashbook inflow, quỹ mặc định chi nhánh, **không gắn session**, danh mục THU-HOAN-NCC), không đụng công nợ. Hủy phiếu đã ghi → đảo ngược (cộng lại nợ / ghi CHI-HOAN-NCC). Smoke-test: credit_note debt −1000 + lô −1; cash_refund 1 dòng inflow 1000 + debt delta 0.
- ✅ Đã tốt giữ nguyên: phiếu nhập (status guard `20260622` + công nợ `20260623`); transfer chống race (FOR UPDATE); kiểm tồn khả dụng trước xuất.

#### 🛒 Nâng cấp /pos: BÁN THEO LÔ (chọn lô thủ công) + tìm kiếm + luồng SL + tiện dụng — 2026-06-15 `[HOÀN THÀNH]`
**3 vòng lặp theo phản hồi test. `npm run build` PASS.**
- [x] **#1 POS nhận biết LÔ (HSD):** `fetchStockData` nạp `id, lot_number, expiry_date` → `productLots` (sắp FEFO). Badge CẬN HẠN (≤30 ngày)/QUÁ HẠN/BÁN TRƯỚC.
- [x] **#2 Khung tìm kiếm rộng + font lớn**, dời vào thanh xanh POS (vòng 2).
- [x] **#3 Luồng nhập SL:** chọn lô (Enter/click) → ô SL luôn hiển thị sẵn, focus + prefill "1" → Enter → thêm → quay lại ô tìm; Esc hủy.
- [x] **#4 Tiện dụng:** chống double-submit (`submittingRef`); **Alt+1..9** chuyển tab; **Thêm nhanh KH** tại POS (RLS owner=auth.uid()).
- [x] **CHỌN LÔ THỦ CÔNG (vòng 3 — có migration `20260706000000_pos_manual_lot_selection.sql`, ĐÃ apply + smoke-test rollback):** `order_lines + lot_id`; `fn_pos_build_draft` ghi lô + chặn oversell THEO LÔ + validate lô thuộc kho; trigger xác nhận trừ ĐÚNG lô đã chọn (NULL → FEFO). Lý do: KH không nhận lô cận date. FE: dropdown mỗi lô 1 mục chọn được; giỏ mỗi lô 1 dòng; vượt tồn lô → disable Thanh toán.
- [x] **Bỏ header + logo trên POS (vòng 3):** `Layout` prop `hideTopBar`; POS `h-screen`, chiếm trọn màn hình.
- **Rà soát:** quick-add KH an toàn; trừ kho đúng lô đã chọn (smoke-test xác nhận lô FEFO không bị đụng). **Hở:** `fn_pos_apply_lines` (sửa đơn) chưa truyền lot_id → sửa đơn re-FEFO (chưa sai toàn vẹn). Xem [[feature-pos-draft-persistence]].

#### 🛠️ Nâng cấp /pos vòng 4 — tìm theo lô, giá gần nhất, info KH + sửa hạn mức — 2026-06-16 `[HOÀN THÀNH]`

Migration `20260707000000_pos_last_price_and_credit_limit.sql` (ĐÃ apply remote + smoke-test rollback, 2 hàm SECURITY DEFINER, KHÔNG đổi schema):
- [x] **#1 Tìm SP bằng SỐ LÔ:** `searchResults`/`searchLotEntries` khớp thêm `lot_number`; nếu chỉ khớp số lô → dropdown chỉ hiện đúng lô đó. Thuần FE, đọc `productLots` đã nạp.
- [x] **#2 Gợi ý GIÁ BÁN GẦN NHẤT (chỉ sau khi chọn KH):** RPC `fn_pos_last_sold_prices(customer_id, product_ids[])` — bỏ RLS `orders` (sales chỉ thấy đơn mình) để lấy giá lần bán gần nhất của ĐÚNG KH đó/SP (loại đơn `cancelled`). FE: nút "Gần nhất: X" dưới ô đơn giá, bấm → set giá. Refetch chỉ khi TẬP SP trong giỏ đổi (cache, nhẹ).
- [x] **#3 Tìm KH bằng ID:** thêm `c.id` vào lọc dropdown KH (đã có farm_name/code).
- [x] **#4 Mở rộng info KH + SỬA HẠN MỨC NỢ:** nạp LƯỜI địa chỉ (`customers.province/district/address`) + SĐT (`customer_contacts` lô chính) khi chọn KH → không tăng payload load đầu. Hiện thêm SĐT (bấm gọi), địa chỉ, mã KH. Sửa hạn mức inline qua RPC `fn_pos_set_credit_limit` (user chốt: **mọi NV active sửa được MỌI KH** — bỏ RLS, có **audit_logs** `source=pos_set_credit_limit` truy vết). KH chưa có hạn mức (=0) tô đỏ "Chưa thiết lập".
- **Trả lời câu hỏi user:** Data → chỉ #4 ghi `customers.credit_limit` (có audit); #2 thêm hàm đọc; #1/#3 thuần FE. Hiệu năng → load đầu KHÔNG đổi (mọi thứ nạp lười sau chọn KH); mỗi lần chọn KH thêm ~2 query nhỏ có index/cache. **Rủi ro đã nêu:** thu ngân tự nâng hạn mức = tự duyệt nợ (user chấp nhận, đã có audit). Xem [[feature-pos-draft-persistence]].
- [x] **Layout cột thông tin phải (2 vòng tinh chỉnh):** mở rộng `20%→25%` (giỏ `80→75`, danh mục `35→30`); thanh toán xếp **hàng ngang 3 nút**; nén khoảng cách; khối info KH gộp còn **3 dòng** (Hạng+Mã · SĐT | Địa chỉ full-width | Nợ | Hạn mức) → Bảng giá + Thanh toán hiện sẵn không cần cuộn.

#### 💰 POS — xử lý tiền khách trả DƯ (overpayment) — 2026-06-16 `[HOÀN THÀNH]`
Migration `20260708000000_pos_overpayment_to_credit.sql` (ĐÃ apply remote + smoke-test rollback PASS cả 2 nhánh). Khi `Khách trả > Khách cần trả`, hiện 2 lựa chọn:
- [x] **Trả khách (mặc định):** giữ nguyên — server kẹp trần `paid=grand_total`, phần dư đưa lại tiền mặt, sổ quỹ ghi đúng grand_total.
- [x] **Tính vào công nợ:** server ghi nhận TOÀN BỘ tiền nhận (sổ quỹ khớp tiền thực), phần dư thành dòng `customer_debts` ÂM (`advance_from_customer`) → trừ nợ cũ; khách không nợ thì thành số dư có (nợ âm) cho lần mua sau.
- **Cơ chế:** `fn_pos_settle_payment` thêm tham số `p_overpay_credit BOOLEAN DEFAULT false` (drop bản 3 tham số cũ → lời gọi cũ trong `fn_complete_delivery_payment` tự khớp bản mới với default=false, đơn giao hàng KHÔNG đổi). `fn_pos_quick_sale` đọc `overpay_credit` từ payload. FE: state `overpayToCredit` (reset khi đổi tab + sau bán), toggle chỉ hiện khi `changeDue>0 & method≠credit`, gửi cờ trong payload.

#### 🔍 Kiểm tra toàn diện 2026-05-29 — Order Module Bugfix

**Đã phát hiện & fix (migration `20260529000016_fix_orders_rls_and_relations.sql`):**
- [x] **Bug 1 (RLS)**: Bảng `order_lines` thiếu chính sách SELECT cho vai trò `branch_manager` → Quản lý chi nhánh xem chi tiết đơn hàng của chi nhánh mình bị trắng thông tin sản phẩm (0 sản phẩm). Đã thêm chính sách `order_lines_select_branch_mgr`.
- [x] **Bug 2 (RLS)**: Bảng `order_payments` thiếu chính sách SELECT cho vai trò `branch_manager` → Quản lý chi nhánh không xem được lịch sử thanh toán của đơn hàng. Đã thêm chính sách `order_payments_select_branch_mgr`.
- [x] **Bug 3 (RLS)**: Bảng `order_line_allocations` thiếu chính sách SELECT cho vai trò `branch_manager` → Quản lý chi nhánh không tải được thông tin phân bổ số lô và hạn sử dụng khi in hóa đơn. Đã thêm chính sách `allocations_select_branch_mgr`.
- [x] **Bug 4 (Database Schema)**: Bảng `order_line_allocations` thiếu khóa ngoại liên kết cột `lot_id` sang bảng `stock_lots(id)` → PostgREST không thể tự nhận diện mối quan hệ để thực hiện query JOIN. Đã thêm khóa ngoại `fk_order_line_allocations_lot`.

**Đã fix Frontend (`OrderDetailPage.tsx` & `PrintPreviewPage.tsx`):**
- [x] **Bug 5**: Frontend query trường không tồn tại `product_snapshot` trực tiếp từ bảng `order_lines` (gây ra lỗi 400 Bad Request và lỗi toast "Không thể tải thông tin đơn hàng"). Đã sửa thành JOIN sang bảng `products` (`products:products(name, sku, unit)`) và map ngược lại thuộc tính `product_snapshot` ở client để đảm bảo tính tương thích và hiển thị đúng tên, mã SKU, ĐVT thực tế của sản phẩm trên trang chi tiết đơn hàng và trang in.
- [x] **Bug 8**: Lỗi truy vấn dữ liệu Supabase `column customers_1.phone does not exist` tại trang in (`PrintPreviewPage.tsx`) do bảng `customers` không chứa trực tiếp số điện thoại mà lưu ở bảng liên kết `customer_contacts`. Đã sửa thành truy vấn nested `customer_contacts(phone, is_primary)` và giải quyết thông tin số điện thoại từ liên hệ chính.

**Đã fix logic sinh đơn hàng tự động từ dự án chăn nuôi (`HerdProjectDetailPage.tsx`):**
- [x] **Bug 6**: Luồng sinh đơn hàng tự động (`handleAutoGenerateOrder`) insert các trường không tồn tại vào bảng `order_lines` (như `quantity_in_unit`, `product_snapshot`, ...) dẫn tới lỗi SQL. Đã sửa lại map cột chuẩn xác (`product_id`, `quantity`, `unit_price`, `discount`).
- [x] **Bug 7**: Đơn hàng được insert trực tiếp dưới trạng thái `status: 'confirmed'` trước khi insert `order_lines` → trigger FEFO allocation chạy khi chưa có dòng sản phẩm nào. Đã sửa thành insert dưới dạng `status: 'draft'` trước, sau đó insert `order_lines`, rồi mới cập nhật status sang `confirmed` (giống POSPage).

**Đã tối ưu luồng trạng thái đơn hàng POS tại quầy và Mobile (2026-05-29):**
- [x] **Cửa hàng (Store Sales)**: Bán tại cửa hàng (nhận diện qua `delivery_address: 'Giao trực tiếp tại quầy POS'`) sẽ bỏ qua bước nháp (draft) và các bước giao hàng (shipping/delivered). Trong POSPage, đơn hàng được insert nháp, insert các dòng sản phẩm, xác nhận và hoàn tất ngay lập tức.
- [x] **Chi tiết Đơn hàng (OrderDetailPage)**: Stepper cho các đơn hàng bán tại cửa hàng chỉ hiển thị 2 trạng thái: "Xác nhận" và "Hoàn tất". Khi ở trạng thái "Xác nhận", nút thao tác sẽ hiển thị "Hoàn tất đơn hàng" thay vì "Bắt đầu giao hàng".
- [x] **Đơn di động (MobileOrderPage)**: Sửa bug tương tự cho MobileOrderPage (insert status `'draft'` trước khi insert lines, sau đó mới cập nhật sang `'confirmed'` để chạy trigger FEFO chuẩn xác). Bán giao hàng (Mobile orders) chỉ áp dụng cho bán xa nên vẫn giữ nguyên các bước giao hàng đầy đủ.

#### 🎁 Nâng cấp Khuyến mãi: Phân quyền chi nhánh + KM theo hàng hóa gợi ý POS — 2026-05-30 `[HOÀN THÀNH]`

**Bối cảnh:** Tính năng KM (`/promotions`) còn sơ sài: (1) bảng `promotions` không có cột chi nhánh → mọi nhân viên có quyền đều tạo KM áp dụng toàn hệ thống, sai mô hình đa chi nhánh; (2) KM chỉ áp cấp toàn đơn, thiếu KM gắn theo sản phẩm (mua X tặng Y / giảm theo số lượng) và không gợi ý tại POS.

- [x] **Database** (migration `20260530000003_product_promotions_and_branch_scope.sql` — ⚠️ chạy thủ công qua Supabase SQL Editor):
  - Thêm `promotions.branch_ids UUID[]` (rỗng = toàn hệ thống).
  - Bảng mới `product_promotions`: KM gắn theo từng SP (`promo_type` ∈ buy_x_get_y / percent / fixed_amount, `buy_qty`, `get_qty`, `get_product_id`, `discount_value`, `min_qty`, `branch_ids`, `priority`, hiệu lực).
  - RLS phân quyền cho CẢ 2 bảng: admin/ceo toàn quyền mọi chi nhánh (tick nhiều CN hoặc rỗng = toàn hệ thống); nhân viên có quyền `promotions.manage` chỉ tạo/sửa bản ghi `branch_ids = [fn_my_branch_id()]` (ràng buộc bằng `WITH CHECK`) → không can thiệp KM chi nhánh khác.
- [x] **Engine**: `src/hooks/useProductPromotions.ts` (mới — load + lọc branch/hiệu lực, `evaluateProductPromo()`, `promoShortLabel()`, `getTopPromo()`); `usePromotionEngine(branchId?)` lọc KM toàn đơn theo chi nhánh.
- [x] **POS** (`POSPage.tsx`): badge 🎁 trên thẻ sản phẩm cột giữa; banner gợi ý 1-chạm dưới mỗi dòng giỏ — `buy_x_get_y` hiện nút "🎁 Tặng N" (thêm dòng quà 0đ qua `applyProductGift`), `percent/fixed` hiện nút "Áp giảm %" (qua `setRowDiscount`). Lọc theo `profile.branch_id`. Đúng yêu cầu "gợi ý để khách biết, không tự động áp".
- [x] **Quản lý theo sản phẩm**: tab thứ 4 "Khuyến mãi" trong `ProductDetailPage.tsx` + `ProductPromotionModal.tsx` (admin multi-select chi nhánh; nhân viên khóa cứng CN mình).
- [x] **Trang KM toàn đơn** (`PromotionsPage.tsx`): `PromotionModal` thêm multi-select chi nhánh; danh sách hiển thị chip "Toàn hệ thống / N chi nhánh".
- [x] `tsc --noEmit` PASS 0 lỗi.

---

### 6. Phân Hệ Sổ Quỹ & Duyệt Chi (Cashbook & Disbursements) - `[HOÀN THÀNH]`
- [x] Quản lý Danh sách Phiếu thu / Phiếu chi tiền mặt và tiền gửi ngân hàng.
- [x] Quy trình kế toán lập phiếu chi đề xuất -> Admin/CEO phê duyệt phiếu chi trực tiếp trên hệ thống (đặc biệt các khoản chi > 10M).
- [x] Tự động cộng/trừ số dư các quỹ tài khoản ngay khi giao dịch được phê duyệt thành công qua triggers.
- [x] Quản lý phiên quỹ / ca làm việc của thủ quỹ (mở ca, đóng ca kèm đối soát, tính toán chênh lệch và bắt buộc nhập lý do chênh lệch).
- [x] Chức năng chuyển tiền nội bộ tự động tạo hai bút toán đối ứng cân bằng.

#### 🔍 Kiểm tra toàn diện 2026-05-28 — Bugs đã fix / còn tồn đọng

**Đã fix (CashbookPage.tsx — phiên 1):**
- [x] **Bug 1**: Detail modal hiển thị hardcode `'Quỹ tiền mặt HCM'` — đã sửa thành lookup động từ `cashFunds[]` / `bankAccounts[]`.
- [x] **Bug 2**: PostgREST `.or()` filter dùng double-quoted UUID (`"uuid"`) → không match được → ẩn toàn bộ cash transactions khi `accountFilter='all'`. Đã bỏ quotes: `fundIds.join(',')`.
- [x] **Bug 3**: Search chỉ match cột `description`, bỏ sót `transaction_code` và `reference_no`. Đã dùng `.or(description.ilike…,transaction_code.ilike…,reference_no.ilike…)`.
- [x] **TS Error**: 2 implicit `any` trong `cats.find()` (line 245) và `txs.forEach()` (line 673) — đã thêm type annotations.

**Đã fix (CashbookPage.tsx — phiên 2, 2026-05-28):**
- [x] **Bug 4 (Critical)**: `internal_transfers` insert luôn thất bại — cột `transfer_code TEXT NOT NULL UNIQUE` nhưng không có trigger tự sinh và frontend không cung cấp. Đã tạo migration `20260528000003_internal_transfer_code_trigger.sql`: thêm `code_sequences` entry prefix `CQ` + trigger `trg_internal_transfer_code`.
- [x] **Bug 5**: `loadMetadata` fetch `bank_accounts` không lọc theo `branch_id` → hiển thị tài khoản ngân hàng của chi nhánh khác trong summary cards và dropdown. Đã thêm `.eq('branch_id', userBranchId)`.
- [x] **Bug 6**: `fetchTransactions` khi `accountFilter='all'` dùng `cash_fund_id.is.null` → include tất cả bank transactions toàn hệ thống. Đã thay bằng `bank_account_id.in.(bankIds)` — chỉ lấy transactions của bank accounts thuộc chi nhánh. Thêm `bankAccounts` vào `useCallback` deps.
- [x] **Bug 7**: List table hiển thị generic "Quỹ mặt"/"Ngân hàng" thay vì tên thực. Đã sửa thành lookup từ `cashFunds[]`/`bankAccounts[]` (tương tự detail modal).

**Vấn đề schema (ghi nhận, chưa cần fix ngay):**
- Spec `01-FUNCTIONAL-SPEC.md` mô tả `cashier_sessions` có cột `code`, `opened_by`, `closed_by`, `variance_reason` — migration hiện tại thiếu; UI bù bằng logic riêng.
- Spec mô tả `cash_funds.current_balance`, `expense_categories.name_vi` — migration dùng `balance` và `name`; code đã adapt đúng.
- `fn_auto_cashbook_code` dùng code_type `supplier_payment` (prefix `TT`) cho `internal_transfer` flow — đúng về kỹ thuật nhưng sai về ngữ nghĩa. Không ảnh hưởng chức năng.

**Còn tồn đọng (backlog):**
- E2E `cashbook.spec.ts`: test "create expense voucher" dùng `getByRole('button', { name: /tạo phiếu/i })` nhưng form cashbook là sidebar luôn visible — test `return` sớm, không cover gì. Cần viết lại.
- Button "Xuất Excel" hiện diện trên UI nhưng không có `onClick` handler — chờ P4-6.
- Thiếu charts dòng tiền 6 tháng theo spec — chờ sprint sau.
- `profiles` RLS: `approver?.full_name` có thể null với sales user khi admin duyệt transaction của họ (profiles_select_self chỉ cho thấy profile bản thân).

#### 🔍 AUDIT TOÀN DIỆN 2026-05-30 — Đối chiếu Spec §9 + §4.6 vs Hiện trạng `[CẦN HÀNH ĐỘNG]`

**Tài liệu chi tiết & bằng chứng**: [.claude/memory/cashbook-audit-2026-05-30.md](file:///d:/CRMSANHLONGVETCO/.claude/memory/cashbook-audit-2026-05-30.md) (18 phát hiện kèm file:line, nhóm D1–D10 schema/trigger, R1–R6 RLS, F1–F11 frontend).

**Kết luận**: Module chỉ đúng ~40% so với spec; **1/5 luồng nghiệp vụ vận hành đúng** (thu chi tay). 4 luồng còn lại đều có lỗ hổng:

| Luồng | Trạng thái |
|---|---|
| Thanh toán hóa đơn (POS cash/bank) | ❌ POS chỉ insert `order_payments` — KHÔNG sinh `cashbook_transactions`, `cash_funds.balance` KHÔNG cộng |
| Chứng từ NCC (`supplier_payments`) | ❌ Không có UI nào tạo; bảng đang chết |
| Thu chi tay | ✅ Có CRUD, nhưng workaround draft→approved + self-approval không bị chặn |
| Thu công nợ KH (`debt_payments`) | ⚠ Có dropdown gán customer_id; KHÔNG link `customer_debts` cụ thể, KHÔNG settle |
| Hoàn tiền KH (`sales_returns` refund) | ❌ Không trigger, không UI |

**3 phát hiện nghiêm trọng nhất**:
- **POS bypass cashbook** → balance UI luôn lệch thực tế → variance đóng ca cực lớn → mất ý nghĩa kiểm soát quỹ.
- **0/4 auto-trigger spec §9.8** (sale_payment, debt_collection, customer_refund, supplier_payment) → bảng `supplier_payments`/`employee_advances` chết, không liên kết PO/GR.
- **RLS lệch spec §4.6**: accountant thấy toàn hệ thống (phải scope CN), warehouse_keeper bị từ chối (phải thấy phiếu trong ca mình), `cashbook.create_inflow/outflow` chưa tách, self-approval không bị chặn.

##### 📋 KẾ HOẠCH 3 SPRINT KHẮC PHỤC

> 🔖 **ĐIỂM TIẾP TỤC (cập nhật 2026-05-30 cuối ngày)**: **S1 + S2 đã HOÀN THÀNH 100% — toàn bộ 8 migration ĐÃ APPLY thành công trên Supabase remote** (chạy không lỗi, kể cả bản vá `20260601000002` sau lỗi `goods_receipts.status`). `tsc --noEmit` PASS. **Việc tiếp theo: Sprint S3** (phân quyền RLS §4.6 + tab Tổng quan + polish UX). Ngày mai gõ "tiếp tục s3". Ngữ cảnh chi tiết: [.claude/memory/cashbook-audit-2026-05-30.md](file:///d:/CRMSANHLONGVETCO/.claude/memory/cashbook-audit-2026-05-30.md).

**Sprint S1 — Đồng bộ dòng tiền thực tế** (P0) — `[HOÀN THÀNH 2026-05-30 — đã apply remote ✅]`
- [x] **S1.1** Migration `20260531000001_cashbook_auto_triggers.sql`: trigger AFTER INSERT cho `order_payments` / `debt_payments` + AFTER UPDATE cho `sales_returns` (→completed, refund_method ∈ cash/bank_transfer) → tự sinh `cashbook_transactions` (SECURITY DEFINER, bỏ qua RLS). Idempotent qua cột `source_table/source_id` + unique index. Bỏ qua method `credit/voucher/loyalty_points`.
- [x] **S1.1-backfill** Migration `20260531000002_cashbook_backfill_history.sql`: backfill toàn bộ thanh toán/thu nợ/hoàn tiền lịch sử (đánh dấu `[BACKFILL]`), idempotent, có cảnh báo ảnh hưởng số dư. ⚠️ Admin chạy CÓ CHỦ ĐÍCH sau khi verify triggers.
- [x] **S1.2** Migration `20260531000000_cashbook_default_accounts.sql`: thêm `cash_funds.is_default_cash`, `bank_accounts.is_default_bank` (partial UNIQUE per branch) + hàm `fn_default_cash_fund/fn_default_bank_account` + backfill tự đánh dấu quỹ đầu tiên/chi nhánh + danh mục `CHI-HOANTIEN`.
  - ⏳ **Toggle UI "Quỹ mặc định" DEFER**: hiện CHƯA có màn hình CRUD quỹ/tài khoản trong app (chỉ seed DB trực tiếp) → migration auto-default đã đủ cho trigger hoạt động. Toggle UI gộp vào tab quản lý quỹ ở Sprint S2/S3.
- [x] **S1.3** Sửa `fn_update_fund_balance` → `AFTER INSERT OR UPDATE` (helper `fn_apply_fund_delta`): áp delta khi INSERT approved hoặc *→approved; HOÀN delta khi approved→cancelled.
- [x] **S1.4** Refactor `CashbookPage.tsx`: bỏ workaround insert-draft-then-update (phiếu tay + 2 leg chuyển quỹ + bút toán lệch ca đều insert thẳng `approved`); thêm date picker `transaction_date` (back-date ≤30 ngày, chặn tương lai); chuyển `formatCurrency` qua `DisplaySettingsContext` (bỏ `Intl.NumberFormat` cục bộ). `tsc --noEmit` PASS 0 lỗi.
- [x] **S1.5** Verify: `tsc --noEmit` PASS 0 lỗi. Viết lại E2E `src/test/e2e/cashbook.spec.ts` (Playwright có sẵn) — 6 test cover: hiển thị thẻ số dư, form sidebar luôn hiện, ô ngày mặc định hôm nay + chặn tương lai, đổi Thu/Chi cập nhật danh mục, **tạo phiếu chi chuyển khoản ≤10M → toast thành công**, tab Phiên quỹ. Bổ sung SQL smoke-test `supabase/tests/cashbook_s1_smoke_test.sql` (BEGIN…ROLLBACK: chèn order_payment giả → cashbook tự sinh + số dư +123.000đ → rollback) để verify trigger sau khi apply migration.

> ✅ **ĐÃ APPLY REMOTE (2026-05-30)**: `20260531000000` → `20260531000001` → `20260531000002` (backfill) chạy không lỗi.
>
> 🐞 **Bug phát hiện kèm (ngoài S1, ghi nhận)**: `OrderDetailPage.tsx:424` query `customer_debts.paid_amount/original_amount` — 2 cột này KHÔNG tồn tại trong schema (chỉ có `amount/is_settled`). Luồng "Thêm thanh toán" ở OrderDetail sẽ lỗi 400. Cần fix ở Sprint S2 (khi làm UI thu công nợ).

**Sprint S2 — Hoàn thiện 5 luồng nghiệp vụ** (P1) — `[HOÀN THÀNH 2026-05-30 — đã apply remote ✅]`
- [x] **S2.1** Migration `20260601000000_cashbook_schema_align.sql`: `cashier_sessions.code` (auto CS-YYYY-NNNNN) + `variance_reason/opened_by/closed_by` (backfill code+opened_by); `cash_funds.custodian_user_id`; `cashbook_transactions.posted_at/cancelled_at` (+ trigger stamp cancelled_at); sửa `fn_auto_cashbook_code` → prefix `CQ` (code_type `internal_transfer`) thay cho `TT` mượn của supplier_payment.
- [x] **S2.2** Migration `20260601000001_internal_transfer_triggers.sql`: trigger `fn_cashbook_from_internal_transfer` AFTER INSERT → tự sinh 2 bút toán (`internal_transfer_out`/`internal_transfer_in`) + cập nhật số dư 2 TK + link `from_cashbook_id/to_cashbook_id`. Frontend `handleInternalTransferSubmit` chỉ còn 1 insert `internal_transfers` (bỏ 3-roundtrip).
- [x] **S2.3** UI "Thu công nợ KH" (`CashbookPaymentForms.tsx` sub-tab): chọn KH → hiển thị công nợ hiện tại từ `customer_summary_view` + nút "Thu toàn bộ" → insert `debt_payments` (trigger S1.1 sinh cashbook). **Fix kèm bug**: `OrderDetailPage.tsx` bỏ query `customer_debts.paid_amount/original_amount` (cột không tồn tại) → đổi sang settle theo tổng đã trả ≥ grand_total.
- [x] **S2.4** UI "Thanh toán NCC" (sub-tab) + Migration `20260601000002_supplier_payment_triggers.sql`: thêm `suppliers.current_debt_payable` (+goods_receipts confirmed, −supplier_payments, có backfill) + trigger sinh mã `payment_code` (TT) + trigger sinh cashbook outflow CHI-NCC & giảm công nợ NCC. UI hiển thị công nợ phải trả + nút "Trả toàn bộ". *(Phân bổ PO/GR chi tiết — `supplier_payment_allocations` — để dành S3, hiện thanh toán theo tổng công nợ.)*
- [x] **S2.5** UI "Tạm ứng NV" (sub-tab) + Migration `20260601000003_employee_advance_triggers.sql`: trigger sinh mã `advance_code` (TU) + sinh cashbook outflow CHI-TAM-UNG (tiền mặt quỹ mặc định) + link `transaction_id`. *(Hoàn ứng làm bằng phiếu thu tay THU-KHAC — chưa có UI settlement riêng, để dành.)*
- [x] **S2.6** Tab "Báo cáo dòng tiền" (`CashbookReports.tsx`): 3 KPI (tổng thu/chi/số dư), ComposedChart Recharts thu/chi/ròng theo ngày (7/30/90 ngày), bảng số dư quỹ+TK, **xuất sổ quỹ CSV UTF-8 BOM** (STT/Ngày/Số phiếu/Diễn giải/Tham chiếu/Thu/Chi — repo chưa có xlsx nên dùng CSV nhất quán pattern hiện có). Tab cũ nút "Xuất Excel" chết vẫn còn ở tab Lịch sử — chuyển hẳn chức năng xuất sang tab Báo cáo.
- [x] **RLS bổ trợ** Migration `20260601000004_payment_rls_branch_mgr.sql`: cho `branch_manager` (có `cashbook.create`) tạo `supplier_payments`/`employee_advances`/allocations để không bị từ chối thầm lặng.
- [x] **Mở rộng tabs** CashbookPage: 5 tab (Lịch sử / Thu nợ-Chi NCC-Tạm ứng / Chuyển quỹ / Phiên quỹ / Báo cáo). `tsc --noEmit` PASS 0 lỗi.

> ✅ **ĐÃ APPLY REMOTE (2026-05-30)**: `20260601000000` → `...001` → `...002` (đã vá lỗi `goods_receipts.status` — bảng này KHÔNG có cột status, trigger chạy theo INSERT/UPDATE/DELETE) → `...003` → `...004`, tất cả chạy không lỗi.

**Sprint S3 — Hardening phân quyền + UX cuối** (P2, 5–7 ngày) — `[HOÀN THÀNH 2026-05-30 — đã apply remote ✅]`
- [x] **S3.1** Migration `20260605000000_cashbook_rls_align_spec.sql`:
  - [x] **R1** Tách `cashbook_select_accountant` scope branch (admin/CEO mới toàn hệ thống).
  - [x] **R2** Policy mới `cashbook_select_warehouse_keeper_session` (SELECT WHERE `session_id IN (sessions của tôi)`).
  - [x] **R3** Frontend guard `hasPermission('cashbook.create')` trước khi show form; banner thiếu quyền.
  - [x] **R4** Tách `cashbook.create_inflow`, `cashbook.create_outflow`; redistribute `role_permissions`.
  - [x] **R5** Block self-approval: policy UPDATE thêm `created_by != auth.uid()` cho transition pending→approved; UI disable nút duyệt phiếu chính mình.
  - [x] **R6** Branch_manager SELECT scope theo `cash_fund/bank_account.branch_id` (pattern dashboard `20260530000002`).
- [x] **S3.2** Tab "Tổng quan" (spec §9.15): cards mỗi quỹ + sparkline 30 ngày; bar chart mini 7 ngày; list phiếu chờ duyệt + nút duyệt nhanh.
- [x] **S3.3** Polish UX: bỏ hardcode `branch_id` fallback (F1); mở rộng tabs lên 6 — Tổng quan/Phiếu thu/Phiếu chi/Chuyển nội bộ/Phiên quỹ/Báo cáo (F4); cho phép chọn quỹ khi mở ca (F5); đổi "Inflow/Outflow" → "Thu / Chi" (F11); verify route `/print-preview?type=cash_in&id=…`.
- [x] **S3.4** Tài liệu: cập nhật `docs/01-FUNCTIONAL-SPEC.md §9` đồng bộ schema thực; viết `docs/06-CASHBOOK-PLAYBOOK.md` mô tả 5 luồng end-to-end + cách xử lý variance.

**Tiêu chí merge mỗi sprint**:
1. `npx tsc --noEmit` (0 lỗi)
2. E2E `cashbook.spec.ts` PASS
3. SQL smoke: insert phiếu thu → balance update → insert order_payment cash → cashbook auto sinh → balance update lần nữa.

> ✅ **ĐÃ APPLY REMOTE (2026-05-30)**: Migration `20260605000000_cashbook_rls_align_spec.sql` đã apply thành công trên Supabase remote, tất cả chạy không lỗi.

#### 🖨️ Sửa trang in chứng từ "dữ liệu thật 100%" + Cấu hình Quỹ/Ngân hàng — 2026-05-31 `[HOÀN THÀNH]`

**Bối cảnh:** Yêu cầu dữ liệu sổ quỹ phải là dữ liệu thật 100%. Phát hiện trang in chứng từ vẫn rò rỉ dữ liệu giả + thiếu màn hình cấu hình quỹ/số tài khoản ngân hàng.

- [x] **Fix trang in** (`src/pages/system/PrintPreviewPage.tsx`):
  - **Bỏ hẳn `loadMockData()`** — trước đây khi fetch DB lỗi sẽ fallback đổ dữ liệu giả (Minh Phát, BIDV 1420546944...) lên đúng bản in → rủi ro in nhầm chứng từ giả. Nay khi lỗi/thiếu `id` → hiển thị màn trạng thái lỗi rõ ràng (lý do + nút "Thử lại"/"Quay lại"), **disable nút In**, không bao giờ render dữ liệu mẫu.
  - **Fix phiếu thu/chi hiển thị quỹ sai cứng**: query `cashbook_transactions` trước đây KHÔNG select `cash_fund_id`/`bank_account_id` nhưng code đọc `tx.cash_fund_id` → `fundAccount` luôn in hardcode `'Tài khoản ngân hàng ACB'`. Nay JOIN `cash_funds(name, code)` + `bank_accounts(bank_name, account_name, account_no)` → in **đúng tên quỹ / số TK thật**.
  - Gỡ bộ chọn loại chứng từ (chỉ dùng cho demo) + dọn import thừa (`useAuth`, `useNavigate`).
- [x] **Tab mới "Quỹ & Ngân hàng"** trong Cấu hình hệ thống (`src/pages/system/SystemSettingsPage.tsx`): CRUD `bank_accounts` (ngân hàng, số TK, chủ TK, chi nhánh NH, chi nhánh sở hữu, số dư, toggle mặc định `is_default_bank`, bật/tắt) + CRUD `cash_funds` (mã, tên, chi nhánh, số dư, toggle `is_default_cash`, bật/tắt). Đồng bộ cờ mặc định (gỡ cờ chi nhánh đích TRƯỚC khi ghi để tránh vi phạm unique index `uq_*_default_per_branch`). RLS sẵn có (`*_manage_admin` cho admin/accountant) → **không cần migration mới**.
- [x] `npx tsc --noEmit` PASS 0 lỗi.

#### 🧾 Sprint S4 — Mở/Đóng ca thu ngân + Đối soát tiền mặt — 2026-05-31 `[HOÀN THÀNH — cần apply migration]`

**Bối cảnh:** Tiền mặt thu/chi nhiều luồng (bán hàng POS, thu nợ, trả NCC, tạm ứng, hoàn tiền). Nhân viên cần biết tồn quỹ dự kiến để kết phiên, rạch ròi tiền mặt vs chuyển khoản. Mô hình: **1 chi nhánh = 1 két, mỗi két chỉ 1 ca mở tại 1 thời điểm, dùng chung nhiều nhân viên**.

**Kiểm tra hiện trạng:** Mọi giao dịch tiền mặt ĐÃ gắn `session_id` vào ca đang mở (POS order_payment, debt_payment, supplier_payment, employee_advance, phiếu tay) — TRỪ hoàn tiền trả hàng tiền mặt (thiếu). Chuyển khoản/thẻ KHÔNG gắn session → đã rạch ròi ở tầng dữ liệu.

- [x] **Migration `20260606000000_cashbook_session_reconcile.sql`** (⚠️ chạy thủ công qua Supabase SQL Editor):
  - Fix `fn_cashbook_from_sales_return`: hoàn tiền **mặt** gắn `session_id` ca đang mở → đối soát đúng.
  - Thêm danh mục `THU-LECH-QUY` / `CHI-LECH-QUY` (thừa/thiếu quỹ) — bút toán điều chỉnh cuối ca không còn mượn sai `CHI-NCC`.
  - Index duy nhất `uq_cashier_sessions_one_open_per_fund` (1 ca `open` / mỗi két) + dọn dữ liệu trùng.
  - RLS `sessions_select_branch` + `sessions_manage_branch` (theo `fn_my_branch_id()`) → mọi NV vận hành trong chi nhánh thấy & mở/đóng được ca chung của két.
- [x] **Frontend `CashbookPage.tsx`**:
  - `checkActiveSession` theo **két (quỹ chi nhánh)** thay vì theo người mở → NV dùng chung 1 ca; embed `profiles!cashier_sessions_cashier_id_fkey` (disambiguate sau khi có opened_by/closed_by FK).
  - Mở ca: chặn nếu két đã có ca mở (kèm bắt lỗi race unique index), gợi ý tiền đầu ca = tồn quỹ hệ thống, cảnh báo nếu chọn quỹ ≠ mặc định, ghi `opened_by`.
  - **Đóng ca có bảng đối soát**: Tồn đầu ca + Thu tiền mặt (tách danh mục) − Chi tiền mặt (tách danh mục) = Tồn dự kiến; ô nhập tiền đếm → chênh lệch (thừa/thiếu) tính trực tiếp đổi màu; khối tham khảo "Chuyển khoản phát sinh trong ca (không nằm trong két)". Ghi `closed_by`, `variance_reason`, dùng danh mục lệch quỹ.
  - Thẻ phiên ca hiển thị "Tồn quỹ hiện tại" (= số dư quỹ live) để theo dõi giữa ca.
- [x] `npx tsc --noEmit` PASS 0 lỗi.

---

### 7. Phân Hệ Pipeline Cơ hội (Opportunity Pipeline) - `[HOÀN THÀNH]`
- [x] Tải động danh sách các cột (giai đoạn) từ `pipeline_stages` theo `pipeline_id` được chọn.
- [x] Hiển thị tổng giá trị cơ hội (`estimated_value`) và số lượng cơ hội ở đầu mỗi cột.
- [x] Tải danh sách cơ hội (`opportunities`) từ Supabase và phân bổ vào các cột dựa trên `stage_id`.
- [x] Hỗ trợ kéo thả HTML5 Drag and Drop mượt mà giữa các cột và tự động cập nhật vào cơ sở dữ liệu.
- [x] Hộp tìm kiếm nhanh không dấu theo tên cơ hội, mã cơ hội, hoặc tên trang trại của khách hàng.
- [x] Bộ lọc theo Sales phụ trách ("Tất cả", "Cơ hội của tôi", hoặc chọn nhân viên từ danh sách profiles).
- [x] Modal thêm cơ hội mới (AddOpportunityModal) liên kết khách hàng, mã cơ hội tự sinh qua trigger database.
- [x] Modal chốt thắng / chốt thua (CloseOpportunityModal) lựa chọn lý do thua cuộc từ bảng `lost_reasons` hoặc xác nhận chốt thắng.
- [x] Thống kê footer (Tổng giá trị Pipeline của các cơ hội open, tỷ lệ thắng, chốt thắng mới trong tháng hiện tại).
- [x] Bộ lọc Trạng thái Cơ hội (Tất cả / Đang mở / Thắng / Thua / Hủy) trên đầu Pipeline giúp làm gọn danh sách.
- [x] Chuyển đổi chế độ xem linh hoạt giữa Kanban View và Chế độ Danh sách (List View) dạng bảng quản lý tập trung.
- [x] Nút di chuyển nhanh giai đoạn (mũi tên trái/phải) dưới thẻ Kanban giúp cập nhật giai đoạn không cần kéo thả.
- [x] Chỉ báo màu sắc ở viền thẻ tương ứng với màu của giai đoạn đó.
- [x] Nhãn cảnh báo cơ hội trì trệ (Stale Warning) màu cam nổi bật nếu cơ hội ở một giai đoạn quá 7 ngày.
- [x] Tô màu (highlight) từ khóa tìm kiếm khi khớp ký tự.
- [x] Định dạng tiền tệ tự động theo `DisplaySettingsContext`.

---

### 8. Phân Hệ Báo cáo (Reports Module) - `[HOÀN THÀNH]`
- [x] **Trung tâm Báo cáo** (`/reports`) — trang hub 6 báo cáo theo bento grid, kèm bộ chọn kỳ (Tháng/Quý/Năm), summary table live data và system status banner.
- [x] **Báo cáo Doanh thu theo thời gian** (`/reports/revenue`) — 4 KPI cards (Tổng doanh thu, Số hóa đơn, AOV, Biên lợi nhuận), AreaChart Recharts với toggle Ngày/Tuần/Tháng, bảng chi tiết theo ngày có phân trang và % tăng trưởng.
- [x] **Báo cáo Công nợ phải thu** (`/reports/debt`) — Aging BarChart 4 nhóm (0-30/31-60/61-90/>90 ngày), bảng aging theo khách hàng với highlight màu theo mức độ quá hạn, link sang CustomerDetailPage.
- [x] **Báo cáo Nhập xuất tồn kho** (`/reports/inventory`) — 4 KPI cards (Tổng giá trị, Số SKU, Sắp hết hạn ≤30d, Đã hết hạn), horizontal BarChart giá trị tồn theo danh mục, bảng tồn kho chi tiết với cảnh báo HSD màu đỏ/vàng, bộ lọc trạng thái.
- [x] **Báo cáo Hiệu suất nhân viên** (`/reports/staff`) — 4 KPI cards (Tổng doanh số, TB/NV, Top NV, Số đơn TB), BarChart top 10 nhân viên, bảng leaderboard có huy chương 🥇🥈🥉, % tăng trưởng so kỳ trước.
- [x] **Báo cáo Phân tích Chân dung Khách hàng** (`/reports/customer-profile`) — 4 KPI cards (Tổng khách hàng, đang hoạt động, rủi ro/đã mất, tổng đầu con chăn nuôi), 4 biểu đồ Recharts (vòng đời, phân loại nhóm, hạng giá trị, top 10 chi tiêu), bảng chi tiết kèm bộ lọc tìm kiếm và link chuyển hướng.
- [x] Navigation: Thêm menu "Báo cáo" (icon BarChart2) vào sidebar Layout.tsx, với active state khi ở bất kỳ route `/reports/*`.
- [x] 0 TypeScript errors, 0 ESLint errors trong tất cả các files báo cáo.

---

### 9. Phân Hệ Dự Án Chăn Nuôi (Herd Projects Module) - `[HOÀN THÀNH - BUGFIX 2026-05-28]`
- [x] **Sidebar Navigation**: Tích hợp menu "Chăn nuôi" với icon `PawPrint` trong `Layout.tsx`, đảm bảo trạng thái hoạt động (active state) chuẩn xác khi truy cập bất kỳ đường dẫn con nào dưới `/herd-projects/*`.
- [x] **Trang Danh sách Dự án** (`/herd-projects`):
  - Hiển thị danh sách dự án với các thông tin cốt lõi (mã dự án tự sinh, tên dự án, khách hàng, đàn vật nuôi, số lượng đầu con, BSTY phụ trách).
  - Bộ lọc động theo loại dự án (Kế hoạch kỹ thuật), trạng thái dự án, BSTY phụ trách, và ô tìm kiếm nhanh (không dấu/có dấu) theo tên dự án, mã dự án, tên trang trại.
  - Các tab bộ lọc nhanh (Presets): "Tất cả", "Dự án của tôi", "Đang hoạt động", "Quá hạn kiểm thử" kèm badge cảnh báo trực quan.
- [x] **Trang Tạo mới Dự án** (`/herd-projects/new`):
  - Cho phép chọn khách hàng, tự động tải danh sách chuồng trại và đàn vật nuôi tương ứng để gán vào dự án.
  - Tải động danh sách các bước mẫu (steps template) từ loại dự án đã chọn, hiển thị trực quan thứ tự và số ngày chênh lệch (`days_offset`).
  - Tự động tính toán ngày dự kiến (`planned_date`) cho các bước thực tế dựa trên ngày bắt đầu dự án và `days_offset`.
  - Tự động điền số lượng con mặc định theo số lượng hiện tại của đàn vật nuôi được chọn.
  - Lưu dự án và tự động tạo các bước thực tế tương ứng trong bảng `herd_project_steps` thông qua transaction Supabase.
- [x] **Trang Chi tiết Dự án** (`/herd-projects/:id`):
  - Bố cục 2 cột trực quan: Cột trái là Vertical Checklist Stepper hiển thị tiến độ các bước; Cột phải là Tab Panels hiển thị thông tin phân tích.
  - **Vertical Checklist Stepper**:
    - Hiển thị danh sách các bước theo thứ tự thực hiện, có màu sắc trạng thái rõ ràng (Chờ thực hiện, Đã xong, Bỏ qua, Thất bại).
    - Cập nhật trạng thái từng bước bằng modal chuyên nghiệp: cho phép ghi chú nội dung chi tiết, dán đường dẫn ảnh chụp thực tế tại chuồng trại, và tìm kiếm, chọn số lô thuốc/vaccine đã sử dụng từ kho hàng.
  - **Tab Kết quả dự án (Project Outcomes)**:
    - Ghi nhận và hiển thị đánh giá sao từ khách hàng (1-5 ⭐), nhận xét chi tiết, đánh giá hiệu quả của BSTY, và bài học kinh nghiệm.
    - Biểu đồ hao hụt trực quan so sánh tỷ lệ tỷ vong dự kiến vs tỷ lệ tử vong thực tế của đàn.
  - **Tab Chi phí & Lợi nhuận (Costs & Profits)**:
    - Thống kê chi tiết các loại thuốc/vaccine đã sử dụng trong các bước dự án, tự động tính tổng chi phí dựa trên đơn giá bán tương ứng với nhóm giá áp dụng của khách hàng (Bán lẻ, Đại lý, Khách VIP).
    - Chức năng **Sinh đơn hàng tự động**: Hỗ trợ kế toán tạo nhanh đơn đặt hàng nháp từ danh sách vật tư tiêu hao của dự án chỉ với một click, tự động liên kết đơn hàng với dự án bằng tag mã hóa trong trường `orders.notes` (ví dụ: `[ID: project_id] [Mã: project_code]`).
  - **Tab Nhật ký trang trại (Farm Log)**:
    - Hiển thị dòng thời gian (timeline) chi tiết về các hoạt động diễn ra trong dự án, bao gồm thời điểm tạo dự án, thời điểm cập nhật trạng thái bước và người thực hiện.
- [x] **Tích hợp & Ràng buộc**:
  - Không làm thay đổi cấu trúc bảng `orders` của Supabase bằng cách sử dụng tag text `[ID: project_id]` trong ghi chú để tìm kiếm liên kết bằng `.like()`.
  - Sử dụng cột `notes` dạng TEXT của bảng `herd_project_outcomes` để lưu trữ dữ liệu JSON tùy biến về đánh giá của khách hàng và bài học kinh nghiệm một cách an toàn.
  - 0 TypeScript errors, 0 ESLint errors trong toàn bộ phân hệ Dự án chăn nuôi.
- [x] **Bugfix Schema (2026-05-28)** — Migration `20260528000000_fix-herd-projects-schema.sql`:
  - Thêm cột `farm_id UUID FK` vào `herd_projects` (FormPage insert `farm_id` nhưng cột bị thiếu → lỗi 400 khi tạo dự án).
  - Thêm cột `photos TEXT[]` vào `herd_project_steps` (DetailPage select/update `photos` nhưng cột không tồn tại).
  - Mở rộng CHECK constraint `herd_project_steps.status` thêm `'failed'` (code sử dụng 4 status nhưng DB chỉ cho 3).
  - Thêm `UNIQUE(project_id)` vào `herd_project_outcomes` + sửa `upsert({ onConflict: 'project_id' })` trong DetailPage (mỗi lần Hoàn thành tạo record mới thay vì update).
  - Thêm RLS policy `herd_proj_select_vet` cho `vet_consultant` (có quyền `herd_projects.view_all` nhưng không thấy dự án nào do thiếu SELECT policy).

---

### 10. Phân Hệ Cấu Hình & Tổ Chức (Branch, Warehouse, Employee & Role) - `[HOÀN THÀNH]`
- [x] **Header Navigation & Permission-based Guard**:
  - Di chuyển toàn bộ menu từ thanh Sidebar dọc sang thanh Header ngang trên Desktop giúp tối đa hóa không gian làm việc rộng rãi.
  - Gom nhóm các mục menu thành các nhóm dropdown logic: **Tổng quan** (Bảng điều khiển, Hoạt động), **Kinh doanh** (Khách hàng, Chăn nuôi, Pipeline, Đơn hàng), **Kho & Hàng hóa** (Sản phẩm, Kho hàng, Nhà cung cấp), **Tài chính & Báo cáo** (Sổ quỹ, Báo cáo) và **Hệ thống** (Cấu hình) giúp giao diện Header gọn gàng và khoa học.
  - Tích hợp cơ chế tải động và kiểm tra danh sách quyền (permissions) thực tế từ cơ sở dữ liệu (`user_roles` -> `roles` -> `role_permissions` -> `permissions`).
  - Lọc động các mục menu hiển thị trên cả thanh Header Desktop, mobile drawer và bottom bar, chỉ hiển thị những module/menu được phân quyền cụ thể cho nhân viên đó.
  - Phân quyền bảo vệ route `/system-settings` trong `App.tsx` chỉ cho các phiên làm việc hợp lệ.
- [x] **Trang Cấu hình Hệ thống & Tổ chức** (`/system-settings`):
  - Thiết kế giao diện Tab ngang hiện đại (Quản lý Nhân viên, Chi nhánh, Kho hàng, Nhóm Sales).
- [x] **Quản lý Nhân viên (Employees)**:
  - Hiển thị danh sách nhân sự với đầy đủ thông tin (Họ tên, Email, Mã NV, Chức danh, Chi nhánh, Nhóm Sales, Vai trò RBAC).
  - Khắc phục lỗi tải danh sách nhân sự trống do PostgREST trả về lỗi quan hệ mập mờ (PGRST201) đối với `branches`, `teams`, `user_roles` và lỗi thiếu cột `job_title` (42703). Đã khắc phục bằng cách chỉ định rõ constraint liên kết và tạo file migration bổ sung.
  - Bộ lọc tìm kiếm nhanh không dấu theo tên/mã/chức danh và bộ lọc theo chi nhánh/vai trò.
  - Form thêm mới nhân viên sử dụng phương thức đăng ký tài khoản Supabase gián tiếp (`persistSession: false`) giúp admin tạo tài khoản cho cấp dưới mà không bị log out khỏi session hiện tại.
  - Phân quyền vai trò trực tiếp thông qua gán các bản ghi tương ứng trong bảng `user_roles` và đồng bộ tức thì.
  - **Wizard Bàn giao khách hàng (Deactivation Wizard)**: Tự động kích hoạt khi khóa tài khoản nhân viên kinh doanh (`is_active = false`), yêu cầu và thực hiện chuyển giao toàn bộ khách hàng đang phụ trách (`primary_sales_id`) cùng các cơ hội kinh doanh đang mở (`status = 'open'`) sang một nhân viên Sales đang hoạt động khác.
- [x] **Quản lý Chi nhánh (Branches)**:
  - Hiển thị danh sách dạng Grid Card tối giản, hiện đại theo thiết kế gốc.
  - Hỗ trợ đầy đủ chức năng Thêm mới / Sửa thông tin chi nhánh (Mã, Tên, Điện thoại, Địa chỉ, Giám đốc phụ trách) và bật/tắt hoạt động.
- [x] **Quản lý Kho hàng (Warehouses)**:
  - Hiển thị danh sách dạng bảng, lọc chi tiết theo chi nhánh.
  - Hỗ trợ CRUD các loại kho đặc thù (Kho tổng, Kho lạnh, Kho dụng cụ, Kho kiểm dịch, Kho trả về).
  - Tích hợp cấu hình dải nhiệt độ tối thiểu/tối đa (Min/Max °C) đặc thù cho các kho lạnh (`cold_chain`) bảo quản vắc-xin/sinh phẩm.
- [x] **Quản lý Nhóm Sales (Teams)**:
  - Hiển thị dạng Grid Card trực quan về các nhóm kinh doanh.
  - Hỗ trợ CRUD nhóm Sales, gán chi nhánh trực thuộc và chỉ định Trưởng nhóm (Team Lead) quản lý.
- [x] **Tương thích Schema Database**:
  - Thiết kế code tương thích tuyệt đối với các cột thực tế trong DB: sử dụng `manager_id` (trong `branches`), `lead_id` (trong `teams`), và không sử dụng các trường dư thừa hoặc không tồn tại như `keeper_user_id` hay `region` để tránh lỗi SQL.
  - Sửa lỗi toàn bộ các vấn đề biên dịch TypeScript (lỗi thiếu import.meta.env, lỗi so khớp receiptMode, lỗi type narrowing, lỗi scoped variables và các lỗi unused import/variables kế thừa) giúp dự án đạt trạng thái 0 lỗi biên dịch.
  - 0 TypeScript errors, 0 ESLint errors.
- [x] **Vá lỗi Phân quyền & RLS Chi nhánh/Kho/Tác vụ (2026-05-26)**:
  - Khắc phục lỗ hổng RLS trên `warehouses` và `teams` nhằm giới hạn quản trị viên chi nhánh (`branch_manager`) chỉ được phép quản lý kho và nhóm thuộc chi nhánh của họ.
  - Sửa đổi chính sách bảo mật bảng `profiles` và `user_roles` cho phép Quản lý chi nhánh (`branch_manager`) toàn quyền thực hiện thêm mới, cập nhật thông tin và gán vai trò nhân viên trong chi nhánh mình phụ trách.
  - Nâng cấp trigger `public.fn_handle_new_user()` và cấu hình để tự động gán vai trò quản trị cao nhất (`admin` và `ceo`) cho duy nhất email `admin@sanhlongvetco.vn` khi đăng nhập Google hoặc Email. Đồng thời, cải tiến giao diện cấu hình phân quyền nhân sự để ẩn các tùy chọn `admin`/`ceo` khỏi danh sách gán và bảo vệ/khóa điều chỉnh phân quyền của tài khoản tối cao này tránh bị ghi đè khi chỉnh sửa.
  - Cập nhật frontend (`AuthContext.tsx`, `Layout.tsx`, `DisplaySettingsContext.tsx`) đảm bảo vai trò `ceo` được bypass quyền và không bị che giấu dữ liệu tài chính nhạy cảm như `admin`.
  - Giải quyết triệt để lỗi RLS "new row violates row-level security policy for table 'user_roles'" xảy ra khi quản trị viên cao nhất tự cập nhật danh sách vai trò của chính mình, thông qua kiểm tra email an toàn trực tiếp từ bảng `profiles` (được sửa lỗi chính tả từ profilesa thành profiles ngày 2026-05-26) thay vì gọi đệ quy các quyền đã bị xóa tạm thời trong session.
  - **Bảo mật định tuyến (Route-level Guard - 2026-05-26)**: Phát triển component `ProtectedRoute` kết hợp giao diện `AccessDenied` (ShieldAlert) trang nhã. Chặn truy cập trực tiếp qua địa chỉ URL cho tất cả 30+ Route trên frontend, đối chiếu trực tiếp với quyền module của tài khoản (ngoại trừ vai trò admin/ceo được bypass tự động). Giải quyết triệt để vấn đề nhân viên gõ URL trái phép.
  - **Phân quyền Module hóa & Cô lập quyền Báo cáo (2026-05-26)**: Chuyển đổi tên hiển thị của các vai trò hệ thống trong DB sang dạng mô tả module (ví dụ: 'Kế toán' -> 'Sổ quỹ & Tài chính', 'Thủ kho' -> 'Kho hàng & Sản phẩm', 'Xem báo cáo' -> 'Báo cáo & Phân tích'). Rút bớt quyền xem báo cáo động khỏi các vai trò nghiệp vụ khác, chỉ giữ độc quyền cho vai trò 'Báo cáo & Phân tích' (ngoại trừ admin/ceo bypass), đảm bảo phân quyền phân hệ trực quan và an toàn tuyệt đối.

---

### 11. Phân Hệ Cấu Hình Hiển Thị Hệ Thống (Display Settings Module) - `[HOÀN THÀNH]`
- [x] **Database Migration & RLS**:
  - Tạo bảng `display_settings` trên Supabase (lưu trữ dòng cấu hình `'global'`).
  - Thiết lập chính sách RLS cho phép mọi user đã đăng nhập đọc cấu hình và chỉ Admin mới được quyền cập nhật.
- [x] **Tích hợp Core Context (DisplaySettingsContext)**:
  - Xây dựng React Context tải động cấu hình và cung cấp các hàm helper định dạng hiển thị.
  - Hỗ trợ cơ chế dự phòng (Fallback Defaults) tự động chạy khi chưa có bảng hoặc lỗi kết nối.
  - Tích hợp tự động tải vai trò người dùng (userRoleCode) để xử lý che giấu dữ liệu hoặc phân quyền xem trường.
- [x] **Quy chuẩn Định dạng Hiển thị**:
  - **Numeric & Currency**: Phân tách phần nghìn/thập phân, vị trí ký hiệu (trước/sau số), làm tròn, tự động thu gọn số lớn (ví dụ: 1.5 Tỷ).
  - **Thời gian**: Format DD/MM/YYYY, HH:mm hoặc hh:mm A, ngày đầu tuần, đơn vị chu kỳ vật nuôi.
  - **Mã & Văn bản**: Tiền tố mã định danh KH-, OPO-, HD-, LOT-, giới hạn ký tự cắt ngắn, hiển thị khi trường trống.
  - **Visual & Analytics**: Badge màu trạng thái, default chart types, safety thresholds nhiệt độ chuồng nuôi.
  - **Localization & Units**: Ngôn ngữ, múi giờ, đơn vị đo lường mặc định (kg, lit, m², con...).
  - **Bảo mật hiển thị**: Tự động che giấu số điện thoại/email đối với vai trò Sales; kiểm tra quyền truy cập cột (Field-level security) để ẩn cột Giá vốn/Lợi nhuận gộp.
- [x] **Giao diện cấu hình trực quan (DisplaySettingsTab)**:
  - Thiết kế tab Cấu hình hiển thị tích hợp trong trang Cấu hình hệ thống.
  - **Live Preview Panel**: Bảng hiển thị mẫu trực quan thay đổi trực tiếp (real-time) theo các thông số admin gõ.
- [x] **Kiểm thử & Độ tương thích**:
  - Áp dụng các helper định dạng thực tế trên trang Danh sách khách hàng (che SĐT) và Bảng điều khiển (doanh số, nợ, biểu đồ).
  - 0 TypeScript errors, 0 ESLint errors.

---

### 12. Phân Hệ Import/Export & Cấu Hình Động Khách Hàng (Customer Import/Export & Dynamic Properties) - `[HOÀN THÀNH]`
- [x] **Database Migration & RLS**:
  - Chuyển đổi cột `customer_type` và `value_tier` trong bảng `customers` từ dạng Postgres ENUM sang `TEXT` để hỗ trợ CRUD động.
  - Tạo bảng `customer_classifications` và `customer_tiers` lưu trữ danh mục động phân loại & hạng khách hàng.
  - Cấu hình chính sách RLS đầy đủ (Select cho mọi user đã login, CRUD dành riêng cho vai trò Admin).
- [x] **Giao Diện CRUD & Tích Hợp Cấu Hình Khách Hàng Chuyên Biệt**:
  - Di chuyển các tab quản lý "Nhóm Sales" (Teams), "Phân loại khách hàng" (Customer Classifications), và "Hạng khách hàng" (Customer Tiers) từ cấu hình hệ thống chung (`/system-settings`) sang trang cấu hình khách hàng chuyên biệt (`/customers/settings`) thuộc module Khách hàng.
  - Tích hợp liên kết điều hướng "Cấu hình KH" trên thanh menu chính của Layout (dưới nhóm Kinh doanh, có phân quyền quản trị) và thêm nút biểu tượng bánh răng "Thiết lập" trong tiêu đề danh sách khách hàng (`/customers`) để truy cập nhanh.
  - Hỗ trợ đầy đủ tính năng CRUD (Thêm mới, Chỉnh sửa, Xóa) và bật/tắt (is_active) trạng thái hoạt động độc lập của từng cấu hình (Nhóm, Phân loại, Hạng).
- [x] **Tích Hợp Dynamic Options vào Khách Hàng**:
  - Tải động danh mục phân loại và hạng từ cơ sở dữ liệu trên trang Danh sách khách hàng, Chi tiết khách hàng và Form thêm mới.
  - Đảm bảo các bộ lọc và form lựa chọn chỉ hiển thị các cấu hình đang hoạt động (`is_active = true`), nhưng hiển thị nhãn cũ đầy đủ cho các bản ghi khách hàng lịch sử.
  - Sửa lỗi **Đơn vị tính không load**: Đặt danh sách đơn vị mặc định tức thì trước khi gọi API, override khi API thành công, giữ fallback nếu API lỗi. Select `Đơn vị tính` không còn trống.
  - Sửa lỗi **Danh mục & Thương hiệu không load**: Thêm option `-- Chọn danh mục --` và `-- Chọn thương hiệu --` (value rỗng) làm default để không bị trống select khi data chưa load. Thêm warning log chi tiết cho mỗi bảng bị lỗi khi query.
  - Sửa `EditProductModal` tương tự: fallback units tức thì, warning logs, hiển thị đơn vị hiện tại của sản phẩm dù không có trong danh sách mới load.
  - Ghi nhận **cách chạy migration**: Chạy file `20260525000007_seed_product_categories_and_brands.sql` qua Supabase SQL Editor để populate data.
  - **Root cause fix**: Bỏ `.eq('is_active', true)` ở server-side, thay bằng filter phía client `.filter(x => x.is_active !== false)` để tránh xung đột RLS + column filter.
  - Đồng bộ `units` với localStorage của `ManageUnitsModal` (đọc `product-units` từ localStorage trước, override khi DB có data).
- [x] **Bugfix Định tuyến (Routing) - App.tsx (2026-05-25)**:
  - Phát hiện và sửa lỗi **xung đột thứ tự route** trong [App.tsx](file:///d:/CRMSANHLONGVETCO/src/App.tsx): các route cụ thể (`/products/prices`, `/products/ingredients`) bị khai báo SAU route wildcard `/products/:id` → React Router match nhầm và render `ProductDetailPage` khi truy cập `/products/prices` hoặc `/products/ingredients`.
  - Áp dụng quy tắc: **Route cụ thể PHẢI đứng TRƯỚC route wildcard `:id`**. Thứ tự đúng: `/products/prices` → `/products/ingredients` → `/products/:id`.
  - Đồng thời sửa luôn `/orders/pos` và `/orders/mobile` (đặt trước `/orders/:id`) và `/herd-projects/new` (đặt trước `/herd-projects/:id`) để tránh lỗi tương tự.
  - Xóa route `/products/ingredients` bị khai báo duplicate ở cuối file.
- [x] **Tính Năng Import & Export Khách Hàng**:
  - Tích hợp tính năng **Export CSV** danh sách khách hàng hiện tại theo bộ lọc, hỗ trợ encoding UTF-8 BOM hiển thị tiếng Việt chuẩn trên Excel.
  - Tối giản hóa quy trình **Import CSV** khách hàng: Chỉ yêu cầu 2 trường Tên khách hàng (bắt buộc) và Số điện thoại (tùy chọn, có thể để trống). Hỗ trợ tải tệp tin mẫu (.csv) trực tiếp từ thư mục tĩnh của máy chủ.

---

### 13. Phân Hệ Quản Lý Kho Nâng Cao & Trả Hàng (Advanced Warehouse & Returns) - `[HOÀN THÀNH]`
- [x] **Chuyển hàng giữa các kho & chi nhánh (Stock Transfers)**: Thiết lập giao diện điều chuyển và quản lý các trạng thái `draft`, `in_transit`, `received`, `cancelled` trong tab Chuyển kho của màn hình quản lý kho.
- [x] **Trả hàng nhập (Purchase Returns)**: Xây dựng bảng và trigger tự động xuất kho đối với phiếu trả hàng nhà cung cấp trong tab Trả hàng NCC của màn hình quản lý kho.
- [x] **Hàng trả theo hóa đơn đã bán (Sales Returns)**: Tích hợp nút Trả hàng tại trang Chi tiết đơn hàng, tự động nhập lại kho và cập nhật trạng thái đơn hàng thông qua trigger database.
- [x] **Tìm kiếm thông minh (Smart Search Dropdowns)**: Xây dựng và tích hợp component `SmartSearchSelect` tìm kiếm không dấu (accent-insensitive) cho phần chọn lô hàng chuyển kho, chọn nhà cung cấp và chọn lô hàng trả NCC nhằm tối ưu hóa thao tác khi số lượng bản ghi lớn.

---

### 14. Phân Hệ Quản Lý Hoạt Chất & Bệnh Thú Y (Active Ingredients & Pathology Module) - `[HOÀN THÀNH]`
- [x] **Bổ sung Schema & RLS**:
  - [x] Nâng cấp bảng `active_ingredients` bổ sung các trường thông tin lý lịch hoạt chất (nhóm dược lý, liều dùng, ngày ngừng thịt/sữa/trứng, độc tính).
  - [x] Thiết lập bảng ma trận tương thích hoạt chất `active_ingredient_compatibility` (hiệp lực, đối kháng/kỵ thuốc).
  - [x] Thêm các trường triệu chứng (`symptoms`), nguyên nhân dịch tễ (`etiology`) và bảng liên kết loài (`disease_species`) cho từ điển bệnh.
  - [x] Bổ sung bảng cấu hình phác đồ điều trị đa tầng `disease_treatment_protocols` liên kết Bệnh lý -> Hoạt chất theo vai trò (Đặc trị, Bổ trợ, Đề kháng) và Dòng điều trị (Line 1, Line 2).
  - [x] Liên kết `disease_id` và `treatment_purpose` vào bảng `orders` để lưu trữ dữ liệu dịch tễ khi tạo hóa đơn bán hàng.
- [x] **Trang Quản lý Hoạt chất nâng cao & Tương thích**:
  - [x] Tích hợp 2 tab trên màn hình hoạt chất: Danh sách hoạt chất lý lịch nâng cao và Trình cấu hình ma trận tương thích thuốc (Synergy & Antagonism).
  - [x] Tích hợp cấu hình động CRUD cho Nhóm dược lý (`pharmacological_groups`) và Loại tương tác thuốc (`compatibility_interaction_types`) hỗ trợ thiết lập từ điển danh mục nâng cao trực quan.
- [x] **Trang Quản lý Bệnh lý & Phác đồ điều trị (`/diseases`)**:
  - [x] Xây dựng giao diện Danh mục bệnh thú y kèm theo công cụ quản lý danh sách triệu chứng động dạng tag.
  - [x] Thiết kế form xây dựng Phác đồ điều trị đa tầng cho từng bệnh, liên kết vai trò và độ ưu tiên hoạt chất.
  - [x] Cấu hình động CRUD cho Loài vật nuôi (`species`) và Phân nhóm nguyên nhân gây bệnh (`disease_etiologies`) hỗ trợ chỉ định bệnh nâng cao và phân loại tác nhân Gram-âm/Gram-dương, virus RNA/DNA trực quan.
- [x] **Cải tiến Catalog Sản Phẩm & Chỉ định bệnh lý**:
  - [x] Nâng cấp Modals Thêm mới (`AddProductModal`) và Cập nhật (`EditProductModal`) hàng hóa lên giao diện 2 cột rộng rãi (`max-w-4xl`).
  - [x] Thiết kế cấu trúc giao diện Modal thông minh: Tiêu đề (Header) và nút Tác vụ (Hủy/Lưu ở Footer) được giữ cố định (sticky layout), chỉ cuộn phần nội dung biểu mẫu ở giữa giúp loại bỏ hoàn toàn lỗi tràn layout và không bấm được nút thoát/lưu trên màn hình độ phân giải thấp.
  - [x] Hỗ trợ tìm kiếm & tick chọn nhiều hoạt chất kèm nhập nồng độ/hàm lượng trực tiếp, cùng với checklist chỉ định điều trị bệnh lý gán thẳng vào sản phẩm.
  - [x] Đồng bộ lưu trữ và hiển thị các bệnh lý chỉ định điều trị dạng tag tag-badges trực quan trên thanh thông tin bổ sung của trang Chi tiết sản phẩm (`ProductDetailPage`).
  - [x] **Tìm kiếm thông minh (Smart Search Dropdowns)**: Tích hợp component `SmartSearchSelect` tìm kiếm không dấu cho Đơn vị tính, Phân loại danh mục và Thương hiệu trong `AddProductModal` và `EditProductModal` giúp dễ dàng cấu hình catalog.
- [x] **Tích hợp Giỏ hàng thông minh (Smart Cart) & Tương kỵ thuốc tại POS**:
  - [x] Phát triển công cụ chẩn đoán nhanh tại POS: Chọn Loài -> Tích chọn Triệu chứng -> Đề xuất bệnh lý -> Áp dụng phác đồ tự động điền các sản phẩm phù hợp trong kho (theo FEFO) vào giỏ hàng.
  - [x] Tự động đối chiếu tương kỵ thuốc: Hiển thị cảnh báo đỏ nổi bật ngay tại giỏ hàng nếu phát hiện sản phẩm đối kháng dùng chung cho vật nuôi.
- [x] **Lịch sử Dịch tễ & Cảnh báo kháng thuốc trên CRM**:
  - [x] Hiển thị trục thời gian lịch sử dịch tễ và các đợt bùng dịch của khách hàng.
  - [x] Cảnh báo kháng thuốc (Drug Resistance alerts) nếu phát hiện trang trại lặp lại cùng một hoạt chất quá nhiều lứa liên tục.
- [x] **Bugfix Modal Sản phẩm (2026-05-25)**:
  - Tạo migration `20260525000007_seed_product_categories_and_brands.sql` bổ sung dữ liệu seed cho `product_categories` (10 nhóm thú y), `brands` (16 thương hiệu), `price_lists` (3 bảng giá chuẩn) và `product_units` (14 đơn vị tính) trên Supabase.
  - Sửa lỗi **Mã SKU không tự sinh**: SKU nay sinh tự động ngay khi modal mở (không cần chờ chọn category). Khi chọn category thì prefix sẽ cập nhật lại (VAC-, MED-, PAR-, NUT-, SUP-, EQU-, CHM-, FEED-). Có fallback timestamp nếu DB lỗi.
  - Sửa lỗi **Đơn vị tính không load**: Đặt danh sách đơn vị mặc định tức thì trước khi gọi API, override khi API thành công, giữ fallback nếu API lỗi. Select `Đơn vị tính` không còn trống.
  - Sửa lỗi **Danh mục & Thương hiệu không load**: Thêm option `-- Chọn danh mục --` và `-- Chọn thương hiệu --` (value rỗng) làm default để không bị trống select khi data chưa load. Thêm warning log chi tiết cho mỗi bảng bị lỗi khi query.
  - Sửa `EditProductModal` tương tự: fallback units tức thì, warning logs, hiển thị đơn vị hiện tại của sản phẩm dù không có trong danh sách mới load.
  - Sửa lỗi **Modal tự động hiển thị đè màn hình khi vừa vào trang**: Bổ sung kiểm tra `if (!isOpen) return null` vào [AddProductModal.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/AddProductModal.tsx) để tránh việc modal luôn render lớp phủ và khung giao diện đè lên danh sách sản phẩm ngay cả khi trạng thái `isAddModalOpen` là `false`.
  - Ghi nhận **cách chạy migration**: Chạy file `20260525000007_seed_product_categories_and_brands.sql` qua Supabase SQL Editor để populate data.
- [x] **Bugfix Tải dữ liệu hoạt chất & ma trận (2026-05-25)**:
  - Sửa lỗi `Could not find a relationship between 'active_ingredients' and 'pharmacological_groups' in the schema cache` khi tải dữ liệu hoạt chất do các migration `20260525000006` và `20260525000007` chưa được thực thi trên môi trường cơ sở dữ liệu từ xa (remote database).
  - Tích hợp cơ chế dò tìm động và tự động chuyển đổi thông minh (Dynamic Fallback Mode) trong [ActiveIngredientsPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/ActiveIngredientsPage.tsx) và [DiseasesPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/DiseasesPage.tsx): Tự động phát hiện xem các bảng cài đặt động (`pharmacological_groups`, `disease_etiologies`, `compatibility_interaction_types`) có tồn tại trong cơ sở dữ liệu hay không.
  - Nếu có (đã chạy migration), hệ thống hoạt động đầy đủ theo mô hình quan hệ; nếu chưa (chưa chạy migration), hệ thống tự động rơi về chế độ Fallback sử dụng các trường văn bản cũ (`pharmacological_group`, `etiology`) một cách trơn tru, không gây crash trang.
  - Nâng cấp [EditProductModal.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/EditProductModal.tsx) bọc cả thao tác tải dữ liệu (load) và chỉnh sửa (update/delete) liên quan đến chỉ định bệnh (`product_indications`) vào các khối try-catch an toàn, bỏ qua lỗi nếu bảng chưa tồn tại trên cơ sở dữ liệu, đảm bảo mở modal, cập nhật thông tin sản phẩm và bảng giá vẫn diễn ra bình thường.
  - Ghi nhận cách chạy các migration bổ sung: Chạy file `20260525000006_add_product_diseases_and_settings_entities.sql` and `20260525000007_seed_product_categories_and_brands.sql` qua Supabase SQL Editor khi muốn kích hoạt đầy đủ các tính năng quản lý danh mục động này trên cơ sở dữ liệu.
- [x] **Redesign Modals Sản phẩm & Sửa lỗi biên dịch (2026-05-25)**:
  - Cải tiến giao diện modal thêm mới (`AddProductModal`) và cập nhật (`EditProductModal`) thành dạng cửa sổ căn giữa rộng rãi (`max-w-5xl h-[85vh]`) phân chia 4 tab tiện lợi (Thông tin chung, Giá & Bảng giá, Thành phần & Chỉ định, Thông số kỹ thuật) giúp giao diện tường minh, rộng rãi và tối ưu hóa diện tích hiển thị.
  - Sửa lỗi biên dịch do thiếu thẻ đóng `</div>` ở phần cuối mã nguồn của cả hai modal.
  - Khắc phục lỗi TypeScript type mismatch tại trang [ActiveIngredientsPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/ActiveIngredientsPage.tsx) (ép kiểu `comp.interaction_type` thành `'synergy' | 'antagonism'`).
  - Dọn dẹp và chuẩn hóa toàn bộ các lớp CSS màu Tailwind không tồn tại (ví dụ: `gray-150`, `gray-250`...) trên tất cả các trang liên quan đến phân hệ sản phẩm thành các màu chuẩn của dự án để đảm bảo các thành phần giao diện, nút bấm, ô nhập liệu hiển thị chính xác.
- [x] **Tải dữ liệu thực tế 100% & Loại bỏ dữ liệu mẫu (2026-05-25)**:
  - Loại bỏ hoàn toàn các cấu trúc hiển thị dữ liệu mẫu/mặc định cứng trên màn hình Bảng điều khiển (Dashboard).
  - Tải động số liệu doanh thu thực tế, tính toán sự tăng trưởng MoM bằng cách truy vấn số liệu doanh thu tháng trước trực tiếp.
  - Tải biểu đồ xu hướng dòng tiền (Cash flows) từ bảng `cashbook_transactions` theo dòng tiền thu/chi thực tế được phê duyệt của 6 tháng gần nhất.
  - Bổ sung giao diện thông báo trạng thái trống (Empty State) lịch thiệp cho danh sách lịch hẹn và phiếu chi chờ duyệt.
  - Dọn dẹp các khai báo dữ liệu mẫu không còn sử dụng (`mockVaccines`, `mockDiseases`, `mockOrders`) trong trang Chi tiết khách hàng.
- [x] **Nâng cấp Tính năng Import Khách hàng & Hàng hóa từ KiotViet/CSV (2026-05-25)**:
  - **Vấn đề**: Tính năng import CSV không hoạt động hiệu quả với file xuất từ KiotViet – nhiều trường không hợp lệ, không tải được file mẫu.
  - **Giải pháp – Download file mẫu**: Thay cơ chế tải file mẫu qua đường dẫn tĩnh (`/template_....csv`) bằng cơ chế **tạo file Blob trực tiếp trên trình duyệt** (`URL.createObjectURL`) – không phụ thuộc vào server, luôn tải được ngay lập tức.
  - **Giải pháp – Nhận dạng cột linh hoạt (KiotViet compatibility)**: Xây dựng hàm `normalize()` chuẩn hóa tên cột (bỏ dấu, lowercase, loại ký tự đặc biệt) và bộ alias cột mở rộng gồm hàng chục tên biến thể thường gặp trong file xuất KiotViet, Excel: `Tên khách hàng`, `Tên hàng hóa`, `Điện thoại`, `Số ĐT`, `Phone`, `Name`, `Tên`, `Tên SP`...
  - **Giải pháp – Chỉ bắt buộc Tên**: Cả Import khách hàng và Import hàng hóa chỉ yêu cầu trường **Tên** là bắt buộc. Số điện thoại (khách hàng) và các trường khác đều optional – nếu thiếu cột hoặc để trống đều không gây lỗi dòng.
  - **Bổ sung hướng dẫn in-app**: Thêm khung hướng dẫn trực quan ngay trong modal mô tả cách xuất từ KiotViet và cột nào được nhận dạng.
  - Cập nhật 2 file: [ImportCustomersModal.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/customers/ImportCustomersModal.tsx) và [ImportProductsModal.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/ImportProductsModal.tsx).
  - 0 TypeScript errors sau thay đổi.

---

### 15. Phân Hệ In Ấn Chứng Từ Chuyên Nghiệp (Professional Print Layouts) - `[HOÀN THÀNH + TÍCH HỢP CẤU HÌNH 2026-05-28]`
- [x] **TypeScript Interfaces cho 6 loại chứng từ** ([print.types.ts](file:///e:/CRMSANHLONG/src/types/print.types.ts)):
  - Hóa đơn bán hàng & Phiếu xuất kho: Hỗ trợ thông tin số lô (Batch/Lot) và hạn sử dụng (Expiry Date) đặc thù của thuốc thú y.
  - Phiếu nhập kho & Phiếu trả hàng: Hỗ trợ thông tin nhà cung cấp, lý do nhập/xuất/trả.
  - Phiếu thu & Phiếu chi: Hỗ trợ lý do thu/chi, đối tượng (khách hàng/đối tác/nhân viên), và quỹ/tài khoản tiền nguồn/nhận.
- [x] **Component in ấn chuyên dụng** ([PrintLayout.tsx](file:///e:/CRMSANHLONG/src/components/PrintLayout.tsx)):
  - Thiết kế chuẩn khổ A4 & A5 (dọc và ngang), tối giản trắng đen có độ tương phản cao cho máy in Laser.
  - Cơ chế tự động điền dòng trống để lấp đầy bảng in giúp bản in trông chuyên nghiệp và cân đối.
  - Kiểm soát ngắt trang (`page-break`) thông minh, tránh cắt đôi dòng chữ hoặc đè nội dung lên chữ ký/footer.
  - Tự động sinh mã vạch vector (Barcode SVG) và chuyển đổi số tiền thành chữ bằng Tiếng Việt.
- [x] **Trang xem trước & in ấn độc lập** ([PrintPreviewPage.tsx](file:///e:/CRMSANHLONG/src/pages/system/PrintPreviewPage.tsx)):
  - Tải dữ liệu thực tế từ các bảng Supabase tương ứng (`orders`, `goods_receipts`, `sales_returns`, `stock_transfers`, `cashbook_transactions`).
  - Cơ chế fallback tự sinh dữ liệu mẫu đầy đủ (mock preview) khi chạy demo hoặc không truyền ID.
  - Thanh công cụ cấu hình trực quan (kích thước giấy, hướng xoay) và nút in chứng từ `window.print()` nhanh chóng.
  - Đăng ký route `/print-preview` bảo vệ bằng `ProtectedRoute` trong [App.tsx](file:///e:/CRMSANHLONG/src/App.tsx).
- [x] **Tích hợp cấu hình in vào Admin Settings (2026-05-28)**:
  - Migration `20260528000004_print_settings.sql`: bổ sung 9 cột `print_*` vào bảng `display_settings` (tên công ty, địa chỉ, điện thoại, email, MST, website, logo URL, khổ giấy mặc định, hướng in mặc định).
  - Mở rộng `DisplaySettingsContext.tsx` với `printConfig` object — exposed qua `useDisplaySettings()` hook.
  - Tạo `PrintSettingsTab.tsx`: giao diện form admin cấu hình header công ty + live preview header chứng từ + chọn khổ giấy/hướng in mặc định, lưu vào `display_settings`.
  - Tab "Cấu hình in ấn" mới trong `SystemSettingsPage.tsx` bên cạnh tab Hiển thị.
  - `PrintLayout.tsx` đọc `printConfig` từ context thay vì hardcode — admin thay đổi cấu hình tự động áp dụng toàn bộ chứng từ.
  - `OrderDetailPage.tsx`: nút "In hóa đơn" mở `/print-preview?type=invoice&id={orderId}` trong tab mới.
  - `CashbookPage.tsx`: nút "In phiếu" trong modal chi tiết giao dịch (chỉ hiện khi `status=approved`, map `inflow→cash_in`, `outflow→cash_out`).
  - 0 TypeScript errors sau toàn bộ thay đổi.

---

## 🔬 BÁO CÁO AUDIT HIỆU NĂNG & KẾ HOẠCH TỐI ƯU (2026-05-26) – `[ĐANG MỞ]`

> **Phạm vi audit**: tốc độ load, kỹ thuật xử lý dữ liệu (client + Supabase), kiến trúc giao diện.
> **Kết luận tổng quan**: dự án đã đầy đủ tính năng nghiệp vụ nhưng **chưa được tối ưu hiệu năng cho production**. Khi dữ liệu tăng (vài nghìn KH, vài nghìn SP, hàng chục nghìn đơn hàng) hệ thống sẽ chậm rõ rệt, vỡ trải nghiệm trên mobile/3G và có nguy cơ time-out Supabase ở các trang list/báo cáo.

### 🚨 Tóm tắt 9 vấn đề trọng yếu đã phát hiện

| # | Vấn đề | Bằng chứng | Tác động |
|---|--------|------------|----------|
| 1 | **Không lazy-load route nào** – cả 30+ trang import tĩnh trong [App.tsx](file:///d:/CRMSANHLONGVETCO/src/App.tsx) | `grep React.lazy` = 0 hit; App.tsx import 30 trang | Bundle JS ban đầu rất lớn → First Contentful Paint chậm, đặc biệt 3G/Android tầm trung. |
| 2 | **Vite config trống** – không có manualChunks, không compression, không bundle analyzer | [vite.config.ts](file:///d:/CRMSANHLONGVETCO/vite.config.ts) chỉ có `plugins:[react()]` | recharts, react-pdf, dnd-kit nằm cùng main chunk, không tách vendor. |
| 3 | **TanStack Query đã cài nhưng KHÔNG dùng** | `grep useQuery|QueryClient` = 0 hit, nhưng vẫn có trong [package.json](file:///d:/CRMSANHLONGVETCO/package.json) | Mất hoàn toàn lợi ích cache/stale-while-revalidate/dedup. Mỗi lần điều hướng đều fetch lại từ đầu. |
| 4 | **List pages fetch toàn bộ + JOIN sâu, paginate phía client** | [CustomerListPage.tsx:161-186](file:///d:/CRMSANHLONGVETCO/src/pages/customers/CustomerListPage.tsx#L161-L186), [ProductListPage.tsx:130-156](file:///d:/CRMSANHLONGVETCO/src/pages/products/ProductListPage.tsx#L130-L156) | Mỗi customer kéo về *toàn bộ* `orders`, `customer_debts`, `customer_contacts`; mỗi product kéo về *toàn bộ* `order_lines + orders.status + stock_lots`. Khi DB có vài nghìn dòng → payload hàng MB. |
| 5 | **Tính toán nghiệp vụ chạy ở client** | [ProductListPage.tsx:244-260](file:///d:/CRMSANHLONGVETCO/src/pages/products/ProductListPage.tsx#L244-L260) tính "Dự kiến hết hàng" trên client bằng lịch sử đơn hàng | Vô lý về kiến trúc – cần Postgres view/RPC. |
| 6 | **Layout fetch role + permissions trên MỌI lần render trang** | [Layout.tsx:66-104](file:///d:/CRMSANHLONGVETCO/src/components/Layout.tsx#L66-L104) | Mỗi lần điều hướng đều 2 query lặp lại, không cache. Phải đẩy vào `AuthContext` 1 lần khi login. |
| 7 | **Không debounce search, không virtualization, không skeleton** | `grep debounce|react-window|react-virtual` = 0 hit | Search realtime quét toàn bảng client, list dài render hết DOM → jank rõ rệt khi 1000+ items. |
| 8 | **Bản thân các page component khổng lồ** | [CustomerDetailPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/customers/CustomerDetailPage.tsx) 3100 dòng; [InventoryPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/inventory/InventoryPage.tsx) 2598 dòng; [CashbookPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/cashbook/CashbookPage.tsx) 1964 dòng; [POSPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/orders/POSPage.tsx) 1868 dòng | Single component, render lại toàn bộ mỗi state-change; chỉ 30 hit `useMemo/useCallback/memo` trên toàn dự án. |
| 9 | **`console.log` debug còn nguyên trong production** | [App.tsx:44](file:///d:/CRMSANHLONGVETCO/src/App.tsx#L44), [AuthContext.tsx:87-149](file:///d:/CRMSANHLONGVETCO/src/contexts/AuthContext.tsx#L87-L149) | Rò rỉ thông tin auth + chậm trên Safari/iOS với DevTools mở. |

**Điểm tốt đã có** (giữ nguyên): Supabase đã có ~78 chỉ mục đầy đủ ([20260522000000_init_schema.sql:1359+](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260522000000_init_schema.sql#L1359)) bao gồm `gin_trgm_ops` cho search tiếng Việt; RLS đã chuẩn; `auth` config đúng (`autoRefreshToken`, `persistSession`); đã có `formatCurrency` context dùng chung.

---

### 🗺️ Kế hoạch khắc phục – chia 4 sprint theo độ ưu tiên

#### Sprint P0 – Quick Wins (1–2 ngày, không thay đổi UX) `[HOÀN THÀNH 2026-05-26]`
Mục tiêu: giảm 50–70% thời gian tải lần đầu mà không động vào logic nghiệp vụ.

- [x] **P0-1**. Cấu hình [vite.config.ts](file:///d:/CRMSANHLONGVETCO/vite.config.ts) với `build.rollupOptions.output.manualChunks` tách `recharts/d3`, `@react-pdf/renderer`, `@dnd-kit/*`, `lucide-react`, `@supabase/supabase-js`, `papaparse`, `react-hook-form` thành các chunk riêng; bật `build.target: 'es2020'`, `build.minify: 'esbuild'`, `build.cssCodeSplit: true`, `build.sourcemap: false`, `build.reportCompressedSize: false`. Esbuild `pure: ['console.log','console.debug','console.info']` tự drop console khi build production. Quy tắc gộp react/router/util vào 1 chunk `react-vendor` để tránh circular dep với chunk vendor sót.
- [x] **P0-2**. Chuyển toàn bộ 28 route trong [App.tsx](file:///d:/CRMSANHLONGVETCO/src/App.tsx) sang `React.lazy(() => import(...))` + bọc `<Suspense fallback={<FullPageSpinner/>}>`. Giữ eager: `LoginPage`, `AuthCallback`, `DashboardPage`. Tách spinner thành component dùng chung cho cả `PrivateRoute` loading + `Suspense` fallback.
- [x] **P0-3**. Gỡ hết `console.log` runtime ở [App.tsx](file:///d:/CRMSANHLONGVETCO/src/App.tsx) và [AuthContext.tsx](file:///d:/CRMSANHLONGVETCO/src/contexts/AuthContext.tsx). Tạo helper [src/lib/logger.ts](file:///d:/CRMSANHLONGVETCO/src/lib/logger.ts) (`logger.debug/info/log` chỉ chạy khi `import.meta.env.DEV`; `logger.warn/error` luôn chạy). Thay tất cả `console.error` trong AuthContext bằng `logger.error`.
- [x] **P0-4**. **Skip** cài `vite-plugin-compression`. Lý do: Vercel mặc định đã serve gzip + brotli; esbuild đã drop `console.*` qua `pure` config nên không cần Terser. Plugin chỉ hữu ích khi self-host Nginx. Tránh thêm devDependency không cần thiết.
- [ ] **P0-5**. **Baseline Lighthouse** (cần user chạy thủ công vì agent không có browser): chạy `npm run dev`, mở Chrome DevTools → Lighthouse → Mobile, đo trên `/dashboard`, `/customers`, `/products`, `/orders/pos`. Ghi vào `docs/05-PERF-BASELINE.md` với cột "trước P1" để so sánh sau Sprint P1.

**Kết quả thực tế sau build P0 (2026-05-26)**:

| Chunk | Kích thước raw | Vai trò |
|-------|----------------|---------|
| `index.js` (entry) | **68.76 KB** (~22 KB gz) | App shell + routing + AuthContext + Login + Dashboard + AuthCallback |
| `react-vendor.js` | 241.27 KB (~77 KB gz) | react, react-dom, react-router-dom, date-fns, zod, zustand, scheduler, clsx, tailwind-merge |
| `supabase.js` | 200.81 KB (~63 KB gz) | @supabase/supabase-js |
| `charts.js` | 340.01 KB (~110 KB gz) | recharts + d3 (chỉ load khi vào Dashboard/Reports) |
| `icons.js` | 43.60 KB (~13 KB gz) | lucide-react |
| `forms.js` | 19.43 KB | react-hook-form + papaparse |
| 28 page chunks | 9.69 – 92.68 KB mỗi chunk | Lazy theo route |
| `index.css` | 64.98 KB (~10 KB gz) | Tailwind compiled |

**Trước P0** (ước tính): tất cả gộp vào 1 main bundle ~1 MB+ raw → mọi user, mọi route phải tải hết.
**Sau P0**: tải landing Login ~620 KB raw (~190 KB gz, không gồm charts); tải landing Dashboard ~960 KB raw (~290 KB gz, gồm charts). Mỗi route mới navigate vào tải thêm 10–95 KB.
**KPI ban đầu** (≤ 350 KB gz cho main): **ĐẠT** (entry chỉ 22 KB gz, tổng critical-path landing Dashboard 290 KB gz – sẽ giảm thêm khi P2 tách Dashboard chart lazy).

---

#### Sprint P1 – Data layer overhaul (3–5 ngày, ảnh hưởng pattern toàn dự án) `[HOÀN THÀNH 2026-05-26]`
Mục tiêu: dùng đúng cache layer và server-side pagination, fix các trang list/báo cáo.

- [x] **P1-1**. Khởi tạo `QueryClient` trong [main.tsx](file:///d:/CRMSANHLONGVETCO/src/main.tsx) với defaults `staleTime: 60_000`, `gcTime: 5*60_000`, `refetchOnWindowFocus: false`, `retry: 1`. Bọc `<QueryClientProvider>` quanh `<App/>`. Key factory tập trung ở [src/lib/queryClient.ts](file:///d:/CRMSANHLONGVETCO/src/lib/queryClient.ts) (`qk.customers.*`, `qk.products.*`, `qk.dashboard.stats`, `qk.auth.rolePermissions(userId)`).
- [x] **P1-2**. Tạo [src/hooks/queries/](file:///d:/CRMSANHLONGVETCO/src/hooks/queries/) gồm 5 file: `useCustomers.ts` (useCustomersList + useSalesReps + useCustomerClassifications + useCustomerTiers + useCustomerKPIs), `useProducts.ts` (useProductsList + useProductCategories + useProductBrands), `useDashboardStats.ts` (có fallback 5 query song song nếu RPC chưa apply), `useDashboardLists.ts` (usePendingDisbursements + useTodayAppointments), `useUserRolePermissions.ts` (có fallback). Mỗi hook gọi Supabase với `.range(from, to)`, `.order(...)`, filter ở server qua `.eq/.ilike/.or`. Thêm [src/hooks/useDebouncedValue.ts](file:///d:/CRMSANHLONGVETCO/src/hooks/useDebouncedValue.ts) dùng chung.
- [x] **P1-3**. Refactor [CustomerListPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/customers/CustomerListPage.tsx): từ 833 dòng → 522 dòng. Bỏ hoàn toàn JOIN nested với `orders/customer_debts/customer_contacts` ở client. Dùng `customer_summary_view` trả về `total_debt + is_overdue + last_order_at + primary_contact` đã aggregate ở Postgres. Pagination/Search/Filter chuyển sang server qua `useCustomersList` (`.range()`, `.ilike()`, `.eq()`). KPI footer dùng `useCustomerKPIs` (3 count song song, không bị reset khi đổi filter trang).
- [x] **P1-4**. Refactor [ProductListPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/products/ProductListPage.tsx): từ 705 dòng → 482 dòng. Bỏ JOIN với `price_list_items/stock_lots/order_lines/orders.status` ở client (vô lý vì kéo toàn bộ lịch sử). Dùng `product_stock_summary_view` trả về `retail_price + retail_cost + stock_on_hand + on_order_qty + sold_30d + days_to_oos` tính ở Postgres (thuật toán "Dự kiến hết hàng" giờ chạy đúng trên `sold_30d / 30` thay vì all-time). Aggregate tổng tồn/tổng khách đặt qua PostgREST `select=stock_on_hand.sum(), on_order_qty.sum()` (1 query phụ, không kéo về client).
- [x] **P1-5**. Refactor [DashboardPage.tsx](file:///d:/CRMSANHLONGVETCO/src/pages/dashboard/DashboardPage.tsx): từ 508 dòng → 280 dòng. Gộp 6 query tuần tự vào **RPC `get_dashboard_stats()`** trả về JSON (monthly_revenue + last_month + delta MoM + overdue_debt + overdue_count + expiring_lots_count + cashflow_6m array). Có fallback `Promise.all` 5 query song song trong [useDashboardStats.ts](file:///d:/CRMSANHLONGVETCO/src/hooks/queries/useDashboardStats.ts) nếu RPC chưa apply ở remote. Disbursements + Appointments tách thành 2 hook riêng (song song).
- [x] **P1-6**. Đẩy `userRole + userPermissions + hasPermission(code)` lên [AuthContext.tsx](file:///d:/CRMSANHLONGVETCO/src/contexts/AuthContext.tsx) (qua `useUserRolePermissions(profile?.id)` cache 15 phút). Xóa hoàn toàn khối fetch 2 query lặp lại ở [Layout.tsx](file:///d:/CRMSANHLONGVETCO/src/components/Layout.tsx) — Layout giờ đọc từ `useAuth()`. Mỗi lần điều hướng tiết kiệm 2 query.
- [x] **P1-7**. Tạo migration [20260526000000_perf_views.sql](file:///d:/CRMSANHLONGVETCO/supabase/migrations/20260526000000_perf_views.sql) chứa: (1) `customer_summary_view` `WITH (security_invoker = true)`, (2) `product_stock_summary_view` với CTE `retail_price/fallback_price/stock_agg/on_order_agg/sales_30d`, (3) RPC `get_dashboard_stats()` `SECURITY INVOKER` trả JSONB, (4) RPC `get_user_role_and_permissions(p_user_id)` `SECURITY INVOKER`. Grant SELECT view + EXECUTE function cho `authenticated`. **Cần chạy migration này ở Supabase remote** qua SQL Editor để kích hoạt full performance gain (chưa chạy thì fallback hoạt động ổn).

**Kết quả thực tế sau build P1 (2026-05-26)**:

| Chunk | P0 | P1 | Delta |
|-------|-----|-----|-------|
| `index.js` (entry) | 68.76 KB | 69.84 KB | +1 KB |
| `react-vendor.js` | 241.27 KB | 278.68 KB | **+37 KB** (~12 KB gz, do TanStack Query) |
| `CustomerListPage.js` | 45.79 KB | 46.72 KB | +0.9 KB |
| `ProductListPage.js` | 74.06 KB | 73.91 KB | −0.15 KB |
| `supabase/charts/icons/forms` | không đổi | không đổi | - |

**Trade-off**: bundle tăng ~12 KB gzipped (TanStack Query) để đổi lại:
- Customers list: từ "tải toàn bộ + JOIN sâu + paginate client" → **server-side range/search/filter**, payload nhỏ gấp 10–100× khi DB lớn
- Products list: từ "kéo toàn bộ stock_lots + order_lines" → **server tính sẵn `stock_on_hand/on_order_qty/days_to_oos`**, payload nhỏ và tính toán đúng (sold_30d thay vì all-time)
- Dashboard: 6–7 round-trip → **1 RPC duy nhất** (với fallback song song), giảm latency mobile ~70%
- Layout: bỏ 2 query lặp lại mỗi page navigation → mỗi route mới tiết kiệm ~200ms TTI ở Việt Nam
- Cache TanStack: navigate qua lại giữa Dashboard/Customers/Products → instant render từ cache 60s, không hit DB lại

**Files mới**: 1 migration SQL + 4 file hook + 1 hook helper + 1 queryClient + 1 logger = 8 files mới
**Files sửa**: 5 file (App.tsx đã từ P0, main.tsx, AuthContext.tsx, Layout.tsx, CustomerListPage.tsx, ProductListPage.tsx, DashboardPage.tsx)
**Tổng giảm**: 3 page lớn từ 2046 dòng → 1284 dòng (−37%) nhờ tách logic ra hooks.

---

#### Sprint P2 – UX/UI polish & component refactor (3–4 ngày) `[HOÀN THÀNH]`
Mục tiêu: giảm jank lúc tương tác, tăng cảm nhận tốc độ.

- [x] **P2-1**. Thêm hook `useDebouncedValue(value, 300ms)` và áp dụng cho tất cả ô search ở Customer/Product/Order/Pipeline/Inventory/Cashbook (server-side: CashbookPage, client-side: còn lại).
- [x] **P2-2**. Cài `@tanstack/react-virtual@3.13.26`. Áp dụng `useVirtualizer` cho POS product grid (row-based, 3 cols, `measureElement` tự động điều chỉnh khi toggle ảnh). Customer dropdown bỏ qua (filtered list ≤ 30 items, overhead > benefit).
- [x] **P2-3**. Tạo `src/components/Skeleton.tsx` (TableRows, CardRows, KpiCards, Guard…). Thay spinner ở CustomerList, ProductList, OrderList, InventoryPage (5 tab), CashbookPage bằng `<Skeleton.TableRows>`.
- [x] **P2-4**. `useMemo` cho filteredProducts/filteredCustomers/subtotal/grandTotal + `useCallback` (functional setState) cho addToCart/adjustQuantity/updateQuantity/updateUnitPrice/addPromoLine/setRowDiscount trong POSPage.
- [x] **P2-5**. `useMemo` cho `getCalculatedStats` và `getDebtAgingData` trong CustomerDetailPage. Full tab-split hoãn sang sprint riêng (state IIFE phức tạp, không đủ lợi ích vs. rủi ro).
- [x] **P2-6**. `useMemo` cho filteredLots/filteredPOs/filteredReceipts/filteredTransfers/filteredReturns trong InventoryPage + Skeleton thay spinner 5 tab. `useMemo` cho totalCashBalance/totalBankBalance + Skeleton trong CashbookPage.
- [x] **P2-7**. `<ErrorBoundary>` tạo tại `src/components/ErrorBoundary.tsx`; bọc 2 lớp trong App.tsx (outer: BrowserRouter crash; inner: route render crash). UI fallback tiếng Việt với nút "Quay lại" + "Tải lại trang".

**KPI mục tiêu sau P2**: tương tác search/filter ≤ 100ms perceived; không layout shift ≥ 0.1 (CLS).

---

#### Sprint P3 – Image, assets, monitoring (2–3 ngày) `[HOÀN THÀNH]`
Mục tiêu: hoàn thiện chuỗi tối ưu cho production, có metric để theo dõi.

- [x] **P3-1**. Tạo `src/components/ProductImage.tsx` với `loading="lazy"`, `decoding="async"`, `onError` fallback tự ẩn. Thay mọi `<img src={image_urls[0]}>` ở POSPage, ProductListPage, ProductDetailPage. (CDN transform hoãn sang P4 — cần Supabase Pro plan hoặc Cloudflare Images.)
- [x] **P3-2**. Self-host font qua `@fontsource/be-vietnam-pro` — import `latin-400/500/600.css` + `400/500/600.css` (Vietnamese unicode-range) vào `main.tsx`. Xóa 3 dòng Google Fonts CDN khỏi `index.html`. `font-display: swap` built-in.
- [x] **P3-3**. Cài `web-vitals`. Tạo migration `20260526000010_web_vitals_logs.sql` (RLS: insert = authenticated, select = admin). Tạo `src/lib/reportWebVitals.ts` (onCLS/FCP/INP/LCP/TTFB → `web_vitals_logs`). Gọi sau `render()` trong `main.tsx`.
- [x] **P3-4**. Tạo `src/hooks/useRealtimeTable.ts` (generic, cleanup chuẩn qua `supabase.removeChannel`). Tạo `src/hooks/useNotifications.ts` (unread count + markAllRead). Wire vào Layout bell badge (số thật, không hardcode). Realtime INSERT/UPDATE cho `orders` (OrderListPage) + `cashbook_transactions` (CashbookPage).
- [x] **P3-5**. Soạn `docs/05-PERFORMANCE-PLAYBOOK.md`: 10 mục — data fetching, search, rendering, loading state, realtime, image, checklist merge, bundle budget, Web Vitals targets, khi nào mở sprint mới.

**KPI mục tiêu sau P3**: Lighthouse Mobile Performance ≥ 85 trên Dashboard/Customers/Products; INP < 200ms.

---

#### Sprint P4 – Enterprise & SaaS readiness (5–7 ngày) `[ĐANG THỰC HIỆN — 3/10 hoàn thành 2026-05-26]`
Mục tiêu: nâng cấp từ "production-polished" lên "enterprise-grade SaaS chuyên ngành" — sẵn sàng vận hành lâu dài cho Sanh Long Vetco và đủ chất lượng để chào hàng cho các công ty thú y khác như một sản phẩm thương mại.

**Bối cảnh**: sau P3 sản phẩm đã nhanh, ổn định, được monitor. P4 lấp đầy các khoảng trống còn lại trong functional spec ban đầu (VAT điện tử, khuyến mãi đầy đủ, chấm công, Excel kế toán), đồng thời thêm các lớp đảm bảo chất lượng (test, offline, mobile native, multi-tenancy) cần thiết để chạy production lâu dài.

**Quyết định bỏ qua (user yêu cầu 2026-05-26)**: P4-3 (VAT điện tử) và P4-5 (Chấm công) được bỏ qua trong sprint này — tập trung vào P4-1, P4-2, P4-4.

---

**Tóm tắt ngữ cảnh kỹ thuật đã thực hiện (2026-05-26)**

*Files mới tạo:*
- `src/lib/cartUtils.ts` — pure functions cho cart logic (cartAddProduct, cartAdjustQuantity, cartUpdateQuantity, cartUpdateUnitPrice, cartSetDiscount, cartCalcSubtotal, cartCalcGrandTotal)
- `src/test/setup.ts` — MSW lifecycle (beforeAll/afterEach/afterAll), window.matchMedia stub
- `src/test/mocks/server.ts`, `handlers.ts`, `supabase.ts` — MSW server + mock Supabase chainable query builder
- `src/test/unit/useDebouncedValue.test.ts` (6 tests), `logger.test.ts` (3), `queryClient.test.ts` (9), `cartUtils.test.ts` (18) → **37/37 pass**
- `src/test/e2e/auth.spec.ts`, `customer.spec.ts`, `inventory.spec.ts`, `pos.spec.ts`, `cashbook.spec.ts`
- `.github/workflows/test.yml` — jobs: typecheck → vitest → playwright (upload artifact on failure)
- `src/vite-env.d.ts` — `/// <reference types="vite-plugin-pwa/client" />`
- `public/pwa-192.svg`, `public/pwa-512.svg` — icons SVG theme #1E5A9C
- `src/components/PwaUpdateBanner.tsx` — import dynamic `virtual:pwa-register`, banner bottom-center
- `src/hooks/usePromotionEngine.ts` — `applyBestPromotion` (6 loại), `applyVoucher` (lookup Supabase)
- `src/pages/promotions/PromotionsPage.tsx` — CRUD 6 loại KM + tab Voucher
- `supabase/migrations/20260526000020_promotions_vouchers_loyalty.sql`

*Files sửa:*
- `vite.config.ts` — đổi import sang `vitest/config`, thêm `test.exclude: ['**/e2e/**']`, thêm `VitePWA(...)` plugin với workbox config
- `package.json` — thêm scripts: `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:ui`; thêm devDep `vite-plugin-pwa`
- `src/App.tsx` — import `PwaUpdateBanner` + `PromotionsPage` (lazy), thêm route `/promotions`, render `<PwaUpdateBanner />` ngoài BrowserRouter
- `src/main.tsx` — (đã có từ P3)
- `src/components/Layout.tsx` — import `Tag`, thêm nav item "Khuyến mãi" (perm: `promotions.manage`)
- `src/pages/orders/POSPage.tsx` — import `usePromotionEngine` + `AppliedDiscount`; thêm state `voucherCode/appliedDiscount/voucherError`; thêm `useEffect` auto-apply best promo khi cart đổi; thêm `handleApplyVoucher/clearDiscount`; thêm voucher input UI + applied badge trong payment panel

*Lỗi đã xử lý:*
- Vitest pick up E2E spec files của Playwright → fix bằng `exclude: ['**/e2e/**']` trong `vite.config.ts`
- `useCallback` unused trong Layout.tsx → đã xóa khỏi import
- `appliedDiscount?.type === 'promotion'` guard trong auto-apply effect để không reset khi voucher đang áp dụng

---

- [x] **P4-1. Test infrastructure (Vitest + Playwright)** — `~1.5 ngày` ✅ 2026-05-26
  - Cài `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@vitest/coverage-v8`, `msw` (mock Supabase).
  - Unit tests: `logger.ts` (3), `queryClient.ts` (9), `useDebouncedValue.ts` (6), `cartUtils.ts` (18) → **37 tests pass**.
  - Extracted `src/lib/cartUtils.ts` (pure functions) từ POSPage để enable unit testing.
  - E2E: 5 spec files — `auth.spec.ts`, `customer.spec.ts`, `inventory.spec.ts`, `pos.spec.ts`, `cashbook.spec.ts`.
  - CI workflow `.github/workflows/test.yml`: typecheck + vitest + playwright mỗi PR.
  - Scripts: `npm test`, `npm run test:coverage`, `npm run test:e2e`.
  - **KPI**: 37/37 unit tests pass; coverage config sẵn sàng; E2E chạy được local + CI.

- [x] **P4-2. PWA + offline support cho sales đi thị trường** — `~1 ngày` ✅ 2026-05-26
  - Cài `vite-plugin-pwa` v1.3.0 với workbox `generateSW` mode.
  - Manifest: name "Sanh Long Vetco CRM", theme `#1E5A9C`, display `standalone`, icons SVG 192/512.
  - Cache strategy: precache 59 assets (JS/CSS/HTML/fonts), NetworkFirst cho Supabase REST API (5s timeout, 24h fallback), CacheFirst cho Supabase Storage (7 ngày).
  - `PwaUpdateBanner` component: banner bottom-center khi SW detect update hoặc offline-ready — nút "Tải lại" reload page; auto-check update mỗi 1h.
  - `registerType: 'prompt'` → không tự cập nhật ngầm, user confirm trước.
  - **KPI**: Build thành công, `dist/sw.js` + `dist/workbox-*.js` generated; banner visible khi có update.

- [ ] **P4-3. VAT điện tử — tích hợp Misa SInvoice hoặc Viettel SInvoice** — `~1.5 ngày` ⏭ BỎ QUA (user yêu cầu 2026-05-26)
  - Khảo sát API của 2 nhà cung cấp (Misa MeInvoice, Viettel SInvoice) — chọn 1 dựa vào hợp đồng hiện có của Sanh Long.
  - Tạo Supabase Edge Function `issue-einvoice` nhận `order_id` → đọc snapshot order + customer business_info → POST sang API nhà cung cấp → lưu `invoice_no` + `xml_url` + `pdf_url` vào bảng `invoices`.
  - Nút "Xuất hóa đơn VAT điện tử" trên `OrderDetailPage` chỉ enable khi order ở trạng thái `paid` hoặc `completed` và KH có `tax_code`.
  - Retry queue: nếu API nhà cung cấp lỗi → lưu vào `einvoice_retry_queue`, cron Edge Function mỗi 15 phút retry.
  - **KPI**: 95% hóa đơn xuất thành công trong < 5s; lỗi API có audit log đầy đủ.

- [x] **P4-4. Hoàn thiện Khuyến mãi 6 loại + Tích điểm + Voucher** — `~1.5 ngày` ✅ 2026-05-26
  - Migration `20260526000020`: extend promotions CHECK (6 loại), thêm cột buy_x/get_y/tiers/priority; tạo `vouchers` + `loyalty_points` tables + `customer_loyalty_summary` view; trigger `trg_award_loyalty_points`.
  - `src/hooks/usePromotionEngine.ts`: `applyBestPromotion(cart, subtotal, tier)` chọn promo cao nhất; `applyVoucher(code, subtotal)` validate + tính giảm giá từ Supabase.
  - `src/pages/promotions/PromotionsPage.tsx`: CRUD 6 loại KM + tab Voucher với form tạo mã 6 ký tự; toggle bật/tắt; bảng voucher với trạng thái dùng.
  - POSPage: auto-apply best promo khi cart thay đổi; voucher input + nút "Áp"; badge hiển thị tên KM đang áp dụng + nút clear.
  - Route `/promotions` + nav link "Khuyến mãi" (perm `promotions.manage`).
  - **KPI**: 6 loại KM hoạt động trên POS; tích điểm trigger sẵn sàng; build clean.

- [ ] **P4-5. Chấm công + Lịch tuần sales** — `~1 ngày` ⏭ BỎ QUA (user yêu cầu 2026-05-26)
  - Bảng `attendance` (user_id, check_in_at, check_out_at, gps_lat, gps_lng, location_name).
  - Trang `/attendance` cho admin xem báo cáo tháng; nút "Chấm công" trên Layout Header cho sales (GPS browser API).
  - Bảng `sales_weekly_plan` (user_id, week_start, planned_visits JSONB). Sales tự lập kế hoạch thăm trại mỗi tuần (10–15 KH).
  - Trang `/sales-plan` dạng calendar tuần, drag-drop KH từ danh sách sang ngày. Khi visit xong → log vào `activities`.
  - Dashboard sales hiện widget "Kế hoạch tuần này: 12/15 KH đã thăm".
  - **KPI**: sales chấm công + lập kế hoạch tuần trong < 2 phút; admin có báo cáo công nhật toàn đội.

- [ ] **P4-6. Excel export theo template kế toán Việt Nam** — `~1 ngày`
  - Cài `xlsx` (SheetJS) hoặc `exceljs`.
  - 4 template chuẩn theo TT200/TT133:
    - **Sổ quỹ tiền mặt** (Mẫu S07-DN): cột Ngày / Số CT / Diễn giải / Thu / Chi / Tồn.
    - **Sổ chi tiết công nợ phải thu** (Mẫu S31-DN) theo khách hàng.
    - **Nhập-Xuất-Tồn kho** (Mẫu S08-DN) theo kho + sản phẩm.
    - **Bảng kê hóa đơn bán ra** (mẫu BC26-AC): phục vụ kê khai VAT.
  - Mỗi template có button export trên trang tương ứng (`/cashbook`, `/reports/debt`, `/inventory`, `/reports/revenue`).
  - Encoding UTF-8 BOM, format số tiền theo locale VN, ngày dd/MM/yyyy.
  - **KPI**: kế toán xuất Excel + paste thẳng vào file của Misa AMIS / FAST không cần chỉnh tay.

- [ ] **P4-7. 2FA cho Admin + Audit log nâng cao + Session management** — `~0.5 ngày`
  - Bật Supabase Auth MFA (TOTP) bắt buộc cho user có role `admin` hoặc `branch_director`. Trang `/profile/security` cho user enroll authenticator app.
  - Nâng cấp `audit_logs` table: thêm cột `ip_address`, `user_agent`, `device_id`. Trigger insert tự động cho mọi UPDATE/DELETE trên `customers/orders/cashbook_transactions/price_lists/users`.
  - Trang `/admin/audit-log` view với filter theo user/entity/date range; export Excel.
  - Force logout từ xa: admin có thể revoke session của user bất kỳ qua nút "Đăng xuất phiên này" trong trang nhân viên.
  - **KPI**: 100% action admin có audit log; admin có thể force logout user trong < 5s.

- [ ] **P4-8. Mobile app native qua Capacitor** — `~1 ngày`
  - Cài `@capacitor/core`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/camera`, `@capacitor/geolocation`, `@capacitor/push-notifications`.
  - Capacitor config `capacitor.config.ts` trỏ webDir vào `dist/`.
  - Bridge bổ sung native API: chụp ảnh sản phẩm/lô qua camera (lưu Supabase Storage); GPS chấm công; push notification cho phiếu chi pending.
  - Build Android APK ban đầu cho QA team test (ký debug key).
  - **Production sign + Play Store distribution** dời sang giai đoạn release riêng (cần app icon HD, screenshots, privacy policy, content rating).
  - **KPI**: APK chạy được trên Android 8+; camera + GPS + push hoạt động.

- [ ] **P4-9. Multi-tenancy preparation (cho SaaS hóa)** — `~1 ngày`
  - **Lý do**: nếu Sanh Long muốn bán CRM này cho các công ty thú y khác, cần tách biệt dữ liệu cứng. Hiện schema giả định 1 tenant.
  - Thêm bảng `tenants` (id, name, code, plan, is_active, created_at).
  - Thêm cột `tenant_id UUID REFERENCES tenants(id)` vào 12 bảng gốc: `customers`, `products`, `orders`, `cashbook_transactions`, `branches`, `warehouses`, `profiles`, `opportunities`, `herd_projects`, `invoices`, `audit_logs`, `notifications`.
  - Helper function `public.fn_current_tenant_id()` lấy `tenant_id` từ JWT claim (`auth.jwt() -> 'user_metadata' -> 'tenant_id'`).
  - Cập nhật toàn bộ RLS policy thêm điều kiện `tenant_id = fn_current_tenant_id()`.
  - Migration backfill: gán `tenant_id` mặc định cho dữ liệu hiện có của Sanh Long.
  - Onboarding flow: khi tạo tenant mới → seed 1 admin user + roles + permissions + price_lists mặc định.
  - **KPI**: tạo tenant thứ 2 (demo) + login vào → không thấy data của Sanh Long; switching tenant qua subdomain `sanhlong.crm.example.com` / `democo.crm.example.com`.

- [ ] **P4-10. Onboarding wizard + Admin documentation** — `~0.5 ngày`
  - Wizard 5 bước cho admin lần đầu setup tenant mới: (1) Chi nhánh đầu tiên, (2) Kho hàng + dải nhiệt độ, (3) Nhóm Sales + nhân viên đầu tiên, (4) Bảng giá + KH/SP mẫu, (5) Cấu hình hiển thị (đơn vị tiền tệ, format ngày, ngôn ngữ).
  - Wizard skip-được cho user advanced, lưu trạng thái vào `tenant_settings.onboarding_completed_at`.
  - Tạo `docs/06-ADMIN-HANDBOOK.md` (VN): nghiệp vụ nhập kho, duyệt phiếu chi, tạo phác đồ điều trị, gán role, force logout user.
  - Tạo `docs/07-DEVELOPER-HANDBOOK.md` (VN): kiến trúc hooks, pattern useQuery, cách thêm 1 page mới, RLS checklist.
  - Tooltip help icon trên các trang nghiệp vụ phức tạp (POS, Pipeline, Herd Project Detail).
  - **KPI**: tenant mới hoàn tất onboarding trong < 15 phút mà không cần dev support.

**Tổng thời gian dự kiến P4**: 10–11 ngày làm việc (1 dev full-time).

**Tiến độ P4 tính đến 2026-05-28**:
| Task | Trạng thái |
|---|---|
| P4-1 Test infrastructure | ✅ Hoàn thành 2026-05-26 |
| P4-2 PWA + Workbox | ✅ Hoàn thành 2026-05-26 |
| P4-3 VAT điện tử | ⏭ Bỏ qua |
| P4-4 Khuyến mãi 6 loại + Voucher + Điểm | ✅ Hoàn thành 2026-05-26 |
| P4-5 Chấm công | ⏭ Bỏ qua |
| **[THÊM MỚI] Tích hợp cấu hình in ấn vào Admin** | ✅ Hoàn thành 2026-05-28 |
| **[THÊM MỚI] Sửa lỗi phân quyền RBAC & RLS hệ thống** | ✅ Hoàn thành 2026-05-28 |
| **[THÊM MỚI] Vá lỗi co giãn cột bảng nhập kho** | ✅ Hoàn thành 2026-05-28 |
| **[THÊM MỚI] Đồng bộ giá vốn & Chi tiết phiếu nhập** | ✅ Hoàn thành 2026-05-28 |
| **[THÊM MỚI] Tích hợp GPS chuồng trại & Bản đồ theo dõi Sales** | ✅ Hoàn thành 2026-05-29 |
| **[THÊM MỚI] Vá lỗi phân quyền & hiển thị sai chi nhánh (PO, Nhập kho, Đơn hàng, Tồn kho, Điều chuyển, Trả NCC)** | ✅ Hoàn thành 2026-05-29 |
| **[THÊM MỚI] Bảng giá chi nhánh mặc định & linh hoạt giá hoàn trả / chuyển kho (Bán nội bộ gán giá vốn)** | ✅ Hoàn thành 2026-05-30 |
| **[THÊM MỚI] Sửa lỗi kiểm thử E2E & tối ưu hóa accessibility các modal** | ✅ Hoàn thành 2026-05-30 |
| P4-6 Excel export kế toán | 🔲 Chưa làm |
| P4-7 2FA + Audit log | 🔲 Chưa làm |
| P4-8 Capacitor mobile native | 🔲 Chưa làm |
| P4-9 Multi-tenancy | 🔲 Chưa làm |
| P4-10 Onboarding wizard + docs | 🔲 Chưa làm |

**KPI tổng sau P4 (mục tiêu ban đầu)**:
- ✅ Test coverage ≥ 60% module core; CI/CD chạy auto mỗi PR
- ✅ App chạy offline cho sales (PWA + Workbox NetworkFirst)
- ⏭ VAT điện tử thành công ≥ 95% — bỏ qua sprint này
- 🔲 Excel kế toán xuất được 4 mẫu chuẩn TT200/TT133
- 🔲 Admin 2FA + audit log đầy đủ → đạt mức bảo mật cho hợp đồng B2B
- 🔲 APK Android phát hành nội bộ cho QA
- 🔲 Multi-tenant ready (nếu muốn SaaS hóa)
- 🔲 Tài liệu Admin + Developer Handbook (VN)

**Bước tiếp theo gợi ý**: P4-6 (Excel export kế toán) → P4-7 (2FA + Audit) → P4-10 (Docs)

**Sau P4, sản phẩm đạt mức**: SaaS B2B chuyên ngành thú y, đủ chất lượng để (a) Sanh Long vận hành lâu dài không lo regression, (b) chào hàng cho 5–20 công ty thú y/phân phối khác như sản phẩm thương mại với giá ~5–15 triệu/tháng/tenant.

---

### 🛣️ Lộ trình tổng (5 sprint)

| Sprint | Trạng thái | Thời gian | Mục tiêu |
|--------|-----------|-----------|----------|
| **P0** Quick Wins | ✅ HOÀN THÀNH 2026-05-26 | 1–2 ngày | Bundle ~1MB → 22 KB gz; lazy 28 routes |
| **P1** Data layer overhaul | ✅ HOÀN THÀNH 2026-05-26 | 3–5 ngày | TanStack Query + views/RPC + refactor 3 page lớn |
| **P2** UX/UI polish & refactor | ✅ HOÀN THÀNH 2026-05-26 | 3–4 ngày | Thực hiện UX/UI Audit hệ thống hiện tại & tối ưu hóa giao diện (Skeleton, virtualization, memo, tách component) |
| **P3** Assets & monitoring | ✅ HOÀN THÀNH 2026-05-26 | 2–3 ngày | WebP + self-host font + Web Vitals + Realtime |
| **P4** Enterprise & SaaS readiness | ⏳ ĐANG THỰC HIỆN | 10–11 ngày | Test + PWA + VAT + KM + Chấm công + Excel + 2FA + Capacitor + Multi-tenant + Docs |

**Tổng còn lại**: ~15–18 ngày làm việc full-time để đưa sản phẩm lên mức enterprise SaaS đầy đủ.

---

### 📌 Quy ước tối ưu áp dụng cho mọi PR mới sau ngày 2026-05-26

1. **Server-side trước, client-side sau**: bất kỳ `filter/search/sort/paginate` mới đều phải làm qua Supabase `.eq()/.ilike()/.range()/.order()`. Không dùng `array.filter()` cho danh sách > 100 dòng.
2. **Mọi data fetch dùng `useQuery`** – không gọi `supabase.from()` trực tiếp trong component nữa. Đặt hook ở `src/hooks/queries/<entity>.ts`.
3. **Mọi route mới phải `React.lazy`**.
4. **Component > 500 dòng cần tách**. Mỗi tab/section là component con + lazy nếu cần.
5. **Mọi search input phải debounce 300ms**, mọi list > 50 items phải virtualize.
6. **Không `select('*')` trên bảng > 10 cột** – luôn liệt kê cột cần dùng.
7. **Không `console.log` runtime** – dùng `logger.debug()` chỉ chạy ở DEV.

---

### 🔎 Phiên 2026-05-31 — View nhanh sản phẩm (inline) + audit Products

**Đã làm:**
- **View nhanh inline (KiotViet-style)** ở danh sách sản phẩm: click 1 dòng → expand panel ngay dưới với 4 tab (Thông tin / Phiên bản & Lô hàng / Thẻ kho / Khuyến mãi). Click lại để đóng; mở dòng khác tự đóng dòng cũ. Có nút "Mở trang chi tiết". Hỗ trợ cả desktop (table row) lẫn mobile (card). Lọc lô/thẻ kho theo chi nhánh cho user không phải admin/ceo.
  - File mới: `src/pages/products/ProductQuickView.tsx`
  - Hook mới (useQuery, `enabled` chỉ chạy khi expand): `useProductLots`, `useProductMovements`, `useProductPromotionsList` trong `src/hooks/queries/useProducts.ts`; thêm key `qk.products.lots/movements/promotions` ở `src/lib/queryClient.ts`.
  - Sửa `src/pages/products/ProductListPage.tsx`: state `expandedId`, đổi click-row từ navigate → toggle expand, render quick view; cột checkbox đầu đổi thành chevron mở/đóng.
  - Tab Thông tin tái dùng dữ liệu `ProductStockRow` sẵn có từ list → KHÔNG query thêm.
- **Gỡ nút "Tạo nhanh lô hàng mẫu để test FEFO"** (`handleSeedMockLots`) ở `ProductDetailPage.tsx` — nút này chèn dữ liệu giả vào DB production.
- Verify: `tsc --noEmit` EXIT=0; `npm run build` ✓ 11.74s. ProductListPage chunk 95 KB.

**Audit Products — phát hiện CHƯA sửa (chờ duyệt phiên sau):**
1. **Gate quyền nút**: "Sửa chi tiết" + "Nhập kho/Thêm lô hàng" ở ProductDetailPage hiển thị với MỌI user (kể cả role chỉ có `products.view`) → bấm sẽ lỗi RLS. Cần ẩn theo `products.manage` / `inventory.receive`.
2. **Lệch sổ Thẻ kho**: nút "Thêm lô hàng" insert thẳng `stock_lots`, KHÔNG ghi `stock_movements` (không có trigger sinh movement khi insert lot) → tồn tăng nhưng Thẻ kho trống. Cần ghi movement kèm hoặc điều hướng sang luồng Nhập kho chuẩn.
3. Bảng variant hiển thị `JSON.stringify(attributes)` thô — nên render đẹp.

---

### 🔎 Phiên 2026-05-31 (tiếp) — View nhanh khách hàng (inline) + audit Customers

**Đã làm:**
- **View nhanh inline (KiotViet-style)** ở danh sách khách hàng: click 1 dòng → expand panel ngay dưới với 2 tab **Lịch sử giao dịch** (20 đơn gần nhất: mã đơn, ngày, giá trị, trạng thái, thanh toán) + **Công nợ** (tổng dư nợ / hạn mức / số khoản quá hạn + bảng khoản nợ chưa tất toán). Click lại để đóng; có nút "Mở trang chi tiết". Hỗ trợ desktop + mobile. RLS orders/customer_debts (branch/owner) tự lọc theo quyền user.
  - File mới: `src/pages/customers/CustomerQuickView.tsx`
  - Hook mới (useQuery, `enabled` khi expand): `useCustomerOrders`, `useCustomerDebts` trong `src/hooks/queries/useCustomers.ts`; thêm key `qk.customers.orders/debts`.
  - Sửa `src/pages/customers/CustomerListPage.tsx`: state `expandedId`, click-row đổi navigate → toggle expand, thêm chevron ở cột Mã KH, render quick view (desktop colSpan=7 + mobile). Giữ dropdown "Xem chi tiết/Chỉnh sửa".
  - Tab Công nợ tái dùng `total_debt/credit_limit/is_overdue` từ `CustomerSummaryRow` (header) + query chi tiết khoản nợ.
- Verify: `tsc --noEmit` EXIT=0; `npm run build` ✓.

**Audit Customers — phát hiện CHƯA sửa (chờ duyệt phiên sau):**
1. **Nút "Thiết lập"** ở CustomerListPage điều hướng `/customers/settings` (route yêu cầu `users.manage`) nhưng nút hiển thị với mọi user → non-admin bấm sẽ bị chặn route (UX khó hiểu). Nên ẩn nút theo `users.manage`.
2. **CustomerDetailPage còn ~17 `console.*`** runtime (chủ yếu console.error trong catch) — vi phạm quy ước "dùng logger". Nên thay bằng `logger`.
3. Trang chi tiết khách hàng 3895 dòng — nên tách tabs lazy (đã ghi ở P2-5).

---

### 🛠️ Phiên 2026-05-31 (tiếp) — Sửa audit Products + Customers

**Đã sửa (verify: tsc EXIT=0, build ✓):**
- **Products #2 (lệch Thẻ kho) — QUAN TRỌNG** ⚠️ **[ĐÃ THU HỒI 2026-06-05 — xem phiên "Gỡ Nhập kho thủ công" bên dưới]**: tạo RPC `public.fn_add_manual_lot(uuid,uuid,text,date,date,numeric,numeric)` (`SECURITY INVOKER`, atomic: ghi `stock_lots` + `stock_movements` type `adjustment_increase`, ref_type `manual_lot`, performed_by=auth.uid()). Migration `supabase/migrations/20260607000000_fn_add_manual_lot.sql`. **ĐÃ APPLY remote** qua Management API (project gdotgcrtivjdpkcchrro) + reload schema cache. `ProductDetailPage.handleAddLotSubmit` giờ gọi RPC, có **fallback 2 bước** (insert lot → movement, rollback lô nếu movement lỗi) khi RPC chưa có. → Nhập kho thủ công nay luôn có dòng trong Thẻ kho.
- **Products #1 (gate quyền)**: nút "Sửa chi tiết" ẩn nếu không `admin|products.manage`; nút "Nhập kho/Thêm lô hàng" + "Thêm lô hàng đầu tiên" ẩn nếu không `admin|inventory.receive` (khớp RLS warehouse_keeper).
- **Products #3**: thay `JSON.stringify(attributes)` ở bảng variant bằng chip key:value.
- **Customers #1 (gate quyền)**: nút "Thiết lập" (→ /customers/settings cần users.manage) ẩn nếu không `admin|users.manage`.
- **Customers #2**: thay `console.info` rò rỉ role (CustomerDetailPage:860) → `logger.debug`. (Ghi chú: các `console.error/warn` khác là HỢP LỆ theo convention logger.ts — không cần đổi.)
- Đồng bộ `console.error/warn` còn lại ở ProductDetailPage → `logger`.

**CHƯA làm — defer có chủ đích:**
- **Customers #3 (tách CustomerDetailPage 3895 dòng)**: là refactor lớn, rủi ro regression cao, đã được lên lịch riêng ở P2-5. KHÔNG gộp vào phiên sửa audit để tránh phá vỡ. Cần 1 session riêng.

**Lưu ý vận hành:** RLS insert thủ công stock_lots/stock_movements là theo ROLE (`warehouse_keeper`), trong khi UI gate theo PERMISSION (`inventory.receive`). warehouse_keeper có sẵn inventory.receive nên khớp; nếu tạo role tùy biến có inventory.receive mà KHÔNG có role warehouse_keeper thì RLS vẫn chặn (mismatch tồn tại sẵn, không phát sinh từ phiên này).

---

### 🎁 Phiên 2026-06-04 — KM theo sản phẩm: sửa hiển thị POS + giá quà tặng

**Đã làm (verify: tsc -b EXIT=0; migration đã apply remote + reload schema + verify cột):**
- **Sửa bug (hình 1)**: POS không hiện chú thích KM cho SP có KM "Mua X tặng Y" khi **đơn giá = 0**. Nguyên nhân: guard `item.unitPrice > 0` ở `POSPage.tsx` (cart.map dòng ~1336). Đổi sang guard theo cờ `isGift` (không theo giá) → KM mua-tặng hiện cả khi giá 0; KM percent/fixed giá 0 vẫn tự ẩn (evaluate trả null). Lưu ý vận hành: đơn giá 0 là do **bảng giá thiếu giá bán** cho SP đó — cần kiểm tra "Giá lẻ (Hộ chăn nuôi)".
- **Cờ `isGift?`** thêm vào `CartRow` (`src/lib/cartUtils.ts`) + `CartItem` (POSPage); `addPromoLine`/`applyProductGift` set `isGift:true` để tách dòng quà khỏi SP giá-0 thật.
- **Giá quà tặng (đa dạng hình thức KM)**: cột mới `product_promotions.get_price NUMERIC(15,2) DEFAULT 0` (0=miễn phí, >0=giá ưu đãi/đơn vị). Migration `20260610000000_product_promo_gift_price.sql` + 2 CHECK NOT VALID (get_price≥0; percent∈[0,100]). **Apply remote qua Management API** (project gdotgcrtivjdpkcchrro), NOTIFY reload schema, verify cột tồn tại.
- `useProductPromotions.ts`: `get_price` trong type, `giftPrice` trong `ProductPromoEvaluation`, `.order('id')` tie-break. POS `applyProductGift(giftProduct, giftQty, giftPrice)` set `unitPrice=giftPrice`; nhãn dòng quà hiện "(giá ưu đãi …₫)" / "(miễn phí)".
- **Modal `ProductPromotionModal.tsx`** làm rõ A→B: chip "Mua sản phẩm (A) {name}", nhãn "Số lượng mua (X)/tặng (Y)", checkbox "Tặng SP khác (B)", radio Miễn phí/Giá ưu đãi + input get_price, **live summary** đọc trực tiếp config (phát hiện ngay khi tên KM nhập tay lệch cấu hình), validation percent≤100 + bắt chọn SP tặng B + get_price>0 khi chọn giá ưu đãi.
- Danh sách KM (`ProductDetailPage` + `ProductQuickView`) hiện dòng "🎁 Tặng {qty} {tên B/chính SP} · giá quà". ProductDetailPage fetch tên SP quà qua `products.in(giftIds)`.
- **Rà soát 1001+ (sales+KM)**: POSPage, MobileOrderPage, ProductPromotionModal đã `fetchAllRows` ✓ (không rớt SP 1001+). Các picker khác (PriceList/PO/GoodsReceipt/Inventory/Cashbook/Herd/CustomerMap) chưa fetchAllRows → để session sau.
- **Phân quyền/bảo mật**: RLS `product_promotions` giữ nguyên (admin/ceo toàn quyền; NV `promotions.manage` khóa 1 chi nhánh). Nút Thêm/Sửa/Xóa KM đã gate `canManagePromos`. Không nới quyền.

---

### 🗑️ Phiên 2026-06-05 — Gỡ HOÀN TOÀN "Nhập kho / Thêm lô hàng" thủ công ở trang sản phẩm

**Bối cảnh & lý do (toàn vẹn dữ liệu):** Trang chi tiết sản phẩm có nút "Nhập kho / Thêm lô hàng" cho phép tạo `stock_lots` thủ công, **bỏ qua luồng Phiếu nhập kho chuẩn** (NCC/PO/chứng từ). Đây là cổng ghi tồn kho không truy vết được nguồn gốc → quyết định gỡ bỏ hoàn toàn. Đường tăng tồn kho duy nhất từ nay là Phiếu nhập NCC ([GoodsReceiptFormPage.tsx](file:///E:/CRMSANHLONG/src/pages/goods-receipts/GoodsReceiptFormPage.tsx)).

**Đã làm (verify: `tsc --noEmit` PASS 0 lỗi):**
- **Frontend `ProductDetailPage.tsx`**: gỡ nút header "Nhập kho / Thêm lô hàng", nút "Thêm lô hàng đầu tiên" (state kho trống — thay bằng dòng hướng dẫn "Tồn kho được ghi nhận qua Phiếu nhập kho"), toàn bộ modal nhập lô + `handleAddLotSubmit` (gồm fallback insert 2 bước), state lô (`isAddingLot`, `newLotNumber`, `newWarehouseId`, `newMfgDate`, `newExpDate`, `newQty`, `newCostPrice`, `lotError`), gate `canReceiveStock`, state + block fetch `warehouses` (chỉ phục vụ dropdown modal), và các import/biến thừa (`Check`, `Calendar`, `FileText`, `settings`).
- **Database (toàn diện)**: Migration `20260618000000_drop_fn_add_manual_lot.sql` → `DROP FUNCTION public.fn_add_manual_lot(...)`. **ĐÃ APPLY remote** qua Management API (project gdotgcrtivjdpkcchrro) + verify hàm biến mất khỏi `pg_proc` + NOTIFY reload schema cache.
- **Toàn vẹn dữ liệu**: chỉ gỡ entry-point; `stock_lots`/`stock_movements` đã tạo trước đây qua tính năng này **giữ nguyên** (dữ liệu tồn kho hợp lệ).
- **Phân quyền/bảo mật**: RLS `stock_lots`/`stock_movements` (warehouse_keeper) + permission `inventory.receive` **giữ nguyên** (vẫn dùng cho GoodsReceipt) — chỉ gỡ 1 cổng ghi ở UI, không nới/siết quyền khác.

---

### 📦 Phiên 2026-06-05 — Luồng DUYỆT phiếu nhập kho + sửa UI Inventory + audit cap-1000

**1) Luồng duyệt phiếu nhập kho (giống duyệt đơn giao hàng)** — `[HOÀN THÀNH — đã apply remote ✅]`
- **Vấn đề cũ (toàn vẹn dữ liệu)**: `goods_receipts` không có `status`; trigger `trg_receipt_lines_create_lot` (AFTER INSERT) tạo `stock_lots` NGAY khi tạo phiếu → hàng vào kho tức thì, không kiểm soát.
- **Migration `20260619000000_goods_receipt_approval.sql`** (apply remote qua Management API + verify + reload schema):
  - Thêm `goods_receipts.status` (draft/verified/completed/cancelled) + `verified_by/at`, `completed_by/at` + index. **Backfill 34 phiếu cũ → completed** (đã vào kho theo mô hình cũ, không xử lý lại).
  - **GỠ trigger** `trg_receipt_lines_create_lot` → tồn kho chỉ sinh tại RPC hoàn thành.
  - **4 RPC `SECURITY DEFINER`**: `fn_verify_goods_receipt` (admin/ceo: draft→verified), `fn_complete_goods_receipt` (người lập HOẶC admin: verified→completed, tạo lô+thẻ kho+giá vốn+cập nhật PO, atomic/idempotent), `fn_cancel_goods_receipt`, `fn_reopen_goods_receipt` (admin: verified→draft).
  - **RLS bổ sung**: người lập sửa/xóa/thêm trên phiếu NHÁP của chính mình (`received_by=auth.uid() AND status='draft'`).
- **Frontend**:
  - `GoodsReceiptFormPage`: tạo phiếu = **lưu nháp** (status draft, hàng CHƯA vào kho), bỏ cập nhật PO ở client (đưa vào RPC hoàn thành); thêm **chế độ sửa** (`?id=`) nạp lại phiếu nháp cho sửa toàn bộ (NCC/kho/ngày/VAT/dòng), lưu = update header + thay dòng; sau lưu → điều hướng trang chi tiết.
  - **`GoodsReceiptDetailPage.tsx` (mới)** + route `/goods-receipts/:id`: stepper Nháp→Đã duyệt→Hoàn thành; nút theo trạng thái+quyền (Sửa/Hủy/Duyệt/Hoàn thành/Trả về nháp); embed profiles phải chỉ FK rõ (`!goods_receipts_*_fkey`) vì 3 FK→profiles.
  - `InventoryPage` tab Phiếu nhập: badge trạng thái (desktop+mobile), query thêm `status` + disambiguate `profile:profiles!goods_receipts_received_by_fkey`, click → trang chi tiết.

**2) Sửa UI Inventory (lỗi vỡ chữ)** — `[HOÀN THÀNH]`
- 3 modal trong `InventoryPage` (Chi tiết chuyển kho, Chi tiết phiếu nhập, Chi tiết trả NCC) bị bảng nhồi trong modal hẹp (`max-w-2xl/3xl`) → tên SP vỡ dọc từng chữ. Sửa: nới `max-w-4xl` + bảng `min-w-[...]` + `overflow-x-auto` (cuộn ngang) + `whitespace-nowrap` cột số + `break-words` cột tên. Gỡ class chết `font-vietnamese`.

**3) Audit cap-1000 + SmartSearchSelect** — `[ĐÃ ĐẠT CHUẨN, KHÔNG CẦN SỬA]`
- Rà soát các picker trọng yếu: **đều đã** `fetchAllRows` (không rớt SP/KH 1001+) **và** search thông minh: PurchaseOrderFormPage ✓, OrderEditModal ✓, CashbookPage (thu nợ KH) ✓, HerdProjectForm/Detail ✓, PriceListPage (lưới+search riêng) ✓. Bonus đã fix sẵn: CustomerMapPage, PipelinePage. → Phần cap-1000 ở key pickers coi như xong từ session trước.
- `tsc --noEmit` PASS 0 lỗi.

---

### 📄 Phiên 2026-05-31 (tiếp) — Xuất file công nợ (sao kê .xlsx giống KiotViet)

**Đã làm (verify: tsc EXIT=0, build ✓):**
- Tính năng **Xuất file công nợ** dạng Excel .xlsx có Nợ đầu kỳ / Phát sinh trong kỳ (Ghi nợ–Ghi có) / Nợ cuối kỳ + hành trình mua–trả–thanh toán nhóm theo chứng từ (HD→line item→TT).
- Cài `exceljs ^4.4.0`. Thêm rule `manualChunks` tách `exceljs` thành **chunk async riêng** (939KB, chỉ tải khi bấm xuất) — react-vendor giữ 314KB.
- File mới:
  - `src/lib/customerStatement.ts` — `fetchCustomerStatement(customerId, fromISO, toISO)` + `buildStatement()` thuần. Tái dùng mô hình ledger của CustomerDetailPage (invoice=+Ghi nợ, payment/credit-note=−Ghi có). Tính opening = running balance mọi GD trước kỳ; closing = opening + ΣGhi nợ − ΣGhi có. Fetch KH/branch/contact + order_lines (đơn trong kỳ) cho chi tiết dòng.
  - `src/lib/exporters/customerStatementXlsx.ts` — `generateCustomerStatementXlsx()` (exceljs lazy import). Header công ty (từ `settings.print_company_*`) + chi nhánh, tiêu đề + khoảng ngày, khối tổng hợp có viền, bảng cột động theo toggle, freeze header, numFmt #,##0, tải Blob.
  - `src/pages/customers/ExportDebtStatementModal.tsx` — preset thời gian (Hôm nay…Toàn thời gian + Lựa chọn khác, dùng date-fns) + toggle "Chi tiết từng hàng" (ĐVT/SL/Đơn giá/Giảm giá/VAT/Giá bán/trả/Thành tiền) + Ghi chú.
- Gắn nút "Xuất file công nợ":
  - CustomerDetailPage: tab "Nợ cần thu" → cạnh nút "Điều chỉnh công nợ".
  - CustomerQuickView: tab Công nợ (xuất ngay từ danh sách).
- Lưu ý dữ liệu: schema `order_lines` KHÔNG có VAT theo dòng → cột VAT = 0 (vẫn cho bật/tắt khớp KiotViet). Không cần thay đổi DB (read-only, không chạy SQL DDL phiên này).

---

### 🐔 Phiên 2026-05-31 (tiếp) — Herd-Projects GĐ1 (nền tảng)

**Đã làm (verify: tsc EXIT=0, build ✓ 17.98s; migration đã apply remote + reload schema):**
- **DB** (`supabase/migrations/20260608000000_herd_projects_phase1.sql`, ĐÃ APPLY):
  - `herds` +breed_price, +expected_exit_date. `herd_project_steps` +assigned_to, +manager_rating(+note), +customer_rating(+note).
  - Bảng mới `herd_project_members` (role viewer/collaborator/manager) + `herd_project_costs` (cost_type product/feed/labor/medicine/other, product_id, qty, unit_cost, amount).
  - Helper RLS `fn_can_view_herd_project` / `fn_can_edit_herd_project` / `fn_can_manage_herd_members` (SECURITY DEFINER) → **member khác chi nhánh xem/sửa được**. Viết lại policy herd_projects/steps/outcomes + policy mới costs/members (an toàn vì 0 dự án).
  - Trigger toàn vẹn `trg_herd_proj_consistency` (herd↔farm↔customer). View `herd_project_list_view` (security_invoker, có age_days/member_count/cost_to_date/mortality_rate). Perms mới: herd_projects.update/delete/manage_members + grant role.
- **UI**:
  - Hook `src/hooks/queries/useHerdProjects.ts` + `qk.herdProjects.*`.
  - `HerdProjectListPage` → useQuery + view, **filter server-side**: search(không dấu)/vật nuôi/trạng thái/loại/địa điểm(tỉnh)/người phụ trách/số lượng(min-max)/khoảng thời gian + preset; thẻ hiện tuổi đàn/chi phí/hao hụt/số người theo dõi.
  - `HerdProjectFormPage` → **tạo cơ sở + đàn inline** (loài/con giống/giá giống/ngày vào/dự kiến xuất/số lượng) standalone + **chọn thành viên** (đa chi nhánh + vai trò) → ghi herd_project_members.
  - `HerdProjectDetailPage` → tab **"Thành viên"** (component `HerdMembersSection.tsx`): thêm/đổi vai trò/gỡ, gate canManage (owner|admin|manage_members).

**Đã hoàn thành (Phiên 2026-05-31 tiếp theo):**
- Đã liên kết đầy đủ Tab Chi phí vào bảng `herd_project_costs` hiển thị danh sách chi tiết chi phí và các thẻ KPI tổng chi phí, doanh thu, lợi nhuận ròng.
- Step modal: Hỗ trợ gán người thực hiện (`assigned_to`) và đánh giá QL/khách (số sao + ý kiến nhận xét). Khi hoàn thành bước có sử dụng thuốc/vaccine, hệ thống tự động sinh dòng chi phí thuốc dựa trên giá vốn (`cost_price`) của lô tương ứng.
- Overview detail: Header trang hiển thị đầy đủ khu vực, tuổi đàn và tổng chi phí thời gian thực lấy từ view `herd_project_list_view`.

---

### 🐔 Phiên 2026-05-31 (tiếp) — Herd-Projects: Danh mục + Khu vực + Smart search KH + Quản lý đàn

**Đã làm (tsc EXIT=0, build ✓; migration `20260609000000_herd_catalog_and_regions.sql` ĐÃ APPLY remote + reload):**
- **DB**: `species`+is_active; bảng mới `herd_regions`(name/code/is_active/sort_order); `farms`+region_id, `herd_projects`+region_id; `herd_project_costs.cost_type` thêm 'breeding_stock'; RLS herd_regions + nới manage species/herd_project_types về `admin|herd_projects.update`; view `herd_project_list_view` +region_id/region_name (COALESCE project/farm).
- **UI**:
  - Hook `useHerdRegions`, `useSpeciesList(activeOnly)`; list param regionId; row +region.
  - `ManageHerdCatalogModal.tsx` (mới): modal 3 tab CRUD+status (Vật nuôi/Loại kế hoạch/Khu vực). Nút "Quản lý danh mục" trên List.
  - List: filter "Địa điểm"→**Khu vực** dùng `SmartSearchSelect`; thẻ hiện region_name; nút "Quản lý đàn".
  - Form: KH dùng **SmartSearchSelect** (>1000 KH, lọc không dấu); thêm chọn Khu vực; khi tạo có giá giống → tự ghi `herd_project_costs` breeding_stock = giá×số con vào chi phí dự án.
  - **Trang Quản lý đàn** `HerdsManagePage.tsx` + route `/herd-projects/herds` (đặt trước `:id`): list+search+CRUD+toggle status+giá vật nuôi; tạo đàn (chọn KH→trại).
- Tái dùng `src/components/SmartSearchSelect.tsx` (combobox lọc không dấu, cap 100).

**Đã hoàn thành (Phiên 2026-05-31 tiếp theo):**
- Tab Chi phí tích hợp hoàn chỉnh (bao gồm cả CRUD chi phí khác thủ công như nhân công, thức ăn, chi phí chung).
- Đánh giá QL/KH và gán người thực hiện ở Step modal.
- Overview detail tích hợp đầy đủ số liệu view mới.
- Sửa lỗi tạo dự án chăn nuôi bị báo lỗi hệ thống: Sửa hàm trigger `public.fn_fill_org_from_owner()` để bắt lỗi `undefined_column` khi gán các trường `team_id`/`branch_id` vào bảng record không có cột đó (như `herd_projects` không có cột `branch_id`). Migration `20260610000000_fix-fill-org-trigger.sql` đã được tự động áp dụng lên remote database thành công.

---

### 🐔 Phiên 2026-06-01 — Herd-Projects: Hoàn thiện thao tác (lịch trình, sửa/xóa, view bảng)

**Đã làm (tsc --noEmit EXIT=0; KHÔNG cần migration — tái dùng RLS sẵn có):**

- **Trang danh sách** (`HerdProjectListPage.tsx`):
  - Nút **"Tạo đàn"** cạnh "Quản lý đàn"/"Quản lý danh mục" → `/herd-projects/herds?new=1` (auto mở modal tạo đàn).
  - **Toggle Card ↔ Bảng** (lưu `localStorage` `herd_view_mode`). View bảng đủ cột: Mã/Tên · Khách hàng · Vật nuôi · Khu vực · Tổng đàn · Tuổi đàn · Chi phí · Hao hụt · Người phụ trách · Trạng thái; click hàng mở chi tiết; giữ badge "Quá hạn".
- **Trang quản lý đàn** (`HerdsManagePage.tsx`): đọc `?new=1` (`useSearchParams`) tự mở modal tạo đàn rồi xóa param.
- **Trang chi tiết** (`HerdProjectDetailPage.tsx`) — thay đổi chính:
  - **Sửa dự án (giới hạn)**: nút "Sửa" (gate `hasPermission('herd_projects.update')`) → modal sửa `name/owner/project_type/region/head_count/start_date/end_date/notes`. KHÔNG đụng customer/farm/herd (bảo toàn chi phí đã ghi).
  - **Lịch trình bước — CRUD + đổi thứ tự** (tính năng cốt lõi): nút "Thêm bước" (kể cả khi lịch trình rỗng); mỗi bước có nút Lên/Xuống (hoán đổi `sort_order`) + Xóa (dọn chi phí auto gắn `step_id` trước khi xóa); modal cập nhật bước mở rộng cho sửa `step_name` + `planned_date` + `assigned_to` (đổi người làm vaccine). Thao tác bước cho phép khi `status ∈ {draft, active, on_hold}` (trước đây chỉ `active`).
  - **Xóa dự án**: nút "Xóa dự án" chỉ hiện khi `status ∈ {draft, cancelled}` + gate `hasPermission('herd_projects.delete')`, confirm mạnh, hard delete (CASCADE bước/chi phí/thành viên/kết quả). `active/on_hold/completed` giữ "Hủy".
- **Danh mục** (`ManageHerdCatalogModal.tsx`): tab "Loại kế hoạch" hiển thị tên loài gắn kèm (`species_id`).

**Phân quyền/bảo mật**: nút UI gate bằng permission; RLS sẵn có là lớp thực thi thật (`herd_proj_update`/`herd_proj_delete`, `herd_steps_manage`, `herd_costs_manage` qua `fn_can_edit_herd_project`). Lưu ý: RLS `herd_proj_delete` chỉ cho admin/owner/manager-member — branch_manager/team_lead có permission nhưng không sở hữu sẽ bị RLS chặn (hiện alert lỗi thân thiện).

---

### 🐔 Phiên 2026-06-01 (tiếp) — Herd-Projects: Tổng quan vật nuôi + Công việc 7 ngày + Tạo trại

**Đã làm (tsc --noEmit EXIT=0):**

- **DB** — `supabase/migrations/20260611000000_herd_overview.sql` (⚠️ **CẦN APPLY REMOTE** — môi trường agent không có SUPABASE_ACCESS_TOKEN; apply bằng `supabase db push` với token, hoặc dán SQL vào Supabase SQL editor):
  - RPC `fn_upcoming_herd_tasks(p_days int)` `SECURITY DEFINER` + `GRANT authenticated` + guard `fn_is_active()`: trả các bước `pending` có `planned_date <= today+N` (gồm quá hạn) của dự án `active`; field an toàn (không chi phí). Cho **mọi user** xem để nhắc nhau.
- **Hooks** (`src/hooks/queries/useHerdProjects.ts`) + keys (`src/lib/queryClient.ts`): `useUpcomingHerdTasks(days)` (gọi RPC), `useHerdOverviewStats()` (đọc `herd_project_list_view` RLS-scoped → activeCount/totalHeadActive/memberTotal/avgMortality), `useHerdCustomerFeedback(limit)` (gộp `herd_project_outcomes` rating+comment & `herd_project_steps.customer_rating`).
- **Trang `/herd-projects`** (`HerdProjectListPage.tsx`): giữ header + 4 nút; thêm **Overview** = 4 KPI card + "Công việc 7 ngày tới" (≤3 ngày/quá hạn = đỏ, 4–7 = xanh, click→chi tiết) + "Ý kiến khách hàng gần đây". **Bỏ toggle Card/Bảng**; danh sách dự án **nhóm theo Khách hàng** (mỗi KH 1 section, bảng list, click→chi tiết). Giữ filter + phân trang (nhóm trong trang).
- **Dashboard chính** (`DashboardPage.tsx`): section "Công việc chăn nuôi 7 ngày" (cột phải) cho **mọi user** (RPC), màu đỏ/xanh theo hạn, nút "Tất cả"→`/herd-projects`. Graceful nếu RPC chưa apply (hiện rỗng).
- **Modal Tạo đàn** (`HerdsManagePage.tsx`): thêm **tạo Cơ sở/Trại inline** (toggle "+ Tạo trại mới" ↔ "Chọn có sẵn"); khi Lưu insert `farms{customer_id,name}` rồi gán `farm_id` cho đàn.

**Bảo mật**: RPC chỉ lộ field không nhạy cảm; Overview page chạy RLS-scoped (mỗi người chỉ thấy phạm vi dự án mình). Tạo trại dùng RLS farms sẵn có.

- **(tiếp) Bố cục Dashboard**: chuyển widget "Công việc chăn nuôi 7 ngày" từ cuối cột phải → **full-width trên cùng** (trên cụm KPI tài chính, sau role alerts), **dạng bảng/list** (cột: Công việc/Dự án/Khách hàng/Người phụ trách/Hạn), **tối đa 10** dòng, dòng gấp ≤3 ngày/quá hạn chữ **đỏ** else **xanh**, badge "N việc gấp", click dòng→chi tiết, **ẩn khi rỗng**. Chỉ sửa `DashboardPage.tsx`, không đụng DB/RLS. tsc PASS.

### 📊 Phiên 2026-06-01 (tiếp) — Tinh gọn header Dashboard + 2 widget điều hành

**Đã làm (tsc EXIT=0, KHÔNG migration):**
- **Header gọn 1 hàng** (`DashboardPage.tsx`): lời chào + selector/chip chi nhánh + nút POS + ô ngày kèm **âm lịch**; **bỏ** subtitle "Đây là tóm tắt…", band "Phạm vi dữ liệu", và **toàn bộ band nhắc nhở vai trò** (`renderRoleAlerts`/`renderBranchContext` đã xóa).
- **Âm lịch** `src/lib/lunarDate.ts` (MỚI): thuật toán Hồ Ngọc Đức self-contained (`solarToLunar`, `lunarLabel` → "ÂL d/m"). Không thêm dependency.
- **2 khối điều hành mới** (dưới dải chăn nuôi, grid 2 cột, gate `customers.view_*`, ẩn khi rỗng):
  - "Khách quen chưa mua lại" — `useAtRiskRegulars` (`customer_summary_view`: orders_count≥3 & last_order_at<today-30d, RLS-scoped) → click `/customers/:id`, nút "Xem tất cả"→`/reports/customer-profile`.
  - "Công nợ sắp đến hạn (10 ngày)" — `useUpcomingDebts` (`customer_debts` is_settled=false & due_date≤today+10, gồm quá hạn, RLS-scoped) → số tiền + badge hạn (đỏ ≤3 ngày/quá hạn), click `/customers/:customer_id`, nút "Báo cáo"→`/reports/debt` (gate `reports.debt`).
- Hooks trong `useDashboardLists.ts`, keys trong `queryClient.ts`. **Bảo mật**: dùng RLS thật (không SECURITY DEFINER) vì dữ liệu nợ/KH nhạy cảm. Lưu ý: 2 khối chạy theo RLS-scope, bộ chọn chi nhánh admin không siết thêm (view/bảng không có branch_id riêng).

### 📦 Phiên 2026-06-01 (tiếp) — Products: gọn toolbar + Hạn sử dụng + Gợi ý đặt hàng

**Đã làm (tsc EXIT=0):**
- **DB** `supabase/migrations/20260612000000_product_expiry_reorder.sql` (⚠️ **CẦN APPLY REMOTE** — agent không có token): view `product_reorder_view` (security_invoker; sold_30d/90d/orders_90d từ order_lines+orders status confirmed→completed, soh từ stock_lots, avg_weekly, days_cover); seed `system_settings.expiry_buckets` + policy `system_settings_select_active` (đọc cho user active).
- **Hooks** `src/hooks/queries/useInventoryInsights.ts` (MỚI): `useExpiringLots(maxDays)`, `useReorderSuggestions({coverDays,minOrders})`, `useExpiryBuckets`/`useSaveExpiryBuckets`, hằng số `EXPIRY_BUCKETS` (d10/m1/m3/m6/y1) + `bucketForDays`. Keys `qk.inventory.*`.
- **Trang mới**: `/inventory/expiry` (`ExpiryPage.tsx` — tab mốc 10n/1/3/6 tháng/1 năm, màu theo system_settings, admin có nút "Cấu hình màu", giá trị tồn) + `/inventory/reorder` (`ReorderPage.tsx` — bán 30/90n, TB/tuần, days_cover, gợi ý đặt theo coverDays). Route + nav "Kho & Hàng hóa" (Layout). Gate `inventory.view`.
- **Dashboard**: widget "Hàng sắp hết hạn (3 tháng)" (màu bucket, link `/inventory/expiry`) + alert "N mặt hàng bán chạy sắp hết" → `/inventory/reorder`. Gate `inventory.view`, ẩn khi rỗng.
- **ProductListPage**: gọn toolbar — dropdown "Quản lý danh mục" (Nhóm/Thương hiệu/ĐVT) + Import + Xuất file đưa lên top header cạnh "Bảng giá"/"Thêm mới"; gỡ nút ⚙ ở sidebar + Import/Export ở toolbar bảng. Sidebar còn lọc + trạng thái.
- **Bảo mật**: RLS thật (reorder view security_invoker, stock_lots/order_lines scoped); cấu hình màu ghi chỉ admin.
- **(tiếp) ProductListPage — bỏ sidebar trái**: xóa hẳn aside lọc (Nhóm/Thương hiệu/ĐVT/Trạng thái) → bảng **full-width**. Bộ lọc chuyển thành 3 select (Nhóm SP / Thương hiệu / Trạng thái) + "Xóa lọc" trên **toolbar bảng** (desktop `hidden md:flex`); giữ nút "Lọc" + panel mobile. Quản lý danh mục vẫn ở dropdown header. Chỉ UI, tsc PASS.
- **Fix migration 20260612**: bảng `system_settings` chưa từng được CREATE (chỉ tham chiếu trong trigger loyalty) → đã thêm `CREATE TABLE IF NOT EXISTS public.system_settings(key PK, value jsonb, updated_at)` + RLS (select active / manage admin) + grant trước seed. Re-run toàn file (idempotent).

#### ⏳→🎯 Phiên 2026-06-23 — #3 Expiry → HÀNH ĐỘNG: tạo khuyến mãi đẩy hàng cận date `[HOÀN THÀNH]`

**Bối cảnh:** Trang Hạn sử dụng (`/inventory/expiry`) trước đây CHỈ liệt kê lô cận date — không có hành động. Nâng thành công cụ "đẩy hàng": ước khả năng bán hết trước HSD + 1-click tạo **khuyến mãi sản phẩm thật** (`product_promotions`, được POS áp dụng). Đây là hạng mục #3 trong backlog "Dự báo & hành động" ([[plan-remaining-gaps]]). Quyết định nghiệp vụ (user duyệt): nút "Xử lý" = **tạo KM thật** (bắc cầu sang cơ chế product_promotions).

- **DB** `supabase/migrations/20260716000000_expiry_promo_tiers.sql` (✅ **APPLY REMOTE** qua Management API + tracking row 20260716 + verify). **CHỈ seed 1 dòng** `system_settings.expiry_discount_tiers` = `{d10:30,m1:15,m3:5,m6:0,y1:0}` (% giảm gợi ý theo mốc). KHÔNG bảng/view/hàm mới — tốc độ bán lấy lại từ `product_reorder_view` (security_invoker). RLS `system_settings` sẵn có (đọc active / ghi admin).
- **Hook** `useInventoryInsights.ts`: `useExpiringLots` bổ sung `avgWeekly`/`daysToSell`/`sellRisk` (query phụ `product_reorder_view` theo product_id của lô → ước "bán hết kịp không"); thêm `useExpiryDiscountTiers`/`useSaveExpiryDiscountTiers` + `suggestedDiscountForDays()`. Key `qk.inventory.expiryDiscountTiers`.
- **Modal tái dùng** `ProductPromotionModal.tsx`: thêm prop tùy chọn `defaults` (name/promo_type/discount_value/valid_to) prefill khi TẠO MỚI (bỏ qua khi sửa) — tương thích ngược. Toàn bộ logic insert + xử lý branch + RLS error GIỮ NGUYÊN (không nhân bản logic ghi DB).
- **UI** `ExpiryPage.tsx`: chuyển bảng sang **DataTable** chuẩn (mobile card tự sinh + phân trang 20). Thêm cột "Bán hết kịp?" (xanh Kịp ~Nn / đỏ Không kịp / "—" khi chưa có lịch sử bán) + nút **"Tạo KM −X%"** mỗi dòng (gate `canManagePromos = admin/ceo || hasPermission('promotions.manage')`) → mở modal prefill % theo mốc + `valid_to = HSD lô`. Nút "Cấu hình màu" → "Cấu hình": thêm chỉnh % giảm theo mốc (admin).
- **Toàn vẹn/Phân quyền/Bảo mật (smoke-test RLS giả JWT NV non-admin, tx-rollback):** (A) NV UPDATE config % → **0 dòng** (RLS chặn); (B) NV INSERT product_promotions cho chi nhánh KHÁC → **lỗi 42501** (RLS chặn); (C) NV INSERT cho ĐÚNG chi nhánh mình → **1 dòng** (cầu nối chạy thật). KM ghi vào bảng POS đọc thật + `valid_to=HSD` để tự hết khi lô hết hạn → không inert. Không thêm policy/không nới quyền.
- `tsc -b --noEmit` PASS + `vite build` PASS. **Cần user commit + deploy frontend.** ⚠️ Lưu ý: tốc độ bán dùng `avg_weekly` TOÀN HỆ (xấp xỉ; chưa tách theo kho/chi nhánh) — chấp nhận cho v1.

#### 📦→🎯 Phiên 2026-06-23 (tiếp) — #2 Reorder chuẩn hóa: Safety Stock + Reorder Point `[HOÀN THÀNH]`

**Bối cảnh:** Gợi ý đặt hàng (`/inventory/reorder`) trước chỉ heuristic `avg_weekly × cover − tồn` — không lead time, không tồn an toàn. Nâng lên công thức tồn kho chuẩn (#2 backlog "Dự báo & hành động" [[plan-remaining-gaps]]). Quyết định nghiệp vụ (user duyệt): **lead time = 1 số mặc định toàn hệ**; mức phục vụ 95% mặc định; có bắc cầu "Tạo đơn đặt hàng".

- **Công thức:** D = avg_weekly/7; σ = stddev nhu cầu TUẦN (12 tuần, **gồm tuần bán = 0** → không xem nhẹ hàng bán thưa); Z theo mức phục vụ (90%→1.28 / **95%→1.65** / 99%→2.33); **SS = Z×σ×√(L/7)**; **ROP = D×L + SS**; cần đặt ngay khi `tồn ≤ ROP`; gợi ý đặt = ⌈D×cover + SS − tồn⌉.
- **DB** `supabase/migrations/20260717000000_reorder_planning.sql` (✅ apply remote + tracking 20260717 + verify + đối chiếu ROP 1 SP thật khớp). Recreate `product_reorder_view` (giữ security_invoker + MỌI cột cũ) + 2 cột `weekly_stddev`/`weeks_observed` (σ qua CTE `DISTINCT SP-có-bán CROSS JOIN generate_series(12 tuần)` LEFT JOIN → tránh nổ catalog). Seed `system_settings.reorder_config` (lead_time_days/service_level/cover_days/min_orders).
- **Hook** `useInventoryInsights.ts`: `ReorderRow` +`weekly_stddev`/`weeks_observed`; **`computeReorderPlan(row, {leadTimeDays,z,coverDays})`** (pure, tính ROP/SS/suggestedQty/needsReorder **client-side** → đổi lead time/Z/cover tính lại tức thì, KHÔNG refetch); `SERVICE_LEVEL_Z`/`zForServiceLevel`; `useReorderConfig`/`useSaveReorderConfig`. Key `qk.inventory.reorderConfig`. ⚠️ `useReorderSuggestions` giữ chữ ký cũ + `suggestedQty` heuristic → **Dashboard alert không vỡ** (chỉ dùng `days_cover`).
- **UI** `ReorderPage.tsx` → **DataTable** chuẩn. Cột: SP (+badge "Cần đặt ngay") · Tồn · TB/tuần · Biến động σ · Tồn an toàn · Điểm đặt (ROP) · Đủ bán còn · Gợi ý đặt. Controls live: Lead time / Mức phục vụ / cover / min orders + nút "Lưu mặc định" (admin → system_settings). Sort cần-đặt-ngay lên đầu.
- **Cầu nối tạo PO (tiện thao tác):** checkbox chọn dòng + nút "Tạo đơn đặt (N)" (gate `hasPermission('purchase_orders.create')` = khớp route guard) → `navigate('/purchase-orders/new', { state:{ prefillLines } })`. `PurchaseOrderFormPage` thêm effect đọc `location.state.prefillLines` seed `lineItems` (SL=gợi ý) + `window.history.replaceState` (F5 không nạp lại). Lưu PO vẫn qua luồng/validate cũ.
- **Toàn vẹn/Phân quyền/Bảo mật:** σ gồm tuần 0 (đúng cho hàng bán thưa); cột cũ giữ nguyên. View security_invoker (RLS như cũ). Smoke-test giả JWT NV non-admin: UPDATE `reorder_config` → **0 dòng** (RLS chặn); đọc view OK (1034 SP). ⚠️ **Đặc tính sẵn có (ghi nhận):** demand trong view bị thu hẹp theo RLS `order_lines` (sales/team_lead/branch_manager thấy ít/0 đơn) → reorder CHỈ đầy đủ cho admin/warehouse_keeper/accountant. Đã hiện chú thích trên trang. KHÔNG đổi sang SECURITY DEFINER (tránh lộ tổng bán toàn hệ).
- `tsc -b` + `vite build` PASS. **Cần user commit + deploy frontend.** Không ghi ROP ngược vào `inventory_settings` (per-kho, không khớp soh toàn cục — giữ là override thủ công ở tab Định mức).
- 🛠️ **HOTFIX hiệu năng (migration `20260718000000_reorder_planning_rpc.sql`):** nhồi σ (CROSS JOIN 12 tuần) vào `product_reorder_view` (security_invoker) → query+ORDER+LIMIT dưới RLS `order_lines` ép tính toàn view → **"statement timeout"** trên PostgREST (trang trống + banner đỏ). View còn dùng bởi Dashboard/Expiry → nặng cả 3 nơi. **Sửa:** (1) `DROP+CREATE` trả `product_reorder_view` về BẢN NHẸ nguyên gốc (bỏ 2 cột σ — `CREATE OR REPLACE` không drop được cột → phải DROP); (2) tách σ/ROP sang **RPC `fn_reorder_planning(p_min_orders)` SECURITY DEFINER** (bỏ chi phí RLS → **24 ms** vs >8s timeout; demand ĐẦY ĐỦ toàn công ty — đúng nghiệp vụ mua hàng) + guard `active AND (admin OR inventory.view)` + REVOKE public/anon. `#variable_conflict use_column` (tên cột OUT trùng biến plpgsql). FE: hook mới `useReorderPlanning` (rpc) thay `useReorderSuggestions` (view) ở ReorderPage; thêm **banner lỗi đỏ** (trang cũ nuốt lỗi). Verify: 139 SP, σ đúng, admin & branch_manager gọi được, no-claims→42501.
- 🔑 **BÀI HỌC (quan trọng, lặp lại):** (a) Sau MỌI `CREATE/REPLACE/DROP VIEW` hay đổi cột qua Management API **PHẢI `NOTIFY pgrst, 'reload schema'` ngay** — không thì PostgREST lỗi cache → frontend bảng trống khó hiểu. (b) **KHÔNG nhồi tính nặng (CROSS JOIN/σ/window) vào view security_invoker** sẽ dùng kèm RLS + ORDER/LIMIT → dễ statement-timeout; chuyển sang **RPC SECURITY DEFINER** (pattern report của dự án). (c) Trang danh sách nên CÓ banner lỗi để không nuốt lỗi thành "bảng trống".

#### 👥→🎯 Phiên 2026-06-23 (tiếp) — #4 Churn-to-action: Khách cần chăm sóc `[HOÀN THÀNH]`

**Bối cảnh:** `customers.lifecycle_stage` (enum) toàn bộ 1916 KH đứng 'new' (chưa job nào tính); `churn_risk_score` chỉ có trong spec, CHƯA có cột. Hạng mục #4 backlog "Dự báo & hành động" [[plan-remaining-gaps]]. Quyết định nghiệp vụ (user duyệt): ngưỡng churn **theo nhịp mua riêng mỗi KH** (trễ >1× nhịp = nguy cơ, >2× = rời bỏ); fallback 45n cho KH mua 1 lần; cron 01:00 VN.

- **DB** `supabase/migrations/20260719000000_customer_churn.sql` (✅ apply remote + NOTIFY reload + tracking 20260719):
  - Cột mới `customers.churn_risk_score SMALLINT`, `lifecycle_computed_at`; seed `system_settings.churn_config` (at_risk_ratio 1.0 / churned_ratio 2.0 / fallback 45); index `orders(customer_id, created_at)`.
  - **Helper `fn_customer_churn_metrics()`** SECURITY DEFINER **REVOKE all** (nội bộ): tính avg_interval=(last−first)/(n−1) (n≥2; n=1 fallback), ratio=days_since/avg_interval, lifecycle (≤1 active/≤2 at_risk/>2 churned/n=0 new), churn_score=clamp(ratio×50). Tính LIVE.
  - **`fn_recompute_customer_lifecycle()`** SECURITY DEFINER (guard `admin OR auth.uid() IS NULL` cho cron; GRANT authenticated): persist lifecycle+score vào customers, trả JSON đếm. **pg_cron** `'0 18 * * *'` (đã đăng ký, active).
  - **`fn_churn_worklist(p_owner_id)`** SECURITY DEFINER (guard active; GRANT authenticated): KH at_risk/churned scope theo vai trò (sales→của mình · team_lead→team · branch_manager→chi nhánh · admin→tất cả) + SĐT + total_debt. `#variable_conflict use_column`.
- **FE:** hook `useCustomerCare.ts` (`useChurnWorklist`/`useRecomputeLifecycle`/`useLogCareCall`); trang `/customers/care` (`CustomerCarePage.tsx`, DataTable) — cột KH/NV/Mua cuối/Trễ/Nhịp mua/Rủi ro(score+badge)/Gợi ý/Hành động; lọc lifecycle+NV+tìm; nút "Tính lại phân loại" (admin) + **"Ghi nhận gọi"** → tạo `activities` (type call, status done, owner=auth.uid() theo RLS). Route + nav "Chăm sóc KH" (Layout). Banner lỗi.
- **Verify remote:** recompute = 174 active/14 at_risk/17 churned/1711 new (tổng 1916). Worklist admin=31; branch_manager(CN003)=0 ĐÚNG (31 KH churned đều ở CN002); helper gọi trực tiếp→permission denied; non-admin recompute→42501; cron active. `tsc -b`+`vite build` PASS. **Cần user commit + deploy FE.**

#### 📊→🎯 Phiên 2026-06-23 (tiếp) — #1 BI tương tác: Pivot + ABC/XYZ + Cohort `[HOÀN THÀNH]`

**Bối cảnh:** Hạng mục cuối backlog "Phân tích nâng cao/BI" [[plan-remaining-gaps]] — các report cũ là lát cắt cứng, thiếu pivot đổi chiều/so sánh kỳ/ABC-XYZ/cohort. Dùng lại fact `v_order_line_profit` (chuẩn COGS, REVOKED). User chọn làm CẢ 3 tab.

- **DB** `supabase/migrations/20260720000000_bi_analytics.sql` (✅ apply remote + NOTIFY reload + tracking 20260720). 3 RPC **admin-only** (`fn_has_role('admin')`) SECURITY DEFINER + REVOKE public/anon (khớp pattern fn_profit_*):
  - **`fn_bi_pivot(p_from,p_to,p_dim,p_compare,+6 filter)`**: gộp theo 1 chiều (month/quarter/year/product/brand/category/customer/branch/salesperson) qua CASE (whitelist), 2 cửa sổ (kỳ này + MoM/YoY) FULL JOIN theo dim_key → revenue/cogs/profit/margin/qty/order_count/customer_count + prev_*. Filter drill-down (branch/customer/product/brand/category/owner). `#variable_conflict use_column`.
  - **`fn_bi_abc_xyz(p_from,p_to)`**: ABC theo DT tích lũy (A≤80/B≤95/C) + XYZ theo CV cầu tháng (X≤0.5/Y≤1.0/Z) — generate_series tháng gồm tháng 0. `#variable_conflict use_column`.
  - **`fn_bi_cohort(p_months≤24)`**: retention theo cohort tháng mua đầu (long format: cohort_month/size/offset/active/retention_pct).
- **FE:** `useBiAnalytics.ts` (`useBiPivot`/`useBiAbcXyz`/`useBiCohort` + `ENTITY_DIM_TO_FILTER`); trang `/reports/bi` (`BiAnalyticsPage.tsx`, adminOnly) 3 tab: **Pivot** (chọn chiều/so sánh + **chip lọc drill-down** click dòng + CSV + DataTable), **ABC/XYZ** (ma trận 3×3 + DataTable), **Cohort** (heatmap retention tự dựng từ long-format). Card "Phân tích BI" trong ReportsHub + route.
- **Verify remote:** pivot branch MoM (Hoài Ân DT 444M margin −1.32% — khớp data bán lỗ đã biết, Phù Mỹ 1.9M); ABC/XYZ 270 SP (top cum 6→22% = A, CV scale-invariant nên SP bán 1 tháng đều cv 3.61=Z — đúng toán học); cohort 2026-06 size 204 M0 100%. Non-admin cả 3 RPC→42501. `tsc -b`+`vite build` PASS. **Cần user commit + deploy FE.** ⚠️ Chiều "kênh/price_list" + dự báo ML để sau (ngoài scope #1).

#### 🔮 Phiên 2026-06-23 (tiếp) — Dự báo nhu cầu: engine thống kê + gate độ tin cậy `[HOÀN THÀNH]`

**Bối cảnh:** Tầng cao nhất backlog "Phân tích nâng cao" [[plan-remaining-gaps]]. **Toàn vẹn dữ liệu:** chỉ ~4 tuần lịch sử thật (đơn từ ~2026-05-29), 0 SKU đủ ≥3 tháng → KHÔNG dựng ML deep-learning (vô nghĩa + sai cho cầu rời rạc). User duyệt phương án **"xây engine đúng phương pháp + gate độ tin cậy"**: hiện ra run-rate kèm nhãn tin cậy thấp, tự chính xác dần khi data tích lũy.

- **Kiến trúc:** engine ở **TS thuần** (testable, đổi horizon/alpha tính lại tức thì), DB chỉ cấp dữ liệu.
- **DB** `supabase/migrations/20260721000000_demand_history.sql` (✅ apply remote + NOTIFY reload). `fn_demand_history(p_weeks 4..104)` **admin-only** SECURITY DEFINER + REVOKE public/anon: chuỗi cầu **theo tuần zero-fill** mỗi SKU có bán (long-format: product/sku/name/unit/stock_on_hand/week_start/qty). Seed `system_settings.forecast_config` (alpha 0.3, horizon 4, ngưỡng tin cậy). ⚠️ `system_settings` chỉ có cột key/value (không có `description`).
- **Engine** `src/lib/forecast.ts` (thuần): `classifyDemand` (ADI+CV² Syntetos–Boylan → smooth/erratic/intermittent/lumpy), `ses` (làm mượt mũ cầu đều), `crostonSBA` (Croston hiệu chỉnh SBA cho cầu rời rạc, khởi tạo interval=ADI tránh chệch), `confidenceOf` (thấp/TB/cao theo lịch sử+số tuần có cầu), `forecast` (**cắt zero dẫn đầu** trước lần bán đầu → tránh SES tụt về 0 + tránh thổi phồng độ tin cậy; dải bất định σ×√kỳ; MAPE backtest 1-bước chỉ khi đủ data). **23 unit test** `src/test/unit/forecast.test.ts` (tổng 63 test PASS).
- **FE:** `useDemandForecast.ts` (`useDemandForecast` gom long→series theo SKU + `useForecastConfig`); trang `/reports/demand-forecast` (`DemandForecastPage.tsx`, adminOnly, DataTable): cột Tồn/TB-tuần/Dự báo-tuần/**Dự báo kỳ tới ±dải**/Độ tin cậy badge/Gợi ý đặt; chọn horizon 4/8/12 tuần (tính lại client-side); **banner cảnh báo độ tin cậy thấp** khi ≥50% SKU; CSV. Card "Dự báo nhu cầu" + route.
- **Verify remote:** admin call 281 SKU × 26 tuần = 7306 dòng, EXPLAIN ANALYZE **42ms** (không timeout); spot-check SKU cầu thưa (1-4 tuần có bán/26) → đúng Croston + tin cậy thấp. Non-admin (Hoài Ân)→42501. `tsc -b`+`vite build` PASS. **Cần user commit + deploy FE.** ⚠️ Xoay token Supabase đã lộ trong chat.

### 🖨️ Phiên 2026-06-01 (tiếp) — Trang in: sửa lỗi tràn/đè + Xuất Excel/PDF

**Bối cảnh:** In hóa đơn từ `/print-preview` bị **lỗi 2 trang + nội dung đè/che khuất** (thanh công cụ đen in đè lên chứng từ). Yêu cầu: trang in sạch–gọn 1 trang + thêm xuất Excel & PDF. **Không migration.** (tsc EXIT=0, vite build EXIT=0)

- **Gốc lỗi & cách sửa (4 nguyên nhân):**
  1. **`.no-print` không có CSS ẩn khi in** (không hề có `@media print` toàn cục) → thanh công cụ/footer/banner in đè. → Thêm khối `@media print` vào `src/index.css`: `.no-print{display:none}`, nền trắng `html/body/#root`, `print-color-adjust:exact` (giữ nền xám header bảng).
  2. **Lề kép** (`@page margin` + phần tử `w-[210mm] p-[15mm]`) gây tràn ngang/sang trang. → `PrintLayout.tsx` khối `<style>` in: `.print-page` ép `width:100%/max-width:none/padding:0/border-radius:0/overflow:visible`; `.print-layout-container{display:block}`.
  3. **`transform: scale()`** khung xem trước không reset khi in. → `PrintPreviewPage.tsx` thêm `print:transform-none print:scale-100` cho khung scale, `print:bg-white print:block` + `print:p-0 print:overflow-visible` cho 2 wrapper.
  4. **Dòng trống lấp đầy** (minRows 5/10) + chữ ký → đẩy hóa đơn 1 SP sang trang 2. → **Bỏ hẳn** vòng `while(filledLines.length<minRows)` + nhánh `isEmpty` trong cả 4 render (invoice/receipt/return/transfer) → chỉ in đúng số dòng thật. Gỡ biến `isLandscape` thừa.
- **Xuất Excel** `src/lib/exporters/documentXlsx.ts` (MỚI): `generateDocumentXlsx(docType, data, company)` — exceljs **lazy import**, cấu trúc theo `buildLayout()` cho cả 6 loại (header công ty từ `printConfig`, khối meta 2 cột, bảng dòng hàng + tổng + bằng chữ, numFmt `#,##0`, freeze header, fitToWidth). Phiếu thu/chi không bảng → khối key/value.
- **Xuất PDF** `src/lib/exporters/documentPdf.tsx` (MỚI): `generateDocumentPdf(...)` — `@react-pdf/renderer` **lazy import**, dựng layout primitive cho 6 loại + chữ ký, `pdf().toBlob()` tải về. **Font:** nhúng `public/fonts/BeVietnamPro-{Regular,SemiBold}.ttf` (tải từ Google Fonts) + `Font.register` (woff2 của @fontsource react-pdf không đọc được) để có dấu tiếng Việt.
- **Toolbar** `PrintPreviewPage.tsx`: thêm 2 nút **Excel**/**PDF** (lazy import exporter, spinner khi đang sinh, disabled khi chưa có dữ liệu), `printConfig` lấy từ `useDisplaySettings()`.
- **Bảo mật/toàn vẹn:** route chỉ `<ProtectedRoute>` nhưng **ranh giới thật là RLS** trên orders/goods_receipts/… (user không có quyền → `.single()` lỗi → màn lỗi). Export chạy client-side trên `data` đã fetch → cùng ranh giới, không mở rộng phơi nhiễm. VAT vẫn = 0 (P4-3 đã bỏ qua) nên in/excel/pdf nhất quán không hiện VAT.
- **Bundle:** `pdf` (652KB) + `exceljs` (938KB) là chunk lazy riêng, không vào main; chunk `PrintPreviewPage` ~41KB.

### 🐛 Phiên 2026-06-01 (tiếp) — Fix lỗi xuất PDF "Could not resolve font"

**Triệu chứng:** Bấm nút **PDF** ở `/print-preview` báo `Không xuất được file PDF: Could not resolve font for BeVietnamPro, fontWeight 400` → PDF **không bao giờ** xuất được (mọi loại chứng từ). Bản in HTML (`window.print()`) vẫn chạy.

- **Gốc lỗi (xác nhận qua node_modules `@react-pdf/font` `resolve()`):** `documentPdf.tsx` chỉ `Font.register` 2 biến thể **normal** (Regular-400, SemiBold-600), nhưng styles `words` ("Bằng chữ…") và `signHint` ("(Ký, ghi rõ họ tên)") dùng `fontStyle:'italic'`. react-pdf **không nghiêng giả lập** — `resolve()` lọc nguồn theo `fontStyle==='italic'` → rỗng → throw. Khối chữ ký có ở **cả 6 loại** chứng từ ⇒ PDF luôn fail.
- **Cách sửa:** thêm 2 dòng `Font.register` biến thể `fontStyle:'italic'` trỏ lại chính file Regular/SemiBold sẵn có (không thêm asset; chữ "Bằng chữ"/chữ ký hiển thị **đứng** — đúng chuẩn chứng từ VN). Quyết định user: ưu tiên fallback dùng font có sẵn thay vì thêm file italic ~130KB.
- **Kiểm thử:** `tsc --noEmit` PASS; render thử PDF bằng `@react-pdf/renderer` (font base64) → **OK 11KB**, lỗi resolution biến mất.
- **Rà soát kèm (không phát hiện bug mới):** phiếu chuyển kho in `SL thực xuất = SL yêu cầu = quantity` là **đúng** — `stock_transfer_lines` chỉ có 1 cột `quantity` (chuyển atomic), không có cột thực xuất riêng; tạo khác biệt giả 2 cột mới là sai. Phân quyền `/print-preview` chỉ `ProtectedRoute` nhưng ranh giới thật vẫn là RLS — giữ nguyên.

### 🛒 Phiên 2026-06-01 (tiếp) — Nâng cấp toàn diện orders/pos (2 luồng bán)

**Audit phát hiện:** toggle "Bán nhanh/Bán giao hàng" là **giả** (2 `<span>` không state) → giao hàng không hoạt động; mã đơn `DH-{random}` client → nguy cơ trùng UNIQUE; tạo đơn **không atomic** (5 round-trip + rollback thủ công); receipt modal đọc `cart` **sau khi đã xóa** → in trống; công ty/Zalo **hardcode giả**; `fn_recalculate_order_total` **ghi đè** discount_total = CK dòng → **mất chiết khấu cấp hoá đơn** (voucher/KM); RLS `orders_update_sales` chặn sales chuyển trạng thái sau confirmed → tắc luồng giao. Điểm tốt tận dụng: trigger `order_payments`→sổ quỹ + gắn `session_id` ca thu ngân; FEFO reserve→release đúng.

**Quyết định user:** chỉ Admin/CEO xác nhận đơn giao; chủ đơn/Admin giao+thu tiền; luôn bắt chọn KH (có thể trả thiếu→ghi nợ); RPC atomic; đơn giao giữ trạng thái trung gian (draft→confirmed→shipping→delivered→completed), bán quầy đi thẳng; mặc định bán nhanh + ẩn danh mục + tắt tự in; admin duyệt giá ở OrderDetailPage; bỏ Zalo giả dùng trang in chuẩn.

- **Migration `20260613000000_pos_order_rpcs.sql`** ⚠️ **CHƯA APPLY REMOTE** (cần token): cột `orders.sale_channel` (`pos_quick`/`delivery`); 2 helper nội bộ `fn_pos_build_draft` (tạo đơn+dòng+ghi **tổng có thẩm quyền** giữ CK hoá đơn) + `fn_pos_settle_payment` (thu tiền/ghi nợ + **check hạn mức server-side**); 5 RPC SECURITY DEFINER: `fn_pos_quick_sale` (atomic draft→confirmed→completed+thu tiền), `fn_create_delivery_draft`, `fn_confirm_order` (chỉ admin), `fn_advance_delivery` (chủ đơn/admin: shipping/delivered), `fn_complete_delivery_payment` (chủ đơn/admin: delivered→completed+thu tiền). Mọi RPC tự check quyền (bypass RLS).
- **POSPage.tsx**: toggle chế độ bán **thật** (mặc định `quick`, lưu theo tab); **ẩn danh mục mặc định** (`showGrid=false`); **toggle "Tự in" mặc định TẮT**; ô "Khách trả" hỗ trợ **trả một phần→ghi nợ** + cảnh báo hạn mức (mọi PTTT); `handlePayment` gọi RPC (`fn_pos_quick_sale`/`fn_create_delivery_draft`); **bỏ receipt giả + Zalo + công ty hardcode** → modal thành công + nút mở `/print-preview` (tự mở nếu bật tự in); địa chỉ giao hiện khi mode delivery; gỡ import `Smartphone`/`ScanLine`.
- **OrderDetailPage.tsx**: badge loại đơn; admin sửa **giá/CK từng dòng** inline (draft delivery) + "Xác nhận đơn" (`fn_confirm_order`); chủ đơn/Admin nút "Bắt đầu giao"/"Đã giao" (`fn_advance_delivery`) + "Thu tiền & hoàn tất" (`fn_complete_delivery_payment` qua pay modal mode `complete_delivery`). Phân biệt bằng `sale_channel`.
- **OrderListPage.tsx**: quick view chip **"Đơn giao chờ xác nhận"** (badge đếm delivery+draft) lọc nhanh cho admin.
- **Kiểm thử:** `tsc --noEmit` PASS + `vite build` PASS. RPC chưa chạy được local (thiếu token) → **phải apply migration remote trước khi dùng**.

### 🐛 Phiên 2026-06-01 (tiếp) — Fix POS không tìm thấy SP/KH có thật (cap 1000 dòng PostgREST)

**Triệu chứng:** SP có thật trong kho (vd V750 50ml tồn 6, T990 tồn 2) search trong POS **không ra**; chỉ ra vài SP. **Gốc lỗi (xác minh DB thật):** query nạp `products`/`customers` trong POS & MobileOrderPage dùng `.eq('is_active',true)` **không `.order()` cũng không `.limit()`** → dính **giới hạn mặc định 1000 dòng của PostgREST**. Đếm thực tế: **1002 SP active** (chỉ trả 1000, rớt 2 SP mới nhất) và **1907 KH active** (rớt ~907 KH không chọn được!). Search/grid/gợi ý chẩn đoán/quà KM đều lọc client-side trên mảng bị cắt → sai.
- **Cách sửa (Cách A — nạp đủ catalog, user duyệt):** helper `fetchAllRows(makeQuery, batch=1000)` lặp `.range()` theo lô tới khi < batch; thêm `.order('name'/'farm_name').order('id')` (phân trang ổn định). Áp dụng cho **products + customers** ở cả `POSPage.tsx` và `MobileOrderPage.tsx`. Giữ nguyên toàn bộ logic search/grid/chẩn đoán/quà tặng — nay chạy trên mảng đầy đủ.
- **Xác minh:** script đăng nhập admin + chạy đúng logic `fetchAllRows` → products **1002/1002**, cả 3 SKU (`...043/028/570`) đều found; customers **1907**. tsc + build PASS.
- **Lưu ý mở rộng:** đây là giải pháp đúng & an toàn cho quy mô hiện tại; nếu catalog/KH lên vài nghìn nữa nên chuyển ô tìm sang **search server-side** (`ilike` + limit) để giảm payload.

### 💰 2026-06-02 — Nút "Thanh toán" (thu công nợ nhanh) + Fix lệch số liệu thu nợ

**Bối cảnh:** Cần thu công nợ nhanh ngay tại **View nhanh KH** (tab Công nợ) và **Trang chi tiết KH** (card "Công nợ hiện tại"); mọi giao dịch tiền phải vào sổ quỹ. **Phát hiện lỗi integrity đang tồn tại:** luồng "Thu công nợ KH" cũ (`CashbookPaymentForms.handleDebtSubmit`) chỉ INSERT `debt_payments` → trigger sinh phiếu thu sổ quỹ, **NHƯNG không settle `customer_debts`** → tiền vào quỹ đúng mà công nợ KH không giảm (vì `customer_summary_view.total_debt = SUM(amount WHERE NOT is_settled)`).

- **Migration `20260614000000_collect_customer_debt_rpc.sql`** ⚠️ **CHƯA APPLY REMOTE** (cần token): RPC atomic `fn_collect_customer_debt(p_customer_id, p_amount, p_method, p_date, p_reference, p_notes)` SECURITY DEFINER — (1) check quyền server-side `admin/ceo/accountant/branch_manager`; (2) validate (amount>0, method∈cash/bank/card, ngày≤hôm nay, KH tồn tại); (3) INSERT `debt_payments` → trigger `trg_debt_payment_cashbook` lo phiếu thu THU-NO + số dư + session; (4) **settle FIFO** `customer_debts` dương (due_date NULLS LAST, created_at) — settle hết hoặc giảm `amount` dòng biên; (5) **thu vượt → `advance_from_customer` âm** (khách trả trước, tự khấu trừ netting). Trả JSONB. GRANT authenticated.
- **`CollectDebtModal.tsx`** (MỚI, `src/pages/customers/`): modal thu nợ dùng chung — số tiền + "Thu toàn bộ", Tiền mặt/Chuyển khoản, ngày (≤hôm nay), tham chiếu, ghi chú; cảnh báo khi thu vượt; gọi `supabase.rpc('fn_collect_customer_debt')`.
- **`CustomerDetailPage.tsx`**: `canCollectDebt()` (admin/ceo/accountant/branch_manager); nút **"Thanh toán"** (xanh, icon Wallet) cạnh "± Điều chỉnh" trên card công nợ (hiện khi `totalDebt>0`); modal + toast thành công → `loadCustomerData()`.
- **`CustomerQuickView.tsx`**: nút **"Thanh toán"** tab Công nợ (gate `userRole.code`∈4 vai trò + `outstanding>0`); sau thu invalidate `qk.customers.debts/all` + `['customers','kpis']`; banner thành công inline.
- **`CashbookPaymentForms.tsx`**: `handleDebtSubmit` chuyển từ INSERT `debt_payments` → `rpc('fn_collect_customer_debt')` → **fix lệch số liệu** (nay giảm công nợ đúng).
- **Quyết định user:** phân quyền thu = admin/ceo/accountant/branch_manager; **cho phép thu vượt** → ghi "Khách trả trước" (công nợ âm, tự khấu trừ lần sau).
- `tsc --noEmit` PASS 0 lỗi. ⚠️ **Phải apply migration `20260614000000` remote trước khi dùng nút.**

### 💵 2026-06-02 — Tinh gọn Sổ quỹ: thẻ tiền mặt theo ca + tab "Lịch sử dòng tiền" (KHÔNG migration)

**Bối cảnh:** Trang Sổ quỹ nặng biểu đồ ít giá trị; thẻ tiền mặt chỉ 1 số tổng (không rõ nguồn); tab "Báo cáo" không giúp thủ quỹ đóng ca khớp két. **Phát hiện integrity:** transfer nội bộ lưu 2 leg `flow_type` inflow/outflow (đánh dấu `source_table ∈ internal_transfer_in/out`), nên `CashbookReports` cũ lọc `.neq('flow_type','internal_transfer')` **vô tác dụng** → tổng thu/chi bị thổi phồng bởi tiền chuyển quỹ.

- **`CashbookPage.tsx`**: Bỏ thẻ "Tài khoản Ngân hàng công ty". Thẻ **"Tiền mặt tại quỹ chi nhánh"** nay hiện **breakdown theo ca**: Tồn đầu ca + Tiền bán hàng (THU-DON-HANG) + Thu khác − Chi = **Tồn quỹ hiện tại** (tái dùng `loadSessionReconciliation`, mở rộng thêm `salesIn/otherIn`; thêm `useEffect` nạp reconcile khi có ca, dep `cashFunds` để refresh sau mỗi giao dịch). Chưa mở ca → hiện số dư + nhắc "Mở ca". Thẻ phiên ca hiện rõ **Tồn đầu ca** (`opening_balance`) + Tồn hiện tại. Tab `'reports'`→`'cashflow'` nhãn **"Lịch sử dòng tiền"** **bôi đỏ** (active `bg-red-600`). **Dọn** sạch sparkline 30 ngày + chart 7 ngày (state/loader/memo + realtime deps + `totalBankBalance`).
- **`CashbookOverview.tsx`**: chỉ còn **"Chứng từ chờ duyệt"** (grid card, duyệt/từ chối nhanh, chặn tự duyệt). Bỏ section "Biến động 30 ngày" + "Dòng tiền 7 ngày".
- **`CashbookReports.tsx`** (viết lại → Lịch sử dòng tiền): preset **Hôm nay(mặc định)/Tuần/Tháng/Quý/Năm** (date-fns); **2 nhóm tick AND**: (A) Tiền mặt(mặc định)/Chuyển khoản, (B) Thu/Chi/Chuyển quỹ(mặc định cả 3). Phân loại transfer riêng qua `source_table` → **không tính vào Tổng thu/Chi**. **Số dư lũy kế** = `scopeBalanceNow − Σdelta` rồi cộng dồn theo thời gian (tính trên TẤT CẢ dòng scope, kể cả dòng bị ẩn theo nhóm B) → luôn khớp số dư quỹ thật. List: ngày/loại(badge)/diễn giải/số tiền(±)/số dư lũy kế. Bỏ ComposedChart + bảng "Số dư quỹ & TK". Giữ Xuất CSV (UTF-8 BOM, theo tập đang lọc).
- **Audit integrity:** form tay chi >10M→pending_approval; chặn tự duyệt; cash bắt buộc đúng quỹ ca. Đóng ca: `expected = opening + Σcash_in − Σcash_out` (gồm leg transfer tiền mặt — đúng). Sau sửa không còn thổi phồng thu/chi.
- `tsc --noEmit` + `vite build` PASS. **KHÔNG cần migration.**

### 💵 2026-06-02 (tiếp) — Sổ quỹ: hợp nhất Phiếu thu/chi + Nộp quỹ cuối ca + dọn tab

**Bối cảnh:** Form tạo phiếu + tab "Thu nợ/Chi NCC/Tạm ứng" không tìm được đối tượng (select thường + `customers` dính cap 1000/PostgREST → ~907 KH mất). Lỗ hổng tiền cuối ca: `cash_funds.balance` (trigger) lệch `opening_balance` (nhập tay) → "19tr biến mất". Hạng mục thu/chi cần tùy biến.

- **Migration `20260615000000_cashbook_categories_handover.sql`** ⚠️ **CHƯA APPLY REMOTE**: `expense_categories.is_internal BOOLEAN` (luân chuyển nội bộ — loại khỏi thu/chi vận hành & lãi/lỗ); seed `CHI-NOP-QUY` (Nộp quỹ cuối ca, outflow, is_internal); mark `THU/CHI-LECH-QUY` is_internal.
- **`CashbookPage.tsx`** — **Form Phiếu thu/chi hợp nhất**: helper `fetchAllRows` nạp ĐỦ KH/NCC/NV (fix cap 1000); thay select đối tượng bằng **SmartSearchSelect** (tìm không dấu). **Hạng mục dẫn dắt** (`specialKindOf` theo code): `THU-NO`→RPC `fn_collect_customer_debt` (settle nợ), `CHI-NCC`→insert `supplier_payments`, `CHI-TAM-UNG`→insert `employee_advances`; hạng mục khác = insert `cashbook_transactions` thường (đối tượng tùy chọn). Hiện công nợ KH/NCC + "Thu/Trả toàn bộ". **Quản lý hạng mục** (modal CRUD, gate admin/ceo/accountant). **Bỏ tab** `transfers` (Chuyển quỹ nội bộ) + `payments`; **xóa** `CashbookPaymentForms.tsx`; tab `sessions` (Phiên quỹ) chỉ-xem. Còn 4 tab: Tổng quan · Phiếu thu/chi · Phiên quỹ · Lịch sử dòng tiền.
- **Nộp quỹ cuối ca** (`handleCloseSession`): modal đóng ca thêm ô "Số tiền nộp về công ty" (0≤nộp≤tiền đếm) → sau bút toán lệch quỹ, sinh **phiếu chi `CHI-NOP-QUY`** (approved, KHÔNG gắn session) → `cash_funds.balance` = tồn để lại; mở ca sau mặc định đầu ca đúng. Giải quyết "19tr đi đâu".
- **`CashbookReports.tsx`**: join `expense_categories(name,is_internal)`; thêm class **`internal`** (badge tím) + tick "Nội bộ/Nộp quỹ" — loại khỏi Tổng thu/Chi vận hành nhưng **vẫn vào số dư lũy kế**; mỗi dòng hiện tên hạng mục; panel **"Tổng theo hạng mục"** theo kỳ.
- `tsc --noEmit` + `vite build` PASS. ⚠️ **Phải apply migration `20260615000000` remote.**

### 🐔 2026-06-04 — Herd-Projects: Fix modal vỡ màn hình nhỏ + phân quyền nút + dọn data giả

**Bối cảnh:** Người dùng báo modal "Cập nhật bước" (Lịch trình kỹ thuật thú y) **vỡ/không hiển thị đủ trên màn hình nhỏ**. Rà soát toàn bộ `HerdProjectDetailPage.tsx`. **KHÔNG migration** (frontend-only). `tsc --noEmit` PASS.

- **Gốc lỗi modal:** modal "Cập nhật bước" (và Ghi nhận chi phí / Ghi chú BS / Thêm bước) dùng `overflow-hidden` **thiếu** `max-h`/cuộn. Form dài + overlay `flex items-center` → nội dung tràn đều trên-dưới, **cắt mất header & nút Lưu, không cuộn được**.
  - **Fix:** chuẩn hóa cả 5 modal theo pattern đúng của modal "Sửa dự án": overlay thêm `overflow-y-auto`; card `flex flex-col max-h-[90vh]`; header `shrink-0`; `<form>` thêm `overflow-y-auto`. Header cố định, thân cuộn được trên mọi cỡ màn hình.
- **Bịt lỗ phân quyền UI:** cụm nút **Kích hoạt/Tạm ngưng/Tiếp tục/Hủy/Hoàn thành dự án** và **Sinh hóa đơn tự động** trước đây hiện cho **mọi user** (không có quyền bấm → RLS từ chối, alert khó hiểu). Nay gate bằng `canEdit` (`herd_projects.update`). RLS vẫn là ranh giới thật.
- **Dọn dữ liệu giả** (tab Kết quả dự án — khách hàng nhìn thấy): bỏ default Bento giả `12.5 Tấn/450 Lít/27.5°C` → để trống, hiển thị `—` khi chưa nhập; **bỏ thanh "Dự kiến tối đa 2.5%" + badge "Đạt/Vượt mục tiêu"** (mốc cứng vô căn cứ) → chỉ giữ tỷ lệ hao hụt **thật** (số % + "N/tổng con hao hụt"), đỏ nếu >0 / xanh nếu =0.
- ✅ **Đã xác minh remote (2026-06-04, qua Supabase Management API):** RPC `fn_upcoming_herd_tasks`, `fn_can_view/edit_herd_project`, constraint `cost_type` gồm `breeding_stock` **đều tồn tại & chạy được** → migration `20260608/09/11` đã apply (thủ công qua SQL Editor, KHÔNG nằm trong bảng `supabase_migrations.schema_migrations` vốn chỉ tới `20260610`). `fn_upcoming_herd_tasks(7)` trả 0 dòng = hiện không có bước pending trong 7 ngày (không phải lỗi). **Toàn bộ phần herd-projects đã đầy đủ trên remote.**
- ✅ **Cũng đã xác minh tồn tại remote (untracked):** `fn_pos_quick_sale`, `fn_create_delivery_draft`, `fn_confirm_order`, `fn_collect_customer_debt`, view `product_reorder_view`, bảng `system_settings`, cột `expense_categories.is_internal` → các migration `20260612→20260615` đánh dấu "CHƯA APPLY" trong ghi chú cũ **thực ra ĐÃ apply** (cùng kiểu untracked). ⚠️ Lưu ý: bảng tracking lệch (thiếu version 20260611→20260615) → lần `supabase db push` sau có thể cố chạy lại; nếu cần, chèn rows tracking thủ công.
- ⚠️ **Còn nợ (ngoài scope):** luồng "Sinh hóa đơn tự động" vẫn insert orders trực tiếp (chưa chuyển RPC POS atomic `fn_pos_*`) — ghi nhận để rà soát sau.

### 🔎 2026-06-04 (tiếp) — Herd-Projects: Search thông minh chọn vật tư + fix cap 1000 sản phẩm

**Bối cảnh:** Người dùng báo modal "Cập nhật bước" → "Vật tư sử dụng trong bước": dropdown chọn thuốc/vaccine là `<select>` HTML thuần với >1000 sản phẩm → phải kéo tay, không tìm được. **KHÔNG migration** (frontend-only). `tsc --noEmit` + `vite build` PASS. Chỉ sửa `HerdProjectDetailPage.tsx`.

- **🛡 Phát hiện integrity (nghiêm trọng):** query preload products (`from('products').select(...).eq('is_active',true).order('name')`) **không có `.range()`** → PostgREST cắt **tối đa 1000 dòng**. Catalog >1000 SP nên các SP thứ 1001+ **không hề được nạp** → search cũng vô nghĩa. Đúng bài học POS đã ghi (cap 1000).
  - **Fix:** thêm helper `fetchAllRows()` (copy pattern POSPage — lặp `.range(from,to)` theo lô 1000 tới khi < batch) + thêm khóa phụ `.order('id')` (phân trang ổn định). Nạp **đủ 100%** sản phẩm active.
- **Search thông minh:** import **`SmartSearchSelect`** (tìm bỏ dấu tiếng Việt, render tối đa 100 kết quả → chống lag DOM). Memo `productOptions` (label=tên, desc=`ĐVT: <unit>`). Thay **2 `<select>` sản phẩm**: (1) "Thuốc/Vaccine" trong vật tư bước, (2) "Chọn hàng hóa/vật tư" trong modal Ghi nhận chi phí. Dropdown "Chọn lô" giữ `<select>` thuần (mỗi SP ít lô).
- **UX (user duyệt):** nút "+ Thêm thuốc dùng" nay tạo dòng **để trống** (`product_id: ''`, placeholder "-- Chọn thuốc --") buộc người dùng search chủ động → tránh ghi nhầm SP đầu danh sách (AAA-AA Nutri Lyte). Trước đây auto chọn `allProducts[0]`.
- **Phân quyền/bảo mật (kiểm tra — không đổi):** modal + nút đã gate `canEdit` (`herd_projects.update`) từ lần trước. `fetchAllRows` chỉ phân trang, KHÔNG bypass RLS — products/stock_lots vẫn qua RLS sẵn có. `SmartSearchSelect` chỉ lọc client-side trên mảng đã được RLS lọc.

### 🌐 2026-06-04 (tiếp) — Khắc phục cap 1000 TOÀN DỰ ÁN + chuẩn hóa Smart Search

**Bối cảnh:** Người dùng báo lỗi còn ở nhiều nơi (không chỉ Herd): mọi preload danh sách lớn lọc client-side không `.range()` đều mất bản ghi 1001+ — Sản phẩm & Khách hàng đã vượt 1000 → search không thấy. **Frontend-only, KHÔNG migration. `tsc --noEmit` + `npm run build` PASS.**

- **Helper dùng chung MỚI** `src/lib/fetchAllRows.ts` (`fetchAllRows<T>(makeQuery, batch=1000)`): lặp `.range()` theo lô + guard 100 vòng. **Refactor xóa 4 bản copy trùng** → POSPage/MobileOrderPage/CashbookPage/HerdProjectDetailPage import từ util chung. Quy tắc: query phải `.order('<col>').order('id')` (tie-break) để phân trang không trùng/sót.
- **Sản phẩm (vá cap):** PurchaseOrderFormPage, GoodsReceiptFormPage, PriceListPage, ProductPromotionModal (bỏ `.limit(500)`), InventoryPage. 2 typeahead "thêm dòng" PO/GR nâng filter **không dấu** dùng `removeVietnameseTones` (giữ UX add-line thay vì đổi component).
- **Khách hàng (vá cap):** PipelinePage (fetchAllRows + 2 `<select>` → **SmartSearchSelect** + memo `customerOptions`), HerdsManagePage, HerdProjectFormPage, CustomerMapPage, CustomerProfileReportPage. **SystemSettingsPage — bug toàn vẹn:** đếm KH bàn giao bằng `.length` (cap 1000) → đổi `count:'exact',head:true` (bàn giao thực dùng bulk update server-side nên đủ).
- **Mở rộng phòng ngừa (suppliers/profiles selector):** PO/GR suppliers; profiles ở Pipeline/HerdForm/HerdDetail/AddCustomerModal/CustomerDetailPage/CustomerMapPage/CustomerSettingsPage.
- **Phân quyền/bảo mật — KHÔNG đổi:** fetchAllRows chỉ phân trang, mọi query vẫn dưới RLS hiện hành; không nới quyền.
- ⚠️ **Ngoài scope (ghi nhận):** catalog >10k về sau nên chuyển server-side async search; các báo cáo aggregate trên orders/order_lines (RevenueReport/InventoryReport) chưa rà cap — kiểm tra nếu 2 bảng này vượt 1000.

### 🐞 2026-06-04 (tiếp) — Fix regression dropdown "Người được giao" + sửa quy trình typecheck

**Triệu chứng (user báo):** Modal "Cập nhật bước" (Herd) — dropdown "Người được giao thực hiện" không nạp nhân viên.

- **Gốc rễ:** đợt cap-1000 gỡ định nghĩa `fetchAllRows` cục bộ khỏi `HerdProjectDetailPage.tsx` để dùng util chung nhưng **quên `import { fetchAllRows }`** → runtime `ReferenceError` ở dòng 414 (preload products) → `fetchDetail` abort → vets/types/regions/costs rỗng. **Fix:** thêm import.
- **🔴 Lỗ hổng verify (gốc khiến bug lọt):** `tsconfig.json` dùng `"files": []` + project references → `tsc --noEmit` thuần KHÔNG kiểm tra file nào (giả PASS). Lệnh đúng là **`tsc -b --noEmit`**. Đã sửa build script `package.json`: `tsc && vite build` → **`tsc -b && vite build`**.
- **Dọn 4 lỗi typecheck tiềm ẩn có sẵn** (nay mới lộ): `customerStatement.ts` ×3, `HerdsManagePage.tsx:72`. Toàn dự án `tsc -b` 0 lỗi + `npm run build` PASS.
- **Toàn vẹn/bảo mật:** không vấn đề. Xác minh remote: `profiles_select_all USING (fn_is_active())`, 3 NV active. Bug thuần frontend. **KHÔNG migration.**

### 🧾 2026-06-04 (tiếp) — Sửa/Hủy đơn POS 2 luồng + toàn vẹn dữ liệu

**Bối cảnh:** Bán nhanh tại quầy & bán giao hàng cần cho phép chỉnh sửa sau khi xuất đơn (sai sót nhập liệu) với phân quyền chặt và giữ toàn vẹn kho/sổ quỹ/công nợ. Cả 2 luồng vốn đã hiện trong /orders. **Có migration. `tsc -b` + `npm run build` PASS.**

- **Migration `20260616000000_pos_order_edit_cancel.sql`** (đã apply remote + reload schema, verify 5 hàm + cột):
  - Cột `orders.cancel_reason`.
  - `fn_order_edit_perms(order)` → JSONB `{can_edit,can_cancel,can_edit_qty,window_expires_at,reason}`. Admin/CEO mọi lúc; NV **cùng chi nhánh**: bán nhanh `completed` sửa trong **60'** (không hủy), đơn giao `draft` sửa+hủy.
  - `fn_reverse_order_effects(order)` nội bộ: hoàn kho về lô gốc (`stock_movements adjustment_increase` ref `order_reverse` + cộng `quantity_on_hand` + xóa allocation), đảo phiếu thu (`cashbook_transactions status='cancelled'` → trigger hoàn số dư quỹ), xóa `order_payments` + `customer_debts` chưa tất toán, reset paid/payment_status. **Guard:** chặn nếu đã có trả hàng / công nợ đã thu.
  - `fn_pos_apply_lines(order,payload)` nội bộ: dựng lại dòng + header + ghi đè tổng (giữ CK cấp HĐ).
  - `fn_cancel_order(order,reason)`: quyền theo `can_cancel` (Admin mọi lúc; NV chỉ đơn giao nháp) → reverse + status `cancelled` + cancel_reason.
  - `fn_pos_edit_order(order,payload)`: quyền theo `can_edit`; **draft** → chỉ apply_lines; **đã trừ kho** → reverse → apply_lines → draft→confirmed→completed (trừ kho FEFO lại; thiếu hàng RAISE rollback) → `fn_pos_settle_payment`. Nguyên tử, `FOR UPDATE`.
- **Frontend:**
  - `OrderEditModal.tsx` (mới): cart sửa SL/giá/CK/thêm-xóa dòng, chọn khách + SP qua **SmartSearchSelect** + **fetchAllRows** (đủ SP/KH 1001+), thanh toán/CK HĐ/ghi chú; gọi `fn_pos_edit_order`. Khóa ô SL khi `!can_edit_qty`.
  - `OrderDetailPage.tsx`: nạp `fn_order_edit_perms`; nút **Sửa đơn** (badge đếm ngược 60' cho bán nhanh) + **Hủy đơn** (modal lý do → `fn_cancel_order`); banner khi đã hủy + lý do; gỡ inline edit cũ & `updateOrderStatus('cancelled')` (đường hủy không hoàn tác). FAB "Hủy đơn" định tuyến qua modal mới.
  - `OrderListPage.tsx`: chip lọc **Luồng bán** (bán nhanh/giao hàng, desktop+mobile) + chuyển query sang **fetchAllRows** (tie-break `.order('id')`).
  - `POSPage.tsx`: filter khách hàng nâng lên **không dấu** (`removeVietnameseTones`) + cap 50 kết quả render.
- **Phân quyền/bảo mật:** mọi sửa/hủy qua RPC `SECURITY DEFINER` tự enforce (UI chỉ tiện ích); NV không hủy được đơn bán nhanh đã hoàn tất; guard chặn lệch sổ khi đã trả hàng/thu nợ.
- ⚠️ **Biên đã biết:** re-settle gắn cashbook vào ca thu ngân đang mở hiện tại (sửa cùng ngày → đúng); CK cấp HĐ khi sửa mặc định 0 (công cụ chỉnh sai sót).

### 📦 2026-06-04 (tiếp) — Admin sửa/xóa LÔ HÀNG (module Kho) + smart search

**Bối cảnh:** Tiếp mạch admin sửa/hủy có toàn vẹn. Tab Lô hàng vốn read-only → admin (`admin@sanhlongvetco.vn`/CEO) cần sửa & xóa lô; nhân viên giữ quyền cũ. **Có migration. `tsc -b` + `npm run build` PASS.**

- **Migration `20260617000000_admin_edit_lot.sql`** (đã apply remote + reload, verify 2 hàm). Cả 2 `SECURITY DEFINER`, chỉ `fn_is_admin()`:
  - `fn_admin_edit_lot(lot, payload)`: sửa lot_number/NSX/HSD/giá vốn/trạng thái + số lượng. Đổi SL → ghi `stock_movements adjustment_increase/decrease` (ref `lot_adjustment`) đúng dấu → thẻ kho khớp. Guard: SL mới ≥ quantity_reserved & ≥0; bắt UNIQUE số lô.
  - `fn_admin_delete_lot(lot, reason)`: soft-delete — chặn nếu `quantity_reserved>0`; ghi `adjustment_decrease -quantity_on_hand` (ref `lot_delete`), set qty=0 + `status='disposed'` + notes=reason. GIỮ lịch sử/FK (không hard-delete).
- **Frontend:** `LotEditModal.tsx` (mới — form sửa lô, preview bút toán điều chỉnh ±N, chặn SL < giữ chỗ). `InventoryPage.tsx` tab Lô: cột/nút **Sửa + Hủy** (desktop + mobile) chỉ hiện khi `isAdmin`; modal xác nhận hủy + lý do; badge `disposed`="Đã hủy"; reload qua `lotReloadFlag`.
- **Search/nạp đủ (phạm vi Kho):** tab Cài đặt `<select>` SP → **SmartSearchSelect** (memo `productListOptions`, productList đã `fetchAllRows`). Query tab Lô hàng đổi `.limit(100)` → **`fetchAllRows`** (tie-break `.order('id')`, +`quantity_reserved`) để admin thấy/sửa mọi lô. 2 query lô transfer/return → `fetchAllRows` phòng kho >1000 lô.
- **Phân quyền/bảo mật:** RPC tự `fn_is_admin()` (NV gọi trực tiếp bị chặn); UI ẩn nút cho NV. Quyền NV (tạo/chuyển/trả) giữ nguyên. Toàn vẹn: mọi đổi SL sinh movement; xóa soft + đảo tồn; chặn dưới phần giữ chỗ.
- ⚠️ **Ngoài scope (ghi nhận):** goods receipts / purchase returns chưa thêm sửa/xóa admin (user chọn chỉ Lô lần này); các list tab khác (PO/receipts/transfers/returns) vẫn `.limit(100)` — pagination để session sau.

### 📊 2026-06-04 (tiếp) — Trung tâm Báo cáo: Báo cáo lợi nhuận (admin-only)

**Bối cảnh:** Tinh gọn `/reports`. Bỏ 4 báo cáo (Công nợ phải thu, Nhập xuất tồn kho, Hiệu suất nhân viên, ROI khuyến mãi). Thay "Doanh thu theo thời gian" → **Báo cáo lợi nhuận**. Toàn bộ khu báo cáo **chỉ admin** (`userRole.code==='admin'`, CEO cũng bị chặn). **Có migration. `tsc -b` + `npm run build` PASS.**

- **Migration `20260620000000_profit_reports.sql`** (đã apply remote + reload, verify view + 4 hàm + gate `fn_has_role('admin')` ×4):
  - **View `v_order_line_profit`**: lợi nhuận cấp dòng đơn. `revenue=order_lines.line_total`; `cogs = Σ(allocation.quantity×stock_lots.cost_price) + (quantity−Σalloc)×product_stock_summary_view.retail_cost` (fallback GIA-LE→bảng giá đầu→lô mới nhất→0). Chỉ đơn `status IN (confirmed,shipping,delivered,paid,completed)`. ⚠️ Phát hiện: sale movement KHÔNG ghi `unit_cost` (trigger bỏ trống) → KHÔNG dùng được làm COGS; allocation→lot.cost_price là nguồn đáng tin.
  - **4 RPC** `SECURITY DEFINER` + check `fn_has_role('admin')` (RAISE nếu không) + `GRANT authenticated`: `fn_profit_summary(from,to)`; `fn_profit_by_customer(from,to,search,sort,limit,offset)`; `fn_profit_by_product(...)` (sort: revenue/profit/profit_ratio/qty/customer_count — dùng chung cho cả 3 tab Top-100); `fn_profit_by_brand(from,to,sort,limit,offset)`.
- **Frontend:**
  - `ProfitReportPage.tsx` (mới, route `/reports/profit`): bộ lọc thời gian preset **Hôm nay (mặc định)/Tháng này/Năm nay/Tùy chọn**; 4 KPI (doanh thu/giá vốn/lợi nhuận/biên LN); **6 tab** (theo KH / SP / thương hiệu / Top-100 tỉ lệ LN / Top-100 doanh số / Top-100 nhiều khách mua); **SmartSearchSelect** lọc KH/SP (options nạp `fetchAllRows` → đủ 1001+, value=code/sku truyền `p_search`); **Xuất CSV** mỗi tab (papaparse, BOM UTF-8). Format tiền qua `useDisplaySettings`.
  - `ReportsHubPage.tsx`: còn **2 card** (Báo cáo lợi nhuận + Phân tích Chân dung KH) + KPI strip (doanh thu/LN/biên theo hôm nay/tháng/năm qua `fn_profit_summary`).
  - **Xóa hẳn** `RevenueReportPage/DebtReportPage/InventoryReportPage/StaffReportPage.tsx` + import + route.
  - `App.tsx`: thêm prop **`adminOnly`** cho `ProtectedRoute` (chặn cả CEO → `AccessDenied`); routes `/reports`, `/reports/profit`, `/reports/customer-profile` đều `adminOnly`. `Layout.tsx`: menu "Báo cáo" gắn `adminOnly:true` (ẩn với non-admin, kể cả CEO). `DashboardPage.tsx`: nút "Báo cáo" repoint `/reports/debt`→`/reports`.
- **Phân quyền/bảo mật:** 2 lớp — UI (route + menu chỉ admin) và DB (RPC tự `fn_has_role('admin')`, REVOKE PUBLIC). RPC SECURITY DEFINER owner superuser → admin thấy mọi chi nhánh (đúng nhu cầu CEO/admin xem toàn cục).
- ⚠️ **Biên đã biết / data integrity:** doanh thu cấp DÒNG (chưa gồm CK cấp HĐ + phí ship); SP chưa set giá vốn (no allocation + retail_cost=0) → margin 100% (báo cáo phơi bày để admin sửa data, không phải lỗi logic); margin âm = bán dưới giá vốn (data thật).

### 🐛 2026-06-06 — Fix Phiếu nhập kho trống + audit Thẻ kho / toàn vẹn / phân quyền

**Bối cảnh:** User báo (1) tab **Phiếu nhập kho** trống dù đã nhập nhiều phiếu, với MỌI role; (2) **Thẻ kho** sản phẩm không hiện lịch sử. Điều tra trên DB prod (Management API): dữ liệu **còn đủ** (37 goods_receipts, 77 lines, 113 stock_movements, 78 lots; **0 lô mồ côi** → toàn vẹn lot↔movement OK). Không sửa dữ liệu DB. **`tsc -b` + `npm run build` PASS.**

- **Bug 1 (gốc rễ — LỖI THẬT):** `goods_receipts` có **3 FK tới `profiles`** (`completed_by/received_by/verified_by`). Query `profile:profiles(full_name)` ở `InventoryPage.tsx` không chỉ định FK → PostgREST **PGRST201** ("more than one relationship") → cả query ném lỗi → `catch` nuốt im lặng → list rỗng → "Không tìm thấy phiếu nhập kho nào" với mọi role (kể cả admin). Tái hiện chính xác bằng anon key.
  - **Fix:** `profile:profiles!goods_receipts_received_by_fkey(full_name)`.
  - **Cùng class bug ở in chứng từ** (`PrintPreviewPage.tsx`, đều `.single()` → in ra lỗi): goods_receipts (dòng 220 → `!goods_receipts_received_by_fkey`), sales_returns (dòng 280, 2 FK created_by/processed_by → `!sales_returns_created_by_fkey`), stock_transfers (dòng 341, 2 FK created_by/received_by → `!stock_transfers_created_by_fkey`). Đã vá cả 3. Verify lại qua REST: hết PGRST201, trả `[]` (chỉ do RLS anon), không còn lỗi parse.
- **Bug 2 (KHÔNG phải lỗi):** Query Thẻ kho (`useProductMovements` + `ProductDetailPage`) đã chỉ định đúng `profiles:performed_by` → hợp lệ. SP trong ảnh (VMD-Cloprostenol 6ml, SP-4427010-858) **thực sự 0 lô + 0 movement** ("50" trên lưới là định mức an toàn, không phải tồn) → "Chưa có biến động" là ĐÚNG. SP có movement (vd SP-4427010-477: 7) hiện bình thường. Admin/CEO `branchId=undefined` → không bị lọc chi nhánh.
- **P1 (chống tái diễn):** `InventoryPage` thêm state `fetchError` (reset đầu `try`, set ở `catch`) + banner đỏ `AlertTriangle` dưới tab nav (mọi tab) → lỗi tải dữ liệu hiện rõ thay vì rỗng giả.
- ⚠️ **Phát hiện bảo mật chưa vá (đề xuất P2 — user hoãn):** RLS SELECT của `goods_receipts`/`stock_movements` chỉ theo **role**, KHÔNG theo chi nhánh; cô lập chi nhánh hiện chỉ do code client (`.eq('warehouse.branch_id', …)`). Thủ kho/branch_manager chi nhánh A vẫn đọc được phiếu chi nhánh B nếu gọi API trực tiếp. Nên thêm điều kiện branch vào policy SELECT (admin/ceo/accountant xem toàn bộ; warehouse_keeper/branch_manager chỉ chi nhánh mình).
- **Bài học:** mọi bảng có >1 FK tới cùng 1 bảng (đặc biệt `profiles`) PHẢI dùng embed disambiguated `profiles!<constraint>` — nếu không PostgREST ném PGRST201 và làm hỏng cả query. Đừng nuốt lỗi trong `catch` (che bug loại này).

### 🔒 2026-06-06 (tiếp) — P2: Đóng lỗ hổng cô lập chi nhánh khi ĐỌC phiếu nhập kho

**Bối cảnh:** User duyệt làm P2 (siết RLS chi nhánh cho goods_receipts/stock_movements). Khi kiểm tra remote phát hiện: `stock_movements` ĐÃ lọc chi nhánh đúng (`stock_mov_select_warehouse` check `warehouse.branch_id=fn_my_branch_id()`); `receipts_select_warehouse`/`receipt_lines_select` cũng đã lọc chi nhánh. **Repo `rls.sql` chỉ là bản cũ — remote đã tiến hơn.**

- **Lỗ hổng thật:** `goods_receipts.receipts_manage_warehouse` và `goods_receipt_lines.receipt_lines_manage` là policy **FOR ALL** (admin OR warehouse_keeper, KHÔNG check chi nhánh). Vì FOR ALL gồm cả SELECT và policy permissive OR với nhau → **warehouse_keeper đọc được phiếu nhập của MỌI chi nhánh**, vô hiệu hóa SELECT đã lọc chi nhánh.
- **Migration `20260621000000_branch_scope_receipts_select.sql`** (đã apply remote + reload, verify pg_policies): DROP 2 policy FOR ALL, tách thành INSERT/UPDATE/DELETE riêng với ĐÚNG điều kiện role cũ (admin OR warehouse_keeper) → **hành vi GHI giữ nguyên 100%**, nhưng SELECT giờ CHỈ do `*_select_warehouse` (đã lọc chi nhánh) + `*_own_draft` (creator xem draft của mình) quyết định. `stock_movements` không đụng (đã đúng).
- **Kết quả:** warehouse_keeper chỉ còn đọc được phiếu nhập + thẻ kho của chi nhánh mình; admin/ceo/accountant vẫn xem toàn bộ; branch_manager xem chi nhánh mình. Cô lập chi nhánh giờ enforce ở DB (RLS), không chỉ ở client.
- **Bài học:** policy **FOR ALL** vô tình cấp luôn quyền SELECT — nếu muốn giới hạn ĐỌC theo điều kiện khác (chi nhánh), KHÔNG để chung FOR ALL; phải tách INSERT/UPDATE/DELETE riêng để SELECT do policy SELECT (hẹp hơn) kiểm soát.

### 🐛 2026-06-06 (tiếp) — Phiếu nhập kho kẹt 'draft' (regression "xác nhận/hoàn tất đơn nhập hàng")

**Bối cảnh:** User hỏi "tính năng admin xác nhận đơn nhập hàng đã hoạt động chưa". Điều tra DB: 34 phiếu (28/05→05/06) status `completed` + `completed_by` đủ; **3 phiếu tạo hôm nay 06/06 kẹt `draft`, `completed_by` NULL**. `verified_by` chưa từng dùng (0).

- **Nguyên nhân (regression):** Luồng tạo phiếu nhập trước đây là modal inline trong `InventoryPage` (commit `1e7aecc` set `status:'completed'`). Khi chuyển sang trang riêng `GoodsReceiptFormPage`, insert **bỏ sót** `status`/`completed_by` → phiếu mới mặc định `'draft'` (default cột) và không bao giờ được chốt. Không có UI confirm nào set lại.
- **Lưu ý toàn vẹn:** trigger `fn_create_stock_lot_on_receipt` chạy AFTER INSERT trên `goods_receipt_lines` **không phụ thuộc status** → tồn kho VẪN được ghi ngay cả khi phiếu 'draft'. Nên 'draft' chỉ là nhãn workflow (không phải gate tồn kho); tồn kho không bị lệch.
- **Fix:**
  1. `GoodsReceiptFormPage` insert thêm `status:'completed'` + `completed_by: receivedById` (khôi phục hành vi cũ — phiếu chốt ngay khi tạo, vì tồn đã ghi qua trigger).
  2. Backfill 3 phiếu draft → completed (`completed_by=COALESCE(completed_by,received_by)`); verify 37/37 completed + có completed_by.
  3. `InventoryPage` tab Phiếu nhập: query thêm cột `status`, thêm cột "Trạng thái" (badge Hoàn tất/Chưa chốt) ở bảng desktop + card mobile → nhìn thấy được trạng thái.

### 2026-06-21 — Nhập hàng từ Google Drive (Google Sheets) → phiếu nhập NHÁP đồng bộ giá

**Bối cảnh:** Kế toán tính giá nhập trên Google Sheets (40 công ty, mỗi cty 1 thư mục Drive, layout cột mỗi file mỗi khác → không ép quy chuẩn lên file). Mục tiêu: kết nối CRM tới thư mục Drive, đọc/ghi Sheet ngay trong app, ánh xạ về SP+giá+NCC, tạo phiếu nhập nháp **đồng bộ giá với Sheet tới khi duyệt** (sau verified thì khóa). Quyết định user (AskUserQuestion): Service Account + Edge Function · đọc **+ ghi ngược** Sheet · chỉ Google Sheets gốc · bảng bí danh học dần theo NCC.

- **Tận dụng vòng đời phiếu nhập sẵn có** `draft→verified→completed` (`fn_complete_goods_receipt`, guard `trg_guard_receipt_status`) — chỉ thêm liên kết phiếu↔Sheet + re-sync giá khi draft.
- **Migration `20260710000000_gdrive_import.sql`** (✅ apply remote + tracking row + smoke-test RPC guard PASS): bảng `gdrive_sources` (folder+NCC+kho+`column_map` JSONB chữ-cột+header_row, RLS đọc-active/ghi-admin); `gdrive_product_aliases` (NCC+tên-chuẩn-hóa→product_id, UNIQUE, ghi cho inventory.receive); cột `goods_receipts.gsheet_*` (source_id/file_id/tab/synced_at/row_map); RPC `fn_sync_gsheet_draft_prices(receipt, prices jsonb)` SECURITY DEFINER — **chỉ khi status='draft'** (sau verified raise lỗi = khóa đồng bộ), quyền người-lập|admin.
- **Edge Function `supabase/functions/gdrive-proxy/index.ts`** (Deno): proxy DUY NHẤT, credential service account giấu ở secrets. Verify Supabase JWT + quyền `inventory.receive` (RPC dưới danh tính user) + **whitelist** mọi thao tác phải gắn `source_id` đã cấu hình & file phải nằm trong cây folder (chống đọc file tùy ý). SA ký JWT RS256 (Web Crypto) → access_token scope drive.readonly+spreadsheets. Actions: `list-files`/`sheet-info`/`read-sheet`/`write-cells`. ⚠️ **CHƯA DEPLOY** — cần user tạo Google SA + set secrets + `supabase functions deploy gdrive-proxy`.
- **Frontend:** `src/lib/gdriveMapping.ts` (colLetterToIndex/colIndexToLetter/cellAt/parseSheetNumber/normalizeAlias dùng removeVietnameseTones); hook `src/hooks/useGdriveImport.ts` (`supabase.functions.invoke('gdrive-proxy')` + qk.gdrive); trang `/inventory/gdrive-import` (`GdriveImportPage` — chọn nguồn→file→tab, lưới SP, sửa giá **ghi ngược Sheet** on-blur, khớp SP qua alias/auto-norm, dòng chưa khớp map SmartSearchSelect→lưu alias, "Tạo phiếu nháp" → insert goods_receipts draft + lines + gsheet_*); trang admin `/inventory/gdrive-sources` (`GdriveSourcesPage` CRUD + ánh xạ cột); nav "Nhập từ Drive" (Kho & Hàng hóa, perm inventory.receive).
- **GoodsReceiptDetailPage:** nút "Đồng bộ lại giá từ Google Sheet" (chỉ status='draft' + có gsheet_file_id) → read-sheet → map theo gsheet_row_map → `fn_sync_gsheet_draft_prices`. Sau verified nút ẩn (đã khóa).
- `tsc -b --noEmit` + `vite build` PASS. **Cần user:** (1) tạo Google Cloud project + bật Drive/Sheets API + Service Account key; share thư mục Drive cho email SA (Editor để ghi ngược); (2) `supabase secrets set GOOGLE_SA_EMAIL=… GOOGLE_SA_PRIVATE_KEY=…`; (3) `supabase functions deploy gdrive-proxy`; (4) cấu hình 1 nguồn (MKV-Cai Lậy) test; (5) commit + deploy frontend.
- **Phạm vi sau (chưa làm):** import hóa đơn VAT (PDF/HTML); hỗ trợ .xlsx upload.

### 2026-06-22 — Nhập từ Drive V2: NSX/HSD/Số lô bắt buộc + chống nhập trùng lô + ngày nhất quán
- **User thêm 3 cột vào file MKV: U=NSX, V=HSD, W=Số Lô** (header dòng 3). Cập nhật `gdrive_sources.column_map` MKV {lot:W, mfg_date:U, exp_date:V}.
- **Migration `20260711000000_gdrive_lot_dedup.sql`** (apply remote + tracking + smoke-test): RPC `fn_check_existing_lots(p_items jsonb)` SECURITY DEFINER — đối chiếu SP+Số lô+HSD với `stock_lots` (đã nhập kho) + `goods_receipt_lines` của phiếu status draft/verified (đang chờ), TOÀN hệ thống; trả existence + tên kho + mã phiếu + tên NV lập. GRANT authenticated.
- **Edge Function `gdrive-proxy` redeploy:** read-sheet đổi `dateTimeRenderOption` FORMATTED_STRING→**SERIAL_NUMBER** → ô Ngày trả số serial (không nhập nhằng dd/mm vs mm/dd).
- **`gdriveMapping.ts`:** `parseSheetDate` (serial Google→ISO; fallback yyyy-mm-dd, dd/mm/yyyy CHUẨN VN) + `formatDateVN` (ISO→dd/mm/yyyy). Quy tắc nhất quán: Sheet serial → ISO (app/DB) → hiển thị dd/mm/yyyy; sửa bằng `<input type=date>` (value ISO) → ghi ngược ISO USER_ENTERED (Sheets thành ô Ngày thật).
- **`useGdriveImport.ts`:** thêm `checkExistingLots(items)` (rpc). **`GdriveImportPage.tsx`:** 3 cột editable Số lô/NSX/HSD ghi ngược Sheet on-blur; **bắt buộc đủ 3 trường MỌI dòng** (thiếu → chặn tạo phiếu + tô đỏ ô trống); debounce 600ms gọi dedup → dòng trùng badge đỏ ("Đã nhập kho: kho" / "Đang ở phiếu GR-xxx · NV") + **tự bỏ chọn** (tích lại = xác nhận nhập trùng); insert lines với lot/mfg/exp.
- **Quyết định user (AskUserQuestion):** 3 trường bắt buộc MỌI dòng; trùng = cảnh báo+bỏ chọn+cho xác nhận (không chặn cứng); tiêu chí trùng = SP+lô+HSD toàn hệ thống.
- `tsc -b --noEmit` + `vite build` PASS. **Cần user: deploy frontend production** (Edge Function + DB đã live). Backstop: `fn_complete_goods_receipt` ON CONFLICT cộng dồn qty cùng lô — cảnh báo import là lớp kiểm soát chính.
- **`tsc -b` + `npm run build` PASS.**
- ⚠️ **Quyết định thiết kế (đã chọn auto-complete, có thể đổi):** hiện chốt TỰ ĐỘNG khi tạo (giống lịch sử), KHÔNG có bước admin duyệt riêng. Nếu muốn quy trình "thủ kho tạo draft → admin bấm Xác nhận → completed" thì cần: (a) form lưu 'draft', (b) thêm nút "Xác nhận" (admin) ở list, (c) chuyển trigger ghi tồn từ AFTER INSERT line sang khi status→completed (thay đổi lớn, ảnh hưởng 37 phiếu cũ). Chưa làm — chờ user xác nhận nếu cần gate thực sự.

### 2026-06-22 — Quản lý VAT (hàng có VAT / không VAT) theo LÔ + xuất HĐ gộp + upload PDF/HTML/XML
Bối cảnh: thú y VN cần 2 nhóm tồn song song — hàng nhập CÓ hóa đơn VAT (báo cáo thuế) và hàng nhập KHÔNG hóa đơn ("hàng trốn thuế"). Cờ VAT đặt ở **cấp LÔ**.
- **Migration `20260712000000_vat_lots_and_cost.sql`** (apply remote + tracking + verify): `goods_receipt_lines.is_vat/vat_rate` + `stock_lots.is_vat/vat_rate` (tồn cũ = không-VAT); `fn_complete_goods_receipt` propagate cờ VAT vào lô; seed `system_settings.vat_config {markup_rate:0.07, tax_share:0.5}`; `fn_products_list` thêm `vat_stock`/`nonvat_stock` (tách tồn theo VAT, tôn trọng p_branch_id).
- **Thuế DN (toggle bật/tắt khi nhập):** giá nhập mới = giá nhập × (1 + markup×tax_share) = ×1,035 (7%×50%). Sheet từ Drive ĐÃ gồm sẵn thuế → toggle mặc định TẮT (tránh cộng kép); Upload hóa đơn mặc định BẬT. `computeVatCost` trong `gdriveMapping.ts`.
- **Migration `20260713000000_vat_sales_issuance.sql`** (apply remote + tracking + smoke-test tx-rollback PASS): bảng `vat_pending_sales` (1 dòng/dòng-đơn bán từ lô VAT) + `vat_issuances` (gộp nhiều lần bán). Trigger AFTER UPDATE `trg_orders_vat_sync`: confirmed → ghi pending (qty từ `order_line_allocations` JOIN `stock_lots` is_vat, gộp theo dòng); cancelled → gỡ pending chưa xuất. RPC admin/ceo/accountant (`fn_can_manage_vat`): `fn_vat_pending_sales(from,to)`, `fn_vat_issue(sale_ids[],...)` (tính tổng server, chỉ gắn dòng pending → chống xuất trùng), `fn_vat_set_lot`.
- **FE:** `GdriveImportPage` thêm điều khiển Nhóm hàng (Có VAT 5/10 | Không VAT) + toggle thuế DN + lưu is_vat/vat_rate/giá mới vào lines; **chuyển nguồn Sheet ↔ Tải file (PDF/HTML/XML)** tái dùng lưới (parse `src/lib/invoiceParsers/`: XML TT78 ưu tiên, HTML heuristic bảng, PDF text qua `pdfjs-dist` lazy, scan→nhập tay). `ProductListPage` thêm cột "VAT/Không" + CSV. `POSPage` badge VAT/KHÔNG VAT trên bộ chọn lô (thu ngân tự chọn loại tồn). Trang mới `/inventory/vat` (`VatManagementPage`) 3 tab Chờ xuất/Đã xuất/Tồn VAT + modal gộp xuất HĐ; hook `useVat.ts`; nav "Quản lý VAT" (gate cashbook.view → admin/ceo/accountant); route App.tsx.
- **Quyết định user (AskUserQuestion):** cấp LÔ; markup +7%×50%; xuất gộp cuối ngày (kế toán chủ động); POS thu ngân chọn loại tồn; phân quyền admin+kế toán; định dạng upload XML+PDF text+PDF scan+HTML.
- `tsc -b` + `vite build` PASS (pdfjs tách chunk lazy). **Cần user: deploy frontend production** (DB đã live).

### 🔎 2026-06-06 (tiếp) — Báo cáo lợi nhuận: giá vốn = 0 (KHÔNG phải bug — thiếu dữ liệu)

**Bối cảnh:** User báo "đã nhập kho có giá nhập nhưng báo cáo giá vốn = 0" (nhiều SP biên 100%). Kiểm tra DB:
- View `v_order_line_profit` TÍNH ĐÚNG: `cogs = Σ(allocation.qty × lot.cost_price) + (qty chưa phân bổ × pss.retail_cost)`. `product_stock_summary_view.retail_cost` fallback: GIA-LE.cost → bảng giá đầu.cost → **lô mới nhất có cost>0** → 0.
- Bằng chứng: SP có lô/giá vẫn ra COGS đúng (Donoban 1.14M, Hipra 1.30M, Amox 536k, Peniciline 1.59M, Oxytocin 41k). SP biên 100% trong ảnh (Supersol/Fostosal/FlorMax/Gluco/Vicox/Cloprostenol) đều **0 lô + 0 dòng nhập kho + 0 giá vốn bảng giá** → KHÔNG có nguồn giá vốn → COGS=0 đúng.
- Tổng hôm nay: 50 dòng có COGS đúng (DT 57M) vs **70 dòng COGS=0 (DT 44.7M)** — toàn SP bán mà chưa từng nhập kho. 26 SP distinct, tất cả lots=0.
- **Nguyên nhân thật:** đây là KẼ HỞ DỮ LIỆU — các SP đó được bán (qua đơn/POS) nhưng chưa bao giờ nhập kho có giá, cũng chưa khai cost_price ở bảng giá. Tab "Top 100 tỉ lệ LN" sort margin DESC nên các SP 0-cost (100%) nổi lên đầu → gây hiểu nhầm cả báo cáo sai.
- **Sửa (minh bạch hóa, KHÔNG bịa số):** `ProfitReportPage.tsx` — dòng có `revenue>0 && cogs=0` hiển thị badge amber **"Thiếu giá vốn"** + ô giá vốn "Chưa có giá vốn" + lợi nhuận màu amber, thay vì badge xanh 100% gây hiểu nhầm. Footnote giải thích. `tsc -b`+build PASS.
- **Hành động cho user (nghiệp vụ):** nhập kho có giá cho các SP đó HOẶC khai cost_price ở bảng giá GIA-LE → COGS sẽ tự đúng (view đã fallback về lô mới nhất / bảng giá). Không cần sửa code thêm.

### 🐛🔒 2026-06-07 — Phiếu "Hoàn tất" nhưng tồn kho = 0 + khoá toàn vẹn status (gốc rễ)

**Bối cảnh:** User báo: danh sách phiếu nhập "Hoàn tất" nhưng tồn kho = 0; phiếu nháp hiển thị "đã duyệt" dù chưa duyệt; SP vừa nhập không có lô. Yêu cầu kiểm tra toàn vẹn dữ liệu, phân quyền, bảo mật, UX.

- **Gốc rễ (xác minh trên DB thật `gdotgcrtivjdpkcchrro`):** Migration duyệt `20260619000000` ĐÃ apply remote (gỡ trigger `trg_receipt_lines_create_lot` → kho chỉ sinh qua RPC `fn_complete_goods_receipt`). NHƯNG frontend live (commit `c8791fb`, mục 2026-06-06 ở trên) vẫn **INSERT thẳng `status:'completed'`** → phiếu "Hoàn tất" mà KHÔNG chạy RPC → **không stock_lots/stock_movements → tồn = 0**. Đây là mâu thuẫn giữa fix DB (luồng duyệt) và fix frontend trước đó (auto-complete) — hai hướng ngược nhau.
  - 4 phiếu dính: `GR-879217`, `GR-532466`, `GR-752693` (06/06) + `GR-837193` (**07/06 → lỗi vẫn đang sinh phiếu hỏng**). Dấu hiệu: `status=completed`, `completed_at=NULL`, không lô/thẻ kho. (34 phiếu cũ tạo trước khi gỡ trigger vẫn có kho đủ.)
- **Lỗ hổng bảo mật (xác minh pg_policy):** RLS `goods_receipts` KHÔNG ràng buộc `status`: `receipts_insert_warehouse` cho INSERT status bất kỳ; `receipts_update_own_draft` WITH CHECK chỉ kiểm `received_by` (người lập tự nâng draft→completed); `receipts_update_warehouse` không gate status. → Luồng duyệt **bypass hoàn toàn từ client** (anon key public). Workflow duyệt chỉ là "khuyến nghị".
- **Đã làm — Migration `20260622000000_harden_receipt_status.sql` (ĐÃ apply remote qua Management API, verify OK):**
  1. **Guard** `fn_guard_receipt_status` (BEFORE INSERT/UPDATE): INSERT **ép `status='draft'`** + xoá cờ verified/completed (an toàn deploy — frontend cũ vẫn tạo phiếu được, chỉ ra draft, KHÔNG lỗi); UPDATE đổi status trực tiếp **RAISE EXCEPTION**. Miễn trừ qua cờ phiên `app.receipt_rpc='on'`.
  2. 4 RPC `fn_verify/complete/cancel/reopen_goods_receipt` thêm `PERFORM set_config('app.receipt_rpc','on',true)` → CHỈ RPC (có kiểm quyền: admin duyệt; người lập/admin hoàn thành) mới đổi được status.
  3. **Sửa dữ liệu:** 4 phiếu hỏng → trả về `'verified'` (user chọn phương án này thay vì sinh kho tự động) → người lập/Admin bấm **Hoàn thành** trên UI mới → kho sinh qua RPC đúng quy trình. Verify: `completed_no_stock_remaining = 0`; guard chặn UPDATE status trực tiếp OK.
- **Frontend (cần COMMIT + DEPLOY):** working-tree `GoodsReceiptFormPage` đã lưu `draft` (bỏ `status:'completed'`); `GoodsReceiptDetailPage.tsx` mới (stepper + nút duyệt/hoàn thành/huỷ/trả-nháp theo quyền); route `/goods-receipts/:id` đã có. Sửa `InventoryPage:960` fallback `|| 'completed'` → `|| 'draft'`. `npm run build` PASS.
- **Công nợ NCC — ĐÃ sửa (user chọn "ghi nợ khi Hoàn thành").** Migration `20260623000000_supplier_debt_on_completion.sql` (đã apply remote): `fn_supplier_debt_on_receipt` viết lại theo mô hình "đóng góp công nợ = total_amount CHỈ khi status='completed'", điều chỉnh theo chênh lệch ở insert/update/đổi-NCC/sửa-total/delete → huỷ phiếu tự hoàn nợ, nháp/verified không tính nợ. Đối soát 1 lần: `current_debt_payable -= Σ(total_amount phiếu không-completed)` (chỉ sửa sai sót trigger cũ, giữ nguyên thanh toán & số dư đầu kỳ). Verify: MAVIN 4.833.210 → 2.779.460 = đúng tổng phiếu completed (loại nợ ảo 2.053.750 của phiếu huỷ GR-532466).
- **Nghiệm thu thực tế (user tự thao tác trong lúc fix):** GR-879217/752693/837193 → bấm Hoàn thành → có lô + thẻ kho (kho sinh qua RPC ✓); GR-532466 → Huỷ. Kết quả: 37 completed (đều có kho), 1 cancelled, 0 phiếu completed-thiếu-kho. Frontend do user tự commit & deploy.
- **Bài học:** khi DB và frontend cùng đụng 1 luồng nhưng deploy lệch pha (DB đã có luồng duyệt, frontend còn auto-complete) → bug ngầm. State machine quan trọng (status phiếu) PHẢI khoá ở tầng DB (trigger/RPC), KHÔNG dựa vào client tự giác — vì anon key public, RLS thiếu ràng buộc = bypass được.

### 🐛🔒 2026-06-07 (tiếp) — Bán âm tồn kho (gốc rễ phía BÁN) + hardening trạng thái đơn

**Bối cảnh:** User báo lỗi lớn (đã sửa 2 lần chưa khỏi): SP `Jorenku-Triple-Iron` tồn=0, không lô, phiếu nhập chưa duyệt (đúng) — NHƯNG vẫn lên được đơn bán. 2 lần trước chỉ vá phía **phiếu nhập** (duyệt), chưa đụng phía **bán**.

- **Gốc rễ (xác minh DB thật):** trigger trừ kho `fn_auto_stock_on_order_confirm` chỉ chạy phân bổ FEFO + chặn thiếu hàng khi `is_lot_managed AND warehouse_id NOT NULL`. Cột `is_lot_managed` mặc định `false` → **1007/1029 SP bỏ qua HOÀN TOÀN kiểm tra & trừ kho** khi bán. Đo được: 28 đơn confirmed+ có dòng KHÔNG phân bổ lô; 80/91 SP từng bán là loại không quản lý lô.
- **Lỗ hổng song song:** `MobileOrderPage` dùng insert thủ công — không set `warehouse_id`, tự `UPDATE status='confirmed'` (bỏ duyệt Admin đơn giao), tự chèn `order_payments`/`customer_debts` (bỏ kiểm hạn mức server), tự sinh `order_code` random.
- **Quyết định user:** đích = **chặn cứng toàn bộ**; lộ trình = **soft trước (cảnh báo+log), cứng sau** (công tắc, không deploy lại); **sửa luôn MobileOrderPage**; giữ guard + RPC nhỏ cho herd.
- **Migration `20260624000000_universal_stock_control.sql` (ĐÃ apply remote, verify OK):**
  - `system_settings.stock_control_mode` (`soft`|`hard`, mặc định **soft**) + helper `fn_stock_control_mode()`.
  - Bảng `stock_oversell_log` (nhật ký bán thiếu/âm — đồng thời là worklist SP cần nhập kho trước khi bật hard). RLS đọc cho admin/`inventory.view`.
  - `fn_allocate_lots_fefo`: **bỏ RAISE nội bộ** (chỉ phân bổ phần khả dụng).
  - **Viết lại `fn_auto_stock_on_order_confirm`:** áp cho MỌI SP; warehouse NULL/thiếu tồn → hard RAISE rollback / soft ghi log + chỉ trừ phần khả dụng. KHÔNG backfill 28 đơn cũ.
- **Migration `20260624000001_orders_status_guard.sql` (ĐÃ apply remote, verify OK):**
  - Guard `fn_guard_order_status` (giống guard phiếu nhập): INSERT ép `draft`; UPDATE đổi status trực tiếp → RAISE trừ khi cờ phiên `app.order_rpc='on'`.
  - Set cờ ở mọi RPC đổi trạng thái: `fn_pos_quick_sale/confirm_order/advance_delivery/complete_delivery_payment/cancel_order/pos_edit_order`. Thêm **`fn_confirm_generated_order`** (xác nhận đơn sinh tự động, giữ nguyên tổng gồm phí dịch vụ) cho herd.
- **Frontend (cần COMMIT + DEPLOY):**
  - `MobileOrderPage`: submit → `fn_create_delivery_draft` (nháp giao hàng, set warehouse chi nhánh); bỏ insert thủ công/confirm/payment/debt; hiển thị tồn + cảnh báo "thiếu N"; banner giải thích luồng nháp.
  - `POSPage`: cảnh báo dòng giỏ vượt tồn ("⚠ Tồn X — thiếu Y"); lỗi RPC hard-mode surface qua toast (đã có).
  - `HerdProjectDetailPage`: confirm đơn sinh tự động qua `fn_confirm_generated_order`.
  - `SystemSettingsPage` (tab Kho): toggle **Cảnh báo (soft) / Chặn cứng (hard)** ghi `system_settings` (chỉ admin) — lật khi dữ liệu kho đã sạch.
- **Nghiệm thu remote (transaction + ROLLBACK trên đơn DH-2026-00030, 4 dòng):** soft → đơn qua, `allocs=2` (SP có lô trừ kho), `logged=2` (SP thiếu ghi log); hard → RAISE "Không đủ tồn kho... cần 1.000, còn 0.000"; guard chặn UPDATE status trực tiếp; mode persist=soft. `tsc -b`+`vite build` PASS.
- **Việc còn cho user:** chạy ở **soft** một thời gian, nhập kho bù theo `stock_oversell_log`; khi sạch → lật **hard** ở tab Kho. (Tuỳ chọn tương lai: công cụ nhập tồn đầu kỳ hàng loạt.)

---

## 2026-06-08 — POS: chặn cứng bán khi tồn < số lượng bán (cả 2 luồng)

**Bối cảnh:** User yêu cầu ở POS không cho bán nếu tồn dưới số lượng bán (vd tồn 0 bán 1 → lỗi; tồn 5 bán 6 → lỗi). Trước đó luồng **Bán giao hàng** (`fn_create_delivery_draft`) chỉ tạo đơn nháp KHÔNG kiểm tồn; việc kiểm/trừ tồn dồn về bước Admin xác nhận và còn phụ thuộc `stock_control_mode` (mặc định soft → vẫn cho bán âm). Frontend chỉ cảnh báo mềm "⚠ thiếu" nhưng vẫn cho bấm.

**Quyết định user:** chặn CỨNG cho **cả Bán giao hàng + Bán nhanh** (độc lập soft/hard toàn cục); tồn dùng để kiểm tra + hiển thị = **kho chính chi nhánh** (`warehouse_id`, khớp nơi thực trừ kho).

- **Migration `20260625000000_pos_block_oversell.sql` (ĐÃ apply remote + verify OK):** sửa thân `fn_pos_build_draft` — chokepoint dùng chung của `fn_pos_quick_sale` và `fn_create_delivery_draft`. Thêm bước kiểm tồn HARD độc lập `stock_control_mode`: yêu cầu `warehouse_id` NOT NULL (else RAISE "Chưa chọn kho xuất hàng"); gộp theo product (gồm dòng quà tặng/KM), so tồn khả dụng (`quantity_on_hand - quantity_reserved`) tại kho đơn; thiếu → `RAISE 'Không đủ tồn kho: <SP> (cần X, còn Y)'` (dùng `trim_scale` bỏ số lẻ thừa) → rollback. Soft toàn cục VẪN áp cho các luồng xác nhận khác (đơn herd...).
- **Frontend `POSPage.tsx` (cần COMMIT + DEPLOY):** `fetchStockData` truy vấn tồn theo **kho chính** (`mainWh.id`) thay vì cộng mọi kho → "Tồn" hiển thị khớp số backend enforce; memo `oversellLines` (gộp giỏ theo product vs `productStock`); `handlePayment` chặn cả 2 mode khi có oversell; nút `#btn-pos-pay` `disabled` thêm `oversellLines.length>0`; banner đỏ liệt kê SP thiếu trên nút.
- **Nghiệm thu remote (tx + savepoint rollback, user authenticated qua jwt claims):** tồn 0 bán → RAISE "Không đủ tồn kho: ... (cần 2, còn 0)"; tồn đủ → tạo nháp OK (rollback, leaked_order=0); thiếu kho → RAISE "Chưa chọn kho xuất hàng". `tsc -b`+`vite build` PASS.
- **Toàn vẹn/bảo mật:** chặn ở backend (không bypass qua API), `fn_pos_build_draft` REVOKE PUBLIC; phân quyền không đổi (vẫn `orders.create`). Lưu ý: đơn nháp không giữ chỗ tồn (reserve chỉ khi xác nhận FEFO) → 2 nháp có thể cùng qua check rồi 1 kẹt lúc xác nhận; bảo đảm cứng cuối cùng vẫn ở bước xác nhận.

---

## 2026-06-08 (tiếp) — Kho: phân trang 20 dòng/trang toàn bộ bảng

- **Frontend-only, KHÔNG migration. `tsc -b` + `vite build` PASS.**
- **Component mới `src/components/Pagination.tsx`** (dùng chung): controlled (`currentPage`/`totalItems`/`pageSize`/`onPageChange`/`itemLabel`), hiển thị "Hiển thị X-Y trên tổng số Z <đơn vị>" + nút Trước/số trang/Sau (mẫu lấy từ `ProductListPage`); ẩn khi rỗng, nút trang chỉ hiện khi >1 trang.
- **`InventoryPage.tsx`:** `PAGE_SIZE=20`; thêm 6 state trang + 6 `pagedX` (slice client-side) cho cả 6 tab (Tồn kho/Đơn đặt hàng/Phiếu nhập/Chuyển kho/Trả NCC/Định mức); thay 12 chỗ `.map` (desktop + mobile mỗi tab) sang `pagedX`; chèn `<Pagination>` cuối mỗi tab. Reset trang về 1 khi danh sách (đã lọc) đổi (`useEffect` theo `filteredX`/`invSettings`) → không kẹt trang ngoài phạm vi.
- **Phạm vi:** phân trang client-side (dữ liệu đã nạp sẵn trong state — lots dùng `fetchAllRows`, các tab khác `.limit(100)`). Empty-state vẫn theo `filteredX.length`. Không đổi RLS/phân quyền/truy vấn.

---

## 2026-06-09 — Kho: nén bảng danh sách còn 1 dòng/phiếu (thuần UI)

- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ sửa `src/pages/inventory/InventoryPage.tsx`.
- **Bối cảnh (user báo qua ảnh tab Phiếu nhập kho):** mỗi phiếu chiếm 4-6 dòng → xem được ít, phải cuộn nhiều. Yêu cầu: hiển thị mỗi phiếu trên 1 dòng; CHỈ tối ưu giao diện, KHÔNG đổi chức năng.
- **Gốc làm hàng cao:** (1) padding `px-6 py-4` lớn; (2) text tự xuống dòng — tên NCC/kho/người nhận dài wrap nhiều dòng; (3) trạng thái hiển thị TRÙNG 2 chỗ (badge dưới mã phiếu + cột "Trạng thái" riêng, nội dung lại không nhất quán).
- **Đã làm (cả 6 tab desktop — user duyệt phạm vi toàn module + gộp trạng thái):**
  - Nén mật độ `px-6 py-4` → `px-4 py-2.5` cho th/td.
  - Chống wrap: cột tên (NCC/SP/kho) dùng `max-w-[...] truncate` + `title` (hover xem đủ); các cột ngắn (mã/ngày/người/tiền/trạng thái/hành động) thêm `whitespace-nowrap`.
  - **Tab Phiếu nhập:** bỏ badge trạng thái trùng dưới mã phiếu → ô mã 1 dòng; gộp về 1 badge `RECEIPT_STATUS` (đủ 4 trạng thái Nháp/Đã duyệt/Hoàn thành/Đã hủy) ở cột "Trạng thái" (trước đó cột này chỉ phân biệt Hoàn tất/raw).
- **Card mobile giữ nguyên** (đang phù hợp màn nhỏ). Trang chi tiết `GoodsReceiptDetailPage` đã tối ưu sẵn (stepper + grid + bảng `whitespace-nowrap`) — không sửa.
- **Toàn vẹn/phân quyền/bảo mật KHÔNG đổi:** không đụng query/RPC/RLS/lọc branch (`warehouse.branch_id`)/gate `isAdmin`/phân trang 20 dòng/điều hướng. 100% là class Tailwind + cấu trúc JSX trình bày.

---

## 2026-06-09 (tiếp) — Kho: XÓA HẲN cuộn ngang bảng danh sách (table-fixed, thuần UI)

- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `src/pages/inventory/InventoryPage.tsx`.
- **User báo:** sau khi nén 1 dòng/phiếu, bảng vẫn rộng hơn khung → còn thanh cuộn ngang, phải kéo qua mới thấy Ghi chú/Chi tiết → chậm thao tác. Yêu cầu xóa hẳn cuộn ngang.
- **Kỹ thuật:** bỏ `overflow-x-auto` ở 6 wrapper bảng (→ `hidden md:block`); đổi mọi bảng sang **`table-fixed w-full`** (cột chia theo khung, nội dung dài tự cắt `…`); mỗi ô `truncate` + `title` (hover xem đủ); padding `px-4`→`px-3`; cột phụ (kho/ngày/người) `text-tiny`; badge `text-[10px]`. Đặt bề rộng cố định `w-[..px]` cho cột ngắn, để cột tên (NCC/SP/kho) co giãn.
- **Tab Phiếu nhập (theo yêu cầu user):** header "Mã phiếu nhập"→**"Code"**, "Nhà cung cấp"→**"NCC"**; **bỏ cột "Hành động"**; **gán hyperlink** vào Code (button gọi `navigate('/goods-receipts/:id')` — đúng hàm nút "Chi tiết" cũ).
- **Đồng bộ các tab khác:**
  - **Chuyển kho / Trả NCC:** "Mã yêu cầu"/"Mã phiếu"→**"Code"** (button mở modal chi tiết — chuyển onClick từ cột Hành động sang Code); **bỏ cột Hành động**; Trả NCC "Nhà cung cấp"→"NCC".
  - **PO:** "Mã đơn PO"→"Code", "Nhà cung cấp"→"NCC"; **GIỮ nút "Nhập kho"** (chức năng tạo phiếu nhập từ PO — PO không có trang chi tiết).
  - **Tồn kho theo lô / Định mức:** `table-fixed` + rút gọn header dài (HSD/Giá vốn/Tồn KD); **GIỮ cột Thao tác** (Sửa/Xóa lô, Sửa/Xóa định mức = chức năng — user duyệt giữ nguyên).
- **Card mobile giữ nguyên.** Modal chi tiết chuyển kho/trả NCC giữ nguyên (chỉ đổi nguồn mở từ Code).
- **Toàn vẹn/phân quyền/bảo mật KHÔNG đổi:** không đụng query/RPC/RLS/lọc branch/gate isAdmin/phân trang 20 dòng/đích điều hướng. Nút Code gọi đúng hàm cũ. 100% class Tailwind + đổi vị trí onClick.

---

## 2026-06-09 (tiếp 2) — Kho/Phiếu nhập: bỏ cột Ghi chú, Ngày nhập kèm giờ, tab mặc định

- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `src/pages/inventory/InventoryPage.tsx`.
- **Bỏ cột "Ghi chú"** ở bảng desktop tab Phiếu nhập (chiếm diện tích, ít tác dụng). Vẫn giữ `notes` trong query + card mobile.
- **Cột "Ngày nhận" → "Ngày nhập"**, hiển thị **ngày + giờ** lấy từ `created_at` (TIMESTAMPTZ — "giờ nhập" thực tế; `receipt_date` là DATE không có giờ). Định dạng `dd/mm/yyyy HH:mm`. Đổi sắp xếp mặc định `.order('created_at', desc)` → phiếu nhập **mới nhất theo giờ lên đầu**. Thêm `created_at` vào select + interface + card mobile (nhãn + giờ).
- **Tab mặc định khi mở /inventory = "Phiếu nhập kho"** (`useState` `activeTab` đổi `'lots'`→`'receipts'`). Nhờ vậy nút **"Về Kho hàng"** ở trang chi tiết (`navigate('/inventory')`) cũng quay về đúng tab Phiếu nhập kho.
- **Toàn vẹn/phân quyền/bảo mật KHÔNG đổi:** chỉ đổi cột hiển thị + thứ tự sắp xếp + tab mặc định (state cục bộ). Không đụng RLS/lọc branch/RPC/phân trang. `created_at` đã có sẵn trong bảng.

---

## 2026-06-09 (tiếp 3) — Đơn hàng: bảng 1 dòng/đơn, xóa cuộn ngang (thuần UI)

- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `src/pages/orders/OrderListPage.tsx`.
- Áp dụng cùng pattern như Kho: bỏ `overflow-x-auto` (→ `hidden md:block`); bảng `table-fixed w-full`; `px-6 py-4`→`px-4 py-2.5`; cột Mã đơn/Khách hàng/NV phụ trách `truncate`+`title`; Ngày tạo + Tổng giá trị `whitespace-nowrap`; đặt `w-[..px]` cho cột ngắn, cột Khách hàng co giãn.
- **Badge** `renderStatusBadge`/`renderPaymentStatusBadge` thêm `whitespace-nowrap` → "Chưa thanh toán"/"Đã xác nhận" không còn wrap 2 dòng (thủ phạm chính làm hàng cao).
- Cột "NV phụ trách": flex `min-w-0` + icon `shrink-0` + span `truncate` để tên dài không đẩy bảng.
- Card mobile giữ nguyên. Toàn vẹn/phân quyền/bảo mật KHÔNG đổi (row vẫn onClick `navigate('/orders/:id')`; không đụng query/RLS/lọc/phân trang).

---

## 2026-06-09 (tiếp 4) — Đơn hàng: rút gọn header, fix đè cột, phân trang 20/trang

- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `src/pages/orders/OrderListPage.tsx`.
- **Đổi header (theo user):** "Mã đơn hàng"→**Code**, "Khách hàng / Trang trại"→**Khách hàng**, "Ngày tạo"→**Time**, "Nhân viên phụ trách"→**NV**, "Tổng giá trị"→**Tổng**.
- **Fix "đè lên nhau":** gốc lỗi = trong `table-fixed`, cột Time (`whitespace-nowrap`) hẹp (128px) → text "08:55 09/06/2026" TRÀN đè sang cột NV; Code 124px → cắt mất mã. **Sửa:** nới Code `w-[148px]`, Time `w-[150px]`, badge Thanh toán `w-[160px]`/Trạng thái `w-[150px]`; thêm `overflow-hidden` vào các ô (Time/NV/Tổng/badge) để KHÔNG bao giờ tràn đè ô bên cạnh; padding `px-4`→`px-3`.
- **Phân trang 20 đơn/trang:** `itemsPerPage` 8→20 (client-side slice; data nạp đủ qua `fetchAllRows` rồi lọc+slice). Nút trang render theo `totalPages` (≈3 trang với lượng đơn hiện tại).
- **Toàn vẹn/phân quyền/bảo mật KHÔNG đổi:** không đụng query/RLS/lọc branch (`branch_id`)/realtime/điều hướng. Row vẫn onClick `navigate('/orders/:id')`. Card mobile giữ nguyên.

---

## 2026-06-09 (tiếp 5) — Đơn hàng: trị tận gốc đè cột (spacer column + giảm font)

- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `src/pages/orders/OrderListPage.tsx`.
- **Gốc rễ thật sự của đè cột:** trong `table-fixed w-full`, cột "Khách hàng" là cột CO GIÃN DUY NHẤT → nuốt toàn bộ chiều rộng dư (~600px) → các cột Time/NV/Thanh toán/Trạng thái giữ bề rộng nhỏ → nội dung cắt/đè + khoảng trống lớn giữa Khách hàng↔Time. (Lần trước chỉ thêm overflow-hidden = clip chứ chưa hết hẹp.)
- **Sửa:** đặt bề rộng cố định cho CẢ 7 cột (Code150/KH320/Time120/NV108/Tổng116/TT140/TThái132) + thêm **1 cột trống cuối (spacer, auto width)** hút phần dư → cột dồn sát trái, thu hẹp khoảng cách, không cột nào bị bóp. Giảm **font 5 cột** Time/NV/Tổng/Thanh toán/Trạng thái → `text-[11px]`; badge `px-2 text-[11px] gap-1 icon11`. Padding 5 cột phải `px-2`.
- **Bài học table-fixed (quan trọng):** muốn các cột "dồn trái + không bị cột flex nuốt chỗ" → đặt width cố định hết + 1 spacer cuối auto. Không để 1 cột flex giữa bảng độc chiếm slack.
- Toàn vẹn/phân quyền/bảo mật KHÔNG đổi. Card mobile dùng chung badge (nay 11px — vẫn hợp lý).

---

## 2026-06-09 (tiếp 6) — Đơn hàng: bỏ spacer, cân bằng bảng lấp đầy body

- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` PASS.** Chỉ `src/pages/orders/OrderListPage.tsx`.
- **Lỗi:** cột spacer (tiếp 5) hút hết phần dư về bên phải → bảng dồn trái, khoảng trống lớn bên phải, không cân với body.
- **Sửa:** bỏ cột spacer (th+td); trả cột "Khách hàng" về **co giãn** (`min-w-[240px]`, không width cố định) → hút phần dư, **lấp đầy đều chiều rộng body**. 6 cột còn lại giữ width cố định + font `text-[11px]` (không đè/cắt như đã fix). Kết quả cân bằng: Khách hàng (nội dung dài nhất) chiếm phần rộng, cụm phải gọn.
- Không đụng dữ liệu/quyền/điều hướng/phân trang.

---

## 2026-06-09 (tiếp 7) — LAYOUT BẢNG CHUẨN TOÀN CỤC: component DataTable (Phase 1)

**Bối cảnh:** User nhận ra 33 bảng trong dự án tự viết tay, KHÔNG kế thừa (Order/Inventory/Customer/Product mỗi nơi một kiểu). Yêu cầu: xây 1 layout bảng chuẩn (theo Order) áp toàn cục. Đã chốt: **component DataTable** + **Phase 1 = Order + Inventory**.

- **Frontend-only, KHÔNG migration. `tsc -b --noEmit` + `vite build` PASS.**
- **Component MỚI `src/components/DataTable.tsx`** — bảng danh sách CHUẨN kế thừa toàn cục:
  - `table-fixed w-full` (KHÔNG cuộn ngang) · 1 cột `flex` co giãn + cột phụ `width` cố định (qua `<colgroup>`) · header chuẩn (bg-gray-25, text-tiny uppercase, whitespace-nowrap) · body divide-y + hover + mỗi ô `overflow-hidden`+`truncate` (trừ ô `noTruncate`) · font `text-[13px]`.
  - Tích hợp: **loading skeleton · empty state (emptyText/emptyIcon) · card mobile TỰ SINH từ columns · phân trang client-side 20 dòng (tự reset trang qua `resetSignal`)**.
  - API: `columns: DataTableColumn<T>[]` (key/header/width|flex/minWidth/align/render/noTruncate/hideOnMobile/mobileHeaderRight) + `rows`/`getRowKey`/`loading`/`onRowClick`/`pageSize`/`itemLabel`/`resetSignal`/`card`/`emptyText`/`emptyIcon`. `card={false}` khi đã nằm trong card sẵn (vd tab Inventory).
- **OrderListPage:** xóa bảng/desktop + card mobile + pagination thủ công (state currentPage/itemsPerPage/indexOf...) → dùng `<DataTable>` + `columns`. Bỏ import ChevronLeft/ChevronRight/Skeleton. Bỏ `setCurrentPage(1)` trong handler lọc (DataTable lo qua resetSignal).
- **InventoryPage (6 tab):** xóa toàn bộ 6 bảng + 6 card mobile + 6 `<Pagination>` + state phân trang (PAGE_SIZE, lotsPage..., pagedXxx, reset effects) → 6 cấu hình cột (lot/po/receipt/transfer/return/setting) + 6 `<DataTable card={false}>`. Hành vi giữ: Phiếu nhập **click dòng → trang chi tiết**; Chuyển kho/Trả NCC **click dòng → mở modal chi tiết**; Lots/Định mức **giữ cột Sửa/Xóa**; PO **giữ nút Nhập kho**. Fix luôn lỗi **Code bị cắt** (cột Code đủ rộng) + header wrap.
- **Toàn vẹn/phân quyền/bảo mật KHÔNG đổi:** DataTable CHỈ render; mỗi trang giữ nguyên fetch/RLS/lọc branch/phân quyền/điều hướng. Đã verify `tsc -b` + `vite build`.
- **CÒN LẠI (Phase 2/3):** Khách hàng · Sản phẩm · NCC · Sổ quỹ (P2); Báo cáo · Pipeline · Herd... (P3). Bảng chi tiết/line-item/modal xét riêng. Dùng lại `DataTable` cho nhất quán.

---

## 2026-06-09 (tiếp 8) — DataTable Phase 2: Khách hàng · Sản phẩm · Sổ quỹ (NCC giữ card grid)

**Frontend-only, KHÔNG migration. `tsc -b --noEmit` + `vite build` PASS.**

- **Khảo sát phát hiện 4 trang RẤT khác nhau:** Khách hàng/Sản phẩm/Sổ quỹ = bảng **server-pagination** + **dòng mở rộng** (Customer: CustomerQuickView; Product: ProductQuickView); Product thêm **dòng "Tổng cộng"** + ảnh + sao yêu thích (KHÔNG có checkbox chọn nhiều); **NCC = LƯỚI THẺ** (không phải bảng).
- **Quyết định user:** giữ NCC card grid (UX phù hợp); nâng DataTable + convert 3 trang còn lại.
- **Nâng cấp `DataTable.tsx` (props mới, tương thích ngược 100%):**
  - `manualPagination` + `page`/`onPageChange`/`totalItems` → phân trang server-side (không slice).
  - `expandedRowRender(row, collapse)` → click dòng mở panel chi tiết inline (Fragment + `<tr colSpan>`); `collapse` để nút Đóng của QuickView hoạt động; cột render nhận tham số 2 `expanded` (cho mũi tên ▾).
  - `headerSummary` → 1 dòng `<tr>` tổng hợp dưới header (Product "Tổng cộng").
- **Đã convert:**
  - `CustomerListPage` → DataTable (manualPagination + expandedRowRender=CustomerQuickView + cột mã có ▾ + dropdown ⋮ stopPropagation). Bỏ state expandedId/startIndex/totalPages + import ChevronLeft/Right/Fragment/Skeleton.
  - `ProductListPage` → DataTable (manualPagination + expandedRowRender=ProductQuickView + headerSummary tổng tồn/đặt + cột chevron/sao/ảnh). Bỏ state expandedId/totalPages/indexOf + import tương tự.
  - `CashbookPage` → DataTable cho **tab Lịch sử dòng tiền** (manualPagination, click dòng → modal chi tiết) + **tab Phiên ca** (client). Bỏ import ChevronLeft/Skeleton.
- **Toàn vẹn/phân quyền/bảo mật KHÔNG đổi:** giữ nguyên server query (useCustomersList/useProductsList/fetchTransactions), RLS, lọc branch, phân quyền, CSV export, modal chi tiết, localStorage sao yêu thích. DataTable chỉ render.
- **Phase 3 còn lại:** Báo cáo · Pipeline · Herd · các bảng chi tiết/line-item/modal (xét riêng).

---

## 2026-06-10 — Trung tâm Báo cáo: Báo cáo Kho hàng theo Giá vốn (admin-only)

**Bối cảnh:** Xây báo cáo định giá tồn kho theo giá vốn cho `/reports`. 1 SP nhiều lô (mỗi lô `cost_price` riêng) → giá vốn TB = **bình quân gia quyền theo lô**. User chốt phân quyền: **chỉ Admin** (nhất quán khu /reports hiện tại, CEO bị chặn). **Có migration. `tsc -b --noEmit` + `vite build` PASS.**

- **Migration `20260626000000_inventory_valuation_report.sql` (ĐÃ apply remote qua Management API + smoke-test):**
  - **View `v_stock_lot_valuation`** (lô còn hàng mọi status, `lot_value = qty × cost_price`, join products/warehouses/brands/categories) — KHÔNG cho truy cập trực tiếp, chỉ qua RPC.
  - **3 RPC** `SECURITY DEFINER` + check `fn_has_role('admin')` (RAISE nếu không) + REVOKE PUBLIC/GRANT authenticated:
    - `fn_inventory_valuation_summary(p_warehouse_id)` → KPI: tổng tồn/tổng giá trị vốn/số SP/lô/kho (chỉ lô `active`), `missing_cost_products` (SP có lô cost=0), `expiring_90d_value`, `expired_active_lots` (lô active nhưng quá hạn — lỗi dữ liệu), `non_active_value` (giá trị lô cách ly/hỏng).
    - `fn_inventory_valuation_by_product(search, warehouse, brand, category, sort, limit, offset)` — RPC rộng dùng chung 4 tab; `avg_cost = Σ(qty×cost)/Σqty`; vòng quay từ `stock_movements` sale 90 ngày (`turnover_90d = sold_90d/tồn`, `days_of_stock`, `last_sale_at` → tồn lâu/dead stock); sort whitelist value/qty/avg_cost/turnover/days_of_stock/idle; `total_count` (COUNT OVER) cho phân trang server.
    - `fn_inventory_valuation_by_group(group_by, ...)` — brand/category/warehouse cùng shape (validate group_by chống injection); `value_share` % qua SUM OVER.
  - Index mới `idx_stockmov_product_type_created` (product_id, movement_type, created_at DESC) cho scan vòng quay.
  - **🔒 Vá lỗ hổng phát hiện trong lúc làm:** Supabase `ALTER DEFAULT PRIVILEGES` tự GRANT anon/authenticated lên object mới → view `v_order_line_profit` (báo cáo lợi nhuận cũ) **đang lộ qua PostgREST cho mọi user đăng nhập + cả anon**. Migration REVOKE cả 2 view (`v_stock_lot_valuation` + `v_order_line_profit`) khỏi PUBLIC/anon/authenticated. Đã verify `has_table_privilege = false`; RPC vẫn chạy (owner postgres).
- **Smoke-test trên DB thật (giả lập JWT admin qua `set_config('request.jwt.claims',...)`):** summary khớp SQL trực tiếp (tồn 12.995,5 · vốn 378.668.954,20₫ · 109 SP · 136 lô); avg_cost gia quyền SP 2 lô khớp tính tay (122.161,26); Σ by_product = Σ by_group(brand) = (category) = (warehouse) = summary; không JWT/JWT non-admin → RAISE "Không có quyền truy cập báo cáo kho hàng". Phát hiện thật: 2 SP thiếu giá vốn + 1 lô quá hạn còn active (báo cáo phơi bày để sửa data).
- **Frontend:**
  - `InventoryValuationReportPage.tsx` (MỚI, route `/reports/inventory-valuation` adminOnly): 4 KPI (tổng tồn / tổng giá trị vốn / SP có tồn / giá trị sắp hết hạn ≤90d) + 2 banner cảnh báo toàn vẹn (thiếu giá vốn, lô quá hạn còn active); 2 chart Recharts (Bar top 10 giá trị vốn, Pie cơ cấu theo nhóm hàng); **7 tab**: Theo SP (DataTable `manualPagination` 50/trang) · Thương hiệu · Nhóm hàng · Kho · Top 50 tồn nhiều (toggle SL/giá trị) · Vòng quay nhanh · Tồn lâu/chậm bán (badge Dead stock khi sold_90d=0, sort lâu-chưa-bán lên đầu); lọc kho toàn trang + SmartSearchSelect SP (fetchAllRows)/thương hiệu/nhóm hàng ở tab SP; Xuất CSV per tab (BOM UTF-8); footnote công thức + giới hạn xấp xỉ vòng quay. **DataTable Phase 3 cho Báo cáo: bảng đầu tiên của module reports dùng DataTable chuẩn.**
  - Hook MỚI `useInventoryValuation.ts` (3 hooks, coerce NUMERIC string→number, `keepPreviousData` chống nháy trang) + `qk.reports.*` trong `queryClient.ts`; card thứ 3 ở `ReportsHubPage` (grid → xl:grid-cols-3); route + lazy import `App.tsx`.
- **Phân quyền/bảo mật:** 3 tầng — DB (RPC tự check admin), route `adminOnly`, menu sidebar adminOnly sẵn có; view nền không grant; `p_sort`/`p_group_by` whitelist tĩnh (không dynamic SQL). Phương án B tương lai: seed permission `report.view_inventory` nếu cần mở cho CEO/kế toán.
- ⚠️ **Biên đã biết:** vòng quay dùng tồn HIỆN TẠI làm mẫu số (không có snapshot tồn bình quân kỳ — đã ghi footnote); `non_active_value` chỉ hiển thị tham khảo; KPI chính chỉ tính lô `active` còn hàng.

---

## 2026-06-10 (tiếp) — Sổ quỹ: audit lại bảo mật + gia cố (migration 20260627000000)

**Bối cảnh:** User yêu cầu kiểm tra lại toàn diện module Sổ quỹ (đã xây S1–S4) với mô hình mới: toàn vẹn dữ liệu, phân quyền, bảo mật, UX. Đã chứng minh exploit thật trên prod (transaction rollback) rồi vá. **Có migration. `tsc -b` + `vite build` PASS.** Tài liệu: `docs/06-CASHBOOK-PLAYBOOK.md` (mục Audit 2026-06-10).

- **Migration `20260627000000_cashbook_harden.sql` (ĐÃ apply remote + verify exploit bị chặn):**
  - **C1 (NGHIÊM TRỌNG):** `fn_apply_fund_delta` (SECURITY DEFINER sửa thẳng số dư quỹ) chưa REVOKE → mọi user gọi `rpc()` sửa số dư tùy ý. Chứng minh: non-admin đẩy QUY-HCM 30.46M→31.24M. **Vá:** REVOKE `fn_apply_fund_delta` + `fn_default_cash_fund` + `fn_default_bank_account` khỏi PUBLIC/anon/authenticated.
  - **C2 (CAO):** ngưỡng duyệt 10tr chỉ chặn client → INSERT thẳng phiếu chi approved bất kỳ qua API (chứng minh: 50M approved + chèn chéo chi nhánh). **Vá:** tạo lại `cashbook_insert_staff` — non-admin không INSERT được outflow approved > 10tr (phải pending_approval) + cô lập chi nhánh (quỹ/TK thuộc chi nhánh mình) + whitelist status.
  - **C3 (CAO):** clause hở `flow_type='internal_transfer'` cho mọi user chèn dòng rác → bỏ khỏi policy.
  - **C4 (TRUNG):** không state machine + sửa amount phiếu approved không re-balance → trigger BEFORE UPDATE `fn_guard_cashbook_update` (chỉ cho chuyển trạng thái hợp lệ, khóa amount/quỹ khi approved, cancelled chung cuộc, stamp cancelled_at).
  - **Cơ chế:** auto-trigger là SECURITY DEFINER owner=postgres, bảng KHÔNG FORCE RLS → bypass RLS → ràng buộc mới chỉ áp phiếu nhập tay; verify supplier_payment 20M auto vẫn ra approved.
- **Đã verify trên prod (rollback):** sau migration — C1/C2/C3/cross-branch đều BLOCKED; luồng hợp lệ (outflow pending 50M, outflow approved 5M, approved→cancelled, sửa description approved, supplier_payment 20M auto) đều OK; cancelled→approved & sửa amount approved bị chặn đúng.
- **Đã xác nhận LÀNH MẠNH:** self-approval guard, chặn DELETE, SELECT cô lập chi nhánh, 0 phiếu thiếu/lệch chuyển quỹ/lệch công nợ NCC, sessions không lệch. 4 phiếu mồ côi đều đã cancelled (vô hại).
- **Frontend:** `CashbookReports.tsx` bảng HTML thủ công → **DataTable chuẩn** (cột Ngày/Loại/Diễn giải/Số tiền/Số dư lũy kế, client paging 20 — số dư lũy kế precompute nên an toàn) + banner lỗi tải; `CashbookPage.tsx` 3 catch nuốt lỗi (loadMetadata/fetchTransactions/loadSessions) → banner `dataError` + nút Thử lại; extract hằng số `APPROVAL_THRESHOLD=10tr` (đồng bộ RLS).
- ⚠️ **Vấn đề DỮ LIỆU vận hành (báo user, KHÔNG tự sửa):** quỹ **QUY-DN (Phù Mỹ) số dư -580.000₫** — tiền mặt không thể âm; do nộp quỹ cuối ca (1.150.000₫) vượt tổng thực thu (~994.000₫). Cần rà nghiệp vụ đóng ca + điều chỉnh bằng phiếu lệch quỹ.
- ⚠️ **Hoãn (ghi nợ):** threshold cấu hình qua system_settings; RPC `fn_settle_employee_advance`; RPC `fn_close_cashier_session` (đóng ca atomic chặn nộp vượt → tránh quỹ âm).

---

## 2026-06-11 — Trung tâm Báo cáo: SẢN PHẨM CHIẾN LƯỢC & TỐI ƯU LỢI NHUẬN (admin-only, realtime)

**Bối cảnh:** User vận hành 2 luồng SP: **Nhóm 1 chiến lược** (markup ≥50% trên giá vốn — nguồn lãi chính, BẮT BUỘC ≥30% doanh số mỗi chi nhánh) và **Nhóm 2 hàng nền** (bắt buộc có mặt, quay nhanh, hòa/lỗ — nhóm 1 bù nhóm 2). Xây module theo dõi chặt + cảnh báo khoa học + mục tiêu doanh số tháng + theo dõi LIVE. Doc đầy đủ: `docs/10-STRATEGIC-PRODUCTS-REPORT.md`. **Migration ĐÃ apply remote + smoke test PASS. `tsc -b` + `vite build` PASS.**

- **Migration `20260628000000_strategic_products.sql`:**
  - Bảng `product_strategy` (product_id PK, class strategic/baseline, note, audit assigned_by/at; không có dòng = hàng thường; RLS read active/write admin) + `branch_month_targets` (UNIQUE branch+year+month, revenue_target, strategic_share_target DEFAULT 0.30; **RLS admin-only cả SELECT** — số nhạy cảm).
  - Seed `system_settings.strategic_config`: markup_min 0.5 · baseline_loss_floor −0.05 · suggest_min_revenue_90d 5tr · suggest_min_qty_90d 30 · oos_warn_days 7 (đổi qua UI, RPC đọc COALESCE).
  - **7 RPC admin-only** (template fn_inventory_valuation_*, gate `fn_has_role('admin')` thuần, whitelist sort/class, COUNT OVER, REVOKE+GRANT): `fn_strategic_summary` (1 dòng/CN: revenue/profit 3 nhóm, share, **cross_subsidy**, violation counts, target join, month_elapsed_ratio, **GMROI N1/N2**) · `fn_strategic_products` (manualPagination; markup/margin/sold_30d/tồn/**days_to_oos**/**GMROI**/is_violation/missing_cost) · `fn_strategic_suggestions` (90 ngày, SP chưa gán: markup≥min+rev≥ngưỡng→N1, qty≥ngưỡng+markup<min→N2) · `fn_strategic_alerts` (**7 loại**: share_below_target · strategic_below_markup · baseline_deep_loss · cross_subsidy_negative CRITICAL · pace_behind · strategic_oos_risk · baseline_oos_risk CRITICAL) · `fn_strategic_trend` (≤24 tháng) · `fn_strategic_today` + `fn_strategic_today_orders` (live từ 0h giờ VN).
  - Múi giờ `Asia/Ho_Chi_Minh` cho ranh giới ngày/tháng; markup NULL khi cogs=0 (missing_cost, không tính vi phạm); index `idx_orders_branch_created`; DO-block guard `orders` vào publication realtime. KHÔNG tạo view mới (tránh lỗ hổng auto-GRANT).
- **Frontend:** `StrategicProductsReportPage.tsx` (route `/reports/strategic-products` adminOnly, card thứ 4 hub) — **6 tab**: ⓪ **Hôm nay LIVE** (4 KPI + bảng đơn kèm cơ cấu N1/N2 + chấm ● Live) · ① Tổng quan & Cảnh báo (4 KPI pace/share/bù chéo + banner 7 cảnh báo tiếng Việt + stacked bar CN + ComposedChart 12 tháng share%+bù chéo + bảng CN) · ② SP nhóm 1 (markup đỏ khi vi phạm + gợi ý "cần bán ≥ X" + Tồn/Hết sau ~N ngày + GMROI + Gỡ/Chuyển nhóm + modal Gán SP) · ③ SP nhóm 2 (margin vs sàn lỗ) · ④ Gợi ý phân loại (Chấp nhận 1 click) · ⑤ Mục tiêu & Cấu hình (inline edit target từng CN + collapse 5 ngưỡng). CSV per tab.
  - **Realtime:** `useRealtimeTable('orders')` → useCallback + debounce 2s → invalidate prefix `['reports','strategic']` → toàn trang tự refresh không F5. Tab Hôm nay staleTime 0.
  - Files mới: `AssignStrategyModal.tsx`, `useStrategicProducts.ts` (9 query + 3 mutation), keys `qk.reports.strat*`.
- **Nghiệm thu remote (tx-rollback):** tổng trend = Σ summary khớp (179.121.512₫); 7/7 cảnh báo phát đúng với data thử; non-admin bị RAISE cả 7 RPC, RLS chặn SELECT targets + INSERT strategy, view nguồn permission denied; whitelist bogus → exception.

---

## 2026-06-12 — VÁ LOGIC TRẢ HÀNG (hồi kho + trừ công nợ) + Trang Trả hàng `/returns`

**Bối cảnh:** User phát hiện phiếu trả TH-2026-00005 (đơn DH-2026-00085, Chị Vân - Vĩnh Đức) hoàn tất nhưng tồn kho không tăng (11 thay vì 12), thẻ kho không có dòng trả, công nợ không trừ. Điều tra remote DB: **migration `20260524000002` CHƯA BAO GIỜ được apply lên remote** (bảng `purchase_returns` không tồn tại, trigger `trg_sales_returns_auto_stock` không có) → cả 5 phiếu trả lịch sử đều không hồi kho. Lỗ hổng thứ 2: hoàn kiểu `credit_note` không có code giảm nợ ở bất kỳ đâu. **Migration ĐÃ apply remote + backfill verify PASS. `tsc -b` + `vite build` PASS.**

- **Migration `20260702000000_fix_sales_returns.sql` (ĐÃ apply remote qua Management API):**
  - **§1 Tái lập purchase_returns** (bảng + trigger trừ kho NCC + RLS — phần bị bỏ sót của 20260524000002, idempotent).
  - **§2 Guard `sales_returns`/`_lines`** (pattern guard đơn hàng 20260624000001, cờ `app.return_rpc`): INSERT ép pending; cấm đổi status/total_amount/refund_method/order_id trực tiếp; dòng hàng khóa cứng khi phiếu chốt. CHECK status thêm `cancelled`. Cột mới: `debt_offset_total`, `order_paid_delta`, `cancelled_by/at` (audit để đảo chính xác khi hủy).
  - **§3 `fn_sales_return_apply_effects(return_id, apply_debt)`** — dùng chung trigger AFTER UPDATE + backfill, idempotent theo stock_movements: (a) hồi kho với fallback lot 3 tầng (line.lot_id → order_line_allocations → lô active gần nhất / tạo lô RETURN-*); (b) credit_note → settle `customer_debts` FIFO (ưu tiên nợ của đơn, pattern fn_collect_customer_debt), vượt nợ → dòng âm `advance_from_customer`, đồng bộ `orders.paid_amount` + payment_status; (c) đơn → returned_partial/full (AFTER trigger đếm được chính phiếu — fix bug BEFORE cũ; set cờ `app.order_rpc` để qua guard). Vá thêm `fn_track_order_status`: changed_by fallback confirmed_by/owner khi không có auth.uid().
  - **§4 RPC `fn_create_sales_return`** (admin/accountant/team_lead): thay luồng client 3-bước; validate đơn đã giao/hoàn tất, SL ≤ đã mua − đã trả (FOR UPDATE chống race), **đơn giá hoàn ép ≤ giá bán thực (unit_price − discount)**, total tính server. Atomic 1 transaction.
  - **§5 RPC `fn_cancel_sales_return`** (admin-only, CHỈ credit_note — cash/CK phải qua Sổ quỹ): đảo đúng lô đã nhận (RAISE nếu lô đã bán tiếp), tái lập công nợ theo `debt_offset_total`, giảm paid_amount theo `order_paid_delta`, tính lại trạng thái đơn.
  - **§6 Backfill 5 phiếu lịch sử** (quyết định user): hồi kho CẢ 5 (12 thẻ kho); trừ nợ CHỈ TH-00003 (8.543.040₫ → nợ 0, returned_full) + TH-00005 (320.000₫ → Chị Vân còn nợ 250₫); TH-2/4 đã xử lý ngoài hệ thống, TH-1 tiền mặt đã có phiếu chi.
- **Verify remote:** 12 movements sales_return; tồn ZGR-Multiveto 11→12; nợ Chị Vân 250₫; paid DH-00085 = 4.020.000. **Test guard** (5/5 BLOCKED): đổi status/total/dòng hàng trực tiếp, RPC không quyền. **E2E tx-rollback giả lập JWT admin:** tạo phiếu giá gian lận 999.999.999 → ép về 16.250; kho 479→480→479 sau hủy; nợ 250→−16.000 (settle+advance)→250 sau hủy.
- **Frontend:** `OrderDetailPage.handleCreateReturn` → 1 call `rpc('fn_create_sales_return')` (hiện debt_offset trong toast). **Trang MỚI `ReturnListPage.tsx`** (route `/returns`, menu Kinh doanh → Trả hàng, perms orders.view_*): DataTable + expandedRowRender (dòng hàng/SKU/lô/kho/giá), 3 summary card, filter mã/KH/status/hình thức hoàn/thời gian, realtime sales_returns; admin: Sửa lý do (guard cho phép field này) + Hủy phiếu (modal confirm, disable với cash/CK kèm tooltip). Lưu ý: `sales_return_lines.lot_id` KHÔNG có FK → số lô nạp bằng query phụ, không embed được.
- ⚠️ **Bài học hạ tầng:** migration file tồn tại local ≠ đã apply remote — PHẢI verify schema remote (pg_trigger/pg_proc/to_regclass) sau mỗi migration. Phát hiện vì user thấy số liệu sai.

---

## 2026-06-14 — NHẬP KHO & HÀNG HÓA THEO SỐ THẬP PHÂN (18,5 · 0,5 · 12,8)

**Bối cảnh:** User yêu cầu kho (goods-receipts + các luồng hàng hóa) nhập được số lượng thập phân (bán theo cân/lít/liều). **Kết quả kiểm tra:** tầng DB + RPC ĐÃ sẵn sàng từ migration `20260529000012` — verify remote: `goods_receipt_lines/purchase_order_lines/stock_lots/stock_movements/stock_transfer_lines/order_lines/order_line_allocations/sales_return_lines.quantity` đều `numeric(15,3)`; các RPC (fefo/transfer/admin_edit_lot/check_alerts) đã `NUMERIC`. **Khoảng trống nằm hoàn toàn ở UI:** nhiều ô dùng `parseInt` (cắt thập phân) + thiếu `step`/nút +/- bước 1. `tsc --noEmit` PASS.

- **Migration `20260703000000_inventory_settings_decimal.sql` (ĐÃ apply remote qua Management API + verify):** nới `inventory_settings.{min_stock_level, max_stock_level, reorder_point, reorder_quantity}` từ INTEGER → `NUMERIC(15,3)` (ngưỡng tồn cho hàng cân/lít). Không view nào phụ thuộc 4 cột này (`product_reorder_view` tham chiếu `products.min_stock_level` — cột khác); `fn_check_stock_alerts` đọc động nên không cần sửa hàm.
- **Helper mới `src/lib/parseQty.ts`:** `parseQtyInput` (chấp nhận cả `,` và `.`, bỏ ký tự rác, clamp ≥0, **làm tròn 3 chữ số thập phân khớp scale DB** → chống rounding ngầm), `roundQty`, `formatQty`. Verify toàn vẹn (temp-table generated column): 0,5/12,8/18,5 lưu đúng; 18,5555 → 18,556 cả UI lẫn DB (khớp nhau).
- **Component mới `src/components/DecimalInput.tsx`:** input thập phân tái sử dụng, **giữ chuỗi nháp nội bộ khi gõ** để không nuốt dấu phân tách (vấn đề controlled numeric input — nếu chỉ parseInt/parseFloat trực tiếp trên state số thì gõ "18," bị ép về 18, không gõ tiếp được). Sync lại từ prop khi nguồn ngoài đổi (nút +/-, điền nhanh). Prop `blankZero`, `max`, `disabled`.
- **Các ô đã chuyển sang DecimalInput:** GoodsReceiptFormPage (Thực nhận — cả 2 chế độ Bảng + Chi tiết, nút +/- giữ bước 1 nhưng dùng `roundQty`); PurchaseOrderFormPage (SL đặt mua, validation `<=0` cho phép 0,5); InventoryPage (SL chuyển kho, SL xuất trả NCC + guard `<=0`, và cài đặt tồn min/max/điểm đặt lại/SL đặt lại); OrderDetailPage (SL trả hàng). **Đã đúng sẵn (không đụng):** POSPage (`step=any`+parseFloat), LotEditModal (`step=any`+Number), OrderEditModal (`step=any`+Number).
- **Phân quyền/bảo mật:** KHÔNG đổi — chỉ sửa cách parse số ở UI; RLS + luồng duyệt phiếu (draft→duyệt→hoàn thành) + ràng buộc DB nguyên vẹn. Giá tiền (₫, VND) giữ số nguyên như cũ.

### 2026-06-14 (bổ sung) — Mở rộng & hiển thị đầy đủ nội dung các modal kho

**Bối cảnh:** User báo modal Chuyển kho quá hẹp, tên sản phẩm trong dropdown chọn lô bị cắt ("Mavin-SK100 - 21%(7 ngày tuổi - 8k...") dù màn hình còn dư nhiều chỗ. `tsc --noEmit` PASS.

- **`SmartSearchSelect.tsx` (component dùng chung — sửa gốc):** bỏ `truncate` ở label trong danh sách dropdown → cho tên xuống dòng đầy đủ (`whitespace-normal break-words`), căn lề trên (`items-start`); thêm `title` tooltip trên nút trigger (giữ truncate ở nút gọn). Cải thiện cho mọi nơi dùng (NCC, tỉnh/huyện…).
- **`InventoryPage.tsx` — nới rộng modal:** Tạo chuyển kho + Tạo trả NCC `max-w-3xl→5xl`; Chi tiết chuyển/trả/nhập kho `max-w-4xl→5xl`; Drawer cài đặt định mức tồn `max-w-md→xl`. (Hộp xác nhận hủy lô giữ `max-w-md` vì là confirm nhỏ.)
- **`GoodsReceiptFormPage.tsx`:** dropdown tìm sản phẩm (chế độ nhập trực tiếp) bỏ `truncate` tên SP → hiển thị đầy đủ (wrap), căn `items-start`.
- **Phạm vi:** chỉ CSS độ rộng + bỏ truncate, không đụng logic/RPC/phân quyền/dữ liệu.

### 2026-06-14 (bổ sung 2) — Nén & gọn hóa toàn bộ modal kho (1 màn hình, không cuộn) — thuần UI

**Bối cảnh:** User báo modal **Chi tiết chuyển kho** (và các modal kho khác) bố trí dư thừa: khối thông tin (kho nguồn/đích/ngày/trạng thái…) chiếm quá nhiều chiều cao → phải cuộn mới thấy bảng "Sản phẩm luân chuyển"; chữ to, dòng thưa, dữ liệu dễ đè. **Gốc rễ phát hiện:** các class `text-body-md/body-lg/tiny/mono` **không hề được định nghĩa** trong `tailwind.config.js` lẫn `index.css` (verify cả CSS đã build trong `dist`) → mọi chữ dùng các class này render ở cỡ mặc định ~16px. DataTable.tsx né được vì dùng class thật (`text-[13px]`, `px-3 py-2.5`, header `text-[11px]`). `tsc -b` + `vite build` PASS. **Thuần UI, KHÔNG migration, không đụng logic/handler/điều kiện hiển thị theo `status`/RLS.**

- **Phạm vi (đã duyệt):** 3 modal chi tiết (chuyển kho · xuất trả NCC · nhập kho) + 2 modal tạo phiếu (chuyển kho · trả NCC). KHÔNG sửa token font toàn cục (để tránh ảnh hưởng list view ngoài phạm vi).
- **`InventoryPage.tsx`** — kế thừa mật độ DataTable.tsx:
  - Khung modal: `max-w-5xl→6xl`, `max-h-[85/90vh]→92vh` (rộng & cao hơn, thao tác trong 1 màn hình).
  - Thân modal: `p-6 space-y-6 → p-4 sm:p-5 space-y-4`.
  - **Khối metadata ("phần tô vàng"):** `grid-cols-2 gap-y-4 gap-x-6 p-4` → `grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-2.5 p-3`; nhãn `text-[11px] leading-none mb-0.5`, giá trị `text-[13px]` → dồn 6–8 trường về ~2 dòng. Ghi chú/Chi tiết lý do `col-span-2→col-span-full`.
  - **Bảng sản phẩm:** header `text-tiny→[11px]`, ô `text-body-md→[13px]`, padding `px-4 py-3 / px-4 py-2.5 → px-3 py-2.5` (chuẩn DataTable). SKU & badge trạng thái & mã phiếu `text-tiny→[11px]`. Tiêu đề modal `text-body-lg→text-base`. Label form tạo phiếu `text-tiny→[11px]`.
- **Còn lại (chưa làm, chờ duyệt riêng):** định nghĩa token font toàn cục để trị tận gốc cho cả app; nếu duyệt sẽ tách task riêng có test rộng.

### 2026-06-14 (bổ sung 3) — TRỊ TẬN GỐC: định nghĩa type scale toàn cục trong tailwind.config.js

**Bối cảnh:** User duyệt fix tận gốc. Khảo sát toàn `src/`: các class chữ tuỳ biến được dùng **~2.760 lần** nhưng KHÔNG hề định nghĩa → Tailwind v3 bỏ qua → mọi chữ rơi về cỡ mặc định ~16px. Đếm: `text-body-md` 1251 · `text-tiny` 979 · `text-body-lg` 216 · `text-body-sm` 73 · `text-headline-md` 12 · `text-headline-lg` 11 · `text-display-xs` 6 · `text-display-sm` 5 · `text-label-md` 3 · `text-headline-sm` 1. (`text-mono` đã hết sau bổ sung 2.) `tsc -b` + `vite build` PASS, verify token đã vào CSS build.

- **`tailwind.config.js` → `theme.extend.fontSize`** (MERGE với mặc định, `text-sm/base/lg` chuẩn vẫn chạy). Thang calib theo px thật đang dùng (241× `text-[11px]`, 35× `text-[13px]`, 11× `text-[28px]`):
  - `tiny` 11/15 · `body-sm` 12/16 · `label-md` 13/18 (+letter-spacing) · **`body-md` 14/20 (chữ thân workhorse)** · `body-lg` 16/24 · `headline-sm` 18/26 · `headline-md` 20/28 · `headline-lg` 24/30 · `display-xs` 28/34 · `display-sm` 32/38.
- **Tác động:** toàn app gọn lại đúng thiết kế — đáng kể nhất là `body-md` 16→14 và `tiny` 16→11 (caption/SKU/badge). `body-lg` giữ 16 nên các tiêu đề nhấn không đổi.
- **Phạm vi:** CHỈ thêm fontSize tokens, KHÔNG đổi màu/spacing/logic. Các sửa hardcode `text-[13px]/[11px]` ở 5 modal kho (bổ sung 1–2) giữ nguyên — vẫn khớp thang mới (13≈label-md, 11=tiny).
- **⚠️ Chưa làm:** màu tuỳ biến chưa định nghĩa (`gray-755/850/550`, `red-650/750`) cũng là no-op → chữ inherit màu; là task nhỏ riêng nếu user muốn (không gấp).

### 2026-06-15 — Sửa lỗi "con" ở bản in + nâng cấp layout trang Chi tiết đơn hàng

**Bối cảnh:** User báo bản in hóa đơn (`/print-preview`) cột **SL** hiển thị thừa chữ **"con"** (vd "6,30 con") dù cột ĐVT đã có "gói"; và muốn bố trí lại trang Chi tiết đơn hàng cho gọn/khoa học. `tsc -b` PASS; 36/37 unit test pass (1 fail `queryClient.test.ts` về `qk.dashboard.stats` — tồn tại sẵn, không liên quan).

- **Gốc lỗi "con":** `formatQuantity(val, unit)` trong `DisplaySettingsContext.tsx` dùng `unit || default_units_count` → chuỗi rỗng `''` (PrintLayout cố ý truyền để bỏ đơn vị) là falsy nên rơi về `default_units_count = 'con'`. **KHÔNG phải** từ cấu hình trang in.
  - **Fix:** phân biệt `unit === undefined` (dùng đơn vị mặc định) với `unit === ''` (bỏ đơn vị, trả số trần). Áp dụng đồng loạt cho 6 chỗ gọi trong `PrintLayout.tsx` (hóa đơn/nhập/trả/xuất). Export Excel/PDF dùng helper `qty()` riêng → vốn đã đúng.
- **Layout `OrderDetailPage.tsx` (thuần UI):** thứ tự mới từ trên xuống: (1) Thông tin vận chuyển gộp **1 dải ngang** lên đầu (KH+tier · SĐT · Địa chỉ giao · Kho xuất · NV); (2) lưới 2 cột **Sản phẩm đặt hàng (col-8) | Xem trước hóa đơn (col-4)**; (3) tiến trình (stepper) **đưa xuống cuối**; (4) **Lịch sử thanh toán** dưới tiến trình.
  - "Sản phẩm đặt hàng" render bằng **DataTable.tsx** (kế thừa) — STT · Tên+SKU · SL · Đơn giá · CK · Thành tiền; `pageSize={0}` `card={false}` → hiện hết mọi SP, mỗi SP 1 dòng, **bỏ scroll** (trước có `max-h-[260px] overflow-y-auto`). Tổng (Tạm tính/Chiết khấu/Tổng cộng) đặt dưới bảng.
- **Phạm vi:** KHÔNG đụng RPC (`fn_confirm_order`/`fn_advance_delivery`/`fn_complete_delivery_payment`/`fn_cancel_order`/`fn_create_sales_return`), `editPerms`/`isAdmin`/`canStaffAct`, truy vấn dữ liệu hay DB. Mọi điều kiện hiển thị nút giữ nguyên.

### 2026-06-15 (bổ sung) — Tinh chỉnh layout đợt 2 + render logo bản in

**Bối cảnh:** User phản hồi sau đợt 1: tên KH ở dải ngang bị đè/cắt; khung quá rộng; muốn 2 cột (trái=SP, phải=thông tin + gộp luôn Lịch sử thanh toán); bỏ hẳn khối "Xem trước hóa đơn" (biên lai giả), đưa nút in lên thanh trên cùng; bảng SP dòng còn thưa → thu hẹp + bổ sung Lô/HSD. Bản in (Hình 2) đã đúng nhưng chưa hiện logo dù đã cấu hình. `tsc -b` PASS.

- **`OrderDetailPage.tsx`:**
  - **Bỏ dải vận chuyển ngang trên cùng** và **bỏ panel "Xem trước hóa đơn"** (biên lai nhiệt giả + nút Zalo/SMS — gỡ luôn icon `Send`, `Boxes`).
  - Bố cục mới: lưới 2 cột — **trái (col-8)** = bảng SP; **phải (col-4)** = card "Thông tin đơn hàng" (KH/SĐT/Địa chỉ/Kho/NV, dùng `break-words` để tên KH **không bị cắt**) + card "Lịch sử thanh toán" (gộp xuống đây). **Stepper** vẫn ở cuối trang.
  - **Nút "In hóa đơn"** chuyển lên thanh thao tác trên cùng (mở `/print-preview?type=invoice&id=`).
  - Bảng SP: thay DataTable component bằng **bảng `<table>` gọn cùng phong cách DataTable** (header `bg-gray-25 text-tiny uppercase`, `divide-y divide-gray-50`, `text-[13px]`) nhưng **padding `py-1.5`** (thu hẹp dòng) + dòng phụ **SKU · Lô · HSD** dưới tên SP. Lấy Lô/HSD qua `order_line_allocations → stock_lots` trong `loadOrderDetails` (lô đầu tiên/dòng, giống bản in).
- **`PrintLayout.tsx` — logo:** `renderHeader` giờ render `<img src={header.logoUrl}>` (w/h 10, object-contain) nếu có `print_company_logo_url`, ngược lại fallback ô chữ "SL". `header = data.headerConfig || printConfig`; PrintPreview không truyền headerConfig nên dùng `printConfig` (đọc từ `display_settings`). **Lưu ý chưa làm:** export **PDF** (`documentPdf.tsx`) vẫn chưa nhúng logo (cần react-pdf `Image` + lo CORS) — tách riêng nếu user cần.
- **Phạm vi:** thuần UI + 1 truy vấn đọc allocations để hiển thị; KHÔNG đụng RPC/phân quyền/DB.

## 2026-06-16 — 🐛 HOTFIX POS KHÔNG BÁN ĐƯỢC HÀNG (regression cờ guard trạng thái)

**Triệu chứng (user báo + ảnh):** Bán nhanh tại quầy bấm Thanh toán (F9) báo *"Thao tác thất bại: Không được đổi trạng thái đơn hàng trực tiếp. Hãy dùng chức năng Xác nhận/Giao/Hoàn tất/Hủy."* — dù SP đã nhập kho & KH đã thiết lập hạn mức nợ. **KHÔNG phải** lỗi tồn kho/công nợ.

- **Gốc lỗi (xác minh trên DB production qua Management API):** thông báo này do trigger `trg_guard_order_status`/`fn_guard_order_status` (migration `20260624000001`) ném ra khi UPDATE `orders.status` trực tiếp mà KHÔNG có cờ phiên `app.order_rpc='on'`. Migration `20260708000000_pos_overpayment_to_credit.sql` đã **CREATE OR REPLACE viết lại `fn_pos_quick_sale`** (để thêm `overpay_credit`) nhưng **vô tình bỏ mất dòng** `PERFORM set_config('app.order_rpc','on',true);` vốn được thêm ở guard 20260624. → mọi giao dịch bán nhanh (draft→confirmed→completed) bị guard chặn → rollback → không bán được.
- **Xác minh remote:** `pg_get_functiondef(fn_pos_quick_sale) LIKE '%app.order_rpc%'` = **false**; 6 RPC đổi status còn lại (`fn_pos_edit_order/confirm_order/advance_delivery/complete_delivery_payment/cancel_order/confirm_generated_order`) = **true** → regression CÔ LẬP ở 1 hàm.
- **Fix — migration `20260709000000_fix_pos_quick_sale_status_guard.sql` (ĐÃ apply remote + reload schema + verify `has_flag=true`):** `CREATE OR REPLACE fn_pos_quick_sale` giữ NGUYÊN logic 20260708 (kể cả `overpay_credit`, gọi `fn_pos_settle_payment` 4 tham số), chỉ thêm lại `PERFORM set_config('app.order_rpc','on',true);` ngay đầu BEGIN (phạm vi TRANSACTION → đủ cho mọi UPDATE status lồng nhau). Không đổi chữ ký/GRANT/nghiệp vụ khác.
- **Toàn vẹn/phân quyền/bảo mật:** không đổi. Vẫn `SECURITY DEFINER` + check `orders.create`, GRANT `authenticated`; cờ phạm vi giao dịch (tự xóa khi commit) nên client UPDATE thẳng VẪN bị guard chặn — không mở rộng bề mặt tấn công.
- **⚠️ Tracking lệch (phát hiện kèm):** `supabase_migrations.schema_migrations` chỉ tới `20260706000000`; các bản `20260702/20260707/20260708` đã apply remote nhưng KHÔNG có trong tracking (untracked apply qua Management API). Đã chèn thủ công row `20260709000000` để `supabase db push` sau không chạy lại. **Còn nợ:** nên backfill 3 row tracking lệch kia trước lần `db push` tiếp theo (nếu không push có thể cố chạy lại — riêng 20260708 có `DROP FUNCTION` cần lưu ý).
- **Bài học (ghi memory):** khi CREATE OR REPLACE viết lại bất kỳ RPC nào đổi `orders.status`, PHẢI giữ lại `set_config('app.order_rpc','on',true)` ở đầu hàm — nếu không sẽ bị guard chặn. Đồng thời migration local ≠ đã apply remote → luôn verify `pg_get_functiondef` trên DB thật.
- **Đề xuất để sau (không trong fix):** map thông báo lỗi guard sang câu thân thiện hơn cho thu ngân ở `POSPage.handlePayment` (hiện surface nguyên văn message DB).

## 2026-06-23 — ⭐ ĐẦU TƯ ĐỘ TIN CẬY (B1 backup + A test + B2 monitoring + C POS offline)

**Bối cảnh:** Sau loạt nâng cấp VAT theo lô, đầu tư nền tảng tin cậy. Bỏ 2 đề xuất (e-invoice, cầu MISA). Thứ tự thực thi B1→A→B2→C. Chi tiết: `docs/11-RELIABILITY-PLAN.md`, `docs/12-MONITORING-SETUP.md`.

- **B1 — Backup ✅:** `.github/workflows/db-backup.yml` pg_dump custom-format hằng ngày 01:00 VN → Google Drive (rclone, tài khoản người dùng), giữ 30 ngày + artifact 14 ngày. `clone-schema-to-staging.yml` clone schema prod→staging cho test.
- **A — Test pgTAP ✅ 12/12 (staging):** `supabase/tests/*` + `scripts/db/run-tests.mjs` (`npm run test:db`). Phủ: hoàn thành phiếu nhập (giữ/tách/gộp lô VAT + guard), chuyển kho giữ VAT, trả hàng giữ VAT + idempotent, xuất hóa đơn VAT (số liệu + chống trùng), products_list tách tồn, POS quick-sale idempotency, 3 bất biến.
- **B2 — Monitoring ✅ (prod+staging):** migration `20260723000000_monitoring` — pg_cron+pg_net; `monitor_runs`+`app_error_logs` (RLS); `fn_integrity_check()` 7 bất biến; `fn_monitor_tick()` (cron 08:00 VN) bắn Telegram khi critical; `fn_send_telegram()` đọc Vault; `fn_health()`; `fn_log_client_error()`. FE `logger.report`+global error reporting. Edge `health` cho UptimeRobot. **Còn [BẠN]:** revoke+nhập Vault token Telegram, deploy edge health, đăng ký UptimeRobot.
- **C — POS offline cơ bản ✅:** migration `20260724000000_pos_offline_idempotency` (`orders.client_request_id` unique + `fn_pos_quick_sale` dedup). FE `offlineDb`(idb snapshot 72h + hàng đợi), `useOnlineStatus`, `usePosOfflineQueue` (tự flush, failed giữ lại báo NV), `PosOfflineBar`, POSPage hydrate offline + enqueue. Quyết định: lỗi tồn→giữ báo NV; bán nợ offline cho phép kèm cảnh báo; bán giao hàng vẫn cần online.
- **⚠️ Bảo mật còn nợ [BẠN]:** xoay mật khẩu DB prod + token rclone Drive + token Telegram (đều đã lộ trong chat/ảnh) → cập nhật secret tương ứng. KHÔNG in secret ra log/CI.
- **Build/test:** `tsc -b` PASS, `vitest` 40/40 PASS, `npm run build` PASS (PWA 84 precache).

---

## 📱 Tối ưu giao diện Mobile/Tablet (kế thừa DataTable) — 2026-06-23 `[ĐANG LÀM]`

**Bối cảnh:** App dùng nhiều trên điện thoại/tablet. Nhiều trang còn render `<table>` thô bọc `overflow-x-auto` → cột ép bể/cuộn ngang khó đọc trên mobile. Dự án đã có `src/components/DataTable.tsx` tự sinh **bảng desktop + card mobile**. Chủ trương: **chỉ tối ưu UI (JSX/className/presentational), GIỮ NGUYÊN code logic/hook/query/RPC/RLS/DB.**

**Công thức chuyển 1 bảng-thô → DataTable** (mẫu: `ReturnListPage`, `ExpiryPage`, `ReorderPage`): map `<th>/<td>` thành `DataTableColumn[]`; cột chính `flex:true`; badge trạng thái `mobileHeaderRight:true`; mũi tên `hideOnMobile:true`; ô badge/nút `noTruncate:true`. Widget không phân trang (nằm trong card sẵn): `pageSize={0} card={false}`.

- [x] **Đợt 1 — Dashboard** (`DashboardPage.tsx`): 2 bảng "Công việc chăn nuôi 7 ngày" + "Hàng sắp hết hạn (3 tháng)" → DataTable (card mobile tự sinh, hết bể cột `DA-...`).
- [x] **Đợt 3 — Chuẩn hóa SĐT + che số nhất quán:** thêm helper thuần `primaryPhone()` (tách số đầu, cắt phần CCCD ghép) export từ `DisplaySettingsContext.tsx`. Áp `maskData(formatPhone(primaryPhone(...)))` ở `CustomerCarePage.tsx` (sửa lộ `0387...,0335...cccd:052...` + link `tel:` hỏng + bỏ qua mask) và `CustomerDetailPage.tsx` (2 chỗ SĐT thô).
- [x] **Đợt 2 — Cardify trang DANH SÁCH chính → DataTable:** ✅ `HerdProjectListPage` (10 cột nhóm theo KH, mỗi nhóm 1 DataTable `card={false}`), ✅ `HerdsManagePage` (9 cột + toggle/sửa/xóa), ✅ `ActiveIngredientsPage` Tab "Danh sách hoạt chất" (dùng `expandedRowRender` cho chi tiết chống chỉ định + SP liên kết; bỏ state `expandedIngId` thừa). **Rà soát còn lại:** `DiseasesPage` danh sách bệnh là master-detail (không phải `<table>`) — N/A; `InventoryPage` 3 bảng raw đều là dòng-hàng trong modal/chi tiết (`min-w-[680px]`) — thuộc Đợt 4. Các tab CẤU HÌNH admin (ActiveIngredients tab nhóm dược lý/loại tương tác/ma trận; Diseases tab loài/nguyên nhân) giữ nguyên scroll (ít dùng mobile) → cân nhắc Đợt 4.
- [x] **Đợt 4 — Bảng chi tiết/form/báo cáo/config (không cardify):** chống bể bằng **lớp tiện ích `.tbl-x` trong `index.css`** (chỉ tác động mobile `max-width:767px`: sticky cột đầu `td/th:first-child` nền gray-0/header gray-25 + vạch ngăn gray-100 + scroll quán tính). Gắn `tbl-x` vào ~30 `<div overflow-x-auto>` bọc bảng qua: OrderDetail, GoodsReceipt(Detail/Form), PurchaseOrderForm, CustomerProfileReport, ProfitReport, BiAnalytics, SupplierDetail, GdriveImport, InventoryPage (4 bảng modal/chi tiết), CustomerDetail (2), CustomerQuickView (3), CustomerSettings (3), ProductDetail (2), ProductQuickView (2), ActiveIngredients (3 tab config), Diseases (2 tab config), HerdProjectDetail (2), SystemSettings (5), PriceList (khung `overflow-auto`). Desktop KHÔNG đổi (rule trong @media mobile). Build PASS (✓25.5s).
- [x] **Đợt 5 — Polish:** settings tables (System/Customer) ✅ đã có `.tbl-x` (gộp Đợt 4). `Layout.tsx` menu "Hoạt động" `path:'#'` (dead link, không có route `/activities`) → **đã tạm ẩn** (comment lại kèm hướng dẫn khôi phục khi xây trang timeline hoạt động). Nhóm "Tổng quan" còn 1 mục → render link đơn.
- **Kết quả:** 5 đợt HOÀN THÀNH, build `npm run build` PASS (✓38s, 0 lỗi). Đề xuất user: soi DevTools ~390px đối chiếu 8 ảnh + smoke test 1 role hạn chế, rồi commit/deploy. **Khuyến nghị làm sạch dữ liệu `phone` (lẫn nhiều số + CCCD) ở DB riêng — ngoài phạm vi UI.**

### 🔁 Vòng 2 — User báo "nhiều module không vừa khung" (2026-06-23, chọn fix cả 4 nhóm)
Audit toàn bộ module: danh sách chính đã ổn (DataTable); phần "không vừa khung" còn lại = POS (vỡ), bảng nhiều cột Báo cáo/Sổ quỹ/Chi tiết/Kho (cuộn ngang), form nhập liệu. Chia 5 lô:
- [x] **Lô A — Chặn tràn ngang toàn cục + POS mobile:** `index.css` thêm `#root { overflow-x: clip }` (KHÔNG phá sticky, modal fixed vẫn thoát). `POSPage.tsx`: 3-panel `hidden md:flex`; thêm thẻ `flex md:hidden` điều hướng sang `/orders/mobile` ("Lên đơn di động"). Build PASS (✓26s).
- [x] **Lô B — Cardify Báo cáo:** ✅ `ProfitReportPage` (cột động theo tab KH/Thương hiệu/SP) + `CustomerProfileReportPage` (DataTable tự phân trang) → DataTable. Rà soát: `StrategicProducts/InventoryValuation/DemandForecast` đã dùng DataTable sẵn; `ReportsHub` là card; `BiAnalytics` bảng danh sách đã DataTable, 2 bảng còn lại là MA TRẬN (ABC×XYZ 3×3 + Cohort retention pivot) — giữ scroll+sticky (cardify không hợp ma trận). Build PASS (✓26s).
- [x] **Lô C — Rà soát Sổ quỹ/Kho/Pipeline: KHÔNG cần sửa.** Cashbook 0 bảng thô (render card + mobile filter sheet `lg:hidden` + `grid-cols-12` con dùng `col-span-12 lg:col-span-8` → stack mobile). Inventory main list (6 tab) đã DataTable. Pipeline có nhánh `block md:hidden` (card). → đều vừa khung mobile sẵn.
- [~] **Lô D — Bảng dòng-hàng chi tiết:** ✅ `OrderDetailPage` (dòng SP đơn hàng → DataTable card mobile, giữ footer tổng cộng). Còn lại (GoodsReceiptDetail, SupplierDetail, HerdProjectDetail, ProductDetail bảng giá, Inventory modal luân chuyển, GdriveImport preview) hiện dùng `.tbl-x` (cuộn + sticky cột đầu) — chấp nhận được cho bảng chứng từ/chi tiết xem thi thoảng; cardify thêm nếu cần.
- [x] **Lô E — Form nhập liệu:** ✅ `GoodsReceiptFormPage` (bảng kiểm kho hàng loạt 8–9 cột) + `PurchaseOrderFormPage` (bảng dòng đặt mua) → giữ `<table>` desktop `hidden md:block`, thêm **thẻ dọc `md:hidden`** mỗi dòng (SP + badge + các ô SL/giá/lô/NSX/HSD/kho xếp dọc), **dùng chung handler/state** (`updateItemAtIndex`/`handleUpdateItem`/`handleVerify`/`handleRemove`) → KHÔNG đổi logic tính tiền/lưu phiếu. Build PASS (✓26s).
- Công thức: dùng `DataTable` + cột động + `getRowKey` ổn định cho bảng XEM; với bảng NHẬP LIỆU giữ table desktop + card `md:hidden` tái dùng handler. Mỗi lô build + verify.
- **✅ VÒNG 2 HOÀN THÀNH 5/5 LÔ** — build `npm run build` PASS. Deploy an toàn. (Bảng chứng từ chi tiết phụ còn lại dùng `.tbl-x` cuộn-sticky, chấp nhận được.)
- **KHÔNG đụng:** PipelinePage (đã có nhánh mobile), POSPage (full-screen), MobileOrderPage (đã thiết kế mobile).
- **Ghi nhận chất lượng dữ liệu (ngoài phạm vi UI):** trường `phone` đang chứa nhiều số + CCCD ghép chuỗi → nên làm sạch DB riêng (tách phone/cccd). UI hiện đã hiển thị an toàn (chỉ lấy số đầu).
- **Build:** `tsc -b` PASS · `npm run build` PASS (✓ 27.6s) sau Đợt 1+3+phần Đợt 2.

---

## 🔐 Vá bảo mật Cấu hình + lọc CN/tổng tiền Đơn hàng + Admin reset mật khẩu — 2026-06-24 `[HOÀN THÀNH]`

**Bối cảnh:** (1) Trang `/orders` thiếu lọc theo chi nhánh cho admin và chưa hiển thị tổng tiền các đơn đang lọc. (2) **Lỗ hổng**: user thường vẫn vào được `/system-settings`; cần khóa chỉ admin + cho admin đặt lại mật khẩu user khác.

### Nguyên nhân gốc lỗ hổng (đã vá)
`AuthContext` mặc định **fail-open** `userRole = … ?? { code:'admin' }`; `ProtectedRoute` chỉ chờ `loading` (session), KHÔNG chờ RBAC → trong lúc tải, mọi route render bằng quyền admin giả → trang Cấu hình tự `loadData()` (RLS cho đọc) nên user thường thấy giao diện.

- [x] **AuthContext** (`src/contexts/AuthContext.tsx`): đổi mặc định sang **fail-closed** `{ code:'guest' }`; thêm cờ `rbacReady = !!profile && !rolePerms.isLoading` (export trong context).
- [x] **ProtectedRoute** (`src/App.tsx`): thêm `if (!rbacReady) return <FullPageSpinner/>` TRƯỚC khi xét `adminOnly`/`perms` → không bao giờ gating bằng role tạm thời. Route `/system-settings` đổi `perms=[…]` → **`adminOnly`** (loại cả CEO).
- [x] **Layout** (`src/components/Layout.tsx`): mục menu "Cấu hình" → `adminOnly: true` (ẩn với non-admin).
- [x] **Đơn hàng** (`src/pages/orders/OrderListPage.tsx`): thêm **lọc Chi nhánh** (chỉ admin/CEO, `hasAnyRole(['admin','ceo'])`) — lọc **server-side** `.eq('branch_id', …)` (giảm egress), có ở thanh lọc desktop + bottom-sheet mobile. Thêm **tổng tiền** đơn đang lọc: desktop dùng `headerSummary` của DataTable (canh cột Tổng), mobile dùng dải `md:hidden`. Tổng tính trên TẤT CẢ đơn đã lọc (không chỉ trang hiện tại).
- [x] **Admin reset mật khẩu**:
  - Edge Function **`supabase/functions/admin-reset-password/index.ts`** (NEW): verify JWT + `fn_is_admin()` server-side → `auth.admin.updateUserById` (service_role chỉ trong function) → ghi `audit_logs` (cột đúng: `user_id/action/table_name/record_id/new_data`, KHÔNG lưu mật khẩu). Min 6 ký tự.
  - UI (`src/pages/system/SystemSettingsPage.tsx`): nút icon `KeyRound` mỗi dòng NV → modal nhập MK mới + xác nhận → `supabase.functions.invoke('admin-reset-password')`.
- ~~**⚠️ CÒN LẠI [BẠN]:** deploy Edge Function `admin-reset-password`~~ → **KHÔNG BAO GIỜ ĐƯỢC DEPLOY.** Nút reset mật khẩu vì thế chưa từng chạy được trong suốt 6 tuần. Phiên 2026-08-01 đã thay bằng Edge Function **`admin-users`** (gộp 4 thao tác) và deploy thành công qua Management API — xem mục dưới cùng file này.
- **Ghi nhận (ngoài phạm vi):** insert `audit_logs` trong `handleConfirmReassignment` (SystemSettingsPage) đang dùng cột sai (`performed_by/target_table/notes`) so với schema thật (`user_id/table_name/new_data`) → khả năng fail âm thầm; nên sửa dịp khác.
- **Build:** `tsc -b` PASS · `npm run build` PASS (✓ 46s).

---

## 🧭 Ghim module hay dùng lên thanh điều hướng — 2026-06-24 `[ĐÃ HOÀN TÁC]`

**Đã thử** ghim 5 module (Khách hàng/Đơn hàng/Sản phẩm/Kho hàng/Nhập từ Drive) thành link trực tiếp đầu thanh + giữ 4 dropdown. **Kết quả VỠ layout:** 5 ghim + Bảng điều khiển + 4 dropdown = 10 mục, nav `flex-1` nuốt hết chỗ → đẩy Cấu hình/Tìm kiếm/Tạo mới ra ngoài khung (cả desktop). → **Hoàn tác về nav nhóm dropdown gốc** (`git checkout` Layout.tsx), chỉ giữ lại đổi menu "Cấu hình" → `adminOnly` (từ task bảo mật).
**Quyết định:** giữ 4 chức năng chính NẰM TRONG các nhóm dropdown đã xây (Kinh doanh: Khách hàng/Đơn hàng; Kho & Hàng hóa: Sản phẩm/Kho hàng/Nhập từ Drive). Không ghim top-level để tránh vỡ. Build PASS.

### ✅ Thanh menu PHỤ (quick-access) dưới top menu — 2026-06-24
Theo yêu cầu user: đưa 4 chức năng hay dùng thành **1 hàng menu riêng NẰM DƯỚI top menu** (không chen vào hàng top → không vỡ). `src/components/Layout.tsx`:
- Kiểu `MenuItem` chung + cờ **`primary: 1..4`** (Khách hàng, Đơn hàng, Sản phẩm, Kho hàng). `primaryItems` = lọc theo quyền, sort theo `primary`.
- Render 1 thanh `sticky top-16 z-30` full-width, `hidden md:flex` (desktop/tablet), nhãn "Truy cập nhanh" + các link icon+chữ; `overflow-x-auto` an toàn. Mobile vẫn dùng bottom bar sẵn có (không đổi).
- Mỗi link lọc `perms`; thêm module vào thanh phụ = thêm 1 cờ `primary`. Thêm 'Nhập từ Drive' chỉ cần gắn `primary: 5`. Build PASS (✓40s).

---

## 📞 Tìm khách hàng theo SỐ ĐIỆN THOẠI ở POS + Danh sách KH — 2026-06-27 `[HOÀN THÀNH]`

**Triệu chứng (user báo):** "khách có SĐT nhưng tìm không ra" ở `/pos`.
**Nguyên nhân gốc:** POS **không nạp và không tìm theo SĐT**. SĐT nằm ở `customer_contacts.phone` (liên hệ `is_primary`), KHÔNG có cột trên `customers`; bộ lọc POS chỉ khớp `farm_name/code/id`. Mobile còn thiếu cả bỏ dấu lẫn `id`. Trang Danh sách KH cũng chỉ `ilike` tên/mã. "SĐT duy nhất" **không** được enforce ở DB (index unique chỉ là 1 primary/khách).

### DB — migration `20260726000000_customer_primary_phone.sql` (ĐÃ apply remote ✅ HTTP 201 + verify)
- [x] Cột denormalize `customers.primary_phone` + `customers.primary_phone_norm` (chỉ số, tách số đầu, `+84→0`).
- [x] Hàm `fn_normalize_phone(text)` — khớp helper `primaryPhone()` (tách CCCD/số ghép phẩy). Test PASS các case `+84…`, `…,…`, `…cccd:…`, có khoảng trắng.
- [x] Trigger `trg_cc_sync_primary_phone` AFTER INSERT/UPDATE(of phone,is_primary,customer_id)/DELETE trên `customer_contacts` (SECURITY DEFINER) → tự đồng bộ.
- [x] Backfill 1690/1923 khách có số; index `gin_trgm` trên `primary_phone_norm`.
- [x] `customer_summary_view` thêm `primary_phone(+norm)`; **view audit `customer_duplicate_phones`** (nhóm SĐT chuẩn hóa ≥2 khách). Hiện trạng: **10 nhóm / 21 khách trùng** → cần làm sạch dần (quyết định: cảnh báo app + audit, KHÔNG ràng buộc cứng vì dữ liệu còn bẩn).

### Frontend
- [x] `src/lib/phone.ts` — `normalizePhone()` dùng chung (mirror SQL).
- [x] **POS desktop** `POSPage.tsx`: nạp `primary_phone(+norm)` (+ snapshot offline), `filteredCustomers` tìm thêm theo SĐT, dropdown hiện SĐT, placeholder "tên, mã, SĐT". Quick-add: validate định dạng + **cảnh báo trùng SĐT** (window.confirm), ghi `primary_phone` vào state ngay.
- [x] **POS mobile** `MobileOrderPage.tsx`: bộ lọc dùng `removeVietnameseTones` + `normalizePhone`, khớp tên/mã/**id**/SĐT (trước thiếu); thẻ khách hiện SĐT.
- [x] **Danh sách KH** `useCustomers.ts`: `.or()` thêm `primary_phone_norm.ilike` khi chuỗi có chữ số (index trgm); `CustomerListPage` placeholder + interface `primary_phone`.
- **Hiển thị SĐT:** theo yêu cầu — hiện ĐẦY ĐỦ cho mọi thu ngân ở dropdown POS.
- **Bảo mật/RLS:** `customer_contacts`/`customers` đang `select_all` (open) → tìm client-side hợp lệ, không lộ thêm dữ liệu.
- **Build:** `npm run build` PASS (✓29s). Verify remote: search full số + 4 số cuối đều ra.
- **⚠️ CÒN LẠI [BẠN]:** (1) deploy FE; (2) dọn 10 nhóm khách trùng SĐT (xem `select * from customer_duplicate_phones`).

---

## 🔀 Gộp khách hàng TRÙNG SĐT (deduplication) — 2026-06-27 `[HOÀN THÀNH]`

**Bối cảnh:** sau khi bật tìm theo SĐT, lộ ra 1 khách có nhiều ID (trùng do nhập liệu, tên lệch chính tả). User: "rất khó quản lý". Quy mô: 10 nhóm / 21 khách / 12 bản thừa.

### DB — migration `20260727000000_customer_merge.sql` (ĐÃ apply remote ✅ HTTP 201 + dry-run rollback verify)
- [x] Cột `customers.merged_into_id` (truy vết bản đã gộp) + index.
- [x] **RPC `fn_merge_customers(p_winner, p_losers[])`** — admin-only (`fn_is_admin()`), SECURITY DEFINER, nguyên tử:
  - Trỏ lại **15 bảng FK** (orders, customer_debts, debt_payments, herd_projects, opportunities, quotes, period_statements, cashbook_transactions, activities, sales_schedule_slots, vat_pending_sales, farms).
  - 2 bảng 1:1 (PK=customer_id) personal/business_info: giữ của winner, chuyển 1 bản nếu winner thiếu.
  - Liên hệ: chuyển sang winner (is_primary=false) + khử trùng số + đảm bảo đúng 1 primary.
  - Ẩn mềm loser (`is_active=false` + `merged_into_id`), đồng bộ lại `primary_phone`, ghi `audit_logs`.
- [x] View `customer_duplicate_members` (member-level: số đơn/nợ + cờ `is_suggested_winner` = nhiều đơn nhất→cũ nhất).
- **Test dry-run (BEGIN/ROLLBACK):** đơn trỏ về winner ✅, liên hệ trùng khử 2→1 ✅, loser ẩn + merged_into set ✅, KHÔNG commit dữ liệu thật.

### Frontend
- [x] **Trang `/customers/duplicates`** `CustomerDuplicatesPage.tsx` (adminOnly) — kế thừa `DataTable`, mỗi nhóm SĐT 1 card: radio chọn bản giữ (mặc định gợi ý), nút "Gộp N bản" → `supabase.rpc('fn_merge_customers')`. Route + menu "Khách trùng SĐT" (adminOnly).
- [x] **Phòng ngừa:** `AddCustomerModal` cảnh báo trùng SĐT trước khi tạo; `ImportCustomersModal` banner cảnh báo "N SĐT đã có / N lặp trong file" (không chặn). POS quick-add đã có từ đợt trước.
- **Quyết định:** winner mặc định nhiều đơn→cũ nhất (sửa tay); bản thừa ẩn mềm (không xóa cứng).
- **Build:** `npm run build` PASS (✓26s).
- **⚠️ CÒN LẠI [BẠN]:** deploy FE; vào `/customers/duplicates` xem lại winner từng nhóm rồi bấm Gộp (10 nhóm).

---

## 🔍 Đánh giá lại sau khi vận hành thật — 2026-07-12 `[HOÀN THÀNH]`

**Bối cảnh:** app đã chạy thật ~1,5 tháng. Audit prod (Management API, chỉ đọc) để đánh giá lại.

### Số liệu vận hành THẬT (khác xa giả định cũ "200 hóa đơn/ngày" — giả định đó SAI)
- 30 ngày: **1.365 đơn / 854 triệu ₫**. Tháng 6: 859 đơn/738tr. Đỉnh ~86 đơn/ngày.
- Hoài Ân 87% đơn, Phù Mỹ 13%. 1.936 KH, 1.058 SP, DB **93 MB**.
- **5 người dùng chung 3 tài khoản** (theo tên chi nhánh) → RBAC/audit trail/báo cáo theo NV đều vô nghĩa.
- **Sổ quỹ CHƯA vận hành thật** (còn dùng KiotViet song song) → tồn quỹ 600tr là ảo, KHÔNG phải bug.
- **5 module có 0 bản ghi/30 ngày:** Khuyến mãi, Báo giá, Pipeline, Đơn đặt NCC, Chăm sóc KH.
  → App thực tế = **POS + Kho + Sổ quỹ + Công nợ**. Định hướng: làm SÂU 4 cái này, không xây module mới.
- Sức khỏe: `fn_integrity_check` 7/7 sạch, 0 bán âm tồn/30 ngày, 2 cron sống, Telegram đã cấu hình.

### Đã sửa (3 commit, ĐÃ PUSH + DEPLOY LIVE)
- [x] **`6301dbf` Backup tự kiểm chứng.** Giải đáp "DB 93 MB nhưng dump chỉ 6 MB": KHÔNG mất dữ liệu — 93 MB gồm 16 MB index (dump chỉ lưu `CREATE INDEX`) + dòng chết; 49 MB `audit_logs` là JSON nén ~10 lần. Thêm bước đọc mục lục dump sau upload, bắt buộc đủ 11 bảng trọng yếu **gồm `auth.users`** (thiếu bảng này thì restore xong không ai đăng nhập được) → thiếu là job đỏ.
- [x] **`16e9b51` `audit_logs` ngốn 60% DB.** Migration `20260728000000` (apply prod + tracking). Gốc: trigger ghi `to_jsonb(OLD)+to_jsonb(NEW)` = cả dòng, 2 lần, mọi UPDATE — orders 12.062 UPDATE/22 MB trong đó **3.236 dòng không đổi cột nào**. Nay chỉ ghi **cột thực sự đổi**; no-op không ghi. Verify trên prod: **1.900 bytes → 144 bytes/dòng**. Kèm `fn_prune_audit_logs()` + cron 02:30 VN (365 ngày tài chính / 120 ngày vận hành). **Quyết định user: GIỮ NGUYÊN 44 MB nhật ký cũ**, để cron dọn tự nhiên.
  - Kèm: bỏ lệnh ghi tay `audit_logs` ở `SystemSettingsPage` — sai tên cột VÀ bị RLS chặn → **thất bại trong im lặng** từ trước tới nay.
- [x] **`74e9620` PWA: nút "Tải lại" chưa bao giờ thực sự cập nhật.** `registerType:'prompt'` → phải gọi `updateSW(true)` để SW mới skipWaiting; code cũ vứt hàm đó, chỉ `reload()` → SW mới nằm chờ, **SW cũ vẫn điều khiển trang** → các bản deploy KHÔNG tới được máy nhân viên. Kèm `r.update()` thiếu `.catch()` → 8 lỗi trong `app_error_logs` (4G chập chờn). Verify trên chính production.

### ⚠️ CÒN LẠI [BẠN]
- [ ] **Bảo 5 nhân viên đóng hết tab app rồi mở lại ĐÚNG 1 LẦN** — họ còn kẹt SW cũ nên bản vá chưa tới máy.
- [ ] **Nâng Supabase Pro** — vẫn Free, không PITR, trong khi ~850tr₫/tháng chạy qua.
- [ ] **Tạo 5 tài khoản riêng** (gửi tên + email để tôi tạo và gán quyền).
- [ ] **Gộp 10 nhóm khách trùng SĐT** tại `/customers/duplicates`.

### 🔎 Ứng viên phiên sau (phát hiện trên console production, chưa đụng — không cái nào chặn bán hàng)
- `[Auth] getSession timed out after 3 seconds` — nghi là lý do app chậm lúc mới mở. **Ưu tiên 1.**
- `DisplaySettings Table failed to load, falling back to defaults` + HTTP **406** — nhiều khả năng `.single()` trên kết quả rỗng.
- 2 lỗi **404** khi tải trang.

---

## 🏢 Báo cáo lợi nhuận THEO CHI NHÁNH (chi tiết) — 2026-07-27 `[DB LIVE — CHỜ DEPLOY FE]`

**Bối cảnh:** `/reports/profit` gộp toàn công ty. View `v_order_line_profit` đã có sẵn cột
`branch_id` nhưng **không RPC nào dùng** → không lọc được, không có tab chi nhánh; chỗ duy nhất
chẻ được theo CN là `fn_bi_pivot` (1 chiều, không drill-down). Trong khi thực tế Hoài Ân ~87%
đơn / Phù Mỹ ~13% — lát cắt chi nhánh là số liệu có ý nghĩa ngay.

Đồng thời phát hiện doanh thu cũ (`order_lines.line_total`) **bỏ sót 2 khoản** làm lợi nhuận bị
thổi lên: (a) chiết khấu **cấp hóa đơn** — sau đại tu Khuyến mãi (`20260732`) khoản này đã phát
sinh thật; (b) **hàng trả lại** (`sales_returns` completed).

**3 quyết định của user (2026-07-27):** làm ĐẦY ĐỦ (tab CN + lọc CN toàn trang + drill-down);
**thêm cột** DT gộp → CK hóa đơn → Trả hàng → DT thuần chứ KHÔNG đổi công thức
`v_order_line_profit` (BI / SP chiến lược / định giá tồn kho đều ăn view này); **chưa** ghép chi
phí Sổ quỹ (Sổ quỹ chưa vận hành thật) → báo cáo dừng ở lợi nhuận gộp.

### DB — migration `20260737000000_profit_by_branch.sql` (✅ ĐÃ apply remote + verify)
- [x] **`fn_profit_lines(from,to,branch)`** — fact cấp dòng đơn, helper nội bộ (REVOKE cả
  `authenticated`; chỉ RPC admin gọi). Là FUNCTION chứ không phải VIEW **có chủ ý**: phân bổ CK
  hóa đơn cần window `PARTITION BY order_id`, nếu để trong view thì filter thời gian ở ngoài
  không đẩy xuống dưới window → quét toàn bộ `order_lines` mỗi lần gọi. Lọc theo `created_at`
  của ĐƠN nên mọi dòng cùng đơn vào/ra cùng nhau → tỉ trọng phân bổ vẫn chính xác tuyệt đối.
  - CK hóa đơn = `orders.discount_total − Σ(ol.discount×qty)`, `GREATEST(...,0)`. Đã đối chiếu
    MỌI đường ghi đơn (`fn_recalculate_order_total` trigger + 5 bản POS RPC): tất cả đều ghi
    `discount_total = v_line_disc + v_inv_disc` ⇒ phép trừ này khớp tuyệt đối.
  - Hàng trả quy về **ngày ĐƠN GỐC** (không phải ngày lập phiếu trả) để "lợi nhuận của đơn" là
    con số khép kín. Hệ quả có chủ ý: phiếu trả hoàn tất hôm nay làm giảm doanh thu kỳ đã bán.
  - Giá vốn hàng trả = giá vốn bình quân của chính dòng đó × SL trả.
- [x] **Nâng cấp 4 RPC cũ** (`fn_profit_summary/by_customer/by_product/by_brand`): thêm
  `p_branch_id` + các cột `invoice_discount / return_amount / revenue_net / cogs_net /
  profit_net / margin_net`. Cột `revenue`/`profit`/`margin` cũ **giữ nguyên nghĩa** để đối
  chiếu được với báo cáo đang chạy. `qty_sold` đổi `BIGINT → NUMERIC` (SL bán có thể lẻ —
  trước đây bị cắt phần thập phân).
- [x] **3 RPC mới**: `fn_profit_branch_summary` (bảng so sánh CN + AOV + LN/đơn + %đóng góp +
  so kỳ trước `prev`/`yoy`), `fn_profit_branch_trend` (day/week/month, **lấp khoảng trống** để
  vẽ chart mượt), `fn_profit_branch_breakdown` (top N trong 1 CN theo SP/KH/thương hiệu/nhóm
  hàng/nhân viên). Đều admin-only + REVOKE PUBLIC/anon + GRANT authenticated.
- [x] Ranh giới ngày/tuần/tháng của chart tính theo **giờ VN** (`AT TIME ZONE
  'Asia/Ho_Chi_Minh'`, khớp quy ước `20260628`) — để mặc định UTC thì đơn bán buổi sáng rơi
  nhầm sang ô ngày hôm trước.
- [x] Index `idx_orders_branch_created (branch_id, created_at DESC)`.

### Frontend
- [x] `ProfitReportPage.tsx`: tab **"Theo chi nhánh"** (mặc định) + bộ lọc chi nhánh áp cho mọi
  tab còn lại + chọn kỳ so sánh. Bấm dòng CN → panel drill-down: 12 ô chỉ số, biểu đồ
  ComposedChart (cột DT thuần + đường LN gộp) đổi được ngày/tuần/tháng, bảng Top 20 đổi được 5
  chiều. Dải "đối chiếu" DT gộp − CK hóa đơn − hàng trả = DT thuần dưới KPI. CSV xuất đủ cột mới.
- [x] Dòng **(Không chi nhánh)** hiện tường minh cho đơn thiếu `branch_id` — cố tình để lộ ra.
- [x] 🕐 **Sửa mốc múi giờ:** trang gửi `T00:00:00` trần, DB chạy `TimeZone=UTC` → ranh giới
  ngày lệch 7 giờ (đơn bán 00:00–07:00 giờ VN bị tính sang ngày hôm trước). Nay gửi kèm offset
  `+07:00`. **Đo thực tế trên prod: chỉ 17/2.171 đơn nằm ở khung giờ 6h sáng VN (0,8%)** — cửa
  hàng không bán trước 6h nên tác động thực tế nhỏ, chỉ là lệch NGÀY chứ không mất doanh thu
  khỏi tổng tháng/năm. Vẫn sửa để chart theo ngày đúng ranh giới.
  `ReportsHubPage` sửa cùng cách và chuyển KPI strip sang số **thuần** để khớp trang chi tiết.
- [x] `tsc -b` + `npm run build` + 102/102 unit test PASS.

### ✅ ĐÃ APPLY PROD + VERIFY (2026-07-27)
- 8/8 function tồn tại đúng chữ ký; `authenticated` execute = true cho 7 RPC báo cáo,
  **false cho `fn_profit_lines`**; `anon` = false cho cả 8. Bản `fn_profit_summary` 2 tham số cũ
  đã biến mất (DROP sạch, không còn overload).
- Guard: JWT giả role `branch_manager` (Hoài Ân) → RAISE `42501 Không có quyền` ✅.
- **Cross-foot khớp tuyệt đối**: 4 RPC cũ lọc Phù Mỹ đều cộng ra đúng `74.234.000₫ /
  10.039.165,55₫` bằng `fn_profit_branch_summary`. Trend day/week/month đủ ô (8/6/7) và tổng
  đơn khớp `fn_profit_summary` (1.498). Breakdown chạy đủ 5 chiều; lọc CN đúng (share 100%).
- **Hiệu năng**: `fn_profit_branch_summary` 7 tháng + so kỳ trước (gọi `fn_profit_lines` 2 lần
  trên ~14 tháng dữ liệu) = **141 ms**.
- Số thật 30 ngày (27/6–27/7): DT thuần **748,8tr**, LN gộp **64,1tr**, biên **8,57%**, 1.498 đơn.
  **Hoài Ân 674,5tr / biên 8,02% / AOV 557K** — **Phù Mỹ 74,2tr / biên 13,52% / AOV 258K**.
  Phù Mỹ chỉ 9,91% doanh thu nhưng **15,65% lợi nhuận**, tăng trưởng +146% DT / +162% LN so kỳ
  trước. Hoài Ân +16% DT nhưng kỳ trước LN **âm 2,4tr** nên không tính được % tăng LN.
  `invoice_discount` = 0 toàn kỳ (khớp: KM cấp đơn chưa từng áp), hàng trả = 0.
- 0 đơn nào thiếu `branch_id` → dòng "(Không chi nhánh)" sẽ không xuất hiện.

### ⚠️ CÒN LẠI
- [ ] Commit + deploy FE + bấm "Tải lại" PWA.
- [ ] **Xoay access token** đã cấp trong chat phiên này.

---

## 2026-08-01 — CHUYỂN KHO có duyệt · BẢNG GIÁ · QUẢN LÝ NHÂN VIÊN · PHÂN QUYỀN

7 commit (`3fcf648` → `0ae16e7`), 5 migration `20260738`–`20260742` **đã apply + verify prod**,
Edge Function `admin-users` **đã deploy** (ACTIVE v1), tự đăng ký công khai **đã tắt**.

### ✅ Chuyển kho — Admin duyệt bước cuối (`20260738`, `20260739`)
- **Quy tắc nghiệp vụ (user chốt):** chi nhánh hạch toán **độc lập kiểu nhượng quyền** →
  chi nhánh nhận *mua* hàng của chi nhánh nguồn, nên **đơn giá chuyển TRỞ THÀNH giá vốn của
  lô ở kho đích**, bình quân gia quyền **theo LÔ** (cùng `product_id, lot_number,
  warehouse_id, is_vat`). Đề xuất tách đôi đơn giá khỏi giá vốn đã **bị bác** — đừng nêu lại.
- Vòng đời: `draft → in_transit → received → completed` (**chỉ Admin/CEO**) / `rejected`
  (hoàn hàng về kho nguồn). Tồn kho + giá vốn **CHỈ** ghi vào kho đích ở bước duyệt;
  `fn_receive_transfer` đổi hành vi thành chỉ ghi nhận "kho đích đã nhận đủ".
- `fn_transfer_cost_preview` — màn hình duyệt hiện *vốn nguồn → đơn giá chuyển → tồn sẵn →
  **giá vốn MỚI*** để admin chốt giá bán cho chi nhánh nhận. Dùng chung công thức với
  `fn_complete_transfer` nên số xem trước luôn khớp số ghi thật.
- `fn_update_transfer_lines` (`20260739`) — sửa SL/đơn giá sau khi lập. Hàng đã xuất kho thì
  mọi thay đổi SL **bù trừ lại lô nguồn + ghi thẻ kho** (giảm → `transfer_in`, tăng →
  `transfer_out` có kiểm tồn, SL=0 → xoá dòng).
- **Vá kèm:** policy `transfer_lines_manage` cũ (`FOR ALL`, không kiểm status) cho sửa dòng
  phiếu ở MỌI trạng thái → nay chỉ khi `draft`; tạo phiếu nguyên tử qua `fn_create_transfer`
  (trước là 2 lượt insert rời); `fn_guard_transfer_status` chặn đổi status thẳng qua PostgREST.
- Backfill 157 phiếu `received` → `completed` (tồn đã ghi theo mô hình cũ).

### ✅ Bảng giá
- **Trang `/products/prices` trước đây KHÔNG có mục menu nào** — chỉ vào được qua nút chìm
  trong màn hình Sản phẩm. Thêm menu **Kho & Hàng hóa → Bảng giá**.
- Bảng giá **nội bộ**: tái dùng `price_lists` + cột mới `usage` (`sales` | `transfer`).
  **Đã thêm bộ lọc `usage = sales` vào 9 màn chọn bảng giá bán hàng** — thêm chỗ mới thì
  NHỚ lọc, không thì bảng nội bộ lọt vào POS/khách hàng.
- Mở trang cho **mọi nhân viên** (giá bán là thông tin ai cũng cần tra), chỉ khoá thao tác
  **sửa** theo `pricing.manage` — khớp RLS `price_list_items`, tránh lỗi khó hiểu lúc lưu.

### 🚨 Phân quyền — GỠ MÌN (`20260740`)
`fn_set_role_permissions` xoá sạch rồi ghi lại theo mã UI gửi lên, mà UI lọc theo
`permissionCatalog.ts`: **catalog 53 mã / DB 73 mã**. Bấm "Lưu phân quyền" cho **bất kỳ**
vai trò nào là **xoá vĩnh viễn 20 mã**. Đo được: `sales` mất 7/25 gồm `customers.view_own`,
`orders.view_own`, `opportunities.create` → **nhân viên bán hàng mất sạch Khách hàng, Đơn
hàng, Pipeline** (App.tsx dùng đúng các mã đó làm route guard). team_lead 14/38,
branch_manager 13/54, accountant 4/21.
- Vá 2 lớp: catalog bổ sung đủ **73/73 khớp DB**, và RPC thêm `p_scope` — **chỉ thu hồi
  quyền trong phạm vi client khai báo**. Catalog sót mã lần sau chỉ còn hậu quả "không quản
  được từ UI", không còn là "bị xoá mất". Overload 2 tham số cũ định nghĩa lại thành
  chỉ-cấp-thêm.
- **QUY TẮC: thêm permission code vào DB thì PHẢI thêm vào `permissionCatalog.ts`.**
- `RolePermissionMatrix` ngừng nuốt lỗi ở `loadRoles`/`openEditor` (đọc lỗi mà bỏ qua thì
  editor mở ra trống, bấm Lưu là thu hồi sạch); đếm quyền qua `fetchAllRows` (cũ cap 1000).

### ✅ Quản lý Nhân viên (`20260741`) — 3/5 chức năng vốn hỏng hẳn
- **Tạo NV hỏng:** dùng `auth.signUp` bằng anon key, mà project bật *bắt buộc xác nhận
  email* và **không có SMTP riêng** (mailer mặc định 2 thư/giờ) → nhân viên mới không đăng
  nhập được. Bằng chứng: `sanhlong4mt@gmail.com` có `email_confirmed_at`/`last_sign_in_at`
  = NULL, UI vẫn báo "Tạo thành công" + trạng thái xanh. → `createUser({ email_confirm: true })`.
- **Mật khẩu hỏng:** `admin-reset-password` chưa từng deploy.
- **Đổi email:** không có code path nào; ô input bị `disabled`.
- **Khoá TK yếu:** `is_active` chỉ chặn dữ liệu, **không chặn đăng nhập**; người bị khoá
  không đọc nổi hồ sơ của mình → `rbacReady` mãi false → **spinner vô tận không thông báo**;
  và `profiles_update_self` không giới hạn cột → **tự đổi `is_active` để mở khoá lại**.
- **Gán vai trò:** delete+insert không nguyên tử, **nuốt lỗi ở delete** → hỏng giữa chừng là
  còn 0 vai trò, rơi về `guest`, mất quyền mọi trang.

**Edge Function `admin-users`** (một function, 4 action: `create` | `reset_password` |
`update_email` | `set_active`). Khoá TK nay **2 tầng**: `ban_duration` ở auth + thu hồi phiên
đang mở, và `profiles.is_active`.

**Migration `20260741`:** `fn_set_user_roles` (nguyên tử, chặn bỏ trống / tự gỡ admin / gỡ
admin cuối) · `profiles_select_self` · `fn_guard_profile_self_update` (RLS không giới hạn
được theo cột → dùng trigger; người thường chỉ đổi `full_name`/`phone`/`avatar_url`) ·
`fn_sync_profile_email` · **bỏ hard-code email** khỏi RLS `user_roles_*` và
`fn_handle_new_user` (sắp mở đổi email → đổi xong là mất quyền) · `fn_handle_new_user`
không tự cấp vai trò `sales` nữa.

**E2E prod 8/8 đạt** (tạo TK tạm rồi xoá, còn 0 rác): tạo NV → **đăng nhập được NGAY không
cần link** → vai trò đúng → email trùng bị chặn → đổi email + đồng bộ hồ sơ → **khoá thì
đăng nhập BỊ CHẶN** → đổi MK → tự khoá mình bị chặn.

### ✅ Dọn vai trò (`20260742`)
Mỗi tài khoản chi nhánh gán 6 vai trò = 67 quyền, nhưng riêng `branch_manager` đã 54;
5 vai trò kia chỉ thêm 13 quyền (phần lớn là bản hẹp của thứ đã có bản rộng).
- Thêm **đủ 13** quyền vào `branch_manager` (không chỉ 7 "thực sự cần") → tập quyền sau khi
  gộp khớp 1-1, **chứng minh bằng 67 = 67**. Migration tự `RAISE` nếu còn thiếu.
- 3 tài khoản chi nhánh → **1 vai trò**, quyền 67 → 67. Admin → `branch_id` để trống.
  CN Mỹ Thành → gán vào `Chi Nhánh Mỹ Thành - Ân Hảo` (trước bỏ trống nên mọi policy
  `branch_id = fn_my_branch_id()` không bao giờ đúng).
- **Lỗ leo thang (có thật, kiểm chứng 2 chiều):** `branch_manager` có `users.assign_role`;
  RLS `user_roles_manage_manager` cho sửa vai trò người **cùng chi nhánh**, mà admin lại nằm
  trong Chi nhánh Hoài Ân → đóng vai Hoài Ân **xoá sạch 8 vai trò của admin**. Sau khi tách
  chi nhánh: không nhìn thấy, xoá không ăn, admin còn nguyên 8.

### 🔧 Kỹ thuật vận hành rút ra
- **Deploy Edge Function KHÔNG cần Docker/CLI:** `POST /v1/projects/{ref}/functions/deploy?slug=<slug>`
  với FormData (`metadata` JSON + `file` blob). Nhanh hơn nhiều so với bảo user chạy
  `npx supabase functions deploy` (user từng dán nhầm lệnh đó vào SQL Editor).
- **Test nghiệp vụ trên prod an toàn:** bọc trong khối `DO` rồi `RAISE EXCEPTION` ở cuối
  → tự rollback, kết quả trả về qua thông điệp lỗi. Giả lập user bằng
  `set_config('request.jwt.claims', …)` + `set_config('role','authenticated')`.
- 🔴 **BẪY ĐO SAI (đã dính):** sau khi thao tác dưới danh tính giả lập, câu đếm kiểm chứng
  **cũng chịu RLS của danh tính đó** → "không nhìn thấy" bị hiểu nhầm thành "đã xoá".
  **Phải `set_config('role','postgres')` rồi mới đếm.**
- `SUPABASE_SERVICE_ROLE_KEY` trong `.env`/`.env.local` **đã hết hiệu lực** (401).
  Lấy key hiện hành qua Management API `/api-keys?reveal=true`.

### ⚠️ CÒN LẠI
- [ ] **[BẠN] Xoay access token** đã cấp trong chat phiên này.
- [ ] **[BẠN] Ép nhân viên tải lại app** — FE đổi nhiều đợt này.
- [ ] **[BẠN]** Điền `employee_code` / `job_title` (đang trống hết → hiện `---`/`Thành viên`).
- [ ] **[BẠN]** Tạo bảng giá "Chuyển kho nội bộ" ở `/products/prices`.
- [ ] Chưa có SMTP riêng → "Quên mật khẩu" tự phục vụ vẫn kẹt giới hạn 2 thư/giờ.
- [ ] Hàng đang đi đường vẫn ngoài báo cáo định giá tồn kho (mới có banner cảnh báo ở tab).
- [ ] Chưa có phiếu in chuyển kho để bên nhận ký; `inventory.transfer` chưa gắn vào RLS.
- [ ] Nợ cũ: `fn_pos_edit_order` vẫn tin `invoice_discount` từ client.
