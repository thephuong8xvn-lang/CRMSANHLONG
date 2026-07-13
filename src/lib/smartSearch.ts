// Tìm kiếm thông minh dùng chung (SP, lô, khách…).
// Vấn đề của `name.includes(q)`: gõ "MKV Doxy" không ra "MKV-Doxy 50% kg" vì dấu "-".
// Cách làm: bỏ dấu tiếng Việt → hạ chữ thường → mọi ký tự không phải chữ/số thành khoảng trắng,
// rồi yêu cầu MỌI token của câu tìm đều xuất hiện (không cần đúng thứ tự).

export function normalizeSearch(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, m => (m === 'đ' ? 'd' : 'D'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** "mkv doxy 50" → ["mkv","doxy","50"] */
export function searchTokens(query: string): string[] {
  const n = normalizeSearch(query)
  return n ? n.split(' ') : []
}

/** Khoảng cách Levenshtein, dừng sớm khi vượt `max` (chống gõ sai 1 ký tự). */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return false
    prev = cur
  }
  return prev[b.length] <= max
}

/** Token khớp gần đúng với 1 từ trong text (cho phép sai 1 ký tự, chỉ với token ≥ 4 ký tự). */
function tokenFuzzyHit(token: string, words: string[]): boolean {
  if (token.length < 4) return false
  return words.some(w => Math.abs(w.length - token.length) <= 1 && editDistanceWithin(token, w, 1))
}

export interface SmartMatch {
  matched: boolean
  fuzzy: boolean   // chỉ khớp được nhờ bỏ qua lỗi gõ sai
  score: number    // càng cao càng liên quan
}

/**
 * So khớp câu tìm với các trường của bản ghi (ưu tiên trường đứng trước, vd: [sku, name]).
 * - Mọi token phải khớp (AND), không cần đúng thứ tự: "doxy mkv" vẫn ra "MKV-Doxy".
 * - Bỏ qua dấu câu/gạch nối/dấu tiếng Việt: "mkv doxy" == "MKV-Doxy" == "mkvdoxy".
 * - `allowFuzzy` (mặc định bật): cho phép sai 1 ký tự trên token dài (mkv doxi → MKV-Doxy).
 */
export function smartMatch(query: string, fields: (string | null | undefined)[], allowFuzzy = true): SmartMatch {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return { matched: true, fuzzy: false, score: 0 }

  const normFields = fields.map(f => normalizeSearch(f || ''))
  const haystack = normFields.filter(Boolean).join(' ')
  if (!haystack) return { matched: false, fuzzy: false, score: 0 }

  const compact = haystack.replace(/ /g, '')   // "mkvdoxy50kg" → cho phép gõ dính "mkvdoxy"
  const words = haystack.split(' ')

  let score = 0
  let usedFuzzy = false

  for (const tok of tokens) {
    let hit = false
    // Khớp chính xác trên từng trường → điểm cao dần theo độ ưu tiên trường
    for (let i = 0; i < normFields.length; i++) {
      const f = normFields[i]
      if (!f) continue
      const weight = normFields.length - i          // trường đầu (SKU) nặng điểm hơn
      if (f === tok) { score += 100 * weight; hit = true; break }
      if (f.startsWith(tok) || f.split(' ').some(w => w === tok)) { score += 40 * weight; hit = true; break }
      if (f.includes(tok)) { score += 20 * weight; hit = true; break }
    }
    if (!hit && compact.includes(tok)) { score += 10; hit = true }
    if (!hit && allowFuzzy && tokenFuzzyHit(tok, words)) { score += 5; hit = true; usedFuzzy = true }
    if (!hit) return { matched: false, fuzzy: false, score: 0 }
  }

  // Cả câu xuất hiện liền mạch → cộng thưởng (giữ kết quả sát ý nhất lên đầu)
  const fullQuery = tokens.join(' ')
  if (haystack.includes(fullQuery)) score += 50
  if (haystack.startsWith(fullQuery)) score += 50

  return { matched: true, fuzzy: usedFuzzy, score }
}

/** Tiện dụng: chỉ cần biết có khớp hay không. */
export function smartIncludes(query: string, ...fields: (string | null | undefined)[]): boolean {
  return smartMatch(query, fields).matched
}

/**
 * Lọc + xếp hạng danh sách theo độ liên quan.
 * Ưu tiên kết quả khớp chính xác; chỉ dùng khớp-gần-đúng (gõ sai) khi không có kết quả nào chính xác.
 */
export function smartFilter<T>(
  items: T[],
  query: string,
  getFields: (item: T) => (string | null | undefined)[]
): T[] {
  if (!query.trim()) return items
  const exact: { item: T; score: number }[] = []
  const fuzzy: { item: T; score: number }[] = []
  for (const item of items) {
    const m = smartMatch(query, getFields(item))
    if (!m.matched) continue
    ;(m.fuzzy ? fuzzy : exact).push({ item, score: m.score })
  }
  const pool = exact.length > 0 ? exact : fuzzy
  return pool.sort((a, b) => b.score - a.score).map(r => r.item)
}
