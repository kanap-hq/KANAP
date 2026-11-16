// @database-spec
import 'dotenv/config';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
import { OperatingSystemService } from '../operating-system.service';
import { resolveVersionLabel, versionOfInput } from '../technology-rows';
import { matchVersionLabel } from '../version-label-match';
import { technology, version } from './technologies.fixtures';

// Lot I3 of 26.11.9 (T-I3e): a version label finds the catalog's version of the technology when one
// version only answers a prefix rule (`22.04` finds `22.04 LTS`, `2022 Datacenter` finds `2022`, the
// longest of several prefixes wins). The same rule for an operating system's label (servers, Netbox,
// the assistant) and for a label a screen, Kad or an agent writes. A match the person undid, and a
// label no rule answers (`22.04.3 LTS`), create the version as written.

function service() {
  const audit = { log: async () => undefined };
  const itOps = {
    getSettings: async () => ({ technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, hostingTypes: DEFAULT_HOSTING_TYPES }),
  };
  return new OperatingSystemService(audit as any, itOps as any, new TechnologyCatalogService(audit as any, itOps as any));
}

const labels = (...values: string[]) => values.map((label) => ({ label }));

async function testTheRule() {
  const ubuntu = labels('26.04 LTS', '24.04 LTS', '22.04 LTS', '20.04 LTS');
  const windows = labels('2022', '2019', '2012 R2', '2012');
  const found = (rows: Array<{ label: string }>, written: string, prefix = true) => {
    const match = matchVersionLabel(rows, written, { prefix });
    return match.kind === 'none' ? 'none' : `${match.kind}:${match.row.label}`;
  };
  assert.equal(found(ubuntu, '22.04'), 'prefix:22.04 LTS');
  assert.equal(found(ubuntu, '22.04 lts'), 'exact:22.04 LTS', 'the same label, case aside');
  assert.equal(found(windows, '2022 Datacenter'), 'prefix:2022');
  assert.equal(found(windows, '2012 R2 Datacenter'), 'prefix:2012 R2', 'the longest prefix wins');
  assert.equal(found(ubuntu, '22.04.3 LTS'), 'none', 'no rule answers: created');
  assert.equal(found(ubuntu, '2'), 'none', 'a bare digit names no version');
  assert.equal(found(labels('2022 Standard', '2022 Datacenter'), '2022'), 'none', 'two candidates: no match');
  assert.equal(found(ubuntu, '22.04', false), 'none', 'an undone match keeps the equality alone');
}

async function osVersion(runner: any, tenantId: string, versionId: string | null) {
  if (!versionId) return null;
  const [row] = await runner.query(
    `SELECT label, to_char(standard_support_end, 'YYYY-MM-DD') AS std, catalog_key FROM technology_versions WHERE tenant_id = $1 AND id = $2`,
    [tenantId, versionId],
  );
  return row;
}

async function testOperatingSystemLabels() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'version-label-os');
    const os = service();
    const resolved = async (label: string, exactVersion = false) => {
      const result = await os.resolve(runner.manager, tenantId, label, { create: true, exactVersion });
      return osVersion(runner, tenantId, result?.technology_version_id ?? null);
    };
    const ubuntu = await resolved('Ubuntu 22.04');
    assert.equal(ubuntu.label, '22.04 LTS', 'Ubuntu 22.04 is the catalog version');
    assert.equal(ubuntu.std, '2027-06-01', 'with its end of support');
    assert.equal((await resolved('Windows Server 2022 Datacenter')).label, '2022');
    assert.equal((await resolved('Windows Server 2012 R2 Datacenter')).label, '2012 R2');
    assert.equal((await resolved('Ubuntu 22.04.3 LTS')).label, '22.04.3 LTS', 'no rule answers: created as written');
    assert.equal((await resolved('Ubuntu 2')).label, '2', 'no candidate: created as written');
    assert.equal((await resolved('Ubuntu 22.04', true)).label, '22.04', 'an undone match creates the version as written');

    const preview = await os.preview(runner.manager, tenantId, 'Ubuntu 20.04');
    assert.deepEqual(preview, { label: 'Ubuntu 20.04 LTS', technology: 'tenant', written: '20.04', version: { how: 'prefix', label: '20.04 LTS' } });
    assert.deepEqual(
      await os.preview(runner.manager, tenantId, 'Debian 12'),
      { label: 'Debian 12 (Bookworm)', technology: 'catalog', written: '12', version: { how: 'prefix', label: '12 (Bookworm)' } },
      'a product not adopted yet is previewed on its catalog versions',
    );
    const debian = await runner.query(`SELECT 1 FROM technologies WHERE tenant_id = $1 AND name = 'Debian'`, [tenantId]);
    assert.equal(debian.length, 0, 'the preview writes nothing');
    assert.deepEqual(
      await os.preview(runner.manager, tenantId, 'Ubuntu 23.10'),
      { label: 'Ubuntu 23.10', technology: 'tenant', written: '23.10', version: { how: 'created', label: '23.10' } },
    );
    assert.deepEqual(
      await os.preview(runner.manager, tenantId, 'Ubuntu 22.04', { exactVersion: true }),
      { label: 'Ubuntu 22.04', technology: 'tenant', written: '22.04', version: { how: 'exact', label: '22.04' } },
      'the version created by the undone match is found as written',
    );
  });
}

async function testScreensAndKad() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'version-label-screens');
    const tech = await technology(runner, tenantId, 1, 'Contoso DB');
    const sp1 = await version(runner, tenantId, tech, '15 SP1');
    const sixteen = await version(runner, tenantId, tech, '16');
    const found = await resolveVersionLabel(runner.manager, tenantId, tech, '15', { create: false });
    assert.equal(found?.id, sp1, 'a screen or Kad finds 15 SP1 by 15');
    assert.equal(await versionOfInput(runner.manager, tenantId, tech, { version_label: '16 Enterprise' }), sixteen);
    const asWritten = await versionOfInput(runner.manager, tenantId, tech, { version_label: '15', version_label_as_written: true });
    assert.notEqual(asWritten, sp1, 'a label kept as written is its own version');
    const [row] = await runner.query(`SELECT label FROM technology_versions WHERE tenant_id = $1 AND id = $2`, [tenantId, asWritten]);
    assert.equal(row.label, '15');
  });
}

void runSpecs('version-label-rule.integration.spec.ts', [
  ['the rule', testTheRule],
  ['operating systems', testOperatingSystemLabels],
  ['screens and Kad', testScreensAndKad],
]);
