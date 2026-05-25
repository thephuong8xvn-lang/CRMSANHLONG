import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

export interface ProductStockRow {
  id: string
  sku: string
  name: string
  unit: string
  is_lot_managed: boolean
  is_active: boolean
  category_id: string | null
  brand_id: string | null
  package_specs: string | null
  image_urls: string[]
  created_at: string
  category_name: string | null
  category_code: string | null
  brand_name: string | null
  retail_price: number
  retail_cost: number
  stock_on_hand: number
  on_order_qty: number
  sold_30d: number
  days_to_oos: number | null
}

export interface ProductListParams {
  page: number
  pageSize: number
  search?: string         // ilike trên name OR sku
  categoryId?: string
  brandId?: string
  status?: 'active' | 'inactive' | 'all'
}

export interface ProductListResult {
  rows: ProductStockRow[]
  total: number
  // Sum tổng tồn / khách đặt của TOÀN BỘ filtered set (không chỉ trang hiện tại)
  // - dùng query phụ vì PostgREST không trả aggregate ngoài count
  totalStockAll: number
  totalOnOrderAll: number
}

export function useProductsList(params: ProductListParams) {
  return useQuery({
    queryKey: qk.products.list(params),
    queryFn: async (): Promise<ProductListResult> => {
      const from = (params.page - 1) * params.pageSize
      const to   = from + params.pageSize - 1

      const buildFilter = <T>(q: T): T => {
        let qq = q as any
        if (params.categoryId)              qq = qq.eq('category_id', params.categoryId)
        if (params.brandId)                 qq = qq.eq('brand_id',    params.brandId)
        if (params.status === 'active')     qq = qq.eq('is_active', true)
        if (params.status === 'inactive')   qq = qq.eq('is_active', false)
        if (params.search && params.search.trim()) {
          const term = params.search.trim().replace(/[%_]/g, '\\$&')
          qq = qq.or(`name.ilike.%${term}%,sku.ilike.%${term}%`)
        }
        return qq
      }

      // Trang hiện tại + count tổng
      const pageQuery = buildFilter(
        supabase
          .from('product_stock_summary_view')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(from, to)
      )

      // Aggregate tổng tồn + khách đặt qua toàn bộ filtered (không range)
      // PostgREST hỗ trợ ?select=col.sum() từ Supabase 2024
      const aggQuery = buildFilter(
        supabase
          .from('product_stock_summary_view')
          .select('stock_on_hand.sum(), on_order_qty.sum()')
      ) as any

      const [page, agg] = await Promise.all([pageQuery, aggQuery])

      if (page.error) {
        logger.error('[useProductsList] view query error:', page.error.message)
        throw page.error
      }

      let totalStockAll = 0
      let totalOnOrderAll = 0
      if (!agg.error && agg.data && Array.isArray(agg.data) && agg.data[0]) {
        totalStockAll   = Number(agg.data[0].sum ?? agg.data[0].stock_on_hand_sum ?? 0)
        totalOnOrderAll = Number(agg.data[0].on_order_qty_sum ?? 0)
      }

      return {
        rows: (page.data ?? []) as ProductStockRow[],
        total: page.count ?? 0,
        totalStockAll,
        totalOnOrderAll,
      }
    },
    placeholderData: keepPreviousData,
  })
}

export function useProductCategories() {
  return useQuery({
    queryKey: qk.products.categories,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_categories')
        .select('id, code, name, is_active')
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60_000,
  })
}

export function useProductBrands() {
  return useQuery({
    queryKey: qk.products.brands,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('id, name, country, is_active')
        .order('name', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60_000,
  })
}
