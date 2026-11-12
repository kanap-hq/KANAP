/**
 * The server sends a stored secret (token, key) only to the address it was saved for:
 * a new address empties it. These helpers tell a form when the typed address is a new
 * one, with the server's rules: host case, default port and trailing slash do not count.
 */
export function secretAddressKey(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return text.toLowerCase();
  }
}

export function isNewSecretAddress(typed: string | null | undefined, saved: string | null | undefined): boolean {
  return secretAddressKey(typed) !== secretAddressKey(saved);
}

/** The installation root of a GLPI address, as the server keeps it (API routes removed). */
export function glpiAddressRoot(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  try {
    const parsed = new URL(text);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname
      .replace(/\/+$/, '')
      .replace(/\/(?:apirest\.php|api\.php\/v1)(?:\/.*)?$/i, '') || '/';
    return parsed.toString();
  } catch {
    return text;
  }
}
