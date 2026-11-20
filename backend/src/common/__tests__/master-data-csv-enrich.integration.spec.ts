import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { Supplier } from '../../suppliers/supplier.entity';
import { ContactsService } from '../../contacts/contacts.service';
import { ExternalContact } from '../../contacts/external-contact.entity';
import { SupplierContactLink } from '../../contacts/supplier-contact.entity';
import { CompaniesService } from '../../companies/companies.service';
import { Company } from '../../companies/company.entity';
import { CompanyMetric } from '../../companies/company-metric.entity';
import { CompanyMetricsService } from '../../companies/company-metrics.service';
import { DepartmentsService } from '../../departments/departments.service';
import { AccountsService } from '../../accounts/accounts.service';
import { ChartOfAccountsService } from '../../accounts/chart-of-accounts.service';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { AnalyticsCategoriesCsvService } from '../../analytics/analytics-categories-csv.service';
import { AnalyticsCategory } from '../../analytics/analytics-category.entity';
import { realFreeze } from '../../spend/__tests__/round-inputs.fixtures';
import { CsvImportMode } from '../csv-sheet';

// "Complete" and "replace" for the master-data imports that have their own `importCsv` (lot I4
// of 26.11.9): suppliers, contacts, companies, departments, accounts and dimension values.
// - `enrich`: on a stored record a blank cell keeps the stored value, the status included;
// - `replace`: a blank cell clears it, as these imports always did (a blank status enables);
// - in both modes a column the file leaves out is never written, and the file needs only the
//   columns a row finds or creates its record by;
// - a new record still needs every required value;
// - a row whose filled cells equal the stored record counts as unchanged;
// - a service called without a mode replaces (Kad, the chart templates); every route completes, and
//   reads `-` as a clear (master-data-csv-clear.integration.spec.ts).

type Report = { ok: boolean; inserted: number; updated: number; unchanged?: number; errors: Array<{ row: number; column?: string; code?: string; message: string }> };

const YEAR = new Date().getFullYear();

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), originalname: 'import.csv' } as Express.Multer.File;
}

function codes(report: Report): string[] {
  return report.errors.map((error) => `${error.row}:${error.column ?? ''}:${error.code ?? error.message}`);
}

function assertLoaded(report: Report, counts: [number, number, number], label: string) {
  assert.equal(report.ok, true, `${label}: ${JSON.stringify(report.errors)}`);
  assert.deepEqual([report.inserted, report.updated, report.unchanged ?? 0], counts, label);
}

async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Import modes', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `md-enrich-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function audit(runner: QueryRunner) {
  return new AuditService(runner.manager.getRepository(AuditLog));
}

async function testSuppliers() {
  await withTenant('sup', async (runner) => {
    const svc = new SuppliersService(undefined as any, audit(runner));
    const run = (lines: string[], mode?: CsvImportMode, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, userId: null, language: 'en', mode }, { manager: runner.manager }) as Promise<Report>;
    const read = async () => (await runner.query(
      `SELECT name, erp_supplier_id, notes, status::text AS status, item_number FROM suppliers WHERE lower(name) = 'acme'`,
    ))[0];
    const full = 'name;erp_supplier_id;commercial_contact;technical_contact;support_contact;notes;status;disabled_at';
    assertLoaded(await run([full, 'Acme;ERP-1;;;;Kept notes;disabled;']), [1, 0, 0], 'seed');

    // Two columns: the others are never touched, in either mode.
    assertLoaded(await run(['name;notes', 'Acme;New notes'], 'enrich'), [0, 1, 0], 'two columns, enrich');
    assert.deepEqual(await read(), { ...(await read()), erp_supplier_id: 'ERP-1', notes: 'New notes', status: 'disabled' });
    assertLoaded(await run(['name;erp_supplier_id', 'Acme;ERP-2'], 'replace'), [0, 1, 0], 'two columns, replace');
    assert.deepEqual(await read(), { ...(await read()), erp_supplier_id: 'ERP-2', notes: 'New notes', status: 'disabled' });

    // Blank cells: kept and unchanged when completing (the status included), cleared when replacing.
    assertLoaded(await run([full, 'Acme;;;;;;;'], 'enrich'), [0, 0, 1], 'blank cells, enrich');
    assert.deepEqual(await read(), { ...(await read()), erp_supplier_id: 'ERP-2', notes: 'New notes', status: 'disabled' });
    // A filled reference with a blank name keeps the name when completing.
    const { item_number } = await read();
    assertLoaded(await run(['reference;name;notes', `SUP-${item_number};;Ref notes`], 'enrich'), [0, 1, 0], 'reference, blank name');
    assert.equal((await read()).name, 'Acme');
    assertLoaded(await run([full, 'Acme;;;;;;;'], 'replace'), [0, 1, 0], 'blank cells, replace');
    assert.deepEqual(await read(), { ...(await read()), erp_supplier_id: null, notes: null, status: 'enabled' });

    // A new supplier needs its name, in both modes.
    for (const mode of ['enrich', 'replace'] as const) {
      const refused = await run(['reference;notes', ';Orphan notes'], mode, true);
      assert.equal(refused.ok, false);
      assert.deepEqual(codes(refused), ['2:name:CSV_VALUE_REQUIRED'], mode);
    }
    // The file must carry a column a row finds its supplier by.
    const header = await run(['notes', 'x'], 'enrich', true);
    assert.equal(header.errors[0]?.code, 'CSV_HEADER_MISSING_COLUMNS');

    // Without a mode the service replaces, as Kad calls it.
    assertLoaded(await run(['name;notes', 'Acme;Again']), [0, 1, 0], 'seed notes');
    assertLoaded(await run(['name;notes', 'Acme;']), [0, 1, 0], 'no mode');
    assert.equal((await read()).notes, null);
  });
}

async function testContacts() {
  await withTenant('ctc', async (runner, tenantId) => {
    const svc = new ContactsService(
      runner.manager.getRepository(ExternalContact),
      runner.manager.getRepository(SupplierContactLink),
      runner.manager.getRepository(Supplier),
      undefined as any,
      // Each contact the import writes has its history row.
      new AuditService(runner.manager.getRepository(AuditLog)),
    );
    const run = (lines: string[], mode?: CsvImportMode, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, language: 'en', mode }, { manager: runner.manager, tenantId }) as Promise<Report>;
    const read = async () => (await runner.query(
      `SELECT first_name, last_name, job_title, email, phone, country, notes, active, item_number FROM contacts WHERE tenant_id = $1 AND first_name = 'Ann'`,
      [tenantId],
    ))[0];
    const full = 'first_name;last_name;job_title;email;phone;mobile;country;notes;active';
    assertLoaded(await run([full, 'Ann;Lee;CTO;ann@example.test;+33 1;;FR;Kept;no']), [1, 0, 0], 'seed');

    assertLoaded(await run(['email;job_title', 'ann@example.test;CEO'], 'enrich'), [0, 1, 0], 'two columns, enrich');
    let ann = await read();
    assert.deepEqual([ann.last_name, ann.job_title, ann.phone, ann.notes, ann.active], ['Lee', 'CEO', '+33 1', 'Kept', false]);

    assertLoaded(await run([full, ';;;ann@example.test;;;;;'], 'enrich'), [0, 0, 1], 'blank cells, enrich');
    assertLoaded(await run(['reference;email;notes', `CTCT-${ann.item_number};;By reference`], 'enrich'), [0, 1, 0], 'reference, blank e-mail');
    ann = await read();
    assert.deepEqual([ann.email, ann.notes, ann.active], ['ann@example.test', 'By reference', false]);
    assertLoaded(await run([full, 'Ann;;;ann@example.test;;;;;'], 'replace'), [0, 1, 0], 'blank cells, replace');
    ann = await read();
    assert.deepEqual([ann.last_name, ann.job_title, ann.phone, ann.notes, ann.active], [null, null, null, null, true]);

    for (const mode of ['enrich', 'replace'] as const) {
      const refused = await run(['reference;first_name', ';Bob'], mode, true);
      assert.deepEqual(codes(refused), ['2:email:CSV_VALUE_REQUIRED'], mode);
    }
  });
}

async function testCompanies() {
  await withTenant('cmp', async (runner) => {
    const a = audit(runner);
    const metrics = new CompanyMetricsService(runner.manager.getRepository(CompanyMetric), a, realFreeze());
    const svc = new CompaniesService(runner.manager.getRepository(Company), a, metrics);
    const run = (lines: string[], mode?: CsvImportMode, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, userId: null, year: YEAR, language: 'en', mode }, { manager: runner.manager }) as Promise<Report>;
    const read = async () => (await runner.query(
      `SELECT c.name, c.city, c.country_iso, c.address1, c.base_currency, c.notes, c.status::text AS status,
              m.headcount, m.it_users, m.turnover::float AS turnover
         FROM companies c LEFT JOIN company_metrics m ON m.company_id = c.id AND m.fiscal_year = $1
        WHERE c.name = 'Acme SA'`,
      [YEAR],
    ))[0];
    const full = `name;country_iso;address1;city;base_currency;status;notes;headcount_${YEAR};it_users_${YEAR};turnover_${YEAR}`;
    assertLoaded(await run([full, 'Acme SA;FR;1 rue;Lyon;EUR;disabled;Kept;10;5;1.5']), [1, 0, 0], 'seed');

    assertLoaded(await run(['name;notes', 'Acme SA;New notes'], 'enrich'), [0, 1, 0], 'two columns, enrich');
    assert.deepEqual(await read(), {
      name: 'Acme SA', city: 'Lyon', country_iso: 'FR', address1: '1 rue', base_currency: 'EUR', notes: 'New notes', status: 'disabled',
      headcount: 10, it_users: 5, turnover: 1.5,
    });
    // One metric column of a year: the other two stay, in both modes.
    assertLoaded(await run([`name;headcount_${YEAR}`, 'Acme SA;12'], 'replace'), [0, 1, 0], 'one metric column');
    assert.deepEqual(Object.values(await read()).slice(-3), [12, 5, 1.5]);

    assertLoaded(await run([full, `Acme SA;;;;;;;;;`], 'enrich'), [0, 0, 1], 'blank cells, enrich');
    assertLoaded(await run([full, `Acme SA;;;;;;;14;;`], 'enrich'), [0, 1, 0], 'blank metric cells, enrich');
    assert.deepEqual(Object.values(await read()).slice(-3), [14, 5, 1.5]);
    assertLoaded(await run([full, `Acme SA;FR;;Lyon;EUR;;;14;;`], 'replace'), [0, 1, 0], 'blank cells, replace');
    const replaced = await read();
    assert.deepEqual([replaced.address1, replaced.notes, replaced.status, replaced.it_users, replaced.turnover], [null, null, 'disabled', null, null]);
    // Replacing still refuses a blank city or headcount, which cannot be empty; completing keeps them.
    assert.deepEqual(codes(await run([full, 'Acme SA;FR;;;EUR;;;;;'], 'replace', true)), ['2:city:CSV_VALUE_REQUIRED']);
    assert.deepEqual(codes(await run([full, 'Acme SA;FR;;Lyon;EUR;;;;7;'], 'replace', true)), [`2:headcount_${YEAR}:CSV_VALUE_REQUIRED`]);
    assertLoaded(await run([full, 'Acme SA;;;;;;;;7;'], 'enrich', true), [0, 1, 0], 'blank headcount, enrich');

    // City, country and currency are required for a new company only.
    for (const mode of ['enrich', 'replace'] as const) {
      const refused = await run(['name;notes', 'Beta SA;x'], mode, true);
      assert.deepEqual(codes(refused).sort(), ['2:base_currency:CSV_VALUE_REQUIRED', '2:city:CSV_VALUE_REQUIRED', '2:country_iso:CSV_VALUE_REQUIRED'], mode);
      const blank = await run([full, 'Beta SA;FR;;;EUR;;;;;'], mode, true);
      assert.deepEqual(codes(blank), ['2:city:CSV_VALUE_REQUIRED'], mode);
      const noHeadcount = await run([full, `Beta SA;FR;;Paris;EUR;;;;3;`], mode, true);
      assert.deepEqual(codes(noHeadcount), [`2:headcount_${YEAR}:CSV_VALUE_REQUIRED`], mode);
    }
  });
}

async function testDepartments() {
  await withTenant('dep', async (runner, tenantId) => {
    await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, 'Dept Co', 'FR', 'Lyon', 'EUR')`, [tenantId]);
    const svc = new DepartmentsService(undefined as any, undefined as any, audit(runner));
    const run = (lines: string[], mode?: CsvImportMode, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, userId: null, language: 'en', mode }, { manager: runner.manager }) as Promise<Report>;
    const read = async () => (await runner.query(
      `SELECT d.name, d.description, d.status::text AS status, d.item_number, c.name AS company FROM departments d JOIN companies c ON c.id = d.company_id WHERE d.tenant_id = $1`,
      [tenantId],
    ))[0];
    const full = 'company_name;name;description;status;disabled_at';
    assertLoaded(await run([full, 'Dept Co;Finance;Kept;disabled;']), [1, 0, 0], 'seed');
    const { item_number } = await read();

    assertLoaded(await run(['reference;description', `DEPT-${item_number};New`], 'enrich'), [0, 1, 0], 'two columns, enrich');
    assert.deepEqual(await read(), { name: 'Finance', description: 'New', status: 'disabled', item_number, company: 'Dept Co' });
    assertLoaded(await run([`reference;${full}`, `DEPT-${item_number};;;;;`], 'enrich'), [0, 0, 1], 'blank cells by reference, enrich');
    assertLoaded(await run([full, 'Dept Co;Finance;;;'], 'enrich'), [0, 0, 1], 'blank cells, enrich');
    assertLoaded(await run([full, 'Dept Co;Finance;;;'], 'replace'), [0, 1, 0], 'blank cells, replace');
    assert.equal((await read()).description, null);

    for (const mode of ['enrich', 'replace'] as const) {
      assert.deepEqual(codes(await run(['company_name;name', ';Legal'], mode, true)), ['2:company_name:CSV_VALUE_REQUIRED'], mode);
    }
  });
}

async function testAccounts() {
  await withTenant('acc', async (runner, tenantId) => {
    const [chart] = await runner.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'FR-PCG', 'Plan', 'FR') RETURNING id`,
      [tenantId],
    );
    const a = audit(runner);
    const svc = new AccountsService(undefined as any, a);
    const charts = new ChartOfAccountsService(undefined as any, undefined as any, undefined as any, a, svc);
    const run = (lines: string[], mode?: CsvImportMode, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, userId: null, language: 'en', mode }, { manager: runner.manager, targetCoaId: chart.id }) as Promise<Report>;
    const read = async () => (await runner.query(
      `SELECT account_name, native_name, description, status::text AS status, nature FROM accounts WHERE tenant_id = $1 AND account_number = 6000`,
      [tenantId],
    ))[0];
    const full = 'account_number;account_name;native_name;description;status;nature';
    assertLoaded(await run([full, '6000;Supplies;Fournitures;Kept;disabled;opex']), [1, 0, 0], 'seed');

    assertLoaded(await run(['account_number;description', '6000;New'], 'enrich'), [0, 1, 0], 'two columns, enrich');
    assert.deepEqual(await read(), { account_name: 'Supplies', native_name: 'Fournitures', description: 'New', status: 'disabled', nature: 'opex' });
    assertLoaded(await run([full, '6000;;;;;'], 'enrich'), [0, 0, 1], 'blank cells, enrich');
    assertLoaded(await run([full, '6000;Supplies;;;;'], 'replace'), [0, 1, 0], 'blank cells, replace');
    assert.deepEqual(await read(), { account_name: 'Supplies', native_name: null, description: null, status: 'enabled', nature: null });
    assert.deepEqual(codes(await run([full, '6000;;;;;'], 'replace', true)), ['2::CSV_ACCOUNT_NAME_REQUIRED']);

    for (const mode of ['enrich', 'replace'] as const) {
      assert.deepEqual(codes(await run(['account_number;description', '7000;x'], mode, true)), ['2::CSV_ACCOUNT_NAME_REQUIRED'], mode);
    }

    // The chart's own route passes the mode on.
    assertLoaded(await run(['account_number;description', '6000;Chart']), [0, 1, 0], 'seed description');
    const chartRun: any = await charts.importAccountsCsv(chart.id, file(['account_number;description', '6000;']), false, null, { manager: runner.manager, mode: 'enrich' });
    assertLoaded(chartRun, [0, 0, 1], 'chart route, enrich');

    // Loading a chart template replaces, as it always has: a blank cell clears, a blank status enables.
    await runner.query(`UPDATE accounts SET status = 'disabled', disabled_at = now() WHERE tenant_id = $1 AND account_number = 6000`, [tenantId]);
    const [template] = await runner.query(
      `INSERT INTO coa_templates (template_code, template_name, version, csv_payload)
       VALUES ($1, 'Enrich spec', '1', $2) RETURNING id`,
      [`ENRICH-${tenantId.slice(0, 8)}`, 'account_number;account_name;description;status\n6000;Supplies;;\n'],
    );
    const loaded: any = await charts.loadTemplateIntoCoa(chart.id, template.id, { dryRun: false, userId: null }, { manager: runner.manager });
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.deepEqual(await read(), { account_name: 'Supplies', native_name: null, description: null, status: 'enabled', nature: null });
  });
}

async function testAnalyticsValues() {
  await withTenant('ana', async (runner, tenantId) => {
    const a = audit(runner);
    const svc = new AnalyticsCategoriesCsvService(new AnalyticsCategoriesService(runner.manager.getRepository(AnalyticsCategory), a));
    const ctx = { manager: runner.manager, tenantId, userId: null };
    const run = (lines: string[], mode?: CsvImportMode, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, language: 'en', mode }, ctx) as Promise<Report>;
    const read = async () => (await runner.query(
      `SELECT name, description, applies_to, status::text AS status FROM analytics_categories WHERE tenant_id = $1 AND name = 'Cloud'`,
      [tenantId],
    ))[0];
    const full = 'axis_code;name;description;applies_to;status';
    assertLoaded(await run([full, ';Cloud;Kept;opex;disabled']), [1, 0, 0], 'seed');

    assertLoaded(await run(['name;description', 'Cloud;New'], 'replace'), [0, 1, 0], 'two columns, replace');
    assert.deepEqual(await read(), { name: 'Cloud', description: 'New', applies_to: 'opex', status: 'disabled' });
    // A blank dimension code names the default dimension: a key, not a kept value.
    assertLoaded(await run([full, ';Cloud;;;'], 'enrich'), [0, 0, 1], 'blank cells, enrich');
    assertLoaded(await run([full, ';Cloud;;;'], 'replace'), [0, 1, 0], 'blank cells, replace');
    assert.deepEqual(await read(), { name: 'Cloud', description: null, applies_to: null, status: 'disabled' });

    for (const mode of ['enrich', 'replace'] as const) {
      assert.deepEqual(codes(await run(['name;description', ';x'], mode, true)), ['2:name:CSV_VALUE_REQUIRED'], mode);
    }
  });
}

async function main() {
  try {
    await dataSource.initialize();
    // Every family runs, so a failure in one does not hide the others.
    const failures: string[] = [];
    const tests = { testSuppliers, testContacts, testCompanies, testDepartments, testAccounts, testAnalyticsValues };
    for (const [name, test] of Object.entries(tests)) {
      try {
        await test();
      } catch (err) {
        failures.push(name);
        console.error(`${name} failed:`, err);
      }
    }
    if (failures.length > 0) throw new Error(`master-data-csv-enrich: ${failures.join(', ')} failed`);
    console.log('master-data-csv-enrich: OK');
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
