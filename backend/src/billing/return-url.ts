/**
 * Return URLs a client sends for the Stripe pages (checkout, card setup, portal). Stripe sends
 * the customer there after paying: a URL on another host would make KANAP an open redirect.
 */

/** Hosts served over plain http in local development. */
function isLocalHttpHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.lvh.me');
}

/** The host of the request as tenant resolution reads it: the Host header, without port, lowercase. */
export function requestHost(req: any): string {
  return String(req?.headers?.host ?? '').split(':')[0].trim().toLowerCase();
}

/**
 * A client return URL, kept only when it stays on the request's own host (the tenant host the
 * user is on), over https, or http on a local development host. Anything else gives null, and
 * the caller falls back to the configured URL. The URL is returned as sent (a Stripe template
 * such as `{CHECKOUT_SESSION_ID}` must not be encoded).
 */
export function sameHostReturnUrl(url: unknown, host: string): string | null {
  if (typeof url !== 'string' || !host) return null;
  const raw = url.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const protocolAllowed = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalHttpHost(host));
  if (!protocolAllowed || parsed.username || parsed.password) return null;
  return parsed.hostname.toLowerCase() === host ? raw : null;
}
