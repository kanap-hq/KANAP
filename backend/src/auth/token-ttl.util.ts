/** Duration parsing shared by every token family (access, refresh, reset, invitation). */

export const DEFAULT_ACCESS_TOKEN_TTL = '15m';
export const DEFAULT_REFRESH_TOKEN_TTL = '4h';
export const DEFAULT_PASSWORD_RESET_TTL = '1h';
export const DEFAULT_INVITE_LINK_TTL = '7d';

/** A whole number followed by s, m, h or d. `parseDurationMs` accepts nothing else. */
const TOKEN_DURATION = /^(\d+)(s|m|h|d)$/;

/**
 * Same timespan shape as the `ms` package `jwt.sign` uses for a string `expiresIn`
 * (`30m`, `2 hours`, `2 days`). A string longer than 100 characters is refused, as `ms` refuses it.
 */
const RESET_TIMESPAN = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Milliseconds of a token duration. A value that is not a whole number followed by s, m, h or d
 * returns `fallbackMs`: callers pass their family's own default (15 minutes when omitted).
 */
export function parseDurationMs(duration: string, fallbackMs = FIFTEEN_MINUTES_MS): number {
  const match = duration.match(TOKEN_DURATION);
  if (!match) return fallbackMs;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return fallbackMs;
  }
}

export function parseDurationSec(duration: string, fallbackMs = FIFTEEN_MINUTES_MS): number {
  return Math.floor(parseDurationMs(duration, fallbackMs) / 1000);
}

/**
 * Warning for an access or refresh lifetime `parseDurationMs` will not read.
 * An empty value keeps the family's own default and is not a warning. A value that does not
 * match also keeps the family's default (4 hours for the refresh token, 15 minutes for the
 * access token): the warning names that duration.
 */
export function tokenDurationWarning(
  name: 'JWT_ACCESS_TOKEN_TTL' | 'JWT_REFRESH_TOKEN_TTL',
  raw: string | undefined,
): string | null {
  if (raw == null || raw === '') return null;
  if (TOKEN_DURATION.test(raw)) return null;
  const refresh = name === 'JWT_REFRESH_TOKEN_TTL';
  const example = refresh ? DEFAULT_REFRESH_TOKEN_TTL : DEFAULT_ACCESS_TOKEN_TTL;
  const lasts = refresh ? '4 hours' : '15 minutes';
  return `[CONFIG] ${name} is ${JSON.stringify(raw)}: it is not a number followed by s, m, h or d, so the token lasts ${lasts}. Set ${name} to a duration such as ${example}.`;
}

/**
 * Lifetime passed to `jwt.sign` for a link that sets a password: a reset link
 * (`PASSWORD_RESET_TTL`, 1 hour) or an invitation link (`INVITE_LINK_TTL`, 7 days).
 *
 * A positive whole number is a number of seconds. Any other non-empty value is a timespan
 * string. `jwt.sign` throws on a number that is not an integer and on a string it cannot read,
 * so those values keep the family's default instead. Blank keeps it with no substitution to report.
 */
function parseLinkTtl(raw: string | undefined, fallback: string): string | number {
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && num > 0) {
    return Number.isInteger(num) ? num : fallback;
  }
  if (trimmed.length <= 100 && RESET_TIMESPAN.test(trimmed)) return trimmed;
  return fallback;
}

export function parsePasswordResetTtl(raw: string | undefined): string | number {
  return parseLinkTtl(raw, DEFAULT_PASSWORD_RESET_TTL);
}

export function parseInviteLinkTtl(raw: string | undefined): string | number {
  return parseLinkTtl(raw, DEFAULT_INVITE_LINK_TTL);
}

const MINUTES_PER_UNIT: Array<[RegExp, number]> = [
  [/^(ms|msecs?|milliseconds?)$/, 1 / 60000],
  [/^(s|secs?|seconds?)$/, 1 / 60],
  [/^(m|mins?|minutes?)$/, 1],
  [/^(h|hrs?|hours?)$/, 60],
  [/^(d|days?)$/, 24 * 60],
  [/^(w|weeks?)$/, 7 * 24 * 60],
  [/^(y|yrs?|years?)$/, 365.25 * 24 * 60],
];

/**
 * Whole minutes (at least 1) of a lifetime `parsePasswordResetTtl` or `parseInviteLinkTtl`
 * returned, read as `jwt.sign` reads it: a number is seconds, a string without a unit is
 * milliseconds. The e-mail that carries the link states this duration.
 */
export function linkTtlMinutes(ttl: string | number): number {
  if (typeof ttl === 'number') return Math.max(1, Math.round(ttl / 60));
  const match = ttl.trim().match(RESET_TIMESPAN);
  if (!match) return 1;
  const unit = (match[2] ?? 'ms').toLowerCase();
  const perUnit = MINUTES_PER_UNIT.find(([pattern]) => pattern.test(unit))?.[1] ?? 1 / 60000;
  return Math.max(1, Math.round(parseFloat(match[1]) * perUnit));
}

function linkTtlReplaced(raw: string | undefined, resolved: string | number): string | null {
  if (raw == null || raw.trim() === '') return null;
  const trimmed = raw.trim();
  const kept = typeof resolved === 'number' ? Number(trimmed) === resolved : resolved === trimmed;
  return kept ? null : trimmed;
}

/** Warning when a set `PASSWORD_RESET_TTL` is replaced by the 1 hour default. */
export function passwordResetTtlWarning(raw: string | undefined): string | null {
  const trimmed = linkTtlReplaced(raw, parsePasswordResetTtl(raw));
  if (trimmed == null) return null;
  return `[CONFIG] PASSWORD_RESET_TTL is ${JSON.stringify(trimmed)}: it is not a number of seconds or a duration such as 30m or 2h, so a reset link lasts 1 hour. Set PASSWORD_RESET_TTL to a duration such as ${DEFAULT_PASSWORD_RESET_TTL}.`;
}

/** Warning when a set `INVITE_LINK_TTL` is replaced by the 7 day default. */
export function inviteLinkTtlWarning(raw: string | undefined): string | null {
  const trimmed = linkTtlReplaced(raw, parseInviteLinkTtl(raw));
  if (trimmed == null) return null;
  return `[CONFIG] INVITE_LINK_TTL is ${JSON.stringify(trimmed)}: it is not a number of seconds or a duration such as 72h or 7d, so an invitation link lasts 7 days. Set INVITE_LINK_TTL to a duration such as ${DEFAULT_INVITE_LINK_TTL}.`;
}
