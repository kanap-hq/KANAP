import * as assert from 'node:assert/strict';
import {
  DEADLINE_FILTER_FIELDS,
  DEADLINE_SORTS,
  GAP_FILTER_FIELDS,
  GAP_SORTS,
} from '../query/ai-support.query';
import { supportDeadlinesRegistry } from '../query/registries/support-deadlines.registry';
import { supportGapsRegistry } from '../query/registries/support-gaps.registry';

/**
 * The in-memory filters and sorts of the two End of support report families: `ai-support.query.ts`
 * applies exactly the fields and sorts their registries advertise. The integration contract spec
 * cannot see this (the statements never change), so it is checked here, without a database.
 */

function testGapFieldsAndSortsMatchTheRegistry() {
  assert.deepEqual(
    [...GAP_FILTER_FIELDS].sort(),
    Object.keys(supportGapsRegistry.fields).sort(),
    'every gap filter field is applied, and no other',
  );
  assert.deepEqual(
    [...GAP_SORTS].sort(),
    Object.keys(supportGapsRegistry.sortFields).sort(),
    'every gap sort is applied, and no other',
  );
  assert.ok(GAP_SORTS.has(supportGapsRegistry.defaultSort.field), 'the default sort is one of them');
}

function testDeadlineFieldsAndSortsMatchTheRegistry() {
  assert.deepEqual(
    [...DEADLINE_FILTER_FIELDS].sort(),
    Object.keys(supportDeadlinesRegistry.fields).sort(),
    'every deadline filter field is applied, and no other',
  );
  assert.deepEqual(
    [...DEADLINE_SORTS].sort(),
    Object.keys(supportDeadlinesRegistry.sortFields).sort(),
    'every deadline sort is applied, and no other',
  );
  assert.ok(DEADLINE_SORTS.has(supportDeadlinesRegistry.defaultSort.field), 'the default sort is one of them');
}

testGapFieldsAndSortsMatchTheRegistry();
testDeadlineFieldsAndSortsMatchTheRegistry();
console.log('ai-support.contract.spec: ok');
