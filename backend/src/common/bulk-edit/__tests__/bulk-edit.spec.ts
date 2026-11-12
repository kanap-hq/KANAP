import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  BULK_MAX_ROWS,
  BulkEditList,
  parseBulkChanges,
  parseBulkConfirmation,
  parseBulkSelection,
  runBulkEdit,
} from '../bulk-edit';

// The common contract of a change in bulk (`bulk-edit.ts`), without a database: a fake manager
// records the statements, a fake list writes rows in memory.

function fakeManager() {
  const statements: string[] = [];
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: async (sql: string) => {
      statements.push(sql);
      return sql.startsWith('SELECT clock_timestamp()') ? [{ now: new Date('2026-11-12T10:00:00Z') }] : [];
    },
  };
  return { manager: manager as any, statements };
}

type Row = { id: string; value: string | null };

function fakeList(rows: Row[], refuse: Record<string, string> = {}, fail?: string): BulkEditList<Row> & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    reach: async (selection) => (selection.all ? rows : rows.filter((row) => selection.ids.includes(row.id))),
    apply: async (row) => {
      if (row.id === fail) throw new Error('boom');
      if (refuse[row.id]) throw new BadRequestException(refuse[row.id]);
      if (row.value === 'x') return 'unchanged';
      written.push(row.id);
      return 'changed';
    },
    refusal: (error) => (error instanceof BadRequestException ? error.message : null),
  };
}

const ids = (n: number) => Array.from({ length: n }, () => randomUUID());

async function main() {
  // Selection: ids, or all with exclude_ids; never both.
  const [a, b] = ids(2);
  assert.deepEqual(parseBulkSelection({ ids: [a.toUpperCase(), a, b] }), { all: false, ids: [a, b], excluded: [], filters: {} });
  assert.deepEqual(parseBulkSelection({ all: true, filters: { q: 'x' }, exclude_ids: [b] }), { all: true, ids: [], excluded: [b], filters: { q: 'x' } });
  assert.throws(() => parseBulkSelection({ all: true, ids: [a] }), /not both/);
  assert.throws(() => parseBulkSelection({ exclude_ids: [a] }), /goes with all/);
  assert.throws(() => parseBulkSelection({}), /Choose the rows/);
  assert.throws(() => parseBulkSelection({ ids: ['BL-4'] }), /must be row ids/);
  assert.throws(() => parseBulkSelection({ ids: ids(BULK_MAX_ROWS + 1) }), (err: any) => err.getResponse().code === 'bulk_too_many');

  // Confirmation: as_of and expected_rows required with all, outside the dry run.
  assert.deepEqual(parseBulkConfirmation({ dry_run: true }, true), { dryRun: true, asOf: null, expectedRows: null });
  assert.throws(() => parseBulkConfirmation({ expected_rows: 3 }, true), /as_of is required/);
  assert.throws(() => parseBulkConfirmation({ as_of: '2026-11-12T10:00:00Z' }, true), /expected_rows is required/);
  assert.throws(() => parseBulkConfirmation({ as_of: 'soon', expected_rows: 1 }, true), /as_of must be/);
  assert.throws(() => parseBulkConfirmation({ as_of: '2026-11-12T10:00:00Z', expected_rows: -1 }, true), /expected_rows must be/);
  assert.deepEqual(parseBulkConfirmation({}, false), { dryRun: false, asOf: null, expectedRows: null });

  // Changes: declared fields only, their type, null only when optional; map entries lower-cased.
  const fields = [
    { name: 'owner', value: 'id', optional: true },
    { name: 'company', value: 'id', optional: false },
    { name: 'kind', value: 'enum', values: ['run', 'build'], optional: true },
    { name: 'dims', value: 'id_map', optional: true },
  ] as const;
  assert.deepEqual(parseBulkChanges({ owner: null, kind: 'run', dims: { [a.toUpperCase()]: null } }, fields), { owner: null, kind: 'run', dims: { [a]: null } });
  assert.throws(() => parseBulkChanges({ company: null }, fields), /cannot be emptied/);
  assert.throws(() => parseBulkChanges({ other: a }, fields), /cannot be changed in bulk/);
  assert.throws(() => parseBulkChanges({ kind: 'other' }, fields), /must be one of run, build or null/);
  assert.throws(() => parseBulkChanges({ owner: 'BL-3' }, fields), /must be an id or null/);
  assert.throws(() => parseBulkChanges({ dims: {} }, fields), /at least one field/);
  assert.throws(() => parseBulkChanges(null, fields), /at least one field/);

  // The dry run: counted under a savepoint rolled back, nothing kept; the write: refusals counted, the rest written.
  const rows: Row[] = ids(5).sort().map((id, i) => ({ id, value: i === 0 ? 'x' : null }));
  const refuse = { [rows[1].id]: 'read_only', [rows[2].id]: 'read_only' };
  {
    const { manager, statements } = fakeManager();
    const list = fakeList(rows, refuse);
    const dry = await runBulkEdit(manager, list, parseBulkSelection({ all: true }), parseBulkConfirmation({ dry_run: true }, true));
    assert.deepEqual(dry, { dry_run: true, rows: 5, changes: 2, unchanged: 1, refused: { read_only: 2 }, as_of: '2026-11-12T10:00:00.000Z' });
    assert.equal(statements[1], 'SAVEPOINT bulk_edit_dry_run');
    assert.deepEqual(statements.slice(-2), ['ROLLBACK TO SAVEPOINT bulk_edit_dry_run', 'RELEASE SAVEPOINT bulk_edit_dry_run']);
    assert.equal(statements.filter((s) => s === 'ROLLBACK TO SAVEPOINT bulk_edit_row').length, 2, 'each refused row rolled back alone');
  }
  {
    const { manager, statements } = fakeManager();
    const list = fakeList(rows, refuse);
    const done = await runBulkEdit(manager, list, parseBulkSelection({ all: true }), parseBulkConfirmation({ as_of: '2026-11-12T10:00:00Z', expected_rows: 5 }, true));
    assert.deepEqual(done, { dry_run: false, rows: 5, changed: 2, unchanged: 1, refused: { read_only: 2 } });
    assert.deepEqual(list.written, [rows[3].id, rows[4].id]);
    assert.ok(!statements.some((s) => s.includes('bulk_edit_dry_run')));
  }
  // More rows than counted: 409, nothing written.
  {
    const { manager } = fakeManager();
    const list = fakeList(rows);
    await assert.rejects(
      runBulkEdit(manager, list, parseBulkSelection({ all: true }), parseBulkConfirmation({ as_of: '2026-11-12T10:00:00Z', expected_rows: 4 }, true)),
      (err: any) => err.status === 409 && err.getResponse().code === 'bulk_list_changed',
    );
    assert.deepEqual(list.written, []);
  }
  // Chosen rows the list does not return: not_found, without saying why.
  {
    const { manager } = fakeManager();
    const done = await runBulkEdit(manager, fakeList(rows), parseBulkSelection({ ids: [rows[3].id, randomUUID()] }), parseBulkConfirmation({}, false));
    assert.deepEqual(done, { dry_run: false, rows: 2, changed: 1, unchanged: 0, refused: { not_found: 1 } });
  }
  // A filter over the cap: 400 bulk_too_many, before any write.
  {
    const { manager } = fakeManager();
    const many: Row[] = ids(BULK_MAX_ROWS + 1).map((id) => ({ id, value: null }));
    const list = fakeList(many);
    await assert.rejects(
      runBulkEdit(manager, list, parseBulkSelection({ all: true }), parseBulkConfirmation({ dry_run: true }, true)),
      (err: any) => err.status === 400 && err.getResponse().code === 'bulk_too_many',
    );
    assert.deepEqual(list.written, []);
  }
  // An error that is no refusal of the row fails the whole change.
  {
    const { manager } = fakeManager();
    await assert.rejects(runBulkEdit(manager, fakeList(rows, {}, rows[2].id), parseBulkSelection({ all: true }), parseBulkConfirmation({ dry_run: true }, true)), /boom/);
  }
  // Outside a transaction: refused (the dry run could not roll back).
  {
    const manager = { queryRunner: { isTransactionActive: false }, query: async () => [] } as any;
    await assert.rejects(runBulkEdit(manager, fakeList(rows), parseBulkSelection({ all: true }), parseBulkConfirmation({ dry_run: true }, true)), /request transaction/);
  }
  console.log('bulk-edit: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
