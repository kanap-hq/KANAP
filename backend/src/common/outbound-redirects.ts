import { Features } from '../config/features';

/**
 * Redirects of the outbound calls that carry a secret (GLPI, PRTG, model providers).
 *
 * The fetch's own `redirect: 'follow'` keeps every custom header (`App-Token`,
 * `Session-Token`, `x-api-key`) when it moves to another origin, and only drops
 * `Authorization`. So redirects are read here, by hand: a redirect to the same
 * origin (scheme, host and port) is followed on-premise, as before; any other
 * redirect, and every redirect in multi-tenant mode, comes back to the caller as
 * the 3xx response itself, which the caller reports as an error. No request, and so
 * no header, ever leaves for another origin.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const MAX_SAME_ORIGIN_REDIRECTS = 5;
// Headers that describe a body: dropped when a redirect turns the request into a GET.
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length'];

export function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

function requestUrlOf(input: unknown): URL | null {
  if (typeof input === 'string' || input instanceof URL) {
    try {
      return new URL(String(input));
    } catch {
      return null;
    }
  }
  return null;
}

/** The address of a redirect on the same origin as `from`, or null when it is not one. */
export function sameOriginRedirectTarget(from: URL, location: string | null): URL | null {
  if (!location) return null;
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return null;
  }
  return next.origin === from.origin && next.origin !== 'null' ? next : null;
}

/**
 * `baseFetch`, with the redirect rule above. The response of a redirect that is not
 * followed is returned as it is (status 3xx): test it with isRedirectStatus.
 */
export function sameOriginRedirectFetch(baseFetch: typeof fetch): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    let url = requestUrlOf(input);
    let current: RequestInit = { ...(init ?? {}), redirect: 'manual' };
    if (!url) {
      // A Request object: sent once, its redirect never followed.
      return baseFetch(input, current);
    }
    for (let hop = 0; ; hop += 1) {
      const response = await baseFetch(url.toString(), current);
      if (!isRedirectStatus(response.status)) return response;
      // Read at call time: specs and on-premise installations set the mode.
      if (!Features.SINGLE_TENANT || hop >= MAX_SAME_ORIGIN_REDIRECTS) return response;
      const next = sameOriginRedirectTarget(url, response.headers.get('location'));
      if (!next) return response;

      const method = String(current.method ?? 'GET').toUpperCase();
      const toGet = (response.status === 303 && method !== 'GET' && method !== 'HEAD')
        || ((response.status === 301 || response.status === 302) && method === 'POST');
      if (toGet) {
        const headers = new Headers(current.headers);
        for (const name of BODY_HEADERS) headers.delete(name);
        current = { ...current, method: 'GET', body: undefined, headers };
      } else if (current.body != null && typeof current.body !== 'string') {
        // A body that cannot be sent twice (a stream): the redirect is not followed.
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      url = next;
    }
  }) as typeof fetch;
}
