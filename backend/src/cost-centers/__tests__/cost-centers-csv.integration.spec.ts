import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { COST_CENTER_CSV_HEADERS } from '../cost-centers-csv.service';
import { context, seedCompany, seedLine, seedTenant, seedUser, services, withRollback } from './cost-center-test-helpers';
import { loadCostCenterTree } from '../cost-center-tree.util';

// The cost center CSV: any row order imports (parents resolved in a second
// pass), the whole resulting tree is checked before anything is written, row
// errors carry the file line, a dry run writes nothing, and an export imports
// back as all unchanged.

const HEADER = COST_CENTER_CSV_HEADERS.join(';');

function file(lines: string[], header = HEADER): Express.Multer.File {
  return { buffer: Buffer.from(`\ufeff${header}\n${lines.join('\n')}\n`, 'utf8'), originalname: 'cost_centers.csv' } as Express.Multer.File;
}

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  await seedCompany(runner, tenantId, 'Fromage Test SA');
  await seedCompany(runner, tenantId, 'Kaas Test BV');
  const email = `cc-csv-${randomUUID().slice(0, 8)}@example.test`;
  await seedUser(runner, tenantId, email);
  const { svc, csv } = services(runner.manager);
  return { tenantId, email, svc, csv, ctx: context(runner.manager, tenantId) };
}

async function codes(runner: QueryRunner, tenantId: string) {
  const rows = await runner.query(`SELECT code FROM cost_centers WHERE tenant_id = $1 ORDER BY code`, [tenantId]);
  return rows.map((row: any) => row.code);
}

async function testChildrenBeforeParents() {
  await withRollback(async (runner) => {
    const { tenantId, email, svc, csv, ctx } = await seed(runner, 'order');
    const lines = [
      `IT-100;cost_center;Infrastructure;IT;Fromage Test SA;${email};Servers and network;enabled;`,
      'IT-200;cost_center;Applications;it;fromage test sa;;;enabled;',
      'LG-10;cost_center;Logistics IT;;Kaas Test BV;;;;',
      'IT;group;IT department;GRP;;;;enabled;',
      'GRP;group;Group IT;;;;;enabled;',
    ];
    const dry = await csv.importCsv({ file: file(lines), dryRun: true }, ctx);
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual([dry.inserted, dry.updated, dry.unchanged, dry.total], [5, 0, 0, 5]);
    assert.deepEqual(await codes(runner, tenantId), [], 'a dry run writes nothing');

    const done = await csv.importCsv({ file: file(lines), dryRun: false }, ctx);
    assert.equal(done.ok, true, JSON.stringify(done.errors));
    assert.equal(done.inserted, 5);
    const items = await loadCostCenterTree(runner.manager, tenantId);
    assert.deepEqual(items.map((node) => [node.code, node.depth]), [['GRP', 0], ['IT', 1], ['IT-100', 2], ['IT-200', 2], ['LG-10', 0]]);
    const infra = items.find((node) => node.code === 'IT-100')!;
    assert.equal(infra.path, 'Group IT › IT department › Infrastructure');
    assert.equal(infra.company_name, 'Fromage Test SA');
    assert.ok(infra.owner_user_id);
    const detail = await svc.get(infra.id, ctx);
    assert.equal(detail.description, 'Servers and network');

    // A second import of the same file changes nothing and writes no audit.
    const [{ n: auditBefore }] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'cost_centers'`, [tenantId]);
    const again = await csv.importCsv({ file: file(lines), dryRun: false }, ctx);
    assert.deepEqual([again.inserted, again.updated, again.unchanged], [0, 0, 5]);
    const [{ n: auditAfter }] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'cost_centers'`, [tenantId]);
    assert.equal(auditAfter, auditBefore);

    // An update moves a node under a group created in the same file.
    const moved = await csv.importCsv({
      file: file(['LG-10;cost_center;Logistics IT;LOG;Kaas Test BV;;;enabled;', 'LOG;group;Logistics;;;;;enabled;']),
      dryRun: false,
    }, ctx);
    assert.deepEqual([moved.ok, moved.inserted, moved.updated], [true, 1, 1]);
    const logistics = (await loadCostCenterTree(runner.manager, tenantId)).find((node) => node.code === 'LG-10')!;
    assert.equal(logistics.path, 'Logistics › Logistics IT');
  });
}

async function testRowErrors() {
  await withRollback(async (runner) => {
    const { tenantId, csv, ctx } = await seed(runner, 'errors');
    const disabledEmail = `cc-off-${randomUUID().slice(0, 8)}@example.test`;
    await seedUser(runner, tenantId, disabledEmail, 'disabled');
    const result = await csv.importCsv({
      file: file([
        'A;cost_center;Unknown company;;Nowhere Inc;;;enabled;',
        'B;group;Unknown parent;ZZZ;;;;enabled;',
        'C;group;Group with company;;Fromage Test SA;;;enabled;',
        'D;cost_center;No company;;;;;enabled;',
        `E;cost_center;Disabled owner;;Kaas Test BV;${disabledEmail};;enabled;`,
        'F;cost_center;Leaf;;Kaas Test BV;;;enabled;',
        'G;cost_center;Under a leaf;F;Kaas Test BV;;;enabled;',
        'a;group;Duplicate code;;;;;enabled;',
        'H;folder;Bad kind;;;;;maybe;',
      ]),
      dryRun: false,
    }, ctx);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      { row: 2, message: "Unknown company 'Nowhere Inc'." },
      { row: 3, message: "Unknown parent code 'ZZZ'." },
      { row: 6, message: `Budget holder '${disabledEmail}' is not an active user.` },
      { row: 9, message: 'Code a is already used on row 2.' },
      { row: 10, message: "Type must be 'group' or 'cost_center'." },
      { row: 10, message: "Invalid status 'maybe'. Use 'enabled' or 'disabled'." },
    ]);
    assert.deepEqual(await codes(runner, tenantId), [], 'nothing is written when a row fails');

    // Once every row parses, the tree rules run on the whole file.
    const tree = await csv.importCsv({
      file: file([
        'C;group;Group with company;;Fromage Test SA;;;enabled;',
        'D;cost_center;No company;;;;;enabled;',
        'F;cost_center;Leaf;;Kaas Test BV;;;enabled;',
        'G;cost_center;Under a leaf;F;Kaas Test BV;;;enabled;',
      ]),
      dryRun: false,
    }, ctx);
    assert.equal(tree.ok, false);
    assert.deepEqual(tree.errors, [
      { row: 2, message: 'A group has no company.' },
      { row: 3, message: 'A cost center needs a company.' },
      { row: 5, message: 'Only a group can be a parent. F is a cost center.' },
    ]);
    assert.deepEqual(await codes(runner, tenantId), []);

    const header = await csv.importCsv({ file: file(['X;group;X;;'], 'code;kind;name;parent;company_name'), dryRun: true }, ctx);
    assert.equal(header.ok, false);
    assert.match(header.errors[0].message, /Header mismatch\. Missing: parent_code, owner_email, description, status, Extra: parent/);
  });
}

async function testCycleInsideTheFile() {
  await withRollback(async (runner) => {
    const { tenantId, csv, ctx } = await seed(runner, 'cycle');
    const result = await csv.importCsv({
      file: file([
        'X;group;Group X;Z;;;;enabled;',
        'Y;group;Group Y;X;;;;enabled;',
        'Z;group;Group Z;Y;;;;enabled;',
      ]),
      dryRun: false,
    }, ctx);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((error) => error.row), [2, 3, 4]);
    assert.match(result.errors[0].message, /Group X cannot move under Group Z, which is inside it/);
    assert.deepEqual(await codes(runner, tenantId), []);
  });
}

async function testExportImportIsUnchanged() {
  await withRollback(async (runner) => {
    const { tenantId, email, svc, csv, ctx } = await seed(runner, 'roundtrip');
    const [companyId] = (await runner.query(`SELECT id FROM companies WHERE tenant_id = $1 AND name = 'Kaas Test BV'`, [tenantId])).map((row: any) => row.id);
    const [ownerId] = (await runner.query(`SELECT id FROM users WHERE tenant_id = $1 AND email = $2`, [tenantId, email])).map((row: any) => row.id);
    const group = await svc.create({ code: 'GRP', kind: 'group', name: 'Group; IT "core"', description: '=SUM(A1)' }, ctx);
    const leaf = await svc.create({ code: 'LG-10', kind: 'cost_center', name: 'Logistics IT', company_id: companyId, parent_id: group.id, owner_user_id: ownerId }, ctx);
    await svc.update(leaf.id, { disabled_at: '2030-06-30' }, ctx);
    const old = await svc.create({ code: 'OLD', kind: 'group', name: 'Old', status: 'disabled' }, ctx);
    await seedLine(runner, 'opex', tenantId, leaf.id);
    // The owner left since: the export still names them and the import keeps them.
    await runner.query(`UPDATE users SET status = 'disabled' WHERE tenant_id = $1 AND id = $2`, [tenantId, ownerId]);

    const exported = await csv.exportCsv('data', ctx);
    assert.equal(exported.filename, 'cost_centers.csv');
    const lines = exported.content.replace(/^\ufeff/, '').trim().split('\n');
    assert.equal(lines[0], HEADER);
    assert.equal(lines.length, 4);
    assert.match(exported.content, /'=SUM\(A1\)/, 'formula-like cells are neutralized');

    const back = await csv.importCsv({ file: { buffer: Buffer.from(exported.content, 'utf8'), originalname: 'x.csv' } as Express.Multer.File, dryRun: false }, ctx);
    assert.equal(back.ok, true, JSON.stringify(back.errors));
    assert.deepEqual([back.inserted, back.updated, back.unchanged], [0, 0, 3]);
    const detail = await svc.get(group.id, ctx);
    assert.equal(detail.name, 'Group; IT "core"');
    assert.equal(detail.description, '=SUM(A1)');
    assert.equal((await svc.get(old.id, ctx)).status, 'disabled');
    assert.equal((await svc.get(leaf.id, ctx)).disabled_at, new Date('2030-06-30T12:00:00.000Z').toISOString());

    const template = await csv.exportCsv('template', ctx);
    assert.equal(template.filename, 'cost_centers_template.csv');
    assert.ok(template.content.startsWith('\ufeff'));
    assert.equal(template.content.replace(/^\ufeff/, '').trim(), HEADER);

    // The plan's header set without disabled_at still imports.
    const short = COST_CENTER_CSV_HEADERS.filter((header) => header !== 'disabled_at').join(';');
    const legacy = await csv.importCsv({ file: file(['NEW;group;New group;;;;;enabled'], short), dryRun: true }, ctx);
    assert.equal(legacy.ok, true, JSON.stringify(legacy.errors));
    assert.equal(legacy.inserted, 1);
  });
}

async function testConversionInFileAgainstLines() {
  await withRollback(async (runner) => {
    const { tenantId, svc, csv, ctx } = await seed(runner, 'convert');
    const [companyId] = (await runner.query(`SELECT id FROM companies WHERE tenant_id = $1 AND name = 'Kaas Test BV'`, [tenantId])).map((row: any) => row.id);
    const leaf = await svc.create({ code: 'USED', kind: 'cost_center', name: 'Used', company_id: companyId }, ctx);
    await seedLine(runner, 'capex', tenantId, leaf.id);
    const result = await csv.importCsv({ file: file(['USED;group;Used;;;;;enabled;']), dryRun: true }, ctx);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      { row: 2, message: 'USED is used by 1 CAPEX line. A cost center used by budget lines cannot become a group.' },
    ]);
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testChildrenBeforeParents,
      testRowErrors,
      testCycleInsideTheFile,
      testExportImportIsUnchanged,
      testConversionInFileAgainstLines,
    ]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`cost-centers-csv.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('cost-centers-csv.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
