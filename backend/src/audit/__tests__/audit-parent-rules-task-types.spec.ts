import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { TASK_PARENT_TABLES } from '../audit-parent-rules';

// Every task type of `TASK_PARENT_TABLES` is backfilled by exactly one migration, and no migration
// backfills a type the TS map does not know. Each run that gives a record its history adds its type
// to the map and declares it in the `TASK_TYPES` of its own migration (`1855900000000` contract and
// incident, `1855920000000` budget lines, `1855930000000` project, and any later one): this spec
// reads every migration that declares `TASK_TYPES` and compares their union with the map, so the
// next type cannot be forgotten on either side.
// This spec does not open the data source: it runs in the parallel (non-database) lane.

const MIGRATIONS_DIR = backendPath('src', 'migrations');
const KNOWN = [
  '1855900000000-audit-log-parent-contracts-incidents.ts',
  '1855920000000-audit-log-parent-tasks.ts',
  '1855930000000-audit-log-parent-projects.ts',
];

function declaredTaskTypes(): Map<string, Record<string, string>> {
  const declared = new Map<string, Record<string, string>>();
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.ts')).sort()) {
    const text = fs.readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    if (!/\bconst TASK_TYPES\b/.test(text)) continue;
    const block = /const TASK_TYPES = \{([^}]*)\} as const;/.exec(text)?.[1];
    assert.ok(block, `${file}: TASK_TYPES is an object literal \`{ type: 'table' } as const\``);
    const entries = Array.from(block.matchAll(/([a-z_]+): '([a-z_]+)'/g), (match) => [match[1], match[2]] as const);
    assert.ok(entries.length > 0, `${file}: TASK_TYPES names at least one type`);
    declared.set(file, Object.fromEntries(entries));
  }
  return declared;
}

function testUnionMatchesTaskParentTables() {
  const declared = declaredTaskTypes();
  for (const file of KNOWN) assert.ok(declared.has(file), `${file} declares its task types`);

  const union: Record<string, string> = {};
  const owner: Record<string, string> = {};
  for (const [file, types] of declared) {
    for (const [type, table] of Object.entries(types)) {
      assert.equal(owner[type], undefined, `${type}: backfilled by ${owner[type]} and again by ${file}`);
      owner[type] = file;
      union[type] = table;
    }
  }
  assert.deepEqual(
    Object.keys(union).sort(),
    Object.keys(TASK_PARENT_TABLES).sort(),
    'the task types the migrations backfill are the keys of TASK_PARENT_TABLES',
  );
  for (const [type, table] of Object.entries(TASK_PARENT_TABLES)) {
    assert.equal(union[type], table, `${type}: the migration and TASK_PARENT_TABLES name the same table`);
  }
}

testUnionMatchesTaskParentTables();
console.log('audit-parent-rules-task-types.spec: ok');
