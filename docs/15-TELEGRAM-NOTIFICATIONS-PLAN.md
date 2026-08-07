# Module Trung tâm thông báo Telegram — Kế hoạch

> Soạn 2026-08-05, cập nhật 2026-08-05 sau khi user chốt phạm vi.
>
> **Mục tiêu:** chủ doanh nghiệp ngồi trên Telegram vẫn nắm được **diễn biến hoạt động
> của cả 3 chi nhánh** mà không cần mở web.
>
> **Bản chất module:** đây là **dòng tin hoạt động (activity feed)** — tường thuật việc
> đang xảy ra. Nó **không phải** hệ cảnh báo ngưỡng, và **không phải** module thu nợ.
> Digest nhắc nợ 08:30 của module `/debts` là thứ riêng, **giữ nguyên, không đụng vào**.
>
> Trạng thái: **KẾ HOẠCH — chưa viết code**.

---

## 1. Phạm vi — 7 luồng hoạt động user yêu cầu

| # | Luồng | Bảng nguồn (đã kiểm tra trong schema) |
|---|---|---|
| 1 | **Nhập hàng** (kể cả phiếu **nháp**) | `goods_receipts` + `goods_receipt_lines` |
| 2 | **Xuất hàng** (không phải bán) | `stock_movements` các loại `return_to_supplier`, `expiry_writeoff`, `damage_writeoff`, `adjustment_*`; `purchase_returns` |
| 3 | **Bán hàng** | `orders`, `order_lines`, `sales_returns` |
| 4 | **Chuyển kho** | `stock_transfers` + `stock_transfer_lines` |
| 5 | **Hóa đơn** | `invoices`, `vat_pending_sales`, `vat_issuances` |
| 6 | **Thu nợ** (sự kiện thu tiền) | `debt_payments` |
| 7 | **Chốt hoạt động cuối ngày** | tổng hợp từ 6 luồng trên |

Ngoài phạm vi: nhắc nợ / đôn đốc thu hồi (đã có ở `/debts`), CRM–pipeline, dự án chăn nuôi.

---

## 2. Hiện trạng hạ tầng (đã kiểm tra trong repo)

Hạ tầng Telegram **đã có sẵn và đang sống**, không phải làm lại từ đầu:

| Thành phần | Nơi định nghĩa | Ghi chú |
|---|---|---|
| `fn_send_telegram(p_text)` | `20260723000000_monitoring.sql:123` | pg_net POST `sendMessage`, `parse_mode=HTML`. Token + chat_id đọc từ **Vault**. Thiếu secret → no-op + ghi `app_error_logs`, không làm chết cron |
| `pg_net`, `pg_cron` | cùng file | đã `create extension` |
| Cron `monitor-integrity-daily` | `:236` | `0 1 * * *` = **08:00 VN** — toàn vẹn dữ liệu |
| Cron `debt-reminder-daily` | `20260735000000:163` | `30 1 * * *` = **08:30 VN** — **module khác, giữ nguyên** |
| `system_settings(key, value jsonb)` | `20260612000000` | nơi để cờ bật/tắt + ngưỡng |

**Giới hạn của hiện trạng:** chỉ **1 chat_id duy nhất**, chỉ **gửi theo lịch ngày**,
**không có sự kiện realtime**, không tách được chi nhánh, không có chiều ngược lại,
không có log gửi / không có retry.

---

## 3. Ràng buộc số thật — cái quyết định thiết kế

Từ số liệu vận hành đã khảo sát (`prod-usage-reality`):

- **~1.365 đơn / 30 ngày ≈ 45 đơn/ngày**
- **~2.170 giao dịch sổ quỹ / 30 ngày ≈ 72/ngày**
- 5 người dùng thật, 3 chi nhánh (Quy Nhơn / Hoài Ân / Phù Mỹ)

→ Nếu "mọi phát sinh = 1 tin" thì **hơn 150 tin/ngày**, sau 3 ngày không ai đọc.

**Nguyên tắc phân luồng rút ra — đây là ý chính của cả module:**

- **Luồng thưa** (nhập, xuất hủy, chuyển kho, hóa đơn, thu nợ: vài việc/ngày)
  → **báo từng việc**, vì mỗi việc đều đáng để chủ nhìn.
- **Luồng dày** (bán hàng: 45 đơn/ngày)
  → **gom theo nhịp giờ**, chỉ tách riêng những đơn bất thường.

Không phải "lọc bớt cho đỡ ồn" mà là "đúng độ phân giải cho từng loại việc".

---

## 4. Kiến trúc: mô hình Outbox

Không cho trigger gọi thẳng Telegram. Thay vào đó:

```
  Nghiệp vụ (POS, nhập hàng, chuyển kho, thu nợ…)
        │  AFTER INSERT/UPDATE trigger  → chỉ INSERT 1 dòng, ~0.1ms
        ▼
  notification_events   (outbox: loại, chi nhánh, payload jsonb, mức độ, trạng thái)
        │  pg_cron mỗi 1 phút: fn_notify_drain()
        │    • lọc theo notification_rules (bật/tắt, ngưỡng, giờ im lặng)
        │    • GOM nhóm (batch) theo loại + chi nhánh trong cửa sổ N phút
        │    • chống trùng (fingerprint)
        │    • soạn 1 tin gọn thay vì 20 tin lẻ
        ▼
  fn_tg_send(text, channel)  → tra telegram_channels → chat_id + message_thread_id
        ▼
  Telegram  →  ghi notification_log (req_id, http status, lỗi) → retry nếu fail
```

**Vì sao outbox, không gọi trực tiếp trong trigger:**
1. POS đang bán không được chậm đi vì Telegram. Insert 1 dòng thì an toàn tuyệt đối.
2. Gọi trực tiếp = không gom được → spam.
3. Có bảng trung gian mới **retry** được khi Telegram lỗi mạng, và mới truy vết được
   "tin này đã gửi chưa".
4. Rollback giao dịch thì dòng outbox biến mất theo → không bao giờ báo về một đơn
   thực ra đã bị huỷ giữa chừng.

**Bài học phải áp dụng:** `audit_logs` từng ngốn 60% dung lượng DB (`fix-audit-logs-bloat`)
→ `notification_events` **bắt buộc** có cron dọn 30 ngày, payload chỉ chứa **số đã tính sẵn**,
không copy cả bản ghi.

---

## 5. Bố cục kênh Telegram

**1 nhóm dạng Forum (bật Topics)**, chia chủ đề:

| Topic | Ai đọc | Nội dung |
|---|---|---|
| 📊 Tổng hợp | Chủ + admin | Chốt ngày toàn công ty, so sánh 3 chi nhánh |
| 🏢 Hoài Ân / 🏢 Phù Mỹ / 🏢 Mỹ Thành - Ân Hảo | Chủ (+ NV chi nhánh đó nếu user đồng ý) | Toàn bộ 6 luồng hoạt động **của riêng chi nhánh** |
| 🔴 Bất thường | Chủ + admin | Việc cần chủ nhìn ngay (mục 6.8) |
| ⚙️ Kỹ thuật | Chủ | Lỗi hệ thống, kết quả monitor, tin gửi hỏng |

Kỹ thuật: Telegram gọi topic bằng `message_thread_id` trên cùng một `chat_id`
→ bảng `telegram_channels(code, chat_id, thread_id, enabled, note)` thay cho việc đọc
cứng 1 secret. `fn_send_telegram` cũ **giữ nguyên chữ ký** để 3 cron hiện tại không gãy,
bên trong trỏ về `fn_tg_send(text, 'default')`.

> ⚠️ **Nguyên tắc rò rỉ thông tin:** nếu nhân viên được vào nhóm, topic chi nhánh
> **không** đưa giá vốn, lợi nhuận, công nợ của chi nhánh khác. Mô hình đã chốt là
> chi nhánh độc lập kiểu nhượng quyền (`model-multi-branch-business`). Số nhạy cảm
> chỉ vào topic Tổng hợp / Bất thường. **Đang chờ user trả lời câu 2 mục 10.**

---

## 6. Danh mục sự kiện theo từng luồng

### 6.1 Nhập hàng — `goods_receipts`
Vòng đời: `draft` → `verified` → `completed` → (`cancelled`)

| Báo khi | Cách gửi | Nội dung tin |
|---|---|---|
| Tạo phiếu **nháp** | **Gom 30 phút** | Số phiếu nháp mới, NCC, tổng tiền, ai tạo |
| `verified` (đã kiểm) | Từng phiếu | Mã phiếu, NCC, kho, số dòng, tổng tiền, người kiểm |
| `completed` (đã vào kho) | Từng phiếu | Như trên + giá trị vốn tăng thêm |
| `cancelled` | Từng phiếu | Mã phiếu + lý do + ai huỷ |

> **Vì sao nháp phải gom:** tính năng nhập từ Google Drive (`feature-gdrive-import`)
> sinh **nhiều phiếu nháp một lúc**. Báo từng cái sẽ dội hàng chục tin trong 1 phút.

**Kèm cảnh báo** → topic 🔴: giá nhập lệch **> 30%** so với lần nhập gần nhất của cùng SP.
Đây đúng là bẫy `GR-181294` đảo cột SL/đơn giá gây **31,95tr lợi nhuận ảo**
(`fix-point-in-time-cost`). Loại này đáng giá nhất trong cả module.

### 6.2 Xuất hàng (không phải bán) — `stock_movements`, `purchase_returns`
Các loại: `return_to_supplier`, `expiry_writeoff`, `damage_writeoff`,
`adjustment_increase`, `adjustment_decrease`.

Tần suất rất thấp nhưng **đây là nhóm dễ thất thoát nhất** → **báo từng việc**, kèm
**giá trị vốn** của lượng xuất, kho nào, ai thực hiện, lý do.

### 6.3 Bán hàng — `orders`, `sales_returns`

> ⚠️ **User đổi yêu cầu 2026-08-07: báo TỪNG ĐƠN ngay sau khi bán xong**, bỏ nhịp
> gom 2 giờ. Đo thật: 1.456 đơn hoàn tất/30 ngày = **48,5 tin/ngày**.

**Mỗi đơn MỘT tin, đầy đủ như hoá đơn** (user chốt 2026-08-07). Đây là lý do có
`notification_rules.compose = 'full'`: drain gửi nguyên `payload->>'text'` do trigger
soạn sẵn, không gom, không thêm tiêu đề, không chèn dấu đầu dòng.

```
🧾 DH-2026-02696
🏢 Chi nhánh Hoài Ân — kho Kho Hoài Ân
🕐 07:31 07/08/2026
👤 Khách: Huỳnh Anh Kiệt- Abio Hoài Ân
🧑‍💼 Người bán: Hoài Ân

📦 Hàng (1 dòng)
· AVA-Ampi-Coli w.s Kg  20 × 265.000đ = 5.300.000đ

────────────────
💰 TỔNG: 5.300.000đ
💳 Ghi nợ · đã trả 0đ · còn nợ 5.300.000đ
⚠️ ĐƠN GIÁ TRỊ LỚN
```

Tối đa 25 dòng hàng, dư thì "… và N dòng nữa". Tiền hiển thị **chính xác từng đồng**
(`fn_notify_vnd`), không rút gọn "5,3tr" như tin dạng danh sách.

- **⚠️ ĐƠN LỚN** — ngưỡng **5tr**. Ngưỡng 20tr ban đầu là ngưỡng chết: đơn to nhất
  30 ngày chỉ 12,89tr, p99 = 5,10tr. Ở mức 5tr có 18 đơn/30 ngày ≈ 0,6 tin/ngày.
- **⚠️ CK n%** — chiết khấu > 5% hoặc > 500k. Hiện **chưa từng chạy**: hệ thống
  không có đơn nào có chiết khấu.
- **ghi nợ** — 188/1.456 đơn có ghi nợ.
- Huỷ đơn → `sales.cancelled`; trả hàng → `sales.return` (trigger trên `sales_returns`).
- Bán dưới giá vốn / bán âm kho: luật đã có, trigger để đợt sau — cần dò giá vốn
  từng dòng, không được đặt trên đường ghi nóng của POS.

### 6.4 Chuyển kho — `stock_transfers`
Vòng đời: `draft` → `in_transit` → `received` → (`rejected` / `cancelled`),
có **bước admin duyệt** (`feature-transfer-approval`).

Tần suất thấp, **mỗi bước đều báo** vì đây là luồng cần chủ ra quyết định:

| Bước | Topic | Ghi chú |
|---|---|---|
| Tạo phiếu, **chờ admin duyệt** | 🔴 Bất thường | Chủ cần bấm duyệt — đây là việc tồn đọng |
| Admin duyệt / từ chối | 2 topic chi nhánh liên quan | Kèm **đơn giá chuyển** |
| Nhận hàng (`received`) | 2 topic chi nhánh | Xác nhận khớp/lệch số lượng |

> 🔒 Đơn giá chuyển **là giá vốn kho đích (bình quân gia quyền)** — quy tắc đã chốt,
> đừng "sửa" thành giá vốn lô nguồn (`feature-transfer-approval`).

### 6.5 Hóa đơn — `invoices`, `vat_pending_sales`, `vat_issuances`
- Phát hành hóa đơn (`invoices` sang `issued`) → từng cái: số HĐ, khách, tiền trước VAT / VAT / tổng.
- Xuất hóa đơn gộp (`vat_issuances`) → từng cái: gộp mấy đơn, tổng tiền.
- **Tồn đọng**: `vat_pending_sales` còn `pending` quá N ngày → nhắc 1 tin/ngày trong bản tin chốt.

### 6.6 Thu nợ — `debt_payments` *(sự kiện thu tiền, KHÔNG phải nhắc nợ)*
**Báo từng lần thu**, vì đây là tiền mặt vào két:

> 💰 Thu nợ · Hoài Ân · 14:32
> Khách: Trại gà Ba Tơ — **5.000.000₫**
> Người thu: Nguyễn Văn A · Vào quỹ: **Tiền mặt Hoài Ân**
> Dư nợ còn lại: 12.400.000₫

Bắt buộc hiện **"vào quỹ nào"** — hệ thống từng định tuyến sai **91% / 471tr** vào nhầm
quỹ chi nhánh (`audit-debt-cashbook-branch`). Đưa thẳng vào tin nhắn thì sai lệch lộ ra ngay.

> ⚠️ Bám `debt_payments`. **KHÔNG gắn trigger lên `customer_debts`** — 2 hàm trả hàng
> đã tự chỉnh `paid_amount`, gắn thêm sẽ đếm trùng (`fix-order-debt-vs-ar`).

### 6.7 Chốt hoạt động cuối ngày
- **17:30** (chờ user xác nhận giờ đóng cửa) — **mỗi chi nhánh 1 tin** vào topic của mình:
  doanh thu, số đơn, giá trị TB/đơn, tiền mặt / CK / ghi nợ, thu nợ trong ngày,
  nhập hàng trong ngày, top 5 SP bán chạy.
- **17:45** — **1 tin tổng công ty** vào 📊 Tổng hợp: 3 chi nhánh so nhau, so cùng kỳ
  tuần trước, tồn đọng cần xử lý (phiếu chuyển chờ duyệt, HĐ chưa xuất, phiếu nhập nháp treo).

### 6.8 Ước lượng khối lượng tin

| Nhóm | Tin/ngày |
|---|---|
| Nhịp bán hàng (3 CN × ~5 nhịp) | ~15 |
| Nhập hàng | ~3 |
| Chuyển kho | ~4 |
| Thu nợ | ~5 |
| Hóa đơn | ~2 |
| Xuất hủy / điều chỉnh | ~1 |
| Bất thường | ~5 |
| Chốt ngày | 4 |
| **Tổng** | **~39 tin/ngày, chia trên 6 topic** |

Mỗi topic ~6 tin/ngày — đọc được. So với 150+ tin nếu báo từng phát sinh.

---

## 7. Cơ chế chống spam

Mỗi loại sự kiện trong `notification_rules` có:

| Cột | Ý nghĩa |
|---|---|
| `enabled` | bật/tắt riêng từng loại |
| `severity` | `critical` / `warn` / `info` |
| `channel_code` | gửi vào topic nào |
| `threshold` jsonb | ngưỡng riêng của loại đó |
| `batch_window_sec` | gom sự kiện cùng loại trong N giây thành 1 tin |
| `min_interval_sec` | chống dội: cùng loại + cùng chi nhánh không gửi lại trong N giây |
| `quiet_hours` | 22:00–06:00 chỉ cho qua `critical`, còn lại dồn vào bản tin sáng |
| `daily_cap` | trần tin/ngày của loại đó; vượt thì gộp "…và N việc tương tự" |

Hai chốt an toàn cấp hệ thống:
- **Kill-switch toàn cục** `system_settings.notification_config.enabled` — tắt ngay, không cần deploy.
- **Trần toàn cục ~200 tin/ngày**; chạm trần thì tự dừng và gửi đúng 1 tin báo vào ⚙️ Kỹ thuật.

---

## 8. Phân đợt triển khai

| Đợt | Nội dung | Sản phẩm | Ước lượng |
|---|---|---|---|
| **0** | **Việc của user**: tạo nhóm forum + topic, thêm bot làm admin, lấy `chat_id` + `thread_id` | — | ~20 phút |
| **1** | ✅ **LIVE** `20260758000000_notification_center_core.sql`. 4 bảng (`telegram_channels`, `notification_events`, `notification_rules`, `notification_log`), `fn_tg_send` / `fn_notify_emit` / `fn_notify_drain` (advisory lock + thu kết quả pg_net + trần retry) / `fn_notify_prune` / `fn_notify_test`, cron 1 phút + cron dọn 30 ngày, kill-switch, seed 22 luật cho 7 luồng | 1 migration | ~½ ngày |
| **2** | ✅ **LIVE** `20260760000000_notify_triggers_low_volume.sql`: 5 trigger (nhập hàng, xuất hàng, chuyển kho, hóa đơn, thu nợ) + dò **giá nhập bất thường**. Đo thật: 17 việc/ngày, cảnh báo giá 0,4 tin/ngày | 1 migration | ~½ ngày |
| **3** | ✅ **LIVE** `20260761` + `20260762`: báo **từng hành động, độ trễ ~15 giây** (cron xuống `15 seconds`). Thêm trigger `orders`, `cashbook_transactions`, `sales_returns`; bỏ nhịp gom; nới `daily_cap`; nhãn tiếng Việt; ngưỡng đơn lớn 5tr | 2 migration | ~½ ngày |
| **A** | ✅ **LIVE** `20260768`: nền **kênh khách hàng** — `customers.telegram_chat_id` / `branches.telegram_chat_id` ("idtlg"), `notification_rules.audience` (`internal`\|`customer`) là ranh giới chống lộ giá vốn, `fn_notify_target()` là cửa duy nhất giải đích đến, lưu `tg_message_id`, tự tắt nhóm chết khi 403 | 1 migration | ~½ ngày |
| **B** | ✅ **LIVE** `20260769` + `20260770`: 4 lớp chống tin sai — hoãn `delay_sec` · `subject_key` đè bản chưa gửi · **`fn_tg_edit()` sửa lại tin đã gửi** · chế độ khô. Kèm quy tắc **nhóm thử phải là nhóm nội bộ** + `fn_notify_config_audit()` | 2 migration | ~1 ngày |
| **C** | ✅ **LIVE** `20260771` + `20260772`: **phiếu giao hàng gửi khách** (`sales.order_customer`, hoãn 10 phút) — hàng hoá, tiền thu, công nợ hiện tại; không giá vốn/lợi nhuận. Kèm vá **số lượng thập phân bị làm tròn** | 2 migration | ~½ ngày |
| **E** | ✅ **LIVE** `20260773`→`20260776` + FE: **nút ✈️ gửi khuyến mãi vào nhóm Telegram**. Modal 3 bước xem trước / gửi thử nội bộ / gửi thật. Trần 1 tin/khách/7 ngày, có opt-out, tách trần tốc độ theo từng nhóm vs toàn bot, thêm `sendPhoto` | 4 migration + FE | ~1 ngày |
| **F** | ⏳ **VIỆC CỦA USER**: xây phác đồ vaccine cho gà thịt và heo thịt | — | — |
| **G** | Cron nhắc lịch vaccine gửi nhóm khách + nhóm chi nhánh | 1 migration | ~1 ngày |
| **4** | Chốt ngày 17:30 theo chi nhánh + 17:45 tổng công ty | 1 migration | ~¼ ngày |
| **5** | Trang `/system-settings` → tab **Thông báo**: bật/tắt từng loại, chỉnh ngưỡng, chọn kênh, xem log gửi, nút **Gửi thử** | FE | ~½ ngày |
| **6** | Edge Function `telegram-bot` (2 chiều: `/doanhthu`, `/quy`, `/ton`, `/donhang` + **nút duyệt phiếu chuyển kho**) | Edge Function + migration | ~1 ngày |

**Đã xong:** 1, 2, 3 (nội bộ) và A, B, C, E (kênh khách + khuyến mãi).
**Đường găng còn lại là F** — không có phác đồ vaccine thì G không có gì để nhắc.
Đợt 4, 5, 6 là tiện nghi, có thể lùi.

---

## 9. Kênh khách hàng — mô hình đã chốt

Mỗi khách và mỗi chi nhánh có **một nhóm Telegram riêng do user tạo tay**, trong nhóm
có khách + chủ + kế toán. Bot gửi được vào nhóm mà khách **không cần bấm Start** — đây
là cách hợp lệ vượt hạn chế "bot không nhắn trước".

> 🔴 **Bot KHÔNG tạo được nhóm** — Bot API không có hàm này, chỉ tài khoản người thật mới
> tạo được. Tự động hoá bằng userbot MTProto sẽ bị Telegram khoá tài khoản. Đừng đề xuất.

**Ba loại tin gửi khách (user chốt):**
1. Phiếu giao hàng — hàng hoá, tiền thu, công nợ hiện tại ✅
2. Nhắc lịch vaccine — chờ đợt F
3. Khuyến mãi broadcast ✅

> 🔴 **KHÔNG gửi tin "nhắc công nợ đến hạn"** — user nói nhạy cảm. Hiện số dư trong
> phiếu giao thì được (nó là một phần của biên nhận), tin đòi nợ độc lập thì không.

**Vì sao không dùng Zalo:** ZNS là kênh duy nhất khả thi cho khách đại trà ở Việt Nam
(~200–600đ/tin, ~320k/tháng cho 1.069 đơn) nhưng cần OA xác thực bằng giấy phép kinh
doanh, template duyệt trước, và refresh token mỗi giờ. Telegram thắng ở: miễn phí, nội
dung tự do, **hai chiều**, và **sửa/xoá được tin đã gửi** — SMS/ZNS bắn đi là vĩnh viễn.
Tạm gác, chưa loại bỏ.

---

## 9. Rủi ro & bẫy đã biết

1. **Trigger làm chậm POS** → outbox chỉ INSERT; tuyệt đối không gọi `net.http_post`
   trong trigger nghiệp vụ.
2. **Trigger phải truy vấn phụ mới quyết định gửi** (vd. so giá nhập gần nhất ở 6.1)
   → trigger **chỉ ghi thô**, để `fn_notify_drain` tính ngưỡng **ngoài** transaction.
3. **Phình DB** → cron dọn 30 ngày, payload chỉ chứa số đã tính. (Bài học `audit_logs`.)
4. **KHÔNG gắn trigger lên `customer_debts`** → bám `debt_payments` (`fix-order-debt-vs-ar`).
5. **Import Google Drive dội tin nháp** → luồng 6.1 bắt buộc gom 30 phút.
6. **Rò rỉ chéo chi nhánh** → chốt ở `notification_rules.channel_code` + soạn nội dung theo topic.
7. **pg_net bất đồng bộ** → `net.http_post` chỉ trả `req_id`; kết quả ở `net._http_response`,
   **tự xoá sau ~6 giờ**. Drainer phải có lượt "thu kết quả" ở vòng kế tiếp.
   Hiện `fn_send_telegram` **không** làm việc này → **đang có khả năng gửi hỏng mà không ai biết**.
8. **Giới hạn Telegram**: ~20 tin/phút/nhóm; tin > 4096 ký tự bị từ chối → drainer tự cắt "(1/2)".
9. **Trùng tin khi retry** → mỗi sự kiện có `fingerprint` duy nhất; gửi thành công thì đánh dấu.
10. **Bảo mật webhook (đợt 6)** → kiểm `X-Telegram-Bot-Api-Secret-Token`, whitelist `chat_id`,
    ánh xạ `telegram_user_id → profiles` để **áp đúng RBAC**; giữ **privacy mode BẬT** cho bot.

---

## 10. Ngân sách hiệu năng

Ở quy mô 45 đơn + 72 giao dịch quỹ/ngày, module này **rẻ hơn `audit_logs` một bậc**:

| Đường | Chi phí thêm | Đánh giá |
|---|---|---|
| Ghi đơn ở POS (trigger → INSERT outbox) | ~0,05–0,15 ms/đơn | Một đơn đã ghi ~25–30 dòng qua 8 bảng → **+1–3%**, dưới mức nhiễu |
| Cron drain mỗi 1 phút | ~20–50 ms × 1.440 lượt/ngày | Duty cycle ~0,05% CPU |
| Dung lượng DB | ~2–4 MB ổn định | DB đang 101 MB → thêm ~3% |
| Egress | ~9 MB/tháng | Không đáng kể |

**4 điều kiện bắt buộc để giữ được con số trên:**

1. **Partial index** trên outbox — nếu không, cron seq-scan 1.440 lần/ngày:
   ```sql
   create index on notification_events (created_at) where status = 'pending';
   ```
   Partial → index chỉ to bằng số dòng đang chờ (gần 0).
2. **Advisory lock** trong `fn_notify_drain` — Telegram treo > 60s thì pg_cron khởi lượt
   thứ hai song song → gửi trùng + tranh khoá. Không lấy được `pg_try_advisory_lock` thì return ngay.
3. **Trần retry** — cấu hình sai chat_id mà retry vô hạn = 1.440 request/ngày vào Telegram
   → bot bị rate-limit. Tối đa 5 lần, backoff tăng dần, quá thì đánh `failed` + báo 1 tin vào ⚙️ Kỹ thuật.
4. **Kỷ luật payload** — chỉ số đã tính sẵn. Copy cả bản ghi đơn + dòng đơn vào jsonb
   sẽ làm bảng phình gấp 10 lần.

---

## 11. Câu hỏi cần user chốt

1. **Nhân viên chi nhánh có được vào nhóm không?** → quyết định có được đưa giá vốn /
   lợi nhuận vào tin nhắn hay không. **Đây là câu chặn thiết kế.**
2. **Ngưỡng cụ thể**: đơn lớn > bao nhiêu? Xuất hủy > bao nhiêu thì báo? Thu nợ có báo
   mọi khoản hay chỉ từ N₫ trở lên? (Số trong tài liệu mới là đề xuất.)
3. **Giờ**: nhịp bán hàng mỗi 2 giờ có hợp lý không? Chốt ngày 17:30 có khớp giờ đóng
   cửa thực tế của cả 3 chi nhánh không?
4. **Phiếu nhập nháp**: báo tất cả, hay chỉ báo nháp do người tạo tay (bỏ qua nháp
   sinh tự động từ Google Drive)?
5. **Bot**: dùng lại bot đang chạy digest công nợ hay tạo bot mới riêng?
6. **Có làm đợt 6 (2 chiều) không?** Nếu có, ưu tiên tra cứu bằng lệnh hay **nút duyệt
   phiếu chuyển kho**?

---

## 12. Thông tin user cần cung cấp

**Để làm đợt 1–4:**
- `chat_id` của nhóm (số âm, dạng `-100…`) + `message_thread_id` của từng topic.
  Cách lấy: bật Topics → tạo các topic → thêm bot **làm admin** → gõ 1 tin trong mỗi
  topic → mở `https://api.telegram.org/bot<TOKEN>/getUpdates` → đọc `chat.id` và
  `message_thread_id`. (Rỗng thì gọi `/deleteWebhook` trước.)
- Trả lời 6 câu ở mục 11.
- `SUPABASE_ACCESS_TOKEN` để apply migration lên prod (ref `gdotgcrtivjdpkcchrro`).

**Chỉ cho đợt 6:** `telegram_user_id` của từng người được ra lệnh cho bot + họ ứng với
tài khoản nào trong hệ thống.

> 🔒 **Đừng dán bot token vào chat.** Nếu cần nạp token mới, tự chạy trong Supabase
> SQL Editor: `select vault.create_secret('<token>', 'telegram_bot_token_v2');`
> rồi chỉ báo tên secret. `chat_id` / `thread_id` không phải bí mật.
