import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface ProductPromotion {
  id: string
  product_id: string
  name: string
  promo_type: 'buy_x_get_y' | 'percent' | 'fixed_amount'
  buy_qty: number | null
  get_qty: number | null
  get_product_id: string | null
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
      giftProductId,
      discountAmount: 0,
      discountPercent: 0,
      label: `Mua ${buy} tặng ${get}`,
    }
  }

  // percent / fixed_amount theo ngưỡng min_qty
  const eligible = qtyInCart >= promo.min_qty
  const lineTotal = unitPrice * qtyInCart
  let discountAmount = 0
  let discountPercent = 0
  if (promo.promo_type === 'percent') {
    discountPercent = promo.discount_value
    discountAmount = Math.round(lineTotal * promo.discount_value / 100)
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
    giftProductId,
    discountAmount,
    discountPercent,
    label: promoShortLabel(promo),
  }
}

/**
 * Load các KM theo hàng hóa đang hoạt động, lọc theo chi nhánh hiện tại
 * (branch_ids rỗng = mọi chi nhánh) và hiệu lực ngày.
 */
export function useProductPromotions(branchId?: string | null) {
  const [promotions, setPromotions] = useState<ProductPromotion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('product_promotions')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .then(({ data }: { data: ProductPromotion[] | null }) => {
        if (cancelled) return
        setPromotions(data ?? [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

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

  return { loading, byProduct, getPromosForProduct, getTopPromo }
}
