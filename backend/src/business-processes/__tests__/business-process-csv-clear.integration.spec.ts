import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { BusinessProcessesService } from '../business-processes.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The business processes import under the clearing rule of every import route (D21 of 26.11.9),
// called as its route calls it (`mode: 'enrich'`), each test rolled back:
// - a row finds its process by its name; any other column may be absent and is then never written;
// - on a stored process a blank cell keeps the stored value, the parent included;
// - `-` in the parent moves the process to the top; `-` clears the type, the description and the
//   notes; the result counts them (`cleared`), the same at the check and at the load;
// - `-` on the name or the status is a row error (`CSV_VALUE_CANNOT_BE_CLEARED`);
// - a new process needs its name; `-` on an optional value reads as blank.

const FULL = 'name;process_type;parent_name;description;notes;status';
const REFUSED = 'CSV_VALUE_CANNOT_BE_CLEARED';
const STAMP = '2020-01-01T00:00:00Z';

type Report = { ok: boolean; inserted: number; updated: number; unchanged: number; cleared?: number; errors: Array<{ row: number; column?: string; code?: string; message: string }> };

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n') + '\n', 'utf8') } as Express.Multer.File;
}

function codes(report: Report): string[] {
  return report.errors.map((error) => `${error.row}:${error.column ?? ''}:${error.code ?? error.message}`);
}

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const insert = async (values: Record<string, unknown>): Promise<string> => {
    const columns = Object.keys(values);
    const [row] = await runner.query(
      `INSERT INTO business_processes (${columns.join(', ')}, updated_at) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}, '${STAMP}') RETURNING id`,
      Object.values(values),
    );
    return row.id;
  };
  const salesId = await insert({ name: 'Sales', process_type: 'core' });
  await insert({ name: 'Order to cash', process_type: 'core', parent_id: salesId, description: 'From order to payment', notes: 'Kept' });
  const svc = new BusinessProcessesService(undefined as any, undefined as any, new AuditService(undefined as any));
  const run = (lines: string[], dryRun = true): Promise<Report> =>
    svc.importCsv({ file: file(lines), dryRun, mode: 'enrich' } as any, { manager: runner.manager }) as Promise<Report>;
  const read = async () => Object.fromEntries((await runner.query(
    `SELECT bp.name, bp.process_type, p.name AS parent, bp.description, bp.notes, bp.status
       FROM business_processes bp LEFT JOIN business_processes p ON p.id = bp.parent_id
      WHERE bp.tenant_id = $1 ORDER BY bp.name`,
    [tenantId],
  )).map((row: any) => [row.name, row]));
  return { run, read };
}

async function load(run: (lines: string[], dryRun?: boolean) => Promise<Report>, lines: string[], counts: number[], label: string) {
  for (const dryRun of [true, false]) {
    const report = await run(lines, dryRun);
    assert.equal(report.ok, true, `${label} (${dryRun ? 'check' : 'load'}): ${JSON.stringify(report.errors)}`);
    assert.deepEqual([report.inserted, report.updated, report.unchanged, report.cleared], counts, `${label} (${dryRun ? 'check' : 'load'})`);
  }
}

async function refused(run: (lines: string[], dryRun?: boolean) => Promise<Report>, read: () => Promise<unknown>, lines: string[], expected: string[], label: string) {
  const before = await read();
  const report = await run(lines, false);
  assert.equal(report.ok, false, label);
  assert.deepEqual(codes(report), expected, label);
  assert.deepEqual(await read(), before, `${label}: nothing written`);
}

async function testBlankKeeps() {
  await inRolledBackTransaction(async (runner) => {
    const { run, read } = await seed(runner, 'bp-clear-keep');
    const stored = await read();
    await load(run, ['name;notes', 'Order to cash;Kept'], [0, 0, 1, 0], 'stored notes');
    await load(run, [FULL, 'Order to cash;;;;;'], [0, 0, 1, 0], 'blank cells');
    await load(run, ['name;description', 'Order to cash;New text'], [0, 1, 0, 0], 'two columns');
    await load(run, [FULL, 'Order to cash;;;;Newer;'], [0, 1, 0, 0], 'blank cells of a full file');
    assert.deepEqual((await read())['Order to cash'], { ...stored['Order to cash'], description: 'New text', notes: 'Newer' }, 'type and parent kept');
  });
}

async function testDashClears() {
  await inRolledBackTransaction(async (runner) => {
    const { run, read } = await seed(runner, 'bp-clear-dash');
    const stored = await read();
    const lines = ['name;process_type;parent_name;description;notes', 'Order to cash;-;-;-;-'];
    await load(run, lines, [0, 1, 0, 4], 'cleared');
    assert.deepEqual((await read())['Order to cash'], { ...stored['Order to cash'], process_type: null, parent: null, description: null, notes: null });
    await load(run, lines, [0, 0, 1, 0], 'already empty');
  });
}

async function testDashRefused() {
  await inRolledBackTransaction(async (runner) => {
    const { run, read } = await seed(runner, 'bp-clear-refused');
    await refused(run, read, ['name;status', 'Order to cash;-'], [`2:status:${REFUSED}`], 'the status');
    await refused(run, read, ['name;notes', '-;x'], [`2:name:${REFUSED}`], 'the key');
  });
}

async function testCreation() {
  await inRolledBackTransaction(async (runner) => {
    const { run, read } = await seed(runner, 'bp-clear-create');
    await refused(run, read, ['name;notes', ';x'], ['2:name:CSV_VALUE_REQUIRED'], 'no name');
    await load(run, [FULL, 'Procure to pay;-;-;-;-;'], [1, 0, 0, 0], 'optional values: `-` is blank');
    assert.deepEqual((await read())['Procure to pay'], {
      name: 'Procure to pay', process_type: null, parent: null, description: null, notes: null, status: 'enabled',
    });
  });
}

void runSpecs('business-process-csv-clear.integration.spec', [
  ['testBlankKeeps', testBlankKeeps],
  ['testDashClears', testDashClears],
  ['testDashRefused', testDashRefused],
  ['testCreation', testCreation],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
