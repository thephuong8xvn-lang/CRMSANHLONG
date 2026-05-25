import React, { useState, useEffect } from 'react'
import {
  Plus,
  Search,
  Edit,
  AlertTriangle,
  X,
  RefreshCw,
  Activity,
  Check,
  ShieldAlert,
  Info,
  Layers,
  Sparkles,
  Link,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface ProductActiveIngredientLink {
  percentage_or_dosage: string
  product: {
    id: string
    name: string
    sku: string
  } | null
}

interface ActiveIngredient {
  id: string
  name: string
  code: string | null
  is_active: boolean
  pharmacological_group: string | null
  standard_dosage: string | null
  withdrawal_period_meat: number | null
  withdrawal_period_milk_egg: number | null
  contraindications: string | null
  created_at: string
  product_active_ingredients?: ProductActiveIngredientLink[]
  pharmacological_group_id?: string | null
  pharmacological_groups?: { id: string; name: string } | null
}

interface Compatibility {
  id: string
  ingredient_a_id: string
  ingredient_b_id: string
  interaction_type: string
  description: string | null
  created_at: string
  ingredient_a: { id: string; name: string; code: string | null }
  ingredient_b: { id: string; name: string; code: string | null }
}

export default function ActiveIngredientsPage() {
  const [activeTab, setActiveTab] = useState<'list' | 'compatibility' | 'pharma_groups' | 'interaction_types'>('list')
  const [pharmaGroups, setPharmaGroups] = useState<any[]>([])
  const [interactionTypes, setInteractionTypes] = useState<any[]>([])

  // Pharmacological group form state
  const [showPharmaModal, setShowPharmaModal] = useState(false)
  const [selectedPharmaGroup, setSelectedPharmaGroup] = useState<any | null>(null)
  const [pgName, setPgName] = useState('')
  const [pgCode, setPgCode] = useState('')
  const [pgDesc, setPgDesc] = useState('')
  const [pgIsActive, setPgIsActive] = useState(true)
  const [pharmaSearch, setPharmaSearch] = useState('')

  // Interaction type form state
  const [showInteractionModal, setShowInteractionModal] = useState(false)
  const [selectedInteractionType, setSelectedInteractionType] = useState<any | null>(null)
  const [itCode, setItCode] = useState('')
  const [itName, setItName] = useState('')
  const [itDesc, setItDesc] = useState('')
  const [itColor, setItColor] = useState('gray')

  const [ingPharmaGroupId, setIngPharmaGroupId] = useState('')
  const [ingredients, setIngredients] = useState<ActiveIngredient[]>([])
  const [compatibilities, setCompatibilities] = useState<Compatibility[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasPharmaGroupsTable, setHasPharmaGroupsTable] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [expandedIngId, setExpandedIngId] = useState<string | null>(null)

  // Compatibility Search & Filter
  const [compatSearch, setCompatSearch] = useState('')
  const [compatTypeFilter, setCompatTypeFilter] = useState<'all' | 'synergy' | 'antagonism'>('all')

  // Modals state
  const [showIngModal, setShowIngModal] = useState(false)
  const [showCompatModal, setShowCompatModal] = useState(false)

  // Edit Ingredient State
  const [selectedIngredient, setSelectedIngredient] = useState<ActiveIngredient | null>(null)
  const [ingCode, setIngCode] = useState('')
  const [ingName, setIngName] = useState('')
  const [ingIsActive, setIngIsActive] = useState(true)
  const [ingPharmaGroup, setIngPharmaGroup] = useState('')
  const [ingStdDosage, setIngStdDosage] = useState('')
  const [ingWithdrawalMeat, setIngWithdrawalMeat] = useState<number | ''>('')
  const [ingWithdrawalMilkEgg, setIngWithdrawalMilkEgg] = useState<number | ''>('')
  const [ingContraindications, setIngContraindications] = useState('')

  // Edit Compatibility State
  const [selectedCompat, setSelectedCompat] = useState<Compatibility | null>(null)
  const [compatIngA, setCompatIngA] = useState('')
  const [compatIngB, setCompatIngB] = useState('')
  const [compatType, setCompatType] = useState<'synergy' | 'antagonism'>('synergy')
  const [compatDesc, setCompatDesc] = useState('')

  const showToast = (type: 'success' | 'error', text: string) => {
    setAlertMsg({ type, text })
    setTimeout(() => setAlertMsg(null), 4000)
  }

  const loadData = async () => {
    setLoading(true)
    try {
      // 1. Check if pharmacological_groups table exists in the database
      let useRelationalMode = false
      try {
        const { error: checkError } = await supabase
          .from('pharmacological_groups')
          .select('id')
          .limit(1)
        if (!checkError) {
          useRelationalMode = true
        }
      } catch (e) {
        // Table doesn't exist
      }
      setHasPharmaGroupsTable(useRelationalMode)

      // 2. Load Active Ingredients with linked products
      let selectQuery = `
        *,
        product_active_ingredients(
          percentage_or_dosage,
          product:products(id, name, sku)
        )
      `
      if (useRelationalMode) {
        selectQuery = `
          *,
          pharmacological_groups(id, name),
          product_active_ingredients(
            percentage_or_dosage,
            product:products(id, name, sku)
          )
        `
      }

      const { data: ingData, error: ingError } = await supabase
        .from('active_ingredients')
        .select(selectQuery)
        .order('name')
      
      if (ingError) throw ingError
      if (ingData) setIngredients(ingData as unknown as ActiveIngredient[])

      // 3. Load Compatibility Matrix
      const { data: compData, error: compError } = await supabase
        .from('active_ingredient_compatibility')
        .select(`
          *,
          ingredient_a:active_ingredients!ingredient_a_id(id, name, code),
          ingredient_b:active_ingredients!ingredient_b_id(id, name, code)
        `)
      
      if (compError) throw compError
      if (compData) setCompatibilities(compData as unknown as Compatibility[])

      // 4. Load pharmacological groups if table exists
      if (useRelationalMode) {
        const { data: pgData, error: pgError } = await supabase
          .from('pharmacological_groups')
          .select('*')
          .order('name')
        if (pgError) throw pgError
        if (pgData) setPharmaGroups(pgData)
      }

      // 5. Load compatibility interaction types
      try {
        const { data: itData, error: itError } = await supabase
          .from('compatibility_interaction_types')
          .select('*')
          .order('name')
        if (!itError && itData) setInteractionTypes(itData)
      } catch (e) {
        // Table doesn't exist
      }
    } catch (err: any) {
      console.error('Error fetching active ingredients and matrix:', err)
      showToast('error', 'Lỗi tải dữ liệu hoạt chất & ma trận: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // CRUD Active Ingredients
  const openNewIngredient = () => {
    setSelectedIngredient(null)
    setIngCode('')
    setIngName('')
    setIngIsActive(true)
    setIngPharmaGroup('')
    setIngPharmaGroupId('')
    setIngStdDosage('')
    setIngWithdrawalMeat('')
    setIngWithdrawalMilkEgg('')
    setIngContraindications('')
    setShowIngModal(true)
  }

  const openEditIngredient = (ing: ActiveIngredient) => {
    setSelectedIngredient(ing)
    setIngCode(ing.code || '')
    setIngName(ing.name)
    setIngIsActive(ing.is_active)
    setIngPharmaGroup(ing.pharmacological_group || '')
    setIngPharmaGroupId(ing.pharmacological_group_id || '')
    setIngStdDosage(ing.standard_dosage || '')
    setIngWithdrawalMeat(ing.withdrawal_period_meat !== null ? ing.withdrawal_period_meat : '')
    setIngWithdrawalMilkEgg(ing.withdrawal_period_milk_egg !== null ? ing.withdrawal_period_milk_egg : '')
    setIngContraindications(ing.contraindications || '')
    setShowIngModal(true)
  }

  const handleSaveIngredient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ingName.trim()) {
      showToast('error', 'Tên hoạt chất là bắt buộc.')
      return
    }

    setSaving(true)
    try {
      const payload: any = {
        code: ingCode.trim() ? ingCode.trim().toLowerCase() : null,
        name: ingName.trim(),
        is_active: ingIsActive,
        pharmacological_group: ingPharmaGroup.trim() || null,
        standard_dosage: ingStdDosage.trim() || null,
        withdrawal_period_meat: ingWithdrawalMeat !== '' ? Number(ingWithdrawalMeat) : null,
        withdrawal_period_milk_egg: ingWithdrawalMilkEgg !== '' ? Number(ingWithdrawalMilkEgg) : null,
        contraindications: ingContraindications.trim() || null
      }

      if (hasPharmaGroupsTable) {
        payload.pharmacological_group_id = ingPharmaGroupId || null
      }

      if (!selectedIngredient) {
        const { error } = await supabase.from('active_ingredients').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm hoạt chất mới thành công!')
      } else {
        const { error } = await supabase
          .from('active_ingredients')
          .update(payload)
          .eq('id', selectedIngredient.id)
        if (error) throw error
        showToast('success', 'Cập nhật hoạt chất thành công!')
      }

      setShowIngModal(false)
      loadData()
    } catch (err: any) {
      console.error('Error saving ingredient:', err)
      showToast('error', 'Lỗi lưu hoạt chất: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleIngredientActive = async (ing: ActiveIngredient) => {
    const nextState = !ing.is_active
    try {
      const { error } = await supabase
        .from('active_ingredients')
        .update({ is_active: nextState })
        .eq('id', ing.id)

      if (error) throw error
      showToast('success', `${nextState ? 'Kích hoạt' : 'Khóa'} hoạt chất thành công.`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi đổi trạng thái hoạt chất: ' + err.message)
    }
  }

  const handleDeleteIngredient = async (ing: ActiveIngredient) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa hoạt chất "${ing.name}"?`)) return
    try {
      const { error } = await supabase
        .from('active_ingredients')
        .delete()
        .eq('id', ing.id)

      if (error) {
        if (error.code === '23503') {
          throw new Error('Không thể xóa hoạt chất này vì đã liên kết với sản phẩm hoặc ma trận tương tác.')
        }
        throw error
      }
      showToast('success', 'Xóa hoạt chất thành công.')
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi xóa hoạt chất: ' + err.message)
    }
  }

  // CRUD Compatibility Matrix
  const openNewCompat = () => {
    setSelectedCompat(null)
    setCompatIngA('')
    setCompatIngB('')
    setCompatType('synergy')
    setCompatDesc('')
    setShowCompatModal(true)
  }

  const openEditCompat = (comp: Compatibility) => {
    setSelectedCompat(comp)
    setCompatIngA(comp.ingredient_a_id)
    setCompatIngB(comp.ingredient_b_id)
    setCompatType(comp.interaction_type as 'synergy' | 'antagonism')
    setCompatDesc(comp.description || '')
    setShowCompatModal(true)
  }

  const handleSaveCompat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!compatIngA || !compatIngB) {
      showToast('error', 'Vui lòng chọn cả hai hoạt chất.')
      return
    }
    if (compatIngA === compatIngB) {
      showToast('error', 'Hai hoạt chất được chọn phải khác nhau.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        ingredient_a_id: compatIngA,
        ingredient_b_id: compatIngB,
        interaction_type: compatType,
        description: compatDesc.trim() || null
      }

      if (!selectedCompat) {
        // Prevent duplicate combinations (A-B or B-A) in DB constraint
        const duplicate = compatibilities.find(
          c => (c.ingredient_a_id === compatIngA && c.ingredient_b_id === compatIngB) ||
               (c.ingredient_a_id === compatIngB && c.ingredient_b_id === compatIngA)
        )
        if (duplicate) {
          throw new Error('Quan hệ tương tác giữa 2 hoạt chất này đã tồn tại.')
        }

        const { error } = await supabase.from('active_ingredient_compatibility').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm quy tắc tương thích thành công!')
      } else {
        const { error } = await supabase
          .from('active_ingredient_compatibility')
          .update(payload)
          .eq('id', selectedCompat.id)
        if (error) throw error
        showToast('success', 'Cập nhật quy tắc tương thích thành công!')
      }

      setShowCompatModal(false)
      loadData()
    } catch (err: any) {
      console.error('Error saving compatibility:', err)
      showToast('error', 'Lỗi lưu tương thích: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCompat = async (comp: Compatibility) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa quy tắc tương thích này?`)) return
    try {
      const { error } = await supabase
        .from('active_ingredient_compatibility')
        .delete()
        .eq('id', comp.id)

      if (error) throw error
      showToast('success', 'Xóa quy tắc tương thích thành công.')
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi xóa tương thích: ' + err.message)
    }
  }

  // CRUD Pharmacological Groups
  const openNewPharmaGroup = () => {
    setSelectedPharmaGroup(null)
    setPgName('')
    setPgCode('')
    setPgDesc('')
    setPgIsActive(true)
    setShowPharmaModal(true)
  }

  const openEditPharmaGroup = (pg: any) => {
    setSelectedPharmaGroup(pg)
    setPgName(pg.name)
    setPgCode(pg.code || '')
    setPgDesc(pg.description || '')
    setPgIsActive(pg.is_active)
    setShowPharmaModal(true)
  }

  const handleSavePharmaGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pgName.trim()) {
      showToast('error', 'Tên nhóm dược lý là bắt buộc.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: pgName.trim(),
        code: pgCode.trim() ? pgCode.trim().toLowerCase() : null,
        description: pgDesc.trim() || null,
        is_active: pgIsActive
      }

      if (!selectedPharmaGroup) {
        const { error } = await supabase.from('pharmacological_groups').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm nhóm dược lý thành công!')
      } else {
        const { error } = await supabase
          .from('pharmacological_groups')
          .update(payload)
          .eq('id', selectedPharmaGroup.id)
        if (error) throw error
        showToast('success', 'Cập nhật nhóm dược lý thành công!')
      }
      setShowPharmaModal(false)
      loadData()
    } catch (err: any) {
      console.error('Error saving pharma group:', err)
      showToast('error', 'Lỗi lưu nhóm dược lý: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeletePharmaGroup = async (pg: any) => {
    const linkedCount = ingredients.filter(ing => ing.pharmacological_group_id === pg.id).length
    if (linkedCount > 0) {
      showToast('error', `Không thể xóa nhóm dược lý này vì đang có ${linkedCount} hoạt chất liên kết.`)
      return
    }
    if (!window.confirm(`Bạn có chắc chắn muốn xóa nhóm dược lý "${pg.name}"?`)) return
    try {
      const { error } = await supabase.from('pharmacological_groups').delete().eq('id', pg.id)
      if (error) throw error
      showToast('success', 'Xóa nhóm dược lý thành công.')
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi xóa nhóm dược lý: ' + err.message)
    }
  }

  // CRUD Interaction Types
  const openNewInteractionType = () => {
    setSelectedInteractionType(null)
    setItCode('')
    setItName('')
    setItDesc('')
    setItColor('gray')
    setShowInteractionModal(true)
  }

  const openEditInteractionType = (it: any) => {
    setSelectedInteractionType(it)
    setItCode(it.code)
    setItName(it.name)
    setItDesc(it.description || '')
    setItColor(it.color_code || 'gray')
    setShowInteractionModal(true)
  }

  const handleSaveInteractionType = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!itCode.trim() || !itName.trim()) {
      showToast('error', 'Mã và tên loại tương tác là bắt buộc.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        code: itCode.trim().toLowerCase(),
        name: itName.trim(),
        description: itDesc.trim() || null,
        color_code: itColor
      }

      if (!selectedInteractionType) {
        const { error } = await supabase.from('compatibility_interaction_types').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm loại tương tác thành công!')
      } else {
        const { error } = await supabase
          .from('compatibility_interaction_types')
          .update(payload)
          .eq('id', selectedInteractionType.id)
        if (error) throw error
        showToast('success', 'Cập nhật loại tương tác thành công!')
      }
      setShowInteractionModal(false)
      loadData()
    } catch (err: any) {
      console.error('Error saving interaction type:', err)
      showToast('error', 'Lỗi lưu loại tương tác: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteInteractionType = async (it: any) => {
    const linkedCount = compatibilities.filter(c => c.interaction_type === it.code).length
    if (linkedCount > 0) {
      showToast('error', `Không thể xóa loại tương tác này vì đang có ${linkedCount} quy tắc tương hợp liên kết.`)
      return
    }
    if (!window.confirm(`Bạn có chắc chắn muốn xóa loại tương tác "${it.name}"?`)) return
    try {
      const { error } = await supabase.from('compatibility_interaction_types').delete().eq('id', it.id)
      if (error) throw error
      showToast('success', 'Xóa loại tương tác thành công.')
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi xóa loại tương tác: ' + err.message)
    }
  }

  // Filters logic
  const uniqueGroups = Array.from(new Set(ingredients.map(ing => ing.pharmacological_group).filter(Boolean))) as string[]

  const filteredIngredients = ingredients.filter(ing => {
    const matchesSearch = 
      ing.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (ing.code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (ing.pharmacological_group || '').toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStatus = 
      statusFilter === 'all' ? true :
      statusFilter === 'active' ? ing.is_active : !ing.is_active

    const matchesGroup = 
      groupFilter === 'all' ? true :
      ing.pharmacological_group === groupFilter

    return matchesSearch && matchesStatus && matchesGroup
  })

  const filteredCompatibilities = compatibilities.filter(comp => {
    const nameA = comp.ingredient_a?.name || ''
    const nameB = comp.ingredient_b?.name || ''
    const desc = comp.description || ''
    const matchesSearch = 
      nameA.toLowerCase().includes(compatSearch.toLowerCase()) ||
      nameB.toLowerCase().includes(compatSearch.toLowerCase()) ||
      desc.toLowerCase().includes(compatSearch.toLowerCase())

    const matchesType = 
      compatTypeFilter === 'all' ? true :
      comp.interaction_type === compatTypeFilter

    return matchesSearch && matchesType
  })

  return (
    <Layout activeMenu="Hoạt chất">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6">
        
        {/* Toast Alerts */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <AlertTriangle size={18} className={alertMsg.type === 'success' ? 'text-emerald-600' : 'text-red-600'} />
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-headline-lg font-bold text-gray-800 flex items-center gap-2">
              <Activity className="text-blue-500" size={28} />
              Quản lý Hoạt chất & Tương kỵ thuốc
            </h1>
            <p className="text-body-md text-gray-500">
              Khai báo thông tin dược lý của hoạt chất thú y và thiết lập ma trận tương tác (Hiệp lực/Đối kháng).
            </p>
          </div>
          
          {activeTab === 'list' && (
            <button
              onClick={openNewIngredient}
              className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all self-start sm:self-auto"
            >
              <Plus size={16} />
              <span>Thêm hoạt chất</span>
            </button>
          )}
          {activeTab === 'compatibility' && (
            <button
              onClick={openNewCompat}
              className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all self-start sm:self-auto"
            >
              <Plus size={16} />
              <span>Thiết lập tương tác</span>
            </button>
          )}
          {activeTab === 'pharma_groups' && (
            <button
              onClick={openNewPharmaGroup}
              className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all self-start sm:self-auto"
            >
              <Plus size={16} />
              <span>Thêm nhóm dược lý</span>
            </button>
          )}
          {activeTab === 'interaction_types' && (
            <button
              onClick={openNewInteractionType}
              className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all self-start sm:self-auto"
            >
              <Plus size={16} />
              <span>Thêm loại tương tác</span>
            </button>
          )}
        </div>

        {/* Tabs switcher */}
        <div className="flex border-b border-gray-200 flex-wrap">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-6 py-3 font-semibold text-body-md transition-all flex items-center gap-2 border-b-2 -mb-[2px] ${
              activeTab === 'list'
                ? 'border-blue-500 text-blue-600 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-650'
            }`}
          >
            <Layers size={16} />
            Danh sách hoạt chất
          </button>
          <button
            onClick={() => setActiveTab('compatibility')}
            className={`px-6 py-3 font-semibold text-body-md transition-all flex items-center gap-2 border-b-2 -mb-[2px] ${
              activeTab === 'compatibility'
                ? 'border-blue-500 text-blue-600 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-650'
            }`}
          >
            <ShieldAlert size={16} />
            Ma trận tương kỵ
          </button>
          <button
            onClick={() => setActiveTab('pharma_groups')}
            className={`px-6 py-3 font-semibold text-body-md transition-all flex items-center gap-2 border-b-2 -mb-[2px] ${
              activeTab === 'pharma_groups'
                ? 'border-blue-500 text-blue-600 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-650'
            }`}
          >
            <Activity size={16} />
            Nhóm dược lý
          </button>
          <button
            onClick={() => setActiveTab('interaction_types')}
            className={`px-6 py-3 font-semibold text-body-md transition-all flex items-center gap-2 border-b-2 -mb-[2px] ${
              activeTab === 'interaction_types'
                ? 'border-blue-500 text-blue-600 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-650'
            }`}
          >
            <Info size={16} />
            Loại tương tác
          </button>
        </div>

        {/* TAB 1: Danh sách hoạt chất */}
        {activeTab === 'list' && (
          <div className="space-y-6">
            {/* Search and Filters */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm theo tên, mã hoặc nhóm dược lý..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
                >
                  <option value="all">Tất cả nhóm dược lý</option>
                  {uniqueGroups.map((grp, i) => (
                    <option key={i} value={grp}>{grp}</option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="inactive">Tạm ngưng</option>
                </select>
              </div>
            </div>

            {/* List Table */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              {loading ? (
                <div className="py-24 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                  <span>Đang tải danh mục hoạt chất...</span>
                </div>
              ) : filteredIngredients.length === 0 ? (
                <div className="py-24 text-center text-gray-400 space-y-2">
                  <Activity className="w-12 h-12 text-gray-300 mx-auto" />
                  <p className="font-semibold text-body-lg">Không tìm thấy hoạt chất nào</p>
                  <p className="text-body-md text-gray-400">Thử thay đổi bộ lọc hoặc thêm hoạt chất mới.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4 w-12"></th>
                        <th className="px-6 py-4">Hoạt chất</th>
                        <th className="px-6 py-4">Nhóm Dược Lý</th>
                        <th className="px-6 py-4">Hàm lượng chuẩn</th>
                        <th className="px-6 py-4">Ngưng thịt (Ngày)</th>
                        <th className="px-6 py-4">Ngưng Sữa/Trứng (Ngày)</th>
                        <th className="px-6 py-4 text-center">Trạng thái</th>
                        <th className="px-6 py-4 w-28 text-center">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                      {filteredIngredients.map((ing) => {
                        const isExpanded = expandedIngId === ing.id
                        const connectedProductsCount = ing.product_active_ingredients?.length || 0

                        return (
                          <React.Fragment key={ing.id}>
                            <tr 
                              className={`hover:bg-gray-25/50 transition-colors ${!ing.is_active ? 'opacity-65 bg-gray-50/45' : ''} ${isExpanded ? 'bg-blue-50/20' : ''}`}
                            >
                              <td className="px-6 py-4 text-center">
                                <button
                                  onClick={() => setExpandedIngId(isExpanded ? null : ing.id)}
                                  className="text-gray-400 hover:text-blue-500"
                                >
                                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="font-semibold text-gray-800">{ing.name}</span>
                                  <span className="text-tiny font-mono uppercase text-gray-400 font-bold">{ing.code || '---'}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 font-medium text-gray-700">
                                {(ing as any).pharmacological_groups?.name || ing.pharmacological_group || '---'}
                              </td>
                              <td className="px-6 py-4">
                                {ing.standard_dosage || '---'}
                              </td>
                              <td className="px-6 py-4 text-center font-semibold text-gray-700">
                                {ing.withdrawal_period_meat !== null ? `${ing.withdrawal_period_meat} ngày` : '---'}
                              </td>
                              <td className="px-6 py-4 text-center font-semibold text-gray-700">
                                {ing.withdrawal_period_milk_egg !== null ? `${ing.withdrawal_period_milk_egg} ngày` : '---'}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleIngredientActive(ing)}
                                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    ing.is_active ? 'bg-blue-500' : 'bg-gray-200'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                      ing.is_active ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <div className="flex justify-center gap-2">
                                  <button
                                    onClick={() => openEditIngredient(ing)}
                                    className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                                    title="Sửa"
                                  >
                                    <Edit size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteIngredient(ing)}
                                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                    title="Xóa"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            
                            {/* Expanded Details section */}
                            {isExpanded && (
                              <tr className="bg-gray-25/30">
                                <td colSpan={8} className="px-10 py-5 border-y border-gray-100">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                      <h4 className="text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                        <Info size={14} className="text-blue-500" />
                                        Chống chỉ định & Độc tính
                                      </h4>
                                      <p className="text-body-md text-gray-700 bg-white border border-gray-100 p-3 rounded-lg shadow-sm leading-relaxed">
                                        {ing.contraindications || 'Chưa cấu hình chống chỉ định.'}
                                      </p>
                                    </div>
                                    <div className="space-y-2">
                                      <h4 className="text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                        <Link size={14} className="text-emerald-500" />
                                        Sản phẩm thương mại chứa hoạt chất ({connectedProductsCount})
                                      </h4>
                                      <div className="bg-white border border-gray-100 p-3 rounded-lg shadow-sm">
                                        {connectedProductsCount === 0 ? (
                                          <p className="text-body-md text-gray-400 italic">Chưa có sản phẩm nào liên kết.</p>
                                        ) : (
                                          <ul className="divide-y divide-gray-50 max-h-40 overflow-y-auto pr-2">
                                            {ing.product_active_ingredients?.map((link, idx) => (
                                              <li key={idx} className="py-2 flex justify-between items-center text-body-md">
                                                <span className="font-semibold text-gray-800">{link.product?.name}</span>
                                                <div className="flex items-center gap-2">
                                                  <span className="text-body-sm font-mono text-gray-400">SKU: {link.product?.sku}</span>
                                                  <span className="bg-blue-50 text-blue-700 text-tiny px-2 py-0.5 rounded font-bold">{link.percentage_or_dosage}</span>
                                                </div>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Nhóm dược lý */}
        {activeTab === 'pharma_groups' && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm theo tên hoặc mã..."
                  value={pharmaSearch}
                  onChange={(e) => setPharmaSearch(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                      <th className="px-6 py-4">Tên nhóm</th>
                      <th className="px-6 py-4">Mã nhóm</th>
                      <th className="px-6 py-4">Mô tả</th>
                      <th className="px-6 py-4 text-center">Hoạt chất gán</th>
                      <th className="px-6 py-4 text-center">Trạng thái</th>
                      <th className="px-6 py-4 w-28 text-center">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                    {pharmaGroups
                      .filter(pg => 
                        pg.name.toLowerCase().includes(pharmaSearch.toLowerCase()) ||
                        (pg.code || '').toLowerCase().includes(pharmaSearch.toLowerCase())
                      )
                      .map((pg) => {
                        const linkedCount = ingredients.filter(ing => ing.pharmacological_group_id === pg.id).length
                        return (
                          <tr key={pg.id} className="hover:bg-gray-25/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-gray-800">{pg.name}</td>
                            <td className="px-6 py-4 font-mono text-tiny uppercase text-gray-500 font-bold">{pg.code || '---'}</td>
                            <td className="px-6 py-4 max-w-xs truncate" title={pg.description}>{pg.description || '---'}</td>
                            <td className="px-6 py-4 text-center font-bold text-blue-500">{linkedCount}</td>
                            <td className="px-6 py-4 text-center">
                              <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${
                                pg.is_active ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-danger-500'
                              }`}>
                                {pg.is_active ? 'Kích hoạt' : 'Khóa'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex justify-center gap-2">
                                <button
                                  onClick={() => openEditPharmaGroup(pg)}
                                  className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                                >
                                  <Edit size={16} />
                                </button>
                                <button
                                  onClick={() => handleDeletePharmaGroup(pg)}
                                  className="text-gray-450 hover:text-red-500 transition-colors p-1"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Loại tương tác */}
        {activeTab === 'interaction_types' && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                      <th className="px-6 py-4">Tên loại tương tác</th>
                      <th className="px-6 py-4">Mã tương tác</th>
                      <th className="px-6 py-4">Mô tả tác động</th>
                      <th className="px-6 py-4 text-center">Màu sắc</th>
                      <th className="px-6 py-4 text-center">Quy tắc liên kết</th>
                      <th className="px-6 py-4 w-28 text-center">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                    {interactionTypes.map((it) => {
                      const linkedCount = compatibilities.filter(c => c.interaction_type === it.code).length
                      return (
                        <tr key={it.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-gray-800">{it.name}</td>
                          <td className="px-6 py-4 font-mono text-tiny text-gray-500 font-bold">{it.code}</td>
                          <td className="px-6 py-4 max-w-xs truncate" title={it.description}>{it.description || '---'}</td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border capitalize bg-${it.color_code}-50 text-${it.color_code}-700 border-${it.color_code}-100`}>
                              {it.color_code}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center font-bold text-blue-500">{linkedCount}</td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => openEditInteractionType(it)}
                                className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteInteractionType(it)}
                                className="text-gray-450 hover:text-red-500 transition-colors p-1"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Ma trận tương tác */}
        {activeTab === 'compatibility' && (
          <div className="space-y-6">
            {/* Search and Filters */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm theo hoạt chất hoặc mô tả..."
                  value={compatSearch}
                  onChange={(e) => setCompatSearch(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-2 w-full md:w-auto">
                <select
                  value={compatTypeFilter}
                  onChange={(e) => setCompatTypeFilter(e.target.value as any)}
                  className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
                >
                  <option value="all">Tất cả loại tương tác</option>
                  <option value="synergy">Hiệp lực (Hỗ trợ lẫn nhau)</option>
                  <option value="antagonism">Đối kháng (Tương kỵ/Kỵ nhau)</option>
                </select>
              </div>
            </div>

            {/* Matrix Table */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              {loading ? (
                <div className="py-24 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                  <span>Đang tải ma trận tương tác...</span>
                </div>
              ) : filteredCompatibilities.length === 0 ? (
                <div className="py-24 text-center text-gray-400 space-y-2">
                  <ShieldAlert className="w-12 h-12 text-gray-300 mx-auto" />
                  <p className="font-semibold text-body-lg">Chưa cấu hình quy tắc tương tác nào</p>
                  <p className="text-body-md text-gray-400">Thiết lập mối quan hệ Hiệp lực hoặc Đối kháng cho hoạt chất.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Hoạt chất A</th>
                        <th className="px-6 py-4">Hoạt chất B</th>
                        <th className="px-6 py-4 text-center w-40">Tương tác</th>
                        <th className="px-6 py-4">Mô tả tác động kỹ thuật</th>
                        <th className="px-6 py-4 w-24 text-center">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                      {filteredCompatibilities.map((comp) => (
                        <tr key={comp.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-semibold text-gray-800">
                            {comp.ingredient_a?.name}
                          </td>
                          <td className="px-6 py-4 font-semibold text-gray-800">
                            {comp.ingredient_b?.name}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {comp.interaction_type === 'synergy' ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 border border-emerald-100 text-emerald-700 text-tiny rounded-full font-bold">
                                <Sparkles size={12} />
                                Hiệp lực
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-3 py-1 bg-rose-50 border border-rose-100 text-rose-700 text-tiny rounded-full font-bold">
                                <AlertTriangle size={12} />
                                Đối kháng / Kỵ
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-gray-600 max-w-sm whitespace-normal leading-relaxed text-body-sm">
                            {comp.description || 'Chưa có mô tả chi tiết.'}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => openEditCompat(comp)}
                                className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                                title="Sửa"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteCompat(comp)}
                                className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                title="Xóa"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal: Add/Edit Active Ingredient */}
        {showIngModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-xl overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedIngredient ? 'Cập nhật hoạt chất' : 'Thêm hoạt chất mới'}
                </h3>
                <button onClick={() => setShowIngModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveIngredient} className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Mã hoạt chất</label>
                    <input
                      type="text"
                      placeholder="VD: amox_tri..."
                      value={ingCode}
                      onChange={(e) => setIngCode(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 uppercase font-semibold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">
                      Tên hoạt chất gốc <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="VD: Amoxicillin..."
                      value={ingName}
                      onChange={(e) => setIngName(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Nhóm dược lý</label>
                    <select
                      value={ingPharmaGroupId}
                      onChange={(e) => {
                        setIngPharmaGroupId(e.target.value)
                        const matched = pharmaGroups.find(g => g.id === e.target.value)
                        setIngPharmaGroup(matched ? matched.name : '')
                      }}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="">Chọn nhóm dược lý</option>
                      {pharmaGroups.map(pg => (
                        <option key={pg.id} value={pg.id}>{pg.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Hàm lượng tiêu chuẩn</label>
                    <input
                      type="text"
                      placeholder="VD: 10%, 500mg, vừa đủ 1 liều..."
                      value={ingStdDosage}
                      onChange={(e) => setIngStdDosage(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Thời gian ngưng thịt (Ngày)</label>
                    <input
                      type="number"
                      placeholder="VD: 14"
                      value={ingWithdrawalMeat}
                      onChange={(e) => setIngWithdrawalMeat(e.target.value !== '' ? Number(e.target.value) : '')}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Thời gian ngưng Sữa/Trứng (Ngày)</label>
                    <input
                      type="number"
                      placeholder="VD: 5"
                      value={ingWithdrawalMilkEgg}
                      onChange={(e) => setIngWithdrawalMilkEgg(e.target.value !== '' ? Number(e.target.value) : '')}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Chống chỉ định & Cảnh báo độc tính</label>
                  <textarea
                    rows={3}
                    placeholder="VD: Không dùng cho ngựa và người..."
                    value={ingContraindications}
                    onChange={(e) => setIngContraindications(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 leading-normal"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="ingIsActive"
                    checked={ingIsActive}
                    onChange={(e) => setIngIsActive(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="ingIsActive" className="text-body-md font-medium text-gray-700 cursor-pointer">
                    Kích hoạt hoạt chất trong hệ thống
                  </label>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowIngModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Đang lưu...
                      </>
                    ) : (
                      <>
                        <Check size={16} />
                        Lưu lại
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Add/Edit Compatibility Rule */}
        {showCompatModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedCompat ? 'Cập nhật tương tác thuốc' : 'Thiết lập quy tắc tương tác mới'}
                </h3>
                <button onClick={() => setShowCompatModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveCompat} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Hoạt chất thứ nhất (A) <span className="text-red-500">*</span></label>
                  <select
                    required
                    value={compatIngA}
                    onChange={(e) => setCompatIngA(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chọn hoạt chất A --</option>
                    {ingredients.filter(ing => ing.is_active).map(ing => (
                      <option key={ing.id} value={ing.id}>{ing.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Hoạt chất thứ hai (B) <span className="text-red-500">*</span></label>
                  <select
                    required
                    value={compatIngB}
                    onChange={(e) => setCompatIngB(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chọn hoạt chất B --</option>
                    {ingredients.filter(ing => ing.is_active && ing.id !== compatIngA).map(ing => (
                      <option key={ing.id} value={ing.id}>{ing.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Loại tương tác <span className="text-red-500">*</span></label>
                  <div className="flex gap-4 pt-1">
                    <label className="flex items-center gap-2 text-body-md font-medium text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="interaction_type"
                        value="synergy"
                        checked={compatType === 'synergy'}
                        onChange={() => setCompatType('synergy')}
                        className="w-4 h-4 text-blue-650 focus:ring-blue-500"
                      />
                      <span>Hiệp lực (Hỗ trợ điều trị)</span>
                    </label>
                    <label className="flex items-center gap-2 text-body-md font-medium text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="interaction_type"
                        value="antagonism"
                        checked={compatType === 'antagonism'}
                        onChange={() => setCompatType('antagonism')}
                        className="w-4 h-4 text-blue-650 focus:ring-blue-500"
                      />
                      <span className="text-rose-600 font-semibold">Đối kháng (Tương kỵ thuốc)</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mô tả tác động kỹ thuật</label>
                  <textarea
                    rows={3}
                    placeholder="Giải thích tác động lâm sàng khi phối hợp 2 hoạt chất này..."
                    value={compatDesc}
                    onChange={(e) => setCompatDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 leading-normal"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowCompatModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Đang lưu...
                      </>
                    ) : (
                      <>
                        <Check size={16} />
                        Lưu quy tắc
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Add/Edit Pharmacological Group */}
        {showPharmaModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedPharmaGroup ? 'Cập nhật nhóm dược lý' : 'Thêm nhóm dược lý mới'}
                </h3>
                <button onClick={() => setShowPharmaModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSavePharmaGroup} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên nhóm dược lý *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Kháng sinh (Beta-lactam)..."
                    value={pgName}
                    onChange={(e) => setPgName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã định danh nhóm (Tự chọn)</label>
                  <input
                    type="text"
                    placeholder="VD: beta_lactam..."
                    value={pgCode}
                    onChange={(e) => setPgCode(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 lowercase font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mô tả tác dụng kỹ thuật</label>
                  <textarea
                    rows={3}
                    placeholder="Nhập mô tả chi tiết tác động của nhóm..."
                    value={pgDesc}
                    onChange={(e) => setPgDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 leading-normal"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="pgIsActive"
                    checked={pgIsActive}
                    onChange={(e) => setPgIsActive(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="pgIsActive" className="text-body-md font-medium text-gray-700 cursor-pointer">
                    Trạng thái hoạt động
                  </label>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowPharmaModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md"
                  >
                    Lưu lại
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Add/Edit Compatibility Interaction Type */}
        {showInteractionModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedInteractionType ? 'Cập nhật loại tương tác' : 'Thêm loại tương tác mới'}
                </h3>
                <button onClick={() => setShowInteractionModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveInteractionType} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã tương tác *</label>
                  <input
                    type="text"
                    required
                    disabled={!!selectedInteractionType}
                    placeholder="VD: synergy, antagonism..."
                    value={itCode}
                    onChange={(e) => setItCode(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 lowercase font-mono disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên hiển thị *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Hiệp lực..."
                    value={itName}
                    onChange={(e) => setItName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mô tả chi tiết</label>
                  <textarea
                    rows={3}
                    placeholder="Nhập mô tả tác động..."
                    value={itDesc}
                    onChange={(e) => setItDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 leading-normal"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã màu (Tailwind color name) *</label>
                  <select
                    value={itColor}
                    onChange={(e) => setItColor(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white capitalize"
                  >
                    <option value="red">Màu đỏ (Cảnh báo/Đối kháng)</option>
                    <option value="emerald">Màu xanh lục (Hiệp lực/Ưu tiên)</option>
                    <option value="amber">Màu vàng (Thận trọng/Có điều kiện)</option>
                    <option value="blue">Màu xanh dương</option>
                    <option value="purple">Màu tím</option>
                    <option value="gray">Màu xám</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowInteractionModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md"
                  >
                    Lưu lại
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </Layout>
  )
}
