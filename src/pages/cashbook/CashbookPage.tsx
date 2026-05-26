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
  ArrowLeftRight,
  Clock
} from 'lucide-react'
import Layout from '../../components/Layout'
import { useRealtimeTable } from '../../hooks/useRealtimeTable'
import { Skeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface CashFund {
  id: string
  code: string
  name: string
  balance: number
  currency: string
  is_active: boolean
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

interface ExpenseCategory {
  id: string
  code: string
  name: string
  flow_type: 'inflow' | 'outflow'
  is_active: boolean
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
  const { profile } = useAuth()

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'overview' | 'transfers' | 'sessions'>('overview')

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

  // Cashier Session Form State
  const [sessionOpeningBal, setSessionOpeningBal] = useState(0)
  const [sessionActualClose, setSessionActualClose] = useState(0)
  const [sessionNotes, setSessionNotes] = useState('')
  const [sessionVarianceReason, setSessionVarianceReason] = useState('')

  // Internal Transfer Form State
  const [transferFromType, setTransferFromType] = useState<'cash_fund' | 'bank_account'>('cash_fund')
  const [transferFromId, setTransferFromId] = useState('')
  const [transferToType, setTransferToType] = useState<'cash_fund' | 'bank_account'>('bank_account')
  const [transferToId, setTransferToId] = useState('')
  const [transferAmount, setTransferAmount] = useState(0)
  const [transferNotes, setTransferNotes] = useState('')

  // UI state
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const pageSize = 10

  const userBranchId = profile?.branch_id || '11111111-0000-0000-0000-000000000001' // default CN-HCM

  // Load Master Metadata
  const loadMetadata = useCallback(async () => {
    try {
      // 1. Fetch cash funds of user branch
      const { data: funds } = await supabase
        .from('cash_funds')
        .select('*')
        .eq('branch_id', userBranchId)
        .eq('is_active', true)
      if (funds) {
        setCashFunds(funds)
        if (funds.length > 0) {
          setFormAccountId(funds[0].id)
          setTransferFromId(funds[0].id)
        }
      }

      // 2. Fetch active bank accounts
      const { data: banks } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('is_active', true)
      if (banks) {
        setBankAccounts(banks)
        if (banks.length > 0) {
          setTransferToId(banks[0].id)
        }
      }

      // 3. Fetch expense categories
      const { data: cats } = await supabase
        .from('expense_categories')
        .select('*')
        .eq('is_active', true)
      if (cats) {
        setCategories(cats)
        // Find default category
        const defaultCat = cats.find(c => c.flow_type === 'inflow')
        if (defaultCat) setFormCategoryId(defaultCat.id)
      }

      // 4. Fetch customers
      const { data: custs } = await supabase
        .from('customers')
        .select('id, name, farm_name')
        .eq('is_active', true)
      if (custs) setCustomers(custs)

      // 5. Fetch suppliers
      const { data: sups } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true)
      if (sups) setSuppliers(sups)

      // 6. Fetch profiles (employees)
      const { data: emps } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('is_active', true)
      if (emps) setEmployees(emps)

    } catch (err) {
      console.error('Error loading cashbook metadata:', err)
    }
  }, [userBranchId])

  // Load active cashier session
  const checkActiveSession = useCallback(async () => {
    if (cashFunds.length === 0) return
    try {
      // Find open session where cashier_id = current user
      const fundIds = cashFunds.map(f => f.id)
      const { data } = await supabase
        .from('cashier_sessions')
        .select('*, cashier:profiles(full_name)')
        .eq('status', 'open')
        .in('cash_fund_id', fundIds)
        .eq('cashier_id', profile?.id)
        .limit(1)

      if (data && data.length > 0) {
        setActiveSession(data[0] as unknown as CashierSession)
      } else {
        setActiveSession(null)
      }
    } catch (err) {
      console.error('Error checking active cashier session:', err)
    }
  }, [cashFunds, profile?.id])

  // Load Sessions History
  const loadSessions = useCallback(async () => {
    if (cashFunds.length === 0) return
    try {
      const fundIds = cashFunds.map(f => f.id)
      const { data } = await supabase
        .from('cashier_sessions')
        .select('*, cashier:profiles(full_name)')
        .in('cash_fund_id', fundIds)
        .order('opened_at', { ascending: false })
      if (data) setSessions(data as unknown as CashierSession[])
    } catch (err) {
      console.error(err)
    }
  }, [cashFunds])

  // Load Cashbook Transactions
  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('cashbook_transactions')
        .select(`
          *,
          customer:customers(name, farm_name),
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
        // By default limit cash transactions to those in current branch
        if (cashFunds.length > 0) {
          const fundIds = cashFunds.map(f => f.id)
          query = query.or(`cash_fund_id.in.(${fundIds.map(id => `"${id}"`).join(',')}),cash_fund_id.is.null`)
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
        query = query.ilike('description', `%${debouncedSearch.trim()}%`)
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
  }, [flowFilter, statusFilter, categoryFilter, accountFilter, startDate, endDate, debouncedSearch, currentPage, cashFunds])

  // Run on mount
  useEffect(() => {
    loadMetadata()
  }, [loadMetadata])

  // Check cashier session and load lists once metadata loads
  useEffect(() => {
    if (cashFunds.length > 0) {
      checkActiveSession()
      loadSessions()
    }
  }, [cashFunds, checkActiveSession, loadSessions])

  // Reload list when tab/filters change
  useEffect(() => {
    fetchTransactions()
  }, [currentPage, flowFilter, statusFilter, categoryFilter, accountFilter, startDate, endDate, fetchTransactions])

  useRealtimeTable({ table: 'cashbook_transactions', event: 'INSERT', onData: fetchTransactions })
  useRealtimeTable({ table: 'cashbook_transactions', event: 'UPDATE', onData: fetchTransactions })

  // Reset alert messages automatically
  useEffect(() => {
    if (alertMsg) {
      const t = setTimeout(() => setAlertMsg(null), 3000)
      return () => clearTimeout(t)
    }
  }, [alertMsg])

  // Format currency helper
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)
  }

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

  // Submit Transaction
  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.id) return
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
        status: 'draft', // Insert initially as draft to allow transition to approved (triggering AFTER UPDATE)
        cash_fund_id: isCash ? formAccountId : null,
        bank_account_id: !isCash ? formAccountId : null,
        session_id: isCash ? (activeSession?.id || null) : null,
        amount: formAmount,
        transaction_date: new Date().toISOString().split('T')[0],
        description: formDescription.trim(),
        reference_no: formReferenceNo.trim() || null,
        attachments: formAttachments,
        expense_category_id: formCategoryId || null,
        created_by: profile.id
      }

      // Counterparty links
      if (formCounterpartyType === 'customer' && formCustomerId) {
        insertData.customer_id = formCustomerId
      } else if (formCounterpartyType === 'supplier' && formSupplierId) {
        insertData.supplier_id = formSupplierId
      } else if (formCounterpartyType === 'employee' && formEmployeeId) {
        insertData.employee_id = formEmployeeId
      }

      // 1. Insert as draft
      const { data, error } = await supabase
        .from('cashbook_transactions')
        .insert([insertData])
        .select()

      if (error) throw error

      if (data && data[0]) {
        const txId = data[0].id
        
        // 2. If target status is approved or pending, update it.
        // Transitioning status -> approved fires the AFTER UPDATE database trigger, updating the account balance automatically!
        const { error: updateErr } = await supabase
          .from('cashbook_transactions')
          .update({
            status: targetStatus,
            approved_by: targetStatus === 'approved' ? profile.id : null,
            approved_at: targetStatus === 'approved' ? new Date().toISOString() : null
          })
          .eq('id', txId)

        if (updateErr) throw updateErr
      }

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

  // Open Cashier Session
  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.id || cashFunds.length === 0) return
    
    setSubmitting(true)
    try {
      const fund = cashFunds[0] // Main branch fund
      const insertData = {
        cash_fund_id: fund.id,
        cashier_id: profile.id,
        opening_balance: sessionOpeningBal,
        status: 'open',
        opened_at: new Date().toISOString(),
        notes: sessionNotes.trim() || null
      }

      const { error } = await supabase
        .from('cashier_sessions')
        .insert([insertData])

      if (error) throw error

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
        txs.forEach(t => {
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

      // Close cashier session
      const updateData = {
        status: 'closed',
        closing_balance: calculatedBalance,
        cash_actual: sessionActualClose,
        variance: variance,
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
        
        // Find category for other income / other expense
        const code = flow === 'inflow' ? 'THU-KHAC' : 'CHI-NCC' // default expense category fallback
        const cat = categories.find(c => c.code === code)

        const insertData: any = {
          flow_type: flow,
          status: 'draft',
          cash_fund_id: activeSession.cash_fund_id,
          amount: adjustAmount,
          transaction_date: new Date().toISOString().split('T')[0],
          description: `Điều chỉnh lệch phiên ca #${activeSession.id.slice(0,8)}. Lý do: ${sessionVarianceReason.trim()}`,
          expense_category_id: cat ? cat.id : null,
          created_by: profile?.id
        }

        const { data: newTx } = await supabase
          .from('cashbook_transactions')
          .insert([insertData])
          .select()

        if (newTx && newTx[0]) {
          await supabase
            .from('cashbook_transactions')
            .update({
              status: 'approved',
              approved_by: profile?.id,
              approved_at: new Date().toISOString()
            })
            .eq('id', newTx[0].id)
        }
      }

      setAlertMsg({ type: 'success', text: 'Đóng ca và đối soát ca thành công. Số dư quỹ đã hoàn tất ghi sổ!' })
      setIsSessionModalOpen(false)
      setSessionActualClose(0)
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

  // Handle Internal Transfer
  const handleInternalTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.id) return
    if (transferAmount <= 0) {
      setAlertMsg({ type: 'error', text: 'Số tiền chuyển khoản phải lớn hơn 0 ₫' })
      return
    }
    if (transferFromId === transferToId && transferFromType === transferToType) {
      setAlertMsg({ type: 'error', text: 'Tài khoản nguồn và tài khoản đích không được trùng nhau!' })
      return
    }

    // Check cashier session if source is cash
    if (transferFromType === 'cash_fund') {
      if (!activeSession) {
        setAlertMsg({ type: 'error', text: 'Quỹ tiền mặt nguồn hiện đang ĐÓNG CA. Vui lòng mở ca trước khi thực hiện chuyển quỹ!' })
        return
      }
    }

    setSubmitting(true)
    try {
      // 1. Create entry in internal_transfers for bookkeeping
      const { error: transErr } = await supabase
        .from('internal_transfers')
        .insert([{
          from_fund_id: transferFromType === 'cash_fund' ? transferFromId : null,
          from_bank_id: transferFromType === 'bank_account' ? transferFromId : null,
          to_fund_id: transferToType === 'cash_fund' ? transferToId : null,
          to_bank_id: transferToType === 'bank_account' ? transferToId : null,
          amount: transferAmount,
          transfer_date: new Date().toISOString().split('T')[0],
          notes: transferNotes.trim() || 'Chuyển quỹ nội bộ.',
          created_by: profile.id,
          approved_by: profile.id // Auto approved since accountant transfers
        }])

      if (transErr) throw transErr

      // 2. Insert Outflow (Source Account)
      // Transitioning to approved fires the trigger to deduct balance
      const outflowTx = {
        flow_type: 'outflow',
        status: 'draft',
        cash_fund_id: transferFromType === 'cash_fund' ? transferFromId : null,
        bank_account_id: transferFromType === 'bank_account' ? transferFromId : null,
        session_id: transferFromType === 'cash_fund' ? activeSession?.id : null,
        amount: transferAmount,
        transaction_date: new Date().toISOString().split('T')[0],
        description: `Chi chuyển tiền nội bộ. Ghi chú: ${transferNotes.trim()}`,
        created_by: profile.id
      }

      const { data: outData, error: outErr } = await supabase
        .from('cashbook_transactions')
        .insert([outflowTx])
        .select()

      if (outErr) throw outErr
      if (outData && outData[0]) {
        await supabase
          .from('cashbook_transactions')
          .update({
            status: 'approved',
            approved_by: profile.id,
            approved_at: new Date().toISOString()
          })
          .eq('id', outData[0].id)
      }

      // 3. Insert Inflow (Destination Account)
      // Transitioning to approved fires the trigger to add balance
      const inflowTx = {
        flow_type: 'inflow',
        status: 'draft',
        cash_fund_id: transferToType === 'cash_fund' ? transferToId : null,
        bank_account_id: transferToType === 'bank_account' ? transferToId : null,
        session_id: null, // Bank or cash receiver ca doesn't bind automatically
        amount: transferAmount,
        transaction_date: new Date().toISOString().split('T')[0],
        description: `Thu nhận chuyển tiền nội bộ. Ghi chú: ${transferNotes.trim()}`,
        created_by: profile.id
      }

      const { data: inData, error: inErr } = await supabase
        .from('cashbook_transactions')
        .insert([inflowTx])
        .select()

      if (inErr) throw inErr
      if (inData && inData[0]) {
        await supabase
          .from('cashbook_transactions')
          .update({
            status: 'approved',
            approved_by: profile.id,
            approved_at: new Date().toISOString()
          })
          .eq('id', inData[0].id)
      }

      setAlertMsg({ type: 'success', text: 'Chuyển quỹ nội bộ thành công. Cả hai tài khoản đã cập nhật số dư!' })
      
      // Reset form
      setTransferAmount(0)
      setTransferNotes('')
      
      fetchTransactions()
      loadMetadata()
      setActiveTab('overview')
    } catch (err: any) {
      console.error(err)
      setAlertMsg({ type: 'error', text: 'Chuyển tiền thất bại: ' + err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const totalCashBalance = useMemo(() => cashFunds.reduce((sum, f) => sum + Number(f.balance), 0), [cashFunds])
  const totalBankBalance = useMemo(() => bankAccounts.reduce((sum, b) => sum + Number(b.balance), 0), [bankAccounts])

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
            <h2 className="text-[28px] font-bold text-gray-700">Quản lý Sổ quỹ & Dòng tiền</h2>
          </div>
          
          {/* Tabs switch */}
          <div className="flex bg-gray-100 p-1 rounded-lg self-start sm:self-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-1.5 rounded-md text-body-md font-semibold transition-all ${
                activeTab === 'overview' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Lịch sử giao dịch
            </button>
            <button
              onClick={() => setActiveTab('transfers')}
              className={`px-4 py-1.5 rounded-md text-body-md font-semibold transition-all ${
                activeTab === 'transfers' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Chuyển quỹ nội bộ
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`px-4 py-1.5 rounded-md text-body-md font-semibold transition-all ${
                activeTab === 'sessions' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Phiên quỹ (Ca làm việc)
            </button>
          </div>
        </div>

        {/* Dashboard Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Cash Fund balance */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Tiền mặt tại quỹ chi nhánh</p>
                <h2 className="text-[26px] font-bold text-gray-700 tabular-nums">
                  {formatCurrency(totalCashBalance)}
                </h2>
              </div>
              <div className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-md flex items-center gap-0.5">
                <TrendingUp size={14} />
                <span className="text-tiny font-bold font-mono">Tiền mặt</span>
              </div>
            </div>
            
            <div className="mt-4 border-t border-gray-50 pt-3 flex justify-between items-center text-tiny text-gray-400">
              <span>{cashFunds.length} Quỹ tiền mặt hoạt động</span>
              <span className="font-semibold text-gray-500">HCM Branch</span>
            </div>
          </div>

          {/* Card 2: Bank balance */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Tài khoản Ngân hàng công ty</p>
                <h2 className="text-[26px] font-bold text-gray-700 tabular-nums">
                  {formatCurrency(totalBankBalance)}
                </h2>
              </div>
              <div className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-md flex items-center gap-0.5">
                <TrendingDown size={14} />
                <span className="text-tiny font-bold font-mono">Ngân hàng</span>
              </div>
            </div>

            <div className="mt-4 border-t border-gray-50 pt-3 flex justify-between items-center text-tiny text-gray-400">
              <span>{bankAccounts.length} Tài khoản đang liên kết</span>
              <span className="font-semibold text-gray-500">VCB & TCB</span>
            </div>
          </div>

          {/* Card 3: Session cashier card */}
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
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
                  onClick={() => {
                    setSessionAction('close')
                    setSessionActualClose(0)
                    setSessionNotes('')
                    setSessionVarianceReason('')
                    setIsSessionModalOpen(true)
                  }}
                  className="px-3 h-8 bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 rounded-lg text-tiny font-bold transition-all shadow-sm flex items-center gap-1"
                >
                  Đóng ca
                </button>
              ) : (
                <button
                  onClick={() => {
                    setSessionAction('open')
                    setSessionOpeningBal(0)
                    setSessionNotes('')
                    setIsSessionModalOpen(true)
                  }}
                  className="px-3 h-8 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-100 rounded-lg text-tiny font-bold transition-all shadow-sm flex items-center gap-1"
                >
                  Mở ca mới
                </button>
              )}
            </div>

            <div className="mt-4 border-t border-gray-50 pt-3 flex justify-between items-center text-tiny text-gray-400">
              <span>Mã phiên: {activeSession ? activeSession.id.slice(0, 8).toUpperCase() : 'N/A'}</span>
              <span>Đầu ca: {activeSession ? formatCurrency(activeSession.opening_balance) : '0 ₫'}</span>
            </div>
          </div>
        </div>

        {/* Main Content Area depends on Active Tab */}
        {activeTab === 'overview' && (
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

                {/* Filter Controls Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 pt-2">
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
                                {tx.cash_fund_id ? 'Quỹ mặt' : 'Ngân hàng'}
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
            <div className="col-span-12 lg:col-span-4 space-y-6">
              
              {/* Add Transaction Form Card */}
              <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm flex flex-col">
                <div className="flex items-center gap-2 mb-5 border-b border-gray-50 pb-3">
                  <Wallet className="text-blue-500" size={18} />
                  <h3 className="text-body-lg font-bold text-gray-700">Tạo phiếu thu chi mới</h3>
                </div>

                {/* Form type switcher */}
                <div className="grid grid-cols-2 bg-gray-100 p-1 rounded-lg mb-4">
                  <button
                    type="button"
                    onClick={() => handleFlowTypeChange('inflow')}
                    className={`py-1.5 rounded-md text-tiny font-bold transition-all flex items-center justify-center gap-1 ${
                      formFlowType === 'inflow' 
                        ? 'bg-white text-emerald-700 shadow-sm' 
                        : 'text-gray-500'
                    }`}
                  >
                    <TrendingUp size={14} />
                    Phiếu Thu tiền
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFlowTypeChange('outflow')}
                    className={`py-1.5 rounded-md text-tiny font-bold transition-all flex items-center justify-center gap-1 ${
                      formFlowType === 'outflow' 
                        ? 'bg-white text-orange-700 shadow-sm' 
                        : 'text-gray-500'
                    }`}
                  >
                    <TrendingDown size={14} />
                    Phiếu Chi tiền
                  </button>
                </div>

                <form onSubmit={handleTransactionSubmit} className="space-y-4">
                  {/* Category Selection */}
                  <div className="space-y-1">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Hạng mục thu chi</label>
                    <select
                      className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                      value={formCategoryId}
                      onChange={e => setFormCategoryId(e.target.value)}
                    >
                      {categories.filter(c => c.flow_type === formFlowType).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
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

                  {/* Counterparty Link */}
                  <div className="space-y-2">
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Đối tượng liên quan</label>
                    <div className="grid grid-cols-4 bg-gray-100 p-1 rounded-lg">
                      {['none', 'customer', 'supplier', 'employee'].map(type => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFormCounterpartyType(type as any)}
                          className={`py-1 rounded text-[10px] font-bold transition-all ${
                            formCounterpartyType === type
                              ? 'bg-white text-blue-700 shadow-sm'
                              : 'text-gray-500'
                          }`}
                        >
                          {type === 'none' && 'Không'}
                          {type === 'customer' && 'Khách'}
                          {type === 'supplier' && 'NCC'}
                          {type === 'employee' && 'N.Viên'}
                        </button>
                      ))}
                    </div>

                    {formCounterpartyType === 'customer' && (
                      <select
                        className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                        value={formCustomerId}
                        onChange={e => setFormCustomerId(e.target.value)}
                      >
                        <option value="">-- Chọn khách hàng --</option>
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>{c.farm_name || c.name}</option>
                        ))}
                      </select>
                    )}

                    {formCounterpartyType === 'supplier' && (
                      <select
                        className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                        value={formSupplierId}
                        onChange={e => setFormSupplierId(e.target.value)}
                      >
                        <option value="">-- Chọn nhà cung cấp --</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    )}

                    {formCounterpartyType === 'employee' && (
                      <select
                        className="w-full h-10 px-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none"
                        value={formEmployeeId}
                        onChange={e => setFormEmployeeId(e.target.value)}
                      >
                        <option value="">-- Chọn nhân viên --</option>
                        {employees.map(e => (
                          <option key={e.id} value={e.id}>{e.full_name}</option>
                        ))}
                      </select>
                    )}
                  </div>

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
                    <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Nội dung giao dịch *</label>
                    <textarea
                      rows={2}
                      required
                      placeholder="Nhập chi tiết lý do thu/chi..."
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
                      disabled={submitting}
                      className="w-full h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all text-body-md"
                    >
                      Xác nhận lưu phiếu
                    </button>
                  </div>
                </form>
              </div>

              {/* Informative Rule Box */}
              <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5 flex gap-3 text-tiny text-gray-600 leading-relaxed">
                <ShieldCheck size={18} className="shrink-0 text-blue-500" />
                <div>
                  <h4 className="font-bold text-gray-700 mb-1">Quy trình kiểm soát quỹ</h4>
                  <p>Mọi giao dịch tiền mặt đều tự động liên kết với phiên ca hoạt động. Mở ca ban đầu và đóng ca đối soát cuối ngày là bắt buộc đối với thủ quỹ.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Chuyển tiền nội bộ (Internal Transfers) */}
        {activeTab === 'transfers' && (
          <div className="bg-white border border-gray-150 rounded-xl p-6 shadow-sm max-w-xl mx-auto flex flex-col space-y-6">
            <div className="flex items-center gap-2 mb-2 border-b border-gray-50 pb-3">
              <ArrowLeftRight size={18} className="text-blue-500" />
              <h3 className="text-body-lg font-bold text-gray-700">Lập phiếu chuyển tiền nội bộ</h3>
            </div>

            <form onSubmit={handleInternalTransferSubmit} className="space-y-4">
              
              {/* Source Account details */}
              <div className="space-y-2 p-4 bg-gray-50 rounded-xl border border-gray-100">
                <h4 className="text-tiny font-bold text-gray-600 uppercase tracking-wider">Tài khoản nguồn (Chuyển đi)</h4>
                
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTransferFromType('cash_fund')
                      if (cashFunds.length > 0) setTransferFromId(cashFunds[0].id)
                    }}
                    className={`h-9 rounded-lg border font-semibold text-tiny flex items-center justify-center gap-1.5 transition-all ${
                      transferFromType === 'cash_fund'
                        ? 'border-blue-500 bg-white text-blue-700 shadow-sm'
                        : 'border-gray-200 text-gray-500 bg-transparent'
                    }`}
                  >
                    Tiền mặt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTransferFromType('bank_account')
                      if (bankAccounts.length > 0) setTransferFromId(bankAccounts[0].id)
                    }}
                    className={`h-9 rounded-lg border font-semibold text-tiny flex items-center justify-center gap-1.5 transition-all ${
                      transferFromType === 'bank_account'
                        ? 'border-blue-500 bg-white text-blue-700 shadow-sm'
                        : 'border-gray-200 text-gray-500 bg-transparent'
                    }`}
                  >
                    Ngân hàng
                  </button>
                </div>

                <select
                  className="w-full h-10 px-3 bg-white border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                  value={transferFromId}
                  onChange={e => setTransferFromId(e.target.value)}
                >
                  {transferFromType === 'cash_fund' ? (
                    cashFunds.map(f => (
                      <option key={f.id} value={f.id}>{f.name} ({formatCurrency(f.balance)})</option>
                    ))
                  ) : (
                    bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>{b.bank_name} - {b.account_no} ({formatCurrency(b.balance)})</option>
                    ))
                  )}
                </select>
              </div>

              {/* Destination Account details */}
              <div className="space-y-2 p-4 bg-gray-50 rounded-xl border border-gray-100">
                <h4 className="text-tiny font-bold text-gray-600 uppercase tracking-wider">Tài khoản nhận (Chuyển đến)</h4>
                
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTransferToType('cash_fund')
                      if (cashFunds.length > 0) setTransferToId(cashFunds[0].id)
                    }}
                    className={`h-9 rounded-lg border font-semibold text-tiny flex items-center justify-center gap-1.5 transition-all ${
                      transferToType === 'cash_fund'
                        ? 'border-blue-500 bg-white text-blue-700 shadow-sm'
                        : 'border-gray-200 text-gray-500 bg-transparent'
                    }`}
                  >
                    Tiền mặt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTransferToType('bank_account')
                      if (bankAccounts.length > 0) setTransferToId(bankAccounts[0].id)
                    }}
                    className={`h-9 rounded-lg border font-semibold text-tiny flex items-center justify-center gap-1.5 transition-all ${
                      transferToType === 'bank_account'
                        ? 'border-blue-500 bg-white text-blue-700 shadow-sm'
                        : 'border-gray-200 text-gray-500 bg-transparent'
                    }`}
                  >
                    Ngân hàng
                  </button>
                </div>

                <select
                  className="w-full h-10 px-3 bg-white border border-gray-150 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                  value={transferToId}
                  onChange={e => setTransferToId(e.target.value)}
                >
                  {transferToType === 'cash_fund' ? (
                    cashFunds.map(f => (
                      <option key={f.id} value={f.id}>{f.name} ({formatCurrency(f.balance)})</option>
                    ))
                  ) : (
                    bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>{b.bank_name} - {b.account_no} ({formatCurrency(b.balance)})</option>
                    ))
                  )}
                </select>
              </div>

              {/* Amount */}
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Số tiền chuyển (₫)</label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min="0"
                    placeholder="0 ₫"
                    required
                    value={transferAmount === 0 ? '' : transferAmount}
                    onChange={e => setTransferAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full h-10 px-3 pr-8 border border-gray-150 rounded-lg text-body-md font-semibold focus:border-blue-500 focus:outline-none text-right tabular-nums"
                  />
                  <span className="absolute right-3 text-tiny text-gray-400 font-bold">₫</span>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Ghi chú lý do chuyển</label>
                <textarea
                  rows={2}
                  placeholder="Lý do chuyển quỹ, nội bộ..."
                  value={transferNotes}
                  onChange={e => setTransferNotes(e.target.value)}
                  className="w-full p-3 border border-gray-150 rounded-lg text-body-md focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              {/* Submit */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-sm active:scale-95 transition-all text-body-md"
                >
                  Xác nhận chuyển quỹ
                </button>
              </div>
            </form>
          </div>
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
            <div className="overflow-x-auto">
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
                    <span className="font-bold text-gray-700">{selectedTx.cash_fund_id ? 'Quỹ tiền mặt HCM' : 'Tài khoản ngân hàng'}</span>
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
              <div className="px-6 py-4 bg-gray-25 border-t border-gray-100 flex justify-end gap-3">
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
                      <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider">Tiền mặt đầu ca (₫) *</label>
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
                  <div className="p-6 space-y-4">
                    <p className="text-tiny text-gray-500 leading-relaxed font-medium">
                      Kết thúc ca làm việc. Vui lòng nhập tổng số tiền mặt đếm thực tế đầu ca + các giao dịch đã thực hiện trong két của bạn.
                    </p>

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

      </div>
    </Layout>
  )
}
