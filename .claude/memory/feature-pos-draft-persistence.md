---
name: feature-pos-draft-persistence
description: Bền hóa nháp đơn POS qua localStorage — khắc phục mất dữ liệu khi F5/đóng tab/mất điện
metadata:
  type: project
---

## Bền hóa nháp đơn POS ✅ 2026-06-14

**Vấn đề gốc:** Toàn bộ dữ liệu đang soạn trên `/pos` (state `tabs`) và `/orders/mobile` sống trong React state → F5 / đóng tab / mất điện mất sạch. User báo: soạn sẵn 5 hóa đơn cho khách, mất điện → mất hết.

**Giải pháp (frontend-only, KHÔNG migration; `npm run build` PASS):**
- `src/lib/posDraftStorage.ts` (MỚI): `loadDraft/saveDraft/clearDraft` qua localStorage. Envelope `{v:1, savedAt, data}`, **TTL 7 ngày**, validate, try/catch quota. Khóa: `posTabsKey(uid)` = `pos-draft-tabs:<uid>`, `posMobileKey(uid)` = `pos-draft-mobile:<uid>`.
- `POSPage.tsx`: khóa theo `profile.id` (máy quầy dùng chung → tách nháp theo ca). Khôi phục `tabs`+`activeTabId` 1 lần qua `draftRestoredRef` (gate, tránh auto-save ghi đè nháp cũ bằng tab rỗng mặc định) + toast. Auto-save khi tabs đổi; mọi tab trống → clearDraft. `loadData` gán bảng giá mặc định dùng `t.selectedPriceListId || def.id` (không đè khôi phục). `handleCloseTab` confirm khi tab còn hàng.
- `MobileOrderPage.tsx`: 1 nháp phẳng; cùng pattern ref-gate + auto-save; clearDraft khi `fn_create_delivery_draft` thành công.

**Quan trọng — gate auto-save:** effect save phải check `draftRestoredRef.current` (chỉ chạy SAU khi đã thử khôi phục), nếu không sẽ ghi đè nháp đã lưu bằng state rỗng lúc mount.

**🐞 Bug stale-closure đa tab (vá cùng phiên, phát hiện khi test):** Tab 2 không thêm được SP khi cùng bảng giá Tab 1. Các callback memoized (`addToCart` deps `[selectedPriceListId]`; `adjustQuantity/updateQuantity/updateUnitPrice/addPromoLine/applyProductGift/setRowDiscount` deps `[]`) gọi `setCart` — `setCart` "đóng băng" `activeTabId` trong closure. Bảng giá giống nhau → addToCart không tái tạo → ghi vào Tab 1. **Fix:** `const activeTabIdRef = useRef(activeTabId); activeTabIdRef.current = activeTabId` (mirror đồng bộ mỗi render); `setCart`/`updateActiveTab` đọc `activeTabIdRef.current`. **Bài học:** mọi setter ghi theo "tab/dòng đang chọn" mà bị gọi từ `useCallback` deps tĩnh PHẢI đọc id qua ref, không capture trực tiếp.

**Rà soát /pos kèm theo (giữ nguyên):** RPC POS đã atomic + check quyền/hạn mức server-side (xem `20260613000000_pos_order_rpcs.sql`). Bán âm kho chặn 2 tầng. Giá `unit_price` client gửi tùy ý = đúng nghiệp vụ POS sửa giá (ghi nhận, không đổi — user duyệt giữ nguyên).

**Vá an ninh + UX sau rà soát (2026-06-14 tiếp):**
- **#1 Kho theo chi nhánh — migration `20260703000000_pos_warehouse_branch_guard.sql` (ĐÃ apply remote qua Management API + verify `has_guard=true` + INSERT history `20260703000000`):** `fn_pos_build_draft` nay RAISE nếu `warehouse_id` không thuộc `branch_id` người tạo (miễn trừ admin qua `fn_is_admin`). Bịt lỗ trừ kho chéo chi nhánh (RPC SECURITY DEFINER bỏ RLS, client tự gửi warehouse_id).
- **#3 `cartUtils.genId()`** fallback khi `crypto.randomUUID` không khả dụng (http LAN). Thay hết trong POSPage + cartUtils.
- **UX:** updateQuantity Math.max(1) (#4); click-away dropdown khách `customerBoxRef` (#5); nhớ toggle `pos-pref:*` (#8).
- **#7 Tồn kho tươi đa máy:** `POSPage` refetch `fetchStockData` khi focus/visibilitychange + interval 60s lúc visible (polling nhẹ thay realtime — không phụ thuộc realtime publication, egress thấp).
- **#6 GIỮ chặn cứng oversell cả 2 luồng** (user duyệt lại — không đổi). **#2 sàn giá giữ nguyên** (user duyệt).

## Mở rộng: bền hóa nháp 3 form Kho ✅ 2026-06-14 (tiếp)
Tái dùng `posDraftStorage.ts` — thêm keys `goodsReceiptDraftKey/stockTransferDraftKey/purchaseReturnDraftKey` (`inv-draft-*:<uid>`).
- **`GoodsReceiptFormPage.tsx`**: persist CHỈ tạo-mới chế độ `direct` (bỏ qua `?id=` edit & `?po_id=`); header + `verificationItems`; default kho đổi sang functional `prev => prev || whData[0].id` chống đè khôi phục; clearDraft sau tạo.
- **`InventoryPage.tsx`** 2 modal: `newTransfer` + `newReturn`, restore 1 lần qua `invDraftRestoredRef`, auto-save khi có nội dung, clear khi rỗng (reset form). X đóng = giữ nháp; Hủy = reset → tự dọn.
- **🐞 Vá khôi phục phiếu nhập (StrictMode):** restore phải persist+khôi phục `selectedPOId`+`selectedPO` (cờ gating màn nhập, fallback dựng lại cho nháp cũ). **ROOT CAUSE quan trọng:** dự án bật `<StrictMode>` → effect chạy 2 lần → cờ skip-một-lần (`modeInitRef`) bị phá, effect reset theo `receiptMode` xóa item đã khôi phục. **Fix: so prev-value `prevModeRef.current === receiptMode`, KHÔNG dùng boolean một-lần.** 2 modal kho an toàn (effect chỉ nạp lot dropdown, reset lines chỉ trong onChange người dùng).
- **BÀI HỌC chung:** mọi effect "reset state khi X đổi" phải so sánh prev-value qua ref, không dùng cờ boolean chạy-một-lần (StrictMode double-invoke sẽ phá).

- **Rà soát toàn diện kho (Phần B): CHƯA làm** — chờ user duyệt.

Liên quan: [[project-state]], [[feedback-conventions]].
