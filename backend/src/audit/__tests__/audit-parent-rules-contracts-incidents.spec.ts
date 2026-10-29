import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES, TASK_PARENT_TABLES, resolveAuditParent } from '../audit-parent-rules';
import { RECORD_HISTORY } from '../record-history.inventory';
import { contractsParentRules } from '../record-history/records/contracts';
import { incidentsParentRules } from '../record-history/records/incidents';

// The parent rules of the contract and the incident (lot 2, linked records), and the contract and
// incident entries of the task rule. Their SQL copy is in
// `1855900000000-audit-log-parent-contracts-incidents.ts`; this spec reads that file and checks
// that the labels, the payload keys, the record_id fallback and the task types agree with the TS
// rules, then resolves one write of each label as `writeAuditLog` does.
// This spec does not open the data source: it runs in the parallel (non-database) lane.

const CONTRACT = '11111111-1111-4111-8111-111111111111';
const INCIDENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const MIGRATION_PATH = backendPath('src', 'migrations', '1855900000000-audit-log-parent-contracts-incidents.ts');
const MIGRATION_TEXT = () => fs.readFileSync(MIGRATION_PATH, 'utf8');

function quotedLabels(block: string | undefined, what: string): string[] {
  assert.ok(block, `the migration declares ${what}`);
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

function migrationList(name: string): string[] {
  return quotedLabels(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(MIGRATION_TEXT())?.[1], name);
}

function migrationTaskTypes(): Record<string, string> {
  const block = /const TASK_TYPES = \{([^}]*)\} as const;/.exec(MIGRATION_TEXT())?.[1];
  assert.ok(block, 'the migration declares its task types');
  return Object.fromEntries(Array.from(block.matchAll(/([a-z_]+): '([a-z_]+)'/g), (match) => [match[1], match[2]]));
}

const fakeManager: any = { query: async () => [] };

function testRulesMatchMigration() {
  assert.deepEqual(Object.keys(contractsParentRules).sort(), migrationList('CONTRACT_LABELS'), 'the contract labels agree');
  assert.deepEqual(Object.keys(incidentsParentRules).sort(), migrationList('INCIDENT_LABELS'), 'the incident labels agree');
  const fallbacks = Object.entries(contractsParentRules)
    .filter(([, rule]) => rule.from === 'payload' && rule.fallback === 'record_id')
    .map(([label]) => label)
    .sort();
  assert.deepEqual(fallbacks, migrationList('CONTRACT_RECORD_FALLBACK_LABELS'), 'the record_id fallback labels agree');
  for (const [label, rule] of Object.entries(contractsParentRules)) {
    assert.equal(rule.parentTable, 'contracts', `${label}: the contract table`);
    assert.equal(rule.from, 'payload', `${label}: a payload key`);
    assert.deepEqual(rule.from === 'payload' ? rule.keys : [], ['contract_id'], `${label}: the contract key`);
    assert.equal(AUDIT_PARENT_RULES[label], rule, `${label}: aggregated`);
  }
  for (const [label, rule] of Object.entries(incidentsParentRules)) {
    assert.equal(rule.parentTable, 'incidents', `${label}: the incident table`);
    assert.deepEqual(rule.from === 'payload' ? rule.keys : [], ['incident_id'], `${label}: the incident key`);
    assert.equal(AUDIT_PARENT_RULES[label], rule, `${label}: aggregated`);
  }
  const text = MIGRATION_TEXT();
  for (const key of ['contract_id', 'incident_id', 'related_object_id', 'related_object_type']) {
    assert.ok(text.includes(`'${key}'`), `the migration reads ${key}`);
  }

  // The task rule: the migration backfills its contract and incident types, with the same tables.
  const task = AUDIT_PARENT_RULES.tasks;
  assert.ok(task && task.from === 'payload_typed', 'tasks: a typed payload rule');
  assert.deepEqual(task.keys, ['related_object_id'], 'tasks: the record key');
  assert.equal(task.typeKey, 'related_object_type', 'tasks: the type key');
  assert.match(text, /const TASK_LABEL = 'tasks';/, 'the migration names the task label');
  const types = migrationTaskTypes();
  assert.deepEqual(Object.keys(types).sort(), ['contract', 'incident'], 'the migration covers the contract and incident types');
  for (const [type, table] of Object.entries(types)) {
    assert.equal((TASK_PARENT_TABLES as Record<string, string>)[type], table, `tasks: the ${type} type names ${table}`);
    assert.equal(task.tables[type], table, `tasks: the rule reads the ${type} type`);
    assert.ok(Object.prototype.hasOwnProperty.call(RECORD_HISTORY, table), `${table}: a record of the inventory`);
    assert.equal(RECORD_HISTORY[table as keyof typeof RECORD_HISTORY].children.tasks, 'task', `${table}: its tasks are a child`);
  }
  console.log('  contract, incident and task rules match the migration: OK');
}

async function testResolve() {
  const cases: Array<[string, Parameters<typeof resolveAuditParent>[1], unknown]> = [
    ['a contract contact link names its contract', { table: 'contract_contacts', recordId: OTHER, after: { contract_id: CONTRACT, contact_id: OTHER } }, { table: 'contracts', id: CONTRACT }],
    ['the supplier sync names the contract in record_id', { table: 'contract_contacts', recordId: CONTRACT, before: [`${OTHER}:commercial`], after: [] }, { table: 'contracts', id: CONTRACT }],
    ['the assistant\'s web links name the contract in record_id', { table: 'contract_links', recordId: CONTRACT, before: [], after: [{ key: 'https://example.invalid', label: 'Terms', payload: { url: 'https://example.invalid', description: 'Terms' } }] }, { table: 'contracts', id: CONTRACT }],
    ['a removed web link names its contract before', { table: 'contract_links', recordId: OTHER, before: { contract_id: CONTRACT }, after: null }, { table: 'contracts', id: CONTRACT }],
    ['an attachment names its contract', { table: 'contract_attachments', recordId: OTHER, after: { contract_id: CONTRACT } }, { table: 'contracts', id: CONTRACT }],
    ['a compliance item names its contract', { table: 'contract_compliance_items', recordId: OTHER, after: { contract_id: CONTRACT, requirement: 'exit_plan' } }, { table: 'contracts', id: CONTRACT }],
    ['an incident attachment names its incident', { table: 'incident_attachments', recordId: OTHER, after: { incident_id: INCIDENT } }, { table: 'incidents', id: INCIDENT }],
    ['a contract task names its contract', { table: 'tasks', recordId: OTHER, after: { related_object_type: 'contract', related_object_id: CONTRACT } }, { table: 'contracts', id: CONTRACT }],
    ['an incident task names its incident', { table: 'tasks', recordId: OTHER, before: { related_object_type: 'incident', related_object_id: INCIDENT }, after: null }, { table: 'incidents', id: INCIDENT }],
    ['a standalone task has no parent', { table: 'tasks', recordId: OTHER, after: { related_object_type: null, related_object_id: null } }, null],
    ['the legacy contract task label has no parent', { table: 'contract_tasks', recordId: OTHER, after: { related_object_type: 'contract', related_object_id: CONTRACT } }, null],
    ['a contract link set names no parent', { table: 'application_contracts', recordId: CONTRACT, before: { ids: [] }, after: { ids: [OTHER] } }, null],
  ];
  for (const [what, entry, expected] of cases) {
    assert.deepEqual(await resolveAuditParent(fakeManager, entry), expected, what);
  }
  console.log(`  ${cases.length} writes resolved as writeAuditLog does: OK`);
}

async function run() {
  console.log('contract and incident parent rules');
  testRulesMatchMigration();
  await testResolve();
  console.log('audit-parent-rules-contracts-incidents.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
