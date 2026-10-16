import type { EntityManager, QueryRunner } from 'typeorm';
import { DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
import { TechnologiesRelationsService } from '../technologies-relations.service';
import { TechnologiesService } from '../technologies.service';
import { TechnologyLinksService } from '../technology-links.service';
import { TechnologyReachService } from '../technology-reach.service';
import { seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Fixtures of the technology specs (lot S): the services wired with stubs where a dependency is out
// of the specs' reach (audit log, IT Ops settings, storage, FX rates, incidents), and a tenant built
// in raw SQL with the asset graph of the plan's examples.

export type AuditEntry = { table: string; recordId?: string | null; action?: string; before?: unknown; after?: unknown };

export function services(audit: AuditEntry[] = []) {
  const auditLog = { log: async (entry: AuditEntry) => void audit.push(entry) };
  const itOps = {
    getSettings: async () => ({
      technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES,
      lifecycleStates: [{ code: 'active' }, { code: 'retired' }],
      operatingSystems: [{ code: 'windows_server_2022', label: 'Windows Server 2022' }],
      cyberCriticalityLevels: [{ code: 'high' }],
      recoveryWaves: [{ code: 'wave_1' }],
    }),
  };
  const storage = { putObject: async () => undefined, deleteObject: async () => undefined };
  const reach = new TechnologyReachService();
  const fxRates = { resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }), convertValue: (a: number, r: number) => a * r };
  const incidents = { bulkReplaceTechnologies: async () => [] };
  return {
    reach,
    technologies: new TechnologiesService(auditLog as any, itOps as any, reach, storage as any),
    links: new TechnologyLinksService(auditLog as any, reach, itOps as any),
    relations: new TechnologiesRelationsService(auditLog as any, fxRates as any, incidents as any),
    catalog: new TechnologyCatalogService(auditLog as any, itOps as any),
  };
}

export async function one(runner: QueryRunner | EntityManager, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

export async function asset(runner: QueryRunner, tenantId: string, name: string, isCluster = false) {
  return one(runner, `INSERT INTO assets (tenant_id, name, kind, environment, is_cluster) VALUES ($1, $2, 'vm', 'prod', $3) RETURNING id`, [tenantId, name, isCluster]);
}

export async function contains(runner: QueryRunner, tenantId: string, container: string, content: string) {
  await runner.query(`INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'contains')`, [tenantId, container, content]);
}

export async function member(runner: QueryRunner, tenantId: string, cluster: string, node: string) {
  await runner.query(`INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, cluster, node]);
}

export async function technology(runner: QueryRunner, tenantId: string, number: number, name: string, family = 'other') {
  return one(runner, `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, $2, $3, $4) RETURNING id`, [tenantId, number, name, family]);
}

export async function version(runner: QueryRunner, tenantId: string, technologyId: string, label: string, end: string | null = null) {
  return one(runner, `INSERT INTO technology_versions (tenant_id, technology_id, label, standard_support_end) VALUES ($1, $2, $3, $4) RETURNING id`, [tenantId, technologyId, label, end]);
}

export async function installed(runner: QueryRunner, tenantId: string, assetId: string, technologyId: string, versionId: string | null = null, source = 'manual') {
  return one(runner, `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, source) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [tenantId, assetId, technologyId, versionId, source]);
}

export async function application(runner: QueryRunner, tenantId: string, name: string) {
  return one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
}

export async function assign(runner: QueryRunner, tenantId: string, appId: string, assetId: string, environment = 'prod') {
  const existing: Array<{ id: string }> = await runner.query(
    `SELECT id FROM app_instances WHERE tenant_id = $1 AND application_id = $2 AND environment = $3`, [tenantId, appId, environment],
  );
  const instance = existing[0]?.id ?? await one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, $3) RETURNING id`, [tenantId, appId, environment]);
  await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`, [tenantId, instance, assetId]);
}

/**
 * The plan's examples: two ESXi hosts in a vSphere cluster that contains a VM, a host that contains
 * another VM, a SQL cluster of two nodes with two SQL Server versions and an application on the
 * cluster, a chain deeper than the traversal, and a `contains` cycle.
 */
export async function seedGraph(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const a = (name: string, cluster = false) => asset(runner, tenantId, `${name} ${tag}`, cluster);
  const ids = {
    host1: await a('ESX-01'), host2: await a('ESX-02'), vsphereCluster: await a('VSPHERE-CL', true), vm1: await a('VM-01'), vm2: await a('VM-02'),
    sqlNode1: await a('SQL-01'), sqlNode2: await a('SQL-02'), sqlCluster: await a('SQL-CL', true),
    d1: await a('D1'), d2: await a('D2'), d3: await a('D3'), d4: await a('D4'), d5: await a('D5'),
    c1: await a('C1'), c2: await a('C2'),
  };
  await member(runner, tenantId, ids.vsphereCluster, ids.host1);
  await member(runner, tenantId, ids.vsphereCluster, ids.host2);
  await contains(runner, tenantId, ids.vsphereCluster, ids.vm2);
  await contains(runner, tenantId, ids.host1, ids.vm1);
  await member(runner, tenantId, ids.sqlCluster, ids.sqlNode1);
  await member(runner, tenantId, ids.sqlCluster, ids.sqlNode2);
  await contains(runner, tenantId, ids.d1, ids.d2);
  await contains(runner, tenantId, ids.d2, ids.d3);
  await contains(runner, tenantId, ids.d3, ids.d4);
  await contains(runner, tenantId, ids.d4, ids.d5);
  await contains(runner, tenantId, ids.c1, ids.c2);
  await contains(runner, tenantId, ids.c2, ids.c1);

  const vsphere = await technology(runner, tenantId, 1, 'vSphere', 'hypervisor');
  const v8 = await version(runner, tenantId, vsphere, '8.0', '2027-10-11');
  const sql = await technology(runner, tenantId, 2, 'SQL Server', 'database');
  const sql2019 = await version(runner, tenantId, sql, '2019', '2025-01-07');
  const sql2016 = await version(runner, tenantId, sql, '2016', '2021-07-13');
  const deep = await technology(runner, tenantId, 3, 'Deep', 'other');
  const loop = await technology(runner, tenantId, 4, 'Loop', 'other');
  const links = {
    host1: await installed(runner, tenantId, ids.host1, vsphere, v8),
    host2: await installed(runner, tenantId, ids.host2, vsphere, null, 'netbox'),
    sqlNode1: await installed(runner, tenantId, ids.sqlNode1, sql, sql2019),
    sqlNode2: await installed(runner, tenantId, ids.sqlNode2, sql, sql2016),
  };
  await installed(runner, tenantId, ids.d1, deep);
  await installed(runner, tenantId, ids.c1, loop);

  const erp = await application(runner, tenantId, `ERP ${tag}`);
  const portal = await application(runner, tenantId, `Portal ${tag}`);
  await assign(runner, tenantId, erp, ids.sqlCluster);
  await assign(runner, tenantId, portal, ids.vm2, 'prod');
  await runner.query(`INSERT INTO application_technologies (tenant_id, application_id, technology_id) VALUES ($1, $2, $3)`, [tenantId, portal, sql]);
  return { tenantId, ids, tech: { vsphere, sql, deep, loop }, versions: { v8, sql2019, sql2016 }, links, apps: { erp, portal } };
}
