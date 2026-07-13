import { describe, it, expect } from 'vitest'
import { evaluateProductPromo, promoShortLabel, type ProductPromotion } from '../../hooks/useProductPromotions'

const promo = (o: Partial<ProductPromotion>): ProductPromotion => ({
  id: 'pp1',
  product_id: 'A',
  name: 'KM test',
  promo_type: 'unit_price',
  buy_qty: null,
  get_qty: null,
  get_product_id: null,
  get_price: 0,
  discount_value: 90_000,
  min_qty: 25,
  branch_ids: [],
  priority: 0,
  is_active: true,
  ...o,
})

describe('KM sản phẩm — giá ưu đãi theo số lượng (unit_price)', () => {
  // Giá niêm yết 100.000; mua từ 25 → 90.000/gói
  const p = promo({})

  it('mua đủ 25 → hưởng giá 90.000, cả dòng giảm 250.000', () => {
    const ev = evaluateProductPromo(p, 25, 100_000)!
    expect(ev.eligible).toBe(true)
    expect(ev.discountAmount).toBe(250_000)          // (100k − 90k) × 25
    expect(ev.discountPercent).toBeCloseTo(10)
    // Giá thực trả mỗi đơn vị đúng bằng giá ưu đãi
    expect(100_000 * (1 - ev.discountPercent / 100)).toBeCloseTo(90_000)
  })

  it('mua 1 gói → chưa đủ, vẫn giá niêm yết, báo còn thiếu bao nhiêu', () => {
    const ev = evaluateProductPromo(p, 1, 100_000)!
    expect(ev.eligible).toBe(false)
    expect(ev.remaining).toBe(24)
  })

  it('mua nhiều hơn ngưỡng → áp cho toàn bộ số lượng', () => {
    const ev = evaluateProductPromo(p, 30, 100_000)!
    expect(ev.discountAmount).toBe(300_000)          // (100k − 90k) × 30
  })

  it('giá lẻ không bị làm tròn % làm sai giá', () => {
    const odd = promo({ discount_value: 95_500, min_qty: 10 })
    const ev = evaluateProductPromo(odd, 10, 100_000)!
    expect(100_000 * (1 - ev.discountPercent / 100)).toBeCloseTo(95_500)
    expect(ev.discountAmount).toBe(45_000)           // (100k − 95.5k) × 10
  })

  it('giá ưu đãi KHÔNG rẻ hơn giá đang bán → KM tự vô hiệu, không làm khách trả đắt hơn', () => {
    // Khách đang được bán 85.000 (rẻ hơn giá KM 90.000) → không áp
    expect(evaluateProductPromo(p, 30, 85_000)).toBeNull()
    // Bằng đúng giá KM cũng không áp
    expect(evaluateProductPromo(p, 30, 90_000)).toBeNull()
  })

  it('nhãn ngắn nói bằng giá, không nói bằng %', () => {
    expect(promoShortLabel(p)).toBe('Mua từ 25 · giá 90.000₫')
  })
})
