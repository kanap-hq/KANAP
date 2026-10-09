import { parseBoolean } from './env';

function parseEnvBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return parseBoolean(raw);
}

export function isRateLimitEnabled(): boolean {
  return parseEnvBoolean(process.env.RATE_LIMIT_ENABLED, true);
}

// The limits count per client address: see common/client-address.ts (RATE_LIMIT_TRUST_PROXY).

// TTL values are in milliseconds.
export const RATE_LIMITS = {
  authLogin: { limit: 5, ttl: 60_000 },
  /**
   * Sign-in with Microsoft (`GET /auth/entra/callback`, `POST /auth/entra/session`): every
   * successful sign-in passes through both routes, and the staff of one organisation often share
   * one outbound address, so this budget is wider than the password sign-in's.
   */
  ssoSignIn: { limit: 60, ttl: 60_000 },
  authRefresh: { limit: 20, ttl: 60_000 },
  authProvisioningExchange: { limit: 5, ttl: 10 * 60_000 },
  authPasswordResetRequest: { limit: 3, ttl: 15 * 60_000 },
  authPasswordResetComplete: { limit: 5, ttl: 10 * 60_000 },
  publicStartTrial: { limit: 5, ttl: 10 * 60_000 },
  publicContact: { limit: 5, ttl: 10 * 60_000 },
  publicRequestSupportInvoice: { limit: 3, ttl: 10 * 60_000 },
  documentExport: { limit: 5, ttl: 60_000 },
  documentImport: { limit: 5, ttl: 60_000 },
  /**
   * Saved list filters, per user (`UserRateLimitGuard`): the grid saves one state per distinct
   * large filter, clicks batched after 300 ms of quiet, so a minute of continuous clicking stays
   * under it.
   */
  listContextSave: { limit: 60, ttl: 60_000 },
  /** Sample data load, reset and banner dismissal, per user (`UserRateLimitGuard`). */
  sampleDataAction: { limit: 10, ttl: 10 * 60_000 },
};
