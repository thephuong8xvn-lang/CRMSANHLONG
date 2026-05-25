import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Package,
  FileSpreadsheet,
  Settings,
  Star,
  Download,
  Upload,
  Layers,
  Award
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import AddProductModal from './AddProductModal'
import ManageCategoriesModal from './ManageCategoriesModal'
import ManageBrandsModal from './ManageBrandsModal'
import ImportProductsModal from './ImportProductsModal'
import ManageUnitsModal from './ManageUnitsModal'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

interface ProductCategory {
  id: string
  code: string
  name: string
  is_active: boolean
}

interface Brand {
  id: string
  name: string
  country?: string
  is_active: boolean
}

interface PriceListItem {
  cost_price: number
  selling_price: number
  price_list?: {
    code: string
  }
}

interface StockLotItem {
  quantity_on_hand: number
}

interface OrderLineItem {
  quantity: number
  orders?: {
    status: string
  } | null
}

interface Product {
  id: string
  sku: string
  name: string
  unit: string
  is_lot_managed: boolean
  is_active: boolean
  category_id: string | null
  brand_id: string | null
  package_specs?: string | null
  image_urls?: string[]
  product_categories?: ProductCategory | null
  brands?: Brand | null
  price_list_items?: PriceListItem[]
  stock_lots?: StockLotItem[]
  order_lines?: OrderLineItem[]
  created_at?: string
}

export default function ProductListPage() {
  const navigate = useNavigate()
  const { formatCurrency } = useDisplaySettings()

  // Base Data States
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)

  // Modal Dialogs States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isManageCatsOpen, setIsManageCatsOpen] = useState(false)
  const [isManageBrandsOpen, setIsManageBrandsOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isManageUnitsOpen, setIsManageUnitsOpen] = useState(false)

  // Filters State
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('active') // 'active', 'inactive', 'all'

  // Starred Products (Favorite) Local State
  const [starredProducts, setStarredProducts] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('starred-products')
    return saved ? JSON.parse(saved) : {}
  })

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Fetch Metadata & Products
  const loadMetadataAndProducts = async () => {
    setLoading(true)
    try {
      // 1. Fetch categories
      const { data: catData } = await supabase
        .from('product_categories')
        .select('id, code, name, is_active')
        .order('sort_order', { ascending: true })
      if (catData) setCategories(catData)

      // 2. Fetch brands
      const { data: brandData } = await supabase
        .from('brands')
        .select('id, name, country, is_active')
        .order('name', { ascending: true })
      if (brandData) setBrands(brandData)

      // 3. Fetch products with pricing, stock lots and ordered lines
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .select(`
          id,
          sku,
          name,
          unit,
          is_lot_managed,
          is_active,
          category_id,
          brand_id,
          package_specs,
          image_urls,
          created_at,
          product_categories(id, code, name, is_active),
          brands(id, name, country, is_active),
          price_list_items(cost_price, selling_price, price_list:price_lists(code)),
          stock_lots(quantity_on_hand),
          order_lines(quantity, orders:orders(status))
        `)
        .order('created_at', { ascending: false })

      if (!prodErr && prodData) {
        setProducts(prodData as unknown as Product[])
      } else {
        console.error('Error fetching products:', prodErr)
      }
    } catch (err) {
      console.error('Error loading product data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMetadataAndProducts()
  }, [])

  // Toggle star handler
  const handleToggleStar = (prodId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setStarredProducts(prev => {
      const next = { ...prev, [prodId]: !prev[prodId] }
      localStorage.setItem('starred-products', JSON.stringify(next))
      return next
    })
  }

  // Filter products logic
  const filteredProducts = products.filter(product => {
    const term = searchTerm.toLowerCase().trim()
    const matchesSearch =
      product.name.toLowerCase().includes(term) ||
      product.sku.toLowerCase().includes(term)

    const matchesCategory = !selectedCategory || product.category_id === selectedCategory
    const matchesBrand = !selectedBrand || product.brand_id === selectedBrand

    let matchesStatus = true
    if (selectedStatus === 'active') {
      matchesStatus = product.is_active
    } else if (selectedStatus === 'inactive') {
      matchesStatus = !product.is_active
    }

    return matchesSearch && matchesCategory && matchesBrand && matchesStatus
  })

  // Pagination calculations
  const totalItems = filteredProducts.length
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentProducts = filteredProducts.slice(indexOfFirstItem, indexOfLastItem)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedCategory, selectedBrand, selectedStatus])

  // Currency formatting is retrieved from useDisplaySettings() context

  // Helper calculations for product item
  const getRetailPrice = (product: Product) => {
    if (!product.price_list_items || product.price_list_items.length === 0) return 0
    const retailItem = product.price_list_items.find(
      item => item.price_list?.code === 'GIA-LE'
    )
    return retailItem ? retailItem.selling_price : product.price_list_items[0].selling_price
  }

  const getCostPrice = (product: Product) => {
    if (!product.price_list_items || product.price_list_items.length === 0) return 0
    const retailItem = product.price_list_items.find(
      item => item.price_list?.code === 'GIA-LE'
    )
    return retailItem ? retailItem.cost_price : product.price_list_items[0].cost_price
  }

  const getStockQty = (product: Product) => {
    if (!product.stock_lots || product.stock_lots.length === 0) return 0
    return product.stock_lots.reduce((sum, lot) => sum + Number(lot.quantity_on_hand || 0), 0)
  }

  const getOrderedQty = (product: Product) => {
    if (!product.order_lines || product.order_lines.length === 0) return 0
    return product.order_lines.reduce((sum, line) => {
      const status = line.orders?.status
      if (status === 'confirmed' || status === 'shipping' || status === 'pending_payment') {
        return sum + Number(line.quantity || 0)
      }
      return sum
    }, 0)
  }

  const getEstimatedOutOfStockDays = (product: Product) => {
    const stock = getStockQty(product)
    if (stock <= 0) return '0 ngày'

    if (!product.order_lines || product.order_lines.length === 0) return '---'
    const completedQty = product.order_lines.reduce((sum, line) => {
      if (line.orders?.status === 'completed') {
        return sum + Number(line.quantity || 0)
      }
      return sum
    }, 0)

    if (completedQty <= 0) return '---'

    const dailyRate = completedQty / 30
    const days = Math.round(stock / dailyRate)
    return `${days} ngày`
  }

  // Header Sums for currently filtered product list
  const totalStockSum = filteredProducts.reduce((sum, p) => sum + getStockQty(p), 0)
  const totalOrderedSum = filteredProducts.reduce((sum, p) => sum + getOrderedQty(p), 0)

  // Export products to CSV
  const handleExportCSV = () => {
    const headers = [
      'Mã SKU',
      'Tên sản phẩm',
      'Đơn vị tính',
      'Nhóm sản phẩm',
      'Thương hiệu',
      'Quy cách',
      'Giá bán lẻ',
      'Giá vốn',
      'Tồn kho',
      'Khách đặt',
      'Trạng thái kinh doanh',
      'Thời gian tạo'
    ]

    const rows = filteredProducts.map(prod => {
      const retailPrice = getRetailPrice(prod)
      const costPrice = getCostPrice(prod)
      const stock = getStockQty(prod)
      const ordered = getOrderedQty(prod)
      
      return [
        prod.sku || '',
        prod.name,
        prod.unit || 'lọ',
        prod.product_categories?.name || '-',
        prod.brands?.name || '-',
        prod.package_specs || '-',
        retailPrice,
        costPrice,
        stock,
        ordered,
        prod.is_active ? 'Đang kinh doanh' : 'Ngừng kinh doanh',
        prod.created_at ? new Date(prod.created_at).toLocaleDateString('vi-VN') : ''
      ]
    })

    const csvContent = '\uFEFF' + [
      headers.join(','),
      ...rows.map(row => 
        row.map(val => {
          const text = String(val ?? '').replace(/"/g, '""')
          return text.includes(',') || text.includes('\n') || text.includes('"') ? `"${text}"` : text
        }).join(',')
      )
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const today = new Date().toISOString().split('T')[0]
    link.setAttribute('href', url)
    link.setAttribute('download', `danh_sach_hang_hoa_${today}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Map to displayed list
  const displayList = currentProducts.map(p => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    is_lot_managed: p.is_lot_managed,
    is_active: p.is_active,
    categoryName: p.product_categories?.name || '-',
    brandName: p.brands?.name || '-',
    package_specs: p.package_specs || '-',
    image: (p.image_urls && p.image_urls.length > 0) ? p.image_urls[0] : null,
    price: getRetailPrice(p),
    costPrice: getCostPrice(p),
    stock: getStockQty(p),
    ordered: getOrderedQty(p),
    expiryEstimate: getEstimatedOutOfStockDays(p),
    created_at: p.created_at ? new Date(p.created_at).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) : '-'
  }))

  return (
    <Layout activeMenu="Sản phẩm">
      <div className="p-4 md:p-6 max-w-[1600px] w-full mx-auto">
        
        {/* Top Header Section */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
          <div>
            <h2 className="text-display-xs font-bold text-gray-800">Danh mục Hàng hóa</h2>
            <p className="text-body-sm text-gray-500">Quản lý nhóm sản phẩm, giá bán lẻ, giá vốn và định lượng tồn kho</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/products/prices')}
              className="h-9 px-3.5 border border-gray-200 rounded text-tiny font-bold text-gray-700 bg-white hover:bg-gray-50 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <FileSpreadsheet size={15} className="text-blue-500" />
              Bảng giá áp dụng
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="h-9 px-4 bg-blue-600 text-white rounded text-tiny font-bold flex items-center gap-1.5 hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md"
            >
              <Plus size={16} />
              Thêm mới
            </button>
          </div>
        </div>

        {/* Outer Split Container */}
        <div className="flex flex-col md:flex-row gap-6 items-start">
          
          {/* 1. Left Filters Sidebar Pane (KiotViet style) */}
          <aside className="w-full md:w-[22%] bg-white border border-gray-100 rounded-xl p-4 shrink-0 shadow-sm space-y-6">
            
            {/* Filter by Nhóm Hàng (Product Categories) */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={14} className="text-gray-400" />
                  Nhóm sản phẩm
                </span>
                <button
                  onClick={() => setIsManageCatsOpen(true)}
                  className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-all"
                  title="Quản lý nhóm sản phẩm"
                >
                  <Settings size={14} />
                </button>
              </div>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                <button
                  onClick={() => setSelectedCategory('')}
                  className={`text-left text-tiny font-semibold px-2 py-1.5 rounded transition-all ${
                    !selectedCategory ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Tất cả nhóm sản phẩm
                </button>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`text-left text-tiny font-semibold px-2 py-1.5 rounded transition-all flex items-center justify-between ${
                      selectedCategory === cat.id ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate pr-1">{cat.name}</span>
                    {!cat.is_active && (
                      <span className="text-[8px] bg-gray-100 text-gray-400 px-1 py-0.2 rounded border border-gray-200 uppercase shrink-0 font-bold">Ngừng</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter by Thương Hiệu (Brands) */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Award size={14} className="text-gray-400" />
                  Thương hiệu
                </span>
                <button
                  onClick={() => setIsManageBrandsOpen(true)}
                  className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-all"
                  title="Quản lý thương hiệu"
                >
                  <Settings size={14} />
                </button>
              </div>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                <button
                  onClick={() => setSelectedBrand('')}
                  className={`text-left text-tiny font-semibold px-2 py-1.5 rounded transition-all ${
                    !selectedBrand ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Tất cả thương hiệu
                </button>
                {brands.map(brand => (
                  <button
                    key={brand.id}
                    onClick={() => setSelectedBrand(brand.id)}
                    className={`text-left text-tiny font-semibold px-2 py-1.5 rounded transition-all flex items-center justify-between ${
                      selectedBrand === brand.id ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate pr-1">{brand.name}</span>
                    {!brand.is_active && (
                      <span className="text-[8px] bg-gray-100 text-gray-400 px-1 py-0.2 rounded border border-gray-200 uppercase shrink-0 font-bold">Ngừng</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Đơn vị tính CRUD */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Settings size={14} className="text-gray-400" />
                  Đơn vị tính
                </span>
                <button
                  onClick={() => setIsManageUnitsOpen(true)}
                  className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-all"
                  title="Quản lý đơn vị tính"
                >
                  <Settings size={14} />
                </button>
              </div>
              <p className="text-[11px] text-gray-400">Cấu hình các đơn vị đo lường (lọ, chai, gói, cái...).</p>
            </div>

            {/* Filter by Trạng thái kinh doanh */}
            <div className="space-y-2.5 pt-1">
              <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider block border-b border-gray-100 pb-2">
                Trạng thái kinh doanh
              </span>
              <div className="flex flex-col gap-2.5">
                {[
                  { value: 'active', label: 'Đang kinh doanh' },
                  { value: 'inactive', label: 'Ngừng kinh doanh' },
                  { value: 'all', label: 'Tất cả trạng thái' }
                ].map(item => (
                  <label key={item.value} className="flex items-center gap-2 text-tiny font-bold text-gray-600 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="status-filter"
                      value={item.value}
                      checked={selectedStatus === item.value}
                      onChange={e => setSelectedStatus(e.target.value)}
                      className="text-blue-500 focus:ring-blue-500 w-3.5 h-3.5"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

          </aside>

          {/* 2. Right Products Grid / Table Panel */}
          <div className="flex-1 w-full bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm flex flex-col min-w-0">
            
            {/* Top Toolbar Action Bar */}
            <div className="p-4 border-b border-gray-100 bg-gray-25 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              {/* Search input: KiotViet text-box search format */}
              <div className="relative w-full sm:max-w-xs text-gray-700">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                <input
                  type="text"
                  placeholder="Theo mã, tên hàng..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full h-9 pl-9 pr-4 bg-white border border-gray-205 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Action Buttons: Import / Export / View settings */}
              <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="h-9 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-gray-600 flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <Upload size={14} className="text-gray-400" />
                  Import file
                </button>
                <button
                  onClick={handleExportCSV}
                  className="h-9 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-gray-600 flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <Download size={14} className="text-gray-400" />
                  Xuất file
                </button>
              </div>
            </div>

            {/* Table Container */}
            <div className="flex-1 overflow-x-auto">
              <table className="w-full border-collapse text-[13px] text-left">
                <thead>
                  {/* Column Names Header Row */}
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[10px] font-bold">
                    <th className="py-2.5 px-3 text-center w-8"></th>
                    <th className="py-2.5 px-1 text-center w-8"></th>
                    <th className="py-2.5 px-3 text-center w-12">Ảnh</th>
                    <th className="py-2.5 px-3 w-28">Mã hàng</th>
                    <th className="py-2.5 px-4 min-w-[200px]">Tên hàng</th>
                    <th className="py-2.5 px-3 text-right w-28">Giá bán</th>
                    <th className="py-2.5 px-3 text-right w-28">Giá vốn</th>
                    <th className="py-2.5 px-3 text-right w-24">Tồn kho</th>
                    <th className="py-2.5 px-3 text-right w-24">Khách đặt</th>
                    <th className="py-2.5 px-4 w-36">Thời gian tạo</th>
                    <th className="py-2.5 px-4 w-32">Dự kiến hết</th>
                  </tr>
                  
                  {/* Totals Header Row (KiotViet Dashboard style totals) */}
                  <tr className="bg-blue-50/20 border-b border-gray-200 font-bold text-gray-700">
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-1"></td>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3 text-tiny italic text-gray-400">Tổng cộng:</td>
                    <td className="py-2 px-4"></td>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3 text-right font-extrabold text-blue-700">{totalStockSum.toLocaleString('vi-VN')}</td>
                    <td className="py-2 px-3 text-right font-extrabold text-blue-700">{totalOrderedSum.toLocaleString('vi-VN')}</td>
                    <td className="py-2 px-4"></td>
                    <td className="py-2 px-4"></td>
                  </tr>
                </thead>
                <tbody>
                  {loading && displayList.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-16 text-center text-gray-400 italic">
                        Đang tải danh sách hàng hóa...
                      </td>
                    </tr>
                  ) : displayList.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-20 text-center text-gray-400 italic">
                        Không tìm thấy sản phẩm nào khớp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    displayList.map(prod => (
                      <tr
                        key={prod.id}
                        onClick={() => navigate(`/products/${prod.id}`)}
                        className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors cursor-pointer group"
                      >
                        <td className="py-3 px-3 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-blue-500 focus:ring-blue-500 w-3.5 h-3.5"
                          />
                        </td>
                        <td className="py-3 px-1 text-center">
                          <button
                            onClick={e => handleToggleStar(prod.id, e)}
                            className="p-1 hover:bg-gray-100 rounded transition-all text-gray-300 hover:text-amber-500"
                          >
                            <Star
                              size={14}
                              className={starredProducts[prod.id] ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}
                            />
                          </button>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <div className="w-10 h-10 rounded border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center mx-auto">
                            {prod.image ? (
                              <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" />
                            ) : (
                              <Package size={18} className="text-gray-300" />
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[12px] text-gray-500 font-semibold group-hover:text-blue-500 transition-colors">
                          {prod.sku || '-'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-gray-800 leading-snug group-hover:text-blue-600 transition-colors line-clamp-2">
                              {prod.name}
                            </span>
                            <div className="flex gap-2 items-center text-[10px] text-gray-400 font-medium">
                              <span>Nhóm: <strong className="text-gray-500">{prod.categoryName}</strong></span>
                              <span>•</span>
                              <span>Hãng: <strong className="text-gray-500">{prod.brandName}</strong></span>
                              {prod.package_specs && prod.package_specs !== '-' && (
                                <>
                                  <span>•</span>
                                  <span>Quy cách: <strong className="text-gray-500">{prod.package_specs}</strong></span>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-blue-600 tabular-nums">
                          {formatCurrency(prod.price)}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-500 tabular-nums">
                          {formatCurrency(prod.costPrice)}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-gray-700 tabular-nums">
                          {prod.stock.toLocaleString('vi-VN')}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-600 tabular-nums">
                          {prod.ordered.toLocaleString('vi-VN')}
                        </td>
                        <td className="py-3 px-4 text-gray-400 text-tiny font-mono">
                          {prod.created_at}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-1.5 py-0.5 text-[11px] font-bold rounded ${
                            prod.expiryEstimate === '0 ngày' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-gray-50 text-gray-600 border border-gray-100'
                          }`}>
                            {prod.expiryEstimate}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Panel */}
            {!loading && displayList.length > 0 && (
              <div className="p-4 border-t border-gray-100 bg-gray-25 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
                <span className="text-tiny text-gray-450 font-medium">
                  Hiển thị <span className="font-bold text-gray-600">{indexOfFirstItem + 1}-{Math.min(indexOfLastItem, totalItems)}</span> trên tổng số <span className="font-bold text-gray-600">{totalItems}</span> sản phẩm
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="w-8 h-8 rounded border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-all shadow-sm"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from({ length: totalPages }).map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentPage(idx + 1)}
                      className={`w-8 h-8 rounded text-tiny font-bold transition-all shadow-sm ${
                        currentPage === idx + 1
                          ? 'bg-blue-600 text-white border border-blue-600'
                          : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="w-8 h-8 rounded border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-all shadow-sm"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

          </div>

        </div>

      </div>

      {/* Add Product Modal */}
      <AddProductModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={loadMetadataAndProducts}
      />

      {/* Manage Categories Modal CRUD */}
      <ManageCategoriesModal
        isOpen={isManageCatsOpen}
        onClose={() => setIsManageCatsOpen(false)}
        onSuccess={loadMetadataAndProducts}
      />

      {/* Manage Brands Modal CRUD */}
      <ManageBrandsModal
        isOpen={isManageBrandsOpen}
        onClose={() => setIsManageBrandsOpen(false)}
        onSuccess={loadMetadataAndProducts}
      />

      {/* Import Products Modal */}
      <ImportProductsModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={loadMetadataAndProducts}
      />

      {/* Manage Units Modal */}
      <ManageUnitsModal
        isOpen={isManageUnitsOpen}
        onClose={() => setIsManageUnitsOpen(false)}
        onSuccess={loadMetadataAndProducts}
      />

    </Layout>
  )
}
