import * as assert from 'node:assert/strict';
import { PORTFOLIO_PAIRS, settleMembership, STREAM_PAIR, type ParentOf } from '../record-membership';

// A stream belongs to its category, a department to its company (lot I7a of 26.12.1, P13): the rule
// alone, on values already read. Streams `ops-it` and `ops-biz` are both named "Ops", in the categories
// `it` and `biz`; departments `fin-a` and `fin-b` in the companies `a` and `b`.

const PARENTS: Record<string, string> = { 'ops-it': 'it', 'ops-biz': 'biz', 'dev-it': 'it', 'fin-a': 'a', 'fin-b': 'b' };
const parentOf: ParentOf = (_kind, id) => PARENTS[id];
const settle = (given: Record<string, unknown>, stored: Record<string, unknown> | null) => settleMembership(PORTFOLIO_PAIRS, given, stored, parentOf);

function testChildGivesItsParent() {
  const created = settle({ stream_id: 'ops-it', department_id: 'fin-b' }, null);
  assert.equal(created.conflict, null);
  assert.deepEqual(created.values, { stream_id: 'ops-it', category_id: 'it', department_id: 'fin-b', company_id: 'b' }, 'a new record');
  const updated = settle({ stream_id: 'ops-biz' }, { category_id: null, stream_id: null });
  assert.deepEqual(updated.values, { stream_id: 'ops-biz', category_id: 'biz' }, 'a record without a category');
  const emptied = settle({ stream_id: 'ops-it', category_id: '' }, null);
  assert.deepEqual(emptied.values, { stream_id: 'ops-it', category_id: 'it' }, 'an empty category given with the stream');
}

function testPairGivenTogether() {
  assert.deepEqual(settle({ category_id: 'it', stream_id: 'ops-it' }, null), { values: { category_id: 'it', stream_id: 'ops-it' }, conflict: null });
  const refused = settle({ category_id: 'biz', stream_id: 'ops-it' }, null);
  assert.deepEqual(refused.conflict && { ...refused.conflict, pair: refused.conflict.pair.kind }, { pair: 'stream', childId: 'ops-it', parentId: 'biz', childParentId: 'it' });
  const department = settle({ company_id: 'a', department_id: 'fin-b' }, { company_id: 'a', department_id: 'fin-a' });
  assert.equal(department.conflict?.pair.kind, 'department', 'a department of another company');
}

function testChildAloneAgainstStoredParent() {
  assert.equal(settle({ stream_id: 'dev-it' }, { category_id: 'it', stream_id: 'ops-it' }).conflict, null, 'a stream of the record category');
  const refused = settle({ stream_id: 'ops-biz' }, { category_id: 'it', stream_id: null });
  assert.equal(refused.conflict?.parentId, 'it', 'a stream of another category than the record');
  assert.deepEqual(settle({ stream_id: null }, { category_id: 'it', stream_id: 'ops-it' }).values, { stream_id: null }, 'the stream emptied');
}

function testParentChangedAlone() {
  assert.deepEqual(settle({ category_id: 'biz' }, { category_id: 'it', stream_id: 'ops-it' }).values, { category_id: 'biz', stream_id: null }, 'the stream of the old category is dropped');
  assert.deepEqual(settle({ category_id: null }, { category_id: 'it', stream_id: 'ops-it' }).values, { category_id: null, stream_id: null }, 'no category, no stream');
  assert.deepEqual(settle({ category_id: 'biz' }, { category_id: 'it', stream_id: 'ops-biz' }).values, { category_id: 'biz' }, 'a stream of the new category stays');
  assert.deepEqual(settle({ company_id: 'b' }, { company_id: 'a', department_id: 'fin-a' }).values, { company_id: 'b', department_id: null }, 'the department of the old company is dropped');
}

function testStoredDisagreementStaysWritable() {
  // A record saved before the rule, its stream of another category: written again as it is, or with
  // another field, it is accepted; the same values in another case too.
  const stored = { category_id: 'biz', stream_id: 'ops-it', company_id: 'a', department_id: 'fin-b' };
  assert.deepEqual(settle({}, stored), { values: {}, conflict: null }, 'another field');
  assert.equal(settle({ category_id: 'BIZ', stream_id: 'ops-it', company_id: 'a', department_id: 'fin-b' }, stored).conflict, null, 'the stored values sent again');
  assert.equal(settle({ category_id: 'it' }, stored).conflict, null, 'its category set to the stream one');
  assert.deepEqual(settle({ category_id: 'it' }, stored).values, { category_id: 'it' }, 'the stream stays');
  assert.notEqual(settle({ stream_id: 'dev-it' }, stored).conflict, null, 'a new stream is checked');
}

function testUnknownChildIsLeftToTheWrite() {
  assert.deepEqual(settleMembership([STREAM_PAIR], { stream_id: 'missing', category_id: 'it' }, null, parentOf), { values: { stream_id: 'missing', category_id: 'it' }, conflict: null });
}

const tests: Array<[string, () => void]> = [
  ['child gives its parent', testChildGivesItsParent],
  ['pair given together', testPairGivenTogether],
  ['child alone against the stored parent', testChildAloneAgainstStoredParent],
  ['parent changed alone', testParentChangedAlone],
  ['stored disagreement stays writable', testStoredDisagreementStaysWritable],
  ['unknown child left to the write', testUnknownChildIsLeftToTheWrite],
];

let failed = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${(error as Error).stack}`);
  }
}
if (failed > 0) process.exit(1);
