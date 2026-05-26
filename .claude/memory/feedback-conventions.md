---
name: feedback-conventions
description: Quy tắc làm việc, lỗi cần tránh, phong cách code đã được user xác nhận
metadata:
  type: feedback
---

## Nguồn sự thật

Luôn đọc `roadmap_tasks.md` và `docs/` trước khi bắt đầu task mới. Không tự phán đoán scope.

**Why:** User đã thiết lập roadmap chi tiết làm "single source of truth". Làm ngoài scope gây waste.  
**How to apply:** Tìm task trong roadmap → đọc bullet points → làm đúng theo đó.

---

## PowerShell PATH

Mỗi lần chạy npm/node trong PowerShell, reload PATH trước:
```powershell
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
& "C:\Program Files\nodejs\npm.cmd" <command>
```

**Why:** PowerShell session trên máy này không tự nhận PATH của Node.js.  
**How to apply:** Áp dụng mọi lần chạy npm/npx trong PowerShell tool.

---

## Vitest config — phải dùng vitest/config

Phải dùng `import { defineConfig } from 'vitest/config'` (không phải `from 'vite'`) khi có block `test:`.

**Why:** `vite`'s `defineConfig` không biết về Vitest's `test` property → TS error 2769.

---

## E2E files bị Vitest pick up

Thêm `exclude: ['**/e2e/**']` vào block `test:` trong `vite.config.ts`.

**Why:** Playwright's `test.describe()` conflict với Vitest khi cùng được load trong jsdom environment.

---

## useCallback cho stable ref truyền vào useRealtimeTable

Hàm `onData` truyền vào `useRealtimeTable` phải được bọc `useCallback(..., [])`.

**Why:** Function mới mỗi render → effect re-subscribe liên tục → memory leak.  
**How to apply:** Mọi khi dùng `useRealtimeTable`, kiểm tra `onData` có stable ref chưa.

---

## Không import hook khi không dùng

Chỉ import hook khi thực sự dùng trong file đó. (Ví dụ: `useCallback` trong Layout.tsx đã gây unused import error.)

---

## Phong cách migration SQL

Đặt tên: `YYYYMMDDXXXXXX_kebab-case-description.sql`. Số thứ tự 000000–000029 cho ngày 2026-05-26. Mỗi migration có comment section header `-- ─────────────────────` rõ ràng.

---

## Không tạo file markdown mới trừ khi user yêu cầu

Không tạo planning/analysis docs thừa. Ghi ngữ cảnh vào `roadmap_tasks.md` nếu cần lưu lại.
