import 'dotenv/config';
import * as assert from 'node:assert/strict';
import type { EntityManager, QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { csvDataRowLines } from '../../common/csv/csv-row-lines';
import type { CsvCallerAccess, CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { TasksCsvService } from '../tasks-csv.service';
import { seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Lot I3 of 26.11.9, fixes of the adversarial review. The viewers and owners of a row go to the task
// the import writes, its related object found as the import found it (Kad's proposal included), with
// one read of each family per import. Kad's proposal of an incident (`INC-n`) is judged as the cell
// would be, for a person who reads the incidents. In merge mode, a stored phase (or stream, or
// department) is kept for a name nothing finds only while the row leaves its project (category,
// company) as stored. The lines of a match, a refusal and an undone match are the import's, blank
// lines aside.
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
  manager: EntityManager,
  tenantId: string,
  csv: string,
  params: Partial<CsvImportParams>,
  access: CsvCallerAccess = ADMIN,
): Promise<CsvImportResult> {
  return service.import(file(csv), { dryRun: true, mode: 'enrich', operation: 'upsert', ...params }, {
    manager,
    tenantId,
    userId: null,
    isAdmin: access.isAdmin === true,
    access,
  });
}

const codes = (result: CsvImportResult) => result.errors.map((error) => [error.row, error.column, error.code]);
const warned = (result: CsvImportResult) => result.warnings.map((warning) => [warning.row, warning.column, warning.code]);

async function seedProject(runner: QueryRunner, tenantId: string, name: string, itemNumber: number): Promise<string> {
  return (await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, name, itemNumber],
  ))[0].id;
}

async function emailOf(runner: QueryRunner, id: string): Promise<string> {
  return (await runner.query(`SELECT email FROM users WHERE id = $1`, [id]))[0].email;
}

// Constat 1: Kad proposes the related object; the task created, and the task updated, take the
// viewers and owners of their row. An undone proposal refuses the row, and nothing is written.
async function testPeopleFollowKadsRelatedObject() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-people');
    const project = await seedProject(runner, tenantId, 'Projet Alpha', 61);
    const ada = await seedUser(runner, tenantId, `ada-${tenantId.slice(0, 8)}@example.test`);
    const bob = await seedUser(runner, tenantId, `bob-${tenantId.slice(0, 8)}@example.test`);
    const [adaEmail, bobEmail] = [await emailOf(runner, ada), await emailOf(runner, bob)];
    await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, viewer_ids, owner_ids)
       VALUES ($1, 910, 'Suivi', 'open', 'project', $2, '[]'::jsonb, '[]'::jsonb)`,
      [tenantId, project],
    );
    const csv = [
      'title;related_object_type;related_object_name;viewer_email_1;owner_email_1',
      `Nouvelle;project;Alpha;${adaEmail};${bobEmail}`,
      `Suivi;project;Alpha;${bobEmail};${adaEmail}`,
    ].join('\n');
    const proposals = { related_object_name: { Alpha: 'Projet Alpha' } };
    const load = await importCsv(runner.manager, tenantId, csv, { dryRun: false, proposals });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    // The task « Suivi » keeps its stored project in merge mode: only the new task's name is matched.
    assert.deepEqual((load.matches ?? []).map((m) => [m.column, m.value, m.target, m.origin, m.lines]), [
      ['related_object_name', 'Alpha', 'Projet Alpha', 'model', [2]],
    ]);
    const tasks = await runner.query(
      `SELECT title, related_object_id = $2 AS on_project, viewer_ids, owner_ids FROM tasks WHERE tenant_id = $1 ORDER BY title`,
      [tenantId, project],
    );
    assert.deepEqual(tasks.map((t: any) => [t.title, t.on_project, t.viewer_ids, t.owner_ids]), [
      ['Nouvelle', true, [ada], [bob]],
      ['Suivi', true, [bob], [ada]],
    ], 'the viewers and owners go to the task the import wrote');

    // The proposal undone: « Alpha » names nothing, the row is refused and nothing is written.
    const undone = await importCsv(runner.manager, tenantId, csv.split('\n').slice(0, 2).join('\n').replace('Nouvelle', 'Autre'), {
      dryRun: false, proposals, unmatched: [{ column: 'related_object_name', value: 'Alpha' }],
    });
    assert.deepEqual(codes(undone), [[2, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND']]);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM tasks WHERE tenant_id = $1 AND title = 'Autre'`, [tenantId]);
    assert.equal(n, 0);
  });
}

// Constat 2: Kad names a task's incident by its reference. Taken for a person who reads the incidents
// (an administrator, the IT Landscape roles), as the cell « INC-4 » is; refused, and the row with it,
// for a person who does not (Tasks Administrator alone).
async function testIncidentProposal() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-incident');
    const [incident] = await runner.query(
      `INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 4, 'Panne du serveur', 'major') RETURNING id`,
      [tenantId],
    );
    const csv = ['title;related_object_type;related_object_name', 'Analyse;incident;la panne de mardi'].join('\n');
    const proposals = { related_object_name: { 'la panne de mardi': 'INC-4' } };
    const itLandscapeReader: CsvCallerAccess = { isAdmin: false, permissions: { tasks: 'admin', incidents: 'reader' } };
    const tasksAdmin: CsvCallerAccess = { isAdmin: false, permissions: { tasks: 'admin' } };

    for (const access of [ADMIN, itLandscapeReader]) {
      const check = await importCsv(runner.manager, tenantId, csv, { proposals }, access);
      assert.deepEqual(codes(check), [], JSON.stringify(access));
      assert.deepEqual((check.matches ?? []).map((m) => [m.value, m.target, m.origin]), [['la panne de mardi', 'INC-4', 'model']]);
      assert.equal(check.refusedProposals, undefined);
    }
    const refused = await importCsv(runner.manager, tenantId, csv, { proposals }, tasksAdmin);
    assert.deepEqual(codes(refused), [[2, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND']]);
    assert.deepEqual(refused.refusedProposals?.map((r) => [r.value, r.target, r.reason]), [['la panne de mardi', 'INC-4', 'missing']]);
    // The cell itself keeps its reading, as before.
    const cell = await importCsv(runner.manager, tenantId, csv.replace('la panne de mardi', 'INC-4'), {}, tasksAdmin);
    assert.deepEqual(codes(cell), []);

    const load = await importCsv(runner.manager, tenantId, csv, { dryRun: false, proposals }, itLandscapeReader);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const [task] = await runner.query(`SELECT related_object_id FROM tasks WHERE tenant_id = $1 AND title = 'Analyse'`, [tenantId]);
    assert.equal(task.related_object_id, incident.id);
  });
}

// Constat 4: in merge mode, a row that moves a task to another project and names a phase nothing
// finds clears the phase (said as in full replace); the load passes. A row that keeps the project
// keeps the stored phase. Same rule for a stream and its category.
async function testKeptValueOfAChangedOwner() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-kept');
    const a = await seedProject(runner, tenantId, 'Projet A', 71);
    const b = await seedProject(runner, tenantId, 'Projet B', 72);
    const [build] = await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Build') RETURNING id`, [tenantId, a]);
    await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Design')`, [tenantId, b]);
    const [catA] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Catégorie A') RETURNING id`, [tenantId]);
    const [catB] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Catégorie B') RETURNING id`, [tenantId]);
    const [stream] = await runner.query(`INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Filière A') RETURNING id`, [tenantId, catA.id]);
    const [moved] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, phase_id, viewer_ids, owner_ids)
       VALUES ($1, 901, 'Moved', 'open', 'project', $2, $3, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
      [tenantId, a, build.id],
    );
    const [stays] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, phase_id, viewer_ids, owner_ids)
       VALUES ($1, 902, 'Stays', 'open', 'project', $2, $3, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
      [tenantId, a, build.id],
    );
    const [recat] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, category_id, stream_id, viewer_ids, owner_ids)
       VALUES ($1, 903, 'Recat', 'open', $2, $3, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
      [tenantId, catA.id, stream.id],
    );
    const [samecat] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, category_id, stream_id, viewer_ids, owner_ids)
       VALUES ($1, 904, 'Samecat', 'open', $2, $3, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
      [tenantId, catA.id, stream.id],
    );
    const csv = [
      'id;title;related_object_type;related_object_id;phase_name;category_name;stream_name',
      `${moved.id};Moved;project;${b};Buidl;;`,
      `${stays.id};Stays;project;${a};Buidl;;`,
      `${recat.id};Recat;;;;Catégorie B;Filière X`,
      `${samecat.id};Samecat;;;;Catégorie A;Filière X`,
    ].join('\n');
    const check = await importCsv(runner.manager, tenantId, csv, {});
    assert.deepEqual(codes(check), []);
    assert.deepEqual(warned(check), [
      [2, 'phase_name', 'CSV_REFERENCE_NOT_FOUND_CLEARED'],
      [3, 'phase_name', 'CSV_REFERENCE_NOT_FOUND_KEPT'],
      [4, 'stream_name', 'CSV_REFERENCE_NOT_FOUND_CLEARED'],
      [5, 'stream_name', 'CSV_REFERENCE_NOT_FOUND_KEPT'],
    ]);
    const load = await importCsv(runner.manager, tenantId, csv, { dryRun: false });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const rows = await runner.query(
      `SELECT title, related_object_id, phase_id, category_id, stream_id FROM tasks WHERE tenant_id = $1 ORDER BY item_number`,
      [tenantId],
    );
    assert.deepEqual(rows.map((r: any) => [r.title, r.related_object_id, r.phase_id, r.category_id, r.stream_id]), [
      ['Moved', b, null, null, null],
      ['Stays', a, build.id, null, null],
      ['Recat', null, null, catB.id, null],
      ['Samecat', null, null, catA.id, stream.id],
    ]);
  });
}

// Constat 8: the load reads each family of related objects once per import, whatever the number of
// names (the viewers and owners no longer read it again per name).
async function testOneReadOfAFamily() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-reads');
    const ada = await seedUser(runner, tenantId, `ada-${tenantId.slice(0, 8)}@example.test`);
    const adaEmail = await emailOf(runner, ada);
    const names = ['Projet un', 'Projet deux', 'Projet trois', 'Projet quatre'];
    for (const [i, name] of names.entries()) await seedProject(runner, tenantId, name, 81 + i);
    const reads = async (count: number) => {
      const statements: string[] = [];
      const manager = Object.create(runner.manager) as EntityManager;
      (manager as any).query = (sql: string, params?: unknown[]) => {
        statements.push(sql);
        return runner.manager.query(sql, params);
      };
      const csv = ['title;related_object_type;related_object_name;viewer_email_1',
        ...names.slice(0, count).map((name, i) => `Tâche ${count}-${i};project;${name.normalize('NFD').replace(/\p{M}/gu, '')};${adaEmail}`)].join('\n');
      const load = await importCsv(manager, tenantId, csv, { dryRun: false });
      assert.equal(load.ok, true, JSON.stringify(load.errors));
      return statements.filter((sql) => /FROM portfolio_projects WHERE tenant_id = \$1( AND LOWER| *$)/.test(sql.trim())).length;
    };
    const one = await reads(1);
    assert.equal(await reads(4), one, 'four names read the projects as often as one');
    assert.ok(one <= 1, `one read of the projects (${one})`);
  });
}

// Point 6: a match, a refused proposal and an undone match carry the import's row numbers, before and
// after a line of spaces and a blank line; the person's lines follow from `csvDataRowLines`.
async function testLinesAroundBlankLines() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-lines');
    await seedProject(runner, tenantId, 'Déploiement réseau', 91);
    await seedProject(runner, tenantId, 'Projet Alpha', 92);
    await seedProject(runner, tenantId, 'Écran B', 93);
    const ada = await seedUser(runner, tenantId, `ada-${tenantId.slice(0, 8)}@example.test`);
    const adaEmail = await emailOf(runner, ada);
    const csv = [
      'title;related_object_type;related_object_name;viewer_email_1',
      `Baies;project;Deploiement reseau;${adaEmail}`,
      '   ',
      `Câbles;project;Projet Alpha;${adaEmail}`,
      '',
      'Recette;project;Ecran B;',
    ].join('\n');
    const params = {
      proposals: { related_object_name: { 'Projet Alpha': 'Projet Inexistant' } },
      unmatched: [{ column: 'related_object_name', value: 'Ecran B' }],
    };
    const check = await importCsv(runner.manager, tenantId, csv, params);
    assert.deepEqual((check.matches ?? []).map((m) => [m.value, m.lines]), [['Deploiement reseau', [2]]]);
    assert.deepEqual(check.refusedProposals?.map((r) => [r.value, r.lines]), [['Projet Alpha', [3]]]);
    assert.deepEqual(codes(check), [[4, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND']]);
    assert.deepEqual(await csvDataRowLines(csv, ';'), [2, 4, 6], 'rows 2, 3 and 4 are the person\'s lines 2, 4 and 6');

    // Without the refused row, the load writes each row's viewers on its own task.
    const load = await importCsv(runner.manager, tenantId, csv.split('\n').slice(0, 5).join('\n'), { ...params, dryRun: false });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const tasks = await runner.query(`SELECT title, viewer_ids FROM tasks WHERE tenant_id = $1 ORDER BY title`, [tenantId]);
    assert.deepEqual(tasks.map((t: any) => [t.title, t.viewer_ids]), [['Baies', [ada]], ['Câbles', [ada]]]);
  });
}

void runSpecs('task-csv-review-fixes.integration.spec', [
  ['testPeopleFollowKadsRelatedObject', testPeopleFollowKadsRelatedObject],
  ['testIncidentProposal', testIncidentProposal],
  ['testKeptValueOfAChangedOwner', testKeptValueOfAChangedOwner],
  ['testOneReadOfAFamily', testOneReadOfAFamily],
  ['testLinesAroundBlankLines', testLinesAroundBlankLines],
]);
