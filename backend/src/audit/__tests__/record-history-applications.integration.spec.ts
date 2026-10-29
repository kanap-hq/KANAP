// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { writeAuditLog } from '../audit.service';
import { TechnologyLinksService } from '../../technologies/technology-links.service';
import { TechnologyReachService } from '../../technologies/technology-reach.service';
import {
  RecordHistoryService,
  type RecordHistoryChange,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from '../record-history.service';
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Level, type Person } from './record-history.fixtures';

// The application history (lot 2, linked records) on the migrated database: its own rows, every
// child kind written through the real writer (so the parent rules fill `parent_*`, the deployment
// rule included), the three read modes, the references named only for a reader of their module,
// the technology link written as one row per application by the real link service, and the
// access rules (403 without the applications module, 404 for an unknown, foreign or out-of-scope
// application: a Business Contributor reads only the applications they own).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const APP_MODULES: Record<string, Level> = { applications: 'reader' };
const ALL_MODULES: Record<string, Level> = {
  applications: 'reader', infrastructure: 'reader', budget: 'reader', contracts: 'reader', portfolio_projects: 'reader',
  companies: 'reader', suppliers: 'reader', contacts: 'reader', business_processes: 'reader',
};

type Seeded = {
  data: HistorySeed;
  instance: string;
  assignment: string;
  owned: string;
  appReader: Person;
  allReader: Person;
  noModules: Person;
  contributor: Person;
};

async function withRunner<T>(tenantId: string, fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return await fn(runner);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

async function readPage(person: Person, tenantId: string, table: string, id: string, permissions: Record<string, Level>): Promise<RecordHistoryPage> {
  return withRunner(tenantId, (runner) => {
    const ctx: RecordHistoryContext = { tenantId, userId: person.id, isAdmin: false, permissions, manager: runner.manager };
    return new RecordHistoryService().list(ctx, table, id);
  });
}

function findChange(page: RecordHistoryPage, field: string, event?: 'added' | 'removed'): { item: RecordHistoryItem; change: RecordHistoryChange } | null {
  for (const item of page.items) {
    for (const change of item.changes) {
      if (change.field === field && (event === undefined || change.event === event)) return { item, change };
    }
  }
  return null;
}

function named(value: unknown, kind: string): boolean {
  const ref = value as any;
  return !!ref && ref.kind === kind && typeof ref.label === 'string' && ref.label.length > 0 && !ref.hidden;
}

function hidden(value: unknown, kind: string): boolean {
  const ref = value as any;
  return !!ref && ref.hidden === true && ref.kind === kind && !ref.deleted;
}

function links(): TechnologyLinksService {
  const writer = { log: (entry: any, opts: { manager: any }) => writeAuditLog(opts.manager, entry) };
  return new TechnologyLinksService(writer as any, new TechnologyReachService(), {} as any);
}

async function seedFamily(runner: QueryRunner, data: HistorySeed): Promise<Seeded> {
  const t = data.tenantId;
  const appReader = await seedPerson(runner, t, { first: 'App', last: 'Reader' }, APP_MODULES);
  const allReader = await seedPerson(runner, t, { first: 'All', last: 'Reader' }, ALL_MODULES);
  const noModules = await seedPerson(runner, t, { first: 'No', last: 'Modules' }, { tasks: 'reader' });
  const contributor = await seedPerson(runner, t, { first: 'Bea', last: 'Contributor' }, APP_MODULES, { exactRoleName: 'Business Contributor' });
  const owned = (await runner.query(
    `INSERT INTO applications (tenant_id, name, sequential_id) VALUES ($1, 'Owned App', 'APP-77') RETURNING id`, [t],
  ))[0].id as string;
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [t, owned, contributor.id],
  );
  const instance = (await runner.query(
    `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`,
    [t, data.application],
  ))[0].id as string;
  const app = data.application;
  const userId = data.owner;
  const write = (entry: Parameters<typeof audit>[1]) => audit(runner, entry);

  await write({ table: 'applications', recordId: app, action: 'create', userId, before: null, after: { id: app, tenant_id: t, name: 'Ledger App', lifecycle: 'active', sequential_id: 'APP-42', owners: [] } });
  await write({
    table: 'applications', recordId: app, action: 'update', userId,
    before: {
      name: 'Ledger App', criticality: 'medium', supplier_id: null, classification_review: null,
      description: '# Old overview', notes: 'Old app notes', support_notes: 'Old support notes',
    },
    after: {
      name: 'Ledger Platform', criticality: 'high', supplier_id: data.supplier, classification_review: { user_id: userId, reviewed_at: '2026-10-29T10:00:00Z', revision: 3 },
      description: '# New overview', notes: 'New app notes', support_notes: 'New support notes',
    },
  });
  await write({ table: 'app_instances', recordId: instance, action: 'create', userId, before: null, after: { id: instance, application_id: app, environment: 'prod' } });
  await write({ table: 'app_instances', recordId: instance, action: 'update', userId, before: { application_id: app, environment: 'prod', base_url: null }, after: { application_id: app, environment: 'prod', base_url: 'https://ledger.example.invalid' } });
  const assignment = randomUUID();
  await write({ table: 'app_asset_assignments', recordId: assignment, action: 'create', userId, before: null, after: { id: assignment, app_instance_id: instance, asset_id: data.asset, role: 'db' } });
  await write({ table: 'application_owners', recordId: app, action: 'update', userId, before: [], after: [`business:${data.owner}`] });
  await write({ table: 'application_companies', recordId: app, action: 'update', userId, before: [], after: [data.companyA] });
  await write({ table: 'application_departments', recordId: app, action: 'update', userId, before: [], after: [data.department] });
  await write({ table: 'application_data_residency', recordId: app, action: 'update', userId, before: [], after: ['FR'] });
  await write({ table: 'application_support_contacts', recordId: app, action: 'update', userId, before: [], after: [`${data.contact}:vendor`] });
  await write({ table: 'application_spend_items', recordId: app, action: 'update', userId, before: [], after: [data.opexLine] });
  await write({ table: 'application_contracts', recordId: app, action: 'update', userId, before: [], after: [data.contractA] });
  await write({ table: 'application_projects', recordId: app, action: 'update', userId, before: [], after: [data.project] });
  await write({ table: 'application_links', recordId: randomUUID(), action: 'create', userId, before: null, after: { application_id: app, url: 'https://docs.example.invalid', description: 'Runbook' } });
  await write({ table: 'application_attachments', recordId: randomUUID(), action: 'create', userId, before: null, after: { application_id: app, original_filename: 'design.pdf' } });
  await write({ table: 'application_business_processes', recordId: data.businessProcess, action: 'update', userId, before: null, after: { application_id: app } });

  // The assistant writes a link set as relation items (`{ key, label, payload }`): on the owned
  // application, a project read by its payload id; the stored label never comes out.
  await write({
    table: 'application_projects', recordId: owned, action: 'update', userId,
    before: [], after: [{ key: 'project', label: 'Writer label', payload: { project_id: data.project } }],
  });

  // The technology link through the real writer: one audit row per application, on both sides.
  const service = links();
  const opts = { manager: runner.manager, tenantId: t, userId };
  await service.addApplications(data.technology, [app, owned], opts, {});
  await service.removeApplication(data.technology, app, opts, {});
  return { data, instance, assignment, owned, appReader, allReader, noModules, contributor };
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  const page = await readPage(seeded.appReader, data.tenantId, 'applications', data.application, APP_MODULES);
  assert.ok(page.items.length > 0, 'an applications reader reads the history');
  await assert.rejects(
    () => readPage(seeded.noModules, data.tenantId, 'applications', data.application, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'no applications module gets 403 MODULE_RIGHT_REQUIRED',
  );
  for (const [what, id] of [['a missing application', randomUUID()], ['another tenant\'s application', foreign.application]] as const) {
    await assert.rejects(
      () => readPage(seeded.allReader, data.tenantId, 'applications', id, ALL_MODULES),
      (error: any) => error?.status === 404,
      `${what} gets 404`,
    );
  }
  // A Business Contributor reads only the applications they own, as the page does.
  await assert.rejects(
    () => readPage(seeded.contributor, data.tenantId, 'applications', data.application, APP_MODULES),
    (error: any) => error?.status === 404,
    'a Business Contributor who does not own the application gets 404',
  );
  const owned = await readPage(seeded.contributor, data.tenantId, 'applications', seeded.owned, APP_MODULES);
  assert.ok(findChange(owned, 'technology', 'added'), 'the owner reads the application they own');
  console.log('  200 with applications, 403 without, 404 for missing, foreign and non-owned applications: OK');
  const assistant = await readPage(seeded.allReader, data.tenantId, 'applications', seeded.owned, ALL_MODULES);
  assert.ok(named(findChange(assistant, 'project', 'added')?.change.after, 'project'), 'the project the assistant linked is named');
  assert.ok(!JSON.stringify(assistant).includes('Writer label'), 'the stored label never comes out');
  console.log('  a link set written by the assistant reads as its project: OK');
}

async function testEntries(seeded: Seeded) {
  const { data } = seeded;
  const all = await readPage(seeded.allReader, data.tenantId, 'applications', data.application, ALL_MODULES);
  const limited = await readPage(seeded.appReader, data.tenantId, 'applications', data.application, APP_MODULES);

  const created = all.items.find((item) => item.subject.kind === 'record' && item.action === 'create');
  assert.ok(created, 'the creation is an entry');
  assert.deepEqual(created.changes.find((change) => change.field === 'name'), { field: 'name', after: 'Ledger App' });
  assert.ok(!created.changes.some((change) => ['sequential_id', 'owners', 'id', 'tenant_id'].includes(change.field)), 'no reference snapshot or set copy');
  const renamed = findChange(all, 'name');
  assert.ok(renamed && renamed.item.action === 'update');
  assert.deepEqual(all.items.flatMap((item) => item.changes).find((change) => change.field === 'criticality'), { field: 'criticality', before: 'medium', after: 'high' });
  assert.deepEqual(findChange(all, 'classification_review')?.change, { field: 'classification_review', text: 'classificationReviewed' }, 'the review reads as a word');
  // Long content: the entry says that it changed, never its text.
  assert.deepEqual(findChange(all, 'description')?.change, { field: 'description', text: 'descriptionChanged' }, 'the description reads as a word');
  assert.deepEqual(findChange(all, 'notes')?.change, { field: 'notes', text: 'notesChanged' }, 'the notes read as a word');
  assert.deepEqual(findChange(all, 'support_notes')?.change, { field: 'support_notes', text: 'supportNotesChanged' }, 'the support notes read as a word');
  assert.ok(named(findChange(all, 'supplier_id')?.change.after, 'supplier'), 'the supplier is named for a supplier reader');
  assert.ok(hidden(findChange(limited, 'supplier_id')?.change.after, 'supplier'), 'and hidden otherwise');

  // The deployment and its server.
  assert.deepEqual(findChange(all, 'instance', 'added')?.change, { field: 'instance', event: 'added', after: 'prod' });
  const baseUrl = findChange(all, 'base_url');
  assert.equal(baseUrl?.item.subject.kind, 'instance');
  assert.equal(baseUrl?.item.subject.label, 'prod', 'a deployment update is titled by its environment');
  const server = findChange(all, 'assignment', 'added');
  assert.ok(server, 'the server assignment is an entry');
  assert.equal(server.item.subject.kind, 'assignment');
  assert.equal(server.item.subject.label, 'prod', 'the assignment is presented with its deployment');
  assert.ok(named(server.change.after, 'asset'), 'the asset is named for an infrastructure reader');
  assert.deepEqual(findChange(all, 'server_role')?.change, { field: 'server_role', after: 'db' });
  const hiddenServer = findChange(limited, 'assignment', 'added');
  assert.ok(hidden(hiddenServer?.change.after, 'asset'), 'the asset is hidden without infrastructure');
  assert.equal(hiddenServer?.item.subject.label, 'prod', 'the environment stays: the deployment is the application\'s own');

  // The sets named in record_id.
  assert.ok(findChange(all, 'owner_business', 'added'), 'an owner added');
  assert.ok(named(findChange(all, 'company', 'added')?.change.after, 'company'), 'a company added, named for a companies reader');
  assert.ok(hidden(findChange(limited, 'company', 'added')?.change.after, 'company'), 'and hidden otherwise');
  assert.ok(findChange(all, 'department', 'added'), 'a department added');
  assert.deepEqual(findChange(all, 'country', 'added')?.change, { field: 'country', event: 'added', after: 'FR' });
  assert.ok(named(findChange(all, 'contact', 'added')?.change.after, 'contact'), 'a support contact added');
  assert.ok(named(findChange(all, 'budget_line', 'added')?.change.after, 'budget_line'), 'the budget line is named for a budget reader');
  assert.ok(hidden(findChange(limited, 'budget_line', 'added')?.change.after, 'budget_line'), 'and hidden without the budget');
  assert.ok(named(findChange(all, 'contract', 'added')?.change.after, 'contract'), 'a contract added');
  assert.ok(named(findChange(all, 'project', 'added')?.change.after, 'project'), 'a project added');
  // The payload-carried children.
  assert.equal(findChange(all, 'link', 'added')?.item.subject.label, 'Runbook');
  assert.ok(findChange(all, 'attachment', 'added'), 'an attachment added');
  assert.ok(named(findChange(all, 'business_process', 'added')?.change.after, 'business_process'), 'a process link, read by the payload key');
  // The technology link, one row per application.
  assert.ok(named(findChange(all, 'technology', 'added')?.change.after, 'technology'), 'the technology added');
  assert.ok(named(findChange(all, 'technology', 'removed')?.change.before, 'technology'), 'the technology removed');
  assert.ok(hidden(findChange(limited, 'technology', 'added')?.change.after, 'technology'), 'hidden without infrastructure');

  const serialized = JSON.stringify(all);
  for (const raw of [seeded.instance, seeded.assignment, data.tenantId, 'APP-42', 'reviewed_at', 'overview', 'app notes', 'support notes']) {
    assert.ok(!serialized.includes(raw), `${raw} never reaches the answer`);
  }
  console.log('  own rows, deployments, servers, sets, links, processes and technologies in words, named by module: OK');
}

async function testTechnologySideAndParents(seeded: Seeded) {
  const { data } = seeded;
  const technology = await readPage(seeded.allReader, data.tenantId, 'technologies', data.technology, ALL_MODULES);
  const added = technology.items.filter((item) => item.changes.some((change) => change.field === 'application' && change.event === 'added'));
  assert.equal(added.length, 2, 'the technology history reads one addition per application');
  assert.ok(findChange(technology, 'application', 'removed'), 'and the removal');

  await withRunner(data.tenantId, async (runner) => {
    const rows: Array<{ table_name: string; parent_table: string | null; parent_id: string | null; before_json: any; after_json: any }> = await runner.query(
      `SELECT table_name, parent_table, parent_id, before_json, after_json FROM audit_log
        WHERE tenant_id = $1 AND table_name = ANY($2::text[])`,
      [data.tenantId, ['app_instances', 'app_asset_assignments', 'application_links', 'application_attachments', 'application_technologies']],
    );
    for (const row of rows.filter((candidate) => candidate.table_name !== 'application_technologies')) {
      assert.equal(row.parent_table, 'applications', `${row.table_name}: the parent table at write`);
      assert.equal(row.parent_id, data.application, `${row.table_name}: the application, through the deployment for an assignment`);
    }
    const technologyRows = rows.filter((row) => row.table_name === 'application_technologies');
    assert.equal(technologyRows.length, 3, 'two additions and one removal');
    for (const row of technologyRows) {
      const payload = row.after_json ?? row.before_json;
      assert.deepEqual(Object.keys(payload), ['application_id'], 'one application per row');
    }
  });
  console.log('  technology side unchanged, parents filled at write: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-applications');
  const foreignTenantId = await createRaceTenant('record-history-applications-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => seedFamily(runner, await seedHistoryData(runner, tenantId)));
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));
    await testAccess(seeded, foreign);
    await testEntries(seeded);
    await testTechnologySideAndParents(seeded);
    console.log('record-history-applications.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
