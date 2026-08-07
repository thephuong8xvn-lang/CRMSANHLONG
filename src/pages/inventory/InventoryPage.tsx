import { useState, useEffect, useMemo, useRef } from 'react'
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
  Trash2,
  Pencil,
  Ban
} from 'lucide-react'
import Layout from '../../components/Layout'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import DecimalInput from '../../components/DecimalInput'
import { useAuth } from '../../contexts/AuthContext'
import LotEditModal, { type EditableLot } from './LotEditModal'
import { stockTransferDraftKey, purchaseReturnDraftKey, loadDraft, saveDraft, clearDraft } from '../../lib/posDraftStorage'

interface StockLot {
  id: string
  lot_number: string
  manufacture_date: string | null
  expiry_date: string | null
  cost_price: number
  quantity_on_hand: number
  quantity_reserved: number
  status: string
  product: {
    id: string
    name: string
    sku: string
    unit: string | null
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
  created_at: string
  total_amount: number
  status: string
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

const RECEIPT_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Nháp', cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  verified:  { label: 'Đã duyệt', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  completed: { label: 'Hoàn thành', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  cancelled: { label: 'Đã hủy', cls: 'bg-gray-100 text-gray-500 border-gray-200' }
}

// Vòng đời phiếu chuyển kho:
//   draft → in_transit → received → completed (Admin duyệt → hàng mới vào sổ kho đích)
//                                 ↘ rejected  (Admin từ chối → hàng hoàn về kho nguồn)
//   draft | in_transit → cancelled
const TRANSFER_STATUS: Record<string, { label: string; cls: string }> = {
  draft:      { label: 'Nháp',       cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  in_transit: { label: 'Đang chuyển', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  received:   { label: 'Chờ duyệt',  cls: 'bg-violet-50 text-violet-700 border-violet-100' },
  completed:  { label: 'Hoàn thành', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  rejected:   { label: 'Bị từ chối', cls: 'bg-red-50 text-red-700 border-red-100' },
  cancelled:  { label: 'Đã hủy',     cls: 'bg-gray-100 text-gray-500 border-gray-200' }
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

// ─────────────────────────────────────────────────────────────
// Tiện ích cho dòng "Tổng cộng" trên đầu bảng.
// Mọi bảng ở trang này phân trang CLIENT-SIDE (đã nạp đủ dòng) nên cộng ở
// client là đúng — khác báo cáo giá vốn phân trang server-side.
// ─────────────────────────────────────────────────────────────
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ₫`
const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0)
/** Cột số lượng không cộng được khi tập gồm nhiều đơn vị tính. */
const MIXED_UNIT = (
  <span className="text-gray-300 font-normal" title="Các dòng đang xem có nhiều đơn vị tính khác nhau (kg, chai, lọ…) nên không cộng được">
    — <span className="text-tiny">nhiều ĐVT</span>
  </span>
)

export default function InventoryPage() {
  const navigate = useNavigate()
  const { profile, userRole } = useAuth()
  const isAdmin = userRole?.code === 'admin' || userRole?.code === 'ceo'
  const [activeTab, setActiveTab] = useState<'lots' | 'pos' | 'receipts' | 'transfers' | 'purchase_returns' | 'settings'>('receipts')


  // Admin sửa/xóa lô hàng
  const [editingLot, setEditingLot] = useState<EditableLot | null>(null)
  const [deletingLot, setDeletingLot] = useState<StockLot | null>(null)
  const [deleteLotReason, setDeleteLotReason] = useState('')
  const [lotReloadFlag, setLotReloadFlag] = useState(0)

  // Shared States
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [allWarehouses, setAllWarehouses] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
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
  const [transferStatusFilter, setTransferStatusFilter] = useState<string>('all')
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showTransferDetailModal, setShowTransferDetailModal] = useState(false)
  const [selectedTransfer, setSelectedTransfer] = useState<any>(null)
  const [selectedTransferLines, setSelectedTransferLines] = useState<any[]>([])
  const [lotsForTransfer, setLotsForTransfer] = useState<any[]>([])
  // Bảng giá chuyển kho nội bộ (price_lists.usage = 'transfer') do admin dựng
  const [transferPriceLists, setTransferPriceLists] = useState<{ id: string; code: string; name: string }[]>([])
  const [applyingPrices, setApplyingPrices] = useState(false)
  // Từ chối phiếu (admin) — bắt buộc có lý do
  const [rejectingTransfer, setRejectingTransfer] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  // Xem trước giá vốn mới ở kho đích (hiện cho admin ở bước duyệt)
  const [costPreview, setCostPreview] = useState<any[]>([])
  // Sửa số lượng / đơn giá ngay trên phiếu (nháp: người lập; đã xuất: chỉ admin)
  const [editingLines, setEditingLines] = useState(false)
  const [lineEdits, setLineEdits] = useState<Record<string, { quantity: number; unitPrice: number }>>({})
  const [transferPending, setTransferPending] = useState<{
    in_transit_count: number; in_transit_cost: number;
    awaiting_count: number; awaiting_cost: number;
  } | null>(null)
  const [newTransfer, setNewTransfer] = useState<{
    fromWarehouse: string;
    toWarehouse: string;
    notes: string;
    reason: string;
    priceListId: string;
    lines: Array<{
      lotId: string; productId: string; quantity: number; maxQty: number;
      name: string; sku: string; lotNumber: string;
      unitPrice: number; listUnitPrice: number; costPrice: number;
    }>;
  }>({
    fromWarehouse: '',
    toWarehouse: '',
    notes: '',
    reason: '',
    priceListId: '',
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

  // ── Bền hóa nháp 2 modal kho (chuyển kho + trả NCC) theo nhân viên ──
  // Lưu khi còn nội dung → thoát tab/F5/mất điện mở lại vẫn còn. Dọn khi tạo
  // thành công hoặc form rỗng (bấm Hủy reset → tự dọn).
  const transferDraftKey = profile?.id ? stockTransferDraftKey(profile.id) : null
  const returnDraftKey = profile?.id ? purchaseReturnDraftKey(profile.id) : null
  const invDraftRestoredRef = useRef(false)

  useEffect(() => {
    if (invDraftRestoredRef.current) return
    if (!transferDraftKey && !returnDraftKey) return
    if (transferDraftKey) {
      const t = loadDraft<typeof newTransfer>(transferDraftKey, d => Array.isArray(d?.lines) && d.lines.length > 0)
      if (t) setNewTransfer(t)
    }
    if (returnDraftKey) {
      const r = loadDraft<typeof newReturn>(returnDraftKey, d => Array.isArray(d?.lines) && d.lines.length > 0)
      if (r) setNewReturn(r)
    }
    invDraftRestoredRef.current = true
  }, [transferDraftKey, returnDraftKey])

  useEffect(() => {
    if (!transferDraftKey || !invDraftRestoredRef.current) return
    if (newTransfer.lines.length > 0 || newTransfer.fromWarehouse || newTransfer.toWarehouse) {
      saveDraft(transferDraftKey, newTransfer)
    } else {
      clearDraft(transferDraftKey)
    }
  }, [transferDraftKey, newTransfer])

  useEffect(() => {
    if (!returnDraftKey || !invDraftRestoredRef.current) return
    if (newReturn.lines.length > 0 || newReturn.supplierId) {
      saveDraft(returnDraftKey, newReturn)
    } else {
      clearDraft(returnDraftKey)
    }
  }, [returnDraftKey, newReturn])

  // Options cho SmartSearchSelect chọn SP ở tab Cài đặt (productList đã fetchAllRows → đủ 1001+)
  const productListOptions = useMemo(
    () => productList.map(p => ({ value: p.id, label: p.name, desc: p.sku })),
    [productList]
  )

  // Memoized options for SmartSearchSelect in Stock Transfer & Supplier Return
  const transferLotOptions = useMemo(() => {
    return lotsForTransfer.map((l: any) => {
      const avail = l.quantity_on_hand - l.quantity_reserved;
      const isAlreadyAdded = newTransfer.lines.some(line => line.lotId === l.id);
      return {
        value: l.id,
        label: l.product_id ? l.name : `Lô: ${l.lot_number}`,
        desc: `${l.is_vat ? '🔴 HĐ đỏ' : '⚪ Không HĐ'} | Lô: ${l.lot_number} | Tồn: ${avail} | Vốn: ${l.cost_price?.toLocaleString()}₫`,
        disabled: avail <= 0 || isAlreadyAdded
      };
    });
  }, [lotsForTransfer, newTransfer.lines]);

  // Áp bảng giá nội bộ lên các dòng đang có trong phiếu. Sản phẩm không nằm
  // trong bảng giá thì giữ nguyên đơn giá hiện tại (báo lại cho người dùng
  // biết bao nhiêu dòng không tra được giá).
  const applyTransferPriceList = async (priceListId: string) => {
    if (!priceListId || newTransfer.lines.length === 0) return
    setApplyingPrices(true)
    try {
      const productIds = [...new Set(newTransfer.lines.map(l => l.productId))]
      const { data, error } = await supabase
        .from('price_list_items')
        .select('product_id, selling_price, min_quantity')
        .eq('price_list_id', priceListId)
        .in('product_id', productIds)
        .is('variant_id', null)
        .order('min_quantity', { ascending: true })
      if (error) throw error

      // Bậc min_quantity thấp nhất thắng (order asc + chỉ nhận lần đầu)
      const priceMap: Record<string, number> = {}
      for (const it of data || []) {
        if (priceMap[it.product_id] === undefined) priceMap[it.product_id] = Number(it.selling_price)
      }

      let missing = 0
      const lines = newTransfer.lines.map(l => {
        const p = priceMap[l.productId]
        if (p === undefined) { missing++; return l }
        return { ...l, unitPrice: p, listUnitPrice: p }
      })
      setNewTransfer({ ...newTransfer, lines })

      setAlertMsg(
        missing > 0
          ? { type: 'error', text: `Đã áp bảng giá. ${missing}/${lines.length} dòng không có trong bảng giá — giữ nguyên đơn giá cũ.` }
          : { type: 'success', text: `Đã áp bảng giá cho ${lines.length} dòng.` }
      )
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi áp bảng giá: ' + err.message })
    } finally {
      setApplyingPrices(false)
    }
  }

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
        desc: `${l.is_vat ? '🔴 HĐ đỏ' : '⚪ Không HĐ'} | Lô: ${l.lot_number} | Tồn: ${avail} | Giá: ${l.cost_price?.toLocaleString()}₫`,
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
      const data = await fetchAllRows<any>((from, to) =>
        supabase
          .from('stock_lots')
          .select(`
            id,
            lot_number,
            quantity_on_hand,
            quantity_reserved,
            expiry_date,
            cost_price,
            is_vat,
            product:products(id, name, sku, unit)
          `)
          .eq('warehouse_id', newTransfer.fromWarehouse)
          .eq('status', 'active')
          .gt('quantity_on_hand', 0)
          .order('expiry_date', { ascending: true }).order('id')
          .range(from, to)
      )

      if (data) {
        const formatted = data.map((l: any) => ({
          id: l.id,
          lot_number: l.lot_number,
          quantity_on_hand: l.quantity_on_hand,
          quantity_reserved: l.quantity_reserved,
          expiry_date: l.expiry_date,
          cost_price: Number(l.cost_price),
          is_vat: !!l.is_vat,
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
      const data = await fetchAllRows<any>((from, to) =>
        supabase
          .from('stock_lots')
          .select(`
            id,
            lot_number,
            quantity_on_hand,
            quantity_reserved,
            expiry_date,
            cost_price,
            is_vat,
            product:products(id, name, sku, unit)
          `)
          .eq('warehouse_id', newReturn.warehouseId)
          .eq('status', 'active')
          .gt('quantity_on_hand', 0)
          .order('expiry_date', { ascending: true }).order('id')
          .range(from, to)
      )

      if (data) {
        const formatted = data.map((l: any) => ({
          id: l.id,
          lot_number: l.lot_number,
          quantity_on_hand: l.quantity_on_hand,
          quantity_reserved: l.quantity_reserved,
          expiry_date: l.expiry_date,
          cost_price: Number(l.cost_price),
          is_vat: !!l.is_vat,
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
      const data = await fetchAllRows<{ id: string; name: string }>((from, to) =>
        supabase.from('suppliers').select('id, name').eq('is_active', true)
          .order('name', { ascending: true }).order('id').range(from, to)
      )
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
        list_unit_price,
        source_cost_price,
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

  // Giá vốn kho đích sẽ thành bao nhiêu sau khi nhập — thông tin Admin cần để
  // chốt giá bán cho chi nhánh nhận. Chỉ tra ở bước chờ duyệt.
  const fetchCostPreview = async (transferId: string, status: string) => {
    if (status !== 'received') { setCostPreview([]); return }
    const { data, error } = await supabase.rpc('fn_transfer_cost_preview', { p_transfer_id: transferId })
    setCostPreview(!error && Array.isArray(data) ? data : [])
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
    if (transferStatusFilter !== 'all' && t.status !== transferStatusFilter) return false
    const q = debouncedTransferSearch.toLowerCase()
    if (!q) return true
    return (
      t.transfer_code.toLowerCase().includes(q) ||
      (t.from_wh?.name || '').toLowerCase().includes(q) ||
      (t.to_wh?.name || '').toLowerCase().includes(q)
    )
  }), [transfers, debouncedTransferSearch, transferStatusFilter])

  // Số phiếu đang chờ Admin duyệt (hiện trên tab + banner)
  const awaitingApprovalCount = useMemo(
    () => transfers.filter(t => t.status === 'received').length,
    [transfers]
  )

  // Filtered returns logic
  const filteredReturns = useMemo(() => purchaseReturns.filter(r => {
    return (
      r.return_code.toLowerCase().includes(debouncedReturnSearch.toLowerCase()) ||
      (r.supplier?.name || '').toLowerCase().includes(debouncedReturnSearch.toLowerCase()) ||
      (r.warehouse?.name || '').toLowerCase().includes(debouncedReturnSearch.toLowerCase())
    )
  }), [purchaseReturns, debouncedReturnSearch])

  // Nạp lại danh sách phiếu chuyển kho + tóm tắt hàng chưa vào sổ kho đích.
  // (Trước đây khối select này bị lặp nguyên văn ở 4 handler.)
  const reloadTransfers = async () => {
    let query = supabase
      .from('stock_transfers')
      .select(`
        id, transfer_code, from_warehouse, to_warehouse, status,
        transfer_date, notes, reason, created_by, received_by, approved_by, rejected_by,
        total_amount, total_cost, price_list_id,
        shipped_at, received_at, approved_at, rejected_at, reject_reason,
        from_wh:warehouses!from_warehouse(name),
        to_wh:warehouses!to_warehouse(name),
        creator:profiles!created_by(full_name),
        receiver:profiles!received_by(full_name),
        approver:profiles!approved_by(full_name),
        rejecter:profiles!rejected_by(full_name),
        price_list:price_lists!price_list_id(name)
      `)

    if (!isAdmin && profile?.branch_id) {
      const { data: whs } = await supabase
        .from('warehouses')
        .select('id')
        .eq('branch_id', profile.branch_id)
      const myWhIds = whs?.map((w: { id: string }) => w.id) || []
      if (myWhIds.length > 0) {
        query = query.or(
          `from_warehouse.in.(${myWhIds.map((id: string) => `"${id}"`).join(',')}),to_warehouse.in.(${myWhIds.map((id: string) => `"${id}"`).join(',')})`
        )
      } else {
        query = query.eq('id', '00000000-0000-0000-0000-000000000000')
      }
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    setTransfers(data || [])

    const { data: pend } = await supabase.rpc('fn_transfer_pending_summary')
    setTransferPending(Array.isArray(pend) ? pend[0] : pend)
  }

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
      // Tạo NGUYÊN TỬ qua RPC: server tự chốt tổng tiền, tự kiểm lô thuộc kho
      // nguồn / tồn khả dụng / trùng lô — thay cho 2 lượt insert rời trước đây.
      const { error } = await supabase.rpc('fn_create_transfer', {
        p_from_warehouse: newTransfer.fromWarehouse,
        p_to_warehouse: newTransfer.toWarehouse,
        p_lines: newTransfer.lines.map(l => ({
          lot_id: l.lotId,
          quantity: l.quantity,
          unit_price: l.unitPrice,
          list_unit_price: l.listUnitPrice
        })),
        p_notes: newTransfer.notes || null,
        p_reason: newTransfer.reason || null,
        p_price_list_id: newTransfer.priceListId || null
      })
      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Tạo yêu cầu chuyển kho thành công!' })
      setShowTransferModal(false)
      setNewTransfer({ fromWarehouse: '', toWarehouse: '', notes: '', reason: '', priceListId: '', lines: [] })
      await reloadTransfers()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Lỗi tạo phiếu chuyển: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Chạy 1 RPC vòng đời rồi nạp lại danh sách — dùng chung cho mọi nút hành động.
  // Trả true nếu thành công (để nơi gọi biết có nên dọn form hay không).
  const runTransferAction = async (
    rpc: string,
    params: Record<string, any>,
    successText: string
  ): Promise<boolean> => {
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc(rpc, params)
      if (error) throw error
      setAlertMsg({ type: 'success', text: successText })
      setShowTransferDetailModal(false)
      await reloadTransfers()
      return true
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: err.message })
      return false
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartTransfer = (transfer: any) =>
    runTransferAction(
      'fn_start_transfer',
      { p_transfer_id: transfer.id, p_user_id: profile?.id },
      'Đã xuất kho. Trạng thái: Đang đi đường.'
    )

  // ⚠️ Bước này KHÔNG còn cộng tồn vào kho đích — chỉ ghi nhận kho đích đã
  // nhận đủ hàng. Hàng chỉ vào sổ khi Admin duyệt (fn_complete_transfer).
  const handleReceiveTransfer = (transfer: any) =>
    runTransferAction(
      'fn_receive_transfer',
      { p_transfer_id: transfer.id, p_user_id: profile?.id },
      'Đã xác nhận nhận hàng. Phiếu đang chờ Admin duyệt để nhập kho.'
    )

  const handleCompleteTransfer = (transfer: any) =>
    runTransferAction(
      'fn_complete_transfer',
      { p_transfer_id: transfer.id },
      'Đã duyệt. Hàng đã nhập kho đích theo giá vốn lô nguồn.'
    )

  const handleRejectTransfer = async (transfer: any) => {
    if (!rejectReason.trim()) {
      setAlertMsg({ type: 'error', text: 'Vui lòng nhập lý do từ chối.' })
      return
    }
    const ok = await runTransferAction(
      'fn_reject_transfer',
      { p_transfer_id: transfer.id, p_reason: rejectReason.trim() },
      'Đã từ chối phiếu. Hàng được hoàn về kho nguồn.'
    )
    // Thất bại thì giữ nguyên lý do đã gõ để admin sửa và thử lại
    if (ok) {
      setRejectingTransfer(false)
      setRejectReason('')
    }
  }

  const handleCancelTransfer = (transfer: any) =>
    runTransferAction(
      'fn_cancel_transfer',
      { p_transfer_id: transfer.id, p_user_id: profile?.id },
      'Đã hủy yêu cầu chuyển kho.'
    )

  // Ai được sửa dòng phiếu: nháp → người lập hoặc admin; đã xuất kho → chỉ admin.
  const canEditTransferLines = (t: any) => {
    if (!t) return false
    if (t.status === 'draft') return isAdmin || t.created_by === profile?.id
    if (t.status === 'in_transit' || t.status === 'received') return isAdmin
    return false
  }

  const startEditingLines = () => {
    const init: Record<string, { quantity: number; unitPrice: number }> = {}
    for (const l of selectedTransferLines) {
      init[l.id] = { quantity: Number(l.quantity), unitPrice: Number(l.unit_price || 0) }
    }
    setLineEdits(init)
    setEditingLines(true)
  }

  const handleSaveLineEdits = async () => {
    const payload = selectedTransferLines
      .filter(l => {
        const e = lineEdits[l.id]
        return e && (e.quantity !== Number(l.quantity) || e.unitPrice !== Number(l.unit_price || 0))
      })
      .map(l => ({ line_id: l.id, quantity: lineEdits[l.id].quantity, unit_price: lineEdits[l.id].unitPrice }))

    if (payload.length === 0) {
      setEditingLines(false)
      return
    }
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('fn_update_transfer_lines', {
        p_transfer_id: selectedTransfer.id,
        p_lines: payload
      })
      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Đã cập nhật phiếu chuyển kho.' })
      setEditingLines(false)
      await fetchTransferDetails(selectedTransfer.id)
      await fetchCostPreview(selectedTransfer.id, selectedTransfer.status)
      await reloadTransfers()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: err.message })
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
      setFetchError(null)
      try {
        if (activeTab === 'lots') {
          // Fetch stock lots — nạp ĐỦ (fetchAllRows) để admin tìm/sửa được mọi lô (>100)
          const restrictBranch = !isAdmin && !!profile?.branch_id
          const data = await fetchAllRows<any>((from, to) => {
            let query = supabase
              .from('stock_lots')
              .select(`
                id,
                lot_number,
                manufacture_date,
                expiry_date,
                cost_price,
                quantity_on_hand,
                quantity_reserved,
                status,
                product:products(
                  id,
                  sku,
                  name,
                  unit,
                  category:product_categories(name)
                ),
                warehouse:warehouses!inner(id, name, branch_id),
                supplier:suppliers(id, name)
              `)
            if (restrictBranch) {
              query = query.eq('warehouse.branch_id', profile!.branch_id)
            }
            return query.order('expiry_date', { ascending: true }).order('id').range(from, to)
          })

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
            quantity_reserved: Number(lot.quantity_reserved || 0),
            status: lot.status,
            product: {
              id: lot.product?.id || '',
              sku: lot.product?.sku || '',
              name: lot.product?.name || 'Sản phẩm không rõ',
              unit: lot.product?.unit || null,
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
              created_at,
              total_amount,
              status,
              notes,
              supplier:suppliers(name),
              warehouse:warehouses!inner(name, branch_id),
              profile:profiles!goods_receipts_received_by_fkey(full_name)
            `)

          if (userRole?.code !== 'admin' && userRole?.code !== 'ceo' && profile?.branch_id) {
            query = query.eq('warehouse.branch_id', profile.branch_id)
          }

          const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(100)

          if (error) throw error

          const formattedReceipts = (data || []).map((gr: any) => ({
            id: gr.id,
            receipt_code: gr.receipt_code,
            receipt_date: gr.receipt_date,
            created_at: gr.created_at,
            total_amount: Number(gr.total_amount),
            status: gr.status || 'draft',
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

          // Fetch products for list creation — nạp ĐỦ (tránh cap 1000)
          const prodData = await fetchAllRows<{ id: string; name: string; sku: string }>((from, to) =>
            supabase.from('products').select('id, name, sku')
              .order('name', { ascending: true }).order('id').range(from, to)
          )
          setProductList(prodData)
        } else if (activeTab === 'transfers') {
          await reloadTransfers()

          // Bảng giá chuyển kho nội bộ do admin dựng ở trang Bảng giá
          const { data: plData } = await supabase
            .from('price_lists')
            .select('id, code, name')
            .eq('is_active', true)
            .eq('usage', 'transfer')
            .order('name')
          setTransferPriceLists(plData || [])
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
        setFetchError(err?.message || 'Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.')
      } finally {
        setLoading(false)
      }
    }
    loadTabData()
  }, [activeTab, lotReloadFlag])

  // Admin: xóa (hủy/hoàn tác) lô hàng
  const handleDeleteLot = async () => {
    if (!deletingLot) return
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('fn_admin_delete_lot', {
        p_lot_id: deletingLot.id,
        p_reason: deleteLotReason || null
      })
      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Đã hủy lô hàng. Tồn kho đã hoàn tác về 0 và ghi thẻ kho.' })
      setDeletingLot(null)
      setDeleteLotReason('')
      setLotReloadFlag(f => f + 1)
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: 'Hủy lô thất bại: ' + (err?.message || '') })
    } finally {
      setSubmitting(false)
    }
  }

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

  // Phân trang (20 dòng/trang) do <DataTable> tự xử lý — không cần state/slice ở đây.

  // ── Dòng "Tổng cộng" của từng bảng (tổng của TẬP ĐANG LỌC) ──
  const lotTotals = useMemo(() => {
    if (filteredLots.length === 0) return undefined
    const u = filteredLots[0].product?.unit
    const uniform = !!u && filteredLots.every(l => l.product?.unit === u)
    return {
      qty: uniform
        ? `${sumBy(filteredLots, l => l.quantity_on_hand).toLocaleString('vi-VN')} ${u}`
        : MIXED_UNIT,
      value: vnd(sumBy(filteredLots, l => l.quantity_on_hand * l.cost_price)),
    }
  }, [filteredLots])

  const poTotals = useMemo(() => (
    filteredPOs.length === 0 ? undefined : { total: vnd(sumBy(filteredPOs, po => po.grand_total)) }
  ), [filteredPOs])

  const receiptTotals = useMemo(() => (
    filteredReceipts.length === 0 ? undefined : { total: vnd(sumBy(filteredReceipts, gr => gr.total_amount)) }
  ), [filteredReceipts])

  const transferTotals = useMemo(() => (
    filteredTransfers.length === 0 ? undefined : { total: vnd(sumBy(filteredTransfers, t => t.total_amount)) }
  ), [filteredTransfers])

  const returnTotals = useMemo(() => (
    filteredReturns.length === 0 ? undefined : { total: vnd(sumBy(filteredReturns, r => r.total_amount)) }
  ), [filteredReturns])

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

  // ─────────────────────────────────────────────────────────────────────────
  // Cấu hình cột chuẩn cho <DataTable> (layout kế thừa toàn cục) — 6 tab
  // ─────────────────────────────────────────────────────────────────────────
  const lotColumns: DataTableColumn<StockLot>[] = [
    {
      key: 'product', header: 'Sản phẩm / SKU', flex: true, minWidth: 220, noTruncate: true,
      render: lot => (
        <div className="min-w-0">
          <p className="font-bold text-gray-800 truncate" title={lot.product.name}>{lot.product.name}</p>
          <span className="text-gray-400 font-mono text-tiny">SKU: {lot.product.sku}</span>
        </div>
      )
    },
    { key: 'wh', header: 'Kho', width: 120, render: lot => <span className="text-[11px] font-semibold text-gray-700" title={lot.warehouse.name}>{lot.warehouse.name}</span> },
    { key: 'lot', header: 'Số lô', width: 110, render: lot => <span className="font-mono font-bold text-blue-500" title={lot.lot_number}>{lot.lot_number}</span> },
    {
      key: 'hsd', header: 'HSD', width: 110, align: 'center', noTruncate: true,
      render: lot => {
        if (!lot.expiry_date) return <span className="text-gray-300 text-[11px]">Không QL</span>
        const isExpired = new Date(lot.expiry_date).getTime() < Date.now()
        const isNear = !isExpired && (new Date(lot.expiry_date).getTime() - Date.now()) / 86400000 <= 30
        return (
          <div className="space-y-0.5">
            <span className="text-[11px]">{new Date(lot.expiry_date).toLocaleDateString('vi-VN')}</span>
            {isExpired && <span className="block text-[10px] text-red-500 font-bold uppercase">Hết hạn</span>}
            {isNear && <span className="block text-[10px] text-amber-500 font-bold uppercase">Cận date</span>}
          </div>
        )
      }
    },
    { key: 'cost', header: 'Giá vốn', width: 116, align: 'right', render: lot => <span className="text-[11px] font-semibold text-gray-700">{lot.cost_price.toLocaleString('vi-VN')} ₫</span> },
    { key: 'qty', header: 'Tồn KD', width: 92, align: 'center', render: lot => <span className="font-bold text-gray-850">{lot.quantity_on_hand}</span> },
    {
      key: 'value', header: 'Giá trị vốn', width: 124, align: 'right',
      render: lot => <span className="text-[11px] font-bold text-[#143C69] tabular-nums">{(lot.quantity_on_hand * lot.cost_price).toLocaleString('vi-VN')} ₫</span>
    },
    {
      key: 'status', header: 'Trạng thái', width: 104, align: 'center', noTruncate: true, mobileHeaderRight: true,
      render: lot => (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
          lot.status === 'active' ? 'bg-emerald-50 text-emerald-700'
            : lot.status === 'quarantine' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-750'
        }`}>
          {lot.status === 'active' ? 'Sẵn dùng' : lot.status === 'quarantine' ? 'Kiểm dịch' : lot.status === 'disposed' ? 'Đã hủy' : 'Khóa'}
        </span>
      )
    }
  ]
  if (isAdmin) {
    lotColumns.push({
      key: 'actions', header: 'Thao tác', width: 84, align: 'center', noTruncate: true,
      render: lot => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => setEditingLot(lot)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Sửa lô"><Pencil size={15} /></button>
          <button onClick={() => { setDeletingLot(lot); setDeleteLotReason('') }} disabled={lot.status === 'disposed'} className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed" title="Hủy lô"><Trash2 size={15} /></button>
        </div>
      )
    })
  }

  const poColumns: DataTableColumn<PurchaseOrder>[] = [
    { key: 'code', header: 'Code', width: 100, render: po => <span className="font-mono font-bold text-blue-500" title={po.po_code}>{po.po_code}</span> },
    { key: 'ncc', header: 'NCC', flex: true, minWidth: 200, render: po => <span className="font-semibold text-gray-800" title={po.supplier.name}>{po.supplier.name}</span> },
    { key: 'wh', header: 'Kho đích', width: 120, render: po => <span className="text-[11px] text-gray-500" title={po.warehouse.name}>{po.warehouse.name}</span> },
    { key: 'expected', header: 'Dự kiến giao', width: 108, align: 'center', render: po => <span className="text-[11px] text-gray-500">{po.expected_date ? new Date(po.expected_date).toLocaleDateString('vi-VN') : '---'}</span> },
    { key: 'total', header: 'Tổng giá trị', width: 120, align: 'right', render: po => <span className="text-[11px] font-bold text-gray-700">{po.grand_total.toLocaleString('vi-VN')} ₫</span> },
    {
      key: 'status', header: 'Trạng thái', width: 110, align: 'center', noTruncate: true, mobileHeaderRight: true,
      render: po => (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
          po.status === 'received' ? 'bg-emerald-50 text-emerald-700'
            : po.status === 'partially_received' ? 'bg-amber-50 text-amber-700'
            : po.status === 'sent' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {po.status === 'draft' ? 'Nháp' : po.status === 'sent' ? 'Chờ nhận' : po.status === 'partially_received' ? 'Nhập một phần' : 'Đã nhận đủ'}
        </span>
      )
    },
    {
      key: 'action', header: '', width: 92, align: 'center', noTruncate: true, hideOnMobile: true,
      render: po => (po.status === 'sent' || po.status === 'partially_received') ? (
        <button onClick={() => navigate(`/goods-receipts/new?po_id=${po.id}`)} className="text-blue-500 hover:text-blue-600 font-bold hover:underline whitespace-nowrap text-[11px]">Nhập kho</button>
      ) : null
    }
  ]

  const receiptColumns: DataTableColumn<GoodsReceipt>[] = [
    { key: 'code', header: 'Code', width: 128, render: gr => <span className="font-mono font-bold text-blue-500 group-hover:underline">{gr.receipt_code}</span> },
    { key: 'ncc', header: 'NCC', flex: true, minWidth: 200, render: gr => <span className="font-semibold text-gray-800" title={gr.supplier.name}>{gr.supplier.name}</span> },
    { key: 'wh', header: 'Kho nhận', width: 124, render: gr => <span className="text-[11px] text-gray-500" title={gr.warehouse.name}>{gr.warehouse.name}</span> },
    {
      key: 'date', header: 'Ngày nhập', width: 138, align: 'center',
      render: gr => <span className="text-[11px] text-gray-500">{new Date(gr.created_at).toLocaleDateString('vi-VN')} <span className="text-gray-400">{new Date(gr.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span></span>
    },
    { key: 'receiver', header: 'Người nhận', width: 120, render: gr => <span className="text-[11px] font-medium text-gray-700" title={gr.profile?.full_name || 'Hệ thống'}>{gr.profile?.full_name || 'Hệ thống'}</span> },
    {
      key: 'status', header: 'Trạng thái', width: 116, align: 'center', noTruncate: true, mobileHeaderRight: true,
      render: gr => <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${(RECEIPT_STATUS[gr.status] || RECEIPT_STATUS.completed).cls}`}>{(RECEIPT_STATUS[gr.status] || RECEIPT_STATUS.completed).label}</span>
    },
    { key: 'total', header: 'Tổng giá trị', width: 128, align: 'right', render: gr => <span className="font-bold text-gray-750 text-[11px]">{gr.total_amount.toLocaleString('vi-VN')} ₫</span> }
  ]

  const transferColumns: DataTableColumn<any>[] = [
    { key: 'code', header: 'Code', width: 110, render: t => <span className="font-mono font-bold text-blue-500 group-hover:underline">{t.transfer_code}</span> },
    { key: 'from', header: 'Kho nguồn', flex: true, minWidth: 150, render: t => <span className="text-[11px] font-semibold text-gray-800" title={t.from_wh?.name || 'Kho nguồn'}>{t.from_wh?.name || 'Kho nguồn'}</span> },
    { key: 'to', header: 'Kho đích', flex: true, minWidth: 150, render: t => <span className="text-[11px] font-semibold text-gray-800" title={t.to_wh?.name || 'Kho đích'}>{t.to_wh?.name || 'Kho đích'}</span> },
    { key: 'date', header: 'Ngày chuyển', width: 108, align: 'center', render: t => <span className="text-[11px] text-gray-500">{new Date(t.transfer_date).toLocaleDateString('vi-VN')}</span> },
    { key: 'creator', header: 'Người tạo', width: 120, render: t => <span className="text-[11px] font-medium text-gray-700" title={t.creator?.full_name || 'Hệ thống'}>{t.creator?.full_name || 'Hệ thống'}</span> },
    { key: 'total', header: 'Tổng giá trị', width: 120, align: 'right', render: t => <span className="text-[11px] font-bold text-gray-700">{t.total_amount ? `${Number(t.total_amount).toLocaleString('vi-VN')} ₫` : '0 ₫'}</span> },
    {
      key: 'status', header: 'Trạng thái', width: 118, align: 'center', noTruncate: true, mobileHeaderRight: true,
      render: t => {
        const s = TRANSFER_STATUS[t.status] || { label: t.status, cls: TRANSFER_STATUS.cancelled.cls }
        return (
          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${s.cls}`}>
            {s.label}
          </span>
        )
      }
    }
  ]

  const returnColumns: DataTableColumn<any>[] = [
    { key: 'code', header: 'Code', width: 110, render: r => <span className="font-mono font-bold text-blue-500 group-hover:underline">{r.return_code}</span> },
    { key: 'ncc', header: 'NCC', flex: true, minWidth: 200, render: r => <span className="font-semibold text-gray-800" title={r.supplier?.name || 'Nhà cung cấp'}>{r.supplier?.name || 'Nhà cung cấp'}</span> },
    { key: 'wh', header: 'Kho trả', width: 120, render: r => <span className="text-[11px] text-gray-500" title={r.warehouse?.name || 'Kho xuất'}>{r.warehouse?.name || 'Kho xuất'}</span> },
    { key: 'refund', header: 'Hoàn tiền', width: 110, align: 'center', render: r => <span className="text-[11px] font-medium capitalize text-gray-700">{r.refund_method === 'cash_refund' ? 'Tiền mặt' : r.refund_method === 'credit_note' ? 'Trừ công nợ' : 'Cấn trừ PO'}</span> },
    { key: 'total', header: 'Tổng giá trị', width: 120, align: 'right', render: r => <span className="text-[11px] font-bold text-gray-700">{Number(r.total_amount || 0).toLocaleString('vi-VN')} ₫</span> },
    {
      key: 'status', header: 'Trạng thái', width: 110, align: 'center', noTruncate: true, mobileHeaderRight: true,
      render: r => (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
          r.status === 'completed' ? 'bg-emerald-50 text-emerald-700'
            : r.status === 'confirmed' ? 'bg-blue-50 text-blue-700'
            : r.status === 'draft' ? 'bg-gray-100 text-gray-500' : 'bg-red-50 text-red-750'
        }`}>
          {r.status === 'draft' ? 'Nháp' : r.status === 'confirmed' ? 'Đã duyệt' : r.status === 'completed' ? 'Hoàn tất' : 'Đã hủy'}
        </span>
      )
    }
  ]

  const settingColumns: DataTableColumn<InventorySetting>[] = [
    {
      key: 'product', header: 'Sản phẩm / SKU', flex: true, minWidth: 220, noTruncate: true,
      render: set => (
        <div className="min-w-0">
          <p className="font-bold text-gray-800 truncate" title={set.product.name}>{set.product.name}</p>
          <span className="text-gray-400 font-mono text-tiny">SKU: {set.product.sku}</span>
        </div>
      )
    },
    { key: 'wh', header: 'Kho áp dụng', width: 150, render: set => <span className="text-[11px] font-semibold text-gray-700" title={set.warehouse.name}>{set.warehouse.name}</span> },
    { key: 'min', header: 'Tồn tối thiểu', width: 110, align: 'center', render: set => <span className="font-bold text-red-500">{set.min_stock_level}</span> },
    { key: 'max', header: 'Tồn tối đa', width: 100, align: 'center', render: set => <span className="font-bold text-gray-700">{set.max_stock_level || '---'}</span> },
    { key: 'reorder', header: 'Điểm đặt lại', width: 110, align: 'center', render: set => <span className="text-gray-500">{set.reorder_point || '---'}</span> },
    {
      key: 'actions', header: 'Hành động', width: 100, align: 'center', noTruncate: true,
      render: set => (
        <div className="flex gap-2 justify-center">
          <button onClick={() => handleOpenEditSetting(set)} className="text-blue-500 hover:text-blue-600 font-semibold text-tiny hover:underline">Sửa</button>
          <button onClick={() => handleDeleteSetting(set.id)} className="text-red-500 hover:text-red-600 font-semibold text-tiny hover:underline">Xóa</button>
        </div>
      )
    }
  ]

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
              className="bg-white text-gray-600 border border-gray-100 px-3 py-2.5 rounded-lg font-semibold text-body-md hover:bg-gray-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus size={16} />
              <span>Tạo đơn PO</span>
            </button>
            <button
              onClick={() => navigate('/goods-receipts/new')}
              className="bg-blue-500 text-white px-3 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
            >
              <WarehouseIcon size={16} />
              <span>Nhập kho thực tế</span>
            </button>
          </div>
        </div>

        {/* Tab Selection Headers */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="flex flex-wrap border-b border-gray-100 px-3">
            <button
              onClick={() => setActiveTab('lots')}
              className={`px-4 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
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
              className={`px-4 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
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
              className={`px-4 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
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
              className={`px-4 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'transfers'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <ArrowRightLeft size={16} />
              <span>Chuyển kho</span>
              {awaitingApprovalCount > 0 && (
                <span
                  title={`${awaitingApprovalCount} phiếu chờ Admin duyệt`}
                  className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center"
                >
                  {awaitingApprovalCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('purchase_returns')}
              className={`px-4 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
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
              className={`px-4 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Settings size={16} />
              <span>Định mức an toàn</span>
            </button>
          </div>

          {/* Lỗi tải dữ liệu — không nuốt lỗi im lặng */}
          {fetchError && !loading && (
            <div className="mx-6 mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-700">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="text-body-md">
                <p className="font-semibold">Không tải được dữ liệu</p>
                <p className="text-tiny text-red-600">{fetchError}</p>
              </div>
            </div>
          )}

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

              {/* Data Table (layout chuẩn dùng chung) */}
              <DataTable
                rows={filteredLots}
                columns={lotColumns}
                getRowKey={lot => lot.id}
                loading={loading}
                card={false}
                pageSize={20}
                itemLabel="lô hàng"
                resetSignal={`${debouncedLotSearch}|${whFilter}|${lotQuickFilter}`}
                emptyText="Không tìm thấy lô hàng nào"
                emptyIcon={<Layers className="w-12 h-12 text-gray-300 mx-auto" />}
                totals={lotTotals}
                totalsLabel={`Tổng ${filteredLots.length} lô đang lọc`}
              />
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

              {/* Data Table (layout chuẩn dùng chung) */}
              <DataTable
                rows={filteredPOs}
                columns={poColumns}
                getRowKey={po => po.id}
                loading={loading}
                card={false}
                pageSize={20}
                itemLabel="đơn đặt hàng"
                resetSignal={`${debouncedPoSearch}|${poStatusFilter}`}
                emptyText="Không tìm thấy đơn hàng nào"
                emptyIcon={<FileText className="w-12 h-12 text-gray-300 mx-auto" />}
                totals={poTotals}
                totalsLabel={`Tổng ${filteredPOs.length} đơn đặt`}
              />
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

              {/* Data Table (layout chuẩn dùng chung) */}
              <DataTable
                rows={filteredReceipts}
                columns={receiptColumns}
                getRowKey={gr => gr.id}
                loading={loading}
                card={false}
                pageSize={20}
                itemLabel="phiếu nhập"
                resetSignal={debouncedReceiptSearch}
                onRowClick={gr => navigate(`/goods-receipts/${gr.id}`)}
                totals={receiptTotals}
                totalsLabel={`Tổng ${filteredReceipts.length} phiếu nhập`}
                emptyText="Không tìm thấy phiếu nhập kho nào"
                emptyIcon={<WarehouseIcon className="w-12 h-12 text-gray-300 mx-auto" />}
              />
            </div>
          )}

          {/* TAB CONTENT: STOCK TRANSFERS */}
          {activeTab === 'transfers' && (
            <div className="p-6 space-y-6">
              {/* Header inside Tab */}
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                      type="text"
                      placeholder="Tìm mã chuyển kho, tên kho..."
                      value={transferSearchTerm}
                      onChange={(e) => setTransferSearchTerm(e.target.value)}
                      className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <select
                    value={transferStatusFilter}
                    onChange={(e) => setTransferStatusFilter(e.target.value)}
                    className="h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">Tất cả trạng thái</option>
                    {Object.entries(TRANSFER_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setShowTransferModal(true)}
                  className="bg-blue-500 text-white px-3 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all w-full md:w-auto"
                >
                  <ArrowRightLeft size={16} />
                  <span>Tạo yêu cầu chuyển kho</span>
                </button>
              </div>

              {/* Hàng đã rời kho nguồn nhưng CHƯA vào sổ kho đích — điểm mù của
                  báo cáo định giá tồn kho, nên nêu rõ ngay trên tab. */}
              {transferPending && (transferPending.in_transit_count > 0 || transferPending.awaiting_count > 0) && (
                <div className="flex flex-col sm:flex-row gap-3">
                  {transferPending.in_transit_count > 0 && (
                    <div className="flex-1 flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                      <ArrowRightLeft size={18} className="text-amber-600 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-body-md font-bold text-amber-800">
                          {transferPending.in_transit_count} phiếu đang đi đường
                        </p>
                        <p className="text-tiny text-amber-700">
                          Vốn kho nguồn {Number(transferPending.in_transit_cost).toLocaleString('vi-VN')} ₫ chưa nằm ở kho nào
                        </p>
                      </div>
                    </div>
                  )}
                  {transferPending.awaiting_count > 0 && (
                    <button
                      onClick={() => setTransferStatusFilter('received')}
                      className="flex-1 flex items-center gap-3 bg-violet-50 border border-violet-100 rounded-lg px-4 py-3 text-left hover:bg-violet-100 transition-colors"
                    >
                      <Clock size={18} className="text-violet-600 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-body-md font-bold text-violet-800">
                          {transferPending.awaiting_count} phiếu chờ Admin duyệt
                        </p>
                        <p className="text-tiny text-violet-700">
                          Vốn kho nguồn {Number(transferPending.awaiting_cost).toLocaleString('vi-VN')} ₫ — duyệt xong mới nhập kho đích
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              )}

              {/* Data Table (layout chuẩn dùng chung) */}
              <DataTable
                rows={filteredTransfers}
                columns={transferColumns}
                getRowKey={t => t.id}
                loading={loading}
                card={false}
                pageSize={20}
                itemLabel="phiếu chuyển"
                resetSignal={`${debouncedTransferSearch}|${transferStatusFilter}`}
                onRowClick={t => {
                  setSelectedTransfer(t)
                  fetchTransferDetails(t.id)
                  fetchCostPreview(t.id, t.status)
                  setRejectingTransfer(false)
                  setRejectReason('')
                  setEditingLines(false)
                  setLineEdits({})
                  setShowTransferDetailModal(true)
                }}
                emptyText="Không tìm thấy phiếu chuyển kho nào"
                emptyIcon={<ArrowRightLeft className="w-12 h-12 text-gray-300 mx-auto" />}
                totals={transferTotals}
                totalsLabel={`Tổng ${filteredTransfers.length} phiếu chuyển`}
              />
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
                  className="bg-blue-500 text-white px-3 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all w-full md:w-auto"
                >
                  <RotateCcw size={16} />
                  <span>Tạo phiếu trả hàng NCC</span>
                </button>
              </div>

              {/* Data Table (layout chuẩn dùng chung) */}
              <DataTable
                rows={filteredReturns}
                columns={returnColumns}
                getRowKey={r => r.id}
                loading={loading}
                card={false}
                pageSize={20}
                itemLabel="phiếu trả"
                resetSignal={debouncedReturnSearch}
                onRowClick={r => { setSelectedReturn(r); fetchReturnDetails(r.id); setShowReturnDetailModal(true) }}
                emptyText="Không tìm thấy phiếu trả hàng nào"
                emptyIcon={<RotateCcw className="w-12 h-12 text-gray-300 mx-auto" />}
                totals={returnTotals}
                totalsLabel={`Tổng ${filteredReturns.length} phiếu trả`}
              />
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

              {/* Data Table (layout chuẩn dùng chung) */}
              <DataTable
                rows={invSettings}
                columns={settingColumns}
                getRowKey={set => set.id}
                loading={loading}
                card={false}
                pageSize={20}
                itemLabel="định mức"
                resetSignal={invSettings.length}
                emptyText="Chưa cấu hình định mức an toàn nào"
                emptyIcon={<AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-2" />}
              />
            </div>
          )}
        </div>

      </div>

      {/* Drawer Cài đặt định mức tồn kho */}
      {isEditingSetting && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <div>
                <h3 className="text-base font-bold text-gray-800">
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
                <SmartSearchSelect
                  options={productListOptions}
                  value={newSetting.productId}
                  onChange={(val) => setNewSetting({ ...newSetting, productId: val })}
                  disabled={!!editingSettingId}
                  placeholder="-- Chọn sản phẩm --"
                  searchPlaceholder="Tìm theo tên/SKU..."
                />
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
                  <DecimalInput
                    value={newSetting.minStock}
                    onChange={(v) => setNewSetting({ ...newSetting, minStock: v })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tồn tối đa (Max)</label>
                  <DecimalInput
                    value={newSetting.maxStock}
                    onChange={(v) => setNewSetting({ ...newSetting, maxStock: v })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Điểm đặt hàng lại</label>
                  <DecimalInput
                    value={newSetting.reorderPoint}
                    onChange={(v) => setNewSetting({ ...newSetting, reorderPoint: v })}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">SL đặt lại gợi ý</label>
                  <DecimalInput
                    value={newSetting.reorderQty ?? 0}
                    blankZero
                    placeholder="Tùy chọn"
                    onChange={(v) => setNewSetting({ ...newSetting, reorderQty: v > 0 ? v : null })}
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
          <div className="bg-white w-full max-w-6xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
              <div>
                <h3 className="text-base font-bold text-gray-800">Tạo yêu cầu chuyển kho</h3>
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
            <form onSubmit={handleCreateTransfer} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
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

              {/* Bảng giá nội bộ + lý do chuyển */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Bảng giá chuyển kho nội bộ</label>
                  <div className="flex gap-2">
                    <select
                      value={newTransfer.priceListId}
                      onChange={(e) => setNewTransfer({ ...newTransfer, priceListId: e.target.value })}
                      className="flex-1 h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="">-- Không dùng bảng giá --</option>
                      {transferPriceLists.map(pl => (
                        <option key={pl.id} value={pl.id}>{pl.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!newTransfer.priceListId || newTransfer.lines.length === 0 || applyingPrices}
                      onClick={() => applyTransferPriceList(newTransfer.priceListId)}
                      title="Điền đơn giá cho tất cả dòng theo bảng giá đã chọn"
                      className="h-10 px-4 rounded-lg text-body-md font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      {applyingPrices ? 'Đang áp...' : 'Áp giá'}
                    </button>
                  </div>
                  {transferPriceLists.length === 0 && (
                    <p className="text-tiny text-gray-400 italic">
                      Chưa có bảng giá nội bộ. Admin tạo ở trang Bảng giá → “Tạo bảng giá” → Chuyển kho nội bộ.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Lý do chuyển</label>
                  <input
                    value={newTransfer.reason}
                    onChange={(e) => setNewTransfer({ ...newTransfer, reason: e.target.value })}
                    placeholder="VD: Cân đối tồn, chi nhánh thiếu hàng bán..."
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Add item to transfer */}
              {newTransfer.fromWarehouse && (
                <div className="bg-gray-25 border border-gray-100 rounded-lg p-4 space-y-4">
                  <h4 className="text-body-md font-bold text-gray-700">Thêm sản phẩm từ kho nguồn</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Chọn lô hàng</label>
                      <SmartSearchSelect
                        options={transferLotOptions}
                        value={modalLotId}
                        onChange={async (val) => {
                          setModalLotId(val);
                          const lot = lotsForTransfer.find((l: any) => l.id === val);
                          if (!lot) return;
                          // Ưu tiên giá từ bảng giá nội bộ; không có thì lấy giá vốn lô
                          let price = lot.cost_price;
                          if (newTransfer.priceListId && lot.product_id) {
                            const { data } = await supabase
                              .from('price_list_items')
                              .select('selling_price')
                              .eq('price_list_id', newTransfer.priceListId)
                              .eq('product_id', lot.product_id)
                              .is('variant_id', null)
                              .order('min_quantity', { ascending: true })
                              .limit(1)
                              .maybeSingle();
                            if (data?.selling_price != null) price = Number(data.selling_price);
                          }
                          setModalUnitPrice(price);
                        }}
                        placeholder="-- Chọn lô hàng còn tồn --"
                        searchPlaceholder="Tìm kiếm lô hàng..."
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Số lượng chuyển</label>
                      <DecimalInput
                        value={modalQty}
                        onChange={(v) => setModalQty(v)}
                        className="w-full h-11 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Đơn giá chuyển (₫)</label>
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
                            if (modalQty <= 0) {
                              setAlertMsg({ type: 'error', text: 'Số lượng chuyển phải lớn hơn 0.' });
                              return;
                            }
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
                              lotNumber: lot.lot_number,
                              listUnitPrice: modalUnitPrice
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
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-500 font-bold text-[11px] uppercase">
                        <th className="px-4 py-2">Sản phẩm / SKU</th>
                        <th className="px-4 py-2">Số lô</th>
                        <th className="px-4 py-2 text-center w-24">Số lượng</th>
                        <th className="px-4 py-2 text-right w-32">Vốn kho nguồn</th>
                        <th className="px-4 py-2 text-right w-36">Đơn giá chuyển</th>
                        <th className="px-4 py-2 text-right w-32">Thành tiền</th>
                        <th className="px-4 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-[13px] text-gray-600">
                      {newTransfer.lines.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-gray-400 italic">Chưa chọn sản phẩm nào. Vui lòng thêm từ form ở trên.</td>
                        </tr>
                      ) : (
                        newTransfer.lines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-gray-25/30">
                            <td className="px-3 py-2.5">
                              <p className="font-bold text-gray-700">{line.name}</p>
                              <span className="text-gray-455 font-mono text-tiny">SKU: {line.sku}</span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-blue-500 font-semibold">{line.lotNumber}</td>
                            <td className="px-3 py-2.5 text-center">
                              <DecimalInput
                                value={line.quantity}
                                max={line.maxQty}
                                onChange={(val) => {
                                  const updated = [...newTransfer.lines]
                                  updated[idx] = { ...line, quantity: val }
                                  setNewTransfer({ ...newTransfer, lines: updated })
                                }}
                                className="w-20 text-center h-8 border border-gray-100 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-800"
                              />
                            </td>
                            {/* Giá vốn của bên BÁN — chỉ để đối chiếu biên nội bộ,
                                không ghi sổ. Giá vốn bên MUA là đơn giá chuyển. */}
                            <td className="px-3 py-2.5 text-right">
                              <span className="text-gray-500">{line.costPrice?.toLocaleString('vi-VN')} ₫</span>
                              {line.unitPrice > 0 && line.costPrice > 0 && (
                                <span className={`block text-[10px] font-semibold ${
                                  line.unitPrice >= line.costPrice ? 'text-emerald-600' : 'text-red-500'
                                }`}>
                                  {line.unitPrice >= line.costPrice ? '+' : ''}
                                  {Math.round((line.unitPrice - line.costPrice) / line.costPrice * 1000) / 10}%
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={line.unitPrice}
                                onChange={(e) => {
                                  const val = Math.max(0, parseFloat(e.target.value) || 0)
                                  const updated = [...newTransfer.lines]
                                  updated[idx] = { ...line, unitPrice: val }
                                  setNewTransfer({ ...newTransfer, lines: updated })
                                }}
                                className="w-28 text-right h-8 px-2 border border-gray-100 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-850"
                              />
                              {line.listUnitPrice > 0 && line.unitPrice !== line.listUnitPrice && (
                                <span className="block text-[10px] text-indigo-500 mt-0.5">
                                  bảng giá: {line.listUnitPrice.toLocaleString('vi-VN')} ₫
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-bold text-gray-800">
                              {(line.quantity * (line.unitPrice || 0)).toLocaleString('vi-VN')} ₫
                            </td>
                            <td className="px-3 py-2.5 text-center">
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

                {newTransfer.lines.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 px-1">
                    <span className="text-body-md text-gray-500">
                      Vốn kho nguồn: <strong className="text-gray-700">
                        {newTransfer.lines.reduce((s, l) => s + l.quantity * (l.costPrice || 0), 0).toLocaleString('vi-VN')} ₫
                      </strong>
                    </span>
                    <span className="text-body-md text-gray-500">
                      Tổng giá trị chuyển: <strong className="text-body-lg text-gray-800">
                        {newTransfer.lines.reduce((s, l) => s + l.quantity * (l.unitPrice || 0), 0).toLocaleString('vi-VN')} ₫
                      </strong>
                    </span>
                  </div>
                )}

                <p className="text-tiny text-gray-500 bg-gray-25 border border-gray-100 rounded-lg px-3 py-2 leading-relaxed">
                  <strong className="text-gray-700">Đơn giá chuyển sẽ trở thành giá vốn của kho đích</strong> (bình quân gia quyền
                  với tồn sẵn có), vì mỗi chi nhánh hạch toán độc lập. Cột “Vốn kho nguồn” chỉ để đối chiếu biên nội bộ.
                  Admin sẽ thấy giá vốn mới ở kho đích khi duyệt phiếu.
                </p>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">Ghi chú</label>
                <textarea
                  value={newTransfer.notes}
                  onChange={(e) => setNewTransfer({ ...newTransfer, notes: e.target.value })}
                  placeholder="Tài xế vận chuyển, biển số xe, người áp tải..."
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
                    setNewTransfer({ fromWarehouse: '', toWarehouse: '', notes: '', reason: '', priceListId: '', lines: [] });
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
          <div className="bg-white w-full max-w-6xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
              <div>
                <h3 className="text-base font-bold text-gray-800">Chi tiết yêu cầu chuyển kho</h3>
                <p className="text-[11px] text-blue-500 font-bold font-mono">{selectedTransfer.transfer_code}</p>
              </div>
              <button
                onClick={() => setShowTransferDetailModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Metadata details */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-2.5 bg-gray-25/55 border border-gray-100 rounded-lg p-3 text-[13px] text-gray-600">
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Kho nguồn</span>
                  <span className="font-semibold text-gray-800">{selectedTransfer.from_wh?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Kho đích</span>
                  <span className="font-semibold text-gray-800">{selectedTransfer.to_wh?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Ngày tạo</span>
                  <span className="font-medium">{new Date(selectedTransfer.transfer_date).toLocaleDateString('vi-VN')}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Trạng thái</span>
                  <span className={`px-2 py-0.5 rounded border text-[11px] font-bold uppercase ${
                    (TRANSFER_STATUS[selectedTransfer.status] || TRANSFER_STATUS.cancelled).cls
                  }`}>
                    {(TRANSFER_STATUS[selectedTransfer.status] || { label: selectedTransfer.status }).label}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Người lập phiếu</span>
                  <span className="font-medium text-gray-700">{selectedTransfer.creator?.full_name || 'Hệ thống'}</span>
                </div>
                {selectedTransfer.received_by && (
                  <div>
                    <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Kho đích xác nhận nhận</span>
                    <span className="font-medium text-gray-700">{selectedTransfer.receiver?.full_name || 'Hệ thống'}</span>
                    {selectedTransfer.received_at && (
                      <span className="block text-[10px] text-gray-400">
                        {new Date(selectedTransfer.received_at).toLocaleString('vi-VN')}
                      </span>
                    )}
                  </div>
                )}
                {selectedTransfer.approved_by && (
                  <div>
                    <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Admin duyệt</span>
                    <span className="font-medium text-emerald-700">{selectedTransfer.approver?.full_name || 'Hệ thống'}</span>
                    {selectedTransfer.approved_at && (
                      <span className="block text-[10px] text-gray-400">
                        {new Date(selectedTransfer.approved_at).toLocaleString('vi-VN')}
                      </span>
                    )}
                  </div>
                )}
                {selectedTransfer.rejected_by && (
                  <div>
                    <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Admin từ chối</span>
                    <span className="font-medium text-red-700">{selectedTransfer.rejecter?.full_name || 'Hệ thống'}</span>
                    {selectedTransfer.rejected_at && (
                      <span className="block text-[10px] text-gray-400">
                        {new Date(selectedTransfer.rejected_at).toLocaleString('vi-VN')}
                      </span>
                    )}
                  </div>
                )}
                {selectedTransfer.price_list?.name && (
                  <div>
                    <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Bảng giá áp dụng</span>
                    <span className="font-medium text-indigo-700">{selectedTransfer.price_list.name}</span>
                  </div>
                )}
                {selectedTransfer.reason && (
                  <div className="col-span-full">
                    <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Lý do chuyển</span>
                    <span className="text-gray-700">{selectedTransfer.reason}</span>
                  </div>
                )}
                {selectedTransfer.reject_reason && (
                  <div className="col-span-full bg-red-50 border border-red-100 rounded px-2 py-1.5">
                    <span className="text-red-500 block text-[11px] leading-none mb-0.5 font-semibold">Lý do từ chối</span>
                    <span className="text-red-700">{selectedTransfer.reject_reason}</span>
                  </div>
                )}
                <div className="col-span-full border-t border-gray-100/50 pt-2 mt-0.5">
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Ghi chú</span>
                  <span className="text-gray-700 italic">{selectedTransfer.notes || 'Không có ghi chú'}</span>
                </div>
              </div>

              {/* Nhắc rõ hàng đã rời kho nguồn nhưng CHƯA vào sổ kho đích */}
              {(selectedTransfer.status === 'in_transit' || selectedTransfer.status === 'received') && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-[12px] text-amber-800">
                  <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Hàng đã trừ khỏi <strong>{selectedTransfer.from_wh?.name}</strong> nhưng chưa nhập vào{' '}
                    <strong>{selectedTransfer.to_wh?.name}</strong>
                    {selectedTransfer.status === 'received'
                      ? ' — đang chờ Admin duyệt để vào sổ.'
                      : ' — chờ kho đích xác nhận đã nhận đủ.'}
                  </span>
                </div>
              )}

              {/* Items Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h4 className="text-body-md font-bold text-gray-750">Sản phẩm luân chuyển</h4>
                  {canEditTransferLines(selectedTransfer) && (
                    editingLines ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingLines(false); setLineEdits({}) }}
                          disabled={submitting}
                          className="h-8 px-3 border border-gray-100 rounded-lg text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Hủy sửa
                        </button>
                        <button
                          onClick={handleSaveLineEdits}
                          disabled={submitting}
                          className="h-8 px-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-[12px] font-semibold disabled:opacity-50"
                        >
                          {submitting ? 'Đang lưu...' : 'Lưu thay đổi'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={startEditingLines}
                        className="h-8 px-3 border border-blue-100 bg-blue-50 text-blue-700 rounded-lg text-[12px] font-semibold hover:bg-blue-100 flex items-center gap-1.5"
                      >
                        <Pencil size={13} />
                        Sửa số lượng / đơn giá
                      </button>
                    )
                  )}
                </div>

                {editingLines && selectedTransfer.status !== 'draft' && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-[12px] text-amber-800">
                    <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                    <span>
                      Hàng đã xuất khỏi kho nguồn. Giảm số lượng sẽ <strong>trả phần chênh về lại lô ở
                      {' '}{selectedTransfer.from_wh?.name}</strong>, tăng thì trừ thêm — đều được ghi thẻ kho.
                      Đặt số lượng = 0 để bỏ hẳn dòng đó.
                    </span>
                  </div>
                )}
                <div className="border border-gray-100 rounded-lg overflow-x-auto tbl-x">
                  <table className="w-full min-w-[680px] text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-[11px] uppercase">
                        <th className="px-3 py-2.5 min-w-[200px]">Sản phẩm / SKU</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Số lô</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Hạn sử dụng</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Số lượng</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Vốn kho nguồn</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Đơn giá chuyển</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-[13px] text-gray-600">
                      {selectedTransferLines.map((line) => {
                        // Giá vốn bên BÁN (đối chiếu biên nội bộ). Giá vốn bên MUA
                        // là đơn giá chuyển ở cột kế bên.
                        const bookCost = line.source_cost_price ?? line.lot?.cost_price;
                        const listPrice = line.list_unit_price;
                        const edited = listPrice != null && Number(listPrice) !== Number(line.unit_price || 0);
                        return (
                          <tr key={line.id} className="hover:bg-gray-25/30">
                            <td className="px-3 py-2.5 min-w-[200px]">
                              <p className="font-bold text-gray-700 break-words">{line.product?.name}</p>
                              <span className="text-[11px] text-gray-400 font-mono">SKU: {line.product?.sku}</span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-blue-500 font-semibold whitespace-nowrap">{line.lot?.lot_number || 'N/A'}</td>
                            <td className="px-3 py-2.5 text-center text-gray-500 whitespace-nowrap">
                              {line.lot?.expiry_date ? new Date(line.lot.expiry_date).toLocaleDateString('vi-VN') : '---'}
                            </td>
                            <td className="px-3 py-2.5 text-center font-bold text-gray-800 whitespace-nowrap">
                              {editingLines ? (
                                <DecimalInput
                                  value={lineEdits[line.id]?.quantity ?? Number(line.quantity)}
                                  onChange={(v) => setLineEdits(p => ({ ...p, [line.id]: { ...p[line.id], quantity: v } }))}
                                  className="w-20 text-center h-8 border border-blue-200 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-800"
                                />
                              ) : (
                                <>{line.quantity} {line.product?.unit}</>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              <span className="text-gray-500">
                                {bookCost != null ? `${Number(bookCost).toLocaleString('vi-VN')} ₫` : '---'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                              {editingLines ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={lineEdits[line.id]?.unitPrice ?? Number(line.unit_price || 0)}
                                  onChange={(e) => setLineEdits(p => ({
                                    ...p,
                                    [line.id]: { ...p[line.id], unitPrice: Math.max(0, parseFloat(e.target.value) || 0) }
                                  }))}
                                  className="w-28 text-right h-8 px-2 border border-blue-200 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-850"
                                />
                              ) : (
                                <>
                                  <span>{Number(line.unit_price || 0).toLocaleString('vi-VN')} ₫</span>
                                  {edited && (
                                    <span className="block text-[10px] text-indigo-500" title="Đã sửa lệch khỏi bảng giá">
                                      bảng giá: {Number(listPrice).toLocaleString('vi-VN')} ₫
                                    </span>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-bold text-gray-800 whitespace-nowrap">
                              {editingLines
                                ? ((lineEdits[line.id]?.quantity ?? Number(line.quantity)) *
                                   (lineEdits[line.id]?.unitPrice ?? Number(line.unit_price || 0))).toLocaleString('vi-VN')
                                : Number((line.unit_price || 0) * line.quantity).toLocaleString('vi-VN')} ₫
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {selectedTransferLines.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 p-2">
                    <span className="text-body-md text-gray-500">
                      Vốn kho nguồn: <strong className="text-gray-700">
                        {selectedTransferLines
                          .reduce((sum, l) => sum + l.quantity * Number(l.source_cost_price ?? l.lot?.cost_price ?? 0), 0)
                          .toLocaleString('vi-VN')} ₫
                      </strong>
                    </span>
                    <span className="text-body-md text-gray-500">
                      Tổng giá trị chuyển: <strong className="text-body-lg text-gray-800">
                        {selectedTransferLines
                          .reduce((sum, l) => sum + l.quantity * Number(l.unit_price || 0), 0)
                          .toLocaleString('vi-VN')} ₫
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Giá vốn kho đích SAU khi duyệt — cơ sở để Admin chốt giá bán
                  cho chi nhánh nhận. Đây là mục đích chính của bước duyệt. */}
              {selectedTransfer.status === 'received' && isAdmin && costPreview.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-body-md font-bold text-gray-750">
                    Giá vốn tại {selectedTransfer.to_wh?.name} sau khi duyệt
                  </h4>
                  <div className="border border-emerald-100 bg-emerald-50/30 rounded-lg overflow-x-auto tbl-x">
                    <table className="w-full min-w-[640px] text-left border-collapse">
                      <thead>
                        <tr className="bg-emerald-50 border-b border-emerald-100 text-emerald-800 font-semibold text-[11px] uppercase">
                          <th className="px-3 py-2.5 min-w-[180px]">Sản phẩm</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Vốn kho nguồn</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Đơn giá chuyển</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Tồn sẵn ở kho đích</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Giá vốn MỚI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-100/60 text-[13px] text-gray-600">
                        {costPreview.map((r: any) => {
                          const before = Number(r.dest_cost_before || 0)
                          const after = Number(r.dest_cost_after || 0)
                          const delta = before > 0 ? Math.round((after - before) / before * 1000) / 10 : null
                          return (
                            <tr key={r.line_id}>
                              <td className="px-3 py-2.5 min-w-[180px]">
                                <p className="font-bold text-gray-700 break-words">{r.product_name}</p>
                                <span className="text-[11px] text-gray-400 font-mono">SKU: {r.sku}</span>
                              </td>
                              <td className="px-3 py-2.5 text-right text-gray-500 whitespace-nowrap">
                                {Number(r.source_cost || 0).toLocaleString('vi-VN')} ₫
                              </td>
                              <td className="px-3 py-2.5 text-right font-semibold text-gray-800 whitespace-nowrap">
                                {Number(r.transfer_price || 0).toLocaleString('vi-VN')} ₫
                              </td>
                              <td className="px-3 py-2.5 text-right text-gray-500 whitespace-nowrap">
                                {Number(r.dest_qty_before || 0) > 0
                                  ? <>{Number(r.dest_qty_before).toLocaleString('vi-VN')} × {before.toLocaleString('vi-VN')} ₫</>
                                  : <span className="italic text-gray-400">chưa có</span>}
                              </td>
                              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                <span className="font-bold text-emerald-700">{after.toLocaleString('vi-VN')} ₫</span>
                                {delta !== null && delta !== 0 && (
                                  <span className={`block text-[10px] font-semibold ${delta > 0 ? 'text-amber-600' : 'text-blue-500'}`}>
                                    {delta > 0 ? '+' : ''}{delta}% so với hiện tại
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-tiny text-gray-500 leading-relaxed">
                    Duyệt xong, đây là giá vốn mà <strong className="text-gray-700">{selectedTransfer.to_wh?.name}</strong> dùng
                    để tính lãi lỗ. Cân nhắc con số này trước khi chốt giá bán cho chi nhánh.
                  </p>
                </div>
              )}

              {/* Ô nhập lý do từ chối (chỉ hiện khi admin bấm Từ chối) */}
              {rejectingTransfer && selectedTransfer.status === 'received' && (
                <div className="space-y-1.5 bg-red-50 border border-red-100 rounded-lg p-3">
                  <label className="block text-body-md font-semibold text-red-700">
                    Lý do từ chối <span className="text-red-500">*</span>
                  </label>
                  <input
                    autoFocus
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="VD: Thiếu 3 hộp so với phiếu, hàng móp vỡ khi nhận..."
                    className="w-full h-10 px-3 border border-red-100 rounded-lg text-body-md bg-white focus:outline-none focus:border-red-500"
                  />
                  <p className="text-tiny text-red-600">
                    Từ chối sẽ hoàn toàn bộ số lượng về kho <strong>{selectedTransfer.from_wh?.name}</strong>.
                  </p>
                </div>
              )}

              {/* Transition actions — ẩn khi đang sửa dòng để không bấm nhầm
                  khi thay đổi chưa lưu */}
              <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-100">
                <button
                  onClick={() => {
                    setShowTransferDetailModal(false)
                    setRejectingTransfer(false); setRejectReason('')
                    setEditingLines(false); setLineEdits({})
                  }}
                  className="flex-1 min-w-[100px] h-10 border border-gray-100 rounded-lg text-body-md font-semibold hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Đóng
                </button>

                {!editingLines && selectedTransfer.status === 'draft' && (
                  <>
                    <button
                      onClick={() => handleCancelTransfer(selectedTransfer)}
                      disabled={submitting}
                      className="bg-red-50 text-red-650 hover:bg-red-100 h-10 px-4 rounded-lg text-body-md font-semibold transition-colors disabled:opacity-50"
                    >
                      Hủy yêu cầu
                    </button>
                    <button
                      onClick={() => handleStartTransfer(selectedTransfer)}
                      disabled={submitting}
                      className="flex-1 min-w-[180px] bg-blue-500 hover:bg-blue-600 text-white h-10 rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <ArrowRightLeft size={16} />
                      <span>Xuất kho &amp; bắt đầu chuyển</span>
                    </button>
                  </>
                )}

                {!editingLines && selectedTransfer.status === 'in_transit' && (
                  <>
                    <button
                      onClick={() => handleCancelTransfer(selectedTransfer)}
                      disabled={submitting}
                      className="bg-red-50 text-red-650 hover:bg-red-100 h-10 px-4 rounded-lg text-body-md font-semibold transition-colors disabled:opacity-50"
                    >
                      Hủy yêu cầu
                    </button>
                    <button
                      onClick={() => handleReceiveTransfer(selectedTransfer)}
                      disabled={submitting}
                      className="flex-1 min-w-[180px] bg-violet-500 hover:bg-violet-600 text-white h-10 rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} />
                      <span>Xác nhận đã nhận đủ</span>
                    </button>
                  </>
                )}

                {/* Bước cuối: CHỈ Admin/CEO. Duyệt xong hàng mới vào sổ kho đích. */}
                {!editingLines && selectedTransfer.status === 'received' && (
                  isAdmin ? (
                    <>
                      {rejectingTransfer ? (
                        <>
                          <button
                            onClick={() => { setRejectingTransfer(false); setRejectReason('') }}
                            disabled={submitting}
                            className="h-10 px-4 border border-gray-100 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                          >
                            Quay lại
                          </button>
                          <button
                            onClick={() => handleRejectTransfer(selectedTransfer)}
                            disabled={submitting || !rejectReason.trim()}
                            className="flex-1 min-w-[180px] bg-red-500 hover:bg-red-600 text-white h-10 rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <Ban size={16} />
                            <span>Xác nhận từ chối</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setRejectingTransfer(true)}
                            disabled={submitting}
                            className="bg-red-50 text-red-650 hover:bg-red-100 h-10 px-4 rounded-lg text-body-md font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            <Ban size={15} />
                            Từ chối
                          </button>
                          <button
                            onClick={() => handleCompleteTransfer(selectedTransfer)}
                            disabled={submitting}
                            className="flex-1 min-w-[200px] bg-emerald-500 hover:bg-emerald-600 text-white h-10 rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <CheckCircle2 size={16} />
                            <span>Duyệt &amp; nhập kho đích</span>
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="flex-1 min-w-[200px] h-10 rounded-lg bg-violet-50 border border-violet-100 text-violet-700 text-body-md font-semibold flex items-center justify-center gap-2">
                      <Clock size={15} />
                      Chờ Admin duyệt
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tạo phiếu trả hàng NCC */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-6xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-155 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
              <div>
                <h3 className="text-base font-bold text-gray-800">Tạo phiếu xuất trả nhà cung cấp</h3>
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
            <form onSubmit={handleCreateReturn} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
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
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Chọn lô hàng trong kho</label>
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
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Số lượng trả</label>
                      <DecimalInput
                        value={modalQty}
                        onChange={(v) => setModalQty(v)}
                        className="w-full h-11 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Đơn giá trả (₫)</label>
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
                            if (modalQty <= 0) {
                              setAlertMsg({ type: 'error', text: 'Số lượng trả phải lớn hơn 0.' });
                              return;
                            }
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
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-500 font-bold text-[11px] uppercase">
                        <th className="px-4 py-2">Sản phẩm / SKU</th>
                        <th className="px-4 py-2">Số lô</th>
                        <th className="px-4 py-2 text-center">Số lượng</th>
                        <th className="px-4 py-2 text-right">Đơn giá trả</th>
                        <th className="px-4 py-2 text-right">Thành tiền</th>
                        <th className="px-4 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-[13px] text-gray-600">
                      {newReturn.lines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-gray-400 italic">Chưa chọn sản phẩm nào. Vui lòng thêm từ form ở trên.</td>
                        </tr>
                      ) : (
                        newReturn.lines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-gray-25/30">
                            <td className="px-3 py-2.5">
                              <p className="font-bold text-gray-700">{line.name}</p>
                              <div className="flex gap-2 items-center text-tiny">
                                <span className="text-gray-455 font-mono">SKU: {line.sku}</span>
                                <span className="text-gray-300">|</span>
                                <span className="text-amber-600 font-medium">Gốc: {line.costPrice?.toLocaleString('vi-VN')} ₫</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-blue-500 font-semibold">{line.lotNumber}</td>
                            <td className="px-3 py-2.5 text-center">
                              <DecimalInput
                                value={line.quantity}
                                max={line.maxQty}
                                onChange={(val) => {
                                  const updated = [...newReturn.lines]
                                  updated[idx] = { ...line, quantity: val }
                                  setNewReturn({ ...newReturn, lines: updated })
                                }}
                                className="w-20 text-center h-8 border border-gray-100 rounded focus:outline-none focus:border-blue-500 font-bold text-gray-800"
                              />
                            </td>
                            <td className="px-3 py-2.5 text-right">
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
                            <td className="px-3 py-2.5 text-right font-bold text-gray-800">
                              {(line.quantity * line.unitPrice).toLocaleString('vi-VN')} ₫
                            </td>
                            <td className="px-3 py-2.5 text-center">
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
          <div className="bg-white w-full max-w-6xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-155 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
              <div>
                <h3 className="text-base font-bold text-gray-800">Chi tiết phiếu xuất trả NCC</h3>
                <p className="text-[11px] text-blue-500 font-bold font-mono">{selectedReturn.return_code}</p>
              </div>
              <button
                onClick={() => setShowReturnDetailModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Metadata details */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-2.5 bg-gray-25/55 border border-gray-100 rounded-lg p-3 text-[13px] text-gray-600">
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Nhà cung cấp</span>
                  <span className="font-semibold text-gray-800">{selectedReturn.supplier?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Kho xuất hàng</span>
                  <span className="font-semibold text-gray-800">{selectedReturn.warehouse?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Ngày lập</span>
                  <span className="font-medium">{new Date(selectedReturn.created_at).toLocaleString('vi-VN')}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Trạng thái</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
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
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Lý do trả hàng</span>
                  <span className="font-medium text-gray-800">
                    {selectedReturn.reason_code === 'damage' ? 'Hàng hỏng / Lỗi' :
                     selectedReturn.reason_code === 'wrong_product' ? 'Sai sản phẩm' :
                     selectedReturn.reason_code === 'near_expiry' ? 'Cận / Hết hạn' :
                     selectedReturn.reason_code === 'quality_fail' ? 'Lỗi chất lượng' :
                     selectedReturn.reason_code === 'recall' ? 'Thu hồi' : 'Lý do khác'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Hoàn tiền</span>
                  <span className="font-medium text-gray-800">
                    {selectedReturn.refund_method === 'cash_refund' ? 'Tiền mặt' :
                     selectedReturn.refund_method === 'credit_note' ? 'Cấn trừ công nợ' : 'Trừ đơn hàng sau'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Người lập phiếu</span>
                  <span className="font-medium text-gray-700">{selectedReturn.creator?.full_name || 'Hệ thống'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Tổng tiền hoàn</span>
                  <span className="font-bold text-gray-850">{Number(selectedReturn.total_amount || 0).toLocaleString('vi-VN')} ₫</span>
                </div>
                <div className="col-span-full border-t border-gray-100/50 pt-2 mt-0.5">
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Chi tiết lý do</span>
                  <span className="text-gray-700 italic">{selectedReturn.reason_detail || 'Không có chi tiết'}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h4 className="text-body-md font-bold text-gray-750">Sản phẩm xuất trả</h4>
                <div className="border border-gray-150 rounded-lg overflow-x-auto tbl-x">
                  <table className="w-full min-w-[620px] text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-[11px] uppercase">
                        <th className="px-3 py-2.5 min-w-[200px]">Sản phẩm / SKU</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Số lô</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Số lượng</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Đơn giá trả</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-[13px] text-gray-600">
                      {selectedReturnLines.map((line) => (
                        <tr key={line.id} className="hover:bg-gray-25/30">
                          <td className="px-3 py-2.5 min-w-[200px]">
                            <p className="font-bold text-gray-700 break-words">{line.product?.name}</p>
                            <span className="text-[11px] text-gray-400 font-mono">SKU: {line.product?.sku}</span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-blue-500 font-semibold whitespace-nowrap">{line.lot?.lot_number || 'N/A'}</td>
                          <td className="px-3 py-2.5 text-center font-medium text-gray-800 whitespace-nowrap">{line.quantity} {line.product?.unit}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{Number(line.unit_price || 0).toLocaleString('vi-VN')} ₫</td>
                          <td className="px-3 py-2.5 text-right font-bold text-gray-800 whitespace-nowrap">
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
          <div className="bg-white w-full max-w-6xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-155 flex justify-between items-center bg-gray-25 rounded-t-2xl sm:rounded-t-2xl">
              <div>
                <h3 className="text-base font-bold text-gray-800">Chi tiết phiếu nhập kho</h3>
                <p className="text-[11px] text-blue-500 font-bold font-mono">{selectedReceipt.receipt_code}</p>
              </div>
              <button
                onClick={() => setShowReceiptDetailModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Metadata details */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-2.5 bg-gray-25/55 border border-gray-100 rounded-lg p-3 text-[13px] text-gray-600">
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Nhà cung cấp</span>
                  <span className="font-semibold text-gray-800">{selectedReceipt.supplier?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Kho nhận hàng</span>
                  <span className="font-semibold text-gray-800">{selectedReceipt.warehouse?.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Ngày nhập</span>
                  <span className="font-medium">{new Date(selectedReceipt.receipt_date).toLocaleDateString('vi-VN')}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Người nhận</span>
                  <span className="font-medium text-gray-700">{selectedReceipt.profile?.full_name || 'Hệ thống'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Tổng giá trị</span>
                  <span className="font-bold text-gray-850">{Number(selectedReceipt.total_amount || 0).toLocaleString('vi-VN')} ₫</span>
                </div>
                <div className="col-span-full border-t border-gray-100/50 pt-2 mt-0.5">
                  <span className="text-gray-400 block text-[11px] leading-none mb-0.5">Ghi chú</span>
                  <span className="text-gray-700 italic">{selectedReceipt.notes || 'Không có ghi chú'}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h4 className="text-body-md font-bold text-gray-750">Danh sách sản phẩm nhập</h4>
                <div className="border border-gray-150 rounded-lg overflow-x-auto tbl-x">
                  <table className="w-full min-w-[680px] text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-[11px] uppercase">
                        <th className="px-3 py-2.5 min-w-[200px]">Sản phẩm / SKU</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Số lô</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Hạn sử dụng</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Số lượng</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Đơn giá nhập</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-[13px] text-gray-600">
                      {selectedReceiptLines.map((line) => (
                        <tr key={line.id} className="hover:bg-gray-25/30">
                          <td className="px-3 py-2.5 min-w-[200px]">
                            <p className="font-bold text-gray-700 break-words">{line.product?.name}</p>
                            <span className="text-[11px] text-gray-400 font-mono">SKU: {line.product?.sku}</span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-blue-500 font-semibold whitespace-nowrap">{line.lot_number || 'N/A'}</td>
                          <td className="px-3 py-2.5 text-center text-gray-500 whitespace-nowrap">
                            {line.expiry_date ? new Date(line.expiry_date).toLocaleDateString('vi-VN') : '---'}
                          </td>
                          <td className="px-3 py-2.5 text-center font-medium text-gray-800 whitespace-nowrap">{line.quantity} {line.product?.unit}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{Number(line.unit_price || 0).toLocaleString('vi-VN')} ₫</td>
                          <td className="px-3 py-2.5 text-right font-bold text-gray-850 whitespace-nowrap">
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

      {/* Admin: Modal sửa lô hàng */}
      {editingLot && (
        <LotEditModal
          lot={editingLot}
          onClose={() => setEditingLot(null)}
          onSaved={(msg) => {
            setEditingLot(null)
            setAlertMsg({ type: 'success', text: msg })
            setLotReloadFlag(f => f + 1)
          }}
        />
      )}

      {/* Admin: Modal xác nhận hủy lô */}
      {deletingLot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Ban className="text-red-600" size={18} />
              </div>
              <div>
                <h3 className="text-headline-md font-bold text-gray-800">Hủy lô hàng?</h3>
                <p className="text-body-sm text-gray-500 mt-1">
                  Lô <span className="font-mono font-bold">{deletingLot.lot_number}</span> ({deletingLot.product.name}) sẽ được đưa tồn về 0,
                  ghi bút toán xuất hủy vào thẻ kho và đánh dấu "Đã hủy". Lịch sử vẫn được giữ.
                </p>
              </div>
            </div>
            <label className="block text-tiny font-semibold text-gray-500 mb-1">Lý do hủy (không bắt buộc)</label>
            <textarea
              rows={2}
              value={deleteLotReason}
              onChange={e => setDeleteLotReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-body-sm focus:outline-none focus:border-blue-500"
              placeholder="VD: Hỏng, hết hạn, kiểm kê lệch..."
            />
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => { setDeletingLot(null); setDeleteLotReason('') }}
                className="h-10 px-4 border border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-50"
              >
                Đóng
              </button>
              <button
                disabled={submitting}
                onClick={handleDeleteLot}
                className="h-10 px-5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-60"
              >
                {submitting ? 'Đang hủy...' : 'Xác nhận hủy lô'}
              </button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  )
}
