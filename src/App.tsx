import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { isSupabaseConfigured } from './lib/supabase'
import { DisplaySettingsProvider } from './contexts/DisplaySettingsContext'
import { ShieldAlert } from 'lucide-react'
import Layout from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PwaUpdateBanner } from './components/PwaUpdateBanner'

// ─────────────────────────────────────────────────────────────
// Sprint P0-2 (2026-05-26): Lazy-load để giảm initial bundle.
// Giữ eager: LoginPage (cần ngay nếu chưa login),
//            AuthCallback (cần ngay khi OAuth redirect về),
//            DashboardPage (route mặc định sau login).
// ─────────────────────────────────────────────────────────────
import LoginPage from './pages/auth/LoginPage'
import AuthCallback from './pages/AuthCallback'
import DashboardPage from './pages/dashboard/DashboardPage'

const CustomerListPage           = lazy(() => import('./pages/customers/CustomerListPage'))
const CustomerDetailPage         = lazy(() => import('./pages/customers/CustomerDetailPage'))
const CustomerSettingsPage       = lazy(() => import('./pages/customers/CustomerSettingsPage'))
const CustomerDuplicatesPage     = lazy(() => import('./pages/customers/CustomerDuplicatesPage'))
const CustomerCarePage           = lazy(() => import('./pages/customers/CustomerCarePage'))
const CreditLimitsPage           = lazy(() => import('./pages/customers/CreditLimitsPage'))
const CustomerMapPage            = lazy(() => import('./pages/customers/CustomerMapPage'))
const ProductListPage            = lazy(() => import('./pages/products/ProductListPage'))
const ProductDetailPage          = lazy(() => import('./pages/products/ProductDetailPage'))
const PriceListPage              = lazy(() => import('./pages/products/PriceListPage'))
const ActiveIngredientsPage      = lazy(() => import('./pages/products/ActiveIngredientsPage'))
const DiseasesPage               = lazy(() => import('./pages/products/DiseasesPage'))
const SupplierListPage           = lazy(() => import('./pages/suppliers/SupplierListPage'))
const SupplierDetailPage         = lazy(() => import('./pages/suppliers/SupplierDetailPage'))
const InventoryPage              = lazy(() => import('./pages/inventory/InventoryPage'))
const ExpiryPage                 = lazy(() => import('./pages/inventory/ExpiryPage'))
const ReorderPage                = lazy(() => import('./pages/inventory/ReorderPage'))
const GdriveImportPage           = lazy(() => import('./pages/inventory/GdriveImportPage'))
const GdriveSourcesPage          = lazy(() => import('./pages/inventory/GdriveSourcesPage'))
const VatManagementPage          = lazy(() => import('./pages/inventory/VatManagementPage'))
const PurchaseOrderFormPage      = lazy(() => import('./pages/purchase-orders/PurchaseOrderFormPage'))
const GoodsReceiptFormPage       = lazy(() => import('./pages/goods-receipts/GoodsReceiptFormPage'))
const GoodsReceiptDetailPage     = lazy(() => import('./pages/goods-receipts/GoodsReceiptDetailPage'))
const OrderListPage              = lazy(() => import('./pages/orders/OrderListPage'))
const ReturnListPage             = lazy(() => import('./pages/returns/ReturnListPage'))
const OrderDetailPage            = lazy(() => import('./pages/orders/OrderDetailPage'))
const POSPage                    = lazy(() => import('./pages/orders/POSPage'))
const MobileOrderPage            = lazy(() => import('./pages/orders/MobileOrderPage'))
const PipelinePage               = lazy(() => import('./pages/pipeline/PipelinePage'))
const CashbookPage               = lazy(() => import('./pages/cashbook/CashbookPage'))
const ReportsHubPage             = lazy(() => import('./pages/reports/ReportsHubPage'))
const ProfitReportPage           = lazy(() => import('./pages/reports/ProfitReportPage'))
const CustomerProfileReportPage  = lazy(() => import('./pages/reports/CustomerProfileReportPage'))
const InventoryValuationReportPage = lazy(() => import('./pages/reports/InventoryValuationReportPage'))
const StrategicProductsReportPage = lazy(() => import('./pages/reports/StrategicProductsReportPage'))
const BiAnalyticsPage            = lazy(() => import('./pages/reports/BiAnalyticsPage'))
const DemandForecastPage         = lazy(() => import('./pages/reports/DemandForecastPage'))
const HerdProjectListPage        = lazy(() => import('./pages/herd-projects/HerdProjectListPage'))
const HerdProjectFormPage        = lazy(() => import('./pages/herd-projects/HerdProjectFormPage'))
const HerdProjectDetailPage      = lazy(() => import('./pages/herd-projects/HerdProjectDetailPage'))
const HerdsManagePage            = lazy(() => import('./pages/herd-projects/HerdsManagePage'))
const SystemSettingsPage         = lazy(() => import('./pages/system/SystemSettingsPage'))
const PromotionsPage             = lazy(() => import('./pages/promotions/PromotionsPage'))
const PrintPreviewPage           = lazy(() => import('./pages/system/PrintPreviewPage'))


// ─────────────────────────────────────────────────────────────
// Loading spinner dùng chung cho PrivateRoute + Suspense fallback
// ─────────────────────────────────────────────────────────────
function FullPageSpinner() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '100vh', gap: '12px',
      fontFamily: "'Be Vietnam Pro', sans-serif",
      color: '#4A5663', background: '#FAFBFC'
    }}>
      <div style={{
        width: '36px', height: '36px',
        border: '3px solid #E5E9EE', borderTopColor: '#1E5A9C',
        borderRadius: '50%', animation: 'spin 0.7s linear infinite'
      }} />
      <p style={{ fontSize: '14px' }}>Đang tải...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Guard: Bảo vệ route cần đăng nhập
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Access Denied Component
// ─────────────────────────────────────────────────────────────
function AccessDenied() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center border border-red-100 mb-6 shadow-sm animate-bounce duration-1000">
          <ShieldAlert size={40} />
        </div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-800 tracking-tight">
          Không có quyền truy cập
        </h1>
        <p className="text-body-md text-gray-500 mt-3 max-w-md leading-relaxed">
          Tài khoản của bạn không có đủ quyền hạn để xem trang này. Vui lòng liên hệ với Quản trị viên nếu bạn nghĩ đây là sự nhầm lẫn.
        </p>
        <div className="flex gap-3 mt-8">
          <button
            onClick={() => window.history.back()}
            className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold text-body-md hover:bg-gray-200 active:scale-95 transition-all"
          >
            Quay lại
          </button>
          <button
            onClick={() => window.location.href = '/dashboard'}
            className="px-5 py-2.5 bg-[#1E5A9C] hover:bg-[#143C69] text-white rounded-xl font-semibold text-body-md active:scale-95 transition-all shadow-md"
          >
            Trang chủ
          </button>
        </div>
      </div>
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────
// ProtectedRoute: Kiểm tra trạng thái đăng nhập & phân quyền module
// ─────────────────────────────────────────────────────────────
function ProtectedRoute({ children, perms = [], adminOnly = false }: { children: React.ReactNode; perms?: string[]; adminOnly?: boolean }) {
  const { isAuthenticated, loading, rbacReady, userRole, userPermissions } = useAuth()

  if (loading) return <FullPageSpinner />
  if (!isAuthenticated) return <Navigate to="/login" replace />

  // ⚠️ Chờ RBAC giải quyết xong TRƯỚC khi gating. Nếu không, role mặc định tạm thời
  // ('guest' fail-closed) sẽ khiến admin bị "Không có quyền" nhấp nháy; còn nếu fail-open
  // sẽ rò rỉ trang cho user thường. Vì vậy hiển thị spinner cho tới khi rbacReady.
  if (!rbacReady) return <FullPageSpinner />

  // Route chỉ dành cho admin (vd: Trung tâm Báo cáo) — kể cả CEO cũng bị chặn
  if (adminOnly) {
    return userRole.code === 'admin' ? <>{children}</> : <AccessDenied />
  }

  // Admin và CEO bypass toàn bộ quyền hạn
  if (userRole.code === 'admin' || userRole.code === 'ceo') {
    return <>{children}</>
  }

  // Nếu không yêu cầu quyền cụ thể, cho phép truy cập
  if (perms.length === 0) {
    return <>{children}</>
  }

  // Kiểm tra xem user có ít nhất một trong các quyền yêu cầu
  const hasAccess = perms.some(perm => userPermissions.includes(perm))
  if (!hasAccess) {
    return <AccessDenied />
  }

  return <>{children}</>
}

// ─────────────────────────────────────────────────────────────
// App Root
// ─────────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/customers" element={<ProtectedRoute perms={['customers.view_own', 'customers.view_team', 'customers.view_all']}><CustomerListPage /></ProtectedRoute>} />
      <Route path="/customers/settings" element={<ProtectedRoute perms={['users.manage']}><CustomerSettingsPage /></ProtectedRoute>} />
      <Route path="/customers/duplicates" element={<ProtectedRoute adminOnly><CustomerDuplicatesPage /></ProtectedRoute>} />
      <Route path="/customers/credit-limits" element={<ProtectedRoute adminOnly><CreditLimitsPage /></ProtectedRoute>} />
      <Route path="/customers/map" element={<ProtectedRoute perms={['customers.view_own', 'customers.view_team', 'customers.view_all']}><CustomerMapPage /></ProtectedRoute>} />
      <Route path="/customers/care" element={<ProtectedRoute perms={['customers.view_own', 'customers.view_team', 'customers.view_all']}><CustomerCarePage /></ProtectedRoute>} />
      <Route path="/customers/:id" element={<ProtectedRoute perms={['customers.view_own', 'customers.view_team', 'customers.view_all']}><CustomerDetailPage /></ProtectedRoute>} />
      <Route path="/products" element={<ProtectedRoute perms={['products.view', 'products.manage', 'pricing.manage', 'promotions.manage']}><ProductListPage /></ProtectedRoute>} />
      {/* ⚠️ Các route cụ thể PHẢI đứng TRƯỚC route wildcard /products/:id */}
      {/* Bảng giá bán: MỌI nhân viên đều xem/tra cứu được. Quyền chỉ chặn ở
          thao tác SỬA giá (khớp RLS price_list_items), xem PriceListPage. */}
      <Route path="/products/prices" element={<ProtectedRoute><PriceListPage /></ProtectedRoute>} />
      <Route path="/products/ingredients" element={<ProtectedRoute perms={['products.view', 'products.manage']}><ActiveIngredientsPage /></ProtectedRoute>} />
      <Route path="/products/:id" element={<ProtectedRoute perms={['products.view', 'products.manage']}><ProductDetailPage /></ProtectedRoute>} />
      <Route path="/suppliers" element={<ProtectedRoute perms={['purchase_orders.create', 'purchase_orders.approve', 'inventory.view', 'inventory.receive']}><SupplierListPage /></ProtectedRoute>} />
      <Route path="/suppliers/:id" element={<ProtectedRoute perms={['purchase_orders.create', 'purchase_orders.approve', 'inventory.view', 'inventory.receive']}><SupplierDetailPage /></ProtectedRoute>} />
      <Route path="/inventory/expiry" element={<ProtectedRoute perms={['inventory.view']}><ExpiryPage /></ProtectedRoute>} />
      <Route path="/inventory/reorder" element={<ProtectedRoute perms={['inventory.view']}><ReorderPage /></ProtectedRoute>} />
      <Route path="/inventory/gdrive-import" element={<ProtectedRoute perms={['inventory.receive']}><GdriveImportPage /></ProtectedRoute>} />
      <Route path="/inventory/gdrive-sources" element={<ProtectedRoute adminOnly><GdriveSourcesPage /></ProtectedRoute>} />
      <Route path="/inventory/vat" element={<ProtectedRoute perms={['cashbook.view']}><VatManagementPage /></ProtectedRoute>} />
      <Route path="/inventory" element={<ProtectedRoute perms={['inventory.view', 'inventory.receive', 'inventory.adjust', 'inventory.transfer']}><InventoryPage /></ProtectedRoute>} />
      <Route path="/purchase-orders/new" element={<ProtectedRoute perms={['purchase_orders.create']}><PurchaseOrderFormPage /></ProtectedRoute>} />
      <Route path="/goods-receipts/new" element={<ProtectedRoute perms={['inventory.receive']}><GoodsReceiptFormPage /></ProtectedRoute>} />
      {/* ⚠️ /new đứng TRƯỚC /:id */}
      <Route path="/goods-receipts/:id" element={<ProtectedRoute perms={['inventory.view', 'inventory.receive']}><GoodsReceiptDetailPage /></ProtectedRoute>} />
      <Route path="/orders" element={<ProtectedRoute perms={['orders.view_own', 'orders.view_team', 'orders.view_all', 'orders.create']}><OrderListPage /></ProtectedRoute>} />
      {/* ⚠️ Các route cụ thể PHẢI đứng TRƯỚC route wildcard /orders/:id */}
      <Route path="/orders/pos" element={<ProtectedRoute perms={['orders.create']}><POSPage /></ProtectedRoute>} />
      <Route path="/orders/mobile" element={<ProtectedRoute perms={['orders.create']}><MobileOrderPage /></ProtectedRoute>} />
      <Route path="/orders/:id" element={<ProtectedRoute perms={['orders.view_own', 'orders.view_team', 'orders.view_all']}><OrderDetailPage /></ProtectedRoute>} />
      <Route path="/returns" element={<ProtectedRoute perms={['orders.view_own', 'orders.view_team', 'orders.view_all']}><ReturnListPage /></ProtectedRoute>} />
      <Route path="/pipeline" element={<ProtectedRoute perms={['opportunities.view_all', 'opportunities.create']}><PipelinePage /></ProtectedRoute>} />
      <Route path="/cashbook" element={<ProtectedRoute perms={['cashbook.view', 'cashbook.create', 'cashbook.approve']}><CashbookPage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute adminOnly><ReportsHubPage /></ProtectedRoute>} />
      <Route path="/reports/profit" element={<ProtectedRoute adminOnly><ProfitReportPage /></ProtectedRoute>} />
      <Route path="/reports/customer-profile" element={<ProtectedRoute adminOnly><CustomerProfileReportPage /></ProtectedRoute>} />
      <Route path="/reports/inventory-valuation" element={<ProtectedRoute adminOnly><InventoryValuationReportPage /></ProtectedRoute>} />
      <Route path="/reports/strategic-products" element={<ProtectedRoute adminOnly><StrategicProductsReportPage /></ProtectedRoute>} />
      <Route path="/reports/bi" element={<ProtectedRoute adminOnly><BiAnalyticsPage /></ProtectedRoute>} />
      <Route path="/reports/demand-forecast" element={<ProtectedRoute adminOnly><DemandForecastPage /></ProtectedRoute>} />
      <Route path="/herd-projects" element={<ProtectedRoute perms={['herd_projects.view_all', 'herd_projects.create']}><HerdProjectListPage /></ProtectedRoute>} />
      {/* ⚠️ Các route cụ thể PHẢI đứng TRƯỚC route wildcard /herd-projects/:id */}
      <Route path="/herd-projects/new" element={<ProtectedRoute perms={['herd_projects.create']}><HerdProjectFormPage /></ProtectedRoute>} />
      <Route path="/herd-projects/herds" element={<ProtectedRoute perms={['herd_projects.view_all', 'herd_projects.create']}><HerdsManagePage /></ProtectedRoute>} />
      <Route path="/herd-projects/:id" element={<ProtectedRoute perms={['herd_projects.view_all']}><HerdProjectDetailPage /></ProtectedRoute>} />
      {/* /products/ingredients đã được khai báo ở trên, không cần lặp lại */}
      <Route path="/diseases" element={<ProtectedRoute perms={['herd_projects.view_all', 'herd_projects.create']}><DiseasesPage /></ProtectedRoute>} />
      {/* Cấu hình Hệ thống & Tổ chức: CHỈ Admin (quyền cao nhất), loại cả CEO. */}
      <Route path="/system-settings" element={<ProtectedRoute adminOnly><SystemSettingsPage /></ProtectedRoute>} />
      <Route path="/promotions" element={<ProtectedRoute perms={['promotions.manage']}><PromotionsPage /></ProtectedRoute>} />
      <Route path="/print-preview" element={<ProtectedRoute><PrintPreviewPage /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  )
}

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 p-6 font-sans">
        <div className="max-w-xl w-full bg-slate-800/80 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center space-x-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-500">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">Chưa Cấu Hình Supabase</h2>
              <p className="text-sm text-slate-400">Thiếu các biến môi trường cần thiết để kết nối cơ sở dữ liệu</p>
            </div>
          </div>

          <div className="space-y-4 text-sm text-slate-300">
            <p>Hệ thống phát hiện dự án của bạn chưa được cấu hình các thông số kết nối cơ sở dữ liệu Supabase. Vui lòng làm theo các bước sau:</p>

            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-start space-x-3">
                <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-400 mt-0.5">1</span>
                <div>
                  <p className="font-semibold text-white">Truy cập Vercel Dashboard</p>
                  <p className="text-xs text-slate-400">Mở dự án của bạn trên trang quản trị Vercel.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-400 mt-0.5">2</span>
                <div>
                  <p className="font-semibold text-white">Thêm biến môi trường (Environment Variables)</p>
                  <p className="text-xs text-slate-400">Vào mục <span className="text-slate-200 font-mono bg-slate-800 px-1 py-0.5 rounded">Settings</span> &rarr; <span className="text-slate-200 font-mono bg-slate-800 px-1 py-0.5 rounded">Environment Variables</span> và thêm 2 khóa sau:</p>
                  <div className="mt-2 space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between items-center bg-slate-800/50 px-3 py-1.5 rounded border border-slate-700/30 text-slate-300">
                      <span className="text-amber-400">VITE_SUPABASE_URL</span>
                      <span className="text-slate-500 text-[10px]">URL của dự án Supabase</span>
                    </div>
                    <div className="flex justify-between items-center bg-slate-800/50 px-3 py-1.5 rounded border border-slate-700/30 text-slate-300">
                      <span className="text-amber-400">VITE_SUPABASE_ANON_KEY</span>
                      <span className="text-slate-500 text-[10px]">Anon Public Key của Supabase</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-400 mt-0.5">3</span>
                <div>
                  <p className="font-semibold text-white">Triển khai lại dự án (Redeploy)</p>
                  <p className="text-xs text-slate-400">Vào tab <span className="text-slate-200 font-mono bg-slate-800 px-1 py-0.5 rounded">Deployments</span>, click vào dấu ba chấm ở bản deploy mới nhất và chọn <span className="text-slate-200 font-medium">Redeploy</span>.</p>
                </div>
              </div>
            </div>
            
            <p className="text-xs text-slate-400 italic font-sans">Lưu ý: Nếu bạn chạy dưới localhost, hãy tạo tệp <span className="font-mono text-slate-300">.env.local</span> ở thư mục gốc của dự án.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <DisplaySettingsProvider>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </DisplaySettingsProvider>
        </AuthProvider>
      </BrowserRouter>
      <PwaUpdateBanner />
    </ErrorBoundary>
  )
}

