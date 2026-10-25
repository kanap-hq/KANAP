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
import { IncidentRelationsService } from '../../incidents/services/incident-relations.service';
import { DEFAULT_HOSTING_TYPES } from '../../it-ops-settings/it-ops-settings.service';
import { assert, inRolledBackTransaction, runSpecs, seedItem, seedTenant, setTenant, underSavepoint } from '../../spend/__tests__/round-inputs.fixtures';
import { ApplicationConversionController } from '../application-conversion.controller';
import { ApplicationConversionService } from '../application-conversion.service';
import { asset, assign, member, one, services, type AuditEntry } from './technologies.fixtures';

// Converting an application to a technology (lot C1) against a real database: the preview and the
// conversion of a fully linked application (its managed document released with its file), the
// counts a caller without the modules cannot read, each refusal, a failure in the middle (nothing
// lost, files intact), a server assignment written during the conversion, the rights of the routes
// and the tenant isolation.

/** An in-memory object store: what the conversion copies and deletes is visible. */
function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const state = { failPut: false, failGet: false, onGet: null as null | (() => Promise<void>) };
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
    async headObject(key: string) {
      return objects.has(key) ? { contentLength: objects.get(key)!.length } : null;
    },
    async getObjectStream(key: string) {
      if (state.onGet) await state.onGet();
      const body = objects.get(key);
      if (!body || state.failGet) throw new Error(`NoSuchKey ${key}`);
      return { stream: Readable.from([body]), contentType: 'text/plain', contentLength: body.length };
    },
    async deleteObject(key: string) {
      objects.delete(key);
    },
  };
  return storage;
}

type Storage = ReturnType<typeof memoryStorage>;

function conversion(audit: AuditEntry[], storage: Storage, opts: { failDelete?: boolean; manager?: any; hostingTypes?: Array<{ code: string; label: string; category?: string; deprecated?: boolean }> } = {}) {
  const { technologies } = services(audit);
  const auditLog = { log: async (entry: AuditEntry) => void audit.push(entry) };
  // The conversion keeps the managed documents: the delete must not reach them.
  const integrated = { deleteForEntity: async () => { throw new Error('managed documents must not be deleted'); } };
  const deleteSvc = new ApplicationsDeleteService(dataSource.getRepository(Application), auditLog as any, storage as any, integrated as any);
  if (opts.failDelete) deleteSvc.delete = async () => { throw new Error('delete failed'); };
  const itOps = {
    getSettings: async () => ({
      lifecycleStates: [{ code: 'active' }, { code: 'retired' }],
      cyberCriticalityLevels: [{ code: 'high' }],
      recoveryWaves: [{ code: 'wave_1' }],
      hostingTypes: opts.hostingTypes ?? DEFAULT_HOSTING_TYPES,
    }),
  };
  const incidents = new IncidentRelationsService(undefined as any, auditLog as any);
  return new ApplicationConversionService(technologies, deleteSvc, auditLog as any, storage as any, itOps as any, incidents);
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

/** A managed document (the overview slot) of the application, with an attached file. */
async function managedDocument(runner: QueryRunner, tenantId: string, appId: string, storage: Storage) {
  const library = await one(runner, `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Managed Docs', $2) RETURNING id`, [tenantId, `managed-${randomUUID().slice(0, 8)}`]);
  const document = await one(runner, `INSERT INTO documents (tenant_id, item_number, library_id, title) VALUES ($1, 1, $2, 'vSphere overview') RETURNING id`, [tenantId, library]);
  await runner.query(
    `INSERT INTO integrated_document_bindings (tenant_id, document_id, source_entity_type, source_entity_id, slot_key) VALUES ($1, $2, 'applications', $3, 'overview')`,
    [tenantId, document, appId]);
  const key = `files/${tenantId}/documents/${document}/diagram.png`;
  storage.objects.set(key, Buffer.from('diagram'));
  await runner.query(
    `INSERT INTO document_attachments (tenant_id, document_id, original_filename, stored_filename, storage_path, size) VALUES ($1, $2, 'diagram.png', 'diagram.png', $3, 7)`,
    [tenantId, document, key]);
  return { document, key };
}

/**
 * The application of the brief: owners, a contract, two budget lines of both natures, a project, a
 * link, a file, two incidents (one confidential), two instances on three servers, a disabled one
 * on a fourth, a managed document.
 */
async function seedLinkedApplication(runner: QueryRunner, tenantId: string, storage: Storage, foreignContact?: string) {
  const app = await application(runner, tenantId, 'vSphere', { reference: 'APP-7' });
  // Support: notes, a contact named twice (the first role is kept), one without a role, and a
  // contact of another tenant (a plain key lets the application name it; the technology cannot).
  await runner.query(`UPDATE applications SET support_notes = 'Call Broadcom first.' WHERE tenant_id = $1 AND id = $2`, [tenantId, app]);
  const anna = await one(runner, `INSERT INTO contacts (tenant_id, email, first_name) VALUES ($1, $2, 'Anna') RETURNING id`, [tenantId, `anna-${randomUUID()}@example.invalid`]);
  const bruno = await one(runner, `INSERT INTO contacts (tenant_id, email, first_name) VALUES ($1, $2, 'Bruno') RETURNING id`, [tenantId, `bruno-${randomUUID()}@example.invalid`]);
  await runner.query(
    `INSERT INTO application_support_contacts (tenant_id, application_id, contact_id, role, created_at)
     VALUES ($1, $2, $3, ' Editor support ', now() - interval '3 hours'), ($1, $2, $3, 'Escalation', now() - interval '2 hours'),
            ($1, $2, $4, '', now() - interval '1 hour')`,
    [tenantId, app, anna, bruno]);
  if (foreignContact) {
    await runner.query(`INSERT INTO application_support_contacts (tenant_id, application_id, contact_id, role) VALUES ($1, $2, $3, 'Foreign')`, [tenantId, app, foreignContact]);
  }
  const role = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Conv role') RETURNING id`, [tenantId]);
  const userA = await one(runner, `INSERT INTO users (tenant_id, email, role_id) VALUES ($1, $2, $3) RETURNING id`, [tenantId, `a-${randomUUID()}@example.invalid`, role]);
  const userB = await one(runner, `INSERT INTO users (tenant_id, email, role_id) VALUES ($1, $2, $3) RETURNING id`, [tenantId, `b-${randomUUID()}@example.invalid`, role]);
  await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'it'), ($1, $2, $4, 'business')`, [tenantId, app, userA, userB]);
  const company = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Co', 'FR', 'Lyon') RETURNING id`, [tenantId]);
  await runner.query(`INSERT INTO application_companies (tenant_id, application_id, company_id) VALUES ($1, $2, $3)`, [tenantId, app, company]);
  const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Broadcom') RETURNING id`, [tenantId]);
  const contract = await one(runner, `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'VCF', $2, $3, DATE '2026-01-01') RETURNING id`, [tenantId, company, supplier]);
  await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, app, contract]);
  const opex = await seedItem(runner, 'opex', tenantId, 1, 'vSphere licences');
  const capex = await seedItem(runner, 'capex', tenantId, 2, 'vSphere hosts');
  await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, app, opex, capex]);
  const project = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Upgrade', 1) RETURNING id`, [tenantId]);
  await runner.query(`INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $3)`, [tenantId, app, project]);
  await runner.query(`INSERT INTO application_links (tenant_id, application_id, description, url) VALUES ($1, $2, 'Console', 'https://vcenter.example'), ($1, $2, 'Runbook', '')`, [tenantId, app]);
  const original = `files/${tenantId}/applications/${app}/u1_design.txt`;
  storage.objects.set(original, Buffer.from('design'));
  await runner.query(
    `INSERT INTO application_attachments (tenant_id, application_id, original_filename, stored_filename, storage_path, size) VALUES ($1, $2, 'design.txt', 'u1_design.txt', $3, 6)`,
    [tenantId, app, original]);
  const incident = await one(runner,
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, status) VALUES ($1, 1, 'Outage', 'low', false, 'open') RETURNING id`, [tenantId]);
  const secret = await one(runner,
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, status) VALUES ($1, 2, 'Breach', 'low', true, 'closed') RETURNING id`, [tenantId]);
  await runner.query(`INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, incident, secret, app]);
  const servers = [await asset(runner, tenantId, 'ESX-01'), await asset(runner, tenantId, 'ESX-02'), await asset(runner, tenantId, 'ESX-03')];
  await assign(runner, tenantId, app, servers[0], 'prod');
  await assign(runner, tenantId, app, servers[1], 'prod');
  await assign(runner, tenantId, app, servers[2], 'test');
  await assign(runner, tenantId, app, servers[0], 'test');
  const retiredServer = await asset(runner, tenantId, 'ESX-OLD');
  await assign(runner, tenantId, app, retiredServer, 'dev');
  await runner.query(`UPDATE app_instances SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND application_id = $2 AND environment = 'dev'`, [tenantId, app]);
  // Lost with it: a suite membership, a predecessor, a successor, a residency.
  const suite = await application(runner, tenantId, 'Suite');
  await runner.query(`INSERT INTO application_suites (tenant_id, application_id, suite_id) VALUES ($1, $2, $3)`, [tenantId, app, suite]);
  const predecessor = await application(runner, tenantId, 'ESX classic');
  await runner.query(`UPDATE applications SET predecessor_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, app, predecessor]);
  const successor = await application(runner, tenantId, 'VCF');
  await runner.query(`UPDATE applications SET predecessor_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, successor, app]);
  await runner.query(`INSERT INTO application_data_residency (tenant_id, application_id, country_iso) VALUES ($1, $2, 'FR')`, [tenantId, app]);
  const managed = await managedDocument(runner, tenantId, app, storage);
  return { app, contacts: { anna, bruno }, users: [userA, userB], contract, lines: [opex, capex], project, incidents: [incident, secret], servers, retiredServer, original, successor, managed };
}

const count = async (runner: QueryRunner, sql: string, params: unknown[]) => Number((await runner.query(sql, params))[0].n);

async function testPreviewAndConvert() {
  await inRolledBackTransaction(async (runner) => {
    const other = await seedTenant(runner, 'conv-full-other');
    const foreign = await one(runner, `INSERT INTO contacts (tenant_id, email, first_name) VALUES ($1, $2, 'Olga') RETURNING id`, [other, `olga-${randomUUID()}@example.invalid`]);
    const tenantId = await seedTenant(runner, 'conv-full');
    const storage = memoryStorage();
    const audit: AuditEntry[] = [];
    const svc = conversion(audit, storage);
    const seeded = await seedLinkedApplication(runner, tenantId, storage, foreign);
    const opts = { manager: runner.manager, tenantId, userId: null };

    const preview = await svc.preview(seeded.app, opts);
    assert.deepEqual(preview.refusals, []);
    assert.equal(preview.hosting_type, 'on_prem');
    assert.deepEqual(preview.application, { id: seeded.app, name: 'vSphere', reference: 'APP-7' });
    assert.deepEqual(preview.moves, { owners: 2, support_contacts: 2, contracts: 1, budget_lines: 2, projects: 1, links: 1, attachments: 1, incidents: 2, servers: 3 });
    assert.deepEqual(preview.unlinked, { managed_documents: 1 });
    assert.deepEqual(
      { ...preview.losses },
      { instances: 3, disabled_instance_servers: 1, suites: 1, predecessor: 1, successors: 1, data_residency: 1, audience: 1,
        links_without_url: 1, knowledge_links: 0, tasks: 0, requests: 0, business_processes: 0, technologies: 0 },
    );

    const { technology, files } = await svc.convert(seeded.app, { family: 'hypervisor' }, opts);
    const [tech] = await runner.query(`SELECT * FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, technology.id]);
    assert.equal(tech.name, 'vSphere');
    assert.equal(tech.editor, 'VMware');
    assert.equal(tech.family, 'hypervisor');
    assert.equal(tech.hosting_type, 'on_prem');
    assert.equal(tech.vulnerability_alerts, true, 'a technology on premises starts in the vulnerability alerts');
    assert.equal(tech.description, 'Virtualisation platform');
    assert.deepEqual([tech.rto_minutes, tech.rpo_minutes], [240, 60]);
    assert.equal(tech.support_notes, 'Call Broadcom first.');
    const support = await runner.query(
      `SELECT contact_id, role FROM technology_support_contacts WHERE tenant_id = $1 AND technology_id = $2 ORDER BY created_at, id`, [tenantId, technology.id]);
    assert.deepEqual(support, [{ contact_id: seeded.contacts.anna, role: 'Editor support' }, { contact_id: seeded.contacts.bruno, role: null }],
      'each contact once, the first role kept, in their order; the other tenant\'s contact left out');
    assert.equal(technology.reference, `TEC-${tech.item_number}`);
    const of = (table: string, column: string) => runner.query(`SELECT ${column} AS v FROM ${table} WHERE tenant_id = $1 AND technology_id = $2 ORDER BY 1`, [tenantId, technology.id]).then((rows: any[]) => rows.map((r) => r.v));
    assert.deepEqual(await of('technology_owners', 'user_id'), [...seeded.users].sort());
    assert.deepEqual(await of('technology_contracts', 'contract_id'), [seeded.contract]);
    assert.deepEqual(await of('technology_spend_items', 'spend_item_id'), [...seeded.lines].sort(), 'both natures');
    assert.deepEqual(await of('technology_projects', 'project_id'), [seeded.project]);
    assert.deepEqual(await of('technology_links', 'url'), ['https://vcenter.example']);
    assert.deepEqual(await of('incident_technologies', 'incident_id'), [...seeded.incidents].sort());
    const journal = await runner.query(
      `SELECT incident_id, content FROM incident_entries WHERE tenant_id = $1 AND kind = 'link_change' ORDER BY incident_id`, [tenantId]);
    assert.deepEqual(journal.map((row: any) => row.incident_id), [...seeded.incidents].sort(), 'one journal entry per incident');
    assert.equal(journal[0].content, `Application APP-7 vSphere converted to technology ${technology.reference} vSphere.`);
    const servers = await runner.query(
      `SELECT asset_id, technology_version_id, source, notes FROM asset_technologies WHERE tenant_id = $1 AND technology_id = $2 ORDER BY asset_id`, [tenantId, technology.id]);
    assert.deepEqual(servers.map((s: any) => s.asset_id), [...seeded.servers].sort(), 'three servers, once each; not the disabled instance\'s');
    assert.ok(servers.every((s: any) => s.technology_version_id === null && s.source === 'manual' && s.notes === 'Converted from APP-7'));
    const [file] = await runner.query(`SELECT storage_path, original_filename FROM technology_attachments WHERE tenant_id = $1 AND technology_id = $2`, [tenantId, technology.id]);
    assert.equal(file.storage_path, `files/${tenantId}/technologies/${technology.id}/u1_design.txt`);
    assert.equal(file.original_filename, 'design.txt');
    assert.equal(storage.objects.get(file.storage_path)?.toString(), 'design', 'copied before the commit');
    assert.ok(storage.objects.has(seeded.original), 'the original stays until the commit');

    // The managed document stays, released unfiled, with its file.
    const [doc] = await runner.query(`SELECT id, folder_id FROM documents WHERE tenant_id = $1 AND id = $2`, [tenantId, seeded.managed.document]);
    assert.ok(doc, 'the managed document is kept');
    assert.equal(doc.folder_id, null);
    assert.equal(await count(runner, `SELECT count(*) AS n FROM integrated_document_bindings WHERE tenant_id = $1 AND document_id = $2`, [tenantId, seeded.managed.document]), 0, 'unbound');
    assert.equal(await count(runner, `SELECT count(*) AS n FROM document_attachments WHERE tenant_id = $1 AND document_id = $2`, [tenantId, seeded.managed.document]), 1);
    assert.equal(storage.objects.get(seeded.managed.key)?.toString(), 'diagram', 'its file is untouched');

    assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, seeded.app]), 0, 'the application is gone');
    assert.equal(await count(runner, `SELECT count(*) AS n FROM app_instances WHERE tenant_id = $1 AND application_id = $2`, [tenantId, seeded.app]), 0);
    assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2 AND predecessor_id IS NULL`, [tenantId, seeded.successor]), 1, 'the successor stays');
    const tables = audit.map((entry) => `${entry.table}:${entry.action}`);
    assert.ok(tables.includes('technologies:create') && tables.includes('technologies:update') && tables.includes('applications:update') && tables.includes('applications:delete'));
    const trace = audit.find((entry) => entry.table === 'technologies' && entry.action === 'update') as any;
    assert.equal(trace.after.converted_from_application.reference, 'APP-7', 'the old reference stays readable');
    assert.deepEqual(trace.after.moved, { owners: 2, support_contacts: 2, contracts: 1, budget_lines: 2, projects: 1, links: 1, attachments: 1, incidents: 2, servers: 3, managed_documents: 1 });

    await svc.settleFiles(files, true);
    assert.ok(!storage.objects.has(seeded.original), 'the original goes after the commit');
    assert.ok(storage.objects.has(file.storage_path));
  });
}

/** A caller without contracts, budget, projects or incidents reads `null`; a confidential incident is not counted. */
async function testPreviewReadAccess() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-access');
    const storage = memoryStorage();
    const svc = conversion([], storage);
    const seeded = await seedLinkedApplication(runner, tenantId, storage);
    const base = { manager: runner.manager, tenantId };
    const none = await svc.preview(seeded.app, { ...base, access: { contracts: false, budget_lines: false, projects: false, incidents: false } });
    assert.deepEqual([none.moves.contracts, none.moves.budget_lines, none.moves.projects, none.moves.incidents], [null, null, null, null]);
    assert.equal(none.moves.owners, 2);
    const all = { contracts: true, budget_lines: true, projects: true, incidents: true };
    const reader = await svc.preview(seeded.app, { ...base, access: all, incidentViewer: { userId: randomUUID(), isAdmin: false } });
    assert.equal(reader.moves.incidents, 1, 'the confidential incident is not counted');
    const admin = await svc.preview(seeded.app, { ...base, access: all, incidentViewer: { userId: null, isAdmin: true } });
    assert.equal(admin.moves.incidents, 2);
  });
}

async function testSubscribedWithoutServers() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-saas');
    const svc = conversion([], memoryStorage());
    const app = await application(runner, tenantId, 'Entra ID');
    const opts = { manager: runner.manager, tenantId };
    assert.equal((await svc.preview(app, opts)).hosting_type, 'saas');
    await assert.rejects(svc.convert(app, {}, opts), /Family is required/);
    const { technology } = await svc.convert(app, { family: 'directory' }, opts);
    const [row] = await runner.query(`SELECT hosting_type, vulnerability_alerts FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, technology.id]);
    assert.equal(row.hosting_type, 'saas');
    assert.equal(row.vulnerability_alerts, false, 'a cloud service starts out of the vulnerability alerts');
  });
}

/**
 * The hosting type (lot H1). With servers: the type of their sites (most servers first), else on
 * premises; the application's hosting model (deprecated) never overrides them. Without servers:
 * the hosting model (`on_premise` is `on_prem`), else SaaS. A code the tenant's catalog lacks is skipped.
 */
async function testHostingType() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-hosting');
    const svc = conversion([], memoryStorage());
    const opts = { manager: runner.manager, tenantId };
    const typeOf = async (appId: string, service = svc) => (await service.preview(appId, opts)).hosting_type;
    const withModel = async (name: string, model: string | null) => {
      const id = await application(runner, tenantId, name);
      await runner.query(`UPDATE applications SET hosting_model = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, model]);
      return id;
    };
    const site = async (name: string, type: string) => one(runner,
      `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, $2, $3, $2) RETURNING id`, [tenantId, name, type]);
    const server = async (name: string, location: string) => {
      const id = await asset(runner, tenantId, name);
      await runner.query(`UPDATE assets SET location_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, location]);
      return id;
    };
    const colo = await site('Colo', 'colocation');
    const cloud = await site('Cloud', 'public_cloud');

    assert.equal(await typeOf(await withModel('Model on premise', 'on_premise')), 'on_prem');
    const publicCloud = await withModel('Model public cloud', 'public_cloud');
    assert.equal(await typeOf(publicCloud), 'public_cloud');
    assert.equal(await typeOf(await withModel('Model private cloud', 'private_cloud')), 'private_cloud');
    assert.equal(await typeOf(await withModel('Model SaaS', 'saas')), 'saas');

    // With servers: the sites of its servers, the most servers first.
    const sited = await withModel('Sited', null);
    await assign(runner, tenantId, sited, await server('colo-1', colo));
    await assign(runner, tenantId, sited, await server('colo-2', colo));
    await assign(runner, tenantId, sited, await server('cloud-1', cloud), 'dev');
    assert.equal(await typeOf(sited), 'colocation');
    // A SaaS application (old hosting model) with servers on a site on premises: the servers win.
    const saasOnSite = await withModel('SaaS on site', 'saas');
    const premises = await site('Premises', 'on_prem');
    await assign(runner, tenantId, saasOnSite, await server('prem-1', premises));
    assert.equal(await typeOf(saasOnSite), 'on_prem');
    const saasPreview = await svc.preview(saasOnSite, opts);
    assert.equal(saasPreview.moves.servers, 1, 'the preview says it has servers');

    // Servers without a site are on premises, whatever the model; no server and no model is SaaS.
    const bare = await withModel('Bare', 'public_cloud');
    await assign(runner, tenantId, bare, await asset(runner, tenantId, 'no-site'));
    assert.equal(await typeOf(bare), 'on_prem');
    assert.equal(await typeOf(await withModel('Nothing', null)), 'saas');

    // A model or a site type the tenant's catalog lacks is skipped; the rule falls back on its own types.
    const custom = conversion([], memoryStorage(), { hostingTypes: [
      { code: 'datacenter', label: 'Datacenter', category: 'on_prem' },
      { code: 'azure', label: 'Azure', category: 'cloud' },
    ] });
    assert.equal(await typeOf(await withModel('Unknown model', 'saas'), custom), 'azure');
    assert.equal(await typeOf(sited, custom), 'datacenter');

    // A retired type is never given: on premises retired, colocation in use.
    const retiredOnPrem = conversion([], memoryStorage(), { hostingTypes: [
      { code: 'on_prem', label: 'On-prem', category: 'on_prem', deprecated: true },
      { code: 'colocation', label: 'Colocation', category: 'on_prem' },
    ] });
    assert.equal(await typeOf(bare, retiredOnPrem), 'colocation');
    // No type in use at all: the preview refuses, and so does the conversion.
    const empty = conversion([], memoryStorage(), { hostingTypes: [] });
    const refused = await empty.preview(bare, opts);
    assert.deepEqual(refused.refusals.find((r) => r.reason === 'invalid_fields')?.fields, ['hosting_type']);
    await assert.rejects(empty.convert(bare, { family: 'other' }, opts), ConflictException);

    // The technology is created with it.
    const { technology } = await svc.convert(publicCloud, { family: 'other' }, opts);
    const [row] = await runner.query(`SELECT hosting_type FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, technology.id]);
    assert.equal(row.hosting_type, 'public_cloud');
  });
}

/**
 * An application on a cluster (clusters pass, PR B): the technology goes on the cluster's members
 * in service and on a direct server, never on the cluster, which counts as no server. The preview
 * counts the same set and takes the hosting type from their sites; a disabled deployment on the
 * same cluster loses no server.
 */
async function testOnCluster() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-cluster');
    const svc = conversion([], memoryStorage());
    const opts = { manager: runner.manager, tenantId };
    const cloud = await one(runner,
      `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Cloud', 'public_cloud', 'Cloud') RETURNING id`, [tenantId]);
    const cluster = await asset(runner, tenantId, 'SQL-CL', true);
    const node1 = await asset(runner, tenantId, 'SQL-01');
    const node2 = await asset(runner, tenantId, 'SQL-02');
    const retired = await asset(runner, tenantId, 'SQL-OLD');
    const direct = await asset(runner, tenantId, 'SQL-03');
    for (const node of [node1, node2, retired]) await member(runner, tenantId, cluster, node);
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [tenantId, retired]);
    // The cluster has no site; its members are in the cloud, the direct server nowhere.
    await runner.query(`UPDATE assets SET location_id = $2 WHERE tenant_id = $1 AND id = ANY($3::uuid[])`, [tenantId, cloud, [node1, node2]]);
    const app = await application(runner, tenantId, 'SQL Server');
    await assign(runner, tenantId, app, cluster, 'prod');
    await assign(runner, tenantId, app, direct, 'prod');
    await assign(runner, tenantId, app, cluster, 'dev');
    await runner.query(`UPDATE app_instances SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND application_id = $2 AND environment = 'dev'`, [tenantId, app]);

    const preview = await svc.preview(app, opts);
    assert.equal(preview.moves.servers, 3, 'both members in service and the direct server');
    assert.equal(preview.losses.disabled_instance_servers, 0, 'the disabled deployment\'s servers are installed anyway');
    assert.equal(preview.hosting_type, 'public_cloud', 'the sites of the members');

    const { technology } = await svc.convert(app, { family: 'database' }, opts);
    const rows = await runner.query(`SELECT asset_id FROM asset_technologies WHERE tenant_id = $1 AND technology_id = $2 ORDER BY asset_id`, [tenantId, technology.id]);
    assert.deepEqual(rows.map((r: any) => r.asset_id), [node1, node2, direct].sort());
    const [row] = await runner.query(`SELECT hosting_type FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, technology.id]);
    assert.equal(row.hosting_type, 'public_cloud');
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-refuse');
    const storage = memoryStorage();
    const svc = conversion([], storage);
    const opts = { manager: runner.manager, tenantId };
    const x = await application(runner, tenantId, 'ERP');
    const y = await application(runner, tenantId, 'CRM');
    const xi = await instance(runner, tenantId, x);
    const yi = await instance(runner, tenantId, y);
    const between = await iface(runner, tenantId, x, y, 'INT-1');

    const refused = async (app: string, reason: string) => {
      const preview = await svc.preview(app, opts);
      assert.deepEqual(preview.refusals.map((r) => r.reason), [reason], reason);
      await assert.rejects(svc.convert(app, { family: 'other' }, opts), (err: any) =>
        err instanceof ConflictException && (err.getResponse() as any).refusals?.[0]?.reason === reason);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, app]), 1);
      return preview.refusals[0];
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

    // The name compared trimmed and without case.
    const taken = await application(runner, tenantId, 'Citrix  ');
    await runner.query(`INSERT INTO technologies (tenant_id, item_number, name) VALUES ($1, 1, 'citrix')`, [tenantId]);
    await refused(taken, 'name_taken');

    const invalid = await application(runner, tenantId, 'x'.repeat(220));
    await runner.query(`UPDATE applications SET rto_minutes = 6000000, lifecycle = 'gone', cyber_criticality = 'unknown' WHERE tenant_id = $1 AND id = $2`, [tenantId, invalid]);
    const fields = await refused(invalid, 'invalid_fields');
    assert.deepEqual(fields.fields, ['name', 'lifecycle', 'cyber_criticality', 'rto_minutes']);

    // A role the technology cannot take (200 characters at most), on the role it would keep.
    const longRole = await application(runner, tenantId, 'Nutanix');
    const contact = await one(runner, `INSERT INTO contacts (tenant_id, email) VALUES ($1, $2) RETURNING id`, [tenantId, `c-${randomUUID()}@example.invalid`]);
    await runner.query(`INSERT INTO application_support_contacts (tenant_id, application_id, contact_id, role) VALUES ($1, $2, $3, $4)`, [tenantId, longRole, contact, 'r'.repeat(250)]);
    assert.deepEqual((await refused(longRole, 'invalid_fields')).fields, ['support_contact_roles']);

    const missing = await application(runner, tenantId, 'Veeam');
    await runner.query(
      `INSERT INTO application_attachments (tenant_id, application_id, original_filename, stored_filename, storage_path, size) VALUES ($1, $2, 'gone.pdf', 'u_gone.pdf', 'files/nowhere/u_gone.pdf', 1)`,
      [tenantId, missing]);
    const files = await refused(missing, 'missing_files');
    assert.deepEqual(files.files, ['gone.pdf']);
  });
}

/** A file present at the preview and unreadable at the copy: a 409 that names it, nothing lost. */
async function testMissingFileAtCopy() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'conv-nofile');
    const storage = memoryStorage();
    const svc = conversion([], storage);
    const seeded = await seedLinkedApplication(runner, tenantId, storage);
    storage.state.failGet = true;
    await assert.rejects(
      underSavepoint(runner, () => svc.convert(seeded.app, { family: 'hypervisor' }, { manager: runner.manager, tenantId })),
      (err: any) => err instanceof ConflictException && (err.getResponse() as any).code === 'APPLICATION_CONVERSION_MISSING_FILE'
        && (err.getResponse() as any).params?.file === 'design.txt',
    );
    assert.equal(await count(runner, `SELECT count(*) AS n FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, seeded.app]), 1);
    assert.equal(await count(runner, `SELECT count(*) AS n FROM technologies WHERE tenant_id = $1`, [tenantId]), 0);
    assert.ok(storage.objects.has(seeded.original));
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
      assert.equal(await count(runner, `SELECT count(*) AS n FROM app_asset_assignments WHERE tenant_id = $1`, [tenantId]), 5);
      assert.equal(await count(runner, `SELECT count(*) AS n FROM integrated_document_bindings WHERE tenant_id = $1 AND source_entity_id = $2`, [tenantId, seeded.app]), 1, 'the managed document stays bound');
      assert.equal(await count(runner, `SELECT count(*) AS n FROM incident_entries WHERE tenant_id = $1`, [tenantId]), 0);
      assert.deepEqual([...storage.objects.keys()].sort(), [seeded.original, seeded.managed.key].sort(), `${failure}: the files intact, no copy left`);
    });
  }
}

/**
 * C8 of the review: a server assigned to an instance while the conversion runs, on another
 * connection. It waits for the conversion's instance lock, then fails on its key: never lost unseen.
 */
async function testAssignmentDuringConversion() {
  const setup = dataSource.createQueryRunner();
  const converter = dataSource.createQueryRunner();
  const writer = dataSource.createQueryRunner();
  for (const runner of [setup, converter, writer]) await runner.connect();
  let tenantId = '';
  try {
    await setup.startTransaction();
    tenantId = await seedTenant(setup, 'conv-race');
    const app = await application(setup, tenantId, 'vSphere');
    const inst = await instance(setup, tenantId, app);
    const server = await asset(setup, tenantId, 'ESX-NEW');
    await setup.query(
      `INSERT INTO application_attachments (tenant_id, application_id, original_filename, stored_filename, storage_path, size) VALUES ($1, $2, 'a.txt', 'u_a.txt', 'k/a', 1)`,
      [tenantId, app]);
    await setup.commitTransaction();

    const storage = memoryStorage();
    storage.objects.set('k/a', Buffer.from('a'));
    let write: Promise<unknown> | null = null;
    let settled = false;
    storage.state.onGet = async () => {
      storage.state.onGet = null;
      await writer.startTransaction();
      await setTenant(writer, tenantId);
      await writer.query(`SET LOCAL lock_timeout = '10s'`);
      write = writer.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`, [tenantId, inst, server])
        .finally(() => { settled = true; });
      write.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(settled, false, 'the assignment waits for the conversion');
    };
    await converter.startTransaction();
    await setTenant(converter, tenantId);
    await conversion([], storage).convert(app, { family: 'hypervisor' }, { manager: converter.manager, tenantId });
    await converter.commitTransaction();
    await assert.rejects(write!, (err: any) => err?.code === '23503', 'the assignment fails on its key');
    await writer.rollbackTransaction();
  } finally {
    for (const runner of [converter, writer]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    }
    if (tenantId) {
      await setup.startTransaction();
      await setTenant(setup, tenantId);
      for (const table of ['technology_attachments', 'audit_log', 'technologies', 'app_asset_assignments', 'app_instances', 'applications', 'assets']) {
        await setup.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
      await setup.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      await setup.commitTransaction();
    }
    for (const runner of [setup, converter, writer]) await runner.release();
  }
}

async function testRights() {
  const meta = (name: 'preview' | 'convert') => Reflect.getMetadata(REQUIRE_LEVEL_KEY, ApplicationConversionController.prototype[name]);
  assert.deepEqual(meta('preview'), { resource: 'applications', level: 'admin' });
  assert.deepEqual(meta('convert'), { resource: 'applications', level: 'admin' });
  const calls: any[] = [];
  const stub = { preview: async (_id: string, opts: any) => { calls.push(opts); return {}; } };
  const controller = new ApplicationConversionController(stub as any);
  const ctx = (permissions: Record<string, string>) => ({ tenantId: randomUUID(), userId: null, isAdmin: false, permissions, manager: dataSource.manager } as any);
  await assert.rejects(controller.preview(randomUUID(), ctx({ applications: 'admin', infrastructure: 'contributor' })), ForbiddenException);
  await controller.preview(randomUUID(), ctx({ applications: 'admin', infrastructure: 'member', contracts: 'reader' }));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].access, { contracts: true, budget_lines: false, projects: false, incidents: false });
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
  ['the preview hides what the caller cannot read', testPreviewReadAccess],
  ['an application without servers becomes SaaS', testSubscribedWithoutServers],
  ['hosting type from the model, the sites, then the servers', testHostingType],
  ['an application on a cluster installs on its members', testOnCluster],
  ['each refusal', testRefusals],
  ['a file missing at the copy', testMissingFileAtCopy],
  ['a failure in the middle loses nothing', testFailureInTheMiddle],
  ['a server assigned during the conversion is not lost unseen', testAssignmentDuringConversion],
  ['rights', testRights],
  ['tenant isolation', testTenantIsolation],
]);
