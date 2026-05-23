import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

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
        console.error('[Auth] loadProfile error:', error.message)
        return
      }
      setProfile(data as Profile)
    } catch (err) {
      console.error('[Auth] loadProfile exception:', err)
    }
  }

  const refreshProfile = async () => {
    if (user?.id) {
      try {
        await loadProfile(user.id)
      } catch (err) {
        console.error('[Auth] refreshProfile exception:', err)
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Khởi tạo: lấy session hiện tại + lắng nghe thay đổi
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true

    const init = async () => {
      console.log('[Auth] init started, mounted:', mounted)
      try {
        const getSessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise<{ data: { session: null } }>((resolve) =>
          setTimeout(() => {
            console.warn('[Auth] getSession timed out after 3 seconds')
            resolve({ data: { session: null } })
          }, 3000)
        )
        const { data: { session: initialSession } } = await Promise.race([getSessionPromise, timeoutPromise])
        console.log('[Auth] getSession finished, session:', initialSession)
        
        if (!mounted) {
          console.log('[Auth] init aborted because component unmounted')
          return
        }

        setSession(initialSession)
        setUser(initialSession?.user ?? null)

        if (initialSession?.user) {
          console.log('[Auth] loading profile for user:', initialSession.user.id)
          await loadProfile(initialSession.user.id)
        }
      } catch (err) {
        console.error('[Auth] init session exception:', err)
      } finally {
        if (mounted) {
          console.log('[Auth] setting loading to false')
          setLoading(false)
        } else {
          console.log('[Auth] init finished but component already unmounted')
        }
      }
    }

    init()

    // Lắng nghe thay đổi auth state (login, logout, token refresh, OAuth)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession: Session | null) => {
        console.log('[Auth] onAuthStateChange event:', event, 'session:', newSession)
        try {
          if (!mounted) return

          setSession(newSession)
          setUser(newSession?.user ?? null)

          if (event === 'SIGNED_IN' && newSession?.user) {
            console.log('[Auth] SIGNED_IN event. Deferring profile load to next event loop tick to prevent deadlock.')
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
          console.error('[Auth] onAuthStateChange exception:', err)
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
  // Value
  // ─────────────────────────────────────────────────────────
  const value: AuthContextType = {
    user,
    session,
    profile,
    loading,
    isAuthenticated: !!session && !!user,
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
