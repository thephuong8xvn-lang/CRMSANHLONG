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
  kind: 'invoice' | 'payment' | 'return' | 'adjustment' | 'advance' // phục vụ click → chi tiết
  refId: string | null  // order_id / return_id / payment_id… để mở chi tiết
  info?: boolean        // true = dòng thông tin, KHÔNG ảnh hưởng số dư (vd Khách trả trước)
  createdBy: string     // Người lập chứng từ ('—' nếu không tra được)
  branchName: string    // Chi nhánh phát sinh ('—' nếu không tra được)
}

// ─────────────────────────────────────────────────────────────
// Quy kết "ai lập / ở chi nhánh nào" cho từng dòng sổ.
//
// Chi nhánh lấy theo NGUỒN ĐÁNG TIN NHẤT của từng loại chứng từ:
//   • Bán hàng / Thanh toán theo đơn / Trả hàng → `orders.branch_id`
//     (chi nhánh thực sự bán — dứt khoát, không suy diễn)
//   • Thu nợ → `debt_payments.branch_id` = NƠI THU tiền (thêm ở 20260754).
//     Đây chính là chi nhánh quyết định quỹ/ca thu ngân nào ghi nhận khoản thu.
//     Phiếu cũ chưa có cột → lùi về chi nhánh của NGƯỜI LẬP.
//   • Điều chỉnh nợ → chi nhánh của NGƯỜI LẬP (`customer_debts` không có cột nào)
//
// Cố ý KHÔNG tra chi nhánh qua sổ quỹ: RLS sổ quỹ chặn theo chi nhánh nên nhân
// viên chi nhánh khác sẽ đọc rỗng → cột lúc có lúc không. `debt_payments` thì
// chốt theo permission (không theo chi nhánh) nên đọc được ổn định.
// ─────────────────────────────────────────────────────────────
export interface LedgerAttribution {
  userName: Map<string, string>    // profile id → họ tên
  userBranch: Map<string, string>  // profile id → tên chi nhánh của người đó
  branchName: Map<string, string>  // branch id  → tên chi nhánh
}

export const EMPTY_ATTRIBUTION: LedgerAttribution = {
  userName: new Map(), userBranch: new Map(), branchName: new Map(),
}

/** Tra tên người + tên chi nhánh cho một mớ id. `profiles`/`branches` đều cho
 *  mọi tài khoản đang hoạt động đọc nên không vướng RLS. */
export async function fetchLedgerAttribution(
  userIds: (string | null | undefined)[],
  branchIds: (string | null | undefined)[],
): Promise<LedgerAttribution> {
  const uniq = (xs: (string | null | undefined)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))]

  const users = uniq(userIds)
  const result: LedgerAttribution = {
    userName: new Map(), userBranch: new Map(), branchName: new Map(),
  }

  const [profRes, brRes] = await Promise.all([
    users.length
      ? supabase.from('profiles').select('id, full_name, branch_id').in('id', users)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('branches').select('id, name'),
  ])

  ;(brRes.data ?? []).forEach((b: any) => result.branchName.set(b.id, b.name || ''))
  ;(profRes.data ?? []).forEach((p: any) => {
    result.userName.set(p.id, p.full_name || '')
    const bn = p.branch_id ? result.branchName.get(p.branch_id) : undefined
    if (bn) result.userBranch.set(p.id, bn)
  })

  // branchIds chỉ dùng để chắc chắn đã nạp đủ tên chi nhánh — `branches` nhỏ nên
  // nạp trọn bảng, không cần lọc.
  void branchIds
  return result
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
  kind: StatementRow['kind']
  refId: string | null
  // false = dòng phái sinh (Khách trả trước / Phải hoàn trả) — tiền đã nằm ở
  // dòng thanh toán nên KHÔNG cộng vào số dư, chỉ hiển thị thông tin.
  affectsBalance: boolean
  createdBy: string
  branchName: string
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
  attribution?: LedgerAttribution
}): CustomerStatement {
  const { customer, branch, orders, orderPayments, debtPayments, returns, debts, linesByOrder, fromMs, toMs, fromISO, toISO } = input
  const attr = input.attribution ?? EMPTY_ATTRIBUTION

  const orderCodeMap = new Map<string, string>()
  const orderBranchMap = new Map<string, string | null>()
  orders.forEach(o => {
    orderCodeMap.set(o.id, o.order_code)
    orderBranchMap.set(o.id, o.branch_id ?? null)
  })

  // '—' khi không tra được: thà để trống còn hơn đoán sai người/chi nhánh.
  const who = (uid?: string | null) => (uid && attr.userName.get(uid)) || '—'
  const branchOfOrder = (orderId?: string | null) => {
    const bid = orderId ? orderBranchMap.get(orderId) : null
    return (bid && attr.branchName.get(bid)) || '—'
  }
  const branchOfUser = (uid?: string | null) => (uid && attr.userBranch.get(uid)) || '—'

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
        kind: 'invoice',
        refId: o.id,
        affectsBalance: true,
        createdBy: who(o.owner_user_id),
        branchName: branchOfOrder(o.id),
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
      kind: 'payment',
      refId: op.order_id || null,
      affectsBalance: true,
      createdBy: who(op.created_by),
      branchName: branchOfOrder(op.order_id),
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
      kind: 'payment',
      refId: null,
      affectsBalance: true,
      // Nơi THU tiền lấy thẳng từ `debt_payments.branch_id` (thêm ở 20260754 —
      // chính là chi nhánh quyết định quỹ/ca thu ngân nào ghi nhận khoản này).
      // Lùi về chi nhánh người ghi cho các phiếu cũ chưa có cột.
      createdBy: who(dp.recorded_by),
      branchName: (dp.branch_id && attr.branchName.get(dp.branch_id)) || branchOfUser(dp.recorded_by),
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
      kind: 'return',
      refId: r.order_id || null,
      affectsBalance: true,
      createdBy: who(r.created_by ?? r.processed_by),
      branchName: branchOfOrder(r.order_id),
    })
  })

  // 5) customer_debts không gắn đơn:
  //    • order_debt (order_id NULL) = ĐIỀU CHỈNH THỦ CÔNG → ảnh hưởng số dư.
  //    • advance_from_customer / refund_due = bút toán PHÁI SINH của thanh toán
  //      (tiền đã được tính ở dòng thanh toán). Hiển thị THÔNG TIN, KHÔNG cộng
  //      vào số dư → tránh đếm trùng (lỗi dư nợ sai trước đây).
  debts.forEach(cd => {
    if (!cd.order_id || cd.debt_type !== 'order_debt') {
      const isManualAdjust = cd.debt_type === 'order_debt' // tới đây ⇒ order_id NULL
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
        kind: isManualAdjust ? 'adjustment' : 'advance',
        refId: null,
        affectsBalance: isManualAdjust,
        createdBy: who(cd.created_by),
        branchName: branchOfUser(cd.created_by),
      })
    }
  })

  // Sắp xếp tăng dần theo thời gian để cộng dồn dư nợ. Tie-break ổn định: dòng
  // ảnh hưởng số dư trước dòng thông tin, ghi nợ trước ghi có → số dư đọc tự nhiên.
  entries.sort((a, b) => {
    const dt = new Date(a.date).getTime() - new Date(b.date).getTime()
    if (dt !== 0) return dt
    if (a.affectsBalance !== b.affectsBalance) return a.affectsBalance ? -1 : 1
    return b.debtImpact - a.debtImpact
  })

  let running = 0
  let opening = 0
  let totalDebit = 0
  let totalCredit = 0
  const rows: StatementRow[] = []

  for (const e of entries) {
    const t = new Date(e.date).getTime()
    if (e.affectsBalance) running += e.debtImpact

    if (t < fromMs) {
      // Trước kỳ → gộp vào nợ đầu kỳ (chỉ dòng ảnh hưởng số dư)
      if (e.affectsBalance) opening = running
      continue
    }
    if (t > toMs) continue // sau kỳ → bỏ qua

    const debit = e.affectsBalance && e.debtImpact > 0 ? e.debtImpact : 0
    const credit = e.affectsBalance && e.debtImpact < 0 ? -e.debtImpact : 0
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
      kind: e.kind,
      refId: e.refId,
      info: !e.affectsBalance,
      createdBy: e.createdBy,
      branchName: e.branchName,
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
    .select('id, order_code, created_at, grand_total, status, notes, owner_user_id, branch_id')
    .eq('customer_id', customerId)
  if (ordErr) { logger.error('[statement] orders error:', ordErr.message); throw ordErr }

  const orderIds = (orders ?? []).map((o: { id: string }) => o.id)

  // Thanh toán / trả hàng / thu nợ / điều chỉnh nợ
  const [opRes, retRes, dpRes, debtRes] = await Promise.all([
    orderIds.length
      ? supabase.from('order_payments').select('order_id, amount, payment_date, created_at, payment_method, reference_no, notes, created_by').in('order_id', orderIds)
      : Promise.resolve({ data: [] as any[] }),
    orderIds.length
      ? supabase.from('sales_returns').select('order_id, total_amount, created_at, return_code, refund_method, reason, created_by, processed_by').in('order_id', orderIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('debt_payments').select('amount, payment_date, created_at, payment_method, reference_no, notes, recorded_by, branch_id').eq('customer_id', customerId),
    supabase.from('customer_debts').select('id, amount, created_at, debt_type, order_id, notes, created_by').eq('customer_id', customerId),
  ])

  // Chi tiết dòng hàng cho các đơn NẰM TRONG kỳ
  const inPeriodOrderIds = (orders ?? [])
    .filter((o: { id: string; created_at: string }) => { const t = new Date(o.created_at).getTime(); return t >= fromMs && t <= toMs })
    .map((o: { id: string }) => o.id)

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

  // Tra tên người lập + tên chi nhánh cho mọi dòng sổ
  const attribution = await fetchLedgerAttribution(
    [
      ...(orders ?? []).map((o: any) => o.owner_user_id),
      ...(opRes.data ?? []).map((op: any) => op.created_by),
      ...(dpRes.data ?? []).map((dp: any) => dp.recorded_by),
      ...(retRes.data ?? []).map((r: any) => r.created_by ?? r.processed_by),
      ...(debtRes.data ?? []).map((cd: any) => cd.created_by),
    ],
    (orders ?? []).map((o: any) => o.branch_id),
  )

  return buildStatement({
    attribution,
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
