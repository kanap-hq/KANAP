import 'dotenv/config';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { PermissionGuard } from '../../auth/permission.guard';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { SpendItem } from '../spend-item.entity';
import { SpendItemsController } from '../spend-items.controller';
import { SpendItemsDeleteService } from '../spend-items-delete.service';
import { SpendItemContactsService } from '../spend-item-contacts.service';
import { SpendVersionsController } from '../spend-versions.controller';
import { SpendVersionsService } from '../spend-versions.service';
import { SpendAllocationsService } from '../spend-allocations.service';
import { SpendTasksController } from '../spend-tasks.controller';
import { SpendTasksService } from '../spend-tasks.service';
import { ChargebackReportService } from '../chargeback-report.service';
import { SUMMARY_SCOPES } from '../spend-summary.builder';
import { lockBudgetYear } from '../budget-locks';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { ContractsService } from '../../contracts/contracts.service';
import { SpendItemContractsController } from '../../contracts/spend-item-contracts.controller';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { PortfolioProjectsCrudService } from '../../portfolio/services/portfolio-projects-crud.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { ApplicationsInstancesService } from '../../applications/services/applications-instances.service';
import { AssetsRelationsService } from '../../assets/services/assets-relations.service';
import { AccountsService } from '../../accounts/accounts.service';
import { CostCentersService } from '../../cost-centers/cost-centers.service';
import { AnalyticsAxesService } from '../../analytics/analytics-axes.service';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { ReferenceCheckService } from '../../common/reference-check.service';
import { ScheduledNotificationsService } from '../../notifications/scheduled-notifications.service';
import { CurrencyController } from '../../currency/currency.controller';
import { FreezeService } from '../../freeze/freeze.service';
import { ItemNumberService } from '../../common/item-number.service';
import { spendItemsRegistry } from '../../ai/query/registries/spend-items.registry';
import { AiAggregateExecutor } from '../../ai/query/ai-aggregate.executor';
import { AiFinancialPlanMutationSupportService } from '../../ai/mutation/ai-financial-plan-mutation-support.service';
import { AiRelationMutationSupportService } from '../../ai/mutation/ai-relation-mutation-support.service';
import { AiTaskMutationSupportService } from '../../ai/mutation/ai-task-mutation-support.service';
import { AiBusinessRecordMutationSupportService } from '../../ai/mutation/ai-business-record-mutation-support.service';
import { clearBudgetColumn, copyBudgetColumn } from '../budget-column-operations';
import { copyAllocations } from '../budget-allocation-operations';
import { realSummaryDeps } from './oracle/oracle-deps';
import { itemService, seedCompany, seedCostCenter, seedUser } from './cost-center.fixtures';
import { assert, captureAudit, amountsService, inRolledBackTransaction, period, runSpecs, setTenant } from './round-inputs.fixtures';

// A line of nature `capex` stored in `spend_items` (where every CAPEX line lives since lot Z1),
// inserted by raw SQL with every child the OPEX module knows: a version with months, an
// allocation, an analytics value, a website link, a contact, an attachment, links to an
// application, an asset, a contract, a project and a request, and tasks. The OPEX module never
// sees it (plan planning/budget-unifie.md, lot Z0; rule in `spend/budget-nature.ts`):
// - every route of the module addressed by its id, or by the id of one of its children,
//   answers 404 to a user with the OPEX right only (who passes the guard); a user with the
//   CAPEX right only is stopped by the guard (403) on the OPEX routes and gets the same 404 on
//   the task routes, which the tasks right guards;
// - the list, the summary routes, the dashboard's aggregate, the chargeback report, the OPEX
//   part of the "used by N lines" counts, the expiry reminders, the freeze's FX pin and
//   `lockBudgetYear` answer as if the line did not exist (compared with the same call once the
//   line is deleted), and each would see it if it were OPEX (the same call with the line turned
//   OPEX differs: the check is not vacuous); since lot Z1 the CAPEX part of those counts and the
//   budget years of the currency page count it, as a CAPEX line;
// - a bulk replacement of the OPEX links of an application, an asset, a contract, a project or
//   a request keeps its link to the line;
// - the search index holds no OPX entry for it.
// Everything runs in a transaction rolled back at the end.

const YEAR = 2026;
const ONLY_YEAR = 2033; // a year only the foreign line has months in (within the summary's ten years)
const OPEX_NUMBER = 990101;
const FOREIGN_NUMBER = 990102;
const NOW = new Date('2026-10-10T08:00:00Z');
const IN_SEVEN_DAYS = '2026-10-17T12:00:00Z';

type Level = 'reader' | 'contributor' | 'member' | 'admin';
type World = {
  tenantId: string;
  companyId: string;
  accountId: string;
  supplierId: string;
  /** The supplier of the CAPEX line only: what tells its filter values and references apart. */
  foreignSupplierId: string;
  costCenterId: string;
  axisId: string;
  valueId: string;
  applicationId: string;
  assetId: string;
  contractId: string;
  projectId: string;
  requestId: string;
  contactId: string;
  ownerId: string;
  opexUser: string;
  capexUser: string;
  rateSetId: string;
  opex: { id: string; versionId: string };
  foreign: { id: string; versionId: string; onlyVersionId: string; linkId: string; contactLinkId: string; attachmentId: string; taskId: string; capexTaskId: string };
};

const one = async (runner: QueryRunner, sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;

async function seedRole(runner: QueryRunner, tenantId: string, label: string, permissions: Record<string, Level>): Promise<string> {
  const roleId = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, `Foreign nature ${label}`]);
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
  }
  return one(
    runner,
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Nature', $3, $4, 'enabled') RETURNING id`,
    [tenantId, roleId, label, `${label}-${randomUUID()}@example.invalid`],
  );
}

/** A line (raw insert, as a later migration will write a CAPEX line), its version of `year` with twelve months and a manual allocation. */
async function seedLine(runner: QueryRunner, w: Omit<World, 'opex' | 'foreign'>, nature: 'opex' | 'capex', itemNumber: number, monthly: number, supplierId: string) {
  const id = await one(
    runner,
    `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, paying_company_id,
                              supplier_id, account_id, cost_center_id, owner_it_id, project_id)
     VALUES ($1, $2, $3, $4, 'EUR', '2020-01-01', $5, $6, $7, $8, $9, $10) RETURNING id`,
    [w.tenantId, nature, itemNumber, `${nature} line ${itemNumber}`, w.companyId, supplierId, w.accountId, w.costCenterId, w.ownerId, w.projectId],
  );
  const version = async (year: number) => {
    const versionId = await one(
      runner,
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, $3, 'monthly', $4, $5, 'manual_company') RETURNING id`,
      [w.tenantId, id, `Y${year}`, `${year}-01-01`, year],
    );
    for (let month = 1; month <= 12; month++) {
      await runner.query(
        `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, actual) VALUES ($1, $2, $3, $4, $4)`,
        [w.tenantId, versionId, period(month, year), String(monthly)],
      );
    }
    await runner.query(
      `INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES ($1, $2, $3, 100)`,
      [w.tenantId, versionId, w.companyId],
    );
    return versionId;
  };
  const versionId = await version(YEAR);
  await runner.query(
    `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
    [w.tenantId, id, w.axisId, w.valueId],
  );
  for (const [table, column, owner] of [
    ['application_spend_items', 'application_id', w.applicationId],
    ['asset_spend_items', 'asset_id', w.assetId],
    ['contract_spend_items', 'contract_id', w.contractId],
  ] as const) {
    await runner.query(`INSERT INTO ${table} (tenant_id, ${column}, spend_item_id) VALUES ($1, $2, $3)`, [w.tenantId, owner, id]);
  }
  await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`, [w.tenantId, w.projectId, id]);
  await runner.query(`INSERT INTO portfolio_request_opex (tenant_id, request_id, opex_id) VALUES ($1, $2, $3)`, [w.tenantId, w.requestId, id]);
  return { id, versionId, version };
}

async function seedWorld(runner: QueryRunner): Promise<World> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Foreign nature', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `foreign-nature-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  const { companyId, accountId } = await seedCompany(runner, tenantId, 'Foreign nature company');
  const supplierId = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'OPEX line supplier') RETURNING id`, [tenantId]);
  const foreignSupplierId = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'CAPEX line supplier') RETURNING id`, [tenantId]);
  const costCenterId = await seedCostCenter(runner, tenantId, { code: 'FN1', name: 'Foreign nature center', companyId });
  const axisId = await one(runner, `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'fn_axis', 'Foreign axis') RETURNING id`, [tenantId]);
  const valueId = await one(runner, `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Foreign value') RETURNING id`, [tenantId, axisId]);
  const applicationId = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Foreign nature app') RETURNING id`, [tenantId]);
  const assetId = await one(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Foreign nature asset', 'server', 'prod') RETURNING id`, [tenantId]);
  const contractId = await one(
    runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months)
     VALUES ($1, 'Foreign nature contract', $2, $3, '2026-01-01', 12, 1) RETURNING id`,
    [tenantId, companyId, supplierId],
  );
  const projectId = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Foreign nature project', 990001) RETURNING id`, [tenantId]);
  const requestId = await one(runner, `INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES ($1, 'Foreign nature request', 990001) RETURNING id`, [tenantId]);
  const contactId = await one(runner, `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, 'contact@example.invalid', 'Con', 'Tact') RETURNING id`, [tenantId]);
  const ownerId = await seedUser(runner, tenantId, `owner-${randomUUID()}@example.invalid`);
  const opexUser = await seedRole(runner, tenantId, 'opex-only', { opex: 'admin', tasks: 'member' });
  const capexUser = await seedRole(runner, tenantId, 'capex-only', { capex: 'admin', tasks: 'member' });
  const rateSetId = await one(
    runner,
    `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', '{}'::jsonb) RETURNING id`,
    [tenantId, YEAR],
  );
  const base = {
    tenantId, companyId, accountId, supplierId, foreignSupplierId, costCenterId, axisId, valueId, applicationId, assetId, contractId,
    projectId, requestId, contactId, ownerId, opexUser, capexUser, rateSetId,
  };
  const opex = await seedLine(runner, base, 'opex', OPEX_NUMBER, 100, supplierId);
  const foreignLine = await seedLine(runner, base, 'capex', FOREIGN_NUMBER, 1000, foreignSupplierId);
  const onlyVersionId = await foreignLine.version(ONLY_YEAR);
  const linkId = await one(runner, `INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES ($1, $2, 'https://example.invalid/f') RETURNING id`, [tenantId, foreignLine.id]);
  const contactLinkId = await one(
    runner,
    `INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role) VALUES ($1, $2, $3, 'commercial') RETURNING id`,
    [tenantId, foreignLine.id, contactId],
  );
  const attachmentId = await one(
    runner,
    `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'f.pdf', 'f.pdf', $3) RETURNING id`,
    [tenantId, foreignLine.id, `files/${tenantId}/capex/${foreignLine.id}/f.pdf`],
  );
  const taskId = await one(
    runner,
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, 990001, 'Foreign spend task', 'spend_item', $2) RETURNING id`,
    [tenantId, foreignLine.id],
  );
  const capexTaskId = await one(
    runner,
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, 990002, 'Foreign capex task', 'capex_item', $2) RETURNING id`,
    [tenantId, foreignLine.id],
  );
  return {
    ...base,
    opex: { id: opex.id, versionId: opex.versionId },
    foreign: { id: foreignLine.id, versionId: foreignLine.versionId, onlyVersionId, linkId, contactLinkId, attachmentId, taskId, capexTaskId },
  };
}

/** `fn` in a savepoint rolled back afterwards. */
let savepoints = 0;

/** `fn` in a savepoint of its own, rolled back and released afterwards (they nest). */
async function inSavepoint<T>(runner: QueryRunner, fn: () => Promise<T>): Promise<T> {
  const name = `foreign_variant_${++savepoints}`;
  await runner.query(`SAVEPOINT ${name}`);
  try {
    return await fn();
  } finally {
    await runner.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await runner.query(`RELEASE SAVEPOINT ${name}`);
  }
}

/** `fn` with the foreign line turned OPEX, rolled back afterwards. */
function asOpexLine<T>(runner: QueryRunner, w: World, fn: () => Promise<T>): Promise<T> {
  return inSavepoint(runner, async () => {
    await runner.query(`UPDATE spend_items SET nature = 'opex' WHERE tenant_id = $1 AND id = $2`, [w.tenantId, w.foreign.id]);
    return fn();
  });
}

/**
 * What `read` answers with the foreign line as seeded, once it is deleted (with its children),
 * and once it is turned OPEX: the first two must be equal (the line is invisible), the third
 * must differ (the check sees a line of nature opex).
 */
async function assertInvisible(runner: QueryRunner, w: World, label: string, read: () => Promise<unknown>) {
  const json = async () => JSON.parse(JSON.stringify(await read()));
  const seeded = await json();
  const absent = await inSavepoint(runner, async () => {
    await runner.query(`DELETE FROM spend_items WHERE tenant_id = $1 AND id = $2`, [w.tenantId, w.foreign.id]);
    return json();
  });
  const asOpex = await asOpexLine(runner, w, json);
  assert.deepEqual(seeded, absent, `${label}: the CAPEX line changes nothing`);
  assert.notDeepEqual(asOpex, absent, `${label}: the same line of nature opex would count (the check is not vacuous)`);
}

function buildGuard(): PermissionGuard {
  return new PermissionGuard(
    new Reflector(),
    new (UsersService as any)(dataSource.getRepository(User)),
    new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    dataSource,
    { isConfigured: () => false } as any,
  );
}

async function guardAllows(runner: QueryRunner, w: World, userId: string, controller: any, handler: string, method: string): Promise<boolean> {
  const req: any = { method, user: { sub: userId }, tenant: { id: w.tenantId }, queryRunner: runner };
  const http = { getRequest: () => req, getResponse: () => ({}), getNext: () => undefined };
  const context = {
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
    switchToHttp: () => http,
    getType: () => 'http',
    getArgs: () => [req, {}, undefined],
    getArgByIndex: (i: number) => [req, {}, undefined][i],
  } as unknown as ExecutionContext;
  try {
    return await buildGuard().canActivate(context);
  } catch (err) {
    if (err instanceof HttpException && err.getStatus() === 403) return false;
    throw err;
  }
}

/** The status a handler answers: 200 when it resolves, the HttpException's status otherwise. */
async function statusOf(runner: QueryRunner, call: () => Promise<unknown>): Promise<{ status: number; body?: unknown }> {
  return inSavepoint(runner, async () => {
    try {
      return { status: 200, body: await call() };
    } catch (err) {
      if (err instanceof HttpException) return { status: err.getStatus(), body: err.getResponse() };
      throw err;
    }
  });
}

function controllers(runner: QueryRunner) {
  const none = undefined as any;
  const audit = captureAudit();
  const svc = itemService('opex', audit);
  // Storage, task numbering and activities stubbed: every route answers as it would for an OPEX line.
  const storage = {
    deleteObject: async () => undefined,
    putObject: async () => undefined,
    getObjectStream: async () => ({ stream: { pipe: () => undefined }, contentType: 'application/pdf', contentLength: 1 }),
  };
  svc.storage = storage;
  const items = new SpendItemsController(
    svc,
    new SpendItemsDeleteService(runner.manager.getRepository(SpendItem), none, none, none, audit as any, storage as any, new UserTimeAggregateService()),
    storage as any,
    new SpendItemContactsService(none, none, none, audit as any),
    none,
    audit as any,
    none,
  ) as any;
  const deps = realSummaryDeps(SUMMARY_SCOPES.opex);
  const versions = new SpendVersionsController(
    new SpendVersionsService(none, none, audit as any, { getSettings: async () => ({ reportingCurrency: 'EUR' }) } as any),
    amountsService('opex', audit) as any,
    new SpendAllocationsService(none, none, deps.allocationCalculator as any, audit as any),
  ) as any;
  const unified = new TasksUnifiedService(
    none, audit as any, none, none, { getTaskRecipients: async () => [] } as any, new ItemNumberService(),
    { logChange: async () => undefined } as any, { cleanupOrphanedImages: async () => undefined } as any, none,
  );
  const tasks = new SpendTasksController(new SpendTasksService(unified, audit as any)) as any;
  const contracts = new SpendItemContractsController(new ContractsService(none, none, none, none, audit as any, none, none, none, none)) as any;
  return { svc, items, versions, tasks, contracts };
}

async function testRoutes() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const { items, versions, tasks, contracts } = controllers(runner);
    const ctx = { manager: runner.manager, tenantId: w.tenantId, userId: w.opexUser } as any;
    const req = { queryRunner: runner, user: { sub: w.opexUser }, tenant: { id: w.tenantId } };
    const F = w.foreign;
    const res = { setHeader: () => undefined } as any;
    const file = { originalname: 'x.txt', mimetype: 'text/plain', buffer: Buffer.from('x'), size: 1 } as any;

    // [controller, handler, method, call]: every route addressed by the line's id, reference or a child's id.
    const routes: Array<[any, string, string, () => Promise<unknown>]> = [
      [SpendItemsController, 'get', 'GET', () => items.get(F.id, ctx)],
      [SpendItemsController, 'get', 'GET', () => items.get(`OPX-${FOREIGN_NUMBER}`, ctx)],
      [SpendItemsController, 'get', 'GET', () => items.get(`BL-${FOREIGN_NUMBER}`, ctx)],
      [SpendItemsController, 'get', 'GET', () => items.get(String(FOREIGN_NUMBER), ctx)],
      [SpendItemsController, 'meta', 'GET', () => items.meta(F.id, ctx)],
      [SpendItemsController, 'relationCounts', 'GET', () => items.relationCounts(F.id, ctx)],
      [SpendItemsController, 'yearlyTotals', 'GET', () => items.yearlyTotals(F.id, '2025', '2027', ctx)],
      [SpendItemsController, 'share', 'POST', () => items.share(F.id, { recipient_emails: ['someone@example.invalid'] }, ctx)],
      [SpendItemsController, 'summaryNeighbors', 'GET', () => items.summaryNeighbors({ id: F.id }, ctx)],
      [SpendItemsController, 'listProjects', 'GET', () => items.listProjects(F.id, ctx)],
      [SpendItemsController, 'bulkReplaceProjects', 'POST', () => items.bulkReplaceProjects(F.id, { project_ids: [] }, ctx)],
      [SpendItemsController, 'listApplications', 'GET', () => items.listApplications(F.id, ctx)],
      [SpendItemsController, 'bulkReplaceApplications', 'POST', () => items.bulkReplaceApplications(F.id, { application_ids: [] }, ctx)],
      [SpendItemsController, 'listLinks', 'GET', () => items.listLinks(F.id, ctx)],
      [SpendItemsController, 'createLink', 'POST', () => items.createLink(F.id, { url: 'https://example.invalid/new' }, ctx)],
      [SpendItemsController, 'updateLink', 'PATCH', () => items.updateLink(F.id, F.linkId, { url: 'https://example.invalid/upd' }, ctx)],
      [SpendItemsController, 'deleteLink', 'DELETE', () => items.deleteLink(F.id, F.linkId, ctx)],
      [SpendItemsController, 'downloadAttachment', 'GET', () => items.downloadAttachment(F.attachmentId, res, ctx)],
      [SpendItemsController, 'deleteAttachment', 'PATCH', () => items.deleteAttachment(F.attachmentId, ctx)],
      [SpendItemsController, 'listAttachments', 'GET', () => items.listAttachments(F.id, ctx)],
      [SpendItemsController, 'uploadAttachment', 'POST', () => items.uploadAttachment(F.id, file, ctx)],
      [SpendItemsController, 'listContacts', 'GET', () => items.listContacts(F.id, ctx)],
      [SpendItemsController, 'attachContact', 'POST', () => items.attachContact(F.id, { contactId: w.contactId, role: 'technical' }, ctx)],
      [SpendItemsController, 'detachContact', 'DELETE', () => items.detachContact(F.id, F.contactLinkId, ctx)],
      [SpendItemsController, 'syncContactsFromSupplier', 'POST', () => items.syncContactsFromSupplier(F.id, ctx)],
      [SpendItemsController, 'update', 'PATCH', () => items.update(F.id, { notes: 'Written through OPEX' }, ctx)],
      [SpendItemsController, 'delete', 'DELETE', () => items.delete(F.id, ctx)],
      [SpendVersionsController, 'listForItem', 'GET', () => versions.listForItem(F.id, req)],
      [SpendVersionsController, 'createForItem', 'POST', () => versions.createForItem(F.id, { version_name: 'New', budget_year: 2030 }, req)],
      [SpendVersionsController, 'updateForItem', 'PATCH', () => versions.updateForItem(F.id, { id: F.versionId, notes: 'x' }, req)],
      [SpendVersionsController, 'upsertAmounts', 'POST', () => versions.upsertAmounts(F.versionId, { kind: 'annual', year: YEAR, totals: { planned: 1 } }, req)],
      [SpendVersionsController, 'upsertAllocations', 'POST', () => versions.upsertAllocations(F.versionId, { items: [{ company_id: w.companyId, department_id: null, allocation_pct: 100 }] }, req)],
      [SpendVersionsController, 'putAllocations', 'PUT', () => versions.putAllocations(F.versionId, { method: 'default' }, req)],
      [SpendVersionsController, 'listAllocations', 'GET', () => versions.listAllocations(F.versionId, req)],
      [SpendVersionsController, 'listAmounts', 'GET', () => versions.listAmounts(F.versionId, String(YEAR), req)],
      [SpendVersionsController, 'listAmounts', 'GET', () => versions.listAmounts(F.versionId, undefined, req)],
      [SpendTasksController, 'list', 'GET', () => tasks.list(F.id, req)],
      [SpendTasksController, 'create', 'POST', () => tasks.create(F.id, { title: 'Through OPEX' }, req)],
      [SpendTasksController, 'update', 'PATCH', () => tasks.update(F.id, { id: F.taskId, title: 'Through OPEX' }, req)],
      [SpendItemContractsController, 'list', 'GET', () => contracts.list(F.id, req)],
      [SpendItemContractsController, 'bulkReplace', 'POST', () => contracts.bulkReplace(F.id, { contract_ids: [] }, req)],
    ];
    const before = await runner.query(
      `SELECT (SELECT row_version FROM spend_items WHERE id = $1) AS rv,
              (SELECT count(*)::int FROM spend_links WHERE spend_item_id = $1) AS links,
              (SELECT count(*)::int FROM spend_attachments WHERE spend_item_id = $1) AS attachments,
              (SELECT count(*)::int FROM spend_item_contacts WHERE spend_item_id = $1) AS contacts,
              (SELECT count(*)::int FROM spend_versions WHERE spend_item_id = $1) AS versions`,
      [F.id],
    );
    for (const [controller, handler, method, call] of routes) {
      const label = `${controller.name}.${handler}`;
      assert.equal(await guardAllows(runner, w, w.opexUser, controller, handler, method), true, `${label}: the OPEX user passes the guard`);
      const answer = await statusOf(runner, call);
      assert.equal(answer.status, 404, `${label}: 404 for the CAPEX line (${JSON.stringify(answer.body)})`);
      // The same call on the same line turned OPEX answers: the 404 is the nature's, nothing else's.
      const asOpex = await asOpexLine(runner, w, () => statusOf(runner, call));
      assert.equal(asOpex.status, 200, `${label}: 200 once the line is OPEX (${JSON.stringify(asOpex.body)?.slice(0, 200)})`);
      const tasksRoute = controller === SpendTasksController;
      assert.equal(await guardAllows(runner, w, w.capexUser, controller, handler, method), tasksRoute,
        `${label}: the CAPEX user ${tasksRoute ? 'passes the tasks guard (and gets the 404 above)' : 'is stopped by the guard'}`);
    }

    // A bulk delete names nothing: the line is not found, its name stays hidden, it is kept.
    const bulk = await statusOf(runner, () => items.bulkDelete({ ids: [F.id] }, ctx));
    assert.equal(bulk.status, 200);
    assert.deepEqual((bulk.body as any).deleted, [], 'nothing deleted');
    assert.equal((bulk.body as any).failed[0].name, 'Unknown', 'the CAPEX line\'s name is not given');
    const after = await runner.query(
      `SELECT (SELECT row_version FROM spend_items WHERE id = $1) AS rv,
              (SELECT count(*)::int FROM spend_links WHERE spend_item_id = $1) AS links,
              (SELECT count(*)::int FROM spend_attachments WHERE spend_item_id = $1) AS attachments,
              (SELECT count(*)::int FROM spend_item_contacts WHERE spend_item_id = $1) AS contacts,
              (SELECT count(*)::int FROM spend_versions WHERE spend_item_id = $1) AS versions`,
      [F.id],
    );
    assert.deepEqual(after, before, 'the CAPEX line and its children are untouched');

    // Control: the OPEX line answers through the same routes and references.
    assert.equal((await items.get(w.opex.id, ctx)).id, w.opex.id, 'the OPEX line by id');
    assert.equal((await items.get(`BL-${OPEX_NUMBER}`, ctx)).id, w.opex.id, 'the OPEX line by BL-n');
    assert.equal((await items.get(`OPX-${OPEX_NUMBER}`, ctx)).nature, 'opex', 'the OPEX line by OPX-n, with its nature');
    assert.equal((await versions.listForItem(w.opex.id, req)).length, 1, 'the OPEX line\'s version');
  });
}

async function testListsAndSummaries() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const { items } = controllers(runner);
    const ctx = { manager: runner.manager, tenantId: w.tenantId, userId: w.opexUser, isAdmin: true } as any;
    const query = { includeDisabled: 'true', years: `${YEAR},${ONLY_YEAR}` };
    await assertInvisible(runner, w, 'GET /spend-items', () => items.list({ includeDisabled: 'true' }, ctx));
    await assertInvisible(runner, w, 'GET /spend-items/summary', () => items.summary(query, ctx));
    await assertInvisible(runner, w, 'GET /spend-items/summary (grid)', () => items.summary({ ...query, shape: 'grid' }, ctx));
    await assertInvisible(runner, w, 'GET /spend-items/summary/ids', () => items.summaryIds(query, ctx));
    await assertInvisible(runner, w, 'GET /spend-items/summary/totals', () => items.summaryTotals(query, ctx));
    await assertInvisible(runner, w, 'GET /spend-items/summary/filter-values',
      () => items.summaryFilterValues({ ...query, fields: 'supplier_name,account_display,project_name,cost_center_label,currency' }, ctx));
    await assertInvisible(runner, w, 'POST /spend-items/summary/aggregate (dashboard)',
      () => items.summaryAggregate({ query, spec: { groupBy: [], measures: [{ id: 'b', fn: 'sum', field: 'yBudget' }] } }, ctx));
    const summary = await items.summary(query, ctx);
    assert.deepEqual(summary.items.map((row: any) => [row.id, row.nature]), [[w.opex.id, 'opex']], 'the summary lists the OPEX line, with its nature');
    const detail = await items.get(w.opex.id, ctx);
    assert.equal(detail.nature, 'opex', 'the detail says its nature');
    assert.equal('legacy_number' in detail, false, 'the legacy number is not part of the detail');

    const deps = realSummaryDeps(SUMMARY_SCOPES.opex);
    const chargeback = new ChargebackReportService({ manager: runner.manager } as any, deps.allocationCalculator as any, deps.fxRates as any);
    await assertInvisible(runner, w, 'chargeback report', () => chargeback.generateGlobal(YEAR, 'budget', w.tenantId, { manager: runner.manager }));
    await assertInvisible(runner, w, 'chargeback report of the company',
      () => chargeback.generateCompany(YEAR, 'budget', w.companyId, w.tenantId, { manager: runner.manager }));

    // The search index: an OPX entry for the OPEX line only.
    const entries: Array<{ entity_id: string }> = await runner.query(
      `SELECT entity_id FROM search_index WHERE tenant_id = $1 AND entity_type = 'spend_items' ORDER BY entity_id`,
      [w.tenantId],
    );
    assert.deepEqual(entries.map((e) => e.entity_id), [w.opex.id], 'no OPX entry for the CAPEX line');
  });
}

async function testCountsAndPeriphery() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const none = undefined as any;
    const audit = captureAudit() as any;
    const mg = runner.manager;
    const ctx = { manager: mg, tenantId: w.tenantId, userId: w.opexUser } as any;

    // "Used by N lines". Since lot Z1 the account counts the CAPEX lines of spend_items under `capex`:
    // the foreign line counts there, and never under `opex`.
    const accountCounts = async () => (await new AccountsService(none, audit).getWithConsolidationStatus(w.accountId, { manager: mg })).line_counts;
    assert.deepEqual(await accountCounts(), { opex: 1, capex: 1 }, 'account line counts: the CAPEX line counts as CAPEX');
    await assertInvisible(runner, w, 'account OPEX line count', async () => (await accountCounts()).opex);
    const centers = new CostCentersService(audit);
    const centerUsage = async () => [...(await centers.countUsage(ctx, [w.costCenterId])).values()];
    assert.deepEqual(await centerUsage(), [{ opex: 1, capex: 1 }], 'cost center counts: the CAPEX line counts as CAPEX');
    await assertInvisible(runner, w, 'cost center OPEX counts', async () => ({ detail: (await centers.get(w.costCenterId, ctx)).opex_count, usage: (await centerUsage()).map((u) => u.opex) }));
    await assertInvisible(runner, w, 'dimension counts', async () => {
      const axis = await new AnalyticsAxesService(audit).get(w.axisId, ctx);
      return { opex_count: (axis as any).opex_count, opex_missing: (axis as any).opex_missing };
    });
    const valueUsage = async () => [...(await new AnalyticsCategoriesService(none, audit).countUsage(ctx, [w.valueId])).values()];
    assert.deepEqual(await valueUsage(), [{ opex: 1, capex: 1 }], 'value counts: the CAPEX line counts as CAPEX');
    await assertInvisible(runner, w, 'value OPEX counts', async () => (await valueUsage()).map((u) => u.opex));
    const references = new ReferenceCheckService();
    // A company's references name its CAPEX lines too (as before lot Z1): the foreign line is one of them.
    const companyRefs = async () => (await references.checkCompanyReferences(w.companyId, { manager: mg })).referenceDetails;
    assert.ok((await companyRefs()).includes('1 CAPEX item(s) reference this as paying company'), 'company references: the CAPEX line counts as CAPEX');
    await assertInvisible(runner, w, 'reference checks', async () => ({
      company: (await companyRefs()).filter((detail) => detail.includes('OPEX')),
      supplier: await references.checkSupplierReferences(w.foreignSupplierId, { manager: mg }),
      account: await references.checkAccountReferences(w.accountId, { manager: mg }),
    }));

    // The budget years of the currency page count the months of both natures (the CAPEX ones came
    // from capex_amounts before lot Z1): the year only the CAPEX line has is one of them.
    const currency = new CurrencyController(none, none, none) as any;
    const years: number[] = await currency.findBudgetYears(mg);
    assert.ok(years.includes(YEAR) && years.includes(ONLY_YEAR), `the currency years count the CAPEX line's months (${years})`);

    // The expiry reminders: one warning, for the OPEX line.
    await runner.query(`UPDATE spend_items SET disabled_at = $3 WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [w.tenantId, [w.opex.id, w.foreign.id], IN_SEVEN_DAYS]);
    const warned: string[] = [];
    const notifier = new ScheduledNotificationsService(none, none, none, { notifyExpirationWarning: async (p: any) => { warned.push(p.itemId); } } as any, none, none) as any;
    await assertInvisible(runner, w, 'expiry reminder candidates', async () => notifier.checkOpexExpirationsForTenant(mg, w.tenantId, NOW));
    warned.length = 0;
    await notifier.checkOpexExpirationsForTenant(mg, w.tenantId, NOW);
    assert.deepEqual(warned, [w.opex.id], 'the OPEX line is warned once, the CAPEX line never');
    await runner.query(`UPDATE spend_items SET disabled_at = NULL WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [w.tenantId, [w.opex.id, w.foreign.id]]);

    // The freeze's FX pin and lockBudgetYear: the OPEX versions only.
    assert.deepEqual(await lockBudgetYear(mg, 'opex', w.tenantId, YEAR), [w.opex.versionId], 'lockBudgetYear locks the OPEX version only');
    const freeze = new FreezeService(
      none,
      { refreshTenant: async () => undefined } as any,
      { getLatestRateSet: async () => ({ id: w.rateSetId }) } as any,
      { getSettings: async () => ({ reportingCurrency: 'EUR' }) } as any,
    ) as any;
    const pinned = async () => (await runner.query(
      `SELECT id, fx_rate_set_id FROM spend_versions WHERE tenant_id = $1 AND budget_year = $2 ORDER BY id`, [w.tenantId, YEAR],
    )).filter((row: any) => row.fx_rate_set_id).map((row: any) => row.id);
    await freeze.attachFxRates('opex', YEAR, w.tenantId, mg);
    assert.deepEqual(await pinned(), [w.opex.versionId], 'the freeze pins the OPEX version only');
    await runner.query(`UPDATE spend_versions SET fx_rate_set_id = $2 WHERE tenant_id = $1 AND budget_year = ${YEAR}`, [w.tenantId, w.rateSetId]);
    await freeze.detachFxRates('opex', YEAR, w.tenantId, mg);
    assert.deepEqual(await pinned(), [w.foreign.versionId], 'an unfreeze unpins the OPEX version only');
  });
}

async function testBulkReplacements() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const none = undefined as any;
    const audit = captureAudit() as any;
    const mg = runner.manager;
    const links = async () => (await runner.query(
      `SELECT 'application' AS kind, spend_item_id AS item FROM application_spend_items WHERE tenant_id = $1
       UNION ALL SELECT 'asset', spend_item_id FROM asset_spend_items WHERE tenant_id = $1
       UNION ALL SELECT 'contract', spend_item_id FROM contract_spend_items WHERE tenant_id = $1
       UNION ALL SELECT 'project', opex_id FROM portfolio_project_opex WHERE tenant_id = $1
       UNION ALL SELECT 'request', opex_id FROM portfolio_request_opex WHERE tenant_id = $1
       ORDER BY 1, 2`,
      [w.tenantId],
    )).map((row: any) => `${row.kind}:${row.item === w.foreign.id ? 'capex' : 'opex'}`).sort();
    assert.deepEqual(await links(), ['application:capex', 'application:opex', 'asset:capex', 'asset:opex', 'contract:capex', 'contract:opex', 'project:capex', 'project:opex', 'request:capex', 'request:opex'].sort());

    const apps = new ApplicationsInstancesService(none, none, audit);
    assert.deepEqual((await apps.listLinkedSpendItems(w.applicationId, { manager: mg })).items.map((i: any) => i.id), [w.opex.id], 'an application lists its OPEX line only');
    await apps.bulkReplaceLinkedSpendItems(w.applicationId, [], w.opexUser, { manager: mg });
    const assets = new AssetsRelationsService(none, none, none, none, audit);
    assert.deepEqual((await assets.listLinkedSpendItems(w.assetId, { manager: mg, tenantId: w.tenantId })).items.map((i: any) => i.id), [w.opex.id], 'an asset lists its OPEX line only');
    await assets.bulkReplaceLinkedSpendItems(w.assetId, [], w.tenantId, w.opexUser, { manager: mg, tenantId: w.tenantId });
    const contracts = new ContractsService(none, none, none, none, audit, none, none, none, none);
    assert.deepEqual((await contracts.listLinkedSpendItems(w.contractId, { manager: mg })).items.map((i: any) => i.id), [w.opex.id], 'a contract lists its OPEX line only');
    await contracts.bulkReplaceLinkedSpendItems(w.contractId, [], { manager: mg });
    const projects = new PortfolioProjectsCrudService(mg.getRepository('PortfolioProject') as any, none, audit, none, none, none, none);
    await projects.bulkReplaceOpex(w.projectId, [], { manager: mg, userId: w.opexUser });
    const requests = new PortfolioRequestsService(none, audit, none, none, none, none, none, none, none);
    await requests.bulkReplaceOpex(w.requestId, [], { manager: mg, userId: w.opexUser });
    assert.deepEqual(await links(), ['application:capex', 'asset:capex', 'contract:capex', 'project:capex', 'request:capex'],
      'emptying the OPEX links removes the OPEX line\'s links only');

    // An id of the CAPEX line is refused (or not linked) through the OPEX side.
    const refused = await statusOf(runner, () => apps.bulkReplaceLinkedSpendItems(w.applicationId, [w.foreign.id], w.opexUser, { manager: mg }));
    assert.equal(refused.status, 400, 'an application refuses the CAPEX line as an OPEX line');
    const refusedAsset = await statusOf(runner, () => assets.bulkReplaceLinkedSpendItems(w.assetId, [w.foreign.id], w.tenantId, w.opexUser, { manager: mg, tenantId: w.tenantId }));
    assert.equal(refusedAsset.status, 400, 'an asset refuses it');
    const refusedContract = await statusOf(runner, () => contracts.bulkReplaceLinkedSpendItems(w.contractId, [w.foreign.id], { manager: mg }));
    assert.equal(refusedContract.status, 400, 'a contract refuses it');

    // A project or a request refuses an unknown id or the CAPEX line's id before writing anything:
    // no link, no activity (an unknown id was a 409 from the foreign key before lot Z0).
    const activities = async () => (await runner.query(`SELECT count(*)::int AS n FROM portfolio_activities WHERE tenant_id = $1`, [w.tenantId]))[0].n;
    const linksBefore = await links();
    const activitiesBefore = await activities();
    for (const [label, ids] of [['an unknown id', [w.opex.id, randomUUID()]], ['the CAPEX line', [w.opex.id, w.foreign.id]]] as const) {
      const project = await statusOf(runner, () => projects.bulkReplaceOpex(w.projectId, [...ids], { manager: mg, userId: w.opexUser }));
      assert.deepEqual([project.status, (project.body as any)?.message], [400, 'One or more OPEX items were not found.'], `a project refuses ${label}`);
      const request = await statusOf(runner, () => requests.bulkReplaceOpex(w.requestId, [...ids], { manager: mg, userId: w.opexUser }));
      assert.deepEqual([request.status, (request.body as any)?.message], [400, 'One or more OPEX items were not found.'], `a request refuses ${label}`);
    }
    assert.deepEqual(await links(), linksBefore, 'no link written by a refused replacement');
    assert.equal(await activities(), activitiesBefore, 'no activity written by a refused replacement');
    // Control: the OPEX line is linked again, and the CAPEX line's id is accepted once it is OPEX.
    const relinked = await statusOf(runner, () => projects.bulkReplaceOpex(w.projectId, [w.opex.id], { manager: mg, userId: w.opexUser }));
    assert.deepEqual(relinked.body, { ok: true, added: 1, removed: 0 }, 'a project takes its OPEX line');
    const opexProject = await asOpexLine(runner, w, () => statusOf(runner, () => projects.bulkReplaceOpex(w.projectId, [w.opex.id, w.foreign.id], { manager: mg, userId: w.opexUser })));
    assert.equal(opexProject.status, 200, 'the same ids pass once the line is OPEX');
  });
}

/** The AI's readers and writers of OPEX lines: none sees the CAPEX line; each sees it once it is OPEX. */
async function testAi() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const none = undefined as any;
    const audit = captureAudit() as any;
    const context: any = { manager: runner.manager, tenantId: w.tenantId, userId: w.opexUser, isPlatformHost: false, surface: 'chat', authMethod: 'jwt' };
    const fin: any = new AiFinancialPlanMutationSupportService(audit, none, none, none, none, none, none);
    const task: any = new AiTaskMutationSupportService();
    const rel: any = new AiRelationMutationSupportService(audit, none, task);
    const biz: any = new (AiBusinessRecordMutationSupportService as any)(...Array.from({ length: 20 }, (_, i) => (i === 2 ? audit : undefined)));
    const aggregate: any = new (AiAggregateExecutor as any)();
    const appSpendItems = {
      sourceEntity: 'applications', relation: 'spend_items', label: 'Spend Items', table: 'application_spend_items',
      sourceColumn: 'application_id', targetColumn: 'spend_item_id', target: 'spend_items', businessResource: 'applications', kind: 'simple',
    };
    const F = w.foreign.id;
    const has = (ids: string[]) => ids.includes(F);
    // [label, probe, does the answer contain the foreign line?]
    const probes: Array<[string, () => Promise<unknown>, (answer: { status: number; body?: any }) => boolean]> = [
      ['financial plan: line by id', () => fin.resolveItem(context, 'spend_items', F), (a) => a.status === 200 && a.body.id === F],
      ['financial plan: line by name', () => fin.resolveItem(context, 'spend_items', `capex line ${FOREIGN_NUMBER}`), (a) => a.status === 200 && a.body.id === F],
      ['relations: reference candidates', async () => (await rel.queryReferenceCandidates(context, 'spend_items', F)).map((r: any) => r.id), (a) => has(a.body)],
      ['relations: an application\'s OPEX lines', async () => (await rel.loadRelationItems(context, appSpendItems, w.applicationId)).map((i: any) => i.key), (a) => has(a.body)],
      ['tasks: exact target', () => task.getExactTarget(context, 'spend_item', F), (a) => a.status === 200 && a.body.id === F],
      ['tasks: target search', async () => (await task.searchTargetCandidates(context, 'spend_item', 'line', 10)).map((c: any) => c.id), (a) => has(a.body)],
      ['business records: reference by id', async () => (await biz.queryReferenceCandidates(context, 'spend_items', F)).map((r: any) => r.id), (a) => has(a.body)],
      ['business records: reference by BL-n', async () => (await biz.queryReferenceCandidates(context, 'spend_items', `BL-${FOREIGN_NUMBER}`)).map((r: any) => r.id), (a) => has(a.body)],
      ['registry baseWhere: aggregate by ids', async () => (await aggregate.aggregateByIds(context, spendItemsRegistry, 'supplier', [w.opex.id, F], 'count', null)).map((r: any) => r.key),
        (a) => a.body.includes('CAPEX line supplier')],
    ];
    for (const [label, probe, seesForeign] of probes) {
      const asCapex = await statusOf(runner, probe);
      assert.ok(asCapex.status === 404 || (asCapex.status === 200 && !seesForeign(asCapex)), `AI ${label}: the CAPEX line is not found (${JSON.stringify(asCapex)})`);
      const asOpex = await asOpexLine(runner, w, () => statusOf(runner, probe));
      assert.ok(seesForeign(asOpex), `AI ${label}: found once the line is OPEX (${JSON.stringify(asOpex)})`);
    }
    // Replacing an application's OPEX lines through the AI keeps its link to the CAPEX line.
    const kept = await inSavepoint(runner, async () => {
      await rel.replaceSimpleRelation(context, appSpendItems, w.applicationId, []);
      return (await runner.query(`SELECT spend_item_id FROM application_spend_items WHERE tenant_id = $1 AND application_id = $2`, [w.tenantId, w.applicationId]))
        .map((row: any) => row.spend_item_id);
    });
    assert.deepEqual(kept, [F], 'the AI relation replace removes the OPEX link and keeps the CAPEX one');
  });
}

/** The column copy and clear and the allocation copy write the OPEX lines only. */
async function testBulkOperations() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const audit = captureAudit() as any;
    const deps: any = { manager: runner.manager, audit, freeze: { assertNotFrozen: async () => undefined } };
    const calculator = realSummaryDeps(SUMMARY_SCOPES.opex).allocationCalculator as any;
    const state = async (itemId: string) => runner.query(
      `SELECT v.budget_year, v.allocation_method, v.budget_rev, sum(a.planned)::text AS planned, sum(a.committed)::text AS committed,
              (SELECT count(*) FROM spend_allocations al WHERE al.tenant_id = v.tenant_id AND al.version_id = v.id)::int AS allocations
         FROM spend_versions v LEFT JOIN spend_amounts a ON a.tenant_id = v.tenant_id AND a.version_id = v.id
        WHERE v.tenant_id = $1 AND v.spend_item_id = $2
        GROUP BY v.id ORDER BY v.budget_year`,
      [w.tenantId, itemId],
    );
    const operations: Array<[string, () => Promise<unknown>]> = [
      ['column copy in the year', () => copyBudgetColumn(deps, 'opex', { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'revision', percentageIncrease: 0, overwrite: true, dryRun: false, acceptCalendarChanges: true }, w.opexUser)],
      ['column copy to another year', () => copyBudgetColumn(deps, 'opex', { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0, overwrite: true, dryRun: false, acceptCalendarChanges: true }, w.opexUser)],
      ['column clear', () => clearBudgetColumn(deps, 'opex', { year: YEAR, column: 'budget' }, w.opexUser)],
      ['allocation copy', () => copyAllocations({ manager: runner.manager, audit, calculator }, 'opex', { sourceYear: YEAR, destinationYear: YEAR + 2, overwrite: true, dryRun: false }, w.opexUser)],
    ];
    for (const [label, operation] of operations) {
      const [opexBefore, foreignBefore] = [await state(w.opex.id), await state(w.foreign.id)];
      const after = await inSavepoint(runner, async () => {
        await operation();
        return { opex: await state(w.opex.id), foreign: await state(w.foreign.id) };
      });
      assert.deepEqual(after.foreign, foreignBefore, `${label}: the CAPEX line and its versions are untouched`);
      assert.notDeepEqual(after.opex, opexBefore, `${label}: the OPEX line is written`);
      const asOpex = await asOpexLine(runner, w, async () => {
        await operation();
        return state(w.foreign.id);
      });
      assert.notDeepEqual(asOpex, foreignBefore, `${label}: the same line of nature opex is written`);
    }
  });
}

runSpecs('budget-line-foreign-nature.integration.spec', [
  ['routes answer 404 for a line of nature capex', testRoutes],
  ['lists, summaries, chargeback and search leave it out', testListsAndSummaries],
  ['OPEX counts, reminders, freeze and year locks leave it out; CAPEX counts and currency years count it as CAPEX', testCountsAndPeriphery],
  ['bulk replacements keep its links and refuse its id', testBulkReplacements],
  ['the AI readers and writers leave it out', testAi],
  ['column copies and clears and allocation copies leave it out', testBulkOperations],
]);
