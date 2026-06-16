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

## Nâng cấp /pos lô-FEFO + tiện dụng ✅ 2026-06-15 (frontend-only)
- **#1 Lô/FEFO/HSD:** `fetchStockData` nạp thêm lô (`id,lot_number,expiry_date`) → `productLots` sắp FEFO; helper `getLotSummary`/`getFefoInfo`/`daysToExpiry` (ngưỡng cận hạn 30 ngày). Hiện badge CẬN/QUÁ HẠN + lô bán ở ô tìm + dòng giỏ. Server vẫn trừ FEFO khi xác nhận. Chọn lô thủ công = Phase 2 (cần RPC nhận lot_id).
- **#2** ô tìm rộng 640px, font 15px. **#3** luồng Enter→nhập SL→Enter (pendingProduct + qtyInputRef; `addToCart(product, qty)`). **#4** double-submit guard (`submittingRef`), Alt+1..9 chuyển tab (`tabsRef`), thêm nhanh KH (modal, RLS owner=auth.uid()).
- **"60 sai về logic"** thực chất = muốn thấy lô (SP có nhiều lô khác HSD), không phải sai số. Đã làm minh bạch lô.

## Nâng cấp /pos vòng 2 — layout + lô tách dòng ✅ 2026-06-15 (sau test, frontend-only, build PASS)
User chọn **FEFO tự tách dòng** (KHÔNG migration; backend vẫn trừ FEFO ở `fn_allocate_lots_fefo` 20260624). Sửa theo 5 góp ý:
- **#5 Dời ô tìm kiếm vào THANH XANH POS** (bỏ `searchElement` Layout — truyền `<span hidden/>`). Header xanh tách **2 hàng**: hàng 1 = logo + `productSearchBar` (flex-1) + nút thao tác; hàng 2 (`bg-[#006cc0] h-9`) = tab hóa đơn. Mục đích: đủ rộng, hết che chữ (#1).
- **#4 Ô SỐ LƯỢNG luôn mount** (không còn toggle remount) → `qtyInputRef` luôn hợp lệ, focus chắc chắn sau Enter; mặc định prefill `'1'` + `select()` để gõ đè. `choosePendingProduct()` dùng chung cho Enter & click. Sửa lỗi "phải dùng chuột mới thêm được".
- **#2 Dropdown hiện CHI TIẾT TỪNG LÔ** (thay "2 lô" gộp): mỗi lô 1 dòng (Lô · HSD · tồn + badge BÁN TRƯỚC/CẬN HẠN/QUÁ HẠN). Tên SP `break-words` hết truncate.
- **#3 Giỏ hàng tách dòng theo lô**: helper `getFefoAllocation(productId, qty)` → mỗi lô 1 dòng (Lô · HSD · SL phân bổ) dưới tên SP + cảnh báo `shortfall`. Thay `getFefoInfo`/`getLotSummary` (đã xóa).
- **Lưu ý:** allocation giỏ tính theo `item.quantity` từng dòng (trùng lô nếu cùng SP 2 dòng thường — hiếm). Chọn lô thủ công vẫn là Phase 2 (cần migration order_lines.lot_id + sửa trigger) — user đã chốt KHÔNG làm.

## Nâng cấp /pos vòng 3 — CHỌN LÔ THỦ CÔNG ✅ 2026-06-15 (có migration, build PASS)
User đổi ý từ FEFO-auto → **cho NV chọn lô** (lý do: một số KH không nhận lô cận date). Đây là Phase 2 đã làm.
- **Migration `20260706000000_pos_manual_lot_selection.sql`** (ĐÃ apply remote + smoke test rollback PASS + ghi schema_migrations):
  - `order_lines + lot_id UUID` (nullable, FK stock_lots). NULL = FEFO như cũ (tương thích ngược, quà KM/SP không lô).
  - `fn_pos_build_draft` (override bản 20260703): ghi lot_id + **validate lô thuộc kho xuất & active** + **chặn oversell THEO TỪNG LÔ** (dòng có lô so tồn đúng lô; dòng không lô so tồn tổng SP). Giữ guard kho-chi-nhánh.
  - `fn_auto_stock_on_order_confirm` (override 20260624): dòng có lot_id → trừ **ĐÚNG lô đã chọn** (ghi order_line_allocations + stock_movements + giảm qoh, KHÔNG đụng reserved); dòng NULL → FEFO. Hủy đơn vẫn hồi kho đúng (dựa order_line_allocations).
  - **Smoke test** (DO block + RAISE rollback, cần `set_config('app.order_rpc','on',true)` để qua guard `fn_guard_order_status`): chọn lô_b → trừ đúng lô_b, lô FEFO lô_a KHÔNG đổi. ✅
- **Frontend POSPage**: `CartItem + lotId/lotNumber/lotExpiry/lotAvailable`. `searchLotEntries` phẳng hóa SP×lô → dropdown **mỗi lô 1 mục chọn được** (↑↓/Enter/click), nhãn BÁN TRƯỚC (lô FEFO đầu). `addToCart(product, qty, lot)` gộp theo (SP,lô,giá). **Giỏ: mỗi lô 1 dòng riêng** (cùng SP khác lô = 2 dòng). **oversellLines tính theo lô** (tồn tươi từ productLots) → nút **Thanh toán bị disable** khi vượt tồn lô. Submit `lines[].lot_id`.
- **#3 Bỏ header trên cùng + logo**: `Layout` thêm prop `hideTopBar` (ẩn `<header>` nav, main `overflow-hidden`); POS truyền `hideTopBar` + `h-screen`; bỏ luôn `<h1>SANH LONG POS` trong thanh xanh. Muốn mở Dashboard → mở tab trình duyệt khác.
- **⚠️ Còn hở (ngoài phạm vi):** `fn_pos_apply_lines` (luồng SỬA đơn) chưa truyền lot_id → sửa đơn có lô sẽ re-FEFO. Không sai toàn vẹn (vẫn trừ kho đúng tổng) nhưng mất lựa chọn lô. Cân nhắc vá khi đụng tới trang sửa đơn.

- **Rà soát toàn diện kho (Phần B): CHƯA làm** — chờ user duyệt.

## Nâng cấp /pos vòng 4 — tìm theo lô, giá gần nhất, info KH + sửa hạn mức ✅ 2026-06-16 (có migration, build PASS, smoke-test rollback PASS)
Migration `20260707000000_pos_last_price_and_credit_limit.sql` (ĐÃ apply remote qua Management API + verify 2 hàm `prosecdef=true` + smoke-test JWT giả lập rollback). **2 hàm SECURITY DEFINER, KHÔNG đổi schema.**
- **#1 Tìm SP bằng SỐ LÔ:** `searchResults` khớp thêm `lot_number` (ngoài tên/SKU). `searchLotEntries`: nếu SP chỉ khớp do số lô (không khớp tên/SKU) → chỉ hiện đúng lô khớp; ngược lại hiện tất cả lô. Thuần FE (đọc `productLots`).
- **#2 GIÁ BÁN GẦN NHẤT (chỉ sau khi chọn KH):** `fn_pos_last_sold_prices(p_customer_id uuid, p_product_ids uuid[])` plpgsql STABLE — guard `fn_is_active()`, `DISTINCT ON (product_id)` order created_at DESC, loại `cancelled`. **Lý do bỏ RLS:** RLS `orders` SELECT cho sales chỉ thấy đơn `owner_user_id=mình` → client query không tin cậy đa-thu-ngân. FE: state `lastPrices` (productId→unit_price), effect deps `[selectedCustomerId, cartProductIdsKey]` (key = tập SP trong giỏ đã sort+join → KHÔNG refetch khi đổi SL/giá). Nút "Gần nhất: X" dưới ô đơn giá mỗi dòng giỏ, bấm → `updateUnitPrice`.
- **#3 Tìm KH bằng ID:** thêm `c.id.toLowerCase().includes(q)` vào `filteredCustomers`.
- **#4 Info KH mở rộng + SỬA HẠN MỨC:** effect nạp LƯỜI khi chọn KH: `customers.province/district/address` + `customer_contacts.phone` (is_primary) → state `customerDetail`. **Cố ý nạp lười, KHÔNG thêm vào fetch hàng loạt `customers`** (giữ payload load đầu nhẹ — trả lời câu hỏi hiệu năng user). Hiện SĐT (tel:), địa chỉ, mã KH. **Sửa hạn mức inline:** `fn_pos_set_credit_limit(uuid, numeric)` — **user chốt cho MỌI NV active sửa MỌI KH** (bỏ RLS customers update vốn owner-only cho sales), guard fn_is_active + validate ≥0 + FOR UPDATE + ghi `audit_logs` (old/new + `source=pos_set_credit_limit`). FE: `handleSaveCreditLimit` cập nhật `customers` state cục bộ để `isCreditLimitExceeded` tính lại ngay. KH `credit_limit=0` → tô đỏ "Chưa thiết lập".
- **Rủi ro user đã chấp nhận:** thu ngân tự nâng hạn mức = tự duyệt nợ → đã có audit_logs truy vết (đề xuất ban đầu là gate theo quyền nhưng user chọn tiện lợi tối đa).
## /pos vòng 4b — layout cột phải + tiền trả DƯ (overpayment) ✅ 2026-06-16
- **Layout cột thông tin phải:** mở rộng aside `20%→25%` (giỏ `80→75`, danh mục `35→30`); **Hình thức thanh toán = hàng ngang 3 nút** (grid-cols-3, nhãn + phím F3/F4/F8); khối info KH gộp **5→3 dòng** (Hạng+Mã·SĐT | Địa chỉ full-width tự wrap | Nợ·Hạn mức); nén space-y. Mục đích: Bảng giá + Thanh toán (dùng nhiều) hiện sẵn KHÔNG cuộn.
- **FIX cuộn triệt để (50/50):** cấu trúc cũ `flex-1 overflow upper` + `shrink-0 bottom` vẫn cuộn vì bottom cao chiếm hết, upper bị ép. **Mới:** aside có 3 con — (1) khối VÀNG `flex-1 min-h-0 overflow-y-auto` (KH+bảng giá+thanh toán), (2) khối ĐỎ tính tiền `flex-1 min-h-0 overflow-y-auto` (tổng/voucher/khách trả/tiền thừa), (3) **footer `shrink-0`** (cảnh báo + nút Thanh toán LUÔN hiện). Vàng/Đỏ chia đôi chiều cao (~50/50), chỉ cuộn nội bộ NẾU thừa; panel KHÔNG bao giờ tràn viewport, nút Thanh toán luôn thấy. **Bài học:** muốn 2 vùng cuộn độc lập trong flex-col phải có `min-h-0` (nếu không flex item không co được → tràn).
- **Tiền khách trả DƯ — 2 lựa chọn** (migration `20260708000000_pos_overpayment_to_credit.sql`, apply remote + smoke-test rollback 2 nhánh PASS):
  - **Trả khách (mặc định):** giữ nguyên hành vi cũ — `fn_pos_settle_payment` kẹp `v_paid=LEAST(paid, grand)`, sổ quỹ = grand, không tạo nợ.
  - **Tính vào công nợ:** `p_overpay_credit=true` → KHÔNG kẹp trần, ghi `order_payments` = TOÀN BỘ tiền nhận (sổ quỹ khớp tiền thực qua trigger cashbook dùng NEW.amount), `v_debt=grand-paid` ÂM → INSERT `customer_debts` ÂM `debt_type='advance_from_customer'` (model đã hỗ trợ: comment "Âm = công ty nợ khách"). `customer_debts.amount` không có CHECK dấu; `order_payments.amount` chỉ CHECK>0 (không trần). "Nợ hiện tại" = SUM(amount unsettled) tự giảm/âm.
  - **Kỹ thuật quan trọng:** `fn_pos_settle_payment` thêm tham số thứ 4 `p_overpay_credit BOOLEAN DEFAULT false`. **DROP bản 3 tham số cũ** → lời gọi 3-arg trong `fn_complete_delivery_payment` tự resolve sang bản 4-arg với default=false (PL/pgSQL resolve runtime) → đơn GIAO HÀNG giữ nguyên "trả khách". `fn_pos_quick_sale` đọc `overpay_credit` từ payload.
  - **FE:** state `overpayToCredit` (reset `useEffect([activeTabId])` + trong resetActiveTab); toggle 2 nút chỉ hiện khi `changeDue>0 && method≠credit`; payload gửi `overpay_credit: method≠credit && changeDue>0 && overpayToCredit`. Underpay/đủ tiền giữ nguyên block "Ghi nợ/Tiền thừa".

- **BÀI HỌC apply migration qua Management API (PS 5.1):** endpoint `POST api.supabase.com/v1/projects/<ref>/database/query` body `{"query":"..."}`. **`@{query=$sql}|ConvertTo-Json` và `$sql|ConvertTo-Json` đều BỊ wrap thành `{"value":...,"Count":...}`** (quirk PS 5.1 với string) → 400. **Fix: escape JSON thủ công** (`\`→`\\`, `"`→`\"`, CR/LF/TAB) rồi `'{"query":"'+$esc+'"}'`, gửi UTF-8 bytes; đọc file bằng `Get-Content -Raw -Encoding UTF8` (không thì mojibake). Smoke-test ghi: `DO $$ ... RAISE EXCEPTION 'SMOKE_OK ...' $$` để rollback toàn bộ; JWT giả lập `set_config('request.jwt.claims','{"sub":"<uid>","role":"authenticated"}',true)`.

Liên quan: [[project-state]], [[feedback-conventions]].
