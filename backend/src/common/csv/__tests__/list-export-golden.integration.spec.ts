import 'dotenv/config';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import AdmZip = require('adm-zip');
import { randomUUID } from 'node:crypto';
import type { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { backendPath } from '../../__tests__/backend-root';
import { exportListQuery } from '../../pagination';
import type { CsvLanguage } from '../../csv-sheet/types';
import { inRolledBackTransaction, seedTenant } from '../../../spend/__tests__/round-inputs.fixtures';
import { AccountsService } from '../../../accounts/accounts.service';
import { AnalyticsCategoriesCsvService } from '../../../analytics/analytics-categories-csv.service';
import { BusinessProcessesService } from '../../../business-processes/business-processes.service';
import { BusinessProcess } from '../../../business-processes/business-process.entity';
import { BusinessProcessCategory } from '../../../business-processes/business-process-category.entity';
import { BusinessProcessCategoryLink } from '../../../business-processes/business-process-category-link.entity';
import { CompaniesService } from '../../../companies/companies.service';
import { CompanyMetricsService } from '../../../companies/company-metrics.service';
import { Company } from '../../../companies/company.entity';
import { ContactsService } from '../../../contacts/contacts.service';
import { ContractsService } from '../../../contracts/contracts.service';
import { CostCentersCsvService } from '../../../cost-centers/cost-centers-csv.service';
import { DataAccessAdminService } from '../../../data-access/data-access-admin.service';
import { DepartmentsService } from '../../../departments/departments.service';
import { Department } from '../../../departments/department.entity';
import { Role } from '../../../roles/role.entity';
import { RolePermission } from '../../../permissions/role-permission.entity';
import { RolesService } from '../../../roles/roles.service';
import { SuppliersService } from '../../../suppliers/suppliers.service';
import { TechnologyLinksCsvService } from '../../../technologies/technology-links-csv.service';
import { User } from '../../../users/user.entity';
import { UsersService } from '../../../users/users.service';
import { WorkingDayProfilesCsvService } from '../../../working-day-profiles/working-day-profiles-csv.service';
import { WorkingDayProfilesService } from '../../../working-day-profiles/working-day-profiles.service';

// The CSV of the list exports written with `writeCsv` (accounts, analytics values, business
// processes, companies, contacts, contracts, cost centers, departments, suppliers, users,
// working-day calendars, data access, the two technology link files), byte for byte, from a fixed
// seed, in English and in French. The files in `golden/lists/` were written by the exports before
// the Excel export (lot 3, run B) and must not change. `UPDATE_CSV_GOLDEN=1` rewrites them (never
// to make a failing run pass: a difference is a change of the CSV people already use). The same
// seed in xlsx: amounts exact, days as date serials, counts and days as numbers, codes as text.

const GOLDEN_DIR = backendPath('src', 'common', 'csv', '__tests__', 'golden', 'lists');
const LANGUAGES: CsvLanguage[] = ['en', 'fr'];
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 5, 8, minutes)).toISOString();
const TRICKY = 'Line; "quoted"\nsecond, line';
const FORMULA = '=HYPERLINK("http://x")';

type Ids = Record<string, string>;

async function insert(runner: QueryRunner, table: string, values: Record<string, unknown>): Promise<string> {
  const id = (values.id as string | undefined) ?? randomUUID();
  const row = { id, ...values };
  const columns = Object.keys(row);
  await runner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_c, i) => `$${i + 1}`).join(', ')})`,
    columns.map((column) => (row as Record<string, unknown>)[column]),
  );
  return id;
}

async function seed(runner: QueryRunner, tenantId: string): Promise<Ids> {
  const ids: Ids = {};
  const t = { tenant_id: tenantId };
  ids.companyA = await insert(runner, 'companies', { ...t, name: 'Alpha SA', country_iso: 'FR', city: 'Lyon', base_currency: 'EUR', reg_number: '00123', vat_number: 'FR001', notes: FORMULA, created_at: at(1) });
  ids.companyB = await insert(runner, 'companies', { ...t, name: TRICKY, country_iso: 'DE', city: 'Köln', base_currency: 'EUR', postal_code: '01067', status: 'disabled', disabled_at: '2025-12-31T23:30:00Z', created_at: at(2) });
  await insert(runner, 'company_metrics', { ...t, company_id: ids.companyA, fiscal_year: 2026, headcount: 120, it_users: 40, turnover: '-1250.500' });
  await insert(runner, 'company_metrics', { ...t, company_id: ids.companyB, fiscal_year: 2027, headcount: 0, turnover: '12.5' });
  ids.deptA = await insert(runner, 'departments', { ...t, company_id: ids.companyA, name: 'Finance', description: FORMULA, created_at: at(3) });
  ids.deptB = await insert(runner, 'departments', { ...t, company_id: ids.companyB, name: TRICKY, status: 'disabled', disabled_at: '2025-06-30T12:00:00Z', created_at: at(4) });
  ids.role = await insert(runner, 'roles', { ...t, role_name: 'Spec reader' });
  ids.userA = await insert(runner, 'users', { ...t, email: 'ada@example.com', first_name: 'Ada', last_name: 'Byron', role_id: ids.role, company_id: ids.companyA, department_id: ids.deptA, status: 'enabled', data_access_mode: 'limited', created_at: at(5) });
  ids.userB = await insert(runner, 'users', { ...t, email: 'bob@example.com', first_name: '-Bob', last_name: TRICKY, role_id: ids.role, status: 'disabled', created_at: at(6) });
  ids.supplierA = await insert(runner, 'suppliers', { ...t, name: 'Acme', erp_supplier_id: '000123', notes: FORMULA, created_at: at(7) });
  ids.supplierB = await insert(runner, 'suppliers', { ...t, name: 'Zeta; "Z"', status: 'disabled', disabled_at: '2025-12-31T23:30:00Z', created_at: at(8) });
  ids.contactA = await insert(runner, 'contacts', { ...t, email: 'carla@acme.example', first_name: 'Carla', last_name: 'Ruiz', job_title: 'Sales', phone: '+33 1 23', mobile: '0612', country: 'FR', notes: TRICKY, active: true, created_at: at(9) });
  ids.contactB = await insert(runner, 'contacts', { ...t, email: 'dan@acme.example', first_name: 'Dan', last_name: 'Ng', active: false, created_at: at(10) });
  await insert(runner, 'supplier_contacts', { ...t, supplier_id: ids.supplierA, contact_id: ids.contactA, role: 'commercial', is_primary: true, created_at: at(11) });
  await insert(runner, 'supplier_contacts', { ...t, supplier_id: ids.supplierA, contact_id: ids.contactB, role: 'support', is_primary: false, created_at: at(12) });
  ids.coa = await insert(runner, 'chart_of_accounts', { ...t, code: 'FR-PCG', name: 'Plan comptable', country_iso: 'FR' });
  await insert(runner, 'accounts', { ...t, coa_id: ids.coa, account_number: 6061, account_name: 'Fournitures', native_name: 'Fournitures non stockables', description: FORMULA, consolidation_account_number: 60, consolidation_account_name: 'Achats', consolidation_account_description: TRICKY, nature: 'opex', created_at: at(13) });
  await insert(runner, 'accounts', { ...t, coa_id: ids.coa, account_number: 2183, account_name: 'Matériel informatique', status: 'disabled', nature: 'capex', created_at: at(14) });
  ids.ccRoot = await insert(runner, 'cost_centers', { ...t, code: 'CC-01', kind: 'group', name: 'Group', owner_user_id: ids.userA, description: FORMULA, sort_order: 1, created_at: at(15) });
  ids.ccChild = await insert(runner, 'cost_centers', { ...t, code: 'CC-01-002', kind: 'cost_center', name: TRICKY, parent_id: ids.ccRoot, company_id: ids.companyB, status: 'disabled', disabled_at: '2025-06-30T12:00:00Z', sort_order: 2, created_at: at(16) });
  ids.axis = await insert(runner, 'analytics_axes', { ...t, code: 'nature', name: 'Nature' });
  await insert(runner, 'analytics_categories', { ...t, axis_id: ids.axis, name: 'Run', description: FORMULA, applies_to: 'opex', sort_order: 1, created_at: at(17) });
  await insert(runner, 'analytics_categories', { ...t, axis_id: ids.axis, name: TRICKY, status: 'disabled', disabled_at: '2025-12-31T23:30:00Z', sort_order: 2, created_at: at(18) });
  await insert(runner, 'working_day_profiles', { ...t, code: 'CAL-A', name: 'Office', description: FORMULA, days_by_year: JSON.stringify({ 2027: ['21', '19.083333', '22', '20', '19', '21', '22', '21', '22', '21', '20', '20.5'], 2026: Array(12).fill('20') }), created_at: at(19) });
  await insert(runner, 'working_day_profiles', { ...t, code: 'CAL-B', name: TRICKY, status: 'disabled', disabled_at: '2025-06-30T12:00:00Z', created_at: at(20) });
  await insert(runner, 'contracts', { ...t, name: 'Support', company_id: ids.companyA, supplier_id: ids.supplierA, cost_center_id: ids.ccRoot, owner_user_id: ids.userA, start_date: '2026-03-01', duration_months: 36, auto_renewal: true, notice_period_months: 3, yearly_amount_at_signature: '1250.50', currency: 'EUR', billing_frequency: 'annual', notes: FORMULA, created_at: at(21) });
  await insert(runner, 'contracts', { ...t, name: TRICKY, company_id: ids.companyB, supplier_id: ids.supplierB, start_date: '2024-12-31', auto_renewal: false, yearly_amount_at_signature: '-0.5', currency: 'USD', billing_frequency: 'monthly', status: 'disabled', disabled_at: '2025-12-31T23:30:00Z', created_at: at(22) });
  ids.categoryA = await insert(runner, 'business_process_categories', { ...t, name: 'Finance' });
  ids.categoryB = await insert(runner, 'business_process_categories', { ...t, name: 'Sales; ops' });
  ids.process = await insert(runner, 'business_processes', { ...t, name: 'Order to cash', description: TRICKY, notes: FORMULA, created_at: at(23) });
  await insert(runner, 'business_processes', { ...t, name: 'Procure to pay', status: 'disabled', disabled_at: '2025-06-30T12:00:00Z', created_at: at(24) });
  await insert(runner, 'business_process_category_links', { ...t, process_id: ids.process, category_id: ids.categoryA });
  await insert(runner, 'business_process_category_links', { ...t, process_id: ids.process, category_id: ids.categoryB });
  await insert(runner, 'user_data_access_nodes', { ...t, user_id: ids.userA, node_type: 'all', access: 'read' });
  await insert(runner, 'user_data_access_nodes', { ...t, user_id: ids.userA, node_type: 'company', company_id: ids.companyB, access: 'edit' });
  await insert(runner, 'user_data_access_nodes', { ...t, user_id: ids.userA, node_type: 'cost_center', cost_center_id: ids.ccChild, access: 'read' });
  ids.asset = await insert(runner, 'assets', { ...t, name: 'srv-01', kind: 'physical_server', environment: 'prod' });
  ids.app = await insert(runner, 'applications', { ...t, name: 'Ledger' });
  ids.tech = await insert(runner, 'technologies', { ...t, item_number: 7, name: 'PostgreSQL' });
  ids.version = await insert(runner, 'technology_versions', { ...t, technology_id: ids.tech, label: '16' });
  await insert(runner, 'asset_technologies', { ...t, asset_id: ids.asset, technology_id: ids.tech, technology_version_id: ids.version, is_operating_system: false, notes: FORMULA, source: 'manual' });
  await insert(runner, 'application_technologies', { ...t, application_id: ids.app, technology_id: ids.tech, notes: TRICKY, source: 'import' });
  return ids;
}

type Export = (language: CsvLanguage) => Promise<{ content: string | Buffer }>;

function exportsOf(manager: EntityManager, tenantId: string, ids: Ids): Array<[string, Export]> {
  const ctx = { manager, tenantId, userId: null };
  const audit = undefined as any;
  const accounts = new AccountsService(undefined as any, audit);
  const metrics = new CompanyMetricsService(undefined as any, audit, { assertNotFrozen: async () => undefined } as any);
  const companies = new CompaniesService(undefined as any, audit, metrics);
  const departments = new DepartmentsService(undefined as any, undefined as any, audit);
  const users = new UsersService(
    manager.getRepository(User),
    manager.getRepository(Company),
    manager.getRepository(Department),
    new RolesService(manager.getRepository(Role), manager.getRepository(RolePermission)),
    undefined as any,
    undefined as any,
    audit,
  );
  const suppliers = new SuppliersService(undefined as any, audit);
  const contacts = new ContactsService(undefined as any, undefined as any, undefined as any, undefined as any, audit);
  const contractArgs: any[] = Array.from({ length: 10 }, () => undefined);
  const contracts = new (ContractsService as any)(...contractArgs) as ContractsService;
  const processes = new BusinessProcessesService(
    manager.getRepository(BusinessProcess),
    manager.getRepository(BusinessProcessCategory),
    manager.getRepository(BusinessProcessCategoryLink),
    manager.getRepository(User),
    audit,
  );
  const costCenters = new CostCentersCsvService(undefined as any);
  const analytics = new AnalyticsCategoriesCsvService(undefined as any);
  const calendars = new WorkingDayProfilesCsvService(new WorkingDayProfilesService(audit));
  const dataAccess = new DataAccessAdminService(undefined as any, audit);
  const links = new TechnologyLinksCsvService(undefined as any, undefined as any);
  const listQuery = exportListQuery({ rows: 'list', scope: 'data', language: 'fr' });
  return [
    ['accounts', (language) => accounts.exportCsv('data', { manager, includeCoaCode: true, language })],
    ['accounts-coa', (language) => accounts.exportCsv('data', { manager, coaId: ids.coa, language })],
    ['analytics-values', (language) => analytics.exportCsv('data', ctx, language)],
    ['business-processes', (language) => processes.exportCsv('data', { manager, language })],
    ['companies', (language) => companies.exportCsv('data', { manager, year: 2026, language })],
    ['contacts', (language) => contacts.exportCsv('data', { manager, tenantId, language })],
    ['contracts', (language) => contracts.exportCsv('data', { manager, language })],
    ['cost-centers', (language) => costCenters.exportCsv('data', ctx, language)],
    ['departments', (language) => departments.exportCsv('data', { manager, language })],
    ['departments-list', (language) => departments.exportCsv('data', { manager, language, listQuery })],
    ['suppliers', (language) => suppliers.exportCsv('data', { manager, language })],
    ['users', (language) => users.exportCsv('data', { manager, language })],
    ['working-day-calendars', (language) => calendars.exportCsv('data', ctx, language)],
    ['data-access', (language) => dataAccess.exportCsv(manager, language)],
    ['asset-links', (language) => links.exportAssetLinks('data', ctx, language)],
    ['application-links', (language) => links.exportApplicationLinks('data', ctx, { scope: null } as any, language)],
  ];
}

/** The cells of the first sheet: `{ ref: [style or 'text', value] }`. */
function sheetOf(content: string | Buffer): Record<string, [string, string]> {
  assert.ok(Buffer.isBuffer(content), 'a workbook');
  const xml = new AdmZip(content).readAsText('xl/worksheets/sheet1.xml');
  const cells: Record<string, [string, string]> = {};
  for (const [, ref, attributes, body] of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/gs)) {
    if (/t="inlineStr"/.test(attributes)) cells[ref] = ['text', /<t[^>]*>(.*?)<\/t>/s.exec(body)?.[1] ?? ''];
    else cells[ref] = [/s="(\d+)"/.exec(attributes)?.[1] ?? 'general', /<v>(.*?)<\/v>/.exec(body)?.[1] ?? ''];
  }
  return cells;
}

/** The typed columns of three exports in xlsx, on the golden seed (French). */
async function testXlsx(manager: EntityManager, tenantId: string): Promise<void> {
  const ctx = { manager, tenantId, userId: null };
  const contractArgs: any[] = Array.from({ length: 10 }, () => undefined);
  const contracts = new (ContractsService as any)(...contractArgs) as ContractsService;
  const contract = await contracts.exportCsv('data', { manager, language: 'fr', format: 'xlsx' });
  assert.equal(contract.filename, 'contracts.xlsx');
  assert.equal(contract.rows, 2);
  const c = sheetOf(contract.content);
  assert.equal(c.E2[1], '45657', 'contracts: start date 2024-12-31 as a date serial');
  assert.deepEqual(c.F2, ['general', '12'], 'contracts: duration as a number');
  assert.equal(c.I2[1], '-0.5', 'contracts: amount exact');
  assert.equal(c.I3[1], '1250.5');
  assert.notEqual(c.I3[0], 'text');
  assert.deepEqual(c.G2, ['text', 'non'], 'contracts: yes or no as the CSV writes it');
  assert.deepEqual(c.N3, ['text', '&apos;=HYPERLINK(&quot;http://x&quot;)'], 'contracts: formula guard');

  const metrics = new CompanyMetricsService(undefined as any, undefined as any, { assertNotFrozen: async () => undefined } as any);
  const company = await new CompaniesService(undefined as any, undefined as any, metrics).exportCsv('data', { manager, year: 2026, language: 'fr', format: 'xlsx' });
  assert.equal(company.filename, 'companies_2026.xlsx');
  const k = sheetOf(company.content);
  assert.equal(k.L2[1], '46022', 'companies: end of validity, the UTC day of the instant');
  assert.deepEqual([k.Q3, k.R3], [['general', '120'], ['general', '40']], 'companies: headcount and IT users as numbers');
  assert.equal(k.S3[1], '-1250.500', 'companies: turnover exact');
  assert.deepEqual(k.H3, ['text', '00123'], 'companies: registration number keeps its zeros');
  assert.deepEqual(k.T2, ['general', '0']);

  const calendars = await new WorkingDayProfilesCsvService(new WorkingDayProfilesService(undefined as any)).exportCsv('data', ctx, 'fr', undefined, 'xlsx');
  const w = sheetOf(calendars.content);
  assert.deepEqual(w.H2, ['general', '2026'], 'calendars: the year as a number');
  assert.deepEqual([w.J3, w.T3], [['general', '19.083333'], ['general', '20.5']], 'calendars: days as numbers');
  assert.equal(calendars.rows, 3);
}

async function run() {
  const update = process.env.UPDATE_CSV_GOLDEN === '1';
  await dataSource.initialize();
  const checked: string[] = [];
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'list-golden');
      const ids = await seed(runner, tenantId);
      if (update) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      for (const [name, produce] of exportsOf(runner.manager, tenantId, ids)) {
        for (const language of LANGUAGES) {
          const { content } = await produce(language);
          assert.equal(typeof content, 'string', `${name}: a CSV export is text`);
          const file = path.join(GOLDEN_DIR, `${name}.${language}.csv`);
          if (update) {
            fs.writeFileSync(file, content as string);
          } else {
            assert.ok(fs.existsSync(file), `${name}.${language}.csv: golden file present`);
            assert.equal(content, fs.readFileSync(file, 'utf8'), `${name}.${language}.csv: byte-identical`);
          }
          // Every golden holds rows: an empty file would prove nothing.
          assert.ok((content as string).split('\n').filter(Boolean).length >= 2, `${name}.${language}: rows exported`);
          checked.push(`${name}.${language}`);
        }
      }
      if (!update) await testXlsx(runner.manager, tenantId);
    });
  } finally {
    await dataSource.destroy();
  }
  console.log(`  ${update ? 'written' : 'identical'}: ${checked.join(', ')}`);
  if (!update) console.log('  xlsx: contracts, companies, calendars typed: OK');
  console.log('list-export-golden.integration.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
