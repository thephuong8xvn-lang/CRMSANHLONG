import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queryClient'
import { logger } from '../../lib/logger'

export interface UserRoleInfo {
  role: { code: string; name: string }   // role "đại diện" (ưu tiên admin→ceo) — chỉ để hiển thị
  roleCodes: string[]                     // TẤT CẢ role codes của user (1 user có thể nhiều role)
  permissions: string[]                   // danh sách permission codes (hợp nhất mọi role)
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
      // RPC `get_user_role_and_permissions` chỉ trả về 1 role "đại diện" (LIMIT 1)
      // nhưng permissions là hợp nhất mọi role. Để gating theo role chính xác cho
      // user NHIỀU role (vd accountant + sales), ta LUÔN lấy thêm danh sách đầy đủ
      // role codes song song (query nhẹ, cache 15').
      const [rpcRes, rolesRes] = await Promise.all([
        supabase.rpc('get_user_role_and_permissions', { p_user_id: userId }),
        supabase.from('user_roles').select('role:roles(code, name)').eq('user_id', userId!),
      ])

      const rolesList = (rolesRes.data ?? [])
        .map((ur: any) => ur.role)
        .filter(Boolean) as { code: string; name: string }[]
      const roleCodes = rolesList.map(r => r.code)

      // 1. RPC sẵn → dùng role/permissions của RPC, kèm roleCodes đầy đủ.
      if (!rpcRes.error && rpcRes.data) {
        const safe = rpcRes.data as { role?: { code: string; name: string }; permissions?: string[] } | null
        return {
          role:        safe?.role        ?? rolesList[0] ?? { code: 'guest', name: 'Khách' },
          roleCodes,
          permissions: safe?.permissions ?? [],
        }
      }

      // 2. RPC chưa có → fallback query trực tiếp
      logger.warn('[useUserRolePermissions] RPC unavailable, fallback to direct queries:', rpcRes.error?.message)

      // Sắp xếp ưu tiên: admin -> ceo -> các role khác
      const getRolePriority = (code: string) => {
        if (code === 'admin') return 1
        if (code === 'ceo') return 2
        return 3
      }
      const sorted = [...rolesList].sort((a, b) => getRolePriority(a.code) - getRolePriority(b.code))

      const role = sorted[0] ?? { code: 'guest', name: 'Khách' }

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

      return { role, roleCodes, permissions: Array.from(perms) }
    },
    staleTime: 15 * 60_000,
    gcTime:    30 * 60_000,
  })
}
