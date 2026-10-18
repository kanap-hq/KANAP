// @database-spec
import 'dotenv/config';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
import { OperatingSystemService } from '../operating-system.service';
import { asset, installed, technology, version } from './technologies.fixtures';

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

void runSpecs('Operating system resolver', [
  ['resolve and mark', testResolveAndMark],
]);
