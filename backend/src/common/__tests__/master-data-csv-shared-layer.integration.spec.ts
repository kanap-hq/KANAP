import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Company } from '../../companies/company.entity';
import { CompaniesService } from '../../companies/companies.service';
import { Department } from '../../departments/department.entity';
import { DepartmentsService } from '../../departments/departments.service';
import { Role } from '../../roles/role.entity';
import { RolePermission } from '../../permissions/role-permission.entity';
import { RolesService } from '../../roles/roles.service';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { AccountsService } from '../../accounts/accounts.service';
import { CostCentersService } from '../../cost-centers/cost-centers.service';
import { CostCentersCsvService } from '../../cost-centers/cost-centers-csv.service';
import { AnalyticsCategory } from '../../analytics/analytics-category.entity';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { AnalyticsCategoriesCsvService } from '../../analytics/analytics-categories-csv.service';
import {
  CALENDAR_MONTH_HEADERS,
  WorkingDayProfilesCsvService,
} from '../../working-day-profiles/working-day-profiles-csv.service';
import { WorkingDayProfilesService } from '../../working-day-profiles/working-day-profiles.service';
import { CsvLanguage } from '../csv-sheet';

// The eight master-data files (companies, departments, users, suppliers,
// accounts, cost centers, analytics values, calendars) all read through
// `readMasterDataFile` and write through `writeCsv`. This spec is the table of
// what that shared layer promises them:
//
//  - a French export (BOM, `;`, day-first dates) reads back on an English
//    screen: the file's own evidence settles the date order, and only a file
//    with no evidence at all falls back to the screen's language, with a
//    notice;
//  - both separators load, and a Windows-1252 file keeps its accents;
//  - a local `31/12/2027` under day-first is the day it spells, stored at noon
//    UTC;
//  - row errors name the physical line, so a quoted cell spanning two lines
//    shifts the next row to line 4;
//  - a French round trip changes nothing;
//  - an extra cell and an unreadable file are refused;
//  - the accounts file's optional `nature` column: absent, it leaves the
//    stored natures alone; an invalid value is a row error.
//
// Every case runs inside one transaction, rolled back at the end, like
// `master-data-csv-lifecycle.integration.spec.ts`.

const COMPANY = 'Shared layer company';
const DEPARTMENT = 'Shared layer department';
const ROLE = 'Shared layer role';
/** A day above 12: the file itself then settles day-first, on every screen. */
const SETTLED_DAY = '2031-12-31';
const AMBIGUOUS = '01/03/2027';
const MONTH_FIRST_NOTICE = 'Dates read month first: 01/03/2027 is January 3.';
const DAY_FIRST_NOTICE = 'Dates read day first: 01/03/2027 is March 1.';
const EXTRA_CELLS = 'This row has more cells than the header.';

type Result = {
  ok: boolean;
  errors: Array<{ row: number; message: string }>;
  ignoredColumns: string[];
  notices: { dates: string | null; amounts: string | null };
};

type ImportOptions = { dryRun?: boolean; language?: CsvLanguage };

type Row = Record<string, string>;

type Importer = {
  label: string;
  table: string;
  /** The column a case uses to find the row it wrote. */
  nameColumn: string;
  /** The column read as a date, or null when the file carries none. */
  dateField: string | null;
  /** The free-text cell: the Windows-1252 accent and the quoted newline go here. */
  text: { header: string; column: string; accented: string };
  /** The column that takes a line break: some names refuse control characters, their description does not. */
  wrapped: string;
  /** The value the row's name column takes: the users file names a user by email. */
  key(label: string): string;
  headers(language?: CsvLanguage): Promise<string[]>;
  base(key: string): Row;
  /** Two meaningful rows for the round trip (distinct codes and numbers). */
  samples(): Row[];
  /** A row this importer must refuse, to place an error on a known line. */
  broken(key: string): Row;
  brokenMessage: RegExp;
  importCsv(content: string | Buffer, options?: ImportOptions): Promise<Result>;
  exportCsv(language?: CsvLanguage): Promise<string>;
  /** The tenant's rows in the meaningful columns only (never `updated_at`). */
  snapshot(runner: QueryRunner, tenantId: string): Promise<Array<Record<string, any>>>;
};

type Seeds = { companyId: string; departmentId: string; coaId: string; axisId: string };

/** The separator the writer picks for a language: English uses `,`, the others `;`. */
const separatorOf = (language: CsvLanguage = 'en') => (language === 'en' ? ',' : ';');

/** A code from a row key, in the shape the cost-center and calendar files demand. */
const codeOf = (prefix: string, key: string) => `${prefix}-${key.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

const calendarMonths = (value: string) => Object.fromEntries(CALENDAR_MONTH_HEADERS.map((month) => [month, value]));

/** One cell as a spreadsheet writes it: quoted when it holds the separator, a quote or a line break. */
function csvCell(value: string, separator: string): string {
  if (value.includes('"') || value.includes(separator) || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** One file: the importer's own headers, then the rows, cells matched by header. */
async function fileFor(
  importer: Importer,
  rows: readonly Row[],
  options: { separator?: string; language?: CsvLanguage; bom?: boolean } = {},
): Promise<string> {
  const headers = await importer.headers(options.language);
  const separator = options.separator ?? separatorOf(options.language);
  const lines = [
    headers.join(separator),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? '', separator)).join(separator)),
  ];
  return `${options.bom ? '\uFEFF' : ''}${lines.join('\n')}\n`;
}

/** The bytes of a text whose `é` is written the Windows-1252 way (0xE9), with no BOM. */
function windows1252(text: string): Buffer {
  const parts: Buffer[] = [];
  text.split('é').forEach((part, index) => {
    if (index > 0) parts.push(Buffer.from([0xe9]));
    parts.push(Buffer.from(part, 'latin1'));
  });
  return Buffer.concat(parts);
}

const headersOf = (content: string, language: CsvLanguage = 'en') =>
  content.replace(/^\uFEFF/, '').split('\n')[0].split(separatorOf(language));

function auditService(manager: EntityManager) {
  return new AuditService(manager.getRepository(AuditLog));
}

/**
 * The eight importers, built on the transaction's manager the way the
 * lifecycle spec builds its four. Each entry owns the cells its file needs and
 * the SQL that reads back what the shared layer stored.
 */
function importers(manager: EntityManager, tenantId: string, seeds: Seeds): Importer[] {
  const audit = auditService(manager);
  const ctx = { manager, tenantId, userId: null };
  const upload = (content: string | Buffer): Express.Multer.File =>
    ({ buffer: typeof content === 'string' ? Buffer.from(content, 'utf8') : content }) as Express.Multer.File;

  // No metrics in these files: the companies export reads none.
  const companies = new CompaniesService(undefined as any, audit, { list: async () => ({ items: [] }) } as any);
  const companyBase = (key: string): Row => ({
    name: key,
    country_iso: 'FR',
    city: 'Lyon',
    base_currency: 'EUR',
    notes: 'Shared layer note',
  });

  const departments = new DepartmentsService(undefined as any, undefined as any, audit);
  const departmentBase = (key: string): Row => ({
    company_name: COMPANY,
    name: key,
    description: 'Shared layer department',
  });

  const users = new UsersService(
    manager.getRepository(User),
    manager.getRepository(Company),
    manager.getRepository(Department),
    new RolesService(manager.getRepository(Role), manager.getRepository(RolePermission)),
    undefined as any,
    undefined as any,
    audit,
  );
  const userBase = (key: string): Row => ({
    email: key,
    first_name: 'Shared',
    last_name: 'Layer',
    role: ROLE,
    company_name: COMPANY,
    department_name: DEPARTMENT,
    status: 'enabled',
  });

  const suppliers = new SuppliersService(undefined as any, audit);
  const supplierBase = (key: string, index = 0): Row => ({
    name: key,
    erp_supplier_id: `ERP-${index + 1}`,
    notes: 'Shared layer note',
  });

  const accounts = new AccountsService(undefined as any, audit);
  const accountBase = (key: string, index = 0): Row => ({
    account_number: String(6100 + index),
    account_name: key,
    native_name: 'Fournisseurs',
    description: 'Shared layer account',
    consolidation_account_number: '4000',
    consolidation_account_name: 'Consolidated',
    consolidation_account_description: 'Shared layer consolidation',
  });

  const costCenters = new CostCentersCsvService(new CostCentersService(audit));
  const costCenterBase = (key: string): Row => ({
    code: codeOf('CC', key),
    kind: 'group',
    name: key,
    description: 'Shared layer cost center',
  });

  const analytics = new AnalyticsCategoriesCsvService(
    new AnalyticsCategoriesService(manager.getRepository(AnalyticsCategory), audit),
  );
  const analyticsBase = (key: string): Row => ({
    axis_code: 'nature',
    name: key,
    description: 'Shared layer value',
  });

  const calendars = new WorkingDayProfilesCsvService(new WorkingDayProfilesService(audit));
  const calendarBase = (key: string): Row => ({
    code: codeOf('CAL', key),
    name: key,
    description: 'Shared layer calendar',
    ...calendarMonths('20'),
    year: '2026',
  });

  return [
    {
      label: 'companies',
      table: 'companies',
      nameColumn: 'name',
      dateField: 'disabled_at',
      text: { header: 'name', column: 'name', accented: 'Café Léman' },
      wrapped: 'name',
      key: (label) => label,
      headers: async (language) => headersOf((await companies.exportCsv('template', { manager, language })).content, language),
      base: companyBase,
      samples: () => [
        { ...companyBase('Round trip company A'), status: 'enabled' },
        { ...companyBase('Round trip company B'), status: 'disabled', disabled_at: '2020-03-31' },
      ],
      broken: (key) => ({ ...companyBase(key), name: '' }),
      brokenMessage: /^name is required$/,
      importCsv: (content, options) =>
        companies.importCsv(
          { file: upload(content), dryRun: !!options?.dryRun, userId: null, language: options?.language },
          { manager },
        ) as Promise<Result>,
      exportCsv: async (language) => (await companies.exportCsv('data', { manager, language })).content,
      snapshot: (runner, id) =>
        runner.query(
          `SELECT name, country_iso, city, base_currency, status::text AS status, disabled_at
             FROM companies WHERE tenant_id = $1 ORDER BY name`,
          [id],
        ),
    },
    {
      label: 'departments',
      table: 'departments',
      nameColumn: 'name',
      dateField: 'disabled_at',
      text: { header: 'name', column: 'name', accented: 'Café Léman' },
      wrapped: 'name',
      key: (label) => label,
      headers: async (language) => headersOf((await departments.exportCsv('template', { manager, language })).content, language),
      base: departmentBase,
      samples: () => [
        { ...departmentBase('Round trip department A'), status: 'enabled' },
        { ...departmentBase('Round trip department B'), status: 'disabled', disabled_at: '2020-03-31' },
      ],
      broken: (key) => ({ ...departmentBase(key), name: '' }),
      brokenMessage: /^name is required$/,
      importCsv: (content, options) =>
        departments.importCsv(
          { file: upload(content), dryRun: !!options?.dryRun, userId: null, language: options?.language },
          { manager },
        ) as Promise<Result>,
      exportCsv: async (language) => (await departments.exportCsv('data', { manager, language })).content,
      snapshot: (runner, id) =>
        runner.query(
          `SELECT company_id, name, description, status::text AS status, disabled_at
             FROM departments WHERE tenant_id = $1 ORDER BY name`,
          [id],
        ),
    },
    {
      label: 'users',
      table: 'users',
      nameColumn: 'email',
      // The users file has no end of validity: the status column carries it.
      dateField: null,
      text: { header: 'first_name', column: 'first_name', accented: 'Café Léman' },
      wrapped: 'first_name',
      key: (label) => `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.test`,
      headers: async (language) => headersOf((await users.exportCsv('template', { manager, language })).content, language),
      base: userBase,
      samples: () => [
        userBase('round-trip-a@example.test'),
        { ...userBase('round-trip-b@example.test'), company_name: '', department_name: '', status: 'contact' },
      ],
      broken: (key) => ({ ...userBase(key), email: 'not-an-email' }),
      brokenMessage: /^email must be valid$/,
      importCsv: (content, options) =>
        users.importCsv(
          { file: upload(content), dryRun: !!options?.dryRun, userId: null, language: options?.language },
          { manager },
        ) as Promise<Result>,
      exportCsv: async (language) => (await users.exportCsv('data', { manager, language })).content,
      snapshot: (runner, id) =>
        runner.query(
          `SELECT email, first_name, last_name, role_id, company_id, department_id, status::text AS status
             FROM users WHERE tenant_id = $1 ORDER BY email`,
          [id],
        ),
    },
    {
      label: 'suppliers',
      table: 'suppliers',
      nameColumn: 'name',
      dateField: null,
      text: { header: 'name', column: 'name', accented: 'Café Léman' },
      wrapped: 'name',
      key: (label) => label,
      headers: async (language) => headersOf((await suppliers.exportCsv('template', { manager, language })).content, language),
      base: supplierBase,
      samples: () => [
        { ...supplierBase('Round trip supplier A', 0), status: 'enabled' },
        { ...supplierBase('Round trip supplier B', 1), status: 'disabled' },
      ],
      broken: (key) => ({ ...supplierBase(key), name: '' }),
      brokenMessage: /^Name is required$/,
      importCsv: (content, options) =>
        suppliers.importCsv(
          { file: upload(content), dryRun: !!options?.dryRun, userId: null, language: options?.language },
          { manager },
        ) as Promise<Result>,
      exportCsv: async (language) => (await suppliers.exportCsv('data', { manager, language })).content,
      snapshot: (runner, id) =>
        runner.query(
          `SELECT name, erp_supplier_id, notes, status::text AS status
             FROM suppliers WHERE tenant_id = $1 ORDER BY name`,
          [id],
        ),
    },
    {
      label: 'accounts',
      table: 'accounts',
      nameColumn: 'account_name',
      dateField: null,
      text: { header: 'account_name', column: 'account_name', accented: 'Café Léman' },
      wrapped: 'account_name',
      key: (label) => label,
      headers: async (language) =>
        headersOf(
          (await accounts.exportCsv('template', { manager, coaId: seeds.coaId, includeCoaCode: false, language })).content,
          language,
        ),
      base: accountBase,
      samples: () => [
        { ...accountBase('Round trip account A', 0), status: 'enabled', nature: 'opex' },
        { ...accountBase('Round trip account B', 1), status: 'disabled', nature: 'capex' },
        { ...accountBase('Round trip account C', 2), status: 'enabled', nature: '' },
      ],
      broken: (key) => ({ ...accountBase(key), account_number: 'not-a-number' }),
      brokenMessage: /^account_number is required and must be an integer$/,
      importCsv: (content, options) =>
        accounts.importCsv(
          { file: upload(content), dryRun: !!options?.dryRun, userId: null, language: options?.language },
          { manager, targetCoaId: seeds.coaId, allowCoaCodeColumn: false },
        ) as Promise<Result>,
      exportCsv: async (language) =>
        (await accounts.exportCsv('data', { manager, coaId: seeds.coaId, includeCoaCode: false, language })).content,
      snapshot: (runner, id) =>
        runner.query(
          `SELECT account_number, account_name, native_name, description, consolidation_account_number,
                  consolidation_account_name, consolidation_account_description, status::text AS status, nature, coa_id
             FROM accounts WHERE tenant_id = $1 ORDER BY account_number`,
          [id],
        ),
    },
    {
      label: 'cost centers',
      table: 'cost_centers',
      nameColumn: 'name',
      dateField: 'disabled_at',
      text: { header: 'name', column: 'name', accented: 'Café Léman' },
      wrapped: 'name',
      key: (label) => label,
      headers: async (language) => headersOf((await costCenters.exportCsv('template', ctx, language)).content, language),
      base: costCenterBase,
      samples: () => [
        { ...costCenterBase('Round trip group A') },
        {
          ...costCenterBase('Round trip center B'),
          kind: 'cost_center',
          company_name: COMPANY,
          parent_code: codeOf('CC', 'Round trip group A'),
          owner_user_id: '',
          description: 'Shared layer cost center with a company',
        },
      ],
      broken: (key) => ({ ...costCenterBase(key), code: '' }),
      brokenMessage: /^Code is required\.$/,
      importCsv: (content, options) =>
        costCenters.importCsv(
          { file: upload(content), dryRun: !!options?.dryRun, language: options?.language },
          ctx,
        ) as Promise<Result>,
      exportCsv: async (language) => (await costCenters.exportCsv('data', ctx, language)).content,
      snapshot: (runner, id) =>
        runner.query(
          `SELECT code, kind, name, parent_id, company_id, owner_user_id, description, status::text AS status, disabled_at
             FROM cost_centers WHERE tenant_id = $1 ORDER BY code`,
          [id],
        ),
    },
    {
      label: 'analytics values',
      table: 'analytics_categories',
      nameColumn: 'name',
      dateField: 'disabled_at',
      text: { header: 'name', column: 'name', accented: 'Café Léman' },
      wrapped: 'description',
      key: (label) => label,
      headers: async (language) => headersOf((await analytics.exportCsv('template', ctx, language)).content, language),
      base: analyticsBase,
      samples: () => [
        { ...analyticsBase('Round trip value A'), status: 'enabled' },
        { ...analyticsBase('Round trip value B'), status: 'disabled', disabled_at: '2020-03-31' },
      ],
      broken: (key) => ({ ...analyticsBase(key), name: '' }),
      brokenMessage: /^Name is required\.$/,
      importCsv: (content, options) =>
        analytics.importCsv(
          { file: upload(content), dryRun: !!options?.dryRun, language: options?.language },
          ctx,
        ) as Promise<Result>,
      exportCsv: async (language) => (await analytics.exportCsv('data', ctx, language)).content,
      snapshot: (runner, id) =>
        runner.query(
          `SELECT axis_id, name, description, status::text AS status, disabled_at
             FROM analytics_categories WHERE tenant_id = $1 ORDER BY name`,
          [id],
        ),
    },
    {
      label: 'calendars',
      table: 'working_day_profiles',
      nameColumn: 'name',
      dateField: 'disabled_at',
      text: { header: 'name', column: 'name', accented: 'Café Léman' },
      wrapped: 'description',
      key: (label) => label,
      headers: async (language) => headersOf((await calendars.exportCsv('template', ctx, language)).content, language),
      base: calendarBase,
      samples: () => [
        { ...calendarBase('Round trip calendar A'), status: 'enabled' },
        { ...calendarBase('Round trip calendar B'), status: 'disabled', disabled_at: '2020-03-31' },
      ],
      broken: (key) => ({ ...calendarBase(key), code: '' }),
      brokenMessage: /^Code is required\.$/,
      importCsv: (content, options) =>
        calendars.importCsv(
          { file: upload(content), dryRun: !!options?.dryRun, language: options?.language },
          ctx,
        ) as Promise<Result>,
      exportCsv: async (language) => (await calendars.exportCsv('data', ctx, language)).content,
      snapshot: (runner, id) =>
        runner.query(
          `SELECT code, name, description, days_by_year, country_iso, region_code, status::text AS status, disabled_at
             FROM working_day_profiles WHERE tenant_id = $1 ORDER BY code`,
          [id],
        ),
    },
  ];
}

/** One transaction with one tenant, its prerequisites and its service table; rolled back at the end. */
async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string, seeds: Seeds) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Master data shared layer test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `md-shared-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    // The prerequisites the importers resolve by name: a company, a department,
    // a chart of accounts and one dimension. Only the files that need them use them.
    const [company] = await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency)
       VALUES ($1, $2, 'FR', 'Lyon', 'EUR') RETURNING id`,
      [tenantId, COMPANY],
    );
    const [department] = await runner.query(
      `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, company.id, DEPARTMENT],
    );
    const [coa] = await runner.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso)
       VALUES ($1, 'SHARED', 'Shared layer chart', 'FR') RETURNING id`,
      [tenantId],
    );
    const [axis] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'nature', 'Nature') RETURNING id`,
      [tenantId],
    );
    await fn(runner, tenantId, { companyId: company.id, departmentId: department.id, coaId: coa.id, axisId: axis.id });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** Every importer in turn, with its label on any failure. */
async function each(tag: string, fn: (importer: Importer, runner: QueryRunner, tenantId: string) => Promise<void>) {
  await withTenant(tag, async (runner, tenantId, seeds) => {
    for (const importer of importers(runner.manager, tenantId, seeds)) {
      try {
        await fn(importer, runner, tenantId);
      } catch (err) {
        (err as Error).message = `${importer.label}: ${(err as Error).message}`;
        throw err;
      }
    }
  });
}

/** The stored end of validity of one row, ISO, or null. */
async function storedDate(importer: Importer, runner: QueryRunner, tenantId: string, key: string): Promise<string | null> {
  const rows = await importer.snapshot(runner, tenantId);
  const row = rows.find((entry) => entry[importer.nameColumn] === key);
  assert.ok(row, `${importer.label}: ${key} exists`);
  return row.disabled_at ? new Date(row.disabled_at).toISOString() : null;
}

/**
 * A French export read on an English screen. The export is the file's own
 * evidence: a BOM, `;` and day-first dates. A date above 12 settles the order
 * by itself, so the screen's language is never asked and no notice is raised.
 * A single ambiguous `01/03/2027` is the other half: English reads it
 * month-first, French day-first, and each says so in `notices.dates`.
 */
async function testForeignExportReadsBack() {
  await each('foreign', async (importer, runner, tenantId) => {
    const key = importer.key(`${importer.label} settled`);
    const cells: Row = { ...importer.base(key), status: 'enabled' };
    if (importer.dateField) cells[importer.dateField] = SETTLED_DAY;
    const seeded = await importer.importCsv(await fileFor(importer, [cells], { language: 'fr' }), { language: 'fr' });
    assert.equal(seeded.ok, true, `${importer.label} seed: ${JSON.stringify(seeded.errors)}`);

    const before = await importer.snapshot(runner, tenantId);
    const exported = await importer.exportCsv('fr');
    assert.ok(exported.startsWith('\uFEFF'), `${importer.label}: a French export starts with a BOM`);
    const [header] = exported.replace(/^\uFEFF/, '').split('\n');
    assert.equal(header, (await importer.headers('fr')).join(';'), `${importer.label}: a French export uses ';'`);

    const dry = await importer.importCsv(exported, { language: 'en', dryRun: true });
    assert.deepEqual([dry.ok, dry.errors], [true, []], `${importer.label} on an English screen: ${JSON.stringify(dry.errors)}`);
    assert.equal(dry.notices.dates, null, `${importer.label}: the file settles its date order, so no notice`);
    assert.equal(dry.notices.amounts, null, `${importer.label}: no amount needs a convention`);
    assert.deepEqual(await importer.snapshot(runner, tenantId), before, `${importer.label}: a dry run writes nothing`);

    if (!importer.dateField) return;
    // The file that shows nothing: only the screen's language decides.
    const ambiguousKey = importer.key(`${importer.label} ambiguous`);
    const ambiguous = await fileFor(
      importer,
      [{ ...importer.base(ambiguousKey), [importer.dateField]: AMBIGUOUS }],
      { language: 'fr' },
    );
    const onEnglish = await importer.importCsv(ambiguous, { language: 'en' });
    assert.deepEqual(
      [onEnglish.ok, onEnglish.errors, onEnglish.notices.dates],
      [true, [], MONTH_FIRST_NOTICE],
      `${importer.label}: an English screen reads 01/03/2027 month first`,
    );
    assert.equal(await storedDate(importer, runner, tenantId, ambiguousKey), '2027-01-03T12:00:00.000Z', `${importer.label}: January 3`);

    const onFrench = await importer.importCsv(ambiguous, { language: 'fr' });
    assert.deepEqual(
      [onFrench.ok, onFrench.errors, onFrench.notices.dates],
      [true, [], DAY_FIRST_NOTICE],
      `${importer.label}: a French screen reads 01/03/2027 day first`,
    );
    assert.equal(await storedDate(importer, runner, tenantId, ambiguousKey), '2027-03-01T12:00:00.000Z', `${importer.label}: March 1`);

    const afterFrench = await importer.snapshot(runner, tenantId);
    const again = await importer.importCsv(ambiguous, { language: 'fr' });
    assert.deepEqual(
      [again.ok, again.errors, await importer.snapshot(runner, tenantId)],
      [true, [], afterFrench],
      `${importer.label}: reading that file again in French changes nothing`,
    );
  });
}

/** The same row written twice, once with each separator; English reads both. */
async function testBothSeparatorsLoad() {
  await each('separators', async (importer) => {
    for (const separator of [',', ';']) {
      const cells: Row = { ...importer.base(importer.key(`${importer.label} ${separator}`)) };
      if (importer.dateField) cells[importer.dateField] = '2027-12-31';
      const result = await importer.importCsv(await fileFor(importer, [cells], { separator }), { language: 'en', dryRun: true });
      assert.deepEqual([result.ok, result.errors], [true, []], `${importer.label}: a '${separator}' file loads (${JSON.stringify(result.errors)})`);
    }
  });
}

/** Excel on Windows writes Windows-1252: no BOM, one byte per accent. */
async function testWindows1252Accent() {
  await each('windows-1252', async (importer, runner, tenantId) => {
    const key = importer.key(`Accent ${importer.label}`);
    const cells: Row = { ...importer.base(key), [importer.text.header]: importer.text.accented };
    const text = await fileFor(importer, [cells], { separator: ';' });
    assert.ok(text.includes('é'), 'the file really carries a Latin-1 byte to decode');
    const result = await importer.importCsv(windows1252(text), { language: 'fr' });
    assert.deepEqual([result.ok, result.errors], [true, []], `${importer.label}: ${JSON.stringify(result.errors)}`);
    // The accented value is the text cell, which for most of these files is the
    // name itself: find the row by the accented value, not by the ASCII key.
    const [row] = await runner.query(
      `SELECT ${importer.text.column} AS value FROM ${importer.table} WHERE tenant_id = $1 AND ${importer.text.column} = $2`,
      [tenantId, importer.text.accented],
    );
    assert.equal(row.value, importer.text.accented, `${importer.label}: the accent survives the round trip through the file`);
  });
}

/** A local day under the file's order: `31/12/2027` is the day France reads, stored at noon UTC. */
async function testLocalEndOfValidity() {
  await each('local-date', async (importer, runner, tenantId) => {
    if (!importer.dateField) return;
    const key = importer.key(`${importer.label} day first`);
    const cells: Row = { ...importer.base(key), status: '', [importer.dateField]: '31/12/2027' };
    const result = await importer.importCsv(await fileFor(importer, [cells], { language: 'fr' }), { language: 'fr' });
    assert.deepEqual([result.ok, result.errors], [true, []], `${importer.label}: ${JSON.stringify(result.errors)}`);
    assert.equal(
      await storedDate(importer, runner, tenantId, key),
      '2027-12-31T12:00:00.000Z',
      `${importer.label}: a bare local day is noon UTC`,
    );
  });
}

/**
 * Physical lines. A quoted cell that spans two lines is one row, so the row
 * after it starts on line 4: that is the number the report must carry.
 */
async function testPhysicalLineWithQuotedNewline() {
  await each('quoted', async (importer) => {
    const good: Row = {
      ...importer.base(importer.key(`${importer.label} quoted`)),
      [importer.wrapped]: 'Line one\nLine two',
    };
    const bad = importer.broken(importer.key(`${importer.label} broken`));
    const content = await fileFor(importer, [good, bad], { language: 'en' });
    assert.match(content, /"Line one\nLine two"/, 'the quoted cell really spans two lines');

    const result = await importer.importCsv(content, { language: 'en' });
    assert.equal(result.ok, false, `${importer.label}: the file is refused`);
    assert.deepEqual(result.errors.map((error) => error.row), [4], `${importer.label}: the error names the physical line`);
    assert.match(result.errors[0].message, importer.brokenMessage, `${importer.label}: the message is the row's own`);
  });
}

/** A French round trip: export, dry run, import; nothing moves. */
async function testFrenchRoundTripChangesNothing() {
  await each('round-trip', async (importer, runner, tenantId) => {
    const rows = importer.samples();
    const seeded = await importer.importCsv(await fileFor(importer, rows, { language: 'fr' }), { language: 'fr' });
    assert.equal(seeded.ok, true, `${importer.label} seed: ${JSON.stringify(seeded.errors)}`);
    const before = await importer.snapshot(runner, tenantId);
    // The companies file also lists the tenant's prerequisite company, so the seed is a lower bound.
    assert.ok(before.length >= rows.length, `${importer.label}: every seeded row is stored`);

    const exported = await importer.exportCsv('fr');
    const dry = await importer.importCsv(exported, { language: 'fr', dryRun: true });
    assert.deepEqual([dry.ok, dry.errors], [true, []], `${importer.label} dry run: ${JSON.stringify(dry.errors)}`);
    const loaded = await importer.importCsv(exported, { language: 'fr' });
    assert.deepEqual([loaded.ok, loaded.errors], [true, []], `${importer.label} load: ${JSON.stringify(loaded.errors)}`);
    assert.deepEqual(await importer.snapshot(runner, tenantId), before, `${importer.label}: the stored rows are unchanged`);
  });
}

/** A non-empty cell past the header's last column is a row error, not a silently dropped value. */
async function testMoreCellsThanTheHeader() {
  await each('extra-cell', async (importer) => {
    const headers = await importer.headers('en');
    const cells = importer.base(importer.key(`${importer.label} extra cell`));
    const line = [...headers.map((header) => csvCell(cells[header] ?? '', ',')), 'extra'].join(',');
    const result = await importer.importCsv(`${headers.join(',')}\n${line}\n`, { language: 'en' });
    assert.equal(result.ok, false, `${importer.label}: the file is refused`);
    assert.deepEqual(result.errors, [{ row: 2, message: EXTRA_CELLS }], `${importer.label}: ${JSON.stringify(result.errors)}`);
  });
}

/** A file the shared layer cannot read at all is a 400, with its own sentence. */
async function testUnreadableFileIsRefused() {
  await each('unreadable', async (importer) => {
    const refused = async (bytes: Buffer, expected: RegExp) => {
      let caught: unknown = null;
      try {
        await importer.importCsv(bytes, { language: 'en', dryRun: true });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BadRequestException, `${importer.label}: ${expected} is a 400`);
      assert.match(String((caught as Error).message), expected, `${importer.label}: ${expected}`);
    };

    // A UTF-16 BOM is neither encoding, and a file with nothing in it is not a file.
    await refused(Buffer.from([0xff, 0xfe, 0x3c, 0x00]), /not UTF-8 or Windows-1252/);
    await refused(Buffer.alloc(0), /The file is empty/);
    const headers = await importer.headers('en');
    await refused(Buffer.from(`${headers.join(',')}\n"never closed\n`, 'utf8'), /A quoted cell is not closed/);
    const overCap = [headers.join(','), ...Array.from({ length: 20_001 }, (_unused, index) => String(index))].join('\n');
    await refused(Buffer.from(`${overCap}\n`, 'utf8'), /more than 20,000 rows/);
  });
}

/**
 * The accounts file's `nature` column is optional: a file without it (written before the
 * column existed) leaves the stored natures alone and creates accounts for both types; a
 * value other than opex, capex or empty is a row error.
 */
async function testAccountNatureColumn() {
  await withTenant('nature', async (runner, tenantId, seeds) => {
    const importer = importers(runner.manager, tenantId, seeds).find((entry) => entry.label === 'accounts');
    assert.ok(importer, 'the accounts importer');
    const headers = await importer.headers('en');
    assert.equal(headers[headers.length - 1], 'nature', 'the export writes nature last');
    const natures = async () => Object.fromEntries(
      (await importer.snapshot(runner, tenantId)).map((row) => [row.account_name, [row.nature, row.description]]),
    );

    const seeded = await importer.importCsv(await fileFor(importer, importer.samples(), { language: 'en' }), { language: 'en' });
    assert.deepEqual([seeded.ok, seeded.errors], [true, []], `seed: ${JSON.stringify(seeded.errors)}`);
    assert.deepEqual(await natures(), {
      'Round trip account A': ['opex', 'Shared layer account'],
      'Round trip account B': ['capex', 'Shared layer account'],
      'Round trip account C': [null, 'Shared layer account'],
    }, 'the nature cells are stored, empty as null');

    // The same accounts and a new one, without the column: natures kept, other cells applied.
    const withoutNature = headers.filter((header) => header !== 'nature');
    const rows = [...importer.samples(), { ...importer.base('Round trip account D'), account_number: '6103' }]
      .map((row): Row => ({ ...row, description: 'Edited without nature' }));
    const content = [
      withoutNature.join(','),
      ...rows.map((row) => withoutNature.map((header) => csvCell(row[header] ?? '', ',')).join(',')),
    ].join('\n') + '\n';
    const loaded = await importer.importCsv(content, { language: 'en' });
    assert.deepEqual([loaded.ok, loaded.errors, loaded.ignoredColumns], [true, [], []], `without nature: ${JSON.stringify(loaded.errors)}`);
    assert.deepEqual(await natures(), {
      'Round trip account A': ['opex', 'Edited without nature'],
      'Round trip account B': ['capex', 'Edited without nature'],
      'Round trip account C': [null, 'Edited without nature'],
      'Round trip account D': [null, 'Edited without nature'],
    }, 'a file without nature keeps the stored natures');

    // The column present: an empty cell clears, an invalid value is refused.
    const cleared = await importer.importCsv(
      await fileFor(importer, [{ ...importer.samples()[0], nature: '' }], { language: 'en' }),
      { language: 'en' },
    );
    assert.deepEqual([cleared.ok, cleared.errors], [true, []]);
    assert.equal((await natures())['Round trip account A'][0], null, 'an empty nature cell clears it');
    const before = await importer.snapshot(runner, tenantId);
    const invalid = await importer.importCsv(
      await fileFor(importer, [{ ...importer.samples()[1], nature: 'both' }], { language: 'en' }),
      { language: 'en' },
    );
    assert.equal(invalid.ok, false, 'an invalid nature is refused');
    assert.deepEqual(invalid.errors, [{ row: 2, message: "Invalid nature 'both'. Use 'opex', 'capex' or leave it empty." }]);
    assert.deepEqual(await importer.snapshot(runner, tenantId), before, 'nothing is written');
  });
}

async function main() {
  await dataSource.initialize();
  let failed = 0;
  const tests: Array<[string, () => Promise<void>]> = [
    ['testForeignExportReadsBack', testForeignExportReadsBack],
    ['testBothSeparatorsLoad', testBothSeparatorsLoad],
    ['testWindows1252Accent', testWindows1252Accent],
    ['testLocalEndOfValidity', testLocalEndOfValidity],
    ['testPhysicalLineWithQuotedNewline', testPhysicalLineWithQuotedNewline],
    ['testFrenchRoundTripChangesNothing', testFrenchRoundTripChangesNothing],
    ['testMoreCellsThanTheHeader', testMoreCellsThanTheHeader],
    ['testUnreadableFileIsRefused', testUnreadableFileIsRefused],
    ['testAccountNatureColumn', testAccountNatureColumn],
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
    console.error(`master-data-csv-shared-layer.integration.spec: ${failed} failed`);
    process.exit(1);
  }
  console.log('master-data-csv-shared-layer.integration.spec: ok');
}

void main();
