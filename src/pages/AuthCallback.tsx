import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Trang callback sau khi đăng nhập OAuth (Google) hoặc xác nhận email.
 * Supabase chuyển hướng về /auth/callback với hash fragment chứa access_token.
 * Component này xử lý session từ URL và điều hướng về dashboard.
 */
export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const handleCallback = async () => {
      // Supabase JS client tự xử lý token trong URL hash
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        console.error('[AuthCallback] Error:', error.message)
        navigate('/login?error=' + encodeURIComponent(error.message))
        return
      }

      if (session) {
        // Đăng nhập thành công
        navigate('/dashboard', { replace: true })
      } else {
        // Không có session – quay lại login
        navigate('/login', { replace: true })
      }
    }

    handleCallback()
  }, [navigate])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      flexDirection: 'column',
      gap: '16px',
      fontFamily: 'sans-serif',
      color: '#475569'
    }}>
      <div style={{
        width: '40px',
        height: '40px',
        border: '3px solid #e2e8f0',
        borderTop: '3px solid #3b82f6',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite'
      }} />
      <p>Đang xác thực, vui lòng chờ...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
