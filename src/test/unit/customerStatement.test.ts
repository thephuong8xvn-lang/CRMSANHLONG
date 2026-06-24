import { describe, it, expect } from 'vitest'
import { buildStatement, type StatementLineItem } from '../../lib/customerStatement'

const customer = { id: 'c1', code: 'KH-1', name: 'Chú Hiệp', phone: '' }
const wideFrom = '1970-01-01T00:00:00.000Z'
const wideTo = '2999-12-31T23:59:59.999Z'
const linesByOrder = new Map<string, StatementLineItem[]>()

function build(input: Partial<Parameters<typeof buildStatement>[0]>) {
  return buildStatement({
    customer,
    branch: null,
    orders: [],
    orderPayments: [],
    debtPayments: [],
    returns: [],
    debts: [],
    linesByOrder,
    fromMs: new Date(wideFrom).getTime(),
    toMs: new Date(wideTo).getTime(),
    fromISO: wideFrom,
    toISO: wideTo,
    ...input,
  })
}

describe('buildStatement — không đếm trùng advance_from_customer', () => {
  // Kịch bản thực tế "Chú Hiệp": 2 hóa đơn 132k + 95k, thu 95k (POS) + 330k (thu nợ),
  // hệ thống sinh advance_from_customer −198k (phái sinh của khoản thu vượt).
  const scenario = {
    orders: [
      { id: 'o1', order_code: 'DH-00420', created_at: '2026-06-21T15:25:00Z', grand_total: 132000, status: 'completed', notes: '' },
      { id: 'o2', order_code: 'DH-00528', created_at: '2026-06-24T06:16:00Z', grand_total: 95000, status: 'completed', notes: '' },
    ],
    orderPayments: [
      { order_id: 'o2', amount: 95000, payment_date: '2026-06-23T07:00:00Z', reference_no: 'POS-CASH-DH-00528', notes: '' },
    ],
    debtPayments: [
      { amount: 330000, payment_date: '2026-06-23T07:00:00Z', reference_no: 'PT-KH', notes: 'Thu công nợ' },
    ],
    debts: [
      { id: 'd-adv', amount: -198000, created_at: '2026-06-23T14:13:00Z', debt_type: 'advance_from_customer', order_id: null, notes: 'Khách trả trước' },
    ],
  }

  it('closing = −198.000 (KHÔNG phải −396.000)', () => {
    const st = build(scenario)
    expect(st.closing).toBe(-198000)
  })

  it('Tổng phát sinh = 227.000, tổng thu/trả = 425.000 (không gồm advance)', () => {
    const st = build(scenario)
    expect(st.totalDebit).toBe(227000)
    expect(st.totalCredit).toBe(425000)
  })

  it('dòng Khách trả trước là dòng thông tin: debit/credit = 0, không đổi số dư', () => {
    const st = build(scenario)
    const adv = st.rows.find(r => r.kind === 'advance')
    expect(adv).toBeDefined()
    expect(adv!.info).toBe(true)
    expect(adv!.debit).toBe(0)
    expect(adv!.credit).toBe(0)
  })

  it('điều chỉnh nợ thủ công (order_debt, order_id NULL) VẪN ảnh hưởng số dư', () => {
    const st = build({
      debts: [
        { id: 'd-adj', amount: 50000, created_at: '2026-06-25T00:00:00Z', debt_type: 'order_debt', order_id: null, notes: 'Phạt trễ hạn' },
      ],
    })
    expect(st.closing).toBe(50000)
    expect(st.totalDebit).toBe(50000)
  })
})
