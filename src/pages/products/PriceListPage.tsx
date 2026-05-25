import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Save,
  Search,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle,
  XCircle,
  Sparkles
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

interface PriceList {
  id: string
  code: string
  name: string
  description?: string | null
  is_default: boolean
}

interface ProductCategory {
  id: string
  code: string
  name: string
}

interface PriceListItem {
  id?: string
  price_list_id: string
  product_id: string
  variant_id: string | null
  cost_price: number
  selling_price: number
  min_quantity: number
}

interface Product {
  id: string
  sku: string
  name: string
  unit: string
  category_id: string | null
  product_categories?: ProductCategory | null
  price_list_items?: PriceListItem[]
}

export default function PriceListPage() {
  const navigate = useNavigate()
  const { settings } = useDisplaySettings()

  const formatNumber = (val: number) => {
    if (val === null || val === undefined || isNaN(val)) return '0'
    const parts = val.toFixed(settings.decimal_places_currency).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, settings.thousands_separator)
    return parts.join(settings.decimal_separator)
  }

  // State
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [selectedList, setSelectedList] = useState<PriceList | null>(null)
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [products, setProducts] = useState<Product[]>([])
  
  const [loadingLists, setLoadingLists] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [saving, setSaving] = useState(false)

  // Filters State
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')

  // Edit Prices State (maps key of Product ID + Variant ID to selling_price)
  const [dirtyPrices, setDirtyPrices] = useState<Record<string, number>>({})

  // Toast notification
  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({
    show: false,
    msg: '',
    type: 'success'
  })

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Trigger Toast
  const triggerToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, msg, type })
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }))
    }, 3000)
  }

  // Load Lookup Metadata and Price lists
  useEffect(() => {
    const initPage = async () => {
      setLoadingLists(true)
      try {
        // 1. Fetch active price lists
        const { data: listData, error: listErr } = await supabase
          .from('price_lists')
          .select('id, code, name, description, is_default')
          .eq('is_active', true)
          .order('is_default', { ascending: false })

        if (listErr) throw listErr
        if (listData) {
          setPriceLists(listData)
          if (listData.length > 0) {
            setSelectedList(listData[0])
          }
        }

        // 2. Fetch categories
        const { data: catData } = await supabase
          .from('product_categories')
          .select('id, code, name')
          .eq('is_active', true)

        if (catData) setCategories(catData)
      } catch (err) {
        console.error('Error initializing price list page:', err)
        triggerToast('Không thể tải danh sách bảng giá', 'error')
      } finally {
        setLoadingLists(false)
      }
    }
    initPage()
  }, [])

  // Load Products & Prices whenever selectedList changes
  const loadProductsAndPrices = async () => {
    if (!selectedList) return
    setLoadingProducts(true)
    try {
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .select(`
          id,
          sku,
          name,
          unit,
          category_id,
          product_categories(id, code, name),
          price_list_items(
            id,
            price_list_id,
            product_id,
            variant_id,
            cost_price,
            selling_price,
            min_quantity
          )
        `)
        .order('sku', { ascending: true })

      if (prodErr) throw prodErr
      if (prodData) {
        // Filter price list items for the active price list
        const filteredProds = (prodData as unknown as Product[]).map(p => {
          const itemsForActiveList = p.price_list_items?.filter(
            item => item.price_list_id === selectedList.id
          ) || []
          return {
            ...p,
            price_list_items: itemsForActiveList
          }
        })
        setProducts(filteredProds)
      }
      setDirtyPrices({}) // reset edits
    } catch (err) {
      console.error('Error fetching products/prices:', err)
      triggerToast('Lỗi tải sản phẩm và giá', 'error')
    } finally {
      setLoadingProducts(false)
    }
  }

  useEffect(() => {
    loadProductsAndPrices()
  }, [selectedList])

  // Filter products logic
  const filteredProducts = products.filter(product => {
    const matchesSearch =
      product.name.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase().trim())
    const matchesCategory = !selectedCategory || product.category_id === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Pagination calculations
  const totalItems = filteredProducts.length
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentProducts = filteredProducts.slice(indexOfFirstItem, indexOfLastItem)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedCategory])

  // Margin calculation helper
  const calculateMargin = (cost: number, selling: number) => {
    if (!selling) return 0
    return Math.round(((selling - cost) / selling) * 1000) / 10
  }

  // Margin Badge Render
  const renderMarginBadge = (cost: number, selling: number) => {
    if (!selling) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 border border-gray-100 rounded-full text-tiny text-gray-500 font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          N/A
        </span>
      )
    }
    const margin = calculateMargin(cost, selling)
    if (margin > 15) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-emerald-50 border border-emerald-100 rounded-full text-tiny text-emerald-700 font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {margin}%
        </span>
      )
    } else if (margin >= 0) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-50 border border-amber-100 rounded-full text-tiny text-amber-700 font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          {margin}%
        </span>
      )
    } else {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-red-50 border border-red-100 rounded-full text-tiny text-red-700 font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          {margin}% (Thấp)
        </span>
      )
    }
  }

  // Handle Edit Input
  const handlePriceEdit = (productId: string, value: string) => {
    const val = Number(value.replace(/[^0-9]/g, ''))
    setDirtyPrices(prev => ({
      ...prev,
      [productId]: val
    }))
  }

  // Handle Save
  const handleSaveChanges = async () => {
    if (!selectedList) return
    const keys = Object.keys(dirtyPrices)
    if (keys.length === 0) {
      triggerToast('Không có thay đổi nào để lưu.')
      return
    }

    setSaving(true)
    try {
      const priceListItemsToUpsert = keys.map(productId => {
        const prod = products.find(p => p.id === productId)
        const existingItem = prod?.price_list_items?.[0]
        
        return {
          id: existingItem?.id, // include ID if exists to trigger update
          price_list_id: selectedList.id,
          product_id: productId,
          variant_id: null,
          cost_price: existingItem?.cost_price || 0,
          selling_price: dirtyPrices[productId],
          min_quantity: existingItem?.min_quantity || 1
        }
      })

      const { error } = await supabase
        .from('price_list_items')
        .upsert(priceListItemsToUpsert)

      if (error) throw error

      triggerToast('Đã lưu các thay đổi bảng giá thành công!')
      loadProductsAndPrices()
    } catch (err) {
      console.error('Error saving prices:', err)
      triggerToast('Có lỗi xảy ra khi lưu bảng giá.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout activeMenu="Sản phẩm">
      
      {/* Toast Notification Widget */}
      {toast.show && (
        <div className={`fixed bottom-10 right-10 z-50 flex items-center gap-3 px-6 py-4 rounded-xl shadow-lg border animate-in slide-in-from-bottom duration-300 ${
          toast.type === 'success'
            ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
            : 'bg-red-50 border-red-100 text-red-800'
        }`}>
          {toast.type === 'success' ? (
            <CheckCircle className="text-emerald-500" size={20} />
          ) : (
            <XCircle className="text-red-500" size={20} />
          )}
          <span className="text-body-md font-semibold">{toast.msg}</span>
        </div>
      )}

      {/* Outer Flex Container for Layout */}
      <div className="flex h-[calc(100vh-64px)] overflow-hidden">
        
        {/* Left Side: Price Lists Navigator */}
        <aside className="w-72 border-r border-gray-100 bg-gray-0 flex flex-col flex-shrink-0">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider font-semibold">Cấp bậc bảng giá</span>
            <FileSpreadsheet size={18} className="text-blue-500" />
          </div>
          
          {loadingLists ? (
            <div className="flex justify-center items-center py-12">
              <div className="w-6 h-6 border-2 border-gray-100 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto py-2 divide-y divide-gray-50">
              {priceLists.map(list => {
                const isSelected = selectedList?.id === list.id
                return (
                  <button
                    key={list.id}
                    onClick={() => setSelectedList(list)}
                    className={`w-full text-left px-6 py-4 border-l-[4px] transition-all flex flex-col gap-0.5 ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold'
                        : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                    }`}
                  >
                    <span className="text-body-md font-bold leading-tight">{list.name}</span>
                    <span className="text-[10px] uppercase font-semibold tracking-wider text-gray-400 mt-1">
                      Mã: {list.code} {list.is_default && '• Mặc định'}
                    </span>
                    {list.description && (
                      <span className="text-tiny text-gray-400 truncate w-full mt-0.5">
                        {list.description}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        {/* Main Side: Pricing Editor Table */}
        <section className="flex-1 bg-gray-0 flex flex-col overflow-hidden">
          
          {/* Header section with Actions */}
          <div className="p-6 md:p-8 pb-4 flex flex-col gap-6 flex-shrink-0">
            
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-display-xs font-bold text-gray-800">
                    {selectedList ? selectedList.name : 'Đang tải...'}
                  </h3>
                  <span className="text-tiny text-gray-400 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 font-bold uppercase">
                    {settings.currency_symbol}
                  </span>
                </div>
                <p className="text-body-md text-gray-500 mt-1">
                  Thiết lập giá và theo dõi biên lợi nhuận trực quan so với giá vốn của sản phẩm.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate('/products')}
                  className="h-10 px-5 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50 transition-all"
                  disabled={saving}
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={handleSaveChanges}
                  className="h-10 px-6 bg-blue-500 text-gray-0 rounded-lg text-body-md font-bold flex items-center gap-2 hover:bg-blue-600 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50"
                  disabled={saving || Object.keys(dirtyPrices).length === 0}
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-gray-0 border-t-transparent rounded-full animate-spin"></div>
                      Đang lưu...
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      Lưu thay đổi
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Table filters */}
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm theo tên sản phẩm, mã SKU..."
                  className="w-full h-10 pl-9 pr-4 border border-gray-200 rounded-lg bg-gray-0 text-body-md focus:outline-none focus:border-blue-500 transition-all"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="w-52">
                <select
                  className="w-full h-10 border border-gray-200 rounded-lg bg-gray-0 text-body-md px-3"
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                >
                  <option value="">Tất cả danh mục</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

          </div>

          {/* Table Canvas Content */}
          <div className="flex-1 px-6 md:px-8 pb-6 overflow-hidden flex flex-col">
            
            {loadingProducts ? (
              <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-8 h-8 border-2 border-gray-100 border-t-blue-500 rounded-full animate-spin"></div>
                <p className="text-body-md text-gray-400">Đang tải bảng giá sản phẩm...</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto border border-gray-100 rounded-xl bg-gray-0 shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                      <th className="p-4 text-tiny font-bold text-gray-400 uppercase w-12 text-center">#</th>
                      <th className="p-4 text-tiny font-bold text-gray-400 uppercase">Sản phẩm / Mã SKU</th>
                      <th className="p-4 text-tiny font-bold text-gray-400 uppercase text-center w-24">ĐVT</th>
                      <th className="p-4 text-tiny font-bold text-gray-400 uppercase text-right w-36">Giá vốn ({settings.currency_symbol})</th>
                      <th className="p-4 text-tiny font-bold text-gray-400 uppercase text-right w-36">Giá hiện tại ({settings.currency_symbol})</th>
                      <th className="p-4 text-tiny font-bold text-blue-500 uppercase text-right w-44 bg-blue-50/20">Giá mới ({settings.currency_symbol})</th>
                      <th className="p-4 text-tiny font-bold text-gray-400 uppercase text-center w-36">Biên lợi nhuận</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {currentProducts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-12 text-center text-body-md text-gray-400 italic">
                          Không tìm thấy sản phẩm nào khớp với bộ lọc
                        </td>
                      </tr>
                    ) : (
                      currentProducts.map((prod, index) => {
                        const rowNum = indexOfFirstItem + index + 1
                        const priceItem = prod.price_list_items?.[0]
                        const cost = priceItem?.cost_price || 0
                        const currentSelling = priceItem?.selling_price || 0
                        
                        // Check if edited
                        const isEdited = dirtyPrices[prod.id] !== undefined
                        const selling = isEdited ? dirtyPrices[prod.id] : currentSelling

                        return (
                          <tr
                            key={prod.id}
                            className={`hover:bg-gray-50/50 transition-colors ${
                              isEdited ? 'bg-blue-50/5' : ''
                            }`}
                          >
                            <td className="p-4 text-body-md text-gray-400 text-center font-medium">
                              {rowNum < 10 ? `0${rowNum}` : rowNum}
                            </td>
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className="text-body-md font-bold text-gray-700">{prod.name}</span>
                                <span className="text-[11px] text-gray-400 font-semibold uppercase">SKU: {prod.sku}</span>
                              </div>
                            </td>
                            <td className="p-4 text-center text-body-md text-gray-500">
                              <span className="px-2 py-0.5 bg-gray-50 border border-gray-100 rounded text-tiny font-medium">
                                {prod.unit}
                              </span>
                            </td>
                            <td className="p-4 text-right text-body-md font-medium text-gray-600 tabular-nums">
                              {formatNumber(cost)}
                            </td>
                            <td className="p-4 text-right text-body-md font-medium text-gray-600 tabular-nums">
                              {formatNumber(currentSelling)}
                            </td>
                            <td className="p-4 text-right bg-blue-50/10">
                              <div className="flex justify-end">
                                <input
                                  type="text"
                                  className="w-36 h-9 px-3 text-right border border-gray-200 rounded-lg text-body-md font-bold text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all bg-gray-0"
                                  value={isEdited ? formatNumber(dirtyPrices[prod.id]) : (currentSelling ? formatNumber(currentSelling) : '')}
                                  onChange={e => handlePriceEdit(prod.id, e.target.value)}
                                  placeholder="Nhập giá..."
                                />
                              </div>
                            </td>
                            <td className="p-4 text-center">
                              {renderMarginBadge(cost, selling)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {!loadingProducts && filteredProducts.length > 0 && (
              <div className="flex items-center justify-between mt-5 flex-shrink-0">
                <span className="text-body-md text-gray-400">
                  Đang hiển thị <span className="font-semibold text-gray-600">{indexOfFirstItem + 1}-{Math.min(indexOfLastItem, totalItems)}</span> của <span className="font-semibold text-gray-600">{totalItems}</span> sản phẩm
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-all"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from({ length: totalPages }).map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentPage(idx + 1)}
                      className={`w-8 h-8 rounded-lg text-body-md font-bold transition-all ${
                        currentPage === idx + 1
                          ? 'bg-blue-500 text-gray-0 shadow-sm'
                          : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-all"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

          </div>

        </section>

      </div>
    </Layout>
  )
}
