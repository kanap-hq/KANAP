import { getAccessToken } from '../auth/accessTokenStore';

const DEFAULT_API_BASE = 'http://localhost:8080';

/**
 * Same joining as axios: a path is appended to the API base, so `/api` plus
 * `/applications/1/locks` is `/api/applications/1/locks`.
 */
export function releaseLockKeepaliveUrl(path: string): string {
  const base = String(import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

/**
 * Releases an edit lock with a request the browser finishes after the page is
 * gone. `DELETE` with the lock header cannot go through `sendBeacon` (POST
 * only, no custom headers). `fetch` with `keepalive` carries both, including
 * the access token the API expects.
 */
export function releaseLockKeepalive(path: string, lockToken: string): void {
  const headers: Record<string, string> = { 'X-Lock-Token': lockToken };
  const accessToken = getAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    void fetch(releaseLockKeepaliveUrl(path), {
      method: 'DELETE',
      keepalive: true,
      credentials: 'include',
      headers,
    }).catch(() => undefined);
  } catch {
    // Best effort: the lock expires on its own.
  }
}
