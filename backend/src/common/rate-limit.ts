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
  /**
   * Password sign-in (`POST /auth/login`), per client address: the staff of one organisation
   * often share one outbound address, so the budget is the one of the sign-in with Microsoft.
   * Repeated refusals for one account are limited apart (`authLoginFailures`).
   */
  authLogin: { limit: 60, ttl: 60_000 },
  /**
   * Password sign-in attempts per account and client address (auth/login-attempt-limit.ts): five
   * refused attempts within 15 minutes, then the pair is refused for 15 minutes. A successful
   * sign-in clears the count of its pair, so only refused attempts add up.
   */
  authLoginFailures: { limit: 5, ttl: 15 * 60_000 },
  /**
   * Sign-in with Microsoft (`GET /auth/entra/callback`, `POST /auth/entra/session`): every
   * successful sign-in passes through both routes, and the staff of one organisation often share
   * one outbound address, so this budget is a wide one.
   */
  ssoSignIn: { limit: 60, ttl: 60_000 },
  authRefresh: { limit: 20, ttl: 60_000 },
  /**
   * MCP OAuth (ai/oauth): the authorization routes, opened in the user's browser, and the token
   * and revocation routes, called by the MCP client's servers. Claude's servers share a small range
   * of outbound addresses for all its users, so the token budget is a wide one.
   */
  mcpOAuthAuthorize: { limit: 30, ttl: 60_000 },
  mcpOAuthToken: { limit: 60, ttl: 60_000 },
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
  /**
   * "Send link" e-mails of every object, per user and one budget for all the share routes
   * (`ShareRateLimit`, notifications/share-rate-limit.ts).
   */
  shareLink: { limit: 30, ttl: 60 * 60_000 },
};
