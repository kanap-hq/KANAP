// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { Asset } from '../asset.entity';
import { AssetClusterMember } from '../asset-cluster-member.entity';
import { assetCsvConfig } from '../asset-csv.config';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { AiBusinessRecordMutationSupportService } from '../../ai/mutation/ai-business-record-mutation-support.service';
import { AiRelationMutationSupportService } from '../../ai/mutation/ai-relation-mutation-support.service';
import { AiTaskMutationSupportService } from '../../ai/mutation/ai-task-mutation-support.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import type { CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES, ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../../technologies/catalog/technology-catalog.service';
import { OperatingSystemService } from '../../technologies/operating-system.service';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsService } from '../services/assets.service';
import { AssetsValidationService } from '../services/assets-validation.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { asset, member } from '../../technologies/__tests__/technologies.fixtures';

// The cluster rules (lot A1 of the clusters pass), against a real database:
// - the Cluster switch: a cluster with members stays a cluster, a member stays a plain asset, by
//   the service, the assistant and the CSV import; the switch keeps the operating system;
// - the members: coded refusals, and a cluster that carries an operating system gets members only
//   with `remove_operating_system`, which removes it in the same transaction;
// - the operating system: refused on a cluster with members, accepted on one without, clearing
//   always accepted.

type AuditEntry = { table: string; recordId?: string | null; action?: string; before?: any; after?: any };

function operatingSystems(audit: { log: (entry: AuditEntry) => Promise<void> }) {
  const itOps = { getSettings: async () => ({ technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, hostingTypes: DEFAULT_HOSTING_TYPES }) };
  return new OperatingSystemService(audit as any, itOps as any, new TechnologyCatalogService(audit as any, itOps as any));
}

function services(runner: QueryRunner, failOn?: (entry: AuditEntry) => boolean) {
  const entries: AuditEntry[] = [];
  const audit = {
    log: async (entry: AuditEntry) => {
      if (failOn?.(entry)) throw new Error(`audit refused for ${entry.table}`);
      entries.push(entry);
    },
  };
  const settings = new ItOpsSettingsService(runner.manager.getRepository(Tenant), runner.manager.getRepository(Location), audit as any);
  const os = operatingSystems(audit);
  const crud = new AssetsCrudService(
    runner.manager.getRepository(Asset),
    runner.manager.getRepository(AssetClusterMember),
    audit as any,
    new AssetsValidationService(settings),
    { notify: async () => undefined } as any,
    os,
  );
  return { entries, os, crud };
}

/** The code and params of a coded refusal, run under a savepoint so the transaction stays usable. */
async function refusal(runner: QueryRunner, fn: () => Promise<unknown>): Promise<{ code?: string; params?: unknown; status?: number }> {
  await runner.query('SAVEPOINT spec_refusal');
  try {
    await fn();
  } catch (error: any) {
    await runner.query('ROLLBACK TO SAVEPOINT spec_refusal');
    const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return { code: response?.code, params: response?.params, status: typeof error?.getStatus === 'function' ? error.getStatus() : undefined };
  }
  await runner.query('RELEASE SAVEPOINT spec_refusal');
  throw new Error('expected a refusal');
}

async function giveOs(runner: QueryRunner, os: OperatingSystemService, tenantId: string, assetId: string, label = 'Ubuntu 22.04') {
  const resolved = await os.resolve(runner.manager, tenantId, label, { create: true });
  await os.setOperatingSystem(runner.manager, tenantId, assetId, resolved, 'manual');
}

async function members(runner: QueryRunner, tenantId: string, clusterId: string): Promise<string[]> {
  const rows: Array<{ asset_id: string }> = await runner.query(
    `SELECT asset_id FROM asset_cluster_members WHERE tenant_id = $1 AND cluster_id = $2 ORDER BY asset_id`,
    [tenantId, clusterId],
  );
  return rows.map((row) => row.asset_id);
}

async function isCluster(runner: QueryRunner, tenantId: string, assetId: string): Promise<boolean> {
  const [row] = await runner.query(`SELECT is_cluster FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, assetId]);
  return row.is_cluster;
}

async function testSwitch() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cl-switch');
    const { crud, os } = services(runner);
    const opts = { manager: runner.manager, tenantId };
    const cluster = await asset(runner, tenantId, 'esx-cluster', true);
    const other = await asset(runner, tenantId, 'aaa-cluster', true);
    const node = await asset(runner, tenantId, 'esx-01');
    await member(runner, tenantId, cluster, node);
    await member(runner, tenantId, other, node);

    assert.deepEqual(await refusal(runner, () => crud.update(cluster, { is_cluster: false } as any, tenantId, null, opts)), {
      code: 'cluster_has_members', params: { count: 1 }, status: 400,
    });
    assert.equal(await isCluster(runner, tenantId, cluster), true);
    // The first cluster by name.
    assert.deepEqual(await refusal(runner, () => crud.update(node, { is_cluster: true } as any, tenantId, null, opts)), {
      code: 'cluster_switch_member', params: { cluster: 'aaa-cluster' }, status: 400,
    });
    assert.equal(await isCluster(runner, tenantId, node), false);

    // The assistant writes through the same service, so it meets the same refusal.
    const assets = new AssetsService(undefined as any, crud, undefined as any, undefined as any, undefined as any, undefined as any);
    const assistant = new AiBusinessRecordMutationSupportService(
      undefined as any, assets, undefined as any, undefined as any, undefined as any, undefined as any,
      undefined as any, undefined as any, undefined as any, undefined as any, undefined as any,
      {} as any, {} as any, {} as any,
    );
    const context = { manager: runner.manager, tenantId, userId: null };
    assert.equal((await refusal(runner, () => (assistant as any).updateRecord(context, 'assets', node, { is_cluster: true }))).code, 'cluster_switch_member');
    assert.equal((await refusal(runner, () => (assistant as any).updateRecord(context, 'assets', cluster, { is_cluster: false }))).code, 'cluster_has_members');

    // The switch keeps the operating system, both ways.
    const plain = await asset(runner, tenantId, 'aws-asg');
    await giveOs(runner, os, tenantId, plain, 'Amazon Linux 2023');
    const switched = await crud.update(plain, { is_cluster: true } as any, tenantId, null, opts);
    assert.equal(switched.is_cluster, true);
    assert.equal(await os.labelOf(runner.manager, tenantId, plain), 'Amazon Linux 2023');
    const back = await crud.update(plain, { is_cluster: false } as any, tenantId, null, opts);
    assert.equal(back.is_cluster, false);
    assert.equal(await os.labelOf(runner.manager, tenantId, plain), 'Amazon Linux 2023');

    // A new cluster is a member of nothing: created with its operating system.
    const siteId = randomUUID();
    await runner.query(`INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-0', 'Site', 'on_prem')`, [siteId, tenantId]);
    const created = await crud.create(
      { name: 'new-asg', kind: 'physical_server', provider: 'other', environment: 'prod', is_cluster: true, operating_system: 'Ubuntu 22.04', location_id: siteId } as any,
      tenantId, null, opts,
    );
    assert.equal(created.is_cluster, true);
    assert.equal(created.operating_system, 'Ubuntu 22.04');
  });
}

async function testMembers() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cl-members');
    const { crud, os, entries } = services(runner);
    const opts = { manager: runner.manager, tenantId };
    const cluster = await asset(runner, tenantId, 'k8s', true);
    const otherCluster = await asset(runner, tenantId, 'vsphere', true);
    const node1 = await asset(runner, tenantId, 'node-1');
    const node2 = await asset(runner, tenantId, 'node-2');
    const elsewhere = await seedTenant(runner, 'cl-members-b');
    const foreign = await asset(runner, elsewhere, 'foreign');
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    const replace = (ids: unknown, options?: { removeOperatingSystem?: unknown }, svc = crud) =>
      svc.replaceClusterMembers(cluster, ids, tenantId, null, opts, options);
    assert.equal((await refusal(runner, () => replace([node1, cluster]))).code, 'cluster_member_self');
    assert.equal((await refusal(runner, () => replace([node1, randomUUID()]))).code, 'cluster_member_not_found');
    assert.equal((await refusal(runner, () => replace([node1, 'not-an-id']))).code, 'cluster_member_not_found');
    assert.equal((await refusal(runner, () => replace([foreign]))).code, 'cluster_member_not_found');
    assert.deepEqual(await refusal(runner, () => replace([node1, otherCluster])), {
      code: 'cluster_member_is_cluster', params: { name: 'vsphere' }, status: 400,
    });
    assert.equal((await refusal(runner, () => replace([node1], { removeOperatingSystem: 'yes' }))).status, 400);
    assert.deepEqual(await members(runner, tenantId, cluster), []);

    // A cluster that carries an operating system gets no member without the flag.
    await giveOs(runner, os, tenantId, cluster);
    assert.deepEqual(await refusal(runner, () => replace([node1])), {
      code: 'cluster_os_with_members', params: { os: 'Ubuntu 22.04' }, status: 400,
    });
    assert.deepEqual(await members(runner, tenantId, cluster), []);
    assert.equal(await os.labelOf(runner.manager, tenantId, cluster), 'Ubuntu 22.04');

    // An empty list is always accepted and keeps the operating system, the flag included.
    await replace([], { removeOperatingSystem: true });
    assert.equal(await os.labelOf(runner.manager, tenantId, cluster), 'Ubuntu 22.04');

    // A failure after the removal leaves nothing: the operating system is still there, no member.
    const failing = services(runner, (entry) => entry.table === 'asset_cluster_members').crud;
    await refusal(runner, () => replace([node1], { removeOperatingSystem: true }, failing)).catch(() => undefined);
    assert.equal(await os.labelOf(runner.manager, tenantId, cluster), 'Ubuntu 22.04');
    assert.deepEqual(await members(runner, tenantId, cluster), []);

    // With the flag: the operating system goes (its own audit), then the members are written.
    entries.length = 0;
    const listed = await replace([node1, node2], { removeOperatingSystem: true });
    assert.deepEqual(listed.items.map((item) => item.name), ['node-1', 'node-2']);
    assert.equal(await os.labelOf(runner.manager, tenantId, cluster), null);
    assert.deepEqual(await members(runner, tenantId, cluster), [node1, node2].sort());
    assert.deepEqual(entries.map((entry) => `${entry.table}:${entry.action}`), ['asset_technologies:delete', 'asset_cluster_members:update']);
    const memberAudit = entries[1];
    assert.equal(memberAudit.recordId, cluster);
    assert.deepEqual(memberAudit.before, { members: [] });
    assert.deepEqual([...memberAudit.after.members].sort(), [node1, node2].sort());

    // A cluster with no operating system: the flag changes nothing.
    await replace([node1], { removeOperatingSystem: true });
    assert.deepEqual(await members(runner, tenantId, cluster), [node1]);
  });
}

async function testOperatingSystem() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cl-os');
    const { os } = services(runner);
    const mg = runner.manager;
    const withMembers = await asset(runner, tenantId, 'cl-full', true);
    const empty = await asset(runner, tenantId, 'cl-empty', true);
    const node = await asset(runner, tenantId, 'node');
    await member(runner, tenantId, withMembers, node);
    const ubuntu = await os.resolve(mg, tenantId, 'Ubuntu 22.04', { create: true });

    assert.deepEqual(await refusal(runner, () => os.setOperatingSystem(mg, tenantId, withMembers, ubuntu, 'manual')), {
      code: 'os_cluster_with_members', params: undefined, status: 400,
    });
    assert.equal(await os.labelOf(mg, tenantId, withMembers), null);
    // The body of PUT /assets/:id/operating-system goes through the same write.
    assert.equal((await refusal(runner, () => os.setFromBody(mg, tenantId, withMembers, { technology_id: ubuntu!.technology_id }, 'manual'))).code, 'os_cluster_with_members');

    assert.equal((await os.setOperatingSystem(mg, tenantId, empty, ubuntu, 'manual')).changed, true);
    assert.equal(await os.labelOf(mg, tenantId, empty), 'Ubuntu 22.04');
    assert.equal((await os.setOperatingSystem(mg, tenantId, node, ubuntu, 'manual')).changed, true);

    // Clearing is always accepted, also on a cluster with members (data from before the rule).
    await runner.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, is_operating_system, source)
       VALUES ($1, $2, $3, $4, true, 'manual')`,
      [tenantId, withMembers, ubuntu!.technology_id, ubuntu!.technology_version_id],
    );
    assert.equal((await os.setOperatingSystem(mg, tenantId, withMembers, null, 'manual')).changed, true);
    assert.equal(await os.labelOf(mg, tenantId, withMembers), null);
  });
}

async function testAssistantMembers() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cl-ai');
    const { os, entries } = services(runner);
    const cluster = await asset(runner, tenantId, 'ai-cluster', true);
    const otherCluster = await asset(runner, tenantId, 'ai-other', true);
    const plain = await asset(runner, tenantId, 'ai-plain');
    const node1 = await asset(runner, tenantId, 'ai-node-1');
    const node2 = await asset(runner, tenantId, 'ai-node-2');
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const audit = { log: async (entry: AuditEntry) => { entries.push(entry); } };
    const rel = new AiRelationMutationSupportService(audit as any, undefined as any, new AiTaskMutationSupportService(), undefined as any);
    const context: any = { manager: runner.manager, tenantId, userId: null };
    const prepare = (ref: string, change: { add?: string[]; remove?: string[] }) =>
      rel.prepareUpdatePreview(context, { entity_type: 'assets', ref, relation: 'cluster_members', ...change });
    const execute = async (prepared: Awaited<ReturnType<typeof prepare>>) =>
      rel.executePreview(context, {
        id: randomUUID(), target_entity_type: 'assets', target_entity_id: prepared.targetEntityId,
        mutation_input: prepared.mutationInput, current_values: prepared.currentValues,
      } as any);

    // The same refusals as the members endpoint.
    assert.equal((await refusal(runner, () => prepare(cluster, { add: [cluster] }))).code, 'cluster_member_self');
    assert.deepEqual(await refusal(runner, () => prepare(cluster, { add: [otherCluster] })), {
      code: 'cluster_member_is_cluster', params: { name: 'ai-other' }, status: 400,
    });
    assert.equal((await refusal(runner, () => prepare(plain, { add: [node1] }))).status, 400);
    assert.deepEqual(await members(runner, tenantId, plain), []);

    // A cluster with an operating system gets no member: the assistant has no removal flag.
    await giveOs(runner, os, tenantId, cluster);
    assert.deepEqual(await refusal(runner, () => prepare(cluster, { add: [node1] })), {
      code: 'cluster_os_with_members', params: { os: 'Ubuntu 22.04' }, status: 400,
    });
    // Checked again at execution: the operating system came after the preview.
    await os.setOperatingSystem(runner.manager, tenantId, cluster, null, 'manual');
    const preview = await prepare(cluster, { add: [node1, node2] });
    await giveOs(runner, os, tenantId, cluster);
    assert.equal((await refusal(runner, () => execute(preview))).code, 'cluster_os_with_members');
    assert.deepEqual(await members(runner, tenantId, cluster), []);
    assert.equal(await os.labelOf(runner.manager, tenantId, cluster), 'Ubuntu 22.04');

    // Without an operating system the members are written, with the assistant's audit.
    await os.setOperatingSystem(runner.manager, tenantId, cluster, null, 'manual');
    entries.length = 0;
    await execute(await prepare(cluster, { add: [node1, node2] }));
    assert.deepEqual(await members(runner, tenantId, cluster), [node1, node2].sort());
    assert.deepEqual(entries.map((entry) => `${entry.table}:${entry.action}`), ['asset_cluster_members:update']);

    // Removing a member stays allowed, also on a cluster that carries an operating system (old data).
    const ubuntu = await os.resolve(runner.manager, tenantId, 'Ubuntu 22.04', { create: true });
    await runner.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, is_operating_system, source)
       VALUES ($1, $2, $3, $4, true, 'manual')`,
      [tenantId, cluster, ubuntu!.technology_id, ubuntu!.technology_version_id],
    );
    await execute(await prepare(cluster, { remove: [node2] }));
    assert.deepEqual(await members(runner, tenantId, cluster), [node1]);
  });
}

const csvSettings: any = {
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [],
  adminZones: [],
  ipAddressTypes: [],
  technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES,
  hostingTypes: DEFAULT_HOSTING_TYPES,
};
const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());

function csvFile(content: string): Express.Multer.File {
  const text = '﻿' + content;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'assets.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

function importCsv(runner: QueryRunner, tenantId: string, csv: string, params: Partial<CsvImportParams>): Promise<CsvImportResult> {
  return importer.import(assetCsvConfig, csvFile(csv), { dryRun: true, mode: 'enrich', operation: 'upsert', ...params }, {
    manager: runner.manager, tenantId, userId: null, isAdmin: true, itOpsSettings: csvSettings,
  });
}

async function testCsv() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'cl-csv');
    const { os } = services(runner);
    const locationId = randomUUID();
    await runner.query(
      `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
      [locationId, tenantId],
    );
    const cluster = await asset(runner, tenantId, 'cl-a', true);
    const node = await asset(runner, tenantId, 'node-a');
    const plain = await asset(runner, tenantId, 'plain-a');
    await member(runner, tenantId, cluster, node);
    await runner.query(`UPDATE assets SET location_id = $2, provider = 'on_prem' WHERE tenant_id = $1`, [tenantId, locationId]);

    const header = 'name;location_reference;kind;environment;is_cluster';
    for (const dryRun of [true, false]) {
      const leaving = await importCsv(runner, tenantId, `${header}\ncl-a;LOC-1;vm;prod;no`, { dryRun });
      assert.equal(leaving.ok, false);
      assert.deepEqual(leaving.errors.map((e) => [e.row, e.column, e.code, e.params]), [[2, 'is_cluster', 'cluster_has_members', { count: 1 }]]);
      const joining = await importCsv(runner, tenantId, `${header}\nnode-a;LOC-1;vm;prod;yes`, { dryRun });
      assert.deepEqual(joining.errors.map((e) => [e.column, e.code, e.params]), [['is_cluster', 'cluster_switch_member', { cluster: 'cl-a' }]]);
      const withOs = await importCsv(runner, tenantId, `${header};operating_system\ncl-a;LOC-1;vm;prod;yes;Ubuntu 22.04`, { dryRun });
      assert.deepEqual(withOs.errors.map((e) => [e.column, e.code]), [['operating_system', 'os_cluster_with_members']]);
      assert.equal(await isCluster(runner, tenantId, cluster), true);
      assert.equal(await isCluster(runner, tenantId, node), false);
      assert.equal(await os.labelOf(runner.manager, tenantId, cluster), null);
    }

    // A plain asset that is a member of nothing becomes a cluster; an empty operating-system cell clears.
    const ok = await importCsv(runner, tenantId, `${header};operating_system\nplain-a;LOC-1;vm;prod;yes;\ncl-a;LOC-1;vm;prod;yes;`, { dryRun: false });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.equal(await isCluster(runner, tenantId, plain), true);
  });
}

runSpecs('assets-cluster-rules.integration.spec.ts', [
  ['the Cluster switch: service, assistant, operating system kept', testSwitch],
  ['the members: coded refusals and the operating-system rule', testMembers],
  ['the operating system of a cluster', testOperatingSystem],
  ['the assistant adds cluster members under the same rules', testAssistantMembers],
  ['the CSV import: row errors at the check and at the load', testCsv],
]);
