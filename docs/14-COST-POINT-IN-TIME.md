# 14 — Giá vốn theo thời điểm (point-in-time cost)

> Migration `20260752000000_point_in_time_cost.sql` — apply prod 2026-08-03.
> Thuần DB, không đụng FE.

## Nguyên tắc

**Mọi chuyển động kho — xuất, bán, trả — mang giá vốn tại thời điểm phát sinh.**
Giá vốn đã ghi cho một giao dịch là bất biến: không bao giờ đi đọc lại giá hiện hành
của lô. Nhờ vậy lợi nhuận kỳ đã chốt không thể tự đổi số, và giá nhập trung bình của
lô mới có nghĩa.

**Gộp lô:** cùng `(product_id, lot_number, warehouse_id, is_vat)` thì bình quân gia
quyền; khác bất kỳ khóa nào là hai dòng riêng. Chính sách "bán 10 tặng 3" nhập cùng lô
→ 13 SP ở giá bình quân; nhập khác lô → 1 dòng 10 SP có giá + 1 dòng 3 SP giá 0.

## Công thức COGS

```
COGS(dòng đơn) = Σ( ola.quantity × ola.unit_cost )          -- giá CHỤP lúc trừ kho
               + (SL chưa phân bổ) × retail_cost            -- dự phòng, giá hiện hành
```

- `order_line_allocations.unit_cost` — chụp khi trigger trừ kho, cả nhánh lô-chọn-tay
  lẫn FEFO. Đây là nguồn sự thật.
- View đọc `COALESCE(ola.unit_cost, sl.cost_price)` để dòng cũ chưa backfill vẫn chạy.
- `unalloc_qty` (cột mới trên `v_order_line_profit` / `_ext`) = SL bán không truy được
  lô. **Dùng nó để phân biệt "giá vốn 0 thật" (hàng tặng) với "không biết giá vốn".**
  Không có nó thì cả hai đều ra biên 100% và trông y hệt nhau.

## Bình quân gia quyền khi gộp lô

```sql
cost_price = CASE
  WHEN (GREATEST(cũ.qty,0) + mới.qty) > 0
    THEN ROUND((GREATEST(cũ.qty,0)*cũ.cost + mới.qty*mới.cost)
               / (GREATEST(cũ.qty,0) + mới.qty), 2)
  ELSE mới.cost
END
```

`GREATEST(qty,0)` là chỗ quan trọng: **lô đã rỗng thì giá lần nhập mới thắng hoàn toàn**.
Đây chính là ca cần phục hồi sau khi trả nhà cung cấp rồi nhập lại.

## Bẫy đã sập, đừng lặp lại

1. **`ON CONFLICT DO UPDATE` bỏ quên `cost_price`.** Lỗi này có ở **cả 7 chỗ** upsert
   `stock_lots` từ `20260522` tới `20260715`: cộng số lượng, giữ giá của dòng chạy trước.
   Thêm dòng nhập mới vào lô cũ mà không cập nhật giá là làm sai giá trị tồn kho.
2. **Vòng lặp dòng phiếu nhập không `ORDER BY`.** Kết quả phụ thuộc thứ tự vật lý của
   heap — sửa một dòng là lật giá vốn cả lô. Luôn `ORDER BY created_at, id`.
3. **Ghi giá BÁN vào cột giá vốn.** `fn_sales_return_apply_effects` từng đưa
   `sales_return_lines.unit_price` vào `stock_movements.unit_cost`. Hai đại lượng khác nhau.
4. **Phiếu nhập 0₫ xoá giá vốn bảng giá.** Trigger đồng bộ nay bỏ qua dòng `unit_price = 0`
   — hàng tặng không được phép kéo giá vốn sản phẩm về 0.
5. **Đảo cột số lượng ↔ đơn giá khi nhập.** Đã xảy ra thật (`GR-181294`, 10/07/2026, nhập
   từ Google Drive): `line_total` vẫn đúng vì phép nhân giao hoán, nên **tổng tiền phiếu
   không phát hiện được lỗi**. Dấu hiệu nhận biết: số lượng có phần thập phân lẻ nhiều
   chữ số ở mặt hàng bán theo lọ/chai.

## Chưa làm

- `unalloc_qty` mới ở tầng view, **chưa hiện lên `/reports/profit`** — muốn có bộ lọc
  "thiếu giá vốn" phải đổi chữ ký các `fn_profit_*` và sửa FE.
- `fn_reverse_order_effects` (hoàn kho khi sửa/huỷ đơn) chưa ghi `unit_cost`.
- Lịch sử trước 03/08/2026 **không được sửa**: backfill đặt `unit_cost` = giá lô tại thời
  điểm migration, nên báo cáo giữ nguyên số. Các lô gộp sai giá từ trước vẫn sai.
