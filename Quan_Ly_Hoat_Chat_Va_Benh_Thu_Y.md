# TÀI LIỆU THIẾT KẾ TÍNH NĂNG: QUẢN LÝ HOẠT CHẤT VÀ BỆNH THÚ Y
*(Hệ thống kết nối Kỹ thuật Dịch tễ & Hành vi Mua hàng Thương mại)*

---

## PHẦN 1: MODULE QUẢN LÝ HOẠT CHẤT (ACTIVE INGREDIENTS MULTI-SYSTEM)

### 1.1. Cơ sở dữ liệu gốc (Master Data Management - MDM)
Nơi khai báo toàn bộ thông tin mang tính chất "lý lịch" của từng hoạt chất lưu hành trong ngành thú y.

* **Thông tin định danh:**
    * **Mã hoạt chất (ID):** Mã hóa tự động theo nhóm (Ví dụ: `KS-AMO` cho Amoxicillin).
    * **Tên hoạt chất gốc (Generic Name):** Tên quốc tế (ví dụ: *Florfenicol, Ivermectin, Tylosin*).
    * **Nhóm dược lý:** Kháng sinh (Beta-lactam, Macrolide, Aminoside...), Hạ sốt/Giảm đau, Kháng viêm (NSAID/Corticoid), Ký sinh trùng, Bổ trợ/Điện giải.
* **Chỉ số kỹ thuật & An toàn:**
    * **Hàm lượng/Nồng độ tiêu chuẩn:** Định dạng định lượng cơ bản phổ biến.
    * **Thời gian ngưng thuốc (Withdrawal Time):** Số ngày cần dừng thuốc trước khi giết mổ/khai thác sữa, trứng (Yếu tố cực kỳ quan trọng trong chăn nuôi an toàn sinh học).
    * **Chống chỉ định & Độc tính:** Cảnh báo nguy hiểm (Ví dụ: *Tilmicosin* độc cho ngựa và người; *Monensin* gây độc cho ngựa).

### 1.2. Ma trận Phối hợp thuốc (Synergy & Antagonism)
Thiết lập các quy tắc tương tác giữa các hoạt chất để hệ thống tự động kiểm tra khi kê đơn hoặc lên combo sản phẩm.

* **Cấu hình Hiệp lực (Synergy):** Các cặp hoạt chất hỗ trợ làm tăng hiệu quả điều trị của nhau.
    * *Ví dụ cấu hình:* `Amoxicillin` + `Acid Clavulanic` (Chống kháng thuốc); `Tylosin` + `Doxycycline` (Mở rộng phổ kháng khuẩn đường hô hấp).
    * *Ứng dụng:* Hệ thống tự động gợi ý thêm hoạt chất hiệp lực khi nhân viên chọn hoạt chất đơn lẻ.
* **Cấu hình Đối kháng/Kỵ nhau (Antagonism):** Các cặp hoạt chất làm giảm tác dụng của nhau hoặc tạo độc tính khi dùng chung.
    * *Ví dụ cấu hình:* Kháng sinh kìm khuẩn `Doxycycline` kỵ với kháng sinh diệt khuẩn `Penicillin`.
    * *Ứng dụng:* Hệ thống lập tức **BẬT CẢNH BÁO ĐỎ** nếu nhân viên lên đơn hàng chứa 2 sản phẩm kỵ nhau cho cùng một đàn vật nuôi.

### 1.3. Liên kết Hoạt chất $ightarrow$ Sản phẩm thương mại
Cầu nối chuyển đổi từ thuật ngữ chuyên môn sang dữ liệu kinh doanh hàng hóa.

* **Khai báo Thành phần SKU:** Khi cấu hình một mã sản phẩm thương mại, bắt buộc phải chọn hoạt chất tương ứng và tỷ lệ % hàm lượng.
    * *Ví dụ:* Sản phẩm `Hado-Flo 45%` $ightarrow$ Gồm hoạt chất: `Florfenicol` (Hàm lượng 45%).
* **Cơ chế Sản phẩm thay thế (Alternative Products Engine):**
    * Khi khách hàng tìm kiếm một sản phẩm nhưng trong kho đã hết (hoặc nhà sản xuất đứt hàng), hệ thống dựa vào cấu trúc hoạt chất để lọc ra các sản phẩm khác có **cùng hoạt chất và hàm lượng tương đương**.
    * *Lợi ích:* Nhân viên bán hàng giữ được khách, tăng tỷ lệ chốt đơn ngay cả khi cháy hàng cục bộ.

---

## PHẦN 2: MODULE QUẢN LÝ BỆNH VẬT NUÔI (PATHOLOGY & DIAGNOSIS ENGINE)

### 2.1. Cơ sở dữ liệu gốc về Bệnh (Disease Profiling)
Cấu trúc danh mục bệnh lý dựa trên cấu trúc phân loại thú y lâm sàng.

* **Phân loại theo Đối tượng vật nuôi (Species Classification):** Gia súc (Heo, trâu, bò), Gia cầm (Gà lông màu, gà đẻ, vịt, chim cút), Thú cưng (Chó, mèo).
* **Phân loại theo Nguyên nhân dịch tễ (Etiology):**
    * *Do Vi khuẩn:* E.coli, Salmonella, Pasteurella (Tụ huyết trùng)...
    * *Do Virus:* ASF (Dịch tả heo Châu Phi), PRRS (Tai xanh), Newcastle, Gumboro...
    * *Do Ký sinh trùng:* Cầu trùng, Ký sinh trùng đường máu, Giun sán.
    * *Do Môi trường/Dinh dưỡng:* Sốc nhiệt (Heat stress), Ngộ độc độc tố nấm mốc trong thức ăn.
* **Hệ thống dấu hiệu lâm sàng (Symptom Checklist):** Bộ từ điển triệu chứng trực quan: *Ho bụng, Thở thể chó ngồi, Tiêu chảy phân trắng, Xuất huyết da, Ngoẹo cổ...*

### 2.2. Ma trận Phác đồ điều trị (Disease-to-Ingredient Mapping)
Nơi các chuyên gia kỹ thuật thú y số hóa phác đồ điều trị thành thuật toán để máy tính có thể hiểu và vận hành.

* **Cấu hình Phác đồ Đa tầng (Multi-stage Protocol):** Một bệnh lý luôn được điều trị bằng một tổ hợp hoạt chất theo các vai trò:
    1.  **Hoạt chất Đặc trị (Tiêu diệt nguyên nhân):** Thường là Kháng sinh (nếu là bệnh vi khuẩn) hoặc thuốc kiểm soát nhiễm trùng kế phát (nếu là bệnh virus).
    2.  **Hoạt chất Bổ trợ Triệu chứng (Giảm tác hại):** Hạ sốt (Paracetamol), Kháng viêm/Giảm phù nề (Flunixin/Dexamethasone), Long đờm (Bromhexine).
    3.  **Hoạt chất Nâng cao Đề kháng (Hồi phục):** Vitamin C, Điện giải, Acid hữu cơ, Beta-glucan.
* **Phân cấp mức độ ưu tiên điều trị (Treatment Lines):**
    * *Ưu tiên 1 (Line 1):* Phác đồ tối ưu nhất về hiệu quả và chi phí.
    * *Ưu tiên 2 (Line 2):* Phác đồ thay thế khi phát hiện vùng nuôi có dấu hiệu lờn thuốc/kháng thuốc với nhóm hoạt chất ở Ưu tiên 1.

---

## PHẦN 3: SỰ KẾT NỐI VÀ HÀNH VI MUA HÀNG CỦA KHÁCH HÀNG

Điểm cốt lõi của hệ thống là biến các dữ liệu chuyên môn ở Phần 1 & Phần 2 thành các hành động tự động hóa, tối ưu hóa doanh thu và hành vi mua sắm của khách hàng (Đại lý, Trang trại).

```
[Bệnh xuất hiện / Triệu chứng] 
       │
       ▼ (Hệ thống tự động tra cứu)
[Hoạt chất phù hợp theo Phác đồ] 
       │
       ▼ (Hệ thống tự động lọc kho)
[Combo Sản phẩm thương mại] 
       │
       ▼ (Gợi ý cho người dùng)
[Đơn hàng hoàn chỉnh (Upsell/Cross-sell)] ──> [Lưu trữ hành vi & Dự báo dịch tễ]
```

### 3.1. Tính năng Chẩn đoán nhanh & Tự động tạo Giỏ hàng (Smart Cart Suggestion)
* **Kịch bản vận hành:** Nhân viên Sales hoặc Kỹ thuật đi thực địa tại trang trại, mở ứng dụng và tích chọn: `Vật nuôi: Heo thịt` $ightarrow$ `Triệu chứng: Ho bụng, Sốt cao, Tai tím`.
* **Hệ thống xử lý:** Nghi ngờ bệnh *Viêm phổi dính sườn (APP)* $ightarrow$ Truy xuất phác đồ hoạt chất (*Ceftiofur* + *Flunixin* + *Bromhexine*) $ightarrow$ Tự động cấu hình ra **Giỏ hàng gợi ý** gồm:
    1.  Chai thuốc tiêm đặc trị `Sản phẩm A` (chứa Ceftiofur).
    2.  Chai thuốc bổ trợ triệu chứng `Sản phẩm B` (chứa Flunixin Meglumine).
    3.  Gói bột trộn hạ sốt, long đờm `Sản phẩm C` (chứa Paracetamol + Bromhexine).
* **Hiệu quả kinh doanh:** Thay vì chỉ bán 1 chai kháng sinh đơn lẻ theo thói quen cũ, hệ thống ép nhân viên bán hàng phải tư vấn theo **Combo Phác đồ**. Giúp tăng chỉ số Giá trị đơn hàng trung bình (AOV), đồng thời đảm bảo trại điều trị khỏi bệnh triệt để.

### 3.2. Bản đồ Dịch tễ Dự báo sức mua (Epidemiology Big Data)
* **Thu thập hành vi:** Khi tạo đơn hàng trên hệ thống, bắt buộc nhân viên hoặc khách hàng phải chọn trường thông tin `Mục đích điều trị / Tên bệnh`.
* **Phân tích AI/Biểu đồ:** Hệ thống liên tục quét dữ liệu mua hàng theo thời gian thực. Nếu phát hiện trong vòng 7-10 ngày, lượng mua các sản phẩm chứa hoạt chất *Sulfamonomethoxine* và *Toltrazuril* tăng đột biến 200% tại một khu vực địa lý (ví dụ: Huyện Chợ Gạo, Tiền Giang).
* **Hành động tự động:** Hệ thống kết luận khu vực này đang nổ dịch *Ký sinh trùng đường máu và Cầu trùng trên gà*. Ngay lập tức gửi thông báo đẩy (Push Notification) đến tất cả nhân viên kinh doanh đang phụ trách các huyện lân cận: *"Dịch ký sinh trùng đang lan rộng tại Chợ Gạo, hãy chủ động tiếp cận các trại tại khu vực của bạn để chào hàng phòng bệnh bằng các hoạt chất tương ứng"*.

### 3.3. Cá nhân hóa CRM và Quản lý vòng đời khách hàng (Customer Health Timeline)
* **Hồ sơ bệnh án của Trại:** Mỗi khách hàng (Trại nuôi/Đại lý) sẽ có một trục thời gian lịch sử dịch tễ riêng biệt được tích hợp vào CRM.
* **Tính năng Nhắc lịch thông minh (Automation Triggers):**
    * Hệ thống ghi nhận khách hàng X vừa mua hoạt chất *Diclazuril* (Phòng cầu trùng) cho lứa gà 10 ngày tuổi. 
    * Dựa vào đặc điểm sinh học của bệnh, hệ thống tự động thiết lập một tác vụ (Task) sau 14 ngày nhắc nhở nhân viên chăm sóc khách hàng gọi điện: *"Gà nhà anh/chị đã đến giai đoạn tái chủng/phòng nhắc lại, anh/chị có cần giao thêm sản phẩm bổ trợ đường ruột không?"*.
* **Theo dõi Kháng thuốc:** Nếu lịch sử cho thấy Trại Y đã mua hoạt chất *Enrofloxacin* liên tục 3 lứa nuôi gần nhất cho bệnh tiêu chảy. Đến lứa thứ 4, nếu họ tiếp tục đặt mua hoạt chất này, hệ thống sẽ cảnh báo nhân viên bán hàng: *"Trại này có nguy cơ kháng thuốc cao với Enrofloxacin, hãy tư vấn hướng họ chuyển sang dùng hoạt chất Apramycin hoặc Colistin để đạt hiệu quả"*.
