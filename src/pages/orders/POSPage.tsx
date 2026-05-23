import { useState, useEffect, useRef } from 'react'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  AlertTriangle,
  Printer,
  X,
  CheckCircle2,
  Package,
  ScanLine,
  Smartphone,
  ChevronDown,
  User,
  Receipt
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface Customer {
  id: string
  code: string
  farm_name: string
  credit_limit: number
  price_list_id: string | null
  value_tier: string
}

interface Product {
  id: string
  sku: string
  name: string
  unit: string
  is_lot_managed: boolean
  is_active: boolean
  category_id: string
  package_specs: string | null
  image_urls: string[]
  product_categories: { id: string; code: string; name: string } | null
  brands: { name: string } | null
  price_list_items: {
    price_list_id: string
    cost_price: number
    selling_price: number
    price_list: { id: string; code: string; name: string } | null
  }[]
}

interface CartItem {
  id: string
  product: Product
  quantity: number
  unitPrice: number
  discountPercent: number // manual discount in percent
  isPriceOverridden?: boolean
}

interface PriceList {
  id: string
  code: string
  name: string
  is_default: boolean
}

interface InvoiceTab {
  id: string
  name: string
  cart: CartItem[]
  invoiceDiscount: number
  paymentMethod: 'cash' | 'bank_transfer' | 'credit'
  selectedCustomerId: string
  customerSearchQuery: string
  paymentAmount: number
  notes: string
  selectedPriceListId: string
}

// Helpers for input masking and currency format
const formatNumberString = (val: number | string) => {
  if (val === '' || val === null || val === undefined) return ''
  const num = typeof val === 'number' ? val : parseFloat(val.toString().replace(/\D/g, ''))
  if (isNaN(num)) return ''
  return num.toLocaleString('vi-VN')
}

const parseNumberString = (val: string) => {
  const cleaned = val.replace(/\D/g, '')
  return cleaned ? parseInt(cleaned, 10) : 0
}

export default function POSPage() {
  const { profile } = useAuth()

  // Base Data States
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerDebt, setCustomerDebt] = useState(0)
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<{ id: string; code: string; name: string }[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [priceLists, setPriceLists] = useState<PriceList[]>([])

  // Tabs management state
  const [tabs, setTabs] = useState<InvoiceTab[]>([
    {
      id: '1',
      name: 'Hóa đơn 1',
      cart: [],
      invoiceDiscount: 0,
      paymentMethod: 'cash',
      selectedCustomerId: '',
      customerSearchQuery: '',
      paymentAmount: 0,
      notes: '',
      selectedPriceListId: ''
    }
  ])
  const [activeTabId, setActiveTabId] = useState<string>('1')

  // Search / Dropdown UI States
  const [searchTerm, setSearchTerm] = useState('')
  const [focusedSearchIndex, setFocusedSearchIndex] = useState(-1)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showProductImages, setShowProductImages] = useState(true)

  // Feedback UI States
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [createdOrderCode, setCreatedOrderCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Focus search input
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Active Tab Proxy Calculations
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]

  const cart = activeTab.cart
  const invoiceDiscount = activeTab.invoiceDiscount
  const paymentMethod = activeTab.paymentMethod
  const selectedCustomerId = activeTab.selectedCustomerId
  const customerSearchQuery = activeTab.customerSearchQuery
  const paymentAmount = activeTab.paymentAmount
  const notes = activeTab.notes
  const selectedPriceListId = activeTab.selectedPriceListId

  const updateActiveTab = (fields: Partial<InvoiceTab>) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, ...fields } : t))
  }

  const setCart = (newCart: CartItem[] | ((prev: CartItem[]) => CartItem[])) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const updatedCart = typeof newCart === 'function' ? newCart(t.cart) : newCart
        return { ...t, cart: updatedCart }
      }
      return t
    }))
  }

  const setInvoiceDiscount = (discount: number) => {
    updateActiveTab({ invoiceDiscount: discount })
  }

  const setPaymentMethod = (method: 'cash' | 'bank_transfer' | 'credit') => {
    updateActiveTab({ paymentMethod: method })
  }

  const setSelectedCustomerId = (id: string) => {
    updateActiveTab({ selectedCustomerId: id })
  }

  const setCustomerSearchQuery = (query: string) => {
    updateActiveTab({ customerSearchQuery: query })
  }

  const setSelectedPriceListId = (id: string) => {
    updateActiveTab({ selectedPriceListId: id })
  }

  const setPaymentAmount = (amount: number) => {
    updateActiveTab({ paymentAmount: amount })
  }

  const setNotes = (notesText: string) => {
    updateActiveTab({ notes: notesText })
  }

  // Keyboard navigation & payment hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === '/') || e.key === 'F2') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === 'F3') {
        e.preventDefault()
        setPaymentMethod('cash')
      }
      if (e.key === 'F4') {
        e.preventDefault()
        setPaymentMethod('bank_transfer')
      }
      if (e.key === 'F8') {
        e.preventDefault()
        setPaymentMethod('credit')
      }
      if (e.key === 'F9') {
        e.preventDefault()
        const submitBtn = document.getElementById('btn-pos-pay')
        if (submitBtn) submitBtn.click()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Fetch initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: custData } = await supabase
          .from('customers')
          .select('id, code, farm_name, credit_limit, price_list_id, value_tier')
          .eq('is_active', true)
        if (custData) setCustomers(custData as unknown as Customer[])

        const { data: catData } = await supabase
          .from('product_categories')
          .select('id, code, name')
          .eq('is_active', true)
        if (catData) setCategories(catData)

        const { data: plData } = await supabase
          .from('price_lists')
          .select('id, code, name, is_default')
          .eq('is_active', true)
        if (plData) {
          setPriceLists(plData)
          const def = plData.find(pl => pl.is_default) || plData.find(pl => pl.code === 'GIA-LE') || plData[0]
          if (def) {
            setTabs(prev => prev.map(t => t.id === '1' ? { ...t, selectedPriceListId: def.id } : t))
          }
        }

        const { data: prodData } = await supabase
          .from('products')
          .select(`
            id,
            sku,
            name,
            unit,
            is_lot_managed,
            is_active,
            category_id,
            package_specs,
            image_urls,
            product_categories(id, code, name),
            brands(name),
            price_list_items(price_list_id, cost_price, selling_price, price_list:price_lists(id, code, name))
          `)
          .eq('is_active', true)
        if (prodData) setProducts(prodData as unknown as Product[])
      } catch (err) {
        console.error('Error fetching data:', err)
      }
    }
    loadData()
  }, [])

  // Fetch customer debt
  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerDebt(0)
      return
    }
    const fetchDebt = async () => {
      try {
        const { data, error } = await supabase
          .from('customer_debts')
          .select('amount')
          .eq('customer_id', selectedCustomerId)
          .eq('is_settled', false)

        if (!error && data) {
          const totalDebt = data.reduce((sum, item) => sum + Number(item.amount), 0)
          setCustomerDebt(totalDebt)
        }
      } catch (err) {
        console.error('Error fetching customer debt:', err)
      }
    }
    fetchDebt()
  }, [selectedCustomerId])

  // Update selected price list when customer changes
  useEffect(() => {
    if (selectedCustomerId) {
      const selectedCustomer = customers.find(c => c.id === selectedCustomerId)
      if (selectedCustomer?.price_list_id) {
        setSelectedPriceListId(selectedCustomer.price_list_id)
      } else {
        const def = priceLists.find(pl => pl.is_default) || priceLists.find(pl => pl.code === 'GIA-LE') || priceLists[0]
        if (def) {
          setSelectedPriceListId(def.id)
        }
      }
    }
  }, [selectedCustomerId, customers, priceLists])

  // Recalculate cart item prices when price list changes
  useEffect(() => {
    if (!selectedPriceListId) return
    setCart(prevCart =>
      prevCart.map(item => {
        if (item.isPriceOverridden) return item
        
        let price = 0
        if (item.product.price_list_items && item.product.price_list_items.length > 0) {
          const itemPrice = item.product.price_list_items.find(
            pItem => pItem.price_list_id === selectedPriceListId || pItem.price_list?.id === selectedPriceListId
          )
          if (itemPrice) {
            price = itemPrice.selling_price
          } else {
            const retailPrice = item.product.price_list_items.find(
              pItem => pItem.price_list?.code === 'GIA-LE'
            )
            price = retailPrice ? retailPrice.selling_price : item.product.price_list_items[0].selling_price
          }
        }
        return {
          ...item,
          unitPrice: price
        }
      })
    )
  }, [selectedPriceListId])

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId)

  // Filter products
  const filteredProducts = products.filter(p => {
    const matchesCategory = !selectedCategoryId || p.category_id === selectedCategoryId
    const matchesSearch = !searchTerm.trim() ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesCategory && matchesSearch
  })

  // Filter customers
  const filteredCustomers = customers.filter(c => {
    if (!customerSearchQuery.trim()) return true
    return c.farm_name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(customerSearchQuery.toLowerCase())
  })

  // Add to cart helper
  const addToCart = (product: Product) => {
    let price = 0
    if (product.price_list_items && product.price_list_items.length > 0) {
      const itemPrice = product.price_list_items.find(
        item => item.price_list_id === selectedPriceListId || item.price_list?.id === selectedPriceListId
      )
      if (itemPrice) {
        price = itemPrice.selling_price
      } else {
        const retailPrice = product.price_list_items.find(
          item => item.price_list?.code === 'GIA-LE'
        )
        price = retailPrice ? retailPrice.selling_price : product.price_list_items[0].selling_price
      }
    }

    const existingIndex = cart.findIndex(
      item => item.product.id === product.id &&
              item.unitPrice === price &&
              item.discountPercent === 0 &&
              !item.isPriceOverridden
    )

    if (existingIndex > -1) {
      const updated = [...cart]
      updated[existingIndex].quantity += 1
      setCart(updated)
    } else {
      setCart([
        ...cart,
        {
          id: crypto.randomUUID(),
          product,
          quantity: 1,
          unitPrice: price,
          discountPercent: 0,
          isPriceOverridden: false
        }
      ])
    }
  }

  // Adjust cart quantity
  const adjustQuantity = (rowId: string, amount: number) => {
    const index = cart.findIndex(item => item.id === rowId)
    if (index === -1) return
    const updated = [...cart]
    const nextQty = updated[index].quantity + amount
    if (nextQty <= 0) {
      updated.splice(index, 1)
    } else {
      updated[index].quantity = nextQty
    }
    setCart(updated)
  }

  // Update quantity directly
  const updateQuantity = (rowId: string, qty: number) => {
    const index = cart.findIndex(item => item.id === rowId)
    if (index === -1) return
    const updated = [...cart]
    updated[index].quantity = Math.max(1, qty)
    setCart(updated)
  }

  // Update unit price directly (manual override)
  const updateUnitPrice = (rowId: string, price: number) => {
    const index = cart.findIndex(item => item.id === rowId)
    if (index === -1) return
    const updated = [...cart]
    updated[index].unitPrice = Math.max(0, price)
    updated[index].isPriceOverridden = true
    setCart(updated)
  }

  // Add promo line for a product (10+2 scenario)
  const addPromoLine = (product: Product) => {
    setCart([
      ...cart,
      {
        id: crypto.randomUUID(),
        product,
        quantity: 1,
        unitPrice: 0,
        discountPercent: 0,
        isPriceOverridden: true
      }
    ])
  }

  // Set manual discount for row
  const setRowDiscount = (rowId: string, discount: number) => {
    const index = cart.findIndex(item => item.id === rowId)
    if (index === -1) return
    const updated = [...cart]
    updated[index].discountPercent = Math.max(0, Math.min(100, discount))
    setCart(updated)
  }

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => {
    const lineTotal = item.quantity * item.unitPrice
    const discount = lineTotal * (item.discountPercent / 100)
    return sum + (lineTotal - discount)
  }, 0)

  const grandTotal = Math.max(0, subtotal - invoiceDiscount)

  // Credit limit validation
  const isCreditLimitExceeded = selectedCustomer &&
    (customerDebt + grandTotal > selectedCustomer.credit_limit)

  // Autocomplete products
  const searchResults = products.filter(p => {
    if (!searchTerm.trim()) return false
    return p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  })

  // Keyboard navigation for Autocomplete
  useEffect(() => {
    if (searchResults.length > 0) {
      setFocusedSearchIndex(0)
    } else {
      setFocusedSearchIndex(-1)
    }
  }, [searchTerm])

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (searchResults.length > 0) {
        setFocusedSearchIndex(prev => (prev + 1) % searchResults.length)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (searchResults.length > 0) {
        setFocusedSearchIndex(prev => (prev - 1 + searchResults.length) % searchResults.length)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const index = focusedSearchIndex >= 0 ? focusedSearchIndex : 0
      if (searchResults[index]) {
        addToCart(searchResults[index])
        setSearchTerm('')
        setFocusedSearchIndex(-1)
      }
    } else if (e.key === 'Escape') {
      setSearchTerm('')
      setFocusedSearchIndex(-1)
    }
  }

  // Cash recommendations calculation
  const getCashSuggestions = (total: number): number[] => {
    if (total <= 0) return []
    const suggestionsSet = new Set<number>()
    suggestionsSet.add(total)

    const roundings = [1000, 5000, 10000, 50000, 100000, 200000, 500000]
    for (const r of roundings) {
      const val = Math.ceil(total / r) * r
      if (val >= total) {
        suggestionsSet.add(val)
      }
    }
    return Array.from(suggestionsSet).sort((a, b) => a - b).slice(0, 6)
  }

  const handleCashSuggestionClick = (amount: number) => {
    setPaymentAmount(amount)
  }

  const effectivePaymentAmount = paymentMethod === 'credit' ? 0 : (paymentAmount || grandTotal)
  const changeDue = Math.max(0, effectivePaymentAmount - grandTotal)

  // Tabs management
  const handleAddTab = () => {
    let nextNum = 1
    while (tabs.some(t => t.name === `Hóa đơn ${nextNum}`)) {
      nextNum++
    }
    const newId = crypto.randomUUID()
    const def = priceLists.find(pl => pl.is_default) || priceLists.find(pl => pl.code === 'GIA-LE') || priceLists[0]
    const defPlId = def ? def.id : ''

    const newTab: InvoiceTab = {
      id: newId,
      name: `Hóa đơn ${nextNum}`,
      cart: [],
      invoiceDiscount: 0,
      paymentMethod: 'cash',
      selectedCustomerId: '',
      customerSearchQuery: '',
      paymentAmount: 0,
      notes: '',
      selectedPriceListId: defPlId
    }
    setTabs([...tabs, newTab])
    setActiveTabId(newId)
  }

  const handleCloseTab = (idToClose: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (tabs.length === 1) {
      const def = priceLists.find(pl => pl.is_default) || priceLists.find(pl => pl.code === 'GIA-LE') || priceLists[0]
      const defPlId = def ? def.id : ''
      setTabs([
        {
          id: tabs[0].id,
          name: tabs[0].name,
          cart: [],
          invoiceDiscount: 0,
          paymentMethod: 'cash',
          selectedCustomerId: '',
          customerSearchQuery: '',
          paymentAmount: 0,
          notes: '',
          selectedPriceListId: defPlId
        }
      ])
      return
    }

    const index = tabs.findIndex(t => t.id === idToClose)
    const newTabs = tabs.filter(t => t.id !== idToClose)
    setTabs(newTabs)

    if (activeTabId === idToClose) {
      const nextActiveIndex = Math.max(0, index - 1)
      setActiveTabId(newTabs[nextActiveIndex].id)
    }
  }

  // Submit billing
  const handlePayment = async () => {
    if (cart.length === 0) {
      setAlertMsg({ type: 'error', text: 'Giỏ hàng đang trống. Vui lòng thêm sản phẩm.' })
      return
    }
    if (!selectedCustomerId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn khách hàng để thanh toán.' })
      return
    }
    if (!profile?.id) {
      setAlertMsg({ type: 'error', text: 'Lỗi tài khoản. Vui lòng đăng nhập lại.' })
      return
    }

    if (paymentMethod === 'credit' && isCreditLimitExceeded) {
      setAlertMsg({
        type: 'error',
        text: `Khách hàng vượt quá hạn mức nợ cho phép. Hạn mức: ${selectedCustomer.credit_limit.toLocaleString('vi-VN')} ₫. Nợ hiện tại: ${customerDebt.toLocaleString('vi-VN')} ₫`
      })
      return
    }

    setSubmitting(true)
    try {
      const rand = Math.floor(10000 + Math.random() * 90000)
      const orderCode = `DH-${rand}`

      const orderInsert = {
        order_code: orderCode,
        customer_id: selectedCustomerId,
        status: 'confirmed',
        payment_status: paymentMethod === 'credit' ? 'unpaid' : 'paid',
        payment_method: paymentMethod,
        owner_user_id: profile.id,
        price_list_id: selectedPriceListId || null,
        subtotal: subtotal,
        discount_total: invoiceDiscount,
        grand_total: grandTotal,
        paid_amount: paymentMethod === 'credit' ? 0 : grandTotal,
        delivery_address: 'Giao trực tiếp tại quầy POS',
        notes: notes || 'Đơn hàng bán lẻ từ hệ thống POS desktop.'
      }

      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .insert([orderInsert])
        .select()
        .single()

      if (orderErr) throw orderErr

      const linesInsert = cart.map((item) => ({
        order_id: orderData.id,
        variant_id: null,
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount: item.unitPrice * (item.discountPercent / 100)
      }))

      const { error: linesErr } = await supabase
        .from('order_lines')
        .insert(linesInsert)

      if (linesErr) throw linesErr

      if (paymentMethod !== 'credit') {
        const { error: payErr } = await supabase
          .from('order_payments')
          .insert([{
            order_id: orderData.id,
            payment_method: paymentMethod,
            amount: grandTotal,
            reference_no: paymentMethod === 'bank_transfer' ? `POS-BANK-${rand}` : `POS-CASH-${rand}`,
            notes: 'Thanh toán trực tiếp tại quầy POS.',
            created_by: profile.id
          }])

        if (payErr) throw payErr
      } else {
        const { error: debtErr } = await supabase
          .from('customer_debts')
          .insert([{
            customer_id: selectedCustomerId,
            order_id: orderData.id,
            debt_type: 'order_debt',
            amount: grandTotal,
            due_date: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
            is_settled: false,
            notes: `Công nợ đơn hàng POS ${orderCode}`,
            created_by: profile.id
          }])

        if (debtErr) throw debtErr
      }

      setCreatedOrderCode(orderCode)
      setShowReceiptModal(true)

      const def = priceLists.find(pl => pl.is_default) || priceLists.find(pl => pl.code === 'GIA-LE') || priceLists[0]
      const defPlId = def ? def.id : ''
      updateActiveTab({
        cart: [],
        invoiceDiscount: 0,
        paymentMethod: 'cash',
        selectedCustomerId: '',
        customerSearchQuery: '',
        paymentAmount: 0,
        notes: '',
        selectedPriceListId: defPlId
      })
      setAlertMsg({ type: 'success', text: `Hóa đơn ${orderCode} đã thanh toán thành công.` })

    } catch (err: any) {
      console.error('POS billing error:', err)
      setAlertMsg({ type: 'error', text: 'Thanh toán thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)
  }

  // Custom Search element passed to top Layout header (F2 Product Search)
  const customSearchElement = (
    <div className="relative flex items-center bg-gray-25 rounded-lg px-3 h-10 w-80 md:w-96 border border-gray-105 focus-within:border-blue-500 focus-within:ring-[4px] focus-within:ring-blue-100 transition-all text-gray-800">
      <Search className="text-gray-400 mr-2" size={15} strokeWidth={1.5} />
      <input
        ref={searchInputRef}
        type="text"
        placeholder="F2: Tìm sản phẩm (SKU, tên...) [Ctrl+/]"
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        className="bg-transparent border-none focus:ring-0 text-body-md w-full placeholder-gray-400 p-0 focus:outline-none text-[13px]"
      />
      <span className="text-[9px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 bg-white font-mono select-none ml-2 shrink-0">F2</span>

      {/* Autocomplete Dropdown List */}
      {searchTerm && (
        <div className="absolute left-0 right-0 top-full mt-1.5 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded shadow-xl z-50 py-1 text-gray-800 text-[13px]">
          {searchResults.map((prod, idx) => {
            let price = 0
            if (prod.price_list_items && prod.price_list_items.length > 0) {
              const itemPrice = prod.price_list_items.find(
                item => item.price_list_id === selectedPriceListId || item.price_list?.id === selectedPriceListId
              )
              if (itemPrice) {
                price = itemPrice.selling_price
              } else {
                const retailPrice = prod.price_list_items.find(
                  item => item.price_list?.code === 'GIA-LE'
                )
                price = retailPrice ? retailPrice.selling_price : prod.price_list_items[0].selling_price
              }
            }
            return (
              <div
                key={prod.id}
                onClick={() => {
                  addToCart(prod)
                  setSearchTerm('')
                  setFocusedSearchIndex(-1)
                }}
                className={`px-3 py-1.5 flex items-center justify-between cursor-pointer border-b border-gray-50 last:border-0 ${
                  idx === focusedSearchIndex ? 'bg-blue-50 text-blue-900 font-medium' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-semibold">{prod.name}</span>
                  <span className="text-[10px] text-gray-400 font-mono">SKU: {prod.sku || '-'} | ĐVT: {prod.unit || '-'}</span>
                </div>
                <span className="font-bold text-blue-600">{formatCurrency(price)}</span>
              </div>
            )
          })}
          {searchResults.length === 0 && (
            <div className="p-3 text-center text-gray-400 italic">Không tìm thấy sản phẩm.</div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <Layout activeMenu="Đơn hàng" searchElement={customSearchElement}>
      <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-gray-25 text-gray-600 font-sans">
        
        {/* Toast Alert */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-body-md font-medium">{alertMsg.text}</span>
            <button onClick={() => setAlertMsg(null)} className="text-gray-400 hover:text-gray-600 ml-2">
              <X size={16} />
            </button>
          </div>
        )}

        {/* KiotViet Blue Header Bar (Middle bar under top layout header) */}
        <header className="h-12 bg-[#007edb] flex items-center justify-between px-4 text-white shrink-0 shadow-md">
          {/* Logo & Invoices Tabs */}
          <div className="flex items-center gap-4 h-full overflow-hidden flex-1">
            <span className="font-bold text-sm tracking-wider uppercase flex items-center gap-1.5 border-r border-[#006cc0] pr-4 select-none shrink-0 whitespace-nowrap">
              <Package size={18} />
              Sanh Long POS
            </span>

            {/* Invoices Tab List - Scrollable and Non-Shrinking to handle 18+ tabs */}
            <div className="flex items-end gap-1 h-full pt-1.5 overflow-x-auto flex-nowrap shrink-0 max-w-[40vw] sm:max-w-[45vw] md:max-w-[50vw] lg:max-w-[60vw] xl:max-w-[70vw] scrollbar-none">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t-md text-[13px] font-bold cursor-pointer transition-all select-none shrink-0 ${
                    tab.id === activeTabId
                      ? 'bg-white text-gray-800 border-t-2 border-[#007edb] shadow-sm'
                      : 'bg-[#006cc0] text-blue-100 hover:bg-[#005ba3]'
                  }`}
                >
                  <span className="whitespace-nowrap">{tab.name}</span>
                  <button
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    className={`p-0.5 rounded-full hover:bg-gray-250 transition-colors ${
                      tab.id === activeTabId ? 'text-gray-400 hover:text-gray-700' : 'text-blue-200 hover:text-white'
                    }`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleAddTab}
              className="p-1.5 mb-1 rounded bg-[#006cc0] hover:bg-[#005ba3] text-white flex items-center justify-center transition-colors shrink-0"
              title="Thêm hóa đơn mới"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Grid Toggle and Account Info */}
          <div className="flex items-center gap-3 shrink-0 ml-4">
            <button
              onClick={() => setShowGrid(prev => !prev)}
              className="px-3 py-1 rounded bg-[#006cc0] hover:bg-[#005ba3] text-tiny font-bold flex items-center gap-1.5 transition-colors border border-[#005ba3]"
            >
              <span>{showGrid ? 'Ẩn danh mục' : 'Xem danh mục'}</span>
            </button>
            <div className="flex items-center gap-2 border-l border-[#006cc0] pl-3 text-tiny">
              <User size={15} />
              <span className="font-semibold truncate max-w-[120px]">{profile?.full_name || profile?.email || 'N/A'}</span>
            </div>
          </div>
        </header>

        {/* Main Work Area */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Cart Table Panel: w-[80%] when grid is hidden, w-[45%] when grid is shown */}
          <div className={`flex flex-col p-3 border-r border-gray-150 overflow-hidden ${
            showGrid ? 'w-[45%]' : 'w-[80%]'
          } transition-all duration-300`}>
            
            {/* Table Container */}
            <div className="flex-1 overflow-y-auto bg-white border border-gray-150 rounded shadow-sm">
              <table className="w-full border-collapse text-[13px] text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[10px] font-bold sticky top-0 z-10">
                    <th className="py-3 px-2 text-center w-8">STT</th>
                    <th className="py-3 px-1 text-center w-10">Xóa</th>
                    <th className="py-3 px-2 text-left w-24">Mã hàng</th>
                    <th className="py-3 px-3 text-left min-w-[150px]">Tên sản phẩm</th>
                    <th className="py-3 px-2 text-center w-16">ĐVT</th>
                    <th className="py-3 px-2 text-center w-28">Số lượng</th>
                    <th className="py-3 px-2 text-right w-24">Đơn giá</th>
                    <th className="py-3 px-2 text-center w-14">CK %</th>
                    <th className="py-3 px-2 text-center w-16">Quà tặng</th>
                    <th className="py-3 px-3 text-right w-28">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, idx) => (
                    <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-2 text-center text-gray-400 font-mono text-[11px]">{idx + 1}</td>
                      <td className="py-3 px-1 text-center">
                        <button
                          onClick={() => setCart(cart.filter(c => c.id !== item.id))}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all border border-red-100 bg-red-50/50"
                          title="Xóa dòng"
                        >
                          <Trash2 size={14} className="stroke-[2.5]" />
                        </button>
                      </td>
                      <td className="py-3 px-2 text-left font-mono text-[12px] text-gray-500">
                        {item.product.sku || '-'}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-gray-800 line-clamp-2 leading-snug">{item.product.name}</span>
                          {item.unitPrice === 0 && (
                            <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-600 text-[9px] font-bold rounded border border-emerald-100 uppercase scale-90">KM</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-[11px] font-bold uppercase tracking-wide shadow-sm">
                          {item.product.unit || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <div className="inline-flex items-center border border-gray-300 rounded bg-white overflow-hidden shadow-sm">
                          <button
                            onClick={() => adjustQuantity(item.id, -1)}
                            className="w-7 h-7 flex items-center justify-center text-gray-705 bg-gray-50 hover:bg-gray-200 border-r border-gray-300 active:bg-gray-300 transition-colors font-bold text-lg"
                          >
                            <Minus size={12} />
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={e => updateQuantity(item.id, parseInt(e.target.value) || 1)}
                            className="w-10 h-7 text-center text-[12px] font-bold focus:outline-none bg-white text-gray-900"
                          />
                          <button
                            onClick={() => adjustQuantity(item.id, 1)}
                            className="w-7 h-7 flex items-center justify-center text-gray-705 bg-gray-50 hover:bg-gray-200 border-l border-gray-300 active:bg-gray-300 transition-colors font-bold text-lg"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <input
                          type="text"
                          value={formatNumberString(item.unitPrice || '')}
                          placeholder="0"
                          onChange={e => updateUnitPrice(item.id, parseNumberString(e.target.value))}
                          className="w-20 text-right bg-transparent border-b border-gray-200 focus:border-[#007edb] focus:outline-none font-semibold text-[13px] py-0.5"
                        />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={item.discountPercent || ''}
                          placeholder="0"
                          onChange={e => setRowDiscount(item.id, parseFloat(e.target.value) || 0)}
                          className="w-8 text-center bg-transparent border-b border-gray-200 focus:border-[#007edb] focus:outline-none font-semibold text-[13px] py-0.5"
                        />
                      </td>
                      <td className="py-3 px-2 text-center">
                        <button
                          onClick={() => addPromoLine(item.product)}
                          className="px-2 py-1 text-[10px] font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded shadow-sm flex items-center justify-center gap-0.5 active:scale-95 transition-all"
                          title="Tặng khuyến mãi 0đ"
                        >
                          <span>🎁</span>
                          <span>+KM</span>
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-gray-750 text-[13px]">
                        {((item.unitPrice * (1 - item.discountPercent / 100)) * item.quantity).toLocaleString('vi-VN')} ₫
                      </td>
                    </tr>
                  ))}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-24 text-center text-gray-400 italic">
                        Giỏ hàng trống. Gõ vào ô Tìm kiếm hoặc Xem danh mục để chọn sản phẩm.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Bottom Note & Sale Mode Selection */}
            <div className="mt-3 shrink-0 bg-white border border-gray-150 p-2.5 rounded shadow-sm">
              <div className="flex gap-4 items-center">
                <textarea
                  placeholder="Ghi chú hóa đơn..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="flex-1 h-10 p-1.5 border border-gray-200 rounded text-tiny focus:outline-none focus:border-[#007edb] placeholder-gray-400 resize-none"
                />
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Chế độ bán</span>
                  <div className="flex gap-1 bg-gray-100 p-0.5 rounded border border-gray-200">
                    {['Bán nhanh', 'Bán giao hàng'].map(mode => (
                      <span key={mode} className={`px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer ${
                        mode === 'Bán nhanh' ? 'bg-[#007edb] text-white' : 'text-gray-500 hover:text-gray-800'
                      }`}>
                        {mode}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Product Catalog Grid Panel: w-[35%] (only shown when showGrid is true) */}
          {showGrid && (
            <div className="w-[35%] flex flex-col p-3 border-r border-gray-150 overflow-hidden bg-gray-50/50">
              
              {/* Category selector & Product images toggle */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 shrink-0">
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setSelectedCategoryId('')}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                      !selectedCategoryId ? 'bg-[#007edb] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Tất cả
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategoryId(cat.id)}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                        selectedCategoryId === cat.id ? 'bg-[#007edb] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-550 cursor-pointer select-none bg-white px-2 py-1 rounded border border-gray-200 shadow-sm active:scale-95 transition-all">
                  <input
                    type="checkbox"
                    checked={showProductImages}
                    onChange={e => setShowProductImages(e.target.checked)}
                    className="rounded border-gray-300 text-[#007edb] focus:ring-[#007edb] w-3 h-3"
                  />
                  <span>Hiện ảnh</span>
                </label>
              </div>

              {/* Grid Scroll Area */}
              <div className="flex-1 overflow-y-auto">
                {filteredProducts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-400 bg-white border border-gray-100 rounded-lg">
                    <Package size={24} className="mb-1 text-gray-300" />
                    <span className="text-[12px]">Không tìm thấy hàng</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                    {filteredProducts.map(prod => {
                      let price = 0
                      if (prod.price_list_items && prod.price_list_items.length > 0) {
                        const itemPrice = prod.price_list_items.find(
                          item => item.price_list_id === selectedPriceListId || item.price_list?.id === selectedPriceListId
                        )
                        if (itemPrice) {
                          price = itemPrice.selling_price
                        } else {
                          const retailPrice = prod.price_list_items.find(
                            item => item.price_list?.code === 'GIA-LE'
                          )
                          price = retailPrice ? retailPrice.selling_price : prod.price_list_items[0].selling_price
                        }
                      }
                      return (
                        <div
                          key={prod.id}
                          onClick={() => addToCart(prod)}
                          className="bg-white border border-gray-100 hover:border-[#007edb] hover:shadow-sm rounded p-2 flex flex-col justify-between cursor-pointer transition-all active:scale-[0.97]"
                        >
                          <div>
                            {/* Product Image Box - togglable and collapsible */}
                            {showProductImages && prod.image_urls && prod.image_urls.length > 0 ? (
                              <div className="w-full h-16 bg-gray-50 rounded overflow-hidden flex items-center justify-center border border-gray-100 mb-1.5 shrink-0">
                                <img src={prod.image_urls[0]} alt={prod.name} className="w-full h-full object-cover" />
                              </div>
                            ) : showProductImages ? (
                              <div className="w-full h-6 bg-gray-50 rounded overflow-hidden flex items-center justify-center border border-gray-100 mb-1.5 shrink-0 text-gray-300">
                                <Package size={12} />
                              </div>
                            ) : null}

                            {/* Product name - up to 2 lines */}
                            <h4 className="text-[12px] font-bold text-gray-800 line-clamp-2 leading-tight h-8 select-none">{prod.name}</h4>
                            
                            {/* Unit (ĐVT) - Prominent Under Name */}
                            <div className="my-1.5 flex items-center">
                              <span className="text-[10px] font-extrabold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 uppercase font-mono tracking-wider">
                                ĐVT: {prod.unit || 'N/A'}
                              </span>
                            </div>
                          </div>
                          
                          {/* Card Footer */}
                          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50 shrink-0">
                            <span className="text-[11px] font-bold text-blue-600">{formatCurrency(price)}</span>
                            <span className="text-[9px] text-gray-400 font-mono truncate max-w-[50px]" title={prod.sku}>SKU: {prod.sku || '-'}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Right Sidebar Checkout: w-[20%] - Sticky Bottom Layout */}
          <aside className="w-[20%] bg-white flex flex-col shadow-lg border-l border-gray-150 overflow-hidden h-full">
            
            {/* Scrollable Upper Area */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
              
              {/* Customer Selector */}
              <div className="relative">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Khách hàng</label>
                <div className="relative">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input
                    type="text"
                    placeholder="Tìm khách hàng..."
                    value={customerSearchQuery}
                    onChange={e => {
                      const val = e.target.value
                      setCustomerSearchQuery(val)
                      if (!val.trim()) {
                        setSelectedCustomerId('')
                      }
                      setShowCustomerDropdown(true)
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    className="w-full h-8 pl-8 pr-12 bg-white border border-gray-200 rounded text-[12px] font-semibold focus:outline-none focus:border-[#007edb]"
                  />
                  {selectedCustomerId && (
                    <button
                      onClick={() => {
                        setSelectedCustomerId('')
                        setCustomerSearchQuery('')
                      }}
                      className="absolute right-7 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer" size={14} />
                </div>

                {/* Dropdown Customer Options */}
                {showCustomerDropdown && (
                  <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-gray-200 rounded shadow-xl z-50 py-1 text-[12px]">
                    {filteredCustomers.map(cust => (
                      <button
                        key={cust.id}
                        onClick={() => {
                          setSelectedCustomerId(cust.id)
                          setCustomerSearchQuery(cust.farm_name)
                          setShowCustomerDropdown(false)
                        }}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-gray-50 flex items-center justify-between"
                      >
                        <span className="font-semibold text-gray-800 truncate pr-1">{cust.farm_name}</span>
                        <span className="text-[9px] bg-gray-100 text-gray-505 px-1 py-0.2 rounded font-mono uppercase font-bold shrink-0">{cust.code || 'N/A'}</span>
                      </button>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <div className="p-2 text-center text-gray-400 italic">Không tìm thấy</div>
                    )}
                  </div>
                )}
              </div>

              {selectedCustomer && (
                <div className="flex flex-col gap-1 text-[11px] bg-gray-50 p-2 rounded border border-gray-155">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Hạng:</span>
                    <span className={`px-1 py-0.2 text-[8px] font-bold rounded uppercase ${
                      selectedCustomer.value_tier === 'vip' ? 'bg-[#007edb] text-white' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {selectedCustomer.value_tier || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Nợ hiện tại:</span>
                    <span className="font-bold text-gray-700">{formatCurrency(customerDebt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Hạn mức nợ:</span>
                    <span className="font-bold text-gray-700">{formatCurrency(selectedCustomer.credit_limit)}</span>
                  </div>
                </div>
              )}

              {/* Price List Selector */}
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Bảng giá áp dụng</label>
                <select
                  value={selectedPriceListId}
                  onChange={e => setSelectedPriceListId(e.target.value)}
                  className="w-full h-8 px-1.5 bg-white border border-gray-200 rounded text-[12px] font-semibold focus:outline-none focus:border-[#007edb] cursor-pointer"
                >
                  {priceLists.map(pl => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                  {priceLists.length === 0 && <option value="">-</option>}
                </select>
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Hình thức thanh toán</span>
                <div className="flex flex-col gap-1 p-0.5 bg-gray-100 border border-gray-200 rounded">
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    className={`w-full py-1.5 rounded text-[11px] font-bold transition-all text-center ${
                      paymentMethod === 'cash' ? 'bg-[#007edb] text-white shadow-sm' : 'text-gray-505 hover:text-gray-800'
                    }`}
                    title="Phím tắt: F3"
                  >
                    Tiền mặt (F3)
                  </button>
                  <button
                    onClick={() => setPaymentMethod('bank_transfer')}
                    className={`w-full py-1.5 rounded text-[11px] font-bold transition-all text-center ${
                      paymentMethod === 'bank_transfer' ? 'bg-[#007edb] text-white shadow-sm' : 'text-gray-505 hover:text-gray-800'
                    }`}
                    title="Phím tắt: F4"
                  >
                    Chuyển khoản (F4)
                  </button>
                  <button
                    onClick={() => setPaymentMethod('credit')}
                    className={`w-full py-1.5 rounded text-[11px] font-bold transition-all text-center ${
                      paymentMethod === 'credit' ? 'bg-[#007edb] text-white shadow-sm' : 'text-gray-505 hover:text-gray-800'
                    }`}
                    title="Phím tắt: F8"
                  >
                    Ghi nợ (F8)
                  </button>
                </div>
              </div>

            </div>

            {/* Sticky Bottom Area - Always Anchored */}
            <div className="shrink-0 border-t border-gray-200 bg-gray-50 p-3.5 space-y-3 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
              
              {/* Parallel Row: Tổng tiền hàng & Giảm giá hóa đơn */}
              <div className="grid grid-cols-2 gap-2 text-tiny">
                <div>
                  <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider mb-0.5">Tổng tiền</span>
                  <div className="font-bold text-gray-700 text-[13px]">{subtotal.toLocaleString('vi-VN')} ₫</div>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider mb-0.5">Giảm giá HĐ</span>
                  <input
                    type="text"
                    value={formatNumberString(invoiceDiscount || '')}
                    placeholder="0"
                    onChange={e => setInvoiceDiscount(parseNumberString(e.target.value))}
                    className="w-full h-7 text-right px-1.5 border border-gray-200 rounded focus:outline-none focus:border-[#007edb] font-bold text-[12px]"
                  />
                </div>
              </div>

              {/* Grand Total */}
              <div className="flex justify-between items-end pt-1 border-t border-gray-200/60">
                <span className="text-[11px] font-bold text-gray-800 uppercase">Khách cần trả</span>
                <span className="text-[16px] font-extrabold text-blue-600">{grandTotal.toLocaleString('vi-VN')} ₫</span>
              </div>

              {/* Cash amount inputs and shortcuts (if not credit) */}
              {paymentMethod !== 'credit' && (
                <div className="space-y-2 pt-2 border-t border-gray-200/60">
                  <div className="flex justify-between items-center text-tiny text-gray-500 font-semibold">
                    <span>Khách trả</span>
                    <input
                      type="text"
                      value={formatNumberString(paymentAmount || '')}
                      placeholder={formatNumberString(grandTotal)}
                      onChange={e => setPaymentAmount(parseNumberString(e.target.value))}
                      className="w-24 h-7 text-right px-1.5 border border-gray-200 rounded focus:outline-none focus:border-[#007edb] font-bold text-blue-600 bg-blue-50/20 text-[12px]"
                    />
                  </div>

                  {/* Denominations suggestion shortcuts as small tag buttons */}
                  {paymentMethod === 'cash' && (
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Gợi ý tiền mặt</span>
                      <div className="flex flex-wrap gap-1">
                        {getCashSuggestions(grandTotal).map(amt => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => handleCashSuggestionClick(amt)}
                            className="py-0.5 px-2 text-[10px] font-bold bg-blue-50 text-[#007edb] border border-blue-100 rounded hover:bg-[#007edb] hover:text-white hover:border-[#007edb] transition-colors"
                          >
                            {amt.toLocaleString('vi-VN')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between items-center text-[12px] font-bold pt-1.5 border-t border-dashed border-gray-200">
                    <span>Tiền thừa</span>
                    <span className="text-emerald-600 text-[13px]">
                      {changeDue.toLocaleString('vi-VN')} ₫
                    </span>
                  </div>
                </div>
              )}

              {/* Credit Limit Warning Message */}
              {paymentMethod === 'credit' && isCreditLimitExceeded && (
                <div className="pt-1">
                  <div className="flex items-start gap-1.5 p-2 bg-red-50 text-red-800 rounded border border-red-100">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div className="text-[10px] leading-tight">
                      <span className="font-bold">Vượt hạn mức nợ!</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Pay and Print Receipt Button */}
              <div className="pt-2 border-t border-gray-200/60">
                <button
                  id="btn-pos-pay"
                  onClick={handlePayment}
                  disabled={submitting || cart.length === 0}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-[13px] flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all shadow disabled:opacity-50"
                >
                  <Printer size={14} />
                  Thanh toán &amp; In (F9)
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Invoice Receipt Modal */}
      {showReceiptModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200 text-[13px]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="font-bold text-gray-755 text-body-md">Hóa đơn bán lẻ</h3>
              <button
                onClick={() => setShowReceiptModal(false)}
                className="p-1 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <X size={20} />
              </button>
            </div>
            
            {/* Simulation receipt print format */}
            <div className="p-6 overflow-y-auto max-h-[50vh]">
              <div className="bg-white border border-gray-200 shadow-inner p-6 rounded-lg text-center font-mono text-tiny text-gray-700">
                <div className="mb-4">
                  <h4 className="text-body-md font-bold text-blue-600">SANH LONG VETCO</h4>
                  <p className="text-[10px] text-gray-400">789 Veterinary Blvd, TP. Hồ Chí Minh</p>
                  <p className="text-[10px] text-gray-400">Hotline: 1900 6789</p>
                </div>
                
                <div className="text-body-md font-bold border-y border-dashed border-gray-200 py-2 mb-4">
                  HÓA ĐƠN BÁN LẺ
                  <div className="text-[10px] font-normal mt-0.5">Mã đơn: #{createdOrderCode}</div>
                  <div className="text-[10px] font-normal">Ngày: {new Date().toLocaleDateString('vi-VN')}</div>
                </div>

                <div className="space-y-2 text-left mb-4">
                  {cart.map(item => (
                    <div key={item.id} className="flex justify-between text-[11px]">
                      <span>{item.product.name} (x{item.quantity})</span>
                      <span>{((item.unitPrice * (1 - item.discountPercent / 100)) * item.quantity).toLocaleString('vi-VN')}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-dashed border-gray-200 pt-2 space-y-1 mb-4 text-left">
                  <div className="flex justify-between text-[11px]">
                    <span>Tạm tính:</span>
                    <span>{subtotal.toLocaleString('vi-VN')}</span>
                  </div>
                  {invoiceDiscount > 0 && (
                    <div className="flex justify-between text-[11px] text-red-500">
                      <span>Giảm giá:</span>
                      <span>-{invoiceDiscount.toLocaleString('vi-VN')}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-body-sm font-bold pt-2 border-t border-dashed border-gray-200">
                    <span>TỔNG CỘNG:</span>
                    <span>{grandTotal.toLocaleString('vi-VN')}</span>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center space-y-2 mt-4 pt-4 border-t border-dashed border-gray-200">
                  <div className="w-24 h-24 bg-gray-50 border border-gray-105 p-2 rounded flex items-center justify-center relative">
                    <div className="w-full h-full opacity-10" style={{ backgroundImage: 'radial-gradient(#1e5a9c 1px, transparent 1px)', backgroundSize: '4px 4px' }}></div>
                    <ScanLine className="absolute text-blue-500" size={32} />
                  </div>
                  <p className="text-[9px] text-gray-400">Quét mã QR để xác nhận giao dịch</p>
                </div>

                <div className="mt-6 text-[10px] italic text-gray-400">
                  Cảm ơn quý khách đã tin dùng Sanh Long Vetco!
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-25 border-t border-gray-100 grid grid-cols-2 gap-4">
              <button
                onClick={() => {
                  window.print()
                }}
                className="h-10 border border-gray-200 text-gray-700 rounded-lg text-body-md font-semibold hover:bg-gray-50 flex items-center justify-center gap-2"
              >
                <Printer size={16} />
                In hóa đơn
              </button>
              <button
                onClick={() => {
                  setAlertMsg({ type: 'success', text: 'Đã gửi liên kết hóa đơn đến Zalo/SMS.' })
                  setShowReceiptModal(false)
                }}
                className="h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold flex items-center justify-center gap-2"
              >
                <Smartphone size={16} />
                Gửi Zalo/SMS
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
