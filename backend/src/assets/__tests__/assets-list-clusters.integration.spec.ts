// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { Asset } from '../asset.entity';
import { AssetsListService, CLUSTER_FILTER_IS_CLUSTER } from '../services/assets-list.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { asset, member } from '../../technologies/__tests__/technologies.fixtures';

// The Cluster column of the asset list (lot A2 of the clusters pass), against a real database:
// - only real clusters show, by name then id, and never the legacy `assets.cluster` text;
// - the sort by cluster gives one row per asset (the page holds the total);
// - the filter: cluster names, the clusters themselves (`__cluster__`), the plain assets of no
//   cluster (`null`), joined by OR; its values list them in that order.

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'alc');
  const beta = await asset(runner, tenantId, 'beta-cl', true);
  const alpha = await asset(runner, tenantId, 'Alpha-cl', true);
  const empty = await asset(runner, tenantId, 'empty-cl', true);
  const former = await asset(runner, tenantId, 'former-cl', true);
  const twice = await asset(runner, tenantId, 'node-twice');
  const once = await asset(runner, tenantId, 'node-once');
  const orphan = await asset(runner, tenantId, 'node-orphan');
  const lonely = await asset(runner, tenantId, 'node-lonely');
  await member(runner, tenantId, beta, twice);
  await member(runner, tenantId, alpha, twice);
  await member(runner, tenantId, beta, once);
  await member(runner, tenantId, former, orphan);
  // A cluster turned back into a plain asset, its membership left behind (orphan row).
  await runner.query(`UPDATE assets SET is_cluster = false WHERE tenant_id = $1 AND id = $2`, [tenantId, former]);
  // The legacy text is never shown.
  await runner.query(`UPDATE assets SET cluster = 'LEGACY' WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, [lonely, twice]]);
  void empty;
  return tenantId;
}

async function testList() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seed(runner);
    const opts = { manager: runner.manager, tenantId };
    const service = new AssetsListService(runner.manager.getRepository(Asset));
    const list = async (query: Record<string, unknown>) => service.list({ limit: 100, ...query }, opts);
    const filtered = async (values: Array<string | null>, extra: Record<string, unknown> = {}) => {
      const result = await list({ filters: JSON.stringify({ cluster: { filterType: 'set', values } }), sort: 'name:ASC', ...extra });
      const ids = await service.listIds({ filters: JSON.stringify({ cluster: { filterType: 'set', values } }), sort: 'name:ASC', ...extra }, opts);
      assert.deepEqual(ids.ids, result.items.map((item: any) => item.id));
      return result.items.map((item: any) => item.name);
    };

    const all = await list({ sort: 'name:ASC' });
    const cells = Object.fromEntries(all.items.map((item: any) => [item.name, item.cluster]));
    assert.deepEqual(cells, {
      'Alpha-cl': null,
      'beta-cl': null,
      'empty-cl': null,
      'former-cl': null,
      'node-lonely': null,
      'node-once': 'beta-cl',
      'node-orphan': null,
      'node-twice': 'Alpha-cl, beta-cl',
    });

    // One row per asset in the cluster sort, both ways.
    for (const direction of ['ASC', 'DESC']) {
      const sorted = await list({ sort: `cluster:${direction}` });
      assert.equal(sorted.items.length, sorted.total);
      assert.equal(sorted.total, 8);
      assert.equal(new Set(sorted.items.map((item: any) => item.id)).size, 8);
      const ids = await service.listIds({ sort: `cluster:${direction}` }, opts);
      assert.equal(ids.ids.length, 8);
      const members = sorted.items.map((item: any) => item.name).filter((name: string) => name === 'node-twice' || name === 'node-once');
      assert.deepEqual(members, direction === 'ASC' ? ['node-twice', 'node-once'] : ['node-once', 'node-twice']);
    }

    const values = await service.listFilterValues({ fields: 'cluster' }, opts);
    assert.deepEqual(values.cluster, ['Alpha-cl', 'beta-cl', CLUSTER_FILTER_IS_CLUSTER, null]);

    assert.deepEqual(await filtered([null]), ['former-cl', 'node-lonely', 'node-orphan']);
    assert.deepEqual(await filtered([CLUSTER_FILTER_IS_CLUSTER]), ['Alpha-cl', 'beta-cl', 'empty-cl']);
    assert.deepEqual(await filtered(['beta-cl']), ['node-once', 'node-twice']);
    assert.deepEqual(await filtered(['Alpha-cl', CLUSTER_FILTER_IS_CLUSTER]), ['Alpha-cl', 'beta-cl', 'empty-cl', 'node-twice']);
    assert.deepEqual(await filtered(['beta-cl', null]), ['former-cl', 'node-lonely', 'node-once', 'node-orphan', 'node-twice']);
    assert.deepEqual(await filtered([]), []);
    // A former cluster is no value of the filter: naming it keeps nothing.
    assert.deepEqual(await filtered(['former-cl']), []);

    // The values follow the other filters: plain assets only, no `__cluster__`.
    const scoped = await service.listFilterValues({ fields: 'cluster', filters: JSON.stringify({ is_cluster: { filterType: 'set', values: ['false'] } }) }, opts);
    assert.deepEqual(scoped.cluster, ['Alpha-cl', 'beta-cl', null]);
    // The search reaches a cluster's name and keeps one row per asset.
    const searched = await list({ q: 'cl', sort: 'cluster:ASC' });
    assert.equal(searched.items.length, searched.total);
  });
}

runSpecs('assets-list-clusters.integration.spec.ts', [
  ['the Cluster column: names, sort, filter and its values', testList],
]);
