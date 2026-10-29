import * as assert from 'node:assert/strict';
import { auditParentRuleTables, typedPayloadParent, type AuditParentRule } from '../audit-parent-rules';

// The typed payload rule (lot 2, linked records): the payload names a record by one key and its type
// by another (a task: `related_object_id` and `related_object_type`), so the parent table follows
// the type. The rule is pure; the task rule built on it and its SQL copy are checked by
// `audit-parent-rules-contracts-incidents.spec.ts`. This spec opens no database.

const RECORD = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const RULE = {
  from: 'payload_typed',
  keys: ['related_object_id'],
  typeKey: 'related_object_type',
  tables: { line: 'spend_items', asset: 'assets' },
} as const satisfies AuditParentRule;

function testTypedPayload() {
  assert.deepEqual(
    typedPayloadParent(RULE, { related_object_type: 'line', related_object_id: RECORD }, null),
    { table: 'spend_items', id: RECORD },
    'the type names the table, the key the record',
  );
  assert.deepEqual(
    typedPayloadParent(RULE, { related_object_type: 'asset', related_object_id: RECORD }, null),
    { table: 'assets', id: RECORD },
    'another type, another table',
  );
  assert.deepEqual(
    typedPayloadParent(RULE, null, { related_object_type: 'asset', related_object_id: RECORD }),
    { table: 'assets', id: RECORD },
    'a deletion reads the before payload',
  );
  assert.deepEqual(
    typedPayloadParent(
      RULE,
      { related_object_type: 'line', related_object_id: OTHER },
      { related_object_type: 'asset', related_object_id: RECORD },
    ),
    { table: 'spend_items', id: OTHER },
    'a task moved to another record names the record it is on after the write',
  );
  assert.deepEqual(
    typedPayloadParent(
      RULE,
      { related_object_type: 'project', related_object_id: OTHER },
      { related_object_type: 'asset', related_object_id: RECORD },
    ),
    { table: 'assets', id: RECORD },
    'an unknown type after falls back to the before payload, type and id together',
  );
  assert.equal(
    typedPayloadParent(RULE, { related_object_type: 'project', related_object_id: RECORD }, null),
    null,
    'a type absent from the map gives no parent',
  );
  assert.equal(
    typedPayloadParent(RULE, { related_object_type: 'line', related_object_id: 'not-a-uuid' }, null),
    null,
    'an id that is not a uuid gives no parent',
  );
  assert.equal(typedPayloadParent(RULE, { related_object_id: RECORD }, null), null, 'no type, no parent');
  assert.equal(
    typedPayloadParent(RULE, { related_object_type: 'constructor', related_object_id: RECORD }, null),
    null,
    'a prototype key is not a type',
  );
  assert.equal(typedPayloadParent(RULE, [RECORD], null), null, 'an array payload names no record');
  console.log('  typed payload: type and id from one payload, after then before: OK');
}

function testTables() {
  assert.deepEqual(auditParentRuleTables(RULE), ['assets', 'spend_items'], 'every table of a typed rule, sorted');
  assert.deepEqual(
    auditParentRuleTables({ parentTable: 'assets', from: 'payload', keys: ['asset_id'] }),
    ['assets'],
    'a plain rule names its one table',
  );
  console.log('  rule tables: OK');
}

function run() {
  console.log('typed audit parent rule');
  testTypedPayload();
  testTables();
  console.log('audit-parent-rules-typed.spec: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
