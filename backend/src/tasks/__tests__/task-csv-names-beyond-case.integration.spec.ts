import 'dotenv/config';
import * as assert from 'node:assert/strict';
import type { QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvCallerAccess, CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { TasksCsvService } from '../tasks-csv.service';
import { seedCompany, seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { seedPerson } from '../../audit/__tests__/record-history.fixtures';

// Lot I3 of 26.11.9: the tasks import finds a task's related object by its name exactly or case
// aside, as before, then accents aside for a person who reads the object's module, at the check as at
// the load; the match is listed and may be undone, and a name nothing finds is refused at the check.
// A person limited by data access never finds, nor sees named, a contract outside their access. A
// phase is found in its project the same way. In merge mode, an e-mail nothing finds keeps the stored
// viewers (or owners) of a task the row updates; elsewhere it is skipped, and said.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const resolver = new CsvResolverService();
const service = new TasksCsvService(
  null as any,
  new CsvExportService(resolver),
  new CsvImportService(resolver, new CsvJsonValidators()),
);
const ADMIN: CsvCallerAccess = { isAdmin: true };

function file(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8'), originalname: 'tasks.csv', mimetype: 'text/csv', size: content.length } as Express.Multer.File;
}

async function importCsv(
  runner: QueryRunner,
  tenantId: string,
  csv: string,
  params: Partial<CsvImportParams>,
  access: CsvCallerAccess = ADMIN,
): Promise<CsvImportResult> {
  return service.import(file(csv), { dryRun: true, operation: 'upsert', ...params }, {
    manager: runner.manager,
    tenantId,
    userId: null,
    isAdmin: access.isAdmin === true,
    access,
  });
}

const codes = (result: CsvImportResult) => result.errors.map((error) => [error.row, error.column, error.code, error.params]);

async function seedProject(runner: QueryRunner, tenantId: string, name: string, itemNumber: number): Promise<string> {
  return (await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, name, itemNumber],
  ))[0].id;
}

async function testProjectBeyondAccents() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-accents');
    const project = await seedProject(runner, tenantId, 'Déploiement réseau', 41);
    const other = await seedProject(runner, tenantId, 'Écran A', 42);
    await seedProject(runner, tenantId, 'Ecran A', 43);
    const [phase] = await runner.query(
      `INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Câblage') RETURNING id`,
      [tenantId, project],
    );
    // Another project's phase of the file's exact name: the phase is found in the task's project.
    await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Cablage')`, [tenantId, other]);
    const csv = [
      'title;related_object_type;related_object_name;phase_name',
      'Baies;project;Deploiement reseau;Cablage',
      'Recette;project;DEPLOIEMENT RESEAU;',
    ].join('\n');
    const expected = [{
      column: 'related_object_name', name: null, value: 'Deploiement reseau', target: 'Déploiement réseau', ref: 'PRJ-41',
      origin: 'server', reason: 'accents', lines: [2, 3], count: 2, undoable: true,
    }, {
      column: 'phase_name', name: null, value: 'Cablage', target: 'Câblage', ref: null,
      origin: 'server', reason: 'accents', lines: [2], count: 1, undoable: true,
    }];
    const check = await importCsv(runner, tenantId, csv, {});
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual(check.matches, expected, 'the check lists the matches');
    const load = await importCsv(runner, tenantId, csv, { dryRun: false });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual(load.matches, expected, 'the load lists the same matches');
    const tasks = await runner.query(
      `SELECT title, related_object_type, related_object_id, phase_id FROM tasks WHERE tenant_id = $1 ORDER BY title`,
      [tenantId],
    );
    assert.deepEqual(tasks.map((task: any) => [task.title, task.related_object_type, task.related_object_id, task.phase_id]), [
      ['Baies', 'project', project, phase.id],
      ['Recette', 'project', project, null],
    ]);

    // Several names accents aside, a name undone, a person who does not read the projects, and a
    // name nothing finds: refused at the check, nothing listed.
    const refused = async (row: string, params: Partial<CsvImportParams>, access?: CsvCallerAccess) => {
      const result = await importCsv(runner, tenantId, `title;related_object_type;related_object_name\n${row}`, params, access);
      assert.equal(result.ok, false);
      assert.equal(result.matches, undefined);
      return codes(result);
    };
    const [[, , code, params]] = (await refused('Cadre;project;Ecràn A', {})) as Array<[number, string, string, Record<string, string>]>;
    assert.deepEqual([code, params?.value, String(params?.names).split(', ').sort()], ['CSV_NAME_AMBIGUOUS_AMONG', 'Ecràn A', ['PRJ-42', 'PRJ-43']]);
    assert.deepEqual(await refused('Undone;project;Deploiement reseau', { unmatched: [{ column: 'related_object_name', value: 'deploiement reseau' }] }), [
      [2, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'Deploiement reseau' }],
    ]);
    assert.deepEqual(await refused('Unread;project;Deploiement reseau', {}, { permissions: { tasks: 'admin' } }), [
      [2, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'Deploiement reseau' }],
    ]);
    assert.deepEqual(await refused('Ghost;project;Projet fantome', {}), [
      [2, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'Projet fantome' }],
    ]);
  });
}

/**
 * The lookup reads in the person's transaction: for a person limited by data access (role
 * `kanap_data_limited`), a contract outside their access is no row at all, so it is neither found
 * without its accents nor named by a match or an ambiguity. A contract in their access still is.
 */
async function testLimitedPersonFindsNoContractOutsideAccess() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-limited');
    const { companyId: inside } = await seedCompany(runner, tenantId, 'Inside Co');
    const { companyId: outside } = await seedCompany(runner, tenantId, 'Outside Co');
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Dell') RETURNING id`, [tenantId]);
    const contract = async (name: string, companyId: string, itemNumber: number): Promise<string> => (await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number) VALUES ($1, $2, $3, $4, '2026-01-01', $5) RETURNING id`,
      [tenantId, name, companyId, supplier.id, itemNumber],
    ))[0].id;
    await contract('Maintenance générale', outside, 1);
    const mine = await contract('Câblage général', inside, 2);
    // Outside, a homonym accents aside that would make the name ambiguous.
    await contract('Câblage Général', outside, 4);
    const person = await seedPerson(runner, tenantId, { first: 'Lila', last: 'Limited' }, { tasks: 'admin', contracts: 'reader' }, { mode: 'limited', nodeCompanyId: inside });
    const [applied] = await runner.query(`SELECT data_access_apply($1) AS mode`, [person.id]);
    assert.equal(applied.mode, 'limited', 'the transaction takes the limited role');
    const access: CsvCallerAccess = { isAdmin: false, permissions: { tasks: 'admin', contracts: 'reader' } };
    const csv = [
      'title;related_object_type;related_object_name',
      'Hidden;contract;Maintenance generale',
      'Mine;contract;Cablage general',
    ].join('\n');
    const result = await importCsv(runner, tenantId, csv, {}, access);
    assert.deepEqual(codes(result), [[2, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'Maintenance generale' }]]);
    assert.deepEqual(result.matches, [{
      column: 'related_object_name', name: null, value: 'Cablage general', target: 'Câblage général', ref: 'CTR-2',
      origin: 'server', reason: 'accents', lines: [3], count: 1, undoable: true,
    }]);
    assert.ok(!JSON.stringify(result).includes('Maintenance générale'), 'the hidden contract is never named');
    assert.ok(!JSON.stringify(result).includes('CTR-4'), 'nor a hidden homonym');
    assert.ok(mine);
  });
}

async function testViewersOfAnUnknownEmail() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-viewers');
    const ada = await seedUser(runner, tenantId, `ada-${tenantId.slice(0, 8)}@example.test`);
    const bob = await seedUser(runner, tenantId, `bob-${tenantId.slice(0, 8)}@example.test`);
    const [{ email: adaEmail }] = await runner.query(`SELECT email FROM users WHERE id = $1`, [ada]);
    const [{ email: bobEmail }] = await runner.query(`SELECT email FROM users WHERE id = $1`, [bob]);
    const [stored] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, viewer_ids, owner_ids) VALUES ($1, 900, 'Kept', 'open', $2::jsonb, '[]'::jsonb) RETURNING id`,
      [tenantId, JSON.stringify([ada])],
    );
    const csv = [
      'id;title;viewer_email_1;viewer_email_2',
      `${stored.id};Kept;${bobEmail};ghost@example.test`,
      `;New task;${adaEmail};ghost@example.test`,
    ].join('\n');
    const viewers = async () => new Map<string, string[]>((await runner.query(
      `SELECT title, viewer_ids FROM tasks WHERE tenant_id = $1`, [tenantId],
    )).map((row: any) => [row.title, row.viewer_ids]));
    const warned = (result: CsvImportResult) => result.warnings.map((warning) => [warning.row, warning.column, warning.code, warning.params]);

    // Merge: the task the row updates keeps its viewers; the new task takes the known one. Said at the check.
    const check = await importCsv(runner, tenantId, csv, {});
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual(warned(check), [
      [2, 'viewer_email_2', 'CSV_REFERENCE_NOT_FOUND_KEPT', { value: 'ghost@example.test' }],
      [3, 'viewer_email_2', 'CSV_REFERENCE_NOT_FOUND_SKIPPED', { value: 'ghost@example.test' }],
    ]);
    const merged = await importCsv(runner, tenantId, csv, { dryRun: false });
    assert.deepEqual(warned(merged), warned(check));
    let now = await viewers();
    assert.deepEqual(now.get('Kept'), [ada], 'the stored viewers are kept whole');
    assert.deepEqual(now.get('New task'), [ada], 'a new task takes the viewers found');

    // Replace: the unknown e-mail is skipped, and said.
    const replaced = await importCsv(runner, tenantId, csv.split('\n').slice(0, 2).join('\n'), { dryRun: false });
    assert.equal(replaced.ok, true, JSON.stringify(replaced.errors));
    assert.deepEqual(warned(replaced), [[2, 'viewer_email_2', 'CSV_REFERENCE_NOT_FOUND_SKIPPED', { value: 'ghost@example.test' }]]);
    now = await viewers();
    assert.deepEqual(now.get('Kept'), [bob], 'replace writes the viewers found');
  });
}

// The viewers and owners are written from the file's columns as the import reads them: a header in
// another case, with spaces for underscores, is the column (lot I3 of 26.11.9, fourth pass).
async function testViewersOfLooseHeaders() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-loose-headers');
    const ada = await seedUser(runner, tenantId, `ada-${tenantId.slice(0, 8)}@example.test`);
    const bob = await seedUser(runner, tenantId, `bob-${tenantId.slice(0, 8)}@example.test`);
    const [{ email: adaEmail }] = await runner.query(`SELECT email FROM users WHERE id = $1`, [ada]);
    const [{ email: bobEmail }] = await runner.query(`SELECT email FROM users WHERE id = $1`, [bob]);
    const csv = ['Title;Viewer Email 1;OWNER_EMAIL_1', `Loose task;${adaEmail};${bobEmail}`].join('\n');
    const load = await importCsv(runner, tenantId, csv, { dryRun: false });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const [task] = await runner.query(`SELECT viewer_ids, owner_ids FROM tasks WHERE tenant_id = $1 AND title = 'Loose task'`, [tenantId]);
    assert.deepEqual([task.viewer_ids, task.owner_ids], [[ada], [bob]], 'the viewers and owners are written');
  });
}

// A phase is found in the task's project, accents aside too: a phase of the same name in another
// project neither refuses the row nor wins it; Kad's proposal is read in that project as well.
async function testPhaseInItsProject() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-phase-project');
    const first = await seedProject(runner, tenantId, 'Projet un', 51);
    const second = await seedProject(runner, tenantId, 'Projet deux', 52);
    const [own] = await runner.query(
      `INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Démarrage') RETURNING id`, [tenantId, first],
    );
    // Another project's phase, equal accents aside: the workspace has two names for « Demarrage ».
    await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Demarráge')`, [tenantId, second]);
    const csv = [
      'title;related_object_type;related_object_name;phase_name',
      'Cadrage;project;Projet un;Demarrage',
      'Lancement;project;Projet un;Start',
      'Hors projet;project;Projet un;Inconnue',
    ].join('\n');
    const params = { proposals: { phase_name: { Start: 'Démarrage', Inconnue: 'Clôture' } } };
    const check = await importCsv(runner, tenantId, csv, params);
    assert.deepEqual(codes(check), []);
    assert.deepEqual(
      check.warnings.map((w) => [w.row, w.column, w.code]),
      [[4, 'phase_name', 'CSV_REFERENCE_NOT_FOUND_CLEARED']],
      'a phase nothing finds is cleared, as before',
    );
    assert.deepEqual((check.matches ?? []).map((m) => [m.column, m.value, m.target, m.reason, m.lines]), [
      ['phase_name', 'Demarrage', 'Démarrage', 'accents', [2]],
      ['phase_name', 'Start', 'Démarrage', 'model', [3]],
    ]);
    assert.deepEqual(check.refusedProposals?.map((r) => [r.column, r.value, r.target]), [['phase_name', 'Inconnue', 'Clôture']]);
    const load = await importCsv(runner, tenantId, csv.split('\n').slice(0, 3).join('\n'), { ...params, dryRun: false });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const phases = await runner.query(`SELECT title, phase_id FROM tasks WHERE tenant_id = $1 ORDER BY title`, [tenantId]);
    assert.deepEqual(phases.map((row: any) => [row.title, row.phase_id]), [['Cadrage', own.id], ['Lancement', own.id]]);
  });
}

void runSpecs('task-csv-names-beyond-case.integration.spec', [
  ['testViewersOfLooseHeaders', testViewersOfLooseHeaders],
  ['testPhaseInItsProject', testPhaseInItsProject],
  ['testProjectBeyondAccents', testProjectBeyondAccents],
  ['testLimitedPersonFindsNoContractOutsideAccess', testLimitedPersonFindsNoContractOutsideAccess],
  ['testViewersOfAnUnknownEmail', testViewersOfAnUnknownEmail],
]);
