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
  vat_stock: number
  nonvat_stock: number
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
  sortBy?: 'created_at' | 'stock'
  sortDir?: 'asc' | 'desc'
}

export interface ProductListResult {
  rows: ProductStockRow[]
  total: number
  // Sum tổng tồn / khách đặt của TOÀN BỘ filtered set (không chỉ trang hiện tại)
  // - dùng query phụ vì PostgREST không trả aggregate ngoài count
  totalStockAll: number
  totalOnOrderAll: number
}

/** Tham số gọi RPC fn_products_list — dùng chung cho danh sách + export CSV. */
export function buildProductsListRpcArgs(params: ProductListParams) {
  return {
    p_page:        params.page,
    p_page_size:   params.pageSize,
    p_search:      params.search?.trim() || null,
    p_category_id: params.categoryId || null,
    p_brand_id:    params.brandId || null,
    p_status:      params.status ?? 'active',
    p_branch_id:   params.branchId || null,
    p_sort_by:     params.sortBy ?? 'created_at',
    p_sort_dir:    params.sortDir ?? 'desc',
  }
}

export function useProductsList(params: ProductListParams) {
  return useQuery({
    queryKey: qk.products.list(params),
    queryFn: async (): Promise<ProductListResult> => {
      // 1 round-trip: RPC tính trang + count + tổng filtered + tồn theo chi nhánh
      // (kèm sort server-side theo tồn kho đúng chi nhánh) ở Postgres.
      const { data, error } = await supabase.rpc('fn_products_list', buildProductsListRpcArgs(params))

      if (error) {
        logger.error('[useProductsList] rpc error:', error.message)
        throw error
      }

      const result = (data ?? {}) as {
        rows?: ProductStockRow[]
        total?: number
        total_stock?: number
        total_on_order?: number
      }

      return {
        rows: (result.rows ?? []).map(r => ({
          ...r,
          stock_on_hand: Number(r.stock_on_hand ?? 0),
          on_order_qty:  Number(r.on_order_qty ?? 0),
          vat_stock:     Number(r.vat_stock ?? 0),
          nonvat_stock:  Number(r.nonvat_stock ?? 0),
        })),
        total: Number(result.total ?? 0),
        totalStockAll: Number(result.total_stock ?? 0),
        totalOnOrderAll: Number(result.total_on_order ?? 0),
      }
    },
    placeholderData: keepPreviousData,
  })
}

// ───────────────────────── Quick View (inline) ─────────────────────────
// Các hook bên dưới chỉ chạy khi panel xem nhanh được mở (enabled), tránh
// fetch thừa cho cả trang danh sách.

export interface ProductLotRow {
  id: string
  lot_number: string
  manufacture_date: string | null
  expiry_date: string | null
  quantity_on_hand: number
  quantity_reserved: number
  cost_price: number
  status: string
  received_at: string
  warehouses: { id: string; code: string; name: string } | null
}

export interface ProductMovementRow {
  id: string
  created_at: string
  movement_type: string
  quantity: number
  unit_cost: number | null
  notes: string | null
  lot_number: string | null
  warehouse_code: string | null
  warehouse_name: string | null
  performer_name: string | null
  /** 'order' | 'goods_receipt' | 'purchase_return' | 'sales_return' | 'transfer' | ... */
  ref_type: string | null
  ref_id: string | null
  /** Mã chứng từ: order_code / receipt_code / return_code / transfer_code */
  ref_code: string | null
  /** Tên KH (bán/khách trả) hoặc NCC (nhập/trả NCC) — NULL nếu không có hoặc bị RLS chặn */
  partner_name: string | null
  /** Giá giao dịch: đơn giá thực bán (sale) hoặc giá nhập/xuất (unit_cost) */
  txn_price: number | null
  /** Nhóm giá (bảng giá) của đơn bán */
  price_list_name: string | null
}

/** Lô hàng của 1 sản phẩm, lọc theo chi nhánh khi có branchId. */
export function useProductLots(productId: string, branchId?: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.products.lots(productId, branchId),
    enabled: enabled && !!productId,
    queryFn: async (): Promise<ProductLotRow[]> => {
      let q = supabase
        .from('stock_lots')
        .select(`
          id, lot_number, manufacture_date, expiry_date,
          quantity_on_hand, quantity_reserved, cost_price, status, received_at,
          warehouses:warehouses!inner(id, code, name, branch_id)
        `)
        .eq('product_id', productId)
      if (branchId) q = q.eq('warehouses.branch_id', branchId)
      const { data, error } = await q.order('expiry_date', { ascending: true })
      if (error) {
        logger.error('[useProductLots] error:', error.message)
        throw error
      }
      return (data ?? []) as unknown as ProductLotRow[]
    },
  })
}

/** Thẻ kho của 1 sản phẩm (RPC enrich: đối tượng GD + giá GD + nhóm giá), lọc theo chi nhánh. */
export function useProductMovements(productId: string, branchId?: string | null, enabled = true, limit = 50) {
  return useQuery({
    queryKey: qk.products.movements(productId, branchId),
    enabled: enabled && !!productId,
    queryFn: async (): Promise<ProductMovementRow[]> => {
      const { data, error } = await supabase.rpc('fn_product_movements', {
        p_product_id: productId,
        p_branch_id: branchId || null,
        p_limit: limit,
      })
      if (error) {
        logger.error('[useProductMovements] rpc error:', error.message)
        throw error
      }
      return ((data ?? []) as ProductMovementRow[]).map(m => ({
        ...m,
        quantity: Number(m.quantity ?? 0),
        txn_price: m.txn_price !== null ? Number(m.txn_price) : null,
      }))
    },
  })
}

/** Khuyến mãi theo hàng hóa của 1 sản phẩm (chỉ đọc trong quick view). */
export function useProductPromotionsList(productId: string, enabled = true) {
  return useQuery({
    queryKey: qk.products.promotions(productId),
    enabled: enabled && !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_promotions')
        .select('*')
        .eq('product_id', productId)
        .order('priority', { ascending: false })
      if (error) {
        logger.error('[useProductPromotionsList] error:', error.message)
        throw error
      }
      return data ?? []
    },
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
