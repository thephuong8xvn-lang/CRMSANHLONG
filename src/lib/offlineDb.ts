// ─────────────────────────────────────────────────────────────
// offlineDb — IndexedDB cho POS offline (qua idb).
// 2 store:
//   • kv     : snapshot danh mục bán hàng (theo nhân viên) + meta thời điểm.
//   • queue  : hàng đợi ĐƠN BÁN NHANH chờ đẩy lên server khi có mạng lại.
//
// Vì sao: mất mạng/mất điện giữa ca không được làm mất đơn đã bán, và khi đẩy
// lại KHÔNG được tính tiền 2 lần (server dedup theo client_request_id —
// migration 20260724000000_pos_offline_idempotency).
// ─────────────────────────────────────────────────────────────
import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'crm-pos-offline'
const DB_VERSION = 1

// Snapshot tồn/giá coi là "còn tin được" trong 72h (quyết định nghiệp vụ).
export const SNAPSHOT_TTL_MS = 72 * 60 * 60 * 1000

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbp: Promise<IDBPDatabase> | null = null
function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv')
        if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id' })
      },
    })
  }
  return dbp
}

// ── Snapshot danh mục POS (theo nhân viên) ──
export interface PosSnapshot {
  savedAt: number
  data: Record<string, unknown> // customers, products, priceLists, categories, warehouses, stockLots, ...
}

const snapKey = (userId: string) => `pos-snapshot:${userId}`

/** Lưu/ghép snapshot danh mục. Gọi sau mỗi lần nạp dữ liệu online thành công. */
export async function savePosSnapshot(userId: string, partial: Record<string, unknown>): Promise<void> {
  if (!hasIDB() || !userId) return
  try {
    const d = await db()
    const prev = (await d.get('kv', snapKey(userId))) as PosSnapshot | undefined
    const merged: PosSnapshot = {
      savedAt: Date.now(),
      data: { ...(prev?.data ?? {}), ...partial },
    }
    await d.put('kv', merged, snapKey(userId))
  } catch {
    /* quota / không khả dụng → bỏ qua, không làm gãy bán hàng */
  }
}

/** Đọc snapshot. Trả {data, savedAt, ageMs, stale} hoặc null nếu chưa có. */
export async function loadPosSnapshot(
  userId: string,
): Promise<{ data: Record<string, unknown>; savedAt: number; ageMs: number; stale: boolean } | null> {
  if (!hasIDB() || !userId) return null
  try {
    const snap = (await (await db()).get('kv', snapKey(userId))) as PosSnapshot | undefined
    if (!snap) return null
    const ageMs = Date.now() - snap.savedAt
    return { data: snap.data, savedAt: snap.savedAt, ageMs, stale: ageMs > SNAPSHOT_TTL_MS }
  } catch {
    return null
  }
}

// ── Hàng đợi đơn bán nhanh offline ──
export interface PosQueueItem {
  id: string // = client_request_id (idempotency)
  userId: string
  payload: Record<string, unknown> // payload fn_pos_quick_sale (CHƯA gồm client_request_id)
  label: string // tóm tắt hiển thị: tên khách + tổng tiền
  createdAt: number
  status: 'pending' | 'failed'
  error?: string
  attempts: number
}

export async function enqueueSale(item: Omit<PosQueueItem, 'createdAt' | 'status' | 'attempts'>): Promise<void> {
  if (!hasIDB()) throw new Error('Trình duyệt không hỗ trợ lưu offline (IndexedDB).')
  const full: PosQueueItem = { ...item, createdAt: Date.now(), status: 'pending', attempts: 0 }
  await (await db()).put('queue', full)
}

export async function listQueue(userId?: string): Promise<PosQueueItem[]> {
  if (!hasIDB()) return []
  try {
    const all = (await (await db()).getAll('queue')) as PosQueueItem[]
    const rows = userId ? all.filter((r) => r.userId === userId) : all
    return rows.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function removeQueued(id: string): Promise<void> {
  if (!hasIDB()) return
  try {
    await (await db()).delete('queue', id)
  } catch {
    /* noop */
  }
}

export async function updateQueued(id: string, patch: Partial<PosQueueItem>): Promise<void> {
  if (!hasIDB()) return
  try {
    const d = await db()
    const cur = (await d.get('queue', id)) as PosQueueItem | undefined
    if (cur) await d.put('queue', { ...cur, ...patch })
  } catch {
    /* noop */
  }
}
