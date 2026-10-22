// @database-spec
import 'dotenv/config';
import type { QueryRunner } from 'typeorm';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologiesService } from '../technologies.service';
import { TechnologyReachService } from '../technology-reach.service';
import type { AuditEntry } from './technologies.fixtures';

// The alert switch of a base release (SUSE Linux Enterprise Server 11) writes the same value on
// its service packs, in the same transaction. A service pack changed on its own leaves the base
// release. Windows Server 2012 and 2012 R2 stay two versions, and a product outside
// SERVICE_PACK_PRODUCTS does not propagate on the label alone.

const SLES = ['o:suse:linux_enterprise_server'];
const WINDOWS = ['o:microsoft:windows_server_2012'];

type Opts = { manager: QueryRunner['manager']; tenantId: string; userId?: string | null };
type VersionRow = { label: string; vulnerability_alerts: boolean | null; vulnerability_alerts_effective: boolean };

function technologiesOf(audit: AuditEntry[], events: unknown[]) {
  const itOps = {
    getSettings: async () => ({
      technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES,
      hostingTypes: DEFAULT_HOSTING_TYPES,
      lifecycleStates: [{ code: 'active' }],
      cyberCriticalityLevels: [],
      recoveryWaves: [],
    }),
  };
  return new TechnologiesService(
    { log: async (entry: AuditEntry) => void audit.push(entry) } as any,
    itOps as any,
    new TechnologyReachService(),
    {} as any,
    { emit: async (event: unknown) => void events.push(event) } as any,
  );
}

function flags(versions: VersionRow[]) {
  return versions
    .map((version) => [version.label, version.vulnerability_alerts, version.vulnerability_alerts_effective])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

async function testServicePackAlerts() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'sp-alerts');
    const otherId = await seedTenant(runner, 'sp-alerts-b');
    await setTenant(runner, tenantId);
    const audit: AuditEntry[] = [];
    const events: unknown[] = [];
    const technologies = technologiesOf(audit, events);
    const opts: Opts = { manager: runner.manager, tenantId, userId: 'user-1' };
    const sles = await technologies.create({
      name: 'SUSE Linux Enterprise Server', family: 'operating_system', cpe_products: SLES,
    }, opts);
    assert.equal(sles.vulnerability_alerts, false, 'an operating system starts excluded');
    const labels = ['11', '11 SP1', '11 SP2', '12 SP1', '15', '15 SP5', '15.5'];
    for (const label of labels) await technologies.createVersion(sles.id, { label }, opts);

    const windows = await technologies.create({
      name: 'Windows Server', family: 'operating_system', cpe_products: WINDOWS,
    }, opts);
    await technologies.createVersion(windows.id, { label: '2012' }, opts);
    await technologies.createVersion(windows.id, { label: '2012 R2' }, opts);
    // The same labels as a service pack, on a product that does not file them that way.
    const named = await technologies.create({
      name: 'Windows custom', family: 'operating_system', cpe_products: ['o:microsoft:windows_server'],
    }, opts);
    await technologies.createVersion(named.id, { label: '11' }, opts);
    await technologies.createVersion(named.id, { label: '11 SP1' }, opts);

    await setTenant(runner, otherId);
    const otherOpts: Opts = { manager: runner.manager, tenantId: otherId, userId: 'user-2' };
    const other = await technologies.create({
      name: 'SUSE Linux Enterprise Server', family: 'operating_system', cpe_products: SLES,
    }, otherOpts);
    const otherRoot = await technologies.createVersion(other.id, { label: '11' }, otherOpts);
    await technologies.createVersion(other.id, { label: '11 SP1' }, otherOpts);
    await setTenant(runner, tenantId);

    const quiet = events.length;
    const mark = audit.length;
    const root = (await technologies.get(sles.id, opts)).versions.find((version) => version.label === '11')!;
    const turnedOn = await technologies.updateVersion(sles.id, root.id, { vulnerability_alerts: true }, opts);
    assert.equal(turnedOn.vulnerability_alerts, true);
    assert.equal(turnedOn.vulnerability_alerts_effective, true);
    assert.deepEqual(
      (turnedOn.updated_versions ?? []).map((version) => version.label).sort(),
      ['11', '11 SP1', '11 SP2'],
    );
    assert.equal(events.length, quiet, 'the alert setting matches nothing again, packs included');

    const on = await technologies.get(sles.id, opts);
    assert.deepEqual(
      flags(on.versions.filter((version) => version.label.startsWith('11'))),
      [['11', true, true], ['11 SP1', true, true], ['11 SP2', true, true]],
    );
    assert.equal(on.versions.find((version) => version.label === '12 SP1')?.vulnerability_alerts, null, 'another release stays');
    assert.ok(on.versions.filter((version) => version.label.startsWith('15')).every((version) => version.vulnerability_alerts === null));

    const packAudit = audit.slice(mark).filter((entry) => entry.table === 'technology_versions' && entry.action === 'update');
    assert.equal(packAudit.length, 3, 'the base release and each pack that changed');
    assert.ok(packAudit.every((entry) => entry.recordId === sles.id));
    assert.deepEqual(
      packAudit
        .map((entry) => [(entry.before as VersionRow).label, (entry.after as VersionRow).vulnerability_alerts])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [['11', true], ['11 SP1', true], ['11 SP2', true]],
    );

    const sp1 = on.versions.find((version) => version.label === '11 SP1')!;
    const alone = audit.length;
    const silenced = await technologies.updateVersion(sles.id, sp1.id, { vulnerability_alerts: false }, opts);
    assert.equal(silenced.vulnerability_alerts, false);
    assert.equal(silenced.updated_versions, undefined, 'a service pack does not carry its release');
    const afterAlone = await technologies.get(sles.id, opts);
    assert.equal(afterAlone.versions.find((version) => version.label === '11')?.vulnerability_alerts, true);
    assert.equal(afterAlone.versions.find((version) => version.label === '11 SP2')?.vulnerability_alerts, true);
    assert.equal(afterAlone.versions.find((version) => version.label === '11 SP1')?.vulnerability_alerts, false);
    assert.equal(audit.length, alone + 1, 'only the pack that was changed');

    const v15 = afterAlone.versions.find((version) => version.label === '15')!;
    const dotted = await technologies.updateVersion(sles.id, v15.id, { vulnerability_alerts: true }, opts);
    assert.deepEqual(
      (dotted.updated_versions ?? []).map((version) => version.label).sort(),
      ['15', '15 SP5', '15.5'],
    );
    const withDotted = await technologies.get(sles.id, opts);
    assert.equal(withDotted.versions.find((version) => version.label === '15.5')?.vulnerability_alerts_effective, true);
    assert.equal(withDotted.versions.find((version) => version.label === '11 SP1')?.vulnerability_alerts, false, 'the other release stays');

    // The same stored value, including null (follow the technology): the pack set off on its own follows too.
    const cleared = await technologies.updateVersion(sles.id, root.id, { vulnerability_alerts: null }, opts);
    assert.deepEqual((cleared.updated_versions ?? []).map((version) => version.label).sort(), ['11', '11 SP1', '11 SP2']);
    const followed = await technologies.get(sles.id, opts);
    assert.ok(followed.versions.filter((version) => version.label.startsWith('11')).every((version) => version.vulnerability_alerts === null));

    const win2012 = (await technologies.get(windows.id, opts)).versions.find((version) => version.label === '2012')!;
    const winOn = await technologies.updateVersion(windows.id, win2012.id, { vulnerability_alerts: true }, opts);
    assert.equal(winOn.updated_versions, undefined);
    const win = await technologies.get(windows.id, opts);
    assert.equal(win.versions.find((version) => version.label === '2012')?.vulnerability_alerts, true);
    assert.equal(win.versions.find((version) => version.label === '2012 R2')?.vulnerability_alerts, null, '2012 R2 is another version');

    const custom11 = (await technologies.get(named.id, opts)).versions.find((version) => version.label === '11')!;
    const customOn = await technologies.updateVersion(named.id, custom11.id, { vulnerability_alerts: true }, opts);
    assert.equal(customOn.updated_versions, undefined);
    const custom = await technologies.get(named.id, opts);
    assert.equal(custom.versions.find((version) => version.label === '11 SP1')?.vulnerability_alerts, null, 'the label is not enough');

    const matched = events.length;
    await technologies.updateVersion(sles.id, root.id, { vulnerability_alerts: true, cpe_version: '11' }, opts);
    assert.equal(events.length, matched + 1, 'another field matches the technology once, not once per pack');
    const rematched = await technologies.get(sles.id, opts);
    assert.equal(rematched.versions.find((version) => version.label === '11')?.cpe_version, '11');
    assert.equal(rematched.versions.find((version) => version.label === '11 SP1')?.vulnerability_alerts, true);
    assert.equal(rematched.versions.find((version) => version.label === '11 SP2')?.vulnerability_alerts, true);
    assert.equal(rematched.versions.find((version) => version.label === '11 SP1')?.cpe_version, null, 'the pack keeps its own fields');

    await setTenant(runner, otherId);
    const kept = await technologies.get(other.id, otherOpts);
    assert.equal(kept.versions.find((version) => version.id === otherRoot.id)?.vulnerability_alerts, null);
    assert.equal(kept.versions.find((version) => version.label === '11 SP1')?.vulnerability_alerts, null, 'the other tenant stays');
  });
}

runSpecs('service-pack-alerts.integration.spec', [
  ['service pack alerts', testServicePackAlerts],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
