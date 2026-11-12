/**
 * A stored secret (token, API key, password) is sent only to the address it was entered
 * for. These helpers compare two addresses the way the request sees them: two spellings
 * of one address (host case, default port, trailing slash) are the same destination, any
 * other change of scheme, host, port, path or query is a new one.
 */

/** The comparable form of an address, or null when there is none. */
export function secretDestinationKey(value: string | null | undefined): string | null {
  const text = value == null ? '' : String(value).trim();
  if (!text) return null;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return text.toLowerCase();
  }
  // URL already lowercases the scheme and host and drops the default port.
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.host}${path}${parsed.search}`;
}

/** True when both values name the same destination (both empty included). */
export function sameSecretDestination(a: string | null | undefined, b: string | null | undefined): boolean {
  return secretDestinationKey(a) === secretDestinationKey(b);
}

/**
 * Destination of a model provider's key: the provider and its custom address. Some
 * providers ignore the address and call their own service, so a change of either
 * one is a new destination.
 */
export function modelKeyDestination(provider: string | null | undefined, endpointUrl: string | null | undefined): string {
  const name = provider == null ? '' : String(provider).trim().toLowerCase();
  return `${name}|${secretDestinationKey(endpointUrl) ?? ''}`;
}
