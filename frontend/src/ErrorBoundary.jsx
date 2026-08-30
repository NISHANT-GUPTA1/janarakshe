import React from 'react';

// A render error anywhere in the tree unmounts the whole SPA and leaves a blank
// page. This catches it, shows a recoverable message, and keeps the diagnostic
// detail in the console rather than on screen.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error" role="alert" style={{ margin: '2rem auto', maxWidth: 640 }}>
        <b>Something went wrong displaying this section.</b>
        <p style={{ marginTop: 8 }}>
          The rest of the portal is unaffected. Reload the page to try again.
        </p>
        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: 12 }}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
