import { createHmac, timingSafeEqual } from 'crypto';
import { getTrialMailLinkSecret } from '../../auth/token-secret.util';
import { isDiscoveryCallPlacement, type DiscoveryCallPlacement } from '../../discovery-call/discovery-call.service';

/**
 * The signed links of the trial e-mails: unsubscribe, and the discovery call with its placement.
 * A token is `<tenant>.<purpose>.<signature>`: an HMAC-SHA256, under the `trial-mail` family key
 * (`auth/token-secret.util.ts`), of the tenant and the purpose. Nothing is stored and a token never
 * expires: an unsubscribe link must work as long as the e-mail is read.
 */

export type TrialMailLinkPurpose = 'unsubscribe' | DiscoveryCallPlacement;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(tenantId: string, purpose: string, env: NodeJS.ProcessEnv): Buffer {
  return createHmac('sha256', getTrialMailLinkSecret(env)).update(['kanap-trial-mail', tenantId.toLowerCase(), purpose].join('\n'), 'utf8').digest();
}

export function signTrialMailLink(tenantId: string, purpose: TrialMailLinkPurpose, env: NodeJS.ProcessEnv = process.env): string {
  return `${tenantId.toLowerCase()}.${purpose}.${sign(tenantId, purpose, env).toString('base64url')}`;
}

/** The tenant and purpose of a valid token, null otherwise. Never throws on a bad token. */
export function verifyTrialMailLink(
  token: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { tenantId: string; purpose: TrialMailLinkPurpose } | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const match = /^([0-9a-fA-F-]{36})\.([a-z0-9_]{1,32})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || !UUID.test(match[1])) return null;
  const [, tenantId, purpose, signature] = match;
  if (purpose !== 'unsubscribe' && !isDiscoveryCallPlacement(purpose)) return null;
  const given = Buffer.from(signature, 'base64url');
  const expected = sign(tenantId, purpose, env);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { tenantId: tenantId.toLowerCase(), purpose: purpose as TrialMailLinkPurpose };
}

/** The address of a link: the workspace's own, through the web server's `/api`. */
export function trialMailLinkUrl(appUrl: string, route: 'unsubscribe' | 'call', token: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/trial-mails/${route}?t=${encodeURIComponent(token)}`;
}
