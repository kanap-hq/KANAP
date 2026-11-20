import 'dotenv/config';
import * as assert from 'node:assert/strict';
import type { QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvCallerAccess, CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { TasksCsvService } from '../tasks-csv.service';
import { seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The clearing rule of the tasks import (D21 of 26.11.9, lot I6): a blank cell keeps the stored value,
// `-` clears a phase, a classification, the assignee and the labels, each value counted at the check
// as at the load; `-` is refused on the title, the status and the priority. `-` on the related object
// makes the task standalone, as "Make standalone" on the screen (pass E). An export read back changes
// nothing, a stored text "-" and a list of more than four people included (pass E).
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

function importCsv(runner: QueryRunner, tenantId: string, csv: string, params: Partial<CsvImportParams> = {}): Promise<CsvImportResult> {
  return service.import(file(csv), { dryRun: true, operation: 'upsert', ...params }, {
    manager: runner.manager, tenantId, userId: null, isAdmin: true, access: ADMIN,
  });
}

const codes = (result: CsvImportResult) => result.errors.map((error) => [error.row, error.column, error.code]);
const counts = (result: CsvImportResult) => [result.ok, result.updated, result.unchanged, result.cleared];

async function seedClassifiedTask(runner: QueryRunner, tenantId: string) {
  const [project] = await runner.query(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Projet A', 1) RETURNING id`, [tenantId]);
  const [phase] = await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Build') RETURNING id`, [tenantId, project.id]);
  const [source] = await runner.query(`INSERT INTO portfolio_sources (tenant_id, name) VALUES ($1, 'Audit') RETURNING id`, [tenantId]);
  const [category] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Infra') RETURNING id`, [tenantId]);
  const [stream] = await runner.query(`INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Réseau') RETURNING id`, [tenantId, category.id]);
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, city, country_iso, item_number) VALUES ($1, 'Fromage SA', 'Lyon', 'FR', 1) RETURNING id`, [tenantId],
  );
  const assignee = await seedUser(runner, tenantId, `assignee-${tenantId.slice(0, 8)}@example.test`);
  const [task] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, phase_id,
                        source_id, category_id, stream_id, company_id, assignee_user_id, labels, viewer_ids, owner_ids)
     VALUES ($1, 900, 'Migrer', 'open', 'project', $2, $3, $4, $5, $6, $7, $8, '["x", "y"]'::jsonb, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
    [tenantId, project.id, phase.id, source.id, category.id, stream.id, company.id, assignee],
  );
  return { task: task.id as string, project: project.id as string, values: [phase.id, source.id, category.id, stream.id, company.id, assignee] };
}

async function storedValues(runner: QueryRunner, id: string) {
  const [row] = await runner.query(
    `SELECT title, status, priority_level, related_object_id, phase_id, source_id, category_id, stream_id, company_id, assignee_user_id, labels
       FROM tasks WHERE id = $1`,
    [id],
  );
  return row;
}

const COLUMNS = 'id;title;phase_name;source_name;category_name;stream_name;company_name;assignee_email;labels';

async function testDashClearsAndCounts() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-clear-dash');
    const seeded = await seedClassifiedTask(runner, tenantId);

    // Blank cells keep everything.
    assert.deepEqual(counts(await importCsv(runner, tenantId, `${COLUMNS}\n${seeded.task};Migrer;;;;;;;`)), [true, 0, 1, 0]);

    // `-` clears the phase, the classification, the assignee and the two labels: eight values.
    const csv = `${COLUMNS}\n${seeded.task};Migrer;-;-;-;-;-;-;-`;
    const check = await importCsv(runner, tenantId, csv);
    assert.deepEqual(codes(check), []);
    assert.deepEqual(counts(check), [true, 1, 0, 8]);
    const load = await importCsv(runner, tenantId, csv, { dryRun: false });
    assert.deepEqual(counts(load), [true, 1, 0, 8]);
    const after = await storedValues(runner, seeded.task);
    assert.deepEqual(
      [after.phase_id, after.source_id, after.category_id, after.stream_id, after.company_id, after.assignee_user_id, after.labels, after.related_object_id],
      [null, null, null, null, null, null, [], seeded.project],
    );
    // Again: nothing left to clear.
    assert.deepEqual(counts(await importCsv(runner, tenantId, csv)), [true, 0, 1, 0]);
  });
}

async function testDashRefused() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-clear-refused');
    const seeded = await seedClassifiedTask(runner, tenantId);
    const csv = `id;title;status;priority_level\n${seeded.task};-;-;-`;
    for (const dryRun of [true, false]) {
      const result = await importCsv(runner, tenantId, csv, { dryRun });
      assert.equal(result.ok, false);
      assert.deepEqual(
        codes(result).map(([, column, code]) => [column, code]).sort(),
        ['priority_level', 'status', 'title'].map((column) => [column, 'CSV_VALUE_CANNOT_BE_CLEARED']),
      );
    }
    const after = await storedValues(runner, seeded.task);
    assert.deepEqual([after.title, after.status, after.priority_level, after.related_object_id], ['Migrer', 'open', 'normal', seeded.project]);

    // On a new task, `-` on the related object reads as a blank cell: a standalone task.
    const created = await importCsv(runner, tenantId, 'title;related_object_type;related_object_id\nNouvelle;-;-', { dryRun: false });
    assert.deepEqual([created.ok, created.inserted], [true, 1], JSON.stringify(created.errors));
  });
}

/**
 * An export read back changes nothing: a title and a label "-" (written `'-`) are values, and a task with
 * five viewers is written with five columns (pass E), in CSV and in .xlsx. A template keeps four columns,
 * and a file written by hand with `owner_email_5` is read.
 */
async function testRoundTrip() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-clear-round');
    const people = [];
    for (let i = 1; i <= 5; i++) people.push(await seedUser(runner, tenantId, `p${i}-${tenantId.slice(0, 8)}@example.test`));
    await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, labels, viewer_ids, owner_ids)
       VALUES ($1, 1, '-', 'open', '["-"]'::jsonb, '[]'::jsonb, $2::jsonb),
              ($1, 2, 'Four', 'open', '[]'::jsonb, $3::jsonb, '[]'::jsonb),
              ($1, 3, 'Five', 'open', '[]'::jsonb, $4::jsonb, '[]'::jsonb)`,
      [tenantId, JSON.stringify(people.slice(0, 2)), JSON.stringify(people.slice(0, 4)), JSON.stringify(people)],
    );
    const exported = (await service.export({ manager: runner.manager, tenantId, language: 'en', preset: 'enrichment' })).content.replace(/^\uFEFF/, '');
    assert.ok(exported.includes("'-"), exported);
    const header = exported.split(/\r?\n/)[0];
    assert.ok(header.includes('viewer_email_5') && !header.includes('viewer_email_6'), header);
    assert.ok(header.includes('owner_email_4') && !header.includes('owner_email_5'), 'the owners keep four columns');
    for (const [name, content] of [
      ['tasks.csv', exported],
      ['tasks.xlsx', (await service.export({ manager: runner.manager, tenantId, language: 'fr', preset: 'enrichment', format: 'xlsx' } as any)).content],
    ] as const) {
      const read = (dryRun: boolean) => service.import(
        { buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), originalname: name } as Express.Multer.File,
        { dryRun, operation: 'upsert' },
        { manager: runner.manager, tenantId, userId: null, isAdmin: true, access: ADMIN },
      );
      for (const dryRun of [true, false]) {
        const result = await read(dryRun);
        assert.deepEqual([codes(result), result.warnings], [[], []], name);
        assert.deepEqual(counts(result), [true, 0, 3, 0], `${name}: five viewers read back change nothing`);
      }
    }
    const [stored] = await runner.query(`SELECT id, viewer_ids FROM tasks WHERE tenant_id = $1 AND title = 'Five'`, [tenantId]);
    assert.deepEqual(stored.viewer_ids, people);
    const [dash] = await runner.query(`SELECT title, labels FROM tasks WHERE tenant_id = $1 AND item_number = 1`, [tenantId]);
    assert.deepEqual([dash.title, dash.labels], ['-', ['-']]);

    const template = (await service.export({ manager: runner.manager, tenantId, language: 'en', scope: 'template' } as any)).content;
    assert.ok(template.includes('viewer_email_4') && !template.includes('viewer_email_5'), template);

    // By hand: `owner_email_5` alone is the whole list of owners.
    const p5 = `p5-${tenantId.slice(0, 8)}@example.test`;
    const hand = `id;owner_email_1;owner_email_5\n${stored.id};;${p5}`;
    const check = await importCsv(runner, tenantId, hand);
    assert.deepEqual([codes(check), check.warnings], [[], []]);
    assert.deepEqual(counts(check), [true, 1, 0, 0]);
    await importCsv(runner, tenantId, hand, { dryRun: false });
    const [owned] = await runner.query(`SELECT owner_ids FROM tasks WHERE id = $1`, [stored.id]);
    assert.deepEqual(owned.owner_ids, [people[4]]);
  });
}

/**
 * `-` on the related object makes a stored task standalone, as "Make standalone" on the screen
 * (`PATCH /tasks/:id/move`): the object and the phase go, the classification stays. Each stored value
 * removed is counted, the type and the id of the object and the phase, at the check as at the load. A
 * standalone task is left as it is. A `-` beside a filled object column is a row error.
 */
async function testDashDetaches() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-clear-detach');
    const seeded = await seedClassifiedTask(runner, tenantId);
    const [phase, source, category, stream, company, assignee] = seeded.values;
    const csv = `id;title;related_object_type;related_object_id;related_object_name\n${seeded.task};Migrer;-;-;-`;
    const check = await importCsv(runner, tenantId, csv);
    assert.deepEqual(codes(check), []);
    assert.deepEqual(counts(check), [true, 1, 0, 3]);
    assert.deepEqual(check.warnings.map((warning) => [warning.column, warning.code]), [['phase_name', 'CSV_TASK_PHASE_CLEARED_OUTSIDE_PROJECT']]);
    const load = await importCsv(runner, tenantId, csv, { dryRun: false });
    assert.deepEqual(counts(load), [true, 1, 0, 3]);
    const [after] = await runner.query(`SELECT related_object_type, related_object_id FROM tasks WHERE id = $1`, [seeded.task]);
    const values = await storedValues(runner, seeded.task);
    assert.deepEqual(
      [after.related_object_type, after.related_object_id, values.phase_id, values.source_id, values.category_id, values.stream_id, values.company_id, values.assignee_user_id],
      [null, null, null, source, category, stream, company, assignee],
    );
    // A standalone task: `-` changes nothing and counts nothing.
    assert.deepEqual(counts(await importCsv(runner, tenantId, csv)), [true, 0, 1, 0]);

    // The type column alone: the same detach, the same count.
    await runner.query(`UPDATE tasks SET related_object_type = 'project', related_object_id = $2, phase_id = $3 WHERE id = $1`, [seeded.task, seeded.project, phase]);
    const typeOnly = `id;related_object_type\n${seeded.task};-`;
    assert.deepEqual(counts(await importCsv(runner, tenantId, typeOnly)), [true, 1, 0, 3]);

    // `-` beside a filled object column: a row error naming the column, nothing written.
    const conflict = `id;related_object_type;related_object_id\n${seeded.task};-;${seeded.project}`;
    for (const dryRun of [true, false]) {
      const result = await importCsv(runner, tenantId, conflict, { dryRun });
      assert.deepEqual(codes(result), [[2, 'related_object_type', 'CSV_TASK_DETACH_CONFLICT']]);
      assert.deepEqual(result.errors[0].params, { column: 'related_object_type', other: 'related_object_id' });
    }
    const [kept] = await runner.query(`SELECT related_object_type, related_object_id, phase_id FROM tasks WHERE id = $1`, [seeded.task]);
    assert.deepEqual([kept.related_object_type, kept.related_object_id, kept.phase_id], ['project', seeded.project, phase]);
  });
}

void runSpecs('task-csv-clearing-rule.integration.spec', [
  ['testDashClearsAndCounts', testDashClearsAndCounts],
  ['testDashRefused', testDashRefused],
  ['testRoundTrip', testRoundTrip],
  ['testDashDetaches', testDashDetaches],
]);
