import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  MoreVertical,
  X,
  Eye,
  Edit2,
  AlertCircle,
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
import { Skeleton } from '../../components/Skeleton'
import AddCustomerModal from './AddCustomerModal'
import ImportCustomersModal from './ImportCustomersModal'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  useCustomersList,
  useSalesReps,
  useCustomerClassifications,
  useCustomerTiers,
  useCustomerKPIs,
  type CustomerSummaryRow,
} from '../../hooks/queries/useCustomers'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../lib/queryClient'
import { supabase } from '../../lib/supabase'
import { logger } from '../../lib/logger'

const CUSTOMER_TYPE_COLORS: Record<string, string> = {
  farm_household:  'bg-purple-50 text-purple-700 border-purple-100',
  farm_commercial: 'bg-blue-50 text-blue-700 border-blue-100',
  dealer:          'bg-orange-50 text-orange-700 border-orange-100',
  enterprise:      'bg-indigo-50 text-indigo-700 border-indigo-100',
  vet_clinic:      'bg-emerald-50 text-emerald-700 border-emerald-100',
  other:           'bg-gray-50 text-gray-600 border-gray-100',
}

const PAGE_SIZE = 10

export default function CustomerListPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { formatPhone, maskData } = useDisplaySettings()

  // ── Filter state (UI input)
  const [searchTerm, setSearchTerm]   = useState('')
  const [selectedType, setSelectedType]     = useState('')
  const [selectedTier, setSelectedTier]     = useState('')
  const [selectedOwner, setSelectedOwner]   = useState('')
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [isAddModalOpen, setIsAddModalOpen]       = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)

  // Debounced search → tránh fire query mỗi keystroke
  const debouncedSearch = useDebouncedValue(searchTerm, 300)

  // ── Server-side query qua customer_summary_view
  const listParams = useMemo(() => ({
    page: currentPage,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    customerType: selectedType || undefined,
    valueTier: selectedTier || undefined,
    ownerId: selectedOwner || undefined,
    overdueOnly: filterOverdueOnly || undefined,
  }), [currentPage, debouncedSearch, selectedType, selectedTier, selectedOwner, filterOverdueOnly])

  const customersQuery   = useCustomersList(listParams)
  const salesRepsQuery   = useSalesReps()
  const classifications  = useCustomerClassifications().data ?? []
  const tiers            = useCustomerTiers().data ?? []
  const kpisQuery        = useCustomerKPIs()

  const rows       = customersQuery.data?.rows ?? []
  const totalItems = customersQuery.data?.total ?? 0
  const loading    = customersQuery.isLoading
  const salesReps  = salesRepsQuery.data ?? []
  const kpis       = kpisQuery.data ?? { total: 0, overdue: 0, vip: 0 }

  const classLabels = useMemo(
    () => classifications.reduce<Record<string, string>>((acc, c) => ({ ...acc, [c.code]: c.name }), {}),
    [classifications]
  )
  const tierLabels = useMemo(
    () => tiers.reduce<Record<string, string>>((acc, t) => ({ ...acc, [t.code]: t.name }), {}),
    [tiers]
  )
  const repsById = useMemo(
    () => salesReps.reduce<Record<string, { full_name: string; avatar_url?: string | null }>>(
      (acc, r) => ({ ...acc, [r.id]: { full_name: r.full_name, avatar_url: (r as any).avatar_url } }), {}),
    [salesReps]
  )

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const startIndex = (currentPage - 1) * PAGE_SIZE

  // ── Helpers
  const handleResetFilters = () => {
    setSearchTerm(''); setSelectedType(''); setSelectedTier('')
    setSelectedOwner(''); setFilterOverdueOnly(false); setCurrentPage(1)
  }

  const handleAddSuccess = (newCustomerId?: string) => {
    setIsAddModalOpen(false)
    queryClient.invalidateQueries({ queryKey: qk.customers.all })
    queryClient.invalidateQueries({ queryKey: ['customers', 'kpis'] })
    if (newCustomerId) navigate(`/customers/${newCustomerId}`)
  }

  const handleImportSuccess = () => {
    setIsImportModalOpen(false)
    queryClient.invalidateQueries({ queryKey: qk.customers.all })
    queryClient.invalidateQueries({ queryKey: ['customers', 'kpis'] })
  }

  const formatVND = (num: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num)

  const getLastPurchaseDate = (row: CustomerSummaryRow) =>
    row.last_order_at ? new Date(row.last_order_at).toLocaleDateString('vi-VN') : 'Chưa giao dịch'

  // ── Export CSV: lấy toàn bộ filtered set (không paginate), không động trang hiện tại
  const handleExportCSV = async () => {
    try {
      let q = supabase
        .from('customer_summary_view')
        .select('*')
        .order('created_at', { ascending: false })
      if (selectedType)  q = q.eq('customer_type', selectedType)
      if (selectedTier)  q = q.eq('value_tier', selectedTier)
      if (selectedOwner) q = q.eq('owner_user_id', selectedOwner)
      if (filterOverdueOnly) q = q.eq('is_overdue', true)
      if (debouncedSearch) {
        const term = debouncedSearch.trim().replace(/[%_]/g, '\\$&')
        q = q.or(`farm_name.ilike.%${term}%,code.ilike.%${term}%`)
      }
      const { data, error } = await q
      if (error) throw error

      const headers = [
        'Mã khách hàng','Tên trang trại/Doanh nghiệp','Phân loại','Hạng khách hàng',
        'Tỉnh/Thành phố','Quận/Huyện','Địa chỉ','Hạn mức công nợ (VND)','Tổng nợ hiện tại (VND)',
        'Người liên hệ chính','Số điện thoại chính','Nhân viên phụ trách','Trạng thái hoạt động','Ngày tạo'
      ]

      const exportRows = (data as CustomerSummaryRow[] ?? []).map(cust => [
        cust.code || '',
        cust.farm_name,
        classLabels[cust.customer_type] || cust.customer_type,
        tierLabels[cust.value_tier] || cust.value_tier,
        cust.province || '',
        cust.district || '',
        cust.address || '',
        cust.credit_limit,
        cust.total_debt,
        cust.primary_contact?.full_name || '',
        cust.primary_contact?.phone || '',
        repsById[cust.owner_user_id]?.full_name || 'Hệ thống',
        cust.is_active ? 'Hoạt động' : 'Tạm khóa',
        new Date(cust.created_at).toLocaleDateString('vi-VN'),
      ])

      const csvContent = '﻿' + [
        headers.join(','),
        ...exportRows.map(row =>
          row.map(val => {
            const text = String(val ?? '').replace(/"/g, '""')
            return text.includes(',') || text.includes('\n') || text.includes('"') ? `"${text}"` : text
          }).join(',')
        )
      ].join('\n')

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
    } catch (err: any) {
      logger.error('[CustomerListPage] export error:', err?.message ?? err)
      alert('Xuất CSV thất bại. Vui lòng thử lại.')
    }
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
          <div className="flex-grow min-w-[280px]">
            <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Tìm kiếm</label>
            <div className="relative flex items-center bg-gray-25 rounded-lg border border-gray-100 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-150 transition-all">
              <Search className="text-gray-400 ml-3 mr-2" size={16} strokeWidth={1.5} />
              <input
                className="bg-transparent border-none focus:ring-0 text-body-md w-full placeholder-gray-400 py-2 pl-0 pr-4 focus:outline-none"
                placeholder="Mã, tên khách hàng..."
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="p-1.5 text-gray-400 hover:bg-gray-50 rounded-full mr-2">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="w-full sm:w-48">
            <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Phân loại</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedType}
              onChange={(e) => { setSelectedType(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Tất cả phân loại</option>
              {classifications.filter(c => c.is_active).map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-40">
            <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Hạng khách hàng</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedTier}
              onChange={(e) => { setSelectedTier(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Tất cả hạng</option>
              {tiers.filter(t => t.is_active).map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-48">
            <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Nhân viên phụ trách</label>
            <select
              className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
              value={selectedOwner}
              onChange={(e) => { setSelectedOwner(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Tất cả nhân viên</option>
              {salesReps.map((rep: any) => (
                <option key={rep.id} value={rep.id}>{rep.full_name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 h-10 pb-0.5 px-2 select-none">
            <span className="text-body-md font-semibold text-gray-500">Nợ quá hạn</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                className="sr-only peer"
                type="checkbox"
                checked={filterOverdueOnly}
                onChange={(e) => { setFilterOverdueOnly(e.target.checked); setCurrentPage(1) }}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
            </label>
          </div>

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
            <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={6} /></tbody></table>
          ) : rows.length === 0 ? (
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
                  {rows.map((customer) => {
                    const owner = repsById[customer.owner_user_id]
                    const primaryContact = customer.primary_contact
                    const totalDebt = Number(customer.total_debt || 0)
                    const isOverdue  = customer.is_overdue
                    const showDropdown = activeDropdown === customer.id

                    return (
                      <tr
                        key={customer.id}
                        className="hover:bg-gray-25/50 transition-colors cursor-pointer group"
                        onClick={() => navigate(`/customers/${customer.id}`)}
                      >
                        <td className="px-6 py-5 text-body-md text-blue-500 font-bold font-sans">
                          {customer.code || 'Đang cấp...'}
                        </td>

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

                        <td className="px-6 py-5">
                          <span className={`px-2.5 py-1 rounded-full border text-tiny font-semibold inline-flex items-center gap-1.5 ${
                            CUSTOMER_TYPE_COLORS[customer.customer_type] || CUSTOMER_TYPE_COLORS.other
                          }`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                            {classLabels[customer.customer_type] || customer.customer_type}
                          </span>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            {owner?.avatar_url ? (
                              <img src={owner.avatar_url} alt={owner.full_name} className="w-6 h-6 rounded-full object-cover" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-500 border border-blue-100 flex items-center justify-center text-tiny font-semibold uppercase">
                                {owner?.full_name?.charAt(0) || 'S'}
                              </div>
                            )}
                            <span className="text-body-md text-gray-600 font-medium">
                              {owner?.full_name || 'Hệ thống'}
                            </span>
                          </div>
                        </td>

                        <td className={`px-6 py-5 text-right text-body-md font-bold tabular-nums ${
                          isOverdue ? 'text-danger-500' : totalDebt > 0 ? 'text-gray-600' : 'text-gray-400'
                        }`}>
                          {totalDebt > 0 ? formatVND(totalDebt) : '0 ₫'}
                          {isOverdue && (
                            <span className="block text-[10px] text-danger-500 font-normal mt-0.5">Quá hạn thanh toán</span>
                          )}
                        </td>

                        <td className="px-6 py-5 text-body-md text-gray-400">
                          {getLastPurchaseDate(customer)}
                        </td>

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
                                <div className="fixed inset-0 z-10" onClick={() => setActiveDropdown(null)} />
                                <div className="absolute right-0 mt-1 w-36 bg-gray-0 border border-gray-100 rounded-lg shadow-lg py-1 z-20 animate-in fade-in slide-in-from-top-1 duration-100">
                                  <button
                                    onClick={() => { setActiveDropdown(null); navigate(`/customers/${customer.id}`) }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-body-md text-gray-600 hover:bg-gray-50 text-left font-medium"
                                  >
                                    <Eye size={14} /> Xem chi tiết
                                  </button>
                                  <button
                                    onClick={() => { setActiveDropdown(null); navigate(`/customers/${customer.id}?edit=true`) }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-body-md text-gray-600 hover:bg-gray-50 text-left font-medium"
                                  >
                                    <Edit2 size={14} /> Chỉnh sửa
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
                Hiển thị <span className="font-semibold text-gray-500">{startIndex + 1}</span> - <span className="font-semibold text-gray-500">{Math.min(startIndex + PAGE_SIZE, totalItems)}</span> trên tổng số <span className="font-semibold text-gray-500">{totalItems}</span> khách hàng
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
                    if (page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1)) {
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

        {/* KPI Footer (tổng toàn bộ DB, không bị filter) */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-200 transition-all">
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 flex-shrink-0">
                <Users size={22} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-body-md font-semibold text-gray-400">Tổng khách hàng</p>
                <p className="text-[28px] font-bold text-gray-700 leading-tight mt-1 tabular-nums">{kpis.total}</p>
              </div>
            </div>

            <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-200 transition-all">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-danger-500 flex-shrink-0">
                <AlertCircle size={22} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-body-md font-semibold text-gray-400">Khách nợ quá hạn</p>
                <p className="text-[28px] font-bold text-danger-500 leading-tight mt-1 tabular-nums">{kpis.overdue}</p>
              </div>
            </div>

            <div className="bg-gray-0 p-6 rounded-xl border border-gray-100 flex items-center gap-4 shadow-sm hover:border-gray-200 transition-all">
              <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 flex-shrink-0">
                <UserCheck size={22} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-body-md font-semibold text-gray-400">Khách hàng VIP</p>
                <p className="text-[28px] font-bold text-gray-700 leading-tight mt-1 tabular-nums">{kpis.vip}</p>
              </div>
            </div>
          </div>
        )}

        <AddCustomerModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={handleAddSuccess}
        />

        <ImportCustomersModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={handleImportSuccess}
          classifications={classifications}
          tiers={tiers}
          salesReps={salesReps as any}
        />
      </div>
    </Layout>
  )
}
