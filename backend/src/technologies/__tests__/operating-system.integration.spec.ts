// @database-spec
import 'dotenv/config';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
import { OperatingSystemService } from '../operating-system.service';
import { asset, installed, services, technology, version } from './technologies.fixtures';

// The resolver and the mark, on a database that already has migration 1854330000000 applied.

function service() {
  const audit = { log: async () => undefined };
  const itOps = {
    getSettings: async () => ({ technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, hostingTypes: DEFAULT_HOSTING_TYPES }),
  };
  const catalog = new TechnologyCatalogService(audit as any, itOps as any);
  return new OperatingSystemService(audit as any, itOps as any, catalog);
}

async function testResolveAndMark() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'os-resolve');
    const os = service();
    const mg = runner.manager;
    assert.equal(await os.resolve(mg, tenantId, '  ', { create: true }), null);

    const shipped = await os.resolve(mg, tenantId, 'windows_server_2019', { create: false });
    assert.ok(shipped);
    const [windows] = await runner.query(
      `SELECT t.name, t.catalog_key, t.family, v.label
         FROM technologies t JOIN technology_versions v ON v.technology_id = t.id AND v.id = $2
        WHERE t.tenant_id = $1 AND t.id = $3`,
      [tenantId, shipped!.technology_version_id, shipped!.technology_id],
    );
    assert.deepEqual({ name: windows.name, catalog_key: windows.catalog_key, family: windows.family, label: windows.label }, {
      name: 'Windows Server', catalog_key: 'windows-server', family: 'operating_system', label: '2019',
    });

    const ubuntu = await os.resolve(mg, tenantId, 'Ubuntu 22.04 LTS', { create: false });
    const [ubuntuRow] = await runner.query(
      `SELECT t.name, v.label FROM technologies t JOIN technology_versions v ON v.id = $2 WHERE t.tenant_id = $1 AND t.id = $3`,
      [tenantId, ubuntu!.technology_version_id, ubuntu!.technology_id],
    );
    assert.deepEqual(ubuntuRow, { name: 'Ubuntu', label: '22.04 LTS' });

    assert.equal(await os.resolve(mg, tenantId, 'Nope 1', { create: false }), null);
    const created = await os.resolve(mg, tenantId, 'Cisco Meraki', { create: true });
    const [cisco] = await runner.query(`SELECT name, family FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, created!.technology_id]);
    assert.deepEqual(cisco, { name: 'Cisco Meraki', family: 'operating_system' });
    assert.equal(created!.technology_version_id, null);

    const esxi = await os.resolve(mg, tenantId, 'VMware ESXi 8.0', { create: true });
    const [esxiRow] = await runner.query(
      `SELECT t.name, v.label FROM technologies t
         JOIN technology_versions v ON v.tenant_id = t.tenant_id AND v.id = $2
        WHERE t.tenant_id = $1 AND t.id = $3`,
      [tenantId, esxi!.technology_version_id, esxi!.technology_id],
    );
    assert.deepEqual(esxiRow, { name: 'VMware ESXi', label: '8.0' });

    const forti = await technology(runner, tenantId, 50, 'FortiOS', 'network_security');
    const exact = await os.resolve(mg, tenantId, 'FortiOS', { create: true });
    assert.equal(exact!.technology_id, forti);
    assert.equal(exact!.technology_version_id, null);
    const prefixed = await os.resolve(mg, tenantId, 'FortiOS 7.4', { create: false });
    assert.equal(prefixed!.technology_id, forti);
    const [fortiVersion] = await runner.query(`SELECT label FROM technology_versions WHERE id = $1`, [prefixed!.technology_version_id]);
    assert.equal(fortiVersion.label, '7.4');

    const server = await asset(runner, tenantId, 'host');
    const bare = await version(runner, tenantId, forti, '7.0');
    const link = await installed(runner, tenantId, server, forti, null);
    const marked = await os.setOperatingSystem(mg, tenantId, server, prefixed, 'import');
    assert.equal(marked.link_id, link, 'a versionless link of the same technology takes the version');
    assert.equal(marked.changed, true);
    const [linkRow] = await runner.query(
      `SELECT technology_version_id, is_operating_system, source FROM asset_technologies WHERE tenant_id = $1 AND id = $2`,
      [tenantId, link],
    );
    assert.deepEqual(linkRow, { technology_version_id: prefixed!.technology_version_id, is_operating_system: true, source: 'import' });
    assert.notEqual(linkRow.technology_version_id, bare);

    const again = await os.setOperatingSystem(mg, tenantId, server, prefixed, 'import');
    assert.equal(again.changed, false);

    const replaced = await os.setOperatingSystem(mg, tenantId, server, created, 'manual');
    assert.equal(replaced.changed, true);
    const [gone] = await runner.query(`SELECT count(*)::int AS n FROM asset_technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, link]);
    assert.equal(gone.n, 0, 'a marked link of another technology is deleted');
    const labels = await os.labelsOf(mg, tenantId, [server]);
    assert.equal(labels.get(server), 'Cisco Meraki');

    const cleared = await os.setOperatingSystem(mg, tenantId, server, null, 'manual');
    assert.equal(cleared.changed, true);
    assert.equal((await os.labelsOf(mg, tenantId, [server])).size, 0);
  });
}

async function marks(runner: any, tenantId: string, assetId: string) {
  return runner.query(
    `SELECT at.id, at.technology_id, v.label AS version, at.is_operating_system AS os
       FROM asset_technologies at
       LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
      WHERE at.tenant_id = $1 AND at.asset_id = $2
      ORDER BY v.label NULLS FIRST`,
    [tenantId, assetId],
  );
}

async function testChangingTheOperatingSystem() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'os-change');
    const os = service();
    const mg = runner.manager;
    const server = await asset(runner, tenantId, 'srv');

    // Another version of the same technology: the old version leaves the server.
    const w2016 = await os.resolve(mg, tenantId, 'Windows Server 2016', { create: true });
    const first = await os.setOperatingSystem(mg, tenantId, server, w2016, 'manual');
    const w2019 = await os.resolve(mg, tenantId, 'Windows Server 2019', { create: true });
    assert.equal(w2019!.technology_id, w2016!.technology_id);
    await os.setOperatingSystem(mg, tenantId, server, w2019, 'netbox');
    let rows = await marks(runner, tenantId, server);
    assert.deepEqual(rows.map((row: any) => [row.version, row.os]), [['2019', true]], 'Windows Server 2016 is removed');
    assert.notEqual(rows[0].id, first.link_id);

    // Another technology: the old link is removed too.
    const meraki = await os.resolve(mg, tenantId, 'Cisco Meraki', { create: true });
    await os.setOperatingSystem(mg, tenantId, server, meraki, 'manual');
    rows = await marks(runner, tenantId, server);
    assert.deepEqual(rows.map((row: any) => [row.technology_id, row.version, row.os]), [[meraki!.technology_id, null, true]]);

    // The new choice reuses the marked link itself: a versionless mark takes the version in place.
    const ubuntu = await os.resolve(mg, tenantId, 'Ubuntu', { create: true });
    const bare = await os.setOperatingSystem(mg, tenantId, server, ubuntu, 'manual');
    const u2204 = await os.resolve(mg, tenantId, 'Ubuntu 22.04 LTS', { create: true });
    const kept = await os.setOperatingSystem(mg, tenantId, server, u2204, 'manual');
    assert.equal(kept.link_id, bare.link_id, 'the marked link without a version is reused');
    rows = await marks(runner, tenantId, server);
    assert.deepEqual(rows.map((row: any) => [row.version, row.os]), [['22.04 LTS', true]]);

    // A link already installed with the version asked is reused; the old marked link goes.
    const u2404 = await os.resolve(mg, tenantId, 'Ubuntu 24.04 LTS', { create: true });
    const existing = await installed(runner, tenantId, server, u2404!.technology_id, u2404!.technology_version_id, 'import');
    const reused = await os.setOperatingSystem(mg, tenantId, server, u2404, 'manual');
    assert.equal(reused.link_id, existing);
    rows = await marks(runner, tenantId, server);
    assert.deepEqual(rows.map((row: any) => [row.id, row.version, row.os]), [[existing, '24.04 LTS', true]]);
  });
}

async function testLongestPrefixWins() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'os-prefix');
    const os = service();
    const mg = runner.manager;
    const oracle = await technology(runner, tenantId, 60, 'Oracle', 'database');
    const linux = await os.resolve(mg, tenantId, 'Oracle Linux 9', { create: true });
    assert.notEqual(linux!.technology_id, oracle);
    const [row] = await runner.query(
      `SELECT t.name, t.catalog_key, v.label FROM technologies t JOIN technology_versions v ON v.id = $2
        WHERE t.tenant_id = $1 AND t.id = $3`,
      [tenantId, linux!.technology_version_id, linux!.technology_id],
    );
    assert.deepEqual(row, { name: 'Oracle Linux', catalog_key: 'oracle-linux', label: '9' });
    // The tenant's technology still wins when its name is the longer one, or on a tie.
    const db = await os.resolve(mg, tenantId, 'Oracle 19c', { create: true });
    assert.equal(db!.technology_id, oracle);
  });
}

async function testDeletingTheMarkedVersion() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'os-delete-version');
    const os = service();
    const { technologies } = services();
    const mg = runner.manager;
    const server = await asset(runner, tenantId, 'srv');
    const w2019 = await os.resolve(mg, tenantId, 'Windows Server 2019', { create: true });
    await os.setOperatingSystem(mg, tenantId, server, w2019, 'manual');
    const bare = await installed(runner, tenantId, server, w2019!.technology_id, null);
    const result = await technologies.deleteVersion(w2019!.technology_id, w2019!.technology_version_id!, { manager: mg, tenantId, userId: null } as any);
    assert.equal(result.merged_links, 1);
    const rows = await marks(runner, tenantId, server);
    assert.deepEqual(rows.map((r: any) => [r.id, r.version, r.os]), [[bare, null, true]], 'the mark moves to the remaining link');
    assert.equal((await os.labelsOf(mg, tenantId, [server])).get(server), 'Windows Server');
  });
}

async function testAutoMarkOnAdd() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'os-auto');
    const os = service();
    const { links } = services();
    const mg = runner.manager;
    const opts = { manager: mg, tenantId };
    const server = await asset(runner, tenantId, 'srv');
    const cluster = await asset(runner, tenantId, 'cl', true);
    const ubuntu = await technology(runner, tenantId, 1, 'Ubuntu', 'operating_system');
    const debian = await technology(runner, tenantId, 2, 'Debian', 'operating_system');
    const sql = await technology(runner, tenantId, 3, 'SQL Server', 'database');
    const v2204 = await version(runner, tenantId, ubuntu, '22.04 LTS');

    const first = await links.addAssetLink(ubuntu, server, { technology_version_id: v2204 }, opts);
    const marked = await os.onAssetLinkAdded(mg, tenantId, server, first.link_id!, 'manual');
    assert.equal(marked.changed, true);
    assert.equal(marked.link_id, first.link_id);
    let rows = await marks(runner, tenantId, server);
    assert.deepEqual(rows.map((row: any) => [row.technology_id, row.version, row.os]), [[ubuntu, '22.04 LTS', true]]);

    const second = await links.addAssetLink(debian, server, {}, opts);
    const skipped = await os.onAssetLinkAdded(mg, tenantId, server, second.link_id!, 'manual');
    assert.equal(skipped.changed, false);
    rows = await marks(runner, tenantId, server);
    assert.equal(rows.filter((row: any) => row.os).length, 1);
    assert.equal(rows.find((row: any) => row.os).technology_id, ubuntu, 'a second operating system stays unmarked');

    const other = await asset(runner, tenantId, 'db');
    const db = await links.addAssetLink(sql, other, {}, opts);
    const notOs = await os.onAssetLinkAdded(mg, tenantId, other, db.link_id!, 'manual');
    assert.equal(notOs.changed, false);
    assert.equal((await marks(runner, tenantId, other)).filter((row: any) => row.os).length, 0);

    const onCluster = await links.addAssetLink(ubuntu, cluster, { technology_version_id: v2204 }, opts);
    const clusterMark = await os.onAssetLinkAdded(mg, tenantId, cluster, onCluster.link_id!, 'manual');
    assert.equal(clusterMark.changed, false);
    assert.equal((await marks(runner, tenantId, cluster)).filter((row: any) => row.os).length, 0);
  });
}

/** Removing the marked link passes the mark to the oldest remaining operating system, under the asset row lock. */
async function testRemovingTheMarkedLinkPassesTheMark() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'os-pass');
    const os = service();
    const { links } = services();
    const mg = runner.manager;
    const opts = { manager: mg, tenantId };
    const server = await asset(runner, tenantId, 'srv');
    const cluster = await asset(runner, tenantId, 'cl', true);
    const ubuntu = await technology(runner, tenantId, 1, 'Ubuntu', 'operating_system');
    const debian = await technology(runner, tenantId, 2, 'Debian', 'operating_system');
    const windows = await technology(runner, tenantId, 3, 'Windows', 'operating_system');
    const sql = await technology(runner, tenantId, 4, 'SQL Server', 'database');
    const ubuntuLink = await installed(runner, tenantId, server, ubuntu);
    const debianLink = await installed(runner, tenantId, server, debian);
    const windowsLink = await installed(runner, tenantId, server, windows);
    const sqlLink = await installed(runner, tenantId, server, sql);
    // One transaction shares now(), so the ages are written explicitly.
    await runner.query(`UPDATE asset_technologies SET created_at = $2 WHERE tenant_id = $1 AND id = $3`, [tenantId, '2010-01-01', sqlLink]);
    await runner.query(`UPDATE asset_technologies SET created_at = $2 WHERE tenant_id = $1 AND id = $3`, [tenantId, '2018-01-01', debianLink]);
    await runner.query(`UPDATE asset_technologies SET created_at = $2 WHERE tenant_id = $1 AND id = $3`, [tenantId, '2020-01-01', windowsLink]);
    await runner.query(`UPDATE asset_technologies SET created_at = $2 WHERE tenant_id = $1 AND id = $3`, [tenantId, '2022-01-01', ubuntuLink]);
    await os.onAssetLinkAdded(mg, tenantId, server, ubuntuLink, 'manual');

    const remove = (assetId: string, linkId: string, checkLock = false) => os.onInstalledLinkRemoved(
      mg, tenantId, assetId, linkId,
      async () => {
        if (checkLock) {
          const locks = await runner.query(
            `SELECT l.mode FROM pg_locks l
               JOIN pg_class c ON c.oid = l.relation
              WHERE l.pid = pg_backend_pid() AND c.relname = 'assets' AND l.granted`,
          );
          assert.ok(locks.some((row: { mode: string }) => row.mode === 'RowShareLock'), 'the asset row stays locked across the removal');
        }
        return links.removeAssetLinkOfAsset(assetId, linkId, opts);
      },
    );

    await remove(server, windowsLink, true);
    let rows = await marks(runner, tenantId, server);
    assert.equal(rows.find((row: any) => row.id === ubuntuLink).os, true, 'removing another operating system keeps the mark');
    assert.ok(!rows.some((row: any) => row.id === windowsLink));

    await remove(server, ubuntuLink);
    rows = await marks(runner, tenantId, server);
    assert.deepEqual(
      rows.map((row: any) => [row.id, row.os]).sort(),
      [[debianLink, true], [sqlLink, false]].sort(),
      'the oldest operating system takes the mark, not an older technology of another family',
    );

    await remove(server, debianLink);
    rows = await marks(runner, tenantId, server);
    assert.deepEqual(rows.map((row: any) => [row.id, row.os]), [[sqlLink, false]], 'no operating system left means no mark');

    const clusterMarked = await installed(runner, tenantId, cluster, ubuntu);
    const clusterOther = await installed(runner, tenantId, cluster, debian);
    await runner.query(`UPDATE asset_technologies SET is_operating_system = true WHERE tenant_id = $1 AND id = $2`, [tenantId, clusterMarked]);
    await remove(cluster, clusterMarked);
    const clusterRows = await marks(runner, tenantId, cluster);
    assert.deepEqual(clusterRows.map((row: any) => [row.id, row.os]), [[clusterOther, false]], 'a cluster does not receive the mark');
  });
}

void runSpecs('Operating system resolver', [
  ['resolve and mark', testResolveAndMark],
  ['changing the operating system removes the old link', testChangingTheOperatingSystem],
  ['the longest prefix wins between tenant and catalog', testLongestPrefixWins],
  ['deleting the marked version keeps an operating system', testDeletingTheMarkedVersion],
  ['adding an operating-system technology marks it when none is set', testAutoMarkOnAdd],
  ['removing the marked link passes the mark to the oldest operating system', testRemovingTheMarkedLinkPassesTheMark],
]);
