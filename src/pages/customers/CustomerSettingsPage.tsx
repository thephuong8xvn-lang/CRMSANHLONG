import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  ArrowLeft,
  SlidersHorizontal,
  Edit,
  X,
  RefreshCw,
  Activity,
  AlertTriangle,
  Users
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'

interface Profile {
  id: string
  email: string
  full_name: string | null
  job_title: string | null
  is_active: boolean
}

interface Branch {
  id: string
  name: string
  is_active: boolean
}

interface Team {
  id: string
  branch_id: string
  code: string
  name: string
  description: string | null
  lead_id: string | null
  is_active: boolean
  branch?: {
    id: string
    name: string
  } | null
  lead?: {
    id: string
    full_name: string
  } | null
}

interface CustomerClassification {
  id: string
  code: string
  name: string
  is_active: boolean
  created_at: string
}

interface CustomerTier {
  id: string
  code: string
  name: string
  is_active: boolean
  created_at: string
}

export default function CustomerSettingsPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'teams' | 'classifications' | 'tiers'>('teams')
  
  // Lists
  const [teams, setTeams] = useState<Team[]>([])
  const [classifications, setClassifications] = useState<CustomerClassification[]>([])
  const [tiers, setTiers] = useState<CustomerTier[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])

  // Loading States
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Modals Visibility
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [showClassModal, setShowClassModal] = useState(false)
  const [showTierModal, setShowTierModal] = useState(false)

  // Selected for Edit
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [selectedClass, setSelectedClass] = useState<CustomerClassification | null>(null)
  const [selectedTier, setSelectedTier] = useState<CustomerTier | null>(null)

  // Form Fields States
  // Team Form
  const [tmCode, setTmCode] = useState('')
  const [tmName, setTmName] = useState('')
  const [tmDescription, setTmDescription] = useState('')
  const [tmBranchId, setTmBranchId] = useState('')
  const [tmLeadId, setTmLeadId] = useState('')

  // Classification Form
  const [classCode, setClassCode] = useState('')
  const [className, setClassName] = useState('')
  const [classIsActive, setClassIsActive] = useState(true)

  // Tier Form
  const [tierCode, setTierCode] = useState('')
  const [tierName, setTierName] = useState('')
  const [tierIsActive, setTierIsActive] = useState(true)

  const showToast = (type: 'success' | 'error', text: string) => {
    setAlertMsg({ type, text })
    setTimeout(() => setAlertMsg(null), 4000)
  }

  const loadData = async () => {
    setLoading(true)
    try {
      // 1. Fetch classifications
      const { data: ccData } = await supabase
        .from('customer_classifications')
        .select('*')
        .order('code')
      if (ccData) setClassifications(ccData)

      // 2. Fetch tiers
      const { data: ctData } = await supabase
        .from('customer_tiers')
        .select('*')
        .order('code')
      if (ctData) setTiers(ctData)

      // 3. Fetch branches
      const { data: brData } = await supabase
        .from('branches')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name')
      if (brData) setBranches(brData)

      // 4. Fetch profiles (active only for assignment) — nạp ĐỦ (tránh cap 1000)
      const profData = await fetchAllRows<any>((from, to) =>
        supabase.from('profiles').select('id, email, full_name, job_title, is_active')
          .eq('is_active', true).order('full_name', { ascending: true }).order('id').range(from, to)
      )
      if (profData) setProfiles(profData)

      // 5. Fetch teams
      const { data: tmData } = await supabase
        .from('teams')
        .select(`
          id, branch_id, code, name, description, lead_id, is_active,
          branch:branches(id, name),
          lead:profiles!lead_id(id, full_name)
        `)
        .order('code')
      if (tmData) setTeams(tmData as unknown as Team[])

    } catch (err: any) {
      console.error('Error fetching customer configs:', err)
      showToast('error', 'Lỗi tải dữ liệu: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // ─────────────────────────────────────────────────────────────
  // Team Logic
  // ─────────────────────────────────────────────────────────────
  const openNewTeam = () => {
    setSelectedTeam(null)
    setTmCode('')
    setTmName('')
    setTmDescription('')
    setTmBranchId(branches[0]?.id || '')
    setTmLeadId('')
    setShowTeamModal(true)
  }

  const openEditTeam = (tm: Team) => {
    setSelectedTeam(tm)
    setTmCode(tm.code)
    setTmName(tm.name)
    setTmDescription(tm.description || '')
    setTmBranchId(tm.branch_id)
    setTmLeadId(tm.lead_id || '')
    setShowTeamModal(true)
  }

  const handleSaveTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tmCode || !tmName || !tmBranchId) {
      showToast('error', 'Mã nhóm, Tên nhóm và Chi nhánh là bắt buộc.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        code: tmCode.toUpperCase().trim(),
        name: tmName.trim(),
        description: tmDescription.trim() || null,
        branch_id: tmBranchId,
        lead_id: tmLeadId || null
      }

      if (!selectedTeam) {
        const { error } = await supabase.from('teams').insert([payload])
        if (error) throw error
        showToast('success', 'Tạo nhóm Sales thành công!')
      } else {
        const { error } = await supabase
          .from('teams')
          .update(payload)
          .eq('id', selectedTeam.id)
        if (error) throw error
        showToast('success', 'Cập nhật nhóm Sales thành công!')
      }

      setShowTeamModal(false)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi lưu nhóm: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleTeamActive = async (tm: Team) => {
    const nextState = !tm.is_active
    try {
      const { error } = await supabase
        .from('teams')
        .update({ is_active: nextState })
        .eq('id', tm.id)

      if (error) throw error
      showToast('success', `${nextState ? 'Kích hoạt' : 'Khóa'} nhóm Sales thành công.`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi đổi trạng thái nhóm: ' + err.message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Customer Classification Logic
  // ─────────────────────────────────────────────────────────────
  const openNewClassification = () => {
    setSelectedClass(null)
    setClassCode('')
    setClassName('')
    setClassIsActive(true)
    setShowClassModal(true)
  }

  const openEditClassification = (cc: CustomerClassification) => {
    setSelectedClass(cc)
    setClassCode(cc.code)
    setClassName(cc.name)
    setClassIsActive(cc.is_active)
    setShowClassModal(true)
  }

  const handleSaveClassification = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!classCode.trim() || !className.trim()) {
      showToast('error', 'Mã và Tên phân loại là bắt buộc.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        code: classCode.toLowerCase().trim(),
        name: className.trim(),
        is_active: classIsActive
      }

      if (!selectedClass) {
        const { error } = await supabase.from('customer_classifications').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm phân loại khách hàng thành công!')
      } else {
        const { error } = await supabase
          .from('customer_classifications')
          .update(payload)
          .eq('id', selectedClass.id)
        if (error) throw error
        showToast('success', 'Cập nhật phân loại khách hàng thành công!')
      }

      setShowClassModal(false)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi lưu phân loại: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleClassificationActive = async (cc: CustomerClassification) => {
    const nextState = !cc.is_active
    try {
      const { error } = await supabase
        .from('customer_classifications')
        .update({ is_active: nextState })
        .eq('id', cc.id)

      if (error) throw error
      showToast('success', `${nextState ? 'Kích hoạt' : 'Khóa'} phân loại thành công.`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi đổi trạng thái phân loại: ' + err.message)
    }
  }

  const handleDeleteClassification = async (cc: CustomerClassification) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa phân loại "${cc.name}"?`)) return
    try {
      const { error } = await supabase
        .from('customer_classifications')
        .delete()
        .eq('id', cc.id)

      if (error) {
        if (error.code === '23503') {
          throw new Error('Không thể xóa vì đã có khách hàng được gán phân loại này.')
        }
        throw error
      }
      showToast('success', 'Xóa phân loại thành công.')
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi xóa phân loại: ' + err.message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Customer Tier Logic
  // ─────────────────────────────────────────────────────────────
  const openNewTier = () => {
    setSelectedTier(null)
    setTierCode('')
    setTierName('')
    setTierIsActive(true)
    setShowTierModal(true)
  }

  const openEditTier = (ct: CustomerTier) => {
    setSelectedTier(ct)
    setTierCode(ct.code)
    setTierName(ct.name)
    setTierIsActive(ct.is_active)
    setShowTierModal(true)
  }

  const handleSaveTier = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tierCode.trim() || !tierName.trim()) {
      showToast('error', 'Mã và Tên hạng khách hàng là bắt buộc.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        code: tierCode.toLowerCase().trim(),
        name: tierName.trim(),
        is_active: tierIsActive
      }

      if (!selectedTier) {
        const { error } = await supabase.from('customer_tiers').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm hạng khách hàng thành công!')
      } else {
        const { error } = await supabase
          .from('customer_tiers')
          .update(payload)
          .eq('id', selectedTier.id)
        if (error) throw error
        showToast('success', 'Cập nhật hạng khách hàng thành công!')
      }

      setShowTierModal(false)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi lưu hạng khách hàng: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleTierActive = async (ct: CustomerTier) => {
    const nextState = !ct.is_active
    try {
      const { error } = await supabase
        .from('customer_tiers')
        .update({ is_active: nextState })
        .eq('id', ct.id)

      if (error) throw error
      showToast('success', `${nextState ? 'Kích hoạt' : 'Khóa'} hạng khách hàng thành công.`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi đổi trạng thái hạng khách hàng: ' + err.message)
    }
  }

  const handleDeleteTier = async (ct: CustomerTier) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa hạng "${ct.name}"?`)) return
    try {
      const { error } = await supabase
        .from('customer_tiers')
        .delete()
        .eq('id', ct.id)

      if (error) {
        if (error.code === '23503') {
          throw new Error('Không thể xóa vì đã có khách hàng được gán hạng này.')
        }
        throw error
      }
      showToast('success', 'Xóa hạng khách hàng thành công.')
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi xóa hạng khách hàng: ' + err.message)
    }
  }

  return (
    <Layout activeMenu="Cấu hình KH">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6">
        
        {/* Toast Alerts Notification */}
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

        {/* Back Link and Header */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div className="space-y-1">
            <button
              onClick={() => navigate('/customers')}
              className="text-tiny font-bold text-blue-500 hover:text-blue-600 flex items-center gap-1 mb-1 transition-all"
            >
              <ArrowLeft size={14} />
              Quay lại danh sách khách hàng
            </button>
            <h1 className="text-headline-lg font-bold text-gray-800 flex items-center gap-2">
              <Users className="text-blue-500" size={28} />
              Cấu hình Khách hàng & Nhóm
            </h1>
            <p className="text-body-md text-gray-500">
              Quản lý danh sách các nhóm kinh doanh (Sales Teams), phân loại khách hàng và hạng khách hàng.
            </p>
          </div>
          
          <div>
            {activeTab === 'teams' && (
              <button
                onClick={openNewTeam}
                className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
              >
                <Plus size={16} />
                <span>Tạo nhóm Sales</span>
              </button>
            )}
            {activeTab === 'classifications' && (
              <button
                onClick={openNewClassification}
                className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
              >
                <Plus size={16} />
                <span>Thêm phân loại KH</span>
              </button>
            )}
            {activeTab === 'tiers' && (
              <button
                onClick={openNewTier}
                className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
              >
                <Plus size={16} />
                <span>Thêm hạng KH</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Horizontal Select */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-100 px-6 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('teams')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'teams'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Activity size={16} />
              <span>Nhóm Sales ({teams.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('classifications')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'classifications'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <SlidersHorizontal size={16} />
              <span>Phân loại khách hàng ({classifications.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('tiers')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'tiers'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <SlidersHorizontal size={16} />
              <span>Hạng khách hàng ({tiers.length})</span>
            </button>
          </div>

          {/* Tab contents */}
          {loading ? (
            <div className="py-24 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
              <span>Đang tải danh mục cấu hình...</span>
            </div>
          ) : (
            <>
              {/* TAB 1: TEAMS */}
              {activeTab === 'teams' && (
                <div className="p-6 space-y-6">
                  {teams.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 space-y-2">
                      <Activity className="w-12 h-12 text-gray-300 mx-auto" />
                      <p className="font-semibold text-body-lg">Chưa cấu hình nhóm sales nào</p>
                      <p className="text-body-md">Tạo nhóm để quản lý phân quyền và xem báo cáo theo nhóm.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {teams.map(tm => (
                        <div
                          key={tm.id}
                          className={`bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group ${
                            tm.is_active ? 'border-gray-100' : 'border-gray-200 bg-gray-50/40 opacity-70'
                          }`}
                        >
                          <div className="space-y-4">
                            {/* Card header */}
                            <div className="flex justify-between items-start">
                              <span className="font-mono text-tiny font-bold text-blue-500 uppercase bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">
                                {tm.code}
                              </span>
                              
                              <button
                                type="button"
                                onClick={() => handleToggleTeamActive(tm)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-all ${
                                  tm.is_active 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                    : 'bg-gray-100 text-gray-500 border-gray-200'
                                }`}
                              >
                                {tm.is_active ? 'Đang hoạt động' : 'Tạm khóa'}
                              </button>
                            </div>

                            {/* Team details */}
                            <div>
                              <h3 className="font-bold text-body-lg text-gray-800 group-hover:text-blue-500 transition-colors">
                                {tm.name}
                              </h3>
                              <p className="text-tiny text-gray-400 mt-2 italic line-clamp-2">
                                {tm.description || 'Không có mô tả chi tiết.'}
                              </p>
                              <p className="text-tiny text-gray-450 mt-3 font-medium">
                                <span className="font-semibold text-gray-400">Thuộc chi nhánh:</span>{' '}
                                <span className="font-semibold text-gray-750">{tm.branch?.name || 'Văn phòng chính'}</span>
                              </p>
                            </div>
                          </div>

                          {/* Card footer lead / actions */}
                          <div className="flex justify-between items-center border-t border-gray-50 mt-5 pt-3">
                            <span className="text-tiny text-gray-400 font-semibold">
                              Trưởng nhóm: <span className="text-gray-700 font-bold">{tm.lead?.full_name || 'Chưa chỉ định'}</span>
                            </span>
                            
                            <button
                              onClick={() => openEditTeam(tm)}
                              className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                            >
                              <Edit size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CLASSIFICATIONS */}
              {activeTab === 'classifications' && (
                <div className="p-6 space-y-6">
                  {classifications.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 space-y-2">
                      <SlidersHorizontal className="w-12 h-12 text-gray-300 mx-auto" />
                      <p className="font-semibold text-body-lg">Chưa cấu hình phân loại khách hàng nào</p>
                      <p className="text-body-md">Bấm "Thêm phân loại KH" để quản lý danh mục phân loại.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                            <th className="px-6 py-4">Mã phân loại</th>
                            <th className="px-6 py-4">Tên phân loại</th>
                            <th className="px-6 py-4 text-center">Trạng thái</th>
                            <th className="px-6 py-4 w-24 text-center">Hành động</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                          {classifications.map((cc) => (
                            <tr key={cc.id} className={`hover:bg-gray-25/50 transition-colors ${!cc.is_active ? 'opacity-65 bg-gray-50/45' : ''}`}>
                              <td className="px-6 py-4 font-mono font-bold text-gray-500 uppercase">{cc.code}</td>
                              <td className="px-6 py-4 font-semibold text-gray-700">{cc.name}</td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleClassificationActive(cc)}
                                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    cc.is_active ? 'bg-blue-500' : 'bg-gray-250'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                      cc.is_active ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <div className="flex justify-center gap-2">
                                  <button
                                    onClick={() => openEditClassification(cc)}
                                    className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                                  >
                                    <Edit size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteClassification(cc)}
                                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
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
              )}

              {/* TAB 3: TIERS */}
              {activeTab === 'tiers' && (
                <div className="p-6 space-y-6">
                  {tiers.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 space-y-2">
                      <SlidersHorizontal className="w-12 h-12 text-gray-300 mx-auto" />
                      <p className="font-semibold text-body-lg">Chưa cấu hình hạng khách hàng nào</p>
                      <p className="text-body-md">Bấm "Thêm hạng KH" để quản lý hạng khách hàng.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                            <th className="px-6 py-4">Mã hạng</th>
                            <th className="px-6 py-4">Tên hạng</th>
                            <th className="px-6 py-4 text-center">Trạng thái</th>
                            <th className="px-6 py-4 w-24 text-center">Hành động</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                          {tiers.map((ct) => (
                            <tr key={ct.id} className={`hover:bg-gray-25/50 transition-colors ${!ct.is_active ? 'opacity-65 bg-gray-50/45' : ''}`}>
                              <td className="px-6 py-4 font-mono font-bold text-gray-500 uppercase">{ct.code}</td>
                              <td className="px-6 py-4 font-semibold text-gray-700">{ct.name}</td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleTierActive(ct)}
                                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    ct.is_active ? 'bg-blue-500' : 'bg-gray-250'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                      ct.is_active ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <div className="flex justify-center gap-2">
                                  <button
                                    onClick={() => openEditTier(ct)}
                                    className="text-gray-450 hover:text-blue-650 transition-colors p-1"
                                  >
                                    <Edit size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTier(ct)}
                                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
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
              )}
            </>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────
            MODALS SECTION
           ───────────────────────────────────────────────────────────── */}
        
        {/* MODAL 1: TEAM CREATE / EDIT FORM */}
        {showTeamModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedTeam ? 'Cập nhật nhóm kinh doanh' : 'Tạo nhóm Sales mới'}
                </h3>
                <button onClick={() => setShowTeamModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveTeam} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã nhóm sales <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: TEAM-MN-HEO..."
                    value={tmCode}
                    onChange={(e) => setTmCode(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 uppercase font-semibold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên nhóm <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Nhóm lợn miền Nam..."
                    value={tmName}
                    onChange={(e) => setTmName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Chi nhánh trực thuộc <span className="text-red-500">*</span></label>
                  <select
                    value={tmBranchId}
                    onChange={(e) => setTmBranchId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chọn chi nhánh --</option>
                    {branches.map(br => (
                      <option key={br.id} value={br.id}>{br.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Trưởng nhóm (Team Lead)</label>
                  <select
                    value={tmLeadId}
                    onChange={(e) => setTmLeadId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chưa chỉ định --</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mô tả chi tiết</label>
                  <textarea
                    rows={3}
                    placeholder="Thông tin thêm về nhóm..."
                    value={tmDescription}
                    onChange={(e) => setTmDescription(e.target.value)}
                    className="w-full border border-gray-100 rounded-lg text-body-md p-3 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowTeamModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50"
                  >
                    {saving ? 'Đang lưu...' : 'Lưu thông tin'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 2: CLASSIFICATION CREATE / EDIT FORM */}
        {showClassModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedClass ? 'Cập nhật phân loại khách hàng' : 'Thêm phân loại khách hàng mới'}
                </h3>
                <button onClick={() => setShowClassModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveClassification} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã phân loại <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: farm_household, dealer..."
                    value={classCode}
                    onChange={(e) => setClassCode(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên phân loại <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Hộ chăn nuôi..."
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-3 select-none">
                  <span className="text-body-md font-semibold text-gray-700">Trạng thái hoạt động:</span>
                  <button
                    type="button"
                    onClick={() => setClassIsActive(!classIsActive)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      classIsActive ? 'bg-blue-500' : 'bg-gray-250'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        classIsActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowClassModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50"
                  >
                    {saving ? 'Đang lưu...' : 'Lưu thông tin'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 3: TIER CREATE / EDIT FORM */}
        {showTierModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedTier ? 'Cập nhật hạng khách hàng' : 'Thêm hạng khách hàng mới'}
                </h3>
                <button onClick={() => setShowTierModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveTier} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã hạng <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: normal, vip..."
                    value={tierCode}
                    onChange={(e) => setTierCode(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên hạng <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Khách hàng VIP..."
                    value={tierName}
                    onChange={(e) => setTierName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-3 select-none">
                  <span className="text-body-md font-semibold text-gray-700">Trạng thái hoạt động:</span>
                  <button
                    type="button"
                    onClick={() => setTierIsActive(!tierIsActive)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      tierIsActive ? 'bg-blue-500' : 'bg-gray-255'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        tierIsActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowTierModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50"
                  >
                    {saving ? 'Đang lưu...' : 'Lưu thông tin'}
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
