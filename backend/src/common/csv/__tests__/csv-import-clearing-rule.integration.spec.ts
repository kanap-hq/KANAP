import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { CsvImportService } from '../csv-import.service';
import { CsvExportService } from '../csv-export.service';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvJsonValidators } from '../csv-json-validators';
import { CsvEntityConfig, CsvImportParams, CsvImportResult } from '../csv-field.types';
import { applicationCsvConfig } from '../../../applications/application-csv.config';
import { assetCsvConfig } from '../../../assets/asset-csv.config';
import { taskCsvConfig } from '../../../tasks/task-csv.config';
import { portfolioRequestCsvConfig } from '../../../portfolio/portfolio-request-csv.config';
import { portfolioProjectCsvConfig } from '../../../portfolio/portfolio-project-csv.config';
import { incidentCsvConfig } from '../../../incidents/incident-csv.config';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../../it-ops-settings/classification-catalog';
import { inRolledBackTransaction, seedTenant } from '../../../spend/__tests__/round-inputs.fixtures';
import { hasLibreOffice, throughLibreOffice, workbookOfCsv } from '../../__tests__/workbook-of-csv';
import { si, workbookParts, zipOf } from '../../xlsx/__tests__/fixtures/handmade';
import type { CsvLanguage } from '../../csv-sheet/types';

// The clearing rule of every import (D21 of 26.11.9) in the shared CSV import of the six families
// (applications, assets, tasks, incidents, projects, requests), against the real tables: a blank
// cell keeps the stored value, `-` (or `__CLEAR__`) clears it, a column the file leaves out is not
// touched. `-` empties a NOT NULL list to its empty value and a nullable column to null; on a value
// that cannot be empty (a key, a required value, a status, a NOT NULL yes or no) it is a row error
// naming the column, `CSV_NUMBER_CANNOT_BE_CLEARED` for a NOT NULL number. On a new record `-` reads
// as a blank cell. The result counts the values the import clears (`cleared`), the same at the
// preflight and at the load; `-` on a value already empty changes nothing. A stored "-" is exported
// as `'-` and read back as the text "-": a full export read back changes nothing, in CSV and in
// .xlsx, in English and in French. Each test runs in a transaction rolled back.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

// A zone east of UTC, wherever the spec runs: node-postgres reads a `date` column as local
// midnight, which is the day before in UTC, and the exported day must still be the stored one.
process.env.TZ = 'Europe/Paris';

const itOpsSettings: any = {
  ...DEFAULT_CLASSIFICATION_CATALOG,
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }, { code: 'retired', label: 'Retired' }],
  domains: [{ code: 'corp', label: 'Corporate' }],
  adminZones: [{ code: 'tier_0', label: 'Tier 0' }],
  ipAddressTypes: [{ code: 'mgmt', label: 'Management' }],
  applicationCategories: [{ code: 'erp', label: 'Enterprise planning' }],
  accessMethods: [{ code: 'web', label: 'Web browser' }],
  incidentCategories: [{ code: 'outage', label: 'Service outage' }],
};

const resolver = new CsvResolverService();
const importer = new CsvImportService(resolver, new CsvJsonValidators());
const exporter = new CsvExportService(resolver);

function file(content: string | Buffer): Express.Multer.File {
  if (Buffer.isBuffer(content)) {
    return { buffer: content, originalname: 'import.xlsx', mimetype: 'application/octet-stream', size: content.length } as Express.Multer.File;
  }
  const text = '﻿' + content;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'import.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

async function run(
  runner: QueryRunner,
  tenantId: string,
  config: CsvEntityConfig,
  csv: string | Buffer,
  params: Partial<CsvImportParams> = {},
): Promise<CsvImportResult> {
  return importer.import(config, file(csv), { dryRun: false, operation: 'upsert', ...params }, {
    manager: runner.manager,
    tenantId,
    userId: null,
    isAdmin: true,
    itOpsSettings,
  });
}

async function stored(runner: QueryRunner, table: string, id: string): Promise<any> {
  const [row] = await runner.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return row;
}

/**
 * The preflight, then the load of the same file: the same errors and counts, the cleared values
 * included, and the load writes what the preflight announced.
 */
async function preflightThenLoad(
  runner: QueryRunner,
  tenantId: string,
  config: CsvEntityConfig,
  csv: string | Buffer,
  params: Partial<CsvImportParams> = {},
): Promise<CsvImportResult> {
  const preflight = await run(runner, tenantId, config, csv, { ...params, dryRun: true });
  const result = await run(runner, tenantId, config, csv, { ...params, dryRun: false });
  const counts = (r: CsvImportResult) => [r.ok, r.errors, r.inserted, r.updated, r.skipped, r.unchanged, r.cleared];
  assert.deepEqual(counts(result), counts(preflight), `${config.entityName}: the load matches its preflight`);
  return result;
}

/** The row errors of a preflight, as [column, code], sorted. */
async function refusals(runner: QueryRunner, tenantId: string, config: CsvEntityConfig, csv: string): Promise<string[][]> {
  const result = await run(runner, tenantId, config, csv, { dryRun: true });
  assert.equal(result.ok, false, `${config.entityName}: ${csv} is refused`);
  return result.errors.map((e) => [e.column ?? '', e.code ?? '']).sort();
}

/**
 * Every column the import reads, as the export writes them, with the business reference (`reference`,
 * export only): the import leaves it out.
 */
function exportedFields(config: CsvEntityConfig): string[] {
  return [...new Set(config.fields
    .filter((f) => (f.importable !== false || f.csvColumn === 'reference') && f.exportable !== false)
    .map((f) => f.csvColumn))];
}

/** The list's own .xlsx export of the row: the same columns, numbers and days as typed cells. */
async function fullExportXlsx(runner: QueryRunner, tenantId: string, config: CsvEntityConfig, id: string, language: CsvLanguage = 'en'): Promise<Buffer> {
  const rows = await runner.query(`SELECT * FROM ${config.tableName} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  const result = await exporter.export(config, rows, { manager: runner.manager, tenantId, fields: exportedFields(config), language, format: 'xlsx' });
  return result.content;
}

async function fullExport(runner: QueryRunner, tenantId: string, config: CsvEntityConfig, id: string, language: CsvLanguage = 'en'): Promise<string> {
  const rows = await runner.query(`SELECT * FROM ${config.tableName} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  const fields = exportedFields(config);
  const result = await exporter.export(config, rows, { manager: runner.manager, tenantId, fields, language });
  const content = result.content.replace(/^﻿/, '');
  if (fields.includes('reference')) {
    const [header, line] = content.split('\n');
    const separator = language === 'en' ? ',' : ';';
    const reference = config.headerLabels?.reference?.[language] ?? 'reference';
    assert.equal(header.split(separator)[1], reference, `${config.entityName}: the reference follows id`);
    assert.match(line.split(separator)[1], /^[A-Z]+-\d+$/, `${config.entityName}: the reference is exported`);
  }
  return content;
}

/**
 * The exported file read back: no error, the row counted as unchanged, nothing cleared. In English
 * and in French: the French file writes yes and no as `oui` and `non`, and days day first. Each
 * seeded row holds a stored "-" in a text column, which the export guards as `'-`.
 */
async function assertRoundTrip(runner: QueryRunner, tenantId: string, config: CsvEntityConfig, id: string) {
  for (const language of ['en', 'fr'] as const) await assertRoundTripIn(runner, tenantId, config, id, language);
}

async function assertRoundTripIn(runner: QueryRunner, tenantId: string, config: CsvEntityConfig, id: string, language: CsvLanguage) {
  const csv = await fullExport(runner, tenantId, config, id, language);
  assert.match(csv, /'-/, `${config.entityName} (${language}): the stored "-" is exported guarded`);
  const before = await stored(runner, config.tableName, id);
  const preflight = await run(runner, tenantId, config, csv, { dryRun: true });
  assert.deepEqual(preflight.errors, [], `${config.entityName} (${language}): preflight of the full export`);
  assert.equal(preflight.unchanged, 1, `${config.entityName} (${language}): the exported row is unchanged`);
  assert.equal(preflight.cleared, 0, `${config.entityName} (${language}): nothing is cleared`);
  const result = await run(runner, tenantId, config, csv);
  assert.equal(result.ok, true, `${config.entityName} (${language}): import of the full export ${JSON.stringify(result.errors)}`);
  assert.deepEqual(await stored(runner, config.tableName, id), before, `${config.entityName} (${language}): nothing changed`);

  // The same row in .xlsx: the list's own workbook, the workbook of its CSV export, and for the
  // applications the LibreOffice copy of the list's workbook. Each checks and loads as the CSV did.
  const own = await fullExportXlsx(runner, tenantId, config, id, language);
  const workbooks: Array<[string, Buffer]> = [['xlsx export', own], ['workbook of the CSV export', workbookOfCsv(csv, language)]];
  if (config.entityName === applicationCsvConfig.entityName && hasLibreOffice()) workbooks.push(['LibreOffice copy', throughLibreOffice(own)]);
  const outcome = (r: CsvImportResult) => [r.ok, r.errors, r.warnings, r.inserted, r.updated, r.skipped, r.unchanged, r.cleared];
  for (const [label, workbook] of workbooks) {
    const xlsxPreflight = await run(runner, tenantId, config, workbook, { dryRun: true });
    assert.deepEqual(outcome(xlsxPreflight), outcome(preflight), `${config.entityName} (${language}): preflight of the ${label}`);
    const xlsxResult = await run(runner, tenantId, config, workbook);
    assert.deepEqual(outcome(xlsxResult), outcome(result), `${config.entityName} (${language}): load of the ${label}`);
    assert.deepEqual(await stored(runner, config.tableName, id), before, `${config.entityName} (${language}): the ${label} changed nothing`);
  }
}

/** A one-sheet workbook of text cells; a cell `'-` is "-" with the apostrophe in its style, as Excel writes it. */
function excelWorkbook(rows: string[][]): Buffer {
  const strings: string[] = [];
  const index = (text: string) => (strings.includes(text) ? strings.indexOf(text) : strings.push(text) - 1);
  const sheetData = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((cell, c) => {
    const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
    const quoted = cell === "'-";
    return `<c r="${ref}" t="s"${quoted ? ' s="1"' : ''}><v>${index(quoted ? '-' : cell)}</v></c>`;
  }).join('')}</row>`).join('');
  const parts = workbookParts({ sharedStrings: strings.map(si), cellXfs: [0, 0], sheetData });
  parts['xl/styles.xml'] = String(parts['xl/styles.xml']).replace(/(<cellXfs><xf [^>]*)\/>(<xf [^>]*)\/>/, '$1/>$2 quotePrefix="1"/>');
  return zipOf(parts);
}

async function seedApplication(runner: QueryRunner, tenantId: string, values: { name: string; description: string; access_methods: string[] }) {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO applications (id, tenant_id, name, description, category, lifecycle, access_methods, external_facing, notes, contains_pii, last_dr_test)
     VALUES ($1, $2, $3, $4, 'erp', 'active', $5, true, 'Kept notes', true, '2026-03-12')`,
    [id, tenantId, values.name, values.description, values.access_methods],
  );
  return id;
}

async function testApplications() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-clear-apps');
    const ledger = await seedApplication(runner, tenantId, { name: 'Ledger', description: 'Books', access_methods: ['web'] });
    const dash = await seedApplication(runner, tenantId, { name: 'Dash', description: '-', access_methods: [] });

    // A full export read back changes nothing, a stored "-" and an empty NOT NULL list included.
    await assertRoundTrip(runner, tenantId, applicationCsvConfig, dash);

    // `-` clears an optional value and a NOT NULL list (to its empty value); a blank cell keeps.
    let result = await preflightThenLoad(runner, tenantId, applicationCsvConfig, 'name;description;notes;access_methods\nLedger;-;;-');
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 2], JSON.stringify(result.errors));
    let after = await stored(runner, 'applications', ledger);
    assert.deepEqual([after.description, after.notes, after.access_methods, after.category], [null, 'Kept notes', [], 'erp']);

    // `__CLEAR__`, the mark of older files, reads as `-`.
    result = await preflightThenLoad(runner, tenantId, applicationCsvConfig, 'name;notes\nLedger;__CLEAR__');
    assert.deepEqual([result.ok, result.cleared], [true, 1], JSON.stringify(result.errors));
    assert.equal((await stored(runner, 'applications', ledger)).notes, null);

    // `-` on values already empty changes nothing and counts nothing.
    result = await preflightThenLoad(runner, tenantId, applicationCsvConfig, 'name;description;notes;access_methods\nLedger;-;-;-');
    assert.deepEqual([result.ok, result.updated, result.unchanged, result.cleared], [true, 0, 1, 0], JSON.stringify(result.errors));

    // `'-` is the text "-", in a CSV file and in an Excel cell; another guarded value keeps its
    // guard undone, as before.
    result = await preflightThenLoad(runner, tenantId, applicationCsvConfig, "name;description;notes\nLedger;'-;'=1+1");
    assert.deepEqual([result.ok, result.cleared], [true, 0], JSON.stringify(result.errors));
    after = await stored(runner, 'applications', ledger);
    assert.deepEqual([after.description, after.notes], ['-', '=1+1']);
    result = await preflightThenLoad(runner, tenantId, applicationCsvConfig, excelWorkbook([['name', 'description', 'notes'], ['Ledger', '-', "'-"]]));
    assert.deepEqual([result.ok, result.cleared], [true, 1], JSON.stringify(result.errors));
    after = await stored(runner, 'applications', ledger);
    assert.deepEqual([after.description, after.notes], [null, '-']);

    // `-` on a value that cannot be empty: a row error naming the column, nothing written.
    const before = await stored(runner, 'applications', ledger);
    // (The applications' own check of the lifecycle reads the cell too: passes A and B of lot I6.)
    const refused = await refusals(runner, tenantId, applicationCsvConfig, 'name;lifecycle;external_facing;notes\nLedger;-;-;Changed');
    assert.ok(refused.some(([column, code]) => column === 'lifecycle' && code === 'CSV_VALUE_CANNOT_BE_CLEARED'), JSON.stringify(refused));
    assert.ok(refused.some(([column, code]) => column === 'external_facing' && code === 'CSV_VALUE_CANNOT_BE_CLEARED'), JSON.stringify(refused));
    assert.deepEqual(await refusals(runner, tenantId, applicationCsvConfig, 'name;notes\n-;Changed'), [['name', 'CSV_VALUE_CANNOT_BE_CLEARED']]);
    result = await run(runner, tenantId, applicationCsvConfig, 'name;lifecycle;notes\nLedger;-;Changed');
    assert.equal(result.ok, false);
    assert.deepEqual(await stored(runner, 'applications', ledger), before, 'a refused file writes nothing');

    // On a new record, `-` reads as a blank cell: the column's default, nothing counted.
    result = await preflightThenLoad(runner, tenantId, applicationCsvConfig, 'name;description;external_facing;access_methods\nNew app;-;-;-');
    assert.deepEqual([result.ok, result.inserted, result.cleared], [true, 1, 0], JSON.stringify(result.errors));
    const [created] = await runner.query(`SELECT description, external_facing, access_methods FROM applications WHERE tenant_id = $1 AND name = 'New app'`, [tenantId]);
    assert.deepEqual([created.description, created.external_facing, created.access_methods], [null, false, []]);

    // A blank cell keeps, a column left out is not touched.
    await runner.query(`UPDATE applications SET notes = 'Back', access_methods = ARRAY['web'] WHERE id = $1`, [ledger]);
    result = await preflightThenLoad(runner, tenantId, applicationCsvConfig, 'name;notes;access_methods;description\nLedger;;;Books');
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 0], JSON.stringify(result.errors));
    after = await stored(runner, 'applications', ledger);
    assert.deepEqual([after.notes, after.access_methods, after.description, after.lifecycle], ['Back', ['web'], 'Books', 'active']);
  });
}

async function testAssets() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-clear-assets');
    const locationId = randomUUID();
    await runner.query(
      `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
      [locationId, tenantId],
    );
    const id = randomUUID();
    await runner.query(
      `INSERT INTO assets (id, tenant_id, name, kind, environment, status, location_id, provider, hostname, notes, aliases, ip_addresses)
       VALUES ($1, $2, 'srv-01', 'vm', 'prod', 'active', $3, 'on_prem', 'srv-01.corp', '-', ARRAY['web'], $4::jsonb)`,
      [id, tenantId, locationId, JSON.stringify([
        { type: 'mgmt', ip: '10.0.0.1', subnet_cidr: '10.0.0.0/24' },
        { type: 'mgmt', ip: '10.0.1.1', subnet_cidr: '10.0.1.0/24' },
      ])],
    );

    await assertRoundTrip(runner, tenantId, assetCsvConfig, id);

    // `-` clears a value and one IP sub-value; blank cells, sub-columns included, keep.
    const head = 'name;location_reference;kind;environment';
    let result = await preflightThenLoad(runner, tenantId, assetCsvConfig, `${head};notes;hostname;aliases;ip_1_type;ip_1_address;ip_2_subnet_cidr\nsrv-01;LOC-1;vm;prod;-;;;;;-`);
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 2], JSON.stringify(result.errors));
    let after = await stored(runner, 'assets', id);
    assert.deepEqual([after.notes, after.hostname, after.aliases], [null, 'srv-01.corp', ['web']]);
    assert.deepEqual(after.ip_addresses, [
      { type: 'mgmt', ip: '10.0.0.1', subnet_cidr: '10.0.0.0/24' },
      { type: 'mgmt', ip: '10.0.1.1', subnet_cidr: null },
    ]);

    // (`-` on an IP type or address meets the assets' own check of those cells: pass B of lot I6.)

    // Only the column that finds the record is required (T-I6i): no kind, environment or location.
    result = await preflightThenLoad(runner, tenantId, assetCsvConfig, 'name;hostname\nsrv-01;srv-01.lan');
    assert.deepEqual([result.ok, result.updated], [true, 1], JSON.stringify(result.errors));
    after = await stored(runner, 'assets', id);
    assert.deepEqual([after.hostname, after.kind, after.environment, after.location_id], ['srv-01.lan', 'vm', 'prod', locationId]);

    // `-` on a status or a NOT NULL yes or no is refused.
    // (The assets' own check of the status reads the cell too: pass B of lot I6.)
    const refused = await refusals(runner, tenantId, assetCsvConfig, `${head};status;is_cluster\nsrv-01;LOC-1;vm;prod;-;-`);
    for (const column of ['status', 'is_cluster']) {
      assert.ok(refused.some(([named, code]) => named === column && code === 'CSV_VALUE_CANNOT_BE_CLEARED'), JSON.stringify(refused));
    }
  });
}

async function testTasks() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-clear-tasks');
    const id = randomUUID();
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, item_number, title, description, status, priority_level, labels)
       VALUES ($1, $2, 1, 'Migrate', '-', 'in_progress', 'high', '["infra"]'::jsonb)`,
      [id, tenantId],
    );

    await assertRoundTrip(runner, tenantId, taskCsvConfig, id);

    // `-` empties a NOT NULL JSON list to [] and clears the description; a blank cell keeps.
    let result = await preflightThenLoad(runner, tenantId, taskCsvConfig, `id;title;description;labels;priority_level\n${id};Migrate;-;-;`);
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 2], JSON.stringify(result.errors));
    const after = await stored(runner, 'tasks', id);
    assert.deepEqual([after.description, after.labels, after.priority_level, after.status], [null, [], 'high', 'in_progress']);

    assert.deepEqual(await refusals(runner, tenantId, taskCsvConfig, 'title;status\nMigrate;-'), [['status', 'CSV_VALUE_CANNOT_BE_CLEARED']]);
    assert.deepEqual(await refusals(runner, tenantId, taskCsvConfig, 'title;description\n-;x'), [['title', 'CSV_VALUE_CANNOT_BE_CLEARED']]);
  });
}

async function testPortfolio() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-clear-portfolio');
    const requestId = randomUUID();
    const projectId = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, status, risks, current_situation, expected_benefits) VALUES ($1, $2, 1, 'New CRM', 'pending_review', '-', 'Spreadsheets', 'Savings')`,
      [requestId, tenantId],
    );
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, execution_progress, override_justification) VALUES ($1, $2, 100, 'Cloud move', 'in_progress', 40, '-')`,
      [projectId, tenantId],
    );
    // A full export reads back without error and keeps the stored "-". These rows have no document
    // binding (seeded in SQL), so their purpose counts as an update: the values are checked instead.
    for (const [config, id, column] of [[portfolioRequestCsvConfig, requestId, 'risks'], [portfolioProjectCsvConfig, projectId, 'override_justification']] as const) {
      const csv = await fullExport(runner, tenantId, config, id);
      assert.match(csv, /'-/, `${config.entityName}: the stored "-" is exported guarded`);
      const outcome = (r: CsvImportResult) => [r.ok, r.errors, r.warnings, r.inserted, r.updated, r.skipped, r.unchanged, r.cleared];
      const preflight = await run(runner, tenantId, config, csv, { dryRun: true });
      assert.deepEqual([preflight.errors, preflight.cleared], [[], 0], `${config.entityName}: preflight of the full export`);
      for (const workbook of [await fullExportXlsx(runner, tenantId, config, id), workbookOfCsv(csv, 'en')]) {
        assert.deepEqual(outcome(await run(runner, tenantId, config, workbook, { dryRun: true })), outcome(preflight), `${config.entityName}: preflight of a workbook`);
        assert.equal((await run(runner, tenantId, config, workbook)).ok, true);
        assert.equal((await stored(runner, config.tableName, id))[column], '-', `${config.entityName}: the "-" is kept`);
      }
      assert.equal((await run(runner, tenantId, config, csv)).ok, true);
      assert.equal((await stored(runner, config.tableName, id))[column], '-', `${config.entityName}: the "-" is kept`);
    }

    // `-` clears an optional value and empties the criteria to {}; a blank cell keeps.
    await runner.query(`UPDATE portfolio_requests SET criteria_values = '{"x": "y"}'::jsonb WHERE id = $1`, [requestId]);
    let result = await preflightThenLoad(runner, tenantId, portfolioRequestCsvConfig, 'name;current_situation;expected_benefits;criteria_values\nNew CRM;-;;-');
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 2], JSON.stringify(result.errors));
    const request = await stored(runner, 'portfolio_requests', requestId);
    assert.deepEqual([request.current_situation, request.expected_benefits, request.criteria_values], [null, 'Savings', {}]);
    assert.deepEqual(await refusals(runner, tenantId, portfolioRequestCsvConfig, 'name;priority_override\nNew CRM;-'), [['priority_override', 'CSV_VALUE_CANNOT_BE_CLEARED']]);

    result = await preflightThenLoad(runner, tenantId, portfolioProjectCsvConfig, 'name;override_justification\nCloud move;-');
    assert.deepEqual([result.ok, result.cleared], [true, 1], JSON.stringify(result.errors));
    assert.equal((await stored(runner, 'portfolio_projects', projectId)).override_justification, null);
    // A NOT NULL number: write 0.
    assert.deepEqual(await refusals(runner, tenantId, portfolioProjectCsvConfig, 'name;status;execution_progress\nCloud move;-;-'), [
      ['execution_progress', 'CSV_NUMBER_CANNOT_BE_CLEARED'],
      ['status', 'CSV_VALUE_CANNOT_BE_CLEARED'],
    ]);

    // Insert only: the matched row is skipped, so its `-` blocks nothing and clears nothing. A new
    // row reads `-` as blank cells: the defaults of its columns.
    result = await preflightThenLoad(
      runner, tenantId, portfolioProjectCsvConfig,
      'name;status;criteria_values;priority_override\nCloud move;-;-;-\nNew portal;-;-;-',
      { operation: 'insert_only' },
    );
    assert.deepEqual([result.ok, result.inserted, result.skipped, result.cleared], [true, 1, 1, 0], JSON.stringify(result.errors));
    const [created] = await runner.query(
      `SELECT status, criteria_values, priority_override FROM portfolio_projects WHERE tenant_id = $1 AND name = 'New portal'`,
      [tenantId],
    );
    assert.deepEqual([created.criteria_values, created.priority_override], [{}, false]);
    assert.equal((await stored(runner, 'portfolio_projects', projectId)).status, 'in_progress');
  });
}

async function testIncidents() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-clear-incidents');
    const [{ id: roleId }] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`, [tenantId]);
    const email = `owner-${tenantId.slice(0, 8)}@example.test`;
    const [{ id: ownerId }] = await runner.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Olga', 'Owner', $3, 'enabled') RETURNING id`,
      [tenantId, email, roleId],
    );
    const id = randomUUID();
    await runner.query(
      `INSERT INTO incidents (id, tenant_id, item_number, title, category, severity, status, owner_user_id, confidential, personal_data_affected, authority_notification_required)
       VALUES ($1, $2, 7, '-', 'outage', 'major', 'open', $3, false, true, true)`,
      [id, tenantId, ownerId],
    );

    await assertRoundTrip(runner, tenantId, incidentCsvConfig, id);

    // `-` clears an optional value and a reference; a blank yes or no keeps the stored one.
    const result = await preflightThenLoad(
      runner, tenantId, incidentCsvConfig,
      'ref;title;severity;category;owner;personal_data_affected;authority_notification_required\nINC-7;Outage;major;-;-;;',
    );
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 2], JSON.stringify(result.errors));
    const after = await stored(runner, 'incidents', id);
    assert.deepEqual(
      [after.category, after.owner_user_id, after.personal_data_affected, after.authority_notification_required],
      [null, null, true, true],
    );

    // `-` on the status is refused. (The incidents' hook gives a yes or no its value itself: pass B of lot I6.)
    assert.deepEqual(await refusals(runner, tenantId, incidentCsvConfig, 'ref;status\nINC-7;-'), [['status', 'CSV_VALUE_CANNOT_BE_CLEARED']]);
    // Only the column that finds the record is required (T-I6i): no title, no severity.
    const partial = await preflightThenLoad(runner, tenantId, incidentCsvConfig, 'ref;category\nINC-7;outage');
    assert.deepEqual([partial.ok, partial.updated], [true, 1], JSON.stringify(partial.errors));
    assert.equal((await stored(runner, 'incidents', id)).title, 'Outage');
  });
}

async function main() {
  await dataSource.initialize();
  let failed = false;
  try {
    for (const test of [testApplications, testAssets, testTasks, testPortfolio, testIncidents]) {
      try {
        await test();
        console.log(`${test.name}: ok`);
      } catch (err) {
        failed = true;
        console.error(`${test.name}:`, err);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failed) process.exit(1);
  console.log('csv-import-clearing-rule.integration.spec: ok');
}

void main();
