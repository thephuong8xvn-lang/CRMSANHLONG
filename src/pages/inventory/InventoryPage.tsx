import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Plus,
  Warehouse as WarehouseIcon,
  Layers,
  FileText,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  ShieldAlert,
  Settings,
  HelpCircle,
  Filter,
  CheckCircle2,
  Calendar,
  ChevronDown,
  ArrowRightLeft,
  RotateCcw,
  Trash2
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'


interface StockLot {
  id: string
  lot_number: string
  manufacture_date: string | null
  expiry_date: string | null
  cost_price: number
  quantity_on_hand: number
  status: string
  product: {
    id: string
    name: string
    sku: string
    category: {
      name: string
    } | null
  }
  warehouse: {
    id: string
    name: string
  }
  supplier: {
    id: string
    name: string
  } | null
}

interface PurchaseOrder {
  id: string
  po_code: string
  status: string
  expected_date: string | null
  grand_total: number
  created_at: string
  supplier: {
    name: string
  }
  warehouse: {
    name: string
  }
}

interface GoodsReceipt {
  id: string
  receipt_code: string
  receipt_date: string
  total_amount: number
  notes: string | null
  supplier: {
    name: string
  }
  warehouse: {
    name: string
  }
  profile: {
    full_name: string
  } | null
}

interface InventorySetting {
  id: string
  product_id: string
  warehouse_id: string
  min_stock_level: number
  max_stock_level: number | null
  product: {
    sku: string
    name: string
  }
  warehouse: {
    name: string
  }
}

export default function InventoryPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState<'lots' | 'pos' | 'receipts' | 'transfers' | 'purchase_returns' | 'settings'>('lots')

  // Shared States
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  
  // Tab 1: Stock Lots states
  const [lots, setLots] = useState<StockLot[]>([])
  const [lotSearchTerm, setLotSearchTerm] = useState('')
  const [whFilter, setWhFilter] = useState('all')
  const [lotQuickFilter, setLotQuickFilter] = useState<'all' | 'near-expiry' | 'low-stock' | 'quarantine'>('all')

  // Tab 2: POs states
  const [pos, setPOs] = useState<PurchaseOrder[]>([])
  const [poSearchTerm, setPoSearchTerm] = useState('')

  // Tab 3: Receipts states
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [receiptSearchTerm, setReceiptSearchTerm] = useState('')

  // Tab 4: Settings/Low stock alerts states
  const [invSettings, setInvSettings] = useState<InventorySetting[]>([])
  const [newSetting, setNewSetting] = useState({
    productId: '',
    warehouseId: '',
    minStock: 10,
    maxStock: 500
  })
  const [productList, setProductList] = useState<{ id: string; name: string; sku: string }[]>([])
  const [isEditingSetting, setIsEditingSetting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Tab: Stock Transfers states
  const [transfers, setTransfers] = useState<any[]>([])
  const [transferSearchTerm, setTransferSearchTerm] = useState('')
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showTransferDetailModal, setShowTransferDetailModal] = useState(false)
  const [selectedTransfer, setSelectedTransfer] = useState<any>(null)
  const [selectedTransferLines, setSelectedTransferLines] = useState<any[]>([])
  const [lotsForWarehouse, setLotsForWarehouse] = useState<any[]>([])
  const [newTransfer, setNewTransfer] = useState<{
    fromWarehouse: string;
    toWarehouse: string;
    notes: string;
    lines: Array<{ lotId: string; productId: string; quantity: number; maxQty: number; name: string; sku: string; lotNumber: string }>;
  }>({
    fromWarehouse: '',
    toWarehouse: '',
    notes: '',
    lines: []
  })

  // Tab: Purchase Returns states
  const [purchaseReturns, setPurchaseReturns] = useState<any[]>([])
  const [returnSearchTerm, setReturnSearchTerm] = useState('')
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [showReturnDetailModal, setShowReturnDetailModal] = useState(false)
  const [selectedReturn, setSelectedReturn] = useState<any>(null)
  const [selectedReturnLines, setSelectedReturnLines] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [newReturn, setNewReturn] = useState<{
    supplierId: string;
    warehouseId: string;
    reasonCode: string;
    reasonDetail: string;
    refundMethod: string;
    lines: Array<{ lotId: string; productId: string; quantity: number; maxQty: number; unitPrice: number; name: string; sku: string; lotNumber: string }>;
  }>({
    supplierId: '',
    warehouseId: '',
    reasonCode: 'other',
    reasonDetail: '',
    refundMethod: 'credit_note',
    lines: []
  })

  // Temporary states for adding lines in modals
  const [modalLotId, setModalLotId] = useState('')
  const [modalQty, setModalQty] = useState(1)
  const [modalUnitPrice, setModalUnitPrice] = useState(0)

  // Fetch lots for selected source warehouse (for Transfers)
  useEffect(() => {
    const fetchLotsForWarehouse = async () => {
      if (!newTransfer.fromWarehouse) {
        setLotsForWarehouse([])
        return
      }
      const { data } = await supabase
        .from('stock_lots')
        .select(`
          id,
          lot_number,
          quantity_on_hand,
          quantity_reserved,
          expiry_date,
          cost_price,
          product:products(id, name, sku, unit)
        `)
        .eq('warehouse_id', newTransfer.fromWarehouse)
        .eq('status', 'active')
        .gt('quantity_on_hand', 0)

      if (data) {
        const formatted = data.map((l: any) => ({
          id: l.id,
          lot_number: l.lot_number,
          quantity_on_hand: l.quantity_on_hand,
          quantity_reserved: l.quantity_reserved,
          expiry_date: l.expiry_date,
          cost_price: Number(l.cost_price),
          product_id: l.product?.id || '',
          name: l.product?.name || '',
          sku: l.product?.sku || '',
          unit: l.product?.unit || ''
        }))
        setLotsForWarehouse(formatted)
      }
    }
    fetchLotsForWarehouse()
  }, [newTransfer.fromWarehouse])

  // Load lots for selected warehouse (for Purchase Returns)
  useEffect(() => {
    const fetchLotsForReturn = async () => {
      if (!newReturn.warehouseId) {
        setLotsForWarehouse([])
        return
      }
      const { data } = await supabase
        .from('stock_lots')
        .select(`
          id,
          lot_number,
          quantity_on_hand,
          quantity_reserved,
          expiry_date,
          cost_price,
          product:products(id, name, sku, unit)
        `)
        .eq('warehouse_id', newReturn.warehouseId)
        .eq('status', 'active')
        .gt('quantity_on_hand', 0)

      if (data) {
        const formatted = data.map((l: any) => ({
          id: l.id,
          lot_number: l.lot_number,
          quantity_on_hand: l.quantity_on_hand,
          quantity_reserved: l.quantity_reserved,
          expiry_date: l.expiry_date,
          cost_price: Number(l.cost_price),
          product_id: l.product?.id || '',
          name: l.product?.name || '',
          sku: l.product?.sku || '',
          unit: l.product?.unit || ''
        }))
        setLotsForWarehouse(formatted)
      }
    }
    fetchLotsForReturn()
  }, [newReturn.warehouseId])

  // Load suppliers list when Returns tab or return modal is active
  useEffect(() => {
    const fetchSuppliers = async () => {
      if (activeTab !== 'purchase_returns' && !showReturnModal) return
      const { data } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true)
      if (data) setSuppliers(data)
    }
    fetchSuppliers()
  }, [activeTab, showReturnModal])

  // Fetch detail lines for selected transfer
  const fetchTransferDetails = async (transferId: string) => {
    const { data, error } = await supabase
      .from('stock_transfer_lines')
      .select(`
        id,
        quantity,
        lot_id,
        product_id,
        product:products(name, sku, unit),
        lot:stock_lots(lot_number, expiry_date)
      `)
      .eq('transfer_id', transferId)

    if (!error && data) {
      setSelectedTransferLines(data)
    }
  }

  // Fetch detail lines for selected purchase return
  const fetchReturnDetails = async (returnId: string) => {
    const { data, error } = await supabase
      .from('purchase_return_lines')
      .select(`
        id,
        quantity,
        unit_price,
        line_total,
        lot_id,
        product_id,
        product:products(name, sku, unit),
        lot:stock_lots(lot_number, expiry_date)
      `)
      .eq('purchase_return_id', returnId)

    if (!error && data) {
      setSelectedReturnLines(data)
    }
  }

  // Filtered transfers logic
  const filteredTransfers = transfers.filter(t => {
    return (
      t.transfer_code.toLowerCase().includes(transferSearchTerm.toLowerCase()) ||
      (t.from_wh?.name || '').toLowerCase().includes(transferSearchTerm.toLowerCase()) ||
      (t.to_wh?.name || '').toLowerCase().includes(transferSearchTerm.toLowerCase())
    )
  })

  // Filtered returns logic
  const filteredReturns = purchaseReturns.filter(r => {
    return (
      r.return_code.toLowerCase().includes(returnSearchTerm.toLowerCase()) ||
      (r.supplier?.name || '').toLowerCase().includes(returnSearchTerm.toLowerCase()) ||
      (r.warehouse?.name || '').toLowerCase().includes(returnSearchTerm.toLowerCase())
    )
  })

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTransfer.fromWarehouse || !newTransfer.toWarehouse) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn kho nguồn và kho đích.' })
      return
    }
    if (newTransfer.fromWarehouse === newTransfer.toWarehouse) {
      setAlertMsg({ type: 'error', text: 'Kho nguồn và kho đích phải khác nhau.' })
      return
    }
    if (newTransfer.lines.length === 0) {
      setAlertMsg({ type: 'error', text: 'Vui lòng thêm ít nhất một sản phẩm cần chuyển.' })
      return
    }
    setSubmitting(true)
    try {
      const { data: transferData, error: txError } = await supabase
        .from('stock_transfers')
        .insert([{
          from_warehouse: newTransfer.fromWarehouse,
          to_warehouse: newTransfer.toWarehouse,
          notes: newTransfer.notes || null,
          created_by: profile?.id,
          status: 'draft'
        }])
        .select()
        .single()

      if (txError) throw txError

      const linesToInsert = newTransfer.lines.map(line => ({
        transfer_id: transferData.id,
        lot_id: line.lotId,
        product_id: line.productId,
        quantity: line.quantity
      }))

      const { error: linesError } = await supabase
        .from('stock_transfer_lines')
        .insert(linesToInsert)

      if (linesError) throw linesError

      setAlertMsg({ type: 'success', text: 'Tạo yêu cầu chuyển kho thành công!' })
      setShowTransferModal(false)
      setNewTransfer({ fromWarehouse: '', toWarehouse: '', notes: '', lines: [] })
      
      const { data } = await supabase
        .from('stock_transfers')
        .select(`
          id,
          transfer_code,
          from_warehouse,
          to_warehouse,
          status,
          transfer_date,
          notes,
          created_by,
          received_by,
          from_wh:warehouses!from_warehouse(name),
          to_wh:warehouses!to_warehouse(name),
          creator:profiles!created_by(full_name),
          receiver:profiles!received_by(full_name)
        `)
        .order('transfer_date', { ascending: false })
      setTransfers(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi tạo phiếu chuyển: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartTransfer = async (transfer: any, lines: any[]) => {
    setSubmitting(true)
    try {
      for (const line of lines) {
        const { data: lotData } = await supabase
          .from('stock_lots')
          .select('quantity_on_hand, quantity_reserved')
          .eq('id', line.lot_id)
          .single()

        if (!lotData || (lotData.quantity_on_hand - lotData.quantity_reserved) < line.quantity) {
          throw new Error(`Sản phẩm trong lô không đủ tồn kho để chuyển. Yêu cầu: ${line.quantity}`)
        }

        const { error: updateError } = await supabase
          .from('stock_lots')
          .update({
            quantity_on_hand: lotData.quantity_on_hand - line.quantity
          })
          .eq('id', line.lot_id)

        if (updateError) throw updateError

        const { error: moveError } = await supabase
          .from('stock_movements')
          .insert([{
            lot_id: line.lot_id,
            product_id: line.product_id,
            warehouse_id: transfer.from_warehouse,
            movement_type: 'transfer_out',
            quantity: -line.quantity,
            reference_id: transfer.id,
            reference_type: 'stock_transfer',
            performed_by: profile?.id
          }])
        
        if (moveError) throw moveError
      }

      const { error: statusError } = await supabase
        .from('stock_transfers')
        .update({ status: 'in_transit' })
        .eq('id', transfer.id)

      if (statusError) throw statusError

      setAlertMsg({ type: 'success', text: 'Chuyển hàng thành công! Trạng thái: Đang đi đường.' })
      setShowTransferDetailModal(false)
      
      const { data } = await supabase
        .from('stock_transfers')
        .select(`
          id,
          transfer_code,
          from_warehouse,
          to_warehouse,
          status,
          transfer_date,
          notes,
          created_by,
          received_by,
          from_wh:warehouses!from_warehouse(name),
          to_wh:warehouses!to_warehouse(name),
          creator:profiles!created_by(full_name),
          receiver:profiles!received_by(full_name)
        `)
        .order('transfer_date', { ascending: false })
      setTransfers(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi chuyển hàng: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleReceiveTransfer = async (transfer: any, lines: any[]) => {
    setSubmitting(true)
    try {
      for (const line of lines) {
        const { data: sourceLot } = await supabase
          .from('stock_lots')
          .select('lot_number, manufacture_date, expiry_date, cost_price, status')
          .eq('id', line.lot_id)
          .single()

        if (!sourceLot) throw new Error('Không tìm thấy lô hàng nguồn.')

        const { data: targetLot } = await supabase
          .from('stock_lots')
          .select('id, quantity_on_hand')
          .eq('product_id', line.product_id)
          .eq('lot_number', sourceLot.lot_number)
          .eq('warehouse_id', transfer.to_warehouse)
          .maybeSingle()

        let targetLotId = ''
        if (targetLot) {
          targetLotId = targetLot.id
          const { error: updateError } = await supabase
            .from('stock_lots')
            .update({
              quantity_on_hand: targetLot.quantity_on_hand + line.quantity
            })
            .eq('id', targetLotId)
          
          if (updateError) throw updateError
        } else {
          const { data: newLot, error: createError } = await supabase
            .from('stock_lots')
            .insert([{
              product_id: line.product_id,
              warehouse_id: transfer.to_warehouse,
              lot_number: sourceLot.lot_number,
              manufacture_date: sourceLot.manufacture_date,
              expiry_date: sourceLot.expiry_date,
              cost_price: sourceLot.cost_price,
              quantity_on_hand: line.quantity,
              status: sourceLot.status
            }])
            .select()
            .single()

          if (createError) throw createError
          targetLotId = newLot.id
        }

        const { error: moveError } = await supabase
          .from('stock_movements')
          .insert([{
            lot_id: targetLotId,
            product_id: line.product_id,
            warehouse_id: transfer.to_warehouse,
            movement_type: 'transfer_in',
            quantity: line.quantity,
            reference_id: transfer.id,
            reference_type: 'stock_transfer',
            performed_by: profile?.id
          }])

        if (moveError) throw moveError
      }

      const { error: statusError } = await supabase
        .from('stock_transfers')
        .update({
          status: 'received',
          received_by: profile?.id,
          received_at: new Date().toISOString()
        })
        .eq('id', transfer.id)

      if (statusError) throw statusError

      setAlertMsg({ type: 'success', text: 'Nhận hàng và nhập kho thành công!' })
      setShowTransferDetailModal(false)
      
      const { data } = await supabase
        .from('stock_transfers')
        .select(`
          id,
          transfer_code,
          from_warehouse,
          to_warehouse,
          status,
          transfer_date,
          notes,
          created_by,
          received_by,
          from_wh:warehouses!from_warehouse(name),
          to_wh:warehouses!to_warehouse(name),
          creator:profiles!created_by(full_name),
          receiver:profiles!received_by(full_name)
        `)
        .order('transfer_date', { ascending: false })
      setTransfers(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi nhận hàng: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelTransfer = async (transfer: any, lines: any[]) => {
    setSubmitting(true)
    try {
      if (transfer.status === 'in_transit') {
        for (const line of lines) {
          const { data: lotData } = await supabase
            .from('stock_lots')
            .select('quantity_on_hand')
            .eq('id', line.lot_id)
            .single()

          if (lotData) {
            const { error: updateError } = await supabase
              .from('stock_lots')
              .update({
                quantity_on_hand: lotData.quantity_on_hand + line.quantity
              })
              .eq('id', line.lot_id)

            if (updateError) throw updateError

            const { error: moveError } = await supabase
              .from('stock_movements')
              .insert([{
                lot_id: line.lot_id,
                product_id: line.product_id,
                warehouse_id: transfer.from_warehouse,
                movement_type: 'transfer_in',
                quantity: line.quantity,
                reference_id: transfer.id,
                reference_type: 'stock_transfer',
                performed_by: profile?.id,
                notes: 'Hoàn kho do hủy chuyển'
              }])

            if (moveError) throw moveError
          }
        }
      }

      const { error: statusError } = await supabase
        .from('stock_transfers')
        .update({ status: 'cancelled' })
        .eq('id', transfer.id)

      if (statusError) throw statusError

      setAlertMsg({ type: 'success', text: 'Đã hủy yêu cầu chuyển kho.' })
      setShowTransferDetailModal(false)
      
      const { data } = await supabase
        .from('stock_transfers')
        .select(`
          id,
          transfer_code,
          from_warehouse,
          to_warehouse,
          status,
          transfer_date,
          notes,
          created_by,
          received_by,
          from_wh:warehouses!from_warehouse(name),
          to_wh:warehouses!to_warehouse(name),
          creator:profiles!created_by(full_name),
          receiver:profiles!received_by(full_name)
        `)
        .order('transfer_date', { ascending: false })
      setTransfers(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi hủy phiếu chuyển: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateReturn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newReturn.supplierId || !newReturn.warehouseId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn nhà cung cấp và kho hàng.' })
      return
    }
    if (newReturn.lines.length === 0) {
      setAlertMsg({ type: 'error', text: 'Vui lòng thêm ít nhất một sản phẩm để trả.' })
      return
    }
    setSubmitting(true)
    try {
      const totalAmount = newReturn.lines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0)

      const { data: returnData, error: retErr } = await supabase
        .from('purchase_returns')
        .insert([{
          supplier_id: newReturn.supplierId,
          warehouse_id: newReturn.warehouseId,
          reason_code: newReturn.reasonCode,
          reason_detail: newReturn.reasonDetail || null,
          refund_method: newReturn.refundMethod,
          total_amount: totalAmount,
          created_by: profile?.id,
          status: 'draft'
        }])
        .select()
        .single()

      if (retErr) throw retErr

      const linesToInsert = newReturn.lines.map(line => ({
        purchase_return_id: returnData.id,
        lot_id: line.lotId,
        product_id: line.productId,
        quantity: line.quantity,
        unit_price: line.unitPrice
      }))

      const { error: linesErr } = await supabase
        .from('purchase_return_lines')
        .insert(linesToInsert)

      if (linesErr) throw linesErr

      setAlertMsg({ type: 'success', text: 'Tạo phiếu trả hàng NCC nháp thành công!' })
      setShowReturnModal(false)
      setNewReturn({ supplierId: '', warehouseId: '', reasonCode: 'other', reasonDetail: '', refundMethod: 'credit_note', lines: [] })
      
      if (activeTab === 'purchase_returns') {
        const { data } = await supabase
          .from('purchase_returns')
          .select(`
            id,
            return_code,
            supplier_id,
            warehouse_id,
            status,
            reason_code,
            reason_detail,
            refund_method,
            total_amount,
            created_by,
            approved_by,
            created_at,
            supplier:suppliers(name),
            warehouse:warehouses(name),
            creator:profiles!created_by(full_name)
          `)
          .order('created_at', { ascending: false })
        setPurchaseReturns(data || [])
      }
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi tạo phiếu trả hàng: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmReturn = async (returnOrder: any) => {
    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('purchase_returns')
        .update({ status: 'completed' })
        .eq('id', returnOrder.id)

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Xác nhận trả hàng và xuất kho thành công!' })
      setShowReturnDetailModal(false)
      
      const { data } = await supabase
        .from('purchase_returns')
        .select(`
          id,
          return_code,
          supplier_id,
          warehouse_id,
          status,
          reason_code,
          reason_detail,
          refund_method,
          total_amount,
          created_by,
          approved_by,
          created_at,
          supplier:suppliers(name),
          warehouse:warehouses(name),
          creator:profiles!created_by(full_name)
        `)
          .order('created_at', { ascending: false })
        setPurchaseReturns(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Xác nhận trả hàng thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelReturn = async (returnOrder: any) => {
    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('purchase_returns')
        .update({ status: 'cancelled' })
        .eq('id', returnOrder.id)

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Đã hủy phiếu trả hàng NCC.' })
      setShowReturnDetailModal(false)
      
      const { data } = await supabase
        .from('purchase_returns')
        .select(`
          id,
          return_code,
          supplier_id,
          warehouse_id,
          status,
          reason_code,
          reason_detail,
          refund_method,
          total_amount,
          created_by,
          approved_by,
          created_at,
          supplier:suppliers(name),
          warehouse:warehouses(name),
          creator:profiles!created_by(full_name)
        `)
          .order('created_at', { ascending: false })
        setPurchaseReturns(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Hủy phiếu trả hàng thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }



  // Fetch reference data (Warehouses)

  useEffect(() => {
    const fetchWarehouses = async () => {
      const { data } = await supabase.from('warehouses').select('id, name')
      if (data) setWarehouses(data)
    }
    fetchWarehouses()
  }, [])

  // Load Tab Specific Data
  useEffect(() => {
    const loadTabData = async () => {
      setLoading(true)
      try {
        if (activeTab === 'lots') {
          // Fetch stock lots
          const { data, error } = await supabase
            .from('stock_lots')
            .select(`
              id,
              lot_number,
              manufacture_date,
              expiry_date,
              cost_price,
              quantity_on_hand,
              status,
              product:products(
                id,
                sku,
                name,
                category:product_categories(name)
              ),
              warehouse:warehouses(id, name),
              supplier:suppliers(id, name)
            `)
            .order('expiry_date', { ascending: true })

          if (error) throw error
          
          const formattedLots = (data || []).map((lot: any) => ({
            id: lot.id,
            lot_number: lot.lot_number,
            manufacture_date: lot.manufacture_date,
            expiry_date: lot.expiry_date,
            cost_price: Number(lot.cost_price),
            quantity_on_hand: lot.quantity_on_hand,
            status: lot.status,
            product: {
              id: lot.product?.id || '',
              sku: lot.product?.sku || '',
              name: lot.product?.name || 'Sản phẩm không rõ',
              category: lot.product?.category ? { name: lot.product.category.name } : null
            },
            warehouse: {
              id: lot.warehouse?.id || '',
              name: lot.warehouse?.name || 'Kho không xác định'
            },
            supplier: lot.supplier ? {
              id: lot.supplier.id,
              name: lot.supplier.name
            } : null
          }))

          setLots(formattedLots)
        } else if (activeTab === 'pos') {
          // Fetch Purchase Orders
          const { data, error } = await supabase
            .from('purchase_orders')
            .select(`
              id,
              po_code,
              status,
              expected_date,
              grand_total,
              created_at,
              supplier:suppliers(name),
              warehouse:warehouses(name)
            `)
            .order('created_at', { ascending: false })

          if (error) throw error
          
          const formattedPOs = (data || []).map((po: any) => ({
            id: po.id,
            po_code: po.po_code,
            status: po.status,
            expected_date: po.expected_date,
            grand_total: Number(po.grand_total),
            created_at: po.created_at,
            supplier: {
              name: po.supplier?.name || 'Nhà cung cấp không xác định'
            },
            warehouse: {
              name: po.warehouse?.name || 'Kho không xác định'
            }
          }))

          setPOs(formattedPOs)
        } else if (activeTab === 'receipts') {
          // Fetch Goods Receipts
          const { data, error } = await supabase
            .from('goods_receipts')
            .select(`
              id,
              receipt_code,
              receipt_date,
              total_amount,
              notes,
              supplier:suppliers(name),
              warehouse:warehouses(name),
              profile:profiles(full_name)
            `)
            .order('receipt_date', { ascending: false })

          if (error) throw error
          
          const formattedReceipts = (data || []).map((gr: any) => ({
            id: gr.id,
            receipt_code: gr.receipt_code,
            receipt_date: gr.receipt_date,
            total_amount: Number(gr.total_amount),
            notes: gr.notes,
            supplier: {
              name: gr.supplier?.name || 'Nhà cung cấp không xác định'
            },
            warehouse: {
              name: gr.warehouse?.name || 'Kho không xác định'
            },
            profile: gr.profile ? {
              full_name: gr.profile.full_name
            } : null
          }))

          setReceipts(formattedReceipts)
        } else if (activeTab === 'settings') {
          // Fetch low stock settings
          const { data: settingsData } = await supabase
            .from('inventory_settings')
            .select(`
              id,
              product_id,
              warehouse_id,
              min_stock_level,
              max_stock_level,
              product:products(sku, name),
              warehouse:warehouses(name)
            `)
          
          const formattedSettings = (settingsData || []).map((set: any) => ({
            id: set.id,
            product_id: set.product_id,
            warehouse_id: set.warehouse_id,
            min_stock_level: set.min_stock_level,
            max_stock_level: set.max_stock_level,
            product: {
              sku: set.product?.sku || '',
              name: set.product?.name || 'Sản phẩm không rõ'
            },
            warehouse: {
              name: set.warehouse?.name || 'Kho không rõ'
            }
          }))
          
          setInvSettings(formattedSettings)

          // Fetch products for list creation
          const { data: prodData } = await supabase.from('products').select('id, name, sku')
          if (prodData) setProductList(prodData)
        } else if (activeTab === 'transfers') {
          const { data, error } = await supabase
            .from('stock_transfers')
            .select(`
              id,
              transfer_code,
              from_warehouse,
              to_warehouse,
              status,
              transfer_date,
              notes,
              created_by,
              received_by,
              from_wh:warehouses!from_warehouse(name),
              to_wh:warehouses!to_warehouse(name),
              creator:profiles!created_by(full_name),
              receiver:profiles!received_by(full_name)
            `)
            .order('transfer_date', { ascending: false })
          if (error) throw error
          setTransfers(data || [])
        } else if (activeTab === 'purchase_returns') {
          const { data, error } = await supabase
            .from('purchase_returns')
            .select(`
              id,
              return_code,
              supplier_id,
              warehouse_id,
              status,
              reason_code,
              reason_detail,
              refund_method,
              total_amount,
              created_by,
              approved_by,
              created_at,
              supplier:suppliers(name),
              warehouse:warehouses(name),
              creator:profiles!created_by(full_name)
            `)
            .order('created_at', { ascending: false })
          if (error) throw error
          setPurchaseReturns(data || [])
        }
      } catch (err: any) {
        console.error('Error fetching inventory tab data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadTabData()
  }, [activeTab])

  // Filtered Stock Lots logic
  const filteredLots = lots.filter(lot => {
    // 1. Search term match
    const searchMatch = 
      lot.product.name.toLowerCase().includes(lotSearchTerm.toLowerCase()) ||
      lot.product.sku.toLowerCase().includes(lotSearchTerm.toLowerCase()) ||
      lot.lot_number.toLowerCase().includes(lotSearchTerm.toLowerCase())

    // 2. Warehouse Filter match
    const whMatch = whFilter === 'all' || lot.warehouse.id === whFilter

    // 3. Quick Badges filter logic
    let quickMatch = true
    if (lotQuickFilter === 'near-expiry') {
      if (!lot.expiry_date) {
        quickMatch = false
      } else {
        const expiryTime = new Date(lot.expiry_date).getTime()
        const nowTime = new Date().getTime()
        const daysToExpiry = (expiryTime - nowTime) / (1000 * 60 * 60 * 24)
        quickMatch = daysToExpiry >= 0 && daysToExpiry <= 30 // expiring in less than 30 days
      }
    } else if (lotQuickFilter === 'low-stock') {
      quickMatch = lot.quantity_on_hand <= 15 // threshold low stock level
    } else if (lotQuickFilter === 'quarantine') {
      quickMatch = lot.status === 'quarantine'
    }

    return searchMatch && whMatch && quickMatch
  })

  // Filtered POs logic
  const filteredPOs = pos.filter(po => {
    return (
      po.po_code.toLowerCase().includes(poSearchTerm.toLowerCase()) ||
      po.supplier.name.toLowerCase().includes(poSearchTerm.toLowerCase())
    )
  })

  // Filtered Receipts logic
  const filteredReceipts = receipts.filter(gr => {
    return (
      gr.receipt_code.toLowerCase().includes(receiptSearchTerm.toLowerCase()) ||
      gr.supplier.name.toLowerCase().includes(receiptSearchTerm.toLowerCase())
    )
  })

  // Create Inventory Setting Submit
  const handleCreateSetting = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSetting.productId || !newSetting.warehouseId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn đầy đủ Sản phẩm và Kho hàng.' })
      return
    }

    try {
      const { error } = await supabase
        .from('inventory_settings')
        .insert([{
          product_id: newSetting.productId,
          warehouse_id: newSetting.warehouseId,
          min_stock_level: Number(newSetting.minStock),
          max_stock_level: Number(newSetting.maxStock)
        }])

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Thêm định mức tồn kho thành công!' })
      setIsEditingSetting(false)
      // Reload settings tab
      const { data: settingsData } = await supabase
        .from('inventory_settings')
        .select(`
          id,
          product_id,
          warehouse_id,
          min_stock_level,
          max_stock_level,
          product:products(sku, name),
          warehouse:warehouses(name)
        `)
      
      const formatted = (settingsData || []).map((set: any) => ({
        id: set.id,
        product_id: set.product_id,
        warehouse_id: set.warehouse_id,
        min_stock_level: set.min_stock_level,
        max_stock_level: set.max_stock_level,
        product: {
          sku: set.product?.sku || '',
          name: set.product?.name || 'Sản phẩm không rõ'
        },
        warehouse: {
          name: set.warehouse?.name || 'Kho không rõ'
        }
      }))
      setInvSettings(formatted)

    } catch (err: any) {
      console.error('Error saving inventory setting:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi thiết lập định mức: ' + err.message })
    }
  }

  // Auto-clear alert
  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [alertMsg])

  return (
    <Layout activeMenu="Kho hàng">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6">
        
        {/* Alerts toast */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-headline-lg font-bold text-gray-800">Quản lý Kho & Giao dịch Kho</h1>
            <p className="text-body-md text-gray-500">Giám sát tồn kho thực tế, lô hạn dùng (FEFO) và luồng cung ứng nhập hàng</p>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/purchase-orders/new')}
              className="bg-white text-gray-600 border border-gray-100 px-4 py-2.5 rounded-lg font-semibold text-body-md hover:bg-gray-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus size={16} />
              <span>Tạo đơn PO</span>
            </button>
            <button
              onClick={() => navigate('/goods-receipts/new')}
              className="bg-blue-500 text-white px-4 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
            >
              <WarehouseIcon size={16} />
              <span>Nhập kho thực tế</span>
            </button>
          </div>
        </div>

        {/* Tab Selection Headers */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-100 px-6 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('lots')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'lots'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Layers size={16} />
              <span>Tồn kho theo lô</span>
            </button>
            
            <button
              onClick={() => setActiveTab('pos')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'pos'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <FileText size={16} />
              <span>Đơn mua hàng (PO)</span>
            </button>

            <button
              onClick={() => setActiveTab('receipts')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'receipts'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <WarehouseIcon size={16} />
              <span>Phiếu nhập kho</span>
            </button>

            <button
              onClick={() => setActiveTab('transfers')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'transfers'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <ArrowRightLeft size={16} />
              <span>Chuyển kho</span>
            </button>

            <button
              onClick={() => setActiveTab('purchase_returns')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'purchase_returns'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <RotateCcw size={16} />
              <span>Trả hàng NCC</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Settings size={16} />
              <span>Định mức an toàn</span>
            </button>
          </div>

          {/* TAB CONTENT: STOCK LOTS */}
          {activeTab === 'lots' && (
            <div className="p-6 space-y-6">
              {/* Search & Filters */}
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="text"
                    placeholder="Tìm SKU, tên sản phẩm, số lô..."
                    value={lotSearchTerm}
                    onChange={(e) => setLotSearchTerm(e.target.value)}
                    className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  {/* Warehouse Filter */}
                  <select
                    value={whFilter}
                    onChange={(e) => setWhFilter(e.target.value)}
                    className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
                  >
                    <option value="all">Tất cả kho</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>

                  {/* Quick Filters Badges */}
                  <button
                    onClick={() => setLotQuickFilter('all')}
                    className={`px-4 h-10 rounded-lg text-body-md font-semibold border transition-all ${
                      lotQuickFilter === 'all'
                        ? 'bg-blue-50 text-blue-700 border-blue-100'
                        : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    Tất cả lô
                  </button>
                  <button
                    onClick={() => setLotQuickFilter('near-expiry')}
                    className={`px-4 h-10 rounded-lg text-body-md font-semibold border transition-all flex items-center gap-1.5 ${
                      lotQuickFilter === 'near-expiry'
                        ? 'bg-amber-50 text-amber-700 border-amber-100'
                        : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <Clock size={14} />
                    <span>Cận hạn (&lt; 30 ngày)</span>
                  </button>
                  <button
                    onClick={() => setLotQuickFilter('low-stock')}
                    className={`px-4 h-10 rounded-lg text-body-md font-semibold border transition-all flex items-center gap-1.5 ${
                      lotQuickFilter === 'low-stock'
                        ? 'bg-red-50 text-red-700 border-red-100'
                        : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <ShieldAlert size={14} />
                    <span>Tồn kho thấp</span>
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    <span>Đang tải danh sách tồn lô...</span>
                  </div>
                ) : filteredLots.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 space-y-2">
                    <Layers className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="font-semibold text-body-lg">Không tìm thấy lô hàng nào</p>
                    <p className="text-body-md">Vui lòng điều chỉnh điều kiện lọc hoặc nhập kho thêm.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Sản phẩm / SKU</th>
                        <th className="px-6 py-4">Kho</th>
                        <th className="px-6 py-4">Số lô</th>
                        <th className="px-6 py-4 text-center">Hạn sử dụng (HSD)</th>
                        <th className="px-6 py-4 text-right">Giá vốn lô (₫)</th>
                        <th className="px-6 py-4 text-center">Tồn kho khả dụng</th>
                        <th className="px-6 py-4 text-center">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {filteredLots.map((lot) => {
                        const isExpired = lot.expiry_date && new Date(lot.expiry_date).getTime() < new Date().getTime()
                        const isNearExpiry = lot.expiry_date && !isExpired && 
                          (new Date(lot.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) <= 30

                        return (
                          <tr key={lot.id} className="hover:bg-gray-25/50 transition-colors">
                            <td className="px-6 py-4">
                              <div>
                                <p className="font-bold text-gray-800">{lot.product.name}</p>
                                <span className="text-gray-400 font-mono text-tiny">SKU: {lot.product.sku}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 font-semibold text-gray-700">{lot.warehouse.name}</td>
                            <td className="px-6 py-4 font-mono font-bold text-blue-500">{lot.lot_number}</td>
                            <td className="px-6 py-4 text-center font-medium">
                              {lot.expiry_date ? (
                                <div className="space-y-0.5">
                                  <span>{new Date(lot.expiry_date).toLocaleDateString('vi-VN')}</span>
                                  {isExpired && (
                                    <span className="block text-[10px] text-red-500 font-bold uppercase font-mono">Hết hạn</span>
                                  )}
                                  {isNearExpiry && (
                                    <span className="block text-[10px] text-amber-500 font-bold uppercase font-mono">Cận date</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-300">Không quản lý HSD</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right font-semibold text-gray-700">
                              {lot.cost_price.toLocaleString('vi-VN')} ₫
                            </td>
                            <td className="px-6 py-4 text-center font-bold text-gray-850">
                              {lot.quantity_on_hand}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className={`px-2.5 py-0.5 rounded text-tiny font-bold uppercase ${
                                lot.status === 'active' 
                                  ? 'bg-emerald-50 text-emerald-700' 
                                  : lot.status === 'quarantine' 
                                  ? 'bg-amber-50 text-amber-700' 
                                  : 'bg-red-50 text-red-750'
                              }`}>
                                {lot.status === 'active' ? 'Sẵn dùng' : lot.status === 'quarantine' ? 'Kiểm dịch' : 'Khóa'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: PURCHASE ORDERS */}
          {activeTab === 'pos' && (
            <div className="p-6 space-y-6">
              {/* Search input */}
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm mã PO, nhà cung cấp..."
                  value={poSearchTerm}
                  onChange={(e) => setPoSearchTerm(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    <span>Đang tải danh sách PO...</span>
                  </div>
                ) : filteredPOs.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 space-y-2">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="font-semibold text-body-lg">Không tìm thấy đơn hàng nào</p>
                    <p className="text-body-md">Hãy click Tạo đơn PO ở góc phải để tạo giao dịch đặt hàng mới.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Mã đơn PO</th>
                        <th className="px-6 py-4">Nhà cung cấp</th>
                        <th className="px-6 py-4">Kho đích dự kiến</th>
                        <th className="px-6 py-4 text-center">Dự kiến giao</th>
                        <th className="px-6 py-4 text-right">Tổng giá trị</th>
                        <th className="px-6 py-4 text-center">Trạng thái</th>
                        <th className="px-6 py-4 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {filteredPOs.map((po) => (
                        <tr key={po.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-blue-500">{po.po_code}</td>
                          <td className="px-6 py-4 font-semibold text-gray-800">{po.supplier.name}</td>
                          <td className="px-6 py-4 text-gray-500">{po.warehouse.name}</td>
                          <td className="px-6 py-4 text-center text-gray-500">
                            {po.expected_date ? new Date(po.expected_date).toLocaleDateString('vi-VN') : '---'}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-gray-700">
                            {po.grand_total.toLocaleString('vi-VN')} ₫
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase ${
                              po.status === 'received' 
                                ? 'bg-emerald-50 text-emerald-700' 
                                : po.status === 'partially_received' 
                                ? 'bg-amber-50 text-amber-700' 
                                : po.status === 'sent' 
                                ? 'bg-blue-50 text-blue-700' 
                                : 'bg-gray-100 text-gray-500'
                            }`}>
                              {po.status === 'draft' ? 'Nháp' :
                               po.status === 'sent' ? 'Chờ nhận' :
                               po.status === 'partially_received' ? 'Nhập một phần' : 'Đã nhận đủ'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {(po.status === 'sent' || po.status === 'partially_received') && (
                              <button
                                onClick={() => navigate(`/goods-receipts/new?po_id=${po.id}`)}
                                className="text-blue-500 hover:text-blue-600 font-bold hover:underline whitespace-nowrap text-body-md"
                              >
                                Nhập kho
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: GOODS RECEIPTS */}
          {activeTab === 'receipts' && (
            <div className="p-6 space-y-6">
              {/* Search input */}
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Tìm mã phiếu nhập, nhà cung cấp..."
                  value={receiptSearchTerm}
                  onChange={(e) => setReceiptSearchTerm(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    <span>Đang tải danh sách phiếu nhập kho...</span>
                  </div>
                ) : filteredReceipts.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 space-y-2">
                    <WarehouseIcon className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="font-semibold text-body-lg">Không tìm thấy phiếu nhập kho nào</p>
                    <p className="text-body-md">Hãy click Nhập kho thực tế ở góc phải để tạo phiếu nhập mới.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Mã phiếu nhập</th>
                        <th className="px-6 py-4">Nhà cung cấp</th>
                        <th className="px-6 py-4">Kho nhận</th>
                        <th className="px-6 py-4 text-center">Ngày nhận</th>
                        <th className="px-6 py-4">Người nhận</th>
                        <th className="px-6 py-4 text-right">Tổng giá trị</th>
                        <th className="px-6 py-4">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {filteredReceipts.map((gr) => (
                        <tr key={gr.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-blue-500">{gr.receipt_code}</td>
                          <td className="px-6 py-4 font-semibold text-gray-800">{gr.supplier.name}</td>
                          <td className="px-6 py-4 text-gray-500">{gr.warehouse.name}</td>
                          <td className="px-6 py-4 text-center text-gray-500">
                            {new Date(gr.receipt_date).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700">
                            {gr.profile?.full_name || 'Hệ thống'}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-gray-750">
                            {gr.total_amount.toLocaleString('vi-VN')} ₫
                          </td>
                          <td className="px-6 py-4 text-gray-400 italic text-tiny max-w-[200px] truncate" title={gr.notes || ''}>
                            {gr.notes || '---'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: STOCK TRANSFERS */}
          {activeTab === 'transfers' && (
            <div className="p-6 space-y-6">
              {/* Header inside Tab */}
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="text"
                    placeholder="Tìm mã chuyển kho, tên kho..."
                    value={transferSearchTerm}
                    onChange={(e) => setTransferSearchTerm(e.target.value)}
                    className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={() => setShowTransferModal(true)}
                  className="bg-blue-505 bg-blue-500 text-white px-4 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all w-full md:w-auto"
                >
                  <ArrowRightLeft size={16} />
                  <span>Tạo yêu cầu chuyển kho</span>
                </button>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    <span>Đang tải danh sách chuyển kho...</span>
                  </div>
                ) : filteredTransfers.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 space-y-2">
                    <ArrowRightLeft className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="font-semibold text-body-lg">Không tìm thấy phiếu chuyển kho nào</p>
                    <p className="text-body-md">Hãy click Tạo yêu cầu chuyển kho để bắt đầu.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Mã yêu cầu</th>
                        <th className="px-6 py-4">Kho nguồn</th>
                        <th className="px-6 py-4">Kho đích</th>
                        <th className="px-6 py-4 text-center">Ngày chuyển</th>
                        <th className="px-6 py-4">Người tạo</th>
                        <th className="px-6 py-4 text-center">Trạng thái</th>
                        <th className="px-6 py-4 w-20 text-center">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {filteredTransfers.map((t) => (
                        <tr key={t.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-blue-500">{t.transfer_code}</td>
                          <td className="px-6 py-4 font-semibold text-gray-800">{t.from_wh?.name || 'Kho nguồn'}</td>
                          <td className="px-6 py-4 font-semibold text-gray-800">{t.to_wh?.name || 'Kho đích'}</td>
                          <td className="px-6 py-4 text-center text-gray-500">
                            {new Date(t.transfer_date).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700">{t.creator?.full_name || 'Hệ thống'}</td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2.5 py-0.5 rounded text-tiny font-bold uppercase ${
                              t.status === 'received' 
                                ? 'bg-emerald-50 text-emerald-700' 
                                : t.status === 'in_transit' 
                                ? 'bg-amber-50 text-amber-700' 
                                : t.status === 'draft' 
                                ? 'bg-blue-50 text-blue-700' 
                                : 'bg-gray-100 text-gray-500'
                            }`}>
                              {t.status === 'draft' ? 'Nháp' :
                               t.status === 'in_transit' ? 'Đang chuyển' :
                               t.status === 'received' ? 'Đã nhận' : 'Đã hủy'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={async () => {
                                setSelectedTransfer(t)
                                await fetchTransferDetails(t.id)
                                setShowTransferDetailModal(true)
                              }}
                              className="text-blue-500 hover:text-blue-600 font-bold hover:underline"
                            >
                              Chi tiết
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: PURCHASE RETURNS */}
          {activeTab === 'purchase_returns' && (
            <div className="p-6 space-y-6">
              {/* Header inside Tab */}
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="text"
                    placeholder="Tìm mã phiếu trả, nhà cung cấp..."
                    value={returnSearchTerm}
                    onChange={(e) => setReturnSearchTerm(e.target.value)}
                    className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={() => setShowReturnModal(true)}
                  className="bg-blue-500 text-white px-4 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all w-full md:w-auto"
                >
                  <RotateCcw size={16} />
                  <span>Tạo phiếu trả hàng NCC</span>
                </button>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-3 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    <span>Đang tải danh sách trả hàng...</span>
                  </div>
                ) : filteredReturns.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 space-y-2">
                    <RotateCcw className="w-12 h-12 text-gray-300 mx-auto" />
                    <p className="font-semibold text-body-lg">Không tìm thấy phiếu trả hàng nào</p>
                    <p className="text-body-md">Hãy click Tạo phiếu trả hàng NCC để bắt đầu.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Mã phiếu</th>
                        <th className="px-6 py-4">Nhà cung cấp</th>
                        <th className="px-6 py-4">Kho trả hàng</th>
                        <th className="px-6 py-4 text-center">Hoàn tiền</th>
                        <th className="px-6 py-4 text-right">Tổng giá trị</th>
                        <th className="px-6 py-4 text-center">Trạng thái</th>
                        <th className="px-6 py-4 w-20 text-center">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {filteredReturns.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-blue-500">{r.return_code}</td>
                          <td className="px-6 py-4 font-semibold text-gray-800">{r.supplier?.name || 'Nhà cung cấp'}</td>
                          <td className="px-6 py-4 text-gray-500">{r.warehouse?.name || 'Kho xuất'}</td>
                          <td className="px-6 py-4 text-center font-medium capitalize text-gray-700">
                            {r.refund_method === 'cash_refund' ? 'Tiền mặt' : r.refund_method === 'credit_note' ? 'Trừ công nợ' : 'Cấn trừ PO'}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-gray-700">
                            {Number(r.total_amount || 0).toLocaleString('vi-VN')} ₫
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2.5 py-0.5 rounded text-tiny font-bold uppercase ${
                              r.status === 'completed' 
                                ? 'bg-emerald-50 text-emerald-700' 
                                : r.status === 'confirmed'
                                ? 'bg-blue-50 text-blue-700'
                                : r.status === 'draft' 
                                ? 'bg-gray-100 text-gray-500' 
                                : 'bg-red-50 text-red-750'
                            }`}>
                              {r.status === 'draft' ? 'Nháp' :
                               r.status === 'confirmed' ? 'Đã duyệt' :
                               r.status === 'completed' ? 'Hoàn tất' : 'Đã hủy'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={async () => {
                                setSelectedReturn(r)
                                await fetchReturnDetails(r.id)
                                setShowReturnDetailModal(true)
                              }}
                              className="text-blue-500 hover:text-blue-600 font-bold hover:underline"
                            >
                              Chi tiết
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: INVENTORY SETTINGS / ALERTS */}
          {activeTab === 'settings' && (
            <div className="p-6 space-y-6">
              {/* Header inside Tab */}
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-700">Định mức an toàn tồn kho</h4>
                  <p className="text-tiny text-gray-400">Quy định lượng hàng tồn kho tối thiểu (Safety Stock) để cảnh báo khi hết hàng</p>
                </div>
                <button
                  onClick={() => setIsEditingSetting(true)}
                  className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-semibold text-body-md hover:bg-blue-100 flex items-center gap-2 transition-colors"
                >
                  <Plus size={16} />
                  <span>Cài đặt định mức</span>
                </button>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                {invSettings.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 border border-dashed border-gray-150 rounded-xl">
                    <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-2" />
                    <p className="font-semibold text-body-lg">Chưa cấu hình định mức an toàn nào</p>
                    <p className="text-body-md">Sử dụng nút Cài đặt định mức để bắt đầu thiết lập hạn mức cảnh báo.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                        <th className="px-6 py-4">Sản phẩm / SKU</th>
                        <th className="px-6 py-4">Kho áp dụng</th>
                        <th className="px-6 py-4 text-center">Tồn kho tối thiểu</th>
                        <th className="px-6 py-4 text-center">Tồn kho tối đa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {invSettings.map((set) => (
                        <tr key={set.id} className="hover:bg-gray-25/50 transition-colors">
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-bold text-gray-800">{set.product.name}</p>
                              <span className="text-gray-400 font-mono text-tiny">SKU: {set.product.sku}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-semibold text-gray-700">{set.warehouse.name}</td>
                          <td className="px-6 py-4 text-center font-bold text-red-500">{set.min_stock_level}</td>
                          <td className="px-6 py-4 text-center font-bold text-gray-700">
                            {set.max_stock_level || '---'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Drawer Cài đặt định mức tồn kho */}
      {isEditingSetting && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Cấu hình định mức tồn kho</h3>
                <p className="text-tiny text-gray-400">Thiết lập ngưỡng cảnh báo an toàn cho sản phẩm</p>
              </div>
              <button
                onClick={() => setIsEditingSetting(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateSetting} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Chọn sản phẩm</label>
                <select
                  value={newSetting.productId}
                  onChange={(e) => setNewSetting({ ...newSetting, productId: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                >
                  <option value="">-- Chọn sản phẩm --</option>
                  {productList.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Chọn kho hàng</label>
                <select
                  value={newSetting.warehouseId}
                  onChange={(e) => setNewSetting({ ...newSetting, warehouseId: e.target.value })}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                >
                  <option value="">-- Chọn kho hàng --</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tồn tối thiểu (Min)</label>
                  <input
                    type="number"
                    min="0"
                    value={newSetting.minStock}
                    onChange={(e) => setNewSetting({ ...newSetting, minStock: parseInt(e.target.value) || 0 })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tồn tối đa (Max)</label>
                  <input
                    type="number"
                    min="0"
                    value={newSetting.maxStock}
                    onChange={(e) => setNewSetting({ ...newSetting, maxStock: parseInt(e.target.value) || 0 })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsEditingSetting(false)}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center"
                >
                  Lưu định mức
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tạo yêu cầu chuyển kho */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-xl">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Tạo yêu cầu chuyển kho</h3>
                <p className="text-tiny text-gray-400">Luân chuyển hàng hóa giữa các kho/chi nhánh</p>
              </div>
              <button
                onClick={() => setShowTransferModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Content */}
            <form onSubmit={handleCreateTransfer} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Warehouse Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Kho nguồn <span className="text-red-500">*</span></label>
                  <select
                    value={newTransfer.fromWarehouse}
                    onChange={(e) => {
                      setNewTransfer({
                        ...newTransfer,
                        fromWarehouse: e.target.value,
                        lines: [] // Reset lines when changing warehouse
                      })
                      setModalLotId('')
                    }}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="">-- Chọn kho nguồn --</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Kho đích <span className="text-red-500">*</span></label>
                  <select
                    value={newTransfer.toWarehouse}
                    onChange={(e) => setNewTransfer({ ...newTransfer, toWarehouse: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="">-- Chọn kho đích --</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Add item to transfer */}
              {newTransfer.fromWarehouse && (
                <div className="bg-gray-25 border border-gray-100 rounded-lg p-4 space-y-4">
                  <h4 className="text-body-md font-bold text-gray-700">Thêm sản phẩm từ kho nguồn</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="block text-tiny font-semibold text-gray-600">Chọn lô hàng</label>
                      <select
                        value={modalLotId}
                        onChange={(e) => setModalLotId(e.target.value)}
                        className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="">-- Chọn lô hàng còn tồn --</option>
                        {lotsForWarehouse.map(l => {
                          const avail = l.quantity_on_hand - l.quantity_reserved;
                          const isAlreadyAdded = newTransfer.lines.some(line => line.lotId === l.id);
                          return (
                            <option key={l.id} value={l.id} disabled={avail <= 0 || isAlreadyAdded}>
                              {l.product_id ? `${l.name} - Lô: ${l.lot_number} (Tồn: ${avail})` : `Lô: ${l.lot_number} (Tồn: ${avail})`}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-tiny font-semibold text-gray-600">Số lượng chuyển</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="1"
                          value={modalQty}
                          onChange={(e) => setModalQty(Math.max(1, parseInt(e.target.value) || 0))}
                          className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!modalLotId) return;
                            const lot = lotsForWarehouse.find(l => l.id === modalLotId);
                            if (!lot) return;
                            const avail = lot.quantity_on_hand - lot.quantity_reserved;
                            if (modalQty > avail) {
                              setAlertMsg({ type: 'error', text: `Số lượng chuyển (${modalQty}) vượt quá tồn khả dụng (${avail})` });
                              return;
                            }
                            // Add to list
                            const newLine = {
                              lotId: lot.id,
                              productId: lot.product_id,
                              quantity: modalQty,
                              maxQty: avail,
                              name: lot.name,
                              sku: lot.sku,
                              lotNumber: lot.lot_number
                            };
                            setNewTransfer({
                              ...newTransfer,
                              lines: [...newTransfer.lines, newLine]
                            });
                            // Reset inputs
                            setModalLotId('');
                            setModalQty(1);
                          }}
                          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 rounded-lg text-body-md transition-colors"
                        >
                          Thêm
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Added Lines Table */}
              <div className="space-y-2">
                <h4 className="text-body-md font-bold text-gray-700">Danh sách sản phẩm chuyển ({newTransfer.lines.length})</h4>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-500 font-bold text-tiny uppercase">
                        <th className="px-4 py-2">Sản phẩm / SKU</th>
                        <th className="px-4 py-2">Số lô</th>
                        <th className="px-4 py-2 text-center">Số lượng</th>
                        <th className="px-4 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {newTransfer.lines.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-gray-400 italic">Chưa chọn sản phẩm nào. Vui lòng thêm từ form ở trên.</td>
                        </tr>
                      ) : (
                        newTransfer.lines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-gray-25/30">
                            <td className="px-4 py-2.5">
                              <p className="font-bold text-gray-700">{line.name}</p>
                              <span className="text-tiny text-gray-455 font-mono">SKU: {line.sku}</span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-blue-500 font-semibold">{line.lotNumber}</td>
                            <td className="px-4 py-2.5 text-center font-bold text-gray-800">{line.quantity}</td>
                            <td className="px-4 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = newTransfer.lines.filter((_, i) => i !== idx);
                                  setNewTransfer({ ...newTransfer, lines: updated });
                                }}
                                className="text-red-500 hover:text-red-650 p-1 rounded hover:bg-red-50"
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

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Ghi chú</label>
                <textarea
                  value={newTransfer.notes}
                  onChange={(e) => setNewTransfer({ ...newTransfer, notes: e.target.value })}
                  placeholder="Lý do chuyển, tài xế vận chuyển, v.v..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowTransferModal(false);
                    setNewTransfer({ fromWarehouse: '', toWarehouse: '', notes: '', lines: [] });
                  }}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center disabled:opacity-50"
                >
                  {submitting ? 'Đang tạo...' : 'Tạo phiếu chuyển kho'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Chi tiết chuyển kho */}
      {showTransferDetailModal && selectedTransfer && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-xl">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Chi tiết yêu cầu chuyển kho</h3>
                <p className="text-mono text-tiny text-blue-500 font-bold">{selectedTransfer.transfer_code}</p>
              </div>
              <button
                onClick={() => setShowTransferDetailModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Metadata details */}
              <div className="grid grid-cols-2 gap-y-4 gap-x-6 bg-gray-25/55 border border-gray-100 rounded-lg p-4 text-body-md text-gray-600">
                <div>
                  <span className="text-gray-400 block text-tiny">Kho nguồn</span>
                  <span className="font-semibold text-gray-800">{selectedTransfer.from_wh?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Kho đích</span>
                  <span className="font-semibold text-gray-800">{selectedTransfer.to_wh?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Ngày tạo</span>
                  <span className="font-medium">{new Date(selectedTransfer.transfer_date).toLocaleDateString('vi-VN')}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Trạng thái</span>
                  <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase ${
                    selectedTransfer.status === 'received' 
                      ? 'bg-emerald-50 text-emerald-700' 
                      : selectedTransfer.status === 'in_transit' 
                      ? 'bg-amber-50 text-amber-700' 
                      : selectedTransfer.status === 'draft' 
                      ? 'bg-blue-50 text-blue-700' 
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {selectedTransfer.status === 'draft' ? 'Nháp' :
                     selectedTransfer.status === 'in_transit' ? 'Đang chuyển' :
                     selectedTransfer.status === 'received' ? 'Đã nhận' : 'Đã hủy'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Người lập phiếu</span>
                  <span className="font-medium text-gray-700">{selectedTransfer.creator?.full_name || 'Hệ thống'}</span>
                </div>
                {selectedTransfer.received_by && (
                  <div>
                    <span className="text-gray-400 block text-tiny">Người nhận hàng</span>
                    <span className="font-medium text-gray-700">{selectedTransfer.receiver?.full_name || 'Hệ thống'}</span>
                  </div>
                )}
                <div className="col-span-2 border-t border-gray-100/50 pt-2">
                  <span className="text-gray-400 block text-tiny">Ghi chú</span>
                  <span className="text-gray-700 italic">{selectedTransfer.notes || 'Không có ghi chú'}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h4 className="text-body-md font-bold text-gray-750">Sản phẩm luân chuyển</h4>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase">
                        <th className="px-4 py-3">Sản phẩm / SKU</th>
                        <th className="px-4 py-3">Số lô</th>
                        <th className="px-4 py-3 text-center">Hạn sử dụng</th>
                        <th className="px-4 py-3 text-center">Số lượng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {selectedTransferLines.map((line) => (
                        <tr key={line.id} className="hover:bg-gray-25/30">
                          <td className="px-4 py-3">
                            <p className="font-bold text-gray-700">{line.product?.name}</p>
                            <span className="text-tiny text-gray-400 font-mono">SKU: {line.product?.sku}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-blue-500 font-semibold">{line.lot?.lot_number || 'N/A'}</td>
                          <td className="px-4 py-3 text-center text-gray-500">
                            {line.lot?.expiry_date ? new Date(line.lot.expiry_date).toLocaleDateString('vi-VN') : '---'}
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-gray-800">
                            {line.quantity} {line.product?.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Transition actions */}
              <div className="flex gap-4 pt-4 border-t border-gray-100">
                <button
                  onClick={() => setShowTransferDetailModal(false)}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Đóng
                </button>

                {selectedTransfer.status === 'draft' && (
                  <>
                    <button
                      onClick={() => handleCancelTransfer(selectedTransfer, selectedTransferLines)}
                      disabled={submitting}
                      className="bg-red-50 text-red-650 hover:bg-red-100 h-10 px-4 rounded-lg text-body-md font-semibold transition-colors disabled:opacity-50"
                    >
                      Hủy yêu cầu
                    </button>
                    <button
                      onClick={() => handleStartTransfer(selectedTransfer, selectedTransferLines)}
                      disabled={submitting}
                      className="flex-1 bg-blue-500 hover:bg-blue-600 text-white h-10 rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <ArrowRightLeft size={16} />
                      <span>Bắt đầu chuyển</span>
                    </button>
                  </>
                )}

                {selectedTransfer.status === 'in_transit' && (
                  <>
                    <button
                      onClick={() => handleCancelTransfer(selectedTransfer, selectedTransferLines)}
                      disabled={submitting}
                      className="bg-red-50 text-red-650 hover:bg-red-100 h-10 px-4 rounded-lg text-body-md font-semibold transition-colors disabled:opacity-50"
                    >
                      Hủy yêu cầu
                    </button>
                    <button
                      onClick={() => handleReceiveTransfer(selectedTransfer, selectedTransferLines)}
                      disabled={submitting}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white h-10 rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} />
                      <span>Xác nhận nhận hàng</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tạo phiếu trả hàng NCC */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-xl">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Tạo phiếu xuất trả nhà cung cấp</h3>
                <p className="text-tiny text-gray-400">Trả hàng cận date, lỗi hỏng hoặc do thu hồi của nhà cung cấp</p>
              </div>
              <button
                onClick={() => setShowReturnModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Content */}
            <form onSubmit={handleCreateReturn} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Partner and Warehouse */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Nhà cung cấp <span className="text-red-500">*</span></label>
                  <select
                    value={newReturn.supplierId}
                    onChange={(e) => setNewReturn({ ...newReturn, supplierId: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="">-- Chọn nhà cung cấp --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Kho xuất trả <span className="text-red-500">*</span></label>
                  <select
                    value={newReturn.warehouseId}
                    onChange={(e) => {
                      setNewReturn({
                        ...newReturn,
                        warehouseId: e.target.value,
                        lines: [] // Reset lines when changing warehouse
                      })
                      setModalLotId('')
                    }}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="">-- Chọn kho xuất trả --</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Reason and Refund Method */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Lý do trả hàng <span className="text-red-500">*</span></label>
                  <select
                    value={newReturn.reasonCode}
                    onChange={(e) => setNewReturn({ ...newReturn, reasonCode: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="damage">Hàng hỏng / Lỗi</option>
                    <option value="wrong_product">Sai sản phẩm</option>
                    <option value="near_expiry">Cận / Hết hạn sử dụng</option>
                    <option value="quality_fail">Lỗi chất lượng</option>
                    <option value="recall">Nhà sản xuất thu hồi</option>
                    <option value="other">Lý do khác</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Hoàn tiền <span className="text-red-500">*</span></label>
                  <select
                    value={newReturn.refundMethod}
                    onChange={(e) => setNewReturn({ ...newReturn, refundMethod: e.target.value })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    required
                  >
                    <option value="cash_refund">Nhận tiền mặt</option>
                    <option value="credit_note">Cấn trừ công nợ</option>
                    <option value="next_po_offset">Trừ đơn hàng sau</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Chi tiết lý do</label>
                  <input
                    type="text"
                    value={newReturn.reasonDetail}
                    onChange={(e) => setNewReturn({ ...newReturn, reasonDetail: e.target.value })}
                    placeholder="Ghi chú chi tiết..."
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Add item to return */}
              {newReturn.warehouseId && (
                <div className="bg-gray-25 border border-gray-100 rounded-lg p-4 space-y-4">
                  <h4 className="text-body-md font-bold text-gray-700">Thêm sản phẩm xuất trả</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="block text-tiny font-semibold text-gray-600">Chọn lô hàng trong kho</label>
                      <select
                        value={modalLotId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setModalLotId(val);
                          const lot = lotsForWarehouse.find(l => l.id === val);
                          if (lot) setModalUnitPrice(lot.cost_price);
                        }}
                        className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="">-- Chọn lô hàng còn tồn --</option>
                        {lotsForWarehouse.map(l => {
                          const avail = l.quantity_on_hand - l.quantity_reserved;
                          const isAlreadyAdded = newReturn.lines.some(line => line.lotId === l.id);
                          return (
                            <option key={l.id} value={l.id} disabled={avail <= 0 || isAlreadyAdded}>
                              {l.product_id ? `${l.name} - Lô: ${l.lot_number} (Tồn: ${avail}, Giá: ${l.cost_price.toLocaleString()}₫)` : `Lô: ${l.lot_number} (Tồn: ${avail})`}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-tiny font-semibold text-gray-600">Số lượng trả</label>
                      <input
                        type="number"
                        min="1"
                        value={modalQty}
                        onChange={(e) => setModalQty(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-tiny font-semibold text-gray-600">Đơn giá trả (₫)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="0"
                          value={modalUnitPrice}
                          onChange={(e) => setModalUnitPrice(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!modalLotId) return;
                            const lot = lotsForWarehouse.find(l => l.id === modalLotId);
                            if (!lot) return;
                            const avail = lot.quantity_on_hand - lot.quantity_reserved;
                            if (modalQty > avail) {
                              setAlertMsg({ type: 'error', text: `Số lượng trả (${modalQty}) vượt quá tồn khả dụng (${avail})` });
                              return;
                            }
                            // Add to list
                            const newLine = {
                              lotId: lot.id,
                              productId: lot.product_id,
                              quantity: modalQty,
                              maxQty: avail,
                              unitPrice: modalUnitPrice,
                              name: lot.name,
                              sku: lot.sku,
                              lotNumber: lot.lot_number
                            };
                            setNewReturn({
                              ...newReturn,
                              lines: [...newReturn.lines, newLine]
                            });
                            // Reset inputs
                            setModalLotId('');
                            setModalQty(1);
                            setModalUnitPrice(0);
                          }}
                          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 rounded-lg text-body-md transition-colors"
                        >
                          Thêm
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Added Lines Table */}
              <div className="space-y-2">
                <h4 className="text-body-md font-bold text-gray-700">Danh sách sản phẩm xuất trả ({newReturn.lines.length})</h4>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-500 font-bold text-tiny uppercase">
                        <th className="px-4 py-2">Sản phẩm / SKU</th>
                        <th className="px-4 py-2">Số lô</th>
                        <th className="px-4 py-2 text-center">Số lượng</th>
                        <th className="px-4 py-2 text-right">Đơn giá trả</th>
                        <th className="px-4 py-2 text-right">Thành tiền</th>
                        <th className="px-4 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {newReturn.lines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-gray-400 italic">Chưa chọn sản phẩm nào. Vui lòng thêm từ form ở trên.</td>
                        </tr>
                      ) : (
                        newReturn.lines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-gray-25/30">
                            <td className="px-4 py-2.5">
                              <p className="font-bold text-gray-700">{line.name}</p>
                              <span className="text-tiny text-gray-450 font-mono">SKU: {line.sku}</span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-blue-500 font-semibold">{line.lotNumber}</td>
                            <td className="px-4 py-2.5 text-center font-bold text-gray-800">{line.quantity}</td>
                            <td className="px-4 py-2.5 text-right text-gray-700">{line.unitPrice.toLocaleString('vi-VN')} ₫</td>
                            <td className="px-4 py-2.5 text-right font-bold text-gray-800">
                              {(line.quantity * line.unitPrice).toLocaleString('vi-VN')} ₫
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = newReturn.lines.filter((_, i) => i !== idx);
                                  setNewReturn({ ...newReturn, lines: updated });
                                }}
                                className="text-red-500 hover:text-red-650 p-1 rounded hover:bg-red-50"
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

                {newReturn.lines.length > 0 && (
                  <div className="flex justify-end p-2">
                    <span className="text-body-md text-gray-500">Tổng tiền hoàn trả: <strong className="text-body-lg text-gray-800">
                      {newReturn.lines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0).toLocaleString('vi-VN')} ₫
                    </strong></span>
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowReturnModal(false);
                    setNewReturn({ supplierId: '', warehouseId: '', reasonCode: 'other', reasonDetail: '', refundMethod: 'credit_note', lines: [] });
                  }}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center disabled:opacity-50"
                >
                  {submitting ? 'Đang tạo...' : 'Tạo phiếu trả nháp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Chi tiết trả hàng NCC */}
      {showReturnDetailModal && selectedReturn && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-xl">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Chi tiết phiếu xuất trả NCC</h3>
                <p className="text-mono text-tiny text-blue-500 font-bold">{selectedReturn.return_code}</p>
              </div>
              <button
                onClick={() => setShowReturnDetailModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Metadata details */}
              <div className="grid grid-cols-2 gap-y-4 gap-x-6 bg-gray-25/55 border border-gray-100 rounded-lg p-4 text-body-md text-gray-600">
                <div>
                  <span className="text-gray-400 block text-tiny">Nhà cung cấp</span>
                  <span className="font-semibold text-gray-800">{selectedReturn.supplier?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Kho xuất hàng</span>
                  <span className="font-semibold text-gray-800">{selectedReturn.warehouse?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Ngày lập</span>
                  <span className="font-medium">{new Date(selectedReturn.created_at).toLocaleString('vi-VN')}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Trạng thái</span>
                  <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase ${
                    selectedReturn.status === 'completed' 
                      ? 'bg-emerald-50 text-emerald-700' 
                      : selectedReturn.status === 'confirmed'
                      ? 'bg-blue-50 text-blue-700'
                      : selectedReturn.status === 'draft' 
                      ? 'bg-gray-100 text-gray-500' 
                      : 'bg-red-50 text-red-750'
                  }`}>
                    {selectedReturn.status === 'draft' ? 'Nháp' :
                     selectedReturn.status === 'confirmed' ? 'Đã duyệt' :
                     selectedReturn.status === 'completed' ? 'Hoàn tất' : 'Đã hủy'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Lý do trả hàng</span>
                  <span className="font-medium text-gray-800">
                    {selectedReturn.reason_code === 'damage' ? 'Hàng hỏng / Lỗi' :
                     selectedReturn.reason_code === 'wrong_product' ? 'Sai sản phẩm' :
                     selectedReturn.reason_code === 'near_expiry' ? 'Cận / Hết hạn' :
                     selectedReturn.reason_code === 'quality_fail' ? 'Lỗi chất lượng' :
                     selectedReturn.reason_code === 'recall' ? 'Thu hồi' : 'Lý do khác'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Hoàn tiền</span>
                  <span className="font-medium text-gray-800">
                    {selectedReturn.refund_method === 'cash_refund' ? 'Tiền mặt' :
                     selectedReturn.refund_method === 'credit_note' ? 'Cấn trừ công nợ' : 'Trừ đơn hàng sau'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Người lập phiếu</span>
                  <span className="font-medium text-gray-700">{selectedReturn.creator?.full_name || 'Hệ thống'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Tổng tiền hoàn</span>
                  <span className="font-bold text-gray-850">{Number(selectedReturn.total_amount || 0).toLocaleString('vi-VN')} ₫</span>
                </div>
                <div className="col-span-2 border-t border-gray-100/50 pt-2">
                  <span className="text-gray-400 block text-tiny">Chi tiết lý do</span>
                  <span className="text-gray-700 italic">{selectedReturn.reason_detail || 'Không có chi tiết'}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h4 className="text-body-md font-bold text-gray-750">Sản phẩm xuất trả</h4>
                <div className="border border-gray-150 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase">
                        <th className="px-4 py-3">Sản phẩm / SKU</th>
                        <th className="px-4 py-3">Số lô</th>
                        <th className="px-4 py-3 text-center">Số lượng</th>
                        <th className="px-4 py-3 text-right">Đơn giá trả</th>
                        <th className="px-4 py-3 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {selectedReturnLines.map((line) => (
                        <tr key={line.id} className="hover:bg-gray-25/30">
                          <td className="px-4 py-3">
                            <p className="font-bold text-gray-700">{line.product?.name}</p>
                            <span className="text-tiny text-gray-400 font-mono">SKU: {line.product?.sku}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-blue-500 font-semibold">{line.lot?.lot_number || 'N/A'}</td>
                          <td className="px-4 py-3 text-center font-medium text-gray-800">{line.quantity} {line.product?.unit}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{Number(line.unit_price || 0).toLocaleString('vi-VN')} ₫</td>
                          <td className="px-4 py-3 text-right font-bold text-gray-800">
                            {Number(line.line_total || (line.unit_price * line.quantity)).toLocaleString('vi-VN')} ₫
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-4 pt-4 border-t border-gray-100">
                <button
                  onClick={() => setShowReturnDetailModal(false)}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Đóng
                </button>

                {selectedReturn.status === 'draft' && (
                  <>
                    <button
                      onClick={() => handleCancelReturn(selectedReturn)}
                      disabled={submitting}
                      className="bg-red-50 text-red-650 hover:bg-red-100 h-10 px-4 rounded-lg text-body-md font-semibold transition-colors disabled:opacity-50"
                    >
                      Hủy phiếu
                    </button>
                    <button
                      onClick={() => handleConfirmReturn(selectedReturn)}
                      disabled={submitting}
                      className="flex-1 bg-blue-500 hover:bg-blue-600 text-white h-10 rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} />
                      <span>Xác nhận trả hàng</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </Layout>
  )
}
