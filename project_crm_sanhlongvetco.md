Ngữ cảnh đã lưu vào memory cho mai
project_crm_sanhlongvetco.md ghi rõ:

Pattern mới (src/hooks/queries/, qk factory, fallback pattern, lazy+Suspense, AuthContext expose role/perms)
6 vấn đề đã FIX (P0+P1) + 6 vấn đề còn lại (P2+P3)
Kế hoạch P2 chi tiết với 8 task (P2-1 → P2-8): debounce áp dụng, virtualization (cần npm install), Skeleton, memo POS, tách CustomerDetail/Inventory/Cashbook, ErrorBoundary, migrate Orders/Suppliers/Inventory/Pipeline sang useQuery
Cảnh báo: P2-5 (CustomerDetail 3100 dòng) nên làm session riêng
Bắt đầu session mai
Bạn mở project lên, nói "tiếp tục P2" — tôi sẽ đọc memory + roadmap_tasks.md để vào việc ngay không cần re-explain. Nếu muốn ưu tiên task cụ thể (vd: "làm P2-5 tách CustomerDetail") cũng được — memory có đầy đủ pattern để follow.

Chúc bạn ngủ ngon!