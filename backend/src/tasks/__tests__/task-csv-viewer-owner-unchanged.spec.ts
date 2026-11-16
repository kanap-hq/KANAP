/**
 * The task import writes a task's viewers or owners only when they change: a row that names the
 * people the task has, in any order, is unchanged (the task keeps its `updated_at`, and a person who
 * reads it without the right to change it gets no refusal for a row that changes nothing). The lists
 * go with the task the import writes (lot I3 of 26.11.9, review fixes): no second pass.
 */
import * as assert from 'node:assert/strict';
import type { CsvImportContext, CsvImportRow } from '../../common/csv/csv-field.types';
import { taskCsvConfig } from '../task-csv.config';

const TENANT = 't1';
const ADA = 'user-ada';
const BOB = 'user-bob';

/** A manager that answers the people's read; any other statement is recorded and answers nothing. */
function context(): CsvImportContext & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    tenantId: TENANT,
    params: { dryRun: true, mode: 'enrich', operation: 'upsert' },
    resolverCache: new Map(),
    manager: {
      query: async (sql: string) => {
        statements.push(sql);
        if (/FROM users/.test(sql)) return [{ id: ADA, email: 'ada@example.com' }, { id: BOB, email: 'bob@example.com' }];
        return [];
      },
    },
  } as any;
}

/** The row of the stored task « Migration » after the hooks, and whether the import counts it unchanged. */
async function run(raw: Record<string, string>, task: { viewer_ids: string[]; owner_ids: string[] }) {
  const row: CsvImportRow = {
    rowNumber: 2,
    raw: { title: 'Migration', ...raw },
    parsed: { title: 'Migration' },
    existingEntity: { id: 'task-1', title: 'Migration', ...task },
    isInsert: false,
    errors: [],
    warnings: [],
  };
  const ctx = context();
  await taskCsvConfig.afterValidate!([row], ctx);
  const [unchanged] = await taskCsvConfig.sameAsStored!([row], ctx);
  return { parsed: row.parsed, unchanged, statements: ctx.statements };
}

async function testUnchangedTaskIsNotWritten() {
  // Same people, in another order: nothing changes.
  const same = await run(
    { viewer_email_1: 'bob@example.com', viewer_email_2: 'ada@example.com', owner_email_1: 'ada@example.com' },
    { viewer_ids: [ADA, BOB], owner_ids: [ADA] },
  );
  assert.equal(same.unchanged, true);
  assert.ok(!('viewer_ids' in same.parsed) && !('owner_ids' in same.parsed), JSON.stringify(same.parsed));
  assert.equal(same.statements.filter((sql) => /FROM users/.test(sql)).length, 1, 'the people are read once');
}

async function testChangedTaskIsWritten() {
  const changed = await run({ viewer_email_1: 'bob@example.com', owner_email_1: 'ada@example.com' }, { viewer_ids: [ADA], owner_ids: [ADA] });
  assert.equal(changed.unchanged, false);
  assert.deepEqual(changed.parsed.viewer_ids, [BOB]);
  assert.ok(!('owner_ids' in changed.parsed), 'the owners did not change');
  // Only the owners' columns: the viewers are not compared nor written.
  const owners = await run({ owner_email_1: 'bob@example.com' }, { viewer_ids: [ADA], owner_ids: [ADA] });
  assert.deepEqual(owners.parsed.owner_ids, [BOB]);
  assert.ok(!('viewer_ids' in owners.parsed), JSON.stringify(owners.parsed));
  assert.equal((await run({ owner_email_1: 'ada@example.com' }, { viewer_ids: [BOB], owner_ids: [ADA] })).unchanged, true);
  // A list the file empties is written empty, as before.
  assert.deepEqual((await run({ viewer_email_1: '' }, { viewer_ids: [ADA], owner_ids: [] })).parsed.viewer_ids, []);
}

(async () => {
  await testUnchangedTaskIsNotWritten();
  await testChangedTaskIsWritten();
  console.log('Task CSV viewer and owner tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
