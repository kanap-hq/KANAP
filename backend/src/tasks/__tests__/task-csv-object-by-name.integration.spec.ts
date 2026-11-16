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
    await runner.query(
      `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, reporter_user_id) VALUES ($1, 4, 'Fuite', 'major', true, $2)`,
      [tenantId, reporter],
    );
    await runner.query(`INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 5, 'Panne', 'major')`, [tenantId]);
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
  });
}

void runSpecs('task-csv-object-by-name.integration.spec', [
  ['testExistingTaskObjectByName', testExistingTaskObjectByName],
  ['testPhaseOfAMovedTask', testPhaseOfAMovedTask],
  ['testRestrictedIncident', testRestrictedIncident],
]);
