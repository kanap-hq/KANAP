import * as assert from 'node:assert/strict';
import { recordHistoryEntry } from '../record-history.inventory';
import type { FamilyKey } from '../record-history/families';
import {
  presentItem,
  type AuditRow,
  type PageContext,
} from '../record-history/presenters';

// The history presenter of a budget line (issue 1150): a version is named by its year, and the
// dimensions of a creation carry no before. No database: the page context is given.

const LINE = 'aaaaaaaa-1111-4111-8111-111111111111';
const VERSION = 'bbbbbbbb-2222-4222-8222-222222222222';
const AXIS = 'cccccccc-3333-4333-8333-333333333333';
const CLOUD = 'dddddddd-4444-4444-8444-444444444444';
const ON_PREMISE = 'eeeeeeee-5555-4555-8555-555555555555';

function row(overrides: Partial<AuditRow>): AuditRow {
  return {
    id: 'audit-1',
    table_name: 'spend_versions',
    record_id: VERSION,
    action: 'create',
    before_json: null,
    after_json: null,
    user_id: null,
    source: 'system',
    created_at: '2026-10-15T12:34:00.000Z',
    created_at_text: '2026-10-15T12:34:00.000Z',
    ...overrides,
  };
}

function context(versions: PageContext['versions'] = new Map()): PageContext {
  return {
    entry: recordHistoryEntry('spend_items')!,
    recordId: LINE,
    users: new Map(),
    versions,
    references: new Map(),
    deleted: new Map(),
    readable: {} as Record<FamilyKey, boolean>,
    dimensions: new Map([[AXIS, 'Cost pool']]),
    categories: new Map([[CLOUD, 'Cloud'], [ON_PREMISE, 'On premise']]),
    entityLabels: new Map(),
  };
}

function testVersionYear() {
  const loaded = new Map([[VERSION, { name: 'Y2027', year: 2027 }]]);
  const created = presentItem(row({
    after_json: { version_name: 'Y2027', budget_year: 2027 },
  }), recordHistoryEntry('spend_items')!, context(loaded));
  assert.equal(created.subject.kind, 'version');
  assert.equal(created.subject.label, '2027', 'the stored name Y2027 is not the label');
  assert.deepEqual(created.changes, [], 'a creation stays a title');

  const updated = presentItem(row({
    action: 'update',
    before_json: { version_name: 'Custom name', input_grain: 'monthly' },
    after_json: { version_name: 'Custom name', input_grain: 'annual' },
  }), recordHistoryEntry('spend_items')!, context(loaded));
  assert.equal(updated.subject.label, '2027', 'an update uses the year loaded with the version');

  const deleted = presentItem(row({
    action: 'delete',
    before_json: { version_name: 'Y2027', budget_year: '2027' },
    after_json: null,
  }), recordHistoryEntry('spend_items')!, context());
  assert.equal(deleted.subject.label, '2027', 'a deleted version keeps the year from its payload');

  const unnamed = presentItem(row({
    after_json: { version_name: 'Y2027' },
  }), recordHistoryEntry('spend_items')!, context());
  assert.equal(unnamed.subject.label, undefined, 'without a year the stored name is not shown');
  console.log('  a version is named by its year: OK');
}

function testDimensionCreation() {
  const entry = recordHistoryEntry('spend_items')!;
  const created = presentItem(row({
    table_name: 'spend_items',
    record_id: LINE,
    action: 'create',
    after_json: { analytics_values: { [AXIS]: CLOUD }, product_name: 'Main line' },
  }), entry, context());
  const dimension = created.changes.find((change) => change.field === 'dimension');
  assert.ok(dimension, 'the creation names the dimension');
  assert.equal(Object.prototype.hasOwnProperty.call(dimension, 'before'), false, 'a creation has no before');
  assert.equal(dimension.dimension, 'Cost pool');
  assert.equal(dimension.after, 'Cloud');

  const updated = presentItem(row({
    table_name: 'spend_items',
    record_id: LINE,
    action: 'update',
    before_json: { analytics_values: { [AXIS]: CLOUD } },
    after_json: { analytics_values: { [AXIS]: ON_PREMISE } },
  }), entry, context());
  const changed = updated.changes.find((change) => change.field === 'dimension');
  assert.ok(changed, 'an update names the dimension');
  assert.equal(changed.before, 'Cloud');
  assert.equal(changed.after, 'On premise');
  console.log('  a creation names a dimension without a before: OK');
}

function run() {
  console.log('record history presenters');
  testVersionYear();
  testDimensionCreation();
  console.log('record-history-presenters.spec: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
