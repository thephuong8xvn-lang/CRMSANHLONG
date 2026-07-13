import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { CartRow } from '../lib/cartUtils'

export interface Promotion {
  id: string
  code: string
  name: string
  description?: string
  discount_type: 'percent' | 'fixed_amount' | 'buy_x_get_y' | 'combo_price' | 'tiered_quantity' | 'customer_tier_discount'
  discount_value: number
  min_order_amount: number
  applies_to: {
    product_ids?: string[]
    category_ids?: string[]
    customer_tiers?: string[]
  }
  buy_x_qty?: number
  get_y_qty?: number
  /** Giá cố định cho trọn bộ combo (combo_price). Cần applies_to.product_ids. */
  combo_price?: number | null
  tiers?: { min_qty: number; discount_percent: number }[]
  customer_tiers?: string[]
  branch_ids?: string[]
  valid_from?: string
  valid_to?: string
  max_uses?: number
  current_uses: number
  priority: number
  is_active: boolean
}

export interface Voucher {
  id: string
  code: string
  discount_type: 'percent' | 'fixed_amount'
  discount_value: number
  min_order_amount: number
  max_discount?: number
  valid_to?: string
  max_uses: number
  current_uses: number
}

export interface AppliedDiscount {
  type: 'promotion' | 'voucher'
  id: string
  /** Mã voucher — gửi lên server để server tự tra & tự tính lại tiền giảm. */
  code?: string
  name: string
  /** Chỉ để HIỂN THỊ. Server tự tính lại số thật khi chốt đơn, không nhận số này. */
  discountAmount: number
  label: string
}

export function calcPromoDiscount(promo: Promotion, cart: CartRow[], subtotal: number, customerTier?: string): number {
  if (subtotal < promo.min_order_amount) return 0

  const now = new Date()
  if (promo.valid_from && new Date(promo.valid_from) > now) return 0
  if (promo.valid_to && new Date(promo.valid_to) < now) return 0
  if (promo.max_uses != null && promo.current_uses >= promo.max_uses) return 0

  if (promo.customer_tiers && promo.customer_tiers.length > 0) {
    if (!customerTier || !promo.customer_tiers.includes(customerTier)) return 0
  }

  const applicableRows = promo.applies_to?.product_ids?.length
    ? cart.filter(r => promo.applies_to.product_ids!.includes(r.product.id))
    : cart

  const applicableSubtotal = applicableRows.reduce((s, r) => s + r.unitPrice * r.quantity, 0)

  switch (promo.discount_type) {
    case 'percent':
      return Math.round(applicableSubtotal * promo.discount_value / 100)

    case 'fixed_amount':
      return Math.min(promo.discount_value, applicableSubtotal)

    // ⚠️ Ngữ nghĩa KM cấp đơn KHÁC với KM theo sản phẩm (product_promotions):
    //   • Ở đây: khách lấy (X+Y) món nhưng chỉ TÍNH TIỀN X món — hàng tặng đã nằm
    //     sẵn trong giỏ, chỉ quy ra tiền giảm. Không sinh dòng quà.
    //   • KM sản phẩm: mua X thì THÊM Y món quà mới vào giỏ.
    // Không được đổi sang floor(qty/X) ở đây: sẽ giảm tiền mà không xuất thêm hàng.
    // Loại này đã gỡ khỏi form tạo mới — chỉ còn tính cho dữ liệu KM cũ.
    case 'buy_x_get_y': {
      const x = promo.buy_x_qty ?? 1
      const y = promo.get_y_qty ?? 1
      const totalQty = applicableRows.reduce((s, r) => s + r.quantity, 0)
      const sets = Math.floor(totalQty / (x + y))
      const cheapestPrice = applicableRows.length > 0
        ? Math.min(...applicableRows.map(r => r.unitPrice))
        : 0
      return sets * y * cheapestPrice
    }

    // Combo: giỏ phải có ĐỦ mọi SP trong applies_to.product_ids. Mỗi "bộ" gồm 1 đơn vị
    // mỗi SP; số bộ = SL nhỏ nhất trong các SP đó. Giảm = (giá gốc bộ − giá combo) × số bộ.
    case 'combo_price': {
      const ids = promo.applies_to?.product_ids ?? []
      const comboPrice = promo.combo_price
      if (ids.length === 0 || comboPrice == null || comboPrice < 0) return 0

      let sets = Infinity
      let originalPerSet = 0
      for (const id of ids) {
        const rows = cart.filter(r => r.product.id === id)
        const qty = rows.reduce((s, r) => s + r.quantity, 0)
        if (qty <= 0) return 0                       // thiếu 1 SP → không thành combo
        sets = Math.min(sets, qty)
        originalPerSet += Math.min(...rows.map(r => r.unitPrice))
      }
      if (!Number.isFinite(sets) || sets < 1) return 0

      return Math.max(0, Math.round((originalPerSet - comboPrice) * sets))
    }

    case 'tiered_quantity': {
      const totalQty = applicableRows.reduce((s, r) => s + r.quantity, 0)
      const sorted = [...(promo.tiers ?? [])].sort((a, b) => b.min_qty - a.min_qty)
      const tier = sorted.find(t => totalQty >= t.min_qty)
      if (!tier) return 0
      return Math.round(applicableSubtotal * tier.discount_percent / 100)
    }

    case 'customer_tier_discount':
      return Math.round(applicableSubtotal * promo.discount_value / 100)

    default:
      return 0
  }
}

export function usePromotionEngine(branchId?: string | null) {
  const [allPromotions, setAllPromotions] = useState<Promotion[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('promotions')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })
    setAllPromotions((data as Promotion[] | null) ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  // Nạp lại khi quay lại tab: KM vừa sửa/tắt/hết lượt phải có hiệu lực ngay tại quầy.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  // Lọc KM theo chi nhánh hiện tại: branch_ids rỗng = toàn hệ thống
  const promotions = useMemo(
    () => allPromotions.filter(p => {
      const branches = p.branch_ids ?? []
      return branches.length === 0 || (branchId != null && branches.includes(branchId))
    }),
    [allPromotions, branchId],
  )

  const applyBestPromotion = useCallback(
    (cart: CartRow[], subtotal: number, customerTier?: string): AppliedDiscount | null => {
      let best: { promo: Promotion; amount: number } | null = null
      for (const promo of promotions) {
        const amount = calcPromoDiscount(promo, cart, subtotal, customerTier)
        if (amount > 0 && (!best || amount > best.amount)) {
          best = { promo, amount }
        }
      }
      if (!best) return null
      return {
        type: 'promotion',
        id: best.promo.id,
        name: best.promo.name,
        discountAmount: best.amount,
        label: best.promo.name,
      }
    },
    [promotions],
  )

  const applyVoucher = useCallback(
    async (code: string, subtotal: number): Promise<AppliedDiscount | null> => {
      const { data, error } = await supabase
        .from('vouchers')
        .select('*')
        .eq('code', code.trim().toUpperCase())
        .eq('is_active', true)
        .single()

      if (error || !data) return null
      const v = data as Voucher

      if (subtotal < v.min_order_amount) return null
      if (v.current_uses >= v.max_uses) return null
      if (v.valid_to && new Date(v.valid_to) < new Date()) return null

      let discountAmount = v.discount_type === 'percent'
        ? Math.round(subtotal * v.discount_value / 100)
        : v.discount_value

      if (v.max_discount != null) {
        discountAmount = Math.min(discountAmount, v.max_discount)
      }

      return {
        type: 'voucher',
        id: v.id,
        code: v.code,
        name: `Voucher ${code}`,
        discountAmount,
        label: `Voucher ${code} (-${v.discount_value}${v.discount_type === 'percent' ? '%' : '₫'})`,
      }
    },
    [],
  )

  return { promotions, applyBestPromotion, applyVoucher }
}
