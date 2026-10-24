// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  PARAMTYPES_METADATA,
  PIPES_METADATA,
  ROUTE_ARGS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import appDataSource from '../../data-source';
import { TenantInitGuard } from '../../common/tenant-init.guard';
import { TenantInterceptor } from '../../common/tenant.interceptor';
import { ReleaseTenantRunnerFilter } from '../../common/filters/release-tenant-runner.filter';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { withTenantExecution } from '../../common/tenant-runner';
import { ItemNumberService } from '../../common/item-number.service';
import { Task } from '../../tasks/task.entity';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { DATA_ACCESS_READ_ONLY_TASK_MESSAGE } from '../../tasks/task-data-access';
import { TasksController } from '../../spend/tasks.controller';
import { SpendTasksController } from '../../spend/spend-tasks.controller';
import { SpendTasksService } from '../../spend/spend-tasks.service';
import { BudgetLinesController } from '../../spend/budget-lines.controller';
import { BudgetLinesService } from '../../spend/budget-lines.service';
import { DATA_ACCESS_READ_ONLY_LINE_MESSAGE } from '../line-write-checks';
import { LIMITED_ROLE, PgClient, APP_URL, connect, roleExists } from './data-access-test-helpers';
import { Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 3 (planning/data-scoped-access/spec.md §4.4, §6.7, §6.8): the task routes
 * of a budget line over HTTP, through the real tenant interceptor (the person's access applied per
 * request), exception filter, controllers and task service, on the reference example of lot 2
 * (`data-access-line-seed.ts`), committed for the requests and purged after.
 *
 * Rita (INF-FR edit, INF read) modifies L1, reads L3 only, does not read L5. Paul (INF read)
 * modifies nothing. Marta (ES edit) reads L2 only, modifies L4, does not read L1. Ulla has access
 * to all data.
 *
 * - `PATCH /tasks/:id` of a task that keeps its line: the line is neither looked up nor locked (the
 *   lock passes the UPDATE policy of the lines, which hid every line the person cannot modify). The
 *   assignee or owner of a task of a hidden line hands it over (200, kept as an observer,
 *   `stillFollowing`); the assignee of a task of a read-only line changes its status and title
 *   (200); an observer of a task of a read-only line is refused (403 `DATA_ACCESS_LIMITED`).
 * - A move of a task to a read-only line: 403; to a hidden line: 404, as a missing one.
 * - `POST /spend-items/:id/tasks`: read-only line 403, editable line 201, hidden line 404.
 * - Ulla is served as before.
 * - The Relations tab of a line (`/budget-lines/:id/relations/:kind`): an application, a technology
 *   or a project added to or removed from a read-only line 403, an editable line 201 / 200, a hidden
 *   line 404 as a missing one (the owner lock passes the UPDATE policy, `owned-link.ts`).
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 3 });
let client: PgClient;
let s: Seed;
let hasRole = false;

type Tasks = {
  ritaAssigneeL5: string;
  ritaOwnerL5: string;
  paulAssigneeL1: string;
  ritaObserverL3: string;
  ritaAssigneeL1: string;
  ullaL5: string;
};
let tasks: Tasks;
type Targets = { applications: string; technologies: string; projects: string };
let targets: Targets;

// ---------------------------------------------------------------------------------------------
// The real controllers, with the services they do not need for these routes stubbed.

const CONTROLLERS = [TasksController, SpendTasksController, BudgetLinesController];

/** A stand-in for any service: every member is a function resolving to undefined. Not a thenable. */
function stub(): unknown {
  const fn = () => Promise.resolve(undefined);
  return new Proxy({}, {
    get: (_target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : fn),
  });
}

function depsOf(cls: any): unknown[] {
  const tokens: unknown[] = [...(Reflect.getMetadata(PARAMTYPES_METADATA, cls) ?? [])];
  for (const { index, param } of Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, cls) ?? []) tokens[index] = param;
  return tokens.map((token: any) => (token && typeof token === 'object' && typeof token.forwardRef === 'function' ? token.forwardRef() : token));
}

function enhancersOf(controller: any): any[] {
  const targets = [controller, ...Object.getOwnPropertyNames(controller.prototype).map((name) => controller.prototype[name])];
  const out: any[] = [];
  for (const target of targets) {
    if (typeof target !== 'function') continue;
    for (const key of [GUARDS_METADATA, INTERCEPTORS_METADATA, PIPES_METADATA]) {
      for (const enhancer of Reflect.getMetadata(key, target) ?? []) if (typeof enhancer === 'function') out.push(enhancer);
    }
  }
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {};
    for (const arg of Object.values<any>(args)) {
      for (const pipe of arg?.pipes ?? []) if (typeof pipe === 'function') out.push(pipe);
    }
  }
  return out;
}

function testModule(): any {
  const audit = stub() as any;
  const unified = new TasksUnifiedService(
    dataSource.getRepository(Task),
    audit,
    dataSource,
    stub() as any,
    stub() as any,
    new ItemNumberService(),
    stub() as any,
    stub() as any,
    stub() as any,
  );
  const real = new Map<unknown, unknown>([
    [TasksUnifiedService, unified],
    [SpendTasksService, new SpendTasksService(unified, audit)],
    // The Relations tab needs the audit only (`setRelation`).
    [BudgetLinesService, new BudgetLinesService(null as any, null as any, null as any, null as any, null as any, null as any, audit)],
    [DataSource, dataSource],
  ]);
  const enhancers = new Set<any>();
  for (const controller of CONTROLLERS) for (const enhancer of enhancersOf(controller)) enhancers.add(enhancer);
  // Authentication and permissions are not under test: the data access is.
  for (const enhancer of enhancers) {
    if (typeof enhancer.prototype?.canActivate !== 'function') continue;
    enhancer.prototype.canActivate = () => true;
    if (typeof enhancer.prototype.onModuleInit === 'function') enhancer.prototype.onModuleInit = () => undefined;
  }
  const tokens = new Set<unknown>();
  // Pipes (`ParseUUIDPipe`) take only optional options: Nest builds them without a provider.
  const built = [...enhancers].filter((enhancer) => typeof enhancer.prototype?.transform !== 'function');
  for (const cls of [...CONTROLLERS, ...built]) {
    for (const token of depsOf(cls)) {
      if (token === undefined || token === Object) throw new Error(`${cls.name}: a dependency the spec cannot stub`);
      if (token !== Reflector) tokens.add(token);
    }
  }
  const providers = [...tokens].map((token) => ({ provide: token as any, useValue: real.has(token) ? real.get(token) : stub() }));
  @Module({ controllers: CONTROLLERS, providers })
  class LineRoutesModule {}
  return LineRoutesModule;
}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(testModule(), { logger: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: s.tenantId, slug: 'da-line-routes', name: 'Data access line routes' };
    const user = req.headers['x-da-user'];
    if (typeof user === 'string' && user) req.user = { sub: user };
    // What the permission guard sets (stubbed above): the modules the Relations tab reads.
    req.permissions = { budget: 'admin', tasks: 'admin', applications: 'admin', infrastructure: 'admin', portfolio_projects: 'admin', contracts: 'admin' };
    next();
  });
  app.useGlobalGuards(new TenantInitGuard(dataSource, reflector));
  app.useGlobalInterceptors(new TenantInterceptor(dataSource, reflector));
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Answer = { status: number; text: string; body: any };

async function call(app: INestApplication, method: Method, path: string, userId: string, body?: unknown): Promise<Answer> {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/${path}`, {
    method,
    headers: { 'x-da-user': userId, 'content-type': 'application/json' },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, text, body: parsed };
}

function expectLimited(res: Answer, message: string, what: string): void {
  assert.equal(res.status, 403, `${what}: ${res.text}`);
  assert.equal(res.body?.code, 'DATA_ACCESS_LIMITED', `${what}: ${res.text}`);
  assert.equal(res.body?.message, message, what);
}

// ---------------------------------------------------------------------------------------------
// Seed.

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Above the numbers the service allocates (`ItemNumberService`) for the tasks created over HTTP. */
let taskNumber = 900001;

async function seedTasks(): Promise<Tasks> {
  const task = async (line: string, participants: { assignee?: string; owners?: string[]; viewers?: string[] }) => (await client.query(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id, owner_ids, viewer_ids)
     VALUES (app_current_tenant(), 'DA HTTP task', $1, 'spend_item', $2, $3, $4::jsonb, $5::jsonb) RETURNING id`,
    [taskNumber++, line, participants.assignee ?? null, JSON.stringify(participants.owners ?? []), JSON.stringify(participants.viewers ?? [])],
  )).rows[0].id as string;
  const { lines, persons } = s;
  return inTenant(async () => ({
      ritaAssigneeL5: await task(lines.L5, { assignee: persons.rita }),
      ritaOwnerL5: await task(lines.L5, { owners: [persons.rita] }),
      paulAssigneeL1: await task(lines.L1, { assignee: persons.paul }),
      ritaObserverL3: await task(lines.L3, { viewers: [persons.rita] }),
      ritaAssigneeL1: await task(lines.L1, { assignee: persons.rita }),
      ullaL5: await task(lines.L5, {}),
  }));
}

async function seedTargets(): Promise<Targets> {
  const one = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0].id as string;
  return inTenant(async () => {
    const out = {
      applications: await one(`INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), 'DA HTTP application') RETURNING id`, []),
      technologies: await one(`INSERT INTO technologies (tenant_id, name, item_number) VALUES (app_current_tenant(), 'DA HTTP technology', 900001) RETURNING id`, []),
      projects: await one(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES (app_current_tenant(), 'DA HTTP project', 900001) RETURNING id`, []),
    };
    // L2 holds each link, so a removal there has something to remove.
    const line = s.lines.L2;
    await client.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [out.applications, line]);
    await client.query(`INSERT INTO technology_spend_items (tenant_id, technology_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [out.technologies, line]);
    await client.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES (app_current_tenant(), $1, $2)`, [out.projects, line]);
    return out;
  });
}

async function linkCount(table: string, ownerColumn: string, line: string): Promise<number> {
  return inTenant(async () => Number((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${ownerColumn} = $1`, [line])).rows[0].n));
}

async function taskRow(id: string): Promise<{ title: string; status: string; assignee_user_id: string | null; owner_ids: string[]; viewer_ids: string[]; related_object_id: string }> {
  return inTenant(async () => (await client.query(
    `SELECT title, status, assignee_user_id, owner_ids, viewer_ids, related_object_id FROM tasks WHERE id = $1`, [id],
  )).rows[0]);
}

// ---------------------------------------------------------------------------------------------
// Scenarios.

async function testTaskUpdates(app: INestApplication) {
  const { persons, lines } = s;

  // Rita, assignee of a task of L5 (hidden from her), hands it to Ulla: kept as an observer.
  const handover = await call(app, 'PATCH', `tasks/${tasks.ritaAssigneeL5}`, persons.rita, { assignee_user_id: persons.ulla });
  assert.equal(handover.status, 200, `Rita, assignee on a hidden line, hands over: ${handover.text}`);
  assert.equal(handover.body.stillFollowing, true, handover.text);
  let row = await taskRow(tasks.ritaAssigneeL5);
  assert.equal(row.assignee_user_id, persons.ulla);
  assert.ok(row.viewer_ids.includes(persons.rita), 'Rita kept as an observer');
  assert.equal(row.related_object_id, lines.L5, 'the line is kept');

  // Rita, owner of a task of L5, hands it to Ulla.
  const ownerHandover = await call(app, 'PATCH', `tasks/${tasks.ritaOwnerL5}`, persons.rita, { owner_ids: [persons.ulla] });
  assert.equal(ownerHandover.status, 200, `Rita, owner on a hidden line, hands over: ${ownerHandover.text}`);
  assert.equal(ownerHandover.body.stillFollowing, true, ownerHandover.text);
  row = await taskRow(tasks.ritaOwnerL5);
  assert.deepEqual(row.owner_ids, [persons.ulla]);
  assert.ok(row.viewer_ids.includes(persons.rita), 'Rita kept as an observer');
  console.log('  handover of a task of a hidden line by its assignee and by its owner: 200, stillFollowing: OK');

  // Paul, assignee of a task of L1 (read only for him), may modify the task.
  const status = await call(app, 'PATCH', `tasks/${tasks.paulAssigneeL1}`, persons.paul, { status: 'in_progress' });
  assert.equal(status.status, 200, `Paul, assignee on a read-only line, status: ${status.text}`);
  assert.equal(status.body.stillFollowing, undefined, 'he reads the line: no observer added');
  const title = await call(app, 'PATCH', `tasks/${tasks.paulAssigneeL1}`, persons.paul, { title: 'Renamed by Paul' });
  assert.equal(title.status, 200, `Paul, assignee on a read-only line, title: ${title.text}`);
  row = await taskRow(tasks.paulAssigneeL1);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.title, 'Renamed by Paul');
  console.log('  assignee of a task of a read-only line: status and title 200: OK');

  // Rita observes a task of L3 (read only for her): refused.
  const observer = await call(app, 'PATCH', `tasks/${tasks.ritaObserverL3}`, persons.rita, { title: 'Renamed by Rita' });
  expectLimited(observer, DATA_ACCESS_READ_ONLY_TASK_MESSAGE, 'Rita, observer on a read-only line');
  assert.equal((await taskRow(tasks.ritaObserverL3)).title, 'DA HTTP task');
  console.log('  observer of a task of a read-only line: 403 DATA_ACCESS_LIMITED: OK');

  // Moves of Rita's task of L1 (editable): to L3 (read only) 403, to L5 (hidden) 404 as a random id.
  const toReadOnly = await call(app, 'PATCH', `tasks/${tasks.ritaAssigneeL1}`, persons.rita, { related_object_type: 'spend_item', related_object_id: lines.L3 });
  expectLimited(toReadOnly, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, 'Rita moves her task to a read-only line');
  const toHidden = await call(app, 'PATCH', `tasks/${tasks.ritaAssigneeL1}`, persons.rita, { related_object_type: 'spend_item', related_object_id: lines.L5 });
  const toMissing = await call(app, 'PATCH', `tasks/${tasks.ritaAssigneeL1}`, persons.rita, { related_object_type: 'spend_item', related_object_id: randomUUID() });
  assert.equal(toHidden.status, 404, `Rita moves her task to a hidden line: ${toHidden.text}`);
  assert.equal(toMissing.status, 404, toMissing.text);
  assert.equal(toHidden.body?.message, toMissing.body?.message, 'a hidden line answers as a missing one');
  assert.equal((await taskRow(tasks.ritaAssigneeL1)).related_object_id, lines.L1);
  console.log('  move to a read-only line 403, to a hidden line 404 as a missing one: OK');

  // Ulla (access to all data): served as before.
  const ulla = await call(app, 'PATCH', `tasks/${tasks.ullaL5}`, persons.ulla, { title: 'Renamed by Ulla', status: 'in_progress' });
  assert.equal(ulla.status, 200, ulla.text);
  assert.equal(ulla.body.stillFollowing, undefined);
  const ullaMove = await call(app, 'PATCH', `tasks/${tasks.ullaL5}`, persons.ulla, { related_object_type: 'spend_item', related_object_id: lines.L3 });
  assert.equal(ullaMove.status, 200, ullaMove.text);
  assert.equal((await taskRow(tasks.ullaL5)).related_object_id, lines.L3);
  console.log('  Ulla (all data): update and move 200: OK');
}

async function testTaskCreation(app: INestApplication) {
  const { persons, lines } = s;
  const readOnly = await call(app, 'POST', `spend-items/${lines.L3}/tasks`, persons.rita, { title: 'New on L3' });
  expectLimited(readOnly, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, 'Rita creates a task on a read-only line');
  const editable = await call(app, 'POST', `spend-items/${lines.L1}/tasks`, persons.rita, { title: 'New on L1' });
  assert.equal(editable.status, 201, `Rita creates a task on an editable line: ${editable.text}`);
  assert.equal(editable.body.related_object_id, lines.L1);
  const hidden = await call(app, 'POST', `spend-items/${lines.L5}/tasks`, persons.rita, { title: 'New on L5' });
  const missing = await call(app, 'POST', `spend-items/${randomUUID()}/tasks`, persons.rita, { title: 'New nowhere' });
  assert.equal(hidden.status, 404, `Rita creates a task on a hidden line: ${hidden.text}`);
  assert.equal(missing.status, 404, missing.text);
  assert.equal(hidden.body?.message, missing.body?.message, 'a hidden line answers as a missing one');
  const ulla = await call(app, 'POST', `spend-items/${lines.L5}/tasks`, persons.ulla, { title: 'New by Ulla' });
  assert.equal(ulla.status, 201, ulla.text);
  console.log('  task creation: read-only line 403, editable 201, hidden 404 as a missing one, Ulla 201: OK');
}

const LINKS: Record<keyof Targets, [string, string]> = {
  applications: ['application_spend_items', 'spend_item_id'],
  technologies: ['technology_spend_items', 'spend_item_id'],
  projects: ['portfolio_project_opex', 'opex_id'],
};

async function testRelations(app: INestApplication) {
  const { persons, lines } = s;
  const marta = persons.marta;
  for (const kind of Object.keys(LINKS) as Array<keyof Targets>) {
    const [table, ownerColumn] = LINKS[kind];
    const target = targets[kind];
    // L2: read only for Marta.
    const add = await call(app, 'POST', `budget-lines/${lines.L2}/relations/${kind}`, marta, { id: target });
    expectLimited(add, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, `Marta adds ${kind} to a read-only line`);
    const remove = await call(app, 'DELETE', `budget-lines/${lines.L2}/relations/${kind}/${target}`, marta);
    expectLimited(remove, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, `Marta removes ${kind} from a read-only line`);
    assert.equal(await linkCount(table, ownerColumn, lines.L2), 1, `${kind}: the link of L2 is kept`);
    // L4: editable.
    const added = await call(app, 'POST', `budget-lines/${lines.L4}/relations/${kind}`, marta, { id: target });
    assert.equal(added.status, 201, `Marta adds ${kind} to an editable line: ${added.text}`);
    assert.equal(added.body?.changed, true, added.text);
    assert.equal(await linkCount(table, ownerColumn, lines.L4), 1);
    const removed = await call(app, 'DELETE', `budget-lines/${lines.L4}/relations/${kind}/${target}`, marta);
    assert.equal(removed.status, 200, `Marta removes ${kind} from an editable line: ${removed.text}`);
    assert.equal(removed.body?.changed, true, removed.text);
    assert.equal(await linkCount(table, ownerColumn, lines.L4), 0);
    // L1: hidden from Marta, answered as a random id.
    const hidden = await call(app, 'POST', `budget-lines/${lines.L1}/relations/${kind}`, marta, { id: target });
    const missing = await call(app, 'POST', `budget-lines/${randomUUID()}/relations/${kind}`, marta, { id: target });
    assert.equal(hidden.status, 404, `Marta adds ${kind} to a hidden line: ${hidden.text}`);
    assert.equal(missing.status, 404, missing.text);
    assert.equal(hidden.body?.message, missing.body?.message, 'a hidden line answers as a missing one');
    const hiddenRemove = await call(app, 'DELETE', `budget-lines/${lines.L1}/relations/${kind}/${target}`, marta);
    assert.equal(hiddenRemove.status, 404, hiddenRemove.text);
  }
  // Ulla (all data) removes the links of L2 as before.
  for (const kind of Object.keys(LINKS) as Array<keyof Targets>) {
    const res = await call(app, 'DELETE', `budget-lines/${lines.L2}/relations/${kind}/${targets[kind]}`, persons.ulla);
    assert.equal(res.status, 200, res.text);
  }
  console.log('  Relations tab (applications, technologies, projects): read-only line 403, editable 201 / 200, hidden 404 as a missing one: OK');
}

// ---------------------------------------------------------------------------------------------
// Run.

async function cleanup() {
  if (!s) return;
  await withTenantExecution(dataSource, s.tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
    .catch((error) => console.error(`could not purge ${s.tenantId}:`, error));
  await client.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId])
    .catch((error: unknown) => console.error(`could not delete ${s.tenantId}:`, error));
}

async function run() {
  client = await connect(APP_URL);
  await dataSource.initialize();
  let app: INestApplication | null = null;
  try {
    hasRole = await roleExists(client);
    console.log(`data access line routes over HTTP (role ${hasRole ? 'installed' : 'absent'})`);
    if (!hasRole) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log('data access line routes over HTTP: role absent, skipped');
      return;
    }
    await client.query(`SELECT data_access_sync_policies()`);
    await client.query('BEGIN');
    try {
      s = await seed(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    tasks = await seedTasks();
    targets = await seedTargets();
    app = await createApp();
    await testTaskUpdates(app);
    await testTaskCreation(app);
    await testRelations(app);
    console.log('data access line routes over HTTP: all scenarios passed');
  } finally {
    if (app) await app.close();
    try {
      await cleanup();
    } finally {
      await dataSource.destroy();
      await client.end();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
