import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last-resort error screen so a bug never leaves the user with a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}>
        <div className="notice notice--danger" role="alert">
          <div>
            <p>
              <strong>Something went wrong.</strong> The application hit an unexpected error. Your
              data has not been sent anywhere.
            </p>
            <p className="mono" style={{ whiteSpace: 'pre-wrap' }}>
              {this.state.error.message}
            </p>
            <p>
              <button type="button" className="btn" onClick={() => location.reload()}>
                Reload
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }
}
