import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryClient'
import { logger } from '../lib/logger'
import type { ColumnMap } from '../lib/gdriveMapping'
import { normalizeAlias } from '../lib/gdriveMapping'

// ── Kiểu dữ liệu ──
export interface GdriveSource {
  id: string
  supplier_id: string
  supplier_name: string
  label: string
  drive_folder_id: string
  default_warehouse_id: string | null
  header_row: number
  data_start_row: number
  column_map: ColumnMap
  vat_default: 'none' | '5' | '10'
  is_active: boolean
}

export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
}

export interface SheetTab {
  title: string
  rows: number
  cols: number
}

export interface ProductAlias {
  id: string
  supplier_id: string
  external_name: string
  external_name_norm: string
  product_id: string
}

// Gọi Edge Function gdrive-proxy (credential service account ở backend)
async function invokeProxy<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('gdrive-proxy', { body })
  if (error) {
    // Cố lấy thông điệp lỗi chi tiết từ response
    let msg = error.message
    try {
      const ctx = (error as any).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        if (j?.error) msg = j.error
      }
    } catch { /* ignore */ }
    logger.error('[gdrive-proxy]', msg)
    throw new Error(msg)
  }
  if ((data as any)?.error) throw new Error((data as any).error)
  return data as T
}

// ── Nguồn Drive đã cấu hình ──
export function useGdriveSources(activeOnly = true) {
  return useQuery<GdriveSource[]>({
    queryKey: qk.gdrive.sources,
    queryFn: async () => {
      let q = supabase
        .from('gdrive_sources')
        .select('id, supplier_id, label, drive_folder_id, default_warehouse_id, header_row, data_start_row, column_map, vat_default, is_active, supplier:suppliers(name)')
        .order('label', { ascending: true })
      if (activeOnly) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) { logger.error('[useGdriveSources]', error.message); throw error }
      return (data ?? []).map((s: any) => ({
        id: s.id,
        supplier_id: s.supplier_id,
        supplier_name: s.supplier?.name || '—',
        label: s.label,
        drive_folder_id: s.drive_folder_id,
        default_warehouse_id: s.default_warehouse_id,
        header_row: s.header_row,
        data_start_row: s.data_start_row,
        column_map: s.column_map || {},
        vat_default: s.vat_default || '5',
        is_active: s.is_active,
      }))
    },
  })
}

// ── Email service account (để nhắc user share thư mục đúng tài khoản) ──
export function useGdriveSaEmail() {
  return useQuery<string>({
    queryKey: qk.gdrive.saEmail,
    staleTime: 60 * 60_000, // gần như tĩnh
    queryFn: async () => {
      const r = await invokeProxy<{ sa_email: string }>({ action: 'whoami' })
      return r.sa_email ?? ''
    },
  })
}

// ── Danh sách file Sheet trong thư mục source ──
export function useDriveFiles(sourceId: string | null) {
  return useQuery<DriveFile[]>({
    queryKey: sourceId ? qk.gdrive.files(sourceId) : ['gdrive', 'files', 'none'],
    enabled: !!sourceId,
    staleTime: 30_000,
    queryFn: async () => {
      const r = await invokeProxy<{ files: DriveFile[] }>({ action: 'list-files', source_id: sourceId })
      return r.files ?? []
    },
  })
}

// ── Thông tin tab của 1 file ──
export function useSheetInfo(sourceId: string | null, fileId: string | null) {
  return useQuery<{ title: string; tabs: SheetTab[] }>({
    queryKey: fileId ? qk.gdrive.sheetInfo(fileId) : ['gdrive', 'sheet-info', 'none'],
    enabled: !!sourceId && !!fileId,
    queryFn: async () => invokeProxy({ action: 'sheet-info', source_id: sourceId, file_id: fileId }),
  })
}

// ── Giá trị toàn bộ 1 tab ──
export function useSheetValues(sourceId: string | null, fileId: string | null, tab: string | null) {
  return useQuery<any[][]>({
    queryKey: fileId && tab ? qk.gdrive.sheet(fileId, tab) : ['gdrive', 'sheet', 'none'],
    enabled: !!sourceId && !!fileId && !!tab,
    staleTime: 0,
    queryFn: async () => {
      const r = await invokeProxy<{ values: any[][] }>({ action: 'read-sheet', source_id: sourceId, file_id: fileId, tab })
      return r.values ?? []
    },
  })
}

// ── Ghi ngược các ô lên Sheet (2 chiều) ──
export function useWriteCells() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { sourceId: string; fileId: string; tab: string; updates: { range: string; values: any[][] }[] }) => {
      return invokeProxy<{ ok: boolean; updatedCells: number }>({
        action: 'write-cells', source_id: vars.sourceId, file_id: vars.fileId, updates: vars.updates,
      })
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.gdrive.sheet(vars.fileId, vars.tab) })
    },
  })
}

// ── Bí danh SP theo NCC ──
export function useProductAliases(supplierId: string | null) {
  return useQuery<ProductAlias[]>({
    queryKey: supplierId ? qk.gdrive.aliases(supplierId) : ['gdrive', 'aliases', 'none'],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gdrive_product_aliases')
        .select('id, supplier_id, external_name, external_name_norm, product_id')
        .eq('supplier_id', supplierId)
      if (error) { logger.error('[useProductAliases]', error.message); throw error }
      return data ?? []
    },
  })
}

// ── Kiểm tra lô đã tồn tại (chống nhập trùng theo SP + lô + HSD) ──
export interface ExistingLotHit {
  product_id: string
  lot_number: string
  expiry_date: string
  in_stock: boolean
  stock_warehouse: string | null
  in_draft: boolean
  draft_receipt_code: string | null
  draft_status: string | null
  draft_by: string | null
}

export async function checkExistingLots(
  items: { product_id: string; lot_number: string; expiry_date: string }[],
): Promise<ExistingLotHit[]> {
  if (items.length === 0) return []
  const { data, error } = await supabase.rpc('fn_check_existing_lots', { p_items: items })
  if (error) { logger.error('[checkExistingLots]', error.message); throw error }
  return (data as ExistingLotHit[]) ?? []
}

// Lưu (upsert) bí danh tên → product_id
export function useUpsertAlias() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { supplierId: string; externalName: string; productId: string; userId?: string | null }) => {
      const norm = normalizeAlias(vars.externalName)
      const { error } = await supabase
        .from('gdrive_product_aliases')
        .upsert({
          supplier_id: vars.supplierId,
          external_name: vars.externalName,
          external_name_norm: norm,
          product_id: vars.productId,
          created_by: vars.userId ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'supplier_id,external_name_norm' })
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.gdrive.aliases(vars.supplierId) })
    },
  })
}
