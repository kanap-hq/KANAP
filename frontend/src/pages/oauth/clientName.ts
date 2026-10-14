/** Longest client name shown: the name comes from a document the client publishes itself. */
export const CLIENT_NAME_MAX_LENGTH = 60;

/**
 * The name an MCP client gives itself, cut to 60 characters. Always rendered as text (React
 * escapes it); null when the client gave none, so the caller shows its own fallback.
 */
export function clientDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return name.length > CLIENT_NAME_MAX_LENGTH ? `${name.slice(0, CLIENT_NAME_MAX_LENGTH - 1)}…` : name;
}
