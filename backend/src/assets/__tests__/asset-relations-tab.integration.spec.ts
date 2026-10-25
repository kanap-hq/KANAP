// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { IncidentRelationsService } from '../../incidents/services/incident-relations.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  setTenant,
} from '../../spend/__tests__/round-inputs.fixtures';
import { AssetRelationsTabService } from '../asset-relations-tab.service';
import { AssetsController } from '../assets.controller';
import { AssetsRelationsService } from '../services/assets-relations.service';

// GET /assets/:id/relations-tab, POST /assets/:id/relations/:kind and
// DELETE /assets/:id/relations/:kind/:targetId (lot R2h), on an empty migrated database: the
// whole tab, the sections a caller cannot read, a Business Contributor's participation, one link
// at a time per kind with its audit, the rules of the relations between assets, the incident's
// own service, the badge, and another tenant.

type Ref = { id: string; reference: string };

type Seed = {
  tenantId: string;
  userId: string;
  contributorId: string;
  asset: Ref;
  peers: { rack: Ref; vm: Ref; db: Ref; app: Ref; free: Ref };
  lines: { opex: string; capex: string; freeOpex: string; freeCapex: string };
  contracts: { alpha: string; free: string };
  projects: { alpha: string; hidden: string; free: string };
  tasks: { open: string; done: string; hidden: string; free: string };
  incidents: { open: string; secret: string; closed: string; free: string };
};

const ALL = {
  infrastructure: 'reader',
  budget: 'reader',
  contracts: 'reader',
  portfolio_projects: 'reader',
  tasks: 'reader',
  incidents: 'reader',
};
const WRITE = { ...ALL, infrastructure: 'member', incidents: 'contributor' };
const NONE = { infrastructure: 'reader' };

type ActivityCall = { taskId: string; changes: Record<string, unknown>; userId: string | null };

function httpOf(audit = captureAudit()) {
  const activities: ActivityCall[] = [];
  const relations = new AssetsRelationsService(undefined as any, undefined as any, undefined as any, undefined as any, audit as any);
  // Identity rates: the amounts stay in EUR, the reporting currency of a tenant without settings.
  const fxRates = {
    resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
    convertValue: (amount: number, rate: number) => amount * rate,
  };
  // The task side is the real service: its id check and its activity entry are under test.
  const tasks = new TasksUnifiedService(
    undefined as any, audit as any, undefined as any, undefined as any, undefined as any, undefined as any,
    { logChange: async (taskId: string, changes: Record<string, unknown>, _tenant: string, userId: string | null) => void activities.push({ taskId, changes, userId }) } as any,
    undefined as any, undefined as any,
  );
  // The incident side is the real service: visibility, open state, row lock and journal.
  const incidents = new IncidentRelationsService(undefined as any, audit as any);
  const tab = new AssetRelationsTabService(relations, fxRates as any, tasks, incidents, audit as any);
  const http = new AssetsController(
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any,
    tab,
  );
  return { audit, activities, http };
}

function ctx(runner: QueryRunner, seed: Seed, permissions: Record<string, string>, userId: string = seed.userId, isAdmin = false) {
  return { tenantId: seed.tenantId, userId, userRoles: [], isAdmin, permissions, manager: runner.manager } as any;
}

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function ids(runner: QueryRunner, sql: string, params: unknown[]): Promise<string[]> {
  const rows: Array<{ id: string }> = await runner.query(sql, params);
  return rows.map((row) => row.id).sort();
}

async function relationRows(runner: QueryRunner, seed: Seed): Promise<string[]> {
  const rows: Array<{ asset_id: string; related_asset_id: string; relation_type: string }> = await runner.query(
    `SELECT asset_id, related_asset_id, relation_type FROM asset_relations WHERE tenant_id = $1`,
    [seed.tenantId],
  );
  return rows.map((row) => `${row.asset_id}>${row.relation_type}>${row.related_asset_id}`).sort();
}

async function seedTab(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const role = async (name: string) => (await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, name])).id as string;
  const readerRole = await role('Infrastructure member');
  const contributorRole = await role('Business Contributor');
  const user = (roleId: string, name: string) => one(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, 'Martin') RETURNING id`,
    [tenantId, `${name}-${tag}-${tenantId.slice(0, 8)}@example.test`, roleId, name],
  ).then((row) => row.id as string);
  const userId = await user(readerRole, 'Rita');
  const contributorId = await user(contributorRole, 'Ada');

  const asset = async (name: string, kind: string, environment: string) => {
    const row = await one(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', now(), now()) RETURNING id, asset_reference AS reference`,
      [tenantId, name, kind, environment],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const host = await asset('Host asset', 'physical_server', 'prod');
  const rack = await asset('Rack asset', 'physical_server', 'prod');
  const vm = await asset('Vm asset', 'virtual_machine', 'prod');
  const db = await asset('Db asset', 'virtual_machine', 'test');
  const app = await asset('App asset', 'virtual_machine', 'dev');
  const free = await asset('Free asset', 'physical_server', 'dev');
  // Host contains Vm and depends on Db; Rack contains Host; App depends on Host.
  await runner.query(
    `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type)
     VALUES ($1, $2, $3, 'contains'), ($1, $2, $4, 'depends_on'), ($1, $5, $2, 'contains'), ($1, $6, $2, 'depends_on')`,
    [tenantId, host.id, vm.id, db.id, rack.id, app.id],
  );

  const line = async (nature: 'opex' | 'capex', itemNumber: number, name: string) => {
    if (nature === 'opex') {
      return (await one(
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number) VALUES ($1, $2, 'EUR', '2026-01-01', $3) RETURNING id`,
        [tenantId, name, itemNumber],
      )).id as string;
    }
    return (await one(
      `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number)
       VALUES ($1, 'capex', $2, 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $3::int + 500000, 'CPX-' || $3::int) RETURNING id`,
      [tenantId, name, itemNumber],
    )).id as string;
  };
  const lines = {
    opex: await line('opex', 11, 'Opex line'),
    capex: await line('capex', 11, 'Capex line'),
    freeOpex: await line('opex', 12, 'Free opex line'),
    freeCapex: await line('capex', 12, 'Free capex line'),
  };
  await runner.query(
    `INSERT INTO asset_spend_items (tenant_id, asset_id, spend_item_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, host.id, lines.opex, lines.capex],
  );

  const companyId = (await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Asset company', 'FR', 'Lyon') RETURNING id`, [tenantId])).id;
  const supplierId = (await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Asset supplier') RETURNING id`, [tenantId])).id;
  const contract = async (name: string) => (await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [tenantId, name, companyId, supplierId],
  )).id as string;
  const contracts = { alpha: await contract('Alpha contract'), free: await contract('Free contract') };
  await runner.query(`INSERT INTO asset_contracts (tenant_id, asset_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, host.id, contracts.alpha]);

  const project = async (name: string, itemNumber: number) => (await one(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number, status, planned_end) VALUES ($1, $2, $3, 'planned', '2026-06-01') RETURNING id`,
    [tenantId, name, itemNumber],
  )).id as string;
  const projects = { alpha: await project('Alpha project', 3), hidden: await project('Hidden project', 4), free: await project('Free project', 5) };
  await runner.query(
    `INSERT INTO portfolio_project_team (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'business_team')`,
    [tenantId, projects.alpha, contributorId],
  );
  await runner.query(
    `INSERT INTO asset_projects (tenant_id, asset_id, project_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, host.id, projects.alpha, projects.hidden],
  );

  const task = async (title: string, itemNumber: number, assignee: string | null, status: string, due: string | null) => (await one(
    `INSERT INTO tasks (tenant_id, title, item_number, assignee_user_id, status, due_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, title, itemNumber, assignee, status, due],
  )).id as string;
  const tasks = {
    open: await task('Patch the host', 7, contributorId, 'open', '2026-11-02'),
    done: await task('Rack the host', 8, null, 'done', '2026-01-10'),
    hidden: await task('Hidden task', 9, null, 'open', null),
    free: await task('Free task', 10, contributorId, 'open', null),
  };
  await runner.query(
    `INSERT INTO task_assets (tenant_id, task_id, asset_id) VALUES ($1, $2, $5), ($1, $3, $5), ($1, $4, $5)`,
    [tenantId, tasks.open, tasks.done, tasks.hidden, host.id],
  );

  const incident = async (number: number, extra: { confidential?: boolean; status?: string; detected: string }) => (await one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, status, reporter_user_id, detected_at)
     VALUES ($1, $2, $3, 'low', $4, $5, $6, $7) RETURNING id`,
    [tenantId, number, `Incident ${number}`, extra.confidential ?? false, extra.status ?? 'open', extra.confidential ? contributorId : null, extra.detected],
  )).id as string;
  const incidents = {
    open: await incident(1, { detected: '2026-09-01T08:00:00Z' }),
    secret: await incident(2, { confidential: true, detected: '2026-09-05T08:00:00Z' }),
    closed: await incident(3, { status: 'closed', detected: '2026-08-01T08:00:00Z' }),
    free: await incident(4, { detected: '2026-10-01T08:00:00Z' }),
  };
  await runner.query(
    `INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $5), ($1, $3, $5), ($1, $4, $5)`,
    [tenantId, incidents.open, incidents.secret, incidents.closed, host.id],
  );

  await runner.query(`INSERT INTO asset_links (tenant_id, asset_id, url) VALUES ($1, $2, 'https://example.test/host')`, [tenantId, host.id]);

  return {
    tenantId, userId, contributorId, asset: host,
    peers: { rack, vm, db, app, free },
    lines, contracts, projects, tasks, incidents,
  };
}

const related = (ref: Ref, name: string, kind: string, environment: string) => ({ id: ref.id, reference: ref.reference, name, kind, environment, status: 'active' });

async function testPayload() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'astrel-payload');
    const { http } = httpOf();
    const res = await http.relationsTabRead(seed.asset.reference, ctx(runner, seed, ALL, seed.userId, true));

    assert.deepEqual(Object.keys(res).sort(), ['assets', 'budget_column', 'budget_lines', 'budget_lines_hidden', 'contracts', 'counts', 'incidents', 'projects', 'tasks', 'year']);
    assert.deepEqual(res.assets, {
      contains: [related(seed.peers.vm, 'Vm asset', 'virtual_machine', 'prod')],
      contained_by: [related(seed.peers.rack, 'Rack asset', 'physical_server', 'prod')],
      depends_on: [related(seed.peers.db, 'Db asset', 'virtual_machine', 'test')],
      depended_on_by: [related(seed.peers.app, 'App asset', 'virtual_machine', 'dev')],
    });
    // OPEX and CAPEX together, each with its nature; no version this year, so no amount.
    assert.deepEqual(res.budget_lines?.map((row) => [row.product_name, row.nature, row.amount]), [['Capex line', 'capex', null], ['Opex line', 'opex', null]]);
    assert.deepEqual(res.contracts?.map((row) => row.id), [seed.contracts.alpha]);
    assert.deepEqual(res.projects?.map((row) => [row.name, row.item_number, row.planned_end]), [['Alpha project', 3, '2026-06-01'], ['Hidden project', 4, '2026-06-01']]);
    // Open tasks first, then by due date.
    assert.deepEqual(res.tasks, [
      { id: seed.tasks.open, item_number: 7, title: 'Patch the host', status: 'open', assignee_name: 'Ada Martin', due_date: '2026-11-02' },
      { id: seed.tasks.hidden, item_number: 9, title: 'Hidden task', status: 'open', assignee_name: null, due_date: null },
      { id: seed.tasks.done, item_number: 8, title: 'Rack the host', status: 'done', assignee_name: null, due_date: '2026-01-10' },
    ]);
    assert.deepEqual(res.incidents?.map((row) => [row.id, row.title]), [
      [seed.incidents.secret, null],
      [seed.incidents.open, 'Incident 1'],
      [seed.incidents.closed, 'Incident 3'],
    ]);
    assert.deepEqual(res.counts, { assets: 4, budget_lines: 2, contracts: 1, projects: 2, tasks: 3, incidents: 3, links: 1, attachments: 0, total: 12 });
    assert.equal(res.budget_column.key, 'planned');

    // A uuid works as well as the reference.
    assert.deepEqual((await http.relationsTabRead(seed.asset.id, ctx(runner, seed, ALL, seed.userId, true))).counts, res.counts);

    // Without the read of a module, its section is null and the badge does not count it.
    const bare = await http.relationsTabRead(seed.asset.id, ctx(runner, seed, NONE));
    for (const key of ['budget_lines', 'contracts', 'projects', 'tasks', 'incidents'] as const) assert.equal(bare[key], null, key);
    // Without the budget right, the lines are counted, never named (data-scoped access, spec §5.4).
    assert.equal(bare.budget_lines_hidden, 2);
    assert.equal(res.budget_lines_hidden, 0);
    assert.equal(bare.assets.contains.length, 1);
    assert.deepEqual(bare.counts, { assets: 4, budget_lines: 0, contracts: 0, projects: 0, tasks: 0, incidents: 0, links: 1, attachments: 0, total: 1 });

    // A viewer who is neither registry admin, reporter nor owner does not see the confidential incident.
    const plain = await http.relationsTabRead(seed.asset.id, ctx(runner, seed, ALL));
    assert.deepEqual(plain.incidents?.map((row) => row.id), [seed.incidents.open, seed.incidents.closed]);
    assert.equal(plain.counts.incidents, 2);
  });
}

async function testContributor() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'astrel-bc');
    const { audit, activities, http } = httpOf();
    const bc = ctx(runner, seed, WRITE, seed.contributorId);
    const res = await http.relationsTabRead(seed.asset.id, bc);
    assert.deepEqual(res.projects?.map((row) => row.id), [seed.projects.alpha]);
    assert.deepEqual(res.tasks?.map((row) => row.id), [seed.tasks.open]);
    assert.equal(res.counts.projects, 1);
    assert.equal(res.counts.tasks, 1);

    // A project outside the scope reads as a missing one, to link or to unlink.
    for (const call of [
      () => http.linkRelation(seed.asset.id, 'projects', { id: seed.projects.free }, bc),
      () => http.unlinkRelation(seed.asset.id, 'projects', seed.projects.hidden, bc),
    ]) {
      const err = await rejection(call);
      assert.ok(err instanceof BadRequestException);
      assert.equal(err.message, 'One or more projects not found');
    }
    // A task outside the scope is neither linked nor removed.
    const hiddenTask = await rejection(() => http.linkRelation(seed.asset.id, 'tasks', { id: seed.tasks.done }, bc));
    assert.ok(hiddenTask instanceof BadRequestException);
    assert.deepEqual(await http.unlinkRelation(seed.asset.id, 'tasks', seed.tasks.hidden, bc), { ok: true, changed: false });
    assert.equal(audit.entries.length, 0);
    assert.equal(activities.length, 0);
    assert.deepEqual(await ids(runner, `SELECT project_id AS id FROM asset_projects WHERE asset_id = $1`, [seed.asset.id]), [seed.projects.alpha, seed.projects.hidden].sort());
    assert.deepEqual(await ids(runner, `SELECT task_id AS id FROM task_assets WHERE asset_id = $1`, [seed.asset.id]), [seed.tasks.open, seed.tasks.done, seed.tasks.hidden].sort());

    // Inside the scope, the contributor links and unlinks.
    assert.deepEqual(await http.linkRelation(seed.asset.id, 'tasks', { id: seed.tasks.free }, bc), { ok: true, changed: true });
    assert.deepEqual(await http.unlinkRelation(seed.asset.id, 'projects', seed.projects.alpha, bc), { ok: true, changed: true });
  });
}

/** Budget lines, contracts and projects: one row, the asset's audit form, idempotent. */
async function testOwnedLinks() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'astrel-owned');
    const { audit, http } = httpOf();
    const writer = ctx(runner, seed, WRITE);
    const sorted = (...values: string[]) => [...values].sort();

    const cases: Array<{ kind: string; target: string; table: string; column: string; label: string; before: string[] }> = [
      { kind: 'budget_lines', target: seed.lines.freeOpex, table: 'asset_spend_items', column: 'spend_item_id', label: 'asset_spend_items', before: [seed.lines.opex] },
      { kind: 'budget_lines', target: seed.lines.freeCapex, table: 'asset_spend_items', column: 'spend_item_id', label: 'asset_capex_items', before: [seed.lines.capex] },
      { kind: 'contracts', target: seed.contracts.free, table: 'asset_contracts', column: 'contract_id', label: 'asset_contracts', before: [seed.contracts.alpha] },
      { kind: 'projects', target: seed.projects.free, table: 'asset_projects', column: 'project_id', label: 'asset_projects', before: sorted(seed.projects.alpha, seed.projects.hidden) },
    ];
    for (const c of cases) {
      const start = audit.entries.length;
      assert.deepEqual(await http.linkRelation(seed.asset.reference, c.kind, { id: c.target.toUpperCase() }, writer), { ok: true, changed: true }, c.label);
      assert.deepEqual(await http.linkRelation(seed.asset.id, c.kind, { id: c.target }, writer), { ok: true, changed: false }, `${c.label} again`);
      assert.deepEqual(audit.entries.slice(start), [{
        table: c.label, recordId: seed.asset.id, action: 'update',
        before: { ids: c.before }, after: { ids: sorted(...c.before, c.target) }, userId: seed.userId,
      }], c.label);
      assert.ok((await ids(runner, `SELECT ${c.column} AS id FROM ${c.table} WHERE asset_id = $1`, [seed.asset.id])).includes(c.target));
      assert.deepEqual(await http.unlinkRelation(seed.asset.id, c.kind, c.target, writer), { ok: true, changed: true });
      assert.deepEqual(await http.unlinkRelation(seed.asset.id, c.kind, c.target, writer), { ok: true, changed: false });
      assert.equal(audit.entries.length, start + 2, `${c.label} unlink audited once`);
      assert.deepEqual(audit.entries.at(-1)?.after, { ids: c.before });
    }
  });
}

async function testTasks() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'astrel-tasks');
    const { activities, http } = httpOf();
    const writer = ctx(runner, seed, WRITE);
    assert.deepEqual(await http.linkRelation(seed.asset.id, 'tasks', { id: seed.tasks.free }, writer), { ok: true, changed: true });
    assert.deepEqual(activities.map((call) => call.taskId), [seed.tasks.free], 'only the task that changed records an activity');
    assert.deepEqual(activities[0].changes, { linked_assets: [[], ['Host asset']] });
    assert.deepEqual(await http.linkRelation(seed.asset.id, 'tasks', { id: seed.tasks.free }, writer), { ok: true, changed: false });
    assert.deepEqual(await http.unlinkRelation(seed.asset.id, 'tasks', seed.tasks.free, writer), { ok: true, changed: true });
    assert.deepEqual(await http.unlinkRelation(seed.asset.id, 'tasks', seed.tasks.free, writer), { ok: true, changed: false });
    assert.equal(activities.length, 2);
    assert.deepEqual(await ids(runner, `SELECT task_id AS id FROM task_assets WHERE asset_id = $1`, [seed.asset.id]), [seed.tasks.open, seed.tasks.done, seed.tasks.hidden].sort());
    const missing = await rejection(() => http.linkRelation(seed.asset.id, 'tasks', { id: randomUUID() }, writer));
    assert.ok(missing instanceof BadRequestException);
    assert.match(missing.message, /^Invalid task_ids/);
  });
}

/** The rules of the asset's own replacement: no self relation, no cycle check, one row per pair and type. */
async function testAssetRelations() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'astrel-assets');
    const { audit, http } = httpOf();
    const writer = ctx(runner, seed, WRITE);
    const host = seed.asset.id;
    const free = seed.peers.free.id;
    const start = await relationRows(runner, seed);

    // Host contains Free, then Free contains Host (written on Free): no cycle check today. The
    // host now has two containers, which the write reports (R3).
    assert.deepEqual(await http.linkRelation(host, 'contains', { id: free }, writer), { ok: true, changed: true });
    assert.deepEqual(await http.linkRelation(host, 'contained_by', { id: free }, writer), {
      ok: true,
      changed: true,
      double_containers: [{
        asset_id: host,
        asset_name: 'Host asset',
        containers: [
          { id: free, name: 'Free asset' },
          { id: seed.peers.rack.id, name: 'Rack asset' },
        ],
      }],
    });
    // The same pair in the other type is another relation.
    assert.deepEqual(await http.linkRelation(host, 'depended_on_by', { id: free }, writer), { ok: true, changed: true });
    assert.deepEqual(await http.linkRelation(host, 'contains', { id: free }, writer), { ok: true, changed: false });
    assert.deepEqual(await relationRows(runner, seed), [
      ...start, `${host}>contains>${free}`, `${free}>contains>${host}`, `${free}>depends_on>${host}`,
    ].sort());

    // The audit is the source asset's relations, as `addRelation` writes them.
    assert.equal(audit.entries.length, 3);
    assert.deepEqual(audit.entries.map((entry) => [entry.table, entry.recordId]), [['asset_relations', host], ['asset_relations', free], ['asset_relations', free]]);
    assert.deepEqual(audit.entries[1].before, { relations: [] });
    assert.deepEqual(audit.entries[1].after, { relations: [{ related_asset_id: host, relation_type: 'contains' }] });

    const tab = await http.relationsTabRead(host, ctx(runner, seed, ALL));
    assert.deepEqual(tab.assets.contains.map((row) => row.name), ['Free asset', 'Vm asset']);
    assert.deepEqual(tab.assets.contained_by.map((row) => row.name), ['Free asset', 'Rack asset']);
    assert.deepEqual(tab.assets.depended_on_by.map((row) => row.name), ['App asset', 'Free asset']);

    const self = await rejection(() => http.linkRelation(host, 'depends_on', { id: host }, writer));
    assert.ok(self instanceof BadRequestException);
    assert.equal(self.message, 'Asset cannot have a relation to itself');
    for (const kind of ['contains', 'contained_by'] as const) {
      const missing = await rejection(() => http.linkRelation(host, kind, { id: randomUUID() }, writer));
      assert.ok(missing instanceof BadRequestException, kind);
      assert.equal(missing.message, 'One or more related assets were not found', kind);
    }

    assert.deepEqual(await http.unlinkRelation(host, 'contained_by', free, writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries.at(-1)?.after, { relations: [{ related_asset_id: host, relation_type: 'depends_on' }] });
    assert.deepEqual(await http.unlinkRelation(host, 'contained_by', free, writer), { ok: true, changed: false });
    assert.deepEqual(await http.unlinkRelation(host, 'contains', free, writer), { ok: true, changed: true });
    assert.deepEqual(await http.unlinkRelation(host, 'depended_on_by', free, writer), { ok: true, changed: true });
    assert.deepEqual(await relationRows(runner, seed), start);
    assert.equal(audit.entries.length, 6);
  });
}

async function testIncidents() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'astrel-inc');
    const { audit, http } = httpOf();
    const writer = ctx(runner, seed, WRITE);
    assert.deepEqual(await http.linkRelation(seed.asset.id, 'incidents', { id: seed.incidents.free }, writer), { ok: true, changed: true });
    const entries: Array<{ kind: string; author_id: string; changed_fields: any }> = await runner.query(
      `SELECT kind, author_id, changed_fields FROM incident_entries WHERE tenant_id = $1 AND incident_id = $2`,
      [seed.tenantId, seed.incidents.free],
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'link_change');
    assert.equal(entries[0].author_id, seed.userId);
    assert.deepEqual(entries[0].changed_fields?.assets, { from: [], to: [seed.asset.reference] });
    assert.equal(audit.entries.at(-1)?.table, 'incident_assets');
    assert.equal(audit.entries.at(-1)?.recordId, seed.incidents.free);
    assert.deepEqual(await http.linkRelation(seed.asset.id, 'incidents', { id: seed.incidents.free }, writer), { ok: true, changed: false });
    assert.deepEqual(await http.unlinkRelation(seed.asset.id, 'incidents', seed.incidents.free, writer), { ok: true, changed: true });
    assert.deepEqual(await http.unlinkRelation(seed.asset.id, 'incidents', seed.incidents.free, writer), { ok: true, changed: false });

    // A closed incident refuses the change; a confidential one the viewer cannot see answers as unknown.
    await assert.rejects(http.unlinkRelation(seed.asset.id, 'incidents', seed.incidents.closed, writer), /closed/);
    await assert.rejects(http.unlinkRelation(seed.asset.id, 'incidents', seed.incidents.secret, writer), /Incident not found/);
    await assert.rejects(http.linkRelation(seed.asset.id, 'incidents', { id: randomUUID() }, writer), /Incident not found/);
    // The reporter sees it.
    assert.deepEqual(await http.unlinkRelation(seed.asset.id, 'incidents', seed.incidents.secret, ctx(runner, seed, WRITE, seed.contributorId)), { ok: true, changed: true });

    // Reading the incidents is not enough: linking one needs the incident edit right.
    const reader = await rejection(() => http.linkRelation(seed.asset.id, 'incidents', { id: seed.incidents.free }, ctx(runner, seed, { ...WRITE, incidents: 'reader' })));
    assert.ok(reader instanceof ForbiddenException);
    assert.equal(reader.message, 'You cannot edit this module.');
    assert.deepEqual(
      await ids(runner, `SELECT incident_id AS id FROM incident_assets WHERE asset_id = $1`, [seed.asset.id]),
      [seed.incidents.open, seed.incidents.closed].sort(),
    );
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'astrel-refuse');
    const { audit, activities, http } = httpOf();
    const writer = ctx(runner, seed, WRITE);
    const kinds = ['contains', 'contained_by', 'depends_on', 'depended_on_by', 'budget_lines', 'contracts', 'projects', 'tasks', 'incidents'];

    for (const kind of kinds) {
      const invalid = await rejection(() => http.linkRelation(seed.asset.id, kind, { id: 'nope' }, writer));
      assert.ok(invalid instanceof BadRequestException, kind);
      assert.equal(invalid.message, 'Invalid id.', kind);
      const missingAsset = await rejection(() => http.linkRelation(randomUUID(), kind, { id: randomUUID() }, writer));
      assert.ok(missingAsset instanceof NotFoundException, kind);
      assert.equal(missingAsset.message, 'Asset not found', kind);
    }
    for (const [kind, message] of [
      ['budget_lines', 'Budget line not found.'],
      ['contracts', 'One or more contracts were not found'],
      ['projects', 'One or more projects not found'],
    ] as const) {
      const err = await rejection(() => http.linkRelation(seed.asset.id, kind, { id: randomUUID() }, writer));
      assert.ok(err instanceof BadRequestException, kind);
      assert.equal(err.message, message, kind);
    }

    const unknown = await rejection(() => http.linkRelation(seed.asset.id, 'applications', { id: randomUUID() }, writer));
    assert.ok(unknown instanceof NotFoundException);
    assert.equal(unknown.message, 'Unknown relation type.');
    const unknownFirst = await rejection(() => http.unlinkRelation(randomUUID(), 'nope', 'nope', ctx(runner, seed, NONE)));
    assert.ok(unknownFirst instanceof NotFoundException);
    assert.equal(unknownFirst.message, 'Unknown relation type.');

    for (const [kind, resource] of [
      ['budget_lines', 'budget'],
      ['contracts', 'contracts'],
      ['projects', 'portfolio_projects'],
      ['tasks', 'tasks'],
      ['incidents', 'incidents'],
    ] as const) {
      const refused = await rejection(() => http.unlinkRelation(seed.asset.id, kind, 'nope', ctx(runner, seed, { ...WRITE, [resource]: 'none' })));
      assert.ok(refused instanceof ForbiddenException, kind);
      assert.equal(refused.message, 'You cannot read this module.', kind);
    }
    const badRef = await rejection(() => http.relationsTabRead('not a reference', ctx(runner, seed, ALL)));
    assert.ok(badRef instanceof NotFoundException);

    assert.equal(audit.entries.length, 0);
    assert.equal(activities.length, 0);
    assert.equal((await relationRows(runner, seed)).length, 4);
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTab(runner, 'astrel-a');
    const b = await seedTab(runner, 'astrel-b');
    await setTenant(runner, b.tenantId);
    const { audit, http } = httpOf();
    const reader = ctx(runner, b, ALL);
    const writer = ctx(runner, b, WRITE);

    for (const call of [
      () => http.relationsTabRead(a.asset.id, reader),
      () => http.linkRelation(a.asset.id, 'contracts', { id: b.contracts.free }, writer),
      () => http.unlinkRelation(a.asset.id, 'contains', a.peers.vm.id, writer),
      () => http.linkRelation(a.asset.id, 'incidents', { id: b.incidents.free }, writer),
    ]) {
      const err = await rejection(call);
      assert.ok(err instanceof NotFoundException, err.message);
    }
    // A reference is the tenant's own: the same AST-n reads this tenant's asset.
    const own = await http.relationsTabRead(b.asset.reference, reader);
    assert.deepEqual(own.contracts?.map((row) => row.id), [b.contracts.alpha]);

    for (const [kind, target] of [
      ['contains', a.peers.free.id],
      ['budget_lines', a.lines.freeOpex],
      ['contracts', a.contracts.free],
      ['projects', a.projects.free],
      ['tasks', a.tasks.free],
    ] as const) {
      const err = await rejection(() => http.linkRelation(b.asset.id, kind, { id: target }, writer));
      assert.ok(err instanceof BadRequestException, kind);
    }
    await assert.rejects(http.linkRelation(b.asset.id, 'incidents', { id: a.incidents.free }, writer), /Incident not found/);
    assert.equal(audit.entries.length, 0);
  });
}

function testPermissionMetadata() {
  const proto = AssetsController.prototype;
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.relationsTabRead), { resource: 'infrastructure', level: 'reader' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.linkRelation), { resource: 'infrastructure', level: 'member' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.unlinkRelation), { resource: 'infrastructure', level: 'member' });
  return Promise.resolve();
}

/**
 * The placement of a virtual machine carried by a cluster (lot C1b): the writes answer with the
 * host links the cluster replaced and the double containers, a member's duplicate is refused, and
 * the tab marks the contained assets that have another container in service.
 */
async function testPlacement() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'astrel-placement');
    const { http } = httpOf();
    const writer = ctx(runner, seed, WRITE);
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
    const makeAsset = async (name: string, cluster = false) => {
      const row = await one(
        `INSERT INTO assets (tenant_id, name, kind, environment, status, is_cluster, created_at, updated_at)
         VALUES ($1, $2, 'physical_server', 'prod', 'active', $3, now(), now()) RETURNING id, asset_reference AS reference`,
        [seed.tenantId, name, cluster],
      );
      return { id: row.id as string, reference: row.reference as string };
    };
    const insertContains = (container: string, content: string) => runner.query(
      `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'contains')`,
      [seed.tenantId, container, content],
    );

    const cluster = await makeAsset('PAR-VSPHERE-CL01', true);
    const member = await makeAsset('par-esx-01');
    const outsider = await makeAsset('par-esx-02');
    const vm1 = await makeAsset('par-app-01');
    const vm2 = await makeAsset('par-app-02');
    const vm3 = await makeAsset('par-app-03');
    const vm4 = await makeAsset('par-app-04');
    await runner.query(
      `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`,
      [seed.tenantId, cluster.id, member.id],
    );
    await insertContains(member.id, vm1.id);
    await insertContains(member.id, vm2.id);
    await insertContains(cluster.id, vm3.id);
    await insertContains(outsider.id, vm4.id);

    // Cluster side: the member's link is replaced, exact contract.
    const absorbed = await http.linkRelation(cluster.id, 'contains', { id: vm1.id }, writer);
    assert.deepEqual(absorbed, {
      ok: true,
      changed: true,
      replaced_host_links: [{
        host_id: member.id, host_name: 'par-esx-01', asset_id: vm1.id, asset_name: 'par-app-01',
        cluster_id: cluster.id, cluster_name: 'PAR-VSPHERE-CL01',
      }],
    });

    // VM side: `contained_by` gives the same absorption and the same field.
    const fromVm = await http.linkRelation(vm2.id, 'contained_by', { id: cluster.id }, writer);
    assert.deepEqual(fromVm.replaced_host_links?.map((link) => [link.host_id, link.asset_id]), [[member.id, vm2.id]]);
    assert.equal(fromVm.changed, true);
    assert.equal(fromVm.double_containers, undefined);

    // R2: the member cannot add a container the cluster already carries.
    const before = await relationRows(runner, seed);
    const refused = await rejection(() => http.linkRelation(vm3.id, 'contained_by', { id: member.id }, writer));
    assert.ok(refused instanceof ConflictException);
    assert.deepEqual(refused.getResponse(), {
      code: 'placement_inherited',
      message: 'This asset is already contained by the cluster PAR-VSPHERE-CL01, which one of its hosts belongs to.',
      params: { cluster: 'PAR-VSPHERE-CL01' },
    });
    assert.deepEqual(await relationRows(runner, seed), before, 'the refusal writes nothing');

    // R3: a cluster and a host outside it are only reported.
    const doubled = await http.linkRelation(cluster.id, 'contains', { id: vm4.id }, writer);
    assert.deepEqual(doubled.double_containers, [{
      asset_id: vm4.id,
      asset_name: 'par-app-04',
      containers: [
        { id: outsider.id, name: 'par-esx-02' },
        { id: cluster.id, name: 'PAR-VSPHERE-CL01' },
      ],
    }]);
    assert.equal(doubled.replaced_host_links, undefined, 'the non-member keeps its link');
    assert.deepEqual(
      await ids(runner, `SELECT related_asset_id AS id FROM asset_relations WHERE asset_id = $1 AND relation_type = 'contains'`, [outsider.id]),
      [vm4.id],
    );

    // The tab marks the contained asset with another container, and only it.
    const tab = await http.relationsTabRead(cluster.reference, ctx(runner, seed, ALL));
    const byName = (name: string) => tab.assets.contains.find((row) => row.name === name)!;
    assert.deepEqual(byName('par-app-04').also_contained_by, [{ id: outsider.id, name: 'par-esx-02' }]);
    for (const name of ['par-app-01', 'par-app-02', 'par-app-03']) {
      assert.equal('also_contained_by' in byName(name), false, name);
    }
    // An asset whose contained assets have one container each keeps the shorter shape.
    const rackTab = await http.relationsTabRead(seed.peers.rack.reference, ctx(runner, seed, ALL));
    assert.equal(rackTab.assets.contains.length, 1);
    assert.equal('also_contained_by' in rackTab.assets.contains[0], false);
    assert.deepEqual(rackTab.assets.contains[0], related(seed.asset, 'Host asset', 'physical_server', 'prod'));
  });
}

void runSpecs('asset-relations-tab.integration.spec', [
  ['testPermissionMetadata', testPermissionMetadata],
  ['testPayload', testPayload],
  ['testContributor', testContributor],
  ['testOwnedLinks', testOwnedLinks],
  ['testTasks', testTasks],
  ['testAssetRelations', testAssetRelations],
  ['testIncidents', testIncidents],
  ['testRefusals', testRefusals],
  ['testTenantIsolation', testTenantIsolation],
  ['testPlacement', testPlacement],
]);
