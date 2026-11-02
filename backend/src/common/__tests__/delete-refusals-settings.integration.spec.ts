import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AppInstancesService } from '../../app-instances/app-instances.service';
import { Application } from '../../applications/application.entity';
import { ApplicationsDeleteService } from '../../applications/applications-delete.service';
import { BusinessProcessCategoriesService } from '../../business-processes/business-process-categories.service';
import { InterfacesCrudService } from '../../interfaces/services/interfaces-crud.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { PortfolioClassificationService } from '../../portfolio/portfolio-classification.service';
import { PortfolioEmploymentTypesService } from '../../portfolio/portfolio-employment-types.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioTeamsService } from '../../portfolio/portfolio-teams.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { Role } from '../../roles/role.entity';
import { RolesController } from '../../roles/roles.controller';
import { RolesService } from '../../roles/roles.service';
import { Task } from '../../tasks/task.entity';
import { TasksDeleteService } from '../../tasks/tasks-delete.service';
import { UserRole } from '../../users/user-role.entity';

// The settings lists and the other refusable deletes answer as the master data ones (lot 5 bis):
// a 409 whose `code` the interface translates, with what holds the record counted per kind
// (`usages`) or the values its sentence names (`params`), so no English message reaches the
// interface. Each test runs under a throwaway tenant in a rolled-back transaction.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const noAudit = { log: async () => undefined } as any;

async function withRollback(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Delete refusals', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `del-settings-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

let savepoint = 0;
let itemNumber = 800_000;

/** The refusal of a delete, under a savepoint: a 409 with the code, the counts per kind and the params. */
async function expectRefusal(
  runner: QueryRunner,
  run: () => Promise<unknown>,
  code: string,
  usages: Array<{ type: string; total: number }>,
  message: RegExp,
  params?: Record<string, unknown>,
) {
  const name = `refusal_${(savepoint += 1)}`;
  await runner.query(`SAVEPOINT ${name}`);
  try {
    await assert.rejects(run, (err: unknown) => {
      assert.ok(err instanceof ConflictException, `a 409, got ${(err as Error)?.constructor?.name}: ${(err as Error)?.message}`);
      const body = err.getResponse() as Record<string, unknown>;
      assert.equal(body.code, code);
      assert.deepEqual(body.usages, usages);
      assert.match(String(body.message), message);
      assert.deepEqual(body.params, params);
      return true;
    });
  } finally {
    await runner.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }
}

async function request(runner: QueryRunner, t: string, columns: Record<string, unknown> = {}): Promise<string> {
  const keys = Object.keys(columns);
  return one(
    runner,
    `INSERT INTO portfolio_requests (tenant_id, name, item_number${keys.map((k) => `, ${k}`).join('')})
     VALUES ($1, 'Request', $2${keys.map((_, i) => `, $${i + 3}`).join('')}) RETURNING id`,
    [t, (itemNumber += 1), ...keys.map((k) => columns[k])],
  );
}

async function testClassification() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const svc = new PortfolioClassificationService(null as any, null as any, null as any, null as any);
    const opts = { manager: m };
    const system = await one(runner, `INSERT INTO portfolio_sources (tenant_id, name, is_system) VALUES ($1, 'Built in', true) RETURNING id`, [t]);
    const source = await one(runner, `INSERT INTO portfolio_sources (tenant_id, name) VALUES ($1, 'Board') RETURNING id`, [t]);
    const category = await one(runner, `INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Growth') RETURNING id`, [t]);
    const stream = await one(runner, `INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Sales') RETURNING id`, [t, category]);
    const taskType = await one(runner, `INSERT INTO portfolio_task_types (tenant_id, name) VALUES ($1, 'Review') RETURNING id`, [t]);
    await request(runner, t, { source_id: source, category_id: category, stream_id: stream });
    await request(runner, t, { source_id: source, category_id: category, stream_id: stream });
    await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number, source_id) VALUES ($1, 'Project', $2, $3) RETURNING id`, [t, (itemNumber += 1), source]);
    await one(runner, `INSERT INTO tasks (tenant_id, title, item_number, task_type_id) VALUES ($1, 'Task', $2, $3) RETURNING id`, [t, (itemNumber += 1), taskType]);

    await expectRefusal(runner, () => svc.deleteSource(system, t, opts), 'BUILT_IN_RECORD', [], /^Cannot delete system source "Built in"/);
    await expectRefusal(runner, () => svc.deleteSource(source, t, opts), 'RECORD_USED_BY',
      [{ type: 'requests', total: 2 }, { type: 'projects', total: 1 }], /Board/);
    await expectRefusal(runner, () => svc.deleteCategory(category, t, opts), 'RECORD_USED_BY', [{ type: 'requests', total: 2 }], /Growth/);
    await expectRefusal(runner, () => svc.deleteStream(stream, t, opts), 'RECORD_USED_BY', [{ type: 'requests', total: 2 }], /Sales/);
    await expectRefusal(runner, () => svc.deleteTaskType(taskType, t, opts), 'RECORD_USED_BY', [{ type: 'tasks', total: 1 }], /Review/);

    // The check before the delete answers the same refusals, and nothing for a free item.
    const freeSource = await one(runner, `INSERT INTO portfolio_sources (tenant_id, name) VALUES ($1, 'Free') RETURNING id`, [t]);
    const freeCategory = await one(runner, `INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Free') RETURNING id`, [t]);
    const freeStream = await one(runner, `INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Free') RETURNING id`, [t, freeCategory]);
    const freeTaskType = await one(runner, `INSERT INTO portfolio_task_types (tenant_id, name) VALUES ($1, 'Free') RETURNING id`, [t]);
    assert.deepEqual(await svc.deleteCheck('sources', [system, source, freeSource, 'nope'], t, opts), {
      refused: [
        { id: system, name: 'Built in', code: 'BUILT_IN_RECORD', usages: [] },
        { id: source, name: 'Board', code: 'RECORD_USED_BY', usages: [{ type: 'requests', total: 2 }, { type: 'projects', total: 1 }] },
      ],
    });
    assert.deepEqual(await svc.deleteCheck('categories', [category, freeCategory], t, opts), {
      refused: [{ id: category, name: 'Growth', code: 'RECORD_USED_BY', usages: [{ type: 'requests', total: 2 }] }],
    });
    assert.deepEqual(await svc.deleteCheck('streams', [freeStream, stream], t, opts), {
      refused: [{ id: stream, name: 'Sales', code: 'RECORD_USED_BY', usages: [{ type: 'requests', total: 2 }] }],
    });
    assert.deepEqual(await svc.deleteCheck('task-types', [taskType, freeTaskType], t, opts), {
      refused: [{ id: taskType, name: 'Review', code: 'RECORD_USED_BY', usages: [{ type: 'tasks', total: 1 }] }],
    });
    assert.equal((await runner.query(`SELECT count(*)::int AS n FROM portfolio_sources WHERE tenant_id = $1`, [t]))[0].n, 3);
  });
}

async function testTeamsAndContractTypes() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const teams = new PortfolioTeamsService(null as any);
    const types = new PortfolioEmploymentTypesService(null as any);
    const builtIn = await one(runner, `INSERT INTO portfolio_teams (tenant_id, name, is_system) VALUES ($1, 'Core', true) RETURNING id`, [t]);
    const team = await one(runner, `INSERT INTO portfolio_teams (tenant_id, name) VALUES ($1, 'Apps') RETURNING id`, [t]);
    await one(runner, `INSERT INTO portfolio_teams (tenant_id, name, parent_id) VALUES ($1, 'Apps north', $2) RETURNING id`, [t, team]);
    const type = await one(runner, `INSERT INTO portfolio_employment_types (tenant_id, name) VALUES ($1, 'Contractor') RETURNING id`, [t]);
    const user = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Member') RETURNING id`, [t])
      .then((role) => one(runner, `INSERT INTO users (tenant_id, email, role_id) VALUES ($1, 'ana@example.test', $2) RETURNING id`, [t, role]));
    await one(runner,
      `INSERT INTO portfolio_team_member_configs (tenant_id, user_id, item_number, team_id, employment_type_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [t, user, (itemNumber += 1), team, type]);

    await expectRefusal(runner, () => teams.delete(builtIn, t, { manager: m }), 'BUILT_IN_RECORD', [], /^Cannot delete system team/);
    await expectRefusal(runner, () => teams.delete(team, t, { manager: m }), 'TEAM_NOT_EMPTY',
      [{ type: 'team_members', total: 1 }, { type: 'sub_teams', total: 1 }], /^Cannot delete team "Apps"/);
    await expectRefusal(runner, () => types.delete(type, t, { manager: m }), 'RECORD_USED_BY',
      [{ type: 'contributors', total: 1 }], /assigned to contributors/);

    const freeTeam = await one(runner, `INSERT INTO portfolio_teams (tenant_id, name) VALUES ($1, 'Free') RETURNING id`, [t]);
    const freeType = await one(runner, `INSERT INTO portfolio_employment_types (tenant_id, name) VALUES ($1, 'Free') RETURNING id`, [t]);
    assert.deepEqual(await teams.deleteCheck([builtIn, team, freeTeam, 'nope'], t, { manager: m }), {
      refused: [
        { id: builtIn, name: 'Core', code: 'BUILT_IN_RECORD', usages: [] },
        { id: team, name: 'Apps', code: 'TEAM_NOT_EMPTY', usages: [{ type: 'team_members', total: 1 }, { type: 'sub_teams', total: 1 }] },
      ],
    });
    assert.deepEqual(await types.deleteCheck([freeType, type], t, { manager: m }), {
      refused: [{ id: type, name: 'Contractor', code: 'RECORD_USED_BY', usages: [{ type: 'contributors', total: 1 }] }],
    });
  });
}

async function testRolesAndProcessCategories() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const roles = new RolesController(
      new RolesService(m.getRepository(Role), m.getRepository(RolePermission)),
      null as any,
      m.getRepository(Role),
      null as any,
      m.getRepository(UserRole),
      noAudit,
    );
    const req = { queryRunner: runner, user: { sub: randomUUID() } };
    const builtIn = await one(runner, `INSERT INTO roles (tenant_id, role_name, is_built_in) VALUES ($1, 'Reader', true) RETURNING id`, [t]);
    const role = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Buyers') RETURNING id`, [t]);
    const user = await one(runner, `INSERT INTO users (tenant_id, email, role_id) VALUES ($1, 'bo@example.test', $2) RETURNING id`, [t, role]);
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [t, user, role]);
    await expectRefusal(runner, () => roles.deleteRole(builtIn, req), 'ROLE_BUILT_IN', [], /^Cannot delete built-in role "Reader"/);
    await expectRefusal(runner, () => roles.deleteRole(role, req), 'ROLE_IN_USE', [{ type: 'users', total: 1 }], /with users assigned/);

    const categories = new BusinessProcessCategoriesService(null as any, null as any, noAudit);
    const category = await one(runner, `INSERT INTO business_process_categories (tenant_id, name) VALUES ($1, 'Finance') RETURNING id`, [t]);
    for (const name of ['Close', 'Pay']) {
      const process = await one(runner, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, $2) RETURNING id`, [t, name]);
      await runner.query(`INSERT INTO business_process_category_links (tenant_id, process_id, category_id) VALUES ($1, $2, $3)`, [t, process, category]);
    }
    await expectRefusal(runner, () => categories.delete(category, null, { manager: m }), 'RECORD_USED_BY',
      [{ type: 'business_processes', total: 2 }], /used by one or more business processes/);
  });
}

async function testAppInstances() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const svc = new AppInstancesService(null as any, null as any, null as any, null as any, noAudit, null as any);
    const app = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [t]);
    const instance = await one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [t, app]);
    for (const name of ['srv-1', 'srv-2']) {
      const asset = await one(runner,
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
         VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', 'active', now(), now()) RETURNING id`, [t, name]);
      await runner.query(`INSERT INTO app_asset_assignments (tenant_id, asset_id, app_instance_id, role) VALUES ($1, $2, $3, 'app')`, [t, asset, instance]);
    }
    await expectRefusal(runner, () => svc.delete(instance, null, { manager: m }), 'DEPLOYMENT_IN_USE',
      [{ type: 'server_assignments', total: 2 }], /^Cannot delete deployment with server assignments/);
  });
}

async function testKnowledge() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const svc = Object.create(KnowledgeService.prototype) as KnowledgeService;
    Object.assign(svc, { audit: noAudit, assertDocumentWritable: async () => undefined, assertLibraryWritable: async () => undefined });
    const library = await one(runner, `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Docs', 'docs') RETURNING id`, [t]);
    const type = await one(runner, `INSERT INTO document_types (tenant_id, name) VALUES ($1, 'Runbook') RETURNING id`, [t]);
    const doc = (title: string) => one(runner,
      `INSERT INTO documents (tenant_id, title, library_id, item_number, document_type_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [t, title, library, (itemNumber += 1), type]);
    const free = await doc('Free');
    const managed = await doc('Request brief');
    await runner.query(
      `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id) VALUES ($1, 'requests', $2, 'purpose', $3)`,
      [t, randomUUID(), managed]);
    const folder = await one(runner, `INSERT INTO document_folders (tenant_id, name, library_id) VALUES ($1, 'Ops', $2) RETURNING id`, [t, library]);
    const child = await one(runner, `INSERT INTO document_folders (tenant_id, name, library_id, parent_id) VALUES ($1, 'Night', $2, $3) RETURNING id`, [t, library, folder]);

    assert.deepEqual(await svc.deleteCheck([free, managed, 'nope'], { manager: m }), {
      refused: [{ id: managed, name: 'Request brief', code: 'KNOWLEDGE_DOCUMENT_MANAGED', usages: [] }],
    });
    await expectRefusal(runner, () => svc.remove(managed, null, { manager: m }), 'KNOWLEDGE_DOCUMENT_MANAGED', [], /cannot be moved or deleted/);
    await expectRefusal(runner, () => svc.deleteType(type, { manager: m }), 'RECORD_USED_BY', [{ type: 'documents', total: 2 }], /document type in use/);
    await expectRefusal(runner, () => svc.deleteFolder(folder, { manager: m }), 'KNOWLEDGE_FOLDER_HAS_SUBFOLDERS',
      [{ type: 'sub_folders', total: 1 }], /child folders/);
    // The check before a folder's delete: the folder with subfolders, not the empty one.
    assert.deepEqual(await svc.folderDeleteCheck([child, folder, 'nope'], { manager: m }), {
      refused: [{ id: folder, name: 'Ops', code: 'KNOWLEDGE_FOLDER_HAS_SUBFOLDERS', usages: [{ type: 'sub_folders', total: 1 }] }],
    });
    const bulk = await svc.bulkRemove([free, managed], null, { manager: m });
    assert.deepEqual(bulk.deleted, [free]);
    assert.deepEqual(bulk.failed.map((f) => [f.code, f.usages]), [['KNOWLEDGE_DOCUMENT_MANAGED', []]]);
  });
}

async function testRequestsAndTasks() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const requests = Object.create(PortfolioRequestsService.prototype) as PortfolioRequestsService;
    const converted = await request(runner, t, { status: 'converted' });
    await expectRefusal(runner, () => requests.delete(converted, null, { manager: m }), 'REQUEST_CONVERTED', [], /^Converted requests cannot be deleted/);

    const tasks = new TasksDeleteService(m.getRepository(Task), noAudit, { recalculateUserMonth: async () => undefined } as any);
    const task = (title: string) => one(runner, `INSERT INTO tasks (tenant_id, title, item_number) VALUES ($1, $2, $3) RETURNING id`, [t, title, (itemNumber += 1)]);
    const free = await task('Free');
    const origin = await task('Origin');
    await request(runner, t, { origin_task_id: origin });
    const [{ item_number }] = await runner.query(`SELECT item_number FROM portfolio_requests WHERE origin_task_id = $1`, [origin]);
    const params = { reference: `REQ-${item_number}` };

    assert.deepEqual(await tasks.deleteCheck([free, origin, 'nope'], { manager: m }), {
      refused: [{ id: origin, name: 'Origin', code: 'TASK_REQUEST_ORIGIN', usages: [], params }],
    });
    await expectRefusal(runner, () => tasks.delete(origin, { manager: m }), 'TASK_REQUEST_ORIGIN', [], /origin of request REQ-/, params);
    const bulk = await tasks.bulkDelete([free, origin], null, { manager: m });
    assert.deepEqual(bulk.deleted, [free]);
    assert.deepEqual(bulk.failed.map((f) => [f.code, f.params]), [['TASK_REQUEST_ORIGIN', params]]);
  });
}

async function testInterfaces() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const svc = Object.create(InterfacesCrudService.prototype) as InterfacesCrudService;
    Object.assign(svc, { audit: noAudit, integratedDocuments: { deleteForEntity: async () => undefined } });
    const source = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'CRM') RETURNING id`, [t]);
    const target = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [t]);
    const from = await one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [t, source]);
    const to = await one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [t, target]);
    const iface = (name: string, ref: string) => one(runner,
      `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category,
         integration_route_type, interface_reference)
       VALUES ($1, $2, 'Sync', $3, $4, 'master_data', 'direct', $5) RETURNING id`, [t, name, source, target, ref]);
    const free = await iface('Free', 'INT-9001');
    const bound = await iface('Orders', 'INT-9002');
    const leg = await one(runner,
      `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type, integration_pattern, data_format, order_index)
       VALUES ($1, $2, 'direct', 'source', 'target', 'event', 'api', 'json', 0) RETURNING id`, [t, bound]);
    for (const environment of ['prod', 'test']) {
      await runner.query(
        `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id)
         VALUES ($1, $2, $3, $4, $5, $6)`, [t, bound, leg, environment, from, to]);
    }

    await expectRefusal(runner, () => svc.delete(bound, null, { manager: m }), 'INTERFACE_HAS_BINDINGS',
      [{ type: 'interface_bindings', total: 2 }], /^Cannot delete interface with bindings/);
    // The check before the delete answers the same refusal, and nothing for the free interface.
    assert.deepEqual(await svc.deleteCheck([free, bound, 'nope'], { manager: m }), {
      refused: [{ id: bound, name: 'Orders', code: 'INTERFACE_HAS_BINDINGS', usages: [{ type: 'interface_bindings', total: 2 }] }],
    });
    assert.equal((await runner.query(`SELECT count(*)::int AS n FROM interface_bindings WHERE interface_id = $1`, [bound]))[0].n, 2);
    // The window's alternative: deleting the bindings with it lifts the refusal.
    await svc.delete(bound, null, { manager: m, deleteRelatedBindings: true });
    assert.equal((await runner.query(`SELECT count(*)::int AS n FROM interfaces WHERE id = $1`, [bound]))[0].n, 0);
  });
}

async function testApplications() {
  await withRollback(async (runner, t) => {
    const m = runner.manager;
    const svc = new ApplicationsDeleteService(m.getRepository(Application), noAudit, null as any, { deleteForEntity: async () => 0 } as any);
    const app = (name: string) => one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [t, name]);
    const crm = await app('CRM');
    const erp = await app('ERP');
    const hub = await app('Hub');
    const free = await app('Free');
    for (const environment of ['prod', 'test']) {
      await runner.query(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, $3)`, [t, free, environment]);
    }
    let ref = 9100;
    const iface = (source: string, target: string) => runner.query(
      `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category,
         integration_route_type, interface_reference)
       VALUES ($1, 'Flow', 'Sync', $2, $3, 'master_data', 'direct', $4)`, [t, source, target, `INT-${(ref += 1)}`]);
    await iface(crm, erp);
    await iface(erp, hub);

    // Source or target: an application with interfaces is refused, counted, and stays.
    await expectRefusal(runner, () => svc.delete(erp, { manager: m }), 'APPLICATION_HAS_INTERFACES',
      [{ type: 'interfaces', total: 2 }], /^Cannot delete application "ERP": it is used by 2 interfaces\. Disable it instead\./);
    await expectRefusal(runner, () => svc.delete(hub, { manager: m }), 'APPLICATION_HAS_INTERFACES', [{ type: 'interfaces', total: 1 }], /Hub/);

    // The check: the refusals in the order asked, and the deployments the others take with them.
    assert.deepEqual(await svc.deleteCheck([free, erp, crm, 'nope'], { manager: m }), {
      refused: [
        { id: erp, name: 'ERP', code: 'APPLICATION_HAS_INTERFACES', usages: [{ type: 'interfaces', total: 2 }] },
        { id: crm, name: 'CRM', code: 'APPLICATION_HAS_INTERFACES', usages: [{ type: 'interfaces', total: 1 }] },
      ],
      removes: [{ type: 'app_instances', total: 2 }],
    });
    assert.deepEqual(await svc.deleteCheck([crm], { manager: m }), {
      refused: [{ id: crm, name: 'CRM', code: 'APPLICATION_HAS_INTERFACES', usages: [{ type: 'interfaces', total: 1 }] }],
      removes: [],
    });

    const bulk = await svc.bulkDelete([free, erp], null, { manager: m });
    assert.deepEqual(bulk.deleted, [free]);
    assert.deepEqual(bulk.failed.map((f) => [f.name, f.code, f.usages]), [['ERP', 'APPLICATION_HAS_INTERFACES', [{ type: 'interfaces', total: 2 }]]]);
    assert.equal((await runner.query(`SELECT count(*)::int AS n FROM interfaces WHERE tenant_id = $1`, [t]))[0].n, 2);
  });
}

async function run() {
  await dataSource.initialize();
  try {
    for (const test of [testClassification, testTeamsAndContractTypes, testRolesAndProcessCategories, testAppInstances, testKnowledge, testRequestsAndTasks, testInterfaces, testApplications]) {
      await test();
      console.log(`  ok ${test.name}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('delete-refusals-settings.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
