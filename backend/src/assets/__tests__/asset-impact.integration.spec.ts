// @database-spec
import 'dotenv/config';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { application, asset, assign, contains, installed, member, one, technology, version } from '../../technologies/__tests__/technologies.fixtures';
import { AssetImpactService, IMPACT_ROW_LIMIT, IMPACT_VIA_LIMIT, type ImpactContext } from '../services/asset-impact.service';
import type { QueryRunner } from 'typeorm';

// "If this server goes down" (lot T5) against a real database, in transactions rolled back at the
// end: a host and its VMs, a dependency, a diamond, degraded and down clusters, a `contains` cycle,
// the depth limits, the row cap, applications out of service, retired assets, the read rights, and tenant isolation.
// Clusters (passe clusters, lot A3a): a cluster takes its members in service (`member`); a cluster
// down with all its members takes the VMs it contains; a degraded one takes nothing.

const service = () => new AssetImpactService();

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
    e0: await a('E0'), e1: await a('E1'), e2: await a('E2'), e3: await a('E3'), e4: await a('E4'),
  };
  // E1 depends on E0, E2 on E1, and so on: four `depends_on` edges from E0 to E4.
  for (const [dependant, dependedOn] of [[ids.e1, ids.e0], [ids.e2, ids.e1], [ids.e3, ids.e2], [ids.e4, ids.e3]]) {
    await dependsOn(runner, tenantId, dependant, dependedOn);
  }
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
      impact.applications!.map((row) => `${row.name}|${row.environments.join(',')}|${row.via.map((v) => v.name).join(',')}`),
      ['Backup|prod|SOLO-CL', 'CRM|dev|VM-02', 'ERP|prod|VM-01,VM-02', 'Portal|prod|WEB-VM'],
      'one row per application; the application of a degraded cluster stands',
    );
    assert.deepEqual(impact.totals, { assets: 4, applications: 4, clusters: 2, technologies: 2, processes: 1 });
    assert.deepEqual(
      impact.technologies.map((row) => `${row.reference}|${row.name}|${row.versions.join(',')}|${row.via.map((v) => v.name).join(',')}`),
      ['TEC-2|SQL Server||VM-01', 'TEC-1|vSphere|8.0|ESX-01'],
      'installed on a fallen asset only: the rack firmware stands',
    );
    assert.deepEqual(impact.processes!.map((row) => `${row.name}|${row.via.map((v) => v.name).join(',')}`), ['Finance|ERP,Portal'], 'a disabled process is left out');
    // A diamond: WEB-01 depends on both VMs of the host, two paths of the same length; listed once.
    await dependsOn(runner, g.tenantId, g.ids.web, g.ids.vm2);
    const diamond = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId));
    assert.equal(diamond.assets.filter((row) => row.id === g.ids.web).length, 1);
    assert.equal(diamond.totals.assets, 4);
    assert.equal(diamond.applications!.filter((row) => row.name === 'Portal').length, 1);
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

async function testClusterFalls() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'impact-cluster-falls');
    const a = (name: string, cluster = false) => asset(runner, g.tenantId, name, cluster);
    const ids = { bay: await a('BAY-01'), n1: await a('NODE-A'), n2: await a('NODE-B'), old: await a('NODE-OLD'), cl: await a('PROD-CL', true), vm: await a('CL-VM') };
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [g.tenantId, ids.old]);
    for (const node of [ids.n1, ids.n2, ids.old]) await member(runner, g.tenantId, ids.cl, node);
    // Both nodes depend on the bay; the cluster holds a VM.
    await dependsOn(runner, g.tenantId, ids.n1, ids.bay);
    await dependsOn(runner, g.tenantId, ids.n2, ids.bay);
    await contains(runner, g.tenantId, ids.cl, ids.vm);
    const apps = {
      a: await application(runner, g.tenantId, 'App A'), b: await application(runner, g.tenantId, 'App B'),
      cl: await application(runner, g.tenantId, 'App CL'), vm: await application(runner, g.tenantId, 'App VM'), old: await application(runner, g.tenantId, 'App Old'),
    };
    await assign(runner, g.tenantId, apps.a, ids.n1, 'prod');
    await assign(runner, g.tenantId, apps.b, ids.n2, 'prod');
    await assign(runner, g.tenantId, apps.cl, ids.cl, 'prod');
    await assign(runner, g.tenantId, apps.vm, ids.vm, 'prod');
    await assign(runner, g.tenantId, apps.old, ids.old, 'prod');
    const line = (row: { name: string; depth: number; relation: string | null; via: Array<{ name: string }> }) =>
      `${row.name}|${row.depth}|${row.relation ?? '-'}|${row.via.map((v) => v.name).join('>')}`;

    // The cluster falls: its members in service, what it holds, their applications and its own.
    const cluster = await service().impactOf(ids.cl, ctxOf(runner, g.tenantId));
    assert.deepEqual(
      cluster.assets.map(line),
      ['PROD-CL|0|-|', 'CL-VM|1|contains|PROD-CL', 'NODE-A|1|member|PROD-CL', 'NODE-B|1|member|PROD-CL'],
      'the members in service fall with the cluster; the retired member is not taken',
    );
    assert.deepEqual(cluster.applications!.map((row) => `${row.name}|${row.via.map((v) => v.name).join(',')}`), ['App A|NODE-A', 'App B|NODE-B', 'App CL|PROD-CL', 'App VM|CL-VM']);
    assert.deepEqual(cluster.clusters, [], 'the cluster is the server row, not a cluster row');

    // The bay takes both nodes: the cluster goes down, and takes its VM and its application (K2-3).
    const bay = await service().impactOf(ids.bay, ctxOf(runner, g.tenantId));
    assert.deepEqual(
      bay.assets.map(line),
      ['BAY-01|0|-|', 'NODE-A|1|depends_on|BAY-01', 'NODE-B|1|depends_on|BAY-01', 'CL-VM|3|contains|BAY-01>NODE-A>PROD-CL'],
    );
    assert.deepEqual(bay.clusters.map((row) => `${row.name}|${row.state}|${row.fallen_members}/${row.members}`), ['PROD-CL|down|2/2']);
    assert.deepEqual(bay.applications!.map((row) => row.name), ['App A', 'App B', 'App CL', 'App VM']);
    assert.equal(bay.totals.assets, 3, 'the cluster down is listed in clusters, not in assets');

    // One node only: the cluster is degraded, its VM and its application stand.
    const single = await service().impactOf(ids.n1, ctxOf(runner, g.tenantId));
    assert.deepEqual(single.assets.map(line), ['NODE-A|0|-|']);
    assert.deepEqual(single.clusters.map((row) => `${row.name}|${row.state}|${row.fallen_members}/${row.members}`), ['PROD-CL|degraded|1/2']);
    assert.deepEqual(single.applications!.map((row) => row.name), ['App A']);
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
    const chain = await service().impactOf(g.ids.e0, ctxOf(runner, g.tenantId));
    assert.deepEqual(chain.assets.map((row) => `${row.name}|${row.relation ?? '-'}`), ['E0|-', 'E1|depends_on', 'E2|depends_on', 'E3|depends_on'], 'E4 is four dependencies away');
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

async function testRetiredAssets() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'impact-retired');
    const a = (name: string, cluster = false) => asset(runner, g.tenantId, name, cluster);
    const ids = { host: await a('R-HOST'), old: await a('OLD-VM'), live: await a('LIVE-VM'), dep: await a('OLD-DEP'), pair: await a('PAIR-CL', true) };
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [g.tenantId, ids.old]);
    // The host holds a retired VM and a VM in service; OLD-DEP depends on the retired VM; the pair has both VMs.
    await contains(runner, g.tenantId, ids.host, ids.old);
    await contains(runner, g.tenantId, ids.host, ids.live);
    await dependsOn(runner, g.tenantId, ids.dep, ids.old);
    await member(runner, g.tenantId, ids.pair, ids.old);
    await member(runner, g.tenantId, ids.pair, ids.live);
    await installed(runner, g.tenantId, ids.old, g.tech.firmware);
    const legacy = await application(runner, g.tenantId, 'Legacy');
    const live = await application(runner, g.tenantId, 'Live');
    await assign(runner, g.tenantId, legacy, ids.old, 'prod');
    await assign(runner, g.tenantId, live, ids.live, 'prod');
    await runner.query(`INSERT INTO application_business_processes (tenant_id, application_id, business_process_id) VALUES ($1, $2, $3)`, [g.tenantId, legacy, g.processes.finance]);

    const impact = await service().impactOf(ids.host, ctxOf(runner, g.tenantId));
    assert.deepEqual(impact.assets.map((row) => row.name), ['R-HOST', 'LIVE-VM'], 'the retired VM is not crossed, nor what depends on it');
    assert.deepEqual(
      impact.clusters.map((row) => `${row.name}|${row.state}|${row.fallen_members}/${row.members}`),
      ['PAIR-CL|down|1/1'],
      'a retired member neither falls nor stands',
    );
    assert.deepEqual(impact.applications!.map((row) => `${row.name}|${row.via.map((v) => v.name).join(',')}`), ['Live|LIVE-VM']);
    assert.deepEqual([impact.technologies, impact.processes], [[], []], 'nothing is read from the retired VM');
    assert.deepEqual(impact.totals, { assets: 1, applications: 1, clusters: 1, technologies: 0, processes: 0 });

    // A retired server: listed alone at depth 0, nothing falls with it.
    const retired = await service().impactOf(ids.old, ctxOf(runner, g.tenantId));
    assert.deepEqual(retired.assets.map((row) => `${row.name}|${row.depth}`), ['OLD-VM|0']);
    assert.equal(retired.asset.id, ids.old);
    assert.deepEqual([retired.clusters, retired.applications, retired.technologies, retired.processes], [[], [], [], []]);
    assert.deepEqual(retired.totals, { assets: 0, applications: 0, clusters: 0, technologies: 0, processes: 0 });
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
    // An owner of the ERP sees the ERP and its process only.
    const role = await one(runner, `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
      VALUES ($1, 'Business contributor', '', false, false, now(), now()) RETURNING id`, [g.tenantId]);
    const owner = await one(runner, `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, created_at, updated_at)
      VALUES ($1, 'Bea', 'Owner', $2, $3, false, 'enabled', now(), now()) RETURNING id`, [g.tenantId, `bea-${g.tenantId.slice(0, 8)}@example.com`, role]);
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [g.tenantId, g.apps.erp, owner]);
    const own = await service().impactOf(g.ids.host, ctxOf(runner, g.tenantId, { applications: { scope: { userId: owner } } }));
    assert.deepEqual(own.applications!.map((row) => row.name), ['ERP']);
    assert.deepEqual(own.processes!.map((row) => `${row.name}|${row.via.map((v) => v.name).join(',')}`), ['Finance|ERP']);
    assert.deepEqual([own.totals.applications, own.totals.processes], [1, 1]);
  });
}

async function testRowCap() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'impact-cap');
    await runner.query(
      `WITH vm AS (
         INSERT INTO assets (tenant_id, name, kind, environment) SELECT $1, 'BULK-' || lpad(n::text, 3, '0'), 'vm', 'prod' FROM generate_series(1, $3::int) n RETURNING id
       )
       INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) SELECT $1, $2, vm.id, 'contains' FROM vm`,
      [g.tenantId, g.ids.d5, IMPACT_ROW_LIMIT + 5],
    );
    await runner.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id)
       SELECT $1, r.related_asset_id, $3 FROM asset_relations r WHERE r.tenant_id = $1 AND r.asset_id = $2`,
      [g.tenantId, g.ids.d5, g.tech.firmware],
    );
    const impact = await service().impactOf(g.ids.d5, ctxOf(runner, g.tenantId));
    assert.equal(impact.totals.assets, IMPACT_ROW_LIMIT + 5);
    assert.deepEqual([impact.technologies[0].via.length, impact.technologies[0].via_total], [IMPACT_VIA_LIMIT, IMPACT_ROW_LIMIT + 5], 'a long via is cut and counted');
    assert.equal(impact.assets.length, IMPACT_ROW_LIMIT + 1, 'the server, then the first rows');
    assert.equal(impact.assets[0].id, g.ids.d5);
    assert.equal(impact.assets[IMPACT_ROW_LIMIT].name, `BULK-${String(IMPACT_ROW_LIMIT).padStart(3, '0')}`, 'nearest first, then by name');
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
  ['a cluster falls with its members, a cluster down takes its VMs', testClusterFalls],
  ['cycle and depth', testCycleAndDepth],
  ['applications out of service', testOutOfService],
  ['retired assets', testRetiredAssets],
  ['read rights', testRights],
  ['row cap', testRowCap],
  ['tenant isolation', testTenantIsolation],
]);
