import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES, TASK_PARENT_TABLES, resolveAuditParent } from '../audit-parent-rules';
import { RECORD_HISTORY } from '../record-history.inventory';
import { portfolioProjectsParentRules } from '../record-history/records/portfolio_projects';

// The parent rules of the portfolio project (lot 2, linked records), and the project entry of the
// task rule. Their SQL copy is in `1855930000000-audit-log-parent-projects.ts`; this spec reads that
// file and checks that the labels, the payload key and the task type agree with the TS rules, then
// resolves one write of each label as `writeAuditLog` does.
// This spec does not open the data source: it runs in the parallel (non-database) lane.

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';

const MIGRATION_PATH = backendPath('src', 'migrations', '1855930000000-audit-log-parent-projects.ts');
const MIGRATION_TEXT = () => fs.readFileSync(MIGRATION_PATH, 'utf8');

function migrationList(name: string): string[] {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(MIGRATION_TEXT())?.[1];
  assert.ok(block, `the migration declares ${name}`);
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

function migrationTaskTypes(): Record<string, string> {
  const block = /const TASK_TYPES = \{([^}]*)\} as const;/.exec(MIGRATION_TEXT())?.[1];
  assert.ok(block, 'the migration declares its task types');
  return Object.fromEntries(Array.from(block.matchAll(/([a-z_]+): '([a-z_]+)'/g), (match) => [match[1], match[2]]));
}

const fakeManager: any = { query: async () => [] };

function testRulesMatchMigration() {
  assert.deepEqual(Object.keys(portfolioProjectsParentRules).sort(), migrationList('PROJECT_LABELS'), 'the project labels agree');
  for (const [label, rule] of Object.entries(portfolioProjectsParentRules)) {
    assert.equal(rule.parentTable, 'portfolio_projects', `${label}: the project table`);
    assert.equal(rule.from, 'payload', `${label}: a payload key`);
    assert.deepEqual(rule.from === 'payload' ? rule.keys : [], ['project_id'], `${label}: the project key`);
    assert.equal(rule.from === 'payload' ? rule.fallback : undefined, undefined, `${label}: no record_id fallback`);
    assert.equal(AUDIT_PARENT_RULES[label], rule, `${label}: aggregated`);
    assert.ok(label in RECORD_HISTORY.portfolio_projects.children, `${label}: a child of the project`);
  }
  const text = MIGRATION_TEXT();
  for (const key of ['project_id', 'related_object_id', 'related_object_type']) {
    assert.ok(text.includes(`'${key}'`), `the migration reads ${key}`);
  }
  assert.doesNotMatch(text, /CREATE INDEX/, 'no index: these labels are read by their parent');

  // The task rule: the migration backfills its project type, with the same table.
  const task = AUDIT_PARENT_RULES.tasks;
  assert.ok(task && task.from === 'payload_typed', 'tasks: a typed payload rule');
  assert.match(text, /const TASK_LABEL = 'tasks';/, 'the migration names the task label');
  const types = migrationTaskTypes();
  assert.deepEqual(types, { project: 'portfolio_projects' }, 'the migration covers the project type');
  assert.equal(TASK_PARENT_TABLES.project, 'portfolio_projects', 'tasks: the project type names its table');
  assert.equal(task.tables.project, 'portfolio_projects', 'tasks: the rule reads the project type');
  assert.equal(RECORD_HISTORY.portfolio_projects.children.tasks, 'task', 'portfolio_projects: its tasks are a child');
  console.log('  project and task rules match the migration: OK');
}

async function testResolve() {
  const cases: Array<[string, Parameters<typeof resolveAuditParent>[1], unknown]> = [
    ['a phase names its project', { table: 'portfolio_project_phases', recordId: OTHER, after: { project_id: PROJECT, name: 'Design' } }, { table: 'portfolio_projects', id: PROJECT }],
    ['a removed milestone names its project before', { table: 'portfolio_project_milestones', recordId: OTHER, before: { project_id: PROJECT }, after: null }, { table: 'portfolio_projects', id: PROJECT }],
    ['an attachment names its project', { table: 'portfolio_project_attachments', recordId: OTHER, after: { project_id: PROJECT, original_filename: 'plan.pdf' } }, { table: 'portfolio_projects', id: PROJECT }],
    ['a time entry names its project', { table: 'portfolio_project_time_entries', recordId: OTHER, after: { project_id: PROJECT, hours: 2 } }, { table: 'portfolio_projects', id: PROJECT }],
    ['a project task names its project', { table: 'tasks', recordId: OTHER, after: { related_object_type: 'project', related_object_id: PROJECT } }, { table: 'portfolio_projects', id: PROJECT }],
    ['a team set names no parent', { table: 'portfolio_project_team', recordId: PROJECT, before: { role: 'it_team', ids: [] }, after: { role: 'it_team', ids: [OTHER] } }, null],
    ['a document edit names no parent', { table: 'portfolio_project_documents', recordId: PROJECT, before: null, after: { slot: 'purpose' } }, null],
  ];
  for (const [what, entry, expected] of cases) {
    assert.deepEqual(await resolveAuditParent(fakeManager, entry), expected, what);
  }
  console.log(`  ${cases.length} writes resolved as writeAuditLog does: OK`);
}

async function run() {
  console.log('project parent rules');
  testRulesMatchMigration();
  await testResolve();
  console.log('audit-parent-rules-projects.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
