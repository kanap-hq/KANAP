function isAuthPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/accept-invite'
  );
}

/**
 * Keeps a post-login destination on this origin and off the auth pages.
 * Signing in normally lands on the home page; this only guards the path the
 * SSO callback hands back so it can never send the user off-site.
 */
export function sanitizeLoginRedirect(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;

  const raw = value.trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;

  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || isAuthPath(url.pathname)) {
      return fallback;
    }

    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
}

const OAUTH_AUTHORIZE_PREFIX = '/oauth/authorize?';

/**
 * Where to go after signing in when the login page was opened by the consent page of an MCP
 * connection: only `/oauth/authorize?…` on this origin is kept, anything else lands on the home
 * page as before. Not a general return-to: signing in otherwise always opens the home page.
 */
export function oauthReturnPath(value: unknown): string {
  const path = sanitizeLoginRedirect(value, '');
  return path.startsWith(OAUTH_AUTHORIZE_PREFIX) ? path : '/';
}
