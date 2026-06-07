import React, { useState, useEffect } from 'react'
import {
  Plus,
  Search,
  Building,
  Warehouse as WarehouseIcon,
  Users,
  Edit,
  AlertTriangle,
  X,
  UserPlus,
  RefreshCw,
  SlidersHorizontal,
  Printer,
  Wallet,
  Landmark,
  Star
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { createClient } from '@supabase/supabase-js'
import DisplaySettingsTab from './DisplaySettingsTab'
import PrintSettingsTab from './PrintSettingsTab'

// Interface declarations
interface Branch {
  id: string
  code: string
  name: string
  address: string | null
  phone: string | null
  manager_id: string | null
  is_active: boolean
  default_price_list_id: string | null
  manager?: {
    id: string
    full_name: string
  } | null
}

interface Warehouse {
  id: string
  branch_id: string
  code: string
  name: string
  type: 'main' | 'cold_chain' | 'equipment' | 'quarantine' | 'returns'
  address: string | null
  temperature_min: number | null
  temperature_max: number | null
  is_active: boolean
  branch?: {
    id: string
    name: string
  } | null
}

interface Team {
  id: string
  branch_id: string
  code: string
  name: string
  description: string | null
  lead_id: string | null
  is_active: boolean
  branch?: {
    id: string
    name: string
  } | null
  lead?: {
    id: string
    full_name: string
  } | null
}

interface Role {
  id: string
  code: string
  name: string
  description: string | null
}

interface Profile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  employee_code: string | null
  job_title: string | null
  is_active: boolean
  avatar_url: string | null
  branch_id: string | null
  team_id: string | null
  branch?: {
    id: string
    name: string
  } | null
  team?: {
    id: string
    name: string
  } | null
  user_roles?: {
    role: {
      id: string
      code: string
      name: string
    }
  }[]
}

interface CashFund {
  id: string
  branch_id: string
  code: string
  name: string
  balance: number
  currency: string
  is_active: boolean
  is_default_cash: boolean
  branch?: {
    id: string
    name: string
  } | null
}

interface BankAccount {
  id: string
  branch_id: string
  bank_name: string
  account_name: string
  account_no: string
  branch_name: string | null
  balance: number
  currency: string
  is_active: boolean
  is_default_bank: boolean
  branch?: {
    id: string
    name: string
  } | null
}

const WAREHOUSE_TYPES = {
  main: 'Kho tổng',
  cold_chain: 'Kho lạnh (Vaccine)',
  equipment: 'Kho thiết bị',
  quarantine: 'Kho kiểm dịch',
  returns: 'Kho hàng trả về'
}

const formatMoney = (value: number | null | undefined) =>
  new Intl.NumberFormat('vi-VN').format(Number(value) || 0) + ' đ'

export default function SystemSettingsPage() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState<'employees' | 'branches' | 'warehouses' | 'funds' | 'display' | 'print'>('employees')

  // Lists
  const [employees, setEmployees] = useState<Profile[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [priceLists, setPriceLists] = useState<{ id: string; name: string; code: string }[]>([])
  const [cashFunds, setCashFunds] = useState<CashFund[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [stockMode, setStockMode] = useState<'soft' | 'hard'>('soft')
  const [savingStockMode, setSavingStockMode] = useState(false)

  // Loading states
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Filters & Search
  const [empSearch, setEmpSearch] = useState('')
  const [empBranchFilter, setEmpBranchFilter] = useState('all')
  const [empRoleFilter, setEmpRoleFilter] = useState('all')
  
  // Modals visibility
  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [showWarehouseModal, setShowWarehouseModal] = useState(false)
  const [showReassignModal, setShowReassignModal] = useState(false)
  const [showCashFundModal, setShowCashFundModal] = useState(false)
  const [showBankModal, setShowBankModal] = useState(false)

  // Selected item for Edit
  const [selectedEmployee, setSelectedEmployee] = useState<Profile | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null)
  const [selectedCashFund, setSelectedCashFund] = useState<CashFund | null>(null)
  const [selectedBank, setSelectedBank] = useState<BankAccount | null>(null)
  
  // Reassignment Wizard State
  const [deactivatingUser, setDeactivatingUser] = useState<Profile | null>(null)
  const [reassignSalesId, setReassignSalesId] = useState('')
  const [customerCount, setCustomerCount] = useState(0)

  // Form Fields State
  // Employee Form
  const [empEmail, setEmpEmail] = useState('')
  const [empPassword, setEmpPassword] = useState('')
  const [empFullName, setEmpFullName] = useState('')
  const [empPhone, setEmpPhone] = useState('')
  const [empCode, setEmpCode] = useState('')
  const [empJobTitle, setEmpJobTitle] = useState('')
  const [empBranchId, setEmpBranchId] = useState('')
  const [empTeamId, setEmpTeamId] = useState('')
  const [empSelectedRoles, setEmpSelectedRoles] = useState<string[]>([])

  // Branch Form
  const [brCode, setBrCode] = useState('')
  const [brName, setBrName] = useState('')
  const [brAddress, setBrAddress] = useState('')
  const [brPhone, setBrPhone] = useState('')
  const [brManagerId, setBrManagerId] = useState('')
  const [brDefaultPriceListId, setBrDefaultPriceListId] = useState('')

  // Warehouse Form
  const [whCode, setWhCode] = useState('')
  const [whName, setWhName] = useState('')
  const [whBranchId, setWhBranchId] = useState('')
  const [whType, setWhType] = useState<'main' | 'cold_chain' | 'equipment' | 'quarantine' | 'returns'>('main')
  const [whAddress, setWhAddress] = useState('')
  const [whTempMin, setWhTempMin] = useState<string>('')
  const [whTempMax, setWhTempMax] = useState<string>('')

  // Cash Fund Form
  const [cfCode, setCfCode] = useState('')
  const [cfName, setCfName] = useState('')
  const [cfBranchId, setCfBranchId] = useState('')
  const [cfBalance, setCfBalance] = useState<string>('')
  const [cfIsDefault, setCfIsDefault] = useState(false)

  // Bank Account Form
  const [baBankName, setBaBankName] = useState('')
  const [baAccountName, setBaAccountName] = useState('')
  const [baAccountNo, setBaAccountNo] = useState('')
  const [baBranchName, setBaBranchName] = useState('')
  const [baBranchId, setBaBranchId] = useState('')
  const [baBalance, setBaBalance] = useState<string>('')
  const [baIsDefault, setBaIsDefault] = useState(false)

  // Load initial data
  const loadData = async () => {
    setLoading(true)
    try {
      // Fetch active price lists
      const { data: plData } = await supabase
        .from('price_lists')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name')
      if (plData) setPriceLists(plData)

      // 1. Fetch branches
      const { data: brData } = await supabase
        .from('branches')
        .select(`
          id, code, name, address, phone, manager_id, is_active, default_price_list_id,
          manager:profiles!manager_id(id, full_name)
        `)
        .order('code')
      if (brData) setBranches(brData as unknown as Branch[])

      // 2. Fetch warehouses
      const { data: whData } = await supabase
        .from('warehouses')
        .select(`
          id, branch_id, code, name, type, address, temperature_min, temperature_max, is_active,
          branch:branches(id, name)
        `)
        .order('code')
      if (whData) setWarehouses(whData as unknown as Warehouse[])

      // 3. Fetch teams
      const { data: tmData } = await supabase
        .from('teams')
        .select(`
          id, branch_id, code, name, description, lead_id, is_active,
          branch:branches(id, name),
          lead:profiles!lead_id(id, full_name)
        `)
        .order('code')
      if (tmData) setTeams(tmData as unknown as Team[])

      // 4. Fetch roles (không lấy vai trò admin và ceo)
      const { data: rData } = await supabase
        .from('roles')
        .select('id, code, name, description')
        .not('code', 'in', '("admin","ceo")')
        .order('name')
      if (rData) setRoles(rData)

      // 5. Fetch profiles (employees)
      const { data: empData } = await supabase
        .from('profiles')
        .select(`
          id, email, full_name, phone, employee_code, job_title, is_active, avatar_url, branch_id, team_id,
          branch:branches!profiles_branch_id_fkey(id, name),
          team:teams!profiles_team_id_fkey(id, name),
          user_roles:user_roles!user_roles_user_id_fkey(
            role:roles(id, code, name)
          )
        `)
        .order('employee_code', { nullsFirst: false })
      if (empData) setEmployees(empData as unknown as Profile[])

      // 6. Fetch cash funds
      const { data: cfData } = await supabase
        .from('cash_funds')
        .select(`
          id, branch_id, code, name, balance, currency, is_active, is_default_cash,
          branch:branches(id, name)
        `)
        .order('code')
      if (cfData) setCashFunds(cfData as unknown as CashFund[])

      // 7. Fetch bank accounts
      const { data: baData } = await supabase
        .from('bank_accounts')
        .select(`
          id, branch_id, bank_name, account_name, account_no, branch_name, balance, currency, is_active, is_default_bank,
          branch:branches(id, name)
        `)
        .order('bank_name')
      if (baData) setBankAccounts(baData as unknown as BankAccount[])




    } catch (err: any) {
      console.error('Error fetching system configuration:', err)
      showToast('error', 'Lỗi tải dữ liệu: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Nạp chế độ kiểm soát tồn kho (system_settings.stock_control_mode)
  useEffect(() => {
    const loadStockMode = async () => {
      const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'stock_control_mode')
        .maybeSingle()
      const mode = (data?.value as any)?.mode
      if (mode === 'hard' || mode === 'soft') setStockMode(mode)
    }
    loadStockMode()
  }, [])

  const saveStockMode = async (mode: 'soft' | 'hard') => {
    setSavingStockMode(true)
    try {
      const { error } = await supabase
        .from('system_settings')
        .upsert({ key: 'stock_control_mode', value: { mode }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
      setStockMode(mode)
      showToast('success', mode === 'hard'
        ? 'Đã bật CHẶN CỨNG: thiếu tồn sẽ không cho bán.'
        : 'Đã chuyển CẢNH BÁO (soft): thiếu tồn vẫn cho bán nhưng ghi nhật ký.')
    } catch (err: any) {
      showToast('error', 'Lưu chế độ kiểm soát tồn thất bại: ' + (err.message || ''))
    } finally {
      setSavingStockMode(false)
    }
  }

  // Auto-clear alert
  const showToast = (type: 'success' | 'error', text: string) => {
    setAlertMsg({ type, text })
    setTimeout(() => setAlertMsg(null), 4000)
  }

  // ─────────────────────────────────────────────────────────────
  // Employee Logic
  // ─────────────────────────────────────────────────────────────
  const openNewEmployee = () => {
    setSelectedEmployee(null)
    setEmpEmail('')
    setEmpPassword('')
    setEmpFullName('')
    setEmpPhone('')
    setEmpCode('')
    setEmpJobTitle('')
    setEmpBranchId(branches[0]?.id || '')
    setEmpTeamId('')
    setEmpSelectedRoles([])
    setShowEmployeeModal(true)
  }

  const openEditEmployee = (emp: Profile) => {
    setSelectedEmployee(emp)
    setEmpEmail(emp.email)
    setEmpPassword('') // Blank indicates no password change
    setEmpFullName(emp.full_name || '')
    setEmpPhone(emp.phone || '')
    setEmpCode(emp.employee_code || '')
    setEmpJobTitle(emp.job_title || '')
    setEmpBranchId(emp.branch_id || '')
    setEmpTeamId(emp.team_id || '')
    setEmpSelectedRoles(emp.user_roles?.map(ur => ur.role.id) || [])
    setShowEmployeeModal(true)
  }

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!empEmail || !empFullName) {
      showToast('error', 'Vui lòng điền Email và Họ tên.')
      return
    }

    setSaving(true)
    try {
      let userId = selectedEmployee?.id

      if (!userId) {
        // Create new user using temp client (so admin isn't logged out)
        if (!empPassword) {
          showToast('error', 'Mật khẩu là bắt buộc khi tạo tài khoản nhân viên mới.')
          setSaving(false)
          return
        }

        const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL
        const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY
        const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false }
        })

        const { data: authData, error: authError } = await tempClient.auth.signUp({
          email: empEmail,
          password: empPassword,
          options: {
            data: { full_name: empFullName }
          }
        })

        if (authError) throw authError
        if (!authData.user) throw new Error('Không tạo được tài khoản Auth.')

        userId = authData.user.id

        // Profiles row is automatically inserted via fn_handle_new_user trigger.
        // We will now update additional profile fields
        const { error: profileErr } = await supabase
          .from('profiles')
          .update({
            employee_code: empCode || null,
            phone: empPhone || null,
            job_title: empJobTitle || null,
            branch_id: empBranchId || null,
            team_id: empTeamId || null
          })
          .eq('id', userId)

        if (profileErr) throw profileErr

      } else {
        // Edit existing profile details
        const { error: profileErr } = await supabase
          .from('profiles')
          .update({
            full_name: empFullName,
            phone: empPhone || null,
            employee_code: empCode || null,
            job_title: empJobTitle || null,
            branch_id: empBranchId || null,
            team_id: empTeamId || null
          })
          .eq('id', userId)

        if (profileErr) throw profileErr
      }

      // Sync roles in user_roles (chỉ áp dụng cho tài khoản thường, không đè lên admin/ceo)
      const isSuperUser = selectedEmployee?.user_roles?.some(ur => ur.role.code === 'admin' || ur.role.code === 'ceo')

      if (!isSuperUser) {
        // 1. Delete existing roles
        await supabase.from('user_roles').delete().eq('user_id', userId)

        // 2. Insert selected roles
        if (empSelectedRoles.length > 0) {
          const rolesToInsert = empSelectedRoles.map(roleId => ({
            user_id: userId,
            role_id: roleId
          }))
          const { error: roleInsertErr } = await supabase.from('user_roles').insert(rolesToInsert)
          if (roleInsertErr) throw roleInsertErr
        }
      }

      showToast('success', selectedEmployee ? 'Cập nhật nhân viên thành công!' : 'Tạo tài khoản nhân viên thành công!')
      setShowEmployeeModal(false)
      loadData()
    } catch (err: any) {
      console.error('Error saving employee:', err)
      showToast('error', 'Lỗi: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Deactivate Toggle Logic with reassignment wizard check
  const handleToggleEmployeeActive = async (emp: Profile) => {
    const nextActiveState = !emp.is_active

    if (!nextActiveState) {
      // If we are deactivating, check if they own any customers.
      // Dùng count exact (head) thay vì .length của danh sách — tránh cap 1000
      // khiến NV phụ trách >1000 KH bị đếm thiếu → bỏ sót bàn giao.
      try {
        const { count, error: custsErr } = await supabase
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .eq('primary_sales_id', emp.id)

        if (custsErr) throw custsErr

        if (count && count > 0) {
          // Show reassignment wizard modal
          setDeactivatingUser(emp)
          setCustomerCount(count)
          setReassignSalesId('')
          setShowReassignModal(true)
          return
        }
      } catch (err: any) {
        console.error('Error checking managed customers:', err)
        showToast('error', 'Lỗi kiểm tra bàn giao: ' + err.message)
        return
      }
    }

    // Direct toggle if active state is true or has no customers
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: nextActiveState })
        .eq('id', emp.id)

      if (error) throw error
      showToast('success', `${nextActiveState ? 'Mở khóa' : 'Khóa'} tài khoản nhân viên thành công!`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi thay đổi trạng thái: ' + err.message)
    }
  }

  // Confirm Reassignment and Deactivate
  const handleConfirmReassignment = async () => {
    if (!deactivatingUser || !reassignSalesId) {
      showToast('error', 'Vui lòng chọn nhân viên thay thế.')
      return
    }

    setSaving(true)
    try {
      // 1. Reassign customers
      const { error: custErr } = await supabase
        .from('customers')
        .update({ primary_sales_id: reassignSalesId })
        .eq('primary_sales_id', deactivatingUser.id)
      
      if (custErr) throw custErr

      // 2. Reassign open opportunities
      const { error: oppErr } = await supabase
        .from('opportunities')
        .update({ owner_user_id: reassignSalesId })
        .eq('owner_user_id', deactivatingUser.id)
        .eq('status', 'open')

      if (oppErr) throw oppErr

      // 3. Log Audit logs
      await supabase.from('audit_logs').insert([{
        performed_by: profile?.id || deactivatingUser.id,
        action: 'UPDATE',
        target_table: 'profiles',
        record_id: deactivatingUser.id,
        notes: `Vô hiệu hóa tài khoản và bàn giao ${customerCount} khách hàng sang nhân viên ID: ${reassignSalesId}`
      }])

      // 4. Update profiles is_active = false
      const { error: profErr } = await supabase
        .from('profiles')
        .update({ is_active: false })
        .eq('id', deactivatingUser.id)

      if (profErr) throw profErr

      showToast('success', `Đã bàn giao khách hàng và vô hiệu hóa tài khoản ${deactivatingUser.full_name}.`)
      setShowReassignModal(false)
      loadData()
    } catch (err: any) {
      console.error('Error in deactivation reassign wizard:', err)
      showToast('error', 'Lỗi bàn giao: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Branch Logic
  // ─────────────────────────────────────────────────────────────
  const openNewBranch = () => {
    setSelectedBranch(null)
    setBrCode('')
    setBrName('')
    setBrAddress('')
    setBrPhone('')
    setBrManagerId('')
    setBrDefaultPriceListId('')
    setShowBranchModal(true)
  }

  const openEditBranch = (br: Branch) => {
    setSelectedBranch(br)
    setBrCode(br.code)
    setBrName(br.name)
    setBrAddress(br.address || '')
    setBrPhone(br.phone || '')
    setBrManagerId(br.manager_id || '')
    setBrDefaultPriceListId(br.default_price_list_id || '')
    setShowBranchModal(true)
  }

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!brCode || !brName) {
      showToast('error', 'Mã và Tên chi nhánh là bắt buộc.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        code: brCode.toUpperCase().trim(),
        name: brName.trim(),
        address: brAddress.trim() || null,
        phone: brPhone.trim() || null,
        manager_id: brManagerId || null,
        default_price_list_id: brDefaultPriceListId || null
      }

      if (!selectedBranch) {
        // Create new
        const { error } = await supabase.from('branches').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm chi nhánh mới thành công!')
      } else {
        // Update
        const { error } = await supabase
          .from('branches')
          .update(payload)
          .eq('id', selectedBranch.id)
        if (error) throw error
        showToast('success', 'Cập nhật chi nhánh thành công!')
      }

      setShowBranchModal(false)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleBranchActive = async (br: Branch) => {
    const nextState = !br.is_active
    try {
      const { error } = await supabase
        .from('branches')
        .update({ is_active: nextState })
        .eq('id', br.id)
      
      if (error) throw error
      showToast('success', `${nextState ? 'Kích hoạt' : 'Khóa'} chi nhánh thành công.`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi đổi trạng thái chi nhánh: ' + err.message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Warehouse Logic
  // ─────────────────────────────────────────────────────────────
  const openNewWarehouse = () => {
    setSelectedWarehouse(null)
    setWhCode('')
    setWhName('')
    setWhBranchId(branches[0]?.id || '')
    setWhType('main')
    setWhAddress('')
    setWhTempMin('')
    setWhTempMax('')
    setShowWarehouseModal(true)
  }

  const openEditWarehouse = (wh: Warehouse) => {
    setSelectedWarehouse(wh)
    setWhCode(wh.code)
    setWhName(wh.name)
    setWhBranchId(wh.branch_id)
    setWhType(wh.type)
    setWhAddress(wh.address || '')
    setWhTempMin(wh.temperature_min !== null ? String(wh.temperature_min) : '')
    setWhTempMax(wh.temperature_max !== null ? String(wh.temperature_max) : '')
    setShowWarehouseModal(true)
  }

  const handleSaveWarehouse = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!whCode || !whName || !whBranchId) {
      showToast('error', 'Điền đầy đủ Mã kho, Tên kho và Chi nhánh.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        code: whCode.toUpperCase().trim(),
        name: whName.trim(),
        branch_id: whBranchId,
        type: whType,
        address: whAddress.trim() || null,
        temperature_min: whType === 'cold_chain' && whTempMin ? Number(whTempMin) : null,
        temperature_max: whType === 'cold_chain' && whTempMax ? Number(whTempMax) : null
      }

      if (!selectedWarehouse) {
        const { error } = await supabase.from('warehouses').insert([payload])
        if (error) throw error
        showToast('success', 'Thêm kho hàng thành công!')
      } else {
        const { error } = await supabase
          .from('warehouses')
          .update(payload)
          .eq('id', selectedWarehouse.id)
        if (error) throw error
        showToast('success', 'Cập nhật kho hàng thành công!')
      }

      setShowWarehouseModal(false)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi lưu kho: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleWarehouseActive = async (wh: Warehouse) => {
    const nextState = !wh.is_active
    try {
      const { error } = await supabase
        .from('warehouses')
        .update({ is_active: nextState })
        .eq('id', wh.id)
      
      if (error) throw error
      showToast('success', `${nextState ? 'Kích hoạt' : 'Khóa'} kho thành công.`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi đổi trạng thái kho: ' + err.message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Cash Fund Logic
  // ─────────────────────────────────────────────────────────────
  const openNewCashFund = () => {
    setSelectedCashFund(null)
    setCfCode('')
    setCfName('')
    setCfBranchId(branches[0]?.id || '')
    setCfBalance('0')
    setCfIsDefault(false)
    setShowCashFundModal(true)
  }

  const openEditCashFund = (cf: CashFund) => {
    setSelectedCashFund(cf)
    setCfCode(cf.code)
    setCfName(cf.name)
    setCfBranchId(cf.branch_id)
    setCfBalance(String(cf.balance ?? 0))
    setCfIsDefault(cf.is_default_cash)
    setShowCashFundModal(true)
  }

  const handleSaveCashFund = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cfCode || !cfName || !cfBranchId) {
      showToast('error', 'Điền đầy đủ Mã quỹ, Tên quỹ và Chi nhánh.')
      return
    }

    setSaving(true)
    try {
      // Gỡ cờ mặc định của chi nhánh đích TRƯỚC khi ghi bản ghi để tránh
      // vi phạm unique index uq_cash_funds_default_per_branch (mỗi CN 1 quỹ mặc định).
      if (cfIsDefault) {
        let clearQuery = supabase
          .from('cash_funds')
          .update({ is_default_cash: false })
          .eq('branch_id', cfBranchId)
          .eq('is_default_cash', true)
        if (selectedCashFund?.id) clearQuery = clearQuery.neq('id', selectedCashFund.id)
        const { error: clearErr } = await clearQuery
        if (clearErr) throw clearErr
      }

      const payload = {
        code: cfCode.toUpperCase().trim(),
        name: cfName.trim(),
        branch_id: cfBranchId,
        balance: Number(cfBalance) || 0,
        is_default_cash: cfIsDefault
      }

      if (!selectedCashFund) {
        const { error } = await supabase.from('cash_funds').insert([payload])
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('cash_funds')
          .update(payload)
          .eq('id', selectedCashFund.id)
        if (error) throw error
      }

      showToast('success', selectedCashFund ? 'Cập nhật quỹ tiền mặt thành công!' : 'Thêm quỹ tiền mặt thành công!')
      setShowCashFundModal(false)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi lưu quỹ: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleCashFundActive = async (cf: CashFund) => {
    const nextState = !cf.is_active
    try {
      const { error } = await supabase
        .from('cash_funds')
        .update({ is_active: nextState })
        .eq('id', cf.id)
      if (error) throw error
      showToast('success', `${nextState ? 'Kích hoạt' : 'Khóa'} quỹ thành công.`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi đổi trạng thái quỹ: ' + err.message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Bank Account Logic
  // ─────────────────────────────────────────────────────────────
  const openNewBank = () => {
    setSelectedBank(null)
    setBaBankName('')
    setBaAccountName('')
    setBaAccountNo('')
    setBaBranchName('')
    setBaBranchId(branches[0]?.id || '')
    setBaBalance('0')
    setBaIsDefault(false)
    setShowBankModal(true)
  }

  const openEditBank = (ba: BankAccount) => {
    setSelectedBank(ba)
    setBaBankName(ba.bank_name)
    setBaAccountName(ba.account_name)
    setBaAccountNo(ba.account_no)
    setBaBranchName(ba.branch_name || '')
    setBaBranchId(ba.branch_id)
    setBaBalance(String(ba.balance ?? 0))
    setBaIsDefault(ba.is_default_bank)
    setShowBankModal(true)
  }

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!baBankName || !baAccountName || !baAccountNo || !baBranchId) {
      showToast('error', 'Điền đầy đủ Ngân hàng, Tên tài khoản, Số tài khoản và Chi nhánh.')
      return
    }

    setSaving(true)
    try {
      // Gỡ cờ mặc định của chi nhánh đích TRƯỚC khi ghi bản ghi để tránh
      // vi phạm unique index uq_bank_accounts_default_per_branch (mỗi CN 1 TK mặc định).
      if (baIsDefault) {
        let clearQuery = supabase
          .from('bank_accounts')
          .update({ is_default_bank: false })
          .eq('branch_id', baBranchId)
          .eq('is_default_bank', true)
        if (selectedBank?.id) clearQuery = clearQuery.neq('id', selectedBank.id)
        const { error: clearErr } = await clearQuery
        if (clearErr) throw clearErr
      }

      const payload = {
        bank_name: baBankName.trim(),
        account_name: baAccountName.trim(),
        account_no: baAccountNo.trim(),
        branch_name: baBranchName.trim() || null,
        branch_id: baBranchId,
        balance: Number(baBalance) || 0,
        is_default_bank: baIsDefault
      }

      if (!selectedBank) {
        const { error } = await supabase.from('bank_accounts').insert([payload])
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('bank_accounts')
          .update(payload)
          .eq('id', selectedBank.id)
        if (error) throw error
      }

      showToast('success', selectedBank ? 'Cập nhật tài khoản ngân hàng thành công!' : 'Thêm tài khoản ngân hàng thành công!')
      setShowBankModal(false)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi lưu tài khoản: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleBankActive = async (ba: BankAccount) => {
    const nextState = !ba.is_active
    try {
      const { error } = await supabase
        .from('bank_accounts')
        .update({ is_active: nextState })
        .eq('id', ba.id)
      if (error) throw error
      showToast('success', `${nextState ? 'Kích hoạt' : 'Khóa'} tài khoản thành công.`)
      loadData()
    } catch (err: any) {
      showToast('error', 'Lỗi đổi trạng thái tài khoản: ' + err.message)
    }
  }

  // Filtered employees list
  const filteredEmployees = employees.filter(emp => {
    const matchSearch = !empSearch.trim() || 
      (emp.full_name || '').toLowerCase().includes(empSearch.toLowerCase()) ||
      (emp.email || '').toLowerCase().includes(empSearch.toLowerCase()) ||
      (emp.employee_code || '').toLowerCase().includes(empSearch.toLowerCase()) ||
      (emp.job_title || '').toLowerCase().includes(empSearch.toLowerCase())

    const matchBranch = empBranchFilter === 'all' || emp.branch_id === empBranchFilter
    const matchRole = empRoleFilter === 'all' || emp.user_roles?.some(ur => ur.role.id === empRoleFilter)

    return matchSearch && matchBranch && matchRole
  })

  // Dropdown options lists (active only for edits)
  const activeProfiles = employees.filter(emp => emp.is_active)
  const activeBranchList = branches.filter(br => br.is_active)

  return (
    <Layout activeMenu="Cấu hình">
      <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6">
        
        {/* Toast Alerts Notification */}
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
            alertMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            <AlertTriangle size={18} className={alertMsg.type === 'success' ? 'text-emerald-600' : 'text-red-600'} />
            <span className="text-body-md font-medium">{alertMsg.text}</span>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-headline-lg font-bold text-gray-800">Cấu hình Hệ thống & Tổ chức</h1>
            <p className="text-body-md text-gray-500">Quản trị danh sách chi nhánh, kho hàng, phòng ban sales và thông tin phân quyền nhân sự</p>
          </div>
          
          <div>
            {activeTab === 'employees' && (
              <button
                onClick={openNewEmployee}
                className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
              >
                <UserPlus size={16} />
                <span>Thêm nhân viên</span>
              </button>
            )}
            {activeTab === 'branches' && (
              <button
                onClick={openNewBranch}
                className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
              >
                <Plus size={16} />
                <span>Tạo chi nhánh</span>
              </button>
            )}
            {activeTab === 'warehouses' && (
              <button
                onClick={openNewWarehouse}
                className="bg-blue-500 text-white px-5 py-2.5 rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
              >
                <Plus size={16} />
                <span>Thêm kho hàng</span>
              </button>
            )}


          </div>
        </div>

        {/* Tab Horizontal Select */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-100 px-6 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('employees')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'employees'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Users size={16} />
              <span>Quản lý Nhân viên</span>
            </button>

            <button
              onClick={() => setActiveTab('branches')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'branches'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Building size={16} />
              <span>Chi nhánh ({branches.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('warehouses')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'warehouses'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <WarehouseIcon size={16} />
              <span>Kho hàng ({warehouses.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('funds')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'funds'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Landmark size={16} />
              <span>Quỹ &amp; Ngân hàng ({cashFunds.length + bankAccounts.length})</span>
            </button>



            <button
              onClick={() => setActiveTab('display')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'display'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <SlidersHorizontal size={16} />
              <span>Cấu hình hiển thị</span>
            </button>

            <button
              onClick={() => setActiveTab('print')}
              className={`px-6 py-4 text-body-md font-semibold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'print'
                  ? 'border-blue-500 text-blue-600 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Printer size={16} />
              <span>Cấu hình in ấn</span>
            </button>
          </div>

          {/* Tab contents */}
          {loading ? (
            <div className="py-24 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
              <span>Đang tải danh mục cấu hình...</span>
            </div>
          ) : (
            <>
              {/* TAB 1: EMPLOYEES / PROFILES */}
              {activeTab === 'employees' && (
                <div className="p-6 space-y-6">
                  {/* Search and filter bar */}
                  <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="relative w-full md:w-80">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                      <input
                        type="text"
                        placeholder="Tìm nhân viên, email, mã NV..."
                        value={empSearch}
                        onChange={(e) => setEmpSearch(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 bg-gray-25 border border-gray-100 rounded-lg text-body-md placeholder-gray-400 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 w-full md:w-auto">
                      {/* Branch Filter */}
                      <select
                        value={empBranchFilter}
                        onChange={(e) => setEmpBranchFilter(e.target.value)}
                        className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
                      >
                        <option value="all">Tất cả chi nhánh</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>

                      {/* Role Filter */}
                      <select
                        value={empRoleFilter}
                        onChange={(e) => setEmpRoleFilter(e.target.value)}
                        className="h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none bg-white font-medium text-gray-500"
                      >
                        <option value="all">Tất cả vai trò</option>
                        {roles.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Employees Table Grid */}
                  <div className="overflow-x-auto">
                    {filteredEmployees.length === 0 ? (
                      <div className="p-12 text-center text-gray-400 space-y-2">
                        <Users className="w-12 h-12 text-gray-300 mx-auto" />
                        <p className="font-semibold text-body-lg">Không tìm thấy nhân sự nào</p>
                        <p className="text-body-md">Điều chỉnh bộ lọc hoặc bấm thêm nhân viên mới.</p>
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                            <th className="px-6 py-4">Họ và tên / Email</th>
                            <th className="px-6 py-4">Mã NV</th>
                            <th className="px-6 py-4">Chức danh</th>
                            <th className="px-6 py-4">Chi nhánh & Nhóm</th>
                            <th className="px-6 py-4">Vai trò</th>
                            <th className="px-6 py-4 text-center">Trạng thái</th>
                            <th className="px-6 py-4 w-20 text-center">Hành động</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                          {filteredEmployees.map((emp) => (
                            <tr key={emp.id} className={`hover:bg-gray-25/50 transition-colors ${!emp.is_active ? 'opacity-60 bg-gray-50/40' : ''}`}>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 font-bold uppercase text-tiny flex-shrink-0">
                                    {emp.avatar_url ? (
                                      <img src={emp.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                                    ) : (
                                      (emp.full_name || emp.email).charAt(0)
                                    )}
                                  </div>
                                  <div>
                                    <p className="font-bold text-gray-800 leading-tight">{emp.full_name || 'Chưa cập nhật'}</p>
                                    <span className="text-[11px] text-gray-400 font-semibold">{emp.email}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 font-mono font-bold text-gray-500">{emp.employee_code || '---'}</td>
                              <td className="px-6 py-4 font-medium text-gray-700">{emp.job_title || 'Thành viên'}</td>
                              <td className="px-6 py-4">
                                <div className="space-y-0.5 text-tiny text-gray-500">
                                  <p className="font-semibold text-gray-700">{emp.branch?.name || 'Văn phòng chính'}</p>
                                  <p className="text-[11px] text-gray-400">{emp.team?.name || 'Chưa phân nhóm'}</p>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-wrap gap-1">
                                  {emp.user_roles && emp.user_roles.length > 0 ? (
                                    emp.user_roles.map(ur => (
                                      <span key={ur.role.id} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
                                        {ur.role.name}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-50 text-gray-500 border border-gray-100">
                                      Chưa phân quyền
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleEmployeeActive(emp)}
                                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    emp.is_active ? 'bg-blue-500' : 'bg-gray-250'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                      emp.is_active ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  onClick={() => openEditEmployee(emp)}
                                  className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                                >
                                  <Edit size={16} />
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

              {/* TAB 2: BRANCHES */}
              {activeTab === 'branches' && (
                <div className="p-6 space-y-6">
                  {branches.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 space-y-2">
                      <Building className="w-12 h-12 text-gray-300 mx-auto" />
                      <p className="font-semibold text-body-lg">Chưa cấu hình chi nhánh nào</p>
                      <p className="text-body-md">Click "Tạo chi nhánh" ở góc phải để thêm cơ sở mới.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {branches.map(br => (
                        <div
                          key={br.id}
                          className={`bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group ${
                            br.is_active ? 'border-gray-100' : 'border-gray-200 bg-gray-50/40 opacity-70'
                          }`}
                        >
                          <div className="space-y-4">
                            {/* Card header */}
                            <div className="flex justify-between items-start">
                              <span className="font-mono text-tiny font-bold text-blue-500 uppercase bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">
                                {br.code}
                              </span>
                              
                              <button
                                type="button"
                                onClick={() => handleToggleBranchActive(br)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-all ${
                                  br.is_active 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                    : 'bg-gray-100 text-gray-500 border-gray-200'
                                }`}
                              >
                                {br.is_active ? 'Đang hoạt động' : 'Tạm khóa'}
                              </button>
                            </div>

                            {/* Branch details */}
                            <div>
                              <h3 className="font-bold text-body-lg text-gray-800 group-hover:text-blue-500 transition-colors">
                                {br.name}
                              </h3>
                              <p className="text-tiny text-gray-450 mt-2 font-medium flex items-start gap-1">
                                <span className="font-semibold text-gray-400">Địa chỉ:</span>
                                <span className="truncate max-w-[200px]" title={br.address || 'N/A'}>
                                  {br.address || 'Chưa cập nhật'}
                                </span>
                              </p>
                              <p className="text-tiny text-gray-450 mt-1 font-medium flex items-center gap-1">
                                <span className="font-semibold text-gray-400">Điện thoại:</span>
                                <span>{br.phone || 'Chưa cập nhật'}</span>
                              </p>
                              <p className="text-tiny text-gray-450 mt-1 font-medium flex items-center gap-1">
                                <span className="font-semibold text-gray-400">Bảng giá mặc định:</span>
                                <span className="font-bold text-gray-700">
                                  {priceLists.find(pl => pl.id === br.default_price_list_id)?.name || 'Mặc định hệ thống'}
                                </span>
                              </p>
                            </div>
                          </div>

                          {/* Card footer manager / actions */}
                          <div className="flex justify-between items-center border-t border-gray-50 mt-5 pt-3">
                            <span className="text-tiny text-gray-400 font-semibold">
                              GĐ: <span className="text-gray-700 font-bold">{br.manager?.full_name || 'Chưa phân nhiệm'}</span>
                            </span>
                            
                            <button
                              onClick={() => openEditBranch(br)}
                              className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                            >
                              <Edit size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: WAREHOUSES */}
              {activeTab === 'warehouses' && (
                <div className="p-6 space-y-6">
                  {/* Chế độ kiểm soát tồn kho khi bán */}
                  <div className="rounded-xl border border-gray-150 bg-gray-25/50 p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="font-bold text-gray-800 text-body-lg">Kiểm soát tồn kho khi bán</h4>
                        <p className="text-tiny text-gray-500 mt-0.5">
                          Áp dụng cho mọi sản phẩm. Chuyển sang <b>Chặn cứng</b> sau khi dữ liệu tồn kho đã đầy đủ.
                        </p>
                      </div>
                      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                        <button
                          type="button"
                          disabled={savingStockMode}
                          onClick={() => saveStockMode('soft')}
                          className={`px-4 py-2 text-tiny font-bold transition-colors ${stockMode === 'soft' ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          Cảnh báo (soft)
                        </button>
                        <button
                          type="button"
                          disabled={savingStockMode}
                          onClick={() => saveStockMode('hard')}
                          className={`px-4 py-2 text-tiny font-bold border-l border-gray-200 transition-colors ${stockMode === 'hard' ? 'bg-red-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          Chặn cứng (hard)
                        </button>
                      </div>
                    </div>
                    <p className="text-tiny text-gray-500">
                      {stockMode === 'hard'
                        ? '🔒 Chặn cứng: đơn có sản phẩm thiếu tồn sẽ bị từ chối khi xác nhận.'
                        : '⚠️ Cảnh báo: thiếu tồn vẫn cho bán, hệ thống ghi nhật ký bán âm để theo dõi & nhập kho bù.'}
                    </p>
                  </div>

                  {warehouses.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 space-y-2">
                      <WarehouseIcon className="w-12 h-12 text-gray-300 mx-auto" />
                      <p className="font-semibold text-body-lg">Chưa cấu hình kho hàng nào</p>
                      <p className="text-body-md">Bấm "Thêm kho hàng" để quản lý vị trí lưu trữ hàng hóa.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                            <th className="px-6 py-4">Mã kho / Tên kho</th>
                            <th className="px-6 py-4">Chi nhánh</th>
                            <th className="px-6 py-4">Loại kho</th>
                            <th className="px-6 py-4 text-center">Nhiệt độ (Kho lạnh)</th>
                            <th className="px-6 py-4">Địa chỉ kho</th>
                            <th className="px-6 py-4 text-center">Trạng thái</th>
                            <th className="px-6 py-4 w-20 text-center">Sửa</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                          {warehouses.map((wh) => (
                            <tr key={wh.id} className={`hover:bg-gray-25/50 transition-colors ${!wh.is_active ? 'opacity-60 bg-gray-50/40' : ''}`}>
                              <td className="px-6 py-4">
                                <div>
                                  <p className="font-bold text-gray-800">{wh.name}</p>
                                  <span className="font-mono text-tiny font-bold text-blue-500 uppercase">{wh.code}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 font-semibold text-gray-700">{wh.branch?.name || 'Văn phòng chính'}</td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                                  wh.type === 'cold_chain' 
                                    ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                                    : wh.type === 'quarantine'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-100'
                                    : wh.type === 'returns'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-100'
                                    : 'bg-gray-50 text-gray-750 border border-gray-100'
                                }`}>
                                  {WAREHOUSE_TYPES[wh.type] || wh.type}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center font-medium font-mono text-gray-600">
                                {wh.type === 'cold_chain' && (wh.temperature_min !== null || wh.temperature_max !== null) ? (
                                  <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                    {wh.temperature_min ?? '?'}°C ~ {wh.temperature_max ?? '?'}°C
                                  </span>
                                ) : (
                                  <span className="text-gray-300">N/A</span>
                                )}
                              </td>
                              <td className="px-6 py-4 truncate max-w-[200px]" title={wh.address || ''}>
                                {wh.address || 'Theo chi nhánh'}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleWarehouseActive(wh)}
                                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    wh.is_active ? 'bg-blue-500' : 'bg-gray-250'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                      wh.is_active ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  onClick={() => openEditWarehouse(wh)}
                                  className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                                >
                                  <Edit size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}



              {/* TAB 4: CASH FUNDS & BANK ACCOUNTS */}
              {activeTab === 'funds' && (
                <div className="p-6 space-y-10">
                  {/* SECTION A: BANK ACCOUNTS */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Landmark size={18} className="text-blue-500" />
                        <h3 className="font-bold text-body-lg text-gray-800">Tài khoản ngân hàng ({bankAccounts.length})</h3>
                      </div>
                      <button
                        onClick={openNewBank}
                        className="bg-blue-500 text-white px-4 py-2 rounded-lg font-semibold text-tiny hover:bg-blue-600 flex items-center gap-2 shadow-sm active:scale-95 transition-all"
                      >
                        <Plus size={15} />
                        <span>Thêm tài khoản</span>
                      </button>
                    </div>

                    {bankAccounts.length === 0 ? (
                      <div className="p-10 text-center text-gray-400 space-y-2 border border-dashed border-gray-200 rounded-xl">
                        <Landmark className="w-10 h-10 text-gray-300 mx-auto" />
                        <p className="font-semibold text-body-md">Chưa cấu hình tài khoản ngân hàng nào</p>
                        <p className="text-tiny">Bấm "Thêm tài khoản" để khai báo số tài khoản nhận chuyển khoản.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-gray-100 rounded-xl">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                              <th className="px-5 py-3">Ngân hàng / Số tài khoản</th>
                              <th className="px-5 py-3">Chủ tài khoản</th>
                              <th className="px-5 py-3">Chi nhánh</th>
                              <th className="px-5 py-3 text-right">Số dư</th>
                              <th className="px-5 py-3 text-center">Mặc định</th>
                              <th className="px-5 py-3 text-center">Trạng thái</th>
                              <th className="px-5 py-3 w-16 text-center">Sửa</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                            {bankAccounts.map((ba) => (
                              <tr key={ba.id} className={`hover:bg-gray-25/50 transition-colors ${!ba.is_active ? 'opacity-60 bg-gray-50/40' : ''}`}>
                                <td className="px-5 py-3">
                                  <p className="font-bold text-gray-800">{ba.bank_name}</p>
                                  <span className="font-mono text-tiny font-bold text-blue-500">{ba.account_no}</span>
                                </td>
                                <td className="px-5 py-3 font-medium text-gray-700">{ba.account_name}</td>
                                <td className="px-5 py-3 text-gray-600">
                                  <span className="font-semibold">{ba.branch?.name || '—'}</span>
                                  {ba.branch_name && <span className="block text-[11px] text-gray-400">CN NH: {ba.branch_name}</span>}
                                </td>
                                <td className="px-5 py-3 text-right font-mono font-bold text-gray-800">{formatMoney(ba.balance)}</td>
                                <td className="px-5 py-3 text-center">
                                  {ba.is_default_bank && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                      <Star size={11} className="fill-amber-400 text-amber-400" /> Mặc định
                                    </span>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleBankActive(ba)}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                      ba.is_active ? 'bg-blue-500' : 'bg-gray-250'
                                    }`}
                                  >
                                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${ba.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                  </button>
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <button onClick={() => openEditBank(ba)} className="text-gray-400 hover:text-blue-600 transition-colors p-1">
                                    <Edit size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* SECTION B: CASH FUNDS */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet size={18} className="text-emerald-500" />
                        <h3 className="font-bold text-body-lg text-gray-800">Quỹ tiền mặt ({cashFunds.length})</h3>
                      </div>
                      <button
                        onClick={openNewCashFund}
                        className="bg-emerald-500 text-white px-4 py-2 rounded-lg font-semibold text-tiny hover:bg-emerald-600 flex items-center gap-2 shadow-sm active:scale-95 transition-all"
                      >
                        <Plus size={15} />
                        <span>Thêm quỹ tiền mặt</span>
                      </button>
                    </div>

                    {cashFunds.length === 0 ? (
                      <div className="p-10 text-center text-gray-400 space-y-2 border border-dashed border-gray-200 rounded-xl">
                        <Wallet className="w-10 h-10 text-gray-300 mx-auto" />
                        <p className="font-semibold text-body-md">Chưa cấu hình quỹ tiền mặt nào</p>
                        <p className="text-tiny">Bấm "Thêm quỹ tiền mặt" để khai báo quỹ thu tiền mặt tại chi nhánh.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-gray-100 rounded-xl">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider">
                              <th className="px-5 py-3">Mã quỹ / Tên quỹ</th>
                              <th className="px-5 py-3">Chi nhánh</th>
                              <th className="px-5 py-3 text-right">Số dư</th>
                              <th className="px-5 py-3 text-center">Mặc định</th>
                              <th className="px-5 py-3 text-center">Trạng thái</th>
                              <th className="px-5 py-3 w-16 text-center">Sửa</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 text-body-md text-gray-650">
                            {cashFunds.map((cf) => (
                              <tr key={cf.id} className={`hover:bg-gray-25/50 transition-colors ${!cf.is_active ? 'opacity-60 bg-gray-50/40' : ''}`}>
                                <td className="px-5 py-3">
                                  <p className="font-bold text-gray-800">{cf.name}</p>
                                  <span className="font-mono text-tiny font-bold text-emerald-600">{cf.code}</span>
                                </td>
                                <td className="px-5 py-3 font-semibold text-gray-700">{cf.branch?.name || '—'}</td>
                                <td className="px-5 py-3 text-right font-mono font-bold text-gray-800">{formatMoney(cf.balance)}</td>
                                <td className="px-5 py-3 text-center">
                                  {cf.is_default_cash && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                      <Star size={11} className="fill-amber-400 text-amber-400" /> Mặc định
                                    </span>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleCashFundActive(cf)}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                      cf.is_active ? 'bg-emerald-500' : 'bg-gray-250'
                                    }`}
                                  >
                                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${cf.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                                  </button>
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <button onClick={() => openEditCashFund(cf)} className="text-gray-400 hover:text-blue-600 transition-colors p-1">
                                    <Edit size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <p className="text-tiny text-gray-400 flex items-start gap-1.5 pt-1">
                      <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                      Số dư có thể chỉnh sửa trực tiếp khi cần đối chiếu, nhưng thông thường nên để hệ thống tự cập nhật qua các giao dịch sổ quỹ để tránh sai lệch.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'display' && (
                <div className="p-6">
                  <DisplaySettingsTab />
                </div>
              )}

              {activeTab === 'print' && (
                <div className="p-6">
                  <PrintSettingsTab />
                </div>
              )}
            </>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────
            MODALS SECTION
           ───────────────────────────────────────────────────────────── */}
        
        {/* MODAL 1: EMPLOYEE DETAIL / CREATE FORM */}
        {showEmployeeModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedEmployee ? 'Cập nhật tài khoản nhân sự' : 'Thêm tài khoản nhân viên mới'}
                </h3>
                <button onClick={() => setShowEmployeeModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveEmployee} className="p-6 space-y-4 overflow-y-auto max-h-[500px] custom-scrollbar">
                {/* Full name & employee code */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Họ và tên <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="Nguyễn Văn A..."
                      value={empFullName}
                      onChange={(e) => setEmpFullName(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Mã nhân viên (nếu có)</label>
                    <input
                      type="text"
                      placeholder="SL-012..."
                      value={empCode}
                      onChange={(e) => setEmpCode(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Email & Phone */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Email <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      required
                      disabled={!!selectedEmployee}
                      placeholder="email@sanhlongvetco.vn..."
                      value={empEmail}
                      onChange={(e) => setEmpEmail(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Số điện thoại</label>
                    <input
                      type="tel"
                      placeholder="09xx..."
                      value={empPhone}
                      onChange={(e) => setEmpPhone(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Password input only for new employees */}
                {!selectedEmployee && (
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Mật khẩu ban đầu <span className="text-red-500">*</span></label>
                    <input
                      type="password"
                      required
                      placeholder="Tối thiểu 6 ký tự..."
                      value={empPassword}
                      onChange={(e) => setEmpPassword(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                {/* Job Title */}
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Chức danh công việc</label>
                  <input
                    type="text"
                    placeholder="Nhân viên kinh doanh, BSTY, Kế toán..."
                    value={empJobTitle}
                    onChange={(e) => setEmpJobTitle(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Branch & Team select */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Chi nhánh cơ sở</label>
                    <select
                      value={empBranchId}
                      onChange={(e) => setEmpBranchId(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="">-- Chọn chi nhánh --</option>
                      {activeBranchList.map(br => (
                        <option key={br.id} value={br.id}>{br.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Nhóm Sales chính</label>
                    <select
                      value={empTeamId}
                      onChange={(e) => setEmpTeamId(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="">-- Chưa phân nhóm --</option>
                      {teams.filter(t => t.is_active).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* RBAC Role Selection (Checkboxes) */}
                <div className="space-y-2 pt-2">
                  <label className="block text-body-md font-semibold text-gray-700">Vai trò / Phân quyền hệ thống</label>
                  {selectedEmployee?.user_roles?.some(ur => ur.role.code === 'admin' || ur.role.code === 'ceo') ? (
                    <div className="p-3 bg-blue-50 border border-blue-100 text-blue-700 rounded-lg text-body-md font-semibold">
                      Tài khoản có quyền cao nhất (Admin/CEO) - Không cần điều chỉnh phân quyền.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 bg-gray-50 p-4 rounded-lg border border-gray-100">
                      {roles.map(role => (
                        <label key={role.id} className="flex items-center gap-2 text-body-md font-medium text-gray-650 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={empSelectedRoles.includes(role.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEmpSelectedRoles([...empSelectedRoles, role.id])
                              } else {
                                setEmpSelectedRoles(empSelectedRoles.filter(id => id !== role.id))
                              }
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                          />
                          <span>{role.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Modal actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-150">
                  <button
                    type="button"
                    onClick={() => setShowEmployeeModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50"
                  >
                    {saving ? 'Đang lưu...' : 'Lưu thông tin'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 2: DEACTIVATION & REASSIGNMENT WIZARD */}
        {showReassignModal && deactivatingUser && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 bg-amber-50/50 flex items-center gap-3">
                <AlertTriangle className="text-amber-500 flex-shrink-0" size={24} />
                <h3 className="text-body-lg font-bold text-amber-800">
                  Wizard: Bàn giao khách hàng & cơ hội
                </h3>
              </div>

              <div className="p-6 space-y-4 text-body-md text-gray-650">
                <p>
                  Nhân viên <span className="font-bold text-gray-800">{deactivatingUser.full_name}</span> đang phụ trách chính{' '}
                  <span className="font-bold text-blue-600">{customerCount} khách hàng</span> và các cơ hội kinh doanh.
                </p>
                <p>
                  Vui lòng chọn nhân viên kinh doanh thay thế dưới đây để thực hiện chuyển giao công việc tự động trước khi vô hiệu hóa tài khoản này.
                </p>

                <div className="space-y-1.5 pt-2">
                  <label className="block text-body-md font-semibold text-gray-700">Chọn nhân viên Sales thay thế <span className="text-red-500">*</span></label>
                  <select
                    value={reassignSalesId}
                    onChange={(e) => setReassignSalesId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chọn nhân viên thay thế --</option>
                    {activeProfiles
                      .filter(p => p.id !== deactivatingUser.id)
                      .map(p => (
                        <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
                      ))
                    }
                  </select>
                </div>

                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-tiny text-gray-400 space-y-1.5">
                  <p className="font-bold text-gray-500">Hành động tự động sẽ diễn ra:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Đổi phụ trách chính (`primary_sales_id`) của {customerCount} KH sang Sales mới.</li>
                    <li>Đổi chủ sở hữu cơ hội kinh doanh đang mở (`status = 'open'`) sang Sales mới.</li>
                    <li>Ghi nhận nhật ký bàn giao tự động vào lịch sử hệ thống (Audit trail).</li>
                  </ul>
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowReassignModal(false)}
                  className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  disabled={saving || !reassignSalesId}
                  onClick={handleConfirmReassignment}
                  className="px-5 h-10 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50"
                >
                  {saving ? 'Đang thực hiện...' : 'Bàn giao & Khóa tài khoản'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 3: BRANCH CREATE / EDIT FORM */}
        {showBranchModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedBranch ? 'Cập nhật thông tin chi nhánh' : 'Tạo chi nhánh mới'}
                </h3>
                <button onClick={() => setShowBranchModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveBranch} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Mã chi nhánh <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: CN-HCM, CN-DN..."
                    value={brCode}
                    onChange={(e) => setBrCode(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên chi nhánh <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Chi nhánh miền Nam..."
                    value={brName}
                    onChange={(e) => setBrName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Số điện thoại liên hệ</label>
                  <input
                    type="tel"
                    placeholder="VD: 028-777-123..."
                    value={brPhone}
                    onChange={(e) => setBrPhone(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Địa chỉ văn phòng</label>
                  <input
                    type="text"
                    placeholder="Số nhà, tên đường, tỉnh thành..."
                    value={brAddress}
                    onChange={(e) => setBrAddress(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Giám đốc chi nhánh phụ trách</label>
                  <select
                    value={brManagerId}
                    onChange={(e) => setBrManagerId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chưa chỉ định --</option>
                    {activeProfiles.map(p => (
                      <option key={p.id} value={p.id}>{p.full_name} ({p.job_title || 'Thành viên'})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Bảng giá mặc định của chi nhánh</label>
                  <select
                    value={brDefaultPriceListId}
                    onChange={(e) => setBrDefaultPriceListId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Dùng cấu hình mặc định hệ thống --</option>
                    {priceLists.map(pl => (
                      <option key={pl.id} value={pl.id}>{pl.name} ({pl.code})</option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowBranchModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50"
                  >
                    {saving ? 'Đang lưu...' : 'Lưu thông tin'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 4: WAREHOUSE CREATE / EDIT FORM */}
        {showWarehouseModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-bold text-gray-800">
                  {selectedWarehouse ? 'Cập nhật kho hàng' : 'Thêm kho hàng mới'}
                </h3>
                <button onClick={() => setShowWarehouseModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveWarehouse} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Mã kho <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="KHO-HCM-01..."
                      value={whCode}
                      onChange={(e) => setWhCode(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Tên kho <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="Kho tổng HCM..."
                      value={whName}
                      onChange={(e) => setWhName(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Thuộc chi nhánh <span className="text-red-500">*</span></label>
                  <select
                    value={whBranchId}
                    onChange={(e) => setWhBranchId(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">-- Chọn chi nhánh --</option>
                    {activeBranchList.map(br => (
                      <option key={br.id} value={br.id}>{br.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Loại kho đặc thù</label>
                  <select
                    value={whType}
                    onChange={(e) => setWhType(e.target.value as any)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="main">Kho tổng</option>
                    <option value="cold_chain">Kho lạnh (Vaccine, sinh phẩm)</option>
                    <option value="equipment">Kho dụng cụ chăn nuôi</option>
                    <option value="quarantine">Kho kiểm dịch</option>
                    <option value="returns">Kho hàng trả về</option>
                  </select>
                </div>

                {/* Temp range for Cold Chain warehouses only */}
                {whType === 'cold_chain' && (
                  <div className="p-4 bg-blue-25/20 border border-blue-100 rounded-lg space-y-3">
                    <p className="text-tiny font-bold text-blue-700 uppercase flex items-center gap-1.5">
                      <AlertTriangle size={13} />
                      Cấu hình dải nhiệt độ (°C)
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="block text-tiny text-gray-400 font-semibold">Nhiệt độ tối thiểu</label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="2.0"
                          value={whTempMin}
                          onChange={(e) => setWhTempMin(e.target.value)}
                          className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-tiny text-gray-400 font-semibold">Nhiệt độ tối đa</label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="8.0"
                          value={whTempMax}
                          onChange={(e) => setWhTempMax(e.target.value)}
                          className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Địa chỉ kho</label>
                  <input
                    type="text"
                    placeholder="Mặc định theo chi nhánh..."
                    value={whAddress}
                    onChange={(e) => setWhAddress(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowWarehouseModal(false)}
                    className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50"
                  >
                    {saving ? 'Đang lưu...' : 'Lưu thông tin'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 5: BANK ACCOUNT CREATE / EDIT FORM */}
        {showBankModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                  <Landmark size={18} className="text-blue-500" />
                  {selectedBank ? 'Cập nhật tài khoản ngân hàng' : 'Thêm tài khoản ngân hàng'}
                </h3>
                <button onClick={() => setShowBankModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveBank} className="p-6 space-y-4 overflow-y-auto max-h-[520px] custom-scrollbar">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Ngân hàng <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="Vietcombank, BIDV, ACB..."
                      value={baBankName}
                      onChange={(e) => setBaBankName(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Số tài khoản <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="1420546944..."
                      value={baAccountNo}
                      onChange={(e) => setBaAccountNo(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên chủ tài khoản <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="CÔNG TY TNHH SANH LONG VETCO..."
                    value={baAccountName}
                    onChange={(e) => setBaAccountName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Chi nhánh sở hữu <span className="text-red-500">*</span></label>
                    <select
                      value={baBranchId}
                      onChange={(e) => setBaBranchId(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="">-- Chọn chi nhánh --</option>
                      {activeBranchList.map(br => (
                        <option key={br.id} value={br.id}>{br.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Chi nhánh ngân hàng</label>
                    <input
                      type="text"
                      placeholder="CN Bồng Sơn..."
                      value={baBranchName}
                      onChange={(e) => setBaBranchName(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Số dư hiện tại (VND)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={baBalance}
                    onChange={(e) => setBaBalance(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md font-mono focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[11px] text-gray-400">Số dư đối chiếu của tài khoản. Thông thường nên để hệ thống tự cập nhật qua giao dịch sổ quỹ.</p>
                </div>

                <label className="flex items-center gap-2.5 p-3 bg-amber-50/60 border border-amber-100 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={baIsDefault}
                    onChange={(e) => setBaIsDefault(e.target.checked)}
                    className="rounded border-gray-300 text-amber-600 focus:ring-amber-500 w-4 h-4"
                  />
                  <span className="text-body-md font-semibold text-amber-800 flex items-center gap-1">
                    <Star size={14} className="fill-amber-400 text-amber-400" />
                    Đặt làm tài khoản mặc định của chi nhánh
                  </span>
                </label>
                <p className="text-[11px] text-gray-400 -mt-2">Tiền chuyển khoản/quẹt thẻ từ bán hàng sẽ tự ghi vào tài khoản mặc định này. Mỗi chi nhánh chỉ có 1 tài khoản mặc định.</p>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-150">
                  <button type="button" onClick={() => setShowBankModal(false)} className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors">
                    Hủy bỏ
                  </button>
                  <button type="submit" disabled={saving} className="px-5 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50">
                    {saving ? 'Đang lưu...' : 'Lưu tài khoản'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 6: CASH FUND CREATE / EDIT FORM */}
        {showCashFundModal && (
          <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-100 flex flex-col">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                  <Wallet size={18} className="text-emerald-500" />
                  {selectedCashFund ? 'Cập nhật quỹ tiền mặt' : 'Thêm quỹ tiền mặt'}
                </h3>
                <button onClick={() => setShowCashFundModal(false)} className="text-gray-400 hover:text-gray-650 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveCashFund} className="p-6 space-y-4 overflow-y-auto max-h-[520px] custom-scrollbar">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Mã quỹ <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="QUY-HCM..."
                      value={cfCode}
                      onChange={(e) => setCfCode(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Chi nhánh <span className="text-red-500">*</span></label>
                    <select
                      value={cfBranchId}
                      onChange={(e) => setCfBranchId(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-emerald-500 bg-white"
                    >
                      <option value="">-- Chọn chi nhánh --</option>
                      {activeBranchList.map(br => (
                        <option key={br.id} value={br.id}>{br.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Tên quỹ <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="Quỹ tiền mặt văn phòng HCM..."
                    value={cfName}
                    onChange={(e) => setCfName(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Số dư hiện tại (VND)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={cfBalance}
                    onChange={(e) => setCfBalance(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[11px] text-gray-400">Số dư tiền mặt thực tế trong quỹ. Thông thường nên để hệ thống tự cập nhật qua giao dịch sổ quỹ.</p>
                </div>

                <label className="flex items-center gap-2.5 p-3 bg-amber-50/60 border border-amber-100 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfIsDefault}
                    onChange={(e) => setCfIsDefault(e.target.checked)}
                    className="rounded border-gray-300 text-amber-600 focus:ring-amber-500 w-4 h-4"
                  />
                  <span className="text-body-md font-semibold text-amber-800 flex items-center gap-1">
                    <Star size={14} className="fill-amber-400 text-amber-400" />
                    Đặt làm quỹ tiền mặt mặc định của chi nhánh
                  </span>
                </label>
                <p className="text-[11px] text-gray-400 -mt-2">Tiền mặt từ bán hàng/thu nợ sẽ tự ghi vào quỹ mặc định này. Mỗi chi nhánh chỉ có 1 quỹ mặc định.</p>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-150">
                  <button type="button" onClick={() => setShowCashFundModal(false)} className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors">
                    Hủy bỏ
                  </button>
                  <button type="submit" disabled={saving} className="px-5 h-10 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50">
                    {saving ? 'Đang lưu...' : 'Lưu quỹ'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </Layout>
  )
}

