import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Store,
  Warehouse as WarehouseIcon,
  Calendar,
  PlusCircle,
  Minus,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Send,
  Search,
  Package,
  Sparkles
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface Supplier {
  id: string
  code: string
  name: string
  payment_terms: string | null
}

interface Warehouse {
  id: string
  name: string
}

interface Product {
  id: string
  sku: string
  name: string
  is_lot_managed: boolean
}

interface POLineItem {
  productId: string
  sku: string
  name: string
  quantity: number
  unitPrice: number
}

export default function PurchaseOrderFormPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  // Selection list states
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [products, setProducts] = useState<Product[]>([])

  // Form states
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<POLineItem[]>([])

  // Search products modal/combobox state
  const [productSearchTerm, setProductSearchTerm] = useState('')
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Fetch initial select data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch active suppliers
        const { data: supplierData } = await supabase
          .from('suppliers')
          .select('id, code, name, payment_terms')
          .eq('is_active', true)
        if (supplierData) setSuppliers(supplierData)

        // Fetch warehouses
        const { data: warehouseData } = await supabase
          .from('warehouses')
          .select('id, name')
        if (warehouseData) setWarehouses(warehouseData)

        // Fetch products
        const { data: productData } = await supabase
          .from('products')
          .select('id, sku, name, is_lot_managed')
        if (productData) setProducts(productData)
      } catch (err) {
        console.error('Error fetching data:', err)
      }
    }
    fetchData()
  }, [])

  // Auto-clear alert
  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [alertMsg])

  // Filter products for search dropdown
  const filteredProducts = products.filter(p => {
    if (!productSearchTerm.trim()) return false
    const term = productSearchTerm.toLowerCase()
    return p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)
  })

  // Add line item
  const handleAddProduct = (prod: Product) => {
    // Check if product already exists in lineItems
    const exists = lineItems.find(item => item.productId === prod.id)
    if (exists) {
      setAlertMsg({ type: 'error', text: `Sản phẩm ${prod.name} đã được thêm vào đơn hàng.` })
      return
    }

    const newItem: POLineItem = {
      productId: prod.id,
      sku: prod.sku,
      name: prod.name,
      quantity: 1,
      unitPrice: 0 // user will input unit price
    }

    setLineItems([...lineItems, newItem])
    setProductSearchTerm('')
    setShowProductDropdown(false)
  }

  // Remove line item
  const handleRemoveItem = (index: number) => {
    const updated = [...lineItems]
    updated.splice(index, 1)
    setLineItems(updated)
  }

  // Update line item details
  const handleUpdateItem = (index: number, fields: Partial<POLineItem>) => {
    const updated = [...lineItems]
    updated[index] = { ...updated[index], ...fields }
    setLineItems(updated)
  }

  // Calculations
  const subtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)
  const vatTotal = subtotal * 0.05 // Template specifies 5% VAT
  const grandTotal = subtotal + vatTotal

  // Handle Form Submit
  const handleSubmit = async (status: 'draft' | 'sent') => {
    if (!selectedSupplierId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn nhà cung cấp.' })
      return
    }
    if (!selectedWarehouseId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn kho nhập hàng.' })
      return
    }
    if (lineItems.length === 0) {
      setAlertMsg({ type: 'error', text: 'Vui lòng thêm ít nhất một sản phẩm vào đơn hàng.' })
      return
    }
    if (!profile?.id) {
      setAlertMsg({ type: 'error', text: 'Lỗi xác thực người dùng. Vui lòng đăng nhập lại.' })
      return
    }

    // Check quantities and prices
    for (const item of lineItems) {
      if (item.quantity <= 0) {
        setAlertMsg({ type: 'error', text: `Số lượng sản phẩm ${item.name} phải lớn hơn 0.` })
        return
      }
      if (item.unitPrice < 0) {
        setAlertMsg({ type: 'error', text: `Đơn giá của sản phẩm ${item.name} không hợp lệ.` })
        return
      }
    }

    setSubmitting(true)
    try {
      // 1. Generate unique PO Code client-side
      const randomId = Math.floor(10000 + Math.random() * 90000)
      const poCode = `PO-${randomId}-SL`

      // 2. Insert into purchase_orders
      const { data: po, error: poError } = await supabase
        .from('purchase_orders')
        .insert([{
          po_code: poCode,
          supplier_id: selectedSupplierId,
          warehouse_id: selectedWarehouseId,
          status,
          expected_date: expectedDate || null,
          subtotal,
          discount_total: 0,
          grand_total: grandTotal,
          notes: notes || null,
          created_by: profile.id
        }])
        .select()
        .single()

      if (poError) throw poError

      // 3. Insert line items
      const linesToInsert = lineItems.map(item => ({
        po_id: po.id,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        received_qty: 0
      }))

      const { error: linesError } = await supabase
        .from('purchase_order_lines')
        .insert(linesToInsert)

      if (linesError) throw linesError

      setAlertMsg({
        type: 'success',
        text: `Đơn hàng ${poCode} đã được tạo thành công với trạng thái: ${status === 'draft' ? 'Nháp' : 'Chờ nhận hàng'}`
      })

      // Redirect after success
      setTimeout(() => {
        navigate('/inventory')
      }, 1500)

    } catch (err: any) {
      console.error('Error creating purchase order:', err)
      setAlertMsg({ type: 'error', text: 'Không thể lập đơn mua hàng: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout activeMenu="Kho hàng">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6">
        
        {/* Toast Notification */}
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

        {/* Breadcrumbs & Title */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-gray-400 text-body-md">
            <span>Sản phẩm</span>
            <ArrowLeft size={14} className="rotate-180" />
            <span>Đơn nhập hàng</span>
            <ArrowLeft size={14} className="rotate-180" />
            <span className="text-blue-500 font-bold">Tạo mới</span>
          </div>
          <h2 className="text-headline-lg font-bold text-gray-800">Tạo Đơn Nhập Hàng Mới</h2>
        </div>

        {/* Form Body */}
        <div className="space-y-6">
          {/* Header Info Card */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Supplier Select */}
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-500">Nhà cung cấp</label>
                <div className="relative">
                  <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="w-full h-10 pl-10 pr-4 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 appearance-none"
                  >
                    <option value="">Tìm hoặc chọn nhà cung cấp...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Warehouse Select */}
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-500">Kho nhập hàng</label>
                <div className="relative">
                  <WarehouseIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <select
                    value={selectedWarehouseId}
                    onChange={(e) => setSelectedWarehouseId(e.target.value)}
                    className="w-full h-10 pl-10 pr-4 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 appearance-none"
                  >
                    <option value="">Chọn kho nhận hàng dự kiến...</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Delivery Date */}
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-500">Ngày dự kiến giao</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="w-full h-10 pl-10 pr-4 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Product Selection Table */}
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Danh sách sản phẩm</h3>
                <p className="text-tiny text-gray-400">Chọn các sản phẩm cần nhập hàng của đối tác</p>
              </div>

              {/* Product Search Box */}
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Gõ SKU hoặc tên sản phẩm..."
                  value={productSearchTerm}
                  onChange={(e) => {
                    setProductSearchTerm(e.target.value)
                    setShowProductDropdown(true)
                  }}
                  onFocus={() => setShowProductDropdown(true)}
                  className="w-full h-9 pl-9 pr-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
                
                {/* Autocomplete Dropdown */}
                {showProductDropdown && filteredProducts.length > 0 && (
                  <div className="absolute right-0 left-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-100 rounded-lg shadow-lg z-50 py-1">
                    {filteredProducts.map(prod => (
                      <button
                        key={prod.id}
                        onClick={() => handleAddProduct(prod)}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 text-body-md flex items-center justify-between"
                      >
                        <div>
                          <span className="font-semibold text-gray-800">{prod.name}</span>
                          <span className="block text-[11px] text-gray-400 font-mono">SKU: {prod.sku}</span>
                        </div>
                        {prod.is_lot_managed && (
                          <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase">Lô</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {showProductDropdown && productSearchTerm.trim() && filteredProducts.length === 0 && (
                  <div className="absolute right-0 left-0 mt-1 p-3 bg-white border border-gray-100 rounded-lg shadow-lg z-50 text-center text-tiny text-gray-400">
                    Không tìm thấy sản phẩm phù hợp.
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-gray-25 text-gray-400 font-semibold text-tiny uppercase tracking-wider border-b border-gray-100">
                    <th className="px-6 py-4 w-12 text-center">#</th>
                    <th className="px-6 py-4">Tên sản phẩm / Mã SKU</th>
                    <th className="px-6 py-4 w-40 text-center">Số lượng đặt</th>
                    <th className="px-6 py-4 text-right w-44">Đơn giá nhập (₫)</th>
                    <th className="px-6 py-4 text-right w-48">Thành tiền (₫)</th>
                    <th className="px-6 py-4 w-16 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-body-md text-gray-700">
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400 italic">
                        <Package className="w-12 h-12 mx-auto text-gray-200 mb-2" />
                        <span>Chưa có sản phẩm nào được chọn. Nhập mã SKU hoặc tên để tìm sản phẩm đặt hàng.</span>
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item, index) => (
                      <tr key={item.productId} className="hover:bg-gray-25/50 transition-colors group">
                        <td className="px-6 py-4 text-center text-gray-400">{index + 1}</td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-800">{item.name}</span>
                            <span className="text-gray-400 font-semibold text-tiny">SKU: {item.sku}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center border border-gray-100 rounded-lg overflow-hidden w-28 mx-auto h-8 bg-white shadow-sm">
                            <button
                              type="button"
                              onClick={() => handleUpdateItem(index, { quantity: Math.max(1, item.quantity - 1) })}
                              className="w-8 h-full flex items-center justify-center hover:bg-gray-50 transition-colors border-r border-gray-100 text-gray-500"
                            >
                              <Minus size={14} />
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleUpdateItem(index, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                              className="w-12 text-center border-none focus:ring-0 p-0 text-body-md font-bold"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdateItem(index, { quantity: item.quantity + 1 })}
                              className="w-8 h-full flex items-center justify-center hover:bg-gray-50 transition-colors border-l border-gray-100 text-gray-500"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="number"
                            min="0"
                            value={item.unitPrice === 0 ? '' : item.unitPrice}
                            placeholder="0"
                            onChange={(e) => handleUpdateItem(index, { unitPrice: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="w-full text-right h-8 px-2 border border-gray-100 rounded-lg focus:outline-none focus:border-blue-500 text-body-md font-semibold"
                          />
                        </td>
                        <td className="px-6 py-4 text-right font-bold text-blue-600">
                          {(item.quantity * item.unitPrice).toLocaleString('vi-VN')} ₫
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(index)}
                            className="text-red-500 opacity-40 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer: Notes & Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Note Panel */}
            <div className="lg:col-span-7 bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col justify-between h-fit">
              <label className="block text-body-lg font-bold text-gray-700 mb-3">Ghi chú đơn hàng</label>
              <textarea
                placeholder="Nhập chi tiết về lô hàng cần bảo quản lạnh, ghi chú thời gian bốc dỡ..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full h-32 p-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            {/* Summary & Submit */}
            <div className="lg:col-span-5 bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center text-gray-400 text-body-md">
                  <span>Tổng tiền hàng (chưa VAT)</span>
                  <span className="font-semibold text-gray-700">{subtotal.toLocaleString('vi-VN')} ₫</span>
                </div>
                <div className="flex justify-between items-center text-gray-400 text-body-md border-b border-dashed border-gray-100 pb-3">
                  <span>Thuế giá trị gia tăng (5% VAT)</span>
                  <span className="font-semibold text-gray-700">{vatTotal.toLocaleString('vi-VN')} ₫</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-body-lg font-bold text-gray-800">Tổng cộng thanh toán</span>
                  <span className="text-headline-md font-bold text-blue-600">{grandTotal.toLocaleString('vi-VN')} ₫</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSubmit('draft')}
                  className="h-10 border border-gray-100 text-gray-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                >
                  <FileText size={16} />
                  <span>Lưu nháp</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSubmit('sent')}
                  className="h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all active:scale-95"
                >
                  <Send size={16} />
                  <span>Gửi duyệt</span>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </Layout>
  )
}
