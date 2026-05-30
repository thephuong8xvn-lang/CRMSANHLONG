import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wallet,
  AlertTriangle,
  Package,
  Info,
  Calendar,
  Receipt,
  Building2,
  Boxes,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import Layout from '../../components/Layout'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useDashboardStats } from '../../hooks/queries/useDashboardStats'
import { usePendingDisbursements, useTodayAppointments } from '../../hooks/queries/useDashboardLists'
import { useBranches } from '../../hooks/queries/useBranches'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { profile, userRole, hasPermission } = useAuth()
  const { formatCurrency } = useDisplaySettings()

  // ── Phạm vi chi nhánh ──────────────────────────────────────────
  // admin/ceo: được chọn chi nhánh (mặc định null = toàn hệ thống).
  // Vai trò khác: khóa cứng vào chi nhánh trong hồ sơ.
  const isAdmin = userRole.code === 'admin' || userRole.code === 'ceo'
  const branchesQuery = useBranches(!!profile?.id)
  const branches = branchesQuery.data ?? []

  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const effectiveBranchId = isAdmin ? selectedBranchId : (profile?.branch_id ?? null)

  const currentBranchName = useMemo(() => {
    if (!effectiveBranchId) return null
    return branches.find(b => b.id === effectiveBranchId)?.name ?? null
  }, [effectiveBranchId, branches])

  // ── Số liệu Dashboard chạy song song qua TanStack Query, lọc theo chi nhánh
  const statsQuery   = useDashboardStats(!!profile?.id, effectiveBranchId)
  const disbursQuery = usePendingDisbursements(3, effectiveBranchId)
  const apptQuery    = useTodayAppointments(3, effectiveBranchId)

  const stats = statsQuery.data
  const chartData = stats?.cashflow_6m ?? []
  const disbursements = disbursQuery.data ?? []
  const appointments  = apptQuery.data ?? []
  const loading = statsQuery.isLoading
  const isError = statsQuery.isError

  const formatVND = (num: number) => formatCurrency(num)

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Chào buổi sáng'
    if (hour < 18) return 'Chào buổi chiều'
    return 'Chào buổi tối'
  }

  const monthlyDelta = stats?.monthly_revenue_delta ?? 0
  const monthlyDeltaStr = stats
    ? `${monthlyDelta >= 0 ? '+' : ''}${monthlyDelta.toFixed(1)}% vs tháng trước`
    : '0% vs tháng trước'

  const scopeLabel = effectiveBranchId
    ? `chi nhánh ${currentBranchName ?? ''}`.trim()
    : 'toàn hệ thống'

  const renderRoleAlerts = () => {
    if (userRole.code === 'sales') {
      return (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-3">
          <Info className="text-blue-500 mt-0.5 flex-shrink-0" size={18} strokeWidth={1.5} />
          <div>
            <h4 className="font-semibold text-blue-700 text-body-md">Lưu ý cho Nhân viên kinh doanh</h4>
            <p className="text-gray-500 text-tiny mt-1">Hãy tập trung chăm sóc các khách hàng có cảnh báo "Nguy cơ rời trại" và hỗ trợ kế toán đôn đốc công nợ sắp đến hạn thanh toán.</p>
          </div>
        </div>
      )
    }
    if (userRole.code === 'accountant') {
      return (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
          <AlertTriangle className="text-amber-600 mt-0.5 flex-shrink-0" size={18} strokeWidth={1.5} />
          <div>
            <h4 className="font-semibold text-amber-800 text-body-md">Nhắc nhở Kế toán</h4>
            <p className="text-gray-500 text-tiny mt-1">Hiện có {stats?.overdue_debt_count ?? 0} khách hàng trễ hạn thanh toán. Hãy kiểm tra các phiếu chi chờ duyệt để đảm bảo dòng tiền được đối soát chính xác cuối ngày.</p>
          </div>
        </div>
      )
    }
    if (userRole.code === 'branch_manager') {
      return (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-3">
          <Building2 className="text-blue-500 mt-0.5 flex-shrink-0" size={18} strokeWidth={1.5} />
          <div>
            <h4 className="font-semibold text-blue-700 text-body-md">Tổng quan Quản lý chi nhánh</h4>
            <p className="text-gray-500 text-tiny mt-1">Số liệu dưới đây chỉ tính trong phạm vi {scopeLabel}. Theo dõi doanh thu, công nợ quá hạn và phiếu chi chờ duyệt của chi nhánh bạn phụ trách.</p>
          </div>
        </div>
      )
    }
    if (userRole.code === 'warehouse_keeper') {
      return (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
          <Boxes className="text-amber-600 mt-0.5 flex-shrink-0" size={18} strokeWidth={1.5} />
          <div>
            <h4 className="font-semibold text-amber-800 text-body-md">Nhắc nhở Thủ kho</h4>
            <p className="text-gray-500 text-tiny mt-1">Có {stats?.expiring_lots_count ?? 0} lô hàng sắp hết hạn trong 30 ngày tới. Hãy ưu tiên xuất các lô cận hạn (FEFO) và kiểm tra tồn kho an toàn.</p>
          </div>
        </div>
      )
    }
    return null
  }

  // Bộ chọn / nhãn phạm vi chi nhánh
  const renderBranchContext = () => (
    <div className="mb-6 flex flex-wrap items-center gap-3 p-3 bg-gray-25 border border-gray-100 rounded-lg">
      <div className="flex items-center gap-2 text-gray-500">
        <Building2 size={16} className="text-blue-500" />
        <span className="text-tiny font-semibold uppercase tracking-wide">Phạm vi dữ liệu</span>
      </div>
      {isAdmin ? (
        <select
          value={selectedBranchId ?? ''}
          onChange={(e) => setSelectedBranchId(e.target.value || null)}
          className="h-9 px-3 rounded-lg border border-gray-200 bg-gray-0 text-body-md font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">Tất cả chi nhánh</option>
          {branches.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      ) : (
        <span className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-body-md font-semibold">
          {currentBranchName ?? 'Chưa gán chi nhánh'}
        </span>
      )}
      <span className="text-tiny text-gray-400">
        Đang xem số liệu {scopeLabel}
      </span>
    </div>
  )

  // Skeleton cho lần tải đầu — mượt hơn spinner toàn trang
  const renderSkeleton = () => (
    <div className="animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-gray-0 border border-gray-100 rounded-lg p-6">
            <div className="h-4 w-32 bg-gray-100 rounded mb-6"></div>
            <div className="h-8 w-40 bg-gray-100 rounded mb-3"></div>
            <div className="h-5 w-28 bg-gray-50 rounded-full"></div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-gray-0 border border-gray-100 rounded-lg p-6 min-h-[480px]">
          <div className="h-5 w-64 bg-gray-100 rounded mb-8"></div>
          <div className="h-[320px] bg-gray-50 rounded"></div>
        </div>
        <div className="lg:col-span-4 space-y-8">
          {[0, 1].map(i => (
            <div key={i} className="bg-gray-0 border border-gray-100 rounded-lg p-6">
              <div className="h-5 w-40 bg-gray-100 rounded mb-6"></div>
              <div className="space-y-4">
                {[0, 1, 2].map(j => <div key={j} className="h-10 bg-gray-50 rounded"></div>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <Layout activeMenu="Bảng điều khiển">
      <div className="p-4 md:p-10 max-w-[1600px] w-full mx-auto">
        {/* Welcome Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-h1 font-semibold text-gray-700">{getGreeting()}, {profile?.full_name || 'Quản trị viên'}</h2>
            <p className="text-body-md text-gray-400 mt-1">
              Đây là tóm tắt hoạt động {scopeLabel} hôm nay.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
            <button
              onClick={() => navigate('/orders/pos')}
              className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white px-5 h-11 rounded-lg font-bold text-body-md active:scale-95 transition-all flex items-center gap-2 shadow-md"
            >
              <Receipt size={18} strokeWidth={2} />
              <span>Bán hàng POS</span>
            </button>

            <div className="bg-gray-0 border border-gray-100 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <Calendar size={16} className="text-blue-500" />
              <span className="text-body-md font-semibold tabular-nums">
                {new Date().toLocaleDateString('vi-VN', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>

        {renderBranchContext()}
        {renderRoleAlerts()}

        {isError ? (
          <div className="p-8 bg-red-50 border border-red-100 rounded-lg flex flex-col items-center text-center gap-3">
            <AlertTriangle className="text-danger-500" size={28} />
            <p className="text-body-md font-semibold text-danger-600">Không thể tải dữ liệu tổng quan</p>
            <p className="text-tiny text-gray-500">Vui lòng kiểm tra kết nối hoặc thử lại.</p>
            <button
              onClick={() => statsQuery.refetch()}
              className="mt-1 px-4 h-9 rounded-lg bg-gray-0 border border-gray-200 text-body-md font-semibold hover:border-gray-300"
            >
              Thử lại
            </button>
          </div>
        ) : loading ? (
          renderSkeleton()
        ) : (
          <>
            {/* Metrics Summary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-gray-0 border border-gray-100 rounded-lg p-6 hover:border-gray-200 transition-all">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-body-md font-semibold text-gray-500">Doanh thu tháng</span>
                  <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-lg flex items-center justify-center">
                    <Wallet size={20} strokeWidth={1.5} />
                  </div>
                </div>
                <div className="text-[28px] font-bold text-gray-700 tabular-nums mb-2">
                  {formatVND(stats?.monthly_revenue ?? 0)}
                </div>
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-gray-600 text-tiny font-semibold">
                  <span className={`w-2 h-2 rounded-full ${monthlyDelta >= 0 ? 'bg-success-500' : 'bg-danger-500'}`}></span>
                  {monthlyDeltaStr}
                </div>
              </div>

              <div className="bg-gray-0 border border-gray-100 rounded-lg p-6 hover:border-gray-200 transition-all">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-body-md font-semibold text-gray-500">Công nợ quá hạn</span>
                  <div className="w-10 h-10 bg-red-50 text-danger-500 rounded-lg flex items-center justify-center">
                    <AlertTriangle size={20} strokeWidth={1.5} />
                  </div>
                </div>
                <div className="text-[28px] font-bold text-danger-500 tabular-nums mb-2">
                  {formatVND(stats?.overdue_debt ?? 0)}
                </div>
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-gray-600 text-tiny font-semibold">
                  <span className="w-2 h-2 rounded-full bg-danger-500"></span>
                  {stats?.overdue_debt_count ?? 0} khách hàng đang trễ hạn
                </div>
              </div>

              <div className="bg-gray-0 border border-gray-100 rounded-lg p-6 hover:border-gray-200 transition-all">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-body-md font-semibold text-gray-500">Lô hàng sắp hết hạn</span>
                  <div className="w-10 h-10 bg-amber-50 text-warning-500 rounded-lg flex items-center justify-center">
                    <Package size={20} strokeWidth={1.5} />
                  </div>
                </div>
                <div className="text-[28px] font-bold text-gray-700 tabular-nums mb-2">
                  {stats?.expiring_lots_count ?? 0} lô
                </div>
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-gray-600 text-tiny font-semibold">
                  <span className="w-2 h-2 rounded-full bg-warning-500"></span>
                  Trong 30 ngày tới
                </div>
              </div>
            </div>

            {/* Main Dashboard Rows */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8 flex flex-col">
                <div className="bg-gray-0 border border-gray-100 rounded-lg p-6 flex-1 flex flex-col min-h-[480px]">
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h3 className="text-h2 font-semibold text-gray-700">Xu hướng doanh thu & Dòng tiền</h3>
                      <p className="text-tiny text-gray-400 mt-1">So sánh dòng tiền thu vào (Inflows) và chi ra (Outflows) định kỳ • {scopeLabel}</p>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-blue-500 rounded-sm"></span>
                        <span className="text-tiny text-gray-500">Thu vào</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-blue-200 rounded-sm"></span>
                        <span className="text-tiny text-gray-500">Chi ra</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex-grow w-full min-h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E9EE" />
                        <XAxis dataKey="name" stroke="#A8B2BD" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#A8B2BD" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}tr`} />
                        <Tooltip
                          cursor={{ fill: '#F4F6F8' }}
                          formatter={(value) => [formatVND(value as number), '']}
                          contentStyle={{
                            background: '#FFFFFF',
                            borderColor: '#E5E9EE',
                            borderRadius: '8px',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                          }}
                        />
                        <Bar dataKey="inflow"  fill="#1E5A9C" radius={[4, 4, 0, 0]} maxBarSize={32} name="Thu vào" />
                        <Bar dataKey="outflow" fill="#AEC9E9" radius={[4, 4, 0, 0]} maxBarSize={32} name="Chi ra" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Right side: Lists & Logs */}
              <div className="lg:col-span-4 space-y-8">
                <section className="bg-gray-0 border border-gray-100 rounded-lg p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-h2 font-semibold text-gray-700">Phiếu chi chờ duyệt</h3>
                    {hasPermission('cashbook.view') && (
                      <button
                        onClick={() => navigate('/cashbook')}
                        className="text-blue-500 text-body-md font-semibold hover:underline"
                      >
                        Tất cả
                      </button>
                    )}
                  </div>

                  <div className="space-y-6">
                    {disbursements.length > 0 ? (
                      disbursements.map((item) => (
                        <div key={item.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 font-semibold">
                              {item.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-body-md font-semibold text-gray-700">{item.name}</p>
                              <p className="text-tiny text-gray-400">{item.time} • {item.category}</p>
                            </div>
                          </div>
                          <p className="text-body-md font-semibold tabular-nums text-right text-gray-700">
                            {formatVND(item.amount)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="py-6 text-center text-gray-400 text-tiny">
                        Không có phiếu chi nào đang chờ duyệt.
                      </div>
                    )}
                  </div>
                </section>

                <section className="bg-gray-0 border border-gray-100 rounded-lg p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-h2 font-semibold text-gray-700">Lịch hẹn hôm nay</h3>
                  </div>

                  <div className="space-y-6">
                    {appointments.length > 0 ? (
                      appointments.map((item, idx) => (
                        <div key={item.id} className="flex items-start gap-3">
                          <div className="flex flex-col items-center min-w-[48px]">
                            <span className="text-[12px] font-semibold text-blue-500 tabular-nums">{item.time}</span>
                            {idx !== appointments.length - 1 && (
                              <div className="w-[2px] h-10 bg-gray-100 mt-1"></div>
                            )}
                          </div>
                          <div className="flex-1 bg-gray-25 p-3 rounded-lg border-l-4 border-blue-500">
                            <p className="text-body-md font-semibold text-gray-700">{item.title}</p>
                            <p className="text-tiny text-gray-400 mt-1">{item.description}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-6 text-center text-gray-400 text-tiny">
                        Không có lịch hẹn nào được lên kế hoạch hôm nay.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
