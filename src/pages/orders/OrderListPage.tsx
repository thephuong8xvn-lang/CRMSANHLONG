import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Receipt,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  User,
  Smartphone,
  Monitor,
  Filter,
  X
} from 'lucide-react'
import Layout from '../../components/Layout'
import { useRealtimeTable } from '../../hooks/useRealtimeTable'
import { Skeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAuth } from '../../contexts/AuthContext'

interface Order {
  id: string
  order_code: string
  created_at: string
  status: string
  sale_channel?: string
  payment_status: string
  grand_total: number
  paid_amount: number
  customer_id: string
  branch_id?: string
  customers?: {
    farm_name: string
  }
  owner?: {
    full_name: string
  }
}

export default function OrderListPage() {
  const navigate = useNavigate()
  const { profile, userRole } = useAuth()

  // State
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  // Filters State
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebouncedValue(searchTerm, 300)
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('') // '', 'pos_quick', 'delivery'
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('')
  const [selectedDateRange, setSelectedDateRange] = useState('all') // 'all', 'today', '7days', '30days'
  const [quickDeliveryPending, setQuickDeliveryPending] = useState(false) // lọc nhanh đơn giao chờ xác nhận
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 8

  // Fetch Orders
  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const restrictBranch =
        userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id

      // fetchAllRows: nạp đủ đơn (>1000) thay vì bị giới hạn 1000 dòng mặc định
      const data = await fetchAllRows<Order>((from, to) => {
        let query = supabase
          .from('orders')
          .select(`
            id,
            order_code,
            created_at,
            status,
            sale_channel,
            payment_status,
            grand_total,
            paid_amount,
            customer_id,
            branch_id,
            customers:customers(farm_name),
            owner:profiles!orders_owner_user_id_fkey(full_name)
          `)
        if (restrictBranch) {
          query = query.eq('branch_id', profile!.branch_id)
        }
        return query.order('created_at', { ascending: false }).order('id').range(from, to)
      })
      setOrders(data)
    } catch (err) {
      console.error('Error loading orders:', err)
    } finally {
      setLoading(false)
    }
  }, [profile?.branch_id, userRole?.code])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  useRealtimeTable({ table: 'orders', event: 'INSERT', onData: loadOrders })

  // Filter logic
  const filteredOrders = orders.filter(order => {
    // 1. Search term match
    const term = debouncedSearch.toLowerCase().trim()
    const matchesSearch =
      order.order_code.toLowerCase().includes(term) ||
      (order.customers?.farm_name || '').toLowerCase().includes(term)

    // 2. Status match
    const matchesStatus = !selectedStatus || order.status === selectedStatus

    // Luồng bán
    const matchesChannel = !selectedChannel || (order.sale_channel || 'pos_quick') === selectedChannel

    // 3. Payment status match
    const matchesPaymentStatus = !selectedPaymentStatus || order.payment_status === selectedPaymentStatus

    // 4. Date range match
    let matchesDate = true
    if (selectedDateRange !== 'all') {
      const createdDate = new Date(order.created_at)
      const now = new Date()
      const diffTime = Math.abs(now.getTime() - createdDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      if (selectedDateRange === 'today') {
        matchesDate = createdDate.toDateString() === now.toDateString()
      } else if (selectedDateRange === '7days') {
        matchesDate = diffDays <= 7
      } else if (selectedDateRange === '30days') {
        matchesDate = diffDays <= 30
      }
    }

    // 5. Quick view: đơn giao hàng đang chờ Admin xác nhận
    const matchesQuick = !quickDeliveryPending || (order.sale_channel === 'delivery' && order.status === 'draft')

    return matchesSearch && matchesStatus && matchesChannel && matchesPaymentStatus && matchesDate && matchesQuick
  })

  // Số đơn giao chờ xác nhận (cho badge quick view)
  const deliveryPendingCount = orders.filter(o => o.sale_channel === 'delivery' && o.status === 'draft').length

  // Pagination calculations
  const totalItems = filteredOrders.length
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentOrders = filteredOrders.slice(indexOfFirstItem, indexOfLastItem)

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, selectedStatus, selectedChannel, selectedPaymentStatus, selectedDateRange, quickDeliveryPending])

  // Helper to format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)
  }

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Render Status Badge
  const renderStatusBadge = (status: string) => {
    let text = 'Nháp'
    let textColor = 'text-gray-700'
    let Icon = Clock

    switch (status) {
      case 'draft':
        text = 'Nháp'
        textColor = 'text-gray-600'
        Icon = Clock
        break
      case 'confirmed':
        text = 'Đã xác nhận'
        textColor = 'text-blue-700'
        Icon = Clock
        break
      case 'shipping':
        text = 'Đang giao'
        textColor = 'text-amber-700'
        Icon = Clock
        break
      case 'delivered':
        text = 'Đã giao'
        textColor = 'text-blue-800'
        Icon = CheckCircle
        break
      case 'paid':
        text = 'Đã thanh toán'
        textColor = 'text-emerald-700'
        Icon = CheckCircle
        break
      case 'completed':
        text = 'Hoàn tất'
        textColor = 'text-emerald-800'
        Icon = CheckCircle
        break
      case 'cancelled':
        text = 'Đã hủy'
        textColor = 'text-red-700'
        Icon = XCircle
        break
      case 'returned_partial':
        text = 'Trả hàng 1 phần'
        textColor = 'text-rose-700'
        Icon = AlertCircle
        break
      case 'returned_full':
        text = 'Trả hàng toàn bộ'
        textColor = 'text-rose-800'
        Icon = XCircle
        break
    }

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-tiny font-semibold bg-gray-50 border border-gray-150 ${textColor}`}>
        <Icon size={12} className="shrink-0 text-current" />
        {text}
      </span>
    )
  }

  // Render Payment Status Badge
  const renderPaymentStatusBadge = (status: string) => {
    let text = 'Chưa thanh toán'
    let dotColor = 'bg-red-400'
    let textColor = 'text-red-700'

    switch (status) {
      case 'unpaid':
        text = 'Chưa thanh toán'
        dotColor = 'bg-red-400'
        textColor = 'text-red-700'
        break
      case 'partially_paid':
        text = 'Thanh toán 1 phần'
        dotColor = 'bg-amber-400'
        textColor = 'text-amber-700'
        break
      case 'paid':
        text = 'Đã thanh toán đủ'
        dotColor = 'bg-emerald-500'
        textColor = 'text-emerald-700'
        break
    }

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-tiny font-semibold bg-gray-50 border border-gray-150 ${textColor}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>
        {text}
      </span>
    )
  }

  const displayList = currentOrders

  return (
    <Layout activeMenu="Đơn hàng">
      <div className="p-4 md:p-8">
        
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
          <div>
            <h2 className="text-display-sm font-bold text-gray-800">Quản lý Đơn hàng</h2>
            <p className="text-body-md text-gray-500">Xem, tạo mới và quản lý vòng đời đơn hàng, hóa đơn bán hàng</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/orders/mobile')}
              className="h-10 px-4 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2"
            >
              <Smartphone size={16} className="text-blue-500" />
              Lên đơn Mobile
            </button>
            <button
              onClick={() => navigate('/orders/pos')}
              className="h-10 px-5 bg-blue-500 text-gray-0 rounded-lg text-body-md font-semibold flex items-center gap-2 hover:bg-blue-600 active:scale-[0.98] transition-all shadow-sm"
            >
              <Monitor size={18} />
              Bán hàng POS
            </button>
          </div>
        </div>

        {/* Quick view: đơn giao hàng chờ xác nhận */}
        {(deliveryPendingCount > 0 || quickDeliveryPending) && (
          <button
            onClick={() => setQuickDeliveryPending(v => !v)}
            className={`mb-6 w-full sm:w-auto flex items-center gap-2 px-4 py-2.5 rounded-xl border text-body-md font-semibold transition-all ${
              quickDeliveryPending
                ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
            }`}
          >
            <Clock size={16} />
            Đơn giao chờ xác nhận
            <span className={`px-2 py-0.5 rounded-full text-tiny font-bold ${quickDeliveryPending ? 'bg-white/25' : 'bg-amber-200 text-amber-900'}`}>
              {deliveryPendingCount}
            </span>
            {quickDeliveryPending && <span className="text-tiny font-normal opacity-90">• Bấm để bỏ lọc</span>}
          </button>
        )}

        {/* Filter Bar */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 mb-8 flex flex-wrap items-end gap-4 shadow-sm">
          <div className="flex-grow min-w-[200px] flex gap-3 items-end">
            <div className="flex-1 relative">
              <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Tìm kiếm
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  className="w-full h-10 pl-9 pr-4 bg-gray-0 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
                  placeholder="Tìm mã đơn hàng, tên khách hàng..."
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <button
              onClick={() => setMobileFiltersOpen(true)}
              className="flex md:hidden h-10 px-4 border border-gray-200 bg-white hover:bg-gray-50 rounded-lg text-body-md font-semibold text-gray-600 items-center justify-center gap-2 shadow-sm transition-all"
            >
              <Filter size={16} className="text-gray-400" />
              <span>Lọc</span>
              {(selectedStatus || selectedChannel || selectedPaymentStatus || selectedDateRange !== 'all') && (
                <span className="w-2 h-2 rounded-full bg-blue-500" />
              )}
            </button>
          </div>

          <div className="hidden md:block w-full sm:w-auto min-w-[150px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Trạng thái đơn hàng
            </label>
            <select
              className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="draft">Nháp</option>
              <option value="confirmed">Đã xác nhận</option>
              <option value="shipping">Đang giao</option>
              <option value="delivered">Đã giao</option>
              <option value="paid">Đã thanh toán</option>
              <option value="completed">Hoàn tất</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>

          <div className="hidden md:block w-full sm:w-auto min-w-[160px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Luồng bán
            </label>
            <select
              className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
              value={selectedChannel}
              onChange={e => setSelectedChannel(e.target.value)}
            >
              <option value="">Tất cả luồng</option>
              <option value="pos_quick">Bán nhanh tại quầy</option>
              <option value="delivery">Bán giao hàng</option>
            </select>
          </div>

          <div className="hidden md:block w-full sm:w-auto min-w-[180px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Trạng thái thanh toán
            </label>
            <select
              className="w-full h-10 border border-gray-25 border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
              value={selectedPaymentStatus}
              onChange={e => setSelectedPaymentStatus(e.target.value)}
            >
              <option value="">Tất cả thanh toán</option>
              <option value="unpaid">Chưa thanh toán</option>
              <option value="partially_paid">Thanh toán 1 phần</option>
              <option value="paid">Đã thanh toán đủ</option>
            </select>
          </div>

          <div className="hidden md:block w-full sm:w-auto min-w-[150px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Thời gian tạo
            </label>
            <select
              className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
              value={selectedDateRange}
              onChange={e => setSelectedDateRange(e.target.value)}
            >
              <option value="all">Mọi thời gian</option>
              <option value="today">Hôm nay</option>
              <option value="7days">7 ngày qua</option>
              <option value="30days">30 ngày qua</option>
            </select>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={7} /></tbody></table>
          </div>
        )}

        {/* Empty State */}
        {!loading && displayList.length === 0 && (
          <div className="bg-gray-0 border border-gray-100 rounded-xl p-12 text-center flex flex-col items-center justify-center shadow-sm">
            <div className="w-16 h-16 bg-gray-50 flex items-center justify-center rounded-full text-gray-400 mb-4">
              <Receipt size={32} strokeWidth={1.5} />
            </div>
            <h3 className="text-body-lg font-semibold text-gray-700 mb-1">Không tìm thấy đơn hàng nào</h3>
            <p className="text-body-md text-gray-400 max-w-sm mb-6">
              Vui lòng điều chỉnh lại bộ lọc hoặc bắt đầu lên đơn hàng đầu tiên.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/orders/mobile')}
                className="h-10 px-4 border border-gray-200 text-gray-700 rounded-lg text-body-md font-semibold hover:bg-gray-50 transition-all flex items-center gap-2"
              >
                <Smartphone size={16} />
                Lên đơn di động
              </button>
              <button
                onClick={() => navigate('/orders/pos')}
                className="h-10 px-4 bg-blue-500 text-gray-0 rounded-lg text-body-md font-semibold hover:bg-blue-600 transition-all flex items-center gap-2"
              >
                <Monitor size={16} />
                Bán hàng POS
              </button>
            </div>
          </div>
        )}

        {/* Data Table */}
        {!loading && displayList.length > 0 && (
          <div className="bg-gray-0 border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-gray-25 text-gray-400 font-semibold text-tiny uppercase tracking-wider border-b border-gray-100">
                    <th className="px-6 py-4">Mã đơn hàng</th>
                    <th className="px-6 py-4">Khách hàng / Trang trại</th>
                    <th className="px-6 py-4">Ngày tạo</th>
                    <th className="px-6 py-4">Nhân viên phụ trách</th>
                    <th className="px-6 py-4 text-right">Tổng giá trị</th>
                    <th className="px-6 py-4 text-center">Thanh toán</th>
                    <th className="px-6 py-4 text-center">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-body-md text-gray-700">
                  {displayList.map(order => (
                    <tr
                      key={order.id}
                      onClick={() => navigate(`/orders/${order.id}`)}
                      className="transition-colors group hover:bg-gray-25/50 cursor-pointer"
                    >
                      <td className="px-6 py-4 font-mono font-bold text-blue-600 group-hover:underline">
                        {order.order_code}
                      </td>
                      <td className="px-6 py-4 font-semibold text-gray-800">
                        {order.customers?.farm_name || 'Khách lẻ / Không xác định'}
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-tiny">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-gray-500">
                          <User size={14} className="text-gray-400" />
                          <span>{order.owner?.full_name || 'Hệ thống'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-gray-800 tabular-nums">
                        {formatCurrency(order.grand_total)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {renderPaymentStatusBadge(order.payment_status)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {renderStatusBadge(order.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="block md:hidden divide-y divide-gray-100">
              {displayList.map(order => (
                <div
                  key={order.id}
                  onClick={() => navigate(`/orders/${order.id}`)}
                  className="p-4 hover:bg-gray-25/50 transition-colors cursor-pointer space-y-3"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-blue-600">
                        {order.order_code}
                      </span>
                      <h4 className="font-bold text-gray-800 leading-snug break-words mt-1">
                        {order.customers?.farm_name || 'Khách lẻ / Không xác định'}
                      </h4>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {renderStatusBadge(order.status)}
                      {renderPaymentStatusBadge(order.payment_status)}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-gray-50 text-tiny text-gray-500">
                    <div>
                      <span className="text-gray-400 block mb-0.5">Ngày tạo:</span>
                      <span className="text-gray-700 font-semibold">{formatDate(order.created_at)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block mb-0.5">Phụ trách:</span>
                      <span className="text-gray-700 font-semibold truncate block">
                        {order.owner?.full_name || 'Hệ thống'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-400 block mb-0.5">Tổng giá trị:</span>
                      <span className="text-body-lg font-bold text-gray-800 tabular-nums">
                        {formatCurrency(order.grand_total)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pagination Section */}
        {!loading && displayList.length > 0 && (
          <div className="mt-12 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-gray-100 pt-8">
            <span className="text-body-md text-gray-400">
              Hiển thị <span className="font-semibold text-gray-600">{indexOfFirstItem + 1}-{Math.min(indexOfLastItem, totalItems)}</span> của <span className="font-semibold text-gray-600">{totalItems}</span> đơn hàng
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="w-10 h-10 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              >
                <ChevronLeft size={18} />
              </button>
              {Array.from({ length: totalPages }).map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(idx + 1)}
                  className={`w-10 h-10 rounded-lg text-body-md font-semibold transition-all ${
                    currentPage === idx + 1
                      ? 'bg-blue-500 text-gray-0 shadow-sm'
                      : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="w-10 h-10 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Mobile Filter Bottom Sheet */}
        {mobileFiltersOpen && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end justify-center p-0">
            <div className="bg-gray-0 w-full rounded-t-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-250 flex flex-col max-h-[85vh]">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25 shrink-0">
                <h3 className="text-body-lg font-semibold text-gray-700">Bộ lọc đơn hàng</h3>
                <button
                  onClick={() => setMobileFiltersOpen(false)}
                  className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-all focus:outline-none"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4 overflow-y-auto flex-1 font-sans">
                <div>
                  <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Trạng thái đơn hàng</label>
                  <select
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                    value={selectedStatus}
                    onChange={e => { setSelectedStatus(e.target.value); setCurrentPage(1) }}
                  >
                    <option value="">Tất cả trạng thái</option>
                    <option value="draft">Nháp</option>
                    <option value="confirmed">Đã xác nhận</option>
                    <option value="shipping">Đang giao</option>
                    <option value="delivered">Đã giao</option>
                    <option value="paid">Đã thanh toán</option>
                    <option value="completed">Hoàn tất</option>
                    <option value="cancelled">Đã hủy</option>
                  </select>
                </div>

                <div>
                  <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Luồng bán</label>
                  <select
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                    value={selectedChannel}
                    onChange={e => { setSelectedChannel(e.target.value); setCurrentPage(1) }}
                  >
                    <option value="">Tất cả luồng</option>
                    <option value="pos_quick">Bán nhanh tại quầy</option>
                    <option value="delivery">Bán giao hàng</option>
                  </select>
                </div>

                <div>
                  <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Trạng thái thanh toán</label>
                  <select
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                    value={selectedPaymentStatus}
                    onChange={e => { setSelectedPaymentStatus(e.target.value); setCurrentPage(1) }}
                  >
                    <option value="">Tất cả thanh toán</option>
                    <option value="unpaid">Chưa thanh toán</option>
                    <option value="partially_paid">Thanh toán 1 phần</option>
                    <option value="paid">Đã thanh toán đủ</option>
                  </select>
                </div>

                <div>
                  <label className="text-tiny font-bold text-gray-400 mb-1.5 block">Thời gian tạo</label>
                  <select
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                    value={selectedDateRange}
                    onChange={e => { setSelectedDateRange(e.target.value); setCurrentPage(1) }}
                  >
                    <option value="all">Mọi thời gian</option>
                    <option value="today">Hôm nay</option>
                    <option value="7days">7 ngày qua</option>
                    <option value="30days">30 ngày qua</option>
                  </select>
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    onClick={() => {
                      setSelectedStatus('')
                      setSelectedChannel('')
                      setSelectedPaymentStatus('')
                      setSelectedDateRange('all')
                      setCurrentPage(1)
                      setMobileFiltersOpen(false)
                    }}
                    className="flex-1 h-10 border border-gray-200 text-gray-500 bg-gray-0 rounded-lg text-body-md font-semibold flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
                  >
                    Đặt lại
                  </button>
                  <button
                    onClick={() => setMobileFiltersOpen(false)}
                    className="flex-1 h-10 bg-blue-500 text-white rounded-lg text-body-md font-semibold flex items-center justify-center hover:bg-blue-600 transition-colors"
                  >
                    Áp dụng
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
