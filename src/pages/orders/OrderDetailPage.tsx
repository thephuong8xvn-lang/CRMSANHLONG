import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertTriangle,
  User,
  Printer,
  Send,
  Smartphone,
  MapPin,
  Boxes,
  X,
  Menu,
  Copy,
  PlusCircle
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface OrderLine {
  id: string
  product_id: string
  quantity: number
  unit_price: number
  discount: number
  line_total: number
  product_snapshot?: {
    name: string
    sku: string
    unit: string
  }
}

interface OrderPayment {
  id: string
  payment_method: string
  amount: number
  reference_no: string | null
  payment_date: string
  notes: string | null
}

interface Order {
  id: string
  order_code: string
  created_at: string
  status: string
  payment_status: string
  payment_method: string
  subtotal: number
  discount_total: number
  grand_total: number
  paid_amount: number
  debt_amount: number
  delivery_address: string | null
  delivery_date: string | null
  delivery_partner: string | null
  notes: string | null
  customer_id: string
  price_list_id: string | null
  warehouse_id: string | null
  customers?: {
    farm_name: string
    code: string
    value_tier: string
  }
  owner?: {
    full_name: string
    phone: string | null
  }
  warehouses?: {
    name: string
  }
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile, userRole } = useAuth()

  // State
  const [order, setOrder] = useState<Order | null>(null)
  const [lines, setLines] = useState<OrderLine[]>([])
  const [payments, setPayments] = useState<OrderPayment[]>([])
  const [loading, setLoading] = useState(true)

  // Payment modal state
  const [showPayModal, setShowPayModal] = useState(false)
  const [payAmount, setPayAmount] = useState(0)
  const [payMethod, setPayMethod] = useState<'cash' | 'bank_transfer' | 'card_pos'>('cash')
  const [payReference, setPayReference] = useState('')
  const [payNotes, setPayNotes] = useState('')

  // FAB overlay menu state
  const [showFabMenu, setShowFabMenu] = useState(false)

  // Feedback alerts
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Sales Return states
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnWarehouseId, setReturnWarehouseId] = useState('')
  const [returnReasonCode, setReturnReasonCode] = useState<'damage' | 'wrong_product' | 'near_expiry' | 'quality_fail' | 'recall' | 'other'>('other')
  const [returnReasonDetail, setReturnReasonDetail] = useState('')
  const [returnRefundMethod, setReturnRefundMethod] = useState<'cash' | 'bank_transfer' | 'credit_note'>('credit_note')
  const [returnLines, setReturnLines] = useState<Array<{
    lineId: string;
    productId: string;
    productName: string;
    sku: string;
    orderedQty: number;
    returnedQty: number;
    currentReturnQty: number;
    unitPrice: number;
    originalUnitPrice: number;
    lotId: string | null;
  }>>([])
  const [warehouses, setWarehouses] = useState<any[]>([])

  const openReturnModal = async () => {
    if (!order) return
    setLoading(true)
    try {
      let whQuery = supabase.from('warehouses').select('id, name, branch_id')
      if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
        whQuery = whQuery.eq('branch_id', profile.branch_id)
      }
      const { data: whData } = await whQuery
      setWarehouses(whData || [])
      setReturnWarehouseId(order.warehouse_id || (whData && whData[0]?.id) || '')

      const { data: retData } = await supabase
        .from('sales_returns')
        .select(`
          id,
          sales_return_lines (
            product_id,
            quantity
          )
        `)
        .eq('order_id', order.id)
        .in('status', ['approved', 'completed', 'received'])

      const returnMap: Record<string, number> = {}
      if (retData) {
        retData.forEach((r: any) => {
          if (r.sales_return_lines) {
            r.sales_return_lines.forEach((line: any) => {
              returnMap[line.product_id] = (returnMap[line.product_id] || 0) + line.quantity
            })
          }
        })
      }

      const { data: allocData } = await supabase
        .from('order_line_allocations')
        .select('order_line_id, lot_id, quantity')
        .in('order_line_id', lines.map(line => line.id))

      const allocMap: Record<string, string> = {}
      if (allocData) {
        allocData.forEach((a: any) => {
          allocMap[a.order_line_id] = a.lot_id
        })
      }

      const initialReturnLines = lines.map(line => ({
        lineId: line.id,
        productId: line.product_id,
        productName: line.product_snapshot?.name || 'Sản phẩm',
        sku: line.product_snapshot?.sku || '',
        orderedQty: line.quantity,
        returnedQty: returnMap[line.product_id] || 0,
        currentReturnQty: 0,
        unitPrice: line.unit_price,
        originalUnitPrice: line.unit_price,
        lotId: allocMap[line.id] || null
      }))

      setReturnLines(initialReturnLines)
      setReturnReasonCode('other')
      setReturnReasonDetail('')
      setReturnRefundMethod('credit_note')
      setShowReturnModal(true)
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi chuẩn bị phiếu trả hàng: ' + err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateReturn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!order) return
    const activeLines = returnLines.filter(line => line.currentReturnQty > 0)
    if (activeLines.length === 0) {
      setAlertMsg({ type: 'error', text: 'Vui lòng nhập ít nhất một sản phẩm cần trả với số lượng lớn hơn 0.' })
      return
    }

    setSubmitting(true)
    try {
      const totalAmount = activeLines.reduce((sum, line) => sum + (line.currentReturnQty * line.unitPrice), 0)

      // 1. Insert as pending
      const { data: returnData, error: insertError } = await supabase
        .from('sales_returns')
        .insert([{
          order_id: order.id,
          reason: `[${returnReasonCode}] ${returnReasonDetail}`,
          refund_method: returnRefundMethod,
          total_amount: totalAmount,
          created_by: profile?.id,
          status: 'pending'
        }])
        .select()
        .single()

      if (insertError) throw insertError

      // 2. Insert return lines
      const linesToInsert = activeLines.map(line => ({
        return_id: returnData.id,
        order_line_id: line.lineId,
        product_id: line.productId,
        quantity: line.currentReturnQty,
        unit_price: line.unitPrice,
        lot_id: line.lotId,
        return_to_warehouse_id: returnWarehouseId || null
      }))

      const { error: linesError } = await supabase
        .from('sales_return_lines')
        .insert(linesToInsert)

      if (linesError) throw linesError

      // 3. Confirm return (status change to completed triggers DB stock function)
      const { error: statusError } = await supabase
        .from('sales_returns')
        .update({ status: 'completed' })
        .eq('id', returnData.id)

      if (statusError) throw statusError

      setAlertMsg({ type: 'success', text: 'Khách hàng trả hàng thành công!' })
      setShowReturnModal(false)
      loadOrderDetails()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi ghi nhận hàng trả: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Load order data
  const loadOrderDetails = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      // 1. Fetch Order Info
      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .select(`
          id,
          order_code,
          created_at,
          status,
          payment_status,
          payment_method,
          subtotal,
          discount_total,
          grand_total,
          paid_amount,
          debt_amount,
          delivery_address,
          delivery_date,
          delivery_partner,
          notes,
          customer_id,
          price_list_id,
          warehouse_id,
          customers:customers(farm_name, code, value_tier),
          owner:profiles!orders_owner_user_id_fkey(full_name, phone),
          warehouses:warehouses(name)
        `)
        .eq('id', id)
        .single()

      if (orderErr) throw orderErr
      setOrder(orderData as unknown as Order)

      // 2. Fetch Order Lines (Join with products table because product_snapshot is not a column)
      const { data: linesData, error: linesErr } = await supabase
        .from('order_lines')
        .select(`
          id,
          product_id,
          quantity,
          unit_price,
          discount,
          line_total,
          products:products(name, sku, unit)
        `)
        .eq('order_id', id)
      
      if (linesErr) throw linesErr

      // Map relation products back to product_snapshot for backward compatibility
      const formattedLines = (linesData || []).map((line: any) => ({
        ...line,
        product_snapshot: line.products ? {
          name: line.products.name,
          sku: line.products.sku,
          unit: line.products.unit
        } : undefined
      }))

      setLines(formattedLines as unknown as OrderLine[])

      // 3. Fetch Payments
      const { data: payData, error: payErr } = await supabase
        .from('order_payments')
        .select('id, payment_method, amount, reference_no, payment_date, notes')
        .eq('order_id', id)
        .order('created_at', { ascending: true })

      if (payErr) throw payErr
      setPayments(payData as unknown as OrderPayment[])

    } catch (err: any) {
      console.error('Error loading order details:', err)
      setAlertMsg({ type: 'error', text: 'Không thể tải thông tin đơn hàng.' })
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadOrderDetails()
  }, [id, loadOrderDetails])

  // Handle status update transitions
  const updateOrderStatus = async (nextStatus: string) => {
    if (!order) return
    setSubmitting(true)
    try {
      const updateData: any = { status: nextStatus }
      
      if (nextStatus === 'confirmed') {
        updateData.confirmed_by = profile?.id
      }
      
      // Update order status in Supabase. Triggers will execute:
      // - on 'confirmed': run FEFO allocation and reserve/deduct stock.
      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', order.id)

      if (error) throw error

      setAlertMsg({ type: 'success', text: `Đơn hàng đã chuyển sang trạng thái: ${nextStatus}` })
      loadOrderDetails()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Chuyển trạng thái đơn hàng thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Handle add payment transaction
  const handleAddPayment = async () => {
    if (!order || payAmount <= 0) return
    setSubmitting(true)
    try {
      const random = Math.floor(1000 + Math.random() * 9000)
      const ref = payReference || `PAY-REF-${random}`

      // 1. Insert into order_payments
      const { error: payErr } = await supabase
        .from('order_payments')
        .insert([{
          order_id: order.id,
          payment_method: payMethod,
          amount: payAmount,
          reference_no: ref,
          notes: payNotes || null,
          created_by: profile?.id
        }])

      if (payErr) throw payErr

      // 2. Calculate new paid amount and payment status
      const nextPaidAmount = Number(order.paid_amount) + payAmount
      let nextPaymentStatus = 'unpaid'
      if (nextPaidAmount >= Number(order.grand_total)) {
        nextPaymentStatus = 'paid'
      } else if (nextPaidAmount > 0) {
        nextPaymentStatus = 'partially_paid'
      }

      // 3. Update orders table
      const { error: orderErr } = await supabase
        .from('orders')
        .update({
          paid_amount: nextPaidAmount,
          payment_status: nextPaymentStatus
        })
        .eq('id', order.id)

      if (orderErr) throw orderErr

      // 4. Đánh dấu công nợ đơn hàng đã tất toán nếu đơn đã trả đủ.
      //    Bảng customer_debts chỉ có amount/is_settled (không có paid_amount).
      //    Khi tổng đã trả ≥ grand_total → settle các dòng nợ của đơn này.
      if (nextPaidAmount >= Number(order.grand_total)) {
        await supabase
          .from('customer_debts')
          .update({ is_settled: true, settled_at: new Date().toISOString() })
          .eq('order_id', order.id)
          .eq('is_settled', false)
      }

      setAlertMsg({ type: 'success', text: `Ghi nhận giao dịch thanh toán ${formatCurrency(payAmount)} thành công.` })
      setShowPayModal(false)
      setPayAmount(0)
      setPayReference('')
      setPayNotes('')
      loadOrderDetails()

    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Ghi nhận thanh toán thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Format currency
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)
  }

  // Status transitions check
  const renderStepper = () => {
    if (!order) return null
    const current = order.status
    const isStoreSale = order.delivery_address === 'Giao trực tiếp tại quầy POS'
    const steps = isStoreSale
      ? [
          { code: 'confirmed', label: 'Xác nhận', icon: CheckCircle2 },
          { code: 'completed', label: 'Hoàn tất', icon: CheckCircle2 }
        ]
      : [
          { code: 'draft', label: 'Nháp', icon: Clock },
          { code: 'confirmed', label: 'Xác nhận', icon: CheckCircle2 },
          { code: 'shipping', label: 'Giao hàng', icon: Clock },
          { code: 'delivered', label: 'Đã giao', icon: CheckCircle2 },
          { code: 'completed', label: 'Hoàn tất', icon: CheckCircle2 }
        ]

    let currentIndex = steps.findIndex(s => s.code === current)
    if (currentIndex === -1 && isStoreSale) {
      currentIndex = 0
    }

    return (
      <section className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center justify-between w-full max-w-4xl mx-auto flex-col sm:flex-row gap-4 sm:gap-0">
          {steps.map((s, idx) => {
            const isDone = idx < currentIndex || current === 'completed'
            const isActive = idx === currentIndex
            const IconComp = s.icon

            let circleClass = 'bg-gray-50 border border-gray-200 text-gray-400'
            let textClass = 'text-gray-400 font-medium'
            let lineClass = 'bg-gray-100'

            if (isDone) {
              circleClass = 'bg-blue-500 text-gray-0'
              textClass = 'text-blue-500 font-bold'
              lineClass = 'bg-blue-500'
            } else if (isActive) {
              circleClass = 'bg-blue-500 text-gray-0 ring-4 ring-blue-50'
              textClass = 'text-blue-500 font-bold'
              lineClass = 'bg-gray-200'
            }

            return (
              <div key={s.code} className="flex flex-col items-center flex-1 relative w-full sm:w-auto">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 z-10 transition-all ${circleClass}`}>
                  <IconComp size={18} />
                </div>
                <span className={`text-tiny uppercase tracking-wider ${textClass}`}>{s.label}</span>
                
                {/* Horizontal connector line */}
                {idx < steps.length - 1 && (
                  <div className={`absolute top-5 left-1/2 w-full h-[2px] -z-0 hidden sm:block ${lineClass}`} />
                )}
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  if (loading) {
    return (
      <Layout activeMenu="Đơn hàng">
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-2 border-gray-100 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="text-body-md text-gray-400">Đang tải thông tin chi tiết đơn hàng...</p>
        </div>
      </Layout>
    )
  }

  if (!order) {
    return (
      <Layout activeMenu="Đơn hàng">
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-2" />
          <h3 className="text-body-lg font-bold text-gray-800">Không tìm thấy đơn hàng</h3>
          <button onClick={() => navigate('/orders')} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold">Quay lại danh sách</button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout activeMenu="Đơn hàng">
      <div className="p-4 md:p-10 max-w-[1600px] mx-auto space-y-6">
        
        {/* Toast alert notifications */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Back and Title bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/orders')}
              className="p-2 hover:bg-gray-50 border border-gray-100 rounded-lg text-gray-500 transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
            <h2 className="text-headline-lg font-bold text-gray-800">Chi tiết đơn hàng #{order.order_code}</h2>
          </div>

          {/* Action buttons based on status */}
          <div className="flex items-center gap-3">
            {order.status === 'draft' && (
              <>
                <button
                  disabled={submitting}
                  onClick={() => updateOrderStatus('cancelled')}
                  className="h-10 px-4 border border-red-250 text-red-600 font-semibold rounded-lg hover:bg-red-50/50 transition-colors"
                >
                  Hủy đơn
                </button>
                <button
                  disabled={submitting}
                  onClick={() => updateOrderStatus('confirmed')}
                  className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-all shadow-sm active:scale-95 flex items-center gap-2"
                >
                  <CheckCircle2 size={16} />
                  Xác nhận đơn (FEFO)
                </button>
              </>
            )}

            {order.status === 'confirmed' && (
              order.delivery_address === 'Giao trực tiếp tại quầy POS' ? (
                <button
                  disabled={submitting}
                  onClick={() => updateOrderStatus('completed')}
                  className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-all shadow-sm active:scale-95 flex items-center gap-2"
                >
                  <CheckCircle2 size={16} />
                  Hoàn tất đơn hàng
                </button>
              ) : (
                <button
                  disabled={submitting}
                  onClick={() => updateOrderStatus('shipping')}
                  className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-all shadow-sm active:scale-95 flex items-center gap-2"
                >
                  <Clock size={16} />
                  Bắt đầu giao hàng
                </button>
              )
            )}

            {order.status === 'shipping' && order.delivery_address !== 'Giao trực tiếp tại quầy POS' && (
              <button
                disabled={submitting}
                onClick={() => updateOrderStatus('delivered')}
                className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-all shadow-sm active:scale-95 flex items-center gap-2"
              >
                <CheckCircle2 size={16} />
                Xác nhận đã giao hàng
              </button>
            )}

            {(order.status === 'delivered' || order.status === 'paid') && order.delivery_address !== 'Giao trực tiếp tại quầy POS' && (
              <button
                disabled={submitting}
                onClick={() => updateOrderStatus('completed')}
                className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-all shadow-sm active:scale-95 flex items-center gap-2"
              >
                <CheckCircle2 size={16} />
                Hoàn tất đơn hàng
              </button>
            )}

            {(order.status === 'delivered' || order.status === 'paid' || order.status === 'completed' || order.status === 'returned_partial') && (
              <button
                disabled={submitting}
                onClick={openReturnModal}
                className="h-10 px-4 border border-blue-200 text-blue-600 font-semibold rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-2"
              >
                Trả hàng
              </button>
            )}
          </div>
        </div>

        {/* Stepper progress */}
        {order.status !== 'cancelled' && renderStepper()}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          {/* Left panel: Details columns */}
          <div className="xl:col-span-8 space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Shipping info */}
              <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
                <h3 className="text-body-lg font-bold text-gray-800 mb-5">Thông tin vận chuyển</h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <User size={16} className="text-blue-500 mt-0.5" />
                    <div>
                      <p className="text-tiny text-gray-400">Khách hàng</p>
                      <p className="text-body-md font-bold text-gray-800">{order.customers?.farm_name}</p>
                      <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold rounded uppercase mt-0.5 ${
                        order.customers?.value_tier === 'vip' ? 'bg-blue-500 text-gray-0' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {order.customers?.value_tier}
                      </span>
                    </div>
                  </div>

                  {order.owner?.phone && (
                    <div className="flex items-start gap-3">
                      <Smartphone size={16} className="text-blue-500 mt-0.5" />
                      <div>
                        <p className="text-tiny text-gray-400">Điện thoại</p>
                        <p className="text-body-md font-semibold text-gray-700">{order.owner.phone}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    <MapPin size={16} className="text-blue-500 mt-0.5" />
                    <div>
                      <p className="text-tiny text-gray-400">Địa chỉ giao hàng</p>
                      <p className="text-body-md text-gray-700 font-medium leading-snug">{order.delivery_address || 'Nhận tại quầy POS'}</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-50 space-y-2 text-tiny">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Kho xuất hàng:</span>
                      <span className="font-bold text-gray-700">{order.warehouses?.name || 'Kho Tổng Miền Nam'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Nhân viên phụ trách:</span>
                      <span className="font-bold text-gray-700">{order.owner?.full_name || 'Hệ thống'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Product items lists */}
              <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-body-lg font-bold text-gray-800">Sản phẩm đặt hàng</h3>
                  <span className="text-tiny bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-bold">{lines.length} sản phẩm</span>
                </div>

                <div className="space-y-3.5 max-h-[260px] overflow-y-auto pr-1">
                  {lines.map(line => (
                    <div key={line.id} className="flex justify-between items-center pb-3 border-b border-gray-50">
                      <div>
                        <p className="text-body-md font-bold text-gray-800 leading-tight">{line.product_snapshot?.name || 'Sản phẩm'}</p>
                        <p className="text-tiny text-gray-400 mt-0.5 font-semibold">
                          {line.quantity.toLocaleString('vi-VN')} {line.product_snapshot?.unit || 'lọ'} x {line.unit_price.toLocaleString('vi-VN')} ₫
                          {line.discount > 0 && <span className="text-red-500 ml-1.5">-{(line.discount * line.quantity).toLocaleString('vi-VN')} ₫</span>}
                        </p>
                      </div>
                      <span className="text-body-md font-bold text-gray-800">{line.line_total.toLocaleString('vi-VN')} ₫</span>
                    </div>
                  ))}
                </div>

                <div className="pt-4 space-y-2 text-tiny mt-4">
                  <div className="flex justify-between text-gray-400">
                    <span>Tạm tính</span>
                    <span className="font-medium text-gray-700">{order.subtotal.toLocaleString('vi-VN')} ₫</span>
                  </div>
                  {order.discount_total > 0 && (
                    <div className="flex justify-between text-red-500">
                      <span>Chiết khấu đơn</span>
                      <span className="font-medium">-{order.discount_total.toLocaleString('vi-VN')} ₫</span>
                    </div>
                  )}
                  <div className="flex justify-between items-end pt-2 border-t border-dashed border-gray-200">
                    <span className="text-body-md font-bold text-gray-800">TỔNG CỘNG</span>
                    <span className="text-body-lg font-black text-blue-500">{order.grand_total.toLocaleString('vi-VN')} ₫</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Payment history section */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-body-lg font-bold text-gray-800">Lịch sử thanh toán</h3>
                <div className="text-tiny">
                  Đã trả: <span className="font-bold text-emerald-600">{order.paid_amount.toLocaleString('vi-VN')} ₫</span> / Còn nợ: <span className="font-bold text-red-500">{order.debt_amount.toLocaleString('vi-VN')} ₫</span>
                </div>
              </div>

              {payments.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-gray-100 rounded-xl text-center text-gray-400 italic">
                  Chưa ghi nhận giao dịch thanh toán nào cho đơn hàng này.
                </div>
              ) : (
                <div className="space-y-4">
                  {payments.map(pay => (
                    <div key={pay.id} className="flex justify-between items-center p-4 bg-gray-25 border border-gray-100 rounded-xl">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-body-md font-bold text-gray-800 capitalize">
                            {pay.payment_method === 'cash' ? 'Tiền mặt' : pay.payment_method === 'bank_transfer' ? 'Chuyển khoản' : 'Thanh toán POS'}
                          </span>
                          <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] font-bold rounded uppercase">Thành công</span>
                        </div>
                        <p className="text-tiny text-gray-400">Ngày: {new Date(pay.payment_date).toLocaleDateString('vi-VN')} | Ref: {pay.reference_no}</p>
                        {pay.notes && <p className="text-tiny text-gray-500 italic mt-1">Ghi chú: {pay.notes}</p>}
                      </div>
                      <span className="text-body-lg font-black text-blue-500">+{pay.amount.toLocaleString('vi-VN')} ₫</span>
                    </div>
                  ))}
                </div>
              )}

              {order.debt_amount > 0 && order.status !== 'cancelled' && (
                <button
                  onClick={() => setShowPayModal(true)}
                  className="mt-6 w-full py-2.5 rounded-lg border-2 border-dashed border-gray-200 text-blue-500 font-bold text-body-md hover:bg-blue-50/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <PlusCircle size={16} />
                  Thêm giao dịch thanh toán
                </button>
              )}
            </div>
          </div>

          {/* Right panel: simulated print receipt invoice */}
          <div className="xl:col-span-4 sticky top-24">
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="bg-gray-25 p-4 border-b border-gray-100 flex items-center justify-between">
                <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider">Xem trước hóa đơn</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.open(`/print-preview?type=invoice&id=${id}`, '_blank')}
                    title="In hóa đơn A4 chuyên nghiệp"
                    className="w-8 h-8 rounded bg-white border border-gray-200 flex items-center justify-center hover:text-blue-500 transition-colors"
                  >
                    <Printer size={14} />
                  </button>
                </div>
              </div>

              {/* simulated thermopaper print layout */}
              <div className="p-8 bg-gray-50 shadow-inner">
                <div className="bg-white border border-gray-200 p-6 rounded-lg text-center font-mono text-tiny text-gray-700 max-w-[300px] mx-auto">
                  <div className="mb-4">
                    <h4 className="text-body-lg font-bold text-blue-500">SANH LONG VETCO</h4>
                    <p className="text-[10px] text-gray-400">789 Veterinary Blvd, TP. Hồ Chí Minh</p>
                    <p className="text-[10px] text-gray-400">Hotline: 1900 6789</p>
                  </div>
                  
                  <div className="text-body-md font-bold border-y border-dashed border-gray-200 py-2 mb-4">
                    HÓA ĐƠN BÁN LẺ
                    <div className="text-[10px] font-normal mt-0.5">Mã đơn: #{order.order_code}</div>
                    <div className="text-[10px] font-normal">Ngày: {new Date(order.created_at).toLocaleDateString('vi-VN')}</div>
                  </div>

                  <div className="space-y-2 text-left mb-4">
                    {lines.map(line => (
                      <div key={line.id} className="flex justify-between text-[11px]">
                        <span>{line.product_snapshot?.name || 'SP'} (x{line.quantity.toLocaleString('vi-VN')})</span>
                        <span>{line.line_total.toLocaleString('vi-VN')}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-dashed border-gray-200 pt-2 space-y-1 mb-4 text-left">
                    <div className="flex justify-between text-[11px]">
                      <span>Tạm tính:</span>
                      <span>{order.subtotal.toLocaleString('vi-VN')}</span>
                    </div>
                    {order.discount_total > 0 && (
                      <div className="flex justify-between text-[11px] text-red-500">
                        <span>Giảm giá:</span>
                        <span>-{order.discount_total.toLocaleString('vi-VN')}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-body-md font-bold pt-2 border-t border-dashed border-gray-200">
                      <span>TỔNG CỘNG:</span>
                      <span>{order.grand_total.toLocaleString('vi-VN')}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center space-y-2 mt-4 pt-4 border-t border-dashed border-gray-200">
                    <div className="w-24 h-24 bg-gray-50 border border-gray-100 p-2 rounded flex items-center justify-center relative">
                      <div className="w-full h-full opacity-10" style={{ backgroundImage: 'radial-gradient(#1e5a9c 1px, transparent 1px)', backgroundSize: '4px 4px' }}></div>
                      <Boxes className="absolute text-blue-500 animate-pulse" size={32} />
                    </div>
                    <p className="text-[9px] text-gray-400">Cảm ơn quý khách đã tin dùng!</p>
                  </div>
                </div>
              </div>

              <div className="p-5">
                <button
                  onClick={() => {
                    setAlertMsg({ type: 'success', text: 'Đã gửi hóa đơn qua Zalo/SMS thành công.' })
                  }}
                  className="w-full h-11 bg-blue-500 text-white rounded-lg font-bold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2"
                >
                  <Send size={16} />
                  Gửi hóa đơn qua Zalo/SMS
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic floating actions menu in bottom-right matching Stitch */}
        <div className="fixed bottom-10 right-10 flex flex-col items-end gap-3 z-50">
          {showFabMenu && (
            <div className="flex flex-col items-end gap-2 mb-2 animate-in fade-in slide-in-from-bottom-4 duration-200">
              <button
                onClick={() => {
                  setShowFabMenu(false)
                  setAlertMsg({ type: 'success', text: 'Đã sao chép liên kết đơn hàng.' })
                  navigator.clipboard.writeText(window.location.href)
                }}
                className="bg-white border border-gray-100 px-4 py-2 rounded-full text-tiny font-bold text-gray-600 hover:text-blue-500 shadow-lg flex items-center gap-2 transition-all"
              >
                <span>Sao chép URL</span>
                <Copy size={16} />
              </button>
              {order.status !== 'cancelled' && order.status !== 'completed' && (
                <button
                  onClick={() => {
                    setShowFabMenu(false)
                    updateOrderStatus('cancelled')
                  }}
                  className="bg-white border border-gray-100 px-4 py-2 rounded-full text-tiny font-bold text-red-500 hover:bg-red-50/50 shadow-lg flex items-center gap-2 transition-all"
                >
                  <span>Hủy đơn hàng</span>
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => setShowFabMenu(prev => !prev)}
            className="w-14 h-14 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-2xl active:scale-95 transition-transform border-4 border-gray-0"
          >
            <Menu size={24} />
          </button>
        </div>

      </div>

      {/* Record Payment Modal */}
      {showPayModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="text-body-lg font-bold text-gray-700">Ghi nhận thanh toán</h3>
              <button onClick={() => setShowPayModal(false)} className="p-1 hover:bg-gray-100 rounded-full text-gray-400"><X size={20} /></button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Số tiền trả (₫)</label>
                <input
                  type="number"
                  min="1"
                  max={order.debt_amount}
                  value={payAmount === 0 ? '' : payAmount}
                  placeholder={`Tối đa: ${order.debt_amount.toLocaleString('vi-VN')} ₫`}
                  onChange={e => setPayAmount(Math.min(order.debt_amount, parseFloat(e.target.value) || 0))}
                  className="w-full h-11 px-3 bg-white border border-gray-100 rounded-lg text-body-md font-bold focus:outline-none focus:border-blue-500 text-right"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Phương thức thanh toán</label>
                <select
                  value={payMethod}
                  onChange={e => setPayMethod(e.target.value as any)}
                  className="w-full h-11 px-3 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                >
                  <option value="cash">Tiền mặt</option>
                  <option value="bank_transfer">Chuyển khoản ngân hàng</option>
                  <option value="card_pos">Quẹt thẻ POS</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Mã tham chiếu / Số bút toán</label>
                <input
                  type="text"
                  placeholder="Mã GD ngân hàng..."
                  value={payReference}
                  onChange={e => setPayReference(e.target.value)}
                  className="w-full h-11 px-3 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ghi chú giao dịch</label>
                <textarea
                  placeholder="Ghi chú đợt thanh toán..."
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                  className="w-full h-20 p-3 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="p-6 bg-gray-25 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowPayModal(false)}
                className="h-10 px-4 border border-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={handleAddPayment}
                disabled={submitting || payAmount <= 0}
                className="h-10 px-5 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:opacity-50"
              >
                Xác nhận thanh toán
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Return Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-xl">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Khách hàng trả hàng</h3>
                <p className="text-tiny text-gray-400">Trả sản phẩm về kho, hoàn tiền hoặc ghi giảm công nợ</p>
              </div>
              <button
                onClick={() => setShowReturnModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <form onSubmit={handleCreateReturn} className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Kho nhận hàng trả <span className="text-red-500">*</span></label>
                  <select
                    value={returnWarehouseId}
                    onChange={(e) => setReturnWarehouseId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="">-- Chọn kho nhận --</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Phương thức hoàn tiền <span className="text-red-500">*</span></label>
                  <select
                    value={returnRefundMethod}
                    onChange={(e) => setReturnRefundMethod(e.target.value as any)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="cash">Hoàn tiền mặt</option>
                    <option value="bank_transfer">Chuyển khoản</option>
                    <option value="credit_note">Trừ vào công nợ</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Lý do trả hàng <span className="text-red-500">*</span></label>
                  <select
                    value={returnReasonCode}
                    onChange={(e) => setReturnReasonCode(e.target.value as any)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="damage">Hàng hỏng / Lỗi</option>
                    <option value="wrong_product">Sai sản phẩm</option>
                    <option value="near_expiry">Cận / Hết hạn</option>
                    <option value="quality_fail">Lỗi chất lượng</option>
                    <option value="recall">Thu hồi</option>
                    <option value="other">Khác</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Chi tiết lý do</label>
                  <input
                    type="text"
                    value={returnReasonDetail}
                    onChange={(e) => setReturnReasonDetail(e.target.value)}
                    placeholder="Nhập chi tiết lý do..."
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h4 className="text-body-md font-bold text-gray-700">Chi tiết sản phẩm nhận lại</h4>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-500 font-bold text-tiny uppercase">
                        <th className="px-4 py-2">Sản phẩm / SKU</th>
                        <th className="px-4 py-2 text-center">Đã mua</th>
                        <th className="px-4 py-2 text-center">Đã trả trước</th>
                        <th className="px-4 py-2 text-center w-28">Số lượng trả</th>
                        <th className="px-4 py-2 text-right">Đơn giá hoàn</th>
                        <th className="px-4 py-2 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {returnLines.map((line, idx) => {
                        const maxAvail = line.orderedQty - line.returnedQty;
                        return (
                          <tr key={line.lineId} className="hover:bg-gray-25/30">
                            <td className="px-4 py-3">
                              <p className="font-bold text-gray-700">{line.productName}</p>
                              <span className="text-tiny text-gray-400 font-mono">SKU: {line.sku}</span>
                            </td>
                            <td className="px-4 py-3 text-center text-gray-600 font-medium">{line.orderedQty}</td>
                            <td className="px-4 py-3 text-center text-gray-400">{line.returnedQty}</td>
                            <td className="px-4 py-3 text-center">
                              <input
                                type="number"
                                min="0"
                                max={maxAvail}
                                value={line.currentReturnQty === 0 ? '' : line.currentReturnQty}
                                onChange={(e) => {
                                  const val = Math.min(maxAvail, Math.max(0, parseInt(e.target.value) || 0));
                                  const updated = [...returnLines];
                                  updated[idx].currentReturnQty = val;
                                  setReturnLines(updated);
                                }}
                                disabled={maxAvail <= 0}
                                placeholder={maxAvail > 0 ? `Tối đa: ${maxAvail}` : 'Hết'}
                                className="w-full text-center h-8 border border-gray-155 border-gray-150 rounded focus:outline-none focus:border-blue-500 font-semibold"
                              />
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700 font-medium">
                              <input
                                type="number"
                                min="0"
                                value={line.unitPrice}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0);
                                  const updated = [...returnLines];
                                  updated[idx].unitPrice = val;
                                  setReturnLines(updated);
                                }}
                                className="w-28 text-right h-8 px-2 border border-gray-150 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-850"
                              />
                              <span className="block text-[10px] text-gray-400 font-vietnamese mt-0.5">Gốc: {line.originalUnitPrice.toLocaleString('vi-VN')} ₫</span>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-800 font-bold">
                              {(line.currentReturnQty * line.unitPrice).toLocaleString('vi-VN')} ₫
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end p-2">
                  <span className="text-body-md text-gray-500">Tổng tiền hoàn trả khách: <strong className="text-body-lg text-gray-800 font-extrabold">
                    {returnLines.reduce((sum, line) => sum + (line.currentReturnQty * line.unitPrice), 0).toLocaleString('vi-VN')} ₫
                  </strong></span>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowReturnModal(false)}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center disabled:opacity-50"
                >
                  {submitting ? 'Đang xử lý...' : 'Xác nhận nhận hàng trả'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
