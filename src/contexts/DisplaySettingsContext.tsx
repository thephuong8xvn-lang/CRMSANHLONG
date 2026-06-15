import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

export interface DisplaySettings {
  id: string
  currency_symbol: string
  currency_position: 'before' | 'after'
  thousands_separator: string
  decimal_separator: string
  decimal_places_currency: number
  decimal_places_quantity: number
  decimal_places_percent: number
  enable_compact_numbers: boolean
  date_format: string
  time_format: '24h' | '12h'
  datetime_format: string
  first_day_of_week: 'monday' | 'sunday'
  cycle_time_unit: string
  phone_format: 'space' | 'plus_prefix'
  id_prefix_opportunity: string
  id_prefix_invoice: string
  id_prefix_customer: string
  id_prefix_lot: string
  text_truncation_limit: number
  empty_state_format: string
  default_layout_view: 'table' | 'card' | 'grid' | 'list'
  field_visibility_config: Record<string, any>
  field_input_controls: Record<string, any>
  input_masking_config: Record<string, any>
  status_badges_config: Record<string, any>
  icons_map_config: Record<string, any>
  trend_indicator_config: Record<string, any>
  default_chart_type: string
  gauge_thresholds: Record<string, any>
  system_language: string
  system_timezone: string
  address_structure_format: string
  default_units_weight: string
  default_units_volume: string
  default_units_area: string
  default_units_count: string
  enable_partial_masking: boolean
  field_level_security_rules: Record<string, any>
  // Print settings
  print_company_name: string
  print_company_address: string
  print_company_phone: string
  print_company_email: string
  print_company_mst: string
  print_company_website: string
  print_company_logo_url: string | null
  print_default_paper: 'A4' | 'A5'
  print_default_orientation: 'portrait' | 'landscape'
}

const DEFAULT_SETTINGS: DisplaySettings = {
  id: 'global',
  currency_symbol: 'VND',
  currency_position: 'after',
  thousands_separator: '.',
  decimal_separator: ',',
  decimal_places_currency: 0,
  decimal_places_quantity: 2,
  decimal_places_percent: 1,
  enable_compact_numbers: false,
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
  datetime_format: 'DD/MM/YYYY HH:mm:ss',
  first_day_of_week: 'monday',
  cycle_time_unit: 'day',
  phone_format: 'space',
  id_prefix_opportunity: 'OPO-',
  id_prefix_invoice: 'HD-',
  id_prefix_customer: 'KH-',
  id_prefix_lot: 'LOT-',
  text_truncation_limit: 50,
  empty_state_format: '-',
  default_layout_view: 'table',
  field_visibility_config: {},
  field_input_controls: {},
  input_masking_config: {},
  status_badges_config: {
    // Default fallback status badges colors
    'order': {
      'draft': 'bg-gray-50 text-gray-600 border-gray-150',
      'confirmed': 'bg-blue-50 text-blue-700 border-blue-150',
      'shipping': 'bg-sky-50 text-sky-700 border-sky-150',
      'delivered': 'bg-teal-50 text-teal-700 border-teal-150',
      'paid': 'bg-emerald-50 text-emerald-700 border-emerald-150',
      'completed': 'bg-green-50 text-green-700 border-green-150',
      'cancelled': 'bg-rose-50 text-rose-700 border-rose-150',
      'returned_partial': 'bg-amber-50 text-amber-700 border-amber-150',
      'returned_full': 'bg-red-50 text-red-700 border-red-150'
    },
    'opportunity': {
      'open': 'bg-blue-50 text-blue-700 border-blue-150',
      'won': 'bg-emerald-50 text-emerald-700 border-emerald-150',
      'lost': 'bg-rose-50 text-rose-700 border-rose-150',
      'abandoned': 'bg-gray-50 text-gray-600 border-gray-150'
    }
  },
  icons_map_config: {},
  trend_indicator_config: {
    'up': { color: 'text-emerald-600', symbol: '▲' },
    'down': { color: 'text-rose-600', symbol: '▼' },
    'stable': { color: 'text-gray-400', symbol: '─' }
  },
  default_chart_type: 'bar',
  gauge_thresholds: {
    'temperature': { min: 20, max: 35 }
  },
  system_language: 'vi-VN',
  system_timezone: 'Asia/Ho_Chi_Minh',
  address_structure_format: 'detail_ward_district_province',
  default_units_weight: 'kg',
  default_units_volume: 'lit',
  default_units_area: 'm2',
  default_units_count: 'con',
  enable_partial_masking: false,
  field_level_security_rules: {
    // role: { field: canView }
    'sales': {
      'cost_price': false,
      'gross_profit': false
    },
    'accountant': {
      'cost_price': true,
      'gross_profit': true
    },
    'admin': {
      'cost_price': true,
      'gross_profit': true
    }
  },
  // Print settings defaults
  print_company_name: 'CÔNG TY VẬT TƯ THUỐC THÚ Y SANH LONG',
  print_company_address: '789 Đường Thú Y, Phường Bình An, TP. Hồ Chí Minh',
  print_company_phone: '0945.195.156 - 1900 6789',
  print_company_email: 'lienhe@sanhlongvetco.vn',
  print_company_mst: '4101672005',
  print_company_website: 'www.sanhlongvetco.vn',
  print_company_logo_url: null,
  print_default_paper: 'A4' as const,
  print_default_orientation: 'portrait' as const
}

interface DisplaySettingsContextType {
  settings: DisplaySettings
  loading: boolean
  refreshSettings: () => Promise<void>
  updateSettings: (newSettings: Partial<DisplaySettings>) => Promise<{ error: any }>
  formatCurrency: (val: number | null | undefined) => string
  formatQuantity: (val: number | null | undefined, unit?: string) => string
  formatPercent: (val: number | null | undefined) => string
  formatDate: (dateStr: string | Date | null | undefined) => string
  formatTime: (timeStr: string | Date | null | undefined) => string
  formatDateTime: (dtStr: string | Date | null | undefined) => string
  formatPhone: (phone: string | null | undefined) => string
  truncateText: (text: string | null | undefined, maxChars?: number) => string
  formatEmpty: (val: any) => string
  maskData: (value: string | null | undefined, type: 'phone' | 'email') => string
  hasFieldAccess: (fieldName: string, userRoleCode?: string) => boolean
  getStatusBadgeStyle: (status: string, module: string) => string
  getTrendIndicator: (val: number) => { symbol: string; color: string }
  printConfig: {
    companyName: string
    address: string
    phone: string
    email: string
    mst: string
    website: string
    logoUrl: string | null
    defaultPaper: 'A4' | 'A5'
    defaultOrientation: 'portrait' | 'landscape'
  }
}

const DisplaySettingsContext = createContext<DisplaySettingsContextType | null>(null)

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [userRoleCode, setUserRoleCode] = useState<string | null>(null)
  const { profile } = useAuth()

  useEffect(() => {
    const fetchRole = async () => {
      if (!profile?.id) {
        setUserRoleCode(null)
        return
      }
      try {
        const { data } = await supabase
          .from('user_roles')
          .select('role:roles(code)')
          .eq('user_id', profile.id)
          .single()
        if (data && (data as any).role) {
          setUserRoleCode((data as any).role.code)
        }
      } catch (err) {
        console.error('Error loading role in DisplaySettingsProvider:', err)
      }
    }
    fetchRole()
  }, [profile])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('display_settings')
        .select('*')
        .eq('id', 'global')
        .single()

      if (!error && data) {
        // Merge fetched settings with default fallbacks for safety
        setSettings({
          ...DEFAULT_SETTINGS,
          ...data,
          status_badges_config: {
            ...DEFAULT_SETTINGS.status_badges_config,
            ...(data.status_badges_config || {})
          },
          trend_indicator_config: {
            ...DEFAULT_SETTINGS.trend_indicator_config,
            ...(data.trend_indicator_config || {})
          },
          field_level_security_rules: {
            ...DEFAULT_SETTINGS.field_level_security_rules,
            ...(data.field_level_security_rules || {})
          }
        })
      } else if (error) {
        console.warn('DisplaySettings Table failed to load, falling back to defaults:', error.message)
      }
    } catch (err) {
      console.error('DisplaySettings fetch exception, using default fallbacks:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const refreshSettings = async () => {
    await loadSettings()
  }

  const updateSettings = async (newSettings: Partial<DisplaySettings>) => {
    try {
      const payload = {
        ...newSettings,
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('display_settings')
        .update(payload)
        .eq('id', 'global')
        .select()
        .single()

      if (!error && data) {
        setSettings(prev => ({ ...prev, ...data }))
        return { error: null }
      }
      return { error }
    } catch (err: any) {
      return { error: err }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Formatting helper functions
  // ─────────────────────────────────────────────────────────────

  // 1. Format Currency
  const formatCurrency = (val: number | null | undefined): string => {
    if (val === null || val === undefined || isNaN(val)) {
      return formatEmpty(val)
    }

    const absoluteVal = Math.abs(val)
    let formattedStr = ''

    if (settings.enable_compact_numbers && absoluteVal >= 1000000) {
      if (absoluteVal >= 1000000000) {
        const bln = (val / 1000000000).toFixed(1)
        formattedStr = `${bln} Tỷ`
      } else {
        const mln = (val / 1000000).toFixed(1)
        formattedStr = `${mln} Tr`
      }
    } else {
      // Manual formatting with specified separators
      const parts = val.toFixed(settings.decimal_places_currency).split('.')
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, settings.thousands_separator)
      formattedStr = parts.join(settings.decimal_separator)
    }

    if (settings.currency_position === 'before') {
      return `${settings.currency_symbol}${formattedStr}`
    } else {
      return `${formattedStr} ${settings.currency_symbol}`
    }
  }

  // 2. Format Quantity
  const formatQuantity = (val: number | null | undefined, unit?: string): string => {
    if (val === null || val === undefined || isNaN(val)) {
      return formatEmpty(val)
    }

    const parts = val.toFixed(settings.decimal_places_quantity).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, settings.thousands_separator)
    const formattedVal = parts.join(settings.decimal_separator)

    // Phân biệt rõ: unit === undefined → dùng đơn vị đếm mặc định;
    // unit === '' (cố ý) → KHÔNG gắn đơn vị (vd bản in có cột ĐVT riêng).
    const finalUnit = unit === undefined ? settings.default_units_count : unit
    return finalUnit ? `${formattedVal} ${finalUnit}` : formattedVal
  }

  // 3. Format Percent
  const formatPercent = (val: number | null | undefined): string => {
    if (val === null || val === undefined || isNaN(val)) {
      return formatEmpty(val)
    }

    const parts = val.toFixed(settings.decimal_places_percent).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, settings.thousands_separator)
    const formattedVal = parts.join(settings.decimal_separator)

    return `${formattedVal}%`
  }

  // 4. Format Date
  const formatDate = (dateStr: string | Date | null | undefined): string => {
    if (!dateStr) return formatEmpty(dateStr)
    try {
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return formatEmpty(dateStr)

      const day = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const year = d.getFullYear()

      if (settings.date_format === 'YYYY-MM-DD') {
        return `${year}-${month}-${day}`
      } else if (settings.date_format === 'MM/DD/YYYY') {
        return `${month}/${day}/${year}`
      } else {
        return `${day}/${month}/${year}`
      }
    } catch {
      return formatEmpty(dateStr)
    }
  }

  // 5. Format Time
  const formatTime = (timeStr: string | Date | null | undefined): string => {
    if (!timeStr) return formatEmpty(timeStr)
    try {
      // timeStr can be HH:mm:ss, ISO string or Date
      let hours = 0
      let minutes = 0

      if (timeStr instanceof Date) {
        hours = timeStr.getHours()
        minutes = timeStr.getMinutes()
      } else if (typeof timeStr === 'string' && timeStr.includes('T')) {
        const d = new Date(timeStr)
        hours = d.getHours()
        minutes = d.getMinutes()
      } else if (typeof timeStr === 'string') {
        const parts = timeStr.split(':')
        hours = parseInt(parts[0], 10) || 0
        minutes = parseInt(parts[1], 10) || 0
      }

      const mm = String(minutes).padStart(2, '0')

      if (settings.time_format === '12h') {
        const ampm = hours >= 12 ? 'PM' : 'AM'
        const hh12 = hours % 12 || 12
        const hh = String(hh12).padStart(2, '0')
        return `${hh}:${mm} ${ampm}`
      } else {
        const hh = String(hours).padStart(2, '0')
        return `${hh}:${mm}`
      }
    } catch {
      return formatEmpty(timeStr)
    }
  }

  // 6. Format DateTime
  const formatDateTime = (dtStr: string | Date | null | undefined): string => {
    if (!dtStr) return formatEmpty(dtStr)
    try {
      const d = new Date(dtStr)
      if (isNaN(d.getTime())) return formatEmpty(dtStr)

      const formattedDate = formatDate(d)
      const formattedTime = formatTime(d)

      return `${formattedDate} ${formattedTime}`
    } catch {
      return formatEmpty(dtStr)
    }
  }

  // 7. Format Phone
  const formatPhone = (phone: string | null | undefined): string => {
    if (!phone) return formatEmpty(phone)
    const cleaned = phone.replace(/\D/g, '')
    if (settings.phone_format === 'plus_prefix') {
      // e.g. +84 912 345 678
      if (cleaned.startsWith('84')) {
        return `+84 ${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`
      } else if (cleaned.startsWith('0')) {
        return `+84 ${cleaned.slice(1, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`
      }
      return `+${cleaned}`
    } else {
      // e.g. 0912 345 678
      if (cleaned.startsWith('84')) {
        return `0${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`
      } else if (cleaned.startsWith('0')) {
        return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`
      }
      return phone
    }
  }

  // 8. Truncate Text
  const truncateText = (text: string | null | undefined, maxChars?: number): string => {
    if (!text) return ''
    const limit = maxChars || settings.text_truncation_limit
    if (text.length <= limit) return text
    return `${text.slice(0, limit)}...`
  }

  // 9. Format Empty Value
  const formatEmpty = (val: any): string => {
    return settings.empty_state_format
  }

  // 10. Mask data (phone / email)
  const maskData = (value: string | null | undefined, type: 'phone' | 'email'): string => {
    if (!value) return formatEmpty(value)
    if (!settings.enable_partial_masking) return value
    if (userRoleCode === 'admin' || userRoleCode === 'ceo') return value

    if (type === 'phone') {
      const cleaned = value.trim()
      if (cleaned.length < 7) return '***'
      return `${cleaned.slice(0, 3)}***${cleaned.slice(-4)}`
    } else {
      const parts = value.split('@')
      if (parts.length < 2) return '***'
      const name = parts[0]
      const domain = parts[1]
      if (name.length <= 3) {
        return `${name.charAt(0)}***@${domain}`
      }
      return `${name.slice(0, 3)}***@${domain}`
    }
  }

  // 11. Check field level security access
  const hasFieldAccess = (fieldName: string, userRoleCodeOverride?: string): boolean => {
    const role = userRoleCodeOverride || userRoleCode || 'sales'
    if (role === 'admin' || role === 'ceo') return true
    const rules = settings.field_level_security_rules[role]
    if (rules && rules[fieldName] !== undefined) {
      return rules[fieldName]
    }
    return true
  }

  // 12. Get status badge colors
  const getStatusBadgeStyle = (status: string, module: string): string => {
    const moduleConfigs = settings.status_badges_config[module]
    if (moduleConfigs && moduleConfigs[status]) {
      return moduleConfigs[status]
    }
    // Standard default color
    return 'bg-gray-50 text-gray-600 border-gray-100'
  }

  // 13. Trend indicators
  const getTrendIndicator = (val: number): { symbol: string; color: string } => {
    if (val > 0) {
      return settings.trend_indicator_config.up || DEFAULT_SETTINGS.trend_indicator_config.up
    } else if (val < 0) {
      return settings.trend_indicator_config.down || DEFAULT_SETTINGS.trend_indicator_config.down
    } else {
      return settings.trend_indicator_config.stable || DEFAULT_SETTINGS.trend_indicator_config.stable
    }
  }

  const printConfig = {
    companyName: settings.print_company_name,
    address: settings.print_company_address,
    phone: settings.print_company_phone,
    email: settings.print_company_email,
    mst: settings.print_company_mst,
    website: settings.print_company_website,
    logoUrl: settings.print_company_logo_url,
    defaultPaper: settings.print_default_paper,
    defaultOrientation: settings.print_default_orientation
  }

  return (
    <DisplaySettingsContext.Provider value={{
      settings,
      loading,
      refreshSettings,
      updateSettings,
      formatCurrency,
      formatQuantity,
      formatPercent,
      formatDate,
      formatTime,
      formatDateTime,
      formatPhone,
      truncateText,
      formatEmpty,
      maskData,
      hasFieldAccess,
      getStatusBadgeStyle,
      getTrendIndicator,
      printConfig
    }}>
      {children}
    </DisplaySettingsContext.Provider>
  )
}

export function useDisplaySettings() {
  const context = useContext(DisplaySettingsContext)
  if (!context) {
    throw new Error('useDisplaySettings must be used within a DisplaySettingsProvider')
  }
  return context
}
