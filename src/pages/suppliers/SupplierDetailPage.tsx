import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Edit2,
  Plus,
  Trash2,
  Briefcase,
  Phone,
  Mail,
  Check,
  X,
  FileText,
  MapPin,
  Building,
  Globe,
  Star,
  Info,
  DollarSign,
  Calendar,
  Layers,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Award,
  AlertCircle
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

interface Contact {
  id: string
  supplier_id: string
  full_name: string
  position: string | null
  phone: string | null
  email: string | null
  is_primary: boolean
  created_at: string
}

interface PurchaseOrder {
  id: string
  po_code: string
  status: string
  grand_total: number
  expected_date: string | null
  created_at: string
}

interface ProductSupplied {
  id: string
  name: string
  sku: string
  category: string
  last_price: number
  total_received: number
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // States
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [productsSupplied, setProductsSupplied] = useState<ProductSupplied[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'products' | 'contacts' | 'history'>('products')
  
  // Alert message state
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  // Contact Form State
  const [isAddingContact, setIsAddingContact] = useState(false)
  const [newContact, setNewContact] = useState({
    full_name: '',
    position: '',
    phone: '',
    email: '',
    is_primary: false
  })
  
  // Edit Supplier Form State
  const [isEditingSupplier, setIsEditingSupplier] = useState(false)
  const [editSupplierForm, setEditSupplierForm] = useState({
    name: '',
    tax_code: '',
    website: '',
    address: '',
    payment_terms: 'Net 30',
    notes: ''
  })

  // Load All Supplier Data
  const loadSupplierData = async () => {
    if (!id) return
    setLoading(true)
    try {
      // 1. Fetch Supplier details
      const { data: supplierData, error: supplierError } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', id)
        .single()

      if (supplierError) throw supplierError
      setSupplier(supplierData)
      setEditSupplierForm({
        name: supplierData.name || '',
        tax_code: supplierData.tax_code || '',
        website: supplierData.website || '',
        address: supplierData.address || '',
        payment_terms: supplierData.payment_terms || 'Net 30',
        notes: supplierData.notes || ''
      })

      // 2. Fetch Supplier Contacts
      const { data: contactsData, error: contactsError } = await supabase
        .from('supplier_contacts')
        .select('*')
        .eq('supplier_id', id)
        .order('is_primary', { ascending: false })
        .order('full_name')

      if (contactsError) throw contactsError
      setContacts(contactsData || [])

      // 3. Fetch Purchase Orders
      const { data: poData, error: poError } = await supabase
        .from('purchase_orders')
        .select('id, po_code, status, grand_total, expected_date, created_at')
        .eq('supplier_id', id)
        .order('created_at', { ascending: false })

      if (poError) throw poError
      setPurchaseOrders(poData || [])

      // 4. Fetch Products Supplied (from Goods Receipts lines)
      const { data: grLines, error: grError } = await supabase
        .from('goods_receipt_lines')
        .select(`
          quantity,
          unit_price,
          product:products(id, name, sku, category:product_categories(name))
        `)
        .eq('receipt:goods_receipts.supplier_id', id)

      // Since the above nesting filter can be tricky, let's query it reliably.
      // We can select goods receipts first, then get lines.
      const { data: receipts } = await supabase
        .from('goods_receipts')
        .select('id')
        .eq('supplier_id', id)
      
      const receiptIds = receipts?.map(r => r.id) || []
      
      if (receiptIds.length > 0) {
        const { data: lines, error: linesError } = await supabase
          .from('goods_receipt_lines')
          .select(`
            quantity,
            unit_price,
            product_id,
            product:products(
              id, 
              sku, 
              name, 
              category:product_categories(name)
            )
          `)
          .in('receipt_id', receiptIds)

        if (!linesError && lines) {
          // Group by product
          const prodMap: { [key: string]: ProductSupplied } = {}
          lines.forEach((line: any) => {
            if (!line.product) return
            const pId = line.product.id
            if (!prodMap[pId]) {
              prodMap[pId] = {
                id: pId,
                name: line.product.name,
                sku: line.product.sku,
                category: line.product.category?.name || 'Chưa phân loại',
                last_price: Number(line.unit_price),
                total_received: 0
              }
            }
            prodMap[pId].total_received += line.quantity
            prodMap[pId].last_price = Number(line.unit_price) // last price recorded
          })
          setProductsSupplied(Object.values(prodMap))
        }
      } else {
        setProductsSupplied([])
      }

    } catch (err: any) {
      console.error('Error loading supplier detail:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi tải chi tiết nhà cung cấp: ' + err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSupplierData()
  }, [id])

  // Handle Edit Supplier Submit
  const handleEditSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !editSupplierForm.name.trim()) return

    try {
      const { error } = await supabase
        .from('suppliers')
        .update({
          name: editSupplierForm.name,
          tax_code: editSupplierForm.tax_code || null,
          website: editSupplierForm.website || null,
          address: editSupplierForm.address || null,
          payment_terms: editSupplierForm.payment_terms || null,
          notes: editSupplierForm.notes || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Cập nhật nhà cung cấp thành công!' })
      setIsEditingSupplier(false)
      loadSupplierData()
    } catch (err: any) {
      console.error('Error editing supplier:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi cập nhật nhà cung cấp: ' + err.message })
    }
  }

  // Handle Add Contact Submit
  const handleAddContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    if (!newContact.full_name.trim()) {
      setAlertMsg({ type: 'error', text: 'Vui lòng nhập tên người liên hệ' })
      return
    }

    try {
      // If setting as primary, unset other primary contacts first
      if (newContact.is_primary) {
        await supabase
          .from('supplier_contacts')
          .update({ is_primary: false })
          .eq('supplier_id', id)
      }

      const { error } = await supabase
        .from('supplier_contacts')
        .insert([{
          supplier_id: id,
          full_name: newContact.full_name,
          position: newContact.position || null,
          phone: newContact.phone || null,
          email: newContact.email || null,
          is_primary: newContact.is_primary
        }])

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Thêm người liên hệ mới thành công!' })
      setIsAddingContact(false)
      setNewContact({
        full_name: '',
        position: '',
        phone: '',
        email: '',
        is_primary: false
      })
      loadSupplierData()
    } catch (err: any) {
      console.error('Error adding contact:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi thêm người liên hệ: ' + err.message })
    }
  }

  // Handle Delete Contact
  const handleDeleteContact = async (contactId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa người liên hệ này?')) return

    try {
      const { error } = await supabase
        .from('supplier_contacts')
        .delete()
        .eq('id', contactId)

      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Đã xóa người liên hệ thành công!' })
      loadSupplierData()
    } catch (err: any) {
      console.error('Error deleting contact:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi xóa người liên hệ: ' + err.message })
    }
  }

  // Toggle active status
  const handleToggleActive = async () => {
    if (!supplier) return
    try {
      const { error } = await supabase
        .from('suppliers')
        .update({ is_active: !supplier.is_active })
        .eq('id', supplier.id)

      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Cập nhật trạng thái hoạt động thành công!' })
      loadSupplierData()
    } catch (err: any) {
      console.error('Error toggling supplier status:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi cập nhật trạng thái: ' + err.message })
    }
  }

  // Auto-clear alert
  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [alertMsg])

  if (loading) {
    return (
      <Layout activeMenu="Nhà cung cấp">
        <div className="p-12 text-center flex flex-col items-center justify-center gap-3 min-h-[60vh]">
          <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-body-md text-gray-400">Đang tải dữ liệu chi tiết nhà cung cấp...</p>
        </div>
      </Layout>
    )
  }

  if (!supplier) {
    return (
      <Layout activeMenu="Nhà cung cấp">
        <div className="p-12 text-center space-y-4 max-w-md mx-auto">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
          <h2 className="text-headline-md font-bold text-gray-800">Không tìm thấy nhà cung cấp</h2>
          <p className="text-body-md text-gray-500">Dữ liệu đối tác này có thể đã bị xóa hoặc không tồn tại.</p>
          <button onClick={() => navigate('/suppliers')} className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-bold">
            Trở lại danh sách
          </button>
        </div>
      </Layout>
    )
  }

  // Calculated PO total
  const totalOrderedAmount = purchaseOrders.reduce((sum, po) => sum + Number(po.grand_total), 0)

  return (
    <Layout activeMenu="Nhà cung cấp">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8">
        
        {/* Toast Alert */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Breadcrumb & Navigation */}
        <div className="flex items-center gap-2 text-gray-400 text-body-md">
          <button onClick={() => navigate('/suppliers')} className="hover:text-blue-500 font-semibold flex items-center gap-1.5">
            <ArrowLeft size={16} />
            <span>Danh sách Nhà cung cấp</span>
          </button>
          <span>/</span>
          <span className="text-gray-600 font-medium">Chi tiết đối tác</span>
        </div>

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-gray-100">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="bg-blue-50 text-blue-700 font-bold text-[11px] px-2 py-0.5 rounded uppercase tracking-wider">
                {supplier.code}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full font-semibold text-body-md flex items-center gap-1.5 ${
                supplier.is_active 
                  ? 'bg-emerald-50 text-emerald-700' 
                  : 'bg-red-50 text-red-700'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${supplier.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {supplier.is_active ? 'Đang hợp tác' : 'Ngừng hợp tác'}
              </span>
            </div>
            <h2 className="text-headline-lg font-bold text-gray-800">{supplier.name}</h2>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setIsEditingSupplier(true)}
              className="px-5 py-2.5 rounded-lg border border-gray-100 bg-white text-gray-600 font-semibold text-body-md hover:bg-gray-50 flex items-center gap-2 shadow-sm"
            >
              <Edit2 size={16} />
              <span>Chỉnh sửa thông tin</span>
            </button>
            <button
              onClick={handleToggleActive}
              className={`px-5 py-2.5 rounded-lg font-semibold text-body-md transition-colors ${
                supplier.is_active
                  ? 'bg-red-550 text-white hover:bg-red-600'
                  : 'bg-emerald-550 text-white hover:bg-emerald-600'
              }`}
            >
              {supplier.is_active ? 'Ngừng hợp tác' : 'Kích hoạt lại'}
            </button>
          </div>
        </div>

        {/* Bento Grid Info Blocks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Card 1: Basic Info */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-body-lg font-bold text-gray-800">Thông tin cơ bản</h3>
              <Info className="text-gray-400" size={18} />
            </div>
            <div className="space-y-4">
              <div className="flex gap-3">
                <MapPin className="text-gray-400 flex-shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-tiny text-gray-400 font-semibold">Địa chỉ trụ sở</p>
                  <p className="text-body-md text-gray-700 font-medium">{supplier.address || 'Chưa cập nhật'}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <FileText className="text-gray-400 flex-shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-tiny text-gray-400 font-semibold">Mã số thuế</p>
                  <p className="text-body-md text-gray-700 font-semibold">{supplier.tax_code || 'Chưa cập nhật'}</p>
                </div>
              </div>
              {supplier.website && (
                <div className="flex gap-3">
                  <Globe className="text-gray-400 flex-shrink-0 mt-0.5" size={18} />
                  <div>
                    <p className="text-tiny text-gray-400 font-semibold">Website</p>
                    <a href={supplier.website} target="_blank" rel="noreferrer" className="text-body-md text-blue-500 font-medium hover:underline break-all">
                      {supplier.website}
                    </a>
                  </div>
                </div>
              )}
              {supplier.notes && (
                <div className="flex gap-3">
                  <Info className="text-gray-400 flex-shrink-0 mt-0.5" size={18} />
                  <div>
                    <p className="text-tiny text-gray-400 font-semibold">Ghi chú</p>
                    <p className="text-body-md text-gray-500 whitespace-pre-wrap">{supplier.notes}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Rating & Reputation */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-body-lg font-bold text-gray-800">Đánh giá uy tín</h3>
                <span className="px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold text-tiny uppercase tracking-wider">Hạng A</span>
              </div>
              <div className="flex items-center gap-6 mb-4">
                <div className="text-center">
                  <p className="text-[44px] font-bold text-gray-800 leading-none">4.8</p>
                  <p className="text-tiny text-gray-400 font-semibold mt-1">trên 5.0</p>
                </div>
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 text-tiny font-bold text-gray-400">5</span>
                    <div className="flex-1 h-2 bg-gray-50 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: '85%' }}></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 text-tiny font-bold text-gray-400">4</span>
                    <div className="flex-1 h-2 bg-gray-50 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: '15%' }}></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-gray-300">
                    <span className="w-2 text-tiny font-bold">3</span>
                    <div className="flex-1 h-2 bg-gray-50 rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-gray-50">
              <p className="text-tiny text-gray-400">Đánh giá định kỳ mới nhất: Q3/2023</p>
              <span className="text-blue-500 font-bold text-body-md cursor-pointer hover:underline">Chi tiết</span>
            </div>
          </div>

          {/* Card 3: Financial Summary */}
          <div className="bg-primary-container text-white border border-blue-800 rounded-xl p-6 shadow-sm relative overflow-hidden flex flex-col justify-between">
            <div className="relative z-10 space-y-1">
              <p className="text-body-md text-blue-100 font-medium">Tổng giá trị đặt mua</p>
              <h3 className="text-headline-lg font-bold">{totalOrderedAmount.toLocaleString('vi-VN')} ₫</h3>
              <p className="text-tiny text-blue-200">Gồm tất cả đơn PO đã lập với đối tác</p>
            </div>
            <div className="relative z-10 mt-6 space-y-3">
              <div className="flex justify-between text-blue-100 text-body-md">
                <span>Điều khoản thanh toán</span>
                <span className="font-bold text-white">{supplier.payment_terms || 'Net 30'}</span>
              </div>
              <div className="flex items-center gap-2 text-blue-100">
                <Calendar size={16} />
                <span className="text-tiny">Khởi tạo: {new Date(supplier.created_at).toLocaleDateString('vi-VN')}</span>
              </div>
            </div>
            {/* Pattern background */}
            <div className="absolute -right-8 -bottom-8 opacity-10 text-white">
              <DollarSign size={160} />
            </div>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-100 px-6">
            <button
              onClick={() => setActiveTab('products')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 ${
                activeTab === 'products'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Sản phẩm đã cung cấp ({productsSupplied.length})
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 ${
                activeTab === 'contacts'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Người liên hệ ({contacts.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 ${
                activeTab === 'history'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Lịch sử mua hàng ({purchaseOrders.length})
            </button>
          </div>

          {/* Tab 1: Products */}
          {activeTab === 'products' && (
            <div className="overflow-x-auto">
              {productsSupplied.length === 0 ? (
                <div className="p-12 text-center text-gray-400 space-y-2">
                  <Layers className="w-12 h-12 text-gray-300 mx-auto" />
                  <p className="font-semibold text-body-lg">Chưa ghi nhận nhập sản phẩm nào</p>
                  <p className="text-body-md">Các sản phẩm sẽ xuất hiện ở đây sau khi bạn tạo Phiếu nhập kho từ nhà cung cấp này.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-25 border-b border-gray-100">
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Tên sản phẩm</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Mã SKU</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Danh mục</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider text-right">Đơn giá nhập cuối</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider text-center">Tổng lượng đã nhập</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {productsSupplied.map((prod) => (
                      <tr key={prod.id} className="hover:bg-gray-25 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-body-md font-bold text-gray-800">{prod.name}</p>
                        </td>
                        <td className="px-6 py-4 text-body-md text-gray-500 font-semibold">{prod.sku}</td>
                        <td className="px-6 py-4">
                          <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-tiny font-bold">
                            {prod.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-body-md text-gray-700 font-semibold text-right">
                          {prod.last_price.toLocaleString('vi-VN')} ₫
                        </td>
                        <td className="px-6 py-4 text-body-md text-gray-500 text-center font-semibold">
                          {prod.total_received}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab 2: Contacts */}
          {activeTab === 'contacts' && (
            <div className="p-6 space-y-6">
              <div className="flex justify-between items-center">
                <h4 className="text-body-lg font-bold text-gray-700">Đầu mối liên hệ</h4>
                <button
                  onClick={() => setIsAddingContact(true)}
                  className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-semibold text-body-md hover:bg-blue-100 flex items-center gap-2 transition-colors"
                >
                  <Plus size={16} />
                  <span>Thêm người liên hệ</span>
                </button>
              </div>

              {contacts.length === 0 ? (
                <div className="p-8 text-center text-gray-400 border border-dashed border-gray-100 rounded-lg">
                  <p className="font-semibold text-body-lg">Chưa có thông tin liên hệ nào</p>
                  <p className="text-body-md">Hãy click nút Thêm người liên hệ để lưu thông tin đại diện nhà cung cấp.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className={`p-5 rounded-xl border relative space-y-3 ${
                        contact.is_primary 
                          ? 'border-blue-100 bg-blue-25/30' 
                          : 'border-gray-100 bg-white'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h5 className="text-body-lg font-bold text-gray-800">{contact.full_name}</h5>
                          {contact.position && (
                            <p className="text-tiny text-gray-400 font-semibold flex items-center gap-1.5 mt-0.5">
                              <Briefcase size={12} />
                              {contact.position}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {contact.is_primary && (
                            <span className="bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase">Chính</span>
                          )}
                          <button
                            onClick={() => handleDeleteContact(contact.id)}
                            className="p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded transition-colors"
                            title="Xóa liên hệ"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2 text-body-md text-gray-500 pt-2 border-t border-gray-50">
                        {contact.phone && (
                          <div className="flex items-center gap-2">
                            <Phone size={14} className="text-gray-400" />
                            <a href={`tel:${contact.phone}`} className="hover:text-blue-500 hover:underline">{contact.phone}</a>
                          </div>
                        )}
                        {contact.email && (
                          <div className="flex items-center gap-2">
                            <Mail size={14} className="text-gray-400" />
                            <a href={`mailto:${contact.email}`} className="hover:text-blue-500 hover:underline break-all">{contact.email}</a>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: History */}
          {activeTab === 'history' && (
            <div className="overflow-x-auto">
              {purchaseOrders.length === 0 ? (
                <div className="p-12 text-center text-gray-400 space-y-2">
                  <FileText className="w-12 h-12 text-gray-300 mx-auto" />
                  <p className="font-semibold text-body-lg">Chưa tạo đơn đặt hàng nào</p>
                  <p className="text-body-md">Hãy click nút Tạo đơn PO để thiết lập đơn hàng nhập.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-25 border-b border-gray-100">
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Mã PO</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Ngày tạo</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Ngày giao dự kiến</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider">Trạng thái</th>
                      <th className="px-6 py-4 text-tiny font-bold text-gray-400 uppercase tracking-wider text-right">Tổng giá trị</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {purchaseOrders.map((po) => (
                      <tr key={po.id} className="hover:bg-gray-25 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-semibold text-blue-500 hover:underline cursor-pointer">
                            {po.po_code}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-body-md text-gray-500">
                          {new Date(po.created_at).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="px-6 py-4 text-body-md text-gray-500">
                          {po.expected_date ? new Date(po.expected_date).toLocaleDateString('vi-VN') : 'Chưa thiết lập'}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 rounded-full text-tiny font-bold uppercase ${
                            po.status === 'received' 
                              ? 'bg-emerald-50 text-emerald-700' 
                              : po.status === 'partially_received' 
                              ? 'bg-amber-50 text-amber-700' 
                              : po.status === 'sent' 
                              ? 'bg-blue-50 text-blue-700' 
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {po.status === 'draft' ? 'Nháp' :
                             po.status === 'sent' ? 'Chờ nhận hàng' :
                             po.status === 'partially_received' ? 'Nhận một phần' : 'Đã nhận đủ'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-body-md text-gray-700 font-bold text-right">
                          {po.grand_total.toLocaleString('vi-VN')} ₫
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Drawer: Add Contact */}
      {isAddingContact && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Thêm liên hệ mới</h3>
                <p className="text-tiny text-gray-400">Đầu mối trao đổi hoặc giao dịch phụ trách</p>
              </div>
              <button
                onClick={() => setIsAddingContact(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddContactSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Họ và tên <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="Nguyễn Văn A..."
                  value={newContact.full_name}
                  onChange={(e) => setNewContact({ ...newContact, full_name: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Chức vụ</label>
                <input
                  type="text"
                  placeholder="Nhân viên kinh doanh, Quản lý kho..."
                  value={newContact.position}
                  onChange={(e) => setNewContact({ ...newContact, position: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Số điện thoại</label>
                <input
                  type="text"
                  placeholder="09xx xxx xxx..."
                  value={newContact.phone}
                  onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Email</label>
                <input
                  type="email"
                  placeholder="nguyenvana@example.com..."
                  value={newContact.email}
                  onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="is_primary"
                  type="checkbox"
                  checked={newContact.is_primary}
                  onChange={(e) => setNewContact({ ...newContact, is_primary: e.target.checked })}
                  className="h-4 w-4 text-blue-500 focus:ring-blue-400 border-gray-100 rounded"
                />
                <label htmlFor="is_primary" className="text-body-md font-medium text-gray-700">Đặt làm liên hệ chính</label>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsAddingContact(false)}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 transition-colors text-gray-600"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center"
                >
                  Thêm liên hệ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Drawer: Edit Supplier */}
      {isEditingSupplier && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Chỉnh sửa nhà cung cấp</h3>
                <p className="text-tiny text-gray-400">Thay đổi thông tin hồ sơ doanh nghiệp</p>
              </div>
              <button
                onClick={() => setIsEditingSupplier(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleEditSupplierSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Tên nhà cung cấp <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="Công ty Dược phẩm Thú y..."
                  value={editSupplierForm.name}
                  onChange={(e) => setEditSupplierForm({ ...editSupplierForm, name: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã số thuế</label>
                  <input
                    type="text"
                    placeholder="Mã số thuế..."
                    value={editSupplierForm.tax_code}
                    onChange={(e) => setEditSupplierForm({ ...editSupplierForm, tax_code: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Thời hạn thanh toán</label>
                  <select
                    value={editSupplierForm.payment_terms}
                    onChange={(e) => setEditSupplierForm({ ...editSupplierForm, payment_terms: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="Net 15">Net 15 (15 ngày)</option>
                    <option value="Net 30">Net 30 (30 ngày)</option>
                    <option value="Net 45">Net 45 (45 ngày)</option>
                    <option value="Net 60">Net 60 (60 ngày)</option>
                    <option value="COD">COD</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Website</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={editSupplierForm.website}
                  onChange={(e) => setEditSupplierForm({ ...editSupplierForm, website: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Địa chỉ</label>
                <input
                  type="text"
                  placeholder="Số nhà, đường, quận/huyện, tỉnh..."
                  value={editSupplierForm.address}
                  onChange={(e) => setEditSupplierForm({ ...editSupplierForm, address: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Ghi chú</label>
                <textarea
                  placeholder="Thông tin thêm về nhà cung cấp..."
                  rows={4}
                  value={editSupplierForm.notes}
                  onChange={(e) => setEditSupplierForm({ ...editSupplierForm, notes: e.target.value })}
                  className="w-full p-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsEditingSupplier(false)}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 transition-colors text-gray-600"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </Layout>
  )
}
