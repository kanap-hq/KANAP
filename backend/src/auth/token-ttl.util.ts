/** Duration parsing shared by every token family (access, refresh, reset). */

export const DEFAULT_ACCESS_TOKEN_TTL = '15m';
export const DEFAULT_REFRESH_TOKEN_TTL = '4h';
export const DEFAULT_PASSWORD_RESET_TTL = '1h';

/** A whole number followed by s, m, h or d. `parseDurationMs` accepts nothing else. */
const TOKEN_DURATION = /^(\d+)(s|m|h|d)$/;

/**
 * Same timespan shape as the `ms` package `jwt.sign` uses for a string `expiresIn`
 * (`30m`, `2 hours`, `2 days`). A string longer than 100 characters is refused, as `ms` refuses it.
 */
const RESET_TIMESPAN = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

export function parseDurationMs(duration: string): number {
  const match = duration.match(TOKEN_DURATION);
  if (!match) return 15 * 60 * 1000; // default 15 minutes
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}

export function parseDurationSec(duration: string): number {
  return Math.floor(parseDurationMs(duration) / 1000);
}

/**
 * Warning for an access or refresh lifetime `parseDurationMs` will not read.
 * An empty value keeps the family's own default and is not a warning. A value that does not
 * match stays 15 minutes for both families: that is what `parseDurationMs` returns.
 */
export function tokenDurationWarning(
  name: 'JWT_ACCESS_TOKEN_TTL' | 'JWT_REFRESH_TOKEN_TTL',
  raw: string | undefined,
): string | null {
  if (raw == null || raw === '') return null;
  if (TOKEN_DURATION.test(raw)) return null;
  const example = name === 'JWT_REFRESH_TOKEN_TTL' ? DEFAULT_REFRESH_TOKEN_TTL : DEFAULT_ACCESS_TOKEN_TTL;
  return `[CONFIG] ${name} is ${JSON.stringify(raw)}: it is not a number followed by s, m, h or d, so the token lasts 15 minutes. Set ${name} to a duration such as ${example}.`;
}

/**
 * Lifetime passed to `jwt.sign` for a password reset link.
 *
 * A positive whole number is a number of seconds. Any other non-empty value is a timespan
 * string. `jwt.sign` throws on a number that is not an integer and on a string it cannot read,
 * so those values last 1 hour instead. Blank stays 1 hour with no substitution to report.
 */
export function parsePasswordResetTtl(raw: string | undefined): string | number {
  if (raw == null) return DEFAULT_PASSWORD_RESET_TTL;
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_PASSWORD_RESET_TTL;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && num > 0) {
    return Number.isInteger(num) ? num : DEFAULT_PASSWORD_RESET_TTL;
  }
  if (trimmed.length <= 100 && RESET_TIMESPAN.test(trimmed)) return trimmed;
  return DEFAULT_PASSWORD_RESET_TTL;
}

/** Warning when a set `PASSWORD_RESET_TTL` is replaced by the 1 hour default. */
export function passwordResetTtlWarning(raw: string | undefined): string | null {
  if (raw == null || raw.trim() === '') return null;
  const trimmed = raw.trim();
  const resolved = parsePasswordResetTtl(raw);
  const kept = typeof resolved === 'number' ? Number(trimmed) === resolved : resolved === trimmed;
  if (kept) return null;
  return `[CONFIG] PASSWORD_RESET_TTL is ${JSON.stringify(trimmed)}: it is not a number of seconds or a duration such as 30m or 2h, so a reset link lasts 1 hour. Set PASSWORD_RESET_TTL to a duration such as ${DEFAULT_PASSWORD_RESET_TTL}.`;
}
