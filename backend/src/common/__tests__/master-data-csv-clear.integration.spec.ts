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

// The clearing rule of every import route (D21 of 26.11.9), in the six master-data imports with
// their own `importCsv`, called as their routes call them (`mode: 'enrich'`):
// - `-` (or `__CLEAR__`) clears an optional value of a stored record, and the result counts it
//   (`cleared`), the same at the check and at the load;
// - `-` on a value already empty changes nothing: the row is unchanged, the count 0;
// - a blank cell keeps the stored value;
// - `-` on a key, a required value, a status or an amount is a row error naming the column
//   (`CSV_VALUE_CANNOT_BE_CLEARED`), and nothing is written;
// - `-` on an optional value of a new record reads as a blank cell;
// - `-` in `disabled_at` clears the end of validity, as the screen empties it, and the record is
//   active again; with `disabled` in `status` it is the status contradiction; on a new record it
//   reads as a blank cell (T-I4d);
// - `-` on a year's headcount or turnover says to write 0 (`CSV_NUMBER_CANNOT_BE_CLEARED`);
// - suppliers: `-` in a contact column removes the links of that role (T-I4e);
// - accounts: a chart template still loads by replacing, `-` read as text.

type Report = {
  ok: boolean;
  inserted: number;
  updated: number;
  unchanged?: number;
  cleared?: number;
  errors: Array<{ row: number; column?: string; code?: string; message: string }>;
};
type Run = (lines: string[], dryRun?: boolean) => Promise<Report>;

const YEAR = new Date().getFullYear();
const REFUSED = 'CSV_VALUE_CANNOT_BE_CLEARED';
const NUMBER_REFUSED = 'CSV_NUMBER_CANNOT_BE_CLEARED';

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), originalname: 'import.csv' } as Express.Multer.File;
}

function codes(report: Report): string[] {
  return report.errors.map((error) => `${error.row}:${error.column ?? ''}:${error.code ?? error.message}`);
}

/** The check, then the load: both import, with the same counts `[inserted, updated, unchanged, cleared]`. */
async function load(run: Run, lines: string[], counts: [number, number, number, number], label: string) {
  for (const dryRun of [true, false]) {
    const report = await run(lines, dryRun);
    assert.equal(report.ok, true, `${label} (${dryRun ? 'check' : 'load'}): ${JSON.stringify(report.errors)}`);
    assert.deepEqual([report.inserted, report.updated, report.unchanged ?? 0, report.cleared], counts, `${label} (${dryRun ? 'check' : 'load'})`);
  }
}

/** The load refuses the file with these errors, and the record reads the same after it. */
async function refused(run: Run, lines: string[], expected: string[], read: () => Promise<unknown>, label: string) {
  const before = await read();
  const report = await run(lines, false);
  assert.equal(report.ok, false, label);
  assert.deepEqual(codes(report), expected, label);
  assert.deepEqual(await read(), before, `${label}: nothing written`);
}

/**
 * `-` in `disabled_at` on a stored record (T-I4d): it clears a past end of validity and the record
 * is active again, counted once; with `disabled` in `status` the row is refused as a status
 * contradiction; on a new record it is a blank cell. `key` and `create` are a header and its
 * cells naming the stored record and a new one; `lifecycle` reads a record's status and date.
 */
async function endOfValidityClears(
  run: Run,
  key: [string, string],
  create: [string, string],
  lifecycle: (created?: boolean) => Promise<{ status: string; disabled_at: Date | null }>,
) {
  await load(run, [`${key[0]};disabled_at`, `${key[1]};2020-01-15`], [0, 1, 0, 0], 'set a past end of validity');
  assert.equal((await lifecycle()).status, 'disabled');
  await refused(run, [`${key[0]};status;disabled_at`, `${key[1]};disabled;-`], ['2:status:CSV_STATUS_DATE_FUTURE'], lifecycle, 'disabled and `-`');
  await load(run, [`${key[0]};disabled_at`, `${key[1]};-`], [0, 1, 0, 1], 'clear the end of validity');
  assert.deepEqual(await lifecycle(), { status: 'enabled', disabled_at: null });
  await load(run, [`${key[0]};status;disabled_at`, `${key[1]};enabled;__CLEAR__`], [0, 0, 1, 0], '`-` on no end of validity');
  await load(run, [`${create[0]};disabled_at`, `${create[1]};-`], [1, 0, 0, 0], 'create with `-`');
  assert.deepEqual(await lifecycle(true), { status: 'enabled', disabled_at: null });
}

/** A record's status and end of validity, by name. */
function lifecycleOf(runner: QueryRunner, tenantId: string, table: string, name: string, createdName: string) {
  return async (created = false) => (await runner.query(
    `SELECT status::text AS status, disabled_at FROM ${table} WHERE tenant_id = $1 AND name = $2`,
    [tenantId, created ? createdName : name],
  ))[0];
}

async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Import clear', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `md-clear-${tag}-${tenantId.slice(0, 8)}`],
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

function contactsService(runner: QueryRunner) {
  return new ContactsService(
    runner.manager.getRepository(ExternalContact),
    runner.manager.getRepository(SupplierContactLink),
    runner.manager.getRepository(Supplier),
    undefined as any,
    undefined as any,
  );
}

async function testSuppliers() {
  await withTenant('sup', async (runner, tenantId) => {
    const contacts = contactsService(runner);
    const seeded = await contacts.importCsv(
      { file: file(['email;first_name', 'ann@example.test;Ann', 'bob@example.test;Bob']), dryRun: false, language: 'en', mode: 'enrich' },
      { manager: runner.manager, tenantId },
    );
    assert.equal(seeded.ok, true, JSON.stringify(seeded.errors));
    const svc = new SuppliersService(undefined as any, audit(runner));
    const run: Run = (lines, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, userId: null, language: 'en', mode: 'enrich' }, { manager: runner.manager }) as Promise<Report>;
    const read = async (name = 'Acme') => (await runner.query(
      `SELECT name, erp_supplier_id, notes, status::text AS status, item_number FROM suppliers WHERE tenant_id = $1 AND name = $2`,
      [tenantId, name],
    ))[0];
    const links = async () => (await runner.query(
      `SELECT l.role::text AS role, c.email FROM supplier_contacts l JOIN contacts c ON c.id = l.contact_id JOIN suppliers s ON s.id = l.supplier_id
        WHERE l.tenant_id = $1 AND s.name = 'Acme' ORDER BY 1, 2`,
      [tenantId],
    )).map((link: { role: string; email: string }) => `${link.role}:${link.email}`);

    await load(run, ['name;erp_supplier_id;notes;commercial_contact;technical_contact', 'Acme;ERP-1;Kept;ann@example.test;bob@example.test'], [1, 0, 0, 0], 'seed');
    assert.deepEqual(await links(), ['commercial:ann@example.test', 'technical:bob@example.test']);

    // `-` clears an optional value; a blank cell keeps one.
    await load(run, ['name;erp_supplier_id;notes', 'Acme;;-'], [0, 1, 0, 1], 'clear notes');
    assert.deepEqual([(await read()).erp_supplier_id, (await read()).notes], ['ERP-1', null]);
    await load(run, ['name;erp_supplier_id;notes', 'Acme;;-'], [0, 0, 1, 0], '`-` on an empty value');
    await load(run, ['name;notes', 'Acme;__CLEAR__'], [0, 0, 1, 0], '`__CLEAR__` on an empty value');

    // T-I4e: `-` in a contact column removes the links of that role; a blank cell keeps them.
    await load(run, ['name;commercial_contact;technical_contact', 'Acme;;'], [0, 0, 1, 0], 'blank contact cells');
    await load(run, ['name;commercial_contact;technical_contact', 'Acme;-;'], [0, 1, 0, 1], 'clear the commercial contacts');
    assert.deepEqual(await links(), ['technical:bob@example.test']);
    await load(run, ['name;commercial_contact', 'Acme;-'], [0, 0, 1, 0], 'no commercial contact left');
    await load(run, ['name;commercial_contact', 'Acme;ann@example.test'], [0, 1, 0, 0], 'a filled cell adds the link again');
    assert.deepEqual(await links(), ['commercial:ann@example.test', 'technical:bob@example.test']);

    // Keys, statuses and the end of validity cannot be cleared: named row errors, nothing written.
    const { item_number } = await read();
    await refused(run, ['name;notes', '-;x'], [`2:name:${REFUSED}`], read, 'name');
    await refused(run, ['reference;name;notes', `SUP-${item_number};-;x`], [`2:name:${REFUSED}`], read, 'name by reference');
    await refused(run, ['reference;notes', '-;x'], [`2:reference:${REFUSED}`], read, 'reference');
    await refused(run, ['name;status;notes', 'Acme;-;x'], [`2:status:${REFUSED}`], read, 'status');
    await endOfValidityClears(run, ['name', 'Acme'], ['name', 'Gamma'], lifecycleOf(runner, tenantId, 'suppliers', 'Acme', 'Gamma'));

    // A new supplier: `-` on an optional value is a blank cell, in a contact column too.
    await load(run, ['name;erp_supplier_id;notes;support_contact', 'Beta;-;__CLEAR__;-'], [1, 0, 0, 0], 'create');
    assert.deepEqual([(await read('Beta')).erp_supplier_id, (await read('Beta')).notes, (await read('Beta')).status], [null, null, 'enabled']);
  });
}

async function testContacts() {
  await withTenant('ctc', async (runner, tenantId) => {
    const svc = contactsService(runner);
    const run: Run = (lines, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, language: 'en', mode: 'enrich' }, { manager: runner.manager, tenantId }) as Promise<Report>;
    const read = async (email = 'ann@example.test') => (await runner.query(
      `SELECT first_name, last_name, job_title, email, phone, country, notes, active, item_number FROM contacts WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email],
    ))[0];
    await load(run, ['email;first_name;last_name;country;notes;active', 'ann@example.test;Ann;Lee;FR;Kept;no'], [1, 0, 0, 0], 'seed');

    await load(run, ['email;notes;last_name', 'ann@example.test;-;'], [0, 1, 0, 1], 'clear notes');
    let ann = await read();
    assert.deepEqual([ann.notes, ann.last_name, ann.country, ann.active], [null, 'Lee', 'FR', false]);
    await load(run, ['email;country', 'ann@example.test;-'], [0, 1, 0, 1], 'clear country');
    await load(run, ['email;notes;country;phone', 'ann@example.test;-;-;-'], [0, 0, 1, 0], '`-` on empty values');
    await load(run, ['email;first_name;last_name', 'ann@example.test;;'], [0, 0, 1, 0], 'blank cells');

    ann = await read();
    await refused(run, ['email;notes', '-;x'], [`2:email:${REFUSED}`], read, 'e-mail');
    await refused(run, ['reference;email;notes', `CTCT-${ann.item_number};-;x`], [`2:email:${REFUSED}`], read, 'e-mail by reference');
    await refused(run, ['email;active', 'ann@example.test;-'], [`2:active:${REFUSED}`], read, 'active');

    await load(run, ['email;first_name;notes;country', 'bob@example.test;Bob;-;__CLEAR__'], [1, 0, 0, 0], 'create');
    const bob = await read('bob@example.test');
    assert.deepEqual([bob.first_name, bob.notes, bob.country, bob.active], ['Bob', null, null, true]);
  });
}

async function testCompanies() {
  await withTenant('cmp', async (runner, tenantId) => {
    const a = audit(runner);
    const metrics = new CompanyMetricsService(runner.manager.getRepository(CompanyMetric), a, realFreeze());
    const svc = new CompaniesService(runner.manager.getRepository(Company), a, metrics);
    const run: Run = (lines, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, userId: null, year: YEAR, language: 'en', mode: 'enrich' }, { manager: runner.manager }) as Promise<Report>;
    const read = async (name = 'Acme SA') => (await runner.query(
      `SELECT c.name, c.city, c.address1, c.notes, c.status::text AS status, m.headcount, m.it_users, m.turnover::float AS turnover
         FROM companies c LEFT JOIN company_metrics m ON m.company_id = c.id AND m.fiscal_year = $1
        WHERE c.name = $2`,
      [YEAR, name],
    ))[0];
    const full = `name;country_iso;address1;city;base_currency;notes;headcount_${YEAR};it_users_${YEAR};turnover_${YEAR}`;
    await load(run, [full, 'Acme SA;FR;1 rue;Lyon;EUR;Kept;10;5;1.5'], [1, 0, 0, 0], 'seed');

    await load(run, ['name;notes;address1', 'Acme SA;-;'], [0, 1, 0, 1], 'clear notes');
    assert.deepEqual([(await read()).notes, (await read()).address1], [null, '1 rue']);
    await load(run, [`name;it_users_${YEAR}`, 'Acme SA;-'], [0, 1, 0, 1], 'clear the IT users of a year');
    assert.deepEqual([(await read()).headcount, (await read()).it_users, (await read()).turnover], [10, null, 1.5]);
    await load(run, [`name;notes;it_users_${YEAR}`, 'Acme SA;-;-'], [0, 0, 1, 0], '`-` on empty values');
    await load(run, [full, 'Acme SA;;;;;;;;'], [0, 0, 1, 0], 'blank cells');

    for (const column of ['name', 'city', 'country_iso', 'base_currency', 'status', `headcount_${YEAR}`, `turnover_${YEAR}`]) {
      const lines = column === 'name' ? ['name;notes', '-;x'] : [`name;${column};notes`, 'Acme SA;-;x'];
      await refused(run, lines, [`2:${column}:${/_\d{4}$/.test(column) ? NUMBER_REFUSED : REFUSED}`], read, column);
    }
    const refusal = await run([`name;turnover_${YEAR}`, 'Acme SA;-']);
    assert.match(refusal.errors[0].message, /Use 0 to set it to zero, or leave the cell empty to keep the stored value/);
    await endOfValidityClears(run, ['name', 'Acme SA'], ['name;country_iso;city;base_currency', 'Gamma SA;FR;Nice;EUR'], lifecycleOf(runner, tenantId, 'companies', 'Acme SA', 'Gamma SA'));

    // A new company: `-` on an optional value is a blank cell, and a year with only `-` holds no metric.
    await load(run, [`name;country_iso;city;base_currency;notes;address1;it_users_${YEAR}`, 'Beta SA;FR;Paris;EUR;-;-;-'], [1, 0, 0, 0], 'create');
    assert.deepEqual([(await read('Beta SA')).notes, (await read('Beta SA')).address1, (await read('Beta SA')).headcount], [null, null, null]);
  });
}

async function testDepartments() {
  await withTenant('dep', async (runner, tenantId) => {
    await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, 'Dept Co', 'FR', 'Lyon', 'EUR')`, [tenantId]);
    const svc = new DepartmentsService(undefined as any, undefined as any, audit(runner));
    const run: Run = (lines, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, userId: null, language: 'en', mode: 'enrich' }, { manager: runner.manager }) as Promise<Report>;
    const read = async (name = 'Finance') => (await runner.query(
      `SELECT name, description, status::text AS status, item_number FROM departments WHERE tenant_id = $1 AND name = $2`,
      [tenantId, name],
    ))[0];
    await load(run, ['company_name;name;description', 'Dept Co;Finance;Kept'], [1, 0, 0, 0], 'seed');
    const { item_number } = await read();

    await load(run, ['reference;description', `DEPT-${item_number};-`], [0, 1, 0, 1], 'clear the description');
    assert.equal((await read()).description, null);
    await load(run, ['company_name;name;description', 'Dept Co;Finance;-'], [0, 0, 1, 0], '`-` on an empty value');
    await load(run, ['company_name;name;description', 'Dept Co;Finance;Back'], [0, 1, 0, 0], 'refill');
    await load(run, ['company_name;name;description', 'Dept Co;Finance;'], [0, 0, 1, 0], 'blank cell');

    await refused(run, ['company_name;name;description', '-;Finance;x'], [`2:company_name:${REFUSED}`], read, 'company');
    await refused(run, ['reference;name;description', `DEPT-${item_number};-;x`], [`2:name:${REFUSED}`], read, 'name');
    await refused(run, ['reference;description', '-;x'], [`2:reference:${REFUSED}`], read, 'reference');
    await refused(run, ['company_name;name;status', 'Dept Co;Finance;-'], [`2:status:${REFUSED}`], read, 'status');
    await endOfValidityClears(run, ['company_name;name', 'Dept Co;Finance'], ['company_name;name', 'Dept Co;Audit'], lifecycleOf(runner, tenantId, 'departments', 'Finance', 'Audit'));

    await load(run, ['company_name;name;description', 'Dept Co;Legal;-'], [1, 0, 0, 0], 'create');
    assert.equal((await read('Legal')).description, null);
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
    const run: Run = (lines, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, userId: null, language: 'en', mode: 'enrich' }, { manager: runner.manager, targetCoaId: chart.id }) as Promise<Report>;
    // The chart's own route.
    const chartRun: Run = (lines, dryRun = false) =>
      charts.importAccountsCsv(chart.id, file(lines), dryRun, null, { manager: runner.manager, mode: 'enrich' }) as Promise<Report>;
    const read = async (number = 6000) => (await runner.query(
      `SELECT account_name, native_name, description, consolidation_account_number, status::text AS status, nature FROM accounts WHERE tenant_id = $1 AND account_number = $2`,
      [tenantId, number],
    ))[0];
    await load(run, ['account_number;account_name;native_name;description;nature;consolidation_account_number', '6000;Supplies;Fournitures;Kept;opex;60'], [1, 0, 0, 0], 'seed');

    await load(run, ['account_number;description;native_name', '6000;-;'], [0, 1, 0, 1], 'clear the description');
    assert.deepEqual([(await read()).description, (await read()).native_name], [null, 'Fournitures']);
    await load(chartRun, ['account_number;nature;consolidation_account_number', '6000;-;-'], [0, 1, 0, 2], 'clear nature and consolidation, chart route');
    assert.deepEqual([(await read()).nature, (await read()).consolidation_account_number], [null, null]);
    await load(run, ['account_number;description;nature', '6000;-;-'], [0, 0, 1, 0], '`-` on empty values');
    await load(run, ['account_number;account_name;native_name', '6000;;'], [0, 0, 1, 0], 'blank cells');

    await refused(run, ['account_number;account_name', '6000;-'], [`2:account_name:${REFUSED}`], read, 'name');
    await refused(chartRun, ['account_number;status', '6000;-'], [`2:status:${REFUSED}`], read, 'status, chart route');
    await refused(run, ['account_number;description', '-;x'], [`2:account_number:${REFUSED}`], read, 'number');

    await load(run, ['account_number;account_name;description;nature', '7000;Other;-;-'], [1, 0, 0, 0], 'create');
    assert.deepEqual([(await read(7000)).description, (await read(7000)).nature], [null, null]);

    // A chart template loads by replacing, as it always has: `-` is text there.
    const [template] = await runner.query(
      `INSERT INTO coa_templates (template_code, template_name, version, csv_payload)
       VALUES ($1, 'Clear spec', '1', $2) RETURNING id`,
      [`CLEAR-${tenantId.slice(0, 8)}`, 'account_number;account_name;description\n6000;Supplies;-\n'],
    );
    const loaded: any = await charts.loadTemplateIntoCoa(chart.id, template.id, { dryRun: false, userId: null }, { manager: runner.manager });
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.equal((await read()).description, '-');
  });
}

async function testAnalyticsValues() {
  await withTenant('ana', async (runner, tenantId) => {
    const a = audit(runner);
    const svc = new AnalyticsCategoriesCsvService(new AnalyticsCategoriesService(runner.manager.getRepository(AnalyticsCategory), a));
    const ctx = { manager: runner.manager, tenantId, userId: null };
    const run: Run = (lines, dryRun = false) =>
      svc.importCsv({ file: file(lines), dryRun, language: 'en', mode: 'enrich' }, ctx) as Promise<Report>;
    const read = async (name = 'Cloud') => (await runner.query(
      `SELECT name, description, applies_to, status::text AS status FROM analytics_categories WHERE tenant_id = $1 AND name = $2`,
      [tenantId, name],
    ))[0];
    await load(run, ['axis_code;name;description;applies_to', ';Cloud;Kept;opex'], [1, 0, 0, 0], 'seed');

    await load(run, ['name;description;applies_to', 'Cloud;-;'], [0, 1, 0, 1], 'clear the description');
    assert.deepEqual([(await read()).description, (await read()).applies_to], [null, 'opex']);
    await load(run, ['name;applies_to', 'Cloud;-'], [0, 1, 0, 1], 'clear applies_to');
    await load(run, ['name;description;applies_to', 'Cloud;-;-'], [0, 0, 1, 0], '`-` on empty values');
    await load(run, ['name;description', 'Cloud;'], [0, 0, 1, 0], 'blank cell');

    await refused(run, ['name;description', '-;x'], [`2:name:${REFUSED}`], read, 'name');
    await refused(run, ['axis_code;name;description', '-;Cloud;x'], [`2:axis_code:${REFUSED}`], read, 'dimension');
    await refused(run, ['name;status', 'Cloud;-'], [`2:status:${REFUSED}`], read, 'status');
    await endOfValidityClears(run, ['name', 'Cloud'], ['name', 'Fog'], lifecycleOf(runner, tenantId, 'analytics_categories', 'Cloud', 'Fog'));

    await load(run, ['name;description;applies_to', 'Edge;-;-'], [1, 0, 0, 0], 'create');
    assert.deepEqual([(await read('Edge')).description, (await read('Edge')).applies_to], [null, null]);
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
    if (failures.length > 0) throw new Error(`master-data-csv-clear: ${failures.join(', ')} failed`);
    console.log('master-data-csv-clear: OK');
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
