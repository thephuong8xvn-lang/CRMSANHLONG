# Rules — CRM/ERP Sanh Long Vetco (Phiên bản đã chốt)

> Đây là quy tắc làm việc bắt buộc cho mọi người tham gia dự án — bao gồm cả AI agent (Antigravity Cascade / Windsurf).
> Đọc kèm 2 file đặc tả: `docs/01-FUNCTIONAL-SPEC.md` và `docs/02-LAYOUT-SPEC.md`. Khi quy tắc nào trong file này xung đột với 2 file đặc tả, đặc tả có quyền cao hơn.

---

## 1. TECH STACK — KHÔNG ĐƯỢC THAY ĐỔI

### Frontend
- **Framework:** React 18 + Vite 5
- **Language:** TypeScript 5+ (strict mode bật toàn bộ, **không dùng `any`**)
- **Styling:** Tailwind CSS 3.4+ với palette tuỳ biến (xem mục 5)
- **UI library:** shadcn/ui (copy components vào `src/components/ui/`)
- **Icons:** lucide-react (stroke-width 1.5, không đổi sang library khác)
- **Routing:** react-router-dom 6 (data router, lazy load theo route)
- **State server:** TanStack Query 5 (mọi data fetching từ Supabase)
- **State client:** Zustand 4 (UI state phức tạp như filter, sidebar)
- **Form:** react-hook-form + zod (schema validation)
- **Charts:** Recharts 2
- **Drag-drop:** @dnd-kit/core (Kanban pipeline, sortable lists)
- **PDF:** @react-pdf/renderer (xuất Quote/Invoice/Receipt client-side)
- **Date:** date-fns 3 (locale vi, format dd/MM/yyyy)
- **CSV:** PapaParse

### Backend & Infrastructure
- **Database + Auth + Storage:** Supabase (Postgres 15+)
- **Business logic:** Postgres functions + triggers (atomic operations)
- **Server functions (HTTP, integrations):** Supabase Edge Functions (Deno runtime)
- **Scheduled jobs:** pg_cron (cho heavy nightly aggregation), Vercel Cron (cho HTTP callback đơn giản)
- **Hosting frontend:** Vercel
- **Source control:** GitHub
- **IDE + AI agent:** Antigravity (Cascade) hoặc Windsurf

### Cấm dùng (đã có giải pháp tương đương)
- **Firebase / Firestore** — đã chốt dùng Supabase (Postgres-native)
- **Redux / Redux Toolkit** — đã có Zustand + TanStack Query
- **MUI / Ant Design / Chakra** — đã có shadcn/ui
- **Moment.js** — đã có date-fns
- **styled-components / emotion** — đã có Tailwind
- **Axios** — dùng `supabase-js` + `fetch` cho REST khi cần
- **Bất kỳ ORM nào** (Prisma, Drizzle, Kysely) — dùng `supabase-js` thuần, đủ rồi

---

## 2. AUTH — Email/Password + Google OAuth

### Yêu cầu chức năng
- Cho phép:
  - Đăng nhập bằng email + mật khẩu
  - Đăng nhập bằng Google OAuth
  - Quên mật khẩu / đặt lại mật khẩu qua email
- **Không cho phép self-signup công khai.** Sanh Long là CRM nội bộ — user mới phải do admin tạo qua trang `/admin/users` (gửi invite email).
- Nếu cùng một email được dùng ở nhiều phương thức đăng nhập (email/password, Google), hệ thống coi là **một user duy nhất**, không tạo trùng tài khoản.
- Phân quyền dựa trên **multi-role + permission** (xem mục 3), không phụ thuộc vào cách đăng nhập.

### Quy tắc triển khai
- Có form email/password cho:
  - Đăng nhập (`/login`)
  - Quên mật khẩu (`/forgot-password`)
  - Đặt lại mật khẩu (`/reset-password?token=...`)
- Có nút "Đăng nhập với Google" dùng OAuth của Supabase
- Sau khi xác thực thành công:
  - Luôn bảo đảm có một record duy nhất trong bảng `users` cho mỗi `auth.uid()`
  - Nếu Supabase Auth trả về user với email đã tồn tại trong `users` table, **không tạo thêm record mới**, chỉ link `users.id = auth.users.id` and cập nhật `last_seen_at`
  - Trigger `handle_new_user()` chạy trên `auth.users` insert để tạo row tương ứng trong `users` nếu chưa có
- Session do Supabase quản lý; **không dùng `localStorage` tự lưu token**

### Rule tóm tắt cho team
- Không bao giờ tạo user mới nếu email đã tồn tại, dù từ Google hay email/password
- Đăng nhập bằng Google với email đã có tài khoản → link vào cùng `user_id`, giữ nguyên roles + team + branch
- Khi user nghỉ việc: set `users.active = false`, **không xoá**, để giữ audit log nguyên vẹn
- Khi user nghỉ việc: trigger flow chuyển giao KH (xem `01-FUNCTIONAL-SPEC.md` mục 3.6)

---

## 3. PHÂN QUYỀN — RBAC Multi-role + RLS

### Mô hình
- 1 user có **nhiều role** (qua bảng `user_roles`), mỗi role có **nhiều permission** (qua `role_permissions`)
-- Admin có UI tự cấu hình ở `/admin/roles`: tạo role mới, gán/gỡ permission, gán role cho user
- 9 role mặc định (system, không xoá được): `admin`, `ceo`, `branch_director`, `team_lead`, `sales`, `vet`, `warehouse_keeper`, `accountant`, `purchaser`
- Đầy đủ ~80 permission, định dạng `<resource>.<action>` — xem `01-FUNCTIONAL-SPEC.md` mục 13

### Visibility patterns
- **KH:** sales thấy KH cùng team, team_lead thấy toàn team, branch_director thấy chi nhánh mình (qua orders), admin thấy hết
- **Đơn hàng:** tương tự KH
- **Sổ quỹ:** chặt nhất — sales chỉ thấy phiếu mình tạo, kế toán thấy chi nhánh, admin thấy hết
- **Báo cáo nâng cao:** chỉ admin/CEO/branch_director

---

## 4. BẢO MẬT DỮ LIỆU — Bắt buộc, không thoả hiệp

### RLS (Row Level Security)
- **Mọi bảng** trong Supabase có RLS bật. Không có ngoại lệ.
- Mọi query từ client phải đi qua RLS — không bao giờ dùng `service_role` key ở frontend
- Pattern policy dùng helper function `auth_user_has_permission(perm text)`, `auth_user_team_id()`, `auth_user_branch_id()` — xem `01-FUNCTIONAL-SPEC.md` mục 4.4
- Mọi truy vấn "admin-level" (xem toàn công ty) phải đi qua permission check trong policy, không hardcode bypass

### Service role key
- Chỉ dùng trong Edge Functions cho mục đích cụ thể (audit log system-level, scheduled jobs, integrations với API ngoài)
- **Không bao giờ** đặt `service_role` key vào biến môi trường frontend (`VITE_*`)
- Lưu trong Supabase Secret Manager hoặc Vercel env (server-only)

### Audit log
- Mọi thay đổi quan trọng (giá đơn hàng, chuyển KH, xoá đơn, sửa quyền, sửa hạn mức công nợ...) **bắt buộc** ghi vào bảng `audit_logs` qua trigger Postgres
- Không có cách nào tắt audit từ client
- Sales sửa giá tự do (theo yêu cầu nghiệp vụ) nhưng audit log vẫn ghi ngầm

### Snapshot bất biến
- Đơn hàng / Báo giá / Phiếu thu lưu snapshot customer/price/promotion/exchange_rate tại thời điểm tạo
- Sau khi đơn `completed`, các snapshot này không được sửa
- Sửa thông tin master (đổi MST KH, đổi giá bảng) **không ảnh hưởng** đơn cũ

### Dữ liệu nhạy cảm
- **Giá vốn / margin:** chỉ user có permission `product.view_cost` / `report.view_margin` thấy được. Sales không thấy.
- **Sổ quỹ + dòng tiền:** chỉ admin/CEO/accountant
- **Audit log:** chỉ admin
- **Custom claims trong JWT** không lưu thông tin sensitive (chỉ user_id, primary_team_id, primary_branch_id — đủ cho RLS)

---

## 5. DESIGN SYSTEM — Minimalism Clean (không glassmorphism)

### Triết lý
**"Minimalism + Clean + Trustworthy"** — cảm giác như dashboard ngân hàng đơn giản nhưng đẹp. Không glassmorphism, không dark mode, không neon, không Material 3 loè loẹt.

Lý do:
- Người dùng 30-55 tuổi, không quen UI "trendy"
- Sản phẩm liên quan tiền + tồn kho + sức khoẻ vật nuôi → cảm giác đáng tin cậy
- Chạy trên Android tầm trung ngoài trại → tránh hiệu ứng nặng (backdrop-blur lag)

### Màu sắc
- **Accent duy nhất:** xanh dương trung `#1E5A9C` (blue-500)
- Có 9 shade từ `blue-50` đến `blue-900` — chỉ dùng các shade này, không thêm màu accent mới
- **Neutrals (gray):** 12 shade từ `gray-0` đến `gray-900` (warm-leaning)
- **Semantic colors** (`success`, `warning`, `danger`) rất hạn chế dùng:
  - **Không tô background** semantic cho badge/alert
  - Chỉ dùng cho icon nhỏ + text label
  - Trạng thái phân biệt bằng **icon + label** (Clock, CheckCircle, AlertTriangle) không bằng màu
- Bảng palette đầy đủ: xem `02-LAYOUT-SPEC.md` mục 2

### Typography
- **Font:** `Be Vietnam Pro` (Google Fonts, dấu VN xuất sắc) — fallback Inter, system-ui
- **Weights:** 400 (Regular), 500 (Medium), 600 (Semibold). **KHÔNG dùng 700/800** — quá nặng.
- Title: 24px h1 / 20px h2 / 17px h3 — đều weight 600
- Body: 14-16px weight 400
- Caption: 12-13px weight 500
- Số tiền dùng `tabular-nums`
- Tiếng Việt viết hoa kiểu câu: "Danh sách khách hàng" — không Title Case

### Spacing & Radius
- Padding card: 24px desktop / 16px mobile
- Field gap: 16-20px
- Radius: button 8px, card 10px, modal 14px, mobile sheet 20px
- Shadow rất hạn chế: card mặc định **không có shadow** (chỉ border 1px), chỉ shadow khi cần lift (modal, dropdown, FAB)

### Iconography
- **Bắt buộc dùng** `lucide-react`, stroke-width 1.5
- Size: 16px trong button, 20px trong nav, 24px card header, 48px empty state
- Status icon (Clock, CheckCircle, AlertTriangle, XCircle, Info) → đều dùng `currentColor` `gray-500`, **không tô đỏ/vàng/xanh**
- Icon mapping chuẩn: xem `02-LAYOUT-SPEC.md` mục 5.3

### Components
- Button: primary `bg-blue-500 text-white`, ghost, outline, text, icon variants
- Input: bg trắng, border `gray-200`, focus `blue-500` 1.5px + ring `blue-100` 4px
- Card: bg trắng, border `gray-100` 1px, radius 10px, padding 24px
- Touch target ≥ 44×44px trên mobile

### Empty state
- Mỗi danh sách (KH, đơn, SP, kho, hoạt động, dự án đàn, sổ quỹ) đều có empty state với:
  - Icon 48px `gray-300`
  - Title text-gray-600 ("Chưa có khách hàng")
  - Caption text-gray-400 hướng dẫn
  - CTA button primary ("+ Thêm khách hàng")

### Loading state
- **Skeleton** mặc định cho list/table/card (bg `gray-100`, pulse 1.5s)
- Spinner chỉ cho action nhỏ (button loading 16-20px)
- Không bao giờ dùng full-page spinner

---

## 6. CẤU TRÚC THƯ MỤC

```
sanlong-crm/
├── docs/
│   ├── 01-FUNCTIONAL-SPEC.md       ← spec chức năng (đọc trước)
│   ├── 02-LAYOUT-SPEC.md            ← spec giao diện
│   └── AGENTS.md                    ← Hướng dẫn ngắn cho Antigravity agent
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── router.tsx                   ← Toàn bộ route definition
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts            ← Init Supabase client
│   │   │   ├── auth.ts              ← SignIn, signOut, getUser
│   │   │   ├── queries/             ← GetCustomers, getOrders... (TanStack Query)
│   │   │   └── mutations/           ← CreateOrder, updateCustomer...
│   │   ├── queryClient.ts           ← TanStack Query setup
│   │   ├── utils.ts                 ← Cn(), formatCurrency, formatDate VN
│   │   ├── numberToWords.ts         ← Số → chữ tiếng Việt cho Quote/Invoice PDF
│   │   └── constants.ts             ← Enum, label maps
│   ├── types/                        ← TypeScript interfaces (mirror Postgres tables)
│   │   ├── database.ts              ← Generated từ supabase gen types
│   │   ├── customer.ts
│   │   ├── product.ts
│   │   └── ...
│   ├── components/
│   │   ├── ui/                       ← Shadcn/ui components (Button, Input, Card...)
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Topbar.tsx
│   │   │   ├── MobileBottomNav.tsx
│   │   │   └── QuickRecordFab.tsx
│   │   └── shared/                   ← Avatar, EmptyState, ConfirmDialog, StatusBadge...
│   ├── features/                     ← Mỗi module 1 thư mục
│   │   ├── auth/
│   │   ├── customers/
│   │   ├── products/
│   │   ├── inventory/
│   │   ├── suppliers/
│   │   ├── orders/
│   │   ├── pos/
│   │   ├── invoices/
│   │   ├── debts/
│   │   ├── cashbook/
│   │   ├── pipeline/                 ← Phase 2
│   │   ├── activities/               ← Phase 2
│   │   ├── herd-projects/            ← Phase 2
│   │   ├── promotions/               ← Phase 2
│   │   ├── dashboard/
│   │   ├── reports/
│   │   ├── search/
│   │   ├── notifications/
│   │   └── admin/
│   ├── hooks/                        ← Custom hooks (useAuth, useCustomers...)
│   └── pages/                        ← Route components (lazy-loaded)
├── supabase/
│   ├── migrations/                   ← SQL migrations, naming: <timestamp>_<name>.sql
│   ├── functions/                    ← Edge Functions (Deno)
│   │   ├── generate-invoice-pdf/
│   │   ├── send-notification-email/
│   │   ├── export-cashbook-xlsx/
│   │   └── ...
│   ├── seed.sql                      ← Seed data cho lookup tables
│   └── config.toml
├── public/
├── .env.local                        ← KHÔNG commit (chỉ VITE_SUPABASE_URL + ANON_KEY)
├── .env.example
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
└── package.json
```

### Quy tắc tổ chức
- Mỗi module trong `features/<module>/` có cấu trúc:
  - `components/` — components riêng của module
  - `hooks/` — Custom hooks
  - `queries.ts` — TanStack Query hooks (`useCustomers`, `useCustomer(id)`)
  - `mutations.ts` — Mutations (`useCreateCustomer`)
  - `types.ts` — Types riêng (nếu không dùng từ `src/types/`)
  - `pages/` — Route components (vd `CustomersListPage.tsx`)
- Tách component khi file > 200 dòng
- Component file PascalCase, hook/util file camelCase

---

## 7. CONVENTION CODE

### TypeScript
- **Strict mode** bật toàn bộ. Không dùng `any`. Khi cần linh hoạt: dùng `unknown` rồi narrow.
- Mọi entity Postgres có interface trong `src/types/` hoặc generated từ `supabase gen types typescript`
- Date trong Postgres lưu `timestamptz`, frontend convert sang `Date` qua `new Date(string)`
- Đặt tên interface rõ nghĩa: `Customer`, `Order`, `OrderLine`, `Product`, `ProductVariant`, `StockLot`

### Naming
- **Tables (Postgres):** snake_case plural — `customers`, `order_lines`
- **Columns:** snake_case — `created_at`, `customer_id`, `unit_price_final`
- **Indexes:** `idx_<table>_<columns>`
- **Functions/Triggers:** snake_case verb — `calculate_order_total`, `allocate_lots_fefo`
- **Files TS:**
  - Components: PascalCase — `CustomerListPage.tsx`, `KanbanBoard.tsx`
  - Utilities/hooks: camelCase — `formatCurrency.ts`, `useAuth.ts`
- **Identifiers code:** camelCase cho variables/functions, PascalCase cho components/types

### Error handling
- Mọi async function có try/catch hoặc `.catch`
- Toast lỗi tiếng Việt thân thiện:
  - "Không lưu được khách hàng. Vui lòng thử lại."
  - "Mất kết nối mạng. Vui lòng kiểm tra lại."
  - Không hiển thị stack trace cho user
- Log error đầy đủ ra console + Supabase logs (qua Edge Function nếu cần audit lỗi nghiệp vụ)
- TanStack Query có pattern `onError` global trong `queryClient` — toast lỗi tự động

### Số tiền & Date
- **VND format:** `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount)` → `1.250.000 ₫`
- **Số lớn rút gọn** ở dashboard: `1,25 tr` (triệu), `1,25 tỷ` — không dùng M/B tiếng Anh
- **Date format:** `dd/MM/yyyy` (VN convention) qua `date-fns/format` với locale `vi`
- **Timestamp lưu UTC**, frontend convert hiển thị `Asia/Ho_Chi_Minh`

### Comment
- Comment giải thích **vì sao**, không phải **làm gì**. Code rõ là tự kể chuyện.
- Bằng tiếng Việt hoặc tiếng Anh đều được, miễn nhất quán trong 1 file
- TODO comment phải có context: `// TODO: handle case khi tỷ giá USD bị null - Phase 2`

---

## 8. SUPABASE PATTERNS

### Client init
- File `src/lib/supabase/client.ts` export single instance
- Env: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon key, không phải service_role)

### Query pattern (TanStack Query)
```ts
// src/features/customers/queries.ts
export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: ['customers', 'list', filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*, primary_sales:users(id, full_name)')
        .eq('active', true)
        // RLS tự lọc theo team, không cần thêm where user_id
      if (error) throw error
      return data
    },
  })
}
```

### Mutation pattern
```ts
export function useCreateCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCustomerInput) => { ... },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Đã thêm khách hàng')
    },
    onError: () => toast.error('Không lưu được khách hàng. Vui lòng thử lại.'),
  })
}
```

### Realtime
- Dùng Supabase Realtime cho: notifications (bell badge), order status changes, dashboard widgets cần live update
- **Phải unsubscribe** trong cleanup `useEffect`
- Bật replication chỉ cho bảng cần realtime — không bật cho mọi bảng

### Edge Functions
- Dùng cho:
  - Generate PDF (invoice, quote, receipt)
  - Gửi email notifications (Resend/Sendgrid)
  - Export Excel sổ quỹ (SheetJS)
  - Tích hợp HD điện tử (Phase 2 — Misa/Viettel SInvoice)
  - Image resize khi upload (Storage trigger)
  - Webhook đối soát ngân hàng (Phase 3)
- **Không dùng** cho: business logic atomic (đó là việc của Postgres function/trigger)

### Postgres functions/triggers
- Atomic operations bắt buộc dùng Postgres function:
  - `calculate_order_total(order_id)` — pricing engine
  - `allocate_lots_fefo(order_id)` — FEFO stock allocation
  - `confirm_order(order_id)` — wrap toàn bộ flow xác nhận đơn (allocate + check credit + cập nhật debts)
- Trigger bắt buộc:
  - `set_updated_at` trên mọi bảng có `updated_at`
  - `write_audit_log` trên các bảng audit-needed
  - Update `customers.current_debt` khi `order_payments` hoặc `debt_payments` thay đổi
  - Cập nhật `stock_lots.quantity_*` khi `stock_movements` thay đổi

---

## 9. MIGRATION & SCHEMA

### Quy tắc migration
- File trong `supabase/migrations/<timestamp>_<name>.sql`
- Naming: `20260601120000_create_customers_table.sql`
- **Migration không bao giờ sửa file cũ** — thay đổi schema = file mới `20260615_add_credit_limit_to_customers.sql`
- Migration phải **idempotent**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`
- Mỗi migration làm 1 việc rõ ràng, không gộp 10 thứ khác nhau
- Test migration trên local Supabase trước khi push

### Universal columns
Mọi bảng nghiệp vụ có:
```sql
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
created_by uuid REFERENCES users(id),
updated_by uuid REFERENCES users(id),
deleted_at timestamptz, -- soft delete cho entity quan trọng
```

### Soft delete
- Entity quan trọng (customers, products, orders, suppliers) dùng `deleted_at`
- RLS policy thêm `AND deleted_at IS NULL` cho mọi SELECT
- Hard delete chỉ admin có permission `<entity>.hard_delete`

### Code sequences
- Bảng `code_sequences` quản lý mã tự sinh (KH-2026-00001, DH-2026-00001...)
- Function `next_code(entity_type)` atomic increment
- Reset đầu năm: thủ công qua admin tool (không auto vì có thể cần ghi đè)

---

## 10. PHASE PLAN — Tuân thủ nghiêm

Mọi feature đều có tag `[P1]`, `[P2]`, `[P3]` trong `01-FUNCTIONAL-SPEC.md`. **Không build feature Phase 2/3 trong Phase 1**.

### Phase 1 (2-3 tháng) — ERP bán hàng tối thiểu
Auth + RBAC, Tổ chức, Sản phẩm cơ bản (1 variant), Lô + HSD, KH cơ bản, Nhập hàng, Bảng giá theo nhóm KH, POS + Mobile order entry, Báo giá, Đơn hàng 6 trạng thái, Trả hàng KH, Công nợ, Hoá đơn bán lẻ, Sổ quỹ + phiên quỹ, Dashboard cơ bản, Tìm kiếm Ctrl+K, Thông báo in-app + email, Audit log

### Phase 2 (4-6 tháng) — CRM đầy đủ + nâng cấp ERP
Multi-variant + multi-unit + quantity_break, Điều chuyển kho, Cảnh báo HSD/low stock, KH đầy đủ (trại + đàn + vaccine + bệnh + đối thủ), Pipeline, Hoạt động, Lịch tuần sales, Dự án đàn, Khuyến mãi 6 loại + tích điểm, VAT điện tử, Báo cáo nâng cao

### Phase 3 (6-12 tháng) — Analytics & tự động hoá
RFM, lifecycle, churn risk, customer score, product affinity, gợi ý cross-sell, dòng tiền dự kiến, Zalo OA / SMS, IoT chuỗi lạnh, đối soát ngân hàng, khoá KH tự động, BigQuery export

### Rule cho Antigravity agent
- Khi prompt yêu cầu build module, **mặc định chỉ build feature Phase 1** trừ khi prompt nói rõ phase nào
- Schema có thể chuẩn bị column cho Phase 2/3 (nullable) để tránh migrate lớn sau, nhưng UI chỉ implement Phase 1
- Báo cáo cuối mỗi task: "Đã build [tag] features for [module]. Phase 2/3 items skipped: [list]"

---

## 11. NỘI DUNG TIẾNG VIỆT — Quy ước thống nhất

### Ngôn ngữ
- Tất cả text UI bằng **tiếng Việt có dấu**
- Identifier code, comment kỹ thuật, table/column name → tiếng Anh
- Không trộn Anh-Việt trong UI trừ tên riêng (vd "Trại Anh Tuấn", "Vaccine Newcastle")
- Câu ngắn, rõ, không khoa trương

### Thuật ngữ thống nhất
| Khái niệm | Tiếng Việt chuẩn |
|---|---|
| Customer | Khách hàng (viết tắt KH) |
| Customer type | Loại khách hàng |
| Farm | Trại |
| Herd | Đàn |
| Product | Sản phẩm (SP) |
| Variant | Quy cách |
| Stock lot | Lô hàng |
| Expiry date | Hạn sử dụng (HSD) |
| Warehouse | Kho |
| Supplier | Nhà cung cấp (NCC) |
| Purchase order | Phiếu mua hàng (PO) |
| Goods receipt | Phiếu nhập kho |
| Order | Đơn hàng |
| Quote | Báo giá |
| Invoice | Hoá đơn |
| Sales return | Trả hàng |
| Debt | Công nợ |
| Cashbook | Sổ quỹ |
| Cashier session | Phiên quỹ |
| Opportunity | Cơ hội bán hàng |
| Pipeline | Pipeline cơ hội |
| Stage | Giai đoạn |
| Activity | Hoạt động |
| Herd project | Dự án đàn |
| Promotion | Khuyến mãi |
| Voucher | Voucher / Mã giảm giá |
| Loyalty points | Điểm tích luỹ |
| Branch | Chi nhánh |
| Team | Nhóm bán hàng |

### Vai trò hiển thị
- "Quản trị viên" (admin)
- "Giám đốc điều hành" (CEO)
- "Giám đốc chi nhánh" (branch_director)
- "Trưởng nhóm" (team_lead)
- "Nhân viên kinh doanh" (sales)
- "Bác sĩ thú y" (vet)
- "Thủ kho" (warehouse_keeper)
- "Kế toán" (accountant)
- "Mua hàng" (purchaser)

### Trạng thái phổ biến
- Đơn hàng: Nháp / Đã xác nhận / Đang giao / Đã giao / Đã thanh toán / Hoàn thành / Đã huỷ
- KH lifecycle: Mới / Đang hoạt động / Có nguy cơ rời / Đã rời
- KH value tier: VIP / Thường / Tiềm năng cao
- Phiên quỹ: Đang mở / Đã đóng

---

## 12. WORKFLOW VỚI ANTIGRAVITY AGENT

### File AGENTS.md (ngắn, ở root project)
```markdown
# Sanh Long CRM Project

## Quy tắc bất biến
1. Đọc `docs/01-FUNCTIONAL-SPEC.md` trước mọi task. Đọc `docs/02-LAYOUT-SPEC.md` trước task UI.
2. Đọc file Rules ở `docs/RULES.md` (file này) trước khi code.
3. Chỉ build feature có tag `[P1]` trong Phase 1. Bỏ qua `[P2]`, `[P3]` trừ khi prompt nói rõ.
4. Stack đã chốt — không gợi ý đổi.

## Quy trình mỗi task
1. Đọc spec phần liên quan
2. Liệt kê bảng/file/function sẽ tạo hoặc sửa
3. Hỏi xác nhận nếu phạm vi không rõ
4. Implement
5. Báo cáo: file đã tạo/sửa, test đã chạy, gì còn thiếu

## Quy tắc tuyệt đối
- Không bao giờ tắt RLS
- Không bao giờ dùng `any` trong TypeScript
- Không bao giờ tạo migration sửa file cũ — luôn tạo migration mới
- Không bao giờ commit secrets vào Git
- Không bao giờ tự ý đổi palette màu hoặc font
```

### Prompt template cho agent
Khi yêu cầu agent làm task, dùng template:
```
Task: <mô tả ngắn>
Module: <tên module trong features/>
Phase: P1 (mặc định) | P2 | P3
Spec reference: docs/01-FUNCTIONAL-SPEC.md mục <số>
Layout reference: docs/02-LAYOUT-SPEC.md mục <số> (nếu có UI)
Acceptance criteria:
- [ ] <criteria 1>
- [ ] <criteria 2>
```

### Code review checklist cho agent output
- [ ] Code pass `tsc --noEmit` không lỗi
- [ ] Code pass `eslint --max-warnings 0`
- [ ] Có error handling với toast tiếng Việt
- [ ] Không có `any`, không có TODO ngầm
- [ ] Có audit log nếu sửa data nghiệp vụ quan trọng
- [ ] RLS policy có cho table mới
- [ ] Migration idempotent
- [ ] File < 200 dòng (nếu lớn hơn → tách)
- [ ] Loading state (skeleton) + Empty state có
- [ ] Mobile-friendly (touch target ≥ 44px nếu UI)

---

## 13. GIT & DEPLOY

### Git
- **Branch:** `main` (production), `develop` (staging), `feature/<name>` (work)
- **Commit message:** Conventional Commits
  - `feat(customers): add quick create form`
  - `fix(orders): correct FEFO allocation when lots have same expiry`
  - `chore(deps): bump supabase-js to 2.42`
  - `docs(rules): add audit log requirement`
- Push trực tiếp lên `main` cấm — phải qua PR
- PR cần ít nhất 1 review (Phase 1 có thể self-review nếu solo dev)

### Vercel
- Branch `main` deploy production tự động
- Branch `develop` deploy preview "staging"
- PR có preview URL riêng
- Env biến cấu hình trong Vercel dashboard, không commit `.env*`

### Supabase environments
- **Local:** Supabase CLI cho dev (start qua `supabase start`)
- **Staging:** project riêng `sanlong-staging`
- **Production:** project riêng `sanlong-prod`
- Migration push qua `supabase db push` (staging trước, prod sau)
- Backup auto-daily + manual weekly

### Secrets
- **Không commit:** `.env.local`, `.env.production`, `service_role` key, OAuth client secrets
- Vercel env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public)
- Supabase Function secrets: `RESEND_API_KEY`, `MISA_INVOICE_API_KEY`...

---

## 14. TESTING (Khuyến nghị Phase 2-3)

Phase 1 ưu tiên ship nhanh, test thủ công. Từ Phase 2 trở đi:
- **Unit test:** Vitest cho utility functions (formatCurrency, numberToWords, FEFO logic)
- **Integration test:** test Postgres function bằng `pgTAP` trong CI
- **E2E test:** Playwright cho luồng critical (tạo đơn POS, thanh toán, in hoá đơn)
- **RLS test:** test policy với role giả lập

---

## 15. KHI GẶP THIẾT KẾ MƠ HỒ

Khi spec không đủ chi tiết hoặc xung đột, **quyết định theo thứ tự ưu tiên này** và ghi chú trong code:

1. Ưu tiên đơn giản hơn phức tạp
2. Ưu tiên mobile UX hơn desktop (user chính dùng mobile)
3. Ưu tiên giữ nguyên design system (không "sáng tạo" thêm màu/font)
4. Ưu tiên Postgres-native best practice (RLS chặt, transaction atomic, denormalize có chủ đích)
5. Ưu tiên P1 ship được hơn P3 hoàn hảo

Nếu vẫn không quyết được → comment `// QUESTION: ...` trong code và list vào báo cáo cuối task để hỏi.

---

## 16. CHẤT LƯỢNG CODE — Định lượng

- Code phải pass `tsc --noEmit` và `eslint --max-warnings 0`
- File component > 200 dòng → tách
- Function > 50 dòng → tách hoặc xem xét lại
- Custom hook bắt đầu bằng `use`, return object có key rõ ràng (`{ data, isLoading, error }`)
- Mọi async function có try/catch hoặc `.catch` + toast lỗi tiếng Việt thân thiện
- Mọi component nhận `props` có interface định nghĩa
- Không có console.log trong code production (dùng proper logger nếu cần)

---

**HẾT FILE RULES**

Đây là quy tắc làm việc. Đọc kèm 2 file spec:
- `docs/01-FUNCTIONAL-SPEC.md` — Đặc tả chức năng + database + RLS + permissions
- `docs/02-LAYOUT-SPEC.md` — Đặc tả giao diện + design system + wireframe

Khi conflict: spec > rules > comment trong code.
