import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { isSupabaseConfigured } from './lib/supabase'
import { DisplaySettingsProvider } from './contexts/DisplaySettingsContext'

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
const ProductListPage            = lazy(() => import('./pages/products/ProductListPage'))
const ProductDetailPage          = lazy(() => import('./pages/products/ProductDetailPage'))
const PriceListPage              = lazy(() => import('./pages/products/PriceListPage'))
const ActiveIngredientsPage      = lazy(() => import('./pages/products/ActiveIngredientsPage'))
const DiseasesPage               = lazy(() => import('./pages/products/DiseasesPage'))
const SupplierListPage           = lazy(() => import('./pages/suppliers/SupplierListPage'))
const SupplierDetailPage         = lazy(() => import('./pages/suppliers/SupplierDetailPage'))
const InventoryPage              = lazy(() => import('./pages/inventory/InventoryPage'))
const PurchaseOrderFormPage      = lazy(() => import('./pages/purchase-orders/PurchaseOrderFormPage'))
const GoodsReceiptFormPage       = lazy(() => import('./pages/goods-receipts/GoodsReceiptFormPage'))
const OrderListPage              = lazy(() => import('./pages/orders/OrderListPage'))
const OrderDetailPage            = lazy(() => import('./pages/orders/OrderDetailPage'))
const POSPage                    = lazy(() => import('./pages/orders/POSPage'))
const MobileOrderPage            = lazy(() => import('./pages/orders/MobileOrderPage'))
const PipelinePage               = lazy(() => import('./pages/pipeline/PipelinePage'))
const CashbookPage               = lazy(() => import('./pages/cashbook/CashbookPage'))
const ReportsHubPage             = lazy(() => import('./pages/reports/ReportsHubPage'))
const RevenueReportPage          = lazy(() => import('./pages/reports/RevenueReportPage'))
const DebtReportPage             = lazy(() => import('./pages/reports/DebtReportPage'))
const InventoryReportPage        = lazy(() => import('./pages/reports/InventoryReportPage'))
const StaffReportPage            = lazy(() => import('./pages/reports/StaffReportPage'))
const CustomerProfileReportPage  = lazy(() => import('./pages/reports/CustomerProfileReportPage'))
const HerdProjectListPage        = lazy(() => import('./pages/herd-projects/HerdProjectListPage'))
const HerdProjectFormPage        = lazy(() => import('./pages/herd-projects/HerdProjectFormPage'))
const HerdProjectDetailPage      = lazy(() => import('./pages/herd-projects/HerdProjectDetailPage'))
const SystemSettingsPage         = lazy(() => import('./pages/system/SystemSettingsPage'))


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
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()

  if (loading) return <FullPageSpinner />
  if (!isAuthenticated) return <Navigate to="/login" replace />
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
      <Route path="/dashboard" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
      <Route path="/customers" element={<PrivateRoute><CustomerListPage /></PrivateRoute>} />
      <Route path="/customers/settings" element={<PrivateRoute><CustomerSettingsPage /></PrivateRoute>} />
      <Route path="/customers/:id" element={<PrivateRoute><CustomerDetailPage /></PrivateRoute>} />
      <Route path="/products" element={<PrivateRoute><ProductListPage /></PrivateRoute>} />
      {/* ⚠️ Các route cụ thể PHẢI đứng TRƯỚC route wildcard /products/:id */}
      <Route path="/products/prices" element={<PrivateRoute><PriceListPage /></PrivateRoute>} />
      <Route path="/products/ingredients" element={<PrivateRoute><ActiveIngredientsPage /></PrivateRoute>} />
      <Route path="/products/:id" element={<PrivateRoute><ProductDetailPage /></PrivateRoute>} />
      <Route path="/suppliers" element={<PrivateRoute><SupplierListPage /></PrivateRoute>} />
      <Route path="/suppliers/:id" element={<PrivateRoute><SupplierDetailPage /></PrivateRoute>} />
      <Route path="/inventory" element={<PrivateRoute><InventoryPage /></PrivateRoute>} />
      <Route path="/purchase-orders/new" element={<PrivateRoute><PurchaseOrderFormPage /></PrivateRoute>} />
      <Route path="/goods-receipts/new" element={<PrivateRoute><GoodsReceiptFormPage /></PrivateRoute>} />
      <Route path="/orders" element={<PrivateRoute><OrderListPage /></PrivateRoute>} />
      {/* ⚠️ Các route cụ thể PHẢI đứng TRƯỚC route wildcard /orders/:id */}
      <Route path="/orders/pos" element={<PrivateRoute><POSPage /></PrivateRoute>} />
      <Route path="/orders/mobile" element={<PrivateRoute><MobileOrderPage /></PrivateRoute>} />
      <Route path="/orders/:id" element={<PrivateRoute><OrderDetailPage /></PrivateRoute>} />
      <Route path="/pipeline" element={<PrivateRoute><PipelinePage /></PrivateRoute>} />
      <Route path="/cashbook" element={<PrivateRoute><CashbookPage /></PrivateRoute>} />
      <Route path="/reports" element={<PrivateRoute><ReportsHubPage /></PrivateRoute>} />
      <Route path="/reports/revenue" element={<PrivateRoute><RevenueReportPage /></PrivateRoute>} />
      <Route path="/reports/debt" element={<PrivateRoute><DebtReportPage /></PrivateRoute>} />
      <Route path="/reports/inventory" element={<PrivateRoute><InventoryReportPage /></PrivateRoute>} />
      <Route path="/reports/staff" element={<PrivateRoute><StaffReportPage /></PrivateRoute>} />
      <Route path="/reports/customer-profile" element={<PrivateRoute><CustomerProfileReportPage /></PrivateRoute>} />
      <Route path="/herd-projects" element={<PrivateRoute><HerdProjectListPage /></PrivateRoute>} />
      {/* ⚠️ Các route cụ thể PHẢI đứng TRƯỚC route wildcard /herd-projects/:id */}
      <Route path="/herd-projects/new" element={<PrivateRoute><HerdProjectFormPage /></PrivateRoute>} />
      <Route path="/herd-projects/:id" element={<PrivateRoute><HerdProjectDetailPage /></PrivateRoute>} />
      {/* /products/ingredients đã được khai báo ở trên, không cần lặp lại */}
      <Route path="/diseases" element={<PrivateRoute><DiseasesPage /></PrivateRoute>} />
      <Route path="/system-settings" element={<PrivateRoute><SystemSettingsPage /></PrivateRoute>} />
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
    <BrowserRouter>
      <AuthProvider>
        <DisplaySettingsProvider>
          <AppRoutes />
        </DisplaySettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

