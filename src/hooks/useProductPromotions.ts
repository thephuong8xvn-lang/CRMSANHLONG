import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface ProductPromotion {
  id: string
  product_id: string
  name: string
  promo_type: 'buy_x_get_y' | 'percent' | 'fixed_amount' | 'unit_price'
  buy_qty: number | null
  get_qty: number | null
  get_product_id: string | null
  /** Giá mỗi đơn vị quà tặng (buy_x_get_y). 0 = tặng miễn phí; >0 = giá ưu đãi. */
  get_price: number
  /**
   * Đa nghĩa theo promo_type:
   *   percent      → % giảm
   *   fixed_amount → ₫ giảm mỗi đơn vị
   *   unit_price   → ĐƠN GIÁ bán ưu đãi mỗi đơn vị (vd 90.000 khi mua từ 25)
   */
  discount_value: number
  min_qty: number
  branch_ids: string[]
  priority: number
  valid_from?: string | null
  valid_to?: string | null
  is_active: boolean
}

/** Kết quả đánh giá KM của một sản phẩm dựa trên số lượng đang có trong giỏ. */
export interface ProductPromoEvaluation {
  promo: ProductPromotion
  /** Đã đủ điều kiện hưởng KM chưa */
  eligible: boolean
  /** Với buy_x_get_y: cần mua thêm bao nhiêu để đạt mốc kế tiếp (0 nếu đã đủ) */
  remaining: number
  /** Với buy_x_get_y: tổng số lượng quà được tặng */
  giftQty: number
  /** Giá mỗi đơn vị quà (0 = miễn phí, >0 = giá ưu đãi) */
  giftPrice: number
  /** SP tặng (mặc định là chính SP đang mua) */
  giftProductId: string
  /** Với percent/fixed_amount: số tiền giảm trên cả dòng (theo unitPrice * quantity) */
  discountAmount: number
  /** % giảm tương ứng để set vào discountPercent của dòng giỏ */
  discountPercent: number
  /** Nhãn ngắn hiển thị trên badge/banner */
  label: string
}

function isWithinValidity(p: ProductPromotion, now: Date): boolean {
  if (p.valid_from && new Date(p.valid_from) > now) return false
  if (p.valid_to && new Date(p.valid_to) < now) return false
  return true
}

/** Nhãn tóm tắt cho badge thẻ sản phẩm / danh sách. */
export function promoShortLabel(p: ProductPromotion): string {
  switch (p.promo_type) {
    case 'buy_x_get_y':
      return `Mua ${p.buy_qty ?? '?'} tặng ${p.get_qty ?? '?'}`
    case 'percent':
      return `Giảm ${p.discount_value}%${p.min_qty > 1 ? ` từ ${p.min_qty}` : ''}`
    case 'fixed_amount':
      return `Giảm ${p.discount_value.toLocaleString('vi-VN')}₫${p.min_qty > 1 ? ` từ ${p.min_qty}` : ''}`
    case 'unit_price':
      return `Mua từ ${p.min_qty} · giá ${p.discount_value.toLocaleString('vi-VN')}₫`
    default:
      return p.name
  }
}

/**
 * Đánh giá một KM sản phẩm theo số lượng & đơn giá hiện tại trong giỏ.
 * Trả về null nếu KM không cho ra ưu đãi nào (vd discount 0).
 */
export function evaluateProductPromo(
  promo: ProductPromotion,
  qtyInCart: number,
  unitPrice: number,
): ProductPromoEvaluation | null {
  const giftProductId = promo.get_product_id ?? promo.product_id

  if (promo.promo_type === 'buy_x_get_y') {
    const buy = promo.buy_qty ?? 0
    const get = promo.get_qty ?? 0
    if (buy <= 0 || get <= 0) return null
    const sets = Math.floor(qtyInCart / buy)
    const giftQty = sets * get
    const eligible = sets > 0
    const remaining = eligible ? 0 : buy - (qtyInCart % buy)
    return {
      promo,
      eligible,
      remaining,
      giftQty,
      giftPrice: promo.get_price ?? 0,
      giftProductId,
      discountAmount: 0,
      discountPercent: 0,
      label: `Mua ${buy} tặng ${get}`,
    }
  }

  // percent / fixed_amount / unit_price — đều theo ngưỡng min_qty
  const eligible = qtyInCart >= promo.min_qty
  const lineTotal = unitPrice * qtyInCart
  let discountAmount = 0
  let discountPercent = 0

  if (promo.promo_type === 'percent') {
    discountPercent = promo.discount_value
    discountAmount = Math.round(lineTotal * promo.discount_value / 100)
  } else if (promo.promo_type === 'unit_price') {
    // Giá ưu đãi cố định → quy về CK dòng để order_lines vẫn giữ GIÁ GỐC + phần giảm.
    // Giá ưu đãi ≥ giá đang bán → KM vô nghĩa, tự tắt (không bao giờ làm khách trả đắt hơn).
    if (unitPrice <= 0 || promo.discount_value >= unitPrice) return null
    // KHÔNG làm tròn % — giá lẻ (vd 95.500đ) sẽ sai giá nếu ép về số nguyên.
    discountPercent = ((unitPrice - promo.discount_value) / unitPrice) * 100
    discountAmount = Math.round((unitPrice - promo.discount_value) * qtyInCart)
  } else {
    // fixed_amount: giảm discount_value ₫ trên mỗi đơn vị
    discountAmount = Math.min(promo.discount_value * qtyInCart, lineTotal)
    discountPercent = lineTotal > 0 ? Math.round((discountAmount / lineTotal) * 100) : 0
  }

  if (discountAmount <= 0 && discountPercent <= 0) return null
  return {
    promo,
    eligible,
    remaining: eligible ? 0 : promo.min_qty - qtyInCart,
    giftQty: 0,
    giftPrice: 0,
    giftProductId,
    discountAmount,
    discountPercent,
    label: promoShortLabel(promo),
  }
}

/** Giá trị ưu đãi quy ra tiền — để so bậc KM nào lợi nhất cho khách. */
function benefitOf(ev: ProductPromoEvaluation, unitPrice: number): number {
  if (ev.promo.promo_type === 'buy_x_get_y') {
    // Quà có thể là SP khác (không biết giá ở đây) → lấy đơn giá dòng mua làm ước lượng.
    return ev.giftQty * Math.max(0, unitPrice - ev.giftPrice)
  }
  return ev.discountAmount
}

/**
 * Một SP có thể gắn NHIỀU bậc KM (vd: mua 10 giá rẻ, mua nguyên thùng rẻ hơn).
 * Chọn bậc ĐỦ ĐIỀU KIỆN có lợi nhất cho khách (ưu tiên priority admin đặt trước,
 * rồi tới số tiền ưu đãi). Chưa bậc nào đủ điều kiện → trả bậc gần đạt nhất để
 * POS gợi ý "mua thêm N…". Không có KM nào → null.
 */
export function evaluateBestPromo(
  promos: ProductPromotion[],
  qtyInCart: number,
  unitPrice: number,
): ProductPromoEvaluation | null {
  const evals = promos
    .map(p => evaluateProductPromo(p, qtyInCart, unitPrice))
    .filter((e): e is ProductPromoEvaluation => e != null)
  if (evals.length === 0) return null

  const eligible = evals.filter(e => e.eligible)
  if (eligible.length > 0) {
    return eligible.sort((a, b) =>
      (b.promo.priority - a.promo.priority)
      || (benefitOf(b, unitPrice) - benefitOf(a, unitPrice))
      || a.promo.id.localeCompare(b.promo.id),
    )[0]
  }
  return evals.sort((a, b) =>
    (a.remaining - b.remaining)
    || (b.promo.priority - a.promo.priority)
    || a.promo.id.localeCompare(b.promo.id),
  )[0]
}

/**
 * Load các KM theo hàng hóa đang hoạt động, lọc theo chi nhánh hiện tại
 * (branch_ids rỗng = mọi chi nhánh) và hiệu lực ngày.
 */
export function useProductPromotions(branchId?: string | null) {
  const [promotions, setPromotions] = useState<ProductPromotion[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('product_promotions')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('id')
    setPromotions((data as ProductPromotion[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // POS thường mở suốt ngày trên máy quầy. Trước đây KM chỉ nạp 1 lần lúc mount →
  // admin sửa/tắt KM xong, quầy vẫn chạy KM cũ tới khi F5. Nạp lại khi quay lại tab.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  // Lọc theo chi nhánh + hiệu lực; gom theo product_id
  const byProduct = useMemo(() => {
    const now = new Date()
    const map = new Map<string, ProductPromotion[]>()
    for (const p of promotions) {
      if (!isWithinValidity(p, now)) continue
      const branchOk = p.branch_ids.length === 0 || (branchId != null && p.branch_ids.includes(branchId))
      if (!branchOk) continue
      const list = map.get(p.product_id) ?? []
      list.push(p)
      map.set(p.product_id, list)
    }
    return map
  }, [promotions, branchId])

  const getPromosForProduct = useCallback(
    (productId: string): ProductPromotion[] => byProduct.get(productId) ?? [],
    [byProduct],
  )

  /** Lấy KM ưu tiên cao nhất của SP (đầu danh sách đã sort theo priority). */
  const getTopPromo = useCallback(
    (productId: string): ProductPromotion | null => (byProduct.get(productId) ?? [])[0] ?? null,
    [byProduct],
  )

  /**
   * KM tốt nhất cho SP theo SL đang có trong giỏ — xét MỌI bậc KM của SP đó,
   * không chỉ bậc priority cao nhất.
   */
  const getBestPromo = useCallback(
    (productId: string, qtyInCart: number, unitPrice: number): ProductPromoEvaluation | null =>
      evaluateBestPromo(byProduct.get(productId) ?? [], qtyInCart, unitPrice),
    [byProduct],
  )

  return { loading, byProduct, getPromosForProduct, getTopPromo, getBestPromo }
}
