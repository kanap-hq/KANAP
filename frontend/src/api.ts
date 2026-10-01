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
 */
export type RefreshOutcome =
  | { status: 'refreshed'; data: RefreshResponse }
  | { status: 'ended' }
  | { status: 'unavailable' };

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

// Waits between refresh attempts when the server is down, restarting or rate limiting.
const REFRESH_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

export const api = axios.create({
  baseURL,
  withCredentials: true,
  // Hard ceiling so a stalled origin can never freeze the UI indefinitely (the
  // production proxy already cuts at ~100s / 524). Deliberately long-running
  // endpoints (agent poll/triage) override this per request.
  timeout: 120_000,
});

let refreshPromise: Promise<RefreshOutcome> | null = null;

function clearAuthSession(): RefreshOutcome {
  setAccessToken(null);
  clearSessionActivity();
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

// Only an explicit refusal ends the session. Network errors, 5xx and 429 are transient.
function refreshRefused(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 400 || status === 401 || status === 403;
}

async function performTokenRefresh(body?: { refresh_token?: string }): Promise<RefreshOutcome> {
  for (let attempt = 0; ; attempt += 1) {
    if (isIdleExpired()) {
      return clearAuthSession();
    }

    try {
      const response = await axios.post<RefreshResponse>(`${baseURL}/auth/refresh`, body ?? {}, {
        withCredentials: true,
      });
      return applyRefreshResponse(response.data);
    } catch (error) {
      if (refreshRefused(error)) {
        return clearAuthSession();
      }
      if (attempt >= REFRESH_RETRY_DELAYS_MS.length) {
        return { status: 'unavailable' };
      }
      await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAYS_MS[attempt]));
    }
  }
}

/** Single-flight token refresh shared by every caller (both axios clients, AuthContext, AI chat stream). */
export function requestTokenRefreshOutcome(body?: { refresh_token?: string }): Promise<RefreshOutcome> {
  if (!refreshPromise) {
    refreshPromise = performTokenRefresh(body).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
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
