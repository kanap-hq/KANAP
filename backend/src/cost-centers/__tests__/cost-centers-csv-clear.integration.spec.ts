import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { COST_CENTER_CSV_HEADERS } from '../cost-centers-csv.service';
import { context, seedCompany, seedTenant, seedUser, services, withRollback } from './cost-center-test-helpers';

// The cost centers import under the clearing rule of every import route (D21 of 26.11.9), called
// as its route calls it (`mode: 'enrich'`):
// - a row finds its node by its code; any other column may be absent and is then never written;
// - on a stored node a blank cell keeps the stored value, the parent included;
// - `-` in the parent moves the node to the top of the tree; `-` clears the company, the budget
//   holder, the description and the end of validity (the node is active again), counted in
//   `cleared` the same at the check and at the load; the tree rules still apply (a cost center
//   needs its company);
// - `-` on the code, the kind, the name or the status is a row error (`CSV_VALUE_CANNOT_BE_CLEARED`);
// - `disabled` with `-` in `disabled_at` is its own contradiction (`CSV_STATUS_DISABLED_DATE_CLEARED`);
// - a new node needs its kind and name;
// - the tree is checked on the merged state: a loop born of a kept parent is refused.

const FULL = COST_CENTER_CSV_HEADERS.join(';');
const REFUSED = 'CSV_VALUE_CANNOT_BE_CLEARED';

type Report = { ok: boolean; inserted: number; updated: number; unchanged: number; cleared?: number; errors: Array<{ row: number; column?: string; code?: string; message: string }> };

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), originalname: 'cost_centers.csv' } as Express.Multer.File;
}

function codes(report: Report): string[] {
  return report.errors.map((error) => `${error.row}:${error.column ?? ''}:${error.code ?? error.message}`);
}

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const companyId = await seedCompany(runner, tenantId, 'Fromage Test SA');
  const email = `cc-clear-${randomUUID().slice(0, 8)}@example.test`;
  const ownerId = await seedUser(runner, tenantId, email);
  const { csv } = services(runner.manager);
  const ctx = context(runner.manager, tenantId);
  const seeded = await csv.importCsv({
    file: file([
      FULL,
      'GRP;group;Group;;;;;enabled;',
      `IT;group;IT department;GRP;;${email};IT text;enabled;`,
      `OPS;cost_center;Operations;IT;Fromage Test SA;${email};Ops;enabled;`,
      'OLD;cost_center;Old;IT;Fromage Test SA;;;disabled;2024-01-01',
    ]),
    dryRun: false,
  }, ctx);
  assert.equal(seeded.ok, true, JSON.stringify(seeded.errors));
  const run = (lines: string[], dryRun = true): Promise<Report> =>
    csv.importCsv({ file: file(lines), dryRun, mode: 'enrich' } as any, ctx) as Promise<Report>;
  const read = async () => Object.fromEntries((await runner.query(
    `SELECT cc.code, cc.kind, cc.name, p.code AS parent, cc.company_id, cc.owner_user_id, cc.description, cc.status, cc.disabled_at
       FROM cost_centers cc LEFT JOIN cost_centers p ON p.id = cc.parent_id
      WHERE cc.tenant_id = $1 ORDER BY cc.code`,
    [tenantId],
  )).map((row: any) => [row.code, row]));
  return { companyId, ownerId, run, read, csv, ctx };
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

// Two columns update the one they carry; blank cells keep, the parent included; a row whose
// filled cells are stored is unchanged.
async function testBlankKeeps() {
  await withRollback(async (runner) => {
    const { companyId, ownerId, run, read } = await seed(runner, 'clear-keep');
    const stored = await read();
    await load(run, ['code;description', 'OPS;Ops'], [0, 0, 1, 0], 'stored description');
    await load(run, [FULL, 'OPS;;;;;;;;'], [0, 0, 1, 0], 'blank cells');
    await load(run, ['code;description', 'OPS;New text'], [0, 1, 0, 0], 'two columns');
    await load(run, [FULL, 'ops;;Operations bis;;;;;;'], [0, 1, 0, 0], 'blank cells of a full file');
    const after = await read();
    assert.deepEqual(after.ops, { ...stored.OPS, code: 'ops', name: 'Operations bis', description: 'New text' });
    assert.deepEqual([after.ops.parent, after.ops.company_id, after.ops.owner_user_id, after.ops.kind], ['IT', companyId, ownerId, 'cost_center']);
  });
}

// `-` moves a node to the top, clears the budget holder, the description and the end of
// validity, counted; on a cost center the company stays required.
async function testDashClears() {
  await withRollback(async (runner) => {
    const { run, read } = await seed(runner, 'clear-dash');
    const stored = await read();
    await load(run, ['code;parent_code;owner_email;description', 'IT;-;-;-'], [0, 1, 0, 3], 'cleared');
    await load(run, ['code;parent_code;owner_email;description', 'IT;-;-;-'], [0, 0, 1, 0], 'already empty');
    await load(run, ['code;disabled_at', 'OLD;-'], [0, 1, 0, 1], 'end of validity');
    const after = await read();
    assert.deepEqual(after.IT, { ...stored.IT, parent: null, owner_user_id: null, description: null });
    assert.deepEqual([after.OLD.status, after.OLD.disabled_at], ['enabled', null], 'active again');
    await refused(run, read, ['code;company_name', 'OPS;-'], ['2:company_name:CSV_COST_CENTER_COMPANY_REQUIRED'], 'a cost center keeps a company');
  });
}

async function testDashRefused() {
  await withRollback(async (runner) => {
    const { run, read } = await seed(runner, 'clear-refused');
    await refused(run, read, ['code;kind;name;status', 'OPS;-;-;-'], [`2:kind:${REFUSED}`, `2:name:${REFUSED}`, `2:status:${REFUSED}`], 'values');
    await refused(run, read, ['code;name', '-;x'], [`2:code:${REFUSED}`], 'the key');
    await refused(run, read, ['code;status;disabled_at', 'OLD;disabled;-'], ['2:status:CSV_STATUS_DISABLED_DATE_CLEARED'], 'disabled and -');
  });
}

async function testCreation() {
  await withRollback(async (runner) => {
    const { run, read } = await seed(runner, 'clear-create');
    await refused(run, read, ['code;description', 'NEW;x'], ['2:kind:CSV_VALUE_REQUIRED', '2:name:CSV_VALUE_REQUIRED'], 'absent');
    await refused(run, read, [FULL, 'NEW;;;;;;;;'], ['2:kind:CSV_VALUE_REQUIRED', '2:name:CSV_VALUE_REQUIRED'], 'blank');
    await load(run, [FULL, 'NEW;group;New;-;-;-;-;;-'], [1, 0, 0, 0], 'optional values: `-` is blank');
    const created = (await read()).NEW;
    assert.deepEqual([created.parent, created.company_id, created.owner_user_id, created.description, created.status], [null, null, null, null, 'enabled']);
  });
}

// IT keeps its parent GRP (blank cell) while GRP moves under IT: a loop of the merged tree.
// Replacing (no mode), the same file moves IT to the top first and loads.
async function testLoopOfTheMergedTree() {
  await withRollback(async (runner) => {
    const { run, read, csv, ctx } = await seed(runner, 'clear-loop');
    const lines = ['code;name;parent_code', 'IT;IT department;', 'GRP;Group;IT'];
    const replaced = await csv.importCsv({ file: file(lines), dryRun: true }, ctx);
    assert.equal(replaced.ok, true, JSON.stringify(replaced.errors));
    const report = await run(lines, true);
    assert.equal(report.ok, false);
    assert.ok(codes(report).some((entry) => /:parent_code:CSV_COST_CENTER_PARENT_INSIDE$/.test(entry)), JSON.stringify(report.errors));
    await refused(run, read, lines, codes(report), 'the load too');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testBlankKeeps, testDashClears, testDashRefused, testCreation, testLoopOfTheMergedTree]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 8).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`cost-centers-csv-clear.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('cost-centers-csv-clear.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
