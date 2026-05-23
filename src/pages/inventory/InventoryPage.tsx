import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Plus,
  Warehouse as WarehouseIcon,
  Layers,
  FileText,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  ShieldAlert,
  Settings,
  HelpCircle,
  Filter,
  CheckCircle2,
  Calendar,
  ChevronDown
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface StockLot {
  id: string
  lot_number: string
  manufacture_date: string | null
  expiry_date: string | null
  cost_price: number
  quantity_on_hand: number
  status: string
  product: {
    id: string
    name: string
    sku: string
    category: {
      name: string
    } | null
  }
  warehouse: {
    id: string
    name: string
  }
  supplier: {
    id: string
    name: string
  } | null
}

interface PurchaseOrder {
  id: string
  po_code: string
  status: string
  expected_date: string | null
  grand_total: number
  created_at: string
  supplier: {
    name: string
  }
  warehouse: {
    name: string
  }
}

interface GoodsReceipt {
  id: string
  receipt_code: string
  receipt_date: string
  total_amount: number
  notes: string | null
  supplier: {
    name: string
  }
  warehouse: {
    name: string
  }
  profile: {
    full_name: string
  } | null
}

interface InventorySetting {
  id: string
  product_id: string
  warehouse_id: string
  min_stock_level: number
  max_stock_level: number | null
  product: {
    sku: string
    name: string
  }
  warehouse: {
    name: string
  }
}

export default function InventoryPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'lots' | 'pos' | 'receipts' | 'settings'>('lots')

  // Shared States
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  
  // Tab 1: Stock Lots states
  const [lots, setLots] = useState<StockLot[]>([])
  const [lotSearchTerm, setLotSearchTerm] = useState('')
  const [whFilter, setWhFilter] = useState('all')
  const [lotQuickFilter, setLotQuickFilter] = useState<'all' | 'near-expiry' | 'low-stock' | 'quarantine'>('all')

  // Tab 2: POs states
  const [pos, setPOs] = useState<PurchaseOrder[]>([])
  const [poSearchTerm, setPoSearchTerm] = useState('')

  // Tab 3: Receipts states
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [receiptSearchTerm, setReceiptSearchTerm] = useState('')

  // Tab 4: Settings/Low stock alerts states
  const [invSettings, setInvSettings] = useState<InventorySetting[]>([])
  const [newSetting, setNewSetting] = useState({
    productId: '',
    warehouseId: '',
    minStock: 10,
    maxStock: 500
  })
  const [productList, setProductList] = useState<{ id: string; name: string; sku: string }[]>([])
  const [isEditingSetting, setIsEditingSetting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Fetch reference data (Warehouses)
  useEffect(() => {
    const fetchWarehouses = async () => {
      const { data } = await supabase.from('warehouses').select('id, name')
      if (data) setWarehouses(data)
    }
    fetchWarehouses()
  }, [])

  // Load Tab Specific Data
  useEffect(() => {
    const loadTabData = async () => {
      setLoading(true)
      try {
        if (activeTab === 'lots') {
          // Fetch stock lots
          const { data, error } = await supabase
            .from('stock_lots')
            .select(`
              id,
              lot_number,
              manufacture_date,
              expiry_date,
              cost_price,
              quantity_on_hand,
              status,
              product:products(
                id,
                sku,
                name,
                category:product_categories(name)
              ),
              warehouse:warehouses(id, name),
              supplier:suppliers(id, name)
            `)
            .order('expiry_date', { ascending: true })

          if (error) throw error
          
          const formattedLots = (data || []).map((lot: any) => ({
            id: lot.id,
            lot_number: lot.lot_number,
            manufacture_date: lot.manufacture_date,
            expiry_date: lot.expiry_date,
            cost_price: Number(lot.cost_price),
            quantity_on_hand: lot.quantity_on_hand,
            status: lot.status,
            product: {
              id: lot.product?.id || '',
              sku: lot.product?.sku || '',
              name: lot.product?.name || 'Sản phẩm không rõ',
              category: lot.product?.category ? { name: lot.product.category.name } : null
            },
            warehouse: {
              id: lot.warehouse?.id || '',
              name: lot.warehouse?.name || 'Kho không xác định'
            },
            supplier: lot.supplier ? {
              id: lot.supplier.id,
              name: lot.supplier.name
            } : null
          }))

          setLots(formattedLots)
        } else if (activeTab === 'pos') {
          // Fetch Purchase Orders
          const { data, error } = await supabase
            .from('purchase_orders')
            .select(`
              id,
              po_code,
              status,
              expected_date,
              grand_total,
              created_at,
              supplier:suppliers(name),
              warehouse:warehouses(name)
            `)
            .order('created_at', { ascending: false })

          if (error) throw error
          
          const formattedPOs = (data || []).map((po: any) => ({
            id: po.id,
            po_code: po.po_code,
            status: po.status,
            expected_date: po.expected_date,
            grand_total: Number(po.grand_total),
            created_at: po.created_at,
            supplier: {
              name: po.supplier?.name || 'Nhà cung cấp không xác định'
            },
            warehouse: {
              name: po.warehouse?.name || 'Kho không xác định'
            }
          }))

          setPOs(formattedPOs)
        } else if (activeTab === 'receipts') {
          // Fetch Goods Receipts
          const { data, error } = await supabase
            .from('goods_receipts')
            .select(`
              id,
              receipt_code,
              receipt_date,
              total_amount,
              notes,
              supplier:suppliers(name),
              warehouse:warehouses(name),
              profile:profiles(full_name)
            `)
            .order('receipt_date', { ascending: false })

          if (error) throw error
          
          const formattedReceipts = (data || []).map((gr: any) => ({
            id: gr.id,
            receipt_code: gr.receipt_code,
            receipt_date: gr.receipt_date,
            total_amount: Number(gr.total_amount),
            notes: gr.notes,
            supplier: {
              name: gr.supplier?.name || 'Nhà cung cấp không xác định'
            },
            warehouse: {
              name: gr.warehouse?.name || 'Kho không xác định'
            },
            profile: gr.profile ? {
              full_name: gr.profile.full_name
            } : null
          }))

          setReceipts(formattedReceipts)
        } else if (activeTab === 'settings') {
          // Fetch low stock settings
          const { data: settingsData } = await supabase
            .from('inventory_settings')
            .select(`
              id,
              product_id,
              warehouse_id,
              min_stock_level,
              max_stock_level,
              product:products(sku, name),
              warehouse:warehouses(name)
            `)
          
          const formattedSettings = (settingsData || []).map((set: any) => ({
            id: set.id,
            product_id: set.product_id,
            warehouse_id: set.warehouse_id,
            min_stock_level: set.min_stock_level,
            max_stock_level: set.max_stock_level,
            product: {
              sku: set.product?.sku || '',
              name: set.product?.name || 'Sản phẩm không rõ'
            },
            warehouse: {
              name: set.warehouse?.name || 'Kho không rõ'
            }
          }))
          
          setInvSettings(formattedSettings)

          // Fetch products for list creation
          const { data: prodData } = await supabase.from('products').select('id, name, sku')
          if (prodData) setProductList(prodData)
        }
      } catch (err: any) {
        console.error('Error fetching inventory tab data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadTabData()
  }, [activeTab])

  // Filtered Stock Lots logic
  const filteredLots = lots.filter(lot => {
    // 1. Search term match
    const searchMatch = 
      lot.product.name.toLowerCase().includes(lotSearchTerm.toLowerCase()) ||
      lot.product.sku.toLowerCase().includes(lotSearchTerm.toLowerCase()) ||
      lot.lot_number.toLowerCase().includes(lotSearchTerm.toLowerCase())

    // 2. Warehouse Filter match
    const whMatch = whFilter === 'all' || lot.warehouse.id === whFilter

    // 3. Quick Badges filter logic
    let quickMatch = true
    if (lotQuickFilter === 'near-expiry') {
      if (!lot.expiry_date) {
        quickMatch = false
      } else {
        const expiryTime = new Date(lot.expiry_date).getTime()
        const nowTime = new Date().getTime()
        const daysToExpiry = (expiryTime - nowTime) / (1000 * 60 * 60 * 24)
        quickMatch = daysToExpiry >= 0 && daysToExpiry <= 30 // expiring in less than 30 days
      }
    } else if (lotQuickFilter === 'low-stock') {
      quickMatch = lot.quantity_on_hand <= 15 // threshold low stock level
    } else if (lotQuickFilter === 'quarantine') {
      quickMatch = lot.status === 'quarantine'
    }

    return searchMatch && whMatch && quickMatch
  })

  // Filtered POs logic
  const filteredPOs = pos.filter(po => {
    return (
      po.po_code.toLowerCase().includes(poSearchTerm.toLowerCase()) ||
      po.supplier.name.toLowerCase().includes(poSearchTerm.toLowerCase())
    )
  })

  // Filtered Receipts logic
  const filteredReceipts = receipts.filter(gr => {
    return (
      gr.receipt_code.toLowerCase().includes(receiptSearchTerm.toLowerCase()) ||
      gr.supplier.name.toLowerCase().includes(receiptSearchTerm.toLowerCase())
    )
  })

  // Create Inventory Setting Submit
  const handleCreateSetting = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSetting.productId || !newSetting.warehouseId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn đầy đủ Sản phẩm và Kho hàng.' })
      return
    }

    try {
      const { error } = await supabase
        .from('inventory_settings')
        .insert([{
          product_id: newSetting.productId,
          warehouse_id: newSetting.warehouseId,
          min_stock_level: Number(newSetting.minStock),
          max_stock_level: Number(newSetting.maxStock)
        }])

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Thêm định mức tồn kho thành công!' })
      setIsEditingSetting(false)
      // Reload settings tab
      const { data: settingsData } = await supabase
        .from('inventory_settings')
        .select(`
          id,
          product_id,
          warehouse_id,
          min_stock_level,
          max_stock_level,
          product:products(sku, name),
          warehouse:warehouses(name)
        `)
      
      const formatted = (settingsData || []).map((set: any) => ({
        id: set.id,
        product_id: set.product_id,
        warehouse_id: set.warehouse_id,
        min_stock_level: set.min_stock_level,
        max_stock_level: set.max_stock_level,
        product: {
          sku: set.product?.sku || '',
          name: set.product?.name || 'Sản phẩm không rõ'
        },
        warehouse: {
          name: set.warehouse?.name || 'Kho không rõ'
        }
      }))
      setInvSettings(formatted)

    } catch (err: any) {
      console.error('Error saving inventory setting:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi thiết lập định mức: ' + err.message })
    }
  }

  // Auto-clear alert
  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [alertMsg])

  return (
    <Layout activeMenu="Kho hàng">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6">
        
        {/* Alerts toast */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-headline-lg font-bold text-gray-800">Quản lý Kho & Giao dịch Kho</h1>
            <p className="text-body-md text-gray-500">Giám sát tồn kho thực tế, lô hạn dùng (FEFO) và luồng cung ứng nhập hàng</p>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/purchase-orders/new')}
              className="bg-white text-gray-600 border border-gray-100 px-4 py-2.5 rounded-lg font-semibold text-body-md hover:bg-gray-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus size={16} />
              <span>Tạo đơn PO</span>
            </button>
            <button
              onClick={() => navigate('/goods-receipts/new')}
              className="bg-blue-500 text-white px-4 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
            >
              <WarehouseIcon size={16} />
              <span>Nhập kho thực tế</span>
            </button>
          </div>
        </div>

        {/* Tab Selection Headers */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-100 px-6 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('lots')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'lots'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Layers size={16} />
              <span>Tồn kho theo lô</span>
            </button>
            
            <button
              onClick={() => setActiveTab('pos')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'pos'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <FileText size={16} />
              <span>Đơn mua hàng (PO)</span>
            </button>

            <button
              onClick={() => setActiveTab('receipts')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'receipts'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <WarehouseIcon size={16} />
              <span>Phiếu nhập kho</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Settings size={16} />
              <span>Định mức an toàn</span>
            </button>
          </div>

          {/* TAB CONTENT: STOCK LOTS */}
          {activeTab === 'lots' && (
            <div className="p-6 space-y-6">
              {/* Search & Filters */}
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="text"
                    placeholder="Tìm SKU, tên sản phẩm, số lô..."
                    value={lotSearchTerm}
                    onChange={(e) => setLotSearchTerm(e.target.value)}
                    className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  {/* Warehouse Filter */}
                  <select
                    value={whFilter}
                    onChange={(e) => setWhFilter(e.target.value)}
                    className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
                  >
                    <option value="all">Tất cả kho</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>

                  {/* Quick Filters Badges */}
                  <button
                    onClick={() => setLotQuickFilter('all')}
                    className={`px-4 h-10 rounded-lg text-body-md font-semibold border transition-all ${
                      lotQuickFilter === 'all'
                        ? 'bg-blue-50 text-blue-700 border-blue-100'
                        : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    Tất cả lô
                  </button>
                  <button
                    onClick={() => setLotQuickFilter('near-expiry')}
                    className={`px-4 h-10 rounded-lg text-body-md font-semibold border transition-all flex items-center gap-1.5 ${
                      lotQuickFilter === 'near-expiry'
                        ? 'bg-amber-50 text-amber-700 border-amber-100'
                        : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <Clock size={14} />
                    <span>Cận hạn (&lt; 30 ngày)</span>
                  </button>
                  <button
                    onClick={() => setLotQuickFilter('low-stock')}
                    className={`px-4 h-10 rounded-lg text-body-md font-semibold border transition-all flex items-center gap-1.5 ${
                      lotQuickFilter === 'low-stock'
                        ? 'bg-red-50 text-red-700 border-red-100'
                        : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <ShieldAlert size={14} />
                    <span>Tồn kho thấp</span>
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    <span>Đang tải danh sách tồn lô...</span>
                  </div>
                ) : filteredLots.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 space-y-2">
                    <Layers className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="font-semibold text-body-lg">Không tìm thấy lô hàng nào</p>
                    <p className="text-body-md">Vui lòng điều chỉnh điều kiện lọc hoặc nhập kho thêm.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Sản phẩm / SKU</th>
                        <th className="px-6 py-4">Kho</th>
                        <th className="px-6 py-4">Số lô</th>
                        <th className="px-6 py-4 text-center">Hạn sử dụng (HSD)</th>
                        <th className="px-6 py-4 text-right">Giá vốn lô (₫)</th>
                        <th className="px-6 py-4 text-center">Tồn kho khả dụng</th>
                        <th className="px-6 py-4 text-center">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {filteredLots.map((lot) => {
                        const isExpired = lot.expiry_date && new Date(lot.expiry_date).getTime() < new Date().getTime()
                        const isNearExpiry = lot.expiry_date && !isExpired && 
                          (new Date(lot.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) <= 30

                        return (
                          <tr key={lot.id} className="hover:bg-gray-25/50 transition-colors">
                            <td className="px-6 py-4">
                              <div>
                                <p className="font-bold text-gray-800">{lot.product.name}</p>
                                <span className="text-gray-400 font-mono text-tiny">SKU: {lot.product.sku}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 font-semibold text-gray-700">{lot.warehouse.name}</td>
                            <td className="px-6 py-4 font-mono font-bold text-blue-500">{lot.lot_number}</td>
                            <td className="px-6 py-4 text-center font-medium">
                              {lot.expiry_date ? (
                                <div className="space-y-0.5">
                                  <span>{new Date(lot.expiry_date).toLocaleDateString('vi-VN')}</span>
                                  {isExpired && (
                                    <span className="block text-[10px] text-red-500 font-bold uppercase font-mono">Hết hạn</span>
                                  )}
                                  {isNearExpiry && (
                                    <span className="block text-[10px] text-amber-500 font-bold uppercase font-mono">Cận date</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-300">Không quản lý HSD</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right font-semibold text-gray-700">
                              {lot.cost_price.toLocaleString('vi-VN')} ₫
                            </td>
                            <td className="px-6 py-4 text-center font-bold text-gray-850">
                              {lot.quantity_on_hand}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className={`px-2.5 py-0.5 rounded text-tiny font-bold uppercase ${
                                lot.status === 'active' 
                                  ? 'bg-emerald-50 text-emerald-700' 
                                  : lot.status === 'quarantine' 
                                  ? 'bg-amber-50 text-amber-700' 
                                  : 'bg-red-50 text-red-750'
                              }`}>
                                {lot.status === 'active' ? 'Sẵn dùng' : lot.status === 'quarantine' ? 'Kiểm dịch' : 'Khóa'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: PURCHASE ORDERS */}
          {activeTab === 'pos' && (
            <div className="p-6 space-y-6">
              {/* Search input */}
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm mã PO, nhà cung cấp..."
                  value={poSearchTerm}
                  onChange={(e) => setPoSearchTerm(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    <span>Đang tải danh sách PO...</span>
                  </div>
                ) : filteredPOs.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 space-y-2">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="font-semibold text-body-lg">Không tìm thấy đơn hàng nào</p>
                    <p className="text-body-md">Hãy click Tạo đơn PO ở góc phải để tạo giao dịch đặt hàng mới.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Mã đơn PO</th>
                        <th className="px-6 py-4">Nhà cung cấp</th>
                        <th className="px-6 py-4">Kho đích dự kiến</th>
                        <th className="px-6 py-4 text-center">Dự kiến giao</th>
                        <th className="px-6 py-4 text-right">Tổng giá trị</th>
                        <th className="px-6 py-4 text-center">Trạng thái</th>
                        <th className="px-6 py-4 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {filteredPOs.map((po) => (
                        <tr key={po.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-blue-500">{po.po_code}</td>
                          <td className="px-6 py-4 font-semibold text-gray-800">{po.supplier.name}</td>
                          <td className="px-6 py-4 text-gray-500">{po.warehouse.name}</td>
                          <td className="px-6 py-4 text-center text-gray-500">
                            {po.expected_date ? new Date(po.expected_date).toLocaleDateString('vi-VN') : '---'}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-gray-700">
                            {po.grand_total.toLocaleString('vi-VN')} ₫
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase ${
                              po.status === 'received' 
                                ? 'bg-emerald-50 text-emerald-700' 
                                : po.status === 'partially_received' 
                                ? 'bg-amber-50 text-amber-700' 
                                : po.status === 'sent' 
                                ? 'bg-blue-50 text-blue-700' 
                                : 'bg-gray-100 text-gray-500'
                            }`}>
                              {po.status === 'draft' ? 'Nháp' :
                               po.status === 'sent' ? 'Chờ nhận' :
                               po.status === 'partially_received' ? 'Nhập một phần' : 'Đã nhận đủ'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {(po.status === 'sent' || po.status === 'partially_received') && (
                              <button
                                onClick={() => navigate(`/goods-receipts/new?po_id=${po.id}`)}
                                className="text-blue-500 hover:text-blue-600 font-bold hover:underline whitespace-nowrap text-body-md"
                              >
                                Nhập kho
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: GOODS RECEIPTS */}
          {activeTab === 'receipts' && (
            <div className="p-6 space-y-6">
              {/* Search input */}
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm mã phiếu nhập, nhà cung cấp..."
                  value={receiptSearchTerm}
                  onChange={(e) => setReceiptSearchTerm(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    <span>Đang tải danh sách phiếu nhập kho...</span>
                  </div>
                ) : filteredReceipts.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 space-y-2">
                    <WarehouseIcon className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="font-semibold text-body-lg">Không tìm thấy phiếu nhập kho nào</p>
                    <p className="text-body-md">Hãy click Nhập kho thực tế ở góc phải để tạo phiếu nhập mới.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Mã phiếu nhập</th>
                        <th className="px-6 py-4">Nhà cung cấp</th>
                        <th className="px-6 py-4">Kho nhận</th>
                        <th className="px-6 py-4 text-center">Ngày nhận</th>
                        <th className="px-6 py-4">Người nhận</th>
                        <th className="px-6 py-4 text-right">Tổng giá trị</th>
                        <th className="px-6 py-4">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {filteredReceipts.map((gr) => (
                        <tr key={gr.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-blue-500">{gr.receipt_code}</td>
                          <td className="px-6 py-4 font-semibold text-gray-800">{gr.supplier.name}</td>
                          <td className="px-6 py-4 text-gray-500">{gr.warehouse.name}</td>
                          <td className="px-6 py-4 text-center text-gray-500">
                            {new Date(gr.receipt_date).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700">
                            {gr.profile?.full_name || 'Hệ thống'}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-gray-750">
                            {gr.total_amount.toLocaleString('vi-VN')} ₫
                          </td>
                          <td className="px-6 py-4 text-gray-400 italic text-tiny max-w-[200px] truncate" title={gr.notes || ''}>
                            {gr.notes || '---'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: INVENTORY SETTINGS / ALERTS */}
          {activeTab === 'settings' && (
            <div className="p-6 space-y-6">
              {/* Header inside Tab */}
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-700">Định mức an toàn tồn kho</h4>
                  <p className="text-tiny text-gray-400">Quy định lượng hàng tồn kho tối thiểu (Safety Stock) để cảnh báo khi hết hàng</p>
                </div>
                <button
                  onClick={() => setIsEditingSetting(true)}
                  className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-semibold text-body-md hover:bg-blue-100 flex items-center gap-2 transition-colors"
                >
                  <Plus size={16} />
                  <span>Cài đặt định mức</span>
                </button>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {invSettings.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 border border-dashed border-gray-150 rounded-xl">
                    <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-2" />
                    <p className="font-semibold text-body-lg">Chưa cấu hình định mức an toàn nào</p>
                    <p className="text-body-md">Sử dụng nút Cài đặt định mức để bắt đầu thiết lập hạn mức cảnh báo.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Sản phẩm / SKU</th>
                        <th className="px-6 py-4">Kho áp dụng</th>
                        <th className="px-6 py-4 text-center">Tồn kho tối thiểu</th>
                        <th className="px-6 py-4 text-center">Tồn kho tối đa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {invSettings.map((set) => (
                        <tr key={set.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-bold text-gray-800">{set.product.name}</p>
                              <span className="text-gray-400 font-mono text-tiny">SKU: {set.product.sku}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-semibold text-gray-700">{set.warehouse.name}</td>
                          <td className="px-6 py-4 text-center font-bold text-red-500">{set.min_stock_level}</td>
                          <td className="px-6 py-4 text-center font-bold text-gray-700">
                            {set.max_stock_level || '---'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Drawer Cài đặt định mức tồn kho */}
      {isEditingSetting && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Cấu hình định mức tồn kho</h3>
                <p className="text-tiny text-gray-400">Thiết lập ngưỡng cảnh báo an toàn cho sản phẩm</p>
              </div>
              <button
                onClick={() => setIsEditingSetting(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateSetting} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Chọn sản phẩm</label>
                <select
                  value={newSetting.productId}
                  onChange={(e) => setNewSetting({ ...newSetting, productId: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                >
                  <option value="">-- Chọn sản phẩm --</option>
                  {productList.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Chọn kho hàng</label>
                <select
                  value={newSetting.warehouseId}
                  onChange={(e) => setNewSetting({ ...newSetting, warehouseId: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                >
                  <option value="">-- Chọn kho hàng --</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tồn tối thiểu (Min)</label>
                  <input
                    type="number"
                    min="0"
                    value={newSetting.minStock}
                    onChange={(e) => setNewSetting({ ...newSetting, minStock: parseInt(e.target.value) || 0 })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tồn tối đa (Max)</label>
                  <input
                    type="number"
                    min="0"
                    value={newSetting.maxStock}
                    onChange={(e) => setNewSetting({ ...newSetting, maxStock: parseInt(e.target.value) || 0 })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsEditingSetting(false)}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center"
                >
                  Lưu định mức
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </Layout>
  )
}
