import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  MoreVertical,
  X,
  Eye,
  Edit2,
  Trash2,
  AlertCircle,
  TrendingUp,
  CheckCircle,
  HelpCircle,
  Users,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Filter,
  UserCheck,
  Upload,
  Download,
  Settings
} from 'lucide-react'
import Layout from '../../components/Layout'
import AddCustomerModal from './AddCustomerModal'
import ImportCustomersModal from './ImportCustomersModal'
import { supabase } from '../../lib/supabase'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

interface Profile {
  id: string
  full_name: string
  avatar_url?: string
}

interface CustomerContact {
  id: string
  full_name: string
  role_at_farm?: string
  phone?: string
  is_primary: boolean
}

interface CustomerDebt {
  id: string
  amount: number
  due_date: string | null
  is_settled: boolean
}

interface Order {
  created_at: string
}

interface Customer {
  id: string
  code: string
  customer_type: string
  farm_name: string
  value_tier: string
  province: string | null
  district: string | null
  address: string | null
  credit_limit: number
  owner_user_id: string
  is_active: boolean
  created_at: string
  owner?: Profile | null
  customer_contacts?: CustomerContact[]
  customer_debts?: CustomerDebt[]
  orders?: Order[]
}

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  farm_household: 'Hộ chăn nuôi',
  farm_commercial: 'Trang trại lớn',
  dealer: 'Đại lý',
  enterprise: 'Doanh nghiệp',
  vet_clinic: 'Phòng khám',
  other: 'Khác'
}

const CUSTOMER_TYPE_COLORS: Record<string, string> = {
  farm_household: 'bg-purple-50 text-purple-700 border-purple-100',
  farm_commercial: 'bg-blue-50 text-blue-700 border-blue-100',
  dealer: 'bg-orange-50 text-orange-700 border-orange-100',
  enterprise: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  vet_clinic: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  other: 'bg-gray-50 text-gray-600 border-gray-100'
}

const TIER_LABELS: Record<string, string> = {
  normal: 'Thường',
  vip: 'VIP',
  high_potential: 'Tiềm năng'
}

export default function CustomerListPage() {
  const navigate = useNavigate()
  const { formatPhone, maskData } = useDisplaySettings()
  
  // State
  const [customers, setCustomers] = useState<Customer[]>([])
  const [salesReps, setSalesReps] = useState<Profile[]>([])
  const [classifications, setClassifications] = useState<{ code: string; name: string; is_active: boolean }[]>([])
  const [tiers, setTiers] = useState<{ code: string; name: string; is_active: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)

  const classLabels = classifications.reduce<Record<string, string>>((acc, curr) => {
    acc[curr.code] = curr.name
    return acc
  }, {})

  const tierLabels = tiers.reduce<Record<string, string>>((acc, curr) => {
    acc[curr.code] = curr.name
    return acc
  }, {})

  // Filter States
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedTier, setSelectedTier] = useState('')
  const [selectedOwner, setSelectedOwner] = useState('')
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false)

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Load Data
  const fetchCustomersAndReps = async () => {
    setLoading(true)
    try {
      // 1. Fetch sales profiles
      const { data: repsData, error: repsErr } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('is_active', true)
      
      if (!repsErr && repsData) {
        setSalesReps(repsData)
      }

      // Fetch classifications
      const { data: classData } = await supabase
        .from('customer_classifications')
        .select('code, name, is_active')
      if (classData) setClassifications(classData)

      // Fetch tiers
      const { data: tierData } = await supabase
        .from('customer_tiers')
        .select('code, name, is_active')
      if (tierData) setTiers(tierData)

      // 2. Fetch customers with related information
      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select(`
          id,
          code,
          customer_type,
          farm_name,
          value_tier,
          province,
          district,
          address,
          credit_limit,
          owner_user_id,
          is_active,
          created_at,
          owner:profiles!owner_user_id(id, full_name, avatar_url),
          customer_contacts(id, full_name, role_at_farm, phone, is_primary),
          customer_debts(id, amount, due_date, is_settled),
          orders(created_at)
        `)
        .order('created_at', { ascending: false })

      if (custErr) throw custErr
      if (custData) {
        setCustomers(custData as unknown as Customer[])
      }
    } catch (err) {
      console.error('Error fetching customers/reps:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCustomersAndReps()
  }, [])

  // Calculate Debt Helper
  const getCustomerDebtStats = (customer: Customer) => {
    const todayStr = new Date().toISOString().split('T')[0]
    let totalDebt = 0
    let isOverdue = false

    if (customer.customer_debts && customer.customer_debts.length > 0) {
      customer.customer_debts.forEach(debt => {
        if (!debt.is_settled) {
          totalDebt += Number(debt.amount || 0)
          if (debt.due_date && debt.due_date < todayStr) {
            isOverdue = true
          }
        }
      })
    }

    return { totalDebt, isOverdue }
  }

  // Get Last Purchase Date Helper
  const getLastPurchaseDate = (customer: Customer) => {
    if (!customer.orders || customer.orders.length === 0) return 'Chưa giao dịch'
    
    // Find latest order date
    const latestDate = customer.orders.reduce((latest, current) => {
      const currentDate = new Date(current.created_at)
      return currentDate > latest ? currentDate : latest
    }, new Date(0))

    if (latestDate.getTime() === 0) return 'Chưa giao dịch'
    
    return latestDate.toLocaleDateString('vi-VN')
  }

  // Handle successful customer add
  const handleAddSuccess = (newCustomerId?: string) => {
    setIsAddModalOpen(false)
    fetchCustomersAndReps()
    if (newCustomerId) {
      navigate(`/customers/${newCustomerId}`)
    }
  }

  // Reset Filters
  const handleResetFilters = () => {
    setSearchTerm('')
    setSelectedType('')
    setSelectedTier('')
    setSelectedOwner('')
    setFilterOverdueOnly(false)
    setCurrentPage(1)
  }

  // Filter & Search Logic
  const filteredCustomers = customers.filter(customer => {
    // 1. Search term (code, farm_name, contact phone, or contact name)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      const matchesCode = customer.code?.toLowerCase().includes(term)
      const matchesName = customer.farm_name.toLowerCase().includes(term)
      
      const matchesContacts = customer.customer_contacts?.some(c => 
        c.full_name.toLowerCase().includes(term) || c.phone?.includes(term)
      )

      if (!matchesCode && !matchesName && !matchesContacts) {
        return false
      }
    }

    // 2. Customer Type
    if (selectedType && customer.customer_type !== selectedType) {
      return false
    }

    // 3. Customer Tier
    if (selectedTier && customer.value_tier !== selectedTier) {
      return false
    }

    // 4. Sales Rep (Owner)
    if (selectedOwner && customer.owner_user_id !== selectedOwner) {
      return false
    }

    // 5. Overdue Debt
    if (filterOverdueOnly) {
      const { isOverdue } = getCustomerDebtStats(customer)
      if (!isOverdue) return false
    }

    return true
  })

  // Pagination Logic
  const totalItems = filteredCustomers.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedCustomers = filteredCustomers.slice(startIndex, startIndex + itemsPerPage)

  // Calculations for Bottom KPI Cards
  const totalCustomersCount = customers.length
  const overdueCustomersCount = customers.filter(c => {
    const { isOverdue } = getCustomerDebtStats(c)
    return isOverdue
  }).length
  const vipCustomersCount = customers.filter(c => c.value_tier === 'vip').length
  const handleExportCSV = () => {
    // 1. Prepare headers
    const headers = [
      'Mã khách hàng',
      'Tên trang trại/Doanh nghiệp',
      'Phân loại',
      'Hạng khách hàng',
      'Tỉnh/Thành phố',
      'Quận/Huyện',
      'Địa chỉ',
      'Hạn mức công nợ (VND)',
      'Tổng nợ hiện tại (VND)',
      'Người liên hệ chính',
      'Số điện thoại chính',
      'Nhân viên phụ trách',
      'Trạng thái hoạt động',
      'Ngày tạo'
    ]

    // 2. Map filtered customers to rows
    const rows = filteredCustomers.map(cust => {
      const { totalDebt } = getCustomerDebtStats(cust)
      const primaryContact = cust.customer_contacts?.find(c => c.is_primary)
      
      return [
        cust.code || '',
        cust.farm_name,
        classLabels[cust.customer_type] || cust.customer_type,
        tierLabels[cust.value_tier] || cust.value_tier,
        cust.province || '',
        cust.district || '',
        cust.address || '',
        cust.credit_limit,
        totalDebt,
        primaryContact?.full_name || '',
        primaryContact?.phone || '',
        cust.owner?.full_name || 'Hệ thống',
        cust.is_active ? 'Hoạt động' : 'Tạm khóa',
        cust.created_at ? new Date(cust.created_at).toLocaleDateString('vi-VN') : ''
      ]
    })

    // 3. Construct CSV content with UTF-8 BOM
    const csvContent = '\uFEFF' + [
      headers.join(','),
      ...rows.map(row => 
        row.map(val => {
          const text = String(val ?? '').replace(/"/g, '""')
          return text.includes(',') || text.includes('\n') || text.includes('"') ? `"${text}"` : text
        }).join(',')
      )
    ].join('\n')

    // 4. Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const today = new Date().toISOString().split('T')[0]
    link.setAttribute('href', url)
    link.setAttribute('download', `danh_sach_khach_hang_${today}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const formatVND = (num: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num)
  }

  return (
    <Layout activeMenu="Khách hàng">
      <div className="p-4 md:p-10 max-w-[1600px] w-full mx-auto space-y-6">
        
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-h1 font-semibold text-gray-700">Danh sách khách hàng</h2>
            <p className="text-body-md text-gray-400 mt-1">Quản lý và theo dõi thông tin đối tác kinh doanh</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            <button
              onClick={() => navigate('/customers/settings')}
              className="bg-white border border-gray-200 text-gray-600 px-4 h-11 rounded-lg font-semibold text-body-md flex items-center justify-center gap-2 hover:bg-gray-50 active:scale-95 transition-all shadow-sm"
              title="Cấu hình nhóm & phân loại khách hàng"
            >
              <Settings size={16} />
              <span>Thiết lập</span>
            </button>
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="bg-white border border-gray-200 text-gray-600 px-4 h-11 rounded-lg font-semibold text-body-md flex items-center justify-center gap-2 hover:bg-gray-50 active:scale-95 transition-all shadow-sm"
            >
              <Upload size={16} />
              Nhập Excel/CSV
            </button>
            <button
              onClick={handleExportCSV}
              className="bg-white border border-gray-200 text-gray-600 px-4 h-11 rounded-lg font-semibold text-body-md flex items-center justify-center gap-2 hover:bg-gray-50 active:scale-95 transition-all shadow-sm"
            >
              <Download size={16} />
              Xuất Excel/CSV
            </button>
            <button
              id="btn-add-customer"
              onClick={() => setIsAddModalOpen(true)}
              className="bg-blue-500 text-gray-0 px-5 h-11 rounded-lg font-semibold text-body-md flex items-center justify-center gap-2 hover:bg-blue-600 active:scale-95 transition-all shadow-sm"
            >
              <Plus size={18} strokeWidth={2.5} />
              Thêm khách hàng mới
            </button>
          </div>
        </div>

        {/* Filtering Bar */}
        <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex flex-wrap items-end gap-4 shadow-sm">
          {/* Search input */}
          <div className="flex-grow min-w-[280px]">
            <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Tìm kiếm</label>
            <div className="relative flex items-center bg-gray-25 rounded-lg border border-gray-100 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-150 transition-all">
              <Search className="text-gray-400 ml-3 mr-2" size={16} strokeWidth={1.5} />
              <input
                className="bg-transparent border-none focus:ring-0 text-body-md w-full placeholder-gray-400 py-2 pl-0 pr-4 focus:outline-none"
                placeholder="Mã, tên khách hàng, SĐT..."
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setCurrentPage(1)
                }}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="p-1.5 text-gray-400 hover:bg-gray-50 rounded-full mr-2"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Type dropdown */}
          <div className="w-full sm:w-48">
            <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Phân loại</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value)
                setCurrentPage(1)
              }}
            >
              <option value="">Tất cả phân loại</option>
              {classifications.filter(c => c.is_active).map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Tier dropdown */}
          <div className="w-full sm:w-40">
            <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Hạng khách hàng</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedTier}
              onChange={(e) => {
                setSelectedTier(e.target.value)
                setCurrentPage(1)
              }}
            >
              <option value="">Tất cả hạng</option>
              {tiers.filter(t => t.is_active).map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Owner dropdown */}
          <div className="w-full sm:w-48">
            <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Nhân viên phụ trách</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedOwner}
              onChange={(e) => {
                setSelectedOwner(e.target.value)
                setCurrentPage(1)
              }}
            >
              <option value="">Tất cả nhân viên</option>
              {salesReps.map(rep => (
                <option key={rep.id} value={rep.id}>{rep.full_name}</option>
              ))}
            </select>
          </div>

          {/* Overdue toggle */}
          <div className="flex items-center gap-3 h-10 pb-0.5 px-2 select-none">
            <span className="text-body-md font-semibold text-gray-500">Nợ quá hạn</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                className="sr-only peer"
                type="checkbox"
                checked={filterOverdueOnly}
                onChange={(e) => {
                  setFilterOverdueOnly(e.target.checked)
                  setCurrentPage(1)
                }}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
            </label>
          </div>

          {/* Reset button */}
          <button
            onClick={handleResetFilters}
            className="h-10 px-4 border border-gray-100 text-gray-500 bg-gray-0 rounded-lg text-body-md flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors w-full sm:w-auto"
          >
            <Filter size={16} />
            Bỏ lọc
          </button>
        </div>

        {/* Table Container */}
        <div className="bg-gray-0 rounded-xl border border-gray-100 overflow-hidden flex flex-col shadow-sm">
          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center text-gray-400">
              <div className="w-10 h-10 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
              <span>Đang tải danh sách khách hàng...</span>
            </div>
          ) : paginatedCustomers.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-gray-400 px-4">
              <Users className="text-gray-200 mb-4" size={64} strokeWidth={1} />
              <h3 className="text-body-lg font-bold text-gray-600">Không tìm thấy khách hàng nào</h3>
              <p className="text-body-md text-gray-400 mt-1 text-center">Hãy thử điều chỉnh bộ lọc hoặc tạo hồ sơ khách hàng mới.</p>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="mt-6 px-4 py-2 bg-blue-50 text-blue-500 font-semibold rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-2"
              >
                <Plus size={16} strokeWidth={2.5} />
                Thêm khách hàng đầu tiên
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-25 border-b border-gray-100">
                    <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Mã KH</th>
                    <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Tên khách hàng</th>
                    <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Phân loại</th>
                    <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Sales phụ trách</th>
                    <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider text-right">Công nợ hiện tại</th>
                    <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Lần mua cuối</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedCustomers.map((customer) => {
                    const { totalDebt, isOverdue } = getCustomerDebtStats(customer)
                    const primaryContact = customer.customer_contacts?.find(c => c.is_primary)
                    const showDropdown = activeDropdown === customer.id

                    return (
                      <tr 
                        key={customer.id} 
                        className="hover:bg-gray-25/50 transition-colors cursor-pointer group"
                        onClick={() => navigate(`/customers/${customer.id}`)}
                      >
                        {/* Customer Code */}
                        <td className="px-6 py-5 text-body-md text-blue-500 font-bold font-sans">
                          {customer.code || 'Đang cấp...'}
                        </td>
                        
                        {/* Name and Location */}
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-body-lg font-semibold text-gray-700 group-hover:text-blue-500 transition-colors">
                                  {customer.farm_name}
                                </span>
                                {customer.value_tier === 'vip' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-100 text-amber-700 font-semibold text-[10px]">
                                    VIP
                                  </span>
                                )}
                                {customer.value_tier === 'high_potential' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 border border-blue-100 text-blue-700 font-semibold text-[10px]">
                                    Tiềm năng
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-tiny text-gray-400 mt-1">
                                <MapPin size={12} className="text-gray-300" />
                                <span>
                                  {[customer.district, customer.province].filter(Boolean).join(', ') || 'Chưa định vị'}
                                </span>
                                {primaryContact?.phone && (
                                  <>
                                    <span className="text-gray-200">•</span>
                                    <span>SĐT: {maskData(formatPhone(primaryContact.phone), 'phone')}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Customer Type */}
                        <td className="px-6 py-5">
                          <span className={`px-2.5 py-1 rounded-full border text-tiny font-semibold inline-flex items-center gap-1.5 ${
                            CUSTOMER_TYPE_COLORS[customer.customer_type] || CUSTOMER_TYPE_COLORS.other
                          }`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                            {classLabels[customer.customer_type] || customer.customer_type}
                          </span>
                        </td>

                        {/* Owner / Sales Rep */}
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            {customer.owner?.avatar_url ? (
                              <img 
                                src={customer.owner.avatar_url} 
                                alt={customer.owner.full_name} 
                                className="w-6 h-6 rounded-full object-cover" 
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-500 border border-blue-100 flex items-center justify-center text-tiny font-semibold uppercase">
                                {customer.owner?.full_name?.charAt(0) || 'S'}
                              </div>
                            )}
                            <span className="text-body-md text-gray-600 font-medium">
                              {customer.owner?.full_name || 'Hệ thống'}
                            </span>
                          </div>
                        </td>

                        {/* Current Debt */}
                        <td className={`px-6 py-5 text-right text-body-md font-bold tabular-nums ${
                          isOverdue ? 'text-danger-500' : totalDebt > 0 ? 'text-gray-600' : 'text-gray-400'
                        }`}>
                          {totalDebt > 0 ? formatVND(totalDebt) : '0 ₫'}
                          {isOverdue && (
                            <span className="block text-[10px] text-danger-500 font-normal mt-0.5">Quá hạn thanh toán</span>
                          )}
                        </td>

                        {/* Last Purchase */}
                        <td className="px-6 py-5 text-body-md text-gray-400">
                          {getLastPurchaseDate(customer)}
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="relative inline-block text-left">
                            <button
                              onClick={() => setActiveDropdown(showDropdown ? null : customer.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                            >
                              <MoreVertical size={16} />
                            </button>
                            
                            {showDropdown && (
                              <>
                                <div 
                                  className="fixed inset-0 z-10" 
                                  onClick={() => setActiveDropdown(null)}
                                />
                                <div className="absolute right-0 mt-1 w-36 bg-gray-0 border border-gray-100 rounded-lg shadow-lg py-1 z-20 animate-in fade-in slide-in-from-top-1 duration-100">
                                  <button
                                    onClick={() => {
                                      setActiveDropdown(null)
                                      navigate(`/customers/${customer.id}`)
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-body-md text-gray-600 hover:bg-gray-50 text-left font-medium"
                                  >
                                    <Eye size={14} />
                                    Xem chi tiết
                                  </button>
                                  <button
                                    onClick={() => {
                                      setActiveDropdown(null)
                                      // Can trigger editing or detail editing page
                                      navigate(`/customers/${customer.id}?edit=true`)
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-body-md text-gray-600 hover:bg-gray-50 text-left font-medium"
                                  >
                                    <Edit2 size={14} />
                                    Chỉnh sửa
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Footer */}
          {!loading && totalItems > 0 && (
            <div className="px-6 py-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-0">
              <div className="text-body-md text-gray-400">
                Hiển thị <span className="font-semibold text-gray-500">{startIndex + 1}</span> - <span className="font-semibold text-gray-500">{Math.min(startIndex + itemsPerPage, totalItems)}</span> trên tổng số <span className="font-semibold text-gray-500">{totalItems}</span> khách hàng
              </div>
              
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="w-8 h-8 flex items-center justify-center rounded border border-gray-150 text-gray-400 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  
                  {Array.from({ length: totalPages }, (_, idx) => {
                    const page = idx + 1
                    // Logic to limit number of page buttons shown
                    if (
                      page === 1 || 
                      page === totalPages || 
                      (page >= currentPage - 1 && page <= currentPage + 1)
                    ) {
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`w-8 h-8 rounded text-body-md font-semibold transition-colors ${
                            currentPage === page
                              ? 'bg-blue-500 text-gray-0 shadow-sm'
                              : 'text-gray-500 hover:bg-gray-50 border border-transparent'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    }
                    if (page === 2 || page === totalPages - 1) {
                      return <span key={page} className="px-1 text-gray-300">...</span>
                    }
                    return null
                  })}

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="w-8 h-8 flex items-center justify-center rounded border border-gray-150 text-gray-400 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Stats KPI Widgets */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-200 transition-all">
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 flex-shrink-0">
                <Users size={22} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-body-md font-semibold text-gray-400">Tổng khách hàng</p>
                <p className="text-[28px] font-bold text-gray-700 leading-tight mt-1 tabular-nums">
                  {totalCustomersCount}
                </p>
              </div>
            </div>

            <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-200 transition-all">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-danger-500 flex-shrink-0">
                <AlertCircle size={22} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-body-md font-semibold text-gray-400">Khách nợ quá hạn</p>
                <p className="text-[28px] font-bold text-danger-500 leading-tight mt-1 tabular-nums">
                  {overdueCustomersCount}
                </p>
              </div>
            </div>

            <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-200 transition-all">
              <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 flex-shrink-0">
                <UserCheck size={22} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-body-md font-semibold text-gray-400">Khách hàng VIP</p>
                <p className="text-[28px] font-bold text-gray-700 leading-tight mt-1 tabular-nums">
                  {vipCustomersCount}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Add Customer Modal */}
        <AddCustomerModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={handleAddSuccess}
        />

        {/* Import Customers Modal */}
        <ImportCustomersModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={() => {
            setIsImportModalOpen(false)
            fetchCustomersAndReps()
          }}
          classifications={classifications}
          tiers={tiers}
          salesReps={salesReps}
        />
        
      </div>
    </Layout>
  )
}
