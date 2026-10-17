// @database-spec
import 'dotenv/config';
import { assert, inRolledBackTransaction, runSpecs, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { MAX_DEPTH } from '../technology-reach.service';
import { application, asset, assign, contains, installed, seedGraph, services, version } from './technologies.fixtures';

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
      // The ERP on the SQL cluster: both versions, through each node (over-approximation shown).
      `${g.apps.erp}|hosted|${g.ids.sqlCluster}|${g.ids.sqlNode1}|${g.versions.sql2019}`,
      `${g.apps.erp}|hosted|${g.ids.sqlCluster}|${g.ids.sqlNode2}|${g.versions.sql2016}`,
      // The portal declares SQL Server without a version.
      `${g.apps.portal}|declared|-|-|-`,
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
    assert.ok(items.filter((item) => item.kind === 'hosted').every((item) => item.environment === 'prod' && item.asset_id === g.ids.sqlCluster));
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

async function testCounts() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seedGraph(runner, 'reach-counts');
    const { reach } = services();
    const counts = await reach.countsOfTechnologies(runner.manager, g.tenantId, [g.tech.vsphere, g.tech.sql]);
    assert.deepEqual(counts.get(g.tech.vsphere), {
      technology_id: g.tech.vsphere, servers: 5, applications: 1, versions_in_use: 1, next_support_end: '2027-10-11', ended_versions: 0,
    });
    const sql = counts.get(g.tech.sql)!;
    assert.equal(sql.servers, 3);
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
    assert.equal(before.servers, 5, 'in service: the server and its VM are reached');
    assert.equal(before.ended_versions, 3);

    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [g.tenantId, old]);
    const assets = await reach.assetsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql]);
    assert.ok(!assets.some((row) => row.asset_id === old), 'the retired server carries nothing');
    assert.ok(!assets.some((row) => row.asset_id === oldVm), 'and the traversal stops there');
    const after = (await reach.countsOfTechnologies(runner.manager, g.tenantId, [g.tech.sql])).get(g.tech.sql)!;
    assert.equal(after.servers, 3);
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
  ['list counters', testCounts],
  ['retired asset', testRetiredAsset],
  ['tenant isolation', testTenantIsolation],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
