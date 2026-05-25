import { useState, useEffect } from 'react'
import { X, ShieldAlert, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

interface EditProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  productId: string
}

export default function EditProductModal({ isOpen, onClose, onSuccess, productId }: EditProductModalProps) {
  const { settings } = useDisplaySettings()

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
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [contraindications, setContraindications] = useState('')
  const [withdrawalPeriodMeat, setWithdrawalPeriodMeat] = useState<string>('')
  const [withdrawalPeriodMilkEgg, setWithdrawalPeriodMilkEgg] = useState<string>('')
  const [selectedIngredients, setSelectedIngredients] = useState<{ ingredientId: string; percentageOrDosage: string }[]>([])
  const [allIngredients, setAllIngredients] = useState<{ id: string; name: string }[]>([])

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
  const [units, setUnits] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Load lookup lists and existing product data
  useEffect(() => {
    if (!isOpen || !productId) return

    const loadData = async () => {
      setLoading(true)
      setErrorMsg('')
      try {
        // 1. Fetch categories
        const { data: catData } = await supabase
          .from('product_categories')
          .select('id, name')
          .eq('is_active', true)
        if (catData) setCategories(catData)

        // 2. Fetch brands
        const { data: brandData } = await supabase
          .from('brands')
          .select('id, name')
          .eq('is_active', true)
        if (brandData) setBrands(brandData)

        // 3. Fetch price lists
        const { data: plData } = await supabase
          .from('price_lists')
          .select('id, code, name')
          .eq('is_active', true)
        
        let loadedPriceLists: PriceList[] = []
        if (plData) {
          setPriceLists(plData)
          loadedPriceLists = plData
        }

        // 4. Fetch existing product
        const { data: prod, error: prodErr } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .single()
        
        if (prodErr) throw prodErr
        if (prod) {
          setSku(prod.sku || '')
          setName(prod.name || '')
          setUnit(prod.unit || 'lọ')
          setCategoryId(prod.category_id || '')
          setBrandId(prod.brand_id || '')
          setStorageCondition(prod.storage_condition || '')
          setUsageInstructions(prod.usage_instructions || '')
          setIsLotManaged(prod.is_lot_managed || false)
          setIsActive(prod.is_active ?? true)
          setRegistrationNumber(prod.registration_number || '')
          setContraindications(prod.contraindications || '')
          setWithdrawalPeriodMeat(prod.withdrawal_period_meat !== null ? String(prod.withdrawal_period_meat) : '')
          setWithdrawalPeriodMilkEgg(prod.withdrawal_period_milk_egg !== null ? String(prod.withdrawal_period_milk_egg) : '')
        }

        // Fetch active ingredients list for product
        const { data: linkedIngData } = await supabase
          .from('product_active_ingredients')
          .select('active_ingredient_id, percentage_or_dosage')
          .eq('product_id', productId)

        if (linkedIngData) {
          setSelectedIngredients(
            linkedIngData.map((item: any) => ({
              ingredientId: item.active_ingredient_id,
              percentageOrDosage: item.percentage_or_dosage
            }))
          )
        }

        // Fetch all active ingredients
        const { data: ingData } = await supabase
          .from('active_ingredients')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
        if (ingData) setAllIngredients(ingData)

        // 5. Fetch existing price list items
        const { data: priceItems } = await supabase
          .from('price_list_items')
          .select('price_list_id, cost_price, selling_price')
          .eq('product_id', productId)

        const initialMap: Record<string, number> = {}
        loadedPriceLists.forEach(list => {
          initialMap[list.id] = 0
        })

        if (priceItems && priceItems.length > 0) {
          // Set global cost price from the first price list item
          setCostPrice(Number(priceItems[0].cost_price) || 0)
          // Map prices
          priceItems.forEach((item: any) => {
            if (item.price_list_id) {
              initialMap[item.price_list_id] = Number(item.selling_price) || 0
            }
          })
        }
        setPricesMap(initialMap)

        // 6. Fetch units
        const { data: unitData, error: unitErr } = await supabase
          .from('product_units')
          .select('name')
          .eq('is_active', true)
          .order('name', { ascending: true })

        if (!unitErr && unitData && unitData.length > 0) {
          setUnits(unitData.map((u: any) => u.name))
        } else {
          // Fallback to local storage or defaults
          const saved = localStorage.getItem('product-units')
          if (saved) {
            const parsed = JSON.parse(saved) as { name: string; is_active: boolean }[]
            setUnits(parsed.filter(u => u.is_active).map(u => u.name))
          } else {
            setUnits(['lọ', 'kg', 'gói', 'cái', 'lon', 'túi', 'chai'])
          }
        }

      } catch (err: any) {
        console.error('Error loading product edit data:', err)
        setErrorMsg(err.message || 'Lỗi xảy ra khi tải dữ liệu sản phẩm.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [isOpen, productId])

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

  // Handle Update
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sku.trim() || !name.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ Mã SKU và Tên sản phẩm.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')

    try {
      // 1. Update product detail
      const { error: updateErr } = await supabase
        .from('products')
        .update({
          sku: sku.trim().toUpperCase(),
          name: name.trim(),
          unit: unit.trim(),
          category_id: categoryId || null,
          brand_id: brandId || null,
          storage_condition: storageCondition.trim() || null,
          usage_instructions: usageInstructions.trim() || null,
          is_lot_managed: isLotManaged,
          is_active: isActive,
          registration_number: registrationNumber.trim() || null,
          contraindications: contraindications.trim() || null,
          withdrawal_period_meat: withdrawalPeriodMeat ? parseInt(withdrawalPeriodMeat) : null,
          withdrawal_period_milk_egg: withdrawalPeriodMilkEgg ? parseInt(withdrawalPeriodMilkEgg) : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', productId)

      if (updateErr) {
        if (updateErr.code === '23505') {
          throw new Error('Mã SKU đã tồn tại trên hệ thống.')
        }
        throw updateErr
      }

      // Refresh active ingredients links
      const { error: deleteIngErr } = await supabase
        .from('product_active_ingredients')
        .delete()
        .eq('product_id', productId)

      if (deleteIngErr) throw deleteIngErr

      if (selectedIngredients.length > 0) {
        const ingredientItems = selectedIngredients.map(item => ({
          product_id: productId,
          active_ingredient_id: item.ingredientId,
          percentage_or_dosage: item.percentageOrDosage.trim()
        }))

        const { error: ingLinkErr } = await supabase
          .from('product_active_ingredients')
          .insert(ingredientItems)

        if (ingLinkErr) throw ingLinkErr
      }

      // 2. Refresh price list items (Delete old & Insert new)
      const { error: deleteErr } = await supabase
        .from('price_list_items')
        .delete()
        .eq('product_id', productId)

      if (deleteErr) throw deleteErr

      const priceItems = priceLists.map(list => ({
        price_list_id: list.id,
        product_id: productId,
        cost_price: costPrice,
        selling_price: pricesMap[list.id] || 0,
        min_quantity: 1
      }))

      const { error: priceErr } = await supabase
        .from('price_list_items')
        .insert(priceItems)

      if (priceErr) throw priceErr

      onSuccess()
      onClose()
    } catch (err: any) {
      console.error('Error updating product:', err)
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
            <h3 className="text-body-lg font-bold text-gray-800">Chỉnh sửa chi tiết sản phẩm</h3>
            <p className="text-tiny text-gray-400">Cập nhật thông tin catalog và giá sản phẩm theo từng bảng giá</p>
          </div>
          <button
            onClick={onClose}
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
          <div className="flex-grow flex justify-center items-center py-12">
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
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all capitalize"
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                  >
                    {units.map(u => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
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
                    <option value="">-- Chọn danh mục --</option>
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
                    <option value="">-- Chọn thương hiệu --</option>
                    {brands.map(brand => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Số Đăng Ký (SDK)
                </label>
                <input
                  type="text"
                  className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all uppercase font-semibold"
                  placeholder="VD: SDK-SLV-123"
                  value={registrationNumber}
                  onChange={e => setRegistrationNumber(e.target.value)}
                />
              </div>

              {/* Status and Lot management */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-body-md font-bold text-amber-800">Quản lý theo Lô / Hạn</p>
                    <p className="text-[10px] text-amber-600">Bắt buộc theo dõi lô hàng</p>
                  </div>
                  <input
                    type="checkbox"
                    className="w-5 h-5 border-gray-300 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                    checked={isLotManaged}
                    onChange={e => setIsLotManaged(e.target.checked)}
                  />
                </div>

                <div className="p-4 bg-blue-50/40 border border-blue-100 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-body-md font-bold text-blue-800">Trạng thái kinh doanh</p>
                    <p className="text-[10px] text-blue-600">Hiển thị trong danh mục bán</p>
                  </div>
                  <input
                    type="checkbox"
                    className="w-5 h-5 border-gray-300 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                  />
                </div>
              </div>

              {/* Pricing section */}
              <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl space-y-4">
                <p className="text-tiny font-bold text-gray-500 uppercase tracking-wider">
                  Cài đặt Giá sản phẩm ({settings.currency_symbol})
                </p>
                
                <div>
                  <label className="block text-tiny font-semibold text-gray-500 mb-1">Giá vốn ({settings.currency_symbol})</label>
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
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-455">{settings.currency_symbol}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400">
                  💡 Gợi ý: Khi nhập <strong>Giá bán lẻ đề xuất</strong>, hệ thống tự gợi ý giá đại lý (-15%) và giá VIP (-25%), bạn có thể chỉnh sửa đè tùy ý.
                </p>
              </div>

              {/* Active Ingredients Section */}
              <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl space-y-4">
                <div className="flex justify-between items-center">
                  <p className="text-tiny font-bold text-gray-500 uppercase tracking-wider">
                    Thành phần hoạt chất
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const unused = allIngredients.find(
                        ing => !selectedIngredients.some(si => si.ingredientId === ing.id)
                      )
                      if (unused) {
                        setSelectedIngredients([
                          ...selectedIngredients,
                          { ingredientId: unused.id, percentageOrDosage: '' }
                        ])
                      } else if (allIngredients.length > 0) {
                        setSelectedIngredients([
                          ...selectedIngredients,
                          { ingredientId: allIngredients[0].id, percentageOrDosage: '' }
                        ])
                      }
                    }}
                    className="text-blue-500 hover:text-blue-600 text-tiny font-bold flex items-center gap-1"
                  >
                    + Thêm hoạt chất
                  </button>
                </div>

                {selectedIngredients.length === 0 ? (
                  <p className="text-tiny text-gray-400 italic">Chưa liên kết hoạt chất nào.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedIngredients.map((item, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <select
                          className="flex-1 h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500"
                          value={item.ingredientId}
                          onChange={e => {
                            const updated = [...selectedIngredients]
                            updated[index].ingredientId = e.target.value
                            setSelectedIngredients(updated)
                          }}
                        >
                          {allIngredients.map(ing => {
                            const isUsed = selectedIngredients.some(
                              (si, idx) => si.ingredientId === ing.id && idx !== index
                            )
                            if (isUsed) return null
                            return (
                              <option key={ing.id} value={ing.id}>
                                {ing.name}
                              </option>
                            )
                          })}
                        </select>
                        <input
                          type="text"
                          required
                          placeholder="Hàm lượng (VD: 500 mg, 20%)"
                          className="w-48 h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 font-semibold"
                          value={item.percentageOrDosage}
                          onChange={e => {
                            const updated = [...selectedIngredients]
                            updated[index].percentageOrDosage = e.target.value
                            setSelectedIngredients(updated)
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedIngredients(
                              selectedIngredients.filter((_, idx) => idx !== index)
                            )
                          }}
                          className="p-1 hover:bg-red-50 hover:text-red-500 rounded text-gray-405"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Chống chỉ định & Cảnh báo an toàn
                </label>
                <textarea
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all resize-none"
                  placeholder="VD: Không sử dụng cho các động vật mẫn cảm với thành phần của thuốc/vaccine..."
                  value={contraindications}
                  onChange={e => setContraindications(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Thời gian ngưng thuốc (Khai thác thịt - ngày)
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500"
                    placeholder="VD: 7"
                    value={withdrawalPeriodMeat}
                    onChange={e => setWithdrawalPeriodMeat(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Thời gian ngưng thuốc (Khai thác sữa/trứng - ngày)
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500"
                    placeholder="VD: 3"
                    value={withdrawalPeriodMilkEgg}
                    onChange={e => setWithdrawalPeriodMilkEgg(e.target.value)}
                  />
                </div>
              </div>

            </div>

            {/* Footer Buttons */}
            <div className="border-t border-gray-100 pt-6 flex items-center justify-end gap-3 mt-8">
              <button
                type="button"
                onClick={onClose}
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
