import 'dotenv/config';
import * as assert from 'node:assert/strict';
import type { EntityManager, QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvCallerAccess, CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import type { IncidentViewer } from '../../incidents/incident-visibility';
import { TasksCsvService } from '../tasks-csv.service';
import { seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Lot I3 of 26.11.9, fixes C. A row that names an existing task's related object by its name, without
// its id, has that name read as for a new task: the same rule, the same listed match, the same refusal;
// the id, when the row gives it, wins. A task moved to another project without a phase cell keeps its
// phase only when the new project has a phase of that name; otherwise the phase is cleared, and said, at
// the check. A restricted incident the person does not see is neither found nor named by its `INC-n`.
// Fixes E: accents aside, two records of one name refuse the row, named (a related object, a phase);
// a restricted incident the person does not see is not found by its id either; a task moved out of a
// project (to an incident here) without a phase cell has its phase cleared and said at the check.
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
  viewer?: IncidentViewer,
): Promise<CsvImportResult> {
  return service.import(file(csv), { dryRun: true, mode: 'enrich', operation: 'upsert', ...params }, {
    manager,
    tenantId,
    userId: viewer?.userId ?? null,
    isAdmin: access.isAdmin === true,
    viewer,
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

async function seedTask(runner: QueryRunner, tenantId: string, itemNumber: number, title: string, projectId: string, phaseId: string | null = null): Promise<string> {
  return (await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, phase_id, viewer_ids, owner_ids)
     VALUES ($1, $2, $3, 'open', 'project', $4, $5, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
    [tenantId, itemNumber, title, projectId, phaseId],
  ))[0].id;
}

// Point 1: an existing task whose row names its related object by its name, the id cell blank or the
// column left out. A name of another project moves the task (a match beyond case listed); the name of
// the stored project leaves the row unchanged (its match beyond case listed too); a name nothing finds
// refuses the row. A row that gives the id keeps it, whatever its name.
async function testExistingTaskObjectByName() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-c-name');
    const alpha = await seedProject(runner, tenantId, 'Projet Alpha', 1);
    const suivi = await seedProject(runner, tenantId, "Suivi connecté de l'affinage", 2);
    const t10 = await seedTask(runner, tenantId, 10, 'T dix', alpha);
    const t11 = await seedTask(runner, tenantId, 11, 'T onze', suivi);
    const t12 = await seedTask(runner, tenantId, 12, 'T douze', alpha);
    const t13 = await seedTask(runner, tenantId, 13, 'T treize', alpha);
    const csv = [
      'id;title;related_object_type;related_object_id;related_object_name',
      `${t10};T dix;project;;Suivi connecte de l'affinage`,
      `${t11};T onze;project;;Suivi connecte de l'affinage`,
      `${t12};T douze;project;;Projet Inconnu`,
      `${t13};T treize;project;${alpha};Suivi connecte de l'affinage`,
    ].join('\n');
    const check = await importCsv(runner.manager, tenantId, csv, {});
    assert.deepEqual(codes(check), [[4, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND']]);
    assert.deepEqual((check.matches ?? []).map((m) => [m.column, m.value, m.target, m.ref, m.lines]), [
      ['related_object_name', "Suivi connecte de l'affinage", "Suivi connecté de l'affinage", 'PRJ-2', [2, 3]],
    ]);

    const valid = csv.split('\n').filter((_, i) => i !== 3).join('\n');
    const dry = await importCsv(runner.manager, tenantId, valid, {});
    assert.deepEqual([dry.updated, dry.unchanged], [1, 2], 'T dix moves; T onze and T treize are unchanged');
    // In full replace the blank id cell reads the name the same way.
    const replace = await importCsv(runner.manager, tenantId, valid, { mode: 'replace' });
    assert.deepEqual(codes(replace), []);
    assert.deepEqual([replace.updated, replace.unchanged], [1, 2]);

    const load = await importCsv(runner.manager, tenantId, valid, { dryRun: false });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const rows = await runner.query(`SELECT item_number, related_object_id FROM tasks WHERE tenant_id = $1 ORDER BY item_number`, [tenantId]);
    assert.deepEqual(rows.map((r: any) => [r.item_number, r.related_object_id]), [[10, suivi], [11, suivi], [12, alpha], [13, alpha]]);

    // The id column left out: the name moves the task back, case aside (no match listed).
    const back = await importCsv(runner.manager, tenantId, ['id;title;related_object_type;related_object_name', `${t10};T dix;project;projet alpha`].join('\n'), { dryRun: false });
    assert.equal(back.ok, true, JSON.stringify(back.errors));
    assert.equal(back.matches, undefined);
    const [moved] = await runner.query(`SELECT related_object_id FROM tasks WHERE id = $1`, [t10]);
    assert.equal(moved.related_object_id, alpha);
  });
}

// Point 2: in merge mode, a task moved to another project without a phase cell (blank or left out),
// by its id or by its name. The new project's phase of the same name is taken; a phase the new project
// does not have is cleared at the check (`CSV_REFERENCE_NOT_FOUND_CLEARED`), and the load passes.
async function testPhaseOfAMovedTask() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-c-phase');
    const a = await seedProject(runner, tenantId, 'Projet A', 1);
    const b = await seedProject(runner, tenantId, 'Projet B', 2);
    const [buildA] = await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Build') RETURNING id`, [tenantId, a]);
    const [designA] = await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Design') RETURNING id`, [tenantId, a]);
    const [designB] = await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'design') RETURNING id`, [tenantId, b]);
    const p1 = await seedTask(runner, tenantId, 21, 'P un', a, buildA.id);
    const p2 = await seedTask(runner, tenantId, 22, 'P deux', a, designA.id);
    const p3 = await seedTask(runner, tenantId, 23, 'P trois', a, buildA.id);
    const p4 = await seedTask(runner, tenantId, 24, 'P quatre', a, buildA.id);
    const blankCell = [
      'id;title;related_object_type;related_object_id;related_object_name;phase_name',
      `${p1};P un;project;${b};;`,
      `${p2};P deux;project;${b};;`,
      `${p3};P trois;project;;Projet B;`,
      `${p4};P quatre;project;${a};;`,
    ].join('\n');
    const check = await importCsv(runner.manager, tenantId, blankCell, {});
    assert.deepEqual(codes(check), []);
    assert.deepEqual(warned(check), [
      [2, 'phase_name', 'CSV_REFERENCE_NOT_FOUND_CLEARED'],
      [4, 'phase_name', 'CSV_REFERENCE_NOT_FOUND_CLEARED'],
    ]);
    assert.deepEqual(check.warnings.map((w) => w.params?.value), ['Build', 'Build']);
    const load = await importCsv(runner.manager, tenantId, blankCell, { dryRun: false });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const phases = async () => (await runner.query(
      `SELECT item_number, related_object_id, phase_id FROM tasks WHERE tenant_id = $1 ORDER BY item_number`, [tenantId],
    )).map((r: any) => [r.item_number, r.related_object_id, r.phase_id]);
    assert.deepEqual(await phases(), [[21, b, null], [22, b, designB.id], [23, b, null], [24, a, buildA.id]]);

    // The phase column left out: same rule.
    await runner.query(`UPDATE tasks SET related_object_id = $2, phase_id = $3 WHERE id = $1`, [p1, a, buildA.id]);
    const leftOut = ['id;title;related_object_type;related_object_id', `${p1};P un;project;${b}`].join('\n');
    const check2 = await importCsv(runner.manager, tenantId, leftOut, {});
    assert.deepEqual(warned(check2), [[2, 'phase_name', 'CSV_REFERENCE_NOT_FOUND_CLEARED']]);
    const load2 = await importCsv(runner.manager, tenantId, leftOut, { dryRun: false });
    assert.equal(load2.ok, true, JSON.stringify(load2.errors));
    assert.deepEqual((await phases())[0], [21, b, null]);

    // Moved out of a project, to an incident, without a phase cell: the phase is cleared and said, as on the screen.
    const [incident] = await runner.query(`INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 7, 'Panne', 'major') RETURNING id`, [tenantId]);
    const out = [
      'id;title;related_object_type;related_object_id;related_object_name;phase_name',
      `${p4};P quatre;incident;${incident.id};;`,
    ].join('\n');
    const check3 = await importCsv(runner.manager, tenantId, out, {});
    assert.deepEqual(codes(check3), []);
    assert.deepEqual(warned(check3), [[2, 'phase_name', 'CSV_REFERENCE_NOT_FOUND_CLEARED']]);
    assert.deepEqual(check3.warnings.map((w) => w.params?.value), ['Build']);
    const load3 = await importCsv(runner.manager, tenantId, out, { dryRun: false });
    assert.equal(load3.ok, true, JSON.stringify(load3.errors));
    assert.deepEqual((await phases())[3], [24, incident.id, null]);
  });
}

// Point 3: a restricted incident (confidential) is neither found nor named, by its cell or by Kad's
// proposal, for a person who is neither incidents:admin, its reporter nor its owner. Its reporter and
// an administrator find it; a public incident is found by everyone.
async function testRestrictedIncident() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-c-incident');
    const reporter = await seedUser(runner, tenantId, `rep-${tenantId.slice(0, 8)}@example.test`);
    const reader = await seedUser(runner, tenantId, `read-${tenantId.slice(0, 8)}@example.test`);
    const [fuite] = await runner.query(
      `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, reporter_user_id) VALUES ($1, 4, 'Fuite', 'major', true, $2) RETURNING id`,
      [tenantId, reporter],
    );
    const [panne] = await runner.query(`INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 5, 'Panne', 'major') RETURNING id`, [tenantId]);
    const itReader: CsvCallerAccess = { isAdmin: false, permissions: { tasks: 'admin', incidents: 'reader' } };
    const csv = ['title;related_object_type;related_object_name', 'Analyse;incident;INC-4', 'Suivi;incident;INC-5'].join('\n');

    const hidden = await importCsv(runner.manager, tenantId, csv, {}, itReader, { userId: reader, isAdmin: false });
    assert.deepEqual(codes(hidden), [[2, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND']]);
    for (const viewer of [{ userId: reporter, isAdmin: false }, { userId: reader, isAdmin: true }]) {
      const seen = await importCsv(runner.manager, tenantId, csv, {}, itReader, viewer);
      assert.deepEqual(codes(seen), [], JSON.stringify(viewer));
    }

    // Kad's proposal of the hidden incident is refused, with the row; of the public one, taken.
    const kad = ['title;related_object_type;related_object_name', 'Analyse;incident;la fuite', 'Suivi;incident;la panne'].join('\n');
    const proposals = { related_object_name: { 'la fuite': 'INC-4', 'la panne': 'INC-5' } };
    const proposed = await importCsv(runner.manager, tenantId, kad, { proposals }, itReader, { userId: reader, isAdmin: false });
    assert.deepEqual(codes(proposed), [[2, 'related_object_name', 'CSV_REFERENCE_NOT_FOUND']]);
    assert.deepEqual(proposed.refusedProposals?.map((r) => [r.value, r.target]), [['la fuite', 'INC-4']]);
    assert.deepEqual((proposed.matches ?? []).map((m) => [m.value, m.target]), [['la panne', 'INC-5']]);
    const byReporter = await importCsv(runner.manager, tenantId, kad, { proposals }, itReader, { userId: reporter, isAdmin: false });
    assert.deepEqual(codes(byReporter), []);

    // By its id: the hidden incident is not found, as an id that names no incident; the public one is.
    const byId = [
      'title;related_object_type;related_object_id',
      `Analyse;incident;${fuite.id}`,
      `Suivi;incident;${panne.id}`,
      'Relance;incident;00000000-0000-4000-8000-000000000000',
      'Note;incident;INC-5',
    ].join('\n');
    const hiddenId = await importCsv(runner.manager, tenantId, byId, {}, itReader, { userId: reader, isAdmin: false });
    assert.deepEqual(codes(hiddenId), [
      [2, 'related_object_id', 'CSV_REFERENCE_NOT_FOUND'],
      [4, 'related_object_id', 'CSV_REFERENCE_NOT_FOUND'],
      [5, 'related_object_id', 'CSV_REFERENCE_NOT_FOUND'],
    ]);
    assert.deepEqual(hiddenId.errors.map((e) => e.params?.value), [fuite.id, '00000000-0000-4000-8000-000000000000', 'INC-5']);
    for (const viewer of [{ userId: reporter, isAdmin: false }, { userId: reader, isAdmin: true }]) {
      const seen = await importCsv(runner.manager, tenantId, byId, {}, itReader, viewer);
      assert.deepEqual(codes(seen).map(([row]) => row), [4, 5], JSON.stringify(viewer));
    }
  });
}

// Point 1 of fixes E: accents aside, two records of the same name are two, for a task's related object
// (named by their references) and its phase; exactly, the first one read is still taken.
async function testSameNameAccentsAside() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-e-names');
    const first = await seedProject(runner, tenantId, 'Projet Été', 1);
    const second = await seedProject(runner, tenantId, 'Projet Été', 2);
    const solo = await seedProject(runner, tenantId, 'Projet Solo', 3);
    await runner.query(
      `INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Récette'), ($1, $2, 'Récette')`,
      [tenantId, solo],
    );
    const csv = [
      'title;related_object_type;related_object_name;phase_name',
      'Ambigu;project;Projet Ete;',
      'Exact;project;Projet Été;',
      'Phase;project;Projet Solo;Recette',
    ].join('\n');
    const check = await importCsv(runner.manager, tenantId, csv, {});
    assert.deepEqual(codes(check), [
      [2, 'related_object_name', 'CSV_NAME_AMBIGUOUS_AMONG'],
      [4, 'phase_name', 'CSV_NAME_AMBIGUOUS_AMONG'],
    ]);
    assert.deepEqual(check.errors.map((e) => e.params?.names), ['PRJ-1, PRJ-2', 'Récette, Récette']);
    const exact = await importCsv(runner.manager, tenantId, csv.split('\n').filter((_, i) => i === 0 || i === 2).join('\n'), { dryRun: false });
    assert.equal(exact.ok, true, JSON.stringify(exact.errors));
    const [task] = await runner.query(`SELECT related_object_id FROM tasks WHERE tenant_id = $1`, [tenantId]);
    assert.ok([first, second].includes(task.related_object_id), 'exactly: the first project read, as before');
  });
}

// Fixes F: a task outside a project, as on the task screen. Moved out of a project without the cells,
// its phase is cleared and said, and its source, category, stream and company too when it moves to an
// incident (to none, it keeps them). A phase or a classification the file gives a task that cannot have
// it is not imported and said on its cell; the row is not refused. In both modes, at the check as at the load.
async function testTaskOutsideAProject() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-fix-f-outside');
    const a = await seedProject(runner, tenantId, 'Projet A', 1);
    const [build] = await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Build') RETURNING id`, [tenantId, a]);
    const [source] = await runner.query(`INSERT INTO portfolio_sources (tenant_id, name) VALUES ($1, 'Audit') RETURNING id`, [tenantId]);
    const [category] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Infra') RETURNING id`, [tenantId]);
    const [stream] = await runner.query(`INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Réseau') RETURNING id`, [tenantId, category.id]);
    const [company] = await runner.query(
      `INSERT INTO companies (tenant_id, name, city, country_iso, item_number) VALUES ($1, 'Fromage SA', 'Lyon', 'FR', 1) RETURNING id`, [tenantId],
    );
    const [incident] = await runner.query(`INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 7, 'Panne', 'major') RETURNING id`, [tenantId]);
    const classified = async (itemNumber: number, title: string) => (await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, phase_id,
                          source_id, category_id, stream_id, company_id, viewer_ids, owner_ids)
       VALUES ($1, $2, $3, 'open', 'project', $4, $5, $6, $7, $8, $9, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
      [tenantId, itemNumber, title, a, build.id, source.id, category.id, stream.id, company.id],
    ))[0].id;
    const fields = async (id: string) => {
      const [row] = await runner.query(`SELECT phase_id, source_id, category_id, stream_id, company_id FROM tasks WHERE id = $1`, [id]);
      return [row.phase_id, row.source_id, row.category_id, row.stream_id, row.company_id];
    };
    const CLASSIFICATION = ['source_name', 'category_name', 'stream_name', 'company_name'];

    // Moved to an incident in merge mode, the cells blank: everything is cleared and said, by its name.
    const q1 = await classified(31, 'Q un');
    const toIncident = [
      'id;title;related_object_type;related_object_id;related_object_name;phase_name;source_name;category_name;stream_name;company_name',
      `${q1};Q un;incident;${incident.id};;;;;;`,
    ].join('\n');
    const check = await importCsv(runner.manager, tenantId, toIncident, {});
    assert.deepEqual(codes(check), []);
    assert.deepEqual(warned(check), ['phase_name', ...CLASSIFICATION].map((column) => [2, column, 'CSV_REFERENCE_NOT_FOUND_CLEARED']));
    assert.deepEqual(check.warnings.map((w) => w.params?.value), ['Build', 'Audit', 'Infra', 'Réseau', 'Fromage SA']);
    const load = await importCsv(runner.manager, tenantId, toIncident, { dryRun: false });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual(await fields(q1), [null, null, null, null, null]);

    // Moved out of its project to none (full replace, the columns left out): the phase only.
    const q2 = await classified(32, 'Q deux');
    const toNone = ['id;title;related_object_type;related_object_id;related_object_name', `${q2};Q deux;;;`].join('\n');
    const check2 = await importCsv(runner.manager, tenantId, toNone, { mode: 'replace' });
    assert.deepEqual(codes(check2), []);
    assert.deepEqual(warned(check2), [[2, 'phase_name', 'CSV_REFERENCE_NOT_FOUND_CLEARED']]);
    const load2 = await importCsv(runner.manager, tenantId, toNone, { mode: 'replace', dryRun: false });
    assert.equal(load2.ok, true, JSON.stringify(load2.errors));
    assert.deepEqual(await fields(q2), [null, source.id, category.id, stream.id, company.id]);

    // The file gives what the task cannot have: not imported, said on its cell, the row kept. A new
    // incident task, a new standalone task (its classification is imported), an incident task updated
    // (a name nothing finds included), and a task moved to an incident with its cells filled.
    const q3 = await classified(33, 'Q trois');
    const given = [
      'id;title;related_object_type;related_object_id;related_object_name;phase_name;source_name;category_name;stream_name;company_name',
      `;Nouvelle;incident;;INC-7;Build;Audit;Infra;Réseau;Fromage SA`,
      `;Seule;;;;Build;Audit;Infra;Réseau;Fromage SA`,
      `${q1};Q un;incident;${incident.id};;Inconnue;;Inconnue;;`,
      `${q3};Q trois;incident;${incident.id};;Build;Audit;Infra;Réseau;Fromage SA`,
    ].join('\n');
    for (const mode of ['enrich', 'replace'] as const) {
      const check3 = await importCsv(runner.manager, tenantId, given, { mode });
      assert.deepEqual(codes(check3), [], mode);
      assert.deepEqual(warned(check3), [
        [2, 'phase_name', 'CSV_TASK_PHASE_OUTSIDE_PROJECT'],
        ...CLASSIFICATION.map((column) => [2, column, 'CSV_TASK_CLASSIFICATION_NOT_ALLOWED']),
        [3, 'phase_name', 'CSV_TASK_PHASE_OUTSIDE_PROJECT'],
        [4, 'phase_name', 'CSV_TASK_PHASE_OUTSIDE_PROJECT'],
        [4, 'category_name', 'CSV_TASK_CLASSIFICATION_NOT_ALLOWED'],
        [5, 'phase_name', 'CSV_TASK_PHASE_OUTSIDE_PROJECT'],
        ...CLASSIFICATION.map((column) => [5, column, 'CSV_TASK_CLASSIFICATION_NOT_ALLOWED']),
      ], mode);
      assert.deepEqual([check3.inserted, check3.updated, check3.unchanged], [2, 1, 1], mode);
    }
    const load3 = await importCsv(runner.manager, tenantId, given, { dryRun: false });
    assert.equal(load3.ok, true, JSON.stringify(load3.errors));
    const created = async (title: string) => fields((await runner.query(`SELECT id FROM tasks WHERE tenant_id = $1 AND title = $2`, [tenantId, title]))[0].id);
    assert.deepEqual(await created('Nouvelle'), [null, null, null, null, null]);
    assert.deepEqual(await created('Seule'), [null, source.id, category.id, stream.id, company.id]);
    assert.deepEqual(await fields(q1), [null, null, null, null, null]);
    assert.deepEqual(await fields(q3), [null, null, null, null, null]);
  });
}

void runSpecs('task-csv-object-by-name.integration.spec', [
  ['testTaskOutsideAProject', testTaskOutsideAProject],
  ['testExistingTaskObjectByName', testExistingTaskObjectByName],
  ['testPhaseOfAMovedTask', testPhaseOfAMovedTask],
  ['testRestrictedIncident', testRestrictedIncident],
  ['testSameNameAccentsAside', testSameNameAccentsAside],
]);
