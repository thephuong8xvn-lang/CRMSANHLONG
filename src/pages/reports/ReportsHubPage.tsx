import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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
    features: [
      'Lợi nhuận theo khách hàng / sản phẩm / thương hiệu',
      'Top 100 tỉ lệ LN · doanh số · nhiều khách mua',
      'Lọc theo hôm nay / tháng / năm / tùy chọn',
    ],
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
    features: [
      'Giá trị vốn tồn theo SP / thương hiệu / nhóm hàng / kho',
      'Top 50 tồn nhiều · vòng quay · hàng tồn lâu',
      'Cảnh báo thiếu giá vốn & hàng sắp hết hạn',
    ],
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
    features: [
      'Nhóm 1 markup ≥50% (mục tiêu ≥30% doanh số) · nhóm 2 hàng nền',
      'Theo dõi LIVE hôm nay · cảnh báo 7 loại · GMROI · bù chéo',
      'Mục tiêu doanh số tháng theo chi nhánh + gợi ý phân loại',
    ],
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
    features: [
      'Pivot đa chiều (thời gian/SP/KH/CN/NV) + so sánh kỳ YoY/MoM',
      'Phân loại ABC/XYZ sản phẩm (80/20 × ổn định cầu)',
      'Cohort giữ chân khách hàng theo tháng',
    ],
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
    features: [
      'Dự báo cầu theo SKU (làm mượt SES / Croston cầu cách quãng)',
      'Độ tin cậy theo lịch sử + dải bất định + MAPE',
      'Gợi ý đặt theo dự báo kỳ tới (4/8/12 tuần)',
    ],
  },
]

export default function ReportsHubPage() {
  const navigate = useNavigate()
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

      const { data } = await supabase.rpc('fn_profit_summary', {
        p_from: from + 'T00:00:00',
        p_to: ymd(now) + 'T23:59:59',
      })
      const row = data?.[0]
      setKpi(row ? {
        revenue: Number(row.total_revenue),
        profit: Number(row.total_profit),
        margin: Number(row.profit_margin),
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

        {/* Report cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {REPORT_CARDS.map((card) => {
            const Icon = card.icon
            return (
              <div key={card.id} className="bg-white border border-gray-150 rounded-xl p-6 flex flex-col h-full transition-all duration-200 hover:border-blue-400 hover:shadow-md">
                <div className="flex justify-between items-start mb-5">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${card.iconBg}`}>
                    <Icon size={24} />
                  </div>
                  <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border ${card.tagColor} border-current/20`}>
                    <span className={`w-2 h-2 rounded-full ${card.dotColor}`} />
                    {card.tag}
                  </span>
                </div>
                <h3 className="text-[17px] font-bold text-gray-800 mb-4">{card.title}</h3>
                <ul className="space-y-2.5 flex-1 mb-6">
                  {card.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-body-md text-gray-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => navigate(card.route)}
                  className="h-10 w-full bg-[#1E5A9C] text-white rounded-lg font-semibold text-body-md hover:bg-[#143C69] active:scale-95 transition-all shadow-sm"
                >
                  Xem báo cáo
                </button>
              </div>
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
