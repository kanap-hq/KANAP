// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import type { CsvImportParams, CsvImportResult } from '../../common/csv';
import { portfolioProjectCsvConfig } from '../portfolio-project-csv.config';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// A project import gives the origin Request (`standard`) only to a project that already has it.
// A new row with no origin is stored as legacy. A new row that says standard is refused.
// An existing standard project updated by the file keeps that origin.

const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());

function file(text: string): Express.Multer.File {
  const content = '﻿' + text;
  return { buffer: Buffer.from(content, 'utf8'), originalname: 'projects.csv', mimetype: 'text/csv', size: content.length } as Express.Multer.File;
}

async function run(
  runner: QueryRunner,
  tenantId: string,
  csv: string,
  params: Partial<CsvImportParams> = {},
): Promise<CsvImportResult> {
  return importer.import(
    portfolioProjectCsvConfig,
    file(csv),
    { dryRun: false, mode: 'replace', operation: 'upsert', ...params },
    { manager: runner.manager, tenantId, userId: null, isAdmin: true },
  );
}

async function project(runner: QueryRunner, tenantId: string, name: string): Promise<{ origin: string; status: string } | undefined> {
  const [row] = await runner.query(
    `SELECT origin, status FROM portfolio_projects WHERE tenant_id = $1 AND name = $2`,
    [tenantId, name],
  );
  return row;
}

async function testNewRowWithoutOriginIsLegacy() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'prj-origin-missing');
    const csv = 'name;status\nCellar sensors;planned';
    const preflight = await run(runner, tenantId, csv, { dryRun: true });
    assert.equal(preflight.ok, true, JSON.stringify(preflight.errors));
    assert.equal(preflight.inserted, 1);
    const loaded = await run(runner, tenantId, csv);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.deepEqual(await project(runner, tenantId, 'Cellar sensors'), { origin: 'legacy', status: 'planned' });

    const blank = await run(runner, tenantId, 'name;status;origin\nBlank origin;in_progress;');
    assert.equal(blank.ok, true, JSON.stringify(blank.errors));
    assert.equal((await project(runner, tenantId, 'Blank origin'))?.origin, 'legacy');

    const named = await run(runner, tenantId, 'name;status;origin\nShop tills;planned;fast_track');
    assert.equal(named.ok, true, JSON.stringify(named.errors));
    assert.equal((await project(runner, tenantId, 'Shop tills'))?.origin, 'fast_track');
  });
}

async function testNewStandardOriginIsRefused() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'prj-origin-standard');
    const csv = 'name;status;origin\nDirect request;planned;standard';
    const preflight = await run(runner, tenantId, csv, { dryRun: true });
    assert.equal(preflight.ok, false);
    assert.deepEqual(preflight.errors.map((error) => [error.row, error.column, error.code]), [
      [2, 'origin', 'CSV_PROJECT_ORIGIN_STANDARD'],
    ]);
    const loaded = await run(runner, tenantId, csv);
    assert.deepEqual(loaded.errors.map((error) => error.code), ['CSV_PROJECT_ORIGIN_STANDARD']);
    assert.equal(await project(runner, tenantId, 'Direct request'), undefined);
  });
}

async function testExistingStandardProjectKeepsItsOrigin() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'prj-origin-kept');
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress)
       VALUES ($1, $2, 100, 'Kept by omission', 'in_progress', 'standard', 0),
              ($3, $2, 101, 'Kept when repeated', 'in_progress', 'standard', 0),
              ($4, $2, 102, 'Stays legacy', 'planned', 'legacy', 0)`,
      [randomUUID(), tenantId, randomUUID(), randomUUID()],
    );

    const omitted = await run(runner, tenantId, 'name;status\nKept by omission;done');
    assert.equal(omitted.ok, true, JSON.stringify(omitted.errors));
    assert.equal(omitted.updated, 1);
    assert.deepEqual(await project(runner, tenantId, 'Kept by omission'), { origin: 'standard', status: 'done' });

    const repeated = await run(runner, tenantId, 'name;status;origin\nKept when repeated;planned;standard');
    assert.equal(repeated.ok, true, JSON.stringify(repeated.errors));
    assert.deepEqual(await project(runner, tenantId, 'Kept when repeated'), { origin: 'standard', status: 'planned' });

    const stripped = await run(runner, tenantId, 'name;status;origin\nKept when repeated;on_hold;legacy');
    assert.deepEqual(stripped.errors.map((error) => error.code), ['CSV_PROJECT_ORIGIN_LOCKED']);
    assert.deepEqual(await project(runner, tenantId, 'Kept when repeated'), { origin: 'standard', status: 'planned' });

    const assigned = await run(runner, tenantId, 'name;status;origin\nStays legacy;in_progress;standard');
    assert.deepEqual(assigned.errors.map((error) => error.code), ['CSV_PROJECT_ORIGIN_LOCKED']);
    assert.deepEqual(await project(runner, tenantId, 'Stays legacy'), { origin: 'legacy', status: 'planned' });
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testNewRowWithoutOriginIsLegacy();
    console.log('  ok testNewRowWithoutOriginIsLegacy');
    await testNewStandardOriginIsRefused();
    console.log('  ok testNewStandardOriginIsRefused');
    await testExistingStandardProjectKeepsItsOrigin();
    console.log('  ok testExistingStandardProjectKeepsItsOrigin');
  } finally {
    await dataSource.destroy();
  }
  console.log('project-origin-import.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
