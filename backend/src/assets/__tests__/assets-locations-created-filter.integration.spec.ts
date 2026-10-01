import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { Asset } from '../asset.entity';
import { AssetsListService } from '../services/assets-list.service';
import { Location } from '../../locations/location.entity';
import { LocationsService } from '../../locations/locations.service';
import { seedTenant, setCurrentTenant } from '../../interfaces/__tests__/interface-seed-helpers';

// The assets and locations lists show a text filter on the Created column. Both apply it
// the way the connections and applications lists do, on the timestamp read as text; the
// rows and the prev/next ids agree, and another tenant's rows never match.

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantB = await seedTenant(runner, 'created-b');
    await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
       VALUES ($1, 'Other tenant server', 'physical_server', 'on_premise', 'prod', 'active', '2024-03-05 12:00:00+00', now())`,
      [tenantB],
    );
    await runner.query(
      `INSERT INTO locations (tenant_id, name, hosting_type, location_reference, created_at, updated_at)
       VALUES ($1, 'Other tenant site', 'on_prem', 'LOC-B1', '2024-03-05 12:00:00+00', now())`,
      [tenantB],
    );

    const tenantA = await seedTenant(runner, 'created-a');
    await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
       VALUES ($1, 'Old server', 'physical_server', 'on_premise', 'prod', 'active', '2024-03-05 12:00:00+00', now()),
              ($1, 'New server', 'physical_server', 'on_premise', 'prod', 'active', '2025-07-01 12:00:00+00', now())`,
      [tenantA],
    );
    await runner.query(
      `INSERT INTO locations (tenant_id, name, hosting_type, location_reference, created_at, updated_at)
       VALUES ($1, 'Old site', 'on_prem', 'LOC-A1', '2024-03-05 12:00:00+00', now()),
              ($1, 'New site', 'on_prem', 'LOC-A2', '2025-07-01 12:00:00+00', now())`,
      [tenantA],
    );
    await setCurrentTenant(runner, tenantA);
    const opts = { manager: runner.manager, tenantId: tenantA };
    const created = (type: string, filter?: string) => ({
      filters: JSON.stringify({ created_at: { filterType: 'text', type, filter } }),
      sort: 'name:ASC',
      limit: 100,
    });

    const assets = new AssetsListService(runner.manager.getRepository(Asset));
    const assetNames = async (query: any) => {
      const result = await assets.list(query, opts);
      const ids = await assets.listIds(query, opts);
      assert.deepEqual(ids.ids, result.items.map((item: any) => item.id));
      assert.equal(ids.total, result.total);
      return result.items.map((item: any) => item.name);
    };
    assert.deepEqual(await assetNames({ sort: 'name:ASC', limit: 100 }), ['New server', 'Old server']);
    assert.deepEqual(await assetNames(created('contains', '2024-03')), ['Old server']);
    assert.deepEqual(await assetNames(created('startsWith', '2025')), ['New server']);
    assert.deepEqual(await assetNames(created('contains', '1999')), []);

    const locations = new LocationsService(runner.manager.getRepository(Location), {} as any, {} as any, {} as any);
    const locationNames = async (query: any) => {
      const result = await locations.list(query, opts);
      const ids = await locations.listIds(query, opts);
      assert.deepEqual(ids.ids, result.items.map((item: any) => item.id));
      assert.equal(ids.total, result.total);
      return result.items.map((item: any) => item.name);
    };
    assert.deepEqual(await locationNames({ sort: 'name:ASC', limit: 100 }), ['New site', 'Old site']);
    assert.deepEqual(await locationNames(created('contains', '2024-03')), ['Old site']);
    assert.deepEqual(await locationNames(created('startsWith', '2025')), ['New site']);
    assert.deepEqual(await locationNames(created('notContains', '2025')), ['Old site']);
    assert.deepEqual(await locationNames(created('contains', '1999')), []);
    // With the quick search, the Created filter still applies.
    assert.deepEqual(await locationNames({ ...created('contains', '2024-03'), q: 'site' }), ['Old site']);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('assets and locations Created filter integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
