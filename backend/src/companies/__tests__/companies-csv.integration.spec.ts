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

void runSpecs('companies csv import', [
  ['a blank city is refused at the check, like the other required columns', testBlankCityRefused],
]);
