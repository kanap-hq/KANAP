// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { LocationsService } from '../../locations/locations.service';
import { AssetsCrudService } from '../../assets/services/assets-crud.service';
import { ApplicationsCrudService } from '../../applications/services/applications-crud.service';
import { ConnectionsCrudService } from '../../connections/services/connections-crud.service';
import { InterfacesCrudService } from '../../interfaces/services/interfaces-crud.service';
import { PortfolioProjectsCrudService } from '../../portfolio/services/portfolio-projects-crud.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { TechnologiesService } from '../../technologies/technologies.service';
import { AnalyticsAxesService } from '../../analytics/analytics-axes.service';
import { ChartOfAccountsService } from '../../accounts/chart-of-accounts.service';
import { UsersDeleteService } from '../../users/users-delete.service';
import { IncidentsService } from '../../incidents/services/incidents.service';
import { Supplier } from '../../suppliers/supplier.entity';
import { Task } from '../../tasks/task.entity';
import { writeTaskColumns } from '../../tasks/task-column-write';
import { updateItemUnderLock } from '../../spend/item-locked-update';
import { UPDATED_AT_TABLES } from '../updated-at.inventory';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'updated-at-screens-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The modification date the database keeps (migration 1856270000000), through the services of
// the screens, in transactions rolled back at the end:
// - a record saved with nothing changed keeps its date; a changed field dates it;
// - a document whose long content alone changes is dated;
// - deleting a person dates neither the documents, incidents, requests and tasks they created
//   nor the tasks that named them as owner or viewer;
// - the application never writes the date: no entity updates the column, so neither an entity
//   saved twice (the date it was loaded with) nor a date sent in a request body comes back.

const OLD = '2020-01-02T03:04:05.000Z';
let app: any;
let ds: DataSource;

async function inTx(fn: (r: QueryRunner) => Promise<void>) {
  const r = ds.createQueryRunner();
  await r.connect();
  await r.startTransaction();
  try {
    await fn(r);
  } finally {
    await r.rollbackTransaction().catch(() => undefined);
    await r.release();
  }
}

async function seed(r: QueryRunner) {
  const tenantId = randomUUID();
  await r.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Updated at screens', 'active', '{}'::jsonb, '{}'::jsonb, now(), now())`,
    [tenantId, `updated-at-screens-${tenantId.slice(0, 8)}`],
  );
  await r.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const one = async (sql: string, p: unknown[] = []) => (await r.query(sql, [tenantId, ...p]))[0].id as string;
  const role = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`);
  const user = await one(`INSERT INTO users (tenant_id, email, role_id, status) VALUES ($1, 'writer@example.test', $2, 'enabled') RETURNING id`, [role]);
  // A second administrator: the workspace keeps one when the first is deleted.
  const other = await one(`INSERT INTO users (tenant_id, email, role_id, status) VALUES ($1, 'other@example.test', $2, 'enabled') RETURNING id`, [role]);
  const ids: Record<string, string> = { role, user, other };
  ids.suppliers = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier') RETURNING id`);
  ids.locations = await one(`INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Site', 'on_premise', 'LOC-1') RETURNING id`);
  ids.assets = await one(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Server', 'vm', 'prod') RETURNING id`);
  ids.applications = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Application A') RETURNING id`);
  const target = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Application B') RETURNING id`);
  ids.connections = await one(`INSERT INTO connections (tenant_id, name, topology, connection_reference) VALUES ($1, 'Connection', 'point_to_point', 'CONN-1') RETURNING id`);
  ids.interfaces = await one(
    `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category, integration_route_type, interface_reference)
     VALUES ($1, 'Interface', 'Purpose', $2, $3, 'master_data', 'direct', 'INT-1') RETURNING id`,
    [ids.applications, target],
  );
  ids.portfolio_projects = await one(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Project', 1) RETURNING id`);
  ids.portfolio_requests = await one(`INSERT INTO portfolio_requests (tenant_id, name, item_number, created_by_id) VALUES ($1, 'Request', 1, $2) RETURNING id`, [user]);
  const library = await one(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Library', 'library') RETURNING id`);
  ids.documents = await one(
    `INSERT INTO documents (tenant_id, item_number, title, library_id, created_by, updated_by, content_markdown)
     VALUES ($1, 1, 'Document', $2, $3, $3, 'Body') RETURNING id`,
    [library, user],
  );
  ids.technologies = await one(`INSERT INTO technologies (tenant_id, item_number, name) VALUES ($1, 1, 'Technology') RETURNING id`);
  ids.analytics_axes = await one(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'upd', 'Axis') RETURNING id`);
  ids.chart_of_accounts = await one(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'UPD', 'Chart', 'FR') RETURNING id`);
  ids.incidents = await one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, description, created_by, updated_by)
     VALUES ($1, 1, 'Incident', 'minor', 'What happened', $2, $2) RETURNING id`,
    [user],
  );
  ids.spend_items = await one(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature)
     VALUES ($1, 'Line', 'EUR', '2026-01-01', 1, 'opex') RETURNING id`,
  );
  ids.category = await one(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Category') RETURNING id`, [ids.analytics_axes]);
  ids.tasks = await one(
    `INSERT INTO tasks (tenant_id, title, item_number, creator_id, owner_ids, viewer_ids)
     VALUES ($1, 'Task', 1, $2, jsonb_build_array($3::text), jsonb_build_array($3::text)) RETURNING id`,
    [user, user],
  );
  for (const table of Object.keys(ids)) {
    if (['role', 'user', 'other', 'category'].includes(table)) continue;
    await r.query(`UPDATE ${table} SET updated_at = $2 WHERE id = $1`, [ids[table], OLD]);
  }
  return { tenantId, ids };
}

async function dateOf(r: QueryRunner, table: string, id: string) {
  const [row] = await r.query(`SELECT updated_at = now() AS now, updated_at FROM ${table} WHERE id = $1`, [id]);
  return row.now ? 'now' : new Date(row.updated_at).toISOString();
}

type Save = (body: Record<string, unknown>) => Promise<unknown>;

async function testScreensDateOnlyChanges() {
  await inTx(async (r) => {
    const { tenantId, ids } = await seed(r);
    const userId = ids.user;
    const manager = r.manager;
    const get = <T>(type: new (...args: any[]) => T): T => app.get(type, { strict: false });
    const { lock_token: lockToken } = await get(KnowledgeService).acquireLock(ids.documents, userId, { manager, tenantId } as any);
    const revision = async () => Number((await r.query(`SELECT revision FROM documents WHERE id = $1`, [ids.documents]))[0].revision);
    const saves: Array<[string, Save, Record<string, unknown>, Record<string, unknown>]> = [
      ['suppliers', (b) => get(SuppliersService).update(ids.suppliers, b as any, userId, { manager }), { name: 'Supplier' }, { name: 'Supplier renamed' }],
      ['locations', (b) => get(LocationsService).update(ids.locations, b as any, tenantId, userId, { manager }), { name: 'Site' }, { name: 'Site renamed' }],
      ['assets', (b) => get(AssetsCrudService).update(ids.assets, b as any, tenantId, userId, { manager }), { name: 'Server' }, { name: 'Server renamed' }],
      ['applications', (b) => get(ApplicationsCrudService).update(ids.applications, b as any, userId, { manager }), { name: 'Application A' }, { name: 'Application renamed' }],
      ['connections', (b) => get(ConnectionsCrudService).update(ids.connections, b, tenantId, userId, { manager }), { name: 'Connection' }, { name: 'Connection renamed' }],
      ['interfaces', (b) => get(InterfacesCrudService).update(ids.interfaces, b, tenantId, userId, { manager }), { name: 'Interface' }, { name: 'Interface renamed' }],
      ['portfolio_projects', (b) => get(PortfolioProjectsCrudService).update(ids.portfolio_projects, b as any, tenantId, userId, { manager }), { name: 'Project' }, { name: 'Project renamed' }],
      ['portfolio_requests', (b) => get(PortfolioRequestsService).update(ids.portfolio_requests, b as any, tenantId, userId, { manager }), { name: 'Request' }, { name: 'Request renamed' }],
      ['documents', async (b) => get(KnowledgeService).update(ids.documents, { ...b, revision: await revision() } as any, userId, lockToken, { manager, tenantId } as any), { title: 'Document' }, { title: 'Document renamed' }],
      ['technologies', (b) => get(TechnologiesService).update(ids.technologies, b as any, { manager, tenantId, userId }), { name: 'Technology' }, { name: 'Technology renamed' }],
      ['analytics_axes', (b) => get(AnalyticsAxesService).update(ids.analytics_axes, b, { manager, tenantId, userId }), { name: 'Axis' }, { name: 'Axis renamed' }],
      ['chart_of_accounts', (b) => get(ChartOfAccountsService).update(ids.chart_of_accounts, b as any, userId, { manager }), { name: 'Chart' }, { name: 'Chart renamed' }],
    ];
    // A document made by the screen has a type: a first save gives this raw row the default one.
    await saves.find(([table]) => table === 'documents')![1]({ title: 'Document' });
    await r.query(`UPDATE documents SET updated_at = $2 WHERE id = $1`, [ids.documents, OLD]);
    const outcome: string[] = [];
    for (const [table, save, same, changed] of saves) {
      await save(same);
      const kept = await dateOf(r, table, ids[table]);
      await save(changed);
      const dated = await dateOf(r, table, ids[table]);
      outcome.push(`${table}: unchanged ${kept === OLD ? 'keeps its date' : `dated ${kept}`}, changed ${dated === 'now' ? 'dated' : `kept ${dated}`}`);
    }
    console.log(outcome.map((line) => `  ${line}`).join('\n'));
    assert.deepEqual(
      outcome,
      saves.map(([table]) => `${table}: unchanged keeps its date, changed dated`),
      'a record saved unchanged keeps its date, a changed field dates it',
    );
  });
}

/** A document whose long content alone changes is dated; written back as it was, it is not. */
async function testLongContentDatesTheDocument() {
  await inTx(async (r) => {
    const { ids } = await seed(r);
    const long = 'x'.repeat(200_000);
    await r.query(`UPDATE documents SET content_markdown = $2 WHERE id = $1`, [ids.documents, long]);
    await r.query(`UPDATE documents SET updated_at = $2 WHERE id = $1`, [ids.documents, OLD]);
    await r.query(`UPDATE documents SET content_markdown = $2 WHERE id = $1`, [ids.documents, long]);
    assert.equal(await dateOf(r, 'documents', ids.documents), OLD, 'the same long content keeps the date');
    await r.query(`UPDATE documents SET content_markdown = $2 WHERE id = $1`, [ids.documents, `${long}y`]);
    assert.equal(await dateOf(r, 'documents', ids.documents), 'now', 'a changed long content dates the document');
  });
}

/** Deleting a person leaves the dates of what they created and of the tasks that named them. */
async function testDeletingAPersonDatesNothing() {
  await inTx(async (r) => {
    const { ids } = await seed(r);
    await app.get(UsersDeleteService, { strict: false }).deleteUser(ids.user, null, { manager: r.manager });
    const [task] = await r.query(`SELECT creator_id, owner_ids, viewer_ids FROM tasks WHERE id = $1`, [ids.tasks]);
    assert.deepEqual([task.creator_id, task.owner_ids, task.viewer_ids], [null, [], []], 'the person left the task');
    const [doc] = await r.query(`SELECT created_by, updated_by FROM documents WHERE id = $1`, [ids.documents]);
    assert.deepEqual([doc.created_by, doc.updated_by], [null, null], 'the person left the document');
    const dates: Record<string, string> = {};
    for (const table of ['documents', 'incidents', 'portfolio_requests', 'tasks']) dates[table] = await dateOf(r, table, ids[table]);
    assert.deepEqual(dates, { documents: OLD, incidents: OLD, portfolio_requests: OLD, tasks: OLD }, 'nothing is dated by the delete');
  });
}

/** No entity of a table of the inventory writes the date: the database keeps it. */
async function testNoEntityWritesTheDate() {
  const wrong: string[] = [];
  let checked = 0;
  for (const table of Object.keys(UPDATED_AT_TABLES)) {
    for (const meta of ds.entityMetadatas.filter((m) => m.tableName === table)) {
      const column = meta.columns.find((c) => c.databaseName === 'updated_at');
      if (!column) continue;
      checked += 1;
      if (column.isUpdate) wrong.push(`${meta.name} (${table})`);
    }
  }
  assert.ok(checked >= 24, `the entities of the inventory are found (${checked})`);
  assert.deepEqual(
    wrong,
    [],
    'the database keeps updated_at (common/updated-at-trigger.ts): declare it '
      + "@Column({ type: 'timestamptz', default: () => 'now()', update: false }) on these entities, "
      + 'and date a record on purpose with touchUpdatedAt',
  );
}

/**
 * The date TypeORM would write back: (a) one entity saved twice, (b) a date in the body of a
 * supplier update (PATCH /suppliers/:id), (c) a date in the columns of a task write (the task PATCH).
 */
async function testNoDateWrittenBack() {
  await inTx(async (r) => {
    const { tenantId, ids } = await seed(r);
    const manager = r.manager;
    const outcome: Record<string, string> = {};

    const repo = manager.getRepository(Supplier);
    const supplier = await repo.findOneByOrFail({ id: ids.suppliers });
    supplier.notes = 'First save';
    await repo.save(supplier);
    supplier.notes = 'Second save';
    await repo.save(supplier);
    outcome['(a) one entity saved twice'] = await dateOf(r, 'suppliers', ids.suppliers);

    await r.query(`UPDATE suppliers SET updated_at = $2 WHERE id = $1`, [ids.suppliers, OLD]);
    await app.get(SuppliersService, { strict: false }).update(ids.suppliers, { notes: 'From the body', updated_at: '2019-06-07' } as any, ids.user, { manager });
    outcome['(b) a date in a supplier body'] = await dateOf(r, 'suppliers', ids.suppliers);

    const task = await writeTaskColumns(manager.getRepository(Task), { id: ids.tasks, tenant_id: tenantId }, { title: 'Task renamed', updated_at: '2019-06-07' });
    assert.equal(task.title, 'Task renamed');
    outcome['(c) a date in a task write'] = await dateOf(r, 'tasks', ids.tasks);

    console.log(Object.entries(outcome).map(([name, date]) => `  ${name}: ${date === 'now' ? 'dated now' : date}`).join('\n'));
    assert.deepEqual(
      outcome,
      { '(a) one entity saved twice': 'now', '(b) a date in a supplier body': 'now', '(c) a date in a task write': 'now' },
      'the database dates the change; no date comes back from the entity or the body',
    );
  });
}

/**
 * A budget line and an incident saved unchanged keep their date; a change dates them. A child alone
 * dates its record only when it changed: a line's analytics value, a document's contributors.
 */
async function testBudgetLineAndIncident() {
  await inTx(async (r) => {
    const { tenantId, ids } = await seed(r);
    const manager = r.manager;
    const incidents = app.get(IncidentsService, { strict: false });
    const opts = { manager, tenantId } as any;
    const outcome: Record<string, string> = {};
    const reset = (table: string) => r.query(`UPDATE ${table} SET updated_at = $2 WHERE id = $1`, [ids[table], OLD]);
    const line = (body: Record<string, unknown>) => updateItemUnderLock(manager, 'opex', tenantId, ids.spend_items, body);

    await line({ product_name: 'Line' });
    outcome['budget line unchanged'] = await dateOf(r, 'spend_items', ids.spend_items);
    await line({ product_name: 'Line renamed' });
    outcome['budget line changed'] = await dateOf(r, 'spend_items', ids.spend_items);
    await reset('spend_items');
    await line({ analytics_values: { [ids.analytics_axes]: ids.category } });
    outcome['budget line, analytics value alone'] = await dateOf(r, 'spend_items', ids.spend_items);
    await reset('spend_items');
    await line({ analytics_values: { [ids.analytics_axes]: ids.category } });
    outcome['budget line, same analytics value'] = await dateOf(r, 'spend_items', ids.spend_items);

    await incidents.update(ids.incidents, { description: 'What happened' }, ids.user, opts);
    outcome['incident unchanged'] = await dateOf(r, 'incidents', ids.incidents);
    await incidents.update(ids.incidents, { description: 'What happened, told again' }, ids.user, opts);
    outcome['incident changed'] = await dateOf(r, 'incidents', ids.incidents);

    // A document's contributors: rows of their own, compared before and after the save.
    const knowledge = app.get(KnowledgeService, { strict: false });
    const { lock_token: lockToken } = await knowledge.acquireLock(ids.documents, ids.user, opts);
    const saveDocument = async (contributors: unknown[]) => {
      const [{ revision }] = await r.query(`SELECT revision FROM documents WHERE id = $1`, [ids.documents]);
      await knowledge.update(ids.documents, { title: 'Document', revision: Number(revision), contributors } as any, ids.user, lockToken, opts);
    };
    const author = [{ user_id: ids.user, role: 'author', is_primary: true }];
    await saveDocument(author);
    await reset('documents');
    await saveDocument(author);
    outcome['document, same contributors'] = await dateOf(r, 'documents', ids.documents);
    await saveDocument([...author, { user_id: ids.other, role: 'reviewer' }]);
    outcome['document, a contributor added'] = await dateOf(r, 'documents', ids.documents);

    const label = (date: string) => (date === 'now' ? 'dated' : date === OLD ? 'keeps its date' : date);
    console.log(Object.entries(outcome).map(([name, date]) => `  ${name}: ${label(date)}`).join('\n'));
    assert.deepEqual(
      Object.fromEntries(Object.entries(outcome).map(([name, date]) => [name, label(date)])),
      {
        'budget line unchanged': 'keeps its date',
        'budget line changed': 'dated',
        'budget line, analytics value alone': 'dated',
        'budget line, same analytics value': 'keeps its date',
        'incident unchanged': 'keeps its date',
        'incident changed': 'dated',
        'document, same contributors': 'keeps its date',
        'document, a contributor added': 'dated',
      },
    );
  });
}

async function main() {
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  ds = app.get(DataSource);
  let failed = 0;
  try {
    for (const [name, fn] of [
      ['screens date only changes', testScreensDateOnlyChanges],
      ['long content dates the document', testLongContentDatesTheDocument],
      ['deleting a person dates nothing', testDeletingAPersonDatesNothing],
      ['no entity writes the date', testNoEntityWritesTheDate],
      ['no date written back', testNoDateWrittenBack],
      ['budget line and incident', testBudgetLineAndIncident],
    ] as const) {
      try {
        await fn();
        console.log(`ok - ${name}`);
      } catch (error: any) {
        failed += 1;
        console.log(`not ok - ${name}\n${error?.stack ?? error}`);
      }
    }
  } finally {
    await app.close();
  }
  if (failed) throw new Error(`${failed} test(s) failed`);
}

void main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
