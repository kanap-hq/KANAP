import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { BusinessProcessesService } from '../business-processes.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The business process CSV import, against a real database, each test in a transaction that
// is rolled back: a row identical to the stored process, its type and parent included, counts as
// unchanged and writes nothing, in the dry run and the load alike. Parents are named: a process of
// the file (written first, wherever its row is) or a stored one; an unknown parent and a cycle are
// refused with the row.

const HEADER = 'name;process_type;parent_name;description;notes;status';
const STAMP = '2020-01-01T00:00:00Z';

function service() {
  return new BusinessProcessesService(undefined as any, undefined as any, new AuditService(undefined as any));
}

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n') + '\n', 'utf8') } as Express.Multer.File;
}

async function seedProcess(runner: QueryRunner, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values);
  const [row] = await runner.query(
    `INSERT INTO business_processes (${columns.join(', ')}, updated_at) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}, '${STAMP}') RETURNING id`,
    Object.values(values),
  );
  return row.id;
}

async function testIdenticalRowsUnchanged() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'bp-csv');
    const salesId = await seedProcess(runner, { name: 'Sales', process_type: 'core' });
    const keptId = await seedProcess(runner, { name: 'Order to cash', process_type: 'core', parent_id: salesId, description: 'From order to payment', notes: 'Kept' });
    const retiredId = await seedProcess(runner, { name: 'Legacy billing', status: 'disabled', disabled_at: '2021-06-30T00:00:00Z' });
    const changedId = await seedProcess(runner, { name: 'Procure to pay', description: 'Old text' });
    const retypedId = await seedProcess(runner, { name: 'Hire to retire', process_type: 'core' });
    const movedId = await seedProcess(runner, { name: 'Record to report', parent_id: salesId });
    const svc = service();
    const opts = { manager: runner.manager };
    const upload = file([
      HEADER,
      'Sales;core;;;;enabled',
      // The parent in another case: still the stored parent.
      'Order to cash;core;sales;From order to payment;Kept;enabled',
      'Legacy billing;;;;;disabled',
      'Procure to pay;;;New text;;enabled',
      'Hire to retire;support;;;;enabled',
      'Record to report;;;;;enabled',
    ]);

    const check: any = await svc.importCsv({ file: upload, dryRun: true }, opts);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.inserted, check.updated, check.unchanged], [0, 3, 3], 'dry run');

    const load: any = await svc.importCsv({ file: upload, dryRun: false }, opts);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual([load.inserted, load.updated, load.unchanged], [0, 3, 3], 'load');

    const audits = await runner.query(
      `SELECT record_id FROM audit_log WHERE tenant_id = $1 AND table_name = 'business_processes'`,
      [tenantId],
    );
    assert.deepEqual(
      audits.map((row: any) => row.record_id).sort(),
      [changedId, retypedId, movedId].sort(),
      'only the changed processes are written',
    );
    const stamps = await runner.query(
      `SELECT id FROM business_processes WHERE tenant_id = $1 AND updated_at = '${STAMP}'::timestamptz`,
      [tenantId],
    );
    const keptStamps = new Set(stamps.map((row: any) => row.id));
    assert.ok(keptStamps.has(keptId) && keptStamps.has(retiredId) && keptStamps.has(salesId), 'the identical processes keep their updated_at');
    const [moved] = await runner.query(`SELECT parent_id FROM business_processes WHERE id = $1`, [movedId]);
    assert.equal(moved.parent_id, null, 'an empty parent puts the process at the top');

    // The same file again: everything is now stored.
    const again: any = await svc.importCsv({ file: upload, dryRun: true }, opts);
    assert.deepEqual([again.inserted, again.updated, again.unchanged], [0, 0, 6], 'second import');

    // The export reads back as it was written.
    const exported = await svc.exportCsv('data', { ...opts, language: 'en' });
    const round: any = await svc.importCsv({ file: { buffer: Buffer.from(exported.content, 'utf8') } as Express.Multer.File, dryRun: true, language: 'en' }, opts);
    assert.deepEqual([round.ok, round.inserted, round.updated, round.unchanged], [true, 0, 0, 6], JSON.stringify(round.errors));
  });
}

/** Parents named in the file are written first; unknown parents and cycles are refused with their row. */
async function testParents() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'bp-csv-parents');
    const storedTop = await seedProcess(runner, { name: 'Production' });
    const svc = service();
    const opts = { manager: runner.manager };

    // A child before its parent, a grandchild under a stored process.
    const load: any = await svc.importCsv({ file: file([
      HEADER,
      'Aging;core;Making;;;enabled',
      'Making;core;Production;;;enabled',
      'Rind care;core;Aging;;;enabled',
    ]), dryRun: false }, opts);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.equal(load.inserted, 3);
    const rows = await runner.query(
      `SELECT c.name, p.name AS parent FROM business_processes c LEFT JOIN business_processes p ON p.id = c.parent_id
        WHERE c.tenant_id = $1 ORDER BY c.name`,
      [tenantId],
    );
    assert.deepEqual(rows.map((r: any) => [r.name, r.parent]), [
      ['Aging', 'Making'], ['Making', 'Production'], ['Production', null], ['Rind care', 'Aging'],
    ]);

    // An unknown parent, a process under itself, and a move under its own descendant.
    const refused: any = await svc.importCsv({ file: file([
      HEADER,
      'Packing;;Nowhere;;;enabled',
      'Shipping;;shipping;;;enabled',
      'Production;;Rind care;;;enabled',
    ]), dryRun: true }, opts);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.errors.map((e: any) => [e.row, e.code]), [
      [2, 'CSV_REFERENCE_NOT_FOUND'],
      [3, 'CSV_BUSINESS_PROCESS_OWN_PARENT'],
      [4, 'CSV_BUSINESS_PROCESS_PARENT_INSIDE'],
    ]);
    const [top] = await runner.query(`SELECT parent_id FROM business_processes WHERE id = $1`, [storedTop]);
    assert.equal(top.parent_id, null, 'nothing written');

    // An unknown type and a name twice in the file.
    const invalid: any = await svc.importCsv({ file: file([HEADER, 'Packing;operations;;;;enabled', 'packing;;;;;enabled']), dryRun: true }, opts);
    assert.deepEqual(invalid.errors.map((e: any) => [e.row, e.code]), [[2, 'CSV_ENUM_INVALID'], [3, 'CSV_DUPLICATE_KEY']]);
  });
}

/**
 * A file that turns a branch over through stored rows: stored X > Z > Y, the file puts Z at the top
 * and X under Y. The tree after the import has no cycle, so the load writes it like the dry run
 * says, whatever the row order (Z first, being higher in the final tree).
 */
async function testReorderThroughStoredRows() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'bp-csv-reorder');
    const x = await seedProcess(runner, { name: 'X' });
    const z = await seedProcess(runner, { name: 'Z', parent_id: x });
    await seedProcess(runner, { name: 'Y', parent_id: z });
    const svc = service();
    const opts = { manager: runner.manager };
    const upload = file([HEADER, 'X;;Y;;;enabled', 'Z;;;;;enabled']);
    for (const dryRun of [true, false]) {
      const result: any = await svc.importCsv({ file: upload, dryRun }, opts);
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.equal(result.updated, 2, dryRun ? 'dry run' : 'load');
    }
    const rows = await runner.query(
      `SELECT c.name, p.name AS parent FROM business_processes c LEFT JOIN business_processes p ON p.id = c.parent_id
        WHERE c.tenant_id = $1 ORDER BY c.name`,
      [tenantId],
    );
    assert.deepEqual(rows.map((r: any) => [r.name, r.parent]), [['X', 'Y'], ['Y', 'Z'], ['Z', null]]);
  });
}

/**
 * The file has no end of validity: re-importing an export keeps a future end of validity (the
 * row's status is the one the process has), and a row that names the process in another case
 * updates it under its stored name, saying so.
 */
async function testFutureEndOfValidityAndCase() {
  await inRolledBackTransaction(async (runner) => {
    await seedTenant(runner, 'bp-csv-future');
    const future = '2099-06-30T15:45:00.000Z';
    const id = await seedProcess(runner, { name: 'Order to cash', description: 'Kept', disabled_at: future });
    const svc = service();
    const opts = { manager: runner.manager };
    const exported = await svc.exportCsv('data', { ...opts, language: 'fr' });
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file: { buffer: Buffer.from(exported.content, 'utf8') } as Express.Multer.File, dryRun, language: 'fr' }, opts);
      assert.deepStrictEqual([result.ok, result.errors, result.updated, (result as any).unchanged], [true, [], 0, 1], JSON.stringify(result));
    }
    const renamed = await svc.importCsv({ file: file([HEADER, 'ORDER TO CASH;;;Changed;;enabled']), dryRun: false, language: 'en' }, opts);
    assert.deepStrictEqual([renamed.ok, renamed.inserted, renamed.updated], [true, 0, 1], JSON.stringify(renamed.errors));
    assert.deepStrictEqual((renamed as any).warnings.map((w: any) => [w.code, w.row]), [['CSV_NAME_MATCHED_CASE', 2]]);
    const [row] = await runner.query(`SELECT name, description, disabled_at FROM business_processes WHERE id = $1`, [id]);
    assert.deepStrictEqual(
      [row.name, row.description, new Date(row.disabled_at).toISOString()],
      ['Order to cash', 'Changed', future],
      'the stored name and the future end of validity stay',
    );
  });
}

void runSpecs('business-process-csv-import.integration.spec', [
  ['testIdenticalRowsUnchanged', testIdenticalRowsUnchanged],
  ['testParents', testParents],
  ['testReorderThroughStoredRows', testReorderThroughStoredRows],
  ['testFutureEndOfValidityAndCase', testFutureEndOfValidityAndCase],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
