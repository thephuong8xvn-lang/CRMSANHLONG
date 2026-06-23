import React, { useState, useEffect } from 'react'
import {
  Search,
  Plus,
  Edit,
  Trash2,
  AlertTriangle,
  X,
  RefreshCw,
  Activity,
  Check,
  Stethoscope,
  Info,
  Layers,
  Sparkles,
  BookOpen,
  User,
  HeartPulse,
  PlusCircle,
  HelpCircle
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface Species {
  id: string
  name: string
  category: string | null
}

interface ActiveIngredient {
  id: string
  name: string
  code: string | null
}

interface Disease {
  id: string
  code: string
  name: string
  category: string | null
  description: string | null
  is_notifiable: boolean
  etiology: string | null
  symptoms: string[]
  created_at: string
  disease_species?: { species: Species }[]
  etiology_id?: string | null
  disease_etiologies?: { id: string; name: string; pathogen_type: string; subgroup: string } | null
}

interface Protocol {
  id: string
  disease_id: string
  active_ingredient_id: string
  treatment_role: 'treatment' | 'support' | 'resistance'
  treatment_line: number
  notes: string | null
  active_ingredient: ActiveIngredient
}

export default function DiseasesPage() {
  const [diseases, setDiseases] = useState<Disease[]>([])
  const [species, setSpecies] = useState<Species[]>([])
  const [ingredients, setIngredients] = useState<ActiveIngredient[]>([])
  const [protocols, setProtocols] = useState<Protocol[]>([])
  const [selectedDiseaseId, setSelectedDiseaseId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'diseases' | 'species' | 'etiologies'>('diseases')
  const [etiologies, setEtiologies] = useState<any[]>([])

  // Species form state
  const [showSpeciesModal, setShowSpeciesModal] = useState(false)
  const [selectedSpecies, setSelectedSpecies] = useState<any | null>(null)
  const [specName, setSpecName] = useState('')
  const [specCategory, setSpecCategory] = useState('livestock')

  // Etiologies form state
  const [showEtiologyModal, setShowEtiologyModal] = useState(false)
  const [selectedEtiology, setSelectedEtiology] = useState<any | null>(null)
  const [etName, setEtName] = useState('')
  const [etCode, setEtCode] = useState('')
  const [etType, setEtType] = useState('bacteria')
  const [etSubgroup, setEtSubgroup] = useState('')
  const [etDesc, setEtDesc] = useState('')

  const [disEtiologyId, setDisEtiologyId] = useState('')
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasEtiologiesTable, setHasEtiologiesTable] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('')
  const [etiologyFilter, setEtiologyFilter] = useState<string>('all')
  const [speciesFilter, setSpeciesFilter] = useState<string>('all')

  // Modals
  const [showDiseaseModal, setShowDiseaseModal] = useState(false)
  const [showProtocolModal, setShowProtocolModal] = useState(false)

  // Disease Form State
  const [selectedDisease, setSelectedDisease] = useState<Disease | null>(null)
  const [disCode, setDisCode] = useState('')
  const [disName, setDisName] = useState('')
  const [disCategory, setDisCategory] = useState('Vi khuẩn')
  const [disEtiology, setDisEtiology] = useState('bacteria')
  const [disDescription, setDisDescription] = useState('')
  const [disIsNotifiable, setDisIsNotifiable] = useState(false)
  const [disSymptoms, setDisSymptoms] = useState<string[]>([])
  const [newSymptom, setNewSymptom] = useState('')
  const [disSpeciesIds, setDisSpeciesIds] = useState<string[]>([])

  // Protocol Form State
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol | null>(null)
  const [protoIngredientId, setProtoIngredientId] = useState('')
  const [protoRole, setProtoRole] = useState<'treatment' | 'support' | 'resistance'>('treatment')
  const [protoLine, setProtoLine] = useState<number>(1)
  const [protoNotes, setProtoNotes] = useState('')

  const showToast = (type: 'success' | 'error', text: string) => {
    setAlertMsg({ type, text })
    setTimeout(() => setAlertMsg(null), 4000)
  }

  const loadData = async () => {
    setLoading(true)
    try {
      // 1. Fetch Species
      const { data: specData } = await supabase.from('species').select('*').order('name')
      if (specData) setSpecies(specData)

      // 2. Fetch Active Ingredients
      const { data: ingData } = await supabase.from('active_ingredients').select('id, name, code').eq('is_active', true).order('name')
      if (ingData) setIngredients(ingData)

      // Check if disease_etiologies table exists
      let useRelationalMode = false
      try {
        const { error: checkError } = await supabase
          .from('disease_etiologies')
          .select('id')
          .limit(1)
        if (!checkError) {
          useRelationalMode = true
        }
      } catch (e) {
        // Table doesn't exist
      }
      setHasEtiologiesTable(useRelationalMode)

      // 3. Fetch Diseases with species
      let selectQuery = `
        *,
        disease_species(
          species:species(id, name, category)
        )
      `
      if (useRelationalMode) {
        selectQuery = `
          *,
          disease_etiologies(id, name, pathogen_type, subgroup),
          disease_species(
            species:species(id, name, category)
          )
        `
      }

      const { data: disData, error: disError } = await supabase
        .from('disease_dictionary')
        .select(selectQuery)
        .order('name')
      
      if (disError) throw disError

      // Fetch disease etiologies if table exists
      if (useRelationalMode) {
        const { data: etData, error: etError } = await supabase
          .from('disease_etiologies')
          .select('*')
          .order('name')
        if (etError) throw etError
        if (etData) setEtiologies(etData)
      }

      if (disData) {
        const loadedDiseases = disData as unknown as Disease[]
        setDiseases(loadedDiseases)
        if (loadedDiseases.length > 0 && !selectedDiseaseId) {
          setSelectedDiseaseId(loadedDiseases[0].id)
        }
      }
    } catch (err: any) {
      console.error('Error fetching disease data:', err)
      showToast('error', 'Lỗi tải danh mục bệnh: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadProtocolsForDisease = async (diseaseId: string) => {
    try {
      const { data, error } = await supabase
        .from('disease_treatment_protocols')
        .select(`
          *,
          active_ingredient:active_ingredients(id, name, code)
        `)
        .eq('disease_id', diseaseId)
      
      if (error) throw error
      if (data) setProtocols(data as unknown as Protocol[])
    } catch (err: any) {
      console.error('Error loading treatment protocols:', err)
      showToast('error', 'Lỗi tải phác đồ: ' + err.message)
    }
  }

  useEffect(() => {
    if (selectedDiseaseId) {
      loadProtocolsForDisease(selectedDiseaseId)
    } else {
      setProtocols([])
    }
  }, [selectedDiseaseId])

  // CRUD Disease
  const openNewDisease = () => {
    setSelectedDisease(null)
    setDisCode('')
    setDisName('')
    setDisCategory('Vi khuẩn')
    setDisEtiology('bacteria')
    setDisEtiologyId('')
    setDisDescription('')
    setDisIsNotifiable(false)
    setDisSymptoms([])
    setNewSymptom('')
    setDisSpeciesIds([])
    setShowDiseaseModal(true)
  }

  const openEditDisease = (dis: Disease) => {
    setSelectedDisease(dis)
    setDisCode(dis.code)
    setDisName(dis.name)
    setDisCategory(dis.category || 'Vi khuẩn')
    setDisEtiology(dis.etiology || 'bacteria')
    setDisEtiologyId(dis.etiology_id || '')
    setDisDescription(dis.description || '')
    setDisIsNotifiable(dis.is_notifiable)
    setDisSymptoms(dis.symptoms || [])
    setNewSymptom('')
    setDisSpeciesIds(dis.disease_species?.map(ds => ds.species.id) || [])
    setShowDiseaseModal(true)
  }

  const handleAddSymptom = () => {
    if (newSymptom.trim() && !disSymptoms.includes(newSymptom.trim())) {
      setDisSymptoms([...disSymptoms, newSymptom.trim()])
      setNewSymptom('')
    }
  }

  const handleRemoveSymptom = (sym: string) => {
    setDisSymptoms(disSymptoms.filter(s => s !== sym))
  }

  const handleToggleSpeciesSelect = (spId: string) => {
    setDisSpeciesIds(prev =>
      prev.includes(spId) ? prev.filter(id => id !== spId) : [...prev, spId]
    )
  }

  const handleSaveDisease = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!disCode.trim() || !disName.trim()) {
      showToast('error', 'Mã bệnh và tên bệnh là bắt buộc.')
      return
    }

    setSaving(true)
    try {
      const payload: any = {
        code: disCode.trim().toUpperCase(),
        name: disName.trim(),
        category: disCategory,
        etiology: disEtiology,
        description: disDescription.trim() || null,
        is_notifiable: disIsNotifiable,
        symptoms: disSymptoms
      }

      if (hasEtiologiesTable) {
        payload.etiology_id = disEtiologyId || null
      }

      let diseaseId = ''
      if (!selectedDisease) {
        const { data, error } = await supabase.from('disease_dictionary').insert([payload]).select('id').single()
        if (error) throw error
        diseaseId = data.id
        showToast('success', 'Thêm bệnh lý mới thành công!')
      } else {
        const { error } = await supabase
          .from('disease_dictionary')
          .update(payload)
          .eq('id', selectedDisease.id)
        if (error) throw error
        diseaseId = selectedDisease.id
        showToast('success', 'Cập nhật thông tin bệnh lý thành công!')
      }

      // Update disease species links (DELETE old, INSERT new)
      const { error: delError } = await supabase
        .from('disease_species')
        .delete()
        .eq('disease_id', diseaseId)
      if (delError) throw delError

      if (disSpeciesIds.length > 0) {
        const speciesPayload = disSpeciesIds.map(spId => ({
          disease_id: diseaseId,
          species_id: spId
        }))
        const { error: insError } = await supabase.from('disease_species').insert(speciesPayload)
        if (insError) throw insError
      }

      setShowDiseaseModal(false)
      setSelectedDiseaseId(diseaseId)
      loadData()
    } catch (err: any) {
      console.error('Error saving disease:', err)
      showToast('error', 'Lỗi lưu bệnh lý: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDisease = async (dis: Disease) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa bệnh "${dis.name}" cùng phác đồ liên quan?`)) return
    try {
      const { error } = await supabase
        .from('disease_dictionary')
        .delete()
        .eq('id', dis.id)
      
      if (error) throw error
      showToast('success', 'Xóa bệnh lý thành công.')
      if (selectedDiseaseId === dis.id) {
        setSelectedDiseaseId(null)
      }
      loadData()
    } catch (err: any) {
      console.error('Error deleting disease:', err)
      showToast('error', 'Lỗi xóa bệnh lý: ' + err.message)
    }
  }

  // CRUD Protocol
  const openNewProtocol = () => {
    setSelectedProtocol(null)
    setProtoIngredientId('')
    setProtoRole('treatment')
    setProtoLine(1)
    setProtoNotes('')
    setShowProtocolModal(true)
  }

  const openEditProtocol = (proto: Protocol) => {
    setSelectedProtocol(proto)
    setProtoIngredientId(proto.active_ingredient_id)
    setProtoRole(proto.treatment_role)
    setProtoLine(proto.treatment_line)
    setProtoNotes(proto.notes || '')
    setShowProtocolModal(true)
  }

  const handleSaveProtocol = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDiseaseId) return
    if (!protoIngredientId) {
      showToast('error', 'Vui lòng chọn hoạt chất.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        disease_id: selectedDiseaseId,
        active_ingredient_id: protoIngredientId,
        treatment_role: protoRole,
        treatment_line: protoLine,
        notes: protoNotes.trim() || null
      }

      if (!selectedProtocol) {
        // Prevent duplicate ingredient-role combinations in line
        const exists = protocols.find(
          p => p.active_ingredient_id === protoIngredientId && 
               p.treatment_role === protoRole && 
               p.treatment_line === protoLine
        )
        if (exists) {
          throw new Error('Hoạt chất này đã tồn tại trong phác đồ với vai trò và line đã chọn.')
        }
        
        const { error } = await supabase.from('disease_treatment_protocols').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm hoạt chất vào phác đồ thành công!')
      } else {
        const { error } = await supabase
          .from('disease_treatment_protocols')
          .update(payload)
          .eq('id', selectedProtocol.id)
        if (error) throw error
        showToast('success', 'Cập nhật phác đồ thành công!')
      }

      setShowProtocolModal(false)
      loadProtocolsForDisease(selectedDiseaseId)
    } catch (err: any) {
      console.error('Error saving protocol:', err)
      showToast('error', 'Lỗi lưu phác đồ: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteProtocol = async (proto: Protocol) => {
    if (!window.confirm(`Xóa hoạt chất "${proto.active_ingredient.name}" khỏi phác đồ?`)) return
    try {
      const { error } = await supabase
        .from('disease_treatment_protocols')
        .delete()
        .eq('id', proto.id)

      if (error) throw error
      showToast('success', 'Đã xóa khỏi phác đồ.')
      if (selectedDiseaseId) {
        loadProtocolsForDisease(selectedDiseaseId)
      }
    } catch (err: any) {
      console.error('Error deleting protocol:', err)
      showToast('error', 'Lỗi xóa khỏi phác đồ: ' + err.message)
    }
  }

  // CRUD Species
  const openNewSpecies = () => {
    setSelectedSpecies(null)
    setSpecName('')
    setSpecCategory('livestock')
    setShowSpeciesModal(true)
  }

  const openEditSpecies = (sp: any) => {
    setSelectedSpecies(sp)
    setSpecName(sp.name)
    setSpecCategory(sp.category || 'livestock')
    setShowSpeciesModal(true)
  }

  const handleSaveSpecies = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!specName.trim()) {
      showToast('error', 'Tên loài là bắt buộc.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: specName.trim(),
        category: specCategory
      }

      if (!selectedSpecies) {
        const { error } = await supabase.from('species').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm loài vật nuôi mới thành công!')
      } else {
        const { error } = await supabase
          .from('species')
          .update(payload)
          .eq('id', selectedSpecies.id)
        if (error) throw error
        showToast('success', 'Cập nhật loài vật nuôi thành công!')
      }
      setShowSpeciesModal(false)
      loadData()
    } catch (err: any) {
      console.error('Error saving species:', err)
      showToast('error', 'Lỗi lưu loài vật nuôi: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteSpecies = async (sp: any) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa loài "${sp.name}"?`)) return
    try {
      const { error } = await supabase.from('species').delete().eq('id', sp.id)
      if (error) throw error
      showToast('success', 'Xóa loài thành công.')
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi xóa loài: ' + err.message)
    }
  }

  // CRUD Etiologies
  const openNewEtiology = () => {
    setSelectedEtiology(null)
    setEtName('')
    setEtCode('')
    setEtType('bacteria')
    setEtSubgroup('')
    setEtDesc('')
    setShowEtiologyModal(true)
  }

  const openEditEtiology = (et: any) => {
    setSelectedEtiology(et)
    setEtName(et.name)
    setEtCode(et.code || '')
    setEtType(et.pathogen_type)
    setEtSubgroup(et.subgroup || '')
    setEtDesc(et.description || '')
    setShowEtiologyModal(true)
  }

  const handleSaveEtiology = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!etName.trim()) {
      showToast('error', 'Tên nguyên nhân là bắt buộc.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: etName.trim(),
        code: etCode.trim() ? etCode.trim().toLowerCase() : null,
        pathogen_type: etType,
        subgroup: etSubgroup.trim() || null,
        description: etDesc.trim() || null
      }

      if (!selectedEtiology) {
        const { error } = await supabase.from('disease_etiologies').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm nguyên nhân bệnh mới thành công!')
      } else {
        const { error } = await supabase
          .from('disease_etiologies')
          .update(payload)
          .eq('id', selectedEtiology.id)
        if (error) throw error
        showToast('success', 'Cập nhật nguyên nhân bệnh thành công!')
      }
      setShowEtiologyModal(false)
      loadData()
    } catch (err: any) {
      console.error('Error saving etiology:', err)
      showToast('error', 'Lỗi lưu nguyên nhân bệnh: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteEtiology = async (et: any) => {
    const linkedCount = diseases.filter(d => d.etiology_id === et.id).length
    if (linkedCount > 0) {
      showToast('error', `Không thể xóa nguyên nhân này vì đang có ${linkedCount} bệnh lý liên kết.`)
      return
    }
    if (!window.confirm(`Bạn có chắc chắn muốn xóa nguyên nhân "${et.name}"?`)) return
    try {
      const { error } = await supabase.from('disease_etiologies').delete().eq('id', et.id)
      if (error) throw error
      showToast('success', 'Xóa nguyên nhân bệnh thành công.')
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi xóa nguyên nhân: ' + err.message)
    }
  }

  // Filter diseases
  const filteredDiseases = diseases.filter(dis => {
    const matchesSearch = 
      dis.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dis.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (dis.description || '').toLowerCase().includes(searchTerm.toLowerCase())

    const matchesEtiology = 
      etiologyFilter === 'all' ? true :
      dis.etiology === etiologyFilter

    const matchesSpecies = 
      speciesFilter === 'all' ? true :
      dis.disease_species?.some(ds => ds.species.id === speciesFilter)

    return matchesSearch && matchesEtiology && matchesSpecies
  })

  const currentDisease = diseases.find(d => d.id === selectedDiseaseId)

  // Protocols sorting by lines
  const line1Protocols = protocols.filter(p => p.treatment_line === 1)
  const line2Protocols = protocols.filter(p => p.treatment_line === 2)

  const groupProtocolsByRole = (protos: Protocol[]) => {
    return {
      treatment: protos.filter(p => p.treatment_role === 'treatment'),
      support: protos.filter(p => p.treatment_role === 'support'),
      resistance: protos.filter(p => p.treatment_role === 'resistance')
    }
  }

  const line1Grouped = groupProtocolsByRole(line1Protocols)
  const line2Grouped = groupProtocolsByRole(line2Protocols)

  const getEtiologyBadgeColor = (et: string | null) => {
    switch (et) {
      case 'virus': return 'bg-rose-50 border-rose-100 text-rose-700'
      case 'bacteria': return 'bg-blue-50 border-blue-100 text-blue-700'
      case 'parasite': return 'bg-amber-50 border-amber-100 text-amber-700'
      default: return 'bg-slate-50 border-slate-100 text-slate-700'
    }
  }

  const getEtiologyLabel = (et: string | null) => {
    switch (et) {
      case 'virus': return 'Virus 🦠'
      case 'bacteria': return 'Vi khuẩn 🧫'
      case 'parasite': return 'Ký sinh trùng 🐛'
      case 'environment_nutrition': return 'Môi trường/Dinh dưỡng ☀️'
      default: return 'Khác'
    }
  }

  return (
    <Layout activeMenu="Bệnh & Phác đồ">
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
              <HeartPulse className="text-red-500" size={28} />
              Quản lý Bệnh lý & Phác đồ điều trị
            </h1>
            <p className="text-body-md text-gray-500">
              Số hóa phác đồ điều trị đa tầng và thiết lập triệu chứng dịch tễ cho từng bệnh lý thú y.
            </p>
          </div>
          
          {activeTab === 'diseases' && (
            <button
              onClick={openNewDisease}
              className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all self-start sm:self-auto"
            >
              <Plus size={16} />
              <span>Khai báo bệnh mới</span>
            </button>
          )}
          {activeTab === 'species' && (
            <button
              onClick={openNewSpecies}
              className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all self-start sm:self-auto"
            >
              <Plus size={16} />
              <span>Thêm loài vật nuôi</span>
            </button>
          )}
          {activeTab === 'etiologies' && (
            <button
              onClick={openNewEtiology}
              className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all self-start sm:self-auto"
            >
              <Plus size={16} />
              <span>Thêm nguyên nhân bệnh</span>
            </button>
          )}
        </div>

        {/* Tabs switcher */}
        <div className="flex border-b border-gray-200 flex-wrap">
          <button
            onClick={() => setActiveTab('diseases')}
            className={`px-6 py-3 font-semibold text-body-md transition-all flex items-center gap-2 border-b-2 -mb-[2px] ${
              activeTab === 'diseases'
                ? 'border-blue-500 text-blue-600 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-650'
            }`}
          >
            <HeartPulse size={16} />
            Bệnh lý & Phác đồ
          </button>
          <button
            onClick={() => setActiveTab('species')}
            className={`px-6 py-3 font-semibold text-body-md transition-all flex items-center gap-2 border-b-2 -mb-[2px] ${
              activeTab === 'species'
                ? 'border-blue-500 text-blue-600 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-650'
            }`}
          >
            <Activity size={16} />
            Loài vật nuôi
          </button>
          <button
            onClick={() => setActiveTab('etiologies')}
            className={`px-6 py-3 font-semibold text-body-md transition-all flex items-center gap-2 border-b-2 -mb-[2px] ${
              activeTab === 'etiologies'
                ? 'border-blue-500 text-blue-600 font-bold'
                : 'border-transparent text-gray-400 hover:text-gray-650'
            }`}
          >
            <HelpCircle size={16} />
            Phân nhóm nguyên nhân
          </button>
        </div>

        {/* Search & Filters */}
        {activeTab === 'diseases' && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Tìm tên bệnh, mã bệnh..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <select
              value={etiologyFilter}
              onChange={(e) => setEtiologyFilter(e.target.value)}
              className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
            >
              <option value="all">Tất cả nguyên nhân</option>
              <option value="virus">Do Virus</option>
              <option value="bacteria">Do Vi khuẩn</option>
              <option value="parasite">Do Ký sinh trùng</option>
              <option value="environment_nutrition">Do Môi trường / Dinh dưỡng</option>
            </select>

            <select
              value={speciesFilter}
              onChange={(e) => setSpeciesFilter(e.target.value)}
              className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
            >
              <option value="all">Tất cả loài vật nuôi</option>
              {species.map(sp => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
          </div>
        </div>
        )}

        {/* Main Workspace Layout (Split screen 40% list - 60% detail) */}
        {activeTab === 'diseases' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Disease List */}
          <div className="lg:col-span-5 bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden flex flex-col max-h-[650px]">
            <div className="p-4 border-b border-gray-100 bg-gray-25 shrink-0 flex justify-between items-center">
              <span className="font-bold text-gray-800 text-body-lg">Danh sách bệnh lý ({filteredDiseases.length})</span>
            </div>
            
            <div className="overflow-y-auto flex-1 divide-y divide-gray-50 max-h-[600px]">
              {loading ? (
                <div className="py-20 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                  <span>Đang tải danh sách bệnh...</span>
                </div>
              ) : filteredDiseases.length === 0 ? (
                <div className="py-20 text-center text-gray-400 italic">
                  Không tìm thấy bệnh lý nào phù hợp.
                </div>
              ) : (
                filteredDiseases.map((dis) => (
                  <div
                    key={dis.id}
                    onClick={() => setSelectedDiseaseId(dis.id)}
                    className={`p-4 cursor-pointer hover:bg-blue-50/20 transition-all flex items-start justify-between border-l-4 ${
                      selectedDiseaseId === dis.id 
                        ? 'border-blue-500 bg-blue-50/15' 
                        : 'border-transparent'
                    }`}
                  >
                    <div className="space-y-1.5 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-tiny font-bold text-gray-400 uppercase bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded shrink-0">{dis.code}</span>
                        <span className="font-bold text-gray-800 text-body-md line-clamp-1">{dis.name}</span>
                      </div>
                      
                      <div className="flex flex-wrap gap-1 items-center">
                        <span className={`text-[10px] px-2 py-0.5 border rounded-full font-bold uppercase shrink-0 ${
                          dis.disease_etiologies?.pathogen_type ? getEtiologyBadgeColor(dis.disease_etiologies.pathogen_type) : getEtiologyBadgeColor(dis.etiology)
                        }`}>
                          {dis.disease_etiologies?.name || getEtiologyLabel(dis.etiology)}
                        </span>
                        
                        {dis.disease_species?.map((ds, i) => (
                          <span key={i} className="bg-slate-50 border border-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-medium">
                            {ds.species.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditDisease(dis) }}
                        className="text-gray-400 hover:text-blue-500 p-1"
                        title="Sửa thông tin bệnh"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteDisease(dis) }}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="Xóa bệnh"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Column: Disease Detail & Protocols */}
          <div className="lg:col-span-7 space-y-6">
            {currentDisease ? (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-6">
                
                {/* Section header: Disease Info */}
                <div className="border-b border-gray-100 pb-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h2 className="text-headline-sm font-bold text-gray-800 flex items-center gap-2">
                        <BookOpen className="text-blue-500 shrink-0" size={24} />
                        {currentDisease.name}
                      </h2>
                      <p className="text-body-sm text-gray-400 font-mono mt-0.5">ID Bệnh: {currentDisease.code}</p>
                    </div>
                    
                    <div className="flex gap-2">
                      <span className={`px-3 py-1 border rounded-full text-tiny font-bold uppercase ${
                        currentDisease.disease_etiologies?.pathogen_type ? getEtiologyBadgeColor(currentDisease.disease_etiologies.pathogen_type) : getEtiologyBadgeColor(currentDisease.etiology)
                      }`}>
                        {currentDisease.disease_etiologies?.name || getEtiologyLabel(currentDisease.etiology)}
                      </span>
                      {currentDisease.is_notifiable && (
                        <span className="bg-red-50 border border-red-100 text-red-700 px-3 py-1 rounded-full text-tiny font-bold uppercase flex items-center gap-1">
                          <AlertTriangle size={12} />
                          Phải báo cáo
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-tiny font-bold text-gray-450 uppercase tracking-wider block">Loài ảnh hưởng</span>
                    <div className="flex flex-wrap gap-1.5">
                      {currentDisease.disease_species && currentDisease.disease_species.length > 0 ? (
                        currentDisease.disease_species.map((ds, i) => (
                          <span key={i} className="bg-blue-50/50 border border-blue-100 text-blue-700 text-body-sm px-2.5 py-1 rounded-lg font-semibold">
                            {ds.species.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-body-sm text-gray-400 italic">Chưa liên kết loài vật nuôi.</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1 bg-gray-25/50 border border-gray-100 p-3 rounded-lg">
                      <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Mô tả dịch tễ</span>
                      <p className="text-body-md text-gray-650 leading-relaxed">
                        {currentDisease.description || 'Không có mô tả dịch tễ cho bệnh này.'}
                      </p>
                    </div>

                    <div className="space-y-1.5 bg-gray-25/50 border border-gray-100 p-3 rounded-lg">
                      <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Triệu chứng lâm sàng ({currentDisease.symptoms?.length || 0})</span>
                      <div className="flex flex-wrap gap-1">
                        {currentDisease.symptoms && currentDisease.symptoms.length > 0 ? (
                          currentDisease.symptoms.map((sym, i) => (
                            <span key={i} className="bg-white border border-gray-100 text-gray-700 text-tiny px-2 py-0.5 rounded font-medium shadow-sm">
                              {sym}
                            </span>
                          ))
                        ) : (
                          <span className="text-body-sm text-gray-400 italic">Chưa khai báo triệu chứng.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: Treatment Protocols */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                    <h3 className="text-body-lg font-bold text-gray-800 flex items-center gap-1.5">
                      <Layers className="text-emerald-500" size={18} />
                      Ma trận Phác đồ điều trị đa tầng
                    </h3>
                    <button
                      onClick={openNewProtocol}
                      className="text-blue-500 hover:text-blue-600 font-semibold text-body-sm flex items-center gap-1"
                    >
                      <PlusCircle size={15} />
                      Thêm phác đồ
                    </button>
                  </div>

                  {/* Render Protocols in Grouped format */}
                  <div className="space-y-6">
                    {/* Line 1 Protocol Card */}
                    <div className="bg-emerald-50/10 border border-emerald-100/60 rounded-xl p-5 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-body-md font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-lg">
                          Phác đồ ưu tiên 1 (Line 1)
                        </span>
                        <span className="text-tiny text-gray-400 italic">Hiệu quả và kinh tế tốt nhất</span>
                      </div>

                      {line1Protocols.length === 0 ? (
                        <p className="text-body-md text-gray-400 italic py-2">Chưa thiết lập phác đồ Line 1. Vui lòng thêm hoạt chất.</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Đặc trị */}
                          <div className="space-y-2">
                            <span className="text-tiny font-bold text-rose-700 uppercase tracking-wider block">1. Đặc trị</span>
                            <div className="space-y-2">
                              {line1Grouped.treatment.map(p => (
                                <div key={p.id} className="bg-rose-50/20 border border-rose-100 p-2.5 rounded-lg text-body-sm space-y-1 relative group">
                                  <button
                                    onClick={() => handleDeleteProtocol(p)}
                                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                                  >
                                    <X size={14} />
                                  </button>
                                  <div className="font-semibold text-rose-900 cursor-pointer hover:underline" onClick={() => openEditProtocol(p)}>
                                    {p.active_ingredient.name}
                                  </div>
                                  <div className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed">{p.notes || 'Không ghi chú.'}</div>
                                </div>
                              ))}
                              {line1Grouped.treatment.length === 0 && <span className="text-tiny text-gray-400 italic">Trống</span>}
                            </div>
                          </div>

                          {/* Bổ trợ triệu chứng */}
                          <div className="space-y-2">
                            <span className="text-tiny font-bold text-amber-700 uppercase tracking-wider block">2. Bổ trợ triệu chứng</span>
                            <div className="space-y-2">
                              {line1Grouped.support.map(p => (
                                <div key={p.id} className="bg-amber-50/20 border border-amber-100 p-2.5 rounded-lg text-body-sm space-y-1 relative group">
                                  <button
                                    onClick={() => handleDeleteProtocol(p)}
                                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                                  >
                                    <X size={14} />
                                  </button>
                                  <div className="font-semibold text-amber-900 cursor-pointer hover:underline" onClick={() => openEditProtocol(p)}>
                                    {p.active_ingredient.name}
                                  </div>
                                  <div className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed">{p.notes || 'Không ghi chú.'}</div>
                                </div>
                              ))}
                              {line1Grouped.support.length === 0 && <span className="text-tiny text-gray-400 italic">Trống</span>}
                            </div>
                          </div>

                          {/* Nâng đề kháng */}
                          <div className="space-y-2">
                            <span className="text-tiny font-bold text-emerald-700 uppercase tracking-wider block">3. Đề kháng / Hồi phục</span>
                            <div className="space-y-2">
                              {line1Grouped.resistance.map(p => (
                                <div key={p.id} className="bg-emerald-50/20 border border-emerald-100 p-2.5 rounded-lg text-body-sm space-y-1 relative group">
                                  <button
                                    onClick={() => handleDeleteProtocol(p)}
                                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                                  >
                                    <X size={14} />
                                  </button>
                                  <div className="font-semibold text-emerald-950 cursor-pointer hover:underline" onClick={() => openEditProtocol(p)}>
                                    {p.active_ingredient.name}
                                  </div>
                                  <div className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed">{p.notes || 'Không ghi chú.'}</div>
                                </div>
                              ))}
                              {line1Grouped.resistance.length === 0 && <span className="text-tiny text-gray-400 italic">Trống</span>}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Line 2 Protocol Card */}
                    <div className="bg-blue-50/10 border border-blue-100/60 rounded-xl p-5 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-body-md font-bold text-blue-800 bg-blue-50 border border-blue-100 px-3 py-1 rounded-lg">
                          Phác đồ thay thế 2 (Line 2)
                        </span>
                        <span className="text-tiny text-gray-400 italic">Dùng khi có dấu hiệu lờn thuốc/kháng thuốc Line 1</span>
                      </div>

                      {line2Protocols.length === 0 ? (
                        <p className="text-body-md text-gray-400 italic py-2">Chưa thiết lập phác đồ Line 2. Vui lòng thêm hoạt chất.</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Đặc trị */}
                          <div className="space-y-2">
                            <span className="text-tiny font-bold text-rose-700 uppercase tracking-wider block">1. Đặc trị</span>
                            <div className="space-y-2">
                              {line2Grouped.treatment.map(p => (
                                <div key={p.id} className="bg-rose-50/20 border border-rose-100 p-2.5 rounded-lg text-body-sm space-y-1 relative group">
                                  <button
                                    onClick={() => handleDeleteProtocol(p)}
                                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                                  >
                                    <X size={14} />
                                  </button>
                                  <div className="font-semibold text-rose-900 cursor-pointer hover:underline" onClick={() => openEditProtocol(p)}>
                                    {p.active_ingredient.name}
                                  </div>
                                  <div className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed">{p.notes || 'Không ghi chú.'}</div>
                                </div>
                              ))}
                              {line2Grouped.treatment.length === 0 && <span className="text-tiny text-gray-400 italic">Trống</span>}
                            </div>
                          </div>

                          {/* Bổ trợ triệu chứng */}
                          <div className="space-y-2">
                            <span className="text-tiny font-bold text-amber-700 uppercase tracking-wider block">2. Bổ trợ triệu chứng</span>
                            <div className="space-y-2">
                              {line2Grouped.support.map(p => (
                                <div key={p.id} className="bg-amber-50/20 border border-amber-100 p-2.5 rounded-lg text-body-sm space-y-1 relative group">
                                  <button
                                    onClick={() => handleDeleteProtocol(p)}
                                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                                  >
                                    <X size={14} />
                                  </button>
                                  <div className="font-semibold text-amber-900 cursor-pointer hover:underline" onClick={() => openEditProtocol(p)}>
                                    {p.active_ingredient.name}
                                  </div>
                                  <div className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed">{p.notes || 'Không ghi chú.'}</div>
                                </div>
                              ))}
                              {line2Grouped.support.length === 0 && <span className="text-tiny text-gray-400 italic">Trống</span>}
                            </div>
                          </div>

                          {/* Nâng đề kháng */}
                          <div className="space-y-2">
                            <span className="text-tiny font-bold text-emerald-700 uppercase tracking-wider block">3. Đề kháng / Hồi phục</span>
                            <div className="space-y-2">
                              {line2Grouped.resistance.map(p => (
                                <div key={p.id} className="bg-emerald-50/20 border border-emerald-100 p-2.5 rounded-lg text-body-sm space-y-1 relative group">
                                  <button
                                    onClick={() => handleDeleteProtocol(p)}
                                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                                  >
                                    <X size={14} />
                                  </button>
                                  <div className="font-semibold text-emerald-950 cursor-pointer hover:underline" onClick={() => openEditProtocol(p)}>
                                    {p.active_ingredient.name}
                                  </div>
                                  <div className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed">{p.notes || 'Không ghi chú.'}</div>
                                </div>
                              ))}
                              {line2Grouped.resistance.length === 0 && <span className="text-tiny text-gray-400 italic">Trống</span>}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-12 text-center text-gray-400 space-y-3">
                <HeartPulse size={48} className="mx-auto text-gray-300 animate-pulse" />
                <p className="font-semibold text-body-lg">Chưa chọn bệnh lý</p>
                <p className="text-body-md">Vui lòng chọn một bệnh ở danh sách bên trái hoặc tạo bệnh mới để bắt đầu cấu hình.</p>
              </div>
            )}
          </div>

        </div>
        )}

        {/* TAB 2: Loài vật nuôi */}
        {activeTab === 'species' && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto tbl-x">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                      <th className="px-6 py-4">Tên loài vật nuôi</th>
                      <th className="px-6 py-4">Phân nhóm chính</th>
                      <th className="px-6 py-4 text-center">Bệnh lý liên kết</th>
                      <th className="px-6 py-4 w-28 text-center">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                    {species.map((sp) => {
                      const linkedCount = diseases.filter(d => d.disease_species?.some(ds => ds.species.id === sp.id)).length
                      return (
                        <tr key={sp.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-gray-800">{sp.name}</td>
                          <td className="px-6 py-4 capitalize text-gray-600">{sp.category || 'livestock'}</td>
                          <td className="px-6 py-4 text-center font-bold text-blue-500">{linkedCount}</td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => openEditSpecies(sp)}
                                className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteSpecies(sp)}
                                className="text-gray-450 hover:text-red-500 transition-colors p-1"
                              >
                                <Trash2 size={16} />
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

        {/* TAB 3: Phân nhóm nguyên nhân */}
        {activeTab === 'etiologies' && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto tbl-x">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                      <th className="px-6 py-4">Tên nguyên nhân</th>
                      <th className="px-6 py-4">Mã phân nhóm</th>
                      <th className="px-6 py-4">Loại tác nhân</th>
                      <th className="px-6 py-4">Phân nhóm (Gram/Hệ Gen)</th>
                      <th className="px-6 py-4">Mô tả tác nhân</th>
                      <th className="px-6 py-4 text-center">Bệnh lý gán</th>
                      <th className="px-6 py-4 w-28 text-center">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                    {etiologies.map((et) => {
                      const linkedCount = diseases.filter(d => d.etiology_id === et.id).length
                      return (
                        <tr key={et.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-gray-800">{et.name}</td>
                          <td className="px-6 py-4 font-mono text-tiny text-gray-500 font-bold">{et.code || '---'}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border capitalize ${
                              et.pathogen_type === 'virus' ? 'bg-rose-50 border-rose-100 text-rose-700' :
                              et.pathogen_type === 'bacteria' ? 'bg-blue-50 border-blue-100 text-blue-700' :
                              et.pathogen_type === 'parasite' ? 'bg-amber-50 border-amber-100 text-amber-700' :
                              'bg-slate-50 border-slate-100 text-slate-700'
                            }`}>
                              {getEtiologyLabel(et.pathogen_type)}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-semibold text-gray-700">{et.subgroup || '---'}</td>
                          <td className="px-6 py-4 max-w-xs truncate" title={et.description}>{et.description || '---'}</td>
                          <td className="px-6 py-4 text-center font-bold text-blue-500">{linkedCount}</td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => openEditEtiology(et)}
                                className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteEtiology(et)}
                                className="text-gray-450 hover:text-red-500 transition-colors p-1"
                              >
                                <Trash2 size={16} />
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

        {/* Modal: Add/Edit Disease Definition */}
        {showDiseaseModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-xl overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25 shrink-0">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedDisease ? 'Cập nhật thông tin bệnh' : 'Khai báo bệnh thú y mới'}
                </h3>
                <button onClick={() => setShowDiseaseModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveDisease} className="p-6 space-y-4 overflow-y-auto flex-1 leading-relaxed">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Mã bệnh lý (ID) <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="VD: APP, PRRS, COCCI_GA..."
                      value={disCode}
                      onChange={(e) => setDisCode(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 uppercase font-semibold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Tên bệnh lý <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="VD: Viêm phổi màng phổi..."
                      value={disName}
                      onChange={(e) => setDisName(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-semibold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Loại tác nhân (Category)</label>
                    <input
                      type="text"
                      placeholder="VD: Vi khuẩn, Virus, Ký sinh trùng..."
                      value={disCategory}
                      onChange={(e) => setDisCategory(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Nguyên nhân dịch tễ</label>
                    <select
                      value={disEtiology}
                      onChange={(e) => setDisEtiology(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="bacteria">Do Vi khuẩn</option>
                      <option value="virus">Do Virus</option>
                      <option value="parasite">Do Ký sinh trùng</option>
                      <option value="environment_nutrition">Do Môi trường / Dinh dưỡng</option>
                    </select>
                  </div>
                </div>

                {/* Species affected */}
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Loài vật nuôi bị ảnh hưởng <span className="text-red-500">*</span></label>
                  <div className="flex flex-wrap gap-2 pt-1 border border-gray-100 rounded-lg p-3 bg-gray-25/55">
                    {species.map(sp => {
                      const isSelected = disSpeciesIds.includes(sp.id)
                      return (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => handleToggleSpeciesSelect(sp.id)}
                          className={`px-3 py-1 rounded-lg text-body-sm font-semibold border transition-all ${
                            isSelected 
                              ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                              : 'bg-white border-gray-200 text-gray-650 hover:bg-gray-50'
                          }`}
                        >
                          {sp.name}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Symptoms checklist builder */}
                <div className="space-y-2">
                  <label className="block text-body-md font-semibold text-gray-700">Các dấu hiệu triệu chứng lâm sàng</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Thêm triệu chứng (VD: Ho thở bụng, Tai tím...)"
                      value={newSymptom}
                      onChange={(e) => setNewSymptom(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddSymptom()
                        }
                      }}
                      className="flex-1 h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddSymptom}
                      className="bg-gray-100 hover:bg-gray-200 border border-gray-100 text-gray-700 px-4 rounded-lg font-bold text-body-sm"
                    >
                      Thêm
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 border border-gray-100 p-3 rounded-lg min-h-16 bg-gray-25/55">
                    {disSymptoms.map((sym, idx) => (
                      <span key={idx} className="bg-white border border-gray-100 text-gray-700 text-body-sm px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-sm font-medium">
                        {sym}
                        <button
                          type="button"
                          onClick={() => handleRemoveSymptom(sym)}
                          className="text-gray-400 hover:text-red-500 rounded-full"
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                    {disSymptoms.length === 0 && <span className="text-body-sm text-gray-400 italic">Chưa thêm triệu chứng nào.</span>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mô tả dịch tễ học</label>
                  <textarea
                    rows={3}
                    placeholder="Mô tả kỹ thuật chi tiết về cơ chế bệnh sinh, chẩn đoán phân biệt..."
                    value={disDescription}
                    onChange={(e) => setDisDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 leading-normal"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="disIsNotifiable"
                    checked={disIsNotifiable}
                    onChange={(e) => setDisIsNotifiable(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="disIsNotifiable" className="text-body-md font-medium text-gray-700 cursor-pointer">
                    Bệnh truyền nhiễm nguy hiểm bắt buộc phải khai báo (Notifiable disease)
                  </label>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowDiseaseModal(false)}
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

        {/* Modal: Add/Edit Protocol Item */}
        {showProtocolModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25 shrink-0">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedProtocol ? 'Sửa thông số phác đồ' : 'Thêm hoạt chất vào phác đồ'}
                </h3>
                <button onClick={() => setShowProtocolModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveProtocol} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Chọn Hoạt chất <span className="text-red-500">*</span></label>
                  <select
                    required
                    value={protoIngredientId}
                    onChange={(e) => setProtoIngredientId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chọn hoạt chất --</option>
                    {ingredients.map(ing => (
                      <option key={ing.id} value={ing.id}>{ing.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Vai trò trong phác đồ <span className="text-red-500">*</span></label>
                  <select
                    value={protoRole}
                    onChange={(e) => setProtoRole(e.target.value as any)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="treatment">1. Hoạt chất Đặc trị (Diệt mầm bệnh)</option>
                    <option value="support">2. Bổ trợ Triệu chứng (Hạ sốt, viêm, ho...)</option>
                    <option value="resistance">3. Đề kháng / Phục hồi cơ thể (Vitamin, điện giải...)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tầng ưu tiên (Treatment Line) <span className="text-red-500">*</span></label>
                  <div className="flex gap-4 pt-1">
                    <label className="flex items-center gap-2 text-body-md font-medium text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="proto_line"
                        value={1}
                        checked={protoLine === 1}
                        onChange={() => setProtoLine(1)}
                        className="w-4 h-4 text-blue-650 focus:ring-blue-500"
                      />
                      <span className="text-emerald-700 font-bold">Line 1 (Tối ưu nhất)</span>
                    </label>
                    <label className="flex items-center gap-2 text-body-md font-medium text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="proto_line"
                        value={2}
                        checked={protoLine === 2}
                        onChange={() => setProtoLine(2)}
                        className="w-4 h-4 text-blue-650 focus:ring-blue-500"
                      />
                      <span className="text-blue-700 font-bold">Line 2 (Thay thế)</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Ghi chú liều lượng & kỹ thuật phối hợp</label>
                  <textarea
                    rows={3}
                    placeholder="VD: Tiêm bắp liều 1ml/10kg thể trọng ngày 1 lần..."
                    value={protoNotes}
                    onChange={(e) => setProtoNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 leading-normal"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowProtocolModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy
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
                        Lưu vào phác đồ
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Add/Edit Species */}
        {showSpeciesModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedSpecies ? 'Cập nhật loài vật nuôi' : 'Thêm loài vật nuôi mới'}
                </h3>
                <button onClick={() => setShowSpeciesModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveSpecies} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên loài vật nuôi *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Heo thịt, Gà đẻ, Bò sữa..."
                    value={specName}
                    onChange={(e) => setSpecName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Nhóm ngành chăn nuôi</label>
                  <select
                    value={specCategory}
                    onChange={(e) => setSpecCategory(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="livestock">Gia súc (livestock)</option>
                    <option value="poultry">Gia cầm (poultry)</option>
                    <option value="aquatic">Thủy hải sản (aquatic)</option>
                    <option value="other">Khác</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowSpeciesModal(false)}
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

        {/* Modal: Add/Edit Disease Etiology */}
        {showEtiologyModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedEtiology ? 'Cập nhật phân nhóm nguyên nhân' : 'Thêm phân nhóm nguyên nhân mới'}
                </h3>
                <button onClick={() => setShowEtiologyModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveEtiology} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên nguyên nhân / Tác nhân *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Vi khuẩn Gram-âm, Virus RNA..."
                    value={etName}
                    onChange={(e) => setEtName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã phân nhóm (Tự sinh)</label>
                  <input
                    type="text"
                    placeholder="VD: gram_neg, rna_virus..."
                    value={etCode}
                    onChange={(e) => setEtCode(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 lowercase font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Tác nhân chính</label>
                    <select
                      value={etType}
                      onChange={(e) => setEtType(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="bacteria">Vi khuẩn 🧫</option>
                      <option value="virus">Virus 🦠</option>
                      <option value="parasite">Ký sinh trùng 🐛</option>
                      <option value="environment_nutrition">Môi trường / Dinh dưỡng ☀️</option>
                      <option value="other">Khác</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Gram / Phân nhóm hệ Gen</label>
                    <input
                      type="text"
                      placeholder="Gram-âm, RNA..."
                      value={etSubgroup}
                      onChange={(e) => setEtSubgroup(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mô tả tác nhân</label>
                  <textarea
                    rows={3}
                    placeholder="VD: Vi khuẩn bắt màu hồng/đỏ khi nhuộm Gram..."
                    value={etDesc}
                    onChange={(e) => setEtDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 leading-normal"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowEtiologyModal(false)}
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
