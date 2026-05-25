// Logger helper – chỉ output ở DEV để tránh rò rỉ thông tin runtime ở production.
// Dùng thay cho console.log/info/debug trong source. console.error/warn vẫn giữ
// vì cần thiết khi user gặp lỗi thực tế.

const isDev = (import.meta as any).env?.DEV === true

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console.debug(...args)
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info(...args)
  },
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args)
  },
  warn: (...args: unknown[]) => {
    console.warn(...args)
  },
  error: (...args: unknown[]) => {
    console.error(...args)
  },
}

export default logger
