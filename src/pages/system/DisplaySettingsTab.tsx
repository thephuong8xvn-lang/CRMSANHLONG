import React, { useState, useEffect } from 'react'
import {
  Coins,
  Calendar,
  Type,
  Layout as LayoutIcon,
  SlidersHorizontal,
  Globe,
  Shield,
  Eye,
  Check,
  RefreshCw,
  Sparkles,
  Info
} from 'lucide-react'
import { useDisplaySettings, DisplaySettings } from '../../contexts/DisplaySettingsContext'

export default function DisplaySettingsTab() {
  const { settings, updateSettings, loading, refreshSettings } = useDisplaySettings()
  
  // Local state initialized from global settings
  const [currencySymbol, setCurrencySymbol] = useState(settings.currency_symbol)
  const [currencyPosition, setCurrencyPosition] = useState(settings.currency_position)
  const [thousandsSeparator, setThousandsSeparator] = useState(settings.thousands_separator)
  const [decimalSeparator, setDecimalSeparator] = useState(settings.decimal_separator)
  const [decimalPlacesCurrency, setDecimalPlacesCurrency] = useState(settings.decimal_places_currency)
  const [decimalPlacesQuantity, setDecimalPlacesQuantity] = useState(settings.decimal_places_quantity)
  const [decimalPlacesPercent, setDecimalPlacesPercent] = useState(settings.decimal_places_percent)
  const [enableCompactNumbers, setEnableCompactNumbers] = useState(settings.enable_compact_numbers)

  const [dateFormat, setDateFormat] = useState(settings.date_format)
  const [timeFormat, setTimeFormat] = useState(settings.time_format)
  const [datetimeFormat, setDatetimeFormat] = useState(settings.datetime_format)
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(settings.first_day_of_week)
  const [cycleTimeUnit, setCycleTimeUnit] = useState(settings.cycle_time_unit)

  const [phoneFormat, setPhoneFormat] = useState(settings.phone_format)
  const [idPrefixOpportunity, setIdPrefixOpportunity] = useState(settings.id_prefix_opportunity)
  const [idPrefixInvoice, setIdPrefixInvoice] = useState(settings.id_prefix_invoice)
  const [idPrefixCustomer, setIdPrefixCustomer] = useState(settings.id_prefix_customer)
  const [idPrefixLot, setIdPrefixLot] = useState(settings.id_prefix_lot)
  const [textTruncationLimit, setTextTruncationLimit] = useState(settings.text_truncation_limit)
  const [emptyStateFormat, setEmptyStateFormat] = useState(settings.empty_state_format)

  const [defaultLayoutView, setDefaultLayoutView] = useState(settings.default_layout_view)
  const [showCancelReasonCond, setShowCancelReasonCond] = useState(
    settings.field_visibility_config?.show_cancel_reason_on_cancelled ?? true
  )

  const [defaultChartType, setDefaultChartType] = useState(settings.default_chart_type)
  const [tempThresholdMin, setTempThresholdMin] = useState(String(settings.gauge_thresholds?.temperature?.min ?? 20))
  const [tempThresholdMax, setTempThresholdMax] = useState(String(settings.gauge_thresholds?.temperature?.max ?? 35))

  const [systemLanguage, setSystemLanguage] = useState(settings.system_language)
  const [systemTimezone, setSystemTimezone] = useState(settings.system_timezone)
  const [unitWeight, setUnitWeight] = useState(settings.default_units_weight)
  const [unitVolume, setUnitVolume] = useState(settings.default_units_volume)
  const [unitArea, setUnitArea] = useState(settings.default_units_area)
  const [unitCount, setUnitCount] = useState(settings.default_units_count)

  const [enablePartialMasking, setEnablePartialMasking] = useState(settings.enable_partial_masking)
  const [salesHideCost, setSalesHideCost] = useState(
    !(settings.field_level_security_rules?.sales?.cost_price ?? true)
  )
  const [salesHideProfit, setSalesHideProfit] = useState(
    !(settings.field_level_security_rules?.sales?.gross_profit ?? true)
  )

  // Sub-tabs navigation state
  const [subTab, setSubTab] = useState<'numeric' | 'datetime' | 'text' | 'ui' | 'visual' | 'localization' | 'security'>('numeric')
  const [saving, setSaving] = useState(false)
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Sync state if context loads late
  useEffect(() => {
    setCurrencySymbol(settings.currency_symbol)
    setCurrencyPosition(settings.currency_position)
    setThousandsSeparator(settings.thousands_separator)
    setDecimalSeparator(settings.decimal_separator)
    setDecimalPlacesCurrency(settings.decimal_places_currency)
    setDecimalPlacesQuantity(settings.decimal_places_quantity)
    setDecimalPlacesPercent(settings.decimal_places_percent)
    setEnableCompactNumbers(settings.enable_compact_numbers)
    setDateFormat(settings.date_format)
    setTimeFormat(settings.time_format)
    setDatetimeFormat(settings.datetime_format)
    setFirstDayOfWeek(settings.first_day_of_week)
    setCycleTimeUnit(settings.cycle_time_unit)
    setPhoneFormat(settings.phone_format)
    setIdPrefixOpportunity(settings.id_prefix_opportunity)
    setIdPrefixInvoice(settings.id_prefix_invoice)
    setIdPrefixCustomer(settings.id_prefix_customer)
    setIdPrefixLot(settings.id_prefix_lot)
    setTextTruncationLimit(settings.text_truncation_limit)
    setEmptyStateFormat(settings.empty_state_format)
    setDefaultLayoutView(settings.default_layout_view)
    setShowCancelReasonCond(settings.field_visibility_config?.show_cancel_reason_on_cancelled ?? true)
    setDefaultChartType(settings.default_chart_type)
    setTempThresholdMin(String(settings.gauge_thresholds?.temperature?.min ?? 20))
    setTempThresholdMax(String(settings.gauge_thresholds?.temperature?.max ?? 35))
    setSystemLanguage(settings.system_language)
    setSystemTimezone(settings.system_timezone)
    setUnitWeight(settings.default_units_weight)
    setUnitVolume(settings.default_units_volume)
    setUnitArea(settings.default_units_area)
    setUnitCount(settings.default_units_count)
    setEnablePartialMasking(settings.enable_partial_masking)
    setSalesHideCost(!(settings.field_level_security_rules?.sales?.cost_price ?? true))
    setSalesHideProfit(!(settings.field_level_security_rules?.sales?.gross_profit ?? true))
  }, [settings])

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text })
    setTimeout(() => setToastMsg(null), 3000)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    
    // Construct nested objects
    const field_visibility_config = {
      ...settings.field_visibility_config,
      show_cancel_reason_on_cancelled: showCancelReasonCond
    }

    const gauge_thresholds = {
      ...settings.gauge_thresholds,
      temperature: {
        min: Number(tempThresholdMin) || 20,
        max: Number(tempThresholdMax) || 35
      }
    }

    const field_level_security_rules = {
      ...settings.field_level_security_rules,
      sales: {
        cost_price: !salesHideCost,
        gross_profit: !salesHideProfit
      }
    }

    const payload: Partial<DisplaySettings> = {
      currency_symbol: currencySymbol,
      currency_position: currencyPosition,
      thousands_separator: thousandsSeparator,
      decimal_separator: decimalSeparator,
      decimal_places_currency: Number(decimalPlacesCurrency),
      decimal_places_quantity: Number(decimalPlacesQuantity),
      decimal_places_percent: Number(decimalPlacesPercent),
      enable_compact_numbers: enableCompactNumbers,
      date_format: dateFormat,
      time_format: timeFormat,
      datetime_format: datetimeFormat,
      first_day_of_week: firstDayOfWeek,
      cycle_time_unit: cycleTimeUnit,
      phone_format: phoneFormat,
      id_prefix_opportunity: idPrefixOpportunity,
      id_prefix_invoice: idPrefixInvoice,
      id_prefix_customer: idPrefixCustomer,
      id_prefix_lot: idPrefixLot,
      text_truncation_limit: Number(textTruncationLimit),
      empty_state_format: emptyStateFormat,
      default_layout_view: defaultLayoutView,
      field_visibility_config,
      default_chart_type: defaultChartType,
      gauge_thresholds,
      system_language: systemLanguage,
      system_timezone: systemTimezone,
      default_units_weight: unitWeight,
      default_units_volume: unitVolume,
      default_units_area: unitArea,
      default_units_count: unitCount,
      enable_partial_masking: enablePartialMasking,
      field_level_security_rules
    }

    const { error } = await updateSettings(payload)
    setSaving(false)
    if (error) {
      showToast('error', 'Lỗi lưu cấu hình: ' + error.message)
    } else {
      showToast('success', 'Đã cập nhật cấu hình hiển thị toàn hệ thống thành công!')
      refreshSettings()
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Live Preview Formatter values
  // ─────────────────────────────────────────────────────────────
  const previewCurrency = (val: number, isCompact: boolean) => {
    let rawStr = ''
    if (isCompact && val >= 1000000) {
      if (val >= 1000000000) {
        rawStr = `${(val / 1000000000).toFixed(1)} Tỷ`
      } else {
        rawStr = `${(val / 1000000).toFixed(1)} Tr`
      }
    } else {
      const parts = val.toFixed(decimalPlacesCurrency).split('.')
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator)
      rawStr = parts.join(decimalSeparator)
    }

    return currencyPosition === 'before' ? `${currencySymbol}${rawStr}` : `${rawStr} ${currencySymbol}`
  }

  const previewQuantity = (val: number, unit: string) => {
    const parts = val.toFixed(decimalPlacesQuantity).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator)
    return `${parts.join(decimalSeparator)} ${unit}`
  }

  const previewPercent = (val: number) => {
    const parts = val.toFixed(decimalPlacesPercent).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator)
    return `${parts.join(decimalSeparator)}%`
  }

  const previewDate = (d: Date) => {
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    if (dateFormat === 'YYYY-MM-DD') return `${year}-${month}-${day}`
    if (dateFormat === 'MM/DD/YYYY') return `${month}/${day}/${year}`
    return `${day}/${month}/${year}`
  }

  const previewTime = (d: Date) => {
    const hours = d.getHours()
    const minutes = d.getMinutes()
    const mm = String(minutes).padStart(2, '0')
    if (timeFormat === '12h') {
      const ampm = hours >= 12 ? 'PM' : 'AM'
      const hh12 = hours % 12 || 12
      return `${String(hh12).padStart(2, '0')}:${mm} ${ampm}`
    }
    return `${String(hours).padStart(2, '0')}:${mm}`
  }

  const previewPhone = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '')
    if (phoneFormat === 'plus_prefix') {
      return `+84 ${cleaned.slice(1, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`
    }
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`
  }

  const previewMask = (val: string, type: 'phone' | 'email') => {
    if (!enablePartialMasking) return val
    if (type === 'phone') {
      return `${val.slice(0, 3)}***${val.slice(-4)}`
    } else {
      const parts = val.split('@')
      return `${parts[0].slice(0, 3)}***@${parts[1]}`
    }
  }

  const subTabClass = (active: boolean) => 
    `w-full text-left px-4 py-3 rounded-lg text-body-md font-semibold flex items-center gap-3 transition-all ${
      active 
        ? 'bg-blue-50 text-blue-600 shadow-sm border-l-4 border-blue-500' 
        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
    }`

  const testDate = new Date()

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden flex flex-col lg:flex-row min-h-[500px]">
      
      {/* Toast alert */}
      {toastMsg && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in fade-in slide-in-from-top-4 duration-300 ${
          toastMsg.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
            : 'bg-red-50 text-red-800 border-red-200'
        }`}>
          <Check size={18} className={toastMsg.type === 'success' ? 'text-emerald-600' : 'text-red-600'} />
          <span className="text-body-md font-medium">{toastMsg.text}</span>
        </div>
      )}

      {/* LEFT: Category Navigation (Sidebar List) */}
      <div className="w-full lg:w-64 bg-gray-25/50 border-r border-gray-100 p-4 space-y-1.5 flex-shrink-0">
        <h3 className="text-tiny font-bold text-gray-400 uppercase px-4 mb-3 tracking-wider">Cấu hình hiển thị</h3>
        <button onClick={() => setSubTab('numeric')} className={subTabClass(subTab === 'numeric')}>
          <Coins size={16} />
          <span>Số & Tiền tệ</span>
        </button>
        <button onClick={() => setSubTab('datetime')} className={subTabClass(subTab === 'datetime')}>
          <Calendar size={16} />
          <span>Thời gian & Chu kỳ</span>
        </button>
        <button onClick={() => setSubTab('text')} className={subTabClass(subTab === 'text')}>
          <Type size={16} />
          <span>Mã & Văn bản</span>
        </button>
        <button onClick={() => setSubTab('ui')} className={subTabClass(subTab === 'ui')}>
          <LayoutIcon size={16} />
          <span>Giao diện & Nhập liệu</span>
        </button>
        <button onClick={() => setSubTab('visual')} className={subTabClass(subTab === 'visual')}>
          <SlidersHorizontal size={16} />
          <span>Trực quan & Báo cáo</span>
        </button>
        <button onClick={() => setSubTab('localization')} className={subTabClass(subTab === 'localization')}>
          <Globe size={16} />
          <span>Khu vực & Đo lường</span>
        </button>
        <button onClick={() => setSubTab('security')} className={subTabClass(subTab === 'security')}>
          <Shield size={16} />
          <span>Bảo mật hiển thị</span>
        </button>
      </div>

      {/* CENTER: Main Edit Form Area */}
      <div className="flex-1 p-6 md:p-8 space-y-6">
        <form onSubmit={handleSave} className="space-y-6 flex flex-col justify-between h-full">
          
          <div className="space-y-6">
            {/* SUBTAB 1: NUMERIC & CURRENCY */}
            {subTab === 'numeric' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                    <Coins className="text-blue-500" size={20} />
                    <span>Cấu hình Định dạng Số & Tiền tệ</span>
                  </h4>
                  <p className="text-body-md text-gray-400">Thiết lập hiển thị tiền tệ, số lượng và các ký tự phân cách hàng nghìn/thập phân toàn hệ thống.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Ký hiệu tiền tệ</label>
                    <input
                      type="text"
                      value={currencySymbol}
                      onChange={(e) => setCurrencySymbol(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                      placeholder="VND, $, ¥..."
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Vị trí ký hiệu</label>
                    <select
                      value={currencyPosition}
                      onChange={(e) => setCurrencyPosition(e.target.value as any)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="after">Sau số (1.000 đ)</option>
                      <option value="before">Trước số ($1.000)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Dấu phân cách hàng nghìn</label>
                    <input
                      type="text"
                      maxLength={1}
                      value={thousandsSeparator}
                      onChange={(e) => setThousandsSeparator(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 text-center font-mono font-bold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Dấu phân cách thập phân</label>
                    <input
                      type="text"
                      maxLength={1}
                      value={decimalSeparator}
                      onChange={(e) => setDecimalSeparator(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 text-center font-mono font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Làm tròn số tiền</label>
                    <select
                      value={decimalPlacesCurrency}
                      onChange={(e) => setDecimalPlacesCurrency(Number(e.target.value))}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value={0}>0 chữ số thập phân</option>
                      <option value={2}>2 chữ số thập phân</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Làm tròn số lượng</label>
                    <select
                      value={decimalPlacesQuantity}
                      onChange={(e) => setDecimalPlacesQuantity(Number(e.target.value))}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value={0}>0 (150 kg)</option>
                      <option value={1}>1 (150.5 kg)</option>
                      <option value={2}>2 (150.55 kg)</option>
                      <option value={3}>3 (150.555 kg)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Làm tròn tỷ lệ %</label>
                    <select
                      value={decimalPlacesPercent}
                      onChange={(e) => setDecimalPlacesPercent(Number(e.target.value))}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value={0}>0 (10%)</option>
                      <option value={1}>1 (10.5%)</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-3 cursor-pointer bg-gray-50/50 p-4 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={enableCompactNumbers}
                      onChange={(e) => setEnableCompactNumbers(e.target.checked)}
                      className="w-4.5 h-4.5 text-blue-500 border-gray-200 rounded focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <div>
                      <span className="block text-body-md font-bold text-gray-750">Rút gọn số lớn (Compact style)</span>
                      <span className="block text-tiny text-gray-400">Tự động chuyển đổi các giá trị số lớn trên biểu đồ và dashboard (ví dụ: 1.500.000.000 đ thành 1.5 Tỷ đ).</span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* SUBTAB 2: DATE, TIME & CYCLE */}
            {subTab === 'datetime' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                    <Calendar className="text-blue-500" size={20} />
                    <span>Thời gian & Chu kỳ hiển thị</span>
                  </h4>
                  <p className="text-body-md text-gray-400">Cấu hình định dạng ngày giờ làm việc, ngày bắt đầu bộ lọc tuần và chu kỳ nuôi đàn.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Định dạng Ngày (Date)</label>
                    <select
                      value={dateFormat}
                      onChange={(e) => setDateFormat(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="DD/MM/YYYY">Ngày/Tháng/Năm (DD/MM/YYYY)</option>
                      <option value="YYYY-MM-DD">Năm-Tháng-Ngày (YYYY-MM-DD)</option>
                      <option value="MM/DD/YYYY">Tháng/Ngày/Năm (MM/DD/YYYY)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Định dạng Giờ (Time)</label>
                    <select
                      value={timeFormat}
                      onChange={(e) => setTimeFormat(e.target.value as any)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="24h">Hệ 24 giờ (18:45)</option>
                      <option value="12h">Hệ 12 giờ (06:45 PM)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Định dạng ngày & giờ kết hợp (Datetime)</label>
                  <input
                    type="text"
                    value={datetimeFormat}
                    onChange={(e) => setDatetimeFormat(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-mono"
                    placeholder="DD/MM/YYYY HH:mm:ss"
                  />
                  <p className="text-[11px] text-gray-400">Áp dụng cho xuất hóa đơn và ghi nhận lịch sử thay đổi (Audit trail).</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Ngày đầu tiên của tuần</label>
                    <select
                      value={firstDayOfWeek}
                      onChange={(e) => setFirstDayOfWeek(e.target.value as any)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="monday">Thứ Hai (Monday)</option>
                      <option value="sunday">Chủ Nhật (Sunday)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Đơn vị chu kỳ mặc định</label>
                    <select
                      value={cycleTimeUnit}
                      onChange={(e) => setCycleTimeUnit(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="day">Ngày tuổi</option>
                      <option value="week">Tuần tuổi</option>
                      <option value="month">Tháng tuổi</option>
                      <option value="year">Năm</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* SUBTAB 3: TEXT & AUTO ID STYLE */}
            {subTab === 'text' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                    <Type className="text-blue-500" size={20} />
                    <span>Kiểu Văn bản & Tiền tố Mã (Prefixes)</span>
                  </h4>
                  <p className="text-body-md text-gray-400">Cấu hình khoảng cách số điện thoại, quy tắc sinh mã tự động cho hóa đơn, cơ hội và rút gọn chữ dài.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Số điện thoại</label>
                    <select
                      value={phoneFormat}
                      onChange={(e) => setPhoneFormat(e.target.value as any)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="space">Có dấu cách (0912 345 678)</option>
                      <option value="plus_prefix">Quốc tế (+84 912 345 678)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Giá trị khi trường trống (Empty)</label>
                    <input
                      type="text"
                      value={emptyStateFormat}
                      onChange={(e) => setEmptyStateFormat(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 text-center font-bold"
                    />
                  </div>
                </div>

                {/* Autogen pattern prefix configs */}
                <div className="bg-gray-25 p-4 rounded-xl border border-gray-100/70 space-y-3">
                  <h5 className="text-tiny font-bold text-gray-500 uppercase tracking-wide">Tiền tố Mã Tự động (Prefix Pattern)</h5>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Khách hàng</label>
                      <input
                        type="text"
                        value={idPrefixCustomer}
                        onChange={(e) => setIdPrefixCustomer(e.target.value)}
                        className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-mono font-bold uppercase"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Cơ hội Sale</label>
                      <input
                        type="text"
                        value={idPrefixOpportunity}
                        onChange={(e) => setIdPrefixOpportunity(e.target.value)}
                        className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-mono font-bold uppercase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Hóa đơn</label>
                      <input
                        type="text"
                        value={idPrefixInvoice}
                        onChange={(e) => setIdPrefixInvoice(e.target.value)}
                        className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-mono font-bold uppercase"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Số lô đàn (Lot)</label>
                      <input
                        type="text"
                        value={idPrefixLot}
                        onChange={(e) => setIdPrefixLot(e.target.value)}
                        className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-mono font-bold uppercase"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-body-md font-semibold text-gray-700">Giới hạn ký tự danh sách (Text Truncation)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={10}
                      max={200}
                      value={textTruncationLimit}
                      onChange={(e) => setTextTruncationLimit(Number(e.target.value))}
                      className="w-24 h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 text-center font-bold"
                    />
                    <span className="text-tiny text-gray-400">ký tự. (Văn bản vượt quá độ dài này sẽ tự động thu gọn bằng dấu ba chấm ... trên các danh sách thu nhỏ).</span>
                  </div>
                </div>
              </div>
            )}

            {/* SUBTAB 4: UI VIEWS & FORMS */}
            {subTab === 'ui' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                    <LayoutIcon className="text-blue-500" size={20} />
                    <span>Chế độ Xem & Quy chuẩn Biểu mẫu</span>
                  </h4>
                  <p className="text-body-md text-gray-400">Cài đặt hiển thị mặc định của hệ thống bảng biểu và tính năng ẩn/hiện trường có điều kiện.</p>
                </div>

                <div className="space-y-1.5 pt-2">
                  <label className="block text-body-md font-semibold text-gray-700">Chế độ xem danh sách mặc định</label>
                  <select
                    value={defaultLayoutView}
                    onChange={(e) => setDefaultLayoutView(e.target.value as any)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="table">Dạng bảng danh sách (Table View)</option>
                    <option value="card">Dạng thẻ Kanban (Card View)</option>
                    <option value="grid">Dạng lưới ô vuông (Grid View)</option>
                    <option value="list">Dạng danh sách thu gọn (List View)</option>
                  </select>
                </div>

                <div className="bg-gray-25 p-4 rounded-xl border border-gray-100/70 space-y-3">
                  <h5 className="text-tiny font-bold text-gray-500 uppercase tracking-wide">Quy tắc Ẩn / Hiện trường biểu mẫu</h5>
                  
                  <label className="flex items-center gap-3 cursor-pointer bg-white p-3 rounded-lg border border-gray-100 hover:shadow-sm transition-all">
                    <input
                      type="checkbox"
                      checked={showCancelReasonCond}
                      onChange={(e) => setShowCancelReasonCond(e.target.checked)}
                      className="w-4 h-4 text-blue-500 border-gray-200 rounded focus:ring-blue-500"
                    />
                    <div>
                      <span className="block text-body-md font-bold text-gray-750">Chỉ hiện trường "Lý do hủy" khi trạng thái là "Hủy"</span>
                      <span className="block text-[11px] text-gray-400">Áp dụng cho các màn hình Đơn hàng bán và Đơn mua hàng (PO).</span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* SUBTAB 5: VISUAL & ANALYTICS */}
            {subTab === 'visual' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                    <SlidersHorizontal className="text-blue-500" size={20} />
                    <span>Trực quan hóa & Cảnh báo phân tích</span>
                  </h4>
                  <p className="text-body-md text-gray-400">Cấu hình biểu đồ phân tích dữ liệu, các dải đo ngưỡng cảnh báo an toàn cho trang trại.</p>
                </div>

                <div className="space-y-1.5 pt-2">
                  <label className="block text-body-md font-semibold text-gray-700">Loại biểu đồ mặc định trên Báo cáo</label>
                  <select
                    value={defaultChartType}
                    onChange={(e) => setDefaultChartType(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="bar">Biểu đồ cột dọc (Bar Chart)</option>
                    <option value="line">Biểu đồ đường xu hướng (Line Chart)</option>
                    <option value="pie">Biểu đồ hình quạt tròn (Pie Chart)</option>
                    <option value="funnel">Biểu đồ phễu Sale (Funnel Chart)</option>
                  </select>
                </div>

                <div className="bg-gray-25 p-4 rounded-xl border border-gray-100/70 space-y-3">
                  <h5 className="text-tiny font-bold text-gray-500 uppercase tracking-wide">Ngưỡng đo lường cảnh báo nhiệt độ chuồng nuôi</h5>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Nhiệt độ tối thiểu an toàn (°C)</label>
                      <input
                        type="number"
                        value={tempThresholdMin}
                        onChange={(e) => setTempThresholdMin(e.target.value)}
                        className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 text-center font-bold"
                      />
                    </div>
                    
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Nhiệt độ tối đa an toàn (°C)</label>
                      <input
                        type="number"
                        value={tempThresholdMax}
                        onChange={(e) => setTempThresholdMax(e.target.value)}
                        className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 text-center font-bold"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
                    <Info size={12} className="text-gray-400 flex-shrink-0" />
                    <span>Dưới hoặc vượt ngoài ngưỡng này hệ thống chăn nuôi sẽ hiển thị cảnh báo mức Critical màu đỏ nhấp nháy.</span>
                  </p>
                </div>
              </div>
            )}

            {/* SUBTAB 6: LOCALIZATION & MEASUREMENT UNITS */}
            {subTab === 'localization' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                    <Globe className="text-blue-500" size={20} />
                    <span>Cài đặt Vùng miền & Đơn vị đo</span>
                  </h4>
                  <p className="text-body-md text-gray-400">Đơn vị đo lường mặc định đi kèm số lượng trên kho hàng và đơn hàng.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Ngôn ngữ hệ thống</label>
                    <select
                      value={systemLanguage}
                      onChange={(e) => setSystemLanguage(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="vi-VN">Tiếng Việt (vi-VN)</option>
                      <option value="en-US">English (en-US)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-body-md font-semibold text-gray-700">Múi giờ vận hành</label>
                    <select
                      value={systemTimezone}
                      onChange={(e) => setSystemTimezone(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="Asia/Ho_Chi_Minh">Việt Nam (GMT+07:00 - Asia/Ho_Chi_Minh)</option>
                      <option value="UTC">Giờ Quốc tế (GMT+00:00 - UTC)</option>
                    </select>
                  </div>
                </div>

                <div className="bg-gray-25 p-4 rounded-xl border border-gray-100/70 space-y-3">
                  <h5 className="text-tiny font-bold text-gray-500 uppercase tracking-wide">Đơn vị đo lường hiển thị mặc định</h5>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Khối lượng</label>
                      <input
                        type="text"
                        value={unitWeight}
                        onChange={(e) => setUnitWeight(e.target.value)}
                        className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-bold"
                      />
                    </div>
                    
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Thể tích</label>
                      <input
                        type="text"
                        value={unitVolume}
                        onChange={(e) => setUnitVolume(e.target.value)}
                        className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Diện tích chuồng trại</label>
                      <input
                        type="text"
                        value={unitArea}
                        onChange={(e) => setUnitArea(e.target.value)}
                        className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-bold"
                      />
                    </div>
                    
                    <div className="space-y-1">
                      <label className="block text-tiny text-gray-400 font-semibold">Đàn vật nuôi (Đếm đầu con)</label>
                      <input
                        type="text"
                        value={unitCount}
                        onChange={(e) => setUnitCount(e.target.value)}
                        className="w-full h-9 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 font-bold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SUBTAB 7: SECURITY DISPLAY */}
            {subTab === 'security' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-body-lg font-bold text-gray-800 flex items-center gap-2">
                    <Shield className="text-blue-500" size={20} />
                    <span>Bảo mật dữ liệu hiển thị (Security Display)</span>
                  </h4>
                  <p className="text-body-md text-gray-400">Thiết lập che giấu một phần thông tin nhạy cảm của khách hàng và phân quyền xem dữ liệu theo vai trò (Field-level security).</p>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-3 cursor-pointer bg-gray-50/50 p-4 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={enablePartialMasking}
                      onChange={(e) => setEnablePartialMasking(e.target.checked)}
                      className="w-4.5 h-4.5 text-blue-500 border-gray-200 rounded focus:ring-blue-500"
                    />
                    <div>
                      <span className="block text-body-md font-bold text-gray-750">Bật che giấu dữ liệu liên hệ (Partial Masking)</span>
                      <span className="block text-tiny text-gray-400">Ẩn bớt các ký tự của Số điện thoại và Email khách hàng trên danh sách đối với người dùng không phải quản trị viên (ví dụ: 091***6789, nguyen***@gmail.com).</span>
                    </div>
                  </label>
                </div>

                <div className="bg-gray-25 p-4 rounded-xl border border-gray-100/70 space-y-3">
                  <h5 className="text-tiny font-bold text-gray-500 uppercase tracking-wide">Quyền xem trường dữ liệu nhạy cảm (Field-Level Security)</h5>
                  
                  <div className="space-y-3">
                    <div className="bg-white p-3 rounded-lg border border-gray-100 flex items-center justify-between">
                      <div>
                        <span className="block text-body-md font-bold text-gray-750">Ẩn cột "Giá vốn" đối với vai trò Sales</span>
                        <span className="block text-tiny text-gray-400">Nhân viên kinh doanh không thể xem được giá nhập và giá vốn sản phẩm.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSalesHideCost(!salesHideCost)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          salesHideCost ? 'bg-blue-500' : 'bg-gray-250'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            salesHideCost ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="bg-white p-3 rounded-lg border border-gray-100 flex items-center justify-between">
                      <div>
                        <span className="block text-body-md font-bold text-gray-750">Ẩn trường "Lợi nhuận gộp" đối với vai trò Sales</span>
                        <span className="block text-tiny text-gray-400">Nhân viên kinh doanh không thể xem biên lợi nhuận gộp trên báo cáo.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSalesHideProfit(!salesHideProfit)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          salesHideProfit ? 'bg-blue-500' : 'bg-gray-250'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            salesHideProfit ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="pt-6 border-t border-gray-100 flex justify-end gap-3 mt-6">
            <button
              type="submit"
              disabled={saving}
              className="px-6 h-10 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <RefreshCw className="animate-spin" size={16} />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <Check size={16} />
                  <span>Lưu cấu hình</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>

      {/* RIGHT: Live Preview Panel (Real-time formatting preview) */}
      <div className="w-full lg:w-80 bg-gray-25/40 border-l border-gray-100 p-6 space-y-5 flex-shrink-0 flex flex-col justify-between">
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
            <Sparkles className="text-blue-500 animate-pulse" size={18} />
            <h4 className="text-body-md font-bold text-gray-800 uppercase tracking-wide">Xem trước trực tiếp (Live Preview)</h4>
          </div>

          <div className="space-y-3 text-body-md">
            {/* Numeric preview card */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-2">
              <span className="text-[11px] font-bold text-gray-400 uppercase">1. Số & Tiền tệ</span>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Số tiền gốc (1500000 đ):</span>
                <span className="font-bold text-gray-800">{previewCurrency(1500000, false)}</span>
              </div>
              <div className="flex justify-between items-center text-tiny">
                <span className="text-gray-400">Dashboard rút gọn (1.5B):</span>
                <span className="font-bold text-blue-500">{previewCurrency(1500000000, enableCompactNumbers)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Số lượng (125.75):</span>
                <span className="font-bold text-gray-800">{previewQuantity(125.75, unitWeight)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Phần trăm (0.955):</span>
                <span className="font-bold text-gray-800">{previewPercent(95.5)}</span>
              </div>
            </div>

            {/* Date time preview card */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-2">
              <span className="text-[11px] font-bold text-gray-400 uppercase">2. Thời gian</span>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Ngày hiển thị:</span>
                <span className="font-bold text-gray-800 font-mono">{previewDate(testDate)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Giờ hiển thị:</span>
                <span className="font-bold text-gray-800 font-mono">{previewTime(testDate)}</span>
              </div>
            </div>

            {/* Text & Prefixes preview card */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-2">
              <span className="text-[11px] font-bold text-gray-400 uppercase">3. Mã & Điện thoại</span>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Mã KH tự sinh:</span>
                <span className="font-mono font-bold text-blue-500">{idPrefixCustomer}00142</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Mã cơ hội:</span>
                <span className="font-mono font-bold text-blue-500">{idPrefixOpportunity}2026-045</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Số điện thoại:</span>
                <span className="font-bold text-gray-800">{previewPhone('0912345678')}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Giá trị trống:</span>
                <span className="font-bold text-gray-800 font-mono">{emptyStateFormat}</span>
              </div>
            </div>

            {/* Security preview card */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-2">
              <span className="text-[11px] font-bold text-gray-400 uppercase">4. Bảo mật hiển thị</span>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">SĐT khách hàng:</span>
                <span className="font-mono text-gray-700 font-bold">{previewMask('0987654321', 'phone')}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Email khách hàng:</span>
                <span className="font-mono text-gray-700 font-bold">{previewMask('customer@gmail.com', 'email')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-blue-25/30 border border-blue-50/50 rounded-xl space-y-1.5 mt-4">
          <p className="text-tiny font-bold text-blue-600 flex items-center gap-1.5">
            <Eye size={14} />
            <span>Mẹo quản trị</span>
          </p>
          <p className="text-[11px] text-gray-400 leading-normal">
            Bấm **Lưu cấu hình** để áp dụng trực tiếp các quy chuẩn hiển thị này trên toàn bộ hệ thống ngay lập tức mà không cần triển khai thêm code.
          </p>
        </div>
      </div>

    </div>
  )
}
