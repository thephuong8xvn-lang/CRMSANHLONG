import { useEffect, useState } from 'react'

// useDebouncedValue – trả về value sau khi ngừng thay đổi `delayMs` mili giây.
// Dùng cho ô search/filter để tránh fire query mỗi keystroke.
export function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])

  return debounced
}
