# SANH LONG CRM/ERP — LAYOUT SPECIFICATION

> **Phiên bản:** 1.0 · **Ngày:** 22/05/2026
> **File này phụ thuộc:** `01-FUNCTIONAL-SPEC.md` (đọc file đó trước để hiểu business rules)
> **Đối tượng đọc:** designer (dùng Stitch/Figma sinh mockup) + frontend dev (implement components)

---

## MỤC LỤC

1. [Triết lý thiết kế](#1-triết-lý-thiết-kế)
2. [Design tokens & Palette](#2-design-tokens--palette)
3. [Typography](#3-typography)
4. [Spacing, Radius, Shadow](#4-spacing-radius-shadow)
5. [Iconography](#5-iconography)
6. [Component library](#6-component-library)
7. [Layout shell — Desktop & Mobile](#7-layout-shell)
8. [Trang Auth & Onboarding](#8-trang-auth--onboarding)
9. [Dashboard](#9-dashboard)
10. [Module Khách hàng — wireframe](#10-module-khách-hàng)
11. [Module Sản phẩm & Giá](#11-module-sản-phẩm--giá)
12. [Module Kho, NCC, Nhập hàng](#12-module-kho-ncc-nhập-hàng)
13. [Module POS & Đơn hàng](#13-module-pos--đơn-hàng)
14. [Module Sổ quỹ](#14-module-sổ-quỹ)
15. [Module Pipeline, Hoạt động, Dự án đàn](#15-module-pipeline-hoạt-động-dự-án-đàn)
16. [Module Báo cáo](#16-module-báo-cáo)
17. [Global Search & Notifications](#17-global-search--notifications)
18. [Module Quản trị](#18-module-quản-trị)
19. [Responsive rules](#19-responsive-rules)
20. [Accessibility](#20-accessibility)
21. [Hướng dẫn dùng với Stitch](#21-hướng-dẫn-dùng-với-stitch)

---

## 1. TRIẾT LÝ THIẾT KẾ

### 1.1. Định hướng tổng

**"Minimalism + Clean + Trustworthy"** — không glassmorphism, không dark/neon, không Material 3 loè loẹt. Cảm giác như một dashboard ngân hàng đơn giản nhưng đẹp.

Lý do:
- Người dùng chính 30–55 tuổi, không quen UI "trendy"
- Sản phẩm liên quan tiền, tồn kho, sức khoẻ vật nuôi — cần cảm giác đáng tin cậy
- Chạy trên màn hình điện thoại Android tầm trung ở trại — không hiệu ứng nặng

### 1.2. 5 nguyên tắc xương sống

1. **Một màu accent duy nhất** — xanh dương trung `#1E5A9C`. Không dùng nhiều màu cảnh báo (đỏ/vàng/cam) — dùng icon + label.
2. **Whitespace nhiều hơn cần thiết.** Padding card 24px desktop, 16px mobile. Khoảng cách field 16-20px.
3. **Hierarchy bằng size + weight, không bằng màu.** Title 20px Semibold (600). Body 14-15px Regular (400). Caption 12-13px text-secondary.
4. **Card có border 1px, không có shadow** (hoặc shadow cực nhẹ rgba 0.04). Tránh skeuomorphism.
5. **Mọi tương tác có feedback rõ** — hover, focus, active state phân biệt được. Loading state có skeleton, không spinner trừ khi cần.

### 1.3. Khác biệt so với version Firebase cũ

Trong file Firebase trước có nói "Glassmorphism + backdrop-blur". **Bỏ hết.** Thực tế:
- Backdrop-blur làm Android tầm trung lag
- Glass card khó đọc trên ánh sáng mạnh ngoài trại
- Border 1px + bg trắng đặc đẹp + ổn định hơn

---

## 2. DESIGN TOKENS & PALETTE

### 2.1. Color palette

#### Primary (accent — xanh dương trung)

```
--blue-50:   #EEF4FB
--blue-100:  #D6E4F4
--blue-200:  #AEC9E9
--blue-300:  #7BA6D8
--blue-400:  #4D85C5
--blue-500:  #1E5A9C  ← PRIMARY (màu chủ đạo)
--blue-600:  #194B82
--blue-700:  #143C69
--blue-800:  #0F2E51
--blue-900:  #0A1F38
```

**Cách dùng:**
- `blue-500` — button primary bg, link, focus ring, active nav item
- `blue-600` — button primary hover
- `blue-700` — button primary active (pressed)
- `blue-50` — bg subtle hover trên row, bg badge xanh
- `blue-100` — border subtle accent
- `blue-700/800` — text on light bg khi cần emphasis

#### Neutrals (grayscale — warm-leaning)

```
--gray-0:    #FFFFFF   bg surface (card)
--gray-25:   #FAFBFC   bg page (slightly off-white)
--gray-50:   #F4F6F8   bg page alt, hover row
--gray-100:  #E5E9EE   border default
--gray-200:  #CCD3DB   border emphasis
--gray-300:  #A8B2BD   text disabled, divider strong
--gray-400:  #6B7785   text-tertiary (caption)
--gray-500:  #4A5663   text-secondary
--gray-600:  #2F3947   text-primary on light
--gray-700:  #1F2731   text-emphasized headings
--gray-900:  #0D131B   text on bright (rare)
```

#### Semantic colors (rất hạn chế dùng)

```
--success-500:  #2E7D5B   (xanh lá đậm — chỉ dùng cho chấm tròn status đã thanh toán, completed)
--warning-500:  #B8722C   (cam mật ong — chỉ cho icon "lưu ý", không tô background)
--danger-500:   #B23A3A   (đỏ trầm — CHỈ dùng cho text confirm dialog xoá, không dùng cho button)
--info-500:     #1E5A9C   (= primary)
```

**Quy tắc cứng:**
- Status badge **không** tô màu nền semantic. Dùng `bg-gray-50 text-gray-700 border-gray-200` + icon nhỏ phía trước.
- Ví dụ "Đã quá hạn" → icon `Clock` 14px + text "Quá hạn" + background xám nhạt. KHÔNG `bg-red-100 text-red-700`.
- Lý do: nhiều trạng thái cùng lúc nếu tô màu sẽ rối; icon đủ phân biệt.

#### Color usage matrix

| UI element | Background | Text | Border |
|---|---|---|---|
| Page | `gray-25` | `gray-600` | — |
| Card / Surface | `gray-0` | `gray-600` | `gray-100` 1px |
| Card hover | `gray-50` | `gray-600` | `gray-200` 1px |
| Primary button | `blue-500` | `gray-0` | none |
| Primary button hover | `blue-600` | `gray-0` | none |
| Ghost button | transparent | `blue-500` | `gray-200` 1px |
| Ghost button hover | `blue-50` | `blue-600` | `blue-200` 1px |
| Destructive (xoá) | `gray-0` | `gray-600` + icon | `gray-200` 1px (xác nhận trong dialog) |
| Input | `gray-0` | `gray-600` | `gray-200` 1px |
| Input focus | `gray-0` | `gray-600` | `blue-500` 1.5px + ring `blue-100` 4px |
| Input disabled | `gray-50` | `gray-400` | `gray-100` 1px |
| Label | — | `gray-500` 13px medium | — |
| Placeholder | — | `gray-400` | — |
| Caption / Helper | — | `gray-400` 12px | — |
| Divider | — | — | `gray-100` 1px |
| Active nav | `blue-50` | `blue-700` 600 | left border `blue-500` 3px |
| Inactive nav | transparent | `gray-500` | none |
| Nav hover | `gray-50` | `gray-700` | none |
| Badge default | `gray-50` | `gray-600` | `gray-100` 1px |
| Badge primary | `blue-50` | `blue-700` | `blue-100` 1px |
| Tooltip | `gray-700` | `gray-0` | none |

---

## 3. TYPOGRAPHY

### 3.1. Font

**Primary:** `Be Vietnam Pro` — Google Fonts, hỗ trợ dấu VN xuất sắc, optimized cho Latin extended.
**Fallback:** `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`

Tải weights: 400 (Regular), 500 (Medium), 600 (Semibold). **Không dùng 700/800** — cảm giác quá nặng.

```css
font-family: 'Be Vietnam Pro', Inter, ui-sans-serif, system-ui, sans-serif;
```

### 3.2. Type scale

| Token | Size | Line height | Weight | Dùng cho |
|---|---|---|---|---|
| `text-display` | 32px | 40px | 600 | KPI lớn trên dashboard |
| `text-h1` | 24px | 32px | 600 | Page title |
| `text-h2` | 20px | 28px | 600 | Section title, card title |
| `text-h3` | 17px | 24px | 600 | Sub-section, modal title |
| `text-body-lg` | 16px | 24px | 400 | Body in detail view, mobile body |
| `text-body` | 14px | 20px | 400 | Body mặc định, table cell |
| `text-body-md` | 14px | 20px | 500 | Body cần emphasis nhẹ (button text) |
| `text-caption` | 13px | 18px | 500 | Label form, sub-text |
| `text-tiny` | 12px | 16px | 400 | Helper, timestamp, meta |
| `text-overline` | 11px | 14px | 600 | UPPERCASE category label, hiếm dùng |

### 3.3. Quy ước

- Title viết hoa chữ đầu kiểu câu, không Title Case Mỗi Từ. Tiếng Việt: "Danh sách khách hàng" không "Danh Sách Khách Hàng".
- Số trên dashboard dùng `tabular-nums` (font-variant-numeric) để cột số thẳng hàng.
- Số tiền VND: `1.250.000 ₫` — dấu chấm phân nghìn (locale vi-VN), ký hiệu ₫ phía sau cách 1 space.
- Số lớn rút gọn ở dashboard: `1,25 tr` (triệu), `1,25 tỷ` — không dùng `M`, `B` tiếng Anh.

---

## 4. SPACING, RADIUS, SHADOW

### 4.1. Spacing scale (tailwind tương đương)

```
--space-0:   0
--space-1:   4px   (gap nhỏ giữa icon-text)
--space-2:   8px   (padding bên trong button nhỏ)
--space-3:   12px  (gap field-field)
--space-4:   16px  (padding mobile card, gap section)
--space-5:   20px
--space-6:   24px  (padding desktop card)
--space-8:   32px  (gap giữa section lớn)
--space-10:  40px
--space-12:  48px  (gap giữa page section)
--space-16:  64px
```

### 4.2. Border radius

```
--radius-none:   0
--radius-sm:     4px   (badge, tag)
--radius-md:     6px   (input, small button)
--radius-base:   8px   (button mặc định)
--radius-lg:     10px  (card)
--radius-xl:     14px  (modal, sheet)
--radius-2xl:    20px  (mobile bottom sheet header)
--radius-full:   9999px (avatar, pill)
```

### 4.3. Shadow

Rất hạn chế. Chỉ 3 level:

```css
--shadow-xs:   0 1px 2px 0 rgba(15, 23, 42, 0.04);  /* card subtle */
--shadow-sm:   0 2px 6px -1px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04); /* dropdown */
--shadow-md:   0 8px 24px -4px rgba(15, 23, 42, 0.10), 0 4px 8px rgba(15, 23, 42, 0.04); /* modal, sheet */
```

**Quy tắc:** card mặc định KHÔNG có shadow, chỉ `border` 1px. Shadow chỉ khi cần lift element (modal, popover, dropdown, FAB).

### 4.4. Z-index scale

```
--z-base:        0
--z-dropdown:    10
--z-sticky:      20
--z-fixed:       30  (sidebar, topbar)
--z-modal-bg:    40
--z-modal:       50
--z-popover:     60
--z-tooltip:     70
--z-toast:       80
```

---

## 5. ICONOGRAPHY

**Library:** `lucide-react` (single source). Stroke-width 1.5 cho mọi icon.

### 5.1. Size

| Context | Size |
|---|---|
| Inside button | 16px |
| Inline với text body | 14-16px (match font size) |
| Nav item | 20px |
| Card header | 20-24px |
| Empty state | 48px |
| Hero illustration | 64-96px |

### 5.2. Color

- **Nav icon:** `gray-500` inactive, `blue-700` active
- **Action icon trong button:** kế thừa `currentColor`
- **Status icon (Clock, CheckCircle, AlertTriangle...):** `gray-500` mặc định. KHÔNG dùng màu semantic — chỉ icon + label đi kèm.
- **Decorative icon trên empty state:** `gray-300`

### 5.3. Icon mapping (chuẩn cho toàn app)

| Concept | Icon |
|---|---|
| Dashboard | `LayoutDashboard` |
| Khách hàng | `Users` |
| Một KH (avatar) | `User` |
| Sản phẩm | `Package` |
| Kho | `Warehouse` |
| Lô hàng | `Boxes` |
| Đơn hàng | `Receipt` |
| Hoá đơn | `FileText` |
| POS | `ShoppingCart` |
| NCC | `Truck` |
| Mua hàng | `PackagePlus` |
| Sổ quỹ | `Wallet` |
| Phiên quỹ | `BookOpen` |
| Pipeline | `Kanban` |
| Cơ hội | `Target` |
| Hoạt động | `Activity` |
| Gọi điện | `Phone` |
| Zalo/Messenger | `MessageCircle` |
| Email | `Mail` |
| Ghé thăm | `MapPin` |
| Demo | `PlayCircle` |
| Training | `GraduationCap` |
| Lịch | `Calendar` |
| Dự án đàn | `Stethoscope` |
| Vaccine | `Syringe` |
| Trại | `Home` |
| Đàn | `PawPrint` |
| Báo cáo | `BarChart3` |
| Doanh thu | `TrendingUp` |
| Công nợ | `CreditCard` |
| Quản trị | `Shield` |
| Cài đặt | `Settings` |
| Tìm kiếm | `Search` |
| Thông báo | `Bell` |
| Khuyến mãi | `Tag` |
| Voucher | `Ticket` |
| Tích điểm | `Sparkles` |
| Đăng xuất | `LogOut` |
| Đóng | `X` |
| Thêm | `Plus` |
| Sửa | `Pencil` |
| Xoá | `Trash2` |
| Lưu | `Save` |
| Bộ lọc | `Filter` |
| Sắp xếp | `ArrowUpDown` |
| Quét mã | `ScanLine` |
| Xuất file | `Download` |
| Nhập file | `Upload` |
| In | `Printer` |
| Sao chép | `Copy` |
| Chia sẻ | `Share2` |
| Trợ giúp | `HelpCircle` |
| Status: đã làm | `CheckCircle` |
| Status: đang chờ | `Clock` |
| Status: cảnh báo | `AlertTriangle` |
| Status: lỗi | `XCircle` |
| Status: thông tin | `Info` |
| Status: nháp | `FileEdit` |
| Trở về | `ChevronLeft` |
| Tiếp | `ChevronRight` |
| Mở rộng | `ChevronDown` |
| Thu gọn | `ChevronUp` |

---

## 6. COMPONENT LIBRARY

Tất cả components dựa trên **shadcn/ui** với customization màu xanh `#1E5A9C`. Mỗi component liệt kê variants + props quan trọng cho frontend dev.

### 6.1. Button

**Variants:** `primary` / `ghost` / `outline` / `text` / `icon`
**Sizes:** `sm` (h-32px) / `md` (h-40px) / `lg` (h-48px) / `xl` (h-56px — mobile only)

**Specs:**

| Variant | bg | border | text | radius | padding |
|---|---|---|---|---|---|
| primary | `blue-500` → hover `blue-600` → active `blue-700` | none | white | 8px | 10px 16px (md) |
| ghost | transparent → hover `blue-50` | none | `blue-600` → hover `blue-700` | 8px | same |
| outline | white → hover `gray-50` | `gray-200` 1px | `gray-700` | 8px | same |
| text | transparent → hover `blue-50` | none | `blue-600` | 4px | 4px 8px |
| icon | same as primary/ghost | — | — | 8px (square) | square 40×40 (md) |

**States:**
- Disabled: `opacity-40 cursor-not-allowed`
- Loading: spinner 16px + text mờ
- With icon: `<Icon className="w-4 h-4 mr-2" />Text`

**Mobile rule:** mọi button ≥ 44px height (touch target). Dùng `lg` hoặc `xl` size mặc định ở mobile.

### 6.2. Input

**Variants:** `default` / `with-icon` / `with-suffix` / `search` / `password`

**Specs:**
- Height: 40px (md), 48px (lg mobile)
- Padding: 10px 12px
- Border: `gray-200` 1px
- Focus: border `blue-500` 1.5px + ring `blue-100` 4px (offset 0)
- Font: 14px regular
- Placeholder: `gray-400`
- Label above input: 13px medium `gray-500`, margin-bottom 6px
- Helper/Error text below: 12px `gray-400` (helper) / `gray-700` + icon `AlertTriangle` (error)

**Đặc biệt cho tiếng Việt:** input không dùng `text-transform` (không uppercase) — sẽ phá dấu.

### 6.3. Select (single & multi)

Dùng shadcn Select. Variants:
- Single: trigger giống input, dropdown hiện list option
- Multi: chips bên trong trigger, dropdown có search box
- Cascading (province → district → ward): 3 select liên tiếp, mỗi cái filter theo cái trước

**Đặc biệt — Combobox với search VN không dấu:**
- Input vào dropdown filter qua `unaccent` cả query và options
- Vd gõ "trai anh tuan" match "Trại Anh Tuấn"

### 6.4. Checkbox & Radio

- Square 18×18 (checkbox), circle 18×18 (radio)
- Border `gray-300` unchecked, `blue-500` checked
- Check icon `gray-0` trong checkbox; dot `blue-500` trong radio
- Label cùng dòng, gap 8px, click label cũng toggle được
- Touch target min 44×44 (hit area mở rộng qua padding)

### 6.5. Switch (toggle)

- Width 36px, height 20px
- Off: bg `gray-300`, thumb `gray-0`
- On: bg `blue-500`, thumb `gray-0`
- Animation: 150ms ease

### 6.6. Badge

3 variants:

```
[● Đang hoạt động]  ← icon nhỏ trước + text + bg gray-50 border gray-100

[Đại lý cấp 1]      ← text only, bg blue-50 text-blue-700 border-blue-100

[VIP]               ← solid bg blue-500 text white (chỉ cho VIP/critical, rất ít dùng)
```

Specs:
- Height 24px
- Padding 4px 10px
- Font 12px medium
- Radius 6px (default) hoặc full pill
- Icon 12px

### 6.7. Card

Base:
- Bg `gray-0`
- Border `gray-100` 1px
- Radius `lg` (10px)
- Padding 24px (desktop), 16px (mobile)
- Shadow: none mặc định, `shadow-xs` nếu cần lift

Variants:
- `Card` — base
- `CardClickable` — hover state có `border-gray-200` + cursor pointer
- `CardKpi` — chuyên cho dashboard, có structure: label + giá trị lớn + delta nhỏ
- `CardListRow` — dạng row trong list view, 16px padding, divider thay border

Header pattern:
```
+---------------------------------------------+
| H2 Title          [optional action button]  |
| Caption text                                |
+---------------------------------------------+
| ... content ...                             |
+---------------------------------------------+
```

### 6.8. Table

Specs:
- Header row: bg `gray-25`, text 13px medium `gray-500`, height 44px, padding 12px 16px
- Body row: bg `gray-0` → hover `gray-50`, text 14px `gray-600`, height 56px
- Divider: `gray-100` 1px between rows
- Border outer: `gray-100` 1px + radius 10px
- Sticky header khi scroll
- Cột số căn phải, dùng tabular-nums
- Cột action căn phải cuối: dropdown menu icon `MoreHorizontal`

Variants:
- Dense: row height 44px (cho admin advanced view)
- Comfy: row height 64px (default)
- Mobile: convert thành card list (mỗi row 1 card)

### 6.9. Modal / Dialog

- Bg overlay: `rgba(15, 23, 42, 0.45)`
- Bg modal: `gray-0`
- Border: `gray-100` 1px
- Radius: 14px
- Shadow: `shadow-md`
- Width: 480px (small), 640px (default), 800px (large), 1024px (xl)
- Padding: 24px
- Close button: top-right icon `X` 20px

Structure:
```
+-------------------------+
| Title           [X]     |
| Caption (optional)      |
+-------------------------+
| Content                 |
| ...                     |
+-------------------------+
|  [Cancel]   [Primary]   |  ← footer actions, right-aligned
+-------------------------+
```

### 6.10. Bottom Sheet (mobile)

- Slide từ dưới lên
- Radius top: 20px
- Drag handle ở trên (4px width 32px gray-300 pill)
- Max-height: 90vh
- Backdrop tap → close
- Có swipe-down to close (gesture)

### 6.11. Toast / Notification banner

Bottom-center hoặc top-right.

- Width: 360px (desktop), full-width minus 32px (mobile)
- Bg: `gray-0` border `gray-200`
- Icon trái: `Info` / `CheckCircle` / `AlertTriangle` 20px gray-500 (không màu)
- Title 14px medium, body 13px regular
- Auto-dismiss 5s, có close button
- Stack tối đa 3, sau xếp hàng

**Không dùng toast màu xanh/đỏ tô background** — chỉ icon phân biệt.

### 6.12. Form layout

- Field gap: 16-20px
- Label-input gap: 6px
- Help text: 4px under input
- Section gap: 32px
- Multi-column trên desktop: 12-col grid, gap 24px

Form action bar (sticky bottom trên mobile):
```
+--------------------------------------+
| [Cancel ghost]    [Save primary]     |
+--------------------------------------+
```

### 6.13. Empty state

```
+-----------------------------+
|         (icon 48px          |
|          gray-300)          |
|                             |
|    Chưa có khách hàng       |  ← h3 text-gray-600
|                             |
|  Bắt đầu thêm KH đầu tiên   |  ← body text-gray-400
|  để theo dõi cơ hội bán hàng|
|                             |
|     [+ Thêm khách hàng]     |  ← primary button
+-----------------------------+
```

### 6.14. Loading state

- **Skeleton** mặc định cho list/table/card. Bg `gray-100`, animation pulse 1.5s.
- **Spinner** chỉ cho action nhỏ (button loading). Size 16-20px.
- **Page loading** full screen: skeleton structure giả lập layout.

### 6.15. Pagination

- Bottom của table
- Format: `[< Prev] [1] [2] [3] ... [10] [Next >]`
- Cùng dòng: "Hiển thị X-Y trên Z" + page size selector (10/25/50/100)
- Mobile: chỉ Prev/Next + indicator "Trang 2/10"

### 6.16. Tabs

Underline style:
- Inactive: text `gray-500` 14px medium
- Active: text `blue-700` + underline 2px `blue-500`
- Hover inactive: text `gray-700`
- Gap giữa tab: 24px
- Scroll horizontal trên mobile

### 6.17. Avatar

- Circle, default 32px
- Initials 14px white on `blue-500` bg nếu không có ảnh
- Sizes: xs 24, sm 32, md 40, lg 48, xl 64
- Online indicator (dot 8px) bottom-right nếu cần

### 6.18. Tooltip

- Trigger hover/focus 500ms delay
- Bg `gray-700`, text white 12px
- Padding 6px 10px, radius 6px
- Arrow 6px

### 6.19. Dropdown Menu

- Trigger button → dropdown panel
- Bg `gray-0`, border `gray-100` 1px, shadow `shadow-sm`, radius 8px
- Item: padding 8px 12px, hover bg `gray-50`
- Icon trái 16px optional
- Divider giữa group: `gray-100` 1px

### 6.20. Date Picker

- Single date / Date range
- Calendar grid 7×6
- Selected day: bg `blue-500` text white circle
- Today: border `blue-500` circle
- Range: bg `blue-50` cho days between, endpoints solid `blue-500`
- Mobile: full-screen overlay với calendar lớn

### 6.21. Number Input (quantity stepper)

```
[-]  [   24   ]  [+]
```

- Width: full
- [-] và [+] button 40×40, icon `Minus` / `Plus`
- Middle input center-align, tabular-nums
- Long-press [+] tăng nhanh

### 6.22. File Upload / Image Uploader

- Drag-drop zone: border dashed `gray-200` 2px, padding 32px, radius 10px
- Icon `Upload` 32px gray-400 center
- Text "Kéo thả ảnh hoặc click để chọn"
- After upload: thumbnail grid 80×80, có nút X xoá

### 6.23. Stepper (wizard)

Horizontal steps trên top:
```
[●━━━━━●━━━━━○━━━━━○]
 Bước 1  Bước 2  Bước 3  Bước 4
 (done)  (active)(pending)
```

- Active: circle `blue-500` solid với số
- Done: circle `blue-500` solid với icon Check
- Pending: circle `gray-200` outline
- Connector line `blue-500` cho done, `gray-200` pending

Mobile: vertical stepper (1 cột).

---

## 7. LAYOUT SHELL

### 7.1. Desktop layout (≥1024px)

```
+-----------------------------------------------------------+
| TopBar  (h: 56px, sticky, bg-white border-bottom)         |
+--------+--------------------------------------------------+
|        |                                                  |
| Side   |                                                  |
| bar    |    Main Content                                  |
| 240px  |    (max-w-7xl mx-auto px-8 py-6)                 |
| fixed  |                                                  |
|        |                                                  |
|        |                                                  |
+--------+--------------------------------------------------+
```

**TopBar (56px):**
- Trái: nút collapse sidebar (icon `Menu`) — desktop hidden, tablet visible
- Giữa-trái: ô search "Tìm... (Ctrl+K)" placeholder, click hoặc Ctrl+K → mở Global Search modal
- Phải: 
  - `Bell` icon với badge số chưa đọc (red dot 8px nếu > 0 — đây là exception, dùng dot xanh `blue-500` thay vì đỏ)
  - Avatar dropdown menu: Hồ sơ / Đổi mật khẩu / Cài đặt thông báo / Quản trị (nếu admin) / Đăng xuất

**Sidebar (240px):**
- Logo Sanh Long top 56px height
- Nav items:
  - Trang chủ (`LayoutDashboard`)
  - Khách hàng (`Users`)
  - Pipeline (`Kanban`) — Phase 2
  - Đơn hàng (`Receipt`)
  - Sản phẩm (`Package`)
  - Kho (`Warehouse`)
  - Nhà cung cấp (`Truck`)
  - Hoạt động (`Activity`) — Phase 2
  - Dự án đàn (`Stethoscope`) — Phase 2
  - Sổ quỹ (`Wallet`) — chỉ permission
  - Báo cáo (`BarChart3`)
  - ─── divider ───
  - Quản trị (`Shield`) — chỉ admin
- Bottom: phần thông tin user thu gọn (avatar + tên + role chính)
- Active item: bg `blue-50`, border-left 3px `blue-500`, text `blue-700` 600

**Collapsed sidebar** (78px chỉ icon): toggle qua nút topbar, lưu state vào localStorage.

### 7.2. Tablet layout (768-1024px)

- Sidebar mặc định collapsed (78px), expand on hover hoặc click toggle
- Main content max-w-full, padding 24px

### 7.3. Mobile layout (<768px)

```
+-----------------------------------+
| TopBar (h: 56px)                  |
+-----------------------------------+
|                                   |
| Main Content                      |
| (px-4 py-4)                       |
|                                   |
|                                   |
|                                   |
+-----------------------------------+
| Bottom Nav (h: 64px)              |
+-----------------------------------+
                              [FAB+]  ← floating
```

**TopBar mobile (56px):**
- Trái: logo nhỏ + tên app "Sanh Long"
- Phải: icon `Search` (mở overlay search), icon `Bell` (mở notification panel), avatar (mở drawer menu)

**Bottom Nav (64px):**
- 5 tabs cố định, icon + label nhỏ 11px:
  1. Trang chủ (`LayoutDashboard`)
  2. Khách hàng (`Users`)
  3. Đơn (`Receipt`)
  4. Hoạt động (`Activity`)
  5. Thêm (`Menu` → drawer mở các module còn lại)

- Active tab: icon + text `blue-700`, indicator dot 4px bên trên
- Inactive: `gray-400`

**FAB (Floating Action Button):**
- 56×56 circle
- Bg `blue-500`, icon `Plus` white 24px
- Position: bottom 80px (above bottom nav), right 16px
- Shadow `shadow-md`
- Tap → bottom sheet "Ghi nhanh" với 4 options:
  - Tạo đơn hàng nhanh
  - Ghi hoạt động
  - Thêm khách hàng
  - Quét mã sản phẩm

---

## 8. TRANG AUTH & ONBOARDING

### 8.1. `/login`

Layout: center vertical + horizontal, max-w-md card.

```
+-----------------------------+
|                             |
|     [Logo Sanh Long]        |
|                             |
|     H2: Đăng nhập           |
|     Caption: ...            |
|                             |
|     [Email input]           |
|                             |
|     [Password input]        |
|                             |
|     [☐] Ghi nhớ              |
|       [Quên mật khẩu?]      |
|                             |
|     [Đăng nhập primary]     |
|                             |
|     ── hoặc ──              |
|                             |
|     [Đăng nhập Google]      |  ← outline button
|                             |
+-----------------------------+
```

- Card: white bg, border `gray-100`, radius 14px, padding 32px
- Background page: gradient nhẹ `gray-25` → `blue-50`
- Logo SVG max-height 48px

### 8.2. `/forgot-password`

Similar layout: input email → button "Gửi link đặt lại". Success state hiện check icon + message.

### 8.3. `/reset-password?token=...`

Input new + confirm password. Validation realtime (min 8 chars, có chữ + số).

### 8.4. Onboarding tour (first-time login)

5 steps overlay tutorial:
1. Welcome message
2. "Đây là sidebar — chứa mọi module"
3. "Click vào Khách hàng để xem danh sách"
4. "Dùng Ctrl+K để tìm nhanh"
5. "FAB góc phải dưới (mobile) để ghi nhanh"

Mỗi step có tooltip arrow trỏ vào element, button "Tiếp" / "Bỏ qua".

---

## 9. DASHBOARD

### 9.1. Layout chung `/`

Grid 12 cột desktop, gap 24px. Widget chiếm col-span khác nhau (3/4/6/8/12).

```
+--------+--------+--------+--------+
| KPI 1  | KPI 2  | KPI 3  | KPI 4  |  ← col-span-3 mỗi cái
+--------+--------+--------+--------+
|       Chart wide               |     ← col-span-8
+--------------------------------+
|       List card                |     ← col-span-4
+--------------------------------+
|  Activity timeline             |     ← col-span-12
+--------------------------------+
```

### 9.2. KPI Card pattern

```
+----------------------+
| 🛒 Đơn hôm nay       |  ← icon 20px + label 13px gray-500
|                      |
| 12                   |  ← display 32px semibold gray-700
|                      |
| ↗ +3 so với hôm qua  |  ← tiny 12px, icon TrendingUp 14px
+----------------------+
```

Variants:
- `KpiSimple` — số + label
- `KpiWithDelta` — thêm so sánh kỳ trước
- `KpiWithSparkline` — thêm mini chart 7 ngày
- `KpiWithProgress` — progress bar (vd 75% target tháng)

### 9.3. Dashboard cho Sales (mobile-first)

```
┌──────────────────────┐
│ Xin chào, Tuấn 👋    │
│ Thứ Sáu, 22/05/2026  │
├──────────────────────┤
│ ┌────────┐ ┌────────┐│
│ │Đơn hôm │ │Doanh   ││
│ │nay: 5  │ │thu:1.2M││
│ └────────┘ └────────┘│
├──────────────────────┤
│ KH sắp đáo công nợ   │
│ ┌──────────────────┐ │
│ │● Trại Anh Tuấn   │ │
│ │  Còn 2 ngày      │ │
│ ├──────────────────┤ │
│ │● Trại Chị Hoa    │ │
│ │  Còn 5 ngày      │ │
│ └──────────────────┘ │
├──────────────────────┤
│ Hoạt động tuần này   │
│ ┌──────────────────┐ │
│ │ T2 ◉ ◉           │ │
│ │ T3 ◉             │ │
│ │ T4 ◉ ◉ ◉         │ │
│ │ T5 (hôm nay)     │ │
│ └──────────────────┘ │
└──────────────────────┘
```

### 9.4. Dashboard cho Admin/CEO (desktop)

12-cột:
- Row 1: 4 KPI Cards (col-3 each): Doanh thu tháng / Số đơn / KH mới / Tỉ lệ thu nợ
- Row 2: Doanh thu 12 tháng (col-8 line chart) + Top 5 chi nhánh (col-4 bar)
- Row 3: Doanh thu theo category (col-6 pie) + Top 10 SP bán chạy (col-6 bar)
- Row 4: Cảnh báo critical (col-12 list)

### 9.5. Dashboard cho Thủ kho

- KPI: Tồn dưới safety, Lô hết HSD 30d, Lô quarantine, Điều chuyển chờ
- Bảng "Lô gần hết HSD" — sortable
- Bảng "SP dưới safety stock" — có nút "Gợi ý đặt mua"

### 9.6. Dashboard cho Kế toán

- KPI: Công nợ KH tổng, Công nợ NCC tổng, Tiền mặt cuối ngày, Phiên quỹ lệch
- Aging chart công nợ KH (bar 0-30/31-60/61-90/90+)
- List HĐ chờ phát hành VAT (Phase 2)

---

EOF
echo "Phần 1 layout xong"
wc -l /home/claude/sanhlong/01-FUNCTIONAL-SPEC.md /home/claude/sanhlong/02-LAYOUT-SPEC.md 2>/dev/null
## 10. MODULE KHÁCH HÀNG

### 10.1. `/customers` — List page

**Desktop layout:**

```
+-----------------------------------------------------------+
| H1: Khách hàng                          [+ Thêm KH]       |  ← page header
+-----------------------------------------------------------+
| Quick filters:                                            |
| [Tất cả] [KH của tôi] [VIP] [Nguy cơ rời] [Quá hạn nợ]    |
|                                                           |
| ┌─────────────┐ ┌─────────────────────────────────────┐   |
| │ [Filter]    │ │ Search: ...                         │   |
| │  Panel      │ │                                     │   |
| │             │ │ +────────────────────────────────+  │   |
| │ Loại KH ▼   │ │ | [☐] | Tên KH       | SDT     |  │   |
| │ Sales ▼     │ │ +────────────────────────────────+  │   |
| │ Chi nhánh▼  │ │ | [☐] | ● Trại A.Tuấn|0901..  |  │   |
| │ Lifecycle▼  │ │ | [☐] | ● Đại lý ABC |0902..  |  │   |
| │ Có nợ qhạn? │ │ ...                              │   |
| │             │ │                                  │   |
| │ [Áp dụng]   │ │ [Pagination]                     │   |
| │ [Lưu lọc]   │ │                                  │   |
| └─────────────┘ └──────────────────────────────────┘   |
+-----------------------------------------------------------+
```

- **Filter panel** (260px sidebar bên trái, collapsible)
  - Multi-select cho mỗi field
  - Range cho monetary
  - Date range cho last_order_at
  - Toggle "Chỉ KH có nợ quá hạn"
  - Button "Áp dụng" + "Đặt lại"
  - Section "Bộ lọc đã lưu" (Phase 2)
- **Quick filter row** trên đầu: 5-6 preset filter dạng pill button
- **Search bar** trên table: tìm tên, SĐT, mã KH
- **Bulk actions** khi tick checkbox: Gán sales, Đổi nhóm giá, Xuất Excel
- **Table columns:**
  - Checkbox
  - Avatar/Initials + Tên (link to detail) + sub: customer_type badge
  - SĐT
  - Sales phụ trách (avatar + tên)
  - Nhóm giá (badge)
  - Lifecycle stage (icon + label)
  - Value tier (badge VIP/normal/high_potential)
  - Công nợ hiện tại (tabular num)
  - Đơn cuối (date)
  - Action menu (`...`): Xem / Sửa / Chuyển sales / Vô hiệu hoá
- **Mobile:** convert thành card list, mỗi card 1 KH

**Mobile card:**

```
┌────────────────────────────┐
│ ●  Trại Anh Tuấn          │
│    Trại thương mại · Bình Dương │
│    📞 0901 234 567        │
│ ┌───────┐ ┌───────┐       │
│ │ Active│ │  VIP  │       │
│ └───────┘ └───────┘       │
│    Nợ: 5.2 tr · Đơn cuối: 3 ngày trước │
└────────────────────────────┘
```

### 10.2. `/customers/new` — Form tạo nhanh

Mobile bottom sheet hoặc desktop modal (640px width).

**Form fields (chỉ 5):**

```
┌─────────────────────────────┐
│ Thêm khách hàng        [X]  │
│                             │
│ Loại KH *                   │
│ [Trại lẻ][Trại lớn][Đại lý] │  ← segmented buttons
│ [DN lớn][BSTY][Khác]        │
│                             │
│ Tên KH / Tên trại *         │
│ [____________________]      │
│                             │
│ SĐT *                       │
│ [____________________]      │
│                             │
│ Tỉnh / Huyện *              │
│ [Tỉnh ▼] [Huyện ▼]          │  ← cascading select
│                             │
│ Nhóm giá *                  │
│ [Trại lẻ ▼]                 │
│                             │
│ [Huỷ]    [Lưu & mở detail]  │
└─────────────────────────────┘
```

Save → redirect `/customers/:id` để nhập thêm thuộc tính sâu.

### 10.3. `/customers/:id` — Detail page

**Desktop layout:**

```
+-----------------------------------------------------------+
| ← Khách hàng / Trại Anh Tuấn                              |
+-----------------------------------------------------------+
| ┌───────────────────────────────────────────────────────┐ |
| │ [Avatar  Trại Anh Tuấn               Score: 82/100 ●]│ |
| │  60×60]   KH-2026-00042                              │ |
| │         Trại thương mại · Sales: Nguyễn Văn A        │ |
| │         ● Active · ● VIP · Nợ: 5.2 tr / hạn mức 20 tr│ |
| │                                                      │ |
| │  [Gọi]  [Tạo đơn]  [Ghi hoạt động]  [...]            │ |
| └───────────────────────────────────────────────────────┘ |
|                                                           |
| ┌───────────────────────────────────────────────────────┐ |
| │ Tabs: Tổng quan | Trại&Đàn | Đơn hàng | Hoạt động |   │ |
| │       Cơ hội | Dự án đàn | Phân tích | Ghi chú        │ |
| └───────────────────────────────────────────────────────┘ |
|                                                           |
| --- Tab content tuỳ chọn ---                              |
+-----------------------------------------------------------+
```

**Tab "Tổng quan":**

2-cột grid:
- Cột trái: thông tin chính (tên, type, SDT, địa chỉ, GPS map mini, primary_sales, contacts list với phone clickable)
- Cột phải: thông tin pháp lý/cá nhân (MST nếu có, ngân hàng, CCCD) + chính sách công nợ (nhóm giá, credit_limit, payment_term, billing_mode)

**Tab "Trại & Đàn"** (Phase 2):

```
+-----------------------------------------------+
| Trại của khách hàng       [+ Thêm trại]       |
+-----------------------------------------------+
| ┌─────────────────────────────────────────┐   |
| │ ▼ Trại Anh Tuấn (Bình Dương)            │   |
| │                                         │   |
| │   GPS · 11.123, 106.456 [Mở map]        │   |
| │   Chuồng: kín · Đầu ra: Lò mổ           │   |
| │                                         │   |
| │   Đàn:                       [+ Thêm đàn]   |
| │   ┌──────────────────────────────────┐  │   |
| │   │ Heo thịt · ~500 con              │  │   |
| │   │ Vaccine: 80% complete            │  │   |
| │   │ [Lịch vaccine] [Lịch sử bệnh]    │  │   |
| │   └──────────────────────────────────┘  │   |
| │   ┌──────────────────────────────────┐  │   |
| │   │ Heo nái · ~50 con                │  │   |
| │   │ ...                              │  │   |
| │   └──────────────────────────────────┘  │   |
| └─────────────────────────────────────────┘   |
+-----------------------------------------------+
```

**Tab "Đơn hàng":**

List orders của KH (table giống `/orders` nhưng pre-filtered) + panel "Công nợ aging" bên phải:

```
┌───────────────────────┐
│ Công nợ:              │
│  0-30 ngày:  2.1 tr   │
│  31-60:      1.5 tr   │
│  61-90:        500K   │
│  90+:        1.1 tr ⚠ │
│                       │
│  Tổng: 5.2 tr         │
│  [Ghi nhận thanh toán]│
└───────────────────────┘
```

**Tab "Hoạt động":**

Timeline view dọc theo thời gian:

```
Hôm nay
├─ ● 14:30  Gọi điện · "KH đồng ý báo giá"
│           Nguyễn Văn A
│
Hôm qua
├─ ● 09:15  Ghé thăm · Bàn về vaccine
│           Nguyễn Văn A
│
3 ngày trước
├─ ● Email · Gửi catalog Q2
│           Hệ thống
```

[+ Thêm hoạt động] button sticky top.

**Tab "Phân tích"** (Phase 3):

4 cards layout:
- **RFM Score card** — 3 mini gauge R/F/M
- **Lifetime value** — line chart cumulative revenue 24 tháng
- **Product affinity** — 3 sub-section: Top 5 mua / Up-sell gợi ý / Switch from competitor
- **Churn risk gauge** — meter 0-100 với màu indicator

**Tab "Ghi chú":**

Rich text editor đơn giản (markdown), version history bên phải.

---

## 11. MODULE SẢN PHẨM & GIÁ

### 11.1. `/products` — List page

**Desktop:** card grid mặc định (4 cột), toggle sang table view.

**Card:**

```
┌─────────────────┐
│  [SP image]     │  ← 200×200 ảnh primary
│                 │
├─────────────────┤
│ Amoxicillin 10% │  ← name h3
│ Chai 100ml      │  ← packaging caption
│ Kháng sinh      │  ← category badge
│                 │
│ Tồn: 245 chai   │  ← inventory summary
│ Giá lẻ: 85K     │  ← list_price
└─────────────────┘
```

**Filter panel:**
- Category (checkboxes)
- Brand (multi-select)
- Species chỉ định
- Có cảnh báo: tồn thấp / HSD gần
- Status: active / inactive

### 11.2. `/products/:id` — Detail

Tabs: Tổng quan / Variants & Giá / Tồn kho theo lô / Hình ảnh / Lịch sử bán

**Tab Tổng quan:** thông tin chính + thông tin chuyên ngành (hoạt chất, nhóm dược lý, số ĐK, withdrawal_days, bệnh chỉ định, loài chỉ định) — collapsible sections.

**Tab Variants & Giá** (Phase 2):

```
+-----------------------------------------------+
| Variants (3)                  [+ Thêm variant]|
+-----------------------------------------------+
| SKU      | Quy cách    | Đơn vị | Giá cơ sở  |
+-----------------------------------------------+
| MED-001-V01| Chai 100ml | chai   | 80,000     |
| MED-001-V02| Can 1L     | can    | 720,000    |
| MED-001-V03| Thùng 24c  | thùng  | 1,920,000  |
+-----------------------------------------------+
|                                               |
| Bảng giá theo nhóm KH:                        |
| ┌───────────┬─────┬─────┬─────┬─────┐         |
| │           │ V01 │ V02 │ V03 │ ... │         |
| ├───────────┼─────┼─────┼─────┼─────┤         |
| │ Trại lẻ   │ 85K │ 750K│ 2M  │     │         |
| │ Đại lý T1 │ 75K │ 700K│ 1.8M│     │         |
| │ Đại lý T2 │ 78K │ 720K│ 1.85M│    │         |
| │ VIP       │ 72K │ 680K│ 1.75M│    │         |
| │ Phân phối │ 70K │ 660K│ 1.7M │    │         |
| └───────────┴─────┴─────┴─────┴─────┘         |
|                                               |
| [Sửa bảng giá inline] [Import Excel]          |
+-----------------------------------------------+
```

Inline edit cell trực tiếp, save tự động.

**Tab Tồn kho theo lô:**

```
+-----------------------------------------------+
| Variant: [Chai 100ml ▼]                       |
+-----------------------------------------------+
| Lô        | Kho       | Tồn | HSD       | TT |
+-----------------------------------------------+
| L24-001   | Kho HCM   | 50  | 12/10/26  | ● |
| L24-002   | Kho HCM   | 120 | 03/2027   | ● |
| L23-099   | Kho HN    | 8   | 15/06/26⚠| ● |
+-----------------------------------------------+
| Tổng tồn: 178 chai (3 lô)                     |
+-----------------------------------------------+
```

Highlight lô gần HSD: text `gray-700` + icon `Clock` (không màu đỏ).

### 11.3. `/promotions` (Phase 2)

Calendar view + list view toggle.

**Calendar:** mỗi KM hiện như block kéo dài từ start_date đến end_date.

**Form tạo KM** wizard 3 bước:
1. Chọn loại (6 cards với icon + mô tả)
2. Cấu hình theo loại (form động)
3. Ràng buộc (chi nhánh / nhóm giá / loài) + ngân sách + ngày

---

## 12. MODULE KHO, NCC, NHẬP HÀNG

### 12.1. `/inventory` — Tổng quan kho

Tabs: Tồn theo lô / Cảnh báo / Điều chuyển / Lô quarantine

**Tab Tồn theo lô:**

```
+--------------------------------------------------+
| Filter: Kho [Tất cả ▼] Category [Tất cả ▼]      |
| Quick: [Sắp hết HSD] [Tồn thấp] [Quarantine]    |
+--------------------------------------------------+
| Variant     | Kho    | Lô     | Tồn| HSD   | TT |
+--------------------------------------------------+
| Amox 100ml  | HCM    | L24-001| 50 | 10/26 | ● |
| Vacc ND     | LẠNH HN| L24-005| 200| 06/26 | ⏰ |
+--------------------------------------------------+
```

**Tab Cảnh báo** (Phase 2):

List grouped theo loại alert. Click row → modal chi tiết + action "Đánh dấu đã xử lý".

### 12.2. `/inventory/transfers` (Phase 2)

List điều chuyển + tạo mới (3-step wizard: chọn from/to → chọn lô + qty → review).

**Detail page** hiển thị state machine status:
```
[●━━━━━●━━━━━○━━━━━○]
Yêu cầu  Duyệt  Đi đường Nhận
 done    done    active   pending
```

### 12.3. `/suppliers` & `/suppliers/:id`

Tương tự `/customers`, đơn giản hơn (không có analytics phức tạp).

Card hiển thị: tên + country flag (domestic/foreign) + rating 5 sao + payment_term + current_debt_payable.

### 12.4. `/purchase-orders` & `/purchase-orders/new`

**Form PO:**

```
+---------------------------------------------+
| H2: Tạo phiếu mua hàng                      |
+---------------------------------------------+
| NCC: [Search NCC ▼]    Chi nhánh: [HCM ▼]   |
|                                             |
| Currency: USD · Tỷ giá hôm nay: 25.450      |
| Kho nhận: [Kho HCM chính ▼]                 |
| Thanh toán: [○ Mua hẳn  ● Trả chậm]         |
| Kỳ hạn: 30 ngày · Giao dự kiến: [15/06/26]  |
+---------------------------------------------+
| Lines:                       [+ Thêm dòng]  |
| ┌──────────────────────────────────────────┐|
| │ SP: [Amox 100ml]  ĐV: [thùng] SL: [10] │ |
| │ Giá USD: 50  → VND: 1.272.500          │ |
| │ Tổng: 12.725.000                        │ |
| └──────────────────────────────────────────┘|
| ...                                         |
+---------------------------------------------+
| Subtotal:           50.000.000              |
| Total:              50.000.000              |
+---------------------------------------------+
|        [Lưu nháp]   [Gửi NCC]               |
+---------------------------------------------+
```

### 12.5. `/goods-receipts/new` — Nhập hàng thực

Thủ kho mở từ PO hoặc tạo trực tiếp.

```
+---------------------------------------------+
| Nhập từ PO: [PO-2026-00042 ▼]               |
| Kho nhận: [Kho HCM chính]                   |
| Ngày nhận: [22/05/2026]                     |
| Tỷ giá hôm nay: 25.380 (snapshot lại)       |
+---------------------------------------------+
| Lines:                                      |
| ┌──────────────────────────────────────────┐|
| │ Amox 100ml  ·  Đặt: 120 chai             ││
| │                                          ││
| │ Lô: [L24-005]                            ││
| │ NSX: [01/03/2026]  HSD: [01/03/2028]     ││
| │ Số nhận thực: [120]                      ││
| │ Giá đơn vị USD: 50 → VND: 1.269.000      ││
| └──────────────────────────────────────────┘|
+---------------------------------------------+
|              [Xác nhận nhập kho]            |
+---------------------------------------------+
```

Confirm → tạo stock_lots + stock_movements + customer_debts NCC (nếu credit).

---

## 13. MODULE POS & ĐƠN HÀNG

### 13.1. `/pos` — Full-screen POS desktop

```
+-----------------------------------------------------------+
| ← Quay lại    POS · CN HCM     Phiên #CS-0042 ⏱           |
+----------------------+------------------------------------+
| KH: [Khách lẻ ▼ Search]                                   |
+----------------------+------------------------------------+
| Tìm SP (Ctrl+/) hoặc| Đơn hàng (3 dòng)                  |
| [📷 Quét mã]         |                                    |
|                      | 1. Amox 100ml · 5 chai · 425.000   |
| Gợi ý:               | 2. Vacc ND · 1 lọ  · 1.200.000     |
| ┌────┐ ┌────┐ ┌────┐ | 3. Kim tiêm · 2 cái · 60.000       |
| │Amox│ │Vacc│ │Iverm│|                                    |
| │ ND │ │    │ │     │|                                    |
| └────┘ └────┘ └────┘ |                                    |
|                      +------------------------------------+
|                      | Subtotal:        1.685.000        |
|                      | KM (TET2026):    -100.000         |
|                      | ─────────────────────             |
|                      | Tổng:            1.585.000        |
|                      |                                    |
|                      | Thanh toán:                        |
|                      | [Tiền mặt] [Chuyển khoản] [Công nợ]|
|                      |                                    |
|                      | [F8 Lưu nháp]   [F9 Xác nhận]      |
+----------------------+------------------------------------+
```

**Hotkeys:**
- `Ctrl+/` focus search
- `F2` add line
- `F5` xoá đơn
- `F8` save draft
- `F9` confirm
- `F12` print

**Search SP autocomplete:** type tên hoặc SKU hoặc barcode → list 5 kết quả → Enter chọn → tự thêm vào lines với qty=1, focus qty để type.

**Line item edit:**
- Click qty → inline edit
- Click giá → inline edit (sales sửa giá tự do)
- Icon `Trash2` để xoá line
- Nếu có quantity_break → auto-calculate khi qty crossover bậc

**Khi vượt credit_limit:** popup cảnh báo, nếu user có permission `order.override_credit_limit` → "Tiếp tục" enable.

### 13.2. `/orders/new` — Mobile field

Bottom sheet hoặc full-screen mobile.

```
┌──────────────────────────┐
│ ← Tạo đơn mới        Lưu │
├──────────────────────────┤
│ Khách hàng *             │
│ [Tìm KH...        ▼]     │
├──────────────────────────┤
│ Sản phẩm                 │
│ ┌──────────────────────┐ │
│ │ Amox 100ml          │ │
│ │ [-] 5 [+]  chai     │ │
│ │ 85.000 → 425.000    │ │
│ └──────────────────────┘ │
│                          │
│ [+ Thêm sản phẩm]        │
├──────────────────────────┤
│ Thanh toán               │
│ ○ Tiền mặt              │
│ ● Chuyển khoản          │
│ ○ Công nợ               │
├──────────────────────────┤
│ Tổng:        1.585.000 ₫ │
│                          │
│ [Xác nhận đơn]           │  ← sticky bottom primary button
└──────────────────────────┘
```

### 13.3. `/quotes` & quote → order

List báo giá với status badges. Detail có button "Chuyển thành đơn" (chỉ khi status=accepted).

### 13.4. `/orders` — List

Filter columns + quick filters đã mô tả. Mobile: card list.

### 13.5. `/orders/:id` — Detail

```
+-------------------------------------------+
| ← DH-2026-00042                           |
| ●━━━●━━━●━━━○━━━○━━━○                    |
| Nháp Xác.n Giao Đã.g Đã.tt Hoàn          |
|                                          |
| [Action: Xác nhận giao]  [Print] [...]   |
+-------------------------------------------+
| Tabs: Chi tiết | Lịch sử | Thanh toán |  |
|       Trả hàng | Hoá đơn                 |
+-------------------------------------------+
| Tab Chi tiết:                            |
| KH: Trại Anh Tuấn (link)                 |
| Sales: Nguyễn Văn A                      |
| Chi nhánh: HCM · Kho xuất: Kho chính     |
| Tạo: 20/05/2026 10:30                    |
|                                          |
| Lines table:                             |
| | SKU | Tên | Lô  | SL | Giá | Total |   |
|                                          |
| Tổng: ... · KM: ... · Thanh toán: ...    |
+-------------------------------------------+
```

State machine ở header animation khi đổi status.

### 13.6. `/sales-returns/new`

Wizard: chọn đơn → chọn lines trả → nhập qty + reason + destination → review → save.

---

## 14. MODULE SỔ QUỸ

### 14.1. `/cashbook` (chỉ permission)

Tabs: Tổng quan / Phiếu thu / Phiếu chi / Chuyển nội bộ / Phiên quỹ / Báo cáo

**Tab Tổng quan:**

```
+---------------------------------------------+
| Số dư quỹ hiện tại                          |
| ┌─────────┐ ┌─────────┐ ┌─────────┐         |
| │CF-HCM   │ │CF-HN    │ │BA-VCB   │         |
| │ 25.5 tr │ │ 18.2 tr │ │ 120.3 tr│         |
| │  ── ▁▂▁ │ │ ──▂▃▂   │ │ ─▁▁▂▁   │         |
| └─────────┘ └─────────┘ └─────────┘         |
+---------------------------------------------+
| Dòng tiền 30 ngày                           |
| [Bar chart inflow vs outflow theo tuần]    |
+---------------------------------------------+
| Phiếu chờ duyệt (3)                         |
| [List...]                                   |
+---------------------------------------------+
```

**Tab Phiếu thu / chi:**

List với filter category + financial_account + date range + status.

**Form tạo phiếu (chi):**

```
┌─────────────────────────────────┐
| H2: Phiếu chi mới               |
+---------------------------------+
| Loại chi *                      |
| [○ Trả NCC  ● Lương  ○ Vận hành]|
| [○ Tạm ứng NV ○ Hoàn KH ○ Khác] |
+---------------------------------+
| Số tiền *: [____________]       |
| Trả từ tài khoản *: [CF-HCM ▼]  |
| Đối tượng: [Chọn NCC/NV...]     |
| Diễn giải *: [______________]   |
| Đính kèm: [Chọn file...]        |
+---------------------------------+
| Status sau khi tạo: Chờ duyệt   |
+---------------------------------+
|     [Huỷ]    [Tạo phiếu]        |
+---------------------------------+
```

### 14.2. `/cashbook/sessions/:id` — Phiên quỹ

```
+--------------------------------------+
| Phiên CS-2026-05-22-CN-HCM-003       |
+--------------------------------------+
| Mở lúc: 22/05/2026 07:30 · Thủ quỹ: Tuấn|
| Đầu phiên: 5.000.000 ₫               |
| Status: ● Đang mở (đã 6h)            |
+--------------------------------------+
| Giao dịch trong phiên (12)           |
| | Time | Loại    | Số tiền | Diễn giải|
| | 8:15 | Thu BH  | +850K   | DH-...   |
| | 9:30 | Thu nợ  | +1.2M   | KH-...   |
| | 11:00| Chi VPP | -200K   | Mua giấy |
| | ...                                  |
+--------------------------------------+
| Hệ tính: 12.450.000 ₫                |
| Đếm thực tế: [____________]          |
| Chênh lệch: ...                       |
| Lý do (bắt buộc nếu lệch): [_______]  |
+--------------------------------------+
|          [Đóng phiên]                 |
+--------------------------------------+
```

---

## 15. MODULE PIPELINE, HOẠT ĐỘNG, DỰ ÁN ĐÀN

### 15.1. `/pipeline` (Phase 2)

Kanban board:

```
+---------------------------------------------------------------+
| Pipeline: [Thuốc thú y ▼]   Filter: [Sales tôi]  [+ Cơ hội]   |
+---------------------------------------------------------------+
| Tiếp cận(8) | Tư vấn(5) | Báo giá(4) | Đàm phán(3) | Chốt(2)  |
| ┌─────────┐ | ┌────────┐| ┌────────┐ | ┌────────┐ | ┌──────┐ |
| │KH A     │ | │KH C    │| │KH F    │ | │KH H    │ | │KH J  │ |
| │5tr · 7d │ | │12tr·3d │| │8tr ·2d │ | │25tr·1d │ | │30tr  │ |
| └─────────┘ | └────────┘| └────────┘ | └────────┘ | └──────┘ |
| ...         | ...       | ...        | ...        | ...      |
+---------------------------------------------------------------+
```

**Card cơ hội:**
- Title (truncate 2 dòng)
- Customer name + avatar nhỏ
- Expected value
- Days in current stage (orange nếu > expected)
- Last activity icon + days ago

**Drag-drop card giữa cột:** update stage. Khi drop vào `won` → modal hỏi link Order. Khi drop vào `lost` → modal chọn lost_reason + competitor.

### 15.2. `/activities`

3 view toggle: List / Kanban (by status) / Calendar.

**Calendar view:** tuần view (7 cột), slot khung giờ. Mỗi activity là 1 block màu nhẹ với title.

**Form ghi activity** (mobile bottom sheet):

```
┌──────────────────────────┐
| Ghi hoạt động            |
+--------------------------+
| Loại:                    |
| [📞][💬][📧][📍][📑]      |
|  Gọi Zalo Mail Ghé Catalog|
+--------------------------+
| KH *: [Search...]        |
| Tiêu đề *: [_________]   |
| Kết quả: [__________]    |
| Việc tiếp theo: [___]    |
+--------------------------+
| ○ Đã làm xong            |
| ● Lên lịch [Date Picker] |
+--------------------------+
|   [Lưu]                  |
+--------------------------+
```

### 15.3. `/calendar` (Phase 2)

Tuần view full screen cho sales.

```
+--------------------------------------------+
| ← Tuần 22/05 - 28/05    [Hôm nay] [→]     |
+--------------------------------------------+
| | T2 | T3 | T4 | T5 | T6 | T7 | CN |       |
|8h│    │KH A│    │    │    │    │    │       |
|9h│KH C│    │KH D│    │KH E│    │    │       |
|10│    │    │    │KH F│    │    │    │       |
|11│    │KH B│    │    │    │    │    │       |
|..│    │    │    │    │    │    │    │       |
+--------------------------------------------+
```

Drag để tạo slot. Click slot → modal nhập detail.

### 15.4. `/herd-projects` (Phase 2)

List với card detail mỗi project.

**Card dự án đàn:**

```
┌──────────────────────────────────────────┐
│ 🩺 Vaccine ND + Gumboro 1000 gà          │
│ Trại Anh Tuấn · Khẩn cấp                 │
│ BSTY: Bs Hùng · Bắt đầu: 22/05           │
│                                          │
│ Tiến độ: ●━●━●━○━○ (3/5 steps)           │
│ Hoàn thành dự kiến: 30/05                │
│                                          │
│ [Mở chi tiết]                            │
└──────────────────────────────────────────┘
```

### 15.5. `/herd-projects/:id` — Detail

Tabs: Tổng quan / Các bước / Kết quả / Đơn hàng phát sinh

**Tab Các bước:** vertical stepper với checklist:

```
+----------------------------------------+
| Bước 1: Tiêm Newcastle lần 1   ● Done  |
|   Dự kiến: 22/05 · Thực tế: 22/05      |
|   BSTY: Bs Hùng                        |
|   SP: Vacc ND L24-005 · 200 liều       |
|   Ghi chú: ...                         |
|   📷 [3 ảnh]                            |
+----------------------------------------+
| Bước 2: Tiêm Gumboro          ● Done   |
|   ...                                  |
+----------------------------------------+
| Bước 3: Kiểm tra hao hụt (7d) ⏰ Đến hạn|
|   Dự kiến: 29/05                        |
|   [Thực hiện ngay]                      |
+----------------------------------------+
| Bước 4: Tiêm ND lần 2          ○ Pending|
+----------------------------------------+
```

**Tab Kết quả:** form đánh giá khi dự án `completed`:
- KH rating (5 sao)
- KH comment
- Mortality count → auto % vs target_herd_size
- Effectiveness assessment dropdown
- Internal vet notes
- Lessons learned
- Upload ảnh sau

---

## 16. MODULE BÁO CÁO

### 16.1. `/reports` — Hub

Grid cards theo 7 nhóm. Mỗi card:

```
┌──────────────────────────┐
│ 📊 Doanh thu             │
│                          │
│ • Doanh thu theo thời gian│
│ • Theo chi nhánh         │
│ • Theo SP / Category     │
│ • Top KH                 │
│                          │
│ [Xem báo cáo]            │
└──────────────────────────┘
```

### 16.2. Báo cáo detail (template chung)

```
+----------------------------------------------+
| ← Báo cáo / Doanh thu theo thời gian         |
+----------------------------------------------+
| Filter: Date [01/01 - 22/05]  Chi nhánh ▼   |
|         Sales ▼  SP category ▼              |
| [Áp dụng]  [Xuất Excel]  [In]                |
+----------------------------------------------+
| KPIs row:                                    |
| ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         |
| │Tổng  │ │Số đơn│ │AOV   │ │Margin│         |
| │1.2 tỷ│ │ 245  │ │5tr   │ │35%   │         |
| └──────┘ └──────┘ └──────┘ └──────┘         |
+----------------------------------------------+
| Chart: Line chart doanh thu theo ngày        |
|       [Toggle: Theo tuần / Tháng / Quý]      |
+----------------------------------------------+
| Bảng chi tiết drill-down                     |
+----------------------------------------------+
```

Mọi báo cáo có pattern này. Phase 1 build báo cáo doanh thu + công nợ + tồn kho.

### 16.3. Export Excel

Mọi báo cáo có nút "Xuất Excel" → Edge Function generate XLSX → download. Template kế toán VN cho sổ quỹ.

---

## 17. GLOBAL SEARCH & NOTIFICATIONS

### 17.1. Global Search (Ctrl+K)

Modal full screen overlay:

```
+--------------------------------------------+
| 🔍 Tìm KH, SP, đơn... (gõ tiếng Việt OK)  |
+--------------------------------------------+
| Kết quả gần đây:                           |
| ◷ Trại Anh Tuấn (KH)                       |
| ◷ DH-2026-00042 (Đơn)                      |
|                                            |
| Tìm thấy 23 kết quả:                       |
|                                            |
| KHÁCH HÀNG (5)                             |
|   ● Trại Anh Tuấn          KH-2026-00042  |
|   ● Trại A Tuấn (Bình Dương) KH-2026-00128|
|   [Xem thêm 3 →]                           |
|                                            |
| SẢN PHẨM (3)                               |
|   ● Amoxicillin tuấn-pharma                |
|   ...                                      |
|                                            |
| ĐƠN HÀNG (8)                               |
|   ● DH-2026-00042 · Trại Anh Tuấn          |
|   ...                                      |
|                                            |
| HOẠT ĐỘNG có chứa "anh tuấn" (7)           |
|   ● Gọi điện · 20/05 · "...A Tuấn..."     |
|   ...                                      |
+--------------------------------------------+
```

- Group theo entity type
- Mỗi group max 5, "Xem thêm" mở list page pre-filtered
- ↑↓ navigate, Enter mở
- Esc đóng

**Mobile:** full-screen overlay, không phải modal.

### 17.2. Notifications dropdown

Click chuông topbar:

```
+--------------------------------+
| Thông báo (3 chưa đọc)         |
| [Đánh dấu tất cả đã đọc]       |
+--------------------------------+
| 🛒 Đơn mới · 5p trước         |
|   DH-2026-00042 từ KH A Tuấn  |
|                                |
| 💳 Công nợ sắp đáo · 1h trước |
|   Trại C Hoa - còn 3 ngày     |
|                                |
| ⏰ Lô hết HSD · 3h trước      |
|   Vacc ND L24-005 còn 30 ngày |
|                                |
| [Xem tất cả →]                 |
+--------------------------------+
```

Icon trái không màu (gray-500). Unread có dot 6px `blue-500` đầu dòng.

### 17.3. `/notifications` page

List đầy đủ, filter theo type/severity/read_status, mark as read.

---

## 18. MODULE QUẢN TRỊ

### 18.1. `/admin` (chỉ admin)

Sidebar phụ:
- Người dùng & Phân quyền
- Vai trò
- Quyền chi tiết
- Audit log
- Danh mục (categories, brands, species, diseases, lookup tables)
- Cài đặt hệ thống
- Import / Export data
- Backup

### 18.2. `/admin/users`

Table với filter:
- Search
- Filter: role, branch, team, active
- Bulk action: deactivate

Row: avatar + name + employee_code + email + roles (chips) + last_seen + status.

Click → detail with tabs: Info / Roles / Recent Activity / Sessions.

### 18.3. `/admin/roles`

```
+-------------------------------------+
| Vai trò              [+ Tạo vai trò]|
+-------------------------------------+
| Role                | Số người| Sửa |
+-------------------------------------+
| Admin               | 2      | [✏] |
| CEO                 | 1      | [✏] |
| Branch director     | 4      | [✏] |
| Team lead           | 8      | [✏] |
| Sales               | 32     | [✏] |
| Vet                 | 5      | [✏] |
| Warehouse keeper    | 6      | [✏] |
| Accountant          | 3      | [✏] |
| Purchaser           | 2      | [✏] |
+-------------------------------------+
```

Click sửa → modal lớn với permissions matrix (checkbox):

```
+---------------------------------------------+
| Sửa vai trò: Sales                          |
+---------------------------------------------+
| Tên: [Sales]                                |
| Mô tả: [Nhân viên kinh doanh đi thị trường] |
+---------------------------------------------+
| Quyền:                                      |
|                                             |
| ▼ Khách hàng (5/14)                         |
|   [✓] Xem KH cùng team                      |
|   [✓] Tạo KH mới                            |
|   [✓] Sửa KH của mình                       |
|   [ ] Xem tất cả KH                         |
|   ...                                       |
|                                             |
| ▼ Đơn hàng (8/15)                           |
|   ...                                       |
|                                             |
| ▼ Sổ quỹ (1/8)                              |
|   [✓] Tạo phiếu thu                         |
|   [ ] Tạo phiếu chi                         |
|   ...                                       |
+---------------------------------------------+
|  [Huỷ]   [Lưu thay đổi]                     |
+---------------------------------------------+
```

### 18.4. `/admin/audit-logs`

Filter: entity_type, action, user, date_range.

```
+----------------------------------------------+
| Time     | User   | Action   | Entity      ||
+----------------------------------------------+
| 14:30 22/5| Tuấn  | price_override | DH-042 ||
|           |       | 85K → 75K       |       ||
+----------------------------------------------+
| 13:15    | Hoa   | create   | KH-128       ||
+----------------------------------------------+
| ...                                          |
+----------------------------------------------+
```

Click row → detail modal với before/after diff.

---

## 19. RESPONSIVE RULES

### 19.1. Breakpoints

```
sm:  640px  (mobile landscape, tablet portrait)
md:  768px  (tablet landscape)
lg:  1024px (desktop nhỏ)
xl:  1280px (desktop chuẩn)
2xl: 1536px (desktop lớn)
```

### 19.2. Layout patterns by breakpoint

| Element | < 768px | 768-1024px | ≥ 1024px |
|---|---|---|---|
| Sidebar | Drawer (hidden default) | Collapsed icons (78px) | Full (240px) |
| Bottom nav | Visible | Hidden | Hidden |
| FAB | Visible | Hidden | Hidden |
| TopBar search | Icon → overlay | Inline narrow | Inline 320px |
| Table | Card list | Table compact | Table full |
| Form columns | 1 col | 2 col | 2-3 col |
| Modal | Bottom sheet | Modal centered | Modal centered |
| Dashboard widgets | 1 col stack | 2 col grid | 12 col grid |
| Filter panel | Bottom sheet drawer | Collapsible 260px | Always visible 260px |

### 19.3. Touch targets

- Mobile button min height 44px
- Tap targets min 44×44px
- Spacing giữa tappable elements min 8px

### 19.4. Mobile-specific behaviors

- Swipe right on list row → reveal action (delete/edit)
- Swipe down on bottom sheet → close
- Pull to refresh trên list view
- Long-press card → contextual menu

---

## 20. ACCESSIBILITY

### 20.1. Color contrast

Mọi text/bg combo đạt WCAG AA:
- Normal text: contrast ratio ≥ 4.5:1
- Large text (18px+ regular hoặc 14px+ bold): ≥ 3:1
- Icon: ≥ 3:1 với bg

Test `gray-500` text on `gray-0` bg = 7.1:1 ✓
Test `blue-500` text on `gray-0` bg = 6.8:1 ✓
Test white on `blue-500` bg = 7.2:1 ✓

### 20.2. Keyboard navigation

- Tab order tự nhiên
- Focus ring visible: `ring-2 ring-blue-500 ring-offset-2`
- Skip-to-content link đầu page
- Esc đóng modal/dropdown
- Enter activate button
- Arrow keys trong list/menu/grid

### 20.3. Screen reader

- `aria-label` cho icon-only button
- `aria-live` cho toast/alert
- `role` cho custom widgets
- Form field gắn label đúng (`htmlFor` + `id`)
- Table có `<thead>` `<tbody>` `<th scope>`

### 20.4. Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### 20.5. Font size respect

- Không hardcode `px` cho font khi có thể; dùng `rem`
- Base 16px = 1rem
- User zoom 200% phải vẫn dùng được

---

## 21. HƯỚNG DẪN DÙNG VỚI STITCH

### 21.1. Thứ tự thiết kế bằng Stitch

**Tuần 1 — Foundation:**
1. Tạo design system file đầu tiên: paste palette + typography + tokens vào Stitch
2. Component library: build từng component (Button, Input, Card, Badge, Table, Modal) — copy spec từ Section 6
3. Layout shell: Desktop (TopBar + Sidebar + Main) và Mobile (TopBar + BottomNav + FAB)

**Tuần 2 — Auth & Dashboard:**
4. `/login`, `/forgot-password`, `/reset-password`
5. Dashboard cho 5 role (Sales, Team_lead, Vet, Warehouse, Admin/CEO)

**Tuần 3-4 — Core CRUD pages (Phase 1):**
6. Customers: list + detail + form
7. Products: list + detail + form
8. Orders: POS + new order mobile + list + detail
9. Inventory: list lots + alerts
10. Suppliers: list + detail
11. Purchase orders + Goods receipts
12. Sales returns
13. Customer debts + collection receipt
14. Cashbook: list + new inflow/outflow + session detail
15. Reports hub + 3 báo cáo Phase 1 (doanh thu / công nợ / tồn)
16. Admin: users + roles + audit

**Tuần 5+ — Phase 2:**
17. Pipeline Kanban
18. Activities + Calendar
19. Herd projects
20. Promotions
21. Báo cáo nâng cao

### 21.2. Prompt template cho Stitch

Mỗi page prompt theo template:

```
Build [PAGE NAME] for Vietnamese veterinary CRM.

Design system:
- Primary color: #1E5A9C (blue-500)
- Font: Be Vietnam Pro, weights 400/500/600 only
- Card: white bg, border 1px #E5E9EE, radius 10px, padding 24px
- Button primary: bg #1E5A9C text white radius 8px height 40px
- Input: border 1px #CCD3DB, radius 8px, focus ring #D6E4F4
- No emoji, no gradient, no shadow except modals
- Vietnamese text throughout

Page spec:
[paste section content from file 02]

Output: single HTML file with inline Tailwind CSS, ready to import into Figma via Anima or similar.
```

### 21.3. Components Stitch nên build trước

Ưu tiên build 10 component này thành reusable trước khi build pages:

1. `<Button variant="primary|ghost|outline">`
2. `<Input>` với label/helper/error states
3. `<Select>` single & multi
4. `<Card>` với header/body/footer slots
5. `<Badge variant="default|primary|outline">`
6. `<Table>` với column config
7. `<Modal>`
8. `<BottomSheet>` (mobile)
9. `<TopBar>` với search + bell + avatar
10. `<Sidebar>` với nav items

### 21.4. File deliverables từ Stitch

Cuối cùng cần xuất:
- **Figma file** (qua Anima/Locofy plugin) có:
  - Design system page (tokens, colors, typography)
  - Component library page
  - Per-module pages cho mọi screen (60+ screens total)
- **Style guide PDF** in màu mã hex chính xác
- **Component spec sheet** cho frontend dev

### 21.5. Hand-off cho frontend dev

Sau khi Stitch xong:
1. Tạo file `tailwind.config.ts` chứa palette + spacing + typography đã chốt
2. Init shadcn/ui rồi override theme colors
3. Build component library trong `src/components/ui/` theo Figma component
4. Lập storybook (optional) để review từng component isolated
5. Build pages theo thứ tự ưu tiên Phase 1 → Phase 2 → Phase 3

---

## PHỤ LỤC A — Tailwind Config Tokens

File tham khảo để paste vào `tailwind.config.ts` đầu dự án:

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        blue: {
          50:  '#EEF4FB',
          100: '#D6E4F4',
          200: '#AEC9E9',
          300: '#7BA6D8',
          400: '#4D85C5',
          500: '#1E5A9C',  // PRIMARY
          600: '#194B82',
          700: '#143C69',
          800: '#0F2E51',
          900: '#0A1F38',
        },
        gray: {
          0:   '#FFFFFF',
          25:  '#FAFBFC',
          50:  '#F4F6F8',
          100: '#E5E9EE',
          200: '#CCD3DB',
          300: '#A8B2BD',
          400: '#6B7785',
          500: '#4A5663',
          600: '#2F3947',
          700: '#1F2731',
          900: '#0D131B',
        },
        success: { 500: '#2E7D5B' },
        warning: { 500: '#B8722C' },
        danger:  { 500: '#B23A3A' },
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontWeight: {
        normal:   '400',
        medium:   '500',
        semibold: '600',
      },
      borderRadius: {
        sm:   '4px',
        md:   '6px',
        DEFAULT: '8px',
        lg:   '10px',
        xl:   '14px',
        '2xl':'20px',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        sm: '0 2px 6px -1px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
        md: '0 8px 24px -4px rgba(15, 23, 42, 0.10), 0 4px 8px rgba(15, 23, 42, 0.04)',
      },
      fontSize: {
        'tiny':      ['12px', '16px'],
        'caption':   ['13px', '18px'],
        'body':      ['14px', '20px'],
        'body-lg':   ['16px', '24px'],
        'h3':        ['17px', '24px'],
        'h2':        ['20px', '28px'],
        'h1':        ['24px', '32px'],
        'display':   ['32px', '40px'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config
```

---

## PHỤ LỤC B — Checklist hand-off

Sau khi designer xong, dev nhận:

- [ ] Figma file với design system page + component library + 60+ screens
- [ ] Style guide hex codes đầy đủ
- [ ] Icon list (lucide names + size + usage)
- [ ] Spacing/Radius/Shadow tokens
- [ ] Typography scale với line-height
- [ ] Responsive specs (mobile/tablet/desktop) cho mọi page key
- [ ] Component states (default/hover/focus/active/disabled/loading/error)
- [ ] Animation specs (duration + easing) nếu có
- [ ] Print preview specs cho hoá đơn, biên lai, báo giá
- [ ] PWA splash screen + icon (mobile install)

---

**HẾT FILE**

File này đặc tả giao diện. Đọc kèm `01-FUNCTIONAL-SPEC.md` để hiểu business rules.

Khi build với Stitch: bắt đầu từ design system + 10 components core, rồi đến Layout shell, rồi đến pages theo Phase 1 ưu tiên.
