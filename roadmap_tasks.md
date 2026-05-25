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

---

### 2. Phân Hệ Khách Hàng (Customer Module) - `[HOÀN THÀNH]`
- [x] Xây dựng trang Danh sách khách hàng hỗ trợ tìm kiếm nhanh, lọc theo phân loại (hộ chăn nuôi, trang trại, đại lý...).
- [x] Thiết kế form Thêm mới / Cập nhật thông tin khách hàng (mã định danh tự động `KH-2026-xxxxx`).
- [x] Tích hợp quản lý **Nhóm giá áp dụng** (Price Lists) và **Hạn mức công nợ** (Credit Limit) bắt buộc.
- [x] Gán nhân viên phụ trách chính (primary sales) và chuyển đổi Khách hàng thành tài nguyên chung hiển thị cho tất cả chi nhánh và nhân viên (mở chính sách SELECT RLS cho `customers` và các thực thể phụ thuộc: liên hệ, trang trại, đàn vật nuôi, lịch sử bệnh). Các cấu trúc giao dịch trả hàng (`sales_returns`) và hóa đơn (`invoices`) vẫn tuân thủ logic phân quyền hạn chi nhánh/nhân viên.
- [x] **Sổ chi tiết giao dịch (Customer Transaction Ledger)**: Bổ sung tab Sổ chi tiết giao dịch trong màn hình Chi tiết khách hàng, cho dõi chi tiết các giao dịch mua hàng (Hóa đơn), thanh toán (Tiền mặt/Chuyển khoản), trả hàng, và điều chỉnh công nợ theo trình tự thời gian với tính năng tính Dư nợ cuối (running balance) tự động sau mỗi giao dịch.

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

---

### 6. Phân Hệ Sổ Quỹ & Duyệt Chi (Cashbook & Disbursements) - `[HOÀN THÀNH]`
- [x] Quản lý Danh sách Phiếu thu / Phiếu chi tiền mặt và tiền gửi ngân hàng.
- [x] Quy trình kế toán lập phiếu chi đề xuất -> Admin/CEO phê duyệt phiếu chi trực tiếp trên hệ thống (đặc biệt các khoản chi > 10M).
- [x] Tự động cộng/trừ số dư các quỹ tài khoản ngay khi giao dịch được phê duyệt thành công qua triggers.
- [x] Quản lý phiên quỹ / ca làm việc của thủ quỹ (mở ca, đóng ca kèm đối soát, tính toán chênh lệch và bắt buộc nhập lý do chênh lệch).
- [x] Chức năng chuyển tiền nội bộ tự động tạo hai bút toán đối ứng cân bằng.


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

### 9. Phân Hệ Dự Án Chăn Nuôi (Herd Projects Module) - `[HOÀN THÀNH]`
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
