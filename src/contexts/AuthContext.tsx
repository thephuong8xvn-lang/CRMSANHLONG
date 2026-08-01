import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { useUserRolePermissions } from '../hooks/queries/useUserRolePermissions'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  branch_id: string | null
  team_id: string | null
  auth_providers: string[]
  is_active: boolean
}

interface AuthContextType {
  // State
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAuthenticated: boolean

  // RBAC: tải 1 lần qua TanStack Query (Sprint P1-6, cache 15 phút)
  userRole: { code: string; name: string }   // role đại diện (hiển thị)
  userRoles: string[]                         // TẤT CẢ role codes (gating chính xác đa role)
  userPermissions: string[]
  permissionsLoading: boolean
  rbacReady: boolean                          // RBAC đã giải quyết xong (chờ trước khi gating)
  hasPermission: (code: string) => boolean
  hasAnyRole: (codes: string[]) => boolean    // true nếu user có BẤT KỲ role nào trong danh sách

  // Actions
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>
  signInWithGoogle: () => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>
  refreshProfile: () => Promise<void>
}

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null)

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // Tải profile từ bảng profiles
  const loadProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, branch_id, team_id, auth_providers, is_active')
        .eq('id', userId)
        .single()

      if (error) {
        logger.error('[Auth] loadProfile error:', error.message)
        return
      }

      // Tài khoản đã bị khoá: đá ra ngay kèm lý do. Trước đây không kiểm ở đây
      // nên người bị khoá vẫn vào được app rồi mắc kẹt ở spinner vô tận (RLS
      // chặn hết dữ liệu mà không ai báo gì).
      if (data && (data as Profile).is_active === false) {
        try { sessionStorage.setItem('slv_auth_blocked', '1') } catch { /* private mode */ }
        setProfile(null)
        await supabase.auth.signOut()
        return
      }

      setProfile(data as Profile)
    } catch (err) {
      logger.error('[Auth] loadProfile exception:', err)
    }
  }

  const refreshProfile = async () => {
    if (user?.id) {
      try {
        await loadProfile(user.id)
      } catch (err) {
        logger.error('[Auth] refreshProfile exception:', err)
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Khởi tạo: lấy session hiện tại + lắng nghe thay đổi
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const getSessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise<{ data: { session: null } }>((resolve) =>
          setTimeout(() => {
            logger.warn('[Auth] getSession timed out after 3 seconds')
            resolve({ data: { session: null } })
          }, 3000)
        )
        const { data: { session: initialSession } } = await Promise.race([getSessionPromise, timeoutPromise])

        if (!mounted) return

        setSession(initialSession)
        setUser(initialSession?.user ?? null)

        if (initialSession?.user) {
          await loadProfile(initialSession.user.id)
        }
      } catch (err) {
        logger.error('[Auth] init session exception:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()

    // Lắng nghe thay đổi auth state (login, logout, token refresh, OAuth)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession: Session | null) => {
        try {
          if (!mounted) return

          setSession(newSession)
          setUser(newSession?.user ?? null)

          // setTimeout(0) tránh deadlock GoTrue khi gọi supabase.from() trong callback
          if (event === 'SIGNED_IN' && newSession?.user) {
            setTimeout(() => {
              if (mounted) {
                loadProfile(newSession.user.id)
              }
            }, 0)
          }

          if (event === 'SIGNED_OUT') {
            setProfile(null)
          }
        } catch (err) {
          logger.error('[Auth] onAuthStateChange exception:', err)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // ─────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  const signUpWithEmail = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    return { error: error as Error | null }
  }

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    return { error: error as Error | null }
  }

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error: error as Error | null }
  }

  // ─────────────────────────────────────────────────────────
  // RBAC: load role + permissions 1 lần khi có user, cache 15 phút.
  // Trước đây Layout.tsx fetch lại trên mỗi page navigation → đã bỏ.
  // ─────────────────────────────────────────────────────────
  const rolePerms = useUserRolePermissions(profile?.id ?? null)
  // ⚠️ Fail-CLOSED: khi RBAC chưa tải (hoặc query lỗi) → mặc định 'guest' (KHÔNG admin).
  // Trước đây mặc định 'admin' (fail-open) khiến route/menu bị rò rỉ trong lúc tải.
  // Mọi gating PHẢI chờ `rbacReady` trước khi đọc role (xem ProtectedRoute/Layout).
  const userRole         = rolePerms.data?.role        ?? { code: 'guest', name: 'Khách' }
  const userRoles        = rolePerms.data?.roleCodes   ?? []
  const userPermissions  = rolePerms.data?.permissions ?? []
  const permissionsLoading = rolePerms.isLoading
  // RBAC sẵn sàng khi đã có profile và query role/permission không còn loading.
  const rbacReady = !!profile && !rolePerms.isLoading

  const isSuperRole = userRoles.includes('admin') || userRoles.includes('ceo')
    || userRole.code === 'admin' || userRole.code === 'ceo'

  const hasPermission = (code: string): boolean => {
    if (isSuperRole) return true
    return userPermissions.includes(code)
  }

  // Gating theo role có xét TẤT CẢ role của user (đa role).
  const hasAnyRole = (codes: string[]): boolean =>
    isSuperRole || codes.some(c => userRoles.includes(c) || userRole.code === c)

  // ─────────────────────────────────────────────────────────
  // Value
  // ─────────────────────────────────────────────────────────
  const value: AuthContextType = {
    user,
    session,
    profile,
    loading,
    isAuthenticated: !!session && !!user,
    userRole,
    userRoles,
    userPermissions,
    permissionsLoading,
    rbacReady,
    hasPermission,
    hasAnyRole,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth phải được dùng bên trong <AuthProvider>')
  }
  return ctx
}

export type { Profile, AuthContextType }
