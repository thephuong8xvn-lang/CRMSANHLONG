import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryClient'
import { logger } from '../lib/logger'

// ── Cấu hình thuế doanh nghiệp (markup + tỷ lệ thuế trên lợi nhuận) ──
export interface VatConfig { markup_rate: number; tax_share: number }

export function useVatConfig() {
  return useQuery<VatConfig>({
    queryKey: qk.vat.config,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings').select('value').eq('key', 'vat_config').maybeSingle()
      if (error) { logger.error('[useVatConfig]', error.message); throw error }
      const v = (data?.value as Partial<VatConfig>) || {}
      return { markup_rate: v.markup_rate ?? 0.07, tax_share: v.tax_share ?? 0.5 }
    },
  })
}

// ── Danh sách hàng VAT đã bán, chờ xuất hóa đơn ──
export interface VatPendingSale {
  id: string
  order_id: string
  order_code: string | null
  order_line_id: string
  product_id: string
  product_name: string | null
  quantity: number
  unit_price: number
  line_amount: number
  vat_rate: number
  sold_at: string
  customer_id: string | null
  customer_name: string | null
  status: string
}

export function useVatPendingSales(from: string, to: string) {
  return useQuery<VatPendingSale[]>({
    queryKey: qk.vat.pending(from, to),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_vat_pending_sales', { p_from: from, p_to: to })
      if (error) { logger.error('[useVatPendingSales]', error.message); throw error }
      return (data as VatPendingSale[]) ?? []
    },
  })
}

// ── Lịch sử phiếu xuất VAT ──
export interface VatIssuance {
  id: string
  invoice_no: string | null
  issue_date: string
  buyer_name: string | null
  buyer_tax_code: string | null
  subtotal: number
  vat_amount: number
  total: number
  status: string
  note: string | null
  created_at: string
}

export function useVatIssuances() {
  return useQuery<VatIssuance[]>({
    queryKey: qk.vat.issuances,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vat_issuances')
        .select('id, invoice_no, issue_date, buyer_name, buyer_tax_code, subtotal, vat_amount, total, status, note, created_at')
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) { logger.error('[useVatIssuances]', error.message); throw error }
      return (data as VatIssuance[]) ?? []
    },
  })
}

// ── Tồn hàng VAT (lọc fn_products_list chỉ SP có tồn VAT) ──
export interface VatStockRow {
  id: string
  name: string
  sku: string
  unit: string
  vat_stock: number
  nonvat_stock: number
}

export function useVatStock(branchId: string | null) {
  return useQuery<VatStockRow[]>({
    queryKey: [...qk.vat.stock, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_products_list', {
        p_page: 1, p_page_size: 5000, p_search: null, p_category_id: null,
        p_brand_id: null, p_status: 'active', p_branch_id: branchId,
        p_sort_by: 'stock', p_sort_dir: 'desc',
      })
      if (error) { logger.error('[useVatStock]', error.message); throw error }
      const rows = ((data as any)?.rows ?? []) as any[]
      return rows
        .filter((r) => Number(r.vat_stock) > 0)
        .map((r) => ({
          id: r.id, name: r.name, sku: r.sku || '', unit: r.unit || '',
          vat_stock: Number(r.vat_stock) || 0, nonvat_stock: Number(r.nonvat_stock) || 0,
        }))
    },
  })
}

// ── Xuất / gộp hóa đơn VAT ──
export function useVatIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      saleIds: string[]; invoiceNo: string; issueDate: string
      buyerName?: string; buyerTaxCode?: string; buyerAddress?: string; note?: string
    }) => {
      const { data, error } = await supabase.rpc('fn_vat_issue', {
        p_sale_ids: vars.saleIds,
        p_invoice_no: vars.invoiceNo,
        p_issue_date: vars.issueDate,
        p_buyer_name: vars.buyerName ?? null,
        p_buyer_tax_code: vars.buyerTaxCode ?? null,
        p_buyer_address: vars.buyerAddress ?? null,
        p_note: vars.note ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vat', 'pending'] })
      qc.invalidateQueries({ queryKey: qk.vat.issuances })
    },
  })
}
