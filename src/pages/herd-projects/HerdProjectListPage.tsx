import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  SlidersHorizontal,
  User,
  Calendar,
  Layers,
  AlertCircle,
  FileText,
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface Customer {
  id: string
  farm_name: string
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
  customer?: Customer | null
  herd?: Herd | null
  project_type?: ProjectType | null
  owner?: Profile | null
}

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

const STATUS_ICONS: Record<string, React.ComponentType<any>> = {
  draft: FileText,
  active: Activity,
  on_hold: Clock,
  completed: CheckCircle2,
  cancelled: XCircle
}

export default function HerdProjectListPage() {
  const navigate = useNavigate()

  // State
  const [projects, setProjects] = useState<HerdProject[]>([])
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([])
  const [vets, setVets] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<any>(null)

  // Filter States
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedVet, setSelectedVet] = useState('')
  const [activePreset, setActivePreset] = useState<'all' | 'my' | 'overdue' | 'active'>('all')

  // Load Data
  const loadData = async () => {
    setLoading(true)
    try {
      // Get current user auth
      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUser(user)

      // Fetch project types
      const { data: typesData } = await supabase
        .from('herd_project_types')
        .select('id, name, code')
        .eq('is_active', true)
      if (typesData) setProjectTypes(typesData)

      // Fetch veterinarians/profiles
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('is_active', true)
      if (profilesData) setVets(profilesData)

      // Fetch projects
      const { data: projsData, error: projsErr } = await supabase
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
          customer:customers(id, farm_name),
          herd:herds(id, name),
          project_type:herd_project_types(id, name, code),
          owner:profiles!owner_user_id(id, full_name, avatar_url)
        `)
        .order('created_at', { ascending: false })

      if (projsErr) throw projsErr
      if (projsData) {
        setProjects(projsData as unknown as HerdProject[])
      }
    } catch (err) {
      console.error('Error fetching herd projects:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Filter Logic
  const filteredProjects = projects.filter(proj => {
    // 1. Search term match
    const searchLower = searchTerm.toLowerCase().trim()
    const matchesSearch = searchLower === '' ||
      proj.name.toLowerCase().includes(searchLower) ||
      proj.project_code.toLowerCase().includes(searchLower) ||
      (proj.customer?.farm_name || '').toLowerCase().includes(searchLower)

    // 2. Project Type filter
    const matchesType = selectedType === '' || proj.project_type?.id === selectedType

    // 3. Status filter
    const matchesStatus = selectedStatus === '' || proj.status === selectedStatus

    // 4. Vet filter
    const matchesVet = selectedVet === '' || proj.owner?.id === selectedVet

    // 5. Preset filters
    let matchesPreset = true
    const todayStr = new Date().toISOString().split('T')[0]

    if (activePreset === 'my') {
      matchesPreset = proj.owner?.id === currentUser?.id
    } else if (activePreset === 'active') {
      matchesPreset = proj.status === 'active'
    } else if (activePreset === 'overdue') {
      matchesPreset =
        proj.status !== 'completed' &&
        proj.status !== 'cancelled' &&
        !!proj.end_date &&
        proj.end_date < todayStr
    }

    return matchesSearch && matchesType && matchesStatus && matchesVet && matchesPreset
  })

  // Format date helper
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    const [year, month, day] = dateStr.split('-')
    return `${day}/${month}/${year}`
  }

  return (
    <Layout activeMenu="Chăn nuôi">
      <div className="p-4 md:p-10 max-w-7xl w-full mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-h1 font-bold text-gray-700">Dự án Chăn nuôi</h1>
            <p className="text-body-md text-gray-400 mt-1">
              Quản lý quy trình tiêm vaccine, kế hoạch kỹ thuật và điều trị đàn vật nuôi.
            </p>
          </div>
          <button
            onClick={() => navigate('/herd-projects/new')}
            className="bg-blue-500 hover:bg-blue-600 text-white px-5 h-11 rounded-lg font-semibold text-body-md shadow-sm active:scale-95 transition-all flex items-center gap-2"
          >
            <Plus size={18} strokeWidth={2.5} />
            Tạo dự án mới
          </button>
        </div>

        {/* Filter Controls Panel */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search Input */}
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Tìm tên dự án, mã dự án, trang trại..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all placeholder-gray-400"
              />
            </div>

            {/* Project Type Select */}
            <div className="relative">
              <select
                value={selectedType}
                onChange={e => setSelectedType(e.target.value)}
                className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all appearance-none cursor-pointer text-gray-650"
              >
                <option value="">Tất cả loại kế hoạch</option>
                {projectTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Status Select */}
            <div className="relative">
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all appearance-none cursor-pointer text-gray-650"
              >
                <option value="">Tất cả trạng thái</option>
                <option value="draft">Bản nháp</option>
                <option value="active">Đang hoạt động</option>
                <option value="on_hold">Tạm ngưng</option>
                <option value="completed">Đã hoàn thành</option>
                <option value="cancelled">Đã hủy</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-4 border-t border-gray-100 gap-4">
            {/* Presets Row */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActivePreset('all')}
                className={`px-3 py-1.5 rounded-lg text-tiny font-semibold border transition-all ${
                  activePreset === 'all'
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                    : 'bg-gray-25 text-gray-500 border-gray-150 hover:bg-gray-50'
                }`}
              >
                Tất cả dự án
              </button>
              <button
                onClick={() => setActivePreset('my')}
                className={`px-3 py-1.5 rounded-lg text-tiny font-semibold border transition-all ${
                  activePreset === 'my'
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                    : 'bg-gray-25 text-gray-500 border-gray-150 hover:bg-gray-50'
                }`}
              >
                Dự án của tôi
              </button>
              <button
                onClick={() => setActivePreset('active')}
                className={`px-3 py-1.5 rounded-lg text-tiny font-semibold border transition-all ${
                  activePreset === 'active'
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                    : 'bg-gray-25 text-gray-500 border-gray-150 hover:bg-gray-50'
                }`}
              >
                Đang hoạt động
              </button>
              <button
                onClick={() => setActivePreset('overdue')}
                className={`px-3 py-1.5 rounded-lg text-tiny font-semibold border transition-all flex items-center gap-1 ${
                  activePreset === 'overdue'
                    ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                    : 'bg-gray-25 text-gray-500 border-gray-150 hover:bg-gray-50'
                }`}
              >
                {activePreset === 'overdue' && <AlertTriangle size={12} />}
                Quá hạn kiểm thử
              </button>
            </div>

            {/* Veterinarian Filter */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <SlidersHorizontal size={16} className="text-gray-400 hidden sm:block" />
              <select
                value={selectedVet}
                onChange={e => setSelectedVet(e.target.value)}
                className="h-9 px-3 bg-gray-25 border border-gray-150 rounded-lg text-tiny font-semibold focus:border-blue-500 focus:outline-none cursor-pointer text-gray-500 w-full sm:w-56"
              >
                <option value="">Lọc theo BSTY phụ trách</option>
                {vets.map(v => (
                  <option key={v.id} value={v.id}>{v.full_name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Projects Cards Grid */}
        {loading ? (
          <div className="py-32 flex flex-col items-center justify-center text-gray-400">
            <div className="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
            <span>Đang tải danh sách dự án...</span>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-16 text-center text-gray-400 shadow-sm">
            <AlertCircle className="mx-auto text-gray-300 mb-4" size={48} />
            <h3 className="font-semibold text-gray-600 text-body-lg">Không tìm thấy dự án nào</h3>
            <p className="text-body-md mt-1">
              Thử thay đổi từ khóa hoặc bộ lọc để hiển thị kết quả.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map(proj => {
              const StatusIcon = STATUS_ICONS[proj.status] || FileText
              const today = new Date().toISOString().split('T')[0]
              const isOverdue =
                proj.status !== 'completed' &&
                proj.status !== 'cancelled' &&
                !!proj.end_date &&
                proj.end_date < today

              return (
                <div
                  key={proj.id}
                  onClick={() => navigate(`/herd-projects/${proj.id}`)}
                  className="bg-gray-0 border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md hover:border-gray-150 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div className="space-y-4">
                    {/* Card Header Status & Code */}
                    <div className="flex justify-between items-center">
                      <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider">
                        {proj.project_code}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isOverdue && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-0.5">
                            <AlertTriangle size={10} />
                            Quá hạn
                          </span>
                        )}
                        <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold flex items-center gap-1 ${STATUS_COLORS[proj.status]}`}>
                          <StatusIcon size={12} />
                          {STATUS_LABELS[proj.status]}
                        </span>
                      </div>
                    </div>

                    {/* Title & Type */}
                    <div className="space-y-1">
                      <h3 className="font-bold text-body-lg text-gray-700 group-hover:text-blue-500 transition-colors line-clamp-1">
                        {proj.name}
                      </h3>
                      <p className="text-tiny text-gray-450 font-medium flex items-center gap-1">
                        <Layers size={13} className="text-gray-400" />
                        {proj.project_type?.name || 'Kế hoạch kỹ thuật'}
                      </p>
                    </div>

                    {/* Details: Farm & Heads */}
                    <div className="bg-gray-25 p-3 rounded-lg border border-gray-100/50 space-y-1.5 text-body-md text-gray-500">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Khách hàng:</span>
                        <span className="font-semibold text-gray-600 max-w-[160px] truncate">
                          {proj.customer?.farm_name || 'Khách lẻ'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Đàn quản lý:</span>
                        <span className="font-medium text-gray-600">
                          {proj.herd?.name || 'Cả trại'} ({proj.head_count.toLocaleString()} con)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer: Vet & Date */}
                  <div className="flex justify-between items-center mt-5 pt-4 border-t border-gray-50">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 text-tiny font-bold flex-shrink-0">
                        {proj.owner?.avatar_url ? (
                          <img
                            src={proj.owner.avatar_url}
                            alt="Vet avatar"
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          <User size={14} />
                        )}
                      </div>
                      <span className="text-tiny font-semibold text-gray-500">
                        {proj.owner?.full_name || 'Hệ thống'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-gray-400 font-medium">
                      <Calendar size={13} />
                      <span>{formatDate(proj.start_date)}</span>
                      <span>-</span>
                      <span>{formatDate(proj.end_date)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
