import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  Search,
  Plus,
  Warehouse as WarehouseIcon,
  Layers,
  FileText,
  AlertTriangle,
  Clock,
  ShieldAlert,
  Settings,
  CheckCircle2,
  ArrowRightLeft,
  RotateCcw,
  Trash2
} from 'lucide-react'
import Layout from '../../components/Layout'
import { Skeleton } from '../../components/Skeleton'
import SmartSearchSelect from '../../components/SmartSearchSelect'
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
  reorder_point: number
  reorder_quantity: number | null
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
  const { profile, userRole } = useAuth()
  const [activeTab, setActiveTab] = useState<'lots' | 'pos' | 'receipts' | 'transfers' | 'purchase_returns' | 'settings'>('lots')

  // Shared States
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [allWarehouses, setAllWarehouses] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  
  // Tab 1: Stock Lots states
  const [lots, setLots] = useState<StockLot[]>([])
  const [lotSearchTerm, setLotSearchTerm] = useState('')
  const debouncedLotSearch = useDebouncedValue(lotSearchTerm, 300)
  const [whFilter, setWhFilter] = useState('all')
  const [lotQuickFilter, setLotQuickFilter] = useState<'all' | 'near-expiry' | 'low-stock' | 'quarantine'>('all')

  // Tab 2: POs states
  const [pos, setPOs] = useState<PurchaseOrder[]>([])
  const [poSearchTerm, setPoSearchTerm] = useState('')
  const debouncedPoSearch = useDebouncedValue(poSearchTerm, 300)

  // Tab 3: Receipts states
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [receiptSearchTerm, setReceiptSearchTerm] = useState('')
  const debouncedReceiptSearch = useDebouncedValue(receiptSearchTerm, 300)

  // Tab 4: Settings/Low stock alerts states
  const [invSettings, setInvSettings] = useState<InventorySetting[]>([])
  const [newSetting, setNewSetting] = useState({
    productId: '',
    warehouseId: '',
    minStock: 10,
    maxStock: 500,
    reorderPoint: 0,
    reorderQty: null as number | null
  })
  const [editingSettingId, setEditingSettingId] = useState<string | null>(null)
  const [productList, setProductList] = useState<{ id: string; name: string; sku: string }[]>([])
  const [isEditingSetting, setIsEditingSetting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Lots tab: map product_id_warehouse_id → min_stock_level (cho filter "Tồn kho thấp")
  const [lotInvSettingsMap, setLotInvSettingsMap] = useState<Record<string, number>>({})

  // PO tab: filter trạng thái
  const [poStatusFilter, setPoStatusFilter] = useState('all')

  // Tab: Stock Transfers states
  const [transfers, setTransfers] = useState<any[]>([])
  const [transferSearchTerm, setTransferSearchTerm] = useState('')
  const debouncedTransferSearch = useDebouncedValue(transferSearchTerm, 300)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showTransferDetailModal, setShowTransferDetailModal] = useState(false)
  const [selectedTransfer, setSelectedTransfer] = useState<any>(null)
  const [selectedTransferLines, setSelectedTransferLines] = useState<any[]>([])
  const [lotsForTransfer, setLotsForTransfer] = useState<any[]>([])
  const [newTransfer, setNewTransfer] = useState<{
    fromWarehouse: string;
    toWarehouse: string;
    notes: string;
    lines: Array<{ lotId: string; productId: string; quantity: number; maxQty: number; name: string; sku: string; lotNumber: string; unitPrice: number; costPrice: number }>;
  }>({
    fromWarehouse: '',
    toWarehouse: '',
    notes: '',
    lines: []
  })

  // Tab: Purchase Returns states
  const [purchaseReturns, setPurchaseReturns] = useState<any[]>([])
  const [returnSearchTerm, setReturnSearchTerm] = useState('')
  const debouncedReturnSearch = useDebouncedValue(returnSearchTerm, 300)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [showReturnDetailModal, setShowReturnDetailModal] = useState(false)
  const [selectedReturn, setSelectedReturn] = useState<any>(null)
  const [selectedReturnLines, setSelectedReturnLines] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [lotsForReturn, setLotsForReturn] = useState<any[]>([])
  const [newReturn, setNewReturn] = useState<{
    supplierId: string;
    warehouseId: string;
    reasonCode: string;
    reasonDetail: string;
    refundMethod: string;
    lines: Array<{ lotId: string; productId: string; quantity: number; maxQty: number; unitPrice: number; name: string; sku: string; lotNumber: string; costPrice: number }>;
  }>({
    supplierId: '',
    warehouseId: '',
    reasonCode: 'other',
    reasonDetail: '',
    refundMethod: 'credit_note',
    lines: []
  })

  // Memoized options for SmartSearchSelect in Stock Transfer & Supplier Return
  const transferLotOptions = useMemo(() => {
    return lotsForTransfer.map((l: any) => {
      const avail = l.quantity_on_hand - l.quantity_reserved;
      const isAlreadyAdded = newTransfer.lines.some(line => line.lotId === l.id);
      return {
        value: l.id,
        label: l.product_id ? l.name : `Lô: ${l.lot_number}`,
        desc: `Lô: ${l.lot_number} | Tồn: ${avail} | Vốn: ${l.cost_price?.toLocaleString()}₫`,
        disabled: avail <= 0 || isAlreadyAdded
      };
    });
  }, [lotsForTransfer, newTransfer.lines]);

  const returnSupplierOptions = useMemo(() => {
    return suppliers.map(s => ({
      value: s.id,
      label: s.name,
      desc: s.supplier_code ? `Mã: ${s.supplier_code}` : undefined
    }));
  }, [suppliers]);

  const returnLotOptions = useMemo(() => {
    return lotsForReturn.map((l: any) => {
      const avail = l.quantity_on_hand - l.quantity_reserved;
      const isAlreadyAdded = newReturn.lines.some(line => line.lotId === l.id);
      return {
        value: l.id,
        label: l.product_id ? l.name : `Lô: ${l.lot_number}`,
        desc: `Lô: ${l.lot_number} | Tồn: ${avail} | Giá: ${l.cost_price?.toLocaleString()}₫`,
        disabled: avail <= 0 || isAlreadyAdded
      };
    });
  }, [lotsForReturn, newReturn.lines]);

  // Tab: Goods Receipts details states
  const [showReceiptDetailModal, setShowReceiptDetailModal] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState<any>(null)
  const [selectedReceiptLines, setSelectedReceiptLines] = useState<any[]>([])

  // Temporary states for adding lines in modals
  const [modalLotId, setModalLotId] = useState('')
  const [modalQty, setModalQty] = useState(1)
  const [modalUnitPrice, setModalUnitPrice] = useState(0)

  // Fetch lots for selected source warehouse (for Transfers)
  useEffect(() => {
    const fetchLotsForTransfer = async () => {
      if (!newTransfer.fromWarehouse) {
        setLotsForTransfer([])
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
        setLotsForTransfer(formatted)
      }
    }
    fetchLotsForTransfer()
  }, [newTransfer.fromWarehouse])

  // Load lots for selected warehouse (for Purchase Returns)
  useEffect(() => {
    const fetchLotsForReturn = async () => {
      if (!newReturn.warehouseId) {
        setLotsForReturn([])
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
        setLotsForReturn(formatted)
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
        unit_price,
        lot_id,
        product_id,
        product:products(name, sku, unit),
        lot:stock_lots(lot_number, expiry_date, cost_price)
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

  // Fetch detail lines for selected goods receipt
  const fetchReceiptDetails = async (receiptId: string) => {
    const { data, error } = await supabase
      .from('goods_receipt_lines')
      .select(`
        id,
        quantity,
        unit_price,
        lot_number,
        manufacture_date,
        expiry_date,
        product_id,
        product:products(name, sku, unit)
      `)
      .eq('receipt_id', receiptId)

    if (!error && data) {
      setSelectedReceiptLines(data)
    }
  }

  // Filtered transfers logic
  const filteredTransfers = useMemo(() => transfers.filter(t => {
    return (
      t.transfer_code.toLowerCase().includes(debouncedTransferSearch.toLowerCase()) ||
      (t.from_wh?.name || '').toLowerCase().includes(debouncedTransferSearch.toLowerCase()) ||
      (t.to_wh?.name || '').toLowerCase().includes(debouncedTransferSearch.toLowerCase())
    )
  }), [transfers, debouncedTransferSearch])

  // Filtered returns logic
  const filteredReturns = useMemo(() => purchaseReturns.filter(r => {
    return (
      r.return_code.toLowerCase().includes(debouncedReturnSearch.toLowerCase()) ||
      (r.supplier?.name || '').toLowerCase().includes(debouncedReturnSearch.toLowerCase()) ||
      (r.warehouse?.name || '').toLowerCase().includes(debouncedReturnSearch.toLowerCase())
    )
  }), [purchaseReturns, debouncedReturnSearch])

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
      const totalAmount = newTransfer.lines.reduce((sum, line) => sum + (line.quantity * (line.unitPrice || 0)), 0)
      const { data: transferData, error: txError } = await supabase
        .from('stock_transfers')
        .insert([{
          from_warehouse: newTransfer.fromWarehouse,
          to_warehouse: newTransfer.toWarehouse,
          notes: newTransfer.notes || null,
          created_by: profile?.id,
          status: 'draft',
          total_amount: totalAmount
        }])
        .select()
        .single()

      if (txError) throw txError

      const linesToInsert = newTransfer.lines.map(line => ({
        transfer_id: transferData.id,
        lot_id: line.lotId,
        product_id: line.productId,
        quantity: line.quantity,
        unit_price: line.unitPrice
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
          id, transfer_code, from_warehouse, to_warehouse, status,
          transfer_date, notes, created_by, received_by, total_amount,
          from_wh:warehouses!from_warehouse(name),
          to_wh:warehouses!to_warehouse(name),
          creator:profiles!created_by(full_name),
          receiver:profiles!received_by(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      setTransfers(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi tạo phiếu chuyển: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartTransfer = async (transfer: any, _lines: any[]) => {
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('fn_start_transfer', {
        p_transfer_id: transfer.id,
        p_user_id: profile?.id
      })
      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Chuyển hàng thành công! Trạng thái: Đang đi đường.' })
      setShowTransferDetailModal(false)

      const { data } = await supabase
        .from('stock_transfers')
        .select(`
          id, transfer_code, from_warehouse, to_warehouse, status,
          transfer_date, notes, created_by, received_by, total_amount,
          from_wh:warehouses!from_warehouse(name),
          to_wh:warehouses!to_warehouse(name),
          creator:profiles!created_by(full_name),
          receiver:profiles!received_by(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      setTransfers(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi chuyển hàng: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleReceiveTransfer = async (transfer: any, _lines: any[]) => {
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('fn_receive_transfer', {
        p_transfer_id: transfer.id,
        p_user_id: profile?.id
      })
      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Nhận hàng và nhập kho thành công!' })
      setShowTransferDetailModal(false)

      const { data } = await supabase
        .from('stock_transfers')
        .select(`
          id, transfer_code, from_warehouse, to_warehouse, status,
          transfer_date, notes, created_by, received_by, total_amount,
          from_wh:warehouses!from_warehouse(name),
          to_wh:warehouses!to_warehouse(name),
          creator:profiles!created_by(full_name),
          receiver:profiles!received_by(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      setTransfers(data || [])
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi nhận hàng: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelTransfer = async (transfer: any, _lines: any[]) => {
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('fn_cancel_transfer', {
        p_transfer_id: transfer.id,
        p_user_id: profile?.id
      })
      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Đã hủy yêu cầu chuyển kho.' })
      setShowTransferDetailModal(false)

      const { data } = await supabase
        .from('stock_transfers')
        .select(`
          id, transfer_code, from_warehouse, to_warehouse, status,
          transfer_date, notes, created_by, received_by, total_amount,
          from_wh:warehouses!from_warehouse(name),
          to_wh:warehouses!to_warehouse(name),
          creator:profiles!created_by(full_name),
          receiver:profiles!received_by(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100)
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
      // Fetch all warehouses for destination selection
      const { data: allData } = await supabase
        .from('warehouses')
        .select('id, name, branch_id')
        .eq('is_active', true)
      if (allData) setAllWarehouses(allData)

      // Fetch warehouses in branch
      let query = supabase
        .from('warehouses')
        .select('id, name, branch_id')
        .eq('is_active', true)
      if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
        query = query.eq('branch_id', profile.branch_id)
      }
      const { data } = await query
      if (data) setWarehouses(data)
    }
    fetchWarehouses()
  }, [profile?.branch_id, userRole?.code])

  // Load Tab Specific Data
  useEffect(() => {
    const loadTabData = async () => {
      setLoading(true)
      try {
        if (activeTab === 'lots') {
          // Fetch stock lots
          let query = supabase
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
              warehouse:warehouses!inner(id, name, branch_id),
              supplier:suppliers(id, name)
            `)
          
          if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
            query = query.eq('warehouse.branch_id', profile.branch_id)
          }

          const { data, error } = await query
            .order('expiry_date', { ascending: true })
            .limit(100)

          if (error) throw error

          // Fetch inventory_settings để dùng cho filter "Tồn kho thấp"
          const { data: settingsRaw } = await supabase
            .from('inventory_settings')
            .select('product_id, warehouse_id, min_stock_level')
          const settingsMap: Record<string, number> = {}
          if (settingsRaw) {
            settingsRaw.forEach((s: any) => {
              settingsMap[`${s.product_id}_${s.warehouse_id}`] = s.min_stock_level
            })
          }
          setLotInvSettingsMap(settingsMap)

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
          let query = supabase
            .from('purchase_orders')
            .select(`
              id,
              po_code,
              status,
              expected_date,
              grand_total,
              created_at,
              supplier:suppliers(name),
              warehouse:warehouses!inner(name, branch_id)
            `)

          if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
            query = query.eq('warehouse.branch_id', profile.branch_id)
          }

          const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(100)

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
          let query = supabase
            .from('goods_receipts')
            .select(`
              id,
              receipt_code,
              receipt_date,
              total_amount,
              notes,
              supplier:suppliers(name),
              warehouse:warehouses!inner(name, branch_id),
              profile:profiles(full_name)
            `)

          if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
            query = query.eq('warehouse.branch_id', profile.branch_id)
          }

          const { data, error } = await query
            .order('receipt_date', { ascending: false })
            .limit(100)

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
          let query = supabase
            .from('inventory_settings')
            .select(`
              id,
              product_id,
              warehouse_id,
              min_stock_level,
              max_stock_level,
              reorder_point,
              reorder_quantity,
              product:products(sku, name),
              warehouse:warehouses!inner(name, branch_id)
            `)

          if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
            query = query.eq('warehouse.branch_id', profile.branch_id)
          }

          const { data: settingsData } = await query

          const formattedSettings = (settingsData || []).map((set: any) => ({
            id: set.id,
            product_id: set.product_id,
            warehouse_id: set.warehouse_id,
            min_stock_level: set.min_stock_level,
            max_stock_level: set.max_stock_level,
            reorder_point: set.reorder_point ?? 0,
            reorder_quantity: set.reorder_quantity ?? null,
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
          let query = supabase
            .from('stock_transfers')
            .select(`
              id, transfer_code, from_warehouse, to_warehouse, status,
              transfer_date, notes, created_by, received_by, total_amount,
              from_wh:warehouses!from_warehouse(name),
              to_wh:warehouses!to_warehouse(name),
              creator:profiles!created_by(full_name),
              receiver:profiles!received_by(full_name)
            `)

          if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
            const { data: whs } = await supabase
              .from('warehouses')
              .select('id')
              .eq('branch_id', profile.branch_id)
            const myWhIds = whs?.map((w: { id: string }) => w.id) || []
            if (myWhIds.length > 0) {
              query = query.or(`from_warehouse.in.(${myWhIds.map((id: string) => `"${id}"`).join(',')}),to_warehouse.in.(${myWhIds.map((id: string) => `"${id}"`).join(',')})`)
            } else {
              query = query.eq('id', '00000000-0000-0000-0000-000000000000')
            }
          }

          const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(100)
          if (error) throw error
          setTransfers(data || [])
        } else if (activeTab === 'purchase_returns') {
          let query = supabase
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
              warehouse:warehouses!inner(name, branch_id),
              creator:profiles!created_by(full_name)
            `)

          if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
            query = query.eq('warehouse.branch_id', profile.branch_id)
          }

          const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(100)
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
  const filteredLots = useMemo(() => lots.filter(lot => {
    // 1. Search term match
    const searchMatch =
      lot.product.name.toLowerCase().includes(debouncedLotSearch.toLowerCase()) ||
      lot.product.sku.toLowerCase().includes(debouncedLotSearch.toLowerCase()) ||
      lot.lot_number.toLowerCase().includes(debouncedLotSearch.toLowerCase())

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
        quickMatch = daysToExpiry >= 0 && daysToExpiry <= 30
      }
    } else if (lotQuickFilter === 'low-stock') {
      const key = `${lot.product.id}_${lot.warehouse.id}`
      const minLevel = lotInvSettingsMap[key] ?? 15
      quickMatch = lot.quantity_on_hand <= minLevel
    } else if (lotQuickFilter === 'quarantine') {
      quickMatch = lot.status === 'quarantine'
    }

    return searchMatch && whMatch && quickMatch
  }), [lots, debouncedLotSearch, whFilter, lotQuickFilter])

  // Filtered POs logic
  const filteredPOs = useMemo(() => pos.filter(po => {
    const searchMatch =
      po.po_code.toLowerCase().includes(debouncedPoSearch.toLowerCase()) ||
      po.supplier.name.toLowerCase().includes(debouncedPoSearch.toLowerCase())
    const statusMatch = poStatusFilter === 'all' || po.status === poStatusFilter
    return searchMatch && statusMatch
  }), [pos, debouncedPoSearch, poStatusFilter])

  // Filtered Receipts logic
  const filteredReceipts = useMemo(() => receipts.filter(gr => {
    return (
      gr.receipt_code.toLowerCase().includes(debouncedReceiptSearch.toLowerCase()) ||
      gr.supplier.name.toLowerCase().includes(debouncedReceiptSearch.toLowerCase())
    )
  }), [receipts, debouncedReceiptSearch])

  const reloadInvSettings = async () => {
    let query = supabase
      .from('inventory_settings')
      .select(`
        id, product_id, warehouse_id, min_stock_level, max_stock_level,
        reorder_point, reorder_quantity,
        product:products(sku, name),
        warehouse:warehouses!inner(name, branch_id)
      `)
    
    if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
      query = query.eq('warehouse.branch_id', profile.branch_id)
    }

    const { data: settingsData } = await query
    const formatted = (settingsData || []).map((set: any) => ({
      id: set.id,
      product_id: set.product_id,
      warehouse_id: set.warehouse_id,
      min_stock_level: set.min_stock_level,
      max_stock_level: set.max_stock_level,
      reorder_point: set.reorder_point ?? 0,
      reorder_quantity: set.reorder_quantity ?? null,
      product: { sku: set.product?.sku || '', name: set.product?.name || 'Sản phẩm không rõ' },
      warehouse: { name: set.warehouse?.name || 'Kho không rõ' }
    }))
    setInvSettings(formatted)
  }

  const handleSaveSetting = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSetting.productId || !newSetting.warehouseId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn đầy đủ Sản phẩm và Kho hàng.' })
      return
    }
    try {
      if (editingSettingId) {
        const { error } = await supabase
          .from('inventory_settings')
          .update({
            min_stock_level: Number(newSetting.minStock),
            max_stock_level: Number(newSetting.maxStock) || null,
            reorder_point: Number(newSetting.reorderPoint),
            reorder_quantity: newSetting.reorderQty ? Number(newSetting.reorderQty) : null
          })
          .eq('id', editingSettingId)
        if (error) throw error
        setAlertMsg({ type: 'success', text: 'Cập nhật định mức tồn kho thành công!' })
      } else {
        const { error } = await supabase
          .from('inventory_settings')
          .upsert([{
            product_id: newSetting.productId,
            warehouse_id: newSetting.warehouseId,
            min_stock_level: Number(newSetting.minStock),
            max_stock_level: Number(newSetting.maxStock) || null,
            reorder_point: Number(newSetting.reorderPoint),
            reorder_quantity: newSetting.reorderQty ? Number(newSetting.reorderQty) : null
          }], { onConflict: 'product_id,warehouse_id' })
        if (error) throw error
        setAlertMsg({ type: 'success', text: 'Lưu định mức tồn kho thành công!' })
      }
      setIsEditingSetting(false)
      setEditingSettingId(null)
      setNewSetting({ productId: '', warehouseId: '', minStock: 10, maxStock: 500, reorderPoint: 0, reorderQty: null })
      await reloadInvSettings()
    } catch (err: any) {
      console.error('Error saving inventory setting:', err)
      setAlertMsg({ type: 'error', text: 'Lỗi thiết lập định mức: ' + err.message })
    }
  }

  const handleDeleteSetting = async (settingId: string) => {
    try {
      const { error } = await supabase
        .from('inventory_settings')
        .delete()
        .eq('id', settingId)
      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Đã xóa định mức tồn kho.' })
      setInvSettings(prev => prev.filter(s => s.id !== settingId))
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: 'Lỗi xóa định mức: ' + err.message })
    }
  }

  const handleOpenEditSetting = (setting: InventorySetting) => {
    setEditingSettingId(setting.id)
    setNewSetting({
      productId: setting.product_id,
      warehouseId: setting.warehouse_id,
      minStock: setting.min_stock_level,
      maxStock: setting.max_stock_level ?? 500,
      reorderPoint: setting.reorder_point ?? 0,
      reorderQty: setting.reorder_quantity ?? null
    })
    setIsEditingSetting(true)
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
                  <button
                    onClick={() => setLotQuickFilter('quarantine')}
                    className={`px-4 h-10 rounded-lg text-body-md font-semibold border transition-all flex items-center gap-1.5 ${
                      lotQuickFilter === 'quarantine'
                        ? 'bg-purple-50 text-purple-700 border-purple-100'
                        : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <AlertTriangle size={14} />
                    <span>Kiểm dịch</span>
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="hidden md:block overflow-x-auto">
                {loading ? (
                  <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={7} /></tbody></table>
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

              {/* Mobile Card List for Stock Lots */}
              {!loading && (
                <div className="block md:hidden space-y-4">
                  {filteredLots.map((lot) => {
                    const isExpired = lot.expiry_date && new Date(lot.expiry_date).getTime() < new Date().getTime()
                    const isNearExpiry = lot.expiry_date && !isExpired && 
                      (new Date(lot.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) <= 30

                    return (
                      <div key={lot.id} className="bg-white p-4 rounded-xl border border-gray-150 shadow-sm space-y-2">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <p className="font-bold text-gray-805 text-body-md text-gray-800">{lot.product.name}</p>
                            <span className="text-gray-400 font-mono text-tiny">SKU: {lot.product.sku}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase shrink-0 ${
                            lot.status === 'active' 
                              ? 'bg-emerald-50 text-emerald-700' 
                              : lot.status === 'quarantine' 
                              ? 'bg-amber-50 text-amber-700' 
                              : 'bg-red-50 text-red-750'
                          }`}>
                            {lot.status === 'active' ? 'Sẵn dùng' : lot.status === 'quarantine' ? 'Kiểm dịch' : 'Khóa'}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2 text-tiny text-gray-500 pt-1 border-t border-gray-50">
                          <div>
                            <span className="block text-gray-400 font-medium">Kho hàng</span>
                            <span className="font-semibold text-gray-700">{lot.warehouse.name}</span>
                          </div>
                          <div>
                            <span className="block text-gray-400 font-medium font-mono">Số lô</span>
                            <span className="font-bold text-blue-500 font-mono">{lot.lot_number}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-tiny text-gray-500 pt-1">
                          <div>
                            <span className="block text-gray-400 font-medium">Hạn sử dụng</span>
                            <span className="font-semibold text-gray-700">
                              {lot.expiry_date ? (
                                <span className="inline-flex flex-col">
                                  <span>{new Date(lot.expiry_date).toLocaleDateString('vi-VN')}</span>
                                  {isExpired && <span className="text-[10px] text-red-500 font-bold uppercase font-mono">Hết hạn</span>}
                                  {isNearExpiry && <span className="text-[10px] text-amber-500 font-bold uppercase font-mono">Cận date</span>}
                                </span>
                              ) : (
                                <span className="text-gray-300">Không có HSD</span>
                              )}
                            </span>
                          </div>
                          <div>
                            <span className="block text-gray-400 font-medium">Tồn khả dụng / Giá vốn</span>
                            <span className="block">
                              <strong className="text-body-md text-gray-800">{lot.quantity_on_hand}</strong>
                              <span className="text-gray-300 mx-1">|</span>
                              <span className="font-semibold text-gray-700">{lot.cost_price.toLocaleString('vi-VN')} ₫</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB CONTENT: PURCHASE ORDERS */}
          {activeTab === 'pos' && (
            <div className="p-6 space-y-6">
              {/* Search + Status Filter */}
              <div className="flex flex-col md:flex-row gap-3">
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
                <select
                  value={poStatusFilter}
                  onChange={(e) => setPoStatusFilter(e.target.value)}
                  className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="draft">Nháp</option>
                  <option value="sent">Chờ nhận</option>
                  <option value="partially_received">Nhập một phần</option>
                  <option value="received">Đã nhận đủ</option>
                  <option value="cancelled">Đã hủy</option>
                </select>
              </div>

              {/* Data Table */}
              <div className="hidden md:block overflow-x-auto">
                {loading ? (
                  <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={7} /></tbody></table>
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

              {/* Mobile Card List for Purchase Orders */}
              {!loading && (
                <div className="block md:hidden space-y-4">
                  {filteredPOs.map((po) => (
                    <div key={po.id} className="bg-white p-4 rounded-xl border border-gray-150 shadow-sm space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="font-mono font-bold text-blue-500 block">{po.po_code}</span>
                          <p className="font-semibold text-gray-800 text-tiny mt-1">{po.supplier.name}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase shrink-0 ${
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
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-tiny text-gray-500 pt-1 border-t border-gray-50">
                        <div>
                          <span className="block text-gray-400 font-medium">Kho nhận dự kiến</span>
                          <span className="font-semibold text-gray-750">{po.warehouse.name}</span>
                        </div>
                        <div>
                          <span className="block text-gray-400 font-medium">Dự kiến giao</span>
                          <span className="font-semibold text-gray-750">
                            {po.expected_date ? new Date(po.expected_date).toLocaleDateString('vi-VN') : '---'}
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                        <div>
                          <span className="text-gray-450 text-[11px] block">Tổng giá trị</span>
                          <strong className="text-body-md text-gray-800 font-bold tabular-nums">{po.grand_total.toLocaleString('vi-VN')} ₫</strong>
                        </div>
                        {(po.status === 'sent' || po.status === 'partially_received') && (
                          <button
                            onClick={() => navigate(`/goods-receipts/new?po_id=${po.id}`)}
                            className="h-9 px-4 bg-blue-55 bg-blue-50 text-blue-600 rounded-lg font-bold text-tiny hover:bg-blue-100 flex items-center justify-center transition-all"
                          >
                            Nhập kho
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              <div className="hidden md:block overflow-x-auto">
                {loading ? (
                  <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={8} /></tbody></table>
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
                        <th className="px-6 py-4 w-20 text-center">Hành động</th>
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
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={async () => {
                                setSelectedReceipt(gr)
                                await fetchReceiptDetails(gr.id)
                                setShowReceiptDetailModal(true)
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

              {/* Mobile Card List for Goods Receipts */}
              {!loading && (
                <div className="block md:hidden space-y-4">
                  {filteredReceipts.map((gr) => (
                    <div key={gr.id} className="bg-white p-4 rounded-xl border border-gray-150 shadow-sm space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="font-mono font-bold text-blue-500 block">{gr.receipt_code}</span>
                          <p className="font-semibold text-gray-800 text-tiny mt-1">{gr.supplier.name}</p>
                        </div>
                        <button
                          onClick={async () => {
                            setSelectedReceipt(gr)
                            await fetchReceiptDetails(gr.id)
                            setShowReceiptDetailModal(true)
                          }}
                          className="h-8 px-3 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg font-semibold text-tiny hover:bg-gray-100 flex items-center justify-center transition-all shrink-0"
                        >
                          Chi tiết
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-tiny text-gray-500 pt-1 border-t border-gray-50">
                        <div>
                          <span className="block text-gray-400 font-medium">Kho nhận</span>
                          <span className="font-semibold text-gray-750">{gr.warehouse.name}</span>
                        </div>
                        <div>
                          <span className="block text-gray-400 font-medium">Ngày nhận</span>
                          <span className="font-semibold text-gray-750">
                            {new Date(gr.receipt_date).toLocaleDateString('vi-VN')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-tiny text-gray-500 pt-1">
                        <div>
                          <span className="block text-gray-400 font-medium">Người nhận</span>
                          <span className="font-semibold text-gray-750">{gr.profile?.full_name || 'Hệ thống'}</span>
                        </div>
                        <div>
                          <span className="block text-gray-400 font-medium">Tổng giá trị</span>
                          <strong className="text-body-md text-gray-800 font-bold tabular-nums">{gr.total_amount.toLocaleString('vi-VN')} ₫</strong>
                        </div>
                      </div>

                      {gr.notes && (
                        <div className="text-[11px] text-gray-400 italic bg-gray-50 p-2 rounded-lg border border-gray-100">
                          Ghi chú: {gr.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
              <div className="hidden md:block overflow-x-auto">
                {loading ? (
                  <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={7} /></tbody></table>
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
                        <th className="px-6 py-4 text-right">Tổng giá trị</th>
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
                          <td className="px-6 py-4 text-right font-bold text-gray-700">
                            {t.total_amount ? `${Number(t.total_amount).toLocaleString('vi-VN')} ₫` : '0 ₫'}
                          </td>
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

              {/* Mobile Card List for Stock Transfers */}
              {!loading && (
                <div className="block md:hidden space-y-4">
                  {filteredTransfers.map((t) => (
                    <div key={t.id} className="bg-white p-4 rounded-xl border border-gray-150 shadow-sm space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="font-mono font-bold text-blue-500 block">{t.transfer_code}</span>
                          <span className="text-[11px] text-gray-400 mt-1 block">Ngày chuyển: {new Date(t.transfer_date).toLocaleDateString('vi-VN')}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase shrink-0 ${
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
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-tiny text-gray-500 pt-1 border-t border-gray-50">
                        <div>
                          <span className="block text-gray-400 font-medium">Kho nguồn</span>
                          <span className="font-semibold text-gray-750">{t.from_wh?.name || 'Kho nguồn'}</span>
                        </div>
                        <div>
                          <span className="block text-gray-400 font-medium">Kho đích</span>
                          <span className="font-semibold text-gray-755 text-gray-700">{t.to_wh?.name || 'Kho đích'}</span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                        <div className="flex flex-col">
                          <span className="text-[11px] text-gray-400 font-vietnamese">Người tạo: <strong className="text-gray-600 font-semibold">{t.creator?.full_name || 'Hệ thống'}</strong></span>
                          <span className="text-[11px] text-gray-400">Tổng tiền: <strong className="text-gray-850 font-bold">{t.total_amount ? `${Number(t.total_amount).toLocaleString('vi-VN')} ₫` : '0 ₫'}</strong></span>
                        </div>
                        <button
                          onClick={async () => {
                            setSelectedTransfer(t)
                            await fetchTransferDetails(t.id)
                            setShowTransferDetailModal(true)
                          }}
                          className="h-8 px-4 bg-gray-50 text-gray-605 text-gray-600 border border-gray-200 rounded-lg font-semibold text-tiny hover:bg-gray-100 flex items-center justify-center transition-all"
                        >
                          Chi tiết
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              <div className="hidden md:block overflow-x-auto">
                {loading ? (
                  <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={7} /></tbody></table>
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

              {/* Mobile Card List for Purchase Returns */}
              {!loading && (
                <div className="block md:hidden space-y-4">
                  {filteredReturns.map((r) => (
                    <div key={r.id} className="bg-white p-4 rounded-xl border border-gray-150 shadow-sm space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="font-mono font-bold text-blue-500 block">{r.return_code}</span>
                          <p className="font-semibold text-gray-800 text-tiny mt-1">{r.supplier?.name || 'Nhà cung cấp'}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-tiny font-bold uppercase shrink-0 ${
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
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-tiny text-gray-500 pt-1 border-t border-gray-50">
                        <div>
                          <span className="block text-gray-400 font-medium">Kho trả hàng</span>
                          <span className="font-semibold text-gray-750">{r.warehouse?.name || 'Kho xuất'}</span>
                        </div>
                        <div>
                          <span className="block text-gray-400 font-medium">Hoàn tiền</span>
                          <span className="font-semibold text-gray-750 capitalize text-gray-700">
                            {r.refund_method === 'cash_refund' ? 'Tiền mặt' : r.refund_method === 'credit_note' ? 'Trừ công nợ' : 'Cấn trừ PO'}
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                        <div>
                          <span className="text-gray-455 text-[11px] block">Tổng giá trị</span>
                          <strong className="text-body-md text-gray-850 font-bold tabular-nums">{Number(r.total_amount || 0).toLocaleString('vi-VN')} ₫</strong>
                        </div>
                        <button
                          onClick={async () => {
                            setSelectedReturn(r)
                            await fetchReturnDetails(r.id)
                            setShowReturnDetailModal(true)
                          }}
                          className="h-8 px-4 bg-gray-50 text-gray-650 text-gray-600 border border-gray-200 rounded-lg font-semibold text-tiny hover:bg-gray-100 flex items-center justify-center transition-all"
                        >
                          Chi tiết
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              <div className="hidden md:block overflow-x-auto">
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
                        <th className="px-6 py-4 text-center">Tồn tối thiểu</th>
                        <th className="px-6 py-4 text-center">Tồn tối đa</th>
                        <th className="px-6 py-4 text-center">Điểm đặt lại</th>
                        <th className="px-6 py-4 w-24 text-center">Hành động</th>
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
                          <td className="px-6 py-4 text-center font-bold text-gray-700">{set.max_stock_level || '---'}</td>
                          <td className="px-6 py-4 text-center text-gray-500">{set.reorder_point || '---'}</td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex gap-2 justify-center">
                              <button
                                onClick={() => handleOpenEditSetting(set)}
                                className="text-blue-500 hover:text-blue-600 font-semibold text-tiny hover:underline"
                              >
                                Sửa
                              </button>
                              <button
                                onClick={() => handleDeleteSetting(set.id)}
                                className="text-red-500 hover:text-red-600 font-semibold text-tiny hover:underline"
                              >
                                Xóa
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Mobile Card List for Safety Stock Settings */}
              {invSettings.length > 0 && (
                <div className="block md:hidden space-y-4">
                  {invSettings.map((set) => (
                    <div key={set.id} className="bg-white p-4 rounded-xl border border-gray-150 shadow-sm space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <p className="font-bold text-gray-800 text-body-md">{set.product.name}</p>
                          <span className="text-gray-400 font-mono text-tiny">SKU: {set.product.sku}</span>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => handleOpenEditSetting(set)}
                            className="h-8 px-2.5 bg-blue-50 text-blue-600 rounded-lg font-semibold text-tiny hover:bg-blue-100 flex items-center justify-center transition-all"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => handleDeleteSetting(set.id)}
                            className="h-8 px-2.5 bg-red-50 text-red-650 rounded-lg font-semibold text-tiny hover:bg-red-100 flex items-center justify-center transition-all"
                          >
                            Xóa
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-tiny text-gray-500 pt-2 border-t border-gray-50">
                        <div>
                          <span className="block text-gray-450 text-[10px]">Tồn tối thiểu</span>
                          <strong className="text-body-md text-red-500 font-bold">{set.min_stock_level}</strong>
                        </div>
                        <div>
                          <span className="block text-gray-450 text-[10px]">Tồn tối đa</span>
                          <strong className="text-body-md text-gray-700 font-bold">{set.max_stock_level || '---'}</strong>
                        </div>
                        <div>
                          <span className="block text-gray-450 text-[10px]">Điểm đặt lại</span>
                          <span className="text-body-md text-gray-500 font-semibold">{set.reorder_point || '---'}</span>
                        </div>
                      </div>

                      <div className="text-tiny text-gray-500 pt-1">
                        Kho áp dụng: <strong className="text-gray-700 font-semibold">{set.warehouse.name}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                <h3 className="text-body-lg font-bold text-gray-800">
                  {editingSettingId ? 'Cập nhật định mức tồn kho' : 'Cấu hình định mức tồn kho'}
                </h3>
                <p className="text-tiny text-gray-400">Thiết lập ngưỡng cảnh báo an toàn cho sản phẩm</p>
              </div>
              <button
                onClick={() => {
                  setIsEditingSetting(false)
                  setEditingSettingId(null)
                  setNewSetting({ productId: '', warehouseId: '', minStock: 10, maxStock: 500, reorderPoint: 0, reorderQty: null })
                }}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveSetting} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Chọn sản phẩm</label>
                <select
                  value={newSetting.productId}
                  onChange={(e) => setNewSetting({ ...newSetting, productId: e.target.value })}
                  disabled={!!editingSettingId}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
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
                  disabled={!!editingSettingId}
                  className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Điểm đặt hàng lại</label>
                  <input
                    type="number"
                    min="0"
                    value={newSetting.reorderPoint}
                    onChange={(e) => setNewSetting({ ...newSetting, reorderPoint: parseInt(e.target.value) || 0 })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">SL đặt lại gợi ý</label>
                  <input
                    type="number"
                    min="0"
                    value={newSetting.reorderQty ?? ''}
                    placeholder="Tùy chọn"
                    onChange={(e) => setNewSetting({ ...newSetting, reorderQty: e.target.value ? parseInt(e.target.value) : null })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingSetting(false)
                    setEditingSettingId(null)
                    setNewSetting({ productId: '', warehouseId: '', minStock: 10, maxStock: 500, reorderPoint: 0, reorderQty: null })
                  }}
                  className="flex-1 h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center"
                >
                  {editingSettingId ? 'Cập nhật' : 'Lưu định mức'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tạo yêu cầu chuyển kho */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
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
                      const val = e.target.value
                      setNewTransfer({
                        ...newTransfer,
                        fromWarehouse: val,
                        toWarehouse: val === newTransfer.toWarehouse ? '' : newTransfer.toWarehouse,
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
                    {allWarehouses
                      .filter(w => w.id !== newTransfer.fromWarehouse)
                      .map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Add item to transfer */}
              {newTransfer.fromWarehouse && (
                <div className="bg-gray-25 border border-gray-100 rounded-lg p-4 space-y-4">
                  <h4 className="text-body-md font-bold text-gray-700">Thêm sản phẩm từ kho nguồn</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="block text-tiny font-semibold text-gray-600">Chọn lô hàng</label>
                      <SmartSearchSelect
                        options={transferLotOptions}
                        value={modalLotId}
                        onChange={(val) => {
                          setModalLotId(val);
                          const lot = lotsForTransfer.find((l: any) => l.id === val);
                          if (lot) setModalUnitPrice(lot.cost_price);
                        }}
                        placeholder="-- Chọn lô hàng còn tồn --"
                        searchPlaceholder="Tìm kiếm lô hàng..."
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-tiny font-semibold text-gray-600">Số lượng chuyển</label>
                      <input
                        type="number"
                        min="1"
                        value={modalQty}
                        onChange={(e) => setModalQty(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-full h-11 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-tiny font-semibold text-gray-600">Đơn giá chuyển (₫)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="0"
                          value={modalUnitPrice}
                          onChange={(e) => setModalUnitPrice(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full h-11 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!modalLotId) return;
                            const lot = lotsForTransfer.find((l: any) => l.id === modalLotId);
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
                              unitPrice: modalUnitPrice,
                              costPrice: lot.cost_price,
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
                            setModalUnitPrice(0);
                          }}
                          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 h-11 rounded-lg text-body-md transition-colors"
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
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-550 text-gray-500 font-bold text-tiny uppercase">
                        <th className="px-4 py-2">Sản phẩm / SKU</th>
                        <th className="px-4 py-2">Số lô</th>
                        <th className="px-4 py-2 text-center w-24">Số lượng</th>
                        <th className="px-4 py-2 text-right w-36">Đơn giá chuyển</th>
                        <th className="px-4 py-2 text-right w-32">Thành tiền</th>
                        <th className="px-4 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {newTransfer.lines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-gray-400 italic">Chưa chọn sản phẩm nào. Vui lòng thêm từ form ở trên.</td>
                        </tr>
                      ) : (
                        newTransfer.lines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-gray-25/30">
                            <td className="px-4 py-2.5">
                              <p className="font-bold text-gray-700">{line.name}</p>
                              <div className="flex gap-2 items-center text-tiny">
                                <span className="text-gray-455 font-mono">SKU: {line.sku}</span>
                                <span className="text-gray-300">|</span>
                                <span className="text-amber-600 font-medium">Vốn: {line.costPrice?.toLocaleString('vi-VN')} ₫</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-blue-500 font-semibold">{line.lotNumber}</td>
                            <td className="px-4 py-2.5 text-center">
                              <input
                                type="number"
                                min="1"
                                max={line.maxQty}
                                value={line.quantity}
                                onChange={(e) => {
                                  const val = Math.min(line.maxQty, Math.max(1, parseInt(e.target.value) || 1))
                                  const updated = [...newTransfer.lines]
                                  updated[idx] = { ...line, quantity: val }
                                  setNewTransfer({ ...newTransfer, lines: updated })
                                }}
                                className="w-20 text-center h-8 border border-gray-100 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-800"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="number"
                                min="0"
                                value={line.unitPrice}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0)
                                  const updated = [...newTransfer.lines]
                                  updated[idx] = { ...line, unitPrice: val }
                                  setNewTransfer({ ...newTransfer, lines: updated })
                                }}
                                className="w-28 text-right h-8 px-2 border border-gray-100 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-850"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-gray-800">
                              {(line.quantity * (line.unitPrice || 0)).toLocaleString('vi-VN')} ₫
                            </td>
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
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
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
                <h4 className="text-body-md font-bold text-gray-755">Sản phẩm luân chuyển</h4>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase">
                        <th className="px-4 py-3">Sản phẩm / SKU</th>
                        <th className="px-4 py-3">Số lô</th>
                        <th className="px-4 py-3 text-center">Hạn sử dụng</th>
                        <th className="px-4 py-3 text-center">Số lượng</th>
                        <th className="px-4 py-3 text-right">Đơn giá chuyển</th>
                        <th className="px-4 py-3 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {selectedTransferLines.map((line) => {
                        const costPrice = line.lot?.cost_price;
                        return (
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
                            <td className="px-4 py-3 text-right text-gray-700">
                              <div>
                                <span>{Number(line.unit_price || 0).toLocaleString('vi-VN')} ₫</span>
                                {costPrice !== undefined && (
                                  <span className="block text-[10px] text-gray-400 font-vietnamese">Vốn: {Number(costPrice).toLocaleString('vi-VN')} ₫</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-gray-800">
                              {Number((line.unit_price || 0) * line.quantity).toLocaleString('vi-VN')} ₫
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {selectedTransferLines.length > 0 && (
                  <div className="flex justify-end p-2">
                    <span className="text-body-md text-gray-500">Tổng tiền chuyển kho: <strong className="text-body-lg text-gray-800">
                      {selectedTransferLines.reduce((sum, line) => sum + (line.quantity * (line.unit_price || 0)), 0).toLocaleString('vi-VN')} ₫
                    </strong></span>
                  </div>
                )}
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
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-155 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
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
                  <SmartSearchSelect
                    options={returnSupplierOptions}
                    value={newReturn.supplierId}
                    onChange={(val) => setNewReturn({ ...newReturn, supplierId: val })}
                    placeholder="-- Chọn nhà cung cấp --"
                    searchPlaceholder="Tìm kiếm nhà cung cấp..."
                    required
                  />
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
                      <SmartSearchSelect
                        options={returnLotOptions}
                        value={modalLotId}
                        onChange={(val) => {
                          setModalLotId(val);
                          const lot = lotsForReturn.find((l: any) => l.id === val);
                          if (lot) setModalUnitPrice(lot.cost_price);
                        }}
                        placeholder="-- Chọn lô hàng còn tồn --"
                        searchPlaceholder="Tìm kiếm lô hàng..."
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-tiny font-semibold text-gray-600">Số lượng trả</label>
                      <input
                        type="number"
                        min="1"
                        value={modalQty}
                        onChange={(e) => setModalQty(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-full h-11 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
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
                          className="w-full h-11 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!modalLotId) return;
                            const lot = lotsForReturn.find((l: any) => l.id === modalLotId);
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
                              costPrice: lot.cost_price,
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
                          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 h-11 rounded-lg text-body-md transition-colors"
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
                              <div className="flex gap-2 items-center text-tiny">
                                <span className="text-gray-455 font-mono">SKU: {line.sku}</span>
                                <span className="text-gray-300">|</span>
                                <span className="text-amber-600 font-medium">Gốc: {line.costPrice?.toLocaleString('vi-VN')} ₫</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-blue-500 font-semibold">{line.lotNumber}</td>
                            <td className="px-4 py-2.5 text-center">
                              <input
                                type="number"
                                min="1"
                                max={line.maxQty}
                                value={line.quantity}
                                onChange={(e) => {
                                  const val = Math.min(line.maxQty, Math.max(1, parseInt(e.target.value) || 1))
                                  const updated = [...newReturn.lines]
                                  updated[idx] = { ...line, quantity: val }
                                  setNewReturn({ ...newReturn, lines: updated })
                                }}
                                className="w-20 text-center h-8 border border-gray-100 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-800"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="number"
                                min="0"
                                value={line.unitPrice}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0)
                                  const updated = [...newReturn.lines]
                                  updated[idx] = { ...line, unitPrice: val }
                                  setNewReturn({ ...newReturn, lines: updated })
                                }}
                                className="w-28 text-right h-8 px-2 border border-gray-100 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-850"
                              />
                            </td>
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
                                className="text-red-500 hover:text-red-655 p-1 rounded hover:bg-red-50"
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
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-155 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
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
      {/* Modal Chi tiết phiếu nhập kho */}
      {showReceiptDetailModal && selectedReceipt && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-155 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Chi tiết phiếu nhập kho</h3>
                <p className="text-mono text-tiny text-blue-500 font-bold">{selectedReceipt.receipt_code}</p>
              </div>
              <button
                onClick={() => setShowReceiptDetailModal(false)}
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
                  <span className="font-semibold text-gray-800">{selectedReceipt.supplier?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Kho nhận hàng</span>
                  <span className="font-semibold text-gray-800">{selectedReceipt.warehouse?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Ngày nhập</span>
                  <span className="font-medium">{new Date(selectedReceipt.receipt_date).toLocaleDateString('vi-VN')}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-tiny">Người nhận</span>
                  <span className="font-medium text-gray-700">{selectedReceipt.profile?.full_name || 'Hệ thống'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-400 block text-tiny">Tổng giá trị</span>
                  <span className="font-bold text-gray-850">{Number(selectedReceipt.total_amount || 0).toLocaleString('vi-VN')} ₫</span>
                </div>
                <div className="col-span-2 border-t border-gray-100/50 pt-2">
                  <span className="text-gray-400 block text-tiny">Ghi chú</span>
                  <span className="text-gray-700 italic">{selectedReceipt.notes || 'Không có ghi chú'}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h4 className="text-body-md font-bold text-gray-755">Danh sách sản phẩm nhập</h4>
                <div className="border border-gray-150 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase">
                        <th className="px-4 py-3">Sản phẩm / SKU</th>
                        <th className="px-4 py-3">Số lô</th>
                        <th className="px-4 py-3 text-center">Hạn sử dụng</th>
                        <th className="px-4 py-3 text-center">Số lượng</th>
                        <th className="px-4 py-3 text-right">Đơn giá nhập</th>
                        <th className="px-4 py-3 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-body-md text-gray-600">
                      {selectedReceiptLines.map((line) => (
                        <tr key={line.id} className="hover:bg-gray-25/30">
                          <td className="px-4 py-3">
                            <p className="font-bold text-gray-700">{line.product?.name}</p>
                            <span className="text-tiny text-gray-400 font-mono">SKU: {line.product?.sku}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-blue-500 font-semibold">{line.lot_number || 'N/A'}</td>
                          <td className="px-4 py-3 text-center text-gray-500">
                            {line.expiry_date ? new Date(line.expiry_date).toLocaleDateString('vi-VN') : '---'}
                          </td>
                          <td className="px-4 py-3 text-center font-medium text-gray-800">{line.quantity} {line.product?.unit}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{Number(line.unit_price || 0).toLocaleString('vi-VN')} ₫</td>
                          <td className="px-4 py-3 text-right font-bold text-gray-850">
                            {Number(line.unit_price * line.quantity).toLocaleString('vi-VN')} ₫
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
                  onClick={() => setShowReceiptDetailModal(false)}
                  className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </Layout>
  )
}
