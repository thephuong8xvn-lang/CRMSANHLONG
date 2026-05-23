import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Receipt,
  Package,
  Warehouse,
  Truck,
  Activity,
  Stethoscope,
  Wallet,
  BarChart2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  Search,
  Bell,
  HelpCircle,
  Plus,
  ArrowUpRight,
  X,
  PawPrint,
  Settings
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

interface LayoutProps {
  children: React.ReactNode
  activeMenu?: string
  onSearch?: (term: string) => void
  searchElement?: React.ReactNode
}

export default function Layout({ children, activeMenu, onSearch, searchElement }: LayoutProps) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true'
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [quickActionOpen, setQuickActionOpen] = useState(false)
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [userRole, setUserRole] = useState<{ code: string; name: string }>({
    code: 'admin',
    name: 'Quản trị viên'
  })

  // Handle Sidebar collapse toggle
  const toggleSidebar = () => {
    setIsCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }

  // Fetch User Role
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!profile?.id) return
      try {
        const { data: roleData, error: roleError } = await supabase
          .from('user_roles')
          .select('role:roles(code, name)')
          .eq('user_id', profile.id)

        if (!roleError && roleData && roleData.length > 0) {
          const roleObj = roleData[0].role as unknown as { code: string; name: string }
          if (roleObj) {
            setUserRole(roleObj)
          }
        }
      } catch (err) {
        console.error('Error fetching user role in Layout:', err)
      }
    }
    fetchUserRole()
  }, [profile])

  // Navigation Items according to spec
  const menuItems = [
    { label: 'Bảng điều khiển', icon: LayoutDashboard, path: '/dashboard' },
    { label: 'Khách hàng', icon: Users, path: '/customers' },
    { label: 'Chăn nuôi', icon: PawPrint, path: '/herd-projects' },
    { label: 'Pipeline', icon: Stethoscope, path: '/pipeline' },
    { label: 'Đơn hàng', icon: Receipt, path: '/orders' },
    { label: 'Sản phẩm', icon: Package, path: '/products' },
    { label: 'Kho hàng', icon: Warehouse, path: '/inventory' },
    { label: 'Nhà cung cấp', icon: Truck, path: '/suppliers' },
    { label: 'Hoạt động', icon: Activity, path: '#' },
    { label: 'Sổ quỹ', icon: Wallet, path: '/cashbook', restricted: true }, // Restricted to Accountant/Admin
    { label: 'Báo cáo', icon: BarChart2, path: '/reports' }, // All roles can view report hub
    { label: 'Cấu hình', icon: Settings, path: '/system-settings', adminOnly: true }
  ]


  // Filter items based on role (Accountant sees cashbook, etc.)
  const visibleMenuItems = menuItems.filter(item => {
    if (item.restricted && userRole.code === 'sales') {
      return false
    }
    if (item.adminOnly && userRole.code !== 'admin') {
      return false
    }
    return true
  })

  // Check if current path or matching activeMenu is active
  const isItemActive = (item: typeof menuItems[0]) => {
    if (activeMenu) {
      return item.label.toLowerCase() === activeMenu.toLowerCase()
    }
    if (item.path === '/orders') {
      return location.pathname.startsWith('/orders')
    }
    if (item.path === '/reports') {
      return location.pathname.startsWith('/reports')
    }
    if (item.path === '/herd-projects') {
      return location.pathname.startsWith('/herd-projects')
    }
    return location.pathname === item.path
  }

  return (
    <div className="flex min-h-screen bg-gray-25 text-gray-600 font-sans">
      
      {/* ── Desktop/Tablet Sidebar ── */}
      <aside
        className={`hidden md:flex flex-col fixed left-0 top-0 h-full bg-gray-0 border-r border-gray-100 py-6 z-50 transition-all duration-300 ${
          isCollapsed ? 'w-[78px]' : 'w-[240px]'
        }`}
      >
        {/* Brand Header */}
        <div className="px-6 mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 bg-blue-500 flex items-center justify-center rounded-lg flex-shrink-0">
              <Stethoscope className="text-gray-0" size={20} strokeWidth={1.5} />
            </div>
            {!isCollapsed && (
              <div className="transition-opacity duration-300">
                <h1 className="text-body-lg font-semibold text-blue-500 leading-tight">Sanh Long Vetco</h1>
                <p className="text-tiny text-gray-400">Hệ thống CRM</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 space-y-1">
          {visibleMenuItems.map((item, idx) => {
            const Icon = item.icon
            const active = isItemActive(item)
            return (
              <a
                key={idx}
                href={item.path}
                onClick={(e) => {
                  if (item.path !== '#') {
                    e.preventDefault()
                    navigate(item.path)
                  }
                }}
                className={`flex items-center gap-3 px-6 py-3 transition-colors duration-200 ${
                  active
                    ? 'bg-blue-50 text-blue-700 font-semibold border-l-[3px] border-blue-500'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
                title={item.label}
              >
                <Icon size={20} strokeWidth={active ? 2 : 1.5} className="flex-shrink-0" />
                {!isCollapsed && <span className="text-body-md">{item.label}</span>}
              </a>
            )
          })}
        </nav>

        {/* Sidebar Toggle Button at bottom */}
        <div className="px-6 mb-4">
          <button
            onClick={toggleSidebar}
            className="w-full py-2 flex items-center justify-center text-gray-400 hover:bg-gray-50 border border-gray-100 rounded-md transition-colors"
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Profile Block inside Sidebar */}
        <div className="px-6 pt-6 border-t border-gray-100">
          <div 
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors relative"
            onClick={() => setProfileDropdownOpen(prev => !prev)}
          >
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-gray-0 text-tiny font-semibold flex-shrink-0">
              {profile?.full_name?.charAt(0).toUpperCase() || 'A'}
            </div>
            {!isCollapsed && (
              <div className="overflow-hidden flex-1 text-left">
                <p className="text-body-md font-semibold truncate">{profile?.full_name || 'Quản trị viên'}</p>
                <p className="text-tiny text-gray-400 truncate">{userRole.name}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main Layout Wrapper ── */}
      <div className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${
        isCollapsed ? 'md:ml-[78px]' : 'md:ml-[240px]'
      }`}>
        
        {/* ── Top App Bar ── */}
        <header className="sticky top-0 bg-gray-0 border-b border-gray-100 h-16 flex justify-between items-center px-4 md:px-10 z-40">
          <div className="flex items-center gap-3">
            {/* Hamburger menu for mobile/tablet */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 text-gray-500 hover:bg-gray-50 rounded-lg"
            >
              <Menu size={20} />
            </button>

            {/* Global Search */}
            {searchElement ? (
              searchElement
            ) : (
              <div className="hidden sm:flex items-center bg-gray-25 rounded-lg px-3 h-10 w-80 md:w-96 border border-gray-100 focus-within:border-blue-500 focus-within:ring-[4px] focus-within:ring-blue-100 transition-all">
                <Search className="text-gray-400 mr-2" size={16} strokeWidth={1.5} />
                <input
                  className="bg-transparent border-none focus:ring-0 text-body-md w-full placeholder-gray-400 p-0 focus:outline-none"
                  placeholder="Tìm kiếm nhanh..."
                  type="text"
                  onChange={(e) => onSearch && onSearch(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <button className="w-10 h-10 flex items-center justify-center text-gray-400 hover:bg-gray-25 rounded-lg transition-all relative">
              <Bell size={20} strokeWidth={1.5} />
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500"></span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center text-gray-400 hover:bg-gray-25 rounded-lg transition-all">
              <HelpCircle size={20} strokeWidth={1.5} />
            </button>
            <div className="h-6 w-[1px] bg-gray-100 mx-2"></div>
            
            {/* Profile Dropdown for quick logout/settings */}
            <div className="relative">
              <button
                onClick={() => setProfileDropdownOpen(prev => !prev)}
                className="flex items-center gap-2 hover:bg-gray-25 p-1 rounded-lg transition-all focus:outline-none"
              >
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-gray-0 text-tiny font-semibold">
                  {profile?.full_name?.charAt(0).toUpperCase() || 'A'}
                </div>
                <span className="hidden lg:inline text-body-md font-semibold">{profile?.full_name || 'Admin'}</span>
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-gray-0 border border-gray-100 rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-body-md font-semibold text-gray-700">{profile?.full_name}</p>
                    <p className="text-tiny text-gray-400 truncate">{profile?.email}</p>
                  </div>
                  <button
                    onClick={signOut}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-body-md text-danger-500 hover:bg-gray-50 text-left transition-colors font-semibold"
                  >
                    <LogOut size={16} strokeWidth={1.5} />
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>

            {/* Quick Create Action Button */}
            <button
              onClick={() => setQuickActionOpen(true)}
              className="bg-blue-500 text-gray-0 px-4 h-10 rounded-lg font-semibold text-body-md hover:bg-blue-600 active:scale-95 transition-all flex items-center gap-2 shadow-sm"
            >
              <Plus size={18} strokeWidth={2} />
              <span className="hidden sm:inline">Tạo mới</span>
            </button>
          </div>
        </header>

        {/* ── Main Content Canvas ── */}
        <main className="flex-grow pb-24 md:pb-10">
          {children}
        </main>
      </div>

      {/* ── Mobile Side Navigation Drawer ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 md:hidden transition-opacity">
          <div className="bg-gray-0 w-64 h-full py-6 px-4 flex flex-col shadow-xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-500 flex items-center justify-center rounded-lg">
                  <Stethoscope className="text-gray-0" size={16} />
                </div>
                <h1 className="text-body-lg font-semibold text-blue-500">Sanh Long CRM</h1>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 hover:bg-gray-50 rounded-full text-gray-400"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 space-y-1">
              {visibleMenuItems.map((item, idx) => {
                const Icon = item.icon
                const active = isItemActive(item)
                return (
                  <a
                    key={idx}
                    href={item.path}
                    onClick={(e) => {
                      setMobileMenuOpen(false)
                      if (item.path !== '#') {
                        e.preventDefault()
                        navigate(item.path)
                      }
                    }}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      active
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <Icon size={18} />
                    <span className="text-body-md">{item.label}</span>
                  </a>
                )
              })}
            </nav>

            <div className="pt-4 border-t border-gray-100">
              <button
                onClick={signOut}
                className="w-full flex items-center gap-2 px-4 py-3 text-body-md text-danger-500 hover:bg-gray-50 rounded-lg transition-colors font-semibold"
              >
                <LogOut size={18} />
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Navigation Bar (h: 64px) ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-gray-0 border-t border-gray-100 flex items-center justify-around z-45 px-2">
        <a 
          href="/dashboard" 
          onClick={(e) => { e.preventDefault(); navigate('/dashboard') }}
          className={`flex flex-col items-center justify-center gap-1 ${
            location.pathname === '/dashboard' ? 'text-blue-700 font-semibold' : 'text-gray-400'
          }`}
        >
          <LayoutDashboard size={20} strokeWidth={location.pathname === '/dashboard' ? 2 : 1.5} />
          <span className="text-[10px]">Trang chủ</span>
        </a>
        <a 
          href="/customers" 
          onClick={(e) => { e.preventDefault(); navigate('/customers') }}
          className={`flex flex-col items-center justify-center gap-1 ${
            location.pathname.startsWith('/customers') ? 'text-blue-700 font-semibold' : 'text-gray-400'
          }`}
        >
          <Users size={20} strokeWidth={location.pathname.startsWith('/customers') ? 2 : 1.5} />
          <span className="text-[10px]">Khách hàng</span>
        </a>
        
        {/* Fake space for FAB placeholder in middle */}
        <div className="w-12 h-12"></div>

        <a 
          href="/orders" 
          onClick={(e) => { e.preventDefault(); navigate('/orders') }}
          className={`flex flex-col items-center justify-center gap-1 ${
            location.pathname.startsWith('/orders') ? 'text-blue-700 font-semibold' : 'text-gray-400'
          }`}
        >
          <Receipt size={20} strokeWidth={location.pathname.startsWith('/orders') ? 2 : 1.5} />
          <span className="text-[10px]">Đơn hàng</span>
        </a>
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center text-gray-400 hover:text-gray-600 gap-1 focus:outline-none"
        >
          <Menu size={20} strokeWidth={1.5} />
          <span className="text-[10px]">Thêm</span>
        </button>
      </div>

      {/* ── Mobile Floating Action Button (FAB) (h: 56px) ── */}
      <button
        onClick={() => setQuickActionOpen(true)}
        className="md:hidden fixed bottom-[20px] left-1/2 -translate-x-1/2 w-14 h-14 bg-blue-500 text-gray-0 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all z-46 border-4 border-gray-0 focus:outline-none"
        aria-label="Tạo nhanh"
      >
        <Plus size={24} strokeWidth={2} />
      </button>

      {/* ── Quick Action Overlay Drawer / Bottom Sheet ── */}
      {quickActionOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-gray-0 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-250">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
              <h3 className="text-body-lg font-semibold text-gray-700">Giao dịch nhanh</h3>
              <button
                onClick={() => setQuickActionOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-full text-gray-400 transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <button
                onClick={() => {
                  setQuickActionOpen(false)
                  if (window.innerWidth >= 768) {
                    navigate('/orders/pos')
                  } else {
                    navigate('/orders/mobile')
                  }
                }}
                className="w-full py-3 px-4 bg-gray-25 hover:bg-gray-50 border border-gray-100 rounded-lg text-left font-semibold text-body-md flex items-center justify-between text-gray-700 transition-colors"
              >
                <span>Tạo đơn hàng nhanh</span>
                <ArrowUpRight size={16} className="text-blue-500" />
              </button>
              <button
                onClick={() => setQuickActionOpen(false)}
                className="w-full py-3 px-4 bg-gray-25 hover:bg-gray-50 border border-gray-100 rounded-lg text-left font-semibold text-body-md flex items-center justify-between text-gray-700 transition-colors"
              >
                <span>Ghi hoạt động</span>
                <ArrowUpRight size={16} className="text-blue-500" />
              </button>
              <button
                onClick={() => {
                  setQuickActionOpen(false)
                  navigate('/customers')
                  // Trigger opening the customer creation sheet
                  setTimeout(() => {
                    const addBtn = document.getElementById('btn-add-customer')
                    if (addBtn) addBtn.click()
                  }, 200)
                }}
                className="w-full py-3 px-4 bg-gray-25 hover:bg-gray-50 border border-gray-100 rounded-lg text-left font-semibold text-body-md flex items-center justify-between text-gray-700 transition-colors"
              >
                <span>Thêm khách hàng mới</span>
                <ArrowUpRight size={16} className="text-blue-500" />
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
