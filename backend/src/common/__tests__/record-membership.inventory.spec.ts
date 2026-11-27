import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from './backend-root';
import { CsvResolverService } from '../csv/csv-resolver.service';

// A stream belongs to its category, a department to its company (lot I7a of 26.12.1, P13): every code
// that writes a stream or a department next to its parent goes through the one rule
// (`common/record-membership.ts`, or `common/csv/csv-membership.ts` for the shared import), or is listed
// here with the reason it needs none. A new writer of these columns fails this spec until it is one or
// the other.

const SOURCE = backendPath('src');
const COLUMNS = /\b(default_)?(stream|department)_id\b/;
const WRITES = /\.save\(|\.insert\(|\.update\(|INSERT INTO|UPDATE [a-z_]+ SET|\.create\(\{/;
const RULE = /record-membership|csv-membership/;

/** The files that write these columns without the rule, and why. */
const EXEMPT: Record<string, string> = {
  'ai/query/ai-chargeback.query.ts': 'reads: builds report rows, writes no record',
  'ai/mutation/ai-relation-mutation-support.service.ts': "an application's departments: a link list, with no company next to it",
  'applications/services/applications-owners.service.ts': "an application's departments: a link list, with no company next to it",
  'departments/department-metrics.service.ts': "a department's yearly metrics, keyed by the department alone",
  'departments/departments.service.ts': 'the departments themselves: their company is the parent, not a pair to check',
  'knowledge/knowledge.service.ts': "a document's classifications: checked there (a stream of another category is refused)",
  'portfolio/portfolio-classification.service.ts': 'the streams themselves, and the usages of one before it is deleted',
  'portfolio/team-member-config.controller.ts': 'hands the body to TeamMemberConfigService, which applies the rule',
  'portfolio/services/portfolio-roadmap.service.ts': 'reads: the roadmap shows the stream, writes no record',
  'spend/allocation-save.ts': "a budget line's allocations: checked there (the department gives its company, a mismatch is refused)",
  'spend/budget-allocation-operations.ts': "copies a version's allocations, already saved under allocation-save.ts",
};

function sources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'migrations' || entry.name === 'node_modules') continue;
      files.push(...sources(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function testEveryWriterFollowsTheRule() {
  const writers = sources(SOURCE)
    .map((file) => ({ file: path.relative(SOURCE, file).split(path.sep).join('/'), text: fs.readFileSync(file, 'utf8') }))
    .filter(({ text }) => COLUMNS.test(text) && WRITES.test(text));
  assert.ok(writers.length >= 10, `the scan finds the writers (${writers.length})`);
  const missing = writers.filter(({ file, text }) => !RULE.test(text) && !EXEMPT[file]).map(({ file }) => file);
  assert.deepEqual(missing, [], 'these files write a stream or a department without the rule: call it, or list them with a reason');
  const found = new Set(writers.map(({ file }) => file));
  const stale = Object.keys(EXEMPT).filter((file) => !found.has(file));
  assert.deepEqual(stale, [], 'these exemptions name no writer any more: remove them');
  for (const file of ['portfolio/portfolio-requests.service.ts', 'portfolio/services/portfolio-projects-crud.service.ts', 'tasks/tasks-unified.service.ts', 'users/users.service.ts', 'portfolio/team-member-config.service.ts', 'auth/entra-directory-sync.service.ts', 'common/csv/csv-import.service.ts']) {
    assert.match(fs.readFileSync(path.join(SOURCE, file), 'utf8'), RULE, `${file} applies the rule`);
  }
}

function testTheImportKnowsTheParents() {
  const resolver = new CsvResolverService();
  assert.deepEqual(resolver.parentOf('portfolio_streams'), { column: 'category_id', entity: 'portfolio_categories' });
  assert.deepEqual(resolver.parentOf('departments'), { column: 'company_id', entity: 'companies' });
}

const tests: Array<[string, () => void]> = [
  ['every writer of a stream or a department follows the rule', testEveryWriterFollowsTheRule],
  ['the import knows the parent of streams and departments', testTheImportKnowsTheParents],
];
let failed = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${(error as Error).stack}`);
  }
}
if (failed > 0) process.exit(1);
