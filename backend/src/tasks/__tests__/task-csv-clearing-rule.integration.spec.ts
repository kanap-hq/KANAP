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
// as at the load; `-` is refused on the title, the status, the priority and the related object, and the
// task keeps them. An export read back changes nothing, a stored text "-" included; a list of more
// people than the file's four columns loses the others, said by the count at the check.
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
    const csv = `id;title;status;priority_level;related_object_type;related_object_id;related_object_name\n${seeded.task};-;-;-;-;-;-`;
    for (const dryRun of [true, false]) {
      const result = await importCsv(runner, tenantId, csv, { dryRun });
      assert.equal(result.ok, false);
      assert.deepEqual(
        codes(result).map(([, column, code]) => [column, code]).sort(),
        ['priority_level', 'related_object_id', 'related_object_name', 'related_object_type', 'status', 'title']
          .map((column) => [column, 'CSV_VALUE_CANNOT_BE_CLEARED']),
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
 * An export read back changes nothing: a title and a label "-" (written `'-`) are values. A task with
 * five viewers is written with four, the file's columns: read back, the fifth is removed, and the
 * check says so (one value cleared). The same happened before the clearing rule: filled cells always
 * replaced the list.
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
              ($1, 3, 'Five', 'open', '[]'::jsonb, $2::jsonb, '[]'::jsonb)`,
      [tenantId, JSON.stringify(people.slice(0, 2)), JSON.stringify(people.slice(0, 4))],
    );
    const exported = (await service.export({ manager: runner.manager, tenantId, language: 'en', preset: 'enrichment' })).content.replace(/^﻿/, '');
    assert.ok(exported.includes("'-"), exported);
    const four = await importCsv(runner, tenantId, exported.split(/\r?\n/).filter((line) => !line.includes('Five')).join('\n'));
    assert.deepEqual(codes(four), []);
    assert.deepEqual(counts(four), [true, 0, 2, 0]);

    await runner.query(`UPDATE tasks SET viewer_ids = $2::jsonb WHERE tenant_id = $1 AND title = 'Five'`, [tenantId, JSON.stringify(people)]);
    const five = (await service.export({ manager: runner.manager, tenantId, language: 'en', preset: 'enrichment' })).content.replace(/^﻿/, '');
    const check = await importCsv(runner, tenantId, five);
    assert.deepEqual(codes(check), []);
    assert.deepEqual(counts(check), [true, 1, 2, 1]);
    const load = await importCsv(runner, tenantId, five, { dryRun: false });
    assert.deepEqual(counts(load), [true, 1, 2, 1]);
    const [stored] = await runner.query(`SELECT viewer_ids FROM tasks WHERE tenant_id = $1 AND title = 'Five'`, [tenantId]);
    assert.deepEqual(stored.viewer_ids, people.slice(0, 4));
    const [dash] = await runner.query(`SELECT title, labels FROM tasks WHERE tenant_id = $1 AND item_number = 1`, [tenantId]);
    assert.deepEqual([dash.title, dash.labels], ['-', ['-']]);
  });
}

void runSpecs('task-csv-clearing-rule.integration.spec', [
  ['testDashClearsAndCounts', testDashClearsAndCounts],
  ['testDashRefused', testDashRefused],
  ['testRoundTrip', testRoundTrip],
]);
