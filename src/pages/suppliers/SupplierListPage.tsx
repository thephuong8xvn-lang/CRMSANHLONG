import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  MoreVertical,
  X,
  Eye,
  Edit2,
  AlertCircle,
  Truck,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Filter,
  CheckCircle2,
  HelpCircle,
  Building,
  Globe,
  FileText
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface Supplier {
  id: string
  code: string
  name: string
  tax_code: string | null
  website: string | null
  address: string | null
  payment_terms: string | null
  notes: string | null
  is_active: boolean
  created_at: string
}

export default function SupplierListPage() {
  const navigate = useNavigate()
  
  // State
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 8

  // Form State for Adding Supplier
  const [newSupplier, setNewSupplier] = useState({
    name: '',
    tax_code: '',
    website: '',
    address: '',
    payment_terms: 'Net 30',
    notes: ''
  })
  const [submitting, setSubmitting] = useState(false)

  // Fetch Suppliers
  const fetchSuppliers = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      if (data) {
        setSuppliers(data)
      }
    } catch (err: any) {
      console.error('Error fetching suppliers:', err)
      setAlertMsg({ type: 'error', text: 'Không thể tải danh sách nhà cung cấp: ' + err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSuppliers()
  }, [])

  // Auto-clear alert
  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [alertMsg])

  // Filtered Suppliers
  const filteredSuppliers = suppliers.filter(item => {
    const matchesSearch = 
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.tax_code && item.tax_code.includes(searchTerm))

    const matchesStatus = 
      statusFilter === 'all' ||
      (statusFilter === 'active' && item.is_active) ||
      (statusFilter === 'inactive' && !item.is_active)

    return matchesSearch && matchesStatus
  })

  // Pagination
  const totalItems = filteredSuppliers.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedSuppliers = filteredSuppliers.slice(startIndex, startIndex + itemsPerPage)

  // Handle Page Change
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  // Handle Add Supplier Submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSupplier.name.trim()) {
      setAlertMsg({ type: 'error', text: 'Vui lòng nhập tên nhà cung cấp' })
      return
    }

    setSubmitting(true)
    try {
      // Generate a unique supplier code client-side
      const randomId = Math.floor(10000 + Math.random() * 90000)
      const code = `SUP-${randomId}`

      const { data, error } = await supabase
        .from('suppliers')
        .insert([{
          code,
          name: newSupplier.name,
          tax_code: newSupplier.tax_code || null,
          website: newSupplier.website || null,
          address: newSupplier.address || null,
          payment_terms: newSupplier.payment_terms || null,
          notes: newSupplier.notes || null,
          is_active: true
        }])
        .select()

      if (error) throw error

      setAlertMsg({ type: 'success', text: `Đã thêm nhà cung cấp ${newSupplier.name} thành công!` })
      setIsAddModalOpen(false)
      // Reset form
      setNewSupplier({
        name: '',
        tax_code: '',
        website: '',
        address: '',
        payment_terms: 'Net 30',
        notes: ''
      })
      fetchSuppliers()
    } catch (err: any) {
      console.error('Error adding supplier:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi thêm nhà cung cấp: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Toggle active status
  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('suppliers')
        .update({ is_active: !currentStatus })
        .eq('id', id)

      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Cập nhật trạng thái nhà cung cấp thành công!' })
      fetchSuppliers()
    } catch (err: any) {
      console.error('Error toggling supplier status:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi cập nhật trạng thái: ' + err.message })
    }
  }

  return (
    <Layout activeMenu="Nhà cung cấp">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6">
        
        {/* Alerts */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            {alertMsg.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-headline-lg font-bold text-gray-800">Quản lý Nhà cung cấp</h1>
            <p className="text-body-md text-gray-500">Đối tác cung ứng thuốc thú y, vaccine và dụng cụ sinh học</p>
          </div>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm w-full sm:w-auto"
          >
            <Plus size={20} />
            <span>Thêm nhà cung cấp</span>
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500">
              <Truck size={24} />
            </div>
            <div>
              <p className="text-tiny text-gray-400 font-semibold uppercase tracking-wider">Tổng nhà cung cấp</p>
              <h3 className="text-headline-md font-bold text-gray-800">{loading ? '...' : suppliers.length}</h3>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-500">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-tiny text-gray-400 font-semibold uppercase tracking-wider">Đang hợp tác</p>
              <h3 className="text-headline-md font-bold text-gray-800">
                {loading ? '...' : suppliers.filter(s => s.is_active).length}
              </h3>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-amber-50 flex items-center justify-center text-amber-500">
              <Building size={24} />
            </div>
            <div>
              <p className="text-tiny text-gray-400 font-semibold uppercase tracking-wider">Thời hạn thanh toán TB</p>
              <h3 className="text-headline-md font-bold text-gray-800">Net 30/45</h3>
            </div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Tìm theo tên, mã nhà cung cấp, MST..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={() => { setStatusFilter('all'); setCurrentPage(1) }}
              className={`flex-1 md:flex-initial px-4 h-10 rounded-lg text-body-md font-semibold border transition-colors ${
                statusFilter === 'all' 
                  ? 'bg-blue-50 text-blue-700 border-blue-100' 
                  : 'bg-white text-gray-500 border-gray-100 hover:bg-gray-50'
              }`}
            >
              Tất cả
            </button>
            <button
              onClick={() => { setStatusFilter('active'); setCurrentPage(1) }}
              className={`flex-1 md:flex-initial px-4 h-10 rounded-lg text-body-md font-semibold border transition-colors ${
                statusFilter === 'active' 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                  : 'bg-white text-gray-500 border-gray-100 hover:bg-gray-50'
              }`}
            >
              Đang hoạt động
            </button>
            <button
              onClick={() => { setStatusFilter('inactive'); setCurrentPage(1) }}
              className={`flex-1 md:flex-initial px-4 h-10 rounded-lg text-body-md font-semibold border transition-colors ${
                statusFilter === 'inactive' 
                  ? 'bg-red-50 text-red-700 border-red-100' 
                  : 'bg-white text-gray-500 border-gray-100 hover:bg-gray-50'
              }`}
            >
              Ngừng hoạt động
            </button>
          </div>
        </div>

        {/* Suppliers List */}
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-body-md text-gray-400">Đang tải dữ liệu nhà cung cấp...</p>
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-body-lg font-bold text-gray-700 mb-1">Không tìm thấy nhà cung cấp nào</h3>
            <p className="text-body-md text-gray-400">Vui lòng kiểm tra lại điều kiện lọc hoặc thêm mới đối tác.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {paginatedSuppliers.map((supplier) => (
              <div 
                key={supplier.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow relative flex flex-col justify-between group"
              >
                {/* Upper Section */}
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <span className="bg-blue-50 text-blue-700 font-bold text-[10px] px-2 py-0.5 rounded uppercase tracking-wider">
                      {supplier.code}
                    </span>
                    <span className={`w-2.5 h-2.5 rounded-full ${supplier.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} title={supplier.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'} />
                  </div>
                  
                  <h3 className="text-body-lg font-bold text-gray-800 line-clamp-1 group-hover:text-blue-500 transition-colors cursor-pointer" onClick={() => navigate(`/suppliers/${supplier.id}`)}>
                    {supplier.name}
                  </h3>
                  
                  {/* Info lines */}
                  <div className="mt-4 space-y-2 text-body-md text-gray-500">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-gray-400 flex-shrink-0" />
                      <span className="truncate">MST: {supplier.tax_code || 'Chưa cập nhật'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="text-gray-400 flex-shrink-0" />
                      <span className="truncate">{supplier.address || 'Chưa cập nhật'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Building size={14} className="text-gray-400 flex-shrink-0" />
                      <span>Thanh toán: <span className="font-semibold text-gray-700">{supplier.payment_terms || 'Net 30'}</span></span>
                    </div>
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="mt-6 pt-4 border-t border-gray-50 flex items-center justify-between">
                  <button
                    onClick={() => navigate(`/suppliers/${supplier.id}`)}
                    className="text-blue-500 hover:text-blue-600 font-bold text-body-md flex items-center gap-1.5"
                  >
                    <Eye size={16} />
                    <span>Chi tiết</span>
                  </button>

                  <button
                    onClick={() => handleToggleActive(supplier.id, supplier.is_active)}
                    className={`px-3 py-1 rounded text-tiny font-bold border transition-colors ${
                      supplier.is_active
                        ? 'text-red-600 bg-red-50 border-red-100 hover:bg-red-100'
                        : 'text-emerald-600 bg-emerald-50 border-emerald-100 hover:bg-emerald-100'
                    }`}
                  >
                    {supplier.is_active ? 'Khóa' : 'Mở khóa'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination Footer */}
        {!loading && totalPages > 1 && (
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-100 shadow-sm mt-6">
            <span className="text-body-md text-gray-400">
              Hiển thị <span className="font-semibold text-gray-700">{startIndex + 1}</span> - <span className="font-semibold text-gray-700">{Math.min(startIndex + itemsPerPage, totalItems)}</span> trên <span className="font-semibold text-gray-700">{totalItems}</span> đối tác
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-100 text-gray-400 disabled:opacity-50 hover:bg-gray-25 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              {[...Array(totalPages)].map((_, i) => (
                <button
                  key={i}
                  onClick={() => handlePageChange(i + 1)}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg text-body-md font-semibold transition-colors ${
                    currentPage === i + 1
                      ? 'bg-blue-500 text-white'
                      : 'border border-gray-100 text-gray-500 hover:bg-gray-25'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-100 text-gray-400 disabled:opacity-50 hover:bg-gray-25 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Add Supplier Drawer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Thêm nhà cung cấp mới</h3>
                <p className="text-tiny text-gray-400">Điền thông tin doanh nghiệp đối tác cung ứng</p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Tên nhà cung cấp <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="Công ty Dược phẩm Thú y..."
                  value={newSupplier.name}
                  onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã số thuế</label>
                  <input
                    type="text"
                    placeholder="Mã số thuế doanh nghiệp..."
                    value={newSupplier.tax_code}
                    onChange={(e) => setNewSupplier({ ...newSupplier, tax_code: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Thời hạn thanh toán mặc định</label>
                  <select
                    value={newSupplier.payment_terms}
                    onChange={(e) => setNewSupplier({ ...newSupplier, payment_terms: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="Net 15">Net 15 (15 ngày)</option>
                    <option value="Net 30">Net 30 (30 ngày)</option>
                    <option value="Net 45">Net 45 (45 ngày)</option>
                    <option value="Net 60">Net 60 (60 ngày)</option>
                    <option value="COD">Thanh toán khi nhận hàng (COD)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Website</label>
                <div className="relative">
                  <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="https://example.com"
                    value={newSupplier.website}
                    onChange={(e) => setNewSupplier({ ...newSupplier, website: e.target.value })}
                    className="w-full h-10 pl-9 pr-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Địa chỉ</label>
                <div className="relative">
                  <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Số nhà, tên đường, tỉnh/thành..."
                    value={newSupplier.address}
                    onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })}
                    className="w-full h-10 pl-9 pr-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Ghi chú</label>
                <textarea
                  placeholder="Nhập thông tin ghi chú khác về nhà cung cấp..."
                  rows={4}
                  value={newSupplier.notes}
                  onChange={(e) => setNewSupplier({ ...newSupplier, notes: e.target.value })}
                  className="w-full p-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 transition-colors text-gray-600"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center"
                >
                  {submitting ? 'Đang xử lý...' : 'Lưu nhà cung cấp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </Layout>
  )
}
