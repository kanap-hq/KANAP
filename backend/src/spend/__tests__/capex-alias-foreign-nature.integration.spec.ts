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
import { CapexItemsController } from '../capex-items.controller';
import { CapexVersionsController } from '../capex-versions.controller';
import { CapexTasksController } from '../capex-tasks.controller';
import { CapexItemsDeleteService } from '../spend-items-delete.service';
import { CapexItemContactsService } from '../spend-item-contacts.service';
import { CapexVersionsService } from '../spend-versions.service';
import { CapexAllocationsService } from '../spend-allocations.service';
import { SUMMARY_SCOPES } from '../spend-summary.builder';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { ItemNumberService } from '../../common/item-number.service';
import { realSummaryDeps } from './oracle/oracle-deps';
import { itemService, seedCompany } from './cost-center.fixtures';
import { assert, captureAudit, amountsService, inRolledBackTransaction, period, runSpecs, setTenant } from './round-inputs.fixtures';

// The CAPEX routes (`/capex-items*`, `/capex-versions*`, aliases on the single family since lot
// Z1 of plan planning/budget-unifie.md) never reach an OPEX line, the mirror of
// `budget-line-foreign-nature.integration.spec.ts` (a CAPEX line through the OPEX routes):
// - every CAPEX route addressed by an OPEX line's id, reference (BL-n, OPX-n, bare number) or the
//   id of one of its children answers 404 (an OPX-n reference 400, as before) to a user with the CAPEX right only (who passes the
//   guard); the same call answers once the line is turned CAPEX (the 404 is the nature's); a user
//   with the OPEX right only is stopped by the guard (403), except on the task routes, which the
//   tasks right guards and which answer 404 to him too;
// - a bulk delete through the CAPEX routes names nothing and keeps the OPEX line and its children;
// - a CAPEX line answers through the same routes, by UUID, CPX-n, BL-n and bare number, with its
//   CPX number in `item_number` and its BL number in `reference`.
// Everything runs in a transaction rolled back at the end.

const YEAR = 2026;
const OPEX_NUMBER = 990201;
const CAPEX_NUMBER = 990202;
const CAPEX_CPX = 41;

type Level = 'reader' | 'contributor' | 'member' | 'admin';
type World = {
  tenantId: string;
  companyId: string;
  contactId: string;
  projectId: string;
  applicationId: string;
  opexUser: string;
  capexUser: string;
  opex: { id: string; versionId: string; linkId: string; contactLinkId: string; attachmentId: string; taskId: string };
  capex: { id: string; versionId: string };
};

const one = async (runner: QueryRunner, sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;

async function seedRole(runner: QueryRunner, tenantId: string, label: string, permissions: Record<string, Level>): Promise<string> {
  const roleId = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, `CAPEX alias ${label}`]);
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
  }
  return one(
    runner,
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Alias', $3, $4, 'enabled') RETURNING id`,
    [tenantId, roleId, label, `${label}-${randomUUID()}@example.invalid`],
  );
}

/** A line of `nature` with a version of YEAR (twelve months) and a manual allocation. */
async function seedLine(runner: QueryRunner, tenantId: string, companyId: string, nature: 'opex' | 'capex', itemNumber: number) {
  const capex = nature === 'capex';
  const id = await one(
    runner,
    `INSERT INTO spend_items (tenant_id, nature, item_number, legacy_number, product_name, currency, effective_start, paying_company_id,
                              ppe_type, investment_type, priority)
     VALUES ($1, $2, $3, $4, $5, 'EUR', '2020-01-01', $6, $7, $8, $9) RETURNING id`,
    [
      tenantId, nature, itemNumber, capex ? `CPX-${CAPEX_CPX}` : `OPX-${itemNumber}`, `${nature} line ${itemNumber}`, companyId,
      capex ? 'hardware' : null, capex ? 'replacement' : null, capex ? 'medium' : null,
    ],
  );
  const versionId = await one(
    runner,
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, $3, 'monthly', $4, $5, 'manual_company') RETURNING id`,
    [tenantId, id, `Y${YEAR}`, `${YEAR}-01-01`, YEAR],
  );
  for (let month = 1; month <= 12; month++) {
    await runner.query(`INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, $3, 100)`, [tenantId, versionId, period(month, YEAR)]);
  }
  await runner.query(
    `INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES ($1, $2, $3, 100)`,
    [tenantId, versionId, companyId],
  );
  return { id, versionId };
}

async function seedWorld(runner: QueryRunner): Promise<World> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'CAPEX alias', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `capex-alias-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  const { companyId } = await seedCompany(runner, tenantId, 'CAPEX alias company');
  const contactId = await one(runner, `INSERT INTO contacts (tenant_id, email) VALUES ($1, 'alias@example.invalid') RETURNING id`, [tenantId]);
  const projectId = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Alias project', 990201) RETURNING id`, [tenantId]);
  const applicationId = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Alias app') RETURNING id`, [tenantId]);
  const opexUser = await seedRole(runner, tenantId, 'opex-only', { opex: 'admin', tasks: 'member' });
  const capexUser = await seedRole(runner, tenantId, 'capex-only', { capex: 'admin', tasks: 'member' });
  const opex = await seedLine(runner, tenantId, companyId, 'opex', OPEX_NUMBER);
  const capex = await seedLine(runner, tenantId, companyId, 'capex', CAPEX_NUMBER);
  const linkId = await one(runner, `INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES ($1, $2, 'https://example.invalid/o') RETURNING id`, [tenantId, opex.id]);
  const contactLinkId = await one(
    runner,
    `INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role) VALUES ($1, $2, $3, 'commercial') RETURNING id`,
    [tenantId, opex.id, contactId],
  );
  const attachmentId = await one(
    runner,
    `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'o.pdf', 'o.pdf', $3) RETURNING id`,
    [tenantId, opex.id, `files/${tenantId}/spend/${opex.id}/o.pdf`],
  );
  const taskId = await one(
    runner,
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, 990201, 'OPEX task', 'capex_item', $2) RETURNING id`,
    [tenantId, opex.id],
  );
  return {
    tenantId, companyId, contactId, projectId, applicationId, opexUser, capexUser,
    opex: { ...opex, linkId, contactLinkId, attachmentId, taskId },
    capex,
  };
}

let savepoints = 0;

/** `fn` in a savepoint of its own, rolled back and released afterwards (they nest). */
async function inSavepoint<T>(runner: QueryRunner, fn: () => Promise<T>): Promise<T> {
  const name = `alias_variant_${++savepoints}`;
  await runner.query(`SAVEPOINT ${name}`);
  try {
    return await fn();
  } finally {
    await runner.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await runner.query(`RELEASE SAVEPOINT ${name}`);
  }
}

/** `fn` with the OPEX line turned CAPEX (enums and a CPX number of its own number), rolled back afterwards. */
function asCapexLine<T>(runner: QueryRunner, w: World, fn: () => Promise<T>): Promise<T> {
  return inSavepoint(runner, async () => {
    await runner.query(
      `UPDATE spend_items SET nature = 'capex', legacy_number = 'CPX-' || item_number, ppe_type = 'software', investment_type = 'other', priority = 'low'
        WHERE tenant_id = $1 AND id = $2`,
      [w.tenantId, w.opex.id],
    );
    return fn();
  });
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
  const svc = itemService('capex', audit);
  // Storage, task numbering and activities stubbed: every route answers as it would for a CAPEX line.
  const storage = {
    deleteObject: async () => undefined,
    putObject: async () => undefined,
    getObjectStream: async () => ({ stream: { pipe: () => undefined }, contentType: 'application/pdf', contentLength: 1 }),
  };
  svc.storage = storage;
  const items = new CapexItemsController(
    svc,
    new CapexItemsDeleteService(runner.manager.getRepository(SpendItem), none, none, none, audit as any, storage as any, new UserTimeAggregateService()),
    storage as any,
    new CapexItemContactsService(none, none, none, audit as any),
    none,
    audit as any,
    none,
  ) as any;
  const deps = realSummaryDeps(SUMMARY_SCOPES.capex);
  const versions = new CapexVersionsController(
    new CapexVersionsService(none, none, audit as any, { getSettings: async () => ({ reportingCurrency: 'EUR' }) } as any),
    amountsService('capex', audit) as any,
    new CapexAllocationsService(none, none, deps.allocationCalculator as any, audit as any),
  ) as any;
  const unified = new TasksUnifiedService(
    none, audit as any, none, none, { getTaskRecipients: async () => [] } as any, new ItemNumberService(),
    { logChange: async () => undefined } as any, { cleanupOrphanedImages: async () => undefined } as any, none,
  );
  const tasks = new CapexTasksController(unified) as any;
  return { svc, items, versions, tasks };
}

async function testRoutes() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const { items, versions, tasks } = controllers(runner);
    const ctx = { manager: runner.manager, tenantId: w.tenantId, userId: w.capexUser } as any;
    const req = { queryRunner: runner, user: { sub: w.capexUser }, tenant: { id: w.tenantId } };
    const O = w.opex;
    const res = { setHeader: () => undefined } as any;
    const file = { originalname: 'x.txt', mimetype: 'text/plain', buffer: Buffer.from('x'), size: 1 } as any;

    // [controller, handler, method, call]: every route addressed by the OPEX line's id, reference or a child's id.
    const routes: Array<[any, string, string, () => Promise<unknown>]> = [
      [CapexItemsController, 'get', 'GET', () => items.get(O.id, ctx)],
      [CapexItemsController, 'get', 'GET', () => items.get(`BL-${OPEX_NUMBER}`, ctx)],
      [CapexItemsController, 'get', 'GET', () => items.get(String(OPEX_NUMBER), ctx)],
      [CapexItemsController, 'meta', 'GET', () => items.meta(O.id, ctx)],
      [CapexItemsController, 'relationCounts', 'GET', () => items.relationCounts(O.id, ctx)],
      [CapexItemsController, 'yearlyTotals', 'GET', () => items.yearlyTotals(O.id, '2025', '2027', ctx)],
      [CapexItemsController, 'share', 'POST', () => items.share(O.id, { recipient_emails: ['someone@example.invalid'] }, ctx)],
      [CapexItemsController, 'summaryNeighbors', 'GET', () => items.summaryNeighbors({ id: O.id }, ctx)],
      [CapexItemsController, 'listProjects', 'GET', () => items.listProjects(O.id, ctx)],
      [CapexItemsController, 'bulkReplaceProjects', 'POST', () => items.bulkReplaceProjects(O.id, { project_ids: [w.projectId] }, ctx)],
      [CapexItemsController, 'listApplications', 'GET', () => items.listApplications(O.id, ctx)],
      [CapexItemsController, 'bulkReplaceApplications', 'POST', () => items.bulkReplaceApplications(O.id, { application_ids: [w.applicationId] }, ctx)],
      [CapexItemsController, 'listLinks', 'GET', () => items.listLinks(O.id, ctx)],
      [CapexItemsController, 'createLink', 'POST', () => items.createLink(O.id, { url: 'https://example.invalid/new' }, ctx)],
      [CapexItemsController, 'updateLink', 'PATCH', () => items.updateLink(O.id, O.linkId, { url: 'https://example.invalid/upd' }, ctx)],
      [CapexItemsController, 'deleteLink', 'DELETE', () => items.deleteLink(O.id, O.linkId, ctx)],
      [CapexItemsController, 'downloadAttachment', 'GET', () => items.downloadAttachment(O.attachmentId, res, ctx)],
      [CapexItemsController, 'deleteAttachment', 'PATCH', () => items.deleteAttachment(O.attachmentId, ctx)],
      [CapexItemsController, 'listAttachments', 'GET', () => items.listAttachments(O.id, ctx)],
      [CapexItemsController, 'uploadAttachment', 'POST', () => items.uploadAttachment(O.id, file, ctx)],
      [CapexItemsController, 'listContacts', 'GET', () => items.listContacts(O.id, ctx)],
      [CapexItemsController, 'attachContact', 'POST', () => items.attachContact(O.id, { contactId: w.contactId, role: 'technical' }, ctx)],
      [CapexItemsController, 'detachContact', 'DELETE', () => items.detachContact(O.id, O.contactLinkId, ctx)],
      [CapexItemsController, 'syncContactsFromSupplier', 'POST', () => items.syncContactsFromSupplier(O.id, ctx)],
      [CapexItemsController, 'update', 'PATCH', () => items.update(O.id, { notes: 'Written through CAPEX' }, ctx)],
      [CapexItemsController, 'delete', 'DELETE', () => items.delete(O.id, ctx)],
      [CapexVersionsController, 'listForItem', 'GET', () => versions.listForItem(O.id, req)],
      [CapexVersionsController, 'createForItem', 'POST', () => versions.createForItem(O.id, { version_name: 'New', budget_year: 2030 }, req)],
      [CapexVersionsController, 'updateForItem', 'PATCH', () => versions.updateForItem(O.id, { id: O.versionId, notes: 'x' }, req)],
      [CapexVersionsController, 'upsertAmounts', 'POST', () => versions.upsertAmounts(O.versionId, { kind: 'annual', year: YEAR, totals: { planned: 1 } }, req)],
      [CapexVersionsController, 'upsertAllocations', 'POST', () => versions.upsertAllocations(O.versionId, { items: [{ company_id: w.companyId, department_id: null, allocation_pct: 100 }] }, req)],
      [CapexVersionsController, 'putAllocations', 'PUT', () => versions.putAllocations(O.versionId, { method: 'default' }, req)],
      [CapexVersionsController, 'listAllocations', 'GET', () => versions.listAllocations(O.versionId, req)],
      [CapexVersionsController, 'listAmounts', 'GET', () => versions.listAmounts(O.versionId, req, String(YEAR))],
      [CapexVersionsController, 'listAmounts', 'GET', () => versions.listAmounts(O.versionId, req, undefined)],
      [CapexTasksController, 'list', 'GET', () => tasks.list(O.id, req)],
      [CapexTasksController, 'create', 'POST', () => tasks.create(O.id, { title: 'Through CAPEX' }, req)],
      [CapexTasksController, 'update', 'PATCH', () => tasks.update(O.id, { id: O.taskId, title: 'Through CAPEX' }, req)],
    ];
    const state = () => runner.query(
      `SELECT (SELECT row_version FROM spend_items WHERE id = $1) AS rv,
              (SELECT count(*)::int FROM spend_links WHERE spend_item_id = $1) AS links,
              (SELECT count(*)::int FROM spend_attachments WHERE spend_item_id = $1) AS attachments,
              (SELECT count(*)::int FROM spend_item_contacts WHERE spend_item_id = $1) AS contacts,
              (SELECT count(*)::int FROM spend_versions WHERE spend_item_id = $1) AS versions,
              (SELECT count(*)::int FROM portfolio_project_opex WHERE opex_id = $1) AS projects,
              (SELECT count(*)::int FROM application_spend_items WHERE spend_item_id = $1) AS applications`,
      [O.id],
    );
    const before = await state();
    for (const [controller, handler, method, call] of routes) {
      const label = `${controller.name}.${handler}`;
      assert.equal(await guardAllows(runner, w, w.capexUser, controller, handler, method), true, `${label}: the CAPEX user passes the guard`);
      const answer = await statusOf(runner, call);
      assert.equal(answer.status, 404, `${label}: 404 for the OPEX line (${JSON.stringify(answer.body)})`);
      // The same call on the same line turned CAPEX answers: the 404 is the nature's, nothing else's.
      const asCapex = await asCapexLine(runner, w, () => statusOf(runner, call));
      assert.equal(asCapex.status, 200, `${label}: 200 once the line is CAPEX (${JSON.stringify(asCapex.body)?.slice(0, 200)})`);
      const tasksRoute = controller === CapexTasksController;
      assert.equal(await guardAllows(runner, w, w.opexUser, controller, handler, method), tasksRoute,
        `${label}: the OPEX user ${tasksRoute ? 'passes the tasks guard (and gets the 404 above)' : 'is stopped by the guard'}`);
    }

    // An OPX reference is refused by the CAPEX routes as before lot Z1 (400, the reference's form), saying nothing of the line.
    const opx = await statusOf(runner, () => items.get(`OPX-${OPEX_NUMBER}`, ctx));
    assert.deepEqual([opx.status, (opx.body as any).message], [400, `Invalid reference for capex: expected CPX-N, got OPX-${OPEX_NUMBER}`], 'OPX-n on a CAPEX route');

    // A bulk delete names nothing: the line is not found, its name stays hidden, it is kept.
    const bulk = await statusOf(runner, () => items.bulkDelete({ ids: [O.id] }, ctx));
    assert.equal(bulk.status, 200);
    assert.deepEqual((bulk.body as any).deleted, [], 'nothing deleted');
    assert.equal((bulk.body as any).failed[0].name, 'Unknown', "the OPEX line's name is not given");
    assert.deepEqual(await state(), before, 'the OPEX line and its children are untouched');

    // Control: the CAPEX line answers through the same routes and references, with the CAPEX contract.
    for (const ref of [w.capex.id, `CPX-${CAPEX_CPX}`, String(CAPEX_CPX), `BL-${CAPEX_NUMBER}`]) {
      const line = await items.get(ref, ctx);
      assert.deepEqual(
        [line.id, line.item_number, line.reference, line.description, 'product_name' in line, 'nature' in line],
        [w.capex.id, CAPEX_CPX, `BL-${CAPEX_NUMBER}`, `capex line ${CAPEX_NUMBER}`, false, false],
        `the CAPEX line by ${ref}: CPX number, BL reference, CAPEX fields`,
      );
    }
    const capexVersions = await versions.listForItem(w.capex.id, req);
    assert.deepEqual(capexVersions.map((version: any) => version.capex_item_id), [w.capex.id], "the CAPEX line's version names its line capex_item_id");
  });
}

runSpecs('capex-alias-foreign-nature.integration.spec', [
  ['testRoutes', testRoutes],
]);
