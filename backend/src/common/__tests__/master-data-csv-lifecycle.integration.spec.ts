import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CompaniesService } from '../../companies/companies.service';
import { DepartmentsService } from '../../departments/departments.service';
import { CostCentersService } from '../../cost-centers/cost-centers.service';
import { CostCentersCsvService } from '../../cost-centers/cost-centers-csv.service';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { AnalyticsCategoriesCsvService } from '../../analytics/analytics-categories-csv.service';
import { AnalyticsCategory } from '../../analytics/analytics-category.entity';
import { deriveStatusFromDisabledAt } from '../status';

// The master-data CSVs (companies, departments, cost centers, analytics values)
// follow the item rule of `csvItemLifecycle`: on an update a blank status and a
// blank date keep the stored values; disabled with a blank date keeps a date
// already passed, otherwise the end of validity is now; enabled with a blank
// date clears it. A new row with a blank status is enabled. A status that
// contradicts its date is a row error. Exports write the status read from the
// end of validity, so a stale stored status never contradicts its own row.

const COMPANY = 'Lifecycle test company';
const PAST = '2020-03-31';
const OLDER = '2021-05-31';
const FUTURE = '2031-06-30';

type Lifecycle = { status: string; disabled_at: string | null };
type Result = { ok: boolean; errors: Array<{ row: number; message: string }> };

type Importer = {
  label: string;
  table: string;
  nameColumn: string;
  headers(): Promise<string[]>;
  /** The cells of a valid row for `name`; status and date are set by the caller. */
  base(name: string): Record<string, string>;
  importCsv(content: string, dryRun: boolean): Promise<Result>;
  exportCsv(): Promise<string>;
};

function auditService(manager: EntityManager) {
  return new AuditService(manager.getRepository(AuditLog));
}

function importers(manager: EntityManager, tenantId: string): Importer[] {
  const audit = auditService(manager);
  const file = (content: string) => ({ buffer: Buffer.from(`﻿${content}\n`, 'utf8') }) as any;
  const headerOf = (content: string) => content.replace(/^﻿/, '').split('\n')[0].split(';');
  // No metrics in these files: the export reads none.
  const companies = new CompaniesService(undefined as any, audit, { list: async () => ({ items: [] }) } as any);
  const departments = new DepartmentsService(undefined as any, undefined as any, audit);
  const costCenters = new CostCentersCsvService(new CostCentersService(audit));
  const analytics = new AnalyticsCategoriesCsvService(new AnalyticsCategoriesService(manager.getRepository(AnalyticsCategory), audit));
  const ctx = { manager, tenantId, userId: null };
  return [
    {
      label: 'companies',
      table: 'companies',
      nameColumn: 'name',
      headers: async () => headerOf((await companies.exportCsv('template', { manager })).content),
      base: (name) => ({ name, country_iso: 'FR', city: 'Lyon', base_currency: 'EUR' }),
      importCsv: (content, dryRun) => companies.importCsv({ file: file(content), dryRun, userId: null }, { manager }) as Promise<Result>,
      exportCsv: async () => (await companies.exportCsv('data', { manager })).content,
    },
    {
      label: 'departments',
      table: 'departments',
      nameColumn: 'name',
      headers: async () => headerOf((await departments.exportCsv('template', { manager })).content),
      base: (name) => ({ company_name: COMPANY, name }),
      importCsv: (content, dryRun) => departments.importCsv({ file: file(content), dryRun, userId: null }, { manager }) as Promise<Result>,
      exportCsv: async () => (await departments.exportCsv('data', { manager })).content,
    },
    {
      label: 'cost centers',
      table: 'cost_centers',
      nameColumn: 'name',
      headers: async () => headerOf((await costCenters.exportCsv('template', ctx)).content),
      base: (name) => ({ code: name.replace(/\W+/g, '-').toUpperCase(), kind: 'group', name }),
      importCsv: (content, dryRun) => costCenters.importCsv({ file: file(content), dryRun }, ctx),
      exportCsv: async () => (await costCenters.exportCsv('data', ctx)).content,
    },
    {
      label: 'analytics values',
      table: 'analytics_categories',
      nameColumn: 'name',
      headers: async () => headerOf((await analytics.exportCsv('template', ctx)).content),
      base: (name) => ({ name }),
      importCsv: (content, dryRun) => analytics.importCsv({ file: file(content), dryRun }, ctx),
      exportCsv: async () => (await analytics.exportCsv('data', ctx)).content,
    },
  ];
}

async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Master data lifecycle test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `md-life-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'EUR')`, [tenantId, COMPANY]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** One file line per row; a `null` row is a blank line. */
async function run(importer: Importer, rows: Array<[string, string, string] | null>, dryRun = false): Promise<Result> {
  const headers = await importer.headers();
  const lines = rows.map((row) => {
    if (!row) return '';
    const [name, status, disabledAt] = row;
    const values: Record<string, string> = { ...importer.base(name), status, disabled_at: disabledAt };
    return headers.map((header) => values[header] ?? '').join(';');
  });
  return importer.importCsv([headers.join(';'), ...lines].join('\n'), dryRun);
}

async function read(runner: QueryRunner, importer: Importer, tenantId: string, name: string): Promise<Lifecycle> {
  const [row] = await runner.query(
    `SELECT status::text AS status, disabled_at FROM ${importer.table} WHERE tenant_id = $1 AND ${importer.nameColumn} = $2`,
    [tenantId, name],
  );
  assert.ok(row, `${importer.label}: ${name} exists`);
  return { status: row.status, disabled_at: row.disabled_at ? new Date(row.disabled_at).toISOString() : null };
}

const day = (lifecycle: Lifecycle) => lifecycle.disabled_at?.slice(0, 10) ?? null;

async function testBlankCellsOnUpdate(pick: number) {
  await withTenant(`blank-${pick}`, async (runner, tenantId) => {
    const importer = importers(runner.manager, tenantId)[pick];
    const label = importer.label;
    const seeded = await run(importer, [
      ['Both blank', 'disabled', PAST],
      ['Keeps future', '', FUTURE],
      ['Disabled keeps', 'disabled', OLDER],
      ['Disabled now', '', ''],
      ['Future disabled', '', FUTURE],
      ['Enabled clears', 'enabled', FUTURE],
    ]);
    assert.equal(seeded.ok, true, `${label} seed: ${JSON.stringify(seeded.errors)}`);
    assert.deepEqual([(await read(runner, importer, tenantId, 'Both blank')).status, day(await read(runner, importer, tenantId, 'Both blank'))], ['disabled', PAST]);

    const before = Date.now();
    const updated = await run(importer, [
      ['Both blank', '', ''],
      ['Keeps future', '', ''],
      ['Disabled keeps', 'disabled', ''],
      ['Disabled now', 'disabled', ''],
      ['Future disabled', 'disabled', ''],
      ['Enabled clears', 'enabled', ''],
      ['New blank', '', ''],
      ['New disabled', 'disabled', ''],
    ]);
    const after = Date.now();
    assert.equal(updated.ok, true, `${label} update: ${JSON.stringify(updated.errors)}`);

    const both = await read(runner, importer, tenantId, 'Both blank');
    assert.deepEqual([both.status, day(both)], ['disabled', PAST], `${label}: blank status and date keep a disabled row disabled with its date`);
    const future = await read(runner, importer, tenantId, 'Keeps future');
    assert.deepEqual([future.status, day(future)], ['enabled', FUTURE], `${label}: blank status and date keep a future end of validity`);
    const keeps = await read(runner, importer, tenantId, 'Disabled keeps');
    assert.deepEqual([keeps.status, day(keeps)], ['disabled', OLDER], `${label}: disabled with a blank date keeps a date already passed`);
    for (const [name, what] of [
      ['Disabled now', 'disabled with a blank date and none stored'],
      ['Future disabled', 'disabled with a blank date and a future one stored'],
      ['New disabled', 'a new disabled row with a blank date'],
    ]) {
      const now = await read(runner, importer, tenantId, name);
      assert.equal(now.status, 'disabled', `${label}: ${what} disables the row`);
      const at = Date.parse(now.disabled_at ?? '');
      assert.ok(at >= before - 1000 && at <= after + 1000, `${label}: ${what} ends now (${now.disabled_at})`);
    }
    assert.deepEqual(await read(runner, importer, tenantId, 'Enabled clears'), { status: 'enabled', disabled_at: null }, `${label}: enabled with a blank date clears the date`);
    assert.deepEqual(await read(runner, importer, tenantId, 'New blank'), { status: 'enabled', disabled_at: null }, `${label}: a new row with a blank status is enabled`);
  });
}

async function testConflictsAndExport(pick: number) {
  await withTenant(`conflict-${pick}`, async (runner, tenantId) => {
    const importer = importers(runner.manager, tenantId)[pick];
    const label = importer.label;
    const conflicts = await run(importer, [
      ['Fine', '', ''],
      null,
      ['Enabled but ended', 'enabled', PAST],
      null,
      ['Disabled but open', 'disabled', FUTURE],
    ], true);
    assert.equal(conflicts.ok, false, `${label}: a contradictory row refuses the file`);
    // Blank lines count: the errors name the file's own lines.
    assert.deepEqual(conflicts.errors.map((e) => e.row), [4, 6], `${label}: ${JSON.stringify(conflicts.errors)}`);
    assert.equal(
      conflicts.errors[0].message,
      'Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.',
    );
    assert.match(conflicts.errors[1].message, /^Status is disabled but the end of validity is still to come/);

    const seeded = await run(importer, [['Stale row', '', FUTURE], ['Open row', '', '']]);
    assert.equal(seeded.ok, true, `${label} seed: ${JSON.stringify(seeded.errors)}`);
    // A future end date that has since passed: the stored status is still enabled.
    await runner.query(
      `UPDATE ${importer.table} SET disabled_at = '2022-03-31T12:00:00Z' WHERE tenant_id = $1 AND ${importer.nameColumn} = 'Stale row'`,
      [tenantId],
    );
    assert.equal((await read(runner, importer, tenantId, 'Stale row')).status, 'enabled', 'the stored status is stale');
    const exported = await importer.exportCsv();
    const [header, ...lines] = exported.replace(/^﻿/, '').split('\n').filter((line) => line.trim() !== '');
    const columns = header.split(';');
    const stale = lines.map((line) => Object.fromEntries(line.split(';').map((value, i) => [columns[i], value])))
      .find((row) => row[importer.nameColumn] === 'Stale row');
    assert.equal(stale?.status, 'disabled', `${label}: the export writes the status read from the end of validity`);
    const reimported = await importer.importCsv(exported.replace(/^﻿/, ''), false);
    assert.equal(reimported.ok, true, `${label}: a fresh export re-imports (${JSON.stringify(reimported.errors)})`);
    // The stored `status` column belongs to the hourly lifecycle sync (an importer may count
    // the row unchanged and leave it): what the import promises is the date, and the status
    // read from it.
    const stored = await read(runner, importer, tenantId, 'Stale row');
    assert.equal(stored.disabled_at, '2022-03-31T12:00:00.000Z', `${label}: the date is kept`);
    assert.equal(deriveStatusFromDisabledAt(stored.disabled_at), 'disabled', `${label}: the row reads as disabled`);
  });
}

async function testEndOfValidityFormat(pick: number) {
  await withTenant(`date-${pick}`, async (runner, tenantId) => {
    const importer = importers(runner.manager, tenantId)[pick];
    const message = (value: string) => `Invalid disabled_at '${value}'. Use YYYY-MM-DD or a full ISO date and time.`;
    // A blank status skips the "enabled, but the date has passed" check, so the case still passes after 2027-03-01.
    const refused = await run(importer, [
      ['Slash', '', '01/03/2027'],
      ['Day first', '', '31/12/2027'],
      ['Dotted', '', '03.01.2027'],
    ]);
    assert.equal(refused.ok, false, `${importer.label}: a local date is refused`);
    assert.deepEqual(refused.errors, [
      { row: 2, message: message('01/03/2027') },
      { row: 3, message: message('31/12/2027') },
      { row: 4, message: message('03.01.2027') },
    ]);
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM ${importer.table} WHERE tenant_id = $1 AND ${importer.nameColumn} = ANY($2::text[])`,
      [tenantId, ['Slash', 'Day first', 'Dotted']],
    );
    assert.equal(n, 0, `${importer.label}: a refused file writes nothing`);

    const accepted = await run(importer, [
      ['Bare day', '', '2027-03-01'],
      ['Timestamp', '', '2027-03-01T15:04:05.000Z'],
    ]);
    assert.equal(accepted.ok, true, `${importer.label}: YYYY-MM-DD and a full timestamp import (${JSON.stringify(accepted.errors)})`);
    assert.equal((await read(runner, importer, tenantId, 'Bare day')).disabled_at, '2027-03-01T12:00:00.000Z', `${importer.label}: a bare day is noon UTC`);
    assert.equal((await read(runner, importer, tenantId, 'Timestamp')).disabled_at, '2027-03-01T15:04:05.000Z', `${importer.label}: a timestamp is kept`);
  });
}

async function main() {
  await dataSource.initialize();
  let failed = 0;
  const names = ['companies', 'departments', 'cost centers', 'analytics values'];
  const tests: Array<[string, () => Promise<void>]> = [
    ...names.flatMap((name, pick) => [
      [`testBlankCellsOnUpdate(${name})`, () => testBlankCellsOnUpdate(pick)],
      [`testConflictsAndExport(${name})`, () => testConflictsAndExport(pick)],
    ] as Array<[string, () => Promise<void>]>),
    ['testEndOfValidityFormat(companies)', () => testEndOfValidityFormat(0)],
    ['testEndOfValidityFormat(departments)', () => testEndOfValidityFormat(1)],
  ];
  try {
    for (const [name, test] of tests) {
      try {
        await test();
        console.log(`ok - ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`not ok - ${name}`);
        console.error(err);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failed > 0) {
    console.error(`master-data-csv-lifecycle.integration.spec: ${failed} failed`);
    process.exit(1);
  }
  console.log('master-data-csv-lifecycle.integration.spec: ok');
}

void main();
