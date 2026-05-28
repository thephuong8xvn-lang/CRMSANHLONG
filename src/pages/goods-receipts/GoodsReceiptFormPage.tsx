import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle,
  Warehouse as WarehouseIcon,
  Layers,
  Calendar,
  AlertTriangle,
  Minus,
  Plus,
  Save,
  Check,
  Package,
  AlertCircle,
  Trash2,
  List,
  Eye,
  Search,
  Store
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface Supplier {
  id: string
  name: string
}

interface Warehouse {
  id: string
  name: string
}

interface PurchaseOrder {
  id: string
  po_code: string
  status: string
  created_at: string
  supplier: {
    id: string
    name: string
  }
  warehouse_id: string
}

interface POLineItem {
  id: string
  product_id: string
  quantity: number
  unit_price: number
  received_qty: number
  product: {
    id: string
    sku: string
    name: string
    is_lot_managed: boolean
    category: {
      name: string
    } | null
  }
}

interface ReceiptVerificationState {
  poLineId: string | null
  productId: string
  productName: string
  productSku: string
  isLotManaged: boolean
  categoryName: string
  quantityOrdered: number
  quantityPreviouslyReceived: number
  // User input fields
  quantityReceived: number
  lotNumber: string
  manufactureDate: string
  expiryDate: string
  notes: string
  isVerified: boolean
  warehouseId: string
  shelfBin: string
  unitPrice: number
}

export default function GoodsReceiptFormPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { profile, user } = useAuth()
  
  const poIdParam = searchParams.get('po_id')

  // Modes
  const [receiptMode, setReceiptMode] = useState<'po' | 'direct'>(poIdParam ? 'po' : 'direct')
  const [viewMode, setViewMode] = useState<'detail' | 'table'>('table')

  // Lookup lists
  const [pendingPOs, setPendingPOs] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  
  // Selection states
  const [selectedPOId, setSelectedPOId] = useState(poIdParam || '')
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null)
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')

  // Verification states for line items
  const [poLines, setPOLines] = useState<POLineItem[]>([])
  const [verificationItems, setVerificationItems] = useState<ReceiptVerificationState[]>([])
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(0)
  
  // Product search autocomplete (for direct receipt mode)
  const [allProducts, setAllProducts] = useState<{ id: string; sku: string; name: string; is_lot_managed: boolean; categoryName: string }[]>([])
  const [productSearchTerm, setProductSearchTerm] = useState('')
  const [showProductDropdown, setShowProductDropdown] = useState(false)

  // Page UI States
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Fetch initial lookups (warehouses, pending POs, suppliers, products)
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // 1. Fetch warehouses
        const { data: whData } = await supabase.from('warehouses').select('id, name')
        if (whData) {
          setWarehouses(whData)
          if (whData.length > 0) {
            setSelectedWarehouseId(whData[0].id)
          }
        }

        // 2. Fetch active suppliers
        const { data: supData } = await supabase
          .from('suppliers')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
        if (supData) setSuppliers(supData)

        // 3. Fetch POs in 'sent' or 'partially_received' statuses
        const { data: poData, error: poErr } = await supabase
          .from('purchase_orders')
          .select(`
            id,
            po_code,
            status,
            created_at,
            warehouse_id,
            supplier:suppliers(id, name)
          `)
          .in('status', ['sent', 'partially_received'])
          .order('created_at', { ascending: false })

        if (poErr) throw poErr
        
        const formattedPOs = (poData || []).map((po: any) => ({
          id: po.id,
          po_code: po.po_code,
          status: po.status,
          created_at: po.created_at,
          warehouse_id: po.warehouse_id,
          supplier: {
            id: po.supplier?.id || '',
            name: po.supplier?.name || 'Nhà cung cấp không xác định'
          }
        }))
        setPendingPOs(formattedPOs)

        // 4. Fetch all active products
        const { data: prodData } = await supabase
          .from('products')
          .select(`
            id, 
            sku, 
            name, 
            is_lot_managed,
            category:product_categories(name)
          `)
          .eq('is_active', true)
          .order('name')
        
        if (prodData) {
          setAllProducts(prodData.map((p: any) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            is_lot_managed: !!p.is_lot_managed,
            categoryName: p.category?.name || 'Dược phẩm'
          })))
        }

      } catch (err) {
        console.error('Error fetching initial data:', err)
      }
    }
    fetchInitialData()
  }, [])

  // Auto-clear alert
  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [alertMsg])

  // Load PO details and lines when selectedPOId changes
  useEffect(() => {
    if (receiptMode !== 'po' || !selectedPOId) {
      setSelectedPO(null)
      setPOLines([])
      if (receiptMode === 'po') {
        setVerificationItems([])
      }
      return
    }

    const fetchPODetails = async () => {
      setLoading(true)
      try {
        const { data: poData, error: poErr } = await supabase
          .from('purchase_orders')
          .select(`
            id,
            po_code,
            status,
            created_at,
            warehouse_id,
            supplier:suppliers(id, name)
          `)
          .eq('id', selectedPOId)
          .single()

        if (poErr) throw poErr
        
        const formattedPO: PurchaseOrder = {
          id: poData.id,
          po_code: poData.po_code,
          status: poData.status,
          created_at: poData.created_at,
          warehouse_id: poData.warehouse_id,
          supplier: {
            id: Array.isArray(poData.supplier) ? poData.supplier[0]?.id : (poData.supplier as any)?.id || '',
            name: Array.isArray(poData.supplier) ? poData.supplier[0]?.name : (poData.supplier as any)?.name || 'Nhà cung cấp không xác định'
          }
        }
        
        setSelectedPO(formattedPO)
        if (formattedPO.warehouse_id) {
          setSelectedWarehouseId(formattedPO.warehouse_id)
        }

        // Fetch PO Lines
        const { data: linesData, error: linesErr } = await supabase
          .from('purchase_order_lines')
          .select(`
            id,
            product_id,
            quantity,
            unit_price,
            received_qty,
            product:products(
              id, 
              sku, 
              name, 
              is_lot_managed,
              category:product_categories(name)
            )
          `)
          .eq('po_id', selectedPOId)

        if (linesErr) throw linesErr

        const formattedLines: POLineItem[] = (linesData || []).map((line: any) => ({
          id: line.id,
          product_id: line.product_id,
          quantity: line.quantity,
          unit_price: Number(line.unit_price),
          received_qty: line.received_qty || 0,
          product: {
            id: line.product?.id || '',
            sku: line.product?.sku || '',
            name: line.product?.name || 'Sản phẩm không rõ',
            is_lot_managed: !!line.product?.is_lot_managed,
            category: line.product?.category ? { name: line.product.category.name } : null
          }
        }))

        setPOLines(formattedLines)

        // Initialize verification items state
        const initialVerification = formattedLines.map(line => {
          const remainingToReceive = Math.max(0, line.quantity - line.received_qty)
          return {
            poLineId: line.id,
            productId: line.product_id,
            productName: line.product.name,
            productSku: line.product.sku,
            isLotManaged: line.product.is_lot_managed,
            categoryName: line.product.category?.name || 'Dược phẩm',
            quantityOrdered: line.quantity,
            quantityPreviouslyReceived: line.received_qty,
            quantityReceived: remainingToReceive,
            lotNumber: '',
            manufactureDate: '',
            expiryDate: '',
            notes: '',
            isVerified: false,
            warehouseId: formattedPO.warehouse_id || selectedWarehouseId || '',
            shelfBin: '',
            unitPrice: line.unit_price
          }
        })
        
        setVerificationItems(initialVerification)
        setSelectedItemIndex(0)

      } catch (err: any) {
        console.error('Error fetching PO details:', err)
        setAlertMsg({ type: 'error', text: 'Lỗi tải chi tiết đơn PO: ' + err.message })
      } finally {
        setLoading(false)
      }
    }

    fetchPODetails()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPOId, receiptMode])

  // Reset lines when mode changes
  useEffect(() => {
    setVerificationItems([])
    setSelectedItemIndex(0)
    setSelectedPOId('')
    setSelectedPO(null)
  }, [receiptMode])

  // Get current active verification item for detail mode
  const currentItem = verificationItems[selectedItemIndex]

  // Update item field in verificationItems array
  const updateItemAtIndex = (index: number, fields: Partial<ReceiptVerificationState>) => {
    setVerificationItems(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], ...fields }
      return copy
    })
  }

  // Helper: check if a item is cold chain vaccine
  const checkColdChain = (name: string, category: string) => {
    const term = `${name} ${category}`.toLowerCase()
    return term.includes('vắc-xin') || term.includes('vaccine')
  }

  // Verify/Confirm specific item
  const handleVerifyItem = (index: number) => {
    const item = verificationItems[index]
    if (!item) return

    if (item.isLotManaged && !item.lotNumber.trim()) {
      setAlertMsg({ type: 'error', text: `Sản phẩm "${item.productName}" yêu cầu quản lý lô. Vui lòng nhập Số lô.` })
      return
    }

    if (item.quantityReceived <= 0) {
      setAlertMsg({ type: 'error', text: 'Số lượng thực nhận phải lớn hơn 0.' })
      return
    }

    updateItemAtIndex(index, { isVerified: true })
    setAlertMsg({ type: 'success', text: `Đã xác nhận kiểm tra sản phẩm: ${item.productName}` })
    
    // Move to next unverified item if in detail view
    if (viewMode === 'detail') {
      const nextUnverifiedIdx = verificationItems.findIndex((item, idx) => !item.isVerified && idx !== index)
      if (nextUnverifiedIdx !== -1) {
        setSelectedItemIndex(nextUnverifiedIdx)
      }
    }
  }

  // Quick verify all items
  const handleQuickVerifyAll = () => {
    if (verificationItems.length === 0) return

    const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const defaultWH = selectedWarehouseId || warehouses[0]?.id || ''
    
    // Find cold warehouse if any vaccine exists
    const coldWH = warehouses.find(w => w.name.toLowerCase().includes('lạnh') || w.name.toLowerCase().includes('mát'))?.id || defaultWH

    setVerificationItems(prev => {
      return prev.map((item, idx) => {
        if (item.isVerified) return item

        const isCold = checkColdChain(item.productName, item.categoryName)
        const expectedQty = Math.max(0, item.quantityOrdered - item.quantityPreviouslyReceived)
        const qtyToSet = item.quantityReceived > 0 
          ? item.quantityReceived 
          : (expectedQty > 0 ? expectedQty : 1)

        const generatedLot = item.lotNumber.trim() 
          ? item.lotNumber 
          : (item.isLotManaged ? `LOT-${todayStr}-${idx + 1}` : '')

        return {
          ...item,
          quantityReceived: qtyToSet,
          lotNumber: generatedLot,
          warehouseId: item.warehouseId || (isCold ? coldWH : defaultWH),
          isVerified: true
        }
      })
    })

    setAlertMsg({ type: 'success', text: 'Đã tự động điền thông tin và xác nhận toàn bộ sản phẩm!' })
  }

  // Product Autocomplete for direct mode
  const filteredProducts = productsListFiltered()
  function productsListFiltered() {
    if (!productSearchTerm.trim()) return []
    const term = productSearchTerm.toLowerCase()
    return allProducts.filter(p => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
  }

  const handleAddProductDirect = (prod: typeof allProducts[0]) => {
    const exists = verificationItems.some(item => item.productId === prod.id)
    if (exists) {
      setAlertMsg({ type: 'error', text: `Sản phẩm ${prod.name} đã được thêm.` })
      return
    }

    const newItem: ReceiptVerificationState = {
      poLineId: null,
      productId: prod.id,
      productName: prod.name,
      productSku: prod.sku,
      isLotManaged: prod.is_lot_managed,
      categoryName: prod.categoryName,
      quantityOrdered: 0,
      quantityPreviouslyReceived: 0,
      quantityReceived: 1,
      lotNumber: '',
      manufactureDate: '',
      expiryDate: '',
      notes: '',
      isVerified: false,
      warehouseId: selectedWarehouseId || warehouses[0]?.id || '',
      shelfBin: '',
      unitPrice: 0
    }

    setVerificationItems(prev => [...prev, newItem])
    setProductSearchTerm('')
    setShowProductDropdown(false)
    setSelectedItemIndex(verificationItems.length)
  }

  const handleRemoveProductDirect = (index: number) => {
    setVerificationItems(prev => {
      const copy = [...prev]
      copy.splice(index, 1)
      return copy
    })
    setSelectedItemIndex(prev => Math.max(0, prev - 1))
  }

  // Submit Goods Receipt
  const handleCompleteReceipt = async () => {
    if (verificationItems.length === 0) {
      setAlertMsg({ type: 'error', text: 'Chưa có sản phẩm nào để nhập kho.' })
      return
    }
    
    // Check if at least one item is verified/received
    const verifiedItems = verificationItems.filter(item => item.isVerified)
    if (verifiedItems.length === 0) {
      setAlertMsg({ type: 'error', text: 'Vui lòng xác nhận kiểm tra ít nhất một mặt hàng trước khi nhập kho.' })
      return
    }

    if (receiptMode === 'direct' && !selectedSupplierId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn nhà cung cấp.' })
      return
    }

    const receivedById = profile?.id ?? user?.id
    if (!receivedById) {
      setAlertMsg({ type: 'error', text: 'Không xác định được tài khoản người dùng đăng nhập. Vui lòng đăng xuất và đăng nhập lại.' })
      return
    }

    // Deep validation of lot numbers & quantities
    for (const item of verifiedItems) {
      if (item.isLotManaged && !item.lotNumber.trim()) {
        setAlertMsg({ type: 'error', text: `Sản phẩm "${item.productName}" yêu cầu Số lô (Lot Number).` })
        return
      }
      if (item.quantityReceived <= 0) {
        setAlertMsg({ type: 'error', text: `Số lượng thực nhận sản phẩm "${item.productName}" phải lớn hơn 0.` })
        return
      }
      if (item.unitPrice < 0) {
        setAlertMsg({ type: 'error', text: `Đơn giá sản phẩm "${item.productName}" không hợp lệ.` })
        return
      }
    }

    setSubmitting(true)
    try {
      // Calculate total amount
      const totalAmount = verifiedItems.reduce((sum, item) => {
        return sum + (item.quantityReceived * item.unitPrice)
      }, 0)

      const randomId = Math.floor(100000 + Math.random() * 900000)
      const receiptCode = `GR-${randomId}`
      const supplierId = receiptMode === 'po' ? selectedPO!.supplier.id : selectedSupplierId
      const targetWarehouse = verifiedItems[0].warehouseId || selectedWarehouseId || warehouses[0]?.id

      // 1. Insert into goods_receipts
      // po_id: chỉ truyền khi là PO mode và selectedPOId là UUID thực (không phải dummyId)
      const realPoId = receiptMode === 'po' && selectedPOId && !selectedPOId.startsWith('direct-')
        ? selectedPOId
        : null

      const { data: gr, error: grErr } = await supabase
        .from('goods_receipts')
        .insert([{
          receipt_code: receiptCode,
          po_id: realPoId,
          supplier_id: supplierId,
          warehouse_id: targetWarehouse,
          receipt_date: receiptDate,
          total_amount: totalAmount,
          received_by: receivedById,
          notes: receiptMode === 'po' 
            ? `Nhập kho từ PO: ${selectedPO!.po_code}. ${notes}` 
            : `Nhập kho trực tiếp không cần PO. ${notes}`
        }])
        .select()
        .single()

      if (grErr) {
        console.error('[GoodsReceipt] INSERT goods_receipts error:', grErr)
        if (grErr.code === '42501' || grErr.message?.includes('row-level security')) {
          throw new Error('Bạn không có quyền nhập kho. Vui lòng liên hệ quản trị viên để được cấp quyền warehouse_keeper hoặc branch_manager.')
        }
        throw grErr
      }

      // 2. Insert into goods_receipt_lines
      // Database trigger trg_receipt_lines_create_lot handles stock_lots / stock_movements creation
      const grLinesToInsert = verifiedItems.map(item => ({
        receipt_id: gr.id,
        po_line_id: receiptMode === 'po' ? item.poLineId : null,
        product_id: item.productId,
        quantity: item.quantityReceived,
        unit_price: item.unitPrice,
        lot_number: item.lotNumber || null,
        manufacture_date: item.manufactureDate || null,
        expiry_date: item.expiryDate || null
      }))

      const { error: grLinesErr } = await supabase
        .from('goods_receipt_lines')
        .insert(grLinesToInsert)

      if (grLinesErr) throw grLinesErr

      // 3. Update PO lines and PO status if PO mode
      if (receiptMode === 'po') {
        for (const item of verifiedItems) {
          if (item.poLineId) {
            const poLine = poLines.find(l => l.id === item.poLineId)
            if (poLine) {
              const newReceivedQty = poLine.received_qty + item.quantityReceived
              const { error: poLineUpdateErr } = await supabase
                .from('purchase_order_lines')
                .update({ received_qty: newReceivedQty })
                .eq('id', item.poLineId)

              if (poLineUpdateErr) throw poLineUpdateErr
            }
          }
        }

        // Check if PO is fully received
        const { data: updatedLines } = await supabase
          .from('purchase_order_lines')
          .select('quantity, received_qty')
          .eq('po_id', selectedPOId)

        if (updatedLines) {
          const isFullyReceived = updatedLines.every(line => line.received_qty >= line.quantity)
          const newPOStatus = isFullyReceived ? 'received' : 'partially_received'

          const { error: poStatusErr } = await supabase
            .from('purchase_orders')
            .update({ status: newPOStatus, updated_at: new Date().toISOString() })
            .eq('id', selectedPOId)

          if (poStatusErr) throw poStatusErr
        }
      }

      setAlertMsg({
        type: 'success',
        text: `Nhập kho thành công! Đã tạo phiếu kiểm kho ${receiptCode}.`
      })

      // Redirect to inventory overview after a short delay
      setTimeout(() => {
        navigate('/inventory')
      }, 1500)

    } catch (err: any) {
      console.error('Error completing goods receipt:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi hoàn tất nhập kho: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Calculations
  const verifiedCount = verificationItems.filter(item => item.isVerified).length
  const totalItemsCount = verificationItems.length
  const progressPercent = totalItemsCount > 0 ? (verifiedCount / totalItemsCount) * 100 : 0

  return (
    <Layout activeMenu="Kho hàng">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6">
        
        {/* Toast Alert */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <AlertCircle size={18} className={alertMsg.type === 'success' ? 'text-emerald-600' : 'text-red-600'} />
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Mode Selector and Setup Panel */}
        {(!selectedPOId && receiptMode === 'po') || (receiptMode === 'direct' && !selectedPO) ? (
          <div className="bg-white p-8 rounded-xl border border-gray-100 shadow-sm max-w-3xl mx-auto space-y-6">
            <div className="text-center space-y-2 pb-4 border-b border-gray-50">
              <WarehouseIcon className="w-12 h-12 text-blue-500 mx-auto" />
              <h2 className="text-headline-md font-bold text-gray-800">Cấu hình đơn nhập kho thực tế</h2>
              <p className="text-body-md text-gray-400">Chọn hình thức nhập hàng phù hợp để tiếp tục thực hiện kiểm hàng</p>
            </div>

            {/* Mode selection toggle */}
            <div className="grid grid-cols-2 gap-4 p-1 bg-gray-50 rounded-lg">
              <button
                type="button"
                onClick={() => setReceiptMode('po')}
                className={`py-2 rounded-md font-semibold text-body-md transition-all ${
                  receiptMode === 'po' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Nhập từ Đơn đặt hàng (PO)
              </button>
              <button
                type="button"
                onClick={() => setReceiptMode('direct')}
                className={`py-2 rounded-md font-semibold text-body-md transition-all ${
                  receiptMode === 'direct' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Nhập trực tiếp (Không PO)
              </button>
            </div>

            {/* Setup fields depending on mode */}
            {receiptMode === 'po' ? (
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Đơn mua hàng (PO) chờ kiểm</label>
                  <select
                    value={selectedPOId}
                    onChange={(e) => setSelectedPOId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chọn đơn mua hàng PO --</option>
                    {pendingPOs.map(po => (
                      <option key={po.id} value={po.id}>
                        {po.po_code} - {po.supplier.name} ({po.status === 'sent' ? 'Chờ nhận' : 'Nhập một phần'})
                      </option>
                    ))}
                  </select>
                </div>
                {pendingPOs.length === 0 && (
                  <div className="p-4 bg-amber-50 text-amber-800 rounded-lg text-body-md flex items-center gap-2 border border-amber-100">
                    <AlertTriangle size={18} className="text-amber-600" />
                    <span>Hiện không có đơn mua hàng (PO) nào ở trạng thái chờ nhận hàng. Bạn có thể sử dụng chế độ Nhập trực tiếp.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Supplier select */}
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Nhà cung cấp <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <select
                        value={selectedSupplierId}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 appearance-none"
                      >
                        <option value="">-- Chọn nhà cung cấp --</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Warehouse select */}
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Kho nhận hàng <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <WarehouseIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <select
                        value={selectedWarehouseId}
                        onChange={(e) => setSelectedWarehouseId(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 appearance-none"
                      >
                        {warehouses.map(w => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Date select */}
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Ngày nhập kho</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input
                        type="date"
                        value={receiptDate}
                        onChange={(e) => setReceiptDate(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 bg-white border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Action button to load direct receiving screen */}
                  <div className="flex items-end">
                    <button
                      type="button"
                      disabled={!selectedSupplierId || !selectedWarehouseId}
                      onClick={() => {
                        // Start direct receiving session
                        const dummyPOId = `direct-${Date.now()}`
                        setSelectedPOId(dummyPOId)
                        setSelectedPO({
                          id: dummyPOId,
                          po_code: 'DIRECT-GR',
                          status: 'draft',
                          created_at: new Date().toISOString(),
                          supplier: {
                            id: selectedSupplierId,
                            name: suppliers.find(s => s.id === selectedSupplierId)?.name || 'Nhà cung cấp'
                          },
                          warehouse_id: selectedWarehouseId
                        })
                      }}
                      className="w-full h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold text-body-md rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Bắt đầu nhập hàng
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Main Verification Screen once PO/Direct Session is established */
          loading ? (
            <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-body-md text-gray-400">Đang khởi tạo danh mục nhập kho...</p>
            </div>
          ) : selectedPO && (
            <>
              {/* Toolbar & Header Section */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white border border-gray-100 p-6 rounded-xl shadow-sm">
                <div>
                  <div className="flex items-center gap-2 text-body-md text-gray-400">
                    <button 
                      onClick={() => {
                        setSelectedPOId('')
                        setSelectedPO(null)
                        setVerificationItems([])
                      }} 
                      className="hover:text-blue-500 font-semibold flex items-center gap-1"
                    >
                      <ArrowLeft size={14} />
                      <span>Cấu hình nhập</span>
                    </button>
                    <span>/</span>
                    <span className="text-gray-600 font-semibold">
                      {receiptMode === 'po' ? `Kiểm PO #${selectedPO.po_code}` : 'Nhập kho trực tiếp'}
                    </span>
                  </div>
                  <h2 className="text-headline-lg font-bold text-gray-800 mt-1">
                    {receiptMode === 'po' ? `Nhập kho từ đơn PO #${selectedPO.po_code}` : `Phiếu nhập trực tiếp - NCC: ${selectedPO.supplier.name}`}
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* View Mode Toggle */}
                  <div className="flex items-center bg-gray-50 border border-gray-100 rounded-lg p-0.5 shadow-sm text-tiny">
                    <button
                      type="button"
                      onClick={() => setViewMode('table')}
                      className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1 transition-all ${
                        viewMode === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-450 hover:text-gray-650'
                      }`}
                    >
                      <List size={14} />
                      <span>Dạng Bảng (Nhập nhanh)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('detail')}
                      className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1 transition-all ${
                        viewMode === 'detail' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-450 hover:text-gray-650'
                      }`}
                    >
                      <Eye size={14} />
                      <span>Dạng Chi tiết (Split)</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleQuickVerifyAll}
                    className="h-9 px-4 border border-blue-200 bg-blue-50 text-blue-700 font-semibold text-body-md rounded-lg hover:bg-blue-100 active:scale-95 transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <CheckCircle size={15} />
                    <span>Xác nhận nhanh tất cả</span>
                  </button>

                  <button
                    onClick={handleCompleteReceipt}
                    disabled={submitting}
                    className="h-9 px-5 bg-blue-500 text-white font-semibold text-body-md rounded-lg hover:bg-blue-600 active:scale-95 transition-all shadow-md disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Save size={15} />
                    <span>{submitting ? 'Đang xử lý...' : 'Lưu & Nhập kho'}</span>
                  </button>
                </div>
              </div>

              {/* Direct Mode Product Insertion Bar */}
              {receiptMode === 'direct' && (
                <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h4 className="text-body-md font-bold text-gray-700">Tìm kiếm & thêm sản phẩm nhập kho</h4>
                    <p className="text-tiny text-gray-400">Gõ tên thuốc thú y, vaccine hoặc SKU để đưa sản phẩm vào phiếu nhận.</p>
                  </div>
                  
                  <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                      type="text"
                      placeholder="Nhập tên sản phẩm hoặc mã SKU..."
                      value={productSearchTerm}
                      onChange={(e) => {
                        setProductSearchTerm(e.target.value)
                        setShowProductDropdown(true)
                      }}
                      onFocus={() => setShowProductDropdown(true)}
                      className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />

                    {/* Autocomplete Dropdown */}
                    {showProductDropdown && filteredProducts.length > 0 && (
                      <div className="absolute right-0 left-0 mt-1 max-h-64 overflow-y-auto bg-white border border-gray-100 rounded-lg shadow-lg z-50 py-1 divide-y divide-gray-50">
                        {filteredProducts.map(prod => (
                          <button
                            key={prod.id}
                            type="button"
                            onClick={() => handleAddProductDirect(prod)}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-25 text-body-md flex items-center justify-between transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="font-bold text-gray-700 truncate block">{prod.name}</span>
                              <span className="block text-[11px] text-gray-400 font-mono">SKU: {prod.sku} | Nhóm: {prod.categoryName}</span>
                            </div>
                            {prod.is_lot_managed && (
                              <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0">Lô</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {showProductDropdown && productSearchTerm.trim() && filteredProducts.length === 0 && (
                      <div className="absolute right-0 left-0 mt-1 p-4 bg-white border border-gray-100 rounded-lg shadow-lg z-50 text-center text-body-md text-gray-450">
                        Không tìm thấy sản phẩm nào khớp.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* VIEW MODE A: BULK TABLE VIEW (THE EASY TO USE INLINE GRID) */}
              {viewMode === 'table' ? (
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-gray-100 bg-gray-25/50 flex justify-between items-center">
                    <h3 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                      <Layers size={18} className="text-blue-500" />
                      <span>Bảng kê chi tiết kiểm kho hàng loạt</span>
                    </h3>
                    <div className="text-body-md text-gray-400">
                      Sản phẩm đã kiểm: <span className="font-bold text-gray-700">{verifiedCount}</span> / <span className="font-bold">{totalItemsCount}</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                          <th className="px-4 py-4 w-12 text-center">#</th>
                          <th className="px-4 py-4 min-w-[200px]">Tên sản phẩm / SKU</th>
                          <th className="px-4 py-4 w-36 text-center">Thực nhận</th>
                          {receiptMode === 'direct' && <th className="px-4 py-4 w-32 text-right">Giá nhập (₫)</th>}
                          <th className="px-4 py-4 w-40">Mã Số lô</th>
                          <th className="px-4 py-4 w-40">NSX</th>
                          <th className="px-4 py-4 w-40">HSD</th>
                          <th className="px-4 py-4 min-w-[180px]">Kho & Vị trí</th>
                          <th className="px-4 py-4 w-28 text-center">Xác nhận</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-body-md text-gray-750">
                        {verificationItems.length === 0 ? (
                          <tr>
                            <td colSpan={receiptMode === 'direct' ? 9 : 8} className="px-6 py-16 text-center text-gray-400 italic">
                              <Package className="w-12 h-12 mx-auto text-gray-200 mb-2" />
                              <span>{receiptMode === 'po' ? 'Không tìm thấy dòng PO nào.' : 'Vui lòng gõ tìm kiếm để thêm sản phẩm vào phiếu nhập kho.'}</span>
                            </td>
                          </tr>
                        ) : (
                          verificationItems.map((item, index) => {
                            const isCold = checkColdChain(item.productName, item.categoryName)
                            return (
                              <tr 
                                key={item.poLineId || item.productId} 
                                className={`hover:bg-gray-25/40 transition-colors ${
                                  item.isVerified ? 'bg-emerald-25/5' : ''
                                }`}
                              >
                                <td className="px-4 py-4 text-center">
                                  {receiptMode === 'direct' ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveProductDirect(index)}
                                      className="text-red-500 hover:text-red-700 transition-colors"
                                      title="Xóa sản phẩm"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  ) : (
                                    <span className="text-gray-400 font-medium">{index + 1}</span>
                                  )}
                                </td>

                                <td className="px-4 py-4">
                                  <div className="space-y-1">
                                    <span className="font-bold text-gray-800 block leading-tight">{item.productName}</span>
                                    <div className="flex flex-wrap gap-1.5 items-center">
                                      <span className="text-gray-450 font-mono text-[11px]">SKU: {item.productSku}</span>
                                      {isCold && (
                                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold uppercase flex items-center gap-0.5">
                                          <AlertTriangle size={9} />
                                          Lạnh
                                        </span>
                                      )}
                                      {item.isLotManaged && (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold uppercase">
                                          Lô
                                        </span>
                                      )}
                                    </div>
                                    
                                    {/* PO Quantities detail */}
                                    {receiptMode === 'po' && (
                                      <span className="text-[11px] text-gray-400 block font-medium">
                                        PO đặt: {item.quantityOrdered} | Đã nhận: {item.quantityPreviouslyReceived}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="px-4 py-4">
                                  <div className="flex items-center border border-gray-100 rounded-lg overflow-hidden h-8 w-28 bg-white shadow-sm">
                                    <button
                                      type="button"
                                      onClick={() => updateItemAtIndex(index, { 
                                        quantityReceived: Math.max(0, item.quantityReceived - 1),
                                        isVerified: false
                                      })}
                                      className="w-8 h-full flex items-center justify-center hover:bg-gray-50 border-r border-gray-100 text-gray-400"
                                    >
                                      <Minus size={12} />
                                    </button>
                                    <input
                                      type="number"
                                      min="0"
                                      value={item.quantityReceived}
                                      onChange={(e) => updateItemAtIndex(index, { 
                                        quantityReceived: Math.max(0, parseInt(e.target.value) || 0),
                                        isVerified: false
                                      })}
                                      className="w-12 text-center border-none p-0 text-body-md font-bold focus:ring-0"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => updateItemAtIndex(index, { 
                                        quantityReceived: item.quantityReceived + 1,
                                        isVerified: false
                                      })}
                                      className="w-8 h-full flex items-center justify-center hover:bg-gray-50 border-l border-gray-100 text-gray-400"
                                    >
                                      <Plus size={12} />
                                    </button>
                                  </div>
                                </td>

                                {receiptMode === 'direct' && (
                                  <td className="px-4 py-4">
                                    <input
                                      type="number"
                                      min="0"
                                      value={item.unitPrice === 0 ? '' : item.unitPrice}
                                      placeholder="0"
                                      onChange={(e) => updateItemAtIndex(index, { 
                                        unitPrice: Math.max(0, parseFloat(e.target.value) || 0),
                                        isVerified: false
                                      })}
                                      className="w-full text-right h-8 px-2 border border-gray-100 rounded-lg text-body-md font-semibold focus:border-blue-500 focus:outline-none"
                                    />
                                  </td>
                                )}

                                <td className="px-4 py-4">
                                  <input
                                    type="text"
                                    placeholder={item.isLotManaged ? "Bắt buộc *" : "Số lô (tùy chọn)"}
                                    value={item.lotNumber}
                                    onChange={(e) => updateItemAtIndex(index, { 
                                      lotNumber: e.target.value,
                                      isVerified: false
                                    })}
                                    className={`w-full h-8 px-2 border rounded-lg text-body-md focus:border-blue-500 focus:outline-none ${
                                      item.isLotManaged && !item.lotNumber.trim() ? 'border-amber-250 bg-amber-25/5' : 'border-gray-100'
                                    }`}
                                  />
                                </td>

                                <td className="px-4 py-4">
                                  <input
                                    type="date"
                                    value={item.manufactureDate}
                                    onChange={(e) => updateItemAtIndex(index, { manufactureDate: e.target.value, isVerified: false })}
                                    className="w-full h-8 px-1.5 border border-gray-100 rounded-lg text-tiny focus:border-blue-500 focus:outline-none bg-white"
                                  />
                                </td>

                                <td className="px-4 py-4">
                                  <input
                                    type="date"
                                    value={item.expiryDate}
                                    onChange={(e) => updateItemAtIndex(index, { expiryDate: e.target.value, isVerified: false })}
                                    className="w-full h-8 px-1.5 border border-gray-100 rounded-lg text-tiny focus:border-blue-500 focus:outline-none bg-white"
                                  />
                                </td>

                                <td className="px-4 py-4">
                                  <div className="space-y-1">
                                    <select
                                      value={item.warehouseId}
                                      onChange={(e) => updateItemAtIndex(index, { warehouseId: e.target.value, isVerified: false })}
                                      className="w-full h-8 px-2 border border-gray-100 rounded-lg text-tiny bg-white focus:border-blue-500 focus:outline-none appearance-none"
                                    >
                                      {warehouses.map(wh => (
                                        <option key={wh.id} value={wh.id}>{wh.name}</option>
                                      ))}
                                    </select>
                                    <input
                                      type="text"
                                      placeholder="Vị trí kệ (Bin)"
                                      value={item.shelfBin}
                                      onChange={(e) => updateItemAtIndex(index, { shelfBin: e.target.value, isVerified: false })}
                                      className="w-full h-7 px-2 border border-gray-100 rounded-md text-tiny focus:border-blue-500 focus:outline-none"
                                    />
                                    
                                    {/* Cold Chain Vaccine warehouse warning in table */}
                                    {isCold && !warehouses.find(w => w.id === item.warehouseId)?.name.toLowerCase().match(/(lạnh|mát)/) && (
                                      <span className="text-[10px] text-amber-600 font-semibold block leading-tight">
                                        ⚠️ Vaccine: Nên chọn kho mát/lạnh
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="px-4 py-4 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyItem(index)}
                                    className={`w-7 h-7 rounded-full border flex items-center justify-center mx-auto transition-all ${
                                      item.isVerified 
                                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm' 
                                        : 'bg-white border-gray-250 text-gray-300 hover:text-gray-500 hover:border-gray-300'
                                    }`}
                                  >
                                    <Check size={14} strokeWidth={3} />
                                  </button>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary amount calculation under Table */}
                  {verificationItems.length > 0 && (
                    <div className="bg-gray-25/50 border-t border-gray-100 p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-body-md text-gray-500">
                      <div>
                        Nhập kho bởi: <span className="font-semibold text-gray-700">{profile?.full_name || 'Nhân viên'}</span>
                      </div>
                      <div className="text-right space-y-1">
                        <div>
                          Tổng tiền hàng thực nhập (chưa VAT): <span className="font-bold text-gray-800">
                            {verificationItems
                              .filter(item => item.isVerified)
                              .reduce((sum, item) => sum + (item.quantityReceived * item.unitPrice), 0)
                              .toLocaleString('vi-VN')} ₫
                          </span>
                        </div>
                        <div className="text-tiny text-gray-400">
                          (Đơn giá trị được đồng bộ từ PO hoặc tự nhập trực tiếp)
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* VIEW MODE B: SPLIT DETAILED VIEW (THE STITCH TEMPLATE SPLIT LAYOUT) */
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  
                  {/* Left Column (40%): Item Checklist */}
                  <div className="lg:col-span-5 space-y-6">
                    {/* Header Info summary */}
                    <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-4">
                      <h3 className="text-body-lg font-bold text-gray-800 pb-2 border-b border-gray-100">Thông tin đơn nhập</h3>
                      <div className="space-y-3 text-body-md">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Hình thức:</span>
                          <span className="font-bold text-gray-700">{receiptMode === 'po' ? 'Nhập từ PO' : 'Nhập trực tiếp'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Nhà cung cấp:</span>
                          <span className="font-semibold text-gray-700 text-right truncate max-w-[200px]" title={selectedPO.supplier.name}>
                            {selectedPO.supplier.name}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Ngày nhập:</span>
                          <span className="font-semibold text-gray-600">{new Date(receiptDate).toLocaleDateString('vi-VN')}</span>
                        </div>
                      </div>
                    </div>

                    {/* List of checklist items */}
                    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                      <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                        <h3 className="text-body-lg font-bold text-gray-800">Danh sách mặt hàng ({verificationItems.length})</h3>
                        {receiptMode === 'direct' && <span className="text-tiny text-blue-500 font-semibold">Tự thêm</span>}
                      </div>

                      <div className="divide-y divide-gray-50 max-h-[380px] overflow-y-auto custom-scrollbar">
                        {verificationItems.length === 0 ? (
                          <div className="p-8 text-center text-gray-400 italic text-tiny">
                            Chưa có sản phẩm nào.
                          </div>
                        ) : (
                          verificationItems.map((item, index) => {
                            const isCold = checkColdChain(item.productName, item.categoryName)
                            return (
                              <div
                                key={item.poLineId || item.productId}
                                onClick={() => setSelectedItemIndex(index)}
                                className={`p-4 flex gap-4 hover:bg-gray-25 transition-all cursor-pointer border-l-4 ${
                                  selectedItemIndex === index 
                                    ? 'border-blue-500 bg-blue-25/10' 
                                    : 'border-transparent'
                                }`}
                              >
                                <div className="w-10 h-10 bg-gray-50 flex items-center justify-center rounded text-blue-500 flex-shrink-0 relative">
                                  <Package size={20} />
                                  {isCold && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" title="Bảo quản lạnh" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-gray-800 truncate leading-tight">{item.productName}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] font-mono text-gray-400">SKU: {item.productSku}</span>
                                    {receiptMode === 'po' && (
                                      <span className="text-[10px] text-gray-400 font-semibold">Đặt: {item.quantityOrdered}</span>
                                    )}
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {receiptMode === 'direct' && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleRemoveProductDirect(index)
                                      }}
                                      className="text-gray-350 hover:text-red-500 p-1 transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                  {item.isVerified ? (
                                    <CheckCircle className="text-emerald-500" size={18} />
                                  ) : (
                                    <div className="w-4.5 h-4.5 rounded-full border-2 border-gray-200" />
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column (60%): Detail Form for Active Item */}
                  <div className="lg:col-span-7">
                    {currentItem ? (
                      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden space-y-6">
                        
                        {/* Form Header */}
                        <div className="p-6 border-b border-gray-100 bg-gray-25/50 flex justify-between items-center gap-4">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-body-lg font-bold text-gray-800 truncate">{currentItem.productName}</h3>
                            <p className="text-body-md text-gray-400 mt-0.5">Mã SKU: <span className="font-mono text-gray-600 font-semibold">{currentItem.productSku}</span></p>
                          </div>
                          <span className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded text-[10px] uppercase flex-shrink-0">
                            {currentItem.categoryName}
                          </span>
                        </div>

                        {/* Form Body */}
                        <div className="p-6 space-y-6">
                          
                          {/* Warehouse selection & shelf */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                              <label className="block text-body-md font-semibold text-gray-700 font-medium">Kho nhận thực tế</label>
                              <select
                                value={currentItem.warehouseId}
                                onChange={(e) => updateItemAtIndex(selectedItemIndex, { warehouseId: e.target.value, isVerified: false })}
                                className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                              >
                                {warehouses.map(w => (
                                  <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                              </select>
                            </div>
                            
                            <div className="space-y-1.5">
                              <label className="block text-body-md font-semibold text-gray-700 font-medium">Vị trí kệ (Shelf/Bin)</label>
                              <input
                                type="text"
                                placeholder="Nhập vị trí kệ, hàng..."
                                value={currentItem.shelfBin}
                                onChange={(e) => updateItemAtIndex(selectedItemIndex, { shelfBin: e.target.value, isVerified: false })}
                                className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          </div>

                          {/* Cold Chain Warning box if vaccine */}
                          {checkColdChain(currentItem.productName, currentItem.categoryName) && (
                            <div className="flex items-center gap-3 p-4 bg-[#FFF9EB] border border-[#FFD666] text-[#874D00] rounded-lg">
                              <AlertTriangle size={20} className="text-[#D48806] flex-shrink-0" />
                              <p className="text-body-md font-medium">
                                Cảnh báo: Sản phẩm yêu cầu bảo quản chuỗi lạnh. Vui lòng chọn kho mát hoặc kho lạnh phù hợp.
                              </p>
                            </div>
                          )}

                          <hr className="border-gray-100" />

                          {/* Verification quantities and Lot */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                              <label className="block text-body-md font-semibold text-gray-700 font-medium">Số lượng thực nhận</label>
                              <div className="flex items-center border border-gray-100 rounded-lg overflow-hidden h-10 bg-white shadow-sm">
                                <button
                                  type="button"
                                  onClick={() => updateItemAtIndex(selectedItemIndex, { 
                                    quantityReceived: Math.max(0, currentItem.quantityReceived - 1),
                                    isVerified: false
                                  })}
                                  className="w-10 h-full flex items-center justify-center hover:bg-gray-50 border-r border-gray-100 text-gray-500"
                                >
                                  <Minus size={16} />
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={currentItem.quantityReceived}
                                  onChange={(e) => updateItemAtIndex(selectedItemIndex, { 
                                    quantityReceived: Math.max(0, parseInt(e.target.value) || 0),
                                    isVerified: false
                                  })}
                                  className="flex-1 text-center border-none p-0 text-body-md font-bold focus:ring-0"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateItemAtIndex(selectedItemIndex, { 
                                    quantityReceived: currentItem.quantityReceived + 1,
                                    isVerified: false
                                  })}
                                  className="w-10 h-full flex items-center justify-center hover:bg-gray-50 border-l border-gray-100 text-gray-500"
                                >
                                  <Plus size={16} />
                                </button>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <label className="block text-body-md font-semibold text-gray-700 font-medium">
                                Số lô (Lot Number) {currentItem.isLotManaged && <span className="text-red-500">*</span>}
                              </label>
                              <input
                                type="text"
                                placeholder="Nhập số lô sản xuất..."
                                value={currentItem.lotNumber}
                                onChange={(e) => updateItemAtIndex(selectedItemIndex, { lotNumber: e.target.value, isVerified: false })}
                                className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          </div>

                          {/* Date details and direct cost price */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                              <label className="block text-body-md font-semibold text-gray-700 font-medium">Ngày sản xuất (NSX)</label>
                              <input
                                type="date"
                                value={currentItem.manufactureDate}
                                onChange={(e) => updateItemAtIndex(selectedItemIndex, { manufactureDate: e.target.value, isVerified: false })}
                                className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="block text-body-md font-semibold text-gray-700 font-medium">Ngày hết hạn (HSD)</label>
                              <input
                                type="date"
                                value={currentItem.expiryDate}
                                onChange={(e) => updateItemAtIndex(selectedItemIndex, { expiryDate: e.target.value, isVerified: false })}
                                className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            {/* Unit Price input if in direct mode */}
                            <div className="space-y-1.5">
                              <label className="block text-body-md font-semibold text-gray-700 font-medium">
                                Đơn giá nhập (₫) {receiptMode === 'direct' ? <span className="text-red-500">*</span> : ''}
                              </label>
                              <input
                                type="number"
                                min="0"
                                placeholder="Nhập đơn giá của NCC..."
                                disabled={receiptMode === 'po'}
                                value={currentItem.unitPrice}
                                onChange={(e) => updateItemAtIndex(selectedItemIndex, { unitPrice: Math.max(0, parseFloat(e.target.value) || 0), isVerified: false })}
                                className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400 font-semibold"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="block text-body-md font-semibold text-gray-700 font-medium">Ghi chú kiểm tra</label>
                              <input
                                type="text"
                                placeholder="Tình trạng bao bì, móp méo..."
                                value={currentItem.notes}
                                onChange={(e) => updateItemAtIndex(selectedItemIndex, { notes: e.target.value })}
                                className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          </div>

                          {/* Active Item Action Buttons */}
                          <div className="flex justify-end gap-3 pt-4 border-t border-gray-50">
                            <button
                              type="button"
                              onClick={() => {
                                // Skip to next item
                                const nextIdx = (selectedItemIndex + 1) % verificationItems.length
                                setSelectedItemIndex(nextIdx)
                              }}
                              className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              Bỏ qua
                            </button>
                            <button
                              type="button"
                              onClick={() => handleVerifyItem(selectedItemIndex)}
                              className="px-5 h-10 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm"
                            >
                              <CheckCircle size={16} />
                              <span>Xác nhận mặt hàng này</span>
                            </button>
                          </div>
                        </div>

                      </div>
                    ) : (
                      <div className="bg-white border border-gray-100 rounded-xl p-16 text-center text-gray-400 shadow-sm">
                        <Package size={48} className="mx-auto text-gray-300 mb-4" />
                        <h4 className="font-bold text-gray-600 text-body-lg">Chưa chọn sản phẩm nào để kiểm tra</h4>
                        <p className="text-body-md mt-1">Vui lòng click chọn một mặt hàng ở danh sách bên trái.</p>
                      </div>
                    )}

                    {/* Progress Bar in Detailed View */}
                    <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full border-4 border-blue-500 flex items-center justify-center flex-shrink-0">
                          <span className="font-bold text-blue-600">{verifiedCount}/{totalItemsCount}</span>
                        </div>
                        <div>
                          <p className="text-body-md font-bold text-gray-800">Tiến độ kiểm kho</p>
                          <p className="text-tiny text-gray-400">Kiểm tra và xác nhận từng mặt hàng trong danh sách đặt</p>
                        </div>
                      </div>
                      <div className="w-full sm:w-48 h-2 bg-gray-50 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* General Note and Summary Panel */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
                {/* Note Field */}
                <div className="lg:col-span-7 bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col justify-between h-fit">
                  <label className="block text-body-lg font-bold text-gray-700 mb-3">Ghi chú chung cho phiếu nhập kho</label>
                  <textarea
                    placeholder="Nhập ghi chú chi tiết về đợt giao hàng này, ghi chú bốc xếp, lưu kho..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full h-32 p-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>

                {/* Confirm Outflow / CTA Card */}
                <div className="lg:col-span-5 bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-6">
                  <div className="space-y-3 pb-4 border-b border-gray-50">
                    <div className="flex justify-between items-center text-gray-400 text-body-md">
                      <span>Số mặt hàng đã kiểm</span>
                      <span className="font-bold text-gray-700">{verifiedCount} / {totalItemsCount}</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-400 text-body-md border-b border-dashed border-gray-100 pb-3">
                      <span>Thuế VAT tính thêm (5%)</span>
                      <span className="font-semibold text-gray-700">
                        {(verificationItems
                          .filter(item => item.isVerified)
                          .reduce((sum, item) => sum + (item.quantityReceived * item.unitPrice), 0) * 0.05
                        ).toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-body-lg font-bold text-gray-800">Tổng giá trị thực nhập</span>
                      <span className="text-headline-md font-bold text-blue-600">
                        {(verificationItems
                          .filter(item => item.isVerified)
                          .reduce((sum, item) => sum + (item.quantityReceived * item.unitPrice), 0) * 1.05
                        ).toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        // Reset receiving session
                        setSelectedPOId('')
                        setSelectedPO(null)
                        setVerificationItems([])
                      }}
                      className="h-10 border border-gray-100 text-gray-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
                    >
                      Quay lại
                    </button>
                    <button
                      type="button"
                      disabled={submitting || verificationItems.filter(item => item.isVerified).length === 0}
                      onClick={handleCompleteReceipt}
                      className="h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-md flex items-center justify-center gap-2 disabled:opacity-50 transition-all active:scale-95"
                    >
                      <Save size={16} />
                      <span>{submitting ? 'Đang lưu...' : 'Hoàn tất nhập kho'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )
        )}

      </div>
    </Layout>
  )
}
