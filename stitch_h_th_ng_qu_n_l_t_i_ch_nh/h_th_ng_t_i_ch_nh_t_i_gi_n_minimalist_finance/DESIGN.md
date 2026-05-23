---
name: Hệ thống Tài chính Tối giản (Minimalist Finance)
colors:
  surface: '#f8f9ff'
  surface-dim: '#d0dbed'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dfe9fb'
  surface-container-highest: '#d9e3f5'
  on-surface: '#121c29'
  on-surface-variant: '#424750'
  inverse-surface: '#27313f'
  inverse-on-surface: '#eaf1ff'
  outline: '#727781'
  outline-variant: '#c2c6d2'
  surface-tint: '#265fa2'
  primary: '#00427d'
  on-primary: '#ffffff'
  primary-container: '#1e5a9c'
  on-primary-container: '#b6d2ff'
  inverse-primary: '#a5c8ff'
  secondary: '#54606d'
  on-secondary: '#ffffff'
  secondary-container: '#d7e4f4'
  on-secondary-container: '#596673'
  tertiary: '#004c32'
  on-tertiary: '#ffffff'
  tertiary-container: '#0e6646'
  on-tertiary-container: '#92e1b8'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d4e3ff'
  primary-fixed-dim: '#a5c8ff'
  on-primary-fixed: '#001c3a'
  on-primary-fixed-variant: '#004785'
  secondary-fixed: '#d7e4f4'
  secondary-fixed-dim: '#bbc8d7'
  on-secondary-fixed: '#111d28'
  on-secondary-fixed-variant: '#3c4855'
  tertiary-fixed: '#a4f3ca'
  tertiary-fixed-dim: '#88d6af'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f8f9ff'
  on-background: '#121c29'
  surface-variant: '#d9e3f5'
typography:
  display-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 60px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Be Vietnam Pro
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  label-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 20px
  label-md:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: '4'
  card-padding: 24px
  card-padding-mobile: 16px
  sidebar-width: 240px
  header-height: 64px
  input-height: 40px
  desktop-margin: 40px
  mobile-margin: 16px
---

[SHARED DESIGN SYSTEM & BRAND RULES]
- Brand Style: Minimalism, Clean, Professional, Trustworthy (Banking dashboard feel).
- Theme: Light Mode only. Absolutely NO dark mode, NO glassmorphic effect, NO gradients.
- Typography: Font 'Be Vietnam Pro', weights: 400 (Regular), 500 (Medium), 600 (Semibold) only.
- Colors:
  * Primary Accent: #1E5A9C (blue-500)
  * Hover Primary: #194B82 (blue-600)
  * Pressed Primary: #143C69 (blue-700)
  * Page Background: #FAFBFC (gray-25)
  * Card Background: #FFFFFF (gray-0) with border 1px #E5E9EE (gray-100), radius 10px, padding 24px (16px on mobile). No shadow.
  * Inputs: border 1px #CCD3DB (gray-200), radius 8px, height 40px, focus ring #D6E4F4 (blue-100) 4px.
  * Text Colors: Primary text #2F3947 (gray-600), Headings #1F2731 (gray-700), Secondary text #4A5663 (gray-500), Captions/Placeholders #6B7785 (gray-400).
  * Semantics (strict): Success text/icon #2E7D5B (success-500), Warning #B8722C (warning-500), Danger/Delete #B23A3A (danger-500).
  * Badges Rule: NO solid background color for semantic status badges. Use background gray-50 (#F4F6F8) with gray-100 border and gray-700 text + a small colored indicator dot. Solid blue-500 only for "VIP" badge.
- Numeric Display: Vietnamese standard formatting (e.g., 1.250.000 ₫). Shortened: 1,25 tr or 1,25 tỷ. Use font-variant-numeric: tabular-nums for aligned columns.
- Language: 100% Vietnamese. Do not use English words or emojis.
- Output: A single clean HTML file utilizing inline Tailwind CSS, ready for Figma import.

[SHARED DESIGN SYSTEM & BRAND RULES]

Build a Figma component sheet containing the core atomic components:
1. Buttons: Primary (bg #1E5A9C, text white, radius 8px, height 40px), Ghost (transparent bg, text #1E5A9C), Outline (white bg, border 1px #E5E9EE, text #2F3947). Show states: default, hover, focus, disabled, loading.
2. Inputs: Default text input, Input with prefix icon (Search), Input with suffix (₫), and Textarea. Label: 13px medium #4A5663, Helper/Error: 12px #6B7785.
3. Dropdown/Combobox: Searchable Select with active option highlighting.
4. Badges: Default (gray bg, gray border, dot icon), Active (blue-50 bg, blue-700 text), Alert (gray bg, dot warning, text "Lưu ý").
5. Switches: Toggle switch (Off: #A8B2BD, On: #1E5A9C).
6. Tooltips: Dark gray bg (#2F3947) with arrow, white text.
7. Steppers: Horizontal (Completed, Active, Inactive states) and Vertical Stepper.
8. Stepper Input: [-] [ 24 ] [+] quantity stepper (buttons 40x40px).

[SHARED DESIGN SYSTEM & BRAND RULES]

Build the Layout Shell with two layouts:
1. Desktop Layout (w >= 1024px):
   - Left Sidebar (width 240px, bg #FFFFFF, border-right 1px #E5E9EE). Nav Items: Tổng quan, Khách hàng, Sản phẩm & Giá, Kho hàng, POS & Đơn hàng, Sổ quỹ, Dự án kỹ thuật, Báo cáo, Quản trị. Active state has #blue-50 bg, text #blue-700 bold, left border 3px #1E5A9C.
   - Top Header Bar (height 64px, bg #FFFFFF, border-bottom 1px #E5E9EE): Left has breadcrumbs. Right has Search input (Ctrl+K), Notification Bell Icon with unread red dot, and User Avatar (initials "SL", dropdown menu).
   - Content Panel: scrollable body with background #FAFBFC.
2. Mobile Layout (w < 768px):
   - Top Bar: Page Title, Search Icon, Profile Avatar.
   - Bottom Tab Navigation: 5 items (Trang chủ, Khách hàng, Tạo đơn POS, Sổ quỹ, Thông báo).
   - FAB (Floating Action Button): Blue round button with Plus icon at bottom right.