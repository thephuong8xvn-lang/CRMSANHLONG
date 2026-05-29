import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
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
  Receipt,
  HeartPulse,
  Activity,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Check,
  Layers,
  RefreshCw
} from 'lucide-react'
import Layout from '../../components/Layout'
import { ProductImage } from '../../components/ProductImage'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { usePromotionEngine, type AppliedDiscount } from '../../hooks/usePromotionEngine'

interface Customer {
  id: string
  code: string
  farm_name: string
  credit_limit: number
  price_list_id: string | null
  value_tier: string
}

interface ProductActiveIngredient {
  active_ingredient_id: string
  percentage_or_dosage: string
  active_ingredient: {
    id: string
    name: string
    code: string | null
  } | null
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
  product_active_ingredients?: ProductActiveIngredient[]
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

interface Compatibility {
  id: string
  ingredient_a_id: string
  ingredient_b_id: string
  interaction_type: 'synergy' | 'antagonism'
  description: string | null
}

interface Species {
  id: string
  name: string
  category: string | null
}

interface Disease {
  id: string
  code: string
  name: string
  category: string | null
  description: string | null
  etiology: string | null
  symptoms: string[]
  disease_species?: { species_id: string }[]
}

interface Protocol {
  id: string
  active_ingredient_id: string
  treatment_role: 'treatment' | 'support' | 'resistance'
  treatment_line: number
  notes: string | null
  active_ingredient: {
    id: string
    name: string
    code: string | null
  }
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
  selectedDiseaseId: string
  treatmentPurpose: string
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
  const [productStock, setProductStock] = useState<Record<string, number>>({})
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('')
  const [categories, setCategories] = useState<{ id: string; code: string; name: string }[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [compatibilities, setCompatibilities] = useState<Compatibility[]>([])
  const [species, setSpecies] = useState<Species[]>([])
  const [diseases, setDiseases] = useState<Disease[]>([])

  // Antagonism Warnings State
  const [antagonismWarnings, setAntagonismWarnings] = useState<string[]>([])

  // Diagnosis Modal State
  const [showDiagModal, setShowDiagModal] = useState(false)
  const [diagSpeciesId, setDiagSpeciesId] = useState('')
  const [diagSelectedSymptoms, setDiagSelectedSymptoms] = useState<string[]>([])
  const [diagDiseaseSearch, setDiagDiseaseSearch] = useState('')
  const [diagSelectedDiseaseId, setDiagSelectedDiseaseId] = useState('')
  const [diagProtocols, setDiagProtocols] = useState<Protocol[]>([])
  const [diagLoadingProtocols, setDiagLoadingProtocols] = useState(false)

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
      selectedPriceListId: '',
      selectedDiseaseId: '',
      treatmentPurpose: ''
    }
  ])
  const [activeTabId, setActiveTabId] = useState<string>('1')

  // Search / Dropdown UI States
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebouncedValue(searchTerm, 300)
  const [focusedSearchIndex, setFocusedSearchIndex] = useState(-1)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showProductImages, setShowProductImages] = useState(true)

  // Promotion / voucher
  const { applyBestPromotion, applyVoucher } = usePromotionEngine()
  const [voucherCode, setVoucherCode] = useState('')
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null)
  const [voucherError, setVoucherError] = useState('')

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
  const selectedDiseaseId = activeTab.selectedDiseaseId || ''
  const treatmentPurpose = activeTab.treatmentPurpose || ''

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

  const setSelectedDiseaseId = (diseaseId: string) => {
    updateActiveTab({ selectedDiseaseId: diseaseId })
  }

  const setTreatmentPurpose = (purpose: string) => {
    updateActiveTab({ treatmentPurpose: purpose })
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
      if (e.key === 'F7') {
        e.preventDefault()
        setShowDiagModal(true)
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
          const def = plData.find((pl: any) => pl.is_default) || plData.find((pl: any) => pl.code === 'GIA-LE') || plData[0]
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
            price_list_items(price_list_id, cost_price, selling_price, price_list:price_lists(id, code, name)),
            product_active_ingredients(active_ingredient_id, percentage_or_dosage, active_ingredient:active_ingredients(id, name, code))
          `)
          .eq('is_active', true)
        if (prodData) setProducts(prodData as unknown as Product[])

        const { data: compatData } = await supabase
          .from('active_ingredient_compatibility')
          .select('*')
        if (compatData) setCompatibilities(compatData as unknown as Compatibility[])

        const { data: specData } = await supabase
          .from('species')
          .select('*')
        if (specData) setSpecies(specData as unknown as Species[])

        const { data: disData } = await supabase
          .from('disease_dictionary')
          .select(`
            *,
            disease_species(species_id)
          `)
        if (disData) setDiseases(disData as unknown as Disease[])

      } catch (err) {
        console.error('Error fetching data:', err)
      }
    }
    loadData()
  }, [])

  // Fetch stock levels and warehouses of cashier's branch
  const fetchStockData = useCallback(async () => {
    try {
      let currentBranchId = profile?.branch_id

      if (!currentBranchId && profile?.id) {
        const { data: profData } = await supabase
          .from('profiles')
          .select('branch_id')
          .eq('id', profile.id)
          .single()
        if (profData?.branch_id) {
          currentBranchId = profData.branch_id
        }
      }

      let whIds: string[] = []
      if (currentBranchId) {
        const { data: whData } = await supabase
          .from('warehouses')
          .select('id, type')
          .eq('branch_id', currentBranchId)
          .eq('is_active', true)
        
        if (whData && whData.length > 0) {
          const mainWh = whData.find((w: any) => w.type === 'main') || whData[0]
          if (mainWh) {
            setSelectedWarehouseId((mainWh as any).id)
          }
          whIds = whData.map((w: any) => w.id)
        }
      }

      let stockQuery = supabase
        .from('stock_lots')
        .select('product_id, quantity_on_hand, quantity_reserved')
        .eq('status', 'active')

      if (whIds.length > 0) {
        stockQuery = stockQuery.in('warehouse_id', whIds)
      }

      const { data: stockData, error } = await stockQuery
      if (!error && stockData) {
        const stockMap: Record<string, number> = {}
        stockData.forEach((item: any) => {
          const avail = item.quantity_on_hand - item.quantity_reserved
          stockMap[item.product_id] = (stockMap[item.product_id] || 0) + avail
        })
        setProductStock(stockMap)
      }
    } catch (err) {
      console.error('Error fetching stock data:', err)
    }
  }, [profile])

  useEffect(() => {
    if (products.length > 0) {
      fetchStockData()
    }
  }, [products, fetchStockData])

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
          const totalDebt = data.reduce((sum: number, item: any) => sum + Number(item.amount), 0)
          setCustomerDebt(totalDebt)
        }
      } catch (err) {
        console.error('Error fetching customer debt:', err)
      }
    }
    fetchDebt()
  }, [selectedCustomerId])

  // Check for Antagonism in the cart
  useEffect(() => {
    if (cart.length < 2 || compatibilities.length === 0) {
      setAntagonismWarnings([])
      return
    }

    const activeIngMap: { [ingId: string]: string[] } = {}
    cart.forEach(item => {
      if (item.product.product_active_ingredients) {
        item.product.product_active_ingredients.forEach(link => {
          if (link.active_ingredient_id) {
            const ingId = link.active_ingredient_id
            if (!activeIngMap[ingId]) {
              activeIngMap[ingId] = []
            }
            if (!activeIngMap[ingId].includes(item.product.name)) {
              activeIngMap[ingId].push(item.product.name)
            }
          }
        })
      }
    })

    const warnings: string[] = []
    const checkedPairs = new Set<string>()

    compatibilities.forEach(rule => {
      if (rule.interaction_type === 'antagonism') {
        const hasA = activeIngMap[rule.ingredient_a_id]
        const hasB = activeIngMap[rule.ingredient_b_id]

        if (hasA && hasB) {
          const pairKey1 = `${rule.ingredient_a_id}-${rule.ingredient_b_id}`
          const pairKey2 = `${rule.ingredient_b_id}-${rule.ingredient_a_id}`

          if (!checkedPairs.has(pairKey1) && !checkedPairs.has(pairKey2)) {
            checkedPairs.add(pairKey1)
            
            const ingAName = cart
              .flatMap(item => item.product.product_active_ingredients || [])
              .find(link => link.active_ingredient_id === rule.ingredient_a_id)
              ?.active_ingredient?.name || 'Hoạt chất A'

            const ingBName = cart
              .flatMap(item => item.product.product_active_ingredients || [])
              .find(link => link.active_ingredient_id === rule.ingredient_b_id)
              ?.active_ingredient?.name || 'Hoạt chất B'

            const productsA = hasA.join(', ')
            const productsB = hasB.join(', ')

            warnings.push(
              `Cảnh báo đối kháng thuốc: Hoạt chất "${ingAName}" (trong: ${productsA}) đối kháng với hoạt chất "${ingBName}" (trong: ${productsB}). ${rule.description || ''}`
            )
          }
        }
      }
    })

    setAntagonismWarnings(warnings)
  }, [cart, compatibilities])

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
  const filteredProducts = useMemo(() => products.filter(p => {
    const matchesCategory = !selectedCategoryId || p.category_id === selectedCategoryId
    const matchesSearch = !debouncedSearch.trim() ||
      p.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(debouncedSearch.toLowerCase())
    return matchesCategory && matchesSearch
  }), [products, selectedCategoryId, debouncedSearch])

  const PRODUCT_COLS = 3
  const productRows = useMemo(() => {
    const rows: Product[][] = []
    for (let i = 0; i < filteredProducts.length; i += PRODUCT_COLS) {
      rows.push(filteredProducts.slice(i, i + PRODUCT_COLS))
    }
    return rows
  }, [filteredProducts])

  const productListRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: productRows.length,
    getScrollElement: () => productListRef.current,
    estimateSize: () => showProductImages ? 146 : 96,
    overscan: 3,
    measureElement: typeof window !== 'undefined' ? el => el.getBoundingClientRect().height : undefined,
  })

  // Filter customers
  const filteredCustomers = useMemo(() => customers.filter(c => {
    if (!customerSearchQuery.trim()) return true
    return c.farm_name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(customerSearchQuery.toLowerCase())
  }), [customers, customerSearchQuery])

  // Add to cart helper
  const addToCart = useCallback((product: Product) => {
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

    setCart(prev => {
      const existingIndex = prev.findIndex(
        item => item.product.id === product.id &&
                item.unitPrice === price &&
                item.discountPercent === 0 &&
                !item.isPriceOverridden
      )
      if (existingIndex > -1) {
        const updated = [...prev]
        updated[existingIndex] = { ...updated[existingIndex], quantity: updated[existingIndex].quantity + 1 }
        return updated
      }
      return [
        ...prev,
        { id: crypto.randomUUID(), product, quantity: 1, unitPrice: price, discountPercent: 0, isPriceOverridden: false }
      ]
    })
  }, [selectedPriceListId])

  // Adjust cart quantity
  const adjustQuantity = useCallback((rowId: string, amount: number) => {
    setCart(prev => {
      const index = prev.findIndex(item => item.id === rowId)
      if (index === -1) return prev
      const updated = [...prev]
      const nextQty = updated[index].quantity + amount
      if (nextQty <= 0) { updated.splice(index, 1) }
      else { updated[index] = { ...updated[index], quantity: nextQty } }
      return updated
    })
  }, [])

  // Update quantity directly
  const updateQuantity = useCallback((rowId: string, qty: number) => {
    setCart(prev => {
      const index = prev.findIndex(item => item.id === rowId)
      if (index === -1) return prev
      const updated = [...prev]
      updated[index] = { ...updated[index], quantity: Math.max(0, qty) }
      return updated
    })
  }, [])

  // Update unit price directly (manual override)
  const updateUnitPrice = useCallback((rowId: string, price: number) => {
    setCart(prev => {
      const index = prev.findIndex(item => item.id === rowId)
      if (index === -1) return prev
      const updated = [...prev]
      updated[index] = { ...updated[index], unitPrice: Math.max(0, price), isPriceOverridden: true }
      return updated
    })
  }, [])

  // Add promo line for a product (10+2 scenario)
  const addPromoLine = useCallback((product: Product) => {
    setCart(prev => [
      ...prev,
      { id: crypto.randomUUID(), product, quantity: 1, unitPrice: 0, discountPercent: 0, isPriceOverridden: true }
    ])
  }, [])

  // Set manual discount for row
  const setRowDiscount = useCallback((rowId: string, discount: number) => {
    setCart(prev => {
      const index = prev.findIndex(item => item.id === rowId)
      if (index === -1) return prev
      const updated = [...prev]
      updated[index] = { ...updated[index], discountPercent: Math.max(0, Math.min(100, discount)) }
      return updated
    })
  }, [])

  // Calculate totals
  const subtotal = useMemo(() => cart.reduce((sum, item) => {
    const lineTotal = item.quantity * item.unitPrice
    const discount = lineTotal * (item.discountPercent / 100)
    return sum + (lineTotal - discount)
  }, 0), [cart])

  // Auto-apply best promotion when cart / subtotal changes (only if no voucher applied)
  useEffect(() => {
    if (appliedDiscount?.type === 'voucher') return
    if (!cart.length) { setAppliedDiscount(null); return }
    const promoRows = cart.map(item => ({
      id: item.id,
      product: item.product,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent,
      isPriceOverridden: item.isPriceOverridden ?? false,
    }))
    const best = applyBestPromotion(promoRows, subtotal, selectedCustomer?.value_tier)
    if (best) {
      setAppliedDiscount(best)
      setInvoiceDiscount(best.discountAmount)
    } else if (appliedDiscount?.type === 'promotion') {
      setAppliedDiscount(null)
    }
  }, [cart, subtotal, applyBestPromotion, selectedCustomer?.value_tier])

  const handleApplyVoucher = useCallback(async () => {
    setVoucherError('')
    if (!voucherCode.trim()) return
    const result = await applyVoucher(voucherCode.trim(), subtotal)
    if (!result) { setVoucherError('Voucher không hợp lệ hoặc hết hạn'); return }
    setAppliedDiscount(result)
    setInvoiceDiscount(result.discountAmount)
    setVoucherCode('')
  }, [voucherCode, applyVoucher, subtotal])

  const clearDiscount = useCallback(() => {
    setAppliedDiscount(null)
    setInvoiceDiscount(0)
    setVoucherCode('')
    setVoucherError('')
  }, [])

  const grandTotal = useMemo(() => Math.max(0, subtotal - invoiceDiscount), [subtotal, invoiceDiscount])

  // Credit limit validation
  const isCreditLimitExceeded = selectedCustomer &&
    (customerDebt + grandTotal > selectedCustomer.credit_limit)

  // Autocomplete products
  const searchResults = useMemo(() => products.filter(p => {
    if (!debouncedSearch.trim()) return false
    return p.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
           p.sku.toLowerCase().includes(debouncedSearch.toLowerCase())
  }), [products, debouncedSearch])

  // Keyboard navigation for Autocomplete
  useEffect(() => {
    if (searchResults.length > 0) {
      setFocusedSearchIndex(0)
    } else {
      setFocusedSearchIndex(-1)
    }
  }, [debouncedSearch])

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
      selectedPriceListId: defPlId,
      selectedDiseaseId: '',
      treatmentPurpose: ''
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
          selectedPriceListId: defPlId,
          selectedDiseaseId: '',
          treatmentPurpose: ''
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

      const orderInsertDraft = {
        order_code: orderCode,
        customer_id: selectedCustomerId,
        status: 'draft',
        payment_status: paymentMethod === 'credit' ? 'unpaid' : 'paid',
        payment_method: paymentMethod,
        owner_user_id: profile.id,
        branch_id: profile?.branch_id || null,
        warehouse_id: selectedWarehouseId || null,
        price_list_id: selectedPriceListId || null,
        subtotal: subtotal,
        discount_total: invoiceDiscount,
        grand_total: grandTotal,
        paid_amount: paymentMethod === 'credit' ? 0 : grandTotal,
        delivery_address: 'Giao trực tiếp tại quầy POS',
        notes: notes || 'Đơn hàng bán lẻ từ hệ thống POS desktop.',
        disease_id: selectedDiseaseId || null,
        treatment_purpose: treatmentPurpose || null
      }

      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .insert([orderInsertDraft])
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

      if (linesErr) {
        await supabase.from('orders').delete().eq('id', orderData.id)
        throw linesErr
      }

      // Update order status to 'confirmed' to trigger stock deduction trigger
      const { error: confirmErr } = await supabase
        .from('orders')
        .update({
          status: 'confirmed',
          confirmed_by: profile.id
        })
        .eq('id', orderData.id)

      if (confirmErr) {
        await supabase.from('order_lines').delete().eq('order_id', orderData.id)
        await supabase.from('orders').delete().eq('id', orderData.id)
        throw confirmErr
      }

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
        selectedPriceListId: defPlId,
        selectedDiseaseId: '',
        treatmentPurpose: ''
      })
      
      // Refresh stock levels on UI
      fetchStockData()

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
    <div className="relative flex items-center bg-gray-25 rounded-lg px-3 h-10 w-full max-w-[200px] sm:max-w-[280px] md:max-w-[360px] lg:max-w-[400px] border border-gray-105 focus-within:border-blue-500 focus-within:ring-[4px] focus-within:ring-blue-100 transition-all text-gray-800">
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
                  <span className="text-[10px] text-gray-400 font-mono">
                    SKU: {prod.sku || '-'} | ĐVT: {prod.unit || '-'} | Tồn: <span className={(productStock[prod.id] || 0) > 0 ? "text-emerald-600 font-bold" : "text-red-500 font-bold"}>{(productStock[prod.id] || 0).toLocaleString('vi-VN')}</span>
                  </span>
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
              onClick={() => setShowDiagModal(true)}
              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-tiny font-bold flex items-center gap-1.5 transition-colors border border-emerald-700 shadow-sm"
              title="Chẩn đoán nhanh và tự động gợi ý sản phẩm theo phác đồ [F7]"
            >
              <Stethoscope size={13} />
              <span>Chẩn đoán &amp; Gợi ý (F7)</span>
            </button>
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

            {/* Antagonism Warnings Alert Bar */}
            {antagonismWarnings.length > 0 && (
              <div className="mb-3 space-y-1.5 shrink-0 animate-in fade-in slide-in-from-top duration-300">
                {antagonismWarnings.map((warn, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 bg-red-50 text-red-900 border border-red-200 rounded-lg text-body-sm font-semibold leading-relaxed shadow-sm">
                    <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{warn}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Disease Diagnosed Badge (if any) */}
            {selectedDiseaseId && (
              <div className="mb-3 shrink-0 flex items-center justify-between bg-blue-50/50 border border-blue-100 p-2.5 rounded-lg">
                <div className="flex items-center gap-2">
                  <Stethoscope size={16} className="text-blue-600 font-bold" />
                  <span className="text-body-sm text-gray-700 font-medium">
                    Chẩn đoán: <strong className="text-blue-800 font-bold">{diseases.find(d => d.id === selectedDiseaseId)?.name}</strong>
                  </span>
                  {treatmentPurpose && (
                    <span className="text-tiny bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-semibold font-mono">
                      Mục đích: {treatmentPurpose}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDiseaseId('')
                    setTreatmentPurpose('')
                  }}
                  className="text-gray-400 hover:text-gray-650"
                  title="Xóa liên kết bệnh lý"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            
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
                            min="0"
                            step="any"
                            value={item.quantity}
                            onChange={e => updateQuantity(item.id, parseFloat(e.target.value) || 0)}
                            className="w-14 h-7 text-center text-[12px] font-bold focus:outline-none bg-white text-gray-900"
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

              {/* Grid Scroll Area – virtualized rows of 3 */}
              <div ref={productListRef} className="flex-1 overflow-y-auto">
                {filteredProducts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-400 bg-white border border-gray-100 rounded-lg">
                    <Package size={24} className="mb-1 text-gray-300" />
                    <span className="text-[12px]">Không tìm thấy hàng</span>
                  </div>
                ) : (
                  <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                    {rowVirtualizer.getVirtualItems().map(virtualRow => (
                      <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        style={{ position: 'absolute', top: virtualRow.start, left: 0, right: 0 }}
                        className="grid grid-cols-3 gap-2 pb-2"
                      >
                        {productRows[virtualRow.index].map(prod => {
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
                                {showProductImages && (
                                  <div className="w-full h-16 bg-gray-50 rounded overflow-hidden flex items-center justify-center border border-gray-100 mb-1.5 shrink-0">
                                    <ProductImage src={prod.image_urls?.[0]} alt={prod.name} />
                                  </div>
                                )}
                                <h4 className="text-[12px] font-bold text-gray-800 line-clamp-2 leading-tight h-8 select-none">{prod.name}</h4>
                                <div className="my-1.5 flex items-center justify-between">
                                  <span className="text-[10px] font-extrabold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 uppercase font-mono tracking-wider animate-none">
                                    ĐVT: {prod.unit || 'N/A'}
                                  </span>
                                  <span className="text-[10px] text-gray-500 font-bold select-none">
                                    Tồn: <span className={(productStock[prod.id] || 0) > 0 ? "text-emerald-650 font-extrabold" : "text-red-500 font-extrabold"}>{(productStock[prod.id] || 0).toLocaleString('vi-VN')}</span>
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50 shrink-0">
                                <span className="text-[11px] font-bold text-blue-600">{formatCurrency(price)}</span>
                                <span className="text-[9px] text-gray-400 font-mono truncate max-w-[85px]" title={prod.sku}>SKU: {prod.sku || '-'}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
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

              {/* Applied promotion/voucher badge */}
              {appliedDiscount && (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2 py-1.5">
                  <span className="text-[10px] font-medium text-green-700 truncate">{appliedDiscount.label}</span>
                  <button onClick={clearDiscount} className="ml-1 text-green-600 hover:text-green-800 shrink-0"><X size={12} /></button>
                </div>
              )}

              {/* Voucher code input */}
              {!appliedDiscount && (
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={voucherCode}
                    onChange={e => { setVoucherCode(e.target.value.toUpperCase()); setVoucherError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleApplyVoucher()}
                    placeholder="Mã voucher"
                    className="flex-1 h-7 px-2 border border-gray-200 rounded text-[11px] focus:outline-none focus:border-[#007edb] uppercase"
                  />
                  <button
                    onClick={handleApplyVoucher}
                    className="px-2 h-7 bg-orange-500 text-white text-[10px] font-bold rounded hover:bg-orange-600 transition-colors"
                  >
                    Áp
                  </button>
                </div>
              )}
              {voucherError && <p className="text-[10px] text-red-500">{voucherError}</p>}

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
                      <span>{item.product.name} (x{item.quantity.toLocaleString('vi-VN')})</span>
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

      {/* Diagnosis & Smart Cart Suggestion Modal */}
      {showDiagModal && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl overflow-hidden border border-gray-100 flex flex-col h-[85vh]">
            <div className="p-5 border-b border-gray-150 flex justify-between items-center bg-[#007edb] text-white shrink-0">
              <h3 className="font-bold text-body-lg flex items-center gap-2">
                <Stethoscope size={20} />
                Chẩn đoán nhanh &amp; Gợi ý phác đồ giỏ hàng
              </h3>
              <button 
                onClick={() => {
                  setShowDiagModal(false)
                  setDiagSpeciesId('')
                  setDiagSelectedSymptoms([])
                  setDiagSelectedDiseaseId('')
                  setDiagProtocols([])
                }} 
                className="text-white hover:text-blue-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row text-[13px]">
              
              {/* Left Column: Species & Symptom Selection */}
              <div className="w-full md:w-[45%] border-r border-gray-200 p-4 overflow-y-auto flex flex-col gap-4">
                {/* Species Selector */}
                <div className="space-y-1.5 shrink-0">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">1. Đối tượng vật nuôi</span>
                  <div className="flex flex-wrap gap-1.5">
                    {species.map(sp => {
                      const isSelected = diagSpeciesId === sp.id
                      return (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => {
                            setDiagSpeciesId(sp.id)
                            setDiagSelectedSymptoms([])
                            setDiagSelectedDiseaseId('')
                            setDiagProtocols([])
                          }}
                          className={`px-3 py-1 rounded text-tiny font-bold border transition-all ${
                            isSelected 
                              ? 'bg-blue-600 border-blue-600 text-white shadow'
                              : 'bg-white border-gray-250 text-gray-650 hover:bg-gray-50'
                          }`}
                        >
                          {sp.name}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Symptom Checklist */}
                {diagSpeciesId && (
                  <div className="space-y-2 flex-1 flex flex-col min-h-0">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">2. Tích chọn triệu chứng lâm sàng</span>
                    
                    <div className="flex-1 overflow-y-auto border border-gray-200 rounded p-2.5 bg-gray-50/50 space-y-1.5 max-h-[30vh] md:max-h-none">
                      {Array.from(new Set(
                        diseases
                          .filter(d => d.disease_species?.some(ds => ds.species_id === diagSpeciesId))
                          .flatMap(d => d.symptoms || [])
                      )).map((sym, idx) => {
                        const isChecked = diagSelectedSymptoms.includes(sym)
                        return (
                          <label key={idx} className="flex items-start gap-2 p-1.5 hover:bg-white rounded cursor-pointer select-none transition-colors border border-transparent hover:border-gray-100 text-gray-700">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setDiagSelectedSymptoms(prev =>
                                  isChecked ? prev.filter(s => s !== sym) : [...prev, sym]
                                )
                              }}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 mt-0.5 shrink-0"
                            />
                            <span className="font-medium text-body-sm leading-normal">{sym}</span>
                          </label>
                        )
                      })}
                      {Array.from(new Set(
                        diseases
                          .filter(d => d.disease_species?.some(ds => ds.species_id === diagSpeciesId))
                          .flatMap(d => d.symptoms || [])
                      )).length === 0 && (
                        <p className="text-gray-400 italic text-center py-6">Không có dữ liệu triệu chứng cho đối tượng này.</p>
                      )}
                    </div>
                  </div>
                )}
                
                {!diagSpeciesId && (
                  <div className="flex-1 flex items-center justify-center text-center text-gray-400 italic">
                    Vui lòng chọn loài vật nuôi để hiển thị triệu chứng.
                  </div>
                )}
              </div>

              {/* Right Column: Diseases Matches & Protocols */}
              <div className="w-full md:w-[55%] p-4 overflow-y-auto flex flex-col gap-4 bg-gray-50/20">
                {diagSpeciesId ? (
                  <>
                    {/* Matching Diseases List */}
                    <div className="space-y-1.5 shrink-0">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">3. Kết quả chẩn đoán nghi ngờ</span>
                      
                      <div className="max-h-[150px] overflow-y-auto border border-gray-200 rounded bg-white divide-y divide-gray-100">
                        {diseases
                          .filter(d => d.disease_species?.some(ds => ds.species_id === diagSpeciesId))
                          .map(d => {
                            const totalSyms = d.symptoms?.length || 0
                            const matches = d.symptoms.filter(s => diagSelectedSymptoms.includes(s)).length
                            const score = totalSyms === 0 ? 0 : Math.round((matches / totalSyms) * 100)
                            return { ...d, score }
                          })
                          .filter(d => diagSelectedSymptoms.length === 0 ? true : d.score > 0)
                          .sort((a, b) => b.score - a.score)
                          .map(d => {
                            const isSelected = diagSelectedDiseaseId === d.id
                            return (
                              <div
                                key={d.id}
                                onClick={async () => {
                                  setDiagSelectedDiseaseId(d.id)
                                  setDiagLoadingProtocols(true)
                                  try {
                                    const { data, error } = await supabase
                                      .from('disease_treatment_protocols')
                                      .select(`
                                        *,
                                        active_ingredient:active_ingredients(id, name, code)
                                      `)
                                      .eq('disease_id', d.id)
                                    if (error) throw error
                                    if (data) setDiagProtocols(data as unknown as Protocol[])
                                  } catch (err) {
                                    console.error('Error fetching protocols:', err)
                                  } finally {
                                    setDiagLoadingProtocols(false)
                                  }
                                }}
                                className={`p-2.5 cursor-pointer flex justify-between items-center transition-colors ${
                                  isSelected 
                                    ? 'bg-blue-50 text-blue-900 font-bold border-l-4 border-blue-500' 
                                    : 'hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-semibold text-body-md">{d.name}</span>
                                  <span className="text-[10px] text-gray-400 font-mono">Tác nhân: {d.category}</span>
                                </div>
                                {diagSelectedSymptoms.length > 0 && (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                    d.score > 70 ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                                  }`}>
                                    Trùng khớp {d.score}%
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        {diseases.filter(d => d.disease_species?.some(ds => ds.species_id === diagSpeciesId)).length === 0 && (
                          <p className="p-3 text-center text-gray-400 italic">Không tìm thấy bệnh lý liên kết với đối tượng.</p>
                        )}
                      </div>
                    </div>

                    {/* Protocol Detail display */}
                    <div className="flex-1 flex flex-col min-h-0 bg-white border border-gray-200 rounded p-4 space-y-4">
                      <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                        <h4 className="font-bold text-gray-800 text-body-md flex items-center gap-1.5">
                          <Layers className="text-emerald-500" size={16} />
                          Phác đồ đề xuất tương ứng
                        </h4>
                      </div>

                      {diagLoadingProtocols ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-450 gap-2">
                          <RefreshCw className="animate-spin text-blue-500 w-6 h-6" />
                          <span>Đang tải phác đồ...</span>
                        </div>
                      ) : diagSelectedDiseaseId && diagProtocols.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-center text-gray-400 italic">
                          Bệnh này chưa cấu hình phác đồ hoạt chất điều trị.
                        </div>
                      ) : diagSelectedDiseaseId ? (
                        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                          
                          {/* Render Line 1 Protocols */}
                          {diagProtocols.some(p => p.treatment_line === 1) && (
                            <div className="bg-emerald-50/15 border border-emerald-100 rounded-lg p-3 space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">Phác đồ Line 1 (Ưu tiên)</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Apply Line 1 ingredients to cart
                                    const line1 = diagProtocols.filter(p => p.treatment_line === 1)
                                    let addedCount = 0
                                    line1.forEach(protoItem => {
                                      const bestProduct = products.find(p => 
                                        p.product_active_ingredients?.some(link => link.active_ingredient_id === protoItem.active_ingredient_id)
                                      )
                                      if (bestProduct) {
                                        addToCart(bestProduct)
                                        addedCount++
                                      }
                                    })
                                    if (addedCount > 0) {
                                      setSelectedDiseaseId(diagSelectedDiseaseId)
                                      const disObj = diseases.find(d => d.id === diagSelectedDiseaseId)
                                      setTreatmentPurpose(`Điều trị ${disObj?.name || ''} (Line 1)`)
                                      setAlertMsg({ type: 'success', text: `Đã tự động thêm ${addedCount} sản phẩm phác đồ Line 1 vào giỏ hàng!` })
                                      setShowDiagModal(false)
                                    } else {
                                      setAlertMsg({ type: 'error', text: 'Không tìm thấy sản phẩm thương mại nào chứa các hoạt chất phác đồ này trong kho.' })
                                    }
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-tiny font-bold flex items-center gap-1 active:scale-95 transition-all shadow-sm"
                                >
                                  <Plus size={12} />
                                  Áp dụng Line 1
                                </button>
                              </div>

                              <div className="space-y-1.5 divide-y divide-emerald-50">
                                {diagProtocols.filter(p => p.treatment_line === 1).map((p, idx) => (
                                  <div key={p.id} className="pt-1.5 first:pt-0 flex justify-between items-start text-body-sm">
                                    <div className="space-y-0.5">
                                      <span className="font-bold text-emerald-950">{p.active_ingredient.name}</span>
                                      <p className="text-[10px] text-gray-500">{p.notes}</p>
                                    </div>
                                    <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border shrink-0 ${
                                      p.treatment_role === 'treatment' ? 'bg-rose-50 border-rose-100 text-rose-700' :
                                      p.treatment_role === 'support' ? 'bg-amber-50 border-amber-100 text-amber-700' :
                                      'bg-emerald-50 border-emerald-100 text-emerald-700'
                                    }`}>
                                      {p.treatment_role === 'treatment' ? 'Đặc trị' : p.treatment_role === 'support' ? 'Bổ trợ' : 'Đề kháng'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Render Line 2 Protocols */}
                          {diagProtocols.some(p => p.treatment_line === 2) && (
                            <div className="bg-blue-50/15 border border-blue-100 rounded-lg p-3 space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="text-[11px] font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded">Phác đồ Line 2 (Thay thế)</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const line2 = diagProtocols.filter(p => p.treatment_line === 2)
                                    let addedCount = 0
                                    line2.forEach(protoItem => {
                                      const bestProduct = products.find(p => 
                                        p.product_active_ingredients?.some(link => link.active_ingredient_id === protoItem.active_ingredient_id)
                                      )
                                      if (bestProduct) {
                                        addToCart(bestProduct)
                                        addedCount++
                                      }
                                    })
                                    if (addedCount > 0) {
                                      setSelectedDiseaseId(diagSelectedDiseaseId)
                                      const disObj = diseases.find(d => d.id === diagSelectedDiseaseId)
                                      setTreatmentPurpose(`Điều trị ${disObj?.name || ''} (Line 2)`)
                                      setAlertMsg({ type: 'success', text: `Đã tự động thêm ${addedCount} sản phẩm phác đồ Line 2 vào giỏ hàng!` })
                                      setShowDiagModal(false)
                                    } else {
                                      setAlertMsg({ type: 'error', text: 'Không tìm thấy sản phẩm thương mại nào chứa các hoạt chất phác đồ này trong kho.' })
                                    }
                                  }}
                                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-tiny font-bold flex items-center gap-1 active:scale-95 transition-all shadow-sm"
                                >
                                  <Plus size={12} />
                                  Áp dụng Line 2
                                </button>
                              </div>

                              <div className="space-y-1.5 divide-y divide-blue-50">
                                {diagProtocols.filter(p => p.treatment_line === 2).map((p, idx) => (
                                  <div key={p.id} className="pt-1.5 first:pt-0 flex justify-between items-start text-body-sm">
                                    <div className="space-y-0.5">
                                      <span className="font-bold text-blue-950">{p.active_ingredient.name}</span>
                                      <p className="text-[10px] text-gray-500">{p.notes}</p>
                                    </div>
                                    <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border shrink-0 ${
                                      p.treatment_role === 'treatment' ? 'bg-rose-50 border-rose-100 text-rose-700' :
                                      p.treatment_role === 'support' ? 'bg-amber-50 border-amber-100 text-amber-700' :
                                      'bg-blue-50 border-blue-100 text-blue-700'
                                    }`}>
                                      {p.treatment_role === 'treatment' ? 'Đặc trị' : p.treatment_role === 'support' ? 'Bổ trợ' : 'Đề kháng'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-center text-gray-400 italic">
                          Chọn một bệnh nghi ngờ ở danh sách trên để xem chi tiết phác đồ đề xuất.
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center text-gray-450 italic">
                    Chưa chọn loài vật nuôi.
                  </div>
                )}
              </div>

            </div>

            <div className="p-4 bg-gray-25 border-t border-gray-100 flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowDiagModal(false)
                  setDiagSpeciesId('')
                  setDiagSelectedSymptoms([])
                  setDiagSelectedDiseaseId('')
                  setDiagProtocols([])
                }}
                className="px-5 h-9 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
              >
                Đóng lại
              </button>
            </div>

          </div>
        </div>
      )}
    </Layout>
  )
}
