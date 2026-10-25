import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../auth/accessTokenStore';
import { releaseLockKeepalive, releaseLockKeepaliveUrl } from './releaseLockKeepalive';

describe('releaseLockKeepalive', () => {
  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('appends the lock path to the API base, including a relative /api', () => {
    vi.stubEnv('VITE_API_URL', '/api/');
    expect(releaseLockKeepaliveUrl('/applications/app-1/integrated-documents/overview/locks'))
      .toBe('/api/applications/app-1/integrated-documents/overview/locks');
  });

  it('sends DELETE with the lock header and the access token, and keeps the request alive', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080');
    setAccessToken('access-1', Date.now() + 60_000);

    releaseLockKeepalive('/projects/prj-1/integrated-documents/purpose/locks', 'lock-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/projects/prj-1/integrated-documents/purpose/locks',
      {
        method: 'DELETE',
        keepalive: true,
        credentials: 'include',
        headers: {
          'X-Lock-Token': 'lock-1',
          Authorization: 'Bearer access-1',
        },
      },
    );
  });
});
