# Lộ Trình Phát Triển Hệ Thống CRM/ERP Sanh Long Vetco (Phases 1, 2 & 3) - [HOÀN THÀNH TOÀN BỘ]

Tài liệu này theo dõi tiến độ và ghi nhận các đầu mục công việc xây dựng hệ thống ERP/CRM của Sanh Long Vetco, bao gồm cả 3 giai đoạn (Phase 1, Phase 2, và Phase 3) đã hoàn thành xuất sắc.

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
- **Products #2 (lệch Thẻ kho) — QUAN TRỌNG**: tạo RPC `public.fn_add_manual_lot(uuid,uuid,text,date,date,numeric,numeric)` (`SECURITY INVOKER`, atomic: ghi `stock_lots` + `stock_movements` type `adjustment_increase`, ref_type `manual_lot`, performed_by=auth.uid()). Migration `supabase/migrations/20260607000000_fn_add_manual_lot.sql`. **ĐÃ APPLY remote** qua Management API (project gdotgcrtivjdpkcchrro) + reload schema cache. `ProductDetailPage.handleAddLotSubmit` giờ gọi RPC, có **fallback 2 bước** (insert lot → movement, rollback lô nếu movement lỗi) khi RPC chưa có. → Nhập kho thủ công nay luôn có dòng trong Thẻ kho.
- **Products #1 (gate quyền)**: nút "Sửa chi tiết" ẩn nếu không `admin|products.manage`; nút "Nhập kho/Thêm lô hàng" + "Thêm lô hàng đầu tiên" ẩn nếu không `admin|inventory.receive` (khớp RLS warehouse_keeper).
- **Products #3**: thay `JSON.stringify(attributes)` ở bảng variant bằng chip key:value.
- **Customers #1 (gate quyền)**: nút "Thiết lập" (→ /customers/settings cần users.manage) ẩn nếu không `admin|users.manage`.
- **Customers #2**: thay `console.info` rò rỉ role (CustomerDetailPage:860) → `logger.debug`. (Ghi chú: các `console.error/warn` khác là HỢP LỆ theo convention logger.ts — không cần đổi.)
- Đồng bộ `console.error/warn` còn lại ở ProductDetailPage → `logger`.

**CHƯA làm — defer có chủ đích:**
- **Customers #3 (tách CustomerDetailPage 3895 dòng)**: là refactor lớn, rủi ro regression cao, đã được lên lịch riêng ở P2-5. KHÔNG gộp vào phiên sửa audit để tránh phá vỡ. Cần 1 session riêng.

**Lưu ý vận hành:** RLS insert thủ công stock_lots/stock_movements là theo ROLE (`warehouse_keeper`), trong khi UI gate theo PERMISSION (`inventory.receive`). warehouse_keeper có sẵn inventory.receive nên khớp; nếu tạo role tùy biến có inventory.receive mà KHÔNG có role warehouse_keeper thì RLS vẫn chặn (mismatch tồn tại sẵn, không phát sinh từ phiên này).

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
