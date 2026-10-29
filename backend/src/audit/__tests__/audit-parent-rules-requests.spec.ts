import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES, resolveAuditParent } from '../audit-parent-rules';
import { RECORD_HISTORY } from '../record-history.inventory';
import { portfolioRequestsParentRules } from '../record-history/records/portfolio_requests';

// The parent rules of the portfolio request (lot 2, linked records). Their SQL copy is in
// `1855940000000-audit-log-parent-requests.ts`; this spec reads that file and checks that the
// labels and the payload key agree with the TS rules, then resolves one write of each label, and
// of the sets read by `record_id`, as `writeAuditLog` does.
// This spec does not open the data source: it runs in the parallel (non-database) lane.

const REQUEST = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const MIGRATION_PATH = backendPath('src', 'migrations', '1855940000000-audit-log-parent-requests.ts');
const MIGRATION_TEXT = () => fs.readFileSync(MIGRATION_PATH, 'utf8');

function migrationList(name: string): string[] {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(MIGRATION_TEXT())?.[1];
  assert.ok(block, `the migration declares ${name}`);
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

const fakeManager: any = { query: async () => [] };

function testRulesMatchMigration() {
  assert.deepEqual(Object.keys(portfolioRequestsParentRules).sort(), migrationList('REQUEST_LABELS'), 'the request labels agree');
  const text = MIGRATION_TEXT();
  const key = /const REQUEST_KEY = '([a-z_]+)';/.exec(text)?.[1];
  for (const [label, rule] of Object.entries(portfolioRequestsParentRules)) {
    assert.equal(rule.parentTable, 'portfolio_requests', `${label}: the request table`);
    assert.equal(rule.from, 'payload', `${label}: a payload key`);
    assert.deepEqual(rule.from === 'payload' ? rule.keys : [], [key], `${label}: the migration's key`);
    assert.equal(rule.from === 'payload' ? rule.fallback : undefined, undefined, `${label}: no record_id fallback`);
    assert.equal(AUDIT_PARENT_RULES[label], rule, `${label}: aggregated`);
    assert.ok(label in RECORD_HISTORY.portfolio_requests.children, `${label}: a child of the request`);
  }
  assert.match(text, /SET parent_table = 'portfolio_requests'/, 'the migration fills the request table');
  assert.doesNotMatch(text, /CREATE INDEX/, 'no index: the label is read by its parent');
  console.log('  request rules match the migration: OK');
}

async function testResolve() {
  const cases: Array<[string, Parameters<typeof resolveAuditParent>[1], unknown]> = [
    ['an attachment names its request', { table: 'portfolio_request_attachments', recordId: OTHER, after: { request_id: REQUEST, original_filename: 'brief.pdf' } }, { table: 'portfolio_requests', id: REQUEST }],
    ['a removed attachment names its request before', { table: 'portfolio_request_attachments', recordId: OTHER, before: { request_id: REQUEST }, after: null }, { table: 'portfolio_requests', id: REQUEST }],
    ['a team set names no parent', { table: 'portfolio_request_team', recordId: REQUEST, before: { role: 'it_team', ids: [] }, after: { role: 'it_team', ids: [OTHER] } }, null],
    ['a dependency set names no parent', { table: 'portfolio_request_dependencies', recordId: REQUEST, before: { ids: [], request_ids: [] }, after: { ids: [OTHER], request_ids: [] } }, null],
    ['a document edit names no parent', { table: 'portfolio_request_documents', recordId: REQUEST, before: null, after: { slot: 'purpose' } }, null],
  ];
  for (const [what, entry, expected] of cases) {
    assert.deepEqual(await resolveAuditParent(fakeManager, entry), expected, what);
  }
  console.log(`  ${cases.length} writes resolved as writeAuditLog does: OK`);
}

async function run() {
  console.log('request parent rules');
  testRulesMatchMigration();
  await testResolve();
  console.log('audit-parent-rules-requests.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
