// @database-spec
import 'dotenv/config';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologyReachService } from '../../technologies/technology-reach.service';
import { application, asset, assign, contains, installed, member, one, technology, version } from '../../technologies/__tests__/technologies.fixtures';
import { AssetImpactService, type ImpactContext } from '../services/asset-impact.service';
import type { QueryRunner } from 'typeorm';

// "If this server goes down" (lot T5) against a real database, in transactions rolled back at the
// end: a host and its VMs, a dependency, degraded and down clusters, a `contains` cycle, the depth
// limit, applications out of service, the read rights, and tenant isolation.

const service = () => new AssetImpactService(new TechnologyReachService());

async function dependsOn(runner: QueryRunner, tenantId: string, dependant: string, dependedOn: string) {
  await runner.query(`INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'depends_on')`, [tenantId, dependant, dependedOn]);
}

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const a = (name: string, cluster = false) => asset(runner, tenantId, name, cluster);
  const ids = {
    host: await a('ESX-01'), host2: await a('ESX-02'), vm1: await a('VM-01'), vm2: await a('VM-02'), web: await a('WEB-01'),
    webVm: await a('WEB-VM'), rack: await a('RACK-01'), vsphereCl: await a('VSPHERE-CL', true), solo: await a('SOLO-CL', true),
    d1: await a('D1'), d2: await a('D2'), d3: await a('D3'), d4: await a('D4'), d5: await a('D5'), c1: await a('C1'), c2: await a('C2'),
  };
  // The rack holds the host; the host holds two VMs; WEB-01 depends on VM-01 and holds WEB-VM.
  await contains(runner, tenantId, ids.rack, ids.host);
  await contains(runner, tenantId, ids.host, ids.vm1);
  await contains(runner, tenantId, ids.host, ids.vm2);
  await dependsOn(runner, tenantId, ids.web, ids.vm1);
  await contains(runner, tenantId, ids.web, ids.webVm);
  // The vSphere cluster keeps ESX-02; the solo cluster has the host as its only member.
  await member(runner, tenantId, ids.vsphereCl, ids.host);
  await member(runner, tenantId, ids.vsphereCl, ids.host2);
  await member(runner, tenantId, ids.solo, ids.host);
  for (const [from, to] of [[ids.d1, ids.d2], [ids.d2, ids.d3], [ids.d3, ids.d4], [ids.d4, ids.d5], [ids.c1, ids.c2], [ids.c2, ids.c1]]) {
    await contains(runner, tenantId, from, to);
  }

  const vsphere = await technology(runner, tenantId, 1, 'vSphere', 'hypervisor');
  const v8 = await version(runner, tenantId, vsphere, '8.0');
  const sql = await technology(runner, tenantId, 2, 'SQL Server', 'database');
  const firmware = await technology(runner, tenantId, 3, 'Rack firmware', 'other');
  await installed(runner, tenantId, ids.host, vsphere, v8);
  await installed(runner, tenantId, ids.vm1, sql);
  await installed(runner, tenantId, ids.rack, firmware);

  const apps = {
    erp: await application(runner, tenantId, 'ERP'), crm: await application(runner, tenantId, 'CRM'),
    portal: await application(runner, tenantId, 'Portal'), backup: await application(runner, tenantId, 'Backup'),
    other: await application(runner, tenantId, 'Other'),
  };
  await assign(runner, tenantId, apps.erp, ids.vm1, 'prod');
  await assign(runner, tenantId, apps.erp, ids.vm2, 'prod');
  await assign(runner, tenantId, apps.crm, ids.vm2, 'dev');
  await assign(runner, tenantId, apps.portal, ids.webVm, 'prod');
  await assign(runner, tenantId, apps.backup, ids.solo, 'prod');
  await assign(runner, tenantId, apps.other, ids.vsphereCl, 'prod');

  const finance = await one(runner, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Finance') RETURNING id`, [tenantId]);
  const sales = await one(runner, `INSERT INTO business_processes (tenant_id, name, status, disabled_at) VALUES ($1, 'Sales', 'disabled', now() - interval '1 day') RETURNING id`, [tenantId]);
  for (const [app, process] of [[apps.erp, finance], [apps.portal, finance], [apps.crm, sales]]) {
    await runner.query(`INSERT INTO application_business_processes (tenant_id, application_id, business_process_id) VALUES ($1, $2, $3)`, [tenantId, app, process]);
  }
  return { tenantId, ids, apps, tech: { vsphere, sql, firmware }, processes: { finance, sales } };
}

const ctxOf = (runner: QueryRunner, tenantId: string, over: Partial<ImpactContext> = {}): ImpactContext => ({
  manager: runner.manager, tenantId, applications: {}, processes: true, ...over,
});

async function testHostVmsAndDependency() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'impact-host');
    const impact = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId));
    assert.equal(impact.asset.id, g.ids.host);
    assert.deepEqual(
      impact.assets.map((row) => `${row.name}|${row.depth}|${row.relation ?? '-'}|${row.via.map((v) => v.name).join('>')}`),
      ['ESX-01|0|-|', 'VM-01|1|contains|ESX-01', 'VM-02|1|contains|ESX-01', 'WEB-01|2|depends_on|ESX-01>VM-01', 'WEB-VM|3|contains|ESX-01>VM-01>WEB-01'],
      'the host, its VMs, the dependant of a VM and what the dependant holds; never the rack above',
    );
    assert.ok(impact.assets.every((row) => row.reference?.startsWith('AST-')), 'assets carry their reference');
    assert.deepEqual(
      impact.applications!.map((row) => `${row.name}|${row.environment}|${row.via.map((v) => v.name).join(',')}`),
      ['Backup|prod|SOLO-CL', 'CRM|dev|VM-02', 'ERP|prod|VM-01,VM-02', 'Portal|prod|WEB-VM'],
      'one row per application and environment; the application of a degraded cluster stands',
    );
    assert.deepEqual(
      impact.technologies.map((row) => `${row.reference}|${row.name}|${row.versions.join(',')}|${row.via.map((v) => v.name).join(',')}`),
      ['TEC-2|SQL Server||VM-01', 'TEC-1|vSphere|8.0|ESX-01'],
      'installed on a fallen asset only: the rack firmware stands',
    );
    assert.deepEqual(impact.processes!.map((row) => `${row.name}|${row.via.map((v) => v.name).join(',')}`), ['Finance|ERP,Portal'], 'a disabled process is left out');
  });
}

async function testClusters() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'impact-clusters');
    const impact = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId));
    assert.deepEqual(
      impact.clusters.map((row) => `${row.name}|${row.state}|${row.fallen_members}/${row.members}|${row.via.map((v) => v.name).join(',')}`),
      ['SOLO-CL|down|1/1|ESX-01', 'VSPHERE-CL|degraded|1/2|ESX-01'],
    );
    // Both hosts down: the vSphere cluster is down too, and its application falls.
    const both = await service().impactOf(g.ids.host2, ctxOf(runner, g.tenantId));
    assert.deepEqual(both.clusters.map((row) => `${row.name}|${row.state}`), ['VSPHERE-CL|degraded']);
    await contains(runner, g.tenantId, g.ids.host, g.ids.host2);
    const all = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId));
    assert.deepEqual(all.clusters.map((row) => `${row.name}|${row.state}|${row.fallen_members}/${row.members}`), ['SOLO-CL|down|1/1', 'VSPHERE-CL|down|2/2']);
    assert.ok(all.applications!.some((row) => row.id === g.apps.other && row.via[0]?.name === 'VSPHERE-CL'), 'an application on a cluster that is down falls');
  });
}

async function testCycleAndDepth() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'impact-depth');
    const cycle = await service().impactOf(g.ids.c1, ctxOf(runner, g.tenantId));
    assert.deepEqual(cycle.assets.map((row) => row.name), ['C1', 'C2'], 'A contains B contains A stops');
    const deep = await service().impactOf(g.ids.d1, ctxOf(runner, g.tenantId));
    assert.deepEqual(deep.assets.map((row) => row.name), ['D1', 'D2', 'D3', 'D4'], 'D5 is four edges away');
    assert.deepEqual([deep.clusters, deep.applications, deep.technologies, deep.processes], [[], [], [], []], 'nothing else falls');
  });
}

async function testOutOfService() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'impact-disabled');
    await runner.query(`UPDATE applications SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE id = $1`, [g.apps.crm]);
    await runner.query(`UPDATE app_instances SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE application_id = $1`, [g.apps.portal]);
    const impact = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId));
    assert.deepEqual(impact.applications!.map((row) => row.name), ['Backup', 'ERP'], 'a disabled application or instance is left out');
    assert.deepEqual(impact.processes!.map((row) => `${row.name}|${row.via.map((v) => v.name).join(',')}`), ['Finance|ERP']);
  });
}

async function testRights() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'impact-rights');
    const noApps = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId, { applications: null }));
    assert.equal(noApps.applications, null);
    assert.equal(noApps.processes, null, 'processes come from the applications the caller reads');
    assert.equal(noApps.assets.length, 5, 'the infrastructure stays visible');
    const noProcesses = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId, { processes: false }));
    assert.equal(noProcesses.processes, null);
    assert.equal(noProcesses.applications!.length, 4);
    // A Business Contributor sees the applications it takes part in only.
    const outsider = '00000000-0000-4000-8000-000000000000';
    const scoped = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId, { applications: { scope: { userId: outsider } } }));
    assert.deepEqual(scoped.applications, []);
    assert.deepEqual(scoped.processes, []);
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'impact-iso-a');
    const b = await seed(runner, 'impact-iso-b');
    await setTenant(runner, b.tenantId);
    await assert.rejects(service().impactOf(a.ids.host, ctxOf(runner, b.tenantId)), /Asset not found/, 'the tenant predicate');
    await assert.rejects(service().impactOf(a.ids.host, ctxOf(runner, a.tenantId)), /Asset not found/, 'RLS hides tenant A even when named');
    await assert.rejects(service().impactOf('not-a-uuid', ctxOf(runner, b.tenantId)), /Asset not found/);
    const own = await service().impactOf(b.ids.host, ctxOf(runner, b.tenantId));
    assert.equal(own.assets.length, 5);
  });
}

runSpecs('asset-impact.integration.spec', [
  ['host, VMs and a dependency', testHostVmsAndDependency],
  ['degraded and down clusters', testClusters],
  ['cycle and depth', testCycleAndDepth],
  ['applications out of service', testOutOfService],
  ['read rights', testRights],
  ['tenant isolation', testTenantIsolation],
]);
