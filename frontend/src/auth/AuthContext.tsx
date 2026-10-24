import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api, {
  bumpSessionGeneration,
  getSessionGeneration,
  requestTokenRefreshOutcome,
  retryRefreshNow,
  subscribeRefreshFailure,
  subscribeSessionEnded,
  type RefreshOutcome,
} from '../api';
import {
  clearSessionActivity,
  getLastActivityAt,
  getRefreshTtlMs,
  isIdleExpired,
  setRefreshTtlMs,
  touchLastActivity,
} from './sessionStorage';
import { getAccessToken, getAccessTokenExpiresAt, setAccessToken, subscribeAccessToken } from './accessTokenStore';
import { changeAppLanguage, detectBrowserLocale, LANGUAGE_OVERRIDE_STORAGE_KEY, SupportedLocale } from '../i18n';
import { clearUserClientState } from './userClientState';
import { isDataAccessLimited, type DataAccessProfile } from './dataAccess';

type PermissionLevel = 'reader' | 'contributor' | 'member' | 'manager' | 'admin';
type Claims = {
  isGlobalAdmin: boolean;
  isBillingAdmin: boolean;
  isPlatformAdmin?: boolean;
  permissions: Record<string, PermissionLevel>;
};

type Profile = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  business_phone?: string | null;
  mobile_phone?: string | null;
  locale?: SupportedLocale | null;
  status: 'contact' | 'invited' | 'enabled' | 'disabled' | string;
  role?: string | null;
  roles?: Array<{ id: string; name: string }>;
  external_auth_provider?: string | null;
};

type Subscription = {
  plan_name?: string | null;
  seat_limit?: number | null;
  seats_used?: number;
  subscription_type?: 'monthly' | 'annual';
  payment_mode?: 'card' | 'bank_transfer';
  next_payment_at?: string | null;
  renewal_at?: string | null;
  status?: string | null;
  collection_method?: 'charge_automatically' | 'send_invoice' | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  trial_end?: string | null;
  cancel_at?: string | null;
  canceled_at?: string | null;
  currency?: string | null;
  amount?: number | null;
  amount_currency?: string | null;
  estimated_amount?: number | null;
  estimated_currency?: string | null;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  default_payment_method_id?: string | null;
  default_payment_method_brand?: string | null;
  default_payment_method_last4?: string | null;
  latest_invoice_id?: string | null;
  latest_invoice_status?: string | null;
  latest_invoice_number?: string | null;
  latest_invoice_url?: string | null;
  latest_invoice_pdf?: string | null;
  latest_invoice_amount?: number | null;
  latest_invoice_currency?: string | null;
  latest_invoice_created?: string | null;
  days_until_due?: number | null;
  last_payment_error_code?: string | null;
  last_payment_error_message?: string | null;
  last_synced_at?: string | null;
  stripe_subscription_id?: string | null;
  canceled_at_effective?: string | null;
  stripe_customer_id?: string | null;
  is_subscription_healthy?: boolean;
  trial_days_remaining?: number | null;
  payment_due_at?: string | null;
  freeze_effective_at?: string | null;
};

type TenantAuth = {
  sso_provider: 'none' | 'entra' | string;
  sso_enabled: boolean;
};

type LoginResponse = {
  access_token: string;
  expires_in: number;
  refresh_expires_in?: number;
};

type RefreshStatus = RefreshOutcome['status'];

type AuthContextType = {
  token: string | null;
  tokenExpiresAt: number | null;
  isAuthenticating: boolean;
  /** At load the server could not be reached while this browser holds a session: retrying. */
  serverUnavailable: boolean;
  /**
   * The server keeps answering the refresh with 429 (too many attempts): two in a row, or one that
   * asks for a wait over 3 s. Retrying after its wait; false again on any other answer.
   */
  refreshRateLimited: boolean;
  /** A refresh waiting between two attempts (at load) tries again now. */
  retryRefresh: () => void;
  /** The server ended the session (refused refresh, idle deadline): the login page says so. */
  sessionExpired: boolean;
  profile: Profile | null;
  claims: Claims | null;
  subscription: Subscription | null;
  tenantAuth: TenantAuth | null;
  /** Null until `/auth/me` answers, and for a server that does not send it: read as unscoped. */
  dataAccess: DataAccessProfile | null;
  login: (response: LoginResponse) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
  /**
   * 'ended' clears the session; 'unavailable' keeps it (server unreachable, retried later);
   * 'superseded' means the session was cleared meanwhile and nothing was applied.
   */
  refreshAccessToken: () => Promise<RefreshStatus>;
  hasLevel: (resource: string, level: PermissionLevel) => boolean;
  hasAnyAccess: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Reserved to people with access to all data (spec §2.7, `backend/src/data-access/data-access-reserved.inventory.ts`):
 * for a limited person these modules read as reader at most, so their edit commands are hidden and
 * their reads stay. Organisation data (companies, departments, cost centers, accounts and charts,
 * processes, dimensions), the budget settings (`budget_ops`: currencies, columns, freeze, default
 * allocation rule), persons and the tenant administration behind `users` (users, roles, audit log,
 * branding, scheduled tasks) and the AI administration.
 */
const DATA_ACCESS_RESERVED_WRITES = new Set([
  'companies', 'departments', 'cost_centers', 'accounts', 'business_processes', 'analytics',
  'budget_ops', 'users', 'ai_settings',
]);
/** Closed to a limited person entirely: the agent screens (spec §2.7). */
const DATA_ACCESS_RESERVED_MODULES = new Set(['ai_agents']);

function clearLegacyTokenStorage(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('token_expires_at');
}

function isLoginCallbackPath(pathname: string): boolean {
  return pathname === '/login/callback' || pathname.startsWith('/login/callback/');
}

// The activity markers survive a reload: this browser was signed in.
function hasStoredSession(): boolean {
  return getLastActivityAt() !== null || getRefreshTtlMs() !== null;
}

// Pause between two refresh rounds (each with its own backoff) while the server is unreachable at load.
const SERVER_RETRY_PAUSE_MS = 5_000;
// A single 429 with a short wait says nothing: the next attempt usually goes through.
const RATE_LIMIT_NOTICE_WAIT_MS = 3_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(() => getAccessTokenExpiresAt());
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [serverUnavailable, setServerUnavailable] = useState(false);
  const [refreshRateLimited, setRefreshRateLimited] = useState(false);
  // Consecutive 429 answers to the refresh.
  const rateLimitedInARowRef = useRef(0);
  // Ends the pause between two refresh rounds at load (the Retry button).
  const wakeBootstrapPauseRef = useRef<(() => void) | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [claims, setClaims] = useState<Claims | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [tenantAuth, setTenantAuth] = useState<TenantAuth | null>(null);
  const [dataAccess, setDataAccess] = useState<DataAccessProfile | null>(null);
  // The user whose state this tab holds: another user behind a new token drops it.
  const stateUserIdRef = useRef<string | null>(null);

  const clearRateLimited = useCallback(() => {
    rateLimitedInARowRef.current = 0;
    setRefreshRateLimited(false);
  }, []);

  const clearUserState = useCallback(() => {
    stateUserIdRef.current = null;
    clearUserClientState(queryClient);
  }, [queryClient]);

  const clearAuthState = useCallback((opts?: { clearActivity?: boolean }) => {
    bumpSessionGeneration();
    clearUserState();
    clearLegacyTokenStorage();
    if (opts?.clearActivity) {
      clearSessionActivity();
    }
    setAccessToken(null);
    setToken(null);
    setTokenExpiresAt(null);
    setProfile(null);
    setClaims(null);
    setSubscription(null);
    setTenantAuth(null);
    setDataAccess(null);
  }, [clearUserState]);

  const applyAccessToken = useCallback((accessToken: string, expiresIn: number, refreshExpiresIn?: number) => {
    const expiresAt = Date.now() + expiresIn * 1000;
    clearLegacyTokenStorage();
    if (refreshExpiresIn) {
      setRefreshTtlMs(refreshExpiresIn * 1000);
    }
    setAccessToken(accessToken, expiresAt);
    setToken(accessToken);
    setTokenExpiresAt(expiresAt);
  }, []);

  const logout = useCallback(async () => {
    // A refresh still retrying must not sign the user back in once the server answers.
    bumpSessionGeneration();
    try {
      await api.post('/auth/logout', {});
    } catch {
      // Ignore errors during logout
    }
    clearAuthState({ clearActivity: true });
  }, [clearAuthState]);

  const refreshMe = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.get('/auth/me');
      const userId: string | null = res.data?.profile?.id ?? null;
      // Signed in as someone else meanwhile (another tab shares the session cookie).
      if (userId && stateUserIdRef.current && stateUserIdRef.current !== userId) clearUserState();
      if (userId) stateUserIdRef.current = userId;
      setProfile(res.data?.profile ?? null);
      setClaims(res.data?.claims ?? null);
      setSubscription(res.data?.subscription ?? null);
      setTenantAuth(res.data?.tenantAuth ?? null);
      setDataAccess(res.data?.dataAccess ?? null);
    } catch (e: any) {
      // Log out only when the refresh behind this 401 ended the session (token cleared); an
      // unreachable server keeps it.
      if (e?.response?.status === 401 && !getAccessToken()) logout();
    }
  }, [token, logout, clearUserState]);

  const refreshAccessTokenInternal = useCallback(async (legacyRefreshToken?: string): Promise<RefreshStatus> => {
    if (isIdleExpired()) {
      clearAuthState({ clearActivity: true });
      return 'ended';
    }
    const generation = getSessionGeneration();
    try {
      const payload = legacyRefreshToken ? { refresh_token: legacyRefreshToken } : undefined;
      const outcome = await requestTokenRefreshOutcome(payload);
      // Unavailable: keep the session; the expiry timer and the 401 interceptor retry later.
      // Superseded: the session was cleared meanwhile; nothing to apply or clear.
      if (outcome.status === 'unavailable' || outcome.status === 'superseded') return outcome.status;
      clearRateLimited();
      if (outcome.status === 'ended' || isIdleExpired()) {
        clearAuthState({ clearActivity: true });
        return 'ended';
      }
      // Logout or idle expiry while the answer was on its way back: do not apply it.
      if (getSessionGeneration() !== generation) return 'superseded';
      applyAccessToken(outcome.data.access_token, outcome.data.expires_in, outcome.data.refresh_expires_in);
      return 'refreshed';
    } catch {
      clearAuthState({ clearActivity: true });
      return 'ended';
    }
  }, [applyAccessToken, clearAuthState, clearRateLimited]);

  const login = useCallback((response: LoginResponse) => {
    if (!response?.access_token || !Number.isFinite(response?.expires_in)) {
      clearAuthState({ clearActivity: true });
      return;
    }
    // A new session: a refresh started before it answers for the previous one.
    bumpSessionGeneration();
    clearUserState();
    setSessionExpired(false);
    setProfile(null);
    setClaims(null);
    setSubscription(null);
    setTenantAuth(null);
    setDataAccess(null);
    touchLastActivity();
    applyAccessToken(response.access_token, response.expires_in, response.refresh_expires_in);
    // refreshMe will be called by useEffect when token changes
  }, [applyAccessToken, clearAuthState, clearUserState]);

  const refreshAccessToken = useCallback(async (): Promise<RefreshStatus> => {
    return refreshAccessTokenInternal();
  }, [refreshAccessTokenInternal]);

  useEffect(() => {
    return subscribeAccessToken((next) => {
      setToken(next.token);
      setTokenExpiresAt(next.expiresAt);
    });
  }, []);

  // The server rate limits the refresh: the loading screen says so after two 429 in a row, or one
  // that asks for a long wait, until an attempt gets another answer.
  useEffect(() => subscribeRefreshFailure(({ rateLimited, waitMs }) => {
    if (!rateLimited) {
      clearRateLimited();
      return;
    }
    rateLimitedInARowRef.current += 1;
    if (rateLimitedInARowRef.current >= 2 || waitMs > RATE_LIMIT_NOTICE_WAIT_MS) setRefreshRateLimited(true);
  }), [clearRateLimited]);

  const retryRefresh = useCallback(() => {
    wakeBootstrapPauseRef.current?.();
    retryRefreshNow();
  }, []);

  // A refresh ended the session, possibly from a request interceptor: drop the identity and
  // let the login page say the session expired.
  useEffect(() => {
    return subscribeSessionEnded(() => {
      clearAuthState({ clearActivity: true });
      setSessionExpired(true);
    });
  }, [clearAuthState]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const legacyRefreshToken = localStorage.getItem('refresh_token') || undefined;
      clearLegacyTokenStorage();
      // The SSO callback route performs its own refresh-token exchange and login.
      // Running the normal bootstrap refresh here can race and wipe that state.
      if (isLoginCallbackPath(window.location.pathname)) {
        if (!cancelled) setIsAuthenticating(false);
        return;
      }
      if (isIdleExpired()) {
        clearAuthState({ clearActivity: true });
        if (!cancelled) setIsAuthenticating(false);
        return;
      }
      // Every sign-in writes the activity markers: without them (or a legacy token) this browser
      // holds no session, and a refresh would only fail.
      if (!hasStoredSession() && !legacyRefreshToken) {
        if (!cancelled) setIsAuthenticating(false);
        return;
      }
      let status = await refreshAccessTokenInternal(legacyRefreshToken);
      // Server unreachable (api restarting during a reload) while this browser holds a session:
      // keep trying instead of showing a login form that could not sign in either.
      while (status === 'unavailable' && hasStoredSession() && !cancelled) {
        setServerUnavailable(true);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SERVER_RETRY_PAUSE_MS);
          wakeBootstrapPauseRef.current = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wakeBootstrapPauseRef.current = null;
        if (cancelled) return;
        status = await refreshAccessTokenInternal(legacyRefreshToken);
      }
      if (!cancelled) {
        setServerUnavailable(false);
        clearRateLimited();
        setIsAuthenticating(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clearAuthState, clearRateLimited, refreshAccessTokenInternal]);

  useEffect(() => {
    // When token changes (e.g., reload with stored token), fetch /auth/me
    if (token) void refreshMe();
  }, [token, refreshMe]);

  useEffect(() => {
    if (!profile) return;

    if (profile.locale) {
      try {
        localStorage.setItem(LANGUAGE_OVERRIDE_STORAGE_KEY, profile.locale);
      } catch {
        // Ignore localStorage failures
      }
      void changeAppLanguage(profile.locale);
      return;
    }

    if (profile.locale === null) {
      try {
        localStorage.removeItem(LANGUAGE_OVERRIDE_STORAGE_KEY);
      } catch {
        // Ignore localStorage failures
      }
      void changeAppLanguage(detectBrowserLocale());
    }
  }, [profile]);

  const hasLevel = (resource: string, level: PermissionLevel) => {
    if (claims?.isGlobalAdmin || claims?.isPlatformAdmin) return true;
    if (isDataAccessLimited(dataAccess)) {
      if (DATA_ACCESS_RESERVED_MODULES.has(resource)) return false;
      if (DATA_ACCESS_RESERVED_WRITES.has(resource) && level !== 'reader') return false;
    }
    const map = claims?.permissions || {};
    // Support both 'member' (new) and 'manager' (legacy) - backend uses 'member' since RBAC overhaul
    const rank = { reader: 1, contributor: 2, member: 3, manager: 3, admin: 4 } as const;
    const current = map[resource as keyof typeof map] as PermissionLevel | undefined;
    if (!current) return false;
    return (rank[current] ?? 0) >= (rank[level] ?? 0);
  };

  // False only for a loaded identity whose roles grant no permission at all —
  // e.g. an SSO user auto-provisioned on first login, awaiting access.
  const hasAnyAccess = !claims
    ? true
    : !!(claims.isGlobalAdmin || claims.isPlatformAdmin || Object.keys(claims.permissions || {}).length > 0);

  const value = useMemo(
    () => ({ token, tokenExpiresAt, isAuthenticating, serverUnavailable, refreshRateLimited, retryRefresh, sessionExpired, profile, claims, subscription, tenantAuth, dataAccess, login, logout, refreshMe, refreshAccessToken, hasLevel, hasAnyAccess }),
    [token, tokenExpiresAt, isAuthenticating, serverUnavailable, refreshRateLimited, retryRefresh, sessionExpired, profile, claims, subscription, tenantAuth, dataAccess, login, logout, refreshMe, refreshAccessToken, hasLevel, hasAnyAccess]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
