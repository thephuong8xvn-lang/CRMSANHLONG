import { describe, it, expect } from 'vitest'
import { evaluateBestPromo, evaluateProductPromo, promoShortLabel, type ProductPromotion } from '../../hooks/useProductPromotions'

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

describe('Một SP gắn NHIỀU bậc KM — chọn bậc lợi nhất', () => {
  // Cùng 1 SP giá 95.000: mua từ 10 → 91.000; mua nguyên thùng 25 → 89.740
  const tier10 = promo({ id: 'a', name: 'Mua 10 gói', discount_value: 91_000, min_qty: 10 })
  const tier25 = promo({ id: 'b', name: 'Nguyên thùng', discount_value: 89_740, min_qty: 25 })
  const all = [tier10, tier25]

  it('mua 12 → chỉ bậc 10 đủ điều kiện (trước đây POS bỏ sót nếu bậc kia xếp trên)', () => {
    const ev = evaluateBestPromo(all, 12, 95_000)!
    expect(ev.promo.id).toBe('a')
    expect(ev.eligible).toBe(true)
  })

  it('mua 25 → cả hai đủ điều kiện, lấy bậc rẻ hơn cho khách', () => {
    const ev = evaluateBestPromo(all, 25, 95_000)!
    expect(ev.promo.id).toBe('b')
    expect(ev.discountAmount).toBe((95_000 - 89_740) * 25)
  })

  it('priority admin đặt được ưu tiên trước mức lợi', () => {
    const forced = [tier10, { ...tier25, priority: 0 }, { ...tier10, id: 'c', priority: 5 }]
    expect(evaluateBestPromo(forced, 25, 95_000)!.promo.id).toBe('c')
  })

  it('chưa bậc nào đủ điều kiện → gợi ý bậc gần đạt nhất', () => {
    const ev = evaluateBestPromo(all, 3, 95_000)!
    expect(ev.eligible).toBe(false)
    expect(ev.promo.id).toBe('a')
    expect(ev.remaining).toBe(7)
  })
})
