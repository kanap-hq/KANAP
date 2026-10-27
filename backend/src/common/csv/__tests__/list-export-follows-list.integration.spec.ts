import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { CsvExportService } from '../csv-export.service';
import { CsvImportService } from '../csv-import.service';
import { CsvJsonValidators } from '../csv-json-validators';
import { CsvResolverService } from '../csv-resolver.service';
import { exportListQuery } from '../../pagination';
import { inRolledBackTransaction, seedTenant } from '../../../spend/__tests__/round-inputs.fixtures';
import { PortfolioProject } from '../../../portfolio/portfolio-project.entity';
import { PortfolioRequest } from '../../../portfolio/portfolio-request.entity';
import { PortfolioProjectsListService } from '../../../portfolio/services/portfolio-projects-list.service';
import { PortfolioRequestsService } from '../../../portfolio/portfolio-requests.service';
import { PortfolioProjectsCsvService } from '../../../portfolio/portfolio-projects-csv.service';
import { PortfolioRequestsCsvService } from '../../../portfolio/portfolio-requests-csv.service';
import { TasksService } from '../../../spend/tasks.service';
import { TasksCsvService } from '../../../tasks/tasks-csv.service';
import { Task } from '../../../tasks/task.entity';
import { Application } from '../../../applications/application.entity';
import { ApplicationsListService } from '../../../applications/services/applications-list.service';
import { ApplicationsCsvService } from '../../../applications/applications-csv.service';
import { Asset } from '../../../assets/asset.entity';
import { AssetsListService } from '../../../assets/services/assets-list.service';
import { AssetsCsvService } from '../../../assets/assets-csv.service';
import { AccountsService } from '../../../accounts/accounts.service';
import { AnalyticsCategory } from '../../../analytics/analytics-category.entity';
import { AnalyticsCategoriesService } from '../../../analytics/analytics-categories.service';
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
import { CostCentersService } from '../../../cost-centers/cost-centers.service';
import { CostCentersCsvService } from '../../../cost-centers/cost-centers-csv.service';
import { DepartmentsService } from '../../../departments/departments.service';
import { Department } from '../../../departments/department.entity';
import { Role } from '../../../roles/role.entity';
import { RolePermission } from '../../../permissions/role-permission.entity';
import { RolesService } from '../../../roles/roles.service';
import { SuppliersService } from '../../../suppliers/suppliers.service';
import { User } from '../../../users/user.entity';
import { UsersService } from '../../../users/users.service';
import { WorkingDayProfilesCsvService } from '../../../working-day-profiles/working-day-profiles-csv.service';
import { WorkingDayProfilesService } from '../../../working-day-profiles/working-day-profiles.service';

// The list exports follow the screen (Excel export, lot 3): with a column filter, a quick search and a
// sort active, the rows of the export (their ids, in order) are the rows of the list route for the
// same query, every page. Projects, requests and tasks read the list's ids (`rows=list`, the
// dialog's request: `exportListQuery` then `listIds`); applications and assets read them through their
// own list query. Incidents: incident-review-csv.integration.spec.ts compares its export with its list.
// The master-data lists (run B: accounts, analytics values, business processes, companies, contacts,
// contracts, cost centers, departments, suppliers, users, working-day calendars) read the list's rows
// through their list service with the export bound; their file has no id, so the names (or emails)
// of the export, in order, are compared with those of the list route.

const engine = new CsvExportService(new CsvResolverService());
const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
const settings = {
  applicationCategories: [], lifecycleStates: [], businessCriticalityLevels: [], cyberCriticalityLevels: [],
  recoveryWaves: [], dataClasses: [], accessMethods: [], serverKinds: [], domains: [], adminZones: [], ipAddressTypes: [],
};
const itOps = { getSettings: async () => settings, getSettingsForWrite: async () => settings } as any;

/** The `id` column of an export, in order. */
function idsOf(content: string): string[] {
  const [header, ...lines] = content.replace(/^﻿/, '').trim().split(/\r?\n/);
  assert.equal(header, 'id');
  return lines;
}

/** What the screen sends for its list, and the export dialog the same with `rows=list`. */
const screenQuery = (filters: Record<string, unknown>, q: string, sort: string) => ({ filters: JSON.stringify(filters), q, sort });
const dialogQuery = (query: Record<string, unknown>) => exportListQuery({ ...query, rows: 'list', scope: 'data', language: 'fr', format: 'xlsx' })!;

async function seed(runner: QueryRunner, tenantId: string) {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 8, minutes)).toISOString();
  const names = ['Alpha one', 'alpha two', 'Beta Alpha', 'Gamma', 'Alpha closed', 'Alpha twin', 'Alpha twin'];
  const statuses = ['in_progress', 'waiting_list', 'in_progress', 'in_progress', 'done', 'waiting_list', 'waiting_list'];
  for (const [index, name] of names.entries()) {
    // The twins share their name and creation time: the id breaks the tie, on the list and in the file.
    const created = at(index >= 5 ? 50 : index);
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, name, item_number, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tenantId, name, index + 1, statuses[index], created],
    );
    await runner.query(
      `INSERT INTO portfolio_requests (id, tenant_id, name, item_number, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tenantId, name, index + 1, statuses[index] === 'done' ? 'converted' : statuses[index], created],
    );
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, title, item_number, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tenantId, name, index + 1, statuses[index] === 'done' ? 'done' : statuses[index] === 'waiting_list' ? 'open' : 'in_progress', created],
    );
    await runner.query(
      `INSERT INTO applications (id, tenant_id, name, created_at) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), tenantId, `${name} ${index}`, created],
    );
    await runner.query(
      `INSERT INTO assets (id, tenant_id, name, kind, environment, created_at) VALUES ($1, $2, $3, 'physical_server', 'prod', $4)`,
      [randomUUID(), tenantId, `${name} ${index}`, created],
    );
  }
}

/** One column of an English export, in order (the values hold no separator, quote or line break). */
function columnOf(content: string, header: string): string[] {
  const [head, ...lines] = content.replace(/^﻿/, '').trim().split(/\r?\n/);
  const index = head.split(',').indexOf(header);
  assert.ok(index >= 0, `the file has a ${header} column`);
  return lines.map((line) => line.split(',')[index]);
}

const MASTER_NAMES = ['Alpha one', 'alpha two', 'Beta Alpha', 'Gamma', 'Alpha old'];

async function seedMasterData(runner: QueryRunner, tenantId: string) {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 2, 8, minutes)).toISOString();
  const insert = async (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { id: randomUUID(), tenant_id: tenantId, ...values };
    const columns = Object.keys(row);
    await runner.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_c, i) => `$${i + 1}`).join(', ')})`,
      columns.map((column) => row[column]),
    );
    return row.id as string;
  };
  const role = await insert('roles', { role_name: 'Follows list role' });
  const coa = await insert('chart_of_accounts', { code: 'FL', name: 'Follows list chart', country_iso: 'FR' });
  const axis = await insert('analytics_axes', { code: 'fl_axis', name: 'Follows list axis' });
  let company = '';
  let supplier = '';
  for (const [index, name] of MASTER_NAMES.entries()) {
    // The last row is disabled: the default Show scope of most lists leaves it out, as the file must.
    const ended = index === MASTER_NAMES.length - 1 ? { status: 'disabled', disabled_at: '2025-06-30T12:00:00Z' } : {};
    const created = at(index);
    const companyId = await insert('companies', { name, country_iso: 'FR', city: 'Lyon', created_at: created, ...ended });
    const supplierId = await insert('suppliers', { name, created_at: created, ...ended });
    if (!company) { company = companyId; supplier = supplierId; }
    await insert('departments', { company_id: company, name, created_at: created, ...ended });
    await insert('users', { email: `${name.toLowerCase().replace(/ /g, '.')}@example.com`, first_name: name, role_id: role, status: index === 4 ? 'disabled' : 'enabled', created_at: created });
    await insert('contacts', { email: `${name.toLowerCase().replace(/ /g, '.')}@example.com`, first_name: name, active: index !== 4, created_at: created });
    await insert('contracts', { name, company_id: company, supplier_id: supplier, start_date: '2026-01-01', created_at: created, ...ended });
    await insert('accounts', { coa_id: coa, account_number: 6000 + index, account_name: name, created_at: created, ...(index === 4 ? { status: 'disabled' } : {}) });
    await insert('cost_centers', { code: `FL-${index}`, kind: 'group', name, sort_order: index, created_at: created, ...ended });
    await insert('analytics_categories', { axis_id: axis, name, sort_order: index, created_at: created, ...ended });
    await insert('working_day_profiles', { code: `FL-${index}`, name, created_at: created, ...ended });
    await insert('business_processes', { name, created_at: created, ...ended });
  }
  return { coa };
}

/** Each master-data list: with a column filter, a quick search and a sort, the file holds the list route's rows, in order. */
async function testMasterDataLists(runner: QueryRunner, tenantId: string, checked: string[]) {
  const { coa } = await seedMasterData(runner, tenantId);
  const manager = runner.manager;
  const ctx = { manager, tenantId, userId: null };
  const audit = undefined as any;
  const accounts = new AccountsService(undefined as any, audit);
  const analyticsService = new AnalyticsCategoriesService(manager.getRepository(AnalyticsCategory), audit);
  const analytics = new AnalyticsCategoriesCsvService(analyticsService);
  const processes = new BusinessProcessesService(
    manager.getRepository(BusinessProcess), manager.getRepository(BusinessProcessCategory),
    manager.getRepository(BusinessProcessCategoryLink), manager.getRepository(User), audit,
  );
  const companies = new CompaniesService(undefined as any, audit, new CompanyMetricsService(undefined as any, audit, { assertNotFrozen: async () => undefined } as any));
  const contacts = new ContactsService(undefined as any, undefined as any, undefined as any, undefined as any, audit);
  const contracts = new (ContractsService as any)(...Array.from({ length: 10 }, () => undefined)) as ContractsService;
  const costCentersService = new CostCentersService(audit);
  const costCenters = new CostCentersCsvService(costCentersService);
  const departments = new DepartmentsService(undefined as any, undefined as any, audit);
  const suppliers = new SuppliersService(undefined as any, audit);
  const users = new UsersService(
    manager.getRepository(User), manager.getRepository(Company), manager.getRepository(Department),
    new RolesService(manager.getRepository(Role), manager.getRepository(RolePermission)), undefined as any, undefined as any, audit,
  );
  const calendarsService = new WorkingDayProfilesService(audit);
  const calendars = new WorkingDayProfilesCsvService(calendarsService);

  type Case = {
    name: string;
    /** The list column the filter and the comparison use, and the file's header for it. */
    field: string;
    header: string;
    list: (query: Record<string, unknown>) => Promise<{ items: any[] }>;
    file: (listQuery: Record<string, unknown>) => Promise<{ content: string | Buffer }>;
  };
  const cases: Case[] = [
    { name: 'accounts', field: 'account_name', header: 'account_name',
      list: (query) => accounts.list({ ...query, coaId: coa }, { manager }),
      file: (listQuery) => accounts.exportCsv('data', { manager, coaId: coa, language: 'en', listQuery }) },
    { name: 'analytics values', field: 'name', header: 'name',
      list: (query) => analyticsService.listWithUsage(query, ctx),
      file: (listQuery) => analytics.exportCsv('data', ctx, 'en', listQuery) },
    { name: 'business processes', field: 'name', header: 'name',
      list: (query) => processes.list(query, { manager }),
      file: (listQuery) => processes.exportCsv('data', { manager, language: 'en', listQuery }) },
    { name: 'companies', field: 'name', header: 'name',
      list: (query) => companies.list(query, { manager }),
      file: (listQuery) => companies.exportCsv('data', { manager, year: 2026, language: 'en', listQuery }) },
    { name: 'contacts', field: 'email', header: 'email',
      list: (query) => contacts.list(query, { manager, tenantId }),
      file: (listQuery) => contacts.exportCsv('data', { manager, tenantId, language: 'en', listQuery }) },
    { name: 'contracts', field: 'name', header: 'name',
      list: (query) => contracts.list(query, { manager, budgetAccess: true }),
      file: (listQuery) => contracts.exportCsv('data', { manager, budgetAccess: true, language: 'en', listQuery }) },
    { name: 'cost centers', field: 'name', header: 'name',
      list: (query) => costCentersService.list(query, ctx),
      file: (listQuery) => costCenters.exportCsv('data', ctx, 'en', listQuery) },
    { name: 'departments', field: 'name', header: 'name',
      list: (query) => departments.list(query, { manager }),
      file: (listQuery) => departments.exportCsv('data', { manager, language: 'en', listQuery }) },
    { name: 'suppliers', field: 'name', header: 'name',
      list: (query) => suppliers.list(query, { manager }),
      file: (listQuery) => suppliers.exportCsv('data', { manager, language: 'en', listQuery }) },
    { name: 'users', field: 'email', header: 'email',
      list: (query) => users.list(query, { manager, adminView: true }),
      file: (listQuery) => users.exportCsv('data', { manager, language: 'en', listQuery }) },
    { name: 'working-day calendars', field: 'name', header: 'name',
      list: (query) => calendarsService.list(query, ctx),
      file: (listQuery) => calendars.exportCsv('data', ctx, 'en', listQuery) },
  ];
  for (const item of cases) {
    for (const sort of [`${item.field}:DESC`, `${item.field}:ASC`]) {
      const query = screenQuery({ [item.field]: { filterType: 'text', type: 'contains', filter: 'a' } }, 'alpha', sort);
      const page = await item.list({ ...query, page: 1, limit: 2 });
      const all = await item.list({ ...query, page: 1, limit: 100 });
      assert.ok(page.items.length <= 2, `${item.name}: the screen shows one page`);
      const file = await item.file(dialogQuery(query));
      const listed = all.items.map((row: any) => String(row[item.field]));
      assert.ok(listed.length >= 2 && listed.length < MASTER_NAMES.length, `${item.name} ${sort}: the query keeps some rows (${listed.join('|')})`);
      assert.deepEqual(columnOf(file.content as string, item.header), listed, `${item.name} ${sort}: the export holds the list's rows, in its order`);
      checked.push(`${item.name} ${sort} (${listed.length})`);
    }
  }
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'list-export');
      await seed(runner, tenantId);
      const manager = runner.manager;
      const opts = { manager, tenantId };
      const checked: string[] = [];
      const compare = (list: string, listIds: string[], exported: string[]) => {
        assert.ok(listIds.length >= 2, `${list}: the query keeps several rows (${listIds.length})`);
        assert.deepEqual(exported, listIds, `${list}: the export holds the list's rows, in its order`);
        checked.push(`${list} (${listIds.length})`);
      };

      // Projects: the list route's service, then the export route's path (listIds of the dialog's query).
      const projectsList = new PortfolioProjectsListService(manager.getRepository(PortfolioProject));
      const projectsCsv = new PortfolioProjectsCsvService(manager.getRepository(PortfolioProject), engine, importer, null as any);
      for (const sort of ['name:DESC', 'created_at:ASC']) {
        const query = screenQuery({ status: { filterType: 'set', values: ['in_progress', 'waiting_list'] } }, 'alpha', sort);
        const page = await projectsList.list({ ...query, page: 1, limit: 2 }, opts);
        const all = await projectsList.list({ ...query, page: 1, limit: 100 }, opts);
        assert.ok(page.items.length < all.items.length, 'projects: the screen shows a first page only');
        const { ids } = await projectsList.listIds({ ...dialogQuery(query), __export: true }, opts);
        const file = await projectsCsv.export({ ...opts, language: 'fr', fields: ['id'], ids });
        compare(`projects ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      const requestsService = Object.assign(Object.create(PortfolioRequestsService.prototype), { repo: manager.getRepository(PortfolioRequest) }) as PortfolioRequestsService;
      const requestsCsv = new PortfolioRequestsCsvService(manager.getRepository(PortfolioRequest), engine, importer, null as any);
      for (const sort of ['name:ASC', 'created_at:DESC']) {
        const query = screenQuery({ status: { filterType: 'set', values: ['in_progress', 'waiting_list'] } }, 'alpha', sort);
        const all = await requestsService.list({ ...query, page: 1, limit: 100 }, opts);
        const { ids } = await requestsService.listIds({ ...dialogQuery(query), __export: true }, opts);
        const file = await requestsCsv.export({ ...opts, language: 'fr', fields: ['id'], ids });
        compare(`requests ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      const tasksService = new TasksService(dataSource);
      const tasksCsv = new TasksCsvService(manager.getRepository(Task), engine, importer);
      for (const sort of ['title:DESC', 'created_at:ASC']) {
        const query = screenQuery({ status: { filterType: 'set', values: ['in_progress', 'open'] } }, 'alpha', sort);
        const all = await tasksService.listAllTasks({ ...query, page: 1, limit: 100 }, opts);
        const { ids } = await tasksService.listIds({ ...dialogQuery(query), __export: true }, opts);
        const file = await tasksCsv.export({ ...opts, language: 'fr', fields: ['id'], ids });
        compare(`tasks ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      // Applications and assets: their export reads the list's ids itself, from the query the screen sends.
      const applicationsList = new ApplicationsListService(manager.getRepository(Application));
      const applicationsCsv = new ApplicationsCsvService(
        manager.getRepository(Application), null as any, null as any, engine, importer, new CsvResolverService(), null as any, applicationsList, itOps,
      );
      for (const sort of ['name:DESC', 'created_at:ASC']) {
        const query = screenQuery({ name: { filterType: 'text', type: 'contains', filter: 'a' } }, 'alpha', sort);
        const all = await applicationsList.list({ ...query, page: 1, limit: 100 }, opts);
        const file = await applicationsCsv.export({ ...opts, language: 'fr', fields: ['id'], query });
        compare(`applications ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      const assetsList = new AssetsListService(manager.getRepository(Asset));
      const assetsCsv = new AssetsCsvService(
        manager.getRepository(Asset), engine, importer, itOps, { labelsOf: async () => new Map() } as any, assetsList,
      );
      for (const sort of ['name:DESC', 'created_at:ASC']) {
        const query = screenQuery({ name: { filterType: 'text', type: 'contains', filter: 'a' } }, 'alpha', sort);
        const all = await assetsList.list({ ...query, page: 1, limit: 100 }, { ...opts, language: 'fr' });
        const file = await assetsCsv.export({ ...opts, language: 'fr', fields: ['id'], query });
        compare(`assets ${sort}`, all.items.map((item: any) => item.id), idsOf(file.content));
      }

      await testMasterDataLists(runner, tenantId, checked);
      console.log(`  export rows = list rows, in order: ${checked.join(', ')}: OK`);
    });
  } finally {
    await dataSource.destroy();
  }
  console.log('list-export-follows-list.integration.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
