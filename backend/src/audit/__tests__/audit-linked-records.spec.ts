import * as assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';
import { auditLinkedIds, loadAuditLinkedRecords } from '../audit-linked-records';

// The audit log detail names the records a budget line's link entry holds as bare ids: both
// sides together, read against both record kinds, scoped by tenant; any other entry reads nothing.

const TENANT = '00000000-0000-4000-8000-000000000001';
const APP = 'aaaaaaaa-0000-4000-8000-000000000001';
const LINE = 'bbbbbbbb-0000-4000-8000-000000000002';
const GONE = 'cccccccc-0000-4000-8000-000000000003';

assert.deepEqual(
  auditLinkedIds({ table_name: 'application_spend_items', before_json: [APP.toUpperCase()], after_json: [APP, GONE, 'x'] }),
  [APP, GONE],
  'both sides, ids only, once each',
);
assert.deepEqual(auditLinkedIds({ table_name: 'spend_items', before_json: [APP], after_json: null }), [], 'other tables read nothing');

async function main() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('FROM technologies')) return [{ id: APP, ref: 'TEC-4', name: ' Oracle Database ' }];
      if (sql.includes('FROM spend_items')) return [{ id: LINE, ref: 'BL-9', name: 'Support' }];
      return [];
    },
  } as unknown as EntityManager;

  const records = await loadAuditLinkedRecords(manager, TENANT, {
    table_name: 'technology_spend_items',
    before_json: [],
    after_json: [APP, LINE, GONE],
  });
  assert.deepEqual(records, {
    [APP]: { ref: 'TEC-4', name: 'Oracle Database' },
    [LINE]: { ref: 'BL-9', name: 'Support' },
  });
  assert.equal(calls.length, 2, 'one query per record kind');
  for (const call of calls) {
    assert.match(call.sql, /tenant_id = \$1/);
    assert.deepEqual(call.params, [TENANT, [APP, LINE, GONE].sort()]);
  }
  assert.match(calls[1].sql, /nature IN/, 'a query on spend_items names the nature');

  calls.length = 0;
  assert.equal(await loadAuditLinkedRecords(manager, TENANT, { table_name: 'applications', before_json: {}, after_json: {} }), undefined);
  assert.deepEqual(await loadAuditLinkedRecords(manager, TENANT, { table_name: 'application_capex_items', before_json: [], after_json: [] }), {});
  assert.equal(calls.length, 0, 'nothing to read, no query');
  console.log('audit-linked-records.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
