import * as assert from 'node:assert/strict';
import {
  NETBOX_VIRTUAL_MACHINES_SLUG,
  NetboxCatalogs,
  mapNetboxObject,
  normalizeNetboxDevice,
  normalizeNetboxVirtualMachine,
} from '../netbox-mapper';
import { ExistingAsset } from '../netbox-matcher';
import {
  NetboxClusterAsset,
  NetboxClusterContext,
  buildReviewBatch,
  planClusterAttachment,
  planNetboxSync,
} from '../netbox-planner';

// Attaching a virtual machine to its KANAP cluster, as the planner decides it:
// add only, one notice per Netbox cluster that cannot take its machines, and a
// row whose only change is the cluster is an update.

const BASE_URL = 'https://netbox.example.test';

const CATALOGS: NetboxCatalogs = {
  assetKinds: [{ code: 'virtual_server', label: 'Virtual server' }, { code: 'physical_server', label: 'Server' }],
  assetProviders: [{ code: 'other', label: 'Other' }],
  operatingSystems: [],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  ipAddressTypes: [{ code: 'host', label: 'Host' }],
  domains: [],
  subnets: [],
  locations: [{ id: 'loc-paris', name: 'Paris DC', provider: null }],
};

const PARIS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GOUDA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OLD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SERVER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function vm(id: number, name: string, cluster: { id: number; name: string } | null) {
  return normalizeNetboxVirtualMachine({
    id,
    name,
    status: { value: 'active' },
    site: { slug: 'paris', name: 'Paris DC' },
    cluster,
  }, BASE_URL);
}

function vmAsset(id: string, name: string): ExistingAsset {
  return {
    id,
    name,
    asset_reference: null,
    status: 'active',
    kind: 'virtual_server',
    location_id: 'loc-paris',
    sub_location_id: null,
    hostname: name,
    domain: null,
    fqdn: null,
    operating_system: null,
    ip_addresses: [],
    serial_number: null,
    manufacturer: null,
    model: null,
    rack_location: null,
    rack_unit: null,
  };
}

const TARGETS: NetboxClusterAsset[] = [
  { id: PARIS, name: 'PAR-VSPHERE-CL01', is_cluster: true, status: 'active' },
  { id: GOUDA, name: 'GOU-VSPHERE-CL01', is_cluster: true, status: 'active' },
  { id: OLD, name: 'PAR-OLD-CL', is_cluster: true, status: 'retired' },
  { id: SERVER, name: 'par-esx-01', is_cluster: false, status: 'active' },
];

function context(
  map: Record<string, string>,
  containers: Record<string, Array<{ id: string; name: string }>> = {},
  hosts: Record<string, Array<{ id: string; name: string; cluster_id: string }>> = {},
): NetboxClusterContext {
  return {
    map,
    targets: new Map(TARGETS.map((target) => [target.id, target])),
    containers: new Map(Object.entries(containers)),
    hosts: new Map(Object.entries(hosts)),
  };
}

function plan(objects: ReturnType<typeof vm>[], assets: ExistingAsset[], clusters: NetboxClusterContext | null) {
  const mappings = objects.map((object) => mapNetboxObject(object, {
    roleMap: { [NETBOX_VIRTUAL_MACHINES_SLUG]: 'virtual_server', server: 'physical_server' },
    siteMap: { paris: 'loc-paris' },
    defaultEnvironment: 'prod',
    catalogs: CATALOGS,
    locations: null,
  }));
  return planNetboxSync({
    mappings,
    links: [],
    assets,
    catalogs: CATALOGS,
    fetchOk: true,
    totalObjects: objects.length,
    clusters,
  });
}

// --- one machine at a time -------------------------------------------------

{
  const machine = vm(50, 'par-app-01', { id: 7, name: 'Paris vSphere' });

  // Matched, not attached yet: the relation is added, shown as a diff.
  const added = planClusterAttachment(machine, 'vm-1', context({ 7: PARIS }));
  assert.deepEqual(added.target, { assetId: PARIS, netboxName: 'Paris vSphere' });
  assert.deepEqual(added.diff, { field: 'cluster', before: null, after: 'PAR-VSPHERE-CL01' });
  assert.deepEqual(added.warnings, []);
  assert.equal(added.clusterNotice, null);

  // Already there, put by hand or by an earlier run: nothing to do.
  const present = planClusterAttachment(machine, 'vm-1', context({ 7: PARIS }, { 'vm-1': [{ id: PARIS, name: 'PAR-VSPHERE-CL01' }] }));
  assert.equal(present.target, null);
  assert.equal(present.diff, null);
  assert.deepEqual(present.warnings, []);

  // Another cluster holds it: the matched one is added, the other is kept and pointed out.
  const moved = planClusterAttachment(machine, 'vm-1', context({ 7: PARIS }, { 'vm-1': [{ id: GOUDA, name: 'GOU-VSPHERE-CL01' }] }));
  assert.deepEqual(moved.diff, { field: 'cluster', before: 'GOU-VSPHERE-CL01', after: 'PAR-VSPHERE-CL01' });
  assert.deepEqual(moved.warnings.map((notice) => [notice.code, notice.params]), [
    ['cluster_other_present', { name: 'par-app-01', value: 'GOU-VSPHERE-CL01' }],
  ]);
  assert.match(moved.warnings[0].text, /"par-app-01" in GOU-VSPHERE-CL01/);

  // Both: nothing added, the other one still pointed out.
  const both = planClusterAttachment(machine, 'vm-1', context({ 7: PARIS }, {
    'vm-1': [{ id: GOUDA, name: 'GOU-VSPHERE-CL01' }, { id: PARIS, name: 'PAR-VSPHERE-CL01' }],
  }));
  assert.equal(both.target, null);
  assert.equal(both.diff, null);
  assert.equal(both.warnings[0]?.code, 'cluster_other_present');

  // A member host of the matched cluster carries the machine: the cluster
  // replaces it, and the preview says so as a placement (R1).
  const host = '11111111-1111-4111-8111-111111111111';
  const host2 = '22222222-2222-4222-8222-222222222222';
  const placed = planClusterAttachment(machine, 'vm-1', context({ 7: PARIS }, {}, {
    'vm-1': [{ id: host, name: 'par-esx-01', cluster_id: PARIS }],
  }));
  assert.deepEqual(placed.target, { assetId: PARIS, netboxName: 'Paris vSphere' });
  assert.deepEqual(placed.diff, { field: 'placement', before: 'par-esx-01', after: 'PAR-VSPHERE-CL01' });
  assert.deepEqual(placed.warnings, []);
  // Two member hosts in Netbox order: both names.
  const twoHosts = planClusterAttachment(machine, 'vm-1', context({ 7: PARIS }, {}, {
    'vm-1': [
      { id: host, name: 'par-esx-01', cluster_id: PARIS },
      { id: host2, name: 'par-esx-02', cluster_id: PARIS },
    ],
  }));
  assert.equal(twoHosts.diff?.before, 'par-esx-01, par-esx-02');
  assert.equal(twoHosts.diff?.field, 'placement');
  // A host of another cluster replaces nothing: the cluster diff stays.
  const foreignHost = planClusterAttachment(machine, 'vm-1', context({ 7: PARIS }, {}, {
    'vm-1': [{ id: host, name: 'par-esx-01', cluster_id: GOUDA }],
  }));
  assert.deepEqual(foreignHost.diff, { field: 'cluster', before: null, after: 'PAR-VSPHERE-CL01' });
  // Already in the cluster: nothing to add, and the host link is left alone.
  const presentWithHost = planClusterAttachment(machine, 'vm-1', context(
    { 7: PARIS },
    { 'vm-1': [{ id: PARIS, name: 'PAR-VSPHERE-CL01' }] },
    { 'vm-1': [{ id: host, name: 'par-esx-01', cluster_id: PARIS }] },
  ));
  assert.equal(presentWithHost.target, null);
  assert.equal(presentWithHost.diff, null);
  assert.deepEqual(presentWithHost.warnings, []);

  // A machine this run creates: the relation follows the creation, and the
  // preview shows the cluster it joins.
  const created = planClusterAttachment(machine, null, context({ 7: PARIS }));
  assert.deepEqual(created.target, { assetId: PARIS, netboxName: 'Paris vSphere' });
  assert.deepEqual(created.diff, { field: 'cluster', before: null, after: 'PAR-VSPHERE-CL01' });

  // Not matched: nothing, and a notice for the cluster.
  const unmatched = planClusterAttachment(machine, 'vm-1', context({}));
  assert.equal(unmatched.target, null);
  assert.equal(unmatched.clusterNotice?.code, 'cluster_not_mapped');
  assert.equal(unmatched.clusterNotice?.params.value, 'Paris vSphere');

  // Matched with an asset deleted, retired or not a cluster: nothing, and a notice.
  for (const assetId of ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', OLD, SERVER]) {
    const invalid = planClusterAttachment(machine, 'vm-1', context({ 7: assetId }));
    assert.equal(invalid.target, null, assetId);
    assert.equal(invalid.clusterNotice?.code, 'cluster_match_invalid', assetId);
  }
  // The status is compared without case, as on save.
  {
    const shouting = context({ 7: OLD });
    shouting.targets.set(OLD, { id: OLD, name: 'PAR-OLD-CL', is_cluster: true, status: 'Retired' });
    assert.equal(planClusterAttachment(machine, 'vm-1', shouting).clusterNotice?.code, 'cluster_match_invalid');
  }

  // No cluster in Netbox, a device, or no context at all: nothing, and silence.
  assert.equal(planClusterAttachment(vm(51, 'par-app-02', null), 'vm-1', context({ 7: PARIS })).clusterNotice, null);
  const device = normalizeNetboxDevice({ id: 9, name: 'par-esx-01', cluster: { id: 7, name: 'Paris vSphere' } }, BASE_URL);
  assert.equal(planClusterAttachment(device, 'vm-1', context({ 7: PARIS })).target, null);
  assert.equal(planClusterAttachment(machine, 'vm-1', null).target, null);
}

// --- a whole run -----------------------------------------------------------

{
  const objects = [
    vm(50, 'par-app-01', { id: 7, name: 'Paris vSphere' }),
    vm(51, 'par-app-02', { id: 7, name: 'Paris vSphere' }),
    vm(52, 'gou-app-01', { id: 8, name: 'Gouda vSphere' }),
    vm(53, 'gou-app-02', { id: 8, name: 'Gouda vSphere' }),
    vm(54, 'pma-app-01', { id: 9, name: 'Parma vSphere' }),
    vm(55, 'new-app-01', { id: 7, name: 'Paris vSphere' }),
  ];
  const assets = [
    vmAsset('vm-50', 'par-app-01'),
    vmAsset('vm-51', 'par-app-02'),
    vmAsset('vm-52', 'gou-app-01'),
    vmAsset('vm-53', 'gou-app-02'),
    vmAsset('vm-54', 'pma-app-01'),
  ];
  const result = plan(objects, assets, context(
    { 7: PARIS, 8: OLD },
    { 'vm-51': [{ id: PARIS, name: 'PAR-VSPHERE-CL01' }] },
  ));
  const byName = (name: string) => result.rows.find((entry) => entry.external_name === name)!;

  // Only the cluster changes: an update, which a preview lists and a run writes.
  assert.equal(byName('par-app-01').action, 'update');
  assert.deepEqual(byName('par-app-01').diffs, [{ field: 'cluster', before: null, after: 'PAR-VSPHERE-CL01' }]);
  assert.deepEqual(result.writes.get('vm:50')?.cluster, { assetId: PARIS, netboxName: 'Paris vSphere' });
  // Already in it: unchanged, nothing to write.
  assert.equal(byName('par-app-02').action, 'unchanged');
  assert.equal(result.writes.get('vm:51')?.cluster, null);
  // A retired target and an unmatched cluster attach nothing.
  assert.equal(byName('gou-app-01').action, 'unchanged');
  assert.equal(byName('pma-app-01').action, 'unchanged');
  // A new machine is created, then attached.
  assert.equal(byName('new-app-01').action, 'create');
  assert.deepEqual(byName('new-app-01').diffs, [{ field: 'cluster', before: null, after: 'PAR-VSPHERE-CL01' }]);
  assert.deepEqual(result.writes.get('vm:55')?.cluster, { assetId: PARIS, netboxName: 'Paris vSphere' });
  // One notice per Netbox cluster, not one per machine.
  assert.deepEqual(
    result.clusterNotices.map((notice) => [notice.code, notice.params.value]),
    [['cluster_match_invalid', 'Gouda vSphere'], ['cluster_not_mapped', 'Parma vSphere']],
  );
  // The batch lists the creation and the update; the unchanged rows stay out.
  const batch = buildReviewBatch(result.rows, 500);
  assert.deepEqual(batch.rows.map((entry) => entry.external_name), ['new-app-01', 'par-app-01']);

  // Without any cluster context the same run attaches nothing at all.
  const without = plan(objects, assets, null);
  assert.equal(without.rows.filter((entry) => entry.action === 'update').length, 0);
  assert.deepEqual(without.clusterNotices, []);
}

console.log('netbox-cluster-plan.spec.ts OK');
