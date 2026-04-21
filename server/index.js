import express from 'express';
import rateLimit from 'express-rate-limit';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import profilesRouter from './routes/profiles.js';
import iconsRouter from './routes/icons.js';
import settingsRouter from './routes/settings.js';
import publicProfilesRouter from './routes/publicProfiles.js';
import { createHomeAssistantAuthMiddleware } from './haAuth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3002', 10);
const isProduction = process.env.NODE_ENV === 'production';

const packageJsonPath = join(__dirname, '..', 'package.json');
let appVersion = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  appVersion = pkg?.version || 'unknown';
} catch {
  appVersion = 'unknown';
}

const envFlag = (value) => String(value || '').trim().toLowerCase() === 'true';

const app = express();
const homeAssistantAuth = createHomeAssistantAuthMiddleware();
app.set('trust proxy', true);

// Debug middleware — logs every incoming request so routing issues can be diagnosed.
// Safe to keep in production; remove once the public-mode routing is confirmed working.
app.use((req, _res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.url}`);
  next();
});

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.removeHeader('X-Powered-By');

  // --- Content-Security-Policy ---
  // Restricts which origins can load scripts, styles, images, etc.
  // "self" = same origin only; external CDNs are explicitly allowed.
  const csp = [
    "default-src 'self'",
    // Scripts: own bundle only (inline for Vite dev handled by nonce/hash in dev mode)
    "script-src 'self'",
    // Styles: own + Google Fonts + inline (Tailwind / dynamic styles)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // Fonts: own + Google Fonts CDN
    "font-src 'self' https://fonts.gstatic.com",
    // Images: own, HA instance (any origin – URL is user-configured), weather icons, media logos, map tiles, data/blob URIs
    "img-src 'self' data: blob: http: https: https://cdn.jsdelivr.net https://cdn.simpleicons.org https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org",
    // WebSocket connections to the user's HA instance (any origin, since URL is user-configured)
    "connect-src 'self' ws: wss: http: https:",
    // Leaflet map iframe
    "frame-src https://www.openstreetmap.org",
    // Block all object/embed/plugin
    "object-src 'none'",
    // Restrict base-uri to prevent base tag injection
    "base-uri 'self'",
    // Only allow forms to submit to same origin
    "form-action 'self'",
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  next();
});

// Parse JSON bodies
app.use(express.json({ limit: '2mb' }));

const apiRateLimiter = rateLimit({
  windowMs: Math.max(Number(process.env.API_RATE_LIMIT_WINDOW_MS) || 60_000, 1_000),
  max: Math.max(Number(process.env.API_RATE_LIMIT_MAX) || 300, 10),
  standardHeaders: true,
  legacyHeaders: false,
  // HA Ingress sits behind Supervisor proxy; disable proxy-related runtime
  // validations that otherwise throw when trust proxy is intentionally enabled.
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

const assetFallbackRateLimiter = rateLimit({
  windowMs: Math.max(Number(process.env.ASSET_FALLBACK_RATE_LIMIT_WINDOW_MS) || 60_000, 1_000),
  max: Math.max(Number(process.env.ASSET_FALLBACK_RATE_LIMIT_MAX) || 120, 10),
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

// Ingress support — strip X-Ingress-Path prefix from request URL
app.use((req, _res, next) => {
  const ingressPath = req.headers['x-ingress-path'];
  if (ingressPath && req.url.startsWith(ingressPath)) {
    req.url = req.url.slice(ingressPath.length) || '/';
  }
  next();
});

// Public Dashboard Mode config
// Returns HA credentials for kiosk/wall-tablet deployments when public mode is explicitly enabled.
// SECURITY: only active when TUNET_PUBLIC_MODE_ENABLED=true is set (opt-in).
// The HA token is intentionally exposed to the browser — this is a documented tradeoff
// for unattended kiosk devices. Do NOT enable on shared or internet-facing servers.
//
// Auto-detection: when running as an HA add-on (SUPERVISOR_TOKEN present) and
// tunet_public_ha_url / tunet_public_ha_token are not explicitly set, the supervisor
// token is used as the HA token and the HA URL is resolved from the supervisor
// discovery_info API, so users only need to flip tunet_public_mode_enabled: true.
const _supervisorHaUrlCache = { value: null, fetchedAt: 0 };
const SUPERVISOR_HA_URL_TTL_MS = 60_000;

async function resolvePublicCredentials() {
  let haUrl = (process.env.TUNET_PUBLIC_HA_URL || '').trim();
  let haToken = (process.env.TUNET_PUBLIC_HA_TOKEN || '').trim();

  // Both explicitly configured — use them directly.
  if (haUrl && haToken) return { haUrl, haToken };

  // Try supervisor auto-detection (HA add-on context).
  const supervisorToken = (process.env.SUPERVISOR_TOKEN || '').trim();
  if (!supervisorToken) return null;

  haToken = haToken || supervisorToken;

  if (!haUrl) {
    const now = Date.now();
    if (_supervisorHaUrlCache.value && now - _supervisorHaUrlCache.fetchedAt < SUPERVISOR_HA_URL_TTL_MS) {
      haUrl = _supervisorHaUrlCache.value;
    } else {
      try {
        const discoveryRes = await fetch('http://supervisor/core/api/discovery_info', {
          headers: { Authorization: `Bearer ${supervisorToken}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (discoveryRes.ok) {
          const discovery = await discoveryRes.json();
          const resolved = (discovery.external_url || discovery.internal_url || discovery.base_url || '').trim().replace(/\/$/, '');
          if (resolved) {
            _supervisorHaUrlCache.value = resolved;
            _supervisorHaUrlCache.fetchedAt = now;
            haUrl = resolved;
          }
        }
      } catch (err) {
        console.warn('[PublicMode] Could not resolve HA URL from supervisor:', err.message);
      }
    }
  }

  if (!haUrl || !haToken) return null;
  return { haUrl, haToken };
}

app.get('/api/public-config', async (_req, res) => {
  if (!envFlag(process.env.TUNET_PUBLIC_MODE_ENABLED)) {
    return res.status(404).json({ error: 'Not found' });
  }

  let credentials;
  try {
    credentials = await resolvePublicCredentials();
  } catch (err) {
    console.error('[PublicMode] Error resolving credentials:', err);
    return res.status(503).json({ error: 'Failed to resolve public mode credentials' });
  }

  if (!credentials) {
    return res.status(503).json({ error: 'Public mode is enabled but TUNET_PUBLIC_HA_URL or TUNET_PUBLIC_HA_TOKEN is not configured and supervisor auto-detection failed' });
  }

  return res.json({
    haUrl: credentials.haUrl,
    haToken: credentials.haToken,
    readOnly: envFlag(process.env.TUNET_PUBLIC_READ_ONLY),
  });
});

// Public-mode routes (no HA auth required — only active when TUNET_PUBLIC_MODE_ENABLED=true)
app.use('/api/public-profiles', publicProfilesRouter);

app.use('/api', apiRateLimiter);

// API routes
app.use('/api/profiles', homeAssistantAuth, profilesRouter);
app.use('/api/icons', iconsRouter);
app.use('/api/settings', homeAssistantAuth, settingsRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: appVersion });
});

// Serve static frontend files in production
if (isProduction) {
  const distPath = join(__dirname, '..', 'dist');
  if (existsSync(distPath)) {
    const assetsPath = join(distPath, 'assets');
    const indexHtmlPath = join(distPath, 'index.html');
    const indexHtml = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, 'utf8') : null;
    const assetFiles = existsSync(assetsPath) ? readdirSync(assetsPath) : [];
    const hashedAssetFallbackMap = new Map();

    assetFiles.forEach((fileName) => {
      const fileExt = extname(fileName).toLowerCase();
      if (fileExt !== '.js' && fileExt !== '.css') return;

      const baseName = basename(fileName, fileExt);
      const hashSeparatorIndex = baseName.lastIndexOf('-');
      if (hashSeparatorIndex <= 0) return;

      const stem = baseName.slice(0, hashSeparatorIndex);
      const key = `${stem}${fileExt}`;
      hashedAssetFallbackMap.set(key, fileName);
    });

    const setNoCacheHeaders = (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    };

    const sendSpaIndex = (res) => {
      setNoCacheHeaders(res);
      if (indexHtml !== null) {
        return res.type('html').send(indexHtml);
      }
      return res.status(503).send('Frontend unavailable');
    };

    app.use(
      '/assets',
      express.static(assetsPath, {
        fallthrough: true,
        immutable: true,
        maxAge: '1y',
      })
    );

    app.get('/assets/{*path}', assetFallbackRateLimiter, (req, res, next) => {
      const requested = basename(req.path || '');
      if (!requested) return next();

      const fileExt = extname(requested).toLowerCase();
      if (fileExt !== '.js' && fileExt !== '.css') return next();

      const requestedBase = basename(requested, fileExt);
      const hashSeparatorIndex = requestedBase.lastIndexOf('-');
      if (hashSeparatorIndex <= 0) return next();

      const stem = requestedBase.slice(0, hashSeparatorIndex);
      const fallbackKey = `${stem}${fileExt}`;
      const fallbackFileName = hashedAssetFallbackMap.get(fallbackKey);
      if (!fallbackFileName || fallbackFileName === requested) return next();

      res.setHeader('X-Tunet-Asset-Fallback', fallbackFileName);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(join(assetsPath, fallbackFileName));
    });

    app.use(
      express.static(distPath, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            setNoCacheHeaders(res);
          }
          if (filePath.endsWith('sw.js')) {
            setNoCacheHeaders(res);
            res.setHeader('Service-Worker-Allowed', '/');
          }
        },
      })
    );

    app.get('/index.html', (_req, res) => {
      sendSpaIndex(res);
    });

    // SPA fallback — serve index.html for all non-API routes
    app.get('{*path}', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
      }
      if (req.path.includes('.')) {
        return res.status(404).end();
      }
      sendSpaIndex(res);
    });
  } else {
    console.warn('[server] dist/ folder not found. Only API routes will be available.');
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('Trust Proxy enabled for Home Assistant Ingress support.');
  console.log(
    `[server] Tunet backend running on 0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`
  );
});

export default app;
