import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  Check,
  Search,
  Plus,
  Minus,
  Trash2,
  AlertTriangle,
  Calendar,
  MapPin,
  Truck,
  FileText
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface Customer {
  id: string
  code: string
  farm_name: string
  credit_limit: number
  price_list_id: string | null
  value_tier: string
}

interface Product {
  id: string
  sku: string
  name: string
  unit: string
  is_lot_managed: boolean
  is_active: boolean
  category_id: string
  package_specs: string | null
  image_urls: string[]
  product_categories: { id: string; code: string; name: string } | null
  brands: { name: string } | null
  price_list_items: { selling_price: number; price_list: { code: string } | null }[]
}

interface CartItem {
  product: Product
  quantity: number
  unitPrice: number
  discountPercent: number
}

export default function MobileOrderPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  // Wizard state: 1: Select Customer, 2: Choose Products, 3: Order Options, 4: Review & Submit
  const [step, setStep] = useState(1)

  // Master data state
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  
  // Selection states
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [customerDebt, setCustomerDebt] = useState(0)
  const [cart, setCart] = useState<CartItem[]>([])
  
  // Options states
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer' | 'credit'>('cash')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryPartner, setDeliveryPartner] = useState('Tự giao')
  const [notes, setNotes] = useState('')
  const [manualDiscount, setManualDiscount] = useState(0)

  // Search/Filters states
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')

  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Fetch data
  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: cust } = await supabase
          .from('customers')
          .select('id, code, farm_name, credit_limit, price_list_id, value_tier')
          .eq('is_active', true)
        if (cust) setCustomers(cust as unknown as Customer[])

        const { data: cat } = await supabase
          .from('product_categories')
          .select('id, name')
          .eq('is_active', true)
        if (cat) setCategories(cat)

        const { data: prod } = await supabase
          .from('products')
          .select(`
            id,
            sku,
            name,
            unit,
            is_lot_managed,
            is_active,
            category_id,
            package_specs,
            image_urls,
            product_categories(id, code, name),
            brands(name),
            price_list_items(selling_price, price_list:price_lists(code))
          `)
          .eq('is_active', true)
        if (prod) setProducts(prod as unknown as Product[])
      } catch (err) {
        console.error('Error loading mobile order data:', err)
      }
    }
    loadData()
  }, [])

  // Load customer debt
  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerDebt(0)
      return
    }
    const fetchDebt = async () => {
      try {
        const { data } = await supabase
          .from('customer_debts')
          .select('amount')
          .eq('customer_id', selectedCustomerId)
          .eq('is_settled', false)

        if (data) {
          const total = data.reduce((sum: number, item: { amount: unknown }) => sum + Number(item.amount), 0)
          setCustomerDebt(total)
        }
      } catch (err) {
        console.error(err)
      }
    }
    fetchDebt()
  }, [selectedCustomerId])

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId)

  // Filter lists
  const filteredCustomers = customers.filter(c => 
    c.farm_name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
    c.code.toLowerCase().includes(customerSearchQuery.toLowerCase())
  )

  const filteredProducts = products.filter(p => {
    const matchesCategory = !selectedCategoryId || p.category_id === selectedCategoryId
    const matchesSearch = !productSearchQuery.trim() ||
      p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(productSearchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  // Cart operations
  const addToCart = (product: Product) => {
    const exists = cart.find(item => item.product.id === product.id)
    if (exists) return

    let price = 0
    if (product.price_list_items && product.price_list_items.length > 0) {
      const retailItem = product.price_list_items.find(
        item => item.price_list?.code === 'GIA-LE'
      )
      price = retailItem ? retailItem.selling_price : product.price_list_items[0].selling_price
    }

    setCart([...cart, { product, quantity: 1, unitPrice: price, discountPercent: 0 }])
  }

  const adjustQty = (productId: string, val: number) => {
    const index = cart.findIndex(item => item.product.id === productId)
    if (index === -1) return
    const updated = [...cart]
    const nextQty = updated[index].quantity + val
    if (nextQty <= 0) {
      updated.splice(index, 1)
    } else {
      updated[index].quantity = nextQty
    }
    setCart(updated)
  }

  // Helper to format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)
  }

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => {
    const lineTotal = item.quantity * item.unitPrice
    const discount = lineTotal * (item.discountPercent / 100)
    return sum + (lineTotal - discount)
  }, 0)

  const grandTotal = Math.max(0, subtotal - manualDiscount)

  const isCreditLimitExceeded = selectedCustomer && (customerDebt + grandTotal > selectedCustomer.credit_limit)

  // Submit Order
  const submitOrder = async () => {
    if (!profile?.id) return
    setSubmitting(true)
    try {
      const rand = Math.floor(10000 + Math.random() * 90000)
      const orderCode = `DH-${rand}`

      const orderInsert = {
        order_code: orderCode,
        customer_id: selectedCustomerId,
        status: 'confirmed',
        payment_status: paymentMethod === 'credit' ? 'unpaid' : 'paid',
        payment_method: paymentMethod,
        owner_user_id: profile.id,
        price_list_id: selectedCustomer?.price_list_id || null,
        subtotal: subtotal,
        discount_total: manualDiscount,
        grand_total: grandTotal,
        paid_amount: paymentMethod === 'credit' ? 0 : grandTotal,
        delivery_address: deliveryAddress || 'Giao tại trang trại khách hàng',
        delivery_date: deliveryDate || null,
        delivery_partner: deliveryPartner,
        notes: notes || 'Lên đơn di động từ nhân viên kinh doanh.'
      }

      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .insert([orderInsert])
        .select()
        .single()

      if (orderErr) throw orderErr

      const linesInsert = cart.map((item) => ({
        order_id: orderData.id,
        variant_id: null,
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount: item.unitPrice * (item.discountPercent / 100)
      }))

      const { error: linesErr } = await supabase
        .from('order_lines')
        .insert(linesInsert)

      if (linesErr) throw linesErr

      if (paymentMethod !== 'credit') {
        await supabase.from('order_payments').insert([{
          order_id: orderData.id,
          payment_method: paymentMethod,
          amount: grandTotal,
          reference_no: `MB-PAY-${rand}`,
          notes: 'Thanh toán di động.',
          created_by: profile.id
        }])
      } else {
        await supabase.from('customer_debts').insert([{
          customer_id: selectedCustomerId,
          order_id: orderData.id,
          debt_type: 'order_debt',
          amount: grandTotal,
          due_date: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
          is_settled: false,
          notes: `Công nợ đơn hàng di động ${orderCode}`,
          created_by: profile.id
        }])
      }

      setAlertMsg({ type: 'success', text: `Đã lên đơn ${orderCode} thành công.` })
      setTimeout(() => {
        navigate('/orders')
      }, 1500)

    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi lên đơn: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout activeMenu="Đơn hàng">
      <div className="p-4 max-w-xl mx-auto space-y-6">
        
        {/* Alerts */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Wizard Stepper Banner */}
        <div className="flex items-center justify-between border-b border-gray-150 pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => step > 1 ? setStep(step - 1) : navigate('/orders')}
              className="p-1.5 hover:bg-gray-50 border border-gray-100 rounded-lg text-gray-500"
            >
              <ArrowLeft size={16} />
            </button>
            <h3 className="text-body-lg font-bold text-gray-800">Lên đơn di động</h3>
          </div>
          <span className="text-tiny font-bold text-gray-400">Bước {step}/4</span>
        </div>

        {/* STEP 1: Select Customer */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Tìm kiếm khách hàng</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Gõ tên trại, mã khách hàng..."
                  value={customerSearchQuery}
                  onChange={e => setCustomerSearchQuery(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 bg-white border border-gray-100 rounded-lg text-body-md font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
              {filteredCustomers.map(cust => {
                const active = selectedCustomerId === cust.id
                return (
                  <div
                    key={cust.id}
                    onClick={() => setSelectedCustomerId(cust.id)}
                    className={`p-4 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                      active ? 'bg-blue-50/40 border-blue-500 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="space-y-1">
                      <h4 className="text-body-md font-bold text-gray-800">{cust.farm_name}</h4>
                      <div className="text-tiny text-gray-400 font-mono">Mã: {cust.code}</div>
                    </div>
                    {active && (
                      <div className="w-5 h-5 rounded-full bg-blue-500 text-gray-0 flex items-center justify-center">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {selectedCustomer && (
              <div className="p-4 bg-white border border-gray-100 rounded-xl space-y-2 text-tiny">
                <div className="flex justify-between">
                  <span className="text-gray-400">Khách hàng chọn:</span>
                  <span className="font-bold text-gray-800">{selectedCustomer.farm_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Nợ hiện tại:</span>
                  <span className="font-semibold text-gray-700">{(customerDebt).toLocaleString('vi-VN')} ₫</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Hạn mức công nợ:</span>
                  <span className="font-semibold text-gray-700">{(selectedCustomer.credit_limit).toLocaleString('vi-VN')} ₫</span>
                </div>
              </div>
            )}

            <button
              onClick={() => {
                if (!selectedCustomerId) {
                  setAlertMsg({ type: 'error', text: 'Vui lòng chọn khách hàng.' })
                  return
                }
                setStep(2)
              }}
              className="w-full h-11 bg-blue-500 text-gray-0 rounded-lg font-bold text-body-md flex items-center justify-center gap-2 hover:bg-blue-600 transition-all active:scale-[0.98]"
            >
              <span>Chọn Sản Phẩm</span>
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* STEP 2: Choose Products */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Cart summary header */}
            {cart.length > 0 && (
              <div className="p-4 bg-blue-50/30 border border-blue-100 rounded-xl space-y-3">
                <div className="text-tiny font-bold text-blue-700 uppercase tracking-wider">Đã chọn ({cart.length})</div>
                <div className="space-y-2">
                  {cart.map(item => (
                    <div key={item.product.id} className="flex justify-between items-center text-body-md">
                      <span className="font-semibold text-gray-700 truncate max-w-[200px]">{item.product.name}</span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center border border-gray-150 rounded bg-white h-6">
                          <button onClick={() => adjustQty(item.product.id, -1)} className="px-1.5 text-gray-500 hover:bg-gray-50"><Minus size={10} /></button>
                          <span className="px-2 text-tiny font-bold">{item.quantity}</span>
                          <button onClick={() => adjustQty(item.product.id, 1)} className="px-1.5 text-gray-500 hover:bg-gray-50"><Plus size={10} /></button>
                        </div>
                        <button onClick={() => adjustQty(item.product.id, -item.quantity)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Product selection search */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Gõ tên thuốc, vaccine, SKU..."
                  value={productSearchQuery}
                  onChange={e => setProductSearchQuery(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 bg-white border border-gray-100 rounded-lg text-body-md font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Quick Categories filter */}
              <div className="flex gap-2 overflow-x-auto pb-1.5">
                <button
                  onClick={() => setSelectedCategoryId('')}
                  className={`px-3 py-1 rounded-full text-tiny font-bold flex-shrink-0 transition-all ${
                    !selectedCategoryId ? 'bg-blue-500 text-gray-0' : 'bg-gray-50 text-gray-500 border border-gray-100'
                  }`}
                >
                  Tất cả
                </button>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={`px-3 py-1 rounded-full text-tiny font-bold flex-shrink-0 transition-all ${
                      selectedCategoryId === cat.id ? 'bg-blue-500 text-gray-0' : 'bg-gray-50 text-gray-500 border border-gray-100'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
              {filteredProducts.map(prod => {
                const added = cart.some(item => item.product.id === prod.id)
                let price = 0
                if (prod.price_list_items && prod.price_list_items.length > 0) {
                  price = prod.price_list_items[0].selling_price
                }
                return (
                  <div
                    key={prod.id}
                    onClick={() => addToCart(prod)}
                    className={`p-3 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                      added ? 'bg-gray-50 border-gray-250 opacity-60' : 'bg-white border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="space-y-0.5 max-w-[280px]">
                      <h4 className="text-body-md font-bold text-gray-800 truncate">{prod.name}</h4>
                      <div className="text-tiny text-gray-400">ĐVT: {prod.unit} | SKU: {prod.sku}</div>
                      <div className="text-tiny font-bold text-blue-500">{formatCurrency(price)}</div>
                    </div>
                    {!added ? (
                      <button className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center">
                        <Plus size={16} />
                      </button>
                    ) : (
                      <span className="text-tiny text-emerald-600 font-bold">Đã thêm</span>
                    )}
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => {
                if (cart.length === 0) {
                  setAlertMsg({ type: 'error', text: 'Vui lòng chọn ít nhất một sản phẩm.' })
                  return
                }
                setStep(3)
              }}
              className="w-full h-11 bg-blue-500 text-gray-0 rounded-lg font-bold text-body-md flex items-center justify-center gap-2 hover:bg-blue-600 transition-all active:scale-[0.98]"
            >
              <span>Phương thức thanh toán</span>
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* STEP 3: Order Options */}
        {step === 3 && (
          <div className="space-y-4">
            <h4 className="text-body-lg font-bold text-gray-800 mb-2">Thông tin thanh toán &amp; Vận chuyển</h4>

            <div className="space-y-3">
              {/* Payment Method */}
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Hình thức thanh toán</label>
                <div className="flex border border-gray-100 rounded-lg p-1 bg-gray-50">
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    className={`flex-1 py-2 text-tiny font-bold rounded ${
                      paymentMethod === 'cash' ? 'bg-blue-500 text-gray-0' : 'text-gray-500'
                    }`}
                  >
                    Tiền mặt
                  </button>
                  <button
                    onClick={() => setPaymentMethod('bank_transfer')}
                    className={`flex-1 py-2 text-tiny font-bold rounded ${
                      paymentMethod === 'bank_transfer' ? 'bg-blue-500 text-gray-0' : 'text-gray-500'
                    }`}
                  >
                    Chuyển khoản
                  </button>
                  <button
                    onClick={() => setPaymentMethod('credit')}
                    className={`flex-1 py-2 text-tiny font-bold rounded ${
                      paymentMethod === 'credit' ? 'bg-blue-500 text-gray-0' : 'text-gray-500'
                    }`}
                  >
                    Nợ
                  </button>
                </div>
              </div>

              {/* Delivery Date */}
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <Calendar size={14} /> Ngày giao hàng dự kiến
                </label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={e => setDeliveryDate(e.target.value)}
                  className="w-full h-11 px-3 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Delivery Address */}
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <MapPin size={14} /> Địa chỉ giao hàng
                </label>
                <input
                  type="text"
                  placeholder="Nhập địa chỉ cụ thể..."
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  className="w-full h-11 px-3 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Shipping Partner */}
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <Truck size={14} /> Đối tác vận chuyển
                </label>
                <select
                  value={deliveryPartner}
                  onChange={e => setDeliveryPartner(e.target.value)}
                  className="w-full h-11 px-3 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 appearance-none"
                >
                  <option value="Tự giao">Tự giao (Sales phụ trách)</option>
                  <option value="Giao Hàng Nhanh (GHN)">Giao Hàng Nhanh (GHN)</option>
                  <option value="Viettel Post">Viettel Post</option>
                </select>
              </div>

              {/* Manual Discount */}
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  Giảm giá hóa đơn (₫)
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="0 ₫"
                  value={manualDiscount === 0 ? '' : manualDiscount}
                  onChange={e => setManualDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full h-11 px-3 bg-white border border-gray-100 rounded-lg text-body-md font-bold focus:outline-none focus:border-blue-500 text-right"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <FileText size={14} /> Ghi chú nội bộ
                </label>
                <textarea
                  placeholder="Yêu cầu giao giờ hành chính, bảo quản chuỗi lạnh..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full h-20 p-3 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>

            <button
              onClick={() => setStep(4)}
              className="w-full h-11 bg-blue-500 text-gray-0 rounded-lg font-bold text-body-md flex items-center justify-center gap-2 hover:bg-blue-600 transition-all active:scale-[0.98]"
            >
              <span>Xem Lại Đơn Hàng</span>
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* STEP 4: Review and Submit */}
        {step === 4 && (
          <div className="space-y-4">
            <h4 className="text-body-lg font-bold text-gray-800 mb-2">Xem lại &amp; Hoàn tất đơn hàng</h4>

            <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4 shadow-sm text-tiny">
              {/* Customer info */}
              <div className="pb-3 border-b border-gray-50">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Khách hàng</div>
                <div className="text-body-md font-bold text-gray-800">{selectedCustomer?.farm_name}</div>
                <div className="text-gray-400">Nợ hiện tại: {customerDebt.toLocaleString('vi-VN')} ₫</div>
              </div>

              {/* Product items */}
              <div className="pb-3 border-b border-gray-50 space-y-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sản phẩm đặt hàng</div>
                {cart.map(item => (
                  <div key={item.product.id} className="flex justify-between items-center text-body-md text-gray-800 font-medium">
                    <span>{item.product.name} (x{item.quantity})</span>
                    <span className="font-bold">{((item.unitPrice * (1 - item.discountPercent / 100)) * item.quantity).toLocaleString('vi-VN')} ₫</span>
                  </div>
                ))}
              </div>

              {/* Shipping info */}
              <div className="pb-3 border-b border-gray-50 space-y-1">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Hình thức &amp; Vận chuyển</div>
                <div>Thanh toán: <span className="font-bold capitalize">{paymentMethod === 'credit' ? 'Công nợ' : paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}</span></div>
                {deliveryDate && <div>Ngày giao dự kiến: <span className="font-bold">{deliveryDate}</span></div>}
                {deliveryAddress && <div className="truncate">Địa chỉ giao: <span className="font-bold">{deliveryAddress}</span></div>}
                <div>Đơn vị vận chuyển: <span className="font-bold">{deliveryPartner}</span></div>
              </div>

              {/* Total calculations */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-gray-400">
                  <span>Tạm tính:</span>
                  <span className="font-semibold">{subtotal.toLocaleString('vi-VN')} ₫</span>
                </div>
                {manualDiscount > 0 && (
                  <div className="flex justify-between text-red-500">
                    <span>Chiết khấu đơn:</span>
                    <span className="font-semibold">-{manualDiscount.toLocaleString('vi-VN')} ₫</span>
                  </div>
                )}
                <div className="flex justify-between items-end pt-2 border-t border-dashed border-gray-200">
                  <span className="text-body-md font-bold text-gray-800">CẦN THANH TOÁN:</span>
                  <span className="text-body-lg font-black text-blue-500">{grandTotal.toLocaleString('vi-VN')} ₫</span>
                </div>
              </div>
            </div>

            {paymentMethod === 'credit' && isCreditLimitExceeded && (
              <div className="flex items-start gap-2.5 p-3 bg-red-50 text-red-800 rounded-lg border border-red-100">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="text-tiny leading-tight">
                  <span className="font-bold">Cảnh báo hạn mức nợ!</span><br />
                  Tổng nợ sau đơn hàng này ({ (customerDebt + grandTotal).toLocaleString('vi-VN') } ₫) sẽ vượt quá hạn mức nợ cho phép của khách hàng.
                </div>
              </div>
            )}

            <button
              onClick={submitOrder}
              disabled={submitting || (paymentMethod === 'credit' && isCreditLimitExceeded)}
              className="w-full h-12 bg-blue-500 text-gray-0 rounded-lg font-bold text-body-md flex items-center justify-center gap-2 hover:bg-blue-600 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              <span>Lên Đơn Hàng</span>
            </button>
          </div>
        )}

      </div>
    </Layout>
  )
}
