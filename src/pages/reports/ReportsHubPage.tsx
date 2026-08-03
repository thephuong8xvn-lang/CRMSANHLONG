import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp, Users, ChevronRight, Info, RefreshCw, BarChart2, Package, Target, BarChart3, Activity
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

const REPORT_CARDS = [
  {
    id: 'profit',
    title: 'Báo cáo lợi nhuận',
    tag: 'Tài chính',
    tagColor: 'bg-emerald-100 text-emerald-700',
    dotColor: 'bg-emerald-500',
    icon: TrendingUp,
    iconBg: 'bg-blue-50 text-blue-600',
    route: '/reports/profit',
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
  },
  {
    id: 'inventory-valuation',
    title: 'Báo cáo Kho hàng theo Giá vốn',
    tag: 'Kho hàng',
    tagColor: 'bg-amber-100 text-amber-700',
    dotColor: 'bg-amber-500',
    icon: Package,
    iconBg: 'bg-amber-50 text-amber-600',
    route: '/reports/inventory-valuation',
  },
  {
    id: 'strategic-products',
    title: 'Sản phẩm chiến lược & Tối ưu lợi nhuận',
    tag: 'Chiến lược',
    tagColor: 'bg-purple-100 text-purple-700',
    dotColor: 'bg-purple-500',
    icon: Target,
    iconBg: 'bg-purple-50 text-purple-600',
    route: '/reports/strategic-products',
  },
  {
    id: 'bi',
    title: 'Phân tích BI tương tác',
    tag: 'BI',
    tagColor: 'bg-sky-100 text-sky-700',
    dotColor: 'bg-sky-500',
    icon: BarChart3,
    iconBg: 'bg-sky-50 text-sky-600',
    route: '/reports/bi',
  },
  {
    id: 'demand-forecast',
    title: 'Dự báo nhu cầu',
    tag: 'Dự báo',
    tagColor: 'bg-cyan-100 text-cyan-700',
    dotColor: 'bg-cyan-500',
    icon: Activity,
    iconBg: 'bg-cyan-50 text-cyan-600',
    route: '/reports/demand-forecast',
  },
]

export default function ReportsHubPage() {
  const { formatCurrency } = useDisplaySettings()
  const [period, setPeriod] = useState<'today' | 'month' | 'year'>('month')
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [kpi, setKpi] = useState<{ revenue: number; profit: number; margin: number } | null>(null)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      let from: string
      if (period === 'today') from = ymd(now)
      else if (period === 'month') from = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
      else from = ymd(new Date(now.getFullYear(), 0, 1))

      // Offset +07:00 để ranh giới ngày theo giờ VN (chuỗi trần bị hiểu là UTC
      // → "Hôm nay" rụng hết đơn bán trước 07:00 sáng).
      const { data } = await supabase.rpc('fn_profit_summary', {
        p_from: from + 'T00:00:00+07:00',
        p_to: ymd(now) + 'T23:59:59+07:00',
      })
      const row = data?.[0]
      // Dùng số THUẦN (đã trừ CK cấp hóa đơn + hàng trả) để khớp trang /reports/profit.
      setKpi(row ? {
        revenue: Number(row.total_revenue_net),
        profit: Number(row.total_profit_net),
        margin: Number(row.profit_margin_net),
      } : { revenue: 0, profit: 0, margin: 0 })
      setLastUpdated(new Date())
    } catch {
      setKpi({ revenue: 0, profit: 0, margin: 0 })
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { loadSummary() }, [loadSummary])

  const periodLabel = period === 'today' ? 'Hôm nay' : period === 'month' ? 'Tháng này' : 'Năm nay'

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
            <p className="text-gray-500 text-body-md mt-1">Phân tích lợi nhuận, chân dung khách hàng và giá trị vốn tồn kho.</p>
          </div>
          <div className="flex bg-gray-100 p-1 rounded-lg self-start md:self-auto">
            {(['today', 'month', 'year'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-md text-tiny font-semibold transition-all ${
                  period === p ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p === 'today' ? 'Hôm nay' : p === 'month' ? 'Tháng này' : 'Năm nay'}
              </button>
            ))}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { label: `Doanh thu — ${periodLabel}`, value: kpi ? formatCurrency(kpi.revenue) : '…' },
            { label: `Lợi nhuận gộp — ${periodLabel}`, value: kpi ? formatCurrency(kpi.profit) : '…' },
            { label: `Biên lợi nhuận — ${periodLabel}`, value: kpi ? `${kpi.margin.toLocaleString('vi-VN')}%` : '…' },
          ].map((k, i) => (
            <div key={i} className="bg-white border border-gray-150 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-blue-500">
                <BarChart2 size={16} />
                <span className="text-tiny text-gray-400 font-medium">{k.label}</span>
              </div>
              <p className="text-2xl font-bold text-gray-800 tabular-nums">{loading ? '…' : k.value}</p>
            </div>
          ))}
        </div>

        {/* Report links — chỉ tiêu đề, cả dòng là hyperlink */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {REPORT_CARDS.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.id}
                to={card.route}
                className="group bg-white border border-gray-150 rounded-xl px-4 py-3.5 flex items-center gap-3 transition-all duration-200 hover:border-blue-400 hover:shadow-md"
              >
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${card.iconBg}`}>
                  <Icon size={18} />
                </span>
                <span className="flex-1 min-w-0 text-body-lg font-semibold text-gray-800 group-hover:text-blue-700 truncate">
                  {card.title}
                </span>
                <span className={`hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border shrink-0 ${card.tagColor} border-current/20`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${card.dotColor}`} />
                  {card.tag}
                </span>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-500 shrink-0" />
              </Link>
            )
          })}
        </div>

        {/* Banner */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-body-md text-gray-600">
              Khu vực báo cáo chỉ dành cho quản trị viên. Cập nhật lần cuối lúc{' '}
              <span className="font-bold text-gray-800">
                {lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </span>.
            </p>
          </div>
          <button onClick={loadSummary} className="shrink-0 flex items-center gap-1.5 text-blue-600 font-bold text-tiny hover:underline transition-all">
            <RefreshCw size={14} />
            Cập nhật ngay
          </button>
        </div>
      </div>
    </Layout>
  )
}
