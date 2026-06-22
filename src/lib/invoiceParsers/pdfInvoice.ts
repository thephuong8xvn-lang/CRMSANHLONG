// Bóc tách hóa đơn PDF dạng text (pdfjs-dist, lazy). Gom text theo dòng (toạ độ Y),
// heuristic: dòng hàng = có tên + cụm số cuối (SL / Đơn giá / Thành tiền).
// PDF scan (không có lớp text) → trả rỗng + cảnh báo nhập tay.
import type { ParsedInvoice, ParsedInvoiceLine } from './types'
import { parseVnNumber } from './numberVN'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

async function extractLines(buf: ArrayBuffer): Promise<string[]> {
  const pdfjs: any = await import('pdfjs-dist')
  // Worker qua Vite asset URL (không cần cấu hình thủ công khi build)
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const out: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // Gom item theo Y (làm tròn) → 1 dòng
    const byRow = new Map<number, { x: number; s: string }[]>()
    for (const it of content.items as any[]) {
      if (!it.str) continue
      const y = Math.round(it.transform[5])
      const x = it.transform[4]
      if (!byRow.has(y)) byRow.set(y, [])
      byRow.get(y)!.push({ x, s: it.str })
    }
    const ys = Array.from(byRow.keys()).sort((a, b) => b - a) // trên xuống dưới
    for (const y of ys) {
      const parts = byRow.get(y)!.sort((a, b) => a.x - b.x).map((p) => p.s)
      const line = parts.join(' ').replace(/\s+/g, ' ').trim()
      if (line) out.push(line)
    }
  }
  return out
}

export async function parsePdfInvoice(buf: ArrayBuffer): Promise<ParsedInvoice> {
  const warnings: string[] = []
  let textLines: string[] = []
  try {
    textLines = await extractLines(buf)
  } catch (e: any) {
    return { lines: [], warnings: ['Không đọc được PDF: ' + (e?.message || e)], format: 'pdf' }
  }

  if (textLines.length === 0) {
    return { lines: [], warnings: ['PDF không có lớp text (bản scan ảnh) — vui lòng nhập dòng hàng bằng tay.'], format: 'pdf' }
  }

  // Heuristic dòng hàng: kết thúc bằng ≥2 cụm số (đơn giá + thành tiền), có phần tên.
  const lines: ParsedInvoiceLine[] = []
  const numTok = /[\d.,]+/g
  for (const raw of textLines) {
    const n = norm(raw)
    if (n.includes('cong tien hang') || n.includes('tong cong') || n.includes('tien thue') || n.includes('thanh tien') && n.length < 16) continue
    const nums = raw.match(numTok)?.filter((t) => /\d/.test(t)) || []
    if (nums.length < 3) continue
    // 3 số cuối: SL, đơn giá, thành tiền
    const last3 = nums.slice(-3).map(parseVnNumber)
    const [qty, price] = last3
    if (price <= 0) continue
    // Tên = phần đầu trước số đầu tiên trong cụm cuối
    const firstNumIdx = raw.search(/\s[\d.,]+(\s+[\d.,]+){1,}\s*$/)
    const name = (firstNumIdx > 0 ? raw.slice(0, firstNumIdx) : raw.replace(numTok, '')).trim()
    if (!name || name.length < 2) continue
    lines.push({ name, qty: qty || 1, price })
  }

  if (lines.length === 0) {
    warnings.push('Không tự bóc được dòng hàng từ PDF — vui lòng nhập tay.')
  } else {
    warnings.push('PDF bóc tự động có thể sai — vui lòng kiểm tra lại Tên/SL/Giá.')
  }
  warnings.push('Hóa đơn không có Số lô / NSX / HSD — vui lòng nhập tay đủ 3 trường.')

  const invoiceNo = (() => {
    for (const l of textLines) {
      const m = l.match(/(?:số|so)\s*[:\-]?\s*(\d{4,})/i)
      if (m) return m[1]
    }
    return undefined
  })()

  return { lines, invoiceNo, warnings, format: 'pdf' }
}
