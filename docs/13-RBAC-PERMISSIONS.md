# Phân quyền chi tiết theo Module × Chức năng (RBAC Playbook)

> Cập nhật 2026-06-24 — Phase 1 (foundation + pilot module Công nợ KH).

## 1. Mô hình

```
user → user_roles → roles → role_permissions → permissions(code = module.action)
```

- **1 user có nhiều role**; quyền hiệu lực = HỢP NHẤT permission của mọi role.
- `permissions.code` dạng `module.action` (vd `customers.collect_debt`, `cashbook.create_inflow`).
- **admin / ceo = super** (bypass mọi check qua `fn_is_admin()` ở DB và `hasPermission()` ở FE). KHÔNG seed/sửa quyền 2 role này.

## 2. Nguồn sự thật

| Lớp | File | Vai trò |
|---|---|---|
| FE catalog | `src/lib/permissionCatalog.ts` | Danh mục chuẩn module × action — **driver ma trận UI** + kiểm tra toàn vẹn |
| DB catalog | bảng `permissions` | Seed khớp catalog (migration `2026072500…`) |
| Gán role↔perm | bảng `role_permissions` | Sửa qua RPC `fn_set_role_permissions` (admin) |
| UI quản lý | `src/pages/system/RolePermissionMatrix.tsx` | Tab "Vai trò & Phân quyền" (Cấu hình) — ma trận checkbox, kế thừa `DataTable` |
| Gating FE | `useAuth().hasPermission('module.action')` | Hợp nhất mọi role; admin/ceo luôn true |
| Gating server | `fn_has_permission('code')` / `fn_has_role('code')` | RLS + RPC guard |

## 3. ➕ Thêm chức năng mới → tự xuất hiện trong phân quyền

1. Thêm 1 dòng `action` vào module tương ứng trong `src/lib/permissionCatalog.ts`.
2. Thêm dòng UPSERT tương ứng vào migration seed `permissions` (idempotent).
3. (Khi cần enforce thật) gate FE bằng `hasPermission('module.action')` + đổi RLS/RPC sang `fn_has_permission`.
4. Code mới **tự hiện** trong ma trận "Vai trò & Phân quyền" (UI đọc catalog).

> Quy ước: FE chỉ được `hasPermission(code)` với code CÓ trong catalog. `ALL_PERMISSION_CODES`/`metaForCode` dùng để rà soát.

## 4. Lộ trình enforcement (quan trọng về bảo mật)

Bảo mật THẬT nằm ở **RLS**. Hiện RLS phần lớn theo **role** (`fn_has_role`, ~375 mệnh đề). Ma trận permission chỉ "thật" khi enforcement của module đã chuyển sang `fn_has_permission`.

- **Chấm xanh (enforced)** trong ma trận = đã enforce ở server. Đổi quyền có hiệu lực thật.
- Action chưa có chấm = đang hiệu lực FE; RLS vẫn theo role → sẽ chuyển ở phase sau.

### Đã enforce (Phase 1 — pilot)
- `customers.collect_debt` → `fn_collect_customer_debt` guard = `fn_is_admin() OR fn_has_permission('customers.collect_debt')`.
  - Seed: cấp cho `accountant` + `branch_manager` (admin/ceo bypass) ⇒ **giữ nguyên** quyền trước đây.
  - FE: nút Thu nợ ở `CustomerQuickView` + `CustomerDetailPage` gate bằng permission này.

### Phase sau (TODO — chuyển dần từng module, mỗi lô verify riêng)
- customers.adjust_debt (RLS `customer_debts`), orders.*, cashbook.*, inventory.*, products.*, purchase_orders.*, reports.*, system.* …
- Mỗi module: đổi RLS/RPC `fn_has_role` → `fn_has_permission`, seed `role_permissions` giữ nguyên quyền tại thời điểm cắt (không đổi hành vi), test JWT giả từng role.

## 5. RPC `fn_set_role_permissions(role_id, codes[])`
- SECURITY DEFINER, **admin-only** (`fn_is_admin`), nguyên tử (xóa hết role_permissions của role → chèn lại theo `codes`).
- Chặn sửa `admin`/`ceo`. REVOKE PUBLIC, GRANT authenticated.

## 6. Kiểm tra toàn vẹn (chạy khi nghi ngờ lệch)
- FE code dùng ↔ catalog: mọi `hasPermission('x')` có `x ∈ ALL_PERMISSION_CODES`.
- Catalog ↔ DB: `permissions.code` khớp `ALL_PERMISSION_CODES`.
- Hiệu lực: với mỗi user, `can_<action>` = (role admin/ceo) OR (role_permissions chứa code). Đối chiếu trước/sau seed để chắc KHÔNG hạ cấp ai.
