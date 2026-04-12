import { StrictMode, Component } from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles/index.css';
import App from './App.jsx';
import { ConfigProvider } from './contexts/ConfigContext';
import { PageProvider } from './contexts/PageContext';
import { ToastProvider } from './contexts/ToastContext';
import ToastContainer from './components/ui/ToastContainer';

function isChunkLoadError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('loading chunk')
  );
}

function reloadForChunkErrorOnce() {
  if (globalThis.window === undefined) return;
  const key = 'tunet_chunk_reload_once';
  if (globalThis.sessionStorage.getItem(key) === '1') return;
  globalThis.sessionStorage.setItem(key, '1');
  globalThis.window.history.go(0);
}

if (globalThis.window !== undefined) {
  globalThis.window.addEventListener('unhandledrejection', (event) => {
    if (!isChunkLoadError(event?.reason)) return;
    reloadForChunkErrorOnce();
  });
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App Error:', error, errorInfo);
    if (isChunkLoadError(error)) {
      reloadForChunkErrorOnce();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: 'white',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '20px',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '500px' }}>
            <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', fontWeight: '300' }}>
              Oops! Something went wrong
            </h1>
            <p style={{ marginBottom: '2rem', color: '#94a3b8', fontSize: '1.1rem' }}>
              The application encountered an unexpected error.
            </p>
            <button
              onClick={() => globalThis.window.history.go(0)}
              style={{
                padding: '12px 32px',
                fontSize: '1rem',
                fontWeight: '600',
                color: 'white',
                background: '#3b82f6',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
              }}
              onMouseOver={(e) => (/** @type {HTMLElement} */ (e.target).style.background = '#2563eb')}
              onMouseOut={(e) => (/** @type {HTMLElement} */ (e.target).style.background = '#3b82f6')}
              onFocus={(e) => (e.target.style.background = '#2563eb')}
              onBlur={(e) => (e.target.style.background = '#3b82f6')}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node,
};

// Register service worker for PWA installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Global fatal error logger — surfaces any startup crash in the browser console
// with a distinctive prefix so it is easy to spot.
window.onerror = (message, source, lineno, colno, error) => {
  console.error('[TUNET-FATAL] Uncaught error:', { message, source, lineno, colno, error });
};
window.addEventListener('unhandledrejection', (event) => {
  if (!isChunkLoadError(event?.reason)) {
    console.error('[TUNET-FATAL] Unhandled promise rejection:', event.reason);
  }
});

/**
 * Pre-inject public-mode credentials into localStorage BEFORE React boots.
 *
 * This runs BEFORE ReactDOM.createRoot so that all useState() initialisers in
 * ConfigContext read the already-populated ha_url / ha_token from storage.
 * Without this, a no-credential session would re-check inside a useEffect —
 * after the onboarding redirect had already fired.
 *
 * Only writes to localStorage when:
 *   1. No ha_token is already present (avoids overwriting a logged-in session)
 *   2. The server responds with publicModeEnabled credentials
 */
async function maybeInjectPublicCredentials() {
  try {
    const existingToken =
      localStorage.getItem('ha_token') || sessionStorage.getItem('ha_token') || '';
    if (existingToken) {
      console.log('[PublicMode] Credentials already present in storage — skipping pre-injection.');
      return;
    }

    console.log('[PublicMode] No credentials found — attempting pre-boot public config fetch...');
    const res = await fetch(`/api/public-config?t=${Date.now()}`, { cache: 'no-store' });

    if (!res.ok) {
      console.log(`[PublicMode] /api/public-config returned ${res.status} — public mode not active.`);
      return;
    }

    const data = await res.json();
    if (!data?.haUrl || !data?.haToken) {
      console.warn('[PublicMode] Response missing haUrl / haToken — ignoring.');
      return;
    }

    console.log('[PublicMode] Pre-boot injection: writing HA credentials to localStorage.');
    localStorage.setItem('ha_url', String(data.haUrl).trim().replace(/\/$/, ''));
    localStorage.setItem('ha_token', String(data.haToken).trim());
    localStorage.setItem('ha_auth_method', 'token');
    if (data.readOnly === true) {
      localStorage.setItem('tunet_public_mode_active', '1');
    }
  } catch (err) {
    // Network errors are expected in offline / non-public-mode environments.
    console.warn('[PublicMode] Pre-boot fetch error (non-fatal):', err?.message ?? err);
  }
}

// Await the pre-injection, then mount React.  The await is the only async gap
// before render — no visible delay for regular (non-public) sessions because
// the fetch returns 404 almost immediately.
maybeInjectPublicCredentials().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <ToastProvider>
          <ConfigProvider>
            <PageProvider>
              <HashRouter>
                <App />
              </HashRouter>
            </PageProvider>
          </ConfigProvider>
          <ToastContainer />
        </ToastProvider>
      </ErrorBoundary>
    </StrictMode>
  );
});
