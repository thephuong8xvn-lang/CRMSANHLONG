import { useCallback } from 'react'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { logger } from '../../lib/logger'

// ─────────────────────────────────────────────────────────────
// Module Quản lý Công nợ — lớp dữ liệu.
//
// Nguồn sự thật DUY NHẤT là `customer_debts` (qua các RPC của migration
// 20260753). ⚠️ KHÔNG dùng `orders.debt_amount` ở đây: cột đó không được cập
// nhật khi thu nợ qua fn_collect_customer_debt nên đang lệch với sổ cái.
// ─────────────────────────────────────────────────────────────

export const debtKeys = {
  all: ['debts'] as const,
  overview: ['debts', 'overview'] as const,
  ledger: (p: object) => ['debts', 'ledger', p] as const,
  detail: (id: string) => ['debts', 'detail', id] as const,
  suppliers: ['debts', 'suppliers'] as const,
}

// ── Tổng quan ────────────────────────────────────────────────
export interface DebtKpi {
  du_no_rong: number
  no_goc: number
  tra_truoc: number
  so_kh_no: number
  qua_han: number
  qua_han_dong: number
  so_kh_qua_han: number
  den_han_7n: number
  den_han_7n_dong: number
  khong_han: number
  khong_han_dong: number
  so_kh_khong_han: number
  thu_thang_nay: number
  thu_30n: number
  no_moi_30n: number
  doanh_thu_90n: number
  dso: number | null
  ty_le_qua_han: number
}

export interface DebtAgingBucket {
  thu_tu: number
  nhan: string
  so_dong: number
  so_tien: number
  so_kh: number
}

export interface DebtTrendPoint {
  thang: string
  no_moi: number
  thu_ve: number
}

export interface DebtStaffRow {
  owner_id: string | null
  nhan_vien: string
  chi_nhanh: string
  so_kh_no: number
  so_kh_qua_han: number
  du_no: number
  qua_han: number
  khong_han: number
  ty_le_qua_han: number
  thu_30n: number
}

export interface DebtCallRow {
  customer_id: string
  code: string | null
  ten: string
  dien_thoai: string | null
  nhan_vien: string
  du_no: number
  qua_han: number
  han_cu_nhat: string | null
  so_ngay_qua_han: number | null
  lan_thu_gan_nhat: string | null
  uu_tien: number
}

export interface DebtOverview {
  as_of: string
  kpi: DebtKpi
  aging: DebtAgingBucket[]
  trend: DebtTrendPoint[]
  by_staff: DebtStaffRow[]
  call_list: DebtCallRow[]
}

export function useDebtOverview() {
  return useQuery<DebtOverview>({
    queryKey: debtKeys.overview,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_debt_overview')
      if (error) { logger.error('fn_debt_overview', error); throw error }
      return data as DebtOverview
    },
  })
}

// ── Sổ chi tiết theo khách ───────────────────────────────────
export type DebtBucket = 'all' | 'overdue' | 'due_soon' | 'no_duedate' | 'current' | 'advance'
export type DebtSort = 'du_no' | 'qua_han' | 'cu_nhat' | 'ten'

export interface DebtLedgerRow {
  customer_id: string
  code: string | null
  ten: string
  dien_thoai: string | null
  nhan_vien: string
  chi_nhanh: string
  du_no: number
  qua_han: number
  den_han_7n: number
  chua_den_han: number
  khong_han: number
  tra_truoc: number
  han_cu_nhat: string | null
  so_ngay_qua_han: number | null
  so_dong: number
  credit_limit: number
  ty_le_dung_han_muc: number | null
  lan_thu_gan_nhat: string | null
  mua_gan_nhat: string | null
  tong_du_no: number
  tong_qua_han: number
  tong_so_kh: number
}

export interface DebtLedgerParams {
  search?: string
  bucket?: DebtBucket
  ownerId?: string | null
  sort?: DebtSort
  page: number
  pageSize: number
}

export interface DebtLedgerResult {
  rows: DebtLedgerRow[]
  total: number
  tongDuNo: number
  tongQuaHan: number
}

export function useDebtLedger(params: DebtLedgerParams) {
  return useQuery<DebtLedgerResult>({
    queryKey: debtKeys.ledger(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_debt_ledger', {
        p_search: params.search?.trim() || null,
        p_bucket: params.bucket ?? 'all',
        p_owner_id: params.ownerId || null,
        p_sort: params.sort ?? 'du_no',
        p_limit: params.pageSize,
        p_offset: (params.page - 1) * params.pageSize,
      })
      if (error) { logger.error('fn_debt_ledger', error); throw error }
      const rows = (data ?? []) as DebtLedgerRow[]
      // Tổng của TOÀN BỘ tập lọc đi kèm mỗi dòng (SUM() OVER ()) → lấy dòng đầu.
      return {
        rows,
        total: rows.length ? Number(rows[0].tong_so_kh) : 0,
        tongDuNo: rows.length ? Number(rows[0].tong_du_no) : 0,
        tongQuaHan: rows.length ? Number(rows[0].tong_qua_han) : 0,
      }
    },
  })
}

/**
 * Lấy TOÀN BỘ dòng của bộ lọc hiện tại (không phân trang) để xuất Excel.
 * Đi đòi nợ thì phải cầm cả danh sách, không phải mỗi trang đang xem.
 * Chặn trên 5.000 dòng cho an toàn — thực tế chỉ ~100 khách còn nợ.
 */
export const DEBT_EXPORT_CAP = 5000

export async function fetchDebtLedgerAll(
  params: Omit<DebtLedgerParams, 'page' | 'pageSize'>,
): Promise<DebtLedgerRow[]> {
  const { data, error } = await supabase.rpc('fn_debt_ledger', {
    p_search: params.search?.trim() || null,
    p_bucket: params.bucket ?? 'all',
    p_owner_id: params.ownerId || null,
    p_sort: params.sort ?? 'du_no',
    p_limit: DEBT_EXPORT_CAP,
    p_offset: 0,
  })
  if (error) { logger.error('fn_debt_ledger(export)', error); throw error }
  return (data ?? []) as DebtLedgerRow[]
}

// ── Bung dòng: từng khoản nợ + lịch sử thu ───────────────────
export interface DebtLine {
  id: string
  so_tien: number
  han_tra: string | null
  ghi_ngay: string
  so_ngay_qua_han: number | null
  tuoi_ngay: number
  loai: string
  ma_don: string | null
  order_id: string | null
  ghi_chu: string
  nguoi_lap: string
}

export interface DebtPaymentRow {
  id: string
  so_tien: number
  ngay_thu: string
  hinh_thuc: string
  tham_chieu: string
  ghi_chu: string
  nguoi_thu: string
  chi_nhanh: string
}

export interface DebtDetail {
  lines: DebtLine[]
  payments: DebtPaymentRow[]
  settled_recent: { so_tien: number; tat_toan: string | null; ma_don: string | null }[]
}

export function useCustomerDebtDetail(customerId: string | null) {
  return useQuery<DebtDetail>({
    queryKey: debtKeys.detail(customerId ?? ''),
    enabled: !!customerId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_customer_debt_detail', {
        p_customer_id: customerId,
      })
      if (error) { logger.error('fn_customer_debt_detail', error); throw error }
      return data as DebtDetail
    },
  })
}

// ── Nợ nhà cung cấp (chỉ xem) ────────────────────────────────
export interface SupplierDebtRow {
  id: string
  code: string | null
  ten: string
  phai_tra: number
  dieu_khoan: string
  dang_hop_tac: boolean
  da_nhap: number
  so_phieu_nhap: number
  nhap_gan_nhat: string | null
  tra_hang: number
  da_thanh_toan: number
  tra_gan_nhat: string | null
}

export interface SupplierDebtOverview {
  kpi: {
    tong_phai_tra: number
    so_ncc_con_no: number
    so_ncc: number
    tong_da_nhap: number
    tong_tra_hang: number
    tong_da_thanh_toan: number
    so_phieu_thanh_toan: number
  }
  rows: SupplierDebtRow[]
}

export function useSupplierDebts(enabled: boolean) {
  return useQuery<SupplierDebtOverview>({
    queryKey: debtKeys.suppliers,
    enabled,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_supplier_debt_overview')
      if (error) { logger.error('fn_supplier_debt_overview', error); throw error }
      return data as SupplierDebtOverview
    },
  })
}

/**
 * Làm mới toàn bộ module sau khi thu nợ (số liệu ở cả 3 tab đều đổi).
 * ⚠️ Phải bọc useCallback: hàm này được dùng làm dependency của
 * `useRealtimeTable`. Trả về arrow function mới mỗi render sẽ khiến kênh
 * realtime bị hủy và đăng ký lại liên tục.
 */
export function useRefreshDebts() {
  const qc = useQueryClient()
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: debtKeys.all })
    qc.invalidateQueries({ queryKey: ['customers'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }, [qc])
}
