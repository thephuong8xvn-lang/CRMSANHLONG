import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ChevronLeft,
  Activity,
  FileText,
  AlertTriangle,
  Clock,
  Play,
  Pause,
  XCircle,
  CheckCircle2,
  DollarSign,
  Plus,
  Trash,
  ShoppingBag,
  Star,
  Edit,
  ArrowRight,
  ChevronUp,
  ChevronDown
} from 'lucide-react'
import Layout from '../../components/Layout'
import SmartSearchSelect, { type SmartSearchOption } from '../../components/SmartSearchSelect'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAuth } from '../../contexts/AuthContext'
import HerdMembersSection from './HerdMembersSection'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Bản nháp',
  active: 'Đang hoạt động',
  on_hold: 'Tạm ngưng',
  completed: 'Đã hoàn thành',
  cancelled: 'Đã hủy'
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  active: 'bg-blue-50 text-blue-700 border-blue-150',
  on_hold: 'bg-amber-50 text-amber-700 border-amber-150',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-150',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-150'
}

const COST_TYPE_LABELS: Record<string, string> = {
  breeding_stock: 'Con giống',
  medicine: 'Thuốc/Vaccine',
  feed: 'Thức ăn',
  product: 'Vật tư',
  labor: 'Nhân công',
  other: 'Khác'
}

const COST_TYPE_COLORS: Record<string, string> = {
  breeding_stock: 'bg-amber-50 text-amber-750 border-amber-150',
  medicine: 'bg-blue-50 text-blue-750 border-blue-150',
  feed: 'bg-emerald-50 text-emerald-750 border-emerald-150',
  product: 'bg-indigo-50 text-indigo-750 border-indigo-150',
  labor: 'bg-purple-50 text-purple-750 border-purple-150',
  other: 'bg-gray-100 text-gray-750 border-gray-200'
}

interface Customer {
  id: string
  farm_name: string
  price_list_id: string | null
}

interface Herd {
  id: string
  name: string
}

interface ProjectType {
  id: string
  name: string
  code: string
}

interface Profile {
  id: string
  full_name: string
  avatar_url?: string
}

interface HerdProject {
  id: string
  project_code: string
  name: string
  status: 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled'
  start_date: string | null
  end_date: string | null
  head_count: number
  notes: string | null
  customer_id: string
  owner_user_id: string | null
  project_type_id: string | null
  region_id: string | null
  customer?: Customer | null
  herd?: Herd | null
  project_type?: ProjectType | null
  owner?: Profile | null
}

interface ProductUsed {
  product_id: string
  product_name: string
  lot_id: string
  lot_number: string
  quantity: number
  unit: string
}

interface ProjectStep {
  id: string
  step_name: string
  sort_order: number
  planned_date: string | null
  actual_date: string | null
  status: 'pending' | 'done' | 'skipped' | 'failed'
  products_used: ProductUsed[] | null
  notes: string | null
  completed_by?: string | null
  photos: string[] | null
  executor?: Profile | null
  assigned_to?: string | null
  manager_rating?: number | null
  manager_rating_note?: string | null
  customer_rating?: number | null
  customer_rating_note?: string | null
}

interface HerdCostRow {
  id: string
  project_id: string
  step_id: string | null
  cost_type: 'product' | 'feed' | 'labor' | 'medicine' | 'breeding_stock' | 'other'
  product_id: string | null
  quantity: number
  unit_cost: number
  amount: number
  incurred_date: string
  notes: string | null
  created_at: string
  product?: { name: string; unit: string } | null
}

interface ProjectOutcome {
  project_id: string
  record_date: string
  head_born: number | null
  head_weaned: number | null
  head_sold: number | null
  head_died: number
  avg_weight_kg: number | null
  revenue: number | null
  cost: number | null
  fcr: number | null
  notes: string | null // Stores JSON metadata: rating, comment, assessment, lessons, vetNotes, bento
}

interface LinkedOrder {
  id: string
  order_code: string
  grand_total: number
  status: string
  payment_status: string
  created_at: string
}

interface Product {
  id: string
  name: string
  unit: string
}

interface StockLot {
  id: string
  lot_number: string
  quantity_on_hand: number
  quantity_reserved: number
  expiry_date: string | null
  warehouse_name?: string
  cost_price?: number
}

export default function HerdProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // State
  const [project, setProject] = useState<HerdProject | null>(null)
  const [steps, setSteps] = useState<ProjectStep[]>([])
  const [outcome, setOutcome] = useState<ProjectOutcome | null>(null)
  const [linkedOrder, setLinkedOrder] = useState<LinkedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'kq-du-an' | 'chi-phi' | 'nhat-ky' | 'thanh-vien'>('kq-du-an')
  const [currentUser, setCurrentUser] = useState<any>(null)
  const { userRole, hasPermission } = useAuth()

  // New cost management and view data states
  const [costs, setCosts] = useState<HerdCostRow[]>([])
  const [vets, setVets] = useState<Profile[]>([])
  const [viewMetrics, setViewMetrics] = useState<{
    age_days: number | null
    cost_to_date: number
    died_total: number
    mortality_rate: number
    region_name: string | null
  } | null>(null)

  // Step Update Modal States
  const [activeStep, setActiveStep] = useState<ProjectStep | null>(null)
  const [stepModalOpen, setStepModalOpen] = useState(false)
  const [stepActualDate, setStepActualDate] = useState('')
  const [stepStatus, setStepStatus] = useState<'done' | 'skipped' | 'failed'>('done')
  const [stepNotes, setStepNotes] = useState('')
  const [stepPhotoUrl, setStepPhotoUrl] = useState('')
  const [stepProductsUsed, setStepProductsUsed] = useState<ProductUsed[]>([])
  const [stepAssignedTo, setStepAssignedTo] = useState('')
  const [stepManagerRating, setStepManagerRating] = useState<number>(5)
  const [stepManagerRatingNote, setStepManagerRatingNote] = useState('')
  const [stepCustomerRating, setStepCustomerRating] = useState<number>(5)
  const [stepCustomerRatingNote, setStepCustomerRatingNote] = useState('')

  // Add Manual Cost Modal States
  const [costModalOpen, setCostModalOpen] = useState(false)
  const [costIncurredDate, setCostIncurredDate] = useState('')
  const [costType, setCostType] = useState<'product' | 'feed' | 'labor' | 'medicine' | 'breeding_stock' | 'other'>('other')
  const [costProductId, setCostProductId] = useState('')
  const [costQuantity, setCostQuantity] = useState<number>(1)
  const [costUnitCost, setCostUnitCost] = useState<number>(0)
  const [costNotes, setCostNotes] = useState('')

  // Lookups for Step Modal
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [availableLots, setAvailableLots] = useState<Record<string, StockLot[]>>({}) // productId -> lots

  // Options cho SmartSearchSelect (tìm kiếm bỏ dấu, render tối đa 100 kết quả)
  const productOptions = useMemo<SmartSearchOption[]>(
    () => allProducts.map(p => ({ value: p.id, label: p.name, desc: p.unit ? `ĐVT: ${p.unit}` : undefined })),
    [allProducts]
  )

  // Outcome Modal State
  const [outcomeModalOpen, setOutcomeModalOpen] = useState(false)
  const [outDied, setOutDied] = useState<number>(0)
  const [outBorn, setOutBorn] = useState<number>(0)
  const [outWeaned, setOutWeaned] = useState<number>(0)
  const [outSold, setOutSold] = useState<number>(0)
  const [outWeight, setOutWeight] = useState<number>(0)
  const [outFcr, setOutFcr] = useState<number>(0)
  const [outRating, setOutRating] = useState<number>(5)
  const [outComment, setOutComment] = useState('')
  const [outAssessment, setOutAssessment] = useState<'excellent' | 'good' | 'average' | 'poor' | 'failed'>('good')
  const [outVetNotes, setOutVetNotes] = useState('')
  const [outLessons, setOutLessons] = useState('')
  const [outFollowup, setOutFollowup] = useState('')
  // Bento states (Tab 1 stats override) — để trống, chỉ hiện khi BSTY nhập số thật
  const [outBentoFood, setOutBentoFood] = useState('')
  const [outBentoWater, setOutBentoWater] = useState('')
  const [outBentoTemp, setOutBentoTemp] = useState('')

  // Edit Vet Note Modal State
  const [vetNoteModalOpen, setVetNoteModalOpen] = useState(false)
  const [editVetNotesText, setEditVetNotesText] = useState('')

  // Edit Project Modal State (sửa giới hạn — không đụng customer/farm/herd)
  const [projTypes, setProjTypes] = useState<{ id: string; name: string }[]>([])
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([])
  const [editProjOpen, setEditProjOpen] = useState(false)
  const [epName, setEpName] = useState('')
  const [epOwnerId, setEpOwnerId] = useState('')
  const [epTypeId, setEpTypeId] = useState('')
  const [epRegionId, setEpRegionId] = useState('')
  const [epHeadCount, setEpHeadCount] = useState<number>(0)
  const [epStartDate, setEpStartDate] = useState('')
  const [epEndDate, setEpEndDate] = useState('')
  const [epNotes, setEpNotes] = useState('')

  // Add Step Modal State
  const [addStepOpen, setAddStepOpen] = useState(false)
  const [asName, setAsName] = useState('')
  const [asPlannedDate, setAsPlannedDate] = useState('')
  const [asAssignedTo, setAsAssignedTo] = useState('')

  // Step edit-extension states (sửa tên bước + ngày kế hoạch ngay trong modal bước)
  const [stepName, setStepName] = useState('')
  const [stepPlannedDate, setStepPlannedDate] = useState('')

  const canEdit = hasPermission('herd_projects.update')
  const canDelete = hasPermission('herd_projects.delete')
  const canManageSteps = canEdit && project?.status !== 'completed' && project?.status !== 'cancelled'

  // Load Data
  const loadData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUser(user)

      // Fetch project details
      const { data: projData, error: projErr } = await supabase
        .from('herd_projects')
        .select(`
          id,
          project_code,
          name,
          status,
          start_date,
          end_date,
          head_count,
          notes,
          customer_id,
          owner_user_id,
          project_type_id,
          region_id,
          customer:customers(id, farm_name, price_list_id),
          herd:herds(id, name),
          project_type:herd_project_types(id, name, code),
          owner:profiles!owner_user_id(id, full_name, avatar_url)
        `)
        .eq('id', id)
        .single()

      if (projErr) throw projErr
      if (projData) {
        setProject(projData as unknown as HerdProject)
      }

      // Fetch steps with the new rating & assignment columns
      const { data: stepsData } = await supabase
        .from('herd_project_steps')
        .select(`
          id,
          step_name,
          sort_order,
          planned_date,
          actual_date,
          status,
          products_used,
          notes,
          completed_by,
          photos,
          executor:profiles!completed_by(id, full_name),
          assigned_to,
          manager_rating,
          manager_rating_note,
          customer_rating,
          customer_rating_note
        `)
        .eq('project_id', id)
        .order('sort_order')

      if (stepsData) {
        setSteps(stepsData as unknown as ProjectStep[])
      }

      // Fetch outcomes
      const { data: outcomeData } = await supabase
        .from('herd_project_outcomes')
        .select('*')
        .eq('project_id', id)
        .single()

      if (outcomeData) {
        setOutcome(outcomeData as unknown as ProjectOutcome)
        setOutDied(outcomeData.head_died || 0)
        setOutBorn(outcomeData.head_born || 0)
        setOutWeaned(outcomeData.head_weaned || 0)
        setOutSold(outcomeData.head_sold || 0)
        setOutWeight(Number(outcomeData.avg_weight_kg || 0))
        setOutFcr(Number(outcomeData.fcr || 0))
        try {
          const parsedNotes = JSON.parse(outcomeData.notes || '{}')
          setOutRating(parsedNotes.rating || 5)
          setOutComment(parsedNotes.comment || '')
          setOutAssessment(parsedNotes.assessment || 'good')
          setOutVetNotes(parsedNotes.vetNotes || '')
          setOutLessons(parsedNotes.lessons || '')
          setOutFollowup(parsedNotes.recommended_followup || '')
          setOutBentoFood(parsedNotes.bentoFood || '')
          setOutBentoWater(parsedNotes.bentoWater || '')
          setOutBentoTemp(parsedNotes.bentoTemp || '')
          setEditVetNotesText(parsedNotes.vetNotes || '')
        } catch {
          // fallback
          setOutRating(5)
          setOutComment(outcomeData.notes || '')
          setOutAssessment('good')
          setOutVetNotes(outcomeData.notes || '')
          setEditVetNotesText(outcomeData.notes || '')
        }
      } else {
        setOutcome(null)
      }

      // Fetch linked order
      const { data: ordersData } = await supabase
        .from('orders')
        .select('id, order_code, grand_total, status, payment_status, created_at')
        .like('notes', `%[ID: ${id}]%`)
        .limit(1)

      if (ordersData && ordersData.length > 0) {
        setLinkedOrder(ordersData[0] as LinkedOrder)
      } else {
        setLinkedOrder(null)
      }

      // Preload active products for Step Modal.
      // Dùng fetchAllRows để nạp ĐỦ catalog (>1000 SP) — tránh bị PostgREST cắt ở 1000 dòng.
      const productsData = await fetchAllRows<Product>((from, to) =>
        supabase
          .from('products')
          .select('id, name, unit')
          .eq('is_active', true)
          .order('name')
          .order('id') // khóa phụ → phân trang ổn định
          .range(from, to)
      )
      if (productsData) setAllProducts(productsData)

      // Preload active profiles/vets — nạp ĐỦ (tránh cap 1000)
      const profilesData = await fetchAllRows<Profile>((from, to) =>
        supabase.from('profiles').select('id, full_name').eq('is_active', true)
          .order('full_name', { ascending: true }).order('id').range(from, to)
      )
      if (profilesData) setVets(profilesData as Profile[])

      // Preload loại kế hoạch + khu vực (cho modal sửa dự án)
      const { data: typesData } = await supabase
        .from('herd_project_types')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
      if (typesData) setProjTypes(typesData)

      const { data: regionsData } = await supabase
        .from('herd_regions')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order')
        .order('name')
      if (regionsData) setRegions(regionsData)

      // Fetch view metrics (age_days, cost_to_date, died_total, mortality_rate, region_name)
      const { data: viewData } = await supabase
        .from('herd_project_list_view')
        .select('age_days, cost_to_date, died_total, mortality_rate, region_name')
        .eq('id', id)
        .single()
      if (viewData) {
        setViewMetrics(viewData)
      }

      // Fetch detailed costs
      const { data: costsData } = await supabase
        .from('herd_project_costs')
        .select('id, project_id, step_id, cost_type, product_id, quantity, unit_cost, amount, incurred_date, notes, created_at, product:products(name, unit)')
        .eq('project_id', id)
        .order('incurred_date', { ascending: false })
      if (costsData) {
        setCosts(costsData as unknown as HerdCostRow[])
      }

    } catch (err) {
      console.error('Error fetching project details:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Load lots for a selected product
  const loadLotsForProduct = async (productId: string) => {
    if (availableLots[productId]) return
    try {
      const { data: lotsData } = await supabase
        .from('stock_lots')
        .select(`
          id,
          lot_number,
          quantity_on_hand,
          quantity_reserved,
          expiry_date,
          cost_price,
          warehouse:warehouses(name)
        `)
        .eq('product_id', productId)
        .eq('status', 'active')
        .gt('quantity_on_hand', 0)

      if (lotsData) {
        const formattedLots = lotsData.map((lot: any) => ({
          id: lot.id,
          lot_number: lot.lot_number,
          quantity_on_hand: lot.quantity_on_hand,
          quantity_reserved: lot.quantity_reserved,
          expiry_date: lot.expiry_date,
          warehouse_name: lot.warehouse?.name,
          cost_price: lot.cost_price ? Number(lot.cost_price) : 0
        }))
        setAvailableLots(prev => ({
          ...prev,
          [productId]: formattedLots
        }))
      }
    } catch (err) {
      console.error('Error fetching stock lots:', err)
    }
  }

  // Toggle Project Status Handler
  const handleUpdateStatus = async (newStatus: 'active' | 'on_hold' | 'cancelled') => {
    if (!project) return
    const confirmMsg =
      newStatus === 'cancelled'
        ? 'Bạn có chắc chắn muốn HỦY dự án này?'
        : `Bạn muốn chuyển trạng thái dự án sang ${STATUS_LABELS[newStatus]}?`
    if (!window.confirm(confirmMsg)) return

    try {
      const { error } = await supabase
        .from('herd_projects')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', project.id)

      if (error) throw error
      loadData()
    } catch (err) {
      console.error('Error updating project status:', err)
      alert('Không thể cập nhật trạng thái dự án.')
    }
  }

  // ── Sửa dự án (giới hạn trường an toàn) ──
  const handleOpenEditProject = () => {
    if (!project) return
    setEpName(project.name)
    setEpOwnerId(project.owner_user_id || '')
    setEpTypeId(project.project_type_id || '')
    setEpRegionId(project.region_id || '')
    setEpHeadCount(project.head_count)
    setEpStartDate(project.start_date || '')
    setEpEndDate(project.end_date || '')
    setEpNotes(project.notes || '')
    setEditProjOpen(true)
  }

  const handleSaveProjectEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project) return
    if (!epName.trim() || !epOwnerId) { alert('Tên dự án và BSTY phụ trách là bắt buộc.'); return }
    if (epStartDate && epEndDate && epEndDate < epStartDate) { alert('Ngày kết thúc phải sau ngày bắt đầu.'); return }
    try {
      const { error } = await supabase
        .from('herd_projects')
        .update({
          name: epName.trim(),
          owner_user_id: epOwnerId,
          project_type_id: epTypeId || null,
          region_id: epRegionId || null,
          head_count: epHeadCount || 0,
          start_date: epStartDate || null,
          end_date: epEndDate || null,
          notes: epNotes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', project.id)
      if (error) throw error
      setEditProjOpen(false)
      loadData()
    } catch (err: any) {
      console.error('Error updating project:', err)
      alert('Không thể lưu thay đổi dự án: ' + (err?.message || 'Kiểm tra quyền chỉnh sửa.'))
    }
  }

  // ── Xóa dự án (chỉ draft/cancelled) ──
  const handleDeleteProject = async () => {
    if (!project) return
    if (project.status !== 'draft' && project.status !== 'cancelled') {
      alert('Chỉ có thể xóa dự án ở trạng thái Bản nháp hoặc Đã hủy. Dự án đang vận hành hãy dùng "Hủy dự án".')
      return
    }
    if (!window.confirm(`XÓA VĨNH VIỄN dự án "${project.name}" (${project.project_code})?\n\nToàn bộ bước lịch trình, chi phí, thành viên và kết quả của dự án sẽ bị xóa theo và KHÔNG THỂ khôi phục.`)) return
    try {
      const { error } = await supabase.from('herd_projects').delete().eq('id', project.id)
      if (error) throw error
      navigate('/herd-projects')
    } catch (err: any) {
      console.error('Error deleting project:', err)
      alert('Không thể xóa dự án: ' + (err?.message || 'Kiểm tra quyền xóa.'))
    }
  }

  // ── Thêm bước thủ công vào lịch trình ──
  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project) return
    if (!asName.trim()) { alert('Tên bước là bắt buộc.'); return }
    try {
      const maxOrder = steps.reduce((m, s) => Math.max(m, s.sort_order), 0)
      const { error } = await supabase
        .from('herd_project_steps')
        .insert({
          project_id: project.id,
          default_step_id: null,
          step_name: asName.trim(),
          sort_order: maxOrder + 1,
          planned_date: asPlannedDate || null,
          status: 'pending',
          products_used: [],
          assigned_to: asAssignedTo || null,
        })
      if (error) throw error
      setAddStepOpen(false)
      setAsName(''); setAsPlannedDate(''); setAsAssignedTo('')
      loadData()
    } catch (err: any) {
      console.error('Error adding step:', err)
      alert('Không thể thêm bước: ' + (err?.message || 'Kiểm tra quyền.'))
    }
  }

  // ── Xóa bước (dọn chi phí auto gắn bước trước) ──
  const handleDeleteStep = async (step: ProjectStep) => {
    if (!window.confirm(`Xóa bước "${step.step_name}"? Chi phí thuốc/vaccine ghi nhận tự động cho bước này (nếu có) cũng sẽ bị xóa.`)) return
    try {
      const { error: costErr } = await supabase.from('herd_project_costs').delete().eq('step_id', step.id)
      if (costErr) throw costErr
      const { error } = await supabase.from('herd_project_steps').delete().eq('id', step.id)
      if (error) throw error
      loadData()
    } catch (err: any) {
      console.error('Error deleting step:', err)
      alert('Không thể xóa bước: ' + (err?.message || 'Kiểm tra quyền.'))
    }
  }

  // ── Đổi thứ tự bước (hoán đổi sort_order với bước liền kề) ──
  const handleMoveStep = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= steps.length) return
    const a = steps[index]
    const b = steps[target]
    try {
      const { error: e1 } = await supabase.from('herd_project_steps').update({ sort_order: b.sort_order }).eq('id', a.id)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('herd_project_steps').update({ sort_order: a.sort_order }).eq('id', b.id)
      if (e2) throw e2
      loadData()
    } catch (err: any) {
      console.error('Error reordering steps:', err)
      alert('Không thể đổi thứ tự bước: ' + (err?.message || 'Kiểm tra quyền.'))
    }
  }

  // Open Step Modal Handler
  const handleOpenStepModal = (step: ProjectStep) => {
    setActiveStep(step)
    setStepName(step.step_name)
    setStepPlannedDate(step.planned_date || '')
    setStepActualDate(step.actual_date || new Date().toISOString().split('T')[0])
    setStepStatus(step.status === 'pending' ? 'done' : step.status)
    setStepNotes(step.notes || '')
    setStepPhotoUrl(step.photos && step.photos.length > 0 ? step.photos[0] : '')
    setStepProductsUsed(step.products_used || [])
    setStepAssignedTo(step.assigned_to || '')
    setStepManagerRating(step.manager_rating || 5)
    setStepManagerRatingNote(step.manager_rating_note || '')
    setStepCustomerRating(step.customer_rating || 5)
    setStepCustomerRatingNote(step.customer_rating_note || '')
    setStepModalOpen(true)

    // Preload lots for products already used in the step
    if (step.products_used) {
      step.products_used.forEach(p => {
        loadLotsForProduct(p.product_id)
      })
    }
  }

  // Add Product to Step Used List — để trống, buộc người dùng search chọn (tránh ghi nhầm SP đầu danh sách)
  const handleAddProductUsed = () => {
    setStepProductsUsed(prev => [
      ...prev,
      {
        product_id: '',
        product_name: '',
        lot_id: '',
        lot_number: '',
        quantity: 1,
        unit: ''
      }
    ])
  }

  // Remove Product from Step Used List
  const handleRemoveProductUsed = (idx: number) => {
    setStepProductsUsed(prev => prev.filter((_, i) => i !== idx))
  }

  // Update Product Record in Step Used List
  const handleUpdateProductUsed = (idx: number, field: keyof ProductUsed, value: any) => {
    setStepProductsUsed(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item
        const updated = { ...item, [field]: value }

        if (field === 'product_id') {
          const prod = allProducts.find(p => p.id === value)
          if (prod) {
            updated.product_name = prod.name
            updated.unit = prod.unit
            updated.lot_id = ''
            updated.lot_number = ''
          }
          loadLotsForProduct(value)
        } else if (field === 'lot_id') {
          const lotsList = availableLots[item.product_id] || []
          const lot = lotsList.find(l => l.id === value)
          if (lot) {
            updated.lot_number = lot.lot_number
          }
        }
        return updated
      })
    )
  }

  // Submit Step Completion Handler
  const handleSaveStepUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeStep || !project) return

    try {
      const photosArray = stepPhotoUrl.trim() ? [stepPhotoUrl.trim()] : null

      const { error } = await supabase
        .from('herd_project_steps')
        .update({
          step_name: stepName.trim() || activeStep.step_name,
          planned_date: stepPlannedDate || null,
          status: stepStatus,
          actual_date: stepStatus === 'done' ? stepActualDate : null,
          notes: stepNotes.trim() || null,
          photos: photosArray,
          completed_by: stepStatus === 'done' ? currentUser?.id : null,
          products_used: stepStatus === 'done' ? stepProductsUsed : null,
          assigned_to: stepAssignedTo || null,
          manager_rating: stepStatus === 'done' ? stepManagerRating : null,
          manager_rating_note: stepStatus === 'done' ? (stepManagerRatingNote.trim() || null) : null,
          customer_rating: stepStatus === 'done' ? stepCustomerRating : null,
          customer_rating_note: stepStatus === 'done' ? (stepCustomerRatingNote.trim() || null) : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', activeStep.id)

      if (error) throw error

      // Clean up previous costs for this step to prevent duplication or stale entries
      const { error: deleteCostErr } = await supabase
        .from('herd_project_costs')
        .delete()
        .eq('step_id', activeStep.id)
      
      if (deleteCostErr) throw deleteCostErr

      // Auto-generate costs for the used products
      if (stepStatus === 'done' && stepProductsUsed.length > 0) {
        const lotIds = stepProductsUsed.map(p => p.lot_id).filter(id => !!id)
        let lotsWithCost: any[] = []
        if (lotIds.length > 0) {
          const { data } = await supabase
            .from('stock_lots')
            .select('id, cost_price')
            .in('id', lotIds)
          if (data) lotsWithCost = data
        }

        const costRows = stepProductsUsed.map(p => {
          const lotRecord = lotsWithCost.find(l => l.id === p.lot_id)
          const unitCost = lotRecord ? Number(lotRecord.cost_price || 0) : 0
          return {
            project_id: project.id,
            step_id: activeStep.id,
            cost_type: 'medicine',
            product_id: p.product_id,
            quantity: p.quantity,
            unit_cost: unitCost,
            amount: unitCost * p.quantity,
            incurred_date: stepActualDate,
            notes: `Sử dụng thuốc/vaccine trong bước: ${activeStep.step_name}`,
            created_by: currentUser?.id
          }
        })

        if (costRows.length > 0) {
          const { error: costErr } = await supabase
            .from('herd_project_costs')
            .insert(costRows)
          if (costErr) throw costErr
        }
      }

      setStepModalOpen(false)
      loadData()
    } catch (err) {
      console.error('Error updating step details:', err)
      alert('Không thể lưu thông tin cập nhật bước.')
    }
  }

  // Save Outcome Handler
  const handleSaveOutcome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project) return

    try {
      const notesJson = JSON.stringify({
        rating: outRating,
        comment: outComment.trim(),
        assessment: outAssessment,
        vetNotes: outVetNotes.trim(),
        lessons: outLessons.trim(),
        recommended_followup: outFollowup.trim(),
        bentoFood: outBentoFood.trim(),
        bentoWater: outBentoWater.trim(),
        bentoTemp: outBentoTemp.trim()
      })

      // Upsert outcomes table (onConflict:'project_id' requires UNIQUE constraint on project_id)
      const { error: outcomeErr } = await supabase
        .from('herd_project_outcomes')
        .upsert({
          project_id: project.id,
          record_date: new Date().toISOString().split('T')[0],
          head_born: outBorn || null,
          head_weaned: outWeaned || null,
          head_sold: outSold || null,
          head_died: outDied,
          avg_weight_kg: outWeight || null,
          fcr: outFcr || null,
          notes: notesJson,
          recorded_by: currentUser?.id
        }, { onConflict: 'project_id' })

      if (outcomeErr) throw outcomeErr

      // Update project status to completed
      const { error: projErr } = await supabase
        .from('herd_projects')
        .update({
          status: 'completed',
          end_date: new Date().toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        })
        .eq('id', project.id)

      if (projErr) throw projErr

      setOutcomeModalOpen(false)
      loadData()
      alert('Dự án đã được hoàn thành và ghi nhận kết quả thành công!')
    } catch (err) {
      console.error('Error saving outcome details:', err)
      alert('Có lỗi xảy ra khi hoàn thành dự án.')
    }
  }

  // Update Vet Notes fast handler
  const handleSaveVetNotesFast = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project || !outcome) return

    try {
      let parsedNotes = {}
      try {
        parsedNotes = JSON.parse(outcome.notes || '{}')
      } catch {
        // empty
      }

      const updatedNotesJson = JSON.stringify({
        ...parsedNotes,
        vetNotes: editVetNotesText.trim()
      })

      const { error } = await supabase
        .from('herd_project_outcomes')
        .update({
          notes: updatedNotesJson
        })
        .eq('project_id', project.id)

      if (error) throw error
      setOutVetNotes(editVetNotesText)
      setVetNoteModalOpen(false)
      loadData()
    } catch (err) {
      console.error('Error updating vet notes:', err)
      alert('Không thể lưu ghi chú bác sĩ.')
    }
  }

  // Auto-generate Order from products used in steps
  const handleAutoGenerateOrder = async () => {
    if (!project) return
    if (!window.confirm('Hệ thống sẽ tổng hợp thuốc/vaccine đã sử dụng trong các bước để sinh hóa đơn bán hàng. Xác nhận tạo?')) return

    try {
      // 1. Aggregate products used from completed steps
      const aggregatedProducts: Record<string, { quantity: number; name: string; unit: string }> = {}
      steps.forEach(step => {
        if (step.status === 'done' && step.products_used) {
          step.products_used.forEach(p => {
            if (!aggregatedProducts[p.product_id]) {
              aggregatedProducts[p.product_id] = {
                quantity: 0,
                name: p.product_name,
                unit: p.unit
              }
            }
            aggregatedProducts[p.product_id].quantity += p.quantity
          })
        }
      })

      const productIds = Object.keys(aggregatedProducts)
      if (productIds.length === 0) {
        alert('Không tìm thấy loại thuốc/vaccine nào đã sử dụng trong các bước hoàn thành của dự án. Không thể sinh đơn hàng.')
        return
      }

      // 2. Fetch price list items to determine prices
      let priceListId = project.customer?.price_list_id
      if (!priceListId) {
        // Fallback to default price list
        const { data: defaultList } = await supabase
          .from('price_lists')
          .select('id')
          .eq('is_default', true)
          .single()
        if (defaultList) priceListId = defaultList.id
      }

      let priceItems: any[] = []
      if (priceListId) {
        const { data } = await supabase
          .from('price_list_items')
          .select('product_id, selling_price')
          .eq('price_list_id', priceListId)
          .in('product_id', productIds)
        if (data) priceItems = data
      }

      // 3. Create the Order lines
      let subtotal = 0
      const orderLinesToInsert = productIds.map((prodId) => {
        const item = aggregatedProducts[prodId]
        const priceRecord = priceItems.find(p => p.product_id === prodId)
        const price = priceRecord ? Number(priceRecord.selling_price) : 100000 // default fallback
        const total = price * item.quantity
        subtotal += total

        return {
          product_id: prodId,
          quantity: item.quantity,
          unit_price: price,
          discount: 0
        }
      })

      // Service fee if defined in project or outcome, let's say service fee is outcome.cost or default
      const serviceFee = outcome?.cost ? Number(outcome.cost) : 150000 // 150,000 VND default tech service fee
      const grandTotal = subtotal + serviceFee

      const noteText = `Đơn hàng được sinh tự động từ Dự án chăn nuôi [ID: ${project.id}] [Mã: ${project.project_code}]. Bao gồm tiền thuốc và phí dịch vụ thú y.`

      // Insert Order as draft first so lines are present when confirming (required for FEFO trigger)
      const { data: newOrder, error: orderErr } = await supabase
        .from('orders')
        .insert({
          customer_id: project.customer_id,
          status: 'draft',
          payment_status: 'unpaid',
          payment_method: 'bank_transfer',
          owner_user_id: project.owner?.id || currentUser?.id,
          subtotal: subtotal,
          discount_total: 0,
          shipping_fee: 0,
          grand_total: grandTotal,
          paid_amount: 0,
          notes: noteText,
          delivery_address: 'Giao tại trại'
        })
        .select()
        .single()

      if (orderErr) throw orderErr
      if (newOrder) {
        // Insert lines
        const linesToInsert = orderLinesToInsert.map(line => ({
          ...line,
          order_id: newOrder.id
        }))

        const { error: linesErr } = await supabase
          .from('order_lines')
          .insert(linesToInsert)
        
        if (linesErr) {
          await supabase.from('orders').delete().eq('id', newOrder.id)
          throw linesErr
        }

        // Confirm the order to trigger FEFO allocation (qua RPC — trạng thái đơn
        // chỉ được đổi qua RPC có kiểm quyền; giữ nguyên tổng tiền gồm phí dịch vụ).
        const { error: confirmErr } = await supabase.rpc('fn_confirm_generated_order', {
          p_order_id: newOrder.id
        })

        if (confirmErr) {
          await supabase.from('order_lines').delete().eq('order_id', newOrder.id)
          await supabase.from('orders').delete().eq('id', newOrder.id)
          throw confirmErr
        }

        // Save order ID to outcomes table under cost/revenue fields
        if (outcome) {
          await supabase
            .from('herd_project_outcomes')
            .update({
              revenue: grandTotal,
              cost: subtotal
            })
            .eq('project_id', project.id)
        }

        alert(`Đã sinh đơn hàng kỹ thuật thành công! Mã đơn: ${newOrder.order_code}`)
        loadData()
      }

    } catch (err) {
      console.error('Error auto-generating order:', err)
      alert('Đã xảy ra lỗi khi tự động tạo đơn hàng.')
    }
  }

  // Save Manual Cost Handler
  const handleSaveManualCost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project) return
    try {
      const { error } = await supabase
        .from('herd_project_costs')
        .insert({
          project_id: project.id,
          cost_type: costType,
          product_id: (costType === 'product' || costType === 'medicine') && costProductId ? costProductId : null,
          quantity: costQuantity,
          unit_cost: costUnitCost,
          amount: costQuantity * costUnitCost,
          incurred_date: costIncurredDate || new Date().toISOString().split('T')[0],
          notes: costNotes.trim() || null,
          created_by: currentUser?.id
        })

      if (error) throw error
      setCostModalOpen(false)
      // Reset form states
      setCostNotes('')
      setCostQuantity(1)
      setCostUnitCost(0)
      setCostProductId('')
      loadData()
    } catch (err) {
      console.error('Error saving manual cost:', err)
      alert('Không thể lưu chi phí mới.')
    }
  }

  // Delete Cost Handler
  const handleDeleteCost = async (costId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa khoản chi phí này?')) return
    try {
      const { error } = await supabase
        .from('herd_project_costs')
        .delete()
        .eq('id', costId)

      if (error) throw error
      loadData()
    } catch (err) {
      console.error('Error deleting cost:', err)
      alert('Không thể xóa chi phí.')
    }
  }

  // Mortality rate calculation
  const getMortalityRate = () => {
    if (!project || !outcome) return 0
    if (project.head_count === 0) return 0
    return Number(((outcome.head_died / project.head_count) * 100).toFixed(2))
  }

  // Formatting VND helper
  const formatVND = (num: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num)
  }

  // Format Date VN Helper
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    const [year, month, day] = dateStr.split('-')
    return `${day}/${month}/${year}`
  }

  if (loading) {
    return (
      <Layout activeMenu="Chăn nuôi">
        <div className="py-32 flex flex-col items-center justify-center text-gray-400">
          <div className="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
          <span>Đang tải hồ sơ dự án kỹ thuật...</span>
        </div>
      </Layout>
    )
  }

  if (!project) {
    return (
      <Layout activeMenu="Chăn nuôi">
        <div className="py-24 text-center text-gray-400">
          <AlertTriangle className="mx-auto text-gray-300 mb-4" size={64} />
          <h2 className="text-h2 font-bold text-gray-600">Dự án không tồn tại</h2>
          <p className="mt-2 text-body-md">Hồ sơ dự án có thể đã bị xóa hoặc đường dẫn không chính xác.</p>
          <button
            onClick={() => navigate('/herd-projects')}
            className="mt-6 px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors"
          >
            Quay lại danh sách
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout activeMenu="Chăn nuôi">
      <div className="p-4 md:p-10 max-w-[1600px] w-full mx-auto space-y-6">
        
        {/* Navigation & Header Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <button
              onClick={() => navigate('/herd-projects')}
              className="flex items-center gap-1.5 text-body-md text-gray-400 hover:text-blue-500 transition-colors font-semibold"
            >
              <ChevronLeft size={16} />
              Quay lại danh sách
            </button>
            <div className="flex items-center flex-wrap gap-3 mt-1">
              <h2 className="text-h1 font-bold text-gray-700">{project.name}</h2>
              <span className="px-2.5 py-0.5 bg-gray-50 border border-gray-100 text-gray-500 text-tiny font-semibold rounded-md uppercase">
                {project.project_code}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${STATUS_COLORS[project.status]}`}>
                {STATUS_LABELS[project.status]}
              </span>
            </div>
            <p className="text-body-md text-gray-400 flex flex-wrap gap-x-4 gap-y-1 items-center">
              <span>Trang trại: <strong className="text-gray-600">{project.customer?.farm_name || 'Khách lẻ'}</strong></span>
              <span>•</span>
              <span>Khu vực: <strong className="text-gray-600">{viewMetrics?.region_name || 'Chưa gán'}</strong></span>
              <span>•</span>
              <span>Quy mô: <strong className="text-gray-600">{project.head_count.toLocaleString()} con</strong></span>
              <span>•</span>
              <span>Tuổi đàn: <strong className="text-gray-600">{viewMetrics?.age_days != null ? `${viewMetrics.age_days} ngày` : 'N/A'}</strong></span>
              <span>•</span>
              <span>Chi phí: <strong className="text-gray-600 tabular-nums">{formatVND(viewMetrics?.cost_to_date || 0)}</strong></span>
              <span>•</span>
              <span>Bắt đầu: <strong className="text-gray-650">{formatDate(project.start_date)}</strong></span>
            </p>
          </div>

          {/* Header Actions */}
          <div className="flex flex-wrap gap-2">
            {canEdit && project.status !== 'cancelled' && (
              <button
                onClick={handleOpenEditProject}
                className="bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 px-4 h-10 rounded-lg font-semibold text-body-md transition-all flex items-center gap-1.5"
              >
                <Edit size={16} />
                Sửa
              </button>
            )}
            {canDelete && (project.status === 'draft' || project.status === 'cancelled') && (
              <button
                onClick={handleDeleteProject}
                className="bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100 px-4 h-10 rounded-lg font-semibold text-body-md transition-all flex items-center gap-1.5"
              >
                <Trash size={16} />
                Xóa dự án
              </button>
            )}
            {canEdit && project.status !== 'completed' && project.status !== 'cancelled' && (
              <>
              {project.status === 'draft' && (
                <button
                  onClick={() => handleUpdateStatus('active')}
                  className="bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 px-4 h-10 rounded-lg font-semibold text-body-md transition-all flex items-center gap-1.5"
                >
                  <Play size={16} />
                  Kích hoạt dự án
                </button>
              )}
              {project.status === 'active' && (
                <button
                  onClick={() => handleUpdateStatus('on_hold')}
                  className="bg-amber-50 text-amber-600 border border-amber-100 hover:bg-amber-100 px-4 h-10 rounded-lg font-semibold text-body-md transition-all flex items-center gap-1.5"
                >
                  <Pause size={16} />
                  Tạm ngưng
                </button>
              )}
              {project.status === 'on_hold' && (
                <button
                  onClick={() => handleUpdateStatus('active')}
                  className="bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 px-4 h-10 rounded-lg font-semibold text-body-md transition-all flex items-center gap-1.5"
                >
                  <Play size={16} />
                  Tiếp tục thực hiện
                </button>
              )}
              <button
                onClick={() => handleUpdateStatus('cancelled')}
                className="bg-red-50 text-danger-500 border border-red-100 hover:bg-red-100 px-4 h-10 rounded-lg font-semibold text-body-md transition-all flex items-center gap-1.5"
              >
                <XCircle size={16} />
                Hủy dự án
              </button>
              <button
                onClick={() => {
                  setOutDied(0)
                  setOutBorn(0)
                  setOutWeight(0)
                  setOutFcr(0)
                  setOutComment('')
                  setOutRating(5)
                  setOutAssessment('good')
                  setOutVetNotes('')
                  setOutcomeModalOpen(true)
                }}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 h-10 rounded-lg font-semibold text-body-md shadow-sm transition-all flex items-center gap-1.5"
              >
                <CheckCircle2 size={16} />
                Hoàn thành dự án
              </button>
              </>
            )}
          </div>
        </div>

        {/* 2-Columns Layout Grid */}
        <div className="grid grid-cols-12 gap-8">
          
          {/* LEFT COLUMN: Checklist Stepper (col-span-5) */}
          <div className="col-span-12 lg:col-span-5 space-y-6">
            <div className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6 border-b border-gray-55 pb-3">
                <h2 className="text-body-lg font-bold text-gray-700 flex items-center gap-2">
                  <Activity className="text-blue-500" size={18} />
                  Lịch trình Kỹ thuật Thú y
                </h2>
                {canManageSteps && (
                  <button
                    onClick={() => { setAsName(''); setAsPlannedDate(''); setAsAssignedTo(''); setAddStepOpen(true) }}
                    className="text-tiny font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 transition-all flex items-center gap-1"
                  >
                    <Plus size={13} /> Thêm bước
                  </button>
                )}
              </div>

              {steps.length === 0 ? (
                <div className="text-center py-6 space-y-3">
                  <p className="text-body-md text-gray-400 italic">
                    Chưa khởi tạo lịch trình các bước cho dự án này.
                  </p>
                  {canManageSteps && (
                    <button
                      onClick={() => { setAsName(''); setAsPlannedDate(''); setAsAssignedTo(''); setAddStepOpen(true) }}
                      className="text-tiny font-bold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-all inline-flex items-center gap-1"
                    >
                      <Plus size={13} /> Thêm bước đầu tiên
                    </button>
                  )}
                </div>
              ) : (
                <div className="relative pl-2 space-y-8">
                  {/* Stepper Vertical Line */}
                  <div className="absolute left-5 top-2 bottom-2 w-[2px] bg-gray-100"></div>

                  {steps.map((step, idx) => {
                    const isStepDone = step.status === 'done'
                    const isStepSkipped = step.status === 'skipped'
                    const isStepFailed = step.status === 'failed'
                    
                    let statusBadgeClass = 'bg-gray-100 text-gray-500 border-gray-200'
                    let statusText = 'Đang chờ'
                    let StepBadgeIcon = Clock

                    if (isStepDone) {
                      statusBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      statusText = 'Hoàn thành'
                      StepBadgeIcon = CheckCircle2
                    } else if (isStepSkipped) {
                      statusBadgeClass = 'bg-amber-50 text-amber-700 border-amber-100'
                      statusText = 'Bỏ qua'
                      StepBadgeIcon = AlertTriangle
                    } else if (isStepFailed) {
                      statusBadgeClass = 'bg-rose-50 text-rose-700 border-rose-100'
                      statusText = 'Thất bại'
                      StepBadgeIcon = XCircle
                    }

                    return (
                      <div key={step.id} className="relative flex items-start group">
                        {/* Bullet Icon */}
                        <div className={`absolute left-0 z-10 flex items-center justify-center w-6 h-6 rounded-full mt-1 translate-x-0.5 border ${
                          isStepDone
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : isStepSkipped
                            ? 'bg-amber-500 border-amber-500 text-white'
                            : isStepFailed
                            ? 'bg-rose-500 border-rose-500 text-white'
                            : 'bg-gray-0 border-gray-300 text-gray-400'
                        }`}>
                          <StepBadgeIcon size={12} strokeWidth={2.5} />
                        </div>

                        {/* Step Details Box */}
                        <div className="ml-10 w-full space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className={`font-bold text-body-md ${isStepDone ? 'text-gray-700' : 'text-gray-500'}`}>
                                {idx + 1}. {step.step_name}
                              </h3>
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                Kế hoạch: {formatDate(step.planned_date)}
                                {isStepDone && step.actual_date && (
                                  <> • Thực tế: <strong className="text-gray-500">{formatDate(step.actual_date)}</strong></>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className={`px-2 py-0.5 border text-[10px] font-bold rounded ${statusBadgeClass}`}>
                                {statusText}
                              </span>
                              {canManageSteps && (
                                <div className="flex items-center">
                                  <button onClick={() => handleMoveStep(idx, -1)} disabled={idx === 0} title="Lên"
                                    className="p-0.5 text-gray-300 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-gray-300">
                                    <ChevronUp size={14} />
                                  </button>
                                  <button onClick={() => handleMoveStep(idx, 1)} disabled={idx === steps.length - 1} title="Xuống"
                                    className="p-0.5 text-gray-300 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-gray-300">
                                    <ChevronDown size={14} />
                                  </button>
                                  <button onClick={() => handleDeleteStep(step)} title="Xóa bước"
                                    className="p-0.5 text-gray-300 hover:text-rose-500">
                                    <Trash size={13} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Notes & Products Used */}
                          {(step.notes || (step.products_used && step.products_used.length > 0)) && (
                            <div className="bg-gray-25 p-3 rounded-lg border border-gray-100/50 space-y-2 text-body-md text-gray-500">
                              {step.notes && <p className="italic text-gray-600">“{step.notes}”</p>}
                              
                              {step.products_used && step.products_used.length > 0 && (
                                <div className="space-y-1">
                                  <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Vật tư sử dụng:</p>
                                  <ul className="text-tiny space-y-0.5 font-medium text-gray-600">
                                    {step.products_used.map((pu, pidx) => (
                                      <li key={pidx} className="flex justify-between border-b border-dashed border-gray-100 pb-0.5 last:border-b-0">
                                        <span>• {pu.product_name} ({pu.lot_number})</span>
                                        <span>x{pu.quantity} {pu.unit}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Photos */}
                          {step.photos && step.photos.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto tbl-x py-1">
                              {step.photos.map((photo, pidx) => (
                                <div key={pidx} className="w-20 h-20 rounded-lg border border-gray-150 overflow-hidden relative group/img cursor-zoom-in flex-shrink-0">
                                  <img src={photo} alt="Step evidence" className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/10 group-hover/img:bg-transparent transition-colors"></div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Executor and Assigned user info */}
                          {(step.assigned_to || (isStepDone && step.executor?.full_name)) && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-tiny text-gray-400 font-medium">
                              {step.assigned_to && (
                                <span>Giao cho: <strong className="text-gray-500">{vets.find(v => v.id === step.assigned_to)?.full_name || 'N/A'}</strong></span>
                              )}
                              {isStepDone && step.executor?.full_name && (
                                <span>Thực hiện: <strong className="text-gray-500">{step.executor.full_name}</strong></span>
                              )}
                            </div>
                          )}

                          {/* Ratings for completed step */}
                          {isStepDone && (step.manager_rating || step.customer_rating) && (
                            <div className="bg-amber-50/10 border border-amber-100/50 rounded-lg p-2.5 space-y-1.5 text-tiny text-gray-500">
                              {step.manager_rating && (
                                <div className="flex items-start gap-1.5 flex-wrap">
                                  <span className="font-semibold text-gray-400">Đánh giá QL:</span>
                                  <div className="flex text-amber-400 mt-0.5">
                                    {[...Array(5)].map((_, i) => (
                                      <Star key={i} size={10} fill={i < (step.manager_rating || 0) ? '#f59e0b' : 'none'} className={i < (step.manager_rating || 0) ? 'text-amber-450' : 'text-gray-300'} />
                                    ))}
                                  </div>
                                  {step.manager_rating_note && <span className="italic text-gray-500">"{step.manager_rating_note}"</span>}
                                </div>
                              )}
                              {step.customer_rating && (
                                <div className="flex items-start gap-1.5 flex-wrap">
                                  <span className="font-semibold text-gray-400">Đánh giá KH:</span>
                                  <div className="flex text-amber-400 mt-0.5">
                                    {[...Array(5)].map((_, i) => (
                                      <Star key={i} size={10} fill={i < (step.customer_rating || 0) ? '#f59e0b' : 'none'} className={i < (step.customer_rating || 0) ? 'text-amber-450' : 'text-gray-300'} />
                                    ))}
                                  </div>
                                  {step.customer_rating_note && <span className="italic text-gray-500">"{step.customer_rating_note}"</span>}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Action Button for Steps */}
                          {canManageSteps && (
                            <button
                              onClick={() => handleOpenStepModal(step)}
                              className="text-tiny font-bold text-blue-500 bg-blue-50 border border-blue-100 px-3 py-1 rounded hover:bg-blue-100 transition-all flex items-center gap-1 w-fit mt-1"
                            >
                              {isStepDone ? 'Chỉnh sửa bước này' : 'Thực hiện / Cập nhật bước'}
                              <ArrowRight size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Results & Details Tabs (col-span-7) */}
          <div className="col-span-12 lg:col-span-7 space-y-6">
            <div className="bg-gray-0 border border-gray-100 rounded-xl overflow-hidden shadow-sm flex flex-col min-h-[500px]">
              
              {/* Premium Tabs Header */}
              <div className="flex border-b border-gray-100 bg-gray-25 px-6">
                <button
                  onClick={() => setActiveTab('kq-du-an')}
                  className={`px-5 py-4 font-bold text-body-md relative transition-all ${
                    activeTab === 'kq-du-an'
                      ? 'text-blue-500 border-b-2 border-blue-500'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Kết quả dự án
                </button>
                <button
                  onClick={() => setActiveTab('chi-phi')}
                  className={`px-5 py-4 font-bold text-body-md relative transition-all ${
                    activeTab === 'chi-phi'
                      ? 'text-blue-500 border-b-2 border-blue-500'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Chi phí &amp; Lợi nhuận
                </button>
                <button
                  onClick={() => setActiveTab('nhat-ky')}
                  className={`px-5 py-4 font-bold text-body-md relative transition-all ${
                    activeTab === 'nhat-ky'
                      ? 'text-blue-500 border-b-2 border-blue-500'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Nhật ký trang trại
                </button>
                <button
                  onClick={() => setActiveTab('thanh-vien')}
                  className={`px-5 py-4 font-bold text-body-md relative transition-all ${
                    activeTab === 'thanh-vien'
                      ? 'text-blue-500 border-b-2 border-blue-500'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Thành viên
                </button>
              </div>

              {/* Tab Contents */}
              <div className="p-6 md:p-8 flex-1 flex flex-col">
                
                {/* TAB 1: KẾT QUẢ DỰ ÁN */}
                {activeTab === 'kq-du-an' && (
                  <div className="space-y-6 flex-1 flex flex-col justify-between">
                    {/* Top Metrics Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Customer Review (Star rating) */}
                      <div className="bg-gray-25 border border-gray-100 rounded-xl p-5 flex flex-col items-center justify-center text-center shadow-inner">
                        <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-2">Đánh giá từ khách hàng</p>
                        {outcome ? (
                          <>
                            <div className="flex text-amber-400 mb-2">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  size={24}
                                  fill={i < outRating ? '#f59e0b' : 'none'}
                                  className={i < outRating ? 'text-amber-400' : 'text-gray-300'}
                                />
                              ))}
                            </div>
                            <p className="text-h2 font-bold text-gray-700">{outRating.toFixed(1)} <span className="text-body-md text-gray-400 font-normal">/ 5</span></p>
                            <p className="text-tiny text-emerald-600 font-medium italic mt-2 max-w-[220px] truncate-3-lines">
                              "{outComment || 'Khách hàng rất hài lòng về dịch vụ!'}"
                            </p>
                          </>
                        ) : (
                          <div className="text-center py-4 text-gray-400 text-body-md">
                            <Clock className="mx-auto text-gray-300 mb-1" size={32} />
                            <span>Đang chờ hoàn thành dự án để nhận đánh giá.</span>
                          </div>
                        )}
                      </div>

                      {/* Mortality Calculator (số liệu thật) */}
                      <div className="bg-gray-25 border border-gray-100 rounded-xl p-5 shadow-inner flex flex-col justify-center">
                        <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider text-center mb-3">Tỷ lệ hao hụt (Mortality)</p>

                        {outcome ? (
                          <div className="space-y-2.5">
                            <div className="text-center">
                              <p className={`text-h1 font-bold tabular-nums ${getMortalityRate() > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {getMortalityRate()}%
                              </p>
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                {outcome.head_died.toLocaleString('vi-VN')} / {project.head_count.toLocaleString('vi-VN')} con hao hụt
                              </p>
                            </div>
                            <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden ring-1 ring-gray-100">
                              <div
                                className={`h-full transition-all duration-500 ${getMortalityRate() > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(100, getMortalityRate())}%` }}
                              ></div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-3 text-gray-400 text-body-md">
                            <Clock className="mx-auto text-gray-300 mb-1" size={28} />
                            <span>Chưa ghi nhận số liệu hao hụt.</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Vet Notes block */}
                    <div className="bg-blue-50/20 border border-blue-100/50 rounded-xl p-5 space-y-3">
                      <div className="flex justify-between items-center">
                        <h4 className="font-bold text-body-md text-blue-700 flex items-center gap-1.5">
                          <FileText size={16} />
                          Ghi chú kỹ thuật từ Bác sĩ
                        </h4>
                        {outcome && (
                          <button
                            onClick={() => {
                              setEditVetNotesText(outVetNotes)
                              setVetNoteModalOpen(true)
                            }}
                            className="text-tiny font-bold text-blue-500 hover:underline flex items-center gap-0.5"
                          >
                            Chỉnh sửa
                            <Edit size={12} />
                          </button>
                        )}
                      </div>
                      <div className="bg-gray-0 border border-gray-150 p-4 rounded-lg min-h-[90px] shadow-sm text-body-md text-gray-600 leading-relaxed">
                        {outVetNotes ? (
                          <p>{outVetNotes}</p>
                        ) : (
                          <p className="text-gray-400 italic text-center py-4">Chưa có ghi chú tổng hợp từ Bác sĩ thú y.</p>
                        )}
                      </div>
                    </div>

                    {/* Quick Stats Bento (Food, Water, Temp) */}
                    <div className="grid grid-cols-3 gap-4 mt-2">
                      <div className="bg-gray-25 border border-gray-100 p-3.5 rounded-xl text-center shadow-sm">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Thức ăn tiêu thụ</p>
                        <p className="text-body-lg font-bold text-blue-700 mt-1">{outBentoFood || '—'}</p>
                      </div>
                      <div className="bg-gray-25 border border-gray-100 p-3.5 rounded-xl text-center shadow-sm">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lượng nước tiêu thụ</p>
                        <p className="text-body-lg font-bold text-blue-700 mt-1">{outBentoWater || '—'}</p>
                      </div>
                      <div className="bg-gray-25 border border-gray-100 p-3.5 rounded-xl text-center shadow-sm">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Nhiệt độ TB chuồng</p>
                        <p className="text-body-lg font-bold text-blue-700 mt-1">{outBentoTemp || '—'}</p>
                      </div>
                    </div>

                  </div>
                )}

                {/* TAB 2: CHI PHÍ & LỢI NHUẬN */}
                {activeTab === 'chi-phi' && (
                  <div className="space-y-6 flex-1 flex flex-col justify-start">
                    {/* Cost & Revenue summary cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Total Cost */}
                      <div className="bg-gray-25 border border-gray-100 p-5 rounded-xl shadow-sm space-y-1">
                        <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Tổng chi phí</p>
                        <p className="text-h2 font-bold text-rose-600 tabular-nums">
                          {formatVND(costs.reduce((sum, c) => sum + Number(c.amount || 0), 0))}
                        </p>
                        <p className="text-[11px] text-gray-400">Tất cả chi phí đã phát sinh</p>
                      </div>

                      {/* Total Revenue */}
                      <div className="bg-gray-25 border border-gray-100 p-5 rounded-xl shadow-sm space-y-1">
                        <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Doanh thu kỹ thuật</p>
                        <p className="text-h2 font-bold text-emerald-600 tabular-nums">
                          {formatVND(outcome?.revenue || linkedOrder?.grand_total || 0)}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {linkedOrder ? `Hóa đơn: ${linkedOrder.order_code}` : 'Chưa ghi nhận doanh thu'}
                        </p>
                      </div>

                      {/* Profit */}
                      {(() => {
                        const totalCost = costs.reduce((sum, c) => sum + Number(c.amount || 0), 0)
                        const revenue = outcome?.revenue || linkedOrder?.grand_total || 0
                        const profit = revenue - totalCost
                        const isProfit = profit >= 0
                        return (
                          <div className={`border p-5 rounded-xl shadow-sm space-y-1 ${
                            isProfit ? 'bg-emerald-50/15 border-emerald-100' : 'bg-rose-50/15 border-rose-100'
                          }`}>
                            <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Lợi nhuận ròng</p>
                            <p className={`text-h2 font-bold tabular-nums ${isProfit ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {formatVND(profit)}
                            </p>
                            <p className="text-[11px] text-gray-400">Doanh thu trừ chi phí</p>
                          </div>
                        )
                      })()}
                    </div>

                    {/* Quick actions row */}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4">
                      <h3 className="font-bold text-body-lg text-gray-700">Chi tiết bảng kê chi phí</h3>
                      
                      <div className="flex gap-2">
                        {canEdit && project.status === 'completed' && !linkedOrder && (
                          <button
                            onClick={handleAutoGenerateOrder}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-tiny px-3.5 h-9 rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                          >
                            <ShoppingBag size={14} />
                            Sinh hóa đơn tự động
                          </button>
                        )}
                        {(userRole?.code === 'admin' || hasPermission('herd_projects.update')) && (
                          <button
                            onClick={() => {
                              setCostIncurredDate(new Date().toISOString().split('T')[0])
                              setCostType('other')
                              setCostProductId('')
                              setCostQuantity(1)
                              setCostUnitCost(0)
                              setCostNotes('')
                              setCostModalOpen(true)
                            }}
                            className="bg-blue-500 hover:bg-blue-600 text-white font-semibold text-tiny px-3.5 h-9 rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                          >
                            <Plus size={14} />
                            Ghi nhận chi phí
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Cost Table list */}
                    {costs.length === 0 ? (
                      <div className="text-center py-12 text-gray-400 italic">
                        Chưa ghi nhận chi phí nào cho dự án này.
                      </div>
                    ) : (
                      <div className="overflow-x-auto tbl-x border border-gray-150 rounded-xl bg-gray-0 shadow-sm">
                        <table className="w-full text-left border-collapse text-body-md">
                          <thead>
                            <tr className="bg-gray-25 text-gray-400 font-bold border-b border-gray-150 uppercase tracking-wider text-[10px]">
                              <th className="px-4 py-3">Ngày phát sinh</th>
                              <th className="px-4 py-3">Loại chi phí</th>
                              <th className="px-4 py-3">Chi tiết / Sản phẩm</th>
                              <th className="px-4 py-3 text-right">Số lượng</th>
                              <th className="px-4 py-3 text-right">Đơn giá</th>
                              <th className="px-4 py-3 text-right">Thành tiền</th>
                              <th className="px-4 py-3">Ghi chú</th>
                              <th className="px-4 py-3 text-center">Tác vụ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                            {costs.map(c => (
                              <tr key={c.id} className="hover:bg-gray-25/40 transition-colors">
                                <td className="px-4 py-3 text-gray-500">{formatDate(c.incurred_date)}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 border text-[10px] font-bold rounded-md uppercase ${
                                    COST_TYPE_COLORS[c.cost_type] || 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {COST_TYPE_LABELS[c.cost_type] || c.cost_type}
                                  </span>
                                </td>
                                <td className="px-4 py-3 max-w-[200px] truncate">
                                  {c.product?.name ? (
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-gray-800">{c.product.name}</span>
                                      <span className="text-[10px] text-gray-400 font-normal">Vật tư dùng ở bước</span>
                                    </div>
                                  ) : (
                                    <span className="text-gray-500">{COST_TYPE_LABELS[c.cost_type]}</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  {Number(c.quantity).toLocaleString()} {c.product?.unit || ''}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">{formatVND(c.unit_cost)}</td>
                                <td className="px-4 py-3 text-right font-bold text-gray-800 tabular-nums">
                                  {formatVND(c.amount)}
                                </td>
                                <td className="px-4 py-3 text-gray-500 max-w-[220px] truncate" title={c.notes || ''}>
                                  {c.notes || '—'}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {c.step_id ? (
                                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded cursor-not-allowed" title="Chi phí này tự động phát sinh từ việc hoàn thành bước kỹ thuật">
                                      Tự động
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => handleDeleteCost(c.id)}
                                      className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                                      title="Xóa chi phí thủ công"
                                    >
                                      <Trash size={15} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Linked Order info box */}
                    {linkedOrder && (
                      <div className="bg-emerald-50/20 border border-emerald-100 rounded-xl p-5 space-y-3 mt-4">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-tiny font-bold text-emerald-700 uppercase tracking-wider">Đơn hàng liên kết phát sinh doanh thu</p>
                            <Link
                              to={`/orders/${linkedOrder.id}`}
                              className="text-body-lg font-bold text-blue-500 hover:underline flex items-center gap-1 mt-0.5"
                            >
                              {linkedOrder.order_code}
                              <ArrowRight size={14} />
                            </Link>
                          </div>
                          <span className="px-3 py-1 bg-emerald-500 text-white text-tiny font-bold rounded-lg uppercase shadow-sm">
                            {linkedOrder.status === 'completed' ? 'Hoàn tất' : 'Đã xác nhận'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 border-t border-emerald-50 pt-3 text-body-md text-gray-600">
                          <div>
                            <span className="text-gray-400">Trị giá đơn hàng:</span>
                            <p className="font-bold text-gray-700 text-body-lg mt-0.5">{formatVND(linkedOrder.grand_total)}</p>
                          </div>
                          <div>
                            <span className="text-gray-400">Trạng thái thanh toán:</span>
                            <p className={`font-semibold text-body-md mt-0.5 ${
                              linkedOrder.payment_status === 'paid' ? 'text-emerald-600' : 'text-rose-500'
                            }`}>
                              {linkedOrder.payment_status === 'paid' ? 'Đã thu tiền' : 'Ghi nhận công nợ'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: NHẬT KÝ TRANG TRẠI */}
                {activeTab === 'nhat-ky' && (
                  <div className="space-y-6 flex-1">
                    <h3 className="font-bold text-body-lg text-gray-700 flex items-center gap-2 border-b border-gray-55 pb-3">
                      <Clock size={18} className="text-blue-500" />
                      Lịch sử hoạt động tại trang trại
                    </h3>

                    <div className="relative pl-6 space-y-6">
                      <div className="absolute left-2 top-2 bottom-2 w-[1px] bg-gray-150"></div>

                      {/* Log: Outcome Completed */}
                      {outcome && (
                        <div className="relative flex items-start">
                          <div className="absolute -left-6 z-10 w-3 h-3 rounded-full bg-emerald-500 border-2 border-gray-0 mt-1"></div>
                          <div className="space-y-0.5">
                            <p className="text-body-md font-bold text-gray-700">Hoàn thành dự án &amp; đánh giá kết quả</p>
                            <p className="text-tiny text-gray-400">
                              Ngày {formatDate(outcome.record_date)} • Thực hiện bởi BSTY
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Log: Steps Completed */}
                      {steps.filter(s => s.status === 'done').map(step => (
                        <div key={step.id} className="relative flex items-start">
                          <div className="absolute -left-6 z-10 w-3 h-3 rounded-full bg-blue-500 border-2 border-gray-0 mt-1"></div>
                          <div className="space-y-0.5">
                            <p className="text-body-md font-semibold text-gray-700">Hoàn thành bước: {step.step_name}</p>
                            <p className="text-tiny text-gray-450">
                              Thực tế tiêm ngày: {formatDate(step.actual_date)} {step.executor?.full_name && `• BSTY: ${step.executor.full_name}`}
                            </p>
                          </div>
                        </div>
                      ))}

                      {/* Log: Project Created */}
                      <div className="relative flex items-start">
                        <div className="absolute -left-6 z-10 w-3 h-3 rounded-full bg-gray-400 border-2 border-gray-0 mt-1"></div>
                        <div className="space-y-0.5">
                          <p className="text-body-md font-medium text-gray-500">Khởi tạo hồ sơ dự án chăn nuôi</p>
                          <p className="text-tiny text-gray-400">Ngày {formatDate(project.start_date)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 4: THÀNH VIÊN */}
                {activeTab === 'thanh-vien' && (
                  <div className="flex-1">
                    <HerdMembersSection
                      projectId={project.id}
                      ownerName={project.owner?.full_name}
                      canManage={
                        project.owner?.id === currentUser?.id ||
                        userRole?.code === 'admin' ||
                        hasPermission('herd_projects.manage_members')
                      }
                    />
                  </div>
                )}

              </div>
            </div>
          </div>

        </div>

      </div>

      {/* ─────────────────────────────────────────────────────────────
          MODAL: THỰC HIỆN BƯỚC / CẬP NHẬT TIẾN ĐỘ STEP
          ───────────────────────────────────────────────────────────── */}
      {stepModalOpen && activeStep && (
        <div className="fixed inset-0 bg-gray-750/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-0 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl animate-in fade-in duration-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-gray-25 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-body-lg text-gray-700">Cập nhật bước: {activeStep.step_name}</h3>
              <button onClick={() => setStepModalOpen(false)} className="text-gray-400 hover:text-gray-600 font-bold text-body-lg">✕</button>
            </div>

            <form onSubmit={handleSaveStepUpdate} className="p-6 space-y-4 overflow-y-auto">
              {/* Tên bước + Ngày kế hoạch (sửa được trực tiếp) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Tên bước</label>
                  <input
                    type="text"
                    value={stepName}
                    onChange={e => setStepName(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ngày kế hoạch</label>
                  <input
                    type="date"
                    value={stepPlannedDate}
                    onChange={e => setStepPlannedDate(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Actual Date */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ngày thực hiện</label>
                  <input
                    type="date"
                    value={stepActualDate}
                    onChange={e => setStepActualDate(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>

                {/* Status Selection */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Trạng thái bước</label>
                  <select
                    value={stepStatus}
                    onChange={e => setStepStatus(e.target.value as any)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  >
                    <option value="done">Hoàn thành (Done)</option>
                    <option value="skipped">Bỏ qua (Skipped)</option>
                    <option value="failed">Thất bại (Failed)</option>
                  </select>
                </div>
              </div>

              {/* Assigned To selection */}
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Người được giao thực hiện</label>
                <select
                  value={stepAssignedTo}
                  onChange={e => setStepAssignedTo(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                >
                  <option value="">-- Chưa gán người thực hiện --</option>
                  {vets.map(v => (
                    <option key={v.id} value={v.id}>{v.full_name}</option>
                  ))}
                </select>
              </div>

              {/* Step Notes */}
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ghi chú chi tiết</label>
                <textarea
                  placeholder="Ghi nhận phản ứng thuốc của đàn hoặc các kỹ thuật đặc biệt..."
                  value={stepNotes}
                  onChange={e => setStepNotes(e.target.value)}
                  rows={2}
                  className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none placeholder-gray-400"
                />
              </div>

              {/* Photo Evidence URL */}
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">URL Hình ảnh minh chứng (ở trại)</label>
                <input
                  type="text"
                  placeholder="Dán link ảnh vaccine hoặc hoạt động tại trại..."
                  value={stepPhotoUrl}
                  onChange={e => setStepPhotoUrl(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none placeholder-gray-400"
                />
              </div>

              {/* Rating columns for QL and KH */}
              {stepStatus === 'done' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-100 pt-3">
                  {/* Manager Rating */}
                  <div className="space-y-1.5 bg-gray-25/50 border border-gray-100 p-3 rounded-xl shadow-sm">
                    <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Đánh giá của Quản lý</label>
                    <div className="flex gap-1 text-gray-300">
                      {[1, 2, 3, 4, 5].map(num => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setStepManagerRating(num)}
                          className="focus:outline-none"
                        >
                          <Star
                            size={20}
                            fill={num <= stepManagerRating ? '#f59e0b' : 'none'}
                            className={num <= stepManagerRating ? 'text-amber-400' : 'text-gray-300'}
                          />
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Ý kiến đánh giá của Quản lý..."
                      value={stepManagerRatingNote}
                      onChange={e => setStepManagerRatingNote(e.target.value)}
                      className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Customer Rating */}
                  <div className="space-y-1.5 bg-gray-25/50 border border-gray-100 p-3 rounded-xl shadow-sm">
                    <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Đánh giá của Khách hàng</label>
                    <div className="flex gap-1 text-gray-300">
                      {[1, 2, 3, 4, 5].map(num => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setStepCustomerRating(num)}
                          className="focus:outline-none"
                        >
                          <Star
                            size={20}
                            fill={num <= stepCustomerRating ? '#f59e0b' : 'none'}
                            className={num <= stepCustomerRating ? 'text-amber-400' : 'text-gray-300'}
                          />
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Nhận xét từ Khách hàng..."
                      value={stepCustomerRatingNote}
                      onChange={e => setStepCustomerRatingNote(e.target.value)}
                      className="w-full h-9 px-2.5 bg-white border border-gray-200 rounded-lg text-tiny focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Dynamic Products Used list */}
              {stepStatus === 'done' && (
                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                    <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Vật tư sử dụng trong bước</span>
                    <button
                      type="button"
                      onClick={handleAddProductUsed}
                      className="text-tiny font-bold text-blue-500 hover:underline flex items-center gap-0.5"
                    >
                      <Plus size={14} /> Thêm thuốc dùng
                    </button>
                  </div>

                  {stepProductsUsed.length === 0 ? (
                    <p className="text-tiny text-gray-400 italic text-center py-2">Chưa thêm vật tư nào.</p>
                  ) : (
                    <div className="space-y-3 max-h-40 overflow-y-auto pr-1">
                      {stepProductsUsed.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-end bg-gray-25 p-3 rounded-lg border border-gray-150 relative group">
                          {/* Product select — tìm kiếm thông minh */}
                          <div className="flex-1 space-y-1 min-w-0">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Thuốc / Vaccine</label>
                            <SmartSearchSelect
                              options={productOptions}
                              value={item.product_id}
                              onChange={val => handleUpdateProductUsed(idx, 'product_id', val)}
                              placeholder="-- Chọn thuốc --"
                              searchPlaceholder="Tìm thuốc / vaccine..."
                              required
                            />
                          </div>

                          {/* Lot select */}
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Chọn lô kho khả dụng</label>
                            <select
                              value={item.lot_id}
                              onChange={e => handleUpdateProductUsed(idx, 'lot_id', e.target.value)}
                              className="w-full h-9 px-2 bg-gray-0 border border-gray-200 rounded text-tiny"
                              required
                            >
                              <option value="">-- Chọn lô --</option>
                              {(availableLots[item.product_id] || []).map(lot => (
                                <option key={lot.id} value={lot.id}>
                                  {lot.lot_number} (Tồn: {lot.quantity_on_hand - lot.quantity_reserved} {item.unit})
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Quantity */}
                          <div className="w-20 space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Số lượng</label>
                            <input
                              type="number"
                              min={1}
                              value={item.quantity || ''}
                              onChange={e => handleUpdateProductUsed(idx, 'quantity', Number(e.target.value))}
                              className="w-full h-9 px-2 bg-gray-0 border border-gray-200 rounded text-tiny"
                              required
                            />
                          </div>

                          {/* Delete Row button */}
                          <button
                            type="button"
                            onClick={() => handleRemoveProductUsed(idx)}
                            className="p-2 text-gray-400 hover:text-rose-500 transition-colors self-center mt-4"
                          >
                            <Trash size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setStepModalOpen(false)}
                  className="px-4 py-2 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-500 hover:bg-gray-55"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-500 text-white font-semibold rounded-lg text-body-md hover:bg-blue-600 shadow-sm"
                >
                  Lưu cập nhật
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: HOÀN THÀNH DỰ ÁN & ĐÁNH GIÁ KẾT QUẢ OUTCOME
          ───────────────────────────────────────────────────────────── */}
      {outcomeModalOpen && (
        <div className="fixed inset-0 bg-gray-750/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-0 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-gray-25 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-body-lg text-gray-700">Đánh giá &amp; Hoàn thành dự án</h3>
              <button onClick={() => setOutcomeModalOpen(false)} className="text-gray-400 hover:text-gray-600 font-bold text-body-lg">✕</button>
            </div>

            <form onSubmit={handleSaveOutcome} className="p-6 space-y-4 overflow-y-auto">
              
              <div className="grid grid-cols-2 gap-4">
                {/* Died count */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Số con chết (Hao hụt)</label>
                  <input
                    type="number"
                    min={0}
                    value={outDied}
                    onChange={e => setOutDied(Number(e.target.value))}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>

                {/* Average weight */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Trọng lượng trung bình (kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={outWeight || ''}
                    onChange={e => setOutWeight(Number(e.target.value))}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* FCR */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Hệ số chuyển đổi thức ăn (FCR)</label>
                  <input
                    type="number"
                    step="0.001"
                    min={0}
                    value={outFcr || ''}
                    onChange={e => setOutFcr(Number(e.target.value))}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Assessment */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Đánh giá chung hiệu quả</label>
                  <select
                    value={outAssessment}
                    onChange={e => setOutAssessment(e.target.value as any)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  >
                    <option value="excellent">Xuất sắc (Excellent)</option>
                    <option value="good">Tốt (Good)</option>
                    <option value="average">Trung bình (Average)</option>
                    <option value="poor">Kém (Poor)</option>
                    <option value="failed">Thất bại (Failed)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {/* Born */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase block">Số con sinh</label>
                  <input
                    type="number"
                    min={0}
                    value={outBorn || ''}
                    onChange={e => setOutBorn(Number(e.target.value))}
                    className="w-full h-9 px-2 bg-gray-25 border border-gray-150 rounded"
                  />
                </div>

                {/* Weaned */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase block">Số con cai sữa</label>
                  <input
                    type="number"
                    min={0}
                    value={outWeaned || ''}
                    onChange={e => setOutWeaned(Number(e.target.value))}
                    className="w-full h-9 px-2 bg-gray-25 border border-gray-150 rounded"
                  />
                </div>

                {/* Sold */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase block">Số con bán</label>
                  <input
                    type="number"
                    min={0}
                    value={outSold || ''}
                    onChange={e => setOutSold(Number(e.target.value))}
                    className="w-full h-9 px-2 bg-gray-25 border border-gray-150 rounded"
                  />
                </div>
              </div>

              {/* Customer Rating */}
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Đánh giá từ khách hàng (1-5 sao)</label>
                <div className="flex gap-2 text-gray-300">
                  {[1, 2, 3, 4, 5].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setOutRating(num)}
                      className="focus:outline-none"
                    >
                      <Star
                        size={28}
                        fill={num <= outRating ? '#f59e0b' : 'none'}
                        className={num <= outRating ? 'text-amber-400' : 'text-gray-300'}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Customer comment */}
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Lời nhận xét của khách hàng</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Bác sĩ nhiệt tình, chất lượng vaccine cực kỳ tốt!"
                  value={outComment}
                  onChange={e => setOutComment(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none placeholder-gray-400"
                />
              </div>

              {/* Vet Notes */}
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ghi chú kỹ thuật của Bác sĩ</label>
                <textarea
                  placeholder="Tổng quan tình hình sức khỏe đàn vật nuôi và các hướng dẫn chuyên sâu..."
                  value={outVetNotes}
                  onChange={e => setOutVetNotes(e.target.value)}
                  rows={2}
                  className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none placeholder-gray-400"
                />
              </div>

              {/* Lessons & Followup */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Bài học kinh nghiệm</label>
                  <textarea
                    placeholder="Rút ra cho các chu kỳ chăn nuôi sau..."
                    value={outLessons}
                    onChange={e => setOutLessons(e.target.value)}
                    rows={2}
                    className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none placeholder-gray-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Kế hoạch tiếp theo</label>
                  <textarea
                    placeholder="Các mũi tiêm phòng bổ sung hoặc chế độ dinh dưỡng tiếp theo..."
                    value={outFollowup}
                    onChange={e => setOutFollowup(e.target.value)}
                    rows={2}
                    className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none placeholder-gray-400"
                  />
                </div>
              </div>

              {/* Bento Stats editing */}
              <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Thức ăn TB</label>
                  <input type="text" value={outBentoFood} onChange={e => setOutBentoFood(e.target.value)} className="w-full h-8 px-2 border rounded text-tiny" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Nước uống TB</label>
                  <input type="text" value={outBentoWater} onChange={e => setOutBentoWater(e.target.value)} className="w-full h-8 px-2 border rounded text-tiny" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Nhiệt độ TB chuồng</label>
                  <input type="text" value={outBentoTemp} onChange={e => setOutBentoTemp(e.target.value)} className="w-full h-8 px-2 border rounded text-tiny" />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setOutcomeModalOpen(false)}
                  className="px-4 py-2 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-500 hover:bg-gray-55"
                >
                  Quay lại
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-500 text-white font-semibold rounded-lg text-body-md hover:bg-blue-600 shadow-sm"
                >
                  Lưu &amp; Hoàn thành dự án
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: EDIT VET NOTES FAST
          ───────────────────────────────────────────────────────────── */}
      {vetNoteModalOpen && (
        <div className="fixed inset-0 bg-gray-750/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-0 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl animate-in fade-in duration-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-gray-25 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-body-lg text-gray-700">Chỉnh sửa ghi chú Bác sĩ</h3>
              <button onClick={() => setVetNoteModalOpen(false)} className="text-gray-400 hover:text-gray-600 font-bold text-body-lg">✕</button>
            </div>
            <form onSubmit={handleSaveVetNotesFast} className="p-6 space-y-4 overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ghi chú kỹ thuật</label>
                <textarea
                  value={editVetNotesText}
                  onChange={e => setEditVetNotesText(e.target.value)}
                  rows={6}
                  className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none placeholder-gray-400"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setVetNoteModalOpen(false)}
                  className="px-4 py-2 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-500 hover:bg-gray-55"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-500 text-white font-semibold rounded-lg text-body-md hover:bg-blue-600 shadow-sm"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: THÊM CHI PHÍ THỦ CÔNG
          ───────────────────────────────────────────────────────────── */}
      {costModalOpen && (
        <div className="fixed inset-0 bg-gray-750/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-0 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-gray-25 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-body-lg text-gray-700">Ghi nhận chi phí phát sinh</h3>
              <button onClick={() => setCostModalOpen(false)} className="text-gray-400 hover:text-gray-600 font-bold text-body-lg">✕</button>
            </div>

            <form onSubmit={handleSaveManualCost} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                {/* Incurred Date */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ngày phát sinh</label>
                  <input
                    type="date"
                    value={costIncurredDate}
                    onChange={e => setCostIncurredDate(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>

                {/* Cost Type Selection */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Loại chi phí</label>
                  <select
                    value={costType}
                    onChange={e => {
                      setCostType(e.target.value as any)
                      setCostProductId('')
                    }}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  >
                    <option value="breeding_stock">Con giống</option>
                    <option value="medicine">Thuốc / Vaccine</option>
                    <option value="feed">Thức ăn</option>
                    <option value="product">Hàng hóa / Vật tư</option>
                    <option value="labor">Nhân công</option>
                    <option value="other">Chi phí khác</option>
                  </select>
                </div>
              </div>

              {/* Optional Product selection for products/medicine */}
              {(costType === 'product' || costType === 'medicine') && (
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Chọn hàng hóa / vật tư</label>
                  <SmartSearchSelect
                    options={productOptions}
                    value={costProductId}
                    onChange={setCostProductId}
                    placeholder="-- Chọn sản phẩm --"
                    searchPlaceholder="Tìm hàng hóa / vật tư..."
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {/* Quantity */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Số lượng</label>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    value={costQuantity || ''}
                    onChange={e => setCostQuantity(Number(e.target.value))}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>

                {/* Unit Cost */}
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Đơn giá vốn (₫)</label>
                  <input
                    type="number"
                    min={0}
                    value={costUnitCost || ''}
                    onChange={e => setCostUnitCost(Number(e.target.value))}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>
              </div>

              {/* Cost Notes */}
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ghi chú / Mô tả</label>
                <textarea
                  placeholder="Mô tả mục đích sử dụng chi phí..."
                  value={costNotes}
                  onChange={e => setCostNotes(e.target.value)}
                  rows={3}
                  className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none placeholder-gray-400"
                />
              </div>

              {/* Total amount preview */}
              <div className="bg-gray-25 p-3 rounded-lg border border-gray-150 flex justify-between items-center text-body-md">
                <span className="font-semibold text-gray-400">Thành tiền dự kiến:</span>
                <span className="font-bold text-rose-600 text-body-lg tabular-nums">
                  {formatVND(costQuantity * costUnitCost)}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setCostModalOpen(false)}
                  className="px-4 py-2 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-500 hover:bg-gray-55"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-500 text-white font-semibold rounded-lg text-body-md hover:bg-blue-600 shadow-sm"
                >
                  Lưu chi phí
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: THÊM BƯỚC LỊCH TRÌNH
          ───────────────────────────────────────────────────────────── */}
      {addStepOpen && (
        <div className="fixed inset-0 bg-gray-750/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-0 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-gray-25 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-body-lg text-gray-700">Thêm bước lịch trình</h3>
              <button onClick={() => setAddStepOpen(false)} className="text-gray-400 hover:text-gray-600 font-bold text-body-lg">✕</button>
            </div>
            <form onSubmit={handleAddStep} className="p-6 space-y-4 overflow-y-auto">
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Tên bước <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  placeholder="VD: Tiêm vaccine Newcastle lần 2"
                  value={asName}
                  onChange={e => setAsName(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ngày kế hoạch</label>
                <input
                  type="date"
                  value={asPlannedDate}
                  onChange={e => setAsPlannedDate(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Người được giao thực hiện</label>
                <select
                  value={asAssignedTo}
                  onChange={e => setAsAssignedTo(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                >
                  <option value="">-- Chưa gán người thực hiện --</option>
                  {vets.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setAddStepOpen(false)}
                  className="px-4 py-2 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-500 hover:bg-gray-55">Hủy bỏ</button>
                <button type="submit"
                  className="px-5 py-2 bg-blue-500 text-white font-semibold rounded-lg text-body-md hover:bg-blue-600 shadow-sm">Thêm bước</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: SỬA DỰ ÁN (giới hạn trường an toàn)
          ───────────────────────────────────────────────────────────── */}
      {editProjOpen && (
        <div className="fixed inset-0 bg-gray-750/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-0 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-gray-25 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-body-lg text-gray-700">Sửa dự án</h3>
              <button onClick={() => setEditProjOpen(false)} className="text-gray-400 hover:text-gray-600 font-bold text-body-lg">✕</button>
            </div>
            <form onSubmit={handleSaveProjectEdit} className="p-6 space-y-4 overflow-y-auto">
              <p className="text-tiny text-gray-400 bg-gray-25 border border-gray-100 rounded-lg p-2.5">
                Khách hàng / Cơ sở / Đàn không sửa tại đây để bảo toàn dữ liệu chi phí đã ghi. Cần đổi đàn, vui lòng tạo dự án mới.
              </p>
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Tên dự án <span className="text-rose-500">*</span></label>
                <input type="text" value={epName} onChange={e => setEpName(e.target.value)} required
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">BSTY phụ trách <span className="text-rose-500">*</span></label>
                  <select value={epOwnerId} onChange={e => setEpOwnerId(e.target.value)} required
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none">
                    <option value="">-- Chọn người phụ trách --</option>
                    {vets.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Loại kế hoạch</label>
                  <select value={epTypeId} onChange={e => setEpTypeId(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none">
                    <option value="">-- Chọn loại kế hoạch --</option>
                    {projTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Khu vực</label>
                  <select value={epRegionId} onChange={e => setEpRegionId(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none">
                    <option value="">-- Chọn khu vực --</option>
                    {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Quy mô đàn (số con)</label>
                  <input type="number" min={0} value={epHeadCount || ''} onChange={e => setEpHeadCount(Number(e.target.value))}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ngày bắt đầu</label>
                  <input type="date" value={epStartDate} onChange={e => setEpStartDate(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ngày kết thúc dự kiến</label>
                  <input type="date" value={epEndDate} onChange={e => setEpEndDate(e.target.value)}
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Ghi chú</label>
                <textarea rows={3} value={epNotes} onChange={e => setEpNotes(e.target.value)}
                  className="w-full p-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setEditProjOpen(false)}
                  className="px-4 py-2 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-500 hover:bg-gray-55">Hủy bỏ</button>
                <button type="submit"
                  className="px-5 py-2 bg-blue-500 text-white font-semibold rounded-lg text-body-md hover:bg-blue-600 shadow-sm">Lưu thay đổi</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
