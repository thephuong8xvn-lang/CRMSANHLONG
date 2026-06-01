import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wallet,
  AlertTriangle,
  Package,
  Calendar,
  Receipt,
  Building2,
  ClipboardList,
  ArrowRight,
  UserX,
  Clock,
  CalendarClock,
  TrendingUp,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import Layout from '../../components/Layout'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useDashboardStats } from '../../hooks/queries/useDashboardStats'
import { usePendingDisbursements, useTodayAppointments, useAtRiskRegulars, useUpcomingDebts } from '../../hooks/queries/useDashboardLists'
import { useBranches } from '../../hooks/queries/useBranches'
import { useUpcomingHerdTasks } from '../../hooks/queries/useHerdProjects'
import { useExpiringLots, useExpiryBuckets, useReorderSuggestions, bucketForDays, DEFAULT_EXPIRY_COLORS } from '../../hooks/queries/useInventoryInsights'
import { lunarLabel } from '../../lib/lunarDate'

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
  const herdTasksQuery = useUpcomingHerdTasks(7, !!profile?.id)
  const canViewCustomers = hasPermission('customers.view_own') || hasPermission('customers.view_team') || hasPermission('customers.view_all')
  const atRiskQuery = useAtRiskRegulars(10, !!profile?.id && canViewCustomers)
  const upcomingDebtsQuery = useUpcomingDebts(10, 10, !!profile?.id && canViewCustomers)
  const canViewInventory = hasPermission('inventory.view')
  const expiringQuery = useExpiringLots(90, !!profile?.id && canViewInventory)
  const expiryColorsQuery = useExpiryBuckets()
  const reorderQuery = useReorderSuggestions({ coverDays: 30, minOrders: 3 }, !!profile?.id && canViewInventory)

  const stats = statsQuery.data
  const chartData = stats?.cashflow_6m ?? []
  const disbursements = disbursQuery.data ?? []
  const appointments  = apptQuery.data ?? []
  const loading = statsQuery.isLoading
  const isError = statsQuery.isError

  const formatVND = (num: number) => formatCurrency(num)
  const herdTasks = herdTasksQuery.data ?? []
  const urgentHerdCount = herdTasks.filter(t => t.days_left <= 3).length
  const taskDayLabel = (d: number) => d < 0 ? `Quá hạn ${Math.abs(d)}n` : d === 0 ? 'Hôm nay' : d === 1 ? 'Ngày mai' : `Còn ${d}n`
  const atRisk = atRiskQuery.data ?? []
  const upcomingDebts = upcomingDebtsQuery.data ?? []
  const debtDayLabel = (d: number) => d < 0 ? `Quá hạn ${Math.abs(d)}n` : d === 0 ? 'Hôm nay' : `Còn ${d}n`
  const expiringLots = expiringQuery.data ?? []
  const expiryColors = expiryColorsQuery.data ?? DEFAULT_EXPIRY_COLORS
  const reorderCount = (reorderQuery.data ?? []).filter(r => r.days_cover != null && r.days_cover <= 14).length

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
        {/* Welcome Header — gộp gọn 1 hàng: lời chào + chi nhánh + POS + ngày (kèm âm lịch) */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-h2 font-semibold text-gray-700">{getGreeting()}, {profile?.full_name || 'Quản trị viên'}</h2>
            {isAdmin ? (
              <select
                value={selectedBranchId ?? ''}
                onChange={(e) => setSelectedBranchId(e.target.value || null)}
                className="h-9 px-3 rounded-lg border border-gray-200 bg-gray-0 text-tiny font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                title="Phạm vi dữ liệu"
              >
                <option value="">Tất cả chi nhánh</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : (
              <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-tiny font-semibold">
                <Building2 size={14} />{currentBranchName ?? 'Chưa gán chi nhánh'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <button
              onClick={() => navigate('/orders/pos')}
              className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white px-4 h-10 rounded-lg font-bold text-tiny active:scale-95 transition-all flex items-center gap-1.5 shadow-md"
            >
              <Receipt size={16} strokeWidth={2} />
              <span>Bán hàng POS</span>
            </button>
            <div className="bg-gray-0 border border-gray-100 rounded-lg px-3 h-10 flex items-center gap-2">
              <Calendar size={15} className="text-blue-500" />
              <span className="text-tiny font-semibold tabular-nums text-gray-700">
                {new Date().toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>
              <span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">{lunarLabel()}</span>
            </div>
          </div>
        </div>

        {/* ── Dải Công việc chăn nuôi 7 ngày — trên cùng, trực quan, cho mọi user ── */}
        {herdTasksQuery.isLoading ? (
          <div className="mb-8 bg-gray-0 border border-gray-100 rounded-lg p-5 animate-pulse">
            <div className="h-4 w-56 bg-gray-100 rounded mb-4" />
            <div className="flex gap-3 overflow-hidden">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-20 w-56 bg-gray-50 rounded-lg flex-shrink-0" />)}
            </div>
          </div>
        ) : herdTasks.length > 0 ? (
          <div className="mb-8 bg-gray-0 border border-gray-100 rounded-lg shadow-sm overflow-hidden">
            <div className="flex justify-between items-center px-5 py-3.5 border-b border-gray-100">
              <h3 className="text-h2 font-semibold text-gray-700 flex items-center gap-2">
                <ClipboardList size={20} className="text-blue-500" /> Công việc chăn nuôi 7 ngày
                {urgentHerdCount > 0 && (
                  <span className="text-tiny font-bold px-2 py-0.5 rounded-full bg-red-50 text-danger-600 border border-red-100">
                    {urgentHerdCount} việc gấp
                  </span>
                )}
              </h3>
              <button
                onClick={() => navigate('/herd-projects')}
                className="text-blue-500 text-body-md font-semibold hover:underline flex-shrink-0"
              >
                Tất cả
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase text-[10px] font-bold tracking-wider whitespace-nowrap">
                    <th className="py-2.5 px-5">Công việc</th>
                    <th className="py-2.5 px-3">Dự án</th>
                    <th className="py-2.5 px-3">Khách hàng</th>
                    <th className="py-2.5 px-3">Người phụ trách</th>
                    <th className="py-2.5 px-3 text-right">Hạn</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {herdTasks.slice(0, 10).map((t) => {
                    const urgent = t.days_left <= 3
                    return (
                      <tr
                        key={t.step_id}
                        onClick={() => navigate(`/herd-projects/${t.project_id}`)}
                        className="hover:bg-blue-50/30 cursor-pointer transition-colors group"
                      >
                        <td className="py-3 px-5">
                          <span className={`font-bold ${urgent ? 'text-danger-600' : 'text-blue-700'}`}>{t.step_name}</span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-gray-700 line-clamp-1">{t.project_name}</div>
                          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{t.project_code}</div>
                        </td>
                        <td className="py-3 px-3 text-gray-600 max-w-[160px] truncate">{t.customer_name || 'Khách lẻ'}</td>
                        <td className="py-3 px-3 text-gray-600 max-w-[140px] truncate">{t.assigned_name || '—'}</td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${urgent ? 'bg-red-50 text-danger-600 border-red-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                            {taskDayLabel(t.days_left)}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right"><ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500" /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ── 2 khối điều hành: Khách quen chưa mua lại + Công nợ sắp đến hạn ── */}
        {canViewCustomers && (atRisk.length > 0 || upcomingDebts.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Khách quen chưa mua lại */}
            {atRisk.length > 0 && (
              <section className="bg-gray-0 border border-gray-100 rounded-lg shadow-sm overflow-hidden">
                <div className="flex justify-between items-center px-5 py-3.5 border-b border-gray-100">
                  <h3 className="text-h2 font-semibold text-gray-700 flex items-center gap-2">
                    <UserX size={18} className="text-amber-500" /> Khách quen chưa mua lại
                  </h3>
                  <button onClick={() => navigate('/reports/customer-profile')} className="text-blue-500 text-body-md font-semibold hover:underline flex-shrink-0">Xem tất cả</button>
                </div>
                <div className="divide-y divide-gray-100">
                  {atRisk.map((c) => (
                    <button key={c.id} onClick={() => navigate(`/customers/${c.id}`)}
                      className="w-full text-left flex items-center justify-between gap-2 px-5 py-3 hover:bg-gray-25 transition-colors">
                      <div className="min-w-0">
                        <p className="text-body-md font-semibold text-gray-700 truncate">{c.farm_name}</p>
                        <p className="text-tiny text-gray-400 truncate">{c.code || ''}{c.code ? ' · ' : ''}{c.orders_count} đơn · mua cuối {c.daysSince} ngày trước</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {c.total_debt > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-danger-600 border border-red-100">Nợ {formatVND(c.total_debt)}</span>
                        )}
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 whitespace-nowrap">{c.daysSince} ngày</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Công nợ sắp đến hạn (10 ngày) */}
            {upcomingDebts.length > 0 && (
              <section className="bg-gray-0 border border-gray-100 rounded-lg shadow-sm overflow-hidden">
                <div className="flex justify-between items-center px-5 py-3.5 border-b border-gray-100">
                  <h3 className="text-h2 font-semibold text-gray-700 flex items-center gap-2">
                    <Clock size={18} className="text-danger-500" /> Công nợ sắp đến hạn (10 ngày)
                  </h3>
                  {hasPermission('reports.debt') && (
                    <button onClick={() => navigate('/reports/debt')} className="text-blue-500 text-body-md font-semibold hover:underline flex-shrink-0">Báo cáo</button>
                  )}
                </div>
                <div className="divide-y divide-gray-100">
                  {upcomingDebts.map((d) => {
                    const urgent = d.daysLeft <= 3
                    return (
                      <button key={d.id} onClick={() => navigate(`/customers/${d.customer_id}`)}
                        className="w-full text-left flex items-center justify-between gap-2 px-5 py-3 hover:bg-gray-25 transition-colors">
                        <div className="min-w-0">
                          <p className="text-body-md font-semibold text-gray-700 truncate">{d.farm_name}</p>
                          <p className={`text-tiny font-bold tabular-nums ${urgent ? 'text-danger-600' : 'text-blue-600'}`}>{formatVND(d.amount)}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 whitespace-nowrap ${urgent ? 'bg-red-50 text-danger-600 border-red-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                          {debtDayLabel(d.daysLeft)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── Hàng sắp hết hạn (3 tháng) + alert gợi ý đặt hàng ── */}
        {canViewInventory && (expiringLots.length > 0 || reorderCount > 0) && (
          <div className="mb-8 space-y-3">
            {reorderCount > 0 && (
              <button onClick={() => navigate('/inventory/reorder')}
                className="w-full flex items-center justify-between gap-2 px-5 py-3 bg-blue-50/60 border border-blue-100 rounded-lg hover:bg-blue-50 transition-colors">
                <span className="flex items-center gap-2 text-body-md font-semibold text-blue-700">
                  <TrendingUp size={18} /> {reorderCount} mặt hàng bán chạy sắp hết — nên đặt thêm
                </span>
                <ArrowRight size={16} className="text-blue-500" />
              </button>
            )}
            {expiringLots.length > 0 && (
              <div className="bg-gray-0 border border-gray-100 rounded-lg shadow-sm overflow-hidden">
                <div className="flex justify-between items-center px-5 py-3.5 border-b border-gray-100">
                  <h3 className="text-h2 font-semibold text-gray-700 flex items-center gap-2">
                    <CalendarClock size={20} className="text-amber-500" /> Hàng sắp hết hạn (3 tháng)
                    <span className="text-tiny font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">{expiringLots.length} lô</span>
                  </h3>
                  <button onClick={() => navigate('/inventory/expiry')} className="text-blue-500 text-body-md font-semibold hover:underline flex-shrink-0">Tất cả</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase text-[10px] font-bold tracking-wider whitespace-nowrap">
                        <th className="py-2.5 px-5">Sản phẩm</th>
                        <th className="py-2.5 px-3">Kho</th>
                        <th className="py-2.5 px-3">Lô</th>
                        <th className="py-2.5 px-3 text-right">SL tồn</th>
                        <th className="py-2.5 px-3 text-center">Còn lại</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {expiringLots.slice(0, 8).map((l) => {
                        const c = expiryColors[bucketForDays(l.daysLeft).key] || '#64748b'
                        return (
                          <tr key={l.lot_id} onClick={() => navigate('/inventory/expiry')} className="hover:bg-gray-25 cursor-pointer transition-colors">
                            <td className="py-3 px-5">
                              <div className="font-semibold text-gray-700 truncate max-w-[260px]">{l.product_name}</div>
                              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{l.sku}</div>
                            </td>
                            <td className="py-3 px-3 text-gray-600 max-w-[120px] truncate">{l.warehouse_name}</td>
                            <td className="py-3 px-3 text-gray-600">{l.lot_number}</td>
                            <td className="py-3 px-3 text-right tabular-nums font-semibold text-gray-700">{l.qty.toLocaleString('vi-VN')} {l.unit}</td>
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border" style={{ color: c, borderColor: c + '55', backgroundColor: c + '14' }}>
                                {l.daysLeft < 0 ? `Hết hạn ${Math.abs(l.daysLeft)}n` : l.daysLeft === 0 ? 'Hôm nay' : `Còn ${l.daysLeft} ngày`}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

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
