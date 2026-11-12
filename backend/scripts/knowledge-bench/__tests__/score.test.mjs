import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreResults, verdictOf } from '../lib/score.mjs';

const run = (overrides = {}) => ({
  merged: ['x', 'y', 'z', 'w', 'v', 'good'].map((key, i) => ({ rank: i + 1, key })),
  read: [],
  reply: null,
  cited: [],
  ...overrides,
});
const ticket = { n: 1, family: 'same_language', expected: ['good'] };

test('the loss stage follows the chain', () => {
  assert.equal(verdictOf(ticket, run({ merged: [{ key: 'x' }] })).loss_stage, 'never_found');
  assert.equal(verdictOf(ticket, run()).loss_stage, 'outside_top5');
  const inTop = run({ merged: [{ key: 'good' }, { key: 'x' }] });
  assert.equal(verdictOf(ticket, inTop).loss_stage, 'not_retained');
  assert.equal(verdictOf(ticket, { ...inTop, read: ['good'] }).loss_stage, 'no_reply');
  assert.equal(verdictOf(ticket, { ...inTop, read: ['good'], reply: { body: 'x' } }).loss_stage, 'not_cited');
  const hit = verdictOf(ticket, { ...inTop, read: ['good'], reply: { body: 'x' }, cited: ['good'] });
  assert.deepEqual([hit.top5, hit.cited, hit.loss_stage, hit.expected_rank], [true, true, null, 1]);
});

test('a document found outside the first five and still cited counts as cited, not in the first five', () => {
  const v = verdictOf(ticket, run({ read: ['good'], reply: { body: '' }, cited: ['good'] }));
  assert.deepEqual([v.top5, v.cited, v.expected_rank], [false, true, 6]);
});

test('abstention: nothing cited, or only an acceptable document; a forbidden citation is flagged', () => {
  const none = { n: 2, family: 'stale_doc', expected: [], forbidden: ['old'], acceptable: ['current'] };
  assert.equal(verdictOf(none, run()).abstention, true);
  assert.equal(verdictOf(none, run({ cited: ['current'] })).abstention, true);
  const bad = verdictOf(none, run({ cited: ['old'] }));
  assert.deepEqual([bad.abstention, bad.forbidden_cited, bad.top5, bad.cited], [false, true, null, null]);
});

test('a failed run misses every number it is counted in', () => {
  assert.deepEqual(verdictOf(ticket, { error: 'HTTP 500' }).cited, false);
  assert.equal(verdictOf({ ...ticket, expected: [] }, { error: 'x' }).abstention, false);
});

test('scores add up per family and in total', () => {
  const results = [
    { n: 1, family: 'paraphrase', verdict: { top5: true, cited: true, abstention: null, loss_stage: null }, cost_usd: 0.01, duration_ms: 10 },
    { n: 2, family: 'paraphrase', verdict: { top5: false, cited: false, abstention: null, loss_stage: 'never_found' }, cost_usd: 0.01, duration_ms: 30 },
    { n: 3, family: 'no_answer', verdict: { top5: null, cited: null, abstention: true, loss_stage: null }, cost_usd: 0.02, duration_ms: 20 },
  ];
  const s = scoreResults(results);
  assert.deepEqual(s.byFamily.paraphrase.cited, { hits: 1, total: 2 });
  assert.deepEqual(s.total.abstention, { hits: 1, total: 1 });
  assert.deepEqual(s.losses, { never_found: [2] });
  assert.equal(s.total.median_ms, 20);
  assert.equal(Number(s.total.cost_usd.toFixed(2)), 0.04);
});
