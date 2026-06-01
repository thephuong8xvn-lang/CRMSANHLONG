import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

export interface HerdProjectRow {
  id: string
  project_code: string
  name: string
  status: 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled'
  start_date: string | null
  end_date: string | null
  head_count: number
  created_at: string
  customer_id: string | null
  customer_name: string | null
  province: string | null
  district: string | null
  farm_id: string | null
  farm_name: string | null
  herd_id: string | null
  species_id: string | null
  species_name: string | null
  breed: string | null
  entry_date: string | null
  expected_exit_date: string | null
  project_type_id: string | null
  project_type_name: string | null
  owner_user_id: string | null
  owner_name: string | null
  team_id: string | null
  age_days: number | null
  member_count: number
  cost_to_date: number
  died_total: number
  mortality_rate: number
  region_id: string | null
  region_name: string | null
}

export interface HerdProjectListParams {
  page: number
  pageSize: number
  search?: string
  customerId?: string
  speciesId?: string
  status?: string
  projectTypeId?: string
  ownerId?: string
  province?: string
  regionId?: string
  fromDate?: string        // start_date >=
  toDate?: string          // start_date <=
  headCountMin?: number
  headCountMax?: number
}

export interface HerdProjectListResult {
  rows: HerdProjectRow[]
  total: number
}

export function useHerdProjectsList(params: HerdProjectListParams) {
  return useQuery({
    queryKey: qk.herdProjects.list(params),
    queryFn: async (): Promise<HerdProjectListResult> => {
      const from = (params.page - 1) * params.pageSize
      const to = from + params.pageSize - 1

      let q = supabase
        .from('herd_project_list_view')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (params.customerId)    q = q.eq('customer_id', params.customerId)
      if (params.speciesId)     q = q.eq('species_id', params.speciesId)
      if (params.status)        q = q.eq('status', params.status)
      if (params.projectTypeId) q = q.eq('project_type_id', params.projectTypeId)
      if (params.ownerId)       q = q.eq('owner_user_id', params.ownerId)
      if (params.province)      q = q.eq('province', params.province)
      if (params.regionId)      q = q.eq('region_id', params.regionId)
      if (params.fromDate)      q = q.gte('start_date', params.fromDate)
      if (params.toDate)        q = q.lte('start_date', params.toDate)
      if (params.headCountMin != null) q = q.gte('head_count', params.headCountMin)
      if (params.headCountMax != null) q = q.lte('head_count', params.headCountMax)
      if (params.search && params.search.trim()) {
        const term = params.search.trim().replace(/[%_]/g, '\\$&')
        q = q.or(`name.ilike.%${term}%,project_code.ilike.%${term}%,customer_name.ilike.%${term}%`)
      }

      const { data, error, count } = await q
      if (error) {
        logger.error('[useHerdProjectsList] error:', error.message)
        throw error
      }
      return { rows: (data ?? []) as HerdProjectRow[], total: count ?? 0 }
    },
    placeholderData: keepPreviousData,
  })
}

export function useHerdProjectTypes() {
  return useQuery({
    queryKey: qk.herdProjects.types,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('herd_project_types')
        .select('id, code, name, species_id, is_active')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60_000,
  })
}

export function useSpeciesList(activeOnly = true) {
  return useQuery({
    queryKey: [...qk.herdProjects.species, activeOnly],
    queryFn: async () => {
      let q = supabase.from('species').select('id, name, category, is_active').order('name')
      if (activeOnly) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60_000,
  })
}

export function useHerdRegions(activeOnly = true) {
  return useQuery({
    queryKey: [...qk.herdProjects.regions, activeOnly],
    queryFn: async () => {
      let q = supabase.from('herd_regions').select('id, name, code, is_active, sort_order').order('sort_order').order('name')
      if (activeOnly) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60_000,
  })
}

// ── Detail: thành viên + chi phí ──
export interface HerdMemberRow {
  id: string
  project_id: string
  user_id: string
  role: 'viewer' | 'collaborator' | 'manager'
  created_at: string
  profile?: { full_name: string; avatar_url: string | null; branch_id: string | null } | null
}

export function useHerdProjectMembers(projectId: string, enabled = true) {
  return useQuery({
    queryKey: qk.herdProjects.members(projectId),
    enabled: enabled && !!projectId,
    queryFn: async (): Promise<HerdMemberRow[]> => {
      const { data, error } = await supabase
        .from('herd_project_members')
        .select('id, project_id, user_id, role, created_at, profile:profiles!user_id(full_name, avatar_url, branch_id)')
        .eq('project_id', projectId)
        .order('created_at')
      if (error) { logger.error('[useHerdProjectMembers]', error.message); throw error }
      return (data ?? []) as unknown as HerdMemberRow[]
    },
  })
}

export interface HerdCostRow {
  id: string
  project_id: string
  step_id: string | null
  cost_type: string
  product_id: string | null
  quantity: number
  unit_cost: number
  amount: number
  incurred_date: string
  notes: string | null
  created_at: string
  product?: { name: string; sku: string; unit: string } | null
}

export function useHerdProjectCosts(projectId: string, enabled = true) {
  return useQuery({
    queryKey: qk.herdProjects.costs(projectId),
    enabled: enabled && !!projectId,
    queryFn: async (): Promise<HerdCostRow[]> => {
      const { data, error } = await supabase
        .from('herd_project_costs')
        .select('id, project_id, step_id, cost_type, product_id, quantity, unit_cost, amount, incurred_date, notes, created_at, product:products(name, sku, unit)')
        .eq('project_id', projectId)
        .order('incurred_date', { ascending: false })
      if (error) { logger.error('[useHerdProjectCosts]', error.message); throw error }
      return (data ?? []) as unknown as HerdCostRow[]
    },
  })
}

// ── Overview: công việc sắp tới (RPC SECURITY DEFINER — mọi user thấy) ──
export interface UpcomingHerdTask {
  step_id: string
  project_id: string
  project_code: string
  project_name: string
  customer_name: string | null
  step_name: string
  planned_date: string
  assigned_to: string | null
  assigned_name: string | null
  days_left: number
}

export function useUpcomingHerdTasks(days = 7, enabled = true) {
  return useQuery({
    queryKey: qk.herdProjects.upcomingTasks(days),
    enabled,
    queryFn: async (): Promise<UpcomingHerdTask[]> => {
      const { data, error } = await supabase.rpc('fn_upcoming_herd_tasks', { p_days: days })
      if (error) { logger.error('[useUpcomingHerdTasks]', error.message); throw error }
      return (data ?? []) as UpcomingHerdTask[]
    },
    staleTime: 2 * 60_000,
  })
}

// ── Overview: thống kê tổng quan (RLS scoped qua view) ──
export interface HerdOverviewStats {
  activeCount: number
  totalHeadActive: number
  memberTotal: number
  avgMortality: number
  projectTotal: number
}

export function useHerdOverviewStats(enabled = true) {
  return useQuery({
    queryKey: qk.herdProjects.overview,
    enabled,
    queryFn: async (): Promise<HerdOverviewStats> => {
      const { data, error } = await supabase
        .from('herd_project_list_view')
        .select('status, head_count, member_count, mortality_rate')
      if (error) { logger.error('[useHerdOverviewStats]', error.message); throw error }
      const rows = (data ?? []) as { status: string; head_count: number; member_count: number; mortality_rate: number }[]
      const active = rows.filter(r => r.status === 'active')
      const mortalityVals = rows.filter(r => Number(r.mortality_rate) > 0).map(r => Number(r.mortality_rate))
      return {
        projectTotal: rows.length,
        activeCount: active.length,
        totalHeadActive: active.reduce((s, r) => s + (r.head_count || 0), 0),
        memberTotal: rows.reduce((s, r) => s + (r.member_count || 0), 0),
        avgMortality: mortalityVals.length ? Number((mortalityVals.reduce((s, v) => s + v, 0) / mortalityVals.length).toFixed(2)) : 0,
      }
    },
    staleTime: 2 * 60_000,
  })
}

// ── Overview: ý kiến khách hàng (gộp outcomes hoàn thành + đánh giá theo bước) ──
export interface HerdFeedbackItem {
  id: string
  source: 'outcome' | 'step'
  rating: number
  comment: string
  projectId: string
  projectName: string
  customerName: string | null
  at: string
}

export function useHerdCustomerFeedback(limit = 6, enabled = true) {
  return useQuery({
    queryKey: qk.herdProjects.feedback(limit),
    enabled,
    queryFn: async (): Promise<HerdFeedbackItem[]> => {
      const [outRes, stepRes] = await Promise.all([
        supabase
          .from('herd_project_outcomes')
          .select('id, project_id, notes, created_at, project:herd_projects(name, customer:customers(farm_name))')
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('herd_project_steps')
          .select('id, project_id, step_name, customer_rating, customer_rating_note, updated_at, project:herd_projects(name, customer:customers(farm_name))')
          .not('customer_rating', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(limit),
      ])
      if (outRes.error) logger.error('[useHerdCustomerFeedback/out]', outRes.error.message)
      if (stepRes.error) logger.error('[useHerdCustomerFeedback/step]', stepRes.error.message)

      const items: HerdFeedbackItem[] = []
      for (const o of (outRes.data ?? []) as any[]) {
        let rating = 0, comment = ''
        try { const j = JSON.parse(o.notes || '{}'); rating = Number(j.rating) || 0; comment = j.comment || '' } catch { /* ignore */ }
        if (rating > 0 || comment) {
          items.push({
            id: `out-${o.id}`, source: 'outcome', rating, comment,
            projectId: o.project_id, projectName: o.project?.name || '',
            customerName: o.project?.customer?.farm_name ?? null, at: o.created_at,
          })
        }
      }
      for (const s of (stepRes.data ?? []) as any[]) {
        items.push({
          id: `step-${s.id}`, source: 'step', rating: Number(s.customer_rating) || 0,
          comment: s.customer_rating_note || s.step_name || '',
          projectId: s.project_id, projectName: s.project?.name || '',
          customerName: s.project?.customer?.farm_name ?? null, at: s.updated_at,
        })
      }
      return items.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit)
    },
    staleTime: 2 * 60_000,
  })
}
