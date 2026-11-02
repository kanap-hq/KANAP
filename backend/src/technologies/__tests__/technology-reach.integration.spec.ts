// @database-spec
import 'dotenv/config';
import { assert, inRolledBackTransaction, runSpecs, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { MAX_DEPTH } from '../technology-reach.service';
import { application, asset, assign, contains, installed, member, seedGraph, services, technology, version, type AuditEntry } from './technologies.fixtures';

// The deductions of the technology layer (lot S) against a real database, in transactions rolled
// back at the end: host -> VM, member -> cluster, the depth limit, a `contains` cycle, the
// provenance of each reached row, an unknown version, both directions, and tenant isolation.

const key = (row: { asset_id: string; via_asset_id: string | null; technology_version_id: string | null }) =>
  `${row.asset_id}|${row.via_asset_id ?? '-'}|${row.technology_version_id ?? '-'}`;

async function testForwardTraversal() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-fwd');
    const { reach } = services();
    const rows = await reach.assetsOfTechnologies(runner.manager, g.tenantId, [g.tech.vsphere]);
    const got = rows.map(key).sort();
    const expected = [
      // Installed on both hosts: 8.0 on one, unknown on the other (from Netbox).
      `${g.ids.host1}|-|${g.versions.v8}`,
      `${g.ids.host2}|-|-`,
      // Host -> VM.
      `${g.ids.vm1}|${g.ids.host1}|${g.versions.v8}`,
      // Member -> cluster, then cluster -> VM, once per host that carries it.
      `${g.ids.vsphereCluster}|${g.ids.host1}|${g.versions.v8}`,
      `${g.ids.vsphereCluster}|${g.ids.host2}|-`,
      `${g.ids.vm2}|${g.ids.host1}|${g.versions.v8}`,
      `${g.ids.vm2}|${g.ids.host2}|-`,
    ].sort();
    assert.deepEqual(got, expected);
    const direct = rows.filter((row) => !row.via_asset_id);
    assert.deepEqual(direct.map((row) => row.link_id).sort(), [g.links.host1, g.links.host2].sort(), 'direct rows carry their link');
    assert.ok(rows.filter((row) => row.via_asset_id).every((row) => row.link_id === null), 'carried rows are not removable');
    assert.equal(rows.find((row) => row.asset_id === g.ids.host2)?.source, 'netbox', 'the provenance of the link is kept');
    assert.equal(rows.find((row) => row.asset_id === g.ids.vm2 && row.via_asset_id === g.ids.host1)?.depth, 2);
  });
}

async function testDepthAndCycle() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-depth');
    const { reach } = services();
    const deep = await reach.assetsOfTechnologies(runner.manager, g.tenantId, [g.tech.deep]);
    assert.equal(MAX_DEPTH, 3);
    assert.deepEqual(deep.map((row) => row.asset_id).sort(), [g.ids.d1, g.ids.d2, g.ids.d3, g.ids.d4].sort(), 'D5 is four edges away: not reached');
    const loop = await reach.assetsOfTechnologies(runner.manager, g.tenantId, [g.tech.loop]);
    assert.deepEqual(loop.map((row) => row.asset_id).sort(), [g.ids.c1, g.ids.c2].sort(), 'A contains B contains A stops');
    const up = await reach.technologiesOfAssets(runner.manager, g.tenantId, [g.ids.c1, g.ids.c2]);
    assert.deepEqual(up.map((row) => `${row.subject_id}|${row.kind}`).sort(), [`${g.ids.c1}|installed`, `${g.ids.c2}|carried`].sort());
  });
}

async function testApplications() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-apps');
    const { reach, links } = services();
    const rows = await reach.applicationsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql]);
    const got = rows.map((row) => `${row.application_id}|${row.kind}|${row.asset_id ?? '-'}|${row.via_asset_id ?? '-'}|${row.technology_version_id ?? '-'}`).sort();
    assert.deepEqual(got, [
      // The ERP on the SQL cluster runs on each node (clusters pass, lot B2: effective assignments):
      // one row per node, its version. The cluster, carried by the nodes, adds no row.
      `${g.apps.erp}|hosted|${g.ids.sqlNode1}|-|${g.versions.sql2019}`,
      `${g.apps.erp}|hosted|${g.ids.sqlNode2}|-|${g.versions.sql2016}`,
      // The portal declares SQL Server without a version.
      `${g.apps.portal}|declared|-|-|-`,
    ].sort());

    // The other way: the ERP's SQL Server, one row per node, none through the cluster.
    const ofErp = await reach.technologiesOfApplications(runner.manager, g.tenantId, [g.apps.erp]);
    assert.deepEqual(ofErp.map((row) => `${row.technology_id}|${row.kind}|${row.asset_id}|${row.via_asset_id ?? '-'}|${row.technology_version_id}`).sort(), [
      `${g.tech.sql}|hosted|${g.ids.sqlNode1}|-|${g.versions.sql2019}`,
      `${g.tech.sql}|hosted|${g.ids.sqlNode2}|-|${g.versions.sql2016}`,
    ].sort());

    // The other way: the portal's technologies are vSphere through its VM (via each host) and SQL Server declared.
    const ofPortal = await links.technologiesOfApplication(g.apps.portal, { manager: runner.manager, tenantId: g.tenantId });
    const shown = ofPortal.items.map((item) => `${item.technology_id}|${item.kind}|${item.via_asset_id ?? '-'}|${item.version_label ?? 'unknown'}|${item.removable}`).sort();
    assert.deepEqual(shown, [
      `${g.tech.sql}|declared|-|unknown|true`,
      `${g.tech.vsphere}|hosted|${g.ids.host1}|8.0|false`,
      `${g.tech.vsphere}|hosted|${g.ids.host2}|unknown|false`,
    ].sort());

    // The tab of the technology names the server, the environment and the version, unknown included.
    const tab = await links.applicationsOfTechnology(g.tech.sql, { manager: runner.manager, tenantId: g.tenantId }, {});
    const items = tab.items!;
    assert.equal(items.length, 3);
    assert.ok(items.some((item) => item.kind === 'declared' && item.version_label === null));
    const servers = [g.ids.sqlNode1, g.ids.sqlNode2];
    assert.ok(items.filter((item) => item.kind === 'hosted').every((item) => item.environment === 'prod' && servers.includes(item.asset_id!)));
    // Without the applications read right, no row; a Business Contributor sees its applications only.
    assert.equal((await links.applicationsOfTechnology(g.tech.sql, { manager: runner.manager, tenantId: g.tenantId }, null)).items, null);
    const outsider = await runner.query(`SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, [g.tenantId]);
    const scoped = await links.applicationsOfTechnology(g.tech.sql, { manager: runner.manager, tenantId: g.tenantId }, { scope: { userId: outsider[0]?.id ?? '00000000-0000-4000-8000-000000000000' } as any });
    assert.deepEqual(scoped.items, [], 'a user who takes part in no application sees none');

    // A disabled application, or a disabled instance, is left out of the deductions.
    await runner.query(`UPDATE applications SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE id = $1`, [g.apps.portal]);
    const withoutPortal = await reach.applicationsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql]);
    assert.ok(withoutPortal.every((row) => row.application_id !== g.apps.portal), 'a disabled application declares nothing');
    await runner.query(`UPDATE app_instances SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE application_id = $1`, [g.apps.erp]);
    assert.deepEqual(await reach.applicationsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql]), [], 'a disabled instance hosts nothing');
    assert.equal((await reach.countsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql])).get(g.tech.sql)?.applications, 0);
  });
}

// The Add of a technology's Applications tab names the version of its declarations, as the other
// link writes do: an existing version, a label resolved or created, or none.
async function testDeclareApplicationsAtVersion() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-declare');
    const audit: AuditEntry[] = [];
    const { links } = services(audit);
    const opts = { manager: runner.manager, tenantId: g.tenantId, userId: null };
    const crm = await application(runner, g.tenantId, 'CRM reach-declare');
    const hr = await application(runner, g.tenantId, 'HR reach-declare');
    const declared = async (appId: string) => (await runner.query(
      `SELECT v.label FROM application_technologies l LEFT JOIN technology_versions v ON v.tenant_id = l.tenant_id AND v.id = l.technology_version_id
        WHERE l.tenant_id = $1 AND l.application_id = $2 AND l.technology_id = $3 ORDER BY v.label NULLS FIRST`,
      [g.tenantId, appId, g.tech.sql],
    )).map((row: { label: string | null }) => row.label ?? 'unknown');

    assert.deepEqual(await links.addApplications(g.tech.sql, [crm, hr], opts, {}, { technology_version_id: g.versions.sql2019 }), { ok: true, added: 2 });
    assert.deepEqual(await declared(crm), ['2019']);
    assert.deepEqual(await declared(hr), ['2019']);
    const written = audit.filter((entry) => entry.table === 'application_technologies');
    assert.deepEqual(written.map((entry) => entry.after), [crm, hr].sort().map((id) => ({ application_id: id, technology_version_id: g.versions.sql2019 })));

    // A label is resolved without case, and created when missing.
    await links.addApplications(g.tech.sql, [crm], opts, {}, { version_label: '2022' });
    assert.deepEqual(await declared(crm), ['2019', '2022']);
    const [{ count }] = await runner.query(`SELECT count(*)::int AS count FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND label = '2022'`, [g.tenantId, g.tech.sql]);
    assert.equal(count, 1);
    // No version: "version unknown", as before; the same declaration twice adds nothing.
    await links.addApplications(g.tech.sql, [hr], opts, {});
    assert.deepEqual(await declared(hr), ['unknown', '2019']);
    assert.deepEqual(await links.addApplications(g.tech.sql, [hr], opts, {}, { technology_version_id: null }), { ok: true, added: 0 });

    // A version of another technology is refused, and so is a label next to an unknown application.
    await assert.rejects(links.addApplications(g.tech.sql, [crm], opts, {}, { technology_version_id: g.versions.v8 }), /Version not found/);
    await assert.rejects(
      links.addApplications(g.tech.sql, ['00000000-0000-4000-8000-000000000000'], opts, {}, { version_label: '2030' }),
      /One or more applications not found/,
    );
    const [{ created }] = await runner.query(`SELECT count(*)::int AS created FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND label = '2030'`, [g.tenantId, g.tech.sql]);
    assert.equal(created, 0, 'a refused add creates no version');
  });
}

async function testCounts() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-counts');
    const { reach } = services();
    const counts = await reach.countsOfTechnologies(runner.manager, g.tenantId, [g.tech.vsphere, g.tech.sql]);
    assert.deepEqual(counts.get(g.tech.vsphere), {
      // The two hosts it is installed on, not their VMs nor the cluster (decision of 2026-10-24).
      technology_id: g.tech.vsphere, servers: 2, applications: 1, versions_in_use: 1, next_support_end: '2027-10-11', ended_versions: 0,
    });
    const sql = counts.get(g.tech.sql)!;
    assert.equal(sql.servers, 2, 'the two nodes, not the SQL cluster');
    assert.equal(sql.applications, 2);
    assert.equal(sql.versions_in_use, 2);
    assert.equal(sql.ended_versions, 2, 'SQL Server 2016 and 2019 are past their standard support');
  });
}

async function testRetiredAsset() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-retired');
    const { reach, links } = services();
    const opts = { manager: runner.manager, tenantId: g.tenantId };
    // A server carrying SQL Server 2012 (ended), containing a VM, each hosting an application.
    const old = await asset(runner, g.tenantId, 'OLD-SQL reach-retired');
    const oldVm = await asset(runner, g.tenantId, 'OLD-VM reach-retired');
    await contains(runner, g.tenantId, old, oldVm);
    const sql2012 = await version(runner, g.tenantId, g.tech.sql, '2012', '2017-07-11');
    const oldLink = await installed(runner, g.tenantId, old, g.tech.sql, sql2012);
    const onServer = await application(runner, g.tenantId, 'On old server reach-retired');
    const onVm = await application(runner, g.tenantId, 'On old VM reach-retired');
    await assign(runner, g.tenantId, onServer, old);
    await assign(runner, g.tenantId, onVm, oldVm);

    const before = (await reach.countsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql])).get(g.tech.sql)!;
    assert.equal(before.servers, 3, 'in service: the server it is installed on counts, not its VM');
    assert.equal(before.ended_versions, 3);

    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [g.tenantId, old]);
    const assets = await reach.assetsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql]);
    assert.ok(!assets.some((row) => row.asset_id === old), 'the retired server carries nothing');
    assert.ok(!assets.some((row) => row.asset_id === oldVm), 'and the traversal stops there');
    const after = (await reach.countsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql])).get(g.tech.sql)!;
    assert.equal(after.servers, 2);
    assert.equal(after.versions_in_use, 2, 'a version named on a retired server only is not in use');
    assert.equal(after.ended_versions, 2);
    assert.equal(after.applications, 2);
    const apps = await reach.applicationsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql]);
    assert.ok(!apps.some((row) => row.application_id === onServer || row.application_id === onVm), 'no hosted application through it');
    assert.deepEqual(await reach.technologiesOfApplications(runner.manager, g.tenantId, [onServer, onVm]), []);
    assert.deepEqual(await reach.technologiesOfAssets(runner.manager, g.tenantId, [oldVm]), [], 'its VM no longer carries SQL Server');

    // The management views still show its direct link, with the asset's status, to be removed.
    const ofTechnology = (await links.assetsOfTechnology(g.tech.sql, opts)).items;
    const row = ofTechnology.find((item) => item.asset_id === old);
    assert.equal(row?.link_id, oldLink);
    assert.equal(row?.kind, 'installed');
    assert.equal(row?.asset_status, 'retired');
    assert.ok(!ofTechnology.some((item) => item.asset_id === oldVm), 'nothing carried through it');
    assert.equal(ofTechnology.find((item) => item.asset_id === g.ids.sqlNode1)?.asset_status, 'active');
    const ofAsset = (await links.technologiesOfAsset(old, opts)).items;
    assert.deepEqual(ofAsset.map((item) => [item.technology_id, item.removable, item.link_id]), [[g.tech.sql, true, oldLink]]);
    assert.deepEqual((await links.technologiesOfAsset(oldVm, opts)).items, []);
    assert.equal((await links.removeAssetLinkOfAsset(old, oldLink, opts)).changed, true, 'and removable');
    assert.deepEqual((await links.technologiesOfAsset(old, opts)).items, []);
    assert.deepEqual((await reach.countsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql])).get(g.tech.sql), after, 'the counters never counted it');
  });
}

/**
 * The servers of a technology (clusters pass, K2-1, Q3 amended 2026-10-24): installed on two hosts
 * of a cluster at the same version and carried to a VM that cluster contains. Two servers
 * everywhere (list, version: the hosts it is installed on); the Servers tab lists four rows (the
 * two hosts, the VM through the cluster's `contains`, the cluster once), and the cluster's
 * technologies one line with both hosts. A retired member counts nowhere.
 */
async function testClusterServers() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-cluster');
    const { reach, links, technologies } = services();
    const opts = { manager: runner.manager, tenantId: g.tenantId };
    const a = (name: string, cluster = false) => asset(runner, g.tenantId, `${name} reach-cluster`, cluster);
    const h1 = await a('AGT-H1');
    const h2 = await a('AGT-H2');
    const h3 = await a('AGT-H3');
    const cluster = await a('AGT-CL', true);
    const vm = await a('AGT-VM');
    for (const host of [h1, h2, h3]) await member(runner, g.tenantId, cluster, host);
    await contains(runner, g.tenantId, cluster, vm);
    const agent = await technology(runner, g.tenantId, 5, 'Agent', 'other');
    const v1 = await version(runner, g.tenantId, agent, '1.0', '2020-01-01');
    for (const host of [h1, h2, h3]) await installed(runner, g.tenantId, host, agent, v1);
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [g.tenantId, h3]);

    // The list.
    assert.equal((await reach.countsOfTechnologies(runner.manager, g.tenantId, [agent])).get(agent)?.servers, 2);
    // The versions: two servers as the list counts them; the direct links unchanged (retired included).
    const record = await technologies.get(agent, opts);
    const version1 = record.versions.find((v: any) => v.id === v1) as any;
    assert.equal(version1.server_count, 2);
    assert.equal(version1.servers, 3, 'the direct count still names every link, the retired host included');
    assert.deepEqual(
      (await reach.serversOfTechnologies(runner.manager, g.tenantId, [agent])).map((r) => r.asset_id).sort(),
      [h1, h2].sort(),
    );

    // The Servers tab: one row per host, the VM once, the cluster once with both hosts, the retired link.
    const tab = (await links.assetsOfTechnology(agent, opts)).items;
    const inService = tab.filter((item) => item.asset_status !== 'retired');
    assert.deepEqual(inService.map((item) => `${item.asset_id}|${item.kind}`).sort(), [
      `${h1}|installed`, `${h2}|installed`, `${vm}|carried`, `${cluster}|carried`,
    ].sort());
    const clusterRow = inService.find((item) => item.asset_id === cluster)!;
    assert.equal(clusterRow.is_cluster, true);
    assert.deepEqual(clusterRow.via_assets.map((v) => v.id), [h1, h2], 'its carriers, by name');
    assert.equal(clusterRow.via_asset_id, h1, 'via is the first of them');
    assert.equal(clusterRow.via_asset_name, `AGT-H1 reach-cluster`);
    assert.deepEqual(inService.find((item) => item.asset_id === vm)!.via_assets.map((v) => v.id), [h1, h2]);
    assert.deepEqual(inService.find((item) => item.asset_id === h1)!.via_assets, []);
    // The VM gets it through the cluster's `contains`: the platform underneath; the cluster from its members.
    assert.deepEqual(inService.map((item) => `${item.asset_id}|${item.through_host}`).sort(), [
      `${h1}|false`, `${h2}|false`, `${vm}|true`, `${cluster}|false`,
    ].sort());
    assert.equal(tab.filter((item) => item.asset_status === 'retired').map((item) => item.asset_id).join(), h3);

    // The cluster's technologies: one carried line for Agent 1.0, with both hosts.
    const up = (await reach.technologiesOfAssets(runner.manager, g.tenantId, [cluster])).filter((r) => r.technology_id === agent);
    assert.equal(up.length, 1);
    assert.equal(up[0].kind, 'carried');
    assert.deepEqual(up[0].via_asset_ids, [h1, h2]);
    assert.equal(up[0].via_asset_id, h1);
    assert.equal(up[0].through_host, false, 'what the members carry stays plain');
    const shown = (await links.technologiesOfAsset(cluster, opts)).items.filter((item) => item.technology_id === agent);
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0].via_assets.map((v) => [v.id, v.name]), [[h1, `AGT-H1 reach-cluster`], [h2, `AGT-H2 reach-cluster`]]);
    assert.ok(shown[0].via_assets.every((v) => /^AST-\d+$/.test(v.reference ?? '')), 'with their references');
    // The vSphere cluster's two hosts carry two versions (8.0 and unknown): two lines, one host each.
    const vsphere = (await reach.technologiesOfAssets(runner.manager, g.tenantId, [g.ids.vsphereCluster])).filter((r) => r.technology_id === g.tech.vsphere);
    assert.deepEqual(vsphere.map((r) => `${r.technology_version_id ?? '-'}|${(r.via_asset_ids ?? []).join(',')}`).sort(), [
      `${g.versions.v8}|${g.ids.host1}`, `-|${g.ids.host2}`,
    ].sort());
  });
}

/**
 * The platform underneath (decision of 2026-10-24): a cluster of two VMs, each contained in an ESXi
 * host. Windows on the VMs reaches the cluster plain; ESXi reaches it, and each VM, through a host.
 * The servers of ESXi are the hosts it is installed on, not the VMs they contain.
 */
async function testThroughHost() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-host');
    const { reach, links, technologies } = services();
    const opts = { manager: runner.manager, tenantId: g.tenantId };
    const a = (name: string, cluster = false) => asset(runner, g.tenantId, `${name} reach-host`, cluster);
    const hostA = await a('ESX-A');
    const hostB = await a('ESX-B');
    const vmA = await a('VM-A');
    const vmB = await a('VM-B');
    const vmC = await a('VM-C');
    const cluster = await a('WIN-CL', true);
    await contains(runner, g.tenantId, hostA, vmA);
    await contains(runner, g.tenantId, hostA, vmC);
    await contains(runner, g.tenantId, hostB, vmB);
    await member(runner, g.tenantId, cluster, vmA);
    await member(runner, g.tenantId, cluster, vmB);
    const esxi = await technology(runner, g.tenantId, 6, 'ESXi', 'other');
    const esxi8 = await version(runner, g.tenantId, esxi, '8.0', '2030-01-01');
    const windows = await technology(runner, g.tenantId, 7, 'Windows Server', 'operating_system');
    const w2022 = await version(runner, g.tenantId, windows, '2022', '2031-10-14');
    await installed(runner, g.tenantId, hostA, esxi, esxi8);
    await installed(runner, g.tenantId, hostB, esxi, esxi8);
    await installed(runner, g.tenantId, vmA, windows, w2022);
    await installed(runner, g.tenantId, vmB, windows, w2022);

    // The cluster: Windows plain (its members), ESXi through a host.
    const ofCluster = await reach.technologiesOfAssets(runner.manager, g.tenantId, [cluster]);
    assert.deepEqual(ofCluster.map((r) => `${r.technology_id}|${r.kind}|${r.through_host}`).sort(), [
      `${windows}|carried|false`, `${esxi}|carried|true`,
    ].sort());
    const shown = (await links.technologiesOfAsset(cluster, opts)).items;
    assert.deepEqual(shown.map((item) => `${item.technology_id}|${item.through_host}`).sort(), [`${windows}|false`, `${esxi}|true`].sort());
    // A VM alone: its Windows installed, ESXi through its host.
    const ofVm = (await links.technologiesOfAsset(vmA, opts)).items;
    assert.deepEqual(ofVm.map((item) => `${item.technology_id}|${item.kind}|${item.through_host}`).sort(), [
      `${windows}|installed|false`, `${esxi}|carried|true`,
    ].sort());

    // The Servers tab of ESXi: the hosts plain, the VMs and the cluster through a host.
    const tab = (await links.assetsOfTechnology(esxi, opts)).items;
    assert.deepEqual(tab.map((item) => `${item.asset_id}|${item.kind}|${item.through_host}`).sort(), [
      `${hostA}|installed|false`, `${hostB}|installed|false`,
      `${vmA}|carried|true`, `${vmB}|carried|true`, `${vmC}|carried|true`, `${cluster}|carried|true`,
    ].sort());
    // That of Windows: the VMs installed, the cluster plain.
    const winTab = (await links.assetsOfTechnology(windows, opts)).items;
    assert.deepEqual(winTab.map((item) => `${item.asset_id}|${item.kind}|${item.through_host}`).sort(), [
      `${vmA}|installed|false`, `${vmB}|installed|false`, `${cluster}|carried|false`,
    ].sort());

    // An application on the cluster runs on both VMs: Windows on each, ESXi through each VM's host
    // (the platform underneath), and nothing through the cluster, which the VMs carry.
    const onCluster = await application(runner, g.tenantId, 'On WIN-CL reach-host');
    await assign(runner, g.tenantId, onCluster, cluster);
    const ofApp = await reach.technologiesOfApplications(runner.manager, g.tenantId, [onCluster]);
    assert.deepEqual(ofApp.map((r) => `${r.technology_id}|${r.asset_id}|${r.via_asset_id ?? '-'}`).sort(), [
      `${esxi}|${vmA}|${hostA}`, `${esxi}|${vmB}|${hostB}`, `${windows}|${vmA}|-`, `${windows}|${vmB}|-`,
    ].sort());
    for (const [tech, expected] of [[esxi, [`${vmA}|${hostA}`, `${vmB}|${hostB}`]], [windows, [`${vmA}|-`, `${vmB}|-`]]] as const) {
      const apps = (await reach.applicationsOfTechnologies(runner.manager, g.tenantId, [tech])).filter((r) => r.application_id === onCluster);
      assert.deepEqual(apps.map((r) => `${r.asset_id}|${r.via_asset_id ?? '-'}`).sort(), [...expected].sort());
    }

    // A path without `contains` wins: Windows also on host A (same version) reaches the cluster
    // through VM-A's host too, and the line stays plain.
    await installed(runner, g.tenantId, hostA, windows, w2022);
    const mixed = (await reach.technologiesOfAssets(runner.manager, g.tenantId, [cluster])).filter((r) => r.technology_id === windows);
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0].through_host, false);
    assert.ok(mixed[0].via_asset_ids?.includes(hostA), 'every carrier is named');

    // Servers: ESXi on two hosts that contain three VMs counts two, everywhere.
    assert.equal((await reach.countsOfTechnologies(runner.manager, g.tenantId, [esxi])).get(esxi)?.servers, 2);
    const record = await technologies.get(esxi, opts);
    assert.equal((record.versions.find((v: any) => v.id === esxi8) as any).server_count, 2);
    assert.deepEqual((await reach.serversOfTechnologies(runner.manager, g.tenantId, [esxi])).map((r) => r.asset_id).sort(), [hostA, hostB].sort());
    // A technology installed on a cluster only has no server.
    const clusterOnly = await technology(runner, g.tenantId, 8, 'Cluster agent', 'other');
    await installed(runner, g.tenantId, cluster, clusterOnly);
    assert.equal((await reach.countsOfTechnologies(runner.manager, g.tenantId, [clusterOnly])).get(clusterOnly)?.servers, 0);
    assert.deepEqual(await reach.serversOfTechnologies(runner.manager, g.tenantId, [clusterOnly]), []);
    // A retired host does not count.
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [g.tenantId, hostB]);
    assert.equal((await reach.countsOfTechnologies(runner.manager, g.tenantId, [esxi])).get(esxi)?.servers, 1);
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedGraph(runner, 'reach-iso-a');
    const b = await seedGraph(runner, 'reach-iso-b');
    const { reach, technologies, links } = services();
    // Under tenant B: tenant A's ids reach nothing, by the tenant predicate and by RLS.
    await setTenant(runner, b.tenantId);
    assert.deepEqual(await reach.assetsOfTechnologies(runner.manager, b.tenantId, [a.tech.vsphere]), []);
    assert.deepEqual(await reach.assetsOfTechnologies(runner.manager, a.tenantId, [a.tech.vsphere]), [], 'RLS hides tenant A even when named');
    assert.deepEqual(await reach.technologiesOfApplications(runner.manager, b.tenantId, [a.apps.erp]), []);
    assert.equal((await reach.countsOfTechnologies(runner.manager, b.tenantId, [a.tech.sql])).size, 0);
    await assert.rejects(technologies.get(a.tech.sql, { manager: runner.manager, tenantId: b.tenantId }), /Technology not found/);
    await assert.rejects(
      links.addAssetLink(b.tech.sql, a.ids.vm1, {}, { manager: runner.manager, tenantId: b.tenantId }),
      /Asset not found/,
      'an asset of another tenant cannot be linked',
    );
    // Tenant B's own list shows its four technologies only.
    const list = await technologies.list({}, { manager: runner.manager, tenantId: b.tenantId });
    assert.equal(list.total, 4);
    assert.ok(list.items.every((item) => item.tenant_id === b.tenantId));
  });
}

runSpecs('technology-reach.integration.spec', [
  ['forward traversal', testForwardTraversal],
  ['depth and cycle', testDepthAndCycle],
  ['applications both ways', testApplications],
  ['declare applications at a version', testDeclareApplicationsAtVersion],
  ['list counters', testCounts],
  ['retired asset', testRetiredAsset],
  ['servers of a technology on a cluster', testClusterServers],
  ['platform underneath', testThroughHost],
  ['tenant isolation', testTenantIsolation],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
