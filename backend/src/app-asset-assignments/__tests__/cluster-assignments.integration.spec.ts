// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { withTenantExecution } from '../../common/tenant-runner';
import { AppAssetAssignmentsService } from '../app-asset-assignments.service';
import { AppInstancesService } from '../../app-instances/app-instances.service';
import { AssetsDeleteService } from '../../assets/assets-delete.service';
import { Asset } from '../../assets/asset.entity';
import { AiRelationMutationSupportService } from '../../ai/mutation/ai-relation-mutation-support.service';
import { AiTaskMutationSupportService } from '../../ai/mutation/ai-task-mutation-support.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';

// Clusters pass, lot B1b: the writes of an assignment on a cluster or a member.
// - A1: a deployment can be assigned to a cluster, with or without members.
// - A3: a member gets no direct row for what one of its clusters carries (`assignment_inherited`),
//   in create and in update.
// - A4: a row written to a cluster replaces the direct rows of the same deployment and role on its
//   members in service (earliest date, notes joined, deletions audited, `absorbed` answered), in
//   create and in update; the Deployments and Operations tabs then show the inherited row.
// - A duplicate on the cluster and a role outside the catalog are coded refusals.
// - The assistant follows the same rules, at the preview and again at execution.
// - Two writers on a cluster and its member, on two connections, decide one after the other; a
//   member's row edited while it is absorbed is not written again.
// - A cluster's row moved onto one of its members; a create on a cluster that already carries the
//   row absorbs instead of refusing; the assistant keeps hyphenated catalog roles.
// - A10: a cluster that carries rows cannot be deleted.

type AuditEntry = { table: string; action: string; recordId: string; before?: any; after?: any };

function services(m: EntityManager, entries: AuditEntry[]) {
  const audit = { log: async (entry: AuditEntry) => { entries.push(entry); } } as any;
  const settings = new ItOpsSettingsService(m.getRepository(Tenant), m.getRepository(Location), audit);
  return {
    settings,
    assignments: new AppAssetAssignmentsService(null as any, null as any, null as any, audit, settings),
    instances: new AppInstancesService(null as any, null as any, null as any, null as any, audit, settings),
    assistant: new AiRelationMutationSupportService(audit, undefined as any, new AiTaskMutationSupportService(), settings),
    deletes: new AssetsDeleteService(m.getRepository(Asset), audit),
  };
}

async function newTenant(q: { query: (sql: string, params?: unknown[]) => Promise<any> }, label: string): Promise<string> {
  const id = randomUUID();
  await q.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, `cl-asg-${label}-${id.slice(0, 8)}`, `Cluster assignments ${label}`],
  );
  return id;
}

async function one(m: EntityManager, sql: string, params: unknown[]): Promise<string> {
  return (await m.query(sql, params))[0].id as string;
}

const seedAsset = (m: EntityManager, tenantId: string, name: string, opts: { cluster?: boolean; retired?: boolean } = {}) =>
  one(m,
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, is_cluster, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', $3, $4, now(), now()) RETURNING id`,
    [tenantId, name, opts.retired ? 'retired' : 'active', !!opts.cluster]);

const addMember = (m: EntityManager, tenantId: string, clusterId: string, assetId: string) =>
  m.query(`INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, clusterId, assetId]);

const assign = (m: EntityManager, tenantId: string, instanceId: string, assetId: string, role: string, since: string | null = null, notes: string | null = null) =>
  one(m, `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role, since_date, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, instanceId, assetId, role, since, notes]);

/** The stored rows of a deployment, as `name:role`, sorted. */
async function stored(m: EntityManager, tenantId: string, instanceId: string): Promise<string[]> {
  const rows: Array<{ name: string; role: string }> = await m.query(
    `SELECT a.name, x.role FROM app_asset_assignments x JOIN assets a ON a.tenant_id = x.tenant_id AND a.id = x.asset_id
      WHERE x.tenant_id = $1 AND x.app_instance_id = $2`,
    [tenantId, instanceId],
  );
  return rows.map((row) => `${row.name}:${row.role}`).sort();
}

async function storedRow(m: EntityManager, tenantId: string, instanceId: string, assetId: string, role: string) {
  const [row] = await m.query(
    `SELECT id, to_char(since_date, 'YYYY-MM-DD') AS since, notes FROM app_asset_assignments
      WHERE tenant_id = $1 AND app_instance_id = $2 AND asset_id = $3 AND role = $4`,
    [tenantId, instanceId, assetId, role],
  );
  return row as { id: string; since: string | null; notes: string | null } | undefined;
}

type Refusal = { status?: number; code?: string; params?: unknown; message: string };

async function refusal(run: () => Promise<unknown>, savepoint?: QueryRunner): Promise<Refusal> {
  if (savepoint) await savepoint.query('SAVEPOINT refusal');
  try {
    await run();
  } catch (error: any) {
    if (savepoint) await savepoint.query('ROLLBACK TO SAVEPOINT refusal');
    const body = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return {
      status: typeof error?.getStatus === 'function' ? error.getStatus() : undefined,
      code: body?.code,
      params: body?.params,
      message: String(error?.message ?? error),
    };
  }
  throw new Error('expected a refusal');
}

async function inRolledBackTenant(fn: (runner: QueryRunner, m: EntityManager, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await newTenant(runner, 'tx');
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, runner.manager, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testServiceRules() {
  await inRolledBackTenant(async (runner, m, t) => {
    const entries: AuditEntry[] = [];
    const { assignments, instances, deletes } = services(m, entries);
    const opts = { manager: m, tenantId: t };
    const app = await one(m, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [t]);
    const prod = (await instances.create(app, { environment: 'prod' }, null, opts)).id;
    const empty = await seedAsset(m, t, 'cl-empty', { cluster: true });
    const cl = await seedAsset(m, t, 'cl-main', { cluster: true });
    const m1 = await seedAsset(m, t, 'node-1');
    const m2 = await seedAsset(m, t, 'node-2');
    const m3 = await seedAsset(m, t, 'node-3');
    const old = await seedAsset(m, t, 'node-old', { retired: true });
    const solo = await seedAsset(m, t, 'solo');
    for (const member of [m1, m2, m3, old]) await addMember(m, t, cl, member);

    // A1: a cluster without members takes a row.
    const onEmpty = await assignments.create(prod, { asset_id: empty, role: 'web' }, null, opts);
    assert.deepEqual(onEmpty.absorbed, []);
    assert.equal(onEmpty.asset_id, empty);

    // A4: the members' direct rows of the same deployment and role move onto the cluster.
    const d1 = await assign(m, t, prod, m1, 'app', '2026-03-01', 'Node A');
    const d2 = await assign(m, t, prod, m2, 'app', '2025-12-01', 'Node A');
    const d3 = await assign(m, t, prod, m3, 'app', null, ' Node B ');
    await assign(m, t, prod, old, 'app', '2020-01-01', 'retired');
    await assign(m, t, prod, m1, 'db');
    entries.length = 0;
    const onCluster = await assignments.create(prod, { asset_id: cl, role: 'app', since_date: '2026-01-15', notes: 'Own' }, 'user-1' as any, opts);
    assert.deepEqual(onCluster.absorbed, [{ asset_id: m1, name: 'node-1' }, { asset_id: m2, name: 'node-2' }, { asset_id: m3, name: 'node-3' }]);
    const clusterRow = await storedRow(m, t, prod, cl, 'app');
    assert.equal(clusterRow?.since, '2025-12-01', 'the earliest date');
    assert.equal(clusterRow?.notes, 'Own\nNode A\nNode B', 'its notes, then the distinct notes absorbed');
    assert.deepEqual(await stored(m, t, prod), ['cl-empty:web', 'cl-main:app', 'node-1:db', 'node-old:app'],
      'the members in service lose their row, the retired one keeps it');
    assert.deepEqual(entries.map((e) => `${e.action}:${e.recordId}`).sort(),
      [`create:${onCluster.id}`, `delete:${d1}`, `delete:${d2}`, `delete:${d3}`].sort(), 'each deletion audited, then the creation');
    assert.equal(entries.find((e) => e.recordId === d1)?.before?.notes, 'Node A');

    // The B1a reads after the absorption: the member sees the inherited row, the cluster its members.
    const ofM1 = (await assignments.listByAsset(m1, opts));
    assert.deepEqual(ofM1.map((row) => [row.role, row.inherited, row.id]).sort(), [['app', true, onCluster.id], ['db', false, ofM1.find((r) => r.role === 'db')!.id]]);
    const tab = (await assignments.list(prod, opts)).items.find((item) => item.asset_id === cl)!;
    assert.deepEqual(tab.members.map((member) => member.name), ['node-1', 'node-2', 'node-3']);

    // A duplicate on the cluster, a role outside the catalog: coded refusals.
    assert.deepEqual(await refusal(() => assignments.create(prod, { asset_id: cl, role: 'app' }, null, opts), runner),
      { status: 409, code: 'assignment_duplicate', params: undefined, message: 'Asset already assigned with this role' });
    assert.equal((await refusal(() => assignments.create(prod, { asset_id: cl, role: 'nope' }, null, opts), runner)).code, 'assignment_role_invalid');

    // The cluster already carries the row (older data, or "Assign to the cluster" on a set it
    // carries): the members' identical rows join it instead of a duplicate refusal.
    const legacy = await assign(m, t, prod, m1, 'app', '2020-05-05', 'Legacy');
    entries.length = 0;
    const regroup = await assignments.create(prod, { asset_id: cl, role: 'app' }, null, opts);
    assert.equal(regroup.id, onCluster.id, 'the cluster keeps its row');
    assert.deepEqual(regroup.absorbed, [{ asset_id: m1, name: 'node-1' }]);
    assert.deepEqual(await storedRow(m, t, prod, cl, 'app').then((row) => [row?.since, row?.notes]), ['2020-05-05', 'Own\nNode A\nNode B\nLegacy']);
    assert.equal(await storedRow(m, t, prod, m1, 'app'), undefined);
    assert.deepEqual(entries.map((e) => `${e.action}:${e.recordId}`).sort(), [`delete:${legacy}`, `update:${onCluster.id}`].sort());

    // A3 in create: the member already runs it through the cluster; another role is free.
    assert.deepEqual(await refusal(() => assignments.create(prod, { asset_id: m2, role: 'app' }, null, opts), runner),
      { status: 409, code: 'assignment_inherited', params: { cluster: 'cl-main' },
        message: 'This server already has this role on this deployment through the cluster cl-main.' });
    const m2Db = await assignments.create(prod, { asset_id: m2, role: 'db' }, null, opts);
    assert.deepEqual(m2Db.absorbed, []);
    // A retired member inherits nothing: it may take its own row.
    await assignments.create(prod, { asset_id: old, role: 'db' }, null, opts);

    // A3 in update: to the inherited role, or from another server onto the member.
    assert.equal((await refusal(() => assignments.update(prod, m2Db.id, { role: 'app' }, null, opts), runner)).code, 'assignment_inherited');
    const onSolo = await assignments.create(prod, { asset_id: solo, role: 'app' }, null, opts);
    assert.equal((await refusal(() => assignments.update(prod, onSolo.id, { asset_id: m3 }, null, opts), runner)).code, 'assignment_inherited');
    // Notes alone: no rule, nothing absorbed.
    assert.deepEqual((await assignments.update(prod, m2Db.id, { notes: 'x' }, null, opts)).absorbed, []);

    // A4 in update: the solo row moves onto the cluster with the db role, and takes the members' db rows.
    entries.length = 0;
    const moved = await assignments.update(prod, onSolo.id, { asset_id: cl, role: 'db', since_date: '2026-05-01' }, null, opts);
    assert.deepEqual(moved.absorbed, [{ asset_id: m1, name: 'node-1' }, { asset_id: m2, name: 'node-2' }]);
    assert.deepEqual(await stored(m, t, prod), ['cl-empty:web', 'cl-main:app', 'cl-main:db', 'node-old:app', 'node-old:db']);
    assert.deepEqual(entries.map((e) => e.action).sort(), ['delete', 'delete', 'update']);
    assert.equal((await storedRow(m, t, prod, cl, 'db'))?.notes, 'x');

    // A member's own row moved onto its cluster: the row itself is not absorbed.
    const m3Web = await assignments.create(prod, { asset_id: m3, role: 'web' }, null, opts);
    await assign(m, t, prod, m1, 'web', '2024-02-02');
    const lifted = await assignments.update(prod, m3Web.id, { asset_id: cl }, null, opts);
    assert.deepEqual(lifted.absorbed, [{ asset_id: m1, name: 'node-1' }]);
    assert.equal(lifted.id, m3Web.id);
    assert.equal((await storedRow(m, t, prod, cl, 'web'))?.since, '2024-02-02');

    // And back down: the cluster's row moved onto one of its members ("This server only" on the
    // cluster's row) is not refused as inherited from itself.
    const lowered = await assignments.update(prod, lifted.id, { asset_id: m2 }, null, opts);
    assert.deepEqual(lowered.absorbed, []);
    assert.equal((await storedRow(m, t, prod, m2, 'web'))?.id, lifted.id);
    assert.equal(await storedRow(m, t, prod, cl, 'web'), undefined);
    // Another row of the cluster still refuses it.
    assert.equal((await refusal(() => assignments.update(prod, lifted.id, { role: 'app' }, null, opts), runner)).code, 'assignment_inherited');

    // A10: a cluster that carries rows stays.
    await refusal(() => deletes.deleteAsset(cl, t, null, { manager: m }), runner);
    assert.equal((await m.query(`SELECT count(*)::int AS n FROM assets WHERE tenant_id = $1 AND id = $2`, [t, cl]))[0].n, 1);
  });
}

async function testAssistantRules() {
  await inRolledBackTenant(async (runner, m, t) => {
    const entries: AuditEntry[] = [];
    const { assignments, instances, assistant } = services(m, entries);
    const opts = { manager: m, tenantId: t };
    const context: any = { manager: m, tenantId: t, userId: null };
    const app = await one(m, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'CRM') RETURNING id`, [t]);
    const prod = (await instances.create(app, { environment: 'prod' }, null, opts)).id;
    const cl = await seedAsset(m, t, 'cl-ai', { cluster: true });
    const m1 = await seedAsset(m, t, 'ai-node-1');
    const m2 = await seedAsset(m, t, 'ai-node-2');
    const m3 = await seedAsset(m, t, 'ai-node-3');
    const m4 = await seedAsset(m, t, 'ai-node-4');
    const solo = await seedAsset(m, t, 'ai-solo');
    await addMember(m, t, cl, m1);
    await addMember(m, t, cl, m2);
    await assign(m, t, prod, m1, 'app', '2026-02-01', 'n1');
    await assign(m, t, prod, m2, 'app', '2025-11-01', null);
    await assign(m, t, prod, m3, 'app', null, 'n3');
    await assign(m, t, prod, solo, 'db');

    const prepare = (add: unknown[]) =>
      assistant.prepareUpdatePreview(context, { entity_type: 'applications', ref: app, relation: 'asset_assignments', add });
    const execute = (prepared: Awaited<ReturnType<typeof prepare>>) =>
      assistant.executePreview(context, {
        id: randomUUID(), target_entity_type: 'applications', target_entity_id: prepared.targetEntityId,
        mutation_input: prepared.mutationInput, current_values: prepared.currentValues,
      } as any);
    const nextOf = (prepared: Awaited<ReturnType<typeof prepare>>) => (prepared.mutationInput.next_items as any[]);

    // The role comes from the catalog.
    assert.equal((await refusal(() => prepare([{ environment: 'prod', asset_ref: solo, role: 'nope' }]), runner)).code, 'assignment_role_invalid');

    // A4 at the preview: the members' rows leave the list, the cluster's row takes date and notes.
    const absorbing = await prepare([{ environment: 'prod', asset_ref: cl, role: 'app', since_date: '2026-01-01', notes: 'own' }]);
    const next = nextOf(absorbing);
    assert.deepEqual(next.map((item) => item.payload.asset_id).sort(), [cl, m3, solo].sort(), 'the members of the cluster leave, ai-node-3 is no member');
    const clusterItem = next.find((item) => item.payload.asset_id === cl);
    assert.equal(clusterItem.payload.since_date, '2025-11-01');
    assert.equal(clusterItem.payload.notes, 'own\nn1');

    // Checked again at execution: ai-node-3 joined the cluster after the preview.
    await addMember(m, t, cl, m3);
    assert.equal((await refusal(() => execute(absorbing), runner)).status, 409);
    assert.deepEqual(await stored(m, t, prod), ['ai-node-1:app', 'ai-node-2:app', 'ai-node-3:app', 'ai-solo:db'], 'nothing written');
    await m.query(`DELETE FROM asset_cluster_members WHERE tenant_id = $1 AND asset_id = $2`, [t, m3]);

    // Executed as previewed.
    await execute(absorbing);
    assert.deepEqual(await stored(m, t, prod), ['ai-node-3:app', 'ai-solo:db', 'cl-ai:app']);
    assert.deepEqual(await storedRow(m, t, prod, cl, 'app').then((row) => [row?.since, row?.notes]), ['2025-11-01', 'own\nn1']);
    assert.deepEqual((await assignments.listByAsset(m1, opts)).map((row) => [row.role, row.inherited]), [['app', true]]);

    // A3 at the preview: the member already runs it through the cluster.
    assert.deepEqual(await refusal(() => prepare([{ environment: 'prod', asset_ref: m2, role: 'app' }]), runner),
      { status: 409, code: 'assignment_inherited', params: { cluster: 'cl-ai' },
        message: 'This server already has this role on this deployment through the cluster cl-ai.' });
    // A3 at execution: ai-node-4 joined the cluster after the preview.
    const late = await prepare([{ environment: 'prod', asset_ref: m4, role: 'app' }]);
    await addMember(m, t, cl, m4);
    assert.deepEqual((await refusal(() => execute(late), runner)).code, 'assignment_inherited');
    assert.equal((await storedRow(m, t, prod, m4, 'app')), undefined);
    await m.query(`DELETE FROM asset_cluster_members WHERE tenant_id = $1 AND asset_id = $2`, [t, m4]);

    // A catalog role with a hyphen keeps it, and is found again to remove it.
    await execute(await prepare([{ environment: 'prod', asset_ref: solo, role: 'Domain-Controller' }]));
    assert.ok((await storedRow(m, t, prod, solo, 'domain-controller'))?.id);
    await execute(await assistant.prepareUpdatePreview(context, {
      entity_type: 'applications', ref: app, relation: 'asset_assignments', remove: [{ environment: 'prod', asset_ref: solo, role: 'domain-controller' }],
    }));
    assert.equal(await storedRow(m, t, prod, solo, 'domain-controller'), undefined);

    // The cluster already carries the row: naming it again absorbs the members' identical rows,
    // keeping its stored date and notes; each deleted row is audited as a deletion.
    const legacy = await assign(m, t, prod, m2, 'app', '2019-09-09', 'old n2');
    entries.length = 0;
    const regroup = await prepare([{ environment: 'prod', asset_ref: cl, role: 'app' }]);
    assert.deepEqual(nextOf(regroup).filter((item) => item.payload.asset_id === m2), [], 'the member\'s row leaves the list');
    await execute(regroup);
    assert.equal(await storedRow(m, t, prod, m2, 'app'), undefined);
    assert.deepEqual(await storedRow(m, t, prod, cl, 'app').then((row) => [row?.since, row?.notes]), ['2019-09-09', 'own\nn1\nold n2']);
    const deletion = entries.find((e) => e.table === 'app_asset_assignments' && e.action === 'delete');
    assert.equal(deletion?.recordId, legacy);
    assert.equal(deletion?.before?.notes, 'old n2');
  });
}

/**
 * Runs `first` in a transaction and, while it is still open, starts `second` in another one, which
 * must still be waiting when `first` commits (precedent: `assets-cluster-races.integration.spec.ts`).
 */
async function overlap(tenantId: string, first: (m: EntityManager) => Promise<unknown>, second: (m: EntityManager) => Promise<unknown>) {
  let settled = false;
  let pending: Promise<unknown> | null = null;
  await withTenantExecution(dataSource, tenantId, async (manager) => {
    await first(manager);
    pending = withTenantExecution(dataSource, tenantId, (other) => second(other));
    pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(settled, false, 'the second writer waits for the first to commit');
  });
  try {
    return { ok: true as const, value: await pending };
  } catch (error: any) {
    const body = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return { ok: false as const, status: typeof error?.getStatus === 'function' ? error.getStatus() : undefined, code: body?.code, message: String(error?.message ?? error) };
  }
}

async function testRaces() {
  const made: string[] = [];
  const seed = async (label: string) => {
    const tenantId = await newTenant(dataSource, label);
    made.push(tenantId);
    return withTenantExecution(dataSource, tenantId, async (m) => {
      const { instances } = services(m, []);
      const app = await one(m, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Race') RETURNING id`, [tenantId]);
      const prod = (await instances.create(app, { environment: 'prod' }, null, { manager: m, tenantId })).id;
      const cl = await seedAsset(m, tenantId, 'race-cluster', { cluster: true });
      const node = await seedAsset(m, tenantId, 'race-node');
      await addMember(m, tenantId, cl, node);
      return { tenantId, prod, cl, node };
    });
  };
  const create = (tenantId: string, prod: string, assetId: string) => (m: EntityManager) =>
    services(m, []).assignments.create(prod, { asset_id: assetId, role: 'app' }, null, { manager: m, tenantId });
  const rows = (s: { tenantId: string; prod: string }) => withTenantExecution(dataSource, s.tenantId, (m) => stored(m, s.tenantId, s.prod));
  try {
    // The cluster first: the member waits, then is refused.
    {
      const s = await seed('cluster-first');
      const result = await overlap(s.tenantId, create(s.tenantId, s.prod, s.cl), create(s.tenantId, s.prod, s.node));
      assert.equal(result.ok ? 'ok' : result.code, 'assignment_inherited');
      assert.deepEqual(await rows(s), ['race-cluster:app']);
    }
    // The member first: the cluster waits, then absorbs the member's row.
    {
      const s = await seed('member-first');
      const result = await overlap(s.tenantId, create(s.tenantId, s.prod, s.node), create(s.tenantId, s.prod, s.cl));
      assert.ok(result.ok, `the cluster's row is written (${(result as any).message})`);
      assert.deepEqual((result.value as any).absorbed, [{ asset_id: s.node, name: 'race-node' }]);
      assert.deepEqual(await rows(s), ['race-cluster:app']);
    }
    // The member's notes edited while the cluster absorbs its row: the edit waits, then finds the
    // row gone (404); the row is not written again.
    {
      const s = await seed('notes-during-absorption');
      const rowId = await withTenantExecution(dataSource, s.tenantId, (m) => assign(m, s.tenantId, s.prod, s.node, 'app'));
      const editNotes = (m: EntityManager) =>
        services(m, []).assignments.update(s.prod, rowId, { notes: 'late' }, null, { manager: m, tenantId: s.tenantId });
      const result = await overlap(s.tenantId, create(s.tenantId, s.prod, s.cl), editNotes);
      assert.equal(result.ok ? 'ok' : result.status, 404);
      assert.deepEqual(await rows(s), ['race-cluster:app']);
    }
  } finally {
    for (const tenantId of made) {
      await withTenantExecution(dataSource, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
        .catch((error) => console.error(`could not purge ${tenantId}:`, error));
      await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId])
        .catch((error) => console.error(`could not delete ${tenantId}:`, error));
    }
  }
}

(async () => {
  await dataSource.initialize();
  try {
    await testServiceRules();
    await testAssistantRules();
    await testRaces();
    console.log('cluster assignments: ok');
  } finally {
    await dataSource.destroy();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
