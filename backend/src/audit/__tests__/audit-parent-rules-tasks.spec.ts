import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES, TASK_PARENT_TABLES, resolveAuditParent } from '../audit-parent-rules';
import { RECORD_HISTORY } from '../record-history.inventory';
import { tasksParentRules } from '../record-history/records/tasks';

// The parent rules of the task (lot 2, linked records), and the budget-line entries of the task
// rule. Their SQL copy is in `1855920000000-audit-log-parent-tasks.ts`; this spec reads that file
// and checks that the labels, the payload key and the task types agree with the TS rules, then
// resolves one write of each label as `writeAuditLog` does.
// This spec does not open the data source: it runs in the parallel (non-database) lane.

const TASK = '11111111-1111-4111-8111-111111111111';
const LINE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const MIGRATION_PATH = backendPath('src', 'migrations', '1855920000000-audit-log-parent-tasks.ts');
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
  assert.deepEqual(Object.keys(tasksParentRules).sort(), migrationList('TASK_CHILD_LABELS'), 'the task child labels agree');
  for (const [label, rule] of Object.entries(tasksParentRules)) {
    assert.equal(rule.parentTable, 'tasks', `${label}: the task table`);
    assert.equal(rule.from, 'payload', `${label}: a payload key`);
    assert.deepEqual(rule.from === 'payload' ? rule.keys : [], ['task_id'], `${label}: the task key`);
    assert.equal(rule.from === 'payload' ? rule.fallback : undefined, undefined, `${label}: no record_id fallback`);
    assert.equal(AUDIT_PARENT_RULES[label], rule, `${label}: aggregated`);
    assert.ok(Object.prototype.hasOwnProperty.call(RECORD_HISTORY.tasks.children, label), `${label}: a child of the task`);
    assert.equal((RECORD_HISTORY.tasks.childReads as Record<string, unknown> | undefined)?.[label], undefined, `${label}: read by its parent`);
  }
  const text = MIGRATION_TEXT();
  for (const key of ['task_id', 'related_object_id', 'related_object_type']) {
    assert.ok(text.includes(`'${key}'`), `the migration reads ${key}`);
  }

  // The task rule: the migration backfills its budget-line types, both natures in `spend_items`.
  const task = AUDIT_PARENT_RULES.tasks;
  assert.ok(task && task.from === 'payload_typed', 'tasks: a typed payload rule');
  assert.deepEqual(task.keys, ['related_object_id'], 'tasks: the record key');
  assert.equal(task.typeKey, 'related_object_type', 'tasks: the type key');
  assert.match(text, /const TASK_LABEL = 'tasks';/, 'the migration names the task label');
  const types = migrationTaskTypes();
  assert.deepEqual(Object.keys(types).sort(), ['capex_item', 'spend_item'], 'the migration covers the two line natures');
  for (const [type, table] of Object.entries(types)) {
    assert.equal(table, 'spend_items', `tasks: the ${type} type is a budget line`);
    assert.equal((TASK_PARENT_TABLES as Record<string, string>)[type], table, `tasks: the ${type} type names ${table}`);
    assert.equal(task.tables[type], table, `tasks: the rule reads the ${type} type`);
    assert.equal(RECORD_HISTORY.spend_items.children.tasks, 'task', `${table}: its tasks are a child`);
  }
  // The legacy line task label left the rules: the line reads the `tasks` row of the same call.
  assert.equal(AUDIT_PARENT_RULES.spend_tasks, undefined, 'spend_tasks: no rule');
  assert.ok(!text.includes("'spend_tasks'"), 'the migration does not touch the legacy line task label');
  console.log('  task child rules and the budget-line task types match the migration: OK');
}

async function testResolve() {
  const cases: Array<[string, Parameters<typeof resolveAuditParent>[1], unknown]> = [
    ['an attachment names its task', { table: 'task_attachments', recordId: OTHER, after: { task_id: TASK, original_filename: 'a.txt' } }, { table: 'tasks', id: TASK }],
    ['a deleted attachment names its task before', { table: 'task_attachments', recordId: null as any, before: { task_id: TASK }, after: null }, { table: 'tasks', id: TASK }],
    ['a time entry names its task', { table: 'task_time_entries', recordId: OTHER, after: { task_id: TASK, hours: 1 } }, { table: 'tasks', id: TASK }],
    ['a task of an OPEX line names its line', { table: 'tasks', recordId: OTHER, after: { related_object_type: 'spend_item', related_object_id: LINE } }, { table: 'spend_items', id: LINE }],
    ['a task of a CAPEX line names its line', { table: 'tasks', recordId: OTHER, before: { related_object_type: 'capex_item', related_object_id: LINE }, after: null }, { table: 'spend_items', id: LINE }],
    ['a project task has no parent here', { table: 'tasks', recordId: OTHER, after: { related_object_type: 'project', related_object_id: LINE } }, null],
    ['the legacy line task label has no parent', { table: 'spend_tasks', recordId: OTHER, after: { related_object_type: 'spend_item', related_object_id: LINE } }, null],
    ['a task application set names no parent', { table: 'task_applications', recordId: TASK, before: { ids: [] }, after: { ids: [OTHER] } }, null],
  ];
  for (const [what, entry, expected] of cases) {
    assert.deepEqual(await resolveAuditParent(fakeManager, entry), expected, what);
  }
  console.log(`  ${cases.length} writes resolved as writeAuditLog does: OK`);
}

async function run() {
  console.log('task parent rules');
  testRulesMatchMigration();
  await testResolve();
  console.log('audit-parent-rules-tasks.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
