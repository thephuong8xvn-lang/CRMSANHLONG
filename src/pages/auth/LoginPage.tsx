import { useState, useCallback } from 'react'
import { Eye, EyeOff, Shield, CheckCircle, Circle, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type LoginView = 'login' | 'forgot' | 'forgot-sent'

interface PasswordStrength {
  score: number
  hasLength: boolean
  hasNumber: boolean
  hasSpecial: boolean
  label: string
  color: string
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getPasswordStrength(password: string): PasswordStrength {
  const hasLength = password.length >= 8
  const hasNumber = /\d/.test(password)
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const isLong = password.length > 12

  let score = 0
  if (hasLength) score++
  if (hasNumber) score++
  if (hasSpecial) score++
  if (hasUpper || isLong) score++

  const labels = ['Yếu', 'Trung bình', 'Khá', 'Mạnh']
  const colors = ['#B23A3A', '#B8722C', '#B8A02C', '#2E7D5B']

  return {
    score,
    hasLength,
    hasNumber,
    hasSpecial,
    label: password.length > 0 ? labels[Math.min(score - 1, 3)] : '',
    color: password.length > 0 ? colors[Math.min(score - 1, 3)] : '#A8B2BD',
  }
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
function PasswordInput({
  id,
  value,
  onChange,
  placeholder = '••••••••',
  className = '',
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="slv-input-wrap">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`slv-input pr-11 ${className}`}
        autoComplete="current-password"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="slv-input-icon-btn"
        tabIndex={-1}
        aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      >
        {show ? <EyeOff size={18} strokeWidth={1.5} /> : <Eye size={18} strokeWidth={1.5} />}
      </button>
    </div>
  )
}

function StrengthBar({ score }: { score: number }) {
  const colors = ['#B23A3A', '#B8722C', '#B8A02C', '#2E7D5B']
  const activeColor = score > 0 ? colors[Math.min(score - 1, 3)] : '#E5E9EE'
  return (
    <div className="slv-strength-bars">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="slv-strength-bar"
          style={{ backgroundColor: i <= score ? activeColor : '#E5E9EE' }}
        />
      ))}
    </div>
  )
}

function ReqItem({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={`slv-req-item ${ok ? 'slv-req-ok' : ''}`}>
      {ok
        ? <CheckCircle size={14} strokeWidth={2} />
        : <Circle size={14} strokeWidth={1.5} />}
      {text}
    </li>
  )
}

// ─────────────────────────────────────────────────────────────
// Main Login Page
// ─────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { signInWithEmail, signInWithGoogle, resetPassword } = useAuth()
  const navigate = useNavigate()

  const [view, setView] = useState<LoginView>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState(() => {
    // AuthContext đá người bị khoá ra ngoài và để lại cờ này — đọc xong xoá
    // ngay để lần đăng nhập sau không hiện lại thông báo cũ.
    try {
      if (sessionStorage.getItem('slv_auth_blocked')) {
        sessionStorage.removeItem('slv_auth_blocked')
        return 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.'
      }
    } catch { /* private mode */ }
    return ''
  })

  const strength = getPasswordStrength(password)

  // ── Đăng nhập Email ──
  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await signInWithEmail(email, password)
    setLoading(false)
    if (err) {
      const msg = err.message
      if (msg.includes('Invalid login credentials')) {
        setError('Email hoặc mật khẩu không đúng. Vui lòng thử lại.')
      } else if (/banned|blocked/i.test(msg)) {
        setError('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.')
      } else if (msg.includes('Email not confirmed')) {
        setError('Vui lòng kiểm tra hộp thư để xác nhận email trước khi đăng nhập.')
      } else if (msg.includes('Too many requests')) {
        setError('Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ít phút.')
      } else {
        setError(msg)
      }
      return
    }
    navigate('/dashboard')
  }, [email, password, signInWithEmail, navigate])

  // ── Đăng nhập Google ──
  const handleGoogle = useCallback(async () => {
    setGoogleLoading(true)
    await signInWithGoogle()
    setGoogleLoading(false)
  }, [signInWithGoogle])

  // ── Quên mật khẩu ──
  const handleForgot = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await resetPassword(forgotEmail)
    setLoading(false)
    if (err) {
      setError(err.message)
      return
    }
    setView('forgot-sent')
  }, [forgotEmail, resetPassword])

  const switchView = (v: LoginView) => {
    setError('')
    setView(v)
  }

  return (
    <div className="slv-page">
      <main className="slv-card">
        {/* ── Left Panel (Login / Forgot) ── */}
        <section className="slv-left">
          {/* Logo */}
          <div className="slv-logo-wrap">
            <div className="slv-logo-icon">
              {/* Medical cross SVG */}
              <svg viewBox="0 0 24 24" fill="none" className="slv-logo-svg" aria-hidden="true">
                <rect x="9" y="2" width="6" height="20" rx="2" fill="white"/>
                <rect x="2" y="9" width="20" height="6" rx="2" fill="white"/>
              </svg>
            </div>
            <span className="slv-brand-name">Sanh Long Vetco CRM</span>
          </div>

          {/* ─── VIEW: Login ─── */}
          {view === 'login' && (
            <>
              <header className="slv-header">
                <h1 className="slv-h1">Chào mừng trở lại</h1>
                <p className="slv-caption">Vui lòng nhập thông tin để truy cập hệ thống.</p>
              </header>

              {error && (
                <div className="slv-error-banner" role="alert">
                  <AlertTriangle size={16} strokeWidth={1.5} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="slv-form" noValidate>
                {/* Email */}
                <div className="slv-field">
                  <label htmlFor="login-email" className="slv-label">Email</label>
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="slv-input"
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                {/* Password */}
                <div className="slv-field">
                  <div className="slv-field-row">
                    <label htmlFor="login-password" className="slv-label">Mật khẩu</label>
                    <button
                      type="button"
                      onClick={() => switchView('forgot')}
                      className="slv-link-btn"
                    >
                      Quên mật khẩu?
                    </button>
                  </div>
                  <PasswordInput
                    id="login-password"
                    value={password}
                    onChange={setPassword}
                  />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  className="slv-btn-primary"
                  disabled={loading || !email || !password}
                >
                  {loading
                    ? <><Loader2 size={16} className="slv-spin" /> Đang đăng nhập...</>
                    : 'Đăng nhập'}
                </button>

                {/* Divider */}
                <div className="slv-divider">
                  <span className="slv-divider-line" />
                  <span className="slv-divider-text">Hoặc tiếp tục với</span>
                  <span className="slv-divider-line" />
                </div>

                {/* Google */}
                <button
                  type="button"
                  onClick={handleGoogle}
                  className="slv-btn-google"
                  disabled={googleLoading}
                >
                  {googleLoading ? (
                    <Loader2 size={18} className="slv-spin" />
                  ) : (
                    <svg className="slv-google-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  )}
                  Đăng nhập bằng Google
                </button>
              </form>
            </>
          )}

          {/* ─── VIEW: Quên mật khẩu ─── */}
          {view === 'forgot' && (
            <>
              <button
                type="button"
                onClick={() => switchView('login')}
                className="slv-back-btn"
              >
                <ArrowLeft size={16} strokeWidth={1.5} />
                Quay lại đăng nhập
              </button>

              <header className="slv-header">
                <h1 className="slv-h1">Quên mật khẩu?</h1>
                <p className="slv-caption">
                  Nhập email của bạn, chúng tôi sẽ gửi link đặt lại mật khẩu trong vài phút.
                </p>
              </header>

              {error && (
                <div className="slv-error-banner" role="alert">
                  <AlertTriangle size={16} strokeWidth={1.5} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleForgot} className="slv-form" noValidate>
                <div className="slv-field">
                  <label htmlFor="forgot-email" className="slv-label">Email đăng ký</label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="slv-input"
                    required
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  className="slv-btn-primary"
                  disabled={loading || !forgotEmail}
                >
                  {loading
                    ? <><Loader2 size={16} className="slv-spin" /> Đang gửi...</>
                    : 'Gửi link đặt lại mật khẩu'}
                </button>
              </form>
            </>
          )}

          {/* ─── VIEW: Email đã gửi ─── */}
          {view === 'forgot-sent' && (
            <div className="slv-sent-state">
              <div className="slv-sent-icon">
                <CheckCircle size={40} strokeWidth={1.5} />
              </div>
              <h1 className="slv-h1">Kiểm tra hộp thư!</h1>
              <p className="slv-caption">
                Chúng tôi đã gửi link đặt lại mật khẩu đến <strong>{forgotEmail}</strong>.
                Link có hiệu lực trong <strong>1 giờ</strong>.
              </p>
              <p className="slv-caption" style={{ marginTop: '8px' }}>
                Không nhận được? Kiểm tra hộp thư Spam hoặc{' '}
                <button
                  type="button"
                  onClick={() => switchView('forgot')}
                  className="slv-link-btn"
                >
                  thử lại
                </button>
                .
              </p>
              <button
                type="button"
                onClick={() => switchView('login')}
                className="slv-btn-outline"
                style={{ marginTop: '32px' }}
              >
                <ArrowLeft size={16} strokeWidth={1.5} />
                Quay lại đăng nhập
              </button>
            </div>
          )}
        </section>

        {/* ── Right Panel (Hero) ── */}
        <section className="slv-right" aria-hidden="true">
          <div className="slv-right-bg" />
          <div className="slv-right-content">
            <Shield size={64} strokeWidth={1.2} className="slv-shield-icon" />
            <h2 className="slv-right-title">An tâm quản lý</h2>
            <p className="slv-right-body">
              Hệ thống CRM chuyên biệt cho thú y với bảo mật đa tầng và giao diện tối ưu cho hiệu suất làm việc.
            </p>
            <div className="slv-features">
              {[
                'Quản lý khách hàng & trang trại',
                'Theo dõi tồn kho & lô vaccine',
                'Sổ quỹ & báo cáo tài chính',
                'Pipeline bán hàng thú y',
              ].map(f => (
                <div key={f} className="slv-feature-item">
                  <CheckCircle size={16} strokeWidth={2} className="slv-feature-check" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Styles */}
      <style>{`
        /* ── Font ── */
        @import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600&display=swap');

        /* ── Reset ── */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── Color tokens ── */
        :root {
          --blue-50:  #EEF4FB;
          --blue-100: #D6E4F4;
          --blue-500: #1E5A9C;
          --blue-600: #194B82;
          --blue-700: #143C69;
          --gray-0:   #FFFFFF;
          --gray-25:  #FAFBFC;
          --gray-50:  #F4F6F8;
          --gray-100: #E5E9EE;
          --gray-200: #CCD3DB;
          --gray-300: #A8B2BD;
          --gray-400: #6B7785;
          --gray-500: #4A5663;
          --gray-600: #2F3947;
          --gray-700: #1F2731;
          --success:  #2E7D5B;
          --danger:   #B23A3A;
        }

        /* ── Page ── */
        .slv-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #F4F6F8 0%, #EEF4FB 100%);
          font-family: 'Be Vietnam Pro', Inter, ui-sans-serif, sans-serif;
          padding: 24px;
        }

        /* ── Card ── */
        .slv-card {
          width: 100%;
          max-width: 960px;
          min-height: 600px;
          background: var(--gray-0);
          border: 1px solid var(--gray-100);
          border-radius: 14px;
          overflow: hidden;
          display: flex;
          box-shadow: 0 8px 32px -8px rgba(15,23,42,0.10), 0 2px 8px rgba(15,23,42,0.04);
        }

        /* ── Left Panel ── */
        .slv-left {
          flex: 0 0 480px;
          padding: 48px 52px;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--gray-100);
          overflow-y: auto;
        }

        /* ── Logo ── */
        .slv-logo-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 36px;
        }
        .slv-logo-icon {
          width: 44px;
          height: 44px;
          background: var(--blue-500);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .slv-logo-svg {
          width: 26px;
          height: 26px;
        }
        .slv-brand-name {
          font-size: 18px;
          font-weight: 600;
          color: var(--blue-500);
          line-height: 1.3;
        }

        /* ── Header ── */
        .slv-header {
          margin-bottom: 28px;
        }
        .slv-h1 {
          font-size: 22px;
          font-weight: 600;
          color: var(--gray-700);
          line-height: 1.35;
          margin-bottom: 8px;
        }
        .slv-caption {
          font-size: 14px;
          color: var(--gray-400);
          line-height: 1.6;
        }

        /* ── Error banner ── */
        .slv-error-banner {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          background: #FEF2F2;
          border: 1px solid #FECACA;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 13px;
          color: var(--danger);
          margin-bottom: 20px;
          line-height: 1.5;
        }
        .slv-error-banner svg { flex-shrink: 0; margin-top: 1px; }

        /* ── Form ── */
        .slv-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .slv-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .slv-field-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .slv-label {
          font-size: 13px;
          font-weight: 500;
          color: var(--gray-500);
        }
        .slv-input {
          width: 100%;
          height: 42px;
          padding: 0 14px;
          border: 1px solid var(--gray-200);
          border-radius: 8px;
          font-size: 14px;
          color: var(--gray-600);
          background: var(--gray-0);
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .slv-input::placeholder { color: var(--gray-300); }
        .slv-input:focus {
          border-color: var(--blue-500);
          box-shadow: 0 0 0 3px var(--blue-100);
        }
        .slv-input-wrap {
          position: relative;
        }
        .slv-input-wrap .slv-input {
          padding-right: 44px;
        }
        .slv-input-icon-btn {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: var(--gray-400);
          padding: 2px;
          display: flex;
          align-items: center;
          transition: color 0.15s;
        }
        .slv-input-icon-btn:hover { color: var(--gray-600); }

        /* ── Buttons ── */
        .slv-btn-primary {
          width: 100%;
          height: 42px;
          background: var(--blue-500);
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.15s, transform 0.1s, opacity 0.15s;
        }
        .slv-btn-primary:hover:not(:disabled) { background: var(--blue-600); }
        .slv-btn-primary:active:not(:disabled) { transform: scale(0.985); background: var(--blue-700); }
        .slv-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

        .slv-btn-outline {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 20px;
          background: var(--gray-0);
          color: var(--gray-600);
          border: 1px solid var(--gray-200);
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s;
          text-decoration: none;
        }
        .slv-btn-outline:hover { background: var(--gray-50); border-color: var(--gray-300); }

        .slv-btn-google {
          width: 100%;
          height: 42px;
          background: var(--gray-0);
          color: var(--gray-600);
          border: 1px solid var(--gray-200);
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
        }
        .slv-btn-google:hover:not(:disabled) { background: var(--gray-50); border-color: var(--gray-300); }
        .slv-btn-google:active:not(:disabled) { transform: scale(0.985); }
        .slv-btn-google:disabled { opacity: 0.5; cursor: not-allowed; }
        .slv-google-icon { width: 20px; height: 20px; flex-shrink: 0; }

        .slv-link-btn {
          background: none;
          border: none;
          color: var(--blue-500);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          padding: 0;
          font-family: inherit;
          transition: color 0.15s;
        }
        .slv-link-btn:hover { color: var(--blue-700); text-decoration: underline; }

        .slv-back-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          color: var(--blue-500);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          padding: 0;
          font-family: inherit;
          margin-bottom: 24px;
          transition: color 0.15s;
        }
        .slv-back-btn:hover { color: var(--blue-700); }

        /* ── Divider ── */
        .slv-divider {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .slv-divider-line {
          flex: 1;
          height: 1px;
          background: var(--gray-100);
        }
        .slv-divider-text {
          font-size: 12px;
          color: var(--gray-300);
          white-space: nowrap;
        }

        /* ── Password strength ── */
        .slv-strength-bars {
          display: flex;
          gap: 4px;
          margin-top: 10px;
        }
        .slv-strength-bar {
          height: 4px;
          flex: 1;
          border-radius: 2px;
          background: var(--gray-100);
          transition: background 0.3s;
        }
        .slv-strength-label {
          font-size: 12px;
          color: var(--gray-400);
          margin-top: 6px;
        }

        /* ── Requirement list ── */
        .slv-req-list {
          list-style: none;
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .slv-req-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--gray-400);
          transition: color 0.2s;
        }
        .slv-req-ok {
          color: var(--success);
        }

        /* ── Forgot sent state ── */
        .slv-sent-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding-top: 20px;
        }
        .slv-sent-icon {
          width: 72px;
          height: 72px;
          background: #F0FBF5;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--success);
          margin-bottom: 20px;
        }
        .slv-sent-state .slv-h1 { text-align: center; margin-bottom: 12px; }
        .slv-sent-state .slv-caption { text-align: center; }

        /* ── Spinner ── */
        .slv-spin { animation: slv-spin 0.7s linear infinite; }
        @keyframes slv-spin { to { transform: rotate(360deg); } }

        /* ── Right Panel ── */
        .slv-right {
          flex: 1;
          position: relative;
          background: var(--blue-50);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .slv-right-bg {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 80% at 50% 30%, rgba(30,90,156,0.08) 0%, transparent 70%),
            radial-gradient(ellipse 60% 60% at 80% 80%, rgba(30,90,156,0.06) 0%, transparent 70%);
        }
        .slv-right-content {
          position: relative;
          z-index: 1;
          text-align: center;
          padding: 48px 40px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        .slv-shield-icon {
          color: var(--blue-500);
          margin-bottom: 8px;
          opacity: 0.85;
        }
        .slv-right-title {
          font-size: 28px;
          font-weight: 600;
          color: var(--blue-500);
          line-height: 1.3;
        }
        .slv-right-body {
          font-size: 15px;
          color: var(--gray-500);
          line-height: 1.7;
          max-width: 320px;
        }
        .slv-features {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 16px;
          align-items: flex-start;
          width: 100%;
          max-width: 280px;
        }
        .slv-feature-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--gray-500);
        }
        .slv-feature-check { color: var(--blue-500); flex-shrink: 0; }

        /* ── Responsive ── */
        @media (max-width: 768px) {
          .slv-page { padding: 0; align-items: stretch; }
          .slv-card {
            max-width: 100%;
            min-height: 100vh;
            border-radius: 0;
            border: none;
            flex-direction: column;
            box-shadow: none;
          }
          .slv-left {
            flex: 1;
            padding: 40px 24px;
            border-right: none;
            border-bottom: 1px solid var(--gray-100);
          }
          .slv-right { display: none; }
        }

        @media (max-width: 480px) {
          .slv-left { padding: 32px 20px; }
        }
      `}</style>
    </div>
  )
}
