import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES, resolveAuditParent, resolveRuleParent, type AuditParentRule } from '../audit-parent-rules';
import { RECORD_HISTORY, recordHistoryPayloadKeyReads } from '../record-history.inventory';
import { applicationsParentRules } from '../record-history/records/applications';

// The deployment rule (`from: 'instance'`): an audit row names a deployment of an application in its
// payload, and its parent is that deployment's application, read at write time in the writer's
// tenant. A deployment that no longer exists gives no parent. The application's rules and their
// SQL copy in `1855910000000-audit-log-parent-applications.ts` agree: labels, keys, the deployment
// join in the row's tenant, and the partial index of the payload-key reads.
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

const MIGRATION_PATH = backendPath('src', 'migrations', '1855910000000-audit-log-parent-applications.ts');
const MIGRATION_TEXT = () => fs.readFileSync(MIGRATION_PATH, 'utf8');

function quotedLabels(name: string): string[] {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(MIGRATION_TEXT())?.[1];
  assert.ok(block, `the migration declares ${name}`);
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

async function testApplicationRulesAndMigration() {
  const payload = Object.entries(applicationsParentRules).filter(([, rule]) => rule.from === 'payload');
  const instance = Object.entries(applicationsParentRules).filter(([, rule]) => rule.from === 'instance');
  assert.deepEqual(payload.map(([label]) => label).sort(), quotedLabels('PAYLOAD_LABELS'), 'the payload rules and the migration agree');
  assert.deepEqual(instance.map(([label]) => label).sort(), quotedLabels('INSTANCE_LABELS'), 'the deployment rules and the migration agree');
  assert.deepEqual(instance.map(([label]) => label), ['app_asset_assignments']);
  for (const [label, rule] of Object.entries(applicationsParentRules)) {
    assert.equal(rule.parentTable, 'applications', `${label}: the application table`);
    assert.deepEqual(rule.from === 'version' ? [] : rule.keys, rule.from === 'instance' ? ['app_instance_id'] : ['application_id'], `${label}: its key`);
    assert.equal(AUDIT_PARENT_RULES[label], rule, `${label}: aggregated`);
  }
  const text = MIGRATION_TEXT();
  assert.match(text, /after_json->>'application_id', \$\{a\}\.before_json->>'application_id'/, 'the payload key, after then before');
  assert.match(text, /FROM app_instances i\s+WHERE i\.tenant_id = \$\{a\}\.tenant_id\s+AND i\.id = /, 'the deployment is read in the row tenant');
  assert.match(text, /after_json->>'app_instance_id', \$\{a\}\.before_json->>'app_instance_id'/, 'the deployment key, after then before');
  assert.match(text, /EXISTS \(SELECT 1 FROM applications p WHERE p\.tenant_id = a\.tenant_id AND p\.id = c\.candidate_parent_id\)/, 'only an application of the tenant');
  for (const read of recordHistoryPayloadKeyReads(RECORD_HISTORY.applications)) {
    const name = `idx_audit_log_${read.key}_applications`;
    assert.ok(text.includes(name), `${name}: the migration creates the index`);
    assert.ok(text.includes(`->> '${read.key}'`), `${name}: the key expression`);
    assert.deepEqual(read.labels, quotedLabels('PAYLOAD_KEY_LABELS'), `${name}: the index names the labels read by the key`);
  }
  assert.doesNotMatch(text, /ROW LEVEL SECURITY|row_security/i, 'the migration never touches RLS');

  const { manager, queries } = fakeManager({ [INSTANCE]: APPLICATION });
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'app_asset_assignments', recordId: ASSIGNMENT, before: null, after: { app_instance_id: INSTANCE } }),
    { table: 'applications', id: APPLICATION },
    'an assignment write names its application',
  );
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'app_instances', recordId: INSTANCE, before: { application_id: APPLICATION }, after: null }),
    { table: 'applications', id: APPLICATION },
    'a deleted deployment names its application',
  );
  assert.equal(
    await resolveAuditParent(manager, { table: 'application_owners', recordId: APPLICATION, before: [], after: [] }),
    null,
    'a set read by record_id has no rule',
  );
  assert.equal(queries.length, 1, 'only the assignment reads its deployment');
}

async function run() {
  await testResolve();
  await testApplicationRulesAndMigration();
  console.log('audit-parent-rules-applications.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
