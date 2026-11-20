/**
 * The task import writes a task's viewers or owners only when they change: a row that names the
 * people the task has, in any order, is unchanged (the task keeps its `updated_at`, and a person who
 * reads it without the right to change it gets no refusal for a row that changes nothing). The lists
 * go with the task the import writes (lot I3 of 26.11.9, review fixes): no second pass.
 * The clearing rule (D21 of 26.11.9, T-I6e): four blank cells keep the list, `-` without an address
 * empties it, filled cells replace it; each person a list loses is counted (`clearedByConfig`), and a
 * `-` among addresses adds nothing (T-I6j).
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
    params: { dryRun: true, operation: 'upsert' },
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
  return { parsed: row.parsed, unchanged, statements: ctx.statements, cleared: row.clearedByConfig ?? 0 };
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
}

async function testClearingRule() {
  // Four blank cells keep the list: nothing written, nothing cleared.
  const blank = await run({ viewer_email_1: '', viewer_email_2: '', viewer_email_3: '', viewer_email_4: '' }, { viewer_ids: [ADA], owner_ids: [] });
  assert.ok(!('viewer_ids' in blank.parsed), JSON.stringify(blank.parsed));
  assert.deepEqual([blank.unchanged, blank.cleared], [true, 0]);
  // `-` without an address empties the list: each person removed is counted.
  const dash = await run({ viewer_email_1: '-', viewer_email_2: '' }, { viewer_ids: [ADA, BOB], owner_ids: [] });
  assert.deepEqual(dash.parsed.viewer_ids, []);
  assert.deepEqual([dash.unchanged, dash.cleared], [false, 2]);
  // `-` on a list already empty changes nothing.
  const none = await run({ owner_email_1: '-' }, { viewer_ids: [], owner_ids: [] });
  assert.deepEqual([none.unchanged, none.cleared], [true, 0]);
  // Filled cells replace the list: Ada removed, counted; a `-` among the addresses adds nothing.
  const replaced = await run({ viewer_email_1: '-', viewer_email_2: 'bob@example.com' }, { viewer_ids: [ADA, BOB], owner_ids: [] });
  assert.deepEqual(replaced.parsed.viewer_ids, [BOB]);
  assert.deepEqual([replaced.unchanged, replaced.cleared], [false, 1]);
}

(async () => {
  await testUnchangedTaskIsNotWritten();
  await testChangedTaskIsWritten();
  await testClearingRule();
  console.log('Task CSV viewer and owner tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
