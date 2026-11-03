import { timingSafeEqual } from 'crypto';

/**
 * The links of the trial e-mails: unsubscribe, and the discovery call. A token is
 * `<tenant>.<link_token>`, the random secret stored in the workspace's `trial_mails` row. No
 * server key is involved and a token never expires: an unsubscribe link works as long as the
 * workspace exists, whatever key is changed.
 */

const TOKEN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{64})$/;

export function trialMailLinkToken(tenantId: string, linkToken: string): string {
  return `${tenantId.toLowerCase()}.${linkToken}`;
}

/** The tenant and the secret a token names, null when it is not shaped like one. Never throws. */
export function parseTrialMailLinkToken(token: unknown): { tenantId: string; linkToken: string } | null {
  if (typeof token !== 'string') return null;
  const match = TOKEN.exec(token.trim().toLowerCase());
  return match ? { tenantId: match[1], linkToken: match[2] } : null;
}

/** Whether a given secret is the stored one, in constant time. */
export function sameLinkToken(given: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The address of a link: the workspace's own, through the web server's `/api`. */
export function trialMailLinkUrl(appUrl: string, route: 'unsubscribe' | 'call', token: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams({ t: token, ...query });
  return `${appUrl.replace(/\/$/, '')}/api/trial-mails/${route}?${params.toString()}`;
}
