import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts'
import {
  ChevronRight, Users, Home, AlertTriangle, TrendingUp,
  Download, Printer, ChevronLeft, ChevronRight as ChevronRightIcon,
  Search, SlidersHorizontal, Eye
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import DataTable, { type DataTableColumn } from '../../components/DataTable'

interface SalesRep {
  id: string
  name: string
}

interface CustomerRow {
  id: string
  code: string
  farm_name: string
  customer_type: string
  value_tier: string
  lifecycle_stage: string
  totalSpend: number
  totalDebt: number
  ownerName: string
}

const TYPE_LABELS: Record<string, string> = {
  farm_household: 'Hộ chăn nuôi',
  farm_commercial: 'Trang trại lớn',
  dealer: 'Đại lý',
  enterprise: 'Doanh nghiệp',
  vet_clinic: 'Phòng khám',
  other: 'Khác'
}

const TIER_LABELS: Record<string, string> = {
  normal: 'Thường',
  vip: 'VIP',
  high_potential: 'Tiềm năng'
}

const LIFECYCLE_LABELS: Record<string, string> = {
  lead: 'Khách tiềm năng',
  active: 'Đang hoạt động',
  at_risk: 'Nguy cơ rời bỏ',
  churned: 'Đã rời bỏ'
}

const LIFECYCLE_COLORS: Record<string, string> = {
  lead: 'bg-blue-50 text-blue-700 border-blue-100',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  at_risk: 'bg-amber-50 text-amber-700 border-amber-100',
  churned: 'bg-red-50 text-danger-500 border-red-100'
}

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']
const TIER_COLORS = ['#868e96', '#eab308', '#6366f1'] // Thường, VIP, Tiềm năng
const BAR_COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#9ca3af']

export default function CustomerProfileReportPage() {
  const navigate = useNavigate()
  const { formatCurrency } = useDisplaySettings()

  // State data
  const [loading, setLoading] = useState(true)
  const [kpiData, setKpiData] = useState({
    totalCustomers: 0,
    activeCustomers: 0,
    atRiskCustomers: 0,
    totalHeads: 0
  })

  const [lifecycleData, setLifecycleData] = useState<{ name: string; value: number }[]>([])
  const [classData, setClassData] = useState<{ name: string; value: number }[]>([])
  const [tierData, setTierData] = useState<{ name: string; value: number }[]>([])
  const [topSpendersData, setTopSpendersData] = useState<{ name: string; revenue: number }[]>([])

  const [allCustomers, setAllCustomers] = useState<CustomerRow[]>([])
  const [salesReps, setSalesReps] = useState<SalesRep[]>([])

  // Filters State
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterTier, setFilterTier] = useState('all')
  const [filterLifecycle, setFilterLifecycle] = useState('all')
  const [filterOwner, setFilterOwner] = useState('all')

  // Pagination State
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Fetch all customers with their relations — nạp ĐỦ (tránh cap 1000 → báo cáo thiếu KH 1001+)
      const customers = await fetchAllRows<any>((from, to) =>
        supabase
          .from('customers')
          .select(`
            *,
            owner:profiles!owner_user_id(id, full_name, email),
            orders(*),
            customer_debts(*)
          `)
          .order('farm_name', { ascending: true }).order('id')
          .range(from, to)
      )

      // 2. Fetch all active herds to get total herd headcount
      const { data: herdsData } = await supabase
        .from('herds')
        .select('current_quantity')
        .eq('is_active', true)
      
      const totalHeads = herdsData?.reduce((sum: number, h: { current_quantity: number | null }) => sum + (h.current_quantity || 0), 0) || 0

      // Calculate KPI aggregates
      const totalCustomers = customers.length
      const activeCustomers = customers.filter((c: any) => c.lifecycle_stage === 'active').length
      const atRiskCustomers = customers.filter((c: any) => c.lifecycle_stage === 'at_risk' || c.lifecycle_stage === 'churned').length

      // 3. Lifecycle stage chart data
      const lifecycleCounts: Record<string, number> = { lead: 0, active: 0, at_risk: 0, churned: 0 }
      customers.forEach((c: any) => {
        const stage = c.lifecycle_stage || 'lead'
        lifecycleCounts[stage] = (lifecycleCounts[stage] || 0) + 1
      })
      const lifecycleChartData = Object.entries(lifecycleCounts).map(([key, value]) => ({
        name: LIFECYCLE_LABELS[key] || key,
        value
      }))

      // 4. Classifications chart data
      const classCounts: Record<string, number> = {}
      customers.forEach((c: any) => {
        const cls = c.customer_type || 'other'
        classCounts[cls] = (classCounts[cls] || 0) + 1
      })
      const classChartData = Object.entries(classCounts).map(([key, value]) => ({
        name: TYPE_LABELS[key] || key,
        value
      })).sort((a, b) => b.value - a.value)

      // 5. Value Tier chart data
      const tierCounts: Record<string, number> = { normal: 0, vip: 0, high_potential: 0 }
      customers.forEach((c: any) => {
        const tier = c.value_tier || 'normal'
        tierCounts[tier] = (tierCounts[tier] || 0) + 1
      })
      const tierChartData = [
        { name: 'Thường', value: tierCounts.normal || 0 },
        { name: 'VIP', value: tierCounts.vip || 0 },
        { name: 'Tiềm năng', value: tierCounts.high_potential || 0 }
      ]

      // 6. Aggregate Spenders & Customers List
      const spenders = customers.map((c: any) => {
        let spend = 0
        if (c.orders) {
          c.orders.forEach((o: any) => {
            if (o.status !== 'cancelled') {
              spend += Number(o.grand_total || 0)
            }
          })
        }
        
        let debt = 0
        if (c.customer_debts) {
          c.customer_debts.forEach((d: any) => {
            if (!d.is_settled) {
              debt += Number(d.amount || 0)
            }
          })
        }

        return {
          id: c.id,
          code: c.code,
          farm_name: c.farm_name,
          customer_type: c.customer_type,
          value_tier: c.value_tier,
          lifecycle_stage: c.lifecycle_stage,
          totalSpend: spend,
          totalDebt: debt,
          ownerName: c.owner?.full_name || 'Hệ thống'
        }
      })

      const topSpenders = [...spenders]
        .sort((a, b) => b.totalSpend - a.totalSpend)
        .slice(0, 10)
        .map(s => ({
          name: s.farm_name,
          revenue: s.totalSpend
        }))

      setKpiData({
        totalCustomers,
        activeCustomers,
        atRiskCustomers,
        totalHeads
      })

      setLifecycleData(lifecycleChartData)
      setClassData(classChartData)
      setTierData(tierChartData)
      setTopSpendersData(topSpenders)
      setAllCustomers(spenders)

      // Fetch dynamic list of owner/reps
      const repsMap = new Map()
      customers.forEach((c: any) => {
        if (c.owner) {
          repsMap.set(c.owner.id, c.owner.full_name)
        }
      })
      setSalesReps(Array.from(repsMap.entries()).map(([id, name]) => ({ id, name })))

    } catch (err) {
      console.error('Error loading customer portrait report:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Filtering Logic
  const filteredCustomers = allCustomers.filter(c => {
    const matchesSearch = c.farm_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.code.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = filterType === 'all' || c.customer_type === filterType
    const matchesTier = filterTier === 'all' || c.value_tier === filterTier
    const matchesLifecycle = filterLifecycle === 'all' || c.lifecycle_stage === filterLifecycle
    const matchesOwner = filterOwner === 'all' || c.ownerName === filterOwner

    return matchesSearch && matchesType && matchesTier && matchesLifecycle && matchesOwner
  })

  // Pagination Logic
  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / PAGE_SIZE))
  const paginatedCustomers = filteredCustomers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Cột hồ sơ KH — kế thừa DataTable (desktop bảng + mobile card; DataTable tự phân trang)
  const profileColumns: DataTableColumn<typeof filteredCustomers[number]>[] = [
    { key: 'code', header: 'Mã KH', width: 110, noTruncate: true, render: (c) => <span className="font-semibold text-blue-500 truncate">{c.code}</span> },
    { key: 'name', header: 'Tên khách hàng / Trang trại', flex: true, minWidth: 180, noTruncate: true, render: (c) => <span className="font-bold text-gray-800 truncate">{c.farm_name}</span> },
    { key: 'type', header: 'Phân loại', width: 130, render: (c) => <span className="text-gray-500">{TYPE_LABELS[c.customer_type] || c.customer_type}</span> },
    { key: 'tier', header: 'Hạng', width: 110, noTruncate: true, render: (c) => <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase ${c.value_tier === 'vip' ? 'bg-amber-100 text-amber-800' : c.value_tier === 'high_potential' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-600'}`}>{TIER_LABELS[c.value_tier] || c.value_tier}</span> },
    { key: 'lifecycle', header: 'Vòng đời', width: 120, noTruncate: true, mobileHeaderRight: true, render: (c) => <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${LIFECYCLE_COLORS[c.lifecycle_stage] || 'bg-gray-50 text-gray-500 border-gray-100'}`}>{LIFECYCLE_LABELS[c.lifecycle_stage] || c.lifecycle_stage}</span> },
    { key: 'spend', header: 'Tổng chi tiêu', width: 130, align: 'right', render: (c) => <span className="font-bold text-gray-700 tabular-nums">{formatCurrency(c.totalSpend)}</span> },
    { key: 'debt', header: 'Số nợ hiện tại', width: 130, align: 'right', render: (c) => <span className="font-semibold text-danger-500 tabular-nums">{formatCurrency(c.totalDebt)}</span> },
    { key: 'owner', header: 'Sales phụ trách', width: 140, render: (c) => <span className="text-gray-500 font-medium">{c.ownerName}</span> },
    { key: 'action', header: 'Thao tác', width: 90, align: 'center', noTruncate: true, hideOnMobile: true, render: (c) => <button onClick={(e) => { e.stopPropagation(); navigate(`/customers/${c.id}`) }} className="px-3 h-8 bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-100 rounded-lg font-semibold text-tiny flex items-center gap-1 mx-auto transition-colors"><Eye size={12} />Chi tiết</button> },
  ]

  useEffect(() => {
    setPage(1)
  }, [searchQuery, filterType, filterTier, filterLifecycle, filterOwner])

  const formatShort = (val: number) => {
    if (val >= 1_000_000_000) return (val / 1_000_000_000).toFixed(1) + ' Tỷ'
    if (val >= 1_000_000) return (val / 1_000_000).toFixed(0) + ' Tr'
    if (val >= 1_000) return (val / 1_000).toFixed(0) + 'k'
    return String(val)
  }

  return (
    <Layout activeMenu="Báo cáo">
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto flex flex-col space-y-6">
        
        {/* Header Breadcrumb */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-400 text-tiny">
            <button onClick={() => navigate('/reports')} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
              <ChevronLeft size={14} />
              Trung tâm Báo cáo
            </button>
            <ChevronRight size={12} />
            <span className="text-blue-600 font-semibold">Phân tích Chân dung Khách hàng</span>
          </div>
        </div>

        {/* Title */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-[32px] font-bold text-gray-800 leading-tight">Phân tích Chân dung Khách hàng</h1>
            <p className="text-gray-500 text-body-md mt-1">Cơ cấu phân bổ khách hàng, vòng đời, hạng giá trị và năng lực chăn nuôi toàn diện.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="h-10 px-4 bg-gray-50 border border-gray-250 text-gray-500 rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-gray-100 transition-all shadow-sm">
              <Printer size={16} />
              In báo cáo
            </button>
            <button className="h-10 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-[#143C69] active:scale-95 transition-all shadow-sm">
              <Download size={16} />
              Xuất dữ liệu
            </button>
          </div>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Card 1: Tổng khách hàng */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
              <Users size={22} />
            </div>
            <div>
              <p className="text-tiny text-gray-400 font-bold uppercase tracking-wider">Tổng khách hàng</p>
              <p className="text-2xl font-bold text-gray-800 mt-0.5">
                {loading ? '...' : kpiData.totalCustomers.toLocaleString('vi-VN')}
              </p>
            </div>
          </div>

          {/* Card 2: Khách hàng hoạt động */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <Users size={22} />
            </div>
            <div>
              <p className="text-tiny text-gray-400 font-bold uppercase tracking-wider">Đang hoạt động</p>
              <p className="text-2xl font-bold text-emerald-700 mt-0.5">
                {loading ? '...' : kpiData.activeCustomers.toLocaleString('vi-VN')}
              </p>
            </div>
          </div>

          {/* Card 3: Khách hàng nguy cơ/đã mất */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={22} />
            </div>
            <div>
              <p className="text-tiny text-gray-400 font-bold uppercase tracking-wider">Rủi ro / Đã mất</p>
              <p className="text-2xl font-bold text-amber-700 mt-0.5">
                {loading ? '...' : kpiData.atRiskCustomers.toLocaleString('vi-VN')}
              </p>
            </div>
          </div>

          {/* Card 4: Tổng quy mô đầu con */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
              <Home size={22} />
            </div>
            <div>
              <p className="text-tiny text-gray-400 font-bold uppercase tracking-wider">Tổng đầu con chăn nuôi</p>
              <p className="text-2xl font-bold text-indigo-700 mt-0.5">
                {loading ? '...' : kpiData.totalHeads.toLocaleString('vi-VN')} con
              </p>
            </div>
          </div>
        </div>

        {/* Charts Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Vòng đời khách hàng */}
          <div className="bg-white border border-gray-150 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-1.5">
              <TrendingUp className="text-blue-500" size={18} />
              Cơ cấu Vòng đời Khách hàng
            </h3>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-tiny">Đang tải biểu đồ...</div>
            ) : lifecycleData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-tiny">Không có dữ liệu</div>
            ) : (
              <div className="h-64 flex flex-col md:flex-row items-center">
                <div className="w-full md:w-3/5 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={lifecycleData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {lifecycleData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any) => [`${value} khách hàng`, 'Số lượng']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full md:w-2/5 flex flex-col gap-2.5">
                  {lifecycleData.map((entry, idx) => (
                    <div key={idx} className="flex items-center justify-between text-body-md">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}></span>
                        <span className="text-gray-600 font-semibold">{entry.name}</span>
                      </div>
                      <span className="font-bold text-gray-800">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Chart 2: Phân loại nhóm khách hàng */}
          <div className="bg-white border border-gray-150 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-1.5">
              <TrendingUp className="text-indigo-500" size={18} />
              Cơ cấu Phân loại Khách hàng (Mô hình kinh doanh)
            </h3>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-tiny">Đang tải biểu đồ...</div>
            ) : classData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-tiny">Không có dữ liệu</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={classData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f5" />
                    <XAxis dataKey="name" stroke="#868e96" fontSize={11} tickLine={false} />
                    <YAxis stroke="#868e96" fontSize={11} tickLine={false} allowDecimals={false} />
                    <Tooltip formatter={(value: any) => [`${value} khách hàng`, 'Số lượng']} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {classData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Chart 3: Phân loại theo Hạng giá trị */}
          <div className="bg-white border border-gray-150 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-1.5">
              <TrendingUp className="text-amber-500" size={18} />
              Phân bổ Hạng giá trị khách hàng (Tiers)
            </h3>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-tiny">Đang tải biểu đồ...</div>
            ) : tierData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-tiny">Không có dữ liệu</div>
            ) : (
              <div className="h-64 flex flex-col md:flex-row items-center">
                <div className="w-full md:w-3/5 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={tierData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="value"
                        labelLine={false}
                      >
                        {tierData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={TIER_COLORS[index % TIER_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any) => [`${value} khách hàng`, 'Số lượng']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full md:w-2/5 flex flex-col gap-2.5">
                  {tierData.map((entry, idx) => (
                    <div key={idx} className="flex items-center justify-between text-body-md">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded" style={{ backgroundColor: TIER_COLORS[idx % TIER_COLORS.length] }}></span>
                        <span className="text-gray-600 font-semibold">{entry.name}</span>
                      </div>
                      <span className="font-bold text-gray-800">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Chart 4: Top 10 Khách chi tiêu lớn nhất */}
          <div className="bg-white border border-gray-150 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <h3 className="text-body-lg font-bold text-gray-700 mb-4 flex items-center gap-1.5">
              <TrendingUp className="text-emerald-500" size={18} />
              Top 10 Khách hàng có doanh số tích lũy lớn nhất
            </h3>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-tiny">Đang tải biểu đồ...</div>
            ) : topSpendersData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-tiny">Chưa có dữ liệu đặt hàng</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topSpendersData}
                    layout="vertical"
                    margin={{ top: 10, right: 10, left: 30, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f5" />
                    <XAxis type="number" stroke="#868e96" fontSize={11} tickLine={false} tickFormatter={formatShort} />
                    <YAxis dataKey="name" type="category" stroke="#868e96" fontSize={10} tickLine={false} width={120} />
                    <Tooltip formatter={(value: any) => [formatCurrency(Number(value)), 'Doanh số tích lũy']} />
                    <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Detailed customers profiling list table */}
        <div className="bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden">
          {/* Header & Filter Controls */}
          <div className="p-6 border-b border-gray-100 space-y-4">
            <div className="flex items-center gap-2 text-body-lg font-bold text-gray-800">
              <Eye className="text-blue-500" size={18} />
              <h3>Bảng chi tiết Chân dung Khách hàng ({filteredCustomers.length})</h3>
            </div>
            
            {/* Filtering Tools Row */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Search input */}
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm theo tên trang trại, mã khách hàng..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 border border-gray-250 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {/* Classification filter */}
              <div className="flex items-center gap-1">
                <SlidersHorizontal size={14} className="text-gray-400" />
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  className="h-9 px-2 bg-gray-25 border border-gray-255 rounded-lg text-body-md text-gray-600 focus:outline-none"
                >
                  <option value="all">Tất cả phân loại</option>
                  {Object.entries(TYPE_LABELS).map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </div>

              {/* Tier filter */}
              <select
                value={filterTier}
                onChange={e => setFilterTier(e.target.value)}
                className="h-9 px-2 bg-gray-25 border border-gray-255 rounded-lg text-body-md text-gray-600 focus:outline-none"
              >
                <option value="all">Tất cả hạng</option>
                {Object.entries(TIER_LABELS).map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>

              {/* Lifecycle filter */}
              <select
                value={filterLifecycle}
                onChange={e => setFilterLifecycle(e.target.value)}
                className="h-9 px-2 bg-gray-25 border border-gray-255 rounded-lg text-body-md text-gray-600 focus:outline-none"
              >
                <option value="all">Tất cả vòng đời</option>
                {Object.entries(LIFECYCLE_LABELS).map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>

              {/* Owner filter */}
              <select
                value={filterOwner}
                onChange={e => setFilterOwner(e.target.value)}
                className="h-9 px-2 bg-gray-25 border border-gray-255 rounded-lg text-body-md text-gray-600 focus:outline-none"
              >
                <option value="all">Tất cả nhân viên</option>
                {salesReps.map(rep => (
                  <option key={rep.id} value={rep.name}>{rep.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table Data — DataTable (desktop bảng + mobile card, tự phân trang) */}
          <DataTable
            rows={filteredCustomers}
            columns={profileColumns}
            getRowKey={(c) => c.id}
            loading={loading}
            pageSize={PAGE_SIZE}
            itemLabel="khách hàng"
            card={false}
            onRowClick={(c) => navigate(`/customers/${c.id}`)}
            emptyText="Không tìm thấy khách hàng phù hợp bộ lọc."
            resetSignal={`${searchQuery}|${filterType}|${filterTier}|${filterLifecycle}|${filterOwner}`}
          />
        </div>

      </div>
    </Layout>
  )
}
