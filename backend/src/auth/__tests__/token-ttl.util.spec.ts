/**
 * Token durations: a valid value is read as written, an invalid one keeps the caller's
 * fallback (15 minutes when none is given), and the startup warning names the duration used.
 */
import * as assert from 'node:assert/strict';
import {
  DEFAULT_REFRESH_TOKEN_TTL,
  parseDurationMs,
  parseDurationSec,
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

console.log('token-ttl.util.spec: ok');
