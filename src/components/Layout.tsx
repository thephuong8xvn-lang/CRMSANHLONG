import React, { useState, useEffect } from 'react'
import { useNotifications } from '../hooks/useNotifications'
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
  Menu,
  Search,
  Bell,
  HelpCircle,
  Plus,
  ArrowUpRight,
  X,
  PawPrint,
  Settings,
  ChevronDown,
  Tag,
  MapPin,
  CalendarClock,
  TrendingUp,
  RotateCcw,
  FileSpreadsheet,
  ReceiptText,
  HeartHandshake
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

interface LayoutProps {
  children: React.ReactNode
  activeMenu?: string
  onSearch?: (term: string) => void
  searchElement?: React.ReactNode
  // Ẩn toàn bộ thanh điều hướng trên cùng (dùng cho POS — chiếm trọn màn hình).
  hideTopBar?: boolean
}

export default function Layout({ children, activeMenu, onSearch, searchElement, hideTopBar }: LayoutProps) {
  // Sprint P1-6 (2026-05-26): role + permissions giờ đọc từ AuthContext
  // (cache TanStack Query 15 phút), thay vì 2 query lặp lại mỗi page render.
  const { profile, signOut, userRole, userPermissions } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { unreadCount, markAllRead } = useNotifications()

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [quickActionOpen, setQuickActionOpen] = useState(false)
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)

  // Handle dropdown outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.menu-dropdown-container')) {
        setActiveDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [])

  // Navigation Items according to spec.
  // `primary`: số thứ tự ưu tiên → module hiển thị trên thanh menu phụ (quick-access).
  type MenuItem = {
    label: string
    icon: React.ComponentType<any>
    path: string
    perms: string[]
    adminOnly?: boolean
    primary?: number
  }
  const menuGroups: { label: string; items: MenuItem[] }[] = [
    {
      label: 'Tổng quan',
      items: [
        { label: 'Bảng điều khiển', icon: LayoutDashboard, path: '/dashboard', perms: [] }
        // Mục 'Hoạt động' (path:'#') tạm ẩn — chưa có route /activities (stub tính năng tương lai).
        // Khôi phục khi xây trang dòng thời gian hoạt động:
        // , { label: 'Hoạt động', icon: Activity, path: '#', perms: [] }
      ]
    },
    {
      label: 'Kinh doanh',
      items: [
        { label: 'Khách hàng', icon: Users, path: '/customers', perms: ['customers.view_own', 'customers.view_team', 'customers.view_all'], primary: 1 },
        { label: 'Bản đồ KH', icon: MapPin, path: '/customers/map', perms: ['customers.view_own', 'customers.view_team', 'customers.view_all'] },
        { label: 'Chăm sóc KH', icon: HeartHandshake, path: '/customers/care', perms: ['customers.view_own', 'customers.view_team', 'customers.view_all'] },
        { label: 'Cấu hình KH', icon: Settings, path: '/customers/settings', perms: ['users.manage'] },
        { label: 'Chăn nuôi', icon: PawPrint, path: '/herd-projects', perms: ['herd_projects.view_all', 'herd_projects.create'] },
        { label: 'Pipeline', icon: Stethoscope, path: '/pipeline', perms: ['opportunities.view_all', 'opportunities.create'] },
        { label: 'Đơn hàng', icon: Receipt, path: '/orders', perms: ['orders.view_own', 'orders.view_team', 'orders.view_all', 'orders.create'], primary: 2 },
        { label: 'Trả hàng', icon: RotateCcw, path: '/returns', perms: ['orders.view_own', 'orders.view_team', 'orders.view_all'] }
      ]
    },
    {
      label: 'Kho & Hàng hóa',
      items: [
        { label: 'Sản phẩm', icon: Package, path: '/products', perms: ['products.view', 'products.manage', 'pricing.manage', 'promotions.manage'], primary: 3 },
        { label: 'Hoạt chất', icon: Activity, path: '/products/ingredients', perms: ['products.view', 'products.manage'] },
        { label: 'Bệnh & Phác đồ', icon: Stethoscope, path: '/diseases', perms: ['herd_projects.view_all', 'herd_projects.create'] },
        { label: 'Khuyến mãi', icon: Tag, path: '/promotions', perms: ['promotions.manage'] },
        { label: 'Kho hàng', icon: Warehouse, path: '/inventory', perms: ['inventory.view', 'inventory.receive', 'inventory.adjust', 'inventory.transfer'], primary: 4 },
        { label: 'Nhập từ Drive', icon: FileSpreadsheet, path: '/inventory/gdrive-import', perms: ['inventory.receive'] },
        { label: 'Quản lý VAT', icon: ReceiptText, path: '/inventory/vat', perms: ['cashbook.view'] },
        { label: 'Hạn sử dụng', icon: CalendarClock, path: '/inventory/expiry', perms: ['inventory.view'] },
        { label: 'Gợi ý đặt hàng', icon: TrendingUp, path: '/inventory/reorder', perms: ['inventory.view'] },
        { label: 'Nhà cung cấp', icon: Truck, path: '/suppliers', perms: ['purchase_orders.create', 'purchase_orders.approve', 'inventory.view', 'inventory.receive'] }
      ]
    },
    {
      label: 'Tài chính & Báo cáo',
      items: [
        { label: 'Sổ quỹ', icon: Wallet, path: '/cashbook', perms: ['cashbook.view', 'cashbook.create', 'cashbook.approve'] },
        { label: 'Báo cáo', icon: BarChart2, path: '/reports', perms: [], adminOnly: true }
      ]
    },
    {
      label: 'Hệ thống',
      items: [
        { label: 'Cấu hình', icon: Settings, path: '/system-settings', perms: [], adminOnly: true }
      ]
    }
  ]

  // Filter groups based on role (Admin and CEO have full access) and specific module permissions
  const visibleMenuGroups = menuGroups.map(group => {
    const filteredItems = group.items.filter(item => {
      // Mục chỉ dành cho admin (vd: Báo cáo) — kể cả CEO cũng bị ẩn
      if ((item as { adminOnly?: boolean }).adminOnly) {
        return userRole.code === 'admin'
      }
      if (userRole.code === 'admin' || userRole.code === 'ceo') {
        return true
      }
      if (!item.perms || item.perms.length === 0) {
        return true
      }
      return item.perms.some(perm => userPermissions.includes(perm))
    })
    return {
      ...group,
      items: filteredItems
    }
  }).filter(group => group.items.length > 0)

  // Flattened visible items for mobile drawer/bottom bar reuse
  const visibleMenuItems = visibleMenuGroups.reduce((acc, group) => {
    return [...acc, ...group.items]
  }, [] as MenuItem[])

  // Module hay dùng (đã lọc theo quyền) → hiển thị trên THANH MENU PHỤ dưới top menu.
  // Cờ `primary` đánh trong menuGroups; sort theo thứ tự ưu tiên.
  const primaryItems = visibleMenuItems
    .filter(i => i.primary != null)
    .sort((a, b) => (a.primary ?? 99) - (b.primary ?? 99))

  // Check if current path or matching activeMenu is active
  const isItemActive = (item: { label: string; path: string }) => {
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

  // Check if any item inside a group is active
  const isGroupActive = (group: typeof menuGroups[0]) => {
    return group.items.some(item => isItemActive(item))
  }

  const handleGroupClick = (groupLabel: string) => {
    setActiveDropdown(prev => prev === groupLabel ? null : groupLabel)
  }

  const handleItemClick = (path: string) => {
    setActiveDropdown(null)
    if (path !== '#') {
      navigate(path)
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-25 text-gray-600 font-sans">
      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* ── Main Layout Wrapper (No desktop sidebar margin) ── */}
      <div className="flex-1 flex flex-col min-h-screen">
        
        {/* ── Top App Bar (Contains Brand, Menu and User Controls) — ẩn khi hideTopBar (POS) ── */}
        {!hideTopBar && (
        <header className="sticky top-0 bg-gray-0 border-b border-gray-100 min-h-16 md:h-16 flex flex-col md:flex-row justify-between items-center px-4 md:px-6 z-40 gap-3 py-3 md:py-0">
          <div className="flex items-center justify-between w-full md:w-auto gap-4">
            <div className="flex items-center gap-3">
              {/* Logo & Brand Name */}
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/dashboard')}>
                <div className="w-9 h-9 bg-blue-500 flex items-center justify-center rounded-lg">
                  <PawPrint className="text-gray-0" size={18} />
                </div>
                <span className="text-body-lg font-bold text-blue-500 leading-tight">Sanh Long</span>
              </div>
            </div>
            {/* Mobile actions */}
            <div className="flex items-center xl:hidden gap-2">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="p-2 text-gray-500 hover:bg-gray-50 rounded-lg"
              >
                <Menu size={20} />
              </button>
            </div>
          </div>

          {/* Grouped Horizontal Navigation Menu for Desktop */}
          <nav className="hidden xl:flex items-center gap-1.5 no-scrollbar px-2 py-1">
            {visibleMenuGroups.map((group, groupIdx) => {
              if (group.items.length === 1) {
                const item = group.items[0]
                const Icon = item.icon
                const active = isItemActive(item)
                return (
                  <a
                    key={groupIdx}
                    href={item.path}
                    onClick={(e) => {
                      if (item.path !== '#') {
                        e.preventDefault()
                        navigate(item.path)
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-body-md transition-all font-medium ${
                      active
                        ? 'bg-blue-50 text-blue-700 font-semibold shadow-sm'
                        : 'text-gray-500 hover:text-blue-500 hover:bg-gray-50'
                    }`}
                  >
                    <Icon size={16} strokeWidth={active ? 2 : 1.5} className="flex-shrink-0" />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </a>
                )
              }

              // Group with dropdown
              const groupActive = isGroupActive(group)
              const isOpen = activeDropdown === group.label
              return (
                <div key={groupIdx} className="relative menu-dropdown-container">
                  <button
                    onClick={() => handleGroupClick(group.label)}
                    className={`flex items-center gap-1 px-3 py-2 rounded-lg text-body-md transition-all font-medium focus:outline-none ${
                      groupActive
                        ? 'bg-blue-50 text-blue-700 font-semibold shadow-sm'
                        : 'text-gray-500 hover:text-blue-500 hover:bg-gray-50'
                    }`}
                  >
                    <span className="whitespace-nowrap">{group.label}</span>
                    <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isOpen && (
                    <div className="absolute left-0 mt-2 w-48 bg-gray-0 border border-gray-100 rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                      {group.items.map((item, idx) => {
                        const Icon = item.icon
                        const active = isItemActive(item)
                        return (
                          <a
                            key={idx}
                            href={item.path}
                            onClick={(e) => {
                              e.preventDefault()
                              handleItemClick(item.path)
                            }}
                            className={`flex items-center gap-2 px-4 py-2.5 text-body-md transition-colors ${
                              active
                                ? 'bg-blue-50 text-blue-700 font-semibold'
                                : 'text-gray-500 hover:bg-gray-50 hover:text-blue-500'
                            }`}
                          >
                            <Icon size={16} strokeWidth={active ? 2 : 1.5} className="flex-shrink-0" />
                            <span>{item.label}</span>
                          </a>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          {/* Desktop Search & Actions */}
          <div className="hidden md:flex items-center gap-3">
            {searchElement ? (
              searchElement
            ) : (
              <div className="flex items-center bg-gray-25 rounded-lg px-3 h-9 w-48 lg:w-64 border border-gray-100 focus-within:border-blue-500 focus-within:ring-[3px] focus-within:ring-blue-100 transition-all">
                <Search className="text-gray-400 mr-2" size={14} strokeWidth={1.5} />
                <input
                  className="bg-transparent border-none focus:ring-0 text-body-sm w-full placeholder-gray-400 p-0 focus:outline-none"
                  placeholder="Tìm nhanh..."
                  type="text"
                  onChange={(e) => onSearch && onSearch(e.target.value)}
                />
              </div>
            )}
            
            <div className="flex items-center gap-1">
              <button
                onClick={markAllRead}
                className="w-9 h-9 flex items-center justify-center text-gray-400 hover:bg-gray-25 rounded-lg transition-all relative"
                title={unreadCount > 0 ? `${unreadCount} thông báo chưa đọc` : 'Không có thông báo mới'}
              >
                <Bell size={18} strokeWidth={1.5} />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              <button className="w-9 h-9 flex items-center justify-center text-gray-400 hover:bg-gray-25 rounded-lg transition-all">
                <HelpCircle size={18} strokeWidth={1.5} />
              </button>
            </div>

            <div className="h-5 w-[1px] bg-gray-100"></div>

            {/* Profile Menu Dropdown */}
            <div className="relative">
              <button
                onClick={() => setProfileDropdownOpen(prev => !prev)}
                className="flex items-center gap-1.5 hover:bg-gray-25 p-1 rounded-lg transition-all focus:outline-none"
              >
                <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-gray-0 text-tiny font-semibold">
                  {profile?.full_name?.charAt(0).toUpperCase() || 'A'}
                </div>
                <span className="hidden lg:inline text-body-sm font-semibold truncate max-w-[80px]">{profile?.full_name || 'Admin'}</span>
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-gray-0 border border-gray-100 rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-body-sm font-semibold text-gray-700">{profile?.full_name}</p>
                    <p className="text-tiny text-gray-400 truncate">{profile?.email}</p>
                    <p className="text-tiny text-blue-500 font-bold mt-0.5">{userRole.name}</p>
                  </div>
                  <button
                    onClick={signOut}
                    className="w-full flex items-center gap-2 px-4 py-2 text-body-sm text-danger-500 hover:bg-gray-50 text-left transition-colors font-semibold"
                  >
                    <LogOut size={14} strokeWidth={1.5} />
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => setQuickActionOpen(true)}
              className="bg-blue-500 text-gray-0 px-3 h-9 rounded-lg font-semibold text-body-sm hover:bg-blue-600 active:scale-95 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Plus size={16} strokeWidth={2} />
              <span>Tạo mới</span>
            </button>
          </div>

          {/* Search & Actions for Mobile Device Collapse */}
          <div className="flex md:hidden items-center justify-between w-full gap-2 mt-1">
            {searchElement ? (
              searchElement
            ) : (
              <div className="flex flex-1 items-center bg-gray-25 rounded-lg px-3 h-9 border border-gray-100 focus-within:border-blue-500 transition-all">
                <Search className="text-gray-400 mr-2" size={14} strokeWidth={1.5} />
                <input
                  className="bg-transparent border-none focus:ring-0 text-body-sm w-full placeholder-gray-400 p-0 focus:outline-none"
                  placeholder="Tìm kiếm nhanh..."
                  type="text"
                  onChange={(e) => onSearch && onSearch(e.target.value)}
                />
              </div>
            )}
            <button
              onClick={() => setQuickActionOpen(true)}
              className="bg-blue-500 text-gray-0 p-2 h-9 w-9 rounded-lg flex items-center justify-center shadow-sm"
            >
              <Plus size={16} />
            </button>
          </div>
        </header>
        )}

        {/* ── Thanh menu PHỤ (quick-access) — 1 hàng riêng dưới top menu, chỉ desktop ──
            Đặt riêng 1 hàng full-width nên KHÔNG chen/đẩy vỡ top menu. Mobile dùng bottom bar. */}
        {!hideTopBar && primaryItems.length > 0 && (
          <div className="hidden md:flex sticky top-16 z-30 bg-gray-0 border-b border-gray-100 px-4 md:px-6 h-12 items-center gap-1 overflow-x-auto no-scrollbar">
            <span className="text-tiny font-bold text-gray-300 uppercase tracking-wider mr-2 shrink-0">Truy cập nhanh</span>
            {primaryItems.map(item => {
              const Icon = item.icon
              const active = isItemActive(item)
              return (
                <a
                  key={`qa-${item.path}`}
                  href={item.path}
                  onClick={(e) => { e.preventDefault(); navigate(item.path) }}
                  className={`flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-md transition-all font-medium ${
                    active
                      ? 'bg-blue-50 text-blue-700 font-semibold shadow-sm'
                      : 'text-gray-500 hover:text-blue-500 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={16} strokeWidth={active ? 2 : 1.5} className="flex-shrink-0" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </a>
              )
            })}
          </div>
        )}

        {/* ── Main Content Canvas ── */}
        <main className={hideTopBar ? "flex-grow overflow-hidden" : "flex-grow pb-24 md:pb-10"}>
          {children}
        </main>
      </div>

      {/* ── Mobile Side Navigation Drawer ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 xl:hidden transition-opacity">
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

            <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 -mx-1 px-1">
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
