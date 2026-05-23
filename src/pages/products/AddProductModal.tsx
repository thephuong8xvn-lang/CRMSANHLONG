import { useState, useEffect } from 'react'
import { X, ShieldAlert, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface AddProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AddProductModal({ isOpen, onClose, onSuccess }: AddProductModalProps) {
  // Form States
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('lọ')
  const [categoryId, setCategoryId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [storageCondition, setStorageCondition] = useState('')
  const [usageInstructions, setUsageInstructions] = useState('')
  const [isLotManaged, setIsLotManaged] = useState(false)
  const [isActive, setIsActive] = useState(true)

  // Pricing inputs
  const [costPrice, setCostPrice] = useState<number>(0)
  interface PriceList {
    id: string
    code: string
    name: string
  }
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [pricesMap, setPricesMap] = useState<Record<string, number>>({})

  // Lookup lists
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Load lookup lists
  useEffect(() => {
    if (!isOpen) return

    const loadLookupData = async () => {
      setLoading(true)
      setErrorMsg('')
      try {
        // Fetch categories
        const { data: catData, error: catErr } = await supabase
          .from('product_categories')
          .select('id, name')
          .eq('is_active', true)
        
        if (!catErr && catData) {
          setCategories(catData)
          if (catData.length > 0) setCategoryId(catData[0].id)
        }

        // Fetch brands
        const { data: brandData, error: brandErr } = await supabase
          .from('brands')
          .select('id, name')
          .eq('is_active', true)
        
        if (!brandErr && brandData) {
          setBrands(brandData)
          if (brandData.length > 0) setBrandId(brandData[0].id)
        }

        // Fetch price lists
        const { data: plData, error: plErr } = await supabase
          .from('price_lists')
          .select('id, code, name')
          .eq('is_active', true)
        
        if (!plErr && plData) {
          setPriceLists(plData)
          const initialMap: Record<string, number> = {}
          plData.forEach(list => {
            initialMap[list.id] = 0
          })
          setPricesMap(initialMap)
        }
      } catch (err) {
        console.error('Error fetching categories/brands:', err)
      } finally {
        setLoading(false)
      }
    }

    loadLookupData()
  }, [isOpen])

  // Clear form
  const resetForm = () => {
    setSku('')
    setName('')
    setUnit('lọ')
    setStorageCondition('')
    setUsageInstructions('')
    setIsLotManaged(false)
    setIsActive(true)
    setCostPrice(0)
    const initialMap: Record<string, number> = {}
    priceLists.forEach(list => {
      initialMap[list.id] = 0
    })
    setPricesMap(initialMap)
    setErrorMsg('')
  }

  // Handle prices change with smart suggestions
  const handlePriceChange = (priceListId: string, val: number) => {
    setPricesMap(prev => {
      const updated = { ...prev, [priceListId]: val }
      const retail = priceLists.find(pl => pl.code === 'GIA-LE')
      if (retail && priceListId === retail.id) {
        priceLists.forEach(list => {
          if (list.id !== retail.id && (!prev[list.id] || prev[list.id] === 0)) {
            if (list.code === 'GIA-DL') {
              updated[list.id] = Math.round(val * 0.85)
            } else if (list.code === 'GIA-VIP') {
              updated[list.id] = Math.round(val * 0.75)
            } else {
              updated[list.id] = val
            }
          }
        })
      }
      return updated
    })
  }

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sku.trim() || !name.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ Mã SKU và Tên sản phẩm.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')

    try {
      // 1. Insert product
      const { data: newProd, error: insertErr } = await supabase
        .from('products')
        .insert({
          sku: sku.trim().toUpperCase(),
          name: name.trim(),
          unit: unit.trim(),
          category_id: categoryId || null,
          brand_id: brandId || null,
          storage_condition: storageCondition.trim() || null,
          usage_instructions: usageInstructions.trim() || null,
          is_lot_managed: isLotManaged,
          is_active: isActive,
          image_urls: []
        })
        .select('id')
        .single()

      if (insertErr) {
        if (insertErr.code === '23505') {
          throw new Error('Mã SKU đã tồn tại trên hệ thống.')
        }
        throw insertErr
      }

      if (newProd) {
        // Prepare price list items from map
        const priceItems = priceLists.map(list => ({
          price_list_id: list.id,
          product_id: newProd.id,
          cost_price: costPrice,
          selling_price: pricesMap[list.id] || 0,
          min_quantity: 1
        }))

        // Insert into price_list_items
        const { error: priceErr } = await supabase
          .from('price_list_items')
          .insert(priceItems)

        if (priceErr) {
          console.error('Error inserting default prices:', priceErr)
        }

        // Complete
        resetForm()
        onSuccess()
        onClose()
      }
    } catch (err: any) {
      console.error('Error saving product:', err)
      setErrorMsg(err.message || 'Có lỗi xảy ra khi lưu sản phẩm. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex justify-end transition-opacity duration-300">
      <div className="bg-gray-0 w-full max-w-xl h-full shadow-2xl flex flex-col py-6 px-8 animate-in slide-in-from-right duration-250 overflow-y-auto">
        
        {/* Header */}
        <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-6">
          <div>
            <h3 className="text-body-lg font-bold text-gray-800">Thêm sản phẩm mới</h3>
            <p className="text-tiny text-gray-400">Tạo catalog thuốc thú y/thiết bị và gán giá tự động</p>
          </div>
          <button
            onClick={() => {
              resetForm()
              onClose()
            }}
            className="p-1 hover:bg-gray-50 rounded-full text-gray-400"
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-4 bg-danger-50 border border-danger-100 rounded-lg text-danger-600 text-body-md flex items-start gap-2 mb-6">
            <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Loading Indicator */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="w-8 h-8 border-2 border-gray-100 border-t-blue-500 rounded-full animate-spin"></div>
          </div>
        )}

        {/* Form */}
        {!loading && (
          <form onSubmit={handleSubmit} className="flex-grow flex flex-col justify-between space-y-6">
            <div className="space-y-5">
              
              {/* Basic Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Mã SKU <span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-semibold uppercase"
                    placeholder="VD: VAC-CSF-50"
                    value={sku}
                    onChange={e => setSku(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Đơn vị tính <span className="text-danger-500">*</span>
                  </label>
                  <select
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all"
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                  >
                    <option value="lọ">lọ</option>
                    <option value="kg">kg</option>
                    <option value="gói">gói</option>
                    <option value="cái">cái</option>
                    <option value="lon">lon</option>
                    <option value="túi">túi</option>
                    <option value="chai">chai</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Tên sản phẩm <span className="text-danger-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all"
                  placeholder="VD: Vaccine Dịch tả heo cổ điển"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              {/* Dropdowns */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Phân loại danh mục
                  </label>
                  <select
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all"
                    value={categoryId}
                    onChange={e => setCategoryId(e.target.value)}
                  >
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Thương hiệu
                  </label>
                  <select
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all"
                    value={brandId}
                    onChange={e => setBrandId(e.target.value)}
                  >
                    {brands.map(brand => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Lot Management Checkbox */}
              <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-body-md font-bold text-amber-800">Quản lý theo Lô / Hạn dùng</p>
                  <p className="text-tiny text-amber-600">Bắt buộc theo dõi số lô và hạn sử dụng khi nhập xuất hàng</p>
                </div>
                <input
                  type="checkbox"
                  className="w-5 h-5 border-gray-300 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                  checked={isLotManaged}
                  onChange={e => setIsLotManaged(e.target.checked)}
                />
              </div>

              {/* Pricing section */}
              <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl space-y-4">
                <p className="text-tiny font-bold text-gray-500 uppercase tracking-wider">
                  Cài đặt Giá khởi tạo (VND)
                </p>
                
                <div>
                  <label className="block text-tiny font-semibold text-gray-500 mb-1">Giá vốn (Nhập chung cho sản phẩm)</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all"
                    value={costPrice || ''}
                    onChange={e => setCostPrice(Number(e.target.value))}
                    placeholder="0"
                  />
                </div>

                <div className="space-y-3 pt-2 border-t border-gray-200/60">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Giá bán theo bảng giá</label>
                  <div className="grid grid-cols-1 gap-3">
                    {priceLists.map(list => (
                      <div key={list.id} className="flex items-center justify-between gap-4">
                        <span className="text-body-md text-gray-600 font-medium min-w-[150px]">{list.name}</span>
                        <div className="relative flex-1 max-w-[220px]">
                          <input
                            type="number"
                            min={0}
                            className={`w-full h-10 pl-3 pr-8 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-semibold ${
                              list.code === 'GIA-LE' ? 'text-blue-600 border-blue-200 shadow-sm' : 'text-gray-700'
                            }`}
                            value={pricesMap[list.id] || ''}
                            onChange={e => handlePriceChange(list.id, Number(e.target.value))}
                            placeholder="0"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-450">VND</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400">
                  💡 Gợi ý: Khi nhập <strong>Giá bán lẻ đề xuất</strong>, hệ thống tự gợi ý giá đại lý (-15%) và giá VIP (-25%), bạn có thể chỉnh sửa đè tùy ý.
                </p>
              </div>

              {/* Technical instructions */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Điều kiện bảo quản
                  </label>
                  <textarea
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all resize-none"
                    placeholder="VD: Tránh ánh sáng, bảo quản 2-8°C..."
                    value={storageCondition}
                    onChange={e => setStorageCondition(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Hướng dẫn sử dụng
                  </label>
                  <textarea
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all resize-none"
                    placeholder="VD: Pha nước uống hoặc tiêm bắp liều..."
                    value={usageInstructions}
                    onChange={e => setUsageInstructions(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="border-t border-gray-100 pt-6 flex items-center justify-end gap-3 mt-8">
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  onClose()
                }}
                className="h-10 px-5 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50 transition-all"
                disabled={submitting}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="h-10 px-6 bg-blue-500 text-gray-0 rounded-lg text-body-md font-bold hover:bg-blue-600 active:scale-[0.98] transition-all flex items-center gap-2 shadow-sm"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-gray-0 border-t-transparent rounded-full animate-spin"></div>
                    Đang lưu...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Lưu sản phẩm
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
