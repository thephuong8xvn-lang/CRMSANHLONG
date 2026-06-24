import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  Edit,
  FileText,
  Plus,
  Award,
  Star,
  CreditCard,
  ShoppingCart,
  User,
  MapPin,
  Phone,
  Mail,
  Trash2,
  Calendar,
  X,
  ShieldAlert,
  Briefcase,
  CheckCircle,
  Home,
  PlusCircle,
  FileSpreadsheet,
  Activity,
  Layers,
  Settings,
  TrendingUp,
  AlertCircle,
  MessageSquare,
  PhoneCall,
  Video,
  Gift,
  BookOpen,
  Heart,
  Smile,
  Clock,
  ArrowRight,
  Percent,
  Zap,
  Wallet
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { logger } from '../../lib/logger'
import ExportDebtStatementModal from './ExportDebtStatementModal'
import CollectDebtModal from './CollectDebtModal'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import { useDisplaySettings, primaryPhone } from '../../contexts/DisplaySettingsContext'

// ─────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────
interface Profile {
  id: string
  full_name: string
  avatar_url?: string
  email: string
}

interface PriceList {
  id: string
  name: string
}

interface CustomerBusinessInfo {
  customer_id: string
  tax_code: string | null
  legal_name: string | null
  bank_name: string | null
  bank_account_no: string | null
  invoice_address: string | null
}

interface CustomerPersonalInfo {
  customer_id: string
  id_card_no: string | null
}

interface CustomerContact {
  id: string
  customer_id: string
  full_name: string
  role_at_farm?: string
  phone?: string
  email?: string
  zalo_id?: string
  is_primary: boolean
  is_decision_maker: boolean
  notes?: string
}

interface CustomerDebt {
  id: string
  amount: number
  due_date: string | null
  is_settled: boolean
  created_at: string
}

interface Order {
  id: string
  order_code: string
  created_at: string
  grand_total: number
  status: string
  payment_status: string
}

interface Farm {
  id: string
  customer_id: string
  name: string
  address: string | null
  area_sqm: number | null
  capacity_heads: number | null
  notes: string | null
  gps_lat: number | null
  gps_lng: number | null
}

interface Species {
  id: string
  name: string
}

interface Herd {
  id: string
  farm_id: string
  species_id: string
  name: string
  current_quantity: number
  breed: string | null
  avg_age_weeks: number | null
  entry_date: string | null
  is_active: boolean
  species?: Species | null
}

interface DiseaseHistory {
  id: string
  herd_id: string
  disease_id: string
  onset_date: string
  resolved_date: string | null
  affected_heads: number | null
  mortality_heads: number
  treatment: string | null
  notes: string | null
  disease?: {
    code: string
    name: string
    category: string
  } | null
  herd?: {
    id: string
    name: string
  } | null
}

interface ResistanceWarning {
  ingredientName: string
  alternativeName: string
  ordersCount: number
}

const INGREDIENT_ALTERNATIVES: Record<string, string> = {
  'Amoxicillin Trihydrate': 'Doxycycline Hyclate hoặc Florfenicol',
  'Colistin Sulfate': 'Apramycin hoặc Neomycin',
  'Tylosin Tartrate': 'Enrofloxacin hoặc Doxycycline Hyclate',
  'Enrofloxacin': 'Amoxicillin Trihydrate hoặc Florfenicol',
  'Florfenicol': 'Doxycycline Hyclate hoặc Amoxicillin Trihydrate',
  'Doxycycline Hyclate': 'Amoxicillin Trihydrate hoặc Florfenicol'
}

interface Customer {
  id: string
  code: string
  customer_type: string
  farm_name: string
  lifecycle_stage: string
  value_tier: string
  billing_mode: string
  billing_cycle_day: number | null
  price_list_id: string | null
  credit_limit: number
  province: string | null
  district: string | null
  address: string | null
  owner_user_id: string
  is_active: boolean
  created_at: string
  owner?: Profile | null
  price_list?: PriceList | null
  customer_business_info?: CustomerBusinessInfo | null
  customer_personal_info?: CustomerPersonalInfo | null
  customer_contacts?: CustomerContact[]
  customer_debts?: CustomerDebt[]
  orders?: Order[]
}

interface LedgerItem {
  id: string
  date: string
  code: string
  type: 'invoice' | 'payment' | 'return' | 'debt_adjustment'
  typeLabel: string
  value: number
  actualPaid: number
  debtImpact: number
  runningBalance: number
  notes: string
  refOrderId: string | null   // điều hướng → chi tiết đơn / phiếu trả
  // false = dòng phái sinh (Khách trả trước / Phải hoàn trả): tiền đã nằm ở dòng
  // thanh toán → KHÔNG cộng vào số dư, chỉ hiển thị thông tin.
  affectsBalance: boolean
}

interface Activity {
  id: string
  title: string
  content: string | null
  outcome: string | null
  scheduled_at: string | null
  created_at: string
  activity_type: { code: string; name: string; icon: string | null; color_hex: string } | null
  owner: { full_name: string } | null
}

interface ActivityType {
  id: string
  code: string
  name: string
  icon: string | null
  color_hex: string
}

interface Promotion {
  id: string
  name: string
  is_active: boolean
  end_date: string | null
}

interface TopProduct {
  name: string
  sku: string
  unit: string
  qty: number
  total: number
}

// ─────────────────────────────────────────────────────────────
// Labels and Colors
// ─────────────────────────────────────────────────────────────
const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  farm_household: 'Hộ chăn nuôi',
  farm_commercial: 'Trang trại lớn',
  dealer: 'Đại lý',
  enterprise: 'Doanh nghiệp',
  vet_clinic: 'Phòng khám',
  other: 'Khác'
}

const TIER_LABELS: Record<string, string> = {
  normal: 'Thường',
  vip: 'VIP',
  high_potential: 'Tiềm năng'
}

const LOCATION_DATA: Record<string, string[]> = {
  'Đồng Nai': ['Biên Hòa', 'Long Thành', 'Trảng Bom', 'Thống Nhất', 'Xuân Lộc', 'Cẩm Mỹ', 'Định Quán', 'Tân Phú', 'Nhơn Trạch'],
  'Hà Nội': ['Ba Vì', 'Ứng Hòa', 'Mỹ Đức', 'Chương Mỹ', 'Đông Anh', 'Sóc Sơn', 'Quốc Oai', 'Mê Linh', 'Thường Tín'],
  'Tiền Giang': ['Mỹ Tho', 'Chợ Gạo', 'Cai Lậy', 'Gò Công Tây', 'Gò Công Đông', 'Cái Bè', 'Châu Thành', 'Tân Phước'],
  'Bến Tre': ['Thành phố Bến Tre', 'Ba Tri', 'Mỏ Cày Nam', 'Mỏ Cày Bắc', 'Chợ Lách', 'Châu Thành', 'Giồng Trôm', 'Thạnh Phú', 'Bình Đại'],
  'Bình Dương': ['Thủ Dầu Một', 'Dĩ An', 'Thuận An', 'Bến Cát', 'Tân Uyên', 'Bàu Bàng', 'Dầu Tiếng', 'Phú Giáo'],
  'Lâm Đồng': ['Đà Lạt', 'Bảo Lộc', 'Đức Trọng', 'Đơn Dương', 'Lâm Hà', 'Di Linh', 'Cát Tiên', 'Đạ Tẻh'],
  'Long An': ['Tân An', 'Bến Lức', 'Đức Hòa', 'Cần Đước', 'Cần Giuộc', 'Thủ Thừa', 'Châu Thành', 'Thạnh Hóa']
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { formatCurrency, formatDate, formatPhone, maskData, hasFieldAccess } = useDisplaySettings()

  // Current user info for permission checks
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [userRoles, setUserRoles] = useState<string[]>([])

  // State
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [farms, setFarms] = useState<Farm[]>([])
  const [herds, setHerds] = useState<Herd[]>([])
  const [diseases, setDiseases] = useState<DiseaseHistory[]>([])
  const [speciesList, setSpeciesList] = useState<Species[]>([])
  const [diseaseDict, setDiseaseDict] = useState<{ id: string; name: string; code: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'tong-quan' | 'trai-dan' | 'don-hang' | 'chan-dung' | 'benh-an'>('tong-quan')
  const [subTab, setSubTab] = useState<'orders' | 'ledger'>('orders')
  const [ledgerItems, setLedgerItems] = useState<LedgerItem[]>([])

  // Drug resistance alerts state
  const [resistanceWarnings, setResistanceWarnings] = useState<ResistanceWarning[]>([])

  // State for Logging Disease
  const [isDiseaseModalOpen, setIsDiseaseModalOpen] = useState(false)
  const [diseaseHerdId, setDiseaseHerdId] = useState('')
  const [diseaseId, setDiseaseId] = useState('')
  const [diseaseOnsetDate, setDiseaseOnsetDate] = useState(new Date().toISOString().split('T')[0])
  const [diseaseResolvedDate, setDiseaseResolvedDate] = useState('')
  const [diseaseAffectedHeads, setDiseaseAffectedHeads] = useState('')
  const [diseaseMortalityHeads, setDiseaseMortalityHeads] = useState('0')
  const [diseaseTreatment, setDiseaseTreatment] = useState('')
  const [diseaseNotes, setDiseaseNotes] = useState('')
  const [submittingDisease, setSubmittingDisease] = useState(false)

  // Profiling States
  const [activities, setActivities] = useState<Activity[]>([])
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([])
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])

  // Quick Log form states
  const [logTitle, setLogTitle] = useState('')
  const [logTypeId, setLogTypeId] = useState('')
  const [logContent, setLogContent] = useState('')
  const [logOutcome, setLogOutcome] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])
  const [submittingLog, setSubmittingLog] = useState(false)

  // Lookup Lists for Editing
  const [priceLists, setPriceLists] = useState<{ id: string; name: string }[]>([])
  const [salesReps, setSalesReps] = useState<{ id: string; full_name: string }[]>([])
  const [classifications, setClassifications] = useState<{ code: string; name: string; is_active: boolean }[]>([])
  const [tiers, setTiers] = useState<{ code: string; name: string; is_active: boolean }[]>([])

  const classLabels = classifications.reduce<Record<string, string>>((acc, curr) => {
    acc[curr.code] = curr.name
    return acc
  }, {})

  const tierLabels = tiers.reduce<Record<string, string>>((acc, curr) => {
    acc[curr.code] = curr.name
    return acc
  }, {})

  // Modal control states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isContactModalOpen, setIsContactModalOpen] = useState(false)
  const [isFarmModalOpen, setIsFarmModalOpen] = useState(false)
  const [isHerdModalOpen, setIsHerdModalOpen] = useState(false)

  // Quick Add Contact Form State
  const [contactName, setContactName] = useState('')
  const [contactRole, setContactRole] = useState('Chủ trại')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactIsPrimary, setContactIsPrimary] = useState(false)
  const [contactIsDecision, setContactIsDecision] = useState(false)
  const [contactNotes, setContactNotes] = useState('')

  // Quick Add Farm Form State
  const [farmName, setFarmName] = useState('')
  const [farmAddress, setFarmAddress] = useState('')
  const [farmArea, setFarmArea] = useState('')
  const [farmCapacity, setFarmCapacity] = useState('')
  const [farmNotes, setFarmNotes] = useState('')
  const [farmLat, setFarmLat] = useState('')
  const [farmLng, setFarmLng] = useState('')

  // Edit Farm Form State
  const [isEditFarmModalOpen, setIsEditFarmModalOpen] = useState(false)
  const [editingFarm, setEditingFarm] = useState<Farm | null>(null)
  const [editFarmNameVal, setEditFarmNameVal] = useState('')
  const [editFarmAddressVal, setEditFarmAddressVal] = useState('')
  const [editFarmAreaVal, setEditFarmAreaVal] = useState('')
  const [editFarmCapacityVal, setEditFarmCapacityVal] = useState('')
  const [editFarmNotesVal, setEditFarmNotesVal] = useState('')
  const [editFarmLatVal, setEditFarmLatVal] = useState('')
  const [editFarmLngVal, setEditFarmLngVal] = useState('')

  // Quick Add Herd Form State
  const [herdName, setHerdName] = useState('')
  const [herdFarmId, setHerdFarmId] = useState('')
  const [herdSpeciesId, setHerdSpeciesId] = useState('')
  const [herdQty, setHerdQty] = useState('')
  const [herdBreed, setHerdBreed] = useState('')
  const [herdAge, setHerdAge] = useState('')
  const [herdEntryDate, setHerdEntryDate] = useState('')
  const [herdNotes, setHerdNotes] = useState('')

  // Edit Customer Form State
  const [editFarmName, setEditFarmName] = useState('')
  const [editType, setEditType] = useState('')
  const [editTier, setEditTier] = useState('')
  const [editCreditLimit, setEditCreditLimit] = useState(0)
  const [editPriceListId, setEditPriceListId] = useState('')
  const [editOwnerId, setEditOwnerId] = useState('')
  const [editProvince, setEditProvince] = useState('')
  const [editDistrict, setEditDistrict] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editIsActive, setEditIsActive] = useState(true)
  const [editGpsLat, setEditGpsLat] = useState('')
  const [editGpsLng, setEditGpsLng] = useState('')
  
  const [editTaxCode, setEditTaxCode] = useState('')
  const [editLegalName, setEditLegalName] = useState('')
  const [editBankName, setEditBankName] = useState('')
  const [editBankAccountNo, setEditBankAccountNo] = useState('')
  const [editIdCardNo, setEditIdCardNo] = useState('')

  const editProvinceOptions = useMemo(() => {
    return Object.keys(LOCATION_DATA).map(p => ({ value: p, label: p }))
  }, [])

  const editDistrictOptions = useMemo(() => {
    if (!editProvince) return []
    return (LOCATION_DATA[editProvince] || []).map(d => ({ value: d, label: d }))
  }, [editProvince])

  // Debt Adjustment State
  const [isAdjustDebtModalOpen, setIsAdjustDebtModalOpen] = useState(false)
  const [isExportDebtOpen, setIsExportDebtOpen] = useState(false)
  const [adjustType, setAdjustType] = useState<'increase' | 'decrease'>('increase')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustNotes, setAdjustNotes] = useState('')
  const [submittingAdjust, setSubmittingAdjust] = useState(false)
  const [adjustErrorMsg, setAdjustErrorMsg] = useState('')

  // Thu công nợ (Thanh toán)
  const [isCollectDebtModalOpen, setIsCollectDebtModalOpen] = useState(false)
  const [collectSuccessMsg, setCollectSuccessMsg] = useState('')

  // Load Data function
  const loadCustomerData = async () => {
    if (!id) return
    setLoading(true)
    try {
      // 1. Fetch customer details with related tables
      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select(`
          *,
          owner:profiles!owner_user_id(id, full_name, avatar_url, email),
          price_list:price_lists(id, name),
          customer_business_info(*),
          customer_personal_info(*),
          customer_contacts(*),
          customer_debts(*),
          orders(*)
        `)
        .eq('id', id)
        .single()

      if (custErr) throw custErr
      if (custData) {
        setCustomer(custData as unknown as Customer)
        
        // Seed edit form values
        setEditFarmName(custData.farm_name)
        setEditType(custData.customer_type)
        setEditTier(custData.value_tier)
        setEditCreditLimit(Number(custData.credit_limit || 0))
        setEditPriceListId(custData.price_list_id || '')
        setEditOwnerId(custData.owner_user_id)
         setEditProvince(custData.province || '')
        setEditDistrict(custData.district || '')
        setEditAddress(custData.address || '')
        setEditIsActive(custData.is_active)
        setEditGpsLat(custData.gps_lat ? String(custData.gps_lat) : '')
        setEditGpsLng(custData.gps_lng ? String(custData.gps_lng) : '')

        if (custData.customer_business_info) {
          setEditTaxCode(custData.customer_business_info.tax_code || '')
          setEditLegalName(custData.customer_business_info.legal_name || '')
          setEditBankName(custData.customer_business_info.bank_name || '')
          setEditBankAccountNo(custData.customer_business_info.bank_account_no || '')
        }
        if (custData.customer_personal_info) {
          setEditIdCardNo(custData.customer_personal_info.id_card_no || '')
        }
      }

      // 2. Fetch farms
      const { data: farmsData } = await supabase
        .from('farms')
        .select('*')
        .eq('customer_id', id)
      
      if (farmsData) {
        setFarms(farmsData)
        if (farmsData.length > 0) {
          setHerdFarmId(farmsData[0].id)
          const farmIds = farmsData.map((f: any) => f.id)
          
          // 3. Fetch herds for those farms
          const { data: herdsData } = await supabase
            .from('herds')
            .select(`
              *,
              species:species(id, name)
            `)
            .in('farm_id', farmIds)
          
          if (herdsData) {
            setHerds(herdsData as unknown as Herd[])
            if (herdsData.length > 0) setDiseaseHerdId(herdsData[0].id)
            
            // 4. Fetch disease history for those herds
            if (herdsData.length > 0) {
              const herdIds = herdsData.map((h: any) => h.id)
              const { data: diseasesData } = await supabase
                .from('disease_history')
                .select(`
                  *,
                  disease:disease_dictionary(id, code, name, category),
                  herd:herds(id, name)
                `)
                .in('herd_id', herdIds)
                .order('onset_date', { ascending: false })
              
              if (diseasesData) {
                setDiseases(diseasesData as unknown as DiseaseHistory[])
              }
            }
          }
        }
      }

      // 5. Fetch species list
      const { data: speciesData } = await supabase
        .from('species')
        .select('*')
      if (speciesData) {
        setSpeciesList(speciesData)
        if (speciesData.length > 0) setHerdSpeciesId(speciesData[0].id)
      }

      // 6. Fetch disease dictionary
      const { data: diseaseDictData } = await supabase
        .from('disease_dictionary')
        .select('id, code, name')
      if (diseaseDictData) {
        setDiseaseDict(diseaseDictData)
        if (diseaseDictData.length > 0) setDiseaseId(diseaseDictData[0].id)
      }

      // 7. Fetch activities
      const { data: activitiesData } = await supabase
        .from('activities')
        .select(`
          *,
          owner:profiles!owner_user_id(full_name),
          activity_type:activity_types(code, name, icon, color_hex)
        `)
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
      if (activitiesData) setActivities(activitiesData)

      // 8. Fetch activity types
      const { data: actTypes } = await supabase
        .from('activity_types')
        .select('*')
      if (actTypes) {
        setActivityTypes(actTypes)
        if (actTypes.length > 0) setLogTypeId(actTypes[0].id)
      }

      // 9. Fetch active promotions
      const { data: promos } = await supabase
        .from('promotions')
        .select('*')
        .eq('is_active', true)
      if (promos) setPromotions(promos)

      // 10. Fetch order lines for product profiling and drug resistance checking
      if (custData && custData.orders && custData.orders.length > 0) {
        const orderIds = custData.orders.map((o: any) => o.id)
        const { data: orderLinesData } = await supabase
          .from('order_lines')
          .select(`
            order_id,
            product_id,
            quantity,
            line_total,
            product:products(
              id,
              name,
              sku,
              unit,
              product_active_ingredients(
                active_ingredient_id,
                percentage_or_dosage,
                active_ingredient:active_ingredients(id, name, code)
              )
            )
          `)
          .in('order_id', orderIds)
        
        if (orderLinesData) {
          // 10.1 Top Products calculation
          const aggregation: Record<string, { name: string; sku: string; unit: string; qty: number; total: number }> = {}
          orderLinesData.forEach((line: any) => {
            const prod = line.product as any
            const prodId = line.product_id
            if (!prod) return
            if (!aggregation[prodId]) {
              aggregation[prodId] = {
                name: prod.name,
                sku: prod.sku || '',
                unit: prod.unit || 'lọ',
                qty: 0,
                total: 0
              }
            }
            aggregation[prodId].qty += Number(line.quantity || 0)
            aggregation[prodId].total += Number(line.line_total || 0)
          })

          const sorted = Object.values(aggregation)
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5)
          setTopProducts(sorted)

          // 10.2 Drug Resistance Warning check
          // Get unique non-cancelled orders of the customer
          const validOrders = custData.orders
            .filter((o: any) => o.status !== 'cancelled')
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) // Descending (latest first)
          
          if (validOrders.length >= 3) {
            // Get the last 3 orders
            const last3Orders = validOrders.slice(0, 3)
            
            // Map each order to its set of active ingredient IDs/names
            const orderIngredients: Array<Set<string>> = last3Orders.map((ord: any) => {
              const ingSet = new Set<string>()
              const lines = orderLinesData.filter((l: any) => l.order_id === ord.id)
              lines.forEach((l: any) => {
                const prod = l.product as any
                if (prod && prod.product_active_ingredients) {
                  prod.product_active_ingredients.forEach((pa: any) => {
                    if (pa.active_ingredient) {
                      ingSet.add(pa.active_ingredient.name)
                    }
                  })
                }
              })
              return ingSet
            })

            // Find intersection of ingredients in last 3 orders
            const warnings: ResistanceWarning[] = []
            if (orderIngredients.length === 3) {
              const firstSet = orderIngredients[0]
              firstSet.forEach((ingName) => {
                if (orderIngredients[1].has(ingName) && orderIngredients[2].has(ingName)) {
                  // Found an ingredient used in all 3 latest orders!
                  const alt = INGREDIENT_ALTERNATIVES[ingName] || 'hoạt chất thay thế thuộc nhóm khác'
                  warnings.push({
                    ingredientName: ingName,
                    alternativeName: alt,
                    ordersCount: 3
                  })
                }
              })
            }
            setResistanceWarnings(warnings)
          } else {
            setResistanceWarnings([])
          }
        }
      } else {
        setTopProducts([])
        setResistanceWarnings([])
      }

      // 11. Fetch detailed ledger data (sales returns, order payments, debt payments)
      const orderIds = custData.orders?.map((o: any) => o.id) || []
      let returnsData: any[] = []
      let orderPaymentsData: any[] = []
      let debtPaymentsData: any[] = []

      if (orderIds.length > 0) {
        const { data: rData } = await supabase
          .from('sales_returns')
          .select('*')
          .in('order_id', orderIds)
        if (rData) returnsData = rData

        const { data: opData } = await supabase
          .from('order_payments')
          .select('*')
          .in('order_id', orderIds)
        if (opData) orderPaymentsData = opData
      }

      const { data: dpData } = await supabase
        .from('debt_payments')
        .select('*')
        .eq('customer_id', id)
      if (dpData) debtPaymentsData = dpData

      const orderCodeMap = new Map<string, string>()
      custData.orders?.forEach((o: any) => {
        orderCodeMap.set(o.id, o.order_code)
      })

      const items: LedgerItem[] = []

      // 1. Orders
      if (custData.orders) {
        custData.orders.forEach((o: any) => {
          if (o.status !== 'draft' && o.status !== 'cancelled') {
            items.push({
              id: o.id,
              date: o.created_at,
              code: o.order_code,
              type: 'invoice',
              typeLabel: 'Hóa đơn lẻ',
              value: Number(o.grand_total || 0),
              actualPaid: 0,
              debtImpact: Number(o.grand_total || 0),
              notes: o.notes || 'Hóa đơn mua hàng',
              runningBalance: 0,
              refOrderId: o.id,
              affectsBalance: true
            })
          }
        })
      }

      // 2. Order Payments
      orderPaymentsData.forEach((op: any) => {
        const oCode = orderCodeMap.get(op.order_id) || 'Đơn hàng'
        items.push({
          id: op.id,
          date: op.payment_date || op.created_at,
          code: op.reference_no || `PT-${oCode}`,
          type: 'payment',
          typeLabel: op.payment_method === 'cash' ? 'Thu tiền mặt' : 'Thu chuyển khoản',
          value: 0,
          actualPaid: Number(op.amount || 0),
          debtImpact: -Number(op.amount || 0),
          notes: op.notes || `Thanh toán cho đơn hàng ${oCode}`,
          runningBalance: 0,
          refOrderId: op.order_id || null,
          affectsBalance: true
        })
      })

      // 3. Debt Payments
      debtPaymentsData.forEach((dp: any) => {
        items.push({
          id: dp.id,
          date: dp.payment_date || dp.created_at,
          code: dp.reference_no || 'PT-KH',
          type: 'payment',
          typeLabel: dp.payment_method === 'cash' ? 'Thu nợ mặt' : 'Thu nợ chuyển khoản',
          value: 0,
          actualPaid: Number(dp.amount || 0),
          debtImpact: -Number(dp.amount || 0),
          notes: dp.notes || 'Khách hàng thanh toán nợ',
          runningBalance: 0,
          refOrderId: null,
          affectsBalance: true
        })
      })

      // 4. Sales Returns
      returnsData.forEach((r: any) => {
        const oCode = orderCodeMap.get(r.order_id) || 'Đơn hàng'
        const isCreditNote = r.refund_method === 'credit_note'
        items.push({
          id: r.id,
          date: r.created_at,
          code: r.return_code,
          type: 'return',
          typeLabel: 'Trả hàng',
          value: -Number(r.total_amount || 0),
          actualPaid: isCreditNote ? 0 : Number(r.total_amount || 0),
          debtImpact: isCreditNote ? -Number(r.total_amount || 0) : 0,
          notes: r.reason || `Khách trả hàng cho đơn ${oCode}`,
          runningBalance: 0,
          refOrderId: r.order_id || null,
          affectsBalance: true
        })
      })

      // 5. Customer Debts không gắn đơn:
      //    • order_debt (order_id NULL) = điều chỉnh thủ công → ảnh hưởng số dư.
      //    • advance_from_customer / refund_due = bút toán phái sinh của thanh
      //      toán (tiền đã nằm ở dòng thu) → hiển thị THÔNG TIN, không cộng số dư
      //      (tránh đếm trùng — lỗi dư nợ sai trước đây).
      if (custData.customer_debts) {
        custData.customer_debts.forEach((cd: any) => {
          if (!cd.order_id || cd.debt_type !== 'order_debt') {
            const isManualAdjust = cd.debt_type === 'order_debt' // tới đây ⇒ order_id NULL
            let label = 'Điều chỉnh nợ'
            if (cd.debt_type === 'advance_from_customer') label = 'Khách trả trước'
            else if (cd.debt_type === 'refund_due') label = 'Phải hoàn trả'

            items.push({
              id: cd.id,
              date: cd.created_at,
              code: `DC-${cd.id.substring(0, 8).toUpperCase()}`,
              type: 'debt_adjustment',
              typeLabel: label,
              value: isManualAdjust ? Number(cd.amount || 0) : 0,
              actualPaid: 0,
              debtImpact: Number(cd.amount || 0),
              notes: cd.notes || 'Điều chỉnh số dư nợ',
              runningBalance: 0,
              refOrderId: null,
              affectsBalance: isManualAdjust
            })
          }
        })
      }

      // Sort earliest first to compute running balance. Tie-break ổn định:
      // dòng ảnh hưởng số dư trước dòng thông tin, ghi nợ trước ghi có.
      items.sort((a, b) => {
        const dt = new Date(a.date).getTime() - new Date(b.date).getTime()
        if (dt !== 0) return dt
        if (a.affectsBalance !== b.affectsBalance) return a.affectsBalance ? -1 : 1
        return b.debtImpact - a.debtImpact
      })
      let runningSum = 0
      const itemsWithBalance = items.map(item => {
        if (item.affectsBalance) runningSum += item.debtImpact
        return {
          ...item,
          runningBalance: runningSum
        }
      })

      // Sort latest first for display
      itemsWithBalance.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      setLedgerItems(itemsWithBalance)

    } catch (err) {
      console.error('Error loading customer details:', err)
    } finally {
      setLoading(false)
    }
  }

  // Load lookup data for editing
  const loadLookupData = async () => {
    try {
      const { data: plist } = await supabase
        .from('price_lists')
        .select('id, name')
        .eq('is_active', true)
      if (plist) setPriceLists(plist)

      const reps = await fetchAllRows<{ id: string; full_name: string }>((from, to) =>
        supabase.from('profiles').select('id, full_name').eq('is_active', true)
          .order('full_name', { ascending: true }).order('id').range(from, to)
      )
      if (reps) setSalesReps(reps)

      const { data: classList } = await supabase
        .from('customer_classifications')
        .select('code, name, is_active')
      if (classList) setClassifications(classList)

      const { data: tierList } = await supabase
        .from('customer_tiers')
        .select('code, name, is_active')
      if (tierList) setTiers(tierList)
    } catch (err) {
      console.error('Error loading lookups:', err)
    }
  }

  // Load current user session for permission checks
  useEffect(() => {
    const loadCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setCurrentUserId(user.id)
        // Load roles
        const { data: rolesData, error: rolesErr } = await supabase
          .from('user_roles')
          .select('roles(code)')
          .eq('user_id', user.id)
        if (rolesErr) {
          console.warn('[CustomerDetail] Error loading user roles:', rolesErr.message)
        }
        if (rolesData) {
          const codes = rolesData.map((r: any) => r.roles?.code).filter(Boolean)
          logger.debug('[CustomerDetail] User roles loaded:', codes)
          setUserRoles(codes)
        } else {
          console.warn('[CustomerDetail] No roles data returned for user:', user.id)
        }
      } else {
        console.warn('[CustomerDetail] No authenticated user found')
      }
    }
    loadCurrentUser()
  }, [])

  useEffect(() => {
    loadCustomerData()
    loadLookupData()
  }, [id])

  // Formatting VND helper
  const formatVND = (num: number) => {
    return formatCurrency(num)
  }

  // Quick activity log submit handler
  const handleAddQuickLog = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !logTitle.trim() || !logTypeId) return

    // Get current profile
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('Vui lòng đăng nhập lại.')
      return
    }

    setSubmittingLog(true)
    try {
      const { error } = await supabase
        .from('activities')
        .insert({
          customer_id: id,
          title: logTitle.trim(),
          activity_type_id: logTypeId,
          content: logContent.trim() || null,
          outcome: logOutcome.trim() || null,
          status: 'done', // completed journal entry
          scheduled_at: new Date(logDate).toISOString(),
          completed_at: new Date(logDate).toISOString(),
          owner_user_id: user.id
        })

      if (error) throw error

      // Reset form
      setLogTitle('')
      setLogContent('')
      setLogOutcome('')
      setLogDate(new Date().toISOString().split('T')[0])
      
      // Reload activities
      const { data: newActs } = await supabase
        .from('activities')
        .select(`
          *,
          owner:profiles!owner_user_id(full_name),
          activity_type:activity_types(code, name, icon, color_hex)
        `)
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
      if (newActs) setActivities(newActs)

    } catch (err: any) {
      console.error('Error adding quick activity log:', err)
      alert('Không thể tạo nhật ký: ' + err.message)
    } finally {
      setSubmittingLog(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Calculated KPIs
  // ─────────────────────────────────────────────────────────────
  const getCalculatedStats = () => {
    if (!customer) return { totalDebt: 0, isOverdue: false, lifetimeSpend: 0, reputationScore: 95 }
    
    const todayStr = new Date().toISOString().split('T')[0]
    let totalDebt = 0
    let overdueCount = 0
    let isOverdue = false

    if (customer.customer_debts && customer.customer_debts.length > 0) {
      customer.customer_debts.forEach(debt => {
        if (!debt.is_settled) {
          totalDebt += Number(debt.amount || 0)
          if (debt.due_date && debt.due_date < todayStr) {
            isOverdue = true
            overdueCount++
          }
        }
      })
    }

    let lifetimeSpend = 0
    if (customer.orders && customer.orders.length > 0) {
      customer.orders.forEach(order => {
        if (order.status !== 'cancelled') {
          lifetimeSpend += Number(order.grand_total || 0)
        }
      })
    }

    // Dynamic reputation score: starts at 95, subtracts 15 for each unpaid overdue debt, min 50.
    const reputationScore = Math.max(50, 95 - overdueCount * 15)

    return { totalDebt, isOverdue, lifetimeSpend, reputationScore }
  }

  const { totalDebt, isOverdue, lifetimeSpend, reputationScore } = useMemo(() => getCalculatedStats(), [customer])

  // ─────────────────────────────────────────────────────────────
  // Debt Aging Calculation
  // ─────────────────────────────────────────────────────────────
  const getDebtAgingData = () => {
    let age30 = 0
    let age60 = 0
    let age90 = 0
    let ageOver90 = 0

    if (customer?.customer_debts && customer.customer_debts.length > 0) {
      const today = new Date()
      customer.customer_debts.forEach(debt => {
        if (!debt.is_settled) {
          const creationDate = new Date(debt.created_at || debt.due_date || today)
          const diffTime = Math.abs(today.getTime() - creationDate.getTime())
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
          const amt = Number(debt.amount || 0)

          if (diffDays <= 30) age30 += amt
          else if (diffDays <= 60) age60 += amt
          else if (diffDays <= 90) age90 += amt
          else ageOver90 += amt
        }
      })
    }



    return [
      { name: '0-30 ngày', amount: age30, display: `${(age30 / 1000000).toFixed(1)}M`, color: '#0E6646' },
      { name: '31-60 ngày', amount: age60, display: `${(age60 / 1000000).toFixed(1)}M`, color: '#54606d' },
      { name: '61-90 ngày', amount: age90, display: `${(age90 / 1000000).toFixed(1)}M`, color: '#1E5A9C' },
      { name: '90+ ngày', amount: ageOver90, display: `${(ageOver90 / 1000000).toFixed(1)}M`, color: '#BA1A1A' }
    ]
  }

  const agingData = useMemo(() => getDebtAgingData(), [customer])

  // ─────────────────────────────────────────────────────────────
  // Action Handlers
  // ─────────────────────────────────────────────────────────────
  // Add Contact Handler
  // Helper: check if current user can edit this customer
  const canEditCustomer = () => {
    if (!customer || !currentUserId) return false
    const isAdmin = userRoles.includes('admin') || userRoles.includes('ceo')
    const isBranchManager = userRoles.includes('branch_manager')
    const isTeamLead = userRoles.includes('team_lead')
    const isOwner = customer.owner_user_id === currentUserId
    return isAdmin || isBranchManager || isTeamLead || isOwner
  }

  const canAdjustDebt = () => {
    if (!currentUserId) return false
    return userRoles.some(r => ['admin', 'ceo', 'accountant', 'branch_manager', 'team_lead', 'sales'].includes(r))
  }

  // Thu công nợ (tiền thật vào sổ quỹ) — siết quyền hơn điều chỉnh nợ.
  const canCollectDebt = () => {
    if (!currentUserId) return false
    return userRoles.some(r => ['admin', 'ceo', 'accountant', 'branch_manager'].includes(r))
  }

  const handleAdjustDebt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !canAdjustDebt()) {
      setAdjustErrorMsg('Bạn không có quyền điều chỉnh công nợ.')
      return
    }

    const amountNum = Number(adjustAmount)
    if (isNaN(amountNum) || amountNum === 0) {
      setAdjustErrorMsg('Số tiền điều chỉnh phải khác 0.')
      return
    }

    if (!adjustNotes.trim()) {
      setAdjustErrorMsg('Vui lòng nhập lý do điều chỉnh.')
      return
    }

    setSubmittingAdjust(true)
    setAdjustErrorMsg('')

    try {
      const finalAmount = adjustType === 'increase' ? Math.abs(amountNum) : -Math.abs(amountNum)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Người dùng chưa đăng nhập.')

      const { error } = await supabase
        .from('customer_debts')
        .insert([{
          customer_id: id,
          order_id: null,
          debt_type: 'order_debt',
          amount: finalAmount,
          due_date: null,
          is_settled: false,
          notes: adjustNotes.trim(),
          created_by: user.id
        }])

      if (error) throw error

      setAdjustAmount('')
      setAdjustNotes('')
      setIsAdjustDebtModalOpen(false)

      await loadCustomerData()
    } catch (err: any) {
      console.error('Error adjusting debt:', err)
      setAdjustErrorMsg(err.message || 'Lỗi khi điều chỉnh công nợ. Vui lòng thử lại.')
    } finally {
      setSubmittingAdjust(false)
    }
  }

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!contactName.trim() || !contactPhone.trim() || !id) return

    try {
      const { error } = await supabase
        .from('customer_contacts')
        .insert({
          customer_id: id,
          full_name: contactName.trim(),
          role_at_farm: contactRole,
          phone: contactPhone.trim(),
          email: contactEmail.trim() || null,
          zalo_id: contactNotes.trim() ? null : undefined, // just sample
          is_primary: contactIsPrimary,
          is_decision_maker: contactIsDecision,
          notes: contactNotes.trim() || null
        })

      if (error) throw error

      // If set to primary, toggle others off
      if (contactIsPrimary) {
        await supabase
          .from('customer_contacts')
          .update({ is_primary: false })
          .eq('customer_id', id)
          .not('full_name', 'eq', contactName.trim())
      }

      // Reset contact form
      setContactName('')
      setContactRole('Chủ trại')
      setContactPhone('')
      setContactEmail('')
      setContactIsPrimary(false)
      setContactIsDecision(false)
      setContactNotes('')
      setIsContactModalOpen(false)

      // Reload
      loadCustomerData()
    } catch (err: any) {
      console.error('Error adding contact:', err)
      const msg = err?.message?.includes('violates row-level security')
        ? 'Bạn không có quyền thêm liên hệ cho khách hàng này.'
        : `Không thể lưu thông tin liên hệ! ${err?.message || ''}`
      alert(msg)
    }
  }

  // Delete Contact Handler
  const handleDeleteContact = async (contactId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa liên hệ này?')) return
    try {
      const { error } = await supabase
        .from('customer_contacts')
        .delete()
        .eq('id', contactId)

      if (error) throw error
      loadCustomerData()
    } catch (err: any) {
      console.error('Error deleting contact:', err)
      const msg = err?.message?.includes('violates row-level security')
        ? 'Bạn không có quyền xóa liên hệ này.'
        : `Không thể xóa liên hệ! ${err?.message || ''}`
      alert(msg)
    }
  }

  // Geolocation Helper
  const handleGetBrowserLocation = (setLat: (val: string) => void, setLng: (val: string) => void) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLat(String(position.coords.latitude.toFixed(7)))
          setLng(String(position.coords.longitude.toFixed(7)))
        },
        (error) => {
          console.error('Geolocation error:', error)
          alert('Không thể lấy vị trí. Vui lòng cho phép quyền truy cập vị trí trên trình duyệt.')
        }
      )
    } else {
      alert('Trình duyệt của bạn không hỗ trợ định vị GPS.')
    }
  }

  // Edit Farm Trigger
  const openEditFarmModal = (farm: Farm) => {
    setEditingFarm(farm)
    setEditFarmNameVal(farm.name)
    setEditFarmAddressVal(farm.address || '')
    setEditFarmAreaVal(farm.area_sqm ? String(farm.area_sqm) : '')
    setEditFarmCapacityVal(farm.capacity_heads ? String(farm.capacity_heads) : '')
    setEditFarmNotesVal(farm.notes || '')
    setEditFarmLatVal(farm.gps_lat ? String(farm.gps_lat) : '')
    setEditFarmLngVal(farm.gps_lng ? String(farm.gps_lng) : '')
    setIsEditFarmModalOpen(true)
  }

  // Edit Farm Submit Handler
  const handleEditFarm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingFarm || !editFarmNameVal.trim()) return

    try {
      const { error } = await supabase
        .from('farms')
        .update({
          name: editFarmNameVal.trim(),
          address: editFarmAddressVal.trim() || null,
          area_sqm: editFarmAreaVal ? Number(editFarmAreaVal) : null,
          capacity_heads: editFarmCapacityVal ? Number(editFarmCapacityVal) : null,
          notes: editFarmNotesVal.trim() || null,
          gps_lat: editFarmLatVal ? Number(editFarmLatVal) : null,
          gps_lng: editFarmLngVal ? Number(editFarmLngVal) : null
        })
        .eq('id', editingFarm.id)

      if (error) throw error

      setIsEditFarmModalOpen(false)
      setEditingFarm(null)
      loadCustomerData()
    } catch (err: any) {
      console.error('Error updating farm:', err)
      const msg = err?.message?.includes('violates row-level security')
        ? 'Bạn không có quyền cập nhật trang trại này.'
        : `Không thể cập nhật thông tin chuồng trại! ${err?.message || ''}`
      alert(msg)
    }
  }

  // Add Farm Handler
  const handleAddFarm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!farmName.trim() || !id) return

    try {
      const { error } = await supabase
        .from('farms')
        .insert({
          customer_id: id,
          name: farmName.trim(),
          address: farmAddress.trim() || null,
          area_sqm: farmArea ? Number(farmArea) : null,
          capacity_heads: farmCapacity ? Number(farmCapacity) : null,
          notes: farmNotes.trim() || null,
          gps_lat: farmLat ? Number(farmLat) : null,
          gps_lng: farmLng ? Number(farmLng) : null
        })

      if (error) throw error

      setFarmName('')
      setFarmAddress('')
      setFarmArea('')
      setFarmCapacity('')
      setFarmNotes('')
      setFarmLat('')
      setFarmLng('')
      setIsFarmModalOpen(false)

      loadCustomerData()
    } catch (err) {
      console.error('Error adding farm:', err)
      alert('Không thể tạo chuồng trại mới!')
    }
  }

  // Add Herd Handler
  const handleAddHerd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!herdName.trim() || !herdFarmId || !herdSpeciesId) return

    try {
      const { error } = await supabase
        .from('herds')
        .insert({
          farm_id: herdFarmId,
          species_id: herdSpeciesId,
          name: herdName.trim(),
          current_quantity: herdQty ? Number(herdQty) : 0,
          breed: herdBreed.trim() || null,
          avg_age_weeks: herdAge ? Number(herdAge) : null,
          entry_date: herdEntryDate || null,
          notes: herdNotes.trim() || null,
          is_active: true
        })

      if (error) throw error

      setHerdName('')
      setHerdQty('')
      setHerdBreed('')
      setHerdAge('')
      setHerdEntryDate('')
      setHerdNotes('')
      setIsHerdModalOpen(false)

      loadCustomerData()
    } catch (err) {
      console.error('Error adding herd:', err)
      alert('Không thể tạo đàn vật nuôi mới!')
    }
  }

  // Add Disease History Event Handler
  const handleAddDiseaseHistory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!diseaseHerdId || !diseaseId || !diseaseOnsetDate) return

    // Get current profile
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('Vui lòng đăng nhập lại.')
      return
    }

    setSubmittingDisease(true)
    try {
      const { error } = await supabase
        .from('disease_history')
        .insert({
          herd_id: diseaseHerdId,
          disease_id: diseaseId,
          onset_date: diseaseOnsetDate,
          resolved_date: diseaseResolvedDate || null,
          affected_heads: diseaseAffectedHeads ? Number(diseaseAffectedHeads) : null,
          mortality_heads: Number(diseaseMortalityHeads || 0),
          treatment: diseaseTreatment.trim() || null,
          notes: diseaseNotes.trim() || null,
          recorded_by: user.id
        })

      if (error) throw error

      // Reset
      setDiseaseResolvedDate('')
      setDiseaseAffectedHeads('')
      setDiseaseMortalityHeads('0')
      setDiseaseTreatment('')
      setDiseaseNotes('')
      setIsDiseaseModalOpen(false)

      // Reload
      loadCustomerData()
    } catch (err: any) {
      console.error('Error adding disease history:', err)
      alert('Không thể lưu bệnh án: ' + err.message)
    } finally {
      setSubmittingDisease(false)
    }
  }

  // Edit Customer Detail Handler
  const handleEditCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !editFarmName.trim()) return

    try {
      // 1. Update customer profile
      const { error: custErr } = await supabase
        .from('customers')
        .update({
          farm_name: editFarmName.trim(),
          customer_type: editType,
          value_tier: editTier,
          credit_limit: Number(editCreditLimit),
          price_list_id: editPriceListId || null,
          owner_user_id: editOwnerId,
          province: editProvince || null,
          district: editDistrict || null,
          address: editAddress.trim() || null,
          gps_lat: editGpsLat ? Number(editGpsLat) : null,
          gps_lng: editGpsLng ? Number(editGpsLng) : null,
          is_active: editIsActive
          // updated_at: bỏ — để Supabase trigger tự cập nhật
        })
        .eq('id', id)

      if (custErr) throw custErr

      // 2. Update Business/Personal tables
      const isBusiness = ['dealer', 'enterprise', 'vet_clinic'].includes(editType)
      if (isBusiness) {
        // Upsert Business info
        const { error: bizErr } = await supabase
          .from('customer_business_info')
          .upsert({
            customer_id: id,
            tax_code: editTaxCode.trim() || null,
            legal_name: editLegalName.trim() || editFarmName.trim(),
            bank_name: editBankName.trim() || null,
            bank_account_no: editBankAccountNo.trim() || null,
            invoice_address: editAddress.trim() || null
          })
        if (bizErr) console.error('Error updating business info:', bizErr)
      } else if (editType === 'farm_household') {
        // Upsert Personal info
        const { error: persErr } = await supabase
          .from('customer_personal_info')
          .upsert({
            customer_id: id,
            id_card_no: editIdCardNo.trim() || null
          })
        if (persErr) console.error('Error updating personal info:', persErr)
      }

      setIsEditModalOpen(false)
      loadCustomerData()
    } catch (err: any) {
      console.error('Error editing customer:', err)
      const msg = err?.message?.includes('violates row-level security')
        ? 'Bạn không có quyền chỉnh sửa khách hàng này. Chỉ nhân viên phụ trách, trưởng nhóm, quản lý chi nhánh hoặc admin mới có thể sửa.'
        : `Có lỗi xảy ra khi cập nhật hồ sơ khách hàng: ${err?.message || 'Không rõ nguyên nhân'}`
      alert(msg)
    }
  }



  if (loading) {
    return (
      <Layout activeMenu="Khách hàng">
        <div className="py-32 flex flex-col items-center justify-center text-gray-400">
          <div className="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
          <span>Đang tải thông tin chi tiết khách hàng...</span>
        </div>
      </Layout>
    )
  }

  if (!customer) {
    return (
      <Layout activeMenu="Khách hàng">
        <div className="py-24 text-center text-gray-400">
          <AlertCircle className="mx-auto text-gray-300 mb-4" size={64} />
          <h2 className="text-h2 font-bold text-gray-600">Khách hàng không tồn tại</h2>
          <p className="mt-2 text-body-md">Hồ sơ khách hàng có thể đã bị xóa hoặc đường dẫn không chính xác.</p>
          <button
            onClick={() => navigate('/customers')}
            className="mt-6 px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors"
          >
            Quay lại danh sách
          </button>
        </div>
      </Layout>
    )
  }

  const primaryContact = customer.customer_contacts?.find(c => c.is_primary)

  return (
    <Layout activeMenu="Khách hàng">
      <div className="p-4 md:p-10 max-w-[1600px] w-full mx-auto space-y-6">
        
        {/* Breadcrumb & Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <button
              onClick={() => navigate('/customers')}
              className="flex items-center gap-1.5 text-body-md text-gray-400 hover:text-blue-500 transition-colors font-semibold"
            >
              <ChevronLeft size={16} />
              Quay lại danh sách
            </button>
            <div className="flex items-center flex-wrap gap-3 mt-1">
              <h2 className="text-h1 font-bold text-gray-700">{customer.farm_name}</h2>
              <span className="px-2.5 py-0.5 bg-gray-50 border border-gray-100 text-gray-500 text-tiny font-semibold rounded-md uppercase">
                {customer.code}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${
                customer.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-danger-500 border-red-100'
              }`}>
                {customer.is_active ? 'Hoạt động' : 'Tạm khóa'}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            {canEditCustomer() && (
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="bg-blue-50 text-blue-500 border border-blue-100 px-4 h-10 rounded-lg font-semibold text-body-md hover:bg-blue-100 active:scale-95 transition-all flex items-center gap-2 shadow-sm"
              >
                <Edit size={16} />
                Chỉnh sửa hồ sơ
              </button>
            )}
          </div>
        </div>

        {/* 4 Cards Header Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* VIP Tier */}
          <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-150 transition-all">
            <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center flex-shrink-0">
              <Award size={22} strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Hạng khách hàng</p>
              <p className="font-bold text-body-lg text-blue-700 mt-0.5">
                {tierLabels[customer.value_tier] || customer.value_tier}
              </p>
            </div>
          </div>

          {/* Reputation Score */}
          <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-150 transition-all">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <Star size={22} strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Điểm uy tín</p>
              <p className="font-bold text-body-lg text-emerald-700 mt-0.5">
                Score: {reputationScore}
              </p>
            </div>
          </div>

          {/* Current Debt */}
          <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-150 transition-all">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
              isOverdue ? 'bg-red-50 text-danger-500' : 'bg-orange-50 text-orange-600'
            }`}>
              <CreditCard size={22} strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Công nợ hiện tại</p>
              <p className={`font-bold text-body-lg mt-0.5 tabular-nums ${
                isOverdue ? 'text-danger-500' : 'text-gray-700'
              }`}>
                {formatVND(totalDebt)}
              </p>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                {canCollectDebt() && (
                  <button
                    onClick={() => { setCollectSuccessMsg(''); setIsCollectDebtModalOpen(true) }}
                    className="h-7 px-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-[11px] rounded-md shadow-sm transition-all flex items-center gap-1"
                    title={totalDebt > 0 ? 'Thu công nợ khách hàng — ghi vào sổ quỹ' : 'Ghi nhận khách trả tiền (thu trước / ghi có) — ghi vào sổ quỹ'}
                  >
                    <Wallet size={12} />
                    {totalDebt > 0 ? 'Thu nợ' : 'Thu / Trả trước'}
                  </button>
                )}
                {canAdjustDebt() && (
                  <button
                    onClick={() => {
                      setAdjustType('increase')
                      setAdjustAmount('')
                      setAdjustNotes('')
                      setAdjustErrorMsg('')
                      setIsAdjustDebtModalOpen(true)
                    }}
                    className="h-7 px-2.5 bg-blue-50 hover:bg-blue-100 active:scale-95 text-blue-600 font-bold text-[11px] rounded-md border border-blue-100 transition-all flex items-center gap-1"
                    title="Điều chỉnh công nợ khách hàng"
                  >
                    <PlusCircle size={12} />
                    ± Điều chỉnh
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Lifetime Spend */}
          <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-150 transition-all">
            <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center flex-shrink-0">
              <ShoppingCart size={22} strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Tổng chi tiêu</p>
              <p className="font-bold text-body-lg text-gray-700 mt-0.5 tabular-nums">
                {formatVND(lifetimeSpend)}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs Control */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          <div className="flex border-b border-gray-100 bg-gray-25/50">
            <button
              onClick={() => setActiveTab('tong-quan')}
              className={`px-6 py-4 text-body-md font-semibold border-b-2 transition-all ${
                activeTab === 'tong-quan'
                  ? 'border-blue-500 text-blue-700 bg-gray-0'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Tổng quan hồ sơ
            </button>
            <button
              onClick={() => setActiveTab('trai-dan')}
              className={`px-6 py-4 text-body-md font-semibold border-b-2 transition-all ${
                activeTab === 'trai-dan'
                  ? 'border-blue-500 text-blue-700 bg-gray-0'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Chuồng trại &amp; Đàn nuôi
            </button>
            <button
              onClick={() => setActiveTab('don-hang')}
              className={`px-6 py-4 text-body-md font-semibold border-b-2 transition-all ${
                activeTab === 'don-hang'
                  ? 'border-blue-500 text-blue-700 bg-gray-0'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Đơn hàng &amp; Công nợ
            </button>
            <button
              onClick={() => setActiveTab('chan-dung')}
              className={`px-6 py-4 text-body-md font-semibold border-b-2 transition-all ${
                activeTab === 'chan-dung'
                  ? 'border-blue-500 text-blue-700 bg-gray-0'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Chân dung khách hàng
            </button>
            <button
              onClick={() => setActiveTab('benh-an')}
              className={`px-6 py-4 text-body-md font-semibold border-b-2 transition-all ${
                activeTab === 'benh-an'
                  ? 'border-blue-500 text-blue-700 bg-gray-0'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Bệnh án &amp; Dịch tễ
            </button>
          </div>

          <div className="p-6 md:p-8">
            
            {/* ── Tab: Tổng quan ── */}
            {activeTab === 'tong-quan' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
                {/* Profile detail details */}
                <div className="space-y-8">
                  
                  {/* Conditionally render Business or Personal info */}
                  {['dealer', 'enterprise', 'vet_clinic'].includes(customer.customer_type) ? (
                    <div>
                      <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                        <Briefcase className="text-blue-500" size={18} />
                        Thông tin doanh nghiệp / Pháp nhân
                      </h3>
                      <div className="bg-gray-25/50 border border-gray-100 p-5 rounded-lg space-y-3.5 text-body-md">
                        <div className="grid grid-cols-3 gap-2">
                          <span className="text-gray-400">Tên pháp nhân:</span>
                          <span className="col-span-2 font-semibold text-gray-700">
                            {customer.customer_business_info?.legal_name || customer.farm_name}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <span className="text-gray-400">Mã số thuế:</span>
                          <span className="col-span-2 font-semibold text-gray-700">
                            {customer.customer_business_info?.tax_code || 'Chưa cung cấp'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <span className="text-gray-400">Tài khoản NH:</span>
                          <span className="col-span-2 font-semibold text-gray-700">
                            {customer.customer_business_info?.bank_account_no 
                              ? `${customer.customer_business_info.bank_account_no} (${customer.customer_business_info.bank_name || ''})`
                              : 'Chưa cung cấp'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <span className="text-gray-400">Địa chỉ xuất HĐ:</span>
                          <span className="col-span-2 font-semibold text-gray-700">
                            {customer.customer_business_info?.invoice_address || customer.address || 'Chưa cung cấp'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                        <User className="text-blue-500" size={18} />
                        Thông tin cá nhân / Hộ kinh doanh
                      </h3>
                      <div className="bg-gray-25/50 border border-gray-100 p-5 rounded-lg space-y-3.5 text-body-md">
                        <div className="grid grid-cols-3 gap-2">
                          <span className="text-gray-400">Số CCCD/CMND:</span>
                          <span className="col-span-2 font-semibold text-gray-700">
                            {customer.customer_personal_info?.id_card_no || 'Chưa cung cấp'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <span className="text-gray-400">Số điện thoại:</span>
                          <span className="col-span-2 font-semibold text-gray-700">
                            {primaryContact?.phone ? maskData(formatPhone(primaryPhone(primaryContact.phone)), 'phone') : 'Chưa cung cấp'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <span className="text-gray-400">Địa điểm:</span>
                          <span className="col-span-2 font-semibold text-gray-700">
                            {[customer.district, customer.province].filter(Boolean).join(', ') || 'Chưa định vị'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* General Profile fields */}
                  <div className="pt-6 border-t border-gray-100">
                    <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                      <Settings className="text-blue-500" size={18} />
                      Chính sách bán hàng &amp; Giao dịch
                    </h3>
                    <div className="bg-gray-25/50 border border-gray-100 p-5 rounded-lg space-y-3.5 text-body-md">
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-gray-400">Nhân viên phụ trách:</span>
                        <span className="col-span-2 font-semibold text-gray-700">
                          {customer.owner?.full_name || 'Hệ thống'} ({customer.owner?.email || 'N/A'})
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-gray-400">Nhóm giá áp dụng:</span>
                        <span className="col-span-2 font-semibold text-gray-700">
                          {customer.price_list?.name || 'Giá mặc định'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-gray-400">Hạn mức nợ tối đa:</span>
                        <span className="col-span-2 font-bold text-blue-700">
                          {formatVND(customer.credit_limit || 0)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-gray-400">Địa chỉ liên hệ:</span>
                        <span className="col-span-2 font-semibold text-gray-700">
                          {[customer.address, customer.district, customer.province].filter(Boolean).join(', ') || 'Chưa cập nhật'}
                        </span>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Contacts List Column */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-body-lg font-bold text-gray-700 flex items-center gap-2">
                      <Phone className="text-blue-500" size={18} />
                      Danh sách người liên hệ ({customer.customer_contacts?.length || 0})
                    </h3>
                    <button
                      onClick={() => setIsContactModalOpen(true)}
                      className="text-blue-500 font-semibold text-body-md hover:underline flex items-center gap-1"
                    >
                      <Plus size={16} />
                      Thêm liên hệ
                    </button>
                  </div>

                  <div className="space-y-3">
                    {!customer.customer_contacts || customer.customer_contacts.length === 0 ? (
                      <div className="py-12 border-2 border-dashed border-gray-100 rounded-lg text-center text-gray-400 text-body-md">
                        Chưa có người liên hệ nào được ghi nhận.
                      </div>
                    ) : (
                      customer.customer_contacts.map(c => (
                        <div 
                          key={c.id} 
                          className={`p-4 rounded-lg border flex justify-between items-center transition-all ${
                            c.is_primary 
                              ? 'bg-blue-50/30 border-blue-100 ring-[3px] ring-blue-50' 
                              : 'bg-gray-0 border-gray-100 hover:border-gray-200'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-tiny ${
                              c.is_primary ? 'bg-blue-500 text-gray-0' : 'bg-gray-50 border border-gray-100 text-gray-400'
                            }`}>
                              {c.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-body-md text-gray-700">{c.full_name}</span>
                                {c.is_primary && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[9px] uppercase">Chính</span>
                                )}
                                {c.is_decision_maker && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-100 text-amber-700 font-bold text-[9px] uppercase">Quyết định</span>
                                )}
                              </div>
                              <p className="text-tiny text-gray-400 mt-0.5">
                                {c.role_at_farm || 'Không phân vai'} {c.email ? `• ${c.email}` : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="font-semibold text-body-md text-gray-700 tabular-nums">{c.phone ? maskData(formatPhone(primaryPhone(c.phone)), 'phone') : 'N/A'}</span>
                            <button
                              onClick={() => handleDeleteContact(c.id)}
                              className="text-gray-300 hover:text-danger-500 p-1.5 rounded hover:bg-gray-50 transition-colors"
                              title="Xóa người liên hệ"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* ── Tab: Trại & Đàn ── */}
            {activeTab === 'trai-dan' && (
              <div className="space-y-8">
                
                {/* Actions Row */}
                <div className="flex flex-wrap gap-2 justify-end border-b border-gray-100 pb-4">
                  <button
                    onClick={() => setIsFarmModalOpen(true)}
                    className="bg-blue-50 text-blue-500 border border-blue-100 px-3.5 h-9 rounded-lg font-semibold text-body-md hover:bg-blue-100 transition-colors flex items-center gap-1.5"
                  >
                    <PlusCircle size={15} />
                    Thêm chuồng trại
                  </button>
                  <button
                    onClick={() => {
                      if (farms.length === 0) {
                        alert('Cần tạo ít nhất một chuồng trại trước khi thêm đàn!')
                        return
                      }
                      setIsHerdModalOpen(true)
                    }}
                    className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-3.5 h-9 rounded-lg font-semibold text-body-md hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
                  >
                    <PlusCircle size={15} />
                    Thêm đàn nuôi
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: Farm details & Herds list */}
                  <div className="lg:col-span-2 space-y-6">
                    
                    {farms.length === 0 ? (
                      <div className="bg-gray-0 border border-dashed border-gray-250 rounded-xl p-12 text-center flex flex-col items-center justify-center">
                        <Home className="text-gray-400 mb-3" size={40} />
                        <h4 className="font-bold text-body-lg text-gray-700">Chưa có thông tin chuồng trại</h4>
                        <p className="text-tiny text-gray-400 max-w-sm mt-1 mb-4">
                          Khách hàng này chưa có dữ liệu chuồng trại được ghi nhận trên hệ thống.
                        </p>
                        <button
                          onClick={() => setIsFarmModalOpen(true)}
                          className="bg-blue-50 text-blue-500 border border-blue-100 px-4 h-9 rounded-lg text-tiny font-bold hover:bg-blue-100 transition-colors flex items-center gap-1.5"
                        >
                          <PlusCircle size={14} />
                          Thêm chuồng trại mới
                        </button>
                      </div>
                    ) : (
                      /* Actual farms list */
                      farms.map(f => {
                        const farmHerds = herds.filter(h => h.farm_id === f.id)
                        const totalHeads = farmHerds.reduce((sum, h) => sum + h.current_quantity, 0)

                        return (
                          <div key={f.id} className="bg-gray-0 border border-gray-100 rounded-xl p-6 space-y-6">
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500">
                                  <Home size={24} />
                                </div>
                                <div>
                                  <h4 className="font-bold text-body-lg text-gray-700">{f.name}</h4>
                                  <p className="text-body-md text-gray-400 flex items-center gap-1 mt-0.5">
                                    <MapPin size={14} />
                                    {f.address || 'Chưa ghi nhận địa chỉ'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openEditFarmModal(f)}
                                  className="text-blue-500 hover:text-blue-600 p-1.5 rounded hover:bg-gray-50 transition-colors flex items-center gap-1 font-semibold text-tiny"
                                  title="Chỉnh sửa chuồng trại"
                                >
                                  <Edit size={13} />
                                  Sửa
                                </button>
                                {f.gps_lat && f.gps_lng && (
                                  <button
                                    onClick={() => navigate(`/customers/map?focus=farm_${f.id}`)}
                                    className="text-emerald-650 hover:text-emerald-700 p-1.5 rounded hover:bg-gray-50 transition-colors flex items-center gap-1 font-semibold text-tiny"
                                    title="Xem trên bản đồ"
                                  >
                                    <MapPin size={13} />
                                    Bản đồ
                                  </button>
                                )}
                                <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full font-bold text-tiny">Đang hoạt động</span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                              <div className="p-4 rounded-lg bg-gray-25/50 border border-gray-100">
                                <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Quy mô đàn thực tế</p>
                                <p className="font-bold text-body-lg text-gray-700">{totalHeads} <span className="text-body-md font-normal text-gray-400">con</span></p>
                              </div>
                              <div className="p-4 rounded-lg bg-gray-25/50 border border-gray-100">
                                <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Thiết kế sức chứa</p>
                                <p className="font-bold text-body-lg text-gray-700">{f.capacity_heads || 'N/A'} <span className="text-body-md font-normal text-gray-400">con</span></p>
                              </div>
                              <div className="p-4 rounded-lg bg-gray-25/50 border border-gray-100">
                                <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Diện tích trại</p>
                                <p className="font-bold text-body-lg text-gray-700">{f.area_sqm || 'N/A'} <span className="text-body-md font-normal text-gray-400">m²</span></p>
                              </div>
                              <div className="p-4 rounded-lg bg-gray-25/50 border border-gray-100">
                                <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Vị trí GPS</p>
                                <p className="font-bold text-body-md text-gray-700 truncate">
                                  {f.gps_lat && f.gps_lng ? `${f.gps_lat}, ${f.gps_lng}` : 'Chưa định vị'}
                                </p>
                              </div>
                            </div>

                            {/* Active Herds inside this farm */}
                            <div>
                              <h5 className="font-semibold text-body-md text-gray-600 mb-3 flex items-center gap-1.5">
                                <Layers size={16} className="text-blue-500" />
                                Các đàn nuôi thuộc trại ({farmHerds.length})
                              </h5>
                              {farmHerds.length === 0 ? (
                                <div className="p-4 border border-dashed border-gray-100 rounded-lg text-center text-gray-400 text-body-md">
                                  Chưa có đàn nuôi nào trong chuồng trại này.
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {farmHerds.map(h => (
                                    <div key={h.id} className="p-4 border border-gray-100 rounded-lg bg-gray-25/20 flex flex-col justify-between">
                                      <div>
                                        <div className="flex justify-between items-start">
                                          <span className="font-bold text-body-md text-gray-700">{h.name}</span>
                                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 text-[10px] font-bold">
                                            {h.species?.name || 'Vật nuôi'}
                                          </span>
                                        </div>
                                        <div className="mt-2.5 space-y-1.5 text-body-md text-gray-500">
                                          <p>Số lượng: <span className="font-bold text-gray-600">{h.current_quantity} con</span></p>
                                          <p>Giống: <span className="font-semibold">{h.breed || 'Chưa xác định'}</span></p>
                                          <p>Tuổi: <span className="font-semibold">{h.avg_age_weeks || 'N/A'} tuần</span></p>
                                        </div>
                                      </div>
                                      {h.entry_date && (
                                        <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-1 text-[11px] text-gray-400">
                                          <Calendar size={12} />
                                          <span>Nhập đàn: {new Date(h.entry_date).toLocaleDateString('vi-VN')}</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}

                  </div>

                  {/* Right Column: Disease History */}
                  <div>
                    <div className="bg-gray-25/50 border border-gray-100 rounded-xl p-6">
                      <h4 className="text-body-lg font-bold text-gray-700 mb-6 flex items-center gap-2">
                        <Activity className="text-danger-500" size={18} />
                        Lịch sử dịch bệnh ghi nhận
                      </h4>

                      <div className="relative pl-4 border-l border-gray-250 space-y-6">
                        {diseases.length === 0 ? (
                          <div className="py-6 text-gray-400 italic text-body-md text-center">
                            Chưa ghi nhận dịch bệnh nào cho đàn vật nuôi.
                          </div>
                        ) : (
                          /* Render actual history list */
                          diseases.map(d => (
                            <div key={d.id} className="relative">
                              <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-gray-0 bg-red-500"></div>
                              <p className="text-tiny font-bold text-danger-500">
                                {d.onset_date ? new Date(d.onset_date).toLocaleDateString('vi-VN') : 'N/A'}
                              </p>
                              <p className="font-semibold text-body-md text-gray-700 mt-0.5">
                                {d.disease?.name} ({d.disease?.code})
                              </p>
                              <div className="text-body-md text-gray-400 mt-1 space-y-1">
                                {d.affected_heads && <p>Số con bị ảnh hưởng: <span className="font-semibold text-gray-600">{d.affected_heads}</span></p>}
                                {d.mortality_heads > 0 && <p>Tử vong: <span className="font-semibold text-danger-500">{d.mortality_heads} con</span></p>}
                                {d.treatment && <p>Phác đồ: <span className="text-gray-600">{d.treatment}</span></p>}
                                {d.notes && <p>Ghi chú: {d.notes}</p>}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* ── Tab: Đơn hàng ── */}
            {activeTab === 'don-hang' && (
              <div className="space-y-8">
                
                {/* Aging chart panel */}
                <div>
                  <h4 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-1.5">
                    <TrendingUp className="text-blue-500" size={18} />
                    Phân tích tuổi nợ hiện tại (Debt Aging)
                  </h4>
                  <div className="bg-gray-25/50 border border-gray-100 rounded-xl p-6">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={agingData}
                          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f5" />
                          <XAxis dataKey="name" stroke="#868e96" fontSize={12} tickLine={false} />
                          <YAxis 
                            stroke="#868e96" 
                            fontSize={12} 
                            tickLine={false} 
                            tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`}
                          />
                          <Tooltip
                            formatter={(value: any) => [formatVND(Number(value)), 'Số tiền nợ']}
                            contentStyle={{ background: '#fff', border: '1px solid #dee2e6', borderRadius: '8px' }}
                          />
                          <Bar dataKey="amount" radius={[8, 8, 0, 0]} maxBarSize={60}>
                            {agingData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-gray-100 pt-6 mt-4">
                      {agingData.map((entry, index) => (
                        <div key={index} className="text-center">
                          <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">{entry.name}</p>
                          <p className="text-body-lg font-bold mt-1" style={{ color: entry.color }}>
                            {formatVND(entry.amount)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Orders and Ledger sub-tabs */}
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                      <button
                        onClick={() => setSubTab('orders')}
                        className={`px-4 py-2 font-semibold text-body-md rounded-md transition-all ${
                          subTab === 'orders'
                            ? 'bg-white text-blue-700 shadow-sm'
                            : 'text-gray-500 hover:text-gray-750'
                        }`}
                      >
                        Đơn hàng bán lẻ ({customer.orders?.length || 0})
                      </button>
                      <button
                        onClick={() => setSubTab('ledger')}
                        className={`px-4 py-2 font-semibold text-body-md rounded-md transition-all ${
                          subTab === 'ledger'
                            ? 'bg-white text-blue-700 shadow-sm'
                            : 'text-gray-500 hover:text-gray-750'
                        }`}
                      >
                        Sổ chi tiết giao dịch ({ledgerItems.length})
                      </button>
                    </div>

                    {subTab === 'ledger' && (
                      <div className="flex items-center justify-between w-full bg-blue-50/50 p-2.5 rounded-lg border border-blue-100">
                        <div className="flex gap-4 text-body-md font-semibold">
                          <div className="text-gray-600">
                            Tổng nợ phát sinh: <span className="text-danger-500 font-bold">{formatVND(ledgerItems.reduce((s, i) => s + (i.affectsBalance && i.debtImpact > 0 ? i.debtImpact : 0), 0))}</span>
                          </div>
                          <div className="text-gray-600 border-l border-blue-200 pl-4">
                            Tổng thu/trả: <span className="text-emerald-700 font-bold">{formatVND(Math.abs(ledgerItems.reduce((s, i) => s + (i.affectsBalance && i.debtImpact < 0 ? i.debtImpact : 0), 0)))}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setIsExportDebtOpen(true)}
                            className="h-8 px-3.5 bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 active:scale-95 font-bold text-tiny rounded-lg transition-all flex items-center gap-1.5"
                          >
                            <FileSpreadsheet size={14} />
                            Xuất file công nợ
                          </button>
                          {canAdjustDebt() && (
                            <button
                              onClick={() => {
                                setAdjustType('increase')
                                setAdjustAmount('')
                                setAdjustNotes('')
                                setAdjustErrorMsg('')
                                setIsAdjustDebtModalOpen(true)
                              }}
                              className="h-8 px-3.5 bg-blue-500 hover:bg-blue-600 active:scale-95 text-white font-bold text-tiny rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                            >
                              <PlusCircle size={14} />
                              Điều chỉnh công nợ
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {subTab === 'orders' ? (
                    <div>
                      <div className="bg-gray-0 border border-gray-100 rounded-xl overflow-hidden">
                        {!customer.orders || customer.orders.length === 0 ? (
                          <div className="py-16 text-center text-gray-400 italic text-body-md">
                            Khách hàng này chưa phát sinh đơn hàng nào.
                          </div>
                        ) : (
                          /* Actual orders table */
                          <div className="overflow-x-auto tbl-x">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-gray-25 border-b border-gray-100">
                                  <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Mã đơn hàng</th>
                                  <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Ngày đặt</th>
                                  <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider text-right">Tổng tiền</th>
                                  <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Trạng thái GD</th>
                                  <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Thanh toán</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 text-body-md text-gray-600">
                                {customer.orders.map(o => (
                                  <tr key={o.id} className="hover:bg-gray-25/50 transition-colors">
                                    <td className="px-6 py-4 font-bold text-blue-500">{o.order_code}</td>
                                    <td className="px-6 py-4">
                                      {o.created_at ? new Date(o.created_at).toLocaleDateString('vi-VN') : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 text-right font-bold tabular-nums text-gray-700">
                                      {formatVND(o.grand_total)}
                                    </td>
                                    <td className="px-6 py-4">
                                      <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${
                                        o.status === 'completed' 
                                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                          : o.status === 'draft'
                                          ? 'bg-gray-50 text-gray-500 border-gray-100'
                                          : 'bg-blue-50 text-blue-700 border-blue-100'
                                      }`}>
                                        {o.status === 'draft' ? 'Bản nháp' : o.status === 'completed' ? 'Hoàn thành' : o.status}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4">
                                      <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${
                                        o.payment_status === 'paid'
                                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                          : o.payment_status === 'partially_paid'
                                          ? 'bg-amber-50 text-amber-700 border-amber-100'
                                          : 'bg-red-50 text-danger-500 border-red-100'
                                      }`}>
                                        {o.payment_status === 'paid' ? 'Đã thu' : o.payment_status === 'partially_paid' ? 'Thu một phần' : 'Chưa trả'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="bg-gray-0 border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                        {ledgerItems.length === 0 ? (
                          <div className="py-16 text-center text-gray-400 italic text-body-md">
                            Chưa phát sinh giao dịch nào trong sổ chi tiết của khách hàng này.
                          </div>
                        ) : (
                          <div className="overflow-x-auto tbl-x">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-gray-25 border-b border-gray-100 text-gray-500 font-semibold text-body-md">
                                  <th className="px-6 py-4">Thời gian</th>
                                  <th className="px-6 py-4">Mã chứng từ</th>
                                  <th className="px-6 py-4">Loại giao dịch</th>
                                  <th className="px-6 py-4 text-right">Giá trị phát sinh</th>
                                  <th className="px-6 py-4 text-right">Thực thu/trả</th>
                                  <th className="px-6 py-4 text-right">Ảnh hưởng nợ</th>
                                  <th className="px-6 py-4 text-right">Dư nợ cuối</th>
                                  <th className="px-6 py-4">Ghi chú</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 text-body-md text-gray-600">
                                {ledgerItems.map((item) => {
                                  const isDebtIncrease = item.affectsBalance && item.debtImpact > 0
                                  const isDebtDecrease = item.affectsBalance && item.debtImpact < 0
                                  const canOpen = !!item.refOrderId && (item.type === 'invoice' || item.type === 'return' || item.type === 'payment')

                                  return (
                                    <tr key={item.id} className={`transition-colors ${item.affectsBalance ? 'hover:bg-gray-25/50' : 'bg-amber-25/40 hover:bg-amber-25/60'}`}>
                                      <td className="px-6 py-4 whitespace-nowrap text-tiny text-gray-500 tabular-nums">
                                        {new Date(item.date).toLocaleString('vi-VN')}
                                      </td>
                                      <td className="px-6 py-4 font-mono font-bold text-tiny">
                                        {canOpen ? (
                                          <button
                                            onClick={() => navigate(`/orders/${item.refOrderId}`)}
                                            className="text-blue-600 hover:underline"
                                            title="Xem chi tiết chứng từ"
                                          >
                                            {item.code}
                                          </button>
                                        ) : (
                                          <span className="text-gray-500">{item.code}</span>
                                        )}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${
                                          item.type === 'invoice'
                                            ? 'bg-blue-50 text-blue-700 border-blue-100'
                                            : item.type === 'payment'
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                            : item.type === 'return'
                                            ? 'bg-purple-50 text-purple-700 border-purple-100'
                                            : 'bg-amber-50 text-amber-700 border-amber-100'
                                        }`}>
                                          {item.typeLabel}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 text-right font-semibold text-gray-700 tabular-nums">
                                        {item.value !== 0 ? formatVND(item.value) : '---'}
                                      </td>
                                      <td className="px-6 py-4 text-right font-semibold text-emerald-600 tabular-nums">
                                        {item.actualPaid !== 0 ? formatVND(item.actualPaid) : '---'}
                                      </td>
                                      <td className={`px-6 py-4 text-right font-bold tabular-nums ${
                                        isDebtIncrease
                                          ? 'text-red-600'
                                          : isDebtDecrease
                                          ? 'text-emerald-600'
                                          : 'text-gray-500'
                                      }`}>
                                        {!item.affectsBalance
                                          ? <span className="text-gray-400 italic text-tiny" title="Bút toán thông tin — không cộng vào số dư">— (thông tin)</span>
                                          : <>{isDebtIncrease ? '+' : ''}{item.debtImpact !== 0 ? formatVND(item.debtImpact) : '0 ₫'}</>}
                                      </td>
                                      <td className="px-6 py-4 text-right font-black text-gray-800 tabular-nums">
                                        {formatVND(item.runningBalance)}
                                      </td>
                                      <td className="px-6 py-4 text-tiny text-gray-400 max-w-xs truncate" title={item.notes}>
                                        {item.notes}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* ── Tab: Chân dung khách hàng ── */}
            {activeTab === 'chan-dung' && (() => {
              // 1. Quy mô trang trại
              const farmTotalArea = farms.reduce((sum, f) => sum + (f.area_sqm || 0), 0);
              const farmTotalCapacity = farms.reduce((sum, f) => sum + (f.capacity_heads || 0), 0);
              const activeHerdsCount = herds.filter(h => h.is_active).length;
              const totalHerdsQuantity = herds.filter(h => h.is_active).reduce((sum, h) => sum + h.current_quantity, 0);

              const speciesDistribution: Record<string, number> = {};
              herds.filter(h => h.is_active).forEach(h => {
                const speciesName = h.species?.name || 'Khác';
                speciesDistribution[speciesName] = (speciesDistribution[speciesName] || 0) + h.current_quantity;
              });
              const speciesDistributionList = Object.entries(speciesDistribution).map(([name, qty]) => ({
                name,
                qty,
                percentage: totalHerdsQuantity > 0 ? Math.round((qty / totalHerdsQuantity) * 100) : 0
              })).sort((a, b) => b.qty - a.qty);

              // 2. Tần suất & hành vi mua hàng
              const validOrders = (customer.orders || [])
                .filter(o => o.status !== 'cancelled')
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

              let purchaseFrequencyDays: number | null = null;
              let lastOrderDateStr = 'Chưa có đơn hàng';
              let daysSinceLastOrder: number | null = null;
              let isAtRisk = false;
              let riskLevel: 'low' | 'medium' | 'high' = 'low';

              if (validOrders.length > 0) {
                const lastOrder = validOrders[validOrders.length - 1];
                lastOrderDateStr = new Date(lastOrder.created_at).toLocaleDateString('vi-VN');
                
                const today = new Date();
                const lastOrderDate = new Date(lastOrder.created_at);
                const diffTimeLast = Math.abs(today.getTime() - lastOrderDate.getTime());
                daysSinceLastOrder = Math.floor(diffTimeLast / (1000 * 60 * 60 * 24));

                if (validOrders.length > 1) {
                  let totalDiffDays = 0;
                  for (let i = 1; i < validOrders.length; i++) {
                    const prevDate = new Date(validOrders[i - 1].created_at);
                    const currDate = new Date(validOrders[i].created_at);
                    const diff = Math.abs(currDate.getTime() - prevDate.getTime());
                    totalDiffDays += diff / (1000 * 60 * 60 * 24);
                  }
                  purchaseFrequencyDays = Math.round(totalDiffDays / (validOrders.length - 1));
                }
                
                if (purchaseFrequencyDays !== null && daysSinceLastOrder !== null) {
                  if (daysSinceLastOrder > purchaseFrequencyDays * 2.5) {
                    isAtRisk = true;
                    riskLevel = 'high';
                  } else if (daysSinceLastOrder > purchaseFrequencyDays * 1.5) {
                    isAtRisk = true;
                    riskLevel = 'medium';
                  }
                } else if (daysSinceLastOrder !== null && daysSinceLastOrder > 60) {
                  isAtRisk = true;
                  riskLevel = 'high';
                }
              }

              // 3. Biểu đồ doanh thu hàng tháng (6 tháng gần nhất)
              const monthlySalesAggregation: Record<string, number> = {};
              const past6MonthsLabels: string[] = [];
              const now = new Date();
              for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const key = `${d.getMonth() + 1}/${d.getFullYear()}`;
                past6MonthsLabels.push(key);
                monthlySalesAggregation[key] = 0;
              }

              validOrders.forEach(o => {
                const d = new Date(o.created_at);
                const key = `${d.getMonth() + 1}/${d.getFullYear()}`;
                if (monthlySalesAggregation[key] !== undefined) {
                  monthlySalesAggregation[key] += Number(o.grand_total || 0);
                }
              });

              const monthlySalesChartData = past6MonthsLabels.map(label => ({
                name: label,
                revenue: monthlySalesAggregation[label]
              }));

              // 4. Gợi ý bán hàng bán chéo
              const recommendations: string[] = [];
              if (speciesDistributionList.length > 0) {
                const mainSpecies = speciesDistributionList[0].name.toLowerCase();
                if (mainSpecies.includes('heo') || mainSpecies.includes('lợn')) {
                  recommendations.push(`Trại đang chăn nuôi chủ yếu là ${speciesDistributionList[0].name} (${speciesDistributionList[0].percentage}%). Đề xuất tư vấn dòng sản phẩm dinh dưỡng chuyên biệt cho heo nái tiết sữa Bio-Zeal và thuốc phòng dịch tai xanh PRRS.`);
                } else if (mainSpecies.includes('gà') || mainSpecies.includes('vịt') || mainSpecies.includes('gia cầm') || mainSpecies.includes('chim')) {
                  recommendations.push(`Khách hàng tập trung chăn nuôi gia cầm. Hãy giới thiệu giải pháp sát trùng chuồng trại thế hệ mới Virocid và hỗn hợp điện giải chống stress nhiệt.`);
                } else if (mainSpecies.includes('bò') || mainSpecies.includes('trâu') || mainSpecies.includes('dê') || mainSpecies.includes('cừu')) {
                  recommendations.push(`Trại đang nuôi bò/trâu/dê. Đề xuất tư vấn đá liếm bổ sung khoáng chất và thuốc phòng ký sinh trùng đường máu.`);
                }
              } else {
                if (customer.customer_type === 'farm_household' || customer.customer_type === 'farm_commercial') {
                  recommendations.push(`Chưa ghi nhận đàn vật nuôi hoạt động. Hãy thăm dò quy mô chăn nuôi thực tế và loài vật nuôi chủ lực của hộ để tư vấn danh mục thuốc sát trùng và vắc-xin phù hợp.`);
                }
              }

              if (topProducts.length > 0) {
                const favorite = topProducts[0];
                recommendations.push(`Khách hàng ưa chuộng sản phẩm "${favorite.name}" (đã mua ${favorite.qty} ${favorite.unit}). Hiện tại đang có chương trình chiết khấu thêm hoặc quà tặng đi kèm, đề xuất Sales gợi ý mua gộp tăng số lượng.`);
              }

              if (customer.credit_limit > 0 && (totalDebt / customer.credit_limit) > 0.8) {
                recommendations.push(`Cảnh báo: Khách hàng đã sử dụng ${((totalDebt / customer.credit_limit) * 100).toFixed(0)}% hạn mức công nợ. Cần ưu tiên thu hồi nợ trước khi xuất thêm đơn hàng lớn tiếp theo.`);
              }

              if (recommendations.length === 0) {
                recommendations.push("Khách hàng mới tiếp cận hoặc chưa có lịch sử mua hàng ổn định. Khuyến khích gửi mẫu thử thuốc sát trùng chuồng trại và cẩm nang kỹ thuật chăn nuôi miễn phí.");
              }

              return (
                <div className="space-y-8">
                  {/* Bento Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    
                    {/* Card 1: Quy mô chăn nuôi */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm hover:border-gray-150 transition-all flex flex-col justify-between">
                      <div>
                        <h4 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                          <Home className="text-blue-500" size={18} />
                          Quy mô Trang trại & Đàn
                        </h4>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div className="p-3 bg-gray-25/50 border border-gray-100 rounded-lg">
                            <span className="text-tiny text-gray-400 font-bold uppercase tracking-wider block">Diện tích chuồng</span>
                            <span className="text-body-lg font-bold text-gray-700">{farmTotalArea.toLocaleString('vi-VN')} m²</span>
                          </div>
                          <div className="p-3 bg-gray-25/50 border border-gray-100 rounded-lg">
                            <span className="text-tiny text-gray-400 font-bold uppercase tracking-wider block">Thiết kế sức chứa</span>
                            <span className="text-body-lg font-bold text-gray-700">{farmTotalCapacity.toLocaleString('vi-VN')} con</span>
                          </div>
                          <div className="p-3 bg-gray-25/50 border border-gray-100 rounded-lg">
                            <span className="text-tiny text-gray-400 font-bold uppercase tracking-wider block">Số đàn hoạt động</span>
                            <span className="text-body-lg font-bold text-gray-700">{activeHerdsCount} đàn</span>
                          </div>
                          <div className="p-3 bg-gray-25/50 border border-gray-100 rounded-lg">
                            <span className="text-tiny text-gray-400 font-bold uppercase tracking-wider block">Tổng đầu con thực tế</span>
                            <span className="text-body-lg font-bold text-gray-700">{totalHerdsQuantity.toLocaleString('vi-VN')} con</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Pet breakdown */}
                      <div className="border-t border-gray-100 pt-4">
                        <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2 block">Phân bổ loài chăn nuôi</span>
                        {speciesDistributionList.length === 0 ? (
                          <p className="text-body-md text-gray-400 italic">Chưa ghi nhận vật nuôi trong chuồng trại.</p>
                        ) : (
                          <div className="space-y-2">
                            {speciesDistributionList.map((sp, idx) => (
                              <div key={idx} className="space-y-1">
                                <div className="flex justify-between text-body-md">
                                  <span className="font-semibold text-gray-600">{sp.name}</span>
                                  <span className="font-bold text-gray-500">{sp.qty.toLocaleString('vi-VN')} con ({sp.percentage}%)</span>
                                </div>
                                <div className="w-full h-2 bg-gray-50 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${sp.percentage}%` }}></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card 2: Hành vi & Tần suất mua hàng */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm hover:border-gray-150 transition-all flex flex-col justify-between">
                      <div>
                        <h4 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                          <Clock className="text-emerald-500" size={18} />
                          Tần suất & Chu kỳ mua
                        </h4>
                        
                        <div className="space-y-4">
                          <div className="flex justify-between items-center py-2.5 border-b border-gray-50">
                            <span className="text-body-md text-gray-400">Chu kỳ đặt hàng trung bình:</span>
                            <span className="font-bold text-gray-700">
                              {purchaseFrequencyDays !== null ? `${purchaseFrequencyDays} ngày / lần` : 'Chưa có đủ lịch sử'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-2.5 border-b border-gray-50">
                            <span className="text-body-md text-gray-400">Đơn hàng gần nhất:</span>
                            <span className="font-bold text-gray-700">{lastOrderDateStr}</span>
                          </div>
                          <div className="flex justify-between items-center py-2.5 border-b border-gray-50">
                            <span className="text-body-md text-gray-400">Số ngày kể từ đơn cuối:</span>
                            <span className="font-bold text-gray-700 tabular-nums">
                              {daysSinceLastOrder !== null ? `${daysSinceLastOrder} ngày trước` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Life cycle & Risk badge */}
                      <div className="border-t border-gray-100 pt-4 mt-4">
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Vòng đời khách hàng</span>
                            <span className="font-bold text-body-lg text-gray-700 capitalize">
                              {customer.lifecycle_stage === 'active' ? 'Đang hoạt động' : 
                               customer.lifecycle_stage === 'at_risk' ? 'Có nguy cơ rời bỏ' : 
                               customer.lifecycle_stage === 'churned' ? 'Đã rời bỏ' : 
                               customer.lifecycle_stage === 'lead' ? 'Khách tiềm năng' : customer.lifecycle_stage}
                            </span>
                          </div>

                          {isAtRisk ? (
                            <span className={`px-3 py-1 rounded-full border text-[11px] font-bold ${
                              riskLevel === 'high' 
                                ? 'bg-red-50 text-danger-500 border-red-100 animate-pulse' 
                                : 'bg-amber-50 text-amber-700 border-amber-100'
                            }`}>
                              {riskLevel === 'high' ? 'Rủi ro rời bỏ cao' : 'Có dấu hiệu rời bỏ'}
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-[11px] font-bold">
                              An toàn / Ổn định
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card 3: Xếp hạng sản phẩm yêu thích (Top 5 Products) */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm hover:border-gray-150 transition-all flex flex-col justify-between">
                      <div>
                        <h4 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                          <Star className="text-amber-500" size={18} />
                          Hàng hóa ưa chuộng nhất
                        </h4>

                        {topProducts.length === 0 ? (
                          <p className="text-body-md text-gray-400 italic py-6 text-center">Chưa phát sinh mua sản phẩm.</p>
                        ) : (
                          <div className="space-y-4">
                            {topProducts.map((p, idx) => {
                              const maxQty = topProducts[0].qty || 1;
                              const ratio = Math.round((p.qty / maxQty) * 100);
                              return (
                                <div key={idx} className="space-y-1">
                                  <div className="flex justify-between text-body-md">
                                    <span className="font-semibold text-gray-600 truncate max-w-[200px]" title={p.name}>
                                      {idx + 1}. {p.name}
                                    </span>
                                    <span className="font-bold text-gray-500 tabular-nums">
                                      {p.qty} {p.unit}
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 bg-gray-50 rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${ratio}%` }}></div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      
                      <div className="border-t border-gray-100 pt-3 mt-4 text-center">
                        <span className="text-[11px] text-gray-400 italic">Dữ liệu phân tích tự động dựa trên chi tiết đơn hàng</span>
                      </div>
                    </div>

                    {/* Card 4: Thống kê doanh số & hạn mức công nợ */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm hover:border-gray-150 transition-all md:col-span-2 flex flex-col justify-between">
                      <div>
                        <h4 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                          <TrendingUp className="text-indigo-500" size={18} />
                          Biến động Mua hàng & Tín dụng
                        </h4>

                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                          <div className="lg:col-span-3 h-48">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={monthlySalesChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f5" />
                                <XAxis dataKey="name" stroke="#868e96" fontSize={11} tickLine={false} />
                                <YAxis 
                                  stroke="#868e96" 
                                  fontSize={11} 
                                  tickLine={false} 
                                  tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(0)}M` : val.toString()}
                                />
                                <Tooltip
                                  formatter={(value: any) => [formatVND(Number(value)), 'Doanh số']}
                                  contentStyle={{ background: '#fff', border: '1px solid #dee2e6', borderRadius: '8px' }}
                                />
                                <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={35} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>

                          <div className="lg:col-span-2 flex flex-col justify-center space-y-4">
                            <div className="p-4 rounded-xl bg-indigo-50/30 border border-indigo-100/50">
                              <span className="text-tiny text-indigo-600 font-bold uppercase tracking-wider block">Doanh số 6 tháng qua</span>
                              <span className="text-h2 font-black text-indigo-700 block mt-1 tabular-nums">
                                {formatVND(monthlySalesChartData.reduce((sum, item) => sum + item.revenue, 0))}
                              </span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-body-md">
                                <span className="text-gray-400">Tỷ lệ sử dụng hạn mức nợ:</span>
                                <span className={`font-bold ${totalDebt > customer.credit_limit ? 'text-danger-500' : 'text-gray-700'}`}>
                                  {customer.credit_limit > 0 ? `${((totalDebt / customer.credit_limit) * 100).toFixed(0)}%` : '0%'}
                                </span>
                              </div>
                              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all ${totalDebt > customer.credit_limit ? 'bg-red-500' : 'bg-indigo-500'}`} 
                                  style={{ width: `${Math.min(100, customer.credit_limit > 0 ? (totalDebt / customer.credit_limit) * 100 : 0)}%` }}
                                ></div>
                              </div>
                              <div className="flex justify-between text-tiny text-gray-400 mt-1">
                                <span>Đã nợ: {formatVND(totalDebt)}</span>
                                <span>Hạn mức: {formatVND(customer.credit_limit)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card 5: Đề xuất bán hàng & chương trình khuyến mãi */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm hover:border-gray-150 transition-all flex flex-col justify-between">
                      <div>
                        <h4 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                          <Gift className="text-indigo-500" size={18} />
                          Gợi ý Bán hàng & Khuyến mãi
                        </h4>

                        <div className="space-y-4">
                          {/* Sales recommendations */}
                          <div className="space-y-2">
                            <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Gợi ý từ trợ lý AI</span>
                            {recommendations.map((rec, index) => (
                              <div key={index} className="flex gap-2 p-3 bg-blue-50/30 border border-blue-100/50 rounded-lg text-body-md text-blue-700 leading-relaxed">
                                <Zap size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
                                <span>{rec}</span>
                              </div>
                            ))}
                          </div>

                          {/* Matching Promotions */}
                          <div className="space-y-2">
                            <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Khuyến mãi khả dụng ({promotions.filter(p => p.is_active).length})</span>
                            {promotions.filter(p => p.is_active).length === 0 ? (
                              <p className="text-body-md text-gray-400 italic">Không có chương trình khuyến mãi nào đang chạy.</p>
                            ) : (
                              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                                {promotions.filter(p => p.is_active).map((p, idx) => (
                                  <div key={idx} className="flex items-center gap-2 p-2 bg-emerald-50/30 border border-emerald-100/50 rounded-lg text-body-md">
                                    <Percent size={14} className="text-emerald-600 flex-shrink-0" />
                                    <div className="truncate">
                                      <span className="font-bold text-emerald-700 block text-tiny truncate">{p.name}</span>
                                      <span className="text-tiny text-gray-400">
                                        HSD: {p.end_date ? new Date(p.end_date).toLocaleDateString('vi-VN') : 'Vô thời hạn'}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Activity Timeline and Quick Log form */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4">
                    {/* Activity logger */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm">
                      <h4 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-1.5">
                        <MessageSquare className="text-blue-500" size={18} />
                        Ghi nhật ký tương tác nhanh
                      </h4>
                      <form onSubmit={handleAddQuickLog} className="space-y-4 text-body-md">
                        <div className="space-y-1.5">
                          <label className="font-semibold text-gray-600 block">Tiêu đề tương tác *</label>
                          <input 
                            type="text" 
                            className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg focus:border-blue-500 focus:outline-none"
                            placeholder="Ví dụ: Gọi điện tư vấn PRRS, Ghé thăm chuồng số 2..."
                            value={logTitle}
                            onChange={e => setLogTitle(e.target.value)}
                            required
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="font-semibold text-gray-600 block">Loại hình *</label>
                            <select 
                              className="w-full h-10 px-2 bg-gray-25 border border-gray-100 rounded-lg text-gray-600 focus:border-blue-500 focus:outline-none"
                              value={logTypeId}
                              onChange={e => setLogTypeId(e.target.value)}
                              required
                            >
                              {activityTypes.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="font-semibold text-gray-600 block">Ngày thực hiện *</label>
                            <input 
                              type="date" 
                              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-gray-600 focus:border-blue-500 focus:outline-none"
                              value={logDate}
                              onChange={e => setLogDate(e.target.value)}
                              required
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="font-semibold text-gray-600 block">Chi tiết thảo luận / Nội dung</label>
                          <textarea 
                            className="w-full min-h-20 p-3 bg-gray-25 border border-gray-100 rounded-lg focus:border-blue-500 focus:outline-none resize-none"
                            placeholder="Ghi chú chi tiết trao đổi, phản hồi của khách..."
                            value={logContent}
                            onChange={e => setLogContent(e.target.value)}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="font-semibold text-gray-600 block">Kết quả tương tác / Đề xuất bước tiếp</label>
                          <input 
                            type="text" 
                            className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg focus:border-blue-500 focus:outline-none"
                            placeholder="Khách hẹn tuần sau đặt cám, Sắp xếp bác sĩ thú y qua khám..."
                            value={logOutcome}
                            onChange={e => setLogOutcome(e.target.value)}
                          />
                        </div>

                        <button 
                          type="submit" 
                          disabled={submittingLog}
                          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold h-10 rounded-lg transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                        >
                          {submittingLog ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Đang lưu...</span>
                            </>
                          ) : (
                            <>
                              <Plus size={16} />
                              <span>Ghi nhận Nhật ký</span>
                            </>
                          )}
                        </button>
                      </form>
                    </div>

                    {/* Timeline of interactions */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm lg:col-span-2">
                      <h4 className="text-body-lg font-bold text-gray-700 mb-6 flex items-center gap-2">
                        <Clock className="text-indigo-500" size={18} />
                        Dòng thời gian hoạt động tương tác ({activities.length})
                      </h4>

                      <div className="relative pl-4 border-l border-gray-100 space-y-6 max-h-[500px] overflow-y-auto pr-2">
                        {activities.length === 0 ? (
                          <p className="text-body-md text-gray-400 italic py-6 text-center">Chưa ghi nhận lịch sử tương tác chăm sóc khách hàng.</p>
                        ) : (
                          activities.map(act => {
                            const actType = act.activity_type || { name: 'Ghi chú', color_hex: '#6b7280' };
                            return (
                              <div key={act.id} className="relative">
                                {/* Bullet */}
                                <div 
                                  className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full border-2 border-gray-0"
                                  style={{ backgroundColor: actType.color_hex || '#6b7280' }}
                                ></div>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider">
                                    {act.scheduled_at ? new Date(act.scheduled_at).toLocaleDateString('vi-VN') : new Date(act.created_at).toLocaleDateString('vi-VN')}
                                  </span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold text-gray-500 bg-gray-50 border border-gray-100">
                                    {actType.name}
                                  </span>
                                </div>
                                <h5 className="font-bold text-body-md text-gray-700 mt-1">{act.title}</h5>
                                {act.content && (
                                  <p className="text-body-md text-gray-500 mt-1 leading-relaxed whitespace-pre-line bg-gray-25/30 p-2.5 rounded border border-gray-100">
                                    {act.content}
                                  </p>
                                )}
                                {act.outcome && (
                                  <div className="mt-2 text-tiny flex items-center gap-1.5 text-emerald-600 font-bold bg-emerald-50/50 p-1.5 px-2 rounded w-fit border border-emerald-100/50">
                                    <CheckCircle size={12} />
                                    <span>Kết quả: {act.outcome}</span>
                                  </div>
                                )}
                                <p className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-1">
                                  <User size={10} />
                                  <span>Ghi nhận bởi: {act.owner?.full_name || 'Hệ thống'}</span>
                                </p>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              );
            })()}

            {activeTab === 'benh-an' && (
              <div className="space-y-8">
                {/* Pathology Timeline & Drug Resistance Warning Dashboard */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: Alerts & Stats */}
                  <div className="space-y-6">
                    {/* Drug Resistance Alert */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm">
                      <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                        <ShieldAlert className="text-amber-500" size={18} />
                        Cảnh báo an toàn dược lý
                      </h3>
                      
                      {resistanceWarnings.length > 0 ? (
                        <div className="space-y-4">
                          {resistanceWarnings.map((warning, index) => (
                            <div key={index} className="p-4 bg-red-50 border border-red-150 rounded-xl text-body-md text-red-950 space-y-3 shadow-inner">
                              <div className="flex gap-2">
                                <AlertCircle size={20} className="text-danger-500 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-extrabold text-danger-600 block text-body-md uppercase tracking-wider">Cảnh báo lờn thuốc</span>
                                  <p className="mt-1 font-semibold leading-relaxed">
                                    Khách hàng đã dùng <strong className="font-extrabold text-red-700">{warning.ingredientName}</strong> liên tiếp {warning.ordersCount} lứa nuôi / đơn hàng gần đây.
                                  </p>
                                </div>
                              </div>
                              <div className="bg-white/80 border border-red-100 p-3 rounded-lg text-tiny leading-relaxed">
                                <span className="font-bold text-gray-700 block mb-0.5">Khuyến nghị chuyên môn:</span>
                                Tư vấn chuyển sang sử dụng các thuốc chứa <strong className="text-blue-600 font-extrabold">{warning.alternativeName}</strong> để cắt đứt chuỗi lờn thuốc và đảm bảo hiệu quả điều trị tối ưu.
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl text-body-md text-emerald-950 space-y-2 flex gap-2">
                          <CheckCircle size={20} className="text-emerald-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-extrabold text-emerald-700 block uppercase tracking-wider text-tiny">An toàn dịch tễ</span>
                            <p className="mt-0.5 text-tiny text-emerald-900 leading-normal">
                              Chưa phát hiện dấu hiệu lờn thuốc hoặc sử dụng lặp lại liên tục một hoạt chất kháng sinh trong các đơn hàng gần đây.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Pathology Stats */}
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
                      <h3 className="text-body-lg font-bold text-gray-700 flex items-center gap-2 pb-2 border-b border-gray-100">
                        <Activity className="text-blue-500" size={18} />
                        Thống kê Bệnh án
                      </h3>
                      <div className="grid grid-cols-2 gap-4 text-body-md">
                        <div className="p-3 bg-gray-25/50 border border-gray-100 rounded-lg">
                          <span className="text-tiny text-gray-400 font-bold uppercase tracking-wider block">Tổng số ca bệnh</span>
                          <span className="text-body-lg font-bold text-gray-750">{diseases.length} ca</span>
                        </div>
                        <div className="p-3 bg-gray-25/50 border border-gray-100 rounded-lg">
                          <span className="text-tiny text-gray-400 font-bold uppercase tracking-wider block">Thiệt hại tích lũy</span>
                          <span className="text-body-lg font-bold text-danger-600">
                            {diseases.reduce((sum, d) => sum + d.mortality_heads, 0)} con
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Log New Disease Button/Card */}
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50/30 border border-blue-100 rounded-xl p-6 shadow-sm space-y-4">
                      <div className="space-y-1">
                        <span className="font-bold text-blue-900 block text-body-md">Ghi nhận dịch bệnh mới</span>
                        <p className="text-tiny text-blue-600 leading-normal">
                          Lưu lại nhật ký bệnh án thú y mới phát hiện trên đàn nuôi của khách hàng để tối ưu hóa gợi ý giỏ hàng và theo dõi sức khỏe vật nuôi.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          if (herds.length === 0) {
                            alert('Khách hàng này chưa có đàn nuôi nào để ghi nhận bệnh án!')
                            return
                          }
                          setIsDiseaseModalOpen(true)
                        }}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-10 rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
                      >
                        <PlusCircle size={16} />
                        Khai báo bệnh án mới
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Disease History Timeline */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 md:p-8 shadow-sm">
                      <h3 className="text-body-lg font-bold text-gray-700 mb-6 flex items-center gap-2">
                        <Calendar className="text-blue-500" size={18} />
                        Dòng thời gian Dịch tễ (Epidemiological Timeline)
                      </h3>

                      <div className="relative pl-6 border-l-2 border-gray-150 space-y-8">
                        {diseases.length === 0 ? (
                          <div className="py-12 text-center text-gray-400 italic">
                            Chưa ghi nhận sự cố dịch bệnh nào trên các đàn nuôi của trang trại này.
                          </div>
                        ) : (
                          diseases.map(d => {
                            const mortalityRate = d.affected_heads && d.affected_heads > 0
                              ? Math.round((d.mortality_heads / d.affected_heads) * 100)
                              : 0
                            return (
                              <div key={d.id} className="relative group">
                                {/* Bullet indicator */}
                                <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-4 border-white bg-red-500 group-hover:scale-110 transition-transform shadow-sm"></div>
                                
                                <div className="bg-gray-25/50 border border-gray-100 hover:border-gray-200 rounded-xl p-5 space-y-3 transition-all">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <span className="px-2.5 py-0.5 rounded bg-rose-50 border border-rose-100 text-rose-700 font-extrabold text-[10px] uppercase">
                                      {d.disease?.category || 'Bệnh lý'}
                                    </span>
                                    <span className="text-tiny text-gray-400 font-semibold tabular-nums flex items-center gap-1">
                                      <Calendar size={12} />
                                      Phát bệnh: {d.onset_date ? new Date(d.onset_date).toLocaleDateString('vi-VN') : 'N/A'} 
                                      {d.resolved_date ? ` - Khỏi bệnh: ${new Date(d.resolved_date).toLocaleDateString('vi-VN')}` : ' (Chưa khỏi)'}
                                    </span>
                                  </div>

                                  <div>
                                    <h4 className="font-extrabold text-body-lg text-gray-700">
                                      {d.disease?.name} <span className="text-body-md font-semibold text-gray-400">({d.disease?.code})</span>
                                    </h4>
                                    <p className="text-tiny text-gray-400 mt-0.5">
                                      Đàn vật nuôi: <strong className="text-gray-600">{d.herd?.name || 'Đàn không xác định'}</strong>
                                    </p>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-body-md text-gray-500 border-t border-gray-100/50">
                                    <div>
                                      <span className="text-tiny text-gray-400 block font-semibold uppercase tracking-wider">Số con nhiễm</span>
                                      <span className="font-bold text-gray-700">{d.affected_heads || 'N/A'} con</span>
                                    </div>
                                    <div>
                                      <span className="text-tiny text-gray-400 block font-semibold uppercase tracking-wider">Số con chết</span>
                                      <span className="font-bold text-danger-500">{d.mortality_heads} con ({mortalityRate}%)</span>
                                    </div>
                                    <div className="col-span-1">
                                      <span className="text-tiny text-gray-400 block font-semibold uppercase tracking-wider">Tỷ lệ tử vong</span>
                                      <div className="w-full bg-gray-100 h-1.5 rounded-full mt-1.5 overflow-hidden">
                                        <div className="bg-danger-500 h-full rounded-full" style={{ width: `${Math.min(100, mortalityRate)}%` }}></div>
                                      </div>
                                    </div>
                                  </div>

                                  {d.treatment && (
                                    <div className="bg-blue-50/15 border border-blue-100/30 p-3 rounded-lg text-body-md">
                                      <strong className="text-blue-900 block mb-0.5 text-tiny font-bold uppercase tracking-wider">Phác đồ đã sử dụng:</strong>
                                      <p className="text-blue-950 font-medium leading-relaxed">{d.treatment}</p>
                                    </div>
                                  )}

                                  {d.notes && (
                                    <div className="text-body-md text-gray-500 italic bg-gray-50 p-2.5 rounded-lg">
                                      Ghi chú lâm sàng: {d.notes}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

      {/* ─────────────────────────────────────────────────────────────
          MODALS
          ───────────────────────────────────────────────────────────── */}
      
      {/* 1. EDIT CUSTOMER PROFILE MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-0 w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom duration-250">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <div>
                <h3 className="text-h2 font-semibold text-gray-700">Chỉnh sửa hồ sơ khách hàng</h3>
                <p className="text-tiny text-gray-400">Cập nhật hồ sơ pháp lý, địa chỉ và hạn mức công nợ</p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-full text-gray-400 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleEditCustomer} className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="space-y-6">
                
                {/* Farm Name & Customer Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Tên khách hàng / Trang trại *</label>
                    <input
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                      type="text"
                      value={editFarmName}
                      onChange={(e) => setEditFarmName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Phân loại *</label>
                    <select
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                      value={editType}
                      onChange={(e) => setEditType(e.target.value)}
                    >
                      {classifications.filter(c => c.is_active || c.code === editType).map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Tier & Credit Limit */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Hạng khách hàng *</label>
                    <select
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                      value={editTier}
                      onChange={(e) => setEditTier(e.target.value)}
                    >
                      {tiers.filter(t => t.is_active || t.code === editTier).map((t) => (
                        <option key={t.code} value={t.code}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Hạn mức nợ tối đa (VND) *</label>
                    <input
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none font-bold text-blue-700"
                      type="number"
                      value={editCreditLimit}
                      onChange={(e) => setEditCreditLimit(Number(e.target.value))}
                    />
                  </div>
                </div>

                {/* Price List & Owner */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Bảng giá áp dụng *</label>
                    <select
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                      value={editPriceListId}
                      onChange={(e) => setEditPriceListId(e.target.value)}
                    >
                      <option value="">Chọn bảng giá</option>
                      {priceLists.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Nhân viên phụ trách *</label>
                    <select
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                      value={editOwnerId}
                      onChange={(e) => setEditOwnerId(e.target.value)}
                    >
                      {salesReps.map(r => (
                        <option key={r.id} value={r.id}>{r.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Province & District */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Tỉnh / Thành phố</label>
                    <SmartSearchSelect
                      options={editProvinceOptions}
                      value={editProvince}
                      onChange={(val) => {
                        setEditProvince(val)
                        setEditDistrict('')
                      }}
                      placeholder="Chọn Tỉnh / Thành phố"
                      searchPlaceholder="Tìm kiếm tỉnh thành..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Quận / Huyện</label>
                    <SmartSearchSelect
                      options={editDistrictOptions}
                      value={editDistrict}
                      onChange={(val) => setEditDistrict(val)}
                      placeholder="Chọn Quận / Huyện"
                      searchPlaceholder="Tìm kiếm quận huyện..."
                      disabled={!editProvince}
                    />
                  </div>
                </div>

                {/* Specific Address */}
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Địa chỉ cụ thể</label>
                  <input
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                  />
                </div>

                {/* GPS Coordinates */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Vĩ độ (GPS Latitude)</label>
                    <input
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                      type="number"
                      step="any"
                      value={editGpsLat}
                      onChange={(e) => setEditGpsLat(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-body-md font-semibold text-gray-600">Kinh độ (GPS Longitude)</label>
                    <input
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                      type="number"
                      step="any"
                      value={editGpsLng}
                      onChange={(e) => setEditGpsLng(e.target.value)}
                    />
                  </div>
                </div>

                {/* State checkbox */}
                <div className="flex items-center gap-2">
                  <input
                    id="edit-active-toggle"
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                    className="w-4 h-4 text-blue-500 border-gray-100 rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <label htmlFor="edit-active-toggle" className="text-body-md font-semibold text-gray-600 select-none">
                    Kích hoạt hoạt động hồ sơ khách hàng
                  </label>
                </div>

                {/* Conditional Sub-fields */}
                <div className="border-t border-gray-100 pt-6">
                  {['dealer', 'enterprise', 'vet_clinic'].includes(editType) ? (
                    <div className="space-y-6">
                      <h4 className="font-bold text-body-md text-gray-700">Thông tin bổ sung Doanh nghiệp</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1.5">
                          <label className="text-body-md font-semibold text-gray-600">Mã số thuế</label>
                          <input
                            className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                            type="text"
                            value={editTaxCode}
                            onChange={(e) => setEditTaxCode(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-body-md font-semibold text-gray-600">Tên pháp nhân</label>
                          <input
                            className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                            type="text"
                            value={editLegalName}
                            onChange={(e) => setEditLegalName(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1.5">
                          <label className="text-body-md font-semibold text-gray-600">Tên ngân hàng</label>
                          <input
                            className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                            type="text"
                            value={editBankName}
                            onChange={(e) => setEditBankName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-body-md font-semibold text-gray-600">Số tài khoản ngân hàng</label>
                          <input
                            className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                            type="text"
                            value={editBankAccountNo}
                            onChange={(e) => setEditBankAccountNo(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <h4 className="font-bold text-body-md text-gray-700">Thông tin bổ sung Hộ chăn nuôi</h4>
                      <div className="space-y-1.5">
                        <label className="text-body-md font-semibold text-gray-600">Số CCCD/CMND</label>
                        <input
                          className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                          type="text"
                          value={editIdCardNo}
                          onChange={(e) => setEditIdCardNo(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>

              </div>
              
              {/* Footer buttons */}
              <div className="flex justify-end gap-3 pt-6 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 border border-gray-150 rounded-lg font-semibold text-body-md hover:bg-gray-50 text-gray-500"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. ADD CONTACT MODAL */}
      {isContactModalOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-0 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-250">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="text-body-lg font-bold text-gray-700">Thêm người liên hệ</h3>
              <button onClick={() => setIsContactModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddContact} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Họ và tên *</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  placeholder="VD: Nguyễn Văn B"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Vai trò / Chức vụ</label>
                <select
                  value={contactRole}
                  onChange={(e) => setContactRole(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                >
                  <option value="Chủ trại">Chủ trại</option>
                  <option value="Kỹ thuật viên">Kỹ thuật viên</option>
                  <option value="Kế toán">Kế toán</option>
                  <option value="Quản kho">Quản kho</option>
                  <option value="Khác">Khác</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Số điện thoại *</label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="0987xxxxxx"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Email</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="email@domain.com"
                  />
                </div>
              </div>
              
              <div className="flex items-center gap-4 py-2">
                <label className="flex items-center gap-1.5 text-body-md text-gray-600 select-none">
                  <input
                    type="checkbox"
                    checked={contactIsPrimary}
                    onChange={(e) => setContactIsPrimary(e.target.checked)}
                    className="w-4 h-4 text-blue-500 border-gray-100 rounded"
                  />
                  Liên hệ chính?
                </label>
                <label className="flex items-center gap-1.5 text-body-md text-gray-600 select-none">
                  <input
                    type="checkbox"
                    checked={contactIsDecision}
                    onChange={(e) => setContactIsDecision(e.target.checked)}
                    className="w-4 h-4 text-blue-500 border-gray-100 rounded"
                  />
                  Người quyết định?
                </label>
              </div>

              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Ghi chú</label>
                <textarea
                  value={contactNotes}
                  onChange={(e) => setContactNotes(e.target.value)}
                  className="w-full p-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsContactModalOpen(false)}
                  className="px-4 py-2 border border-gray-150 text-gray-400 rounded-lg font-semibold"
                >
                  Hủy
                </button>
                <button type="submit" className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600">
                  Thêm liên hệ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. ADD FARM MODAL */}
      {isFarmModalOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-0 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-250">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="text-body-lg font-bold text-gray-700">Thêm chuồng trại mới</h3>
              <button onClick={() => setIsFarmModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddFarm} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Tên chuồng trại *</label>
                <input
                  type="text"
                  value={farmName}
                  onChange={(e) => setFarmName(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  placeholder="VD: Trại Sanh Long B"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Địa chỉ cụ thể</label>
                <input
                  type="text"
                  value={farmAddress}
                  onChange={(e) => setFarmAddress(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  placeholder="Địa điểm chuồng trại"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Diện tích (m²)</label>
                  <input
                    type="number"
                    value={farmArea}
                    onChange={(e) => setFarmArea(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="VD: 1500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Sức chứa (con)</label>
                  <input
                    type="number"
                    value={farmCapacity}
                    onChange={(e) => setFarmCapacity(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="VD: 300"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-body-md font-semibold text-gray-600">Vĩ độ (Latitude)</label>
                    <button 
                      type="button" 
                      onClick={() => handleGetBrowserLocation(setFarmLat, setFarmLng)}
                      className="text-[11px] text-blue-500 hover:underline font-semibold"
                    >
                      Lấy GPS máy
                    </button>
                  </div>
                  <input
                    type="number"
                    step="any"
                    value={farmLat}
                    onChange={(e) => setFarmLat(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="VD: 14.3725"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Kinh độ (Longitude)</label>
                  <input
                    type="number"
                    step="any"
                    value={farmLng}
                    onChange={(e) => setFarmLng(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="VD: 108.9958"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Ghi chú</label>
                <textarea
                  value={farmNotes}
                  onChange={(e) => setFarmNotes(e.target.value)}
                  className="w-full p-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsFarmModalOpen(false)}
                  className="px-4 py-2 border border-gray-150 text-gray-400 rounded-lg font-semibold"
                >
                  Hủy
                </button>
                <button type="submit" className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600">
                  Tạo trại
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3.5 EDIT FARM MODAL */}
      {isEditFarmModalOpen && editingFarm && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-0 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-250">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="text-body-lg font-bold text-gray-700">Chỉnh sửa chuồng trại</h3>
              <button onClick={() => { setIsEditFarmModalOpen(false); setEditingFarm(null); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleEditFarm} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Tên chuồng trại *</label>
                <input
                  type="text"
                  value={editFarmNameVal}
                  onChange={(e) => setEditFarmNameVal(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Địa chỉ cụ thể</label>
                <input
                  type="text"
                  value={editFarmAddressVal}
                  onChange={(e) => setEditFarmAddressVal(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Diện tích (m²)</label>
                  <input
                    type="number"
                    value={editFarmAreaVal}
                    onChange={(e) => setEditFarmAreaVal(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Sức chứa (con)</label>
                  <input
                    type="number"
                    value={editFarmCapacityVal}
                    onChange={(e) => setEditFarmCapacityVal(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-body-md font-semibold text-gray-600">Vĩ độ (Latitude)</label>
                    <button 
                      type="button" 
                      onClick={() => handleGetBrowserLocation(setEditFarmLatVal, setEditFarmLngVal)}
                      className="text-[11px] text-blue-500 hover:underline font-semibold"
                    >
                      Lấy GPS máy
                    </button>
                  </div>
                  <input
                    type="number"
                    step="any"
                    value={editFarmLatVal}
                    onChange={(e) => setEditFarmLatVal(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="VD: 14.3725"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Kinh độ (Longitude)</label>
                  <input
                    type="number"
                    step="any"
                    value={editFarmLngVal}
                    onChange={(e) => setEditFarmLngVal(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="VD: 108.9958"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Ghi chú</label>
                <textarea
                  value={editFarmNotesVal}
                  onChange={(e) => setEditFarmNotesVal(e.target.value)}
                  className="w-full p-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => { setIsEditFarmModalOpen(false); setEditingFarm(null); }}
                  className="px-4 py-2 border border-gray-150 text-gray-400 rounded-lg font-semibold"
                >
                  Hủy
                </button>
                <button type="submit" className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600">
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. ADD HERD MODAL */}
      {isHerdModalOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-0 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-250">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="text-body-lg font-bold text-gray-700">Thêm đàn nuôi mới</h3>
              <button onClick={() => setIsHerdModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddHerd} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Tên đàn vật nuôi *</label>
                <input
                  type="text"
                  value={herdName}
                  onChange={(e) => setHerdName(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  placeholder="VD: Đàn lợn nái thịt đợt 2"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Chọn chuồng trại *</label>
                  <select
                    value={herdFarmId}
                    onChange={(e) => setHerdFarmId(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                  >
                    {farms.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Loài vật nuôi *</label>
                  <select
                    value={herdSpeciesId}
                    onChange={(e) => setHerdSpeciesId(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                  >
                    {speciesList.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Số lượng *</label>
                  <input
                    type="number"
                    value={herdQty}
                    onChange={(e) => setHerdQty(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="200"
                    required
                  />
                </div>
                <div className="col-span-1 space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Giống</label>
                  <input
                    type="text"
                    value={herdBreed}
                    onChange={(e) => setHerdBreed(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="Yorkshire"
                  />
                </div>
                <div className="col-span-1 space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Tuổi (tuần)</label>
                  <input
                    type="number"
                    value={herdAge}
                    onChange={(e) => setHerdAge(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    placeholder="12"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Ngày nhập đàn</label>
                <input
                  type="date"
                  value={herdEntryDate}
                  onChange={(e) => setHerdEntryDate(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Ghi chú</label>
                <textarea
                  value={herdNotes}
                  onChange={(e) => setHerdNotes(e.target.value)}
                  className="w-full p-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsHerdModalOpen(false)}
                  className="px-4 py-2 border border-gray-150 text-gray-400 rounded-lg font-semibold"
                >
                  Hủy
                </button>
                <button type="submit" className="px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600">
                  Tạo đàn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. ADD DISEASE HISTORY EVENT MODAL */}
      {isDiseaseModalOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-0 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-250">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="text-body-lg font-bold text-gray-700">Khai báo Bệnh án / Sự cố dịch tễ</h3>
              <button 
                onClick={() => setIsDiseaseModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600"
                type="button"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddDiseaseHistory} className="p-6 space-y-4 text-body-md">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-gray-600 block">Đàn vật nuôi *</label>
                  <select
                    value={diseaseHerdId}
                    onChange={(e) => setDiseaseHerdId(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-gray-600 focus:border-blue-500 focus:outline-none"
                    required
                  >
                    {herds.map(h => (
                      <option key={h.id} value={h.id}>{h.name} ({h.species?.name})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-gray-600 block">Bệnh lý chẩn đoán *</label>
                  <select
                    value={diseaseId}
                    onChange={(e) => setDiseaseId(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-gray-600 focus:border-blue-500 focus:outline-none"
                    required
                  >
                    {diseaseDict.map(d => (
                      <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-gray-600 block">Ngày bắt đầu bệnh *</label>
                  <input
                    type="date"
                    value={diseaseOnsetDate}
                    onChange={(e) => setDiseaseOnsetDate(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-gray-600 focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-gray-600 block">Ngày khỏi bệnh (nếu có)</label>
                  <input
                    type="date"
                    value={diseaseResolvedDate}
                    onChange={(e) => setDiseaseResolvedDate(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-gray-600 block">Số con bị ảnh hưởng</label>
                  <input
                    type="number"
                    value={diseaseAffectedHeads}
                    onChange={(e) => setDiseaseAffectedHeads(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg focus:border-blue-500 focus:outline-none"
                    placeholder="VD: 50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-gray-600 block">Số con chết (tử vong)</label>
                  <input
                    type="number"
                    value={diseaseMortalityHeads}
                    onChange={(e) => setDiseaseMortalityHeads(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg focus:border-blue-500 focus:outline-none"
                    placeholder="VD: 5"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-gray-600 block">Phác đồ điều trị áp dụng</label>
                <textarea
                  value={diseaseTreatment}
                  onChange={(e) => setDiseaseTreatment(e.target.value)}
                  className="w-full p-3 bg-gray-25 border border-gray-100 rounded-lg focus:border-blue-500 focus:outline-none resize-none"
                  rows={2}
                  placeholder="Nhập tên thuốc và hoạt chất hoặc phác đồ đã sử dụng..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-gray-600 block">Ghi chú lâm sàng</label>
                <textarea
                  value={diseaseNotes}
                  onChange={(e) => setDiseaseNotes(e.target.value)}
                  className="w-full p-3 bg-gray-25 border border-gray-100 rounded-lg focus:border-blue-500 focus:outline-none resize-none"
                  rows={2}
                  placeholder="Ghi chú thêm về triệu chứng hoặc thông tin xét nghiệm..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsDiseaseModalOpen(false)}
                  className="px-4 py-2 border border-gray-150 text-gray-400 rounded-lg font-semibold"
                >
                  Hủy
                </button>
                <button 
                  type="submit" 
                  disabled={submittingDisease}
                  className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {submittingDisease ? 'Đang lưu...' : 'Ghi nhận bệnh án'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 3.6 ADJUST DEBT MODAL */}
      {isExportDebtOpen && customer && (
        <ExportDebtStatementModal
          customer={{ id: customer.id, name: customer.farm_name, code: customer.code }}
          onClose={() => setIsExportDebtOpen(false)}
        />
      )}

      {/* 3.7 THU CÔNG NỢ (THANH TOÁN) */}
      {isCollectDebtModalOpen && customer && (
        <CollectDebtModal
          customer={{ id: customer.id, name: customer.farm_name, code: customer.code }}
          currentDebt={totalDebt}
          onClose={() => setIsCollectDebtModalOpen(false)}
          onSuccess={(msg) => {
            setIsCollectDebtModalOpen(false)
            setCollectSuccessMsg(msg)
            loadCustomerData()
            setTimeout(() => setCollectSuccessMsg(''), 6000)
          }}
        />
      )}

      {collectSuccessMsg && (
        <div className="fixed top-5 right-5 z-[80] max-w-sm bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-start gap-2.5 animate-in slide-in-from-top-2 duration-200">
          <CheckCircle size={18} className="mt-0.5 shrink-0" />
          <span className="text-tiny font-medium">{collectSuccessMsg}</span>
        </div>
      )}

      {isAdjustDebtModalOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-0 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-250">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="text-body-lg font-bold text-gray-700">Điều chỉnh công nợ</h3>
              <button 
                onClick={() => setIsAdjustDebtModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAdjustDebt} className="p-6 space-y-4">
              {adjustErrorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-danger-500 text-body-sm font-semibold flex items-center gap-2">
                  <ShieldAlert size={16} className="shrink-0" />
                  <span>{adjustErrorMsg}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Loại điều chỉnh</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-lg border border-gray-150">
                  <button
                    type="button"
                    onClick={() => setAdjustType('increase')}
                    className={`py-2 text-body-md font-bold rounded-md transition-all ${
                      adjustType === 'increase'
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Tăng nợ (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustType('decrease')}
                    className={`py-2 text-body-md font-bold rounded-md transition-all ${
                      adjustType === 'decrease'
                        ? 'bg-white text-danger-500 shadow-sm'
                        : 'text-gray-500 hover:text-gray-850'
                    }`}
                  >
                    Giảm nợ (-)
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Số tiền điều chỉnh (VND) *</label>
                <input
                  type="number"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="VD: 500000"
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none font-semibold"
                  required
                  min="1"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Lý do điều chỉnh / Ghi chú *</label>
                <textarea
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="Nhập chi tiết lý do điều chỉnh công nợ..."
                  className="w-full p-3 bg-gray-25 border border-gray-100 rounded-lg focus:border-blue-500 focus:outline-none resize-none text-body-md"
                  rows={3}
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAdjustDebtModalOpen(false)}
                  className="px-4 py-2 border border-gray-150 text-gray-400 rounded-lg font-semibold"
                >
                  Hủy
                </button>
                <button 
                  type="submit" 
                  disabled={submittingAdjust}
                  className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {submittingAdjust ? 'Đang thực hiện...' : 'Xác nhận điều chỉnh'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </Layout>
  )
}
