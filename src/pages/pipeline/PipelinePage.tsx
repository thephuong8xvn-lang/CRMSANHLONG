import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  Plus,
  TrendingUp,
  X,
  AlertTriangle,
  CheckCircle,
  MoreVertical,
  Calendar,
  Users,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  List,
  ArrowLeft,
  ArrowRight,
  Clock,
  ExternalLink
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { Link } from 'react-router-dom'

interface Pipeline {
  id: string
  code: string
  name: string
  description: string | null
}

interface Stage {
  id: string
  pipeline_id: string
  code: string
  name: string
  sort_order: number
  win_probability: number
  is_won_stage: boolean
  is_lost_stage: boolean
  color_hex: string
}

interface Customer {
  id: string
  code: string
  farm_name: string
}

interface Owner {
  id: string
  full_name: string
  avatar_url?: string
}

interface Opportunity {
  id: string
  opp_code: string
  customer_id: string
  pipeline_id: string | null
  stage_id: string | null
  title: string
  status: 'open' | 'won' | 'lost' | 'abandoned'
  estimated_value: number
  win_probability: number
  expected_close_date: string | null
  actual_close_date: string | null
  owner_user_id: string
  team_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  customers?: {
    farm_name: string
  }
  owner?: {
    full_name: string
  }
}

interface LostReason {
  id: string
  name: string
}

export default function PipelinePage() {
  const { profile } = useAuth()
  const { formatCurrency, getStatusBadgeStyle } = useDisplaySettings()

  // Master Lists
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [salesReps, setSalesReps] = useState<Owner[]>([])
  const [lostReasons, setLostReasons] = useState<LostReason[]>([])

  // Selection/Filter States
  const [selectedPipelineId, setSelectedPipelineId] = useState('')
  const [selectedOwnerFilter, setSelectedOwnerFilter] = useState('all') // 'all', 'me', or rep ID
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'open' | 'won' | 'lost' | 'abandoned'>('open')
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban')

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  // Add Form state
  const [addTitle, setAddTitle] = useState('')
  const [addCustomerId, setAddCustomerId] = useState('')
  const [addStageId, setAddStageId] = useState('')
  const [addValue, setAddValue] = useState(0)
  const [addProb, setAddProb] = useState(10)
  const [addCloseDate, setAddCloseDate] = useState('')
  const [addNotes, setAddNotes] = useState('')

  // Edit/Detail Form state
  const [editingOpp, setEditingOpp] = useState<Opportunity | null>(null)

  // Won/Lost close modal state
  const [closeTarget, setCloseTarget] = useState<{ id: string; stageId: string } | null>(null)
  const [closeMode, setCloseMode] = useState<'won' | 'lost'>('won')
  const [selectedLostReasonId, setSelectedLostReasonId] = useState('')
  const [closeNotes, setCloseNotes] = useState('')

  // UI state
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [activeCardDropdown, setActiveCardDropdown] = useState<string | null>(null)

  // Fetch Master Data & Metadata
  const loadMetadata = async () => {
    try {
      // 1. Fetch Pipelines
      const { data: pipeData } = await supabase
        .from('pipeline_definitions')
        .select('*')
        .eq('is_active', true)
      if (pipeData) {
        setPipelines(pipeData)
        // Set default pipeline
        const def = pipeData.find(p => p.is_default) || pipeData[0]
        if (def) setSelectedPipelineId(def.id)
      }

      // 2. Fetch Customers
      const { data: custData } = await supabase
        .from('customers')
        .select('id, code, farm_name')
        .eq('is_active', true)
      if (custData) setCustomers(custData)

      // 3. Fetch Sales Reps (Profiles)
      const { data: repsData } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('is_active', true)
      if (repsData) setSalesReps(repsData)

      // 4. Fetch Lost Reasons
      const { data: lostData } = await supabase
        .from('lost_reasons')
        .select('id, name')
        .eq('is_active', true)
      if (lostData) setLostReasons(lostData)

    } catch (err) {
      console.error('Error loading pipeline metadata:', err)
    }
  }

  // Fetch Stages for selected Pipeline
  const loadStages = useCallback(async () => {
    if (!selectedPipelineId) return
    try {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', selectedPipelineId)
        .order('sort_order', { ascending: true })
      if (data) {
        setStages(data)
        if (data.length > 0) setAddStageId(data[0].id)
      }
    } catch (err) {
      console.error(err)
    }
  }, [selectedPipelineId])

  // Fetch Opportunities
  const fetchOpportunities = useCallback(async () => {
    if (!selectedPipelineId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('opportunities')
        .select(`
          *,
          customers:customers!opportunities_customer_id_fkey(farm_name),
          owner:profiles!opportunities_owner_user_id_fkey(full_name)
        `)
        .eq('pipeline_id', selectedPipelineId)
        .order('created_at', { ascending: false })

      if (error) throw error
      if (data) {
        setOpportunities(data as unknown as Opportunity[])
      }
    } catch (err) {
      console.error('Error fetching opportunities:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedPipelineId])

  // Load everything on mount
  useEffect(() => {
    loadMetadata()
  }, [])

  // Load stages when pipeline selection changes
  useEffect(() => {
    loadStages()
  }, [selectedPipelineId, loadStages])

  // Load opportunities when pipeline selection changes
  useEffect(() => {
    fetchOpportunities()
  }, [selectedPipelineId, fetchOpportunities])

  // Reset alert messages automatically
  useEffect(() => {
    if (alertMsg) {
      const t = setTimeout(() => setAlertMsg(null), 3000)
      return () => clearTimeout(t)
    }
  }, [alertMsg])

  // Days in stage helper
  const getDaysInStage = (updatedAtStr: string) => {
    const updatedDate = new Date(updatedAtStr)
    const now = new Date()
    const diff = Math.abs(now.getTime() - updatedDate.getTime())
    const diffDays = Math.ceil(diff / (1000 * 60 * 60 * 24))
    return diffDays
  }

  // Apply filters to local opportunities state
  const getFilteredOpportunities = () => {
    return opportunities.filter(opp => {
      // 1. Status Filter
      if (selectedStatusFilter !== 'all') {
        if (opp.status !== selectedStatusFilter) return false
      }

      // 2. Owner Filter
      if (selectedOwnerFilter === 'me') {
        if (opp.owner_user_id !== profile?.id) return false
      } else if (selectedOwnerFilter !== 'all') {
        if (opp.owner_user_id !== selectedOwnerFilter) return false
      }

      // 3. Search query filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim()
        const matchTitle = opp.title.toLowerCase().includes(query)
        const matchCode = opp.opp_code.toLowerCase().includes(query)
        const matchCustomer = (opp.customers?.farm_name || '').toLowerCase().includes(query)
        if (!matchTitle && !matchCode && matchCustomer === false) return false
      }

      return true
    })
  }

  // Quick move stage handler
  const handleMoveStage = async (opp: Opportunity, direction: 'left' | 'right') => {
    if (!opp.stage_id) return
    const currIndex = stages.findIndex(s => s.id === opp.stage_id)
    if (currIndex === -1) return

    const targetIndex = direction === 'right' ? currIndex + 1 : currIndex - 1
    if (targetIndex < 0 || targetIndex >= stages.length) return

    const targetStage = stages[targetIndex]
    if (targetStage.is_won_stage || targetStage.code === 'THANG') {
      setCloseMode('won')
      setCloseTarget({ id: opp.id, stageId: targetStage.id })
      setCloseNotes('')
      setIsCloseModalOpen(true)
    } else if (targetStage.is_lost_stage || targetStage.code === 'THUA') {
      setCloseMode('lost')
      setCloseTarget({ id: opp.id, stageId: targetStage.id })
      setSelectedLostReasonId(lostReasons.length > 0 ? lostReasons[0].id : '')
      setCloseNotes('')
      setIsCloseModalOpen(true)
    } else {
      await updateOpportunityStage(opp.id, targetStage.id, 'open', { win_probability: targetStage.win_probability })
    }
  }

  // Search keyword highlight helper
  const highlightText = (text: string | null | undefined, search: string) => {
    if (!text) return ''
    if (!search.trim()) return text

    const regex = new RegExp(`(${search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-100 font-bold text-gray-800 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  // HTML5 Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, oppId: string) => {
    e.dataTransfer.setData('opp_id', oppId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault()
    const oppId = e.dataTransfer.getData('opp_id')
    const opp = opportunities.find(o => o.id === oppId)
    if (!opp) return

    // If dropping in the same stage, do nothing
    if (opp.stage_id === targetStageId) return

    const targetStage = stages.find(s => s.id === targetStageId)
    if (!targetStage) return

    if (targetStage.is_won_stage || targetStage.code === 'THANG') {
      // Open won dialog
      setCloseMode('won')
      setCloseTarget({ id: oppId, stageId: targetStageId })
      setCloseNotes('')
      setIsCloseModalOpen(true)
    } else if (targetStage.is_lost_stage || targetStage.code === 'THUA') {
      // Open lost dialog
      setCloseMode('lost')
      setCloseTarget({ id: oppId, stageId: targetStageId })
      setSelectedLostReasonId(lostReasons.length > 0 ? lostReasons[0].id : '')
      setCloseNotes('')
      setIsCloseModalOpen(true)
    } else {
      // Direct drag stage update
      await updateOpportunityStage(oppId, targetStageId, 'open', { win_probability: targetStage.win_probability })
    }
  }

  // Save stage update to Supabase
  const updateOpportunityStage = async (oppId: string, stageId: string, status: string, extra: any = {}) => {
    try {
      const updateData = {
        stage_id: stageId,
        status: status,
        ...extra,
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('opportunities')
        .update(updateData)
        .eq('id', oppId)

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Cập nhật giai đoạn cơ hội thành công.' })
      fetchOpportunities()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi cập nhật giai đoạn: ' + err.message })
    }
  }

  // Add New Opportunity Submit
  const handleAddOpportunitySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addTitle.trim()) {
      setAlertMsg({ type: 'error', text: 'Vui lòng nhập tiêu đề cơ hội.' })
      return
    }
    if (!addCustomerId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn khách hàng.' })
      return
    }
    if (!profile?.id) return

    setSubmitting(true)
    try {
      const insertData = {
        title: addTitle.trim(),
        customer_id: addCustomerId,
        pipeline_id: selectedPipelineId,
        stage_id: addStageId,
        status: 'open',
        estimated_value: Number(addValue),
        win_probability: Number(addProb),
        expected_close_date: addCloseDate || null,
        owner_user_id: profile.id,
        notes: addNotes.trim() || null
      }

      const { error } = await supabase
        .from('opportunities')
        .insert([insertData])

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Đã tạo cơ hội bán hàng mới.' })
      setIsAddModalOpen(false)
      // Reset form
      setAddTitle('')
      setAddCustomerId('')
      setAddValue(0)
      setAddProb(10)
      setAddCloseDate('')
      setAddNotes('')
      fetchOpportunities()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi tạo cơ hội: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Edit/Detail Submit
  const handleEditOpportunitySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingOpp || !editingOpp.title.trim()) return

    setSubmitting(true)
    try {
      const updateData = {
        title: editingOpp.title.trim(),
        customer_id: editingOpp.customer_id,
        stage_id: editingOpp.stage_id,
        status: editingOpp.status,
        estimated_value: Number(editingOpp.estimated_value),
        win_probability: Number(editingOpp.win_probability),
        expected_close_date: editingOpp.expected_close_date || null,
        notes: editingOpp.notes || null,
        updated_at: new Date().toISOString()
      }

      // Check for closed won/lost dates
      if (editingOpp.status === 'won') {
        (updateData as any).actual_close_date = new Date().toISOString().split('T')[0]
      } else if (editingOpp.status === 'lost' || editingOpp.status === 'abandoned') {
        (updateData as any).actual_close_date = new Date().toISOString().split('T')[0]
      }

      const { error } = await supabase
        .from('opportunities')
        .update(updateData)
        .eq('id', editingOpp.id)

      if (error) throw error

      setAlertMsg({ type: 'success', text: `Cập nhật cơ hội #${editingOpp.opp_code} thành công.` })
      setIsEditModalOpen(false)
      setEditingOpp(null)
      fetchOpportunities()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi cập nhật: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Confirm Close won/lost
  const handleConfirmClose = async () => {
    if (!closeTarget) return
    setSubmitting(true)
    try {
      const extra: any = {
        actual_close_date: new Date().toISOString().split('T')[0],
        close_reason: closeNotes.trim() || null
      }

      if (closeMode === 'lost') {
        extra.lost_reason_id = selectedLostReasonId
        extra.win_probability = 0
      } else {
        extra.win_probability = 100
      }

      await updateOpportunityStage(closeTarget.id, closeTarget.stageId, closeMode, extra)
      setIsCloseModalOpen(false)
      setCloseTarget(null)
    } catch (err: any) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  // Footer statistics calculations
  const filteredOpps = getFilteredOpportunities()
  
  const totalPipelineValue = filteredOpps
    .filter(o => o.status === 'open')
    .reduce((sum, o) => sum + Number(o.estimated_value), 0)

  const closedWonCount = filteredOpps.filter(o => o.status === 'won').length
  const closedTotalCount = filteredOpps.filter(o => o.status === 'won' || o.status === 'lost' || o.status === 'abandoned').length
  const winRate = closedTotalCount > 0 ? (closedWonCount / closedTotalCount) * 100 : 0

  const wonThisMonthCount = filteredOpps.filter(o => {
    if (o.status !== 'won') return false
    const d = new Date(o.updated_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  return (
    <Layout activeMenu="Pipeline">
      <div className="p-4 md:p-10 max-w-[1800px] mx-auto flex flex-col h-[calc(100vh-64px)] overflow-hidden space-y-6">
        
        {/* Toast alerts */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-55 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Header toolbar */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4 shrink-0">
          <div>
            <nav className="flex items-center gap-2 text-label-md text-gray-400 mb-1">
              <span>Bán hàng</span>
              <ChevronRight size={12} />
              <span className="text-blue-500 font-bold">Pipeline Cơ hội</span>
            </nav>
            <h2 className="text-[28px] font-bold text-gray-700">Quy trình bán hàng Sanh Long</h2>
          </div>
          <div className="flex items-center gap-3 self-start sm:self-auto">
            {/* View Mode Toggle buttons */}
            <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
              <button
                type="button"
                onClick={() => setViewMode('kanban')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'kanban' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Dạng bảng Kanban"
              >
                <LayoutGrid size={18} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Dạng danh sách"
              >
                <List size={18} />
              </button>
            </div>

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="h-10 px-5 bg-blue-500 text-white rounded-lg text-body-md font-semibold flex items-center gap-2 hover:bg-blue-600 active:scale-95 transition-all shadow-sm"
            >
              <Plus size={18} />
              Thêm cơ hội mới
            </button>
          </div>
        </div>

        {/* Filter Area */}
        <div className="bg-gray-0 p-5 rounded-xl border border-gray-100 flex flex-wrap items-end gap-4 shadow-sm shrink-0">
          {/* Quick search input */}
          <div className="flex-1 min-w-[250px]">
            <label className="text-tiny font-bold text-gray-400 block mb-1.5 uppercase tracking-wider">Tìm kiếm</label>
            <div className="relative flex items-center bg-gray-25 rounded-lg border border-gray-100 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-105 transition-all h-10">
              <Search className="text-gray-400 ml-3 mr-2" size={16} />
              <input
                className="bg-transparent border-none focus:ring-0 text-body-md w-full placeholder-gray-400 p-0 focus:outline-none"
                placeholder="Tìm mã cơ hội, tên cơ hội, trại..."
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="p-1.5 text-gray-400 hover:bg-gray-50 rounded-full mr-2">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Pipeline Selector dropdown */}
          <div className="w-full sm:w-52">
            <label className="text-tiny font-bold text-gray-400 block mb-1.5 uppercase tracking-wider">Chọn Pipeline</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedPipelineId}
              onChange={e => setSelectedPipelineId(e.target.value)}
            >
              {pipelines.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Opportunity Status Filter dropdown */}
          <div className="w-full sm:w-44">
            <label className="text-tiny font-bold text-gray-400 block mb-1.5 uppercase tracking-wider">Trạng thái Cơ hội</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedStatusFilter}
              onChange={e => setSelectedStatusFilter(e.target.value as any)}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="open">Đang theo đuổi (Open)</option>
              <option value="won">Đã thắng (Won)</option>
              <option value="lost">Đã thua (Lost)</option>
              <option value="abandoned">Đã hủy bỏ</option>
            </select>
          </div>

          {/* Sales Filter dropdown */}
          <div className="w-full sm:w-48">
            <label className="text-tiny font-bold text-gray-400 block mb-1.5 uppercase tracking-wider">Sales phụ trách</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedOwnerFilter}
              onChange={e => setSelectedOwnerFilter(e.target.value)}
            >
              <option value="all">Tất cả cơ hội</option>
              <option value="me">Cơ hội của tôi</option>
              {salesReps.map(rep => (
                <option key={rep.id} value={rep.id}>{rep.full_name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Kanban Board Container */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4 custom-scrollbar">
          {viewMode === 'list' ? (
            <div className="w-full bg-white border border-gray-150 rounded-xl overflow-hidden shadow-sm flex flex-col h-full">
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-25 border-b border-gray-100">
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Mã cơ hội</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Tiêu đề cơ hội</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Khách hàng / Trang trại</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Giai đoạn</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider text-right">Giá trị dự kiến</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider text-center">Xác suất</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Ngày chốt dự kiến</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Người phụ trách</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Trạng thái</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-body-md text-gray-600">
                    {loading ? (
                      <tr>
                        <td colSpan={10} className="px-6 py-12 text-center">
                          <div className="flex items-center justify-center gap-2 text-gray-400 text-tiny">
                            <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                            Đang tải cơ hội bán hàng...
                          </div>
                        </td>
                      </tr>
                    ) : filteredOpps.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-6 py-12 text-center text-gray-400 italic">
                          Không tìm thấy cơ hội bán hàng nào khớp với điều kiện lọc.
                        </td>
                      </tr>
                    ) : (
                      filteredOpps.map(opp => {
                        const stage = stages.find(s => s.id === opp.stage_id)
                        const days = getDaysInStage(opp.updated_at)
                        const isStale = days > 7 && opp.status === 'open'

                        return (
                          <tr key={opp.id} className="hover:bg-gray-25/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-blue-600 text-tiny tabular-nums">
                              {highlightText(opp.opp_code, searchTerm)}
                            </td>
                            <td className="px-6 py-4">
                              <span
                                onClick={() => {
                                  setEditingOpp({ ...opp })
                                  setIsEditModalOpen(true)
                                }}
                                className="font-bold text-gray-700 hover:text-blue-500 cursor-pointer block"
                              >
                                {highlightText(opp.title, searchTerm)}
                              </span>
                              {isStale && (
                                <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                                  <Clock size={10} /> Trì trệ {days} ngày
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <Link to={`/customers/${opp.customer_id}`} className="font-semibold text-gray-500 hover:text-blue-500 flex items-center gap-1.5">
                                {highlightText(opp.customers?.farm_name || 'Khách lẻ / Chưa liên kết', searchTerm)}
                                <ExternalLink size={12} className="text-gray-300" />
                              </Link>
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className="px-2.5 py-1 rounded text-tiny font-bold border"
                                style={{
                                  color: stage?.color_hex || '#4b5563',
                                  borderColor: `${stage?.color_hex}40` || '#e5e7eb',
                                  backgroundColor: `${stage?.color_hex}10` || '#f9fafb'
                                }}
                              >
                                {stage?.name || 'Chưa rõ'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right font-bold tabular-nums text-gray-700">
                              {formatCurrency(opp.estimated_value)}
                            </td>
                            <td className="px-6 py-4 text-center font-semibold tabular-nums text-gray-500">
                              {opp.win_probability}%
                            </td>
                            <td className="px-6 py-4 text-tiny font-semibold text-gray-500 tabular-nums">
                              {opp.expected_close_date ? new Date(opp.expected_close_date).toLocaleDateString('vi-VN') : '-'}
                            </td>
                            <td className="px-6 py-4 font-semibold text-gray-600">
                              {opp.owner?.full_name || 'Hệ thống'}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${getStatusBadgeStyle(opp.status, 'opportunity')}`}>
                                {opp.status === 'open' ? 'Đang theo đuổi' : opp.status === 'won' ? 'Thành công' : opp.status === 'lost' ? 'Thất bại' : 'Hủy bỏ'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                {opp.status === 'open' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStage(opp, 'left')}
                                      disabled={stages.findIndex(s => s.id === opp.stage_id) === 0}
                                      className="p-1 hover:bg-gray-100 rounded text-gray-400 disabled:opacity-30"
                                      title="Lùi giai đoạn"
                                    >
                                      <ChevronLeft size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStage(opp, 'right')}
                                      disabled={stages.findIndex(s => s.id === opp.stage_id) === stages.length - 1}
                                      className="p-1 hover:bg-gray-100 rounded text-gray-400 disabled:opacity-30"
                                      title="Tiến giai đoạn"
                                    >
                                      <ChevronRight size={16} />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingOpp({ ...opp })
                                    setIsEditModalOpen(true)
                                  }}
                                  className="p-1 hover:bg-gray-100 rounded text-blue-500"
                                  title="Sửa chi tiết"
                                >
                                  <MoreVertical size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex gap-6 h-full min-w-max">
              {loading ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                  <div className="w-10 h-10 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-3"></div>
                  <span>Đang tải thông tin cơ hội bán hàng...</span>
                </div>
              ) : stages.length === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-gray-400 italic">
                  Chưa cấu hình giai đoạn cho pipeline này.
                </div>
              ) : (
                stages.map(stage => {
                  const stageOpps = filteredOpps.filter(o => o.stage_id === stage.id)
                  const columnTotal = stageOpps.reduce((sum, o) => sum + Number(o.estimated_value), 0)

                  return (
                    <div
                      key={stage.id}
                      onDragOver={handleDragOver}
                      onDrop={e => handleDrop(e, stage.id)}
                      className="w-72 flex flex-col h-full bg-gray-50 border border-gray-100 rounded-xl"
                      style={{ borderTop: `4px solid ${stage.color_hex || '#e5e7eb'}` }}
                    >
                      {/* Column Header */}
                      <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                        <div className="flex flex-col">
                          <span className="text-body-md font-bold text-gray-700 truncate max-w-[200px]" style={{ color: stage.color_hex }}>
                            {stage.name}
                          </span>
                          <span className="text-tiny text-gray-400 font-medium tabular-nums mt-0.5">
                            {formatCurrency(columnTotal)}
                          </span>
                        </div>
                        <span className="bg-gray-200/80 px-2 py-0.5 rounded-full text-tiny font-bold text-gray-500 tabular-nums">
                          {stageOpps.length}
                        </span>
                      </div>

                      {/* Column Body - cards wrapper */}
                      <div className="flex-grow overflow-y-auto p-3 space-y-3.5 custom-scrollbar">
                        {stageOpps.length === 0 ? (
                          <div className="h-20 border-2 border-dashed border-gray-200/50 rounded-lg flex items-center justify-center text-tiny text-gray-300 italic">
                            Kéo cơ hội thả vào đây
                          </div>
                        ) : (
                          stageOpps.map(opp => {
                            const days = getDaysInStage(opp.updated_at)
                            const isStale = days > 7 && opp.status === 'open'
                            const showDropdown = activeCardDropdown === opp.id

                            return (
                              <div
                                key={opp.id}
                                draggable={opp.status === 'open'}
                                onDragStart={e => handleDragStart(e, opp.id)}
                                className="bg-white border-l-4 p-4 rounded-lg shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group relative"
                                style={{ borderLeftColor: stage.color_hex || '#e5e7eb' }}
                              >
                                {/* Title / Action dropdown */}
                                <div className="flex justify-between items-start gap-2 mb-1">
                                  <h4
                                    onClick={() => {
                                      setEditingOpp({ ...opp })
                                      setIsEditModalOpen(true)
                                    }}
                                    className="text-body-md font-bold text-gray-700 line-clamp-2 leading-snug group-hover:text-blue-500 cursor-pointer transition-colors"
                                  >
                                    {highlightText(opp.title, searchTerm)}
                                  </h4>
                                  <div className="relative">
                                    <button
                                      onClick={() => setActiveCardDropdown(showDropdown ? null : opp.id)}
                                      className="p-1 hover:bg-gray-50 text-gray-400 rounded-md"
                                    >
                                      <MoreVertical size={14} />
                                    </button>
                                    {showDropdown && (
                                      <>
                                        <div className="fixed inset-0 z-10" onClick={() => setActiveCardDropdown(null)} />
                                        <div className="absolute right-0 mt-1 w-32 bg-white border border-gray-100 rounded shadow-lg py-1 z-20 text-tiny font-semibold text-gray-600">
                                          <button
                                            onClick={() => {
                                              setActiveCardDropdown(null)
                                              setEditingOpp({ ...opp })
                                              setIsEditModalOpen(true)
                                            }}
                                            className="w-full px-3 py-1.5 hover:bg-gray-50 text-left"
                                          >
                                            Sửa chi tiết
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* Code */}
                                <p className="text-[10px] text-gray-400 font-bold tracking-wider uppercase mb-1 font-mono">
                                  {highlightText(opp.opp_code, searchTerm)}
                                </p>

                                {/* Customer and Value */}
                                <p className="text-tiny text-gray-500 font-semibold truncate mb-2">
                                  {highlightText(opp.customers?.farm_name || 'Khách lẻ / Chưa liên kết', searchTerm)}
                                </p>
                                
                                <p className="text-body-lg font-bold text-blue-500 mb-3 tabular-nums">
                                  {formatCurrency(opp.estimated_value)}
                                </p>

                                {/* Footer details */}
                                <div className="flex flex-col gap-2 border-t border-gray-50 pt-2">
                                  <div className="flex justify-between items-center">
                                    <div className={`flex items-center gap-1 ${isStale ? 'text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 font-bold' : 'text-gray-400 font-medium'}`}>
                                      <Calendar size={12} />
                                      <span className="text-[11px] tabular-nums">
                                        {days} ngày {isStale && '• Trì trệ'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-gray-400 font-semibold truncate max-w-[80px]">{opp.owner?.full_name || 'Sales'}</span>
                                      <div className="w-5 h-5 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-500 uppercase">
                                        {opp.owner?.full_name?.charAt(0) || 'S'}
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {/* Quick Move Actions in Card Footer */}
                                  {opp.status === 'open' && (
                                    <div className="flex justify-end gap-1.5 pt-1 mt-1 border-t border-gray-50">
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleMoveStage(opp, 'left') }}
                                        disabled={stages.findIndex(s => s.id === opp.stage_id) === 0}
                                        className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-50 rounded disabled:opacity-20 transition-all"
                                        title="Lùi giai đoạn"
                                      >
                                        <ArrowLeft size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleMoveStage(opp, 'right') }}
                                        disabled={stages.findIndex(s => s.id === opp.stage_id) === stages.length - 1}
                                        className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-50 rounded disabled:opacity-20 transition-all"
                                        title="Tiến giai đoạn"
                                      >
                                        <ArrowRight size={13} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Footer KPI Stats Widgets */}
        <div className="mt-4 flex flex-wrap gap-8 items-center bg-gray-50 p-4 rounded-xl border border-gray-100 shrink-0 shadow-inner">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
              <TrendingUp size={20} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Tổng giá trị Pipeline</p>
              <p className="text-body-lg font-bold text-blue-600 leading-tight mt-0.5 tabular-nums">
                {formatCurrency(totalPipelineValue)}
              </p>
            </div>
          </div>
          <div className="h-8 w-[1px] bg-gray-200 hidden sm:block"></div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <CheckCircle size={20} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Tỷ lệ thắng</p>
              <p className="text-body-lg font-bold text-emerald-600 leading-tight mt-0.5 tabular-nums">
                {winRate.toFixed(1)}%
              </p>
            </div>
          </div>
          <div className="h-8 w-[1px] bg-gray-200 hidden sm:block"></div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
              <Users size={20} />
            </div>
            <div>
              <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Chốt thắng mới (tháng này)</p>
              <p className="text-body-lg font-bold text-gray-700 leading-tight mt-0.5 tabular-nums">
                {wonThisMonthCount} cơ hội
              </p>
            </div>
          </div>
        </div>

        {/* MODAL 1: ADD NEW OPPORTUNITY */}
        {isAddModalOpen && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-200">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-700">Tạo cơ hội bán hàng mới</h3>
                <button onClick={() => setIsAddModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-full text-gray-400"><X size={20} /></button>
              </div>

              <form onSubmit={handleAddOpportunitySubmit} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Tiêu đề cơ hội *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Cung cấp vaccine dịch tả heo nái đẻ"
                    value={addTitle}
                    onChange={e => setAddTitle(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Khách hàng *</label>
                    <select
                      required
                      value={addCustomerId}
                      onChange={e => setAddCustomerId(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">-- Chọn trang trại --</option>
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>{c.farm_name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Giai đoạn ban đầu</label>
                    <select
                      value={addStageId}
                      onChange={e => setAddStageId(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    >
                      {stages.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Giá trị dự kiến (₫)</label>
                    <input
                      type="number"
                      min="0"
                      value={addValue === 0 ? '' : addValue}
                      placeholder="0 ₫"
                      onChange={e => setAddValue(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md font-semibold focus:border-blue-500 focus:outline-none text-right"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Xác suất thành công (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={addProb}
                      onChange={e => setAddProb(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none text-right"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ngày chốt dự kiến</label>
                  <input
                    type="date"
                    value={addCloseDate}
                    onChange={e => setAddCloseDate(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ghi chú thêm</label>
                  <textarea
                    rows={2}
                    placeholder="Sản phẩm quan tâm, quy mô đàn, yêu cầu của chủ trại..."
                    value={addNotes}
                    onChange={e => setAddNotes(e.target.value)}
                    className="w-full p-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none"
                  />
                </div>

                <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="h-10 px-4 border border-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-10 px-5 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:opacity-50"
                  >
                    Tạo cơ hội
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 2: EDIT/DETAIL OPPORTUNITY */}
        {isEditModalOpen && editingOpp && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-200">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <div>
                  <h3 className="text-body-lg font-bold text-gray-700">Chi tiết cơ hội #{editingOpp.opp_code}</h3>
                  <span className="text-[10px] text-gray-400 font-semibold uppercase">Tạo ngày: {new Date(editingOpp.created_at).toLocaleDateString('vi-VN')}</span>
                </div>
                <button onClick={() => { setIsEditModalOpen(false); setEditingOpp(null) }} className="p-1 hover:bg-gray-100 rounded-full text-gray-400"><X size={20} /></button>
              </div>

              <form onSubmit={handleEditOpportunitySubmit} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Tiêu đề cơ hội</label>
                  <input
                    type="text"
                    required
                    value={editingOpp.title}
                    onChange={e => setEditingOpp({ ...editingOpp, title: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Khách hàng</label>
                    <select
                      required
                      value={editingOpp.customer_id}
                      onChange={e => setEditingOpp({ ...editingOpp, customer_id: e.target.value })}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    >
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>{c.farm_name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Trạng thái chung</label>
                    <select
                      value={editingOpp.status}
                      onChange={e => setEditingOpp({ ...editingOpp, status: e.target.value as any })}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    >
                      <option value="open">Đang mở (Theo đuổi)</option>
                      <option value="won">Thắng (Đã chốt hợp đồng)</option>
                      <option value="lost">Thua (Thất bại)</option>
                      <option value="abandoned">Hủy bỏ</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Giai đoạn</label>
                    <select
                      value={editingOpp.stage_id || ''}
                      onChange={e => {
                        const nextStage = stages.find(s => s.id === e.target.value)
                        setEditingOpp({
                          ...editingOpp,
                          stage_id: e.target.value,
                          win_probability: nextStage ? nextStage.win_probability : editingOpp.win_probability
                        })
                      }}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    >
                      {stages.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Người phụ trách</label>
                    <input
                      type="text"
                      disabled
                      value={editingOpp.owner?.full_name || 'Hệ thống'}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md bg-gray-50 text-gray-500 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Giá trị cơ hội (₫)</label>
                    <input
                      type="number"
                      min="0"
                      value={editingOpp.estimated_value}
                      onChange={e => setEditingOpp({ ...editingOpp, estimated_value: Math.max(0, parseFloat(e.target.value) || 0) })}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md font-semibold focus:border-blue-500 focus:outline-none text-right"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Xác suất thắng (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={editingOpp.win_probability}
                      onChange={e => setEditingOpp({ ...editingOpp, win_probability: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) })}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none text-right"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ngày chốt dự kiến</label>
                  <input
                    type="date"
                    value={editingOpp.expected_close_date || ''}
                    onChange={e => setEditingOpp({ ...editingOpp, expected_close_date: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Mô tả chi tiết / Ghi chú</label>
                  <textarea
                    rows={2}
                    value={editingOpp.notes || ''}
                    onChange={e => setEditingOpp({ ...editingOpp, notes: e.target.value })}
                    className="w-full p-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none"
                  />
                </div>

                <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => { setIsEditModalOpen(false); setEditingOpp(null) }}
                    className="h-10 px-4 border border-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-10 px-5 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:opacity-50"
                  >
                    Lưu thay đổi
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 3: CLOSE WON/LOST POPUP ON DRAG DROP */}
        {isCloseModalOpen && closeTarget && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-700 flex items-center gap-2">
                  {closeMode === 'won' ? (
                    <CheckCircle className="text-emerald-500" size={20} />
                  ) : (
                    <AlertTriangle className="text-red-500" size={20} />
                  )}
                  <span>Xác nhận đóng cơ hội</span>
                </h3>
                <button onClick={() => { setIsCloseModalOpen(false); setCloseTarget(null) }} className="p-1 hover:bg-gray-100 rounded-full text-gray-400"><X size={20} /></button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-body-md text-gray-500">
                  Bạn có chắc chắn muốn đóng cơ hội bán hàng này ở trạng thái{' '}
                  <span className={`font-bold ${closeMode === 'won' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {closeMode === 'won' ? 'Thắng (Chốt đơn)' : 'Thua'}
                  </span>
                  ?
                </p>

                {closeMode === 'lost' && (
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Lý do thua cuộc *</label>
                    <select
                      value={selectedLostReasonId}
                      onChange={e => setSelectedLostReasonId(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    >
                      {lostReasons.map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ghi chú đóng cơ hội</label>
                  <textarea
                    rows={2}
                    placeholder="Mô tả kết quả đàm phán hoặc lý do hủy bỏ..."
                    value={closeNotes}
                    onChange={e => setCloseNotes(e.target.value)}
                    className="w-full p-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none"
                  />
                </div>
              </div>

              <div className="p-6 bg-gray-25 border-t border-gray-100 flex justify-end gap-3">
                <button
                  onClick={() => { setIsCloseModalOpen(false); setCloseTarget(null) }}
                  className="h-10 px-4 border border-gray-250 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
                >
                  Hủy
                </button>
                <button
                  onClick={handleConfirmClose}
                  disabled={submitting}
                  className={`h-10 px-5 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all ${
                    closeMode === 'won' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'
                  }`}
                >
                  Xác nhận chốt
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  )
}
