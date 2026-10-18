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

void runSpecs('Operating system resolver', [
  ['resolve and mark', testResolveAndMark],
  ['changing the operating system removes the old link', testChangingTheOperatingSystem],
  ['the longest prefix wins between tenant and catalog', testLongestPrefixWins],
  ['deleting the marked version keeps an operating system', testDeletingTheMarkedVersion],
]);
