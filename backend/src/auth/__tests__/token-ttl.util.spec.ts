/**
 * Token durations: a valid value is read as written, an invalid one keeps the caller's
 * fallback (15 minutes when none is given), and the startup warning names the duration used.
 */
import * as assert from 'node:assert/strict';
import {
  DEFAULT_REFRESH_TOKEN_TTL,
  inviteLinkTtlWarning,
  linkTtlMinutes,
  parseDurationMs,
  parseDurationSec,
  parseInviteLinkTtl,
  parsePasswordResetTtl,
  passwordResetTtlWarning,
  tokenDurationWarning,
} from '../token-ttl.util';

const MIN = 60 * 1000;
const FOUR_HOURS = 4 * 60 * MIN;

assert.equal(parseDurationMs('30s'), 30 * 1000);
assert.equal(parseDurationMs('15m'), 15 * MIN);
assert.equal(parseDurationMs('4h'), FOUR_HOURS);
assert.equal(parseDurationMs('2d'), 2 * 24 * 60 * MIN);
assert.equal(parseDurationMs('4h', 1), FOUR_HOURS, 'a valid value ignores the fallback');

assert.equal(parseDurationMs('4 hours'), 15 * MIN, 'no fallback: 15 minutes');
assert.equal(parseDurationMs(''), 15 * MIN);
const refreshFallback = parseDurationMs(DEFAULT_REFRESH_TOKEN_TTL);
assert.equal(refreshFallback, FOUR_HOURS);
assert.equal(parseDurationMs('4 hours', refreshFallback), FOUR_HOURS);
assert.equal(parseDurationMs('1.5h', refreshFallback), FOUR_HOURS);
assert.equal(parseDurationSec('4 hours', refreshFallback), 4 * 60 * 60);
assert.equal(parseDurationSec('4 hours'), 15 * 60);

assert.equal(tokenDurationWarning('JWT_REFRESH_TOKEN_TTL', undefined), null);
assert.equal(tokenDurationWarning('JWT_REFRESH_TOKEN_TTL', ''), null);
assert.equal(tokenDurationWarning('JWT_REFRESH_TOKEN_TTL', '8h'), null);
assert.equal(
  tokenDurationWarning('JWT_REFRESH_TOKEN_TTL', '4 hours'),
  '[CONFIG] JWT_REFRESH_TOKEN_TTL is "4 hours": it is not a number followed by s, m, h or d, so the token lasts 4 hours. Set JWT_REFRESH_TOKEN_TTL to a duration such as 4h.',
);
assert.equal(
  tokenDurationWarning('JWT_ACCESS_TOKEN_TTL', '15 minutes'),
  '[CONFIG] JWT_ACCESS_TOKEN_TTL is "15 minutes": it is not a number followed by s, m, h or d, so the token lasts 15 minutes. Set JWT_ACCESS_TOKEN_TTL to a duration such as 15m.',
);

// Links that set a password: a reset link lasts 1 hour, an invitation 7 days, each by default.
assert.equal(parsePasswordResetTtl(undefined), '1h');
assert.equal(parseInviteLinkTtl(undefined), '7d');
assert.equal(parseInviteLinkTtl('  '), '7d');
assert.equal(parseInviteLinkTtl('72h'), '72h');
assert.equal(parseInviteLinkTtl('86400'), 86400);
assert.equal(parseInviteLinkTtl('1.5'), '7d', 'jwt.sign refuses a fraction of a second');
assert.equal(parseInviteLinkTtl('next week'), '7d');
assert.equal(parsePasswordResetTtl('next week'), '1h');

// The e-mail states the lifetime in minutes, read as jwt.sign reads it.
assert.equal(linkTtlMinutes('7d'), 7 * 24 * 60);
assert.equal(linkTtlMinutes('1h'), 60);
assert.equal(linkTtlMinutes('30m'), 30);
assert.equal(linkTtlMinutes('2 days'), 2 * 24 * 60);
assert.equal(linkTtlMinutes('1w'), 7 * 24 * 60);
assert.equal(linkTtlMinutes('90 mins'), 90);
assert.equal(linkTtlMinutes('1.5h'), 90);
assert.equal(linkTtlMinutes(3600), 60, 'a number is seconds');
assert.equal(linkTtlMinutes(20), 1, 'at least one minute');

assert.equal(inviteLinkTtlWarning(undefined), null);
assert.equal(inviteLinkTtlWarning('72h'), null);
assert.equal(inviteLinkTtlWarning('86400'), null);
assert.equal(
  inviteLinkTtlWarning('next week'),
  '[CONFIG] INVITE_LINK_TTL is "next week": it is not a number of seconds or a duration such as 72h or 7d, so an invitation link lasts 7 days. Set INVITE_LINK_TTL to a duration such as 7d.',
);
assert.equal(
  passwordResetTtlWarning('soon'),
  '[CONFIG] PASSWORD_RESET_TTL is "soon": it is not a number of seconds or a duration such as 30m or 2h, so a reset link lasts 1 hour. Set PASSWORD_RESET_TTL to a duration such as 1h.',
);

console.log('token-ttl.util.spec: ok');
