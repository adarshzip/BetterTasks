import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * React 18 unmounts the whole root when a render throws, so an uncaught error
 * looks exactly like the extension failing to load: a blank panel, with the
 * real cause visible only to whoever thinks to open devtools.
 *
 * This turns that into a readable message in the panel itself.
 */
interface Props {
  children: ReactNode
  onReset?: () => void
}

interface State {
  error: Error | null
  stack: string
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack says which row blew up, which the error alone does not.
    console.error('[bettertasks] render failed', error, info.componentStack)
    this.setState({ stack: info.componentStack ?? '' })
  }

  override render(): ReactNode {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div style={{ padding: 16, fontSize: 12, lineHeight: 1.5, color: '#e3e3e3' }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#f28b82' }}>
          Something broke while rendering
        </div>

        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'rgba(242,139,130,0.08)',
            border: '1px solid rgba(242,139,130,0.3)',
            borderRadius: 6,
            padding: 8,
            margin: 0,
            color: '#f28b82',
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>

        {stack && (
          <details style={{ marginTop: 8, color: '#9aa0a6' }}>
            <summary style={{ cursor: 'pointer' }}>Component stack</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11 }}>
              {stack}
            </pre>
          </details>
        )}

        <button
          onClick={() => {
            this.setState({ error: null, stack: '' })
            this.props.onReset?.()
          }}
          style={{
            marginTop: 12,
            cursor: 'pointer',
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 4,
            border: '1px solid #3c4043',
            background: 'transparent',
            color: '#e3e3e3',
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}
