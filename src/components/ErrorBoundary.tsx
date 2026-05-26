import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Only log in dev – esbuild strips console.error in prod builds
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F7F8FA',
          fontFamily: "'Be Vietnam Pro', sans-serif",
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: '100%',
            background: '#fff',
            border: '1px solid #E5E9EE',
            borderRadius: 20,
            padding: '40px 32px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: '#FFF1F0',
              border: '1px solid #FFD6D3',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: 32,
            }}
          >
            ⚠️
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1A202C', marginBottom: 8 }}>
            Đã xảy ra lỗi không mong muốn
          </h2>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, marginBottom: 24 }}>
            Trang này gặp sự cố và không thể hiển thị. Hãy thử tải lại hoặc liên hệ quản trị viên nếu lỗi tiếp tục xảy ra.
          </p>
          {this.state.error && (
            <details style={{ textAlign: 'left', marginBottom: 24 }}>
              <summary style={{ fontSize: 12, color: '#9CA3AF', cursor: 'pointer', marginBottom: 8 }}>
                Chi tiết lỗi (dev)
              </summary>
              <pre
                style={{
                  fontSize: 11,
                  color: '#DC2626',
                  background: '#FFF5F5',
                  border: '1px solid #FECACA',
                  borderRadius: 8,
                  padding: '10px 12px',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {this.state.error.message}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => window.history.back()}
              style={{
                padding: '10px 20px',
                background: '#F3F4F6',
                color: '#374151',
                border: 'none',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Quay lại
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 20px',
                background: '#1E5A9C',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Tải lại trang
            </button>
          </div>
        </div>
      </div>
    )
  }
}
