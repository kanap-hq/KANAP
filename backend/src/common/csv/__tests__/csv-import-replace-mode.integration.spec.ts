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

// Full replace in the shared CSV import, against the real tables: a column the file leaves out is
// never touched; a blank cell of a column the file holds empties the field (the empty list of a
// NOT NULL list column, null for a nullable one) or, for a NOT NULL column with no empty value,
// is a row error at the preflight. The identity column and the matching key are never emptied.
// A full export read back in full replace changes nothing. Each test runs in a transaction
// rolled back.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

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

function file(content: string): Express.Multer.File {
  const text = '﻿' + content;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'import.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

async function run(
  runner: QueryRunner,
  tenantId: string,
  config: CsvEntityConfig,
  csv: string,
  params: Partial<CsvImportParams> = {},
): Promise<CsvImportResult> {
  return importer.import(config, file(csv), { dryRun: false, mode: 'replace', operation: 'upsert', ...params }, {
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
 * The preflight, then the load of the same file: the same errors and counts, and the load writes
 * what the preflight announced.
 */
async function preflightThenLoad(
  runner: QueryRunner,
  tenantId: string,
  config: CsvEntityConfig,
  csv: string,
  params: Partial<CsvImportParams> = {},
): Promise<CsvImportResult> {
  const preflight = await run(runner, tenantId, config, csv, { ...params, dryRun: true });
  const result = await run(runner, tenantId, config, csv, { ...params, dryRun: false });
  const counts = (r: CsvImportResult) => [r.ok, r.errors, r.inserted, r.updated, r.skipped, r.unchanged];
  assert.deepEqual(counts(result), counts(preflight), `${config.entityName}: the load matches its preflight`);
  return result;
}

/** Every column the import reads, as the export writes them. */
async function fullExport(runner: QueryRunner, tenantId: string, config: CsvEntityConfig, id: string): Promise<string> {
  const rows = await runner.query(`SELECT * FROM ${config.tableName} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  const fields = [...new Set(config.fields.filter((f) => f.importable !== false && f.exportable !== false).map((f) => f.csvColumn))];
  const result = await exporter.export(config, rows, { manager: runner.manager, tenantId, fields, language: 'en' });
  return result.content.replace(/^﻿/, '');
}

/** The exported file read back in full replace: no error, the row counted as unchanged. */
async function assertRoundTrip(runner: QueryRunner, tenantId: string, config: CsvEntityConfig, id: string) {
  const csv = await fullExport(runner, tenantId, config, id);
  const before = await stored(runner, config.tableName, id);
  const preflight = await run(runner, tenantId, config, csv, { dryRun: true });
  assert.deepEqual(preflight.errors, [], `${config.entityName}: preflight of the full export`);
  assert.equal(preflight.unchanged, 1, `${config.entityName}: the exported row is unchanged`);
  const result = await run(runner, tenantId, config, csv);
  assert.equal(result.ok, true, `${config.entityName}: import of the full export ${JSON.stringify(result.errors)}`);
  assert.deepEqual(await stored(runner, config.tableName, id), before, `${config.entityName}: nothing changed`);
}

async function seedApplication(runner: QueryRunner, tenantId: string, values: { name: string; access_methods: string[] }) {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO applications (id, tenant_id, name, description, category, lifecycle, access_methods, external_facing, notes, contains_pii)
     VALUES ($1, $2, $3, 'Books', 'erp', 'active', $4, true, 'Kept notes', true)`,
    [id, tenantId, values.name, values.access_methods],
  );
  return id;
}

async function testApplications() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-replace-apps');
    const ledger = await seedApplication(runner, tenantId, { name: 'Ledger', access_methods: ['web'] });
    const empty = await seedApplication(runner, tenantId, { name: 'Payroll', access_methods: [] });

    // A full export read back: an empty NOT NULL list stays an empty list.
    await assertRoundTrip(runner, tenantId, applicationCsvConfig, ledger);
    await assertRoundTrip(runner, tenantId, applicationCsvConfig, empty);

    // A partial file without the id column: only the description changes.
    const before = await stored(runner, 'applications', ledger);
    let result = await run(runner, tenantId, applicationCsvConfig, 'name;description\nLedger;General ledger');
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.updated, 1);
    let after = await stored(runner, 'applications', ledger);
    assert.equal(after.id, ledger);
    assert.equal(after.description, 'General ledger');
    for (const column of ['category', 'lifecycle', 'access_methods', 'external_facing', 'notes', 'contains_pii', 'status']) {
      assert.deepEqual(after[column], before[column], `applications.${column} untouched`);
    }

    // Blank cells of columns the file holds: nullable to null, NOT NULL list to [].
    result = await run(runner, tenantId, applicationCsvConfig, `id;name;description;notes;access_methods\n${ledger};Ledger;;;`);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    after = await stored(runner, 'applications', ledger);
    assert.equal(after.description, null);
    assert.equal(after.notes, null);
    assert.deepEqual(after.access_methods, []);
    assert.equal(after.category, 'erp');

    // A blank id cell never empties the id: the row matches by name.
    result = await run(runner, tenantId, applicationCsvConfig, 'id;name;notes\n;Ledger;Back');
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.updated, 1);
    assert.equal((await stored(runner, 'applications', ledger)).notes, 'Back');

    // A NOT NULL column without an empty value: a row error at the preflight, nothing written.
    result = await run(runner, tenantId, applicationCsvConfig, 'name;lifecycle;notes\nLedger;;Changed', { dryRun: true });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((e) => [e.row, e.column, e.code, e.params]), [
      [2, 'lifecycle', 'CSV_VALUE_CANNOT_BE_EMPTIED', { column: 'lifecycle' }],
    ]);
    // A new row takes the column's default instead.
    result = await run(runner, tenantId, applicationCsvConfig, 'name;lifecycle\nNew app;');
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const [created] = await runner.query(`SELECT lifecycle, access_methods FROM applications WHERE tenant_id = $1 AND name = 'New app'`, [tenantId]);
    assert.deepEqual([created.lifecycle, created.access_methods], ['active', []]);

    // Blank classification cells keep their values in both modes (applications.md).
    result = await run(runner, tenantId, applicationCsvConfig, 'name;contains_pii\nLedger;');
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal((await stored(runner, 'applications', ledger)).contains_pii, true);

    // Merge mode is unchanged: blank cells keep the stored values.
    result = await run(runner, tenantId, applicationCsvConfig, 'name;notes;access_methods\nLedger;;', { mode: 'enrich' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    after = await stored(runner, 'applications', ledger);
    assert.equal(after.notes, 'Back');
    assert.deepEqual(after.access_methods, []);
  });
}

async function testAssets() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-replace-assets');
    const locationId = randomUUID();
    await runner.query(
      `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
      [locationId, tenantId],
    );
    const id = randomUUID();
    await runner.query(
      `INSERT INTO assets (id, tenant_id, name, kind, environment, status, location_id, provider, hostname, notes, aliases, ip_addresses)
       VALUES ($1, $2, 'srv-01', 'vm', 'prod', 'active', $3, 'on_prem', 'srv-01.corp', 'Rack 4', ARRAY['web'], $4::jsonb)`,
      [id, tenantId, locationId, JSON.stringify([{ type: 'mgmt', ip: '10.0.0.1', subnet_cidr: '10.0.0.0/24' }])],
    );

    await assertRoundTrip(runner, tenantId, assetCsvConfig, id);

    const before = await stored(runner, 'assets', id);
    let result = await run(runner, tenantId, assetCsvConfig, 'name;location_reference;kind;environment;notes\nsrv-01;LOC-1;vm;prod;Rack 5');
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    let after = await stored(runner, 'assets', id);
    assert.equal(after.notes, 'Rack 5');
    for (const column of ['hostname', 'aliases', 'ip_addresses', 'status', 'location_id']) {
      assert.deepEqual(after[column], before[column], `assets.${column} untouched`);
    }

    // Blank nested IP columns and a blank nullable list empty their fields.
    result = await run(runner, tenantId, assetCsvConfig, 'name;location_reference;kind;environment;aliases;ip_1_type;ip_1_address\nsrv-01;LOC-1;vm;prod;;;');
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    after = await stored(runner, 'assets', id);
    assert.equal(after.aliases, null);
    assert.equal(after.ip_addresses, null);
    assert.equal(after.hostname, 'srv-01.corp');

    result = await run(runner, tenantId, assetCsvConfig, 'name;location_reference;kind;environment;status\nsrv-01;LOC-1;vm;prod;', { dryRun: true });
    assert.deepEqual(result.errors.map((e) => [e.column, e.code]), [['status', 'CSV_VALUE_CANNOT_BE_EMPTIED']]);

    // Partial nested columns: only the sub-columns the file holds change, on the stored list.
    const twoIps = randomUUID();
    await runner.query(
      `INSERT INTO assets (id, tenant_id, name, kind, environment, status, location_id, provider, ip_addresses)
       VALUES ($1, $2, 'srv-02', 'vm', 'prod', 'active', $3, 'on_prem', $4::jsonb)`,
      [twoIps, tenantId, locationId, JSON.stringify([
        { type: 'mgmt', ip: '10.0.0.1', subnet_cidr: '10.0.0.0/24' },
        { type: 'mgmt', ip: '10.0.1.1', subnet_cidr: '10.0.1.0/24' },
      ])],
    );
    for (const mode of ['replace', 'enrich'] as const) {
      result = await preflightThenLoad(runner, tenantId, assetCsvConfig, `name;location_reference;kind;environment;ip_1_type;ip_1_address\nsrv-02;LOC-1;vm;prod;mgmt;10.0.0.${mode === 'replace' ? 9 : 8}`, { mode });
      assert.equal(result.updated, 1, `${mode}: ${JSON.stringify(result.errors)}`);
      assert.deepEqual((await stored(runner, 'assets', twoIps)).ip_addresses, [
        { type: 'mgmt', ip: `10.0.0.${mode === 'replace' ? 9 : 8}`, subnet_cidr: '10.0.0.0/24' },
        { type: 'mgmt', ip: '10.0.1.1', subnet_cidr: '10.0.1.0/24' },
      ], `${mode}: the second IP and the first subnet are kept`);
    }
    // A blank sub-column the file holds clears that sub-property only.
    result = await preflightThenLoad(runner, tenantId, assetCsvConfig, 'name;location_reference;kind;environment;ip_2_subnet_cidr\nsrv-02;LOC-1;vm;prod;');
    assert.equal(result.updated, 1, JSON.stringify(result.errors));
    assert.deepEqual((await stored(runner, 'assets', twoIps)).ip_addresses, [
      { type: 'mgmt', ip: '10.0.0.8', subnet_cidr: '10.0.0.0/24' },
      { type: 'mgmt', ip: '10.0.1.1', subnet_cidr: null },
    ]);
  });
}

async function testTasks() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-replace-tasks');
    const id = randomUUID();
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, item_number, title, description, status, priority_level, labels)
       VALUES ($1, $2, 1, 'Migrate', 'Move it', 'in_progress', 'high', '["infra"]'::jsonb)`,
      [id, tenantId],
    );

    await assertRoundTrip(runner, tenantId, taskCsvConfig, id);

    const before = await stored(runner, 'tasks', id);
    let result = await run(runner, tenantId, taskCsvConfig, 'title;description\nMigrate;Move everything');
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    let after = await stored(runner, 'tasks', id);
    assert.equal(after.description, 'Move everything');
    for (const column of ['status', 'priority_level', 'labels', 'item_number']) {
      assert.deepEqual(after[column], before[column], `tasks.${column} untouched`);
    }

    // A NOT NULL JSON list empties to [].
    result = await run(runner, tenantId, taskCsvConfig, `id;title;labels\n${id};Migrate;`);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    after = await stored(runner, 'tasks', id);
    assert.deepEqual(after.labels, []);
    assert.equal(after.status, 'in_progress');
  });
}

async function testPortfolio() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-replace-portfolio');
    const requestId = randomUUID();
    const projectId = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, status) VALUES ($1, $2, 1, 'New CRM', 'pending_review')`,
      [requestId, tenantId],
    );
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, execution_progress) VALUES ($1, $2, 100, 'Cloud move', 'in_progress', 40)`,
      [projectId, tenantId],
    );
    // A full export reads back without error. These rows have no document binding (seeded in SQL),
    // so their purpose counts as an update: only the errors are checked here.
    for (const [config, id] of [[portfolioRequestCsvConfig, requestId], [portfolioProjectCsvConfig, projectId]] as const) {
      const preflight = await run(runner, tenantId, config, await fullExport(runner, tenantId, config, id), { dryRun: true });
      assert.deepEqual(preflight.errors, [], `${config.entityName}: preflight of the full export`);
      assert.equal(preflight.ok, true);
    }

    let result = await run(runner, tenantId, portfolioProjectCsvConfig, 'name;status\nCloud move;', { dryRun: true });
    assert.deepEqual(result.errors.map((e) => [e.column, e.code]), [['status', 'CSV_VALUE_CANNOT_BE_EMPTIED']]);

    // Insert only: the matched row is skipped, so its blank NOT NULL cell blocks nothing. A new row
    // takes the defaults of its blank columns, nullable ones included.
    result = await preflightThenLoad(
      runner, tenantId, portfolioProjectCsvConfig,
      'name;status;criteria_values;priority_override\nCloud move;;;\nNew portal;;;',
      { operation: 'insert_only' },
    );
    assert.deepEqual([result.ok, result.inserted, result.skipped], [true, 1, 1], JSON.stringify(result.errors));
    const [created] = await runner.query(
      `SELECT status, criteria_values, priority_override FROM portfolio_projects WHERE tenant_id = $1 AND name = 'New portal'`,
      [tenantId],
    );
    assert.deepEqual([created.criteria_values, created.priority_override], [{}, false]);
    const [{ status_default: statusDefault }] = await runner.query(
      `SELECT column_default AS status_default FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'portfolio_projects' AND column_name = 'status'`,
    );
    assert.equal(statusDefault, `'${created.status}'::text`, 'status takes its default');
    assert.equal((await stored(runner, 'portfolio_projects', projectId)).status, 'in_progress');
  });
}

async function testIncidents() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-replace-incidents');
    const id = randomUUID();
    await runner.query(
      `INSERT INTO incidents (id, tenant_id, item_number, title, severity, status, confidential, personal_data_affected, authority_notification_required)
       VALUES ($1, $2, 7, 'Outage', 'major', 'open', true, true, true)`,
      [id, tenantId],
    );
    // The hook rules win: a blank boolean is false, a blank confidential flag keeps the stored one.
    const result = await preflightThenLoad(
      runner, tenantId, incidentCsvConfig,
      'ref;title;severity;personal_data_affected;authority_notification_required;confidential\nINC-7;Outage;major;;;',
    );
    assert.deepEqual([result.ok, result.updated], [true, 1], JSON.stringify(result.errors));
    const after = await stored(runner, 'incidents', id);
    assert.deepEqual(
      [after.personal_data_affected, after.authority_notification_required, after.confidential],
      [false, false, true],
    );
  });
}

async function main() {
  await dataSource.initialize();
  let failed = false;
  try {
    await testApplications();
    await testAssets();
    await testTasks();
    await testPortfolio();
    await testIncidents();
  } catch (err) {
    failed = true;
    console.error(err);
  } finally {
    await dataSource.destroy();
  }
  if (failed) process.exit(1);
  console.log('csv-import-replace-mode.integration.spec: ok');
}

void main();
