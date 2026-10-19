import 'dotenv/config';
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.
import { QueryRunner } from 'typeorm';
import { CompaniesService } from '../companies.service';
import { Company } from '../company.entity';
import { CompanyMetric } from '../company-metric.entity';
import { CompanyMetricsService } from '../company-metrics.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  realFreeze,
  runSpecs,
  seedTenant,
  setTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// The companies file, beyond the shared master-data layer: a new company
// needs a city, an empty city on an existing company is refused the same way
// as the other required columns, a frozen year is refused at the check, two
// rows cannot share a name, and a year block is optional.

const YEAR = 2026;
const BASE_HEADERS = [
  'name', 'country_iso', 'address1', 'address2', 'postal_code', 'city', 'state',
  'reg_number', 'vat_number', 'base_currency', 'status', 'disabled_at', 'notes',
];

type Report = {
  ok: boolean;
  dryRun?: boolean;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  errors: Array<{ row: number; column?: string; message: string; code?: string; params?: Record<string, string | number> }>;
  ignoredColumns?: string[];
};

function yearHeaders(years: readonly number[]): string[] {
  return years.flatMap((year) => [`headcount_${year}`, `it_users_${year}`, `turnover_${year}`]);
}

const WINDOW = [YEAR - 1, YEAR, YEAR + 1];
const FULL_HEADERS = [...BASE_HEADERS, ...yearHeaders(WINDOW)];

function fileOf(rows: Array<Record<string, string>>, headers: readonly string[] = FULL_HEADERS): Express.Multer.File {
  const lines = [headers.join(','), ...rows.map((row) => headers.map((header) => row[header] ?? '').join(','))];
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8') } as Express.Multer.File;
}

function company(over: Record<string, string> = {}): Record<string, string> {
  return { name: 'QA-Faute', country_iso: 'FR', city: 'Paris', base_currency: 'EUR', status: 'enabled', ...over };
}

function service(runner: QueryRunner) {
  const audit = captureAudit() as any;
  const metrics = new CompanyMetricsService(runner.manager.getRepository(CompanyMetric), audit, realFreeze());
  return new CompaniesService(runner.manager.getRepository(Company), audit, metrics);
}

async function withCompanies(tag: string, fn: (runner: QueryRunner, tenantId: string, svc: CompaniesService) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, tag);
    await fn(runner, tenantId, service(runner));
  });
}

function importer(runner: QueryRunner, svc: CompaniesService) {
  return (rows: Array<Record<string, string>>, dryRun: boolean, headers?: readonly string[]) =>
    svc.importCsv(
      { file: fileOf(rows, headers), dryRun, userId: null, language: 'en', year: YEAR },
      { manager: runner.manager },
    ) as Promise<Report>;
}

async function storedCities(runner: QueryRunner, tenantId: string): Promise<Array<{ name: string; city: string }>> {
  return runner.query(`SELECT name, city FROM companies WHERE tenant_id = $1 ORDER BY name`, [tenantId]);
}

/** A blank city is refused at the check, for a new company and for an existing one, like name. */
async function testBlankCityRefused() {
  await withCompanies('city', async (runner, tenantId, svc) => {
    const run = importer(runner, svc);
    for (const dryRun of [true, false]) {
      const report = await run([company({ name: 'QA-Faute', city: '' })], dryRun);
      assert.equal(report.ok, false, `new company, dryRun=${dryRun}: ${JSON.stringify(report.errors)}`);
      assert.deepEqual(report.errors, [{
        row: 2, column: 'city', code: 'CSV_VALUE_REQUIRED', message: 'city is required',
      }]);
    }
    assert.deepEqual(await storedCities(runner, tenantId), [], 'a refused new company is not inserted');

    await svc.create({ name: 'Kept', country_iso: 'FR', city: 'Lyon', base_currency: 'EUR' }, undefined, { manager: runner.manager });
    await setTenant(runner, tenantId);
    for (const dryRun of [true, false]) {
      const report = await run([company({ name: 'Kept', city: '', notes: 'Changed' })], dryRun);
      assert.equal(report.ok, false, `existing company, dryRun=${dryRun}: ${JSON.stringify(report.errors)}`);
      assert.deepEqual(report.errors, [{
        row: 2, column: 'city', code: 'CSV_VALUE_REQUIRED', message: 'city is required',
      }]);
    }
    const rows = await runner.query(`SELECT name, city, notes FROM companies WHERE tenant_id = $1`, [tenantId]);
    assert.deepEqual(rows, [{ name: 'Kept', city: 'Lyon', notes: null }], 'the stored city stays');
  });
}

/** Metrics for a frozen year are refused at the check; a row that does not set them still loads. */
async function testFrozenYearRefusedAtCheck() {
  await withCompanies('frozen', async (runner, tenantId, svc) => {
    const frozenYear = YEAR + 1;
    await runner.query(
      `INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, 'companies', '__all__', true)`,
      [tenantId, frozenYear],
    );
    await setTenant(runner, tenantId);
    const run = importer(runner, svc);
    const frozenRow = company({
      name: 'Frozen metrics',
      [`headcount_${frozenYear}`]: '12',
      [`it_users_${frozenYear}`]: '4',
      [`turnover_${frozenYear}`]: '3.5',
    });
    for (const dryRun of [true, false]) {
      const report = await run([frozenRow], dryRun);
      assert.equal(report.ok, false, `dryRun=${dryRun}: ${JSON.stringify(report.errors ?? report)}`);
      assert.deepEqual(report.errors, [{
        row: 2,
        message: `Metrics for ${frozenYear} are frozen. A budget administrator can unfreeze them.`,
        code: 'CSV_COMPANY_METRICS_FROZEN',
        params: { year: frozenYear },
      }]);
    }
    assert.deepEqual(await storedCities(runner, tenantId), [], 'the frozen row is not loaded');

    const openRow = company({
      name: 'Open year',
      [`headcount_${YEAR}`]: '8',
      [`turnover_${YEAR}`]: '1',
    });
    const preview = await run([openRow], true);
    assert.equal(preview.ok, true, JSON.stringify(preview.errors));
    assert.equal(preview.inserted, 1);
    const loaded = await run([openRow], false);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    const metrics = await runner.query(
      `SELECT c.name, m.fiscal_year, m.headcount FROM companies c
         LEFT JOIN company_metrics m ON m.company_id = c.id
        WHERE c.tenant_id = $1 ORDER BY c.name, m.fiscal_year`,
      [tenantId],
    );
    assert.deepEqual(metrics, [{ name: 'Open year', fiscal_year: YEAR, headcount: 8 }]);

    const untouched = await run([company({ name: 'No metrics' })], false);
    assert.equal(untouched.ok, true, JSON.stringify(untouched.errors));
    assert.equal(untouched.inserted, 1);
  });
}

/** Two rows with the same name, whatever the case, are refused at the check. The second used to be dropped. */
async function testDuplicateNameInFile() {
  await withCompanies('dup', async (runner, tenantId, svc) => {
    const run = importer(runner, svc);
    const rows = [
      company({ name: 'QA-Faute', city: 'Paris' }),
      company({ name: 'Other', city: 'Lyon' }),
      company({ name: 'qa-faute', city: 'Lyon' }),
    ];
    for (const dryRun of [true, false]) {
      const report = await run(rows, dryRun);
      assert.equal(report.ok, false, `dryRun=${dryRun}: ${JSON.stringify(report.errors)}`);
      assert.deepEqual(report.errors, [{
        row: 4,
        column: 'name',
        message: "'qa-faute' is already on row 2. Keep one row per company.",
        code: 'CSV_COMPANY_NAME_DUPLICATE',
        params: { name: 'qa-faute', firstRow: 2 },
      }]);
    }
    assert.deepEqual(await storedCities(runner, tenantId), [], 'nothing is written');
  });
}

/** Each year block is optional. A year missing from the file leaves stored metrics. A year outside the window is ignored. */
async function testOptionalYearColumns() {
  await withCompanies('years', async (runner, tenantId, svc) => {
    const run = importer(runner, svc);
    const bare = await run([company({ name: 'Bare' })], true, BASE_HEADERS);
    assert.equal(bare.ok, true, `no metric columns: ${JSON.stringify(bare.errors)}`);
    assert.equal(bare.inserted, 1);

    const oneYearHeaders = [...BASE_HEADERS, ...yearHeaders([YEAR])];
    const loaded = await run([company({
      name: 'One year',
      [`headcount_${YEAR}`]: '8',
      [`it_users_${YEAR}`]: '2',
      [`turnover_${YEAR}`]: '1.5',
    })], false, oneYearHeaders);
    assert.equal(loaded.ok, true, `one year: ${JSON.stringify(loaded.errors)}`);
    assert.equal(loaded.inserted, 1);
    const written = await runner.query(
      `SELECT m.fiscal_year, m.headcount, m.it_users
         FROM companies c JOIN company_metrics m ON m.company_id = c.id
        WHERE c.tenant_id = $1 AND c.name = 'One year'`,
      [tenantId],
    );
    assert.deepEqual(written, [{ fiscal_year: YEAR, headcount: 8, it_users: 2 }]);

    const again = await run([company({ name: 'One year', notes: 'Later' })], false, BASE_HEADERS);
    assert.equal(again.ok, true, `year absent on update: ${JSON.stringify(again.errors)}`);
    assert.equal(again.updated, 1);
    const still = await runner.query(
      `SELECT m.fiscal_year, m.headcount FROM companies c JOIN company_metrics m ON m.company_id = c.id
        WHERE c.tenant_id = $1 AND c.name = 'One year'`,
      [tenantId],
    );
    assert.deepEqual(still, [{ fiscal_year: YEAR, headcount: 8 }], 'an absent year leaves the stored metric');

    const extraHeaders = [...BASE_HEADERS, 'headcount_2031', 'turnover_2031'];
    const extra = await run([company({ name: 'Outside', headcount_2031: '9', turnover_2031: '3' })], true, extraHeaders);
    assert.equal(extra.ok, true, `outside window: ${JSON.stringify(extra.errors)}`);
    assert.deepEqual([...(extra.ignoredColumns ?? [])].sort(), ['headcount_2031', 'turnover_2031']);

    const partial = await run(
      [company({ name: 'Partial', [`headcount_${YEAR}`]: '1' })],
      true,
      [...BASE_HEADERS, `headcount_${YEAR}`],
    );
    assert.equal(partial.ok, false, 'a partial year block is refused');
    assert.equal(partial.errors[0]?.code, 'CSV_HEADER_MISSING_COLUMNS');
    assert.match(partial.errors[0]?.message ?? '', new RegExp(`it_users_${YEAR}`));
    assert.match(partial.errors[0]?.message ?? '', new RegExp(`turnover_${YEAR}`));

    const missingName = await run([company({ name: 'X' })], true, BASE_HEADERS.filter((header) => header !== 'name'));
    assert.equal(missingName.ok, false);
    assert.equal(missingName.errors[0]?.code, 'CSV_HEADER_MISSING_COLUMNS');
    assert.match(missingName.errors[0]?.message ?? '', /name/);
  });
}

void runSpecs('companies csv import', [
  ['a blank city is refused at the check, like the other required columns', testBlankCityRefused],
  ['metrics for a frozen year are refused at the check', testFrozenYearRefusedAtCheck],
  ['two rows with the same name are refused at the check', testDuplicateNameInFile],
  ['metric year columns are optional and a year outside the window is ignored', testOptionalYearColumns],
]);
