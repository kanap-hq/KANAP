// @database-spec
import 'dotenv/config';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Application } from '../../applications/application.entity';
import { ApplicationsDeleteService } from '../../applications/applications-delete.service';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { assert, inRolledBackTransaction, runSpecs, seedItem, seedTenant, setTenant, underSavepoint } from '../../spend/__tests__/round-inputs.fixtures';
import { ApplicationConversionController } from '../application-conversion.controller';
import { ApplicationConversionService } from '../application-conversion.service';
import { asset, assign, one, services, type AuditEntry } from './technologies.fixtures';

// Converting an application to a technology (lot C1) against a real database: the preview and the
// conversion of a fully linked application, each refusal, a failure in the middle (nothing lost,
// files intact), the rights of the routes and the tenant isolation.

/** An in-memory object store: what the conversion copies and deletes is visible. */
function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const state = { failPut: false };
  const storage = {
    objects,
    state,
    async putObject(params: { key: string; body: Buffer | Readable }) {
      if (state.failPut) throw new Error('storage down');
      const chunks: Buffer[] = [];
      if (Buffer.isBuffer(params.body)) chunks.push(params.body);
      else for await (const chunk of params.body as Readable) chunks.push(Buffer.from(chunk));
      objects.set(params.key, Buffer.concat(chunks));
    },
    async getObjectStream(key: string) {
      const body = objects.get(key);
      if (!body) throw new Error(`missing ${key}`);
      return { stream: Readable.from([body]), contentType: 'text/plain', contentLength: body.length };
    },
    async deleteObject(key: string) {
      objects.delete(key);
    },
  };
  return storage;
}

function conversion(audit: AuditEntry[], storage: ReturnType<typeof memoryStorage>, opts: { failDelete?: boolean } = {}) {
  const { technologies } = services(audit);
  const auditLog = { log: async (entry: AuditEntry) => void audit.push(entry) };
  const deleteSvc = new ApplicationsDeleteService(dataSource.getRepository(Application), auditLog as any, storage as any, { deleteForEntity: async () => 0 } as any);
  if (opts.failDelete) deleteSvc.delete = async () => { throw new Error('delete failed'); };
  return new ApplicationConversionService(technologies, deleteSvc, auditLog as any, storage as any);
}

async function application(runner: QueryRunner, tenantId: string, name: string, extra: { reference?: string } = {}) {
  return one(runner,
    `INSERT INTO applications (tenant_id, name, editor, description, notes, lifecycle, rto_minutes, rpo_minutes, sequential_id)
     VALUES ($1, $2, 'VMware', 'Virtualisation platform', 'Some notes', 'active', 240, 60, $3) RETURNING id`,
    [tenantId, name, extra.reference ?? null]);
}

async function instance(runner: QueryRunner, tenantId: string, appId: string, environment = 'prod') {
  return one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, $3) RETURNING id`, [tenantId, appId, environment]);
}

async function iface(runner: QueryRunner, tenantId: string, source: string, target: string, ref: string) {
  return one(runner,
    `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category, integration_route_type, interface_reference, lifecycle)
     VALUES ($1, $2, 'p', $3, $4, 'transactional', 'point_to_point', $2, 'active') RETURNING id`,
    [tenantId, ref, source, target]);
}

async function binding(runner: QueryRunner, tenantId: string, interfaceId: string, sourceInstance: string, targetInstance: string, tool: string | null = null) {
  const leg = await one(runner,
    `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type, integration_pattern, data_format, order_index)
     VALUES ($1, $2, 'direct', 'source', 'target', 'event_based', 'rest_api_sync', 'json', 0) RETURNING id`, [tenantId, interfaceId]);
  await runner.query(
    `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id, integration_tool_application_id)
     VALUES ($1, $2, $3, 'prod', $4, $5, $6)`, [tenantId, interfaceId, leg, sourceInstance, targetInstance, tool]);
}

/** The application of the brief: owners, a contract, two budget lines of both natures, a project, a link, a file, an incident, two instances on three servers. */
async function seedLinkedApplication(runner: QueryRunner, tenantId: string, storage: ReturnType<typeof memoryStorage>) {
  const app = await application(runner, tenantId, 'vSphere', { reference: 'APP-7' });
  const role = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Conv role') RETURNING id`, [tenantId]);
  const userA = await one(runner, `INSERT INTO users (tenant_id, email, role_id) VALUES ($1, $2, $3) RETURNING id`, [tenantId, `a-${randomUUID()}@example.invalid`, role]);
  const userB = await one(runner, `INSERT INTO users (tenant_id, email, role_id) VALUES ($1, $2, $3) RETURNING id`, [tenantId, `b-${randomUUID()}@example.invalid`, role]);
  await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'it'), ($1, $2, $4, 'business')`, [tenantId, app, userA, userB]);
  const company = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Co', 'FR', 'Lyon') RETURNING id`, [tenantId]);
  const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Broadcom') RETURNING id`, [tenantId]);
  const contract = await one(runner, `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'VCF', $2, $3, DATE '2026-01-01') RETURNING id`, [tenantId, company, supplier]);
  await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, app, contract]);
  const opex = await seedItem(runner, 'opex', tenantId, 1, 'vSphere licences');
  const capex = await seedItem(runner, 'capex', tenantId, 2, 'vSphere hosts');
  await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, app, opex, capex]);
  const project = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Upgrade', 1) RETURNING id`, [tenantId]);
  await runner.query(`INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $3)`, [tenantId, app, project]);
  await runner.query(`INSERT INTO application_links (tenant_id, application_id, description, url) VALUES ($1, $2, 'Console', 'https://vcenter.example')`, [tenantId, app]);
  const original = `files/${tenantId}/applications/${app}/u1_design.txt`;
  storage.objects.set(original, Buffer.from('design'));
  await runner.query(
    `INSERT INTO application_attachments (tenant_id, application_id, original_filename, stored_filename, storage_path, size) VALUES ($1, $2, 'design.txt', 'u1_design.txt', $3, 6)`,
    [tenantId, app, original]);
  const incident = await one(runner,
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, status) VALUES ($1, 1, 'Outage', 'low', false, 'open') RETURNING id`, [tenantId]);
  await runner.query(`INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`, [tenantId, incident, app]);
  const servers = [await asset(runner, tenantId, 'ESX-01'), await asset(runner, tenantId, 'ESX-02'), await asset(runner, tenantId, 'ESX-03')];
  await assign(runner, tenantId, app, servers[0], 'prod');
  await assign(runner, tenantId, app, servers[1], 'prod');
  await assign(runner, tenantId, app, servers[2], 'test');
  await assign(runner, tenantId, app, servers[0], 'test');
  // Lost with it: a suite membership, a predecessor, a successor, a residency.
  const suite = await application(runner, tenantId, 'Suite');
  await runner.query(`INSERT INTO application_suites (tenant_id, application_id, suite_id) VALUES ($1, $2, $3)`, [tenantId, app, suite]);
  const predecessor = await application(runner, tenantId, 'ESX classic');
  await runner.query(`UPDATE applications SET predecessor_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, app, predecessor]);
  const successor = await application(runner, tenantId, 'VCF');
  await runner.query(`UPDATE applications SET predecessor_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, successor, app]);
  await runner.query(`INSERT INTO application_data_residency (tenant_id, application_id, country_iso) VALUES ($1, $2, 'FR')`, [tenantId, app]);
  return { app, users: [userA, userB], contract, lines: [opex, capex], project, incident, servers, original, successor };
}

const count = async (runner: QueryRunner, sql: string, params: unknown[]) => Number((await runner.query(sql, params))[0].n);

async function testPreviewAndConvert() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-full');
    const storage = memoryStorage();
    const audit: AuditEntry[] = [];
    const svc = conversion(audit, storage);
    const seeded = await seedLinkedApplication(runner, tenantId, storage);
    const opts = { manager: runner.manager, tenantId, userId: null };

    const preview = await svc.preview(seeded.app, opts);
    assert.deepEqual(preview.refusals, []);
    assert.equal(preview.mode, 'installed');
    assert.deepEqual(preview.application, { id: seeded.app, name: 'vSphere', reference: 'APP-7' });
    assert.deepEqual(preview.moves, { owners: 2, contracts: 1, budget_lines: 2, projects: 1, links: 1, attachments: 1, incidents: 1, servers: 3 });
    assert.equal(preview.losses.instances, 2);
    assert.equal(preview.losses.suites, 1);
    assert.equal(preview.losses.predecessor, 1);
    assert.equal(preview.losses.successors, 1);
    assert.equal(preview.losses.data_residency, 1);

    const { technology, files } = await svc.convert(seeded.app, { family: 'hypervisor' }, opts);
    const [tech] = await runner.query(`SELECT * FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, technology.id]);
    assert.equal(tech.name, 'vSphere');
    assert.equal(tech.editor, 'VMware');
    assert.equal(tech.family, 'hypervisor');
    assert.equal(tech.mode, 'installed');
    assert.equal(tech.description, 'Virtualisation platform');
    assert.deepEqual([tech.rto_minutes, tech.rpo_minutes], [240, 60]);
    assert.equal(technology.reference, `TEC-${tech.item_number}`);
    const of = (table: string, column: string) => runner.query(`SELECT ${column} AS v FROM ${table} WHERE tenant_id = $1 AND technology_id = $2 ORDER BY 1`, [tenantId, technology.id]).then((rows: any[]) => rows.map((r) => r.v));
    assert.deepEqual(await of('technology_owners', 'user_id'), [...seeded.users].sort());
    assert.deepEqual(await of('technology_contracts', 'contract_id'), [seeded.contract]);
    assert.deepEqual(await of('technology_spend_items', 'spend_item_id'), [...seeded.lines].sort(), 'both natures');
    assert.deepEqual(await of('technology_projects', 'project_id'), [seeded.project]);
    assert.deepEqual(await of('technology_links', 'url'), ['https://vcenter.example']);
    assert.deepEqual(await of('incident_technologies', 'incident_id'), [seeded.incident]);
    const servers = await runner.query(
      `SELECT asset_id, technology_version_id, source, notes FROM asset_technologies WHERE tenant_id = $1 AND technology_id = $2 ORDER BY asset_id`, [tenantId, technology.id]);
    assert.deepEqual(servers.map((s: any) => s.asset_id), [...seeded.servers].sort(), 'three servers, once each');
    assert.ok(servers.every((s: any) => s.technology_version_id === null && s.source === 'manual' && s.notes === 'Converted from APP-7'));
    const [file] = await runner.query(`SELECT storage_path, original_filename FROM technology_attachments WHERE tenant_id = $1 AND technology_id = $2`, [tenantId, technology.id]);
    assert.equal(file.storage_path, `files/${tenantId}/technologies/${technology.id}/u1_design.txt`);
    assert.equal(file.original_filename, 'design.txt');
    assert.equal(storage.objects.get(file.storage_path)?.toString(), 'design', 'copied before the commit');
    assert.ok(storage.objects.has(seeded.original), 'the original stays until the commit');

    assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, seeded.app]), 0, 'the application is gone');
    assert.equal(await count(runner, `SELECT count(*) AS n FROM app_instances WHERE tenant_id = $1 AND application_id = $2`, [tenantId, seeded.app]), 0);
    assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2 AND predecessor_id IS NULL`, [tenantId, seeded.successor]), 1, 'the successor stays');
    const tables = audit.map((entry) => `${entry.table}:${entry.action}`);
    assert.ok(tables.includes('technologies:create') && tables.includes('technologies:update') && tables.includes('applications:update') && tables.includes('applications:delete'));
    const trace = audit.find((entry) => entry.table === 'technologies' && entry.action === 'update') as any;
    assert.equal(trace.after.converted_from_application.reference, 'APP-7', 'the old reference stays readable');

    await svc.settleFiles(files, true);
    assert.ok(!storage.objects.has(seeded.original), 'the original goes after the commit');
    assert.ok(storage.objects.has(file.storage_path));
  });
}

async function testSubscribedWithoutServers() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-saas');
    const svc = conversion([], memoryStorage());
    const app = await application(runner, tenantId, 'Entra ID');
    const opts = { manager: runner.manager, tenantId };
    assert.equal((await svc.preview(app, opts)).mode, 'subscribed');
    await assert.rejects(svc.convert(app, {}, opts), /Family is required/);
    const { technology } = await svc.convert(app, { family: 'directory' }, opts);
    const [row] = await runner.query(`SELECT mode FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, technology.id]);
    assert.equal(row.mode, 'subscribed');
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-refuse');
    const svc = conversion([], memoryStorage());
    const opts = { manager: runner.manager, tenantId };
    const x = await application(runner, tenantId, 'ERP');
    const y = await application(runner, tenantId, 'CRM');
    const xi = await instance(runner, tenantId, x);
    const yi = await instance(runner, tenantId, y);
    const between = await iface(runner, tenantId, x, y, 'INT-1');

    const reasons = async (app: string) => (await svc.preview(app, opts)).refusals.map((r) => r.reason);
    const refused = async (app: string, reason: string) => {
      assert.deepEqual(await reasons(app), [reason]);
      await assert.rejects(svc.convert(app, { family: 'other' }, opts), (err: any) =>
        err instanceof ConflictException && (err.getResponse() as any).refusals?.[0]?.reason === reason);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, app]), 1);
    };

    const sourced = await application(runner, tenantId, 'Source app');
    await iface(runner, tenantId, sourced, y, 'INT-2');
    await refused(sourced, 'interfaces');

    const middleware = await application(runner, tenantId, 'BizTalk');
    await runner.query(`INSERT INTO interface_middleware_applications (tenant_id, interface_id, application_id) VALUES ($1, $2, $3)`, [tenantId, between, middleware]);
    await refused(middleware, 'middleware');

    const tool = await application(runner, tenantId, 'MuleSoft');
    await binding(runner, tenantId, between, xi, yi, tool);
    await refused(tool, 'integration_tool');

    const suite = await application(runner, tenantId, 'Office');
    const component = await application(runner, tenantId, 'Word');
    await runner.query(`INSERT INTO application_suites (tenant_id, application_id, suite_id) VALUES ($1, $2, $3)`, [tenantId, component, suite]);
    await refused(suite, 'suite_components');

    const bound = await application(runner, tenantId, 'Gateway');
    const boundInstance = await instance(runner, tenantId, bound);
    await binding(runner, tenantId, between, boundInstance, yi);
    await refused(bound, 'interface_bindings');

    const taken = await application(runner, tenantId, 'SQL Server');
    await runner.query(`INSERT INTO technologies (tenant_id, item_number, name) VALUES ($1, 1, 'sql server')`, [tenantId]);
    await refused(taken, 'name_taken');
  });
}

async function testFailureInTheMiddle() {
  for (const failure of ['delete', 'storage'] as const) {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, `conv-fail-${failure}`);
      const storage = memoryStorage();
      const svc = conversion([], storage, { failDelete: failure === 'delete' });
      const seeded = await seedLinkedApplication(runner, tenantId, storage);
      storage.state.failPut = failure === 'storage';
      const opts = { manager: runner.manager, tenantId };
      await assert.rejects(underSavepoint(runner, () => svc.convert(seeded.app, { family: 'hypervisor' }, opts)), failure === 'delete' ? /delete failed/ : /storage down/);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM technologies WHERE tenant_id = $1`, [tenantId]), 0, `${failure}: no technology`);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, seeded.app]), 1);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM application_attachments WHERE tenant_id = $1 AND application_id = $2`, [tenantId, seeded.app]), 1);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM application_owners WHERE tenant_id = $1 AND application_id = $2`, [tenantId, seeded.app]), 2);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM app_asset_assignments WHERE tenant_id = $1`, [tenantId]), 4);
      assert.deepEqual([...storage.objects.keys()], [seeded.original], `${failure}: the original intact, no copy left`);
    });
  }
}

async function testRights() {
  const meta = (name: 'preview' | 'convert') => Reflect.getMetadata(REQUIRE_LEVEL_KEY, ApplicationConversionController.prototype[name]);
  assert.deepEqual(meta('preview'), { resource: 'applications', level: 'admin' });
  assert.deepEqual(meta('convert'), { resource: 'applications', level: 'admin' });
  const calls: string[] = [];
  const stub = { preview: async () => { calls.push('preview'); return {}; } };
  const controller = new ApplicationConversionController(stub as any);
  const ctx = (permissions: Record<string, string>) => ({ tenantId: randomUUID(), userId: null, isAdmin: false, permissions, manager: dataSource.manager } as any);
  await assert.rejects(controller.preview(randomUUID(), ctx({ applications: 'admin', infrastructure: 'contributor' })), ForbiddenException);
  await controller.preview(randomUUID(), ctx({ applications: 'admin', infrastructure: 'member' }));
  assert.deepEqual(calls, ['preview']);
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const b = await seedTenant(runner, 'conv-iso-b');
    const appB = await application(runner, b, 'vSphere');
    const a = await seedTenant(runner, 'conv-iso-a');
    const svc = conversion([], memoryStorage());
    const opts = { manager: runner.manager, tenantId: a };
    await assert.rejects(svc.preview(appB, opts), NotFoundException);
    await assert.rejects(svc.convert(appB, { family: 'other' }, opts), NotFoundException);
    await setTenant(runner, b);
    assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2`, [b, appB]), 1);
  });
}

void runSpecs('application conversion', [
  ['preview and conversion of a linked application', testPreviewAndConvert],
  ['an application without servers becomes subscribed', testSubscribedWithoutServers],
  ['each refusal', testRefusals],
  ['a failure in the middle loses nothing', testFailureInTheMiddle],
  ['rights', testRights],
  ['tenant isolation', testTenantIsolation],
]);
