import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useNavigate } from 'react-router-dom'
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
import { fetchAllRows } from '../../lib/fetchAllRows'
import { removeVietnameseTones } from '../../components/SmartSearchSelect'
import { smartFilter, smartIncludes } from '../../lib/smartSearch'
import { normalizePhone } from '../../lib/phone'
import { useAuth } from '../../contexts/AuthContext'
import { usePromotionEngine, type AppliedDiscount } from '../../hooks/usePromotionEngine'
import { useProductPromotions, evaluateProductPromo, promoShortLabel } from '../../hooks/useProductPromotions'
import { posTabsKey, loadDraft, saveDraft, clearDraft } from '../../lib/posDraftStorage'
import { genId } from '../../lib/cartUtils'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { usePosOfflineQueue } from '../../hooks/usePosOfflineQueue'
import { savePosSnapshot, loadPosSnapshot, enqueueSale } from '../../lib/offlineDb'
import PosOfflineBar from '../../components/PosOfflineBar'

interface Customer {
  id: string
  code: string
  farm_name: string
  credit_limit: number
  price_list_id: string | null
  value_tier: string
  primary_phone: string | null       // SĐT liên hệ chính (hiển thị)
  primary_phone_norm: string | null  // SĐT chuẩn hóa (chỉ số) — để tìm kiếm
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

interface ProductLot {
  lotId: string
  lotNumber: string
  expiry: string | null   // expiry_date (HSD), null = không hạn
  available: number       // quantity_on_hand - quantity_reserved
  isVat: boolean          // lô thuộc nhóm có VAT (xuất hóa đơn được)
}

interface CartItem {
  id: string
  product: Product
  // Lô cụ thể NV chọn bán (null = SP không quản lý lô / quà KM → server FEFO).
  lotId?: string | null
  lotNumber?: string
  lotExpiry?: string | null
  lotAvailable?: number   // tồn khả dụng của lô lúc thêm (chỉ để tham chiếu; kiểm tra dùng giá trị tươi)
  quantity: number
  unitPrice: number
  discountPercent: number // manual discount in percent
  isPriceOverridden?: boolean
  isGift?: boolean // dòng quà tặng từ KM (mua X tặng Y) — không phải SP giá-0 thật
  // ── Tự động áp KM theo sản phẩm ──
  autoPromoId?: string      // CK% trên dòng này do KM tự đặt (không phải NV nhập tay)
  promoDismissed?: boolean  // NV đã bấm "Bỏ KM" cho dòng này → không tự áp lại
  giftFromRowId?: string    // dòng quà: sinh ra từ dòng mua nào (rỗng = quà thêm tay bằng nút +KM)
  giftFromPromoId?: string  // dòng quà: thuộc KM nào
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
  salesMode: 'quick' | 'delivery'
  deliveryAddress: string
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
  const navigate = useNavigate()

  // ── POS offline: trạng thái mạng + hàng đợi đơn chờ đồng bộ + tuổi snapshot ──
  const online = useOnlineStatus()
  const offlineQueue = usePosOfflineQueue(profile?.id)
  const [snapshotInfo, setSnapshotInfo] = useState<{ at: number | null; stale: boolean }>({ at: null, stale: false })

  // Redirect mobile viewports to mobile-specific wizard
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        navigate('/orders/mobile', { replace: true })
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [navigate])

  // Base Data States
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerDebt, setCustomerDebt] = useState(0)
  // Thông tin mở rộng KH đang chọn (nạp lười khi chọn KH — không làm nặng load đầu).
  const [customerDetail, setCustomerDetail] = useState<{ phone: string | null; address: string | null } | null>(null)
  // Giá bán gần nhất của KH đang chọn cho từng SP (productId → unit_price). Reset khi đổi KH.
  const [lastPrices, setLastPrices] = useState<Record<string, number>>({})
  // Sửa hạn mức nợ ngay tại quầy (qua RPC có audit)
  const [editingCreditLimit, setEditingCreditLimit] = useState(false)
  const [creditLimitInput, setCreditLimitInput] = useState('')
  const [savingCreditLimit, setSavingCreditLimit] = useState(false)
  // Xử lý tiền khách trả DƯ: false = trả lại khách (mặc định) | true = ghi có công nợ (trừ nợ sau)
  const [overpayToCredit, setOverpayToCredit] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [productStock, setProductStock] = useState<Record<string, number>>({})
  // Lô theo SP (đã sắp FEFO theo HSD tăng dần) — để hiện HSD/cảnh báo cận hạn tại POS.
  const [productLots, setProductLots] = useState<Record<string, ProductLot[]>>({})
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('')
  const [categories, setCategories] = useState<{ id: string; code: string; name: string }[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [branchDefaultPriceListId, setBranchDefaultPriceListId] = useState<string | null>(null)
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
      treatmentPurpose: '',
      salesMode: 'quick',
      deliveryAddress: ''
    }
  ])
  const [activeTabId, setActiveTabId] = useState<string>('1')

  // Search / Dropdown UI States
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebouncedValue(searchTerm, 300)
  const [focusedSearchIndex, setFocusedSearchIndex] = useState(-1)
  // Luồng nhập số lượng: chọn LÔ (Enter) → nhập SL → Enter → thêm vào hóa đơn.
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null)
  const [pendingLot, setPendingLot] = useState<ProductLot | null>(null)
  const [pendingQty, setPendingQty] = useState('')
  const qtyInputRef = useRef<HTMLInputElement>(null)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  // Thêm nhanh khách hàng mới ngay tại POS
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [newCustName, setNewCustName] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')
  const [addingCustomer, setAddingCustomer] = useState(false)
  // Tùy chọn hiển thị POS — nhớ lựa chọn của thu ngân giữa các lần mở (localStorage).
  const readPref = (k: string, def: boolean) => {
    try { const v = localStorage.getItem(k); return v === null ? def : v === '1' } catch { return def }
  }
  // Mặc định ẩn danh mục để tăng diện tích thao tác (bật/tắt bất kỳ lúc nào)
  const [showGrid, setShowGrid] = useState(() => readPref('pos-pref:showGrid', false))
  const [showProductImages, setShowProductImages] = useState(() => readPref('pos-pref:showProductImages', true))
  // Mặc định KHÔNG tự in sau thanh toán; có thể bật bất kỳ lúc nào
  const [autoPrint, setAutoPrint] = useState(() => readPref('pos-pref:autoPrint', false))

  useEffect(() => { try { localStorage.setItem('pos-pref:showGrid', showGrid ? '1' : '0') } catch { /* noop */ } }, [showGrid])
  useEffect(() => { try { localStorage.setItem('pos-pref:showProductImages', showProductImages ? '1' : '0') } catch { /* noop */ } }, [showProductImages])
  useEffect(() => { try { localStorage.setItem('pos-pref:autoPrint', autoPrint ? '1' : '0') } catch { /* noop */ } }, [autoPrint])

  // Promotion / voucher (lọc theo chi nhánh của nhân viên đăng nhập)
  const branchId = profile?.branch_id ?? null
  const { applyBestPromotion, applyVoucher } = usePromotionEngine(branchId)
  const { getTopPromo, loading: promosLoading } = useProductPromotions(branchId)
  const [voucherCode, setVoucherCode] = useState('')
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null)
  const [voucherError, setVoucherError] = useState('')

  // Feedback UI States
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [createdOrderCode, setCreatedOrderCode] = useState('')
  const [createdOrderId, setCreatedOrderId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Chống bấm thanh toán 2 lần (Enter/F9 dồn nhanh trước khi state cập nhật → 2 đơn trùng).
  const submittingRef = useRef(false)

  // Focus search input
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Container ô chọn khách — để đóng dropdown khi bấm ra ngoài
  const customerBoxRef = useRef<HTMLDivElement>(null)

  // Đóng dropdown khách khi click ngoài vùng chọn khách
  useEffect(() => {
    if (!showCustomerDropdown) return
    const handleClickOutside = (e: MouseEvent) => {
      if (customerBoxRef.current && !customerBoxRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showCustomerDropdown])

  // Active Tab Proxy Calculations
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]

  // Ref luôn trỏ tab đang mở (cập nhật đồng bộ mỗi render). Các callback memoized
  // (addToCart/adjustQuantity/...) "đóng băng" activeTabId trong closure → khi 2 tab
  // cùng bảng giá, addToCart không tái tạo và ghi nhầm vào tab cũ. Đọc qua ref để
  // setCart/updateActiveTab luôn ghi đúng tab hiện tại.
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  // Ref luôn mới cho danh sách tab — dùng trong phím tắt Alt+số (effect deps []).
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

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
  const salesMode = activeTab.salesMode || 'quick'
  const deliveryAddress = activeTab.deliveryAddress || ''

  const updateActiveTab = (fields: Partial<InvoiceTab>) => {
    const id = activeTabIdRef.current
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t))
  }

  const setCart = (newCart: CartItem[] | ((prev: CartItem[]) => CartItem[])) => {
    const id = activeTabIdRef.current
    setTabs(prev => prev.map(t => {
      if (t.id === id) {
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

  const setSalesMode = (mode: 'quick' | 'delivery') => {
    updateActiveTab({ salesMode: mode })
  }

  const setDeliveryAddress = (addr: string) => {
    updateActiveTab({ deliveryAddress: addr })
  }

  const setTreatmentPurpose = (purpose: string) => {
    updateActiveTab({ treatmentPurpose: purpose })
  }

  const setNotes = (notesText: string) => {
    updateActiveTab({ notes: notesText })
  }

  // ── Bền hóa nháp đơn: khôi phục khi mở lại, auto-save khi thay đổi ──
  // Khóa theo từng nhân viên (máy quầy dùng chung) → không lẫn nháp giữa các ca.
  const draftKey = profile?.id ? posTabsKey(profile.id) : null
  // Gate: chỉ auto-save SAU khi đã thử khôi phục, tránh ghi đè nháp cũ bằng tab rỗng mặc định.
  const draftRestoredRef = useRef(false)

  useEffect(() => {
    if (!draftKey || draftRestoredRef.current) return
    const saved = loadDraft<{ tabs: InvoiceTab[]; activeTabId: string }>(
      draftKey,
      d => Array.isArray(d?.tabs) && d.tabs.length > 0 && d.tabs.every(t => t && typeof t.id === 'string')
    )
    if (saved) {
      setTabs(saved.tabs)
      const activeExists = saved.tabs.some(t => t.id === saved.activeTabId)
      setActiveTabId(activeExists ? saved.activeTabId : saved.tabs[0].id)
      const nNonEmpty = saved.tabs.filter(t => t.cart.length > 0).length
      if (nNonEmpty > 0) {
        setAlertMsg({ type: 'success', text: `Đã khôi phục ${nNonEmpty} hóa đơn nháp chưa thanh toán.` })
      }
    }
    draftRestoredRef.current = true
  }, [draftKey])

  useEffect(() => {
    if (!draftKey || !draftRestoredRef.current) return
    // Mọi hóa đơn đều trống (không hàng, không khách) → dọn nháp cho sạch.
    const hasContent = tabs.some(t => t.cart.length > 0 || t.selectedCustomerId || t.notes.trim())
    if (hasContent) {
      saveDraft(draftKey, { tabs, activeTabId })
    } else {
      clearDraft(draftKey)
    }
  }, [tabs, activeTabId, draftKey])

  // Keyboard navigation & payment hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === '/') || e.key === 'F2') {
        e.preventDefault()
        setPendingProduct(null)  // thoát chế độ nhập SL nếu đang mở
        setPendingLot(null)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      // Alt+1..9: chuyển nhanh giữa các hóa đơn đang mở.
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        const t = tabsRef.current[idx]
        if (t) { e.preventDefault(); setActiveTabId(t.id) }
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
    // Dựng lại danh mục bán hàng từ snapshot offline (mở quầy khi mất mạng).
    const hydrateCatalog = async () => {
      const uid = profile?.id
      if (!uid) return false
      const snap = await loadPosSnapshot(uid)
      if (!snap) return false
      if (snap.data.customers) setCustomers(snap.data.customers as Customer[])
      if (snap.data.products) setProducts(snap.data.products as Product[])
      if (snap.data.categories) setCategories(snap.data.categories as any)
      if (snap.data.priceLists) setPriceLists(snap.data.priceLists as any)
      setSnapshotInfo({ at: snap.savedAt, stale: snap.stale })
      return true
    }
    const loadData = async () => {
      // Offline ngay khi mở quầy → dùng snapshot, không cần mạng.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await hydrateCatalog()
        return
      }
      try {
        const custData = await fetchAllRows<Customer>((from, to) =>
          supabase
            .from('customers')
            .select('id, code, farm_name, credit_limit, price_list_id, value_tier, primary_phone, primary_phone_norm')
            .eq('is_active', true)
            .order('farm_name')
            .order('id')
            .range(from, to)
        )
        setCustomers(custData)

        const { data: catData } = await supabase
          .from('product_categories')
          .select('id, code, name')
          .eq('is_active', true)
        if (catData) setCategories(catData)

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

        let branchPlId: string | null = null
        if (currentBranchId) {
          const { data: branchData } = await supabase
            .from('branches')
            .select('default_price_list_id')
            .eq('id', currentBranchId)
            .single()
          if (branchData?.default_price_list_id) {
            branchPlId = branchData.default_price_list_id
            setBranchDefaultPriceListId(branchPlId)
          }
        }

        const { data: plData } = await supabase
          .from('price_lists')
          .select('id, code, name, is_default')
          .eq('is_active', true)
        if (plData) {
          setPriceLists(plData)
          const def = plData.find((pl: any) => pl.id === branchPlId) ||
                      plData.find((pl: any) => pl.is_default) ||
                      plData.find((pl: any) => pl.code === 'GIA-LE') ||
                      plData[0]
          if (def) {
            // Chỉ gán bảng giá mặc định khi tab còn trống — tránh đè bảng giá
            // người dùng đã chọn ở nháp vừa khôi phục.
            setTabs(prev => prev.map(t => t.id === '1' ? { ...t, selectedPriceListId: t.selectedPriceListId || def.id } : t))
          }
        }

        const prodData = await fetchAllRows<Product>((from, to) =>
          supabase
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
            .order('name')
            .order('id')
            .range(from, to)
        )
        setProducts(prodData)

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

        // Lưu snapshot danh mục để bán được khi mất mạng (TTL 72h).
        if (profile?.id) {
          await savePosSnapshot(profile.id, {
            customers: custData,
            products: prodData,
            categories: catData ?? [],
            priceLists: plData ?? [],
          })
          setSnapshotInfo({ at: Date.now(), stale: false })
        }
      } catch (err) {
        console.error('Error fetching data:', err)
        // Lỗi mạng giữa chừng → vẫn dựng danh mục từ snapshot nếu có.
        await hydrateCatalog()
      }
    }
    loadData()
  }, [])

  // Fetch stock levels and warehouses of cashier's branch
  const fetchStockData = useCallback(async () => {
    // Dựng lại tồn/kho từ snapshot offline.
    const hydrateStock = async () => {
      if (!profile?.id) return
      const snap = await loadPosSnapshot(profile.id)
      if (!snap) return
      if (snap.data.productStock) setProductStock(snap.data.productStock as Record<string, number>)
      if (snap.data.productLots) setProductLots(snap.data.productLots as Record<string, ProductLot[]>)
      if (snap.data.selectedWarehouseId) setSelectedWarehouseId(snap.data.selectedWarehouseId as string)
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await hydrateStock()
      return
    }
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

      // Kho xuất hàng của đơn = kho chính chi nhánh → tồn hiển thị/kiểm tra
      // phải khớp ĐÚNG kho này (nơi hệ thống thực trừ kho khi xác nhận đơn).
      let mainWhId: string | null = null
      if (currentBranchId) {
        const { data: whData } = await supabase
          .from('warehouses')
          .select('id, type')
          .eq('branch_id', currentBranchId)
          .eq('is_active', true)

        if (whData && whData.length > 0) {
          const mainWh = whData.find((w: any) => w.type === 'main') || whData[0]
          if (mainWh) {
            mainWhId = (mainWh as any).id
            setSelectedWarehouseId(mainWhId as string)
          }
        }
      }

      // Không xác định được kho chính → để tồn rỗng (không cho POS bán mù).
      if (!mainWhId) {
        setProductStock({})
        setProductLots({})
        return
      }

      const stockQuery = supabase
        .from('stock_lots')
        .select('id, product_id, lot_number, expiry_date, quantity_on_hand, quantity_reserved, is_vat')
        .eq('status', 'active')
        .eq('warehouse_id', mainWhId)

      const { data: stockData, error } = await stockQuery
      if (!error && stockData) {
        const stockMap: Record<string, number> = {}
        const lotsMap: Record<string, ProductLot[]> = {}
        stockData.forEach((item: any) => {
          const avail = (item.quantity_on_hand || 0) - (item.quantity_reserved || 0)
          stockMap[item.product_id] = (stockMap[item.product_id] || 0) + avail
          if (avail > 0) {
            if (!lotsMap[item.product_id]) lotsMap[item.product_id] = []
            lotsMap[item.product_id].push({
              lotId: item.id,
              lotNumber: item.lot_number || '—',
              expiry: item.expiry_date || null,
              available: avail,
              isVat: !!item.is_vat,
            })
          }
        })
        // Sắp FEFO: HSD tăng dần (không hạn xuống cuối) — khớp thứ tự trừ kho server.
        Object.values(lotsMap).forEach(lots => lots.sort((a, b) => {
          if (a.expiry && b.expiry) return a.expiry.localeCompare(b.expiry)
          if (a.expiry) return -1
          if (b.expiry) return 1
          return 0
        }))
        setProductStock(stockMap)
        setProductLots(lotsMap)
        // Snapshot tồn/kho cho bán offline.
        if (profile?.id) {
          await savePosSnapshot(profile.id, {
            productStock: stockMap,
            productLots: lotsMap,
            selectedWarehouseId: mainWhId,
          })
        }
      }
    } catch (err) {
      console.error('Error fetching stock data:', err)
      await hydrateStock()
    }
  }, [profile])

  useEffect(() => {
    if (products.length > 0) {
      fetchStockData()
    }
  }, [products, fetchStockData])

  // Làm tươi tồn kho khi máy/ca khác cùng bán SP (tồn hiển thị không bị cũ).
  // Refetch khi tab được focus/hiện lại + định kỳ 60s lúc đang hiển thị.
  // (Chọn polling nhẹ thay realtime: chắc chắn chạy, không phụ thuộc publication,
  //  chi phí ~1 query nhỏ/phút/máy — server vẫn là chân lý cuối khi xác nhận đơn.)
  useEffect(() => {
    if (products.length === 0) return
    const refetchIfVisible = () => {
      if (document.visibilityState === 'visible') fetchStockData()
    }
    window.addEventListener('focus', refetchIfVisible)
    document.addEventListener('visibilitychange', refetchIfVisible)
    const intervalId = window.setInterval(refetchIfVisible, 60000)
    return () => {
      window.removeEventListener('focus', refetchIfVisible)
      document.removeEventListener('visibilitychange', refetchIfVisible)
      window.clearInterval(intervalId)
    }
  }, [products.length, fetchStockData])

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

  // Nạp lười thông tin mở rộng KH (địa chỉ + SĐT lô chính) khi chọn KH.
  // Tách khỏi fetch hàng loạt customers để không tăng payload load đầu.
  useEffect(() => {
    setEditingCreditLimit(false)
    if (!selectedCustomerId) { setCustomerDetail(null); return }
    let cancelled = false
    const fetchDetail = async () => {
      try {
        const [{ data: cust }, { data: contact }] = await Promise.all([
          supabase.from('customers').select('province, district, address').eq('id', selectedCustomerId).single(),
          supabase.from('customer_contacts').select('phone').eq('customer_id', selectedCustomerId).eq('is_primary', true).limit(1).maybeSingle(),
        ])
        if (cancelled) return
        const addr = [(cust as any)?.address, (cust as any)?.district, (cust as any)?.province].filter(Boolean).join(', ')
        setCustomerDetail({ phone: (contact as any)?.phone || null, address: addr || null })
      } catch (err) {
        if (!cancelled) setCustomerDetail(null)
        console.error('Error fetching customer detail:', err)
      }
    }
    fetchDetail()
    return () => { cancelled = true }
  }, [selectedCustomerId])

  // Gợi ý GIÁ BÁN GẦN NHẤT — chỉ chạy SAU khi chọn KH. Lấy theo bộ SP trong giỏ
  // (chỉ refetch khi TẬP sản phẩm đổi, không refetch lúc đổi SL/giá → nhẹ).
  const cartProductIdsKey = useMemo(
    () => Array.from(new Set(cart.filter(c => !c.isGift).map(c => c.product.id))).sort().join(','),
    [cart]
  )
  useEffect(() => {
    if (!selectedCustomerId) { setLastPrices({}); return }
    const ids = cartProductIdsKey ? cartProductIdsKey.split(',') : []
    if (ids.length === 0) { setLastPrices({}); return }
    let cancelled = false
    const fetchLastPrices = async () => {
      try {
        const { data, error } = await supabase.rpc('fn_pos_last_sold_prices', {
          p_customer_id: selectedCustomerId,
          p_product_ids: ids,
        })
        if (cancelled || error || !data) return
        const map: Record<string, number> = {}
        ;(data as any[]).forEach(r => { map[r.product_id] = Number(r.unit_price) })
        setLastPrices(map)
      } catch (err) {
        console.error('Error fetching last sold prices:', err)
      }
    }
    fetchLastPrices()
    return () => { cancelled = true }
  }, [selectedCustomerId, cartProductIdsKey])

  // Đổi hóa đơn (tab) → reset lựa chọn xử lý tiền dư về mặc định (trả khách).
  useEffect(() => { setOverpayToCredit(false) }, [activeTabId])

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
        const def = priceLists.find(pl => pl.id === branchDefaultPriceListId) ||
                    priceLists.find(pl => pl.is_default) ||
                    priceLists.find(pl => pl.code === 'GIA-LE') ||
                    priceLists[0]
        if (def) {
          setSelectedPriceListId(def.id)
        }
      }
    }
  }, [selectedCustomerId, customers, priceLists, branchDefaultPriceListId])

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

  // Filter products (lưới "Xem danh mục") — dùng chung bộ khớp thông minh với ô tìm kiếm.
  const filteredProducts = useMemo(() => {
    const inCategory = products.filter(p => !selectedCategoryId || p.category_id === selectedCategoryId)
    return smartFilter(inCategory, debouncedSearch, p => [p.sku, p.name, p.brands?.name])
  }, [products, selectedCategoryId, debouncedSearch])

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

  // Filter customers — tìm theo TÊN/MÃ/ID (bỏ dấu) HOẶC SỐ ĐIỆN THOẠI.
  // Phone: chuẩn hóa cùng quy tắc DB (normalizePhone) rồi so khớp chuỗi con
  // trên primary_phone_norm → gõ "038…" hay "+8438…" đều ra.
  const filteredCustomers = useMemo(() => {
    const raw = customerSearchQuery.trim()
    const q = removeVietnameseTones(raw.toLowerCase())
    const phoneQ = normalizePhone(raw)
    const matched = !q
      ? customers
      : customers.filter(c =>
          removeVietnameseTones(c.farm_name.toLowerCase()).includes(q) ||
          removeVietnameseTones((c.code || '').toLowerCase()).includes(q) ||
          c.id.toLowerCase().includes(q) ||
          (!!phoneQ && !!c.primary_phone_norm && c.primary_phone_norm.includes(phoneQ))
        )
    // Giới hạn 50 dòng hiển thị (tránh render hàng nghìn nút khi danh sách lớn)
    return matched.slice(0, 50)
  }, [customers, customerSearchQuery])

  // Add to cart helper — kèm LÔ đã chọn (null = SP không lô / FEFO).
  const addToCart = useCallback((product: Product, qty: number = 1, lot: ProductLot | null = null) => {
    const addQty = qty > 0 ? qty : 1
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
      // Gộp dòng khi cùng SP + cùng LÔ + cùng giá + không CK/không sửa giá.
      const existingIndex = prev.findIndex(
        item => item.product.id === product.id &&
                (item.lotId ?? null) === (lot?.lotId ?? null) &&
                item.unitPrice === price &&
                item.discountPercent === 0 &&
                !item.isPriceOverridden
      )
      if (existingIndex > -1) {
        const updated = [...prev]
        updated[existingIndex] = { ...updated[existingIndex], quantity: updated[existingIndex].quantity + addQty }
        return updated
      }
      return [
        ...prev,
        {
          id: genId(), product, quantity: addQty, unitPrice: price, discountPercent: 0, isPriceOverridden: false,
          lotId: lot?.lotId ?? null,
          lotNumber: lot?.lotNumber,
          lotExpiry: lot?.expiry ?? null,
          lotAvailable: lot?.available,
        }
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
      // Tối thiểu 1 (xóa dòng dùng nút thùng rác) — tránh submit dòng số lượng 0.
      updated[index] = { ...updated[index], quantity: Math.max(1, qty) }
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
      { id: genId(), product, quantity: 1, unitPrice: 0, discountPercent: 0, isPriceOverridden: true, isGift: true }
    ])
  }, [])

  // Bỏ / áp lại KM sản phẩm cho một dòng giỏ. Dọn luôn CK do KM đặt; dòng quà sẽ
  // được effect tự-áp bên dưới gỡ ra ở lượt render kế tiếp.
  const setPromoDismissed = useCallback((rowId: string, dismissed: boolean) => {
    setCart(prev => prev.map(c => c.id === rowId ? { ...c, promoDismissed: dismissed } : c))
  }, [])

  // Set manual discount for row. NV nhập tay → dòng thoát khỏi quyền kiểm soát của KM
  // (xóa autoPromoId) để effect tự-áp không ghi đè con số NV vừa gõ.
  const setRowDiscount = useCallback((rowId: string, discount: number) => {
    setCart(prev => {
      const index = prev.findIndex(item => item.id === rowId)
      if (index === -1) return prev
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        discountPercent: Math.max(0, Math.min(100, discount)),
        autoPromoId: undefined,
      }
      return updated
    })
  }, [])

  // ── Tự động áp KM theo sản phẩm ────────────────────────────────────────────
  // Trước đây POS chỉ *gợi ý*: nhân viên quên bấm là khách mất quà. Nay đủ điều kiện
  // là áp ngay (sinh dòng quà / đặt CK%), nhân viên bấm "Bỏ KM" nếu khách không lấy.
  // Effect chỉ ghi lại giỏ khi thực sự có thay đổi (changed) — nếu không sẽ lặp vô hạn.
  useEffect(() => {
    if (promosLoading) return
    setCart(prev => {
      let changed = false
      const nextBuyers: CartItem[] = []
      // dòng mua (id) → quà mà KM của nó đang đòi hỏi
      const wantGifts = new Map<string, { productId: string; qty: number; price: number; promoId: string }>()

      for (const item of prev) {
        if (item.isGift) continue   // dòng quà xử lý ở vòng dưới

        const promo = item.promoDismissed ? null : getTopPromo(item.product.id)
        const ev = promo ? evaluateProductPromo(promo, item.quantity, item.unitPrice) : null
        const active = ev?.eligible ? ev : null

        if (active && active.promo.promo_type === 'buy_x_get_y') {
          wantGifts.set(item.id, {
            productId: active.giftProductId,
            qty: active.giftQty,
            price: active.giftPrice,
            promoId: active.promo.id,
          })
        }

        const isDiscountPromo = active != null && active.promo.promo_type !== 'buy_x_get_y'
        const wantPct = isDiscountPromo ? active!.discountPercent : 0
        const wantPromoId = isDiscountPromo ? active!.promo.id : undefined

        // Chỉ đụng vào CK khi nó đang do KM đặt, hoặc dòng chưa có CK nào (NV chưa gõ tay).
        const mayTouch = item.autoPromoId != null || item.discountPercent === 0
        if (mayTouch && (item.discountPercent !== wantPct || item.autoPromoId !== wantPromoId)) {
          nextBuyers.push({ ...item, discountPercent: wantPct, autoPromoId: wantPromoId })
          changed = true
        } else {
          nextBuyers.push(item)
        }
      }

      const nextGifts: CartItem[] = []
      for (const g of prev) {
        if (!g.isGift) continue
        // Quà nhân viên tự thêm bằng nút "+KM" → không có giftFromRowId, KM không đụng tới.
        if (!g.giftFromRowId) { nextGifts.push(g); continue }

        const want = wantGifts.get(g.giftFromRowId)
        // Dòng mua đã xóa / giảm SL dưới ngưỡng / NV bỏ KM / KM đổi sang SP quà khác → gỡ quà.
        if (!want || want.productId !== g.product.id) { changed = true; continue }

        wantGifts.delete(g.giftFromRowId)   // đã có dòng quà cho KM này
        if (g.quantity !== want.qty || g.unitPrice !== want.price) {
          nextGifts.push({ ...g, quantity: want.qty, unitPrice: want.price })
          changed = true
        } else {
          nextGifts.push(g)
        }
      }

      // Quà còn thiếu → thêm mới
      for (const [rowId, want] of wantGifts) {
        const giftProduct = products.find(p => p.id === want.productId)
        if (!giftProduct) continue   // SP quà không có trong danh mục đang tải → bỏ qua, không lặp
        nextGifts.push({
          id: genId(),
          product: giftProduct,
          quantity: want.qty,
          unitPrice: want.price,
          discountPercent: 0,
          isPriceOverridden: true,
          isGift: true,
          giftFromRowId: rowId,
          giftFromPromoId: want.promoId,
        })
        changed = true
      }

      if (!changed) return prev
      return [...nextBuyers, ...nextGifts]   // quà luôn dồn xuống cuối giỏ
    })
  }, [cart, getTopPromo, products, promosLoading])

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

  // Số tiền khách thực trả (mặc định trả đủ nếu để trống); ghi nợ = phần còn thiếu.
  const effectivePaid = paymentMethod === 'credit' ? 0 : (paymentAmount || grandTotal)
  const debtAmount = paymentMethod === 'credit' ? grandTotal : Math.max(0, grandTotal - effectivePaid)

  // Vượt hạn mức khi phần ghi nợ phát sinh khiến tổng nợ > hạn mức (khớp logic RPC server)
  const isCreditLimitExceeded = !!selectedCustomer && debtAmount > 0 &&
    (customerDebt + debtAmount > selectedCustomer.credit_limit)

  // Vượt tồn — TÍNH THEO TỪNG LÔ (khớp chặn server fn_pos_build_draft bản 20260706):
  //   • dòng có lô → gộp theo lô, so tồn khả dụng tươi của ĐÚNG lô đó (productLots).
  //   • dòng không lô (quà/SP không lô) → gộp theo SP, so tồn tổng SP (productStock).
  const oversellLines = useMemo(() => {
    const byKey = new Map<string, { label: string; req: number; avail: number }>()
    cart.forEach(item => {
      if (item.lotId) {
        const key = 'lot:' + item.lotId
        // tồn tươi của lô từ productLots (lô đã bán hết sẽ không còn → avail 0)
        const freshLot = (productLots[item.product.id] || []).find(l => l.lotId === item.lotId)
        const avail = freshLot ? freshLot.available : 0
        const cur = byKey.get(key)
        if (cur) cur.req += item.quantity
        else byKey.set(key, { label: `${item.product.name} / Lô ${item.lotNumber || '—'}`, req: item.quantity, avail })
      } else {
        const key = 'prod:' + item.product.id
        const cur = byKey.get(key)
        if (cur) cur.req += item.quantity
        else byKey.set(key, { label: item.product.name, req: item.quantity, avail: productStock[item.product.id] || 0 })
      }
    })
    const out: { label: string; req: number; avail: number; short: number }[] = []
    byKey.forEach(({ label, req, avail }) => {
      if (req > avail) out.push({ label, req, avail, short: req - avail })
    })
    return out
  }, [cart, productStock, productLots])

  // Autocomplete products — khớp tên/SKU/thương hiệu HOẶC số lô (tìm SP bằng số lô).
  // Khớp theo TOKEN, bỏ dấu & bỏ ký tự ngăn cách: "mkv doxy" ra "MKV-Doxy 50% kg", "doxy mkv" cũng ra.
  // Kết quả xếp theo độ liên quan (SKU/tên khớp sát nhất lên đầu).
  const searchResults = useMemo(() => {
    const q = debouncedSearch.trim()
    if (!q) return []
    return smartFilter(products, q, p => [
      p.sku,
      p.name,
      p.brands?.name,
      (productLots[p.id] || []).map(l => l.lotNumber).join(' ')
    ])
  }, [products, debouncedSearch, productLots])

  // Phẳng hóa theo LÔ — NV chọn ĐÚNG lô (mỗi lô 1 mục; SP không lô → 1 mục lot=null).
  // ↑↓ duyệt theo mục này, Enter chọn mục → nhập số lượng.
  // Nếu SP chỉ khớp do SỐ LÔ (không khớp tên/SKU) → chỉ hiện đúng lô khớp.
  const searchLotEntries = useMemo(() => {
    const q = debouncedSearch.trim()
    const entries: { product: Product; lot: ProductLot | null }[] = []
    for (const p of searchResults) {
      const lots = productLots[p.id] || []
      if (lots.length === 0) { entries.push({ product: p, lot: null }); continue }
      const matchesNameSku = smartIncludes(q, p.sku, p.name, p.brands?.name)
      const lotsToShow = matchesNameSku
        ? lots
        : lots.filter(l => smartIncludes(q, l.lotNumber))
      const finalLots = lotsToShow.length > 0 ? lotsToShow : lots
      for (const lot of finalLots) entries.push({ product: p, lot })
    }
    return entries
  }, [searchResults, productLots, debouncedSearch])

  // Keyboard navigation for Autocomplete
  useEffect(() => {
    if (searchResults.length > 0) {
      setFocusedSearchIndex(0)
    } else {
      setFocusedSearchIndex(-1)
    }
  }, [debouncedSearch])

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = searchLotEntries.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (n > 0) setFocusedSearchIndex(prev => (prev + 1) % n)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (n > 0) setFocusedSearchIndex(prev => (prev - 1 + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const index = focusedSearchIndex >= 0 ? focusedSearchIndex : 0
      const entry = searchLotEntries[index]
      if (entry) choosePendingLot(entry.product, entry.lot)
    } else if (e.key === 'Escape') {
      setSearchTerm('')
      setFocusedSearchIndex(-1)
    }
  }

  // Chọn LÔ (Enter/click) → bước nhập SỐ LƯỢNG. Ô SL luôn mount, mặc định "1" + bôi chọn
  // để gõ đè ngay; focus chắc chắn (sửa lỗi #4 không nhảy focus).
  const choosePendingLot = (prod: Product, lot: ProductLot | null) => {
    setPendingProduct(prod)
    setPendingLot(lot)
    setPendingQty('1')
    setSearchTerm('')
    setFocusedSearchIndex(-1)
    setTimeout(() => { qtyInputRef.current?.focus(); qtyInputRef.current?.select() }, 0)
  }

  const cancelPendingProduct = () => {
    setPendingProduct(null)
    setPendingLot(null)
    setPendingQty('')
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  // Xác nhận số lượng cho LÔ đang chọn → thêm vào hóa đơn, quay lại ô tìm kiếm.
  const confirmPendingQty = () => {
    if (!pendingProduct) return
    const qty = parseFloat(pendingQty.replace(',', '.')) || 1
    addToCart(pendingProduct, qty, pendingLot)
    setPendingProduct(null)
    setPendingLot(null)
    setPendingQty('')
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmPendingQty()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelPendingProduct()
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

  const changeDue = Math.max(0, effectivePaid - grandTotal)

  // Tabs management
  const handleAddTab = () => {
    let nextNum = 1
    while (tabs.some(t => t.name === `Hóa đơn ${nextNum}`)) {
      nextNum++
    }
    const newId = genId()
    const def = priceLists.find(pl => pl.id === branchDefaultPriceListId) ||
                priceLists.find(pl => pl.is_default) ||
                priceLists.find(pl => pl.code === 'GIA-LE') ||
                priceLists[0]
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
      treatmentPurpose: '',
      salesMode: 'quick',
      deliveryAddress: ''
    }
    setTabs([...tabs, newTab])
    setActiveTabId(newId)
  }

  const handleCloseTab = (idToClose: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // Đóng tab = xóa vĩnh viễn hóa đơn này (cả trong nháp đã lưu) → hỏi nếu còn hàng.
    const closing = tabs.find(t => t.id === idToClose)
    if (closing && closing.cart.length > 0 &&
        !window.confirm(`Hóa đơn "${closing.name}" còn ${closing.cart.length} sản phẩm chưa thanh toán. Vẫn đóng và xóa?`)) {
      return
    }
    if (tabs.length === 1) {
      const def = priceLists.find(pl => pl.id === branchDefaultPriceListId) ||
                  priceLists.find(pl => pl.is_default) ||
                  priceLists.find(pl => pl.code === 'GIA-LE') ||
                  priceLists[0]
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
          treatmentPurpose: '',
          salesMode: 'quick',
          deliveryAddress: ''
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

  // Dọn tab hiện tại sau khi tạo đơn thành công
  const resetActiveTab = () => {
    const def = priceLists.find(pl => pl.id === branchDefaultPriceListId) ||
                priceLists.find(pl => pl.is_default) ||
                priceLists.find(pl => pl.code === 'GIA-LE') ||
                priceLists[0]
    updateActiveTab({
      cart: [],
      invoiceDiscount: 0,
      paymentMethod: 'cash',
      selectedCustomerId: '',
      customerSearchQuery: '',
      paymentAmount: 0,
      notes: '',
      selectedPriceListId: def ? def.id : '',
      selectedDiseaseId: '',
      treatmentPurpose: '',
      deliveryAddress: ''
    })
    setAppliedDiscount(null)
    setVoucherCode('')
    setVoucherError('')
    setOverpayToCredit(false)
  }

  // Submit: bán nhanh (atomic RPC) hoặc tạo đơn giao hàng nháp
  // Thêm nhanh khách hàng mới ngay tại POS (RLS: owner_user_id = auth.uid()).
  const handleQuickAddCustomer = async () => {
    const name = newCustName.trim()
    if (!name) { setAlertMsg({ type: 'error', text: 'Vui lòng nhập tên khách / trại.' }); return }
    if (!profile?.id) { setAlertMsg({ type: 'error', text: 'Lỗi tài khoản. Vui lòng đăng nhập lại.' }); return }
    const phone = newCustPhone.trim()
    // Validate định dạng SĐT (nếu có nhập) — đồng bộ với AddCustomerModal.
    if (phone && !/^(\+84|0)[3-9][0-9]{8}$/.test(phone.replace(/\s/g, ''))) {
      setAlertMsg({ type: 'error', text: 'Số điện thoại không hợp lệ (VD: 0901234567).' })
      return
    }
    // Chống trùng: cảnh báo nếu SĐT chuẩn hóa đã thuộc về khách khác (không chặn cứng).
    const phoneNorm = normalizePhone(phone)
    if (phoneNorm) {
      const dup = customers.find(c => c.primary_phone_norm === phoneNorm)
      if (dup && !window.confirm(
        `SĐT ${phone} đã gắn với khách "${dup.farm_name}" (mã ${dup.code || 'N/A'}).\n` +
        `Vẫn tạo khách MỚI trùng số này?`
      )) {
        return
      }
    }
    setAddingCustomer(true)
    try {
      const { data: cust, error } = await supabase
        .from('customers')
        .insert([{ farm_name: name, owner_user_id: profile.id }])
        .select('id, code, farm_name, credit_limit, price_list_id, value_tier, primary_phone, primary_phone_norm')
        .single()
      if (error) throw error
      if (phone) {
        await supabase.from('customer_contacts')
          .insert([{ customer_id: cust.id, full_name: name, phone, is_primary: true }])
      }
      // Trigger DB đã ghi primary_phone* vào customers — phản ánh ngay vào state cục bộ
      // để dropdown/tìm kiếm thấy số mà không cần nạp lại toàn bộ danh sách.
      const newC = { ...(cust as Customer), primary_phone: phone || null, primary_phone_norm: phoneNorm || null }
      setCustomers(prev => [newC, ...prev])
      setSelectedCustomerId(newC.id)
      setCustomerSearchQuery(newC.farm_name)
      setShowAddCustomer(false)
      setShowCustomerDropdown(false)
      setNewCustName(''); setNewCustPhone('')
      setAlertMsg({ type: 'success', text: `Đã thêm khách hàng "${name}".` })
    } catch (err: any) {
      console.error('Quick add customer error:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi thêm khách: ' + (err.message || 'Không xác định') })
    } finally {
      setAddingCustomer(false)
    }
  }

  // Lưu hạn mức nợ KH qua RPC (bỏ RLS + ghi audit). Cập nhật state cục bộ để
  // isCreditLimitExceeded tính lại ngay, không phải nạp lại toàn bộ danh sách KH.
  const handleSaveCreditLimit = async () => {
    if (!selectedCustomerId) return
    const newLimit = parseNumberString(creditLimitInput)
    if (newLimit < 0) { setAlertMsg({ type: 'error', text: 'Hạn mức nợ phải ≥ 0.' }); return }
    setSavingCreditLimit(true)
    try {
      const { error } = await supabase.rpc('fn_pos_set_credit_limit', {
        p_customer_id: selectedCustomerId,
        p_credit_limit: newLimit,
      })
      if (error) throw error
      setCustomers(prev => prev.map(c => c.id === selectedCustomerId ? { ...c, credit_limit: newLimit } : c))
      setEditingCreditLimit(false)
      setAlertMsg({ type: 'success', text: `Đã cập nhật hạn mức nợ: ${newLimit.toLocaleString('vi-VN')} ₫.` })
    } catch (err: any) {
      console.error('Set credit limit error:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi cập nhật hạn mức: ' + (err.message || 'Không xác định') })
    } finally {
      setSavingCreditLimit(false)
    }
  }

  const handlePayment = async () => {
    if (submittingRef.current) return   // chống double-submit (đồng bộ, trước khi setState)
    if (cart.length === 0) {
      setAlertMsg({ type: 'error', text: 'Giỏ hàng đang trống. Vui lòng thêm sản phẩm.' })
      return
    }
    if (!selectedCustomerId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn khách hàng.' })
      return
    }
    if (!profile?.id) {
      setAlertMsg({ type: 'error', text: 'Lỗi tài khoản. Vui lòng đăng nhập lại.' })
      return
    }
    // Chặn cứng bán âm tồn kho (cả Bán nhanh & Bán giao hàng) — khớp check server.
    if (oversellLines.length > 0) {
      setAlertMsg({
        type: 'error',
        text: 'Không đủ tồn kho: ' + oversellLines.map(l => `${l.label} (cần ${l.req.toLocaleString('vi-VN')}, còn ${l.avail.toLocaleString('vi-VN')})`).join('; ')
      })
      return
    }
    // Chặn vượt hạn mức khi bán nhanh có phát sinh ghi nợ
    if (salesMode === 'quick' && isCreditLimitExceeded && selectedCustomer) {
      setAlertMsg({
        type: 'error',
        text: `Vượt hạn mức nợ. Hạn mức: ${selectedCustomer.credit_limit.toLocaleString('vi-VN')} ₫, nợ hiện tại: ${customerDebt.toLocaleString('vi-VN')} ₫, phát sinh: ${debtAmount.toLocaleString('vi-VN')} ₫.`
      })
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      // discount per-unit (khớp order_lines.discount). promotion_id = KM sản phẩm đã áp
      // lên dòng (chiết khấu hoặc quà) → phục vụ báo cáo hiệu quả KM.
      const lines = cart.map(item => ({
        product_id: item.product.id,
        lot_id: item.lotId || null,   // lô NV chọn (null = FEFO)
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount: Math.round(item.unitPrice * (item.discountPercent / 100)),
        promotion_id: item.autoPromoId ?? item.giftFromPromoId ?? null,
      }))
      // ⚠️ KHÔNG gửi invoice_discount nữa: server tự tính lại tiền giảm từ định nghĩa
      // KM/voucher + các dòng đơn thật (fn_pos_build_draft). Client chỉ khai BÁO ÁP CÁI GÌ,
      // không được quyết ÁP BAO NHIÊU — trước đây sửa payload là giảm giá tuỳ ý.
      const basePayload = {
        customer_id: selectedCustomerId,
        warehouse_id: selectedWarehouseId || null,
        price_list_id: selectedPriceListId || null,
        promotion_id: appliedDiscount?.type === 'promotion' ? appliedDiscount.id : null,
        voucher_code: appliedDiscount?.type === 'voucher' ? (appliedDiscount.code ?? null) : null,
        notes: notes || null,
        disease_id: selectedDiseaseId || null,
        treatment_purpose: treatmentPurpose || null,
        payment_method: paymentMethod,
        lines
      }

      // ── OFFLINE: chỉ Bán nhanh → xếp hàng đợi (idempotent), tự đồng bộ sau ──
      if (!online || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        if (salesMode === 'delivery') {
          setAlertMsg({ type: 'error', text: 'Bán giao hàng cần mạng (đơn nháp chờ duyệt giá). Khi offline vui lòng dùng Bán nhanh.' })
          return
        }
        const crid = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
              const r = (Math.random() * 16) | 0
              return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
            })
        const payload = {
          ...basePayload,
          paid_amount: paymentMethod === 'credit' ? 0 : effectivePaid,
          pay_full: paymentMethod !== 'credit' && !paymentAmount,
          overpay_credit: paymentMethod !== 'credit' && changeDue > 0 && overpayToCredit,
          delivery_address: 'Giao trực tiếp tại quầy POS',
        }
        await enqueueSale({
          id: crid,
          userId: profile.id,
          payload,
          label: `${selectedCustomer?.farm_name ?? 'Khách lẻ'} · ${grandTotal.toLocaleString('vi-VN')} ₫`,
        })
        // Trừ tồn cục bộ để đơn offline kế tiếp không bán vượt cùng lô.
        setProductStock((prev) => {
          const next = { ...prev }
          for (const l of lines) next[l.product_id] = Math.max(0, (next[l.product_id] || 0) - l.quantity)
          return next
        })
        setProductLots((prev) => {
          const next: Record<string, ProductLot[]> = { ...prev }
          for (const l of lines) {
            const lots = (next[l.product_id] || []).map((x) => ({ ...x }))
            const ordered = l.lot_id ? [...lots].sort((a, b) => (a.lotId === l.lot_id ? -1 : b.lotId === l.lot_id ? 1 : 0)) : lots
            let remain = l.quantity
            for (const lot of ordered) {
              if (remain <= 0) break
              const take = Math.min(lot.available, remain)
              lot.available -= take
              remain -= take
            }
            next[l.product_id] = lots.filter((x) => x.available > 0)
          }
          return next
        })
        await offlineQueue.refresh()
        resetActiveTab()
        const creditNote = paymentMethod === 'credit' ? ' (bán NỢ — chưa kiểm tra được hạn mức, sẽ kiểm khi đồng bộ)' : ''
        setAlertMsg({ type: 'success', text: `Đã lưu đơn offline${creditNote}. Sẽ tự đồng bộ khi có mạng.` })
        return
      }

      if (salesMode === 'delivery') {
        const { data, error } = await supabase.rpc('fn_create_delivery_draft', {
          p_payload: { ...basePayload, delivery_address: deliveryAddress || null }
        })
        if (error) throw error
        const res = data as { order_id: string; order_code: string }
        resetActiveTab()
        setAlertMsg({ type: 'success', text: `Đã tạo đơn giao hàng ${res.order_code} (nháp). Chờ Admin xác nhận đơn & duyệt giá bán.` })
        return
      }

      // Bán nhanh tại quầy — atomic
      const { data, error } = await supabase.rpc('fn_pos_quick_sale', {
        p_payload: {
          ...basePayload,
          paid_amount: paymentMethod === 'credit' ? 0 : effectivePaid,
          // NV không gõ số cụ thể = khách trả đủ → server thu theo TỔNG NÓ TỰ TÍNH,
          // tránh phần chênh do KM hết hạn giữa chừng âm thầm thành công nợ.
          pay_full: paymentMethod !== 'credit' && !paymentAmount,
          // Khách trả dư + chọn "tính vào công nợ" → server KHÔNG kẹp trần, ghi số dư có.
          overpay_credit: paymentMethod !== 'credit' && changeDue > 0 && overpayToCredit,
          delivery_address: 'Giao trực tiếp tại quầy POS'
        }
      })
      if (error) throw error
      const res = data as { order_id: string; order_code: string; grand_total?: number }

      // Lượt dùng KM/voucher do TRIGGER trên orders đếm, trong cùng giao dịch với đơn
      // → không còn cảnh "đơn đã tạo mà lượt không được ghi".

      // Server là nguồn chân lý về chiết khấu. Lệch = KM đã hết hạn/hết lượt giữa lúc
      // NV đang bấm → phải nói rõ, không im lặng.
      const serverTotal = res.grand_total != null ? Number(res.grand_total) : null
      const totalMismatch = serverTotal != null && Math.abs(serverTotal - grandTotal) >= 1

      setCreatedOrderCode(res.order_code)
      setCreatedOrderId(res.order_id)
      resetActiveTab()
      fetchStockData()

      if (autoPrint && !totalMismatch) {
        navigate(`/print-preview?type=invoice&id=${res.order_id}`)
      } else {
        setShowReceiptModal(true)
        setAlertMsg(totalMismatch
          ? {
              type: 'error',
              text: `Hóa đơn ${res.order_code} đã lưu, nhưng TỔNG THẬT là ${serverTotal!.toLocaleString('vi-VN')} ₫ `
                + `(màn hình hiện ${grandTotal.toLocaleString('vi-VN')} ₫). Khuyến mãi có thể vừa hết hạn/hết lượt. `
                + `Kiểm tra lại số tiền đã thu.`,
            }
          : { type: 'success', text: `Hóa đơn ${res.order_code} đã thanh toán thành công.` })
      }
    } catch (err: any) {
      console.error('POS billing error:', err)
      setAlertMsg({ type: 'error', text: 'Thao tác thất bại: ' + (err.message || 'Lỗi không xác định') })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)
  }

  // ── Giá vốn & cảnh báo bán lỗ ──
  // Giá vốn lấy theo bảng giá đang chọn; không có thì lấy bảng Giá lẻ (GIA-LE); cuối cùng lấy mục đầu có giá vốn.
  const getProductCost = useCallback((product: Product): number => {
    const items = product.price_list_items || []
    if (items.length === 0) return 0
    const current = items.find(i => i.price_list_id === selectedPriceListId || i.price_list?.id === selectedPriceListId)
    if (current?.cost_price) return current.cost_price
    const retail = items.find(i => i.price_list?.code === 'GIA-LE')
    if (retail?.cost_price) return retail.cost_price
    return items.find(i => i.cost_price > 0)?.cost_price ?? 0
  }, [selectedPriceListId])

  /** Đơn giá sau CK dòng < giá vốn → dòng bán lỗ (bỏ qua dòng quà tặng/KM 0đ). */
  const getBelowCost = useCallback((item: CartItem) => {
    const cost = getProductCost(item.product)
    if (item.isGift || cost <= 0) return null
    const effective = item.unitPrice * (1 - (item.discountPercent || 0) / 100)
    if (effective >= cost) return null
    const lossPerUnit = cost - effective
    return { cost, effective, lossPerUnit, lossTotal: lossPerUnit * item.quantity }
  }, [getProductCost])

  const belowCostLines = useMemo(
    () => cart.map(item => ({ item, below: getBelowCost(item) })).filter(r => r.below !== null),
    [cart, getBelowCost]
  )
  const belowCostTotalLoss = belowCostLines.reduce((s, r) => s + (r.below?.lossTotal || 0), 0)

  // ── Lô & HSD (FEFO) ──
  const NEAR_EXPIRY_DAYS = 30  // ngưỡng cảnh báo cận hạn
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : 'Không hạn'
  const daysToExpiry = (expiry: string | null): number | null => {
    if (!expiry) return null
    return Math.ceil((new Date(expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)
  }
  // ── Thanh tìm kiếm + nhập SỐ LƯỢNG (đặt ngay trong thanh xanh POS, rộng & rõ chữ) ──
  // Ô số lượng LUÔN hiển thị sẵn (mặc định "1"); chọn SP xong con trỏ tự nhảy vào đây.
  const productSearchBar = (
    <div className="relative flex-1 min-w-0">
      <div className="flex items-stretch h-9 bg-white rounded-md shadow-sm overflow-visible">
        {/* Vùng tìm kiếm / SP đang chọn */}
        <div className="flex items-center flex-1 min-w-0 px-2.5">
          {pendingProduct ? (
            <div className="flex items-center gap-2 min-w-0 w-full">
              <Package className="text-blue-600 shrink-0" size={16} />
              <span className="font-bold text-[14px] text-gray-800 truncate shrink min-w-0" title={pendingProduct.name}>{pendingProduct.name}</span>
              {pendingLot ? (
                <span className="shrink-0 flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 font-bold whitespace-nowrap">
                  <Layers size={11} /> Lô {pendingLot.lotNumber} · HSD {fmtDate(pendingLot.expiry)} · còn {pendingLot.available.toLocaleString('vi-VN')}
                  {pendingLot.isVat
                    ? <span className="ml-1 px-1 bg-emerald-100 text-emerald-700 rounded text-[9px]">HĐ đỏ</span>
                    : <span className="ml-1 px-1 bg-gray-100 text-gray-500 rounded text-[9px]">Không HĐ</span>}
                </span>
              ) : (
                <span className="text-[11px] text-gray-400 shrink-0 whitespace-nowrap">Tồn: <b className={(productStock[pendingProduct.id]||0)>0?'text-emerald-600':'text-red-500'}>{(productStock[pendingProduct.id]||0).toLocaleString('vi-VN')}</b></span>
              )}
              <span className="text-[11px] text-gray-400 shrink-0 hidden lg:inline ml-1">Enter để thêm · Esc hủy</span>
              <button onClick={cancelPendingProduct} className="ml-auto shrink-0 text-gray-400 hover:text-red-500 p-0.5" title="Hủy chọn (Esc)"><X size={15} /></button>
            </div>
          ) : (
            <>
              <Search className="text-gray-400 mr-2 shrink-0" size={16} strokeWidth={1.5} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="F2: Tìm sản phẩm (SKU, tên) — ↑↓ chọn, Enter nhập số lượng"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="bg-transparent border-none focus:ring-0 w-full placeholder-gray-400 p-0 focus:outline-none text-[14px] text-gray-800"
              />
            </>
          )}
        </div>
        {/* Ô SỐ LƯỢNG — luôn hiển thị sẵn */}
        <div className={`flex items-center gap-1.5 px-2 border-l ${pendingProduct ? 'border-blue-200 bg-blue-50/70' : 'border-gray-150 bg-gray-50'}`}>
          <span className="text-[10px] font-bold text-gray-400 uppercase shrink-0">SL</span>
          <input
            ref={qtyInputRef}
            type="text"
            inputMode="decimal"
            value={pendingQty}
            disabled={!pendingProduct}
            onChange={e => setPendingQty(e.target.value)}
            onKeyDown={handleQtyKeyDown}
            placeholder="1"
            className="w-16 h-7 text-center bg-white border border-gray-300 rounded text-[15px] font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-blue-700 disabled:bg-gray-100 disabled:text-gray-300 shrink-0"
          />
          <span className="text-[11px] text-gray-400 w-8 truncate shrink-0">{pendingProduct?.unit || ''}</span>
        </div>
        {/* Nút Thêm */}
        <button
          onClick={confirmPendingQty}
          disabled={!pendingProduct}
          className="shrink-0 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[13px] font-bold flex items-center gap-1 rounded-r-md transition-colors"
        >
          <Plus size={14} /> Thêm
        </button>
      </div>

      {/* Dropdown — MỖI LÔ là 1 mục CHỌN ĐƯỢC (NV chọn đúng lô khách chấp nhận).
          Nhóm theo SP: tiêu đề SP (giá/tồn) + danh sách lô bấm chọn. */}
      {!pendingProduct && searchTerm && (
        <div className="absolute left-0 right-0 top-full mt-1.5 max-h-[460px] overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-2xl z-[60] py-1 text-gray-800">
          {searchLotEntries.map((entry, idx) => {
            const prod = entry.product
            const lot = entry.lot
            const firstOfProduct = idx === 0 || searchLotEntries[idx - 1].product.id !== prod.id
            let price = 0
            if (prod.price_list_items && prod.price_list_items.length > 0) {
              const itemPrice = prod.price_list_items.find(
                item => item.price_list_id === selectedPriceListId || item.price_list?.id === selectedPriceListId
              )
              price = itemPrice
                ? itemPrice.selling_price
                : (prod.price_list_items.find(i => i.price_list?.code === 'GIA-LE')?.selling_price ?? prod.price_list_items[0].selling_price)
            }
            const nd = lot ? daysToExpiry(lot.expiry) : null
            const expired = nd !== null && nd < 0
            const near = nd !== null && nd >= 0 && nd <= NEAR_EXPIRY_DAYS
            const isFefoFirst = !!lot && (productLots[prod.id] || [])[0]?.lotId === lot.lotId
            return (
              <Fragment key={prod.id + ':' + (lot?.lotId || 'nolot')}>
                {firstOfProduct && (
                  <div className="px-3.5 pt-2 pb-1 flex items-start justify-between gap-3 bg-gray-50/70 border-t border-gray-100 first:border-t-0">
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-[13px] leading-snug break-words">{prod.name}</span>
                      <span className="text-[10px] text-gray-400 font-mono">SKU {prod.sku || '-'} · ĐVT {prod.unit || '-'} · Tồn <span className={(productStock[prod.id] || 0) > 0 ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold'}>{(productStock[prod.id] || 0).toLocaleString('vi-VN')}</span></span>
                    </div>
                    {(() => {
                      const cost = getProductCost(prod)
                      const under = cost > 0 && price < cost
                      return (
                        <div className="shrink-0 text-right">
                          <span className={`font-bold text-[13px] ${under ? 'text-red-600' : 'text-blue-600'}`}>{formatCurrency(price)}</span>
                          {under && (
                            <span className="block text-[9px] font-bold text-red-600 uppercase">Dưới vốn {cost.toLocaleString('vi-VN')} ₫</span>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
                <div
                  onClick={() => choosePendingLot(prod, lot)}
                  className={`px-3.5 py-1.5 pl-7 cursor-pointer flex items-center gap-1.5 flex-wrap ${
                    idx === focusedSearchIndex ? 'bg-blue-100 ring-1 ring-inset ring-blue-300' : 'hover:bg-blue-50'
                  }`}
                >
                  {lot ? (
                    <>
                      <Layers size={12} className="text-blue-400 shrink-0" />
                      <span className="font-bold text-gray-700 text-[12px]">Lô {lot.lotNumber}</span>
                      <span className="text-[11px] text-gray-500">· HSD {fmtDate(lot.expiry)}</span>
                      <span className="text-[11px] text-gray-500">· còn <b className="text-gray-700">{lot.available.toLocaleString('vi-VN')}</b> {prod.unit || ''}</span>
                      {lot.isVat
                        ? <span className="px-1 bg-emerald-50 text-emerald-700 rounded text-[9px] font-bold border border-emerald-200">HĐ đỏ</span>
                        : <span className="px-1 bg-gray-100 text-gray-500 rounded text-[9px] font-bold border border-gray-200">Không HĐ</span>}
                      {isFefoFirst && <span className="px-1 bg-blue-50 text-blue-600 rounded text-[9px] font-bold border border-blue-100">BÁN TRƯỚC</span>}
                      {expired && <span className="px-1 bg-red-50 text-red-600 rounded text-[9px] font-bold border border-red-100">QUÁ HẠN</span>}
                      {!expired && near && <span className="px-1 bg-amber-50 text-amber-700 rounded text-[9px] font-bold border border-amber-100">CẬN HẠN</span>}
                    </>
                  ) : (
                    <span className="text-[11px] text-gray-500 italic">Không có lô — bán theo tồn chung (FEFO)</span>
                  )}
                </div>
              </Fragment>
            )
          })}
          {searchLotEntries.length === 0 && (
            <div className="p-3 text-center text-gray-400 italic">Không tìm thấy sản phẩm.</div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <Layout activeMenu="Đơn hàng" hideTopBar searchElement={<span className="hidden" aria-hidden />}>
      <div className="flex flex-col h-screen overflow-hidden bg-gray-25 text-gray-600 font-sans">
        
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

        {/* Thanh trạng thái offline: ẩn khi online & không có đơn chờ/lỗi */}
        <PosOfflineBar
          online={online}
          pending={offlineQueue.pending}
          failed={offlineQueue.failed}
          syncing={offlineQueue.syncing}
          snapshotStale={snapshotInfo.stale}
          snapshotAt={snapshotInfo.at}
          onSyncNow={() => { void offlineQueue.flush() }}
          onDiscardFailed={(id) => { void offlineQueue.discard(id).then(() => offlineQueue.refresh()) }}
        />

        {/* KiotViet Blue Header — 2 hàng: (1) logo + tìm kiếm + thao tác · (2) tab hóa đơn */}
        <div className="shrink-0 shadow-md">
          {/* ── Hàng 1: Logo · Ô tìm kiếm + Số lượng · Nút thao tác ── */}
          <header className="h-12 bg-[#007edb] flex items-center gap-3 px-4 text-white">
            {/* Ô tìm kiếm sản phẩm + nhập số lượng (rộng, hiển thị rõ chữ) */}
            {productSearchBar}

            {/* Nút thao tác */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowDiagModal(true)}
                className="px-3 h-8 rounded bg-emerald-600 hover:bg-emerald-700 text-tiny font-bold flex items-center gap-1.5 transition-colors border border-emerald-700 shadow-sm whitespace-nowrap"
                title="Chẩn đoán nhanh và tự động gợi ý sản phẩm theo phác đồ [F7]"
              >
                <Stethoscope size={13} />
                <span className="hidden md:inline">Chẩn đoán &amp; Gợi ý</span>
                <span>(F7)</span>
              </button>
              <button
                onClick={() => setShowGrid(prev => !prev)}
                className="px-3 h-8 rounded bg-[#006cc0] hover:bg-[#005ba3] text-tiny font-bold flex items-center gap-1.5 transition-colors border border-[#005ba3] whitespace-nowrap"
              >
                <span>{showGrid ? 'Ẩn danh mục' : 'Xem danh mục'}</span>
              </button>
              <button
                onClick={() => setAutoPrint(prev => !prev)}
                className={`px-3 h-8 rounded text-tiny font-bold flex items-center gap-1.5 transition-colors border whitespace-nowrap ${
                  autoPrint ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-700' : 'bg-[#005ba3]/40 hover:bg-[#005ba3]/60 border-[#005ba3]'
                }`}
                title="Bật/tắt tự động mở bản in sau khi thanh toán"
              >
                <Printer size={13} />
                <span className="hidden lg:inline">{autoPrint ? 'Tự in: BẬT' : 'Tự in: TẮT'}</span>
              </button>
              <div className="flex items-center gap-2 border-l border-[#006cc0] pl-3 text-tiny">
                <User size={15} />
                <span className="font-semibold truncate max-w-[120px] hidden lg:inline">{profile?.full_name || profile?.email || 'N/A'}</span>
              </div>
            </div>
          </header>

          {/* ── Hàng 2: Danh sách tab hóa đơn (hạ xuống 1 dòng cho đủ không gian) ── */}
          <div className="h-9 bg-[#006cc0] flex items-end gap-1 px-4 overflow-x-auto flex-nowrap scrollbar-none">
            {tabs.map(tab => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-t-md text-[13px] font-bold cursor-pointer transition-all select-none shrink-0 ${
                  tab.id === activeTabId
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'bg-[#005ba3] text-blue-100 hover:bg-[#00529a]'
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
            <button
              onClick={handleAddTab}
              className="p-1.5 mb-1 rounded bg-[#005ba3] hover:bg-[#00529a] text-white flex items-center justify-center transition-colors shrink-0"
              title="Thêm hóa đơn mới"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Mobile: layout POS 3 panel không hợp điện thoại → điều hướng sang "Lên đơn di động" */}
        <div className="flex md:hidden flex-1 flex-col items-center justify-center gap-4 p-6 text-center bg-gray-25">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center"><Receipt size={30} /></div>
          <h2 className="text-lg font-bold text-gray-700">POS tối ưu cho máy tính &amp; máy tính bảng</h2>
          <p className="text-body-md text-gray-500 max-w-xs">Trên điện thoại, hãy dùng <b>Lên đơn di động</b> để thao tác nhanh và vừa màn hình.</p>
          <button onClick={() => navigate('/orders/mobile')} className="h-11 px-5 bg-blue-500 text-white rounded-lg font-semibold flex items-center gap-2 active:scale-95 transition-all shadow-sm">
            <Receipt size={18} /> Mở Lên đơn di động
          </button>
          <button onClick={() => navigate('/dashboard')} className="text-tiny text-gray-400 underline">Về trang chủ</button>
        </div>

        {/* Main Work Area (desktop/tablet) */}
        <div className="hidden md:flex flex-1 overflow-hidden">

          {/* Cart Table Panel: w-[75%] when grid is hidden, w-[45%] when grid is shown */}
          <div className={`flex flex-col p-3 border-r border-gray-150 overflow-hidden ${
            showGrid ? 'w-[45%]' : 'w-[75%]'
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
                  {cart.map((item, idx) => {
                    // Gợi ý KM cho dòng SP thường (không gợi ý trên chính dòng quà tặng).
                    // KM mua-X-tặng-Y không phụ thuộc đơn giá nên hiện cả khi đơn giá = 0.
                    const rowPromo = !item.isGift ? getTopPromo(item.product.id) : null
                    const promoEval = rowPromo ? evaluateProductPromo(rowPromo, item.quantity, item.unitPrice) : null
                    const giftProduct = promoEval
                      ? (products.find(p => p.id === promoEval.giftProductId) ?? item.product)
                      : null
                    // Bán DƯỚI GIÁ VỐN → tô đỏ cả dòng để NV thấy ngay trước khi thanh toán.
                    const below = getBelowCost(item)
                    return (
                    <Fragment key={item.id}>
                    <tr className={`border-b transition-colors ${
                      below
                        ? 'border-red-200 bg-red-50/70 hover:bg-red-50'
                        : 'border-gray-100 hover:bg-gray-50/50'
                    }`}>
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
                          {(item.isGift || item.unitPrice === 0) && (
                            <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-600 text-[9px] font-bold rounded border border-emerald-100 uppercase scale-90">KM</span>
                          )}
                          {below && (
                            <span className="px-1.5 py-0.5 bg-red-600 text-white text-[9px] font-bold rounded uppercase shrink-0 flex items-center gap-0.5">
                              <AlertTriangle size={9} /> Dưới giá vốn
                            </span>
                          )}
                        </div>
                        {below && (
                          <span className="text-[10px] font-bold text-red-600 block mt-0.5">
                            Giá vốn {below.cost.toLocaleString('vi-VN')} ₫ · lỗ {Math.round(below.lossPerUnit).toLocaleString('vi-VN')} ₫/{item.product.unit || 'đv'} — cả dòng lỗ {Math.round(below.lossTotal).toLocaleString('vi-VN')} ₫
                          </span>
                        )}
                        {/* Mỗi dòng = 1 LÔ cụ thể NV đã chọn. Hiện lô + HSD + cảnh báo cận/quá hạn
                            + chặn vượt tồn của ĐÚNG lô đó (so tồn tươi). KM/quà (không lô) bỏ qua. */}
                        {!item.isGift && (() => {
                          if (!item.lotId) {
                            return <span className="text-[10px] text-gray-400 italic block mt-0.5">Bán theo tồn chung (FEFO)</span>
                          }
                          const freshLot = (productLots[item.product.id] || []).find(l => l.lotId === item.lotId)
                          const avail = freshLot ? freshLot.available : 0
                          const nd = daysToExpiry(item.lotExpiry ?? null)
                          const expired = nd !== null && nd < 0
                          const near = nd !== null && nd >= 0 && nd <= NEAR_EXPIRY_DAYS
                          const over = item.quantity > avail
                          return (
                            <div className="mt-1 ml-0.5 pl-2 border-l-2 border-blue-100 flex flex-col gap-0.5">
                              <span className="text-[10px] flex items-center gap-1 flex-wrap text-gray-500">
                                <Layers size={10} className="text-gray-400 shrink-0" />
                                <span className="font-semibold text-gray-600">Lô {item.lotNumber || '—'}</span>
                                <span>· HSD {fmtDate(item.lotExpiry ?? null)}</span>
                                <span>· còn <b className={over ? 'text-red-600' : 'text-gray-700'}>{avail.toLocaleString('vi-VN')}</b> {item.product.unit || ''}</span>
                                {expired && <span className="px-1 bg-red-50 text-red-600 rounded text-[9px] font-bold border border-red-100">QUÁ HẠN</span>}
                                {!expired && near && <span className="px-1 bg-amber-50 text-amber-700 rounded text-[9px] font-bold border border-amber-100">CẬN HẠN</span>}
                              </span>
                              {over && (
                                <span className="text-[10px] font-bold text-red-600">⚠ Vượt tồn lô — thiếu {(item.quantity - avail).toLocaleString('vi-VN')} {item.product.unit || ''}</span>
                              )}
                            </div>
                          )
                        })()}
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
                        <div className="flex flex-col items-end gap-0.5">
                          <input
                            type="text"
                            value={formatNumberString(item.unitPrice || '')}
                            placeholder="0"
                            onChange={e => updateUnitPrice(item.id, parseNumberString(e.target.value))}
                            title={below ? `Đơn giá sau CK ${Math.round(below.effective).toLocaleString('vi-VN')} ₫ thấp hơn giá vốn ${below.cost.toLocaleString('vi-VN')} ₫` : undefined}
                            className={`w-20 text-right bg-transparent border-b focus:outline-none font-semibold text-[13px] py-0.5 ${
                              below
                                ? 'border-red-400 text-red-600 focus:border-red-600'
                                : 'border-gray-200 focus:border-[#007edb]'
                            }`}
                          />
                          {/* Giá bán gần nhất cho KH này (chỉ hiện sau khi chọn KH & khác giá hiện tại) */}
                          {!item.isGift && selectedCustomerId && lastPrices[item.product.id] != null && lastPrices[item.product.id] !== item.unitPrice && (
                            <button
                              type="button"
                              onClick={() => updateUnitPrice(item.id, lastPrices[item.product.id])}
                              className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline font-semibold whitespace-nowrap"
                              title="Dùng giá bán gần nhất cho khách này"
                            >
                              Gần nhất: {lastPrices[item.product.id].toLocaleString('vi-VN')}
                            </button>
                          )}
                        </div>
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
                      <td className={`py-3 px-3 text-right font-bold text-[13px] ${below ? 'text-red-600' : 'text-gray-750'}`}>
                        {((item.unitPrice * (1 - item.discountPercent / 100)) * item.quantity).toLocaleString('vi-VN')} ₫
                      </td>
                    </tr>
                    {promoEval && (() => {
                      const dismissed = Boolean(item.promoDismissed)
                      const applied = promoEval.eligible && !dismissed
                      const isBxgy = promoEval.promo.promo_type === 'buy_x_get_y'
                      return (
                        <tr className={`border-b ${applied ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/50'}`}>
                          <td colSpan={10} className="px-3 py-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className={`text-[11px] font-semibold flex items-center gap-1 ${applied ? 'text-emerald-800' : 'text-amber-800'}`}>
                                {applied ? '✅' : '🎁'} {rowPromo?.name}
                                {(() => {
                                  const isUnitPrice = promoEval.promo.promo_type === 'unit_price'
                                  // Giá ưu đãi: nói bằng GIÁ, không bằng % (% có thể lẻ, vd 4.5%).
                                  const dealPrice = promoEval.promo.discount_value.toLocaleString('vi-VN')
                                  if (dismissed) return ' — đã bỏ KM cho dòng này'
                                  if (applied) {
                                    if (isBxgy) {
                                      return ` — đã tặng ${promoEval.giftQty} ${giftProduct?.name ?? ''}`
                                        + (promoEval.giftPrice > 0
                                            ? ` (giá ưu đãi ${promoEval.giftPrice.toLocaleString('vi-VN')}₫)`
                                            : ' (miễn phí)')
                                    }
                                    if (isUnitPrice) return ` — đang bán giá ưu đãi ${dealPrice}₫/${item.product.unit || 'đv'}`
                                    return ` — đã giảm ${Math.round(promoEval.discountPercent)}% cho dòng này`
                                  }
                                  if (isBxgy) return ` — mua thêm ${promoEval.remaining} để nhận quà`
                                  if (isUnitPrice) return ` — mua thêm ${promoEval.remaining} để được giá ${dealPrice}₫`
                                  return ` — mua thêm ${promoEval.remaining} để được giảm`
                                })()}
                              </span>

                              {applied && (
                                <button
                                  onClick={() => setPromoDismissed(item.id, true)}
                                  className="px-2.5 py-1 text-[11px] font-bold text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 hover:text-red-600 hover:border-red-200 rounded shadow-sm active:scale-95 transition-all"
                                  title="Khách không lấy khuyến mãi này"
                                >
                                  Bỏ KM
                                </button>
                              )}
                              {dismissed && (
                                <button
                                  onClick={() => setPromoDismissed(item.id, false)}
                                  className="px-2.5 py-1 text-[11px] font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded shadow-sm active:scale-95 transition-all"
                                >
                                  Áp lại KM
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })()}
                    </Fragment>
                    )
                  })}
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
            <div className="mt-3 shrink-0 bg-white border border-gray-150 p-2.5 rounded shadow-sm space-y-2">
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
                    {([['quick', 'Bán nhanh'], ['delivery', 'Bán giao hàng']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSalesMode(mode)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${
                          salesMode === mode ? 'bg-[#007edb] text-white shadow-sm' : 'text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Địa chỉ giao — chỉ hiện khi bán giao hàng */}
              {salesMode === 'delivery' && (
                <input
                  type="text"
                  placeholder="Địa chỉ giao hàng (tùy chọn)..."
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  className="w-full h-8 px-2 border border-gray-200 rounded text-tiny focus:outline-none focus:border-[#007edb] placeholder-gray-400"
                />
              )}
            </div>
          </div>

          {/* Product Catalog Grid Panel: w-[35%] (only shown when showGrid is true) */}
          {showGrid && (
            <div className="w-[30%] flex flex-col p-3 border-r border-gray-150 overflow-hidden bg-gray-50/50">
              
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
                          const cardPromo = getTopPromo(prod.id)
                          return (
                            <div
                              key={prod.id}
                              onClick={() => addToCart(prod)}
                              className="bg-white border border-gray-100 hover:border-[#007edb] hover:shadow-sm rounded p-2 flex flex-col justify-between cursor-pointer transition-all active:scale-[0.97] relative"
                            >
                              {cardPromo && (
                                <span
                                  className="absolute top-1 right-1 z-10 px-1.5 py-0.5 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-[9px] font-bold rounded-full shadow-sm flex items-center gap-0.5"
                                  title={cardPromo.name}
                                >
                                  🎁 {promoShortLabel(cardPromo)}
                                </span>
                              )}
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

          {/* Right Sidebar Checkout: w-[25%] - Sticky Bottom Layout */}
          <aside className="w-[25%] bg-white flex flex-col shadow-lg border-l border-gray-150 overflow-hidden h-full">

            {/* Khối VÀNG: thông tin KH + bảng giá + thanh toán — chiếm ~50% chiều cao, cuộn riêng nếu thừa */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
              
              {/* Customer Selector */}
              <div className="relative" ref={customerBoxRef}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Khách hàng</label>
                  <button
                    type="button"
                    onClick={() => { setNewCustName(customerSearchQuery.trim()); setNewCustPhone(''); setShowAddCustomer(true) }}
                    className="flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:text-blue-800"
                    title="Thêm khách hàng mới"
                  >
                    <Plus size={12} /> Thêm KH
                  </button>
                </div>
                <div className="relative">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input
                    type="text"
                    placeholder="Tìm khách: tên, mã, SĐT..."
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
                        className="w-full text-left px-2.5 py-1.5 hover:bg-gray-50 flex items-center justify-between gap-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-gray-800 truncate">{cust.farm_name}</span>
                          {cust.primary_phone && (
                            <span className="block text-[10px] text-gray-500 font-mono truncate">{cust.primary_phone}</span>
                          )}
                        </span>
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
                <div className="flex flex-col gap-1.5 text-[11px] bg-gray-50 p-2 rounded border border-gray-155">
                  {/* Dòng 1: Hạng + Mã KH (trái) · SĐT (phải) */}
                  <div className="flex justify-between items-center gap-2">
                    <span className="flex items-center gap-1 min-w-0">
                      <span className={`px-1 py-0.2 text-[8px] font-bold rounded uppercase shrink-0 ${
                        selectedCustomer.value_tier === 'vip' ? 'bg-[#007edb] text-white' : 'bg-gray-200 text-gray-600'
                      }`}>
                        {selectedCustomer.value_tier || '-'}
                      </span>
                      <span className="text-[9px] font-mono text-gray-500 truncate">{selectedCustomer.code || 'N/A'}</span>
                    </span>
                    {customerDetail?.phone ? (
                      <a href={`tel:${customerDetail.phone}`} className="font-bold text-blue-600 hover:underline truncate shrink-0">📞 {customerDetail.phone}</a>
                    ) : (
                      <span className="text-gray-400 italic shrink-0">SĐT: —</span>
                    )}
                  </div>
                  {/* Dòng 2: Địa chỉ — chiếm trọn bề ngang, tự xuống dòng khi dài */}
                  <div className="flex gap-1.5">
                    <span className="text-gray-400 shrink-0">Địa chỉ:</span>
                    <span className="font-medium text-gray-700 break-words min-w-0" title={customerDetail?.address || ''}>
                      {customerDetail?.address || <span className="text-gray-400 italic">—</span>}
                    </span>
                  </div>
                  {/* Dòng 3: Nợ hiện tại (trái) · Hạn mức nợ + sửa (phải, RPC có audit;
                      KH chưa có hạn mức (=0) tô đỏ nhắc thiết lập để bán ghi nợ) */}
                  <div className="flex justify-between items-center gap-2 pt-0.5 border-t border-gray-200/70">
                    <span className="min-w-0">
                      <span className="text-gray-400">Nợ: </span>
                      <span className="font-bold text-gray-700">{formatCurrency(customerDebt)}</span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                    <span className="text-gray-400">HM:</span>
                    {editingCreditLimit ? (
                      <span className="flex items-center gap-1">
                        <input
                          autoFocus
                          type="text"
                          inputMode="numeric"
                          value={creditLimitInput}
                          onChange={e => setCreditLimitInput(formatNumberString(parseNumberString(e.target.value)))}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveCreditLimit(); if (e.key === 'Escape') setEditingCreditLimit(false) }}
                          className="w-20 h-6 text-right px-1 border border-gray-300 rounded text-[11px] font-bold focus:outline-none focus:border-[#007edb]"
                        />
                        <button
                          onClick={handleSaveCreditLimit}
                          disabled={savingCreditLimit}
                          className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40"
                          title="Lưu hạn mức (Enter)"
                        >
                          {savingCreditLimit ? <RefreshCw size={13} className="animate-spin" /> : <Check size={14} />}
                        </button>
                        <button
                          onClick={() => setEditingCreditLimit(false)}
                          disabled={savingCreditLimit}
                          className="text-gray-400 hover:text-red-500 disabled:opacity-40"
                          title="Hủy (Esc)"
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => { setCreditLimitInput(formatNumberString(selectedCustomer.credit_limit || 0)); setEditingCreditLimit(true) }}
                        className="flex items-center gap-1 group"
                        title="Bấm để sửa hạn mức nợ"
                      >
                        <span className={`font-bold ${selectedCustomer.credit_limit > 0 ? 'text-gray-700' : 'text-red-500'}`}>
                          {selectedCustomer.credit_limit > 0 ? formatCurrency(selectedCustomer.credit_limit) : 'Chưa thiết lập'}
                        </span>
                        <svg className="w-3 h-3 text-gray-400 group-hover:text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                      </button>
                    )}
                    </span>
                  </div>
                </div>
              )}

              {/* Price List Selector — bỏ nhãn (NV tự hiểu đây là bảng giá áp dụng) */}
              <div>
                <select
                  value={selectedPriceListId}
                  title="Bảng giá áp dụng"
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

              {/* Payment Method Selector — hàng ngang 3 nút (dùng nhiều, hiện sẵn không cuộn) */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Hình thức thanh toán</span>
                <div className="grid grid-cols-3 gap-1 p-0.5 bg-gray-100 border border-gray-200 rounded">
                  {([
                    ['cash', 'Tiền mặt', 'F3'],
                    ['bank_transfer', 'Chuyển khoản', 'F4'],
                    ['credit', 'Ghi nợ', 'F8'],
                  ] as const).map(([method, label, key]) => (
                    <button
                      key={method}
                      onClick={() => setPaymentMethod(method)}
                      className={`flex flex-col items-center justify-center py-1.5 rounded text-[11px] font-bold leading-tight transition-all text-center ${
                        paymentMethod === method ? 'bg-[#007edb] text-white shadow-sm' : 'text-gray-505 hover:text-gray-800'
                      }`}
                      title={`Phím tắt: ${key}`}
                    >
                      <span>{label}</span>
                      <span className={`text-[8px] font-semibold ${paymentMethod === method ? 'text-blue-100' : 'text-gray-400'}`}>{key}</span>
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* Khối ĐỎ (phần tính tiền): chiếm ~50% chiều cao, cuộn riêng nếu thừa */}
            <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-200 bg-gray-50 p-3 space-y-2">

              {/* Tổng tiền + Mã Voucher trên CÙNG 1 dòng (đã bỏ "Giảm giá HĐ" thủ công) */}
              <div className="flex items-end justify-between gap-2">
                <div className="shrink-0">
                  <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider mb-0.5">Tổng tiền</span>
                  <div className="font-bold text-gray-700 text-[13px]">{subtotal.toLocaleString('vi-VN')} ₫</div>
                </div>
                {appliedDiscount ? (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 flex-1 min-w-0">
                    <span className="text-[10px] font-medium text-green-700 truncate">{appliedDiscount.label}</span>
                    <button onClick={clearDiscount} className="ml-1 text-green-600 hover:text-green-800 shrink-0"><X size={12} /></button>
                  </div>
                ) : (
                  <div className="flex gap-1 flex-1 min-w-0">
                    <input
                      type="text"
                      value={voucherCode}
                      onChange={e => { setVoucherCode(e.target.value.toUpperCase()); setVoucherError('') }}
                      onKeyDown={e => e.key === 'Enter' && handleApplyVoucher()}
                      placeholder="Mã voucher"
                      className="flex-1 min-w-0 h-7 px-2 border border-gray-200 rounded text-[11px] focus:outline-none focus:border-[#007edb] uppercase"
                    />
                    <button
                      onClick={handleApplyVoucher}
                      className="px-2 h-7 bg-orange-500 text-white text-[10px] font-bold rounded hover:bg-orange-600 transition-colors shrink-0"
                    >
                      Áp
                    </button>
                  </div>
                )}
              </div>
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

                  {/* Khách trả DƯ → cho chọn: trả lại khách (mặc định) hoặc ghi có công nợ */}
                  {changeDue > 0 ? (
                    <div className="pt-1.5 border-t border-dashed border-gray-200 space-y-1.5">
                      <div className="flex justify-between items-center text-[12px] font-bold">
                        <span>{overpayToCredit ? 'Ghi có công nợ' : 'Tiền thừa trả khách'}</span>
                        <span className={overpayToCredit ? 'text-blue-600 text-[13px]' : 'text-emerald-600 text-[13px]'}>
                          {changeDue.toLocaleString('vi-VN')} ₫
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 p-0.5 bg-gray-100 border border-gray-200 rounded">
                        {([
                          [false, 'Trả khách'],
                          [true, 'Tính vào công nợ'],
                        ] as const).map(([val, label]) => (
                          <button
                            key={String(val)}
                            type="button"
                            onClick={() => setOverpayToCredit(val)}
                            className={`py-1 rounded text-[10px] font-bold transition-all text-center ${
                              overpayToCredit === val ? 'bg-[#007edb] text-white shadow-sm' : 'text-gray-505 hover:text-gray-800'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {overpayToCredit && (
                        <p className="text-[10px] text-blue-600 leading-tight">
                          Phần dư {changeDue.toLocaleString('vi-VN')} ₫ trừ vào nợ cũ; nếu khách không nợ sẽ thành số dư có (nợ âm) cho lần mua sau.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex justify-between items-center text-[12px] font-bold pt-1.5 border-t border-dashed border-gray-200">
                      <span>{debtAmount > 0 ? 'Ghi nợ' : 'Tiền thừa'}</span>
                      <span className={debtAmount > 0 ? 'text-red-600 text-[13px]' : 'text-emerald-600 text-[13px]'}>
                        {(debtAmount > 0 ? debtAmount : changeDue).toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Footer GHIM — cảnh báo + nút Thanh toán LUÔN hiển thị (không cuộn) */}
            <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-3 py-2 space-y-2 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">

              {/* Cảnh báo vượt hạn mức — khi có phần ghi nợ vượt hạn mức (mọi PTTT) */}
              {isCreditLimitExceeded && (
                <div className="pt-1">
                  <div className="flex items-start gap-1.5 p-2 bg-red-50 text-red-800 rounded border border-red-100">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div className="text-[10px] leading-tight">
                      <span className="font-bold">Vượt hạn mức nợ!</span> Phần ghi nợ {debtAmount.toLocaleString('vi-VN')} ₫ vượt hạn mức còn lại.
                    </div>
                  </div>
                </div>
              )}

              {/* Cảnh báo thiếu tồn kho — chặn bán cả 2 chế độ */}
              {oversellLines.length > 0 && (
                <div className="pt-1">
                  <div className="flex items-start gap-1.5 p-2 bg-red-50 text-red-800 rounded border border-red-100">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div className="text-[10px] leading-tight">
                      <span className="font-bold">Không đủ tồn kho!</span>{' '}
                      {oversellLines.map(l => `${l.label} (cần ${l.req.toLocaleString('vi-VN')}, còn ${l.avail.toLocaleString('vi-VN')})`).join('; ')}
                    </div>
                  </div>
                </div>
              )}

              {/* Cảnh báo bán dưới giá vốn — CHỈ cảnh báo, không chặn bán (có ca bán lỗ có chủ đích) */}
              {belowCostLines.length > 0 && (
                <div className="pt-1">
                  <div className="flex items-start gap-1.5 p-2 bg-red-50 text-red-800 rounded border border-red-200">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div className="text-[10px] leading-tight">
                      <span className="font-bold">Bán dưới giá vốn!</span>{' '}
                      {belowCostLines.length} mặt hàng ({belowCostLines.map(r => r.item.product.name).join('; ')}) — tổng lỗ{' '}
                      <b>{Math.round(belowCostTotalLoss).toLocaleString('vi-VN')} ₫</b>.
                    </div>
                  </div>
                </div>
              )}

              {/* Nút thanh toán / tạo đơn — thích ứng theo chế độ bán */}
              <div>
                <button
                  id="btn-pos-pay"
                  onClick={handlePayment}
                  disabled={submitting || cart.length === 0 || oversellLines.length > 0 || (salesMode === 'quick' && isCreditLimitExceeded)}
                  className={`w-full h-10 rounded font-bold text-[13px] flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all shadow disabled:opacity-50 text-white ${
                    salesMode === 'delivery' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {salesMode === 'delivery' ? (
                    <><Package size={14} /> Tạo đơn giao hàng (F9)</>
                  ) : (
                    <>{autoPrint ? <Printer size={14} /> : <CheckCircle2 size={14} />} {autoPrint ? 'Thanh toán & In (F9)' : 'Thanh toán (F9)'}</>
                  )}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Modal thêm nhanh khách hàng */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !addingCustomer && setShowAddCustomer(false)}>
          <div className="bg-white w-full max-w-sm rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 bg-[#007edb] text-white flex items-center justify-between">
              <h3 className="font-bold text-body-md flex items-center gap-2"><User size={18} /> Thêm khách hàng mới</h3>
              <button onClick={() => setShowAddCustomer(false)} className="text-white hover:text-blue-100"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Tên khách / trại <span className="text-red-500">*</span></label>
                <input
                  autoFocus
                  type="text"
                  value={newCustName}
                  onChange={e => setNewCustName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleQuickAddCustomer()}
                  placeholder="VD: Trại heo anh Tư"
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-[14px] focus:outline-none focus:border-[#007edb]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Số điện thoại</label>
                <input
                  type="tel"
                  value={newCustPhone}
                  onChange={e => setNewCustPhone(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleQuickAddCustomer()}
                  placeholder="(tùy chọn)"
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-[14px] focus:outline-none focus:border-[#007edb]"
                />
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-25 border-t border-gray-100 grid grid-cols-2 gap-3">
              <button onClick={() => setShowAddCustomer(false)} disabled={addingCustomer} className="h-10 border border-gray-200 text-gray-700 rounded-lg text-body-md font-semibold hover:bg-gray-50 disabled:opacity-50">Hủy</button>
              <button onClick={handleQuickAddCustomer} disabled={addingCustomer || !newCustName.trim()} className="h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-body-md font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {addingCustomer ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />} Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal xác nhận thanh toán thành công */}
      {showReceiptModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200 text-[13px]">
            <div className="p-6 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <CheckCircle2 size={30} className="text-emerald-500" />
              </div>
              <h3 className="font-bold text-gray-800 text-body-md">Thanh toán thành công</h3>
              <p className="text-gray-500">
                Hóa đơn <span className="font-bold text-blue-600 font-mono">{createdOrderCode}</span> đã được ghi nhận và báo cáo sổ quỹ.
              </p>
            </div>
            <div className="p-5 bg-gray-25 border-t border-gray-100 grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowReceiptModal(false)}
                className="h-10 border border-gray-200 text-gray-700 rounded-lg text-body-md font-semibold hover:bg-gray-50 flex items-center justify-center gap-2"
              >
                Đóng
              </button>
              <button
                onClick={() => {
                  setShowReceiptModal(false)
                  if (createdOrderId) navigate(`/print-preview?type=invoice&id=${createdOrderId}`)
                }}
                disabled={!createdOrderId}
                className="h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-body-md font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Printer size={16} />
                Mở bản in
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
