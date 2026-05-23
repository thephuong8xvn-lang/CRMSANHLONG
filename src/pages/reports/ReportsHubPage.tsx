import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  CreditCard,
  Package,
  Tag,
  Users,
  UserCheck,
  BarChart2,
  ChevronRight,
  Download,
  RefreshCw,
  Info,
  Calendar
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

interface SummaryRow {
  label: string
  value: number
  status: 'done' | 'pending' | 'warning'
}

const REPORT_CARDS = [
  {
    id: 'revenue',
    title: 'Doanh thu theo thời gian',
    tag: 'Tài chính',
    tagColor: 'bg-emerald-100 text-emerald-700',
    dotColor: 'bg-emerald-500',
    icon: TrendingUp,
    iconBg: 'bg-blue-50 text-blue-600',
    route: '/reports/revenue',
    features: [
      'Doanh thu theo ngày/tháng/quý',
      'So sánh cùng kỳ',
      'Tăng trưởng doanh số',
    ],
    featureWarning: [],
    available: true,
  },
  {
    id: 'debt',
    title: 'Công nợ phải thu',
    tag: 'Kế toán',
    tagColor: 'bg-orange-100 text-orange-700',
    dotColor: 'bg-orange-500',
    icon: CreditCard,
    iconBg: 'bg-gray-100 text-blue-600',
    route: '/reports/debt',
    features: [
      'Phân tích tuổi nợ',
      'Nợ quá hạn theo khách hàng',
      'Dự báo thu hồi nợ',
    ],
    featureWarning: [],
    available: true,
  },
  {
    id: 'inventory',
    title: 'Nhập xuất tồn kho',
    tag: 'Kho hàng',
    tagColor: 'bg-red-100 text-red-700',
    dotColor: 'bg-red-500',
    icon: Package,
    iconBg: 'bg-emerald-100 text-emerald-700',
    route: '/reports/inventory',
    features: [
      'Giá trị kho hiện tại',
      'Tỷ lệ quay vòng kho',
    ],
    featureWarning: ['Cảnh báo hàng sắp hết hạn'],
    available: true,
  },
  {
    id: 'promotion',
    title: 'ROI khuyến mãi',
    tag: 'Marketing',
    tagColor: 'bg-emerald-100 text-emerald-700',
    dotColor: 'bg-emerald-500',
    icon: Tag,
    iconBg: 'bg-blue-50 text-blue-600',
    route: '',
    features: [
      'Hiệu quả chương trình ưu đãi',
      'Chi phí marketing trên đơn hàng',
      'Tỷ lệ chuyển đổi voucher',
    ],
    featureWarning: [],
    available: false,
  },
  {
    id: 'customer-profile',
    title: 'Phân tích Chân dung Khách hàng',
    tag: 'Khách hàng',
    tagColor: 'bg-indigo-100 text-indigo-700',
    dotColor: 'bg-indigo-500',
    icon: Users,
    iconBg: 'bg-indigo-50 text-indigo-600',
    route: '/reports/customer-profile',
    features: [
      'Cơ cấu vòng đời & nhóm giá',
      'Phân bố quy mô & loài vật nuôi',
      'Bản đồ chi tiêu & nợ quá hạn',
    ],
    featureWarning: [],
    available: true,
  },
  {
    id: 'staff',
    title: 'Hiệu suất nhân viên',
    tag: 'Nhân sự',
    tagColor: 'bg-blue-100 text-blue-700',
    dotColor: 'bg-blue-500',
    icon: UserCheck,
    iconBg: 'bg-blue-50 text-blue-600',
    route: '/reports/staff',
    features: [
      'Doanh số theo nhân viên',
      'Tỷ lệ chốt hợp đồng',
      'KPI chăm sóc khách hàng',
    ],
    featureWarning: [],
    available: true,
  },
]

export default function ReportsHubPage() {
  const navigate = useNavigate()
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([])
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month')

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)


  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      // Calculate period range inline
      const now = new Date()
      let start: Date
      if (period === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1)
      } else if (period === 'quarter') {
        const q = Math.floor(now.getMonth() / 3)
        start = new Date(now.getFullYear(), q * 3, 1)
      } else {
        start = new Date(now.getFullYear(), 0, 1)
      }
      const startStr = start.toISOString()
      const endStr = now.toISOString()

      // Revenue this period
      const { data: revenueData } = await supabase
        .from('orders')
        .select('grand_total')
        .in('status', ['confirmed', 'shipping', 'delivered', 'paid', 'completed'])
        .gte('created_at', startStr)
        .lte('created_at', endStr)

      const totalRevenue = revenueData?.reduce((sum, o) => sum + Number(o.grand_total), 0) ?? 0

      // Outstanding debts
      const { data: debtData } = await supabase
        .from('customer_debts')
        .select('remaining_amount')
        .gt('remaining_amount', 0)

      const totalDebt = debtData?.reduce((sum, d) => sum + Number(d.remaining_amount), 0) ?? 0

      setSummaryRows([
        {
          label: period === 'month' ? 'Doanh thu tháng này' : period === 'quarter' ? 'Doanh thu quý này' : 'Doanh thu năm nay',
          value: totalRevenue,
          status: 'done'
        },
        {
          label: 'Công nợ tồn đọng',
          value: totalDebt,
          status: totalDebt > 0 ? 'pending' : 'done'
        },
      ])
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Error loading reports summary:', err)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const periodLabel = period === 'month' ? 'Tháng này' : period === 'quarter' ? 'Quý này' : 'Năm nay'

  return (
    <Layout activeMenu="Báo cáo">
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto flex flex-col space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <nav className="flex items-center gap-2 text-label-md text-gray-400 mb-2">
              <span>Hệ thống</span>
              <ChevronRight size={12} />
              <span className="text-blue-600 font-semibold">Trung tâm Báo cáo</span>
            </nav>
            <h1 className="text-[32px] font-bold text-gray-800 leading-tight">Trung tâm Báo cáo</h1>
            <p className="text-gray-500 text-body-md mt-1">Phân tích dữ liệu vận hành và dự báo kinh doanh thông minh.</p>
          </div>

          <div className="flex gap-3 self-start md:self-auto">
            {/* Period selector */}
            <div className="flex bg-gray-100 p-1 rounded-lg">
              {(['month', 'quarter', 'year'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-md text-tiny font-semibold transition-all ${
                    period === p ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {p === 'month' ? 'Tháng này' : p === 'quarter' ? 'Quý này' : 'Năm nay'}
                </button>
              ))}
            </div>
            <button className="h-10 px-4 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny flex items-center gap-2 hover:bg-[#143C69] active:scale-95 transition-all shadow-sm">
              <Download size={16} />
              Xuất tất cả
            </button>
          </div>
        </div>

        {/* 6 Report Cards - 3x2 grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {REPORT_CARDS.map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.id}
                className={`bg-white border border-gray-150 rounded-xl p-6 flex flex-col h-full transition-all duration-200 ${
                  card.available
                    ? 'hover:border-blue-400 hover:shadow-md cursor-default'
                    : 'opacity-60 cursor-not-allowed'
                }`}
              >
                {/* Card header */}
                <div className="flex justify-between items-start mb-5">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${card.iconBg}`}>
                    <Icon size={24} />
                  </div>
                  <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border ${card.tagColor} border-current/20`}>
                    <span className={`w-2 h-2 rounded-full ${card.dotColor}`} />
                    {card.tag}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-[17px] font-bold text-gray-800 mb-4">{card.title}</h3>

                {/* Features list */}
                <ul className="space-y-2.5 flex-1 mb-6">
                  {card.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-body-md text-gray-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                  {card.featureWarning.map((f, i) => (
                    <li key={`w-${i}`} className="flex items-center gap-2.5 text-body-md text-gray-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA Button */}
                {card.available ? (
                  <button
                    onClick={() => navigate(card.route)}
                    className="h-10 w-full bg-[#1E5A9C] text-white rounded-lg font-semibold text-body-md hover:bg-[#143C69] active:scale-95 transition-all shadow-sm"
                  >
                    Xem báo cáo
                  </button>
                ) : (
                  <button
                    disabled
                    className="h-10 w-full bg-gray-100 text-gray-400 rounded-lg font-semibold text-body-md cursor-not-allowed"
                  >
                    Sắp ra mắt (Phase 2)
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Summary Table */}
        <div className="bg-white rounded-xl border border-gray-150 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 size={18} className="text-blue-500" />
              <h3 className="text-body-lg font-bold text-gray-700">Tóm tắt số liệu — {periodLabel}</h3>
            </div>
            <span className="flex items-center gap-1.5 text-tiny text-gray-400">
              <Calendar size={13} />
              {period === 'month' ? new Date().toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }) : periodLabel}
            </span>
          </div>
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Tên Báo Cáo</th>
                <th className="px-6 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider text-right">Giá Trị Tổng</th>
                <th className="px-6 py-3 text-tiny text-gray-400 font-bold uppercase tracking-wider">Trạng Thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center">
                    <div className="flex items-center justify-center gap-2 text-gray-400 text-tiny">
                      <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                      Đang tải dữ liệu...
                    </div>
                  </td>
                </tr>
              ) : summaryRows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-25 transition-colors">
                  <td className="px-6 py-4 text-body-md font-semibold text-gray-800">{row.label}</td>
                  <td className="px-6 py-4 text-body-md text-right font-bold tabular-nums text-[#143C69]">
                    {formatCurrency(row.value)}
                  </td>
                  <td className="px-6 py-4">
                    {row.status === 'done' && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-tiny font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Đã hoàn thành
                      </span>
                    )}
                    {row.status === 'pending' && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-tiny font-bold bg-amber-50 text-amber-700 border border-amber-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Đang chờ xử lý
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* System Status Banner */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-body-md text-gray-600">
              Dữ liệu báo cáo được cập nhật lần cuối vào{' '}
              <span className="font-bold text-gray-800">
                {lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}, Hôm nay
              </span>
              . Hệ thống đồng bộ hóa tự động mỗi 15 phút.
            </p>
          </div>
          <button
            onClick={loadSummary}
            className="shrink-0 flex items-center gap-1.5 text-blue-600 font-bold text-tiny hover:underline transition-all"
          >
            <RefreshCw size={14} />
            Cập nhật ngay
          </button>
        </div>

      </div>
    </Layout>
  )
}
