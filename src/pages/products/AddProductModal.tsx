import { useState, useEffect } from 'react'
import { X, ShieldAlert, Check, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

interface AddProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AddProductModal({ isOpen, onClose, onSuccess }: AddProductModalProps) {
  const { settings } = useDisplaySettings()

  // Form States
  const [sku, setSku] = useState('')
  const [isSkuManuallyEdited, setIsSkuManuallyEdited] = useState(false)
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
  const [selectedIngredients, setSelectedIngredients] = useState<Record<string, string>>({})
  const [allIngredients, setAllIngredients] = useState<{ id: string; name: string }[]>([])
  const [allDiseases, setAllDiseases] = useState<{ id: string; name: string; code: string }[]>([])
  const [selectedDiseaseIds, setSelectedDiseaseIds] = useState<string[]>([])
  const [ingSearch, setIngSearch] = useState('')
  const [disSearch, setDisSearch] = useState('')

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
  const [categories, setCategories] = useState<{ id: string; code: string; name: string }[]>([])
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  const [units, setUnits] = useState<string[]>([])
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
          .select('id, code, name')
          .eq('is_active', true)
        
        if (!catErr && catData) {
          setCategories(catData as any)
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
          plData.forEach((list: any) => {
            initialMap[list.id] = 0
          })
          setPricesMap(initialMap)
        }

        // Fetch active ingredients
        const { data: ingData, error: ingErr } = await supabase
          .from('active_ingredients')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
        
        if (!ingErr && ingData) {
          setAllIngredients(ingData)
        }

        // Fetch all diseases
        const { data: disData, error: disErr } = await supabase
          .from('disease_dictionary')
          .select('id, name, code')
          .order('name')
        if (!disErr && disData) {
          setAllDiseases(disData)
        }

        // Fetch units
        const { data: unitData, error: unitErr } = await supabase
          .from('product_units')
          .select('name')
          .eq('is_active', true)
          .order('name', { ascending: true })

        if (!unitErr && unitData && unitData.length > 0) {
          const unitNames = unitData.map((u: any) => u.name)
          setUnits(unitNames)
          setUnit(unitNames[0])
        } else {
          // Fallback to local storage or defaults
          const saved = localStorage.getItem('product-units')
          if (saved) {
            const parsed = JSON.parse(saved) as { name: string; is_active: boolean }[]
            const activeNames = parsed.filter(u => u.is_active).map(u => u.name)
            setUnits(activeNames)
            if (activeNames.length > 0) setUnit(activeNames[0])
          } else {
            const defaultNames = ['lọ', 'kg', 'gói', 'cái', 'lon', 'túi', 'chai']
            setUnits(defaultNames)
            setUnit(defaultNames[0])
          }
        }
      } catch (err) {
        console.error('Error fetching lookup data:', err)
      } finally {
        setLoading(false)
      }
    }

    loadLookupData()
  }, [isOpen])

  // Auto SKU generation
  useEffect(() => {
    if (!categoryId || isSkuManuallyEdited || !isOpen || categories.length === 0) return

    const generateSku = async () => {
      try {
        const cat = categories.find(c => c.id === categoryId)
        if (!cat) return

        let prefix = 'PROD'
        if (cat.code) {
          const rawCode = cat.code.toLowerCase()
          if (rawCode.includes('med')) prefix = 'MED'
          else if (rawCode.includes('vac')) prefix = 'VAC'
          else if (rawCode.includes('feed') || rawCode.includes('supp')) prefix = 'SUP'
          else if (rawCode.includes('equ')) prefix = 'EQU'
          else if (rawCode.includes('chem')) prefix = 'CHM'
          else if (rawCode.includes('tool')) prefix = 'TOL'
          else prefix = cat.code.substring(0, 3).toUpperCase()
        }

        const { count, error } = await supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('category_id', categoryId)

        if (!error) {
          const nextIndex = (count || 0) + 1
          const generatedSku = `${prefix}-${String(nextIndex).padStart(5, '0')}`
          setSku(generatedSku)
        }
      } catch (err) {
        console.error('Error generating SKU:', err)
      }
    }

    generateSku()
  }, [categoryId, categories, isSkuManuallyEdited, isOpen])

  // Clear form
  const resetForm = () => {
    setSku('')
    setIsSkuManuallyEdited(false)
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
    setRegistrationNumber('')
    setContraindications('')
    setWithdrawalPeriodMeat('')
    setWithdrawalPeriodMilkEgg('')
    setSelectedIngredients({})
    setSelectedDiseaseIds([])
    setIngSearch('')
    setDisSearch('')
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
          image_urls: [],
          registration_number: registrationNumber.trim() || null,
          contraindications: contraindications.trim() || null,
          withdrawal_period_meat: withdrawalPeriodMeat ? parseInt(withdrawalPeriodMeat) : null,
          withdrawal_period_milk_egg: withdrawalPeriodMilkEgg ? parseInt(withdrawalPeriodMilkEgg) : null
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

        // Insert active ingredients links if any
        const ingredientKeys = Object.keys(selectedIngredients)
        if (ingredientKeys.length > 0) {
          const ingredientItems = ingredientKeys.map(ingId => ({
            product_id: newProd.id,
            active_ingredient_id: ingId,
            percentage_or_dosage: selectedIngredients[ingId].trim()
          }))

          const { error: ingLinkErr } = await supabase
            .from('product_active_ingredients')
            .insert(ingredientItems)

          if (ingLinkErr) {
            console.error('Error inserting product ingredients:', ingLinkErr)
          }
        }

        // Insert product indications if any
        if (selectedDiseaseIds.length > 0) {
          const indicationItems = selectedDiseaseIds.map(disId => ({
            product_id: newProd.id,
            disease_id: disId
          }))

          const { error: indErr } = await supabase
            .from('product_indications')
            .insert(indicationItems)

          if (indErr) {
            console.error('Error inserting product indications:', indErr)
          }
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

  const filteredAllIngredients = allIngredients.filter(ing =>
    ing.name.toLowerCase().includes(ingSearch.toLowerCase())
  )

  const filteredAllDiseases = allDiseases.filter(dis =>
    dis.name.toLowerCase().includes(disSearch.toLowerCase()) ||
    dis.code.toLowerCase().includes(disSearch.toLowerCase())
  )

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex justify-end transition-opacity duration-300">
      <div className="bg-gray-0 w-full max-w-4xl h-full shadow-2xl flex flex-col py-6 px-8 animate-in slide-in-from-right duration-250 overflow-y-auto">
        
        {/* Header */}
        <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-6">
          <div>
            <h3 className="text-body-lg font-bold text-gray-800">Thêm sản phẩm mới</h3>
            <p className="text-tiny text-gray-400">Tạo catalog thuốc thú y/thiết bị và cấu hình chi tiết</p>
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
          <form onSubmit={handleSubmit} className="flex-grow flex flex-col justify-between">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              
              {/* Left Column: Basic info, prices, lot management */}
              <div className="space-y-5">
                <h4 className="text-body-md font-bold text-gray-800 border-b border-gray-100 pb-2">Thông tin cơ bản & Bảng giá</h4>
                
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
                      onChange={e => {
                        setSku(e.target.value)
                        setIsSkuManuallyEdited(true)
                      }}
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-xl flex items-center justify-between">
                    <div>
                      <p className="text-body-sm font-bold text-amber-800">Quản lý theo Lô/Hạn</p>
                      <p className="text-[10px] text-amber-600">Bắt buộc số lô & HSD</p>
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
                      <p className="text-body-sm font-bold text-blue-800">Đang kinh doanh</p>
                      <p className="text-[10px] text-blue-600">Hiển thị trong danh mục</p>
                    </div>
                    <input
                      type="checkbox"
                      className="w-5 h-5 border-gray-300 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                      checked={isActive}
                      onChange={e => setIsActive(e.target.checked)}
                    />
                  </div>
                </div>

                <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl space-y-4">
                  <p className="text-tiny font-bold text-gray-500 uppercase tracking-wider">
                    Cài đặt Giá khởi tạo ({settings.currency_symbol})
                  </p>
                  
                  <div>
                    <label className="block text-tiny font-semibold text-gray-500 mb-1">Giá vốn ({settings.currency_symbol})</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-semibold"
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
                    💡 Gợi ý: Khi nhập <strong>Giá bán lẻ đề xuất</strong>, hệ thống tự gợi ý giá đại lý (-15%) và giá VIP (-25%), bạn có thể chỉnh sửa tùy ý.
                  </p>
                </div>
              </div>

              {/* Right Column: Active ingredients, diseases, technical specs */}
              <div className="space-y-5">
                <h4 className="text-body-md font-bold text-gray-800 border-b border-gray-100 pb-2">Thành phần kỹ thuật & Chỉ định</h4>
                
                {/* Active Ingredients Checklist */}
                <div className="space-y-2">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">
                    Thành phần hoạt chất
                  </label>
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input
                      type="text"
                      placeholder="Tìm hoạt chất..."
                      className="w-full h-8 pl-8 pr-3 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500 bg-gray-50"
                      value={ingSearch}
                      onChange={e => setIngSearch(e.target.value)}
                    />
                  </div>
                  <div className="h-44 border border-gray-200 rounded-lg overflow-y-auto p-3 space-y-2.5 bg-gray-50/50">
                    {filteredAllIngredients.length === 0 ? (
                      <p className="text-tiny text-gray-400 italic">Không tìm thấy hoạt chất nào.</p>
                    ) : (
                      filteredAllIngredients.map(ing => {
                        const isChecked = selectedIngredients[ing.id] !== undefined
                        return (
                          <div key={ing.id} className="flex items-center justify-between gap-3 p-1.5 hover:bg-gray-100/50 rounded-md transition-colors">
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                className="w-4.5 h-4.5 border-gray-300 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                                checked={isChecked}
                                onChange={e => {
                                  setSelectedIngredients(prev => {
                                    const copy = { ...prev }
                                    if (e.target.checked) {
                                      copy[ing.id] = ''
                                    } else {
                                      delete copy[ing.id]
                                    }
                                    return copy
                                  })
                                }}
                              />
                              <span className="text-body-sm font-semibold text-gray-700 truncate" title={ing.name}>
                                {ing.name}
                              </span>
                            </label>
                            {isChecked && (
                              <input
                                type="text"
                                required
                                placeholder="Hàm lượng (VD: 500mg, 20%)"
                                className="w-36 h-8 px-2 border border-gray-200 rounded-md text-body-sm focus:outline-none focus:border-blue-500 font-semibold bg-white"
                                value={selectedIngredients[ing.id]}
                                onChange={e => {
                                  const val = e.target.value
                                  setSelectedIngredients(prev => ({
                                    ...prev,
                                    [ing.id]: val
                                  }))
                                }}
                              />
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Disease Indications Checklist */}
                <div className="space-y-2">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">
                    Chỉ định điều trị bệnh lý
                  </label>
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input
                      type="text"
                      placeholder="Tìm bệnh lý..."
                      className="w-full h-8 pl-8 pr-3 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500 bg-gray-50"
                      value={disSearch}
                      onChange={e => setDisSearch(e.target.value)}
                    />
                  </div>
                  <div className="h-44 border border-gray-200 rounded-lg overflow-y-auto p-3 space-y-2 bg-gray-50/50">
                    {filteredAllDiseases.length === 0 ? (
                      <p className="text-tiny text-gray-400 italic">Không tìm thấy bệnh lý nào.</p>
                    ) : (
                      filteredAllDiseases.map(dis => {
                        const isChecked = selectedDiseaseIds.includes(dis.id)
                        return (
                          <label key={dis.id} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-gray-100/50 rounded-md transition-colors">
                            <input
                              type="checkbox"
                              className="w-4.5 h-4.5 border-gray-300 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                              checked={isChecked}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedDiseaseIds(prev => [...prev, dis.id])
                                } else {
                                  setSelectedDiseaseIds(prev => prev.filter(id => id !== dis.id))
                                }
                              }}
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="text-body-sm font-semibold text-gray-700 truncate">
                                {dis.name}
                              </span>
                              <span className="text-[10px] font-mono text-gray-400 font-bold uppercase">{dis.code}</span>
                            </div>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Technical Instructions */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Điều kiện bảo quản
                    </label>
                    <textarea
                      rows={2}
                      className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 resize-none leading-normal"
                      placeholder="VD: Tránh ánh sáng, 2-8°C..."
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
                      className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 resize-none leading-normal"
                      placeholder="VD: Pha nước uống..."
                      value={usageInstructions}
                      onChange={e => setUsageInstructions(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-tiny font-bold text-gray-450 uppercase tracking-wider mb-2">
                    Chống chỉ định & Cảnh báo an toàn
                  </label>
                  <textarea
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 resize-none leading-normal"
                    placeholder="VD: Không sử dụng cho các động vật mẫn cảm..."
                    value={contraindications}
                    onChange={e => setContraindications(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Thời gian ngưng (Thịt - ngày)
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
                      Thời gian ngưng (Sữa/trứng - ngày)
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
