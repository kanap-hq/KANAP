import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { TasksCsvService } from '../tasks-csv.service';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// A task of a project shows its project's source, category, stream and company when it has none of
// its own (the task list's COALESCE). The export writes what the list shows; read back unchanged, the
// file leaves the task's own columns empty, so the task keeps following its project. A value changed
// in the file is the task's own and is written. Each test runs in a transaction rolled back.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const COLUMNS = ['source_id', 'category_id', 'stream_id', 'company_id'] as const;

const resolver = new CsvResolverService();
const service = new TasksCsvService(
  null as any,
  new CsvExportService(resolver),
  new CsvImportService(resolver, new CsvJsonValidators()),
);

function file(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8'), originalname: 'tasks.csv', mimetype: 'text/csv', size: content.length } as Express.Multer.File;
}

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'task-csv-inherit');
  const ids = { source: randomUUID(), categoryA: randomUUID(), categoryB: randomUUID(), stream: randomUUID(), company: randomUUID(), project: randomUUID(), task: randomUUID() };
  await runner.query(`INSERT INTO portfolio_sources (id, tenant_id, name) VALUES ($1, $2, 'Inherited source')`, [ids.source, tenantId]);
  await runner.query(
    `INSERT INTO portfolio_categories (id, tenant_id, name) VALUES ($1, $2, 'Inherited category'), ($3, $2, 'Own category')`,
    [ids.categoryA, tenantId, ids.categoryB],
  );
  await runner.query(
    `INSERT INTO portfolio_streams (id, tenant_id, category_id, name) VALUES ($1, $2, $3, 'Inherited stream')`,
    [ids.stream, tenantId, ids.categoryA],
  );
  await runner.query(
    `INSERT INTO companies (id, tenant_id, name, country_iso, city) VALUES ($1, $2, 'Inherited company', 'FR', 'Lyon')`,
    [ids.company, tenantId],
  );
  await runner.query(
    `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, source_id, category_id, stream_id, company_id)
     VALUES ($1, $2, 7, 'Inheriting project', 'in_progress', $3, $4, $5, $6)`,
    [ids.project, tenantId, ids.source, ids.categoryA, ids.stream, ids.company],
  );
  await runner.query(
    `INSERT INTO tasks (id, tenant_id, item_number, title, status, related_object_type, related_object_id)
     VALUES ($1, $2, 12, 'Task of the project', 'open', 'project', $3)`,
    [ids.task, tenantId, ids.project],
  );
  return { tenantId, ids };
}

async function exportCsv(runner: QueryRunner, tenantId: string): Promise<string> {
  const result = await service.export({ manager: runner.manager, tenantId, language: 'en' });
  return result.content;
}

async function importCsv(runner: QueryRunner, tenantId: string, csv: string, params: Partial<CsvImportParams>): Promise<CsvImportResult> {
  return service.import(file(csv), { dryRun: false, mode: 'enrich', operation: 'upsert', ...params }, {
    manager: runner.manager,
    tenantId,
    userId: null,
    isAdmin: true,
  });
}

async function ownColumns(runner: QueryRunner, taskId: string): Promise<Record<string, string | null>> {
  const [row] = await runner.query(`SELECT ${COLUMNS.join(', ')} FROM tasks WHERE id = $1`, [taskId]);
  return row;
}

function cellsOf(csv: string, taskId: string): Record<string, string> {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',');
  const line = lines.find((text) => text.includes(taskId));
  assert.ok(line, 'the task is exported');
  const cells = line!.split(',');
  return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
}

async function testExportShowsTheInheritedValues() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ids } = await seed(runner);
    const cells = cellsOf(await exportCsv(runner, tenantId), ids.task);
    assert.equal(cells.source_name, 'Inherited source');
    assert.equal(cells.category_name, 'Inherited category');
    assert.equal(cells.stream_name, 'Inherited stream');
    assert.equal(cells.company_name, 'Inherited company');
    assert.deepEqual(await ownColumns(runner, ids.task), { source_id: null, category_id: null, stream_id: null, company_id: null });
  });
}

async function testUnchangedExportKeepsTheTaskFollowingItsProject() {
  for (const mode of ['enrich', 'replace'] as const) {
    await inRolledBackTransaction(async (runner) => {
      const { tenantId, ids } = await seed(runner);
      const csv = await exportCsv(runner, tenantId);
      const preflight = await importCsv(runner, tenantId, csv, { mode, dryRun: true });
      assert.deepEqual(preflight.errors, [], `${mode}: preflight`);
      assert.equal(preflight.unchanged, 1, `${mode}: the exported task is unchanged`);
      assert.equal(preflight.updated, 0, `${mode}: nothing to update`);
      const result = await importCsv(runner, tenantId, csv, { mode });
      assert.equal(result.ok, true, `${mode}: ${JSON.stringify(result.errors)}`);
      assert.equal(result.unchanged, 1, `${mode}: unchanged at the load`);
      assert.deepEqual(
        await ownColumns(runner, ids.task),
        { source_id: null, category_id: null, stream_id: null, company_id: null },
        `${mode}: the task's own columns stay empty`,
      );
    });
  }
}

async function testChangedValueIsWritten() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ids } = await seed(runner);
    const csv = (await exportCsv(runner, tenantId)).replace('Inherited category', 'Own category');
    const result = await importCsv(runner, tenantId, csv, {});
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.updated, 1, 'the changed task is written');
    assert.deepEqual(
      await ownColumns(runner, ids.task),
      { source_id: null, category_id: ids.categoryB, stream_id: null, company_id: null },
      'only the changed column becomes the task\'s own',
    );
  });
}

async function main() {
  await dataSource.initialize();
  let failed = false;
  try {
    await testExportShowsTheInheritedValues();
    await testUnchangedExportKeepsTheTaskFollowingItsProject();
    await testChangedValueIsWritten();
  } catch (err) {
    failed = true;
    console.error(`task-csv-inherited-classification.integration.spec: ${(err as Error).stack ?? err}`);
  } finally {
    await dataSource.destroy();
  }
  if (failed) process.exit(1);
  console.log('task-csv-inherited-classification.integration.spec: ok');
}

void main();
