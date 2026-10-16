import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { Asset } from '../asset.entity';
import { AssetsListService } from '../services/assets-list.service';
import { Location } from '../../locations/location.entity';
import { LocationsService } from '../../locations/locations.service';
import { seedTenant, setCurrentTenant } from '../../interfaces/__tests__/interface-seed-helpers';

// The assets and locations lists show a date filter on the Created column. Both apply it by
// day, like the other lists; a text model on it answers 400. The rows and the prev/next ids
// agree, and another tenant's rows never match.

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
    const created = (type: string, dateFrom?: string, dateTo?: string) => ({
      filters: JSON.stringify({ created_at: { filterType: 'date', type, dateFrom: dateFrom ? `${dateFrom} 00:00:00` : null, dateTo: dateTo ? `${dateTo} 00:00:00` : null } }),
      sort: 'name:ASC',
      limit: 100,
    });
    const text = { filters: JSON.stringify({ created_at: { filterType: 'text', type: 'contains', filter: '2024' } }), limit: 100 };
    const badRequest = (err: unknown) => err instanceof BadRequestException && /date filter/.test((err as Error).message);

    const assets = new AssetsListService(runner.manager.getRepository(Asset));
    const assetNames = async (query: any) => {
      const result = await assets.list(query, opts);
      const ids = await assets.listIds(query, opts);
      assert.deepEqual(ids.ids, result.items.map((item: any) => item.id));
      assert.equal(ids.total, result.total);
      return result.items.map((item: any) => item.name);
    };
    assert.deepEqual(await assetNames({ sort: 'name:ASC', limit: 100 }), ['New server', 'Old server']);
    assert.deepEqual(await assetNames(created('equals', '2024-03-05')), ['Old server']);
    assert.deepEqual(await assetNames(created('greaterThan', '2025-01-01')), ['New server']);
    assert.deepEqual(await assetNames(created('inRange', '1999-01-01', '1999-12-31')), []);
    await assert.rejects(assets.list(text, opts), badRequest);

    const locations = new LocationsService(runner.manager.getRepository(Location), {} as any, {} as any, {} as any);
    const locationNames = async (query: any) => {
      const result = await locations.list(query, opts);
      const ids = await locations.listIds(query, opts);
      assert.deepEqual(ids.ids, result.items.map((item: any) => item.id));
      assert.equal(ids.total, result.total);
      return result.items.map((item: any) => item.name);
    };
    assert.deepEqual(await locationNames({ sort: 'name:ASC', limit: 100 }), ['New site', 'Old site']);
    assert.deepEqual(await locationNames(created('equals', '2024-03-05')), ['Old site']);
    assert.deepEqual(await locationNames(created('greaterThan', '2025-01-01')), ['New site']);
    assert.deepEqual(await locationNames(created('notEqual', '2025-07-01')), ['Old site']);
    assert.deepEqual(await locationNames(created('inRange', '1999-01-01', '1999-12-31')), []);
    // With the quick search, the Created filter still applies.
    assert.deepEqual(await locationNames({ ...created('lessThan', '2025-01-01'), q: 'site' }), ['Old site']);
    await assert.rejects(locations.list(text, opts), badRequest);
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
