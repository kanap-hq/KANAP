import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { NetboxConfigService } from '../netbox-config.service';
import { NetboxSyncService } from '../netbox-sync.service';
import { NetboxApiError } from '../netbox.types';
import { suggestClusterAsset } from '../netbox-mapper';

// The cluster a Netbox virtual machine runs on, matched to a KANAP cluster
// asset. Netbox names its clusters one way ("Paris vSphere"), KANAP another
// ("PAR-VSPHERE-CL01"): a saved match settles it, and the Mappings tab
// pre-fills it only when exactly one KANAP cluster carries the Netbox name.

const BASE_URL = 'https://netbox.example.test';
const TENANT = '11111111-1111-4111-8111-111111111111';
const CLUSTER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLUSTER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RETIRED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ELSEWHERE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// --- the suggestion --------------------------------------------------------

{
  const assets = [
    { id: CLUSTER_A, name: 'Paris vSphere' },
    { id: CLUSTER_B, name: 'Gouda vSphere' },
  ];
  // The same name, whatever the case and the spaces around it.
  assert.equal(suggestClusterAsset('Paris vSphere', assets), CLUSTER_A);
  assert.equal(suggestClusterAsset('  paris VSPHERE ', assets), CLUSTER_A);
  // A name that only resembles is not suggested.
  assert.equal(suggestClusterAsset('Paris', assets), null);
  assert.equal(suggestClusterAsset('Paris vSphere 2', assets), null);
  // Nothing to go on.
  assert.equal(suggestClusterAsset('', assets), null);
  assert.equal(suggestClusterAsset(null, assets), null);
  // Two KANAP clusters with that name: the administrator chooses.
  assert.equal(
    suggestClusterAsset('Paris vSphere', [...assets, { id: SERVER, name: 'PARIS VSPHERE' }]),
    null,
  );
}

// --- saving the matches ----------------------------------------------------

type AssetRow = { id: string; name: string; is_cluster: boolean; status: string | null; tenant_id: string };

const ASSETS: AssetRow[] = [
  { id: CLUSTER_A, name: 'PAR-VSPHERE-CL01', is_cluster: true, status: 'active', tenant_id: TENANT },
  { id: CLUSTER_B, name: 'GOU-VSPHERE-CL01', is_cluster: true, status: 'active', tenant_id: TENANT },
  { id: SERVER, name: 'par-app-01', is_cluster: false, status: 'active', tenant_id: TENANT },
  { id: RETIRED, name: 'PAR-OLD-CL', is_cluster: true, status: 'retired', tenant_id: TENANT },
  // A cluster of another workspace: never a valid target here.
  { id: ELSEWHERE, name: 'OTHER-CL', is_cluster: true, status: 'active', tenant_id: 'other-tenant' },
];

function harness(initial: Record<string, unknown>) {
  const config: any = {
    tenant_id: TENANT,
    base_url: BASE_URL,
    enabled: true,
    credential_ref_json: null,
    metadata_json: initial,
  };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager: any = {
    getRepository: () => ({
      findOne: async () => config,
      save: async (entity: unknown) => entity,
    }),
    // Answers the target check the way the database would, tenant predicate included.
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      const [tenantId, ids] = params as [string, string[]];
      return ASSETS.filter((asset) => asset.tenant_id === tenantId && ids.includes(asset.id));
    },
  };
  return { config, manager, queries, service: new NetboxConfigService({ canEncrypt: () => true } as any) };
}

async function main() {
  // A page that does not know about clusters sends the other maps only: the
  // saved cluster matches and their names survive.
  {
    const { config, manager, service } = harness({
      cluster_map: { 7: CLUSTER_A },
      cluster_names: { 7: 'Paris vSphere' },
    });
    const view = await service.saveMapping(manager, TENANT, { role_map: {}, site_map: {}, os_map: {} });
    assert.deepEqual(view.cluster_map, { 7: CLUSTER_A });
    assert.deepEqual(view.cluster_names, { 7: 'Paris vSphere' });
    assert.deepEqual(config.metadata_json.cluster_map, { 7: CLUSTER_A });
  }

  // Sent, they replace the stored ones in full; an empty choice drops a row,
  // and a name not sent again keeps the one stored before.
  {
    const { config, manager, queries, service } = harness({
      cluster_map: { 7: CLUSTER_A, 8: CLUSTER_B },
      cluster_names: { 7: 'Paris vSphere', 8: 'Gouda vSphere' },
    });
    const view = await service.saveMapping(manager, TENANT, {
      role_map: {},
      site_map: {},
      cluster_map: { 7: CLUSTER_A, 8: ' ', 9: CLUSTER_B },
      cluster_names: { 9: 'Parma vSphere', 12: 'Not matched' },
    });
    assert.deepEqual(view.cluster_map, { 7: CLUSTER_A, 9: CLUSTER_B });
    assert.deepEqual(view.cluster_names, { 7: 'Paris vSphere', 9: 'Parma vSphere' });
    assert.deepEqual(config.metadata_json.cluster_names, { 7: 'Paris vSphere', 9: 'Parma vSphere' });
    // One read for every target, scoped to this tenant.
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /tenant_id = \$1/);
    assert.equal(queries[0].params[0], TENANT);
  }

  // Clearing every match reads nothing and stores nothing.
  {
    const { config, manager, queries, service } = harness({ cluster_map: { 7: CLUSTER_A } });
    const view = await service.saveMapping(manager, TENANT, { role_map: {}, site_map: {}, cluster_map: {} });
    assert.deepEqual(view.cluster_map, {});
    assert.deepEqual(config.metadata_json.cluster_names, {});
    assert.equal(queries.length, 0);
  }

  // Refused, with a plain reason, and nothing stored: not a list, not an id,
  // an asset of another workspace, an asset that is not a cluster, a retired one.
  const refusals: Array<[unknown, RegExp]> = [
    ['7', /list of matches/],
    [[CLUSTER_A], /list of matches/],
    [{ 7: 'not-a-uuid' }, /asset of this workspace/],
    [{ 7: ELSEWHERE }, /not in this workspace/],
    [{ 7: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, /not in this workspace/],
    [{ 7: SERVER }, /"par-app-01" is not a cluster/],
    [{ 7: RETIRED }, /"PAR-OLD-CL" is retired/],
  ];
  for (const [cluster_map, message] of refusals) {
    const { config, manager, service } = harness({ cluster_map: { 8: CLUSTER_B } });
    await assert.rejects(
      () => service.saveMapping(manager, TENANT, { role_map: {}, site_map: {}, cluster_map }),
      (error: unknown) => error instanceof BadRequestException && message.test((error as Error).message),
    );
    assert.deepEqual(config.metadata_json.cluster_map, { 8: CLUSTER_B });
  }

  // A saved match whose cluster was retired, deleted or unmarked since never
  // blocks saving: sent back unchanged it stays, the other matches save, and
  // only the new ones are checked.
  for (const staleTarget of [RETIRED, 'ffffffff-ffff-4fff-8fff-ffffffffffff', SERVER]) {
    const { config, manager, queries, service } = harness({
      cluster_map: { 7: staleTarget },
      cluster_names: { 7: 'Paris vSphere' },
    });
    const view = await service.saveMapping(manager, TENANT, {
      role_map: { 3: 'server' },
      site_map: {},
      cluster_map: { 7: staleTarget.toUpperCase(), 8: CLUSTER_B },
    });
    assert.deepEqual(view.cluster_map, { 7: staleTarget, 8: CLUSTER_B });
    assert.deepEqual(config.metadata_json.role_map, { 3: 'server' });
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].params[1], [CLUSTER_B]);
  }

  // Removing it is always allowed, and a sent-back unchanged map reads nothing.
  {
    const { config, manager, queries, service } = harness({ cluster_map: { 7: RETIRED, 8: CLUSTER_B } });
    await service.saveMapping(manager, TENANT, { role_map: {}, site_map: {}, cluster_map: { 8: CLUSTER_B } });
    assert.deepEqual(config.metadata_json.cluster_map, { 8: CLUSTER_B });
    assert.equal(queries.length, 0);
  }

  // Pointing a saved match at a retired cluster is a change, so it is refused.
  {
    const { config, manager, service } = harness({ cluster_map: { 7: CLUSTER_A } });
    await assert.rejects(
      () => service.saveMapping(manager, TENANT, { role_map: {}, site_map: {}, cluster_map: { 7: RETIRED } }),
      /"PAR-OLD-CL" is retired/,
    );
    assert.deepEqual(config.metadata_json.cluster_map, { 7: CLUSTER_A });
  }

  // An id sent in capitals is stored in lower case, as the page compares it.
  {
    const { config, manager, service } = harness({});
    const view = await service.saveMapping(manager, TENANT, {
      role_map: {},
      site_map: {},
      cluster_map: { 7: CLUSTER_A.toUpperCase() },
    });
    assert.deepEqual(view.cluster_map, { 7: CLUSTER_A });
    assert.deepEqual(config.metadata_json.cluster_map, { 7: CLUSTER_A });
  }

  // Nothing saved yet reads as no match, never as undefined.
  {
    const { config, service } = harness({});
    assert.deepEqual(service.getMapping(config).cluster_map, {});
    assert.deepEqual(service.getMapping(config).cluster_names, {});
  }

  // --- the options of the Mappings tab -------------------------------------

  function optionsHarness(listClusters: () => Promise<unknown>, saved: Record<string, string> = {}) {
    const client: any = {
      listRoles: async () => [],
      listSites: async () => [],
      listPlatforms: async () => [],
      listClusters,
      countVirtualMachines: async () => 12,
    };
    const config: any = {
      getConfig: async () => ({ metadata_json: {} }),
      toView: () => ({ configured: true }),
      buildConnection: () => ({ baseUrl: BASE_URL, token: 'secret' }),
      getMapping: () => ({
        role_map: {}, site_map: {}, os_map: {}, cluster_map: saved, cluster_names: { 7: 'Paris vSphere' },
      }),
    };
    const itOpsSettings: any = { getSettings: async () => ({ serverKinds: [] }) };
    const clusterQueries: unknown[][] = [];
    const manager: any = {
      query: async (sql: string, params: unknown[]) => {
        if (!String(sql).includes('is_cluster')) return [];
        clusterQueries.push(params);
        return [
          { id: CLUSTER_B, name: 'Gouda vSphere' },
          { id: CLUSTER_A, name: 'Paris vSphere' },
        ];
      },
    };
    const service = new NetboxSyncService({} as any, config, client, itOpsSettings, {} as any, {} as any);
    return { service, manager, clusterQueries };
  }

  // Read normally: the Netbox clusters, the KANAP clusters of this tenant, and
  // a suggestion for a cluster with no saved match.
  {
    const { service, manager, clusterQueries } = optionsHarness(async () => [
      { id: '7', name: 'Paris vSphere', vm_count: 4 },
      { id: '8', name: 'Gouda vSphere', vm_count: 4 },
      { id: '9', name: 'Parma vSphere', vm_count: 4 },
    ], { 8: CLUSTER_A });
    const options: any = await service.mappingOptions(manager, TENANT);
    assert.equal(options.clusters_unavailable, false);
    assert.deepEqual(options.clusters.map((cluster: any) => cluster.id), ['7', '8', '9']);
    assert.deepEqual(options.kanap_clusters.map((asset: any) => asset.id), [CLUSTER_B, CLUSTER_A]);
    // A saved match is never overridden by a suggestion.
    assert.deepEqual(options.cluster_map, { 8: CLUSTER_A });
    assert.deepEqual(options.suggested_cluster_map, { 7: CLUSTER_A });
    assert.deepEqual(options.cluster_names, { 7: 'Paris vSphere' });
    assert.deepEqual(clusterQueries, [[TENANT]]);
  }

  // Refused the clusters: the rest of the tab still comes back.
  {
    const { service, manager } = optionsHarness(async () => {
      throw new NetboxApiError('forbidden', 'This Netbox token may not read that.');
    });
    const options: any = await service.mappingOptions(manager, TENANT);
    assert.equal(options.clusters_unavailable, true);
    assert.deepEqual(options.clusters, []);
    assert.deepEqual(options.suggested_cluster_map, {});
    assert.equal(options.roles[0].vm_count, 12);
  }

  console.log('netbox-cluster-mapping.spec.ts OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
