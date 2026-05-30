import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'

export interface BranchOption {
  id: string
  code: string
  name: string
}

// Danh sách chi nhánh đang hoạt động — dùng cho bộ chọn chi nhánh ở Dashboard.
// Mọi user active đều SELECT được branches (RLS: branches_select_all_active).
export function useBranches(enabled: boolean = true) {
  return useQuery<BranchOption[]>({
    queryKey: qk.branches.all,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as BranchOption[]
    },
    staleTime: 5 * 60_000,
  })
}
