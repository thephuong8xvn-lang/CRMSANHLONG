import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  Plus,
  Edit,
  Package,
  Layers,
  Activity,
  AlertCircle,
  ShieldAlert,
  Check,
  Calendar,
  Warehouse,
  Info,
  Play,
  Printer,
  FileText,
  Bookmark
} from 'lucide-react'
import Layout from '../../components/Layout'
import { ProductImage } from '../../components/ProductImage'
import { supabase } from '../../lib/supabase'
import EditProductModal from './EditProductModal'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useAuth } from '../../contexts/AuthContext'

interface ProductCategory {
  id: string
  code: string
  name: string
}

interface Brand {
  id: string
  name: string
  country?: string
}

interface Product {
  id: string
  sku: string
  name: string
  unit: string
  package_specs?: string | null
  storage_condition?: string | null
  usage_instructions?: string | null
  image_urls?: string[]
  is_lot_managed: boolean
  is_active: boolean
  category_id: string | null
  brand_id: string | null
  product_categories?: ProductCategory | null
  brands?: Brand | null
  registration_number?: string | null
  contraindications?: string | null
  withdrawal_period_meat?: number | null
  withdrawal_period_milk_egg?: number | null
}

interface ProductVariant {
  id: string
  product_id: string
  sku_variant: string
  name: string
  attributes: Record<string, any>
  is_active: boolean
}

interface WarehouseData {
  id: string
  code: string
  name: string
}

interface StockLot {
  id: string
  product_id: string
  warehouse_id: string
  lot_number: string
  manufacture_date?: string | null
  expiry_date?: string | null
  quantity_on_hand: number
  quantity_reserved: number
  cost_price: number
  status: string
  received_at: string
  warehouses?: WarehouseData | null
}

interface StockMovement {
  id: string
  created_at: string
  movement_type: string
  quantity: number
  unit_cost: number | null
  reference_id: string | null
  reference_type: string | null
  notes: string | null
  stock_lots?: {
    lot_number: string
  } | null
  warehouses?: {
    code: string
    name: string
  } | null
  profiles?: {
    full_name: string
  } | null
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { settings, formatCurrency } = useDisplaySettings()
  const { profile, userRole } = useAuth()

  // State
  const [product, setProduct] = useState<Product | null>(null)
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [lots, setLots] = useState<StockLot[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'instructions' | 'inventory' | 'ledger'>('instructions')
  const [movements, setMovements] = useState<StockMovement[]>([])

  interface LinkedActiveIngredient {
    percentage_or_dosage: string
    active_ingredient: {
      id: string
      name: string
    }
  }
  const [productIngredients, setProductIngredients] = useState<LinkedActiveIngredient[]>([])

  interface LinkedDiseaseIndication {
    disease: {
      id: string
      name: string
      code: string
    } | null
  }
  const [productIndications, setProductIndications] = useState<LinkedDiseaseIndication[]>([])

  // Edit Modal & Pricing State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [priceListItems, setPriceListItems] = useState<any[]>([])

  // Quick Lot Adder State
  const [isAddingLot, setIsAddingLot] = useState(false)
  const [newLotNumber, setNewLotNumber] = useState('')
  const [newWarehouseId, setNewWarehouseId] = useState('')
  const [newMfgDate, setNewMfgDate] = useState('')
  const [newExpDate, setNewExpDate] = useState('')
  const [newQty, setNewQty] = useState<number>(100)
  const [newCostPrice, setNewCostPrice] = useState<number>(0)
  const [lotError, setLotError] = useState('')

  // FEFO Simulator State
  const [simulateQty, setSimulateQty] = useState<number>(50)
  const [simulatedAllocation, setSimulatedAllocation] = useState<{ lotId: string; qty: number }[]>([])
  const [simulationError, setSimulationError] = useState('')

  // Load Data
  const loadProductData = async () => {
    if (!id) return
    setLoading(true)
    try {
      // 1. Fetch product
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .select(`
          *,
          product_categories(id, code, name),
          brands(id, name, country)
        `)
        .eq('id', id)
        .single()

      if (prodErr) throw prodErr
      if (prodData) {
        setProduct(prodData as unknown as Product)
      }

      // Fetch active ingredients
      const { data: ingData } = await supabase
        .from('product_active_ingredients')
        .select(`
          percentage_or_dosage,
          active_ingredient:active_ingredients(id, name)
        `)
        .eq('product_id', id)
      
      if (ingData) {
        setProductIngredients(ingData as unknown as LinkedActiveIngredient[])
      }

      // Fetch disease indications
      try {
        const { data: indData, error: indError } = await supabase
          .from('product_indications')
          .select(`
            disease:disease_dictionary(id, name, code)
          `)
          .eq('product_id', id)
        
        if (!indError && indData) {
          setProductIndications(indData as unknown as LinkedDiseaseIndication[])
        }
      } catch (e: any) {
        console.warn('Could not load product indications (table may not exist):', e.message)
      }

      // 2. Fetch variants
      const { data: varData } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', id)

      if (varData) setVariants(varData)

      // 3. Fetch stock lots
      let lotQuery = supabase
        .from('stock_lots')
        .select(`
          *,
          warehouses:warehouses!inner(id, code, name, branch_id)
        `)
        .eq('product_id', id)

      if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
        lotQuery = lotQuery.eq('warehouses.branch_id', profile.branch_id)
      }

      const { data: lotData } = await lotQuery.order('expiry_date', { ascending: true })

      if (lotData) {
        setLots(lotData as unknown as StockLot[])
      }

      // 4. Fetch warehouses for lot dropdown
      let whQuery = supabase
        .from('warehouses')
        .select('id, code, name, branch_id')
        .eq('is_active', true)

      if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
        whQuery = whQuery.eq('branch_id', profile.branch_id)
      }

      const { data: whData } = await whQuery

      if (whData) {
        setWarehouses(whData as unknown as WarehouseData[])
        if (whData.length > 0) {
          setNewWarehouseId(whData[0].id)
        }
      }

      // 5. Fetch price list items with details
      const { data: pliData } = await supabase
        .from('price_list_items')
        .select(`
          cost_price,
          selling_price,
          price_list:price_lists(id, code, name)
        `)
        .eq('product_id', id)

      if (pliData) {
        setPriceListItems(pliData)
      }

      // 6. Fetch stock movements (Thẻ kho)
      let moveQuery = supabase
        .from('stock_movements')
        .select(`
          id,
          created_at,
          movement_type,
          quantity,
          unit_cost,
          reference_id,
          reference_type,
          notes,
          stock_lots:lot_id(lot_number),
          warehouses:warehouse_id!inner(code, name, branch_id),
          profiles:performed_by(full_name)
        `)
        .eq('product_id', id)

      if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
        moveQuery = moveQuery.eq('warehouses.branch_id', profile.branch_id)
      }

      const { data: moveData } = await moveQuery.order('created_at', { ascending: false })

      if (moveData) {
        setMovements(moveData as unknown as StockMovement[])
      }
    } catch (err) {
      console.error('Error loading product details:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProductData()
  }, [id, profile?.branch_id, userRole?.code])

  // FEFO Simulation Logic
  useEffect(() => {
    if (lots.length === 0 || simulateQty <= 0) {
      setSimulatedAllocation([])
      setSimulationError('')
      return
    }

    // Filter and sort active lots replicating fn_allocate_lots_fefo
    const activeLots = [...lots]
      .filter(l => l.status === 'active' && l.quantity_on_hand > l.quantity_reserved)
      .sort((a, b) => {
        // Expiry Date ASC Nulls Last
        if (!a.expiry_date && !b.expiry_date) return 0
        if (!a.expiry_date) return 1
        if (!b.expiry_date) return -1
        const dateA = new Date(a.expiry_date).getTime()
        const dateB = new Date(b.expiry_date).getTime()
        if (dateA !== dateB) return dateA - dateB

        // Received At ASC
        const recA = new Date(a.received_at).getTime()
        const recB = new Date(b.received_at).getTime()
        return recA - recB
      })

    let remaining = simulateQty
    const allocationResult: { lotId: string; qty: number }[] = []

    for (const lot of activeLots) {
      if (remaining <= 0) break
      const available = lot.quantity_on_hand - lot.quantity_reserved
      const allocated = Math.min(remaining, available)
      if (allocated > 0) {
        allocationResult.push({ lotId: lot.id, qty: allocated })
        remaining -= allocated
      }
    }

    setSimulatedAllocation(allocationResult)
    if (remaining > 0) {
      setSimulationError(`Không đủ hàng tồn kho khả dụng để phân bổ. Thiếu ${remaining} đơn vị.`)
    } else {
      setSimulationError('')
    }
  }, [lots, simulateQty])

  // Currency formatting is retrieved from useDisplaySettings() context

  // Handle Quick Add Lot
  const handleAddLotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !newLotNumber.trim() || !newWarehouseId) {
      setLotError('Vui lòng nhập Mã lô và chọn kho hàng.')
      return
    }

    setLotError('')
    try {
      const { error } = await supabase
        .from('stock_lots')
        .insert({
          product_id: id,
          warehouse_id: newWarehouseId,
          lot_number: newLotNumber.trim().toUpperCase(),
          manufacture_date: newMfgDate || null,
          expiry_date: newExpDate || null,
          quantity_on_hand: newQty,
          quantity_reserved: 0,
          cost_price: newCostPrice,
          status: 'active'
        })

      if (error) {
        if (error.code === '23505') {
          throw new Error('Lô hàng này đã tồn tại trong kho này (Trùng số lô + kho).')
        }
        throw error
      }

      // Reset lot fields
      setNewLotNumber('')
      setNewMfgDate('')
      setNewExpDate('')
      setNewQty(100)
      setNewCostPrice(0)
      setIsAddingLot(false)

      // Reload
      loadProductData()
    } catch (err: any) {
      console.error('Error adding lot:', err)
      setLotError(err.message || 'Lỗi xảy ra khi thêm lô hàng.')
    }
  }

  // Generate Sample Mock Lots if DB is empty
  const handleSeedMockLots = async () => {
    if (!id || warehouses.length === 0) return
    try {
      const today = new Date()
      
      const expDate1 = new Date()
      expDate1.setMonth(today.getMonth() + 2) // Expires in 2 months (Earliest)
      
      const expDate2 = new Date()
      expDate2.setMonth(today.getMonth() + 8) // Expires in 8 months
      
      const expDate3 = new Date()
      expDate3.setMonth(today.getMonth() + 18) // Expires in 18 months

      const mockLotsToInsert = [
        {
          product_id: id,
          warehouse_id: warehouses[0].id,
          lot_number: 'LOT-EXP-CLOSE',
          manufacture_date: new Date(today.getFullYear(), today.getMonth() - 10, 1).toISOString().split('T')[0],
          expiry_date: expDate1.toISOString().split('T')[0],
          quantity_on_hand: 80,
          quantity_reserved: 10,
          cost_price: 150000,
          status: 'active'
        },
        {
          product_id: id,
          warehouse_id: warehouses[0].id,
          lot_number: 'LOT-EXP-MID',
          manufacture_date: new Date(today.getFullYear(), today.getMonth() - 4, 1).toISOString().split('T')[0],
          expiry_date: expDate2.toISOString().split('T')[0],
          quantity_on_hand: 200,
          quantity_reserved: 0,
          cost_price: 140000,
          status: 'active'
        },
        {
          product_id: id,
          warehouse_id: warehouses[0].id,
          lot_number: 'LOT-EXP-FAR',
          manufacture_date: today.toISOString().split('T')[0],
          expiry_date: expDate3.toISOString().split('T')[0],
          quantity_on_hand: 500,
          quantity_reserved: 20,
          cost_price: 135000,
          status: 'active'
        }
      ]

      await supabase.from('stock_lots').insert(mockLotsToInsert)
      loadProductData()
    } catch (err) {
      console.error('Error seeding lots:', err)
    }
  }

  if (loading) {
    return (
      <Layout activeMenu="Sản phẩm">
        <div className="py-32 flex flex-col items-center justify-center text-gray-400">
          <div className="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
          <span className="text-body-md">Đang tải chi tiết sản phẩm...</span>
        </div>
      </Layout>
    )
  }

  if (!product) {
    return (
      <Layout activeMenu="Sản phẩm">
        <div className="py-24 text-center text-gray-400">
          <AlertCircle className="mx-auto text-gray-300 mb-4" size={64} />
          <h2 className="text-display-xs font-bold text-gray-600">Sản phẩm không tồn tại</h2>
          <p className="mt-2 text-body-md">Sản phẩm có thể đã bị xóa hoặc đường dẫn không chính xác.</p>
          <button
            onClick={() => navigate('/products')}
            className="mt-6 px-4 py-2 bg-blue-500 text-gray-0 rounded-lg font-semibold hover:bg-blue-600 transition-colors"
          >
            Quay lại danh mục
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout activeMenu="Sản phẩm">
      <div className="p-4 md:p-8 max-w-[1600px] w-full mx-auto space-y-6">
        
        {/* Breadcrumb & Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <button
              onClick={() => navigate('/products')}
              className="flex items-center gap-1.5 text-body-md text-gray-400 hover:text-blue-500 transition-colors font-semibold"
            >
              <ChevronLeft size={16} />
              Quay lại danh mục sản phẩm
            </button>
            <div className="flex items-center flex-wrap gap-3 mt-1">
              <h2 className="text-display-xs font-bold text-gray-800">{product.name}</h2>
              <span className="px-2.5 py-0.5 bg-gray-50 border border-gray-100 text-gray-500 text-tiny font-semibold rounded-md uppercase">
                SKU: {product.sku}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${
                product.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-danger-500 border-red-100'
              }`}>
                {product.is_active ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="h-10 px-4 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg font-semibold text-body-md transition-all flex items-center gap-2"
            >
              <Edit size={16} className="text-gray-500" />
              Sửa chi tiết
            </button>
            <button
              onClick={() => navigate('/products/prices')}
              className="h-10 px-4 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2"
            >
              <Printer size={16} className="text-gray-400" />
              In nhãn sản phẩm
            </button>
            <button
              onClick={() => setIsAddingLot(true)}
              className="h-10 px-4 bg-blue-50 text-blue-500 border border-blue-100 rounded-lg font-semibold text-body-md hover:bg-blue-100 active:scale-95 transition-all flex items-center gap-2 shadow-sm"
            >
              <Plus size={16} />
              Nhập kho / Thêm lô hàng
            </button>
          </div>
        </div>

        {/* Two-Column Grid */}
        <div className="grid grid-cols-12 gap-8">
          
          {/* Left Column - Product Profile (1/3 width) */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            
            {/* Image Gallery */}
            <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col items-center">
              <div className="aspect-square bg-gray-50 w-full rounded-lg mb-4 flex items-center justify-center overflow-hidden border border-gray-100">
                <ProductImage
                  src={product.image_urls?.[0]}
                  alt={product.name}
                  fit="contain"
                  fallbackClassName="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center text-gray-400"
                />
              </div>
              <div className="text-center">
                <span className="text-tiny font-bold text-gray-400 uppercase tracking-widest">Đơn vị cơ bản</span>
                <p className="text-body-lg font-bold text-gray-700 capitalize mt-0.5">{product.unit}</p>
              </div>
            </div>

            {/* Legal / Spec details */}
            <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                <Bookmark className="text-blue-500" size={18} />
                <h3 className="font-bold text-body-lg text-gray-700">Thông tin pháp lý</h3>
              </div>
              <div className="space-y-3.5 text-body-md">
                <div>
                  <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Số Đăng Ký (SDK)</span>
                  <span className="font-semibold text-gray-700">{product.registration_number || 'Chưa đăng ký'}</span>
                </div>
                <div>
                  <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Nhà sản xuất</span>
                  <span className="font-semibold text-gray-700">{product.brands?.name || 'Sanh Long Pharma Co., Ltd'}</span>
                </div>
                <div>
                  <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Quốc gia xuất xứ</span>
                  <span className="font-semibold text-gray-700">{product.brands?.country || 'Việt Nam'}</span>
                </div>
                <div>
                  <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Phân loại</span>
                  <span className="font-semibold text-gray-700">{product.product_categories?.name || 'Thuốc thú y'}</span>
                </div>
              </div>
            </div>

            {/* Active Composition/Ingredients */}
            <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                <Activity className="text-blue-500" size={18} />
                <h3 className="font-bold text-body-lg text-gray-700">Thành phần hoạt chất</h3>
              </div>
              <div className="space-y-2">
                {productIngredients.length === 0 ? (
                  <p className="text-tiny text-gray-400 italic py-2">Không có thành phần hoạt chất cụ thể.</p>
                ) : (
                  productIngredients.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <span className="font-semibold text-gray-700 text-body-md">{item.active_ingredient?.name}</span>
                      <span className="font-bold text-blue-500 text-body-md">{item.percentage_or_dosage}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Disease Indications */}
            <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                <Bookmark className="text-emerald-500" size={18} />
                <h3 className="font-bold text-body-lg text-gray-700">Chỉ định điều trị</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {productIndications.length === 0 ? (
                  <p className="text-tiny text-gray-400 italic py-2">Chưa gán chỉ định điều trị.</p>
                ) : (
                  productIndications.map((item, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-emerald-50 border border-emerald-100 text-emerald-700 text-body-sm font-semibold rounded-lg shadow-sm"
                    >
                      {item.disease?.name} ({item.disease?.code})
                    </span>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Right Column - Tabs and Tables (2/3 width) */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            
            {/* Tab System Card */}
            <div className="bg-gray-0 border border-gray-100 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[500px]">
              
              {/* Tab Header Buttons */}
              <div className="flex border-b border-gray-100 bg-gray-50">
                <button
                  onClick={() => setActiveTab('instructions')}
                  className={`flex-1 py-4 px-6 font-semibold text-body-md border-b-2 transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'instructions'
                      ? 'border-blue-500 text-blue-600 bg-gray-0'
                      : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'
                  }`}
                >
                  <Info size={16} />
                  Thông số & Hướng dẫn
                </button>
                <button
                  onClick={() => setActiveTab('inventory')}
                  className={`flex-1 py-4 px-6 font-semibold text-body-md border-b-2 transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'inventory'
                      ? 'border-blue-500 text-blue-600 bg-gray-0'
                      : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'
                  }`}
                >
                  <Layers size={16} />
                  Phiên bản & Lô hàng
                </button>
                <button
                  onClick={() => setActiveTab('ledger')}
                  className={`flex-1 py-4 px-6 font-semibold text-body-md border-b-2 transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'ledger'
                      ? 'border-blue-500 text-blue-600 bg-gray-0'
                      : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'
                  }`}
                >
                  <Warehouse size={16} />
                  Thẻ kho (Lịch sử biến động)
                </button>
              </div>

              {/* Tab Content Canvas */}
              <div className="p-6 md:p-8 flex-1">
                
                {/* ────────────────── Tab 1: Instructions ────────────────── */}
                {activeTab === 'instructions' && (
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-bold text-body-lg text-gray-700 flex items-center gap-2 mb-2">
                        <span className="w-1.5 h-4 bg-red-500 rounded-full" />
                        Chống chỉ định & Cảnh báo an toàn
                      </h4>
                      <div className="p-4 bg-red-50/50 border border-red-100 rounded-lg text-red-700 text-body-md leading-relaxed">
                        {product.contraindications || 'Không sử dụng cho các động vật mẫn cảm với thành phần của thuốc/vaccine. Tránh để thuốc tiếp xúc trực tiếp với da, mắt. Đối với các sản phẩm dạng tiêm, đảm bảo tuân thủ nghiêm ngặt kỹ thuật vô trùng.'}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-body-lg text-gray-700 flex items-center gap-2 mb-2">
                        <span className="w-1.5 h-4 bg-blue-500 rounded-full" />
                        Điều kiện bảo quản
                      </h4>
                      <p className="text-body-md text-gray-600 leading-relaxed bg-gray-50 border border-gray-100 p-4 rounded-lg">
                        {product.storage_condition || 'Bảo quản nơi khô ráo thoáng mát, tránh ánh sáng trực tiếp, nhiệt độ phòng dưới 30°C.'}
                      </p>
                    </div>

                    <div>
                      <h4 className="font-bold text-body-lg text-gray-700 flex items-center gap-2 mb-2">
                        <span className="w-1.5 h-4 bg-emerald-500 rounded-full" />
                        Hướng dẫn sử dụng & Liều lượng
                      </h4>
                      <p className="text-body-md text-gray-600 leading-relaxed bg-gray-50 border border-gray-100 p-4 rounded-lg">
                        {product.usage_instructions || 'Pha nước uống hoặc trộn thức ăn theo tỷ lệ khuyến nghị của bác sĩ thú y hoặc nhãn thuốc.'}
                      </p>
                    </div>

                    <div>
                      <h4 className="font-bold text-body-lg text-gray-700 flex items-center gap-2 mb-2">
                        <span className="w-1.5 h-4 bg-amber-500 rounded-full" />
                        Thời gian ngưng sử dụng thuốc
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-amber-50/20 border border-amber-100 rounded-lg flex items-center justify-between text-body-md">
                          <span className="text-gray-500">Khai thác thịt:</span>
                          <span className="font-bold text-amber-700">
                            {product.withdrawal_period_meat !== null && product.withdrawal_period_meat !== undefined 
                              ? `${String(product.withdrawal_period_meat).padStart(2, '0')} ngày` 
                              : '00 ngày'}
                          </span>
                        </div>
                        <div className="p-4 bg-amber-50/20 border border-amber-100 rounded-lg flex items-center justify-between text-body-md">
                          <span className="text-gray-500">Khai thác sữa/trứng:</span>
                          <span className="font-bold text-amber-700">
                            {product.withdrawal_period_milk_egg !== null && product.withdrawal_period_milk_egg !== undefined 
                              ? `${String(product.withdrawal_period_milk_egg).padStart(2, '0')} ngày` 
                              : '00 ngày'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ────────────────── Tab 2: Inventory (Lots, FEFO) ────────────────── */}
                {activeTab === 'inventory' && (
                  <div className="space-y-8">
                    
                    {/* Variants Section */}
                    <div>
                      <h4 className="font-bold text-body-lg text-gray-700 mb-3">Phiên bản đóng gói (Variants)</h4>
                      {variants.length === 0 ? (
                        <div className="p-4 bg-gray-50 rounded-lg text-body-md text-gray-400 border border-gray-100 flex items-center gap-2">
                          <Info size={16} />
                          <span>Không có biến thể phụ. Sản phẩm sử dụng quy cách đóng gói cơ bản: <strong>{product.package_specs || 'Mặc định'}</strong>.</span>
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-gray-100 rounded-lg">
                          <table className="w-full text-left border-collapse bg-gray-0 text-body-md">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="p-3 text-gray-500 font-semibold">Mã SKU</th>
                                <th className="p-3 text-gray-500 font-semibold">Tên quy cách</th>
                                <th className="p-3 text-gray-500 font-semibold">Thuộc tính</th>
                                <th className="p-3 text-gray-500 font-semibold">Đơn vị</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {variants.map(v => (
                                <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                                  <td className="p-3 font-semibold text-gray-700">{v.sku_variant}</td>
                                  <td className="p-3">{v.name}</td>
                                  <td className="p-3 text-gray-500 text-tiny">
                                    {JSON.stringify(v.attributes)}
                                  </td>
                                  <td className="p-3 text-gray-500">{product.unit}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Stock Lots Section */}
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-bold text-body-lg text-gray-700">Lô hàng đang lưu kho</h4>
                        {lots.length === 0 && (
                          <button
                            onClick={handleSeedMockLots}
                            className="text-blue-500 hover:text-blue-600 text-tiny font-bold flex items-center gap-1.5"
                          >
                            <Plus size={14} />
                            Tạo nhanh lô hàng mẫu để test FEFO
                          </button>
                        )}
                      </div>

                      {lots.length === 0 ? (
                        <div className="p-8 border border-dashed border-gray-200 rounded-xl text-center flex flex-col items-center justify-center">
                          <Warehouse className="text-gray-300 mb-2" size={32} />
                          <p className="text-body-md font-semibold text-gray-500 mb-1">Kho trống / Chưa có lô hàng</p>
                          <p className="text-tiny text-gray-400 max-w-sm mb-4">Vui lòng nhập kho hoặc tạo lô hàng mẫu để theo dõi hạn sử dụng sản phẩm.</p>
                          <button
                            onClick={() => setIsAddingLot(true)}
                            className="h-9 px-4 bg-blue-50 text-blue-600 border border-blue-150 rounded-lg text-tiny font-bold hover:bg-blue-100 transition-all flex items-center gap-1.5"
                          >
                            <Plus size={14} />
                            Thêm lô hàng đầu tiên
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {lots.map(lot => {
                            const isExpired = lot.expiry_date && new Date(lot.expiry_date) < new Date()
                            const availableQty = lot.quantity_on_hand - lot.quantity_reserved
                            return (
                              <div
                                key={lot.id}
                                className={`p-4 border rounded-xl shadow-sm relative overflow-hidden bg-gray-0 transition-all hover:border-gray-350 ${
                                  isExpired ? 'border-red-100 bg-red-50/10' : 'border-gray-100'
                                }`}
                              >
                                {/* Status badges */}
                                <div className="absolute top-3 right-3 flex items-center gap-1">
                                  {isExpired && (
                                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold">
                                      Hết hạn
                                    </span>
                                  )}
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    lot.status === 'active' 
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                      : 'bg-gray-100 text-gray-600 border border-gray-200'
                                  }`}>
                                    {lot.status === 'active' ? 'Đang bán' : 'Khóa'}
                                  </span>
                                </div>

                                <span className="text-[10px] font-bold text-gray-400 uppercase block">Số lô</span>
                                <p className="font-bold text-body-lg text-gray-700 mb-2">{lot.lot_number}</p>
                                
                                <div className="grid grid-cols-2 gap-2 text-tiny">
                                  <div>
                                    <span className="text-gray-400 block font-medium">Kho chứa</span>
                                    <span className="font-semibold text-gray-600">{lot.warehouses?.name || 'Kho mặc định'}</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 block font-medium">Hạn sử dụng</span>
                                    <span className={`font-semibold ${isExpired ? 'text-red-500' : 'text-gray-600'}`}>
                                      {lot.expiry_date ? new Date(lot.expiry_date).toLocaleDateString('vi-VN') : 'Không hạn'}
                                    </span>
                                  </div>
                                  <div className="col-span-2 pt-2 border-t border-gray-100 mt-2 flex justify-between items-end">
                                    <div>
                                      <span className="text-gray-400 block font-medium">Giá vốn nhập</span>
                                      <span className="font-bold text-gray-600">{formatCurrency(lot.cost_price)}</span>
                                    </div>
                                    <div className="text-right">
                                      <span className="text-gray-400 block font-medium">Khả dụng / Tồn kho</span>
                                      <span className="font-bold text-body-md text-gray-700">
                                        {availableQty} / {lot.quantity_on_hand} <span className="text-[10px] text-gray-400">{product.unit}</span>
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* FEFO Simulator Widget */}
                    {lots.length > 0 && (
                      <div className="p-6 bg-blue-50/30 border border-blue-100 rounded-xl space-y-4">
                        <div className="flex items-center gap-2">
                          <Play className="text-blue-500 fill-blue-500" size={18} />
                          <h4 className="font-bold text-body-lg text-blue-700">FEFO Allocation Simulator</h4>
                        </div>
                        <p className="text-tiny text-blue-600 leading-normal">
                          Nhập số lượng bạn muốn bán/xuất kho. Trình mô phỏng sẽ tính toán các lô hàng được chọn đầu tiên 
                          theo nguyên lý <strong>First Expired First Out (Hết hạn trước - Xuất trước)</strong>.
                        </p>

                        <div className="flex items-center gap-3">
                          <div className="w-48">
                            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Số lượng xuất</label>
                            <input
                              type="number"
                              min={1}
                              className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 font-semibold focus:outline-none focus:border-blue-500"
                              value={simulateQty}
                              onChange={e => setSimulateQty(Math.max(1, Number(e.target.value)))}
                            />
                          </div>
                          <span className="text-body-md font-medium text-gray-500 mt-5">{product.unit}</span>
                        </div>

                        {/* Error Alert */}
                        {simulationError && (
                          <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-tiny flex items-center gap-2">
                            <ShieldAlert size={16} className="flex-shrink-0" />
                            <span>{simulationError}</span>
                          </div>
                        )}

                        {/* Simulated Result list */}
                        <div className="space-y-2 pt-2">
                          <span className="block text-tiny font-bold text-gray-500 uppercase">Đề xuất phân bổ chi tiết:</span>
                          {simulatedAllocation.length === 0 ? (
                            <p className="text-tiny text-gray-400 italic">Không có đề xuất (Vui lòng kiểm tra lại tồn kho)</p>
                          ) : (
                            <div className="space-y-1.5">
                              {simulatedAllocation.map((alloc, idx) => {
                                const lotObj = lots.find(l => l.id === alloc.lotId)
                                return (
                                  <div key={alloc.lotId} className="flex items-center justify-between text-body-md p-2.5 bg-gray-0 border border-gray-100 rounded-lg shadow-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full flex items-center justify-center">
                                        {idx + 1}
                                      </span>
                                      <span className="font-semibold text-gray-700">{lotObj?.lot_number}</span>
                                      <span className="text-tiny text-gray-400">(Hạn: {lotObj?.expiry_date ? new Date(lotObj.expiry_date).toLocaleDateString('vi-VN') : 'Không hạn'})</span>
                                    </div>
                                    <div className="text-right font-bold text-blue-600">
                                      {alloc.qty} {product.unit}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
 
                   </div>
                 )}
 
                 {/* ────────────────── Tab 3: Thẻ kho (Lịch sử biến động) ────────────────── */}
                 {activeTab === 'ledger' && (() => {
                   const getMovementTypeLabel = (type: string) => {
                     const labels: Record<string, string> = {
                       receipt: 'Nhập hàng NCC',
                       sale: 'Xuất bán POS',
                       return_from_customer: 'Nhập trả hàng',
                       return_to_supplier: 'Xuất trả NCC',
                       transfer_out: 'Xuất chuyển kho',
                       transfer_in: 'Nhập chuyển kho',
                       adjustment_increase: 'Điều chỉnh (+)',
                       adjustment_decrease: 'Điều chỉnh (-)',
                       expiry_writeoff: 'Hủy hết hạn',
                       damage_writeoff: 'Hủy hỏng hóc'
                     }
                     return labels[type] || 'Biến động khác'
                   }

                   return (
                     <div className="space-y-6 animate-in fade-in duration-200">
                       <div className="flex justify-between items-center">
                         <h4 className="font-bold text-body-lg text-gray-700">Thẻ kho / Lịch sử biến động tồn kho</h4>
                         <span className="text-tiny bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-bold">
                           Tổng cộng {movements.length} giao dịch
                         </span>
                       </div>

                       {movements.length === 0 ? (
                         <div className="py-12 border border-dashed border-gray-100 rounded-xl text-center text-gray-400 text-body-md">
                           Chưa có giao dịch xuất nhập kho nào được ghi nhận cho sản phẩm này.
                         </div>
                       ) : (
                         <div className="overflow-x-auto border border-gray-100 rounded-xl shadow-sm">
                           <table className="w-full text-left border-collapse bg-gray-0 text-body-md">
                             <thead>
                               <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold">
                                 <th className="p-4">Thời gian</th>
                                 <th className="p-4">Loại giao dịch</th>
                                 <th className="p-4">Kho hàng</th>
                                 <th className="p-4">Số lô</th>
                                 <th className="p-4 text-right">Biến động</th>
                                 <th className="p-4 text-right">Giá vốn</th>
                                 <th className="p-4">Thực hiện</th>
                                 <th className="p-4">Mô tả / Ghi chú</th>
                               </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-100 text-gray-600">
                               {movements.map((move) => {
                                 const isPositive = move.quantity > 0
                                 return (
                                   <tr key={move.id} className="hover:bg-gray-50/50 transition-colors">
                                     <td className="p-4 whitespace-nowrap tabular-nums text-tiny text-gray-500">
                                       {new Date(move.created_at).toLocaleString('vi-VN')}
                                     </td>
                                     <td className="p-4 whitespace-nowrap">
                                       <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${
                                         isPositive
                                           ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                           : 'bg-red-50 text-red-700 border-red-100'
                                       }`}>
                                         {getMovementTypeLabel(move.movement_type)}
                                       </span>
                                     </td>
                                     <td className="p-4 font-semibold text-gray-700">
                                       {move.warehouses?.name || 'Kho mặc định'}
                                     </td>
                                     <td className="p-4 font-mono font-bold text-tiny text-gray-500">
                                       {move.stock_lots?.lot_number || '---'}
                                     </td>
                                     <td className={`p-4 text-right font-bold tabular-nums text-body-md ${
                                       isPositive ? 'text-emerald-600' : 'text-red-600'
                                     }`}>
                                       {isPositive ? '+' : ''}{move.quantity} {product.unit}
                                     </td>
                                     <td className="p-4 text-right font-semibold text-gray-700 tabular-nums">
                                       {move.unit_cost ? formatCurrency(move.unit_cost) : '---'}
                                     </td>
                                     <td className="p-4 text-body-sm font-medium text-gray-500">
                                       {move.profiles?.full_name || 'Hệ thống'}
                                     </td>
                                     <td className="p-4 text-tiny text-gray-400 max-w-xs truncate" title={move.notes || ''}>
                                       {move.notes || 'Không có ghi chú'}
                                     </td>
                                   </tr>
                                 )
                               })}
                             </tbody>
                           </table>
                         </div>
                       )}
                     </div>
                   )
                 })()}

              </div>
            </div>

          </div>

        </div>

      </div>

      {/* Quick Lot Adder Modal/Drawer */}
      {isAddingLot && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-0 w-full max-w-lg rounded-2xl shadow-2xl p-6 overflow-y-auto max-h-[90vh] space-y-5 animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-bold text-body-lg text-gray-800">Thêm lô hàng mới (Nhập kho)</h3>
                <p className="text-tiny text-gray-400">Thiết lập số lô, hạn dùng và giá vốn ban đầu cho kho hàng</p>
              </div>
              <button
                onClick={() => {
                  setLotError('')
                  setIsAddingLot(false)
                }}
                className="text-gray-400 hover:bg-gray-50 p-1.5 rounded-full"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Error Message */}
            {lotError && (
              <div className="p-3.5 bg-red-50 border border-red-100 rounded-lg text-red-600 text-body-md flex items-start gap-2">
                <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" />
                <span>{lotError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAddLotSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Số Lô <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: LOT-2026-001"
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 font-semibold uppercase"
                    value={newLotNumber}
                    onChange={e => setNewLotNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Kho chứa <span className="text-red-500">*</span></label>
                  <select
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0"
                    value={newWarehouseId}
                    onChange={e => setNewWarehouseId(e.target.value)}
                  >
                    {warehouses.map(wh => (
                      <option key={wh.id} value={wh.id}>
                        {wh.name} ({wh.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Ngày sản xuất</label>
                  <input
                    type="date"
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3"
                    value={newMfgDate}
                    onChange={e => setNewMfgDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Hạn sử dụng <span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    required
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 font-semibold"
                    value={newExpDate}
                    onChange={e => setNewExpDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Số lượng nhập</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3"
                    value={newQty}
                    onChange={e => setNewQty(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">Giá vốn nhập ({settings.currency_symbol})</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3"
                    value={newCostPrice || ''}
                    onChange={e => setNewCostPrice(Number(e.target.value))}
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Actions Footer */}
              <div className="border-t border-gray-100 pt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddingLot(false)}
                  className="h-10 px-5 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50 transition-all"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="h-10 px-6 bg-blue-500 text-gray-0 rounded-lg text-body-md font-bold hover:bg-blue-600 transition-all flex items-center gap-1.5"
                >
                  <Check size={16} />
                  Nhập kho
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <EditProductModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={loadProductData}
        productId={id || ''}
      />
    </Layout>
  )
}
