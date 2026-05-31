import { supabase } from './supabase'
import { logger } from './logger'

// ─────────────────────────────────────────────────────────────
// Sao kê công nợ khách hàng — builder dùng chung cho cả trang chi
// tiết KH và View nhanh. Tái dùng đúng mô hình ledger ở
// CustomerDetailPage (invoice = Ghi nợ +, payment/credit-note = Ghi có −).
//
//   Nợ đầu kỳ  = running balance của mọi giao dịch có ngày < from
//   Phát sinh  = Σ Ghi nợ / Σ Ghi có trong [from, to]
//   Nợ cuối kỳ = Nợ đầu kỳ + Σ Ghi nợ − Σ Ghi có
// ─────────────────────────────────────────────────────────────

export interface StatementLineItem {
  sku: string
  name: string
  unit: string
  quantity: number
  unitPrice: number
  discount: number
  vat: number
  sellPrice: number   // Giá bán/trả mỗi đơn vị = unit_price − discount
  lineTotal: number
  notes: string
}

export interface StatementRow {
  date: string        // ISO
  code: string
  typeLabel: string   // 'Bán hàng' | 'Thanh toán' | 'Trả hàng' | 'Điều chỉnh nợ'...
  debit: number       // Ghi nợ (số dương)
  credit: number      // Ghi có (số dương)
  balance: number     // Dư nợ sau giao dịch
  notes: string
  lines: StatementLineItem[]  // chỉ có ở hóa đơn bán hàng
}

export interface CustomerStatement {
  customer: { id: string; code: string; name: string; phone: string }
  branch: { name: string; address: string; phone: string } | null
  from: string        // ISO (đầu ngày)
  to: string          // ISO (cuối ngày)
  opening: number
  rows: StatementRow[]
  totalDebit: number
  totalCredit: number
  closing: number
}

interface LedgerEntry {
  date: string
  code: string
  typeLabel: string
  debtImpact: number          // + = ghi nợ, − = ghi có
  notes: string
  orderId: string | null      // để gắn line item cho hóa đơn
}

/**
 * Dựng sao kê thuần (không I/O) từ các mảng dữ liệu đã fetch.
 * Tách riêng để dễ kiểm thử và tái dùng.
 */
export function buildStatement(input: {
  customer: { id: string; code: string; name: string; phone: string }
  branch: { name: string; address: string; phone: string } | null
  orders: any[]
  orderPayments: any[]
  debtPayments: any[]
  returns: any[]
  debts: any[]
  linesByOrder: Map<string, StatementLineItem[]>
  fromMs: number
  toMs: number
  fromISO: string
  toISO: string
}): CustomerStatement {
  const { customer, branch, orders, orderPayments, debtPayments, returns, debts, linesByOrder, fromMs, toMs, fromISO, toISO } = input

  const orderCodeMap = new Map<string, string>()
  orders.forEach(o => orderCodeMap.set(o.id, o.order_code))

  const entries: LedgerEntry[] = []

  // 1) Hóa đơn bán hàng
  orders.forEach(o => {
    if (o.status !== 'draft' && o.status !== 'cancelled') {
      entries.push({
        date: o.created_at,
        code: o.order_code,
        typeLabel: 'Bán hàng',
        debtImpact: Number(o.grand_total || 0),
        notes: o.notes || '',
        orderId: o.id,
      })
    }
  })

  // 2) Thanh toán theo đơn
  orderPayments.forEach(op => {
    const oCode = orderCodeMap.get(op.order_id) || ''
    entries.push({
      date: op.payment_date || op.created_at,
      code: op.reference_no || (oCode ? `TT${oCode}` : 'Thanh toán'),
      typeLabel: 'Thanh toán',
      debtImpact: -Number(op.amount || 0),
      notes: op.notes || (oCode ? `Thanh toán cho đơn ${oCode}` : ''),
      orderId: null,
    })
  })

  // 3) Thu nợ trực tiếp
  debtPayments.forEach(dp => {
    entries.push({
      date: dp.payment_date || dp.created_at,
      code: dp.reference_no || 'Thu nợ',
      typeLabel: 'Thanh toán',
      debtImpact: -Number(dp.amount || 0),
      notes: dp.notes || 'Khách thanh toán nợ',
      orderId: null,
    })
  })

  // 4) Trả hàng (chỉ credit_note mới giảm nợ)
  returns.forEach(r => {
    const oCode = orderCodeMap.get(r.order_id) || ''
    const isCreditNote = r.refund_method === 'credit_note'
    entries.push({
      date: r.created_at,
      code: r.return_code || 'Trả hàng',
      typeLabel: 'Trả hàng',
      debtImpact: isCreditNote ? -Number(r.total_amount || 0) : 0,
      notes: r.reason || (oCode ? `Khách trả hàng đơn ${oCode}` : ''),
      orderId: null,
    })
  })

  // 5) Điều chỉnh nợ (không gắn với đơn)
  debts.forEach(cd => {
    if (!cd.order_id || cd.debt_type !== 'order_debt') {
      let label = 'Điều chỉnh nợ'
      if (cd.debt_type === 'advance_from_customer') label = 'Khách trả trước'
      else if (cd.debt_type === 'refund_due') label = 'Phải hoàn trả'
      entries.push({
        date: cd.created_at,
        code: `DC-${String(cd.id).substring(0, 8).toUpperCase()}`,
        typeLabel: label,
        debtImpact: Number(cd.amount || 0),
        notes: cd.notes || '',
        orderId: null,
      })
    }
  })

  // Sắp xếp tăng dần theo thời gian để cộng dồn dư nợ
  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  let running = 0
  let opening = 0
  let totalDebit = 0
  let totalCredit = 0
  const rows: StatementRow[] = []

  for (const e of entries) {
    const t = new Date(e.date).getTime()
    running += e.debtImpact

    if (t < fromMs) {
      // Trước kỳ → gộp vào nợ đầu kỳ
      opening = running
      continue
    }
    if (t > toMs) continue // sau kỳ → bỏ qua

    const debit = e.debtImpact > 0 ? e.debtImpact : 0
    const credit = e.debtImpact < 0 ? -e.debtImpact : 0
    totalDebit += debit
    totalCredit += credit
    rows.push({
      date: e.date,
      code: e.code,
      typeLabel: e.typeLabel,
      debit,
      credit,
      balance: running,
      notes: e.notes,
      lines: e.orderId ? (linesByOrder.get(e.orderId) ?? []) : [],
    })
  }

  return {
    customer,
    branch,
    from: fromISO,
    to: toISO,
    opening,
    rows,
    totalDebit,
    totalCredit,
    closing: opening + totalDebit - totalCredit,
  }
}

/**
 * Fetch toàn bộ dữ liệu công nợ của 1 KH và dựng sao kê cho kỳ [fromISO, toISO].
 * fromISO/toISO là mốc đầu/cuối ngày (ISO).
 */
export async function fetchCustomerStatement(
  customerId: string,
  fromISO: string,
  toISO: string,
): Promise<CustomerStatement> {
  const fromMs = new Date(fromISO).getTime()
  const toMs = new Date(toISO).getTime()

  // Thông tin KH + chi nhánh + SĐT liên hệ chính
  const [{ data: cust }, { data: contact }] = await Promise.all([
    supabase.from('customers').select('id, code, farm_name, branch_id').eq('id', customerId).single(),
    supabase.from('customer_contacts').select('phone, is_primary').eq('customer_id', customerId).order('is_primary', { ascending: false }).limit(1).maybeSingle(),
  ])

  let branch: { name: string; address: string; phone: string } | null = null
  if (cust?.branch_id) {
    const { data: br } = await supabase.from('branches').select('name, address, phone').eq('id', cust.branch_id).single()
    if (br) branch = { name: br.name || '', address: br.address || '', phone: br.phone || '' }
  }

  // Đơn hàng của KH (toàn bộ — cần để tính nợ đầu kỳ)
  const { data: orders, error: ordErr } = await supabase
    .from('orders')
    .select('id, order_code, created_at, grand_total, status, notes')
    .eq('customer_id', customerId)
  if (ordErr) { logger.error('[statement] orders error:', ordErr.message); throw ordErr }

  const orderIds = (orders ?? []).map(o => o.id)

  // Thanh toán / trả hàng / thu nợ / điều chỉnh nợ
  const [opRes, retRes, dpRes, debtRes] = await Promise.all([
    orderIds.length
      ? supabase.from('order_payments').select('order_id, amount, payment_date, created_at, payment_method, reference_no, notes').in('order_id', orderIds)
      : Promise.resolve({ data: [] as any[] }),
    orderIds.length
      ? supabase.from('sales_returns').select('order_id, total_amount, created_at, return_code, refund_method, reason').in('order_id', orderIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('debt_payments').select('amount, payment_date, created_at, payment_method, reference_no, notes').eq('customer_id', customerId),
    supabase.from('customer_debts').select('id, amount, created_at, debt_type, order_id, notes').eq('customer_id', customerId),
  ])

  // Chi tiết dòng hàng cho các đơn NẰM TRONG kỳ
  const inPeriodOrderIds = (orders ?? [])
    .filter(o => { const t = new Date(o.created_at).getTime(); return t >= fromMs && t <= toMs })
    .map(o => o.id)

  const linesByOrder = new Map<string, StatementLineItem[]>()
  if (inPeriodOrderIds.length) {
    const { data: lines } = await supabase
      .from('order_lines')
      .select('order_id, quantity, unit_price, discount, line_total, notes, product:products(name, sku, unit)')
      .in('order_id', inPeriodOrderIds)
    ;(lines ?? []).forEach((l: any) => {
      const prod = l.product || {}
      const unitPrice = Number(l.unit_price || 0)
      const discount = Number(l.discount || 0)
      const item: StatementLineItem = {
        sku: prod.sku || '',
        name: prod.name || '',
        unit: prod.unit || '',
        quantity: Number(l.quantity || 0),
        unitPrice,
        discount,
        vat: 0, // schema không có VAT theo dòng
        sellPrice: unitPrice - discount,
        lineTotal: Number(l.line_total || 0),
        notes: l.notes || '',
      }
      const arr = linesByOrder.get(l.order_id) ?? []
      arr.push(item)
      linesByOrder.set(l.order_id, arr)
    })
  }

  return buildStatement({
    customer: {
      id: customerId,
      code: cust?.code || '',
      name: cust?.farm_name || '',
      phone: contact?.phone || '',
    },
    branch,
    orders: orders ?? [],
    orderPayments: opRes.data ?? [],
    debtPayments: dpRes.data ?? [],
    returns: retRes.data ?? [],
    debts: debtRes.data ?? [],
    linesByOrder,
    fromMs,
    toMs,
    fromISO,
    toISO,
  })
}
