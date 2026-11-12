import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTransientFailure } from '../lib/player.mjs';

test('an API outage is transient, an answer of the chain is not', () => {
  assert.equal(isTransientFailure(new TypeError('fetch failed')), true);
  assert.equal(isTransientFailure(Object.assign(new Error('x'), { status: 502 })), true);
  assert.equal(isTransientFailure(Object.assign(new Error('x'), { status: 503 })), true);
  assert.equal(isTransientFailure(Object.assign(new Error('x'), { status: 500 })), false);
  assert.equal(isTransientFailure(Object.assign(new Error('x'), { status: 403 })), false);
});
