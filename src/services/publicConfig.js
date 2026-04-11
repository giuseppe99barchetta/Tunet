/**
 * Public Dashboard Mode — client-side config bootstrap.
 *
 * Fetches /api/public-config when no user credentials are found in storage,
 * so kiosk/wall-tablet devices can auto-connect without a manual login.
 *
 * The result is cached for the lifetime of the page so we only hit the
 * endpoint once per load.
 */

/** @type {{ haUrl: string; haToken: string; readOnly: boolean } | null | false} */
let _cachedPublicConfig = null; // null = not yet fetched, false = not available

/**
 * Attempt to load the public config from the server.
 * Returns the config object on success, or `null` if public mode is not
 * configured / the endpoint is not available.
 *
 * @returns {Promise<{ haUrl: string; haToken: string; readOnly: boolean } | null>}
 */
export async function fetchPublicConfig() {
  // Return cached result (including a negative "false" result)
  if (_cachedPublicConfig !== null) {
    return _cachedPublicConfig || null;
  }

  try {
    const res = await fetch('/api/public-config', { cache: 'no-store' });
    if (!res.ok) {
      _cachedPublicConfig = false;
      return null;
    }
    const data = await res.json();
    if (!data?.haUrl || !data?.haToken) {
      _cachedPublicConfig = false;
      return null;
    }
    _cachedPublicConfig = {
      haUrl: String(data.haUrl).trim().replace(/\/$/, ''),
      haToken: String(data.haToken).trim(),
      readOnly: data.readOnly === true,
    };
    return _cachedPublicConfig;
  } catch (err) {
    const isNetworkError =
      err instanceof TypeError &&
      (err.message.includes('Failed to fetch') ||
        err.message.includes('NetworkError') ||
        err.message.includes('ECONNREFUSED'));
    if (isNetworkError) {
      console.error(
        '[PublicMode] Backend server unreachable at port 3002.' +
          ' Ensure the Express server is running (npm run server or docker-compose up).' +
          ' In Add-on mode, verify the container started correctly.',
        err
      );
    }
    _cachedPublicConfig = false;
    return null;
  }
}

/** Reset the cache (used in tests). */
export function clearPublicConfigCache() {
  _cachedPublicConfig = null;
}
