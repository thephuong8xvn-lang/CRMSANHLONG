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

describe('buildStatement — cột Người lập / Chi nhánh', () => {
  const attribution = {
    userName: new Map([['u-ha', 'Hoài Ân'], ['u-pm', 'Phù Mỹ'], ['u-admin', 'Quản trị viên']]),
    userBranch: new Map([['u-ha', 'Chi nhánh Hoài Ân'], ['u-pm', 'Chi nhánh Phù Mỹ']]),
    branchName: new Map([['b-ha', 'Chi nhánh Hoài Ân'], ['b-pm', 'Chi nhánh Phù Mỹ']]),
  }

  const orders = [
    { id: 'o1', order_code: 'DH-1', created_at: '2026-07-01T00:00:00Z', grand_total: 100000, status: 'completed', notes: '', owner_user_id: 'u-pm', branch_id: 'b-pm' },
  ]

  it('Bán hàng: người lập = chủ đơn, chi nhánh = chi nhánh CỦA ĐƠN', () => {
    const st = build({ orders, attribution })
    const row = st.rows.find(r => r.kind === 'invoice')!
    expect(row.createdBy).toBe('Phù Mỹ')
    expect(row.branchName).toBe('Chi nhánh Phù Mỹ')
  })

  it('Thanh toán theo đơn lấy chi nhánh của ĐƠN, không phải của người thu', () => {
    const st = build({
      orders,
      orderPayments: [{ order_id: 'o1', amount: 40000, payment_date: '2026-07-02T00:00:00Z', reference_no: 'TT-1', notes: '', created_by: 'u-ha' }],
      attribution,
    })
    const row = st.rows.find(r => r.code === 'TT-1')!
    expect(row.createdBy).toBe('Hoài Ân')
    expect(row.branchName).toBe('Chi nhánh Phù Mỹ')
  })

  it('Thu nợ không gắn đơn → lấy chi nhánh của NGƯỜI GHI phiếu', () => {
    const st = build({
      debtPayments: [{ amount: 50000, payment_date: '2026-07-03T00:00:00Z', reference_no: 'TN-1', notes: '', recorded_by: 'u-ha' }],
      attribution,
    })
    const row = st.rows.find(r => r.code === 'TN-1')!
    expect(row.createdBy).toBe('Hoài Ân')
    expect(row.branchName).toBe('Chi nhánh Hoài Ân')
  })

  it('không tra được thì để "—", KHÔNG đoán bừa', () => {
    // u-admin có tên nhưng branch_id NULL; u-la không có trong bảng tra
    const st = build({
      debtPayments: [
        { amount: 1000, payment_date: '2026-07-04T00:00:00Z', reference_no: 'TN-2', notes: '', recorded_by: 'u-admin' },
        { amount: 2000, payment_date: '2026-07-05T00:00:00Z', reference_no: 'TN-3', notes: '', recorded_by: 'u-la' },
      ],
      attribution,
    })
    const r2 = st.rows.find(r => r.code === 'TN-2')!
    expect(r2.createdBy).toBe('Quản trị viên')
    expect(r2.branchName).toBe('—')
    const r3 = st.rows.find(r => r.code === 'TN-3')!
    expect(r3.createdBy).toBe('—')
    expect(r3.branchName).toBe('—')
  })

  it('không truyền attribution thì mọi dòng là "—" (tương thích ngược)', () => {
    const st = build({ orders })
    const row = st.rows.find(r => r.kind === 'invoice')!
    expect(row.createdBy).toBe('—')
    expect(row.branchName).toBe('—')
  })
})
