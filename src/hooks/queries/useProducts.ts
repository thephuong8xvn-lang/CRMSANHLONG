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
  branchId?: string       // Dùng cho cache isolation của từng chi nhánh
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

      // Trang hiện tại + count tổng (catalog global)
      const pageQuery = buildFilter(
        supabase
          .from('product_stock_summary_view')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(from, to)
      )

      const page = await pageQuery

      if (page.error) {
        logger.error('[useProductsList] view query error:', page.error.message)
        throw page.error
      }

      const rows = (page.data ?? []) as ProductStockRow[]

      // Nếu có chi nhánh, ghi đè tồn kho & khách đặt của từng sản phẩm trên trang
      if (params.branchId && rows.length > 0) {
        const productIds = rows.map(r => r.id)
        
        // Lấy tồn kho theo chi nhánh
        const { data: lotsData } = await supabase
          .from('stock_lots')
          .select('product_id, quantity_on_hand, warehouse:warehouses!inner(branch_id)')
          .in('product_id', productIds)
          .eq('warehouse.branch_id', params.branchId)
        
        const stockMap: Record<string, number> = {}
        lotsData?.forEach((lot: any) => {
          const pid = lot.product_id
          stockMap[pid] = (stockMap[pid] || 0) + Number(lot.quantity_on_hand || 0)
        })

        // Lấy khách đặt theo chi nhánh
        const { data: orderLinesData } = await supabase
          .from('order_lines')
          .select('product_id, quantity, order:orders!inner(branch_id, status)')
          .in('product_id', productIds)
          .eq('order.branch_id', params.branchId)
          .in('order.status', ['confirmed', 'shipping'])
        
        const orderMap: Record<string, number> = {}
        orderLinesData?.forEach((line: any) => {
          const pid = line.product_id
          orderMap[pid] = (orderMap[pid] || 0) + Number(line.quantity || 0)
        })

        // Ghi đè vào các dòng hiển thị
        rows.forEach(row => {
          row.stock_on_hand = stockMap[row.id] || 0
          row.on_order_qty = orderMap[row.id] || 0
          if (row.sold_30d > 0 && row.stock_on_hand > 0) {
            row.days_to_oos = Math.round(row.stock_on_hand / (row.sold_30d / 30.0))
          } else if (row.stock_on_hand === 0) {
            row.days_to_oos = 0
          } else {
            row.days_to_oos = null
          }
        })
      }

      let totalStockAll = 0
      let totalOnOrderAll = 0

      if (params.branchId) {
        // Tính tổng tồn kho của chi nhánh cho các sản phẩm khớp bộ lọc
        let lotQuery = supabase
          .from('stock_lots')
          .select('quantity_on_hand.sum(), product:products!inner(category_id, brand_id, is_active, name, sku)')
          .eq('warehouse:warehouses!inner(branch_id)', params.branchId)
        
        if (params.categoryId) lotQuery = lotQuery.eq('product.category_id', params.categoryId)
        if (params.brandId) lotQuery = lotQuery.eq('product.brand_id', params.brandId)
        if (params.status === 'active') lotQuery = lotQuery.eq('product.is_active', true)
        if (params.status === 'inactive') lotQuery = lotQuery.eq('product.is_active', false)
        if (params.search && params.search.trim()) {
          const term = params.search.trim().replace(/[%_]/g, '\\$&')
          lotQuery = lotQuery.or(`name.ilike.%${term}%,sku.ilike.%${term}%`, { foreignTable: 'product' })
        }
        
        const { data: lotAgg } = await lotQuery
        if (lotAgg && lotAgg[0]) {
          const item = lotAgg[0] as any
          totalStockAll = Number(item.quantity_on_hand ?? item.sum ?? 0)
        }

        // Tính tổng khách đặt của chi nhánh cho các sản phẩm khớp bộ lọc
        let orderQuery = supabase
          .from('order_lines')
          .select('quantity.sum(), product:products!inner(category_id, brand_id, is_active, name, sku)')
          .eq('order:orders!inner(branch_id, status)', params.branchId)
          .in('order.status', ['confirmed', 'shipping'])
        
        if (params.categoryId) orderQuery = orderQuery.eq('product.category_id', params.categoryId)
        if (params.brandId) orderQuery = orderQuery.eq('product.brand_id', params.brandId)
        if (params.status === 'active') orderQuery = orderQuery.eq('product.is_active', true)
        if (params.status === 'inactive') orderQuery = orderQuery.eq('product.is_active', false)
        if (params.search && params.search.trim()) {
          const term = params.search.trim().replace(/[%_]/g, '\\$&')
          orderQuery = orderQuery.or(`name.ilike.%${term}%,sku.ilike.%${term}%`, { foreignTable: 'product' })
        }

        const { data: orderAgg } = await orderQuery
        if (orderAgg && orderAgg[0]) {
          const item = orderAgg[0] as any
          totalOnOrderAll = Number(item.quantity ?? item.sum ?? 0)
        }
      } else {
        // Tính tổng toàn cục
        const aggQuery = buildFilter(
          supabase
            .from('product_stock_summary_view')
            .select('stock_on_hand.sum(), on_order_qty.sum()')
        ) as any
        const agg = await aggQuery
        if (!agg.error && agg.data && Array.isArray(agg.data) && agg.data[0]) {
          totalStockAll   = Number(agg.data[0].stock_on_hand ?? 0)
          totalOnOrderAll = Number(agg.data[0].on_order_qty ?? 0)
        }
      }

      return {
        rows,
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
