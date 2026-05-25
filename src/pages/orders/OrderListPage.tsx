import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
  Monitor
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface Order {
  id: string
  order_code: string
  created_at: string
  status: string
  payment_status: string
  grand_total: number
  paid_amount: number
  customer_id: string
  customers?: {
    farm_name: string
  }
  owner?: {
    full_name: string
  }
}

export default function OrderListPage() {
  const navigate = useNavigate()

  // State
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  // Filters State
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('')
  const [selectedDateRange, setSelectedDateRange] = useState('all') // 'all', 'today', '7days', '30days'

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 8

  // Fetch Orders
  const loadOrders = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_code,
          created_at,
          status,
          payment_status,
          grand_total,
          paid_amount,
          customer_id,
          customers:customers(farm_name),
          owner:profiles!orders_owner_user_id_fkey(full_name)
        `)
        .order('created_at', { ascending: false })

      if (!error && data) {
        setOrders(data as unknown as Order[])
      } else {
        console.error('Error fetching orders:', error)
      }
    } catch (err) {
      console.error('Error loading orders:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [])

  // Filter logic
  const filteredOrders = orders.filter(order => {
    // 1. Search term match
    const term = searchTerm.toLowerCase().trim()
    const matchesSearch =
      order.order_code.toLowerCase().includes(term) ||
      (order.customers?.farm_name || '').toLowerCase().includes(term)

    // 2. Status match
    const matchesStatus = !selectedStatus || order.status === selectedStatus

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

    return matchesSearch && matchesStatus && matchesPaymentStatus && matchesDate
  })

  // Pagination calculations
  const totalItems = filteredOrders.length
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentOrders = filteredOrders.slice(indexOfFirstItem, indexOfLastItem)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedStatus, selectedPaymentStatus, selectedDateRange])

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

        {/* Filter Bar */}
        <div className="bg-gray-0 border border-gray-100 rounded-xl p-5 mb-8 flex flex-wrap items-center gap-4 shadow-sm">
          <div className="flex-1 min-w-[200px] relative">
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

          <div className="w-full sm:w-auto min-w-[150px]">
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

          <div className="w-full sm:w-auto min-w-[180px]">
            <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Trạng thái thanh toán
            </label>
            <select
              className="w-full h-10 border border-gray-200 rounded-lg text-body-md px-3 bg-gray-0 focus:outline-none focus:border-blue-500 focus:ring-[4px] focus:ring-blue-100 transition-all"
              value={selectedPaymentStatus}
              onChange={e => setSelectedPaymentStatus(e.target.value)}
            >
              <option value="">Tất cả thanh toán</option>
              <option value="unpaid">Chưa thanh toán</option>
              <option value="partially_paid">Thanh toán 1 phần</option>
              <option value="paid">Đã thanh toán đủ</option>
            </select>
          </div>

          <div className="w-full sm:w-auto min-w-[150px]">
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
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-gray-100 border-t-blue-500 rounded-full animate-spin"></div>
            <p className="text-body-md text-gray-400">Đang tải danh sách đơn hàng...</p>
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
            <div className="overflow-x-auto">
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
      </div>
    </Layout>
  )
}
