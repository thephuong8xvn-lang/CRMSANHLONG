import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'
import { DEFAULT_FORECAST_CONFIG, type ForecastConfig } from '../../lib/forecast'

// Một SKU + chuỗi cầu theo tuần (tăng dần theo thời gian) để engine dự báo.
export interface DemandSeries {
  product_id: string
  sku: string
  name: string
  unit: string | null
  stock_on_hand: number
  weeks: string[]   // ISO date đầu tuần (tăng dần)
  values: number[]  // cầu theo tuần, zero-fill
}

interface RawRow {
  product_id: string
  sku: string
  name: string
  unit: string | null
  stock_on_hand: number | string
  week_start: string
  qty: number | string
}

/** Lấy lịch sử cầu theo tuần (zero-fill) mỗi SKU có bán, gom theo SKU. */
export function useDemandForecast(weeks: number, enabled: boolean = true) {
  return useQuery<DemandSeries[]>({
    queryKey: qk.forecast.demandHistory(weeks),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_demand_history', { p_weeks: weeks })
      if (error) { logger.error('[useDemandForecast]', error.message); throw error }

      // Gom long-format → series theo SKU. RPC đã ORDER BY name, week → giữ thứ tự.
      const map = new Map<string, DemandSeries>()
      for (const r of (data ?? []) as RawRow[]) {
        let s = map.get(r.product_id)
        if (!s) {
          s = {
            product_id: r.product_id,
            sku: r.sku,
            name: r.name,
            unit: r.unit,
            stock_on_hand: Number(r.stock_on_hand) || 0,
            weeks: [],
            values: [],
          }
          map.set(r.product_id, s)
        }
        s.weeks.push(r.week_start)
        s.values.push(Number(r.qty) || 0)
      }
      return Array.from(map.values())
    },
    staleTime: 60_000,
  })
}

/** Tham số engine từ system_settings.forecast_config (fallback mặc định). */
export function useForecastConfig() {
  return useQuery<ForecastConfig>({
    queryKey: qk.forecast.config,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'forecast_config')
        .maybeSingle()
      if (error) { logger.error('[useForecastConfig]', error.message); throw error }
      const v = (data?.value ?? {}) as Record<string, unknown>
      return {
        alpha: Number(v.alpha) || DEFAULT_FORECAST_CONFIG.alpha,
        horizonWeeks: Number(v.default_horizon_weeks) || DEFAULT_FORECAST_CONFIG.horizonWeeks,
        confLowWeeks: Number(v.conf_low_weeks) || DEFAULT_FORECAST_CONFIG.confLowWeeks,
        confHighWeeks: Number(v.conf_high_weeks) || DEFAULT_FORECAST_CONFIG.confHighWeeks,
        confMinDemandWeeks: Number(v.conf_min_demand_weeks) || DEFAULT_FORECAST_CONFIG.confMinDemandWeeks,
      }
    },
    staleTime: 5 * 60_000,
  })
}
