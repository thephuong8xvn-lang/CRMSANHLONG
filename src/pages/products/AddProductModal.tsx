import { useState, useEffect, useMemo } from 'react'
import { X, ShieldAlert, Check, Search, Info, DollarSign, Activity, FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import SmartSearchSelect from '../../components/SmartSearchSelect'
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
  const [isLotManaged, setIsLotManaged] = useState(true)
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
  const [activeTab, setActiveTab] = useState<'basic' | 'pricing' | 'ingredients' | 'technical'>('basic')

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

  const unitOptions = useMemo(() => {
    const list = units.length === 0 ? ['lọ'] : units
    return list.map(u => ({ value: u, label: u }))
  }, [units])

  const categoryOptions = useMemo(() => {
    return categories.map(cat => ({ value: cat.id, label: cat.name, desc: cat.code ? `Mã: ${cat.code}` : undefined }))
  }, [categories])

  const brandOptions = useMemo(() => {
    return brands.map(b => ({ value: b.id, label: b.name }))
  }, [brands])

  // Load lookup lists
  useEffect(() => {
    if (!isOpen) return

    const defaultUnits = ['lọ', 'chai', 'gói', 'hộp', 'kg', 'g', 'ml', 'L', 'cái', 'lon', 'túi', 'liều', 'thùng']

    const loadLookupData = async () => {
      setLoading(true)
      setErrorMsg('')

      // Đặt fallback units ngay lập tức từ localStorage hoặc mặc định
      const savedUnits = localStorage.getItem('product-units')
      if (savedUnits) {
        try {
          const parsed = JSON.parse(savedUnits) as { name: string; is_active: boolean }[]
          const activeNames = parsed.filter(u => u.is_active).map(u => u.name)
          if (activeNames.length > 0) {
            setUnits(activeNames)
            setUnit(activeNames[0])
          } else {
            setUnits(defaultUnits)
            setUnit(defaultUnits[0])
          }
        } catch {
          setUnits(defaultUnits)
          setUnit(defaultUnits[0])
        }
      } else {
        setUnits(defaultUnits)
        setUnit(defaultUnits[0])
      }

      try {
        // Fetch categories
        const { data: catData, error: catErr } = await supabase
          .from('product_categories')
          .select('id, code, name, is_active')
          .order('sort_order', { ascending: true })
        
        if (catErr) {
          console.warn('[AddProduct] product_categories error:', catErr.message)
        } else if (catData && catData.length > 0) {
          // Filter phía client – chỉ lấy nhóm đang hoạt động
          const active = catData.filter((c: any) => c.is_active !== false)
          setCategories(active as any)
        }

        // Fetch brands
        const { data: brandData, error: brandErr } = await supabase
          .from('brands')
          .select('id, name, is_active')
          .order('name', { ascending: true })
        
        if (brandErr) {
          console.warn('[AddProduct] brands error:', brandErr.message)
        } else if (brandData && brandData.length > 0) {
          const active = brandData.filter((b: any) => b.is_active !== false)
          setBrands(active)
        }

        // Fetch price lists
        const { data: plData, error: plErr } = await supabase
          .from('price_lists')
          .select('id, code, name, is_active')
        
        if (plErr) {
          console.warn('[AddProduct] price_lists error:', plErr.message)
        } else if (plData && plData.length > 0) {
          const active = plData.filter((p: any) => p.is_active !== false)
          setPriceLists(active)
          const initialMap: Record<string, number> = {}
          active.forEach((list: any) => {
            initialMap[list.id] = 0
          })
          setPricesMap(initialMap)
        }

        // Fetch active ingredients
        const { data: ingData, error: ingErr } = await supabase
          .from('active_ingredients')
          .select('id, name, is_active')
          .order('name')
        
        if (ingErr) {
          console.warn('[AddProduct] active_ingredients error:', ingErr.message)
        } else if (ingData) {
          setAllIngredients(ingData.filter((i: any) => i.is_active !== false))
        }

        // Fetch all diseases
        const { data: disData, error: disErr } = await supabase
          .from('disease_dictionary')
          .select('id, name, code')
          .order('name')
        if (disErr) {
          console.warn('[AddProduct] disease_dictionary error:', disErr.message)
        } else if (disData) {
          setAllDiseases(disData)
        }

        // Fetch units từ DB – override localStorage nếu DB có data
        const { data: unitData, error: unitErr } = await supabase
          .from('product_units')
          .select('name, is_active')
          .order('name', { ascending: true })

        if (unitErr) {
          console.warn('[AddProduct] product_units error:', unitErr.message)
          // Giữ localStorage fallback đã đặt sẵn
        } else if (unitData && unitData.length > 0) {
          // DB có data → override localStorage
          const unitNames = unitData
            .filter((u: any) => u.is_active !== false)
            .map((u: any) => u.name)
          if (unitNames.length > 0) {
            setUnits(unitNames)
            setUnit(unitNames[0])
          }
        }
        // Nếu unitData rỗng: giữ localStorage fallback
      } catch (err) {
        console.error('[AddProduct] Error fetching lookup data:', err)
      } finally {
        setLoading(false)
      }
    }

    loadLookupData()
  }, [isOpen])

  // Auto SKU generation – sinh mã ngay khi mở modal
  useEffect(() => {
    if (isSkuManuallyEdited || !isOpen) return

    const generateSku = async () => {
      try {
        let prefix = 'PROD'
        let countFilter: Record<string, string> = {}

        // Nếu đã chọn category → dùng prefix của category
        if (categoryId && categories.length > 0) {
          const cat = categories.find(c => c.id === categoryId)
          if (cat?.code) {
            const rawCode = cat.code.toLowerCase()
            if (rawCode.includes('vac'))                          prefix = 'VAC'
            else if (rawCode.includes('med'))                     prefix = 'MED'
            else if (rawCode.includes('para'))                    prefix = 'PAR'
            else if (rawCode.includes('nutr'))                    prefix = 'NUT'
            else if (rawCode.includes('supp'))                    prefix = 'SUP'
            else if (rawCode.includes('equ'))                     prefix = 'EQU'
            else if (rawCode.includes('chm') || rawCode.includes('chem')) prefix = 'CHM'
            else if (rawCode.includes('feed'))                    prefix = 'FEED'
            else                                                  prefix = cat.code.substring(0, 3).toUpperCase()
          }
          countFilter = { category_id: categoryId }
        }

        // Đếm số sản phẩm hiện có (theo category nếu có, hoặc toàn bộ)
        let query = supabase.from('products').select('id', { count: 'exact', head: true })
        if (countFilter.category_id) {
          query = query.eq('category_id', countFilter.category_id)
        }
        const { count, error } = await query

        if (!error) {
          const nextIndex = (count || 0) + 1
          const generatedSku = `${prefix}-${String(nextIndex).padStart(5, '0')}`
          setSku(generatedSku)
        } else {
          // Fallback: dùng timestamp
          const ts = Date.now().toString().slice(-6)
          setSku(`${prefix}-${ts}`)
        }
      } catch (err) {
        console.error('Error generating SKU:', err)
        // Fallback timestamp
        const ts = Date.now().toString().slice(-6)
        setSku(`PROD-${ts}`)
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
    setCategoryId('')
    setBrandId('')
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
    setActiveTab('basic')
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
          try {
            const indicationItems = selectedDiseaseIds.map(disId => ({
              product_id: newProd.id,
              disease_id: disId
            }))

            const { error: indErr } = await supabase
              .from('product_indications')
              .insert(indicationItems)

            if (indErr) {
              if (indErr.code === 'PGRST205' || indErr.message.includes('relation') || indErr.message.includes('not found')) {
                console.warn('product_indications table does not exist, skipping indications insert')
              } else {
                console.error('Error inserting product indications:', indErr)
              }
            }
          } catch (e: any) {
            console.warn('Could not insert product indications:', e.message)
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300">
      <div role="dialog" aria-modal="true" className="bg-white rounded-2xl w-full max-w-5xl h-[85vh] max-h-[750px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden border border-gray-100">
        
        {/* Header */}
        <div className="flex justify-between items-center border-b border-gray-100 px-8 py-4 bg-gray-25 shrink-0">
          <div>
            <h3 className="text-body-lg font-bold text-gray-800">Thêm sản phẩm mới</h3>
            <p className="text-tiny text-gray-400">Tạo catalog thuốc thú y/thiết bị và cấu hình chi tiết</p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm()
              onClose()
            }}
            className="p-1.5 hover:bg-gray-200 rounded-full text-gray-400 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Headers */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-8 shrink-0">
          {[
            { id: 'basic', label: 'Thông tin chung', icon: Info },
            { id: 'pricing', label: 'Giá & Bảng giá', icon: DollarSign },
            { id: 'ingredients', label: 'Thành phần & Chỉ định', icon: Activity },
            { id: 'technical', label: 'Thông số kỹ thuật', icon: FileText },
          ].map(tab => {
            const TabIcon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 py-3 px-6 font-bold text-body-md border-b-2 transition-all focus:outline-none ${
                  active
                    ? 'border-blue-500 text-blue-600 bg-white -mb-[2px] rounded-t-lg border-t border-x border-gray-200'
                    : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'
                }`}
              >
                <TabIcon size={16} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-8 mt-4 p-4 bg-danger-50 border border-danger-100 rounded-lg text-danger-600 text-body-md flex items-start gap-2 shrink-0">
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
          <form onSubmit={handleSubmit} className="flex-grow flex flex-col justify-between overflow-hidden p-8">
            <div className="flex-1 overflow-y-auto pr-2 min-h-0 py-2">
              
              {/* ────────────────── Tab 1: General Info ────────────────── */}
              {activeTab === 'basic' && (
                <div className="space-y-6 max-w-3xl mx-auto">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                    <div className="md:col-span-2">
                      <label htmlFor="product-name" className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Tên sản phẩm <span className="text-danger-500">*</span>
                      </label>
                      <input
                        id="product-name"
                        type="text"
                        required
                        className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all"
                        placeholder="VD: Vaccine Dịch tả heo cổ điển"
                        value={name}
                        onChange={e => setName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Đơn vị tính <span className="text-danger-500">*</span>
                      </label>
                      <SmartSearchSelect
                        options={unitOptions}
                        value={unit}
                        onChange={val => setUnit(val)}
                        placeholder="-- Chọn đơn vị tính --"
                        searchPlaceholder="Tìm đơn vị tính..."
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Phân loại danh mục
                      </label>
                      <SmartSearchSelect
                        options={categoryOptions}
                        value={categoryId}
                        onChange={val => setCategoryId(val)}
                        placeholder="-- Chọn danh mục --"
                        searchPlaceholder="Tìm kiếm danh mục..."
                      />
                    </div>
                    <div>
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Thương hiệu
                      </label>
                      <SmartSearchSelect
                        options={brandOptions}
                        value={brandId}
                        onChange={val => setBrandId(val)}
                        placeholder="-- Chọn thương hiệu --"
                        searchPlaceholder="Tìm kiếm thương hiệu..."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                      <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-xl flex items-center justify-between shadow-sm">
                        <div>
                          <p className="text-body-sm font-bold text-amber-800">Quản lý theo Lô</p>
                          <p className="text-[10px] text-amber-600">Bắt buộc số lô & HSD</p>
                        </div>
                        <input
                          type="checkbox"
                          className="w-5 h-5 border-gray-300 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                          checked={isLotManaged}
                          onChange={e => setIsLotManaged(e.target.checked)}
                        />
                      </div>
                      <div className="p-4 bg-blue-50/40 border border-blue-100 rounded-xl flex items-center justify-between shadow-sm">
                        <div>
                          <p className="text-body-sm font-bold text-blue-800">Đang hoạt động</p>
                          <p className="text-[10px] text-blue-600">Bán trong POS/Đơn hàng</p>
                        </div>
                        <input
                          type="checkbox"
                          className="w-5 h-5 border-gray-300 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                          checked={isActive}
                          onChange={e => setIsActive(e.target.checked)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ────────────────── Tab 2: Pricing Settings ────────────────── */}
              {activeTab === 'pricing' && (
                <div className="space-y-6 max-w-2xl mx-auto animate-in fade-in duration-200">
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 space-y-6 shadow-sm">
                    <h4 className="text-body-md font-bold text-gray-700 border-b border-gray-200 pb-3 flex items-center gap-2">
                      <DollarSign size={18} className="text-blue-500" />
                      Cài đặt Giá vốn & Bảng giá bán lẻ
                    </h4>
                    
                    <div className="grid grid-cols-1 gap-6">
                      <div>
                        <label htmlFor="product-cost-price" className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">Giá vốn nhập hàng ({settings.currency_symbol})</label>
                        <div className="relative">
                          <input
                            id="product-cost-price"
                            type="number"
                            min={0}
                            className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-semibold"
                            value={costPrice || ''}
                            onChange={e => setCostPrice(Number(e.target.value))}
                            placeholder="0"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-tiny font-bold text-gray-400">{settings.currency_symbol}</span>
                        </div>
                      </div>

                      <div className="space-y-4 pt-4 border-t border-gray-200">
                        <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">Giá bán đề xuất theo bảng giá</label>
                        <div className="grid grid-cols-1 gap-4">
                          {priceLists.map(list => (
                            <div key={list.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white border border-gray-100 rounded-xl hover:shadow-sm transition-all">
                              <span className="text-body-md text-gray-700 font-bold min-w-[150px]">{list.name}</span>
                              <div className="relative w-full sm:max-w-[250px]">
                                <input
                                  type="number"
                                  min={0}
                                  className={`w-full h-10 pl-3 pr-10 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-bold ${
                                    list.code === 'GIA-LE' ? 'text-blue-600 border-blue-200 shadow-sm' : 'text-gray-800'
                                  }`}
                                  value={pricesMap[list.id] || ''}
                                  onChange={e => handlePriceChange(list.id, Number(e.target.value))}
                                  placeholder="0"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-tiny font-bold text-gray-400">{settings.currency_symbol}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl text-body-sm text-blue-700 leading-normal flex items-start gap-2">
                      <span className="text-base">💡</span>
                      <p>
                        Khi nhập <strong>Giá bán lẻ đề xuất</strong>, hệ thống tự động gợi ý giá đại lý (-15%) và giá VIP (-25%). Bạn có thể tùy ý sửa đổi từng mức giá riêng biệt.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ────────────────── Tab 3: Composition & Treatment ────────────────── */}
              {activeTab === 'ingredients' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start h-full animate-in fade-in duration-200">
                  {/* Left Column: Active Ingredients */}
                  <div className="border border-gray-200 rounded-2xl p-5 bg-white shadow-sm flex flex-col h-[350px] lg:h-[400px]">
                    <h4 className="text-body-md font-bold text-gray-700 border-b border-gray-200 pb-3 flex items-center justify-between">
                      <span>Thành phần hoạt chất</span>
                      <span className="text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold">
                        Đã chọn {Object.keys(selectedIngredients).length}
                      </span>
                    </h4>
                    <div className="relative my-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                      <input
                        type="text"
                        placeholder="Tìm kiếm nhanh hoạt chất..."
                        className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500 bg-gray-50 focus:bg-white transition-all"
                        value={ingSearch}
                        onChange={e => setIngSearch(e.target.value)}
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 no-scrollbar">
                      {filteredAllIngredients.length === 0 ? (
                        <p className="text-tiny text-gray-400 italic text-center py-8">Không tìm thấy hoạt chất nào.</p>
                      ) : (
                        filteredAllIngredients.map(ing => {
                          const isChecked = selectedIngredients[ing.id] !== undefined
                          return (
                            <div key={ing.id} className={`flex items-center justify-between gap-3 p-2 rounded-xl border transition-all ${
                              isChecked ? 'border-blue-200 bg-blue-50/20 shadow-sm' : 'border-gray-100 hover:bg-gray-50'
                            }`}>
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
                                  className="w-32 h-8 px-2 border border-blue-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500 font-semibold bg-white"
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

                  {/* Right Column: Disease Indications */}
                  <div className="border border-gray-200 rounded-2xl p-5 bg-white shadow-sm flex flex-col h-[350px] lg:h-[400px]">
                    <h4 className="text-body-md font-bold text-gray-700 border-b border-gray-200 pb-3 flex items-center justify-between">
                      <span>Chỉ định điều trị bệnh lý</span>
                      <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                        Đã chọn {selectedDiseaseIds.length}
                      </span>
                    </h4>
                    <div className="relative my-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                      <input
                        type="text"
                        placeholder="Tìm kiếm bệnh lý..."
                        className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500 bg-gray-50 focus:bg-white transition-all"
                        value={disSearch}
                        onChange={e => setDisSearch(e.target.value)}
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 no-scrollbar">
                      {filteredAllDiseases.length === 0 ? (
                        <p className="text-tiny text-gray-400 italic text-center py-8">Không tìm thấy bệnh lý nào.</p>
                      ) : (
                        filteredAllDiseases.map(dis => {
                          const isChecked = selectedDiseaseIds.includes(dis.id)
                          return (
                            <label key={dis.id} className={`flex items-center gap-3 cursor-pointer p-2 rounded-xl border transition-all ${
                              isChecked ? 'border-emerald-200 bg-emerald-50/10 shadow-sm' : 'border-gray-100 hover:bg-gray-50'
                            }`}>
                              <input
                                type="checkbox"
                                className="w-4.5 h-4.5 border-gray-300 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
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
                </div>
              )}

              {/* ────────────────── Tab 4: Technical & Safety ────────────────── */}
              {activeTab === 'technical' && (
                <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in duration-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Điều kiện bảo quản
                      </label>
                      <textarea
                        rows={3}
                        className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 leading-normal bg-white"
                        placeholder="VD: Tránh ánh sáng trực tiếp, bảo quản từ 2 - 8°C đối với vaccine..."
                        value={storageCondition}
                        onChange={e => setStorageCondition(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Hướng dẫn sử dụng & Liều dùng
                      </label>
                      <textarea
                        rows={3}
                        className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 leading-normal bg-white"
                        placeholder="VD: Pha nước uống hoặc trộn thức ăn theo tỷ lệ 1g/10kg thể trọng..."
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
                      rows={3}
                      className="w-full border border-gray-200 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 leading-normal bg-white"
                      placeholder="VD: Không sử dụng cho con vật mẫn cảm với penicillin..."
                      value={contraindications}
                      onChange={e => setContraindications(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                    <div>
                      <label className="block text-tiny font-bold text-gray-450 uppercase tracking-wider mb-2">
                        Thời gian ngưng thuốc khai thác Thịt (ngày)
                      </label>
                      <input
                        type="number"
                        min={0}
                        className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 font-semibold"
                        placeholder="VD: 7 (Bỏ trống nếu không có)"
                        value={withdrawalPeriodMeat}
                        onChange={e => setWithdrawalPeriodMeat(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Thời gian ngưng khai thác Sữa / Trứng (ngày)
                      </label>
                      <input
                        type="number"
                        min={0}
                        className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 focus:outline-none focus:border-blue-500 font-semibold"
                        placeholder="VD: 3 (Bỏ trống nếu không có)"
                        value={withdrawalPeriodMilkEgg}
                        onChange={e => setWithdrawalPeriodMilkEgg(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="border-t border-gray-100 pt-4 flex items-center justify-between shrink-0 bg-white z-10">
              <div>
                {activeTab !== 'basic' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTab === 'pricing') setActiveTab('basic')
                      else if (activeTab === 'ingredients') setActiveTab('pricing')
                      else if (activeTab === 'technical') setActiveTab('ingredients')
                    }}
                    className="h-10 px-4 border border-gray-200 text-gray-600 hover:text-gray-800 rounded-lg text-body-md font-bold hover:bg-gray-50 transition-all flex items-center gap-1.5"
                  >
                    <ChevronLeft size={16} />
                    Quay lại
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    resetForm()
                    onClose()
                  }}
                  className="h-10 px-5 border border-gray-200 text-gray-500 hover:text-gray-700 rounded-lg text-body-md font-semibold hover:bg-gray-50 transition-all"
                  disabled={submitting}
                >
                  Hủy
                </button>
                
                {activeTab !== 'technical' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTab === 'basic') setActiveTab('pricing')
                      else if (activeTab === 'pricing') setActiveTab('ingredients')
                      else if (activeTab === 'ingredients') setActiveTab('technical')
                    }}
                    className="h-10 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-body-md font-bold transition-all flex items-center gap-1.5"
                  >
                    Tiếp tục
                    <ChevronRight size={16} />
                  </button>
                )}

                <button
                  type="submit"
                  className="h-10 px-6 bg-blue-600 text-white rounded-lg text-body-md font-bold hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center gap-2 shadow-md"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
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
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
