import axios, { type AxiosInstance, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { clearSessionActivity, isIdleExpired, setRefreshTtlMs } from './auth/sessionStorage';
import { getAccessToken, setAccessToken } from './auth/accessTokenStore';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

type RefreshResponse = {
  access_token: string;
  expires_in: number;
  refresh_expires_in?: number;
};

/**
 * - refreshed: a new access token is in place.
 * - ended: the server refused the refresh (or the session went idle); the session is cleared.
 * - unavailable: the server could not be reached after retries; the session is kept and the
 *   expiry timer or the next 401 tries again later.
 * - superseded: the session was cleared while the refresh was in flight (logout, idle expiry);
 *   the refresh stopped, its answer was dropped and nothing was touched.
 */
export type RefreshOutcome =
  | { status: 'refreshed'; data: RefreshResponse }
  | { status: 'ended' }
  | { status: 'unavailable' }
  | { status: 'superseded' };

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

// Waits between refresh attempts when the server is down, restarting or rate limiting.
const REFRESH_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
// A hung server must not hold an attempt until the proxy gives up (300 s); a timeout is retried.
const REFRESH_TIMEOUT_MS = 10_000;
// Ceiling for the wait a 429 asks for in Retry-After.
const MAX_RETRY_AFTER_MS = 60_000;

export const api = axios.create({
  baseURL,
  withCredentials: true,
  // Hard ceiling so a stalled origin can never freeze the UI indefinitely (the
  // production proxy already cuts at ~100s / 524). Deliberately long-running
  // endpoints (agent poll/triage) override this per request.
  timeout: 120_000,
});

let refreshFlight: { generation: number; promise: Promise<RefreshOutcome> } | null = null;

// Bumped on every session clear (logout, idle expiry, refused refresh). A refresh started under
// an older generation belongs to a session that no longer exists.
let sessionGeneration = 0;
const sessionEndedListeners = new Set<() => void>();

export function getSessionGeneration(): number {
  return sessionGeneration;
}

/** Call on every session clear: a refresh still in flight stops and its late answer is dropped. */
export function bumpSessionGeneration(): void {
  sessionGeneration += 1;
}

/** Notified when a refresh ends a session that held an access token (refused by the server, or idle). */
export function subscribeSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

function clearAuthSession(): RefreshOutcome {
  const hadSession = getAccessToken() !== null;
  bumpSessionGeneration();
  setAccessToken(null);
  clearSessionActivity();
  if (hadSession) {
    sessionEndedListeners.forEach((listener) => listener());
  }
  return { status: 'ended' };
}

function applyRefreshResponse(data: RefreshResponse): RefreshOutcome {
  if (!data?.access_token || !Number.isFinite(data?.expires_in)) {
    return clearAuthSession();
  }

  if (isIdleExpired()) {
    return clearAuthSession();
  }

  setAccessToken(data.access_token, Date.now() + data.expires_in * 1000);
  if (data.refresh_expires_in) {
    setRefreshTtlMs(data.refresh_expires_in * 1000);
  }
  return { status: 'refreshed', data };
}

type HttpErrorLike = { response?: { status?: number; headers?: Record<string, unknown> } } | null;

// A 4xx refusal ends the session, except 408 (timeout) and 429 (rate limit). Network errors,
// timeouts, 5xx, 408 and 429 are transient.
function refreshRefused(error: unknown): boolean {
  const status = (error as HttpErrorLike)?.response?.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

// On a 429 the server's Retry-After (seconds or HTTP date, capped) when it sends one; otherwise
// the backoff step.
function retryDelayMs(error: unknown, attempt: number): number {
  const backoff = REFRESH_RETRY_DELAYS_MS[attempt];
  const response = (error as HttpErrorLike)?.response;
  const retryAfter = String(response?.headers?.['retry-after'] ?? '').trim();
  if (response?.status !== 429 || !retryAfter) return backoff;
  const ms = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : backoff;
}

async function performTokenRefresh(generation: number, body?: { refresh_token?: string }): Promise<RefreshOutcome> {
  // The session was cleared while this refresh retried: stop, and drop whatever the server
  // answers so a late success cannot sign the user back in.
  const superseded = () => sessionGeneration !== generation;

  for (let attempt = 0; ; attempt += 1) {
    if (superseded()) {
      return { status: 'superseded' };
    }
    if (isIdleExpired()) {
      return clearAuthSession();
    }

    try {
      const response = await axios.post<RefreshResponse>(`${baseURL}/auth/refresh`, body ?? {}, {
        withCredentials: true,
        timeout: REFRESH_TIMEOUT_MS,
      });
      return superseded() ? { status: 'superseded' } : applyRefreshResponse(response.data);
    } catch (error) {
      if (superseded()) {
        return { status: 'superseded' };
      }
      if (refreshRefused(error)) {
        return clearAuthSession();
      }
      if (attempt >= REFRESH_RETRY_DELAYS_MS.length) {
        return { status: 'unavailable' };
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(error, attempt)));
    }
  }
}

/**
 * Single-flight token refresh shared by every caller (both axios clients, AuthContext, AI chat
 * stream). A flight left over from a cleared session is not joined: it ends as 'superseded'.
 */
export function requestTokenRefreshOutcome(body?: { refresh_token?: string }): Promise<RefreshOutcome> {
  if (!refreshFlight || refreshFlight.generation !== sessionGeneration) {
    const generation = sessionGeneration;
    const promise: Promise<RefreshOutcome> = performTokenRefresh(generation, body).finally(() => {
      if (refreshFlight?.promise === promise) refreshFlight = null;
    });
    refreshFlight = { generation, promise };
  }

  return refreshFlight.promise;
}

/** Same single flight; resolves null when no new token could be obtained, whatever the reason. */
export async function requestTokenRefresh(body?: { refresh_token?: string }): Promise<RefreshResponse | null> {
  const outcome = await requestTokenRefreshOutcome(body);
  return outcome.status === 'refreshed' ? outcome.data : null;
}

/**
 * Response-error interceptor shared by both axios clients: on a 401, refresh the access token
 * once (single flight) and replay the request on `instance`. Without a new token the request
 * fails with its original error.
 */
export async function refreshTokenAndRetry(error: any, instance: AxiosInstance) {
  const originalRequest = error?.config as RetryableRequestConfig | undefined;
  if (error?.response?.status !== 401 || !originalRequest || originalRequest._retry) {
    return Promise.reject(error);
  }

  const url = originalRequest.url || '';
  if (url.includes('/auth/refresh') || url.includes('/auth/login')) {
    return Promise.reject(error);
  }

  originalRequest._retry = true;

  const refreshed = await requestTokenRefresh();
  if (!refreshed) {
    return Promise.reject(error);
  }

  originalRequest.headers = originalRequest.headers || {};
  (originalRequest.headers as any).Authorization = `Bearer ${refreshed.access_token}`;

  return instance.request(originalRequest as AxiosRequestConfig);
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => refreshTokenAndRetry(error, api),
);

export default api;
