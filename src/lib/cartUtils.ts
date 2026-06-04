export interface CartRow {
  id: string
  product: { id: string; name: string }
  quantity: number
  unitPrice: number
  discountPercent: number
  isPriceOverridden: boolean
  /** Dòng quà tặng từ KM (mua X tặng Y). Phân biệt với sản phẩm giá-0 thật. */
  isGift?: boolean
}

export function cartAddProduct(
  cart: CartRow[],
  product: { id: string; name: string },
  price: number,
): CartRow[] {
  const existingIndex = cart.findIndex(
    item =>
      item.product.id === product.id &&
      item.unitPrice === price &&
      item.discountPercent === 0 &&
      !item.isPriceOverridden,
  )
  if (existingIndex > -1) {
    const updated = [...cart]
    updated[existingIndex] = { ...updated[existingIndex], quantity: updated[existingIndex].quantity + 1 }
    return updated
  }
  return [
    ...cart,
    { id: crypto.randomUUID(), product, quantity: 1, unitPrice: price, discountPercent: 0, isPriceOverridden: false },
  ]
}

export function cartAdjustQuantity(cart: CartRow[], rowId: string, amount: number): CartRow[] {
  const index = cart.findIndex(item => item.id === rowId)
  if (index === -1) return cart
  const updated = [...cart]
  const nextQty = updated[index].quantity + amount
  if (nextQty <= 0) { updated.splice(index, 1) }
  else { updated[index] = { ...updated[index], quantity: nextQty } }
  return updated
}

export function cartUpdateQuantity(cart: CartRow[], rowId: string, qty: number): CartRow[] {
  const index = cart.findIndex(item => item.id === rowId)
  if (index === -1) return cart
  const updated = [...cart]
  updated[index] = { ...updated[index], quantity: Math.max(1, qty) }
  return updated
}

export function cartUpdateUnitPrice(cart: CartRow[], rowId: string, price: number): CartRow[] {
  const index = cart.findIndex(item => item.id === rowId)
  if (index === -1) return cart
  const updated = [...cart]
  updated[index] = { ...updated[index], unitPrice: price, isPriceOverridden: true }
  return updated
}

export function cartSetDiscount(cart: CartRow[], rowId: string, discount: number): CartRow[] {
  const index = cart.findIndex(item => item.id === rowId)
  if (index === -1) return cart
  const updated = [...cart]
  updated[index] = { ...updated[index], discountPercent: Math.min(100, Math.max(0, discount)) }
  return updated
}

export function cartCalcSubtotal(cart: CartRow[]): number {
  return cart.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0)
}

export function cartCalcGrandTotal(subtotal: number, discountAmount: number): number {
  return Math.max(0, subtotal - discountAmount)
}
