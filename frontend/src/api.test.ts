import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createAxiosInstance() {
  const responseErrorHandlers: Array<(error: any) => Promise<unknown>> = [];
  const instance = {
    interceptors: {
      request: { use: vi.fn(() => 0) },
      response: {
        use: vi.fn((_success: (value: any) => any, error: (value: any) => Promise<unknown>) => {
          responseErrorHandlers.push(error);
          return 0;
        }),
      },
    },
    request: vi.fn(),
  };
  return { instance, onError: (error: any) => responseErrorHandlers[0](error) };
}

// Each axios.create() call returns its own instance: [0] is api.ts, [1] is api/client.ts.
function createAxiosMock() {
  const instances: Array<ReturnType<typeof createAxiosInstance>> = [];
  const axiosMock = {
    create: vi.fn(() => {
      const created = createAxiosInstance();
      instances.push(created);
      return created.instance;
    }),
    post: vi.fn(),
  };
  return { axiosMock, instances };
}

function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

function rateLimited(retryAfter: string) {
  return Object.assign(httpError(429), { response: { status: 429, headers: { 'retry-after': retryAfter } } });
}

function unauthorized(url: string) {
  return { response: { status: 401 }, config: { url, headers: {} } };
}

const freshTokens = {
  data: { access_token: 'fresh-access-token', expires_in: 900, refresh_expires_in: 14_400 },
};

function createStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

describe('api auth recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    const storage = createStorageMock();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadClients() {
    const { axiosMock, instances } = createAxiosMock();
    vi.doMock('axios', () => ({ __esModule: true, default: axiosMock }));
    const tokens = await import('./auth/accessTokenStore');
    const session = await import('./auth/sessionStorage');
    const apiModule = await import('./api');
    tokens.setAccessToken('stale-access-token', Date.now() + 1_000);
    session.touchLastActivity();
    session.setRefreshTtlMs(4 * 60 * 60 * 1000);
    return { axiosMock, instances, ...apiModule, ...tokens, ...session };
  }

  it('refreshes and retries protected requests after a 401 response', async () => {
    const { axiosMock, instances, api, getAccessToken } = await loadClients();
    const main = instances[0];

    axiosMock.post.mockResolvedValue(freshTokens);
    main.instance.request.mockResolvedValue({ data: { ok: true } });

    const result = await main.onError(unauthorized('/master-data/companies'));

    expect(api).toBe(main.instance);
    expect(axiosMock.post).toHaveBeenCalledWith(
      'http://localhost:8080/auth/refresh',
      {},
      { withCredentials: true, timeout: 10_000 },
    );
    expect(main.instance.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/master-data/companies',
        _retry: true,
        headers: expect.objectContaining({
          Authorization: 'Bearer fresh-access-token',
        }),
      }),
    );
    expect(getAccessToken()).toBe('fresh-access-token');
    expect(result).toEqual({ data: { ok: true } });
  });

  describe('when the refresh call fails', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps the session and retries with backoff on a 502, then fails the request with its original error', async () => {
      const { axiosMock, instances, getAccessToken, getLastActivityAt } = await loadClients();
      const main = instances[0];
      axiosMock.post.mockRejectedValue(httpError(502));

      const original = unauthorized('/master-data/companies');
      const pending = main.onError(original);
      const settled = pending.catch((error) => error);

      await vi.advanceTimersByTimeAsync(0);
      expect(axiosMock.post).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(axiosMock.post).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(axiosMock.post).toHaveBeenCalledTimes(4);

      expect(await settled).toBe(original);
      expect(main.instance.request).not.toHaveBeenCalled();
      expect(getAccessToken()).toBe('stale-access-token');
      expect(getLastActivityAt()).not.toBeNull();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(axiosMock.post).toHaveBeenCalledTimes(4);
    });

    it('also retries on a network error and reports the server as unavailable', async () => {
      const { axiosMock, getAccessToken } = await loadClients();
      const { requestTokenRefreshOutcome } = await import('./api');
      axiosMock.post.mockRejectedValue(new Error('Network Error'));

      const outcome = requestTokenRefreshOutcome();
      await vi.advanceTimersByTimeAsync(12_000);

      await expect(outcome).resolves.toEqual({ status: 'unavailable' });
      expect(axiosMock.post).toHaveBeenCalledTimes(4);
      expect(getAccessToken()).toBe('stale-access-token');
    });

    it('ends the session at once when the refresh is refused with a 401', async () => {
      const { axiosMock, instances, getAccessToken, getLastActivityAt } = await loadClients();
      const main = instances[0];
      axiosMock.post.mockRejectedValue(httpError(401));

      const original = unauthorized('/master-data/companies');
      await expect(main.onError(original)).rejects.toBe(original);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(axiosMock.post).toHaveBeenCalledTimes(1);
      expect(getAccessToken()).toBeNull();
      expect(getLastActivityAt()).toBeNull();
    });

    it('keeps the session and takes the new token when a 429 is followed by a success', async () => {
      const { axiosMock, instances, getAccessToken, getLastActivityAt } = await loadClients();
      const main = instances[0];
      axiosMock.post.mockRejectedValueOnce(httpError(429)).mockResolvedValueOnce(freshTokens);
      main.instance.request.mockResolvedValue({ data: { ok: true } });

      const pending = main.onError(unauthorized('/master-data/companies'));
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toEqual({ data: { ok: true } });
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
      expect(getAccessToken()).toBe('fresh-access-token');
      expect(getLastActivityAt()).not.toBeNull();
    });

    it('retries a 408 and ends the session on any other 4xx, such as a 404', async () => {
      const { axiosMock, getAccessToken, requestTokenRefreshOutcome } = await loadClients();
      axiosMock.post.mockRejectedValueOnce(httpError(408)).mockRejectedValueOnce(httpError(404));

      const outcome = requestTokenRefreshOutcome();
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(outcome).resolves.toEqual({ status: 'ended' });
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
      expect(getAccessToken()).toBeNull();
    });

    it('bounds each attempt with a 10 s timeout and retries after a timeout', async () => {
      const { axiosMock, getAccessToken, requestTokenRefreshOutcome } = await loadClients();
      const timeout = Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' });
      axiosMock.post.mockRejectedValueOnce(timeout).mockResolvedValueOnce(freshTokens);

      const outcome = requestTokenRefreshOutcome();
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(outcome).resolves.toMatchObject({ status: 'refreshed' });
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
      expect(axiosMock.post).toHaveBeenLastCalledWith(
        'http://localhost:8080/auth/refresh',
        {},
        { withCredentials: true, timeout: 10_000 },
      );
      expect(getAccessToken()).toBe('fresh-access-token');
    });

    it('waits as long as Retry-After asks on a 429, in seconds or as a date, capped at 60 s', async () => {
      vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
      const { axiosMock, getAccessToken, requestTokenRefreshOutcome } = await loadClients();
      axiosMock.post
        .mockRejectedValueOnce(rateLimited('5'))
        .mockRejectedValueOnce(rateLimited(new Date('2026-10-01T10:00:25Z').toUTCString()))
        .mockRejectedValueOnce(rateLimited('600'))
        .mockResolvedValueOnce(freshTokens);

      const outcome = requestTokenRefreshOutcome();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(axiosMock.post).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(axiosMock.post).toHaveBeenCalledTimes(2);

      // The date asks to wait until 10:00:25, 20 s after the second attempt.
      await vi.advanceTimersByTimeAsync(19_999);
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(axiosMock.post).toHaveBeenCalledTimes(3);

      // 600 s is capped at 60 s.
      await vi.advanceTimersByTimeAsync(59_999);
      expect(axiosMock.post).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(axiosMock.post).toHaveBeenCalledTimes(4);

      await expect(outcome).resolves.toMatchObject({ status: 'refreshed' });
      expect(getAccessToken()).toBe('fresh-access-token');
    });
  });

  describe('when the session is cleared while a refresh is in flight', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('stops retrying after a logout during the backoff, even once the server answers again', async () => {
      const { axiosMock, getAccessToken, setAccessToken, requestTokenRefreshOutcome, bumpSessionGeneration } =
        await loadClients();
      axiosMock.post.mockRejectedValueOnce(httpError(502)).mockResolvedValue(freshTokens);

      const outcome = requestTokenRefreshOutcome();
      await vi.advanceTimersByTimeAsync(0);
      expect(axiosMock.post).toHaveBeenCalledTimes(1);

      // Logout while the flight waits for its next attempt; the server is back with a 200.
      bumpSessionGeneration();
      setAccessToken(null);
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(outcome).resolves.toEqual({ status: 'superseded' });
      expect(axiosMock.post).toHaveBeenCalledTimes(1);
      expect(getAccessToken()).toBeNull();
    });

    it('drops a success that arrives after the session was cleared', async () => {
      const {
        axiosMock,
        getAccessToken,
        getRefreshTtlMs,
        setAccessToken,
        clearSessionActivity,
        requestTokenRefreshOutcome,
        bumpSessionGeneration,
      } = await loadClients();
      let answer!: (value: unknown) => void;
      axiosMock.post.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

      const outcome = requestTokenRefreshOutcome();
      bumpSessionGeneration();
      setAccessToken(null);
      clearSessionActivity();
      answer(freshTokens);

      await expect(outcome).resolves.toEqual({ status: 'superseded' });
      expect(getAccessToken()).toBeNull();
      expect(getRefreshTtlMs()).toBeNull();
    });

    it('starts a new refresh for the next session instead of joining the leftover flight', async () => {
      const { axiosMock, getAccessToken, requestTokenRefreshOutcome, bumpSessionGeneration } = await loadClients();
      axiosMock.post.mockRejectedValueOnce(httpError(502)).mockResolvedValue(freshTokens);

      const leftover = requestTokenRefreshOutcome();
      await vi.advanceTimersByTimeAsync(0);
      // Signed out and in again while the first flight waits.
      bumpSessionGeneration();
      const current = requestTokenRefreshOutcome();
      await vi.advanceTimersByTimeAsync(0);

      await expect(current).resolves.toMatchObject({ status: 'refreshed' });
      expect(getAccessToken()).toBe('fresh-access-token');

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(leftover).resolves.toEqual({ status: 'superseded' });
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('second client (api/client.ts)', () => {
    it('shares one refresh call with the main client for concurrent 401s', async () => {
      const { axiosMock, instances } = await loadClients();
      await import('./api/client');
      const [main, secondary] = instances;
      expect(secondary).toBeDefined();

      let resolveRefresh!: (value: unknown) => void;
      axiosMock.post.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));
      main.instance.request.mockResolvedValue({ data: 'main' });
      secondary.instance.request.mockResolvedValue({ data: 'secondary' });

      const results = Promise.all([
        main.onError(unauthorized('/master-data/companies')),
        secondary.onError(unauthorized('/assets')),
        secondary.onError(unauthorized('/interfaces')),
      ]);
      resolveRefresh(freshTokens);

      await expect(results).resolves.toEqual([{ data: 'main' }, { data: 'secondary' }, { data: 'secondary' }]);
      expect(axiosMock.post).toHaveBeenCalledTimes(1);
      expect(secondary.instance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/assets',
          headers: expect.objectContaining({ Authorization: 'Bearer fresh-access-token' }),
        }),
      );
    });

    it('no longer redirects to login when the refresh is refused; the session ends through the shared path', async () => {
      const location = { pathname: '/it/assets', href: 'http://acme.lvh.me/it/assets' };
      vi.stubGlobal('location', location);
      expect(window.location).toBe(location);

      const { axiosMock, instances, getAccessToken } = await loadClients();
      await import('./api/client');
      const secondary = instances[1];
      axiosMock.post.mockRejectedValue(httpError(401));

      const original = unauthorized('/assets');
      await expect(secondary.onError(original)).rejects.toBe(original);

      expect(location.href).toBe('http://acme.lvh.me/it/assets');
      expect(getAccessToken()).toBeNull();
    });

    it('tells the session-ended listeners when a refused refresh ends a live session, from either client', async () => {
      const { axiosMock, instances, setAccessToken, subscribeSessionEnded } = await loadClients();
      await import('./api/client');
      const [main, secondary] = instances;
      const ended = vi.fn();
      subscribeSessionEnded(ended);
      axiosMock.post.mockRejectedValue(httpError(401));

      await expect(secondary.onError(unauthorized('/assets'))).rejects.toBeDefined();
      expect(ended).toHaveBeenCalledTimes(1);

      // No session left to end: no second notice.
      await expect(main.onError(unauthorized('/master-data/companies'))).rejects.toBeDefined();
      expect(ended).toHaveBeenCalledTimes(1);

      setAccessToken('next-access-token', Date.now() + 60_000);
      await expect(main.onError(unauthorized('/master-data/companies'))).rejects.toBeDefined();
      expect(ended).toHaveBeenCalledTimes(2);
    });

    it('keeps the session when the server is unreachable', async () => {
      vi.useFakeTimers();
      try {
        const { axiosMock, instances, getAccessToken } = await loadClients();
        await import('./api/client');
        const secondary = instances[1];
        axiosMock.post.mockRejectedValue(httpError(503));

        const original = unauthorized('/assets');
        const settled = secondary.onError(original).catch((error) => error);
        await vi.advanceTimersByTimeAsync(12_000);

        expect(await settled).toBe(original);
        expect(axiosMock.post).toHaveBeenCalledTimes(4);
        expect(getAccessToken()).toBe('stale-access-token');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
