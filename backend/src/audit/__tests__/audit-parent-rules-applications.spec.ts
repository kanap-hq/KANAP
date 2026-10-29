import * as assert from 'node:assert/strict';
import { resolveRuleParent, type AuditParentRule } from '../audit-parent-rules';

// The deployment rule (`from: 'instance'`): an audit row names a deployment of an application in its
// payload, and its parent is that deployment's application, read at write time in the writer's
// tenant. A deployment that no longer exists gives no parent.
// This spec does not open the data source: it runs in the parallel (non-database) lane.

const APPLICATION = '11111111-1111-4111-8111-111111111111';
const INSTANCE = '22222222-2222-4222-8222-222222222222';
const OTHER_INSTANCE = '33333333-3333-4333-8333-333333333333';
const ASSIGNMENT = '44444444-4444-4444-8444-444444444444';

const RULE: AuditParentRule = { parentTable: 'technologies', from: 'instance', keys: ['app_instance_id'] };

function fakeManager(instances: Record<string, string>) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager: any = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      const id = String(params[0]);
      return instances[id] ? [{ application_id: instances[id] }] : [];
    },
  };
  return { queries, manager };
}

async function testResolve() {
  const { manager, queries } = fakeManager({ [INSTANCE]: APPLICATION });
  assert.deepEqual(
    await resolveRuleParent(manager, RULE, { table: 'app_asset_assignments', recordId: ASSIGNMENT, before: null, after: { app_instance_id: INSTANCE } }),
    { table: 'technologies', id: APPLICATION },
    'a creation names the application of its deployment',
  );
  assert.deepEqual(
    await resolveRuleParent(manager, RULE, { table: 'app_asset_assignments', recordId: ASSIGNMENT, before: { app_instance_id: INSTANCE }, after: null }),
    { table: 'technologies', id: APPLICATION },
    'a deletion reads the deployment of its before payload',
  );
  assert.equal(queries.length, 2, 'one lookup per write');
  assert.match(queries[0].sql, /FROM app_instances WHERE tenant_id = app_current_tenant\(\) AND id = \$1/, 'the lookup stays in the writer tenant');
  assert.deepEqual(queries[0].params, [INSTANCE]);

  assert.equal(
    await resolveRuleParent(manager, RULE, { table: 'app_asset_assignments', recordId: ASSIGNMENT, before: null, after: { app_instance_id: OTHER_INSTANCE } }),
    null,
    'a deployment that no longer exists gives no parent',
  );
  const before = queries.length;
  assert.equal(
    await resolveRuleParent(manager, RULE, { table: 'app_asset_assignments', recordId: ASSIGNMENT, before: null, after: { app_instance_id: 'not-a-uuid' } }),
    null,
    'a payload without a deployment id gives no parent',
  );
  assert.equal(
    await resolveRuleParent(manager, RULE, { table: 'app_asset_assignments', recordId: INSTANCE, before: null, after: { asset_id: APPLICATION } }),
    null,
    'record_id is never read as the deployment',
  );
  assert.equal(queries.length, before, 'no lookup without a deployment id');
}

async function run() {
  await testResolve();
  console.log('audit-parent-rules-applications.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
