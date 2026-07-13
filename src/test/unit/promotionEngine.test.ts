import { describe, it, expect } from 'vitest'
import { calcPromoDiscount, type Promotion } from '../../hooks/usePromotionEngine'
import type { CartRow } from '../../lib/cartUtils'

const row = (id: string, unitPrice: number, quantity: number): CartRow => ({
  id: `row-${id}`,
  product: { id, name: `SP ${id}` },
  quantity,
  unitPrice,
  discountPercent: 0,
  isPriceOverridden: false,
})

const promo = (overrides: Partial<Promotion>): Promotion => ({
  id: 'promo-1',
  code: 'KM1',
  name: 'KM test',
  discount_type: 'percent',
  discount_value: 0,
  min_order_amount: 0,
  applies_to: {},
  current_uses: 0,
  priority: 0,
  is_active: true,
  ...overrides,
})

const subtotalOf = (cart: CartRow[]) => cart.reduce((s, r) => s + r.unitPrice * r.quantity, 0)

describe('calcPromoDiscount — combo_price', () => {
  const combo = promo({
    discount_type: 'combo_price',
    combo_price: 80_000,
    applies_to: { product_ids: ['A', 'B'] },
  })

  it('giảm phần chênh giữa giá gốc bộ và giá combo', () => {
    // Bộ gốc = 50k + 60k = 110k; giá combo 80k → giảm 30k
    const cart = [row('A', 50_000, 1), row('B', 60_000, 1)]
    expect(calcPromoDiscount(combo, cart, subtotalOf(cart))).toBe(30_000)
  })

  it('thiếu một sản phẩm trong combo thì không giảm', () => {
    const cart = [row('A', 50_000, 3)]
    expect(calcPromoDiscount(combo, cart, subtotalOf(cart))).toBe(0)
  })

  it('nhân theo số bộ đầy đủ, phần lẻ không tính', () => {
    // A x3, B x2 → chỉ đủ 2 bộ → giảm 30k × 2
    const cart = [row('A', 50_000, 3), row('B', 60_000, 2)]
    expect(calcPromoDiscount(combo, cart, subtotalOf(cart))).toBe(60_000)
  })

  it('giá combo cao hơn giá gốc thì không cộng thêm tiền', () => {
    const badCombo = promo({
      discount_type: 'combo_price',
      combo_price: 200_000,
      applies_to: { product_ids: ['A', 'B'] },
    })
    const cart = [row('A', 50_000, 1), row('B', 60_000, 1)]
    expect(calcPromoDiscount(badCombo, cart, subtotalOf(cart))).toBe(0)
  })

  it('chưa đặt giá combo hoặc chưa chọn SP thì trơ, không giảm', () => {
    const cart = [row('A', 50_000, 1), row('B', 60_000, 1)]
    const noPrice = promo({ discount_type: 'combo_price', applies_to: { product_ids: ['A', 'B'] } })
    const noProducts = promo({ discount_type: 'combo_price', combo_price: 80_000 })
    expect(calcPromoDiscount(noPrice, cart, subtotalOf(cart))).toBe(0)
    expect(calcPromoDiscount(noProducts, cart, subtotalOf(cart))).toBe(0)
  })
})

describe('calcPromoDiscount — phạm vi sản phẩm (applies_to)', () => {
  it('chỉ giảm trên các SP được chọn, không giảm cả giỏ', () => {
    const p = promo({
      discount_type: 'percent',
      discount_value: 10,
      applies_to: { product_ids: ['A'] },
    })
    const cart = [row('A', 100_000, 1), row('B', 900_000, 1)]
    // 10% của riêng A = 10k (KHÔNG phải 10% của 1tr)
    expect(calcPromoDiscount(p, cart, subtotalOf(cart))).toBe(10_000)
  })

  it('không chọn SP nào = áp lên toàn bộ giỏ', () => {
    const p = promo({ discount_type: 'percent', discount_value: 10 })
    const cart = [row('A', 100_000, 1), row('B', 900_000, 1)]
    expect(calcPromoDiscount(p, cart, subtotalOf(cart))).toBe(100_000)
  })
})

describe('calcPromoDiscount — buy_x_get_y cấp đơn (dữ liệu KM cũ)', () => {
  // Ngữ nghĩa: lấy (X+Y) món, chỉ tính tiền X món. KHÁC "Mua X tặng Y" của KM sản phẩm.
  const p = promo({ discount_type: 'buy_x_get_y', buy_x_qty: 10, get_y_qty: 2 })

  it('đủ 12 món mới được miễn tiền 2 món', () => {
    const cart = [row('A', 10_000, 12)]
    expect(calcPromoDiscount(p, cart, subtotalOf(cart))).toBe(20_000)
  })

  it('mới 10 món thì chưa đủ một bộ', () => {
    const cart = [row('A', 10_000, 10)]
    expect(calcPromoDiscount(p, cart, subtotalOf(cart))).toBe(0)
  })
})

describe('calcPromoDiscount — điều kiện chặn', () => {
  it('dưới đơn tối thiểu thì không giảm', () => {
    const p = promo({ discount_type: 'percent', discount_value: 10, min_order_amount: 500_000 })
    const cart = [row('A', 100_000, 1)]
    expect(calcPromoDiscount(p, cart, subtotalOf(cart))).toBe(0)
  })

  it('hết lượt dùng thì không giảm', () => {
    const p = promo({ discount_type: 'percent', discount_value: 10, max_uses: 5, current_uses: 5 })
    const cart = [row('A', 100_000, 1)]
    expect(calcPromoDiscount(p, cart, subtotalOf(cart))).toBe(0)
  })

  it('KM hết hạn thì không giảm', () => {
    const p = promo({ discount_type: 'percent', discount_value: 10, valid_to: '2020-01-01' })
    const cart = [row('A', 100_000, 1)]
    expect(calcPromoDiscount(p, cart, subtotalOf(cart))).toBe(0)
  })

  it('KM theo hạng KH chỉ áp cho đúng hạng', () => {
    const p = promo({
      discount_type: 'customer_tier_discount',
      discount_value: 10,
      customer_tiers: ['vip'],
    })
    const cart = [row('A', 100_000, 1)]
    expect(calcPromoDiscount(p, cart, subtotalOf(cart), 'normal')).toBe(0)
    expect(calcPromoDiscount(p, cart, subtotalOf(cart), 'vip')).toBe(10_000)
  })
})
