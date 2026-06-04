import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  Search,
  TrendingUp,
  TrendingDown,
  X,
  AlertTriangle,
  ChevronRight,
  Download,
  ShieldCheck,
  Upload,
  ChevronLeft,
  Wallet,
  Clock,
  Printer,
  Settings,
  Plus,
  HandCoins,
  Truck,
  UserCog
} from 'lucide-react'
import Layout from '../../components/Layout'
import { useRealtimeTable } from '../../hooks/useRealtimeTable'
import { Skeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAuth } from '../../contexts/AuthContext'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import SmartSearchSelect, { type SmartSearchOption, removeVietnameseTones } from '../../components/SmartSearchSelect'
import CashbookReports from './CashbookReports'
import CashbookOverview from './CashbookOverview'

interface CashFund {
  id: string
  code: string
  name: string
  balance: number
  currency: string
  is_active: boolean
  is_default_cash?: boolean
}

interface BankAccount {
  id: string
  bank_name: string
  account_name: string
  account_no: string
  branch_name: string | null
  balance: number
  currency: string
  is_active: boolean
}

interface CashierSession {
  id: string
  code?: string | null
  cash_fund_id: string
  cashier_id: string
  status: 'open' | 'closed' | 'reopened'
  opening_balance: number
  closing_balance: number | null
  cash_actual: number | null
  variance: number | null
  opened_at: string
  closed_at: string | null
  notes: string | null
  cashier?: {
    full_name: string
  }
}

// Đối soát tiền mặt trong ca (chỉ tính giao dịch TIỀN MẶT gắn session)
interface SessionReconciliation {
  opening: number
  inflowGroups: { label: string; amount: number }[]
  outflowGroups: { label: string; amount: number }[]
  totalIn: number
  totalOut: number
  salesIn: number   // Thu từ bán hàng (THU-DON-HANG) — tách riêng để thẻ tóm tắt hiển thị nguồn gốc
  otherIn: number   // Thu khác = totalIn − salesIn
  expected: number
  bankIn: number
  bankOut: number
}

interface ExpenseCategory {
  id: string
  code: string
  name: string
  flow_type: 'inflow' | 'outflow'
  is_active: boolean
  is_internal?: boolean
}

// Hạng mục hệ thống dẫn dắt nghiệp vụ riêng trong form Phiếu thu/chi
type SpecialKind = 'debt' | 'supplier' | 'advance' | null
function specialKindOf(code?: string): SpecialKind {
  if (code === 'THU-NO') return 'debt'
  if (code === 'CHI-NCC') return 'supplier'
  if (code === 'CHI-TAM-UNG') return 'advance'
  return null
}

interface Customer {
  id: string
  name: string
  farm_name: string | null
}

interface Supplier {
  id: string
  name: string
}

interface Profile {
  id: string
  full_name: string
}

interface CashbookTransaction {
  id: string
  transaction_code: string
  flow_type: 'inflow' | 'outflow' | 'internal_transfer'
  status: 'draft' | 'pending_approval' | 'approved' | 'cancelled'
  cash_fund_id: string | null
  bank_account_id: string | null
  session_id: string | null
  amount: number
  transaction_date: string
  customer_id: string | null
  supplier_id: string | null
  order_id: string | null
  employee_id: string | null
  expense_category_id: string | null
  description: string
  reference_no: string | null
  attachments: string[]
  created_by: string
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
  
  customer?: {
    name: string
    farm_name: string | null
  }
  supplier?: {
    name: string
  }
  employee?: {
    full_name: string
  }
  creator?: {
    full_name: string
  }
  approver?: {
    full_name: string
  }
  expense_category?: {
    name: string
    code: string
  }
}

export default function CashbookPage() {
  const { profile, userRole, hasPermission } = useAuth()
  const { formatCurrency } = useDisplaySettings()

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'sessions' | 'cashflow'>('overview')

  // Master lists
  const [cashFunds, setCashFunds] = useState<CashFund[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [sessions, setSessions] = useState<CashierSession[]>([])
  const [transactions, setTransactions] = useState<CashbookTransaction[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])

  // Active cashier session for cash transactions
  const [activeSession, setActiveSession] = useState<CashierSession | null>(null)

  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebouncedValue(searchTerm, 300)
  const [flowFilter, setFlowFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Modals / Overlays
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [selectedTx, setSelectedTx] = useState<CashbookTransaction | null>(null)
  
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false)
  const [sessionAction, setSessionAction] = useState<'open' | 'close'>('open')
  
  // Transaction Form state
  const [formFlowType, setFormFlowType] = useState<'inflow' | 'outflow'>('inflow')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [formAmount, setFormAmount] = useState(0)
  const [formAccountType, setFormAccountType] = useState<'cash_fund' | 'bank_account'>('cash_fund')
  const [formAccountId, setFormAccountId] = useState('')
  const [formCounterpartyType, setFormCounterpartyType] = useState<'none' | 'customer' | 'supplier' | 'employee'>('none')
  const [formCustomerId, setFormCustomerId] = useState('')
  const [formSupplierId, setFormSupplierId] = useState('')
  const [formEmployeeId, setFormEmployeeId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formReferenceNo, setFormReferenceNo] = useState('')
  const [formAttachmentUrl, setFormAttachmentUrl] = useState('')
  const [formAttachments, setFormAttachments] = useState<string[]>([])
  const [formDate, setFormDate] = useState(() => new Date().toLocaleDateString('en-CA')) // YYYY-MM-DD theo giờ địa phương
  const [formAdvanceDueDate, setFormAdvanceDueDate] = useState('') // Hạn hoàn ứng (chỉ hạng mục Tạm ứng)
  const [counterpartyDebt, setCounterpartyDebt] = useState<number | null>(null) // Công nợ KH/NCC khi chọn (hạng mục dẫn dắt)

  // Cashier Session Form State
  const [sessionOpeningBal, setSessionOpeningBal] = useState(0)
  const [sessionActualClose, setSessionActualClose] = useState(0)
  const [sessionNotes, setSessionNotes] = useState('')
  const [sessionVarianceReason, setSessionVarianceReason] = useState('')
  const [sessionFundId, setSessionFundId] = useState('') // Chọn quỹ mở ca
  const [sessionNopAmount, setSessionNopAmount] = useState(0) // Nộp quỹ cuối ca (giao tiền về công ty)
  const [reconcile, setReconcile] = useState<SessionReconciliation | null>(null)
  const [reconcileLoading, setReconcileLoading] = useState(false)

  // Quản lý hạng mục thu/chi
  const [isCatModalOpen, setIsCatModalOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatFlow, setNewCatFlow] = useState<'inflow' | 'outflow'>('outflow')
  const [savingCat, setSavingCat] = useState(false)

  // UI state
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  
  // Pending transactions for quick approval on Overview tab
  const [pendingTx, setPendingTx] = useState<CashbookTransaction[]>([])
  const [pendingLoading, setPendingLoading] = useState(true)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const pageSize = 10

  // Branch management
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'
  const [branches, setBranches] = useState<any[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<string>('')
  const [branchName, setBranchName] = useState('Chi nhánh')

  const userBranchId = useMemo(() => {
    if (isAdmin) {
      return selectedBranchId || (branches[0]?.id ?? '')
    }
    return profile?.branch_id || ''
  }, [isAdmin, selectedBranchId, profile?.branch_id, branches])

  // Granular Inflow/Outflow permissions
  const canCreateInflow = hasPermission('cashbook.create_inflow') || hasPermission('cashbook.create')
  const canCreateOutflow = hasPermission('cashbook.create_outflow') || hasPermission('cashbook.create')

  // Load Master Metadata
  const loadMetadata = useCallback(async () => {
    try {
      let currentBranchId = userBranchId

      // If user is Admin/CEO and branches are not loaded, load them
      if (isAdmin && branches.length === 0) {
        const { data: brData } = await supabase
          .from('branches')
          .select('id, code, name')
          .eq('is_active', true)
          .order('name', { ascending: true })
        if (brData && brData.length > 0) {
          setBranches(brData)
          if (!selectedBranchId) {
            setSelectedBranchId(brData[0].id)
            currentBranchId = brData[0].id
          }
        }
      }

      if (!currentBranchId) return

      // Fetch active branch name for display
      const { data: activeBr } = await supabase
        .from('branches')
        .select('name')
        .eq('id', currentBranchId)
        .single()
      if (activeBr) {
        setBranchName(activeBr.name)
      }

      // 1. Fetch cash funds of user branch
      const { data: funds } = await supabase
        .from('cash_funds')
        .select('*')
        .eq('branch_id', currentBranchId)
        .eq('is_active', true)
      if (funds) {
        setCashFunds(funds)
        if (funds.length > 0) {
          setFormAccountId(funds[0].id)
          setSessionFundId(funds[0].id)
        }
      }

      // 2. Fetch active bank accounts of user branch
      const { data: banks } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('branch_id', currentBranchId)
        .eq('is_active', true)
      if (banks) {
        setBankAccounts(banks)
      }

      // 3. Fetch expense categories
      const { data: cats } = await supabase
        .from('expense_categories')
        .select('*')
        .eq('is_active', true)
      if (cats) {
        setCategories(cats)
        // Find default category
        const defaultCat = cats.find((c: ExpenseCategory) => c.flow_type === 'inflow')
        if (defaultCat) setFormCategoryId(defaultCat.id)
      }

      // 4. Fetch customers — nạp ĐỦ (tránh cap 1000 → nhiều KH không tìm được)
      const custs = await fetchAllRows<Customer>((from, to) =>
        supabase.from('customers').select('id, farm_name, name')
          .eq('is_active', true).order('farm_name', { ascending: true }).order('id').range(from, to)
      )
      setCustomers(custs)

      // 5. Fetch suppliers
      const sups = await fetchAllRows<Supplier>((from, to) =>
        supabase.from('suppliers').select('id, name')
          .eq('is_active', true).order('name', { ascending: true }).range(from, to)
      )
      setSuppliers(sups)

      // 6. Fetch profiles (employees)
      const emps = await fetchAllRows<Profile>((from, to) =>
        supabase.from('profiles').select('id, full_name')
          .eq('is_active', true).order('full_name', { ascending: true }).range(from, to)
      )
      setEmployees(emps)

    } catch (err) {
      console.error('Error loading cashbook metadata:', err)
    }
  }, [userBranchId, isAdmin, branches.length, selectedBranchId])

  // Load active cashier session
  // Mô hình "1 chi nhánh = 1 két": tìm ca đang MỞ của két (quỹ) chi nhánh,
  // KHÔNG lọc theo người mở — mọi nhân viên dùng chung & thấy cùng 1 ca.
  const checkActiveSession = useCallback(async () => {
    if (cashFunds.length === 0) return
    try {
      const fundIds = cashFunds.map(f => f.id)
      const { data } = await supabase
        .from('cashier_sessions')
        .select('*, cashier:profiles!cashier_sessions_cashier_id_fkey(full_name)')
        .eq('status', 'open')
        .in('cash_fund_id', fundIds)
        .order('opened_at', { ascending: false })
        .limit(1)

      if (data && data.length > 0) {
        setActiveSession(data[0] as unknown as CashierSession)
      } else {
        setActiveSession(null)
      }
    } catch (err) {
      console.error('Error checking active cashier session:', err)
    }
  }, [cashFunds])

  // Load Sessions History
  const loadSessions = useCallback(async () => {
    if (cashFunds.length === 0) return
    try {
      const fundIds = cashFunds.map(f => f.id)
      const { data } = await supabase
        .from('cashier_sessions')
        .select('*, cashier:profiles!cashier_sessions_cashier_id_fkey(full_name)')
        .in('cash_fund_id', fundIds)
        .order('opened_at', { ascending: false })
      if (data) setSessions(data as unknown as CashierSession[])
    } catch (err) {
      console.error(err)
    }
  }, [cashFunds])

  const fetchPendingTransactions = useCallback(async () => {
    setPendingLoading(true)
    try {
      const fundIds = cashFunds.map(f => f.id)
      const bankIds = bankAccounts.map(b => b.id)
      const orParts: string[] = []
      if (fundIds.length > 0) orParts.push(`cash_fund_id.in.(${fundIds.join(',')})`)
      if (bankIds.length > 0) orParts.push(`bank_account_id.in.(${bankIds.join(',')})`)

      let query = supabase
        .from('cashbook_transactions')
        .select(`
          *,
          customer:customers(farm_name),
          supplier:suppliers(name),
          employee:profiles!employee_id(full_name),
          creator:profiles!created_by(full_name)
        `)
        .eq('status', 'pending_approval')

      if (orParts.length > 0) {
        query = query.or(orParts.join(','))
      } else {
        setPendingTx([])
        setPendingLoading(false)
        return
      }

      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      setPendingTx(data as unknown as CashbookTransaction[])
    } catch (err) {
      console.error('Error fetching pending transactions:', err)
    } finally {
      setPendingLoading(false)
    }
  }, [cashFunds, bankAccounts])

  // Load Cashbook Transactions
  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('cashbook_transactions')
        .select(`
          *,
          customer:customers(farm_name),
          supplier:suppliers(name),
          employee:profiles!employee_id(full_name),
          creator:profiles!created_by(full_name),
          approver:profiles!approved_by(full_name),
          expense_category:expense_categories(code, name)
        `, { count: 'exact' })

      // Apply filters
      if (flowFilter !== 'all') {
        query = query.eq('flow_type', flowFilter)
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }
      if (categoryFilter !== 'all') {
        query = query.eq('expense_category_id', categoryFilter)
      }
      
      // Account filter
      if (accountFilter !== 'all') {
        if (accountFilter.startsWith('fund_')) {
          const fundId = accountFilter.replace('fund_', '')
          query = query.eq('cash_fund_id', fundId)
        } else if (accountFilter.startsWith('bank_')) {
          const bankId = accountFilter.replace('bank_', '')
          query = query.eq('bank_account_id', bankId)
        }
      } else {
        // Limit to current branch: cash transactions in our funds + bank transactions in our bank accounts
        const fundIds = cashFunds.map(f => f.id)
        const bankIds = bankAccounts.map(b => b.id)
        const orParts: string[] = []
        if (fundIds.length > 0) orParts.push(`cash_fund_id.in.(${fundIds.join(',')})`)
        if (bankIds.length > 0) orParts.push(`bank_account_id.in.(${bankIds.join(',')})`)
        if (orParts.length > 0) {
          query = query.or(orParts.join(','))
        }
      }

      if (startDate) {
        query = query.gte('transaction_date', startDate)
      }
      if (endDate) {
        query = query.lte('transaction_date', endDate)
      }

      // Search term
      if (debouncedSearch.trim()) {
        const s = debouncedSearch.trim()
        query = query.or(`description.ilike.%${s}%,transaction_code.ilike.%${s}%,reference_no.ilike.%${s}%`)
      }

      // Pagination
      const from = (currentPage - 1) * pageSize
      const to = from + pageSize - 1

      const { data, count, error } = await query
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      if (data) {
        setTransactions(data as unknown as CashbookTransaction[])
        setTotalCount(count || 0)
      }
    } catch (err) {
      console.error('Error fetching transactions:', err)
    } finally {
      setLoading(false)
    }
  }, [flowFilter, statusFilter, categoryFilter, accountFilter, startDate, endDate, debouncedSearch, currentPage, cashFunds, bankAccounts])

  // Run on mount
  useEffect(() => {
    loadMetadata()
  }, [loadMetadata])

  // Check cashier session and load lists once metadata loads
  useEffect(() => {
    if (cashFunds.length > 0 || bankAccounts.length > 0) {
      checkActiveSession()
      loadSessions()
      fetchPendingTransactions()
    }
  }, [cashFunds, bankAccounts, checkActiveSession, loadSessions, fetchPendingTransactions])

  // Reload list when tab/filters change
  useEffect(() => {
    fetchTransactions()
  }, [currentPage, flowFilter, statusFilter, categoryFilter, accountFilter, startDate, endDate, fetchTransactions])

  useRealtimeTable({ table: 'cashbook_transactions', event: 'INSERT', onData: () => { fetchTransactions(); fetchPendingTransactions(); } })
  useRealtimeTable({ table: 'cashbook_transactions', event: 'UPDATE', onData: () => { fetchTransactions(); fetchPendingTransactions(); } })

  // Reset alert messages automatically
  useEffect(() => {
    if (alertMsg) {
      const t = setTimeout(() => setAlertMsg(null), 3000)
      return () => clearTimeout(t)
    }
  }, [alertMsg])

  // Set default form flow type based on permissions
  useEffect(() => {
    if (!canCreateInflow && canCreateOutflow) {
      setFormFlowType('outflow')
      const match = categories.find(c => c.flow_type === 'outflow')
      if (match) setFormCategoryId(match.id)
    } else if (canCreateInflow && !canCreateOutflow) {
      setFormFlowType('inflow')
      const match = categories.find(c => c.flow_type === 'inflow')
      if (match) setFormCategoryId(match.id)
    }
  }, [canCreateInflow, canCreateOutflow, categories])

  // Sync formAccountId when formAccountType or lists load/change
  useEffect(() => {
    if (formAccountType === 'cash_fund') {
      if (cashFunds.length > 0 && !cashFunds.some(f => f.id === formAccountId)) {
        setFormAccountId(cashFunds[0].id)
      }
    } else {
      if (bankAccounts.length > 0 && !bankAccounts.some(b => b.id === formAccountId)) {
        setFormAccountId(bankAccounts[0].id)
      }
    }
  }, [formAccountType, cashFunds, bankAccounts, formAccountId])

  // Handle flow type change in form
  const handleFlowTypeChange = (type: 'inflow' | 'outflow') => {
    setFormFlowType(type)
    // Select first matching category
    const match = categories.find(c => c.flow_type === type)
    if (match) setFormCategoryId(match.id)
  }

  // Add simulated attachment
  const handleAddAttachment = () => {
    if (!formAttachmentUrl.trim()) return
    setFormAttachments(prev => [...prev, formAttachmentUrl.trim()])
    setFormAttachmentUrl('')
  }

  const handleRemoveAttachment = (idx: number) => {
    setFormAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  // Nạp công nợ KH/NCC khi chọn đối tượng trong hạng mục dẫn dắt (thu nợ / chi NCC)
  useEffect(() => {
    const cat = categories.find(c => c.id === formCategoryId)
    const kind = specialKindOf(cat?.code)
    let cancelled = false
    ;(async () => {
      if (kind === 'debt' && formCustomerId) {
        const { data } = await supabase.from('customer_summary_view').select('total_debt').eq('id', formCustomerId).maybeSingle()
        if (!cancelled) setCounterpartyDebt(data ? Number((data as any).total_debt || 0) : 0)
      } else if (kind === 'supplier' && formSupplierId) {
        const { data } = await supabase.from('suppliers').select('current_debt_payable').eq('id', formSupplierId).maybeSingle()
        if (!cancelled) setCounterpartyDebt(data ? Number((data as any).current_debt_payable || 0) : 0)
      } else if (!cancelled) {
        setCounterpartyDebt(null)
      }
    })()
    return () => { cancelled = true }
  }, [formCategoryId, formCustomerId, formSupplierId, categories])

  // Tải lại danh mục hạng mục (không reset cả form như loadMetadata)
  const refreshCategories = useCallback(async () => {
    const { data: cats } = await supabase.from('expense_categories').select('*').eq('is_active', true)
    if (cats) setCategories(cats)
  }, [])

  // Tạo hạng mục thu/chi tùy biến (admin/accountant)
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCatName.trim()) { setAlertMsg({ type: 'error', text: 'Vui lòng nhập tên hạng mục.' }); return }
    setSavingCat(true)
    try {
      const slug = removeVietnameseTones(newCatName).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20)
      const prefix = newCatFlow === 'inflow' ? 'THU' : 'CHI'
      const code = `${prefix}-${slug || 'KHAC'}-${Date.now().toString().slice(-5)}`
      const { data, error } = await supabase
        .from('expense_categories')
        .insert([{ code, name: newCatName.trim(), flow_type: newCatFlow, is_active: true, is_internal: false }])
        .select()
        .single()
      if (error) throw error
      await refreshCategories()
      if (data) setFormCategoryId(data.id)
      setNewCatName('')
      setAlertMsg({ type: 'success', text: 'Đã thêm hạng mục thu/chi mới.' })
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: 'Thêm hạng mục thất bại: ' + err.message })
    } finally { setSavingCat(false) }
  }

  // Ẩn/hiện (tắt) hạng mục — chỉ tắt hạng mục tùy biến, không cho tắt hạng mục hệ thống
  const handleDeactivateCategory = async (cat: ExpenseCategory) => {
    if (specialKindOf(cat.code) || cat.code.endsWith('-QUY') || cat.code === 'THU-DON-HANG' || cat.code === 'CHI-HOANTIEN') {
      setAlertMsg({ type: 'error', text: 'Không thể tắt hạng mục hệ thống.' })
      return
    }
    try {
      const { error } = await supabase.from('expense_categories').update({ is_active: false }).eq('id', cat.id)
      if (error) throw error
      await refreshCategories()
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: 'Không thể tắt hạng mục: ' + err.message })
    }
  }

  // Reset các trường nhập sau khi lưu phiếu thành công
  const resetTransactionForm = () => {
    setFormAmount(0)
    setFormDescription('')
    setFormReferenceNo('')
    setFormAttachments([])
    setFormDate(new Date().toLocaleDateString('en-CA'))
    setFormCustomerId(''); setFormSupplierId(''); setFormEmployeeId('')
    setFormAdvanceDueDate(''); setCounterpartyDebt(null)
  }

  // ── Nghiệp vụ dẫn dắt bởi hạng mục ──────────────────────────────
  // THU-NO: thu công nợ KH (RPC settle nợ + sinh phiếu thu sổ quỹ atomic)
  const submitDebtCollection = async () => {
    if (!profile?.id) return
    if (!formCustomerId) { setAlertMsg({ type: 'error', text: 'Vui lòng chọn khách hàng cần thu nợ.' }); return }
    if (formAmount <= 0) { setAlertMsg({ type: 'error', text: 'Số tiền thu phải lớn hơn 0 ₫.' }); return }
    const isCash = formAccountType === 'cash_fund'
    if (isCash && !activeSession) { setAlertMsg({ type: 'error', text: 'Quỹ tiền mặt đang ĐÓNG CA. Vui lòng mở ca trước khi thu tiền mặt!' }); return }
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('fn_collect_customer_debt', {
        p_customer_id: formCustomerId,
        p_amount: formAmount,
        p_method: isCash ? 'cash' : 'bank_transfer',
        p_date: formDate,
        p_reference: formReferenceNo.trim() || null,
        p_notes: formDescription.trim() || null,
      })
      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Đã thu công nợ. Sổ quỹ và công nợ khách hàng đã tự cập nhật.' })
      resetTransactionForm(); fetchTransactions(); loadMetadata()
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: 'Thu công nợ thất bại: ' + err.message })
    } finally { setSubmitting(false) }
  }

  // CHI-NCC: thanh toán nhà cung cấp (trigger sinh phiếu chi + giảm công nợ NCC)
  const submitSupplierPayment = async () => {
    if (!profile?.id) return
    if (!formSupplierId) { setAlertMsg({ type: 'error', text: 'Vui lòng chọn nhà cung cấp.' }); return }
    if (formAmount <= 0) { setAlertMsg({ type: 'error', text: 'Số tiền thanh toán phải lớn hơn 0 ₫.' }); return }
    const isCash = formAccountType === 'cash_fund'
    if (isCash && !activeSession) { setAlertMsg({ type: 'error', text: 'Quỹ tiền mặt đang ĐÓNG CA. Vui lòng mở ca trước khi chi tiền mặt!' }); return }
    setSubmitting(true)
    try {
      const { error } = await supabase.from('supplier_payments').insert([{
        supplier_id: formSupplierId,
        amount: formAmount,
        payment_method: isCash ? 'cash' : 'bank_transfer',
        payment_date: formDate,
        reference_no: formReferenceNo.trim() || null,
        notes: formDescription.trim() || 'Thanh toán nhà cung cấp',
        created_by: profile.id,
      }])
      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Đã ghi nhận thanh toán NCC. Sổ quỹ và công nợ NCC đã tự cập nhật.' })
      resetTransactionForm(); fetchTransactions(); loadMetadata()
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: 'Thanh toán NCC thất bại: ' + err.message })
    } finally { setSubmitting(false) }
  }

  // CHI-TAM-UNG: tạm ứng nhân viên (luôn chi tiền mặt quỹ mặc định)
  const submitEmployeeAdvance = async () => {
    if (!profile?.id) return
    if (!formEmployeeId) { setAlertMsg({ type: 'error', text: 'Vui lòng chọn nhân viên.' }); return }
    if (formAmount <= 0) { setAlertMsg({ type: 'error', text: 'Số tiền tạm ứng phải lớn hơn 0 ₫.' }); return }
    if (!formDescription.trim()) { setAlertMsg({ type: 'error', text: 'Vui lòng nhập lý do tạm ứng.' }); return }
    if (!activeSession) { setAlertMsg({ type: 'error', text: 'Tạm ứng chi tiền mặt — vui lòng mở ca trước!' }); return }
    setSubmitting(true)
    try {
      const { error } = await supabase.from('employee_advances').insert([{
        employee_id: formEmployeeId,
        amount: formAmount,
        purpose: formDescription.trim(),
        advance_date: formDate,
        due_date: formAdvanceDueDate || null,
        created_by: profile.id,
      }])
      if (error) throw error
      setAlertMsg({ type: 'success', text: 'Đã ghi nhận tạm ứng. Phiếu chi tiền mặt đã tự tạo trong sổ quỹ.' })
      resetTransactionForm(); fetchTransactions(); loadMetadata()
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: 'Tạm ứng thất bại: ' + err.message })
    } finally { setSubmitting(false) }
  }

  // Submit Transaction
  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.id) return

    // Hạng mục hệ thống → định tuyến sang nghiệp vụ chuyên biệt
    const selCat = categories.find(c => c.id === formCategoryId)
    const kind = specialKindOf(selCat?.code)
    if (kind === 'debt') return submitDebtCollection()
    if (kind === 'supplier') return submitSupplierPayment()
    if (kind === 'advance') return submitEmployeeAdvance()

    if (formAmount <= 0) {
      setAlertMsg({ type: 'error', text: 'Số tiền giao dịch phải lớn hơn 0 ₫' })
      return
    }
    if (!formDescription.trim()) {
      setAlertMsg({ type: 'error', text: 'Vui lòng nhập nội dung chi tiết giao dịch.' })
      return
    }
    if (!formAccountId) {
      setAlertMsg({ type: 'error', text: 'Vui lòng chọn tài khoản thanh toán.' })
      return
    }
    // Validate transaction date: không cho ngày tương lai, lùi tối đa 30 ngày
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const txDate = new Date(formDate + 'T00:00:00')
    const minDate = new Date(today); minDate.setDate(minDate.getDate() - 30)
    if (txDate > today) {
      setAlertMsg({ type: 'error', text: 'Ngày giao dịch không được ở tương lai.' })
      return
    }
    if (txDate < minDate) {
      setAlertMsg({ type: 'error', text: 'Chỉ cho phép ghi nhận giao dịch trong vòng 30 ngày gần nhất.' })
      return
    }

    // Cash cashier session checks
    if (formAccountType === 'cash_fund') {
      if (!activeSession) {
        setAlertMsg({ type: 'error', text: 'Quỹ tiền mặt chi nhánh hiện đang ĐÓNG CA. Vui lòng mở ca trước khi giao dịch!' })
        return
      }
      if (activeSession.cash_fund_id !== formAccountId) {
        setAlertMsg({ type: 'error', text: 'Quỹ tiền mặt được chọn không khớp với ca đang hoạt động!' })
        return
      }
    }

    setSubmitting(true)
    try {
      // Determine targets
      const isCash = formAccountType === 'cash_fund'
      
      // Determine final status
      // Inflows are approved instantly.
      // Outflows: manual outflows above 10,000,000 VND require manager approval (pending_approval), else auto-approved.
      let targetStatus: 'approved' | 'pending_approval' = 'approved'
      if (formFlowType === 'outflow' && formAmount > 10000000) {
        targetStatus = 'pending_approval'
      }

      const insertData: any = {
        flow_type: formFlowType,
        // Ghi trực tiếp trạng thái đích — trigger fn_update_fund_balance (AFTER INSERT)
        // tự cập nhật số dư quỹ khi status='approved'. Không cần bước draft→update nữa.
        status: targetStatus,
        cash_fund_id: isCash ? (formAccountId || null) : null,
        bank_account_id: !isCash ? (formAccountId || null) : null,
        session_id: isCash ? (activeSession?.id || null) : null,
        amount: formAmount,
        transaction_date: formDate,
        description: formDescription.trim(),
        reference_no: formReferenceNo.trim() || null,
        attachments: formAttachments,
        expense_category_id: formCategoryId || null,
        created_by: profile.id,
        approved_by: targetStatus === 'approved' ? profile.id : null,
        approved_at: targetStatus === 'approved' ? new Date().toISOString() : null
      }

      // Counterparty links
      if (formCounterpartyType === 'customer' && formCustomerId) {
        insertData.customer_id = formCustomerId
      } else if (formCounterpartyType === 'supplier' && formSupplierId) {
        insertData.supplier_id = formSupplierId
      } else if (formCounterpartyType === 'employee' && formEmployeeId) {
        insertData.employee_id = formEmployeeId
      }

      const { error } = await supabase
        .from('cashbook_transactions')
        .insert([insertData])

      if (error) throw error

      setAlertMsg({ 
        type: 'success', 
        text: targetStatus === 'approved' 
          ? 'Tạo giao dịch thành công. Số dư quỹ đã được cập nhật!' 
          : 'Tạo phiếu chi thành công. Giao dịch đang chờ duyệt do vượt hạn mức 10M.' 
      })

      // Reset form
      setFormAmount(0)
      setFormDescription('')
      setFormReferenceNo('')
      setFormAttachments([])
      setFormDate(new Date().toLocaleDateString('en-CA'))
      
      // Reload lists
      fetchTransactions()
      loadMetadata()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Thao tác thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Approve Cashbook Transaction (for Accountants or Admins)
  const handleApproveTransaction = async (txId: string) => {
    if (!profile?.id) return
    setSubmitting(true)
    try {
      // Transitioning status to approved triggers the AFTER UPDATE Postgres trigger fn_update_fund_balance()
      const { error } = await supabase
        .from('cashbook_transactions')
        .update({
          status: 'approved',
          approved_by: profile.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', txId)

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Phê duyệt giao dịch thành công. Số dư đã cập nhật!' })
      
      // Hide details modal if open
      setIsDetailsModalOpen(false)
      
      fetchTransactions()
      loadMetadata()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Duyệt giao dịch thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Cancel Transaction
  const handleCancelTransaction = async (txId: string) => {
    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('cashbook_transactions')
        .update({ status: 'cancelled' })
        .eq('id', txId)

      if (error) throw error

      setAlertMsg({ type: 'success', text: 'Đã hủy phiếu giao dịch.' })
      setIsDetailsModalOpen(false)
      fetchTransactions()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Hủy giao dịch thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Tính đối soát tiền mặt của 1 ca (chỉ giao dịch TIỀN MẶT gắn session)
  const loadSessionReconciliation = useCallback(async (session: CashierSession) => {
    setReconcileLoading(true)
    try {
      // 1. Giao dịch tiền mặt thuộc ca này
      const { data: txs } = await supabase
        .from('cashbook_transactions')
        .select('amount, flow_type, expense_category_id')
        .eq('session_id', session.id)
        .eq('status', 'approved')

      const inflowMap = new Map<string, number>()
      const outflowMap = new Map<string, number>()
      let totalIn = 0
      let totalOut = 0
      let salesIn = 0
      ;(txs || []).forEach((t: any) => {
        const amt = Number(t.amount) || 0
        const cat = categories.find(c => c.id === t.expense_category_id)
        const label = cat?.name || 'Khác'
        if (t.flow_type === 'inflow') {
          totalIn += amt
          if (cat?.code === 'THU-DON-HANG') salesIn += amt
          inflowMap.set(label, (inflowMap.get(label) || 0) + amt)
        } else if (t.flow_type === 'outflow') {
          totalOut += amt
          outflowMap.set(label, (outflowMap.get(label) || 0) + amt)
        }
      })

      // 2. Chuyển khoản phát sinh trong ca (tham khảo — KHÔNG nằm trong két)
      let bankIn = 0
      let bankOut = 0
      const bankIds = bankAccounts.map(b => b.id)
      if (bankIds.length > 0) {
        const { data: bankTxs } = await supabase
          .from('cashbook_transactions')
          .select('amount, flow_type')
          .in('bank_account_id', bankIds)
          .eq('status', 'approved')
          .gte('posted_at', session.opened_at)
        ;(bankTxs || []).forEach((t: any) => {
          const amt = Number(t.amount) || 0
          if (t.flow_type === 'inflow') bankIn += amt
          else if (t.flow_type === 'outflow') bankOut += amt
        })
      }

      const opening = Number(session.opening_balance) || 0
      setReconcile({
        opening,
        inflowGroups: Array.from(inflowMap, ([label, amount]) => ({ label, amount })),
        outflowGroups: Array.from(outflowMap, ([label, amount]) => ({ label, amount })),
        totalIn,
        totalOut,
        salesIn,
        otherIn: totalIn - salesIn,
        expected: opening + totalIn - totalOut,
        bankIn,
        bankOut
      })
    } catch (err) {
      console.error('Error loading session reconciliation:', err)
      setReconcile(null)
    } finally {
      setReconcileLoading(false)
    }
  }, [categories, bankAccounts])

  // Nạp đối soát liên tục khi có ca đang mở → thẻ "Tiền mặt tại quỹ" hiện breakdown nguồn tiền.
  useEffect(() => {
    if (activeSession && categories.length > 0) {
      loadSessionReconciliation(activeSession)
    } else {
      setReconcile(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSession?.opening_balance, categories.length, cashFunds])

  // Mở modal đóng ca kèm đối soát
  const openCloseSessionModal = () => {
    if (!activeSession) return
    setSessionAction('close')
    setSessionActualClose(0)
    setSessionNopAmount(0)
    setSessionNotes('')
    setSessionVarianceReason('')
    setReconcile(null)
    setIsSessionModalOpen(true)
    loadSessionReconciliation(activeSession)
  }

  // Open Cashier Session
  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.id || cashFunds.length === 0) return
    
    const selectedFundId = sessionFundId || cashFunds[0].id
    const fund = cashFunds.find(f => f.id === selectedFundId)
    if (!fund) {
      setAlertMsg({ type: 'error', text: 'Quỹ tiền mặt không hợp lệ.' })
      return
    }
    
    setSubmitting(true)
    try {
      // Mô hình "1 két = 1 ca mở": chặn nếu két đã có ca đang mở (bất kỳ ai mở).
      const { data: existingOpen } = await supabase
        .from('cashier_sessions')
        .select('id, cashier:profiles!cashier_sessions_cashier_id_fkey(full_name)')
        .eq('cash_fund_id', fund.id)
        .eq('status', 'open')
        .limit(1)
      if (existingOpen && existingOpen.length > 0) {
        const opener = (existingOpen[0] as any).cashier?.full_name || 'nhân viên khác'
        setAlertMsg({ type: 'error', text: `Két "${fund.name}" đang có ca mở bởi ${opener}. Vui lòng đóng ca hiện tại trước khi mở ca mới.` })
        setSubmitting(false)
        checkActiveSession()
        return
      }

      const insertData = {
        cash_fund_id: fund.id,
        cashier_id: profile.id,
        opened_by: profile.id,
        opening_balance: sessionOpeningBal,
        status: 'open',
        opened_at: new Date().toISOString(),
        notes: sessionNotes.trim() || null
      }

      const { error } = await supabase
        .from('cashier_sessions')
        .insert([insertData])

      if (error) {
        // Vi phạm index 1-ca-mở/két (race condition) → thông báo thân thiện
        if (error.code === '23505' || /uq_cashier_sessions_one_open_per_fund/.test(error.message)) {
          setAlertMsg({ type: 'error', text: `Két "${fund.name}" vừa được mở ca bởi nhân viên khác. Vui lòng tải lại.` })
          checkActiveSession()
          setSubmitting(false)
          return
        }
        throw error
      }

      setAlertMsg({ type: 'success', text: `Đã mở ca phiên quỹ thành công cho ${fund.name}.` })
      setIsSessionModalOpen(false)
      setSessionOpeningBal(0)
      setSessionNotes('')

      // Reload
      checkActiveSession()
      loadSessions()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Mở ca thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // Close Cashier Session & Reconciliation
  const handleCloseSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeSession) return

    // Calculate system balance
    // Query total inflows and outflows inside this session
    setSubmitting(true)
    try {
      const { data: txs, error: txErr } = await supabase
        .from('cashbook_transactions')
        .select('flow_type, amount, status')
        .eq('session_id', activeSession.id)
        .eq('status', 'approved')

      if (txErr) throw txErr

      let totalIn = 0
      let totalOut = 0
      if (txs) {
        txs.forEach((t: { flow_type: string; amount: number }) => {
          if (t.flow_type === 'inflow') totalIn += Number(t.amount)
          else if (t.flow_type === 'outflow') totalOut += Number(t.amount)
        })
      }

      const calculatedBalance = Number(activeSession.opening_balance) + totalIn - totalOut
      const variance = sessionActualClose - calculatedBalance

      if (variance !== 0 && !sessionVarianceReason.trim()) {
        setAlertMsg({ type: 'error', text: 'Số dư thực tế lệch so với hệ thống. Vui lòng điền lý do chênh lệch!' })
        setSubmitting(false)
        return
      }

      // Nộp quỹ cuối ca: 0 ≤ nộp ≤ tiền mặt đếm thực tế
      if (sessionNopAmount < 0 || sessionNopAmount > sessionActualClose) {
        setAlertMsg({ type: 'error', text: 'Số tiền nộp về công ty phải nằm trong khoảng 0 đến tiền mặt đếm được.' })
        setSubmitting(false)
        return
      }

      // Close cashier session
      const updateData = {
        status: 'closed',
        closing_balance: calculatedBalance,
        cash_actual: sessionActualClose,
        variance: variance,
        closed_by: profile?.id,
        variance_reason: variance !== 0 ? (sessionVarianceReason.trim() || null) : null,
        closed_at: new Date().toISOString(),
        notes: `Đối soát cuối ca. Chênh lệch: ${formatCurrency(variance)}. Lý do: ${sessionVarianceReason.trim() || 'Không có chênh lệch'}. Ghi chú: ${sessionNotes.trim()}`
      }

      const { error } = await supabase
        .from('cashier_sessions')
        .update(updateData)
        .eq('id', activeSession.id)

      if (error) throw error

      // If there's a variance, create an adjustment transaction
      if (variance !== 0) {
        const flow = variance > 0 ? 'inflow' : 'outflow'
        const adjustAmount = Math.abs(variance)

        // Danh mục lệch quỹ riêng (thừa / thiếu) — không làm bẩn báo cáo khác
        const code = flow === 'inflow' ? 'THU-LECH-QUY' : 'CHI-LECH-QUY'
        const cat = categories.find(c => c.code === code)

        const insertData: any = {
          flow_type: flow,
          status: 'approved', // Ghi thẳng approved — trigger AFTER INSERT tự cập nhật số dư
          cash_fund_id: activeSession.cash_fund_id,
          amount: adjustAmount,
          transaction_date: new Date().toLocaleDateString('en-CA'),
          description: `Điều chỉnh lệch phiên ca #${activeSession.id.slice(0,8)}. Lý do: ${sessionVarianceReason.trim()}`,
          expense_category_id: cat ? cat.id : null,
          created_by: profile?.id,
          approved_by: profile?.id,
          approved_at: new Date().toISOString()
        }

        const { error: adjErr } = await supabase
          .from('cashbook_transactions')
          .insert([insertData])
        if (adjErr) throw adjErr
      }

      // Nộp quỹ cuối ca → phiếu chi nội bộ CHI-NOP-QUY (giảm két về đúng tiền để lại).
      // KHÔNG gắn session_id (sau đối soát) — chỉ làm đổi số dư quỹ thật.
      if (sessionNopAmount > 0) {
        const nopCat = categories.find(c => c.code === 'CHI-NOP-QUY')
        const { error: nopErr } = await supabase
          .from('cashbook_transactions')
          .insert([{
            flow_type: 'outflow',
            status: 'approved',
            cash_fund_id: activeSession.cash_fund_id,
            amount: sessionNopAmount,
            transaction_date: new Date().toLocaleDateString('en-CA'),
            description: `Nộp quỹ cuối ca ${activeSession.code || '#' + activeSession.id.slice(0, 8)} — giao tiền về công ty`,
            expense_category_id: nopCat ? nopCat.id : null,
            created_by: profile?.id,
            approved_by: profile?.id,
            approved_at: new Date().toISOString()
          }])
        if (nopErr) throw nopErr
      }

      setAlertMsg({ type: 'success', text: 'Đóng ca và đối soát ca thành công. Số dư quỹ đã hoàn tất ghi sổ!' })
      setIsSessionModalOpen(false)
      setSessionActualClose(0)
      setSessionNopAmount(0)
      setSessionVarianceReason('')
      setSessionNotes('')
      
      // Reload
      checkActiveSession()
      loadSessions()
      fetchTransactions()
      loadMetadata()
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Đóng ca thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }


  const totalCashBalance = useMemo(() => cashFunds.reduce((sum, f) => sum + Number(f.balance), 0), [cashFunds])

  // Options cho ô tìm kiếm thông minh đối tượng (KH/NCC/NV)
  const customerOptions = useMemo<SmartSearchOption[]>(
    () => customers.map(c => ({ value: c.id, label: c.farm_name || c.name || 'Khách hàng' })), [customers])
  const supplierOptions = useMemo<SmartSearchOption[]>(
    () => suppliers.map(s => ({ value: s.id, label: s.name })), [suppliers])
  const employeeOptions = useMemo<SmartSearchOption[]>(
    () => employees.map(e => ({ value: e.id, label: e.full_name })), [employees])

  // Hạng mục đang chọn + nghiệp vụ dẫn dắt tương ứng (cho form Phiếu thu/chi)
  const selectedFormCategory = categories.find(c => c.id === formCategoryId)
  const formKind = specialKindOf(selectedFormCategory?.code)
  const canManageCategories = ['admin', 'ceo', 'accountant'].includes(userRole.code)

  // Guard check at top
  const canView = hasPermission('cashbook.view')
  if (!canView) {
    return (
      <Layout activeMenu="Sổ quỹ">
        <div className="p-4 md:p-10 max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
          <AlertTriangle className="text-red-500 w-16 h-16 animate-bounce" />
          <h2 className="text-h1 font-bold text-gray-700">Truy cập bị từ chối</h2>
          <p className="text-gray-400 font-medium">Bạn không có quyền xem thông tin Sổ quỹ tiền tệ. Vui lòng liên hệ quản trị viên để được phân quyền.</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout activeMenu="Sổ quỹ">
      <div className="p-4 md:p-10 max-w-[1800px] mx-auto flex flex-col space-y-6">
        
        {/* Toast Alerts */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-55 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Header toolbar */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4 shrink-0">
          <div>
            <nav className="flex items-center gap-2 text-label-md text-gray-400 mb-1">
              <span>Tài chính</span>
              <ChevronRight size={12} />
              <span className="text-blue-500 font-bold">Sổ quỹ tiền tệ</span>
            </nav>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[28px] font-bold text-gray-700">Quản lý Sổ quỹ & Dòng tiền</h2>
              {isAdmin && branches.length > 0 && (
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-body-md font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 shadow-sm"
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
              {!isAdmin && branchName && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-[11px] font-bold shadow-sm">
                  {branchName}
                </span>
              )}
            </div>
          </div>
          
          {/* Tabs switch */}
          <div className="flex flex-wrap bg-gray-100 p-1 rounded-lg self-start sm:self-auto gap-0.5 shadow-inner">
            {([
              ['overview', 'Tổng quan'],
              ['history', 'Phiếu thu / chi'],
              ['sessions', 'Phiên quỹ'],
              ['cashflow', 'Lịch sử dòng tiền'],
            ] as const).map(([key, label]) => {
              // Tab "Lịch sử dòng tiền" bôi đỏ để nổi bật (phục vụ đóng ca / đối soát tiền mặt)
              const isCashflow = key === 'cashflow'
              const activeCls = isCashflow ? 'bg-red-600 text-white shadow-sm' : 'bg-white text-blue-700 shadow-sm'
              const idleCls = isCashflow ? 'text-red-600 hover:text-red-700 font-bold' : 'text-gray-500 hover:text-gray-700'
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-4 py-1.5 rounded-md text-body-md font-semibold transition-all ${
                    activeTab === key ? activeCls : idleCls
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Dashboard Summary Cards — 2 khối: Tiền mặt (breakdown theo ca) + Phiên ca */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Card 1: Tiền mặt tại quỹ chi nhánh — truy nguồn theo ca đang mở */}
          <div className="lg:col-span-3 bg-white border border-gray-150 rounded-xl p-5 shadow-sm flex flex-col hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Tiền mặt tại quỹ chi nhánh</p>
                <h2 className="text-[26px] font-bold text-gray-700 tabular-nums">
                  {formatCurrency(activeSession && reconcile ? reconcile.expected : totalCashBalance)}
                </h2>
              </div>
              <div className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-md flex items-center gap-0.5">
                <TrendingUp size={14} />
                <span className="text-tiny font-bold font-mono">Tiền mặt</span>
              </div>
            </div>

            {activeSession && reconcile ? (
              /* Breakdown nguồn tiền trong ca: đầu ca + bán hàng + thu khác − chi = tồn hiện tại */
              <div className="mt-4 border-t border-gray-50 pt-3 space-y-1.5 text-tiny">
                <BreakdownRow label="Tồn đầu ca" value={formatCurrency(reconcile.opening)} />
                <BreakdownRow label="+ Tiền bán hàng" value={formatCurrency(reconcile.salesIn)} tone="emerald" />
                <BreakdownRow label="+ Thu khác" value={formatCurrency(reconcile.otherIn)} tone="emerald" />
                <BreakdownRow label="− Chi" value={formatCurrency(reconcile.totalOut)} tone="orange" />
                <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-100">
                  <span className="font-bold text-gray-700">= Tồn quỹ hiện tại</span>
                  <span className="font-bold text-emerald-600 tabular-nums text-body-md">{formatCurrency(reconcile.expected)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 border-t border-gray-50 pt-3 flex justify-between items-center text-tiny text-gray-400">
                <span className="flex items-center gap-1 text-amber-600 font-semibold">
                  <AlertTriangle size={13} /> Mở ca để bắt đầu thu/chi tiền mặt
                </span>
                <span className="font-semibold text-gray-500">{branchName}</span>
              </div>
            )}
          </div>

          {/* Card 2: Phiên ca thu ngân — hiện rõ tồn đầu ca + tồn hiện tại */}
          <div className="lg:col-span-2 bg-white border border-gray-150 rounded-xl p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Trạng thái phiên ca thu ngân</p>
                {activeSession ? (
                  <div className="mt-1">
                    <h3 className="text-body-lg font-bold text-emerald-600 flex items-center gap-1.5">
                      <Clock size={16} />
                      Đang mở ca làm việc
                    </h3>
                    <p className="text-tiny text-gray-400 mt-0.5">
                      Mở bởi: <span className="font-semibold text-gray-600">{activeSession.cashier?.full_name || 'Tôi'}</span>
                    </p>
                  </div>
                ) : (
                  <div className="mt-1">
                    <h3 className="text-body-lg font-bold text-amber-500 flex items-center gap-1.5">
                      <AlertTriangle size={16} />
                      Ca hiện tại đang ĐÓNG
                    </h3>
                    <p className="text-tiny text-gray-400 mt-0.5">Vui lòng mở ca để thu/chi tiền mặt</p>
                  </div>
                )}
              </div>

              {activeSession ? (
                <button
                  onClick={openCloseSessionModal}
                  className="px-3 h-8 bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 rounded-lg text-tiny font-bold transition-all shadow-sm flex items-center gap-1"
                >
                  Đóng ca
                </button>
              ) : (
                <button
                  onClick={() => {
                    setSessionAction('open')
                    const fundId = sessionFundId || cashFunds[0]?.id || ''
                    const fund = cashFunds.find(f => f.id === fundId)
                    setSessionFundId(fundId)
                    // Gợi ý tiền đầu ca = số dư tồn quỹ hệ thống (tiền bàn giao ca trước)
                    setSessionOpeningBal(fund ? Math.round(Number(fund.balance) || 0) : 0)
                    setSessionNotes('')
                    setIsSessionModalOpen(true)
                  }}
                  className="px-3 h-8 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-100 rounded-lg text-tiny font-bold transition-all shadow-sm flex items-center gap-1"
                >
                  Mở ca mới
                </button>
              )}
            </div>

            <div className="mt-4 border-t border-gray-50 pt-3 space-y-1 text-tiny text-gray-400">
              <div className="flex justify-between items-center">
                <span>Mã ca</span>
                <span className="font-semibold text-gray-600">{activeSession ? (activeSession.code || activeSession.id.slice(0, 8).toUpperCase()) : 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Tồn đầu ca</span>
                <span className="font-semibold text-gray-600 tabular-nums">{activeSession ? formatCurrency(activeSession.opening_balance) : '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Tồn quỹ hiện tại</span>
                <strong className="text-emerald-600 tabular-nums">
                  {activeSession ? formatCurrency(cashFunds.find(f => f.id === activeSession.cash_fund_id)?.balance ?? activeSession.opening_balance) : '—'}
                </strong>
              </div>
            </div>
          </div>
        </div>

        {/* Tab 1: Tổng quan — chỉ còn Chứng từ chờ duyệt */}
        {activeTab === 'overview' && (
          <CashbookOverview
            formatCurrency={formatCurrency}
            pendingTx={pendingTx}
            onApprove={handleApproveTransaction}
            onCancel={handleCancelTransaction}
            submitting={submitting}
            profileId={profile?.id}
          />
        )}

        {/* Tab 2: Lịch sử giao dịch / Phiếu thu chi */}
        {activeTab === 'history' && (
          <div className="grid grid-cols-12 gap-8 items-start">
            
            {/* Transactions List Table (8 cols) */}
            <div className="col-span-12 lg:col-span-8 bg-white border border-gray-150 rounded-xl shadow-sm overflow-hidden flex flex-col">
              
              {/* Toolbar & Filters */}
              <div className="p-5 border-b border-gray-100 flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-body-lg font-bold text-gray-700 flex items-center gap-2">
                    <Wallet size={18} className="text-blue-500" />
                    <span>Lịch sử sổ quỹ & dòng tiền</span>
                  </h3>
                  
                  {/* Export button */}
                  <button className="h-9 px-3 border border-gray-200 text-gray-600 rounded-lg font-semibold text-tiny flex items-center gap-1.5 hover:bg-gray-50 active:scale-95 transition-all">
                    <Download size={14} />
                    Xuất Excel
                  </button>
                </div>

                {/* Mobile Filter Row */}
                <div className="flex gap-2 lg:hidden w-full">
                  <div className="relative flex-1 flex items-center bg-gray-25 border border-gray-100 rounded-lg focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-105 h-10 transition-all">
                    <Search className="text-gray-400 ml-2.5 mr-1.5" size={16} />
                    <input
                      type="text"
                      placeholder="Tìm nội dung..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="bg-transparent border-none text-body-md w-full placeholder-gray-400 p-0 focus:outline-none focus:ring-0 text-gray-600"
                    />
                    {searchTerm && (
                      <button onClick={() => setSearchTerm('')} className="p-1 text-gray-400 hover:bg-gray-50 rounded-full mr-1">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setIsFilterSheetOpen(true)}
                    className="h-10 px-4 border border-gray-200 text-gray-600 rounded-lg font-semibold text-body-md flex items-center gap-1.5 bg-white hover:bg-gray-50 shadow-sm"
                  >
                    <span>Lọc</span>
                  </button>
                </div>

                {/* Filter Controls Row */}
                <div className="hidden lg:grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 pt-2">
                  {/* Search box */}
                  <div className="relative flex items-center bg-gray-25 border border-gray-100 rounded-lg focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100 transition-all h-9">
                    <Search className="text-gray-400 ml-2.5 mr-1.5" size={14} />
                    <input
                      type="text"
                      placeholder="Tìm nội dung..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="bg-transparent border-none text-tiny w-full placeholder-gray-400 p-0 focus:outline-none focus:ring-0"
                    />
                    {searchTerm && (
                      <button onClick={() => setSearchTerm('')} className="p-1 text-gray-400 hover:bg-gray-50 rounded-full mr-1">
                        <X size={10} />
                      </button>
                    )}
                  </div>

                  {/* Flow type */}
                  <select
                    className="h-9 px-3 bg-gray-25 border border-gray-100 rounded-lg text-tiny text-gray-600 focus:border-blue-500 focus:outline-none"
                    value={flowFilter}
                    onChange={e => setFlowFilter(e.target.value)}
                  >
                    <option value="all">Tất cả thu/chi</option>
                    <option value="inflow">Inflow (Thu tiền)</option>
                    <option value="outflow">Outflow (Chi tiền)</option>
                    <option value="internal_transfer">Chuyển quỹ nội bộ</option>
                  </select>

                  {/* Category Filter */}
                  <select
                    className="h-9 px-3 bg-gray-25 border border-gray-100 rounded-lg text-tiny text-gray-600 focus:border-blue-500 focus:outline-none"
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">Tất cả hạng mục</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.flow_type === 'inflow' ? 'Thu' : 'Chi'})</option>
                    ))}
                  </select>

                  {/* Status */}
                  <select
                    className="h-9 px-3 bg-gray-25 border border-gray-100 rounded-lg text-tiny text-gray-600 focus:border-blue-500 focus:outline-none"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="approved">Đã duyệt (Approved)</option>
                    <option value="pending_approval">Chờ duyệt (Pending)</option>
                    <option value="draft">Bản nháp (Draft)</option>
                    <option value="cancelled">Đã hủy (Cancelled)</option>
                  </select>

                  {/* Accounts */}
                  <select
                    className="h-9 px-3 bg-gray-25 border border-gray-100 rounded-lg text-tiny text-gray-600 focus:border-blue-500 focus:outline-none"
                    value={accountFilter}
                    onChange={e => setAccountFilter(e.target.value)}
                  >
                    <option value="all">Tất cả tài khoản/quỹ</option>
                    <optgroup label="Quỹ tiền mặt chi nhánh">
                      {cashFunds.map(f => (
                        <option key={f.id} value={`fund_${f.id}`}>{f.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Tài khoản Ngân hàng">
                      {bankAccounts.map(b => (
                        <option key={b.id} value={`bank_${b.id}`}>{b.bank_name} ({b.account_no.slice(-4)})</option>
                      ))}
                    </optgroup>
                  </select>

                  {/* Start Date filter */}
                  <div className="relative flex items-center bg-gray-25 border border-gray-100 rounded-lg focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100 transition-all h-9 px-2">
                    <span className="text-[10px] text-gray-400 font-bold uppercase mr-1.5 whitespace-nowrap">Từ:</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="bg-transparent border-none text-tiny w-full p-0 focus:outline-none focus:ring-0 text-gray-600"
                    />
                    {startDate && (
                      <button onClick={() => setStartDate('')} className="p-1 text-gray-400 hover:bg-gray-50 rounded-full">
                        <X size={10} />
                      </button>
                    )}
                  </div>

                  {/* End Date filter */}
                  <div className="relative flex items-center bg-gray-25 border border-gray-100 rounded-lg focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100 transition-all h-9 px-2">
                    <span className="text-[10px] text-gray-400 font-bold uppercase mr-1.5 whitespace-nowrap">Đến:</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="bg-transparent border-none text-tiny w-full p-0 focus:outline-none focus:ring-0 text-gray-600"
                    />
                    {endDate && (
                      <button onClick={() => setEndDate('')} className="p-1 text-gray-400 hover:bg-gray-50 rounded-full">
                        <X size={10} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Table Data */}
              <div className="overflow-x-auto">
                {loading ? (
                  <table className="min-w-full"><tbody><Skeleton.TableRows count={8} cols={6} /></tbody></table>
                ) : transactions.length === 0 ? (
                  <div className="h-60 flex flex-col items-center justify-center text-gray-400 gap-2 italic text-tiny">
                    Không tìm thấy giao dịch nào thỏa mãn bộ lọc.
                  </div>
                ) : (
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Mã GD</th>
                        <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Hạng mục / Ca</th>
                        <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider text-right">Số tiền</th>
                        <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Đối tượng / Ghi chú</th>
                        <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Trạng thái</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {transactions.map(tx => {
                        const isIncome = tx.flow_type === 'inflow'
                        const isTransfer = tx.flow_type === 'internal_transfer'
                        
                        let badgeColor = 'bg-gray-50 text-gray-600 border-gray-150'
                        if (isIncome) badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-100'
                        else if (tx.flow_type === 'outflow') badgeColor = 'bg-orange-50 text-orange-700 border-orange-100'
                        else if (isTransfer) badgeColor = 'bg-purple-50 text-purple-700 border-purple-100'

                        let statusColor = 'bg-gray-50 text-gray-500 border-gray-100'
                        let statusText = 'Nháp'
                        if (tx.status === 'approved') {
                          statusColor = 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          statusText = 'Đã duyệt'
                        } else if (tx.status === 'pending_approval') {
                          statusColor = 'bg-amber-50 text-amber-700 border-amber-100 animate-pulse'
                          statusText = 'Chờ duyệt'
                        } else if (tx.status === 'cancelled') {
                          statusColor = 'bg-red-50 text-red-700 border-red-100'
                          statusText = 'Đã hủy'
                        }

                        // Counterparty label
                        let counterparty = 'Khách vãng lai'
                        if (tx.customer) counterparty = `KH: ${tx.customer.farm_name || tx.customer.name}`
                        else if (tx.supplier) counterparty = `NCC: ${tx.supplier.name}`
                        else if (tx.employee) counterparty = `NV: ${tx.employee.full_name}`

                        return (
                          <tr key={tx.id} className="hover:bg-gray-25 transition-colors group">
                            {/* Code & date */}
                            <td className="px-5 py-3.5">
                              <span className="text-tiny font-bold text-blue-600 font-mono block">
                                {tx.transaction_code || 'SQ-DRAFT'}
                              </span>
                              <span className="text-[10px] text-gray-400 font-medium font-mono mt-0.5 block">
                                {new Date(tx.transaction_date).toLocaleDateString('vi-VN')}
                              </span>
                            </td>

                            {/* Category / Ca */}
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${badgeColor}`}>
                                {tx.expense_category?.name || (isTransfer ? 'Chuyển tiền nội bộ' : 'Không phân loại')}
                              </span>
                              <span className="text-[10px] text-gray-400 block mt-1">
                                {tx.cash_fund_id
                                  ? (cashFunds.find(f => f.id === tx.cash_fund_id)?.name ?? 'Quỹ tiền mặt')
                                  : (() => {
                                      const bank = bankAccounts.find(b => b.id === tx.bank_account_id)
                                      return bank ? `${bank.bank_name} ...${bank.account_no.slice(-4)}` : 'Ngân hàng'
                                    })()
                                }
                                {tx.session_id && ` · Ca #${tx.session_id.slice(0, 4).toUpperCase()}`}
                              </span>
                            </td>

                            {/* Amount */}
                            <td className="px-5 py-3.5 text-right font-bold tabular-nums text-tiny">
                              <span className={isIncome ? 'text-emerald-600' : 'text-orange-600'}>
                                {isIncome ? '+' : '-'}{formatCurrency(tx.amount)}
                              </span>
                            </td>

                            {/* Counterparty & description */}
                            <td className="px-5 py-3.5 max-w-[200px]">
                              <p className="text-tiny font-bold text-gray-700 truncate">{counterparty}</p>
                              <p className="text-[10px] text-gray-400 truncate mt-0.5">{tx.description}</p>
                            </td>

                            {/* Status */}
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusColor}`}>
                                {tx.status === 'pending_approval' && <span className="w-1 h-1 rounded-full bg-amber-500"></span>}
                                {tx.status === 'approved' && <span className="w-1 h-1 rounded-full bg-emerald-500"></span>}
                                {statusText}
                              </span>
                            </td>

                            {/* View details */}
                            <td className="px-4 py-3.5 text-right">
                              <button
                                onClick={() => {
                                  setSelectedTx(tx)
                                  setIsDetailsModalOpen(true)
                                }}
                                className="p-1 hover:bg-gray-100 text-gray-400 rounded-md transition-colors"
                              >
                                <ChevronRight size={16} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between shrink-0 bg-gray-50">
                <p className="text-tiny text-gray-400 font-medium">
                  Hiển thị {Math.min(totalCount, (currentPage - 1) * pageSize + 1)} - {Math.min(totalCount, currentPage * pageSize)} trong tổng số {totalCount} giao dịch
                </p>
                <div className="flex gap-1.5">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-white disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  
                  {Array.from({ length: Math.ceil(totalCount / pageSize) }, (_, idx) => {
                    const pageNum = idx + 1
                    // Only show 3 pages around current
                    if (Math.abs(pageNum - currentPage) > 1 && pageNum !== 1 && pageNum !== Math.ceil(totalCount / pageSize)) return null
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-tiny font-bold transition-all ${
                          currentPage === pageNum 
                            ? 'bg-blue-500 text-white shadow-sm' 
                            : 'border border-gray-200 text-gray-500 hover:bg-white'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  })}

                  <button
                    disabled={currentPage === Math.ceil(totalCount / pageSize) || totalCount === 0}
                    onClick={() => setCurrentPage(prev => prev + 1)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-white disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Action Panel / Creation Form (4 cols) */}
            <div className={`col-span-12 lg:col-span-4 space-y-6 ${
              isFormOpen 
                ? 'fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end lg:relative lg:inset-auto lg:bg-transparent lg:backdrop-filter-none lg:z-auto lg:flex-none p-0 md:p-0' 
                : 'hidden lg:block'
            }`}>
              
              {/* Add Transaction Form Card */}
              <div className={`bg-white border border-gray-150 rounded-xl p-5 shadow-sm flex flex-col ${
                isFormOpen 
                  ? 'w-full rounded-t-2xl rounded-b-none max-h-[90vh] overflow-y-auto lg:rounded-xl lg:max-h-none lg:overflow-y-visible' 
                  : ''
              }`}>
                <div className="flex items-center justify-between gap-2 mb-5 border-b border-gray-50 pb-3">
                  <div className="flex items-center gap-2">
                    <Wallet className="text-blue-500" size={18} />
                    <h3 className="text-body-lg font-bold text-gray-700">Tạo phiếu thu chi mới</h3>
                  </div>
                  {/* Close button for mobile */}
                  <button 
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="lg:hidden p-1 hover:bg-gray-100 rounded-full text-gray-400"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Form type switcher */}
                <div className="grid grid-cols-2 bg-gray-100 p-1 rounded-lg mb-4">
                  <button
                    type="button"
                    disabled={!canCreateInflow}
                    onClick={() => handleFlowTypeChange('inflow')}
                    className={`py-1.5 rounded-md text-tiny font-bold transition-all flex items-center justify-center gap-1 ${
                      formFlowType === 'inflow' 
                        ? 'bg-white text-emerald-700 shadow-sm' 
                        : 'text-gray-500'
                    } ${!canCreateInflow ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    <TrendingUp size={14} />
                    Phiếu Thu tiền
                  </button>
                  <button
                    type="button"
                    disabled={!canCreateOutflow}
                    onClick={() => handleFlowTypeChange('outflow')}
                    className={`py-1.5 rounded-md text-tiny font-bold transition-all flex items-center justify-center gap-1 ${
                      formFlowType === 'outflow' 
                        ? 'bg-white text-orange-700 shadow-sm' 
                        : 'text-gray-500'
                    } ${!canCreateOutflow ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    <TrendingDown size={14} />
                    Phiếu Chi tiền
                  </button>
                </div>

                <form onSubmit={handleTransactionSubmit} className="space-y-4">
                  {/* Category Selection */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Hạng mục thu chi</label>
                      {canManageCategories && (
                        <button type="button" onClick={() => { setNewCatFlow(formFlowType); setNewCatName(''); setIsCatModalOpen(true) }}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
                          <Settings size={12} /> Quản lý hạng mục
                        </button>
                      )}
                    </div>
                    <select
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                      value={formCategoryId}
                      onChange={e => setFormCategoryId(e.target.value)}
                    >
                      {categories.filter(c => c.flow_type === formFlowType).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {formKind && (
                      <p className="text-[11px] text-blue-600 font-semibold flex items-center gap-1 mt-0.5">
                        {formKind === 'debt' && <><HandCoins size={12} /> Thu công nợ khách hàng — sẽ tự giảm công nợ.</>}
                        {formKind === 'supplier' && <><Truck size={12} /> Thanh toán NCC — sẽ tự giảm công nợ phải trả.</>}
                        {formKind === 'advance' && <><UserCog size={12} /> Tạm ứng nhân viên — chi tiền mặt từ quỹ.</>}
                      </p>
                    )}
                  </div>

                  {/* Amount Input */}
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Số tiền (₫)</label>
                    <div className="relative flex items-center">
                      <input
                        type="number"
                        min="0"
                        placeholder="0 ₫"
                        required
                        value={formAmount === 0 ? '' : formAmount}
                        onChange={e => setFormAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full h-10 px-3 pr-8 border border-gray-150 rounded-lg text-body-md font-semibold focus:border-blue-500 focus:outline-none text-right tabular-nums"
                      />
                      <span className="absolute right-3 text-tiny text-gray-400 font-bold">₫</span>
                    </div>
                  </div>

                  {/* Transaction Date */}
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ngày giao dịch</label>
                    <input
                      type="date"
                      value={formDate}
                      max={new Date().toLocaleDateString('en-CA')}
                      onChange={e => setFormDate(e.target.value)}
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Account Payment Type */}
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Tài khoản thanh toán</label>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormAccountType('cash_fund')
                          if (cashFunds.length > 0) setFormAccountId(cashFunds[0].id)
                        }}
                        className={`h-10 rounded-lg border font-semibold text-tiny flex items-center justify-center gap-1.5 transition-all ${
                          formAccountType === 'cash_fund'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-25'
                        }`}
                      >
                        <Wallet size={14} />
                        Tiền mặt
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFormAccountType('bank_account')
                          if (bankAccounts.length > 0) setFormAccountId(bankAccounts[0].id)
                        }}
                        className={`h-10 rounded-lg border font-semibold text-tiny flex items-center justify-center gap-1.5 transition-all ${
                          formAccountType === 'bank_account'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-25'
                        }`}
                      >
                        <ShieldCheck size={14} />
                        Chuyển khoản
                      </button>
                    </div>
                    
                    {/* Account Selector dropdown */}
                    <select
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                      value={formAccountId}
                      onChange={e => setFormAccountId(e.target.value)}
                    >
                      {formAccountType === 'cash_fund' ? (
                        cashFunds.map(f => (
                          <option key={f.id} value={f.id}>{f.name} ({formatCurrency(f.balance)})</option>
                        ))
                      ) : (
                        bankAccounts.map(b => (
                          <option key={b.id} value={b.id}>{b.bank_name} - {b.account_no}</option>
                        ))
                      )}
                    </select>
                  </div>

                  {/* Đối tượng — hạng mục dẫn dắt (KH/NCC/NV) HOẶC liên kết tùy chọn */}
                  {formKind === 'debt' ? (
                    <div className="space-y-1.5">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Khách hàng cần thu nợ *</label>
                      <SmartSearchSelect options={customerOptions} value={formCustomerId} onChange={setFormCustomerId}
                        placeholder="-- Chọn khách hàng --" searchPlaceholder="Tìm khách hàng..." />
                      {counterpartyDebt !== null && (
                        <p className={`text-tiny font-semibold ${counterpartyDebt > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                          Công nợ hiện tại: {formatCurrency(counterpartyDebt)}
                          {counterpartyDebt > 0 && (
                            <button type="button" onClick={() => setFormAmount(counterpartyDebt)} className="ml-2 text-blue-600 underline">Thu toàn bộ</button>
                          )}
                        </p>
                      )}
                    </div>
                  ) : formKind === 'supplier' ? (
                    <div className="space-y-1.5">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Nhà cung cấp *</label>
                      <SmartSearchSelect options={supplierOptions} value={formSupplierId} onChange={setFormSupplierId}
                        placeholder="-- Chọn nhà cung cấp --" searchPlaceholder="Tìm nhà cung cấp..." />
                      {counterpartyDebt !== null && (
                        <p className={`text-tiny font-semibold ${counterpartyDebt > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                          Công nợ phải trả: {formatCurrency(counterpartyDebt)}
                          {counterpartyDebt > 0 && (
                            <button type="button" onClick={() => setFormAmount(counterpartyDebt)} className="ml-2 text-blue-600 underline">Trả toàn bộ</button>
                          )}
                        </p>
                      )}
                    </div>
                  ) : formKind === 'advance' ? (
                    <div className="space-y-1.5">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Nhân viên tạm ứng *</label>
                      <SmartSearchSelect options={employeeOptions} value={formEmployeeId} onChange={setFormEmployeeId}
                        placeholder="-- Chọn nhân viên --" searchPlaceholder="Tìm nhân viên..." />
                      <div className="space-y-1 pt-1">
                        <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Hạn hoàn ứng</label>
                        <input type="date" value={formAdvanceDueDate} onChange={e => setFormAdvanceDueDate(e.target.value)}
                          className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Đối tượng liên quan (tùy chọn)</label>
                      <div className="grid grid-cols-4 bg-gray-100 p-1 rounded-lg">
                        {['none', 'customer', 'supplier', 'employee'].map(type => (
                          <button key={type} type="button" onClick={() => setFormCounterpartyType(type as any)}
                            className={`py-1 rounded text-[10px] font-bold transition-all ${
                              formCounterpartyType === type ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}>
                            {type === 'none' && 'Không'}
                            {type === 'customer' && 'Khách'}
                            {type === 'supplier' && 'NCC'}
                            {type === 'employee' && 'N.Viên'}
                          </button>
                        ))}
                      </div>
                      {formCounterpartyType === 'customer' && (
                        <SmartSearchSelect options={customerOptions} value={formCustomerId} onChange={setFormCustomerId}
                          placeholder="-- Chọn khách hàng --" searchPlaceholder="Tìm khách hàng..." />
                      )}
                      {formCounterpartyType === 'supplier' && (
                        <SmartSearchSelect options={supplierOptions} value={formSupplierId} onChange={setFormSupplierId}
                          placeholder="-- Chọn nhà cung cấp --" searchPlaceholder="Tìm nhà cung cấp..." />
                      )}
                      {formCounterpartyType === 'employee' && (
                        <SmartSearchSelect options={employeeOptions} value={formEmployeeId} onChange={setFormEmployeeId}
                          placeholder="-- Chọn nhân viên --" searchPlaceholder="Tìm nhân viên..." />
                      )}
                    </div>
                  )}

                  {/* Reference No */}
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Mã chứng từ / Số tham chiếu</label>
                    <input
                      type="text"
                      placeholder="VD: VCB-1092837, PO-001..."
                      value={formReferenceNo}
                      onChange={e => setFormReferenceNo(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">
                      {formKind === 'advance' ? 'Lý do tạm ứng *' : formKind ? 'Ghi chú' : 'Nội dung giao dịch *'}
                    </label>
                    <textarea
                      rows={2}
                      required={!formKind || formKind === 'advance'}
                      placeholder={formKind === 'advance' ? 'VD: Đi công tác miền Tây 3 ngày...' : 'Nhập chi tiết lý do thu/chi...'}
                      value={formDescription}
                      onChange={e => setFormDescription(e.target.value)}
                      className="w-full p-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none"
                    />
                  </div>

                  {/* Attachments */}
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Đính kèm (ảnh hóa đơn/biên lai)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Nhập link ảnh/file..."
                        value={formAttachmentUrl}
                        onChange={e => setFormAttachmentUrl(e.target.value)}
                        className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddAttachment}
                        className="h-10 px-3 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 flex items-center justify-center shrink-0"
                      >
                        <Upload size={16} />
                      </button>
                    </div>

                    {formAttachments.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {formAttachments.map((att, i) => (
                          <div key={i} className="flex justify-between items-center bg-gray-50 p-2 rounded-lg border border-gray-100 text-tiny">
                            <span className="truncate max-w-[200px] text-gray-600 font-mono font-medium">{att}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachment(i)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Alert if Outflow > 10M */}
                  {formFlowType === 'outflow' && formAmount > 10000000 && (
                    <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg flex gap-2 text-tiny text-amber-800 leading-relaxed font-medium">
                      <AlertTriangle size={16} className="shrink-0 text-amber-500" />
                      <span>Phiếu chi &gt; 10,000,000 ₫ sẽ ở trạng thái <b>Chờ duyệt</b> và cần Admin / Giám đốc chi nhánh duyệt để cập nhật số dư.</span>
                    </div>
                  )}

                  {/* Submit Button */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={
                        submitting || 
                        (formFlowType === 'inflow' && !canCreateInflow) || 
                        (formFlowType === 'outflow' && !canCreateOutflow)
                      }
                      className="w-full h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all text-body-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? 'Đang lưu...' : 'Xác nhận lưu phiếu'}
                    </button>
                    {((formFlowType === 'inflow' && !canCreateInflow) || (formFlowType === 'outflow' && !canCreateOutflow)) && (
                      <p className="text-[10px] text-red-500 mt-1 font-semibold text-center">
                        Bạn không có quyền lập phiếu {formFlowType === 'inflow' ? 'thu' : 'chi'}.
                      </p>
                    )}
                  </div>
                </form>
              </div>

              {/* Informative Rule Box */}
              <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5 lg:flex hidden gap-3 text-tiny text-gray-600 leading-relaxed">
                <ShieldCheck size={18} className="shrink-0 text-blue-500" />
                <div>
                  <h4 className="font-bold text-gray-700 mb-1">Quy trình kiểm soát quỹ</h4>
                  <p>Mọi giao dịch tiền mặt đều tự động liên kết với phiên ca hoạt động. Mở ca ban đầu và đóng ca đối soát cuối ngày là bắt buộc đối với thủ quỹ.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Lịch sử dòng tiền */}
        {activeTab === 'cashflow' && (
          <CashbookReports
            cashFunds={cashFunds}
            bankAccounts={bankAccounts}
            formatCurrency={formatCurrency}
          />
        )}

        {/* Tab 3: Phiên quỹ / Ca làm việc (Cashier Sessions) */}
        {activeTab === 'sessions' && (
          <div className="bg-white border border-gray-150 rounded-xl p-6 shadow-sm flex flex-col space-y-6">
            <div className="flex justify-between items-center border-b border-gray-50 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="text-blue-500" size={18} />
                <h3 className="text-body-lg font-bold text-gray-700">Lịch sử mở/đóng ca đối soát</h3>
              </div>
            </div>

            {/* List of Sessions */}
            <div>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Phiên ca</th>
                      <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Người mở</th>
                      <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Mở lúc</th>
                      <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider text-right">Số dư mở ca</th>
                      <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider text-right">Số dư đóng ca (hệ thống)</th>
                      <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider text-right">Thực tế (variance)</th>
                      <th className="px-5 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-tiny text-gray-400 italic">
                          Không có dữ liệu phiên ca nào.
                        </td>
                      </tr>
                    ) : (
                      sessions.map(s => {
                        const isClosed = s.status === 'closed'
                        const varVal = s.variance || 0

                        return (
                          <tr key={s.id} className="hover:bg-gray-25 transition-colors text-tiny">
                            <td className="px-5 py-3 font-bold font-mono text-gray-600">
                              {s.id.slice(0, 8).toUpperCase()}
                            </td>
                            <td className="px-5 py-3 font-semibold text-gray-700">
                              {s.cashier?.full_name || 'N/A'}
                            </td>
                            <td className="px-5 py-3 text-gray-500 font-mono">
                              {new Date(s.opened_at).toLocaleString('vi-VN')}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-700 tabular-nums">
                              {formatCurrency(s.opening_balance)}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-700 tabular-nums">
                              {isClosed ? formatCurrency(s.closing_balance || 0) : '—'}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold tabular-nums">
                              {isClosed ? (
                                <div className="flex flex-col items-end">
                                  <span>{formatCurrency(s.cash_actual || 0)}</span>
                                  <span className={`text-[10px] ${varVal > 0 ? 'text-emerald-600' : varVal < 0 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                    ({varVal > 0 ? '+' : ''}{formatCurrency(varVal)})
                                  </span>
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                                s.status === 'open' 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                  : 'bg-gray-50 text-gray-500 border-gray-150'
                              }`}>
                                {s.status === 'open' ? 'Đang mở' : 'Đã đóng'}
                              </span>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="block md:hidden space-y-4">
                {sessions.length === 0 ? (
                  <div className="p-8 text-center text-tiny text-gray-400 italic">
                    Không có dữ liệu phiên ca nào.
                  </div>
                ) : (
                  sessions.map(s => {
                    const isClosed = s.status === 'closed'
                    const varVal = s.variance || 0
                    return (
                      <div
                        key={s.id}
                        className="p-4 bg-white rounded-xl border border-gray-150 shadow-sm space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-tiny font-bold font-mono text-gray-600 block">
                              Ca #{s.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span className="text-[10px] text-gray-400 block mt-0.5 font-mono">
                              Mở: {new Date(s.opened_at).toLocaleString('vi-VN')}
                            </span>
                          </div>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                            s.status === 'open' 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                              : 'bg-gray-50 text-gray-500 border-gray-150'
                          }`}>
                            {s.status === 'open' ? 'Đang mở' : 'Đã đóng'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-tiny pt-2 border-t border-gray-50">
                          <div>
                            <span className="text-gray-400 block">Người mở</span>
                            <span className="font-semibold text-gray-700">{s.cashier?.full_name || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block text-right">Đầu ca</span>
                            <span className="font-semibold text-gray-700 block text-right tabular-nums">{formatCurrency(s.opening_balance)}</span>
                          </div>
                        </div>

                        {isClosed && (
                          <div className="grid grid-cols-2 gap-3 text-tiny pt-2 border-t border-gray-50">
                            <div>
                              <span className="text-gray-400 block">Cuối ca (Hệ thống)</span>
                              <span className="font-semibold text-gray-700 tabular-nums">{formatCurrency(s.closing_balance || 0)}</span>
                            </div>
                            <div>
                              <span className="text-gray-400 block text-right">Thực tế</span>
                              <span className="font-semibold text-gray-700 block text-right tabular-nums">{formatCurrency(s.cash_actual || 0)}</span>
                            </div>
                            <div className="col-span-2 flex justify-between items-center pt-1 border-t border-gray-50 mt-1">
                              <span className="text-gray-400">Chênh lệch:</span>
                              <span className={`font-bold tabular-nums ${varVal > 0 ? 'text-emerald-600' : varVal < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                                {varVal > 0 ? '+' : ''}{formatCurrency(varVal)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODAL 1: TRANSACTION DETAILS MODAL */}
        {isDetailsModalOpen && selectedTx && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <div>
                  <h3 className="text-body-lg font-bold text-gray-700">Chi tiết phiếu giao dịch</h3>
                  <span className="text-[10px] text-gray-400 font-bold font-mono uppercase mt-0.5 block">Mã: {selectedTx.transaction_code || 'SQ-DRAFT'}</span>
                </div>
                <button onClick={() => { setIsDetailsModalOpen(false); setSelectedTx(null) }} className="p-1 hover:bg-gray-100 rounded-full text-gray-400"><X size={20} /></button>
              </div>

              <div className="p-6 space-y-4">
                {/* Visual Status Indicator */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-50 border border-gray-100 rounded-lg">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-bold">Số tiền</span>
                    <span className={`text-body-lg font-bold tabular-nums block mt-1 ${selectedTx.flow_type === 'inflow' ? 'text-emerald-600' : 'text-orange-600'}`}>
                      {selectedTx.flow_type === 'inflow' ? '+' : '-'}{formatCurrency(selectedTx.amount)}
                    </span>
                  </div>
                  <div className="p-3 bg-gray-50 border border-gray-100 rounded-lg">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-bold">Trạng thái</span>
                    <span className="text-body-md font-bold text-gray-700 block mt-1 uppercase tracking-wide">
                      {selectedTx.status === 'approved' && 'Đã phê duyệt'}
                      {selectedTx.status === 'pending_approval' && 'Chờ duyệt'}
                      {selectedTx.status === 'draft' && 'Bản nháp'}
                      {selectedTx.status === 'cancelled' && 'Đã hủy'}
                    </span>
                  </div>
                </div>

                {/* Details list */}
                <div className="space-y-3.5 border-t border-gray-50 pt-4">
                  <div className="flex justify-between text-tiny">
                    <span className="text-gray-400 font-medium">Hạng mục thu chi:</span>
                    <span className="font-bold text-gray-700">{selectedTx.expense_category?.name || (selectedTx.flow_type === 'internal_transfer' ? 'Chuyển quỹ nội bộ' : 'Không có')}</span>
                  </div>
                  <div className="flex justify-between text-tiny">
                    <span className="text-gray-400 font-medium">Tài khoản/Quỹ:</span>
                    <span className="font-bold text-gray-700">
                      {selectedTx.cash_fund_id
                        ? (cashFunds.find(f => f.id === selectedTx.cash_fund_id)?.name ?? 'Quỹ tiền mặt')
                        : (() => {
                            const bank = bankAccounts.find(b => b.id === selectedTx.bank_account_id)
                            return bank ? `${bank.bank_name} (...${bank.account_no.slice(-4)})` : 'Tài khoản ngân hàng'
                          })()
                      }
                    </span>
                  </div>
                  <div className="flex justify-between text-tiny">
                    <span className="text-gray-400 font-medium">Ngày giao dịch:</span>
                    <span className="font-semibold text-gray-600 font-mono">{new Date(selectedTx.transaction_date).toLocaleDateString('vi-VN')}</span>
                  </div>
                  <div className="flex justify-between text-tiny">
                    <span className="text-gray-400 font-medium">Đối tượng thụ hưởng:</span>
                    <span className="font-bold text-gray-700">
                      {selectedTx.customer && `Khách: ${selectedTx.customer.farm_name || selectedTx.customer.name}`}
                      {selectedTx.supplier && `NCC: ${selectedTx.supplier.name}`}
                      {selectedTx.employee && `Nhân viên: ${selectedTx.employee.full_name}`}
                      {!selectedTx.customer && !selectedTx.supplier && !selectedTx.employee && 'Khách lẻ / Khác'}
                    </span>
                  </div>
                  <div className="flex justify-between text-tiny">
                    <span className="text-gray-400 font-medium">Số chứng từ tham chiếu:</span>
                    <span className="font-semibold text-gray-600 font-mono">{selectedTx.reference_no || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-tiny">
                    <span className="text-gray-400 font-medium">Người tạo phiếu:</span>
                    <span className="font-bold text-gray-700">{selectedTx.creator?.full_name || 'Hệ thống'}</span>
                  </div>
                  {selectedTx.status === 'approved' && selectedTx.approved_by && (
                    <div className="flex justify-between text-tiny">
                      <span className="text-gray-400 font-medium">Người phê duyệt:</span>
                      <span className="font-bold text-emerald-700">{selectedTx.approver?.full_name || 'N/A'}</span>
                    </div>
                  )}
                  <div className="flex flex-col text-tiny space-y-1.5 pt-2 border-t border-gray-50">
                    <span className="text-gray-400 font-medium">Nội dung chi tiết:</span>
                    <p className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-gray-700 leading-relaxed font-medium">{selectedTx.description}</p>
                  </div>

                  {/* Attachments view */}
                  {selectedTx.attachments && selectedTx.attachments.length > 0 && (
                    <div className="space-y-1.5 pt-2">
                      <span className="text-tiny text-gray-400 font-medium">Tệp đính kèm:</span>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedTx.attachments.map((att, i) => (
                          <a
                            key={i}
                            href={att}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-gray-25 hover:bg-gray-50 border border-gray-100 p-2.5 rounded-lg flex items-center justify-between text-tiny text-blue-600 font-bold truncate transition-colors"
                          >
                            <span className="truncate">{att}</span>
                            <Upload size={14} className="shrink-0 ml-1.5" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Actions based on user role and status */}
              <div className="px-6 py-4 bg-gray-25 border-t border-gray-100 flex justify-between items-center gap-3">
                {/* Print button — chỉ hiện khi giao dịch đã approved và là thu/chi */}
                {selectedTx.status === 'approved' && selectedTx.flow_type !== 'internal_transfer' && (
                  <button
                    onClick={() => window.open(
                      `/print-preview?type=${selectedTx.flow_type === 'inflow' ? 'cash_in' : 'cash_out'}&id=${selectedTx.id}`,
                      '_blank'
                    )}
                    className="h-10 px-4 border border-gray-200 text-gray-600 rounded-lg font-semibold hover:bg-gray-50 flex items-center gap-2 transition-colors"
                    title="In phiếu thu/chi chuyên nghiệp"
                  >
                    <Printer size={15} />
                    <span>In phiếu</span>
                  </button>
                )}
                <div className="flex gap-3 ml-auto">
                <button
                  onClick={() => { setIsDetailsModalOpen(false); setSelectedTx(null) }}
                  className="h-10 px-4 border border-gray-250 text-gray-600 rounded-lg font-semibold hover:bg-gray-50"
                >
                  Đóng
                </button>
                
                {/* Cancel pending or draft */}
                {(selectedTx.status === 'draft' || selectedTx.status === 'pending_approval') && (
                  <button
                    onClick={() => handleCancelTransaction(selectedTx.id)}
                    disabled={submitting}
                    className="h-10 px-4 bg-red-50 hover:bg-red-100 border border-red-100 text-red-600 rounded-lg font-semibold transition-all shadow-sm"
                  >
                    Hủy phiếu
                  </button>
                )}

                {/* Approve Pending Outflows */}
                {selectedTx.status === 'pending_approval' && (profile?.id) && (
                  <button
                    onClick={() => handleApproveTransaction(selectedTx.id)}
                    disabled={submitting}
                    className="h-10 px-5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-all shadow-sm active:scale-95"
                  >
                    Phê duyệt xuất quỹ
                  </button>
                )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 2: CASHIER SESSION ACTIONS (OPEN/CLOSE) */}
        {isSessionModalOpen && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
                <h3 className="text-body-lg font-bold text-gray-700 flex items-center gap-2">
                  <Clock className="text-blue-500" size={18} />
                  <span>
                    {sessionAction === 'open' ? 'Mở ca làm việc mới' : 'Đóng ca & đối soát quỹ'}
                  </span>
                </h3>
                <button onClick={() => setIsSessionModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-full text-gray-400"><X size={20} /></button>
              </div>

              {sessionAction === 'open' ? (
                // OPEN SESSION FORM
                <form onSubmit={handleOpenSession}>
                  <div className="p-6 space-y-4">
                    <p className="text-tiny text-gray-500 leading-relaxed font-medium">
                      Bắt đầu ca làm việc mới của bạn. Vui lòng nhập số tiền mặt đầu ca đếm được trong ngăn kéo đựng tiền.
                    </p>
                    
                    <div className="space-y-1">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Két / Quỹ tiền mặt *</label>
                      <select
                        className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                        value={sessionFundId}
                        onChange={e => {
                          const id = e.target.value
                          setSessionFundId(id)
                          const f = cashFunds.find(x => x.id === id)
                          setSessionOpeningBal(f ? Math.round(Number(f.balance) || 0) : 0)
                        }}
                        disabled={cashFunds.length <= 1}
                      >
                        {cashFunds.map(f => (
                          <option key={f.id} value={f.id}>
                            {f.name} ({formatCurrency(f.balance)}){f.is_default_cash ? ' • Mặc định' : ''}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const f = cashFunds.find(x => x.id === (sessionFundId || cashFunds[0]?.id))
                        if (f && f.is_default_cash === false) {
                          return (
                            <p className="text-[11px] text-amber-600 font-medium flex items-start gap-1 mt-1">
                              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                              Quỹ này KHÔNG phải quỹ mặc định. Tiền mặt bán hàng POS tự ghi vào quỹ mặc định nên có thể không khớp ca này.
                            </p>
                          )
                        }
                        return null
                      })()}
                    </div>

                    <div className="space-y-1">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Tiền mặt đầu ca (₫) *</label>
                      <p className="text-[11px] text-gray-400 -mt-0.5">Gợi ý theo tồn quỹ hệ thống (tiền bàn giao ca trước) — sửa lại nếu đếm khác.</p>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min="0"
                          required
                          placeholder="0 ₫"
                          value={sessionOpeningBal === 0 ? '' : sessionOpeningBal}
                          onChange={e => setSessionOpeningBal(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full h-10 px-3 pr-8 border border-gray-150 rounded-lg text-body-md font-semibold focus:border-blue-500 focus:outline-none text-right tabular-nums"
                        />
                        <span className="absolute right-3 text-tiny text-gray-400 font-bold">₫</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ghi chú mở ca</label>
                      <textarea
                        rows={2}
                        placeholder="Số seri két, bàn giao từ ai..."
                        value={sessionNotes}
                        onChange={e => setSessionNotes(e.target.value)}
                        className="w-full p-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none"
                      />
                    </div>
                  </div>

                  <div className="p-6 bg-gray-25 border-t border-gray-100 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setIsSessionModalOpen(false)}
                      className="h-10 px-4 border border-gray-250 text-gray-600 rounded-lg font-semibold hover:bg-gray-50"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all"
                    >
                      Bắt đầu mở ca
                    </button>
                  </div>
                </form>
              ) : (
                // CLOSE SESSION FORM (WITH RECONCILIATION)
                <form onSubmit={handleCloseSession}>
                  <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                    <p className="text-tiny text-gray-500 leading-relaxed font-medium">
                      Đối soát tiền mặt cuối ca — hệ thống tổng hợp mọi khoản thu/chi <strong>tiền mặt</strong> trong ca để bạn biết tồn quỹ dự kiến, rồi nhập số tiền đếm thực tế trong két.
                    </p>

                    {/* BẢNG ĐỐI SOÁT TIỀN MẶT */}
                    {reconcileLoading ? (
                      <div className="py-6 text-center text-tiny text-gray-400">Đang tính đối soát ca...</div>
                    ) : reconcile ? (
                      <div className="rounded-xl border border-gray-150 overflow-hidden text-body-md bg-white">
                        <div className="px-4 py-2.5 bg-gray-25 flex justify-between items-center">
                          <span className="text-gray-500 font-medium">Tồn quỹ đầu ca</span>
                          <span className="font-semibold tabular-nums text-gray-700">{formatCurrency(reconcile.opening)}</span>
                        </div>

                        {/* Thu tiền mặt */}
                        <div className="px-4 py-2.5 border-t border-gray-100">
                          <div className="flex justify-between text-emerald-700 font-semibold">
                            <span>+ Thu tiền mặt trong ca</span>
                            <span className="tabular-nums">{formatCurrency(reconcile.totalIn)}</span>
                          </div>
                          {reconcile.inflowGroups.length > 0 ? reconcile.inflowGroups.map(g => (
                            <div key={g.label} className="flex justify-between text-tiny text-gray-500 pl-3 mt-1">
                              <span>{g.label}</span>
                              <span className="tabular-nums">{formatCurrency(g.amount)}</span>
                            </div>
                          )) : <p className="text-tiny text-gray-300 pl-3 mt-1">Chưa có khoản thu tiền mặt</p>}
                        </div>

                        {/* Chi tiền mặt */}
                        <div className="px-4 py-2.5 border-t border-gray-100">
                          <div className="flex justify-between text-red-600 font-semibold">
                            <span>− Chi tiền mặt trong ca</span>
                            <span className="tabular-nums">{formatCurrency(reconcile.totalOut)}</span>
                          </div>
                          {reconcile.outflowGroups.length > 0 ? reconcile.outflowGroups.map(g => (
                            <div key={g.label} className="flex justify-between text-tiny text-gray-500 pl-3 mt-1">
                              <span>{g.label}</span>
                              <span className="tabular-nums">{formatCurrency(g.amount)}</span>
                            </div>
                          )) : <p className="text-tiny text-gray-300 pl-3 mt-1">Chưa có khoản chi tiền mặt</p>}
                        </div>

                        {/* Tồn dự kiến */}
                        <div className="px-4 py-3 border-t border-gray-150 bg-blue-50 flex justify-between items-center">
                          <span className="font-bold text-blue-700">= Tồn quỹ dự kiến</span>
                          <span className="font-bold text-blue-700 text-body-lg tabular-nums">{formatCurrency(reconcile.expected)}</span>
                        </div>

                        {/* Chuyển khoản (tham khảo) */}
                        {(reconcile.bankIn > 0 || reconcile.bankOut > 0) && (
                          <div className="px-4 py-2.5 border-t border-gray-100 bg-indigo-50/40 text-tiny">
                            <p className="font-semibold text-indigo-600 mb-1">Chuyển khoản phát sinh trong ca (KHÔNG nằm trong két tiền mặt):</p>
                            <div className="flex justify-between text-gray-500"><span>Thu chuyển khoản</span><span className="tabular-nums">{formatCurrency(reconcile.bankIn)}</span></div>
                            <div className="flex justify-between text-gray-500"><span>Chi chuyển khoản</span><span className="tabular-nums">{formatCurrency(reconcile.bankOut)}</span></div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    <div className="space-y-1">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Tiền mặt thực tế đếm được (₫) *</label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min="0"
                          required
                          placeholder="0 ₫"
                          value={sessionActualClose === 0 ? '' : sessionActualClose}
                          onChange={e => setSessionActualClose(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full h-10 px-3 pr-8 border border-gray-150 rounded-lg text-body-md font-semibold focus:border-blue-500 focus:outline-none text-right tabular-nums"
                        />
                        <span className="absolute right-3 text-tiny text-gray-400 font-bold">₫</span>
                      </div>
                    </div>

                    {/* Chênh lệch trực tiếp */}
                    {reconcile && sessionActualClose > 0 && (() => {
                      const v = sessionActualClose - reconcile.expected
                      const cls = v === 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : v > 0 ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-red-50 text-red-600 border-red-200'
                      return (
                        <div className={`flex justify-between items-center px-4 py-2.5 rounded-lg border font-bold ${cls}`}>
                          <span>{v === 0 ? '✓ Khớp quỹ' : v > 0 ? '▲ Thừa quỹ' : '▼ Thiếu quỹ'}</span>
                          <span className="tabular-nums">{v > 0 ? '+' : ''}{formatCurrency(v)}</span>
                        </div>
                      )
                    })()}

                    <div className="space-y-1">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Lý do chênh lệch (nếu có)</label>
                      <input
                        type="text"
                        placeholder="VD: Thừa 50k thối khách quên lấy, bù tiền mặt..."
                        value={sessionVarianceReason}
                        onChange={e => setSessionVarianceReason(e.target.value)}
                        className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    {/* Nộp quỹ cuối ca — giao tiền về công ty (phiếu chi nội bộ) */}
                    <div className="space-y-1 p-3 bg-orange-50/50 border border-orange-100 rounded-lg">
                      <div className="flex items-center justify-between">
                        <label className="block text-tiny font-bold text-orange-700 uppercase tracking-wider">Số tiền nộp về công ty (₫)</label>
                        {sessionActualClose > 0 && (
                          <button type="button" onClick={() => setSessionNopAmount(sessionActualClose)} className="text-[11px] text-blue-600 underline font-semibold">Nộp toàn bộ</button>
                        )}
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="number" min="0" max={sessionActualClose || undefined} placeholder="0 ₫"
                          value={sessionNopAmount === 0 ? '' : sessionNopAmount}
                          onChange={e => setSessionNopAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full h-10 px-3 pr-8 border border-orange-200 rounded-lg text-body-md font-semibold focus:border-orange-400 focus:outline-none text-right tabular-nums"
                        />
                        <span className="absolute right-3 text-tiny text-gray-400 font-bold">₫</span>
                      </div>
                      <p className="text-[11px] text-orange-700/80 flex justify-between pt-0.5">
                        <span>Tồn để lại đầu ca sau:</span>
                        <strong className="tabular-nums">{formatCurrency(Math.max(0, sessionActualClose - sessionNopAmount))}</strong>
                      </p>
                      <p className="text-[10px] text-gray-400 italic">Sinh phiếu chi "Nộp quỹ cuối ca" (không tính vào lãi/lỗ) — két còn lại đúng tiền để lại.</p>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ghi chú đóng ca</label>
                      <textarea
                        rows={2}
                        placeholder="Số két cuối ngày, chi tiết khác..."
                        value={sessionNotes}
                        onChange={e => setSessionNotes(e.target.value)}
                        className="w-full p-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none"
                      />
                    </div>
                  </div>

                  <div className="p-6 bg-gray-25 border-t border-gray-100 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setIsSessionModalOpen(false)}
                      className="h-10 px-4 border border-gray-250 text-gray-600 rounded-lg font-semibold hover:bg-gray-50"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="h-10 px-5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all"
                    >
                      Xác nhận đóng ca
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
        {/* Mobile FAB Button */}
        {activeTab === 'history' && !isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="lg:hidden fixed bottom-6 right-6 z-40 w-14 h-14 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all"
            title="Tạo phiếu thu chi mới"
          >
            <Wallet size={24} />
          </button>
        )}

        {/* Mobile Filter Sheet */}
        {isFilterSheetOpen && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end lg:hidden">
            <div className="bg-white w-full rounded-t-2xl max-h-[85vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom duration-250 flex flex-col">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25 sticky top-0 z-10">
                <h3 className="text-body-lg font-bold text-gray-700">Bộ lọc tìm kiếm</h3>
                <button onClick={() => setIsFilterSheetOpen(false)} className="p-1 hover:bg-gray-100 rounded-full text-gray-400"><X size={20} /></button>
              </div>
              
              <div className="p-6 space-y-4">
                {/* Flow type */}
                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Loại giao dịch</label>
                  <select
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-650 focus:border-blue-500 focus:outline-none"
                    value={flowFilter}
                    onChange={e => setFlowFilter(e.target.value)}
                  >
                    <option value="all">Tất cả thu/chi</option>
                    <option value="inflow">Inflow (Thu tiền)</option>
                    <option value="outflow">Outflow (Chi tiền)</option>
                    <option value="internal_transfer">Chuyển quỹ nội bộ</option>
                  </select>
                </div>

                {/* Category Filter */}
                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Hạng mục</label>
                  <select
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-655 focus:border-blue-500 focus:outline-none text-gray-600"
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">Tất cả hạng mục</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.flow_type === 'inflow' ? 'Thu' : 'Chi'})</option>
                    ))}
                  </select>
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Trạng thái</label>
                  <select
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-655 focus:border-blue-500 focus:outline-none text-gray-600"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="approved">Đã duyệt (Approved)</option>
                    <option value="pending_approval">Chờ duyệt (Pending)</option>
                    <option value="draft">Bản nháp (Draft)</option>
                    <option value="cancelled">Đã hủy (Cancelled)</option>
                  </select>
                </div>

                {/* Accounts */}
                <div className="space-y-1">
                  <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Tài khoản/Quỹ</label>
                  <select
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-655 focus:border-blue-500 focus:outline-none text-gray-600"
                    value={accountFilter}
                    onChange={e => setAccountFilter(e.target.value)}
                  >
                    <option value="all">Tất cả tài khoản/quỹ</option>
                    <optgroup label="Quỹ tiền mặt chi nhánh">
                      {cashFunds.map(f => (
                        <option key={f.id} value={`fund_${f.id}`}>{f.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Tài khoản Ngân hàng">
                      {bankAccounts.map(b => (
                        <option key={b.id} value={`bank_${b.id}`}>{b.bank_name} ({b.account_no.slice(-4)})</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {/* Date filters */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Từ ngày</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-655 focus:border-blue-500 focus:outline-none text-gray-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Đến ngày</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-655 focus:border-blue-500 focus:outline-none text-gray-600"
                    />
                  </div>
                </div>

                {/* Action button */}
                <div className="pt-4 flex gap-3">
                  <button
                    onClick={() => {
                      setFlowFilter('all')
                      setStatusFilter('all')
                      setCategoryFilter('all')
                      setAccountFilter('all')
                      setStartDate('')
                      setEndDate('')
                    }}
                    className="flex-1 h-11 border border-gray-250 text-gray-650 font-semibold rounded-lg hover:bg-gray-50 active:scale-95 transition-all text-body-md"
                  >
                    Xóa bộ lọc
                  </button>
                  <button
                    onClick={() => setIsFilterSheetOpen(false)}
                    className="flex-1 h-11 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all text-body-md"
                  >
                    Áp dụng
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: QUẢN LÝ HẠNG MỤC THU/CHI */}
        {isCatModalOpen && (
          <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Settings size={18} className="text-blue-500" />
                  <h3 className="text-body-lg font-bold text-gray-700">Quản lý hạng mục thu/chi</h3>
                </div>
                <button onClick={() => setIsCatModalOpen(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>

              <form onSubmit={handleSaveCategory} className="p-5 space-y-3 border-b border-gray-100">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setNewCatFlow('inflow')}
                    className={`h-9 rounded-lg border font-semibold text-tiny transition-all ${newCatFlow === 'inflow' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>Hạng mục Thu</button>
                  <button type="button" onClick={() => setNewCatFlow('outflow')}
                    className={`h-9 rounded-lg border font-semibold text-tiny transition-all ${newCatFlow === 'outflow' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500'}`}>Hạng mục Chi</button>
                </div>
                <div className="flex gap-2">
                  <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                    placeholder="VD: Chi phí điện nước, Thu cho thuê kho..."
                    className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
                  <button type="submit" disabled={savingCat}
                    className="h-10 px-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all flex items-center gap-1 shrink-0 disabled:opacity-60">
                    <Plus size={16} /> Thêm
                  </button>
                </div>
              </form>

              <div className="p-5 overflow-y-auto space-y-1.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Hạng mục {newCatFlow === 'inflow' ? 'Thu' : 'Chi'} hiện có
                </p>
                {categories.filter(c => c.flow_type === newCatFlow).map(c => {
                  const isSystem = !!specialKindOf(c.code) || c.is_internal || c.code === 'THU-DON-HANG' || c.code === 'CHI-HOANTIEN'
                  return (
                    <div key={c.id} className="flex items-center justify-between bg-gray-25 border border-gray-100 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <span className="text-tiny font-semibold text-gray-700 truncate block">{c.name}</span>
                        <span className="text-[10px] text-gray-400 font-mono">{c.code}{c.is_internal ? ' · nội bộ' : ''}</span>
                      </div>
                      {isSystem ? (
                        <span className="text-[10px] text-gray-400 font-semibold shrink-0">Hệ thống</span>
                      ) : (
                        <button onClick={() => handleDeactivateCategory(c)} className="text-red-500 hover:text-red-700 shrink-0" title="Tắt hạng mục">
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  )
}

// Dòng breakdown nguồn tiền trong thẻ "Tiền mặt tại quỹ chi nhánh"
function BreakdownRow({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'orange' }) {
  const valueCls = tone === 'emerald' ? 'text-emerald-600' : tone === 'orange' ? 'text-orange-600' : 'text-gray-600'
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold tabular-nums ${valueCls}`}>{value}</span>
    </div>
  )
}
