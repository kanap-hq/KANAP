import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Deleting an attachment touches that attachment only, and goes through the rights of its record:
// - The stored file goes with the last attachment row of the tenant that names it. A file named by
//   another row (the copy in a request made from a task, a clone in a managed document) stays
//   readable, whichever side is deleted, and whoever deletes it: rows a person with limited data
//   access cannot read count too.
// - A deleted attachment's file goes when no other row names it.
// - An attachment of another tenant is never reached by its id.
// - Every delete route asks for a write level of its module; the application route reads the
//   attachment through its application, as the download does, and the interface route refuses a
//   Business Contributor, as the download does.
// - A person with limited data access does not delete an attachment of a record out of their scope.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'attachment-file-ownership-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Family =
  | 'tasks' | 'requests' | 'projects' | 'documents' | 'applications'
  | 'technologies' | 'interfaces' | 'contracts' | 'budget_lines' | 'assets';
const FAMILIES: Family[] = [
  'tasks', 'requests', 'projects', 'documents', 'applications',
  'technologies', 'interfaces', 'contracts', 'budget_lines', 'assets',
];

const TABLES: Record<Family, { table: string; parent: string; extra?: string }> = {
  tasks: { table: 'task_attachments', parent: 'task_id' },
  requests: { table: 'portfolio_request_attachments', parent: 'request_id' },
  projects: { table: 'portfolio_project_attachments', parent: 'project_id' },
  documents: { table: 'document_attachments', parent: 'document_id' },
  applications: { table: 'application_attachments', parent: 'application_id' },
  technologies: { table: 'technology_attachments', parent: 'technology_id' },
  interfaces: { table: 'interface_attachments', parent: 'interface_id', extra: 'kind' },
  contracts: { table: 'contract_attachments', parent: 'contract_id' },
  budget_lines: { table: 'spend_attachments', parent: 'spend_item_id' },
  assets: { table: 'asset_attachments', parent: 'asset_id' },
};

type TenantSeed = {
  tenantId: string;
  editor: string;
  bc: string;
  records: Record<Family, string>;
};

type Harness = {
  app: any;
  dataSource: DataSource;
  deletedObjects: string[];
  get: (token: any) => any;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for attachment-file-ownership.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { StorageService } = require('../storage/storage.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The object store is not under test: the spec records what the deletes ask of it.
  const deletedObjects: string[] = [];
  const storage = app.get(StorageService);
  storage.deleteObject = async (key: string) => { deletedObjects.push(key); };
  return { app, dataSource: app.get(DataSource), deletedObjects, get: (token: any) => app.get(token, { strict: false }) };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, label: string): Promise<TenantSeed> {
  const tenantId = randomUUID();
  const tag = `${label}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `file-owner-${tag}`, `File owner ${tag}`],
  );
  await useTenant(runner, tenantId);
  const user = async (key: string, roleName: string, permissions: Record<string, string>) => {
    const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, roleName]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
    }
    return insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
      [tenantId, `${key}-${tag}@example.test`, key, roleId]);
  };
  const editor = await user('editor', 'Spec editor', { knowledge: 'admin', applications: 'admin', tasks: 'admin', budget: 'admin' });
  // The built-in role's name sets the participation scope (`resolveBusinessContributorScope`):
  // this one may write applications, and reads only those it takes part in.
  const bc = await user('bc', 'Business Contributor', { applications: 'member' });

  const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled')`, [tenantId, `Company ${tag}`]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, `Supplier ${tag}`]);
  const application = (name: string) => insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2)`, [tenantId, `${name} ${tag}`]);
  const source = await application('Source');
  const target = await application('Target');
  const library = await insertId(runner, `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Spec library', $2)`, [tenantId, `lib-${tag}`]);
  const folder = await insertId(runner, `INSERT INTO document_folders (tenant_id, library_id, name) VALUES ($1, $2, 'Spec folder')`, [tenantId, library]);

  const records: Record<Family, string> = {
    tasks: await insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, labels, owner_ids, viewer_ids)
       VALUES ($1, 1, 'Spec task', 'open', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [tenantId]),
    requests: await insertId(runner,
      `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, criteria_values, feasibility_review, priority_override)
       VALUES ($1, 1, 'Spec request', 'approved', '{}'::jsonb, '{}'::jsonb, false)`, [tenantId]),
    projects: await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 1, 'Spec project')`, [tenantId]),
    documents: await insertId(runner,
      `INSERT INTO documents (tenant_id, item_number, title, library_id, folder_id, status) VALUES ($1, 1, 'Spec document', $2, $3, 'published')`,
      [tenantId, library, folder]),
    applications: source,
    technologies: await insertId(runner, `INSERT INTO technologies (tenant_id, item_number, name) VALUES ($1, 1, $2)`, [tenantId, `Technology ${tag}`]),
    interfaces: await insertId(runner,
      `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category, integration_route_type, interface_reference)
       VALUES ($1, 'Spec interface', 'Spec', $2, $3, 'master_data', 'direct', $4)`, [tenantId, source, target, `IF-${tag}`]),
    contracts: await insertId(runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Spec contract', $2, $3, '2026-01-01')`,
      [tenantId, company, supplier]),
    budget_lines: await insertId(runner,
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number) VALUES ($1, 'Spec line', 'EUR', '2026-01-01', 1)`,
      [tenantId]),
    assets: await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Spec asset', 'server', 'prod')`, [tenantId]),
  };
  return { tenantId, editor, bc, records };
}

/** An attachment row of `recordId` naming `storagePath` (a fresh path by default). */
async function attach(runner: QueryRunner, s: TenantSeed, family: Family, recordId = s.records[family], storagePath?: string) {
  const { table, parent, extra } = TABLES[family];
  const name = `${randomUUID()}_note.txt`;
  const path = storagePath ?? `files/${s.tenantId}/${family}/${recordId}/${name}`;
  const id = await insertId(runner,
    `INSERT INTO ${table} (tenant_id, ${parent}, original_filename, stored_filename, mime_type, size, storage_path${extra ? `, ${extra}` : ''})
     VALUES ($1, $2, 'note.txt', $3, 'text/plain', 4, $4${extra ? `, 'functional'` : ''})`,
    [s.tenantId, recordId, name, path]);
  return { id, storagePath: path };
}

async function rowExists(runner: QueryRunner, family: Family, id: string): Promise<boolean> {
  return (await runner.query(`SELECT 1 FROM ${TABLES[family].table} WHERE id = $1`, [id])).length === 1;
}

/** The delete each screen calls, through its service, for a person who may edit the record. */
async function deleteAs(h: Harness, runner: QueryRunner, s: TenantSeed, family: Family, attachmentId: string, userId = s.editor) {
  const manager = runner.manager;
  const tenant = { manager, tenantId: s.tenantId };
  switch (family) {
    case 'tasks':
      return h.get(require('../../tasks/task-attachments.service').TaskAttachmentsService).deleteAttachment(attachmentId, userId, { manager });
    case 'requests':
      return h.get(require('../../portfolio/portfolio-requests.service').PortfolioRequestsService).deleteAttachment(s.records.requests, attachmentId, userId, { manager });
    case 'projects':
      return h.get(require('../../portfolio/services/portfolio-attachments.service').PortfolioAttachmentsService).deleteAttachment(s.records.projects, attachmentId, userId, { manager });
    case 'documents':
      return h.get(require('../../knowledge/knowledge.service').KnowledgeService).deleteAttachment(s.records.documents, attachmentId, userId, { manager, tenantId: s.tenantId });
    case 'applications':
      return h.get(require('../../applications/applications.controller').ApplicationsController).deleteAttachment(attachmentId, { ...tenant, userId });
    case 'technologies':
      return h.get(require('../../technologies/technologies.service').TechnologiesService).deleteAttachment(attachmentId, { ...tenant, userId });
    case 'interfaces':
      return h.get(require('../../interfaces/interfaces.controller').InterfacesController).deleteAttachment(attachmentId, { ...tenant, userId });
    case 'contracts':
      return h.get(require('../../contracts/contracts.service').ContractsService).deleteAttachment(attachmentId, userId, { manager });
    case 'budget_lines':
      return h.get(require('../../spend/spend-items.service').SpendItemsService).deleteAttachment(attachmentId, userId, { manager });
    case 'assets':
      return h.get(require('../../assets/services/assets.service').AssetsService).deleteAttachment(attachmentId, userId, tenant);
  }
}

/** A file named by an attachment of `family` and by a row of another family stays until the last one goes. */
async function testSharedFileStaysWithTheOtherRow(h: Harness, runner: QueryRunner, s: TenantSeed, family: Family) {
  const other: Family = family === 'requests' ? 'tasks' : 'requests';
  const shared = await attach(runner, s, family);
  const copy = await attach(runner, s, other, s.records[other], shared.storagePath);

  await deleteAs(h, runner, s, family, shared.id);
  assert.equal(await rowExists(runner, family, shared.id), false, `${family}: attachment deleted`);
  assert.equal(h.deletedObjects.includes(shared.storagePath), false, `${family}: the file the ${other} copy names is kept`);

  await deleteAs(h, runner, s, other, copy.id);
  assert.equal(h.deletedObjects.includes(shared.storagePath), true, `${family}: the file goes with the last row naming it`);

  const own = await attach(runner, s, family);
  await deleteAs(h, runner, s, family, own.id);
  assert.equal(h.deletedObjects.includes(own.storagePath), true, `${family}: an unshared file goes with its attachment`);
}

/** An attachment of another tenant, addressed by its id, is not reached. */
async function testOtherTenantIsNotReached(h: Harness, runner: QueryRunner, s: TenantSeed, foreign: TenantSeed, family: Family) {
  await useTenant(runner, foreign.tenantId);
  const theirs = await attach(runner, foreign, family);
  await useTenant(runner, s.tenantId);

  await deleteAs(h, runner, s, family, theirs.id).catch(() => undefined);
  assert.equal(h.deletedObjects.includes(theirs.storagePath), false, `${family}: file of another tenant kept`);
  await useTenant(runner, foreign.tenantId);
  assert.equal(await rowExists(runner, family, theirs.id), true, `${family}: row of another tenant kept`);
  await useTenant(runner, s.tenantId);
}

/** Every attachment delete route asks for a write level of its module. */
function testRoutesAskForAWriteLevel() {
  const { REQUIRE_LEVEL_KEY } = require('../../auth/require-level.decorator');
  const routes: Array<[string, string, string, string[]]> = [
    ['../../spend/tasks.controller', 'TasksController', 'deleteAttachmentStatic', ['member']],
    ['../../portfolio/portfolio-requests.controller', 'PortfolioRequestsController', 'deleteAttachment', ['member']],
    ['../../portfolio/portfolio-projects.controller', 'PortfolioProjectsController', 'deleteAttachment', ['contributor']],
    ['../../knowledge/knowledge.controller', 'KnowledgeController', 'deleteAttachment', ['member']],
    ['../../applications/applications.controller', 'ApplicationsController', 'deleteAttachment', ['member']],
    ['../../technologies/technologies.controller', 'TechnologiesController', 'deleteAttachment', ['member']],
    ['../../interfaces/interfaces.controller', 'InterfacesController', 'deleteAttachment', ['member']],
    ['../../contracts/contracts.controller', 'ContractsController', 'deleteAttachment', ['member']],
    ['../../spend/spend-items.controller', 'SpendItemsController', 'deleteAttachment', ['member']],
    ['../../spend/capex-items.controller', 'CapexItemsController', 'deleteAttachment', ['member']],
    ['../../assets/assets.controller', 'AssetsController', 'deleteAttachment', ['member']],
    ['../../incidents/incidents.controller', 'IncidentsController', 'deleteAttachment', ['contributor']],
  ];
  for (const [file, className, method, levels] of routes) {
    const controller = require(file)[className];
    assert.ok(controller, `${className} exported by ${file}`);
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, controller.prototype[method]);
    assert.ok(meta && levels.includes(meta.level), `${className}.${method}: write level required (got ${JSON.stringify(meta)})`);
  }
}

/** The application and interface routes read the attachment's record as their downloads do. */
async function testBusinessContributorDeletesThroughTheRecord(h: Harness, runner: QueryRunner, s: TenantSeed) {
  const { ApplicationsController } = require('../../applications/applications.controller');
  const { InterfacesController } = require('../../interfaces/interfaces.controller');
  const bcCtx = { manager: runner.manager, tenantId: s.tenantId, userId: s.bc };

  const outside = await attach(runner, s, 'applications');
  const refused = await h.get(ApplicationsController).deleteAttachment(outside.id, bcCtx).then(() => null, (e: any) => e);
  assert.equal(refused?.getStatus?.(), 404, 'applications, bc: an application they do not take part in reads as missing');
  assert.equal(await rowExists(runner, 'applications', outside.id), true, 'applications, bc: row kept');
  assert.equal(h.deletedObjects.includes(outside.storagePath), false, 'applications, bc: file kept');

  // Taking part in the application (business owner) opens its attachments to them.
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [s.tenantId, s.records.applications, s.bc],
  );
  assert.deepEqual(await h.get(ApplicationsController).deleteAttachment(outside.id, bcCtx), { ok: true });
  assert.equal(await rowExists(runner, 'applications', outside.id), false, 'applications, bc: row deleted on their application');

  const iface = await attach(runner, s, 'interfaces');
  const ifaceRefused = await h.get(InterfacesController).deleteAttachment(iface.id, bcCtx).then(() => null, (e: any) => e);
  assert.ok(ifaceRefused && ifaceRefused.getStatus?.() === 403, 'interfaces, bc: refused as the download is');
  assert.equal(await rowExists(runner, 'interfaces', iface.id), true, 'interfaces, bc: row kept');
}

/**
 * Limited data access: a task of a line out of the person's scope and the request made from it
 * share a file. The person deletes the request's copy: the task's file stays. They cannot delete
 * the attachment of the hidden task nor of the hidden line. Runs last: the access lasts until the
 * transaction ends.
 */
async function testLimitedPerson(h: Harness, runner: QueryRunner, s: TenantSeed) {
  const { applyDataAccess } = require('../../data-access/data-access');
  const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Spec limited', 'Spec limited')`, [s.tenantId]);
  const limited = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, data_access_mode)
     VALUES ($1, $2, 'limited', 'Tester', $3, 'enabled', 'limited')`, [s.tenantId, `limited-${s.tenantId.slice(0, 8)}@example.test`, roleId]);
  const company = (await runner.query(`SELECT id FROM companies WHERE tenant_id = $1 LIMIT 1`, [s.tenantId]))[0].id;
  const hiddenLine = await insertId(runner,
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id) VALUES ($1, 'Hidden line', 'EUR', '2026-01-01', 2, $2)`,
    [s.tenantId, company]);
  const hiddenTask = await insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, labels, owner_ids, viewer_ids)
     VALUES ($1, 2, 'Hidden line task', 'open', 'spend_item', $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [s.tenantId, hiddenLine]);
  const taskFile = await attach(runner, s, 'tasks', hiddenTask);
  const requestCopy = await attach(runner, s, 'requests', s.records.requests, taskFile.storagePath);
  const lineFile = await attach(runner, s, 'budget_lines', hiddenLine);

  assert.equal(await applyDataAccess(runner, limited), 'limited', 'the person runs under limited access');
  const visible = await runner.query(`SELECT 1 FROM task_attachments WHERE id = $1`, [taskFile.id]);
  assert.equal(visible.length, 0, 'limited: the hidden task attachment is not readable');

  await deleteAs(h, runner, s, 'requests', requestCopy.id, limited);
  assert.equal(h.deletedObjects.includes(taskFile.storagePath), false, 'limited: the hidden task keeps its file');

  await deleteAs(h, runner, s, 'tasks', taskFile.id, limited).catch(() => undefined);
  await deleteAs(h, runner, s, 'budget_lines', lineFile.id, limited).catch(() => undefined);
  assert.equal(h.deletedObjects.includes(taskFile.storagePath), false, 'limited: no delete of a hidden task attachment');
  assert.equal(h.deletedObjects.includes(lineFile.storagePath), false, 'limited: no delete of a hidden line attachment');
  const [kept] = await runner.query(`SELECT current_user AS role`);
  assert.equal(kept.role, 'kanap_data_limited', 'limited: the access is still applied after the checks');
}

async function run() {
  testRoutesAskForAWriteLevel();
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const foreign = await seedTenant(runner, 'b');
      const s = await seedTenant(runner, 'a');
      for (const family of FAMILIES) {
        await testSharedFileStaysWithTheOtherRow(harness, runner, s, family);
        await testOtherTenantIsNotReached(harness, runner, s, foreign, family);
      }
      await testBusinessContributorDeletesThroughTheRecord(harness, runner, s);
      await testLimitedPerson(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('attachment-file-ownership.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
