import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wallet,
  AlertTriangle,
  Package,
  Info,
  Calendar,
  Receipt
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import Layout from '../../components/Layout'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface DashboardStats {
  monthlyRevenue: number
  monthlyRevenueDelta: string
  overdueDebt: number
  overdueDebtCount: number
  expiringLotsCount: number
}

interface DisbursementItem {
  id: string
  name: string
  time: string
  category: string
  amount: number
  avatar_url?: string
}

interface AppointmentItem {
  id: string
  time: string
  title: string
  description: string
}

interface ChartDataItem {
  name: string
  inflow: number
  outflow: number
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { formatCurrency } = useDisplaySettings()
  const [userRole, setUserRole] = useState<{ code: string; name: string }>({
    code: 'admin',
    name: 'Quản trị viên'
  })

  // State for data
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats>({
    monthlyRevenue: 0,
    monthlyRevenueDelta: '0% vs tháng trước',
    overdueDebt: 0,
    overdueDebtCount: 0,
    expiringLotsCount: 0
  })
  const [chartData, setChartData] = useState<ChartDataItem[]>([])
  const [disbursements, setDisbursements] = useState<DisbursementItem[]>([])
  const [appointments, setAppointments] = useState<AppointmentItem[]>([])

  // Fetch data on load
  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!profile?.id) return
      setLoading(true)
      try {
        // 1. Fetch User Role
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

        // 2. Fetch Monthly Revenue from orders
        const startOfMonth = new Date()
        startOfMonth.setDate(1)
        startOfMonth.setHours(0, 0, 0, 0)
        
        const { data: ordersData } = await supabase
          .from('orders')
          .select('grand_total')
          .neq('status', 'cancelled')
          .gte('created_at', startOfMonth.toISOString())

        let revSum = 0
        if (ordersData && ordersData.length > 0) {
          revSum = ordersData.reduce((acc, curr) => acc + Number(curr.grand_total || 0), 0)
        }

        // 2b. Fetch Last Month Revenue from orders for delta calculation
        const startOfLastMonth = new Date()
        startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1)
        startOfLastMonth.setDate(1)
        startOfLastMonth.setHours(0, 0, 0, 0)

        const endOfLastMonth = new Date()
        endOfLastMonth.setDate(1)
        endOfLastMonth.setHours(0, 0, 0, 0)
        endOfLastMonth.setMilliseconds(-1) // Last millisecond of previous month

        const { data: lastMonthOrders } = await supabase
          .from('orders')
          .select('grand_total')
          .neq('status', 'cancelled')
          .gte('created_at', startOfLastMonth.toISOString())
          .lte('created_at', endOfLastMonth.toISOString())

        let lastRevSum = 0
        if (lastMonthOrders && lastMonthOrders.length > 0) {
          lastRevSum = lastMonthOrders.reduce((acc, curr) => acc + Number(curr.grand_total || 0), 0)
        }

        let deltaStr = '0% vs tháng trước'
        if (lastRevSum > 0) {
          const diffPercent = ((revSum - lastRevSum) / lastRevSum) * 100
          const sign = diffPercent >= 0 ? '+' : ''
          deltaStr = `${sign}${diffPercent.toFixed(1)}% vs tháng trước`
        } else if (revSum > 0) {
          deltaStr = '+100% vs tháng trước'
        }

        // 3. Fetch Overdue Debts
        const todayStr = new Date().toISOString().split('T')[0]
        const { data: debtData } = await supabase
          .from('customer_debts')
          .select('amount')
          .eq('is_settled', false)
          .lt('due_date', todayStr)

        let debtSum = 0
        let debtCount = 0
        if (debtData && debtData.length > 0) {
          debtSum = debtData.reduce((acc, curr) => acc + Number(curr.amount || 0), 0)
          debtCount = debtData.length
        }

        // 4. Fetch Expiring Lots count
        const thirtyDaysFromNow = new Date()
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
        const thirtyDaysStr = thirtyDaysFromNow.toISOString().split('T')[0]

        const { data: expiringLots } = await supabase
          .from('stock_lots')
          .select('id', { count: 'exact' })
          .gt('quantity_on_hand', 0)
          .gte('expiry_date', todayStr)
          .lte('expiry_date', thirtyDaysStr)

        const expiringCount = expiringLots ? expiringLots.length : 0

        // Update stats
        setStats({
          monthlyRevenue: revSum,
          monthlyRevenueDelta: deltaStr,
          overdueDebt: debtSum,
          overdueDebtCount: debtCount,
          expiringLotsCount: expiringCount
        })

        // 4b. Fetch Cash flow data for the last 6 months
        const sixMonthsAgo = new Date()
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
        sixMonthsAgo.setDate(1)
        sixMonthsAgo.setHours(0, 0, 0, 0)

        const { data: transData } = await supabase
          .from('cashbook_transactions')
          .select('amount, flow_type, transaction_date')
          .eq('status', 'approved')
          .gte('transaction_date', sixMonthsAgo.toISOString().split('T')[0])

        const chartMonths = []
        for (let i = 5; i >= 0; i--) {
          const d = new Date()
          d.setMonth(d.getMonth() - i)
          chartMonths.push({
            name: `Tháng ${d.getMonth() + 1}`,
            year: d.getFullYear(),
            monthIndex: d.getMonth(),
            inflow: 0,
            outflow: 0
          })
        }

        if (transData) {
          transData.forEach(tx => {
            const txDate = new Date(tx.transaction_date)
            const txMonth = txDate.getMonth()
            const txYear = txDate.getFullYear()
            const match = chartMonths.find(m => m.monthIndex === txMonth && m.year === txYear)
            if (match) {
              const amt = Number(tx.amount || 0)
              if (tx.flow_type === 'inflow') {
                match.inflow += amt
              } else if (tx.flow_type === 'outflow') {
                match.outflow += amt
              }
            }
          })
        }

        const formattedChartData = chartMonths.map(m => ({
          name: m.name,
          inflow: m.inflow,
          outflow: m.outflow
        }))
        setChartData(formattedChartData)

        // 5. Fetch Pending Disbursements (outflow transactions pending approval)
        const { data: pendingTrans } = await supabase
          .from('cashbook_transactions')
          .select('id, amount, description, transaction_date, employee:profiles(full_name, avatar_url)')
          .eq('flow_type', 'outflow')
          .eq('status', 'pending_approval')
          .limit(3)

        if (pendingTrans && pendingTrans.length > 0) {
          const items: DisbursementItem[] = pendingTrans.map(t => {
            const emp = t.employee as unknown as { full_name: string; avatar_url: string } | null
            return {
              id: t.id,
              name: emp?.full_name || 'Nhân viên ẩn',
              time: new Date(t.transaction_date).toLocaleDateString('vi-VN'),
              category: t.description || 'Chi phí nghiệp vụ',
              amount: Number(t.amount),
              avatar_url: emp?.avatar_url
            }
          })
          setDisbursements(items)
        } else {
          setDisbursements([])
        }

        // 6. Fetch Today's Appointments (planned activities)
        const { data: activitiesData } = await supabase
          .from('activities')
          .select('id, title, description, due_date')
          .eq('status', 'planned')
          .gte('due_date', todayStr)
          .order('due_date', { ascending: true })
          .limit(3)

        if (activitiesData && activitiesData.length > 0) {
          const apps: AppointmentItem[] = activitiesData.map(a => ({
            id: a.id,
            time: new Date(a.due_date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            title: a.title,
            description: a.description || ''
          }))
          setAppointments(apps)
        } else {
          setAppointments([])
        }
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [profile])

  // Get dynamic greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Chào buổi sáng'
    if (hour < 18) return 'Chào buổi chiều'
    return 'Chào buổi tối'
  }

  // Format currency
  const formatVND = (num: number) => {
    return formatCurrency(num)
  }

  // Role based message / alerts
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
            <p className="text-gray-500 text-tiny mt-1">Hiện có {stats.overdueDebtCount} khách hàng trễ hạn thanh toán. Hãy kiểm tra các phiếu chi chờ duyệt để đảm bảo dòng tiền được đối soát chính xác cuối ngày.</p>
          </div>
        </div>
      )
    }
    return null
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-25 text-gray-500">
        <div className="w-10 h-10 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-4"></div>
        <p className="text-body-md">Đang tải dữ liệu tổng quan...</p>
      </div>
    )
  }

  return (
    <Layout activeMenu="Bảng điều khiển">
      <div className="p-4 md:p-10 max-w-[1600px] w-full mx-auto">
        {/* Welcome Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-h1 font-semibold text-gray-700">{getGreeting()}, {profile?.full_name || 'Quản trị viên'}</h2>
            <p className="text-body-md text-gray-400 mt-1">Đây là tóm tắt hoạt động của Sanh Long Vetco hôm nay.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
            {/* Quick POS sales button */}
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
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Role based Alerts */}
        {renderRoleAlerts()}

        {/* Metrics Summary Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          
          {/* Card 1: Doanh thu tháng */}
          <div className="bg-gray-0 border border-gray-100 rounded-lg p-6 hover:border-gray-200 transition-all">
            <div className="flex justify-between items-start mb-4">
              <span className="text-body-md font-semibold text-gray-500">Doanh thu tháng</span>
              <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-lg flex items-center justify-center">
                <Wallet size={20} strokeWidth={1.5} />
              </div>
            </div>
            <div className="text-[28px] font-bold text-gray-700 tabular-nums mb-2">
              {formatVND(stats.monthlyRevenue)}
            </div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-gray-600 text-tiny font-semibold">
              <span className="w-2 h-2 rounded-full bg-success-500"></span>
              {stats.monthlyRevenueDelta}
            </div>
          </div>

          {/* Card 2: Công nợ quá hạn */}
          <div className="bg-gray-0 border border-gray-100 rounded-lg p-6 hover:border-gray-200 transition-all">
            <div className="flex justify-between items-start mb-4">
              <span className="text-body-md font-semibold text-gray-500">Công nợ quá hạn</span>
              <div className="w-10 h-10 bg-red-50 text-danger-500 rounded-lg flex items-center justify-center">
                <AlertTriangle size={20} strokeWidth={1.5} />
              </div>
            </div>
            <div className="text-[28px] font-bold text-danger-500 tabular-nums mb-2">
              {formatVND(stats.overdueDebt)}
            </div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-gray-600 text-tiny font-semibold">
              <span className="w-2 h-2 rounded-full bg-danger-500"></span>
              {stats.overdueDebtCount} khách hàng đang trễ hạn
            </div>
          </div>

          {/* Card 3: Lô hàng sắp hết hạn */}
          <div className="bg-gray-0 border border-gray-100 rounded-lg p-6 hover:border-gray-200 transition-all">
            <div className="flex justify-between items-start mb-4">
              <span className="text-body-md font-semibold text-gray-500">Lô hàng sắp hết hạn</span>
              <div className="w-10 h-10 bg-amber-50 text-warning-500 rounded-lg flex items-center justify-center">
                <Package size={20} strokeWidth={1.5} />
              </div>
            </div>
            <div className="text-[28px] font-bold text-gray-700 tabular-nums mb-2">
              {stats.expiringLotsCount} lô
            </div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-gray-600 text-tiny font-semibold">
              <span className="w-2 h-2 rounded-full bg-warning-500"></span>
              Trong 30 ngày tới
            </div>
          </div>
        </div>

        {/* Main Dashboard Rows */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left side: Charts */}
          <div className="lg:col-span-8 flex flex-col">
            <div className="bg-gray-0 border border-gray-100 rounded-lg p-6 flex-1 flex flex-col min-h-[480px]">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-h2 font-semibold text-gray-700">Xu hướng doanh thu & Dòng tiền</h3>
                  <p className="text-tiny text-gray-400 mt-1">So sánh dòng tiền thu vào (Inflows) và chi ra (Outflows) định kỳ</p>
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

              {/* Recharts Container */}
              <div className="flex-grow w-full min-h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 20, right: 10, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E9EE" />
                    <XAxis
                      dataKey="name"
                      stroke="#A8B2BD"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#A8B2BD"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v / 1000000).toFixed(0)}tr`}
                    />
                    <Tooltip
                      cursor={{ fill: '#F4F6F8' }}
                      formatter={(value) => [formatVND(value as number), '']}
                      contentStyle={{
                        background: '#FFFFFF',
                        borderColor: '#E5E9EE',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                      }}
                    />
                    <Bar dataKey="inflow" fill="#1E5A9C" radius={[4, 4, 0, 0]} maxBarSize={32} name="Thu vào" />
                    <Bar dataKey="outflow" fill="#AEC9E9" radius={[4, 4, 0, 0]} maxBarSize={32} name="Chi ra" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Right side: Lists & Logs */}
          <div className="lg:col-span-4 space-y-8">
            
            {/* List 1: Disbursements */}
            <section className="bg-gray-0 border border-gray-100 rounded-lg p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-h2 font-semibold text-gray-700">Phiếu chi chờ duyệt</h3>
                <button className="text-blue-500 text-body-md font-semibold hover:underline">Tất cả</button>
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

            {/* List 2: Today appointments */}
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
      </div>
    </Layout>
  )
}
