import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import {
  KEYED_BY_PENDING_MIGRATION,
  UNINDEXED_DELETING_KEY_TABLES,
  UNKEYED_COLUMN_NAMES,
  UNKEYED_REFERENCE_COLUMNS,
} from '../reference-keys.inventory';

// Every reference column of the migrated database (`*_id`, `*_ids`, or a uuid column other than
// `id`) has a foreign key or an entry with its reason in common/reference-keys.inventory.ts. A
// column with neither fails here, so a new link table or reference cannot ship without a key by
// oversight; an entry whose column is gone or has gained a key fails too, so the list stays true.
// Every key that deletes or clears rows (ON DELETE CASCADE or SET NULL) has an index leading with
// its columns, unless its table is listed as tiny: otherwise deleting the parent row reads the
// whole child table.

type Column = { name: string; keyed: boolean };

async function referenceColumns(): Promise<Column[]> {
  return dataSource.query(
    `SELECT c.relname || '.' || a.attname AS name,
            EXISTS (SELECT 1 FROM pg_constraint k
                     WHERE k.contype = 'f' AND k.conrelid = c.oid AND a.attnum = ANY (k.conkey)) AS keyed
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'id'
        AND (a.attname ~ '_ids?$' OR a.atttypid IN ('uuid'::regtype, 'uuid[]'::regtype))
      ORDER BY 1`,
  );
}

async function testEveryReferenceColumnHasAKeyOrAReason() {
  const columns = await referenceColumns();
  const byName = new Map(columns.map((column) => [column.name, column]));
  assert.ok(byName.get('tasks.assignee_user_id'), 'the catalog query finds the reference columns');

  const failures: string[] = [];
  for (const column of columns) {
    if (column.keyed) continue;
    const field = column.name.split('.')[1];
    if (UNKEYED_COLUMN_NAMES[field] || UNKEYED_REFERENCE_COLUMNS[column.name]) continue;
    if (KEYED_BY_PENDING_MIGRATION.includes(column.name)) continue;
    failures.push(
      `${column.name} names a row by id but has no foreign key: add one in a migration ` +
        `(common/migration-reference-keys.ts), or list it with its reason in common/reference-keys.inventory.ts`,
    );
  }
  for (const [name, reason] of Object.entries(UNKEYED_REFERENCE_COLUMNS)) {
    const column = byName.get(name);
    if (!String(reason).trim()) failures.push(`${name} is listed without a reason`);
    if (!column) failures.push(`${name} is listed in common/reference-keys.inventory.ts but no such reference column exists: remove the entry`);
    else if (column.keyed) failures.push(`${name} is listed as having no foreign key but has one: remove the entry`);
  }
  for (const name of KEYED_BY_PENDING_MIGRATION) {
    if (!byName.has(name)) failures.push(`${name} is listed as pending a key but no such reference column exists: remove the entry`);
  }
  assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}`);
}

async function testEveryDeletingKeyHasALeadingIndex() {
  const keys: Array<{ table_name: string; conname: string; columns: string[]; indexed: boolean }> = await dataSource.query(
    `SELECT c.conrelid::regclass::text AS table_name, c.conname,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
            EXISTS (
              SELECT 1 FROM pg_index i
                JOIN pg_class ic ON ic.oid = i.indexrelid
                JOIN pg_am am ON am.oid = ic.relam
               WHERE i.indrelid = c.conrelid AND i.indisvalid AND i.indpred IS NULL AND am.amname = 'btree'
                 AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
                 AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey) AS indexed
       FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND c.confdeltype IN ('c', 'n')
      ORDER BY 1, 2`,
  );
  assert.ok(keys.some((key) => key.conname === 'fk_tasks_assignee_user_id'), 'the catalog query finds the deleting keys');
  const failures: string[] = [];
  const unindexedTables = new Set<string>();
  for (const key of keys) {
    if (key.indexed) continue;
    unindexedTables.add(key.table_name);
    if (UNINDEXED_DELETING_KEY_TABLES[key.table_name]) continue;
    failures.push(
      `${key.table_name}.${key.conname} (${key.columns.join(', ')}) deletes or clears rows but no index leads with its columns: ` +
        `add one in the migration, or list the table with its reason in UNINDEXED_DELETING_KEY_TABLES`,
    );
  }
  for (const [table, reason] of Object.entries(UNINDEXED_DELETING_KEY_TABLES)) {
    if (!String(reason).trim()) failures.push(`${table} is listed without a reason`);
    if (!unindexedTables.has(table)) failures.push(`${table} is listed in UNINDEXED_DELETING_KEY_TABLES but has no unindexed key: remove the entry`);
  }
  assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}`);
}

async function main() {
  await dataSource.initialize();
  try {
    for (const test of [testEveryReferenceColumnHasAKeyOrAReason, testEveryDeletingKeyHasALeadingIndex]) {
      await test();
      console.log(`  ok ${test.name}`);
    }
  } finally {
    await dataSource.destroy();
  }
  console.log('reference-keys.inventory.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
