import { describe, it, expect } from 'vitest'
import {
  cartAddProduct,
  cartAdjustQuantity,
  cartUpdateQuantity,
  cartUpdateUnitPrice,
  cartSetDiscount,
  cartCalcSubtotal,
  cartCalcGrandTotal,
  type CartRow,
} from '../../lib/cartUtils'

const makeProduct = (id = 'p1') => ({ id, name: `Product ${id}` })

const makeRow = (overrides: Partial<CartRow> = {}): CartRow => ({
  id: 'row-1',
  product: makeProduct(),
  quantity: 1,
  unitPrice: 100_000,
  discountPercent: 0,
  isPriceOverridden: false,
  ...overrides,
})

describe('cartAddProduct', () => {
  it('adds new product to empty cart', () => {
    const cart = cartAddProduct([], makeProduct(), 50_000)
    expect(cart).toHaveLength(1)
    expect(cart[0].quantity).toBe(1)
    expect(cart[0].unitPrice).toBe(50_000)
  })

  it('increments quantity when same product + price already in cart', () => {
    const existing = makeRow({ product: makeProduct('p1'), unitPrice: 50_000 })
    const cart = cartAddProduct([existing], makeProduct('p1'), 50_000)
    expect(cart).toHaveLength(1)
    expect(cart[0].quantity).toBe(2)
  })

  it('adds separate row when price differs', () => {
    const existing = makeRow({ product: makeProduct('p1'), unitPrice: 50_000 })
    const cart = cartAddProduct([existing], makeProduct('p1'), 45_000)
    expect(cart).toHaveLength(2)
  })

  it('adds separate row when product differs', () => {
    const existing = makeRow({ product: makeProduct('p1'), unitPrice: 50_000 })
    const cart = cartAddProduct([existing], makeProduct('p2'), 50_000)
    expect(cart).toHaveLength(2)
  })

  it('does not merge into isPriceOverridden row', () => {
    const existing = makeRow({ product: makeProduct('p1'), unitPrice: 50_000, isPriceOverridden: true })
    const cart = cartAddProduct([existing], makeProduct('p1'), 50_000)
    expect(cart).toHaveLength(2)
  })
})

describe('cartAdjustQuantity', () => {
  it('increments quantity', () => {
    const row = makeRow({ quantity: 2 })
    expect(cartAdjustQuantity([row], 'row-1', 1)[0].quantity).toBe(3)
  })

  it('decrements quantity', () => {
    const row = makeRow({ quantity: 3 })
    expect(cartAdjustQuantity([row], 'row-1', -1)[0].quantity).toBe(2)
  })

  it('removes row when quantity reaches 0', () => {
    const row = makeRow({ quantity: 1 })
    expect(cartAdjustQuantity([row], 'row-1', -1)).toHaveLength(0)
  })

  it('removes row when quantity goes negative', () => {
    const row = makeRow({ quantity: 1 })
    expect(cartAdjustQuantity([row], 'row-1', -5)).toHaveLength(0)
  })

  it('ignores unknown rowId', () => {
    const row = makeRow()
    const result = cartAdjustQuantity([row], 'unknown', 1)
    expect(result[0].quantity).toBe(1)
  })
})

describe('cartUpdateQuantity', () => {
  it('sets quantity directly', () => {
    const row = makeRow({ quantity: 1 })
    expect(cartUpdateQuantity([row], 'row-1', 5)[0].quantity).toBe(5)
  })

  it('clamps quantity to minimum 1', () => {
    const row = makeRow({ quantity: 3 })
    expect(cartUpdateQuantity([row], 'row-1', 0)[0].quantity).toBe(1)
  })
})

describe('cartUpdateUnitPrice', () => {
  it('updates price and sets isPriceOverridden', () => {
    const row = makeRow({ unitPrice: 100_000 })
    const result = cartUpdateUnitPrice([row], 'row-1', 80_000)
    expect(result[0].unitPrice).toBe(80_000)
    expect(result[0].isPriceOverridden).toBe(true)
  })
})

describe('cartSetDiscount', () => {
  it('sets discount percent', () => {
    const row = makeRow()
    expect(cartSetDiscount([row], 'row-1', 10)[0].discountPercent).toBe(10)
  })

  it('clamps discount to 0–100', () => {
    const row = makeRow()
    expect(cartSetDiscount([row], 'row-1', 150)[0].discountPercent).toBe(100)
    expect(cartSetDiscount([row], 'row-1', -5)[0].discountPercent).toBe(0)
  })
})

describe('cartCalcSubtotal', () => {
  it('sums unitPrice × quantity for all rows', () => {
    const cart = [
      makeRow({ unitPrice: 100_000, quantity: 2 }),
      makeRow({ id: 'row-2', product: makeProduct('p2'), unitPrice: 50_000, quantity: 3 }),
    ]
    expect(cartCalcSubtotal(cart)).toBe(350_000)
  })

  it('returns 0 for empty cart', () => {
    expect(cartCalcSubtotal([])).toBe(0)
  })
})

describe('cartCalcGrandTotal', () => {
  it('subtracts discount from subtotal', () => {
    expect(cartCalcGrandTotal(500_000, 50_000)).toBe(450_000)
  })

  it('clamps to 0 when discount exceeds subtotal', () => {
    expect(cartCalcGrandTotal(100_000, 200_000)).toBe(0)
  })
})
