import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

export interface UserRoleInfo {
  role: { code: string; name: string }
  permissions: string[]   // danh sách permission codes
}

// useUserRolePermissions – tải 1 lần khi có user.id, cache lâu.
// Layout/menu/route guard đều đọc qua cache thay vì fetch lại.
//
// Fallback: nếu RPC get_user_role_and_permissions chưa được apply
// (migration 20260526000000_perf_views.sql chưa chạy ở remote DB),
// rơi về 2 query truyền thống trên user_roles + role_permissions.
export function useUserRolePermissions(userId: string | null | undefined) {
  return useQuery({
    queryKey: userId ? qk.auth.rolePermissions(userId) : ['auth', 'role-permissions', 'none'],
    enabled: !!userId,
    queryFn: async (): Promise<UserRoleInfo> => {
      // 1. Thử RPC trước
      const rpcRes = await supabase.rpc('get_user_role_and_permissions', { p_user_id: userId })

      if (!rpcRes.error && rpcRes.data) {
        const safe = rpcRes.data as { role?: { code: string; name: string }; permissions?: string[] } | null
        return {
          role:        safe?.role        ?? { code: 'guest', name: 'Khách' },
          permissions: safe?.permissions ?? [],
        }
      }

      // 2. RPC chưa có → fallback query trực tiếp
      logger.warn('[useUserRolePermissions] RPC unavailable, fallback to direct queries:', rpcRes.error?.message)

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role:roles(code, name)')
        .eq('user_id', userId!)
        .limit(1)
        .maybeSingle()

      const role = (roleData?.role as unknown as { code: string; name: string } | null)
        ?? { code: 'guest', name: 'Khách' }

      const { data: permData } = await supabase
        .from('user_roles')
        .select(`
          role:roles(
            role_permissions!role_permissions_role_id_fkey(
              permission:permissions!role_permissions_permission_id_fkey(code)
            )
          )
        `)
        .eq('user_id', userId!)

      const perms = new Set<string>()
      ;(permData ?? []).forEach((ur: any) => {
        ur?.role?.role_permissions?.forEach((rp: any) => {
          const code = rp?.permission?.code
          if (code) perms.add(code)
        })
      })

      return { role, permissions: Array.from(perms) }
    },
    staleTime: 15 * 60_000,
    gcTime:    30 * 60_000,
  })
}
