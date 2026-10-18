import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { NetboxConfigService } from '../netbox-config.service';
import { NetboxSyncService } from '../netbox-sync.service';
import { NetboxApiError } from '../netbox.types';
import {
  NETBOX_VIRTUAL_MACHINES_SLUG,
  NetboxCatalogs,
  mapNetboxObject,
  normalizeNetboxDevice,
  suggestOperatingSystem,
} from '../netbox-mapper';

// The operating system of an imported object. Netbox says "Debian 12", KANAP
// says "Debian 12 (bookworm)": a saved match settles it, and the Mappings tab
// pre-fills that match with a suggestion. Unlike roles and sites, this match is
// NOT an import filter — an unmatched platform costs the object nothing.

const BASE_URL = 'https://netbox.example.test';

const OPERATING_SYSTEMS = [
  { code: 'Debian 12 (bookworm)', label: 'Debian 12 (bookworm)' },
  { code: 'Debian 11 (bullseye)', label: 'Debian 11 (bullseye)' },
  { code: 'Windows Server 2022', label: 'Windows Server 2022' },
  { code: 'VMware ESXi 8', label: 'VMware ESXi 8' },
];

const CATALOGS: NetboxCatalogs = {
  assetKinds: [{ code: 'physical_server', label: 'Physical server' }],
  assetProviders: [{ code: 'other', label: 'Other' }],
  operatingSystems: OPERATING_SYSTEMS,
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  ipAddressTypes: [{ code: 'host', label: 'Host' }],
  domains: [],
  subnets: [],
  locations: [{ id: 'loc-paris', name: 'Paris DC', provider: null }],
};

const MAP_OPTIONS = {
  roleMap: { server: 'physical_server', [NETBOX_VIRTUAL_MACHINES_SLUG]: 'physical_server' },
  siteMap: { paris: 'loc-paris' },
  defaultEnvironment: 'prod',
  catalogs: CATALOGS,
  locations: null,
};

function device(platform: Record<string, unknown> | null) {
  return normalizeNetboxDevice({
    id: 1,
    name: 'par-app-01',
    role: { slug: 'server', name: 'Server' },
    site: { slug: 'paris', name: 'Paris DC' },
    status: { value: 'active' },
    ...(platform ? { platform } : {}),
  }, BASE_URL);
}

// --- the suggestion --------------------------------------------------------

const suggest = (name: unknown) => suggestOperatingSystem(name, OPERATING_SYSTEMS)?.code ?? null;

// An exact match on the name, on the code, and whatever the case and spacing.
assert.equal(suggest('Debian 12 (bookworm)'), 'Debian 12 (bookworm)');
assert.equal(suggest('VMware ESXi 8'), 'VMware ESXi 8');
assert.equal(suggest('  windows server 2022  '), 'Windows Server 2022');

// The case this whole mapping exists for: Netbox is less precise than KANAP.
assert.equal(suggest('Debian 12'), 'Debian 12 (bookworm)');
assert.equal(suggest('Windows Server'), 'Windows Server 2022');

// The prefix must end on a boundary: "Debian 1" is not the start of a word in
// "Debian 12 (bookworm)", so it suggests nothing at all.
assert.equal(suggest('Debian 1'), null);
assert.equal(suggest('Deb'), null);

// Two candidates mean the administrator chooses: no suggestion is made.
assert.equal(suggest('Debian'), null);

// Nothing to go on, and a platform nothing in the catalog resembles.
assert.equal(suggest(''), null);
assert.equal(suggest(null), null);
assert.equal(suggest('Photon OS'), null);

// --- resolution order on an object -----------------------------------------

// No match saved: the exact comparison still works exactly as before.
{
  const mapped = mapNetboxObject(device({ slug: 'debian-12', name: 'Debian 12 (bookworm)' }), MAP_OPTIONS);
  assert.equal(mapped.asset?.operating_system, 'Debian 12 (bookworm)');
  assert.deepEqual(mapped.warnings, []);
}

// No match saved and no exact one: the notice an administrator acts on.
{
  const mapped = mapNetboxObject(device({ slug: 'debian-12', name: 'Debian 12' }), MAP_OPTIONS);
  assert.equal(mapped.asset?.operating_system, null);
  assert.equal(mapped.warnings[0]?.code, 'os_not_in_catalog');
  // An unmatched platform never costs the object its import.
  assert.equal(mapped.skipReason, null);
  assert.ok(mapped.asset);
}

// The saved match settles it, keyed on the slug, and silences the notice.
{
  const mapped = mapNetboxObject(device({ slug: 'debian-12', name: 'Debian 12' }), {
    ...MAP_OPTIONS,
    osMap: { 'debian-12': 'Debian 12 (bookworm)' },
  });
  assert.equal(mapped.asset?.operating_system, 'Debian 12 (bookworm)');
  assert.deepEqual(mapped.warnings, []);
  assert.equal(mapped.display.operating_system, 'Debian 12 (bookworm)');
}

// The saved match wins over an exact match on the name.
{
  const mapped = mapNetboxObject(device({ slug: 'esxi', name: 'VMware ESXi 8' }), {
    ...MAP_OPTIONS,
    osMap: { esxi: 'Debian 12 (bookworm)' },
  });
  assert.equal(mapped.asset?.operating_system, 'Debian 12 (bookworm)');
}

// A saved match is a label for the operating-system resolver, which finds a
// technology of any family: it is kept even when the proposed choices (operating
// systems first) do not list it, so a VMware ESXi host keeps its operating system.
{
  const mapped = mapNetboxObject(device({ slug: 'esxi', name: 'VMware ESXi 8' }), {
    ...MAP_OPTIONS,
    osMap: { esxi: 'VMware ESXi 8.0' },
  });
  assert.equal(mapped.asset?.operating_system, 'VMware ESXi 8.0');
  assert.deepEqual(mapped.warnings, []);
  assert.equal(mapped.display.operating_system, 'VMware ESXi 8.0');
}
{
  const mapped = mapNetboxObject(device({ slug: 'meraki', name: 'Meraki' }), {
    ...MAP_OPTIONS,
    osMap: { meraki: 'Cisco Meraki' },
  });
  assert.equal(mapped.asset?.operating_system, 'Cisco Meraki');
  assert.deepEqual(mapped.warnings, []);
}

// A saved match that differs from a choice only by case takes the choice's spelling.
{
  const mapped = mapNetboxObject(device({ slug: 'debian-12', name: 'Debian 12' }), {
    ...MAP_OPTIONS,
    osMap: { 'debian-12': 'debian 12 (BOOKWORM)' },
  });
  assert.equal(mapped.asset?.operating_system, 'Debian 12 (bookworm)');
}

// No platform at all: nothing is resolved and nothing is warned about.
{
  const mapped = mapNetboxObject(device(null), { ...MAP_OPTIONS, osMap: { photon: 'vmware_esxi_8' } });
  assert.equal(mapped.asset?.operating_system, null);
  assert.deepEqual(mapped.warnings, []);
}

// --- saving the matches ----------------------------------------------------

function harness(initial: Record<string, unknown>) {
  const config: any = {
    tenant_id: 'tenant-1',
    base_url: BASE_URL,
    enabled: true,
    credential_ref_json: null,
    metadata_json: initial,
  };
  const manager: any = {
    getRepository: () => ({
      findOne: async () => config,
      save: async (entity: unknown) => entity,
    }),
  };
  return { config, manager, service: new NetboxConfigService({ canEncrypt: () => true } as any) };
}

async function main() {
  // A page that does not know about the operating systems sends the two other
  // maps only. The saved matches must survive that, not be wiped by it.
  {
    const { config, manager, service } = harness({
      role_map: { server: 'physical_server' },
      site_map: { paris: 'loc-paris' },
      os_map: { 'debian-12': 'debian_12_bookworm' },
    });
    const view = await service.saveMapping(manager, 'tenant-1', {
      role_map: { server: 'physical_server' },
      site_map: { paris: 'loc-paris' },
    });
    assert.deepEqual(view.os_map, { 'debian-12': 'debian_12_bookworm' });
    assert.deepEqual(config.metadata_json.os_map, { 'debian-12': 'debian_12_bookworm' });
  }

  // Sent, it replaces the stored one in full, and an empty choice drops a row.
  {
    const { config, manager, service } = harness({
      os_map: { 'debian-12': 'debian_12_bookworm', esxi: 'vmware_esxi_8' },
    });
    const view = await service.saveMapping(manager, 'tenant-1', {
      role_map: {},
      site_map: {},
      os_map: { esxi: 'vmware_esxi_8', photon: '  ' },
    });
    assert.deepEqual(view.os_map, { esxi: 'vmware_esxi_8' });
    assert.deepEqual(config.metadata_json.os_map, { esxi: 'vmware_esxi_8' });
  }

  // Sent as anything but a list of matches, it is refused like the other two.
  for (const os_map of ['debian-12', ['debian-12'], 12, true]) {
    const { manager, service } = harness({});
    await assert.rejects(
      () => service.saveMapping(manager, 'tenant-1', { role_map: {}, site_map: {}, os_map }),
      BadRequestException,
    );
  }

  // Nothing saved yet reads as no match, never as undefined.
  {
    const { config, service } = harness({});
    assert.deepEqual(service.getMapping(config).os_map, {});
  }

  // --- the platforms are read on their own account --------------------------

  // Netbox grants permissions per object type, so a token that reads devices,
  // roles and sites may still be refused the platforms. The whole Mappings tab
  // used to depend on that one call succeeding.
  function mappingOptionsHarness(listPlatforms: () => Promise<unknown>) {
    const client: any = {
      listRoles: async () => [{ slug: 'server', name: 'Server', device_count: 3, vm_count: 0 }],
      listSites: async () => [{ slug: 'paris', name: 'Paris DC', device_count: 3, vm_count: 0 }],
      listPlatforms,
      countVirtualMachines: async () => 2,
    };
    const config: any = {
      getConfig: async () => ({ metadata_json: {} }),
      toView: () => ({ configured: true }),
      buildConnection: () => ({ baseUrl: BASE_URL, token: 'secret' }),
      getMapping: () => ({ role_map: {}, site_map: {}, os_map: {} }),
    };
    const itOpsSettings: any = {
      getSettings: async () => ({
        serverKinds: [{ code: 'physical_server', label: 'Server' }],
      }),
    };
    const manager: any = { query: async () => [{ id: 'loc-1', name: 'Paris DC' }] };
    const operatingSystems = { mappingChoices: async () => OPERATING_SYSTEMS };
    const service = new NetboxSyncService({} as any, config, client, itOpsSettings, {} as any, {} as any, operatingSystems as any);
    return { service, manager };
  }

  // Refused the platforms: the roles and the sites still come back, and the
  // page is told why the operating systems cannot be matched.
  {
    const { service, manager } = mappingOptionsHarness(async () => {
      throw new NetboxApiError('forbidden', 'This Netbox token may not read that.');
    });
    const options: any = await service.mappingOptions(manager, 'tenant-1');
    assert.equal(options.platforms_unavailable, true);
    assert.deepEqual(options.platforms, []);
    assert.deepEqual(options.suggested_os_map, {});
    // What the tab actually needs is untouched.
    assert.deepEqual(options.roles.map((role: any) => role.slug), [NETBOX_VIRTUAL_MACHINES_SLUG, 'server']);
    assert.deepEqual(options.sites.map((site: any) => site.slug), ['paris']);
    assert.equal(options.locations.length, 1);
  }

  // Read normally: the flag stays down and the suggestion is made.
  {
    const { service, manager } = mappingOptionsHarness(async () => [
      { slug: 'debian-12', name: 'Debian 12', device_count: 1, vm_count: 4 },
    ]);
    const options: any = await service.mappingOptions(manager, 'tenant-1');
    assert.equal(options.platforms_unavailable, false);
    assert.deepEqual(options.platforms.map((entry: any) => entry.slug), ['debian-12']);
    assert.deepEqual(options.suggested_os_map, { 'debian-12': 'Debian 12 (bookworm)' });
  }

  // A role or site failure is still a failure: those two decide the import.
  {
    const { service, manager } = mappingOptionsHarness(async () => []);
    (service as any).client.listRoles = async () => {
      throw new NetboxApiError('forbidden', 'This Netbox token may not read that.');
    };
    await assert.rejects(() => service.mappingOptions(manager, 'tenant-1'), BadRequestException);
  }

  console.log('netbox-os-mapping.spec.ts OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
