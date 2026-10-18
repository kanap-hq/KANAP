import * as assert from 'node:assert/strict';
import {
  NETBOX_VIRTUAL_MACHINES_NAME,
  NETBOX_VIRTUAL_MACHINES_SLUG,
  NetboxCatalogs,
  mapNetboxObject,
  normalizeNetboxDevice,
  normalizeNetboxVirtualMachine,
  rootNetboxLocation,
} from '../netbox-mapper';
import { ExistingAsset, buildMatcherIndex, matchNetboxObject } from '../netbox-matcher';
import { primaryNotice } from '../netbox-notice';
import {
  ExistingLink,
  ExistingSubLocation,
  NetboxDecision,
  NetboxPlanRow,
  buildReviewBatch,
  isWriteDeferred,
  planNetboxSync,
  subLocationUpkeepNotices,
} from '../netbox-planner';
import { NetboxObject } from '../netbox.types';

// Unit spec for the pure half of the Netbox sync: normalisation, mapping,
// the deduplication cascade and the planner, over the matrix from the plan.
// No database and no HTTP, so it runs standalone under ts-node like the other
// __tests__ specs.

const BASE_URL = 'https://netbox.example.test';

const CATALOGS: NetboxCatalogs = {
  assetKinds: [
    { code: 'physical_server', label: 'Physical server' },
    { code: 'virtual_server', label: 'Virtual server' },
  ],
  // The defaults a tenant gets: no 'on_prem' entry, which is exactly the case
  // that used to make every creation fail.
  assetProviders: [
    { code: 'aws', label: 'AWS' },
    { code: 'azure', label: 'Azure' },
    { code: 'gcp', label: 'GCP' },
    { code: 'other', label: 'Other' },
  ],
  operatingSystems: [
    { code: 'VMware ESXi 8', label: 'VMware ESXi 8' },
    { code: 'Debian 12', label: 'Debian 12' },
  ],
  lifecycleStates: [
    { code: 'proposed', label: 'Proposed' },
    { code: 'active', label: 'Active' },
    { code: 'deprecated', label: 'Deprecated' },
    { code: 'retired', label: 'Retired' },
  ],
  ipAddressTypes: [
    { code: 'host', label: 'Host' },
    { code: 'management', label: 'Management' },
  ],
  domains: [
    { code: 'fromage', label: 'Fromage', dns_suffix: 'fromage.lan' },
  ],
  subnets: [{ cidr: '10.10.0.0/16' }],
  locations: [
    // A plain on-premise location with no provider of its own, and one with a
    // provider that is not in the catalog either: both must still produce a
    // provider the asset service accepts.
    { id: 'loc-paris', name: 'Paris DC', provider: null },
    { id: 'loc-lyon', name: 'Lyon Warehouse', provider: 'aws' },
  ],
};

const MAP_OPTIONS = {
  roleMap: { server: 'physical_server', [NETBOX_VIRTUAL_MACHINES_SLUG]: 'virtual_server' },
  siteMap: { paris: 'loc-paris', lyon: 'loc-lyon' },
  defaultEnvironment: 'prod',
  catalogs: CATALOGS,
  // Locations unavailable by default: every case that does not opt in must
  // behave exactly as the feature did before sub-locations existed.
  locations: null,
};

/** A Netbox Location index, keyed by id, with the parents a walk needs. */
function locationIndex(
  entries: Array<{ id: string; name: string; parentId?: string | null; siteSlug?: string | null; description?: string | null }>,
): Map<string, { id: string; name: string; description: string | null; parentId: string | null; siteSlug: string | null; url: string }> {
  return new Map(entries.map((entry) => [entry.id, {
    id: entry.id,
    name: entry.name,
    description: entry.description ?? null,
    parentId: entry.parentId ?? null,
    siteSlug: entry.siteSlug ?? 'paris',
    url: `${BASE_URL}/dcim/locations/${entry.id}/`,
  }]));
}

function device(overrides: Record<string, unknown> = {}): NetboxObject {
  return normalizeNetboxDevice({
    id: 1,
    name: 'par-esx-01.fromage.lan',
    serial: 'SN-0001',
    role: { slug: 'server', name: 'Server' },
    site: { slug: 'paris', name: 'Paris DC' },
    status: { value: 'active', label: 'Active' },
    platform: { name: 'VMware ESXi 8' },
    device_type: { model: 'PowerEdge R750', manufacturer: { name: 'Dell' } },
    rack: { name: 'R1' },
    position: 12,
    primary_ip4: { address: '10.10.1.5/24' },
    ...overrides,
  }, BASE_URL);
}

function asset(overrides: Partial<ExistingAsset> = {}): ExistingAsset {
  return {
    id: 'asset-1',
    name: 'par-esx-01',
    asset_reference: 'AST-4',
    status: 'active',
    kind: 'physical_server',
    location_id: 'loc-paris',
    sub_location_id: null,
    hostname: 'par-esx-01',
    domain: 'fromage',
    fqdn: 'par-esx-01.fromage.lan',
    operating_system: 'VMware ESXi 8',
    ip_addresses: [{ type: 'host', ip: '10.10.1.5', subnet_cidr: '10.10.0.0/16' }],
    serial_number: 'SN-0001',
    manufacturer: 'Dell',
    model: 'PowerEdge R750',
    rack_location: 'R1',
    rack_unit: '12',
    ...overrides,
  };
}

function plan(input: {
  objects: NetboxObject[];
  assets?: ExistingAsset[];
  links?: ExistingLink[];
  fetchOk?: boolean;
  decisions?: NetboxDecision[];
  subLocations?: ExistingSubLocation[];
  locations?: ReturnType<typeof locationIndex> | null;
  siteMap?: Record<string, string>;
}) {
  const locations = input.locations ?? null;
  const mappings = input.objects.map((object) => mapNetboxObject(object, { ...MAP_OPTIONS, locations }));
  return planNetboxSync({
    mappings,
    links: input.links ?? [],
    assets: input.assets ?? [],
    catalogs: CATALOGS,
    fetchOk: input.fetchOk ?? true,
    totalObjects: input.objects.length,
    decisions: input.decisions,
    subLocations: input.subLocations ?? [],
    locationIndex: locations,
    siteMap: input.siteMap ?? MAP_OPTIONS.siteMap,
  });
}

function netboxNoticeOf(code: string) {
  return { code, params: {}, text: code } as any;
}

function row(result: ReturnType<typeof plan>, externalId: string): NetboxPlanRow {
  const found = result.rows.find((entry) => entry.external_id === externalId);
  assert.ok(found, `no plan row for object ${externalId}`);
  return found;
}

// --- normalisation ---------------------------------------------------------

{
  const parsed = device();
  assert.equal(parsed.type, 'device');
  assert.equal(parsed.roleSlug, 'server');
  assert.equal(parsed.manufacturer, 'Dell');
  assert.equal(parsed.model, 'PowerEdge R750');
  assert.equal(parsed.position, '12');
  assert.equal(parsed.primaryIp, '10.10.1.5/24');
  assert.equal(parsed.url, `${BASE_URL}/dcim/devices/1/`);

  // Netbox below 3.6 still reports device_role.
  const legacy = normalizeNetboxDevice(
    { id: 9, name: 'old', device_role: { slug: 'server', name: 'Server' }, site: { slug: 'paris' } },
    BASE_URL,
  );
  assert.equal(legacy.roleSlug, 'server');

  // Every virtual machine goes through the one reserved key, whatever role
  // Netbox gives it.
  const vm = normalizeNetboxVirtualMachine({
    id: 50,
    name: 'par-app-01',
    role: { slug: 'some-netbox-role', name: 'Some Netbox role' },
    site: { slug: 'paris', name: 'Paris DC' },
    status: { value: 'active' },
    platform: { name: 'Debian 12' },
  }, BASE_URL);
  assert.equal(vm.type, 'vm');
  assert.equal(vm.roleSlug, NETBOX_VIRTUAL_MACHINES_SLUG);
  assert.equal(vm.roleName, NETBOX_VIRTUAL_MACHINES_NAME);
  assert.equal(vm.serial, null);
  assert.equal(vm.url, `${BASE_URL}/virtualization/virtual-machines/50/`);

  // A machine with no role at all lands on the same key, and the site often
  // comes from the cluster instead of the machine.
  const bare = normalizeNetboxVirtualMachine({
    id: 51,
    name: 'par-app-02',
    role: null,
    site: null,
    cluster: { name: 'Paris vSphere', scope: { slug: 'paris', name: 'Paris DC' } },
  }, BASE_URL);
  assert.equal(bare.roleSlug, NETBOX_VIRTUAL_MACHINES_SLUG);
  assert.equal(bare.siteSlug, 'paris');

  // Older payloads carry cluster.site rather than cluster.scope.
  const legacyCluster = normalizeNetboxVirtualMachine(
    { id: 52, name: 'par-app-03', cluster: { name: 'Paris vSphere', site: { slug: 'paris' } } },
    BASE_URL,
  );
  assert.equal(legacyCluster.siteSlug, 'paris');
}

{
  // Virtual machines are out of scope until the reserved key is matched to an
  // asset type, and then all of them are in scope at once.
  const bare = normalizeNetboxVirtualMachine(
    { id: 51, name: 'par-app-02', site: { slug: 'paris' }, status: { value: 'active' } },
    BASE_URL,
  );
  const unmapped = mapNetboxObject(bare, { ...MAP_OPTIONS, roleMap: { server: 'physical_server' } });
  assert.equal(unmapped.skipReason, 'unmapped_role');
  const mapped = mapNetboxObject(bare, MAP_OPTIONS);
  assert.equal(mapped.skipReason, null);
  assert.equal(mapped.asset?.kind, 'virtual_server');
}

// --- mapping ---------------------------------------------------------------

{
  const mapped = mapNetboxObject(device(), MAP_OPTIONS);
  assert.equal(mapped.skipReason, null);
  assert.equal(mapped.asset?.kind, 'physical_server');
  assert.equal(mapped.asset?.location_id, 'loc-paris');
  assert.equal(mapped.asset?.hostname, 'par-esx-01');
  assert.equal(mapped.asset?.domain, 'fromage');
  assert.equal(mapped.asset?.status, 'active');
  assert.equal(mapped.asset?.provider, 'other', 'a location with no provider falls back to the catalog default');
  assert.deepEqual(mapped.asset?.ip_addresses, [{ type: 'host', ip: '10.10.1.5', subnet_cidr: '10.10.0.0/16' }]);
  assert.equal(mapped.hardware?.serial_number, 'SN-0001');
  assert.deepEqual(mapped.warnings, []);
  // Display values are labels, never codes.
  assert.equal(mapped.display.kind, 'Physical server');
  assert.equal(mapped.display.location, 'Paris DC');
}

// --- Netbox statuses that deserve a look ------------------------------------

{
  // Offline, failed and paused leave the KANAP lifecycle on Active but are
  // surfaced on the record, with the raw value for the UI to translate.
  for (const value of ['offline', 'failed', 'paused']) {
    const mapped = mapNetboxObject(device({ status: { value } }), MAP_OPTIONS);
    assert.equal(mapped.asset?.status, 'active', `${value} stays active`);
    const notice = mapped.warnings.find((entry) => entry.code === 'netbox_status_attention');
    assert.ok(notice, `${value} must raise a notice`);
    assert.equal(notice.params.value, value);
    assert.match(notice.text, /^Netbox reports this object as (Offline|Failed|Paused)\.$/);
  }

  // Every other status says nothing.
  for (const value of ['active', 'planned', 'staged', 'inventory', 'decommissioning']) {
    const mapped = mapNetboxObject(device({ status: { value } }), MAP_OPTIONS);
    assert.equal(
      mapped.warnings.some((entry) => entry.code === 'netbox_status_attention'),
      false,
      `${value} must stay quiet`,
    );
  }

  // Virtual machines are treated exactly the same way.
  const vm = normalizeNetboxVirtualMachine(
    { id: 60, name: 'par-app-60', site: { slug: 'paris' }, status: { value: 'failed' } },
    BASE_URL,
  );
  assert.ok(mapNetboxObject(vm, MAP_OPTIONS).warnings.some((entry) => entry.code === 'netbox_status_attention'));
}

{
  // The raw status travels on the plan row, whatever the row turns out to be.
  const result = plan({ objects: [device({ status: { value: 'failed' } })], assets: [asset()] });
  assert.equal(row(result, '1').external_status, 'failed');
  assert.equal(row(result, '1').action, 'unchanged', 'a status change is not an asset change');
  assert.deepEqual(row(result, '1').diffs, [], 'and produces no field to write');
  assert.equal(result.counts.update, 0);
  assert.equal(result.counts.unchanged, 1);
  // The row still reaches the apply step, so the record gets refreshed.
  assert.equal(result.writes.has('device:1'), true);

  // An object out of scope still reports what Netbox says about it.
  const skipped = plan({ objects: [device({ role: { slug: 'pdu' }, status: { value: 'offline' } })] });
  assert.equal(row(skipped, '1').external_status, 'offline');
}

{
  // One record, one notice: the priority rule decides which.
  const blocked = [
    netboxNoticeOf('os_not_in_catalog'),
    netboxNoticeOf('netbox_status_attention'),
    netboxNoticeOf('contested_asset'),
  ];
  assert.equal(primaryNotice(blocked)?.code, 'contested_asset', 'a decision beats everything');
  assert.equal(
    primaryNotice([netboxNoticeOf('ipv6_skipped'), netboxNoticeOf('netbox_status_attention')])?.code,
    'netbox_status_attention',
    'attention beats information',
  );
  assert.equal(
    primaryNotice([netboxNoticeOf('os_not_in_catalog'), netboxNoticeOf('ipv6_skipped')])?.code,
    'os_not_in_catalog',
    'inside a tier, the first one produced wins',
  );
  assert.equal(primaryNotice([]), null);

  // A failed object that also has an unknown OS reports the failure, not the OS.
  const mapped = mapNetboxObject(
    device({ status: { value: 'failed' }, platform: { name: 'Plan 9' } }),
    MAP_OPTIONS,
  );
  assert.equal(primaryNotice(mapped.warnings)?.code, 'netbox_status_attention');
}

{
  // Statuses: decommissioning becomes deprecated, and nothing ever becomes retired.
  for (const [netbox, expected] of [
    ['planned', 'proposed'],
    ['staged', 'proposed'],
    ['inventory', 'proposed'],
    ['active', 'active'],
    ['offline', 'active'],
    ['failed', 'active'],
    ['paused', 'active'],
    ['decommissioning', 'deprecated'],
  ] as const) {
    const mapped = mapNetboxObject(device({ status: { value: netbox } }), MAP_OPTIONS);
    assert.equal(mapped.asset?.status, expected, `status ${netbox}`);
    assert.notEqual(mapped.asset?.status, 'retired');
  }
  const unknown = mapNetboxObject(device({ status: { value: 'mothballed' } }), MAP_OPTIONS);
  assert.equal(unknown.asset?.status, null);
  assert.deepEqual(unknown.warnings.map((notice) => notice.code), ['status_not_mapped']);
  assert.equal(unknown.warnings[0].params.value, 'mothballed');
  assert.match(unknown.warnings[0].text, /mothballed/, 'the English fallback still reads properly');
}

{
  // An operating system KANAP does not know is a warning, never an invention.
  const mapped = mapNetboxObject(device({ platform: { name: 'Plan 9' } }), MAP_OPTIONS);
  assert.equal(mapped.asset?.operating_system, null);
  assert.deepEqual(mapped.warnings.map((notice) => notice.code), ['os_not_in_catalog']);
  assert.equal(mapped.warnings[0].params.value, 'Plan 9');
}

{
  // A name that is not a valid host name still creates the asset, without one.
  const mapped = mapNetboxObject(device({ name: 'Switch #3 (spare)' }), MAP_OPTIONS);
  assert.equal(mapped.asset?.name, 'Switch #3 (spare)');
  assert.equal(mapped.asset?.hostname, null);
  assert.deepEqual(mapped.warnings.map((notice) => notice.code), ['hostname_invalid']);
}

{
  // An unknown DNS suffix is not a domain: the whole name is the host name,
  // and nothing is reported. The full matrix lives in netbox-hostname.spec.ts.
  const mapped = mapNetboxObject(device({ name: 'par-esx-09.other.lan' }), MAP_OPTIONS);
  assert.equal(mapped.asset?.hostname, 'par-esx-09.other.lan');
  assert.equal(mapped.asset?.domain, null);
  assert.deepEqual(mapped.warnings.map((notice) => notice.code), []);
}

{
  // An address outside every known subnet is imported without one.
  const mapped = mapNetboxObject(device({ primary_ip4: { address: '192.0.2.7/24' } }), MAP_OPTIONS);
  assert.deepEqual(mapped.asset?.ip_addresses, [{ type: 'host', ip: '192.0.2.7', subnet_cidr: null }]);
  // IPv6 primaries are out of scope, and say so rather than vanishing.
  const ipv6 = mapNetboxObject(device({ primary_ip4: { address: '2001:db8::1/64' } }), MAP_OPTIONS);
  assert.equal(ipv6.asset?.ip_addresses, null);
  assert.deepEqual(ipv6.warnings.map((notice) => notice.code), ['ipv6_skipped']);
}

// --- the provider an asset is created with ---------------------------------

{
  // The regression that broke creation on every standard tenant: the provider
  // must be a code of the PROVIDER catalog, never a hosting type.
  const providerCodes = CATALOGS.assetProviders.map((option) => option.code);

  // No provider on the location: the catalog's "other" entry.
  assert.equal(mapNetboxObject(device(), MAP_OPTIONS).asset?.provider, 'other');

  // A location that does carry a real provider keeps it.
  const lyon = mapNetboxObject(device({ site: { slug: 'lyon' } }), MAP_OPTIONS);
  assert.equal(lyon.asset?.provider, 'aws');

  // A provider value the catalog does not know falls back too, never through.
  const stray = mapNetboxObject(device(), {
    ...MAP_OPTIONS,
    catalogs: { ...CATALOGS, locations: [{ id: 'loc-paris', name: 'Paris DC', provider: 'on_prem' }] },
  });
  assert.equal(stray.asset?.provider, 'other');

  // Whatever happens, the value is one the asset service will accept.
  for (const mapped of [mapNetboxObject(device(), MAP_OPTIONS), lyon, stray]) {
    assert.ok(providerCodes.includes(mapped.asset?.provider ?? ''), `provider ${mapped.asset?.provider}`);
  }

  // A catalog without "other" falls back to its first entry, as the form does.
  const noOther = mapNetboxObject(device(), {
    ...MAP_OPTIONS,
    catalogs: { ...CATALOGS, assetProviders: [{ code: 'azure', label: 'Azure' }] },
  });
  assert.equal(noOther.asset?.provider, 'azure');
}

{
  // The role and site maps are the import filter.
  assert.equal(mapNetboxObject(device({ role: { slug: 'pdu' } }), MAP_OPTIONS).skipReason, 'unmapped_role');
  assert.equal(mapNetboxObject(device({ site: { slug: 'lille' } }), MAP_OPTIONS).skipReason, 'unmapped_site');
  assert.equal(mapNetboxObject(device({ name: null }), MAP_OPTIONS).skipReason, 'unnamed');
}

// --- matching --------------------------------------------------------------

{
  const assets = [asset()];
  const index = buildMatcherIndex(assets);

  // Renamed in Netbox but the same serial.
  const renamed = mapNetboxObject(device({ name: 'par-esx-01-new', serial: 'SN-0001' }), MAP_OPTIONS);
  const bySerial = matchNetboxObject(renamed, null, index);
  assert.equal(bySerial.matchedBy, 'serial');
  assert.equal(bySerial.assetId, 'asset-1');

  // FQDN in Netbox, shortname in KANAP, different case: still the same host.
  const byHost = matchNetboxObject(
    mapNetboxObject(device({ name: 'PAR-ESX-01.FROMAGE.LAN', serial: null }), MAP_OPTIONS),
    null,
    index,
  );
  assert.equal(byHost.matchedBy, 'fqdn');
  assert.equal(byHost.assetId, 'asset-1');

  // An existing link always wins.
  const linked = matchNetboxObject(mapNetboxObject(device({ serial: 'other' }), MAP_OPTIONS), 'asset-1', index);
  assert.equal(linked.matchedBy, 'link');

  // Nothing matches: a new asset.
  const fresh = matchNetboxObject(
    mapNetboxObject(device({ id: 2, name: 'par-web-99', serial: 'SN-9999', primary_ip4: { address: '10.10.1.99/24' } }), MAP_OPTIONS),
    null,
    index,
  );
  assert.equal(fresh.assetId, null);
  assert.deepEqual(fresh.candidateAssetIds, []);

  // Same object on an address an asset already holds: offered, never linked.
  const sameAddress = matchNetboxObject(
    mapNetboxObject(device({ id: 2, name: 'par-web-99', serial: 'SN-9999' }), MAP_OPTIONS),
    null,
    index,
  );
  assert.equal(sameAddress.assetId, null);
  assert.deepEqual(sameAddress.candidateAssetIds, ['asset-1']);
  assert.equal(sameAddress.suggestedByIp, '10.10.1.5');
}

{
  // Two assets share the serial: ambiguous, never merged.
  const assets = [asset(), asset({ id: 'asset-2', name: 'par-esx-01-bis', hostname: null, fqdn: null })];
  const ambiguous = matchNetboxObject(
    mapNetboxObject(device({ name: 'something-else' }), MAP_OPTIONS),
    null,
    buildMatcherIndex(assets),
  );
  assert.equal(ambiguous.assetId, null);
  assert.deepEqual(ambiguous.candidateAssetIds.sort(), ['asset-1', 'asset-2']);
}

// --- planning --------------------------------------------------------------

{
  // Everything already in step: no write at all, which is what a second run
  // has to produce.
  const result = plan({ objects: [device()], assets: [asset()] });
  assert.equal(row(result, '1').action, 'unchanged');
  assert.deepEqual(row(result, '1').diffs, []);
  assert.equal(result.counts.unchanged, 1);
}

{
  // A name that differs only in case is not a rename.
  const result = plan({ objects: [device({ name: 'PAR-ESX-01.fromage.lan' })], assets: [asset({ name: 'par-esx-01' })] });
  assert.equal(row(result, '1').action, 'unchanged');
}

{
  // A real rename is one: matched on the serial, the new name is applied.
  const result = plan({ objects: [device({ name: 'par-esx-42.fromage.lan' })], assets: [asset()] });
  const renamed = row(result, '1');
  assert.equal(renamed.action, 'update');
  assert.equal(renamed.matched_by, 'serial');
  assert.deepEqual(
    renamed.diffs.find((diff) => diff.field === 'name'),
    { field: 'name', before: 'par-esx-01', after: 'par-esx-42.fromage.lan' },
  );
}

{
  // Divergent fields produce display-value differences.
  const result = plan({
    objects: [device({ status: { value: 'decommissioning' }, platform: { name: 'Debian 12' }, site: { slug: 'lyon', name: 'Lyon Warehouse' } })],
    assets: [asset()],
  });
  const updated = row(result, '1');
  assert.equal(updated.action, 'update');
  assert.equal(updated.matched_by, 'serial');
  const diffs = Object.fromEntries(updated.diffs.map((diff) => [diff.field, diff]));
  assert.deepEqual(diffs.status, { field: 'status', before: 'Active', after: 'Deprecated' });
  assert.deepEqual(diffs.operating_system, { field: 'operating_system', before: 'VMware ESXi 8', after: 'Debian 12' });
  assert.deepEqual(diffs.location, { field: 'location', before: 'Paris DC', after: 'Lyon Warehouse' });
}

{
  // Netbox knows nothing about these fields: they must not be blanked.
  const result = plan({
    objects: [device({ serial: null, platform: null, rack: null, position: null, primary_ip4: null, status: null })],
    assets: [asset({ serial_number: null })],
  });
  assert.deepEqual(row(result, '1').diffs, []);
}

{
  // Enrichment: the asset exists with no hardware record yet.
  const result = plan({ objects: [device()], assets: [asset({ serial_number: null, manufacturer: null, model: null, rack_location: null, rack_unit: null })] });
  const enriched = row(result, '1');
  assert.equal(enriched.action, 'update');
  assert.equal(enriched.matched_by, 'fqdn');
  assert.deepEqual(
    enriched.diffs.map((diff) => diff.field).sort(),
    ['manufacturer', 'model', 'rack_location', 'rack_unit', 'serial_number'],
  );
}

{
  // New device and new virtual machine.
  const vm = normalizeNetboxVirtualMachine({
    id: 50,
    name: 'par-app-01',
    site: { slug: 'paris' },
    status: { value: 'active' },
  }, BASE_URL);
  const result = plan({ objects: [device({ id: 7, name: 'par-web-07', serial: 'SN-0007' }), vm] });
  assert.equal(row(result, '7').action, 'create');
  assert.equal(row(result, '50').action, 'create');
  assert.equal(result.counts.create, 2);
  // Device 1 and VM 1 would not collide: the type is part of the identity.
  assert.equal(result.rows.filter((entry) => entry.external_type === 'vm').length, 1);
}

{
  // An object a person ignored stays out of the way.
  const links: ExistingLink[] = [
    { id: 'link-1', external_type: 'device', external_id: '1', asset_id: null, state: 'ignored' },
  ];
  const result = plan({ objects: [device()], assets: [asset()], links });
  assert.equal(row(result, '1').action, 'skipped');
  assert.equal(row(result, '1').skip_reason, 'ignored');
}

{
  // Ambiguity is reported with both candidates, and nothing is planned for it.
  const assets = [asset(), asset({ id: 'asset-2', name: 'par-esx-01-bis', hostname: null, fqdn: null, asset_reference: 'AST-5' })];
  const result = plan({ objects: [device({ name: 'brand-new-name' })], assets });
  const ambiguous = row(result, '1');
  assert.equal(ambiguous.action, 'ambiguous');
  assert.deepEqual(ambiguous.candidates.map((candidate) => candidate.asset_reference).sort(), ['AST-4', 'AST-5']);
  assert.equal(result.writes.has('device:1'), false);
}

// --- one asset, one Netbox object ------------------------------------------

{
  // Asset 1 belongs to device 1. Device 2 would match it on the host name, but
  // the asset is taken: device 2 becomes a new asset instead.
  const links: ExistingLink[] = [
    { id: 'link-1', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'linked' },
  ];
  const result = plan({
    objects: [device(), device({ id: 2, name: 'par-esx-01.fromage.lan', serial: 'SN-0002' })],
    assets: [asset()],
    links,
  });
  assert.equal(row(result, '1').action, 'unchanged');
  assert.equal(row(result, '2').action, 'create');
  assert.equal(row(result, '2').asset, null);
  assert.equal(row(result, '2').candidates.length, 0, 'a claimed asset is not even offered as a candidate');
}

{
  // Two unlinked Netbox objects reach the same asset: neither is linked, both
  // go to a person with that asset as the candidate.
  const result = plan({
    objects: [
      device({ id: 1, name: 'par-esx-01', serial: null }),
      device({ id: 2, name: 'par-esx-01.fromage.lan', serial: null }),
    ],
    assets: [asset()],
  });
  for (const externalId of ['1', '2']) {
    const contested = row(result, externalId);
    assert.equal(contested.action, 'ambiguous', `object ${externalId}`);
    assert.deepEqual(contested.candidates.map((candidate) => candidate.asset_reference), ['AST-4']);
    assert.ok(
      contested.warnings.some((warning) => warning.code === 'contested_asset'),
      'the reason is carried as a translatable code',
    );
  }
  assert.equal(result.counts.ambiguous, 2);
  assert.equal(result.counts.create, 0);
  assert.equal(result.writes.size, 0, 'nothing is written for a contested asset');
}

{
  // A device deleted in Netbox and recreated comes back under a new id. The
  // old record is 'missing', which does NOT hold the asset, so the new object
  // picks it up on the host name.
  const links: ExistingLink[] = [
    { id: 'link-old', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'missing' },
  ];
  const result = plan({
    objects: [device({ id: 77, name: 'par-esx-01.fromage.lan', serial: 'SN-0001' })],
    assets: [asset()],
    links,
  });
  const recreated = row(result, '77');
  assert.equal(recreated.action, 'unchanged');
  assert.equal(recreated.matched_by, 'serial');
  assert.equal(recreated.asset?.asset_reference, 'AST-4');
  // The old record is not listed as missing again: Netbox never showed it.
  assert.deepEqual(result.missing, []);
}

{
  // The reproduction: device 1's record is 'missing' on asset X, device 2's is
  // 'linked' on the same asset, and Netbox lists both. Device 1 must not be
  // written as a second owner — its stale record no longer binds it.
  const links: ExistingLink[] = [
    { id: 'link-1', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'missing' },
    { id: 'link-2', external_type: 'device', external_id: '2', asset_id: 'asset-1', state: 'linked' },
  ];
  const result = plan({
    objects: [device({ id: 1, serial: null, name: 'par-esx-01.fromage.lan' }), device({ id: 2, serial: null, name: 'par-esx-01.fromage.lan' })],
    assets: [asset({ serial_number: null })],
    links,
  });
  assert.equal(row(result, '2').action, 'unchanged', 'the live record keeps its asset');
  assert.equal(row(result, '2').asset?.id, 'asset-1');
  const displaced = row(result, '1');
  assert.notEqual(displaced.action, 'unchanged');
  assert.notEqual(displaced.action, 'update');
  assert.equal(displaced.asset, null, 'the stale record must not bind to a taken asset');
  // Exactly one row ends up writing to that asset.
  const owners = [...result.writes.values()].filter((write) => write.assetId === 'asset-1');
  assert.equal(owners.length, 1);
}

{
  // Two stored records both claiming one asset (data an older build could
  // write): the plan heals it to a single owner instead of confirming both.
  const links: ExistingLink[] = [
    { id: 'link-1', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'linked' },
    { id: 'link-2', external_type: 'device', external_id: '2', asset_id: 'asset-1', state: 'linked' },
  ];
  const result = plan({
    objects: [device({ id: 1, serial: null, name: 'one' }), device({ id: 2, serial: null, name: 'two' })],
    assets: [asset({ serial_number: null })],
    links,
  });
  const writers = [...result.writes.values()].filter((write) => write.assetId === 'asset-1');
  assert.equal(writers.length, 1, 'exactly one object may keep the asset');
}

{
  // Same story, but the deletion and the recreation land in ONE run: the old
  // record is still 'linked' and Netbox simply stops listing it. It becomes
  // missing and releases the asset in the same plan, so the new object takes
  // it over instead of creating a duplicate.
  const links: ExistingLink[] = [
    { id: 'link-old', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'linked' },
  ];
  const result = plan({
    objects: [device({ id: 77, name: 'par-esx-01.fromage.lan', serial: 'SN-0001' })],
    assets: [asset()],
    links,
  });
  const recreated = row(result, '77');
  assert.equal(recreated.action, 'unchanged');
  assert.equal(recreated.asset?.asset_reference, 'AST-4');
  assert.deepEqual(result.missing.map((link) => link.id), ['link-old']);
  assert.equal(result.counts.create, 0, 'no duplicate asset');
}

{
  // The release only happens when the fetch can be trusted. A failed fetch
  // leaves every claim in place.
  const links: ExistingLink[] = [
    { id: 'link-old', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'linked' },
  ];
  const result = planNetboxSync({
    mappings: [mapNetboxObject(device({ id: 77, name: 'par-esx-01.fromage.lan', serial: 'SN-0001' }), MAP_OPTIONS)],
    links,
    assets: [asset()],
    catalogs: CATALOGS,
    fetchOk: false,
    totalObjects: 1,
  });
  assert.equal(row(result, '77').action, 'create');
  assert.deepEqual(result.missing, []);
}

{
  // An error record still points at its asset and keeps retrying it rather
  // than creating a duplicate.
  const links: ExistingLink[] = [
    { id: 'link-err', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'error' },
  ];
  const result = plan({ objects: [device()], assets: [asset()], links });
  assert.equal(row(result, '1').action, 'unchanged');
}

// --- matched_by names the field it came from -------------------------------

{
  // No host name on the asset: the name is what matched, so say so.
  const byName = plan({
    objects: [device({ serial: null })],
    assets: [asset({ hostname: null, fqdn: null, serial_number: null })],
  });
  assert.equal(row(byName, '1').matched_by, 'name');

  // With a host name, the host is what matched.
  const byHost = plan({
    objects: [device({ serial: null })],
    assets: [asset({ name: 'Old inventory label', serial_number: null })],
  });
  assert.equal(row(byHost, '1').matched_by, 'fqdn');
}

// --- the missing guard -----------------------------------------------------

{
  const links: ExistingLink[] = [
    { id: 'link-gone', external_type: 'device', external_id: '404', asset_id: 'asset-1', state: 'linked' },
  ];

  // Netbox no longer lists the object and did return other objects: missing.
  const seen = plan({ objects: [device()], assets: [asset()], links });
  assert.deepEqual(seen.missing.map((link) => link.id), ['link-gone']);
  assert.equal(seen.counts.missing, 1);

  // Netbox returned nothing at all: an outage, not a decommissioning.
  const empty = plan({ objects: [], assets: [asset()], links });
  assert.deepEqual(empty.missing, []);
  assert.equal(empty.counts.missing, 0);

  // The fetch failed: same rule.
  const failed = planNetboxSync({
    mappings: [mapNetboxObject(device(), MAP_OPTIONS)],
    links,
    assets: [asset()],
    catalogs: CATALOGS,
    fetchOk: false,
    totalObjects: 1,
  });
  assert.deepEqual(failed.missing, []);

  // An asset that never came from Netbox is not touched: it has no link row.
  const untouched = plan({ objects: [device()], assets: [asset(), asset({ id: 'aws-1', name: 'aws-rds-01', serial_number: null, hostname: null, fqdn: null })] });
  assert.equal(untouched.missing.length, 0);
}

// --- IP address: a suggestion, never a link ----------------------------------

{
  // Nothing but the address ties the renamed asset to the object.
  const renamed = asset({ id: 'asset-old', name: 'esx-legacy', hostname: null, fqdn: null, serial_number: null });
  const byIp = plan({ objects: [device()], assets: [renamed] });
  const found = row(byIp, '1');
  assert.equal(found.action, 'ambiguous');
  assert.deepEqual(found.candidates.map((candidate) => candidate.id), ['asset-old']);
  assert.equal(primaryNotice(found.warnings)?.code, 'ip_match_candidates');
  assert.equal(primaryNotice(found.warnings)?.params.value, '10.10.1.5');
  assert.equal(byIp.counts.create, 0);
  assert.equal(byIp.writes.size, 0);

  // A firmer level still wins: the serial links on its own, the address is not asked about.
  const bySerial = plan({ objects: [device()], assets: [asset({ name: 'esx-legacy', hostname: null, fqdn: null })] });
  assert.equal(row(bySerial, '1').action, 'update');
  assert.equal(row(bySerial, '1').matched_by, 'serial');

  // An asset another Netbox object owns is not offered: the newcomer is created.
  const owned = plan({
    objects: [device(), device({ id: 2, name: 'par-new-01', serial: 'SN-0002' })],
    assets: [asset()],
    links: [{ id: 'l1', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'linked' }],
  });
  assert.equal(row(owned, '2').action, 'create');

  // Same on a first run, when the other object reaches the asset in this very plan.
  const sameRun = plan({
    objects: [device(), device({ id: 2, name: 'par-new-01', serial: 'SN-0002' })],
    assets: [asset()],
  });
  assert.equal(row(sameRun, '1').matched_by, 'serial');
  assert.equal(row(sameRun, '2').action, 'create');

  // No address on the Netbox side: plain creation.
  const noIp = plan({ objects: [device({ primary_ip4: null })], assets: [renamed] });
  assert.equal(row(noIp, '1').action, 'create');
}

// --- decisions made in the preview -------------------------------------------

{
  const other = asset({
    id: 'asset-2', name: 'srv-compta', asset_reference: 'AST-9', hostname: null, fqdn: null,
    serial_number: 'OLD-SERIAL', ip_addresses: null, model: 'PowerEdge R640',
  });
  const newcomer = device({ id: 7, name: 'par-app-07', serial: 'SN-0007', primary_ip4: { address: '10.10.1.77/24' } });
  const key = { external_type: 'device' as const, external_id: '7' };

  // Without a decision the object is new.
  assert.equal(row(plan({ objects: [newcomer], assets: [other] }), '7').action, 'create');

  // Link: the chosen asset is updated, with its field differences shown.
  const linked = plan({ objects: [newcomer], assets: [other], decisions: [{ ...key, action: 'link', asset_id: 'asset-2' }] });
  const linkedRow = row(linked, '7');
  assert.equal(linkedRow.action, 'update');
  assert.equal(linkedRow.matched_by, 'manual');
  assert.equal(linkedRow.decision, 'link');
  assert.equal(linkedRow.asset?.id, 'asset-2');
  assert.ok(linkedRow.diffs.some((diff) => diff.field === 'name' && diff.after === 'par-app-07'));
  assert.ok(linkedRow.diffs.some((diff) => diff.field === 'serial_number' && diff.before === 'OLD-SERIAL'));
  assert.equal(linked.writes.get('device:7')?.assetId, 'asset-2');

  // Ignore: nothing to write, and the row says who decided.
  const ignored = plan({ objects: [newcomer], assets: [other], decisions: [{ ...key, action: 'ignore' }] });
  assert.equal(row(ignored, '7').action, 'skipped');
  assert.equal(row(ignored, '7').skip_reason, 'ignored');
  assert.equal(row(ignored, '7').decision, 'ignore');
  assert.equal(ignored.writes.size, 0);

  // Create: candidates are set aside.
  const twins = [asset({ id: 'twin-a', serial_number: null }), asset({ id: 'twin-b', serial_number: null })];
  assert.equal(row(plan({ objects: [device({ serial: '' })], assets: twins }), '1').action, 'ambiguous');
  const forced = plan({
    objects: [device({ serial: '' })],
    assets: twins,
    decisions: [{ external_type: 'device', external_id: '1', action: 'create' }],
  });
  assert.equal(row(forced, '1').action, 'create');
  assert.equal(row(forced, '1').decision, 'create');
  assert.equal(forced.writes.get('device:1')?.assetId, null);

  // A decision settles an ambiguity in favour of one candidate.
  const settled = plan({
    objects: [device({ serial: '' })],
    assets: twins,
    decisions: [{ external_type: 'device', external_id: '1', action: 'link', asset_id: 'twin-b' }],
  });
  assert.equal(row(settled, '1').asset?.id, 'twin-b');

  // A decision lifts an earlier "ignore".
  const unignored = plan({
    objects: [newcomer],
    assets: [other],
    links: [{ id: 'l7', external_type: 'device', external_id: '7', asset_id: null, state: 'ignored' }],
    decisions: [{ ...key, action: 'link', asset_id: 'asset-2' }],
  });
  assert.equal(row(unignored, '7').action, 'update');

  // Out of scope stays out of scope, whatever was decided.
  const outOfScope = plan({
    objects: [device({ id: 7, role: { slug: 'pdu', name: 'PDU' } })],
    assets: [other],
    decisions: [{ ...key, action: 'link', asset_id: 'asset-2' }],
  });
  assert.equal(row(outOfScope, '7').skip_reason, 'unmapped_role');
  assert.equal(row(outOfScope, '7').decision, null);

  // An asset that is gone: the decision falls away, the cascade decides.
  const gone = plan({ objects: [newcomer], assets: [other], decisions: [{ ...key, action: 'link', asset_id: 'nope' }] });
  assert.equal(row(gone, '7').action, 'create');

  // The chosen asset belongs to another live object: asked again, never a second owner,
  // and the rightful owner keeps its link.
  const held = plan({
    objects: [device(), newcomer],
    assets: [asset()],
    links: [{ id: 'l1', external_type: 'device', external_id: '1', asset_id: 'asset-1', state: 'linked' }],
    decisions: [{ ...key, action: 'link', asset_id: 'asset-1' }],
  });
  assert.equal(row(held, '7').action, 'ambiguous');
  assert.equal(primaryNotice(row(held, '7').warnings)?.code, 'contested_asset');
  assert.equal(row(held, '1').action, 'unchanged');
  assert.equal(held.writes.has('device:7'), false);

  // Two objects sent to the same asset, one by hand and one by serial: both wait.
  const clash = plan({
    objects: [device(), newcomer],
    assets: [asset()],
    decisions: [{ ...key, action: 'link', asset_id: 'asset-1' }],
  });
  assert.equal(row(clash, '1').action, 'ambiguous');
  assert.equal(row(clash, '7').action, 'ambiguous');
  assert.equal(clash.writes.size, 0);
}

// --- sub-locations ---------------------------------------------------------

/** A Netbox Location, as `rootNetboxLocation` walks it. */
function deepDevice(id: number, name: string, locationId: number | null): NetboxObject {
  return device({
    id,
    name,
    location: locationId == null ? null : { id: locationId, name: `Location ${locationId}` },
  });
}

function subLocation(overrides: Partial<ExistingSubLocation> = {}): ExistingSubLocation {
  return {
    id: 'sub-1',
    location_id: 'loc-paris',
    name: 'Salle serveurs',
    description: null,
    external_source: null,
    external_id: null,
    external_url: null,
    ...overrides,
  };
}

// The walk: only the top-level Location under the site becomes a sub-location,
// whatever depth the equipment sits at.
{
  const index = locationIndex([
    { id: '1', name: 'Building A' },
    { id: '2', name: 'Floor 1', parentId: '1' },
    { id: '3', name: 'Room 101', parentId: '2' },
  ]);
  assert.equal(rootNetboxLocation(index, '1')?.name, 'Building A');
  assert.equal(rootNetboxLocation(index, '3')?.name, 'Building A');
  assert.equal(rootNetboxLocation(index, '404'), null, 'an id Netbox did not return has no root');
  assert.equal(rootNetboxLocation(index, null), null);
  assert.equal(rootNetboxLocation(null, '1'), null);

  // A parent chain that leaves the index is a broken chain, not a root.
  const broken = locationIndex([{ id: '9', name: 'Orphan', parentId: '404' }]);
  assert.equal(rootNetboxLocation(broken, '9'), null);

  // A cycle must terminate rather than hang the run.
  const cycle = locationIndex([
    { id: 'a', name: 'A', parentId: 'b' },
    { id: 'b', name: 'B', parentId: 'a' },
  ]);
  assert.equal(rootNetboxLocation(cycle, 'a'), null);
}

// A device parked three levels down is attached to the top level above it, and
// that is not worth a warning: it is the documented behaviour.
{
  const index = locationIndex([
    { id: '1', name: 'Building A' },
    { id: '2', name: 'Floor 1', parentId: '1' },
    { id: '3', name: 'Room 101', parentId: '2' },
  ]);
  const result = plan({ objects: [deepDevice(1, 'par-esx-01', 3)], locations: index });
  assert.equal(result.subLocationsAvailable, true);
  assert.equal(result.subLocations.length, 1);
  assert.equal(result.subLocations[0].action, 'create');
  assert.equal(result.subLocations[0].name, 'Building A');
  assert.equal(result.subLocations[0].external_id, '1');
  assert.equal(result.subLocations[0].asset_count, 1);
  assert.equal(row(result, '1').warnings.length, 0);
}

// No Location on the device: nothing is written, and whatever the asset holds
// stays. An empty Netbox value never blanks a KANAP value.
{
  const index = locationIndex([{ id: '1', name: 'Building A' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', null)],
    assets: [asset({ sub_location_id: 'sub-1' })],
    subLocations: [subLocation()],
    locations: index,
  });
  assert.deepEqual(row(result, '1').diffs, []);
  assert.equal(result.subLocations.length, 0);
}

// A virtual machine carries no Location in Netbox, so it never receives one.
{
  const vm = normalizeNetboxVirtualMachine({
    id: 5,
    name: 'par-vm-01',
    site: { slug: 'paris', name: 'Paris DC' },
      status: { value: 'active' },
  }, BASE_URL);
  assert.equal(vm.locationId, null);
  const index = locationIndex([{ id: '1', name: 'Building A' }]);
  const result = plan({
    objects: [vm],
    assets: [asset({ id: 'asset-vm', name: 'par-vm-01', kind: 'virtual_server', sub_location_id: 'sub-1' })],
    subLocations: [subLocation()],
    locations: index,
  });
  assert.equal(result.subLocations.length, 0);
  assert.equal(row(result, '5').diffs.some((diff) => diff.field === 'sub_location'), false);
}

// Several devices in one Location create it once, and the change says how many
// devices end up there.
{
  const index = locationIndex([{ id: '1', name: 'Salle serveurs' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 1), deepDevice(2, 'par-esx-02', 1)],
    locations: index,
  });
  const created = result.subLocations.filter((change) => change.action === 'create');
  assert.equal(created.length, 1);
  assert.equal(created[0].asset_count, 2);
}

// A Location only an ignored row points at is never created: the create/adopt
// changes follow the rows that are really written.
{
  const index = locationIndex([{ id: '1', name: 'Salle serveurs' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    locations: index,
    decisions: [{ external_type: 'device', external_id: '1', action: 'ignore' }],
  });
  assert.equal(result.subLocations.length, 0);
  assert.equal(row(result, '1').action, 'skipped');
}

// An ambiguous row writes nothing either.
{
  const index = locationIndex([{ id: '1', name: 'Salle serveurs' }]);
  const result = plan({
    objects: [deepDevice(1, 'dup', 1)],
    assets: [asset({ id: 'a1', name: 'dup' }), asset({ id: 'a2', name: 'dup', asset_reference: 'AST-9' })],
    locations: index,
  });
  assert.equal(row(result, '1').action, 'ambiguous');
  assert.equal(result.subLocations.length, 0);
}

// A sub-location built by hand is adopted rather than duplicated, and the
// change says what it was called before.
{
  const index = locationIndex([{ id: '1', name: 'Salle serveurs' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    assets: [asset()],
    subLocations: [subLocation({ name: 'salle SERVEURS' })],
    locations: index,
  });
  const adopted = result.subLocations.filter((change) => change.action === 'adopt');
  assert.equal(adopted.length, 1);
  assert.equal(adopted[0].sub_item_id, 'sub-1');
  assert.equal(adopted[0].name, 'Salle serveurs');
  assert.equal(adopted[0].previous_name, 'salle SERVEURS', 'the Netbox spelling replaces the old one');
  assert.equal(adopted[0].external_id, '1');
  assert.equal(result.subLocations.some((change) => change.action === 'create'), false);

  const diff = row(result, '1').diffs.find((entry) => entry.field === 'sub_location');
  assert.ok(diff);
  assert.equal(diff.before, null, 'the asset did not hold a sub-location yet');
  assert.equal(diff.after, 'Salle serveurs');
}

// A hand-made sub-location the asset ALREADY holds is adopted without the
// equipment row moving. The change has to be planned even though the row
// carries no diff: the apply step's upkeep pass is what gives it its identity,
// and nothing else would.
{
  const index = locationIndex([{ id: '1', name: 'Atelier' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    assets: [asset({ sub_location_id: 'sub-1' })],
    subLocations: [subLocation({ name: 'atelier' })],
    locations: index,
  });
  const adopted = result.subLocations.filter((change) => change.action === 'adopt');
  assert.equal(adopted.length, 1);
  assert.equal(adopted[0].sub_item_id, 'sub-1');
  assert.equal(row(result, '1').action, 'unchanged', 'the equipment itself does not move');
  assert.deepEqual(row(result, '1').diffs, []);
}

// Two Netbox sites mapped to the SAME KANAP location, with Locations of the
// same name: the first id wins, the second is a conflict. Nothing is written
// for it, and the equipment still imports.
{
  const index = locationIndex([
    { id: '7', name: 'Salle serveurs', siteSlug: 'paris' },
    { id: '9', name: 'salle serveurs', siteSlug: 'lyon' },
  ]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 7), deepDevice(2, 'lyo-esx-01', 9)],
    locations: index,
    siteMap: { paris: 'loc-paris', lyon: 'loc-paris' },
  });
  const created = result.subLocations.filter((change) => change.action === 'create');
  const conflicts = result.subLocations.filter((change) => change.action === 'conflict');
  assert.equal(created.length, 1);
  assert.equal(created[0].external_id, '7');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].external_id, '9');
  assert.equal(
    primaryNotice(row(result, '2').warnings)?.code,
    'sub_location_name_taken',
  );
  assert.equal(row(result, '1').warnings.length, 0);
}

// A rename in Netbox renames the shared row. It is NOT a move for every
// equipment that carries it, so the equipment rows carry no diff at all.
{
  const index = locationIndex([{ id: '1', name: 'Salle serveurs A' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    assets: [asset({ sub_location_id: 'sub-1' })],
    subLocations: [subLocation({
      name: 'Salle serveurs',
      external_source: 'netbox',
      external_id: '1',
      external_url: `${BASE_URL}/dcim/locations/1/`,
    })],
    locations: index,
  });
  const renamed = result.subLocations.filter((change) => change.action === 'rename');
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].previous_name, 'Salle serveurs');
  assert.equal(renamed[0].name, 'Salle serveurs A');
  assert.equal(renamed[0].asset_count, 0);
  assert.deepEqual(row(result, '1').diffs, []);
  assert.equal(row(result, '1').action, 'unchanged');
}

// Renaming onto a name a person already used in that location is reported, not
// forced: the identity is known, so the equipment keeps its sub-location.
{
  const index = locationIndex([{ id: '1', name: 'Atelier' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    assets: [asset({ sub_location_id: 'sub-1' })],
    subLocations: [
      subLocation({
        name: 'Zone technique',
        external_source: 'netbox',
        external_id: '1',
        external_url: `${BASE_URL}/dcim/locations/1/`,
      }),
      subLocation({ id: 'sub-2', name: 'atelier' }),
    ],
    locations: index,
  });
  const conflicts = result.subLocations.filter((change) => change.action === 'conflict');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].sub_item_id, 'sub-1');
  assert.equal(result.subLocations.some((change) => change.action === 'rename'), false);
  assert.deepEqual(row(result, '1').diffs, []);
  // No equipment row carries this conflict, so the run has to say it itself:
  // a scheduled run has no preview to show it in.
  assert.deepEqual(row(result, '1').warnings, []);
  const notices = subLocationUpkeepNotices(result.subLocations);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].code, 'sub_location_name_taken');
  assert.equal(notices[0].params.value, 'Atelier');
}

// An empty Netbox description never blanks the KANAP one, and a description
// that did not move produces no change at all.
{
  const index = locationIndex([{ id: '1', name: 'Salle serveurs', description: null }]);
  const linked = subLocation({
    name: 'Salle serveurs',
    description: 'Écrit à la main',
    external_source: 'netbox',
    external_id: '1',
    external_url: `${BASE_URL}/dcim/locations/1/`,
  });
  const result = plan({ objects: [deepDevice(1, 'par-esx-01', 1)], subLocations: [linked], locations: index });
  assert.equal(result.subLocations.length, 0);

  // A real description change is an update.
  const withText = locationIndex([{ id: '1', name: 'Salle serveurs', description: 'Rangée A' }]);
  const updated = plan({ objects: [deepDevice(1, 'par-esx-01', 1)], subLocations: [linked], locations: withText });
  assert.equal(updated.subLocations.length, 1);
  assert.equal(updated.subLocations[0].action, 'update');
  assert.equal(updated.subLocations[0].description, 'Rangée A');
}

// A Location moved under a parent is no longer a top-level one: it is kept,
// simply not maintained any more.
{
  const index = locationIndex([
    { id: '1', name: 'Building A' },
    { id: '2', name: 'Salle serveurs', parentId: '1' },
  ]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 2)],
    subLocations: [subLocation({
      name: 'Salle serveurs',
      external_source: 'netbox',
      external_id: '2',
      external_url: `${BASE_URL}/dcim/locations/2/`,
    })],
    locations: index,
  });
  // The linked row is not maintained any more: no rename, no update, and it is
  // not the target either. The device falls back to the top level above it.
  assert.equal(result.subLocations.some((change) => change.sub_item_id === 'sub-1'), false);
  const created = result.subLocations.filter((change) => change.action === 'create');
  assert.equal(created.length, 1);
  assert.equal(created[0].external_id, '1');
  assert.equal(created[0].name, 'Building A');
}

// A site remapped to another KANAP location creates a new sub-location under
// the new one. The old one keeps its assets and is left exactly as it was.
{
  const index = locationIndex([{ id: '1', name: 'Salle serveurs', siteSlug: 'paris' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    assets: [asset({ location_id: 'loc-lyon', sub_location_id: 'sub-old' })],
    subLocations: [subLocation({
      id: 'sub-old',
      location_id: 'loc-lyon',
      name: 'Salle serveurs',
      external_source: 'netbox',
      external_id: '1',
      external_url: `${BASE_URL}/dcim/locations/1/`,
    })],
    locations: index,
    siteMap: { paris: 'loc-paris' },
  });
  const created = result.subLocations.filter((change) => change.action === 'create');
  assert.equal(created.length, 1);
  assert.equal(created[0].location_id, 'loc-paris');
  // The linked row lives under loc-lyon, its site is now mapped to loc-paris,
  // so the upkeep leaves it alone entirely.
  assert.equal(result.subLocations.some((change) => change.sub_item_id === 'sub-old'), false);
}

// The KANAP location changes and no target resolves: the asset service clears
// the sub-location, so the preview has to show it rather than let it happen
// silently.
{
  const index = locationIndex([{ id: '1', name: 'Building A', siteSlug: 'lyon' }]);
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', null)],
    assets: [asset({ location_id: 'loc-lyon', sub_location_id: 'sub-1' })],
    subLocations: [subLocation({ location_id: 'loc-lyon' })],
    locations: index,
    siteMap: { paris: 'loc-paris' },
  });
  const diff = row(result, '1').diffs.find((entry) => entry.field === 'sub_location');
  assert.ok(diff, 'a dropped sub-location is announced');
  assert.equal(diff.before, 'Salle serveurs');
  assert.equal(diff.after, null);
}

// Locations unavailable: the plan is exactly what it was before the feature,
// and the caller is told so it can say why nothing moved.
{
  const result = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    assets: [asset({ sub_location_id: 'sub-1' })],
    subLocations: [subLocation()],
    locations: null,
  });
  assert.equal(result.subLocationsAvailable, false);
  assert.deepEqual(result.subLocations, []);
  assert.equal(row(result, '1').diffs.some((diff) => diff.field === 'sub_location'), false);
}

// Two Locations, same name, neither seen before: the lower Netbox id is
// created, the other conflicts, whatever order the equipment rows arrived in.
{
  const index = locationIndex([
    { id: '30', name: 'Atelier' },
    { id: '12', name: 'atelier' },
  ]);
  const result = plan({
    objects: [deepDevice(1, 'a-machine', 30), deepDevice(2, 'b-machine', 12)],
    locations: index,
  });
  const created = result.subLocations.filter((change) => change.action === 'create');
  const conflicts = result.subLocations.filter((change) => change.action === 'conflict');
  assert.equal(created.length, 1);
  assert.equal(created[0].external_id, '12', 'the lower id wins');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].external_id, '30');
  // The losing row comes FIRST and creates a new asset, which is when the
  // apply step resolves a target against the database. It must have no target
  // left, or "Atelier" would be created for id 30 before id 12 is reached and
  // the run would contradict the preview.
  assert.equal(row(result, '1').action, 'create');
  assert.equal(result.writes.get('device:1')?.subLocation, null);
  assert.equal(result.writes.get('device:2')?.subLocation?.externalId, '12');
  // That conflict is on its equipment row already, not repeated for the run.
  assert.equal(row(result, '1').warnings.some((notice) => notice.code === 'sub_location_name_taken'), true);
  assert.deepEqual(subLocationUpkeepNotices(result.subLocations), []);
}

// A Location without a name is no target, and the equipment still imports.
{
  const result = plan({
    objects: [deepDevice(1, 'a-machine', 7)],
    locations: locationIndex([{ id: '7', name: '' }]),
  });
  assert.equal(row(result, '1').action, 'create');
  assert.equal(result.writes.get('device:1')?.subLocation, null);
  assert.deepEqual(result.subLocations, []);
}

// Replaying the plan on the state it produced changes nothing at all.
{
  const index = locationIndex([{ id: '1', name: 'Salle serveurs', description: 'Rangée A' }]);
  const first = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    assets: [asset({ sub_location_id: 'sub-1' })],
    subLocations: [subLocation()],
    locations: index,
  });
  const adopted = first.subLocations[0];
  assert.equal(adopted.action, 'adopt');
  const second = plan({
    objects: [deepDevice(1, 'par-esx-01', 1)],
    assets: [asset({ sub_location_id: 'sub-1' })],
    subLocations: [subLocation({
      name: adopted.name,
      description: adopted.description,
      external_source: 'netbox',
      external_id: '1',
      external_url: adopted.external_url,
    })],
    locations: index,
  });
  assert.deepEqual(second.subLocations, []);
  assert.deepEqual(row(second, '1').diffs, []);
  assert.equal(row(second, '1').action, 'unchanged');
}

// ---------------------------------------------------------------------------
// Review batches: a manual run writes only what its preview listed.
// ---------------------------------------------------------------------------

function batchRow(id: number, overrides: Partial<NetboxPlanRow> = {}): NetboxPlanRow {
  return {
    external_type: 'device',
    external_id: String(id),
    external_name: `object-${id}`,
    external_url: `${BASE_URL}/dcim/devices/${id}/`,
    external_status: 'active',
    action: 'create',
    asset: null,
    matched_by: null,
    candidates: [],
    diffs: [],
    skip_reason: null,
    warnings: [],
    decision: null,
    ...overrides,
  };
}

// Out-of-scope objects are counted, never listed: five hundred patch panels
// must not push the one server that needs a decision out of the batch.
{
  const rows = [
    ...Array.from({ length: 600 }, (_, index) => batchRow(index + 1, { action: 'skipped', skip_reason: 'unmapped_role' })),
    batchRow(901, { action: 'skipped', skip_reason: 'unmapped_site' }),
    batchRow(902, { action: 'skipped', skip_reason: 'ignored' }),
    batchRow(1000, { action: 'ambiguous' }),
  ];
  const batch = buildReviewBatch(rows, 500);
  assert.deepEqual(batch.rows.map((entry) => entry.external_id), ['1000']);
  assert.equal(batch.remaining, 0);
  assert.deepEqual(batch.skipped_by_reason, { unmapped_role: 600, unmapped_site: 1, ignored: 1 });
}

// Order inside a batch: what the person settled, then creations, then updates,
// then what waits for a decision, then the merely informative. Netbox order is
// kept inside a group, so a batch is stable between two previews.
{
  const rows = [
    batchRow(1, { action: 'unchanged', warnings: [netboxNoticeOf('os_not_in_catalog')] }),
    batchRow(2, { action: 'update' }),
    batchRow(3, { action: 'create' }),
    batchRow(4, { action: 'ambiguous' }),
    batchRow(5, { action: 'skipped', skip_reason: 'ignored', decision: 'ignore' }),
    batchRow(6, { action: 'create' }),
    batchRow(7, { action: 'unchanged' }),
  ];
  const batch = buildReviewBatch(rows, 500);
  assert.deepEqual(batch.rows.map((entry) => entry.external_id), ['5', '3', '6', '2', '4', '1']);
  assert.deepEqual(batch.skipped_by_reason, {});
}

// What does not fit is counted as remaining, and only writes count: an
// undecided or informative object beyond the cut holds nothing up.
{
  const rows = [
    batchRow(1, { action: 'create' }),
    batchRow(2, { action: 'create' }),
    batchRow(3, { action: 'update' }),
    batchRow(4, { action: 'ambiguous' }),
    batchRow(5, { action: 'unchanged', warnings: [netboxNoticeOf('os_not_in_catalog')] }),
  ];
  const batch = buildReviewBatch(rows, 2);
  assert.deepEqual(batch.rows.map((entry) => entry.external_id), ['1', '2']);
  assert.equal(batch.remaining, 1);
}

// Batches always move forward. An object left undecided stays undecided from
// one preview to the next: ahead of the writes it would keep its place in
// every batch and could shut them out for good.
{
  const undecided = Array.from({ length: 3 }, (_, index) => batchRow(index + 1, { action: 'ambiguous' }));
  const writes = [batchRow(10, { action: 'create' }), batchRow(11, { action: 'update' })];
  const first = buildReviewBatch([...undecided, ...writes], 2);
  assert.deepEqual(first.rows.map((entry) => entry.external_id), ['10', '11']);
  assert.equal(first.remaining, 0);
  // Once applied, the writes are gone and the undecided objects get the room.
  const second = buildReviewBatch(undecided, 2);
  assert.deepEqual(second.rows.map((entry) => entry.external_id), ['1', '2']);
  assert.equal(second.remaining, 0);
}

// The rule itself. A creation or an update outside the reviewed list is left
// alone; the scheduled run, which has no reviewer, holds nothing back; an
// object waiting for a decision is never held back, recording it writes no
// asset and is what puts it in the "to decide" list.
{
  const reviewed = new Set(['device:1']);
  assert.equal(isWriteDeferred(batchRow(1, { action: 'create' }), reviewed), false);
  assert.equal(isWriteDeferred(batchRow(2, { action: 'create' }), reviewed), true);
  assert.equal(isWriteDeferred(batchRow(2, { action: 'update' }), reviewed), true);
  assert.equal(isWriteDeferred(batchRow(2, { action: 'ambiguous' }), reviewed), false);
  assert.equal(isWriteDeferred(batchRow(2, { action: 'unchanged' }), reviewed), false);
  assert.equal(isWriteDeferred(batchRow(2, { action: 'create' }), null), false);
  // Nothing reviewed at all (an older page, a direct API call): nothing written.
  assert.equal(isWriteDeferred(batchRow(1, { action: 'create' }), new Set()), true);
}

console.log('netbox-planner.spec.ts OK');
