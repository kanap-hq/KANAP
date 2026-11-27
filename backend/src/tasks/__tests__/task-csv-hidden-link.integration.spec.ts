import 'dotenv/config';
import * as assert from 'node:assert/strict';
import type { QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { TasksCsvService } from '../tasks-csv.service';
import { linkedReadsFromContext } from '../../common/relations/linked-reads';
import { CONTRACT_OUTSIDE_ACCESS } from '../task-csv.config';
import { seedCompany, seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { inRolledBackTransaction, runSpecs, seedItem, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The tasks export of a person in limited data access names a task's contract they cannot read by
// the list's label, and leaves a hidden budget line's id and name empty (lot R4 of 26.11.9). A
// person with access to all data who reads that file back keeps each task on its stored object, in
// all cases, at the preflight as at the load: the label is never a contract's
// name. A row that matches no task and carries the label is refused. The viewers and owners pass
// that follows the import finds each row's task by its id, else by its object (a contract also by
// its reference `CTR-n`), and never touches a homonym. The export of a person who does not read a
// task's record (no read of contracts, a project outside a Business Contributor's participation)
// leaves its id and name empty, as the list. Each test runs in a transaction rolled back.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const resolver = new CsvResolverService();
const service = new TasksCsvService(
  null as any,
  new CsvExportService(resolver),
  new CsvImportService(resolver, new CsvJsonValidators()),
);

const HEADER = 'id,title,related_object_type,related_object_id,related_object_name';

function file(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8'), originalname: 'tasks.csv', mimetype: 'text/csv', size: content.length } as Express.Multer.File;
}

async function importCsv(runner: QueryRunner, tenantId: string, csv: string, params: Partial<CsvImportParams>): Promise<CsvImportResult> {
  return service.import(file(csv), { dryRun: false, operation: 'upsert', ...params }, {
    manager: runner.manager,
    tenantId,
    userId: null,
    isAdmin: true,
  });
}

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'task-csv-hidden');
  const { companyId } = await seedCompany(runner, tenantId, 'Fromage Co');
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Dell') RETURNING id`, [tenantId]);
  const contract = async (name: string, itemNumber: number): Promise<string> => (await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number) VALUES ($1, $2, $3, $4, '2026-01-01', $5) RETURNING id`,
    [tenantId, name, companyId, supplier.id, itemNumber],
  ))[0].id;
  const hidden = await contract('Hidden contract', 1);
  // A contract whose name is the label: never the contract a labelled row names.
  const decoy = await contract(CONTRACT_OUTSIDE_ACCESS.en, 2);
  const visible = await contract('Visible contract', 3);
  const line = await seedItem(runner, 'opex', tenantId, 1, 'Hidden line');
  const task = async (title: string, type: string | null, objectId: string | null, itemNumber: number, viewers: string[] = []): Promise<string> => (await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, viewer_ids)
     VALUES ($1, $2, $3, 'open', $4, $5, $6::jsonb) RETURNING id`,
    [tenantId, itemNumber, title, type, objectId, JSON.stringify(viewers)],
  ))[0].id;
  return { tenantId, hidden, decoy, visible, line, task };
}

async function link(runner: QueryRunner, taskId: string): Promise<[string | null, string | null]> {
  const [row] = await runner.query(`SELECT related_object_type, related_object_id FROM tasks WHERE id = $1`, [taskId]);
  return [row.related_object_type, row.related_object_id];
}

async function viewers(runner: QueryRunner, taskId: string): Promise<string[]> {
  const [row] = await runner.query(`SELECT viewer_ids FROM tasks WHERE id = $1`, [taskId]);
  return row.viewer_ids;
}

/** A limited person's file, read back by a person with access to all data: each task keeps its object. */
async function testHiddenObjectsAreKept() {
  for (const language of ['en', 'fr', 'de', 'es'] as const) {
    await inRolledBackTransaction(async (runner) => {
      const { tenantId, hidden, line, task } = await seed(runner);
      const contractTask = await task('Task of the hidden contract', 'contract', hidden, 1);
      const lineTask = await task('Task of the hidden line', 'spend_item', line, 2);
      const csv = [
        HEADER,
        `${contractTask},Task of the hidden contract,contract,,${CONTRACT_OUTSIDE_ACCESS[language]}`,
        `${lineTask},Task of the hidden line,spend_item,,`,
      ].join('\n');
      const what = language;
      const dry = await importCsv(runner, tenantId, csv, { dryRun: true });
      assert.equal(dry.ok, true, `${what}: preflight ${JSON.stringify(dry.errors)}`);
      const load = await importCsv(runner, tenantId, csv, {});
      assert.equal(load.ok, true, `${what}: load ${JSON.stringify(load.errors)}`);
      assert.deepEqual([load.updated, load.unchanged], [dry.updated, dry.unchanged], `${what}: the preflight counts what the load does`);
      assert.deepEqual(await link(runner, contractTask), ['contract', hidden], `${what}: the task keeps its contract`);
      assert.deepEqual(await link(runner, lineTask), ['spend_item', line], `${what}: the task keeps its line`);
    });
  }
}

/** A labelled row that matches no task is refused, at the preflight as at the load; no contract is linked. */
async function testLabelNamesNoContract() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, decoy } = await seed(runner);
    const csv = [HEADER, `,New task,contract,,${CONTRACT_OUTSIDE_ACCESS.fr}`].join('\n');
    for (const dryRun of [true, false]) {
      const what = dryRun ? 'preflight' : 'load';
      const result = await importCsv(runner, tenantId, csv, { dryRun });
      assert.equal(result.ok, false, `${what}: refused`);
      assert.deepEqual(
        result.errors.map((error) => [error.row, error.column]),
        [[2, 'related_object_name']],
        `${what}: the row is refused on its object (${JSON.stringify(result.errors)})`,
      );
    }
    const linked = await runner.query(`SELECT count(*)::int AS n FROM tasks WHERE tenant_id = $1 AND (title = 'New task' OR related_object_id = $2)`, [tenantId, decoy]);
    assert.equal(linked[0].n, 0, 'nothing written, the contract named like the label is linked to nothing');
  });
}

/** The viewers pass finds each row's task by its id, else by its object; a homonym is never touched. */
async function testViewersReachTheRowsTask() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, hidden, visible, task } = await seed(runner);
    const before = await seedUser(runner, tenantId, 'before@example.invalid');
    const after = await seedUser(runner, tenantId, 'after@example.invalid');
    const contractTask = await task('Shared title', 'contract', hidden, 1, [before]);
    const homonym = await task('Shared title', null, null, 2, [before]);
    const byId = await task('Task of CTR-3 by id', 'contract', visible, 3, [before]);
    const byReference = await task('Task of CTR-3 by reference', 'contract', visible, 4, [before]);
    const csv = [
      `${HEADER},viewer_email_1`,
      `${contractTask},Shared title,contract,,${CONTRACT_OUTSIDE_ACCESS.en},after@example.invalid`,
      `${byId},Task of CTR-3 by id,contract,,CTR-3,after@example.invalid`,
      `,Task of CTR-3 by reference,contract,,CTR-3,after@example.invalid`,
    ].join('\n');
    const result = await importCsv(runner, tenantId, csv, {});
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await viewers(runner, contractTask), [after], 'the hidden contract\'s task, found by its id');
    assert.deepEqual(await viewers(runner, homonym), [before], 'the standalone homonym is left as it is');
    assert.deepEqual(await viewers(runner, byId), [after], 'a row with an id and a reference: the task of its id');
    assert.deepEqual(await viewers(runner, byReference), [after], 'a row without an id: the task of the contract its reference names');
  });
}

/** The export names a task's record as the list does: nothing of a module or a project the person does not read. */
async function testExportFollowsLinkedReads() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, hidden, task } = await seed(runner);
    const person = await seedUser(runner, tenantId, 'contributor@example.invalid');
    const project = async (name: string, itemNumber: number): Promise<string> => (await runner.query(
      `INSERT INTO portfolio_projects (tenant_id, item_number, name, status) VALUES ($1, $2, $3, 'in_progress') RETURNING id`,
      [tenantId, itemNumber, name],
    ))[0].id;
    const inside = await project('Inside project', 1);
    const outside = await project('Outside project', 2);
    await runner.query(`INSERT INTO portfolio_project_team (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [tenantId, inside, person]);
    await task('Task of the contract', 'contract', hidden, 1);
    await task('Task inside', 'project', inside, 2);
    await task('Task outside', 'project', outside, 3);
    const exported = async (permissions: Record<string, string>, scoped: boolean) => (await service.export({
      manager: runner.manager,
      tenantId,
      language: 'en',
      linkedReads: linkedReadsFromContext({ permissions }),
      linkedScopes: scoped ? { projects: { userId: person } } : {},
    })).content as string;

    const contributor = await exported({ tasks: 'admin', portfolio_projects: 'reader' }, true);
    for (const secret of ['Hidden contract', 'CTR-1', hidden, 'Outside project', outside]) {
      assert.ok(!contributor.includes(secret), `the contributor's file does not name ${secret}`);
    }
    assert.ok(contributor.includes('Inside project') && contributor.includes(inside), 'their project, named with its id');
    assert.match(contributor, /Task outside/, 'the task of the outside project is in the file');

    const reader = await exported({ tasks: 'admin', portfolio_projects: 'reader', contracts: 'reader' }, false);
    for (const name of ['Hidden contract', 'Outside project', outside, 'Inside project']) {
      assert.ok(reader.includes(name), `a reader of the modules: ${name}, as before`);
    }
  });
}

void runSpecs('task-csv-hidden-link.integration.spec', [
  ['hidden objects kept', testHiddenObjectsAreKept],
  ['label names no contract', testLabelNamesNoContract],
  ['viewers reach the row\'s task', testViewersReachTheRowsTask],
  ['export follows the linked reads', testExportFollowsLinkedReads],
]);
