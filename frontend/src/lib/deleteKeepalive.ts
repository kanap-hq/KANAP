import { getAccessToken } from '../auth/accessTokenStore';
import { releaseLockKeepaliveUrl } from './releaseLockKeepalive';

/**
 * A `DELETE` the browser finishes after the page is gone (`pagehide` of a reload or a closed
 * tab): `fetch` with `keepalive` carries the access token and a JSON body, which `sendBeacon`
 * cannot. Best effort: nothing waits for the answer, and a refused request leaves the record
 * where it is.
 */
export function deleteKeepalive(path: string, body: unknown): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const accessToken = getAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    void fetch(releaseLockKeepaliveUrl(path), {
      method: 'DELETE',
      keepalive: true,
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // Best effort.
  }
}
