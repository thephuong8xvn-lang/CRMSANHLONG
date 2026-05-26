# 05 – Performance Playbook

> Áp dụng từ Sprint P0–P3. Đọc trước khi merge bất kỳ PR nào có thay đổi UI, query, hoặc thêm dependency mới.

---

## 1. Pattern chuẩn: Data fetching

### ✅ Dùng TanStack Query + Supabase `.range()`

```ts
// src/hooks/queries/useCustomers.ts
export function useCustomers({ page, search }: { page: number; search: string }) {
  return useQuery({
    queryKey: ['customers', page, search],
    queryFn: async () => {
      const from = page * PAGE_SIZE
      const { data, count } = await supabase
        .from('customer_summary_view')   // dùng view, không JOIN thô
        .select('*', { count: 'exact' })
        .ilike('farm_name', `%${search}%`)
        .range(from, from + PAGE_SIZE - 1)
        .order('created_at', { ascending: false })
      return { data: data ?? [], total: count ?? 0 }
    },
    staleTime: 60_000,      // 1 phút — không refetch khi navigate lại
    placeholderData: keepPreviousData,
  })
}
```

**Quy tắc:**
- Luôn `.range(from, to)` — không bao giờ fetch all rows rồi filter ở client
- Dùng Supabase Views/RPCs cho query phức tạp (JOIN nhiều bảng), không làm ở client
- `staleTime ≥ 30_000` cho dữ liệu không thay đổi real-time (products, categories)
- `staleTime = 0` chỉ cho dashboard stats cần fresh

### ❌ Tránh

```ts
// ❌ Fetch toàn bộ rồi filter — sập khi data lớn
const { data } = await supabase.from('orders').select('*')
const filtered = data.filter(o => o.status === 'pending')

// ❌ N+1: gọi trong loop
for (const order of orders) {
  const customer = await supabase.from('customers').select().eq('id', order.customer_id)
}
```

---

## 2. Pattern chuẩn: Search

### Server-side search (gọi DB)

```ts
// Luôn debounce trước khi gửi query
const debouncedSearch = useDebouncedValue(searchTerm, 300)

useEffect(() => {
  query.ilike('description', `%${debouncedSearch.trim()}%`)
}, [debouncedSearch])          // ← dùng debounced, KHÔNG dùng searchTerm raw
```

### Client-side filter (filter mảng đã load)

```ts
const filteredRows = useMemo(
  () => rows.filter(r => r.name.toLowerCase().includes(debouncedSearch.toLowerCase())),
  [rows, debouncedSearch]      // ← useMemo + debounced, không tính lại mỗi render
)
```

**Quy tắc:**
- Search box nào trigger DB query → **bắt buộc debounce 300ms**
- Search box filter client-side array → debounce + `useMemo`
- Không dùng `searchTerm` trực tiếp trong dependency array của `useEffect` gọi DB

---

## 3. Pattern chuẩn: Rendering

### Danh sách dài (> 100 items) → Virtualize

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'

const COLS = 3
const productRows = useMemo(() => chunk(filteredProducts, COLS), [filteredProducts])
const parentRef = useRef<HTMLDivElement>(null)

const rowVirtualizer = useVirtualizer({
  count: productRows.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 96,
  overscan: 3,
  measureElement: el => el.getBoundingClientRect().height,
})

// render: chỉ virtualItems được mount vào DOM
```

**Áp dụng hiện tại:** POS product grid.  
**Cần áp dụng thêm:** Inventory lot table nếu > 500 lô.

### Memoization

```ts
// useCallback: handler truyền xuống child hoặc dùng trong useEffect
const addToCart = useCallback((product: Product) => {
  setCart(prev => [...prev, { ...product }])   // functional setState — không cần cart trong deps
}, [])                                          // ← deps rỗng vì functional setState

// useMemo: giá trị tính toán từ state/props
const subtotal = useMemo(
  () => cart.reduce((sum, row) => sum + row.unit_price * row.qty, 0),
  [cart]
)
```

**Quy tắc:**
- `useCallback` cho mọi handler truyền qua props hoặc dùng trong `useRealtimeTable`
- `useMemo` cho filter/reduce/sort chạy trên array > 50 phần tử
- Dùng **functional `setState(prev => ...)`** để tránh stale closure — không cần state trong deps

---

## 4. Pattern chuẩn: Loading state

### Skeleton thay spinner

```tsx
import { Skeleton } from '../../components/Skeleton'

// ✅ Skeleton — không layout shift, match layout cuối
{loading ? (
  <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={6} /></tbody></table>
) : rows.length === 0 ? (
  <EmptyState />
) : (
  <table>...</table>
)}

// ❌ Spinner — gây layout shift khi data vào
{loading && <div className="animate-spin" />}
```

**Quy tắc:** `count` của `Skeleton.TableRows` = số rows trung bình thấy được; `cols` = số cột thật của bảng.

---

## 5. Pattern chuẩn: Realtime

```ts
import { useRealtimeTable } from '../../hooks/useRealtimeTable'

// Trong component — tự cleanup khi unmount
useRealtimeTable({
  table: 'orders',
  event: 'INSERT',
  onData: loadOrders,    // stable ref (useCallback)
})
```

**Quy tắc:**
- `onData` **phải là `useCallback`** — nếu không, `useRealtimeTable` re-subscribe mỗi render
- Chỉ subscribe table thực sự cần real-time: `orders`, `cashbook_transactions`, `notifications`
- Không subscribe table master ít thay đổi (`products`, `customers`, `categories`)

---

## 6. Pattern chuẩn: Image

```tsx
import { ProductImage } from '../../components/ProductImage'

// ✅ Lazy load, fallback tự động, lỗi URL tự ẩn
<ProductImage src={product.image_urls?.[0]} alt={product.name} fit="cover" />

// ❌ Không dùng <img> thô cho ảnh sản phẩm
<img src={product.image_urls[0]} alt={product.name} />
```

**Quy tắc:** Mọi ảnh sản phẩm đều qua `<ProductImage>`. Không dùng `<img>` thô trừ logo/avatar cố định.

---

## 7. Checklist trước khi merge PR

```
□ Search box mới → có debounce 300ms không?
□ Filter client-side mới → có useMemo không?
□ Handler truyền qua props → có useCallback không?
□ Danh sách > 100 items → có cân nhắc virtual scroll không?
□ Loading state → dùng Skeleton, không dùng spinner text?
□ Ảnh sản phẩm → dùng <ProductImage>, không dùng <img> thô?
□ Query mới gọi DB → có .range() hoặc server-side filter không?
□ Realtime subscribe mới → onData có phải useCallback không?
□ Dependency mới → chạy `npm run build` kiểm tra chunk size?
```

---

## 8. Bundle budget

| Chunk | Budget | Hiện tại (P3) | Hành động nếu vượt |
|---|---|---|---|
| `react-vendor` | ≤ 350 kB | ~307 kB | Kiểm tra dep mới thêm vào react-vendor |
| `supabase` | ≤ 220 kB | ~201 kB | Không thêm Supabase plugin nặng |
| `charts` | ≤ 360 kB | ~340 kB | Lazy import thêm chart type |
| `icons` | ≤ 50 kB | ~44 kB | Dùng `import { X } from 'lucide-react'`, không `import *` |
| Mỗi page chunk | ≤ 100 kB | ≤ 93 kB | Tách thêm nếu > 100 kB |
| `index` (main) | ≤ 80 kB | ~77 kB | Route mới → `React.lazy` + `Suspense` |

Kiểm tra sau mỗi PR có thêm dependency:
```bash
npm run build
# Xem output — chunk nào tăng > 10 kB so với budget thì điều tra
```

---

## 9. Web Vitals targets

| Metric | Target | Đo bằng |
|---|---|---|
| FCP | ≤ 1.8s | `web_vitals_logs` table, Lighthouse |
| LCP | ≤ 2.5s | `web_vitals_logs` table, Lighthouse |
| INP | ≤ 200ms | `web_vitals_logs` table |
| CLS | ≤ 0.1 | `web_vitals_logs` table |
| TTFB | ≤ 800ms | `web_vitals_logs` table |

Query xem metric 7 ngày gần nhất:
```sql
SELECT name, rating, round(avg(value)::numeric, 2) AS avg_value, count(*) AS samples
FROM web_vitals_logs
WHERE created_at >= now() - interval '7 days'
GROUP BY name, rating
ORDER BY name, rating;
```

---

## 10. Khi nào cần Sprint performance mới?

Mở Sprint P-next khi:
- Bất kỳ Web Vital nào vượt target sau deploy production
- Chunk `index` hoặc page chunk vượt budget
- User báo lag khi scroll list > 200 items
- Supabase DB CPU > 80% sustained (check Supabase Dashboard)
