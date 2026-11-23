import 'dotenv/config';
import * as assert from 'node:assert/strict';
import type { QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvCallerAccess, CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { TasksCsvService } from '../tasks-csv.service';
import { inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Issue 1755. A new task row that gives a related_object_type and neither an id nor a name is
// refused on its own row at the check. A second, valid standalone row of the same file stays ok.
// The load then refuses the file as any file with a refused row does, and creates nothing.
// An existing task whose id and name cells are blank keeps its stored object and stays valid.
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

const HEADER = 'id;title;related_object_type;related_object_id;related_object_name';

async function testTypeWithoutObject() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-type-without-object');
    const [project] = await runner.query(
      `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Projet Alpha', 1) RETURNING id`,
      [tenantId],
    );
    const [stored] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, viewer_ids, owner_ids)
       VALUES ($1, 4, 'Deja la', 'open', 'project', $2, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
      [tenantId, project.id],
    );
    const mixed = [
      HEADER,
      ';Nouvelle;project;;',
      ';Seule;;;',
      `${stored.id};Deja la;project;;`,
    ].join('\n');

    const check = await importCsv(runner, tenantId, mixed);
    assert.equal(check.ok, false);
    assert.deepEqual(codes(check), [[2, 'related_object_type', 'CSV_TASK_OBJECT_REQUIRED']]);
    assert.equal(check.errors[0].message, 'Give related_object_id or related_object_name to link the task.');
    assert.deepEqual([check.inserted, check.unchanged, check.skipped], [1, 1, 1]);

    const load = await importCsv(runner, tenantId, mixed, { dryRun: false });
    assert.equal(load.ok, false);
    assert.equal(load.dryRun, false);
    assert.deepEqual(codes(load), [[2, 'related_object_type', 'CSV_TASK_OBJECT_REQUIRED']]);
    const afterRefusal = await runner.query(
      `SELECT title FROM tasks WHERE tenant_id = $1 ORDER BY title`,
      [tenantId],
    );
    assert.deepEqual(afterRefusal.map((row: { title: string }) => row.title), ['Deja la']);

    const valid = [HEADER, ';Seule;;;', `${stored.id};Deja la;project;;`].join('\n');
    const loaded = await importCsv(runner, tenantId, valid, { dryRun: false });
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.deepEqual([loaded.inserted, loaded.unchanged], [1, 1]);
    const rows = await runner.query(
      `SELECT title, related_object_type, related_object_id FROM tasks WHERE tenant_id = $1 ORDER BY title`,
      [tenantId],
    );
    assert.deepEqual(
      rows.map((row: { title: string; related_object_type: string | null; related_object_id: string | null }) => [row.title, row.related_object_type, row.related_object_id]),
      [['Deja la', 'project', project.id], ['Seule', null, null]],
    );
  });
}

void runSpecs('task-csv-object-type-without-object.integration.spec', [
  ['testTypeWithoutObject', testTypeWithoutObject],
]);
