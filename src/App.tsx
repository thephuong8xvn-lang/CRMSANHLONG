import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthCallback from './pages/AuthCallback'
import LoginPage from './pages/auth/LoginPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import CustomerListPage from './pages/customers/CustomerListPage'
import CustomerDetailPage from './pages/customers/CustomerDetailPage'
import ProductListPage from './pages/products/ProductListPage'
import ProductDetailPage from './pages/products/ProductDetailPage'
import PriceListPage from './pages/products/PriceListPage'
import SupplierListPage from './pages/suppliers/SupplierListPage'
import SupplierDetailPage from './pages/suppliers/SupplierDetailPage'
import InventoryPage from './pages/inventory/InventoryPage'
import PurchaseOrderFormPage from './pages/purchase-orders/PurchaseOrderFormPage'
import GoodsReceiptFormPage from './pages/goods-receipts/GoodsReceiptFormPage'
import OrderListPage from './pages/orders/OrderListPage'
import OrderDetailPage from './pages/orders/OrderDetailPage'
import POSPage from './pages/orders/POSPage'
import MobileOrderPage from './pages/orders/MobileOrderPage'
import PipelinePage from './pages/pipeline/PipelinePage'
import CashbookPage from './pages/cashbook/CashbookPage'
import ReportsHubPage from './pages/reports/ReportsHubPage'
import RevenueReportPage from './pages/reports/RevenueReportPage'
import DebtReportPage from './pages/reports/DebtReportPage'
import InventoryReportPage from './pages/reports/InventoryReportPage'
import StaffReportPage from './pages/reports/StaffReportPage'
import CustomerProfileReportPage from './pages/reports/CustomerProfileReportPage'
import HerdProjectListPage from './pages/herd-projects/HerdProjectListPage'
import HerdProjectFormPage from './pages/herd-projects/HerdProjectFormPage'
import HerdProjectDetailPage from './pages/herd-projects/HerdProjectDetailPage'
import SystemSettingsPage from './pages/system/SystemSettingsPage'
import { DisplaySettingsProvider } from './contexts/DisplaySettingsContext'


// ─────────────────────────────────────────────────────────────
// Guard: Bảo vệ route cần đăng nhập
// ─────────────────────────────────────────────────────────────
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()
  console.log('[PrivateRoute] render:', { isAuthenticated, loading })

  if (loading) {
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

  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

// Dashboard chính thức được import từ './pages/dashboard/DashboardPage'

// ─────────────────────────────────────────────────────────────
// App Root
// ─────────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/dashboard" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
      <Route path="/customers" element={<PrivateRoute><CustomerListPage /></PrivateRoute>} />
      <Route path="/customers/:id" element={<PrivateRoute><CustomerDetailPage /></PrivateRoute>} />
      <Route path="/products" element={<PrivateRoute><ProductListPage /></PrivateRoute>} />
      <Route path="/products/:id" element={<PrivateRoute><ProductDetailPage /></PrivateRoute>} />
      <Route path="/products/prices" element={<PrivateRoute><PriceListPage /></PrivateRoute>} />
      <Route path="/suppliers" element={<PrivateRoute><SupplierListPage /></PrivateRoute>} />
      <Route path="/suppliers/:id" element={<PrivateRoute><SupplierDetailPage /></PrivateRoute>} />
      <Route path="/inventory" element={<PrivateRoute><InventoryPage /></PrivateRoute>} />
      <Route path="/purchase-orders/new" element={<PrivateRoute><PurchaseOrderFormPage /></PrivateRoute>} />
      <Route path="/goods-receipts/new" element={<PrivateRoute><GoodsReceiptFormPage /></PrivateRoute>} />
      <Route path="/orders" element={<PrivateRoute><OrderListPage /></PrivateRoute>} />
      <Route path="/orders/:id" element={<PrivateRoute><OrderDetailPage /></PrivateRoute>} />
      <Route path="/orders/pos" element={<PrivateRoute><POSPage /></PrivateRoute>} />
      <Route path="/orders/mobile" element={<PrivateRoute><MobileOrderPage /></PrivateRoute>} />
      <Route path="/pipeline" element={<PrivateRoute><PipelinePage /></PrivateRoute>} />
      <Route path="/cashbook" element={<PrivateRoute><CashbookPage /></PrivateRoute>} />
      <Route path="/reports" element={<PrivateRoute><ReportsHubPage /></PrivateRoute>} />
      <Route path="/reports/revenue" element={<PrivateRoute><RevenueReportPage /></PrivateRoute>} />
      <Route path="/reports/debt" element={<PrivateRoute><DebtReportPage /></PrivateRoute>} />
      <Route path="/reports/inventory" element={<PrivateRoute><InventoryReportPage /></PrivateRoute>} />
      <Route path="/reports/staff" element={<PrivateRoute><StaffReportPage /></PrivateRoute>} />
      <Route path="/reports/customer-profile" element={<PrivateRoute><CustomerProfileReportPage /></PrivateRoute>} />
      <Route path="/herd-projects" element={<PrivateRoute><HerdProjectListPage /></PrivateRoute>} />
      <Route path="/herd-projects/new" element={<PrivateRoute><HerdProjectFormPage /></PrivateRoute>} />
      <Route path="/herd-projects/:id" element={<PrivateRoute><HerdProjectDetailPage /></PrivateRoute>} />
      <Route path="/system-settings" element={<PrivateRoute><SystemSettingsPage /></PrivateRoute>} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
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

